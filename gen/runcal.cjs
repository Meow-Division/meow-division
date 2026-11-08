// node gen/runcal.cjs [weapon] [seed] [god] — one whole run played headless by the attract bot (it circles, dodging the thickest crowd;
// level-up cards: the first; god: the hero can't die). Prints what the run gives the meta: time, kills, level, bosses: S.bk, coins, win —
// the numbers the survivor rank's XP and the weapon mastery are tuned on.
const SIM = require('../live/sim.js'),
  D = require('../live/data.js');
const [weapon = 'pistol', seed = '7', god] = process.argv.slice(2);
const S = SIM.create({ weapon, seed: +seed });
if (god) S.p.god = true;
const t0 = Date.now();
while (!S.over && S.t < 700) {
  const inp = SIM.scriptInput(S.t, S);
  inp.fire = true;
  if (S.pause) inp.pick = 0;
  SIM.step(S, inp);
}
console.log(
  JSON.stringify({
    weapon,
    seed: +seed,
    god: !!god,
    t: Math.round(S.t),
    kills: S.kills,
    lvl: S.p.lvl,
    bosses: S.bk,
    coins: S.coins,
    win: !!(S.over && S.over.win),
    dead: S.p.dead,
    rankXp: D.runXp({ t: S.t, kills: S.kills, bosses: S.bk, win: !!(S.over && S.over.win), lvl: S.p.lvl }),
    secs: ((Date.now() - t0) / 1000).toFixed(0),
  }),
);
