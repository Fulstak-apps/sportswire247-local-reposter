#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."
node src/collect-only.mjs || echo "Collection failed; continuing with saved queue" >&2
/usr/bin/python3 scripts/local-sportswire.py
scripts/push-sportswire-queue.sh
gh workflow run publish-sportswire.yml --repo Fulstak-apps/sportswire247-local-reposter
