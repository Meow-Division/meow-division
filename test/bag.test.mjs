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
  assert.ok(
    S.p.bag.some((b) => b && b[0] === 't_butcher'),
    'the trophy: straight into the backpack',
  );
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

test('things lying within the pickup radius fly into the backpack; what the hero threw out stays', () => {
  const S = raid();
  lie(S, 'gears', 2, 80, 0);
  for (let i = 0; i < 120; i++) step(S);
  assert.equal(S.loot.length, 0, 'taken');
  assert.match(bag(S), /gears:2/);
  assert.ok(S.ev.some((e) => e.k === 'loot' && e.it === 'gears'));
  step(S, { pick: P.DROP + S.p.bag.findIndex((b) => b && b[0] === 'gears') });
  for (let i = 0; i < 120; i++) step(S);
  assert.equal(S.loot.length, 1, 'thrown out by hand: lies there');
  assert.ok(S.loot[0].own);
  step(S, { pick: P.take });
  assert.equal(S.loot.length, 0, 'taken back by hand');
  // far off: it waits
  lie(S, 'tape', 1, 900, 0);
  for (let i = 0; i < 60; i++) step(S);
  assert.equal(S.loot.length, 1);
});

test('a full backpack leaves things lying and says so once while the hero stays by them', () => {
  const S = raid();
  for (let i = 0; i < S.p.bag.length; i++) S.p.bag[i] = ['gpu', 1];
  lie(S, 'gears', 1, 60, 0);
  for (let i = 0; i < 120; i++) step(S);
  assert.equal(S.loot.length, 1, 'still lying');
  assert.equal(S.ev.filter((e) => e.k === 'bagfull').length, 1, 'said once');
  S.p.bag[0] = null; // (room made)
  for (let i = 0; i < 120; i++) step(S);
  assert.equal(S.loot.length, 0, 'taken once there is room');
});

test('a boss’s trophy goes straight into the backpack; a full one leaves it at the hero’s feet', () => {
  const S = raid();
  for (let i = 0; i < S.p.bag.length; i++) S.p.bag[i] = ['gpu', 1];
  SIM.kill(S, SIM.addEnemy(S, 'butcher', S.p.x + 300, S.p.y));
  const t = S.loot.find((o) => o.it === 't_butcher');
  assert.ok(t, 'on the ground');
  assert.ok(Math.hypot(t.x - S.p.x, t.y - S.p.y) < 120, 'at the hero’s feet');
  assert.ok(S.ev.some((e) => e.k === 'bagfull' && e.it === 't_butcher'));
});

test('a thing that comes down inside a wall is moved to a free spot', () => {
  const S = raid();
  let x = S.p.x,
    y = S.p.y;
  for (let r = 100; r < 3000 && !SIM.blockedAt(S, x, y, 8); r += 40) x = S.p.x + r;
  assert.ok(SIM.blockedAt(S, x, y, 8), 'a blocked spot found');
  S.loot.push({ id: 99, it: 'gears', n: 1, x, y, z: 0, vx: 0, vy: 0, vz: 0, own: 1 });
  step(S);
  assert.ok(!SIM.blockedAt(S, S.loot[0].x, S.loot[0].y, 8), 'moved out of it');
});

test('a won run left without the evac keeps its win and its backpack', () => {
  const S = raid();
  S.p.bag[0] = ['t_butcher', 1];
  S.winAt = S.t + 2.5; // (as a win sets it)
  const o = RULES.outcome(S);
  assert.equal(o.win, true);
  assert.deepEqual(o.bag, [['t_butcher', 1]]);
  // not won: only the safe, as before
  const L = raid();
  L.p.bag[0] = ['gears', 1];
  assert.deepEqual(RULES.outcome(L).bag, []);
});

test('a won run left standing ends by itself after a while', () => {
  const S = raid();
  S.winAt = S.t + 2.5; // (as a win sets it)
  for (let i = 0; i < 610 * 120 && !S.over; i++) step(S);
  assert.ok(S.over && S.over.evac && S.over.win, 'out, won');
});

test('together: a hero down when the evac ends is carried out with his backpack; one who leaves drops his', () => {
  const two = () => {
    const S = SIM.create({ seed: 8, rs: 5, heroes: [{ weapon: 'pistol' }, { weapon: 'pistol' }] });
    S.en.length = 0;
    for (const h of S.ps) h.god = true;
    return S;
  };
  const both = (S, a, b) => SIM.step(S, [REPLAY.quant(a || {}), REPLAY.quant(b || {})]);
  const S = two(),
    [A, B] = S.ps;
  B.bag[0] = ['t_butcher', 1];
  B.bag[1] = ['gears', 2];
  for (let i = 0; i < 1e6 && !SIM.evacOpen(S); i++) both(S);
  // he goes down far from his partner, who calls the evac at once (it ends before he would bleed out); what he carries then (the
  // cleaver and the gears given him, and whatever the two picked up while waiting for the evac) is what he must be carried out with
  const had = {};
  for (const sl of B.bag) if (sl) had[sl[0]] = (had[sl[0]] || 0) + sl[1];
  B.god = false;
  B.hp = 0;
  B.down = true;
  B.dead = true;
  B.bt = 30;
  A.x += 3000;
  both(S, { pick: P.exit });
  for (let i = 0; i < 1e5 && !S.over; i++) both(S);
  assert.ok(S.over && S.over.evac, 'out');
  assert.ok(had.t_butcher === 1 && had.gears >= 2, 'the cleaver and the gears were his');
  assert.deepEqual(
    RULES.outcome(S, 1).bag,
    Object.entries(had).sort((x, y) => (x[0] < y[0] ? -1 : 1)),
  );
  // one leaves: his backpack lies on the ground for the partner
  const L = two();
  L.ps[1].bag[0] = ['tape', 1];
  SIM.step(L, [REPLAY.quant({}), null]);
  assert.ok(L.ps[1].gone);
  assert.ok(L.loot.some((o) => o.it === 'tape'));
});
