// gen/econruns.mjs — turns the balance lab's whole runs (balance/<name>.json, from node gen/balance.cjs <name> …) into the
// samples the economy bots live on (gen/econruns.json): per run, when the hero would first have died (null: never), when
// the run was won (null: not), kills summed per 30 s, the level per 30 s, the run's coins, the coins so far per 30 s (balance
// files from 2026-11-09 on; older ones have none and the bots spread the coins like the kills), and when each boss fell.
// Run: node gen/econruns.mjs [name=eco]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'eco';
const lab = JSON.parse(fs.readFileSync(path.join(ROOT, 'balance', name + '.json'), 'utf8'));
const out = [];
for (const acc of lab.accounts)
  for (const r of acc.runs) {
    let sum = 0;
    const k = r.bins.map((b) => (sum += b.kills));
    let top = 1;
    const l = r.bins.map((b) => (top = Math.max(top, b.lvl || top)));
    let got = 0;
    const cc = r.bins.length && 'coins' in r.bins[0] ? r.bins.map((b) => (got = Math.max(got, b.coins || 0))) : null;
    const b = Object.entries(r.bosses || {})
      .filter(([, B]) => B.ttk !== null)
      .map(([id, B]) => [id, Math.round(B.at + B.ttk)])
      .sort((x, y) => x[1] - y[1]);
    out.push({
      d: r.deaths.length ? r.deaths[0].t : null,
      w: r.won && r.wonT ? r.wonT : null,
      k,
      l,
      c: r.coins,
      ...(cc ? { cc } : {}),
      b,
    });
  }
const file = path.join(ROOT, 'gen', 'econruns.json');
fs.writeFileSync(file, JSON.stringify({ from: name, rev: lab.rev, at: lab.at, runs: out }));
const died = out.filter((r) => r.d !== null).map((r) => r.d);
died.sort((a, b) => a - b);
console.log(
  `${out.length} runs (SIM.REV ${lab.rev}) → gen/econruns.json; first death: median ${died[died.length >> 1]} s, ` +
    `never died: ${out.length - died.length}; coins per whole run: median ${out.map((r) => r.c).sort((a, b) => a - b)[out.length >> 1]}`,
);
