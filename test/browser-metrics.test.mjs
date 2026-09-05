import test from "node:test";
import assert from "node:assert/strict";
import { parseSocialCount } from "../src/browser.mjs";

test("parses Instagram shorthand engagement metrics", () => {
  const text = "1.2M views 87.4K likes 3,219 comments";
  assert.equal(parseSocialCount(text, "view"), 1_200_000);
  assert.equal(parseSocialCount(text, "like"), 87_400);
  assert.equal(parseSocialCount(text, "comment"), 3_219);
});

test("returns zero when a metric is hidden", () => {
  assert.equal(parseSocialCount("87K likes · SportsCenter", "view"), 0);
  assert.equal(parseSocialCount("87K likes · SportsCenter", "like"), 87_000);
});
