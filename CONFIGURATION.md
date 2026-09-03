# Local Sports Reposter configuration

This project is completely separate from RapWire. It uses its own project directory, runtime queue, state, media, logs, launchd label, and Chrome profile. It does not import or write any RapWire file, queue, repository, profile, account, or branding.

## Safe setup order

1. Run `bash scripts/install.sh`. This installs dependencies, creates `config.json`, and writes the launchd definition. It does **not** load the service or publish.
2. Edit `config.json`:
   - `sourceHandles`: Instagram accounts to watch, without `@`.
   - `facebookPageUrl`: exact sports Facebook Page URL.
   - `instagramHandle`: keep `sportswire247`.
   - `threadsHandle`: keep `sportswire247`.
   - `destinations`: Instagram is enabled; Facebook and Threads are disabled.
   - `chromeProfileDir`: dedicated sports-only browser profile. Never point this at RapWire or your normal Chrome profile.
   - `postingGapMinutes`: minimum gap between confirmed Instagram posts; default 10, matching RapWire's current feed pacing.
   - `publishEnabled`: master safety switch. Keep `false` through login, baseline, and verification.
   - `ollama.enabled`: optional caption-draft assistance only. The current routine path never calls Ollama, so collection and publishing continue if it is down.
3. Run `npm run login`. Sign into the non-RapWire sports Instagram account `@sportswire247` in the dedicated window. Close Chrome when done. Facebook and Threads are not destinations.
4. Run `npm run baseline`. Every currently visible source shortcode is recorded with `baseline: true`; none is downloaded or posted. If any source fails, baseline completion remains false.
5. Run `npm test`, then `npm run status`.
6. Run `npm run start` to load the once-per-minute launchd job. Leave `publishEnabled: false` until you explicitly choose to begin live posting. Collection still queues new videos while publishing is disabled.

## Commands

- `npm run start` — load and kick the service.
- `npm run stop` — unload it without deleting state.
- `npm run status` — show launchd, baseline, and queue status.
- `npm run logs` — tail both worker logs.
- `npm run retry -- SHORTCODE` — clear retry delay for one non-complete item; omit shortcode for all. Partial/uncertain cross-posts keep completed destination permalinks and reconcile before retrying.
- `npm run baseline` — deliberately replace the baseline with all currently visible posts.
- `bash scripts/uninstall.sh` — remove only launchd registration; preserve sports data/profile.

## Stored queue fields

Each `runtime/queue/SHORTCODE.json` records the source handle, URL, shortcode, exact source caption, credited publish caption, absolute local video path, discovery/retry times, status, attempts, and per-destination post ID/permalink. A post is only `published` when every enabled destination is verified. Failures remain pending, uncertain, or partially published.

## Important operational notes

- Browser selectors can change when Meta changes its sites. An uncertain result is never treated as complete; the worker searches the destination profile/Page for the caption before another upload.
- `yt-dlp` downloads the best original video/audio streams and merges only when needed. There is no RapWire overlay or sports branding and no caption rewriting.
- macOS must remain awake and logged into the user session. launchd restarts after login/reboot and invokes the worker every 120 seconds, matching RapWire's current scheduler; the PID lock prevents overlapping cycles.
- Instagram/Threads may have their own upload length or format constraints. Those failures remain queued for retry and are never silently marked complete.
