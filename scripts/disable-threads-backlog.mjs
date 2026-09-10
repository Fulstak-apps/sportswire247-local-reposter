import fs from "node:fs/promises";
import path from "node:path";

const queueDir = "queue";
const disabledAt = new Date().toISOString();
let migrated = 0;
for (const name of await fs.readdir(queueDir)) {
  if (!name.endsWith(".json")) continue;
  const file = path.join(queueDir, name);
  const item = JSON.parse(await fs.readFile(file, "utf8"));
  if (item.status !== "instagram_published_threads_pending") continue;
  item.status = "published";
  item.publishedAt ||= item.instagramVerifiedAt || disabledAt;
  item.threadsStatus = "disabled";
  item.threadsDisabledAt = disabledAt;
  item.threadsDisabledReason = "Threads delivery removed from SportsWire";
  await fs.writeFile(file, JSON.stringify(item, null, 2) + "\n");
  migrated++;
}
console.log(JSON.stringify({ migrated, disabledAt }));
