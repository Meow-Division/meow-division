// server/market.mjs — the players' market (docs/market.md): a player puts items from the stash up for sale at a price
// in dollars, anyone with a NEAR account buys them with any coin NEAR Intents takes (1Click Swap API), the seller is paid
// in USDC on NEAR. No contract change: the items of a lot leave the seller's wallet when it is put up (take: the
// server's `game_burn`, op `mlist-<lot>`), come back on a cancel (give: `game_mint`, `mcancel-…`) and go to the buyer on
// a sale (give, `mbuy-<order>`).
//
// A purchase: the buyer asks for n of an item (at most a price a piece); the cheapest lots of other players fill it and
// are held for the order while it waits. 1Click quotes EXACT_OUTPUT: the order's dollars as USDC on NEAR delivered to
// the market's treasury account (or, when 1Click quotes no delivery out to NEAR, as for a while on 2026-11-12: "Quoting
// for this pair is not available", credited to the treasury's balance inside NEAR Intents, which every coin reaches), the buyer sends `amountIn` of their coin to
// the quote's own deposit address before its deadline. The server asks 1Click about every open order every few seconds:
//   SUCCESS          the items to the buyer, each seller's share of the lots to them as a payout (97.5%; 2.5% stays)
//   REFUNDED, FAILED the lots let go (1Click returned the coins to the refund address)
//   no deposit seen within a few minutes, or nothing final by the deadline (and a grace): the lots let go; the order is
//                    still looked at for a day, and a payment that lands after all is filled from the same lots if they
//                    are still there, else paid back in USDC
// A payout is USDC from the treasury to the receiver's NEAR account (from its account when that holds enough, else
// withdrawn from its NEAR Intents balance; the receiver's USDC storage paid if they lack it), one at a time, tried again
// until the chain answers. Without a treasury key the payouts wait in the queue.
//
// Nothing is sold that the seller's wallet has not given up: a lot goes on sale, and a sale into a bid pays out, only
// once the wallet's burn is confirmed (burnt(), called from the chain queue's hooks).
//
// Kept in DATA_DIR/market.json: { seq, lots, orders, pays, trades, fees, bids, sales, gives, cool }. Money in whole cents
// (prices) and micro-USDC (what moves on chain: a cent is 10 000 of them). Every change is written down before the awaits
// that carry it out, so a restart at any point finds what was cut short and finishes it (see "after a restart").
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', // (USDC on NEAR, Circle's)
  USDC_ASSET = 'nep141:' + USDC,
  FEE_BP = 250, // the market's fee, in basis points of the seller's sum
  MIN_CENTS = 1, // the least a purchase may come to: no floor of the market's own, a cent is the smallest price
  NET_MICRO = 3000, // the chain's cost of one payout (0.3 cents; ~0.0005 NEAR measured), paid by whoever it goes to:
  // out of a seller's payout and out of a bid's money when its bidder takes it down. A refund the buyer did not
  // ask for goes back whole
  PRICE_MAX = 1e6, // cents a piece at most ($10 000)
  LOT_MAX = 999, // pieces in one lot
  LOTS_MAX = 40, // lots one seller may have up at once
  OPEN_MAX = 2, // orders one buyer may have open at once (being quoted or waiting; each holds lots)
  HELD_MAX = 2000, // pieces one buyer's unpaid orders may hold at once
  HELD_CENTS_MAX = 500000, // and what they may come to ($5 000)
  BIDS_MAX = 20, // bids one buyer may have open at once
  HOLD_MS = 10 * 60e3, // the quote's deadline: how long the deposit address takes a payment
  SLOW_HOLD_MS = 45 * 60e3, // the same for coins whose chains confirm slowly
  UNPAID_HOLD_MS = 3 * 60e3, // how long an order holds its lots with no deposit seen, whatever the coin
  GRACE_MS = 3 * 60e3, // after the deadline, before the lots are let go
  PROCESSING_MS = 30 * 60e3, // more for an order whose swap 1Click is already running
  COOL_FREE = 3, // unpaid orders given up or run out that cost a buyer nothing
  COOL_MS = 30e3, // the wait before the next order after one more; doubles with each
  COOL_MAX_MS = 30 * 60e3,
  COOL_FORGET_MS = 3600e3, // an hour without one: forgotten
  LATE_MS = 24 * 3600e3, // an order let go is still looked at this long (a payment landing late)
  LATE_FAST_MS = 60e3, // how often, while a payment may still be coming
  LATE_SLOW_MS = 3600e3, // and after its deadline with no deposit reported
  LATE_LOOKS = 10, // such looks in one sweep at most
  TX_DEAD_MS = 48 * 3600e3, // a transaction the chain has not seen by then can no longer be taken (its block hash is
  // only good for 86 400 blocks, under a day)
  VIEW_MS = 5e3, // the market's answer is built again at least this often
  VIEW_LOTS = 40, // lots an item in the market's answer, the cheapest
  ASKS_MAX = 200, // price levels an item in it
  BIDS_VIEW = 500, // bids in it, the dearest
  TRADES_KEEP = 2000,
  DONE_KEEP = 7 * 864e5; // ms a finished order, bid, sale or a payout sent is kept for its status
// chains that take long to confirm a deposit (their quotes last longer), and the least 1Click takes from some (its
// "swap limits": a quote under them is refused)
const SLOW = new Set(['btc', 'ltc', 'doge', 'bch', 'dash', 'zec', 'cardano']),
  CHAIN_MIN = { bsc: 100000, tron: 10000 },
  // 1Click's states that mean a deposit has been seen
  DEPOSIT = new Set(['KNOWN_DEPOSIT_TX', 'PROCESSING', 'INCOMPLETE_DEPOSIT']),
  // a payout the chain refused for want of balance: not final, the treasury gets topped up
  SHORT = /balance|insufficient|not enough|notenough/i;
const cents = (x) => Number.isSafeInteger(x) && x > 0;
const now0 = () => Date.now();
const rid = (p) => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

