"""Preprocess clips until a 30-post publishing buffer is ready."""
import json
from sportswire_local.newsroom import run, delivery_items

TARGET_READY = 30
MAX_ATTEMPTS_PER_CYCLE = 80

for attempt in range(MAX_ATTEMPTS_PER_CYCLE):
    # Instagram is the sole destination, so only clips not yet published to
    # Instagram count toward the 30-post publishing buffer.
    waiting = sum(1 for item in delivery_items().values()
                  if item.get("status") == "ready")
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
