// test/perks.test.mjs — what a level up and a crate deal (REV 31, live/sim.js cardOptions, chestReward): every level up has a
// card that fights and one that guards while there are such to deal, the three in no fixed order; a crate with a slot free
// brings the partner of something held about D.PAIR_DROP of the time; the cursor on the hero turns him no more (AIM_DEAD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  D = require('../live/data.js');

const fights = (c) => c.ty === 'main' || D.ITEMS[c.id].kind === 'weapon' || D.FIGHT.includes(c.id),
  guards = (c) => D.GUARD.includes(c.id);
const pool = [...D.SUB_WEAPONS, ...D.PASSIVES];

// a seeded random (mulberry32): the same hands every time the test runs
let seed = 20261111;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// a hero holding a random handful of items at random levels
function hand(S, k) {
  const p = S.p,
    ids = pool
      .slice()
      .sort(() => rand() - 0.5)
      .slice(0, k);
  p.items = ids.map((id) => Object.assign(SIM.newItem(id), { lvl: 1 + Math.floor(rand() * D.ITEMS[id].st.length) }));
  p.main.lvl = 1 + Math.floor(rand() * 5);
  SIM.recalc(S);
}

test('a level up: a card that fights and one that guards whenever there are such, in no fixed place', () => {
  const S = SIM.create({ seed: 8, rs: 11 }),
    first = { fight: 0, other: 0 };
  for (let i = 0; i < 3000; i++) {
    hand(S, i % (D.MAX_ITEMS + 1));
    const c = SIM.cardOptions(S),
      p = S.p,
      held = (id) => p.items.find((j) => j.id === id),
      can = (ok) =>
        (p.main.lvl < 5 && ok({ ty: 'main', id: p.main.id })) ||
        p.items.some((j) => j.lvl < D.ITEMS[j.id].st.length && ok({ ty: 'up', id: j.id })) ||
        (p.items.length < D.MAX_ITEMS && pool.some((id) => !held(id) && ok({ ty: 'new', id })));
    const left =
      (p.main.lvl < 5 ? 1 : 0) +
      p.items.filter((j) => j.lvl < D.ITEMS[j.id].st.length).length +
      (p.items.length < D.MAX_ITEMS ? pool.filter((id) => !held(id)).length : 0);
    assert.equal(
      c.length,
      left ? Math.min(3, left) : 2,
      'three cards, or as many as are left (none: the medkit and the coins)',
    );
    assert.equal(new Set(c.map((x) => x.ty + x.id)).size, c.length, 'no card twice');
    if (can(fights)) assert.ok(c.some(fights), 'a card that fights: ' + JSON.stringify(c));
    if (can(guards)) assert.ok(c.some(guards), 'a card that guards: ' + JSON.stringify(c));
    first[fights(c[0]) ? 'fight' : 'other']++;
  }
  assert.ok(first.other > 600, "the first card isn't always the one that fights: " + JSON.stringify(first));
});

test('a crate with a slot free brings a missing partner about 35 % of the time', () => {
  const S = SIM.create({ seed: 8, rs: 12 }),
    p = S.p;
  let got = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    // the saws held (their partner the magnet), the caliber held (the main gun's): the magnet the one partner missing
    p.items = [SIM.newItem('saws'), SIM.newItem('caliber'), SIM.newItem('armor'), SIM.newItem('chain')];
    p.main.lvl = 1;
    SIM.recalc(S);
    const it = SIM.chestReward(S, i % 2 === 0);
    assert.ok(it.length >= 1);
    if (it.some((c) => c.ty === 'new' && c.id === 'magnet')) got++;
  }
  // (the magnet can come the old way too, now and then: from the pool)
  const k = got / N;
  assert.ok(k > 0.33 && k < 0.5, 'the magnet in ' + (k * 100).toFixed(1) + ' % of crates');
  // every slot taken: no partner dealt that way
  p.items = ['saws', 'caliber', 'armor', 'chain', 'tesla', 'drone', 'boots'].map((id) => SIM.newItem(id));
  SIM.recalc(S);
  for (let i = 0; i < 300; i++)
    assert.ok(!SIM.chestReward(S, true).some((c) => c.ty === 'new'), 'nothing new: no slot free');
  // nothing missing its partner (the drone and the clover, the caliber): no partner to bring, the crate as before
  p.items = ['drone', 'clover', 'caliber'].map((id) => SIM.newItem(id));
  SIM.recalc(S);
  for (let i = 0; i < 300; i++) assert.ok(SIM.chestReward(S, false).length >= 1);
});

test('the cursor on the hero turns him no more; off him he turns to it', () => {
  const S = SIM.create({ seed: 8, rs: 13 }),
    p = S.p,
    z = S.zoom || 1;
  const cur = (wx, wy) => ({ mx: (wx - p.cam[0]) * z, my: (wy - p.cam[1]) * z });
  for (let i = 0; i < 240; i++) SIM.step(S, { ...cur(p.x + 400, p.y - SIM.muzzleZ(S)), fire: false });
  const a0 = p.aim;
  assert.ok(Math.abs(a0) < 0.1, 'aimed right: ' + a0);
  // the cursor circling round his middle, inside the zone: the aim stays
  for (let i = 0; i < 240; i++) {
    const t = i / 10;
    SIM.step(S, { ...cur(p.x + 10 * Math.cos(t), p.y - SIM.muzzleZ(S) * 0.7 + 10 * Math.sin(t)), fire: false });
  }
  assert.equal(p.aim, a0, 'the aim kept');
  // out of it, to the left: he turns
  for (let i = 0; i < 240; i++) SIM.step(S, { ...cur(p.x - 400, p.y - SIM.muzzleZ(S)), fire: false });
  assert.ok(Math.abs(Math.abs(p.aim) - Math.PI) < 0.1, 'aimed left: ' + p.aim);
});

test('a cursor moved about anywhere near the hero never sets him spinning', () => {
  const S = SIM.create({ seed: 8, rs: 14 }),
    p = S.p,
    z = S.zoom || 1;
  // (no zombies: their blows shove him off the cursor, and with REV 33's small still zone that alone turns him, rightly)
  const step = (inp) => {
    S.en.length = 0;
    SIM.step(S, inp);
  };
  // the cursor still at each spot round him for half a second: the aim settles (it may stay put, never keeps turning)
  for (let r = 0; r <= 90; r += 6)
    for (let a = 0; a < 6.28; a += 0.5) {
      const wx = p.x + r * Math.cos(a),
        wy = p.y - 33 + r * Math.sin(a),
        inp = { mx: (wx - p.cam[0]) * z, my: (wy - p.cam[1]) * z, fire: false };
      for (let i = 0; i < 60; i++) step(inp);
      const a0 = p.aim;
      for (let i = 0; i < 12; i++) step(inp);
      assert.ok(
        Math.abs(p.aim - a0) < 0.05,
        `r ${r} a ${a.toFixed(1)}: the aim moved ${(p.aim - a0).toFixed(2)} with the cursor still`,
      );
    }
});
