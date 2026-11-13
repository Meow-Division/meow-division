// live/hero.js from the character editor's tune: checkTune(t) → an error message or '' (the shape, the ranges, the names the hero has),
// tuneSource(t) → the file's text; dataWithMuzzles(text, t) → data.js's text with the sim's muzzles (D.HERO3D.mz) as the tune holds the
// guns (herobake.js, as the export computes them). server.mjs --editor saves them (POST /api/editor/hero). The backpacks' placement
// has its own file, live/hero_pack.js (checkPack, packSource, samePack: POST /api/editor/pack): it never touches the tune's.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HB = require('../live/herobake.js'),
  SIM = require('../live/sim.js'),
  DATA = require('../live/data.js');
const INFO = {};
const info = (id = 'cat') =>
  INFO[id] ||
  (INFO[id] = HB.alias(JSON.parse(fs.readFileSync(path.join(ROOT, 'live', 'assets', `c_${id}.json`), 'utf8')))); // (with its guns held as others)
// another character than the game's hero (the editor's ?heroid): its tune file, and its muzzles kept in its own json (not data.js: the sim's)
export const isHero = (id) =>
  typeof id === 'string' && /^[a-z]+$/.test(id) && fs.existsSync(path.join(ROOT, 'live', 'assets', `c_${id}.json`));
export const tuneFile = (id) => path.join(ROOT, 'live', id === 'cat' ? 'hero.js' : `hero_${id}.js`);
export function jsonWithMuzzles(id, t) {
  const f = path.join(ROOT, 'live', 'assets', `c_${id}.json`),
    I = JSON.parse(fs.readFileSync(f, 'utf8'));
  const mz = HB.muzzles(I, t, DATA.GUN3D, I.h, SIM.HERO.s);
  mz.laser = mz.sniper || mz.laser;
  I.mz = mz;
  INFO[id] = I;
  return { f, text: JSON.stringify(I) };
}

// the motion's numbers: [least, most]
export const MOTION = {
  twist: [0, 120],
  legs: [0, 90],
  rest: [0, 90],
  legRate: [0.2, 4],
  twistRate: [0.2, 4],
  kick: [0, 4],
  kickBack: [0.2, 4],
  lobbySpeed: [0.2, 3],
  idleSpeed: [0.2, 3],
  stride: [0.5, 2],
  blink: [0, 20],
  walkV: [0.2, 1.5],
  runV: [0.3, 2.5],
  lean: [0, 20],
  leanAcc: [0, 20],
};
const num = (v, m) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= m;
const vec = (v, m) => Array.isArray(v) && v.length === 3 && v.every((x) => num(x, m));
const obj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const only = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
export function checkTune(t, id = 'cat') {
  const I = info(id);
  if (!obj(t) || t.v !== 1 || !only(t, ['v', 'guns', 'poses', 'motion'])) return 'not a tune (v: 1)';
  const place = (o, pm) =>
    obj(o) && only(o, ['p', 'r']) && (o.p === undefined || vec(o.p, pm)) && (o.r === undefined || vec(o.r, 180));
  // a paw: moved and turned on the gun, and its fingers bent (f: five fingers and the spread, degrees: herobake.js bend)
  const paw = (o) =>
    obj(o) &&
    only(o, ['p', 'r', 'f']) &&
    place({ p: o.p, r: o.r }, 0.3) &&
    (o.f === undefined || (Array.isArray(o.f) && o.f.length === 6 && o.f.every((x) => num(x, 120))));
  if (!obj(t.guns)) return 'guns';
  for (const [g, o] of Object.entries(t.guns)) {
    if (!I.holds.includes(g) || !obj(o) || !only(o, ['scale', 'aim', 'lobby'])) return 'guns: ' + g;
    if (o.scale !== undefined && !(num(o.scale, 2) && o.scale >= 0.5)) return 'guns: ' + g + ' scale';
    for (const k of ['aim', 'lobby']) {
      const q = o[k];
      if (q === undefined) continue;
      if (
        !obj(q) ||
        !only(q, ['p', 'r', 'pawR', 'pawL']) ||
        !place({ p: q.p, r: q.r }, 0.5) ||
        (q.pawR !== undefined && !paw(q.pawR)) ||
        (q.pawL !== undefined && !paw(q.pawL))
      )
        return 'guns: ' + g + ' ' + k;
    }
  }
  if (!obj(t.poses)) return 'poses';
  for (const [c, P] of Object.entries(t.poses)) {
    // (a clip the model no longer has: the aiming idle and the lobby's, gone with the stance — herobake.js — their poses kept unused)
    const A = I.anims[c] || (/^(idle|lobby)_/.test(c) && { n: 1000 });
    if (!A || !obj(P)) return 'poses: ' + c;
    for (const [k, tr] of Object.entries(P)) {
      if (!HB.PARTS.includes(k) || !obj(tr) || !only(tr, ['r', 'k'])) return 'poses: ' + c + ' ' + k;
      if (tr.r !== undefined && !vec(tr.r, 180)) return 'poses: ' + c + ' ' + k;
      if (
        tr.k !== undefined &&
        !(
          Array.isArray(tr.k) &&
          tr.k.length <= 200 &&
          tr.k.every(
            (q, i) =>
              Array.isArray(q) &&
              q.length === 4 &&
              Number.isInteger(q[0]) &&
              q[0] >= 0 &&
              q[0] < A.n &&
              (i === 0 || q[0] > tr.k[i - 1][0]) &&
              vec(q.slice(1), 180),
          )
        )
      )
        return 'poses: ' + c + ' ' + k + ' keys';
    }
  }
  if (!obj(t.motion)) return 'motion';
  for (const [k, v] of Object.entries(t.motion))
    if (!MOTION[k] || !(typeof v === 'number' && v >= MOTION[k][0] && v <= MOTION[k][1])) return 'motion: ' + k;
  return '';
}

