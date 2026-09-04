from __future__ import annotations
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import json, os, shutil, subprocess
from pathlib import Path
from .config import ROOT, INBOX_QUEUE, QUEUE, MEDIA, LOGS, STATE, load_config, sources
from .ranking import score
from .qa import evaluate
from .ollama import generate

def read_items() -> list[dict]:
    items = []
    if not INBOX_QUEUE.is_dir(): return items
    for file in INBOX_QUEUE.glob("*.json"):
        try: items.append(json.loads(file.read_text()))
        except Exception: pass
    return items

def delivery_items() -> dict[str, dict]:
    """Read the GitHub-backed delivery queue without trusting stale inbox state.

    The inbox is intentionally durable local collection state.  The delivery
    queue is the publishing source of truth, so a collector cycle must never
    replace a verified platform result with an older inbox copy.
    """
    items: dict[str, dict] = {}
    if not QUEUE.is_dir(): return items
    for file in QUEUE.glob("*.json"):
        try:
            value = json.loads(file.read_text())
            if value.get("shortcode"): items[value["shortcode"]] = value
        except Exception: pass
    return items

ACTIVE_DELIVERY_STATUSES = {
    "ready", "publishing_uncertain", "partially_published",
    "instagram_published_threads_pending", "threads_published_instagram_pending",
    "published",
}

def preserve_delivery_state(staged: dict, existing: dict | None) -> dict:
    """Keep publication facts owned by the publisher, never the collector."""
    if not existing: return staged
    for key, value in existing.items():
        if key.startswith(("instagram", "threads")) or key in {
            "status", "publishedAt", "publicationResult", "uncertainDestination",
            "publishRequestedAt", "nextRetryAt", "lastError",
        }:
            staged[key] = value
    return staged

@contextmanager
def lock():
    STATE.mkdir(parents=True, exist_ok=True)
    path = STATE / "newsroom.lock"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, json.dumps({"pid": os.getpid(), "startedAt": datetime.now(timezone.utc).isoformat()}).encode()); os.close(fd)
    except FileExistsError: raise RuntimeError("newsroom run already active")
    try: yield
    finally: path.unlink(missing_ok=True)

def prepare(item: dict, config: dict, approved: set[str]) -> dict:
    ranked = score(item)
    generated, ollama_status = {}, "fallback_source_caption"
    try:
        generated = generate(config, {k: ranked.get(k) for k in ("sourceCaption", "sourceHandle", "sourceUrl", "league", "sourceViewCount", "sourcePublishedAt")})
        ollama_status = "local_ollama"
    except Exception as error: ollama_status = f"fallback_source_caption: {type(error).__name__}"
    body = generated.get("caption") or ranked.get("sourceCaption", "")
    credit = f"Source: @{ranked.get('sourceHandle', '')}"
    ranked["publishCaption"] = f"{body}\n\n{credit}\n\n@sportswire247"
    ranked["threadsText"] = generated.get("threads_text") or body
    ranked["contentLane"] = generated.get("content_lane") or "viral_sports"
    ranked["confidence"] = generated.get("confidence") or "reported"
    ranked["ollamaStatus"] = ollama_status
    ranked["qa"] = evaluate(ranked, approved)
    ranked["proposedStatus"] = "ready" if ranked["qa"]["ready"] and config.get("mode") == "autonomous" else "review" if ranked["qa"]["ready"] else "held"
    return ranked

