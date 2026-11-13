// test/phantom.test.mjs — the Phantom, the rare rifle bosses drop (economy.js RARE, data.js MAIN.phantom): how often a boss
// leaves it (1 % any boss of a raid's map, 5 % its last one, none on a map without loot), what Walt pays and asks for it
// (5000 / 15000 whatever his shelf, never his own stock, never wearing off), a gun to play with while the stash holds it
// (rules.js fixRare, SIM.REV 48: never for coins, no longer owned once the stash loses it) and its
// way to the wallets (server/chain.mjs late: off the chain until the contract has it, then each stash's copy sent once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeChain } from '../server/chain.mjs';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  RULES = require('../live/rules.js'),
  E = require('../live/economy.js'),
  D = require('../live/data.js');

// bosses killed one after another on a map (seed 8: the suburbs; a mission 1 seed: the office, no loot table)
function drops(boss, n, seed = 8) {
  const S = SIM.create({ seed, rs: 7 });
  S.p.god = true;
  S.en.length = 0;
  for (let i = 0; i < n; i++) SIM.kill(S, SIM.addEnemy(S, boss, S.p.x + 300, S.p.y));
  return S.loot.filter((o) => o.it === 'phantom').length;
}

test('a boss leaves the Phantom 1 % of the time, a map’s last boss 5 %', () => {
  const r = E.RARE.find((x) => x.id === 'phantom');
  assert.deepEqual([r.boss, r.final], [0.01, 0.05]);
  assert.deepEqual(E.FINAL_BOSSES, ['golem', 'heart']);
  const a = drops('savage', 4000),
    b = drops('golem', 2000);
  assert.ok(a > 20 && a < 65, `about 40 of 4000 savages: ${a}`);
  assert.ok(b > 65 && b < 140, `about 100 of 2000 Mushroom Monsters: ${b}`);
});

test('Walt pays 5000 and asks 15000 for it, whatever his shelf; he has one only when a player sold it, and keeps it', () => {
  for (const st of [0, 1, 3, 50]) assert.equal(E.buyPrice('phantom', st), 5000);
  assert.equal(E.sellPrice('phantom', 0), 0, 'none of his own');
  assert.equal(E.sellPrice('phantom', 1), 15000);
  assert.equal(E.buyTotal('phantom', 2, 2), 30000);
  // his days: the other players' trades are materials, and it never wears off his shelf
  const stock = { phantom: 1 },
    rest = {};
  let u = 0.37;
  for (let d = 0; d < 60; d++) E.otherPlayersDay(stock, () => (u = (u * 9301 + 0.49297) % 1), rest);
  assert.equal(stock.phantom, 1);
  assert.equal(E.explain('phantom', 1).key, 'walt.why.rare');
  // never in Walt's gun shop or the coin price list
  assert.ok(!D.MAIN_ORDER.includes('phantom'));
  assert.ok(D.MAIN.phantom.rare);
});

test('its numbers: the SMG’s each 10 % better (rounded), a laser sight, the SMG’s levels', () => {
  const s = D.MAIN.smg,
    p = D.MAIN.phantom,
    near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 0.02;
  assert.ok(near(p.dmg, s.dmg * 1.1) && near(p.rate, s.rate * 1.1) && near(p.range, s.range * 1.1));
  assert.ok(near(p.speed, s.speed * 1.1) && near(p.spread, s.spread / 1.1) && near(p.rl, s.rl / 1.1));
  assert.equal(p.mag, s.mag * 1.1);
  assert.equal(p.like, 'smg');
  assert.ok(p.laser);
  assert.ok(D.GUN3D.phantom && D.HERO3D.mz.phantom, 'its mesh and its muzzle');
});

