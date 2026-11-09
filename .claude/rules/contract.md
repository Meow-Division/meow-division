---
paths:
  - "contract/**"
---
# Contract (`contract/`): NEP-245 multi token in Rust

- near-sdk 5.30, edition 2024, toolchain pinned in `rust-toolchain.toml`, built with cargo-near 0.23 (`Cargo.toml` from `cargo near new`: `overflow-checks = true`, `panic = "abort"`, `lto = true`, reproducible-build image). Layout: `src/lib.rs` (state, owner methods, views, checks), `token.rs` (balances, NEP-245 core), `metadata.rs` (Metadata + Enumeration), `events.rs` (NEP-297), `game.rs` (`game_*`), `market.rs` (`sell`, `market_give`), `player.rs` (`craft`, `spend`, `equip`), `tests.rs` (unit), `tests/items.rs` (sandbox).
- On this PC the contract builds in WSL (Ubuntu distro `meow`, user `meow`, Rust and cargo-near in `~/.cargo`); keep `CARGO_TARGET_DIR` on the Linux disk (`/home/meow/target/items`), building under `/mnt/d` is slow. Windows has no Rust. CI job `contract` runs fmt, clippy `-D warnings`, `cargo test`, the wasm build.
- Verify method names and shapes against the NEP texts (NEP-245 core, Metadata, Enumeration; NEP-297), never from memory. `mt_resolve_transfer` takes `(previous_owner_ids, receiver_id, token_ids, amounts)` like intents.near.
- Standard methods keep standard rules: transfers are `#[payable]` and `assert_one_yocto()`; approvals are refused (no approval extension); the resolve callback is `#[private]` and refunds what the receiver reports unused, as far as it still holds it.
- Game methods are the product's no-popup path, documented in `contract/README.md`:
  - `game_mint(run_id)`, `game_burn(op_id)`: only `game_signer_id` (the contract account itself on mainnet, through a function-call key limited to these two); ids recorded in `ops`, a repeat returns false and changes nothing.
  - `sell`, `craft`, `spend`, `equip`: no deposit, act on the caller's own items only, idempotent by `request_id` per caller; none can move items to an account the caller chooses.
  - `market_give`: only `walt_id`.
- Storage is paid by the contract; `assert_reserve()` runs at the end of every state change and refuses one that leaves less than `MIN_RESERVE` (0.5 NEAR) free. Maps are flushed before measuring.
- Token ids are strings from `docs/design.md`, fixed forever, registered by the owner (`register_tokens`); recipes mirror `live/economy.js` (`set_recipes`). Adding an item or recipe is an owner call, not a redeploy.
- Every test that needs keys generates them (`near_api::signer::generate_secret_key`); the sandbox genesis key comes from `near_sandbox::config`. No key material in the repo.
- A deployed build is recorded by its `cargo near build` SHA-256 in the commit body. Deploy is the human's action: the launch page (`contract-launch.bat` → `scripts/chain-launch.mjs`: the human approves two wallet prompts and clicks, the helper does the rest) or by hand, the steps and their exact commands in `contract/mainnet/DEPLOY.md` (arguments in `contract/mainnet/*.json`, checked by `node gen/chainargs.mjs --check`); print the step and wait for yes. A state change after deploy needs a `migrate` method and a sandbox test from the previous state.
