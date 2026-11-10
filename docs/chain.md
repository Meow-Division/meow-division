# NEAR integration

Mainnet only. There is no testnet in this project: tests run against a local sandbox, real money moves on mainnet in tiny amounts, and only after the human says yes.
Verify every address, endpoint and SDK version in the docs (https://docs.near.org/llms.txt, https://docs.near-intents.org/llms.txt, https://docs.near.ai/) instead of recalling it.

## Accounts

| Account | Role | Keys |
| --- | --- | --- |
| `meowdivision.near` | the game's account: owns the contracts, funds storage, receives Intents payments | the human's wallet only. We never hold its full-access key. |
| `items.meowdivision.near` | the NEP-245 contract: every item, trophy, kit and skin | created, deployed and set up in one transaction from the human's wallet (`contract-launch.bat`); no full-access key, code changes only through the owner's `update_contract` |
| `walt.meowdivision.near` | Walt's wallet: his stock is his NEP-245 balance | a function-call key for the server (methods: market_*), never full access |
| server signer | a function-call key on the contract account, limited to the `game_*` methods (`game_mint`, `game_burn`, since 0.2.0 `game_wallet`), allowance capped | `NEAR_SIGNER_KEY` in the server's environment |
| player wallets | hold items; add one function-call key for the contract at connect | the player's wallet; we never see a seed phrase |
| wallets made in the game | `<name>.near`, created by the contract through the `near` registrar (`game_wallet`), 0.01 NEAR from the contract | one full-access key, made in the player's browser from a 12-word phrase that stays there; the server gets the public key only |

Account ids and the RPC URL live in one config module (`server/config.mjs`, read from env with mainnet defaults). Nowhere else.

## Contract (`contract/`, Rust, near-sdk 5.30, built with cargo-near 0.23)

- Standard: NEP-245 Multi Token, with the Metadata extension and NEP-297 events (`standard: "nep245"`, `version: "1.0.0"`, events `mt_mint`, `mt_burn`, `mt_transfer`). Standard methods keep the standard rules (1 yoctoNEAR on transfers, `#[payable]`, `#[private]` callbacks).
- Game methods (the reason the game has no popups; full table in `contract/README.md`):
  - `game_mint(receiver_id, token_ids, amounts, run_id)` and `game_burn(owner_id, token_ids, amounts, op_id)`: only the game signer; the id is recorded so a verified run can never be minted twice.
  - `sell(token_ids, amounts, request_id)`, `craft(recipe_id, times, request_id)`, `spend(token_ids, amounts, purpose, request_id)`, `equip(token_id)`: called by the player through their function-call key, no deposit, only on the caller's own items; none can move items to an account the caller chooses. This is a deliberate trade-off against the 1-yocto rule and is documented in the README: the key is limited to this contract and these four methods.
  - `market_give(receiver_id, token_ids, amounts, request_id)`: Walt's side of a trade, only his key.
  - `game_wallet(account_id, public_key, request_id)` (0.2.0): only the game signer; calls the registrar `near`'s
    payable `create_account({new_account_id, new_public_key})` (near-linkdrop, the code `near` runs) with
    `wallet_deposit` from the contract's balance, at most `wallets_left` times (`set_wallets`, owner, 1 yoctoNEAR);
    a request id is applied once, a failure gives the place and the id back; event `wallet_create`.
- Storage is paid by the contract's own balance (funded by the game account). Players never see a storage deposit. Keep at least 2 NEAR of headroom; mint once per run end, in one batch.
- Token ids are strings fixed forever (see `docs/design.md`). Adding an item is a metadata entry, not a contract change.
- Every state change emits a NEP-297 event. Explorers (NearBlocks) show them; the README points judges there.
- Tests: `cargo test` with near-sandbox (integration tests under `contract/tests/`), covering mint once per run, sell to Walt, craft burns inputs, a stranger cannot call `game_mint`, a player cannot move another player's items. CI builds the wasm and runs them.
- Deploy: `cargo near build` on the build box, then the human deploys from their wallet (`near contract deploy items.meowdivision.near use-file ... network-config mainnet sign-with-...`). The agent prints the exact command and waits.

## Flows

1. **Guest**: plays with a device token; items and coins sit in the server ledger (`guest_ledger`). Nothing on chain yet.
2. **Create** (no wallet yet, mission 1 finished): the player types a name, the page makes a 12-word phrase and its
   key (BIP39, SLIP-10 ed25519 at m/44'/397'/0', as near-seed-phrase: the words open the wallet in HOT, Meteor or
   MyNearWallet) and keeps them in the browser; the server's `game_wallet` creates `<name>.near` with the public key;
   the page signs the login below with the new key; the words are shown once to write down (`live/newwallet.js`,
   `server/wallets.mjs`). No window of another site opens.
3. **Connect**: wallet sign-in through `@hot-labs/near-connect` (HOT in Telegram, Meteor and others on PC), NEP-413 `signMessage` with a server nonce, recipient = the game's domain, verified on the server (signature over sha256(borsh(tag 2^31+413, payload)); the key must be a full-access key of the account; nonce single-use, 5 minutes). Then the wallet adds one function-call key for `items.meowdivision.near` (methods `sell,craft,spend,equip`, small allowance). Then the guest ledger is minted to the wallet in one `game_mint` and the device is bound to the account.
4. **Run end**: the client sends the input log; the replay worker re-simulates; the outcome (items extracted) is minted with `game_mint(run_id)`. Coins and progress are credited off-chain in the same step.
5. **Sell**: client calls `sell` with the function-call key; the contract transfers to Walt and emits `mt_transfer`; the server credits coins at the price `live/economy.js` computed from Walt's stock at that block.
6. **Craft / build**: `craft` burns inputs and mints the kit; buildings only check balances and spend coins off-chain.
7. **Skin shop (Intents)**: price in any token through the 1Click API, `dry: true` quotes until the human approves real flow; settlement to `meowdivision.near`; the skin is minted on confirmation. 0.2% fee without a JWT is acceptable.
8. **Walt's words (NEAR AI Cloud)**: the server asks the model to phrase the price reasoning from the numbers; cached per price state; a plain-text fallback is always ready. Gameplay never waits for the model.

## Rules for every agent working here

- Never sign, send, deploy or spend on mainnet without the human's yes in the current conversation. The server's runtime signing with its limited function-call key is part of the product and is approved with the deploy.
- No private keys in the repo, in logs, in chat, in test fixtures (sandbox keys are generated at test time).
- Reads go through one RPC client with timeouts and a fallback provider; the game must keep working when RPC is down (queue the mint, show "will arrive").
- Chain calls are idempotent by `run_id` or `request_id`; a retry never double-mints.
- The player never sees chain words. See `docs/design.md`, "Player-facing language".
