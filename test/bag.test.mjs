// test/bag.test.mjs — the run's backpack as the sim plays it (live/sim.js, economy.js BAG_SLOTS / STACK / DROP / EVAC_*):
// things in reach are taken by hand into the first slot that fits, a full backpack takes nothing and says so, a slot
// thrown out lies at the hero's feet, slots move and sort, the evac opens on time and takes the backpack home, a hero
// who didn't leave by it keeps only the safe, a raid's zombies leave things now and then and every boss its trophy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js'),
  E = require('../live/economy.js');
const P = SIM.PICK;

// a raid on the suburbs' map, the hero beyond harm, no zombies about
function raid(rs = 5) {
  const S = SIM.create({ seed: 8, rs });
  S.p.god = true;
  S.en.length = 0;
  return S;
}
const step = (S, inp = {}) => SIM.step(S, REPLAY.quant(inp));
// a thing laid by the hero's side (dx, dy away)
function lie(S, it, n, dx = 20, dy = 0) {
  const id = (S.lid = (S.lid || 0) + 1);
  S.loot.push({ id, it, n, x: S.p.x + dx, y: S.p.y + dy, z: 0, vx: 0, vy: 0, vz: 0 });
  return id;
}
const bag = (S) => S.p.bag.map((b) => (b ? b.join(':') : '-')).join(' ');

test('a new hero has an empty backpack of BAG_SLOTS and the safe a newcomer has', () => {
  const S = raid();
  assert.equal(S.p.bag.length, E.BAG_SLOTS);
  assert.ok(S.p.bag.every((b) => b === null));
  assert.equal(S.p.safe.length, E.SAFE_SLOTS[0]);
  assert.deepEqual(S.loot, []);
});

test('a thing in reach is taken: its stacks fill up first, then new slots', () => {
  const S = raid();
  lie(S, 'gears', 3);
  step(S, { pick: P.take });
  assert.equal(bag(S).split(' ')[0], 'gears:3');
  assert.deepEqual(S.loot, []);
  const id = lie(S, 'gears', 4);
  step(S, { pick: P.TAKE + id });
  assert.equal(bag(S).split(' ').slice(0, 2).join(' '), `gears:${E.STACK} gears:${7 - E.STACK}`);
  assert.ok(
    S.ev.some((e) => e.k === 'loot'),
    'the page hears it',
  );
});

test('out of reach nothing is taken', () => {
  const S = raid();
  const id = lie(S, 'tape', 1, 600, 0);
  step(S, { pick: P.TAKE + id });
  step(S, { pick: P.take });
  assert.equal(S.loot.length, 1);
  assert.ok(S.p.bag.every((b) => b === null));
});

test('a full backpack takes nothing and says so; what fits of a stack is taken, the rest stays', () => {
  const S = raid();
  S.p.bag.fill(null).forEach((_, i) => (S.p.bag[i] = ['t_tank', 1]));
  S.p.bag[0] = ['gears', E.STACK - 1];
  lie(S, 'gears', 3);
  step(S, { pick: P.take });
  assert.equal(S.p.bag[0][1], E.STACK);
  assert.equal(S.loot.length, 1);
  assert.equal(S.loot[0].n, 2, 'two left lying');
  step(S, { pick: P.take });
  assert.equal(S.loot[0].n, 2);
  assert.ok(S.ev.some((e) => e.k === 'bagfull'));
});

test('a slot thrown out lies at the hero’s feet and can be taken again', () => {
  const S = raid();
  S.p.bag[2] = ['tape', 2];
  step(S, { pick: P.DROP + 2 });
  assert.equal(S.p.bag[2], null);
  assert.equal(S.loot.length, 1);
  for (let i = 0; i < 240; i++) step(S);
  assert.equal(S.loot[0].z, 0, 'landed');
  assert.ok(SIM.lootNear(S, S.p).length, 'in reach');
  step(S, { pick: P.take });
  assert.equal(bag(S).split(' ')[0], 'tape:2');
});

