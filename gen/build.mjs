// The packed game for the web: node gen/build.mjs [out=dist/game]   (PLAYWRIGHT=<path>/node_modules/playwright; python with Pillow)
// live/ stays as it is; the copy in <out> is what the site serves:
// - every in-game sprite at the size it takes in the atlas (the page is asked: B.R at a 4096 atlas, as gen/packslim.mjs does), the
//   DOM pictures capped (the guns' and the items' icons, the location cards, the ui_ pictures), resized with premultiplied Lanczos;
// - next to each picture a .webp (the site's nginx sends it to the browsers that take it: Accept: image/webp), PNG/JPEG stay as the
//   fallback;
// - next to each mesh, JSON, script and style a .gz (nginx gzip_static);
// - index.html: window.__STATIC__ (no polling of the sources, no dev keys) and the build's stamp (?v= on every file).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  LIVE = path.join(ROOT, 'live');
const FINAL = path.resolve(ROOT, process.argv[2] || 'dist/game'),
  OUT = FINAL + '.new',
  PORT = 8939; // (built beside, swapped in at the end: a failed build leaves the last one whole)
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');

// ---- the copy: everything but the art, which is written below
fs.rmSync(OUT, { recursive: true, force: true });
const ART = path.join(LIVE, 'assets');
// characters being made beside the game's hero (bosses3d.js hero entries other than the cat: the character editor's ?heroid): local only
const B3 = (() => {
  const t = fs.readFileSync(path.join(LIVE, 'bosses3d.js'), 'utf8');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
})();
const OTHER = Object.keys(B3).filter((k) => B3[k].hero && k !== 'cat'),
  other = (b) => OTHER.some((k) => b === `hero_${k}.js` || b.startsWith(`c_${k}.`) || b.startsWith(`c_${k}_`));
fs.cpSync(LIVE, OUT, {
  recursive: true,
  filter: (s) =>
    s !== ART &&
    !s.startsWith(ART + path.sep) &&
    !/\.cjs$/.test(s) &&
    !/\.local\./.test(path.basename(s)) && // (pages for this PC only: a sign-in for a test account, a scene set up to look at)
    !['editor.js', 'heroeditor.js', 'econ.js', 'econ.html', 'econbot.js', 'voices.js', 'voices.html'].includes(
      path.basename(s),
    ) &&
    !other(path.basename(s)),
}); // (the map and character editors, the economy page and the voice lines page: local only)
fs.mkdirSync(path.join(OUT, 'assets'));

