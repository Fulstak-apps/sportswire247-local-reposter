import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { launchBrowser } from "./browser.mjs";
import { collect } from "./collector.mjs";
import { ensureRuntime, listQueue, loadConfig, ollamaHealth, paths, readJson, root, saveItem } from "./lib.mjs";
const execFileAsync = promisify(execFile);
const label = "com.local.sports-reposter";
const plist = path.join(process.env.HOME, "Library", "LaunchAgents", `${label}.plist`);
const uidTarget = `gui/${process.getuid()}`;
const command = process.argv[2];

async function launchctl(...args) { return execFileAsync("launchctl", args).then(x => x.stdout.trim()); }
if (command === "login") {
  const config = await loadConfig(); const context = await launchBrowser(config, false);
  const pages = context.pages(); await pages[0].goto("https://www.instagram.com/");
  console.log("Sign into Instagram as @sportswire247 in this dedicated sports profile. Close Chrome when finished.");
  await new Promise(resolve => context.once("close", resolve));
} else if (command === "baseline") {
  const config = await loadConfig(); console.log(JSON.stringify(await collect(config, { forceBaseline: true }), null, 2));
} else if (command === "start") {
  let loaded = false;
  try { await launchctl("print", `${uidTarget}/${label}`); loaded = true; } catch {}
  if (!loaded) await launchctl("bootstrap", uidTarget, plist);
  // RunAtLoad starts the job. Do not wait on kickstart here: a normal monitor
  // cycle can legitimately spend minutes capturing a source video.
  console.log("Sports reposter scheduled (RunAtLoad); use npm run status to inspect it.");
} else if (command === "stop") {
  await launchctl("bootout", uidTarget, plist).catch(() => {}); console.log("Sports reposter stopped.");
} else if (command === "status") {
  await ensureRuntime(); const config = await loadConfig(); const items = await listQueue(); const ledger = await readJson(paths.ledger, {});
  let service = "not loaded"; try { service = await launchctl("print", `${uidTarget}/${label}`); } catch {}
  console.log(JSON.stringify({ service: service.split("\n").slice(0, 12).join("\n"), ollama: await ollamaHealth(config), baselineComplete: ledger.baselineComplete || false, queue: Object.groupBy(items, x => x.status), counts: Object.fromEntries(Object.entries(Object.groupBy(items, x => x.status)).map(([k,v]) => [k,v.length])) }, null, 2));
} else if (command === "logs") {
  for (const name of ["worker.out.log", "worker.err.log"]) { console.log(`\n${name}`); console.log((await fs.readFile(path.join(paths.logs, name), "utf8").catch(() => "(empty)")).split("\n").slice(-100).join("\n")); }
} else if (command === "retry") {
  const target = process.argv[3]; let count = 0;
  for (const item of await listQueue()) if (!target || item.shortcode === target) { if (item.status !== "published" && item.status !== "ignored_non_video") { item.status = item.publishRequestedAt ? "partially_published" : "pending"; delete item.nextRetryAt; await saveItem(item); count++; } }
  console.log(`Marked ${count} item(s) for safe retry.`);
} else { console.error("Usage: node src/cli.mjs <login|baseline|start|stop|status|logs|retry> [shortcode]"); process.exitCode = 2; }
