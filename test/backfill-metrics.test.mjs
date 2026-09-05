import test from "node:test";
import assert from "node:assert/strict";
import { qualifiesForPopularBackfill } from "../src/collector.mjs";

const config = {
  popularBackfill: {
    enabled: true,
    minimumViews: 1_000_000,
    minimumLikes: 100_000,
    minimumComments: 10_000,
    maximumAgeDays: 30,
  },
};

function metadata(overrides = {}) {
  return {
    isVideo: true,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    publishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

test("viral likes can qualify a backfill when views are hidden", () => {
  assert.equal(qualifiesForPopularBackfill(metadata({ likeCount: 150_000 }), config), true);
});

test("viral comments can qualify a backfill when views are hidden", () => {
  assert.equal(qualifiesForPopularBackfill(metadata({ commentCount: 12_000 }), config), true);
});

test("weak engagement does not qualify a backfill", () => {
  assert.equal(qualifiesForPopularBackfill(metadata({ likeCount: 20_000, commentCount: 500 }), config), false);
});
