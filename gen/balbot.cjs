// gen/balbot.cjs — a bot that plays a run the way a careful player does, for the balance lab (gen/balance.cjs). Several times a second it
// tries 16 directions (and standing still) a fraction of a second ahead: how close the zombies would be (each weighed by its bite), the
// boss attacks it has seen coming (marks, rings, a charge's line, a jump's shadow, a lit bomber, puddles, acid in flight), walls and the
// map's edge; it walks toward gems, chests and (when hurt) medkits when that is safe. It aims with the game's own auto-aim, reloads on
// its own and picks level-up cards by a player's rules of thumb, each run with its own taste for the items (opt.taste) so the builds
// vary. skill: 'good' | 'avg' | 'weak' — how late it notices an attack and how carefully it keeps its distance.
const LIVE = process.env.ZH_LIVE || require('node:path').join(__dirname, '..', 'live'); // (ZH_LIVE: another copy of the rules, for an A/B)
const SIM = require(LIVE + '/sim.js'),
  D = require(LIVE + '/data.js');
const YK = SIM.YK,
  TAU = Math.PI * 2,
  NC = 48,
  NN = Math.ceil(SIM.G / NC);
const SKILL = {
  good: { react: 0.18, every: 6, keep: 1.15, greed: 1, noise: 0.05, aim: 0.04 },
  avg: { react: 0.3, every: 8, keep: 1, greed: 1.2, noise: 0.15, aim: 0.1 },
  weak: { react: 0.5, every: 14, keep: 0.8, greed: 1.5, noise: 0.3, aim: 0.2 },
};
const gd = (dx, dy) => Math.sqrt(dx * dx + YK * YK * dy * dy); // the sim's ground metric

// how far each walkable cell of the nav grid is from the nearest wall (cells): open ground is safer to kite on
const OPEN = new Map();
function openness(seed) {
  if (OPEN.has(seed)) return OPEN.get(seed);
  const LV = SIM.level(seed),
    B = LV.navBlocked,
    dist = new Int16Array(NN * NN).fill(99),
    q = [];
  for (let i = 0; i < NN * NN; i++)
    if (B[i]) {
      dist[i] = 0;
      q.push(i);
    }
  for (let cx = 0; cx < NN; cx++)
    for (const cy of [0, NN - 1]) {
      const i = cy * NN + cx;
      if (dist[i]) {
        dist[i] = 1;
        q.push(i);
      }
    }
  for (let cy = 0; cy < NN; cy++)
    for (const cx of [0, NN - 1]) {
      const i = cy * NN + cx;
      if (dist[i] > 1) {
        dist[i] = 1;
        q.push(i);
      }
    }
  for (let h = 0; h < q.length; h++) {
    const i = q[h],
      cx = i % NN,
      d = dist[i] + 1;
    for (const j of [cx > 0 ? i - 1 : -1, cx < NN - 1 ? i + 1 : -1, i - NN, i + NN])
      if (j >= 0 && j < NN * NN && dist[j] > d) {
        dist[j] = d;
        q.push(j);
      }
  }
  const o = { B, dist };
  OPEN.set(seed, o);
  return o;
}
const cellOf = (x, y) => {
  const gx = SIM.toGx(x, y),
    gy = SIM.toGy(x, y);
  if (gx < 0 || gy < 0 || gx >= SIM.G || gy >= SIM.G) return -1;
  return Math.floor(gy / NC) * NN + Math.floor(gx / NC);
};

