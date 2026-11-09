// live/economy.js must stay consistent: every id it mentions exists, prices follow Walt's formula, recipes and
// buildings ask only for real items, every boss leaves one trophy, and the first-session promise holds (selling
// the Butcher's cleaver pays for the workbench). Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js');
const DATA = require('../live/data.js');

const ids = E.ITEMS.map((it) => it.id);
const kind = (id) => E.item(id)?.kind;

test('item ids are unique lower_snake token ids', () => {
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9_]{1,31}$/);
  for (const it of E.ITEMS) {
    assert.ok(['material', 'trophy', 'kit'].includes(it.kind), it.id);
    assert.ok(it.rarity >= 1 && it.rarity <= 4, it.id);
    if (it.kind === 'kit') assert.equal(it.base, 0, `${it.id}: Walt does not trade kits`);
    else assert.ok(it.base > 0 && it.norm > 0, it.id);
  }
});

test("Walt's prices follow base × 2 × norm / (norm + stock)", () => {
  const gears = E.item('gears');
  assert.equal(E.buyPrice('gears', 0), gears.base * 2);
  assert.equal(E.buyPrice('gears', gears.norm), gears.base);
  assert.equal(E.buyPrice('gears', gears.norm * 3), gears.base / 2);
  for (const id of ids.filter(E.tradable)) {
    let last = Infinity;
    for (const stock of [0, 1, 5, 20, 100, 1000]) {
      const p = E.buyPrice(id, stock);
      assert.ok(p >= E.MIN_PRICE && p <= last, `${id} at ${stock}`);
      if (stock > 0) assert.ok(E.sellPrice(id, stock) >= p, `${id}: Walt never sells below what he pays`);
      last = p;
    }
  }
  assert.equal(E.sellPrice('gears', 0), 0, 'Walt sells only what he holds');
  assert.equal(E.buyPrice('k_medkit', 0), 0);
});

test('stock decays 5 % a day and never goes negative', () => {
  assert.equal(E.decay(100), 95);
  assert.equal(E.decay(10), 10);
  assert.equal(E.decay(0), 0);
});

test("Walt's reasoning names the shelf state and carries the numbers", () => {
  const norm = E.item('gears').norm;
  assert.equal(E.explain('gears', 0).key, 'walt.why.short');
  assert.equal(E.explain('gears', norm).key, 'walt.why.fair');
  assert.equal(E.explain('gears', norm * 3).key, 'walt.why.glut');
  assert.equal(E.explain('gears', 7, 2).vars.buy, E.buyPrice('gears', 7));
  assert.equal(E.explain('k_vest', 0).key, 'walt.why.noTrade');
});

test('recipes turn materials into kits at a real building level', () => {
  for (const r of E.RECIPES) {
    const b = E.building(r.at);
    assert.ok(b && r.level >= 1 && r.level <= b.levels.length, r.id);
    for (const [id, n] of r.inputs) assert.ok(kind(id) === 'material' && n > 0, `${r.id}: ${id}`);
    assert.equal(kind(r.output[0]), 'kit', r.id);
  }
  const made = E.RECIPES.map((r) => r.output[0]);
  for (const it of E.ITEMS.filter((it) => it.kind === 'kit')) assert.ok(made.includes(it.id), `${it.id} has a recipe`);
});

test('buildings ask for real items and the generator powers their upper levels', () => {
  for (const b of E.BUILDINGS) {
    b.levels.forEach((lv, i) => {
      assert.ok(lv.coins > 0, `${b.id} ${i + 1}`);
      for (const [id, n] of lv.items) assert.ok(E.item(id) && n > 0, `${b.id} ${i + 1}: ${id}`);
      if (b.id !== 'generator') assert.ok(lv.power <= i, `${b.id} ${i + 1} needs at most generator ${i}`);
    });
    if (b.lockedBy) assert.equal(kind(b.lockedBy), 'trophy');
  }
});

