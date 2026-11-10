// live/rules.js — the economy's rules, one copy for the game and its server: a fresh save (defaults), a stored save read back field by
// field against DATA (clean), what each purchase or choice costs and when it is allowed (act), what a run's end state is worth (outcome)
// and what it pays (bank). The game applies them to the guest's progress and, with a wallet, as a preview of what the server will say;
// the server (server/server.mjs) applies them to the account's progress, which only it writes. Loaded after data.js; under node, required.
(function (root) {
  const D = root.DATA || require('./data.js');
  // the campaign's missions and their rewards (loaded before this file; a set of rules kept from before the campaign
  // has none)
  const E = root.ECONOMY || (typeof module !== 'undefined' ? require('./economy.js') : null);
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
    // the campaign's missions finished, in the order they were (economy.js MISSIONS; the first finish pays the reward)
    camp: [],
    items: {}, // the stash: economy.js item id -> how many (materials, trophies, kits); a wallet's are sent to it
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
    for (const id of Array.isArray(s.camp) ? s.camp : []) {
      const m = typeof id === 'string' && E ? E.mission(id) : null;
      if (m && !m.soon && !d.camp.includes(id)) d.camp.push(id);
    }
    const items = obj(s.items);
    if (E)
      for (const it of E.ITEMS) {
        const n = int(items[it.id], 1e6);
        if (n > 0) d.items[it.id] = n;
      }
    return d;
  };
  // the campaign mission a player plays now: the first one in order (economy.js MISSIONS) not finished yet, when it is
  // open and has a script (live/missions.js); null: none. Only it is played as a mission (the server's tickets, the
  // campaign's PLAY) and only its win pays its reward: a mission won before plays as a classic run, so it pays once
  R.current = (save) => {
    const MS = root.MISSIONS || (typeof module !== 'undefined' ? require('./missions.js') : null),
      done = save && Array.isArray(save.camp) ? save.camp : [];
    if (!E || !MS) return null;
    for (const m of E.MISSIONS) {
      if (done.includes(m.id)) continue;
      return !m.soon && own(MS, m.id) ? m.id : null;
    }
    return null;
  };
  R.wupOf = (save, id) => (own(save.wup, id) ? save.wup[id] : (save.wup[id] = { dmg: 0, rate: 0, mag: 0 }));
  R.rank = (save) => D.rankOf(save.rxp).r;
  R.mastery = (save, id) => D.masteryOf(save.mast[id] || 0);
  // One purchase or choice on a save: a = { k: 'buy', id } a gun (from its rank, for its price; it becomes the primary), { k: 'sel', id }
  // the primary among the guns owned, { k: 'up', id, s: 'dmg'|'rate'|'mag' } a gun's upgrade (owned, up to its mastery level), { k: 'meta', s }
  // a permanent upgrade, { k: 'vote', id } a roadmap vote, { k: 'lang', v } the language, { k: 'nick', v } a new name (R.nick),
  // { k: 'sell', id, n } n of an item from the stash to Walt, { k: 'wbuy', id, n } n from Walt's shelf (ctx.stock: his
  // shelf, { id: n }, changed too: the server's for an account, the page's copy of it for a guest). Changes the save and
  // returns null, or returns why not (and leaves it as it was).
  R.act = (save, a, ctx) => {
    a = obj(a);
    if (a.k === 'sell' || a.k === 'wbuy') return trade(save, a, obj(ctx));
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
  // a guest's progress taken into a wallet's new account at its first sign-in (docs/design.md, Identity: the progress
  // follows the wallet). The guest's save lives in the browser and can't be trusted; what comes along is what the
  // server saw this device's runs earn — proof: the device's record (server.mjs, guests: its mission runs played again
  // there, a save of their earnings alone) — and no more than the page still says it has (guest: the page's save; it
  // may have sold or spent some since): the missions finished, in the campaign's order; the items those runs carried
  // out; coins and rank XP up to a first session's worth (ADOPT), the coins also no more than the runs earned plus
  // what Walt pays at most for the proven items the page no longer holds (sold to him). Guns, upgrades and records
  // start afresh (the coins buy them again); the face is the page's. No proof (a device the server never saw play a
  // mission, or one already taken into another account): the face alone
  R.ADOPT = { coins: 2000, rxp: 1500 };
  R.adopt = (save, proof, guest) => {
    const g = R.clean(guest);
    save.items = obj(save.items);
    if (proof) {
      const p = R.clean(proof);
      let sold = 0;
      if (E)
        for (const m of E.MISSIONS) {
          if (m.soon || !p.camp.includes(m.id)) break;
          if (!save.camp.includes(m.id)) save.camp.push(m.id);
        }
      for (const id in p.items) {
        const n = Math.min(p.items[id], g.items[id] || 0);
        if (n > 0) save.items[id] = Math.max(save.items[id] || 0, n);
        if (E && E.tradable(id)) sold += (p.items[id] - n) * E.buyPrice(id, 0);
      }
      save.coins = Math.max(save.coins, Math.min(g.coins, p.coins + sold, R.ADOPT.coins));
      save.rxp = Math.max(save.rxp, Math.min(g.rxp, p.rxp, R.ADOPT.rxp));
    }
    if (g.nick) save.nick = g.nick;
    if (g.ava !== null) save.ava = g.ava;
    if (g.bg !== null) save.bg = g.bg;
    if (g.language) save.language = g.language;
    return save;
  };
  // a trade with Walt (economy.js: his prices from his shelf): n a whole number, 1..TRADE_MAX (a number: a string or
  // an array that reads as one is refused, it would be counted as text further on); only what he trades; selling, what
  // the stash holds; buying, what his shelf holds and the coins for it
  R.TRADE_MAX = 999;
  R.count = (v) => (Number.isSafeInteger(v) && v >= 1 && v <= R.TRADE_MAX ? v : 0);
  function trade(save, a, ctx) {
    const n = R.count(a.n),
      it = E && typeof a.id === 'string' ? E.item(a.id) : null;
    if (!it || !E.tradable(a.id)) return 'not traded';
    if (!n) return 'bad amount';
    const stock = obj(ctx.stock),
      have = int(stock[a.id], 1e9);
    save.items = obj(save.items);
    if (a.k === 'sell') {
      if ((save.items[a.id] || 0) < n) return 'not enough';
      save.coins += E.sellTotal(a.id, n, have);
      save.items[a.id] -= n;
      if (!save.items[a.id]) delete save.items[a.id];
      stock[a.id] = have + n;
      return null;
    }
    const cost = E.buyTotal(a.id, n, have);
    if (!cost) return 'out of stock';
    if (save.coins < cost) return 'coins';
    save.coins -= cost;
    save.items[a.id] = (save.items[a.id] || 0) + n;
    stock[a.id] = have - n;
    if (!stock[a.id]) delete stock[a.id];
    return null;
  }
  // a run's end state (the sim's S) as the economy counts it: the numbers at the moment it ended (death or the win), or now (a quit).
  // Played together, hero i's (the room's order; default: the page's own, S.p): its own kills (its gun's mastery, the rank's XP for
  // them), the run's coins (all of them, each player), its gun; coop: no record (the fastest win is a run alone);
  // mission: the campaign mission it played (sim.js S.mis; none: a classic run); bag: what the hero brings home, [[item id, how many],
  // …] — out by the evac its backpack and its safe, fallen or quit its safe only (economy.js, the run's backpack)
  R.carried = (p, out) => {
    const n = {};
    for (const sl of (out ? (p.bag || []).concat(p.safe || []) : p.safe) || [])
      if (sl) n[sl[0]] = (n[sl[0]] || 0) + sl[1];
    return Object.keys(n)
      .sort()
      .map((id) => [id, n[id]]);
  };
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
      bag: R.carried(p, !!(o && o.evac && p.evac && !p.dead)),
    };
    if (co) out.coop = 1;
    if (S.mis) out.mission = S.mis.id;
    return out;
  };
  R.WIN_BONUS = 500;
  // A run's end pays into the save once: its coins and the win bonus, the survivor rank's XP (D.runXp) with the coins of every rank it
  // passes, and its kills to the mastery of the gun it was played with. The current campaign mission (R.current) won
  // also pays its reward (economy.js MISSIONS: its coins, its XP as the rank's part 'mission'; its items the hero picked
  // up where they fell, as the rest) and is kept as finished (save.camp). What the hero brought out (o.bag) goes into
  // the stash. Returns what it paid (for the results screen: items, [[id, n], …]).
  R.bank = (save, o) => {
    const win = !!o.win,
      bonus = win ? R.WIN_BONUS : 0,
      gun = usable(o.gun) ? o.gun : 'pistol',
      kills = int(o.kills, 1e9);
    const mis = win && E && typeof o.mission === 'string' ? E.mission(o.mission) : null,
      first = !!mis && !!mis.reward && R.current(save) === mis.id,
      mc = first ? int(mis.reward.coins, 1e9) : 0;
    const parts = D.runXp({ t: o.t, kills, bosses: o.bk, win, lvl: o.lvl });
    if (first) parts.mission = int(mis.reward.xp, 1e9);
    const xp = Object.values(parts).reduce((a, b) => a + b, 0);
    const r0 = D.rankOf(save.rxp).r,
      r1 = D.rankOf(save.rxp + xp).r,
      m0 = save.mast[gun] || 0;
    let rc = 0;
    const opened = [];
    for (let r = r0 + 1; r <= r1; r++) {
      rc += D.RANK_COINS(r);
      opened.push(...D.MAIN_ORDER.filter((id) => D.MAIN[id].rank === r && !D.MAIN[id].locked && !save.owned[id]));
    }
    const coins = int(o.coins, 1e9) + bonus + rc + mc;
    const gain = { parts, xp0: save.rxp, xp, rc, opened, gun, m0, m1: m0 + kills, bonus, coins };
    gain.mission = first ? { id: mis.id, coins: mc, xp: parts.mission } : null;
    gain.items = [];
    if (first) save.camp.push(mis.id);
    save.items = obj(save.items);
    for (const b of Array.isArray(o.bag) ? o.bag : [])
      if (Array.isArray(b) && E && E.item(b[0]) && int(b[1], 1e6) > 0) {
        save.items[b[0]] = (save.items[b[0]] || 0) + int(b[1], 1e6);
        gain.items.push([b[0], int(b[1], 1e6)]);
      }
    save.rxp += xp;
    save.mast[gun] = m0 + kills;
    save.coins += coins;
    save.stats.runs++;
    if (win) save.stats.wins++;
    save.stats.kills += kills;
    save.stats.best = Math.max(save.stats.best, o.t || 0);
    // the record: only a classic win alone (a mission's script ends it, not the final boss), only a faster one
    if (win && o.t > 0 && !o.coop && !o.mission && (!save.stats.fast || o.t < save.stats.fast)) save.stats.fast = o.t;
    return gain;
  };

  root.RULES = R;
  if (typeof module !== 'undefined') module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