// ---------- the level-up cards ----------
const WEAPONS = new Set(D.SUB_WEAPONS);
const PASSIVE_BASE = {
  caliber: 7,
  medkit: 6,
  armor: 6,
  boots: 5,
  magnet: 4,
  battery: 5,
  scope: 4,
  canister: 4,
  helmet: 5,
  fang: 4,
  bandolier: 4,
  clover: 3,
};
function cardScore(S, c, taste) {
  const p = S.p,
    has = (id) => p.items.find((i) => i.id === id),
    nW = p.items.filter((i) => WEAPONS.has(i.id)).length;
  if (c.ty === 'heal') return p.hp < p.maxHp * 0.6 ? 3 : 0.5;
  if (c.ty === 'gold') return 0.2;
  if (c.ty === 'main') return 9 + (c.lvl === 5 && has(D.MAIN_EVO) ? 6 : 0) + (c.lvl <= 3 ? 1 : 0);
  const t = taste[c.id] || 1,
    ev = D.EVOS[c.id];
  if (c.ty === 'up') {
    const max = D.ITEMS[c.id].st.length,
      partner = ev && has(ev.with);
    if (WEAPONS.has(c.id)) return (7 + (c.lvl === max && partner ? 8 : 0)) * t;
    return (4 + (c.id === 'medkit' && p.hp < p.maxHp * 0.5 ? 2 : 0)) * t;
  }
  // a new item
  if (WEAPONS.has(c.id)) return (nW < 2 ? 10 : nW < 4 ? 7.5 : 4) * t + (ev && has(ev.with) ? 2 : 0);
  const pairs = Object.keys(D.EVOS).some((w) => D.EVOS[w].with === c.id && has(w)) || c.id === D.MAIN_EVO;
  return (PASSIVE_BASE[c.id] || 3) * t + (pairs ? 3 : 0);
}
function pickCard(S, taste, rng, noise) {
  const cards = S.pause.cards;
  let best = 0,
    bv = -1;
  cards.forEach((c, i) => {
    const v = cardScore(S, c, taste) * (1 + (rng() - 0.5) * 2 * noise);
    if (v > bv) {
      bv = v;
      best = i;
    }
  });
  if (bv < 2 && S.p.rerolls > 0) return -2;
  return best;
}