test('every boss leaves one trophy, and each trophy belongs to a real boss', () => {
  const trophies = E.ITEMS.filter((it) => it.kind === 'trophy');
  assert.equal(trophies.length, 5);
  for (const t of trophies) {
    assert.ok(DATA.ENEMIES[t.boss]?.boss, `${t.id}: ${t.boss} is a boss in data.js`);
    assert.equal(E.trophyOf(t.boss), t.id);
  }
  assert.equal(E.trophyOf('walker'), null);
});

test('loot tables drop materials only, and every entry can come up', () => {
  for (const l of E.LOOT) {
    assert.ok(l.rolls >= 1, l.map);
    const seen = new Set();
    for (let k = 0; k < 400; k++) {
      const [id, n] = E.roll(l.table, k / 400, ((k * 7919) % 400) / 400);
      const entry = l.table.find((e) => e[0] === id);
      assert.ok(kind(id) === 'material', `${l.map}: ${id}`);
      assert.ok(n >= entry[2] && n <= entry[3], `${l.map}: ${id} × ${n}`);
      seen.add(id);
    }
    assert.equal(seen.size, l.table.length, `${l.map}: every entry drops`);
  }
});

test('the first trade works: mission 1 and its cleaver sold to an empty shelf pay for workbench level 1', () => {
  const workbench = E.building('workbench').levels[0];
  const m1 = E.MISSIONS[0];
  assert.deepEqual(m1.reward.items, [['t_butcher', 1]], 'the NEAR AI office gives only the cleaver');
  assert.equal(E.loot('office'), null, 'the office has no containers');
  assert.ok(m1.reward.coins + E.buyPrice('t_butcher', 0) >= workbench.coins);
  assert.deepEqual(workbench.items, [], 'level 1 is a repair paid in coins');
});

test('the raid maps drop nearly everything; the vaccine sample only in the lab, trophies only from bosses', () => {
  const drops = (map) => E.loot(map).table.map((e) => e[0]);
  assert.ok(!drops('suburb').includes('vaccine'));
  assert.ok(drops('lab').includes('vaccine'));
  for (const it of E.ITEMS.filter((x) => x.kind === 'material' && x.id !== 'vaccine'))
    assert.ok(drops('suburb').includes(it.id) && drops('lab').includes(it.id), it.id + ' drops on both raid maps');
});

test('barter offers give real items for real weapons', () => {
  for (const b of E.BARTER) {
    assert.ok(DATA.MAIN[b.weapon], b.id);
    for (const [id, n] of b.give) assert.ok(E.item(id) && n > 0, `${b.id}: ${id}`);
  }
});

test('campaign missions play on real maps and pay real items; the locked ones come last', () => {
  const ids = E.MISSIONS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  let soon = false;
  for (const m of E.MISSIONS) {
    assert.match(m.n, /^\d+-\d+$/, m.id);
    assert.equal(E.mission(m.id), m);
    if (m.soon) {
      soon = true;
      continue;
    }
    assert.ok(!soon, `${m.id}: a playable mission after a locked one`);
    assert.ok(
      DATA.MAPS.some((map) => map.id === m.map && map.open),
      `${m.id}: map ${m.map}`,
    );
    assert.ok(m.reward.coins > 0 && m.reward.xp > 0, m.id);
    for (const [id, n] of m.reward.items) assert.ok(E.item(id) && n > 0, `${m.id}: ${id}`);
  }
  assert.equal(E.mission('nowhere'), null);
});

test('upgrades list items for every level of every upgrade, and loot plans name their containers', () => {
  for (const [g, defs] of [
    ['meta', DATA.META],
    ['weapon', DATA.WEAPON_UP],
  ]) {
    assert.deepEqual(Object.keys(E.UPGRADES[g]).sort(), Object.keys(defs).sort(), g);
    for (const id in defs) {
      assert.equal(E.UPGRADES[g][id].length, defs[id].price.length, `${g}.${id}: one item list per level`);
      for (const lv of E.UPGRADES[g][id])
        for (const [it, n] of lv) assert.ok(E.item(it) && kind(it) !== 'kit' && n > 0);
    }
  }
  for (const l of E.LOOT) assert.ok(Number.isInteger(l.boxes) && l.boxes > 0, l.map);
  for (const r of E.RECIPES) assert.ok(Number.isInteger(r.coins) && r.coins >= 0, r.id);
});
