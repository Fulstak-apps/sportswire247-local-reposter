import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { brandVideo } from "../src/collector.mjs";
const run = promisify(execFile);

test("brands the full video bottom-left and preserves audio", { skip: process.platform !== "darwin" && "Vision-based frame review runs on the Mac worker" }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sportswire-brand-test-"));
  try {
    const source = path.join(dir, "source.mp4"); const output = path.join(dir, "output.mp4");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=1080x1350:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", source]);
    const result = await brandVideo({ ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", branding: { enabled: true, logoPath: "assets/sportswire247-logo.png", logoWidthFraction: 0.1574, marginFraction: 0.0315 } }, source, output);
    assert.equal(result.logoPosition, "bottom-left"); assert.equal(result.logoWidth, 170); assert.equal(result.margin, 34);
    assert.ok(Math.abs(result.outputDuration - result.sourceDuration) <= 1); assert.ok((await fs.stat(output)).size > 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
