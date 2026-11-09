#!/bin/bash
# contract/mainnet/build-wasm.sh — builds the items contract in the WSL build box (docs/ops.md) and copies the wasm to
# contract/target/near/ (gitignored), where DEPLOY.md's `near contract deploy` on Windows reads it. Prints its size and
# SHA-256, which go into the commit body of the deployed build.
# Run from Windows: wsl.exe -d meow -u meow -- bash /mnt/d/game/meow-division/contract/mainnet/build-wasm.sh
set -euo pipefail
. "$HOME/.cargo/env"
cd "$(dirname "$0")/.."
# Building under /mnt/d is several times slower than on the Linux disk.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/target/items}"
cargo near build non-reproducible-wasm
mkdir -p target/near
cp "$CARGO_TARGET_DIR/near/meow_division_items.wasm" target/near/
stat -c '%s bytes' target/near/meow_division_items.wasm
sha256sum target/near/meow_division_items.wasm
