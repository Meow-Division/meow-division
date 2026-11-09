#!/usr/bin/env bash
# scripts/deploy.sh — ships the working tree to https://game.meowdivision.fun (docs/ops.md, the /ship skill). Before it: npm test,
# then npm run build (dist/game). Uploads the build as /srv/meow/game-<stamp> and the server with the rules it replays runs by
# (server/*.mjs and live/ without pictures, sounds and editors) as /srv/meow/app-<stamp>; points /srv/meow/app at the new app and
# restarts meow-division; once /api/health answers, points /srv/meow/site at the new build. A server that doesn't come up is
# put back on the previous app, and the site is left as it was. Old folders stay (the human says when they go).
# Run: bash scripts/deploy.sh (from anywhere)
set -euo pipefail
cd "$(dirname "$0")/.."  # (the repo root, wherever it is run from)

HOST="${MEOW_HOST:-root@46.224.42.60}"
KEY="${MEOW_KEY:-$HOME/.ssh/parix_codex}"
SSH=(ssh -o BatchMode=yes -i "$KEY" "$HOST")

[ -f dist/game/index.html ] || { echo "stop: no dist/game (npm run build first)"; exit 1; }
BUILD=$(grep -o "__BUILD__ = '[^']*'" dist/game/index.html | cut -d"'" -f2)
[ -n "$BUILD" ] || { echo "stop: dist/game/index.html carries no __BUILD__ stamp"; exit 1; }
STALE=$(find live -type f -newer dist/game/index.html | head -3)
[ -z "$STALE" ] || { echo "stop: the build is older than $STALE (npm run build again)"; exit 1; }
REV=$(node -e "console.log(require('./live/sim.js').REV)")
STAMP=$(date -u +%Y%m%d-%H%M%S)

echo "build $BUILD, rules REV $REV -> game-$STAMP, app-$STAMP"
tar -C dist/game -czf - . | "${SSH[@]}" "mkdir /srv/meow/game-$STAMP && tar -xzf - -C /srv/meow/game-$STAMP --no-same-owner"
tar -czf - --exclude='live/assets' --exclude='live/audio' --exclude='live/icons' --exclude='live/*.cjs' \
  --exclude='live/editor.js' --exclude='live/heroeditor.js' live server/*.mjs \
  | "${SSH[@]}" "mkdir /srv/meow/app-$STAMP && tar -xzf - -C /srv/meow/app-$STAMP --no-same-owner"

"${SSH[@]}" bash -s -- "$STAMP" "$REV" <<'REMOTE'
set -euo pipefail
S=$1
REV=$2
cd /srv/meow
PREV=$(readlink app || true)
ln -sfn "app-$S" app.new && mv -T app.new app
systemctl restart meow-division
ok=''
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8950/api/health | grep -q "\"rev\":$REV"; then ok=1; break; fi
  sleep 0.5
done
if [ -z "$ok" ]; then
  echo "ERROR: the server did not come up on app-$S"
  journalctl -u meow-division --since -2min --no-pager | tail -20
  if [ -n "$PREV" ]; then ln -sfn "$PREV" app.new && mv -T app.new app && systemctl restart meow-division && echo "back on $PREV"; fi
  exit 1
fi
ln -sfn "game-$S" site.new && mv -T site.new site
echo "live: $(readlink site), $(readlink app)"
REMOTE

echo "--- checks from outside"
curl -s https://game.meowdivision.fun/api/health
echo
curl -s https://game.meowdivision.fun/ | grep -o "__BUILD__ = '[^']*'"
