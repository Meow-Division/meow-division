// live/market.js — the base's windows over NEAR Base (docs/design.md, "Walt's market" and "Hub base"): the stash (what
// the player holds: economy.js items, rules.js save.items) and Walt's trade window (the stash beside his shelf; sell to
// him, buy from him, his prices from his shelf: economy.js sellTotal / buyTotal, his reasons: economy.js explain).
// Built as a game's trader screen: a slot grid on each side, the item picked in the middle with its price, how many
// (one by default, all at a tap) and the total, the trade button counting it; Walt's portrait over a speech bubble
// that answers what is picked. A rare item or a trophy asks once more before it is sold. The first sale, while no
// wallet is connected, ends with Nova's offer to keep it all in one (design: "Player path" 6, nova.13).
// Walt's shelf comes from the server (GET /api/walt: one shelf for every player); out of its reach the page makes up
// the week the server would have opened with. A guest's trade changes the page's copy of the shelf; an account's goes
// to the server (wallet.js), whose shelf decides. While a window is up the hero stands (index.html __modal).
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
  let shelf = { stock: {}, recent: {}, day: 0, at: 0, off: false },
    asking = null;
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
    return stock;
  }
  function fetchShelf(force) {
    if (asking || (!force && Date.now() - shelf.at < FRESH)) return asking || Promise.resolve();
    asking = fetch(API + '/walt', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
      .then((j) => {
        shelf = { stock: j.stock || {}, recent: j.recent || {}, day: j.day || 0, at: Date.now(), off: false };
      })
      .catch((e) => {
        console.warn('walt shelf', e && e.message);
        if (!shelf.at) shelf = { stock: madeUp(), recent: {}, day: 0, at: Date.now(), off: true };
        else shelf.off = true;
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
    sel = null, // { id, side: 'me' | 'walt' }
    qty = 1,
    sure = 0, // (performance.now() of the first tap on a trade that asks twice)
    say = '', // what Walt says in his bubble (a language key and its numbers)
    sayV = null,
    offerUp = false;
  M.isOpen = () => !!el;
  // the stash's order: trophies, then by rarity, then materials before kits, then by name
  const KIND = { trophy: 0, material: 1, kit: 2 };
  function sorted(ids) {
    return ids
      .map((id) => E.item(id))
      .filter(Boolean)
      .sort(
        (a, b) =>
          KIND[a.kind] - KIND[b.kind] || b.rarity - a.rarity || T('item.' + a.id).localeCompare(T('item.' + b.id)),
      );
  }
  const mine = () => sorted(Object.keys(SAVE.items || {}).filter((id) => SAVE.items[id] > 0));
  const his = () => sorted(Object.keys(shelf.stock).filter((id) => shelf.stock[id] > 0 && E.tradable(id)));

  M.open = (m) => {
    if (el) M.close();
    mode = m === 'walt' ? 'walt' : 'stash';
    sel = null;
    qty = 1;
    sure = 0;
    say = mode === 'walt' ? 'market.hello' : '';
    sayV = null;
    offerUp = false;
    el = document.createElement('div');
    el.id = 'mkt';
    el.className = 'mk-' + mode;
    document.getElementById('ui').appendChild(el);
    window.__modal = true;
    addEventListener('keydown', onKey, true);
    el.addEventListener('click', onClick);
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('whoosh0', 0.25);
    paint();
    requestAnimationFrame(() => el && el.classList.add('on'));
    fetchShelf(mode === 'walt');
    chainFetch();
  };
  M.close = () => {
    if (!el) return;
    removeEventListener('keydown', onKey, true);
    const old = el;
    el = null;
    window.__modal = false;
    old.classList.remove('on');
    old.classList.add('gone');
    setTimeout(() => old.remove(), 220);
  };
  function onKey(e) {
    if (!el) return;
    if (e.code === 'Escape' || (e.code === 'KeyE' && !offerUp) || (e.code === 'KeyI' && mode === 'stash')) {
      e.preventDefault();
      e.stopPropagation();
      if (offerUp) offer(false);
      else M.close();
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
    else if (a === 'minus') setQty(qty - 1);
    else if (a === 'plus') setQty(qty + 1);
    else if (a === 'all') setQty(maxQty());
    else if (a === 'trade') trade();
    else if (a === 'connect') {
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
    if (mode === 'walt') {
      const w = E.explain(id, shelf.stock[id] || 0, shelf.recent[id] || 0);
      say = w.key;
      sayV = w.vars;
    }
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.3);
    paint();
  }
  // how many the trade can be at most: what the stash holds (selling), what Walt holds and the coins pay for (buying)
  function maxQty() {
    if (!sel) return 1;
    const have = (SAVE.items || {})[sel.id] || 0,
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
  // asks once more: a trophy or a rare item sold, or a buy of 200 coins and more
  function asksTwice() {
    const it = E.item(sel.id);
    return sel.side === 'me' ? it.rarity >= 3 : E.buyTotal(sel.id, qty, shelf.stock[sel.id] || 0) >= 200;
  }
  function trade() {
    if (!sel || mode !== 'walt') return;
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
    const ctx = SAVE.profile ? M.ctx() : shelf,
      err = SAVE.act({ k, id, n: qty }, ctx);
    sure = 0;
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
    if (k === 'sell' && !((SAVE.items || {})[id] > 0)) sel = null;
    qty = 1;
    paint();
    if (first) {
      SAVE.see('walt.sold');
      if (window.WALLET && WALLET.available && !WALLET.account && !SAVE.seen(OFFER)) setTimeout(() => offer(true), 900);
    }
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

  // ---------- drawing ----------
  function slot(it, side) {
    const id = it.id,
      n = side === 'me' ? (SAVE.items || {})[id] || 0 : shelf.stock[id] || 0,
      on = sel && sel.id === id && sel.side === side,
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
      `<button class="mk-slot r${it.rarity}${on ? ' on' : ''}" data-a="slot" data-id="${id}" data-side="${side}" ` +
      `title="${T('item.' + id)}${ch ? ' · ' + T(ch === 'way' ? 'chain.onWay' : 'chain.onWallet') : ''}"><img src="${pic(id)}" alt="" draggable="false">` +
      (ch ? `<i class="mk-w ${ch}">${ch === 'way' ? WAY : WAL}</i>` : '') +
      (n > 1 ? `<b class="mk-n">${fmtN(n)}</b>` : '') +
      (price ? `<span class="mk-p">${coinI()}${fmtN(price)}</span>` : '') +
      '</button>'
    );
  }
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
    if (!sel) return `<div class="mk-hint">${BOX}<span>${T('market.pick')}</span></div>`;
    const it = E.item(sel.id),
      id = sel.id,
      have = (SAVE.items || {})[id] || 0,
      stock = shelf.stock[id] || 0;
    let h =
      `<div class="mk-big r${it.rarity}"><img src="${pic(id)}" alt="" draggable="false"></div>` +
      `<h3>${T('item.' + id)}</h3><div class="mk-tags"><span class="r${it.rarity}">${T('market.rarity.' + it.rarity)}</span>` +
      (it.kind === 'trophy' ? '' : `<span>${T('market.kind.' + it.kind)}</span>`) +
      '</div>' +
      `<div class="mk-own">${T('market.have', { n: fmtN(have) })}${mode === 'walt' ? ' · ' + (stock ? T('market.stock', { n: fmtN(stock) }) : T('market.none')) : ''}</div>`;
    const uses = usedFor(id);
    if (uses.length) h += `<div class="mk-use"><span>${T('market.usedFor')}</span>${uses.join(', ')}</div>`;
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
    h +=
      `<button class="btn ${sell ? 'orange' : 'green'} mk-go${twice ? ' sure' : ''}" data-a="trade" ${short || none ? 'disabled' : ''}>` +
      `${twice ? T('market.sure') : T(sell ? 'market.sell' : 'market.buy')}</button>`;
    if (short) h += `<div class="mk-note bad">${T('market.short')}</div>`;
    return h;
  }
  function paint() {
    if (!el) return;
    const walt = mode === 'walt',
      purse = `<div class="mk-purse">${coinI()}<b>${fmtN(SAVE.coins)}</b></div>`,
      x = `<button class="mk-x" data-a="close" aria-label="${T('market.close')}">${CLOSE}</button>`;
    const head = walt
      ? `<div class="mk-head"><div class="mk-por"><img src="${por('walt')}" alt="" draggable="false"></div>` +
        `<div class="mk-bub"><div class="mk-name">${T('voice.name.walt')}</div><p>${T(say, sayV || {})}</p></div>${purse}${x}</div>`
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
      right = walt
        ? `<section class="mk-side"><h4>${T('market.shelf')}${shelf.off ? `<small>${T('market.offline')}</small>` : ''}</h4>` +
          grid(his(), 'walt', 'market.shelfEmpty') +
          '</section>'
        : '';
    const scroll = [...el.querySelectorAll('.mk-grid')].map((g) => g.scrollTop);
    el.innerHTML =
      `<div class="mk-win">${head}<div class="mk-body">${left}<section class="mk-mid">${detail()}</section>${right}</div></div>` +
      (offerUp ? offerHtml() : '');
    el.querySelectorAll('.mk-grid').forEach((g, i) => (g.scrollTop = scroll[i] || 0));
  }
  function offerHtml() {
    return (
      `<div class="mk-offer"><div class="mk-ocard"><div class="mk-opor"><img src="${por('nova')}" alt="" draggable="false"></div>` +
      `<div class="mk-otext"><div class="mk-name nova">${T('voice.name.nova')}</div><h3>${T('market.offer.title')}</h3>` +
      `<p>${T('voice.nova.13')}</p><div class="mk-obtn">` +
      `<button class="btn orange" data-a="connect">${T('market.offer.connect')}</button>` +
      `<button class="btn" data-a="create">${T('market.offer.create')}</button>` +
      `<button class="btn ghost" data-a="later">${T('market.offer.later')}</button></div></div></div></div>`
    );
  }
  // the save changed (a trade answered by the server, a run banked): the window anew
  if (window.WALLET && WALLET.on) WALLET.on((kind) => (kind === 'save' || kind === 'profile') && el && paint());
})();
