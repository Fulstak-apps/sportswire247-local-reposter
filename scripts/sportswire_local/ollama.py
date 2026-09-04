from __future__ import annotations
import json, subprocess

def generate(config: dict, evidence: dict) -> dict:
    source = evidence.get("sourceCaption", "").strip()
    prompt = """You edit SportsWire247 captions. Sound human, concise, sports-native, and internet-aware. Use only supplied evidence. Never invent or change names, scores, dates, injuries, quotes, handles, or facts. Serious injury/death/crime content gets no jokes or rage bait. Return strict JSON: {\"caption\": string, \"threads_text\": string, \"content_lane\": string, \"confidence\": \"confirmed|reported|developing|rumor\"}. Preserve source attribution facts.\nEVIDENCE:\n""" + json.dumps(evidence)
    payload = json.dumps({"model": config["ollama"]["model"], "stream": False, "think": False, "format": "json", "prompt": prompt, "options": {"temperature": 0.2, "num_predict": 300}})
    response = subprocess.run(["curl", "-fsS", "--max-time", "30", "-H", "Content-Type: application/json", "--data-binary", payload, config["ollama"]["url"].rstrip("/") + "/api/generate"], capture_output=True, text=True, timeout=35)
    if response.returncode: raise RuntimeError(response.stderr.strip() or "Ollama request timed out")
    result = json.loads(json.loads(response.stdout)["response"])
    caption = str(result.get("caption", "")).strip()
    # Fail closed if the model drops source evidence entirely. The caller uses
    # exact source copy as a free, safe fallback.
    if not caption or any(token not in caption.lower() for token in [t for t in source.lower().split() if t.startswith("@")] ): raise ValueError("Ollama response failed evidence preservation")
    return result
