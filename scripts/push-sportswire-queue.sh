#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"

if [[ -n "$(git status --porcelain -- queue media logs)" ]]; then
  git add -- queue media logs
  git commit -m "Queue SportsWire newsroom output"
fi
git fetch origin main
if ! git rebase origin/main; then
  git rebase --abort
  echo "SportsWire push stopped: resolve the rebase conflict; the local commit was preserved." >&2
  exit 1
fi
git push origin HEAD:main
