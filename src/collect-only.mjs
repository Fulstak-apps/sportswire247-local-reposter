import fs from "node:fs/promises";
import { collect, downloadOriginal } from "./collector.mjs";
import { ensureRuntime, listQueue, loadConfig, paths, recoverQueueItem, saveItem } from "./lib.mjs";

async function acquire() {
  await fs.mkdir(paths.state, { recursive: true });
  try {
    const old = JSON.parse(await fs.readFile(paths.lock, "utf8"));
    try { process.kill(old.pid, 0); return false; } catch { await fs.rm(paths.lock, { force: true }); }
  } catch {}
  try {
    await fs.writeFile(paths.lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx" });
    return true;
  } catch { return false; }
}

await ensureRuntime();
if (!await acquire()) process.exit(0);
try {
  const config = await loadConfig();
  for (let item of await listQueue()) {
    const recovered = recoverQueueItem(item);
    if (recovered !== item) { item = recovered; await saveItem(item); }
    if (item.status !== "pending" || item.localVideoPath || (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now())) continue;
    try {
      await downloadOriginal(config, item);
      delete item.lastError; delete item.nextRetryAt; await saveItem(item);
    } catch (error) {
      item.attempts.download += 1; item.lastError = error.message;
      item.nextRetryAt = new Date(Date.now() + 300_000).toISOString(); await saveItem(item);
    }
  }
  console.log(JSON.stringify(await collect(config)));
} finally {
  await fs.rm(paths.lock, { force: true });
}
