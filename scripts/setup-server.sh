#!/usr/bin/env bash
# scripts/setup-server.sh — one-time setup of Meow Division's site on the shared server (docs/ops.md).
# The server also hosts other projects. This script only creates files of its own:
#   /srv/meow/, /etc/nginx/sites-available/meow (+ its link in sites-enabled), the certificate "meowdivision.fun".
# certbot runs in webroot mode, so it never edits any nginx file. Every other nginx file and certificate
# renewal file is hashed before and after; any difference aborts with an error.
# Run from the repo root: bash scripts/setup-server.sh
set -euo pipefail
cd "$(dirname "$0")/.."  # (the repo root, wherever it is run from)

HOST="${MEOW_HOST:-root@46.224.42.60}"
KEY="${MEOW_KEY:-$HOME/.ssh/parix_codex}"

ssh -o BatchMode=yes -i "$KEY" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
IP4=46.224.42.60
NAMES=(game.meowdivision.fun meowdivision.fun www.meowdivision.fun)

for n in "${NAMES[@]}"; do
  getent ahostsv4 "$n" | grep -q "$IP4" || { echo "stop: $n has no A record to $IP4 yet"; exit 1; }
done

others() {
  { find /etc/nginx -type f ! -path '/etc/nginx/sites-available/meow' -print0
    find /etc/letsencrypt/renewal -type f ! -name 'meowdivision.fun.conf' -print0
  } | sort -z | xargs -0 sha256sum
}
BEFORE="$(others)"

mkdir -p /srv/meow/placeholder /srv/meow/acme
if [ ! -e /srv/meow/placeholder/index.html ]; then
  cat > /srv/meow/placeholder/index.html <<'EOF'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meow Division</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:#0b1220;color:#e8edf5;font:16px/1.5 system-ui,sans-serif;text-align:center}
  h1{margin:0 0 8px;font-size:clamp(28px,6vw,48px);letter-spacing:.02em}
  p{margin:0;color:#9fb0c8}
</style>
</head>
<body>
<main>
  <h1>Meow Division</h1>
  <p>The game is being built for NEAR HACKATHON 2026.</p>
</main>
</body>
</html>
EOF
fi
[ -e /srv/meow/site ] || ln -s /srv/meow/placeholder /srv/meow/site

CONF=/etc/nginx/sites-available/meow
CERT=/etc/letsencrypt/live/meowdivision.fun

http_only() {
  cat > "$CONF" <<'EOF'
# Meow Division (docs/ops.md in the repo). Step 1 of setup: HTTP only, for the certificate challenge.
server {
    listen 80;
    listen [::]:80;
    server_name game.meowdivision.fun meowdivision.fun www.meowdivision.fun;
    location ^~ /.well-known/acme-challenge/ { root /srv/meow/acme; }
    location / { return 404; }
}
EOF
}

full() {
  cat > "$CONF" <<'EOF'
# Meow Division (docs/ops.md in the repo). The game: /srv/meow/site (symlink to the current build).
server {
    listen 80;
    listen [::]:80;
    server_name game.meowdivision.fun meowdivision.fun www.meowdivision.fun;
    location ^~ /.well-known/acme-challenge/ { root /srv/meow/acme; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name game.meowdivision.fun;
    ssl_certificate /etc/letsencrypt/live/meowdivision.fun/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meowdivision.fun/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    root /srv/meow/site;
    index index.html;
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache";
    }
}

# The bare domain points at the game until the landing page exists.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name meowdivision.fun www.meowdivision.fun;
    ssl_certificate /etc/letsencrypt/live/meowdivision.fun/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meowdivision.fun/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / { return 302 https://game.meowdivision.fun$request_uri; }
}
EOF
}

[ -e "$CERT/fullchain.pem" ] || http_only
[ -e /etc/nginx/sites-enabled/meow ] || ln -s "$CONF" /etc/nginx/sites-enabled/meow
nginx -t
systemctl reload nginx

if [ ! -e "$CERT/fullchain.pem" ]; then
  certbot certonly --webroot -w /srv/meow/acme --non-interactive --agree-tos \
    --cert-name meowdivision.fun --deploy-hook 'systemctl reload nginx' \
    -d game.meowdivision.fun -d meowdivision.fun -d www.meowdivision.fun
fi

full
nginx -t
systemctl reload nginx

AFTER="$(others)"
if [ "$BEFORE" != "$AFTER" ]; then
  echo "ERROR: a file outside Meow Division changed:"
  diff <(echo "$BEFORE") <(echo "$AFTER") || true
  exit 1
fi
echo "other sites' nginx and certificate files: unchanged"

echo "--- checks"
curl -s -o /dev/null -w "game https %{http_code}\n" https://game.meowdivision.fun/
curl -s -o /dev/null -w "apex https %{http_code} -> %{redirect_url}\n" https://meowdivision.fun/
curl -s -o /dev/null -w "www https %{http_code} -> %{redirect_url}\n" https://www.meowdivision.fun/
REMOTE
