# Game and progress server

One Node.js process (22.12 or newer, no dependencies). It serves the game and keeps each player's progress under their
NEAR account (mainnet).

```
node server/server.mjs --port 8930
```

Open http://127.0.0.1:8930/ (redirects to `/live/index.html`).

## Login

1. The player presses "Connect wallet" and picks a wallet in the NEAR Connect window.
2. The server hands out a one-time code; the wallet signs a message containing it (NEP-413). This is free: no
   transaction is sent.
3. The server checks the signature and asks NEAR RPC whether the key is a full-access key of that account.
4. The server issues a session token valid for 30 days.

A new account starts from zero, plus what the signing-in browser's guest proved on the server (below), once. A
guest's own progress (no wallet) stays in the browser; only its replayed mission runs count.
The server gives a new account its avatar, background and name; renaming also goes through the server.

## A guest's mission runs

A guest plays on its own progress in the browser, but its campaign missions are proven on the server: with its device
token (`POST /api/guest`, HMAC-signed like the session tokens, a year) the page takes a ticket for the device's current
mission (`POST /api/run/start`; no classic run, no mission out of turn) and sends the run's inputs at the end
(`POST /api/run/end`). The same workers play it again; what it earned (the mission finished, the items carried out, the
coins and rank XP) goes into the device's record, `DATA_DIR/guests/<hash>.json`. The record is what opens the wallet
made in the game (mission 1) and what a first sign-in takes along (`rules.js adopt`: no more than the page still has,
coins and XP capped, for one account only). Offline or refused, the run still plays on the page; it just doesn't count.

## A wallet made in the game

A guest whose device proved mission 1 can get a NEAR wallet without leaving the game (`server/wallets.mjs`):

1. The page has its device token (above).
2. The player types a name; `GET /api/wallet/free?name=` says whether `<name>.near` is free.
3. The page makes a new 12-word recovery phrase and its key pair itself (`live/newwallet.js`, the derivation NEAR
   wallets use). Only the public key is sent: `POST /api/wallet/create {name, publicKey, device}`.
4. The server signs `game_wallet` on `items.meowdivision.near` with its function-call key (`server/near.mjs`: borsh,
   ed25519, RPC with a fallback, no dependencies). The contract creates `<name>.near` through the `near` registrar,
   pays a 0.01 NEAR deposit from its own balance and keeps its own cap.
5. The page signs the usual login message with the new key (NEP-413) and the account opens like any wallet's.

Refused: no device token, a wallet already connected, mission 1 not proven by the device's record, a bad name or key, a
taken name, a second wallet from the same device token (its request id is fixed, so the contract applies it once),
more than `WALLET_DAILY_CAP` a day or `WALLET_IP_DAILY_CAP` from one address (an IPv6 address counts by its /64). Until the contract is updated the answer
is `not_ready`. `DATA_DIR/wallets.json` keeps the devices that made one (hashed) and the day's counts; addresses only
as salted hashes, no keys.

## Why progress cannot be forged

Only the server changes an account's progress. The page cannot upload a save: `PUT /api/save` is refused.

- **Purchases and choices.** Upgrades, weapons, the chosen weapon, voices and language reach the server one action at
  a time (`POST /api/act`). The server checks price, rank and mastery with the same rules as the game
  (`live/rules.js`).
- **Runs.** Before a run the server deals a ticket (`POST /api/run/start`) with its own level seed and random seed.
  During the run the game records the player's input on every simulation step (`live/replay.js`: movement, aim, fire,
  card picks). At the end the record goes to the server (`POST /api/run/end`). A worker thread replays the run with the
  server's own copy of the simulation (`live/sim.js`). Coins, rank XP, mastery and stats are paid from the server's
  result, not from what the page showed.
- **Same result everywhere.** The simulation never calls the `Math` functions that browsers may compute differently
  (sin, cos, atan2, exp, hypot, powers). It has its own versions built from addition, multiplication, division and
  square root, which IEEE 754 makes identical on every machine. Checked by `node gen/detcheck.cjs`.

What is stopped:

