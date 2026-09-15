import { normalizeHandle } from "./lib.mjs";

const hooks = { highlight: ["That finish was ridiculous 😳", "Had to run that one back 👀", "Sports are unreal sometimes 😮‍💨"], breaking_news: ["This one changes the conversation 🚨", "The sports world is watching this one 👀", "Here’s the update everyone is talking about 🚨"], sports_culture: ["Sports and the internet stay undefeated 😂", "The crossover nobody saw coming 😂", "Only sports can create a moment like this 😂"], routine: ["The moment says it all 👀", "This is why sports stay must-watch 🔥", "You have to see this one twice 👀"] };
const questions = { highlight: ["Did you see that coming?", "Rate this one 1–10.", "Would you have made that play?"], sports_culture: ["Be honest—would you have done the same?", "Who had the better moment here?", "What’s your take?"], breaking_news: ["What do you think?", "How does this change things?", "What’s your reaction?"], routine: ["What’s your take?", "Did you catch this live?", "Who saw this coming?"] };
const sportTags = { basketball: ["#basketball", "#nba"], football: ["#football", "#nfl"], mlb: ["#mlb", "#baseball"], hockey: ["#nhl", "#hockey"] };
function inferredSport(text) { const value = text.toLowerCase(); if (/\b(nba|wnba|basketball|dunk|alley[- ]oop|three[- ]pointer)\b/.test(value)) return "basketball"; if (/\b(nfl|football|touchdown|quarterback|interception|field goal)\b/.test(value)) return "football"; if (/\b(mlb|baseball|home run|homer|strikeout|pitcher|batter)\b/.test(value)) return "mlb"; if (/\b(nhl|hockey|stanley cup|goalie|puck|hat trick)\b/.test(value)) return "hockey"; return ""; }
export function composeCaption(source, handle, { contentKind = "routine", shortcode = "", sport = "" } = {}) { const body = String(source || "").trim(); const normalized = String(handle || "").trim().replace(/^@/, "").toLowerCase(); if (!body || !normalized) return body; const lane = hooks[contentKind] ? contentKind : "routine"; const index = [...String(shortcode)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % hooks[lane].length; const existing = new Set((body.match(/#[\w]+/g) || []).map(tag => tag.toLowerCase())); const tags = (sportTags[sport || inferredSport(body)] || ["#sports"]).filter(tag => !existing.has(tag)); return [hooks[lane][index], body, tags.slice(0, 2).join(" "), `Source: @${normalized}`, questions[lane][index % questions[lane].length], "Follow @sportswire247 for daily sports moments, reactions, and updates.", "@sportswire247"].filter(Boolean).join("\n\n"); }

const words = text => String(text || "").toLowerCase().match(/[\p{L}\p{N}_@#]+/gu) || [];

export function safeHumanizedCaption(source, candidate) {
  const original = String(source || "").trim();
  const rewritten = String(candidate || "").trim();
  if (!original || !rewritten || rewritten.length > 2200) return null;
  const originalSet = new Set(words(original));
  const candidateSet = new Set(words(rewritten));
  if ([...originalSet].some(word => !candidateSet.has(word))) return null;
  if ([...candidateSet].some(word => !originalSet.has(word))) return null;
  return rewritten;
}

export async function localCaption(config, sourceCaption, sourceHandle) {
  const source = String(sourceCaption || "").trim();
  let body = source;
  let captionMode = "source_verbatim_fallback";
  if (config.ollama?.enabled && config.ollama?.captionCleanup !== false && source) {
    try {
      const response = await fetch(`${config.ollama.url.replace(/\/$/, "")}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ model: config.ollama.model, stream: false, options: { temperature: 0 }, prompt: [
          "You are a local social-caption copy editor.",
          "Rewrite this so it reads naturally to a human. You may change punctuation, line breaks, and ordering only.",
          "Do not add, remove, guess, or change facts, names, scores, hashtags, emojis, @mentions, URLs, sponsors, or attribution.",
          "Return only the caption; do not add a source-credit line.", "SOURCE CAPTION:", source
        ].join("\n") })
      });
      if (response.ok) {
        const accepted = safeHumanizedCaption(source, (await response.json()).response);
        if (accepted) { body = accepted; captionMode = "ollama_local_humanized"; }
      }
    } catch { /* publishing safely falls back to the exact source caption */ }
  }
  return { sourceCaption: source, body, publishCaption: composeCaption(body, normalizeHandle(sourceHandle)), captionMode: `${captionMode}_packaged`, captionCheckedAt: new Date().toISOString() };
}
