"""Preprocess clips until a 30-post publishing buffer is ready."""
import json
from sportswire_local.newsroom import run, delivery_items

TARGET_READY = 30
MAX_ATTEMPTS_PER_CYCLE = 40

for attempt in range(MAX_ATTEMPTS_PER_CYCLE):
    # A clip already posted to one destination still occupies a publishing
    # slot.  Counting only fully-ready clips kept refilling the buffer while
    # Threads was unavailable, which created an unbounded backlog.
    waiting = sum(1 for item in delivery_items().values()
                  if item.get("status") in {
                      "ready",
                      "instagram_published_threads_pending",
                      "threads_published_instagram_pending",
                  })
    if waiting >= TARGET_READY:
        print(json.dumps({"ready": waiting, "target": TARGET_READY}))
        break
    result = run()
    print(json.dumps(result))
    if not result.get("selected") and result.get("status") != "branding_review":
        break
