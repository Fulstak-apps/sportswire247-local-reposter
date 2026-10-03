"""Preprocess a selective 12-post publishing buffer for SportsWire growth mode."""
import json
from sportswire_local.newsroom import run, delivery_items

TARGET_READY = 12
MAX_ATTEMPTS_PER_CYCLE = 80

def growth_ready(item: dict) -> bool:
    if item.get("status") != "ready": return False
    if item.get("sportCategory") not in {"basketball", "football", "mlb", "hockey"}: return False
    score = float(item.get("deterministicScore") or 0)
    if item.get("contentKind") == "routine":
        engagement = max(float(item.get("sourceLikeCount") or 0), float(item.get("sourceCommentCount") or 0) * 12, float(item.get("sourceViewCount") or 0) / 50)
        return score >= 70 and engagement >= 10_000
    return score >= 55

for attempt in range(MAX_ATTEMPTS_PER_CYCLE):
    # Instagram is the sole destination, so only clips not yet published to
    # Instagram count toward the 30-post publishing buffer.
    waiting = sum(1 for item in delivery_items().values() if growth_ready(item))
    if waiting >= TARGET_READY:
        print(json.dumps({"ready": waiting, "target": TARGET_READY}))
        break
    try:
        result = run()
    except Exception as error:
        # One corrupt file, failed encode, or transient local service error
        # must not kill queue recovery or the later Git queue push.
        print(json.dumps({"status": "error", "attempt": attempt + 1,
                          "error": f"{type(error).__name__}: {error}"}))
        continue
    print(json.dumps(result))
    if not result.get("selected") and result.get("status") != "branding_review":
        break
