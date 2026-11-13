// test/marketsafety.test.mjs — server/market.mjs where money or items could go wrong: nothing is sold before the
// seller's wallet has given the items up, a lot that was never backed pays its buyer back, one account can't hold the
// market for free, a payout that failed stays owed, the market's answer stays small, a file that can't be read is never
// overwritten, a stop or a restart at any point leaves nothing half done, and a file written by the version before
// these rules still opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeMarket, FEE_BP, NET_MICRO, USDC_ASSET } from '../server/market.mjs';
import { BTC, ITEMS, TREASURY, oneClickOf, world, tmp, settle, until, onDisk, openBid, quiet } from './marketworld.mjs';

const MIN = 60e3;
const net = (cents) => Math.floor((cents * 1e4 * (10000 - FEE_BP)) / 10000) - NET_MICRO;

// ---- 1. a sale into a bid waits for the seller's burn
test('a sale into a bid hands over nothing and owes nothing until the burn is confirmed', async () => {
  const w = world(tmp(), { chain: true });
  const bid = await openBid(w, 'gpu', 1, 500);
  const r = await w.m.sell('alice', { fills: [{ bid, it: 'gpu', n: 1 }] });
  assert.equal(r.sold.wait, true, 'the answer comes at once and says the sale is in progress');
  assert.equal(w.stash.alice.gpu, 1, "off the seller's stash while it waits");
  assert.equal(w.stash.carol.gpu, undefined, 'nothing to the bidder yet');
  assert.equal(w.m.state().pays.length, 0, 'no payout queued yet');
  assert.equal(w.m.view().bids.length, 0, 'the bid is taken: no second seller gets it');
  assert.deepEqual(
    w.m.mine('alice').sales.map((s) => [s.st, s.items, s.cents]),
    [['wait', { gpu: 1 }, 500]],
  );
  assert.equal(w.m.view().trades.length, 0);
  w.burn(`msell-${r.sold.id}-gpu`, true);
  await settle();
  assert.equal(w.stash.carol.gpu, 1);
  assert.deepEqual(
    w.m.state().pays.map((p) => [p.acc, p.micro, p.why]),
    [['alice', net(500), 'sale']],
  );
  assert.equal(w.m.mine('alice').sales[0].st, 'done');
  assert.equal(w.m.mine('carol').bids[0].st, 'done');
  assert.equal(w.m.view().trades.length, 1);
  w.m.stop();
});

test('a sale whose burn the wallet refuses: nothing minted, nothing paid, the pieces back in the bid', async () => {
  const w = world(tmp(), { chain: true });
  const bid = await openBid(w, 'all', 4, 30);
  const r = await w.m.sell('alice', {
    fills: [
      { bid, it: 'gpu', n: 1 },
      { bid, it: 'gears', n: 2 },
    ],
  });
  assert.equal(r.sold.wait, true);
  assert.equal(w.m.view().bids[0].n, 1);
  // the gears burnt, the graphics card had been sent away: the sale is off, the gears come back to the seller
  w.burn(`msell-${r.sold.id}-gears`, true);
  await settle();
  assert.equal(w.m.state().pays.length, 0, 'half a sale pays nothing');
  w.burn(`msell-${r.sold.id}-gpu`, false);
  await settle();
  assert.equal(w.m.mine('alice').sales[0].st, 'fail');
  assert.equal(w.m.view().bids[0].n, 4, 'the bid is whole again');
  assert.deepEqual(w.stash.carol, {}, 'nothing reached the bidder');
  assert.equal(w.m.state().pays.length, 0);
  assert.ok(w.ops.some((o) => o[0] === 'give' && o[1] === 'alice' && o[3] === `msellback-${r.sold.id}-gears`));
  assert.ok(!w.ops.some((o) => o[0] === 'give' && /gpu/.test(o[3])), 'what never burnt is not minted back');
  assert.equal(w.m.view().trades.length, 0);
  // a bid taken down while the sale waited: its share goes back to the bidder in USDC
  const r2 = await w.m.sell('alice', { fills: [{ bid, it: 'gears', n: 4 }] });
  assert.deepEqual(w.m.unbid('carol', bid), { back: 0 });
  w.burn(`msell-${r2.sold.id}-gears`, false);
  await settle();
  assert.deepEqual(
    w.m.state().pays.map((p) => [p.acc, p.micro, p.why]),
    [['carol', 4 * 30 * 1e4, 'refund']],
  );
  w.m.stop();
});

