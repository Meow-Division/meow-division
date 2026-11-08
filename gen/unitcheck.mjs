// Logic checks without a browser: node gen/unitcheck.mjs [seconds]
//  save   — save.js reads a stored save field by field: corrupted JSON, unknown / locked / unowned weapons, junk numbers, out-of-range
//           levels, unknown languages and an earlier build's default 'lang' all come back as a usable save; persist() writes data only
//  i18n   — slots, keys inside slots, plain strings passing through, browser-language detection, number formats, names written into DATA
//  sim    — a bot plays a god-mode run (aims at the nearest zombie, picks cards, a horde cheat at 2:00): two runs with one seed are
//           identical (determinism); a run saved to JSON and restored halfway (the page's reload path) carries on identically; the
//           state never holds NaN; no state array keeps growing; the run reaches the boss and ends.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fails = [],
  ok = (c, m) => {
    if (!c) fails.push(m);
  },
  log = (...a) => console.log(...a);
const src = (f) => fs.readFileSync('live/' + f, 'utf8');

// a page-like context with the given scripts loaded (window === the context)
const page = (files, store = {}) => {
  const ctx = vm.createContext({ console, location: { search: '' }, navigator: { languages: ['en-US'] } });
  ctx.window = ctx;
  ctx.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
  for (const f of files) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
};
const LANGS = ['i18n.js', 'lang_en.js', 'lang_es.js', 'lang_uk.js', 'lang_ru.js'];

// ---- save ----
{
  const KEY = 'zombie-horde-save-v1',
    load = (raw) => page([...LANGS, 'data.js', 'rules.js', 'save.js'], raw === undefined ? {} : { [KEY]: raw }).SAVE;
  const plain = (s) => JSON.parse(JSON.stringify(s));
  ok(load().selected === 'pistol' && load().coins === 0, 'save: an empty store gives the defaults');
  ok(load('{not json').selected === 'pistol', 'save: corrupted JSON gives the defaults');
  ok(load('42').coins === 0 && load('[1,2]').selected === 'pistol', 'save: a non-object save gives the defaults');
  const s = load(
    JSON.stringify({
      coins: '12.7',
      selected: 'railgun',
      owned: { shotgun: true, laser: true, ghost: true, smg: 'yes' },
      meta: { hp: 99, reroll: -3, start: '2', bogus: 4 },
      wup: { minigun: { dmg: 7, rate: '2' }, ghost: { dmg: 1 }, pistol: null },
      votes: { maps: true, daily: 1, nope: true },
      stats: { runs: 'x', best: 321.5, kills: -9 },
      lang: 'en',
      language: 'xx',
    }),
  );
  ok(s.selected === 'pistol', 'save: an unknown selected weapon falls back to the pistol, got ' + s.selected);
  ok(s.coins === 12, 'save: coins are a whole number, got ' + s.coins);
  ok(
    plain(s.owned).shotgun === true && !s.owned.laser && !s.owned.ghost && !s.owned.smg && s.owned.pistol,
    'save: owned keeps real, buyable weapons only: ' + JSON.stringify(s.owned),
  );
  ok(
    s.meta.hp === 5 && s.meta.reroll === 0 && s.meta.start === 2 && !('bogus' in s.meta),
    'save: upgrade levels clamp to 0..max: ' + JSON.stringify(s.meta),
  );
  ok(
    JSON.stringify(s.wup) ===
      JSON.stringify({ minigun: { dmg: 5, rate: 2, mag: 0 }, pistol: { dmg: 0, rate: 0, mag: 0 } }),
    'save: weapon upgrades clamp, unknown guns drop: ' + JSON.stringify(s.wup),
  );
  ok(
    JSON.stringify(s.votes) === '{"maps":true}',
    'save: votes keep known roadmap ids set to true: ' + JSON.stringify(s.votes),
  );
  ok(
    s.stats.runs === 0 && s.stats.best === 321.5 && s.stats.kills === 0,
    'save: stats are non-negative numbers: ' + JSON.stringify(s.stats),
  );
  ok(s.language === null && !('lang' in s), 'save: an unknown language and the old default lang are dropped');
  ok(
    load(JSON.stringify({ selected: 'laser', owned: { laser: true } })).selected === 'pistol',
    'save: a locked weapon can not be selected',
  );
  ok(
    load(JSON.stringify({ selected: 'shotgun' })).selected === 'pistol',
    'save: an unowned weapon can not be selected',
  );
  ok(
    load(JSON.stringify({ selected: 'shotgun', owned: { shotgun: true }, language: 'uk' })).selected === 'shotgun',
    'save: an owned weapon stays selected',
  );
  ok(load(JSON.stringify({ language: 'uk' })).language === 'uk', 'save: a known language pick is kept');
  {
    const store = {},
      ctx = page([...LANGS, 'data.js', 'rules.js', 'save.js'], store);
    ctx.SAVE.coins = 50;
    ctx.SAVE.wupOf('smg').dmg = 1;
    ctx.SAVE.persist();
    const w = JSON.parse(store[KEY]);
    ok(
      w.coins === 50 && w.wup.smg.dmg === 1 && !('persist' in w) && !('wupOf' in w),
      'save: persist writes the data and no methods',
    );
  }
}

// ---- i18n ----
{
  const c = page([...LANGS, 'data.js']),
    I = c.I18N;
  I.set('en');
  ok(
    I.t('hud.bossWarn', { boss: 'bosses.tank' }) === 'WARNING: IRONCLAD',
    'i18n: a key in a slot is translated: ' + I.t('hud.bossWarn', { boss: 'bosses.tank' }),
  );
  ok(I.t('hud.elim', { n: 48 }) === '48 ELIMINATED', 'i18n: numbers fill slots');
  ok(
    I.t('Already text') === 'Already text' && I.t('no.such.key') === 'no.such.key' && I.t(null) === '',
    'i18n: non-keys pass through',
  );
  ok(I.t('hud.horde', null, 'es') === '¡HORDA!' && I.t('hud.horde') === 'HORDE!', 'i18n: a per-call language');
  ok(
    I.detect(['ru-RU', 'en']) === 'ru' &&
      I.detect(['en-US', 'ru']) === 'en' &&
      I.detect(['UA']) === 'uk' &&
      I.detect(['es-419']) === 'es' &&
      I.detect(['de-DE', 'fr']) === 'en' &&
      I.detect([]) === 'en',
    'i18n: browser-language detection',
  );
  ok(
    I.num(1843, 'en') === '1,843' &&
      I.num(123456, 'ru').replace(/\s/g, ' ') === '123 456' &&
      I.dec(2.25, 'uk') === '2,3' &&
      I.dec(2, 'en') === '2',
    'i18n: number formats per language',
  );
  I.set('uk');
  ok(
    c.DATA.MAIN.pistol.name === 'Пістолет' &&
      c.DATA.ENEMIES.tank.name === 'БРОНЕТАНК' &&
      c.DATA.MAPS[0].name === 'Передмістя',
    'i18n: apply writes names into DATA',
  );
  I.set('xx');
  ok(I.lang === 'en' && c.DATA.MAIN.pistol.name === 'Pistol', 'i18n: an unknown language falls back to English');
}

