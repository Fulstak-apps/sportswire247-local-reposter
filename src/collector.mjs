import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchBrowser, discoverVisible, readPost } from "./browser.mjs";
import { paths, readJson, writeJson, saveItem, unseenPosts } from "./lib.mjs";
import { localCaption } from "./caption.mjs";
import { inspectLogoPlacement, sha256 } from "./video-safety.mjs";
const execFileAsync = promisify(execFile);

async function probe(file, ffprobePath = "/opt/homebrew/bin/ffprobe") {
  const { stdout } = await execFileAsync(ffprobePath, ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height:format=duration", "-of", "json", file]);
  return JSON.parse(stdout);
}

export async function brandVideo(config, sourcePath, destinationPath) {
  if (!config.branding?.enabled) throw new Error("SportsWire branding is disabled; refusing an unbranded publish asset.");
  const logoPath = path.resolve(config.branding.logoPath);
  const ffmpegPath = config.ffmpegPath || "/opt/homebrew/bin/ffmpeg"; const ffprobePath = config.ffprobePath || "/opt/homebrew/bin/ffprobe";
  await fs.access(logoPath); const source = await probe(sourcePath, ffprobePath);
  const video = source.streams?.find(stream => stream.codec_type === "video");
  const audio = source.streams?.find(stream => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("Source must contain complete video and audio before branding.");
  const width = Number(video.width); const height = Number(video.height); const duration = Number(source.format?.duration || 0);
  const reviewDirectory = destinationPath.replace(/\.mp4$/i, "-logo-review");
  const { logoWidth, margin, sampledFrames } = await inspectLogoPlacement(sourcePath, { width, height, duration,
    preferredFraction: Number(config.branding.logoWidthFraction || 0.1574), marginFraction: Number(config.branding.marginFraction || 0.0315), directory: reviewDirectory });
  const temp = `${destinationPath}.${process.pid}.tmp.mp4`;
  await execFileAsync(ffmpegPath, ["-y", "-i", sourcePath, "-loop", "1", "-i", logoPath,
    "-filter_complex", `[1:v]scale=${logoWidth}:-1[logo];[0:v][logo]overlay=x=${margin}:y=H-h-${margin}:shortest=1[v]`,
    "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", temp], { timeout: 20 * 60_000, maxBuffer: 4_000_000 });
  const output = await probe(temp, ffprobePath); const outputVideo = output.streams?.find(stream => stream.codec_type === "video"); const outputAudio = output.streams?.find(stream => stream.codec_type === "audio");
  if (outputVideo?.codec_name !== "h264" || outputAudio?.codec_name !== "aac") { await fs.rm(temp, { force: true }); throw new Error("Branded output failed H.264/AAC validation."); }
  if (Math.abs(Number(output.format?.duration) - Number(source.format?.duration)) > 1) { await fs.rm(temp, { force: true }); throw new Error("Branded output duration does not match the full source video."); }
  await fs.rename(temp, destinationPath);
  return { logoPath, logoPosition: "bottom-left", logoWidth, margin, logoApplied: true, contentSafeChecked: true,
    sampledFrames, sourceDuration: Number(source.format?.duration), outputDuration: Number(output.format?.duration),
    sourceSha256: await sha256(sourcePath), outputSha256: await sha256(destinationPath) };
}

export function assembleRanges(parts) {
  const sorted = [...parts].sort((left, right) => left.start - right.start);
  let cursor = 0; const chunks = [];
  for (const part of sorted) {
    if (part.start > cursor) return null;
    const offset = Math.max(0, cursor - part.start);
    if (offset < part.body.length) chunks.push(part.body.subarray(offset));
    cursor = Math.max(cursor, part.start + part.body.length);
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function captureSourceFromBrowser(context, item, outputPath) {
  const page = await context.newPage(); const candidates = [];
  page.on("response", async response => {
    try {
      const headers = await response.allHeaders(); const type = headers["content-type"] || "";
      if (!type.startsWith("video/") && !type.startsWith("audio/") && !/\.(?:mp4|webm)(?:\?|$)/i.test(response.url())) return;
      const body = await response.body(); if (body.length) candidates.push({ url: response.url(), headers, body });
    } catch { /* Responses may disappear while streaming. */ }
  });
  try {
    await page.goto(item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }); await page.waitForTimeout(2500);
    const video = page.locator("video:visible").first(); await video.waitFor({ state: "visible", timeout: 20_000 });
    const visible = await video.evaluate(element => ({ duration: Number(element.duration || 0), width: element.videoWidth, height: element.videoHeight, buffered: element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0 }));
    await video.evaluate(element => { element.muted = false; return element.play().catch(() => { element.muted = true; return element.play(); }); });
    const deadline = Date.now() + Math.min(240_000, Math.max(30_000, (visible.duration + 15) * 1000));
    while (Date.now() < deadline) {
      const progress = await video.evaluate(element => ({ duration: Number(element.duration || 0), buffered: element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0 }));
      if (progress.duration > 0 && progress.buffered >= progress.duration - 0.25) break;
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(1500);
    const groups = new Map();
    for (const candidate of candidates) {
      const parsed = new URL(candidate.url); const range = candidate.headers["content-range"]?.match(/bytes (\d+)-/);
      const start = Number(range?.[1] ?? parsed.searchParams.get("bytestart") ?? 0); parsed.searchParams.delete("bytestart"); parsed.searchParams.delete("byteend");
      const parts = groups.get(parsed.toString()) || []; parts.push({ start, body: candidate.body }); groups.set(parsed.toString(), parts);
    }
    const temp = await fs.mkdtemp(path.join(paths.media, `${item.shortcode}-capture-`));
    try {
      const inputs = [];
      for (const parts of groups.values()) {
        const bytes = assembleRanges(parts); if (!bytes) continue;
        const candidatePath = path.join(temp, `stream-${inputs.length}.mp4`); await fs.writeFile(candidatePath, bytes);
        try {
          const detail = await probe(candidatePath); const duration = Number(detail.format?.duration || 0);
          const hasVideo = detail.streams?.some(stream => stream.codec_type === "video"); const hasAudio = detail.streams?.some(stream => stream.codec_type === "audio");
          if (duration && Math.abs(duration - visible.duration) <= 1) inputs.push({ path: candidatePath, detail, hasVideo, hasAudio });
        } catch { /* Partial fragments are intentionally ignored. */ }
      }
      const combined = inputs.filter(input => input.hasVideo && input.hasAudio);
      if (combined.length === 1) { await fs.copyFile(combined[0].path, outputPath); return; }
      const videoInputs = inputs.filter(input => input.hasVideo); const audioInputs = inputs.filter(input => !input.hasVideo && input.hasAudio);
      if (videoInputs.length !== 1 || audioInputs.length !== 1) throw new Error(`Authenticated browser capture was incomplete or ambiguous (video=${videoInputs.length}, audio=${audioInputs.length}).`);
      await execFileAsync("/opt/homebrew/bin/ffmpeg", ["-y", "-i", videoInputs[0].path, "-i", audioInputs[0].path, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", outputPath]);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  } finally { await page.close(); }
}

export async function downloadOriginal(config, item, activeContext = null) {
  const sourcePath = path.join(paths.media, `${item.shortcode}-source.mp4`);
  const exists = await fs.access(sourcePath).then(() => true).catch(() => false);
  if (!exists) {
    const ownContext = activeContext ? null : await launchBrowser(config, true); const context = activeContext || ownContext;
    try { await captureSourceFromBrowser(context, item, sourcePath); } finally { if (ownContext) await ownContext.close(); }
  }
  item.sourceVideoPath = sourcePath;
  item.localVideoPath = path.join(paths.media, `${item.shortcode}-sportswire247.mp4`);
  item.branding = await brandVideo(config, item.sourceVideoPath, item.localVideoPath);
}

function qualifiesForPopularBackfill(metadata, config) {
  const policy = config.popularBackfill || {}; const age = Date.now() - Date.parse(metadata.publishedAt || "");
  return policy.enabled === true && metadata.isVideo && Number(metadata.viewCount || 0) >= Number(policy.minimumViews || 1_000_000)
    && Number.isFinite(age) && age >= 0 && age <= Number(policy.maximumAgeDays || 30) * 86_400_000;
}

async function queueVideo(config, context, item, metadata, run) {
  Object.assign(item, await localCaption(config, metadata.caption, item.sourceHandle));
  item.sourceViewCount = metadata.viewCount || 0; item.sourcePublishedAt = metadata.publishedAt || null;
  await saveItem(item);
  try { await downloadOriginal(config, item, context); item.status = "pending"; await saveItem(item); run.queued.push(item.shortcode); }
  catch (error) { item.status = "pending"; item.lastError = error.message; item.attempts.download += 1; item.nextRetryAt = new Date(Date.now() + 60_000).toISOString(); await saveItem(item); run.errors.push({ sourceHandle: item.sourceHandle, shortcode: item.shortcode, stage: "download", error: error.message }); }
}

export async function collect(config, { forceBaseline = false } = {}) {
  const ledger = await readJson(paths.ledger, { version: 1, baselineComplete: false, seenShortcodes: {}, runs: [] });
  const baseline = forceBaseline || !ledger.baselineComplete;
  const run = { startedAt: new Date().toISOString(), baseline, discovered: 0, queued: [], errors: [] };
  let backfillsQueued = 0;
  const context = await launchBrowser(config, true);
  try {
    for (const sourceHandle of config.sourceHandles) {
      let posts = [];
      try { posts = await discoverVisible(context, sourceHandle); } catch (error) { run.errors.push({ sourceHandle, stage: "discover", error: error.message }); continue; }
      run.discovered += posts.length;
      // Previously-visible posts are eligible only through this explicit popular/recent lane.
      for (const post of posts) {
        if (backfillsQueued >= Number(config.popularBackfill?.maximumQueuePerCycle || 1)) break;
        const seen = ledger.seenShortcodes[post.shortcode];
        if (!seen?.baseline || seen.backfillCheckedAt) continue;
        try {
          const metadata = await readPost(context, post.url); seen.backfillCheckedAt = new Date().toISOString(); seen.viewCount = metadata.viewCount || 0; seen.publishedAt = metadata.publishedAt || null; await writeJson(paths.ledger, ledger);
          if (!qualifiesForPopularBackfill(metadata, config)) continue;
          const item = { version: 1, shortcode: post.shortcode, sourceHandle, sourceUrl: post.url, sourceCaption: "", publishCaption: "", localVideoPath: "", discoveredAt: new Date().toISOString(), status: "downloading", type: "popular_recent_backfill", attempts: { download: 0, publish: 0 }, publicationResult: null };
          await queueVideo(config, context, item, metadata, run); backfillsQueued += 1;
        } catch (error) { run.errors.push({ sourceHandle, shortcode: post.shortcode, stage: "backfill_review", error: error.message }); }
      }
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
        try { const metadata = await readPost(context, post.url); if (!metadata.isVideo) { item.status = "ignored_non_video"; await saveItem(item); continue; } await queueVideo(config, context, item, metadata, run); }
        catch (error) { item.status = "pending"; item.lastError = error.message; item.attempts.download += 1; item.nextRetryAt = new Date(Date.now() + 60_000).toISOString(); await saveItem(item); run.errors.push({ sourceHandle, shortcode: post.shortcode, stage: "metadata", error: error.message }); }
      }
    }
    if (baseline && !run.errors.some(e => e.stage === "discover")) { ledger.baselineComplete = true; ledger.baselinedAt = new Date().toISOString(); }
  } finally { await context.close(); }
  run.finishedAt = new Date().toISOString(); ledger.runs = [...(ledger.runs || []), run].slice(-250); await writeJson(paths.ledger, ledger);
  return run;
}
