#!/bin/zsh
set -euo pipefail

# This mirrors RapWire's GitHub dispatch guard but points only at the separate
# SportsWire247 repository.  The local launchd monitor remains the publisher;
# GitHub is used for source control and verification until separate Meta API
# credentials are configured for @sportswire247.
REPO="Fulstak-apps/sportswire247-local-reposter"
WORKFLOW="verify.yml"
GH="${GH_BIN:-/opt/homebrew/bin/gh}"

if [[ ! -x "$GH" ]]; then
  GH="$(command -v gh)"
fi
ACTIVE=$("$GH" run list --repo "$REPO" --workflow "$WORKFLOW" --limit 20 --json status --jq '[.[] | select(.status == "in_progress" or .status == "queued" or .status == "pending" or .status == "waiting")] | length')
if [[ "$ACTIVE" != "0" ]]; then
  print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) skipped: SportsWire247 verification already running"
  exit 0
fi
"$GH" workflow run "$WORKFLOW" --repo "$REPO" --ref main
