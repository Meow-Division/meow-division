---
paths:
  - "contract/**"
---
# Contract (`contract/`): NEP-245 multi token in Rust

- near-sdk-rs 5.x, built with `cargo near build`; `Cargo.toml` has `overflow-checks = true`, `panic = "abort"`, `lto = true`. Project created with `cargo near new`, layout `src/lib.rs`, `src/{token,events,market,game}.rs`, `tests/*.rs`.
- Follow the `near-smart-contracts` agent skill (install: `npx skills add near/agent-skills --skill near-smart-contracts -a claude-code -g`) and the NEP texts: NEP-245 core and Metadata, NEP-297 events. Verify method names against the spec, never from memory.
- Standard methods keep standard rules: transfers are `#[payable]` and `assert_one_yocto()`; callbacks are `#[private]`; storage is checked; events are emitted for mint, burn, transfer with `standard: "nep245"`, `version: "1.0.0"`.
- Game methods are the product's no-popup path and are documented as such in the README:
  - `game_mint`, `game_burn`: only `signer == config.game_signer`; `run_id` recorded in a `LookupSet`, a repeat is a no-op that returns the recorded result.
  - `sell`, `craft`, `equip`: no deposit, `predecessor_account_id` must own the items; reachable through the player's function-call key (allowance-limited, methods whitelisted at connect).
  - `market_*`: only Walt's key.
- Storage is paid by the contract's balance; the contract refuses an operation that would leave less than `MIN_RESERVE` so it never gets stuck. Players never pay storage.
- Token ids are strings from `docs/design.md`, fixed forever. Metadata (`mt_metadata_*`) carries names and icons; adding an item is a metadata call, not a redeploy.
- Tests (`cargo test`): near-sandbox integration tests cover mint once per run, stranger cannot mint, player cannot move another's items, sell transfers to Walt and emits `mt_transfer`, craft burns inputs and mints the kit, metadata reads. Keys for tests are generated in the test; no key material in fixtures.
- Build artefact: `contract/res/items.wasm` is committed only when the deployed version changes, with the `cargo near build` output hash in the commit body.
- Deploy is the human's action from their wallet; print the exact command (`near contract deploy items.meowdivision.near use-file contract/res/items.wasm with-init-call new json-args '…' network-config mainnet …`) and wait. State migration needs a `migrate` method and a sandbox test from the previous state.
