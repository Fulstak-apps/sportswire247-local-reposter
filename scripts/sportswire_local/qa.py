from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
import json, re, subprocess

SERIOUS = re.compile(r"\b(died|death|killed|critical condition|medical emergency|sexual assault|rape|murder|fatal|catastrophic)\b", re.I)
PLAYFUL = re.compile(r"(?:😂|🤣|💀|😭|refs sold|who you got|trippin|crazy)", re.I)
INJURY_OVERCLAIM = re.compile(r"\b(torn acl|out for season|career[- ]ending)\b", re.I)
LEGAL = re.compile(r"\b(arrested|charged|lawsuit|court|crime|criminal|assault|investigation)\b", re.I)
HANDLE = re.compile(r"(?<!\w)@([A-Za-z0-9_.]+)")

def media_probe(path: str) -> tuple[bool, str]:
    target = Path(path)
    if not target.is_file(): return False, "missing media"
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height:format=duration", "-of", "json", str(target)], capture_output=True, text=True)
    if result.returncode: return False, "corrupt media"
    detail = json.loads(result.stdout); streams = detail.get("streams", [])
    video = next((x for x in streams if x.get("codec_type") == "video"), None)
    audio = next((x for x in streams if x.get("codec_type") == "audio"), None)
    if not video or not audio: return False, "video and audio required"
    if video.get("codec_name") != "h264" or audio.get("codec_name") != "aac": return False, "Instagram requires H.264/AAC"
    if not video.get("width") or not video.get("height") or float(detail.get("format", {}).get("duration") or 0) <= 0: return False, "invalid dimensions/duration"
    return True, "H.264/AAC video/audio verified"

def evaluate(item: dict, approved_handles: set[str], existing_fingerprints: set[str] | None = None) -> dict:
    reasons = []
    if item.get("sourceHandle") not in approved_handles: reasons.append("unsupported source")
    if not item.get("sourceUrl") or not item.get("shortcode"): reasons.append("source URL/shortcode missing")
    if not item.get("sourceCaption"): reasons.append("source evidence caption missing")
    ok, media_reason = media_probe(item.get("localVideoPath", ""))
    if not ok: reasons.append(media_reason)
    source_caption = item.get("sourceCaption", "")
    caption = item.get("publishCaption", "")
    if SERIOUS.search(source_caption) and PLAYFUL.search(caption): reasons.append("serious-content tone violation")
    if INJURY_OVERCLAIM.search(caption) and not INJURY_OVERCLAIM.search(source_caption): reasons.append("injury claim exceeds evidence")
    published = item.get("sourcePublishedAt")
    if published:
        try:
            age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(published.replace("Z", "+00:00"))).total_seconds() / 86400
            popular = float(item.get("sourceViewCount") or 0) >= 1_000_000
            if age_days > 30 or (age_days > 7 and not popular): reasons.append("stale story")
        except (ValueError, TypeError): reasons.append("invalid publication time")
    if (LEGAL.search(source_caption) or SERIOUS.search(source_caption)) and not item.get("reportingVerified"):
        reasons.append("serious/legal reporting not verified")
    allowed_tags = set(item.get("verifiedHandles", [])) | {item.get("sourceHandle", ""), "sportswire247"}
    if any(handle not in allowed_tags for handle in HANDLE.findall(caption)): reasons.append("unverified athlete handle")
    expected = set(item.get("expectedAthletes", [])); detected = set(item.get("detectedAthletes", []))
    if expected and detected and expected.isdisjoint(detected): reasons.append("wrong athlete image")
    if item.get("branding", {}).get("logoApplied") and not item.get("branding", {}).get("contentSafeChecked"): reasons.append("logo placement not content-safe verified")
    if existing_fingerprints and item.get("storyFingerprint") in existing_fingerprints: reasons.append("duplicate story fingerprint")
    if item.get("rankingVersion") == "sportswire-newsroom-v2" and not item.get("eligibleForAutoPost", False):
        reasons.append("below sport-specific posting threshold")
    if "rapwire" in (caption + item.get("localVideoPath", "") + item.get("sourceUrl", "")).lower(): reasons.append("RapWire cross-post contamination")
    return {"ready": not reasons, "reasons": reasons, "media": media_reason}