test('in the stash: a gun to pick, upgrade and take on a raid; never bought for coins; sold, no longer owned', () => {
  const s = RULES.clean({ owned: { pistol: true, smg: true }, selected: 'smg', items: { phantom: 1 }, coins: 99999 });
  assert.equal(RULES.act(s, { k: 'buy', id: 'phantom' }), 'unknown gun', 'never for coins');
  assert.ok(s.owned.phantom && RULES.hasGun(s, 'phantom'), 'owned as the stash holds it');
  assert.equal(RULES.act(s, { k: 'sel', id: 'phantom' }), null);
  assert.equal(s.selected, 'phantom');
  assert.equal(
    RULES.act(s, { k: 'up', id: 'phantom', s: 'dmg' }, { now: 0 }) !== 'not owned',
    true,
    'upgraded as any gun',
  );
  assert.equal(RULES.free(s, 'phantom'), 1, 'it may be sold or listed');
  // a second one sells at Walt's price and the first stays a gun
  s.items.phantom = 2;
  const ctx = { stock: {} };
  assert.equal(RULES.act(s, { k: 'sell', id: 'phantom', n: 1 }, ctx), null);
  assert.equal(s.coins >= 99999 + 5000 - 1000, true);
  assert.deepEqual(ctx.stock, { phantom: 1 });
  assert.deepEqual([s.owned.phantom, s.selected], [true, 'phantom']);
  // the last one sold: no longer a gun, the primary back to the best one owned
  assert.equal(RULES.act(s, { k: 'sell', id: 'phantom', n: 1 }, ctx), null);
  assert.deepEqual([!!s.owned.phantom, s.selected], [false, 'smg']);
  assert.equal(RULES.act(s, { k: 'up', id: 'phantom', s: 'dmg' }), 'not owned');
  // one bought back from Walt's shelf: a gun again at once
  s.coins = 99999;
  assert.equal(RULES.act(s, { k: 'wbuy', id: 'phantom', n: 1 }, ctx), null);
  assert.ok(s.owned.phantom && RULES.hasGun(s, 'phantom'));
});

test('the stash losing it (the wallet’s look, a lot on the market) or a save from the gear slot’s days', () => {
  const s = RULES.clean({
    owned: { pistol: true },
    items: { phantom: 1 },
    gear: { gun: 'phantom' },
    selected: 'phantom',
  });
  assert.deepEqual(
    [s.owned.phantom, s.selected, s.gear],
    [true, 'phantom', undefined],
    'the old slot dropped, the gun kept',
  );
  delete s.items.phantom;
  RULES.fixRare(s);
  assert.deepEqual([!!s.owned.phantom, s.selected], [false, 'pistol']);
  // a save edited by hand: owned with no stash
  const h = RULES.clean({ owned: { pistol: true, phantom: true }, selected: 'phantom' });
  assert.deepEqual([!!h.owned.phantom, h.selected], [false, 'pistol']);
  // a run's find banked: owned from then on
  const r = RULES.clean({ owned: { pistol: true } });
  r.items.phantom = 1;
  RULES.fixRare(r);
  assert.ok(r.owned.phantom);
});

test('the wallets: off the chain until the contract has it, then each stash’s copy is sent once', async () => {
  const sent = [],
    signer = {
      async call(contract, method, args) {
        sent.push({ method, args });
        return { hash: 'h' + sent.length, ok: true };
      },
    };
  let registered = false;
  const near = { view: async (c, m, a) => a.token_ids.map(() => (registered ? '0' : null)) };
  const c = makeChain({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'md-phantom-')),
    near,
    signer,
    contract: 'items.near',
    tokens: ['gears', 'phantom'],
    late: ['phantom'],
    on: true,
    lag: 0,
    mirrorMs: 10,
    log: { warn() {}, error() {} },
  });
  await c.checkLate();
  assert.equal(c.onChain('phantom'), false);
  const rec = { save: { items: { gears: 2, phantom: 1 } }, chain: 1 };
  c.sync('a.near', rec, { gears: 2 });
  assert.equal(rec.save.items.phantom, 1, 'the stash keeps it: the wallet can’t hold it yet');
  assert.equal(c.add('a.near', 'mint', [['phantom', 1]], 'run-1'), null, 'no mint of it');
  registered = true;
  await c.checkLate();
  assert.equal(c.onChain('phantom'), true);
  c.sync('a.near', rec, { gears: 2 });
  assert.deepEqual(rec.chainLate, ['phantom']);
  assert.equal(rec.save.items.phantom, 1, 'still there: on its way to the wallet');
  for (let t = Date.now(); !sent.length && Date.now() - t < 2000;) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(
    sent.map((x) => [x.method, x.args.token_ids, x.args.receiver_id]),
    [['game_mint', ['phantom'], 'a.near']],
  );
  // once: the next look with it on the wallet sends nothing more
  c.sync('a.near', rec, { gears: 2, phantom: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 1);
  assert.equal(rec.save.items.phantom, 1);
});
