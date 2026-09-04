from __future__ import annotations
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import json, os, shutil
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
        candidates = [x for x in read_items() if x.get("status") in {"pending", "review", "held"} and x.get("localVideoPath")]
        ranked = sorted((score(x) for x in candidates), key=lambda x: x["deterministicScore"], reverse=True)
        selected = prepare(ranked[0], config, approved) if ranked else None
        result = {"at": datetime.now(timezone.utc).isoformat(), "dryRun": dry_run, "mode": config.get("mode"), "sourcesChecked": sorted(approved), "candidates": [{"shortcode": x.get("shortcode"), "league": x.get("league"), "score": x.get("deterministicScore"), "reasons": x.get("scoreReasons")} for x in ranked], "selected": selected, "gitResult": "not attempted (dry-run)" if dry_run else "local queue only"}
        if selected and not dry_run:
            current = json.loads((INBOX_QUEUE / f"{selected['shortcode']}.json").read_text())
            QUEUE.mkdir(parents=True, exist_ok=True); MEDIA.mkdir(parents=True, exist_ok=True)
            media_target = MEDIA / f"{selected['shortcode']}-sportswire247.mp4"
            shutil.copy2(Path(current["localVideoPath"]), media_target)
            current.update({k: selected[k] for k in ("publishCaption", "threadsText", "contentLane", "confidence", "ollamaStatus", "qa", "deterministicScore", "scoreReasons", "storyFingerprint")})
            current.update({"status": selected["proposedStatus"], "video": str(media_target.relative_to(ROOT)), "brand": "SportsWire 247", "destinationHandle": "sportswire247", "instagramStatus": "pending", "threadsStatus": "pending"})
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
    checks["developmentSafety"] = config.get("instagramHandle") == "sportswire247" and not config.get("publishEnabled", False)
    checks["metaCredentialsPresentLocally"] = all(os.environ.get(name) for name in (
        "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID", "THREADS_ACCESS_TOKEN", "THREADS_USER_ID"
    ))
    checks["rapwireIsolation"] = not any("RapWire" in str(p) for p in (ROOT, QUEUE, MEDIA, LOGS, STATE))
    required = ("repo", "inboxQueue", "queue", "media", "ollama", "modelInstalled", "gitUsable", "schedulerPlist", "developmentSafety", "rapwireIsolation")
    return {"healthy": all(checks[name] for name in required), "publishReady": checks["metaCredentialsPresentLocally"] and checks["developmentSafety"], "checks": checks, "mode": config.get("mode"), "publishingDisabledDuringDevelopment": not config.get("publishEnabled", False)}
