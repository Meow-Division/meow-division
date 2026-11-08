// The heroes screen: node gen/heroescheck.mjs — opens it from the lobby's player panel, shoots it at a few window sizes,
// the penguin mid-spin after pointing at its card, checks the cards fit the window and nothing overlaps, and "Back" returns.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_NO_BUFFER_SPACE/.test(m.text())) errors.push(m.text()); });
await p.goto('http://127.0.0.1:8930/live/index.html'); await p.evaluate(() => sessionStorage.clear()); await p.reload();
await p.waitForFunction(() => window.LOBBY && LOBBY.ready() && document.querySelector('#lobby .cta'), null, { timeout: 60000 });
const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
await p.click('#lobby [data-go="heroes"]'); await p.waitForTimeout(1200);
ok(await p.evaluate(() => !!document.querySelector('#heroes .hc.me .port canvas') && UI.live && UI.scene === 'heroes'), 'heroes screen not live');
const px = await p.evaluate(() => { const c = document.querySelector('#heroes .hc.me .port canvas'), d = c.getContext('2d').getImageData(c.width / 2 - 20, c.height * 0.45, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
ok(px > 20, 'the penguin portrait looks empty (mean ' + px.toFixed(1) + ')');
for (const [w, h] of [[1600, 900], [1280, 720], [1024, 768], [1920, 1200], [2560, 1080]]) {
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
  const bad = await p.evaluate(() => { const r = (e) => e.getBoundingClientRect(), out = [], els = [...document.querySelectorAll('#heroes .hc, #heroes .back, #heroes .ttl, #heroes .tr')].map((e) => [e.className, r(e)]);
    for (let i = 0; i < els.length; i++) { const [a, A] = els[i]; if (A.left < 0 || A.top < 0 || A.right > innerWidth + 0.5 || A.bottom > innerHeight + 0.5) out.push(a + ' off-screen');
      for (let j = i + 1; j < els.length; j++) { const [c, C] = els[j]; if (A.left < C.right - 1 && C.left < A.right - 1 && A.top < C.bottom - 1 && C.top < A.bottom - 1) out.push(a + '×' + c); } }
    document.querySelectorAll('#heroes .hn, #heroes .chip, #heroes .hbtn, #heroes .any').forEach((e) => { if (e.scrollWidth > e.clientWidth + 1) out.push('text overflows: ' + e.textContent.trim()); });
    return out; });
  ok(!bad.length, `${w}x${h}: ` + bad.join(', '));
  await p.screenshot({ path: `frames/heroes_${w}x${h}.png` });
}
await p.setViewportSize({ width: 1600, height: 900 }); await p.waitForTimeout(300);
await p.mouse.move(10, 450); await p.hover('#heroes .hc.me'); await p.waitForTimeout(500);
await p.locator('#heroes .hc.me').screenshot({ path: 'frames/heroes_spin.png' });
await p.click('#heroes [data-go="lobby"]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => !!document.querySelector('#lobby .cta') && UI.scene === 'main'), 'back did not return to the lobby');
console.log(JSON.stringify({ fails, errors }));
await b.close();
process.exit(fails.length || errors.length ? 1 : 0);
