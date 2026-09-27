#!/usr/bin/env node
// One-time safe queue migration: rewrite only unpublished items with the new
// concise packaging. Source captions, credit, and all publication receipts stay
// intact.
import fs from "node:fs/promises";
import path from "node:path";
import { composeCaption } from "../src/caption.mjs";

const root = path.resolve(import.meta.dirname, "..");
const queue = path.join(root, "queue");
const files = (await fs.readdir(queue)).filter(file => file.endsWith(".json"));
let changed = 0;
for (const file of files) {
  const target = path.join(queue, file); let item;
  try { item = JSON.parse(await fs.readFile(target, "utf8")); } catch { continue; }
  if (["published", "publishing"].includes(item.status) || !item.sourceCaption || !item.sourceHandle) continue;
  const caption = composeCaption(item.body || item.sourceCaption, item.sourceHandle, { sport: item.sportCategory || "" });
  if (caption === item.publishCaption) continue;
  item.publishCaption = caption; item.captionMode = "specific_source_caption_packaged"; item.captionCheckedAt = new Date().toISOString();
  await fs.writeFile(target, JSON.stringify(item, null, 2) + "\n"); changed++;
}
console.log(JSON.stringify({ refreshed: changed }));
