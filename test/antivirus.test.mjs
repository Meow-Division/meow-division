// test/antivirus.test.mjs — mission 3's end (live/missions.js lab): the Devourer dead, the vaccine lies where he fell (the
// 'loot' action, named antivirus); the task's arrow points at it; the mission isn't won until a hero takes it, then it is,
// and the screen says so (S.warn hud.misDone). Its reward no longer gives a vaccine of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  E = require('../live/economy.js');

test('the lab mission: the Devourer drops the vaccine, taking it wins the mission', () => {
  const S = SIM.create({ seed: SIM.LAB0 + 2, rs: 77, mission: 'lab' });
  S.p.god = true;
  // a step; a card screen (a level up, a chest) answered with its first card, as a player would
  const step = (inp = {}) => SIM.step(S, S.p.pause ? { pick: 0 } : inp);
  for (let i = 0; i < 60; i++) step();
  SIM.cheat(S, 'boss:heart');
  const b = S.en.find((e) => e.k === 'heart');
  assert.ok(b, 'the Devourer came');
  SIM.damage(S, b, b.hp + 1, 0, 0);
  for (let i = 0; i < 600 && !S.loot.some((o) => o.nm === 'antivirus'); i++) step(); // (the hit-stop of his death first)
  for (let i = 0; i < 30; i++) step();
  assert.ok(!S.mis.won, 'not won while the vaccine lies');
  const v = S.loot.find((o) => o.nm === 'antivirus');
  assert.ok(v && v.it === 'vaccine', 'the vaccine lies there');
  const g = SIM.goal(S);
  assert.equal(g.key, 'task.antivirus');
  assert.ok(g.at && Math.hypot(g.at[0] - v.x, g.at[1] - v.y) < 1, 'the arrow points at it');
  // the hero walks onto it and takes it
  for (let i = 0; i < 400 && !SIM.lootNear(S, S.p).includes(v); i++) {
    S.p.x += (v.x - S.p.x) * 0.2;
    S.p.y += (v.y - S.p.y) * 0.2;
    step();
  }
  const n0 = S.p.bag.filter((s) => s && s[0] === 'vaccine').reduce((a, s) => a + s[1], 0);
  step({ pick: SIM.PICK.take });
  for (let i = 0; i < 5; i++) step();
  assert.ok(S.mis.won, 'the mission is won');
  assert.equal(S.warn && S.warn.text, 'hud.misDone', 'the screen says so');
  const n1 = S.p.bag.filter((s) => s && s[0] === 'vaccine').reduce((a, s) => a + s[1], 0);
  assert.equal(n1, n0 + 1, 'one vaccine taken, none more from the reward');
  assert.ok(!E.mission('lab').reward.items.some(([id]) => id === 'vaccine'));
});
