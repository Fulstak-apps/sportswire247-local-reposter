import test from "node:test";
import assert from "node:assert/strict";
import { eligible, platformEligible, retryAt } from "../scripts/publish-sportswire-meta.mjs";
import { chooseSafeLogo } from "../src/video-safety.mjs";

const valid = { status: "ready", destinationHandle: "sportswire247", brand: "SportsWire 247", video: "media/x.mp4", sourceUrl: "https://instagram.com/reel/x/", shortcode: "x", publishCaption: "Caption\n\n@sportswire247" };
test("publisher accepts only complete SportsWire queue records", () => {
  assert.equal(eligible(valid), true);
  assert.equal(eligible({ ...valid, status: "instagram_published_threads_pending", instagramVerifiedAt: new Date().toISOString() }), true);
  assert.equal(eligible({ ...valid, video: "" }), false);
  assert.equal(eligible({ ...valid, brand: "RapWire 24/7" }), false);
  assert.equal(eligible({ ...valid, destinationHandle: "rapwire247" }), false);
});
test("rate-limit cooldown grows exponentially and stays bounded", () => {
  const now = Date.parse("2026-09-03T00:00:00Z");
  assert.equal(Date.parse(retryAt(1, now)) - now, 120000);
  assert.ok(Date.parse(retryAt(20, now)) - now <= 6 * 3600000);
});
test("continuous cadence waits 24 minutes and enforces rolling daily cap", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  const history = minutes => [{item: {instagramVerifiedAt: new Date(now - minutes * 60000).toISOString()}}];
  assert.equal(platformEligible(valid, "instagram", history(23), now, 60), false);
  assert.equal(platformEligible(valid, "instagram", history(24), now, 60), true);
  const full = Array.from({length:60}, (_, i) => ({item:{instagramVerifiedAt:new Date(now - (i + 25) * 60000).toISOString()}}));
  assert.equal(platformEligible(valid, "instagram", full, now, 60), false);
  assert.equal(platformEligible(valid, "threads", full, now, 60), true);
});
test("Instagram and Threads cooldowns and quotas are independent", () => {
  const now = Date.parse("2026-09-03T00:00:00Z");
  const item = { ...valid, instagramNextRetryAt: new Date(now + 60_000).toISOString() };
  assert.equal(platformEligible(item, "instagram", [], now, 20), false);
  assert.equal(platformEligible(item, "threads", [], now, 20), true);
  const history = [{ item: { threadsVerifiedAt: new Date(now - 1_000).toISOString() } }];
  assert.equal(platformEligible(valid, "threads", history, now, 20), false);
});
test("five-frame logo placement shrinks around detected text and fails closed", () => {
  const empty = Array.from({ length: 5 }, () => ({ text: [], faces: [] }));
  assert.ok(chooseSafeLogo(1080, 1920, empty).logoWidth > 100);
  const blocked = Array.from({ length: 5 }, () => ({ text: [{ confidence: .99, box: { x: 0, y: .75, width: .4, height: .25 } }], faces: [] }));
  assert.throws(() => chooseSafeLogo(1080, 1920, blocked), /review required/i);
});
