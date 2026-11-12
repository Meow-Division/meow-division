// test/base.test.mjs — NEAR Base's tutorial (the human's, 2026-11-11; live/hub.js, rules.js base): after mission 1 the
// generator, then the workbench, then the medbay to level 1, each from cheap parts (no coins), the workbench's and the
// medbay's rooms cleared of junk first (5 s, then a minute, then longer: economy.js CLEAR_TIME, one at a time); the guns'
// upgrades need the workbench standing, the cat's the medbay; the first suburb boss drops the building's parts once
// (rules.js gift → sim.js S.gift, REV 41), marked given when that run is banked; Walt keeps the parts on his shelf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  R = require('../live/rules.js'),
  E = require('../live/economy.js'),
  D = require('../live/data.js');

const T0 = 1.8e12; // (a clock's ms)
const fresh = (items = {}) => R.clean({ camp: ['office'], coins: 5000, items, owned: { pistol: true, shotgun: true } });
const parts = (id) => Object.fromEntries(E.building(id).levels[0].items);

test('no tutorial before mission 1; after it the generator, the workbench, the medbay in turn', () => {
  assert.equal(R.task(R.clean({})), null);
  const s = fresh({ ...parts('generator'), ...parts('workbench'), ...parts('medbay') });
  assert.equal(R.task(s), 'generator');
  assert.equal(R.act(s, { k: 'build', id: 'generator' }, { now: T0 }), null);
  assert.equal(R.task(s), 'workbench', 'paid for: the next one');
  assert.equal(R.blv(s, 'generator', T0 + 4999), 0, 'still going up');
  assert.equal(R.blv(s, 'generator', T0 + 5000), 1, 'standing 5 s later');
  assert.equal(s.coins, 5000, 'level 1 costs no coins');
  assert.deepEqual(s.items, { ...parts('workbench'), ...parts('medbay') }, 'its parts spent');
});

test('a building needs its parts and its room cleared; a clearing is free, one at a time, each longer', () => {
  const s = fresh(parts('workbench'));
  s.base.lv.generator = 1;
  assert.equal(R.act(s, { k: 'build', id: 'workbench' }, { now: T0 }), 'room');
  assert.equal(R.act(s, { k: 'clear', id: 'alcove' }, { now: T0 }), null);
  assert.equal(R.clearing(s, T0 + 1000), 'alcove');
  assert.equal(R.act(s, { k: 'clear', id: 'meeting' }, { now: T0 + 1000 }), 'busy', 'one at a time');
  assert.equal(R.act(s, { k: 'build', id: 'workbench' }, { now: T0 + 4000 }), 'room', 'not before it is done');
  assert.ok(R.cleared(s, 'alcove', T0 + 5000), 'the first one: 5 s');
  assert.equal(R.act(s, { k: 'clear', id: 'alcove' }, { now: T0 + 6000 }), 'cleared');
  assert.equal(R.act(s, { k: 'clear', id: 'meeting' }, { now: T0 + 6000 }), null);
  assert.equal(s.base.clr.meeting - (T0 + 6000), 60e3, 'the second one: a minute');
  assert.equal(R.clearTime(s), 300, 'the third: 5 min');
  assert.deepEqual(E.CLEAR_TIME.slice(0, 7), [5, 60, 300, 1800, 3600, 7200, 12600], "the human's times");
  const poor = fresh({});
  poor.base.lv.generator = 1;
  poor.base.clr.alcove = T0;
  assert.equal(R.act(poor, { k: 'build', id: 'workbench' }, { now: T0 + 1 }), 'items');
  assert.equal(R.act(s, { k: 'build', id: 'workbench' }, { now: T0 + 7000 }), null);
  assert.equal(R.act(s, { k: 'clear', id: 'nonsense' }, { now: T0 }), 'unknown junk');
});

test("the guns' upgrades need the workbench standing, the cat's the medbay", () => {
  const s = fresh({});
  s.mast.shotgun = 1e6;
  assert.equal(R.act(s, { k: 'up', id: 'shotgun', s: 'dmg' }, { now: T0 }), 'workbench');
  assert.equal(R.act(s, { k: 'meta', s: 'hp' }, { now: T0 }), 'medbay');
  s.base.lv.workbench = 1;
  s.base.bt.workbench = T0 + 1000;
  assert.equal(R.act(s, { k: 'up', id: 'shotgun', s: 'dmg' }, { now: T0 }), 'workbench', 'still going up');
  assert.equal(R.act(s, { k: 'up', id: 'shotgun', s: 'dmg' }, { now: T0 + 1000 }), null);
  s.base.lv.medbay = 1;
  assert.equal(R.act(s, { k: 'meta', s: 'hp' }, { now: T0 }), null);
});

