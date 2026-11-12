#!/usr/bin/env bash
# scripts/market-key.sh — the players' market's treasury on the live server (server/market.mjs): its key is made ON the
# server and written to /etc/meow-division.env (MARKET_KEY; the file keeps its owner and mode), never printed, never
# leaving the server; the treasury is the key's implicit account (64 hex characters), funded by the human with ~0.5 NEAR
# for gas. The server then pays the treasury's own USDC storage once and opens payments (server.mjs treasuryCheck).
# Touches nothing but Meow Division's env file and service.
#   bash scripts/market-key.sh make     a key, if there is none yet; restarts the service; prints the treasury account
#   bash scripts/market-key.sh account treasury.meowdivision.near
#                                       the treasury is that named account instead (made by treasury-launch.bat with this
#                                       key's public half as one of its full-access keys); restarts the service
#   bash scripts/market-key.sh          the treasury account, its NEAR, its USDC storage, the market's state
set -euo pipefail

HOST="${MEOW_HOST:-root@46.224.42.60}"
KEY="${MEOW_KEY:-$HOME/.ssh/parix_codex}"
make= ; acct=
case "${1:-}" in
  make) make=1 ;;
  account)
    acct="${2:-}"
    [[ "$acct" =~ ^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.near$ ]] || { echo "usage: bash scripts/market-key.sh account <name>.near" >&2; exit 2; } ;;
  '') ;;
  *) echo "usage: bash scripts/market-key.sh [make | account <name>.near]" >&2; exit 2 ;;
esac

ssh -o BatchMode=yes -i "$KEY" "$HOST" MAKE="$make" ACCT="$acct" bash -s <<'REMOTE'
set -euo pipefail
f=/etc/meow-division.env
NODE=/srv/meow/runtime/bin/node
if [ -n "$MAKE" ] && ! grep -q '^MARKET_KEY=ed25519:' "$f"; then
  tmp=$(mktemp /etc/meow-division.env.XXXXXX)
  cp "$f" "$tmp"
  # (a new ed25519 key in NEAR's text form: base58 of the 32-byte seed and the 32-byte public key)
  "$NODE" -e '
    const c = require("crypto"), k = c.generateKeyPairSync("ed25519");
    const seed = k.privateKey.export({ format: "der", type: "pkcs8" }).subarray(16), pub = k.publicKey.export({ format: "der", type: "spki" }).subarray(12);
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", buf = Buffer.concat([seed, pub]);
    let n = BigInt("0x" + buf.toString("hex")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
    for (const b of buf) { if (b) break; s = "1" + s; }
    process.stdout.write("MARKET_KEY=ed25519:" + s + "\n");
  ' >> "$tmp"
  chown --reference="$f" "$tmp"; chmod --reference="$f" "$tmp"; mv "$tmp" "$f"
  systemctl restart meow-division
  sleep 3
  echo "a new treasury key is in $f"
fi
if [ -n "$ACCT" ]; then
  tmp=$(mktemp /etc/meow-division.env.XXXXXX)
  grep -v '^MARKET_ACCOUNT=' "$f" > "$tmp" || true
  echo "MARKET_ACCOUNT=$ACCT" >> "$tmp"
  chown --reference="$f" "$tmp"; chmod --reference="$f" "$tmp"; mv "$tmp" "$f"
  systemctl restart meow-division
  sleep 3
  echo "the treasury is now $ACCT"
fi
if grep -q '^MARKET_ACCOUNT=' "$f"; then
  echo "treasury: $(grep '^MARKET_ACCOUNT=' "$f" | tail -1 | cut -d= -f2-) (named; the key's implicit account unused)"
fi
if grep -q '^MARKET_KEY=ed25519:' "$f"; then
  # (the account from the key's public half: only that is printed)
  acc=$(grep '^MARKET_KEY=' "$f" | tail -1 | cut -d= -f2- | "$NODE" -e '
    let t = require("fs").readFileSync(0, "utf8").trim().slice(8), A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", n = 0n;
    for (const ch of t) n = n * 58n + BigInt(A.indexOf(ch));
    process.stdout.write(n.toString(16).padStart(128, "0").slice(64));
  ')
  echo "treasury: $acc"
  echo "https://nearblocks.io/address/$acc"
else
  echo "no treasury key yet: bash scripts/market-key.sh make"
fi
echo "service: $(systemctl is-active meow-division)"
journalctl -u meow-division --since -2min --no-pager | grep -i market | tail -4 || true
REMOTE
echo "--- the market from outside"
curl -s https://game.meowdivision.fun/api/market | head -c 160
echo