| Attempt | What happens |
| --- | --- |
| Editing coins, rank or upgrades in `localStorage` or the console | Visible on that page only. The server refuses saves, a purchase without coins is refused, the page falls back to the server's data |
| Forging a request (own coin count, someone else's actions) | The server accepts only actions and checks each one against the rules |
| Immortality, extra coins or kills through modified page code | The server replays the input without those changes and pays the honest result |
| Sending one run twice | A ticket is single-use |
| Taking tickets again and again to fish for lucky seeds | At most 8 tickets a minute per account |
| Playing with weapons or upgrades the account does not own | The loadout is fixed when the run is sent and cut down to what was bought |
| Speeding the game up | A run cannot have more steps than the time since its ticket allows (plus 10 s) |
| Several bots on one account at once | Runs of one account cannot overlap in time: the second earns nothing |
| A corrupt or huge record | Ticket and time are checked first; the record is unpacked only then, without blocking the server. Its size is bounded by the step count, every number is validated. A run lasts at most an hour |
| Cheat keys (F1–F5, Shift+G, Shift+R) | Work only in development mode (`?dev`); Shift+G/R only for a guest |

A bot that plays like a person (steering the hero and aim through ordinary input) cannot be stopped. It earns no more
than a very good player in the same time.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT`, `HOST` | `8930`, `127.0.0.1` | Where to listen. For network access: `HOST=0.0.0.0` |
| `DATA_DIR` | `server/data` | Accounts (`accounts/`), the replay queue (`jobs/`), kept rules (`sims/<REV>/`), the token secret (`secret`) |
| `GAME_DIR` | `live/` | What is served under `/live/`. In production, the packed build's folder |
| `REPLAY_WORKERS` | cores − 1, at most 4 | How many runs are replayed at once |
| `TRUST_PROXY` | off | `1`: take the player's address from the last `X-Forwarded-For` entry, added by your proxy (exactly one nginx or Caddy in front). Otherwise the rate limit is shared by everyone |
| `NEAR_RPC` | `https://rpc.mainnet.fastnear.com,https://rpc.mainnet.near.org` | Mainnet RPC nodes, comma-separated (else `NEAR_RPC_URL` then `NEAR_RPC_FALLBACK_URL`) |
| `NEAR_ITEMS_CONTRACT`, `NEAR_SIGNER_ACCOUNT` | `items.meowdivision.near` | The items contract, and the account the server signs for (the contract itself) |
| `NEAR_SIGNER_KEY` | empty | The server's function-call key on that account (`ed25519:…`). Empty: nothing is signed and no wallet is made. A full-access key is refused |
| `WALLET_DAILY_CAP`, `WALLET_IP_DAILY_CAP` | `20`, `3` | Wallets made in the game per day, in all and from one address |
| `ALLOWED_ORIGINS` | empty | If the game is hosted on another domain: that origin (CORS). The game then sets `window.SAVE_API = 'https://your-server/api'` |

## Hosting

- **HTTPS is required.** Wallets work only over https (localhost aside). Put the server behind nginx or Caddy and set
  `TRUST_PROXY=1`.
- **CPU.** Replaying a 10-minute run takes about 25 seconds of one core, so one core keeps up with about 20 players
  playing at once. The reward lands on the account when the replay finishes; until then the game shows the expected
  amount and the line "The server is checking the run…".
- **Backup.** Back up the `DATA_DIR` folder. Deleting `secret` logs every player out; progress stays.
- **Restart.** Runs waiting for their replay sit in `jobs/` and are replayed after a restart.
- **Game updates.** The server keeps every rules version it has dealt tickets under in `DATA_DIR/sims/<REV>/`, so a
  run started before a deploy is replayed by the rules it was played with.
- **Old saves.** First-version saves (`saves/`) were uploaded by the page itself and cannot be trusted. Such an account
  starts from zero at login, and the old file is moved to `legacy/`.

## Checks

- `node server/test.mjs`: the API and every cheating attempt above. Needs only Node.
- `node gen/detcheck.cjs`: the simulation calls no inexact `Math` functions, and a full run with bosses replays to the
  same state.
- `node gen/walletcheck.mjs`: login, a fresh account, console cheats, a real run in the browser that the server
  replays bit for bit, and a new device. Needs Playwright: `PLAYWRIGHT=<path>/node_modules/playwright`.
