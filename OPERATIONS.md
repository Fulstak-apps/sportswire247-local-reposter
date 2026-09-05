# SportsWire 24/7 Operations

This repository is the isolated local-first newsroom and Meta publisher for `@sportswire247`. It does not read or write RapWire credentials, queues, media, IDs, ledgers, folders, or destinations.

## Runtime

The Mac launch agent `com.sportswire247.newsroom` runs every five minutes from `~/Library/Application Support/SportsWire/publisher-runtime`. It uses the dedicated SportsWire Chrome profile to discover authorized video posts, records Instagram shortcodes before processing, downloads complete video/audio, and prepares one ranked candidate. Ollama `qwen3:4b` supplies optional local wording; exact source copy is the fallback when Ollama is unavailable or malformed.

The local job writes only SportsWire `queue/`, `media/`, and `logs/`, then fetches, rebases, and pushes without force. A conflict stops delivery while preserving the local commit. GitHub Actions publishes at most one feed item at a time to Instagram and Threads. Each platform has its own cooldown, spacing, attempt state, container ID, media ID, and permalink verification.

Development is left in `review` mode with `publishEnabled: false`. `--dry-run` is strictly read-only and never locks, writes, commits, pushes, collects, or publishes. Change to `autonomous` only after account and media-host configuration is complete and reviewed.

## Newsroom v2 ranking

SportsWire's editorial hierarchy is:

1. basketball
2. football
3. MLB/baseball
4. hockey

This hierarchy is enforced with progressively stricter posting thresholds, not an absolute league sort. A truly exceptional hockey or MLB clip can outrank a weak basketball post, but lower-ranked sports must prove more highlight quality and/or virality before they are eligible.

Default overall score floors are basketball `45`, football `52`, MLB `60`, and hockey `66`. Default highlight-quality floors are `28`, `36`, `46`, and `54` respectively. The overall floors can be tuned through `SPORTSWIRE_BASKETBALL_FLOOR`, `SPORTSWIRE_FOOTBALL_FLOOR`, `SPORTSWIRE_MLB_FLOOR`, and `SPORTSWIRE_HOCKEY_FLOOR`.

The deterministic v2 ranker uses visible views, estimated views/hour, freshness decay, source quality, elite/strong highlight signals, playoff/championship stakes, breaking news, sports-culture heat, routine-content penalties, and recent-story similarity. Unsupported sports do not auto-post. See `docs/NEWSROOM_V2.md` for the full scoring contract.

## Commands

```sh
cd "$HOME/Library/Application Support/SportsWire/publisher-runtime"
npm run newsroom:health
npm run newsroom:dry-run
scripts/run-local-newsroom.sh --dry-run
npm run newsroom:install
launchctl print "gui/$(id -u)/com.sportswire247.newsroom"
tail -f runtime/logs/newsroom.out.log runtime/logs/newsroom.err.log
launchctl kickstart -k "gui/$(id -u)/com.sportswire247.newsroom"
launchctl bootout "gui/$(id -u)/com.sportswire247.newsroom"
```

## Required account setup

Configure these repository secrets on `Fulstak-apps/sportswire247-local-reposter`: `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `THREADS_ACCESS_TOKEN`, and `THREADS_USER_ID`. The Instagram account must be a Meta-supported professional account, the Threads identity must be eligible for API publishing, and each token must have the appropriate publishing permissions.

Meta must be able to fetch each queued video by public HTTPS URL. Configure `MEDIA_BASE_URL` to a public, access-controlled media origin containing the committed `media/` paths when needed. Never place tokens in config files or commits.

## Media and editorial gates

Only configured, authorized source accounts are accepted. Video must contain video plus audio and finish as H.264/AAC. Five frames are sampled with local Apple Vision OCR/face detection. The full source frame is retained; the bottom-left SportsWire logo shrinks to avoid detected text/faces, and ambiguous content is held for review. Captions preserve source meaning, include `Source: @handle`, and end with `@sportswire247`.

Serious medical, death, criminal, or legal items require explicit reporting verification. Unsupported sources, stale non-viral posts, unverified tags, duplicate/near-duplicate stories, missing media, wrong-athlete evidence, below-threshold clips, and RapWire contamination fail closed.

## Publication recovery

Container IDs are saved immediately. A publish-request timestamp is saved before the non-idempotent publish call. If the response is uncertain, the item is marked for reconciliation and is never blindly republished. A post is complete only after both the returned media ID and permalink are verified. Platform failures remain independent.
