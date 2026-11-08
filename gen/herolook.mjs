// The hero, seen: node gen/herolook.mjs [gun] — the lobby (frames/hero_lobby.png), then a run with gun (default the save's): standing, then
// walking right, down, left and up (frames/hero_run_<k>.png, the hero cropped and enlarged). Fails on page errors.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const gun = process.argv[2] || null;
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = []; p.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); }); p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_NO_BUFFER_SPACE|Failed to load resource/.test(m.text()) || /character mesh/.test(m.text())) errors.push(m.text()); });
await p.goto('http://127.0.0.1:8930/live/index.html'); await p.evaluate(() => { sessionStorage.clear(); sessionStorage.setItem('zh.guest', '1'); }); await p.reload();   // (no wallet offer)
await p.waitForFunction(() => window.LOBBY && LOBBY.ready() && document.querySelector('#lobby .cta') && HERO3D.ready(), null, { timeout: 60000 });
await p.waitForTimeout(1500); await p.screenshot({ path: 'frames/hero_lobby.png' });
if (gun) await p.evaluate((g) => { SAVE.selected = g; }, gun);
await p.click('#lobby [data-play]'); await p.waitForTimeout(1500);
const shot = async (name) => {
  const r = await p.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(), pl = GAME.play && GAME.play.st ? GAME.play.st.p : (window.ST && ST.p); return { c: [c.left, c.top, c.width, c.height], W: G.W, H: G.H }; });
  await p.screenshot({ path: `frames/hero_run_${name}.png`, clip: { x: r.c[0] + r.c[2] * 0.3, y: r.c[1] + r.c[3] * 0.2, width: r.c[2] * 0.4, height: r.c[3] * 0.6 } });
};
await shot('stand');
for (const [k, key] of [['right', 'd'], ['down', 's'], ['left', 'a'], ['up', 'w']]) {
  await p.keyboard.down(key); await p.waitForTimeout(700); await shot(k + '1'); await p.waitForTimeout(170); await shot(k + '2'); await p.keyboard.up(key);
}
console.log(JSON.stringify({ errors }));
await b.close();
process.exit(errors.length ? 1 : 0);
