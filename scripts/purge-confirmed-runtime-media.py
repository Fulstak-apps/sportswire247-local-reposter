#!/usr/bin/env python3
"""Permanently reclaim collector cache for verified SportsWire publications."""
import json
import pathlib
import shutil
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
QUEUE = ROOT / "queue"
CACHE = ROOT / "runtime" / "media"
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
if CACHE.is_dir():
    for candidate in CACHE.iterdir():
        if not any(candidate.name == code or candidate.name.startswith(f"{code}-") or candidate.name.startswith(f"{code}.") for code in published):
            continue
        if candidate.is_dir():
            shutil.rmtree(candidate)
        elif candidate.is_file():
            candidate.unlink()
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
        if candidate.is_dir():
            shutil.rmtree(candidate)
        elif candidate.is_file():
            candidate.unlink()
        removed += 1
print(f"SportsWire cache cleanup: permanently deleted {removed} confirmed publication artifact(s).")
