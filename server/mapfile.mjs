// live/map.js from the map editor's data: checkMap(m) → an error message or '' (the shape, the sizes, the names the sim knows),
// mapSource(m) → the file's text (one item per line). server.mjs --editor saves it (POST /api/editor/map).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
delete require.cache[require.resolve('../live/sim.js')]; // (the sim as it is now: server.mjs --editor loads this file again when it or sim.js changed)
const SIM = require('../live/sim.js');

const MATS = ['tiles', 'plaza', 'dirt', 'floor'],
  GRAF = ['p_graffiti1', 'p_graffiti2'],
  LIM = 4800 * 3;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIM;
const list = (a, max) => Array.isArray(a) && a.length <= max;
// marks [name, gx, gy]: the places a campaign mission's script names (live/missions.js at), each name once; a map
// without any leaves them out
function checkMarks(m) {
  if (m.marks === undefined) return '';
  if (!list(m.marks, 60)) return 'marks';
  const seen = [];
  for (const q of m.marks) {
    if (!Array.isArray(q) || q.length !== 3 || typeof q[0] !== 'string' || !/^[a-z][a-z0-9_]{0,23}$/.test(q[0]))
      return 'marks';
    if (!num(q[1]) || !num(q[2]) || seen.includes(q[0])) return 'marks';
    seen.push(q[0]);
  }
  return '';
}
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
              : d[0] === 'flower' || d[0] === 'logo'
                ? d.length === 4 && d.slice(1).every(num)
                : d[0] === 'hatch'
                  ? d.length === 5 && d.slice(1).every(num)
                  : SIM.MARKINGS[d[0]] > 0
                    ? d.length === 6 &&
                      d.slice(1, 4).every(num) &&
                      Number.isInteger(d[4]) &&
                      d[4] >= 0 &&
                      d[4] <= SIM.MARKINGS[d[0]] &&
                      [0, 1].includes(d[5])
                    : false),
    )
  )
    return 'decor';
  return checkMarks(m);
}

