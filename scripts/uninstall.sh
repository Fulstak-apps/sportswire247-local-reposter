#!/bin/bash
set -euo pipefail
label="com.local.sports-reposter"
plist="$HOME/Library/LaunchAgents/$label.plist"
launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
rm -f "$plist"
echo "Removed launchd registration only. Sports queue, media, state, logs, and Chrome profile were preserved."
