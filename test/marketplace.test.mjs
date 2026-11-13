// test/marketplace.test.mjs — server/market.mjs, the players' market: a lot takes the items off the seller's stash, a
// purchase is filled from the cheapest lots of other players and holds them while it waits, 1Click's SUCCESS hands the
// items to the buyer and queues 97.5% of each seller's sum as a USDC payout, a refund or no payment by the deadline
// lets the lots go, a payment landing late is filled again or paid back, a cancel returns only the pieces no order
// holds, the minimum and the coins' own minimums hold, and everything survives a restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEE_BP, NET_MICRO, USDC_ASSET } from '../server/market.mjs';
import { TREASURY, world, tmp, settle, until } from './marketworld.mjs';

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
  assert.equal(by.bob, Math.floor((90 * 1e4 * (10000 - FEE_BP)) / 10000) - NET_MICRO);
  assert.equal(by.alice, Math.floor((80 * 1e4 * (10000 - FEE_BP)) / 10000) - NET_MICRO);
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

test("the minimum: none of the market's own; a purchase under a coin chain's own minimum is refused and holds nothing", async () => {
  const { m, oc } = world(tmp());
  await m.list('alice', 'gears', 20, 9);
  assert.equal(m.view().min, 1);
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
  clock.t += 61 * 60e3; // (past its deadline with no deposit reported: looked at once an hour)
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
  clock.t += 61 * 60e3;
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
  // (a payout sent that never answers: in flight at the "restart", its hash written down before it left)
  let w = world(dir, { payout: async (p, sent) => (await sent('hash1'), new Promise(() => {})) });
  await m0(w);
  async function m0({ m, oc }) {
    await m.list('alice', 'gears', 10, 30);
    const o = (await m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET })).order;
    oc.pay(o.dep.addr);
    await m.sweep();
    m.payAll();
    await until(() => m.state().pays[0].st === 's' && m.state().pays[0].sent.length);
    await m.flushed();
    m.stop();
  }
  const sent = [];
  w = world(dir, { payout: async (p) => (sent.push(p), { ok: true }) });
  await w.m.payAll();
  assert.equal(sent.length, 0);
  assert.deepEqual(
    w.m.mine('alice').pays.map((p) => p.st),
    ['q'],
  ); // (stuck: shown as on its way; followed by its hash, marketsafety.test.mjs)
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

test("delivery to the treasury's account first; when 1Click quotes none out to NEAR, its NEAR Intents balance; a lot wholly held shows n 0", async () => {
  const { m, oc } = world(tmp());
  const lot = (await m.list('alice', 'gears', 4, 30)).lot;
  const a = await m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET, lot: lot.id });
  assert.ok(a.order);
  assert.equal(oc.quotes[0].recipientType, 'DESTINATION_CHAIN');
  assert.deepEqual(
    m.view().lots.map((l) => [l.id, l.n, l.held]),
    [[lot.id, 0, 4]],
  ); // (being paid: its link says so, the shelf leaves it out)
  m.drop('bob', a.order.id);
  oc.failNext(Object.assign(new Error('Quoting for this pair is not available'), { code: 400 }));
  const b = await m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET });
  assert.ok(b.order, JSON.stringify(b));
  assert.equal(oc.quotes.at(-1).recipientType, 'INTENTS');
  assert.equal(oc.quotes.at(-1).recipient, TREASURY);
  assert.equal(m.state().orders.at(-1).into, 'intents');
  m.stop();
});

test('the order book of all items: its cheapest pieces of any item up to a price, bought in one purchase', async () => {
  const pays = [];
  const { m, oc, stash } = world(tmp(), { payout: async (p) => (pays.push(p), { ok: true }) });
  await m.list('alice', 'gears', 4, 20);
  await m.list('alice', 'gpu', 1, 20);
  await m.list('bob', 'gears', 3, 25);
  await m.list('alice', 'gpu', 1, 90); // (above the price asked: left)
  const r = await m.quote('carol', { id: 'all', n: 6, max: 25, asset: USDC_ASSET });
  assert.ok(r.order, JSON.stringify(r));
  assert.equal(r.order.cents, 4 * 20 + 20 + 25);
  assert.deepEqual(r.order.items, { gears: 5, gpu: 1 });
  assert.equal((await m.quote('dave', { id: 'all', n: 3, max: 25, asset: USDC_ASSET })).error, 'not enough on sale');
  oc.pay(r.order.dep.addr);
  await m.sweep();
  await m.payAll();
  await settle();
  assert.equal(m.order('carol', r.order.id).st, 'done');
  assert.equal(stash.carol.gears, 5);
  assert.equal(stash.carol.gpu, 1);
  assert.deepEqual(
    m
      .view()
      .trades.map((x) => [x.it, x.n, x.p, x.s])
      .sort(),
    [
      ['gears', 1, 25, 'bob'],
      ['gears', 4, 20, 'alice'],
      ['gpu', 1, 20, 'alice'],
    ],
  );
  assert.deepEqual(pays.map((p) => p.acc).sort(), ['alice', 'bob']);
  assert.equal((await m.quote('carol', { id: 'nope', n: 1, asset: USDC_ASSET })).error, 'no such item');
  m.stop();
});

