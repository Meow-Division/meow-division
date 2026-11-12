// test/marketplace.test.mjs — server/market.mjs, the players' market: a lot takes the items off the seller's stash, a
// purchase is filled from the cheapest lots of other players and holds them while it waits, 1Click's SUCCESS hands the
// items to the buyer and queues 97.5% of each seller's sum as a USDC payout, a refund or no payment by the deadline
// lets the lots go, a payment landing late is filled again or paid back, a cancel returns only the pieces no order
// holds, the minimum and the coins' own minimums hold, and everything survives a restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMarket, FEE_BP, USDC_ASSET } from '../server/market.mjs';

const ITEMS = ['gears', 'gpu', 't_butcher'];
const quiet = { warn() {}, error() {} };
const TREASURY = 'f'.repeat(64);
const TOKENS = [
  { assetId: USDC_ASSET, symbol: 'USDC', blockchain: 'near', decimals: 6, price: 1 },
  { assetId: 'nep141:sol.omft.near', symbol: 'SOL', blockchain: 'sol', decimals: 9, price: 80 },
  { assetId: 'nep141:btc.omft.near', symbol: 'BTC', blockchain: 'btc', decimals: 8, price: 90000 },
  { assetId: 'nep141:tron-usdt.omft.near', symbol: 'USDT', blockchain: 'tron', decimals: 6, price: 1 },
];
// a stand-in 1Click: quotes give a deposit address each; status answers what the test set for that address
function oneClickOf() {
  const st = new Map(),
    quotes = [];
  let n = 0,
    fail = null;
  return {
    quotes,
    st,
    failNext: (e) => (fail = e),
    async tokens() {
      return TOKENS;
    },
    async quote(b) {
      if (fail) {
        const e = fail;
        fail = null;
        throw e;
      }
      quotes.push(b);
      const addr = 'dep' + ++n;
      st.set(addr, {
        status: 'PENDING_DEPOSIT',
        quoteResponse: { quoteRequest: { recipient: b.recipient, amount: b.amount } },
      });
      return {
        signature: 'sig',
        quote: {
          depositAddress: addr,
          amountIn: '1',
          amountInFormatted: '1.01',
          minAmountIn: '1',
          amountInUsd: '1.01',
          deadline: b.deadline,
        },
      };
    },
    async status(addr) {
      const s = st.get(addr);
      if (!s) throw Object.assign(new Error('not found'), { code: 404 });
      return s;
    },
    async submit() {
      return {};
    },
    pay(addr, status = 'SUCCESS') {
      st.get(addr).status = status;
      st.get(addr).swapDetails = { amountInFormatted: '1.01', nearTxHashes: ['h1'] };
    },
  };
}
// stashes in memory: take/give as the server does them
function world(dir, { oc = oneClickOf(), payout = null, clock = { t: 1.8e12 } } = {}) {
  const stash = { alice: { gears: 20, gpu: 2 }, bob: { gears: 5 }, carol: {} },
    ops = [];
  const m = makeMarket({
    dataDir: dir,
    items: ITEMS,
    oneclick: oc,
    treasury: TREASURY,
    take: async (acc, id, n, op) => {
      const s = (stash[acc] ||= {});
      if ((s[id] || 0) < n) return 'not enough';
      s[id] -= n;
      ops.push(['take', acc, id, n, op]);
      return null;
    },
    give: async (acc, it, op) => {
      const s = (stash[acc] ||= {});
      for (const id in it) s[id] = (s[id] || 0) + it[id];
      ops.push(['give', acc, it, op]);
    },
    payout,
    now: () => clock.t,
    pollMs: 1e9,
    log: quiet,
  });
  return { m, oc, stash, ops, clock };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
const settle = () => new Promise((r) => setTimeout(r, 20));

test('a lot takes the items off the stash; more than the stash holds is refused', async () => {
  const { m, stash, ops } = world(tmp());
  const r = await m.list('alice', 'gears', 10, 30);
  assert.ok(r.lot);
  assert.equal(stash.alice.gears, 10);
  assert.equal(ops[0][4], 'mlist-' + r.lot.id);
  assert.equal((await m.list('alice', 'gpu', 5, 500)).error, 'not enough');
  assert.equal((await m.list('alice', 'nope', 1, 5)).error, 'no such item');
  assert.equal((await m.list('alice', 'gears', 1, 0)).error, 'bad price');
  assert.equal((await m.list('alice', 'gears', 0, 10)).error, 'bad amount');
  m.stop();
});

test('a purchase takes the cheapest pieces of other players, holds them, and pays out 97.5% on SUCCESS', async () => {
  const pays = [];
  const { m, oc, stash, ops } = world(tmp(), { payout: async (p) => (pays.push(p), { ok: true, tx: 'tx-' + p.id }) });
  await m.list('alice', 'gears', 4, 40); // $0.40
  await m.list('bob', 'gears', 3, 30); // $0.30, cheaper
  await m.list('carol', 'gears', 0, 30).catch(() => {}); // (nothing)
  // bob buying never takes his own lot
  const fb = m.fills('bob', 'gears', 5);
  assert.deepEqual(
    fb.fills.map((f) => f.s),
    ['alice'],
  );
  const r = await m.quote('carol', { id: 'gears', n: 5, asset: USDC_ASSET });
  assert.ok(r.order, JSON.stringify(r));
  assert.equal(r.order.cents, 3 * 30 + 2 * 40);
  const q = oc.quotes[0];
  assert.equal(q.swapType, 'EXACT_OUTPUT');
  assert.equal(q.amount, String(170 * 1e4));
  assert.equal(q.recipient, TREASURY);
  assert.equal(q.refundType, 'INTENTS'); // (no refund address: the buyer's own NEAR Intents account)
  assert.equal(q.refundTo, 'carol');
  // held: another buyer finds only what is left
  const left = m.fills('dave', 'gears', 10);
  assert.equal(left.short, 10 - 2);
  // paid
  oc.pay(r.order.dep.addr);
  await m.sweep();
  await m.payAll();
  await settle();
  assert.equal(m.order('carol', r.order.id).st, 'done');
  assert.equal(stash.carol.gears, 5);
  assert.ok(ops.some((o) => o[0] === 'give' && o[1] === 'carol' && o[3] === 'mbuy-' + r.order.id));
  const by = Object.fromEntries(pays.map((p) => [p.acc, p.micro]));
  assert.equal(by.bob, Math.floor((90 * 1e4 * (10000 - FEE_BP)) / 10000));
  assert.equal(by.alice, Math.floor((80 * 1e4 * (10000 - FEE_BP)) / 10000));
  assert.equal(m.state().fees, 170 * 1e4 - by.bob - by.alice);
  const v = m.view();
  const g = v.items.find((x) => x.it === 'gears');
  assert.equal(g.listed, 2); // (alice's 2 left at $0.40)
  assert.equal(g.floor, 40);
  assert.deepEqual(g.asks, [{ p: 40, n: 2, s: 'alice' }]);
  assert.equal(g.tr.length, 2);
  assert.equal(g.sold7, 5);
  assert.equal(g.sold24, 5);
  assert.equal(v.trades.length, 2);
  assert.deepEqual(
    m.mine('bob').pays.map((p) => p.st),
    ['done'],
  );
  m.stop();
});

test("the minimum: a purchase under $1, and under a coin chain's own minimum, is refused and holds nothing", async () => {
  const { m, oc } = world(tmp());
  await m.list('alice', 'gears', 20, 9);
  assert.deepEqual(await m.quote('bob', { id: 'gears', n: 10, asset: USDC_ASSET }), {
    error: 'below minimum',
    min: 100,
  });
  assert.equal((await m.quote('bob', { id: 'gears', n: 12, asset: 'nep141:tron-usdt.omft.near' })).min, 10000);
  // 1Click's own bridge minimum (BTC): its micro-USDC figure turned into cents
  oc.failNext(Object.assign(new Error('Amount is too low for bridge, try at least 4600947'), { code: 400 }));
  assert.deepEqual(await m.quote('bob', { id: 'gears', n: 12, asset: 'nep141:btc.omft.near' }), {
    error: 'below minimum',
    min: 461,
  });
  assert.equal(m.fills('bob', 'gears', 20).short, 0); // (nothing left held)
  assert.equal((await m.quote('bob', { id: 'gears', n: 30, asset: USDC_ASSET })).error, 'not enough on sale');
  m.stop();
});

test('a refund or no payment by the deadline lets the lots go; a payment landing late is filled again or paid back', async () => {
  const pays = [];
  const { m, oc, stash, clock } = world(tmp(), { payout: async (p) => (pays.push(p), { ok: true }) });
  await m.list('alice', 'gears', 10, 20);
  const a = (await m.quote('bob', { id: 'gears', n: 5, asset: USDC_ASSET })).order;
  oc.pay(a.dep.addr, 'REFUNDED');
  await m.sweep();
  assert.equal(m.order('bob', a.id).st, 'refunded');
  assert.equal(m.fills('carol', 'gears', 10).short, 0);
  // no payment: let go after the deadline and its grace
  const b = (await m.quote('bob', { id: 'gears', n: 5, asset: USDC_ASSET })).order;
  clock.t += 14 * 60e3;
  await m.sweep();
  assert.equal(m.order('bob', b.id).st, 'gone');
  assert.equal(m.fills('carol', 'gears', 10).short, 0);
  // …then paid after all, the pieces still free: filled
  oc.pay(b.dep.addr);
  clock.t += 61e3;
  await m.sweep();
  await settle();
  assert.equal(m.order('bob', b.id).st, 'done');
  assert.equal(stash.bob.gears, 5 + 5);
  // a late payment whose pieces were sold meanwhile: the money back in USDC
  const c = (await m.quote('bob', { id: 'gears', n: 5, asset: USDC_ASSET })).order;
  clock.t += 14 * 60e3;
  await m.sweep();
  const d = (await m.quote('carol', { id: 'gears', n: 5, asset: USDC_ASSET })).order;
  oc.pay(d.dep.addr);
  await m.sweep();
  oc.pay(c.dep.addr);
  clock.t += 61e3;
  await m.sweep();
  await m.payAll();
  await settle();
  assert.equal(m.order('bob', c.id).st, 'back');
  assert.ok(pays.some((p) => p.acc === 'bob' && p.why === 'refund' && p.micro === 100 * 1e4));
  m.stop();
});

test('a cancel returns the pieces no order holds; two waiting orders at most', async () => {
  const { m, stash } = world(tmp());
  const lot = (await m.list('alice', 'gears', 10, 25)).lot;
  await m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET });
  await m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET });
  assert.equal((await m.quote('bob', { id: 'gears', n: 2, asset: USDC_ASSET })).error, 'too many open orders');
  assert.deepEqual(await m.cancel('bob', lot.id), { error: 'no such lot' });
  assert.deepEqual(await m.cancel('alice', lot.id), { back: 2 });
  assert.equal(stash.alice.gears, 10 + 2);
  assert.equal(m.mine('alice').lots[0].n, 8); // (held by bob's two orders)
  assert.deepEqual(await m.cancel('alice', lot.id), { error: 'held by a purchase' });
  // the buyer gives one order up: its pieces free again
  const o = m.mine('bob').orders[0];
  assert.equal(m.drop('bob', o.id).order.st, 'dropped');
  assert.deepEqual(await m.cancel('alice', lot.id), { back: 4 });
  m.stop();
});

