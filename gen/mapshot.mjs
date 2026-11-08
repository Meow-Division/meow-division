// The whole level as one picture: node gen/mapshot.mjs [seed] — the game's own renderer (?render=1, the local server on 8930) is
// moved over the world tile by tile (no actors, no HUD, no vignette, no screen-space key light, so the tiles join) and stitched at
// half size into frames/map_<seed>.jpg; frames/map_<seed>_marked.jpg rings every tree or bush whose trunk stands inside a prop's
// footprint (it grows through a building, a car or a wall).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const seed = +(process.argv[2] || 7);
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto('http://127.0.0.1:8930/live/index.html?render=1');
await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
const res = await p.evaluate((seed) => {
  const fx = BATCH.fx;
  BATCH.fx = function (k, x, y, rx, ry) {
    if (k === 0 && x === 120 && y === 60 && rx === 950 && ry === 600) return;
    return fx.apply(this, arguments);
  };
  const fin = LIB.finish;
  LIB.finish = (t, o) => fin(t, { ...o, vignette: 1 }); // u_vig is the edge brightness: 1 = none
  const cv = document.getElementById('c'),
    TW = 1920,
    TH = 1080,
    X0 = -640,
    Y0 = -560,
    NX = 6,
    NY = 6,
    sc = 0.5;
  const big = document.createElement('canvas');
  big.width = NX * TW * sc;
  big.height = NY * TH * sc;
  const g = big.getContext('2d');
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const s = SIM.create({ seed });
      Object.assign(s, {
        demo: true,
        neutral: true,
        zoom: 1,
        en: [],
        ev: [],
        dec: [],
        corpses: [],
        pk: [],
        gems: [],
        chests: [],
        bul: [],
        pud: [],
      });
      s.p.x = s.p.y = -99999;
      s.cam = [X0 + i * TW, Y0 + j * TH];
      SCENE.state = s;
      for (let k = 0; k < 3; k++) SCENE.render(s.t);
      g.drawImage(cv, i * TW * sc, j * TH * sc, TW * sc, TH * sc);
    }
  const LV = SIM.level(seed),
    bad = [];
  for (const [arr, kind] of [
    [LV.trees, 'tree'],
    [LV.bushes, 'bush'],
  ])
    for (const q of arr) {
      const o = LV.props.find((o) => q.gx > o.col.x0 && q.gx < o.col.x1 && q.gy > o.col.y0 && q.gy < o.col.y1);
      if (o) bad.push({ kind, x: q.x, y: q.y, in: o.n });
    }
  const plain = big.toDataURL('image/jpeg', 0.88);
  g.lineWidth = 4;
  g.strokeStyle = '#ff2a2a';
  for (const q of bad) {
    g.beginPath();
    g.arc((q.x - X0) * sc, (q.y - Y0 - (q.kind === 'tree' ? 60 : 20)) * sc, q.kind === 'tree' ? 34 : 20, 0, 6.29);
    g.stroke();
  }
  const byIn = {};
  for (const q of bad) byIn[q.in] = (byIn[q.in] || 0) + 1;
  return {
    plain,
    marked: big.toDataURL('image/jpeg', 0.85),
    props: LV.props.length,
    trees: LV.trees.length,
    bushes: LV.bushes.length,
    inside: bad.length,
    byIn,
  };
}, seed);
fs.mkdirSync('frames', { recursive: true });
fs.writeFileSync(`frames/map_${seed}.jpg`, Buffer.from(res.plain.split(',')[1], 'base64'));
fs.writeFileSync(`frames/map_${seed}_marked.jpg`, Buffer.from(res.marked.split(',')[1], 'base64'));
console.log(
  JSON.stringify({
    seed,
    props: res.props,
    trees: res.trees,
    bushes: res.bushes,
    plantsInsideProps: res.inside,
    byIn: res.byIn,
    errors,
  }),
);
await b.close();
