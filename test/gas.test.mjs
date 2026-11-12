// test/gas.test.mjs — the lab's gas (live/sim.js GAS, REV 40): a safe circle round the hall's middle that closes in stages
// before the final boss, PUBG's zone made of gas. Its radius over the run's time, the hall clear of it at the end, the
// choking nil inside and growing with the depth outside, a hero caught deepest walking out alive, and two runs alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js');

const SEED = SIM.LAB0 + 1,
  BOSS = 540, // the final boss's time (sim.js BOSS_AT's last)
  { GAS } = SIM;
// a lab run with no zombies coming (calm), its clock set to t
function run(t) {
  const S = SIM.create({ seed: SEED, rs: 77 });
  S.calm = true;
  S.en.length = 0;
  S.t = t;
  return S;
}
const LV = () => SIM.level(SEED);
// a screen point d ground px from the gas's middle along the screen angle an (the ground metric: y counts twice)
const at = (d, an) => [LV().gas.x + Math.cos(an) * d, LV().gas.y + (Math.sin(an) * d) / 2];

test('the circle: past the far corners until the first stage, two stages down to the hall, a third into it', () => {
  const G = LV().gas,
    r = (t) => SIM.gasR(run(t), LV());
  assert.equal(G.rh, 1850, "the hall's circle: its corners (1800 ground px out) 50 inside");
  assert.equal(G.rf, 4490, "the far corners' (4440 out) 50 inside");
  const [s1, s2, s3] = GAS.stages,
    r1 = G.rh + (G.rf - G.rh) * s1[2],
    r3 = G.rh * s3[3];
  assert.equal(GAS.stages.length, 3);
  assert.equal(r(0), G.rf);
  assert.equal(r(BOSS + GAS.warn), G.rf, 'the warning: the circle still where it was');
  assert.equal(r(BOSS + s1[0]), G.rf);
  assert.ok(Math.abs(r(BOSS + (s1[0] + s1[1]) / 2) - (G.rf + r1) / 2) < 1e-9, 'stage 1 closes in evenly');
  assert.ok(Math.abs(r(BOSS + s1[1]) - r1) < 1e-9);
  assert.ok(r1 > G.rf * 0.45 && r1 < G.rf * 0.65, 'stage 1 stops at about half: ' + r1);
  assert.equal(r(BOSS + (s1[1] + s2[0]) / 2), r(BOSS + s1[1]), 'the pause: it holds');
  assert.ok(Math.abs(r(BOSS + s2[1]) - G.rh) < 1e-9, 'stage 2 ends at the hall');
  assert.ok(s2[1] < 0, 'and before the final boss comes');
  assert.equal(r(BOSS + s3[0]), G.rh, 'and stays there until the boss has come');
  assert.ok(s3[0] > 0, 'stage 3 once the boss is there');
  assert.ok(Math.abs(r(BOSS + s3[1]) - r3) < 1e-9, 'stage 3 ends inside the hall');
  assert.ok(Math.abs(r3 - G.rh * 0.6) < 1e-9, "0.6 of the hall's circle (REV 45): " + r3);
  assert.equal(r(BOSS + 200), r3, 'and stays there');
  for (let t = 0; t < BOSS + 60; t += 0.25) assert.ok(r(t + 0.25) <= r(t), 'never grows back: ' + t);
});

test('the zone as the HUD reads it: warning, moving, pause, held', () => {
  const ph = (t) => {
    const Z = SIM.gasZone(run(t), LV());
    return Z && Z.ph + ':' + Math.round(Z.left);
  };
  const [s1, s2, s3] = GAS.stages;
  assert.equal(ph(BOSS + GAS.warn - 1), null);
  assert.equal(ph(BOSS + GAS.warn), 'warn:' + (s1[0] - GAS.warn));
  assert.equal(ph(BOSS + s1[0] + 1), 'move:' + (s1[1] - s1[0] - 1));
  assert.equal(ph(BOSS + s1[1] + 1), 'wait:' + (s2[0] - s1[1] - 1));
  assert.equal(ph(BOSS + s2[0] + 1), 'move:' + (s2[1] - s2[0] - 1));
  assert.equal(ph(BOSS + s2[1] + 1), 'wait:' + (s3[0] - s2[1] - 1));
  assert.equal(ph(BOSS + s3[0] + 1), 'move:' + (s3[1] - s3[0] - 1));
  assert.equal(ph(BOSS + s3[1] + 1), 'held:0');
  const Z = SIM.gasZone(run(BOSS + GAS.warn), LV());
  assert.ok(Math.abs(Z.next - SIM.gasR(run(BOSS + s1[1]), LV())) < 1e-9, "the warning shows stage 1's stop");
  const demo = run(BOSS);
  demo.demo = true;
  assert.equal(SIM.gasZone(demo, LV()), null, 'none in the attract demo');
  assert.equal(SIM.gasZone(SIM.create({ seed: 3 }), SIM.level(3)), null, 'none in the town');
});

