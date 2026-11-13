// test/board.test.mjs — the final bosses an account killed (stats.fin, 2026-11-13: the players' ranking places by them) and its
// record, the fastest of them alone: counted when a raid is paid (rules.js bank), made up for a save from before the count
// (clean), taken along from a guest's proven runs (adopt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RULES = require('../live/rules.js');

const run = (o) => ({ t: 600, kills: 400, bk: 3, win: true, lvl: 15, coins: 40, gun: 'pistol', ...o });

test('a raid won on the suburb or the lab counts a final boss; the office, a loss and the record alone as said', () => {
  const s = RULES.defaults();
  assert.equal(s.stats.fin, 0);
  RULES.bank(s, run({ mission: 'office', t: 200 }));
  assert.deepEqual(
    [s.stats.wins, s.stats.fin, s.stats.fast],
    [1, 0, 0],
    'the office ends on the Butcher: no final boss',
  );
  RULES.bank(s, run({ mission: 'suburb', map: 'suburb', t: 640 }));
  assert.deepEqual([s.stats.fin, s.stats.fast], [1, 640], "mission 2's Mushroom Monster: a final boss, and the record");
  RULES.bank(s, run({ map: 'lab', t: 500, coop: 1 }));
  assert.deepEqual([s.stats.fin, s.stats.fast], [2, 640], 'together: counted, but no record');
  RULES.bank(s, run({ map: 'suburb', win: false, t: 300 }));
  assert.deepEqual([s.stats.runs, s.stats.fin, s.stats.fast], [4, 2, 640], 'a loss: neither');
  RULES.bank(s, run({ map: 'lab', t: 590 }));
  RULES.bank(s, run({ map: 'suburb', t: 700 }));
  assert.deepEqual([s.stats.fin, s.stats.fast], [4, 590], 'only a faster one lowers the record');
  assert.equal(RULES.clean(JSON.parse(JSON.stringify(s))).stats.fin, 4, 'kept as it is');
});

test("a save from before the count: its wins but the office's, never more than its wins", () => {
  const old = (stats, camp) => RULES.clean({ stats, camp }).stats.fin;
  assert.equal(old({ runs: 9, wins: 4 }, ['office', 'suburb']), 3);
  assert.equal(old({ runs: 9, wins: 4 }, []), 4, 'the office never won here (a guest who brought it along)');
  assert.equal(old({ runs: 2, wins: 0 }, ['office']), 0);
  assert.equal(old({ runs: 9, wins: 2, fin: 7 }, []), 2, 'a count over its wins: cut to them');
});

test("a guest's proven final bosses and record come along with its first sign-in", () => {
  const proof = RULES.defaults();
  RULES.bank(proof, run({ mission: 'office', t: 200 }));
  RULES.bank(proof, run({ mission: 'suburb', map: 'suburb', t: 650 }));
  const guest = JSON.parse(JSON.stringify(proof)),
    a = RULES.adopt(RULES.defaults(), proof, guest, Date.now());
  assert.deepEqual([a.stats.runs, a.stats.wins, a.stats.fin, a.stats.fast], [2, 2, 1, 650]);
});
