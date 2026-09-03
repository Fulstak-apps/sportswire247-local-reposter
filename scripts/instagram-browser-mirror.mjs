import fs from "node:fs/promises";
import path from "node:path";
import { launchBrowser } from "../src/browser.mjs";
import { loadConfig, paths } from "../src/lib.mjs";

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function assertSportsWireLogin(page, config) {
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  await pause(2500);
  if (!await page.locator(`a[href="/${config.instagramHandle}/"]`).count()) {
    throw new Error(`Dedicated sports profile is not signed into @${config.instagramHandle}; run npm run mirror:login first.`);
  }
}

async function waitForEditorButton(page, name, deadline) {
  while (Date.now() < deadline) {
    const reelNotice = page.getByText(/Video posts are now shared as reels/i).first();
    if (await reelNotice.isVisible().catch(() => false)) {
      const ok = page.getByRole("button", { name: /^OK$/i }).last();
      if (await ok.isVisible().catch(() => false)) await ok.click();
      await pause(800);
      continue;
    }
    const button = page.getByRole("button", { name, exact: true }).last();
    if (await button.isVisible().catch(() => false)) return button;
    await pause(800);
  }
  throw new Error(`Instagram editor did not show ${String(name)} before timeout.`);
}

async function findExistingPublication(context, config, captionNeedle) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${config.instagramHandle}/`, { waitUntil: "domcontentloaded" });
    await pause(1800);
    const links = await page.locator('a[href*="/reel/"], a[href*="/p/"]').evaluateAll(nodes => nodes.slice(0, 12).map(node => node.href));
    for (const href of links) {
      const detail = await context.newPage();
      try {
        await detail.goto(href, { waitUntil: "domcontentloaded" });
        await pause(650);
        if ((await detail.locator("body").innerText()).includes(captionNeedle)) {
          return { postId: href.match(/\/(?:reel|p)\/([^/]+)/)?.[1] || "", permalink: href, verifiedAt: new Date().toISOString() };
        }
      } finally { await detail.close(); }
    }
    return null;
  } finally { await page.close(); }
}

export async function publish(mediaPath, caption, { verifyNeedle = caption.slice(0, 100) } = {}) {
  const config = await loadConfig();
  const absoluteMedia = path.resolve(mediaPath);
  await fs.access(absoluteMedia);
  const context = await launchBrowser(config, false);
  try {
    const page = context.pages()[0] || await context.newPage();
    await assertSportsWireLogin(page, config);
    const existing = await findExistingPublication(context, config, verifyNeedle);
    if (existing) return existing;
    await page.getByRole("link", { name: /New post|Create/i }).first().click({ timeout: 20_000 });
    const postChoice = page.getByText("Post", { exact: true }).first();
    if (await postChoice.isVisible().catch(() => false)) await postChoice.click();
    const chooser = page.locator('input[type="file"]').first();
    await chooser.waitFor({ state: "attached", timeout: 20_000 });
    await chooser.setInputFiles(absoluteMedia);
    const deadline = Date.now() + 180_000;
    for (let step = 0; step < 2; step += 1) {
      const next = await waitForEditorButton(page, "Next", deadline);
      await next.click();
      await pause(1200);
    }
    const captionBox = page.getByRole("textbox", { name: /caption/i });
    await captionBox.waitFor({ state: "visible", timeout: 30_000 });
    await captionBox.fill(caption.trim());

    // Capture the pre-share newest post on a separate tab.  Never navigate the
    // upload tab after Share: that can abort Instagram's non-idempotent upload.
    const verifyPage = await context.newPage();
    try {
      await verifyPage.goto(`https://www.instagram.com/${config.instagramHandle}/`, { waitUntil: "domcontentloaded" });
      await pause(2000);
      const newest = verifyPage.locator('a[href*="/reel/"], a[href*="/p/"]').first();
      const before = await newest.getAttribute("href").catch(() => "");
      const share = await waitForEditorButton(page, "Share", Date.now() + 30_000);
      await share.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await pause(10_000);
        await verifyPage.reload({ waitUntil: "domcontentloaded" });
        await pause(1200);
        const href = await newest.getAttribute("href").catch(() => "");
        if (href && href !== before) return { postId: href.match(/\/(?:reel|p)\/([^/]+)/)?.[1] || "", permalink: new URL(href, "https://www.instagram.com").toString(), verifiedAt: new Date().toISOString() };
      }
      // A changed URL is the primary idempotency check. Caption matching is
      // retained only as diagnostic evidence when Instagram is delayed.
      const body = await verifyPage.locator("body").innerText().catch(() => "");
      throw new Error(`UNCERTAIN: Share clicked but no new @${config.instagramHandle} post appeared within two minutes${body.includes(verifyNeedle) ? " (caption was visible)" : ""}.`);
    } finally { await verifyPage.close(); }
  } finally { await context.close(); }
}

async function login() {
  const config = await loadConfig();
  const context = await launchBrowser(config, false);
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  console.log("Sign into @sportswire247 in this dedicated SportsWire247 window, then close it. Scheduled runs reuse this profile.");
  await new Promise(resolve => context.once("close", resolve));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, mediaPath, captionPath] = process.argv.slice(2);
  if (command === "login") await login();
  else if (command === "publish") {
    const caption = captionPath ? await fs.readFile(path.resolve(captionPath), "utf8") : "";
    console.log(JSON.stringify(await publish(mediaPath || "", caption)));
  } else throw new Error("Usage: node scripts/instagram-browser-mirror.mjs <login|publish> [media] [caption-file]");
}
