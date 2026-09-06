import fs from "node:fs/promises";
import path from "node:path";

const queueDir = "queue";
const logsDir = "logs";
const repository = process.env.GITHUB_REPOSITORY || "";
const refName = process.env.GITHUB_REF_NAME || "main";
const instagram = { name: "instagram", token: process.env.INSTAGRAM_ACCESS_TOKEN, userId: process.env.INSTAGRAM_USER_ID, base: "https://graph.instagram.com" };
const threads = { name: "threads", token: process.env.THREADS_ACCESS_TOKEN, userId: process.env.THREADS_USER_ID, base: "https://graph.threads.net/v1.0" };
const minimumGapMs = Number(process.env.MINIMUM_FEED_GAP_MINUTES || 30) * 60_000;

export function credentialsReady(platform) { return Boolean(platform.token && platform.userId); }
export function mediaUrl(item) {
  const base = String(process.env.MEDIA_BASE_URL || "").replace(/\/$/, "");
  if (base) return `${base}/${item.video}`;
  return `https://raw.githubusercontent.com/${repository}/${refName}/${item.video}`;
}
export function eligible(item, now = Date.now()) {
  if (!["ready", "instagram_published_threads_pending", "threads_published_instagram_pending"].includes(item.status) || item.destinationHandle !== "sportswire247" || item.brand !== "SportsWire 247") return false;
  if (!item.video || !item.sourceUrl || !item.shortcode || !item.publishCaption?.endsWith("@sportswire247")) return false;
  return true;
}
export function retryAt(attempt, now = Date.now()) { return new Date(now + Math.min(6 * 3600_000, 2 ** Math.min(attempt, 8) * 60_000)).toISOString(); }
export function platformEligible(item, platformName, records = [], now = Date.now(), dailyLimit = 20) {
  if (!eligible(item, now) || item[`${platformName}VerifiedAt`]) return false;
  if (item[`${platformName}PublishRequestedAt`] && !item[`${platformName}MediaId`]) return false;
  const retry = Date.parse(item[`${platformName}NextRetryAt`] || "") || 0;
  if (retry > now) return false;
  const verified = records.flatMap(record => {
    const at = Date.parse(record.item?.[`${platformName}VerifiedAt`] || record.item?.[`${platformName}PublishRequestedAt`] || "") || 0;
    return at ? [at] : [];
  });
  if (verified.length && now - Math.max(...verified) < minimumGapMs) return false;
  return verified.filter(at => now - at < 86_400_000).length < dailyLimit;
}

async function save(file, item) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(item, null, 2) + "\n");
  await fs.rename(temporary, file);
}
async function graph(platform, endpoint, fields, item, stage) {
  const response = await fetch(`${platform.base}/${platform.userId}/${endpoint}`, { method: "POST", body: new URLSearchParams({ ...fields, access_token: platform.token }), signal: AbortSignal.timeout(90_000) });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.code = payload.error?.code; error.stage = stage; throw error;
  }
  return payload;
}
async function inspect(platform, id) {
  const fields = platform.name === "instagram" ? "status_code,status" : "status,error_message";
  const url = new URL(`${platform.base}/${id}`); url.searchParams.set("fields", fields); url.searchParams.set("access_token", platform.token);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }); return response.json();
}
async function waitReady(platform, id) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await inspect(platform, id);
    const status = String(state.status_code || state.status || "").toUpperCase();
    if (["FINISHED", "PUBLISHED"].includes(status)) return;
    if (["ERROR", "EXPIRED"].includes(status)) throw new Error(`${platform.name} container ${id} failed: ${state.error_message || status}`);
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
  throw new Error(`${platform.name} container ${id} did not finish`);
}
async function verify(platform, mediaId) {
  const url = new URL(`${platform.base}/${mediaId}`); url.searchParams.set("fields", "id,permalink"); url.searchParams.set("access_token", platform.token);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }); const payload = await response.json();
  if (!response.ok || String(payload.id) !== String(mediaId) || !payload.permalink) throw new Error(`${platform.name} media verification failed`);
  return { mediaId: payload.id, permalink: payload.permalink, verifiedAt: new Date().toISOString() };
}

