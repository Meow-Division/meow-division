// The character editor, driven: node gen/heroeditcheck.mjs [port=8932] (a server with --editor on it: hero-editor.bat or
// `node server/server.mjs --port 8932 --editor`). Opens /live/index.html?hero, moves the shotgun by its slider and by its handles (the
// grip, the muzzle, a paw), keys the head through the idle clip, turns a joint by its handle, undoes and redoes, plays it "как в игре",
// saves, and checks live/hero.js and data.js's muzzles took it and the game draws the clips with it; then puts both files back.
// Shots in frames/heroed_*.png.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const PORT = process.argv[2] || 8932, URL0 = `http://127.0.0.1:${PORT}/live/index.html`;
const FILES = ['live/hero.js', 'live/data.js'], before = FILES.map((f) => fs.readFileSync(f, 'utf8'));
const b = await chromium.launch({ channel: process.env.PW_CHANNEL, args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1700, height: 950 } });
const errors = [], fails = [], ok = (c, m) => { if (!c) fails.push(m); };
p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
p.on('dialog', (d) => d.accept());
try {
  await p.goto(URL0 + '?hero');
  await p.evaluate(() => { try { localStorage.removeItem('zh-hero-draft'); } catch (e) {} });
  await p.waitForFunction(() => window.HEROED, null, { timeout: 180000 }); await p.waitForTimeout(1000);
  const at = async (v) => { const r = await p.evaluate(() => { const b = document.getElementById('hov').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }); return [r[0] + v[0] / 1920 * r[2], r[1] + v[1] / 1080 * r[3]]; };
  const handle = (id) => p.evaluate((id) => { const h = HEROED.handles.find((x) => x.id === id); return h && h.p.slice(); }, id);
  const drag = async (a, c, steps = 10) => { const [x0, y0] = await at(a), [x1, y1] = await at(c); await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps }); await p.mouse.up(); await p.waitForTimeout(150); };
  const tune = () => p.evaluate(() => JSON.parse(JSON.stringify(HEROED.tune)));
  await p.click('#htop button:has-text("Дробовик")'); await p.evaluate(() => { HEROED.f = 6; }); await p.waitForTimeout(400);
  await p.screenshot({ path: 'frames/heroed_open.png' });
  // the slider: the gun up
  const m0 = await handle('muzzle');
  await p.evaluate(() => { const r = [...document.querySelectorAll('#hside .row')].find((x) => x.querySelector('label').textContent === 'Вверх / вниз'); const i = r.querySelector('input[type=range]'); i.value = 0.08; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(300);
  const m1 = await handle('muzzle'), t1 = await tune();
  ok(t1.guns.shotgun && t1.guns.shotgun.aim.p[1] === 0.08, 'the slider moves the gun up: ' + JSON.stringify(t1.guns));
  ok(m1[1] < m0[1] - 10, 'the muzzle drawn higher: ' + m0 + ' → ' + m1);
  // the grip handle dragged right and down; the muzzle handle dragged up (the gun turned); the left paw dragged
  const g0 = await handle('grip'); await drag(g0, [g0[0] + 40, g0[1] + 30]); const g1 = await handle('grip'), t2 = await tune();
  ok(Math.hypot(g1[0] - g0[0] - 40, g1[1] - g0[1] - 30) < 12, 'the grip follows the mouse: ' + g0.map(Math.round) + ' → ' + g1.map(Math.round));
  const mz0 = await handle('muzzle'), gp = await handle('grip'), want = [mz0[0], mz0[1] - 40];
  await drag(mz0, want); const mz1 = await handle('muzzle'), t3 = await tune();
  const ang = (q) => Math.atan2(q[1] - gp[1], q[0] - gp[0]);
  ok(Math.abs(ang(mz1) - ang(want)) < 0.12, 'the muzzle turns toward the mouse: ' + [ang(mz0), ang(want), ang(mz1)].map((v) => v.toFixed(2)) + ' r ' + JSON.stringify(t3.guns.shotgun.aim.r));
  const pl0 = await handle('pawL'); await drag(pl0, [pl0[0] + 15, pl0[1]]); const t4 = await tune();
  ok(t4.guns.shotgun.aim.pawL && t4.guns.shotgun.aim.pawL.p.some((v) => v !== 0), 'dragging the left paw moves it: ' + JSON.stringify(t4.guns.shotgun.aim.pawL));
  await p.screenshot({ path: 'frames/heroed_gun.png' });
  // the head keyed: turned left at frame 0, right at frame 12
  await p.click('#hside .chips button:has-text("Голова")'); await p.click('#hside button:has-text("По кадрам")');
  const setRow = (label, v) => p.evaluate(([label, v]) => { const r = [...document.querySelectorAll('#hside .row')].find((x) => x.querySelector('label').textContent === label); const i = r.querySelector('input[type=range]'); i.value = v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }, [label, v]);
  await p.evaluate(() => { HEROED.f = 0; }); await setRow('Поворот влево / вправо', 35);
  await p.evaluate(() => { HEROED.f = 12; }); await setRow('Поворот влево / вправо', -35);
  const t5 = await tune(), k = t5.poses.idle_shotgun && t5.poses.idle_shotgun.head && t5.poses.idle_shotgun.head.k;
  ok(k && k.length === 3 && k[0][0] === 0 && k[0][2] === 35 && k[1][0] === 6 && k[2][0] === 12 && k[2][2] === -35, 'keys on the head (frame 6: where the keys were turned on; 0, 12 set): ' + JSON.stringify(k));
    await p.evaluate(() => { HEROED.f = 0; }); await p.waitForTimeout(150); await p.screenshot({ path: 'frames/heroed_key0.png' });
  await p.evaluate(() => { HEROED.f = 12; }); await p.waitForTimeout(150); await p.screenshot({ path: 'frames/heroed_key12.png' });
  ok(!fs.readFileSync('frames/heroed_key0.png').equals(fs.readFileSync('frames/heroed_key12.png')), 'the head looks different at the two keys');
  // a joint turned by its handle: the right elbow swung (dragged sideways), the chest turned
  await p.click('#hside .chips button:has-text("Грудь")');
  const head = await handle('part:head'); await drag(head, [head[0] + 60, head[1] + 10]);
  const t6 = await tune(); ok(t6.poses.idle_shotgun.head && JSON.stringify(t6.poses.idle_shotgun.head) !== JSON.stringify(t5.poses.idle_shotgun.head), 'dragging the head joint turns it');
  const el = await handle('part:elbowR'); await drag(el, [el[0] + 50, el[1]]); const t7 = await tune();
  const elv = t7.poses.idle_shotgun.elbowR; ok(elv && (elv.r ? elv.r[0] : 1) !== 0, 'dragging the elbow swings it: ' + JSON.stringify(elv));
  // undo, redo
  await p.keyboard.press('Control+z'); const u1 = await tune(); ok(JSON.stringify(u1) === JSON.stringify(t6), 'undo takes the elbow back');
  await p.keyboard.press('Control+y'); const u2 = await tune(); ok(JSON.stringify(u2) === JSON.stringify(t7), 'redo puts it again');
  // the run, the lobby, the motion
  await p.keyboard.press('3'); await p.waitForTimeout(500); await p.screenshot({ path: 'frames/heroed_run.png' });
  await p.keyboard.press('1'); await p.waitForTimeout(500); await p.screenshot({ path: 'frames/heroed_lobby.png' });
  await p.evaluate(() => { const r = [...document.querySelectorAll('#hside .row')].find((x) => x.querySelector('label').textContent === 'Отдача, сила ×'); const i = r.querySelector('input[type=range]'); i.value = 1.5; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
  // "как в игре": running, aiming, firing
  await p.keyboard.press('4'); const c = await at([1300, 400]); await p.mouse.move(c[0], c[1]);
  await p.keyboard.down('KeyD'); await p.mouse.down(); await p.waitForTimeout(900); await p.screenshot({ path: 'frames/heroed_live.png' }); await p.mouse.up(); await p.keyboard.up('KeyD');
  const c2 = await at([500, 800]); await p.mouse.move(c2[0], c2[1]); await p.keyboard.down('KeyW'); await p.waitForTimeout(700); await p.keyboard.up('KeyW'); await p.screenshot({ path: 'frames/heroed_live2.png' });
  // saved: the files take it
  await p.keyboard.press('2'); await p.keyboard.press('Control+s'); await p.waitForTimeout(1200);
  const hs = fs.readFileSync('live/hero.js', 'utf8'), T = createRequire(import.meta.url)('../live/hero.js'), saved = await p.evaluate(() => JSON.stringify(HEROED.prune(HEROED.tune)));
  ok(JSON.stringify(T) === saved, 'live/hero.js holds the tune: ' + hs.length + ' chars');
  const mzOld = /"shotgun":\[([^\]]+)\]/.exec(before[1])[1], mzNew = /"shotgun":\[([^\]]+)\]/.exec(fs.readFileSync('live/data.js', 'utf8'))[1], mzPistol = /"pistol":\[([^\]]+)\]/;
  ok(mzOld !== mzNew, 'the shotgun\'s muzzle in data.js moved: ' + mzOld + ' → ' + mzNew);
  ok(mzPistol.exec(before[1])[1] === mzPistol.exec(fs.readFileSync('live/data.js', 'utf8'))[1], 'the pistol\'s muzzle stays');
  // the game draws the clips with it, and its muzzle matches the sim's
  const g = await b.newPage({ viewport: { width: 1280, height: 720 } }); g.on('pageerror', (e) => errors.push('game: ' + e.message));
  await g.goto(URL0 + '?render=1'); await g.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  const gm = await g.evaluate(() => { const I = HERO3D.info(), C = CHARMESH.clip('cat', 'idle_shotgun'), o = I.anims.idle_shotgun.m[0]; let d = 0; for (let i = 0; i < o.length; i++) d = Math.max(d, Math.abs(C.m[0][i] - o[i]));
    const p0 = CHARMESH.clip('cat', 'idle_pistol'), op = I.anims.idle_pistol.m[0]; let dp = 0; for (let i = 0; i < op.length; i++) dp = Math.max(dp, Math.abs(p0.m[0][i] - op[i]));
    return { shotgun: d, pistol: dp, tune: !!window.HERO_TUNE.guns.shotgun, mz: DATA.HERO3D.mz.shotgun }; });
  ok(gm.shotgun > 0.01 && gm.pistol < 1e-6 && gm.tune, 'the game bakes the tune over the shotgun\'s clips (only): ' + JSON.stringify(gm));
} finally { FILES.forEach((f, i) => fs.writeFileSync(f, before[i])); await b.close(); }
console.log(JSON.stringify({ fails, errors: errors.slice(0, 8) }, null, 1));
process.exit(fails.length || errors.length ? 1 : 0);