// ---------------------------------------------------------------- 1Click (NEAR Intents)
// the API's few calls; an answer it refused throws an Error with its HTTP code (.code) and its message
export function makeOneClick({ base = 'https://1click.chaindefuser.com', key = '', fetch: f = globalThis.fetch } = {}) {
  async function req(method, p, body, ms = 15e3) {
    const r = await f(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const t = await r.text();
    let j = null;
    try {
      j = JSON.parse(t);
    } catch {}
    if (r.status >= 400 || !j)
      throw Object.assign(new Error(String((j && j.message) || t || r.status).slice(0, 300)), { code: r.status });
    return j;
  }
  return {
    tokens: () => req('GET', '/v0/tokens'),
    quote: (body) => req('POST', '/v0/quote', body, 20e3),
    status: (addr, memo) =>
      req(
        'GET',
        '/v0/status?depositAddress=' +
          encodeURIComponent(addr) +
          (memo ? '&depositMemo=' + encodeURIComponent(memo) : ''),
      ),
    submit: (txHash, depositAddress, nearSenderAccount) =>
      req('POST', '/v0/deposit/submit', {
        txHash,
        depositAddress,
        ...(nearSenderAccount ? { nearSenderAccount } : {}),
      }),
  };
}

// ---------------------------------------------------------------- the market
// items: the ids that can be listed.
// take(acc, id, n, op): the items off the seller's stash and wallet. Resolves to null (taken for good), an error text
//   (refused, nothing taken) or { wait: true } (off the stash, the wallet's burn queued: its outcome comes later
//   through burnt(op, ok)).
// give(acc, { id: n }, op): onto the buyer's stash and wallet (or back to the seller's).
// opState(op): what the chain queue knows of a take's or a give's op after a restart: 'q' (still queued), 'done',
//   'fail' (refused), 'lost' (given up, outcome not known) or null (never heard of it).
// treasury: the account the payments go to (null: no payments, quotes refused).
// payout(p, sent): USDC to p.acc. `await sent(hash)` is called with the transaction's hash before it is sent (kept on
//   disk first, so a restart can follow it). Resolves to { ok: true, tx } | { ok: false, why } (the chain refused it:
//   nothing left the treasury) | { unknown: true, tx } (sent, outcome not known), or throws (not sent: again later).
// payFollow(p): a look at a payout whose outcome stayed unknown (p.sent, p.tx: its hashes) → { ok: true, tx } |
//   { ok: false, why } (it ran and failed: nothing left) | { none: true } (the chain knows none of them) |
//   { wait: true } (not known yet).
export function makeMarket({
  dataDir,
  items,
  oneclick,
  treasury = null,
  ready = () => true, // (the treasury able to take payments now: on chain, with gas, its USDC storage paid)
  take,
  give,
  opState = () => null,
  payout = null,
  payFollow = null,
  onTrade = null, // (told of each purchase's and each sale's trades once they are done: [{ it, n, p, s, b, k }])
  referral = 'meowdivision',
  now = now0,
  pollMs = 8e3,
  log = console,
}) {
  // who took the trade: 'b' a buyer took a lot off the shelf (an order, id O…), 's' a seller sold into a bid (a sale, S…)
  const side = (x) => (String(x.o || '')[0] === 'S' ? 's' : 'b');
  const told = (list) => {
    try {
      if (onTrade && list.length) onTrade(list);
    } catch (e) {
      log.warn('market: onTrade ' + e.message);
    }
  };
  const file = path.join(dataDir, 'market.json'),
    known = new Set(items);
  // lots: [{ id, s, it, n, held, p, at, w? }]: w 'take' (the items being taken off the stash) or 'burn' (off the stash,
  //   the wallet's burn not confirmed yet): not on sale until it is gone. A lot from before this field has none.
  // bids: offers to buy at one's own price, [{ id, b, it, n, n0, p, at, ord, st }], it 'all' for any item (a collection
  //   bid, as on HOT Craft). A bid is paid first, as a purchase is (its order: kind 'bid'); the money waits in the
  //   treasury until a seller sells into it (sell()) or the bidder takes it down (unbid(): what is left back in USDC).
  //   st 'open' | 'done' | 'gone'
  // sales: sales into bids, [{ id, s, fills: [{ bid, ord, b, it, n, p }], burn: { item: state }, st, at }]: the bids are
  //   lowered at once, the items burn off the seller's wallet, and only when every burn is confirmed do the items go
  //   to the bidders and the seller's share to the payouts. burn states: 'take', 'burn', 'done', 'fail', 'back' (burnt,
  //   then given back because another item's burn failed). st 'wait' | 'done' | 'fail'
  // gives: items owed to a stash, [{ acc, items, op }]: written with the change that owes them, handed over after
  // cool: { account: { k, at } }: unpaid orders that held lots and were given up or ran out, of late
  let st = { seq: 0, lots: [], orders: [], pays: [], trades: [], fees: 0, bids: [], sales: [], gives: [], cool: {} };
  // only a missing file starts an empty market: one that can't be read or isn't a market is money state, so it is
  // copied aside and the market stays shut (every call refused) until someone has looked
  let broken = null;
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!r || !Array.isArray(r.lots)) throw new Error('not a market file');
    st = { ...st, ...r };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      broken = String(e.message || e).slice(0, 200);
      const aside = `${file}.bad-${Date.now().toString(36)}`;
      try {
        fs.copyFileSync(file, aside);
      } catch (e2) {
        log.error('market: could not copy', file, 'aside:', e2.message);
      }
      log.error(`market: ${file} can't be read (${broken}); kept as ${aside}, the market is shut until it is fixed`);
    }
  }
  for (const k of ['orders', 'pays', 'trades', 'bids', 'sales', 'gives']) if (!Array.isArray(st[k])) st[k] = [];
  if (!st.cool || typeof st.cool !== 'object') st.cool = {};

  let dirty = false,
    writing = null,
    viewCache = null,
    closing = false;
  const save = () => {
    viewCache = null;
    if (broken) return;
    dirty = true;
    if (!writing) writing = Promise.resolve().then(flush);
  };
  // resolves to true once everything saved so far is on disk (false: the disk refused; tried again in a while)
  async function flush() {
    let ok = true;
    try {
      while (dirty) {
        dirty = false;
        const t = now();
        st.orders = st.orders.filter((o) => !o.end || t - o.end < DONE_KEEP);
        // (a payout not paid is a debt: only the ones sent for sure are ever forgotten)
        st.pays = st.pays.filter((p) => p.st !== 'done' || t - p.at < DONE_KEEP);
        st.bids = st.bids.filter((x) => x.st === 'open' || t - (x.end || x.at) < DONE_KEEP);
        st.sales = st.sales.filter((s) => s.st === 'wait' || t - (s.end || s.at) < DONE_KEEP);
        for (const a in st.cool) if (t - st.cool[a].at > COOL_FORGET_MS) delete st.cool[a];
        if (st.trades.length > TRADES_KEEP) st.trades = st.trades.slice(-TRADES_KEEP);
        const tmp = file + '.tmp',
          fh = await fs.promises.open(tmp, 'w');
        try {
          await fh.writeFile(JSON.stringify(st));
          await fh.sync(); // (a payout's hash must be on the disk before its transaction is sent)
        } finally {
          await fh.close();
        }
        await fs.promises.rename(tmp, file);
      }
    } catch (e) {
      ok = false;
      dirty = true;
      log.error('market: saving', file, 'failed:', e.message);
      const again = setTimeout(save, 5e3);
      if (again.unref) again.unref();
    }
    writing = null;
    return ok;
  }
  const flushed = () => writing || Promise.resolve(true);
  const lotOf = (id) => st.lots.find((l) => l.id === id);
  const free = (l) => l.n - l.held;
  const orderOf = (id) => st.orders.find((o) => o.id === id);
  const bidOf = (id) => st.bids.find((x) => x.id === id);
  const afterNet = (micro) => Math.max(0, micro - NET_MICRO);
  const pay = (id, acc, micro, ord, why) =>
    st.pays.push({ id, acc, micro, ord, why, st: 'q', tries: 0, next: 0, at: now() });

  // ---- items owed to a stash: written down with the change that owes them, handed over one at a time
  let giving = null,
    giveT = null;
  async function giveOnce() {
    for (;;) {
      const g = st.gives[0];
      if (!g) return true;
      try {
        await give(g.acc, g.items, g.op);
      } catch (e) {
        log.error('market give', g.op, g.acc, e.message);
        return false;
      }
      st.gives.shift();
      save();
    }
  }
  function giveAll() {
    if (!giving)
      giving = giveOnce().then((ok) => {
        giving = null;
        if (ok) return st.gives.length ? giveAll() : undefined;
        clearTimeout(giveT);
        giveT = setTimeout(giveAll, 30e3);
        if (giveT.unref) giveT.unref();
      });
    return giving;
  }
  const owe = (acc, its, op) => st.gives.push({ acc, items: its, op });

  // ---- selling
  // what the chain queue says of a take whose answer never came (a restart, a throw): the state to go on from
  function takeState(op, was) {
    const s = opState(op);
    if (s === 'done' || s === 'fail') return s;
    if (s === 'q') return 'burn';
    if (s === 'lost' || was === 'burn') {
      log.error(`market: the burn ${op} has no known outcome: check the wallet by hand`);
      return 'burn';
    }
    return 'fail'; // (never reached the queue: nothing was burnt, the stash is set to the wallet at its next look)
  }
  // a lot: n of item id at price cents a piece. It is written down first (not on sale yet), then the items leave the
  // seller's stash; it goes on sale once the wallet's burn is confirmed (burnt)
  async function list(acc, id, n, price) {
    if (!treasury || !ready()) return { error: 'payments off' };
    if (!known.has(id)) return { error: 'no such item' };
    if (!Number.isSafeInteger(n) || n < 1 || n > LOT_MAX) return { error: 'bad amount' };
    if (!cents(price) || price > PRICE_MAX) return { error: 'bad price' };
    if (st.lots.filter((l) => l.s === acc).length >= LOTS_MAX) return { error: 'too many lots' };
    const lot = {
      id: 'L' + ++st.seq + crypto.randomBytes(2).toString('hex'),
      s: acc,
      it: id,
      n,
      held: 0,
      p: price,
      at: now(),
      w: 'take',
    };
    st.lots.push(lot);
    save();
    const op = 'mlist-' + lot.id;
    let r;
    try {
      r = await take(acc, id, n, op);
    } catch (e) {
      log.error('market take', op, acc, e.message);
      r = { state: takeState(op, 'take') };
    }
    if (!st.lots.includes(lot)) return { error: 'not enough' }; // (its burn was refused meanwhile)
    if (typeof r === 'string' || (r && r.state === 'fail')) {
      st.lots = st.lots.filter((x) => x !== lot);
      save();
      return { error: typeof r === 'string' ? r : 'wallet out of reach' };
    }
    // (lot.w gone already: the burn was confirmed before the take answered)
    if (lot.w === 'take') {
      if ((r && r.wait) || (r && r.state === 'burn')) lot.w = 'burn';
      else delete lot.w;
    }
    save();
    return { lot: lotView(lot) };
  }
  // the lot's pieces not held by an order back to the seller (those held come back if their order falls through)
  async function cancel(acc, lotId) {
    const l = lotOf(lotId);
    if (!l || l.s !== acc) return { error: 'no such lot' };
    if (l.w) return { error: 'being listed' };
    const k = free(l);
    if (k <= 0) return { error: 'held by a purchase' };
    l.n -= k;
    if (l.n <= 0) st.lots = st.lots.filter((x) => x !== l);
    owe(acc, { [l.it]: k }, `mcancel-${l.id}-${l.n}`);
    save();
    await giveAll();
    return { back: k };
  }
  // a burn's outcome (the chain queue's hooks): a lot's (`mlist-<lot>`) or one item's of a sale into bids
  // (`msell-<sale>-<item>`). A lot whose burn was refused (the items sent away before) is gone, held pieces and all:
  // an order that paid for them gets its money back (settle)
  function burnt(op, ok) {
    if (op.startsWith('mlist-')) {
      const l = lotOf(op.slice(6));
      if (!l) return;
      if (ok) delete l.w;
      else {
        st.lots = st.lots.filter((x) => x !== l);
        log.warn(`market: lot ${l.id} of ${l.s} not on the wallet, taken down`);
      }
      return save();
    }
    const m = /^msell-([^-]+)-(.+)$/.exec(op),
      sale = m && st.sales.find((s) => s.id === m[1]);
    if (!sale || !(m[2] in sale.burn)) return;
    if (sale.burn[m[2]] !== 'take' && sale.burn[m[2]] !== 'burn') return;
    sale.burn[m[2]] = ok ? 'done' : 'fail';
    save();
    saleStep(sale).catch((e) => log.error('market sale', sale.id, e.message));
  }

  // ---- buying
  // the cheapest pieces of item id for acc (never their own), at most max cents a piece: [{ lot, s, it, n, p }] and the
  // sum; id 'all': of any item (the order book of all items: its lowest prices bought up in one purchase, as a sweep on
  // HOT Craft); with lot: that one lot only (a link to it, /market/lot/<id>: that seller's pieces at their price)
  function fills(acc, id, n, max = PRICE_MAX, lot = null) {
    const out = [];
    let need = n,
      sum = 0;
    const lots = st.lots
      .filter(
        (l) =>
          !l.w && (id === 'all' || l.it === id) && l.s !== acc && free(l) > 0 && l.p <= max && (!lot || l.id === lot),
      )
      .sort((a, b) => a.p - b.p || a.at - b.at);
    for (const l of lots) {
      if (need <= 0) break;
      const k = Math.min(need, free(l));
      out.push({ lot: l.id, s: l.s, it: l.it, n: k, p: l.p });
      sum += k * l.p;
      need -= k;
    }
    return { fills: out, sum, short: need };
  }
  const hold = (fl, d) => {
    for (const f of fl) {
      const l = lotOf(f.lot);
      if (l) l.held = Math.max(0, l.held + d * f.n);
    }
  };
  // the coin's chain from its asset id as the token list has it (tokens(): kept from /v0/tokens; one ask at a time)
  let tokCache = null,
    tokAt = 0,
    tokAsk = null;
  function tokens() {
    if (tokCache && now() - tokAt < 30 * 60e3) return Promise.resolve(tokCache);
    if (!tokAsk)
      tokAsk = (async () => {
        try {
          const t = await oneclick.tokens();
          if (Array.isArray(t) && t.length) {
            tokCache = t
              .filter((x) => x && typeof x.assetId === 'string' && x.price > 0)
              .map((x) => ({
                a: x.assetId,
                s: x.symbol,
                c: x.blockchain,
                d: x.decimals,
                usd: x.price,
                ...(CHAIN_MIN[x.blockchain] ? { min: CHAIN_MIN[x.blockchain] } : {}),
              }));
            tokAt = now();
          }
        } catch (e) {
          log.warn('market tokens', e.message);
        }
        tokAsk = null;
        return tokCache || [];
      })();
    return tokAsk;
  }
  // an unpaid order that held lots, given up or run out: one more against its buyer. The first few cost nothing (a
  // coin changed, a window closed); after that each one makes the buyer wait longer before the next order
  function strike(acc) {
    const c = st.cool[acc],
      t = now();
    st.cool[acc] = { k: c && t - c.at < COOL_FORGET_MS ? c.k + 1 : 1, at: t };
  }
  const coolLeft = (acc) => {
    const c = st.cool[acc];
    if (!c || c.k <= COOL_FREE) return 0;
    return Math.max(0, c.at + Math.min(COOL_MAX_MS, COOL_MS * 2 ** (c.k - COOL_FREE - 1)) - now());
  };
  const open = (o) => o.st === 'new' || o.st === 'wait';
  // an order: n of item id for acc, paid with asset (a 1Click asset id); refundTo: an address on the coin's chain for a
  // refund (none: the buyer's own NEAR Intents account). Holds the lots, then asks 1Click for the deposit address.
  // bid: a price a piece in cents: the order pays for a bid of n of id ('all': any item) at that price, nothing is held
  async function quote(acc, { id, n, max, asset, refundTo, lot, bid }) {
    if (!treasury || !ready()) return { error: 'payments off' };
    if (bid != null) {
      lot = null;
      if (!cents(bid) || bid > PRICE_MAX) return { error: 'bad price' };
      if (st.bids.filter((x) => x.b === acc && x.st === 'open').length >= BIDS_MAX) return { error: 'too many bids' };
    }
    if (lot != null) {
      const l = typeof lot === 'string' && lotOf(lot);
      if (!l || l.w || free(l) <= 0) return { error: 'no such lot' };
      if (l.s === acc) return { error: 'your own lot' };
      id = l.it;
    }
    if (id !== 'all' && !known.has(id)) return { error: 'no such item' };
    if (!Number.isSafeInteger(n) || n < 1 || n > LOT_MAX * 10) return { error: 'bad amount' };
    if (typeof asset !== 'string' || asset.length > 200) return { error: 'bad coin' };
    if (refundTo != null && (typeof refundTo !== 'string' || !/^[\w.:-]{2,128}$/.test(refundTo)))
      return { error: 'bad refund address' };
    const cool = bid == null ? coolLeft(acc) : 0;
    if (cool > 0) return { error: 'slow down', wait: Math.ceil(cool / 1000) };
    if (st.orders.filter((o) => o.b === acc && open(o)).length >= OPEN_MAX) return { error: 'too many open orders' };
    // (the order takes its place now, before the first await: requests sent together can't all slip under the limit)
    const t = now(),
      o = {
        id: 'O' + ++st.seq + crypto.randomBytes(3).toString('hex'),
        b: acc,
        it: id,
        n,
        fills: [],
        cents: 0,
        micro: 0,
        asset,
        at: t,
        until: t + HOLD_MS,
        st: 'new',
        v: 2,
        ...(bid != null ? { kind: 'bid', p: bid } : {}),
      };
    st.orders.push(o);
    const undo = (answer) => {
      hold(o.fills, -1);
      st.orders = st.orders.filter((x) => x !== o);
      save();
      return answer;
    };
    const tok = (await tokens()).find((x) => x.a === asset);
    if (!tok) return undo({ error: 'bad coin' });
    const fl =
      bid != null
        ? { fills: [], sum: n * bid, short: 0 }
        : fills(acc, id, n, cents(max) ? max : PRICE_MAX, lot || null);
    if (fl.short > 0) return undo({ error: 'not enough on sale', have: n - fl.short });
    if (fl.sum < MIN_CENTS) return undo({ error: 'below minimum', min: MIN_CENTS });
    if (tok.min && fl.sum < tok.min) return undo({ error: 'below minimum', min: tok.min });
    if (bid == null) {
      // what this buyer's unpaid orders hold already: together no more than a buyer may keep from the others
      let pcs = n,
        sum = fl.sum;
      for (const x of st.orders)
        if (x !== o && x.b === acc && open(x) && x.fills.length) {
          pcs += x.fills.reduce((a, f) => a + f.n, 0);
          sum += x.cents;
        }
      if (pcs > HELD_MAX || sum > HELD_CENTS_MAX)
        return undo({ error: 'too much at once', max: HELD_MAX, maxCents: HELD_CENTS_MAX });
    }
    const until = t + (SLOW.has(tok.c) ? SLOW_HOLD_MS : HOLD_MS);
    Object.assign(o, { fills: fl.fills, cents: fl.sum, micro: fl.sum * 1e4, sym: tok.s, chain: tok.c, until });
    hold(o.fills, 1); // (held before the quote's await: no other order takes the same pieces meanwhile)
    viewCache = null;
    let q;
    try {
      const ask = (recipientType) =>
        oneclick.quote({
          dry: false,
          swapType: 'EXACT_OUTPUT',
          slippageTolerance: 50,
          originAsset: asset,
          depositType: 'ORIGIN_CHAIN',
          destinationAsset: USDC_ASSET,
          amount: String(o.micro),
          refundTo: refundTo || acc,
          refundType: refundTo ? 'ORIGIN_CHAIN' : 'INTENTS',
          recipient: treasury,
          recipientType,
          deadline: new Date(until).toISOString(),
          referral,
          quoteWaitingTimeMs: 2500,
        });
      try {
        q = await ask('DESTINATION_CHAIN');
      } catch (e) {
        if (!/not available/i.test(e.message)) throw e;
        q = await ask('INTENTS'); // (no delivery out to NEAR quoted: the treasury's NEAR Intents balance takes it)
        o.into = 'intents';
      }
    } catch (e) {
      const m = /at least (\d+)/.exec(e.message); // ("Amount is too low for bridge, try at least 4600947": micro-USDC)
      if (m) return undo({ error: 'below minimum', min: Math.ceil(+m[1] / 1e4) });
      log.warn('market quote', acc, asset, e.message);
      return undo({ error: e.code === 400 ? 'coin refused' : 'intents out of reach', why: e.message });
    }
    const qq = (q && q.quote) || {};
    if (!qq.depositAddress) return undo({ error: 'intents out of reach' });
    o.dep = {
      addr: qq.depositAddress,
      memo: qq.depositMemo || null,
      in: qq.amountIn,
      inF: qq.amountInFormatted,
      minIn: qq.minAmountIn,
      inUsd: qq.amountInUsd,
      d: tok.d,
      sig: q.signature || null, // (1Click's signature of the quote: kept for a dispute)
      dl: qq.deadline || null,
    };
    o.refund = refundTo || null;
    o.at = now(); // (the hold runs from the moment the buyer has the address)
    o.st = 'wait';
    save();
    kick();
    return { order: orderView(o) };
  }
  // a deposit's transaction hash told to 1Click (it then looks at once, not at its next sweep of the chain). The hash
  // alone holds nothing longer: only what 1Click reports back does (holdEnd)
  async function submit(acc, orderId, txHash) {
    const o = orderOf(orderId);
    if (!o || o.b !== acc || !o.dep) return { error: 'no such order' };
    if (typeof txHash !== 'string' || !/^[\w:-]{8,128}$/.test(txHash)) return { error: 'bad hash' };
    try {
      await oneclick.submit(txHash, o.dep.addr, o.chain === 'near' ? acc : undefined);
    } catch (e) {
      return { error: 'intents refused', why: e.message };
    }
    o.tx = txHash;
    save();
    kick(500);
    return { order: orderView(o) };
  }
  // an order its buyer gave up on before paying (another coin picked, the window closed): its lots let go. A payment
  // sent anyway is still caught for a day (late: the same pieces, or the money back)
  function drop(acc, orderId) {
    const o = orderOf(orderId);
    if (!o || o.b !== acc) return { error: 'no such order' };
    if (o.st !== 'wait') return { order: orderView(o) };
    if (DEPOSIT.has(o.seen)) return { error: 'payment on its way' };
    if (o.fills.length) strike(acc);
    letGo(o, 'gone');
    o.dropped = 1;
    kick();
    return { order: orderView(o) };
  }
  // what an order brings, item by item (an order of all items takes several)
  const itemsOf = (o) => {
    const got = {};
    for (const f of o.fills) got[f.it || o.it] = (got[f.it || o.it] || 0) + f.n;
    return got;
  };
  // an order paid for pieces that are no longer there: all of its money back in USDC
  function refund(o, why) {
    o.st = 'back';
    o.end = now();
    pay(`P${o.id}-r`, o.b, o.micro, o.id, 'refund');
    log.warn(`market: order ${o.id} ${why}: ${o.micro / 1e6} USDC back to ${o.b}`);
    save();
    paySoon();
  }
  // the order paid: the items to the buyer, the lots' pieces sold, each seller's share queued
  async function settle(o, details) {
    if (o.kind === 'bid') return openBid(o, details);
    hold(o.fills, -1);
    // (a lot taken down meanwhile because its items were never on the wallet: nothing to hand over)
    const there = o.fills.every((f) => {
      const l = lotOf(f.lot);
      return l && !l.w && l.n >= f.n;
    });
    if (!there) return refund(o, 'paid for a lot that is gone');
    for (const f of o.fills) {
      const l = lotOf(f.lot);
      l.n -= f.n;
      if (l.n <= 0) st.lots = st.lots.filter((x) => x !== l);
    }
    const share = {};
    for (const f of o.fills) {
      share[f.s] = (share[f.s] || 0) + f.n * f.p;
      st.trades.push({ at: now(), it: f.it || o.it, n: f.n, p: f.p, s: f.s, b: o.b, o: o.id });
    }
    told(o.fills.map((f) => ({ it: f.it || o.it, n: f.n, p: f.p, s: f.s, b: o.b, k: 'b' })));
    let paid = 0;
    for (const [s, c] of Object.entries(share)) {
      const micro = afterNet(Math.floor((c * 1e4 * (10000 - FEE_BP)) / 10000));
      paid += micro;
      pay(`P${o.id}-${++st.seq}`, s, micro, o.id, 'sale');
    }
    st.fees += o.micro - paid;
    o.st = 'done';
    o.end = now();
    o.out = details
      ? { in: details.amountInFormatted || null, tx: (details.nearTxHashes || []).slice(-1)[0] || null }
      : null;
    owe(o.b, itemsOf(o), 'mbuy-' + o.id);
    save();
    await giveAll();
    paySoon();
  }
  // a bid paid: up in the books, its money in the treasury until it is sold into or taken down
  function openBid(o, details) {
    if (!st.bids.some((x) => x.ord === o.id))
      st.bids.push({
        id: 'B' + o.id.slice(1),
        b: o.b,
        it: o.it,
        n: o.n,
        n0: o.n,
        p: o.p,
        at: now(),
        ord: o.id,
        st: 'open',
      });
    o.st = 'done';
    o.end = now();
    o.out = details
      ? { in: details.amountInFormatted || null, tx: (details.nearTxHashes || []).slice(-1)[0] || null }
      : null;
    save();
  }
  // ---- selling into bids
  // acc's items sold into others' bids: fills [{ bid, it, n }], n of item it into that bid (a bid for an item takes
  // that item, a bid for any item takes any). The page works them out, the dearest bids first; a bid gone or taken
  // meanwhile: 'bids changed', nothing sold. The sale is written down and the bids lowered first (no other seller gets
  // them meanwhile), then the items leave the seller's stash. Nothing goes to the bidders and nothing is owed to the
  // seller until the wallet has confirmed every burn (saleStep): a seller who moved the items away first would
  // otherwise be paid for items that also still exist
  async function sell(acc, { fills: want }) {
    if (!treasury || !ready()) return { error: 'payments off' };
    if (!Array.isArray(want) || !want.length || want.length > 100) return { error: 'bad fills' };
    const out = [], // [{ bid, it, n, p, b }]
      used = new Map();
    for (const f of want) {
      const k = f && f.n;
      if (!f || !known.has(f.it) || !Number.isSafeInteger(k) || k < 1 || k > LOT_MAX * 10)
        return { error: 'bad fills' };
      const x = typeof f.bid === 'string' && bidOf(f.bid);
      if (!x || x.st !== 'open' || x.b === acc || (x.it !== 'all' && x.it !== f.it)) return { error: 'bids changed' };
      used.set(x, (used.get(x) || 0) + k);
      if (used.get(x) > x.n) return { error: 'bids changed' };
      out.push({ bid: x, it: f.it, n: k, p: x.p, b: x.b });
    }
    const sale = {
      id: 'S' + ++st.seq + crypto.randomBytes(3).toString('hex'),
      s: acc,
      fills: out.map((f) => ({ bid: f.bid.id, ord: f.bid.ord, b: f.b, it: f.it, n: f.n, p: f.p })),
      burn: {},
      st: 'wait',
      at: now(),
    };
    for (const f of out) {
      f.bid.n -= f.n; // (taken now: the awaits below can't let another seller in)
      sale.burn[f.it] = 'take';
    }
    st.sales.push(sale);
    save();
    let err = null;
    for (const id of Object.keys(sale.burn)) {
      if (sale.bad) {
        sale.burn[id] = 'fail'; // (the sale is off already: nothing more is taken)
        continue;
      }
      const op = `msell-${sale.id}-${id}`;
      let r;
      try {
        r = await take(acc, id, saleCount(sale, id), op);
      } catch (e) {
        log.error('market take', op, acc, e.message);
        r = { state: takeState(op, 'take') };
      }
      if (typeof r === 'string') err = err || r;
      // (no longer 'take': the burn's outcome came before the take answered)
      if (sale.burn[id] === 'take')
        sale.burn[id] = typeof r === 'string' ? 'fail' : r && r.state ? r.state : r && r.wait ? 'burn' : 'done';
      await saleStep(sale);
    }
    save();
    await saleStep(sale);
    if (sale.bad) {
      sale.quiet = 1; // (its seller has the answer here: "My items" needn't say it again)
      return { error: err || 'not enough' };
    }
    return { sold: { id: sale.id, n: out.reduce((a, f) => a + f.n, 0), ...saleSum(sale), wait: sale.st !== 'done' } };
  }
  const saleCount = (sale, id) => sale.fills.reduce((a, f) => a + (f.it === id ? f.n : 0), 0);
  const saleSum = (sale) => {
    const sum = sale.fills.reduce((a, f) => a + f.n * f.p, 0);
    return { cents: sum, micro: afterNet(Math.floor((sum * 1e4 * (10000 - FEE_BP)) / 10000)) };
  };
  // a sale into bids moved on by what its burns came to. One refused: the sale is off, the pieces go back to the bids
  // (a bid taken down meanwhile: its share back to its bidder in USDC) and what did burn is given back to the seller.
  // All confirmed: the items to the bidders, the seller's 97.5% less the chain's cost to the payouts
  async function saleStep(sale) {
    if (sale.st !== 'wait') return;
    const states = () => Object.values(sale.burn);
    if (!sale.bad && states().includes('fail')) {
      sale.bad = 1;
      for (const f of sale.fills) {
        const x = bidOf(f.bid);
        if (x && x.st === 'open') x.n += f.n;
        else pay(`P${f.bid}-r${++st.seq}`, f.b, f.n * f.p * 1e4, f.ord, 'refund');
      }
    }
    if (sale.bad) {
      for (const id in sale.burn)
        if (sale.burn[id] === 'done') {
          sale.burn[id] = 'back';
          owe(sale.s, { [id]: saleCount(sale, id) }, `msellback-${sale.id}-${id}`);
        }
      if (!states().some((s) => s === 'take' || s === 'burn')) {
        sale.st = 'fail';
        sale.end = now();
        log.warn(`market: sale ${sale.id} of ${sale.s} off: the items were not on the wallet`);
      }
      save();
      await giveAll();
      return paySoon();
    }
    if (!states().every((s) => s === 'done')) return;
    const toBuyer = {};
    for (const f of sale.fills) {
      const x = bidOf(f.bid);
      if (x && x.n <= 0 && x.st === 'open') ((x.st = 'done'), (x.end = now()));
      const g = (toBuyer[f.b] ||= {});
      g[f.it] = (g[f.it] || 0) + f.n;
      st.trades.push({ at: now(), it: f.it, n: f.n, p: f.p, s: sale.s, b: f.b, o: sale.id });
    }
    told(sale.fills.map((f) => ({ it: f.it, n: f.n, p: f.p, s: sale.s, b: f.b, k: 's' })));
    const { cents: sum, micro } = saleSum(sale);
    pay(`P${sale.id}`, sale.s, micro, sale.id, 'sale');
    st.fees += sum * 1e4 - micro;
    sale.st = 'done';
    sale.end = now();
    for (const [b, it] of Object.entries(toBuyer)) owe(b, it, `mbid-${sale.id}-${b}`);
    save();
    await giveAll();
    paySoon();
  }
  // a bid taken down by its bidder: what is left of it back to them in USDC
  function unbid(acc, bidId) {
    const x = bidOf(bidId);
    if (!x || x.b !== acc || x.st !== 'open') return { error: 'no such bid' };
    const k = x.n;
    x.n = 0;
    x.st = 'gone';
    x.end = now();
    const micro = afterNet(k * x.p * 1e4);
    if (k > 0) {
      pay(`P${x.id}-r`, acc, micro, x.ord, 'refund');
      st.fees += k * x.p * 1e4 - micro;
    }
    save();
    paySoon();
    return { back: micro / 1e4 };
  }
  // a payment that landed after the order let its lots go: the same pieces again if still free, else the money back
  async function late(o, details) {
    const ok = o.fills.every((f) => {
      const l = lotOf(f.lot);
      return l && !l.w && free(l) >= f.n && l.p === f.p;
    });
    if (!ok) return refund(o, 'paid late, its lots gone');
    hold(o.fills, 1);
    return settle(o, details);
  }
  const letGo = (o, s) => {
    if (o.st === 'wait') hold(o.fills, -1);
    o.st = s;
    o.end = now();
    save();
  };
  // how long a waiting order keeps its lots. No deposit seen: a few minutes whatever the coin (an order costs
  // nothing, so it must not keep pieces from buyers who pay). Once 1Click reports a deposit: the quote's deadline,
  // which is as long as the coin's chain needs, and a while more when the swap itself is already running. A hash the
  // buyer submitted counts for nothing until 1Click reports it. A bid holds no lots: it waits out its deadline. An
  // order from before this rule (no v) keeps the deadline it was given
  const holdEnd = (o) =>
    !o.v || !o.fills.length || DEPOSIT.has(o.seen)
      ? o.until + GRACE_MS + (o.seen === 'PROCESSING' ? PROCESSING_MS : 0)
      : Math.min(o.at + UNPAID_HOLD_MS, o.until + GRACE_MS);
  // a waiting order out of time: its lots let go (a payment landing after all: late), and it counts against its buyer
  function expire(o) {
    if (o.fills.length && !DEPOSIT.has(o.seen)) strike(o.b);
    letGo(o, 'gone');
  }
  // one look at an order's state on 1Click
  async function look(o) {
    let r;
    try {
      r = await oneclick.status(o.dep.addr, o.dep.memo);
    } catch (e) {
      // (1Click out of reach or not knowing the address: the hold still ends on time)
      if (o.st === 'wait' && now() > holdEnd(o)) expire(o);
      return;
    }
    // (an answer about another quote than ours: ignored)
    const qr = r && r.quoteResponse && r.quoteResponse.quoteRequest;
    if (qr && (qr.recipient !== treasury || qr.amount !== String(o.micro)))
      return log.warn('market: status of', o.id, 'not ours');
    const s = r && r.status,
      was = o.seen;
    o.seen = s;
    if (s === 'SUCCESS') return o.st === 'wait' ? settle(o, r.swapDetails) : late(o, r.swapDetails);
    if (s === 'REFUNDED' || s === 'FAILED') {
      if (o.st === 'wait') letGo(o, s === 'REFUNDED' ? 'refunded' : 'failed');
      else ((o.st = s === 'REFUNDED' ? 'refunded' : 'failed'), save());
      return;
    }
    // PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, INCOMPLETE_DEPOSIT: on its way, held until holdEnd
    if (o.st === 'wait' && now() > holdEnd(o)) expire(o);
    else if (s !== was) save();
  }
  // an order let go is looked at again: every minute while a payment may still be coming (its quote's deadline not
  // passed, or a deposit reported), else once an hour until a day has passed (a deposit found late is still owed)
  const lateDue = (o, t) => {
    if (o.st !== 'gone' || !o.dep || t - o.end >= LATE_MS) return false;
    const quiet = !DEPOSIT.has(o.seen) && t > o.until + GRACE_MS;
    return t - (o.lk || 0) >= (quiet ? LATE_SLOW_MS : LATE_FAST_MS);
  };
  let timer = null,
    busy = null;
  function kick(ms = pollMs) {
    if (closing) return;
    clearTimeout(timer);
    timer = setTimeout(sweep, ms);
    if (timer.unref) timer.unref();
  }
  async function sweep() {
    if (busy) return kick();
    let free1;
    busy = new Promise((r) => (free1 = r));
    try {
      // the orders being paid first, in their own pass: nothing let go earlier holds them up
      for (const o of st.orders.filter((x) => x.dep && x.st === 'wait')) await look(o);
      const t = now(),
        late1 = st.orders
          .filter((o) => lateDue(o, t))
          .sort((a, b) => (a.lk || 0) - (b.lk || 0))
          .slice(0, LATE_LOOKS);
      for (const o of late1) {
        o.lk = now();
        await look(o);
      }
    } catch (e) {
      log.error('market sweep', e.message);
    } finally {
      busy = null;
      free1();
    }
    if (st.orders.some((o) => o.st === 'wait' || (o.st === 'gone' && now() - o.end < LATE_MS))) kick();
  }

  // ---- payouts: USDC from the treasury, one at a time
  let paying = null,
    payT = null;
  function paySoon(ms = 0) {
    if (!payout || closing) return;
    clearTimeout(payT);
    payT = setTimeout(payAll, ms);
    if (payT.unref) payT.unref();
  }
  const hashesOf = (p) => [...new Set([...(p.sent || []), p.tx].filter(Boolean))];
  const backoff = (p) => now() + Math.min(600e3, 5e3 * 2 ** Math.min(7, p.tries));
  // payouts whose outcome stayed unknown (sent before a restart, or never answered): followed by their hashes. One the
  // chain ran: done, or back in the queue if it failed there. One the chain has never seen goes back in the queue only
  // when its transaction can no longer be taken (TX_DEAD_MS): a payout is never sent twice
  async function followAll() {
    if (!payFollow) return;
    for (const p of st.pays.filter((x) => x.st === 'stuck' && hashesOf(x).length && (x.fnext || 0) <= now())) {
      let r = null;
      try {
        r = await payFollow({ ...p, sent: hashesOf(p) });
      } catch (e) {
        log.warn(`market payout ${p.id}: following it failed: ${e.message}`);
      }
      p.fn = (p.fn || 0) + 1;
      p.fnext = now() + Math.min(600e3, 15e3 * 2 ** Math.min(6, p.fn));
      if (r && r.ok) {
        p.st = 'done';
        p.tx = r.tx || p.tx || null;
        p.at = now();
        log.warn(`market payout ${p.id} to ${p.acc}: found on chain (${p.tx}), done`);
      } else if ((r && r.ok === false) || (r && r.none && now() - (p.sentAt || p.at) > TX_DEAD_MS)) {
        p.st = 'q';
        p.tries++;
        p.next = 0;
        p.err = String(r.why || 'never reached the chain').slice(0, 300);
        p.sent = [];
        p.tx = null;
        log.warn(`market payout ${p.id} to ${p.acc}: ${p.err}; back in the queue`);
      }
      save();
    }
  }
  function payAll() {
    if (!payout) return Promise.resolve();
    if (!paying) paying = payLoop().finally(() => (paying = null));
    return paying;
  }
  async function payLoop() {
    await followAll();
    for (;;) {
      if (closing) return;
      const t = now(),
        p = st.pays.find((x) => x.st === 'q' && x.next <= t);
      if (!p) {
        const later = [
          ...st.pays.filter((x) => x.st === 'q').map((x) => x.next),
          ...(payFollow ? st.pays.filter((x) => x.st === 'stuck' && hashesOf(x).length).map((x) => x.fnext || 0) : []),
        ];
        if (later.length) paySoon(Math.max(1000, Math.min(...later) - t));
        return;
      }
      p.st = 's';
      p.sent = []; // (an empty list at a restart: nothing was sent, so it is safe to send)
      p.tx = null;
      save();
      let out = null,
        err = null;
      try {
        if (!(await flushed())) throw new Error('the payout could not be written down first');
        out = await payout(p, async (hash) => {
          p.sent.push(hash);
          p.sentAt = now();
          save();
          if (!(await flushed())) throw new Error('the hash could not be written down first');
        });
      } catch (e) {
        err = e;
      }
      p.at = now();
      if (out && out.ok) {
        p.st = 'done';
        p.tx = out.tx || null;
      } else if (out && out.unknown) {
        // (sent, but its outcome not known even after following it: never sent twice; followed by its hash)
        p.st = 'stuck';
        p.tx = out.tx || null;
        p.fnext = now() + 60e3;
        log.error(`market payout ${p.id} to ${p.acc}: outcome not known (${p.tx}), following it`);
      } else if (out && out.ok === false && !SHORT.test(String(out.why || ''))) {
        p.st = 'fail';
        p.err = String(out.why || '').slice(0, 300);
        log.error(`market payout ${p.id} to ${p.acc} refused: ${p.err}`);
      } else {
        // (not sent: the RPC down, the key not ready; or refused for want of balance: the treasury is topped up or a
        // payment still on its way lands. Again later)
        p.st = 'q';
        p.tries++;
        p.err = String((out && out.why) || (err && err.message) || 'outcome not known').slice(0, 300);
        p.next = backoff(p);
        if (out) log.error(`market payout ${p.id} to ${p.acc}: the treasury is short (${p.err}), try ${p.tries}`);
        else if (p.tries > 3) log.warn(`market payout ${p.id} try ${p.tries}: ${p.err}`);
      }
      save();
    }
  }

  // ---- what the pages see
  const lotView = (l) => ({ id: l.id, s: l.s, it: l.it, n: l.n, free: free(l), p: l.p, at: l.at, wait: !!l.w });
  const orderView = (o) => ({
    id: o.id,
    it: o.it,
    n: o.n,
    items: itemsOf(o),
    kind: o.kind || null,
    p: o.p || null,
    cents: o.cents,
    st: o.st === 'gone' && o.dropped ? 'dropped' : o.st,
    seen: o.seen || null,
    at: o.at,
    until: o.until,
    hold: o.fills.length ? holdEnd(o) : null, // (its pieces are kept for it until then)
    sym: o.sym,
    chain: o.chain,
    asset: o.asset,
    dep: o.dep ? { addr: o.dep.addr, memo: o.dep.memo, in: o.dep.in, inF: o.dep.inF, d: o.dep.d } : null,
    refund: o.refund || null,
    out: o.out || null,
  });
  const DAY = 864e5;
  const pubLot = (l) => ({ id: l.id, s: l.s, it: l.it, n: free(l), held: l.held, p: l.p, at: l.at });
  const onSale = (l) => !l.w && (free(l) > 0 || l.held > 0);
  const byPrice = (a, b) => a.p - b.p || a.at - b.at;
  // the whole market in one answer: the lots on sale (cheapest first; the site's shelf, each lot its own card and
  // link), per item its asks (by price and seller), its last trades, 14 days of prices; every open bid; totals.
  // Built once per change (and at least every VIEW_MS: the day's windows move), one pass over the lots. The answer is
  // bounded: the VIEW_LOTS cheapest lots an item and its ASKS_MAX cheapest price levels (lotsTotal: all there are)
  function buildView() {
    const t = now(),
      by = {};
    for (const id of items)
      by[id] = {
        it: id,
        asks: [],
        listed: 0,
        floor: null,
        vol24: 0,
        sold24: 0,
        last: null,
        chg: null,
        hist: [],
        tr: [],
      };
    const levels = new Map(), // item | price | seller → its ask
      perItem = {},
      sellers = new Set();
    let lotsTotal = 0;
    for (const l of st.lots) {
      const b = by[l.it];
      if (!b || !onSale(l)) continue;
      lotsTotal++;
      (perItem[l.it] ||= []).push(l);
      const k = free(l);
      if (k <= 0) continue;
      sellers.add(l.s);
      b.listed += k;
      const key = `${l.it}|${l.p}|${l.s}`;
      let lv = levels.get(key);
      if (!lv) {
        lv = { p: l.p, n: 0, s: l.s };
        levels.set(key, lv);
        b.asks.push(lv);
      }
      lv.n += k;
    }
    const lots = [];
    for (const id in perItem) for (const l of perItem[id].sort(byPrice).slice(0, VIEW_LOTS)) lots.push(l);
    const days = 14,
      d0 = Math.floor(t / DAY) - days + 1;
    for (const id in by) {
      const b = by[id];
      b.asks.sort((a, c) => a.p - c.p);
      b.floor = b.asks.length ? b.asks[0].p : null;
      if (b.asks.length > ASKS_MAX) b.asks.length = ASKS_MAX;
      b.hist = Array.from({ length: days }, (_, i) => ({ d: d0 + i, lo: null, hi: null, avg: null, n: 0, vol: 0 }));
    }
    let vol24 = 0,
      sold24 = 0;
    const old = {}; // (the price a day ago: the last trade before then)
    for (const x of st.trades) {
      const b = by[x.it];
      if (!b) continue;
      if (x.at <= t - DAY) old[x.it] = x.p;
      if (x.at > t - DAY) {
        b.vol24 += x.n * x.p;
        b.sold24 += x.n;
        vol24 += x.n * x.p;
        sold24 += x.n;
      }
      b.last = x.p;
      b.tr.push({ at: x.at, n: x.n, p: x.p, s: x.s, b: x.b });
      const h = b.hist[Math.floor(x.at / DAY) - d0];
      if (h) {
        h.lo = h.lo == null ? x.p : Math.min(h.lo, x.p);
        h.hi = h.hi == null ? x.p : Math.max(h.hi, x.p);
        h.vol += x.n * x.p;
        h.n += x.n;
      }
    }
    let floor = null,
      listed = 0;
    for (const id in by) {
      const b = by[id];
      for (const h of b.hist) h.avg = h.n ? Math.round(h.vol / h.n) : null;
      b.tr = b.tr.slice(-12).reverse();
      b.sold7 = b.hist.slice(-7).reduce((s, h) => s + h.n, 0);
      if (b.last != null && old[id] != null) b.chg = Math.round(((b.last - old[id]) / old[id]) * 1000) / 10;
      if (b.floor != null && (floor == null || b.floor < floor)) floor = b.floor;
      listed += b.listed;
    }
    return {
      at: t,
      fee: FEE_BP,
      min: MIN_CENTS,
      net: NET_MICRO,
      on: false,
      treasury,
      // (a lot wholly held by a purchase being paid: n 0; its link says so, the shelf leaves it out)
      lots: lots.sort(byPrice).map(pubLot),
      lotsTotal,
      items: Object.values(by),
      // (the bids: each one, dearest first; it 'all' for any item)
      bids: st.bids
        .filter((x) => x.st === 'open' && x.n > 0)
        .sort((a, c) => c.p - a.p || a.at - c.at)
        .slice(0, BIDS_VIEW)
        .map((x) => ({ id: x.id, b: x.b, it: x.it, n: x.n, p: x.p, at: x.at })),
      trades: st.trades
        .slice(-60)
        .reverse()
        .map((x) => ({ at: x.at, it: x.it, n: x.n, p: x.p, s: x.s, b: x.b, k: side(x) })),
      totals: { floor, vol24, sold24, listed, sellers: sellers.size },
    };
  }
  // lot, seller: a lot's link and a seller's page ask for theirs by name, so they show whatever the bounds left out
  function view({ lot = null, seller = null } = {}) {
    const t = now();
    if (!viewCache || t - viewCache.at > VIEW_MS || t < viewCache.at) viewCache = buildView();
    const v = { ...viewCache, on: !broken && !closing && !!treasury && ready() };
    delete v.at;
    if (lot || seller) {
      const have = new Set(v.lots.map((l) => l.id)),
        more = st.lots.filter((l) => onSale(l) && !have.has(l.id) && (l.id === lot || l.s === seller));
      if (more.length) v.lots = [...v.lots, ...more.map(pubLot)].sort(byPrice);
    }
    return v;
  }
  // one player's side: their lots, orders, sales and purchases, payouts
  function mine(acc) {
    return {
      bids: st.bids
        .filter((x) => x.b === acc && (x.st === 'open' || now() - x.at < DONE_KEEP))
        .slice(-30)
        .reverse()
        .map((x) => ({ id: x.id, it: x.it, n: x.n, n0: x.n0, p: x.p, st: x.st, at: x.at })),
      lots: st.lots.filter((l) => l.s === acc).map(lotView),
      orders: st.orders
        .filter((o) => o.b === acc)
        .slice(-20)
        .reverse()
        .map(orderView),
      // (sales into bids: 'wait' while the items leave the wallet, 'fail' when they turned out not to be on it)
      sales: st.sales
        .filter((s) => s.s === acc && !s.quiet)
        .slice(-10)
        .reverse()
        .map((s) => {
          const its = {};
          for (const f of s.fills) its[f.it] = (its[f.it] || 0) + f.n;
          return { id: s.id, st: s.st, items: its, ...saleSum(s), at: s.at };
        }),
      sold: st.trades
        .filter((x) => x.s === acc)
        .slice(-30)
        .reverse(),
      bought: st.trades
        .filter((x) => x.b === acc)
        .slice(-30)
        .reverse(),
      pays: st.pays
        .filter((p) => p.acc === acc)
        .slice(-20)
        .reverse()
        .map((p) => ({
          id: p.id,
          micro: p.micro,
          why: p.why,
          st: p.st === 's' || p.st === 'stuck' ? 'q' : p.st,
          tx: p.st === 'done' ? p.tx || null : null,
          at: p.at,
        })),
    };
  }
  function order(acc, id) {
    const o = orderOf(id);
    return o && o.b === acc ? orderView(o) : null;
  }

  // ---- after a restart: every change is written down before its awaits, so what was cut short is picked up here
  if (!broken) {
    // an order whose quote was still being asked for: never shown to its buyer, so its lots are let go (the waiting
    // ones keep theirs: held is kept with the lots, and the sweep goes on)
    if (st.orders.some((o) => o.st === 'new')) {
      for (const o of st.orders.filter((x) => x.st === 'new')) hold(o.fills || [], -1);
      st.orders = st.orders.filter((o) => o.st !== 'new');
      save();
    }
    for (const p of st.pays) {
      // a payout in flight when the server stopped. Its hash is written down before it is sent: none, and nothing
      // left the treasury, so it goes back in the queue. With a hash it is followed (followAll). One from before the
      // hashes were kept (no list at all) can't be told apart: it waits for a look by hand
      if (p.st === 's') {
        if (Array.isArray(p.sent) && !p.sent.length) p.st = 'q';
        else {
          p.st = 'stuck';
          log.error(
            `market payout ${p.id} to ${p.acc} was in flight at a restart: ` +
              (hashesOf(p).length ? `following ${hashesOf(p).join(', ')}` : 'check it by hand'),
          );
        }
        save();
      }
      // refused for want of balance by the version that took that as final: owed all the same
      if (p.st === 'fail' && SHORT.test(String(p.err || ''))) {
        p.st = 'q';
        p.next = 0;
        save();
      }
    }
    // lots and sales whose burn was still to be confirmed: what the chain queue knows of each
    for (const l of st.lots.filter((x) => x.w)) {
      const s = takeState('mlist-' + l.id, l.w);
      if (s === 'done') delete l.w;
      else if (s === 'fail') st.lots = st.lots.filter((x) => x !== l);
      else l.w = 'burn';
      save();
    }
    for (const sale of st.sales.filter((x) => x.st === 'wait')) {
      for (const id in sale.burn)
        if (sale.burn[id] === 'take' || sale.burn[id] === 'burn')
          sale.burn[id] = takeState(`msell-${sale.id}-${id}`, sale.burn[id]);
      save();
      saleStep(sale).catch((e) => log.error('market sale', sale.id, e.message));
    }
    // items owed: one the chain queue already has was handed over before the stop
    if (st.gives.length) {
      st.gives = st.gives.filter((g) => opState(g.op) == null);
      save();
      giveAll();
    }
    if (st.orders.some((o) => o.st === 'wait' || o.st === 'gone')) kick(1000);
    paySoon(2000);
  }

  // ---- the calls: refused while the market is shut (its file unreadable) or stopping; counted while they run, so a
  // stop can wait for them
  let live = 0,
    idleWake = null;
  const shut = () =>
    broken ? { error: 'market closed', code: 503 } : closing ? { error: 'restarting', code: 503 } : null;
  const call =
    (fn) =>
    async (...a) => {
      const no = shut();
      if (no) return no;
      live++;
      try {
        return await fn(...a);
      } finally {
        if (!--live && idleWake) idleWake();
      }
    };
  const callNow =
    (fn) =>
    (...a) =>
      shut() || fn(...a);
  // a stop: no new calls, then the calls running, the sweep, the items owed, the payout being sent (its hash is on disk
  // by then, so a stop that can't wait for it loses nothing) and the file
  async function close() {
    closing = true;
    clearTimeout(timer);
    clearTimeout(payT);
    clearTimeout(giveT);
    if (live) await new Promise((r) => (idleWake = r));
    if (busy) await busy;
    if (giving) await giving;
    if (paying) await paying;
    if (dirty && !writing) save();
    await flushed();
  }
  return {
    list: call(list),
    cancel: call(cancel),
    sell: call(sell),
    quote: call(quote),
    submit: call(submit),
    unbid: callNow(unbid),
    drop: callNow(drop),
    burnt,
    unbacked: (lotId) => burnt('mlist-' + lotId, false),
    fills,
    tokens,
    order,
    view,
    mine,
    sweep,
    payAll,
    close,
    broken: () => broken,
    // (the tests)
    state: () => st,
    idle: () => !busy && !paying && !writing && !giving,
    flushed,
    stop() {
      clearTimeout(timer);
      clearTimeout(payT);
      clearTimeout(giveT);
    },
  };
}
