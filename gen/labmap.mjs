// The laboratory's FIRST DRAFT: node gen/labmap.mjs --force → live/map_lab.js. Since then the map editor owns that file (map-editor.bat,
// Лаборатория): running this again throws the editor's changes away, so it refuses without --force. (Was: node gen/labmap.mjs → live/map_lab.js (window.MAP_LAB / module.exports; sim.js level() reads it for the
// lab's seeds). A 3 × 3 grid of rooms round a big hall, every room joined to each neighbour by a wide door (no dead ends: a corner
// room has two ways out, a side room three, the hall four); the walls on a grid of WALL_M pieces between 60 × 60 posts (the doors'
// posts striped). Ground units: gx, gy in [0, 4800], the screen plane x = gx − gy + 4800, y = (gx + gy) / 2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const N = [180, 1500, 3300, 4620]; // the wall lines (both axes): side rooms 1320, the hall 1800 between them
const T = 20; // half a wall's thickness
// a segment between two nodes: where its door's posts stand (centres; none on the outer lines: a middle post there instead)
const doorEdges = (a, b) => (b - a > 1500 ? [a + 540, b - 540] : [a + 420, b - 420]); // the hall's doors 660 clear, the rooms' 420
const ROOMS = [
  // [i, j] → kind of floor, name (the comments), its lights' tint
  ['store', 'warm'],
  ['server', 'blue'],
  ['gen', 'orange'],
  ['green', 'pink'],
  ['hall', 'white'],
  ['exp', 'green'],
  ['cells', 'red'],
  ['cafe', 'warm'],
  ['decon', 'white'],
];
const room = (i, j) => ROOMS[j * 3 + i];
const ctr = (i, j) => [(N[i] + N[i + 1]) / 2, (N[j] + N[j + 1]) / 2];

const walls = [],
  posts = [],
  floors = [],
  props = [],
  decor = [],
  lights = [],
  starts = [];
const postAt = new Map();
const post = (gx, gy, door) => {
  const k = gx + ',' + gy;
  if (postAt.has(k)) {
    if (door) postAt.get(k)[2] = 1;
    return;
  }
  const p = [gx, gy, door ? 1 : 0];
  postAt.set(k, p);
  posts.push(p);
};
// the walls: along every line, between consecutive posts
for (const vert of [true, false])
  for (let k = 0; k < 4; k++) {
    const at = N[k],
      inner = k === 1 || k === 2;
    for (let c = 0; c < 3; c++) {
      const a = N[c],
        b = N[c + 1],
        stops = [a];
      if (inner) {
        const [d0, d1] = doorEdges(a, b);
        stops.push(d0, d1);
      } else stops.push((a + b) / 2);
      stops.push(b);
      for (let s = 0; s < stops.length; s++)
        post(vert ? at : stops[s], vert ? stops[s] : at, inner && (s === 1 || s === 2));
      for (let s = 0; s + 1 < stops.length; s++) {
        if (inner && s === 1) continue; // the door
        const u0 = stops[s] + 30,
          u1 = stops[s + 1] - 30;
        walls.push(vert ? [at - T, u0, at + T, u1] : [u0, at - T, u1, at + T]);
      }
    }
  }
const VOID = [
  [0, 0, 160, 4800],
  [4640, 0, 4800, 4800],
  [160, 0, 4640, 160],
  [160, 4640, 4640, 4800],
];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) floors.push([N[i], N[j], N[i + 1], N[j + 1], room(i, j)[0]]);

// ---- the props: per room, placed from its middle (dx, dy); the cross through the middle (the doors' ways) is kept clear ----
const put = (i, j, n, dx, dy, flip = 0) => {
  const [cx, cy] = ctr(i, j);
  props.push([n, cx + dx, cy + dy, flip]);
};
const lamp = (i, j, dx, dy, r = 420) => {
  const [cx, cy] = ctr(i, j);
  lights.push([cx + dx, cy + dy, r, room(i, j)[1]]);
};
const dec = (i, j, k, dx, dy, s = 60, a = 0) => {
  const [cx, cy] = ctr(i, j);
  decor.push([k, cx + dx, cy + dy, s, a]);
};

