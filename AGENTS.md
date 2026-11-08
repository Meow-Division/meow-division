# Meow Division: instructions for every coding agent

Meow Division is a browser zombie-survival game (deterministic client simulation, Node server that re-simulates every run, Telegram Mini App, two-player co-op) with a real item economy on NEAR mainnet. It is our entry for NEAR HACKATHON (tracks `games` and `agents`), deadline **2026-11-14T23:59:00Z**. Claude Code and Codex screen the repository before human judges do, so the code, the tests and the README are written to be read by a machine and a stranger.

Read before working on: gameplay, economy or any player-facing text → `docs/design.md`; anything NEAR → `docs/chain.md`; README, submission, demo post → `docs/hackathon.md`; how code looks → `docs/style.md`.

## Hard rules (from HACKATHON.md; a hook enforces them for Claude Code, Codex follows them by reading this)

Never without the human's explicit yes in the current conversation:
- `git push`, making the repository public, force-pushing. The human runs `git push` themselves.
- Signing a transaction, spending tokens or deploying to mainnet (`near ... send`, `cargo near deploy`, `near contract deploy`). Print the exact command and wait.
- Sending the hackathon submission (`POST nearhackathon.com/api/applications`). Print the full JSON and wait. It is sent once, ever.
- Posting on X or anywhere. Hand over the draft.
- Committing a secret. Values live in `.env` (gitignored) and the server's environment; names in `.env.example`. `node scripts/check-secrets.mjs --staged` runs before every commit.

Mainnet only. Never propose testnet. Tests use a local sandbox.

The server is shared. Parix (its sites, nginx files, certificates, folders) is never touched, not even read beyond a directory listing. The other projects there (Zombie Horde in `/srv/bald`, HOODL Jump, Habla) are not modified either. Meow Division only creates and changes `/srv/meow/`, `/etc/nginx/sites-available/meow`, its own certificate `meowdivision.fun` and its own systemd units. Certificates are issued with `certbot certonly --webroot`, never `certbot --nginx`.

## Commands

| Task | Command |
| --- | --- |
| Unit tests (node:test, `test/*.test.mjs`) | `npm test` |
| Format code (Prettier, config in `.prettierrc.json`) | `npm run format`; CI runs `npm run format:check` |
| Run the game locally | `npm start` → http://localhost:8930/live/index.html (guest mode works with no `.env`) |
| Determinism: replay equals live, forbidden Math | `node gen/detcheck.cjs 120` |
| Sim invariants, save migration, i18n packs | `node gen/unitcheck.mjs` |
| Server end to end (login, tickets, cheats) | `node server/test.mjs` |
| Language packs vs en, no Cyrillic in code | `node gen/langcheck.mjs` (needs the server on 8930) |
| Attract-demo beats + `SIM.selfCheck()` | `node live/tune.cjs` |
| Secret scan | `npm run check:secrets` |
| Contract build / tests | `cd contract && cargo near build && cargo test` |
| Packed build | `npm run build` → `dist/game` (needs Playwright + Python Pillow, see `gen/build.mjs`) |
| Deploy | `/ship` skill (Claude) or `scripts/deploy.sh`, see `docs/ops.md` |

Definition of done for any change: `npm run format` run; `npm test` green; `detcheck` and `unitcheck` green if a rules file changed; `langcheck` green if text changed; `cargo test` green if the contract changed; the game still runs as a guest with no `.env`; deployed to https://game.meowdivision.fun; README updated if a judge-visible feature changed.

## Repository map

```
live/       the game as served. Browser scripts, no bundler, loaded in the order of SCRIPTS in live/index.html.
            Rules files shared by client and server (SIM_FILES in server/server.mjs): data.js map.js map_lab.js sim.js replay.js rules.js economy.js
server/     Node 22+, ESM, zero npm dependencies. server.mjs (HTTP + API), replay-worker.mjs, rooms.mjs (co-op WS), chain.mjs (NEAR), tgbot.mjs
contract/   Rust NEP-245 contract (near-sdk-rs 5.x, cargo-near), integration tests on near-sandbox
gen/        build and checks (*.mjs, *.cjs), balance bots, art pipelines (*.py). Not shipped.
test/       node:test unit tests. scripts/ repo tooling. docs/ the canon. .claude/ agent rules, hooks, skills.
art/        source art, gitignored (1 GB). live/assets is what ships.
```

## How the code is written (details and examples in `docs/style.md`)

