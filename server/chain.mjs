// server/chain.mjs — the players' items on their wallets (docs/chain.md, "Run end", "Sell" and "Walt's wallet"): what
// a wallet account gets (a run's loot once the server has played it again, the first sign-in's proven guest items) and
// loses (a sale to Walt) is sent to the items contract by the server's own key: `game_mint` and `game_burn`, each with
// an op id the contract applies once. A purchase from Walt is his own doing: his key hands the items over from his
// wallet (`market_give`, a request id applied once); without his key, or when he can't (his wallet short of it, his
// key out of allowance), the game's key mints it instead (the server's onFail). The player signs nothing, pays nothing.
//
// Walt's wallet holds his shelf (server/walt.mjs): mirror() reads it and mints what it lacks, burns what it holds
// beyond the shelf (the game's key), a while after a trade and every 10 minutes. A sale to him reaches his wallet that
// way, in a batch, and so do the other players' days (their trades, the day's decay).
//
// A queue, kept in DATA_DIR/chain.json so a restart loses nothing, sent one transaction at a time. An account's
// change joins its last queued one of the same kind (one transaction for a burst of sales) if that one was never sent,
// never one before a change of another kind (a sale of something still on its way waits behind it). A send the chain
// answered is done (applied, or applied before: the same op id twice changes nothing); one it refused (a sale of more
// than the wallet holds: the player moved items away) is failed, and the next look at the wallet sets the stash to
// what is there; an RPC down or a send whose outcome isn't known is tried again later with the same op id.
//
// The wallet is the truth for a wallet account's items: sync() reads its balances and sets the stash to them plus what
// is still on its way: a change not done yet, or done in a block after the one the balances were read at (its height
// from the outcome; not known, a change done in the last LAG ms). The first look at an account sends it what its
// stash held from before (op `sync-<account>`).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RpcError } from './near.mjs';

const KEEP = 2 * 864e5, // ms a done or failed change is kept for its status
  TRIES = 30, // sends of one change before it is failed for good
  BACKOFF = [2e3, 5e3, 15e3, 30e3, 60e3, 120e3, 300e3],
  MIRROR_EVERY = 10 * 60e3, // ms between looks at Walt's wallet with no trade in between
  SAVE_RETRY = 2000, // ms before a failed write of the queue's file is tried again
  BALANCES_KEEP = 2500, // ms a wallet's balances just read serve the page's next looks (soon(), below)
  SEEN_MAX = 5000; // accounts' reads kept before the old ones are swept
// the gas attached to a call of n token ids. Measured on the sandbox (contract/tests/items.rs, what_sending_items_costs
// and what_walt_costs): 2.6–3.0 Tgas for one kind, about 0.23 more a kind, 9.5 for all 31 at once; this leaves 1.6–2×
// on top. A function-call key's allowance is charged for the gas attached, not the gas burnt, so it is kept close
export const gasFor = (n) => Math.min(100e12, 5e12 + 0.4e12 * Math.max(1, n));
// a send Walt's key can't make at all (its allowance used up, the key gone or not allowed the method): the purchase
// is failed at once, so the game's key sends it instead (onFail)
const HOPELESS =
  /NotEnoughAllowance|AccessKeyNotFound|InvalidAccessKey|MethodNameMismatch|ReceiverMismatch|NotEnoughBalance|RequiresFullAccess|signer key|signer refuses/;

