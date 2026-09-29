#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"

if [[ -n "$(git status --porcelain -- queue media logs)" ]]; then
  # Queue records must travel with their delivery assets. `media/` and most
  # runtime logs are deliberately ignored so they do not pollute ordinary
  # commits, but a newly collected clip needs an explicit force-add or the
  # GitHub publisher receives a queue item whose raw video URL does not exist.
  # Do not pass ignored directories to one `git add` call: Git treats that as
  # an error and previously skipped the queue record too.
  git add -- queue
  [[ -f logs/publisher-health.json ]] && git add -f -- logs/publisher-health.json || true
  git add -f -- media
  git commit -m "Queue SportsWire newsroom output"
fi
git fetch origin main
if ! git rebase origin/main; then
  git rebase --abort
  echo "SportsWire push stopped: resolve the rebase conflict; the local commit was preserved." >&2
  exit 1
fi
git push origin HEAD:main
