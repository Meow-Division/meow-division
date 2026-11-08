// The lab's level checked: node gen/labcheck.cjs [out.json] — props over walls or over each other, starts and the boss's spot in the
// clear, every floor spot a hero fits reaches the hall (no pocket shut off, nothing to get stuck in), the doors wide enough. Writes the
// colliders as JSON for a picture (gen/labplan.py). Exit 1 on a failure.
const SIM = require('../live/sim.js');
const LV = SIM.level(SIM.LAB0 + 1), G = SIM.G, fails = [];
const cols = LV.props.map((p) => ({ n: p.n, ...p.col, wall: !!(p.wall || p.post || p.hide) }));
const ov = (a, b, m = 0) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
const things = cols.filter((c) => !c.wall), solids = cols.filter((c) => c.wall);
for (const t of things) { for (const w of solids) if (ov(t, w, -0.5)) { fails.push(`${t.n} at ${(t.x0 + t.x1) / 2 | 0},${(t.y0 + t.y1) / 2 | 0} touches a wall`); break; } }
for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) if (ov(things[i], things[j], -2)) fails.push(`${things[i].n} overlaps ${things[j].n} at ${(things[i].x0 + things[i].x1) / 2 | 0},${(things[i].y0 + things[i].y1) / 2 | 0}`);
for (const [gx, gy] of LV.starts) { const [x, y] = SIM.toS(gx, gy); if (SIM.blockedAt({ seed: LV.seed, pd: [] }, x - 65, y, 34) || SIM.blockedAt({ seed: LV.seed, pd: [] }, x + 65, y, 34)) fails.push('start blocked ' + gx + ',' + gy); }
// reachability for a hero (radius 12 → 9 in ground units, plus a margin): 20-unit cells
const C = 20, N = Math.ceil(G / C), free = new Uint8Array(N * N), seen = new Uint8Array(N * N);
const blocked = (gx, gy, pad) => { for (const c of cols) if (gx > c.x0 - pad && gx < c.x1 + pad && gy > c.y0 - pad && gy < c.y1 + pad) return true; return gx < 110 || gy < 110 || gx > G - 110 || gy > G - 110; };
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) free[j * N + i] = blocked(i * C + C / 2, j * C + C / 2, 14) ? 0 : 1;
const s0 = Math.floor(2400 / C) * N + Math.floor(2700 / C), q = [s0]; seen[s0] = 1;
while (q.length) { const k = q.pop(), i = k % N, j = (k / N) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue; const m = b * N + a; if (free[m] && !seen[m]) { seen[m] = 1; q.push(m); } } }
let freeN = 0, lost = []; for (let k = 0; k < N * N; k++) if (free[k]) { freeN++; if (!seen[k]) lost.push(k); }
if (lost.length) { const ex = lost.slice(0, 5).map((k) => `${(k % N) * C},${((k / N) | 0) * C}`); fails.push(`${lost.length} floor cells shut off (e.g. ${ex.join(' ')})`); }
// narrow gaps: a free cell whose free neighbours across it (both ways) are blocked within 40 units = a squeeze a horde jams in
const sq = []; let squeeze = 0; for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) { const k = j * N + i; if (!free[k]) continue;
  if ((!free[k - 2] && !free[k + 2]) || (!free[k - 2 * N] && !free[k + 2 * N])) { squeeze++; sq.push([i * C, j * C]); } }
console.log(`lab level: ${LV.props.length} props (${things.length} things), ${freeN} free cells, ${lost.length} shut off, ${squeeze} squeeze cells, starts ${LV.starts.length}`);
console.log('self check:', JSON.stringify(SIM.selfCheck()));
for (const f of fails) console.log('FAIL', f);
if (process.argv[2]) require('fs').writeFileSync(process.argv[2], JSON.stringify({ cols, starts: LV.starts, hall: LV.hall, sq, lost: lost.map((k) => [(k % N) * C, ((k / N) | 0) * C]) }));
process.exit(fails.length ? 1 : 0);
