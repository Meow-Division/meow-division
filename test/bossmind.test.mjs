// The final bosses' aim (REV 45: where the hero stands, no lead) and what they learn between runs (REV 30): live/sim.js
// aimAt/throwAt, MIND, SIM.fight
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js');

const YK = 2;
// a run at its final boss: the boss in (his intro over), the hero near him, steps on with inp(S, b) as the input
function atBoss(k, mind, at = 520) {
  const S = SIM.create({ seed: k === 'heart' ? 101 : 7, rs: 4242, weapon: 'pistol', mind });
  S.hush = 0; // (the run's opening hush off: the hero here may stand still)
  S.t = 540;
  SIM.cheat(S, 'boss:' + k);
  const b = S.en.find((e) => e.id === S.boss);
  if (k === 'heart') SIM.cheat(S, 'near');
  else {
    S.p.x = b.x - at;
    S.p.y = b.y;
  }
  return { S, b };
}
function run(S, b, secs, inp = () => ({}), each = () => {}) {
  for (let i = 0; i < secs * 120 && !S.over && !b.dead; i++) {
    S.p.hp = 1e5; // (the hero never falls: what hits him is counted all the same)
    const q = inp(S, b);
    if (S.pause) q.pick = 0;
    SIM.step(S, q);
    each(S, b, i);
  }
}
// a hero going round the boss at about r px (screen), clockwise
const circle = (r) => (S, b) => {
  const dx = S.p.x - b.x,
    dy = (S.p.y - b.y) * YK,
    d = Math.sqrt(dx * dx + dy * dy) || 1,
    out = (r - d) / r;
  return { jx: -dy / d + (dx / d) * out, jy: (dx / d + (dy / d) * out) / YK };
};
// the boss's volleys after `after` s: the first mark, where the hero stood as it was thrown, and the rest
function volleys(k, mind, pace, secs, after) {
  const { S, b } = atBoss(k, mind);
  const out = [];
  let n0 = 0;
  run(S, b, secs, circle(420), (S, b, i) => {
    if (pace && b.st !== 'intro') b.hp = Math.max(1, b.hp - b.max / (pace * 120));
    const rocks = S.eb.filter((e) => e.k === 'rock');
    if (rocks.length > n0 && i / 120 > after) {
      const r = rocks[n0];
      out.push({ at: [r.x1, r.y1], hero: { x: S.p.x, y: S.p.y }, rest: rocks.slice(n0 + 1) });
    }
    n0 = rocks.length;
  });
  return { out, S, b };
}
const off = (a, o) => Math.hypot(a[0] - o.x, (a[1] - o.y) * YK);

test('a final boss throws at the hero where he stands, however fast he goes down; the rest evenly round it, wider', () => {
  for (const k of ['golem', 'heart']) {
    const mind = k === 'heart' ? { k, tac: ['rush'] } : null; // (the heart throws only once his core is out)
    const [sp0, sp1] = k === 'heart' ? SIM.HEART.core.spread : SIM.LUMP;
    for (const pace of [20, 100]) {
      const { out } = volleys(k, mind, pace, k === 'heart' ? 30 : 16, k === 'heart' ? 6 : 4);
      assert.ok(out.length, k + ': volleys thrown');
      for (const v of out) {
        // (the hero ran a step or two on after the throw; the old lead put it ~180 px ahead)
        assert.ok(
          off(v.at, v.hero) < 16,
          `${k} at ${pace} s: the mark where he stands (${off(v.at, v.hero).toFixed(1)} px off)`,
        );
        const c = { x: v.at[0], y: v.at[1] },
          an = v.rest.map((r) => Math.atan2((r.y1 - c.y) * YK, r.x1 - c.x)).sort((a, b) => a - b);
        for (const r of v.rest) {
          const d = off([r.x1, r.y1], c);
          assert.ok(d >= sp0 - 1 && d <= sp1 + 1, `${k}: a mark ${d.toFixed(0)} px round the first`);
        }
        if (an.length > 1) {
          let gap = 2 * Math.PI - (an[an.length - 1] - an[0]);
          for (let i = 1; i < an.length; i++) gap = Math.max(gap, an[i] - an[i - 1]);
          assert.ok(
            gap <= (2 * Math.PI) / an.length + 0.71,
            `${k}: no side left open (the widest gap ${gap.toFixed(2)} rad)`,
          );
        }
      }
    }
  }
  assert.ok(SIM.LUMP[0] >= 90 && SIM.LUMP[1] >= 270, "the golem's lumps spread wider than 60..200");
  assert.equal(SIM.SHARP, undefined, 'no aim ahead any more');
});