test('lots, orders and payouts survive a restart; a payout in flight is never sent twice', async () => {
  const dir = tmp();
  let w = world(dir, { payout: () => new Promise(() => {}) }); // (a payout that never answers: in flight at the "restart")
  await m0(w);
  async function m0({ m, oc }) {
    await m.list('alice', 'gears', 10, 30);
    const o = (await m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET })).order;
    oc.pay(o.dep.addr);
    await m.sweep();
    m.payAll();
    await settle();
    m.stop();
  }
  await settle();
  const sent = [];
  w = world(dir, { payout: async (p) => (sent.push(p), { ok: true }) });
  await w.m.payAll();
  assert.equal(sent.length, 0);
  assert.deepEqual(
    w.m.mine('alice').pays.map((p) => p.st),
    ['q'],
  ); // (stuck: shown as on its way, checked by hand)
  assert.equal(w.m.mine('alice').lots[0].n, 6);
  w.m.stop();
});

test("a lot's own link: the buyer takes that lot at its price, not the cheapest; one's own or a gone lot is refused", async () => {
  const { m } = world(tmp());
  const cheap = (await m.list('bob', 'gears', 3, 30)).lot,
    dear = (await m.list('alice', 'gears', 6, 50)).lot;
  // the shelf: every lot on sale, cheapest first, with its free pieces
  assert.deepEqual(
    m.view().lots.map((l) => [l.id, l.s, l.it, l.n, l.p]),
    [
      [cheap.id, 'bob', 'gears', 3, 30],
      [dear.id, 'alice', 'gears', 6, 50],
    ],
  );
  const r = await m.quote('carol', { id: 'gears', n: 2, asset: USDC_ASSET, lot: dear.id });
  assert.ok(r.order, JSON.stringify(r));
  assert.equal(r.order.cents, 2 * 50);
  assert.deepEqual(
    m.state().orders[0].fills.map((f) => [f.lot, f.n]),
    [[dear.id, 2]],
  );
  assert.equal(m.view().lots.find((l) => l.id === dear.id).n, 4); // (2 held for carol)
  assert.equal(m.view().lots.find((l) => l.id === cheap.id).n, 3);
  assert.equal((await m.quote('alice', { id: 'gears', n: 2, asset: USDC_ASSET, lot: dear.id })).error, 'your own lot');
  assert.equal((await m.quote('carol', { id: 'gears', n: 2, asset: USDC_ASSET, lot: 'L999' })).error, 'no such lot');
  assert.equal(
    (await m.quote('dave', { id: 'gears', n: 5, asset: USDC_ASSET, lot: dear.id })).error,
    'not enough on sale',
  );
  await m.cancel('bob', cheap.id);
  assert.equal((await m.quote('carol', { id: 'gears', n: 4, asset: USDC_ASSET, lot: cheap.id })).error, 'no such lot');
  m.stop();
});
