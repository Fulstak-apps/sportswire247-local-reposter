#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."

# This is the scheduled, local audit. The watchdog reads the last verified
# Instagram receipt from GitHub, checks ready inventory and dispatches a safe
# retry only when the page has been quiet beyond the configured safety window.
node scripts/local-backup.mjs
