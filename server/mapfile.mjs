// live/map.js from the map editor's data: checkMap(m) → an error message or '' (the shape, the sizes, the names the sim knows),
// mapSource(m) → the file's text (one item per line). server.mjs --editor saves it (POST /api/editor/map).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
delete require.cache[require.resolve('../live/sim.js')]; // (the sim as it is now: server.mjs --editor loads this file again when it or sim.js changed)
const SIM = require('../live/sim.js');

const MATS = ['tiles', 'plaza', 'dirt'],
  GRAF = ['p_graffiti1', 'p_graffiti2'],
  LIM = 4800 * 3;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIM;
const list = (a, max) => Array.isArray(a) && a.length <= max;
export function checkMap(m) {
  if (!m || typeof m !== 'object' || m.v !== 1) return 'not a map (v: 1)';
  if (!Array.isArray(m.spawn) || m.spawn.length !== 2 || !m.spawn.every(num)) return 'spawn';
  if (
    !list(m.roads, 300) ||
    !m.roads.every(
      (r) =>
        Array.isArray(r) && r.length === 5 && r.every(num) && r[2] > r[0] && r[3] > r[1] && r[4] >= 0 && r[4] <= 300,
    )
  )
    return 'roads';
  if (
    !list(m.areas, 1000) ||
    !m.areas.every(
      (r) =>
        Array.isArray(r) &&
        r.length === 5 &&
        r.slice(0, 4).every(num) &&
        r[2] > r[0] &&
        r[3] > r[1] &&
        MATS.includes(r[4]),
    )
  )
    return 'areas';
  if (
    !list(m.props, 8000) ||
    !m.props.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 4 &&
        Object.prototype.hasOwnProperty.call(SIM.PROP, p[0]) &&
        num(p[1]) &&
        num(p[2]) &&
        [0, 1, 2, 3].includes(p[3]),
    )
  )
    return 'props';
  const plant = (p) =>
    Array.isArray(p) &&
    p.length === 5 &&
    typeof p[0] === 'string' &&
    /^p_[a-z0-9_]+$/.test(p[0]) &&
    num(p[1]) &&
    num(p[2]) &&
    p[3] >= 10 &&
    p[3] <= 1500 &&
    (p[4] === 0 || p[4] === 1);
  if (!list(m.trees, 8000) || !m.trees.every(plant)) return 'trees';
  if (!list(m.bushes, 8000) || !m.bushes.every(plant)) return 'bushes';
  if (
    !list(m.decor, 8000) ||
    !m.decor.every(
      (d) =>
        Array.isArray(d) &&
        (d[0] === 'manhole'
          ? d.length === 3 && num(d[1]) && num(d[2])
          : d[0] === 'stain'
            ? d.length === 5 && d.slice(1).every(num)
            : d[0] === 'graf'
              ? d.length === 6 && num(d[1]) && num(d[2]) && GRAF.includes(d[3]) && num(d[4]) && num(d[5])
              : d[0] === 'flower'
                ? d.length === 4 && d.slice(1).every(num)
                : false),
    )
  )
    return 'decor';
  return '';
}

