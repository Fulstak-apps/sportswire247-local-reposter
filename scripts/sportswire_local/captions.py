from __future__ import annotations
import re

SPORT_TAGS = {
    "basketball": ("#basketball", "#nba"),
    "football": ("#football", "#nfl"),
    "mlb": ("#mlb", "#baseball"),
    "hockey": ("#nhl", "#hockey"),
}

COLLEGE_FOOTBALL = ("college football", "#cfb", "#collegefootball", "#ncaafootball", "br_cfb")
COLLEGE_BASKETBALL = ("college basketball", "#cbb", "#ncaabasketball", "br_cbb")

def _sport(text: str) -> str:
    value = text.lower()
    if any(term in value for term in COLLEGE_FOOTBALL): return "college_football"
    if any(term in value for term in COLLEGE_BASKETBALL): return "college_basketball"
    if re.search(r"\b(nba|wnba|basketball|dunk|alley[- ]oop|three[- ]pointer)\b", value): return "basketball"
    if re.search(r"\b(nfl|football|touchdown|quarterback|interception|field goal)\b", value): return "football"
    if re.search(r"\b(mlb|baseball|home run|homer|strikeout|pitcher|batter)\b", value): return "mlb"
    if re.search(r"\b(nhl|hockey|stanley cup|goalie|puck|hat trick)\b", value): return "hockey"
    return ""

def compose_caption(source: str, handle: str, content_kind: str = "routine", shortcode: str = "", sport: str = "") -> str:
    source = str(source or "").strip(); handle = str(handle or "").strip().lstrip("@").lower()
    if not source or not handle: return source
    existing = {tag.lower() for tag in re.findall(r"#[\w]+", source)}
    inferred = sport or _sport(source)
    special = {"college_football": ("#collegefootball", "#cfb"), "college_basketball": ("#collegebasketball", "#cbb")}
    tags = [tag for tag in special.get(inferred, SPORT_TAGS.get(inferred, ("#sports",))) if tag.lower() not in existing]
    pieces = [source]
    if tags: pieces.append(" ".join(tags[:2]))
    pieces.append(f"Source: @{handle}")
    return "\n\n".join(pieces)
