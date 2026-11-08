# Code style

The game started as a one-person prototype with long, dense lines and three module styles. This repository keeps what worked (zero dependencies, plain JavaScript, deterministic data) and fixes what did not. Old files are brought to this style when touched; new files follow it from the first line.

## Modules

Browser rules file shared with the server (`live/sim.js`, `data.js`, `rules.js`, `replay.js`, `economy.js`, `map*.js`):

```js
// live/economy.js — every number of the item economy: loot tables, Walt's pricing, recipes, buildings.
(function (root) {
  const D = root.DATA || require('./data.js');

  const ITEMS = { gears: { rarity: 1, base: 12 }, tape: { rarity: 1, base: 10 } };

  function buyPrice(base, stock, norm) { return Math.round(base * 2 * norm / (norm + stock)); }

  root.ECONOMY = { ITEMS, buyPrice };
  if (typeof module !== 'undefined') module.exports = root.ECONOMY;
})(typeof window !== 'undefined' ? window : globalThis);
```

Browser-only module (`live/ui.js`, `wallet.js`, `scene.js`, …):

```js
// live/hub.js — the base between runs: Copper walks, talks to Nova and Walt, opens buildings.
(function () {
  const H = (window.HUB = {});
  const D = DATA, E = ECONOMY;

  H.open = function open(save) { /* … */ };
})();
```

Node (`server/`, `gen/*.mjs`, `scripts/`, `test/`): ESM, `import … from 'node:fs'`, top-level await allowed, no npm runtime dependencies. Shared rules files are loaded with `createRequire`.

Rust (`contract/`): `cargo fmt` defaults, `clippy` clean, `overflow-checks = true`.

## Formatting

- 2 spaces, LF, UTF-8, final newline, no trailing whitespace (`.editorconfig`, `.gitattributes`).
- Semicolons. Single quotes in JS; double quotes only inside HTML attributes and JSON.
- One statement per line. Lines under 120 characters. A long expression is split at operators, not squeezed.
- `const` by default, `let` when reassigned, never `var`.
- Arrow functions for one-liners and callbacks; `function` declarations for anything named that does work.
- Early returns over nested ifs. No clever one-line `if (a) x; else y;` chains.
- Blank line between logical blocks; no blank line at the start of a block.

## Comments

- First line of every file: `// <path> — <what it is and why it exists>`.
- Comments say why, or state an invariant the code cannot express ("the field's schedule is state, see updateFlow"). They do not repeat the code.
- English only. No commented-out code. No TODO/FIXME: unfinished work is listed in the plan.
- A tuning number carries the revision it changed in: `hp: 8820, // REV 9`.

## Naming

| Thing | Style | Examples |
| --- | --- | --- |
| Files | lowercase, words run together or `_` for variants | `economy.js`, `lang_en.js`, `map_lab.js`, `replay-worker.mjs` (kebab only in server/) |
| Module globals | UPPERCASE | `SIM`, `ECONOMY`, `HUB`, `WALLET` |
| Functions, variables | camelCase | `buyPrice`, `openLevelUp`, `walletOffer` |
| Constants | UPPER_SNAKE | `MAX_BODY`, `EVAC_FROM`, `BAG_SLOTS` |
| Data and token ids | lower_snake, ASCII | `gears`, `t_butcher`, `k_medkit`, `s_desert` |
| Sim state fields | short, documented once at `create()` | `S.en`, `S.rs`, `p.bag` |
| i18n keys | `section.camelCase` | `hub.buildNeeds`, `walt.sellFor`, `voice.nova.3` |
| CSS classes | short lowercase, modifiers as extra classes | `.panel`, `.btn.orange`, `.slot.sel` |
| DOM ids | short lowercase | `#hub`, `#walt`, `#bag` |
| Behaviour hooks | `data-*` | `data-build="workbench"` |
| localStorage / sessionStorage | `md.<name>` | `md.save`, `md.wallet`, `md.guest` |
| Env vars | UPPER_SNAKE, all in `.env.example` | `NEAR_SIGNER_KEY` |
| Wire and action objects | `{ k: 'kind', … }` | `{ k: 'sell', id: 'gears', n: 3 }` |
| Error strings | short lowercase English | `'stale'`, `'bad log'`, `'not enough coins'` |
| Commits | imperative, under 72 chars, `(SIM.REV N)` when rules change | `Add Walt's market screen`, `Evac from 4:00 (SIM.REV 24)` |

## Data

- All tuning numbers in `live/data.js` (combat) and `live/economy.js` (economy). Code reads them; it never hard-codes a price, a drop chance or a slot count.
- Words live in the language packs; `data.js` and `economy.js` hold ids only. `I18N.apply(DATA)` fills names.
- Generated files are regenerated, never hand-edited: `map.js`/`map_lab.js` (editor), `assets.js` (art pipelines), `rigs.js`, `hero.js` (hero editor).
- State is plain JSON. Any new field on the run state must be deterministic and must be considered for `REPLAY.hash`.

## Errors and logging

- Server: `send(res, code, { error: 'message' })`; thrown errors with `.code` map to that status; everything else is 500 and logged with context. Never an empty `catch`.
- Client: a failed request shows a translated line and keeps the game playable. Chain failures queue the action and show "will arrive".
- Logs are `console.log/warn/error` with a tag first: `console.warn('mint', runId, e.message)`. No secrets, no tokens, no full account saves in logs.

## Tests

- `test/*.test.mjs` with `node:test` and `node:assert/strict`. One file per module. Names say the behaviour: `test('a stranger cannot call game_mint', …)`.
- Checks in `gen/` print `ok`/`fails` and exit 1 on failure; they are run by name, not imported (`gen/balance.cjs` starts a whole lab on import).
- Determinism is a test, not a hope: `gen/detcheck.cjs` after every rules change; a new Math function in a rules file is a bug.
- Contract: integration tests on near-sandbox cover every method's happy path and its main refusal.

## HTML and CSS

- Screens are built as template literals in `ui.js`-style modules and shown through `show(html, 'cls')`; outside text goes through `esc()`.
- The chamfered UI kit (`.panel`, `.btn`, custom properties `--c --ed --fill --rim`) is the one visual language. New screens reuse it; no second kit, no inline styles.
- Layout must work at phone width, inside the Telegram frame (safe-area variables `--sl --st --sr --sb`) and at 2.4:1. Container units (`cqh`, `cqw`) for the lobby plates.

## Things not to copy from the prototype

Lines of 400+ characters; four `.tmp.json` state dumps in `live/`; duplicated `.panel`/`.btn` definitions; Russian strings in editor tools; three storage-key prefixes; `index.html` holding the whole game shell inline (new shell code goes into `live/game.js`); data folders inside the worktree.
