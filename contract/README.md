# Meow Division items contract

One [NEP-245](https://github.com/near/NEPs/blob/master/neps/nep-0245.md) multi-token contract holds every item,
boss trophy, kit and skin in the game. On mainnet it lives at `items.meowdivision.near`.

## What it does

| Who calls | Method | Deposit | What happens |
| --- | --- | --- | --- |
| anyone, from their wallet | `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`, `mt_batch_transfer_call` | 1 yoctoNEAR | standard NEP-245 transfers |
| the game server | `game_mint(receiver_id, token_ids, amounts, run_id)` | none | sends a replay-verified run's loot to the player; a `run_id` is applied once |
| the game server | `game_burn(owner_id, token_ids, amounts, op_id)` | none | removes kits used up in a run and the daily decay of Walt's stock |
| a player | `sell(token_ids, amounts, request_id)` | none | moves the player's items to Walt; the server pays coins at the price from `live/economy.js` |
| a player | `craft(recipe_id, times, request_id)` | none | burns a recipe's inputs and mints its output (medkit, grenades, ...) |
| a player | `spend(token_ids, amounts, purpose, request_id)` | none | burns items for a building level or a barter; the server reads `purpose` from the event |
| a player | `equip(token_id)` | none | wears a skin the player holds |
| Walt | `market_give(receiver_id, token_ids, amounts, request_id)` | none | hands items from Walt's stock to a buyer |
| the game account | `register_tokens`, `set_recipes`, `remove_recipe`, `set_roles` | 1 yoctoNEAR | adds items and recipes, moves the server or Walt role |

Views: the NEP-245 core (`mt_token`, `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`), the
Metadata extension (`mt_metadata_contract`, `mt_metadata_token_all`, `mt_metadata_token_by_token_id`,
`mt_metadata_base_by_token_id`, `mt_metadata_base_by_metadata_id`), Enumeration (`mt_tokens`,
`mt_tokens_for_owner`, `mt_tokens_base_metadata_all`), and `holdings_of`, `recipes`, `equipped_of`, `config`,
`op_done`, `version`. Every balance change logs a NEP-297 event (`nep245` / `1.0.0`: `mt_mint`, `mt_burn`,
`mt_transfer`).

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

## Build and test

Needs Rust (the version in `rust-toolchain.toml`, installed automatically by rustup) and
[cargo-near](https://github.com/near/cargo-near).

```
cd contract
cargo test                              # 15 unit tests, then 3 tests on a local NEAR sandbox (about 2 minutes)
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

The game server signs `game_mint` and `game_burn` with a function-call key on `items.meowdivision.near` limited
to those two methods. Walt's server key on `walt.meowdivision.near` is limited to `market_give`.