test('a sale waiting for its burn survives a restart and ends as the chain queue says', async () => {
  const dir = tmp(),
    chainOps = {};
  let w = world(dir, { chain: true, chainOps });
  const bid = await openBid(w, 'gpu', 2, 500);
  const a = await w.m.sell('alice', { fills: [{ bid, it: 'gpu', n: 1 }] });
  await onDisk(w);
  w.m.stop();
  // the burn went through while the server was down
  chainOps[`msell-${a.sold.id}-gpu`] = 'done';
  w = world(dir, { chain: true, chainOps, clock: w.clock });
  await settle();
  assert.equal(w.m.mine('alice').sales[0].st, 'done');
  assert.equal(w.stash.carol.gpu, 1);
  assert.equal(w.m.state().pays.filter((p) => p.acc === 'alice').length, 1);
  // a second one, refused while the server was down
  w.stash.alice.gpu = 1;
  const b = await w.m.sell('alice', { fills: [{ bid, it: 'gpu', n: 1 }] });
  await onDisk(w);
  w.m.stop();
  chainOps[`msell-${b.sold.id}-gpu`] = 'fail';
  w = world(dir, { chain: true, chainOps, clock: w.clock });
  await settle();
  assert.equal(w.m.mine('alice').sales[0].st, 'fail');
  assert.equal(w.m.view().bids[0].n, 1);
  assert.equal(w.m.state().pays.filter((p) => p.acc === 'alice').length, 1);
  w.m.stop();
});

// ---- 2. a lot is on sale only once its burn is confirmed
test('a lot is not on sale until its burn is confirmed; one refused is gone', async () => {
  const w = world(tmp(), { chain: true });
  const { lot } = await w.m.list('alice', 'gears', 10, 30);
  assert.equal(lot.wait, true);
  assert.equal(w.m.fills('bob', 'gears', 1).short, 1, 'not buyable');
  assert.equal(w.m.view().lots.length, 0, 'not on the shelf');
  assert.equal(w.m.view().totals.listed, 0);
  assert.equal((await w.m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET, lot: lot.id })).error, 'no such lot');
  assert.deepEqual(
    w.m.mine('alice').lots.map((l) => [l.id, l.wait]),
    [[lot.id, true]],
  );
  assert.deepEqual(await w.m.cancel('alice', lot.id), { error: 'being listed' });
  w.burn('mlist-' + lot.id, true);
  assert.equal(w.m.fills('bob', 'gears', 10).short, 0);
  assert.equal(w.m.mine('alice').lots[0].wait, false);
  const two = (await w.m.list('alice', 'gears', 5, 30)).lot;
  w.burn('mlist-' + two.id, false);
  assert.equal(w.m.mine('alice').lots.length, 1, 'the unbacked lot is gone');
  assert.equal(w.m.fills('bob', 'gears', 15).short, 5);
  w.m.stop();
});

