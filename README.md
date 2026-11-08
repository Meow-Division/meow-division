# Meow Division

<!-- Draft until the public release. Every statement below must be true on the day the repository goes public. Keep it factual: no marketing. -->

Meow Division is a browser zombie-survival game with a real item economy. You play Copper, a cat operative, in San Francisco after the NEAR AI office was overrun. Runs last ten minutes; what you carry out (gears, fuel, medical supplies, boss trophies) is yours: every item is a NEP-245 multi token on NEAR mainnet, the merchant Walt is an agent with his own wallet whose prices follow his stock, and the player never sees the chain. Play as a guest with nothing to install; connect a wallet when you want your gear to follow you.

The problem it solves: in most games loot is a number in a database the studio can reset. Here loot, kits and the merchant's stock are tokens on a public chain, tradable between players and visible in any wallet, and the game still plays like a game: no seed phrases, no popups, no gas.

- Play: https://game.meowdivision.fun (desktop, phone, and as a Telegram Mini App via <bot link>)
- Contract: `items.meowdivision.near` on mainnet (<explorer link>)
- Built at NEAR HACKATHON 2026, tracks `games` and `agents`. Demo post: <X link>.

## Try it in three minutes

1. Open https://game.meowdivision.fun and press **Play**. See the intro and Nova's first order. You are a guest; nothing was asked of you.
2. Follow the arrow to the supply crate, open it. See armour, a medkit and the pistol upgrade appear on the perk bar.
3. Survive the first horde, take the magnet, pick a skill when the three cards show. Enter the office, hold three minutes, kill the Butcher. See "Walt is safe" and the cleaver in your bag.
4. At NEAR Base walk to Walt and sell the cleaver. See the coin count rise and the price tooltip explain why Walt paid that much.
5. Press **Connect wallet** (any NEAR wallet; HOT inside Telegram). Approve once. See your items appear in the wallet's collectibles and on the explorer under your account. Nothing else will ask you to sign.
6. Open Walt's market and press **Fast-forward a week**. See prices move as simulated players sell and buy.

## Run it locally

Prerequisites: Node 22.12+ and git. No `.env` is needed for guest mode.

```sh
git clone https://github.com/Meow-Division/<repo>.git
cd <repo>
npm ci
npm test            # unit tests: node:test
npm start           # http://localhost:8930/live/index.html
```

Expect: the start screen in your browser language; a run starts and ends with results; the hub opens. Chain features are off without a signer key and the game says so in one line.

Optional checks: `node gen/detcheck.cjs 120` (client and server simulations agree, forbidden Math is caught), `node server/test.mjs` (API, tickets, cheat attempts), `cd contract && cargo test` (NEP-245 contract on near-sandbox).

## How NEAR is used

| Piece | Where | What |
| --- | --- | --- |
| Items, trophies, kits, skins | `items.meowdivision.near`, NEP-245 | one contract holds every item type; NEP-297 events on every mint, burn, transfer |
| Walt | `walt.meowdivision.near` | an agent with a wallet; his stock is his balance; prices in `live/economy.js` from stock and recent demand |
| Login | NEP-413 `signMessage` via `@hot-labs/near-connect` | one wallet window; verified on the server |
| No popups | function-call key added at connect | `sell`, `craft`, `equip` are signed by the game client without wallet windows |
| Guests | server ledger | minted to the wallet on first connect |
| Run verification | deterministic sim + server replay | the server re-simulates every run from the input log before minting |
| Skin shop | NEAR Intents 1Click | pay in any token, settle to `meowdivision.near` |
| Walt's words | NEAR AI Cloud | phrases the price reasoning; the numbers never come from the model |

On-chain: items, trophies, kits, skins, Walt's stock, every item movement. Off-chain: coins, levels, building levels, campaign progress, leaderboards, run logs.

## Architecture

```
browser  live/sim.js (120 Hz deterministic sim) ── input log ──▶ server/replay-worker.mjs (same files, re-simulated)
         live/economy.js (prices, loot, recipes)                 server/chain.mjs ── game_mint / events ──▶ items.meowdivision.near
         live/wallet.js (NEP-413, function-call key) ──────────▶ server/server.mjs (sessions, ledger, market)
```

Details: `docs/design.md` (what the game is), `docs/chain.md` (contract and flows), `docs/style.md` (how the code is written), `AGENTS.md` (rules for coding agents).

## Verify the features

- [ ] `npm test`, `node gen/detcheck.cjs 120`, `node server/test.mjs` pass.
- [ ] A guest finishes mission 1 without any wallet prompt.
- [ ] Selling to Walt changes his price; the tooltip shows the stock numbers.
- [ ] Connecting a wallet produces one `mt_mint` event on the explorer for the guest's items; later sells produce `mt_transfer` to `walt.meowdivision.near`.
- [ ] Fast-forward moves prices on the market screen.
- [ ] The same wallet on a second device continues the same progress.

## Provenance

Everything here was written inside the hackathon window (announcement 2026-10-19, deadline 2026-11-14). The first commit imports our own prototype "Zombie Horde" (baldingalex.fun), started on 2026-10-21; its history is kept in that commit's message. Everything after it is hackathon work.

Built with: Node.js, near-sdk-rs, cargo-near, near-sandbox, `@hot-labs/near-connect`, Telegram Web Apps SDK (vendored copy), Rubik font. AI tools: Claude Code and Codex for code and images; recorded voice by the team. No other team project is submitted to this hackathon.

## License

MIT, see `LICENSE`.