// placing against the walls: a prop flush with a wall (no slot behind it to get caught in) or 120+ clear of it. side 'n' / 's': the
// room's low / high gy wall, 'w' / 'e': its low / high gx wall; u: where along it (from the room's middle); off: a row further out
const require = createRequire(import.meta.url),
  SIM = require('../live/sim.js');
const fp = (n, flip) => {
  const d = SIM.PROP[n];
  return flip ? [d.fh, d.fw] : [d.fw, d.fh];
};
const IN = (i, j) => {
  const [cx, cy] = ctr(i, j);
  return { x0: N[i] + T - cx, x1: N[i + 1] - T - cx, y0: N[j] + T - cy, y1: N[j + 1] - T - cy };
};
const at = (i, j, n, side, u, flip = 0, off = 0) => {
  const [w, h] = fp(n, flip),
    r = IN(i, j);
  const dx = side === 'w' ? r.x0 + w / 2 + 11 + off : side === 'e' ? r.x1 - w / 2 - 11 - off : u;
  const dy = side === 'n' ? r.y0 + h / 2 + 11 + off : side === 's' ? r.y1 - h / 2 - 11 - off : u;
  put(i, j, n, dx, dy, flip);
  return { dx, dy, w, h };
};
// a row of props side by side along a wall from u0 (dir +1 / -1), each touching the last
const row = (i, j, side, u0, dir, list, off = 0) => {
  let u = u0;
  for (const [n, flip = 0] of list) {
    const [w, h] = fp(n, flip),
      len = side === 'n' || side === 's' ? w : h;
    at(i, j, n, side, u + (dir * len) / 2, flip, off);
    u += dir * (len + 1);
  }
};
// in a corner (c: 'nw', 'ne', 'sw', 'se'), shifted along the walls by ox, oy
const corner = (i, j, n, c, flip = 0, ox = 0, oy = 0) => {
  const [w, h] = fp(n, flip),
    r = IN(i, j);
  const dx = c[1] === 'w' ? r.x0 + w / 2 + 11 + ox : r.x1 - w / 2 - 11 - ox,
    dy = c[0] === 'n' ? r.y0 + h / 2 + 11 + oy : r.y1 - h / 2 - 11 - oy;
  put(i, j, n, dx, dy, flip);
};
const LAMPS5 = (i, j, r = 400) => {
  for (const [dx, dy] of [
    [-400, -400],
    [400, -400],
    [-400, 400],
    [400, 400],
    [0, 0],
  ])
    lamp(i, j, dx, dy, r);
};

// the hall (1, 1): the broken tank in the middle (the boss fight goes round it), cover on the diagonals inside the arena (each a
// block of touching boxes, no gaps), the camp in its corners (outside the arena's ring), flush with the walls
put(1, 1, 'lb_tank', 0, 0);
put(1, 1, 'iso_cardboard', -400, -400);
put(1, 1, 'iso_crate2', -454, -400);
put(1, 1, 'iso_cardboard', -400, -445);
put(1, 1, 'lb_biobarrel', 400, -400);
put(1, 1, 'lb_biobarrel', 427, -400);
put(1, 1, 'lb_biobarrel', 400, -427);
put(1, 1, 'iso_metalcrate', -400, 400);
put(1, 1, 'iso_crate3', -454, 400);
put(1, 1, 'lb_stretcher', 400, 400, 1);
corner(1, 1, 'lb_tent', 'ne', 1);
row(1, 1, 'n', 870 - 128, -1, [['lb_stretcher'], ['lb_iv']]);
corner(1, 1, 'lb_cart', 'ne', 0, 0, 156);
corner(1, 1, 'lb_tent', 'sw', 0);
row(1, 1, 'w', 870 - 128, -1, [['lb_stretcher', 1], ['lb_iv']]);
corner(1, 1, 'lb_cart', 'sw', 0, 156, 0);
row(1, 1, 'n', -870, 1, [['iso_metalcrate'], ['iso_metalcrate'], ['lb_flood']]);
corner(1, 1, 'iso_metalcrate', 'nw', 0, 0, 45);
corner(1, 1, 'iso_crate2', 'nw', 0, 45, 45);
row(1, 1, 's', 870, -1, [['lb_desk'], ['lb_biobarrel'], ['lb_biobarrel']]);
row(1, 1, 'e', 800, -1, [['lb_flood'], ['p_barrel']], 0);
for (const [dx, dy] of [
  [0, 0],
  [-560, -560],
  [560, -560],
  [-560, 560],
  [560, 560],
  [0, -620],
  [-620, 0],
  [620, 0],
  [0, 620],
])
  lamp(1, 1, dx, dy, dx || dy ? 440 : 520);
