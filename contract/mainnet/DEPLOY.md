# Mainnet deploy of the items contract

The human runs every command here, from their own PC, in Windows PowerShell, in `D:\game\meow-division`. No agent
signs, sends or deploys anything on mainnet. Each command is one line; copy it whole. JSON arguments come from the
files in this folder (`file-args`), written by `node gen/chainargs.mjs` from `live/economy.js` and `live/lang_en.js`,
so nothing is typed by hand (and Windows PowerShell 5.1, which strips the quotes inside JSON passed to a program,
cannot break them). Syntax checked against near-cli-rs 0.30.1 (`--help` at every level) and its guide.

Order: 0 prepare, 1 accounts, 2 deploy, 3 items and recipes, 4 server keys, 5 checks. Do not skip ahead: step 3 needs
the contract from step 2, and `set_recipes` refuses a recipe whose items are not registered yet.

## How much NEAR

All of it comes from `meowdivision.near` (it holds about 10 NEAR). Numbers measured on the local sandbox with these
exact files (`cargo test mainnet -- --nocapture` in `contract/`); storage costs 1 NEAR per 100 kB on mainnet.

| What | NEAR |
| --- | --- |
| `items.meowdivision.near` initial balance | **5.5** |
| of which locked for the wasm (303,883 bytes) and the account | 3.04 |
| of which locked for 31 items (9,163 bytes) and 5 recipes (1,256 bytes) | 0.10 |
| of which the game key (about 160 bytes) | 0.002 |
| of which free after set-up: headroom for players' storage and the server's gas (docs/chain.md asks for at least 2; the contract refuses any change that leaves less than 0.5) | about 2.35 |
| `walt.meowdivision.near` initial balance (his keys' storage, his key's gas allowance of 0.25) | **0.5** |
| Gas for every transaction below (deploy 24 Tgas, register_tokens 11 Tgas, set_recipes 5 Tgas, keys and accounts a few Tgas each; 1 Tgas costs 0.0001 NEAR) | under 0.01 |
| **Total from meowdivision.near** | **6.0** (it keeps about 4 for top-ups) |

What it costs later, paid from the items account's free balance: a run's `game_mint` burns up to 3.2 Tgas (0.0003 NEAR)
and stores about 80 bytes (0.0008 NEAR) for its run id; a new player's inventory takes 200 to 400 bytes (0.002 to
0.004 NEAR). The 1.85 NEAR above the 0.5 reserve last for roughly a thousand runs, fewer when many new players join.
Watch the balance (step 5, `view-account-summary`) and top up with the command in "If something fails".

## 0. Prepare

Check the CLI (0.30 or newer) and that the files are what the generator writes today (prints `ok`):

```powershell
cd D:\game\meow-division
near --version
node gen/chainargs.mjs --check
```

Build the wasm in the WSL build box; the script copies it to `contract\target\near\` and prints its size and SHA-256:

```powershell
wsl.exe -d meow -u meow -- bash /mnt/d/game/meow-division/contract/mainnet/build-wasm.sh
(Get-FileHash contract\target\near\meow_division_items.wasm -Algorithm SHA256).Hash
```

Expected for the build checked on 2026-11-09: 303,883 bytes, SHA-256
`7851701AC22688685FD3E2D716A63E1992A746F7805D97F5C23101A5CD6C7D0E`. If the contract changed since, the hash changes;
write the new one into the commit body of the deployed build.

near-cli must be able to sign as `meowdivision.near`. It cannot yet: this PC's near-cli knows no key for it. The
simplest way: the CLI makes a new full-access key on this PC, your wallet approves adding it (a browser window opens,
MyNearWallet by default; `--wallet-url <url>` after `network-config mainnet` picks another wallet that supports this
sign-in), and the key goes into the Windows credential store:

```powershell
near account import-account using-web-wallet meowdivision.near network-config mainnet save-to-keychain
```

With a Ledger instead, skip this and replace `sign-with-keychain` with `sign-with-ledger` in every command signed as
`meowdivision.near`. Never paste a seed phrase or a private key into a chat or a file in this repository.

## 1. Create the two accounts

Each new account gets its own new full-access key, made on this PC and kept in the Windows credential store. These
keys are yours: they never go to the server or into the repository.

```powershell
near account create-account fund-myself items.meowdivision.near '5.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as meowdivision.near network-config mainnet sign-with-keychain send
```

```powershell
near account create-account fund-myself walt.meowdivision.near '0.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as meowdivision.near network-config mainnet sign-with-keychain send
```

## 2. Deploy with the init call

Signed by `items.meowdivision.near` itself (the key from step 1). `new.json` is
`{ owner_id: meowdivision.near, game_signer_id: items.meowdivision.near, walt_id: walt.meowdivision.near, name: "Meow Division items" }`:
the game account registers items, the contract account is also the game server's signer (through the limited key of
step 4), Walt is his own account. Deploy and init are one transaction: if `new` fails, nothing is deployed.

```powershell
near contract deploy items.meowdivision.near use-file contract\target\near\meow_division_items.wasm with-init-call new file-args contract\mainnet\new.json prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

