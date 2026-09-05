"""Preprocess clips until a 30-post publishing buffer is ready."""
import json
from sportswire_local.newsroom import run, delivery_items

TARGET_READY = 30
MAX_ATTEMPTS_PER_CYCLE = 40

for attempt in range(MAX_ATTEMPTS_PER_CYCLE):
    waiting = sum(1 for item in delivery_items().values()
                  if item.get("status") == "ready")
    if waiting >= TARGET_READY:
        print(json.dumps({"ready": waiting, "target": TARGET_READY}))
        break
    result = run()
    print(json.dumps(result))
    if not result.get("selected") and result.get("status") != "branding_review":
        break
