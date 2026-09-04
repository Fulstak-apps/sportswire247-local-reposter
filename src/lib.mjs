import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const runtime = path.join(root, "runtime");
export const paths = {
  queue: path.join(runtime, "queue"), media: path.join(runtime, "media"), state: path.join(runtime, "state"),
  logs: path.join(runtime, "logs"), ledger: path.join(runtime, "state", "ledger.json"),
  publisher: path.join(runtime, "state", "publisher.json"), lock: path.join(runtime, "state", "worker.lock")
};

export function expandHome(value) { return String(value || "").replace(/^~(?=\/|$)/, os.homedir()); }
export async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return structuredClone(fallback); }
}
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temp, file);
}
export async function ensureRuntime() { await Promise.all(Object.values(paths).filter(p => !path.extname(p)).map(p => fs.mkdir(p, { recursive: true }))); }
export function shortcodeFromUrl(url) { return String(url).match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)?.[1] || ""; }
export function normalizeHandle(value) { return String(value).trim().replace(/^@/, "").toLowerCase(); }
export function withCredit(caption, handle) {
  const clean = String(caption || "").trim();
  const credit = `Source: @${normalizeHandle(handle)}`;
  return clean.endsWith(credit) ? clean : `${clean}${clean ? "\n\n" : ""}${credit}`;
}
export function gapRemainingMs(lastPublishedAt, gapMinutes, now = Date.now()) {
  if (!lastPublishedAt) return 0;
  return Math.max(0, Date.parse(lastPublishedAt) + Number(gapMinutes) * 60_000 - now);
}
export async function loadConfig() {
  const file = path.join(root, "config.json");
  const config = await readJson(file, null);
  if (!config) throw new Error(`Missing ${file}; copy config.example.json to config.json and configure it.`);
  config.sourceHandles = [...new Set((config.sourceHandles || []).map(normalizeHandle).filter(Boolean))];
  config.chromeProfileDir = expandHome(config.chromeProfileDir);
  if (!config.sourceHandles.length || config.sourceHandles.some(h => h.includes("paste_"))) throw new Error("Configure sourceHandles in config.json.");
  return config;
}
export async function listQueue() {
  await fs.mkdir(paths.queue, { recursive: true });
  const names = (await fs.readdir(paths.queue)).filter(n => n.endsWith(".json")).sort();
  return Promise.all(names.map(n => readJson(path.join(paths.queue, n))));
}
export async function saveItem(item) { await writeJson(path.join(paths.queue, `${item.shortcode}.json`), item); }
export function retryDelay(attempts) { return Math.min(6 * 3600_000, Math.max(60_000, 2 ** Math.min(Number(attempts || 0), 8) * 60_000)); }
export function unseenPosts(ledger, posts) { return posts.filter(post => !ledger.seenShortcodes?.[post.shortcode]); }
export function recoverQueueItem(item) {
  if (["downloading", "publishing"].includes(item.status)) return { ...item, status: item.localVideoPath ? "pending" : "pending", recoveredAt: new Date().toISOString() };
  return item;
}
export function processIsAlive(pid, probe = value => process.kill(value, 0)) { try { probe(pid); return true; } catch { return false; } }
export async function ollamaHealth(config) {
  if (!config.ollama?.enabled) return { enabled: false, available: false };
  try {
    const response = await fetch(`${config.ollama.url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); const models = (data.models || []).map(entry => entry.name);
    return { enabled: true, available: true, configuredModel: config.ollama.model, modelInstalled: models.includes(config.ollama.model), models };
  } catch (error) { return { enabled: true, available: false, configuredModel: config.ollama.model, error: error.message }; }
}
