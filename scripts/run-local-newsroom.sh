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

if [[ "$read_only" == "true" ]]; then
  /usr/bin/python3 scripts/local-sportswire.py "$@"
  exit $?
fi

node src/collect-only.mjs || echo "Collection failed; continuing with saved queue" >&2
/usr/bin/python3 scripts/local-sportswire.py "$@"
scripts/push-sportswire-queue.sh
gh workflow run publish-sportswire.yml --repo Fulstak-apps/sportswire247-local-reposter
