// gen/balance.cjs — the balance lab: the bot (gen/balbot.cjs) plays many whole runs headless, in parallel, and the results go to
// balance/<name>.json for the report (gen/balreport.cjs). Two experiments:
//   progress — new accounts played from scratch: run after run, each paid as the server pays it (rules.js bank, at the first death),
//              the coins spent as a player would (policy: 'collector' buys every gun as soon as its rank allows and plays the newest,
//              'upgrader' keeps the pistol and buys upgrades). Shows how hard each run is as the account grows.
//   guns     — every gun at the same account (a mid one and a maxed one), many runs each.
//   stages   — (quick A/B after a change) fixed accounts from balance/stages.json, many runs each: node gen/balance.cjs <name> stages [runs=15]
// node gen/balance.cjs [name=lab] [accounts=14] [runs=40] [gunRuns=10] [skill=avg]
const LIVE = process.env.ZH_LIVE || require('node:path').join(__dirname, '..', 'live');   // (ZH_LIVE: another copy of the rules, for an A/B)
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');

if (isMainThread) {
  const [name = 'lab', accounts = '14', runs = '40', gunRuns = '10', skill = 'avg'] = process.argv.slice(2);
  const D = require(LIVE + '/data.js'), SIM = require(LIVE + '/sim.js');
  const jobs = [], STAGES = accounts === 'stages' ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'balance', 'stages.json'), 'utf8')) : null;
  if (STAGES) for (const st of STAGES) for (let r = 0; r < (+runs || 15); r++) jobs.push({ k: 'stage', st, skill, seed: 9000 + r * 17 });
  else for (let a = 0; a < +accounts; a++) jobs.push({ k: 'progress', id: a, runs: +runs, policy: a % 3 === 2 ? 'upgrader' : 'collector', skill, seed: 1000 + a });
  const GUNS = D.MAIN_ORDER.filter((id) => !D.MAIN[id].locked);
  if (!STAGES) for (const tier of ['mid', 'max']) for (const gun of GUNS) for (let r = 0; r < +gunRuns; r++) jobs.push({ k: 'gun', gun, tier, skill, seed: 5000 + r * 31 + GUNS.indexOf(gun) });
  const out = { name, rev: SIM.REV, at: new Date().toISOString(), skill, accounts: [], guns: [], stages: [] };
  const N = Math.max(1, Math.min(os.cpus().length - 1, jobs.length)), t0 = Date.now(); let next = 0, done = 0;
  // the long jobs (whole accounts) first, so the short ones fill in round them
  const runJob = (w) => { if (next >= jobs.length) { w.terminate(); return; } w.postMessage(jobs[next++]); };
  for (let i = 0; i < N; i++) {
    const w = new Worker(__filename, { workerData: {} });
    w.on('message', (m) => {
      if (m.k === 'progress') out.accounts.push(m); else if (m.k === 'stage') out.stages.push(m); else out.guns.push(m);
      done++; if (m.k === 'progress' || done % 20 === 0) console.log(`${done}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)} s${m.k === 'progress' ? ' account ' + m.id + ' (' + m.policy + ') done' : ''}`);
      if (done === jobs.length) { const dir = path.join(__dirname, '..', 'balance'); fs.mkdirSync(dir, { recursive: true });
        out.accounts.sort((a, b) => a.id - b.id); fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(out)); console.log('wrote balance/' + name + '.json'); }
      runJob(w);
    });
    w.on('error', (e) => { console.error(e); process.exitCode = 1; });
    runJob(w);
  }
} else {
  const D = require(LIVE + '/data.js'), R = require(LIVE + '/rules.js'), { playRun } = require('./balrun.cjs'), { rngOf, randomTaste } = require('./balbot.cjs');
  const lean = (r) => { delete r.outcome; return r; };
  // coins spent as a player would: first a new gun the rank opens (the collector), then the cheapest upgrade of the gun played or of the
  // account (health, damage, speed, magnet first; rerolls and the starting weapon once those are half way)
  function spend(save, policy) {
    for (let guard = 0; guard < 200; guard++) {
      if (policy === 'collector') { const g = D.MAIN_ORDER.find((id) => !D.MAIN[id].locked && !save.owned[id] && R.rank(save) >= D.MAIN[id].rank);
        if (g) { if (save.coins >= D.MAIN[g].price) { R.act(save, { k: 'buy', id: g }); continue; } if (save.coins < D.MAIN[g].price) break; } }
      const opts = [], gun = save.selected, u = R.wupOf(save, gun), mast = R.mastery(save, gun);
      for (const s in D.WEAPON_UP) { const lv = u[s] || 0, P = D.WEAPON_UP[s].price[lv]; if (P !== undefined && lv < mast) opts.push({ a: { k: 'up', id: gun, s }, P }); }
      const half = ['hp', 'dmg', 'speed', 'magnet'].every((k) => save.meta[k] >= 2);
      for (const k in D.META) { if ((k === 'reroll' || k === 'start') && !half) continue; const lv = save.meta[k] || 0, P = D.META[k].price[lv]; if (lv < D.META[k].max && P !== undefined) opts.push({ a: { k: 'meta', s: k }, P }); }
      opts.sort((a, b) => a.P - b.P);
      if (!opts.length || opts[0].P > save.coins) break;
      R.act(save, opts[0].a);
    }
  }
  const TIERS = { mid: { meta: { hp: 2, dmg: 2, speed: 2, magnet: 2, reroll: 1, start: 0 }, wup: { dmg: 2, rate: 2, mag: 2 }, rank: 10 },
    max: { meta: { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 3 }, wup: { dmg: 5, rate: 5, mag: 5 }, rank: 20 } };
  parentPort.on('message', (job) => {
    if (job.k === 'stage') {
      const st = job.st, rng = rngOf(job.seed);
      const r = playRun({ weapon: st.gun, meta: st.meta, wup: st.wup, rank: st.rank, seed: 7 + (job.seed % 5), rs: job.seed * 7919, skill: job.skill, taste: randomTaste(rng), botSeed: job.seed, revive: true });
      parentPort.postMessage({ k: 'stage', stage: st.id, ...lean(r) });
      return;
    }
    if (job.k === 'gun') {
      const T = TIERS[job.tier], rng = rngOf(job.seed);
      const r = playRun({ weapon: job.gun, meta: T.meta, wup: T.wup, rank: T.rank, seed: 7 + (job.seed % 5), rs: job.seed * 7919, skill: job.skill, taste: randomTaste(rng), botSeed: job.seed, revive: true });
      parentPort.postMessage({ k: 'gun', gun: job.gun, tier: job.tier, ...lean(r) });
      return;
    }
    const save = R.defaults(), rng = rngOf(job.seed), list = [];
    for (let i = 0; i < job.runs; i++) {
      const gun = save.selected, before = { rank: R.rank(save), gun, meta: { ...save.meta }, wup: { ...R.wupOf(save, gun) }, mastery: R.mastery(save, gun), coins: save.coins };
      const rs = Math.floor(rng() * 2 ** 31);
      const r = playRun({ weapon: gun, meta: save.meta, wup: R.wupOf(save, gun), rank: before.rank, seed: 7 + (i % 5), rs, skill: job.skill, taste: randomTaste(rng), botSeed: rs, revive: true });
      const gain = R.bank(save, r.outcome);
      spend(save, job.policy);
      list.push({ i, before, gain: { coins: gain.coins, xp: gain.xp }, ...lean(r) });
    }
    parentPort.postMessage({ k: 'progress', id: job.id, policy: job.policy, runs: list, final: { rank: R.rank(save), owned: Object.keys(save.owned), meta: save.meta, wup: save.wup, coins: save.coins } });
  });
}
