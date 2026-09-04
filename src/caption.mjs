import { normalizeHandle, withCredit } from "./lib.mjs";

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
  return { sourceCaption: source, body, publishCaption: withCredit(body, normalizeHandle(sourceHandle)), captionMode, captionCheckedAt: new Date().toISOString() };
}
