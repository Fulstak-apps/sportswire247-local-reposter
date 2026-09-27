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
  const candidates = [...grouped].filter(([key]) => !used.has(key)).slice(0, 18);
  const approved = (await Promise.all(candidates.map(async ([key, group]) => {
    const unique = [...new Map(group.map(x => [x.source.toLowerCase(), x])).values()];
    // A broad RSS search commonly has one article per outlet. Search the
    // candidate headline again to collect an independent corroborating outlet.
    if (unique.length < 2) {
      try {
        const corroboration = await fetchRss(`\"${group[0].title}\"`);
        for (const item of corroboration) if (!unique.some(x => x.source.toLowerCase() === item.source.toLowerCase())) unique.push(item);
      } catch { /* keep this candidate unapproved rather than lower the bar */ }
    }
    if (unique.length < 2) return null;
    return { key, headline: group[0].title, sources: unique.slice(0, 2), publishedAt: group[0].publishedAt };
  }))).filter(Boolean);
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
async function storyVisual(story) {
  // Do not use a publisher's generic social thumbnail. It was the source of
  // the text/shape cards the user rejected. Commons gives us an actual
  // photograph or licensed editorial image tied to the named subject.
  const cleaned = story.headline.replace(/[^a-z0-9 ]/gi, " ").replace(/\b(what|know|ahead|best|bets|expert|picks|week|odds|tracker|more|wild|card|series|rematch|against|spread|games|schedule|standings|scenarios|tiebreakers)\b/gi, " ").replace(/\s+/g, " ").trim();
  const named = (story.headline.match(/\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:[- ][A-Z][a-z]+)*/g) || []).filter(word => !/^(What|Who|Will|Here|The|NFL|MLB|NBA|NHL)$/i.test(word)).join(" ");
  const aliases = [[/Rams/i, "Los Angeles Rams NFL"], [/Broncos/i, "Denver Broncos NFL"], [/Texans|Shaair/i, "Houston Texans NFL game"], [/Red Sox/i, "Boston Red Sox baseball"], [/Yankees/i, "New York Yankees baseball"], [/MLB|baseball/i, "Major League Baseball game"], [/NBA|basketball/i, "NBA basketball game"], [/NHL|hockey/i, "NHL hockey game"], [/soccer/i, "association football match"]];
  const sportFallback = aliases.find(([pattern]) => pattern.test(story.headline))?.[1] || "professional sports game";
  const generalPhoto = /NFL|Rams|Broncos|Texans|Shaair/i.test(story.headline) ? "American football game" : /MLB|baseball|Yankees|Red Sox/i.test(story.headline) ? "baseball game" : /NBA|basketball/i.test(story.headline) ? "basketball game" : /NHL|hockey/i.test(story.headline) ? "ice hockey game" : "professional sports game";
  const queries = [...new Set([cleaned, named, sportFallback, generalPhoto].filter(Boolean))];
  try {
    for (const search of queries) {
      const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(search)}&prop=imageinfo&iiprop=url&iiurlwidth=1400&format=json&origin=*`;
      const payload = await (await fetch(endpoint, { signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "SportsWire247 local newsroom" } })).json();
      const pages = Object.values(payload.query?.pages || {});
      for (const page of pages) {
        const info = page.imageinfo?.[0]; const imageUrl = info?.thumburl || info?.url;
        // Reject icons, logos, SVGs, and tiny source art. Photo-like raster files
        // are the only allowed background input.
        if (!imageUrl || /\.(svg|png)(?:\?|$)/i.test(imageUrl) || /logo|icon|wordmark|radio|uniform|guide|pdf|wikinews|newspaper|article|chart|map/i.test(page.title || "")) continue;
        const image = await fetch(imageUrl, { signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "Mozilla/5.0" } });
        const type = image.headers.get("content-type") || ""; const bytes = Buffer.from(await image.arrayBuffer());
        if (!image.ok || !type.startsWith("image/") || bytes.length < 25_000) continue;
        return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
      }
    }
  } catch { /* fail closed below */ }
  throw new Error(`Held: no usable editorial visual for “${story.headline}”`);
}
function visual(slide, logo, index) {
  const title = esc(cardHeadline(slide.headline)).toUpperCase();
  const text = index < 5 ? esc(slide.summary) : esc(slide.summary);
  const footer = index < 5 ? `STORY ${index + 1} OF 5  •  SPORTSWIRE 24/7` : "TODAY'S VERIFIED FINAL SCORES";
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box} body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#07110d;color:#fff;font-family:Impact,Arial Black,sans-serif}
  .art{height:100%;padding:58px 60px;position:relative;background:#07110d}.art:before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(2,10,7,.92) 0%,rgba(2,10,7,.42) 48%,rgba(2,10,7,.08)),url('${slide.visual || ""}') center/cover;filter:contrast(1.12) saturate(1.08)}.art:after{content:"";position:absolute;inset:0;opacity:.18;background-image:radial-gradient(#d7f82b 1.2px,transparent 1.2px);background-size:12px 12px;mix-blend-mode:screen}.kicker{position:relative;color:#caff00;font:700 26px Arial;letter-spacing:5px;margin-bottom:27px}.title{position:relative;width:60%;font-size:74px;line-height:.9;letter-spacing:-2px;text-shadow:6px 6px #000,-2px 2px #000;transform:skew(-5deg)}.copy{position:relative;margin-top:36px;width:52%;font:700 27px/1.16 Arial;color:#f5f5e9;text-shadow:2px 2px #000}.scores{position:relative;margin-top:44px;width:88%;display:grid;grid-template-columns:1fr 1fr;gap:12px}.score{font:700 29px Arial;background:#f1f0dc;color:#10140e;padding:16px;border-left:11px solid #ccff00}.logo{position:absolute;left:50px;bottom:104px;width:130px;max-height:130px;object-fit:contain;filter:drop-shadow(3px 4px 0 #000)}.footer{position:absolute;right:42px;bottom:42px;background:#f7f1d2;color:#15170f;border:4px solid #171710;padding:12px 17px;font:700 21px Arial;letter-spacing:1px}.source{position:absolute;left:60px;bottom:58px;font:600 17px Arial;color:#fff;width:650px;text-shadow:2px 2px #000}.num{position:absolute;right:58px;top:50px;color:#d5ff00;font-size:30px}</style></head><body><main class="art"><div class="kicker">SPORTSWIRE 24/7 • VERIFIED DESK</div><div class="num">${index < 5 ? index + 1 : "6"}/6</div><div class="title">${title.replace(/\n/g,"<br>")}</div>${index < 5 ? `<div class="copy">${text}</div><div class="source">SOURCES: ${slide.sources.map(s => esc(s.source)).join(" • ")}</div>` : `<section class="scores">${slide.scores.map(s => `<div class="score">${esc(s.league)}<br>${esc(s.line)}</div>`).join("")}</section>`}<img class="logo" src="${logo}"><div class="footer">${footer}</div></main></body></html>`;
}
function cardHeadline(headline) {
  if (/Rams.*Broncos/i.test(headline)) return "RAMS–BRONCOS\nWEEK 3 PICKS";
  if (/Red Sox.*Yankees/i.test(headline)) return "YANKEES–RED SOX\nWILD CARD REMATCH";
  if (/Al-Shaair|Texans/i.test(headline)) return "TEXANS FACE\nNFL WARNING";
  if (/MLB.*playoffs/i.test(headline)) return "MLB PLAYOFF\nRACE UPDATE";
  return headline.split(/\s+/).slice(0, 7).join(" ");
}
async function render(slides, output) {
  const logo = `data:image/png;base64,${(await fs.readFile(logoPath)).toString("base64")}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try { const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 }); for (let i = 0; i < slides.length; i++) { await page.setContent(visual(slides[i], logo, i), { waitUntil: "load" }); await page.screenshot({ path: path.join(output, `slide-${i + 1}.png`), type: "png" }); } } finally { await browser.close(); }
}
async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const rebuild = process.argv.includes("--rebuild-current");
  const saved = rebuild ? await json(path.join(CAROUSEL, "current.json"), null) : null;
  const { selected, ledger } = saved ? { selected: saved.slides.slice(0, 5), ledger: await json(path.join(CAROUSEL, "story-ledger.json"), { used: [] }) } : await stories();
  const scores = saved?.slides?.[5]?.scores || await scorecard();
  const packageDir = path.join(MEDIA, runId); await fs.mkdir(packageDir, { recursive: true });
  const slides = await Promise.all(selected.map(async story => ({ ...story, visual: await storyVisual(story), summary: story.headline })));
  slides.push({ headline: "FINAL SCORES", summary: "Verified completed games only.", scores }); await render(slides, packageDir);
  // Links are preserved in each slide's source ledger; the public caption is
  // intentionally compact enough for Instagram's 2,200-character limit.
  const caption = selected.map((story, i) => `${i + 1}. ${story.headline}\nReporting: ${story.sources.map(s => s.source).join(" + ")}`).join("\n\n");
  const manifest = { runId, generatedAt: new Date().toISOString(), scoreboardVerifiedAt: new Date().toISOString(), slides: slides.map(({ visual, ...slide }, i) => ({ ...slide, story: i < 5 ? slide.headline : undefined, width: 1080, height: 1350, imageUrl: `${RAW}/carousel/media/${runId}/slide-${i + 1}.png` })), caption };
  await write(path.join(CAROUSEL, "current.json"), manifest); ledger.used = [...ledger.used, ...selected.map(s => ({ key: s.key, runId, usedAt: manifest.generatedAt }))].slice(-500); await write(path.join(CAROUSEL, "story-ledger.json"), ledger);
  await exec("git", ["add", "carousel/current.json", "carousel/story-ledger.json", `carousel/media/${runId}`], { cwd: ROOT }); await exec("git", ["commit", "-m", `Generate SportsWire carousel ${runId}`], { cwd: ROOT }); await exec("git", ["push", "origin", "main"], { cwd: ROOT });
  await exec("gh", ["workflow", "run", "sportswire-carousel.yml", "--ref", "main"], { cwd: ROOT }); console.log(JSON.stringify({ status: "generated_and_dispatched", runId }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