test('the base survives a save read back; nonsense in it is dropped', () => {
  const s = fresh({});
  s.base = {
    lv: { generator: 1, workbench: 9, nope: 1 },
    bt: { generator: T0 },
    clr: { alcove: T0, x: 5 },
    gift: ['generator', 'x'],
  };
  const c = R.clean(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(c.base.lv, { generator: 1, workbench: 3 });
  assert.equal(c.base.bt.generator, T0);
  assert.deepEqual(c.base.clr, { alcove: T0 });
  assert.deepEqual(c.base.gift, ['generator']);
  assert.deepEqual(R.clean({}).base, { lv: {}, bt: {}, clr: {}, gift: [] });
});

// a suburb run with the tutorial's gift: its first boss dropped by a cheat and killed
function giftRun(seed, gift) {
  const S = SIM.create({ seed, rs: 4242, gift });
  S.p.god = true;
  const step = () => SIM.step(S, S.p.pause ? { pick: 0 } : {});
  for (let i = 0; i < 30; i++) step();
  SIM.cheat(S, 'boss');
  const b = S.en.find((e) => D.ENEMIES[e.k].boss);
  assert.ok(b, 'a boss came');
  SIM.damage(S, b, b.hp + 1, 0, 0);
  for (let i = 0; i < 400; i++) step();
  return S;
}

test("the first suburb boss drops the tutorial's parts once; the run's end says so and the bank marks it", () => {
  const save = fresh({});
  const g = R.gift(save);
  assert.deepEqual(g, { id: 'generator', items: E.building('generator').levels[0].items });
  const S = giftRun(7, g);
  assert.ok(S.gift && S.gift.done, 'dropped');
  for (const [id, n] of g.items)
    assert.ok(
      S.loot.some((o) => o.it === id && o.n === n) || S.p.bag.some((b) => b && b[0] === id),
      `${id} on the ground or taken`,
    );
  const o = R.outcome(S);
  assert.equal(o.gift, 'generator');
  R.bank(save, o);
  assert.deepEqual(save.base.gift, ['generator']);
  assert.equal(R.gift(save), null, 'once');
  // the next building: its own gift
  save.base.lv.generator = 1;
  assert.equal(R.gift(save).id, 'workbench');
  // a boss in a run with no gift drops none of it; the lab's map takes none
  const plain = giftRun(7, null);
  assert.equal(plain.gift, null);
  assert.equal(SIM.create({ seed: SIM.LAB0 + 1, rs: 1, gift: g }).gift, null, 'not on the lab map');
  assert.equal(
    SIM.create({ seed: 7, rs: 1, gift: { id: 'kitchen', items: [['fuel', 1]] } }).gift,
    null,
    'the tutorial only',
  );
});

test('the same run with the same gift plays the same (the server replays it from the ticket)', () => {
  const g = { id: 'workbench', items: E.building('workbench').levels[0].items };
  const a = giftRun(8, g),
    b = giftRun(8, g);
  assert.deepEqual(
    a.loot.map((o) => [o.it, o.n, Math.round(o.x), Math.round(o.y)]),
    b.loot.map((o) => [o.it, o.n, Math.round(o.x), Math.round(o.y)]),
  );
});

test('the base level: junk heaps and building spots tagged; what stands or is cleared follows S.base', () => {
  const LV = SIM.level(SIM.BASE);
  for (const id of E.JUNK)
    assert.ok(
      LV.props.some((o) => o.junk === id),
      `junk ${id} on the map`,
    );
  for (const id of ['generator', 'workbench', 'medbay'])
    assert.ok(
      LV.props.some((o) => o.bspot === id),
      `${id} spot`,
    );
  // the reception desk by the way in goes with the blood in front of it, its gear over the desk (the heap's first prop)
  assert.deepEqual(
    LV.props
      .filter((o) => o.junk === 'reception')
      .map((o) => o.n)
      .sort(),
    ['m1_in_receptionisle', 'm1_st_blood'],
  );
  const gen = LV.props.find((o) => o.bspot === 'generator'),
    heap = LV.props.find((o) => o.junk === 'alcove');
  assert.equal(SIM.hubGone({ base: { b: {}, j: {} } }, gen), true, 'not built: not there');
  assert.equal(SIM.hubGone({ base: { b: { generator: 1 }, j: {} } }, gen), false);
  assert.equal(SIM.hubGone({ base: { b: {}, j: {} } }, heap), false);
  assert.equal(SIM.hubGone({ base: { b: {}, j: { alcove: 1 } } }, heap), true, 'cleared: gone');
  // the mission's own inside (the same map) has none of it
  assert.ok(!SIM.level(SIM.OFFICE_IN).props.some((o) => o.hb));
});

// the rooms drawn whole (the human's, 2026-11-12: gen/m1art.py room=, placed in the editor): each building's room shown once
// it stands, the kitchen once the store room is cleared; only what stands in a room stops the hero (not the whole floor);
// the wall across the alcove goes with its junk, the medbay's broken glass front whole once it stands
test('the base rooms: shown with their building, stopping only by what stands in them', () => {
  const LV = SIM.level(SIM.BASE),
    room = (n) => LV.props.find((o) => o.n === n),
    none = { base: { b: {}, j: {} } },
    all = {
      base: { b: { generator: 1, workbench: 1, medbay: 1 }, j: Object.fromEntries(E.JUNK.map((id) => [id, 1])) },
    };
  for (const [n, b] of [
    ['m1_rm_gen', 'generator'],
    ['m1_rm_wb', 'workbench'],
    ['m1_rm_med', 'medbay'],
  ]) {
    const r = room(n);
    assert.ok(r && r.room && r.flat, n);
    assert.equal(r.bspot, b, `${n}: ${b}'s`);
    assert.equal(SIM.hubGone(none, r), true);
    assert.equal(SIM.hubGone(all, r), false);
    assert.equal(LV.props.filter((o) => o.bspot === b && !o.ng).length, 1, `${b}: its room, no hb_spot`);
  }
  const kit = room('m1_rm_kit');
  assert.equal(kit.ajunk, 'storage');
  assert.equal(SIM.hubGone(none, kit), true, 'under the junk');
  assert.equal(SIM.hubGone({ base: { b: {}, j: { storage: 1 } } }, kit), false);
  // its table and stools: parts after every map prop, tagged as the kitchen is, drawn after it
  const parts = LV.props.filter((o) => o.part);
  assert.equal(parts.length, 4);
  for (const q of parts) {
    assert.equal(q.ajunk, 'storage');
    assert.ok(q.rk > kit.rk);
  }
  // the hero walks in a room: its middle is free floor, the generator stops him
  const S = { seed: SIM.BASE, ...all },
    c = room('m1_rm_gen').col,
    at = (gx, gy) => SIM.blockedAt(S, ...SIM.toS(gx, gy), 0);
  assert.equal(at(c.x0 + 180, c.y1 - 40), false, 'its floor');
  assert.equal(at(c.x0 + 95, c.y0 + 80), true, 'the generator');
  // the alcove's wall goes with its junk; the medbay's broken glass gives way to whole glass once it stands
  const wall = LV.props.find((o) => o.n === 'm1_wk_x_plain' && o.junk === 'alcove');
  assert.ok(wall, 'the wall across the alcove is its junk');
  const broken = LV.props.find((o) => o.n === 'm1_wk_x_broken' && o.unb === 'medbay'),
    whole = LV.props.find((o) => o.n === 'm1_wk_x_clear' && o.bspot === 'medbay' && o.ng);
  assert.ok(broken && whole && broken.gx === whole.gx && broken.gy === whole.gy);
  const med = { base: { b: { medbay: 1 }, j: {} } };
  assert.equal(SIM.hubGone(none, broken), false);
  assert.equal(SIM.hubGone(med, broken), true);
  assert.equal(SIM.hubGone(none, whole), true);
  assert.equal(SIM.hubGone(med, whole), false);
});

test("Walt's shelf holds the tutorial's parts every morning", async () => {
  const { makeWalt } = await import('../server/walt.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walt-'));
  try {
    const W = makeWalt(dir, E),
      st = W.view().stock;
    for (const [id, n] of Object.entries(E.WALT_BASICS)) assert.ok((st[id] || 0) >= n, `${id} on the shelf`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
