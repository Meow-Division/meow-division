// test/daily.test.mjs — the day's tasks (the human's, 2026-11-12; live/rules.js daily, economy.js DAILY_WALT, DAILY_NOVA):
// Walt's, the same for every player on a UTC day, is a sale of its items to him at DAILY_WALT_K times what the sale pays,
// once a day, never worth buying from him to bring back; Nova's, a raid won on the suburb's map and one on the lab's, each
// once a day, pay their coins and XP on the run's results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  R = require('../live/rules.js'),
  E = require('../live/economy.js');

const DAY = 864e5,
  T0 = 20000 * DAY + 3600e3; // (a clock's ms: 1 a.m. on day 20000)

test("Walt's task: one a day for everyone, not the same two days running, each one an item he trades", () => {
  const d = R.day(T0);
  assert.equal(d, 20000);
  assert.equal(R.day(T0 + DAY - 3600e3 - 1), d, 'until midnight UTC');
  assert.equal(R.day(T0 + DAY), d + 1);
  for (let i = 0; i < 60; i++) {
    const t = R.waltDaily(d + i);
    assert.deepEqual(t, R.waltDaily(d + i), 'the same for every player');
    assert.notDeepEqual(t, R.waltDaily(d + i - 1), `day ${d + i}: not yesterday's`);
  }
  for (const [id, n] of E.DAILY_WALT) {
    assert.ok(E.item(id) && E.tradable(id), id);
    assert.ok(Number.isInteger(n) && n > 0, id);
  }
  assert.ok(E.DAILY_WALT_K > 1, 'more than a sale');
});

test("Walt's task: handed in once a day, as a sale to his shelf at its premium", () => {
  const [id, n] = R.waltDaily(R.day(T0));
  const s = R.clean({ camp: ['office'], coins: 0, items: { [id]: n - 1 } });
  const ctx = { stock: { [id]: 5 }, now: T0 };
  assert.equal(R.act(s, { k: 'daily' }, ctx), 'items', 'one short');
  assert.equal(s.coins, 0);
  s.items[id] = n + 2;
  const sale = E.sellTotal(id, n, 5),
    pay = R.waltPay([id, n], ctx.stock);
  assert.equal(pay, Math.min(Math.ceil(E.DAILY_WALT_K * sale), E.buyTotal(id, n, 5 + n) - 1));
  assert.ok(pay > sale);
  assert.equal(R.act(s, { k: 'daily' }, ctx), null);
  assert.equal(s.coins, pay, 'his price for the task');
  assert.equal(s.items[id], 2, 'n of them gone');
  assert.equal(ctx.stock[id], 5 + n, 'onto his shelf, as a sale');
  assert.equal(R.act(s, { k: 'daily' }, { ...ctx, now: T0 + 1000 }), 'done', 'once a day');
  assert.equal(R.clean(s).daily.walt, true, 'kept in the save');
  // the next day: its own task, to do again
  const next = R.waltDaily(R.day(T0 + DAY));
  s.items[next[0]] = next[1];
  assert.equal(R.act(s, { k: 'daily' }, { stock: {}, now: T0 + DAY }), null, 'a new day');
  // bought from him and brought back never earns
  for (const [it, k] of E.DAILY_WALT)
    for (const st of [0, 5, 20, 80]) {
      const buy = E.buyTotal(it, k, st + k),
        back = R.waltPay([it, k], { [it]: st });
      assert.ok(back < buy, `${it} ×${k} at ${st}: ${back} for what costs ${buy}`);
    }
});

test("Nova's tasks: a raid won on the suburb's map and one on the lab's, once a day each", () => {
  const s = R.clean({ camp: ['office', 'suburb'], coins: 0 });
  const run = (seed, win) => {
    const S = {
      over: { win, t: 600, kills: 10, lvl: 5, coins: 0 },
      p: { main: { id: 'pistol' }, bag: [], safe: [] },
      seed,
      bk: 4,
    };
    return R.outcome(S);
  };
  assert.equal(SIM.mapOf(3), 'city');
  assert.equal(run(3, true).map, 'suburb');
  assert.equal(run(100, true).map, 'lab');
  const lost = R.bank(s, run(3, false), T0);
  assert.equal(lost.daily, null, 'a raid lost: not done');
  const c0 = s.coins;
  const g = R.bank(s, run(3, true), T0);
  assert.deepEqual(g.daily, { id: 'suburb', ...E.DAILY_NOVA.suburb });
  assert.equal(g.parts.daily, E.DAILY_NOVA.suburb.xp, 'its XP on the results');
  assert.equal(s.coins - c0, g.coins, 'its coins with the run');
  assert.ok(g.coins >= E.DAILY_NOVA.suburb.coins + R.WIN_BONUS);
  assert.equal(R.bank(s, run(3, true), T0 + 5000).daily, null, 'once a day');
  assert.equal(R.bank(s, run(100, true), T0 + 6000).daily.id, 'lab', 'the lab: its own');
  assert.equal(R.bank(s, run(3, true), T0 + DAY).daily.id, 'suburb', 'the next day: again');
  const c = R.clean(s).daily;
  assert.deepEqual(c, { d: R.day(T0 + DAY), walt: false, suburb: true, lab: false });
  // a map the campaign hasn't opened yet: no task there to finish (REV 45 — the lab won together before mission 2)
  const n = R.clean({ camp: ['office'], coins: 0 });
  assert.equal(R.bank(n, run(100, true), T0).daily, null, 'the lab before mission 2: nothing');
  assert.equal(R.clean(n).daily.lab, false, 'and her lab task still to come');
  assert.equal(R.bank(n, run(3, true), T0).daily.id, 'suburb', 'the suburbs: open after mission 1');
  const z = R.clean({ camp: [], coins: 0 });
  assert.equal(R.bank(z, run(3, true), T0).daily, null, 'nothing before mission 1');
});
