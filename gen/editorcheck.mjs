// The map editor, driven: node gen/editorcheck.mjs (a server with --editor on 8931: map-editor.bat or
// `node server/server.mjs --port 8931 --editor`). Opens /live/index.html?editor, places a house, paints a row of trees, draws a road
// and a plaza, moves the house, undoes and redoes, saves, and checks live/map.js took it all; then puts the old live/map.js back.
// Shots in frames/editor_*.png.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const FILE = 'live/map.js',
  before = fs.readFileSync(FILE, 'utf8');
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1700, height: 950 } });
const errors = [],
  fails = [],
  ok = (c, m) => {
    if (!c) fails.push(m);
  };
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
p.on('dialog', (d) => d.accept());
try {
  await p.goto('http://127.0.0.1:8931/live/index.html?editor');
  await p.evaluate(() => {
    try {
      localStorage.removeItem('md-map-draft');
    } catch (e) {}
  });
  await p.waitForFunction(() => window.EDITOR, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: 'frames/editor_open.png' });
  const n0 = await p.evaluate(() => ({
    props: EDITOR.map.props.length,
    trees: EDITOR.map.trees.length,
    roads: EDITOR.map.roads.length,
    areas: EDITOR.map.areas.length,
  }));
  // a view px → page px on the overlay
  const at = async (vx, vy) => {
    const r = await p.evaluate(() => {
      const b = document.getElementById('edov').getBoundingClientRect();
      return [b.left, b.top, b.width, b.height];
    });
    return [r[0] + (vx / 1920) * r[2], r[1] + (vy / 1080) * r[3]];
  };
  const click = async (vx, vy) => {
    const [x, y] = await at(vx, vy);
    await p.mouse.click(x, y);
  };
  const dragV = async (a, c, steps = 12) => {
    const [x0, y0] = await at(...a),
      [x1, y1] = await at(...c);
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    await p.mouse.move(x1, y1, { steps });
    await p.mouse.up();
  };
  // an empty corner of the world to work in: the start moved there first, the view on it
  await p.click('#edside .it[title="bld_house"]');
  await p.mouse.move(...(await at(960, 540)));
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'frames/editor_ghost.png' });
  await click(960, 540);
  await p.keyboard.press('Escape');
  const n1 = await p.evaluate(() => EDITOR.map.props.length);
  ok(n1 === n0.props + 1, 'placing a house: props ' + n0.props + ' → ' + n1);
  await p.click('#edside .it[title="p_tree1"]');
  await dragV([300, 900], [900, 980], 30);
  await p.keyboard.press('Escape');
  const n2 = await p.evaluate(() => EDITOR.map.trees.length);
  ok(n2 >= n0.trees + 3, 'painting trees: ' + n0.trees + ' → ' + n2);
  await p.keyboard.press('KeyR');
  await dragV([200, 200], [700, 450]);
  const n3 = await p.evaluate(() => EDITOR.map.roads.length);
  ok(n3 === n0.roads + 1, 'drawing a road');
  await p.keyboard.press('KeyP');
  await dragV([1300, 200], [1700, 500]);
  const n4 = await p.evaluate(() => EDITOR.map.areas.length);
  ok(n4 === n0.areas + 1, 'drawing a plaza');
  await p.keyboard.press('KeyV');
  // the house: select it by clicking on its picture, move it, undo, redo
  const house = await p.evaluate(() => EDITOR.map.props[EDITOR.map.props.length - 1].slice());
  await click(960, 470);
  const s1 = await p.evaluate(() => EDITOR.sel());
  ok(s1.length === 1 && s1[0].k === 'props', 'clicking the house selects it: ' + JSON.stringify(s1));
  await dragV([960, 470], [1060, 520]);
  const moved = await p.evaluate(() => EDITOR.map.props[EDITOR.map.props.length - 1].slice());
  ok(moved[1] !== house[1] || moved[2] !== house[2], 'dragging moves the house');
  await p.keyboard.press('Control+z');
  const back = await p.evaluate(() => EDITOR.map.props[EDITOR.map.props.length - 1].slice());
  ok(back[1] === house[1] && back[2] === house[2], 'undo puts it back');
  await p.keyboard.press('Control+y');
  const again = await p.evaluate(() => EDITOR.map.props[EDITOR.map.props.length - 1].slice());
  ok(again[1] === moved[1], 'redo moves it again');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: 'frames/editor_edited.png' });
  // zoomed out, the whole view drawn
  for (let i = 0; i < 3; i++) await p.mouse.wheel(0, 300);
  await p.waitForTimeout(4000);
  await p.screenshot({ path: 'frames/editor_zoomout.png' });
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(800);
  const M = createRequire(import.meta.url)('../live/map.js'); // (first read in this process: the saved file)
  ok(
    M.props.length === n1 && M.roads.length === n3 && M.areas.length === n4 && M.trees.length === n2,
    'live/map.js holds the edits: ' +
      JSON.stringify({ props: M.props.length, roads: M.roads.length, areas: M.areas.length, trees: M.trees.length }),
  );
  // the game loads the saved map
  const g = await b.newPage({ viewport: { width: 1280, height: 720 } });
  g.on('pageerror', (e) => errors.push('game: ' + e.message));
  await g.goto('http://127.0.0.1:8931/live/index.html?render=1');
  await g.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  const gl = await g.evaluate(() => ({
    props: SIM.level(7).props.length,
    roads: SIM.level(7).roads.length,
    check: SIM.selfCheck(),
  }));
  ok(gl.props === n1 && gl.roads === n3, 'the game builds the saved level: ' + JSON.stringify(gl));
} finally {
  fs.writeFileSync(FILE, before);
  await b.close();
}
console.log(JSON.stringify({ fails, errors: errors.filter((e) => !/favicon/.test(e)).slice(0, 8) }, null, 1));
process.exit(fails.length || errors.length ? 1 : 0);
