// The lobby's buttons, end to end: node gen/lobbynav.mjs — every panel opens its screen and "Back" brings the live lobby back,
// the settings toggles flip sound, PLAY as a guest first offers a wallet and "as a guest" starts the run (not offered again this visit),
// and quitting returns to the live lobby.
// Also renders the lobby at a few window sizes (frames/lobby_<w>x<h>.png) to check nothing overlaps.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_NO_BUFFER_SPACE/.test(m.text())) errors.push(m.text());
});
await p.goto('http://127.0.0.1:8930/live/index.html');
await p.evaluate(() => sessionStorage.clear());
await p.reload();
await p.waitForFunction(() => window.LOBBY && LOBBY.ready() && document.querySelector('#lobby .cta'), null, {
  timeout: 60000,
});
const fails = [],
  ok = (c, m) => {
    if (!c) fails.push(m);
  };
const live = () => p.evaluate(() => !!(document.querySelector('#lobby.scr.on .cta') && UI.live && UI.scene === 'main')); // the main lobby showing (other pages use the live scene too)
for (const go of ['heroes', 'maps', 'select', 'arsenal', 'upgrades', 'roadmap']) {
  await p.click(`#lobby [data-go="${go}"]`);
  await p.waitForTimeout(250);
  ok(!(await live()), go + ': screen did not open');
  const back = await p.$('[data-go="lobby"]');
  ok(back, go + ': no back button');
  if (back) {
    await back.click();
    await p.waitForTimeout(250);
    ok(await live(), go + ': back did not return to the live lobby');
  }
}
// settings: sound toggles (one toggle for the sound and the music alike)
await p.click('#lobby [data-set]');
await p.waitForTimeout(150);
ok(
  await p.evaluate(() => !window.MUSIC && !document.querySelector('#lobby [data-tg="mus"]')),
  'music is still loaded or has a toggle',
);
const s0 = await p.evaluate(() => AUDIO.on);
await p.click('#lobby [data-tg="snd"]');
await p.waitForTimeout(200);
ok((await p.evaluate(() => AUDIO.on)) === !s0, 'sound toggle');
await p.click('#lobby [data-tg="snd"]');
await p.waitForTimeout(200);
await p.click('#lobby [data-close]');
await p.waitForTimeout(150);
ok(
  !(await p.evaluate(() => document.querySelector('#lobby .setp').classList.contains('open'))),
  'settings did not close',
);
// play as a guest: the offer to connect a wallet first, then "as a guest" starts the run; quit back to the lobby
await p.click('#lobby [data-play]');
await p.waitForTimeout(500);
ok(
  await p.evaluate(() => !GAME.play && !!document.querySelector('#lobby .gstp.open [data-gcon]')),
  'play as a guest: no wallet offer',
);
await p.screenshot({ path: 'frames/lobby_guest.png' });
await p.click('#lobby [data-gplay]');
await p.waitForTimeout(1200);
const run = await p.evaluate(() => ({
  play: !!GAME.play,
  lobby: !!document.querySelector('#lobby'),
  live: UI.live,
  t: GAME.play && GAME.play.t,
}));
ok(run.play && !run.lobby && !run.live, 'play did not start a run ' + JSON.stringify(run));
// the run keeps the game's 16:9 view even from a 4:3 window (the lobby canvas took the window's shape)
await p.evaluate(() => GAME.quit());
await p.setViewportSize({ width: 1024, height: 768 });
await p.waitForTimeout(300);
ok(await p.evaluate(() => G.W === 1440), 'lobby canvas did not take the 4:3 window');
await p.click('#lobby [data-play]');
await p.waitForTimeout(600);
ok(await p.evaluate(() => !!GAME.play), 'play after "as a guest": the offer came again');
ok(
  await p.evaluate(
    () =>
      G.W === SIM.VIEW.W &&
      G.H === SIM.VIEW.H &&
      getComputedStyle(document.documentElement).getPropertyValue('--ar').trim() === '1.7778',
  ),
  'the run did not get its 16:9 view back',
);
await p.screenshot({ path: 'frames/lobby_run.png' });
await p.setViewportSize({ width: 1600, height: 900 });
await p.evaluate(() => GAME.quit());
await p.waitForTimeout(400);
ok(await live(), 'quit did not return to the live lobby');
// window sizes
for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
  [1366, 768],
  [1024, 768],
  [2560, 1080],
]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(400);
  const ov = await p.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect(),
      els = ['.pl', '.card', '.mb', '.mr', '.tr'].map((s) => [s, r('#lobby ' + s)]),
      out = [];
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const [a, A] = els[i],
          [c, C] = els[j];
        if (A.left < C.right && C.left < A.right && A.top < C.bottom && C.top < A.bottom) out.push(a + '×' + c);
      }
    for (const [a, A] of els)
      if (A.left < 0 || A.top < 0 || A.right > innerWidth || A.bottom > innerHeight) out.push(a + ' off-screen');
    return out;
  });
  ok(!ov.length, `${w}x${h}: ` + ov.join(', '));
  await p.screenshot({ path: `frames/lobby_${w}x${h}.png` });
}
console.log(JSON.stringify({ fails, errors }));
await b.close();
process.exit(fails.length || errors.length ? 1 : 0);