## 3. Register the items, then the recipes

Both are owner methods: signed as `meowdivision.near`, with exactly 1 yoctoNEAR attached (the contract checks it, so
only a full-access key can call them). `register_tokens.json` holds all 31 tokens (21 materials, 5 trophies, 5 kits:
name, title, picture URL, kind and rarity); `set_recipes.json` holds the 5 recipes. Both fit one call each (the
contract takes up to 50 per call; the generator would split a longer list into `_1`, `_2`, ... files, sent in order).

```powershell
near contract call-function as-transaction items.meowdivision.near register_tokens file-args contract\mainnet\register_tokens.json prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as meowdivision.near network-config mainnet sign-with-keychain send
```

```powershell
near contract call-function as-transaction items.meowdivision.near set_recipes file-args contract\mainnet\set_recipes.json prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as meowdivision.near network-config mainnet sign-with-keychain send
```

Sending either again is safe: it replaces the metadata or the recipes and never touches anyone's items.

## 4. The server's two keys

Two new key pairs, one for the game server and one for Walt, each written to a file in your user folder (outside the
repository). This sends nothing and creates no account: the CLI only writes `<hex>.json` with `public_key`,
`private_key` and a seed phrase of that new key pair. Run each once: the next commands expect one file per folder
(if a folder ends up with two, delete the folder and run its command again).

```powershell
near account create-account fund-later use-auto-generation save-to-folder $HOME\meow-keys\game
```

```powershell
near account create-account fund-later use-auto-generation save-to-folder $HOME\meow-keys\walt
```

Read the two public keys into variables (only public keys are shown):

```powershell
$game = Get-Content (Get-ChildItem $HOME\meow-keys\game\*.json).FullName -Raw | ConvertFrom-Json; $game.public_key
```

```powershell
$walt = Get-Content (Get-ChildItem $HOME\meow-keys\walt\*.json).FullName -Raw | ConvertFrom-Json; $walt.public_key
```

Add them, in the same PowerShell window (the variables live only there). The game key goes on
`items.meowdivision.near`, may call only `game_mint` and `game_burn` on the items contract, and may spend at most
1 NEAR of the contract's balance on gas. Walt's key goes on `walt.meowdivision.near`, may call only `market_give` on
the items contract, at most 0.25 NEAR of gas. A function-call key can never attach a deposit, so neither key can call
`register_tokens`, transfer items or move NEAR.

```powershell
near account add-key items.meowdivision.near grant-function-call-access --allowance '1 NEAR' --contract-account-id items.meowdivision.near --function-names 'game_mint, game_burn' use-manually-provided-public-key $game.public_key network-config mainnet sign-with-keychain send
```

```powershell
near account add-key walt.meowdivision.near grant-function-call-access --allowance '0.25 NEAR' --contract-account-id items.meowdivision.near --function-names 'market_give' use-manually-provided-public-key $walt.public_key network-config mainnet sign-with-keychain send
```

The private keys go only into the server's environment file `/etc/meow-division.env` (root:meow, mode 640, see
`docs/ops.md`), never into the repository, a chat or a log. Copy one to the clipboard without showing it:

```powershell
$game.private_key | Set-Clipboard
```

