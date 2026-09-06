# Reliability repairs

The local independent backup service is `com.sportswire247.backup`. Every five
minutes it checks GitHub publisher runs, skips active runs, and retries missing
or failed runs with a ten-minute dispatch cooldown. Local Ollama supplies an
optional explanation; deterministic recovery works without it. Status is in
`runtime/state/backup-health.json`. No Codex inference is used by this service.

Publishing enforces a 30-minute gap including uncertain requests. Uncertain
clips are reconciled against recent destination posts using a unique exact
caption and request-time window. Unmatched clips remain locked for review;
they are never automatically reposted. Other clips may proceed after the gap.

Preparation skips QA-held clips, avoids a second caption-generation call,
and uses a kernel lock released automatically after crashes. Uploads retry
committed changes even when no new files are staged. Failed containers are
replaced only before any publish request. Account-wide errors retain cooldowns.

Remaining operational limits: Mac must remain awake and online; Meta or GitHub
outages can delay posting. Auth failures and ambiguous publications can require
manual intervention. A schedule is not a guarantee of exact wall-clock delivery.
