// Slim the packed game's textures: node gen/packslim.mjs [dist/zombie-horde/game]   (after pack.py; needs the live server on :8930)
// The page packs every in-game sprite into an atlas at a fraction of its painted size (scene.js S.load), but used to download the
// full painting first. This asks the running page what size each sprite takes in the atlas (B.R at a 4096 atlas, the largest), and
// rewrites the packed copy at that size (premultiplied Lanczos, so edges get no dark fringe); batch.js sizes atlas entries from the
// manifest, so a smaller file lands in the same place at the same size. The location thumbnails (DOM <img>, at most a few hundred
// CSS px wide) are capped at 800 px, the guns' menu pictures (i_<gun>) at 400 px; the guns held (w_*) stay whole. Textures the game never loads are left out: each rig's whole painting (the rig draws its parts),
// the 2D hero the 3D penguin replaced, and early backgrounds. live/assets is never touched. The packed game is then opened and any
// failed request fails the run.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const game = process.argv[2] || 'dist/zombie-horde/game',
  dir = path.join(game, 'assets');
const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8930/live/index.html?render=1');
await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const plan = await p.evaluate(() => {
  const B = window.BATCH,
    k = B.size / 4096,
    out = {};
  for (const n in B.R) if (ASSETS[n]) out[n] = [Math.ceil(B.R[n].aw / k), Math.ceil(B.R[n].ah / k)];
  return { atlas: out, rigs: Object.keys(RIGS) };
});
const drop = new Set([
  ...plan.rigs.filter((r) => fs.existsSync(path.join(dir, r + '.png'))),
  ...fs
    .readdirSync(dir)
    .filter((f) => /^a_hero(__|\.)/.test(f))
    .map((f) => f.slice(0, -4)),
  'hero2',
  'hero3',
  'bg_lobby',
  'bg_lobby_city',
  'sky_lobby',
]); // (the lobby draws bg_lobby2)
const resize = {};
for (const [n, [w, h]] of Object.entries(plan.atlas)) resize[n] = [w, h];
for (const f of fs.readdirSync(dir)) if (/^bg_loc_/.test(f)) resize[f.slice(0, -4)] = [800, 0]; // 0: keep the aspect
for (const g of Object.keys(
  JSON.parse(
    execFileSync('node', ['-e', 'process.stdout.write(JSON.stringify(require("./live/data.js").GUN3D))']).toString(),
  ),
))
  resize['i_' + g] = [400, 0]; // the guns' menu pictures (the references, DOM, up to a few hundred px): not the atlas size
// the guns' meshes and their atlases (live/gunmesh.js), the 3D bosses' (c_*: live/charmesh.js) — pack.py copies textures only
for (const f of fs.readdirSync('live/assets'))
  if (/^m_[a-z]+\.bin$|^t_[a-z]+\.jpg$|^c_[a-z0-9_]+\.(bin|json|jpg)$/.test(f))
    fs.copyFileSync(path.join('live/assets', f), path.join(dir, f));
const before = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
for (const n of drop) fs.rmSync(path.join(dir, n + '.png'), { force: true });
const job = path.join(process.env.TEMP || '.', 'packslim_plan.json');
fs.writeFileSync(job, JSON.stringify({ dir, resize }));
execFileSync(
  'python',
  [
    '-c',
    `
import json, sys
from PIL import Image
J = json.load(open(sys.argv[1])); n = 0
for name, (w, h) in J['resize'].items():
    p = J['dir'] + '/' + name + '.png'
    try: im = Image.open(p)
    except FileNotFoundError: continue
    if not h: h = round(im.height * w / im.width)
    if w >= im.width or h >= im.height: continue
    rgba = im.convert('RGBA')
    out = rgba.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA') if rgba.getextrema()[3][0] < 255 else rgba.convert('RGB').resize((w, h), Image.LANCZOS)
    out.save(p, optimize=True); n += 1
print('resized', n)
`,
    job,
  ],
  { stdio: 'inherit' },
);
const after = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
// a build stamp: the packed page fetches its scripts and textures as ?v=<stamp>, so the browser caches them until the next build
{
  const f = path.join(game, 'index.html'),
    stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  fs.writeFileSync(
    f,
    fs
      .readFileSync(f, 'utf8')
      .replace(
        /window\.__STATIC__ = 1;(?: window\.__BUILD__ = '\d+';)?/,
        `window.__STATIC__ = 1; window.__BUILD__ = '${stamp}';`,
      ),
  );
  console.log('build', stamp);
}
console.log(
  `dropped ${drop.size}: ${[...drop].join(' ')}\ntextures ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`,
);

// the packed game must load everything it asks for: lobby, every menu page, a run with a level-up
const bad = [],
  q = await b.newPage({ viewport: { width: 1600, height: 900 } });
q.on('requestfailed', (r) => bad.push('failed ' + r.url()));
q.on('response', (r) => {
  if (r.status() >= 400) bad.push(r.status() + ' ' + r.url());
});
q.on('pageerror', (e) => bad.push('error ' + e.message));
const url = 'http://127.0.0.1:8930/' + game.replace(/\\/g, '/') + '/index.html';
await q.goto(url);
await q.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await q.reload();
await q.waitForFunction(() => document.querySelector('#lobby .cta') && window.LOBBY && LOBBY.ready(), null, {
  timeout: 120000,
});
for (const go of ['arsenal', 'upgrades', 'maps', 'heroes', 'roadmap']) {
  await q.evaluate((g) => document.querySelector(`#lobby [data-go="${g}"]`).click(), go);
  await q.waitForTimeout(1200);
  await q.evaluate(() => UI.lobby());
  await q.waitForTimeout(400);
}
await q.evaluate(() => GAME.start('pistol'));
await q.waitForTimeout(1500);
await q.evaluate(() => SIM.cheat(GAME.play, 'lvl'));
await q.waitForTimeout(1200);
console.log(JSON.stringify({ bad: bad.filter((s) => !/fonts\.g/.test(s)) }));
await b.close();
process.exit(bad.filter((s) => !/fonts\.g/.test(s)).length ? 1 : 0);
