import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);

export function overlaps(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

export function chooseSafeLogo(width, height, observations, preferredFraction = 0.1574, marginFraction = 0.0315) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || observations.length < 5) throw new Error("Five-frame logo safety evidence required");
  const boxes = observations.flatMap(frame => [
    ...(frame.faces || []),
    ...(frame.text || []).filter(item => item.confidence >= 0.45).map(item => item.box)
  ]);
  for (const fraction of [preferredFraction, 0.12, 0.09]) {
    const pixels = Math.max(72, Math.round(width * fraction));
    const margin = Math.max(12, Math.round(width * marginFraction));
    const bottomMargin = Math.max(margin, Math.round(height * 0.15));
    const logo = { x: margin / width, y: (height - pixels - bottomMargin) / height, width: pixels / width, height: pixels / height };
    if (boxes.every(box => !overlaps(box, logo))) return { logoWidth: pixels, margin, bottomMargin, sampledFrames: observations.length };
  }
  throw new Error("Media review required: bottom-left SportsWire logo would cover detected text or a face");
}

export function parseTesseractTsv(tsv, width, height) {
  const text = [];
  for (const row of String(tsv).split(/\r?\n/).slice(1)) {
    const cells = row.split("\t");
    if (cells.length < 12 || Number(cells[0]) !== 5) continue;
    const confidence = Number(cells[10]); const phrase = cells.slice(11).join("\t").trim();
    if (!phrase || !Number.isFinite(confidence) || confidence < 45) continue;
    const [x, y, boxWidth, boxHeight] = cells.slice(6, 10).map(Number);
    if ([x, y, boxWidth, boxHeight].every(Number.isFinite)) {
      text.push({ confidence: confidence / 100, box: { x: x / width, y: y / height, width: boxWidth / width, height: boxHeight / height } });
    }
  }
  return text;
}

export async function inspectLogoPlacement(input, { width, height, duration, preferredFraction, marginFraction, directory, ffmpegPath = "ffmpeg" }) {
  const times = [0.03, 0.25, 0.5, 0.75, 0.9].map(f => Math.max(0, duration * f));
  await fs.mkdir(directory, { recursive: true });
  const images = [];
  for (const [index, time] of times.entries()) {
    const image = path.join(directory, `source-${index + 1}.png`);
    await exec(ffmpegPath, ["-v", "error", "-y", "-ss", String(time), "-i", input, "-frames:v", "1", image], { timeout: 30_000 });
    if (!(await fs.stat(image).then(info => info.size > 0).catch(() => false))) throw new Error(`Could not sample source frame ${index + 1}; refusing unsafe logo placement.`);
    images.push(image);
  }
  const swift = path.resolve("scripts/inspect-video-frame.swift");
  const swiftPath = process.env.SWIFT_PATH ? path.join(process.env.SWIFT_PATH, "swift") : "swift";
  let observations; let inspectionMethod = "apple_vision_text_and_face";
  try {
    const { stdout } = await exec(swiftPath, [swift, ...images], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    observations = JSON.parse(stdout);
  } catch (error) {
    // Swift/Vision may be unavailable on otherwise valid Macs that have not
    // accepted Apple's developer-tools license. Keep the caption-safe check
    // operational with local Tesseract OCR; never skip frame sampling or text
    // overlap checks. This fallback does not claim face detection.
    const tesseract = process.env.TESSERACT_PATH || "tesseract";
    observations = [];
    for (const image of images) {
      const { stdout } = await exec(tesseract, [image, "stdout", "tsv"], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
      observations.push({ text: parseTesseractTsv(stdout, width, height), faces: [] });
    }
    inspectionMethod = "tesseract_five_frame_text_only";
    if (observations.length !== 5) throw new Error(`Five-frame text inspection failed; Swift error: ${error.message}`);
  }
  const plan = chooseSafeLogo(width, height, observations, preferredFraction, marginFraction);
  await fs.writeFile(path.join(directory, "logo-safety.json"), JSON.stringify({ times, observations, plan, inspectionMethod, faceDetectionAvailable: inspectionMethod === "apple_vision_text_and_face" }, null, 2) + "\n");
  return { ...plan, inspectionMethod, faceDetectionAvailable: inspectionMethod === "apple_vision_text_and_face" };
}

export async function sha256(filename) {
  const hash = createHash("sha256"); hash.update(await fs.readFile(filename)); return hash.digest("hex");
}
