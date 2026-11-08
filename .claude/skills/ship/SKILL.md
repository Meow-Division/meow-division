---
name: ship
description: Deploy the current working tree to https://game.meowdivision.fun. Use after a change is finished and locally checked; the human expects finished work live without being asked.
---
Steps (details in docs/ops.md):

1. Confirm the tree is what you mean to ship: `git status` shows only intended changes; `npm test` green. If a rules file changed: `node gen/detcheck.cjs 120`, `node gen/unitcheck.mjs`, `node live/tune.cjs`, `node server/test.mjs`, and `SIM.REV` was raised with a `(SIM.REV N)` commit.
2. If the human is mid-way on a map or hero in the editors, do not ship their local `map*.js` / `hero.js`: take prod's copies into `dist` and skip them in the server `live/` copy.
3. `npm run build` → `dist/game`. Fail loudly if the build is stale or the folder is locked (a local http server on `dist/game` locks it on Windows).
4. `bash scripts/deploy.sh` (tar + ssh to `root@46.224.42.60`, key `~/.ssh/parix_codex`): new `/srv/meow/game-<stamp>`, `live/` rules and `server/*.mjs` copied, symlink swapped, `meow-division` restarted.
5. Verify: `curl -s https://game.meowdivision.fun/api/health` is `{ ok: true, ... }` with the expected `rev`; the index carries the new `__BUILD__`; a guest run starts in a browser check. On the first deploy after a server change, read `journalctl -u meow-division --since -10m`.
6. Tell the human in one line what is live and the stamp. If anything failed, say exactly what, and roll back by pointing `/srv/meow/site` at the previous folder.

Never delete old `game-*` folders without the human; never touch `/srv/bald`.