export function tuneSource(t) {
  const block = (k) => {
    const o = t[k],
      ks = Object.keys(o);
    return !ks.length
      ? `    ${k}: {},`
      : `    ${k}: {\n${ks.map((n) => `      ${JSON.stringify(n)}: ${JSON.stringify(o[n])},`).join('\n')}\n    },`;
  };
  return `// live/hero.js — the hero's tune, made in the character editor (hero-editor.bat → /live/index.html?hero) and written by its server
// (server/herofile.mjs). hero3d.js lays it over the cat's baked clips (herobake.js); the sim's muzzles in data.js (D.HERO3D) follow it.
// guns: per gun its scale and its place aiming (aim: idle and run) and in the lobby: p moved (model units: x its left, y up, z along
//   the barrel), r turned (degrees about those axes at its grip); pawR / pawL: each paw moved and turned on it the same way, f its
//   fingers bent [thumb, index, middle, ring, pinky, spread] (degrees).
// poses: per clip, per part of the body (herobake.js PARTS; the elbows: their swing round the line from shoulder to paw) its turn
//   [forward, to its left, leaning right] in degrees: r for the whole clip, or k keyed [[frame, x, y, z], ...] (a loop through them).
// motion (hero3d.js): twist, legs, rest (degrees), legRate, twistRate, kick, kickBack, lobbySpeed, idleSpeed, stride (×), blink (s, 0: never).
(function (root) {
  const T = {
    v: 1,
${['guns', 'poses', 'motion'].map(block).join('\n')}
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// is base (the tune an editor page loaded or last saved) what live/hero.js's text holds now (else the page is out of date: another tab
// saved, or the file was changed by hand): the file is tuneSource's text, so base written out again is the same text
export const sameAsFile = (base, text) =>
  !!base && checkTune(base) === '' && tuneSource(base).replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n');

// data.js with the muzzles the tune gives (a gun it leaves as baked keeps the export's numbers, which round a little differently)
export function dataWithMuzzles(text, t) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n',
    A0 = '  // <hero3d>' + nl,
    A1 = '  // </hero3d>' + nl; // (data.js has Windows line ends: the export writes it so)
  const i = text.indexOf(A0),
    j = text.indexOf(A1);
  if (i < 0 || j < 0) throw new Error('data.js: no <hero3d> block');
  const line = text.slice(i + A0.length, j),
    H = JSON.parse(line.slice(line.indexOf('=') + 1, line.lastIndexOf(';')));
  const I = info(),
    now = HB.muzzles(I, t, DATA.GUN3D, H.h, SIM.HERO.s),
    base = HB.muzzles(I, {}, DATA.GUN3D, H.h, SIM.HERO.s),
    mz = {};
  for (const g in now) {
    const same = now[g].every((v, k) => Math.abs(v - base[g][k]) < 1e-9),
      old = H.mz[g];
    mz[g] = same && old && old.every((v, k) => Math.abs(v - base[g][k]) < 3e-4) ? old : now[g];
  }
  return text.slice(0, i) + A0 + '  D.HERO3D = ' + JSON.stringify({ h: H.h, mz }) + ';' + nl + text.slice(j);
}

// live/hero_pack.js: where the hero's backpacks sit on his back (hero3d.js). { v: 1, packs: { 1, 2: { p, r, s } }, base?: { 1, 2 } }:
// per backpack (1 the simple one, 2 the upgraded one) p the middle of its back panel (model units at rest), r its turn (degrees), s its
// height (model units); packs as he holds a gun (a run), base without one (the menus and NEAR Base: none there, as in a run)
export const PACK_FILE = path.join(ROOT, 'live', 'hero_pack.js');
export function checkPack(P) {
  if (
    !obj(P) ||
    P.v !== 1 ||
    !only(P, ['v', 'packs', 'base']) ||
    !obj(P.packs) ||
    (P.base !== undefined && !obj(P.base))
  )
    return 'not a backpack placement (v: 1, packs, base)';
  for (const k of ['packs', 'base'])
    for (const [n, q] of Object.entries(P[k] || {})) {
      if (n !== '1' && n !== '2') return k + ': ' + n;
      if (!obj(q) || !only(q, ['p', 'r', 's']) || !vec(q.p, 1) || !vec(q.r, 180)) return k + ': ' + n;
      if (!(num(q.s, 1) && q.s >= 0.05)) return k + ': ' + n + ' size';
    }
  return '';
}
export function packSource(P) {
  const list = (o) =>
    Object.keys(o)
      .sort()
      .map((n) => `      ${n}: ${JSON.stringify(o[n])},`)
      .join('\n');
  const base = P.base && Object.keys(P.base).length ? `\n    base: {\n${list(P.base)}\n    },` : '';
  return `// live/hero_pack.js — where Copper's backpacks sit on his back, made in the character editor (hero-editor.bat → /live/index.html?hero,
// its backpack section) and written by its server (server/herofile.mjs). hero3d.js carries the one he wears on his chest bone.
// packs: per backpack (1: the simple one, 2: the upgraded one, art/hero3d/backpack.py → assets/c_bp<n>.*) p where the middle of its
//   back panel is (model units, standing at rest: x his left, y up, z the way he faces), r its turn (degrees about those axes, x first:
//   x tips its top toward his head, y turns it to his left, z leans it), s its height (model units: his is 1). As he holds a gun (a run).
// base: the same without a gun (the menus and NEAR Base: the model's own idles, walk and run); one not here sits as with the gun.
(function (root) {
  const P = {
    v: 1,
    packs: {
${list(P.packs)}
    },${base}
  };
  root.HERO_PACK = P;
  if (typeof module !== 'undefined') module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}
// is base (the placement an editor page loaded or last saved) what live/hero_pack.js's text holds now (as sameAsFile for the tune)
export const samePack = (base, text) =>
  !!base && checkPack(base) === '' && packSource(base).replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n');