// walt: { acc: his account, signer: his key's signer (or null: purchases minted by the game's key), stock: () => his
// shelf { id: n } } or null (no wallet for Walt)
export function makeChain({
  dataDir,
  near,
  signer,
  contract,
  tokens,
  on,
  lag = 20e3,
  walt = null,
  mirrorMs = 30e3,
  onFail = () => {},
  log = console,
}) {
  let keepMs = BALANCES_KEEP;
  const LAG = lag; // ms a change just done still counts as on its way when its block isn't known
  const W = walt && walt.acc ? walt : null;
  const file = path.join(dataDir, 'chain.json');
  const ALL = [...tokens]; // every token id the contract knows (economy.js items)
  const known = new Set(ALL);
  let st = { q: [] };
  try {
    st = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(st.q)) st = { q: [] };
  } catch {}
  // a change in flight when the server stopped: sent again (its op id makes it safe)
  for (const c of st.q) if (c.st === 's') c.st = 'q';
  let dirty = false,
    writing = null,
    timer = null,
    busy = false;
  // the queue kept on disk, one write at a time. A write that fails (the disk full, the folder gone) is logged and tried
  // again a while later, the queue still whole in memory: it must neither end the process (a promise failing unseen
  // does) nor leave the file stale for good
  const save = () => {
    dirty = true;
    flush();
  };
  function flush() {
    if (writing || !dirty) return;
    writing = flushFile()
      .catch((e) => {
        dirty = true;
        log.warn(`chain: the queue not saved (${st.q.length} changes, ${file}), again in ${SAVE_RETRY} ms:`, e.message);
        const t = setTimeout(flush, SAVE_RETRY);
        if (t.unref) t.unref();
      })
      .finally(() => {
        writing = null;
      });
  }
  async function flushFile() {
    while (dirty) {
      dirty = false;
      const now = Date.now();
      st.q = st.q.filter((c) => c.st === 'q' || c.st === 's' || now - c.at < KEEP);
      const tmp = file + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(st));
      await fs.promises.rename(tmp, file);
    }
  }
  const clean = (items) => {
    const out = {};
    for (const [id, n] of Array.isArray(items) ? items : Object.entries(items || {}))
      if (known.has(id) && Number.isSafeInteger(n) && n > 0) out[id] = (out[id] || 0) + n;
    return out;
  };
  // a change touches the account it goes to (or is taken from), and Walt's for a purchase he hands over
  const touches = (c, acc) => c.acc === acc || c.from === acc;
  // a change: k 'mint' (to the wallet), 'burn' (from it) or 'give' (to it from Walt's), items [[id, n], …] or
  // { id: n }, op its id (unique); coins: what a sale paid for it (taken back by onFail if the wallet turns out not to
  // hold the items)
  function add(acc, k, items, op, coins = 0) {
    if (!on || !signer) return null;
    if (k === 'give' && !(W && W.signer)) k = 'mint'; // (no key for Walt: the game's key sends the purchase)
    const it = clean(items);
    if (!Object.keys(it).length) return null;
    // an op id is one change, whoever asks twice (a run's result written again after a failed write of its account: its
    // loot is already here, and joined to a waiting change a second time it would be minted twice)
    if (st.q.some((c) => (c.ops || []).includes(op))) return op;
    const now = Date.now(),
      last = [...st.q].reverse().find((c) => touches(c, acc) && (c.st === 'q' || c.st === 's'));
    // (never into one sent before: its outcome unknown, it may have gone through with its first items only)
    if (last && last.st === 'q' && !last.tries && last.acc === acc && last.k === k && last.ops.length < 50) {
      for (const id in it) last.items[id] = (last.items[id] || 0) + it[id];
      last.ops.push(op);
      last.coins = (last.coins || 0) + coins;
      last.at = now;
    } else
      st.q.push({
        id: op.slice(0, 60),
        acc,
        k,
        items: it,
        ops: [op],
        st: 'q',
        tries: 0,
        at: now,
        next: 0,
        coins,
        ...(k === 'give' ? { from: W.acc } : {}),
      });
    save();
    kick();
    return op;
  }
  function kick(ms = 0) {
    if (busy || !on || !signer) return;
    clearTimeout(timer);
    timer = setTimeout(work, ms);
  }
  async function work() {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const now = Date.now(),
          c = st.q.find((x) => x.st === 'q');
        if (!c) break;
        if (c.next > now) {
          busy = false;
          return kick(c.next - now);
        }
        c.st = 's';
        save();
        const ids = Object.keys(c.items).sort(),
          amounts = ids.map((id) => String(c.items[id])),
          give = c.k === 'give',
          by = give ? W && W.signer : signer,
          [method, args] =
            c.k === 'mint'
              ? ['game_mint', { receiver_id: c.acc, token_ids: ids, amounts, run_id: c.id }]
              : c.k === 'burn'
                ? ['game_burn', { owner_id: c.acc, token_ids: ids, amounts, op_id: c.id }]
                : ['market_give', { receiver_id: c.acc, token_ids: ids, amounts, request_id: c.id }];
        let out = null,
          err = null;
        try {
          if (!by) throw new Error('no signer key for ' + c.k);
          out = await by.call(contract, method, args, { gas: gasFor(ids.length) });
        } catch (e) {
          err = e;
        }
        const errText = err ? (err instanceof RpcError ? err.text : String(err.message || err)) : '';
        if (out && out.ok) {
          c.tx = out.hash;
          c.again = out.value === false ? 1 : 0; // (applied before: the same op id)
          c.h = out.block ? await near.heightOf(out.block) : null; // (a view at this height or later shows it)
          c.at = Date.now();
          c.st = 'done';
          seen.delete(c.acc); // (the wallets it changed: read anew at the page's next look)
          if (c.from) seen.delete(c.from);
        } else if ((out && out.ok === false) || (give && HOPELESS.test(errText))) {
          c.at = Date.now();
          c.tx = out ? out.hash : null;
          c.why = (out ? String(out.failure || '') : errText).slice(0, 300);
          log.warn(`chain ${c.k} ${c.id} for ${c.acc} refused: ${c.why}`);
          try {
            // (a sale of items the wallet no longer held: its coins back, before it counts as settled; a purchase Walt
            // couldn't hand over: minted instead)
            await onFail(c);
          } catch (e) {
            log.error('chain onFail', c.id, e.message);
          }
          c.st = 'fail';
        } else {
          // the RPC down, the key refused, or the outcome not known in time: again later, the same op id
          c.at = Date.now();
          c.tries++;
          c.why = err ? errText.slice(0, 300) : 'outcome not known';
          if (c.tries >= TRIES) {
            c.st = 'fail';
            log.error(`chain ${c.k} ${c.id} for ${c.acc} given up: ${c.why}`);
          } else {
            c.st = 'q';
            c.next = Date.now() + BACKOFF[Math.min(BACKOFF.length - 1, c.tries - 1)];
            if (c.tries > 2) log.warn(`chain ${c.k} ${c.id} try ${c.tries}: ${c.why}`);
          }
        }
        save();
      }
    } finally {
      busy = false;
    }
  }
  // what an account's wallet is still to get (+) or lose (−): its changes not done yet, and those done after the block
  // its balances were read at (height; not known: done in the last LAG ms)
  function pending(acc, height = null) {
    const now = Date.now(),
      d = {};
    for (const c of st.q) {
      const sign = c.acc === acc ? (c.k === 'burn' ? -1 : 1) : c.from === acc ? -1 : 0;
      if (!sign) continue;
      const due =
        c.st === 'q' || c.st === 's' || (c.st === 'done' && (c.h && height ? c.h > height : now - c.at < LAG));
      if (due) for (const id in c.items) d[id] = (d[id] || 0) + sign * c.items[id];
    }
    return d;
  }
  // no sale of the account still waiting for its burn (its coins not to be spent before the wallet confirms it)
  const salesSettled = (acc) =>
    !st.q.some((c) => c.acc === acc && c.k === 'burn' && c.coins > 0 && (c.st === 'q' || c.st === 's'));
  // the page's view: on, the account's changes of late (newest first: their op ids, kind, items, state, transaction),
  // what is on its way to the wallet (height: the block its balances were just read at, if known)
  function status(acc, height = null) {
    const ops = st.q
      .filter((c) => c.acc === acc)
      .slice(-20)
      .reverse()
      .map((c) => ({ ops: c.ops, k: c.k, items: c.items, st: c.st === 's' ? 'q' : c.st, tx: c.tx || null }));
    return { on: !!(on && signer), contract, pend: pending(acc, height), ops };
  }
  // the wallet's balances of every item, or null (the RPC down); its `at`: the height of the block they were read at
  async function balances(acc) {
    try {
      const { value: r, height } = await near.viewAt(contract, 'mt_batch_balance_of', {
        account_id: acc,
        token_ids: ALL,
      });
      const b = {};
      ALL.forEach((id, i) => {
        const n = Number(r[i] || 0);
        if (n > 0) b[id] = n;
      });
      Object.defineProperty(b, 'at', { value: height });
      return b;
    } catch (e) {
      log.warn('chain balances', acc, e.message);
      return null;
    }
  }
  // the same for the page's own looks (GET /api/save, /api/chain: every open page asks again and again, and each look
  // was a view call of its own): one read serves the looks of the next keepMs and those that come while it is on its
  // way. Safe to be that old: sync() adds what changed after the block the balances were read at (pending(acc,
  // bal.at)), and a change of the account done meanwhile drops them. A sale never reads these (balances(): anew)
  const seen = new Map(); // account → { p: its balances' promise, at: when asked }
  function soon(acc) {
    const now = Date.now(),
      had = seen.get(acc);
    if (had && now - had.at < keepMs) return had.p;
    const e = { p: balances(acc), at: now };
    seen.set(acc, e);
    e.p.then((b) => {
      if (!b && seen.get(acc) === e) seen.delete(acc); // (the RPC down: asked again at the next look)
    });
    if (seen.size > SEEN_MAX) for (const [k, v] of seen) if (now - v.at >= keepMs) seen.delete(k);
    return e.p;
  }
  // the stash set to the wallet (rec: the account's record, its save.items and rec.chain changed in place; the caller
  // keeps it). The first time: what the stash held beyond the wallet is sent to it first. Returns true if it changed.
  function sync(acc, rec, bal) {
    if (!on || !signer || !bal) return false;
    const items = rec.save.items || (rec.save.items = {}),
      pend = pending(acc, bal.at);
    if (!rec.chain) {
      const send = {};
      for (const id of ALL) {
        const n = (items[id] || 0) - (bal[id] || 0) - (pend[id] || 0);
        if (n > 0) send[id] = n;
      }
      add(acc, 'mint', send, 'sync-' + acc);
      rec.chain = 1;
      return true;
    }
    const p2 = pending(acc, bal.at);
    let moved = false;
    for (const id of ALL) {
      const want = Math.max(0, (bal[id] || 0) + (p2[id] || 0));
      if ((items[id] || 0) !== want) {
        moved = true;
        if (want) items[id] = want;
        else delete items[id];
      }
    }
    return moved;
  }
  // Walt's wallet set to his shelf: what it lacks minted, what it holds beyond the shelf burnt (the game's key, op ids
  // walt-…). Resolves to the changes queued ({ up, down }), or null (off, no wallet for Walt, his wallet out of reach)
  let mirroring = null,
    mTimer = null;
  function mirror() {
    if (!on || !signer || !W) return Promise.resolve(null);
    if (!mirroring)
      mirroring = (async () => {
        const bal = await balances(W.acc);
        if (!bal) return null;
        const want = W.stock() || {},
          pend = pending(W.acc, bal.at),
          up = {},
          down = {};
        for (const id of ALL) {
          const d = Math.max(0, Number.isSafeInteger(want[id]) ? want[id] : 0) - (bal[id] || 0) - (pend[id] || 0);
          if (d > 0) up[id] = d;
          else if (d < 0) down[id] = -d;
        }
        const op = `walt-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        add(W.acc, 'burn', down, op + '-b');
        add(W.acc, 'mint', up, op + '-m');
        return { up, down };
      })().finally(() => (mirroring = null));
    return mirroring;
  }
  // a look at Walt's wallet in ms (a trade: soon after it, one look for a burst of them)
  function mirrorSoon(ms = mirrorMs) {
    if (!on || !signer || !W || mTimer) return;
    mTimer = setTimeout(() => {
      mTimer = null;
      mirror().catch((e) => log.warn('chain mirror', e.message));
    }, ms);
  }
  const every = setInterval(() => mirrorSoon(0), MIRROR_EVERY);
  if (every.unref) every.unref();
  kick();
  mirrorSoon();
  return {
    add,
    salesSettled,
    status,
    pending,
    balances,
    soon,
    sync,
    mirror,
    mirrorSoon,
    on: () => !!(on && signer),
    // Walt's account while his shelf is on his wallet, else null
    walt: () => (on && signer && W ? W.acc : null),
    idle: () => !busy && !mirroring && !mTimer && !st.q.some((c) => c.st === 'q' || c.st === 's'),
    // (the server's tests: turned on and off at run time)
    enable(v) {
      on = !!v;
      kick();
      mirrorSoon(0);
    },
    // (the tests: how long soon() keeps a read; 0: every look reads anew)
    keep(ms) {
      keepMs = ms;
      seen.clear();
    },
  };
}