// ---- sim ----
{
  const SIM = require('../live/sim.js'),
    D = require('../live/data.js'),
    REPLAY = require('../live/replay.js'),
    LEN = +(process.argv[2] || 700);
  const bot = (S) => {
    let best = null,
      bd = Infinity;
    for (const e of S.en) {
      if (e.dead) continue;
      const d = (e.x - S.p.x) ** 2 + (e.y - S.p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    const z = S.zoom || 1,
      a = S.t * 0.35;
    return {
      left: Math.cos(a) < -0.3,
      right: Math.cos(a) > 0.3,
      up: Math.sin(a) < -0.3,
      down: Math.sin(a) > 0.3,
      fire: true,
      pick: S.pause ? 0 : null,
      mx: best ? (best.x - S.cam[0]) * z : 960,
      my: best ? (best.y - 40 - S.cam[1]) * z : 540,
    };
  };
  const start = () => {
    const S = SIM.spawn(0, {
      weapon: 'shotgun',
      meta: { hp: 2, dmg: 1, speed: 1, magnet: 1, reroll: 1, start: 1 },
      wup: { dmg: 1, rate: 1 },
      seed: 11,
    });
    SIM.cheat(S, 'god');
    return S;
  };
  const run = (S, until, watch) => {
    while (S.t < until && !S.over) {
      SIM.step(S, bot(S));
      if (Math.abs(S.t - 120) < SIM.DT / 2 && !S.hordeCheat) {
        S.hordeCheat = 1;
        SIM.cheat(S, 'horde');
      }
      if (watch) watch(S);
    }
    return S;
  };
  const bad = (o, path = 'S', out = []) => {
    if (typeof o === 'number') {
      if (Number.isNaN(o)) out.push(path);
    } else if (o && typeof o === 'object')
      for (const k in o) {
        bad(o[k], path + '.' + k, out);
        if (out.length > 5) break;
      }
    return out;
  };
  const firstDiff = (a, b, path = 'S') => {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (!a || !b || typeof a !== 'object')
      return path + ': ' + JSON.stringify(a)?.slice(0, 60) + ' vs ' + JSON.stringify(b)?.slice(0, 60);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], path + '.' + k);
      if (d) return d;
    }
    return path;
  };
  const t0 = Date.now(),
    H = 90;
  const A = run(start(), H),
    B = run(start(), H);
  ok(JSON.stringify(A) === JSON.stringify(B), 'sim: two runs with one seed differ (determinism) at ' + firstDiff(A, B));
  // the page's reload: the run as JSON, restored into a freshly loaded sim module (module-level caches start empty)
  const C = run(start(), H / 2),
    json = JSON.stringify(C);
  for (const k of Object.keys(require.cache)) if (/live[\\/](sim|data)\.js$/.test(k)) delete require.cache[k];
  const SIM2 = require('../live/sim.js'),
    R = SIM2.migrate(Object.assign(SIM2.create({ seed: C.seed }), JSON.parse(json)));
  while (R.t < H && !R.over) {
    SIM2.step(R, bot(R));
    if (Math.abs(R.t - 120) < SIM2.DT / 2 && !R.hordeCheat) {
      R.hordeCheat = 1;
      SIM2.cheat(R, 'horde');
    }
  }
  ok(
    JSON.stringify(A) === JSON.stringify(R),
    'sim: a run saved to JSON and restored halfway in a fresh page carries on differently at ' + firstDiff(A, R),
  );
  // regressions found in the audit
  const idle = { pick: null },
    fresh = (o = {}) => {
      const S = SIM.spawn(0, { weapon: 'pistol', seed: 5, ...o });
      S.en = [];
      S.done = { butcher: 1, pustule: 1, screamer: 1, golem: 1 };
      return S;
    };
  {
    const S = fresh();
    for (const id of ['chain', 'saws', 'drone', 'grenade', 'molotov', 'tesla']) S.p.items.push(SIM.newItem(id, 5));
    SIM.recalc(S); // (one slot left)
    S.chests.push({ x: S.p.x, y: S.p.y, k: 'boss', z: 0, t: 0 }, { x: S.p.x + 10, y: S.p.y, k: 'air', z: 0, t: 0 });
    SIM.step(S, idle);
    ok(
      S.pause && S.pause.k === 'chest' && S.chests.length === 1,
      'sim: two chests at once — one opens, the other waits on the ground',
    );
    ok(
      S.ev.some((e) => e.k === 'open' && (e.ck === 'boss' || e.ck === 'air')),
      'sim: a chest opening emits an "open" event',
    );
    const news = S.pause.items.filter((c) => c.ty === 'new').length,
      ids = S.pause.items.map((c) => c.id);
    ok(
      news <= 1 && new Set(ids).size === ids.length,
      'sim: a boss chest with one slot free deals at most 1 new item, no repeats: ' + JSON.stringify(S.pause.items),
    );
    SIM.step(S, { pick: 0 });
    ok(S.p.items.length <= D.MAX_ITEMS, `sim: items past the ${D.MAX_ITEMS} slots after a chest: ` + S.p.items.length);
  }
  // the second wave of extra weapons and passives: each pair evolves its weapon at its last level; each weapon, plain and evolved, fights
  // a horde without NaN; the caliber evolves the main gun at level 5; the helmet blocks about its share of hits; the fang heals
  for (const [w, e] of Object.entries(D.EVOS)) {
    const S = fresh();
    S.p.items.push(SIM.newItem(w, D.ITEMS[w].st.length - 1));
    S.p.items.push(SIM.newItem(e.with, 1));
    SIM.recalc(S);
    S.pause = { k: 'lv', cards: [{ ty: 'up', id: w, lvl: D.ITEMS[w].st.length }], t: 0 };
    SIM.step(S, { pick: 0 });
    ok(
      S.p.items[0].evo && S.ev.some((x) => x.k === 'evo' && x.id === w),
      `sim: ${w} + ${e.with} evolves at its last level`,
    );
  }
  for (const w of D.SUB_WEAPONS)
    for (const evo of [false, true]) {
      const S = fresh();
      S.p.god = true;
      const it = SIM.newItem(w, D.ITEMS[w].st.length);
      it.evo = evo;
      S.p.items.push(
        it,
        SIM.newItem('bandolier', 2),
        SIM.newItem('canister', 5),
        SIM.newItem('battery', 5),
        SIM.newItem('scope', 5),
      );
      SIM.recalc(S);
      for (let i = 0; i < 60; i++) {
        const e = SIM.addEnemy(S, i % 7 ? 'walker' : 'spitter', S.p.x + 380 * Math.cos(i), S.p.y + 190 * Math.sin(i));
        e.spT = -9;
      }
      let hp = 0;
      for (const e of S.en) hp += e.hp;
      for (let i = 0; i < 120 * 6; i++) {
        SIM.step(S, { jx: Math.cos(i / 90) * 0.5, jy: Math.sin(i / 70) * 0.3 });
        if (S.pause) S.pause = null;
        S.p.pend = 0;
      }
      let hp2 = 0;
      for (const e of S.en) hp2 += e.hp;
      const bad =
        S.en.some((e) => !Number.isFinite(e.x) || !Number.isFinite(e.hp)) ||
        !Number.isFinite(S.p.x) ||
        [S.fire, S.wells, S.msl, S.tur, S.bul].some((a) => !Array.isArray(a) || a.length > 800);
      ok(
        !bad && (w === 'gravity' && !evo ? true : S.kills > 0 || hp2 < hp),
        `sim: ${w}${evo ? ' (evolved)' : ''} fights a horde without NaN or runaway arrays (kills ${S.kills})`,
      );
    }
  for (const g of ['pistol', 'shotgun', 'smg', 'minigun', 'sniper', 'flame', 'rocket']) {
    const S = fresh({ weapon: g });
    S.p.main.lvl = 4;
    S.p.items.push(SIM.newItem('caliber', 1));
    SIM.recalc(S);
    S.pause = { k: 'lv', cards: [{ ty: 'main', id: g, lvl: 5 }], t: 0 };
    SIM.step(S, { pick: 0 });
    ok(S.p.main.evo === true, `sim: the caliber evolves the ${g} at level 5`);
  }
  {
    const S = fresh();
    S.p.items.push(SIM.newItem('helmet', 5), SIM.newItem('fang', 5));
    SIM.recalc(S);
    S.p.maxHp = 1e6;
    S.p.hp = 5e5;
    let hits = 0,
      blocks = 0;
    for (let i = 0; i < 400; i++) {
      S.p.ifr = 0;
      const n = S.ev.length;
      SIM.step(S, idle);
    }
    for (let i = 0; i < 2000; i++) {
      S.p.ifr = 0;
      S.ev.length = 0;
      const e = SIM.addEnemy(S, 'walker', S.p.x, S.p.y);
      e.spT = -9;
      SIM.step(S, idle);
      e.dead = true;
      for (const x of S.ev) {
        if (x.k === 'hurt') hits++;
        if (x.k === 'block') blocks++;
      }
    }
    const share = blocks / Math.max(1, hits + blocks);
    ok(share > 0.2 && share < 0.3, `sim: the helmet blocks about a quarter of hits (${(share * 100).toFixed(0)}%)`);
    const S2 = fresh();
    S2.p.items.push(SIM.newItem('fang', 5));
    SIM.recalc(S2);
    S2.p.hp = 50;
    for (let i = 0; i < 12; i++) {
      const e = SIM.addEnemy(S2, 'walker', S2.p.x + 900, S2.p.y);
      SIM.kill(S2, e, null);
    }
    ok(S2.p.hp === 54, `sim: the fang heals 4 HP at the 12th kill (hp ${S2.p.hp})`);
  }
  // the dome burns about 70 % of the spitters' acid that comes into it, none of a boss's globs; a bomber close to the hero stops, blows
  // up after its fuse and hurts the hero in its ring, not one who stepped out; killed before, it blows up at once; the saws turn half as
  // far out again; from the 5th minute plain zombies are half as many and strong ones half as many again
  {
    const S = fresh();
    const it = SIM.newItem('tesla', 5);
    it.evo = true;
    S.p.items.push(it);
    SIM.recalc(S);
    S.p.god = true;
    let passed = 0,
      burnt = 0,
      globs = 0;
    for (let i = 0; i < 400; i++) {
      const a = i * 0.7,
        x = S.p.x + Math.cos(a) * 400,
        y = S.p.y + Math.sin(a) * 200,
        A = Math.atan2(S.p.y - y, S.p.x - x);
      S.eb.length = 0;
      S.eb.push({
        k: 'acid',
        x,
        y: y - 60,
        vx: Math.cos(A) * 330,
        vy: Math.sin(A) * 330,
        life: 2.2,
        dmg: 1,
        r: 18,
        t0: S.t,
        z: 60,
        dz: 0,
      });
      for (let j = 0; j < 90 && S.eb.length; j++) {
        S.ev.length = 0;
        SIM.step(S, idle);
        if (S.ev.some((x) => x.k === 'shotdown')) {
          burnt++;
          break;
        }
        if (S.eb[0] && S.eb[0].dome) {
          passed++;
          break;
        }
      }
    }
    const stopped = burnt / Math.max(1, burnt + passed);
    ok(
      burnt + passed > 120 && stopped > 0.62 && stopped < 0.78,
      `sim: the dome burns about 70% of the acid spit (${(stopped * 100).toFixed(0)}% of ${burnt + passed})`,
    );
    S.eb.length = 0;
    S.ev.length = 0;
    S.eb.push({
      k: 'glob',
      x0: S.p.x + 300,
      y0: S.p.y - 150,
      x1: S.p.x,
      y1: S.p.y,
      t0: S.t,
      dur: 1.2,
      dmg: 1,
      pw: 1,
      r: 70,
      x: S.p.x + 300,
      y: S.p.y - 150,
    });
    for (let j = 0; j < 100; j++) {
      SIM.step(S, idle);
      if (S.ev.some((e) => e.k === 'shotdown')) globs++;
      S.ev.length = 0;
    }
    ok(globs === 0, "sim: the dome lets a boss's acid glob through");
  }
  {
    const bomb = (away) => {
      const S = fresh();
      S.p.hp = S.p.maxHp = 1000;
      const e = SIM.addEnemy(S, 'bomber', S.p.x + 200, S.p.y);
      e.spT = -9;
      e.hp = e.max = 1e9;
      let fuse = null; // (the hero's gun fires by itself)
      for (let i = 0; i < 120 * 6 && !e.dead; i++) {
        SIM.step(S, idle);
        if (e.fuse !== undefined && fuse === null) {
          fuse = S.t;
          if (away) S.p.x -= 260;
        }
      }
      return {
        fuse,
        dead: e.dead,
        after: e.dead ? S.t - fuse : null,
        hurt: 1000 - S.p.hp,
        boom: S.ev.some((x) => x.k === 'boom' && x.r === 150),
      };
    };
    const a = bomb(false),
      b = bomb(true);
    ok(
      a.fuse !== null && a.dead && Math.abs(a.after - 2) < 0.05 && a.boom && a.hurt > 15,
      `sim: a bomber near the hero blows up 2 s later and hurts him (${JSON.stringify(a)})`,
    );
    ok(b.dead && b.hurt < 1, `sim: a hero who steps out of the bomber's ring is not hurt (${JSON.stringify(b)})`);
    const S = fresh();
    const e = SIM.addEnemy(S, 'bomber', S.p.x + 600, S.p.y);
    SIM.kill(S, e, null);
    SIM.step(S, idle);
    ok(
      S.ev.some((x) => x.k === 'boom' && x.r === 150),
      'sim: a bomber killed before its fuse blows up at once',
    );
  }
  {
    const S = fresh();
    const it = SIM.newItem('saws', 1);
    S.p.items.push(it);
    SIM.recalc(S);
    const g = SIM.sawGeom(S, it);
    ok(
      g.R === 144 && Math.abs(g.dmg - 14.4) < 1e-9,
      `sim: the saws turn at 144 px with 14.4 damage at level 1 (${g.R}, ${g.dmg})`,
    );
  }
  {
    const count = (tm) => {
      const S = fresh();
      S.t = tm * 60;
      const c = {};
      for (let i = 0; i < 13; i++) {
        SIM.cheat(S, 'horde');
        for (const e of S.en) c[e.k] = (c[e.k] || 0) + 1;
        S.en.length = 0;
      }
      return c;
    };
    const sum = (c, ks) => ks.reduce((a, k) => a + (c[k] || 0), 0),
      b4 = count(4.9),
      l8 = count(8);
    log('sim: spawn mix 4:54 ' + JSON.stringify(b4) + ' / 8:00 ' + JSON.stringify(l8));
    ok(b4.bomber > 0 && b4.bloater > b4.bomber, 'sim: some bloaters are bombers from the 4th minute');
  }
  {
    const S = fresh();
    S.t = 8 * 60;
    const c = {};
    let rolls = 0;
    for (let i = 0; i < 30000; i++) {
      const n = S.en.length;
      SIM.spawnAt(S, 8, S.p.x + 2000, S.p.y);
      rolls++;
      for (const e of S.en.slice(n)) c[e.k] = (c[e.k] || 0) + 1;
      if (S.en.length > 5000) S.en.length = 0;
    }
    const S0 = fresh();
    S0.t = 4.4 * 60;
    const c0 = {};
    for (let i = 0; i < 30000; i++) {
      const n = S0.en.length;
      SIM.spawnAt(S0, 4.4, S0.p.x + 2000, S0.p.y);
      for (const e of S0.en.slice(n)) c0[e.k] = (c0[e.k] || 0) + 1;
      if (S0.en.length > 5000) S0.en.length = 0;
    }
    const plain = (c.walker || 0) + (c.runner || 0),
      strong = (c.bloater || 0) + (c.bomber || 0) + (c.armored || 0);
    // the 8th minute's table: plain 0.61, strong 0.30 of the rolls → plain ×0.5 ≈ 0.305, strong ×1.5 ≈ 0.45 per roll
    ok(
      Math.abs(plain / rolls - 0.305) < 0.02 && Math.abs(strong / rolls - 0.45) < 0.02,
      `sim: from the 5th minute plain zombies come half as often, strong ones half as often again (${(plain / rolls).toFixed(3)} plain, ${(strong / rolls).toFixed(3)} strong per roll)`,
    );
    ok(
      Object.values(c0).reduce((a, b) => a + b, 0) === 30000,
      'sim: before 4:30 one zombie per roll (the late rules come in from 4:30 to 6:30)',
    );
  }
  // the magazine and the reload: a wall of zombies that never die in front, the trigger held (mouse aim), shots and reloads counted
  {
    const fire = { fire: true, mx: 1500, my: 500, pick: null };
    const shoot = (o = {}, secs = 8, inp = fire) => {
      const S = fresh({ weapon: o.weapon || 'pistol', wup: o.wup });
      S.p.god = true;
      for (const [id, l] of o.items || []) S.p.items.push(SIM.newItem(id, l));
      SIM.recalc(S);
      if (o.evo) S.p.main.evo = true;
      for (let i = 0; i < 12; i++) {
        const e = SIM.addEnemy(S, 'armored', S.p.x + 200 + (i % 4) * 30, S.p.y - 40 + Math.floor(i / 4) * 30);
        e.spT = -9;
        e.hp = e.max = 1e9;
      }
      const r = { shots: 0, rl: [], done: [], S };
      for (let i = 0; i < secs * 120; i++) {
        S.ev.length = 0;
        SIM.step(S, typeof inp === 'function' ? inp(S, i) : inp);
        for (const e of S.ev) {
          if (e.k === 'shot' && e.w === S.p.main.id) r.shots++;
          if (e.k === 'reload') r.rl.push([S.t, r.shots]);
          if (e.k === 'reloaded') r.done.push(S.t);
        }
      }
      return r;
    };
    const a = shoot();
    ok(
      a.rl.length && a.rl[0][1] === 13 && a.done.length && Math.abs(a.done[0] - a.rl[0][0] - 1.4) < 0.02,
      `sim: the pistol fires 13 rounds, then reloads 1.4 s (${JSON.stringify(a.rl)} / ${JSON.stringify(a.done)})`,
    );
    const gap = (r) => {
      const t = r.rl[0][0];
      return r.done[0] - t;
    };
    for (const g of ['shotgun', 'smg', 'minigun', 'sniper', 'rocket']) {
      const r = shoot({ weapon: g }, 14);
      ok(
        r.rl.length && r.rl[0][1] === D.MAIN[g].mag && Math.abs(gap(r) - D.MAIN[g].rl) < 0.02,
        `sim: the ${g} fires its magazine of ${D.MAIN[g].mag}, then reloads ${D.MAIN[g].rl} s (${JSON.stringify(r.rl.slice(0, 2))})`,
      );
    }
    {
      const r = shoot({ weapon: 'flame' }, 9),
        S = r.S;
      ok(
        r.rl.length && Math.abs(r.rl[0][0] - (D.MAIN.flame.mag - 1) * D.MAIN.flame.tick) < 0.1,
        `sim: the flamethrower's tank lasts ${D.MAIN.flame.mag * D.MAIN.flame.tick} s (reload at ${r.rl.length ? r.rl[0][0].toFixed(2) : '-'})`,
      );
    }
    const mag = (o) => SIM.mainStats(shoot(o, 0.05).S).mag;
    ok(
      mag({ wup: { dmg: 0, rate: 0, mag: 5 } }) === 23 &&
        mag({ items: [['bandolier', 1]] }) === 16 &&
        mag({ items: [['bandolier', 2]] }) === 20 &&
        mag({ evo: true }) === 20,
      `sim: the magazine grows with the upgrade (23), the bandolier (16, 20) and the evolution (20): ${mag({ wup: { dmg: 0, rate: 0, mag: 5 } })} ${mag({ items: [['bandolier', 1]] })} ${mag({ items: [['bandolier', 2]] })} ${mag({ evo: true })}`,
    );
    {
      const b = shoot({ items: [['battery', 5]] });
      ok(
        b.done.length && Math.abs(gap(b) - 1.4 * 0.6) < 0.02,
        `sim: the battery shortens the main gun's reload (${b.done.length ? gap(b).toFixed(2) : '-'} s)`,
      );
    }
    {
      const b = shoot({ items: [['boots', 5]] }),
        c = shoot({
          items: [
            ['boots', 5],
            ['battery', 5],
          ],
        });
      ok(
        b.done.length &&
          Math.abs(gap(b) - 1.4 * 0.7) < 0.02 &&
          c.done.length &&
          Math.abs(gap(c) - 1.4 * 0.6 * 0.7) < 0.02 &&
          Math.abs(b.S.p.st.speed - 200 * 1.4) < 1e-9,
        `sim: the boots make the hero faster and shorten the main gun's reload, with the battery too (${b.done.length ? gap(b).toFixed(2) : '-'} s, ${c.done.length ? gap(c).toFixed(2) : '-'} s, speed ${b.S.p.st.speed})`,
      );
    }
    // topping up: 3 rounds fired, then nothing to shoot — it reloads by itself after a moment; the R key reloads at once
    {
      const r = shoot({}, 3.5, (S, i) => {
        if (i === 120) S.en.length = 0;
        return i < 120 ? fire : idle;
      });
      ok(
        r.shots < 13 && r.rl.length === 1 && r.rl[0][0] > 1 && r.rl[0][0] < 1.8 && r.S.p.main.ammo === 13,
        `sim: a gun with rounds spent tops itself up when it has nothing to shoot (${JSON.stringify(r.rl)}, ammo ${r.S.p.main.ammo})`,
      );
    }
    {
      const r = shoot({}, 3.5, (S, i) => {
        if (i === 120) S.en.length = 0;
        if (i === 300) {
          const e = SIM.addEnemy(S, 'armored', S.p.x + 200, S.p.y);
          e.spT = -9;
          e.hp = e.max = 1e9;
        }
        return i < 120 ? fire : idle;
      });
      ok(
        r.rl.length === 1 && !r.done.length && r.S.p.main.rl === 0 && r.shots > 5,
        `sim: a top-up is broken off when there is something to shoot again (${JSON.stringify(r.rl)}, ${r.shots} shots, done ${JSON.stringify(r.done)})`,
      );
    }
    {
      const r = shoot({}, 1.2, (S, i) => (i < 60 ? fire : i === 60 ? { ...fire, rl: 1 } : fire));
      ok(
        r.rl.length === 1 && Math.abs(r.rl[0][0] - 0.5 - SIM.DT) < 0.02 && r.rl[0][1] < 13,
        `sim: the reload key starts a reload at once (${JSON.stringify(r.rl)})`,
      );
    }
    {
      const S = fresh();
      SIM.step(S, idle);
      const m = S.p.main;
      m.ammo = 4;
      S.p.items.push(SIM.newItem('bandolier', 1));
      SIM.recalc(S);
      SIM.step(S, idle);
      ok(m.cap === 16 && m.ammo >= 7, `sim: a magazine grown mid-run comes with its extra rounds (${m.ammo}/${m.cap})`);
    }
    // the reload key goes through the run's log
    {
      const rec = REPLAY.rec();
      for (let i = 0; i < 5; i++) REPLAY.push(rec, REPLAY.quant({ rl: i === 2 }));
      const got = [];
      REPLAY.each(rec.log, rec.n, (inp) => got.push(inp.rl));
      ok(JSON.stringify(got) === '[0,0,1,0,0]', 'replay: the reload key is kept in the log: ' + JSON.stringify(got));
    }
  }
  // the medkit passive: regen and more max health (10, 20, 30, 45, 60), the added health given at once
  {
    const S = fresh();
    SIM.step(S, idle);
    const hp0 = S.p.hp,
      max0 = S.p.maxHp,
      got = [];
    for (let l = 1; l <= 5; l++) {
      S.p.items = S.p.items.filter((i) => i.id !== 'medkit');
      S.p.items.push(SIM.newItem('medkit', l));
      SIM.recalc(S);
      got.push(S.p.maxHp - max0);
    }
    ok(
      JSON.stringify(got) === '[5,10,15,23,30]' && S.p.hp === hp0 + 30 && S.p.st.regen === 2.8,
      `sim: the medkit adds 5/10/15/23/30 max health, given at once, and regen 2.8 (${JSON.stringify(got)}, hp ${S.p.hp}/${S.p.maxHp}, regen ${S.p.st.regen})`,
    );
  }
  // the zombies match the account (D.THREAT): a bare loadout meets them at 0.6 of their health (the bosses at 0.5) and 0.85 of their
  // bite, a maxed one at 1.25 (bosses 1.39) and their full bite; whatever the rank
  {
    const MAX = { meta: { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 0 }, wup: { dmg: 5, rate: 5, mag: 5 } };
    const hp = (o, k, e) => {
      const S = fresh(o);
      S.t = 120;
      return SIM.addEnemy(S, k, S.p.x + 2000, S.p.y, e).hp;
    };
    const base = (k, e) => {
      const S = fresh();
      S.thr = { hp: 1, boss: 1, dmg: 1 };
      S.t = 120;
      return SIM.addEnemy(S, k, S.p.x + 2000, S.p.y, e).hp;
    };
    const r = (o, k, e) => +(hp(o, k, e) / base(k, e)).toFixed(3);
    const got = {
      walker: r({ rank: 1 }, 'walker'),
      elite: r({}, 'armored', { elite: true }),
      golem: r({ rank: 30 }, 'golem'),
      maxWalker: r(MAX, 'walker'),
      maxButcher: r({ ...MAX, rank: 2 }, 'butcher'),
    };
    ok(
      JSON.stringify(got) ===
        JSON.stringify({ walker: 0.6, elite: 0.6, golem: 0.5, maxWalker: 1.248, maxButcher: 1.391 }),
      'sim: the zombies are as strong as the account: ' + JSON.stringify(got),
    );
    const bite = (o) => {
      const S = fresh(o);
      S.p.ifr = 0;
      S.p.st.block = 0;
      const h = S.p.hp,
        e = SIM.addEnemy(S, 'walker', S.p.x + 5, S.p.y);
      e.spT = -9;
      for (let i = 0; i < 240 && S.p.hp === h; i++) SIM.step(S, idle);
      return +(h - S.p.hp).toFixed(3);
    };
    const b0 = bite({}),
      b1 = bite(MAX);
    ok(
      Math.abs(b1 / b0 - 1 / D.THREAT.dmg) < 0.01 && D.threatOf(MAX.meta, MAX.wup).dmg === 1,
      `sim: their bite grows with the account's health and speed, up to the full bite (${b0} bare, ${b1} maxed)`,
    );
  }
  // the final boss down: every zombie left bursts, every gem and coin flies to the hero, nothing more comes, and the run is won at the
  // time he fell (the record)
  {
    const S = fresh();
    S.t = 560;
    S.p.god = true;
    const boss = SIM.addEnemy(S, 'golem', S.p.x + 400, S.p.y);
    boss.spT = -9;
    for (let i = 0; i < 40; i++) {
      const e = SIM.addEnemy(
        S,
        i % 2 ? 'walker' : 'armored',
        S.p.x + 300 + (i % 8) * 60,
        S.p.y - 200 + Math.floor(i / 8) * 80,
      );
      e.spT = -9;
    }
    for (let i = 0; i < 30; i++) {
      S.gems.push({ x: S.p.x - 1500 + i * 40, y: S.p.y + 600, v: 1, z: 0 });
      S.pk.push({ k: 'coin', x: S.p.x + 1400, y: S.p.y - 500 + i * 20, v: 1, z: 0 });
    }
    const k0 = S.kills;
    SIM.kill(S, boss, null);
    const fell = S.t;
    let spawned = 0,
      pend = 0;
    for (let i = 0; i < 120 * 7 && !S.over; i++) {
      const n = S.en.length;
      SIM.step(S, { pick: null });
      if (S.pause) pend++;
      spawned += Math.max(0, S.en.filter((e) => !e.dead).length - n);
    }
    ok(
      S.over &&
        S.over.win &&
        Math.abs(S.over.t - fell) < 0.01 &&
        S.kills - k0 >= 41 &&
        !S.en.some((e) => !e.dead) &&
        !S.gems.length &&
        !S.pk.some((o) => o.k === 'coin') &&
        !spawned &&
        !pend,
      `sim: the final boss down — the zombies burst, the gems and coins fly in, the win counts from when he fell (${JSON.stringify({ over: S.over, kills: S.kills - k0, alive: S.en.filter((e) => !e.dead).length, gems: S.gems.length, coins: S.pk.filter((o) => o.k === 'coin').length, spawned, pend })})`,
    );
  }
  {
    const S = fresh();
    S.thr = { hp: 1, boss: 1, dmg: 1 };
    S.t = 120;
    const a = SIM.addEnemy(S, 'armored', S.p.x + 900, S.p.y, { elite: true }),
      w = SIM.addEnemy(S, 'walker', S.p.x + 900, S.p.y, { elite: true });
    ok(
      Math.abs(a.hp / (280 * 8 * (1 + 2 * 0.18 + 4 * 0.016)) - 0.65) < 1e-9 &&
        Math.abs(w.hp / (22 * 8 * (1 + 2 * 0.18 + 4 * 0.016)) - 1) < 1e-9 &&
        D.ENEMIES.screamer.hp === 8820,
      `sim: an elite armored zombie has 35% less health than other elites; the screamer 8820 (${(a.hp / (280 * 8 * 1.424)).toFixed(3)})`,
    );
  }
  // the record: the fastest win, set only by a win and only when faster; a save from before it takes its longest run if it ever won
  {
    const R2 = require('../live/rules.js'),
      s = R2.defaults(),
      run = (t, win) => R2.bank(s, { t, win, kills: 1, coins: 0, lvl: 1, bk: win ? 4 : 0, gun: 'pistol' });
    run(30, false);
    const a = s.stats.fast;
    run(600, true);
    const b = s.stats.fast;
    run(650, true);
    const c = s.stats.fast;
    run(580, true);
    const d = s.stats.fast;
    run(5, false);
    const old = R2.clean({ stats: { runs: 3, wins: 1, best: 640 } }),
      never = R2.clean({ stats: { runs: 3, wins: 0, best: 300 } });
    ok(
      a === 0 &&
        b === 600 &&
        c === 600 &&
        d === 580 &&
        s.stats.fast === 580 &&
        old.stats.fast === 640 &&
        never.stats.fast === 0,
      `rules: the record is the fastest win only (${[a, b, c, d, s.stats.fast, old.stats.fast, never.stats.fast].join(' ')})`,
    );
  }
  // the butcher's charge hurts whoever stands on its red line (within its width, up to its end) and nobody beside it or past it
  {
    const S0 = SIM.spawn(0, { weapon: 'pistol', seed: 5 });
    const openFor = (dx, dy) => {
      for (let y = 600; y < SIM.WY - 600; y += 37)
        for (let x = 900; x < SIM.WX - 900; x += 41) {
          const bx = x - dx * 300,
            by = y - dy * 150,
            a = Math.atan2(y - by, x - bx);
          let free = true;
          for (let d = 0; d <= 640 && free; d += 12)
            if (SIM.blockedAt(S0, bx + Math.cos(a) * d, by + Math.sin(a) * d, 22)) free = false;
          if (free) return [x, y];
        }
      return null;
    };
    const trial = (dx, dy, along, side) => {
      const S = fresh(),
        O = openFor(dx, dy);
      S.p.x = O[0];
      S.p.y = O[1];
      S.p.hp = S.p.maxHp = 1e6;
      const b = SIM.addEnemy(S, 'butcher', S.p.x - dx * 300, S.p.y - dy * 150);
      b.spT = -9;
      b.st = 'chase';
      b.next = S.t;
      b.stT = S.t;
      for (let i = 0; i < 240 && b.st !== 'wind'; i++) {
        SIM.step(S, idle);
        S.p.x = O[0];
        S.p.y = O[1];
      }
      const ux = Math.cos(b.ang),
        uy = Math.sin(b.ang),
        s = along <= 1 ? b.ll * along : b.ll + along,
        px = b.x + ux * s - uy * side,
        py = b.y + uy * s + ux * side,
        hp0 = S.p.hp;
      for (let i = 0; i < 240 && S.p.hp === hp0 && b.st !== 'rec'; i++) {
        S.p.x = px;
        S.p.y = py;
        S.p.vx = S.p.vy = S.p.pushX = S.p.pushY = 0;
        SIM.step(S, idle);
      }
      return S.p.hp < hp0;
    };
    const got = [];
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [0.7, 0.7],
    ])
      got.push(
        [
          [0.2, 0],
          [0.5, 40],
          [0.5, -40],
          [0.97, -38],
        ]
          .map(([a, s]) => trial(dx, dy, a, s))
          .filter(Boolean).length +
          '/4 in, ' +
          [
            [0.5, 80],
            [0.5, -80],
            [80, 0],
          ]
            .map(([a, s]) => trial(dx, dy, a, s))
            .filter(Boolean).length +
          '/3 out',
      );
    ok(
      got.every((g) => g === '4/4 in, 0/3 out'),
      "sim: the butcher's charge hurts on its red line, not beside or past it (horizontal, vertical, diagonal): " +
        got.join('; '),
    );
  }
  // barrels: only the main gun sets them off (an extra weapon's blast leaves them be), and their blast reaches 300 while it hurts the
  // hero only within 150
  {
    const S = fresh(),
      LV = SIM.level(S.seed),
      o = LV.props.find((q) => q.barrel),
      z = S.zoom || 1;
    S.p.x = o.x - 220;
    S.p.y = o.y;
    S.p.god = false;
    S.p.hp = S.p.maxHp = 1e6;
    S.cam = [S.p.x - 960 / z, S.p.y - 540 / z];
    S.gren.push({
      x0: o.x,
      y0: o.y - 60,
      x1: o.x,
      y1: o.y,
      t0: S.t,
      dur: 0.05,
      dmg: 500,
      r: 120,
      cl: 0,
      sm: 0,
      h: 20,
      rot: 0,
    });
    for (let i = 0; i < 30; i++) SIM.step(S, idle);
    const keptByGrenade = S.pd[o.di] > 0;
    const w = SIM.addEnemy(S, 'walker', o.x + 250, o.y);
    w.spT = -9;
    w.hp = w.max = 1e5;
    const hp0 = S.p.hp;
    let shots = 0;
    for (let i = 0; i < 360 && S.pd[o.di] > 0; i++) {
      const inp = { mx: (o.x - S.cam[0]) * z, my: (o.y - 18 - S.cam[1]) * z, fire: true };
      SIM.step(S, inp);
      shots++;
      w.x = o.x + 250;
      w.y = o.y;
    }
    for (let i = 0; i < 30; i++) SIM.step(S, idle);
    ok(
      keptByGrenade && S.pd[o.di] <= 0 && w.hp < 1e5 && S.p.hp === hp0,
      `sim: a grenade leaves a barrel be, the main gun sets it off, its blast reaches a zombie 250 away and spares the hero 220 away (${JSON.stringify({ keptByGrenade, gone: S.pd[o.di] <= 0, zombie: Math.round(1e5 - w.hp), hero: hp0 - S.p.hp, steps: shots })})`,
    );
  }
  // the mouse aim holds while the hero walks (WASD used to turn it toward the walk when not firing), and a touch aim stick that is not
  // pushed fires nothing and picks no target
  {
    const S = fresh(),
      z = S.zoom || 1;
    for (let i = 0; i < 120; i++)
      SIM.step(S, { up: 1, mx: (S.p.x + 400 - S.cam[0]) * z, my: (S.p.y - 40 - S.cam[1]) * z });
    const h = SIM.hand(S),
      want = Math.atan2(S.p.y - 40 - h[1], S.p.x + 400 - h[0]),
      off = Math.abs(((((S.p.aim - want + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI);
    ok(off < 0.03, `sim: walking with WASD leaves the mouse aim on the cursor (off by ${off.toFixed(3)} rad)`);
    const T = fresh(),
      e = SIM.addEnemy(T, 'walker', T.p.x + 160, T.p.y);
    e.spT = -9;
    e.hp = e.max = 1e5;
    let idleShots = 0,
      aimShots = 0;
    const count = (inp) => {
      const n = T.ev.length;
      SIM.step(T, inp);
      let c = 0;
      for (let j = n; j < T.ev.length; j++) if (T.ev[j].k === 'shot') c++;
      e.x = T.p.x + 160;
      e.y = T.p.y;
      return c;
    };
    for (let i = 0; i < 240; i++) idleShots += count({ ax: 0, ay: 0 });
    for (let i = 0; i < 240; i++) aimShots += count({ ax: 1, ay: 0 });
    ok(
      idleShots === 0 && aimShots > 3,
      `sim: touch — the aim stick not pushed fires nothing at a zombie close by, pushed it fires (${idleShots}, ${aimShots})`,
    );
  }
  // late (fully from 6:30, coming in from 4:30) the plain zombies have 30% less health (the elites and the others as before)
  {
    const hp = (k, tm, o) => {
      const S = fresh();
      S.thr = { hp: 1, boss: 1, dmg: 1 };
      S.t = tm * 60;
      const e = SIM.addEnemy(S, k, S.p.x + 2000, S.p.y, o);
      return e.hp / (D.ENEMIES[k].hp * (1 + tm * 0.18 + tm * tm * 0.016));
    };
    ok(
      Math.abs(hp('walker', 6.5) - 0.7) < 1e-9 &&
        Math.abs(hp('runner', 8) - 0.7) < 1e-9 &&
        hp('walker', 4.4) === 1 &&
        Math.abs(hp('walker', 5.5) - 0.85) < 1e-9 &&
        hp('armored', 6) === 1 &&
        hp('walker', 6, { elite: true }) === 8,
      `sim: late walkers and runners come with 70% health (${hp('walker', 6.5)}, ${hp('runner', 8)}, at 5:30 ${hp('walker', 5.5)}, before ${hp('walker', 4.4)}, armored ${hp('armored', 6)}, elite ${hp('walker', 6, { elite: true })})`,
    );
  }
  // the bosses' attacks: the screamer's and the golem's reach (×1.05), the pustule's acid half as big again
  {
    const watch = (k, set, secs) => {
      const S = fresh();
      S.p.god = true;
      const e = SIM.addEnemy(S, k, S.p.x + 320, S.p.y);
      e.hp = e.max = 1e9;
      e.spT = -9;
      set(e, S);
      const got = { ring: [], mark: [], wave: [], glob: [], rock: [] };
      for (let i = 0; i < secs * 120; i++) {
        SIM.step(S, { pick: null });
        for (const q of S.tele)
          if (!q.seen) {
            q.seen = 1;
            (got[q.k] || (got[q.k] = [])).push(Math.round(q.r));
          }
        for (const b of S.eb)
          if (!b.seen && got[b.k]) {
            b.seen = 1;
            got[b.k].push(Math.round(b.k === 'wave' ? b.r1 : b.r));
          }
      }
      return got;
    };
    const sc = watch(
      'screamer',
      (e, S) => {
        e.st = 'chase';
        e.stT = S.t;
        e.next = S.t + 0.2;
      },
      9,
    );
    ok(
      sc.ring.includes(677) && sc.wave.includes(714),
      `sim: the screamer's scream reaches 677 and her wave 714 (${JSON.stringify(sc)})`,
    );
    const go = watch(
      'golem',
      (e, S) => {
        e.st = 'chase';
        e.stT = S.t;
        e.next = S.t + 0.3;
        e.summon = 1e9;
        e.throwT = S.t + 0.1;
        e.phase = 1;
      },
      4,
    );
    ok(
      go.ring.includes(315) && go.wave.includes(651) && go.rock.includes(84) && go.mark.includes(84),
      `sim: the golem's slam rings 315, its wave 651, his lumps 84 (${JSON.stringify(go)})`,
    );
    const pu = watch(
      'pustule',
      (e, S) => {
        e.st = 'chase';
        e.stT = S.t;
        e.next = 1e9;
        e.globT = S.t;
      },
      3,
    );
    ok(
      pu.glob.length && pu.glob.every((r) => r === 105) && pu.mark.includes(105),
      `sim: the pustule's acid balls hit within 105 (${JSON.stringify(pu)})`,
    );
    ok(
      D.ENEMIES.screamer.hp === 8820 &&
        D.ENEMIES.bomber.hp === 144 &&
        D.ENEMIES.armored.hp === 280 &&
        D.ENEMIES.bloater.hp === 110 &&
        D.ENEMIES.pustule.hp === 7600 &&
        D.ENEMIES.spitter.hp === 68 &&
        D.ENEMIES.golem.hp === 19688,
      'data: the new health of the zombies and the bosses',
    );
  }
  ok(
    D.MAIN.shotgun.price === 600 && D.META.hp.price[0] === 200 && D.WEAPON_UP.dmg.price[0] === 180,
    'data: guns and hero upgrades cost twice as much, gun upgrades half as much again',
  );
  for (const w of ['laser', 'railgun', undefined]) {
    const S = SIM.spawn(0, { weapon: w, seed: 3 });
    SIM.step(S, idle);
    ok(S.p.main.id === 'pistol' && Number.isFinite(S.p.x), `sim: weapon ${w} starts the pistol`);
  }
  {
    const S = fresh();
    S.p.main.id = 'ghost';
    S.p.st = null;
    SIM.migrate(S);
    ok(
      S.p.main.id === 'pistol' && S.p.st && Number.isFinite(S.p.st.speed ?? 0),
      'sim: migrate repairs the weapon and recomputes stats',
    );
  }
  {
    const moved = (slow) => {
      const S = fresh();
      const e = SIM.addEnemy(S, 'butcher', S.p.x + 700, S.p.y);
      e.spT = -9;
      e.st = 'chase';
      e.next = 1e9;
      if (slow) e.slowT = 1e9;
      S.p.god = true;
      for (let i = 0; i < 240; i++) SIM.step(S, idle);
      return Math.hypot(e.vx, e.vy);
    }; // its chase speed after 2 s
    const a = moved(false),
      b = moved(true);
    ok(b < a * 0.6, `sim: chain lightning slows a boss (speed ${b.toFixed(0)} vs ${a.toFixed(0)} px/s)`);
  }
  // the whole run: NaN, array growth, the end
  const max = {},
    grow = {};
  let nan = [],
    boss = false;
  const watch = (S) => {
    if (S.steps % 600) return;
    for (const k in S)
      if (Array.isArray(S[k])) {
        const n = S[k].length;
        if (n > (max[k] || 0)) {
          max[k] = n;
          grow[k] = S.t;
        }
      }
    if (!nan.length) nan = bad(S);
    if (S.boss) boss = true;
  };
  const F = run(start(), LEN, watch);
  ok(!nan.length, 'sim: NaN in the state: ' + nan.join(', '));
  const big = Object.entries(max).filter(([, n]) => n > 4000);
  ok(
    !big.length,
    'sim: state arrays grow large: ' + big.map(([k, n]) => `${k}=${n} (max at ${grow[k].toFixed(0)} s)`).join(', '),
  );
  ok(boss, 'sim: no boss appeared in the run');
  log(
    `sim: ${LEN} s bot run in ${((Date.now() - t0) / 1000).toFixed(1)} s — t ${F.t.toFixed(0)} kills ${F.kills} lvl ${F.p.lvl} items ${F.p.items.map((i) => i.id + i.lvl).join(' ')} over ${JSON.stringify(F.over)} json ${(JSON.stringify(F).length / 1024) | 0} KB`,
  );
  log(
    'sim: largest arrays ' +
      Object.entries(max)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, n]) => k + '=' + n)
        .join(' '),
  );
}
log(JSON.stringify({ fails }, null, 1));
process.exit(fails.length ? 1 : 0);
