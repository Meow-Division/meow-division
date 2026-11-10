// live/wallet.js — the player's NEAR wallet as their account (NEAR Connect, mainnet). Connecting picks a wallet in NEAR Connect's own
// window and signs a login message (NEP-413: free, nothing goes to the chain); the game's server (server/server.mjs) checks it and from
// then on holds the account's progress — a new account starts with the first steps of this browser's guest (rules.js adopt). Only the
// server changes that progress: this page sends it what the player does — each purchase or choice (POST /api/act) and each run's inputs
// (a ticket from POST /api/run/start, then POST /api/run/end), which the server plays again and pays for. Until it answers, SAVE shows
// the server's last word with those still on their way applied by the same rules (rules.js): `base` + `ops`. The queue is kept in this
// browser, so a purchase or a run made offline or just before the page closed goes up later. Without a wallet the guest's progress
// stays here (save.js). A wallet can also be made right here, with no other site's window (newwallet.js, loaded when first needed):
// its key stays in this browser and signs the same login message (keyLogin).
(function () {
  const API = window.SAVE_API || '/api',
    LIB = 'https://cdn.jsdelivr.net/npm/@hot-labs/near-connect@0.11.4/+esm';
  const WKEY = 'zombie-horde-wallet',
    SKEY = 'zombie-horde-save-v1',
    R = RULES;
  const W = (window.WALLET = {
    available: false,
    state: 'off',
    account: null,
    sync: 'idle',
    at: 0,
    error: '',
    listeners: [],
  });
  // state: off | connecting | on;  sync: idle | saving (something on its way) | saved (the server has it all; at: when it said so) |
  // error (out of reach: tried again shortly)
  let connector = null,
    base = null,
    baseT = 0,
    ops = [],
    lane = false,
    polling = false,
    retryT = 0,
    backoff = 2000;
  // ops, in the player's order: { k: 'act', a } a purchase or choice; { k: 'run', id, n, log, hash, o, want, sent } a run's end (o: its
  // outcome as played here, want: the loadout it was played with)
  const emit = (kind, x) =>
    W.listeners.forEach((f) => {
      try {
        f(kind, x);
      } catch (e) {}
    });
  W.on = (f) => W.listeners.push(f);
  const ls = {
    get: (k) => {
      try {
        return JSON.parse(localStorage.getItem(k) || 'null');
      } catch (e) {
        return null;
      }
    },
    set: (k, v) => {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
  };
  const ss = (k, v) => {
    try {
      if (v === undefined) return sessionStorage.getItem('zh.' + k);
      sessionStorage.setItem('zh.' + k, String(v));
    } catch (e) {
      return v === undefined ? '1' : undefined;
    }
  }; // (blocked storage: as if done, no reload)
  const session = () => {
    const s = ls.get(WKEY);
    return s && s.token && typeof s.accountId === 'string' ? s : null;
  };
  const cacheKey = (a) => SKEY + '@' + a;
  const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(method, path, body, ms = 30000) {
    const s = session(),
      r = await fetch(API + path, {
        method,
        signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
        headers: { 'content-type': 'application/json', ...(s ? { authorization: 'Bearer ' + s.token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let j = null;
    try {
      j = await r.json();
    } catch (e) {}
    if (!r.ok)
      throw Object.assign(new Error((j && j.error) || 'HTTP ' + r.status), { status: r.status, body: j || {} });
    return j;
  }
  async function lib() {
    if (!connector) {
      const { NearConnector } = await import(LIB);
      connector = new NearConnector({ network: 'mainnet', features: { signMessage: true }, footerBranding: null });
      connector.on('wallet:signOut', () => {
        if (W.account) drop();
      });
      await connector.whenManifestLoaded;
    }
    return connector;
  }
  // a run's inputs for the trip: gzipped JSON in base64 (or the array as is, where the browser can't gzip)
  async function pack(log) {
    if (!window.CompressionStream) return { log };
    const buf = new Uint8Array(
      await new Response(
        new Blob([JSON.stringify(log)]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { z: btoa(s) };
  }

  // ---------------- the account's progress as shown: the server's last word + what is on its way
  function store() {
    if (W.account) ls.set(cacheKey(W.account), { base, t: baseT, ops, view: SAVE.data() });
  }
  function rebuild(kind = 'save') {
    if (!W.account || !base) return;
    const s = R.clean(base),
      ctx = window.MARKET ? MARKET.ctx() : null; // (trades on their way: priced on Walt's shelf as last seen)
    for (const op of ops) {
      if (op.k === 'act') R.act(s, op.a, ctx);
      else op.gain = R.bank(s, op.o);
    }
    SAVE.useProfile(W.account, s);
    store();
    emit(kind);
  }
  const accept = (save, t) => {
    if (save && t >= baseT) {
      base = save;
      baseT = t;
    }
    W.at = Date.now();
  };
  function syncState() {
    const was = W.sync;
    W.sync = !W.account ? 'idle' : retryT ? 'error' : ops.length ? 'saving' : 'saved';
    if (W.sync !== was) emit('state');
  }
  const retry = (e) => {
    W.error = e && e.message ? e.message : 'offline';
    clearTimeout(retryT);
    retryT = setTimeout(() => {
      retryT = 0;
      flush();
    }, backoff);
    backoff = Math.min(60000, backoff * 2);
    syncState();
  };
  const fine = () => {
    backoff = 2000;
    if (retryT) {
      clearTimeout(retryT);
      retryT = 0;
    }
  };
  const lost = (e) => e.status === 401 && ((W.error = 'expired'), drop(true), true);

  // the queue, one request at a time in the player's order. A run's end is sent and the queue goes on (its result is polled for, below);
  // a purchase that needs the coins of a run still being played again waits for that run's result.
  async function flush() {
    if (lane || !W.account) return;
    lane = true;
    const acc = W.account;
    // (every answer is checked against the account it was asked for: one switched to meanwhile never takes the old one's save, nor
    // loses an op of its own to it; its queue starts once this one stops)
    const gone = () => W.account !== acc,
      rm = (op) => {
        const i = ops.indexOf(op);
        if (i >= 0) ops.splice(i, 1);
      };
    try {
      for (;;) {
        const op = ops.find((o) => o.k === 'act' || (!o.sent && !o.coop));
        if (!op || gone()) break; // (a run together: the server has its inputs already)
        if (op.k === 'run') {
          try {
            await api(
              'POST',
              '/run/end',
              { id: op.id, n: op.n, hash: op.hash, want: op.want, ...(await pack(op.log)) },
              60000,
            );
            if (gone()) break;
            op.sent = true;
            op.log = null;
          } catch (e) {
            if (gone() || lost(e)) return;
            if (!(e.status >= 400 && e.status < 500 && e.status !== 429)) throw e;
            rm(op);
            emit('run', { id: op.id, error: e.message });
          } // refused (unknown, too fast, expired): it pays nothing
          store();
          poll();
          continue;
        }
        try {
          const r = await api('POST', '/act', { a: op.a });
          if (gone()) break;
          accept(r.save, r.t);
          rm(op);
        } catch (e) {
          if (gone() || lost(e)) return;
          if (e.status !== 409) throw e;
          if (
            e.body.error === 'coins' &&
            ops.some((o) => o.k === 'run' && o.sent && ops.indexOf(o) < ops.indexOf(op))
          ) {
            accept(e.body.save, e.body.t);
            rebuild();
            await settled();
            continue;
          }
          accept(e.body.save, e.body.t);
          rm(op);
          emit('refused', { a: op.a, error: e.body.error });
        }
        rebuild();
      }
      if (!gone()) fine();
    } catch (e) {
      if (!gone()) retry(e);
    } finally {
      lane = false;
      syncState();
      if (gone() && W.account) flush();
    }
  }
  // the results of the runs sent, as the server finishes playing them again
  let waiters = [];
  const settled = () => new Promise((r) => waiters.push(r));
  async function poll() {
    if (polling) return;
    polling = true;
    const acc = W.account,
      gone = () => W.account !== acc;
    const wake = () => {
      const w = waiters;
      waiters = [];
      w.forEach((f) => f());
    };
    try {
      for (;;) {
        const op = ops.find((o) => o.k === 'run' && o.sent);
        if (!op || gone()) break;
        let r;
        try {
          r = await api('GET', '/run/' + op.id, undefined, 40000);
        } catch (e) {
          if (gone() || lost(e)) return;
          if (e.status === 404) r = { done: true, error: 'unknown run' };
          else {
            await sleep(backoff);
            backoff = Math.min(60000, backoff * 2);
            continue;
          }
        }
        if (gone()) break;
        if (!r.done) continue;
        fine();
        if (r.save) accept(r.save, r.t);
        const i = ops.indexOf(op);
        if (i >= 0) ops.splice(i, 1);
        rebuild();
        emit('run', r);
        wake();
      }
    } finally {
      polling = false;
      syncState();
      if (gone()) {
        wake();
        if (W.account) poll();
      }
    } // (a purchase waiting on the old account's run lets go)
  }

  // ---------------- what the game calls
  // a purchase or choice: checked by the same rules here first (no request for what can't pass), shown at once, sent in turn
  W.act = (a, ctx) => {
    if (!W.account || !base) return 'offline';
    const err = R.act(R.clean(SAVE.data()), a, ctx && { stock: { ...ctx.stock } });
    if (err) return err;
    ops.push({ k: 'act', a });
    rebuild();
    syncState();
    flush();
    return null;
  };
  // a ticket for a run (the server's seeds; one use), or null: the server out of reach (the run then counts for nothing). 409 stale:
  // the game was updated since this page loaded (other rules): the page loads again, once a session (a server not yet
  // updated: no loop). mission: the campaign mission the run plays (the ticket carries it; the server's replay plays
  // its script)
  W.ticket = async (map, mission) => {
    await W.ready;
    if (!W.account) return null;
    try {
      const r = await api('POST', '/run/start', mission ? { rev: SIM.REV, map, mission } : { rev: SIM.REV, map }, 6000);
      return r && r.id ? r : null;
    } catch (e) {
      if (e.status === 409 && !ss('reloaded')) {
        ss('reloaded', 1);
        location.reload();
        return new Promise(() => {});
      }
      lost(e);
      return null;
    }
  };
  // a run's end: its prediction shown at once (what the same sum comes to here), its inputs sent in turn. Returns the predicted gain.
  W.runEnd = (run, o) => {
    const op = { k: 'run', id: run.id, n: run.rec.n, log: run.rec.log, hash: run.hash || '', o, want: run.want };
    ops.push(op);
    rebuild();
    syncState();
    flush();
    return op.gain;
  };
  // a run played together (net.js; the server kept both players' inputs and plays it again itself): its prediction shown at once as for
  // a run alone; once the room's server says the run is over (coopSent) its result is asked for like a sent run's, and the room's
  // server may hand the result over first (coopPaid). One never sent is dropped with the page (open keeps only runs with a log or sent)
  W.coopEnd = (id, o) => {
    const op = { k: 'run', id, n: 0, log: null, hash: '', o, want: null, coop: 1, sent: false };
    ops.push(op);
    rebuild();
    syncState();
    return op.gain;
  };
  W.coopSent = (id) => {
    const op = ops.find((o) => o.k === 'run' && o.id === id);
    if (op && !op.sent) {
      op.sent = true;
      store();
      poll();
    }
  };
  W.coopPaid = (r) => {
    if (!W.account || !r) return;
    const i = ops.findIndex((o) => o.k === 'run' && o.id === r.id);
    if (r.save) accept(r.save, r.t);
    if (i >= 0) ops.splice(i, 1);
    fine();
    rebuild();
    syncState();
    emit('run', r);
  };
  // the account as this browser had it (a queue left from before included), then the server's word over it
  function open(accountId, save, t) {
    const c = ls.get(cacheKey(accountId)) || {};
    W.account = accountId;
    W.state = 'on';
    ops = Array.isArray(c.ops)
      ? c.ops.filter((o) => o && (o.k === 'act' || (o.k === 'run' && (o.sent || Array.isArray(o.log)))))
      : [];
    base = save || c.base || R.defaults();
    baseT = save ? t : c.t || 0;
    rebuild('profile');
    syncState();
    flush();
    poll();
  }
  // the server's one-time nonce first, then NEAR Connect's picker, then one trip to the wallet: it signs in and signs the login message
  // in the same window (signInAndSignMessage), opened by the player's tap in the picker. (A second window asked for later, with no tap
  // of its own, is blocked by a phone's browser without a word, and the wallet would wait for it forever.) Pressed again while a wallet
  // is chosen and its window hangs (closed, never shown): that try is dropped and a new one starts; while the picker is up: nothing.
  let tries = 0,
    picking = false;
  W.connect = async (opt) => {
    if (picking) return;
    // wallets made in this browser: one tap opens one of them (newwallet.js's pick), or another wallet (other)
    if (!(opt && opt.other) && madeHere().length) {
      try {
        return (await newWallet()).open('pick');
      } catch (e) {
        console.warn('newwallet', e.message);
      }
    }
    const my = ++tries,
      stale = () => my !== tries;
    W.state = 'connecting';
    W.error = '';
    emit('state');
    try {
      let c, ch, id;
      picking = true;
      try {
        [c, ch] = await Promise.all([lib(), api('POST', '/challenge', {})]);
        id = await c.selectWallet({ features: { signInAndSignMessage: true } });
      } finally {
        picking = false;
      }
      let got = null;
      const take = (e) => {
        if (!stale()) got = e && e.accounts;
      };
      c.on('wallet:signInAndSignMessage', take);
      try {
        await c.connect({
          walletId: id,
          signMessageParams: { message: ch.message, recipient: ch.recipient, nonce: b64bytes(ch.nonce) },
        });
      } finally {
        c.off('wallet:signInAndSignMessage', take);
      }
      if (stale()) return;
      const a = (got || []).find((x) => x && x.signedMessage),
        s = a && a.signedMessage;
      if (!s) throw new Error('no signature');
      const r = await api('POST', '/login', {
        accountId: s.accountId || a.accountId,
        publicKey: s.publicKey,
        signature: s.signature,
        nonce: ch.nonce,
        guest: SAVE.profile ? undefined : SAVE.data(), // (a new account takes the guest's first steps along: rules.js adopt)
      });
      if (stale()) return;
      ls.set(WKEY, { token: r.token, accountId: r.accountId });
      open(r.accountId, r.save, r.t);
    } catch (e) {
      if (stale()) return;
      W.state = W.account ? 'on' : 'off';
      W.error = e && e.message ? String(e.message).slice(0, 120) : String(e).slice(0, 120);
      if (/reject|cancel|closed|user/i.test(W.error)) W.error = ''; // the player closed the window: no error to show
      emit('state');
    }
  };
  // back to the guest's progress (this browser's); the account's stays on the server, and what was still on its way stays queued here
  // for the next time this account connects
  function drop(expired) {
    store();
    clearTimeout(retryT);
    retryT = 0;
    ls.set(WKEY, null);
    W.account = null;
    W.state = 'off';
    base = null;
    baseT = 0;
    ops = [];
    if (!expired) W.error = '';
    const w = waiters;
    waiters = [];
    w.forEach((f) => f()); // a purchase waiting on a run's result: let it see the account gone
    SAVE.useProfile(null);
    syncState();
    emit('profile');
  }
  // a new wallet made inside the game (docs/design.md, Identity): newwallet.js, loaded the first time it is needed — the
  // name, the recovery phrase and the key made in this browser, the account by the server (POST /api/wallet/create), then
  // the login with the new key (W.keyLogin). No window of another site opens: Telegram and the browsers block those.
  let nwLoad = null;
  const newWallet = () =>
    nwLoad ||
    (nwLoad = new Promise((ok, no) => {
      if (window.NEWWALLET) return ok(window.NEWWALLET);
      const src = 'newwallet.js',
        s = document.createElement('script');
      s.src = src + '?v=' + ((window.__VER && window.__VER[src]) || window.__V || 0);
      s.onload = () => (window.NEWWALLET ? ok(window.NEWWALLET) : no(new Error('newwallet.js')));
      s.onerror = () => {
        nwLoad = null;
        no(new Error('offline'));
      };
      document.head.appendChild(s);
    }));
  // the wallets made in this browser (newwallet.js keeps their words in md.wallets)
  const madeHere = () => {
    try {
      const v = JSON.parse(localStorage.getItem('md.wallets') || '{}') || {};
      return Object.keys(v).filter((k) => v[k] && v[k].made);
    } catch (e) {
      return [];
    }
  };
  W.create = async () => {
    if (window.MARKET && MARKET.isOpen && MARKET.isOpen()) MARKET.close(); // (Walt's window gives way to the wallet's)
    try {
      (await newWallet()).open('make');
    } catch (e) {
      console.warn('newwallet', e.message);
      W.error = 'offline';
      emit('state');
    }
  };
  // the recovery phrase of a wallet made here, again (its button in the wallet panel, below)
  W.showPhrase = async (accountId) => {
    try {
      (await newWallet()).open('words', accountId || W.account);
    } catch (e) {
      console.warn('newwallet', e.message);
    }
  };
  // a login with a key this browser holds (a wallet made here): the server's nonce signed by sign(challenge) — the same
  // message and the same check as any wallet's (NEP-413; a full-access key of the account) — and the guest's first
  // steps along, as on a first connect. Throws what the server refused.
  W.keyLogin = async (accountId, publicKey, sign) => {
    const ch = await api('POST', '/challenge', {});
    const r = await api('POST', '/login', {
      accountId,
      publicKey,
      signature: await sign(ch),
      nonce: ch.nonce,
      guest: SAVE.profile ? undefined : SAVE.data(),
    });
    ++tries; // (a NEAR Connect try still waiting on its window: dropped)
    ls.set(WKEY, { token: r.token, accountId: r.accountId });
    W.error = '';
    open(r.accountId, r.save, r.t);
    emit('state');
    return r.accountId;
  };
  W.disconnect = async () => {
    if (ops.some((o) => o.k === 'act' || !o.sent)) {
      flush();
      for (let i = 0; i < 30 && ops.some((o) => o.k === 'act' || !o.sent); i++) await sleep(100);
    } // the last purchase first
    try {
      if (connector) await connector.disconnect();
    } catch (e) {}
    drop();
  };
  // the page opens: is there a server; a session from before: its account as this browser had it, then the server's word
  async function init() {
    if (window.LAB) {
      emit('state');
      return;
    } // the balance lab (?lab): no server, no account
    try {
      W.available = !!(await api('GET', '/health', undefined, 6000)).ok;
    } catch (e) {
      W.available = false;
    }
    const s = session();
    if (s) {
      open(s.accountId, null, 0);
      if (W.available) {
        try {
          const r = await api('GET', '/save');
          accept(r.save, r.t);
          rebuild();
        } catch (e) {
          if (!lost(e)) retry(e);
        }
      } else retry(new Error('offline'));
    }
    emit('state');
  }
  addEventListener('online', () => {
    if (W.account) {
      fine();
      flush();
      poll();
    }
  });
  W.madeHere = () => madeHere();
  // a recovery phrase button anywhere (ui.js: the wallet panel, the settings): the words of the wallet signed in
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-wphrase]')) {
        e.stopPropagation();
        for (const p of document.querySelectorAll('.setp.open')) p.classList.remove('open'); // (the panel gives way)
        W.showPhrase(W.account);
      }
    },
    true,
  );
  W.ready = init();
})();
