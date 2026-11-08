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
  const KEY = LAB ? 'zombie-horde-save-v1@lab' : 'zombie-horde-save-v1',
    WKEY = 'zombie-horde-wallet',
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
  // a purchase or a choice (rules.js act): null when done, else why not
  SAVE.act = (a) => {
    if (SAVE.profile && window.WALLET) return WALLET.act(a);
    const err = R.act(SAVE, a);
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
