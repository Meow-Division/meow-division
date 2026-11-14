// test/plain.test.mjs — the stash's two piles (live/rules.js; the human's, 2026-11-14): what a raid carries out is a
// token (save.items, minted to the wallet, the players' market lists it), what Walt sells is plain (save.plain, never
// minted, never listed). Spends and sales take the plain pile first, and R.burnPart — read before the spend — is all
// the server burns off the wallet (server/server.mjs /api/act).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js');
const R = require('../live/rules.js');

const NOW = 1e12;
const mat = E.ITEMS.find((i) => i.kind === 'material' && !i.band && !i.ask && E.tradable(i.id)),
  id = mat.id;

test('a purchase from Walt lands in the plain pile; a sale takes the plain first and burns only the rest', () => {
  const s = { ...R.defaults(), coins: 1e6, items: { [id]: 2 } },
    stock = { [id]: 10 };
  assert.equal(R.act(s, { k: 'wbuy', id, n: 3 }, { stock, now: NOW }), null);
  assert.equal(s.plain[id], 3);
  assert.equal(s.items[id], 2);
  assert.equal(R.free(s, id), 5);
  assert.equal(R.tokens(s, id), 2);
  assert.equal(R.burnPart(s, id, 2), 0); // (covered by the plain pile)
  assert.equal(R.burnPart(s, id, 4), 1); // (digs one token out)
  assert.equal(R.act(s, { k: 'sell', id, n: 4 }, { stock, now: NOW }), null);
  assert.equal(s.plain[id], undefined);
  assert.equal(s.items[id], 1);
  assert.equal(R.act(s, { k: 'sell', id, n: 2 }, { stock, now: NOW }), 'not enough');
});

test('an upgrade spends the plain pile first; what R.burnPart said beforehand is what leaves the tokens', () => {
  const D = require('../live/data.js');
  const sKey = Object.keys(E.UPGRADES.meta).find(
    (k) => (E.UPGRADES.meta[k][1] || []).length && D.META[k].max > 1 && D.META[k].price[1] !== undefined,
  );
  assert.ok(sKey, 'an account upgrade whose level 2 takes items');
  const cost = E.UPGRADES.meta[sKey][1],
    [cid, cn] = cost[0];
  const s = { ...R.defaults(), coins: 1e9, meta: { ...R.defaults().meta, [sKey]: 1 } };
  s.base = { lv: { medbay: 1 }, bt: {}, clr: {}, gift: [] };
  s.plain = { [cid]: 1 };
  for (const [i, n] of cost) s.items[i] = n; // (the wallet could cover it all)
  const burn = cost.map(([i, n]) => [i, R.burnPart(s, i, n)]);
  assert.equal(burn[0][1], cn - 1); // (one piece of the first item comes out of the plain pile)
  assert.equal(R.act(s, { k: 'meta', s: sKey }, { now: NOW }), null);
  assert.equal(s.meta[sKey], 2);
  assert.equal(s.plain[cid], undefined);
  for (const [i, n] of burn) assert.equal(s.items[i] || 0, cost.find(([c]) => c === i)[1] - n);
});

test('a rare gun in the plain pile is owned and played, but has no tokens to list', () => {
  const rid = (R.RARE || []).find((x) => R.usable(x));
  if (!rid) return; // (no rare gun in the tables: nothing to check)
  const s = { ...R.defaults(), plain: { [rid]: 1 } };
  R.fixRare(s);
  assert.equal(s.owned[rid], true);
  assert.equal(R.free(s, rid), 1);
  assert.equal(R.tokens(s, rid), 0);
});

test('clean keeps the plain pile: known items, whole counts', () => {
  const d = R.clean({ plain: { [id]: 3, nope: 5, [mat.id === 'gears' ? 'tape' : 'gears']: -1 } });
  assert.equal(d.plain[id], 3);
  assert.equal(Object.keys(d.plain).length, 1);
});
