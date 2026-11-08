---
name: sim-change
description: Checklist for any change to how a run plays (live/sim.js, data.js, rules.js, replay.js, economy.js, map files). Use before committing such a change.
---
1. Determinism: no new `Math.*` beyond the allowed list, no `Date`, no randomness outside `rnd(S)`, no object-key iteration, no state read from the page. New state fields are JSON-plain and considered for `REPLAY.hash` and `SIM.migrate`.
2. New input or replay field: new flag in `replay.js`, encoded in `pack`/`in`/`quant`, read nowhere else.
3. Raise `SIM.REV` in `live/sim.js`. A fix of a fix is a new REV too.
4. Run: `node gen/detcheck.cjs 120`, `node gen/unitcheck.mjs` (update its asserted numbers if you tuned them), `node live/tune.cjs`, `node server/test.mjs`, `npm test`.
5. Balance claim? Measure with `node gen/balance.cjs` or `?lab`, write the number in the commit body. Bot numbers are relative only.
6. Language packs: new cards, items or hints get keys in all four packs; `node gen/langcheck.mjs`.
7. Commit: subject ends with `(SIM.REV N)`; body says what changed for the player and why.
8. Ship `live/` rules files and `server/` together (`/ship`); the server copies the rules into `data/sims/<REV>` at start.
