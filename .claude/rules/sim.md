---
paths:
  - "live/sim.js"
  - "live/data.js"
  - "live/rules.js"
  - "live/replay.js"
  - "live/economy.js"
  - "live/map.js"
  - "live/map_lab.js"
  - "live/map_*.js"
---
# Rules files: the server replays every run with these exact files

- Client and server must compute identical state from the same inputs. Forbidden here: `Math.random`, `Date.now`, `performance.now`, `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/hypot/cbrt`, `.sort()`, `Map`, `Set`, `for…in`, iteration over object keys, reading anything from `window`, `document`, `navigator` or the page's `S.me`. `gen/detcheck.cjs` makes the Math functions throw; run it.
- Allowed math: `floor min max abs round sqrt ceil imul PI` and the ports `dsin dcos datan datan2 dexp dhypot pow8`.
- Randomness only via `rnd(S)` on `S.rs`. Level layout via `mulberry(seed)` and `hash01(gx, gy, k)`.
- Inputs arrive quantised (`REPLAY.quant`); the sim reads only fields the log carries (see the flag table at the top of `replay.js`). A new input field needs a new replay flag, encoding in `pack`/`in`, and a REV bump.
- New run-state fields: deterministic, JSON-plain, no −0 surprises (`+ 0`), considered for `REPLAY.hash` and for `SIM.migrate` (saves in sessionStorage).
- Module-level caches only when keyed by state (`nav` by `S.navAt`, `levels` by seed). Scratch buffers may live at module level if every read is preceded by a write in the same step.
- Render code (`scene.js`, `hero3d.js`, `index.html`) never adds fields to sim objects; render-only data goes into `WeakMap`s. Interpolation (`ipApply`/`ipBack`) temporarily mutates `x/y/t`: nothing reads state between them.
- Co-op: `S.ps` holds the heroes; `S.p` is set per phase; the sim never reads `S.me`; `step(S, [inpA, inpB])`, `null` input means that player left.

## When a change alters how a run plays

1. Raise `SIM.REV` in `live/sim.js` (also for a fix of a fix; REV 13→14 was that lesson).
2. `node gen/detcheck.cjs 120`, `node gen/unitcheck.mjs`, `node live/tune.cjs`, `node server/test.mjs`.
3. If `gen/unitcheck.mjs` asserts a tuned number you changed (medkit, saw damage), update the assertion with the change.
4. Commit subject ends with `(SIM.REV N)`. Deploy `live/` rules files and `server/` together; the server copies them into `DATA/sims/<REV>` at start.
5. Balance claims come from `gen/balance.cjs` bots or the `?lab` page, not from feeling.

## Economy (`live/economy.js`)

- Single source of every item, loot table, recipe, building level and Walt's pricing. Client, server and the fast-forward simulation import this one file.
- Prices: `buy = round(base × 2 × norm / (norm + stock))`, `sell = round(buy × 1.4)`, stock decays 5% per day. Walt only sells what he has. Every number has a one-line comment saying what it does to the player.
- Token ids are strings fixed forever (docs/design.md table). Renaming an item is a language-pack change, never an id change.
- `ECONOMY.explain(itemId, state)` returns the plain-text reasoning shown in Walt's tooltip; NEAR AI may rephrase it, never replace the numbers.
