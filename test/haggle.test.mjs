// Haggling with Walt (live/economy.js haggle, live/rules.js act 'haggle'): his answer comes from his shelf and the
// day's sales, it is asked for once, it never lets a round trip earn, and the task of the day ignores it. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js');
const R = require('../live/rules.js');

const it = E.ITEMS.find((i) => i.kind === 'material' && !i.band && !i.ask && i.norm >= 6 && i.base >= 20);
const id = it.id;
const save = (n = 5) => ({ ...R.defaults(), items: { [id]: n } });
const NOW = 1e12,
  HALF = Math.ceil(it.norm / 2);

test('his answer follows his shelf: agrees when short, counters when stocked, refuses when full', () => {
  const short = E.haggle(id, 0, 0),
    mid = E.haggle(id, HALF, 0),
    full = E.haggle(id, it.norm, 0);
  assert.equal(short.pct, E.HAGGLE.ask);
  assert.equal(short.key, 'walt.hag.yes');
  assert.equal(mid.pct, E.HAGGLE.counter);
  assert.equal(mid.key, 'walt.hag.mid');
  assert.equal(full.pct, 0);
  assert.equal(full.key, 'walt.hag.no');
  assert.ok(short.vars.price > short.vars.std && mid.vars.price > mid.vars.std && mid.vars.price < mid.vars.ask);
  assert.equal(full.vars.price, full.vars.std);
});

test('many sold to him today move the answer one step down', () => {
  assert.equal(E.haggle(id, 0, it.norm).key, 'walt.hag.midBusy');
  assert.equal(E.haggle(id, 0, it.norm).pct, E.HAGGLE.counter);
  assert.equal(E.haggle(id, HALF, it.norm).key, 'walt.hag.noBusy');
  assert.equal(E.haggle(id, HALF, it.norm).pct, 0);
});

test('no haggling over one-price items or what he does not trade', () => {
  for (const i of E.ITEMS) if (i.ask || i.band || !(i.base > 0)) assert.equal(E.haggle(i.id, 0, 0), null, i.id);
  assert.equal(R.act(save(), { k: 'haggle', id: 'nothing' }, { stock: {}, now: NOW }), 'not traded');
});

test('a sale after his yes pays the agreed price, for as long as it holds', () => {
  const s = save(),
    stock = {};
  assert.equal(R.act(s, { k: 'haggle', id }, { stock, now: NOW }), null);
  assert.equal(R.haggled(s, id, NOW), E.HAGGLE.ask);
  const std = E.sellTotal(id, 2, 0),
    c0 = s.coins;
  assert.equal(R.act(s, { k: 'sell', id, n: 2 }, { stock, now: NOW + 1000 }), null);
  assert.equal(s.coins - c0, E.haggleTotal(id, 2, 0, E.HAGGLE.ask));
  assert.ok(s.coins - c0 > std);
  // (the answer run out: his price again, and a new ask is heard since his shelf has changed)
  const late = NOW + 1000 * E.HAGGLE.hold + 2000,
    c1 = s.coins;
  assert.equal(R.act(s, { k: 'sell', id, n: 1 }, { stock, now: late }), null);
  assert.equal(s.coins - c1, E.buyPrice(id, 2));
  assert.equal(R.canHaggle(s, id, stock[id], late), true);
});

test('he is asked once: no second ask while the answer holds or his shelf is the same', () => {
  const s = save(),
    stock = { [id]: it.norm * 3 };
  assert.equal(R.act(s, { k: 'haggle', id }, { stock, now: NOW }), null); // (refused)
  assert.equal(R.haggled(s, id, NOW), 0);
  assert.equal(R.act(s, { k: 'haggle', id }, { stock, now: NOW + 9e6 }), 'done');
  stock[id]--;
  assert.equal(R.act(s, { k: 'haggle', id }, { stock, now: NOW + 9e6 }), null);
  const t = save(),
    few = {};
  assert.equal(R.act(t, { k: 'haggle', id }, { stock: few, now: NOW }), null); // (agreed)
  few[id] = 1;
  assert.equal(R.act(t, { k: 'haggle', id }, { stock: few, now: NOW + 5000 }), 'done');
  assert.equal(R.act(save(0), { k: 'haggle', id }, { stock: {}, now: NOW }), 'not enough');
});

test('bought from him and sold back at the agreed price never earns, whatever the item and his stock', () => {
  for (const i of E.ITEMS) {
    if (!E.haggle(i.id, 0, 0)) continue;
    for (let st = 1; st <= i.norm * 3 + 2; st++)
      for (const pct of [E.HAGGLE.counter, E.HAGGLE.ask])
        for (const n of [1, 2, Math.min(st, 5)]) {
          if (n > st) continue;
          assert.ok(
            E.haggleTotal(i.id, n, st - n, pct) < E.buyTotal(i.id, n, st),
            `${i.id} stock ${st} n ${n} +${pct}%`,
          );
          assert.ok(E.haggleTotal(i.id, n, st - n, pct) >= E.sellTotal(i.id, n, st - n));
        }
  }
});

test('the task of the day pays its own price, his answer aside; a stored save keeps no more than he ever adds', () => {
  const day = R.day(NOW),
    task = R.waltDaily(day);
  if (task && E.haggle(task[0], 0, 0)) {
    const a = { ...R.defaults(), items: { [task[0]]: task[1] + 1 } },
      b = { ...R.defaults(), items: { [task[0]]: task[1] + 1 } };
    assert.equal(R.act(a, { k: 'haggle', id: task[0] }, { stock: {}, now: NOW }), null);
    assert.equal(R.act(a, { k: 'daily' }, { stock: {}, now: NOW + 1 }), null);
    assert.equal(R.act(b, { k: 'daily' }, { stock: {}, now: NOW + 1 }), null);
    assert.equal(a.coins, b.coins);
  }
  const c = R.clean({ hag: { [id]: { s: 3, p: 900, t: NOW }, bogus: { s: 1, p: 20, t: 1 } } });
  assert.deepEqual(c.hag, { [id]: { s: 3, p: E.HAGGLE.ask, t: NOW } });
});
