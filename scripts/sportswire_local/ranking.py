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

# Captions on highlight accounts often omit the league entirely ("Steph hit the
# game winner"). These high-signal entity hints stop those clips from falling
# into the generic sports bucket. Ambiguous single-word team names are avoided.
BASKETBALL_ENTITIES = (
    "lebron", "steph", "steph curry", "curry", "kevin durant", "durant", "jokic",
    "nikola jokic", "luka doncic", "doncic", "giannis", "embiid", "jayson tatum",
    "tatum", "wembanyama", "wemby", "lakers", "celtics", "warriors", "knicks",
    "brooklyn nets", "milwaukee bucks", "76ers", "sixers", "cavaliers", "cavs",
    "mavericks", "mavs", "nuggets", "phoenix suns", "clippers", "timberwolves",
    "okc thunder", "houston rockets", "san antonio spurs", "grizzlies", "pelicans",
    "atlanta hawks", "charlotte hornets", "detroit pistons", "indiana pacers",
    "chicago bulls", "trail blazers", "portland blazers", "toronto raptors",
)
FOOTBALL_ENTITIES = (
    "patrick mahomes", "mahomes", "lamar jackson", "joe burrow", "jalen hurts",
    "cj stroud", "c.j. stroud", "justin herbert", "dak prescott", "justin jefferson",
    "kansas city chiefs", "buffalo bills", "baltimore ravens", "cincinnati bengals",
    "pittsburgh steelers", "cleveland browns", "houston texans", "indianapolis colts",
    "jacksonville jaguars", "tennessee titans", "los angeles chargers", "denver broncos",
    "las vegas raiders", "miami dolphins", "new england patriots", "dallas cowboys",
    "philadelphia eagles", "washington commanders", "green bay packers", "minnesota vikings",
    "tampa bay buccaneers", "atlanta falcons", "new orleans saints", "seattle seahawks",
    "los angeles rams", "49ers", "san francisco 49ers",
)
MLB_ENTITIES = (
    "shohei ohtani", "ohtani", "aaron judge", "juan soto", "mike trout",
    "new york yankees", "los angeles dodgers", "red sox", "chicago cubs", "new york mets",
    "philadelphia phillies", "houston astros", "san diego padres", "atlanta braves",
    "baltimore orioles", "seattle mariners", "milwaukee brewers", "kansas city royals",
    "tampa bay rays", "cleveland guardians", "white sox", "toronto blue jays",
)
HOCKEY_ENTITIES = (
    "connor mcdavid", "mcdavid", "leon draisaitl", "alex ovechkin", "ovechkin",
    "sidney crosby", "crosby", "nathan mackinnon", "auston matthews", "connor bedard",
    "boston bruins", "montreal canadiens", "toronto maple leafs", "edmonton oilers",
    "colorado avalanche", "tampa bay lightning", "new jersey devils", "new york islanders",
    "ottawa senators", "detroit red wings", "vegas golden knights", "seattle kraken",
    "philadelphia flyers", "pittsburgh penguins", "washington capitals", "buffalo sabres",
    "nashville predators", "vancouver canucks", "chicago blackhawks",
)

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
    "viral", "heated", "staredown", "stare down", "troll", "claps back", "hyped", "season opener",
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

def _has_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(_phrase(text, term) for term in terms)

