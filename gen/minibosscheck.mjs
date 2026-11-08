// The mini-bosses' attacks in a real run: node gen/minibosscheck.mjs [outdir]   (needs the live server on :8930)
// The pustule's volley of acid balls (marks, flight, splash, puddles), the screamer's scream and howl (damage inside its ring),
// and a spitter's acid flying over a wall. Saves frames and prints the hero's hp before/after each attack; fails on page errors
// or when an attack that should hurt does not.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const out = process.argv[2] || 'frames/miniboss';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [],
  fails = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto('http://127.0.0.1:8930/live/index.html');
await p.evaluate(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {}
});
await p.reload();
await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const wait = (ms) => p.waitForTimeout(ms);
await p.evaluate(() => GAME.start('pistol'));
await wait(1500);
// a clean stage: no spawns, no other bosses, the hero tough (not god: damage must land) and unable to shoot
const reset = () =>
  p.evaluate(() => {
    const S = GAME.play;
    S.en = [];
    S.eb = [];
    S.pud = [];
    S.tele = [];
    S.done = { butcher: 1, pustule: 1, screamer: 1, golem: 1 };
    S.spawnT = 1e9;
    S.spawnAcc = -1e9;
    S.p.hp = S.p.maxHp = 5000;
    S.p.st.armor = 0;
    S.p.main.cd = 1e9;
    S.nextHorde = S.nextElite = S.nextDrop = 1e9;
  });
const hp = () => p.evaluate(() => Math.round(GAME.play.p.hp));
const add = (k, dx, dy, o = {}) =>
  p.evaluate(
    ([k, dx, dy, o]) => {
      const S = GAME.play,
        e = SIM.addEnemy(S, k, S.p.x + dx, S.p.y + dy);
      Object.assign(e, o);
      e.spT = S.t - 1;
      e.st = 'chase';
      e.stT = S.t;
      e.next = S.t + 99;
      return e.id;
    },
    [k, dx, dy, o],
  );
const hold = () =>
  p.evaluate(() => {
    const S = GAME.play;
    S.p.main.cd = 1e9;
    for (const e of S.en) e.spd = 0;
  });

// 1. the pustule's acid balls
await reset();
await add('pustule', 520, -120, { globT: 0 });
await hold();
let h0 = await hp();
await wait(950);
await p.screenshot({ path: path.join(out, 'pustule_marks.png') });
await wait(800);
await p.screenshot({ path: path.join(out, 'pustule_splash.png') });
let h1 = await hp();
console.log('pustule volley hp', h0, '→', h1);
if (h1 >= h0) fails.push('pustule acid balls did no damage');

// 2. the screamer: scream + howl inside its ring
await reset();
await add('screamer', 240, -60);
await hold();
await p.evaluate(() => {
  const S = GAME.play,
    e = S.en.find((o) => o.k === 'screamer');
  e.next = S.t;
});
h0 = await hp();
await wait(1100);
await p.screenshot({ path: path.join(out, 'screamer_scream.png') });
await p.evaluate(() => {
  const S = GAME.play,
    e = S.en.find((o) => o.k === 'screamer');
  S.p.x = e.x + 200;
  S.p.y = e.y + 40;
}); // stay inside the ring
await wait(1300);
h1 = await hp();
await p.screenshot({ path: path.join(out, 'screamer_howl.png') });
console.log('screamer scream + howl hp', h0, '→', h1);
if (h0 - h1 < 25) fails.push('screamer scream/howl did too little damage: ' + (h0 - h1));
// outside the ring (677 now): no damage
await reset();
await add('screamer', 1300, -60);
await hold();
await p.evaluate(() => {
  const S = GAME.play,
    e = S.en.find((o) => o.k === 'screamer');
  e.next = S.t;
  e.st = 'wind';
  e.stT = S.t;
});
h0 = await hp();
await wait(2500);
h1 = await hp();
console.log('screamer far away hp', h0, '→', h1);
if (h1 < h0) fails.push('screamer hurt the hero outside its ring');

// 3. a spitter's acid over a wall: the hero behind a concrete wall still gets hit
await reset();
const wall = await p.evaluate(() => {
  const S = GAME.play,
    LV = SIM.level(S.seed);
  const w = LV.props.find((o) => /iso_wall|iso_cwall|iso_fence/.test(o.n) && !LV.inPlaza(o.gx, o.gy, 0));
  if (!w) return null;
  const c = w.col,
    along = c.x1 - c.x0 < c.y1 - c.y0; // thin along gx: the wall runs along gy; stand the hero on one side, the spitter on the other
  const gx1 = along ? c.x1 + 40 : (c.x0 + c.x1) / 2,
    gy1 = along ? (c.y0 + c.y1) / 2 : c.y1 + 40,
    gx2 = along ? c.x0 - 260 : gx1,
    gy2 = along ? gy1 : c.y0 - 260;
  const G = SIM.G;
  S.p.x = gx1 - gy1 + G;
  S.p.y = (gx1 + gy1) / 2;
  S.cam = [S.p.x - SIM.VIEW.W / (S.zoom || 1) / 2, S.p.y - SIM.VIEW.H / (S.zoom || 1) / 2];
  const e = SIM.addEnemy(S, 'spitter', gx2 - gy2 + G, (gx2 + gy2) / 2);
  e.spT = S.t - 1;
  e.cd = 0;
  e.spd = 0;
  return w.n;
});
h0 = await hp();
await wait(2600);
h1 = await hp();
await p.screenshot({ path: path.join(out, 'spitter_wall.png') });
console.log('spitter over', wall, 'hp', h0, '→', h1);
if (h1 >= h0) fails.push('spitter acid did not get over the wall');
console.log(JSON.stringify({ errors, fails }));
await b.close();
process.exit(errors.length || fails.length ? 1 : 0);
