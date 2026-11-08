// live/rules.js — the economy's rules, one copy for the game and its server: a fresh save (defaults), a stored save read back field by
// field against DATA (clean), what each purchase or choice costs and when it is allowed (act), what a run's end state is worth (outcome)
// and what it pays (bank). The game applies them to the guest's progress and, with a wallet, as a preview of what the server will say;
// the server (server/server.mjs) applies them to the account's progress, which only it writes. Loaded after data.js; under node, required.
(function (root) {
  const D = root.DATA || require('./data.js');
  const R = {};
  R.defaults = () => ({
    coins: 0,
    owned: { pistol: true },
    selected: 'pistol',
    wup: {}, // weapon id -> { dmg, rate, mag } (D.WEAPON_UP's levels)
    rxp: 0, // the survivor rank's XP, all of it (DATA.rankOf: the rank and the way into the next)
    mast: {}, // weapon id -> kills in the runs it was primary in (DATA.masteryOf: its mastery level)
    meta: { hp: 0, dmg: 0, speed: 0, magnet: 0, reroll: 0, start: 0 },
    votes: {}, // roadmap id -> true
    stats: { runs: 0, wins: 0, best: 0, kills: 0, fast: 0 }, // best: the longest run (s); fast: the fastest win — the final boss down (s), 0: none yet
    language: null, // the language pack the player picked (lang_<code>.js); null: follow the browser
    ava: null,
    bg: null,
    nick: null, // the face in the lobby: DATA.AVATARS index, DATA.AVATAR_BG index, the name (fillFace deals them)
  });
  // a name as the player typed it, or null when it can't be one: letters of any language, digits, spaces and - _ . ' ! ?, 2 to 18 of them
  // (invisible and control characters dropped, runs of spaces made one)
  R.nick = (v) => {
    if (typeof v !== 'string' || v.length > 200) return null;
    const s = v.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim(),
      n = [...s].length;
    return n >= 2 && n <= 18 && /^[\p{L}\p{M}\p{N} _.'!?-]+$/u.test(s) ? s : null;
  };
  // what of the face a save lacks, dealt with rnd (() → [0, 1)): the avatar, its background, a name from its animal. True if it dealt any
  R.fillFace = (save, rnd) => {
    const pick = (a) => a[Math.min(a.length - 1, Math.floor(rnd() * a.length))];
    if (save.ava !== null && save.bg !== null && save.nick) return false;
    if (save.ava === null) save.ava = Math.min(D.AVATARS.length - 1, Math.floor(rnd() * D.AVATARS.length));
    if (save.bg === null) save.bg = Math.min(D.AVATAR_BG.length - 1, Math.floor(rnd() * D.AVATAR_BG.length));
    if (!save.nick)
      save.nick = (rnd() < 0.25 ? pick(D.NICK_TITLE) : pick(D.NICK_ADJ)) + ' ' + pick(D.AVATARS[save.ava].animal);
    return true;
  };
  const int = (v, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(0, Math.floor(+v))) : 0);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const usable = (id) => typeof id === 'string' && own(D.MAIN, id) && !D.MAIN[id].locked;
  R.usable = usable;
  R.WEAPON_UP = D.WEAPON_UP;
  // a stored save (an older build's, or one edited by hand) into one with only known ids and numbers in range
  R.clean = (s) => {
    const d = R.defaults();
    s = obj(s);
    const owned = obj(s.owned),
      wup = obj(s.wup),
      meta = obj(s.meta),
      votes = obj(s.votes),
      st = obj(s.stats),
      mast = obj(s.mast);
    for (const id in owned) if (owned[id] === true && usable(id)) d.owned[id] = true;
    if (usable(s.selected) && d.owned[s.selected]) d.selected = s.selected;
    for (const id in wup)
      if (own(D.MAIN, id)) {
        const w = obj(wup[id]);
        d.wup[id] = {};
        for (const k in D.WEAPON_UP) d.wup[id][k] = int(w[k], D.WEAPON_UP[k].price.length);
      }
    for (const k in d.meta) d.meta[k] = int(meta[k], own(D.META, k) ? D.META[k].max : 0);
    for (const r of D.ROADMAP) if (votes[r.id] === true) d.votes[r.id] = true;
    d.coins = int(s.coins, 1e12);
    const secs = (v) => (Number.isFinite(+v) ? Math.min(1e6, Math.max(0, +v)) : 0);
    d.stats = { runs: int(st.runs, 1e12), wins: int(st.wins, 1e12), kills: int(st.kills, 1e15), best: secs(st.best) };
    d.stats.fast = 'fast' in st ? secs(st.fast) : d.stats.wins ? d.stats.best : 0; // (a save from before the record: its longest run, if it ever won)
    for (const id in mast) if (own(D.MAIN, id)) d.mast[id] = int(mast[id], 1e15);
    // a save from before the rank: its rank XP made up from its stats, and each gun's mastery at least as high as its upgrades (guns
    // bought earlier stay owned whatever their rank; upgrades already bought are never taken away)
    d.rxp = 'rxp' in s ? int(s.rxp, 1e12) : Math.floor(d.stats.kills / 10) + 25 * d.stats.runs + 250 * d.stats.wins;
    for (const id in d.wup) {
      const top = Math.max(...Object.values(d.wup[id]));
      if (top > 1) d.mast[id] = Math.max(d.mast[id] || 0, D.MASTERY[Math.min(top, D.MASTERY.length) - 1]);
    }
    if (typeof s.language === 'string' && /^[a-z]{2,3}$/.test(s.language)) d.language = s.language;
    if (Number.isInteger(s.ava) && s.ava >= 0 && s.ava < D.AVATARS.length) d.ava = s.ava;
    if (Number.isInteger(s.bg) && s.bg >= 0 && s.bg < D.AVATAR_BG.length) d.bg = s.bg;
    d.nick = R.nick(s.nick);
    return d;
  };
  R.wupOf = (save, id) => (own(save.wup, id) ? save.wup[id] : (save.wup[id] = { dmg: 0, rate: 0, mag: 0 }));
  R.rank = (save) => D.rankOf(save.rxp).r;
  R.mastery = (save, id) => D.masteryOf(save.mast[id] || 0);
  // One purchase or choice on a save: a = { k: 'buy', id } a gun (from its rank, for its price; it becomes the primary), { k: 'sel', id }
  // the primary among the guns owned, { k: 'up', id, s: 'dmg'|'rate'|'mag' } a gun's upgrade (owned, up to its mastery level), { k: 'meta', s }
  // a permanent upgrade, { k: 'vote', id } a roadmap vote, { k: 'lang', v } the language, { k: 'nick', v } a new name (R.nick). Changes
  // the save and returns null, or returns why not (and leaves it as it was).
  R.act = (save, a) => {
    a = obj(a);
    if (a.k === 'buy') {
      if (!usable(a.id)) return 'unknown gun';
      const d = D.MAIN[a.id];
      if (save.owned[a.id]) return 'owned';
      if (R.rank(save) < d.rank) return 'rank';
      if (save.coins < d.price) return 'coins';
      save.coins -= d.price;
      save.owned[a.id] = true;
      save.selected = a.id;
      return null;
    }
    if (a.k === 'sel') {
      if (!usable(a.id) || !save.owned[a.id]) return 'not owned';
      save.selected = a.id;
      return null;
    }
    if (a.k === 'up') {
      if (!usable(a.id) || !save.owned[a.id]) return 'not owned';
      if (typeof a.s !== 'string' || !own(D.WEAPON_UP, a.s)) return 'unknown upgrade';
      const u = R.wupOf(save, a.id),
        lv = u[a.s] || 0,
        P = D.WEAPON_UP[a.s].price[lv];
      if (P === undefined) return 'max';
      if (lv >= R.mastery(save, a.id)) return 'mastery';
      if (save.coins < P) return 'coins';
      save.coins -= P;
      u[a.s] = lv + 1;
      return null;
    }
    if (a.k === 'meta') {
      if (typeof a.s !== 'string' || !own(D.META, a.s)) return 'unknown upgrade';
      const m = D.META[a.s],
        lv = save.meta[a.s] || 0,
        P = m.price[lv];
      if (lv >= m.max || P === undefined) return 'max';
      if (save.coins < P) return 'coins';
      save.coins -= P;
      save.meta[a.s] = lv + 1;
      return null;
    }
    if (a.k === 'vote') {
      if (!D.ROADMAP.some((r) => r.id === a.id)) return 'unknown';
      save.votes[a.id] = true;
      return null;
    }
    if (a.k === 'nick') {
      const n = R.nick(a.v);
      if (!n) return 'bad name';
      save.nick = n;
      return null;
    }
    if (a.k === 'lang') {
      if (a.v !== null && !(typeof a.v === 'string' && /^[a-z]{2,3}$/.test(a.v))) return 'unknown';
      save.language = a.v;
      return null;
    }
    return 'unknown action';
  };
  // a run's end state (the sim's S) as the economy counts it: the numbers at the moment it ended (death or the win), or now (a quit).
  // Played together, hero i's (the room's order; default: the page's own, S.p): its own kills (its gun's mastery, the rank's XP for
  // them), the run's coins (all of them, each player), its gun; coop: no record (the fastest win is a run alone)
  R.outcome = (S, i) => {
    const o = S.over,
      co = !!(S.ps && S.ps.length > 1),
      p = co && Number.isInteger(i) ? S.ps[i] || S.p : S.p;
    const out = {
      t: o ? o.t : S.t,
      kills: co ? p.kills || 0 : o ? o.kills : S.kills,
      bk: S.bk || 0,
      win: !!(o && o.win),
      lvl: o ? o.lvl : p.lvl,
      coins: o ? o.coins : S.coins,
      gun: p.main.id,
    };
    if (co) out.coop = 1;
    return out;
  };
  R.WIN_BONUS = 500;
  // A run's end pays into the save once: its coins and the win bonus, the survivor rank's XP (D.runXp) with the coins of every rank it
  // passes, and its kills to the mastery of the gun it was played with. Returns what it paid (for the results screen).
  R.bank = (save, o) => {
    const win = !!o.win,
      bonus = win ? R.WIN_BONUS : 0,
      gun = usable(o.gun) ? o.gun : 'pistol',
      kills = int(o.kills, 1e9);
    const parts = D.runXp({ t: o.t, kills, bosses: o.bk, win, lvl: o.lvl }),
      xp = Object.values(parts).reduce((a, b) => a + b, 0);
    const r0 = D.rankOf(save.rxp).r,
      r1 = D.rankOf(save.rxp + xp).r,
      m0 = save.mast[gun] || 0;
    let rc = 0;
    const opened = [];
    for (let r = r0 + 1; r <= r1; r++) {
      rc += D.RANK_COINS(r);
      opened.push(...D.MAIN_ORDER.filter((id) => D.MAIN[id].rank === r && !D.MAIN[id].locked && !save.owned[id]));
    }
    const coins = int(o.coins, 1e9) + bonus + rc;
    const gain = { parts, xp0: save.rxp, xp, rc, opened, gun, m0, m1: m0 + kills, bonus, coins };
    save.rxp += xp;
    save.mast[gun] = m0 + kills;
    save.coins += coins;
    save.stats.runs++;
    if (win) save.stats.wins++;
    save.stats.kills += kills;
    save.stats.best = Math.max(save.stats.best, o.t || 0);
    if (win && o.t > 0 && !o.coop && (!save.stats.fast || o.t < save.stats.fast)) save.stats.fast = o.t; // the record: only a win alone, only a faster one
    return gain;
  };

  root.RULES = R;
  if (typeof module !== 'undefined') module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
