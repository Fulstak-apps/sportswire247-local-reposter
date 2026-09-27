from __future__ import annotations
import re

SPORT_TAGS = {
    "basketball": ("#basketball", "#nba"),
    "football": ("#football", "#nfl"),
    "mlb": ("#mlb", "#baseball"),
    "hockey": ("#nhl", "#hockey"),
}

def _sport(text: str) -> str:
    value = text.lower()
    if re.search(r"\b(nba|wnba|basketball|dunk|alley[- ]oop|three[- ]pointer)\b", value): return "basketball"
    if re.search(r"\b(nfl|football|touchdown|quarterback|interception|field goal)\b", value): return "football"
    if re.search(r"\b(mlb|baseball|home run|homer|strikeout|pitcher|batter)\b", value): return "mlb"
    if re.search(r"\b(nhl|hockey|stanley cup|goalie|puck|hat trick)\b", value): return "hockey"
    return ""

def compose_caption(source: str, handle: str, content_kind: str = "routine", shortcode: str = "", sport: str = "") -> str:
    source = str(source or "").strip(); handle = str(handle or "").strip().lstrip("@").lower()
    if not source or not handle: return source
    existing = {tag.lower() for tag in re.findall(r"#[\w]+", source)}
    tags = [tag for tag in SPORT_TAGS.get(sport or _sport(source), ("#sports",)) if tag.lower() not in existing]
    pieces = [source]
    if tags: pieces.append(" ".join(tags[:2]))
    pieces.append(f"Source: @{handle}")
    return "\n\n".join(pieces)