def classify(text: str, source_url: str = "") -> str:
    value = f"{text} {source_url}".lower()

    # Explicit competition/league language always wins over entity inference.
    if _has_any(value, ("wnba", "women's basketball", "womens basketball")):
        return "wnba"
    if _has_any(value, ("college basketball", "ncaa basketball", "march madness", "#cbb", "br_cbb")):
        return "ncaa_basketball"
    if _has_any(value, ("college football", "ncaa football", "cfb", "#cfb", "collegefootball", "ncaafootball", "br_cfb")):
        return "ncaa_football"
    if _has_any(value, ("nba", "basketball", "dunk", "buzzer beater", "three-pointer", "three pointer", "layup", "alley oop", "alley-oop", "jumper")):
        return "nba"
    if _has_any(value, ("nfl", "football", "touchdown", "quarterback", "wide receiver", "interception", "pick six", "field goal")):
        return "nfl"
    if _has_any(value, ("mlb", "baseball", "home run", "homer", "world series", "strikeout", "grand slam", "pitcher", "batter")):
        return "mlb"
    if _has_any(value, ("nhl", "hockey", "stanley cup", "goalie", "puck", "slapshot", "slap shot", "power play", "hat trick")):
        return "nhl"

    # Then use high-confidence athlete/team language for captions that assume
    # the audience already knows the sport.
    if _has_any(value, BASKETBALL_ENTITIES):
        return "nba"
    if _has_any(value, FOOTBALL_ENTITIES):
        return "nfl"
    if _has_any(value, MLB_ENTITIES):
        return "mlb"
    if _has_any(value, HOCKEY_ENTITIES):
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
    if score_value >= 95:
        return "P1"
    if score_value >= 75:
        return "P2"
    if score_value >= 58:
        return "P3"
    return "P4"

def _numeric(candidate: dict, key: str) -> float:
    try:
        return max(0.0, float(candidate.get(key) or 0))
    except (TypeError, ValueError):
        return 0.0