export function reconciliationMatch(item, platformName, posts) {
  const text = platformName === 'instagram' ? item.publishCaption : item.threadsText || item.publishCaption;
  const requested = Date.parse(item[`${platformName}PublishRequestedAt`]);
  const matches = posts.filter(post => post.id && post.permalink &&
    (post.caption ?? post.text) === text &&
    Math.abs(Date.parse(post.timestamp) - requested) <= 10 * 60_000);
  return matches.length === 1 ? matches[0] : null;
}

async function reconcile(platform, record) {
  const url = new URL(`${platform.base}/${platform.userId}/${platform.name === 'instagram' ? 'media' : 'threads'}`);
  url.searchParams.set('fields', platform.name === 'instagram' ? 'id,caption,timestamp,permalink' : 'id,text,timestamp,permalink');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', platform.token);
  const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error('Recent publications could not be checked');
  const match = reconciliationMatch(record.item, platform.name, payload.data || []);
  if (match) {
    const result = await verify(platform, match.id);
    record.item[`${platform.name}MediaId`] = result.mediaId;
    record.item[`${platform.name}Permalink`] = result.permalink;
    record.item[`${platform.name}VerifiedAt`] = result.verifiedAt;
    record.item.status = record.item.instagramVerifiedAt && record.item.threadsVerifiedAt ? 'published' : record.item.instagramVerifiedAt ? 'instagram_published_threads_pending' : 'threads_published_instagram_pending';
  } else record.item[`${platform.name}ReconcileRequired`] = true;
  await save(record.file, record.item);
}
async function publishPlatform(platform, item, file) {
  const prefix = platform.name;
  if (item[`${prefix}MediaId`]) return verify(platform, item[`${prefix}MediaId`]);
  if (!item[`${prefix}ContainerId`]) {
    const fields = prefix === "instagram"
      ? { media_type: "REELS", video_url: mediaUrl(item), caption: item.publishCaption, share_to_feed: "true" }
      : { media_type: "VIDEO", video_url: mediaUrl(item), text: item.threadsText || item.publishCaption };
    const created = await graph(platform, prefix === "instagram" ? "media" : "threads", fields, item, "create");
    item[`${prefix}ContainerId`] = created.id; item[`${prefix}ContainerCreatedAt`] = new Date().toISOString(); await save(file, item);
  }
  await waitReady(platform, item[`${prefix}ContainerId`]);
  // Persist the publish request before the non-idempotent action. Any failure
  // after this point requires reconciliation, never blind repetition.
  item[`${prefix}PublishRequestedAt`] = new Date().toISOString(); await save(file, item);
  const published = await graph(platform, prefix === "instagram" ? "media_publish" : "threads_publish", { creation_id: item[`${prefix}ContainerId`] }, item, "publish");
  item[`${prefix}MediaId`] = published.id; await save(file, item);
  return verify(platform, published.id);
}