export function mapSource(m) {
  const rows = (k) =>
    `    ${k}: [\n${(m[k] || []).map((it) => '      ' + JSON.stringify(it) + ',').join('\n')}\n    ],`;
  return `// live/map.js — the level, made in the map editor (map-editor.bat → /live/index.html?editor) and written by its server
// (server/mapfile.mjs). The page and the game's server (its replays) build the same level from it (sim.js level).
// Ground units: gx, gy in [0, 4800]; the screen plane is x = gx − gy + 4800, y = (gx + gy) / 2.
// spawn [gx, gy]; roads [x0, y0, x1, y1, sidewalk width]; areas [x0, y0, x1, y1, 'tiles' | 'plaza' | 'dirt'];
// props [name, gx, gy, dir] (dir: its turn in quarters, 0..3: sim.js level); trees and bushes [name, gx, gy, width, flip];
// decor ['manhole', gx, gy] | ['stain', gx, gy, size, angle] | ['graf', gx, gy, picture, size, angle] | ['flower', gx, gy, size]
// | ['line', gx, gy, length, along gy, yellow] | ['hatch', gx, gy, size along gx, size along gy] | ['logo', gx, gy, size]
// | the floor markings [kind, gx, gy, size, turn, yellow]: dash, zebra, stripe (turn 0..1), stalls, arrow, park (0..3);
// marks [name, gx, gy]: the places a campaign mission's script names (live/missions.js), set in the map editor
(function (root) {
  const M = {
    v: 1,
    spawn: ${JSON.stringify(m.spawn)},
${['roads', 'areas', 'props', 'trees', 'bushes', 'decor', 'marks'].map(rows).join('\n')}
  };
  root.MAP = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// ---------------------------------------------------------------- the NEAR AI office (live/map_office.js; the editor's
// ?editor&map=office) mission 1's map: laid out as the town is, plus void (solid, never drawn: the land round the play
// area) and gates [x0, y0, x1, y1, name] (walls of nothing a mission's script opens: live/missions.js open)
export function checkOffice(m) {
  const err = checkMap(m);
  if (err) return err;
  if (!list(m.void, 200) || !m.void.every((r) => rect(r) && r.length === 4)) return 'void';
  if (
    !list(m.gates, 40) ||
    !m.gates.every((g) => Array.isArray(g) && g.length === 5 && rect(g) && /^[a-z][a-z0-9_]{0,23}$/.test(g[4]))
  )
    return 'gates';
  // zones [x0, y0, x1, y1]: the yellow dashed rectangles painted on the floor
  if (m.zones !== undefined && !(list(m.zones, 200) && m.zones.every((r) => rect(r) && r.length === 4))) return 'zones';
  // size: the ground is [0, size]² (sim.js level: 4800 when left out); shift [dx, dy]: how far the whole map was moved
  // since it was made (the editor moves a draft from before the same way)
  if (m.size !== undefined && !(num(m.size) && m.size >= 2400 && m.size <= SIM.GMAX)) return 'size';
  if (m.shift !== undefined && !(Array.isArray(m.shift) && m.shift.length === 2 && m.shift.every(num))) return 'shift';
  return '';
}
// the office maps' size and shift lines (left out while they are the default)
const sizeRows = (m) =>
  (m.size && m.size !== 4800 ? `    size: ${m.size},\n` : '') +
  (m.shift && (m.shift[0] || m.shift[1]) ? `    shift: ${JSON.stringify(m.shift)},\n` : '');
// (kind: 'office', 'office_in' its inside, or 'base' NEAR Base's own copy of the inside)
export function officeSource(m, kind = 'office') {
  const rows = (k) =>
    `    ${k}: [\n${(m[k] || []).map((it) => '      ' + JSON.stringify(it) + ',').join('\n')}\n    ],`;
  if (kind === 'base')
    return `// live/map_base.js — NEAR Base, the hub between runs: its own copy of the office's inside (live/map_office_in.js, made
// 2026-11-11 for the human to rework for the base, part of the street and the parking with it). Edited in the map editor
// (?editor&map=base, its База button) and written by its server (server/mapfile.mjs); sim.js level() builds it for
// SIM.BASE (no mission there, Walt and Nova where sim.js HUB_NPC puts them, the buildings and the old furniture as
// live/hub.js lays them out). Laid out as live/map_office.js is.
(function (root) {
  const M = {
    v: 1,
${sizeRows(m)}    spawn: ${JSON.stringify(m.spawn)},
${['backs', 'roads', 'areas', 'props', 'trees', 'bushes', 'decor', 'marks', 'void', 'gates', 'zones'].map(rows).join('\n')}
  };
  root.MAP_BASE = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
  if (kind === 'office_in')
    return `// live/map_office_in.js — the NEAR AI office's inside, mission 1's second map: its door (live/missions.js office,
// action 'map') leads in here and nothing leads back. Edited in the map editor (?editor&map=office_in) and written by its
// server (server/mapfile.mjs); sim.js level() builds it for SIM.OFFICE_IN (NEAR Base has its own copy since 2026-11-11:
// live/map_base.js). Laid out as live/map_office.js is.
(function (root) {
  const M = {
    v: 1,
${sizeRows(m)}    spawn: ${JSON.stringify(m.spawn)},
${['backs', 'roads', 'areas', 'props', 'trees', 'bushes', 'decor', 'marks', 'void', 'gates', 'zones'].map(rows).join('\n')}
  };
  root.MAP_OFFICE_IN = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
  return `// live/map_office.js — the NEAR AI office, mission 1's map (live/missions.js office), edited in the map editor
// (map-editor.bat, its office button, or /live/index.html?editor&map=office; its first draft came from gen/officemap.mjs)
// and written by its server (server/mapfile.mjs). sim.js level() builds it for SIM.OFFICE. Laid out as the town is
// (live/map.js: spawn, roads, areas, props, trees, bushes, decor, marks); void [x0, y0, x1, y1]: solid, never drawn (the
// land round the play area); gates [x0, y0, x1, y1, name]: walls of nothing until the mission's script opens them;
// zones [x0, y0, x1, y1]: yellow dashed rectangles painted on the floor; size: the ground is [0, size]² (4800 when left
// out); shift [dx, dy]: how far the whole map was moved since it was made. The office building is a roof prop: it stops
// nothing and hides while a hero is under it.
(function (root) {
  const M = {
    v: 1,
${sizeRows(m)}    spawn: ${JSON.stringify(m.spawn)},
${['roads', 'areas', 'props', 'trees', 'bushes', 'decor', 'marks', 'void', 'gates', 'zones'].map(rows).join('\n')}
  };
  root.MAP_OFFICE = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// ---------------------------------------------------------------- the laboratory (live/map_lab.js; the editor's ?editor&map=lab)
// checkLab(m) → an error message or ''; labSource(m) → the file's text. The hall (the biggest floor of kind 'hall') is worked out from
// the floors; the gas closes in on it (sim.js GAS: a circle round its middle), so moving the hall's walls and floor moves the gas's end
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
// the final boss's hall: the biggest floor of kind 'hall' (another room laid with the hall's tiles is an ordinary room)
const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
export const bossHall = (floors) =>
  floors.reduce((b, r) => (r[4] === 'hall' && (!b || area(r) > area(b)) ? r : b), null);
export function checkLab(m) {
  const err = checkRooms(m);
  if (err) return err;
  if (!bossHall(m.floors)) return 'нет пола вида «Зал» (в нём ждёт финальный босс)';
  if (!m.starts.length) return 'starts (one at least)';
  return '';
}
// a map laid out in rooms (the laboratory's, NEAR Base's): the shape, the sizes, the names the sim knows
function checkRooms(m) {
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
  if (!list(m.starts, 40) || !m.starts.every((s) => Array.isArray(s) && s.length === 2 && s.every(num)))
    return 'starts';
  return checkMarks(m);
}
export function labSource(m) {
  const hall = bossHall(m.floors).slice(0, 4);
  const rows = (k) =>
    `    ${k}: [\n${(m[k] || []).map((it) => '      ' + JSON.stringify(it) + ',').join('\n')}\n    ],`;
  return `// live/map_lab.js — the laboratory's level, edited in the map editor (map-editor.bat → Лаборатория, or /live/index.html?editor&map=lab;
// its first draft came from gen/labmap.mjs) and written by its server (server/mapfile.mjs). sim.js level() builds it for the lab's
// seeds (SIM.LAB0 and up). walls [x0, y0, x1, y1] (cut into WALL_M pieces), posts [gx, gy, door], void (solid, never drawn), floors
// [x0, y0, x1, y1, kind] (ground.js paintLab), props [name, gx, gy, dir], decor [kind, gx, gy, size, angle], lights [gx, gy, r, tint],
// starts [gx, gy] (a run begins at one of them), hall [x0, y0, x1, y1] (the final boss waits in it, the gas closes in on it: sim.js
// GAS); marks [name, gx, gy]: the places a campaign mission's script names (live/missions.js)
(function (root) {
  const M = {
    v: 1,
    spawn: ${JSON.stringify(m.spawn)},
${['walls', 'posts', 'void', 'floors', 'props', 'decor', 'lights', 'starts', 'marks'].map(rows).join('\n')}
    hall: ${JSON.stringify(hall)},
    roads: [], areas: [], trees: [], bushes: [],
  };
  root.MAP_LAB = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}
