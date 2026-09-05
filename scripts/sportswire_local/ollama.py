from __future__ import annotations
import json, subprocess

def generate(config: dict, evidence: dict) -> dict:
    source = evidence.get("sourceCaption", "").strip()
    prompt = """You edit SportsWire247 captions for a fast, viral sports page. Sound human, concise, sports-native, internet-aware, and confident without sounding like corporate ESPN copy. Lead with the most exciting verified part of the play/story. Basketball is the broadest content lane, followed by football, MLB/baseball, then hockey, but NEVER exaggerate a weaker clip just to make it pass. For elite highlights, let the moment breathe and use a strong short hook. For funny/culture moments, light debate language is allowed. Use only supplied evidence. Never invent or change names, scores, dates, injuries, quotes, handles, records, trades, or facts. Do not claim a clip is a game-winner, record, injury, arrest, death, or breaking news unless the evidence says so. Serious injury/death/crime/legal content gets no jokes, rage bait, or emojis. Return strict JSON: {\"caption\": string, \"threads_text\": string, \"content_lane\": string, \"confidence\": \"confirmed|reported|developing|rumor\"}. Preserve source attribution facts.\nEVIDENCE:\n""" + json.dumps(evidence)
    payload = json.dumps({"model": config["ollama"]["model"], "stream": False, "think": False, "format": "json", "prompt": prompt, "options": {"temperature": 0.25, "num_predict": 260}})
    response = subprocess.run(["curl", "-fsS", "--max-time", "30", "-H", "Content-Type: application/json", "--data-binary", payload, config["ollama"]["url"].rstrip("/") + "/api/generate"], capture_output=True, text=True, timeout=35)
    if response.returncode: raise RuntimeError(response.stderr.strip() or "Ollama request timed out")
    result = json.loads(json.loads(response.stdout)["response"])
    caption = str(result.get("caption", "")).strip()
    if not caption or any(token not in caption.lower() for token in [t for t in source.lower().split() if t.startswith("@")] ): raise ValueError("Ollama response failed evidence preservation")
    return result