test('an order that paid for a lot which turned out unbacked gets its money back, not the items', async () => {
  const w = world(tmp());
  const { lot } = await w.m.list('alice', 'gears', 10, 30);
  const o = (await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
  w.m.unbacked(lot.id); // (a lot from before the wait: on sale, held, and then its burn is refused)
  assert.equal(w.m.state().lots.length, 0, 'the held pieces go too');
  w.oc.pay(o.dep.addr);
  await w.m.sweep();
  assert.equal(w.m.order('carol', o.id).st, 'back');
  assert.deepEqual(w.stash.carol, {});
  assert.deepEqual(
    w.m.state().pays.map((p) => [p.acc, p.micro, p.why]),
    [['carol', 300 * 1e4, 'refund']],
  );
  assert.equal(w.m.view().trades.length, 0);
  w.m.stop();
});

test('a lot being listed when the server stopped: on sale, gone or still waiting by what the chain queue knows', async () => {
  const dir = tmp(),
    chainOps = {};
  let w = world(dir, { chain: true, chainOps });
  const done = (await w.m.list('alice', 'gears', 3, 30)).lot,
    fail = (await w.m.list('alice', 'gears', 3, 31)).lot,
    queued = (await w.m.list('alice', 'gears', 3, 32)).lot;
  // and one written down whose take never ran (the stop came first)
  w.m.state().lots.push({ id: 'Lnever', s: 'alice', it: 'gears', n: 3, held: 0, p: 33, at: 1, w: 'take' });
  await w.m.list('alice', 'gpu', 1, 900);
  await onDisk(w);
  w.m.stop();
  chainOps['mlist-' + done.id] = 'done';
  chainOps['mlist-' + fail.id] = 'fail';
  w = world(dir, { chain: true, chainOps });
  const mine = Object.fromEntries(w.m.mine('alice').lots.map((l) => [l.id, l.wait]));
  assert.equal(mine[done.id], false);
  assert.equal(mine[queued.id], true);
  assert.ok(!(fail.id in mine) && !('Lnever' in mine));
  assert.deepEqual(
    w.m.view().lots.map((l) => l.id),
    [done.id],
  );
  w.m.stop();
});

// ---- 3. one account can't hold the market for free
test('orders asked for together still count: two open at most, the rest refused', async () => {
  const w = world(tmp(), { oc: oneClickOf({ delay: 30 }) });
  for (const p of [20, 21, 22, 23]) await w.m.list('alice', 'gears', 5, p);
  const rs = await Promise.all([1, 2, 3, 4].map(() => w.m.quote('carol', { id: 'gears', n: 5, asset: USDC_ASSET })));
  assert.deepEqual(rs.map((r) => r.error || r.order.st).sort(), [
    'too many open orders',
    'too many open orders',
    'wait',
    'wait',
  ]);
  assert.equal(w.m.fills('bob', 'gears', 20).short, 10, 'only two orders hold lots');
  w.m.stop();
});

test('one buyer holds at most 2000 pieces and $5 000 unpaid', async () => {
  const w = world(tmp());
  w.stash.alice = { gears: 3000, gpu: 10 };
  for (let i = 0; i < 3; i++) await w.m.list('alice', 'gears', 999, 1);
  await w.m.list('alice', 'gpu', 10, 100000);
  assert.equal((await w.m.quote('carol', { id: 'gears', n: 2001, asset: USDC_ASSET })).error, 'too much at once');
  assert.ok((await w.m.quote('carol', { id: 'gears', n: 1500, asset: USDC_ASSET })).order);
  const over = await w.m.quote('carol', { id: 'gears', n: 501, asset: USDC_ASSET });
  assert.deepEqual([over.error, over.max], ['too much at once', 2000]);
  assert.ok((await w.m.quote('carol', { id: 'gears', n: 500, asset: USDC_ASSET })).order);
  assert.equal((await w.m.quote('bob', { id: 'gpu', n: 6, asset: USDC_ASSET })).error, 'too much at once');
  assert.ok((await w.m.quote('bob', { id: 'gpu', n: 5, asset: USDC_ASSET })).order);
  assert.equal(w.m.fills('dave', 'gears', 997).short, 0, 'the refused orders hold nothing');
  w.m.stop();
});

test('unpaid orders given up over and over make the buyer wait, longer each time', async () => {
  const w = world(tmp());
  await w.m.list('alice', 'gears', 10, 30);
  const again = async () => {
    const r = await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET });
    if (r.order) w.m.drop('carol', r.order.id);
    return r;
  };
  for (let i = 0; i < 3; i++) assert.ok((await again()).order, 'the first three cost nothing');
  assert.ok((await again()).order);
  const a = await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET });
  assert.deepEqual([a.error, a.wait], ['slow down', 30]);
  assert.equal(w.m.fills('bob', 'gears', 10).short, 0, 'the market is free meanwhile');
  w.clock.t += 31e3;
  assert.ok((await again()).order);
  assert.equal((await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET })).wait, 60);
  // an order left to run out counts the same
  w.clock.t += 61e3;
  const o = (await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
  w.clock.t += 4 * MIN;
  await w.m.sweep();
  assert.equal(w.m.order('carol', o.id).st, 'gone');
  assert.equal((await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET })).wait, 120);
  // a bid holds nothing, so it is never made to wait; and an hour without giving one up clears the count
  assert.ok((await w.m.quote('carol', { id: 'gears', n: 10, bid: 20, asset: USDC_ASSET })).order);
  w.clock.t += 61 * MIN;
  assert.ok((await again()).order);
  assert.ok((await w.m.quote('carol', { id: 'gears', n: 10, asset: USDC_ASSET })).order);
  w.m.stop();
});

