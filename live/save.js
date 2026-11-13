// live/save.js — the progress the menus show and change (window.SAVE), in two kinds of hands. The guest's (no wallet) lives in this
// browser's localStorage and the rules (rules.js) are applied to it here. An account's (a NEAR wallet connected, wallet.js) lives on the
// game's server, which alone changes it: here SAVE is what the server last said plus the purchases and runs on their way to it, and
// every change goes through wallet.js. Either way the menus call SAVE.act (a purchase or a choice) and SAVE.bankRun (a run's end), never
// write the numbers themselves. Every storage access is guarded (storage may be blocked). Loaded after data.js and rules.js.
(function () {
  // ?lab (live/lab.js): the balance lab plays on a progress of its own, kept apart from the guest's, and never with an account
  const LAB = (window.LAB = (() => {
    try {
      return new URLSearchParams(location.search).has('lab');
    } catch (e) {
      return false;
    }
  })());
  // the keys this browser kept under the prototype's names (zombie-horde-save-v1, its @lab and @<account> copies,
  // zombie-horde-wallet; zh-mute, zh.map, the editors' zh-…-draft) moved once to the game's own: a player from before
  // keeps the progress, the session and the settings (a key already under the new name wins; an old one is removed only
  // once its copy is written)
  try {
    const MOVE = [
        ['zombie-horde-', 'meow-division-'],
        ['zh-', 'md-'],
        ['zh.', 'md.'],
      ],
      ks = [];
    for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i));
    for (const k of ks) {
      const m = typeof k === 'string' && MOVE.find(([o]) => k.startsWith(o));
      if (!m) continue;
      const to = m[1] + k.slice(m[0].length);
      if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
  } catch (e) {
    console.warn('storage move', e.message); // (storage blocked or full: the old keys stay for the next visit)
  }
  const KEY = LAB ? 'meow-division-save-v1@lab' : 'meow-division-save-v1',
    WKEY = 'meow-division-wallet',
    R = RULES;
  const clean = (s) => {
    const d = R.clean(s);
    if (d.language && window.I18N && !I18N.packs[d.language]) d.language = null;
    return d;
  };
  const keyOf = (a) => (a ? KEY + '@' + a : KEY);
  const session = () => {
    if (LAB) return null;
    try {
      const s = JSON.parse(localStorage.getItem(WKEY) || 'null');
      return s && typeof s.accountId === 'string' && s.token ? s : null;
    } catch (e) {
      return null;
    }
  };
  function load(key) {
    try {
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      return s ? clean(s.view || s) : R.defaults();
    } catch (e) {
      return R.defaults();
    } // (an account's: wallet.js's { base, ops, view })
  }
  // the guest's progress, its face (avatar, background, name: rules.js fillFace) dealt the first time and kept
  function guest() {
    const d = load(KEY);
    if (R.fillFace(d, Math.random)) {
      try {
        localStorage.setItem(KEY, JSON.stringify(d));
      } catch (e) {}
    }
    return d;
  }
  // the guest's progress, or (a session from before) the account's as this browser last saw it, until the server answers (which
  // deals an account its face)
  const S0 = session(),
    SAVE = (window.SAVE = S0 ? load(keyOf(S0.accountId)) : guest());
  SAVE.profile = S0 ? S0.accountId : null;
  SAVE.data = () => {
    const d = {};
    for (const k of Object.keys(R.defaults())) d[k] = SAVE[k];
    return JSON.parse(JSON.stringify(d));
  }; // the progress alone
  // the guest's progress into this browser (an account's copy here is wallet.js's to keep)
  SAVE.persist = () => {
    if (SAVE.profile) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(SAVE.data()));
    } catch (e) {
      /* storage unavailable: progress lives for this session only */
    }
  };
  // the progress shown: an account's (data: as wallet.js has it) or back to the guest's (account null); the language stays the one picked
  SAVE.useProfile = (account, data) => {
    const lang = SAVE.language,
      d = account ? clean(data) : guest();
    Object.assign(SAVE, d, { profile: account || null });
    if (!SAVE.language) SAVE.language = lang;
  };
  SAVE.wupOf = (id) => R.wupOf(SAVE, id);
  // one-time moments already had (the intro before mission 1: intro.js), kept for whoever plays in this browser, apart from the
  // progress: its fields are rules.js's and, for an account, the server's. A guest who connects a wallet later doesn't get them again
  const SEEN = LAB ? 'md.seen@lab' : 'md.seen',
    seenNow = [];
  const seenList = () => {
    try {
      const v = JSON.parse(localStorage.getItem(SEEN) || '[]');
      return Array.isArray(v) ? v.concat(seenNow) : seenNow.slice();
    } catch (e) {
      return seenNow.slice(); // storage blocked or the value broken: this visit's alone
    }
  };
  SAVE.seen = (id) => seenList().includes(id);
  SAVE.see = (id) => {
    const l = seenList();
    if (l.includes(id)) return;
    seenNow.push(id);
    l.push(id);
    try {
      localStorage.setItem(SEEN, JSON.stringify(l));
    } catch (e) {
      console.warn('seen', id, e.message); // kept for this visit only (seenNow)
    }
  };
  // the moments that go with a save's progress, not with the browser (the base's tutorial: hub.js): forgotten when the progress
  // they belong to starts over, so its lines are said again
  SAVE.unsee = (pick) => {
    for (let i = seenNow.length - 1; i >= 0; i--) if (pick(seenNow[i])) seenNow.splice(i, 1);
    try {
      const v = JSON.parse(localStorage.getItem(SEEN) || '[]');
      if (Array.isArray(v) && v.some(pick)) localStorage.setItem(SEEN, JSON.stringify(v.filter((id) => !pick(id))));
    } catch (e) {
      console.warn('unsee', e.message);
    }
  };
  // a purchase or a choice (rules.js act): null when done, else why not. ctx: a trade's context (Walt's shelf as the
  // page has it: market.js; a guest's trade changes this copy, an account's goes to the server, whose shelf decides)
  SAVE.act = (a, ctx) => {
    if (SAVE.profile && window.WALLET) return WALLET.act(a, ctx);
    const err = R.act(SAVE, a, ctx);
    if (!err) SAVE.persist();
    return err;
  };
  // a run's end, once: what it pays (rules.js bank) — into the guest's progress at once; for an account, sent to the server, which plays
  // the run again and pays what that earned (wallet.js; until it answers, the same sum shows here). run: GAME.run (the ticket, the
  // inputs). Returns { gain, status: 'local' | 'pending' | 'unranked' (an account's run without a ticket: the server was out of reach) }.
  SAVE.bankRun = (play, run) => {
    const o = R.outcome(play);
    if (!SAVE.profile) {
      const gain = R.bank(SAVE, o);
      SAVE.persist();
      // (a guest's mission run with a ticket: its inputs go to the server too, which keeps what they prove for this device —
      // the wallet made in the game and a first sign-in read that, wallet.js guestRun)
      if (run && run.id && !run.account && !run.coop && window.WALLET && WALLET.guestRun) WALLET.guestRun(run);
      return { gain, status: 'local' };
    }
    if (run && run.id && run.account === SAVE.profile && window.WALLET)
      return { gain: WALLET.runEnd(run, o), status: 'pending', id: run.id };
    // a run together: the room's server has its inputs and pays the account itself (when it knew this player as the account: the name tag)
    const co = run && run.coop;
    if (co && run.account === SAVE.profile && window.WALLET && co.names[co.me] && co.names[co.me].acc) {
      const id = co.id + '-' + co.me;
      return { gain: WALLET.coopEnd(id, o), status: 'pending', id };
    }
    return { gain: R.bank(R.clean(SAVE.data()), o), status: 'unranked' }; // shown, not paid
  };
})();