test('the fight is written down for the server: how long, which way the hero went, what hit him', () => {
  const { S, b } = atBoss('golem', null, 260);
  run(
    S,
    b,
    14,
    (S, b) => ({ jx: S.t % 4 < 3 ? -1 : 1, jy: 0 }),
    (S, b) => {
      if (b.st !== 'intro') b.hp -= b.max / (40 * 120);
    },
  );
  SIM.kill(S, b, null);
  const f = SIM.fight(S);
  assert.equal(f.k, 'golem');
  assert.equal(f.won, 1);
  assert.equal(f.hp, 0);
  assert.ok(f.dur > 11 && f.dur < 14, 'from his first wound: ' + f.dur);
  assert.ok(f.left > f.right * 1.5, `the hero went left most of the time (${f.left} % vs ${f.right} %)`);
  assert.ok(f.hits > 0 && f.hurt > 0, 'the hits taken counted');
  assert.ok(
    Math.abs(f.hurt - (f.by.wave + f.by.lump + f.by.pud + f.by.touch + f.by.adds)) <= 2,
    'each hit by what dealt it (rounded)',
  );
  assert.equal(f.gun, 'pistol');
  assert.deepEqual(f.mind, []);
  const g = JSON.stringify(f);
  run(S, b, 2);
  assert.equal(JSON.stringify(SIM.fight(S)), g, 'nothing more counted once he fell');
  assert.equal(SIM.fight(SIM.create({ seed: 7 })), null, 'no fight: null');
});

test("a ticket's mind is taken only as far as it is his: known tactics, two at most, a side of -1, 0 or 1", () => {
  const m = (mind) => SIM.create({ seed: 7, mind }).mind;
  assert.deepEqual(m({ k: 'golem', tac: ['bogus', 'lead', 'keep', 'keep', 'rush'], side: -1 }), {
    k: 'golem',
    tac: ['keep', 'rush'],
    side: -1,
  });
  assert.deepEqual(m({ k: 'heart', tac: ['keep', 'rings'], side: 5 }), { k: 'heart', tac: ['rings'], side: 0 });
  for (const bad of [
    null,
    'lead',
    { k: 'tank', tac: ['rings'] },
    { k: 'golem', tac: 'rings' },
    { k: 'golem', tac: ['lead', 'flank'] }, // (REV 45: no aim ahead, no flank)
    { k: 'golem', tac: ['constructor', '__proto__'] },
  ])
    assert.equal(m(bad), null);
});

test('Nova says what he learnt as the fight begins, only when he learnt something', () => {
  const said = (mind) => {
    const { S, b } = atBoss('golem', mind);
    let n = 0;
    run(
      S,
      b,
      3,
      () => ({}),
      (S) => (n = S.ev.filter((e) => e.k === 'voice' && e.id === 'nova.mind').length),
    );
    return n;
  };
  assert.equal(said({ k: 'golem', tac: ['rush'] }), 1);
  assert.equal(said(null), 0);
  assert.equal(said({ k: 'heart', tac: ['rush'] }), 0, "the other boss's mind: not his");
});

test('rings, keep, adds, rush: what each one changes in the golem and the heart', () => {
  // golem rings: he stamps at a hero close by before his rage
  const stomps = (mind) => {
    const { S, b } = atBoss('golem', mind, 200);
    let n = 0;
    run(
      S,
      b,
      8,
      () => ({}),
      (S, b) => (n += b.st === 'stompw' && b.stT === S.t ? 1 : 0),
    );
    return n;
  };
  assert.ok(stomps({ k: 'golem', tac: ['rings'] }) > 0, 'rings: the golem stamps');
  assert.equal(stomps(null), 0, 'without: not before his rage');
  // golem keep: a hero close and he backs off
  {
    const { S, b } = atBoss('golem', { k: 'golem', tac: ['keep'] }, 300);
    let away = 0,
      n = 0;
    run(
      S,
      b,
      4,
      () => ({}),
      (S, b) => {
        if (b.st !== 'chase') return;
        n++;
        if (b.vx * (b.x - S.p.x) > 0) away++;
      },
    );
    assert.ok(n > 100 && away / n > 0.8, `keep: he moves away from a hero close by (${away} of ${n} steps)`);
  }
  // golem adds: his zombies come with two more
  const crawl = (mind) => {
    const { S, b } = atBoss('golem', mind);
    let first = 0;
    const n0 = S.en.length,
      t0 = b.sumT;
    run(
      S,
      b,
      8,
      () => ({}),
      (S, b) => {
        if (!first && b.sumT !== t0) first = S.en.length - n0;
      },
    );
    return first;
  };
  assert.equal(crawl({ k: 'golem', tac: ['adds'] }) - crawl(null), SIM.MIND.adds.n, 'adds: two more zombies a time');
  // golem rush: phase 2 at 80 % of his health
  const phase = (k, mind, hp) => {
    const { S, b } = atBoss(k, mind);
    run(S, b, 2);
    b.hp = b.max * hp;
    run(S, b, 0.1);
    return b.phase;
  };
  assert.equal(phase('golem', { k: 'golem', tac: ['rush'] }, 0.75), 2, 'rush: the golem in his phase 2 at 75 %');
  assert.equal(phase('golem', null, 0.75), 1);
  assert.equal(phase('heart', { k: 'heart', tac: ['rush'] }, 0.7), 2, "rush: the heart's core at 70 %");
  assert.equal(phase('heart', null, 0.7), 1);
  // heart rings: his wave every 3 s
  const gap = (mind) => {
    const { S, b } = atBoss('heart', mind);
    let g = 0;
    run(
      S,
      b,
      6,
      () => ({}),
      (S, b) => {
        if (!g && b.st === 'smash') g = b.next - S.t;
      },
    );
    return g;
  };
  assert.equal(gap({ k: 'heart', tac: ['rings'] }), SIM.MIND.rings.gap, "rings: the heart's wave every 3 s");
  assert.equal(gap(null), SIM.HEART.wave.gap);
  // heart adds: zombies of his own
  const calls = (mind) => {
    const { S, b } = atBoss('heart', mind);
    let n = 0;
    run(
      S,
      b,
      7,
      () => ({}),
      (S) => (n = S.ev.filter((e) => e.k === 'summon').length),
    );
    return n;
  };
  assert.ok(calls({ k: 'heart', tac: ['adds'] }) >= 1, 'adds: the heart calls zombies');
  assert.equal(calls(null), 0);
});

