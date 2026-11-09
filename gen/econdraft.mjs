// gen/econdraft.mjs — writes a whole economy draft into live/economy.js and live/data.js through the economy page's
// writer (server/econfile.mjs), so a tuning pass lands in the same form as a save from the page. The draft is the
// module named on the command line (default gen/econtune.mjs): it exports a function that gets the current tables
// (loot, recipes, buildings, upgrades, prices, missions, items) and changes them in place.
// Run: node gen/econdraft.mjs [gen/econtune.mjs]
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as EF from '../server/econfile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const draft = (
  await import(pathToFileURL(path.resolve(process.argv[2] || path.join(ROOT, 'gen', 'econtune.mjs'))).href)
).default;
const cur = await EF.readEcon();
const t = structuredClone({
  loot: cur.E.LOOT,
  recipes: cur.E.RECIPES,
  buildings: cur.E.BUILDINGS,
  upgrades: cur.E.UPGRADES,
  prices: {
    meta: Object.fromEntries(Object.keys(cur.D.META).map((k) => [k, cur.D.META[k].price])),
    weapon: Object.fromEntries(Object.keys(cur.D.WEAPON_UP).map((k) => [k, cur.D.WEAPON_UP[k].price])),
  },
});
const extra = draft(t, cur) || {};
let econ = EF.econSource(cur.econ, t);
// items' prices and the missions' rewards live outside the page's tables: the draft returns them as text swaps
for (const [from, to] of extra.swaps || []) {
  if (econ.includes(to)) continue; // (already applied by an earlier pass)
  if (econ.split(from).length !== 2) throw new Error('draft swap does not match once: ' + from.slice(0, 80));
  econ = econ.replace(from, () => to);
}
econ = await EF.formatJs(econ, EF.FILES.econ);
const data = await EF.formatJs(EF.dataSource(cur.data, t.prices), EF.FILES.data);
await fsp.writeFile(EF.FILES.econ, econ);
await fsp.writeFile(EF.FILES.data, data);
console.log('draft written to live/economy.js and live/data.js');
