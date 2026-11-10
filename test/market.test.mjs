// The stash and Walt's market as the rules apply them (live/rules.js act 'sell' / 'wbuy', bank's mission items) and
// as the server keeps his shelf (server/walt.mjs): a sale pays what his shelf says and fills it, a buy costs what it
// says and empties it, nothing is sold that the stash doesn't hold or bought that the shelf doesn't hold, a run pays
// the items its hero carried out, a save's stash survives being read back, and the shelf opens with a week of trading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeWalt } from '../server/walt.mjs';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js'),
  R = require('../live/rules.js');

test('a sale pays what the shelf says, unit by unit, and fills it', () => {
  const s = R.defaults(),
    ctx = { stock: { gears: 40 } };
  s.items = { gears: 3 };
  const want = E.buyPrice('gears', 40) + E.buyPrice('gears', 41) + E.buyPrice('gears', 42);
  assert.equal(E.sellTotal('gears', 3, 40), want);
  assert.equal(R.act(s, { k: 'sell', id: 'gears', n: 3 }, ctx), null);
  assert.equal(s.coins, want);
  assert.deepEqual(s.items, {});
  assert.equal(ctx.stock.gears, 43);
});

test('nothing is sold that the stash does not hold, nor what Walt does not trade', () => {
  const s = R.defaults(),
    ctx = { stock: {} };
  s.items = { gears: 1, k_medkit: 2 };
  assert.equal(R.act(s, { k: 'sell', id: 'gears', n: 2 }, ctx), 'not enough');
  assert.equal(R.act(s, { k: 'sell', id: 'k_medkit', n: 1 }, ctx), 'not traded');
  assert.equal(R.act(s, { k: 'sell', id: 'nothing', n: 1 }, ctx), 'not traded');
  assert.equal(R.act(s, { k: 'sell', id: 'gears', n: 0 }, ctx), 'bad amount');
  assert.equal(R.act(s, { k: 'sell', id: 'gears', n: 1.5 }, ctx), 'bad amount');
  // (a count is a number: text or an array that reads as one is refused — '11' would be added up as text further on)
  for (const n of ['1', '011', [1], ' 1', true, 1000, Number.MAX_SAFE_INTEGER + 1, -1, NaN, null])
    assert.equal(R.act(s, { k: 'sell', id: 'gears', n }, ctx), 'bad amount', JSON.stringify(n));
  assert.equal(s.coins, 0);
  assert.deepEqual(s.items, { gears: 1, k_medkit: 2 });
  assert.deepEqual(ctx.stock, {});
});

test('a buy costs what the shelf says, needs the coins and the stock, and empties it', () => {
  const s = R.defaults(),
    ctx = { stock: { chips: 2 } };
  const cost = E.sellPrice('chips', 2) + E.sellPrice('chips', 1);
  assert.equal(E.buyTotal('chips', 2, 2), cost);
  assert.ok(E.sellPrice('chips', 1) > E.sellPrice('chips', 2), 'each one taken costs more');
  s.coins = cost - 1;
  assert.equal(R.act(s, { k: 'wbuy', id: 'chips', n: 2 }, ctx), 'coins');
  s.coins = cost;
  assert.equal(R.act(s, { k: 'wbuy', id: 'chips', n: 3 }, ctx), 'out of stock');
  assert.equal(R.act(s, { k: 'wbuy', id: 'chips', n: 2 }, ctx), null);
  assert.equal(s.coins, 0);
  assert.deepEqual(s.items, { chips: 2 });
  assert.deepEqual(ctx.stock, {});
  assert.equal(R.act(s, { k: 'wbuy', id: 'chips', n: 1 }, {}), 'out of stock', 'no shelf: nothing to buy');
});

test('Walt sells for more than he pays at the same shelf', () => {
  for (const it of E.ITEMS.filter((i) => E.tradable(i.id)))
    for (const stock of [1, it.norm, it.norm * 3]) assert.ok(E.sellPrice(it.id, stock) > E.buyPrice(it.id, stock));
});

