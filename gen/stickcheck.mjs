// The touch sticks around card and chest screens, with real touch events (CDP): node gen/stickcheck.mjs [url] (needs a game server, default :8930)
// (CDP touchStart: the points pressed so far plus the new one; touchMove: all held points; touchEnd: the points let go)
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const [url = 'http://127.0.0.1:8930/live/index.html'] = process.argv.slice(2);
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await b.newContext({
  ...devices['Pixel 7'],
  viewport: { width: 915, height: 412 },
  isMobile: true,
  hasTouch: true,
});
const p = await ctx.newPage(),
  cdp = await ctx.newCDPSession(p),
  log = [],
  fails = [];
p.on('pageerror', (e) => log.push('pageerror ' + e.message));
await p.addInitScript(() => {
  try {
    sessionStorage.setItem('md.guest', '1');
    sessionStorage.removeItem('live');
  } catch (e) {}
  window.__pev = [];
  for (const k of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture'])
    addEventListener(
      k,
      (e) => {
        if (e.pointerType !== 'mouse')
          window.__pev.push(k + ':' + e.pointerId + ':' + (e.target.id || e.target.className || e.target.tagName));
      },
      true,
    );
});
const pt = ([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(pt) });
const st = () =>
  p.evaluate(() => ({
    J: [__joy.on, +__joy.x.toFixed(2), +__joy.y.toFixed(2)],
    A: [__aim.on, +__aim.x.toFixed(2), +__aim.y.toFixed(2)],
    pause: GAME.play && GAME.play.pause ? GAME.play.pause.k : null,
    ev: __pev.splice(0),
  }));
async function fresh(w = 'shotgun') {
  await p.goto(url + '?autoplay=' + w);
  for (let i = 0; i < 240; i++) {
    await p.waitForTimeout(500);
    if (await p.evaluate(() => !!(window.GAME && GAME.play && GAME.play.t > 0.5 && !GAME.play.pause))) break;
  }
  await p.evaluate(() => {
    GAME.play.p.god = true;
  });
}
const Lf = [110, 260, 1],
  Af = [720, 260, 2];
const lvl = () => p.evaluate(() => SIM.cheat(GAME.play, 'lvl'));
const chest = () =>
  p.evaluate(() => {
    GAME.play.pause = { k: 'chest', kind: 'air', items: [{ ty: 'new', id: 'gravity', lvl: 1 }], t: 0 };
  });
const center = (sel) =>
  p.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, sel);
const press = async (f) => {
  held.push(f);
  await touch('touchStart', held);
  await p.waitForTimeout(50);
};
const move = async (id, x, y) => {
  const f = held.find((h) => h[2] === id);
  f[0] = x;
  f[1] = y;
  await touch('touchMove', held);
  await p.waitForTimeout(50);
};
const lift = async (id) => {
  const i = held.findIndex((h) => h[2] === id),
    f = held.splice(i, 1)[0];
  await touch('touchEnd', [f]);
  await p.waitForTimeout(50);
};
let held = [];
async function check(name) {
  // after the screen: nothing held, the sticks off, a new thumb on the left half walks and lets go
  const s0 = await st();
  held = [];
  await touch(
    'touchStart',
    [pt([200, 330, 9])].map((q) => [q.x, q.y, q.id]),
  );
  await p.waitForTimeout(60);
  await touch('touchMove', [[280, 330, 9]]);
  await p.waitForTimeout(150);
  const s1 = await st();
  await touch('touchEnd', [[280, 330, 9]]);
  await p.waitForTimeout(100);
  const s2 = await st();
  const ok = !s0.J[0] && !s0.A[0] && s1.J[0] && s1.J[1] > 0.5 && !s2.J[0] && !s1.pause;
  log.push(
    (ok ? 'ok   ' : 'FAIL ') +
      name +
      '  after ' +
      JSON.stringify(s0) +
      ' walk ' +
      JSON.stringify(s1.J) +
      ' let go ' +
      JSON.stringify(s2.J),
  );
  if (!ok) fails.push(name);
}
async function scenario(name, fn) {
  await fresh();
  held = [];
  try {
    await fn();
  } catch (e) {
    log.push('threw ' + name + ': ' + e.message);
    fails.push(name);
  }
  await check(name);
}
const pickWith = async (id, sel = '[data-pick]') => {
  const r = await center(sel);
  if (!r) throw new Error('no ' + sel);
  await press([r[0], r[1], id]);
  await p.waitForTimeout(60);
  await lift(id);
  await p.waitForTimeout(350);
};