dec(1, 1, 'goo', 150, 120, 150, 0.4);
dec(1, 1, 'goo', -120, 170, 110, 1.2);
dec(1, 1, 'goo', 60, -160, 90, 2);
dec(1, 1, 'goo', 430, -330, 70, 0.3);
dec(1, 1, 'glass', 230, -40, 110, 0.5);
dec(1, 1, 'glass', -200, -120, 90, 1.7);
dec(1, 1, 'glass', 40, 230, 80, 2.6);
dec(1, 1, 'cable', 0, 0, 760, 0.05);
dec(1, 1, 'cable', 0, 0, 700, 1.62);
dec(1, 1, 'cable', 0, 0, 640, 0.83);
dec(1, 1, 'paper', -300, 120, 1, 0);
dec(1, 1, 'paper', 260, 300, 1, 1);
dec(1, 1, 'paper', -620, 300, 1, 2);
dec(1, 1, 'paper', 300, -650, 1, 3);
dec(1, 1, 'drain', -300, -300, 50);
dec(1, 1, 'drain', 300, 300, 50);
dec(1, 1, 'stain', -650, 200, 120, 0.4);
dec(1, 1, 'stain', 200, -700, 100, 1.1);

// the warehouse (0, 0): two rows of shelves against its back wall (a wide aisle, open at both ends), the forklift along the side
// wall, a block of pallets in the far corner, barrels by the wall
row(0, 0, 'n', -629, 1, [['lb_shelf']]);
row(0, 0, 'n', 280, 1, [['lb_shelf']]);
row(0, 0, 'n', -629, 1, [['lb_shelf']], 66 + 130);
row(0, 0, 'n', 280, 1, [['lb_shelf']], 66 + 130);
at(0, 0, 'lb_forklift', 'w', 420, 1);
put(0, 0, 'lb_pallet', 380, 380);
put(0, 0, 'lb_pallet', 444, 380);
put(0, 0, 'iso_crate2', 380, 439);
put(0, 0, 'iso_cardboard', 444, 430);
row(0, 0, 'w', 349, -1, [['p_barrel'], ['p_obarrel']]);
LAMPS5(0, 0);
dec(0, 0, 'stain', -300, 300, 120, 0.5);
dec(0, 0, 'stain', 250, -200, 90, 1.3);
dec(0, 0, 'paper', 120, 300, 1, 1);
starts.push(ctr(0, 0), [ctr(0, 0)[0] + 300, ctr(0, 0)[1] + 120]);

// the server room (1, 0): two rows of racks against the back wall, the console along the side wall, lone racks by the hall's door
row(1, 0, 'n', -530, 1, [['lb_servers']]);
row(1, 0, 'n', 320, 1, [['lb_servers']]);
row(1, 0, 'n', -530, 1, [['lb_servers']], 62 + 130);
row(1, 0, 'n', 320, 1, [['lb_servers']], 62 + 130);
at(1, 0, 'lb_console', 'w', 440, 1);
row(1, 0, 's', 400, 1, [['lb_server'], ['lb_server'], ['lb_server']]);
at(1, 0, 'lb_cabinet', 'e', 440);
LAMPS5(1, 0);
dec(1, 0, 'cable', -100, 150, 380, 0.6);
dec(1, 0, 'cable', 200, -150, 300, 2.2);
dec(1, 0, 'grate', 300, 150, 70);
dec(1, 0, 'grate', -250, -180, 70);
starts.push(ctr(1, 0));

