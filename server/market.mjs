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
//   nothing by the deadline (and a grace): the lots let go; the order is still looked at for a day, and a payment that
//                    lands after all is filled from the same lots if they are still there, else paid back in USDC
// A payout is USDC from the treasury to the receiver's NEAR account (from its account when that holds enough, else
// withdrawn from its NEAR Intents balance; the receiver's USDC storage paid if they lack it), one at a time, tried again
// until the chain answers. Without a treasury key the payouts wait in the queue.
//
// Kept in DATA_DIR/market.json: { seq, lots, orders, pays, trades, fees }. Money in whole cents (prices) and micro-USDC
// (what moves on chain: a cent is 10 000 of them).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', // (USDC on NEAR, Circle's)
  USDC_ASSET = 'nep141:' + USDC,
  FEE_BP = 250, // the market's fee, in basis points of the seller's sum
  MIN_CENTS = 100, // the least a purchase may come to (one sale costs the chain ~0.003 NEAR)
  PRICE_MAX = 1e6, // cents a piece at most ($10 000)
  LOT_MAX = 999, // pieces in one lot
  LOTS_MAX = 40, // lots one seller may have up at once
  OPEN_MAX = 2, // orders one buyer may have waiting at once (each holds lots)
  BIDS_MAX = 20, // bids one buyer may have open at once
  HOLD_MS = 10 * 60e3, // how long an order holds its lots: the quote's deadline
  SLOW_HOLD_MS = 45 * 60e3, // the same for coins whose chains confirm slowly
  GRACE_MS = 3 * 60e3, // after the deadline, before the lots are let go
  LATE_MS = 24 * 3600e3, // an order let go is still looked at this long (a payment landing late)
  TRADES_KEEP = 2000,
  DONE_KEEP = 7 * 864e5; // ms a finished order or a payout is kept for its status
