# Meow Division items contract

One [NEP-245](https://github.com/near/NEPs/blob/master/neps/nep-0245.md) multi-token contract holds every item,
boss trophy, kit and skin in the game. On mainnet it lives at `items.meowdivision.near`.

## What it does

| Who calls | Method | Deposit | What happens |
| --- | --- | --- | --- |
| anyone, from their wallet | `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`, `mt_batch_transfer_call` | 1 yoctoNEAR, plus the storage it adds (0.2.1) | standard NEP-245 transfers; to an account holding nothing here the sender pays its record, the rest of the deposit comes back |
| the game server | `game_mint(receiver_id, token_ids, amounts, run_id)` | none | sends a replay-verified run's loot to the player; a `run_id` is applied once |
| the game server | `game_burn(owner_id, token_ids, amounts, op_id)` | none | removes kits used up in a run and the daily decay of Walt's stock |
| a player | `sell(token_ids, amounts, request_id)` | none | moves the player's items to Walt; the server pays coins at the price from `live/economy.js` |
| a player | `craft(recipe_id, times, request_id)` | none | burns a recipe's inputs and mints its output (medkit, grenades, ...) |
| a player | `spend(token_ids, amounts, purpose, request_id)` | none | burns items for a building level or a barter; the server reads `purpose` from the event |
| a player | `equip(token_id)` | none | wears a skin the player holds |
| Walt | `market_give(receiver_id, token_ids, amounts, request_id)` | none | hands items from Walt's stock to a buyer |
| the game server | `game_wallet(account_id, public_key, request_id)` | none | creates a player's `<name>.near` through the `near` registrar with the player's key, paying `wallet_deposit` from the contract; a `request_id` is applied once; at most `wallets_left` |
| the game account | `register_tokens`, `set_recipes`, `remove_recipe`, `set_roles` | 1 yoctoNEAR | adds items and recipes, moves the server or Walt role |
| the game account | `set_wallets(wallets_left, wallet_deposit, registrar_id?)` | 1 yoctoNEAR | how many more wallets the game may make and what each one gets (0.002 to 0.1 NEAR) |
| the game account | `update_contract(code)` | 1 yoctoNEAR | replaces the code (base64 wasm) and calls the new code's `migrate` in the same batch; a failed migration keeps the old code |

The contract account holds no full-access key: it is created, deployed and set up in one transaction from the game
account's wallet (`contract/mainnet/launch.html`), and only the game account's `update_contract` changes its code. A
leaked server key is retired by moving its role elsewhere with `set_roles`.

Views: the NEP-245 core (`mt_token`, `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`), the
Metadata extension (`mt_metadata_contract`, `mt_metadata_token_all`, `mt_metadata_token_by_token_id`,
`mt_metadata_base_by_token_id`, `mt_metadata_base_by_metadata_id`), Enumeration (`mt_tokens`,
`mt_tokens_for_owner`, `mt_tokens_base_metadata_all`), and `holdings_of`, `recipes`, `equipped_of`, `config`,
`op_done`, `version`, `wallets`. Every balance change logs a NEP-297 event (`nep245` / `1.0.0`: `mt_mint`, `mt_burn`,
`mt_transfer`); a wallet made in the game logs `meowdivision` / `1.0.0` `wallet_create`.

## Wallets made in the game (0.2.0)

A player without a wallet types a name in the game. The page makes a new 12-word recovery phrase and its ed25519 key in
the browser (the derivation NEAR wallets use, so the words open the account in HOT, Meteor or MyNearWallet) and sends
only the public key. The server calls `game_wallet`; the contract calls the mainnet registrar `near`'s payable
`create_account({new_account_id, new_public_key})` (near-linkdrop, commit 9a6bb316, as its NEP-330 metadata says) with
`wallet_deposit` (0.01 NEAR) from its own balance, so the player needs no NEAR to start. The callback `on_wallet` reads
the registrar's answer: true is a wallet made (`wallet_create` event); anything else (the name taken meanwhile) gives
the place in `wallets_left` and the request id back, and the registrar returns the deposit itself. The cap starts at 0
after the update: nothing is spent until the owner's `set_wallets`. The settings sit under their own storage key
(`wallets`), apart from the contract's struct, so 0.1.0's state reads on unchanged.

0.2.0's `migrate` also gives the server's key on the contract account (`GAME_KEY` in `src/lib.rs`, read from mainnet)
`game_wallet`: one batch on the contract's own account deletes the key and adds the same public key back with
`game_mint,game_burn,game_wallet` and a 1 NEAR allowance. No other key is touched; if the key were not there, the
batch would fail as a whole and change nothing.

## Why some methods take no deposit

NEP-245 asks for 1 yoctoNEAR on transfers, so only a full-access key (a wallet window) can move items. The game
keeps that for every standard transfer. But a player who sells to Walt or crafts a medkit should not see a
wallet window each time. So at connect the player approves one function-call key that may call only `sell`,
`craft`, `spend` and `equip` on this contract, with a small gas allowance. Those four methods take no deposit
and can only send the caller's items to Walt, burn the caller's own items or change the caller's own skin. None
of them can move an item to an account of the caller's choosing. A leaked game key can therefore not steal
items. `tests/items.rs` (`function_call_key_sells_but_cannot_move_items`) checks this on a sandbox.

Storage is paid by the contract itself, so players never attach a storage deposit. Every change checks that at
least 0.5 NEAR stays free above the storage the contract already uses, so the contract never ends up stuck.

0.2.1 (on mainnet since 2026-11-11) stops a holder from spending that balance: a standard transfer pays for the storage
it adds (sending to an account that holds nothing here costs its holdings record, about 0.001 NEAR, attached by
the sender; to a holder, 1 yoctoNEAR as before), and a player's own `sell`, `craft` and `spend` keep their request
ids in one list of the last 32 per player instead of a permanent record per call (`op_done` reads both; a request
recorded by 0.2.0 still counts). The server's methods (`game_mint`, `game_burn`, `game_wallet`) are unchanged.

## Build and test

Needs Rust (the version in `rust-toolchain.toml`, installed automatically by rustup) and
[cargo-near](https://github.com/near/cargo-near).

```
cd contract
cargo test                              # 26 unit tests, then 6 tests on a local NEAR sandbox (about 4 minutes)
cargo near build non-reproducible-wasm  # target/near/meow_division_items.wasm
cargo near build reproducible-wasm      # the same build in the pinned Docker image (needs Docker)
```

## Deploy (the game account owner does this)

[`mainnet/DEPLOY.md`](mainnet/DEPLOY.md) is the step-by-step for the human, every command copy-paste ready for
near-cli-rs on mainnet: create `items.meowdivision.near` and `walt.meowdivision.near`, deploy with `new`, register
every item and recipe, add the server's two function-call keys, check with read-only views, and how much NEAR each
step needs (6 NEAR in all). The JSON arguments are files in `mainnet/`, written from `live/economy.js` and
`live/lang_en.js` by `node gen/chainargs.mjs`; `test/chainargs.test.mjs` fails when they are stale, and the sandbox
test `mainnet_set_up_registers_the_whole_economy` sends exactly these files.

The game server signs `game_mint` and `game_burn` (and, after the 0.2.0 update, `game_wallet`) with a function-call
key on `items.meowdivision.near` limited to those methods. Walt's server key on `walt.meowdivision.near` is limited to
`market_give`. The update itself is in [`mainnet/DEPLOY.md`](mainnet/DEPLOY.md), "Update 0.2.0".

The sandbox tests in `tests/wallet.rs` use `res/items-0.1.0.wasm`, the code deployed on mainnet (its SHA-256 is
checked), to launch and play on the contract as mainnet did and then update it, and `tests/registrar/`, a stand-in for
the `near` registrar with near-linkdrop's own `create_account`.