def score(candidate: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    candidate = dict(candidate)
    text = str(candidate.get("sourceCaption") or "")
    lower = text.lower()
    league = classify(text, str(candidate.get("sourceUrl") or ""))
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

    numeric_views = _numeric(candidate, "sourceViewCount")
    numeric_likes = _numeric(candidate, "sourceLikeCount")
    numeric_comments = _numeric(candidate, "sourceCommentCount")

    view_points = 0.0
    velocity_points = 0.0
    if numeric_views >= 1_000:
        view_points = min(24.0, max(0.0, (math.log10(numeric_views) - 3.0) * 8.0))
    points += view_points
    if candidate.get("sourceViewCount") is not None:
        reasons.append(f"views +{view_points:.1f} ({int(numeric_views):,})")
    if numeric_views > 0 and age_hours is not None and age_hours <= 72:
        views_per_hour = numeric_views / max(age_hours, 0.5)
        if views_per_hour >= 1_000_000:
            velocity_points = 18.0
        elif views_per_hour >= 250_000:
            velocity_points = 14.0
        elif views_per_hour >= 75_000:
            velocity_points = 10.0
        elif views_per_hour >= 20_000:
            velocity_points = 7.0
        elif views_per_hour >= 5_000:
            velocity_points = 4.0
        points += velocity_points
        if velocity_points:
            reasons.append(f"view velocity +{velocity_points:.0f} ({int(views_per_hour):,}/hr)")

    # Instagram often hides Reel view counts from the HTML while still exposing
    # likes/comments in OG metadata. Use those as a bounded fallback signal. If
    # views are present, engagement still helps a little but cannot double-count
    # its way past a materially stronger clip.
    like_points = 0.0
    comment_points = 0.0
    engagement_velocity_points = 0.0
    if numeric_likes >= 100:
        like_points = min(10.0, max(0.0, (math.log10(numeric_likes) - 2.0) * 4.0))
    if numeric_comments >= 10:
        comment_points = min(8.0, max(0.0, (math.log10(numeric_comments) - 1.0) * 3.0))
    engagement_scale = 1.0 if numeric_views <= 0 else 0.4
    engagement_points = (like_points + comment_points) * engagement_scale
    points += engagement_points
    if numeric_likes or numeric_comments:
        reasons.append(
            f"engagement +{engagement_points:.1f} ({int(numeric_likes):,} likes, {int(numeric_comments):,} comments)"
        )

    if age_hours is not None and age_hours <= 72 and (numeric_likes or numeric_comments):
        # Comments are weighted more heavily because discussion/reaction is a
        # better viral signal than a passive like. This is still deterministic
        # and uses only visible source metrics.
        interaction_rate = (numeric_likes + numeric_comments * 8.0) / max(age_hours, 0.5)
        if interaction_rate >= 100_000:
            engagement_velocity_points = 10.0
        elif interaction_rate >= 25_000:
            engagement_velocity_points = 8.0
        elif interaction_rate >= 7_500:
            engagement_velocity_points = 6.0
        elif interaction_rate >= 2_000:
            engagement_velocity_points = 4.0
        elif interaction_rate >= 500:
            engagement_velocity_points = 2.0
        engagement_velocity_points *= engagement_scale
        points += engagement_velocity_points
        if engagement_velocity_points:
            reasons.append(
                f"engagement velocity +{engagement_velocity_points:.1f} ({int(interaction_rate):,}/hr weighted)"
            )

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
    if highlight_points:
        reasons.append(f"highlight action +{highlight_points:.0f}")
    if stakes_points:
        reasons.append(f"stakes +{stakes_points:.0f}")
    if news_points:
        reasons.append(f"breaking/news +{news_points:.0f}")
    if culture_points:
        reasons.append(f"viral culture +{culture_points:.0f}")
    if routine_penalty:
        reasons.append(f"routine-content -{routine_penalty:.0f}")

    highlight_quality = min(
        100.0,
        highlight_points * 2.0
        + stakes_points * 1.5
        + min(20.0, view_points)
        + min(18.0, velocity_points)
        + min(14.0, engagement_points + engagement_velocity_points),
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

    # Do not clamp the ranking score. Two elite clips can both be 100/100 viral,
    # but the better/fresher/faster one still needs to win selection.
    selection_score = max(0.0, points)
    viral_score = min(100.0, selection_score)
    required_score = float(policy["score_floor"])
    required_highlight = float(policy["highlight_floor"])
    supported = sport in SPORT_POLICIES
    eligible = supported and selection_score >= required_score
    if content_kind == "highlight":
        eligible = eligible and highlight_quality >= required_highlight
    elif content_kind == "routine":
        eligible = eligible and selection_score >= min(100.0, required_score + 8.0)
    # Source-backed reactions and game clips need not go viral before selection.
    # Keep sport identification, freshness and downstream media/duplicate QA.
    if supported and age_hours is not None and age_hours <= 72:
        if numeric_likes >= 1000 or numeric_comments >= 50:
            eligible = selection_score >= required_score - 12
            if eligible: reasons.append("recent supported sport with observed audience engagement")

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
        rawScore=round(selection_score, 2),
        viralScore=round(viral_score, 2),
        engagementScore=round(engagement_points + engagement_velocity_points, 2),
        highlightQuality=round(highlight_quality, 2),
        postingFloor=required_score,
        highlightFloor=required_highlight,
        scoreMargin=round(selection_score - required_score, 2),
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
            adjusted = max(0.0, float(item.get("deterministicScore") or 0) - penalty)
            item["deterministicScore"] = round(adjusted, 2)
            item["rawScore"] = round(adjusted, 2)
            item["viralScore"] = round(min(100.0, adjusted), 2)
            item["scoreMargin"] = round(adjusted - float(item.get("postingFloor") or 0), 2)
            item["scoreReasons"] = list(item.get("scoreReasons") or []) + [
                f"recent-story similarity -{penalty:.0f} ({best_similarity:.2f})"
            ]
            item["duplicateOf"] = duplicate_of
            if adjusted < float(item.get("postingFloor") or 0):
                item["eligibleForAutoPost"] = False
            item["priority"] = _priority(adjusted)
        ranked.append(item)
    return ranked

def select_best(candidates: list[dict], limit: int = 1) -> list[dict]:
    eligible = [item for item in candidates if item.get("eligibleForAutoPost")]
    return sorted(
        eligible,
        key=lambda item: (
            float(item.get("deterministicScore") or 0),
            float(item.get("highlightQuality") or 0),
            -int(item.get("sportRank") or 99),
        ),
        reverse=True,
    )[:max(0, limit)]
