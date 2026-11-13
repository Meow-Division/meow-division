// test/fingers.test.mjs — the fingers the character editor bends (live/herobake.js bend: guns[g].aim.pawR / pawL f = [thumb, index,
// middle, ring, pinky, spread] degrees): only that paw's fingers move, toward the palm when bent, the gun and the other paw stay; nothing
// bent is the clip as baked before; the editor's server takes them only in that shape (server/herofile.mjs checkTune).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { checkTune } from '../server/herofile.mjs';

const require = createRequire(import.meta.url);
const HB = require('../live/herobake.js'),
  TUNE = require('../live/hero.js');
const I = HB.alias(JSON.parse(fs.readFileSync(new URL('../live/assets/c_cat.json', import.meta.url), 'utf8')));
const F = HB.fingersOf(I);
const at = (S, b) => {
  const h = I.head[b],
    o = b * 12;
  return [0, 1, 2].map(
    (r) => S[o + r * 4] * h[0] + S[o + r * 4 + 1] * h[1] + S[o + r * 4 + 2] * h[2] + S[o + r * 4 + 3],
  );
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const withF = (gun, s, f) => {
  const T = JSON.parse(JSON.stringify(TUNE)),
    q = ((T.guns[gun] = T.guns[gun] || {}).aim = T.guns[gun].aim || {});
  q[s] = { ...(q[s] || {}), f };
  return T;
};

test('the hero has five fingers of three joints on each paw', () => {
  for (const s of ['R', 'L']) {
    assert.equal(F[s].length, 5);
    assert.ok(F[s].every((ch) => ch.length === 3 && ch.every((b) => b >= 0)));
  }
  assert.match(I.bones[F.L[0][0]], /LeftHandThumb1$/);
  assert.match(I.bones[F.R[4][2]], /RightHandPinky3$/);
});

test('a bent finger moves alone: its own joints, that paw only, the gun where it was', () => {
  const a = HB.bake(I, TUNE, 'walk_phantom'),
    b = HB.bake(I, withF('phantom', 'pawL', [0, 50, 0, 0, 0, 0]), 'walk_phantom');
  for (let i = 0; i < 5; i++) {
    const moved = dist(at(a.m[3], F.L[i][2]), at(b.m[3], F.L[i][2]));
    if (i === 1) assert.ok(moved > 0.005, 'the index finger bent: ' + moved);
    else assert.ok(moved < 1e-6, HB.FINGERS[i] + ' stays');
  }
  assert.ok(dist(at(a.m[3], F.R[1][2]), at(b.m[3], F.R[1][2])) < 1e-9, 'the right paw stays');
  assert.deepEqual(a.g[3], b.g[3], 'the gun stays');
  // all zero: the clip as it was
  const z = HB.bake(I, withF('phantom', 'pawL', [0, 0, 0, 0, 0, 0]), 'walk_phantom');
  assert.ok(Array.from(z.m[3]).every((v, k) => Math.abs(v - a.m[3][k]) < 1e-6));
});

test('bending closes a finger toward the palm, straightening opens it; spread moves the outer fingers apart', () => {
  const S0 = HB.bake(I, TUNE, 'walk_phantom').m[0],
    curl = HB.bake(I, withF('phantom', 'pawR', [0, 0, 60, 0, 0, 0]), 'walk_phantom').m[0],
    open = HB.bake(I, withF('phantom', 'pawR', [0, 0, -30, 0, 0, 0]), 'walk_phantom').m[0];
  const m = F.R[2],
    tip = (S) => at(S, m[2]),
    root = at(S0, m[0]);
  // (the tip comes nearer the finger's root when it curls, and goes further when it straightens)
  assert.ok(dist(tip(curl), root) < dist(tip(S0), root), 'curled: nearer its root');
  assert.ok(dist(tip(open), root) >= dist(tip(S0), root) - 1e-6, 'straightened: no nearer');
  const sp = HB.bake(I, withF('phantom', 'pawR', [0, 0, 0, 0, 0, 25]), 'walk_phantom').m[0];
  // (their first bones' ends: a finger curled into a fist swings out at the knuckle, its tip curled back hardly moves)
  const gap = (S) => dist(at(S, F.R[1][1]), at(S, F.R[4][1])),
    shut = HB.bake(I, withF('phantom', 'pawR', [0, 0, 0, 0, 0, -15]), 'walk_phantom').m[0];
  assert.ok(gap(sp) > gap(S0) + 0.003, `spread: index and pinky apart ${gap(S0)} → ${gap(sp)}`);
  assert.ok(gap(shut) < gap(S0) - 0.002, `closed up: nearer ${gap(S0)} → ${gap(shut)}`);
});

test('the editor’s server takes fingers only as six numbers in range', () => {
  const ok = withF('phantom', 'pawL', [10, 20, 30, 40, 50, 5]);
  assert.equal(checkTune(ok), '');
  assert.notEqual(checkTune(withF('phantom', 'pawL', [10, 20, 30, 40, 50])), '');
  assert.notEqual(checkTune(withF('phantom', 'pawL', [10, 20, 30, 40, 500, 0])), '');
  assert.notEqual(checkTune(withF('phantom', 'pawL', 'fist')), '');
});