// ---- the server's side (server/bossmind.mjs): the fights kept, the boss's pick after a win, the ticket's part
const { makeBossMind, bossOf } = await import('../server/bossmind.mjs');
const quiet = { warn() {}, log() {} };
const aiOf = (reply) => {
  const seen = [];
  return {
    seen,
    on: () => reply !== null,
    json: async (messages) => {
      seen.push(messages);
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(messages) : reply;
    },
  };
};
const won = (o = {}) => ({
  k: 'golem',
  dur: 30,
  won: 1,
  hp: 0,
  dist: 380,
  left: 60,
  right: 20,
  still: 5,
  hits: 4,
  hurt: 90,
  by: { wave: 20, lump: 50, pud: 20, touch: 0, adds: 0 },
  gun: 'shotgun',
  items: ['drone', 'saws'],
  mind: [],
  ...o,
});

test('a fight kept with the others; a win thought over, a loss forgotten; only a fight the replay could give', () => {
  const B = makeBossMind({ ai: aiOf(null), MIND: SIM.MIND, log: quiet }),
    rec = {};
  assert.equal(B.remember(rec, null), null);
  assert.equal(B.remember(rec, { k: 'tank', won: 1 }), null);
  const j = B.remember(
    rec,
    won({ gun: '<b>', items: ['drone', 'x y', 7], mind: ['rush', 'lead', 'bogus'], dur: 'fast' }),
  );
  assert.equal(j.k, 'golem');
  assert.equal(j.n, 1);
  const f = rec.boss.golem.fights[0];
  assert.equal(f.gun, '');
  assert.deepEqual(f.items, ['drone']);
  assert.deepEqual(f.mind, ['rush'], 'tactics it has (lead: gone, REV 45)');
  assert.equal(f.dur, 0);
  for (let i = 0; i < 6; i++) B.remember(rec, won({ dur: 40 + i }));
  assert.equal(rec.boss.golem.fights.length, 5, 'the last five kept');
  assert.equal(rec.boss.golem.fights[4].dur, 45);
  assert.ok(B.set(rec, { k: 'golem', n: rec.boss.golem.n }, { tac: ['rings'], side: 0, say: {} }));
  assert.equal(
    B.set(rec, { k: 'golem', n: 1 }, { tac: ['rush'] }),
    false,
    'a pick asked for before a newer fight: dropped',
  );
  assert.deepEqual(B.ticket(rec, 'suburb'), { k: 'golem', tac: ['rings'], side: 0 });
  // a pick kept from before REV 45 with lead or flank: those left out, Nova's words with them not said
  const old = {
    boss: {
      golem: {
        n: 1,
        fights: [],
        mind: { tac: ['lead', 'rush'], side: 1, say: { ru: 'Он бросит туда, куда ты бежишь.' } },
      },
    },
  };
  assert.deepEqual(B.ticket(old, 'suburb'), { k: 'golem', tac: ['rush'], side: 1 });
  assert.equal(B.say(old, 'suburb', 'ru'), null, "her plain line for what's left");
  old.boss.golem.mind.tac = ['lead', 'flank'];
  assert.equal(B.ticket(old, 'suburb'), null, 'nothing left: no mind');
  assert.equal(B.ticket(rec, 'lab'), null, "the lab's boss learnt nothing");
  assert.equal(B.remember(rec, won({ won: 0, hp: 40 })), null);
  assert.equal(rec.boss.golem.mind, undefined, 'the hero lost: the boss forgets');
  assert.equal(B.ticket(rec, 'suburb'), null);
  assert.equal(bossOf('lab'), 'heart');
  assert.equal(bossOf('office'), null);
  assert.equal(bossOf('suburb'), 'golem');
});

