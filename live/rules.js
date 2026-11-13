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
    items: {}, // the stash: economy.js item id -> how many (materials, trophies, kits, rare guns); a wallet's are sent to it
    // what the hero has on (the stash window's gear): gun a rare gun from the stash (economy.js kind weapon) put in its slot, so it
    // is played with (owned while it is there and the stash holds it: R.fixGear); it stays in the stash, never taken into a run's
    // backpack, so a death never loses it. Armour and the rest: later
    gear: { gun: null },
    held: [], // trophies sold from the stash: a building one unlocks stays open (economy.js lockedBy, hub.js)
    // NEAR Base (hub.js): lv building id -> its level paid for; bt building id -> when (ms, the server's clock) its last
    // level stands (it is up from then); clr junk heap id (economy.js JUNK) -> when its clearing ends; gift the
    // tutorial's buildings whose parts the first suburb boss has dropped (R.gift: once each)
    base: { lv: {}, bt: {}, clr: {}, gift: [] },
    // the day's tasks (R.dailyOf): d the UTC day's number they are of; Walt's done, Nova's suburb and lab raids won
    daily: { d: 0, walt: false, suburb: false, lab: false },
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
  const TASKS = ['generator', 'workbench', 'medbay']; // (the base tutorial's buildings, in its order: R.task)
  R.TASKS = TASKS;
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
    const gear = obj(s.gear);
    if (typeof gear.gun === 'string') d.gear.gun = gear.gun;
    R.fixGear(d);
    if (usable(s.selected) && d.owned[s.selected]) d.selected = s.selected; // (a rare gun: once its slot is known)
    for (const id of Array.isArray(s.held) ? s.held : []) {
      const it = typeof id === 'string' && E ? E.item(id) : null;
      if (it && it.kind === 'trophy' && !d.held.includes(id)) d.held.push(id);
    }
    const b = obj(s.base),
      lv = obj(b.lv),
      bt = obj(b.bt),
      clr = obj(b.clr),
      ms = (v) => (Number.isFinite(+v) ? Math.min(1e14, Math.max(0, Math.floor(+v))) : 0);
    if (E) {
      for (const B of E.BUILDINGS) {
        const n = int(lv[B.id], B.levels.length);
        if (n > 0) {
          d.base.lv[B.id] = n;
          d.base.bt[B.id] = ms(bt[B.id]);
        }
      }
      for (const id of E.JUNK) if (own(clr, id) && ms(clr[id]) > 0) d.base.clr[id] = ms(clr[id]);
      for (const id of Array.isArray(b.gift) ? b.gift : [])
        if (TASKS.includes(id) && !d.base.gift.includes(id)) d.base.gift.push(id);
    }
    const dy = obj(s.daily);
    d.daily = { d: int(dy.d, 1e7), walt: dy.walt === true, suburb: dy.suburb === true, lab: dy.lab === true };
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
  // the gear as the stash allows it: a gun slot holds a rare gun only while the stash has one (a sale, a lot on the players'
  // market or the wallet's look can take it), and that gun is owned while it does; one gone falls back to the primary
  // before it (or the pistol). Changes the save in place (each rare gun's owned mark follows its slot)
  const RARE = Object.keys(D.MAIN).filter((id) => D.MAIN[id].rare);
  R.fixGear = (save) => {
    const g = (save.gear = obj(save.gear)),
      it = E && typeof g.gun === 'string' ? E.item(g.gun) : null;
    if (!(it && it.kind === 'weapon' && usable(g.gun) && ((save.items || {})[g.gun] || 0) >= 1)) g.gun = null;
    save.owned = obj(save.owned);
    for (const id of RARE)
      if (g.gun === id) save.owned[id] = true;
      else delete save.owned[id];
    if (!save.owned[save.selected])
      save.selected = D.MAIN_ORDER.filter((id) => save.owned[id] && usable(id)).pop() || 'pistol';
    return save;
  };
  // how many of an item the stash may give away (sell, list on the market): all but the one in the gear's slot
  R.free = (save, id) => Math.max(0, ((save.items || {})[id] || 0) - (save.gear && save.gear.gun === id ? 1 : 0));
  // a gun the account plays with: owned, a rare one only while it sits in the gear's slot
  R.hasGun = (save, id) => usable(id) && !!(save.owned || {})[id] && (!D.MAIN[id].rare || (save.gear || {}).gun === id);
  R.wupOf = (save, id) => (own(save.wup, id) ? save.wup[id] : (save.wup[id] = { dmg: 0, rate: 0, mag: 0 }));
  // the items the next level of an upgrade costs on top of its coins (economy.js UPGRADES; SIM.REV 44): a = { k: 'up', id,
  // s } a gun's, { k: 'meta', s } the account's; [] at level 1, at the top, or for anything else. The save is only read
  R.upItems = (save, a) => {
    const U = E && E.UPGRADES;
    if (!U || !a || typeof a.s !== 'string') return [];
    if (a.k === 'up' && own(U.weapon, a.s)) {
      const w = save.wup && own(save.wup, a.id) ? save.wup[a.id] : null;
      return U.weapon[a.s][(w && w[a.s]) || 0] || [];
    }
    if (a.k === 'meta' && own(U.meta, a.s)) return U.meta[a.s][(save.meta && save.meta[a.s]) || 0] || [];
    return [];
  };
  // the stash short of any of these items ([[id, n], …])
  const lacks = (save, items) => items.some(([id, k]) => ((save.items || {})[id] || 0) < k);
  const spend = (save, items) => {
    for (const [id, k] of items) if (!(save.items[id] -= k)) delete save.items[id];
  };
  R.rank = (save) => D.rankOf(save.rxp).r;
  R.mastery = (save, id) => D.masteryOf(save.mast[id] || 0);
  // ---------- NEAR Base: its buildings and the junk cleared out of the old office (hub.js) ----------
  // now: ms on the clock that decides (the server's for an account, the page's for a guest)
  const baseOf = (save) => {
    const b = (save.base = obj(save.base));
    b.lv = obj(b.lv);
    b.bt = obj(b.bt);
    b.clr = obj(b.clr);
    if (!Array.isArray(b.gift)) b.gift = [];
    return b;
  };
  R.baseOf = baseOf;
  // a building's level standing now (one still going up counts from when it stands)
  R.blv = (save, id, now) => {
    const b = baseOf(save),
      n = b.lv[id] || 0;
    return n && (b.bt[id] || 0) > now ? n - 1 : n;
  };
  // a heap of junk gone (its clearing over); the heap being cleared now, or null
  R.cleared = (save, id, now) => {
    const t = baseOf(save).clr[id];
    return !!t && t <= now;
  };
  R.clearing = (save, now) => {
    const c = baseOf(save).clr;
    for (const id in c) if (c[id] > now) return id;
    return null;
  };
  // how long the next clearing takes (s): the n-th one of the base's (economy.js CLEAR_TIME)
  R.clearTime = (save) => {
    const n = Object.keys(baseOf(save).clr).length;
    return E.CLEAR_TIME[Math.min(n, E.CLEAR_TIME.length - 1)];
  };
  // Nova's base tutorial (the human's, 2026-11-11): once mission 1 is won, the generator, then the workbench, then the
  // medbay to level 1. The building it is on (the first one not paid for yet), or null: before mission 1, or all done
  R.task = (save) => {
    if (!Array.isArray(save.camp) || !save.camp.includes('office')) return null;
    const b = baseOf(save);
    for (const id of TASKS) if (!(b.lv[id] > 0)) return id;
    return null;
  };
  // the parts the first boss on the suburb's map drops in the next raid there (sim.js S.gift), once for each building
  // of the tutorial: { id, items: [[item, n], …] } or null (no task, or its parts dropped already)
  R.gift = (save) => {
    const id = R.task(save);
    if (!id || baseOf(save).gift.includes(id)) return null;
    return { id, items: E.building(id).levels[0].items.map(([i, n]) => [i, n]) };
  };
  // ---------- the day's tasks (economy.js DAILY_WALT, DAILY_NOVA; the human's, 2026-11-12): a day is a UTC day ----------
  R.day = (now) => Math.floor((Number.isFinite(now) ? now : Date.now()) / 864e5);
  const pickOf = (day) => (Math.imul(day | 0, 0x9e3779b1) >>> 0) % E.DAILY_WALT.length;
  // Walt's task of a day, [item, n]: the same for every player, not the one the day before picked
  R.waltDaily = (day) => {
    if (!E || !E.DAILY_WALT) return null;
    let i = pickOf(day);
    if (i === pickOf(day - 1)) i = (i + 1) % E.DAILY_WALT.length;
    return E.DAILY_WALT[i];
  };
  // the save's tasks as of now (only read): { d, walt, suburb, lab }; a day gone by, all of them to do again
  R.dailyOf = (save, now) => {
    const d = R.day(now),
      dy = save && save.daily;
    return dy && dy.d === d ? dy : { d, walt: false, suburb: false, lab: false };
  };
  // what Walt pays for the task (his shelf: stock): DAILY_WALT_K times what selling it to him pays, and always less than
  // buying them back from him would cost once he has them (bought from him and handed back, they never earn: a scarce
  // trophy's price moves a lot with his stock)
  R.waltPay = ([id, n], stock) => {
    const st = int(obj(stock)[id], 1e9),
      sale = E.sellTotal(id, n, st);
    return Math.max(sale, Math.min(Math.ceil(E.DAILY_WALT_K * sale), E.buyTotal(id, n, st + n) - 1));
  };
  // One purchase or choice on a save: a = { k: 'buy', id } a gun (from its rank, for its price; it becomes the primary), { k: 'sel', id }
  // the primary among the guns owned, { k: 'up', id, s: 'dmg'|'rate'|'mag' } a gun's upgrade (owned, up to its mastery level; the base's
  // workbench standing; its coins and, from level 2, its items: R.upItems), { k: 'meta', s } a permanent upgrade (the base's medbay
  // standing; coins and items as a gun's), { k: 'vote', id } a roadmap vote, { k: 'lang', v }
  // the language, { k: 'nick', v } a new name (R.nick), { k: 'sell', id, n } n of an item from the stash to Walt, { k: 'wbuy', id, n } n
  // from Walt's shelf (ctx.stock: his shelf, { id: n }, changed too: the server's for an account, the page's copy of it for a guest),
  // { k: 'build', id } a building's next level at the base (its items and coins spent; it stands BUILD_TIME s later), { k: 'clear', id }
  // a heap of junk cleared at the base (free; CLEAR_TIME s, one at a time). ctx.now: the clock's ms (default: this one's). Changes the
  // save and returns null, or returns why not (and leaves it as it was).
  R.act = (save, a, ctx) => {
    a = obj(a);
    const c = obj(ctx),
      now = Number.isFinite(c.now) ? c.now : Date.now();
    if (a.k === 'sell' || a.k === 'wbuy') return trade(save, a, c);
    // Walt's task of the day: its items sold to him (his shelf takes them, ctx.stock as a sale's) at DAILY_WALT_K times
    // the sale, once a day
    if (a.k === 'daily') {
      const task = R.waltDaily(R.day(now)),
        dy = R.dailyOf(save, now);
      if (!task) return 'unknown';
      if (dy.walt) return 'done';
      if (((save.items || {})[task[0]] || 0) < task[1]) return 'items';
      const st = obj(c.stock),
        sale = E.sellTotal(task[0], task[1], int(st[task[0]], 1e9)),
        pay = R.waltPay(task, st);
      const err = trade(save, { k: 'sell', id: task[0], n: task[1] }, c);
      if (err) return err;
      save.coins += pay - sale;
      save.daily = dy;
      dy.walt = true;
      return null;
    }
    if (a.k === 'build') return build(save, a, now);
    if (a.k === 'clear') return clear(save, a, now);
    if (a.k === 'buy') {
      if (!usable(a.id) || D.MAIN[a.id].rare) return 'unknown gun'; // (a rare gun: never for coins)
      const d = D.MAIN[a.id];
      if (save.owned[a.id]) return 'owned';
      if (R.rank(save) < d.rank) return 'rank';
      if (save.coins < d.price) return 'coins';
      save.coins -= d.price;
      save.owned[a.id] = true;
      save.selected = a.id;
      return null;
    }
    // { k: 'gear', slot: 'gun', id } a rare gun from the stash into the gear's gun slot (it becomes the primary), id '' (or none)
    // takes it out (the primary falls back)
    if (a.k === 'gear') {
      if (a.slot !== 'gun') return 'unknown slot';
      save.gear = obj(save.gear);
      if (!a.id) {
        if (!save.gear.gun) return 'empty';
        save.gear.gun = null;
        R.fixGear(save);
        return null;
      }
      const it = E && typeof a.id === 'string' ? E.item(a.id) : null;
      if (!it || it.kind !== 'weapon' || !usable(a.id)) return 'not a gun';
      if (((save.items || {})[a.id] || 0) < 1) return 'not enough';
      save.gear.gun = a.id;
      R.fixGear(save);
      save.selected = a.id;
      return null;
    }
    if (a.k === 'sel') {
      if (!R.hasGun(save, a.id)) return 'not owned';
      save.selected = a.id;
      return null;
    }
    if (a.k === 'up') {
      if (!R.hasGun(save, a.id)) return 'not owned';
      if (typeof a.s !== 'string' || !own(D.WEAPON_UP, a.s)) return 'unknown upgrade';
      const u = R.wupOf(save, a.id),
        lv = u[a.s] || 0,
        P = D.WEAPON_UP[a.s].price[lv];
      if (P === undefined) return 'max';
      if (lv >= R.mastery(save, a.id)) return 'mastery';
      if (E && R.blv(save, 'workbench', now) < 1) return 'workbench';
      if (save.coins < P) return 'coins';
      const need = R.upItems(save, a);
      save.items = obj(save.items);
      if (lacks(save, need)) return 'items';
      save.coins -= P;
      spend(save, need);
      u[a.s] = lv + 1;
      return null;
    }
    if (a.k === 'meta') {
      if (typeof a.s !== 'string' || !own(D.META, a.s)) return 'unknown upgrade';
      const m = D.META[a.s],
        lv = save.meta[a.s] || 0,
        P = m.price[lv];
      if (lv >= m.max || P === undefined) return 'max';
      if (E && R.blv(save, 'medbay', now) < 1) return 'medbay';
      if (save.coins < P) return 'coins';
      const need = R.upItems(save, a);
      save.items = obj(save.items);
      if (lacks(save, need)) return 'items';
      save.coins -= P;
      spend(save, need);
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
  // what Walt pays at most for the proven items the page no longer holds (sold to him). What the page bought with them —
  // its guns, their upgrades, the cat's, the base's buildings and cleared heaps — comes along too, bought again here on
  // what the runs earned (bought, below; 2026-11-12: a connected wallet used to lose the guest's upgrades and the
  // coins paid for them); the coins and items left are what that leaves, no more than the page still has. Records
  // start afresh; the face is the page's. No proof (a device the server never saw play a mission, or one already taken
  // into another account): the face alone. now: the server's clock (the base's times)
  R.ADOPT = { coins: 2000, rxp: 1500 };
  R.adopt = (save, proof, guest, now) => {
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
        if (E && E.tradable(id)) sold += (p.items[id] - n) * E.buyPrice(id, 0);
      }
      const B = bought(p, g, sold, save.camp, Number.isFinite(now) ? now : Date.now());
      for (const id in B.items) {
        const n = Math.min(B.items[id], g.items[id] || 0);
        if (n > 0) save.items[id] = Math.max(save.items[id] || 0, n);
      }
      save.coins = Math.max(save.coins, Math.min(g.coins, B.coins, R.ADOPT.coins));
      save.rxp = Math.max(save.rxp, Math.min(g.rxp, p.rxp, R.ADOPT.rxp));
      save.owned = B.owned;
      save.selected = B.selected;
      save.wup = B.wup;
      save.meta = B.meta;
      save.mast = B.mast;
      save.base = B.base;
    }
    if (g.nick) save.nick = g.nick;
    if (g.ava !== null) save.ava = g.ava;
    if (g.bg !== null) save.bg = g.bg;
    if (g.language) save.language = g.language;
    return save;
  };
  // the page's purchases bought again on what its runs earned (adopt): a save with the runs' coins (and Walt's most for
  // the proven items no longer held), their items, kills and missions, the lower of the two ranks; on it, in an order
  // that works, the heaps the page cleared, its buildings level by level (as many rounds as one needing another takes),
  // its guns, their upgrades, the cat's — each through the rules (R.act), parts a step lacks bought from Walt at his
  // price for a usual shelf; whatever they refuse (the coins run out, a rank not reached) is left out
  function bought(p, g, sold, camp, now) {
    const B = R.defaults(),
      ctx = { now },
      b = baseOf(B),
      gb = baseOf(g);
    B.camp = camp.slice();
    B.coins = p.coins + sold;
    B.items = { ...p.items };
    B.rxp = Math.min(g.rxp, p.rxp);
    for (const id in p.mast) if (g.mast[id] > 0) B.mast[id] = Math.min(p.mast[id], g.mast[id]);
    b.gift = baseOf(p).gift.slice();
    const step = (a) => {
      const err = R.act(B, a, ctx);
      if (err !== 'items' || !E) return err;
      const need =
        a.k === 'build' ? (E.building(a.id).levels[b.lv[a.id] || 0] || { items: [] }).items : R.upItems(B, a);
      let cost = 0;
      for (const [id, k] of need) {
        const lack = k - (B.items[id] || 0),
          it = E.item(id);
        if (lack <= 0) continue;
        const P = it && E.tradable(id) ? E.sellPrice(id, Math.max(1, it.norm || 1)) : 0;
        if (!P) return err;
        cost += P * lack;
      }
      if (cost > B.coins) return 'coins';
      B.coins -= cost;
      for (const [id, k] of need) B.items[id] = Math.max(B.items[id] || 0, k);
      return R.act(B, a, ctx);
    };
    if (E) {
      for (const id of E.JUNK) if (gb.clr[id] > 0) b.clr[id] = gb.clr[id];
      let more = true;
      for (let r = 0; more && r < 20; r++) {
        more = false;
        for (const bd of E.BUILDINGS) {
          const want = Math.min(gb.lv[bd.id] || 0, bd.levels.length);
          while ((b.lv[bd.id] || 0) < want && !step({ k: 'build', id: bd.id })) {
            b.bt[bd.id] = now - 1; // (standing at once: the next level, or another building, may need it)
            more = true;
          }
        }
      }
      for (const id in b.lv) if (gb.bt[id] > now) b.bt[id] = gb.bt[id]; // (going up on the page: its time as there)
    }
    for (const id of D.MAIN_ORDER) if (g.owned[id] && !B.owned[id]) step({ k: 'buy', id });
    for (const id of D.MAIN_ORDER) {
      if (!B.owned[id] || !g.wup[id]) continue;
      for (const s in D.WEAPON_UP)
        while ((R.wupOf(B, id)[s] || 0) < (g.wup[id][s] || 0)) if (step({ k: 'up', id, s })) break;
    }
    for (const s in D.META) while ((B.meta[s] || 0) < (g.meta[s] || 0)) if (step({ k: 'meta', s })) break;
    B.selected = B.owned[g.selected] ? g.selected : 'pistol';
    return B;
  }
  // an account made before adopt took the page's purchases along (2026-11-12): once, signing in again from the guest's page on
  // that device, what they add — guns, upgrades, the base's levels and heaps, kills — each kept where the account has more.
  // The coins stay as they came then, and what came then is off what they are bought with here (the proven coins count
  // once: a page that came in with most of them buys little now). True when something was added
  R.topUp = (save, proof, guest, now) => {
    if (!proof) return false;
    const p = R.clean(proof),
      then = Math.min(R.clean(guest).coins, p.coins, R.ADOPT.coins),
      A = R.adopt(R.defaults(), { ...p, coins: Math.max(0, p.coins - then) }, guest, now),
      sb = baseOf(save),
      ab = baseOf(A);
    let n = 0;
    const more = (o, k, v) => {
      if ((v || 0) > (o[k] || 0)) {
        o[k] = v;
        n++;
      }
    };
    for (const id in A.owned)
      if (A.owned[id] && !save.owned[id]) {
        save.owned[id] = true;
        n++;
      }
    for (const id in A.wup) for (const s in A.wup[id]) more(R.wupOf(save, id), s, A.wup[id][s]);
    for (const s in A.meta) more(save.meta, s, A.meta[s]);
    for (const id in A.mast) more(save.mast, id, A.mast[id]);
    for (const id in ab.clr) if (!sb.clr[id]) more(sb.clr, id, ab.clr[id]);
    for (const id in ab.lv)
      if ((ab.lv[id] || 0) > (sb.lv[id] || 0)) {
        more(sb.lv, id, ab.lv[id]);
        sb.bt[id] = ab.bt[id];
      }
    return n > 0;
  };
  // a building's next level: the one before it standing, its room cleared, the generator's level, a trophy lock, the
  // coins and the items in the stash; paid now, standing BUILD_TIME s later
  function build(save, a, now) {
    const B = E && typeof a.id === 'string' ? E.building(a.id) : null;
    if (!B) return 'unknown building';
    const b = baseOf(save),
      n = b.lv[B.id] || 0,
      next = B.levels[n];
    if (!next) return 'max';
    if (n && (b.bt[B.id] || 0) > now) return 'busy';
    const room = E.ROOM[B.id];
    if (room && !R.cleared(save, room, now)) return 'room';
    if ((next.power || 0) > R.blv(save, 'generator', now)) return 'power';
    if (B.lockedBy && !((save.items || {})[B.lockedBy] > 0) && !(save.held || []).includes(B.lockedBy)) return 'locked';
    if (save.coins < (next.coins || 0)) return 'coins';
    save.items = obj(save.items);
    for (const [id, k] of next.items) if ((save.items[id] || 0) < k) return 'items';
    save.coins -= next.coins || 0;
    for (const [id, k] of next.items) if (!(save.items[id] -= k)) delete save.items[id];
    b.lv[B.id] = n + 1;
    b.bt[B.id] = now + 1000 * E.BUILD_TIME[Math.min(n, E.BUILD_TIME.length - 1)];
    return null;
  }
  // a heap of junk: once, one at a time, free
  function clear(save, a, now) {
    if (!E || typeof a.id !== 'string' || !E.JUNK.includes(a.id)) return 'unknown junk';
    const b = baseOf(save);
    if (b.clr[a.id]) return 'cleared';
    if (R.clearing(save, now)) return 'busy';
    b.clr[a.id] = now + 1000 * R.clearTime(save);
    return null;
  }
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
      if (R.free(save, a.id) < n) return 'not enough'; // (the gun in the gear's slot: taken out first)
      save.coins += E.sellTotal(a.id, n, have);
      save.items[a.id] -= n;
      if (it.kind === 'trophy') {
        save.held = Array.isArray(save.held) ? save.held : [];
        if (!save.held.includes(a.id)) save.held.push(a.id);
      }
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
      p = co && Number.isInteger(i) ? S.ps[i] || S.p : S.p,
      // a run left after its win without the evac (the pause menu's To lobby, a partner gone): a full extraction all the
      // same (docs/design.md: a boss kill is a full extraction) — the win, and the backpacks of the heroes still in it
      won = !o && !!(S.mis ? S.mis.won : S.winAt),
      kept = o ? !!(o.evac && p.evac) : won && !p.gone && !p.out && (!p.dead || !!p.down);
    const out = {
      t: o ? o.t : won && S.winAt ? S.winAt - 2.5 : S.t,
      kills: co ? p.kills || 0 : o ? o.kills : S.kills,
      bk: S.bk || 0,
      win: !!(o ? o.win : won),
      lvl: o ? o.lvl : p.lvl,
      coins: o ? o.coins : S.coins,
      gun: p.main.id,
      bag: R.carried(p, kept),
    };
    if (co) out.coop = 1;
    if (S.mis) out.mission = S.mis.id;
    // the raid's map, for Nova's tasks of the day (the suburb's: the sim's 'city')
    const SM = root.SIM || (typeof module !== 'undefined' ? require('./sim.js') : null),
      mk = SM && SM.mapOf && Number.isFinite(S.seed) ? SM.mapOf(S.seed) : '';
    if (mk === 'city' || mk === 'lab') out.map = mk === 'city' ? 'suburb' : 'lab';
    if (S.gift && S.gift.done) out.gift = S.gift.id; // (the base tutorial's parts dropped: rules.js gift, sim.js)
    return out;
  };
  R.WIN_BONUS = 500;
  // Nova's task of the day on a map is open once the campaign has reached it: the suburbs' after mission 1, the lab's after
  // mission 2 (hub.js shows the others locked)
  R.dailyOpen = (save, map) => {
    const camp = save && Array.isArray(save.camp) ? save.camp : [];
    return map === 'suburb' ? camp.includes('office') : map === 'lab' ? camp.includes('suburb') : false;
  };
  // A run's end pays into the save once: its coins and the win bonus, the survivor rank's XP (D.runXp) with the coins of every rank it
  // passes, and its kills to the mastery of the gun it was played with. The current campaign mission (R.current) won
  // also pays its reward (economy.js MISSIONS: its coins, its XP as the rank's part 'mission'; its items the hero picked
  // up where they fell, as the rest) and is kept as finished (save.camp). What the hero brought out (o.bag) goes into
  // the stash. Returns what it paid (for the results screen: items, [[id, n], …]).
  R.bank = (save, o, now) => {
    const win = !!o.win,
      bonus = win ? R.WIN_BONUS : 0,
      gun = usable(o.gun) ? o.gun : 'pistol',
      kills = int(o.kills, 1e9);
    const mis = win && E && typeof o.mission === 'string' ? E.mission(o.mission) : null,
      first = !!mis && !!mis.reward && R.current(save) === mis.id,
      mc = first ? int(mis.reward.coins, 1e9) : 0;
    const parts = D.runXp({ t: o.t, kills, bosses: o.bk, win, lvl: o.lvl });
    if (first) parts.mission = int(mis.reward.xp, 1e9);
    // Nova's task of the day on this raid's map (economy.js DAILY_NOVA): won on the suburb's or the lab's, once a day each
    // (now: the run's end on the clock that decides — the server's for an account), and only once the campaign has opened
    // that map (R.dailyOpen; the base shows it locked till then) — the human's, 2026-11-12: a lab won together before the
    // suburbs' mission paid her lab task he had never been given, and then she had none for him
    const nk =
        win && E && E.DAILY_NOVA && (o.map === 'suburb' || o.map === 'lab') && R.dailyOpen(save, o.map) ? o.map : null,
      nday = nk ? R.dailyOf(save, now) : null,
      daily =
        nday && !nday[nk]
          ? { id: nk, coins: int(E.DAILY_NOVA[nk].coins, 1e9), xp: int(E.DAILY_NOVA[nk].xp, 1e9) }
          : null;
    if (daily) parts.daily = daily.xp;
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
    const coins = int(o.coins, 1e9) + bonus + rc + mc + (daily ? daily.coins : 0);
    const gain = { parts, xp0: save.rxp, xp, rc, opened, gun, m0, m1: m0 + kills, bonus, coins, daily };
    if (daily) {
      save.daily = nday;
      nday[nk] = true;
    }
    gain.mission = first ? { id: mis.id, coins: mc, xp: parts.mission } : null;
    gain.items = [];
    if (first) save.camp.push(mis.id);
    save.items = obj(save.items);
    for (const b of Array.isArray(o.bag) ? o.bag : [])
      if (Array.isArray(b) && E && E.item(b[0]) && int(b[1], 1e6) > 0) {
        save.items[b[0]] = (save.items[b[0]] || 0) + int(b[1], 1e6);
        gain.items.push([b[0], int(b[1], 1e6)]);
      }
    // (the tutorial's parts dropped in this run: that building's gift given, whatever the hero carried out)
    const g = E && typeof o.gift === 'string' ? R.gift(save) : null;
    if (g && g.id === o.gift) baseOf(save).gift.push(g.id);
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
