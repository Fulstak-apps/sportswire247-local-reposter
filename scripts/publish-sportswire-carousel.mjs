import fs from "node:fs/promises";

const manifestFile = "carousel/current.json";
const queueFile = "carousel/publication.json";
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const userId = process.env.INSTAGRAM_USER_ID;
const api = "https://graph.instagram.com";

async function read(file, fallback = {}) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function save(file, value) { await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n"); }
function validate(manifest) {
  if (!Array.isArray(manifest.slides) || manifest.slides.length !== 6) throw new Error("Carousel requires exactly six slides");
  for (const [index, slide] of manifest.slides.entries()) {
    if (!/^https?:\/\//.test(String(slide.imageUrl || ""))) throw new Error(`Slide ${index + 1} is missing a public image URL`);
    if (Number(slide.width) !== 1080 || Number(slide.height) !== 1350) throw new Error(`Slide ${index + 1} is not 1080x1350`);
    if (index < 5 && !slide.story) throw new Error(`Slide ${index + 1} is missing its story`);
  }
  if (!/^1\./m.test(manifest.caption || "") || !/^5\./m.test(manifest.caption || "")) throw new Error("Caption must contain five numbered sections");
  if (!manifest.scoreboardVerifiedAt) throw new Error("Scoreboard verification is missing");
}
function instagramCaption(manifest) {
  // Full URLs remain in the local manifest/source ledger. Instagram captions
  // have a hard character ceiling, so the public post uses readable outlet
  // names rather than five opaque redirect links.
  const body = manifest.slides.slice(0, 5).map((slide, index) => `${index + 1}. ${slide.headline}\nSource reporting: ${(slide.sources || []).map(s => s.source).join(" + ")}`).join("\n\n");
  const caption = `${body}\n\nFollow @sportswire247 for verified sports updates.`;
  if (caption.length > 2200) throw new Error("Compact carousel caption still exceeds Instagram's limit");
  return caption;
}
async function graph(path, fields) {
  const response = await fetch(`${api}/${userId}/${path}`, { method: "POST", body: new URLSearchParams({ ...fields, access_token: token }), signal: AbortSignal.timeout(90_000) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Instagram API HTTP ${response.status}`);
  return payload;
}
async function inspect(id, finalPost = false) {
  const url = new URL(`${api}/${id}`); url.searchParams.set("fields", finalPost ? "id,permalink" : "id,status_code,status"); url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }); const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Instagram verification failed");
  return payload;
}
async function waitReady(id) {
  for (let i = 0; i < 20; i++) {
    const result = await inspect(id); const status = String(result.status_code || result.status || "").toUpperCase();
    if (["FINISHED", "PUBLISHED"].includes(status)) return;
    if (["ERROR", "EXPIRED"].includes(status)) throw new Error(`Carousel child ${id} failed: ${status}`);
    await new Promise(resolve => setTimeout(resolve, 15_000));
  }
  throw new Error(`Carousel child ${id} did not finish`);
}
async function main() {
  if (!token || !userId) throw new Error("Instagram carousel credentials are missing");
  const manifest = await read(manifestFile, null); if (!manifest) throw new Error("carousel/current.json is missing"); validate(manifest);
  const existing = await read(queueFile, {});
  // A receipt applies only to the package that created it.  Without this check,
  // the first successful carousel would accidentally block every future run.
  if (existing.runId === manifest.runId && existing.instagramVerifiedAt) { console.log(JSON.stringify({ status: "already_published", ...existing })); return; }
  const children = [];
  for (const slide of manifest.slides) {
    const child = await graph("media", { image_url: slide.imageUrl, is_carousel_item: "true" });
    children.push(child.id); await waitReady(child.id);
  }
  const container = await graph("media", { media_type: "CAROUSEL", children: children.join(","), caption: instagramCaption(manifest) });
  await waitReady(container.id);
  const published = await graph("media_publish", { creation_id: container.id });
  const verified = await inspect(published.id, true);
  if (!verified.permalink) throw new Error("Carousel published without a permalink");
  const record = { ...manifest, instagramContainerId: container.id, instagramMediaId: published.id, instagramPermalink: verified.permalink, instagramVerifiedAt: new Date().toISOString() };
  await save(queueFile, record); console.log(JSON.stringify({ status: "published", mediaId: published.id, permalink: verified.permalink }));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