test("the plain rules' pick: a fast win two tactics, a slow one one; the side the hero dodges to", () => {
  const B = makeBossMind({ ai: aiOf(null), MIND: SIM.MIND, log: quiet });
  assert.deepEqual(B.rules('golem', [won()]), { tac: ['rush', 'rings'], side: -1 });
  assert.deepEqual(B.rules('golem', [won({ dur: 80, left: 30, right: 30, dist: 250 })]), {
    tac: ['keep'],
    side: 0,
  });
  assert.deepEqual(B.rules('heart', [won({ k: 'heart', dur: 90, left: 10, right: 50, dist: 600 })]), {
    tac: ['adds'],
    side: 1,
  });
  assert.deepEqual(B.rules('heart', [won({ k: 'heart', dur: 90, left: 30, right: 30, dist: 250 })]).tac, ['rings']);
  assert.equal(B.sideOf([won({ left: 20, right: 60 }), won({ left: 60, right: 20 })]), 0, 'two ways: no side');
});

test("NEAR AI's pick: only his tactics, as many as the win calls for; Nova's words kept per language when safe", async () => {
  const ai = aiOf({
    tac: ['keep', 'bogus', 'lead', 'rush', 'adds'],
    why: 'He ran circles round me.',
    say: {
      en: 'Copper, he remembers your circles. Watch his throws.',
      ru: 'Коппер, он запомнил твои круги. Следи за бросками.',
      uk: 'Коппер, він запам’ятав твої кола. Стеж за кидками.',
      es: 'Copper, he has 3 tricks now.', // (a digit, and English in the Spanish slot: dropped)
    },
  });
  const B = makeBossMind({ ai, MIND: SIM.MIND, names: { heart: 'THE DEVOURER' }, log: quiet });
  const m = await B.think('heart', [won({ k: 'heart' })]);
  assert.equal(m.by, 'ai');
  assert.deepEqual(m.tac, ['rush', 'adds'], 'keep is not the heart’s, lead no one’s (REV 45); two for a fast win');
  assert.equal(m.side, -1);
  assert.deepEqual(Object.keys(m.say).sort(), ['en', 'ru', 'uk']);
  const [sys, user] = ai.seen[0];
  assert.match(sys.content, /THE DEVOURER/);
  assert.match(user.content, /choose exactly 2/);
  assert.doesNotMatch(user.content, /^keep:/m, 'the menu: his tactics only');
  assert.doesNotMatch(user.content, /"at"/, 'no times sent');
  const rec = { boss: { heart: { n: 1, fights: [], mind: m } } };
  assert.equal(B.say(rec, 'lab', 'ru'), m.say.ru);
  assert.equal(B.say(rec, 'lab', 'es'), null, "no safe Spanish line: the page's plain one");
  // no lead, no flank on the menu (REV 45)
  const ai2 = aiOf({ tac: ['flank'] });
  const m2 = await makeBossMind({ ai: ai2, MIND: SIM.MIND, log: quiet }).think('golem', [
    won({ dur: 80, left: 30, right: 30 }),
  ]);
  assert.doesNotMatch(ai2.seen[0][1].content, /^(flank|lead):/m);
  assert.equal(m2.by, 'rules', 'nothing of the menu picked: the rules pick');
});

test('NEAR AI off or failing: the rules pick, Nova her plain line', async () => {
  for (const ai of [aiOf(null), aiOf(new Error('http 500'))]) {
    const m = await makeBossMind({ ai, MIND: SIM.MIND, log: quiet }).think('golem', [won()]);
    assert.equal(m.by, 'rules');
    assert.deepEqual(m.tac, ['rush', 'rings']);
    assert.deepEqual(m.say, {});
  }
});

test("a pick without Nova's words: her words asked for on their own", async () => {
  const ai = aiOf((messages) =>
    messages[1].content.startsWith('Your tactics')
      ? { tac: ['rush', 'rings'] }
      : { say: { en: 'Copper, he gets angry sooner. Keep moving.', ru: 'Коппер, он быстрее войдёт в ярость.' } },
  );
  const m = await makeBossMind({ ai, MIND: SIM.MIND, log: quiet }).think('golem', [won()]);
  assert.equal(ai.seen.length, 2);
  assert.match(ai.seen[1][1].content, /phases sooner/);
  assert.deepEqual(m.tac, ['rush', 'rings']);
  assert.deepEqual(Object.keys(m.say).sort(), ['en', 'ru']);
});
