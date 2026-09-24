#!/usr/bin/env bash
# 动漫答题放映器 — WSL / Linux 启动
set -e
cd "$(dirname "$0")"
PORT="${1:-8756}"
URL="http://127.0.0.1:${PORT}/play"

(
  sleep 1.2
  wslview "$URL" 2>/dev/null || cmd.exe /c start "$URL" 2>/dev/null || true
) &

exec python3 server.py "$PORT"
