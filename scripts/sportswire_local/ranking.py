from __future__ import annotations
from datetime import datetime, timezone
import math
import os
import re
from difflib import SequenceMatcher

# SportsWire247 priority is intentionally not a hard sort. Basketball gets the
# widest posting lane, then football, MLB/baseball, then hockey. Lower-ranked
# sports must clear progressively stronger highlight/virality floors.
SPORT_POLICIES = {
    "basketball": {"rank": 1, "score_floor": 45.0, "highlight_floor": 28.0, "preference": 8.0},
    "football": {"rank": 2, "score_floor": 52.0, "highlight_floor": 36.0, "preference": 5.0},
    "mlb": {"rank": 3, "score_floor": 60.0, "highlight_floor": 46.0, "preference": 2.0},
    "hockey": {"rank": 4, "score_floor": 66.0, "highlight_floor": 54.0, "preference": 0.0},
}
UNSUPPORTED_POLICY = {"rank": 99, "score_floor": 80.0, "highlight_floor": 70.0, "preference": -10.0}

SOURCE_PRIORS = {
    "houseofhighlights": 9.0,
    "sportscenter": 8.0,
    "bleacherreport": 7.0,
    "overtime": 7.0,
    "jomboymedia": 6.0,
}

ELITE_HIGHLIGHTS = (
    "game winner", "game-winner", "buzzer beater", "buzzer-beater", "walk off",
    "walk-off", "poster dunk", "posterized", "posterizes", "ankle breaker",
    "ankles", "360 dunk", "windmill dunk", "one handed catch", "one-handed catch",
    "hail mary", "pick six", "pick-6", "kickoff return", "punt return",
    "grand slam", "inside the park", "inside-the-park", "goalie robbery",
    "robs him", "robbery", "overtime winner", "ot winner", "hat trick",
)
STRONG_HIGHLIGHTS = (
    "dunk", "touchdown", "home run", "homer", "catch", "interception", "sack",
    "hurdle", "stiff arm", "stiff-arm", "block", "steal", "slam", "save",
    "goal", "fight", "ejected", "ejection", "bench clearing", "bench-clearing",
    "collision", "truck stick", "breakaway", "strikeout", "double play",
    "triple play", "no hitter", "no-hitter", "perfect game",
)
HIGH_STAKES = (
    "playoff", "finals", "super bowl", "world series", "stanley cup", "game 7",
    "game seven", "overtime", "double overtime", "elimination", "championship",
    "clinches", "clinch", "semifinal", "conference final",
)
BREAKING_NEWS = (
    "breaking", "trade", "traded", "signing", "signs with", "waived", "released",
    "fired", "hired", "extension", "contract", "record", "suspended", "ruled out",
    "injury update", "announces", "retires", "retirement", "report:", "sources:",
)
CULTURE_HEAT = (
    "trash talk", "mic'd up", "micd up", "celebration", "taunt", "taunting",
    "fan reaction", "bench reaction", "mascot", "funny", "wild", "insane",
    "viral", "heated", "staredown", "stare down", "troll", "claps back",
)
ROUTINE_TERMS = (
    "practice", "warmup", "warm-up", "pregame", "pre-game", "press conference",
    "media availability", "walkthrough", "arrival", "arrives", "workout",
)

STOPWORDS = {
    "the","a","an","and","or","but","to","of","in","on","for","with","at","from",
    "is","are","was","were","be","been","being","this","that","these","those","it",
    "its","his","her","their","our","your","my","after","before","during","over",
    "under","into","out","up","down","as","by","vs","v","game","highlight","highlights",
    "sports","sport","nba","nfl","mlb","nhl","basketball","football","baseball","hockey",
}

def _phrase(text: str, phrase: str) -> bool:
    pattern = r"(?<![a-z0-9])" + re.escape(phrase.lower()) + r"(?![a-z0-9])"
    return re.search(pattern, text.lower()) is not None

def classify(text: str) -> str:
    value = text.lower()
    if any(_phrase(value, term) for term in ("wnba", "women's basketball", "womens basketball")):
        return "wnba"
    if any(_phrase(value, term) for term in ("college basketball", "ncaa basketball", "march madness")):
        return "ncaa_basketball"
    if any(_phrase(value, term) for term in ("nba", "basketball", "dunk", "buzzer beater", "three-pointer", "three pointer", "layup", "alley oop", "alley-oop", "jumper")):
        return "nba"
    if any(_phrase(value, term) for term in ("college football", "ncaa football", "cfb")):
        return "ncaa_football"
    if any(_phrase(value, term) for term in ("nfl", "football", "touchdown", "quarterback", "wide receiver", "interception", "pick six", "field goal")):
        return "nfl"
    if any(_phrase(value, term) for term in ("mlb", "baseball", "home run", "homer", "world series", "strikeout", "grand slam", "pitcher", "batter")):
        return "mlb"
    if any(_phrase(value, term) for term in ("nhl", "hockey", "stanley cup", "goalie", "puck", "slapshot", "slap shot", "power play", "hat trick")):
        return "nhl"
    return "sports"

