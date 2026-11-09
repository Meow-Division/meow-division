#!/usr/bin/env bash
# scripts/status.sh — what runs on https://game.meowdivision.fun, read only: the build and app folders the symlinks point at,
# the service's state, its last log lines, /api/health and the build stamp from outside. Run: bash scripts/status.sh
set -euo pipefail
cd "$(dirname "$0")/.."  # (the repo root, wherever it is run from)

HOST="${MEOW_HOST:-root@46.224.42.60}"
KEY="${MEOW_KEY:-$HOME/.ssh/parix_codex}"

ssh -o BatchMode=yes -i "$KEY" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /srv/meow
echo "site -> $(readlink site), app -> $(readlink app)"
echo "builds: $(ls -d game-* 2>/dev/null | tr '\n' ' ')"
echo "service: $(systemctl is-active meow-division), since $(systemctl show -p ActiveEnterTimestamp --value meow-division)"
journalctl -u meow-division --since -1h --no-pager | tail -5
REMOTE
echo "--- from outside"
curl -s https://game.meowdivision.fun/api/health
echo
curl -s https://game.meowdivision.fun/ | grep -o "__BUILD__ = '[^']*'"