then on the server (`ssh root@46.224.42.60`, `nano /etc/meow-division.env`) paste it after `NEAR_SIGNER_KEY=`;
then `$walt.private_key | Set-Clipboard` and paste it after `NEAR_WALT_KEY=`. The three lines read:

```
NEAR_SIGNER_ACCOUNT=items.meowdivision.near
NEAR_SIGNER_KEY=
NEAR_WALT_KEY=
```

each key after its `=` with no spaces or quotes (`ed25519:` and about 88 characters). Then clear the clipboard
(`Set-Clipboard -Value ' '`; Windows clipboard history, Win+V, keeps copies if it is on), restart the service if it
is already set up (`systemctl restart meow-division`), and keep or delete `$HOME\meow-keys` as you prefer: a lost key
is replaced by a new pair and the two commands above, then the old one removed (see below).

## 5. Read-only checks

These send nothing and cost nothing.

```powershell
near contract call-function as-read-only items.meowdivision.near mt_metadata_contract json-args '{}' network-config mainnet now
```

Expect `{ "spec": "mt-1.0.0", "name": "Meow Division items" }`.

```powershell
near contract call-function as-read-only items.meowdivision.near config json-args '{}' network-config mainnet now
```

Expect owner `meowdivision.near`, game signer `items.meowdivision.near`, Walt `walt.meowdivision.near`.

```powershell
near contract call-function as-read-only items.meowdivision.near version json-args '{}' network-config mainnet now
```

Expect `"0.1.0"`.

```powershell
near contract call-function as-read-only items.meowdivision.near recipes json-args '{}' network-config mainnet now
```

Expect the 5 recipes of `set_recipes.json`: medkit, grenades, magnet, vest, vaccine.

```powershell
near contract call-function as-read-only items.meowdivision.near mt_tokens json-args '{}' network-config mainnet now
```

Expect 31 tokens, gears first, k_vaccine last.

```powershell
near contract call-function as-read-only items.meowdivision.near mt_metadata_token_all file-args contract\mainnet\token_ids.json network-config mainnet now
```

Expect each item's name, title and `https://game.meowdivision.fun/assets/it_<id>.png`.

```powershell
near contract call-function as-read-only items.meowdivision.near contract_source_metadata json-args '{}' network-config mainnet now
```

Expect the repository link (NEP-330, embedded by cargo-near).

```powershell
near account view-account-summary items.meowdivision.near network-config mainnet now
```

Expect a contract, storage of about 315 kB, a balance near 5.5 NEAR, 1 full-access key and 1 function-call key.

```powershell
near account list-keys items.meowdivision.near network-config mainnet now
```

```powershell
near account list-keys walt.meowdivision.near network-config mainnet now
```

Expect on each: your full-access key from step 1 and one function-call key with the methods and allowance of step 4.

## If something fails

- `the items contract needs a storage top-up`: send it more NEAR and repeat the call that failed.

  ```powershell
  near tokens meowdivision.near send-near items.meowdivision.near '1 NEAR' network-config mainnet sign-with-keychain send
  ```

- `only the game account`: the call was not signed as `meowdivision.near`. `Requires attached deposit of exactly 1
  yoctoNEAR`: the deposit was not `'1 yoctoNEAR'`.
- `a recipe uses an unregistered token`: `register_tokens` has not gone through; send it first.
- A server key leaked or is lost: make and add a new one (step 4), put it into the server's env file, then remove the
  old one, by its public key from `list-keys`:

  ```powershell
  near account delete-keys items.meowdivision.near public-keys ed25519:OLD_PUBLIC_KEY network-config mainnet sign-with-keychain send
  ```

  (`walt.meowdivision.near` for Walt's key.) A key whose allowance is used up stops working the same way: add a new
  one, then delete the old one.

## Later: items or recipes change

After an edit of `live/economy.js` or of the item names in `live/lang_en.js`, run `node gen/chainargs.mjs` (and
`npm test`, which fails while the files are stale), commit the files, then send step 3 again. A recipe removed from
`economy.js` stays on chain until `remove_recipe` is called for it (owner, 1 yoctoNEAR). A redrawn icon needs nothing:
the URL stays the same and no hash of the picture is stored. A new contract version is a separate change: it needs a
`migrate` method and a sandbox test from the old state (`.claude/rules/contract.md`).
