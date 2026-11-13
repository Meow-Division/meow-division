// test/hush.test.mjs — the run's opening hush (REV 47, 2026-11-13: a start among the zombies, the lab's mission 3, cost half the
// health before the player had looked round) and a tall boss hit along its whole body (REV 47: shots through the Mushroom
// Monster's head and legs did nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  D = require('../live/data.js');

const still = { vw: SIM.VIEW.W, ax: 0, ay: 0 }; // (a phone's thumbs off the sticks: no walk, no shot — no auto aim either)
const steps = (S, n, inp) => {
  for (let i = 0; i < n; i++) SIM.step(S, inp);
};

test("the town's and the lab's runs open hushed: zombies stand and none come until the hero walks", () => {
  for (const seed of [7, SIM.LAB0 + 1]) {
    const S = SIM.create({ seed, rs: 11, weapon: 'pistol' });
    assert.equal(S.hush, 1, 'hushed at the start: ' + SIM.mapOf(seed));
    const e = SIM.addEnemy(S, 'walker', S.p.x + 40, S.p.y);
    e.spT = -9;
    const [x, y, n] = [e.x, e.y, S.en.length];
    steps(S, Math.round(4 / SIM.DT), still);
    assert.equal(S.hush, 1, 'still hushed while the hero stands');
    assert.deepEqual([e.x, e.y], [x, y], 'the zombie stood');
    assert.equal(S.p.hp, S.p.maxHp, 'no bite');
    assert.equal(S.en.length, n, 'no more came');
    SIM.step(S, { ...still, right: true });
    assert.equal(S.hush, 0, 'a step ends it');
    steps(S, Math.round(2 / SIM.DT), still);
    assert.ok(S.p.hp < S.p.maxHp, 'then it bites');
  }
});

test('a shot or a hurt zombie ends the hush too; the office and the base never hush', () => {
  const S = SIM.create({ seed: 7, rs: 12, weapon: 'pistol' });
  SIM.step(S, { ...still, fire: true });
  assert.equal(S.hush, 0, 'the fire button');
  const T = SIM.create({ seed: 7, rs: 13, weapon: 'pistol' });
  SIM.step(T, { ...still, ax: 0.9, ay: 0 });
  assert.equal(T.hush, 0, 'the aiming stick pushed');
  const U = SIM.create({ seed: 7, rs: 14, weapon: 'pistol' });
  const e = SIM.addEnemy(U, 'walker', U.p.x + 900, U.p.y);
  SIM.damage(U, e, 1);
  assert.equal(U.hush, 0, 'a zombie hurt');
  assert.ok(!SIM.create({ seed: SIM.OFFICE, rs: 1, mission: 'office' }).hush, 'the office');
  assert.ok(!SIM.create({ seed: SIM.BASE, rs: 1, hub: true }).hush, 'the base');
});

test('a tall boss takes a shot through its head or its legs, not one past its side', () => {
  const S = SIM.create({ seed: 7, rs: 15, weapon: 'pistol' });
  S.hush = 0;
  const b = SIM.addEnemy(S, 'golem', S.p.x + 600, S.p.y);
  b.spT = -9;
  const h = D.ENEMIES.golem.h;
  // a shot across the screen, drawn at the height dy over his feet: 200 px in one step from dx before his middle (z: its height over
  // the ground under it, as the main gun's)
  const z = 48,
    hit = (dy, dx) => {
      const hp = b.hp;
      S.bul.push({
        x: b.x + dx - 100,
        y: b.y + z - dy,
        px: 0,
        py: 0,
        vx: 200 / SIM.DT,
        vy: 0,
        z,
        dz: 0,
        r: 6,
        dmg: 10,
        kind: 0,
        knock: 0,
        pierce: 0,
        life: 1,
        hits: [],
        t0: S.t,
        o: 0,
      });
      SIM.updateBullets(S, SIM.level(S.seed));
      S.bul.length = 0;
      return b.hp < hp;
    };
  assert.ok(hit(h * 0.85, 0), 'his head');
  assert.ok(hit(h * 0.15, 0), 'his legs');
  assert.ok(hit(h * 0.45, 0), 'his middle');
  assert.ok(!hit(h * 0.45, -250), 'a shot that stops short of him');
  assert.ok(!hit(h * 1.25, 0), 'one over his head');
});
