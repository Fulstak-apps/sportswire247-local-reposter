import { normalizeHandle } from "./lib.mjs";

const sportTags = { basketball: ["#basketball", "#nba"], football: ["#football", "#nfl"], mlb: ["#mlb", "#baseball"], hockey: ["#nhl", "#hockey"] };
function inferredSport(text) { const value = text.toLowerCase(); if (/\b(nba|wnba|basketball|dunk|alley[- ]oop|three[- ]pointer)\b/.test(value)) return "basketball"; if (/\b(nfl|football|touchdown|quarterback|interception|field goal)\b/.test(value)) return "football"; if (/\b(mlb|baseball|home run|homer|strikeout|pitcher|batter)\b/.test(value)) return "mlb"; if (/\b(nhl|hockey|stanley cup|goalie|puck|hat trick)\b/.test(value)) return "hockey"; return ""; }
export function composeCaption(source, handle, { sport = "" } = {}) {
  const body = String(source || "").trim(); const normalized = String(handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!body || !normalized) return body;
  const existing = new Set((body.match(/#[\w]+/g) || []).map(tag => tag.toLowerCase()));
  const tags = (sportTags[sport || inferredSport(body)] || ["#sports"]).filter(tag => !existing.has(tag));
  // Keep the source copy prominent without recycled hooks, questions, or a
  // generic CTA that makes every post sound identical.
  return [body, tags.slice(0, 2).join(" "), `Source: @${normalized}`].filter(Boolean).join("\n\n");
}

const words = text => String(text || "").toLowerCase().match(/[\p{L}\p{N}_@#]+/gu) || [];

function stripModelThinking(value) {
  let text = String(value || "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Some Qwen builds omit the opening marker but leave the closing marker;
  // everything before it is still reasoning, not caption copy.
  const closing = text.toLowerCase().lastIndexOf("</think>");
  if (closing >= 0) text = text.slice(closing + "</think>".length);
  return text.trim();
}

export function safeHumanizedCaption(source, candidate) {
  const original = String(source || "").trim();
  const rewritten = String(candidate || "").trim();
  if (!original || !rewritten || rewritten.length > 2200) return null;
  const originalSet = new Set(words(original)); const candidateSet = new Set(words(rewritten));
  const protectedTokens = words(original).filter(word => /\d/.test(word) || word.startsWith("@") || word.startsWith("#"));
  if (protectedTokens.some(word => !candidateSet.has(word))) return null;
  const overlap = [...candidateSet].filter(word => originalSet.has(word)).length / Math.max(1, candidateSet.size);
  if (overlap < 0.7) return null;
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
          "Rewrite this into a sharp, natural SportsWire caption. Keep it concise and specific; lead with the actual moment or update instead of a generic reaction.",
          "Do not add, remove, guess, or change facts, names, scores, hashtags, emojis, @mentions, URLs, sponsors, or attribution.",
          "No filler, mandatory questions, ‘follow for more,’ or generic hype. Return only the caption; do not add a source-credit line.", "SOURCE CAPTION:", source
        ].join("\n") })
      });
      if (response.ok) {
        const accepted = safeHumanizedCaption(source, stripModelThinking((await response.json()).response));
        if (accepted) { body = accepted; captionMode = "ollama_local_humanized"; }
      }
    } catch { /* publishing safely falls back to the exact source caption */ }
  }
  return { sourceCaption: source, body, publishCaption: composeCaption(body, normalizeHandle(sourceHandle)), captionMode: `${captionMode}_packaged`, captionCheckedAt: new Date().toISOString() };
}
