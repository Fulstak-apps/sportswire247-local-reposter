# Sports reposter setup status

Installed project: `/Users/dw/Documents/Codex/2026-09-03/set-up-a-24-7-sports-2`

- launchd service `com.local.sports-reposter` loaded and active on its 120-second schedule
- independent keep-awake service `com.local.sports-reposter.keep-awake` loaded for AC-power 24/7 operation
- poll interval: 120 seconds (matches current RapWire scheduler)
- crash throttle/restart: 60 seconds
- destination: Instagram `@sportswire247` only; Facebook and Threads disabled
- branding: exact supplied SportsWire 24/7 logo, bottom-left on every outgoing video
- private GitHub backup: `https://github.com/Fulstak-apps/sportswire247-local-reposter`
- Ollama: local `qwen3:4b`; health checked without making it a publishing dependency
- publishing: enabled for new post-baseline videos only
- approved sources configured: `@houseofhighlights`, `@sportscenter`, `@bleacherreport`, `@overtime`, `@jomboymedia`
- baseline: completed from 60 visible posts on 2026-09-03
- dedicated sports Chrome login: verified as `@sportswire247` with no RapWire profile link
- local policy and branding tests: 6 passed, 0 failed
- first live worker cycle: 60 source posts discovered, 0 newly eligible, 0 errors, queue empty

The launchd worker is ready to collect and publish only new post-baseline videos to `@sportswire247`.