// the generator room (2, 0): the generator against the back wall, pipes along the outer wall, barrels and cabinets in the corners
row(2, 0, 'n', -629, 1, [['lb_generator']]);
row(2, 0, 'e', -628, 1, [
  ['lb_pipes', 1],
  ['lb_pipes', 1],
]);
row(2, 0, 'e', 330, 1, [['p_barrel'], ['p_barrel'], ['p_obarrel']]);
row(2, 0, 'w', 400, 1, [['lb_cabinet'], ['lb_cabinet'], ['iso_metalcrate']]);
LAMPS5(2, 0);
dec(2, 0, 'stripe', -400, -200, 520, 0);
dec(2, 0, 'stain', 350, 300, 110, 0.7);
dec(2, 0, 'stain', -200, 200, 90, 2.1);
dec(2, 0, 'grate', 0, -300, 70);
starts.push(ctr(2, 0), [ctr(2, 0)[0] - 300, ctr(2, 0)[1] + 120]);

// the greenhouse (0, 1): planters against the back wall and along the hall's wall, big plants and pots in the near corners
row(0, 1, 'n', -629, 1, [['lb_planter'], ['lb_growlight']]);
row(0, 1, 'n', -629, 1, [['lb_growlight'], ['lb_planter']], 59 + 130);
row(0, 1, 'e', -560, 1, [['lb_planter', 1], ['lb_growlight']]);
corner(0, 1, 'lb_bigplant', 'sw');
corner(0, 1, 'lb_pots', 'sw', 0, 65, 0);
corner(0, 1, 'lb_pots', 'sw', 0, 0, 65);
corner(0, 1, 'lb_bigplant', 'se');
corner(0, 1, 'lb_pots', 'se', 0, 65, 0);
LAMPS5(0, 1, 420);
dec(0, 1, 'moss', -300, 100, 160, 0.4);
dec(0, 1, 'moss', 200, 300, 140, 1.4);
dec(0, 1, 'moss', 300, -200, 120, 2.4);
dec(0, 1, 'moss', -150, -250, 110, 0.9);
dec(0, 1, 'puddle', 100, 100, 120, 0.3);
starts.push(ctr(0, 1));

// the experiment room (2, 1): specimen tubes along the back and outer walls (one run, corner to corner), the operating table and a
// cart by the wall, the desk along the hall's wall
row(2, 1, 'n', 628, -1, [['lb_tube'], ['lb_tube'], ['lb_tubebroken'], ['lb_tube']]);
row(2, 1, 'e', -628 + 53, 1, [['lb_tube'], ['lb_tubebroken']]);
row(2, 1, 'n', -628, 1, [['lb_tube'], ['lb_tube'], ['lb_tubebroken']]);
row(2, 1, 's', 360, 1, [['lb_iv'], ['lb_optable']]);
at(2, 1, 'lb_cart', 'e', 420);
row(2, 1, 'w', 380, 1, [['lb_desk', 1], ['lb_biobarrel'], ['lb_biobarrel']]);
LAMPS5(2, 1);
dec(2, 1, 'goo', 420, -360, 110, 0.2);
dec(2, 1, 'goo', 560, -280, 70, 1.2);
dec(2, 1, 'goo', -100, 120, 90, 2.2);
dec(2, 1, 'glass', 400, -320, 80, 0.7);
dec(2, 1, 'drain', 0, 0, 50);
starts.push(ctr(2, 1));

// the isolation cells (0, 2): two cells against the back wall, the guard's desk and lockers by the outer wall
row(0, 2, 'n', -629, 1, [['lb_cell']]);
row(0, 2, 'n', 330, 1, [['lb_cell']]);
row(0, 2, 's', -629, 1, [['lb_guarddesk']]);
row(0, 2, 's', 360, 1, [['iso_locker'], ['iso_locker'], ['iso_locker']]);
at(0, 2, 'lb_cabinet', 'e', 420);
LAMPS5(0, 2);
dec(0, 2, 'blood', -300, -260, 90, 0.4);
dec(0, 2, 'blood', 380, -280, 70, 1.4);
dec(0, 2, 'blood', -60, 200, 60, 2.6);
dec(0, 2, 'drain', 0, 0, 50);
dec(0, 2, 'paper', 200, 300, 1, 2);
starts.push(ctr(0, 2));