test('moving onto the same item fills it up, onto another or an empty slot swaps; sorting merges and orders', () => {
  const S = raid();
  S.p.bag[0] = ['gears', 3];
  S.p.bag[1] = ['t_butcher', 1];
  S.p.bag[2] = ['gears', 4];
  step(S, { pick: P.MOVE + 2 * 100 + 0 });
  assert.deepEqual(S.p.bag.slice(0, 3), [
    ['gears', E.STACK],
    ['t_butcher', 1],
    ['gears', 7 - E.STACK],
  ]);
  step(S, { pick: P.MOVE + 1 * 100 + 5 });
  assert.equal(S.p.bag[1], null);
  assert.deepEqual(S.p.bag[5], ['t_butcher', 1]);
  S.p.bag[7] = ['gpu', 1];
  step(S, { pick: P.sort });
  assert.deepEqual(S.p.bag.slice(0, 4), [
    ['t_butcher', 1],
    ['gpu', 1],
    ['gears', E.STACK],
    ['gears', 7 - E.STACK],
  ]);
  assert.ok(S.p.bag.slice(4).every((b) => b === null));
  step(S, { pick: P.MOVE + 0 * 100 + 99 });
  assert.deepEqual(S.p.bag[0], ['t_butcher', 1], 'no such slot: nothing moves');
});

test('the evac opens at EVAC_FROM; out by it the backpack comes home, a quit keeps the safe only', () => {
  const S = raid();
  S.p.bag[0] = ['gears', 2];
  S.p.safe = [['gpu', 1]];
  step(S, { pick: P.exit });
  assert.equal(S.ex, null, 'not open yet');
  assert.deepEqual(RULES.outcome(S).bag, [['gpu', 1]], 'quit now: the safe only');
  S.t = E.EVAC_FROM;
  step(S, { pick: P.exit });
  assert.ok(S.ex, 'the countdown');
  step(S, { pick: P.stay });
  assert.equal(S.ex, null, 'called off');
  step(S, { pick: P.exit });
  for (let i = 0; i < (E.EVAC_HOLD + 1) * 120 && !S.over; i++) step(S);
  assert.ok(S.over && S.over.evac, 'out');
  assert.equal(S.over.win, false, 'the boss not down: no win');
  assert.deepEqual(RULES.outcome(S).bag, [
    ['gears', 2],
    ['gpu', 1],
  ]);
  const save = RULES.defaults(),
    g = RULES.bank(save, RULES.outcome(S));
  assert.deepEqual(save.items, { gears: 2, gpu: 1 });
  assert.deepEqual(g.items, [
    ['gears', 2],
    ['gpu', 1],
  ]);
});

test('a raid’s zombies leave things now and then, every boss its trophy; the office’s zombies nothing', () => {
  const S = raid(9);
  for (let i = 0; i < 5000; i++) {
    const e = SIM.addEnemy(S, 'walker', S.p.x + 300, S.p.y);
    SIM.kill(S, e);
  }
  const n = S.loot.length;
  assert.ok(n > 0 && n < 20, `some, not many: ${n}`);
  const tab = E.loot('suburb').table.map((r) => r[0]);
  assert.ok(
    S.loot.every((o) => tab.includes(o.it)),
    'from the map’s table',
  );
  const b = SIM.addEnemy(S, 'butcher', S.p.x + 300, S.p.y);
  SIM.kill(S, b);
  assert.ok(S.loot.some((o) => o.it === 't_butcher'));
  const O = SIM.create({ seed: SIM.OFFICE, rs: 3, mission: 'office' });
  for (let i = 0; i < 3000; i++) SIM.kill(O, SIM.addEnemy(O, 'walker', O.p.x + 300, O.p.y));
  assert.deepEqual(O.loot, [], 'the office: only the Butcher’s cleaver');
});

test('a card screen’s pick is never the backpack’s order, nor the other way round', () => {
  const S = raid();
  S.pause = { k: 'chest', items: [], coins: 0, kind: 'air', t: 0 };
  S.p.pause = S.pause;
  step(S, { pick: P.sort });
  assert.ok(S.p.pause, 'the chest screen still open');
});
