# Meow Division

Meow Division is a browser zombie-survival game with an item economy on NEAR mainnet. You play Copper, a cat operative, in San Francisco after the NEAR AI office was overrun. A raid lasts about ten minutes. What you carry out (gears, fuel, medical supplies, boss trophies) goes to your stash, and for a player with a wallet every raid find is a NEP-245 token on `items.meowdivision.near` — only those trade on the players' market, so a merchant's shelf can't be bought out and flipped there. Walt, the merchant, has his own NEAR account and prices that follow his stock. Players sell items to each other for dollars, paid with any coin through NEAR Intents.

The problem it solves: in most games loot is a number in a database the studio can reset, and blockchain games make the player deal with wallets, popups and gas. Here the items are tokens on a public chain, tradable between players and visible in any explorer, and the game still plays like a game. A guest plays with nothing to install. Signing in is one message signature. After that the game's server signs every item movement, so the game loop has no wallet popups and no gas. A player without a wallet can make one inside the game: the 12-word recovery phrase is made in the browser and stays there; the server only ever gets the public key.

- Play: https://game.meowdivision.fun (desktop and phone), or the Telegram Mini App of [@MeowDivisionBot](https://t.me/MeowDivisionBot)
- Skip mission 1 (for reviewers): https://game.meowdivision.fun/?demo=1
- Players' market: https://game.meowdivision.fun/market
- Contract: [`items.meowdivision.near`](https://nearblocks.io/address/items.meowdivision.near) on mainnet
- Site: https://meowdivision.fun
- Demo post with the video: https://x.com/meow_division/status/2121698431471337598
- Built at NEAR HACKATHON 2026, tracks `games` and `agents`

## What the track asks and where it is

Track `games` ("NPCs with wallets, player-owned markets and economies that evolve without a dev patch"):

| The track asks for | In Meow Division | See |
| --- | --- | --- |
| Items as NEP-245 multi tokens, one contract for every item type | `items.meowdivision.near`, 32 item types | `contract/`, "Verify without playing" |
| A merchant that is an agent with its own wallet and inventory | Walt: `walt.meowdivision.near` holds his stock | "Walt as an agent" |
| Prices from his stock and demand; flood the market and the item gets cheap | one formula on his stock: every sale to him lowers his price for that item, every purchase raises it | `live/economy.js`, step 4 |
| Pricing rules in one readable file, the merchant's reasoning shown | `live/economy.js`; Walt's bubble says why he pays that much, with the numbers | step 4 |
| A fast-forward mode: a week of trading in a minute | **Fast-forward a week** in Walt's window | step 5 |
| No seed phrases, no wallet popups, no gas prompts in the game loop | a guest plays at once; sign-in is one message; the server's key moves the items. There is no social or email login: a player without a wallet makes one inside the game and is shown its 12 words to write down | steps 1 and 7, "What the server's key can and cannot do" |
| A player-owned market | players' lots and bids in dollars, paid with any coin through NEAR Intents | step 6, `docs/market.md` |
| An economy that moves without a dev patch | each day simulated players trade with Walt, his stock decays, he restocks and sets a daily task; an AI note sums up his day | "Walt as an agent" |
| The game loop: every 30 seconds, 5 minutes, session | the table below | "What the player does" |

Track `agents` ("agents that earn, spend, negotiate"): Walt holds his own account and stock, and buys and sells at prices set from that stock; his wallet mirrors his shelf after every trade. How he holds his key and what he cannot do is in "Walt as an agent". He negotiates one step: asked for 20% more, he agrees, comes back with his own number from 1% to 19%, or refuses, and says why with his numbers (`E.haggle` in `live/economy.js`; step 4). He does not hire or pay other agents.

## How one item travels

1. A zombie or a boss drops gears in a raid. You carry them to the exit.
2. The page sends the run's input log. The server plays the whole run again from it and gets the same gears.
3. The server mints the gears to your account (`game_mint`, memo `run:<id>`). A guest's gears wait in the browser until they sign in.
4. You sell them to Walt: the server burns them from your account (`game_burn`), you get coins, and within a minute the same gears are minted to Walt's account. His price for gears goes down.
5. Another player buys gears from Walt: a plain game item, usable anywhere in the game but never a token and never listable on the players' market — that keeps flippers from buying his shelf out to resell it there. His price goes up, and his wallet follows his shelf down.
6. Or you list your own gears — the ones you carried out — on the players' market at a dollar price: they are burnt from your account and held as a lot. A buyer pays with any coin through NEAR Intents 1Click, the gears are minted to the buyer (a token again, resellable) and you get 97.5% in USDC on NEAR.

## Try it in three minutes

The short way (no fighting): open https://game.meowdivision.fun/?demo=1. You land in NEAR Base as a guest who has just won mission 1, with the Butcher's cleaver, a few materials and 1,900 coins in the stash. Go on from step 4. This demo progress lives in that browser only: the server has no replayed run behind it, so nothing from it can reach a wallet or the players' market.

The full way:

1. Open https://game.meowdivision.fun and press **Start raid**. See the intro and Nova's first order. You are a guest; nothing was asked of you.
2. Follow the arrow to the supply crate and open it. See armour, a medkit and the pistol upgrade appear on the perk bar.
3. Survive the first horde, take the magnet, pick the skill when the three cards show. Clear the parking lot, take the medkit and Nova's supply drop. Enter the office, hold for 90 seconds, kill the Butcher, then press **Finish mission**. See "The office is clear and Walt is safe." and the cleaver under "Brought home"; press **NEAR base**.
4. In NEAR Base walk to Walt (the arrow points at him) and press E, or tap him on a phone. His trade window opens with your stash beside his shelf. The first sale is a short lesson: pick the cleaver and hold **Sell** for two seconds. See the coins fly up and the cleaver appear on his shelf at a higher price. On later picks Walt says in his bubble why he pays that much. Pick a material and press **Haggle** under Sell: you ask for 20% more and Walt answers once. See him agree when he has none of it, come back with a smaller addition the more of it he holds (1% to 19%), or refuse when he holds half of what he wants or more, each time with his stock in the answer; the price on the panel changes to the agreed one for two minutes.
5. In Walt's window press **Fast-forward a week** (top right, on the Goods tab). For one minute simulated players sell to him and buy from him, one day about every nine seconds. See the slots they hit flash, the middle panel show what Walt paid before and pays now, and Walt sum up each day. It runs on a copy of his shelf; **Back to today** brings back the real one.
6. Open Walt's **Market** tab (or https://game.meowdivision.fun/market). See players' lots priced in dollars, the order book and the last trades; a trade opens its transaction on NearBlocks. Listing and buying need a signed-in account: **Buy** on a lot opens the payment window, where you pick any coin and get a one-off deposit address and QR from NEAR Intents 1Click.
7. Optional, needs a NEAR wallet: in the lobby press **Connect wallet**, then **Connect a NEAR account** and approve one message (NEP-413, no transaction). From then on what you bring home from a raid is minted to your account: see the `game_mint` to your account among the contract's transactions on NearBlocks.

## Verify without playing

Every line is a link or a command and what it should show. The `near` commands are near-cli-rs.

| Check | Expect |
| --- | --- |
| `curl https://game.meowdivision.fun/api/health` | `{"ok":true,"network":"mainnet","rev":…,"ai":"deepseek-ai/…"}`: the server is up, on mainnet, with NEAR AI Cloud connected |
| `curl "https://game.meowdivision.fun/api/walt?lang=en"` | Walt's shelf (`stock`), today's sales to him (`recent`), `"wallet":"walt.meowdivision.near"`, his lines and the day's `note` written by the model |
| `curl https://game.meowdivision.fun/api/market` | `"on":true`, `"treasury":"treasury.meowdivision.near"`, `lots`, `bids`, and `trades` with a `tx` hash each |
| `curl https://game.meowdivision.fun/api/leaderboard` | accounts ranked by final bosses killed |
| [items.meowdivision.near on NearBlocks](https://nearblocks.io/address/items.meowdivision.near) | `game_mint`, `game_burn` and `game_wallet` calls; NEP-245 `mt_mint` / `mt_burn` / `mt_transfer` events in the receipts |
| [walt.meowdivision.near](https://nearblocks.io/address/walt.meowdivision.near) | his balances follow his shelf: players' sales arrive, what they buy out leaves |
| [treasury.meowdivision.near](https://nearblocks.io/address/treasury.meowdivision.near) | the market's money: USDC in from 1Click, USDC out to sellers |
| `near contract call-function as-read-only items.meowdivision.near version json-args '{}' network-config mainnet now` | `"0.2.1"` |
| `near contract call-function as-read-only items.meowdivision.near holdings_of json-args '{"account_id":"walt.meowdivision.near"}' network-config mainnet now` | Walt's stock as token balances; compare with `stock` from `/api/walt` (his account follows the shelf within ten minutes) |
| `near contract call-function as-read-only items.meowdivision.near mt_tokens json-args '{}' network-config mainnet now` | the 32 registered item types |

Checklist for the code:

- [ ] `npm test`, `npm run check:det`, `npm run check:unit`, `npm run check:server` pass.
- [ ] A guest finishes mission 1 without any wallet prompt.
- [ ] Selling to Walt raises his stock and lowers his price for that item (`test/market.test.mjs`); his bubble explains the price (`test/economy.test.mjs`).
- [ ] Fast-forward moves prices in Walt's window.
- [ ] `/market` shows lots and the order book; listing an item takes it off the stash; Buy gives a 1Click deposit address and QR; after the payment the item is in the buyer's stash and the seller's USDC payout is on NearBlocks (`test/marketplace.test.mjs`).
- [ ] The same wallet on a second device continues the same progress (it is kept on the server per account).
- [ ] The server's key can call only `game_mint`, `game_burn` and `game_wallet` (`contract/src/lib.rs`, `GAME_METHODS`).
- [ ] `?demo=1` opens NEAR Base with the cleaver in the stash and leaves the guest's own progress untouched (`gen/unitcheck.mjs`).

## What the player does

| Every 30 seconds | Every 5 minutes | Every session |
| --- | --- | --- |
| Shoot and dodge the horde, pick up XP and coins, put a dropped item into the 8-slot backpack, choose what to leave behind when it is full | Pick a skill on a level-up, fight a boss (they come at 2:30, 5:00 and 7:30, the final one at 9:00), decide whether to evacuate with the loot (the exit opens at 4:00) or stay for the bigger bosses; dying loses the backpack except its safe slots | Sell loot to Walt or list it on the players' market, do Walt's and Nova's daily tasks, put parts into base buildings (generator, stash, workbench, medbay), upgrade guns and the hero, pick the next mission |

## Run it locally

Prerequisites: Node 22.12+ and git. No keys and no `.env` are needed: the server reads only real environment variables, and with none it runs the whole game for guests.

```sh
git clone https://github.com/Meow-Division/meow-division.git
cd meow-division
npm ci
npm test            # unit tests (node:test)
npm start           # http://localhost:8930/  (redirects to /live/index.html)
```

Expect: the lobby in your browser's language; **Start raid** plays the intro and mission 1; a finished run shows results; NEAR Base opens after mission 1 (or at once with `http://localhost:8930/live/index.html?demo=1`). Without `NEAR_SIGNER_KEY` nothing is sent to the chain: items stay in the server's and the browser's records, and wallet creation answers that it is not ready. Without `NEAR_AI_API_KEY` Walt speaks his written lines and the bosses' tactics are picked by rules.

Other checks: `npm run check:det` (client and server simulations agree over 120 runs, forbidden `Math` calls are caught), `npm run check:unit`, `npm run check:server` (API, tickets, cheat attempts, the guest-to-account hand-over), `npm run check:secrets`. Contract: `cd contract && cargo test` (unit tests and near-sandbox tests; Linux or macOS).

## How NEAR is used

| Piece | Where | What |
| --- | --- | --- |
| Items | `items.meowdivision.near`, NEP-245 (`contract/`, v0.2.1) | one contract holds every item type: 21 materials, 5 boss trophies, 5 kits and the Phantom rifle are registered. NEP-297 events on every mint, burn and transfer |
| Server signer | a function-call key on the contract's account (`NEAR_SIGNER_KEY`; methods `game_mint`, `game_burn`, `game_wallet` only) | the server replays a run, then mints its loot to the player (`run:<id>`); a sale to Walt, a build or an upgrade burns the items spent. The player signs nothing |
| Walt | `walt.meowdivision.near` | the merchant's own account. His shelf is kept by the server and mirrored to his account's balances within ten minutes. The function-call key he holds can call `market_give` and nothing else; purchases are plain items now (no token), so nothing calls it |
| Login | NEP-413 `signMessage` via `@hot-labs/near-connect` (HOT inside Telegram) | one signature, verified on the server; no transaction, no key added to the player's account |
| In-game wallet | contract method `game_wallet`, `live/newwallet.js`, `server/wallets.mjs` | a player with no wallet gets `<name>.near` made for them: the phrase and key are made in the browser, the contract creates the account and pays its 0.01 NEAR. Open after mission 1, one per device, with daily caps |
| Guests | the browser, plus the server's record of their replayed mission runs | at first sign-in the account takes over what the server has proof of, and it is minted in one `game_mint` |
| Run verification | deterministic 120 Hz sim (`live/sim.js`) + `server/replay-worker.mjs` | the server re-simulates every run from the input log with the same files before paying anything |
| Players' market | NEAR Intents 1Click (`server/market.mjs`, `live/market.html`, Walt's Market tab; `docs/market.md`) | a seller lists stash items at a dollar price (they leave the wallet: `game_burn`). A buyer pays with any coin 1Click supports to a one-off deposit address; 1Click delivers USDC on NEAR to `treasury.meowdivision.near`; the server mints the items to the buyer and pays the seller 97.5% in USDC. Paid bids ("buy at my price") work the same way. A refunded or unpaid order frees the lots |
| Walt's words | NEAR AI Cloud (`server/nearai.mjs`, `server/waltai.mjs`; DeepSeek V4.1 Flash) | his note on the day's market and a line for each item at its price's state, in four languages. The model writes words with slots like `{buy}`; the page fills them from the formula, and a reply with a digit in it is thrown away, so a price never comes from the model |
| Boss mind | NEAR AI Cloud (`server/bossmind.mjs`) + `live/sim.js` `MIND` | after you beat a final boss, the model reads your last fights with him and picks one or two tactics from a fixed menu for your next run (more rings, keep away, more zombies, rage sooner). The run's ticket carries the pick, so the server's replay plays the same boss, and Nova warns you in the model's words |
| Market watch | NEAR AI Cloud (`server/watch.mjs`) | every few hours the day's trades with Walt and the runs' loot are summed up and the model writes to the server's log what looks off. It changes nothing |

On-chain: the items a signed-in player carries out of raids and every movement of them (a mint, a sale to Walt, a build or an upgrade that spends them, a listing, a purchase on the players' market), Walt's stock, the market's payments and payouts. What a player buys from Walt is a plain game item kept by the server. Off-chain (the game's server): coins, levels, guns other than the Phantom, building levels, campaign progress, the leaderboard, run logs.

## What the server's key can and cannot do

The player signs nothing in the game loop, so the server's key does the item movements. This is what that key is able to do.

It can:

- give game items to an account (`game_mint`) and take game items from an account (`game_burn`). Every such call is public: see them on [NearBlocks](https://nearblocks.io/address/items.meowdivision.near);
- create a `<name>.near` account for a player who asked for one (`game_wallet`).

It cannot:

- touch a player's NEAR, USDC or any other token, or another project's NFTs: it is a function-call key that can call these three methods of this one contract and nothing else (`contract/src/lib.rs`, `GAME_METHODS`);
- sign anything as the player. The server holds no player keys. Sign-in is one NEP-413 message and adds no key to the wallet. For a wallet made in the game, the 12 words and the key are made and kept in the player's browser; the server gets the public key;
- send a transfer from a player's account. An item changes hands only as a burn and a mint, each recorded on chain with a memo saying why (`run:<id>` on a mint, `game:<operation>` on a burn).

So a player trusts the game with their game items, as in any online game, with the difference that every grant and removal is on a public chain. They trust it with nothing else in their wallet.

## Planned, not in this build

These are in the contract and its tests already, and the game does not use them yet:

- **Player-signed actions.** The contract has `sell`, `craft`, `spend` and `equip`, which a player calls on their own items. With them the player, not the server, would sign a sale or a build. Today the server's key does this work.
- **Crafting kits.** The recipes are on chain and shown in the game as "Goes into". There is no crafting screen yet and no kit has been made.

After the hackathon: NFT cats, a token and staking. None of that is in this repository.

## Walt as an agent

- **His own account and stock.** `walt.meowdivision.near` holds what is on his shelf, kept in step by the server after every trade. What he sells comes to the buyer as a plain game item (no token: the players' market trades raid finds only, so his shelf can't be flipped there). The key the server once used for him can call one method, `market_give`, with a 0.25 NEAR allowance; it cannot mint, burn, move NEAR or call anything else, and since purchases went plain nothing calls it.
- **Prices from his stock.** `live/economy.js`, one file: `buy = base × 2 × norm / (norm + stock)`, `sell = buy × 2.33`. The less he holds, the more he pays and asks. His bubble shows the numbers behind each price.
- **He trades with or without you.** For every day that passes the server plays "other players" on his shelf (a few sales and buys, 5% decay), and each morning he restocks the basic parts. The parts of the generator and the workbench, the first two buildings, are put back after every purchase as well (`server/walt.mjs`), so a crowd of new players is not left waiting for them. Fast-forward shows a week of this in a minute.
- **A daily task.** Once a day he asks every player for the same item and pays 1.3 times his price for it.
- **He speaks through NEAR AI.** The note you see when you walk up and the line for each item are written by the model from his shelf's state. Guards: no digits, only known slots, the right alphabet, 8 to 120 characters. Until a line passes them he speaks his written lines.
- **Haggling.** A player may ask for 20% more once per item. His answer is a rule in the same file (`E.haggle`): what he adds falls evenly from the full 20% with none on his shelf to nothing at half of what he wants, and what players sold him today counts as already on the shelf. The agreed price holds for two minutes and is checked by the server (`live/rules.js`, action `haggle`); it never reaches what buying the item back from him costs. Fixed-price items are not haggled over.
- **What he does not do.** He does not set prices by model, hire or pay other agents, or hold coins on chain: coins are the game's. The Phantom rifle has a fixed price (he pays 5,000 and asks 15,000).

## More in the game

- Three playable missions on a five-node campaign map: the NEAR office (the Butcher), the suburbs (final boss: the Mushroom Monster), the lab (final boss: the Devourer).
- Co-op for two over WebSocket (`server/rooms.mjs`): open or private rooms, invites by link or through the Telegram bot; the server replays both players' inputs.
- Voice and text in English, Ukrainian, Russian and Spanish.
- Telegram: the Mini App, and a message when your lot is bought or your bid fills.
- The Phantom rifle: a rare drop (0.3% from a raid boss, 2% from a final boss), usable as a gun while it is in the stash.

## Architecture

```
browser  live/sim.js (120 Hz deterministic sim) ── input log ──▶ server/replay-worker.mjs (same files, re-simulated)
         live/economy.js (prices, loot tables, costs)            server/chain.mjs ── game_mint / game_burn / market_give ──▶ items.meowdivision.near
         live/wallet.js (NEP-413 sign-in) ─────────────────────▶ server/server.mjs (sessions, accounts, API)
         live/newwallet.js (phrase and key, in the browser) ───▶ server/wallets.mjs ── game_wallet ──▶ <name>.near
         live/market-page.js, live/market.js ──────────────────▶ server/market.mjs ── 1Click quote / status ──▶ NEAR Intents
                                                                 server/walt.mjs, waltai.mjs, bossmind.mjs, watch.mjs ──▶ NEAR AI Cloud
```

Details: `docs/design.md` (what the game is), `docs/chain.md` (contract and flows), `docs/market.md` (players' market), `docs/ops.md` (hosting), `docs/style.md` (how the code is written), `AGENTS.md` (rules for coding agents).

## Provenance

Everything here was written inside the hackathon window (announcement 2026-10-19, deadline 2026-11-14). The first commit, [35f0023](https://github.com/Meow-Division/meow-division/commit/35f0023), imports our own earlier prototype (written 2026-10-21 to 2026-11-07, inside the window). Everything after it is hackathon work. Tags: [`pre-hackathon`](https://github.com/Meow-Division/meow-division/tree/pre-hackathon) is that import, [`hackathon-submission`](https://github.com/Meow-Division/meow-division/tree/hackathon-submission) is the submitted state; [the diff between them](https://github.com/Meow-Division/meow-division/compare/pre-hackathon...hackathon-submission).

Built with: Node.js, near-sdk-rs, cargo-near, near-sandbox, `@hot-labs/near-connect` (vendored), NEAR Intents 1Click API, NEAR AI Cloud, FastNEAR RPC, Telegram Web Apps SDK (vendored copy), `qrcode-generator` (vendored), Rubik font (Google Fonts), CC0 sounds from Kenney and BigSoundBank. AI tools: Claude Code and Codex for code and images, ElevenLabs for the characters' voices, Meshy for the Phantom's 3D model. No other team project is submitted to this hackathon.

## License

MIT, see `LICENSE`.