test('no gas anywhere in the hall as the boss comes; stage 3 then gasses its corners, its middle clear', () => {
  const S = run(BOSS + GAS.stages[2][0] - 1),
    [a, b, c, d] = LV().hall;
  for (let i = 0; i <= 20; i++)
    for (let j = 0; j <= 20; j++) {
      const [x, y] = SIM.toS(a + ((c - a) * i) / 20, b + ((d - b) * j) / 20);
      assert.equal(SIM.gasAt(S, LV(), x, y), 0, `the hall at ${i}/20, ${j}/20`);
    }
  // the far rooms are deep in it
  const [x, y] = SIM.toS(300, 300);
  assert.equal(SIM.gasAt(S, LV(), x, y), 1);
  const E = run(BOSS + GAS.stages[2][1] + 1),
    [hx, hy] = SIM.toS((a + c) / 2, (b + d) / 2),
    [cx, cy] = SIM.toS(a, b);
  assert.equal(SIM.gasAt(E, LV(), hx, hy), 0, "the hall's middle clear");
  assert.ok(SIM.gasAt(E, LV(), cx, cy) > 0, 'its corners in the gas');
});

test('the choking: nil inside, from GAS.k0 at the edge growing to all of it GAS.ramp px in', () => {
  const S = run(BOSS - 40),
    R = SIM.gasR(S, LV());
  for (const an of [0, 0.7, 2, 3.5, 5]) {
    let last = 0;
    for (let d = 0; d < R + 600; d += 10) {
      const g = SIM.gasAt(S, LV(), ...at(d, an));
      if (d < R + 1e-6) assert.equal(g, 0, `inside at ${d}`);
      else {
        assert.ok(g >= last && g >= GAS.k0 && g <= 1, `outside at ${d}: ${g}`);
        last = g;
      }
    }
    assert.ok(Math.abs(SIM.gasAt(S, LV(), ...at(R + GAS.ramp / 2, an)) - (GAS.k0 + 1) / 2) < 1e-6);
    assert.equal(SIM.gasAt(S, LV(), ...at(R + GAS.ramp + 1, an)), 1);
  }
  assert.equal(SIM.gasAt(run(BOSS + GAS.stages[0][0] - 1), LV(), ...at(4000, 1)), 0, 'none before the first stage');
});

test('in the sim: a hero outside chokes on every tick, deeper harder; inside, nothing', () => {
  const hpAfter = (d, secs) => {
    const S = run(BOSS - 40),
      [x, y] = at(SIM.gasR(S, LV()) + d, Math.PI);
    Object.assign(S.p, { x, y, hp: 1000, maxHp: 1000 });
    for (let i = 0; i < secs * 120; i++) {
      S.p.x = x;
      S.p.y = y;
      SIM.step(S, {});
    }
    return 1000 - S.p.hp;
  };
  assert.equal(hpAfter(-60, 3), 0, 'inside the circle');
  const edge = hpAfter(5, 3),
    deep = hpAfter(400, 3);
  assert.ok(edge > 0 && deep > edge, `at the edge ${edge}, deep ${deep}`);
  assert.ok(Math.abs(deep - 6 * SIM.GAS_DMG) < 1e-9, '6 ticks in 3 s at the full: ' + deep);
});

test('caught deepest, a hero walking to the hall lives', () => {
  // the far corner as stage 1 ends (the circle at its about-half, the corner floor ~1900 ground px out), the hero walking
  // straight in at 3/4 of his base speed while it holds and then closes again; a choke every GAS_TICK
  const S = run(BOSS + GAS.stages[0][1]),
    [cx, cy] = SIM.toS(200, 200),
    v = SIM.HERO_V * 0.75;
  let d = Math.sqrt((cx - LV().gas.x) ** 2 + 4 * (cy - LV().gas.y) ** 2),
    lost = 0;
  for (let k = 0; k < 400; k++) {
    const g = SIM.gasAt(S, LV(), ...at(d, -Math.PI / 2));
    if (!g) break;
    lost += SIM.GAS_DMG * g;
    S.t += SIM.GAS_TICK;
    d -= v * SIM.GAS_TICK;
  }
  assert.ok(lost > 40 && lost < 100, 'lost ' + lost.toFixed(1) + ' of 100 hp');
});

test('two runs alike: the same gas, the same choking', () => {
  const play = () => {
    const S = SIM.create({ seed: SEED, rs: 5 });
    S.calm = true;
    S.en.length = 0;
    S.t = BOSS - 85;
    const [x, y] = SIM.toS(400, 400);
    Object.assign(S.p, { x, y, hp: 10000, maxHp: 10000 });
    const hp = [];
    for (let i = 0; i < 70 * 120; i++) {
      SIM.step(S, { right: (i >> 9) & 1, down: (i >> 10) & 1 });
      if (i % 600 === 0) hp.push(S.p.hp);
    }
    return JSON.stringify([hp, S.p.x, S.p.y, S.p.hp, S.t]);
  };
  const a = play();
  assert.equal(play(), a);
  assert.ok(JSON.parse(a)[3] < 10000, 'it choked');
});
