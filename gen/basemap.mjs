// gen/basemap.mjs — NEAR Base's FIRST DRAFT: node gen/basemap.mjs [--force] → live/map_base.js. Since then the map
// editor owns that file (map-editor.bat, its base button): running this again throws the editor's changes away, so
// it refuses without --force. A bunker of six rooms, 3 × 2, every one joined to each neighbour by a door, laid out as
// gen/labmap.mjs lays the laboratory: walls on WALL_M pieces between 60 × 60 posts (the doors' posts striped), the
// lab's floors and furniture. The hall: Walt's counter and Nova's radio desk; the generator room: the generator and
// the workbench; the store: the lockers (the stash) and the cot with its drip (the medbay); the range: its targets;
// the kitchen and the server room ("soon"). live/hub.js finds each by its furniture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url),
  SIM = require('../live/sim.js');

const NX = [1050, 1950, 2850, 3750], // the wall lines along gx and along gy: rooms 900 × 900
  NY = [1500, 2400, 3300];
const T = 20, // half a wall's thickness
  DOOR = 210; // a door's posts from its middle (300 clear between them)
// [i, j] → the floor's kind, its light's tint
const ROOMS = [
  ['cafe', 'warm'],
  ['hall', 'white'],
  ['gen', 'orange'],
  ['server', 'blue'],
  ['store', 'warm'],
  ['exp', 'red'],
];
const room = (i, j) => ROOMS[j * 3 + i];
const ctr = (i, j) => [(NX[i] + NX[i + 1]) / 2, (NY[j] + NY[j + 1]) / 2];

const walls = [],
  posts = [],
  floors = [],
  props = [],
  decor = [],
  lights = [];
