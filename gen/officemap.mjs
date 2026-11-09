// gen/officemap.mjs — the first draft of the NEAR AI office's map (live/map_office.js, mission 1), laid out after the
// human's concept art (art/office/refs/concept_*.png): the road from the van with the supplies to the checkpoint where
// the horde stands, a narrow passage into the office's parking lot (the guards by the entrance, the bomb at the
// passage's end), the office itself (its walls, its door, its furniture) and the forest round it all (void: nothing
// walks there). From then on the map is the map editor's (its office button): this refuses to overwrite it without
// --force.
//   node gen/officemap.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkOffice, officeSource } from '../server/mapfile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIM = createRequire(import.meta.url)('../live/sim.js');
// the office's own props (gen/officeart.py) where they are in the prop table already; else the stand-in we have
const has = (n) => Object.prototype.hasOwnProperty.call(SIM.PROP, n),
  or = (n, alt) => (has(n) ? n : alt);
// the office: gx 1950..3200, its front (the door) at gy 1250, as deep as the building's drawing says (950 until then);
// the back wall a whole number of wall pieces from the front
const OFF_D = Math.round((has('of_office') ? SIM.PROP.of_office.fh : 950) / 50) * 50,
  OFF_Y0 = 1250 - OFF_D;
const G = 4800;

// the play area: the road with the van, the checkpoint's crossroads, the road on, the passage, the parking lot, the
// office; everything else is void with the forest drawn over it
const PLAY = [
  [2020, 3480, 2700, 4560], // the road from the start past the van
  [1950, 3050, 2850, 3480], // the checkpoint's crossroads
  [2150, 2400, 2650, 3050], // the road on to the parking lot
  [2310, 1950, 2490, 2400], // the passage
  [1850, 1250, 3300, 1950], // the parking lot
  [1950, OFF_Y0, 3200, 1250], // the office
];
// the void: the map less the play area, cut in bands of gy
function voids() {
  const ys = [...new Set([0, G, ...PLAY.flatMap((r) => [r[1], r[3]])])].sort((a, b) => a - b),
    out = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i],
      y1 = ys[i + 1],
      cov = PLAY.filter((r) => r[1] <= y0 && r[3] >= y1)
        .map((r) => [r[0], r[2]])
        .sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [a, b] of cov) {
      if (a > x) out.push([x, y0, a, y1]);
      x = Math.max(x, b);
    }
    if (x < G) out.push([x, y0, G, y1]);
  }
  // the same column in bands one after another: one rect
  const merged = [];
  for (const r of out) {
    const m = merged.find((q) => q[0] === r[0] && q[2] === r[2] && q[3] === r[1]);
    if (m) m[3] = r[3];
    else merged.push(r.slice());
  }
  return merged;
}
const inPlay = (gx, gy, pad) =>
  PLAY.some((r) => gx > r[0] - pad && gx < r[2] + pad && gy > r[1] - pad && gy < r[3] + pad);

// a small seeded random for the forest (the same draft every run)
let seed = 20261109;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

const props = [];
const P = (n, gx, gy, dir = 0) => props.push([n, gx, gy, dir]);
// a row of wall pieces along gx (dir 0) or gy (dir 1), each len long, from a to b at c
const row = (n, len, ax, a, b, c) => {
  for (let v = a + len / 2; v <= b - len / 2 + 1; v += len) ax === 'gx' ? P(n, v, c, 0) : P(n, c, v, 1);
};

// ---- the road from the start: the van with the supplies on the left, the concrete wall behind it, the rail on the
// cliff side
P('iso_van', 2140, 4150, 1);
P('iso_crate', 2120, 3960);
P('iso_crate2', 2080, 4330);
row('iso_cwall', 250, 'gy', 3700, 4450, 2000);
if (has('of_wallnear')) props.find((q) => q[0] === 'iso_cwall' && q[2] === 4075)[0] = 'of_wallnear';
// the cliff side: rocks out past the rail
if (has('of_rock'))
  for (const [gx, gy, d] of [
    [2900, 3800, 0],
    [2960, 4250, 1],
    [2860, 2700, 0],
    [1780, 1560, 1],
    [1820, 3700, 1],
  ])
    P('of_rock', gx, gy, d);
