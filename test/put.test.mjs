// test/put.test.mjs — parts handed in ahead (rules.js put, save.put): a building's level or an upgrade that takes
// several items no longer needs them all in the stash at once. An item the stash has goes in (as many as there are, no
// more than it still takes), the purchase then takes only the rest and drops the record; a stored save's record is
// read back against what the purchase costs now (clean); a guest's record comes along into its wallet's account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../live/rules.js'),
  E = require('../live/economy.js'),
  D = require('../live/data.js');

const T0 = 1.8e12; // (a clock's ms)
const GEN = { k: 'build', id: 'generator' },
  MAG = { k: 'up', id: 'pistol', s: 'mag' },
  HP = { k: 'meta', s: 'hp' };
// the generator at level 1, its level 2 next: fuel 6, battery 2, chips 1 and coins
const base = (items = {}, coins = 5000) => {
  const s = R.clean({ camp: ['office'], coins, items });
  s.base.lv = { generator: 1, workbench: 1, medbay: 1 };
  return s;
};
const put = (s, a, id) => R.act(s, { k: 'put', a, id }, { now: T0 });

test('the cost this test is written for', () => {
  const L = E.building('generator').levels[1];
  assert.deepEqual(L.items, [
    ['fuel', 6],
    ['battery', 2],
    ['chips', 1],
  ]);
  assert.deepEqual(E.UPGRADES.meta.hp[2], [
    ['bandages', 3],
    ['cans', 2],
  ]);
  assert.deepEqual(E.UPGRADES.weapon.mag[1], [['tape', 1]]);
});

test('one battery of two goes in: 1/2, one more to bring; the build waits for the rest', () => {
  const s = base({ battery: 1, fuel: 6, chips: 1 });
  assert.deepEqual(R.putPlan(s, { k: 'put', a: GEN, id: 'battery' }), { key: 'build:generator', id: 'battery', n: 1 });
  assert.equal(put(s, GEN, 'battery'), null);
  assert.deepEqual(s.put, { 'build:generator': { battery: 1 } });
  assert.deepEqual(s.items, { fuel: 6, chips: 1 }, 'out of the stash');
  assert.deepEqual(R.putOf(s, GEN), { battery: 1 });
  assert.deepEqual(R.left(s, GEN), [
    ['fuel', 6],
    ['battery', 1],
    ['chips', 1],
  ]);
  assert.deepEqual(R.costItems(s, GEN).length, 3, 'the whole cost is still what the window shows');
  assert.equal(R.act(s, GEN, { now: T0 }), 'items', 'a battery short');
  assert.equal(s.coins, 5000);
  assert.deepEqual(s.put, { 'build:generator': { battery: 1 } }, 'refused: what is in stays in');
  s.items.battery = 1;
  assert.equal(R.act(s, GEN, { now: T0 }), null, 'the second one in the stash: built');
  assert.deepEqual(s.put, {}, 'the record is gone with the purchase');
  assert.deepEqual(s.items, {});
  assert.equal(s.base.lv.generator, 2);
  assert.equal(s.coins, 5000 - E.building('generator').levels[1].coins);
});

test('every cell full: the build goes with an empty stash', () => {
  const s = base({ battery: 2, fuel: 6, chips: 1, scrap: 4 });
  for (const id of ['fuel', 'battery', 'chips']) assert.equal(put(s, GEN, id), null);
  assert.deepEqual(s.items, { scrap: 4 }, 'only what the level takes went in');
  assert.deepEqual(s.put['build:generator'], { fuel: 6, battery: 2, chips: 1 });
  assert.deepEqual(R.left(s, GEN), []);
  assert.equal(R.act(s, GEN, { now: T0 }), null);
  assert.deepEqual([s.put, s.items, s.base.lv.generator], [{}, { scrap: 4 }, 2]);
});

test('more in the stash than it takes: only what is still needed goes in; a full cell takes no more', () => {
  const s = base({ battery: 7 });
  assert.equal(put(s, GEN, 'battery'), null);
  assert.deepEqual([s.put['build:generator'].battery, s.items.battery], [2, 5]);
  assert.equal(put(s, GEN, 'battery'), 'full');
  assert.deepEqual([s.put['build:generator'].battery, s.items.battery], [2, 5]);
  const t = base({ fuel: 2 });
  assert.equal(put(t, GEN, 'fuel'), null);
  t.items.fuel = 9;
  assert.equal(put(t, GEN, 'fuel'), null, 'in two goes');
  assert.deepEqual([t.put['build:generator'].fuel, t.items.fuel], [6, 5]);
});

test('nothing to put in, an item it does not take, a purchase that is none: refused, the save as it was', () => {
  const s = base({ scrap: 3 }),
    was = JSON.stringify(s);
  assert.equal(put(s, GEN, 'battery'), 'items');
  assert.equal(put(s, GEN, 'scrap'), 'not needed');
  assert.equal(put(s, { k: 'build', id: 'nonsense' }, 'scrap'), 'unknown');
  assert.equal(put(s, { k: 'sell', id: 'scrap' }, 'scrap'), 'unknown');
  assert.equal(put(s, { k: 'up', id: 'pistol', s: 'toString' }, 'scrap'), 'unknown');
  assert.equal(put(s, { k: 'meta', s: 'constructor' }, 'scrap'), 'unknown');
  assert.equal(put(s, GEN, ['battery']), 'unknown');
  assert.equal(R.act(s, { k: 'put' }, { now: T0 }), 'unknown');
  assert.equal(put(s, { k: 'up', id: 'shotgun', s: 'mag' }, 'tape'), 'not owned', 'a gun not owned');
  assert.equal(put(s, MAG, 'tape'), 'not needed', 'level 1 of an upgrade takes coins alone');
  assert.equal(JSON.stringify(s), was);
  const top = base({ fuel: 9 });
  top.base.lv.generator = E.building('generator').levels.length;
  assert.equal(put(top, GEN, 'fuel'), 'not needed', 'a building at its top level takes nothing');
});

