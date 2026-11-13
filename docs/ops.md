# Operations: hosting and deploy

One server runs everything: `root@46.224.42.60` (Ubuntu 24.04, 2 vCPU, 3.8 GB RAM, nginx, certbot). It is shared with other projects. **Parix is never touched**: not its sites, nginx files, certificates or folders. Other projects run there too, each with its own folders, users and units; Meow Division shares nothing with them (its own Node in `/srv/meow`). Meow Division lives beside them and changes only its own files: `/srv/meow/`, `/etc/nginx/sites-available/meow`, the certificate `meowdivision.fun` (webroot mode, so certbot never edits nginx files), and its own systemd units. `scripts/setup-server.sh` hashes every other nginx and renewal file before and after and fails if one changed.

## Layout on the server (`scripts/setup-server.sh`: the site and its certificate; `scripts/setup-service.sh`: the user, the service, the full nginx config; both safe to run again)

```
/srv/meow/
  site -> game-<stamp>/      packed build served by nginx (symlink swap = atomic deploy)
  game-<stamp>/              output of `npm run build` (webp and gz twins, one ?v= stamp)
  app -> app-<stamp>/        what the service runs (WorkingDirectory)
  app-<stamp>/               server/*.mjs + live/ without pictures, sounds and editors (the rules the server replays runs by)
  data/                      DATA_DIR: accounts, jobs, sims/<REV>, secret, diag.log (mode 700, user meow)
                             jobs-aside/: queued runs whose account file could not be read (see "Runs set aside")
  runtime -> /srv/meow/node-v24.21.0-linux-x64   the game's own Node (nodejs.org, checksum checked: scripts/setup-service.sh)
  nginx-meow.prev            the nginx config before the last setup-service.sh
  nginx-headers.conf         the security headers, included by the nginx config (written by setup-service.sh, root's)
/etc/meow-division.env       EnvironmentFile for the service (root:meow 640): the secrets' names, values typed in by the human
/etc/systemd/system/meow-division.service      user meow, 127.0.0.1:8950, TRUST_PROXY=1, Restart=always
/etc/nginx/sites-available/meow               game.meowdivision.fun + meowdivision.fun
```

