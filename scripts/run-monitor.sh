#!/bin/zsh
set -euo pipefail

# launchd starts the same shell entry point as the RapWire monitor. Keeping the
# runtime setup here avoids the Node 25 launchd loader race seen with a direct
# binary ProgramArguments entry.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."
exec /opt/homebrew/bin/node scripts/instagram-repost-monitor.mjs