test('no deposit seen: the lots are held three minutes whatever the coin, and a late payment still counts', async () => {
  const w = world(tmp());
  await w.m.list('alice', 'gears', 10, 30);
  const o = (await w.m.quote('bob', { id: 'gears', n: 10, asset: BTC })).order;
  assert.equal(o.until - w.clock.t, 45 * MIN, 'the address takes a payment for as long as the coin needs');
  assert.equal(o.hold - w.clock.t, 3 * MIN, 'the pieces are kept for three minutes');
  w.clock.t += 2 * MIN;
  await w.m.sweep();
  assert.equal(w.m.fills('carol', 'gears', 1).short, 1, 'still held');
  w.clock.t += MIN + 1000;
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'gone');
  assert.equal(w.m.fills('carol', 'gears', 10).short, 0, 'free for buyers who pay');
  // the buyer paid after all, inside the quote's deadline: the same pieces, as they are still there
  w.oc.pay(o.dep.addr);
  w.clock.t += 2 * MIN;
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'done');
  assert.equal(w.stash.bob.gears, 15);
  w.m.stop();
});

test('a deposit seen on a slow coin keeps the lots until the coin has had its time', async () => {
  const w = world(tmp());
  await w.m.list('alice', 'gears', 10, 30);
  const o = (await w.m.quote('bob', { id: 'gears', n: 10, asset: BTC })).order;
  w.clock.t += 2 * MIN;
  w.oc.st.get(o.dep.addr).status = 'KNOWN_DEPOSIT_TX';
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).hold, o.until + 3 * MIN);
  w.clock.t += 40 * MIN;
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'wait');
  assert.equal(w.m.fills('carol', 'gears', 1).short, 1, 'held for the buyer whose coins are on their way');
  w.oc.pay(o.dep.addr);
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'done');
  w.m.stop();
});

