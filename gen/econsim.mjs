// gen/econsim.mjs — the economy bots from the command line (the same model as the economy page's Progress tab,
// live/econbot.js): plays many bots through the current live/economy.js and live/data.js on the run samples in
// gen/econruns.json and prints how many raids each purchase takes, the income per raid and where each item goes.
// Run: node gen/econsim.mjs [bots=200] [runs=150] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'live', 'economy.js'));
const D = require(path.join(ROOT, 'live', 'data.js'));
const R = require(path.join(ROOT, 'live', 'rules.js'));
const M = require(path.join(ROOT, 'live', 'econbot.js'));
const { runs } = JSON.parse(fs.readFileSync(path.join(ROOT, 'gen', 'econruns.json'), 'utf8'));
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const [bots = 200, nRuns = 150] = args
  .filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1))
  .map(Number);

const t0 = Date.now();
const res = M.simulate(E, D, runs, { bots, runs: nRuns, winBonus: R.WIN_BONUS });
const rows = M.summary(res);
const order = (k) => ['q', 'b', 'm', 'w', 'g'].indexOf(k[0]) * 1000 + rows.findIndex((r) => r.key === k);
rows.sort((a, b) => order(a.key) - order(b.key));
const pad = (s, n) => String(s).padEnd(n);
console.log(`${bots} bots × ${nRuns} raids in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
console.log(pad('purchase', 20) + pad('median', 8) + pad('p25-p75', 10) + 'got');
for (const r of rows)
  console.log(
    pad(r.key, 20) +
      pad(r.med === Infinity ? '-' : r.med, 8) +
      pad(`${r.p25 === Infinity ? '-' : r.p25}-${r.p75 === Infinity ? '-' : r.p75}`, 10) +
      Math.round(r.share * 100) +
      '%',
  );
console.log('\nraid  coins  items  died  leave  rank');
for (const i of [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 75, 100, 149]) {
  const s = res.per[i];
  if (!s) continue;
  console.log(
    pad(i + 1, 6) +
      pad(Math.round(s.coins / s.n), 7) +
      pad((s.items / s.n).toFixed(1), 7) +
      pad(Math.round((100 * s.died) / s.n) + '%', 6) +
      pad(Math.round(s.t / s.n) + 's', 7) +
      (s.rank / s.n).toFixed(1),
  );
}
console.log('\nitem        got/raid  lost  used  sold  bought');
for (const [id, f] of Object.entries(res.flows).sort((a, b) => b[1].got - a[1].got))
  console.log(
    pad(id, 12) +
      pad((f.got / bots / nRuns).toFixed(2), 10) +
      pad(Math.round(f.lost / bots), 6) +
      pad(Math.round(f.used / bots), 6) +
      pad(Math.round(f.sold / bots), 6) +
      Math.round(f.bought / bots),
  );
if (jsonAt >= 0)
  fs.writeFileSync(args[jsonAt + 1], JSON.stringify({ rows, per: res.per, flows: res.flows, bots, runs: nRuns }));
