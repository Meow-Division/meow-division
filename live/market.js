// live/market.js — the base's windows over NEAR Base (docs/design.md, "Walt's market" and "Hub base"): the stash (what
// the player holds: economy.js items, rules.js save.items) and Walt's trade window (the stash beside his shelf; sell to
// him, buy from him, his prices from his shelf: economy.js sellTotal / buyTotal, his reasons: economy.js explain).
// Built as a game's trader screen: a slot grid on each side, the item picked in the middle with its price, how many
// (one by default, all at a tap) and the total, the trade button counting it; Walt's portrait over a speech bubble
// that answers what is picked. A sale is made by holding its button down for HOLD ms (it fills up; no "are you sure":
// the human's, 2026-11-11); a dear buy asks once more. The first sale, while no wallet is connected, ends with Nova's offer
// to keep it all in one (design: "Player path" 6, nova.13).
// The lesson (hub.js, Nova's base tutorial): the first time Walt's window opens with the cleaver in the stash it stays up
// until the cleaver is sold — no close — Walt says how (walt.2) and a pointer shows where to tap, then what to hold; the
// sale done, he sends Copper to Nova (walt.3). His guns (a tab beside his goods): the ones Copper's rank opens, bought for
// coins into the account (rules.js buy; not items, never on the wallet); the workbench upgrades them (hub.js).
// Items the base needs now (hub.js needed) carry a check in their slot's corner.
// Walt's shelf comes from the server (GET /api/walt: one shelf for every player); out of its reach the page makes up
// the week the server would have opened with. With it come his words by NEAR AI in the page's language
// (server/waltai.mjs): a note on the day's market said when the window opens, a line for each item at its price's state
// said when it is picked. They hold slots, never numbers: the page fills them from the formula (economy.js) and the
// shelf it has, shows them escaped, and marks them NEAR AI; while there are none, the plain texts stay. A guest's trade changes the page's copy of the shelf; an account's goes
// to the server (wallet.js), whose shelf decides. While a window is up the hero stands (index.html __modal).
// The players' market (his Market tab: server/market.mjs): the site's market page in a frame (market.html?embed=1), the same
// order book, sales from the stash and payment through NEAR Intents; it asks this page to sign in (the game's wallet
// window) and tells it when the stash changed (the save read again: wallet.js reload).
// Fast-forward a week (for judges: docs/design.md, "Walt's market"): the other players' week at his shelf
// (economy.js otherPlayersDay) played out in a minute, step by step, on a copy of the shelf in this window only.
(function () {
  const M = (window.MARKET = {}),
    E = window.ECONOMY;
  const API = window.SAVE_API || '/api',
    FRESH = 20e3, // (ms: the shelf fetched again when older than this)
    OFFER = 'wallet.offer'; // (SAVE.seen: the wallet's offer made once)
  const T = (k, v) => I18N.t(k, v),
    fmtN = (n) => I18N.num(n);
  const pic = (id) => `assets/it_${id}.png?v=${window.__V || 0}`,
    por = (who) => `assets/por_${who}.png?v=${window.__V || 0}`;
  const CLOSE =
    '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
  const BOX =
    '<svg viewBox="0 0 24 24"><path d="M3 8.5L12 4l9 4.5v8L12 21l-9-4.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M3 8.5l9 4.5 9-4.5M12 13v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';

  // ---------- Walt's shelf ----------
  let shelf = { stock: {}, recent: {}, day: 0, at: 0, off: false, lines: {}, note: null },
    asking = null,
    again = 0; // (asked again while the server says more words are on their way: a few times a window)
  // the week before the market opened, made up in this page (the server out of reach): the same days the server
  // would have gone through, on a random of its own
  function madeUp() {
    let x = 0x9e3779b9;
    const u = () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
    const stock = {};
    for (let d = 0; d < E.FAST_FORWARD.days; d++) E.otherPlayersDay(stock, u);
    for (const [id, n] of Object.entries(E.WALT_BASICS || {})) stock[id] = Math.max(stock[id] || 0, n); // (as the server's: walt.mjs basics)
    return stock;
  }
  function fetchShelf(force) {
    if (asking || (!force && Date.now() - shelf.at < FRESH)) return asking || Promise.resolve();
    asking = fetch(API + '/walt?lang=' + encodeURIComponent(I18N.lang), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
      .then((j) => {
        // (wallet: Walt's account while his shelf is on his own wallet, server/chain.mjs; while a fast-forward runs
        // on its copy, the shelf fetched waits beside it)
        const got = {
          stock: j.stock || {},
          recent: j.recent || {},
          day: j.day || 0,
          at: Date.now(),
          off: false,
          wallet: typeof j.wallet === 'string' ? j.wallet : null,
          lines: j.lines && typeof j.lines === 'object' ? j.lines : {},
          note: j.note && typeof j.note.t === 'string' ? j.note : null,
        };
        if (ff) ff.real = got;
        else shelf = got;
        if (j.pending && el && mode === 'walt' && again < 4) {
          again++;
          setTimeout(() => el && fetchShelf(true), 5000);
        }
      })
      .catch((e) => {
        console.warn('walt shelf', e && e.message);
        if (!shelf.at)
          shelf = { stock: madeUp(), recent: {}, day: 0, at: Date.now(), off: true, lines: {}, note: null };
        else (ff ? ff.real : shelf).off = true;
      })
      .finally(() => {
        asking = null;
        if (el) paint();
      });
    return asking;
  }
  // a trade's context: a copy of the shelf as the page has it (rules.js act changes what it is given)
  M.ctx = () => ({ stock: { ...shelf.stock } });
  M.shelf = () => shelf;

  // ---------- the window ----------
  let el = null,
    mode = 'stash', // 'stash' | 'walt'
    tab = 'goods', // Walt's right side: 'goods' (his shelf) | 'guns' | 'daily' (his task of the day) | 'mkt' (the players' market)
    lesson = false, // (the cleaver's sale taught: the window stays until it is done)
    sel = null, // { id, side: 'me' | 'walt' } or { gun }
    qty = 1,
    sure = 0, // (performance.now() of the first tap on a trade that asks twice)
    say = '', // what Walt says in his bubble (a language key and its numbers)
    sayV = null,
    line = null, // (his line by NEAR AI for the item picked: a text with slots, filled from sayV)
    offerUp = false,
    need = null, // (a base building's window opened this one: { b, items } its next level needs)
    sureM = 0, // (performance.now() of the first tap on "buy what's missing" when it asks twice)
    shut = null; // (opened from the lobby or a page: their numbers redrawn once this one shuts)
  M.isOpen = () => !!el;
  // the stash's order: rare guns, trophies, then by rarity, then materials before kits, then by name
  const KIND = { weapon: -1, trophy: 0, material: 1, kit: 2 };
  // what of an item the stash shows (and may sell): all but the gun in the gear's slot (rules.js free)
  const free = (id) => RULES.free(SAVE, id);
  function sorted(ids) {
    return ids
      .map((id) => E.item(id))
      .filter(Boolean)
      .sort(
        (a, b) =>
          KIND[a.kind] - KIND[b.kind] || b.rarity - a.rarity || T('item.' + a.id).localeCompare(T('item.' + b.id)),
      );
  }
  const mine = () => sorted(Object.keys(SAVE.items || {}).filter((id) => free(id) > 0));
  const his = () => sorted(Object.keys(shelf.stock).filter((id) => shelf.stock[id] > 0 && E.tradable(id)));

  M.open = (m, opts) => {
    if (el) M.close(true);
    mode = m === 'walt' ? 'walt' : 'stash';
    opts = opts || {};
    lesson = mode === 'walt' && !!opts.lesson;
    shut = typeof opts.onClose === 'function' ? opts.onClose : null;
    need = mode === 'walt' && opts.need && Array.isArray(opts.need.items) ? opts.need : null;
    sureM = 0;
    tab = mode === 'walt' && ['guns', 'daily', 'mkt'].includes(opts.tab) && !lesson ? opts.tab : 'goods';
    said = null;
    sel = null;
    qty = 1;
    sure = 0;
    say = lesson
      ? 'market.lesson.pick'
      : mode === 'walt'
        ? tab === 'guns'
          ? 'market.gunsHello'
          : tab === 'daily'
            ? 'market.dailyHello'
            : tab === 'mkt'
              ? 'market.mktHello'
              : 'market.hello'
        : '';
    sayV = null;
    line = null;
    again = 0;
    offerUp = false;
    el = document.createElement('div');
    el.id = 'mkt';
    el.className = 'mk-' + mode;
    document.getElementById('ui').appendChild(el);
    window.__modal = true;
    addEventListener('keydown', onKey, true);
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', onDown);
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('whoosh0', 0.25);
    if (lesson && window.VOICE) VOICE.say('walt.2', true);
    paint();
    requestAnimationFrame(() => el && el.classList.add('on'));
    fetchShelf(mode === 'walt');
    chainFetch();
  };
  // force: the base itself closing (the lesson's window goes with it)
  M.close = (force) => {
    if (!el || (lesson && !force)) return;
    holdEnd();
    ffEnd();
    removeEventListener('keydown', onKey, true);
    const old = el;
    el = null;
    window.__modal = false;
    old.classList.remove('on');
    old.classList.add('gone');
    setTimeout(() => old.remove(), 220);
    const cb = shut;
    shut = null;
    if (cb)
      try {
        cb();
      } catch (e) {}
  };
  function onKey(e) {
    if (!el) return;
    if (e.code === 'Escape' || (e.code === 'KeyE' && !offerUp) || (e.code === 'KeyI' && mode === 'stash')) {
      e.preventDefault();
      e.stopPropagation();
      if (offerUp) offer(false);
      else M.close(); // (not while the lesson is on)
      return;
    }
    // (the game's keys don't reach the base under the window; typing nothing here, so all of them stop)
    if (!e.ctrlKey && !e.metaKey && !/^F\d+$/.test(e.code)) e.stopPropagation();
  }
  function onClick(e) {
    const t = e.target.closest('[data-a]');
    if (!t || t.disabled) {
      if (e.target === el) M.close(); // (the dark round the window)
      return;
    }
    const a = t.dataset.a;
    if (a === 'close') M.close();
    else if (a === 'slot') pick(t.dataset.id, t.dataset.side);
    else if (a === 'gun') pickGun(t.dataset.id);
    else if (a === 'gearslot') {
      sel = { gear: 'gun' };
      paint();
    } else if (a === 'equip') gear(sel && sel.id);
    else if (a === 'unequip') gear('');
    else if (a === 'daily') handDaily();
    else if (a === 'tab') {
      tab = ['guns', 'daily', 'mkt'].includes(t.dataset.tab) ? t.dataset.tab : 'goods';
      sel = null;
      sure = 0;
      line = null;
      say =
        tab === 'guns'
          ? 'market.gunsHello'
          : tab === 'daily'
            ? 'market.dailyHello'
            : tab === 'mkt'
              ? 'market.mktHello'
              : 'market.hello';
      sayV = null;
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.3);
      paint();
    } else if (a === 'buygun') buyGun();
    else if (a === 'buymiss') buyMiss();
    else if (a === 'minus') setQty(qty - 1);
    else if (a === 'plus') setQty(qty + 1);
    else if (a === 'all') setQty(maxQty());
    else if (a === 'trade') {
      if (!t.classList.contains('hold')) trade(); // (a sale: held down, onDown)
    } else if (a === 'ff') ffStart();
    else if (a === 'ffback') {
      ffEnd();
      fetchShelf(true);
      paint();
    } else if (a === 'connect') {
      offer(false);
      if (window.WALLET) WALLET.connect();
    } else if (a === 'create') {
      // (the game's own wallet window, over the base: wallet.js closes this one; the lobby's wallet button and the
      // settings offer both again later)
      offer(false);
      if (window.WALLET) WALLET.create();
    } else if (a === 'later') offer(false);
  }
  function pick(id, side) {
    if (!id) return;
    sel = { id, side: mode === 'walt' ? side : 'me' };
    qty = 1;
    sure = 0;
    if (lesson) {
      // (the lesson: the cleaver picked, hold the button; anything else, the cleaver again)
      say = id === 't_butcher' && sel.side === 'me' ? 'market.lesson.hold' : 'market.lesson.pick';
      sayV = null;
      line = null;
    } else if (mode === 'walt') {
      const w = E.explain(id, shelf.stock[id] || 0, shelf.recent[id] || 0),
        l = shelf.lines[id];
      say = w.key;
      sayV = w.vars;
      // (his line for the item's state now, one of its two in turn; the plain reason when it is in another state here)
      line =
        l && l.s === w.key.split('.').pop() && Array.isArray(l.t) && l.t.length
          ? String(l.t[(turns[id] = ((turns[id] ?? -1) + 1) % l.t.length)])
          : null;
    }
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.3);
    paint();
  }
  // how many the trade can be at most: what the stash holds (selling), what Walt holds and the coins pay for (buying)
  function maxQty() {
    if (!sel) return 1;
    const have = free(sel.id),
      stock = shelf.stock[sel.id] || 0;
    if (sel.side === 'me') return Math.max(1, have);
    let n = 0;
    while (n < stock && E.buyTotal(sel.id, n + 1, stock) <= SAVE.coins) n++;
    return Math.max(1, n);
  }
  function setQty(n) {
    qty = Math.max(1, Math.min(maxQty(), n));
    sure = 0;
    paint();
  }
  // asks once more: a buy of SURE coins and more (a sale is held down instead: HOLD) — 200 before his asks went × 5 (REV 45)
  const SURE = 1000;
  function asksTwice() {
    return sel.side !== 'me' && E.buyTotal(sel.id, qty, shelf.stock[sel.id] || 0) >= SURE;
  }
  // ---------- a sale held down ----------
  const HOLD = 2000; // ms the sale's button is held for (the human's: 2 s, filling up)
  let hold = null; // { btn, timer, again (a paint asked for meanwhile) }
  function onDown(e) {
    const t = e.target.closest('[data-a="trade"].hold');
    if (!t || t.disabled || hold || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try {
      t.setPointerCapture(e.pointerId);
    } catch (er) {}
    hold = { btn: t, timer: setTimeout(holdDone, HOLD) };
    t.style.setProperty('--hold', HOLD + 'ms');
    t.classList.add('holding');
    const stop = () => holdEnd(true);
    t.addEventListener('pointerup', stop, { once: true });
    t.addEventListener('pointercancel', stop, { once: true });
    t.addEventListener('lostpointercapture', stop, { once: true });
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.25);
  }
  // let go early: nothing sold (cancelled), or the base closing the window
  function holdEnd(cancelled) {
    if (!hold) return;
    clearTimeout(hold.timer);
    const again = hold.again;
    if (hold.btn) hold.btn.classList.remove('holding');
    hold = null;
    if (again || cancelled) paint();
  }
  function holdDone() {
    if (!hold) return;
    hold.btn = null;
    holdEnd(false);
    trade();
  }
  function trade() {
    if (!sel || mode !== 'walt' || ff) return;
    if (asksTwice() && performance.now() - sure > 3000) {
      sure = performance.now();
      paint();
      return;
    }
    const k = sel.side === 'me' ? 'sell' : 'wbuy',
      id = sel.id,
      stock = shelf.stock[id] || 0,
      sum = k === 'sell' ? E.sellTotal(id, qty, stock) : E.buyTotal(id, qty, stock),
      first = k === 'sell' && !SAVE.seen('walt.sold');
    // a guest's trade changes the page's shelf itself; an account's is sent (the server's shelf decides, fetched again)
    if (lesson && !(k === 'sell' && id === 't_butcher')) return; // (the lesson: the cleaver's sale only)
    const ctx = SAVE.profile ? M.ctx() : shelf,
      err = SAVE.act({ k, id, n: qty }, ctx);
    sure = 0;
    line = null;
    if (err) {
      say = 'market.no.' + (err === 'coins' ? 'coins' : err === 'out of stock' ? 'stock' : 'other');
      sayV = null;
      paint();
      return;
    }
    if (SAVE.profile) setTimeout(() => fetchShelf(true), 1500);
    chainFetch(500);
    chainFetch(6000); // (its change done on the wallet by then)
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.45);
    say = k === 'sell' ? 'market.thanks' : 'market.bought';
    sayV = null;
    flash(k === 'sell' ? '+' + fmtN(sum) : '−' + fmtN(sum), k === 'sell');
    // the picked item gone from the stash (all sold): the pick goes
    if (k === 'sell' && !(free(id) > 0)) sel = null;
    qty = 1;
    paint();
    // (the lesson done: Walt sends Copper on to Nova, the window can close)
    if (lesson && id === 't_butcher') {
      lesson = false;
      say = 'market.lesson.done';
      if (window.VOICE) VOICE.say('walt.3', true);
      paint();
    }
    if (first) {
      SAVE.see('walt.sold');
      // Nova's wallet offer: its window comes up as she starts on it (nova.13), after Walt's "let's see what Nova says"
      // (walt.3) is over, not over him (the human's, 2026-11-12); the window shut by then, no offer
      if (window.WALLET && WALLET.available && !WALLET.account && !SAVE.seen(OFFER)) {
        // (Walt's window shut before she came to it: her card on its own over the base — the human's, 2026-11-12: closed
        // after the sale, her offer never came)
        const up = () => {
          if (SAVE.seen(OFFER) || WALLET.account) return;
          if (!el) solo(true);
          else if (!offerUp) offer(true);
        };
        if (window.VOICE) VOICE.say('nova.13', false, up);
        else setTimeout(up, 900);
      }
    }
  }
  // ---------- Walt's task of the day (rules.js daily, economy.js DAILY_WALT; the human's, 2026-11-12) ----------
  // the task now ([item, n]) and whether it is done; ready: the stash holds it all and it isn't done (his tab glows)
  const daily = () => {
    const now = Date.now(),
      task = window.RULES && RULES.waltDaily ? RULES.waltDaily(RULES.day(now)) : null;
    return task ? { task, done: RULES.dailyOf(SAVE, now).walt } : null;
  };
  const dailyReady = () => {
    const d = daily();
    return !!d && !d.done && ((SAVE.items || {})[d.task[0]] || 0) >= d.task[1];
  };
  M.dailyReady = dailyReady;
  // the time left until a new task (the next UTC midnight)
  const untilNew = () => {
    const m = Math.ceil((864e5 - (Date.now() % 864e5)) / 60e3);
    return T('market.dailyIn', { h: Math.floor(m / 60), m: m % 60 });
  };
  // his tab: the item (a tap picks it, the stash's or his), how many and the stash's count, what selling them pays and
  // what he pays for the task, the button that hands them over; done: a new one tomorrow
  function dailyPanel() {
    const d = daily();
    if (!d) return '';
    const [id, n] = d.task,
      it = E.item(id),
      have = (SAVE.items || {})[id] || 0,
      sale = E.sellTotal(id, n, shelf.stock[id] || 0),
      pay = RULES.waltPay(d.task, shelf.stock),
      can = !d.done && have >= n && !ff;
    let h =
      `<div class="mk-daily"><button class="mk-slot mk-dl-it r${it.rarity}${have >= n ? ' ok' : ''}" data-a="slot" data-id="${id}" data-side="${have ? 'me' : 'walt'}" title="${esc(T('item.' + id))}">` +
      `<img src="${pic(id)}" alt="" draggable="false"><span class="mk-n">${fmtN(Math.min(have, n))}/${fmtN(n)}</span></button>` +
      `<p class="mk-dl-ask">${T('market.dailyAsk', { n: fmtN(n), item: T('item.' + id) })}</p>` +
      `<div class="mk-row"><span>${T('market.dailySale')}</span><b>${coinI()}${fmtN(sale)}</b></div>` +
      `<div class="mk-row tot"><span>${T('market.dailyPay')}</span><b>${coinI()}${fmtN(pay)}</b></div>`;
    h += d.done
      ? `<div class="mk-tk-ok">${CHK}<span>${T('market.dailyDone')}</span></div>`
      : `<button class="btn green mk-go" data-a="daily" ${can ? '' : 'disabled'}>${T('market.dailyGive')}</button>` +
        (have < n ? `<div class="mk-note">${T('market.dailyShort', { n: fmtN(n - have) })}</div>` : '');
    return h + '</div>';
  }
  function handDaily() {
    if (ff || mode !== 'walt' || lesson) return;
    const c0 = SAVE.coins,
      ctx = SAVE.profile ? M.ctx() : shelf, // (as a sale: a guest's shelf here, an account's the server's)
      err = SAVE.act({ k: 'daily' }, ctx);
    sel = null;
    line = null;
    sayV = null;
    if (err) {
      say = 'market.no.other';
      paint();
      return;
    }
    if (SAVE.profile) setTimeout(() => fetchShelf(true), 1500);
    chainFetch(500);
    chainFetch(6000);
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.45);
    say = 'market.dailyThanks';
    flash('+' + fmtN(SAVE.coins - c0), true);
    paint();
  }
  // ---------- Walt's guns (rules.js buy: coins into the account, not items) ----------
  // the guns his tab shows: the ones Copper's rank opens, in the arsenal's order
  const gunList = () =>
    DATA.MAIN_ORDER.filter((id) => RULES.usable(id) && DATA.MAIN[id].rank <= RULES.rank(SAVE) && id !== 'pistol');
  // the base's goal is a gun from him (hub.js): his guns' tab glows on his goods, and on it the guns Copper can buy
  // now (not owned, the coins there) glow until one is picked (the human's, 2026-11-12)
  const gunDue = () => mode === 'walt' && !lesson && !!(window.HUB && HUB.gunDue && HUB.gunDue());
  function pickGun(id) {
    if (!DATA.MAIN[id]) return;
    sel = { gun: id };
    sure = 0;
    line = null;
    say = SAVE.owned[id] ? 'market.gunOwned' : 'market.gunSay';
    sayV = { gun: DATA.MAIN[id].name };
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.3);
    paint();
  }
  function buyGun() {
    if (!sel || !sel.gun || SAVE.owned[sel.gun]) return;
    if (performance.now() - sure > 3000) {
      sure = performance.now();
      paint();
      return;
    }
    const id = sel.gun,
      price = DATA.MAIN[id].price,
      err = SAVE.act({ k: 'buy', id });
    sure = 0;
    if (err) {
      say = 'market.no.' + (err === 'coins' ? 'coins' : 'other');
      sayV = null;
      paint();
      return;
    }
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.45);
    say = 'market.gunBought';
    sayV = { gun: DATA.MAIN[id].name };
    flash('−' + fmtN(price), false);
    paint();
  }
  // ---------- the base's task on Walt's shelf (2026-11-11: what the craft needs, seen at the trader's) ----------
  // the building whose parts are wanted: the one whose window sent Copper here, else the tutorial's (rules.js task)
  function taskNeed() {
    if (need) return need;
    const bt = window.RULES && RULES.task(SAVE);
    if (!bt) return null;
    const L = E.building(bt).levels[RULES.baseOf(SAVE).lv[bt] || 0];
    return L ? { b: bt, items: L.items } : null;
  }
  // what is missing (the stash short of each part) and what Walt's shelf asks for it all; can: he has all of it
  function missing(n) {
    const miss = [];
    let total = 0,
      can = true;
    for (const [id, k] of n.items) {
      const have = (SAVE.items || {})[id] || 0;
      if (have >= k) continue;
      const q = k - have,
        st = shelf.stock[id] || 0;
      miss.push([id, q]);
      if (st < q) can = false;
      else total += E.buyTotal(id, q, st);
    }
    return { miss, total, can };
  }
  // the strip over his shelf: the building, each part with the stash's count (a tap picks it on his shelf), and one
  // button that buys every part still missing (asks twice from SURE coins, as a buy does)
  function taskStrip() {
    const n = taskNeed();
    if (!n || !n.items.length) return '';
    const { miss, total, can } = missing(n),
      bpic = n.pic || (window.HUB && HUB.BPIC && HUB.BPIC[n.b]) || '',
      twice = sureM && performance.now() - sureM < 3000;
    let h =
      `<div class="mk-task"><div class="mk-tk-h">${bpic ? `<img src="assets/${bpic}.png?v=${window.__V || 0}" alt="" draggable="false">` : ''}` +
      `<span><small>${T(n.title ? 'market.forUp' : 'market.forTask')}</small><b>${n.title ? esc(n.title) : T('hub.spot.' + n.b)}</b></span></div><div class="mk-tk-its">`;
    for (const [id, k] of n.items) {
      const have = (SAVE.items || {})[id] || 0,
        ok = have >= k;
      h +=
        `<button class="mk-tk-it${ok ? ' ok' : ''}" data-a="slot" data-id="${id}" data-side="walt" title="${esc(T('item.' + id))}">` +
        `<img src="${pic(id)}" alt="" draggable="false"><b>${fmtN(Math.min(have, k))}/${fmtN(k)}</b>${ok ? `<i>${CHK}</i>` : ''}</button>`;
    }
    h += '</div>';
    if (!miss.length) h += `<div class="mk-tk-ok">${CHK}<span>${T('market.tkReady')}</span></div>`;
    else
      h +=
        `<button class="btn green mk-tk-buy${twice ? ' sure' : ''}" data-a="buymiss" ${!can || total > SAVE.coins || ff ? 'disabled' : ''}>` +
        `<span>${!can ? T('market.tkNoStock') : twice ? T('market.sure') : T('market.buyMiss')}</span>` +
        (can ? `<b>${coinI()}${fmtN(total)}</b>` : '') +
        '</button>';
    return h + '</div>';
  }
  function buyMiss() {
    const n = taskNeed();
    if (!n || ff || mode !== 'walt' || lesson) return;
    const { miss, total, can } = missing(n);
    if (!miss.length || !can || total > SAVE.coins) return;
    if (total >= SURE && performance.now() - sureM > 3000) {
      sureM = performance.now();
      paint();
      return;
    }
    sureM = 0;
    // (one shelf for all of them: a guest's is the page's own, an account's a copy the server's answer replaces)
    const ctx = SAVE.profile ? M.ctx() : shelf;
    let spent = 0,
      err = null;
    for (const [id, q] of miss) {
      const sum = E.buyTotal(id, q, ctx.stock[id] || 0);
      err = SAVE.act({ k: 'wbuy', id, n: q }, ctx);
      if (err) break;
      spent += sum;
    }
    sel = null;
    line = null;
    if (spent) {
      if (SAVE.profile) setTimeout(() => fetchShelf(true), 1500);
      chainFetch(500);
      chainFetch(6000);
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.45);
      flash('−' + fmtN(spent), false);
    }
    say = err
      ? 'market.no.' + (err === 'coins' ? 'coins' : err === 'out of stock' ? 'stock' : 'other')
      : 'market.bought';
    sayV = null;
    paint();
  }
  // the coins' change flies up over the purse
  function flash(text, gain) {
    if (!el) return;
    const f = document.createElement('div');
    f.className = 'mk-fly' + (gain ? ' up' : ' down');
    f.textContent = text;
    const purse = el.querySelector('.mk-purse');
    if (purse) purse.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }
  // Nova's offer after the first sale (no wallet yet): her line on the radio, connect (NEAR Connect's window: HOT,
  // Meteor and the rest) or create (the game's own: newwallet.js), or later. Made once; both stay a tap away on the
  // lobby's wallet button and in the settings
  function offer(on) {
    offerUp = on;
    if (on) {
      SAVE.see(OFFER);
      if (window.VOICE) VOICE.say('nova.13');
    }
    if (el) paint();
  }

  // ---------- fast-forward a week (for judges) ----------
  // The other players' week at Walt's (economy.js otherPlayersDay, as the server's shelf lives it between real players'
  // trades) in E.FAST_FORWARD.seconds: each day worked out on a copy of the shelf, then its steps played out one by one
  // (a sale to him, a buy from him, the day's decay), the slot it hit flashing, Walt summing up each day. The
  // real shelf (the server's, every player's) is left as it is and fetched aside meanwhile; no trades on the copy until
  // the window is back on today (the button, or closing the window).
  let ff = null; // { real, work, rest, day, steps (the day's left), n (its steps), sold, bought (and daySold, dayBought), start: { id: Walt's price then }, hit: { id: 'up' | 'down' }, done, timer }
  function ffStart() {
    if (ff || mode !== 'walt' || !shelf.at) return;
    const start = {};
    for (const it of E.ITEMS) if (E.tradable(it.id)) start[it.id] = E.buyPrice(it.id, shelf.stock[it.id] || 0);
    ff = { real: shelf, work: { ...shelf.stock }, rest: {}, day: 0, steps: [], sold: 0, bought: 0, start, hit: {} };
    shelf = { ...shelf, stock: { ...shelf.stock }, recent: {}, lines: {}, note: null };
    sure = 0;
    line = null;
    say = 'market.ff.start';
    sayV = null;
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('whoosh0', 0.3);
    paint();
    ff.timer = setTimeout(ffStep, 2200); // (a moment to read what is about to happen)
  }
  // the next step: a new day worked out when the last one's steps are all played
  function ffStep() {
    if (!ff || !el) return;
    if (!ff.steps.length) {
      E.otherPlayersDay(ff.work, Math.random, ff.rest, (st) => ff.steps.push(st));
      ff.n = ff.steps.length;
      ff.wait = (E.FAST_FORWARD.seconds * 1000) / E.FAST_FORWARD.days / ff.n;
      ff.daySold = ff.dayBought = 0;
    }
    const st = ff.steps.shift(),
      stock = shelf.stock;
    ff.hit = {};
    if (st.k === 'sell') {
      stock[st.id] = (stock[st.id] || 0) + st.n;
      ff.sold += st.n;
      ff.daySold += st.n;
      ff.hit[st.id] = 'down';
    } else if (st.k === 'buy') {
      if (--stock[st.id] <= 0) delete stock[st.id];
      ff.bought++;
      ff.dayBought++;
      ff.hit[st.id] = 'up';
    } else {
      for (const [id, n] of Object.entries(st.gone)) {
        if ((stock[id] -= n) <= 0) delete stock[id];
        ff.hit[id] = 'up';
      }
      ff.day++;
      ff.n = 0;
      ff.done = ff.day >= E.FAST_FORWARD.days;
      // (Walt sums up each day: a line for every step would go by faster than it can be read)
      say = ff.done ? 'market.ff.end' : 'market.ff.decay';
      sayV = ff.done ? { sold: ff.sold, bought: ff.bought } : { d: ff.day, sold: ff.daySold, bought: ff.dayBought };
      line = null;
    }
    if (!ff.steps.length) shelf.stock = { ...ff.work }; // (the day ends as it was worked out)
    if (window.AUDIO && AUDIO.ui) AUDIO.ui(ff.done ? 'bolt' : 'click', ff.done ? 0.45 : 0.12);
    paint();
    if (!ff.done) ff.timer = setTimeout(ffStep, ff.wait);
  }
  // back on today: the real shelf in the window again (and the shelf fetched while it ran)
  function ffEnd() {
    if (!ff) return;
    clearTimeout(ff.timer);
    shelf = ff.real;
    ff = null;
    say = 'market.hello';
    sayV = null;
    line = null;
  }
  const FF = '<svg viewBox="0 0 24 24"><path d="M3 5.5v13l8.5-6.5zM12.5 5.5v13l8.5-6.5z" fill="currentColor"/></svg>';
  const BACK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>';
  // the head's button: start, the days going by (a tap stops it), or back on today
  function ffButton() {
    if (!ff)
      return `<button class="mk-ffb" data-a="ff" title="${esc(T('market.ff.go'))}" ${shelf.at ? '' : 'disabled'}>${FF}<span>${T('market.ff.go')}</span></button>`;
    if (!ff.done)
      return (
        `<button class="mk-ffb run" data-a="ffback" title="${esc(T('market.ff.stop'))}">${FF}` +
        `<span>${T('market.ff.day', { d: Math.min(ff.day + 1, E.FAST_FORWARD.days), all: E.FAST_FORWARD.days })}</span>` +
        `<i style="width:${Math.round((100 * (ff.day + (ff.n ? (ff.n - ff.steps.length) / ff.n : 0))) / E.FAST_FORWARD.days)}%"></i></button>`
      );
    return `<button class="mk-ffb done" data-a="ffback" title="${esc(T('market.ff.back'))}">${BACK}<span>${T('market.ff.back')}</span></button>`;
  }
  // the middle while it runs and nothing is picked: the day, the week's trades so far, Walt's prices that moved most
  function ffPanel() {
    const moves = [];
    for (const id of Object.keys(ff.start)) {
      const now = E.buyPrice(id, shelf.stock[id] || 0),
        was = ff.start[id];
      if (now !== was) moves.push({ id, was, now, d: Math.abs(now - was) / was });
    }
    moves.sort((a, b) => b.d - a.d);
    let h =
      `<div class="mk-ff"><h3>${T('market.ff.title')}</h3>` +
      `<div class="mk-ffday">${ff.done ? T('market.ff.over') : T('market.ff.day', { d: Math.min(ff.day + 1, E.FAST_FORWARD.days), all: E.FAST_FORWARD.days })}</div>` +
      `<div class="mk-ffnums"><span>${T('market.ff.soldN')}<b>${fmtN(ff.sold)}</b></span><span>${T('market.ff.boughtN')}<b>${fmtN(ff.bought)}</b></span></div>` +
      `<h4>${T('market.ff.moves')}</h4>`;
    if (!moves.length) h += `<div class="mk-note">${T('market.ff.still')}</div>`;
    else {
      h += '<ul class="mk-ffm">';
      for (const m of moves.slice(0, 6))
        h +=
          `<li class="${m.now > m.was ? 'up' : 'down'}${ff.hit[m.id] ? ' hit' : ''}"><img src="${pic(m.id)}" alt="" draggable="false"><span>${T('item.' + m.id)}</span>` +
          `<s>${fmtN(m.was)}</s><b>${coinI()}${fmtN(m.now)}</b><em>${m.now > m.was ? '▲' : '▼'}</em></li>`;
      h += '</ul>';
    }
    return h + `<div class="mk-note">${T('market.ff.copy')}</div></div>`;
  }

  // ---------- Walt's words ----------
  const turns = {}; // (the line said last for each item: the next pick says the other)
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // a text by NEAR AI made safe and its slots filled: val(slot) the number (from the formula), or null (left out)
  const fill = (t, val) =>
    esc(t).replace(/\{([\w.]+)\}/g, (m, n) => {
      const v = val(n);
      return Number.isFinite(v) ? `<b>${fmtN(v)}</b>` : '';
    });
  // a note's slot: {gears.buy}, {gears.sell}, {gears.stock} at the shelf the page has
  function noteSlot(n) {
    const [id, f] = n.split('.'),
      s = shelf.stock[id] || 0;
    if (!E.tradable(id)) return null;
    return f === 'buy' ? E.buyPrice(id, s) : f === 'sell' ? E.sellPrice(id, s) : f === 'stock' ? s : null;
  }
  // what the bubble says: { h: its html, ai: whether NEAR AI wrote the words }
  function words() {
    if (line && sayV) return { h: fill(line, (n) => sayV[n]), ai: true };
    if (say === 'market.hello' && !sel && shelf.note && !shelf.off)
      return { h: fill(shelf.note.t, noteSlot), ai: true };
    return { h: T(say, sayV || {}), ai: false };
  }

  // ---------- drawing ----------
  let said = null; // (the bubble's words last drawn: the same words again are not faded in anew)
  function slot(it, side) {
    const id = it.id,
      n = side === 'me' ? free(id) : shelf.stock[id] || 0,
      on = sel && sel.id === id && sel.side === side,
      hit = ff && ff.hit[id] && mode === 'walt' ? ' ff-' + ff.hit[id] : '',
      price =
        mode === 'walt'
          ? side === 'me'
            ? E.tradable(id)
              ? E.buyPrice(id, shelf.stock[id] || 0)
              : 0
            : E.sellPrice(id, shelf.stock[id] || 0)
          : 0;
    // an account's item on its wallet: a small wallet; still on its way there: an hourglass (server/chain.mjs)
    const ch = side === 'me' && chainOn() ? ((WALLET.chainSt.pend || {})[id] > 0 ? 'way' : 'on') : '';
    return (
      `<button class="mk-slot r${it.rarity}${on ? ' on' : ''}${hit}" data-a="slot" data-id="${id}" data-side="${side}" ` +
      `title="${T('item.' + id)}${ch ? ' · ' + T(ch === 'way' ? 'chain.onWay' : 'chain.onWallet') : ''}"><img src="${pic(id)}" alt="" draggable="false">` +
      (ch ? `<i class="mk-w ${ch}">${ch === 'way' ? WAY : WAL}</i>` : '') +
      (n > 1 ? `<b class="mk-n">${fmtN(n)}</b>` : '') +
      (window.HUB && HUB.needed && HUB.needed().has(id)
        ? `<i class="mk-need" title="${esc(T('market.needed'))}">${CHK}</i>`
        : '') +
      (lesson && id === 't_butcher' && side === 'me' && !sel ? pointer('market.point.tap', 'in') : '') +
      (price ? `<span class="mk-p">${coinI()}${fmtN(price)}</span>` : '') +
      '</button>'
    );
  }
  const CHK =
    '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // the lesson's pointer: a gold tag and an arrow bobbing down onto what to tap or hold
  // (in: inside the slot itself — a grid clips what sticks out; no key: the arrow alone)
  const pointer = (key, cls = '') =>
    `<div class="mk-point ${cls}">${key ? `<span>${T(key)}</span>` : ''}<svg viewBox="0 0 24 24"><path d="M12 22 3.5 12H9V2h6v10h5.5z"/></svg></div>`;
  const chainOn = () => !!(window.WALLET && WALLET.account && WALLET.chainSt && WALLET.chainSt.on);
  const WAL =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M4 7l11-3v3"/><circle cx="16" cy="13.5" r="1.4" fill="currentColor"/></svg>',
    WAY =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/></svg>';
  // the stash's items as the wallet has them: asked on opening and a moment after each trade (its change on its way)
  function chainFetch(ms = 0) {
    if (!window.WALLET || !WALLET.account) return;
    setTimeout(() => WALLET.chain().then(() => el && paint()), ms);
  }
  const coinI = () => `<img class="mk-c" src="assets/pk_coin.png?v=${window.__V || 0}" alt="" draggable="false">`;
  // a side's grid; the stash's filled up with empty slots to a few rows (room to spare shows it is a store)
  const EMPTY = { stash: 45, walt: 20 }; // (45: whole rows of 9 or 5)
  function grid(list, side, empty) {
    if (!list.length && side !== 'me') return `<div class="mk-empty">${T(empty)}</div>`;
    let h = '<div class="mk-grid">';
    for (const it of list) h += slot(it, side);
    if (side === 'me') for (let i = list.length; i < EMPTY[mode]; i++) h += '<i class="mk-slot mk-none"></i>';
    h += '</div>';
    return list.length || side !== 'me' ? h : h + `<div class="mk-empty low">${T(empty)}</div>`;
  }
  // what an item goes into: the buildings whose levels ask for it, the kits made of it (economy.js)
  function usedFor(id) {
    const out = [];
    for (const b of E.BUILDINGS)
      if (b.levels.some((l) => (l.items || []).some(([i]) => i === id))) out.push(T('hub.spot.' + b.id));
    for (const r of E.RECIPES)
      if ((r.inputs || []).some(([i]) => i === id) && r.output) out.push(T('item.' + r.output[0]));
    return out;
  }
  // the middle: the picked item, its numbers, how many, the trade
  function detail() {
    if (!sel && ff) return ffPanel();
    if (!sel)
      return `<div class="mk-hint">${BOX}<span>${T(tab === 'guns' && mode === 'walt' ? 'market.pickGun' : 'market.pick')}</span></div>`;
    if (sel.gun) return gunDetail(sel.gun);
    if (sel.gear) return gearDetail();
    const it = E.item(sel.id),
      id = sel.id,
      have = free(id),
      stock = shelf.stock[id] || 0;
    let h =
      `<div class="mk-big r${it.rarity}"><img src="${pic(id)}" alt="" draggable="false"></div>` +
      `<h3>${T('item.' + id)}</h3><div class="mk-tags"><span class="r${it.rarity}">${T('market.rarity.' + it.rarity)}</span>` +
      (it.kind === 'trophy' ? '' : `<span>${T('market.kind.' + it.kind)}</span>`) +
      '</div>' +
      `<div class="mk-own">${T('market.have', { n: fmtN(have) })}${mode === 'walt' ? ' · ' + (stock ? T('market.stock', { n: fmtN(stock) }) : T('market.none')) : ''}</div>`;
    const uses = usedFor(id);
    if (uses.length) h += `<div class="mk-use"><span>${T('market.usedFor')}</span>${uses.join(', ')}</div>`;
    if (it.kind === 'weapon') h += gunStats(id);
    if (mode !== 'walt' && it.kind === 'weapon')
      h +=
        `<button class="btn orange mk-go" data-a="equip">${T('market.gear.put')}</button>` +
        `<div class="mk-note">${T((SAVE.gear || {}).gun ? 'market.gear.swap' : 'market.gear.why')}</div>`;
    if (mode !== 'walt') {
      if (E.tradable(id))
        h += `<div class="mk-row"><span>${T('market.pays')}</span><b>${coinI()}${fmtN(E.buyPrice(id, stock))}</b></div>`;
      else h += `<div class="mk-note">${T('market.noTrade')}</div>`;
      return h;
    }
    const sell = sel.side === 'me';
    if (sell && !E.tradable(id)) return h + `<div class="mk-note">${T('market.noTrade')}</div>`;
    const sum = sell ? E.sellTotal(id, qty, stock) : E.buyTotal(id, qty, stock),
      short = !sell && sum > SAVE.coins,
      none = !sell && stock < qty,
      twice = sure && performance.now() - sure < 3000;
    h +=
      `<div class="mk-row"><span>${T(sell ? 'market.pays' : 'market.asks')}</span>` +
      `<b>${coinI()}${fmtN(sell ? E.buyPrice(id, stock) : E.sellPrice(id, stock))}</b><small>${T('market.each')}</small></div>`;
    h +=
      `<div class="mk-qty"><button class="mk-step" data-a="minus" ${qty <= 1 ? 'disabled' : ''}>−</button>` +
      `<b>${fmtN(qty)}</b><button class="mk-step" data-a="plus" ${qty >= maxQty() ? 'disabled' : ''}>+</button>` +
      `<button class="mk-all" data-a="all" ${qty >= maxQty() ? 'disabled' : ''}>${T('market.all')}</button></div>`;
    h +=
      `<div class="mk-row tot${short ? ' short' : ''}"><span>${T(sell ? 'market.youGet' : 'market.youPay')}</span>` +
      `<b>${coinI()}${fmtN(sum)}</b></div>`;
    const off = short || none || ff || (lesson && !(sell && id === 't_butcher'));
    h += sell
      ? `<div class="mk-gow">${lesson && id === 't_butcher' ? pointer('') : ''}` +
        `<button class="btn orange mk-go hold" data-a="trade" ${off ? 'disabled' : ''}><i class="mk-fill"></i>` +
        `<span>${T('market.sell')}</span><small>${T(lesson ? 'market.point.hold' : 'market.holdHint')}</small></button></div>`
      : `<button class="btn green mk-go${twice ? ' sure' : ''}" data-a="trade" ${off ? 'disabled' : ''}>` +
        `${twice ? T('market.sure') : T('market.buy')}</button>`;
    if (ff) h += `<div class="mk-note">${T('market.ff.wait')}</div>`;
    else if (short) h += `<div class="mk-note bad">${T('market.short')}</div>`;
    return h;
  }
  // ---------- the gear (the stash window's right side): the cat's outline with the slots on it; for now only the gun's
  // (a rare gun from the stash, rules.js gear: it is played with while it sits there, and never lost in a run), the
  // helmet's, the armour's and the backpack's to come ----------
  // (the cat standing, seen from the front: ears, head, body, arms down, legs, the tail round to the right; 200 × 300)
  const CAT =
      '<svg class="mk-catsil" viewBox="0 0 200 300" aria-hidden="true"><path class="tl" d="M138 214c34 6 52 34 38 62"/>' +
      '<path d="M60 44l12-36 22 26zM140 44l-12-36-22 26z"/><ellipse cx="100" cy="62" rx="44" ry="38"/>' +
      '<rect x="62" y="96" width="76" height="102" rx="26"/><rect x="38" y="104" width="22" height="88" rx="11" transform="rotate(14 49 104)"/>' +
      '<rect x="140" y="104" width="22" height="88" rx="11" transform="rotate(-14 151 104)"/>' +
      '<rect x="66" y="180" width="28" height="104" rx="13"/><rect x="106" y="180" width="28" height="104" rx="13"/></svg>',
    GUNI =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 10h15l3-2v4h-3l-2 2h-4l-2 4H7l1-4H3z"/></svg>',
    LOCK =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    SOON = ['head', 'body', 'pack']; // (where on the cat: css .mk-gs.<k>)
  function gearPanel() {
    const g = (SAVE.gear || {}).gun,
      on = sel && sel.gear ? ' on' : '';
    const gun = g
      ? `<button class="mk-gs gun has r${E.item(g).rarity}${on}" data-a="gearslot" title="${esc(DATA.MAIN[g].name)}"><img src="${pic(g)}" alt="" draggable="false"><span>${T('market.gear.gun')}</span></button>`
      : `<button class="mk-gs gun${on}" data-a="gearslot" title="${esc(T('market.gear.gun'))}"><i>${GUNI}</i><span>${T('market.gear.gun')}</span></button>`;
    return (
      `<section class="mk-side mk-gear"><h4>${T('market.gear.title')}</h4><div class="mk-cat">${CAT}${gun}` +
      SOON.map(
        (k) =>
          `<div class="mk-gs ${k} soon" title="${esc(T('market.gear.' + k) + ' · ' + T('market.gear.soon'))}"><i>${LOCK}</i><span>${T('market.gear.' + k)}</span><small>${T('market.gear.soon')}</small></div>`,
      ).join('') +
      '</div></section>'
    );
  }
  // a rare gun's numbers (data.js MAIN): damage, shots a second, magazine, reach
  function gunStats(id) {
    const d = DATA.MAIN[id];
    if (!d) return '';
    const row = (k, v) => `<div class="mk-row"><span>${T('market.gun.' + k)}</span><b>${v}</b></div>`;
    return (
      `<div class="mk-use">${esc(String(d.feat || ''))}</div>` +
      row('dmg', fmtN(Math.round(d.dmg * 10) / 10)) +
      row('rate', fmtN(d.rate)) +
      row('mag', fmtN(d.mag)) +
      row('range', fmtN(d.range))
    );
  }
  // the middle for the gear's gun slot: the gun in it and Take off, or how a gun gets there
  function gearDetail() {
    const g = (SAVE.gear || {}).gun;
    if (!g) return `<div class="mk-hint">${GUNI}<span>${T('market.gear.empty')}</span></div>`;
    const it = E.item(g);
    return (
      `<div class="mk-big r${it.rarity}"><img src="${pic(g)}" alt="" draggable="false"></div>` +
      `<h3>${esc(DATA.MAIN[g].name)}</h3><div class="mk-tags"><span class="r${it.rarity}">${T('market.rarity.' + it.rarity)}</span><span>${T('market.gear.in')}</span></div>` +
      gunStats(g) +
      `<button class="btn mk-go" data-a="unequip">${T('market.gear.off')}</button>` +
      `<div class="mk-note">${T('market.gear.safe')}</div>`
    );
  }
  function gear(id) {
    const err = SAVE.act({ k: 'gear', slot: 'gun', id: id || '' });
    if (err) {
      console.warn('gear', err); // (the stash changed meanwhile: drawn as it is now)
      return paint();
    }
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.45);
    sel = id ? { gear: 'gun' } : null;
    paint();
  }
  // the middle for a gun of Walt's: its picture, rank, what it does, the price and Buy (asks once more), or "yours"
  function gunDetail(id) {
    const d = DATA.MAIN[id],
      own = !!SAVE.owned[id],
      short = SAVE.coins < d.price,
      twice = sure && performance.now() - sure < 3000;
    let h =
      `<div class="mk-big gun"><img src="assets/i_${id}.png?v=${window.__V || 0}" alt="" draggable="false"></div>` +
      `<h3>${esc(d.name)}</h3><div class="mk-tags"><span>${T('market.gunRank', { r: d.rank })}</span><span>${T('market.gunKind')}</span></div>` +
      `<div class="mk-use">${esc(String(d.feat || ''))}</div>`;
    if (own) return h + `<div class="mk-note">${T('market.gunYours')}</div>`;
    h += `<div class="mk-row tot${short ? ' short' : ''}"><span>${T('market.youPay')}</span><b>${coinI()}${fmtN(d.price)}</b></div>`;
    h += `<button class="btn green mk-go${twice ? ' sure' : ''}" data-a="buygun" ${short ? 'disabled' : ''}>${twice ? T('market.sure') : T('market.buy')}</button>`;
    if (short) h += `<div class="mk-note bad">${T('market.short')}</div>`;
    return h + `<div class="mk-note">${T('market.gunNote')}</div>`;
  }
  // Walt's guns as his right side's grid
  function gunGrid() {
    const list = gunList();
    if (!list.length) return `<div class="mk-empty">${T('market.noGuns')}</div>`;
    const due = gunDue() && !(sel && sel.gun && !SAVE.owned[sel.gun]);
    let h = '<div class="mk-grid guns">';
    for (const id of list) {
      const on = sel && sel.gun === id,
        own = !!SAVE.owned[id],
        lit = due && !own && !on && DATA.MAIN[id].price <= SAVE.coins;
      h +=
        `<button class="mk-slot gun${on ? ' on' : ''}${own ? ' own' : ''}${lit ? ' mk-lit' : ''}" data-a="gun" data-id="${id}" title="${esc(DATA.MAIN[id].name)}">` +
        `<img src="assets/i_${id}.png?v=${window.__V || 0}" alt="" draggable="false">` +
        (own ? `<i class="mk-need">${CHK}</i>` : `<span class="mk-p">${coinI()}${fmtN(DATA.MAIN[id].price)}</span>`) +
        '</button>';
    }
    return h + '</div>';
  }
  function paint() {
    if (!el) return;
    if (hold) {
      hold.again = true; // (not under a finger holding the sale down: drawn when it lets go)
      return;
    }
    const walt = mode === 'walt',
      purse = `<div class="mk-purse">${coinI()}<b>${fmtN(SAVE.coins)}</b></div>`,
      x = lesson ? '' : `<button class="mk-x" data-a="close" aria-label="${T('market.close')}">${CLOSE}</button>`;
    const w = walt ? words() : null;
    const head = walt
      ? `<div class="mk-head"><div class="mk-por"><img src="${por('walt')}" alt="" draggable="false"></div>` +
        `<div class="mk-bub"><div class="mk-name">${T('voice.name.walt')}</div>` +
        (w.ai ? `<span class="mk-ai" title="${esc(T('market.ai'))}">NEAR AI</span>` : '') +
        `<p${w.h === said ? ' class="same"' : ''}>${w.h}</p></div>${lesson || tab === 'guns' || tab === 'mkt' ? '' : ffButton()}${purse}${x}</div>`
      : `<div class="mk-head st"><div class="mk-ico">${BOX}</div><h2>${T('market.stash')}</h2>${
          chainOn()
            ? `<a class="mk-wal" href="${WALLET.explorer('acc', WALLET.account)}" target="_blank" rel="noopener">${WAL}<span>${T('chain.stash', { a: WALLET.account })}</span> ↗</a>`
            : ''
        }${purse}${x}</div>`;
    const left =
        `<section class="mk-side"><h4>${T(walt ? 'market.yours' : 'market.items')}` +
        `<small>${T('market.count', { n: fmtN(mine().length) })}</small></h4>` +
        grid(mine(), 'me', 'market.empty') +
        '</section>',
      tabs =
        walt && !lesson && !ff
          ? `<div class="mk-tabs"><button class="${tab === 'goods' ? 'on' : ''}" data-a="tab" data-tab="goods">${T('market.goods')}</button>` +
            `<button class="${tab === 'guns' ? 'on' : gunDue() ? 'mk-lit' : ''}" data-a="tab" data-tab="guns">${T('market.guns')}</button>` +
            (daily()
              ? `<button class="${tab === 'daily' ? 'on' : dailyReady() ? 'mk-lit' : ''}" data-a="tab" data-tab="daily">${T('market.daily')}</button>`
              : '') +
            `<button class="${tab === 'mkt' ? 'on' : ''}" data-a="tab" data-tab="mkt">${T('market.mkt')}</button>` +
            '</div>'
          : '',
      right =
        walt && tab === 'guns'
          ? `<section class="mk-side">${tabs}<h4>${T('market.guns')}<small>${T('market.gunRankNow', { r: RULES.rank(SAVE) })}</small></h4>${gunGrid()}</section>`
          : walt && tab === 'daily' && !lesson && !ff
            ? `<section class="mk-side">${tabs}<h4>${T('market.daily')}<small>${untilNew()}</small></h4>${dailyPanel()}</section>`
            : walt
              ? `<section class="mk-side${ff ? ' mk-ffs' : ''}">${tabs}${lesson ? '' : taskStrip()}<h4>${T('market.shelf')}${ff ? `<small>${T('market.ff.shelf')}</small>` : shelf.off ? `<small>${T('market.offline')}</small>` : ''}${
                  shelf.wallet && !shelf.off && !ff && window.WALLET
                    ? `<a class="mk-wlt" href="${WALLET.explorer('acc', shelf.wallet)}" target="_blank" rel="noopener">${WAL}<span>${T('chain.walt')}</span> ↗</a>`
                    : ''
                }</h4>` +
                grid(his(), 'walt', 'market.shelfEmpty') +
                '</section>'
              : gearPanel();
    if (w) said = w.h;
    if (walt && tab === 'mkt' && !lesson && !ff) {
      const fr = el.querySelector('.mk-frame');
      if (fr) {
        const h = el.querySelector('.mk-head');
        if (h) h.outerHTML = head;
        return;
      }
      // (the page has the game's four languages: live/lang_market.<lang>.js)
      const src = `market.html?embed=1&lang=${encodeURIComponent(I18N.lang)}`;
      el.classList.remove('lesson');
      el.innerHTML =
        `<div class="mk-win mk-wide">${head}<div class="mk-body mk-mktb"><section class="mk-side">${tabs}` +
        `<iframe class="mk-frame" hidden title="${esc(T('market.mkt'))}"></iframe>` +
        `<button type="button" class="mk-empty" data-mkt-again hidden>${T('hub.no.offline')}</button></section></div></div>`;
      loadFrame(el.querySelector('.mk-frame'), src);
      return;
    }
    const scroll = [...el.querySelectorAll('.mk-grid')].map((g) => g.scrollTop);
    el.classList.toggle('lesson', lesson);
    el.innerHTML =
      `<div class="mk-win">${head}<div class="mk-body">${left}<section class="mk-mid">${detail()}</section>${right}</div></div>` +
      (offerUp ? offerHtml() : '');
    el.querySelectorAll('.mk-grid').forEach((g, i) => (g.scrollTop = scroll[i] || 0));
  }
  // the market's page into its frame. With no connection the browser would draw its own error page inside the frame, so
  // the page is asked for first; out of reach, a line of the game's stands there instead, and a tap on it or the
  // connection coming back asks again
  function loadFrame(fr, src) {
    const off = fr.nextElementSibling;
    off.onclick = () => loadFrame(fr, src);
    fetch(src, { method: 'HEAD', cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (!fr.isConnected) return;
        off.hidden = true;
        fr.hidden = false;
        fr.src = src;
      })
      .catch((e) => {
        console.warn('market frame', e.message);
        fr.hidden = true;
        off.hidden = false;
      });
  }
  addEventListener('online', () => {
    const again = document.querySelector('[data-mkt-again]:not([hidden])');
    if (again) again.click();
  });
  // Nova's offer (nova: her face, her line), or the wallet's own card (the base's wallet button): connect, create, later
  function offerHtml(nova = true) {
    return (
      `<div class="mk-offer"><div class="mk-ocard${nova ? '' : ' plain'}">` +
      (nova ? `<div class="mk-opor"><img src="${por('nova')}" alt="" draggable="false"></div>` : '') +
      `<div class="mk-otext">` +
      (nova
        ? `<div class="mk-name nova">${T('voice.name.nova')}</div><h3>${T('market.offer.title')}</h3><p>${T('voice.nova.13')}</p>`
        : `<h3>${T('wallet.title')}</h3><p>${T('wallet.choose')}</p>`) +
      `<div class="mk-obtn">` +
      `<button class="btn orange" data-a="connect">${T('market.offer.connect')}</button>` +
      `<button class="btn" data-a="create">${T('market.offer.create')}</button>` +
      `<button class="btn ghost" data-a="later">${T('market.offer.later')}</button></div></div></div></div>`
    );
  }
  // that card on its own over the page, no window of Walt's under it (#mkoff): Nova's offer once his window was shut
  // before she came to it, or the wallet's card from the base's button; a tap beside it or Esc is "later"
  let soloEl = null;
  function solo(nova) {
    if (soloEl || !window.WALLET || WALLET.account) return;
    if (nova) SAVE.see(OFFER);
    soloEl = document.createElement('div');
    soloEl.id = 'mkoff';
    soloEl.innerHTML = offerHtml(nova);
    document.getElementById('ui').appendChild(soloEl);
    window.__modal = true;
    soloEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'),
        a = b ? b.dataset.a : e.target.classList.contains('mk-offer') ? 'later' : '';
      if (!a) return;
      soloShut();
      if (a === 'connect') WALLET.connect();
      else if (a === 'create') WALLET.create();
    });
    addEventListener('keydown', soloKey, true);
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('whoosh0', 0.25);
    requestAnimationFrame(() => soloEl && soloEl.classList.add('on'));
  }
  function soloKey(e) {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    soloShut();
  }
  function soloShut() {
    if (!soloEl) return;
    soloEl.remove();
    soloEl = null;
    removeEventListener('keydown', soloKey, true);
    window.__modal = !!el;
  }
  M.wallet = () => solo(false);
  // the market's frame: it asks to sign in (the game's own wallet window over it), it says the stash changed
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || typeof e.data.md !== 'string' || !window.WALLET) return;
    if (e.data.md === 'market-login') WALLET.connect();
    else if (e.data.md === 'market-saved' && WALLET.reload) WALLET.reload();
  });
  // the save changed (a trade answered by the server, a run banked): the window anew
  if (window.WALLET && WALLET.on) WALLET.on((kind) => (kind === 'save' || kind === 'profile') && el && paint());
})();
