// node gen/detcheck.cjs [secs] — the sim gives the same numbers in every browser and on the server (the server pays runs by playing
// them again: live/replay.js). The functions whose rounding the engines may differ on (Math.sin, cos, tan, atan2, exp, pow, hypot,
// log …) are made to throw before the sim loads, then a whole run is played by the attract bot (with level-up picks and cursor aim)
// while it is recorded (the hero can't die: the bosses and the end come too), and played again from the record: the run must never call them, and the replay must end in the same state.
for (const k of [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log10',
  'pow',
  'hypot',
  'cbrt',
  'random',
])
  Math[k] = () => {
    throw new Error('the sim called Math.' + k);
  };
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js');
const secs = +(process.argv[2] || 700),
  fails = [];
const ticket = {
  seed: +(process.env.SEED || 10),
  rs: -123456789,
  weapon: 'shotgun',
  meta: { hp: 2, dmg: 1, speed: 1, magnet: 1, reroll: 1, start: 1 },
  wup: { dmg: 2, rate: 1 },
};
const S = SIM.create(ticket);
S.p.god = true;
const rec = REPLAY.rec(),
  t0 = Date.now();
let hash = null;
try {
  for (let i = 0; i < secs * 120 && !S.over; i++) {
    const inp = SIM.scriptInput(S.t, S);
    inp.fire = true;
    inp.mx = 960 + 400 * (((i * 7919) % 1000) / 1000 - 0.5);
    inp.my = 540 + 200 * (((i * 104729) % 1000) / 1000 - 0.5);
    if (S.pause) inp.pick = i % 4 === 0 ? -2 : i % 3;
    const q = REPLAY.quant(inp);
    REPLAY.push(rec, q);
    SIM.step(S, q);
    if (S.over) hash = REPLAY.hash(S);
  }
} catch (e) {
  fails.push(e.message);
}
hash = hash || REPLAY.hash(S);
const o = RULES.outcome(S);
console.log(
  `played ${o.t.toFixed(1)} s (${S.steps} steps) in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${o.kills} kills, level ${o.lvl}, ${o.coins} coins, ${S.bk} bosses, ${o.win ? 'won' : S.over ? 'died' : 'still alive'}; log ${rec.log.length} numbers`,
);
const t1 = Date.now(),
  R = SIM.create(ticket);
R.p.god = true;
try {
  REPLAY.each(JSON.parse(JSON.stringify(rec.log)), rec.n, (inp) => {
    if (R.over) throw REPLAY.END;
    SIM.step(R, inp);
  });
} catch (e) {
  if (e !== REPLAY.END) fails.push(e.message);
}
const h2 = REPLAY.hash(R);
console.log(
  `replayed in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${h2 === hash ? 'the same state' : 'DIFFERENT: ' + hash + ' vs ' + h2}`,
);
if (h2 !== hash) fails.push('the replay ended in another state');
for (const f of fails) console.log('FAIL', f);
process.exit(fails.length ? 1 : 0);
