// test/perks.test.mjs — what a level up and a crate deal (REV 42, live/sim.js cardOptions, chestReward): before 2 minutes of a
// run a level up has one gun card (the main gun's or an extra weapon's) and one passive while there are such to deal, the third a gun
// 70 % of the time; until 5 minutes the same at 50 %; after that any three (D.CARD_GUN); the three in no fixed order; a crate with a
// slot free brings the partner of something held about D.PAIR_DROP of the time; the cursor on the hero turns him no more (AIM_DEAD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  D = require('../live/data.js');

const isGun = (c) => c.ty === 'main' || D.ITEMS[c.id].kind === 'weapon',
  passive = (c) => !isGun(c);
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

// deals 3000 hands at the run's second t; returns the share of deals with two guns among those with two of each kind to deal,
// and the deals with no gun at all among those
function deal(t, rs) {
  const S = SIM.create({ seed: 8, rs }),
    first = { gun: 0, other: 0 };
  let both = 0,
    twoGuns = 0,
    noGun = 0;
  for (let i = 0; i < 3000; i++) {
    hand(S, i % (D.MAX_ITEMS + 1));
    S.t = t;
    const c = SIM.cardOptions(S),
      p = S.p,
      held = (id) => p.items.find((j) => j.id === id),
      count = (ok) =>
        (p.main.lvl < 5 && ok({ ty: 'main', id: p.main.id }) ? 1 : 0) +
        p.items.filter((j) => j.lvl < D.ITEMS[j.id].st.length && ok({ ty: 'up', id: j.id })).length +
        (p.items.length < D.MAX_ITEMS ? pool.filter((id) => !held(id) && ok({ ty: 'new', id })).length : 0);
    const left = count(() => true);
    assert.equal(
      c.length,
      left ? Math.min(3, left) : 2,
      'three cards, or as many as are left (none: the medkit and the coins)',
    );
    assert.equal(new Set(c.map((x) => x.ty + x.id)).size, c.length, 'no card twice');
    const guns = c.filter(isGun).length;
    if (t < 300) {
      if (count(isGun)) assert.ok(guns >= 1, `t ${t}: a gun card: ` + JSON.stringify(c));
      if (count(passive)) assert.ok(c.some(passive), `t ${t}: a passive card: ` + JSON.stringify(c));
    }
    if (count(isGun) >= 2 && count(passive) >= 2) {
      both++;
      if (guns === 2) twoGuns++;
      if (!guns) noGun++;
    }
    first[isGun(c[0]) ? 'gun' : 'other']++;
  }
  assert.ok(
    first.gun > 600 && first.other > 600,
    `t ${t}: the gun card isn't always in one place: ` + JSON.stringify(first),
  );
  assert.ok(both > 1000, `t ${t}: enough hands with both kinds to deal (${both})`);
  return { two: twoGuns / both, noGun };
}

test('a level up before 2 minutes: a gun and a passive, the third a gun 70 % of the time', () => {
  const r = deal(30, 11);
  assert.ok(r.two > 0.65 && r.two < 0.75, 'two guns in ' + (r.two * 100).toFixed(1) + ' %');
  assert.equal(r.noGun, 0);
});

test('a level up from 2 to 5 minutes: a gun and a passive, the third a gun half the time', () => {
  const r = deal(200, 15);
  assert.ok(r.two > 0.45 && r.two < 0.55, 'two guns in ' + (r.two * 100).toFixed(1) + ' %');
  assert.equal(r.noGun, 0);
});

test('a level up after 5 minutes: any three, now and then no gun at all', () => {
  const r = deal(400, 16);
  assert.ok(r.noGun > 50, 'deals with no gun: ' + r.noGun);
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
  // the cursor still at each spot round him for half a second: the aim settles (it may stay put, never keeps turning) — with
  // every gun (REV 34: each held at its own height, its muzzle swinging round him on its own circle), out past the aim's blend
  for (const gun of ['pistol', 'shotgun', 'smg', 'minigun', 'sniper', 'rocket', 'flame']) {
    p.main.id = gun;
    const mid = SIM.muzzleZ(S) * 0.7;
    for (let r = 0; r <= 120; r += 6)
      for (let a = 0; a < 6.28; a += 0.5) {
        // (the cursor held on one spot of the world: the camera still easing back from the last spot leaves it where it is)
        const wx = p.x + r * Math.cos(a),
          wy = p.y - mid + r * Math.sin(a),
          inp = () => ({ mx: (wx - p.cam[0]) * z, my: (wy - p.cam[1]) * z, fire: false });
        for (let i = 0; i < 60; i++) step(inp());
        const a0 = p.aim;
        for (let i = 0; i < 12; i++) step(inp());
        assert.ok(
          Math.abs(p.aim - a0) < 0.05,
          `${gun} r ${r} a ${a.toFixed(1)}: the aim moved ${(p.aim - a0).toFixed(2)} with the cursor still`,
        );
      }
  }
});
