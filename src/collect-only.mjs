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
  const recoverable = (await listQueue())
    .filter(item => ["pending", "downloading"].includes(item.status))
    .sort((a, b) => Date.parse(b.sourcePublishedAt || b.discoveredAt || 0) - Date.parse(a.sourcePublishedAt || a.discoveredAt || 0));
  let recoveryAttempts = 0;
  for (let item of recoverable) {
    const recovered = recoverQueueItem(item);
    if (recovered !== item) { item = recovered; await saveItem(item); }
    if (item.status !== "pending" || (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now())) continue;
    if (item.localVideoPath && item.branding?.logoApplied && await fs.access(item.localVideoPath).then(() => true).catch(() => false)) continue;
    if (recoveryAttempts >= 5) break;
    recoveryAttempts++;
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
