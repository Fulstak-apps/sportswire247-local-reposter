import fs from "node:fs/promises";
import { chromium } from "playwright-core";
import { expandHome } from "./lib.mjs";

export async function launchBrowser(config, headless = true) {
  const dir = expandHome(config.chromeProfileDir);
  await fs.mkdir(dir, { recursive: true });
  return chromium.launchPersistentContext(dir, {
    executablePath: config.chromeExecutable,
    headless, viewport: { width: 1280, height: 900 }, acceptDownloads: true
  });
}

export async function discoverVisible(context, handle) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3000);
    if (/\/accounts\/login/.test(page.url())) throw new Error("Instagram viewing profile is not signed in; run npm run login.");
    const hrefs = await page.locator('a[href*="/reel/"],a[href*="/p/"]').evaluateAll(nodes => nodes.map(n => n.href));
    return [...new Set(hrefs)].map(url => ({ url, shortcode: url.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)?.[1] })).filter(x => x.shortcode);
  } finally { await page.close(); }
}

export async function readPost(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);
    const isVideo = await page.locator("video").count() > 0;
    const description = await page.locator('meta[property="og:description"]').getAttribute("content").catch(() => "") || "";
    const title = await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => "") || "";
    // Instagram's OG text normally wraps the exact caption in quotes. Keep it verbatim when present.
    const quoted = title.match(/^[^:]+:\s*[“\"]([\s\S]*)[”\"]$/)?.[1];
    const caption = quoted || description.match(/^[^:]+:\s*[“\"]([\s\S]*)[”\"]/)?.[1] || title;
    const pageText = await page.locator("body").innerText().catch(() => "");
    const viewMatch = `${description}\n${pageText}`.match(/([\d,.]+)\s*([KMB])?\s+views?\b/i);
    const rawViews = Number(viewMatch?.[1]?.replace(/,/g, "") || 0);
    const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[String(viewMatch?.[2] || "").toLowerCase()] || 1;
    const publishedAt = await page.locator("time[datetime]").first().getAttribute("datetime").catch(() => "");
    return { isVideo, caption: String(caption || "").trim(), viewCount: Math.round(rawViews * multiplier), publishedAt: publishedAt || null };
  } finally { await page.close(); }
}
