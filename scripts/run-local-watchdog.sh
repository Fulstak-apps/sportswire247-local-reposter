#!/bin/zsh
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."

# This backup is local Mac work. Ollama is checked locally, but the watchdog
# itself is deterministic so it remains useful if Ollama is temporarily down.
if curl -fsS --max-time 5 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  OLLAMA_STATUS="available"
else
  OLLAMA_STATUS="unavailable"
fi
node scripts/watchdog-sportswire.mjs || true
printf '{"checkedAt":"%s","ollama":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OLLAMA_STATUS" > logs/local-watchdog.json
# Dispatch is free GitHub Actions automation; no Codex session or credits are involved.
gh workflow run publish-sportswire.yml --repo Fulstak-apps/sportswire247-local-reposter >/dev/null 2>&1 || true
