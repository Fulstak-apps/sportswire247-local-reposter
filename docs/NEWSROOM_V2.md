# SportsWire 24/7 Newsroom v2

SportsWire Newsroom v2 is a free/local-first ranking upgrade for the existing SportsWire247 collector and Meta publisher. It keeps Ollama `qwen3:4b`, the existing five-minute Mac launch agent, the existing branded-video pipeline, and the existing Instagram/Threads delivery safeguards.

## Editorial hierarchy

The page is intentionally optimized in this order:

1. Basketball
2. Football
3. MLB / baseball
4. Hockey

This is **not** implemented as a hard +4000/+3000/+2000/+1000 sort. Instead, each sport has a progressively stricter posting floor. That means a spectacular hockey highlight can beat a weak basketball clip, but ordinary hockey content will not crowd out the page.

| Sport | Rank | Default viral-score floor | Default highlight-quality floor |
| --- | ---: | ---: | ---: |
| Basketball | 1 | 45 | 28 |
| Football | 2 | 52 | 36 |
| MLB / baseball | 3 | 60 | 46 |
| Hockey | 4 | 66 | 54 |

The score floors can be tuned without paid services:

- `SPORTSWIRE_BASKETBALL_FLOOR`
- `SPORTSWIRE_FOOTBALL_FLOOR`
- `SPORTSWIRE_MLB_FLOOR`
- `SPORTSWIRE_HOCKEY_FLOOR`

The production runner exports the defaults automatically.

## What v2 scores

The deterministic ranker now combines:

- freshness with time decay instead of a crude one-hour bucket;
- raw visible views;
- estimated visible views per hour for early momentum;
- source quality priors;
- elite highlight signals such as game-winners, buzzer beaters, walk-offs, poster dunks, Hail Marys, pick-sixes, grand slams, goalie robberies, and overtime winners;
- strong highlight signals such as touchdowns, home runs, interceptions, sacks, saves, goals, strikeouts, fights, ejections, blocks, and steals;
- high-stakes context such as playoffs, Finals, Super Bowl, World Series, Stanley Cup, Game 7, overtime, and elimination games;
- breaking/news signals such as trades, signings, firings, records, suspensions, injury updates, and retirement announcements;
- sports-culture heat such as trash talk, mic'd-up moments, celebrations, fan/bench reactions, trolls, and viral/funny moments;
- penalties for routine practice, warmups, press conferences, arrivals, walkthroughs, and workouts;
- near-duplicate penalties against recent SportsWire delivery history.

The classifier also recognizes high-confidence player/team language and source-URL hints. A caption such as `Steph hit the game winner` no longer needs to literally say `NBA`, and a `br_cfb` source URL can identify college football even when the caption is shorthand.

Every candidate exposes `viralScore`, `rawScore`, `scoreMargin`, `highlightQuality`, `postingFloor`, `highlightFloor`, `sportRank`, `contentKind`, `priority`, `eligibleForAutoPost`, and human-readable `scoreReasons`.

`viralScore` is normalized to a 0-100 display score. `rawScore` / `deterministicScore` are intentionally allowed to exceed 100 so two elite clips do not tie just because both are excellent. Selection uses the raw ranking score first, then highlight quality and the sport hierarchy as tie-breakers.

## Highlight rule

A clip must clear both its overall sport posting floor and its sport-specific highlight-quality floor when it is classified as a highlight. This directly implements the rule that the lower a sport is in the SportsWire hierarchy, the better the highlight must be.

Routine content also needs extra proof above the normal posting floor. Unsupported sports are not auto-posted by v2.

## Viral voice

Ollama remains optional and local. It receives the deterministic ranking metadata so it knows whether the item is an elite highlight, breaking news, or sports culture. It is instructed to lead with the strongest verified part of the moment, sound concise and sports-native, and never invent scores, injuries, trades, quotes, records, or facts. Exact source copy remains the safe fallback when Ollama is unavailable or malformed.

## Safety and reliability

The existing source allowlist, complete H.264/AAC media checks, content-safe logo placement, wrong-athlete checks, publication idempotency, and Instagram/Threads permalink verification remain intact.

V2 also makes serious medical, death, criminal, and legal stories require explicit `reportingVerified` evidence before becoming ready. Serious stories cannot use playful/rage-bait tone.

## Production path

The actual launch path remains:

`launchd -> scripts/run-local-newsroom.sh -> collector -> scripts/local-sportswire.py -> SportsWire v2 ranking -> queue -> GitHub publisher`

The runner treats `--dry-run` and `--health` as genuinely read-only and skips collection, queue pushing, and workflow dispatch for those modes.

Useful commands:

```sh
cd "$HOME/Library/Application Support/SportsWire/publisher-runtime"
npm run newsroom:health
npm run newsroom:dry-run
scripts/run-local-newsroom.sh --dry-run
python3 -m unittest discover -s scripts -p 'test_local_sportswire*.py' -v
```

## Cost

Newsroom v2 adds no paid model or ranking API. Ranking is standard-library Python. Caption cleanup stays on local Ollama `qwen3:4b`. The existing Meta publisher is unchanged.

No ranking system can guarantee virality. The goal is to increase the percentage of posts with strong freshness, momentum, highlight quality, and cultural relevance while reducing weak clips and repetition.
