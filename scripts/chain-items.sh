#!/usr/bin/env bash
# scripts/chain-items.sh — the players' items on their wallets (server/chain.mjs) on or off on the live server: sets
# CHAIN_ITEMS in /etc/meow-division.env (keeps the file's owner and mode) and restarts the meow-division service; with
# no argument it only prints the current state. Touches nothing but Meow Division's env file and service.
#   bash scripts/chain-items.sh on | off | (nothing: status)
set -euo pipefail

HOST="${MEOW_HOST:-root@46.224.42.60}"
KEY="${MEOW_KEY:-$HOME/.ssh/parix_codex}"
case "${1:-}" in
  on) want=1 ;;
  off) want=0 ;;
  '') want= ;;
  *) echo "usage: bash scripts/chain-items.sh on|off" >&2; exit 2 ;;
esac

ssh -o BatchMode=yes -i "$KEY" "$HOST" WANT="$want" bash -s <<'REMOTE'
set -euo pipefail
f=/etc/meow-division.env
if [ -n "$WANT" ]; then
  tmp=$(mktemp /etc/meow-division.env.XXXXXX)
  grep -v '^CHAIN_ITEMS=' "$f" > "$tmp" || true
  [ "$WANT" = 1 ] && echo 'CHAIN_ITEMS=1' >> "$tmp"
  chown --reference="$f" "$tmp"; chmod --reference="$f" "$tmp"; mv "$tmp" "$f"
  systemctl restart meow-division
  sleep 2
fi
echo "CHAIN_ITEMS: $(grep -c '^CHAIN_ITEMS=1$' "$f" | sed 's/^1$/on/;s/^0$/off/'); service: $(systemctl is-active meow-division)"
journalctl -u meow-division --since -1min --no-pager | tail -4
REMOTE
echo "--- from outside"
curl -s https://game.meowdivision.fun/api/health
echo
