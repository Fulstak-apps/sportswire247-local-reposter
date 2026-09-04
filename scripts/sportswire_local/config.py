from __future__ import annotations
import json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "runtime"
INBOX_QUEUE = RUNTIME / "queue"
QUEUE = ROOT / "queue"
MEDIA = ROOT / "media"
LOGS = ROOT / "logs"
STATE = RUNTIME / "state"

def load_config() -> dict:
    data = json.loads((ROOT / "config.json").read_text())
    data["ollama"]["model"] = os.getenv("OLLAMA_MODEL", data["ollama"].get("model", "qwen3:4b"))
    data["ollama"]["url"] = os.getenv("OLLAMA_URL", data["ollama"].get("url", "http://127.0.0.1:11434"))
    data["mode"] = os.getenv("SPORTSWIRE_MODE", data.get("mode", "review"))
    return data

def sources() -> list[dict]:
    return [x for x in json.loads((ROOT / "monitor/sources.json").read_text())["sources"] if x.get("enabled")]
