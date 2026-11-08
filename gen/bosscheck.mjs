// The final boss in a real run: node gen/bosscheck.mjs [outdir]   (needs the live server on :8930)
// Starts a run, jumps the clock to just before the final boss (the earlier bosses marked done), and saves the arena, the boss
// facing left and right, zombies crawling out of him, a volley of thrown lumps, each phase's banner and tint, and a close-up of
// each. Prints the boss's state and any page errors.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const out = process.argv[2] || 'frames/boss';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/404|ERR_NO_BUFFER_SPACE/.test(m.text())) errors.push(m.text());
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
await p.waitForFunction(() => GAME.play, null, { timeout: 120000 });
await p.evaluate(() => {
  const S = GAME.play;
  S.p.god = true;
  S.done = { butcher: 1, pustule: 1, screamer: 1 };
  S.t = 539.2;
});
await wait(3200);
const boss = () =>
  p.evaluate(() => {
    const S = GAME.play,
      e = S.en.find((o) => !o.dead && DATA.ENEMIES[o.k].boss === 'boss');
    if (!e) return null;
    const z = S.zoom || 1,
      d = DATA.ENEMIES[e.k];
    return {
      k: e.k,
      st: e.st,
      phase: e.phase,
      face: e.face,
      hp: Math.round(e.hp),
      x: (e.x - S.cam[0]) * z,
      y: (e.y - S.cam[1]) * z,
      h: d.h * z,
      arena: !!S.arena,
    };
  });
const clipAt = (q) => {
  const s = Math.min(q.h * 1.5, 1080),
    x = Math.min(Math.max(0, q.x - s / 2), 1920 - s),
    y = Math.min(Math.max(0, q.y - q.h * 1.35), 1080 - s);
  return { x, y, width: s, height: s };
}; // inside the viewport
const shot = async (n, full) => {
  const q = await boss();
  console.log(n, JSON.stringify(q));
  await p.screenshot({ path: path.join(out, n + '.png'), ...(full || !q ? {} : { clip: clipAt(q) }) });
};
await shot('arena', true);
const freeze = () => p.keyboard.press('KeyP');
for (const [n, dx] of [
  ['face_right', 420],
  ['face_left', -420],
]) {
  // the player on that side: the boss turns to face him
  await p.evaluate((dx) => {
    const S = GAME.play,
      e = S.en.find((o) => !o.dead && DATA.ENEMIES[o.k].boss === 'boss');
    S.p.x = e.x + dx;
    S.p.y = e.y + 40;
    e.next = S.t + 9;
    e.summon = S.t + 9;
  }, dx);
  await wait(1400);
  await freeze();
  await wait(300);
  await shot(n);
  await shot(n + '_full', true);
  await freeze();
}
// zombies crawl out of him (a burst of gore), then a volley of lumps of flesh with their landing marks
await p.evaluate(() => {
  const S = GAME.play,
    e = S.en.find((o) => !o.dead && DATA.ENEMIES[o.k].boss === 'boss');
  S.p.x = e.x - 60;
  S.p.y = e.y + 300;
  e.next = S.t + 9;
  e.summon = S.t;
  e.throwT = S.t + 9;
});
await wait(450);
await shot('summon_full', true);
await p.evaluate(() => {
  const S = GAME.play,
    e = S.en.find((o) => !o.dead && DATA.ENEMIES[o.k].boss === 'boss');
  e.throwT = S.t;
});
await wait(650);
await shot('throw_full', true);
for (const [n, k] of [
  ['phase2', 0.6],
  ['phase3', 0.3],
]) {
  await p.evaluate((k) => {
    const S = GAME.play,
      e = S.en.find((o) => !o.dead && DATA.ENEMIES[o.k].boss === 'boss');
    e.hp = e.max * k;
  }, k);
  await wait(700);
  await shot(n + '_full', true);
  await shot(n);
}
console.log(JSON.stringify({ errors }));
await b.close();
process.exit(errors.length ? 1 : 0);