nginx for `game.meowdivision.fun`: root `/srv/meow/site`; `/api/ws` proxied with Upgrade headers; `/api/` proxied to 8950 (60 s, 10 MB bodies); `/assets/` with `gzip_static`, `try_files $uri$webp $uri`, `Cache-Control` immutable for `?v=` requests, `no-cache` otherwise; the players' market's addresses (`/market`, `/market/lot/<id>`, `/market/@<account>`, `/market/<item>`) serve `market.html`; `/` falls back to `index.html`. Every answer carries three headers from `/srv/meow/nginx-headers.conf`: `Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org https://*.telegram.org` (only the game itself and Telegram's web clients may frame it), `Strict-Transport-Security: max-age=31536000` and `X-Content-Type-Options: nosniff`. nginx drops a server block's `add_header` lines in any location that has one of its own, so the file is included at the server level and again in each such location; a new location with an `add_header` must include it too. `meowdivision.fun` and `www` serve the landing page from `/srv/meow/www` (later) and until then redirect to the game. Certificate: one, named `meowdivision.fun`, for all three names, issued by `scripts/setup-server.sh` with `certbot certonly --webroot -w /srv/meow/acme` and a reload deploy hook.

## Runs set aside

A run waiting for its replay is a file in `data/jobs/`. If the account it belongs to cannot be read (its JSON file is broken on disk), the server tries three times, logs `run <id> of <account> set aside`, moves the job to `data/jobs-aside/<id>.json` and carries on; nothing there is read at a start. After the account file is mended (from a backup, or by hand), move the job file back into `data/jobs/` and restart the service: the run is replayed and paid once. A result that cannot be *written* (disk full) is not set aside: the server keeps trying until it can.

## DNS

| Name | Type | Value |
| --- | --- | --- |
| meowdivision.fun | A | 46.224.42.60 |
| game.meowdivision.fun | A | 46.224.42.60 |
| www.meowdivision.fun | A | 46.224.42.60 |
| @, game, www | AAAA | 2a01:4f8:c014:a27c::1 |

Registrar and DNS: Namecheap. Its email-forwarding MX and SPF records stay as they are.

## Deploy (`scripts/deploy.sh`, also the `/ship` skill)

The agent runs the server scripts by their full path, `bash /d/game/meow-division/scripts/<name>.sh`: the human's Claude Code settings allow exactly that (`Bash(bash /d/game/meow-division/scripts/*)`), so everything done on the server goes through a script in this repo that touches only Meow Division's files. `scripts/status.sh` shows what runs (read only).

1. Local: `npm test`; if rules changed, `node gen/detcheck.cjs 120` and `node gen/unitcheck.mjs`; `npm run build` → `dist/game`.
2. `bash scripts/deploy.sh`: uploads `dist/game` as `/srv/meow/game-<stamp>` and `server/*.mjs` + `live/` minus `assets/ audio/ icons/ *.cjs editor.js heroeditor.js` as `/srv/meow/app-<stamp>` (tar over ssh).
3. It points `/srv/meow/app` at the new app, restarts `meow-division`, waits for `GET /api/health` to answer with the new `rev`, then swaps `/srv/meow/site`; a server that doesn't come up goes back to the previous app and the site stays. Last, it checks `/api/health` and the new `__BUILD__` stamp from outside.
4. Smoke test from outside: open the game as a guest on a phone and in the Telegram Mini App; one run start; the hub opens.
5. Keep the last two `game-<stamp>` folders; delete older ones only when the human says so (the auto-mode classifier refuses `rm -rf` on the server anyway).

Hot patch of one script: copy the file into the live `game-<stamp>`, add a `window.__VER` entry with a new stamp in `index.html` (inside the build's `<script nonce=…>`: the page's Content-Security-Policy runs no inline script without that nonce), ship `.gz`/`.webp` twins too. Never change a file that is already cached under its stamp.

Rollback: point `/srv/meow/site` and `/srv/meow/app` at the previous `game-<stamp>` / `app-<stamp>` and restart; the server keeps old rules under `data/sims/<REV>` so runs in flight still settle.

## Secrets on the server

`/etc/meow-division.env` holds `NEAR_SIGNER_KEY`, `NEAR_AI_API_KEY`; `/etc/meow-division-bot.env` holds `TELEGRAM_BOT_TOKEN`. The game server's unit reads that file too (systemd loads it as root): with the token it checks the Mini App's signed `initData` (`POST /api/tg`) and messages a player's Telegram about their market trades (`server/tg.mjs`, the links in `DATA_DIR/tg.json`); without it nothing is linked or sent. They are typed in by the human over ssh or pasted into a file by them; the agent never prints or copies their values. The two function-call keys (`NEAR_SIGNER_KEY`, `NEAR_WALT_KEY`) are written instead by the contract launch page (`contract-launch.bat`, `scripts/chain-launch.mjs`) on the human's click: from `~/meow-keys` over ssh's stdin, never on a command line or in a log. The session tokens (30 days) and the guests' device tokens (a year) are HMAC-signed with `DATA_DIR/secret`, 32 random bytes the server writes on its first start (mode 600, `server/server.mjs`); there is no environment variable for it. Back it up with `data/`: a new one signs every player out and makes every device token, and with it every guest's server record, unusable.

## Build box for the contract

The contract builds in WSL on the PC: Ubuntu 24.04 distro `meow` (stored in `D:\dev\wsl\meow`), user `meow`, Rust and cargo-near 0.23 in `~/.cargo`, build output in `/home/meow/target/items` (building under `/mnt/d` is slow). Windows itself has no Rust, and the NEAR sandbox runs only on Linux and macOS. GitHub Actions (job `contract` in `.github/workflows/ci.yml`) runs fmt, clippy, the unit and sandbox tests and the wasm build on every push. The shared server never builds Rust: compiling would hold both of its cores for minutes next to other projects. The PC has `near-cli-rs` for read calls; the human deploys from their wallet.

## Health and logs

- `journalctl -u meow-division --since -2h` (never the whole log: it times out).
- `/api/health` → `{ ok, network: 'mainnet', rev, ... }`.
- `data/diag.log` holds Telegram layout diagnostics posted by `tg.html`.
- Russian ISPs throttle this Hetzner host after ~30 KB over TLS; the loader's warm-up and retry logic (`index.html`) exist for that. Do not remove them.
