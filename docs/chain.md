# NEAR integration

Mainnet only. There is no testnet in this project: tests run against a local sandbox, real money moves on mainnet in tiny amounts, and only after the human says yes.
Verify every address, endpoint and SDK version in the docs (https://docs.near.org/llms.txt, https://docs.near-intents.org/llms.txt, https://docs.near.ai/) instead of recalling it.

## Accounts

| Account | Role | Keys |
| --- | --- | --- |
| `meowdivision.near` | the game's account: owns the contracts, funds storage | the human's wallet only. We never hold its full-access key. |
| `treasury.meowdivision.near` | the players' market's money (`MARKET_ACCOUNT`): USDC from NEAR Intents 1Click comes in, sellers' payouts go out (`docs/market.md`) | a key for the server, in its environment |
| `items.meowdivision.near` | the NEP-245 contract: every material, trophy and kit (no skins exist) | created, deployed and set up in one transaction from the human's wallet (`contract-launch.bat`); no full-access key, code changes only through the owner's `update_contract` |
| `walt.meowdivision.near` | Walt's wallet: his shelf is his NEP-245 balance (the server keeps it in step, `server/chain.mjs` mirror); he hands each purchase over from it himself (`market_give`) | a function-call key for the server (`market_give` only, 0.25 NEAR allowance; `NEAR_WALT_KEY`), never full access |
| server signer | a function-call key on the contract account, limited to the `game_*` methods (`game_mint`, `game_burn`, since 0.2.0 `game_wallet`), allowance capped | `NEAR_SIGNER_KEY` in the server's environment |
| player wallets | hold items; sign one NEP-413 message at sign-in and nothing else (no key is added to them) | the player's wallet; we never see a seed phrase |
| wallets made in the game | `<name>.near`, created by the contract through the `near` registrar (`game_wallet`), 0.01 NEAR from the contract | one full-access key, made in the player's browser from a 12-word phrase that stays there; the server gets the public key only |

Account ids and the RPC URL live in one config module (`server/config.mjs`, read from env with mainnet defaults). Nowhere else.

## Contract (`contract/`, Rust, near-sdk 5.30, built with cargo-near 0.23)

- Standard: NEP-245 Multi Token, with the Metadata extension and NEP-297 events (`standard: "nep245"`, `version: "1.0.0"`, events `mt_mint`, `mt_burn`, `mt_transfer`). Standard methods keep the standard rules (1 yoctoNEAR on transfers, `#[payable]`, `#[private]` callbacks).
- Game methods (the reason the game has no popups; full table in `contract/README.md`):
  - `game_mint(receiver_id, token_ids, amounts, run_id)` and `game_burn(owner_id, token_ids, amounts, op_id)`: only the game signer; the id is recorded so a verified run can never be minted twice.
  - `sell(token_ids, amounts, request_id)`, `craft(recipe_id, times, request_id)`, `spend(token_ids, amounts, purpose, request_id)`, `equip(token_id)`: callable by a player on their own items with no deposit; none can move items to an account the caller chooses. They are in the contract and its tests, but **the game does not call them**: no key is added to a player's wallet, and the server's key does this work with `game_mint` / `game_burn` (the flows below).
  - `market_give(receiver_id, token_ids, amounts, request_id)`: Walt's side of a trade, only his key.
  - `game_wallet(account_id, public_key, request_id)` (0.2.0): only the game signer; calls the registrar `near`'s
    payable `create_account({new_account_id, new_public_key})` (near-linkdrop, the code `near` runs) with
    `wallet_deposit` from the contract's balance, at most `wallets_left` times (`set_wallets`, owner, 1 yoctoNEAR);
    a request id is applied once, a failure gives the place and the id back; event `wallet_create`.
- Storage is paid by the contract's own balance (funded by the game account). Players never see a storage deposit. Keep at least 2 NEAR of headroom; mint once per run end, in one batch. From 0.2.1 (on mainnet since 2026-11-11) a holder can't spend that balance: a standard transfer to an account holding nothing here carries its storage cost from the sender, and a player's `sell`/`craft`/`spend` request ids sit in one list of the last 32 per player.
- Token ids are strings fixed forever (see `docs/design.md`). Adding an item is a metadata entry, not a contract change.
- Every state change emits a NEP-297 event. Explorers (NearBlocks) show them; the README points judges there.
- Tests: `cargo test` with near-sandbox (integration tests under `contract/tests/`), covering mint once per run, sell to Walt, craft burns inputs, a stranger cannot call `game_mint`, a player cannot move another player's items. CI builds the wasm and runs them.
- Deploy: `cargo near build` on the build box. The contract's account has no full-access key, so a code change goes through the owner's `update_contract`, sent by the human from their wallet on the launch page (`contract-launch.bat`, `contract/mainnet/DEPLOY.md`). The agent prepares it and waits.

## Flows

1. **Guest**: plays with a device token. The progress (items, coins) is kept by the page in the browser; the server keeps a record of the guest's mission runs it has replayed (`DATA_DIR/guests`). Nothing on chain yet.
2. **Create** (no wallet yet, mission 1 proven: the guest's mission runs go to the server with its device token and are
   replayed into the device's record, `server/server.mjs` guests; the page's save counts for nothing): the player types a name, the page makes a 12-word phrase and its
   key (BIP39, SLIP-10 ed25519 at m/44'/397'/0', as near-seed-phrase: the words open the wallet in HOT, Meteor or
   MyNearWallet) and keeps them in the browser; the server's `game_wallet` creates `<name>.near` with the public key;
   the page signs the login below with the new key; the words are shown once to write down (`live/newwallet.js`,
   `server/wallets.mjs`). No window of another site opens.
3. **Connect**: wallet sign-in through `@hot-labs/near-connect` (HOT in Telegram, Meteor and others on PC), NEP-413 `signMessage` with a server nonce, recipient `game.meowdivision.fun` (the game's domain) and the message `Meow Division: sign in to keep your progress under this account` (`server/server.mjs` RECIPIENT, MESSAGE; the page signs no other pair), verified on the server (signature over sha256(borsh(tag 2^31+413, payload)); the key must be a full-access key of the account; nonce single-use, 10 minutes). Nothing else is signed and no key is added. The device is bound to the account, the account takes over what the server's record of that guest proves (`live/rules.js` adopt: never more than the page holds), and the account's first look at its stash mints it to the wallet in one `game_mint` (op `sync-<account>`).
4. **Run end**: the client sends the input log; the replay worker re-simulates; the outcome (items extracted) is minted with `game_mint(run_id)` (op `run-<ticket>`). Coins and progress are credited off-chain in the same step.
4b. **An item added after the launch** (`economy.js` `late`: the Phantom): until the contract's owner registers it
   (`register_tokens`, the launch page's step 8) the server keeps it off the chain: no mint, no burn, and the wallet's look
   leaves the stash's count alone. The server asks the contract (`mt_batch_supply`) at its start and every 10 minutes; once
   the token is there, each account's next look mints what its stash holds of it (op `late-<ids>-<account>`, once).
5. **Sell** (`server/chain.mjs`, on with `CHAIN_ITEMS=1`): the server first sets the stash to the wallet (items sent
   away from it can't be sold too), pays the coins at the price `live/economy.js` computes from Walt's shelf, and burns
   the items off the player's wallet with `game_burn` (op `sell-…`). A burn the wallet refuses (the items moved away
   meanwhile) takes the coins and Walt's shelf back, and the player's purchases wait until their sales are settled.
   Walt's wallet gets the items at its next look (below).
6. **Buy from Walt**: the coins are taken off-chain; Walt's own key sends `market_give` from `walt.meowdivision.near`
   to the player (request id `wbuy-…`), so the explorer shows the item leaving his wallet. If his wallet is short of it
   for now, or his key is out of allowance, the game's key mints it to the player instead (op `gm-wbuy-…`).
7. **Walt's wallet**: holds his shelf. Every 10 minutes and 30 s after a trade the server reads it and sends the
   difference with the game's key (`game_mint` / `game_burn` on his account, op `walt-…`): players' sales, the other
   players' days, the day's decay. The page links it from the shelf ("Склад Уолта на его кошельке ↗").
8. **The stash on the page**: `GET /api/save` and `GET /api/chain` read the wallet and set the stash to it plus what is
   still on its way. A change counts as on its way until the view's block has passed the block it ran in (its height
   from the transaction's outcome), so an item is never counted twice nor dropped while the RPC node lags.
9. **Build / upgrade**: the parts a building's level, a gun's or the hero's upgrade or Walt's daily task takes are burnt off the player's wallet with `game_burn` (ops `build-…`, `up-…`, `put-…`, `daily-…`); coins are spent off-chain. Crafting kits is not built: the recipes are on chain and shown as "Goes into", nothing calls `craft`.
10. **Players' market (NEAR Intents)**: lots and paid bids in dollars, any coin through the 1Click API to a one-off deposit address, USDC on NEAR to `treasury.meowdivision.near`, the items minted to the buyer on `SUCCESS`, 97.5% paid to the seller in USDC. All of it in `docs/market.md`. (The skin shop once planned here was not built.)
11. **Walt's words (NEAR AI Cloud, `server/nearai.mjs`, `server/waltai.mjs`)**: in the background the server asks the model
    (DeepSeek V4.1 Flash, thinking off, a day's token cap) for two lines per item and price state (short, glut, fair,
    trophy; the Phantom has its own) and a note on the day's market, in each language the players use. The model writes words with slots
    (`{buy}`, `{gears.sell}`); `GET /api/walt?lang=` hands them out with the shelf and the page fills the slots from
    `live/economy.js`. A reply with a digit, an unknown slot, markup or the wrong alphabet is thrown away. Kept in
    `DATA_DIR/waltai.json`; the plain texts stay while there are none. Gameplay never waits for the model.
12. **Market watch (`server/watch.mjs`)**: every trade and run's loot goes to `DATA_DIR/market/<day>.jsonl`; every few
    hours and at the day's end the day is summed up, plain checks mark what is plainly off, and NEAR AI writes what
    looks off to the server's log and `<day>.watch.json`. It changes nothing.
13. **Boss mind (`server/bossmind.mjs`, `live/sim.js` `MIND`)**: the replay sums up each run's fight with the final boss
    (`SIM.fight`: its length, the hero's distance and dodge side, what hit him, his gun); the account keeps the last five
    per boss. After a win the model (in the background, about 700 tokens) picks one or two tactics from the menu and
    writes Nova's warning in four languages; without it plain rules pick and Nova says her plain line. A loss: the boss
    forgets. `POST /api/run/start` puts the pick in the ticket (`{k, tac, side}`), so the replay plays the same boss.
    The model never sets a number: what each tactic does is the sim's, the same for every player.

## What it costs (measured, sandbox: `contract/tests/items.rs` `what_sending_items_costs`, `what_walt_costs`)

Gas costs 0.0001 NEAR a Tgas; storage locks 0.00001 NEAR a byte of the contract's balance (freed when a balance goes
to zero). The game's key and Walt's key are charged their allowance for the gas attached, so `chain.mjs` attaches
5 Tgas + 0.4 a token id (1.6–2× what burns).

| Call | Gas burnt | Storage |
| --- | --- | --- |
| a run's loot to a new player, 3 kinds | 3.02 Tgas | +194 bytes |
| the next run's loot | 2.84 Tgas | +52 bytes (the op id, kept for good) |
| one new kind | 2.63 Tgas | +80 bytes |
| a sale (`game_burn`) | 2.64 Tgas | +55 bytes |
| Walt's first shelf, all 31 items | 9.51 Tgas | +932 bytes |
| Walt's shelf topped up or thinned, 10 kinds | 4.85 Tgas | +52 bytes |
| Walt hands 1 item to a new player (`market_give`) | 2.84 Tgas | +141 bytes |

About 0.0008 NEAR a change; a 40-minute player makes 10–20 of them (≈ 0.01–0.015 NEAR, 50 players ≈ 0.6 NEAR). The op
ids are most of the storage. Walt's key: 0.25 NEAR of allowance ≈ 450 purchases, then the game's key mints them.

## Rules for every agent working here

- Never sign, send, deploy or spend on mainnet without the human's yes in the current conversation. The server's runtime signing with its limited function-call key is part of the product and is approved with the deploy.
- No private keys in the repo, in logs, in chat, in test fixtures (sandbox keys are generated at test time).
- Reads go through one RPC client with timeouts and a fallback provider; the game must keep working when RPC is down (queue the mint, show "will arrive").
- Chain calls are idempotent by `run_id` or `request_id`; a retry never double-mints.
- The player never sees chain words. See `docs/design.md`, "Player-facing language".
