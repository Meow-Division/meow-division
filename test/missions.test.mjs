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

// the voice lines a run's events carry, each once (by the time it was said), in order
function hear(S, said, heard) {
  for (const e of S.ev)
    if (e.k === 'voice' && !heard.has(e.t + e.id)) {
      heard.add(e.t + e.id);
      said.push(e.id);
    }
}

function playOffice(rs) {
  const S = SIM.create({ seed: 7, rs, mission: 'office' });
  S.p.god = true;
  const rec = REPLAY.rec(),
    seen = [],
    said = [],
    heard = new Set(),
    mem = { x: 0, y: 0, t: 0 };
  for (let i = 0; i < 900 * 120 && !S.over; i++) {
    const q = REPLAY.quant(pilot(S, mem));
    REPLAY.push(rec, q);
    SIM.step(S, q);
    if (S.mis && S.mis.i >= 0 && seen[seen.length - 1] !== S.mis.i) seen.push(S.mis.i);
    hear(S, said, heard); // (each line once, as live/voice.js hears them)
  }
  return { S, rec, seen, said };
}

test('mission 1 plays its tasks in order and is won', () => {
  const { S, rec, seen, said } = playOffice(12345),
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
  // every line the script says reaches the page as an event, in order, even two in one step (nova.2 and nova.3)
  assert.deepEqual(said, ['nova.2', 'nova.3', 'nova.4', 'nova.6', 'nova.7', 'nova.10', 'nova.11', 'nova.12']);
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

// missions 2 and 3 are classic runs with a script: the bosses come on their schedule, each one its group; the final
// one's death (here the dev cheat brings each boss at once and the test kills it) wins the mission
function playClassic(id, seed) {
  const S = SIM.create({ seed, rs: 5, mission: id });
  S.p.god = true;
  const said = [],
    heard = new Set();
  for (let i = 0; i < 30 * 120 && !S.over; i++) {
    if (i % 600 === 300 && !S.en.some((e) => e.mg && !e.dead)) SIM.cheat(S, 'boss');
    const boss = S.en.find((e) => e.mg && !e.dead && e.st !== 'intro' && S.t - e.spT > 1);
    if (boss) SIM.kill(S, boss);
    SIM.step(S, REPLAY.quant(S.pause ? { pick: 0 } : SIM.scriptInput(S.t, S)));
    hear(S, said, heard);
  }
  return { S, said };
}
test('missions 2 and 3 are won by the final boss of their map', () => {
  for (const [id, seed, lines] of [
    ['suburb', 8, ['nova.14', 'nova.16']],
    ['lab', 102, ['nova.17']],
  ]) {
    const { S, said } = playClassic(id, seed);
    assert.deepEqual(
      S.mis.gs.map((g) => g[0]),
      ['butcher', 'pustule', 'screamer', 'golem'],
      id + ': the bosses, each its group',
    );
    assert.ok(S.over && S.over.win && S.mis.won === 1, id + ': won');
    assert.deepEqual(said, lines, id + ': its lines');
    assert.equal(RULES.outcome(S).mission, id);
  }
});

test('only the current mission is played as one and pays its reward', () => {
  const save = RULES.defaults(),
    win = (mission) => ({ t: 600, kills: 900, bk: 4, win: true, lvl: 20, coins: 80, gun: 'pistol', mission });
  assert.equal(RULES.current(save), 'office');
  assert.equal(RULES.bank(save, win('lab')).mission, null, 'a later mission won out of turn pays nothing');
  assert.deepEqual(save.camp, []);
  RULES.bank(save, win('office'));
  assert.equal(RULES.current(save), 'suburb');
  RULES.bank(save, win('suburb'));
  RULES.bank(save, win('lab'));
  assert.deepEqual(save.camp, ['office', 'suburb', 'lab']);
  assert.equal(RULES.current(save), null, 'the rest are still to come');
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
