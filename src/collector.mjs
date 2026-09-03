import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchBrowser, discoverVisible, readPost } from "./browser.mjs";
import { paths, readJson, writeJson, withCredit, saveItem, unseenPosts } from "./lib.mjs";
const execFileAsync = promisify(execFile);

async function probe(file) {
  const { stdout } = await execFileAsync("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height:format=duration", "-of", "json", file]);
  return JSON.parse(stdout);
}

export async function brandVideo(config, sourcePath, destinationPath) {
  if (!config.branding?.enabled) throw new Error("SportsWire branding is disabled; refusing an unbranded publish asset.");
  const logoPath = path.resolve(config.branding.logoPath);
  await fs.access(logoPath); const source = await probe(sourcePath);
  const video = source.streams?.find(stream => stream.codec_type === "video");
  const audio = source.streams?.find(stream => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("Source must contain complete video and audio before branding.");
  const width = Number(video.width); const logoWidth = Math.max(96, Math.round(width * Number(config.branding.logoWidthFraction || 0.1574)));
  const margin = Math.max(18, Math.round(width * Number(config.branding.marginFraction || 0.0315)));
  const temp = `${destinationPath}.${process.pid}.tmp.mp4`;
  await execFileAsync("/opt/homebrew/bin/ffmpeg", ["-y", "-i", sourcePath, "-loop", "1", "-i", logoPath,
    "-filter_complex", `[1:v]scale=${logoWidth}:-1[logo];[0:v][logo]overlay=x=${margin}:y=H-h-${margin}:shortest=1[v]`,
    "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", temp], { timeout: 20 * 60_000, maxBuffer: 4_000_000 });
  const output = await probe(temp); const outputVideo = output.streams?.find(stream => stream.codec_type === "video"); const outputAudio = output.streams?.find(stream => stream.codec_type === "audio");
  if (outputVideo?.codec_name !== "h264" || outputAudio?.codec_name !== "aac") { await fs.rm(temp, { force: true }); throw new Error("Branded output failed H.264/AAC validation."); }
  if (Math.abs(Number(output.format?.duration) - Number(source.format?.duration)) > 1) { await fs.rm(temp, { force: true }); throw new Error("Branded output duration does not match the full source video."); }
  await fs.rename(temp, destinationPath);
  return { logoPath, logoPosition: "bottom-left", logoWidth, margin, sourceDuration: Number(source.format?.duration), outputDuration: Number(output.format?.duration) };
}

export async function downloadOriginal(config, item) {
  const template = path.join(paths.media, `${item.shortcode}-source.%(ext)s`);
  let found = (await fs.readdir(paths.media)).find(n => n.startsWith(`${item.shortcode}-source.`) && /\.(mp4|mov|webm|mkv)$/i.test(n));
  if (!found) {
    const args = ["--no-playlist", "--cookies-from-browser", `chrome:${config.chromeProfileDir}`, "--merge-output-format", "mp4", "-f", "bv*+ba/b", "-o", template, item.sourceUrl];
    await execFileAsync("/opt/homebrew/bin/yt-dlp", args, { timeout: 10 * 60_000, maxBuffer: 2_000_000 });
    found = (await fs.readdir(paths.media)).find(n => n.startsWith(`${item.shortcode}-source.`) && /\.(mp4|mov|webm|mkv)$/i.test(n));
  }
  if (!found) throw new Error("yt-dlp completed without a video file");
  item.sourceVideoPath = path.join(paths.media, found);
  item.localVideoPath = path.join(paths.media, `${item.shortcode}-sportswire247.mp4`);
  item.branding = await brandVideo(config, item.sourceVideoPath, item.localVideoPath);
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
