#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
template="$project_dir/launchd/com.sportswire247.newsroom.plist"
destination="$HOME/Library/LaunchAgents/com.sportswire247.newsroom.plist"
label="com.sportswire247.newsroom"
model="${OLLAMA_MODEL:-qwen3:4b}"

git -C "$project_dir" rev-parse --is-inside-work-tree >/dev/null
mkdir -p "$project_dir/runtime/queue" "$project_dir/runtime/media" "$project_dir/runtime/logs" "$project_dir/runtime/state" "$HOME/Library/LaunchAgents"
if command -v ollama >/dev/null && ! ollama list | awk '{print $1}' | grep -qx "$model"; then
  echo "Ollama model $model is not installed; caption cleanup will use the source caption until Ollama is available."
fi
chmod +x "$project_dir/scripts/local-sportswire.py" "$project_dir/scripts/run-local-newsroom.sh" "$project_dir/scripts/push-sportswire-queue.sh"
sed "s|__PROJECT_DIR__|$project_dir|g" "$template" > "$destination"
plutil -lint "$destination"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$destination"
python3 "$project_dir/scripts/local-sportswire.py" --health
echo "Installed $label. Logs: $project_dir/runtime/logs/newsroom.out.log and newsroom.err.log"