// the cafeteria (1, 2): two rows of tables either side of the hall's door (wide aisles), the counter, machines against the outer wall
put(1, 2, 'lb_table', -430, -510);
put(1, 2, 'lb_table', -430, -290);
put(1, 2, 'lb_table', 430, -510);
put(1, 2, 'lb_table', 430, -290);
row(1, 2, 's', -629, 1, [['lb_counter']]);
row(1, 2, 's', 330, 1, [['lb_vending'], ['lb_vending'], ['lb_coffee']]);
LAMPS5(1, 2);
dec(1, 2, 'stain', -200, 200, 90, 0.3);
dec(1, 2, 'stain', 250, -200, 70, 1.9);
dec(1, 2, 'paper', -100, -150, 1, 0);
dec(1, 2, 'paper', 300, 150, 1, 3);
starts.push(ctr(1, 2));

// the decontamination airlock (2, 2): two shower booths free in the room, suits and lockers against the outer walls
put(2, 2, 'lb_shower', -420, -420);
put(2, 2, 'lb_shower', 420, -420);
row(2, 2, 's', -629, 1, [['lb_suits']]);
row(2, 2, 's', 360, 1, [['iso_locker'], ['iso_locker'], ['iso_locker']]);
at(2, 2, 'lb_cabinet', 'e', 400);
LAMPS5(2, 2);
dec(2, 2, 'puddle', -440, -300, 130, 0.2);
dec(2, 2, 'puddle', 440, -300, 110, 1.3);
dec(2, 2, 'drain', -420, -420, 50);
dec(2, 2, 'drain', 420, -420, 50);
dec(2, 2, 'stripe', 0, 300, 600, 0);
starts.push(ctr(2, 2));

// islands in the near half of the side rooms (free on every side, 120+ from anything): cover to run round, the rooms not bare
put(0, 0, 'lb_pallet', -330, 330);
put(0, 0, 'iso_crate2', -330, 389);
put(1, 0, 'lb_server', -356, 330);
put(1, 0, 'lb_server', -303, 330);
put(2, 0, 'lb_pipes', 330, 330);
put(0, 1, 'lb_planter', -380, 330);
put(0, 1, 'lb_growlight', -250, 330);
put(2, 1, 'lb_tubebroken', -330, 330);
put(2, 1, 'lb_tube', 330, 300);
put(0, 2, 'lb_stretcher', -330, 330);
put(0, 2, 'lb_stretcher', 330, 330, 1);
put(1, 2, 'lb_table', -430, 330);
put(1, 2, 'lb_table', 430, 330);
put(2, 2, 'iso_bench', -330, 330);
put(2, 2, 'iso_bench', 330, 330);

const M = {
  v: 1,
  spawn: ctr(1, 1).map((v) => v + 0),
  walls,
  posts,
  void: VOID,
  floors,
  props,
  decor,
  lights,
  starts: starts.map(([x, y]) => [Math.round(x), Math.round(y)]),
  hall: [N[1], N[1], N[2], N[2]], // (the gas before the final boss closes in on it: sim.js GAS)
  roads: [],
  areas: [],
  trees: [],
  bushes: [],
};
M.spawn = [2400, 2950];
const { labSource } = await import(new URL('../server/mapfile.mjs', import.meta.url));
const dst = path.join(ROOT, 'live/map_lab.js');
if (fs.existsSync(dst) && !process.argv.includes('--force')) {
  console.log("live/map_lab.js is the map editor's now: node gen/labmap.mjs --force to throw it away and start over");
  process.exit(1);
}
fs.writeFileSync(dst, labSource(M));
console.log(
  'map_lab.js:',
  walls.length,
  'walls',
  posts.length,
  'posts',
  props.length,
  'props',
  decor.length,
  'decor',
  lights.length,
  'lights',
  starts.length,
  'starts',
);
