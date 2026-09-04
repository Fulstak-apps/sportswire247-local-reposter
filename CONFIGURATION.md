# Local Sports Reposter configuration

This project is completely separate from RapWire. It uses its own project directory, runtime queue, state, media, logs, launchd label, Chrome profile, source registry, and GitHub repository. It does not import or write any RapWire file, queue, repository, profile, account, or branding.

The autonomous newsroom runs in `review` mode during development. `python3 scripts/local-sportswire.py --dry-run` ranks the existing sports candidates, calls local Ollama when available, and prints a complete READY/HOLD proposal without changing queue, Git, or any social account. Autonomous mode is enabled only by setting `mode` to `autonomous`; `publishEnabled` remains a separate final safety switch.

Source code and offline tests are backed up in the private repository `Fulstak-apps/sportswire247-local-reposter`. Secrets, `config.json`, Chrome cookies, downloaded videos, logs, queue items, and publication state remain local and are gitignored.

## Safe setup order

1. Run `bash scripts/install.sh`. This installs dependencies, creates `config.json`, and writes the launchd definition. It does **not** load the service or publish.
2. Edit `config.json`:
   - `sourceHandles`: Instagram accounts to watch, without `@`.
   - `instagramHandle`: keep `sportswire247`.
   - `destinations`: keep Instagram enabled and Facebook/Threads disabled.
   - `chromeProfileDir`: dedicated sports-only browser profile. Never point this at RapWire or your normal Chrome profile.
   - `postingGapMinutes`: minimum gap between confirmed Instagram posts; default 10, matching RapWire's current feed pacing.
   - `publishEnabled`: master safety switch. Keep `false` through login, baseline, and verification.
   - `ollama.enabled`: local Ollama caption editing. It can improve punctuation and line breaks, but is blocked from adding or removing facts, names, scores, hashtags, or attribution. If Ollama is unavailable, the exact source caption is used instead; no ChatGPT credits are involved.
3. Run `npm run mirror:login`. Sign into the non-RapWire sports Instagram account `@sportswire247` in the dedicated window. Close Chrome when done. Facebook and Threads are not destinations.
4. Run `npm run baseline`. Every currently visible source shortcode is recorded with `baseline: true`; none is downloaded or posted. If any source fails, baseline completion remains false.
5. Run `npm test`, then `npm run status`.
6. Run `npm run start` to load the RapWire-style local monitor. It runs after login/reboot, restarts after a crash, and checks every 120 seconds. The publisher enforces the separate 10-minute posting gap.

## Commands

- `npm run start` — load and kick the service.
- `npm run stop` — unload it without deleting state.
- `npm run status` — show launchd, baseline, and queue status.
- `npm run logs` — tail both worker logs.
- `npm run retry -- SHORTCODE` — clear retry delay for one non-complete item; omit shortcode for all. Partial/uncertain cross-posts keep completed destination permalinks and reconcile before retrying.
- `npm run newsroom:dry-run` — rank, locally edit, and QA candidates without writing or publishing.
- `npm run newsroom:health` — verify Ollama/model, repository, isolated paths, queue/media, scheduler, and disabled development publisher.
- `npm run newsroom:install` — install the separate `com.sportswire247.newsroom` five-minute LaunchAgent; installation never publishes.
- `npm run repost:monitor` — run exactly one local collector/publisher cycle, using only the SportsWire247 profile.
- `npm run dispatch` — run the GitHub verification-workflow dispatcher for this separate repository. It never dispatches or touches RapWire.
- `npm run baseline` — deliberately replace the baseline with all currently visible posts.
- `bash scripts/uninstall.sh` — remove only launchd registration; preserve sports data/profile.

## Stored queue fields

Each `runtime/queue/SHORTCODE.json` records the source handle, URL, shortcode, exact source caption, credited publish caption, absolute local video path, discovery/retry times, status, attempts, and per-destination post ID/permalink. A post is only `published` when every enabled destination is verified. Failures remain pending, uncertain, or partially published.

## Important operational notes

- Browser selectors can change when Meta changes its sites. An uncertain result is never treated as complete; the worker searches the destination profile/Page for the caption before another upload.
- Authenticated Chrome captures the exact visible source stream with its audio; it does not rely on a shared downloader or any RapWire process. The source caption is kept and only `Source: @SOURCEHANDLE` is appended.
- Every publish asset retains the full source frame—there is no aspect-ratio crop—so embedded captions and subtitles stay in view. The exact supplied SportsWire 24/7 RGBA logo is bottom-left. The full video duration is validated, audio is preserved as AAC, and an unbranded or silent render is refused. The post caption is also present below the video as an accessible fallback.
- macOS must remain plugged in and logged into the user session. The separate `com.local.sports-reposter.keep-awake` agent prevents idle sleep while on AC power. The main launchd agent restarts after login/reboot and invokes the worker every 120 seconds, matching RapWire's current scheduler; the PID lock prevents overlapping cycles.
- Instagram/Threads may have their own upload length or format constraints. Those failures remain queued for retry and are never silently marked complete.
