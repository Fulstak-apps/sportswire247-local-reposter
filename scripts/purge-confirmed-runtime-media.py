#!/usr/bin/env python3
"""Permanently reclaim collector cache for verified SportsWire publications."""
import json
import pathlib
import shutil
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
QUEUE = ROOT / "queue"
CACHE = ROOT / "runtime" / "media"
TRASH = pathlib.Path.home() / ".Trash"
published = set()
protected = set()

for record in QUEUE.glob("*.json"):
    try:
        item = json.loads(record.read_text())
    except (OSError, json.JSONDecodeError):
        continue
    if item.get("status") == "published" and item.get("instagramVerifiedAt") and item.get("shortcode"):
        published.add(str(item["shortcode"]))
    elif item.get("shortcode"):
        protected.add(str(item["shortcode"]))

removed = 0
def move_to_trash(candidate):
    TRASH.mkdir(parents=True, exist_ok=True)
    destination = TRASH / f"SportsWire-{int(time.time() * 1000)}-{uuid.uuid4().hex}-{candidate.name}"
    shutil.move(str(candidate), str(destination))

if CACHE.is_dir():
    for candidate in CACHE.iterdir():
        if not any(candidate.name == code or candidate.name.startswith(f"{code}-") or candidate.name.startswith(f"{code}.") for code in published):
            continue
        move_to_trash(candidate)
        removed += 1

# Source captures are copied into the queue delivery asset before publication.
# Keep nonterminal captures for 48 hours; stale cache files cannot be needed by
# an in-flight item and otherwise grow without limit.
cutoff = time.time() - (48 * 60 * 60)
if CACHE.is_dir():
    for candidate in CACHE.iterdir():
        try:
            stale = candidate.stat().st_mtime < cutoff
        except OSError:
            continue
        if not stale or any(candidate.name == code or candidate.name.startswith(f"{code}-") or candidate.name.startswith(f"{code}.") for code in protected):
            continue
        move_to_trash(candidate)
        removed += 1
print(f"SportsWire cache cleanup: moved {removed} confirmed publication artifact(s) to Trash.")
