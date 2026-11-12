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

test('a shelf file from before the decay carry opens and carries from then on', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walt-'));
  try {
    const day = Math.floor(Date.now() / 864e5);
    fs.writeFileSync(path.join(dir, 'walt.json'), JSON.stringify({ day: day - 2, stock: { cans: 10 }, recent: {} }));
    const v = makeWalt(dir, E).view();
    assert.equal(v.day, day);
    for (const n of Object.values(v.stock)) assert.ok(Number.isInteger(n) && n > 0);
    let kept = null; // (written a moment later, to a temp file renamed over it: read until the new one is there)
    for (let i = 0; i < 200 && !(kept && kept.day === day); i++) {
      await new Promise((r) => setTimeout(r, 25));
      try {
        kept = JSON.parse(fs.readFileSync(path.join(dir, 'walt.json'), 'utf8'));
      } catch {
        kept = null; // (caught mid-rename)
      }
    }
    assert.equal(kept.day, day);
    assert.ok(kept.rest && typeof kept.rest === 'object', 'the carry is kept with the shelf');
    for (const [id, c] of Object.entries(kept.rest))
      assert.ok(E.tradable(id) && Number.isInteger(c) && c > 0 && c < 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a new wallet account takes along what the device's runs proved, no more than the page still has", () => {
  // the device's record on the server: mission 1 won, the cleaver carried out, what its runs paid
  const proof = { ...R.defaults(), camp: ['office'], items: { t_butcher: 1 }, coins: 170, rxp: 400 };
  // a page that claims far more (typed in): only what the record proves comes along
  const acc = R.defaults(),
    guest = R.defaults();
  guest.camp = ['office', 'suburb', 'lab'];
  guest.items = { t_butcher: 3, gpu: 9, t_shroom: 1 };
  guest.coins = 999999;
  guest.rxp = 999999;
  guest.owned = { pistol: true, shotgun: true };
  guest.nick = 'Tester';
  R.adopt(acc, proof, guest);
  assert.deepEqual(acc.camp, ['office']);
  assert.deepEqual(acc.items, { t_butcher: 1 }, 'the cleaver the run carried out, once');
  assert.equal(acc.coins, 170);
  assert.equal(acc.rxp, 400);
  assert.deepEqual(acc.owned, { pistol: true }, 'guns start afresh');
  assert.equal(acc.nick, 'Tester');
  // the cleaver sold to Walt on the page: its price may be among the coins (at most what Walt pays for one)
  const a2 = R.defaults(),
    g2 = { ...R.defaults(), camp: ['office'], coins: 170 + E.buyPrice('t_butcher', 0) + 500, rxp: 420 };
  R.adopt(a2, proof, g2);
  assert.equal(a2.coins, 170 + E.buyPrice('t_butcher', 0));
  assert.deepEqual(a2.items, {}, 'the cleaver already sold');
  // coins spent on the page: fewer come along; the cap holds whatever the record says
  const a3 = R.defaults();
  R.adopt(a3, proof, { ...g2, coins: 50, items: { t_butcher: 1 } });
  assert.equal(a3.coins, 50);
  const a4 = R.defaults();
  R.adopt(a4, { ...proof, coins: 1e6, rxp: 1e6 }, { ...guest, rxp: 1e6 });
  assert.equal(a4.coins, R.ADOPT.coins);
  assert.equal(a4.rxp, R.ADOPT.rxp);
  // no record (or one another account took): the face alone
  const a5 = R.defaults();
  R.adopt(a5, null, guest);
  assert.deepEqual([a5.camp, a5.items, a5.coins, a5.rxp, a5.nick], [[], {}, 0, 0, 'Tester']);
});

test("a new wallet account takes along what the page bought, bought again on what the device's runs earned", () => {
  // (the human's, 2026-11-12: upgrades made before the wallet, gone with the coins paid for them, once it was connected)
  const now = Date.now(),
    t = now - 60000,
    proof = { ...R.defaults(), camp: ['office'], coins: 20000, rxp: 50000, mast: { shotgun: 5000 } },
    guest = {
      ...R.defaults(),
      camp: ['office'],
      coins: 300,
      rxp: 50000,
      mast: { shotgun: 5000 },
      owned: { pistol: true, shotgun: true },
      selected: 'shotgun',
      wup: { shotgun: { dmg: 1, rate: 0, mag: 0 } },
      meta: { hp: 1 },
      base: {
        lv: { generator: 1, workbench: 1, medbay: 1 },
        bt: { generator: t, workbench: t, medbay: t },
        clr: { alcove: t, meeting: t },
        gift: [],
      },
    };
  const acc = R.adopt(R.defaults(), proof, guest, now);
  assert.equal(acc.owned.shotgun, true);
  assert.equal(acc.selected, 'shotgun');
  assert.equal(acc.wup.shotgun.dmg, 1);
  assert.equal(acc.meta.hp, 1);
  assert.deepEqual(
    ['generator', 'workbench', 'medbay'].map((id) => R.blv(acc, id, now)),
    [1, 1, 1],
  );
  assert.ok(R.cleared(acc, 'meeting', now));
  assert.equal(acc.coins, 300, "the page's coins left: under what the runs earned less what was bought");
  // too little earned: nothing it can't pay for comes along, and the coins are no more than the runs earned
  const poor = R.adopt(R.defaults(), { ...proof, coins: 50 }, guest, now);
  assert.deepEqual(poor.owned, { pistol: true });
  assert.ok(poor.coins <= 50);
  // a page typing in a gun far above its rank: refused as a purchase would be
  const low = { ...R.defaults(), rxp: 10, coins: 1e6 },
    lowBuys = R.act(low, { k: 'buy', id: 'shotgun' }, { now }) === null,
    high = R.adopt(R.defaults(), { ...proof, rxp: 10 }, { ...guest, rxp: 10 }, now);
  assert.equal(!!high.owned.shotgun, lowBuys);
  // an account made before the purchases came along: signing in again from that page adds them, once; its coins kept
  const old = R.defaults();
  old.camp = ['office'];
  old.coins = 300;
  assert.equal(R.topUp(old, proof, guest, now), true);
  assert.equal(old.owned.shotgun, true);
  assert.equal(old.wup.shotgun.dmg, 1);
  assert.equal(R.blv(old, 'medbay', now), 1);
  assert.equal(old.coins, 300);
  assert.equal(R.topUp(old, proof, guest, now), false, 'nothing more the second time');
});

test('a trophy sold is kept as held, so what it unlocks stays open', () => {
  const s = R.defaults(),
    ctx = { stock: {} };
  s.items = { t_shroom: 1, gears: 2 };
  assert.equal(R.act(s, { k: 'sell', id: 't_shroom', n: 1 }, ctx), null);
  assert.equal(R.act(s, { k: 'sell', id: 'gears', n: 1 }, ctx), null);
  assert.deepEqual(s.held, ['t_shroom']);
  assert.deepEqual(R.clean(JSON.parse(JSON.stringify(s))).held, ['t_shroom']);
  assert.deepEqual(R.clean({ held: ['gears', 'nothing', 't_shroom', 't_shroom'] }).held, ['t_shroom']);
});
