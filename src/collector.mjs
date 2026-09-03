import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchBrowser, discoverVisible, readPost } from "./browser.mjs";
import { paths, readJson, writeJson, withCredit, saveItem, unseenPosts } from "./lib.mjs";
const execFileAsync = promisify(execFile);

export async function downloadOriginal(config, item) {
  const template = path.join(paths.media, `${item.shortcode}.%(ext)s`);
  const args = ["--no-playlist", "--cookies-from-browser", `chrome:${config.chromeProfileDir}`, "--merge-output-format", "mp4", "-f", "bv*+ba/b", "-o", template, item.sourceUrl];
  await execFileAsync("/opt/homebrew/bin/yt-dlp", args, { timeout: 10 * 60_000, maxBuffer: 2_000_000 });
  const found = (await fs.readdir(paths.media)).find(n => n.startsWith(`${item.shortcode}.`) && /\.(mp4|mov|webm|mkv)$/i.test(n));
  if (!found) throw new Error("yt-dlp completed without a video file");
  item.localVideoPath = path.join(paths.media, found);
}

export async function collect(config, { forceBaseline = false } = {}) {
  const ledger = await readJson(paths.ledger, { version: 1, baselineComplete: false, seenShortcodes: {}, runs: [] });
  const baseline = forceBaseline || !ledger.baselineComplete;
  const run = { startedAt: new Date().toISOString(), baseline, discovered: 0, queued: [], errors: [] };
  const context = await launchBrowser(config, true);
  try {
    for (const sourceHandle of config.sourceHandles) {
      let posts = [];
      try { posts = await discoverVisible(context, sourceHandle); } catch (error) { run.errors.push({ sourceHandle, stage: "discover", error: error.message }); continue; }
      run.discovered += posts.length;
      for (const post of unseenPosts(ledger, posts)) {
        // Record first, durably: baseline posts and failed new posts can never be mistaken for one another.
        ledger.seenShortcodes[post.shortcode] = { sourceHandle, sourceUrl: post.url, firstSeenAt: new Date().toISOString(), baseline };
        await writeJson(paths.ledger, ledger);
        if (baseline) continue;
        let item = {
          version: 1, shortcode: post.shortcode, sourceHandle, sourceUrl: post.url,
          sourceCaption: "", publishCaption: "", localVideoPath: "", discoveredAt: new Date().toISOString(),
          status: "downloading", attempts: { download: 0, publish: 0 }, publicationResult: null
        };
        await saveItem(item);
        try {
          const metadata = await readPost(context, post.url);
          if (!metadata.isVideo) { item.status = "ignored_non_video"; await saveItem(item); continue; }
          item.sourceCaption = metadata.caption;
          item.publishCaption = withCredit(metadata.caption, sourceHandle);
          await downloadOriginal(config, item);
          item.status = "pending";
          await saveItem(item);
          run.queued.push(post.shortcode);
        } catch (error) {
          item.status = "pending"; item.lastError = error.message; item.attempts.download += 1;
          item.nextRetryAt = new Date(Date.now() + 60_000).toISOString(); await saveItem(item);
          run.errors.push({ sourceHandle, shortcode: post.shortcode, stage: "download", error: error.message });
        }
      }
    }
    if (baseline && !run.errors.some(e => e.stage === "discover")) { ledger.baselineComplete = true; ledger.baselinedAt = new Date().toISOString(); }
  } finally { await context.close(); }
  run.finishedAt = new Date().toISOString(); ledger.runs = [...(ledger.runs || []), run].slice(-250); await writeJson(paths.ledger, ledger);
  return run;
}
