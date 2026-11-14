// test/missions.test.mjs — mission 1 (live/missions.js 'office') played headless: a scripted pilot walks to wherever
// the task's arrow points (SIM.goal), takes the card screens' first card, says a talk is over at once (the page waits
// for the voice lines: ui.js talkDone), fights on autopilot aim; the tasks must come
// in the script's order and the run must be won the way a final boss's death wins it (then the pilot takes the
// Butcher's cleaver and leaves by the evac), and a replay of the recorded inputs must end in the same state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js'),
  MISSIONS = require('../live/missions.js');

// the pilot: toward the goal's point (stuck a second: sideways for a moment), else the attract bot's circling and
// dodging; it aims with the cursor and fires at the nearest zombie it may (aim)
function pilot(S, mem) {
  const g = SIM.goal(S),
    p = S.p;
  if (S.pause) return { pick: 0 };
  if (g && g.k === 'talk') return { pick: SIM.PICK.talk };
  // won: to the Butcher's cleaver and take it (then out by the evac: the attract bot's input asks for it)
  const cl = S.winAt && !S.ex && S.loot.find((o) => o.it === 't_butcher');
  if (cl) {
    if (SIM.lootNear(S, p).includes(cl)) return { pick: SIM.PICK.take };
    const [tx, ty] = near(S, [cl.x, cl.y], mem),
      dx = tx - p.x,
      dy = ty - p.y,
      d = Math.hypot(dx, dy) || 1;
    return { jx: dx / d, jy: dy / d };
  }
  const e = aim(S, g),
    shot = e ? { mx: (e.x - p.cam[0]) * (S.zoom || 1), my: (e.y - 40 - p.cam[1]) * (S.zoom || 1), fire: true } : {};
  if (!g || !g.at) return { ...SIM.scriptInput(S.t, S), ...shot };
  const [tx, ty] = waypoint(S, g.at, mem),
    dx = tx - p.x,
    dy = ty - p.y,
    d = Math.sqrt(dx * dx + dy * dy) || 1;
  // (on top of the one it hunts, both pressed into a corner: round about, to get a shot in)
  if (g.k === 'kill' && Math.hypot(g.at[0] - p.x, g.at[1] - p.y) < 60)
    return { jx: Math.cos(S.t * 2), jy: Math.sin(S.t * 2), ...shot };
  if (Math.abs(p.x - mem.x) + Math.abs(p.y - mem.y) > 30) Object.assign(mem, { x: p.x, y: p.y, t: S.t });
  const side = S.t - mem.t > 1 && S.t - mem.t < 1.8 ? 1 : 0;
  if (S.t - mem.t >= 1.8) mem.t = S.t;
  return { ...(side ? { jx: -dy / d, jy: dx / d } : { jx: dx / d, jy: dy / d }), ...shot };
}
// the last few steps to a point round the furniture (the nav grid's cells are wider than a desk): a search over the
// screen in 12 px steps, as far as the hero's own body fits (SIM.blockedAt), once per point; the next spot three
// steps on along it
function near(S, at, mem) {
  const st = 12,
    p = S.p,
    key = (x, y) => x * 4096 + y,
    tx = Math.round(at[0] / st),
    ty = Math.round(at[1] / st);
  if (!mem.fine || mem.fine.at !== at.join()) {
    const from = new Map(),
      x0 = Math.round(p.x / st),
      y0 = Math.round(p.y / st);
    from.set(key(x0, y0), null);
    let q = [[x0, y0]],
      end = null;
    while (q.length && !end && from.size < 60000) {
      const nq = [];
      for (const [x, y] of q)
        for (const [a, b] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const X = x + a,
            Y = y + b,
            k = key(X, Y);
          if (from.has(k) || SIM.blockedAt(S, X * st, Y * st, 12)) continue;
          from.set(k, [x, y]);
          if (Math.abs(X - tx) + Math.abs(Y - ty) <= 2) end = [X, Y];
          nq.push([X, Y]);
        }
      q = nq;
    }
    const path = [];
    for (let c = end; c; c = from.get(key(c[0], c[1]))) path.unshift([c[0] * st, c[1] * st]);
    mem.fine = { at: at.join(), path };
  }
  const path = mem.fine.path;
  if (!path.length) return at;
  let i = 0;
  for (let j = 0; j < path.length; j++)
    if (Math.hypot(path[j][0] - p.x, path[j][1] - p.y) < Math.hypot(path[i][0] - p.x, path[i][1] - p.y)) i = j;
  return path[Math.min(path.length - 1, i + 3)];
}
// the way to a point round walls, as a player walks it: the map's nav grid (the zombies' own: LV.navBlocked, 48
// ground units a cell), its steps counted back from the point's cell (once per point), and the next cell nearer it
// from the hero's; the point itself once the hero's cell is the point's or none is nearer
const NC = 48;
function waypoint(S, at, mem) {
  const LV = SIM.level(S.seed),
    B = LV.navBlocked,
    N = Math.ceil(LV.G / NC),
    cell = (x, y) => {
      const cx = Math.min(N - 1, Math.max(0, Math.floor(SIM.toGx(x, y) / NC))),
        cy = Math.min(N - 1, Math.max(0, Math.floor(SIM.toGy(x, y) / NC)));
      return cy * N + cx;
    },
    goal = cell(at[0], at[1]);
  if (!B) return at;
  if (mem.goal !== goal || mem.seed !== S.seed) {
    const dist = new Int32Array(N * N).fill(-1),
      q = [goal];
    dist[goal] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h],
        x = i % N,
        y = (i - x) / N;
      for (const [ax, ay] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + ax,
          ny = y + ay,
          j = ny * N + nx;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || dist[j] >= 0 || B[j]) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    Object.assign(mem, { goal, seed: S.seed, dist });
  }
  const here = cell(S.p.x, S.p.y),
    hx = here % N,
    hy = (here - hx) / N,
    d0 = mem.dist[here];
  if (d0 <= 0) return at;
  let best = -1,
    bd = d0;
  for (let ay = -1; ay <= 1; ay++)
    for (let ax = -1; ax <= 1; ax++) {
      const nx = hx + ax,
        ny = hy + ay,
        j = ny * N + nx;
      if ((!ax && !ay) || nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      // (a diagonal step only where both its sides are open: no cutting a wall's corner)
      if (ax && ay && (B[hy * N + nx] || B[ny * N + hx])) continue;
      if (mem.dist[j] >= 0 && mem.dist[j] < bd) {
        bd = mem.dist[j];
        best = j;
      }
    }
  if (best < 0) return at;
  const bx = best % N,
    by = (best - bx) / N;
  return SIM.toS(bx * NC + NC / 2, by * NC + NC / 2);
}
// the zombie the pilot shoots: the nearest within 650 not at its post, the parking lot's crowd only once its task is
// on and the bomb is gone (else nothing: the gun's own aim, ahead of the walk)
function aim(S, g) {
  const k = S.mis && S.mis.i >= 0 ? MISSIONS.office.tasks[S.mis.i] : null,
    guards = k && k.k === 'kill' && k.g === 'guards' && !(g && g.pk);
  let best = null,
    bd = 650 * 650;
  for (const e of S.en) {
    if (e.dead || e.post || (e.mg === 'guards' && !guards)) continue;
    const d = (e.x - S.p.x) ** 2 + ((e.y - S.p.y) * 2) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// the voice lines a run's events carry, each once (by the time it was said), in order
function hear(S, said, heard) {
  for (const e of S.ev)
    if (e.k === 'voice' && !heard.has(e.t + e.id)) {
      heard.add(e.t + e.id);
      said.push(e.id);
    }
}

// (screens: every card screen met, its kind and cards; at: what the run looked like as each task began; hook: called
// each step before it, false stops the run there, an object is the step's input instead of the pilot's)
function playOffice(rs, hook) {
  const S = SIM.create({ seed: SIM.OFFICE, rs, mission: 'office' });
  S.p.god = true;
  const rec = REPLAY.rec(),
    seen = [],
    said = [],
    heard = new Set(),
    screens = [],
    at = [],
    mem = { x: 0, y: 0, t: 0 };
  let P = null;
  for (let i = 0; i < 900 * 120 && !S.over; i++) {
    if (S.pause && S.pause !== P) screens.push({ k: S.pause.k, i: S.mis.i, cards: S.pause.cards || S.pause.items });
    P = S.pause;
    const h = hook ? hook(S) : undefined;
    if (h === false) break;
    const q = REPLAY.quant(h || pilot(S, mem));
    REPLAY.push(rec, q);
    SIM.step(S, q);
    if (S.mis && S.mis.i >= 0 && seen[seen.length - 1] !== S.mis.i) {
      seen.push(S.mis.i);
      at.push({ hp: S.p.hp / S.p.maxHp, items: S.p.items.map((it) => it.id), lvl: S.p.lvl });
    }
    hear(S, said, heard); // (each line once, as live/voice.js hears them)
  }
  return { S, rec, seen, said, screens, at };
}

test('mission 1 plays its tasks in order and is won', () => {
  const { S, rec, seen, said, screens, at } = playOffice(12345),
    tasks = MISSIONS.office.tasks,
    ti = (pred) => tasks.findIndex(pred);
  assert.deepEqual(
    seen,
    tasks.map((_, i) => i),
    'every task, in order',
  );
  assert.ok(S.over && S.over.win && S.over.evac, 'the run is won, and left by the evac');
  assert.deepEqual(RULES.outcome(S).bag, [['t_butcher', 1]], "the Butcher's cleaver, picked up where it fell");
  assert.equal(S.seed, SIM.OFFICE_IN, 'won inside: the door led into the other map');
  assert.equal(S.mis.won, 1);
  assert.ok(S.mis.got.includes('crate') && S.mis.got.includes('magnet') && S.mis.got.includes('medkit'));
  assert.ok(S.p.items.some((it) => it.id === 'armor') && S.p.main.lvl >= 4, 'the crate gave its gear');
  // every line the script says reaches the page as an event, in order, even two in one step (Copper's as Nova's talk
  // ends); the bomb taken: Nova's usual medkit line
  assert.deepEqual(said, [
    'nova.19',
    'copper.1',
    'nova.24',
    'nova.20',
    'nova.4',
    'nova.5',
    'nova.21',
    'nova.6',
    'nova.7',
    'nova.8',
    'nova.9',
    'nova.10',
    'copper.2',
    'nova.23',
    'nova.11',
    'nova.12',
  ]);
  // part A: the crate's screen, then one level up only, the script's (the drone to take, two shown locked), then
  // Nova's drop with the clover alone; no other card screen before the waves of part B
  const perk = ti((k) => k.k === 'perk'),
    hold = ti((k) => k.k === 'hold');
  const early = screens.filter((s) => s.i < hold);
  assert.deepEqual(
    early.map((s) => s.k),
    ['chest', 'lv', 'chest'],
    'the crate, the level up, the drop',
  );
  assert.equal(early[1].i, perk);
  assert.deepEqual(
    early[1].cards.map((c) => [c.id, !!c.lock]),
    [
      ['drone', false],
      ['chain', true],
      ['caliber', true],
    ],
  );
  assert.deepEqual(
    early[2].cards.map((c) => c.id),
    ['clover'],
  );
  assert.deepEqual(at[hold].items.sort(), ['armor', 'clover', 'drone', 'medkit'], 'the gear part A ends with');
  assert.equal(S.mis.dl, 1);
  // the blast's quiet share: the unhurt hero comes to the medkit 15 % down
  const med = ti((k) => k.n === 'medkit');
  assert.ok(Math.abs(at[med].hp - 0.85) < 0.01, 'hp at the medkit ' + at[med].hp);
  assert.equal(S.mis.hint.id, 'pair');
  const o = RULES.outcome(S);
  assert.equal(o.mission, 'office');
  assert.equal(o.win, true);
  // the same inputs played again (as the server does; the hero as unhurt as the pilot's) end where the page did
  const R = SIM.create({ seed: SIM.OFFICE, rs: 12345, mission: 'office' });
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
  assert.equal(REPLAY.play(SIM, { seed: SIM.OFFICE, rs: 1, mission: 'office' }, [], 1).mis.id, 'office');
});

// the first talk holds the hero still whatever is pressed until the page says its lines are over; the closed line in
// front of him holds until the crate is his
test("mission 1's first talk leaves the hero free (REV 39: no shade, not held); its closed line holds until the crate", () => {
  const S = SIM.create({ seed: SIM.OFFICE, rs: 7, mission: 'office' });
  SIM.step(S, {});
  assert.equal(SIM.goal(S).k, 'talk');
  assert.ok(!SIM.goal(S).dim, 'no shade');
  assert.equal(SIM.goal(S).keys, 1, 'how to walk shown');
  const x0 = S.p.x,
    y0 = S.p.y;
  for (let i = 0; i < 60; i++) SIM.step(S, { jx: 0, jy: 1 });
  assert.ok(Math.hypot(S.p.x - x0, S.p.y - y0) > 20, 'he walks while she talks');
  // (a talk that holds the heroes still exists: the inside's, while Copper speaks — test below)
  SIM.step(S, { pick: SIM.PICK.talk });
  const copper = S.ev.some((e) => e.k === 'voice' && e.id === 'copper.1');
  SIM.step(S, {});
  assert.ok(copper || S.ev.some((e) => e.k === 'voice' && e.id === 'copper.1'), 'Copper answers as the talk ends');
  assert.ok(!SIM.goal(S).dim, 'the shade gone as he answers');
  assert.equal(SIM.goal(S).key, 'task.crate');
  assert.equal(SIM.goal(S).k, 'take');
  assert.ok(S.mis.bar, 'the line is closed');
  // straight on past the line, the crate left lying: the line holds
  const [lx, ly] = [(S.mis.bar[0] + S.mis.bar[2]) / 2, (S.mis.bar[1] + S.mis.bar[3]) / 2],
    side = (p) =>
      Math.sign(
        (S.mis.bar[2] - S.mis.bar[0]) * (p.y - S.mis.bar[1]) - (S.mis.bar[3] - S.mis.bar[1]) * (p.x - S.mis.bar[0]),
      ),
    s0 = side(S.p);
  for (let i = 0; i < 8 * 120; i++) {
    const dx = lx - S.p.x,
      dy = ly - 200 - S.p.y,
      d = Math.hypot(dx, dy) || 1;
    SIM.step(S, { jx: dx / d, jy: dy / d });
  }
  assert.equal(side(S.p), s0, 'still on the start side');
  assert.equal(SIM.goal(S).k, 'take');
});

// from Nova's first words the tutorial can be skipped (the HUD's button; REV 39): what the outside would give — the
// crate's armour, medkit and gun levels, the drone and the clover, level 2 — straight inside
test('the tutorial is skipped from the start: straight inside with what it would give', () => {
  const plan = MISSIONS.office,
    inside = plan.tasks.findIndex((k) => k.id === 'inside');
  let asked = false;
  const { S } = playOffice(11, (S) => {
    if (asked) return false;
    if (S.mis.i < 0) return undefined;
    assert.equal(!!SIM.goal(S).skip, !S.pause, 'the skip is offered from the first task on');
    if (S.pause) return undefined;
    asked = true;
    return { pick: SIM.PICK.skip };
  });
  SIM.step(S, {});
  assert.ok(asked);
  assert.equal(S.seed, SIM.OFFICE_IN, 'inside');
  assert.equal(S.mis.i, inside);
  assert.deepEqual(S.p.items.map((it) => it.id).sort(), ['armor', 'clover', 'drone', 'medkit']);
  assert.ok(S.p.main.lvl >= 3, "the crate's gun levels");
  assert.equal(S.p.lvl, 2);
  assert.equal(S.mis.dl, 1, 'its card screen counted as dealt');
  assert.ok(!SIM.goal(S).skip, 'no skip inside');
});

// the parking lot's crowd shot down with the bomb left lying: Nova's other medkit line; the medkit comes from the last
// of them (none lies there before: one picked up in the fight would leave her line with nothing to pick up)
test('the parking lot cleared without the bomb: Nova says so', () => {
  const guards = MISSIONS.office.tasks.findIndex((k) => k.k === 'kill' && k.g === 'guards');
  let done = false,
    early = null;
  const { S, said } = playOffice(5, (S) => {
    if (S.mis.i === guards && !done) {
      const left = S.en.filter((e) => e.mg === 'guards' && !e.dead);
      for (const e of left.slice(1)) SIM.kill(S, e);
      early = S.pk.some((o) => o.n === 'medkit');
      SIM.kill(S, left[0]);
      assert.ok(
        S.pk.some((o) => o.n === 'medkit' && o.x === left[0].x && o.y === left[0].y),
        'the medkit where the last one fell',
      );
      done = true;
    }
    return S.mis.i > guards ? false : undefined;
  });
  assert.ok(done, 'the crowd killed');
  assert.equal(early, false, 'no medkit while one of them stands');
  assert.ok(!S.mis.got.includes('bomb'), 'the bomb left lying');
  assert.deepEqual(said.slice(-2), ['nova.6', 'nova.22'], said.join());
});

// on to the parking lot: the arrow on its middle (the crowd's mark), past the spot that counts; one of the crowd
// noticing the hero first counts as well
test("the parking lot's arrow points at its middle; its crowd noticing the hero counts", () => {
  const plan = MISSIONS.office.tasks,
    reach = plan.findIndex((k) => k.k === 'reach' && k.at === 'parking'),
    road = plan.findIndex((k) => k.id === 'road');
  let checked = 0;
  const { S } = playOffice(3, (S) => {
    if (S.mis.i === road || S.mis.i === reach) {
      const LV = SIM.level(S.seed),
        m = LV.marks.find((q) => q[0] === 'guards'),
        [x, y] = SIM.toS(m[1], m[2]),
        g = SIM.goal(S);
      assert.ok(Math.abs(g.at[0] - x) < 1 && Math.abs(g.at[1] - y) < 1, 'the arrow on the crowd: task ' + S.mis.i);
      checked |= S.mis.i === road ? 1 : 2;
    }
    if (S.mis.i === reach) {
      const e = S.en.find((o) => o.mg === 'guards' && !o.dead);
      e.post = 0; // (one of them sees him from afar)
      return {};
    }
    return S.mis.i > reach ? false : undefined;
  });
  assert.equal(checked, 3);
  assert.equal(S.mis.i, reach + 1, 'reached');
});

// inside the office (the skip leads there): the crowd is spread over the building (a third of it in sight, none on top
// of the hero, no pile), and nothing aims at it while Copper speaks (he stands still); as he ends Nova answers and he
// is free; the crowd waits for his first step
test('inside: the crowd is spread over the building and left be until the hero moves', () => {
  const plan = MISSIONS.office.tasks,
    road = plan.findIndex((k) => k.id === 'road'),
    inside = plan.findIndex((k) => k.id === 'inside');
  let asked = false;
  const { S } = playOffice(11, (S) => {
    if (S.mis.i === inside) return false;
    if (S.mis.i < road || S.pause || asked) return undefined;
    asked = true;
    return { pick: SIM.PICK.skip };
  });
  SIM.step(S, {});
  assert.equal(S.mis.i, inside);
  const hall = S.en.filter((e) => e.mg === 'hall' && !e.dead),
    far = (e) => Math.hypot(e.x - S.p.x, (e.y - S.p.y) * 2); // (the ground metric: a screen y counts twice)
  assert.equal(hall.length, 17);
  const sight = hall.filter((e) => Math.abs(e.x - S.p.x) < 960 && Math.abs(e.y - S.p.y) < 540).length;
  assert.ok(sight >= 3, 'some in sight: ' + sight);
  assert.ok(Math.min(...hall.map(far)) > 300, 'none on top of him: ' + Math.round(Math.min(...hall.map(far))));
  // no pile: each one's nearest neighbour well apart, on the whole
  const near = hall.map((e) =>
    Math.min(...hall.filter((o) => o !== e).map((o) => Math.hypot(o.x - e.x, (o.y - e.y) * 2))),
  );
  assert.ok(near.reduce((a, b) => a + b, 0) / near.length > 150, 'spread out: ' + near.map(Math.round).join());
  const x0 = S.p.x;
  for (let i = 0; i < 600; i++) SIM.step(S, { jx: 1, jy: 0, fire: true });
  assert.equal(S.p.x, x0, 'held while Copper speaks');
  assert.ok(
    hall.every((e) => !e.dead && e.hp === e.max && e.post),
    'nobody shot at them, nobody woke',
  );
  SIM.step(S, { pick: SIM.PICK.talk });
  assert.ok(
    S.ev.some((e) => e.k === 'voice' && e.id === 'nova.23'),
    'Nova answers as he ends',
  );
  for (let i = 0; i < 240; i++) SIM.step(S, {});
  assert.ok(
    hall.every((e) => e.post),
    'they wait while he stands',
  );
  for (let i = 0; i < 30; i++) SIM.step(S, { jx: 1, jy: 0 });
  assert.ok(
    hall.every((e) => !e.post),
    'his first steps wake them',
  );
});

test('inside, reached the long way through the door: the crowd stands on the inside map’s free floor', () => {
  const inside = MISSIONS.office.tasks.findIndex((k) => k.id === 'inside');
  for (const rs of [11, 3]) {
    const { S } = playOffice(rs, (S) => (S.mis.i === inside ? false : undefined));
    assert.equal(S.mis.i, inside, 'inside');
    assert.equal(S.seed, SIM.OFFICE_IN);
    const hall = S.en.filter((e) => e.mg === 'hall' && !e.dead),
      stuck = hall.filter((e) => SIM.blockedAt(S, e.x, e.y, 8));
    assert.equal(hall.length, 17);
    assert.equal(stuck.length, 0, rs + ': in walls or furniture: ' + stuck.length);
  }
});

test("a mission's locked cards can't be taken, nor its screen rerolled", () => {
  const S = SIM.create({ seed: SIM.OFFICE, rs: 3, mission: 'office' });
  SIM.step(S, {});
  S.mis.i = MISSIONS.office.tasks.findIndex((k) => k.k === 'perk') - 1; // (the magnet's task: the next one deals)
  S.mis.got.push('magnet');
  S.p.rerolls = 2;
  for (let i = 0; i < 4 && !S.pause; i++) SIM.step(S, {});
  assert.equal(S.pause && S.pause.k, 'lv');
  const cards = JSON.stringify(S.pause.cards);
  SIM.step(S, { pick: 1 });
  SIM.step(S, { pick: 2 });
  SIM.step(S, { pick: -2 });
  assert.ok(S.pause, 'still choosing');
  assert.equal(JSON.stringify(S.pause.cards), cards, 'the same cards');
  assert.equal(S.p.rerolls, 2, 'no reroll spent');
  SIM.step(S, { pick: 0 });
  assert.equal(S.pause, null);
  assert.deepEqual(
    S.p.items.map((it) => it.id),
    ['drone'],
  );
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
    // (the lab: the vaccine the Devourer drops is its goal — the pilot steps onto it and takes it)
    const vac = S.loot.find((o) => o.nm === 'antivirus');
    if (vac && !S.pause) {
      S.p.x = vac.x;
      S.p.y = vac.y;
    }
    SIM.step(S, REPLAY.quant(S.pause ? { pick: 0 } : vac ? { pick: SIM.PICK.take } : SIM.scriptInput(S.t, S)));
    hear(S, said, heard);
  }
  return { S, said };
}
test('missions 2 and 3 are won by the final boss of their map (the lab: then his vaccine taken)', () => {
  for (const [id, seed, lines, bosses] of [
    ['suburb', 8, ['nova.14', 'nova.16'], ['savage', 'pustule', 'screamer', 'golem']], // (REV 28: the Butcher is mission 1's)
    ['lab', 102, [], ['hazmat', 'subject', 'screamer', 'heart']], // (Nova's 17 sends him there from the base; REV 29: its own bosses)
  ]) {
    const { S, said } = playClassic(id, seed);
    assert.deepEqual(
      S.mis.gs.map((g) => g[0]),
      bosses,
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
  // (Walt and Nova where the base's own map seats them at their posts, or where HUB_NPC puts them if it has none;
  // mission 1's Walt in his alcove still)
  const npc = (seed) =>
    SIM.level(seed)
      .props.filter((o) => /^np_/.test(o.n))
      .map((o) => [o.n, o.gx, o.gy, o.flip ? 1 : 0]);
  const own = require('../live/map_base.js')
    .props.filter((q) => /^np_/.test(q[0]))
    .map((q) => [q[0], q[1], q[2], q[3] & 1]);
  assert.deepEqual(npc(SIM.BASE), own.length ? own : SIM.HUB_NPC);
  assert.deepEqual(
    npc(SIM.OFFICE_IN).map((q) => q[0]),
    ['np_walt'],
  );
  const x0 = S.p.x;
  for (let i = 0; i < 240; i++) SIM.step(S, { right: 1, fire: true, mx: 100, my: 100 });
  assert.equal(S.en.length, 0);
  assert.equal(S.p.xp, 0);
  assert.ok(S.p.x > x0 + 50, 'it walked');
  assert.ok(!S.ev.some((e) => e.k === 'shot'), 'no shots');
});

// every place a mission's script names is a mark on its map (the map editor sets them; a missing one would put the
// thing at the map's spawn), and the map file's checker holds marks to their shape
test('each mission finds its places as marks on its map', async () => {
  const ECONOMY = require('../live/economy.js'),
    files = {
      suburb: '../live/map.js',
      lab: '../live/map_lab.js',
      office: '../live/map_office.js',
      office_in: '../live/map_office_in.js',
    };
  for (const m of ECONOMY.MISSIONS)
    for (const mp of m.map === 'office' ? ['office', 'office_in'] : [m.map]) {
      const need = SIM.marksOf(m.id, m.map === 'office' ? mp : undefined);
      if (!need.length) continue;
      const map = require(files[mp]),
        have = (map.marks || []).map((q) => q[0]);
      for (const n of need) assert.ok(have.includes(n), m.id + ': no mark ' + n + ' on ' + mp);
    }
  assert.deepEqual(SIM.marksOf('office'), [
    'start',
    'line_a',
    'line_b',
    'crate',
    'horde',
    'guards',
    'parking',
    'bomb',
    'drop',
    'door',
  ]);
  assert.deepEqual(SIM.marksOf('office', 'office_in'), [], 'past its door: the inside map, entered at its spawn');
  assert.deepEqual(SIM.marksOf('suburb'), [], 'a classic mission names none');
  const { checkMap } = await import('../server/mapfile.mjs');
  const city = JSON.parse(JSON.stringify(require('../live/map.js')));
  assert.equal(checkMap(city), '');
  assert.equal(checkMap({ ...city, marks: undefined }), '', 'a map may have none');
  assert.equal(
    checkMap({
      ...city,
      marks: [
        ['crate', 1, 2],
        ['crate', 3, 4],
      ],
    }),
    'marks',
    'each name once',
  );
  assert.equal(checkMap({ ...city, marks: [['Crate', 1, 2]] }), 'marks', 'ids only');
  assert.equal(checkMap({ ...city, marks: [['crate', 1]] }), 'marks');
});