def run(dry_run: bool = False) -> dict:
    config = load_config(); registry = sources(); approved = {x["handle"] for x in registry}
    # A dry run is strictly read-only: it does not even create the overlap lock.
    with (nullcontext() if dry_run else lock()):
        deliveries = delivery_items()
        # Once a record is handed to the delivery lane, leave it alone until
        # that lane has resolved it. This prevents a second collection cycle
        # from racing a Meta verification and erasing its idempotency record.
        candidates = [x for x in read_items()
            if x.get("status") in {"pending", "review", "held"}
            and x.get("localVideoPath")
            and deliveries.get(x.get("shortcode"), {}).get("status") not in ACTIVE_DELIVERY_STATUSES]
        ranked = sorted((score(x) for x in candidates), key=lambda x: x["deterministicScore"], reverse=True)
        selected = prepare(ranked[0], config, approved) if ranked else None
        result = {"at": datetime.now(timezone.utc).isoformat(), "dryRun": dry_run, "mode": config.get("mode"), "sourcesChecked": sorted(approved), "candidates": [{"shortcode": x.get("shortcode"), "league": x.get("league"), "score": x.get("deterministicScore"), "reasons": x.get("scoreReasons")} for x in ranked], "selected": selected, "gitResult": "not attempted (dry-run)" if dry_run else "local queue only"}
        if selected and not dry_run:
            current = json.loads((INBOX_QUEUE / f"{selected['shortcode']}.json").read_text())
            if not current.get("branding", {}).get("bottomMargin"):
                # Re-render from the full original, never stack a second logo.
                source = current.get("sourceVideoPath")
                if not source or not Path(source).is_file():
                    raise RuntimeError("Original video required to update logo placement")
                subprocess.run(["node", "--input-type=module", "-e",
                    "import fs from 'node:fs/promises'; import {brandVideo} from './src/collector.mjs'; "
                    "await brandVideo(JSON.parse(await fs.readFile('config.json','utf8')),process.argv[1],process.argv[2]);",
                    source, current["localVideoPath"]], cwd=ROOT, check=True)
            existing = deliveries.get(selected["shortcode"])
            QUEUE.mkdir(parents=True, exist_ok=True); MEDIA.mkdir(parents=True, exist_ok=True)
            media_target = MEDIA / f"{selected['shortcode']}-sportswire247.mp4"
            shutil.copy2(Path(current["localVideoPath"]), media_target)
            current.update({k: selected[k] for k in ("publishCaption", "threadsText", "contentLane", "confidence", "ollamaStatus", "qa", "deterministicScore", "scoreReasons", "storyFingerprint")})
            current.update({"status": selected["proposedStatus"], "video": str(media_target.relative_to(ROOT)), "brand": "SportsWire 247", "destinationHandle": "sportswire247", "instagramStatus": "pending", "threadsStatus": "pending"})
            current = preserve_delivery_state(current, existing)
            current.pop("localVideoPath", None); current.pop("sourceVideoPath", None)
            (QUEUE / f"{selected['shortcode']}.json").write_text(json.dumps(current, indent=2) + "\n")
        LOGS.mkdir(parents=True, exist_ok=True)
        if not dry_run:
            with (LOGS / "newsroom.jsonl").open("a") as log: log.write(json.dumps(result) + "\n")
        return result

def health() -> dict:
    import subprocess, urllib.request
    config = load_config(); checks = {}
    checks["repo"] = ROOT.is_dir() and (ROOT / ".git").exists()
    checks["inboxQueue"] = INBOX_QUEUE.is_dir(); checks["queue"] = QUEUE.is_dir(); checks["media"] = MEDIA.is_dir()
    try:
        with urllib.request.urlopen(config["ollama"]["url"].rstrip("/") + "/api/tags", timeout=5) as response:
            models = [x["name"] for x in json.loads(response.read()).get("models", [])]
        checks["ollama"] = True; checks["modelInstalled"] = config["ollama"]["model"] in models
    except Exception: checks["ollama"] = checks["modelInstalled"] = False
    checks["gitUsable"] = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=ROOT, capture_output=True).returncode == 0
    checks["schedulerPlist"] = (Path.home() / "Library/LaunchAgents/com.sportswire247.newsroom.plist").exists()
    checks["destinationSafety"] = (
        config.get("instagramHandle") == "sportswire247"
        and config.get("threadsHandle") == "sportswire247"
        and config.get("destinations", {}).get("facebook") is False
    )
    checks["metaCredentialsPresentLocally"] = all(os.environ.get(name) for name in (
        "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID", "THREADS_ACCESS_TOKEN", "THREADS_USER_ID"
    ))
    checks["rapwireIsolation"] = not any("RapWire" in str(p) for p in (ROOT, QUEUE, MEDIA, LOGS, STATE))
    required = ("repo", "inboxQueue", "queue", "media", "ollama", "modelInstalled", "gitUsable", "schedulerPlist", "destinationSafety", "rapwireIsolation")
    return {"healthy": all(checks[name] for name in required), "publishReady": checks["metaCredentialsPresentLocally"] and config.get("publishEnabled", False), "checks": checks, "mode": config.get("mode"), "publishingEnabled": bool(config.get("publishEnabled", False))}
