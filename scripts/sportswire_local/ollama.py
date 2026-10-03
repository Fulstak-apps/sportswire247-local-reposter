from __future__ import annotations
import json, re, subprocess

def strip_model_thinking(value: str) -> str:
    text = str(value or "")
    start = text.lower().find("<think>")
    end = text.lower().find("</think>")
    if start >= 0 and end > start:
        text = text[:start] + text[end + len("</think>"):]
    elif end >= 0:
        text = text[end + len("</think>"):]
    return text.strip()

def generate(config: dict, evidence: dict) -> dict:
    source = evidence.get("sourceCaption", "").strip()
    prompt = """Write one natural, specific SportsWire247 caption from the evidence below. Use only stated facts. The caption MUST include the exact sourceCaption words (you may remove only a trailing @handle), then may add one short fact-free reaction. Do not add facts, names, scores, quotes, dates, injuries, trades, or claims not present in the evidence. Return ONLY this JSON object with exactly these keys: {\"caption\":\"...\",\"threads_text\":\"...\",\"content_lane\":\"highlight|breaking_news|sports_culture|routine\",\"confidence\":\"confirmed|reported|developing|rumor\"}. Never output sourceCaption, sourceHandle, sourceUrl, or an explanation.\nEVIDENCE:\n""" + json.dumps(evidence)
    def request(value: str) -> dict:
        payload = json.dumps({"model": config["ollama"]["model"], "stream": False, "think": False, "format": "json", "prompt": value, "options": {"temperature": 0.25, "num_predict": 220}})
        response = subprocess.run(["curl", "-fsS", "--max-time", "30", "-H", "Content-Type: application/json", "--data-binary", payload, config["ollama"]["url"].rstrip("/") + "/api/generate"], capture_output=True, text=True, timeout=35)
        if response.returncode: raise RuntimeError(response.stderr.strip() or "Ollama request timed out")
        return json.loads(strip_model_thinking(json.loads(response.stdout)["response"]))
    result = request(prompt)
    caption = str(result.get("caption", "")).strip()
    # Attribution is appended by captions.py as a non-negotiable final line.
    # Requiring the model to echo every source handle here was both redundant
    # and brittle: its natural lead often omits @handles, so valid humanized
    # copy was discarded in favor of a generic source-text fallback.
    if not caption:
        # Small local models occasionally echo the evidence schema. Retry once
        # with an explicit repair instruction before the safe source fallback
        # is used by the caller.
        result = request("Return ONLY a JSON object with a non-empty caption field. Do not copy the evidence keys. " + prompt)
        caption = str(result.get("caption", "")).strip()
    if not caption: raise ValueError("Ollama response failed evidence preservation")
    # The local editor may change tone, but it must retain the actual source
    # statement. This catches plausible-sounding additions such as turning two
    # entities in a caption into teammates or a confirmed transaction.
    source_statement = re.sub(r"\s*@[_a-zA-Z0-9.]+\b", "", source).strip()
    normalized_source = " ".join(re.findall(r"[a-z0-9]+", source_statement.lower()))
    normalized_caption = " ".join(re.findall(r"[a-z0-9]+", caption.lower()))
    if normalized_source and normalized_source not in normalized_caption:
        raise ValueError("Ollama response changed source meaning")
    return result