- JavaScript only, no TypeScript, no bundler, no framework. `live/*.js` are IIFE modules that set one UPPERCASE global (`SIM`, `UI`, `ECONOMY`) and also `module.exports` when the file is shared with the server. `server/`, `gen/*.mjs`, `scripts/`, `test/` are ESM with `node:` imports.
- No runtime npm dependencies in `server/`. Browser code loads exactly one external module: `@hot-labs/near-connect` (pinned version).
- 2-space indent, LF, UTF-8, semicolons, single quotes, `const` by default. One statement per line, lines under 120 characters. Every file opens with a one-line header comment saying what it is and why. Comments explain why, in English. No TODO comments: unfinished work goes into the plan, not the code.
- Plain functions and plain data. Classes only for things with a real instance lifecycle (a pool, a socket). State is JSON-serialisable.
- Naming: globals `UPPERCASE`, functions `camelCase`, constants `UPPER_SNAKE`, data ids and token ids `lower_snake` (`t_butcher`), i18n keys `section.camelCase`, CSS classes short lowercase, behaviour hooks as `data-*`, storage keys `md.<name>`, env vars `UPPER_SNAKE` listed in `.env.example`.
- Numbers that tune the game live in `live/data.js` (combat) and `live/economy.js` (items, prices, recipes, buildings). Nowhere else.
- Player-facing text only through `I18N.t('key')`, present in all four packs (`en`, `ru`, `uk`, `es`). No literal strings in code, no Cyrillic outside the packs.
- Errors are never swallowed: server answers `{ error: 'short lowercase message' }` with a status; client shows a translated line; logs carry context (`console.warn('settle', id, e)`).
- Generated files (`live/map.js`, `live/map_lab.js`, `live/assets.js`, `live/rigs.js`, `live/hero.js`) are written by their tools, never edited by hand.

## Simulation rules (anything under `live/sim.js`, `data.js`, `rules.js`, `replay.js`, `economy.js`, `map*.js`)

- The server re-simulates every run from the input log and pays the replay's outcome. Client and server must produce identical state: no `Math.random`, `Date.now`, `performance.now`, `Math.sin/cos/atan2/exp/pow/hypot` in rules files (use the fdlibm ports `dsin`, `dcos`, `datan2`, `dexp`, `pow8`); RNG only through `rnd(S)` on `S.rs`; arrays only, no `Map`, `Set`, `sort`, `for…in`; module caches only when derived from state; render code never writes sim state.
- `SIM.REV` in `live/sim.js` is raised with every change to how a run plays, including a fix of a fix. Commit subject carries `(SIM.REV N)`. The server keeps old rules in `DATA/sims/<REV>` for runs in flight.
- A new rules file goes into all three lists: `SIM_FILES` (`server/server.mjs`), `SCRIPTS` and `WATCH` (`live/index.html`).

## Chain rules (see `docs/chain.md`)

- One NEP-245 contract (`items.meowdivision.near`) for every item, trophy, kit and skin; NEP-297 events on every change; token ids are fixed forever (`docs/design.md`).
- Players never see the chain: no popups in a run, no gas, no storage deposit, no chain words in the UI. One approval at wallet connect (function-call key); sell, craft and equip then run without windows.
- Identity is the wallet only. Guests play fully from a server ledger that is minted to the wallet on first connect. No Telegram login, no email login.
- Chain calls are idempotent (`run_id`), queued when RPC fails, never block gameplay. Account ids and RPC URLs only in `server/config.mjs` from env.
- The server signs with a limited function-call key from `NEAR_SIGNER_KEY`. We never hold or ask for a full-access key or a seed phrase.

## Working style

- Follow `docs/design.md`. Do not add features, screens or items that are not there; do not remove what is there. If a design point is impossible, say so in one line and build the closest thing that keeps the player's path intact.
- Decide ordinary technical trade-offs yourself and record them in the commit body. Ask the human only for the hard rules above and for decisions listed as theirs in `docs/hackathon.md`.
- Small commits, English imperative subjects under 72 characters, a body that says why. Rules changes carry `(SIM.REV N)`. Never `--no-verify`, never force-push, never commit `dist/`, `art/`, `data/`, `.env`.
- Every judge-visible feature gets a "do X, see Y" step in `README.md` the day it ships. Keep `README.md` truthful: nothing described that does not run.
- Code and comments in English. Conversations with the human in the human's language (Russian).
- When something is unclear in the code, read it; when unclear in the rules, read `docs/`; when unclear in the hackathon rules, read https://nearhackathon.com/HACKATHON.md, not memory.
