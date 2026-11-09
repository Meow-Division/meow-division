// test/missions.test.mjs — mission 1 (live/missions.js 'office') played headless: a scripted pilot walks to wherever
// the task's arrow points (SIM.goal), takes the card screens' first card, fights on autopilot aim; the tasks must come
// in the script's order and the run must be won the way a final boss's death wins it, and a replay of the recorded
// inputs must end in the same state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js'),
  MISSIONS = require('../live/missions.js');

// the pilot: toward the goal's point (stuck a second: sideways for a moment), else the attract bot's circling and
// dodging
function pilot(S, mem) {
  const g = SIM.goal(S),
    p = S.p;
  if (S.pause) return { pick: 0 };
  if (!g || !g.at) return SIM.scriptInput(S.t, S);
  const dx = g.at[0] - p.x,
    dy = g.at[1] - p.y,
    d = Math.sqrt(dx * dx + dy * dy) || 1;
  if (Math.abs(p.x - mem.x) + Math.abs(p.y - mem.y) > 30) Object.assign(mem, { x: p.x, y: p.y, t: S.t });
  const side = S.t - mem.t > 1 && S.t - mem.t < 1.8 ? 1 : 0;
  if (S.t - mem.t >= 1.8) mem.t = S.t;
  return side ? { jx: -dy / d, jy: dx / d } : { jx: dx / d, jy: dy / d };
}

function playOffice(rs) {
  const S = SIM.create({ seed: 7, rs, mission: 'office' });
  S.p.god = true;
  const rec = REPLAY.rec(),
    seen = [],
    mem = { x: 0, y: 0, t: 0 };
  for (let i = 0; i < 900 * 120 && !S.over; i++) {
    const q = REPLAY.quant(pilot(S, mem));
    REPLAY.push(rec, q);
    SIM.step(S, q);
    if (S.mis && S.mis.i >= 0 && seen[seen.length - 1] !== S.mis.i) seen.push(S.mis.i);
  }
  return { S, rec, seen };
}

test('mission 1 plays its tasks in order and is won', () => {
  const { S, rec, seen } = playOffice(12345),
    tasks = MISSIONS.office.tasks;
  assert.deepEqual(
    seen,
    tasks.map((_, i) => i),
    'every task, in order',
  );
  assert.ok(S.over && S.over.win, 'the run is won');
  assert.equal(S.mis.won, 1);
  assert.ok(S.mis.got.includes('crate') && S.mis.got.includes('magnet') && S.mis.got.includes('medkit'));
  assert.ok(S.p.items.some((it) => it.id === 'armor') && S.p.main.lvl >= 4, 'the crate gave its gear');
  const o = RULES.outcome(S);
  assert.equal(o.mission, 'office');
  assert.equal(o.win, true);
  // the same inputs played again (as the server does; the hero as unhurt as the pilot's) end where the page did
  const R = SIM.create({ seed: 7, rs: 12345, mission: 'office' });
  R.p.god = true;
  try {
    REPLAY.each(JSON.parse(JSON.stringify(rec.log)), rec.n, (inp) => {
      if (R.over) throw REPLAY.END;
      SIM.step(R, inp);
    });
  } catch (e) {
    if (e !== REPLAY.END) throw e;
  }
  assert.equal(REPLAY.hash(R), REPLAY.hash(S));
  // and the server's replay makes its run from the ticket's mission (replay.js play)
  assert.equal(REPLAY.play(SIM, { seed: 7, rs: 1, mission: 'office' }, [], 1).mis.id, 'office');
});

test('a mission win pays its reward once; a classic run has no mission', () => {
  const save = RULES.defaults(),
    o = { t: 400, kills: 300, bk: 1, win: true, lvl: 12, coins: 50, gun: 'pistol', mission: 'office' };
  const g1 = RULES.bank(save, o),
    c1 = save.coins;
  assert.deepEqual(save.camp, ['office']);
  assert.ok(g1.mission && g1.mission.coins > 0);
  const g2 = RULES.bank(save, o);
  assert.equal(g2.mission, null, 'the second finish pays no reward');
  assert.equal(save.coins - c1, g2.coins);
  assert.equal(save.stats.fast, 0, 'a mission is no record of the fastest win');
  const S = SIM.create({ seed: 7, rs: 1 });
  assert.equal(S.mis, undefined);
  assert.equal(SIM.goal(S), null);
  assert.equal(RULES.outcome(S).mission, undefined);
});

test('NEAR Base: the hero walks, nothing else happens', () => {
  const S = SIM.create({ seed: SIM.BASE, hub: true });
  assert.equal(SIM.mapOf(SIM.BASE), 'base');
  const x0 = S.p.x;
  for (let i = 0; i < 240; i++) SIM.step(S, { right: 1, fire: true, mx: 100, my: 100 });
  assert.equal(S.en.length, 0);
  assert.equal(S.p.xp, 0);
  assert.ok(S.p.x > x0 + 50, 'it walked');
  assert.ok(!S.ev.some((e) => e.k === 'shot'), 'no shots');
});