row('iso_rail', 220, 'gy', 3600, 4480, 2715);
P('iso_lamp3', 2190, 3880);
P('iso_lamp3', 2610, 4280);
P('iso_crate2', 2640, 3990);
P('iso_crate3', 2650, 4060);
P('p_cone', 2470, 3720);
// ---- the checkpoint: the booth, sandbags and crates by it, barriers either side of the road, the van and the car
// left on the crossroads, the gate over the road beyond
P(or('of_booth', 'bld_booth'), 2080, 3610);
P('lb_sandbags', 2200, 3560, 0);
P('iso_crate', 2180, 3420);
P('iso_metalcrate', 2120, 3470);
P('iso_barrier2', 2230, 3700, 0);
P('iso_barrier3', 2580, 3620, 0);
P('iso_van', 2160, 3180, 0);
P('iso_car_red', 2690, 3330, 0);
P('p_obarrel', 2590, 3420);
P('p_obarrel', 2620, 3445);
P('p_cone', 2330, 3540);
P('iso_lamp3', 2180, 3060);
P('iso_lamp3', 2620, 3060);
// the gate over the road stands on its front (right-hand) pillar
if (has('of_gate')) P('of_gate', 2590, 3100);
row('iso_mesh', 270, 'gx', 1960, 2230, 3065);
row('iso_mesh', 270, 'gx', 2570, 2840, 3065);
// ---- the road on: fences either side, barriers and crates
row('iso_mesh', 270, 'gy', 2420, 3050, 2165);
row('iso_mesh', 270, 'gy', 2420, 3050, 2635);
P('iso_barrier2', 2240, 2620, 0);
P('iso_crate', 2580, 2800);
P('iso_crate3', 2590, 2870);
P('iso_lamp3', 2600, 2500);
// ---- the passage: concrete blocks both sides
row('iso_block', 150, 'gy', 1950, 2400, 2295);
row('iso_block', 150, 'gy', 1950, 2400, 2505);
// ---- the parking lot: the cars, a van, barriers, crates, lamps, walls and fences round it
P('iso_car_white', 2030, 1500, 0);
P('iso_car_red2', 3120, 1420, 0);
P('iso_car_sedan', 3150, 1760, 0);
P('iso_van', 1960, 1800, 1);
P('iso_barrier2', 2700, 1890, 1);
P('iso_barrier3', 2060, 1900, 1);
P('iso_crate', 2950, 1880);
P('iso_crate2', 3010, 1900);
P('iso_lamp3', 1900, 1320);
P('iso_lamp3', 3250, 1320);
P('iso_lamp3', 2600, 1880);
if (has('of_banner')) for (const gx of [2420, 2730]) P('of_banner', gx, 1310);
row('iso_cwall', 250, 'gy', 1300, 1800, 1840);
row('iso_mesh', 270, 'gy', 1300, 1840, 3290);
// ---- the office: its walls (the door in the front one), the reception facing the door, the lounge, the meeting
// table, the desks, the servers, Walt's corner
row('iso_cwall', 250, 'gx', 1950, 2450, 1250);
row('iso_cwall', 250, 'gx', 2700, 3200, 1250);
row('iso_cwall', 250, 'gx', 1950, 3200, OFF_Y0);
row('iso_cwall', 250, 'gy', 1300 - Math.ceil(OFF_D / 250) * 250, 1300, 1950);
row('iso_cwall', 250, 'gy', 1300 - Math.ceil(OFF_D / 250) * 250, 1300, 3200);
P(or('of_logowall', 'lb_screen'), 2575, 650, 0);
P(or('of_reception', 'lb_counter'), 2575, 800, 0);
if (has('of_lounge')) P('of_lounge', 2180, 1030);
else P('lb_cafetable', 2150, 1050);
P('lb_bigplant', 2050, 1160);
P('lb_bigplant', 2050, 420);
P(or('of_meeting', 'lb_table'), 2230, 500, 0);
if (has('of_desks')) for (const gy of [680, 960]) P('of_desks', 2860, gy, 0);
else
  for (const [gx, gy, d] of [
    [2800, 640, 0],
    [2920, 640, 0],
    [2800, 700, 2],
    [2920, 700, 2],
    [2800, 940, 0],
    [2920, 940, 0],
  ])
    P('lb_desk', gx, gy, d);
