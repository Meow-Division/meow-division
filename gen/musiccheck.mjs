// The music: node gen/musiccheck.mjs   (needs the live server on :8930)
// In headless Chrome with the browser's autoplay rule (sound only after a gesture): the lobby's track plays after the first click and
// is heard at the output; a run fades it out and plays the run's track from the top; back in the lobby the lobby's track returns and
// the run's stops. Fails on page errors.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_NO_BUFFER_SPACE/.test(m.text())) errors.push(m.text()); });
await p.goto('http://127.0.0.1:8930/live/index.html'); await p.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('zh-mute'); }); await p.reload();
await p.waitForFunction(() => window.__ready && document.querySelector('#lobby .cta'), null, { timeout: 120000 });
const mus = () => p.evaluate(() => ({ ...AUDIO.debug().music, out: AUDIO.level() && AUDIO.level().rms }));
await p.mouse.click(1240, 690); await p.waitForTimeout(2500);                              // a click on nothing: the gesture
let m = await mus();
ok(m.lobby && m.lobby.playing && m.lobby.gain > 0.8 && !(m.game && m.game.playing), 'the lobby: its track plays after the first click ' + JSON.stringify(m.lobby));
ok(m.out > 0.002, 'the lobby: the music is heard at the output (rms ' + m.out + ')');
await p.evaluate(() => GAME.start('pistol')); await p.waitForFunction(() => GAME.play, null, { timeout: 30000 }); await p.waitForTimeout(3000);
m = await mus();
ok(m.game && m.game.playing && m.game.gain > 0.8 && m.game.t < 6 && m.lobby.gain < 0.1, 'a run: its track from the top, the lobby\'s faded ' + JSON.stringify(m));
await p.evaluate(() => GAME.quit()); await p.waitForTimeout(3000);
m = await mus();
ok(m.lobby.playing && m.lobby.gain > 0.8 && !m.game.playing, 'back in the lobby: its track again, the run\'s stopped ' + JSON.stringify(m));
console.log(JSON.stringify({ errors }));
await b.close();
process.exit(fails.length || errors.length ? 1 : 0);