// ---- the plan: each atlas entry's size, from the running page
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'md-build-'));
const srv = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT)], {
  env: { ...process.env, DATA_DIR: data },
  stdio: 'ignore',
});
let plan;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const b = await chromium.launch({
    channel: process.env.PW_CHANNEL || undefined,
    args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const p = await b.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/live/index.html?render=1`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 300000 });
  plan = await p.evaluate(() => {
    const B = window.BATCH,
      k = B.size / 4096,
      out = {};
    for (const n in B.R) if (ASSETS[n]) out[n] = [Math.ceil(B.R[n].aw / k), Math.ceil(B.R[n].ah / k)];
    return out;
  });
  await b.close();
} finally {
  srv.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
const resize = { ...plan }; // [w, h]; 0: keep the aspect
for (const f of fs.readdirSync(path.join(LIVE, 'assets'))) {
  const n = f.replace(/\.[a-z]+$/, '');
  if (resize[n] && !/^(i|w)_/.test(n)) continue; // (an item's icon is small in the atlas, but the menus show it big: the DOM cap below)
  if (/^bg_loc_/.test(n))
    resize[n] = [800, 0]; // the location cards (DOM, a few hundred px wide)
  else if (/^(i|w)_/.test(n))
    resize[n] = [400, 0]; // the guns' and items' icons (DOM)
  else if (/^ui_/.test(n))
    resize[n] = [600, 0]; // the results and chest pictures (DOM)
  else if (/^(c|t)_.*\.jpg$/.test(f) && n !== 'c_cat') resize[n] = [1024, 0];
} // the 3D bosses' and guns' textures (a boss a few hundred px tall on screen; the hero cat keeps its 2048: it stands big in the lobby)
console.log(Object.keys(plan).length, 'atlas entries;', Object.keys(resize).length, 'pictures resized');

// ---- the pictures (python: Pillow), the rest copied
const job = path.join(data + '-plan.json');
fs.writeFileSync(job, JSON.stringify({ src: path.join(LIVE, 'assets'), dst: path.join(OUT, 'assets'), resize }));
execFileSync(
  'python',
  [
    '-c',
    `
import json, os, sys, shutil
from PIL import Image
J = json.load(open(sys.argv[1])); src, dst, R = J['src'], J['dst'], J['resize']
for f in sorted(os.listdir(src)):
    a, b = os.path.join(src, f), os.path.join(dst, f); n, ext = os.path.splitext(f)
    if ext not in ('.png', '.jpg'): shutil.copyfile(a, b); continue
    im = Image.open(a); im.load(); w, h = im.size
    if n in R:
        tw, th = R[n]; th = th or round(tw * h / w)
        if tw < w and th < h:
            alpha = im.mode in ('RGBA', 'LA', 'P')
            im = im.convert('RGBA').convert('RGBa').resize((tw, th), Image.LANCZOS).convert('RGBA') if alpha else im.convert('RGB').resize((tw, th), Image.LANCZOS)
            im.save(b, optimize=True) if ext == '.png' else im.save(b, quality=88)
        else: shutil.copyfile(a, b)
    else: shutil.copyfile(a, b)
    q = 94 if n == 'c_cat' else 80 if n.startswith('bg_') else 86   # the hero's colour finer; big painted backgrounds hide 80
    if n.startswith('mask_'): im.save(os.path.join(dst, f + '.webp'), 'WEBP', lossless=True, method=6)   # a mask's channels exact
    else: im.save(os.path.join(dst, f + '.webp'), 'WEBP', quality=q, method=6)
`,
    job,
  ],
  { stdio: 'inherit' },
);
fs.rmSync(job);

// ---- index.html: the packed build, its stamp
const stamp = String(Math.floor(Date.now() / 1000)),
  ix = path.join(OUT, 'index.html'),
  html = fs.readFileSync(ix, 'utf8'),
  LINK = '<link rel="stylesheet" href="style.css">';
if (!html.includes(LINK)) throw new Error('index.html: no style.css link to mark the build at'); // (else the site would run the dev page: polling, dev keys)
// (the page's Content-Security-Policy runs an inline script only with its nonce: the stamp's script carries it too)
const nonce = (/'nonce-([A-Za-z0-9+/=]+)'/.exec(html) || [])[1];
if (!nonce)
  throw new Error("index.html: no script nonce in its Content-Security-Policy (the build's stamp couldn't run)");
fs.writeFileSync(
  ix,
  html.replace(
    LINK,
    `<link rel="stylesheet" href="style.css?v=${stamp}"><script nonce="${nonce}">window.__STATIC__ = 1; window.__BUILD__ = '${stamp}';</script>`,
  ),
);
const css = path.join(OUT, 'style.css'); // the pictures the style names: this build's too
fs.writeFileSync(css, fs.readFileSync(css, 'utf8').replace(/url\((assets\/[^)?]+)\)/g, `url($1?v=${stamp})`));

// ---- gzip next to what compresses
const walk = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(OUT))
  if (/\.(bin|json|js|css|html|svg|txt|webmanifest)$/.test(f))
    fs.writeFileSync(f + '.gz', zlib.gzipSync(fs.readFileSync(f), { level: 9 }));

fs.rmSync(FINAL, { recursive: true, force: true });
fs.renameSync(OUT, FINAL);
const size = (re) =>
  walk(FINAL)
    .filter((f) => re.test(f))
    .reduce((a, f) => a + fs.statSync(f).size, 0) / 1e6;
console.log('build', stamp, '→', FINAL);
console.log(
  'pictures: png/jpg',
  size(/\.(png|jpg)$/).toFixed(1),
  'MB, webp',
  size(/\.webp$/).toFixed(1),
  'MB; gz',
  size(/\.gz$/).toFixed(1),
  'MB',
);
