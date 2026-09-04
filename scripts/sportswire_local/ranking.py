from __future__ import annotations
from datetime import datetime, timezone
import re

LEAGUES = {
    "nba": ("nba", "basketball", "lakers", "celtics", "warriors"),
    "nfl": ("nfl", "football", "touchdown", "quarterback"),
    "mlb": ("mlb", "baseball", "home run"),
    "nhl": ("nhl", "hockey"),
    "ncaa": ("ncaa", "college football", "college basketball", "cfb"),
    "soccer": ("soccer", "football club", "goal", "premier league"),
    "combat": ("ufc", "mma", "boxing", "knockout"),
    "wnba": ("wnba",), "tennis": ("tennis",), "golf": ("golf",), "f1": ("formula 1", "f1")
}

def classify(text: str) -> str:
    value = text.lower()
    return next((league for league, terms in LEAGUES.items() if any(term in value for term in terms)), "sports")

def fingerprint(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))[:240]

def score(candidate: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    points, reasons = 30.0, ["approved sports source"]
    views = candidate.get("sourceViewCount")
    if views is not None:
        points += min(35, max(0, float(views)) / 1_000_000 * 8)
        reasons.append(f"views={views}")
    published = candidate.get("sourcePublishedAt")
    if published:
        try:
            age_hours = max(0, (now - datetime.fromisoformat(published.replace("Z", "+00:00"))).total_seconds() / 3600)
            freshness = max(0, 30 - age_hours)
            points += freshness
            reasons.append(f"freshness={freshness:.1f}")
        except ValueError: pass
    text = candidate.get("sourceCaption", "")
    if re.search(r"\b(game[- ]winner|buzzer|knockout|fight|eject|insane|wild|record|breaking|report)\b", text, re.I):
        points += 12; reasons.append("viral/breaking signal")
    candidate = dict(candidate)
    candidate.update(league=classify(text), deterministicScore=round(points, 2), scoreReasons=reasons, storyFingerprint=fingerprint(text))
    return candidate