async function main() {
  await fs.mkdir(logsDir, { recursive: true });
  const names = (await fs.readdir(queueDir).catch(() => [])).filter(name => name.endsWith(".json")).sort();
  const records = await Promise.all(names.map(async name => ({ name, file: path.join(queueDir, name), item: JSON.parse(await fs.readFile(path.join(queueDir, name), "utf8")) })));
  const limits = { instagram: Number(process.env.INSTAGRAM_DAILY_LIMIT || 20), threads: Number(process.env.THREADS_DAILY_LIMIT || 20) };
  const configuredPlatforms = [instagram, threads].filter(credentialsReady);
  const health = { checkedAt: new Date().toISOString(), platforms: {} };
  for (const platform of configuredPlatforms) {
    const stateFile = path.join(logsDir, `${platform.name}-control.json`);
    const control = JSON.parse(await fs.readFile(stateFile, "utf8").catch(() => "{}"));
    if (Date.parse(control.pauseUntil || "") > Date.now()) { health.platforms[platform.name] = control; continue; }
    const unresolved = records.find(x => x.item[`${platform.name}PublishRequestedAt`] && !x.item[`${platform.name}MediaId`]);
    if (unresolved) {
      try { await reconcile(platform, unresolved); }
      catch (error) { console.log(`::warning::${platform.name}: ${error.message}`); }
      // Unmatched clips remain locked. Their request timestamps reserve a
      // posting slot; other clips can proceed after the normal gap.
    }
    try {
      const endpoint = platform.name === "instagram" ? "content_publishing_limit" : "threads_publishing_limit";
      const url = new URL(`${platform.base}/${platform.userId}/${endpoint}`);
      url.searchParams.set("fields", "quota_usage,config"); url.searchParams.set("access_token", platform.token);
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error?.message || "Quota check failed");
      const quota = payload.data?.[0];
      if (!Number.isFinite(quota?.quota_usage) || !Number.isFinite(quota?.config?.quota_total)) throw new Error("Unrecognized quota response");
      health.platforms[platform.name] = { status: "healthy", usage: quota.quota_usage, limit: quota.config.quota_total };
      if (quota.quota_usage >= Math.min(limits[platform.name], quota.config.quota_total)) continue;
    } catch (error) {
      health.platforms[platform.name] = { status: "quota_or_auth_check_failed", error: error.message };
      console.log(`::warning::${platform.name}: quota/auth check failed; publishing paused`);
      continue;
    }
    const record = [...records].sort((a, b) => Number(a.item.sportRank || 99) - Number(b.item.sportRank || 99) || Number(b.item.deterministicScore || 0) - Number(a.item.deterministicScore || 0)).find(x => platformEligible(x.item, platform.name, records, Date.now(), limits[platform.name]));
    if (!record) continue;
    const { item, file } = record;
    if (item[`${platform.name}PublishRequestedAt`] && !item[`${platform.name}MediaId`]) {
      item[`${platform.name}ReconcileRequired`] = true; await save(file, item); continue;
    }
    try {
      const result = await publishPlatform(platform, item, file);
      item[`${platform.name}MediaId`] = result.mediaId; item[`${platform.name}Permalink`] = result.permalink; item[`${platform.name}VerifiedAt`] = result.verifiedAt;
    } catch (error) {
      item[`${platform.name}Attempts`] = Number(item[`${platform.name}Attempts`] || 0) + 1;
      item[`${platform.name}Error`] = error.message; item[`${platform.name}NextRetryAt`] = retryAt(item[`${platform.name}Attempts`]);
      // Only account-wide errors pause other clips. Clip failures cool down
      // individually, allowing the next queued clip on the next cycle.
      if ([4, 17, 32, 190, 200, 613].includes(Number(error.code))) {
        await save(stateFile, { pauseUntil: item[`${platform.name}NextRetryAt`], error: error.message, checkedAt: new Date().toISOString() });
      }
      if (!item[`${platform.name}PublishRequestedAt`] && /failed:.*(ERROR|EXPIRED)/i.test(error.message)) {
        delete item[`${platform.name}ContainerId`];
        delete item[`${platform.name}ContainerCreatedAt`];
      }
    }
    await save(file, item);
  if (item.instagramVerifiedAt && item.threadsVerifiedAt) {
    item.status = "published"; item.publishedAt = new Date().toISOString(); delete item.instagramNextRetryAt; delete item.threadsNextRetryAt;
  } else if (item.instagramVerifiedAt) {
    item.status = "instagram_published_threads_pending";
  } else if (item.threadsVerifiedAt) {
    item.status = "threads_published_instagram_pending";
  }
  await save(file, item);
  }
  for (const platform of configuredPlatforms) {
    const name = platform.name;
    const pending = records.filter(x => eligible(x.item) && !x.item[`${name}VerifiedAt`]);
    const dates = records.map(x => x.item[`${name}VerifiedAt`]).filter(Boolean).sort();
    Object.assign(health.platforms[name], {
      pendingItems: pending.length,
      lastVerifiedAt: dates.at(-1) || null,
      overdue: pending.length > 0 && (!dates.length || Date.now() - Date.parse(dates.at(-1)) > minimumGapMs + 10 * 60_000),
      unresolvedItems: records.filter(x => x.item[`${name}PublishRequestedAt`] && !x.item[`${name}MediaId`]).map(x => x.item.shortcode),
    });
  }
  await save(path.join(logsDir, "publisher-health.json"), health);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
