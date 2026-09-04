#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"

if [[ -z "$(git status --porcelain -- queue media logs)" ]]; then
  exit 0
fi

git add -- queue media logs
git commit -m "Queue SportsWire newsroom output"
git fetch origin main
if ! git rebase origin/main; then
  echo "SportsWire push stopped: resolve the rebase conflict; the local commit was preserved." >&2
  exit 1
fi
git push origin HEAD:main
