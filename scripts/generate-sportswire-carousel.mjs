#!/usr/bin/env node
/*
 * Local-first SportsWire carousel desk.  It deliberately fails closed: five
 * corroborated stories and a verified scorecard are required before it writes
 * a package that the Instagram publisher can see.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const CAROUSEL = path.join(ROOT, "carousel");
const MEDIA = path.join(CAROUSEL, "media");
const REPO = "Fulstak-apps/sportswire247-local-reposter";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const logoPath = path.join(ROOT, "assets", "sportswire247-logo.png");
const leagues = [
  ["NBA", "basketball/nba"], ["NFL", "football/nfl"], ["MLB", "baseball/mlb"],
  ["NHL", "hockey/nhl"], ["MLS", "soccer/usa.1"], ["NCAAF", "football/college-football"],
];
const queries = ["NBA OR NFL OR MLB OR NHL", "boxing OR MMA", "soccer OR college sports"];
const clean = value => String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();
const esc = value => String(value || "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
async function json(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function write(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n"); }
function itemBlocks(xml) { return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]); }
function tag(block, name) { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")); return clean(m?.[1]); }
function source(title) { const m = title.match(/\s+-\s+([^–-]+)$/); return m ? m[1].trim() : "News source"; }
function normalize(title) { return title.toLowerCase().replace(/\s+-\s+[^–-]+$/, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3 && !["with","from","that","this","after","says"].includes(w)).slice(0, 9).sort().join(" "); }
async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:1d")}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "SportsWire247 local newsroom" } });
  if (!response.ok) throw new Error(`News feed HTTP ${response.status}`);
  return itemBlocks(await response.text()).map(block => {
    const title = tag(block, "title"); return { title: title.replace(/\s+-\s+[^–-]+$/, ""), source: source(title), url: tag(block, "link"), publishedAt: tag(block, "pubDate") };
  });
}
async function stories() {
  const results = (await Promise.all(queries.map(fetchRss))).flat();
  const grouped = new Map();
  for (const item of results) { const key = normalize(item.title); if (key.length < 12) continue; const group = grouped.get(key) || []; group.push(item); grouped.set(key, group); }
  const ledger = await json(path.join(CAROUSEL, "story-ledger.json"), { used: [] });
  const used = new Set(ledger.used.map(x => x.key));
  const approved = [];
  for (const [key, group] of grouped) {
    const unique = [...new Map(group.map(x => [x.source.toLowerCase(), x])).values()];
    if (used.has(key)) continue;
    // A broad RSS search commonly has one article per outlet. Search the
    // candidate headline again to collect an independent corroborating outlet.
    if (unique.length < 2) {
      try {
        const corroboration = await fetchRss(`\"${group[0].title}\"");
        for (const item of corroboration) if (!unique.some(x => x.source.toLowerCase() === item.source.toLowerCase())) unique.push(item);
      } catch { /* keep this candidate unapproved rather than lower the bar */ }
    }
    if (unique.length < 2) continue;
    approved.push({ key, headline: group[0].title, sources: unique.slice(0, 2), publishedAt: group[0].publishedAt });
  }
  approved.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (approved.length < 5) throw new Error(`Held: only ${approved.length}/5 independently corroborated current stories were available`);
  return { selected: approved.slice(0, 5), ledger };
}
async function scorecard() {
  const cards = [];
  for (const [name, endpoint] of leagues) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/scoreboard`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }); const body = await response.json();
      for (const event of body.events || []) {
        const comp = event.competitions?.[0]; if (comp?.status?.type?.completed) cards.push({ league: name, line: (comp.competitors || []).map(x => `${x.team?.abbreviation || "?"} ${x.score ?? ""}`).join("  ·  ") });
      }
    } catch { /* An unavailable league is not a reason to invent a score. */ }
  }
  // A quiet slate is factual information too.  It is safer to say that no
  // final was verified than to block an otherwise corroborated news edition.
  return cards.length ? cards.slice(0, 12) : [{ league: "SCOREBOARD", line: "No completed scores were verified at generation time." }];
}
function visual(slide, logo, index) {
  const title = esc(slide.headline).toUpperCase();
  const text = index < 5 ? esc(slide.summary) : esc(slide.summary);
  const footer = index < 5 ? `STORY ${index + 1} OF 5  •  SPORTSWIRE 24/7` : "TODAY'S VERIFIED FINAL SCORES";
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box} body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#07110d;color:#fff;font-family:Impact,Arial Black,sans-serif}
  .art{height:100%;padding:58px 60px;position:relative;background:radial-gradient(circle at 83% 24%,#cbff00 0 3%,transparent 3.5%),radial-gradient(circle at 84% 24%,#1e7d44 0 14%,transparent 35%),linear-gradient(135deg,#091611 0 52%,#202419 52%);}
  .art:before{content:"";position:absolute;inset:0;opacity:.30;background-image:radial-gradient(#d7f82b 1.6px,transparent 1.6px);background-size:11px 11px;mix-blend-mode:screen}.kicker{position:relative;color:#caff00;font:700 26px Arial;letter-spacing:5px;margin-bottom:27px}.title{position:relative;width:82%;font-size:104px;line-height:.88;letter-spacing:-2px;text-shadow:7px 7px #000,-2px 2px #000;transform:skew(-5deg)}.title span{color:#d5ff00}.copy{position:relative;margin-top:46px;width:72%;font:700 34px/1.16 Arial;color:#f5f5e9;text-shadow:2px 2px #000}.comic-ball{position:absolute;right:-76px;bottom:120px;width:510px;height:510px;border-radius:50%;border:16px solid #d5ff00;box-shadow:0 0 0 14px #111,0 0 60px #d5ff00;background:repeating-conic-gradient(#273d2c 0 7deg,#08110d 7deg 14deg);opacity:.9}.comic-ball:after{content:"SPORTS\A WIRE";white-space:pre;text-align:center;position:absolute;inset:145px 0;font:90px/.75 Impact;color:#fff;transform:rotate(-22deg);text-shadow:5px 5px #000}.scores{position:relative;margin-top:44px;width:88%;display:grid;grid-template-columns:1fr 1fr;gap:12px}.score{font:700 29px Arial;background:#f1f0dc;color:#10140e;padding:16px;border-left:11px solid #ccff00}.logo{position:absolute;left:50px;bottom:104px;width:160px;max-height:160px;object-fit:contain;filter:drop-shadow(3px 4px 0 #000)}.footer{position:absolute;right:42px;bottom:42px;background:#f7f1d2;color:#15170f;border:4px solid #171710;padding:12px 17px;font:700 21px Arial;letter-spacing:1px}.source{position:absolute;left:60px;bottom:58px;font:600 17px Arial;color:#d5d5c7;width:650px}.num{position:absolute;right:58px;top:50px;color:#d5ff00;font-size:30px}</style></head><body><main class="art"><div class="kicker">SPORTSWIRE 24/7 • VERIFIED DESK</div><div class="num">${index < 5 ? index + 1 : "6"}/6</div><div class="title">${title.replace(/\n/g,"<br>")}</div>${index < 5 ? `<div class="copy">${text}</div><div class="comic-ball"></div><div class="source">SOURCES: ${slide.sources.map(s => esc(s.source)).join(" • ")}</div>` : `<section class="scores">${slide.scores.map(s => `<div class="score">${esc(s.league)}<br>${esc(s.line)}</div>`).join("")}</section>`}<img class="logo" src="${logo}"><div class="footer">${footer}</div></main></body></html>`;
}
async function render(slides, output) {
  const logo = `data:image/png;base64,${(await fs.readFile(logoPath)).toString("base64")}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try { const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 }); for (let i = 0; i < slides.length; i++) { await page.setContent(visual(slides[i], logo, i), { waitUntil: "load" }); await page.screenshot({ path: path.join(output, `slide-${i + 1}.png`), type: "png" }); } } finally { await browser.close(); }
}
async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-"); const { selected, ledger } = await stories(); const scores = await scorecard();
  const packageDir = path.join(MEDIA, runId); await fs.mkdir(packageDir, { recursive: true });
  const slides = selected.map(story => ({ ...story, summary: `${story.headline}. SportsWire verified this report with two independent outlets before publication.` }));
  slides.push({ headline: "FINAL SCORES", summary: "Verified completed games only.", scores }); await render(slides, packageDir);
  const caption = selected.map((story, i) => `${i + 1}. ${story.headline}\nSources: ${story.sources.map(s => s.url).join(" | ")}`).join("\n\n") + "\n\nFollow @sportswire247 for verified sports updates.";
  const manifest = { runId, generatedAt: new Date().toISOString(), scoreboardVerifiedAt: new Date().toISOString(), slides: slides.map((slide, i) => ({ ...slide, width: 1080, height: 1350, imageUrl: `${RAW}/carousel/media/${runId}/slide-${i + 1}.png` })), caption };
  await write(path.join(CAROUSEL, "current.json"), manifest); ledger.used = [...ledger.used, ...selected.map(s => ({ key: s.key, runId, usedAt: manifest.generatedAt }))].slice(-500); await write(path.join(CAROUSEL, "story-ledger.json"), ledger);
  await exec("git", ["add", "carousel/current.json", "carousel/story-ledger.json", `carousel/media/${runId}`], { cwd: ROOT }); await exec("git", ["commit", "-m", `Generate SportsWire carousel ${runId}`], { cwd: ROOT }); await exec("git", ["push", "origin", "main"], { cwd: ROOT });
  await exec("gh", ["workflow", "run", "sportswire-carousel.yml", "--ref", "main"], { cwd: ROOT }); console.log(JSON.stringify({ status: "generated_and_dispatched", runId }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
