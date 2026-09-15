from __future__ import annotations
import re

SPORT_TAGS = {
    "basketball": ("#basketball", "#nba"),
    "football": ("#football", "#nfl"),
    "mlb": ("#mlb", "#baseball"),
    "hockey": ("#nhl", "#hockey"),
}
HOOKS = {
    "highlight": ("That finish was ridiculous 😳", "Had to run that one back 👀", "Sports are unreal sometimes 😮‍💨"),
    "breaking_news": ("This one changes the conversation 🚨", "The sports world is watching this one 👀", "Here’s the update everyone is talking about 🚨"),
    "sports_culture": ("Sports and the internet stay undefeated 😂", "The crossover nobody saw coming 😂", "Only sports can create a moment like this 😂"),
    "routine": ("The moment says it all 👀", "This is why sports stay must-watch 🔥", "You have to see this one twice 👀"),
}
QUESTIONS = {
    "highlight": ("Did you see that coming?", "Rate this one 1–10.", "Would you have made that play?"),
    "sports_culture": ("Be honest—would you have done the same?", "Who had the better moment here?", "What’s your take?"),
    "breaking_news": ("What do you think?", "How does this change things?", "What’s your reaction?"),
    "routine": ("What’s your take?", "Did you catch this live?", "Who saw this coming?"),
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
    lane = content_kind if content_kind in HOOKS else "routine"
    index = sum(ord(char) for char in shortcode) % len(HOOKS[lane])
    existing = {tag.lower() for tag in re.findall(r"#[\w]+", source)}
    tags = [tag for tag in SPORT_TAGS.get(sport or _sport(source), ("#sports",)) if tag.lower() not in existing]
    pieces = [HOOKS[lane][index], source]
    if tags: pieces.append(" ".join(tags[:2]))
    pieces.extend([f"Source: @{handle}", QUESTIONS[lane][index % len(QUESTIONS[lane])], "Follow @sportswire247 for daily sports moments, reactions, and updates.", "@sportswire247"])
    return "\n\n".join(pieces)
