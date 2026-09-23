#!/bin/zsh
set -eu
ROOT="/Users/dw/Library/Application Support/SportsWire/publisher-runtime"
LABEL="com.sportswire247.carousel"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
cp "$ROOT/launchd/$LABEL.plist" "$TARGET"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
echo "Installed $LABEL: 8:00 AM, 2:00 PM, and 5:00 PM local time."