test("mission 1's cleaver comes home only as the hero carried it out", () => {
  const s = R.defaults(),
    win = {
      win: true,
      mission: 'office',
      kills: 10,
      t: 300,
      lvl: 5,
      coins: 20,
      gun: 'pistol',
      bag: [['t_butcher', 1]],
    };
  const g1 = R.bank(s, win);
  assert.deepEqual(g1.items, [['t_butcher', 1]]);
  assert.equal(s.items.t_butcher, 1);
  assert.ok(g1.mission, 'the first win pays the mission: coins and XP');
  const g2 = R.bank(s, { ...win, bag: [] });
  assert.deepEqual(g2.items, [], 'nothing carried out: no items');
  assert.equal(s.items.t_butcher, 1);
  const g3 = R.bank(s, { ...win, bag: [['nothing', 3], ['gears', -2], 'x', ['tape', 1.5]] });
  assert.deepEqual(g3.items, [['tape', 1]], 'only known items, whole counts');
  // and it sells to an empty shelf for the workbench's first level
  const ctx = { stock: {} };
  assert.equal(R.act(s, { k: 'sell', id: 't_butcher', n: 1 }, ctx), null);
  assert.ok(s.coins >= E.building('workbench').levels[0].coins);
});

test("a save's stash is read back: known items, whole positive counts only", () => {
  const d = R.clean({ items: { gears: 3, t_butcher: 1, nothing: 5, tape: -2, fuel: 2.7, cans: '4' } });
  assert.deepEqual(d.items, { gears: 3, t_butcher: 1, fuel: 2, cans: 4 });
  assert.deepEqual(R.clean({}).items, {}, 'a save from before the stash');
});

test("the server's shelf opens with a week of trading and takes trades", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walt-'));
  try {
    const W = makeWalt(dir, E),
      v = W.view();
    assert.ok(Object.keys(v.stock).length > 3, 'something on the shelf from the first day');
    for (const [id, n] of Object.entries(v.stock)) {
      assert.ok(E.tradable(id), id);
      assert.ok(Number.isInteger(n) && n > 0, id);
    }
    const s = R.defaults(),
      ctx = W.ctx(),
      before = ctx.stock.gears || 0;
    s.items = { gears: 2 };
    assert.equal(R.act(s, { k: 'sell', id: 'gears', n: 2 }, ctx), null);
    W.traded({ k: 'sell', id: 'gears', n: 2 });
    assert.equal(W.view().stock.gears, before + 2, 'the sale is on the shelf for everyone');
    assert.equal(W.view().recent.gears, 2);
    W.traded({ k: 'sell', id: 'gears', n: '11' }); // (never let through by the rules; counted as nothing here either)
    assert.equal(W.view().recent.gears, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a new wallet account takes the guest's first steps along, a first session's worth at most", () => {
  const acc = R.defaults(),
    guest = R.defaults();
  guest.camp = ['office', 'lab']; // (lab without suburb: out of order, not taken)
  guest.items = { t_butcher: 3, gpu: 9, t_shroom: 1 };
  guest.coins = 999999;
  guest.rxp = 999999;
  guest.owned = { pistol: true, shotgun: true };
  guest.nick = 'Tester';
  R.adopt(acc, guest);
  assert.deepEqual(acc.camp, ['office']);
  assert.deepEqual(acc.items, { t_butcher: 1 }, "only mission 1's reward, once");
  assert.equal(acc.coins, R.ADOPT.coins);
  assert.equal(acc.rxp, R.ADOPT.rxp);
  assert.deepEqual(acc.owned, { pistol: true }, 'guns start afresh');
  assert.equal(acc.nick, 'Tester');
  // a modest guest comes along whole
  const a2 = R.defaults(),
    g2 = R.defaults();
  g2.camp = ['office'];
  g2.coins = 270;
  g2.rxp = 420;
  R.adopt(a2, g2);
  assert.equal(a2.coins, 270);
  assert.equal(a2.rxp, 420);
  assert.deepEqual(a2.items, {}, 'the cleaver already sold');
});
