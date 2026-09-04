#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$project_dir/runtime"
plist_dir="$HOME/Library/LaunchAgents"
plist_path="$plist_dir/com.local.sports-reposter.plist"
awake_plist_path="$plist_dir/com.local.sports-reposter.keep-awake.plist"
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
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$project_dir/scripts/run-monitor.sh</string></array>
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
cat > "$awake_plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.local.sports-reposter.keep-awake</string>
<key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-s</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
PLIST
plutil -lint "$awake_plist_path"
echo "Installed sports worker and keep-awake definitions. Existing config and publish safety setting were preserved."
