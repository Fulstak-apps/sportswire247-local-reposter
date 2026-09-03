#!/bin/bash
set -euo pipefail
label="com.local.sports-reposter"
plist="$HOME/Library/LaunchAgents/$label.plist"
awake_plist="$HOME/Library/LaunchAgents/$label.keep-awake.plist"
launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" "$awake_plist" 2>/dev/null || true
rm -f "$plist"
rm -f "$awake_plist"
echo "Removed launchd registration only. Sports queue, media, state, logs, and Chrome profile were preserved."