export function mapSource(m) {
  const rows = (k) => `    ${k}: [\n${m[k].map((it) => '      ' + JSON.stringify(it) + ',').join('\n')}\n    ],`;
  return `// live/map.js — the level, made in the map editor (map-editor.bat → /live/index.html?editor) and written by its server
// (server/mapfile.mjs). The page and the game's server (its replays) build the same level from it (sim.js level).
// Ground units: gx, gy in [0, 4800]; the screen plane is x = gx − gy + 4800, y = (gx + gy) / 2.
// spawn [gx, gy]; roads [x0, y0, x1, y1, sidewalk width]; areas [x0, y0, x1, y1, 'tiles' | 'plaza' | 'dirt'];
// props [name, gx, gy, dir] (dir: its turn in quarters, 0..3: sim.js level); trees and bushes [name, gx, gy, width, flip];
// decor ['manhole', gx, gy] | ['stain', gx, gy, size, angle] | ['graf', gx, gy, picture, size, angle] | ['flower', gx, gy, size]
(function (root) {
  const M = {
    v: 1,
    spawn: ${JSON.stringify(m.spawn)},
${['roads', 'areas', 'props', 'trees', 'bushes', 'decor'].map(rows).join('\n')}
  };
  root.MAP = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// ---------------------------------------------------------------- the laboratory (live/map_lab.js; the editor's ?editor&map=lab)
// checkLab(m) → an error message or ''; labSource(m) → the file's text. The hall (the biggest floor of kind 'hall') and the gas's rooms
// (every other floor; the ones beside the hall 12 s later) are worked out from the floors, so moving a room's walls and floor moves its gas
export const LAB_FLOORS = ['hall', 'store', 'server', 'gen', 'green', 'exp', 'cells', 'cafe', 'decon'];
export const LAB_DECOR = [
  'goo',
  'glass',
  'cable',
  'paper',
  'drain',
  'grate',
  'stain',
  'moss',
  'blood',
  'puddle',
  'stripe',
];
export const LAB_TINTS = ['white', 'warm', 'blue', 'orange', 'pink', 'green', 'red'];
const rect = (r) => Array.isArray(r) && r.length >= 4 && r.slice(0, 4).every(num) && r[2] > r[0] && r[3] > r[1];
// the final boss's hall: the biggest floor of kind 'hall' (another room laid with the hall's tiles is an ordinary room: the gas fills it)
const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
export const bossHall = (floors) =>
  floors.reduce((b, r) => (r[4] === 'hall' && (!b || area(r) > area(b)) ? r : b), null);
export function checkLab(m) {
  if (!m || typeof m !== 'object' || m.v !== 1) return 'not a map (v: 1)';
  if (!Array.isArray(m.spawn) || m.spawn.length !== 2 || !m.spawn.every(num)) return 'spawn';
  if (!list(m.walls, 3000) || !m.walls.every((r) => rect(r) && r.length === 4)) return 'walls';
  if (
    !list(m.posts, 3000) ||
    !m.posts.every((p) => Array.isArray(p) && p.length === 3 && num(p[0]) && num(p[1]) && (p[2] === 0 || p[2] === 1))
  )
    return 'posts';
  if (!list(m.void, 100) || !m.void.every((r) => rect(r) && r.length === 4)) return 'void';
  if (!list(m.floors, 200) || !m.floors.every((r) => rect(r) && r.length === 5 && LAB_FLOORS.includes(r[4])))
    return 'floors';
  if (!bossHall(m.floors)) return 'нет пола вида «Зал» (в нём ждёт финальный босс)';
  if (
    !list(m.props, 8000) ||
    !m.props.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 4 &&
        Object.prototype.hasOwnProperty.call(SIM.PROP, p[0]) &&
        num(p[1]) &&
        num(p[2]) &&
        [0, 1, 2, 3].includes(p[3]),
    )
  )
    return 'props';
  if (
    !list(m.decor, 8000) ||
    !m.decor.every((d) => Array.isArray(d) && d.length === 5 && LAB_DECOR.includes(d[0]) && d.slice(1).every(num))
  )
    return 'decor';
  if (
    !list(m.lights, 1000) ||
    !m.lights.every(
      (l) =>
        Array.isArray(l) &&
        l.length === 4 &&
        num(l[0]) &&
        num(l[1]) &&
        l[2] >= 50 &&
        l[2] <= 1500 &&
        LAB_TINTS.includes(l[3]),
    )
  )
    return 'lights';
  if (
    !list(m.starts, 40) ||
    !m.starts.length ||
    !m.starts.every((s) => Array.isArray(s) && s.length === 2 && s.every(num))
  )
    return 'starts (one at least)';
  return '';
}
export function labSource(m) {
  const H = bossHall(m.floors),
    hall = H.slice(0, 4);
  const touches = (r) =>
    r[0] === hall[2] || r[2] === hall[0]
      ? r[1] < hall[3] && r[3] > hall[1]
      : (r[1] === hall[3] || r[3] === hall[1]) && r[0] < hall[2] && r[2] > hall[0];
  const gas = {
    at: -45,
    fill: 20,
    rooms: m.floors.filter((r) => r !== H).map((r) => [r[0], r[1], r[2], r[3], touches(r) ? 12 : 0]),
  };
  const rows = (k) => `    ${k}: [\n${m[k].map((it) => '      ' + JSON.stringify(it) + ',').join('\n')}\n    ],`;
  return `// live/map_lab.js — the laboratory's level, edited in the map editor (map-editor.bat → Лаборатория, or /live/index.html?editor&map=lab;
// its first draft came from gen/labmap.mjs) and written by its server (server/mapfile.mjs). sim.js level() builds it for the lab's
// seeds (SIM.LAB0 and up). walls [x0, y0, x1, y1] (cut into WALL_M pieces), posts [gx, gy, door], void (solid, never drawn), floors
// [x0, y0, x1, y1, kind] (ground.js paintLab), props [name, gx, gy, dir], decor [kind, gx, gy, size, angle], lights [gx, gy, r, tint],
// starts [gx, gy] (a run begins at one of them), hall [x0, y0, x1, y1] (the final boss waits in it), gas { at, fill, rooms [x0, y0,
// x1, y1, delay] } (sim.js gasAt: the rooms filling before the final boss; worked out from the floors)
(function (root) {
  const M = {
    v: 1,
    spawn: ${JSON.stringify(m.spawn)},
${['walls', 'posts', 'void', 'floors', 'props', 'decor', 'lights', 'starts'].map(rows).join('\n')}
    hall: ${JSON.stringify(hall)},
    gas: ${JSON.stringify(gas)},
    roads: [], areas: [], trees: [], bushes: [],
  };
  root.MAP_LAB = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}
