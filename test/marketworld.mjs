// test/marketworld.mjs — the stand-ins the market's tests share (marketplace.test.mjs, marketsafety.test.mjs): a 1Click
// that answers what the test set, stashes in memory with take/give as the server does them, a clock the test moves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMarket, USDC_ASSET } from '../server/market.mjs';

export const ITEMS = ['gears', 'gpu', 't_butcher'];
export const quiet = { warn() {}, error() {} };
export const TREASURY = 'f'.repeat(64);
export const BTC = 'nep141:btc.omft.near';
export const TOKENS = [
  { assetId: USDC_ASSET, symbol: 'USDC', blockchain: 'near', decimals: 6, price: 1 },
  { assetId: 'nep141:sol.omft.near', symbol: 'SOL', blockchain: 'sol', decimals: 9, price: 80 },
  { assetId: BTC, symbol: 'BTC', blockchain: 'btc', decimals: 8, price: 90000 },
  { assetId: 'nep141:tron-usdt.omft.near', symbol: 'USDT', blockchain: 'tron', decimals: 6, price: 1 },
];
// a stand-in 1Click: quotes give a deposit address each; status answers what the test set for that address. delay: ms
// a quote takes; looks: the addresses asked about, in order
export function oneClickOf({ delay = 0 } = {}) {
  const st = new Map(),
    quotes = [],
    looks = [];
  let n = 0,
    fail = null,
    down = false;
  return {
    quotes,
    looks,
    st,
    failNext: (e) => (fail = e),
    down: (v) => (down = v),
    async tokens() {
      return TOKENS;
    },
    async quote(b) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
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
      looks.push(addr);
      if (down) throw Object.assign(new Error('timeout'), { code: 0 });
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
// chain: true: a take answers { wait: true } as the server does when items live on wallets; the burn's outcome is then
// told by w.burn(op, ok) (the chain queue's hooks), and w.chainOps is what that queue would know after a restart
export function world(
  dir,
  { oc = oneClickOf(), payout = null, payFollow = null, clock = { t: 1.8e12 }, chain = false, chainOps = {} } = {},
) {
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
      if (!chain) return null;
      chainOps[op] = 'q';
      return { wait: true };
    },
    give: async (acc, it, op) => {
      const s = (stash[acc] ||= {});
      for (const id in it) s[id] = (s[id] || 0) + it[id];
      ops.push(['give', acc, it, op]);
      if (chain) chainOps[op] = 'q';
    },
    opState: (op) => chainOps[op] || null,
    payout,
    payFollow,
    now: () => clock.t,
    pollMs: 1e9,
    log: quiet,
  });
  const burn = (op, ok = true) => {
    chainOps[op] = ok ? 'done' : 'fail';
    m.burnt(op, ok);
  };
  return { m, oc, stash, ops, clock, burn, chainOps, dir };
}
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
export const settle = () => new Promise((r) => setTimeout(r, 20));
// waits until fn() is true (a write to disk, a timer of 0 ms: a few ms either way)
export async function until(fn, ms = 3000) {
  for (const t0 = Date.now(); !fn();) {
    if (Date.now() - t0 > ms) throw new Error('waited too long for ' + fn);
    await new Promise((r) => setTimeout(r, 5));
  }
}
// the market's file as it is on disk once everything saved so far is written
export async function onDisk(w) {
  await w.m.flushed();
  return JSON.parse(fs.readFileSync(path.join(w.dir, 'market.json'), 'utf8'));
}
// a bid of carol's, paid and open: its id
export async function openBid(w, id, n, cents, acc = 'carol') {
  const o = (await w.m.quote(acc, { id, n, bid: cents, asset: USDC_ASSET })).order;
  w.oc.pay(o.dep.addr);
  await w.m.sweep();
  return w.m.state().bids.at(-1).id;
}
