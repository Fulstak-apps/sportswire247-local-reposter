#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."
node src/collect-only.mjs
/usr/bin/python3 scripts/local-sportswire.py
scripts/push-sportswire-queue.sh