// ---------- moving ----------
function makeBot(opt = {}) {
  const K = SKILL[opt.skill || 'avg'],
    rng = opt.rng || Math.random,
    taste = opt.taste || {};
  let dir = null,
    n = 0,
    stuck = 0,
    lastX = 0,
    lastY = 0,
    side = 1,
    sideT = 0,
    shut = null;
  const DX = [],
    DY = [];
  for (let i = 0; i < 16; i++) {
    DX.push(Math.cos((i / 16) * TAU));
    DY.push(Math.sin((i / 16) * TAU));
  }
  DX.push(0);
  DY.push(0);
  const seen = (t0, t) => t - t0 >= K.react;
  let aimT = null,
    aimErr = 0;
  function target(S) {
    const p = S.p,
      R = SIM.mainStats(S).range * 0.95;
    let best = null,
      bv = Infinity;
    for (const e of S.en) {
      if (e.dead) continue;
      const d = gd(e.x - p.x, e.y - p.y);
      if (d > R) continue;
      const dd = D.ENEMIES[e.k],
        v =
          d -
          (dd.boss ? 400 : 0) -
          (e.elite ? 80 : 0) -
          (dd.bomb && e.fuse === undefined ? 40 : 0) -
          (dd.ranged ? 40 : 0);
      if (v < bv) {
        bv = v;
        best = e;
      }
    }
    return best;
  } // an attack is noticed this long after it shows

  function danger(S, x, y, h, near, O) {
    const p = S.p,
      t = S.t;
    let v = 0;
    // zombies, each moved toward the spot for h s at its speed
    for (const e of near) {
      const d = D.ENEMIES[e.k];
      let dx = x - e.x,
        dy = y - e.y;
      const dd = gd(dx, dy) || 1;
      const step = Math.min(dd, e.spd * h * (e.slowT > t ? 0.5 : 1)),
        ex = e.x + (dx / dd) * step,
        ey = e.y + (dy / dd) * step * 0.5;
      const reach = e.r + 16 + 6,
        gap = gd(x - ex, y - ey) - reach;
      const w = (e.dmg / 10) * (d.boss ? 5 : 1) * (e.elite ? 1.5 : 1);
      v += w * Math.exp(-Math.max(-40, gap) / (45 * K.keep));
      if (d.explode && dd < 170) v += 1.2 * Math.exp(-(dd - 130) / 30); // a bloater bursts where it dies
      if (d.bomb && e.fuse !== undefined && seen(e.fuse, t)) {
        const r = d.bomb.r + 30;
        if (gd(x - e.x, y - e.y) < r) v += 30;
      }
      if (d.ranged && dd < 250) v += 0.3;
      if (d.boss) {
        // keep a boss at its own distance
        const want = e.k === 'screamer' ? 600 : e.k === 'pustule' ? 380 : e.k === 'golem' || e.k === 'tank' ? 520 : 300;
        if (dd < want) v += (6 * (want - dd)) / want;
        if (e.k === 'butcher' && e.st === 'dash') {
          // mid-charge: off the rest of its line
          const ax = Math.cos(e.ang),
            ay = Math.sin(e.ang),
            rx = x - e.x,
            ry = y - e.y,
            s = Math.max(0, Math.min(e.ll ?? 600, rx * ax + ry * ay));
          if (gd(rx - ax * s, ry - ay * s) < 110) v += 30;
        }
        if (e.k === 'screamer' && (e.st === 'wind' || e.st === 'howl')) {
          const SR = 645 * (d.reach || 1) + 60;
          if (dd < SR) v += 20 + 10 * (1 - dd / SR);
        } // her scream: out of it
      }
      if (d.bomb && e.fuse === undefined && dd < 170) v += 2 * Math.exp(-(dd - d.bomb.near) / 25); // a bomber lights up close by: keep it off
    }
    // what is coming down
    for (const q of S.tele) {
      if (!seen(q.t0, t)) continue;
      const left = q.t0 + q.dur - t;
      if (q.k === 'mark') {
        if (left < 1.4 && gd(x - q.x, y - q.y) < q.r + 30) v += 25;
      } else if (q.k === 'shadow') {
        if (gd(x - q.x, y - q.y) < 220) v += 30;
      } else if (q.k === 'ring') {
        const dd = gd(x - q.x, y - q.y);
        if (q.r > 500) {
          if (dd < q.r + 50) v += 18 + 10 * (1 - dd / q.r);
        } // the screamer's scream: out of the ring
        else {
          if (dd < 150 * 1.05 + 50) v += 30;
          else if (dd < 680) v += 8 * (1 - (dd - 200) / 480);
        } // the golem's slam, then its wave
      } else if (q.k === 'line') {
        // the butcher's charge
        const L = q.len,
          ax = Math.cos(q.a),
          ay = Math.sin(q.a),
          rx = x - q.x,
          ry = y - q.y,
          s = Math.max(0, Math.min(L, rx * ax + ry * ay));
        if (gd(rx - ax * s, ry - ay * s) < 110) v += 30;
      }
    }
    for (const b of S.eb) {
      if (b.k === 'acid') {
        const bx = b.x + b.vx * h,
          by = b.y + b.vy * h;
        if (gd(x - bx, y - 30 - by) < 50) v += 12;
      } else if (b.k === 'wave' && seen(b.t0, t)) {
        const k = (t + h - b.t0) / b.dur,
          r = b.r0 + (b.r1 - b.r0) * k,
          dd = gd(x - b.x, y - b.y);
        if (k < 1 && Math.abs(dd - r) < 60 && !b.hit) v += 6;
      }
    }
    for (const q of S.pud) if (gd(x - q.x, y - q.y) < q.r + 18) v += 8 * (q.pw || 1);
    // walls, the arena's rim and the map's edge; open ground is a little better
    const c = cellOf(x, y);
    if (c >= 0 && !O.B[c]) v += Math.max(0, 3 - O.dist[c]) * 0.3;
    if (S.arena) {
      const dd = gd(x - S.arena.x, y - S.arena.y);
      if (dd > S.arena.r - 90) v += (6 * (dd - (S.arena.r - 90))) / 90;
    }
    return v;
  }

  function want(S, x, y) {
    // what is worth walking to
    const p = S.p;
    let v = 0;
    for (const g of S.gems) {
      if (g.m) continue;
      const d = gd(x - g.x, y - g.y);
      if (d < 500) v += g.v * Math.exp(-d / 160);
    }
    for (const o of S.pk) {
      if (o.m) continue;
      const d = gd(x - o.x, y - o.y);
      if (d > 600) continue;
      const w = o.k === 'medkit' ? 30 * (1 - p.hp / p.maxHp) : o.k === 'magnet' ? 8 : o.k === 'bomb' ? 4 : 1.5;
      v += w * Math.exp(-d / 200);
    }
    for (const c of S.chests) {
      if (c.z > 0) continue;
      const d = gd(x - c.x, y - c.y);
      if (d < 1400) v += 25 * Math.exp(-d / 400);
    }
    return v;
  }

  return function input(S) {
    const p = S.p,
      inp = {};
    if (S.pause) {
      inp.pick = S.pause.k === 'lv' ? pickCard(S, taste, rng, K.noise) : 0;
      return inp;
    }
    if (n++ % K.every === 0 || !dir) {
      const O = openness(S.seed),
        near = [];
      for (const e of S.en) if (!e.dead && Math.abs(e.x - p.x) < 520 && Math.abs(e.y - p.y) < 300) near.push(e);
      const spd = p.st.speed,
        H = [0.15, 0.35, 0.7],
        HW = [1, 0.7, 0.45],
        hp = p.hp / p.maxHp;
      const greed = K.greed * (0.4 + 0.8 * hp);
      // stuck all the same (a corner the samples missed): that way is shut for a moment, and it tries sideways
      if (Math.hypot(p.x - lastX, p.y - lastY) < ((spd * K.every) / 120) * 0.25 && dir && (dir[0] || dir[1])) stuck++;
      else stuck = 0;
      lastX = p.x;
      lastY = p.y;
      if (stuck > 2) {
        side = -side;
        sideT = S.t + 0.5;
        shut = [dir[0], dir[1], S.t + 0.6];
        stuck = 0;
      }
      let best = -1,
        bv = Infinity;
      for (let i = 0; i < DX.length; i++) {
        let v = 0;
        // where it gets to in h s that way: up to the first wall (it stops there; against walls it slides, but a dead end is a dead end)
        let fx = p.x,
          fy = p.y,
          cut = 0;
        for (let k = 0; k < H.length; k++) {
          const L = spd * H[k],
            d0 = k ? spd * H[k - 1] : 0;
          if (!cut)
            for (let s = d0 + 12; s <= L + 0.1; s += 12) {
              const x = p.x + DX[i] * s,
                y = p.y + DY[i] * s,
                c = cellOf(x, y);
              if (c < 0 || O.B[c] || SIM.blockedAt(S, x, y, 14)) {
                cut = 1;
                break;
              }
              fx = x;
              fy = y;
            }
          v += HW[k] * danger(S, fx, fy, H[k], near, O) + (cut ? 0.8 : 0);
        }
        v -= greed * 0.12 * want(S, fx, fy);
        if (dir) v -= 0.25 * (DX[i] * dir[0] + DY[i] * dir[1]); // keep going the way it goes (no dithering)
        if (S.t < sideT && dir) v -= 1.5 * (DX[i] * -dir[1] * side + DY[i] * dir[0] * side);
        if (shut && S.t < shut[2] && DX[i] * shut[0] + DY[i] * shut[1] > 0.7) v += 6;
        if (i === 16) v += 0.4; // standing still is rarely right
        v *= 1 + (rng() - 0.5) * K.noise * 0.5;
        if (v < bv) {
          bv = v;
          best = i;
        }
      }
      dir = [DX[best], DY[best]];
    }
    inp.jx = dir[0];
    inp.jy = dir[1];
    // aim as a player does with the mouse or the right stick: at the nearest threat in range (a boss, an elite or a lit bomber first)
    if (n % 4 === 1 || !aimT || aimT.dead) aimT = target(S);
    if (aimT) {
      const h = SIM.hand(S),
        ty = aimT.y - D.ENEMIES[aimT.k].h * 0.45,
        a = Math.atan2(ty - h[1], aimT.x - h[0]) + aimErr;
      if (n % 30 === 0) aimErr = (rng() - 0.5) * K.aim;
      inp.ax = Math.cos(a);
      inp.ay = Math.sin(a);
    }
    return inp;
  };
}

// a taste for the items: each one liked a little more or less (0.6..1.4), drawn per run
function randomTaste(rng) {
  const t = {};
  for (const id of Object.keys(D.ITEMS)) t[id] = 0.6 + rng() * 0.8;
  return t;
}
// a small seeded RNG (mulberry32)
function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { makeBot, randomTaste, rngOf, SKILL, cardScore };
