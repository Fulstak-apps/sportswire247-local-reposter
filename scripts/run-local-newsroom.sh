#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SPORTSWIRE_BASKETBALL_FLOOR="${SPORTSWIRE_BASKETBALL_FLOOR:-45}"
export SPORTSWIRE_FOOTBALL_FLOOR="${SPORTSWIRE_FOOTBALL_FLOOR:-52}"
export SPORTSWIRE_MLB_FLOOR="${SPORTSWIRE_MLB_FLOOR:-60}"
export SPORTSWIRE_HOCKEY_FLOOR="${SPORTSWIRE_HOCKEY_FLOOR:-66}"
cd "$(dirname "$0")/.."

read_only=false
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" || "$arg" == "--health" ]]; then
    read_only=true
  fi
done

# Dry-run/health stay strictly read-only: no collection, git mutation, queue push,
# or workflow dispatch.
if [[ "$read_only" == "true" ]]; then
  /usr/bin/python3 scripts/local-sportswire.py "$@"
  exit $?
fi

# Pick up ranking/editorial improvements before collecting the next batch instead
# of one scheduler cycle later. Preserve any unpushed local commit by rebasing it
# onto origin/main. Never reset or force-push. If tracked files are dirty, leave
# them untouched and run the installed code rather than risking user state.
if [[ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)" == "main" ]]; then
  if [[ -z "$(git status --porcelain --untracked-files=no)" ]]; then
    if git fetch origin main; then
      if ! git rebase origin/main; then
        git rebase --abort >/dev/null 2>&1 || true
        echo "SportsWire pre-run sync conflicted; refusing this cycle without changing local work." >&2
        exit 1
      fi
    else
      echo "SportsWire pre-run fetch failed; continuing with the last verified local code." >&2
    fi
  else
    echo "SportsWire tracked changes detected; skipping pre-run sync to preserve local work." >&2
  fi
else
  echo "SportsWire runtime is not on main; skipping pre-run sync." >&2
fi

node src/collect-only.mjs || echo "Collection failed; continuing with saved queue" >&2
/usr/bin/python3 scripts/refill-queue.py
scripts/push-sportswire-queue.sh
gh workflow run publish-sportswire.yml --repo Fulstak-apps/sportswire247-local-reposter
scripts/run-local-watchdog.sh
