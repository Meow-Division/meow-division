#!/usr/bin/env bash
# scripts/setup-service.sh — the game server on the shared host (docs/ops.md), after scripts/setup-server.sh; safe to run again.
# Creates the user meow, /srv/meow/data (mode 700), /etc/meow-division.env (the secrets' names with empty values: the human types
# them in; empty = that feature off, the game still runs), the systemd unit meow-division (127.0.0.1:8950; enabled, started by
# the first scripts/deploy.sh), and the full nginx config of game.meowdivision.fun: the build from /srv/meow/site, /api/ and
# /api/ws proxied, the pictures' .webp twins, files stamped ?v= cached for good. Only Meow Division's own files change: every
# other nginx and certificate renewal file is hashed before and after, and a failed nginx check puts the old config back.
# Run from the repo root: bash scripts/setup-service.sh
set -euo pipefail
cd "$(dirname "$0")/.."  # (the repo root, wherever it is run from)

HOST="${MEOW_HOST:-root@46.224.42.60}"
KEY="${MEOW_KEY:-$HOME/.ssh/parix_codex}"

ssh -o BatchMode=yes -i "$KEY" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
others() {
  { find /etc/nginx -type f ! -path '/etc/nginx/sites-available/meow' -print0
    find /etc/letsencrypt/renewal -type f ! -name 'meowdivision.fun.conf' -print0
  } | sort -z | xargs -0 sha256sum
}
BEFORE="$(others)"

id meow >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /srv/meow --shell /usr/sbin/nologin meow
mkdir -p /srv/meow/data
chown meow:meow /srv/meow/data
chmod 700 /srv/meow/data
[ -e /srv/meow/runtime ] || ln -s /srv/bald/runtime/node-v24.21.0-linux-x64 /srv/meow/runtime

ENVF=/etc/meow-division.env
if [ ! -e "$ENVF" ]; then
  cat > "$ENVF" <<'EOF'
# Meow Division's secrets (docs/ops.md). Typed in by the human; empty = that feature off, the game still runs.
SESSION_SECRET=
NEAR_SIGNER_ACCOUNT=
NEAR_SIGNER_KEY=
NEAR_WALT_KEY=
NEAR_AI_API_KEY=
INTENTS_1CLICK_JWT=
EOF
  chown root:meow "$ENVF"
  chmod 640 "$ENVF"
fi

cat > /etc/systemd/system/meow-division.service <<'EOF'
[Unit]
Description=Meow Division game server (runs, replays, NEAR items)
After=network-online.target
Wants=network-online.target

[Service]
User=meow
Group=meow
WorkingDirectory=/srv/meow/app
Environment=HOST=127.0.0.1
Environment=PORT=8950
Environment=DATA_DIR=/srv/meow/data
Environment=GAME_DIR=/srv/meow/app/live
Environment=TRUST_PROXY=1
Environment=REPLAY_WORKERS=1
Environment=NEAR_NETWORK=mainnet
EnvironmentFile=-/etc/meow-division.env
ExecStart=/srv/meow/runtime/bin/node server/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/meow/data
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable meow-division >/dev/null 2>&1

CONF=/etc/nginx/sites-available/meow
cp "$CONF" /srv/meow/nginx-meow.prev
cat > "$CONF" <<'EOF'
# Meow Division (docs/ops.md in the repo). The game: /srv/meow/site (symlink to the current build); its server: 127.0.0.1:8950.
# A picture's .webp twin for the browsers that take it; files stamped ?v=<build> never change.
map $http_accept $meow_webp { default ""; "~*image/webp" ".webp"; }
map $arg_v $meow_cache { "" "no-cache"; default "public, max-age=31536000, immutable"; }

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

    location ^~ /assets/ {
        gzip_static on; gzip_vary on;
        add_header Vary Accept;
        add_header Cache-Control $meow_cache;
        try_files $uri$meow_webp $uri =404;
    }
    location ~ \.(png|jpe?g)$ {
        add_header Vary Accept;
        add_header Cache-Control $meow_cache;
        try_files $uri$meow_webp $uri =404;
    }
    location ~ \.(js|css|json|mp3|glb|bin|svg|woff2?)$ {
        gzip_static on; gzip_vary on;
        add_header Cache-Control $meow_cache;
        try_files $uri =404;
    }
    location = /api/ws {
        proxy_pass http://127.0.0.1:8950;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:8950;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 10m;
    }
    location / {
        gzip_static on; gzip_vary on;
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
if ! nginx -t 2>/tmp/meow-nginx-test; then
  cat /tmp/meow-nginx-test
  cp /srv/meow/nginx-meow.prev "$CONF"
  echo "ERROR: nginx check failed; the previous config is back"
  exit 1
fi
systemctl reload nginx

AFTER="$(others)"
if [ "$BEFORE" != "$AFTER" ]; then
  echo "ERROR: a file outside Meow Division changed:"
  diff <(echo "$BEFORE") <(echo "$AFTER") || true
  exit 1
fi
echo "other sites' nginx and certificate files: unchanged"
id meow
systemctl is-enabled meow-division
REMOTE
