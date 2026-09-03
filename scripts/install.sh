#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$project_dir/runtime"
plist_dir="$HOME/Library/LaunchAgents"
plist_path="$plist_dir/com.local.sports-reposter.plist"
node_path="$(command -v node)"
mkdir -p "$runtime_dir/queue" "$runtime_dir/media" "$runtime_dir/state" "$runtime_dir/logs" "$plist_dir"
if [[ ! -f "$project_dir/config.json" ]]; then cp "$project_dir/config.example.json" "$project_dir/config.json"; fi
cd "$project_dir"
if [[ ! -d "$project_dir/node_modules/playwright-core" ]]; then
  npm install --no-audit --no-fund
fi
cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.local.sports-reposter</string>
<key>ProgramArguments</key><array><string>$node_path</string><string>$project_dir/src/worker.mjs</string></array>
<key>WorkingDirectory</key><string>$project_dir</string>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>120</integer>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>$runtime_dir/logs/worker.out.log</string>
<key>StandardErrorPath</key><string>$runtime_dir/logs/worker.err.log</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST
plutil -lint "$plist_path"
echo "Installed files with publishing disabled. Edit config.json, run npm run login, then npm run baseline."
