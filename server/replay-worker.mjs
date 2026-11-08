// server/replay-worker.mjs — one replay at a time, off the server's main thread (server.mjs keeps a pool of these). A job: the run's
// ticket (the seed and loadout the server dealt, the rules' rev it was dealt under), its input log and step count; the answer: the
// run's outcome as the economy counts it (live/rules.js), the state's fingerprint (to compare with the page's), or why the log could
// not be played.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'), REPLAY = require('../live/replay.js'), RULES = require('../live/rules.js');
// the rules a run was dealt under: this build's, or an older build's the server kept (workerData.sims/<rev>), each loaded once into a
// context of its own (the files hang themselves on their global — DATA, MAP, SIM, REPLAY, RULES — and read each other from there, so
// one loaded beside this build's would take this build's data). No copy of that rev: this build's (as before the ticket kept it)
const NOW = { SIM, REPLAY, RULES }, kept = new Map();
function rulesOf(rev) {
  const w = workerData || {};
  if (rev === undefined || rev === SIM.REV || !w.sims || !Number.isInteger(rev)) return NOW;
  if (!kept.has(rev)) { const dir = path.join(w.sims, String(rev)); let set = null;
    try { const ctx = vm.createContext({ console });
      for (const f of w.files) { const p = path.join(dir, f); if (f !== 'sim.js' && !fs.existsSync(p)) continue;   // (a file newer than that rev: it never had it)
        vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p }); }
      if (ctx.SIM && ctx.SIM.REV === rev) set = { SIM: ctx.SIM, REPLAY: ctx.REPLAY, RULES: ctx.RULES }; } catch (e) { if (e.code !== 'ENOENT') console.error('rules', rev, e); }
    kept.set(rev, set); }
  return kept.get(rev) || NOW;
}
// (a run played together: logs, one per player, ns their steps; the outcome is the ticket's hero's)
parentPort.on('message', ({ id, ticket, log, logs, ns, n }) => {
  const t0 = Date.now();
  try { const K = rulesOf(ticket.rev), co = Array.isArray(logs), S = co ? K.REPLAY.playCoop(K.SIM, ticket, logs, ns, n) : K.REPLAY.play(K.SIM, ticket, log, n);
    parentPort.postMessage({ id, outcome: co ? K.RULES.outcome(S, ticket.hero) : K.RULES.outcome(S), hash: K.REPLAY.hash(S), steps: S.steps, rev: K.SIM.REV, ms: Date.now() - t0 }); }
  catch (e) { parentPort.postMessage({ id, error: String((e && e.message) || e), ms: Date.now() - t0 }); }
});
