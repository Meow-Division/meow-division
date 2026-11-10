// server/chain.mjs — the players' items on their wallets (docs/chain.md, "Run end" and "Sell"): what a wallet account
// gets (a run's loot once the server has played it again, a purchase from Walt, the first sign-in's proven guest
// items) and loses (a sale to Walt) is sent to the items contract by the server's own key: `game_mint` and
// `game_burn`, each with an op id the contract applies once. The player signs nothing and pays nothing.
//
// A queue, kept in DATA_DIR/chain.json so a restart loses nothing, sent one transaction at a time. An account's
// change joins its last queued one of the same kind (one transaction for a burst of sales), never one before a change
// of the other kind (a sale of something still on its way waits behind it). A send the chain answered is done
// (applied, or applied before: the same op id twice changes nothing); one it refused (a sale of more than the wallet
// holds: the player moved items away) is failed, and the next look at the wallet sets the stash to what is there;
// an RPC down or a send whose outcome isn't known is tried again later with the same op id.
//
// The wallet is the truth for a wallet account's items: sync() reads its balances and sets the stash to them plus
// what is still on its way (a change done in the last LAG ms counts as on its way too: the final view lags it). The
// first look at an account sends it what its stash held from before (op `sync-<account>`).
import fs from 'node:fs';
import path from 'node:path';

const KEEP = 2 * 864e5, // ms a done or failed change is kept for its status
  TRIES = 30, // sends of one change before it is failed for good
  BACKOFF = [2e3, 5e3, 15e3, 30e3, 60e3, 120e3, 300e3],
  GAS = 10e12; // (measured: a run's loot 2.6–3.1 Tgas on the sandbox, contract/tests/items.rs)

export function makeChain({
  dataDir,
  near,
  signer,
  contract,
  tokens,
  on,
  lag = 20e3,
  onFail = () => {},
  log = console,
}) {
  const LAG = lag; // ms a change just done still counts as on its way (the final view catches up)
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
  const save = () => {
    dirty = true;
    if (!writing) writing = Promise.resolve().then(flushFile);
  };
  async function flushFile() {
    while (dirty) {
      dirty = false;
      const now = Date.now();
      st.q = st.q.filter((c) => c.st === 'q' || c.st === 's' || now - c.at < KEEP);
      const tmp = file + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(st));
      await fs.promises.rename(tmp, file);
    }
    writing = null;
  }
  const clean = (items) => {
    const out = {};
    for (const [id, n] of Array.isArray(items) ? items : Object.entries(items || {}))
      if (known.has(id) && Number.isSafeInteger(n) && n > 0) out[id] = (out[id] || 0) + n;
    return out;
  };
  // a change: k 'mint' (to the wallet) or 'burn' (from it), items [[id, n], …] or { id: n }, op its id (unique); coins:
  // what a sale paid for it (taken back by onFail if the wallet turns out not to hold the items)
  function add(acc, k, items, op, coins = 0) {
    if (!on || !signer) return null;
    const it = clean(items);
    if (!Object.keys(it).length) return null;
    const now = Date.now(),
      last = [...st.q].reverse().find((c) => c.acc === acc && (c.st === 'q' || c.st === 's'));
    if (last && last.st === 'q' && last.k === k && last.ops.length < 50) {
      for (const id in it) last.items[id] = (last.items[id] || 0) + it[id];
      last.ops.push(op);
      last.coins = (last.coins || 0) + coins;
      last.at = now;
    } else st.q.push({ id: op.slice(0, 60), acc, k, items: it, ops: [op], st: 'q', tries: 0, at: now, next: 0, coins });
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
          args =
            c.k === 'mint'
              ? { receiver_id: c.acc, token_ids: ids, amounts: ids.map((id) => String(c.items[id])), run_id: c.id }
              : { owner_id: c.acc, token_ids: ids, amounts: ids.map((id) => String(c.items[id])), op_id: c.id };
        let out = null,
          err = null;
        try {
          out = await signer.call(contract, c.k === 'mint' ? 'game_mint' : 'game_burn', args, { gas: GAS });
        } catch (e) {
          err = e;
        }
        c.at = Date.now();
        if (out && out.ok) {
          c.st = 'done';
          c.tx = out.hash;
          c.again = out.value === false ? 1 : 0; // (applied before: the same op id)
        } else if (out && out.ok === false) {
          c.st = 'fail';
          c.tx = out.hash;
          c.why = String(out.failure || '').slice(0, 300);
          log.warn(`chain ${c.k} ${c.id} for ${c.acc} refused: ${c.why}`);
          try {
            await onFail(c); // (a sale of items the wallet no longer held: its coins back)
          } catch (e) {
            log.error('chain onFail', c.id, e.message);
          }
        } else {
          // the RPC down, the key refused, or the outcome not known in time: again later, the same op id
          c.tries++;
          c.why = err ? String(err.message || err).slice(0, 300) : 'outcome not known';
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
  // what an account's wallet is still to get (+) or lose (−): its changes not done yet, and those just done
  function pending(acc) {
    const now = Date.now(),
      d = {};
    for (const c of st.q)
      if (c.acc === acc && (c.st === 'q' || c.st === 's' || (c.st === 'done' && now - c.at < LAG)))
        for (const id in c.items) d[id] = (d[id] || 0) + (c.k === 'mint' ? 1 : -1) * c.items[id];
    return d;
  }
  // no sale of the account still waiting for its burn (its coins not to be spent before the wallet confirms it)
  const salesSettled = (acc) =>
    !st.q.some((c) => c.acc === acc && c.k === 'burn' && c.coins > 0 && (c.st === 'q' || c.st === 's'));
  // the page's view: on, the account's changes of late (newest first: their op ids, kind, items, state, transaction)
  function status(acc) {
    const ops = st.q
      .filter((c) => c.acc === acc)
      .slice(-20)
      .reverse()
      .map((c) => ({ ops: c.ops, k: c.k, items: c.items, st: c.st === 's' ? 'q' : c.st, tx: c.tx || null }));
    return { on: !!(on && signer), contract, pend: pending(acc), ops };
  }
  // the wallet's balances of every item, or null (the RPC down)
  async function balances(acc) {
    try {
      const r = await near.view(contract, 'mt_batch_balance_of', { account_id: acc, token_ids: ALL });
      const b = {};
      ALL.forEach((id, i) => {
        const n = Number(r[i] || 0);
        if (n > 0) b[id] = n;
      });
      return b;
    } catch (e) {
      log.warn('chain balances', acc, e.message);
      return null;
    }
  }
  // the stash set to the wallet (rec: the account's record, its save.items and rec.chain changed in place; the caller
  // keeps it). The first time: what the stash held beyond the wallet is sent to it first. Returns true if it changed.
  function sync(acc, rec, bal) {
    if (!on || !signer || !bal) return false;
    const items = rec.save.items || (rec.save.items = {}),
      pend = pending(acc);
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
    const p2 = pending(acc);
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
  kick();
  return {
    add,
    salesSettled,
    status,
    pending,
    balances,
    sync,
    on: () => !!(on && signer),
    idle: () => !busy && !st.q.some((c) => c.st === 'q' || c.st === 's'),
    // (the server's tests: turned on and off at run time)
    enable(v) {
      on = !!v;
      kick();
    },
  };
}
