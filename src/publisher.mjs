import fs from "node:fs/promises";
import { launchBrowser } from "./browser.mjs";
import { gapRemainingMs, listQueue, paths, readJson, retryDelay, saveItem, writeJson } from "./lib.mjs";

function validate(config) {
  if (config.destinations?.facebook && (!/^https:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._-]+/.test(config.facebookPageUrl || "") || config.facebookPageUrl.includes("PASTE_"))) throw new Error("Configure the exact sports facebookPageUrl.");
  if (config.destinations?.instagram && config.instagramHandle !== "sportswire247") throw new Error("instagramHandle must be sportswire247.");
  if (config.destinations?.threads && config.threadsHandle !== "sportswire247") throw new Error("threadsHandle must be sportswire247.");
}
const needle = item => item.publishCaption.slice(0, 100).trim();
async function recentFacebook(page, config, item) {
  await page.goto(config.facebookPageUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }); await page.waitForTimeout(3000);
  const links = await page.locator('a[href*="/videos/"],a[href*="/posts/"],a[href*="story_fbid="]').evaluateAll((nodes, text) => nodes.map(n => ({ href: n.href, text: n.closest('[role="article"]')?.innerText || "" })).filter(x => x.text.includes(text)), needle(item));
  if (!links.length) return null; const permalink = links[0].href; return { postId: permalink.match(/\/(?:videos|posts)\/(\d+)/)?.[1] || new URL(permalink).searchParams.get("story_fbid") || "", permalink, verifiedAt: new Date().toISOString() };
}
async function facebook(page, config, item) {
  let found = await recentFacebook(page, config, item); if (found) return found;
  await page.getByText(/Photo\/video|Create post/i).first().click({ timeout: 20_000 }); const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="file"]').first().setInputFiles(item.localVideoPath); await dialog.locator('[contenteditable="true"]').first().fill(item.publishCaption);
  const button = dialog.getByRole("button", { name: /^Post$/i }); await button.waitFor({ state: "visible", timeout: 120_000 }); await button.click();
  for (let i = 0; i < 18; i++) { await page.waitForTimeout(10_000); found = await recentFacebook(page, config, item); if (found) return found; }
  throw new Error("UNCERTAIN: Facebook Post clicked but no matching sports Page post was verified.");
}
async function recentInstagram(page, config, item) {
  await page.goto(`https://www.instagram.com/${config.instagramHandle}/`, { waitUntil: "domcontentloaded", timeout: 45_000 }); await page.waitForTimeout(2500);
  const links = await page.locator('a[href*="/reel/"],a[href*="/p/"]').evaluateAll(nodes => nodes.slice(0, 8).map(n => n.href));
  for (const permalink of links) { const detail = await page.context().newPage(); try { await detail.goto(permalink, { waitUntil: "domcontentloaded" }); await detail.waitForTimeout(1000); if ((await detail.locator("body").innerText()).includes(needle(item))) return { postId: permalink.match(/\/(?:reel|p)\/([^/]+)/)?.[1] || "", permalink, verifiedAt: new Date().toISOString() }; } finally { await detail.close(); } }
  return null;
}
async function advanceInstagramEditor(page, item, step) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const reelsNotice = page.getByText(/Video posts are now shared as reels/i);
    if (await reelsNotice.count() && await reelsNotice.first().isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /^OK$/i }).last().click();
      await page.waitForTimeout(500);
      continue;
    }
    const next = page.getByRole("button", { name: /^(Next|Continue)$/i }).last();
    if (await next.isVisible().catch(() => false)) { await next.click(); return; }
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${paths.logs}/instagram-upload-${item.shortcode}-step-${step}.png`, fullPage: true }).catch(() => {});
  const controls = await page.locator("button").allTextContents().catch(() => []);
  throw new Error(`Instagram editor did not become ready at step ${step}. Controls: ${JSON.stringify(controls.filter(Boolean).slice(-30))}.`);
}
async function instagram(page, config, item) {
  let found = await recentInstagram(page, config, item); if (found) return found;
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  if (!await page.locator('a[href="/sportswire247/"]').count()) throw new Error("Dedicated sports profile is not signed into Instagram as @sportswire247; refusing to publish.");
  await page.getByRole("link", { name: /Create|New post/i }).first().click({ timeout: 20_000 });
  const choice = page.getByText("Post", { exact: true }); if (await choice.count()) await choice.first().click(); await page.locator('input[type="file"]').first().setInputFiles(item.localVideoPath);
  for (let i = 0; i < 2; i++) await advanceInstagramEditor(page, item, i + 1);
  await page.getByRole("textbox", { name: /caption/i }).fill(item.publishCaption); await page.getByRole("button", { name: /^Share$/i }).click();
  for (let i = 0; i < 18; i++) { await page.waitForTimeout(10_000); found = await recentInstagram(page, config, item); if (found) return found; }
  throw new Error("UNCERTAIN: Instagram Share clicked but no matching @sportswire247 post was verified.");
}
async function recentThreads(page, config, item) {
  await page.goto(`https://www.threads.net/@${config.threadsHandle}`, { waitUntil: "domcontentloaded", timeout: 45_000 }); await page.waitForTimeout(2500);
  const links = await page.locator('a[href*="/post/"]').evaluateAll((nodes, text) => nodes.map(n => ({ href: n.href, text: n.closest('[data-pressable-container="true"]')?.innerText || n.parentElement?.innerText || "" })).filter(x => x.text.includes(text)), needle(item));
  if (!links.length) return null; const permalink = links[0].href; return { postId: permalink.match(/\/post\/([^/?]+)/)?.[1] || "", permalink, verifiedAt: new Date().toISOString() };
}
async function threads(page, config, item) {
  let found = await recentThreads(page, config, item); if (found) return found;
  await page.goto("https://www.threads.net/", { waitUntil: "domcontentloaded" }); await page.getByText(/Start a thread|What's new/i).first().click({ timeout: 20_000 });
  const dialog = page.getByRole("dialog").last(); await dialog.locator('[contenteditable="true"]').first().fill(item.publishCaption); await dialog.locator('input[type="file"]').first().setInputFiles(item.localVideoPath); await dialog.getByRole("button", { name: /^Post$/i }).click();
  for (let i = 0; i < 18; i++) { await page.waitForTimeout(10_000); found = await recentThreads(page, config, item); if (found) return found; }
  throw new Error("UNCERTAIN: Threads Post clicked but no matching @sportswire247 thread was verified.");
}
export async function publishOne(config) {
  validate(config); const state = await readJson(paths.publisher, { lastPublishedAt: null }); const remaining = gapRemainingMs(state.lastPublishedAt, config.postingGapMinutes); if (remaining) return { status: "posting_gap", remainingMs: remaining };
  const item = (await listQueue()).find(x => ["pending", "publishing_uncertain", "partially_published"].includes(x.status) && (!x.nextRetryAt || Date.parse(x.nextRetryAt) <= Date.now()));
  if (!item) return { status: "empty" }; if (!config.publishEnabled) return { status: "publishing_disabled", shortcode: item.shortcode }; if (!item.localVideoPath) return { status: "awaiting_download", shortcode: item.shortcode };
  const enabled = Object.entries(config.destinations || { facebook: true }).filter(([, yes]) => yes).map(([name]) => name); if (!enabled.length) return { status: "no_destinations" };
  item.publicationResult ||= {}; const context = await launchBrowser(config, true);
  try {
    const page = context.pages()[0] || await context.newPage(); const methods = { facebook, instagram, threads };
    for (const destination of enabled) {
      if (item.publicationResult[destination]?.permalink) continue;
      item.status = "publishing_uncertain"; item.uncertainDestination = destination; item.publishRequestedAt = new Date().toISOString(); await saveItem(item);
      try { item.publicationResult[destination] = await methods[destination](page, config, item); item.status = "partially_published"; delete item.uncertainDestination; await saveItem(item); }
      catch (error) { item.attempts.publish += 1; item.lastError = `${destination}: ${error.message}`; item.nextRetryAt = new Date(Date.now() + retryDelay(item.attempts.publish)).toISOString(); await saveItem(item); throw error; }
    }
    item.status = "published"; item.publishedAt = new Date().toISOString(); delete item.lastError; delete item.nextRetryAt; state.lastPublishedAt = item.publishedAt; await saveItem(item); await writeJson(paths.publisher, state); return { status: "published", results: item.publicationResult };
  } finally { await context.close(); }
}
