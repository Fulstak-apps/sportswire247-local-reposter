import test from "node:test";
import assert from "node:assert/strict";
import { gapRemainingMs, processIsAlive, recoverQueueItem, unseenPosts, withCredit } from "../src/lib.mjs";
import { assembleRanges } from "../src/collector.mjs";

test("deduplicates Instagram posts by shortcode", () => {
  const ledger = { seenShortcodes: { AAA: { firstSeenAt: "earlier" } } };
  assert.deepEqual(unseenPosts(ledger, [{ shortcode: "AAA" }, { shortcode: "BBB" }]), [{ shortcode: "BBB" }]);
});
test("recovers an interrupted download as pending without completing it", () => {
  const result = recoverQueueItem({ shortcode: "AAA", status: "downloading", localVideoPath: "" });
  assert.equal(result.status, "pending"); assert.equal(result.publishedAt, undefined);
});
test("enforces the ten-minute publication gap", () => {
  const now = Date.parse("2026-09-03T12:05:00Z");
  assert.equal(gapRemainingMs("2026-09-03T12:00:00Z", 10, now), 300_000);
  assert.equal(gapRemainingMs("2026-09-03T11:50:00Z", 10, now), 0);
});
test("restart logic distinguishes live and stale worker pids", () => {
  assert.equal(processIsAlive(12, () => {}), true);
  assert.equal(processIsAlive(12, () => { throw new Error("ESRCH"); }), false);
});
test("caption is preserved and source credit is appended", () => {
  assert.equal(withCredit("Exact caption", "SourceOne"), "Exact caption\n\nSource: @sourceone");
});
test("reassembles browser media ranges without gaps", () => {
  const result = assembleRanges([{ start: 3, body: Buffer.from("def") }, { start: 0, body: Buffer.from("abc") }]);
  assert.equal(result.toString(), "abcdef");
  assert.equal(assembleRanges([{ start: 3, body: Buffer.from("def") }]), null);
});