test('a bid: paid first, its money waits; sold into, the dearest first, the items to the bidder and the seller paid; taken down, the rest back', async () => {
  const pays = [];
  const { m, oc, stash, ops } = world(tmp(), { payout: async (p) => (pays.push(p), { ok: true }) });
  // carol bids $5 for one gpu, $0.30 a piece for 4 of any item
  const a = await m.quote('carol', { id: 'gpu', n: 1, bid: 500, asset: USDC_ASSET });
  assert.ok(a.order, JSON.stringify(a));
  assert.equal(a.order.kind, 'bid');
  assert.equal(a.order.cents, 500);
  assert.equal(oc.quotes[0].amount, String(500 * 1e4));
  const b = (await m.quote('carol', { id: 'all', n: 4, bid: 30, asset: USDC_ASSET })).order;
  assert.equal((await m.quote('carol', { id: 'all', n: 2, bid: 30, asset: USDC_ASSET })).error, 'too many open orders');
  assert.equal(m.view().bids.length, 0); // (not paid yet: not in the books)
  oc.pay(a.order.dep.addr);
  oc.pay(b.dep.addr);
  await m.sweep();
  assert.equal(m.order('carol', a.order.id).st, 'done');
  assert.deepEqual(
    m.view().bids.map((x) => [x.it, x.n, x.p, x.b]),
    [
      ['gpu', 1, 500, 'carol'],
      ['all', 4, 30, 'carol'],
    ],
  );
  assert.equal(m.mine('carol').bids.length, 2);
  // one's own bids can't be sold into; a bid for gpu takes no gears
  const [gb, ab] = m.view().bids;
  assert.equal((await m.sell('carol', { fills: [{ bid: gb.id, it: 'gpu', n: 1 }] })).error, 'bids changed');
  assert.equal((await m.sell('alice', { fills: [{ bid: gb.id, it: 'gears', n: 1 }] })).error, 'bids changed');
  assert.equal((await m.sell('alice', { fills: [{ bid: ab.id, it: 'gears', n: 5 }] })).error, 'bids changed');
  // alice sells a gpu into the $5 bid and 2 gears into the any-item bid
  const r = await m.sell('alice', {
    fills: [
      { bid: gb.id, it: 'gpu', n: 1 },
      { bid: ab.id, it: 'gears', n: 2 },
    ],
  });
  assert.ok(r.sold, JSON.stringify(r));
  assert.equal(r.sold.cents, 500 + 60);
  await m.payAll();
  await settle();
  assert.equal(stash.alice.gpu, 1);
  assert.equal(stash.alice.gears, 18);
  assert.equal(stash.carol.gpu, 1);
  assert.equal(stash.carol.gears, 2);
  assert.ok(ops.some((o) => o[0] === 'give' && o[1] === 'carol' && /^mbid-/.test(o[3])));
  const sale = pays.find((p) => p.acc === 'alice');
  assert.equal(sale.micro, Math.floor((560 * 1e4 * (10000 - FEE_BP)) / 10000) - NET_MICRO);
  assert.deepEqual(
    m.view().bids.map((x) => [x.it, x.n]),
    [['all', 2]],
  );
  assert.equal(m.mine('carol').bids.find((x) => x.it === 'gpu').st, 'done');
  // more than is left: refused, nothing taken
  assert.equal((await m.sell('bob', { fills: [{ bid: ab.id, it: 'gears', n: 3 }] })).error, 'bids changed');
  assert.equal(stash.bob.gears, 5);
  // a seller short of the items: nothing sold, the bid as it was
  assert.equal((await m.sell('bob', { fills: [{ bid: ab.id, it: 't_butcher', n: 1 }] })).error, 'not enough');
  assert.equal(m.view().bids[0].n, 2);
  // carol takes the rest down: 2 × $0.30 back in USDC, less the chain's cost of sending it
  assert.deepEqual(m.unbid('bob', ab.id), { error: 'no such bid' });
  assert.deepEqual(m.unbid('carol', ab.id), { back: 60 - NET_MICRO / 1e4 });
  await m.payAll();
  await settle();
  assert.ok(pays.some((p) => p.acc === 'carol' && p.why === 'refund' && p.micro === 60 * 1e4 - NET_MICRO));
  assert.equal(m.view().bids.length, 0);
  assert.deepEqual(m.unbid('carol', ab.id), { error: 'no such bid' });
  assert.equal((await m.quote('carol', { id: 'gpu', n: 1, bid: 0, asset: USDC_ASSET })).error, 'bad price');
  m.stop();
});

test('a bid paid late opens all the same, once; open bids survive a restart', async () => {
  const dir = tmp();
  const w = world(dir);
  const o = (await w.m.quote('bob', { id: 'gears', n: 10, bid: 20, asset: USDC_ASSET })).order;
  w.clock.t += 14 * 60e3;
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'gone');
  w.oc.pay(o.dep.addr);
  w.clock.t += 61 * 60e3;
  await w.m.sweep();
  w.clock.t += 61 * 60e3;
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'done');
  assert.equal(w.m.view().bids.length, 1);
  w.m.stop();
  await w.m.flushed();
  const w2 = world(dir, { clock: w.clock });
  assert.deepEqual(
    w2.m.view().bids.map((x) => [x.b, x.it, x.n, x.p]),
    [['bob', 'gears', 10, 20]],
  );
  w2.m.stop();
});