const seen = new Map();
const post = (gx, gy, door) => {
  const k = gx + ',' + gy;
  if (seen.has(k)) {
    if (door) seen.get(k)[2] = 1;
    return;
  }
  const p = [gx, gy, door ? 1 : 0];
  seen.set(k, p);
  posts.push(p);
};
// the walls along one line (at), over the segments between the nodes N: an inner line has a door in each segment, an
// outer one a post in its middle
function line(vert, at, N, inner) {
  for (let c = 0; c + 1 < N.length; c++) {
    const a = N[c],
      b = N[c + 1],
      m = (a + b) / 2,
      stops = inner ? [a, m - DOOR, m + DOOR, b] : [a, m, b];
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
for (let k = 0; k < NX.length; k++) line(true, NX[k], NY, k > 0 && k < NX.length - 1);
for (let k = 0; k < NY.length; k++) line(false, NY[k], NX, k > 0 && k < NY.length - 1);
// the void round the bunker (never drawn, never reached)
const X0 = NX[0] - 30,
  X1 = NX[NX.length - 1] + 30,
  Y0 = NY[0] - 30,
  Y1 = NY[NY.length - 1] + 30;
const VOID = [
  [0, 0, 4800, Y0],
  [0, Y1, 4800, 4800],
  [0, Y0, X0, Y1],
  [X1, Y0, 4800, Y1],
];
for (let i = 0; i < 3; i++)
  for (let j = 0; j < 2; j++) {
    floors.push([NX[i], NY[j], NX[i + 1], NY[j + 1], room(i, j)[0]]);
    const [cx, cy] = ctr(i, j);
    lights.push([cx, cy, 560, room(i, j)[1]]);
  }

// ---- the furniture, placed against the walls (gen/labmap.mjs's helpers): flush with a wall, or in a corner ----
const fp = (n, flip) => {
  const d = SIM.PROP[n];
  return flip ? [d.fh, d.fw] : [d.fw, d.fh];
};
const IN = (i, j) => {
  const [cx, cy] = ctr(i, j);
  return { x0: NX[i] + T - cx, x1: NX[i + 1] - T - cx, y0: NY[j] + T - cy, y1: NY[j + 1] - T - cy };
};
const put = (i, j, n, dx, dy, flip = 0) => {
  const [cx, cy] = ctr(i, j);
  props.push([n, Math.round(cx + dx), Math.round(cy + dy), flip]);
};
// side 'n' / 's': the room's low / high gy wall, 'w' / 'e': its low / high gx wall; u: where along it (from the room's
// middle)
const at = (i, j, n, side, u, flip = 0) => {
  const [w, h] = fp(n, flip),
    r = IN(i, j);
  const dx = side === 'w' ? r.x0 + w / 2 + 11 : side === 'e' ? r.x1 - w / 2 - 11 : u;
  const dy = side === 'n' ? r.y0 + h / 2 + 11 : side === 's' ? r.y1 - h / 2 - 11 : u;
  put(i, j, n, dx, dy, flip);
};
const corner = (i, j, n, c, flip = 0) => {
  const [w, h] = fp(n, flip),
    r = IN(i, j);
  put(
    i,
    j,
    n,
    c[1] === 'w' ? r.x0 + w / 2 + 11 : r.x1 - w / 2 - 11,
    c[0] === 'n' ? r.y0 + h / 2 + 11 : r.y1 - h / 2 - 11,
    flip,
  );
};
const dec = (i, j, k, dx, dy, s = 60, a = 0) => {
  const [cx, cy] = ctr(i, j);
  decor.push([k, cx + dx, cy + dy, s, a]);
};
// the hall: Walt's counter and Nova's radio desk along its far wall, crates in a corner
at(1, 0, 'lb_stall', 'n', -150);
at(1, 0, 'lb_radio', 'n', 230);
put(1, 0, 'np_walt', -320, -350); // Walt beside his counter, Nova beside her desk (live/hub.js finds them by these)
put(1, 0, 'np_nova', 120, -350);
corner(1, 0, 'lb_crates', 'sw');
corner(1, 0, 'lb_watercooler', 'se');
dec(1, 0, 'stripe', 0, 120, 120, 0);
// the generator room: the generator along its outer wall, the workbench and a cabinet along the far one
at(2, 0, 'lb_generator', 'e', 0, 1);
at(2, 0, 'lb_workbench', 'n', -60);
corner(2, 0, 'lb_cabinet', 'nw');
corner(2, 0, 'lb_drums', 'sw');
dec(2, 0, 'cable', 120, 40, 90, 0.6);
// the store: the lockers and a shelf (the stash), the cot and its drip in a corner (the medbay)
at(1, 1, 'lb_lockers', 's', -170);
at(1, 1, 'lb_shelf', 's', 190);
corner(1, 1, 'lb_stretcher', 'nw', 1);
put(1, 1, 'lb_iv', -300, -330);
corner(1, 1, 'lb_cabinet', 'ne');
dec(1, 1, 'paper', 60, 60, 60, 0.3);
// the range: three targets along its outer wall
at(2, 1, 'lb_target', 'e', 0, 1);
at(2, 1, 'lb_target', 'e', -170, 1);
at(2, 1, 'lb_target', 'e', 170, 1);
corner(2, 1, 'lb_crates', 'sw');
dec(2, 1, 'stripe', -100, 0, 140, 1.57);
put(2, 1, 'lb_sandbags', -10, 0); // the firing line
// the kitchen ("soon"): the counter, the coffee machine, a table
at(0, 0, 'lb_counter', 'n', 0);
corner(0, 0, 'lb_vending', 'sw');
corner(0, 0, 'lb_coffee', 'nw');
put(0, 0, 'lb_cafetable', 0, 140);
dec(0, 0, 'puddle', -120, 160, 70, 0);
// the NEAR AI server room ("soon"): a row of servers, the battery cabinets
at(0, 1, 'lb_servers', 's', 0);
at(0, 1, 'lb_ups', 'w', 120, 1);
corner(0, 1, 'lb_server', 'ne');
dec(0, 1, 'cable', 40, 120, 90, 0.2);
put(0, 1, 'lb_rubble', 280, 0); // taped off by its door: not built yet

const M = {
  v: 1,
  spawn: [2400, 2080],
  walls,
  posts,
  void: VOID,
  floors,
  props,
  decor,
  lights,
  starts: [],
  roads: [],
  areas: [],
  trees: [],
  bushes: [],
};
const { checkBase, baseSource } = await import(new URL('../server/mapfile.mjs', import.meta.url));
const err = checkBase(M);
if (err) throw new Error('the draft is not a map: ' + err);
const dst = path.join(ROOT, 'live/map_base.js');
if (fs.existsSync(dst) && !process.argv.includes('--force')) {
  console.log("live/map_base.js is the map editor's now: node gen/basemap.mjs --force to throw it away and start over");
  process.exit(1);
}
fs.writeFileSync(dst, baseSource(M));
console.log(
  'map_base.js:',
  walls.length,
  'walls',
  posts.length,
  'posts',
  props.length,
  'props',
  lights.length,
  'lights',
);