P('lb_planter', 2580, 1150, 0);
P('lb_servers', 3020, 400, 0);
// glass walls: the server room's and the meeting room's
if (has('of_glass')) for (const gx of [2925, 3075, 2075, 2325]) P('of_glass', gx, gx > 2600 ? 560 : 740, 0);
if (has('of_corner')) P('of_corner', 3090, 1080, 0);
else {
  P('lb_sandbags', 3100, 1060, 0);
  P('lb_crates', 3120, 930);
}
P('np_walt', 3030, 990, 0);
// the building itself: its roof over the office, standing on the office's footprint
if (has('of_office')) P('of_office', 1950 + SIM.PROP.of_office.fw / 2, 1250 - SIM.PROP.of_office.fh / 2, 0);

// ---- the forest over the void: trees and bushes a little way out from the play area all round
const trees = [],
  bushes = [];
for (let i = 0; i < 2600 && trees.length < 260; i++) {
  const gx = 1300 + rnd() * 2600,
    gy = 0 + rnd() * 4800;
  if (inPlay(gx, gy, 60) || !inPlay(gx, gy, 700)) continue;
  // (a tree just in front of the play area, lower on the screen, would hide it: only bushes there)
  if (inPlay(gx - 300, gy - 300, 0) || inPlay(gx - 420, gy, 0) || inPlay(gx, gy - 420, 0)) continue;
  if (trees.some((t) => Math.hypot(t[1] - gx, t[2] - gy) < 170)) continue;
  const k = rnd();
  trees.push([
    k < 0.5 ? 'p_mtree' + (1 + Math.floor(rnd() * 3)) : 'p_tree' + (1 + Math.floor(rnd() * 3)),
    Math.round(gx),
    Math.round(gy),
    Math.round(300 + rnd() * 160),
    rnd() < 0.5 ? 1 : 0,
  ]);
}
for (let i = 0; i < 3000 && bushes.length < 160; i++) {
  const gx = 1500 + rnd() * 2200,
    gy = 200 + rnd() * 4400;
  if (inPlay(gx, gy, 10) || !inPlay(gx, gy, 160)) continue;
  bushes.push([
    rnd() < 0.5 ? 'p_mbush' + (1 + Math.floor(rnd() * 4)) : 'p_bush' + (1 + Math.floor(rnd() * 3)),
    Math.round(gx),
    Math.round(gy),
    Math.round(130 + rnd() * 80),
    rnd() < 0.5 ? 1 : 0,
  ]);
}

const m = {
  v: 1,
  spawn: [2400, 4420],
  roads: [
    [2280, 2400, 2520, 4560, 70],
    [1950, 3180, 2850, 3420, 70],
    [1850, 1250, 3300, 1950, 0],
  ],
  areas: [
    [2310, 1950, 2490, 2400, 'plaza'],
    [1950, OFF_Y0, 3200, 1250, 'tiles'],
  ],
  props,
  trees,
  bushes,
  decor: [
    ['stain', 2450, 3330, 70, 0.4],
    ['stain', 2330, 3250, 50, 1.2],
    ['stain', 2560, 1420, 60, 0.8],
    ['stain', 2700, 850, 55, 2.1],
    ['manhole', 2400, 3700],
    // the parking lot's stalls (white lines along gx), the hatched strip before the door, the logo on the office floor
    ...[1330, 1470, 1610, 1750, 1890].map((gy) => ['line', 3150, gy, 260, 0, 0]),
    ...[1360, 1500, 1640, 1780].map((gy) => ['line', 2000, gy, 260, 0, 0]),
    ['hatch', 2575, 1330, 250, 120],
    ['logo', 2330, 980, 300],
  ],
  marks: [
    ['start', 2400, 4420],
    ['crate', 2210, 3960],
    ['line_a', 2020, 3880],
    ['line_b', 2700, 3880],
    ['horde', 2400, 3270],
    ['parking', 2400, 2330],
    ['bomb', 2400, 1985],
    ['guards', 2550, 1480],
    ['drop', 2800, 1580],
    ['inside', 2575, 1050],
  ],
  void: voids(),
  gates: [
    [2150, 2980, 2650, 3020, 'checkpoint'],
    [2450, 1232, 2700, 1268, 'door'],
  ],
};
const dst = path.join(ROOT, 'live/map_office.js');
if (fs.existsSync(dst) && !process.argv.includes('--force')) {
  console.log(
    "live/map_office.js is the map editor's now: node gen/officemap.mjs --force to throw it away and start over",
  );
  process.exit(1);
}
const err = checkOffice(m);
if (err) throw new Error('bad map: ' + err);
fs.writeFileSync(dst, officeSource(m));
console.log(
  `live/map_office.js: ${props.length} props, ${trees.length} trees, ${bushes.length} bushes, ${m.void.length} void`,
);
