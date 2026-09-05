"""Prepare a small batch each cycle until ten approved videos are waiting."""
import json
from sportswire_local.newsroom import run, delivery_items

for attempt in range(3):
    waiting = sum(1 for item in delivery_items().values()
                  if item.get("status") == "ready")
    if waiting >= 10:
        print(json.dumps({"ready": waiting, "target": 10}))
        break
    result = run()
    print(json.dumps(result))
    if not result.get("selected") and result.get("status") != "branding_review":
        break
