// test/marketchain.test.mjs — the market and the chain queue wired as server/server.mjs wires them: a take queues a
// `game_burn`, the queue's onDone and onFail hooks tell the market how it went, and after a restart the market asks
// the queue (op) about the burns it was still waiting for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeChain } from '../server/chain.mjs';
import { makeMarket, USDC_ASSET } from '../server/market.mjs';
import { ITEMS, TREASURY, oneClickOf, quiet, settle, until } from './marketworld.mjs';

// a signer that refuses a burn of any item named in `gone` (the wallet no longer holds it) and can be held back
function signerOf(gone = new Set()) {
  const sent = [];
  let gate = null;
  return {
    sent,
    hold() {
      let open;
      gate = new Promise((r) => (open = r));
      return () => ((gate = null), open());
    },
    async call(contract, method, args) {
      if (gate) await gate;
      sent.push({ method, args });
      if (method === 'game_burn' && args.token_ids.some((id) => gone.has(id)))
        return { hash: 'h' + sent.length, ok: false, failure: 'not enough balance of the token' };
      return { hash: 'h' + sent.length, ok: true, value: true };
    },
  };
}
function wired(dir, signer) {
  const stash = { alice: { gears: 20, gpu: 2 }, carol: {} };
  let market = null;
  const hook = (ok) => (c) => {
    if (c.k === 'burn') for (const op of c.ops) if (/^m(list|sell)-/.test(op)) market.burnt(op, ok);
  };
  const chain = makeChain({
    dataDir: dir,
    near: {},
    signer,
    contract: 'items.near',
    tokens: ITEMS,
    on: true,
    lag: 0,
    log: quiet,
    onDone: hook(true),
    onFail: hook(false),
  });
  const oc = oneClickOf();
  market = makeMarket({
    dataDir: dir,
    items: ITEMS,
    oneclick: oc,
    treasury: TREASURY,
    take: async (acc, id, n, op) => {
      if ((stash[acc][id] || 0) < n) return 'not enough';
      stash[acc][id] -= n;
      return chain.add(acc, 'burn', [[id, n]], op, 0) ? { wait: true } : null;
    },
    give: async (acc, it, op) => {
      for (const id in it) stash[acc][id] = (stash[acc][id] || 0) + it[id];
      chain.add(acc, 'mint', it, op);
    },
    opState: (op) => chain.op(op),
    pollMs: 1e9,
    log: quiet,
  });
  return { chain, market, oc, stash, signer };
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-chain-'));

test('a lot goes on sale when its burn is done, and is taken down when the wallet refuses it', async () => {
  const s = signerOf(new Set(['gpu'])),
    release = s.hold(),
    w = wired(dir(), s);
  const a = (await w.market.list('alice', 'gears', 5, 30)).lot;
  assert.equal(a.wait, true);
  assert.equal(w.chain.op('mlist-' + a.id), 'q');
  assert.equal(w.market.view().lots.length, 0);
  release();
  await until(() => w.chain.op('mlist-' + a.id) === 'done');
  assert.deepEqual(
    w.market.view().lots.map((l) => l.id),
    [a.id],
  );
  // the graphics cards were sent away from the wallet before the stash knew
  const b = (await w.market.list('alice', 'gpu', 2, 900)).lot;
  await until(() => w.chain.op('mlist-' + b.id) === 'fail');
  assert.deepEqual(
    w.market.mine('alice').lots.map((l) => l.id),
    [a.id],
  );
  assert.equal(w.chain.op('mlist-never'), null);
  w.market.stop();
});

test('items sold into a bid that the wallet no longer holds: no mint to the bidder, no payout', async () => {
  const s = signerOf(new Set(['gpu'])),
    w = wired(dir(), s);
  const o = (await w.market.quote('carol', { id: 'gpu', n: 1, bid: 500, asset: USDC_ASSET })).order;
  w.oc.pay(o.dep.addr);
  await w.market.sweep();
  const bid = w.market.state().bids[0].id;
  const r = await w.market.sell('alice', { fills: [{ bid, it: 'gpu', n: 1 }] });
  assert.ok(r.sold, JSON.stringify(r));
  await until(() => w.market.mine('alice').sales[0].st === 'fail');
  await settle();
  assert.equal(w.market.state().pays.length, 0);
  assert.ok(!s.sent.some((x) => x.method === 'game_mint'), 'nothing minted to anyone');
  assert.equal(w.market.view().bids[0].n, 1);
  // and with the item on the wallet: burnt, then minted to the bidder, then owed to the seller
  const s2 = signerOf(),
    w2 = wired(dir(), s2);
  const o2 = (await w2.market.quote('carol', { id: 'gpu', n: 1, bid: 500, asset: USDC_ASSET })).order;
  w2.oc.pay(o2.dep.addr);
  await w2.market.sweep();
  await w2.market.sell('alice', { fills: [{ bid: w2.market.state().bids[0].id, it: 'gpu', n: 1 }] });
  await until(() => w2.market.state().pays.length === 1);
  await until(() => s2.sent.length === 2);
  assert.deepEqual(
    s2.sent.map((x) => [x.method, x.args.owner_id || x.args.receiver_id]),
    [
      ['game_burn', 'alice'],
      ['game_mint', 'carol'],
    ],
  );
  w.market.stop();
  w2.market.stop();
});

test('a burn confirmed while the server was down is found in the queue at the restart', async () => {
  const d = dir(),
    s = signerOf(),
    release = s.hold();
  let w = wired(d, s);
  const a = (await w.market.list('alice', 'gears', 5, 30)).lot;
  await w.market.flushed();
  w.market.stop();
  // the market's file says "waiting"; the queue then finishes the burn with no market listening
  const file = path.join(d, 'market.json'),
    waiting = fs.readFileSync(file, 'utf8');
  release();
  await until(() => w.chain.op('mlist-' + a.id) === 'done');
  await until(() => JSON.parse(fs.readFileSync(path.join(d, 'chain.json'), 'utf8')).q[0].st === 'done');
  await w.market.flushed();
  fs.writeFileSync(file, waiting);
  w = wired(d, signerOf());
  assert.equal(w.market.mine('alice').lots[0].wait, false);
  assert.equal(w.market.view().lots.length, 1);
  w.market.stop();
});