test("an upgrade with a part in: the cat's level 3 takes the rest, a gun's level 2 its one item", () => {
  const s = base({ bandages: 1, cans: 2, tape: 1 });
  s.meta.hp = 2;
  s.mast.pistol = 1e6;
  s.wup.pistol = { dmg: 0, rate: 0, mag: 1 };
  assert.equal(put(s, HP, 'bandages'), null);
  assert.deepEqual(s.put, { 'meta:hp': { bandages: 1 } });
  assert.deepEqual(R.left(s, HP), [
    ['bandages', 2],
    ['cans', 2],
  ]);
  const c = s.coins;
  assert.equal(R.act(s, HP, { now: T0 }), 'items');
  assert.equal(s.coins, c, 'refused: nothing taken');
  s.items.bandages = 2;
  assert.equal(R.act(s, HP, { now: T0 }), null);
  assert.deepEqual([s.meta.hp, s.put, s.items], [3, {}, { tape: 1 }]);
  assert.equal(s.coins, c - D.META.hp.price[2]);
  assert.equal(put(s, MAG, 'tape'), null);
  assert.deepEqual([s.put, s.items], [{ 'up:pistol:mag': { tape: 1 } }, {}]);
  assert.equal(R.act(s, MAG, { now: T0 }), null);
  assert.deepEqual([s.wup.pistol.mag, s.put], [2, {}]);
  // a record is for the next level only: the level after it starts empty
  assert.deepEqual(R.putOf(s, MAG), {});
});

test('the coins short: the parts go in all the same, the purchase waits for the coins', () => {
  const s = base({ battery: 2, fuel: 6, chips: 1 }, 10);
  for (const id of ['fuel', 'battery', 'chips']) assert.equal(put(s, GEN, id), null);
  assert.equal(R.act(s, GEN, { now: T0 }), 'coins');
  assert.deepEqual(s.put['build:generator'], { fuel: 6, battery: 2, chips: 1 });
  s.coins = 5000;
  assert.equal(R.act(s, GEN, { now: T0 }), null);
});

test('a rare gun handed in is a gun no longer owned (fixRare after every act)', () => {
  const s = base({ phantom: 1 });
  assert.ok(s.owned.phantom, 'owned while the stash holds it');
  // (no level takes the Phantom today: the rule is checked on a cost made up for this test)
  const L = E.building('generator').levels[1],
    was = L.items;
  L.items = was.concat([['phantom', 1]]);
  try {
    s.selected = 'phantom';
    assert.equal(put(s, GEN, 'phantom'), null);
    assert.deepEqual([!!s.owned.phantom, s.selected, s.items.phantom], [false, 'pistol', undefined]);
  } finally {
    L.items = was;
  }
});

test('a stored save: a known record kept, anything else dropped or cut to what the purchase takes', () => {
  assert.deepEqual(R.clean({}).put, {}, 'a save from before: none');
  for (const bad of [null, 7, 'x', [], [['build:generator', { fuel: 1 }]]])
    assert.deepEqual(R.clean({ put: bad }).put, {});
  const s = R.clean({
    base: { lv: { generator: 1 } },
    meta: { hp: 2 },
    owned: { pistol: true },
    wup: { pistol: { mag: 1 } },
    put: {
      'build:generator': { fuel: 99, battery: 1, chips: -3, scrap: 5, nonsense: 1 },
      'meta:hp': { bandages: 2.9, cans: '1' },
      'up:pistol:mag': { tape: 1 },
      'up:pistol:dmg': { scrap: 1 }, // (its level 1 takes no items)
      'build:nonsense': { fuel: 1 },
      'build:medbay:extra': { fuel: 1 },
      'meta:toString': { fuel: 1 },
      'up:nogun:mag': { tape: 1 },
      __proto__: { fuel: 1 },
      junk: 5,
      'build:workbench': 'x',
    },
  });
  assert.deepEqual(s.put, {
    'build:generator': { fuel: 6, battery: 1 },
    'meta:hp': { bandages: 2, cans: 1 },
    'up:pistol:mag': { tape: 1 },
  });
  assert.deepEqual(R.clean(JSON.parse(JSON.stringify(s))).put, s.put, 'read back the same');
  // the level bought some other way since: its record no longer fits and goes
  const up = R.clean({ ...JSON.parse(JSON.stringify(s)), meta: { hp: D.META.hp.max } });
  assert.equal(up.put['meta:hp'], undefined);
});

test("a guest's parts handed in come along into the wallet's account, no more than its runs brought", () => {
  const proof = R.clean({ camp: ['office'], coins: 100, items: { battery: 1, fuel: 2 } }),
    guest = R.clean({
      camp: ['office'],
      coins: 100,
      items: { fuel: 1 },
      put: { 'build:generator': { fuel: 1, wires: 1 } },
    });
  // (the guest's generator is not built: its level 1 takes fuel 1, bulbs 2, wires 1)
  const save = R.adopt(R.defaults(), proof, guest, T0);
  assert.deepEqual(save.put, { 'build:generator': { fuel: 1 } }, 'the fuel a run brought; the wires none did');
  assert.deepEqual(save.items, { fuel: 1 }, 'the stash: what the page still holds');
  assert.deepEqual(R.adopt(R.defaults(), null, guest, T0).put, {}, 'no proof: none');
});
