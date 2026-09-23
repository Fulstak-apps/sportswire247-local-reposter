#!/bin/zsh
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
ROOT="/Users/dw/Library/Application Support/SportsWire/publisher-runtime"
LOCK="/tmp/com.sportswire247.carousel.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT
cd "$ROOT"
node scripts/generate-sportswire-carousel.mjs