def sport_group(league: str) -> str:
    if league in {"nba", "wnba", "ncaa_basketball"}:
        return "basketball"
    if league in {"nfl", "ncaa_football"}:
        return "football"
    if league == "mlb":
        return "mlb"
    if league == "nhl":
        return "hockey"
    return "other"

def _policy(sport: str) -> dict:
    policy = dict(SPORT_POLICIES.get(sport, UNSUPPORTED_POLICY))
    env_names = {
        "basketball": "SPORTSWIRE_BASKETBALL_FLOOR",
        "football": "SPORTSWIRE_FOOTBALL_FLOOR",
        "mlb": "SPORTSWIRE_MLB_FLOOR",
        "hockey": "SPORTSWIRE_HOCKEY_FLOOR",
    }
    env = env_names.get(sport)
    if env and os.getenv(env):
        try:
            policy["score_floor"] = float(os.getenv(env, policy["score_floor"]))
        except ValueError:
            pass
    return policy

def fingerprint(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))[:240]

def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", text.lower()) if len(token) > 2 and token not in STOPWORDS}

def story_similarity(left: str, right: str) -> float:
    left_tokens, right_tokens = _tokens(left), _tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    jaccard = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    seq = SequenceMatcher(None, fingerprint(left), fingerprint(right)).ratio()
    return max(jaccard, seq * 0.9)