await scenario('both held, cards, both let go, card tapped', async () => {
  await press([...Lf]);
  await press([...Af]);
  await move(1, 60, 210);
  await move(2, 680, 220);
  await lvl();
  await p.waitForTimeout(700);
  await lift(1);
  await lift(2);
  await p.waitForTimeout(400);
  await pickWith(5);
});
await scenario('left held, cards, card tapped by the other thumb, left let go after', async () => {
  await press([...Lf]);
  await move(1, 60, 210);
  await lvl();
  await p.waitForTimeout(700);
  await pickWith(5);
  await p.waitForTimeout(300);
  await lift(1);
});
await scenario('both held, cards, a third finger picks, both let go after', async () => {
  await press([...Lf]);
  await press([...Af]);
  await move(1, 60, 210);
  await move(2, 680, 220);
  await lvl();
  await p.waitForTimeout(700);
  await pickWith(5);
  await p.waitForTimeout(300);
  await lift(1);
  await lift(2);
});
await scenario('left held, cards, picked, left let go while the screen fades', async () => {
  await press([...Lf]);
  await move(1, 60, 210);
  await lvl();
  await p.waitForTimeout(700);
  const r = await center('[data-pick]');
  await press([r[0], r[1], 5]);
  await p.waitForTimeout(60);
  await lift(5);
  await p.waitForTimeout(40);
  await lift(1);
});
await scenario('left held, cards, the left thumb drags over the cards and lets go there, card tapped', async () => {
  await press([...Lf]);
  await move(1, 60, 210);
  await lvl();
  await p.waitForTimeout(700);
  const r = await center('[data-pick]');
  for (let k = 1; k <= 6; k++) await move(1, 60 + ((r[0] - 60) * k) / 6, 210 + ((r[1] - 210) * k) / 6);
  await lift(1);
  await p.waitForTimeout(400);
  await pickWith(5);
});
await scenario('left held, chest, left let go, take', async () => {
  await press([...Lf]);
  await move(1, 60, 210);
  await chest();
  await p.waitForTimeout(700);
  await lift(1);
  await p.waitForTimeout(400);
  await pickWith(5, '[data-take]');
});
await scenario('left held, chest, take with the other thumb, left let go after', async () => {
  await press([...Lf]);
  await move(1, 60, 210);
  await chest();
  await p.waitForTimeout(700);
  await pickWith(5, '[data-take]');
  await p.waitForTimeout(300);
  await lift(1);
});
await scenario('both held, two level-ups in a row, picks with a third finger, both let go after', async () => {
  await press([...Lf]);
  await press([...Af]);
  await move(1, 60, 210);
  await move(2, 680, 220);
  await lvl();
  await lvl();
  await p.waitForTimeout(700);
  await pickWith(5);
  await p.waitForTimeout(600);
  await pickWith(6);
  await p.waitForTimeout(300);
  await lift(1);
  await lift(2);
});
await scenario(
  'both sticks left held by releases that never came (as on the phone), a tap anywhere and let go',
  async () => {
    await p.evaluate(() => {
      Object.assign(__joy, { on: true, id: 999, x: -0.7, y: -0.7 });
      Object.assign(__aim, { on: true, id: 998, x: -0.7, y: -0.7 });
    });
    await p.waitForTimeout(300);
    log.push('  stuck ' + JSON.stringify(await st()));
    await press([450, 120, 5]);
    await lift(5);
    await p.waitForTimeout(200);
  },
);
console.log(log.join('\n'));
console.log(JSON.stringify({ fails }));
await b.close();
