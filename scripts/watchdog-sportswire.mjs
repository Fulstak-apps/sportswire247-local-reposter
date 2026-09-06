import fs from "node:fs/promises";
import path from "node:path";

const queueDir = "queue";
const logsDir = "logs";
const transient = /(timeout|timed out|http 5|temporar|container .* failed|did not finish|fetch failed|network|503|502|429)/i;

const now = Date.now();
const names = (await fs.readdir(queueDir).catch(() => [])).filter(x => x.endsWith(".json"));
const records = [];
for (const name of names) {
  try { records.push({ name, file: path.join(queueDir, name), item: JSON.parse(await fs.readFile(path.join(queueDir, name), "utf8")) }); } catch {}
}

let stale = 0;
let released = 0;
for (const record of records) {
  const item = record.item;
  if (item.status === "ready") stale++;
  for (const platform of ["instagram", "threads"]) {
    const error = String(item[`${platform}Error`] || "");
    const retryAt = Date.parse(item[`${platform}NextRetryAt`] || "") || 0;
    // A failed, non-uncertain request may be retried immediately once its
    // cooldown expires. Publish-requested records are never touched: they
    // require reconciliation so this watchdog can never double-post.
    if (error && transient.test(error) && retryAt && retryAt <= now && !item[`${platform}PublishRequestedAt`] && !item[`${platform}MediaId`]) {
      delete item[`${platform}NextRetryAt`];
      item[`${platform}WatchdogRetryAt`] = new Date().toISOString();
      await fs.writeFile(record.file, JSON.stringify(item, null, 2) + "\n");
      released++;
    }
  }
}

await fs.mkdir(logsDir, { recursive: true });
await fs.writeFile(path.join(logsDir, "watchdog.json"), JSON.stringify({
  checkedAt: new Date().toISOString(),
  readyItems: stale,
  transientRetriesReleased: released,
  action: stale ? "backup publisher pass requested" : "queue empty; collector must refill",
}, null, 2) + "\n");
console.log(JSON.stringify({ readyItems: stale, transientRetriesReleased: released }));
