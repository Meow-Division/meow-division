// gen/balrun.cjs — one run played headless by the balance bot (gen/balbot.cjs), measured: when it ended and why, the hero's health and
// the damage taken in every 30 s of it (and where that damage came from), the crowd, kills and level, each boss's fight (how long it
// lived, what it took off the hero), the build the bot ended with. playRun({ weapon, meta, wup, rank, seed, rs, skill, botSeed })
const LIVE = process.env.ZH_LIVE || require('node:path').join(__dirname, '..', 'live'); // (ZH_LIVE: another copy of the rules, for an A/B)
const SIM = require(LIVE + '/sim.js'),
  D = require(LIVE + '/data.js'),
  { makeBot, randomTaste, rngOf } = require('./balbot.cjs');
const YK = SIM.YK,
  BIN = 30,
  NB = Math.ceil(D.RUN_LENGTH / BIN) + 2;
const gd = (dx, dy) => Math.sqrt(dx * dx + YK * YK * dy * dy);

// where a hit the hero just took came from, judged by what was round him at that moment
function sourceOf(S) {
  const p = S.p;
  let best = null,
    bd = 1e9;
  for (const e of S.en) {
    if (e.dead) continue;
    const d = gd(p.x - e.x, p.y - e.y) - e.r;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (best && bd < 30) {
    const d = D.ENEMIES[best.k];
    return d.boss ? best.k : best.elite ? 'elite ' + best.k : best.k;
  }
  for (const q of S.pud) if (gd(p.x - q.x, p.y - q.y) < q.r) return q.k === 'spore' ? 'spores' : 'acid puddle';
  const boss = S.en.find((e) => !e.dead && D.ENEMIES[e.k].boss);
  if (boss) return boss.k + ' attack';
  return S.ev.some((v) => v.t === S.t && (v.k === 'boom' || v.k === 'blast')) ? 'blast' : 'blast';
}

function playRun(o = {}) {
  const S = SIM.create({
    weapon: o.weapon || 'pistol',
    meta: o.meta,
    wup: o.wup,
    rank: o.rank ?? 1,
    seed: o.seed ?? 7,
    rs: o.rs ?? 1,
  });
  const rng = rngOf(o.botSeed ?? o.rs ?? 1),
    taste = o.taste || randomTaste(rng);
  const bot = makeBot({ skill: o.skill || 'avg', rng, taste });
  const bins = Array.from({ length: NB }, () => ({ dmg: 0, minHp: 1, alive: 0, n: 0, kills: 0, lvl: 0 }));
  const src = {},
    bosses = {},
    picks = [];
  // revive: a death is written down (deaths: when, from what) and the hero gets up again with full health, so the rest of the run is
  // measured too; the run's outcome (what the account is paid) is the one at the first death, as for a player
  let lastHurt = null,
    cap = o.cap ?? D.RUN_LENGTH + 90,
    first = null;
  const deaths = [];
  for (;;) {
    if (S.over && !S.over.win && o.revive && S.t < cap) {
      deaths.push({ t: +S.t.toFixed(1), cause: o.last || '?' });
      if (!first) first = Object.assign({ bk: S.bk || 0 }, S.over);
      S.over = null;
      S.p.dead = false;
      S.p.hp = S.p.maxHp;
      S.p.ifr = 2;
    }
    if (S.over || S.t >= cap) break;
    const inp = bot(S);
    if (S.pause && S.pause.k === 'lv' && inp.pick >= 0) picks.push(S.pause.cards[inp.pick]);
    const hp0 = S.p.hp,
      n0 = S.ev.length;
    SIM.step(S, inp);
    // damage taken (the sim emits 'hurt' with the amount)
    for (let i = Math.max(0, S.ev.length - (S.ev.length - n0 + 2)); i < S.ev.length; i++) {
      const v = S.ev[i];
      if (v.k === 'hurt' && v.t === S.t && v !== lastHurt) {
        lastHurt = v;
        const b = bins[Math.min(NB - 1, Math.floor(S.t / BIN))],
          s = sourceOf(S);
        b.dmg += v.v / S.p.maxHp;
        src[s] = (src[s] || 0) + v.v;
        o.last = s;
      }
    }
    if ((S.steps & 15) === 0) {
      const b = bins[Math.min(NB - 1, Math.floor(S.t / BIN))];
      b.alive += S.en.length;
      b.n++;
      b.minHp = Math.min(b.minHp, S.p.hp / S.p.maxHp);
      b.lvl = S.p.lvl;
      b.kills = S.kills;
    }
    // the bosses: when each showed up and fell, and the damage taken while it lived
    for (const e of S.en) {
      const d = D.ENEMIES[e.k];
      if (!d.boss) continue;
      const B = bosses[e.k] || (bosses[e.k] = { at: S.t, hp: e.max, dmg: 0, end: null });
      if (e.dead && B.end === null) B.end = S.t;
    }
    for (const k in bosses) {
      const B = bosses[k];
      if (B.end === null) {
        if (!S.en.some((e) => e.k === k && !e.dead)) B.end = S.t;
        else B.dmg += Math.max(0, hp0 - S.p.hp) / S.p.maxHp;
      }
    }
  }
  let kp = 0;
  for (const b of bins) {
    if (b.n) {
      b.alive = Math.round(b.alive / b.n);
    }
    const k = b.kills;
    b.kills = Math.max(0, k - kp);
    kp = Math.max(kp, k);
  }
  if (!o.revive && S.p.dead) deaths.push({ t: +S.t.toFixed(1), cause: o.last || '?' });
  const end = S.over,
    win = !!(end && end.win) && !first,
    fin = first || end,
    t = fin ? fin.t : S.t;
  return {
    weapon: S.p.main.id,
    rank: S.rank,
    seed: S.seed,
    rs: S.rs,
    skill: o.skill || 'avg',
    win,
    dead: deaths.length > 0,
    t: +t.toFixed(1),
    kills: S.kills,
    lvl: S.p.lvl,
    coins: S.coins,
    bk: S.bk || 0,
    cause: deaths.length ? deaths[0].cause : null,
    deaths,
    end: +S.t.toFixed(1),
    won: !!(end && end.win),
    wonT: end && end.win ? +end.t.toFixed(1) : null,
    hp: +(S.p.hp / S.p.maxHp).toFixed(3),
    bins: bins.map((b) => ({
      dmg: +b.dmg.toFixed(3),
      minHp: +b.minHp.toFixed(3),
      alive: b.alive,
      kills: b.kills,
      lvl: b.lvl,
    })),
    src,
    bosses: Object.fromEntries(
      Object.entries(bosses).map(([k, B]) => [
        k,
        { at: Math.round(B.at), ttk: B.end !== null ? +(B.end - B.at).toFixed(1) : null, dmg: +B.dmg.toFixed(3) },
      ]),
    ),
    items: S.p.items.map((i) => i.id + i.lvl + (i.evo ? '*' : '')),
    mainLvl: S.p.main.lvl,
    mainEvo: !!S.p.main.evo,
    outcome: {
      t,
      kills: fin ? fin.kills : S.kills,
      bk: first ? first.bk : S.bk || 0,
      win,
      lvl: fin ? fin.lvl : S.p.lvl,
      coins: fin ? fin.coins : S.coins,
      gun: S.p.main.id,
    },
  };
}
module.exports = { playRun, BIN };

if (require.main === module) {
  const [weapon = 'pistol', rank = '1', skill = 'avg', rs = '1', full] = process.argv.slice(2);
  const meta = full ? { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 3 } : undefined,
    wup = full ? { dmg: 5, rate: 5, mag: 5 } : undefined;
  const t0 = Date.now(),
    r = playRun({ weapon, rank: +rank, skill, rs: +rs, meta, wup, revive: true });
  delete r.bins;
  delete r.src;
  delete r.outcome;
  console.log(JSON.stringify(r), ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