test('a submitted hash holds nothing by itself, and a deposit that never completes lets go at the deadline', async () => {
  const w = world(tmp());
  await w.m.list('alice', 'gears', 10, 30);
  // a made-up hash, 1Click still reporting no deposit: the three minutes stand
  const a = (await w.m.quote('bob', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
  assert.ok((await w.m.submit('bob', a.id, 'madeuphash123')).order);
  w.clock.t += 3 * MIN + 1000;
  await w.m.sweep();
  assert.equal(w.m.order('bob', a.id).st, 'gone');
  // a made-up hash that 1Click takes at its word: held to the quote's deadline and its grace, no longer
  const b = (await w.m.quote('bob', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
  await w.m.submit('bob', b.id, 'madeuphash456');
  w.oc.st.get(b.dep.addr).status = 'KNOWN_DEPOSIT_TX';
  await w.m.sweep();
  w.clock.t += 12 * MIN;
  await w.m.sweep();
  assert.equal(w.m.order('bob', b.id).st, 'wait');
  w.clock.t += MIN + 1000;
  await w.m.sweep();
  assert.equal(w.m.order('bob', b.id).st, 'gone');
  assert.equal(w.m.fills('carol', 'gears', 10).short, 0);
  w.m.stop();
});

test('1Click out of reach: a hold still ends on time', async () => {
  const w = world(tmp());
  await w.m.list('alice', 'gears', 10, 30);
  const o = (await w.m.quote('bob', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
  w.oc.down(true);
  w.clock.t += 3 * MIN + 1000;
  await w.m.sweep();
  assert.equal(w.m.order('bob', o.id).st, 'gone');
  w.m.stop();
});

// ---- 4. a payout that failed is still owed
test('a payout refused for want of balance is tried again; an unpaid one is never forgotten', async () => {
  let short = true;
  const sent = [];
  const w = world(tmp(), {
    payout: async (p) => {
      if (p.acc === 'gone.near') return { ok: false, why: 'account gone.near does not exist' };
      if (short) return { ok: false, why: "The account doesn't have enough balance" };
      sent.push(p.id);
      return { ok: true, tx: 'tx1' };
    },
  });
  w.stash['gone.near'] = { gears: 5 };
  await w.m.list('alice', 'gears', 10, 30);
  await w.m.list('gone.near', 'gears', 5, 20);
  const o = (await w.m.quote('carol', { id: 'gears', n: 15, asset: USDC_ASSET })).order;
  w.oc.pay(o.dep.addr);
  await w.m.sweep();
  await w.m.payAll();
  const by = () => Object.fromEntries(w.m.state().pays.map((p) => [p.acc, p]));
  assert.equal(by().alice.st, 'q', 'short of balance: back in the queue');
  assert.equal(by().alice.tries, 1);
  assert.ok(by().alice.next > w.clock.t, 'with a wait');
  assert.equal(by()['gone.near'].st, 'fail', 'refused for another reason: final, by hand');
  assert.equal(w.m.mine('alice').pays[0].st, 'q');
  // eight days on, neither record is gone
  w.clock.t += 8 * 864e5;
  w.m.unbid('nobody', 'x');
  await w.m.list('alice', 'gears', 1, 30);
  assert.deepEqual((await onDisk(w)).pays.map((p) => p.st).sort(), ['fail', 'q']);
  // the treasury topped up: paid
  short = false;
  await w.m.payAll();
  assert.equal(by().alice.st, 'done');
  assert.equal(sent.length, 1);
  // only what was sent for sure is ever forgotten
  w.clock.t += 8 * 864e5;
  await w.m.list('alice', 'gears', 1, 30);
  assert.deepEqual(
    (await onDisk(w)).pays.map((p) => p.st),
    ['fail'],
  );
  w.m.stop();
});

// ---- 5. bounded work
test('orders given up are not asked about every minute for a day', async () => {
  const w = world(tmp());
  await w.m.list('alice', 'gears', 10, 30);
  const a = (await w.m.quote('bob', { id: 'gears', n: 5, asset: USDC_ASSET })).order;
  w.m.drop('bob', a.id);
  const b = (await w.m.quote('carol', { id: 'gears', n: 5, asset: USDC_ASSET })).order;
  w.oc.looks.length = 0;
  await w.m.sweep();
  assert.deepEqual(w.oc.looks, [b.dep.addr, a.dep.addr], 'the order being paid is asked about first');
  // while the quote can still be paid: once a minute
  w.clock.t += 61e3;
  w.oc.looks.length = 0;
  await w.m.sweep();
  assert.ok(w.oc.looks.includes(a.dep.addr));
  // past its deadline with no deposit reported: once an hour, and after a day never
  w.clock.t += 14 * MIN;
  await w.m.sweep();
  w.oc.looks.length = 0;
  for (let i = 0; i < 30; i++) {
    w.clock.t += 2 * MIN;
    await w.m.sweep();
  }
  assert.equal(w.oc.looks.filter((x) => x === a.dep.addr).length, 1);
  w.clock.t += 25 * 60 * MIN;
  w.oc.looks.length = 0;
  await w.m.sweep();
  assert.deepEqual(w.oc.looks, []);
  w.m.stop();
});

test("the market's answer is built once per change and stays small with 20 000 lots", async () => {
  const w = world(tmp());
  const st = w.m.state();
  for (let s = 0; s < 500; s++)
    for (let i = 0; i < 40; i++)
      st.lots.push({
        id: `L${s}_${i}`,
        s: `seller${s}.near`,
        it: ITEMS[i % 2],
        n: 5,
        held: 0,
        p: 100 + ((s * 7 + i) % 900),
        at: 1,
      });
  await w.m.list('alice', 'gpu', 1, 5); // (a change: the answer is built again)
  const t0 = performance.now(),
    v = w.m.view(),
    first = performance.now() - t0;
  assert.ok(first < 1500, `one build took ${first} ms`);
  assert.equal(v.lotsTotal, 20001);
  assert.equal(v.totals.listed, 100001);
  assert.equal(v.totals.sellers, 501);
  assert.ok(v.lots.length <= 40 * ITEMS.length);
  assert.equal(v.lots[0].p, 5, 'the cheapest are the ones kept');
  assert.ok(v.items.every((x) => x.asks.length <= 200));
  assert.ok(JSON.stringify(v).length < 200e3);
  const t1 = performance.now();
  for (let i = 0; i < 200; i++) w.m.view();
  assert.ok(performance.now() - t1 < 200, 'asked again with nothing changed: no rebuild');
  // a lot's link and a seller's page get theirs whatever the bounds left out
  const dear = st.lots.find((l) => l.p === 999);
  assert.ok(!v.lots.some((l) => l.id === dear.id));
  assert.ok(w.m.view({ lot: dear.id }).lots.some((l) => l.id === dear.id));
  assert.equal(w.m.view({ seller: 'seller7.near' }).lots.filter((l) => l.s === 'seller7.near').length, 40);
  assert.equal(w.m.view().lots.length, v.lots.length, 'the kept answer is not changed by that');
  // a change shows at once
  await w.m.cancel('alice', v.lots[0].id);
  assert.notEqual(w.m.view().lots[0].id, v.lots[0].id);
  w.m.stop();
});

// ---- 8. a file that can't be read
test("a market file that can't be read is kept aside and never overwritten; only a missing one starts empty", async () => {
  const dir = tmp();
  assert.equal(world(dir).m.broken(), null, 'no file: an empty market');
  const file = path.join(dir, 'market.json');
  for (const bad of ['{"lots":[{"id"', '{"seq":4}', '[]']) {
    fs.writeFileSync(file, bad);
    const errors = [];
    const m = makeMarket({
      dataDir: dir,
      items: ITEMS,
      oneclick: oneClickOf(),
      treasury: TREASURY,
      take: async () => null,
      give: async () => {},
      log: { warn() {}, error: (...a) => errors.push(a.join(' ')) },
    });
    assert.ok(m.broken(), bad);
    assert.ok(errors.length, 'said in the log');
    assert.deepEqual(await m.list('alice', 'gears', 1, 30), { error: 'market closed', code: 503 });
    assert.equal((await m.quote('bob', { id: 'gears', n: 5, asset: USDC_ASSET })).code, 503);
    assert.equal((await m.sell('bob', { fills: [] })).code, 503);
    assert.equal(m.unbid('bob', 'B1').code, 503);
    assert.equal(m.drop('bob', 'O1').code, 503);
    assert.equal(m.view().on, false);
    await m.flushed();
    await settle();
    assert.equal(fs.readFileSync(file, 'utf8'), bad, 'the file is as it was');
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith('market.json.bad-'));
    assert.ok(aside.length >= 1);
    assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8').length > 0, true);
    for (const f of aside) fs.rmSync(path.join(dir, f));
    m.stop();
  }
});

// ---- 9. stops and restarts
test('a stop refuses new calls, waits for the ones running and leaves everything on disk', async () => {
  const w = world(tmp(), { oc: oneClickOf({ delay: 40 }) });
  await w.m.list('alice', 'gears', 10, 30);
  const running = w.m.quote('bob', { id: 'gears', n: 5, asset: USDC_ASSET });
  const closed = w.m.close();
  assert.deepEqual(await w.m.list('alice', 'gears', 1, 30), { error: 'restarting', code: 503 });
  assert.equal(w.m.drop('bob', 'O1').code, 503);
  assert.equal(w.m.view().on, false);
  await closed;
  const r = await running;
  assert.equal(r.order.st, 'wait', 'the call that was running finished');
  const disk = JSON.parse(fs.readFileSync(path.join(w.dir, 'market.json'), 'utf8'));
  assert.equal(disk.orders[0].st, 'wait');
  assert.equal(disk.lots[0].held, 5);
});

test("a payout's hash is on disk before its transaction leaves; a stop waits for the payout", async () => {
  const dir = tmp();
  let seen = null,
    finish;
  const w = world(dir, {
    payout: async (p, sent) => {
      await sent('hashA');
      seen = JSON.parse(fs.readFileSync(path.join(dir, 'market.json'), 'utf8')).pays[0];
      await new Promise((r) => (finish = r));
      return { ok: true, tx: 'hashA' };
    },
  });
  await w.m.list('alice', 'gears', 10, 30);
  const o = (await w.m.quote('bob', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
  w.oc.pay(o.dep.addr);
  await w.m.sweep();
  w.m.payAll();
  await until(() => seen);
  assert.deepEqual([seen.st, seen.sent], ['s', ['hashA']]);
  let closed = false;
  const c = w.m.close().then(() => (closed = true));
  await settle();
  assert.equal(closed, false, 'the stop waits for the payout being sent');
  finish();
  await c;
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'market.json'), 'utf8')).pays[0].st, 'done');
});

test('a payout in flight at a restart is followed by its hash: done, back in the queue, or still waiting', async () => {
  const start = async (answer) => {
    const dir = tmp(),
      hang = { payout: async (p, sent) => (answer.hash && (await sent(answer.hash)), new Promise(() => {})) };
    let w = world(dir, hang);
    await w.m.list('alice', 'gears', 10, 30);
    const o = (await w.m.quote('bob', { id: 'gears', n: 10, asset: USDC_ASSET })).order;
    w.oc.pay(o.dep.addr);
    await w.m.sweep();
    w.m.payAll();
    await until(() => w.m.state().pays[0].st === 's' && (!answer.hash || w.m.state().pays[0].sent.length));
    await settle();
    await onDisk(w);
    w.m.stop();
    const sent = [];
    w = world(dir, {
      clock: w.clock,
      payout: async (p) => (sent.push(p.id), { ok: true, tx: 'second' }),
      payFollow: async (p) => ({ ...answer.follow, asked: p.sent }),
    });
    await w.m.payAll();
    return { w, sent, pay: () => w.m.state().pays[0] };
  };
  // the chain ran it: done, never sent again
  let x = await start({ hash: 'h1', follow: { ok: true, tx: 'h1' } });
  assert.deepEqual([x.pay().st, x.pay().tx, x.sent.length], ['done', 'h1', 0]);
  x.w.m.stop();
  // the chain ran it and it failed there: nothing left the treasury, so it is sent again
  x = await start({ hash: 'h1', follow: { ok: false, why: 'the withdraw came back' } });
  await x.w.m.payAll();
  assert.deepEqual([x.pay().st, x.pay().tx, x.sent.length], ['done', 'second', 1]);
  x.w.m.stop();
  // the chain has not seen it: it waits (shown as on its way), and only once its transaction can no longer be taken
  // is it sent again
  x = await start({ hash: 'h1', follow: { none: true } });
  assert.deepEqual([x.pay().st, x.sent.length, x.w.m.mine('alice').pays[0].st], ['stuck', 0, 'q']);
  x.w.clock.t += 47 * 3600e3;
  await x.w.m.payAll();
  assert.deepEqual([x.pay().st, x.sent.length], ['stuck', 0]);
  x.w.clock.t += 2 * 3600e3;
  await x.w.m.payAll();
  await x.w.m.payAll();
  assert.deepEqual([x.pay().st, x.sent.length], ['done', 1]);
  x.w.m.stop();
  // stopped before any hash was written: nothing was sent, so it goes straight back in the queue
  x = await start({ hash: null, follow: { none: true } });
  assert.deepEqual([x.pay().st, x.pay().tx, x.sent.length], ['done', 'second', 1]);
  x.w.m.stop();
});

test('items owed when the server stopped are handed over after it, once', async () => {
  const dir = tmp(),
    chainOps = {};
  let w = world(dir, { chain: true, chainOps });
  const lot = (await w.m.list('alice', 'gears', 10, 30)).lot;
  w.burn('mlist-' + lot.id, true);
  const o = (await w.m.quote('bob', { id: 'gears', n: 4, asset: USDC_ASSET })).order;
  // the stop comes after the sale is written down and before the items are handed over
  w.m.state().orders[0].st = 'done';
  w.m.state().gives.push({ acc: 'bob', items: { gears: 4 }, op: 'mbuy-' + o.id });
  w.m.state().gives.push({ acc: 'alice', items: { gears: 1 }, op: 'mcancel-handed-over' });
  w.m.unbid('nobody', 'x');
  w.m.cancel('alice', 'none');
  w.m.state().seq++;
  await w.m.list('alice', 'gpu', 1, 500);
  await onDisk(w);
  w.m.stop();
  chainOps['mcancel-handed-over'] = 'q'; // (this one reached the chain queue before the stop)
  w = world(dir, { chain: true, chainOps });
  await settle();
  assert.equal(w.stash.bob.gears, 5 + 4);
  assert.deepEqual(
    w.ops.filter((x) => x[0] === 'give').map((x) => x[3]),
    ['mbuy-' + o.id],
  );
  assert.equal((await onDisk(w)).gives.length, 0);
  w.m.stop();
});

// ---- a file written by the version before these rules
test('a market file from before these rules opens and goes on correctly', async () => {
  const dir = tmp(),
    t = 1.8e12,
    oc = oneClickOf();
  oc.st.set('depOld', {
    status: 'PENDING_DEPOSIT',
    quoteResponse: { quoteRequest: { recipient: TREASURY, amount: String(200 * 1e4) } },
  });
  const old = {
    seq: 9,
    fees: 12345,
    lots: [
      { id: 'L1aaaa', s: 'alice', it: 'gears', n: 10, held: 4, p: 50, at: t - 5000 },
      { id: 'L2bbbb', s: 'bob', it: 'gpu', n: 1, held: 0, p: 900, at: t - 4000 },
    ],
    orders: [
      {
        id: 'O3cccccc',
        b: 'carol',
        it: 'gears',
        n: 4,
        fills: [{ lot: 'L1aaaa', s: 'alice', it: 'gears', n: 4, p: 50 }],
        cents: 200,
        micro: 200 * 1e4,
        asset: USDC_ASSET,
        sym: 'USDC',
        chain: 'near',
        at: t - 8 * MIN,
        until: t + 2 * MIN,
        st: 'wait',
        dep: { addr: 'depOld', memo: null, in: '2000000', inF: '2.0', d: 6 },
      },
    ],
    bids: [{ id: 'B4dddddd', b: 'carol', it: 'gpu', n: 1, n0: 1, p: 700, at: t - 3000, ord: 'O4dddddd', st: 'open' }],
    trades: [{ at: t - 2000, it: 'gears', n: 2, p: 45, s: 'alice', b: 'bob', o: 'O1' }],
    pays: [
      { id: 'PO1-0', acc: 'alice', micro: 877500, ord: 'O1', why: 'sale', st: 'done', tries: 0, next: 0, at: t - 1000 },
      { id: 'PO2-1', acc: 'alice', micro: 500000, ord: 'O2', why: 'sale', st: 's', tries: 0, next: 0, at: t - 900 },
      { id: 'PO5-2', acc: 'bob', micro: 300000, ord: 'O5', why: 'sale', st: 'q', tries: 2, next: 0, at: t - 800 },
      {
        id: 'PO6-3',
        acc: 'bob',
        micro: 400000,
        ord: 'O6',
        why: 'sale',
        st: 'fail',
        err: "Smart contract panicked: The account doesn't have enough balance",
        tries: 0,
        next: 0,
        at: t - 9 * 864e5,
      },
      {
        id: 'PO7-4',
        acc: 'bob',
        micro: 1,
        ord: 'O7',
        why: 'sale',
        st: 'stuck',
        tx: 'oldhash',
        tries: 0,
        next: 0,
        at: t,
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'market.json'), JSON.stringify(old));
  const sent = [];
  const w = world(dir, {
    oc,
    clock: { t },
    payout: async (p) => (sent.push(p.id), { ok: true, tx: 'tx-' + p.id }),
    payFollow: async (p) => (p.id === 'PO7-4' ? { ok: true, tx: p.sent[0] } : { none: true }),
  });
  assert.equal(w.m.broken(), null);
  const v = w.m.view();
  assert.deepEqual(
    v.lots.map((l) => [l.id, l.n, l.held]),
    [
      ['L1aaaa', 6, 4],
      ['L2bbbb', 1, 0],
    ],
    'the lots are on sale as they were: one from before the wait counts as confirmed',
  );
  assert.equal(v.bids.length, 1);
  assert.equal(v.trades.length, 1);
  assert.deepEqual(w.m.mine('alice').sales, []);
  // the waiting order keeps the ten minutes it was given, though it is older than the new three
  await w.m.sweep();
  assert.equal(w.m.order('carol', 'O3cccccc').st, 'wait');
  assert.equal(w.m.order('carol', 'O3cccccc').hold, old.orders[0].until + 3 * MIN);
  // the payouts: the queued one and the one once refused for want of balance are sent; the one in flight at the old
  // version's stop has no hash and waits for a look by hand; the stuck one with a hash is followed
  await w.m.payAll();
  const by = Object.fromEntries(w.m.state().pays.map((p) => [p.id, p.st]));
  assert.deepEqual(by, { 'PO1-0': 'done', 'PO2-1': 'stuck', 'PO5-2': 'done', 'PO6-3': 'done', 'PO7-4': 'done' });
  assert.deepEqual(sent.sort(), ['PO5-2', 'PO6-3']);
  // paid: the order settles as before, the bid can be sold into, a lot can be taken down
  oc.pay('depOld');
  await w.m.sweep();
  await settle();
  assert.equal(w.m.order('carol', 'O3cccccc').st, 'done');
  assert.equal(w.stash.carol.gears, 4);
  const r = await w.m.sell('alice', { fills: [{ bid: 'B4dddddd', it: 'gpu', n: 1 }] });
  assert.equal(r.sold.cents, 700);
  assert.deepEqual(await w.m.cancel('bob', 'L2bbbb'), { back: 1 });
  const disk = await onDisk(w);
  assert.equal(disk.fees, 12345 + 200 * 1e4 - net(200) + 700 * 1e4 - net(700));
  assert.ok(Array.isArray(disk.sales) && Array.isArray(disk.gives) && disk.cool);
  w.m.stop();
});

test('the limits the tests above lean on are the ones the market exports', async () => {
  const m = await import('../server/market.mjs');
  assert.deepEqual(
    [m.OPEN_MAX, m.HELD_MAX, m.HELD_CENTS_MAX, m.UNPAID_HOLD_MS, m.COOL_FREE, m.COOL_MS, m.VIEW_LOTS, m.ASKS_MAX],
    [2, 2000, 500000, 3 * MIN, 3, 30e3, 40, 200],
  );
  assert.ok(quiet);
});
