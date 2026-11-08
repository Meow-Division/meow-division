// The economy page's writer (server/econfile.mjs) must leave the files exactly as they are when nothing changed, write
// only what the page may change, and refuse anything else. Run: npm test (needs the repo's Prettier, a dev dependency).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as EF from '../server/econfile.mjs';

const cur = await EF.readEcon();
const state = EF.pageState(cur);
// what the page sends back when nothing was edited
const edit = () =>
  structuredClone({
    stamp: state.stamp,
    loot: state.loot,
    recipes: state.recipes.map((r) => ({ id: r.id, coins: r.coins, inputs: r.inputs })),
    buildings: state.buildings.map((b) => ({
      id: b.id,
      levels: b.levels.map((l) => ({ coins: l.coins, items: l.items })),
    })),
    upgrades: state.upgrades,
    prices: {
      meta: Object.fromEntries(state.meta.map((m) => [m.id, m.price])),
      weapon: Object.fromEntries(state.weapon.map((w) => [w.id, w.price])),
    },
  });

test('the page gets every table, the item names and the upgrade prices', () => {
  assert.ok(state.items.length > 20 && state.items.every((it) => it.name && it.name !== it.id));
  assert.deepEqual(
    state.meta.map((m) => m.id),
    Object.keys(cur.D.META),
  );
  assert.equal(state.loot.length, cur.E.LOOT.length);
  assert.ok(state.stamp.length === 40);
});

test('saving an unchanged page rewrites economy.js and data.js byte for byte', async () => {
  const t = EF.applyEdit(edit(), cur);
  assert.equal(await EF.formatJs(EF.econSource(cur.econ, t), EF.FILES.econ), cur.econ);
  assert.equal(EF.dataSource(cur.data, t.prices), cur.data);
});

test('an edit lands in its own table only', async () => {
  const q = edit();
  q.buildings[0].levels[0].coins += 1;
  q.prices.weapon.dmg[0] += 1;
  const t = EF.applyEdit(q, cur);
  const econ = await EF.formatJs(EF.econSource(cur.econ, t), EF.FILES.econ);
  const data = EF.dataSource(cur.data, t.prices);
  assert.notEqual(econ, cur.econ);
  assert.equal(data.split('\n').filter((l, i) => l !== cur.data.split('\n')[i]).length, 1, 'one line of data.js');
  const META_DMG = /\n {4}dmg: \{ icon[^\n]*/;
  assert.equal(data.match(META_DMG)[0], cur.data.match(META_DMG)[0], "the account's dmg price is untouched");
});

test('what the page may not do is refused', () => {
  const refused = (change) => {
    const q = edit();
    change(q);
    assert.throws(
      () => EF.applyEdit(q, cur),
      (e) => e.code === 400,
    );
  };
  refused((q) => q.buildings[0].levels[0].items.push(['k_medkit', 1])); // kits are crafted, not spent on buildings
  refused((q) => q.recipes[0].inputs.push(['nothing', 1]));
  refused((q) => q.recipes[0].inputs.push([q.recipes[0].inputs[0][0], 1])); // the same item twice
  refused((q) => (q.buildings[1].levels[0].items[0][1] = 0));
  refused((q) => q.buildings[1].levels.pop()); // levels are not added or removed here
  refused((q) => q.loot.reverse());
  refused((q) => q.loot[0].table.push(['t_butcher', 1, 1, 1])); // containers hold materials only
  refused((q) => (q.loot[0].table[0][3] = 0)); // most below least
  refused((q) => q.upgrades.meta.hp.pop());
  refused((q) => (q.prices.meta.hp[0] = 0));
});

test('a page loaded before the files changed cannot overwrite them', async () => {
  const q = edit();
  q.stamp = '0'.repeat(40);
  await assert.rejects(EF.saveEcon(q), (e) => e.code === 409);
});