def _age_hours(candidate: dict, now: datetime) -> float | None:
    published = candidate.get("sourcePublishedAt")
    if not published:
        return None
    try:
        value = datetime.fromisoformat(str(published).replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return max(0.0, (now - value.astimezone(timezone.utc)).total_seconds() / 3600)
    except (ValueError, TypeError):
        return None

def _count_terms(text: str, terms: tuple[str, ...]) -> int:
    return sum(1 for term in terms if term in text)

def _priority(score_value: float) -> str:
    if score_value >= 82:
        return "P1"
    if score_value >= 68:
        return "P2"
    if score_value >= 55:
        return "P3"
    return "P4"

def score(candidate: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    candidate = dict(candidate)
    text = str(candidate.get("sourceCaption") or "")
    lower = text.lower()
    league = classify(text)
    sport = sport_group(league)
    policy = _policy(sport)
    points = 10.0
    reasons: list[str] = []

    source = str(candidate.get("sourceHandle") or "").lower().lstrip("@")
    source_points = SOURCE_PRIORS.get(source, 4.0)
    points += source_points
    reasons.append(f"source quality +{source_points:.0f}")

    age_hours = _age_hours(candidate, now)
    freshness = 8.0 if age_hours is None else 24.0 * math.exp(-age_hours / 18.0)
    points += freshness
    reasons.append(f"freshness +{freshness:.1f}")

    views = candidate.get("sourceViewCount")
    view_points = 0.0
    velocity_points = 0.0
    if views is not None:
        try:
            numeric_views = max(0.0, float(views))
            if numeric_views >= 1_000:
                view_points = min(24.0, max(0.0, (math.log10(numeric_views) - 3.0) * 8.0))
            points += view_points
            reasons.append(f"views +{view_points:.1f} ({int(numeric_views):,})")
            if age_hours is not None and age_hours <= 72:
                views_per_hour = numeric_views / max(age_hours, 0.5)
                if views_per_hour >= 1_000_000: velocity_points = 18.0
                elif views_per_hour >= 250_000: velocity_points = 14.0
                elif views_per_hour >= 75_000: velocity_points = 10.0
                elif views_per_hour >= 20_000: velocity_points = 7.0
                elif views_per_hour >= 5_000: velocity_points = 4.0
                points += velocity_points
                if velocity_points:
                    reasons.append(f"view velocity +{velocity_points:.0f} ({int(views_per_hour):,}/hr)")
        except (TypeError, ValueError):
            pass

    elite = _count_terms(lower, ELITE_HIGHLIGHTS)
    strong = _count_terms(lower, STRONG_HIGHLIGHTS)
    stakes = _count_terms(lower, HIGH_STAKES)
    news = _count_terms(lower, BREAKING_NEWS)
    culture = _count_terms(lower, CULTURE_HEAT)
    routine = _count_terms(lower, ROUTINE_TERMS)

    highlight_points = min(28.0, elite * 22.0 + strong * 10.0)
    stakes_points = min(12.0, stakes * 8.0)
    news_points = min(14.0, news * 10.0)
    culture_points = min(9.0, culture * 5.0)
    routine_penalty = min(18.0, routine * 9.0)

    points += highlight_points + stakes_points + news_points + culture_points - routine_penalty
    if highlight_points: reasons.append(f"highlight action +{highlight_points:.0f}")
    if stakes_points: reasons.append(f"stakes +{stakes_points:.0f}")
    if news_points: reasons.append(f"breaking/news +{news_points:.0f}")
    if culture_points: reasons.append(f"viral culture +{culture_points:.0f}")
    if routine_penalty: reasons.append(f"routine-content -{routine_penalty:.0f}")

    highlight_quality = min(
        100.0,
        highlight_points * 2.0 + stakes_points * 1.5 + min(20.0, view_points) + min(18.0, velocity_points)
    )

    if elite or strong:
        content_kind = "highlight"
    elif news:
        content_kind = "breaking_news"
    elif culture:
        content_kind = "sports_culture"
    else:
        content_kind = "routine"

    points += float(policy["preference"])
    reasons.append(f"{sport} rank #{policy['rank']} preference {policy['preference']:+.0f}")

    selection_score = max(0.0, min(100.0, points))
    required_score = float(policy["score_floor"])
    required_highlight = float(policy["highlight_floor"])
    supported = sport in SPORT_POLICIES
    eligible = supported and selection_score >= required_score
    if content_kind == "highlight":
        eligible = eligible and highlight_quality >= required_highlight
    elif content_kind == "routine":
        eligible = eligible and selection_score >= min(100.0, required_score + 8.0)

    reasons.append(f"posting floor {required_score:.0f}")
    if content_kind == "highlight":
        reasons.append(f"highlight quality {highlight_quality:.0f}/{required_highlight:.0f}")
    reasons.append("auto-post eligible" if eligible else "below auto-post threshold")

    candidate.update(
        league=league,
        sportCategory=sport,
        sportRank=int(policy["rank"]),
        contentKind=content_kind,
        deterministicScore=round(selection_score, 2),
        viralScore=round(selection_score, 2),
        highlightQuality=round(highlight_quality, 2),
        postingFloor=required_score,
        highlightFloor=required_highlight,
        eligibleForAutoPost=eligible,
        priority=_priority(selection_score),
        scoreReasons=reasons,
        storyFingerprint=fingerprint(text),
        rankingVersion="sportswire-newsroom-v2",
    )
    return candidate

def apply_history_penalties(candidates: list[dict], history: list[dict]) -> list[dict]:
    """Penalize near-duplicate events and repeated clips without hiding them."""
    ranked: list[dict] = []
    for original in candidates:
        item = dict(original)
        caption = str(item.get("sourceCaption") or "")
        best_similarity = 0.0
        duplicate_of = None
        for old in history:
            if old.get("shortcode") and old.get("shortcode") == item.get("shortcode"):
                continue
            old_caption = str(old.get("sourceCaption") or old.get("publishCaption") or "")
            similarity = story_similarity(caption, old_caption)
            if similarity > best_similarity:
                best_similarity = similarity
                duplicate_of = old.get("shortcode") or old.get("sourceUrl")
        penalty = 0.0
        if best_similarity >= 0.90:
            penalty = 42.0
            item["eligibleForAutoPost"] = False
        elif best_similarity >= 0.80:
            penalty = 26.0
        elif best_similarity >= 0.70:
            penalty = 12.0

        if penalty:
            item["deterministicScore"] = round(max(0.0, float(item.get("deterministicScore") or 0) - penalty), 2)
            item["viralScore"] = item["deterministicScore"]
            item["scoreReasons"] = list(item.get("scoreReasons") or []) + [f"recent-story similarity -{penalty:.0f} ({best_similarity:.2f})"]
            item["duplicateOf"] = duplicate_of
            if item["deterministicScore"] < float(item.get("postingFloor") or 0):
                item["eligibleForAutoPost"] = False
            item["priority"] = _priority(float(item["deterministicScore"]))
        ranked.append(item)
    return ranked

def select_best(candidates: list[dict], limit: int = 1) -> list[dict]:
    eligible = [item for item in candidates if item.get("eligibleForAutoPost")]
    return sorted(eligible, key=lambda item: float(item.get("deterministicScore") or 0), reverse=True)[:max(0, limit)]