// chains that take long to confirm a deposit (their orders hold the lots longer), and the least 1Click takes from some
// (its "swap limits": a quote under them is refused)
const SLOW = new Set(['btc', 'ltc', 'doge', 'bch', 'dash', 'zec', 'cardano']),
  CHAIN_MIN = { bsc: 100000, tron: 10000 };
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
// items: the ids that can be listed; take(acc, id, n, op) → null or an error text (the items off the seller's stash and
// wallet); give(acc, { id: n }, op) (onto the buyer's or back to the seller's); treasury: the account the payments go
// to (null: no payments, quotes refused); payout({ id, acc, micro, why }) → { ok: true, tx } | { ok: false, why } (the
// chain refused it for good) or { unknown: true, tx } (sent, outcome not known) or throws (not sent: tried again later)
export function makeMarket({
  dataDir,
  items,
  oneclick,
  treasury = null,
  ready = () => true, // (the treasury able to take payments now: on chain, with gas, its USDC storage paid)
  take,
  give,
  payout = null,
  referral = 'meowdivision',
  now = now0,
  pollMs = 8e3,
  log = console,
}) {
  const file = path.join(dataDir, 'market.json'),
    known = new Set(items);
  // (bids: offers to buy at one's own price, [{ id, b, it, n, n0, p, at, ord, st }], it 'all' for any item (a collection
  // bid, as on HOT Craft). A bid is paid first, as a purchase is (its order: kind 'bid'); the money waits in the treasury
  // until a seller sells into it (sell(): the items to the bidder, the seller paid at once) or the bidder takes it down
  // (unbid(): what is left back in USDC). st 'open' | 'done' | 'gone')
  let st = { seq: 0, lots: [], orders: [], pays: [], trades: [], fees: 0, bids: [] };
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r && Array.isArray(r.lots)) st = { ...st, ...r };
  } catch {}
  // a payout in flight when the server stopped: a USDC transfer carries no op id, so it is never sent again blindly; it
  // waits as 'stuck' for a look by hand (its transaction, if any, on the explorer)
  for (const p of st.pays)
    if (p.st === 's') {
      p.st = 'stuck';
      log.error(`market payout ${p.id} to ${p.acc} was in flight at a restart: check it by hand`);
    }
  let dirty = false,
    writing = null;
  const save = () => {
    dirty = true;
    if (!writing) writing = Promise.resolve().then(flush);
  };
  async function flush() {
    while (dirty) {
      dirty = false;
      const t = now();
      st.orders = st.orders.filter((o) => !o.end || t - o.end < DONE_KEEP);
      st.pays = st.pays.filter((p) => p.st === 'q' || p.st === 's' || t - p.at < DONE_KEEP);
      st.bids = st.bids.filter((x) => x.st === 'open' || t - (x.end || x.at) < DONE_KEEP);
      if (st.trades.length > TRADES_KEEP) st.trades = st.trades.slice(-TRADES_KEEP);
      const tmp = file + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(st));
      await fs.promises.rename(tmp, file);
    }
    writing = null;
  }
  const lotOf = (id) => st.lots.find((l) => l.id === id);
  const free = (l) => l.n - l.held;
  const orderOf = (id) => st.orders.find((o) => o.id === id);

  // ---- selling
  // a lot: n of item id at price cents a piece; the items leave the seller's stash first
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
    };
    const err = await take(acc, id, n, 'mlist-' + lot.id);
    if (err) return { error: err };
    st.lots.push(lot);
    save();
    return { lot: lotView(lot) };
  }
  // the lot's pieces not held by an order back to the seller (those held come back if their order falls through)
  async function cancel(acc, lotId) {
    const l = lotOf(lotId);
    if (!l || l.s !== acc) return { error: 'no such lot' };
    const k = free(l);
    if (k <= 0) return { error: 'held by a purchase' };
    l.n -= k;
    if (l.n <= 0) st.lots = st.lots.filter((x) => x !== l);
    save();
    await give(acc, { [l.it]: k }, `mcancel-${l.id}-${l.n}`);
    return { back: k };
  }
  // a lot whose items the wallet turned out not to hold (its burn refused: sent away before): its free pieces gone
  function unbacked(lotId) {
    const l = lotOf(lotId);
    if (!l) return;
    l.n = l.held;
    if (l.n <= 0) st.lots = st.lots.filter((x) => x !== l);
    log.warn(`market: lot ${lotId} of ${l.s} not on the wallet, taken down`);
    save();
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
        (l) => (id === 'all' || l.it === id) && l.s !== acc && free(l) > 0 && l.p <= max && (!lot || l.id === lot),
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
  // the coin's chain from its asset id as the token list has it (tokens(): kept from /v0/tokens)
  let tokCache = null,
    tokAt = 0;
  async function tokens() {
    if (tokCache && now() - tokAt < 30 * 60e3) return tokCache;
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
    return tokCache || [];
  }
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
      if (!l || free(l) <= 0) return { error: 'no such lot' };
      if (l.s === acc) return { error: 'your own lot' };
      id = l.it;
    }
    if (id !== 'all' && !known.has(id)) return { error: 'no such item' };
    if (!Number.isSafeInteger(n) || n < 1 || n > LOT_MAX * 10) return { error: 'bad amount' };
    if (typeof asset !== 'string' || asset.length > 200) return { error: 'bad coin' };
    if (refundTo != null && (typeof refundTo !== 'string' || !/^[\w.:-]{2,128}$/.test(refundTo)))
      return { error: 'bad refund address' };
    if (st.orders.filter((o) => o.b === acc && o.st === 'wait').length >= OPEN_MAX)
      return { error: 'too many open orders' };
    const tok = (await tokens()).find((t) => t.a === asset);
    if (!tok) return { error: 'bad coin' };
    const fl =
      bid != null
        ? { fills: [], sum: n * bid, short: 0 }
        : fills(acc, id, n, cents(max) ? max : PRICE_MAX, lot || null);
    if (fl.short > 0) return { error: 'not enough on sale', have: n - fl.short };
    if (fl.sum < MIN_CENTS) return { error: 'below minimum', min: MIN_CENTS };
    if (tok.min && fl.sum < tok.min) return { error: 'below minimum', min: tok.min };
    const t = now(),
      until = t + (SLOW.has(tok.c) ? SLOW_HOLD_MS : HOLD_MS),
      o = {
        id: 'O' + ++st.seq + crypto.randomBytes(3).toString('hex'),
        b: acc,
        it: id,
        n,
        fills: fl.fills,
        cents: fl.sum,
        micro: fl.sum * 1e4,
        asset,
        sym: tok.s,
        chain: tok.c,
        at: t,
        until,
        st: 'new',
        ...(bid != null ? { kind: 'bid', p: bid } : {}),
      };
    hold(o.fills, 1); // (held before the quote's await: no other order takes the same pieces meanwhile)
    st.orders.push(o);
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
      hold(o.fills, -1);
      st.orders = st.orders.filter((x) => x !== o);
      save();
      const m = /at least (\d+)/.exec(e.message); // ("Amount is too low for bridge, try at least 4600947": micro-USDC)
      if (m) return { error: 'below minimum', min: Math.ceil(+m[1] / 1e4) };
      log.warn('market quote', acc, asset, e.message);
      return { error: e.code === 400 ? 'coin refused' : 'intents out of reach', why: e.message };
    }
    const qq = (q && q.quote) || {};
    if (!qq.depositAddress) {
      hold(o.fills, -1);
      st.orders = st.orders.filter((x) => x !== o);
      save();
      return { error: 'intents out of reach' };
    }
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
    o.st = 'wait';
    save();
    kick();
    return { order: orderView(o) };
  }
  // a deposit's transaction hash told to 1Click (it then looks at once, not at its next sweep of the chain)
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
    if (o.seen && o.seen !== 'PENDING_DEPOSIT') return { error: 'payment on its way' };
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
  // the order paid: the items to the buyer, the lots' pieces sold, each seller's share queued
  async function settle(o, details) {
    if (o.kind === 'bid') return openBid(o, details);
    hold(o.fills, -1);
    for (const f of o.fills) {
      const l = lotOf(f.lot);
      if (l) {
        l.n -= f.n;
        if (l.n <= 0) st.lots = st.lots.filter((x) => x !== l);
      }
    }
    const share = {};
    for (const f of o.fills) {
      share[f.s] = (share[f.s] || 0) + f.n * f.p;
      st.trades.push({ at: now(), it: f.it || o.it, n: f.n, p: f.p, s: f.s, b: o.b, o: o.id });
    }
    let paid = 0;
    for (const [s, c] of Object.entries(share)) {
      const micro = Math.floor((c * 1e4 * (10000 - FEE_BP)) / 10000);
      paid += micro;
      st.pays.push({
        id: `P${o.id}-${st.pays.length}`,
        acc: s,
        micro,
        ord: o.id,
        why: 'sale',
        st: 'q',
        tries: 0,
        next: 0,
        at: now(),
      });
    }
    st.fees += o.micro - paid;
    o.st = 'done';
    o.end = now();
    o.out = details
      ? { in: details.amountInFormatted || null, tx: (details.nearTxHashes || []).slice(-1)[0] || null }
      : null;
    save();
    await give(o.b, itemsOf(o), 'mbuy-' + o.id);
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
  // meanwhile: 'bids changed', nothing sold. The bids are taken first (no other seller gets them meanwhile), then the
  // items leave the seller's stash; the items to the bidders, the seller's 97.5% queued at once
  async function sell(acc, { fills: want }) {
    if (!treasury || !ready()) return { error: 'payments off' };
    if (!Array.isArray(want) || !want.length || want.length > 100) return { error: 'bad fills' };
    const out = [], // [{ bid, it, n, p, b }]
      used = new Map();
    for (const f of want) {
      const k = f && f.n;
      if (!f || !known.has(f.it) || !Number.isSafeInteger(k) || k < 1 || k > LOT_MAX * 10)
        return { error: 'bad fills' };
      const x = typeof f.bid === 'string' && st.bids.find((y) => y.id === f.bid);
      if (!x || x.st !== 'open' || x.b === acc || (x.it !== 'all' && x.it !== f.it)) return { error: 'bids changed' };
      used.set(x, (used.get(x) || 0) + k);
      if (used.get(x) > x.n) return { error: 'bids changed' };
      out.push({ bid: x, it: f.it, n: k, p: x.p, b: x.b });
    }
    const sid = 'S' + ++st.seq + crypto.randomBytes(3).toString('hex');
    for (const f of out) f.bid.n -= f.n; // (taken now: the awaits below can't let another seller in)
    save();
    const per = {};
    for (const f of out) per[f.it] = (per[f.it] || 0) + f.n;
    const taken = [];
    for (const [id, k] of Object.entries(per)) {
      const err = await take(acc, id, k, `msell-${sid}-${id}`);
      if (err) {
        // (back to the bids; one taken down meanwhile: its share back to its bidder in USDC)
        for (const f of out)
          if (f.bid.st === 'open') f.bid.n += f.n;
          else
            st.pays.push({
              id: `P${f.bid.id}-r${st.pays.length}`,
              acc: f.b,
              micro: f.n * f.p * 1e4,
              ord: f.bid.ord,
              why: 'refund',
              st: 'q',
              tries: 0,
              next: 0,
              at: now(),
            });
        save();
        for (const [tid, tk] of taken) await give(acc, { [tid]: tk }, `msellback-${sid}-${tid}`);
        paySoon();
        return { error: err };
      }
      taken.push([id, k]);
    }
    const toBuyer = {};
    let sum = 0;
    for (const f of out) {
      if (f.bid.n <= 0 && f.bid.st === 'open') ((f.bid.st = 'done'), (f.bid.end = now()));
      const g = (toBuyer[f.b] ||= {});
      g[f.it] = (g[f.it] || 0) + f.n;
      sum += f.n * f.p;
      st.trades.push({ at: now(), it: f.it, n: f.n, p: f.p, s: acc, b: f.b, o: sid });
    }
    const micro = Math.floor((sum * 1e4 * (10000 - FEE_BP)) / 10000);
    st.pays.push({ id: `P${sid}`, acc, micro, ord: sid, why: 'sale', st: 'q', tries: 0, next: 0, at: now() });
    st.fees += sum * 1e4 - micro;
    save();
    for (const [b, it] of Object.entries(toBuyer)) await give(b, it, `mbid-${sid}-${b}`);
    paySoon();
    return { sold: { id: sid, n: out.reduce((a, f) => a + f.n, 0), cents: sum, micro } };
  }
  // a bid taken down by its bidder: what is left of it back to them in USDC
  function unbid(acc, bidId) {
    const x = st.bids.find((y) => y.id === bidId);
    if (!x || x.b !== acc || x.st !== 'open') return { error: 'no such bid' };
    const k = x.n;
    x.n = 0;
    x.st = 'gone';
    x.end = now();
    if (k > 0)
      st.pays.push({
        id: `P${x.id}-r`,
        acc,
        micro: k * x.p * 1e4,
        ord: x.ord,
        why: 'refund',
        st: 'q',
        tries: 0,
        next: 0,
        at: now(),
      });
    save();
    paySoon();
    return { back: k * x.p };
  }
  // a payment that landed after the order let its lots go: the same pieces again if still free, else the money back
  async function late(o, details) {
    const ok = o.fills.every((f) => {
      const l = lotOf(f.lot);
      return l && free(l) >= f.n && l.p === f.p;
    });
    if (ok) {
      hold(o.fills, 1);
      return settle(o, details);
    }
    o.st = 'back';
    o.end = now();
    st.pays.push({
      id: `P${o.id}-r`,
      acc: o.b,
      micro: o.micro,
      ord: o.id,
      why: 'refund',
      st: 'q',
      tries: 0,
      next: 0,
      at: now(),
    });
    log.warn(`market: order ${o.id} paid late, its lots gone: ${o.micro / 1e6} USDC back to ${o.b}`);
    save();
    paySoon();
  }
  const letGo = (o, s) => {
    if (o.st === 'wait') hold(o.fills, -1);
    o.st = s;
    o.end = now();
    save();
  };
  // one look at an order's state on 1Click
  async function look(o) {
    let r;
    try {
      r = await oneclick.status(o.dep.addr, o.dep.memo);
    } catch (e) {
      if (o.st === 'wait' && now() > o.until + GRACE_MS && e.code === 404) letGo(o, 'gone');
      return;
    }
    // (an answer about another quote than ours: ignored)
    const qr = r && r.quoteResponse && r.quoteResponse.quoteRequest;
    if (qr && (qr.recipient !== treasury || qr.amount !== String(o.micro)))
      return log.warn('market: status of', o.id, 'not ours');
    const s = r && r.status;
    o.seen = s;
    if (s === 'SUCCESS') return o.st === 'wait' ? settle(o, r.swapDetails) : late(o, r.swapDetails);
    if (s === 'REFUNDED' || s === 'FAILED') {
      if (o.st === 'wait') letGo(o, s === 'REFUNDED' ? 'refunded' : 'failed');
      else ((o.st = s === 'REFUNDED' ? 'refunded' : 'failed'), save());
      return;
    }
    // PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, INCOMPLETE_DEPOSIT: on its way. Nothing at all by the deadline: let go
    if (o.st === 'wait' && s === 'PENDING_DEPOSIT' && now() > o.until + GRACE_MS) letGo(o, 'gone');
    else save();
  }
  let timer = null,
    busy = false;
  function kick(ms = pollMs) {
    clearTimeout(timer);
    timer = setTimeout(sweep, ms);
    if (timer.unref) timer.unref();
  }
  async function sweep() {
    if (busy) return kick();
    busy = true;
    try {
      const t = now();
      for (const o of st.orders) {
        if (!o.dep) continue;
        // waiting: every sweep; let go (no payment by its deadline): once a minute for a day
        if (o.st === 'wait' || (o.st === 'gone' && t - o.end < LATE_MS && (!o.lk || t - o.lk > 60e3))) {
          o.lk = t;
          await look(o);
        }
      }
    } catch (e) {
      log.error('market sweep', e.message);
    } finally {
      busy = false;
    }
    if (st.orders.some((o) => o.st === 'wait' || (o.st === 'gone' && now() - o.end < LATE_MS))) kick();
  }
  // an order whose quote was still being asked for at a restart: never shown to its buyer, so its lots are let go (the
  // waiting ones keep theirs: held is kept with the lots, and the sweep goes on)
  if (st.orders.some((o) => o.st === 'new')) {
    for (const o of st.orders.filter((x) => x.st === 'new')) hold(o.fills, -1);
    st.orders = st.orders.filter((o) => o.st !== 'new');
    save();
  }

  // ---- payouts: USDC from the treasury, one at a time
  let paying = false,
    payT = null;
  function paySoon(ms = 0) {
    if (!payout) return;
    clearTimeout(payT);
    payT = setTimeout(payAll, ms);
    if (payT.unref) payT.unref();
  }
  async function payAll() {
    if (paying || !payout) return;
    paying = true;
    try {
      for (;;) {
        const t = now(),
          p = st.pays.find((x) => x.st === 'q' && x.next <= t);
        if (!p) {
          const later = st.pays.filter((x) => x.st === 'q').map((x) => x.next);
          if (later.length) paySoon(Math.max(1000, Math.min(...later) - t));
          break;
        }
        p.st = 's';
        save();
        let out = null,
          err = null;
        try {
          out = await payout(p);
        } catch (e) {
          err = e;
        }
        p.at = now();
        if (out && out.ok) {
          p.st = 'done';
          p.tx = out.tx || null;
        } else if (out && out.unknown) {
          // (sent, but its outcome not known even after following it: never sent twice; a look by hand)
          p.st = 'stuck';
          p.tx = out.tx || null;
          log.error(`market payout ${p.id} to ${p.acc}: outcome not known (${p.tx}), check it by hand`);
        } else if (out && out.ok === false) {
          p.st = 'fail';
          p.err = String(out.why || '').slice(0, 300);
          log.error(`market payout ${p.id} to ${p.acc} refused: ${p.err}`);
        } else {
          // (refused before it was sent: the RPC down, the key not ready; again later)
          p.st = 'q';
          p.tries++;
          p.err = String((err && err.message) || 'outcome not known').slice(0, 300);
          p.next = now() + Math.min(600e3, 5e3 * 2 ** Math.min(7, p.tries));
          if (p.tries > 3) log.warn(`market payout ${p.id} try ${p.tries}: ${p.err}`);
        }
        save();
      }
    } finally {
      paying = false;
    }
  }

  // ---- what the pages see
  const lotView = (l) => ({ id: l.id, s: l.s, it: l.it, n: l.n, free: free(l), p: l.p, at: l.at });
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
    sym: o.sym,
    chain: o.chain,
    asset: o.asset,
    dep: o.dep ? { addr: o.dep.addr, memo: o.dep.memo, in: o.dep.in, inF: o.dep.inF, d: o.dep.d } : null,
    refund: o.refund || null,
    out: o.out || null,
  });
  const DAY = 864e5;
  // the whole market in one answer: every lot on sale (cheapest first; the site's shelf, each lot its own card and
  // link), per item its asks (by price and seller), its last trades, 14 days of prices; every open bid; totals
  function view() {
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
    for (const l of st.lots) {
      const b = by[l.it],
        k = free(l);
      if (!b || k <= 0) continue;
      b.listed += k;
      let lv = b.asks.find((a) => a.p === l.p && a.s === l.s);
      if (!lv) b.asks.push((lv = { p: l.p, n: 0, s: l.s }));
      lv.n += k;
    }
    const days = 14,
      d0 = Math.floor(t / DAY) - days + 1;
    for (const id in by) {
      const b = by[id];
      b.asks.sort((a, c) => a.p - c.p);
      b.floor = b.asks.length ? b.asks[0].p : null;
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
    for (const id in by) {
      const b = by[id];
      for (const h of b.hist) h.avg = h.n ? Math.round(h.vol / h.n) : null;
      b.tr = b.tr.slice(-12).reverse();
      b.sold7 = b.hist.slice(-7).reduce((s, h) => s + h.n, 0);
      if (b.last != null && old[id] != null) b.chg = Math.round(((b.last - old[id]) / old[id]) * 1000) / 10;
    }
    const sellers = new Set(st.lots.filter((l) => free(l) > 0).map((l) => l.s)).size,
      floors = Object.values(by)
        .map((b) => b.floor)
        .filter((x) => x != null);
    return {
      fee: FEE_BP,
      min: MIN_CENTS,
      on: !!treasury && ready(),
      treasury,
      // (a lot wholly held by a purchase being paid: n 0; its link says so, the shelf leaves it out)
      lots: st.lots
        .filter((l) => free(l) > 0 || l.held > 0)
        .sort((a, b) => a.p - b.p || a.at - b.at)
        .map((l) => ({ id: l.id, s: l.s, it: l.it, n: free(l), held: l.held, p: l.p, at: l.at })),
      items: Object.values(by),
      // (the bids: each one, dearest first; it 'all' for any item)
      bids: st.bids
        .filter((x) => x.st === 'open' && x.n > 0)
        .sort((a, c) => c.p - a.p || a.at - c.at)
        .map((x) => ({ id: x.id, b: x.b, it: x.it, n: x.n, p: x.p, at: x.at })),
      trades: st.trades
        .slice(-60)
        .reverse()
        .map((x) => ({ at: x.at, it: x.it, n: x.n, p: x.p, s: x.s, b: x.b })),
      totals: {
        floor: floors.length ? Math.min(...floors) : null,
        vol24,
        sold24,
        listed: Object.values(by).reduce((s, b) => s + b.listed, 0),
        sellers,
      },
    };
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
          tx: p.tx || null,
          at: p.at,
        })),
    };
  }
  function order(acc, id) {
    const o = orderOf(id);
    return o && o.b === acc ? orderView(o) : null;
  }
  if (st.orders.some((o) => o.st === 'wait' || o.st === 'gone')) kick(1000);
  paySoon(2000);
  return {
    list,
    cancel,
    unbacked,
    sell,
    unbid,
    fills,
    tokens,
    quote,
    submit,
    drop,
    order,
    view,
    mine,
    sweep,
    payAll,
    // (the tests)
    state: () => st,
    idle: () => !busy && !paying && !writing,
    stop() {
      clearTimeout(timer);
      clearTimeout(payT);
    },
  };
}
