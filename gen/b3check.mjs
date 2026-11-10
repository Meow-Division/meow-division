// The 3D bosses in a real run: node gen/b3check.mjs [outdir] [enemy ...]   (needs the live server on :8930)
// For every enemy drawn as a 3D model (DATA.ENEMIES[k].b3d, live/charmesh.js): spawns it beside the hero (who cannot shoot, does not die), and saves a
// close-up of it standing, walking (facing left and right), in each of its attack states (part way through), hit (flash), and its
// corpse during and after the death animation; then a contact sheet per boss. Fails on page errors or a frame the atlas lacks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const args = process.argv.slice(2),
  out = args[0] && !/^[a-z]+$/.test(args[0]) ? args.shift() : 'frames/b3';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/404|ERR_/.test(m.text())) errors.push(m.text());
});
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
const keys = args.length
  ? args
  : await p.evaluate(() =>
      Object.keys(DATA.ENEMIES).filter((k) => DATA.ENEMIES[k].b3d && CHARMESH.has(DATA.ENEMIES[k].b3d)),
    );
const STATES = {
  butcher: [
    ['wind', 0.5],
    ['rec', 0.25],
  ],
  savage: [
    ['wind', 0.5],
    ['dash', 0.3],
    ['rec', 0.25],
  ],
  pustule: [
    ['spit', 0.7],
    ['swell', 0.7],
  ],
  screamer: [
    ['wind', 0.6],
    ['howl', 0.5],
    ['cast', 0.7],
  ],
  golem: [
    ['intro', 0.6],
    ['slamw', 0.8],
    ['slam', 0.15],
  ],
};
const missing = [];
for (const k of keys) {
  const shots = [];
  const stage = (o) =>
    p.evaluate(
      ([k, o]) => {
        const S = GAME.play;
        S.en = [];
        S.eb = [];
        S.tele = [];
        S.corpses = [];
        S.done = { butcher: 1, pustule: 1, screamer: 1, golem: 1 };
        S.spawnAcc = -1e9;
        S.nextHorde = S.nextElite = S.nextDrop = 1e9;
        S.p.god = true;
        S.p.main.cd = 1e9;
        S.arena = null;
        const e = SIM.addEnemy(S, k, S.p.x + 260, S.p.y - 40);
        e.spT = S.t - 1;
        e.st = 'chase';
        e.stT = S.t;
        e.next = e.globT = e.summon = e.throwT = S.t + 99;
        Object.assign(e, o.e || {});
        if (o.st) {
          e.st = o.st;
          e.stT = S.t - o.age;
        }
        if (o.vx !== undefined) {
          e.vx = o.vx;
          e.vy = o.vy || 0;
          e.face = o.vx > 0 ? 1 : o.vx < 0 ? -1 : e.face;
          e.spd = 0;
        }
        e.ang = 3.14;
        S.__hold = { id: e.id, st: o.st, age: o.age, vx: o.vx, vy: o.vy || 0 };
        return e.id;
      },
      [k, o],
    );
  // hold the boss in place in its staged state (the sim would move it on), then freeze the frame
  const hold = () =>
    p.evaluate(() => {
      const S = GAME.play,
        H = S.__hold,
        e = S.en.find((o) => o.id === H.id);
      if (!e) return;
      e.x = S.p.x + 260;
      e.y = S.p.y - 40;
      if (H.st) {
        e.st = H.st;
        e.stT = S.t - H.age;
      }
      if (H.vx !== undefined) {
        e.vx = H.vx;
        e.vy = H.vy;
      }
    });
  const snap = async (n, ms = 500) => {
    for (let t = 0; t < ms; t += 50) {
      await hold();
      await wait(50);
    }
    const q = await p.evaluate(() => {
      const S = GAME.play,
        e = S.en.find((o) => o.id === S.__hold.id) || S.corpses[0],
        z = S.zoom || 1,
        d = DATA.ENEMIES[e.k || e.ek];
      const fr = e.k && CHARMESH.has(d.b3d) ? SCENE.b3Anim(e, d, S.t, d.h) : null,
        nm = fr ? fr[0] + ' ' + fr[1].toFixed(1) + ' yaw ' + (e.yaw ?? 0).toFixed(2) : null;
      return {
        x: (e.x - S.cam[0]) * z,
        y: (e.y - S.cam[1]) * z,
        h: d.h * z,
        frame: nm,
        has: !e.k || CHARMESH.has(d.b3d),
      };
    });
    if (!q.has) missing.push(q.frame);
    if (!isFinite(q.x + q.y + q.h)) {
      console.log('bad', n, JSON.stringify(q));
      return;
    }
    const s = Math.min(1080, q.h * 1.7),
      clip = {
        x: Math.max(0, Math.min(1920 - s, q.x - s / 2)),
        y: Math.max(0, Math.min(1080 - s, q.y - q.h * 1.3)),
        width: s,
        height: s,
      };
    const f = path.join(out, `${k}_${n}.png`);
    await p.screenshot({ path: f, clip });
    shots.push([n, f, q.frame]);
  };
  await stage({ vx: 0 });
  await snap('stand');
  await stage({ vx: -60 });
  await snap('walk_left', 900);
  await stage({ vx: 60 });
  await snap('walk_right', 900);
  await stage({ vx: 0, vy: 40 });
  await snap('walk_down', 900);
  await stage({ vx: 0, vy: -40 });
  await snap('walk_up', 900);
  for (const [st, k2] of STATES[k] || []) {
    const dur =
      {
        cast: 1.07,
        wind: 0.8,
        dash: 0.62,
        rec: 0.6,
        spit: 0.6,
        swell: 0.8,
        howl: 1.5,
        intro: 1.2,
        slamw: 1.0,
        slam: 0.7,
      }[st] || 1;
    await stage({ st, age: dur * k2, vx: 0 });
    await snap(st, 150);
  }
  await stage({ vx: 0 });
  await p.evaluate(() => {
    const S = GAME.play,
      e = S.en[0];
    e.fl = S.t;
  });
  await snap('hit', 30);
  await stage({});
  await p.evaluate(() => {
    const S = GAME.play,
      e = S.en[0];
    e.hp = 1;
    SIM.kill ? SIM.kill(S, e, null) : (e.hp = 0);
  });
  await wait(500);
  await snap('dying', 0);
  await wait(1500);
  await snap('corpse', 0);
  fs.writeFileSync(path.join(out, `${k}.json`), JSON.stringify(shots));
  console.log(k, shots.map((s) => s[0] + ':' + (s[2] || '-')).join(' '));
}
console.log(JSON.stringify({ errors, missing }));
await b.close();
process.exit(errors.length || missing.length ? 1 : 0);
