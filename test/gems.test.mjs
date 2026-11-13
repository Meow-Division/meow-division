// test/gems.test.mjs — the XP gems (REV 43, 2026-11-12: at times the mobs dropped no crystals, the lab and the
// suburb). A kill always drops its gem where it died: with the ground full (450) the gem farthest from the heroes gives its
// XP to the new one and goes, none of it lost; a gem that comes down inside a wall or a car goes back where it fell from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  D = require('../live/data.js');

const total = (S) => S.gems.reduce((a, g) => a + g.v, 0);

test('a full ground: the kill still drops its gem where it died, the farthest one gives way, no XP lost', () => {
  const S = SIM.create({ seed: 8, rs: 77 });
  S.p.god = true;
  const { x, y } = S.p;
  // 450 gems lying round the hero, one of them far off
  S.gems.length = 0;
  for (let i = 0; i < 450; i++)
    S.gems.push({ x: x + 400 + (i % 30) * 5, y: y + 300, v: 1, m: 0, vx: 0, vy: 0, z: 0, vz: 0, t: 0 });
  S.gems[17].x = x + 5000;
  S.gems[17].v = 7;
  const xp0 = total(S);
  const e = SIM.addEnemy(S, 'walker', x + 200, y);
  SIM.kill(S, e);
  assert.equal(S.gems.length, 450, 'still at the cap');
  const g = S.gems[S.gems.length - 1];
  assert.equal(g.x, e.x, 'dropped where it died');
  assert.equal(g.y, e.y);
  assert.ok(!S.gems.some((q) => q.x === x + 5000), 'the farthest one went');
  assert.equal(total(S), xp0 + D.ENEMIES.walker.xp, 'its XP and the far one’s in the new gem');
});

test('a gem that lands inside a prop goes back where it fell from', () => {
  const S = SIM.create({ seed: 8, rs: 77 });
  S.p.god = true;
  const LV = SIM.level(S.seed),
    car = LV.props.find((o) => o.fw * o.fh > 150 * 60 && !o.hb),
    [cx, cy] = SIM.toS(car.gx, car.gy);
  assert.ok(SIM.blockedAt(S, cx, cy, 0), 'the prop stops the hero');
  S.en.length = 0;
  S.gems.length = 0;
  S.gems.push({ x: cx, y: cy, x0: S.p.x + 900, y0: S.p.y, v: 3, m: 0, vx: 0, vy: 0, z: 1, vz: -50, t: S.t });
  for (let i = 0; i < 10; i++) SIM.step(S, {});
  const g = S.gems[0];
  assert.ok(g, 'still there');
  assert.equal(g.x, g.x0, 'back at its own spot');
  assert.equal(g.y, g.y0);
  assert.ok(!SIM.blockedAt(S, g.x, g.y, 0));
});
