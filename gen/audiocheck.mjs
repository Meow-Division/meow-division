// Is there sound, and does it stay? node gen/audiocheck.mjs [weapon] [seconds]  (needs the live server on :8930)
// Plays a real run in headless Chrome (a click starts the audio), fights with every item, a horde and a boss, and samples the
// master output (AUDIO.level: RMS + non-finite samples) twice a second. Fails if the output goes silent or NaN while fighting.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');
const weapon = process.argv[2] || 'rocket', secs = +(process.argv[3] || 40);
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if ((m.type() === 'error' && !/ERR_NO_BUFFER_SPACE/.test(m.text())) || /state is bad/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
await p.goto(`http://127.0.0.1:8930/live/index.html?autoplay=${weapon}`); await p.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('zh-mute'); }); await p.reload();
await p.waitForFunction(() => window.GAME && GAME.play, null, { timeout: 60000 });
await p.mouse.move(900, 300); await p.mouse.down();                                       // the gesture that starts the audio; hold fire
await p.evaluate(() => { const S = GAME.play; S.p.god = true; for (const [id, l] of [['chain', 5], ['grenade', 5], ['drone', 3], ['saws', 3]]) S.p.items.push(SIM.newItem(id, l)); SIM.recalc(S); });
const samples = [];
for (let i = 0; i < secs * 2; i++) {
  await p.waitForTimeout(500);
  if (i === 6) await p.evaluate(() => SIM.cheat(GAME.play, 'horde'));
  if (i === 30) await p.evaluate(() => { const S = GAME.play; const e = SIM.addEnemy(S, 'butcher', S.p.x + 300, S.p.y); S.boss = e.id; });
  if (await p.evaluate(() => !!GAME.play.pause)) await p.evaluate(() => GAME.pick(0));
  await p.mouse.move(640 + Math.cos(i / 3) * 400, 360 + Math.sin(i / 3) * 250);
  samples.push(await p.evaluate(() => ({ ...AUDIO.level(), st: AUDIO.ctx() && AUDIO.ctx().state, v: AUDIO.debug().voices, m: (AUDIO.debug().music || {}).mode, en: GAME.play.en.length })));
}
const rms = samples.map((s) => s.rms), bad = samples.filter((s) => s.bad).length, silentRun = (() => { let run = 0, best = 0; for (const s of samples.slice(4)) { run = s.rms < 0.002 ? run + 1 : 0; best = Math.max(best, run); } return best; })();
console.log(JSON.stringify({ rms: rms.map((r) => +r.toFixed(3)), nanSamples: bad, longestSilence: silentRun / 2 + ' s', state: samples.at(-1).st, voices: samples.map((s) => s.v), errors: errors.slice(0, 8) }));
await b.close();
process.exit(bad || silentRun >= 6 || errors.length ? 2 : 0);
