import fs from "node:fs/promises";
import { collect, downloadOriginal } from "./collector.mjs";
import { publishOne } from "./publisher.mjs";
import { ensureRuntime, listQueue, loadConfig, ollamaHealth, paths, recoverQueueItem, saveItem } from "./lib.mjs";

async function lock() {
  await fs.mkdir(paths.state, { recursive: true });
  try {
    const old = JSON.parse(await fs.readFile(paths.lock, "utf8"));
    try { process.kill(old.pid, 0); return false; } catch {}
    await fs.rm(paths.lock, { force: true });
  } catch {}
  try { await fs.writeFile(paths.lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx" }); return true; }
  catch { return false; }
}
await ensureRuntime();
if (!await lock()) process.exit(0);
try {
  const config = await loadConfig();
  // Recover downloads before discovery. A failed file always remains pending.
  for (let item of await listQueue()) {
    const recovered = recoverQueueItem(item); if (recovered !== item) { item = recovered; await saveItem(item); }
    if (item.status !== "pending" || item.localVideoPath || (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now())) continue;
    try { await downloadOriginal(config, item); delete item.lastError; delete item.nextRetryAt; await saveItem(item); }
    catch (error) { item.attempts.download += 1; item.lastError = error.message; item.nextRetryAt = new Date(Date.now() + 300_000).toISOString(); await saveItem(item); }
  }
  const collection = await collect(config);
  let publication;
  try { publication = await publishOne(config); } catch (error) { publication = { status: "error", error: error.message }; }
  console.log(JSON.stringify({ at: new Date().toISOString(), ollama: await ollamaHealth(config), collection, publication }));
} finally { await fs.rm(paths.lock, { force: true }); }
