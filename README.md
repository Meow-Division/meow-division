# Meow Division

<!-- Draft until the public release. Every statement below must be true on the day the repository goes public. Keep it factual: no marketing. -->

Meow Division is a browser zombie-survival game with a real item economy. You play Copper, a cat operative, in San Francisco after the NEAR AI office was overrun. Runs last ten minutes; what you carry out (gears, fuel, medical supplies, boss trophies) is yours: every item is a NEP-245 multi token on NEAR mainnet, the merchant Walt is an agent with his own wallet whose prices follow his stock, and the player never sees the chain. Play as a guest with nothing to install; connect a wallet when you want your gear to follow you.

The problem it solves: in most games loot is a number in a database the studio can reset. Here loot, kits and the merchant's stock are tokens on a public chain, tradable between players and visible in any wallet, and the game still plays like a game: no popups, no gas, and the game's server never sees or asks for a seed phrase (**Create a wallet** makes the wallet in your browser and shows you its 12-word recovery phrase to write down; the words stay in that browser).

- Play: https://game.meowdivision.fun (desktop, phone, and as a Telegram Mini App via <bot link>)
- Contract: `items.meowdivision.near` on mainnet (<explorer link>)
- Built at NEAR HACKATHON 2026, tracks `games` and `agents`. Demo post: <X link>.

## Try it in three minutes

1. Open https://game.meowdivision.fun and press **Start raid**. See the intro and Nova's first order. You are a guest; nothing was asked of you.
2. Follow the arrow to the supply crate, open it. See armour, a medkit and the pistol upgrade appear on the perk bar.
3. Survive the first horde, take the magnet, pick a skill when the three cards show. Clear the parking lot, take the medkit and Nova's supply drop. Enter the office, hold two minutes, kill the Butcher, then press **Finish mission**. See "The office is clear and Walt is safe." and the cleaver under "Brought home" on the results; press **NEAR base**.
4. At NEAR Base walk to Walt and press E (a tap on a phone): his trade window opens with your stash beside his shelf. The first sale is a short lesson: pick the cleaver and hold **Sell** down for two seconds (the window closes only once the cleaver is sold). See the coins fly up and the cleaver appear on his shelf at a higher price. On later picks Walt says in his bubble why he pays that much (a boss trophy, few come his way; for a material, how many he holds against what he needs). Every sale is a two-second hold; a buy of 1,000 coins or more asks twice. Press I anywhere in the base for the stash.
5. Press **Connect wallet** in the lobby (or Nova's offer after the first sale, or the settings), then **Connect a NEAR account** (any NEAR wallet; HOT inside Telegram). Approve once. See your items appear in the wallet's collectibles and on the explorer under your account. Nothing else will ask you to sign.
6. In Walt's window press **Fast-forward a week** (top right). For one minute, simulated players sell to him and buy from him, one day about every nine seconds. See the slots they hit flash, the middle panel show what Walt paid before and pays now, and Walt sum up each day. It runs on a copy of his shelf; **Back to today** brings back the real one.

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
| Players' market | NEAR Intents 1Click (`server/market.mjs`, `live/market.html`, Walt's Market tab) | players list items from their stash at a dollar price (the items leave their wallet: `game_burn`); a buyer pays with any of 1Click's coins on 30+ chains to a one-off deposit address, 1Click swaps it to exactly the order's USDC on NEAR for the market's treasury, the server mints the items to the buyer and sends each seller 97.5% in USDC (`ft_transfer`); a refunded or unpaid order lets the lots go. Docs: `docs/market.md` |
| Walt's words | NEAR AI Cloud (`server/nearai.mjs`, `server/waltai.mjs`; DeepSeek V4.1 Flash in NEAR AI's TEE) | his note on the day's market when you walk up, and a line for each item at its price's state, in the player's language; the model writes words with slots like `{buy}`, the page fills them from the formula, and a reply with a digit in it is thrown away, so a price never comes from the model |
| Market watch | NEAR AI Cloud (`server/watch.mjs`) | every few hours the day's trades and runs are summed up and the model writes to the server's log what looks off (an item piling up, a price at its floor, an account trading faster than a hand); it changes nothing |
| Boss mind | NEAR AI Cloud (`server/bossmind.mjs`) + the sim (`live/sim.js` `MIND`, `SHARP`) | the final bosses learn between runs: after you beat one, the model reads your last fights with him (how fast, how close, which way you dodge, what hit you) and picks one or two tactics from a fixed menu for your next run (aim ahead, throw to the side you dodge to, more rings, keep away, more zombies, rage sooner); the ticket carries the pick, so the server's replay plays the same boss, and Nova warns you on the radio in the model's words. Inside a fight, a boss you kill too fast aims his throws where you are running (a formula, no model) |

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
- [ ] Selling to Walt changes his price; his bubble shows the stock numbers (`test/market.test.mjs`).
- [ ] Connecting a wallet produces one `mt_mint` event on the explorer for the guest's items; later sells produce `mt_transfer` to `walt.meowdivision.near`.
- [ ] Fast-forward moves prices on the market screen.
- [ ] `/market.html` shows every item's order book; listing an item takes it off the stash; Buy gives a 1Click deposit address and QR; after the payment the item is in the buyer's stash and the seller's USDC payout is on nearblocks (`test/marketplace.test.mjs`).
- [ ] The same wallet on a second device continues the same progress.

## Provenance

Everything here was written inside the hackathon window (announcement 2026-10-19, deadline 2026-11-14). The first commit, [35f0023](../../commit/35f0023), imports our own earlier prototype (written 2026-10-21 to 2026-11-07, inside the window). Everything after it is hackathon work: [the diff since the import](../../compare/35f0023...main).

Built with: Node.js, near-sdk-rs, cargo-near, near-sandbox, `@hot-labs/near-connect`, Telegram Web Apps SDK (vendored copy), Rubik font. AI tools: Claude Code and Codex for code and images; recorded voice by the team. No other team project is submitted to this hackathon.

## License

MIT, see `LICENSE`.
