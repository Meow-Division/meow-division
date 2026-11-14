// live/bag.js — the run's backpack on the page, as Escape from Duckov has it (the sim plays it: sim.js "the backpack"; the
// rules: economy.js BAG_SLOTS, STACK, SAFE_SLOTS, EVAC_*). Over the ground: the thing in the hero's reach named, with the
// key that takes it (E, or a tap on the name). On the HUD: the backpack's button with how full it is (Tab or I opens it),
// the evac's button and its countdown (leaving mid-run), the run won: "Finish mission" under the clock (Enter), a line for
// each thing taken. The window: the backpack's slots and the safe's on
// the left, the item picked in the middle, what lies in reach on the right. A slot dragged onto another moves there (the
// same item fills it up, another swaps); dragged onto the ground it is thrown out (or a right click, or the button); a
// tap picks a slot and a tap on another moves it there. The world goes on under the window at 30 % of its pace (B.pace; the hero
// stands: __modal).
// Every order is a pick for the sim (GAME.pick, SIM.PICK), the very input the server's replay plays.
(function () {
  const B = (window.BAG = { near: 0, fin: false }),
    T = (k, v) => I18N.t(k, v),
    fmtN = (n) => I18N.num(n),
    pic = (id) => `assets/it_${id}.png?v=${window.__V || 0}`,
    itemOf = (id) => (window.ECONOMY && ECONOMY.item(id)) || { rarity: 1, kind: 'material' };
  const ICO = {
    bag: '<svg viewBox="0 0 24 24"><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="4" y="7" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M4 12.5h16M10 12.5v2.5h4v-2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    sort: '<svg viewBox="0 0 24 24"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M13 6h8M13 11h6M13 16h4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M12 3v11M7.5 7.5 12 3l4.5 4.5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M5 4.5c4-2 7 2 13 0v9c-6 2-9-2-13 0z" fill="currentColor"/></svg>',
  };
  let ui = null,
    hud = null, // the backpack's button
    tag = null, // the name over the thing in reach
    evEl = null, // the evac's button / countdown
    finEl = null, // the run won: "Finish mission" / its countdown, under the clock
    toasts = null,
    win = null, // the window
    sel = null, // the slot picked in the window
    drag = null,
    sig = '',
    fullT = 0,
    q = [], // orders waiting their turn (one a frame: "take all")
    qT = 0,
    seen = new WeakSet(),
    evSig = '',
    finSig = '',
    downBg = false, // (the press began on the window's backdrop: a click there closes it)
    dragT = 0; // (a drag just ended: the click the browser adds after it is not a tap)
  const live = (S) => !!(S && !S.over && !S.hub && S.p && S.p.bag && !S.p.dead && !S.p.evac);
  const SAFE0 = () => SIM.SAFE0;
  const slotAt = (p, s) => (s >= SAFE0() ? p.safe[s - SAFE0()] : p.bag[s]) || null;
  // would the backpack take any of this item (a stack of it not full, or an empty slot)
  function fits(p, id) {
    const st = window.ECONOMY ? ECONOMY.stack(id) : 1;
    return p.bag.some((b) => !b || (b[0] === id && b[1] < st));
  }
  function order(k) {
    q.push(k);
    pump();
  }
  function pump() {
    const now = performance.now();
    if (!q.length || now - qT < 45) return;
    qT = now;
    if (window.GAME) GAME.pick(q.shift());
  }
  function mount() {
    if (ui && ui.isConnected) return;
    ui = document.getElementById('ui');
    hud = document.createElement('button');
    hud.id = 'hbag';
    hud.innerHTML = `<span class="ic">${ICO.bag}</span><b></b><kbd>Tab</kbd>`;
    hud.onclick = (e) => {
      e.stopPropagation();
      B.toggle();
    };
    tag = document.createElement('button');
    tag.id = 'btake';
    tag.onclick = (e) => {
      e.stopPropagation();
      if (B.near) order(SIM.PICK.TAKE + B.near);
    };
    evEl = document.createElement('div');
    evEl.id = 'hevac';
    finEl = document.createElement('div');
    finEl.id = 'hfin';
    // (both say go or stay the same way: data-ev)
    for (const el of [evEl, finEl])
      el.onclick = (e) => {
        const b = e.target.closest('[data-ev]');
        if (!b) return;
        e.stopPropagation();
        order(b.dataset.ev === 'go' ? SIM.PICK.exit : SIM.PICK.stay);
      };
    toasts = document.createElement('div');
    toasts.id = 'btoast';
    for (const el of [hud, tag, evEl, finEl]) el.onpointerdown = (e) => e.stopPropagation(); // (a tap on them is not a shot)
    ui.append(hud, tag, evEl, finEl, toasts);
  }
  // the screen spot of a world point (the run's camera: S.cam its top left, S.vw / zoom the world it shows across)
  function screenOf(S, x, y) {
    const cv = document.getElementById('c'),
      r = cv.getBoundingClientRect(),
      u = ui.getBoundingClientRect(),
      z = S.zoom || 1,
      w = (S.vw || SIM.VIEW.W) / z,
      h = SIM.VIEW.H / z;
    return [r.left - u.left + ((x - S.cam[0]) / w) * r.width, r.top - u.top + ((y - S.cam[1]) / h) * r.height];
  }

  B.sync = (S) => {
    if (!live(S)) {
      B.near = 0;
      B.fin = false;
      if (ui && ui.isConnected) for (const el of [hud, tag, evEl, finEl, toasts]) el.classList.remove('on');
      if (win) B.close();
      q.length = 0;
      return;
    }
    mount();
    const p = S.p,
      busy = !!(S.pause || (window.GAME && GAME.menu)); // (the character editor's live mode draws a run with no GAME)
    hear(S);
    const near = busy ? [] : SIM.lootNear(S, p),
      o = near[0] || null;
    B.near = o ? o.id : 0;
    // the name over the thing in reach
    if (o && !win) {
      const it = itemOf(o.it),
        ok = fits(p, o.it),
        [x, y] = screenOf(S, o.x, o.y - 70),
        s = `${o.id}|${o.n}|${ok}|${window.__touch ? 1 : 0}`;
      if (tag.dataset.s !== s) {
        tag.dataset.s = s;
        tag.className = `on r${it.rarity}${ok ? '' : ' full'}`;
        tag.innerHTML = ok
          ? `${window.__touch ? '' : '<kbd>E</kbd>'}<img src="${pic(o.it)}" alt="" draggable="false"><span>${T('item.' + o.it)}${o.n > 1 ? ' ×' + fmtN(o.n) : ''}</span>`
          : `<img src="${pic(o.it)}" alt="" draggable="false"><span>${T('bag.full')}</span>${window.__touch ? '' : '<kbd>Tab</kbd>'}`;
      }
      tag.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
    } else if (tag.classList.contains('on')) {
      tag.classList.remove('on');
      tag.dataset.s = '';
    }
    // the backpack's button
    const used = p.bag.filter(Boolean).length,
      hs = `${used}/${p.bag.length}`;
    hud.classList.toggle('on', !busy);
    hud.classList.toggle('full', used === p.bag.length);
    hud.classList.toggle('flash', performance.now() - fullT < 1600);
    if (hud.querySelector('b').textContent !== hs) hud.querySelector('b').textContent = hs;
    evac(S, busy);
    finish(S, busy);
    if (win && busy) B.close(); // (a card screen or the pause menu: theirs to answer first)
    if (win) paint(S, near);
    pump();
  };

  // the evac, the way out mid-run: before it opens (a raid's) how long until it does; open, its button; under way, its
  // countdown and the button that calls it off. The run won, it steps aside for "Finish mission" (finish below)
  // (the countdown's bar is moved in place, --k: written into the markup it made the markup new every frame, the
  // buttons were built anew sixty times a second and a click on Cancel never landed on one)
  const fill = (el, k) => {
    const i = k === null ? null : el.querySelector('.evc i, .fnc i');
    if (i) i.style.setProperty('--k', k.toFixed(3));
  };
  function evac(S, busy) {
    const raid = !S.mis || !!S.mis.sch,
      E = window.ECONOMY;
    let st = '',
      bar = null;
    if (busy || S.demo || S.winAt) st = '';
    else if (S.ex) st = 'go';
    else if (SIM.evacOpen(S) && raid) st = 'open';
    else if (raid) st = 'wait';
    let h = '';
    if (st === 'wait') h = `<div class="evw">${T('bag.opensIn', { t: clock(E.EVAC_FROM - S.t) })}</div>`;
    else if (st === 'open')
      h = `<button class="btn green evb" data-ev="go"><span class="ic">${ICO.out}</span>${T('bag.evac')}</button>`;
    else if (st === 'go') {
      const left = Math.max(0, S.ex.t - S.t),
        k = S.ex.t > S.ex.t0 ? 1 - left / (S.ex.t - S.ex.t0) : 1;
      h =
        `<div class="evc"><b>${T('bag.evacIn', { t: Math.ceil(left) })}</b><i></i></div>` +
        `<button class="btn evx" data-ev="stay">${T('bag.cancel')}</button>`;
      bar = k;
    }
    evEl.classList.toggle('on', !!h);
    if (h !== evSig) {
      evSig = h;
      evEl.innerHTML = h;
    }
    fill(evEl, bar);
  }
  // the run's goal done (S.winAt): "Finish mission" (a raid's or a classic run's: "Finish raid") under the clock, where
  // the task's plaque was, breathing softly so the eye finds it, and a line under it that there is still time to loot. It
  // comes once the big MISSION COMPLETE has had its moment (winAt is 2.5 s after the last blow). It is the evac's own call
  // (PICK.exit: EVAC_CLEAR s, then the heroes are out and the results come); pressed, that countdown and its cancel show here
  function finish(S, busy) {
    const raid = !S.mis || !!S.mis.sch,
      won = S.mis ? S.mis.won : S.winAt; // (a mission's last task still to do, its boss dead: not yet, sim.js evacStart)
    let h = '',
      bar = null;
    if (!busy && !S.demo && won && S.winAt && S.ex) {
      const left = Math.max(0, S.ex.t - S.t),
        k = S.ex.t > S.ex.t0 ? 1 - left / (S.ex.t - S.ex.t0) : 1;
      h =
        `<div class="fnc"><b>${T('bag.finishIn', { t: Math.ceil(left) })}</b><i></i></div>` +
        `<button class="btn fnx" data-ev="stay">${T('bag.cancel')}</button>`;
      bar = k;
    } else if (!busy && !S.demo && won && S.winAt && S.t >= S.winAt)
      h =
        `<button class="btn orange fnb" data-ev="go"><span class="ic">${ICO.flag}</span>` +
        `${T(raid ? 'bag.finishRaid' : 'bag.finish')}${window.__touch ? '' : '<kbd>Enter</kbd>'}</button>` +
        `<div class="fns">${T('bag.won')}</div>`;
    B.fin = !!h && !S.ex; // (Enter presses it: the keys below)
    finEl.classList.toggle('on', !!h);
    if (h !== finSig) {
      finSig = h;
      finEl.innerHTML = h;
    }
    fill(finEl, bar);
  }
  const clock = (s) => {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  // what the run said about the backpack (its events): a line for each thing taken, the full backpack flashing
  // (a run's events are added at the end and dropped from the front, sim.js: the ones not heard yet are the list's tail, found
  // from the end — every event looked up every frame was 900 lookups a frame in a long fight)
  function hear(S) {
    let i = S.ev.length;
    while (i > 0 && !seen.has(S.ev[i - 1])) i--;
    for (; i < S.ev.length; i++) {
      const e = S.ev[i];
      seen.add(e);
      if (S.t - e.t > 1 || (e.pi !== undefined && e.pi !== (S.me | 0))) continue;
      if (e.k === 'loot') toast(e.it, e.n);
      else if (e.k === 'bagfull') {
        // the backpack can't take it: the button flashes, and a line says so (at most one every FULL_GAP ms)
        const now = performance.now();
        if (now - fullT > FULL_GAP) toast(e.it, 0, T(window.__touch ? 'bag.fullTouch' : 'bag.fullHint'));
        fullT = now;
      }
      if (window.AUDIO && AUDIO.ui && (e.k === 'loot' || e.k === 'drop')) AUDIO.ui('whoosh0', 0.18);
    }
  }
  const FULL_GAP = 2500;
  // a line over the backpack's button: a thing taken (n of it), or another line (say) with its picture
  function toast(id, n, say) {
    const it = itemOf(id),
      el = document.createElement('div');
    el.className = `bt r${it.rarity}` + (say ? ' warn' : '');
    el.innerHTML = `<img src="${pic(id)}" alt="" draggable="false"><span>${say || T('bag.got', { n: fmtN(n), item: T('item.' + id) })}</span>`;
    toasts.prepend(el);
    toasts.classList.add('on');
    while (toasts.children.length > 4) toasts.lastChild.remove();
    setTimeout(() => el.classList.add('gone'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  // ---------- the window ----------
  B.toggle = () => (win ? B.close() : B.open());
  // the world's pace while the window is up (index.html steps the sim by it, a run alone: a run together keeps the room's clock)
  B.SLOW = 0.3;
  B.pace = () => (win ? B.SLOW : 1);
  B.open = () => {
    const S = window.GAME && GAME.play;
    if (win || !live(S) || S.pause || GAME.menu) return;
    win = document.createElement('div');
    win.id = 'bagw';
    ui.appendChild(win);
    window.__modal = true;
    sel = null;
    sig = '';
    win.addEventListener('pointerdown', onDown);
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', () => endDrag());
    win.addEventListener('contextmenu', onCtx);
    win.addEventListener('click', onClick);
    if (window.AUDIO && AUDIO.ui) AUDIO.ui('whoosh0', 0.25);
    paint(S, SIM.lootNear(S, S.p));
    requestAnimationFrame(() => win && win.classList.add('on'));
  };
  B.close = () => {
    if (!win) return;
    endDrag();
    const old = win;
    win = null;
    window.__modal = false;
    old.classList.remove('on');
    old.classList.add('gone');
    setTimeout(() => old.remove(), 200);
  };
  // an item the base needs now (hub.js needed: the tutorial's building's parts, after it the buildings' next levels): a
  // check in its slot's corner (the human's, 2026-11-11)
  const CHK =
    '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let needs = new Set();
  const needMark = (id) => (needs.has(id) ? `<i class="mk-need" title="${T('market.needed')}">${CHK}</i>` : '');
  function slotHtml(p, s, b) {
    if (!b) return `<i class="mk-slot mk-none bg-s${sel === s ? ' on' : ''}" data-slot="${s}"></i>`;
    const it = itemOf(b[0]);
    return (
      `<button class="mk-slot bg-s r${it.rarity}${sel === s ? ' on' : ''}" data-slot="${s}" data-id="${b[0]}" title="${T('item.' + b[0])}">` +
      `<img src="${pic(b[0])}" alt="" draggable="false">${b[1] > 1 ? `<b class="mk-n">${fmtN(b[1])}</b>` : ''}${needMark(b[0])}</button>`
    );
  }
  function detail(p) {
    const b = sel === null ? null : slotAt(p, sel);
    if (!b)
      return `<div class="mk-hint">${ICO.bag}<span>${T(window.__touch ? 'bag.hintTouch' : 'bag.pick')}</span></div>`;
    const it = itemOf(b[0]),
      inSafe = sel >= SAFE0(),
      other = inSafe ? p.bag.findIndex((x) => !x) : p.safe.findIndex((x) => !x);
    let h =
      `<div class="mk-big r${it.rarity}"><img src="${pic(b[0])}" alt="" draggable="false"></div>` +
      `<h3>${T('item.' + b[0])}${b[1] > 1 ? ' ×' + fmtN(b[1]) : ''}</h3><div class="mk-tags"><span class="r${it.rarity}">${T('market.rarity.' + it.rarity)}</span>` +
      (it.kind === 'trophy' ? '' : `<span>${T('market.kind.' + it.kind)}</span>`) +
      '</div>';
    if (p.safe.length && other >= 0)
      h += `<button class="btn mk-go" data-a="${inSafe ? 'tobag' : 'tosafe'}">${T(inSafe ? 'bag.toBag' : 'bag.toSafe')}</button>`;
    h += `<button class="btn orange mk-go" data-a="drop">${T('bag.drop')}</button>`;
    return h;
  }
  function paint(S, near) {
    if (!win || (drag && drag.on)) return;
    const p = S.p,
      s = JSON.stringify([p.bag, p.safe, near.map((o) => [o.id, o.it, o.n]), sel, window.__touch ? 1 : 0]);
    if (s === sig) return;
    sig = s;
    needs = window.HUB && HUB.needed ? HUB.needed() : new Set();
    if (sel !== null && !slotAt(p, sel)) sel = null;
    const used = p.bag.filter(Boolean).length;
    let safe = '';
    if (p.safe.length) safe = p.safe.map((b, j) => slotHtml(p, SAFE0() + j, b)).join('');
    else safe = `<div class="bg-lock">${ICO.lock}<span>${T('bag.safeLocked')}</span></div>`;
    const ground = near.length
      ? near
          .map((o) => {
            const it = itemOf(o.it);
            return (
              `<button class="mk-slot r${it.rarity}" data-take="${o.id}" title="${T('item.' + o.it)}"><img src="${pic(o.it)}" alt="" draggable="false">` +
              `${o.n > 1 ? `<b class="mk-n">${fmtN(o.n)}</b>` : ''}${needMark(o.it)}</button>`
            );
          })
          .join('')
      : '';
    win.innerHTML =
      `<div class="mk-win"><div class="mk-head st"><span class="mk-ico bg-hi">${ICO.bag}</span><h2>${T('bag.title')}</h2>` +
      `<span class="bg-cap${used === p.bag.length ? ' full' : ''}">${used}/${p.bag.length}</span>` +
      `<button class="btn bg-sort" data-a="sort"><span class="ic">${ICO.sort}</span>${T('bag.sort')}</button>` +
      `<button class="mk-x" data-a="close" aria-label="${T('market.close')}">${ICO.x}</button></div>` +
      `<div class="mk-body"><div class="mk-side"><h4>${T('bag.title')}</h4><div class="mk-grid bg-grid">${p.bag.map((b, i) => slotHtml(p, i, b)).join('')}</div>` +
      `<h4>${T('bag.safe')}</h4><div class="mk-grid bg-grid bg-safe">${safe}</div><div class="bg-warn">${T('bag.lost')}</div></div>` +
      `<div class="mk-mid">${detail(p)}</div>` +
      `<div class="mk-side bg-ground" data-ground><h4>${T('bag.ground')}</h4>` +
      (ground
        ? `<div class="mk-grid bg-grid">${ground}</div>`
        : `<div class="mk-empty">${T('bag.groundEmpty')}</div>`) +
      (near.length > 1 ? `<button class="btn green mk-go bg-all" data-a="all">${T('bag.takeAll')}</button>` : '') +
      `</div></div><div class="bg-hint">${T(window.__touch ? 'bag.hintTouch' : 'bag.hint')}</div></div>`;
  }
  function onClick(e) {
    const S = GAME.play;
    if (!live(S)) return;
    const t = e.target.closest('[data-a],[data-take]');
    if (performance.now() - dragT < 120) return;
    if (!t) {
      if (e.target === win && downBg) B.close(); // (a click past the window)
      return;
    }
    if (t.dataset.take) return order(SIM.PICK.TAKE + +t.dataset.take);
    const a = t.dataset.a,
      p = S.p;
    if (a === 'close') B.close();
    else if (a === 'sort') {
      sel = null;
      order(SIM.PICK.sort);
    } else if (a === 'all') for (const o of SIM.lootNear(S, p)) order(SIM.PICK.TAKE + o.id);
    else if (a === 'drop' && sel !== null) {
      order(SIM.PICK.DROP + sel);
      sel = null;
    } else if ((a === 'tosafe' || a === 'tobag') && sel !== null) {
      const j = a === 'tosafe' ? p.safe.findIndex((x) => !x) : p.bag.findIndex((x) => !x);
      if (j >= 0) order(SIM.PICK.MOVE + sel * 100 + (a === 'tosafe' ? SAFE0() + j : j));
      sel = null;
    }
    sig = '';
  }
  // a tap on a slot: picks it (its item shown in the middle); with one picked, a tap on another moves it there
  function tapSlot(s) {
    const p = GAME.play.p;
    if (sel === s) sel = null;
    else if (sel !== null && slotAt(p, sel)) {
      order(SIM.PICK.MOVE + sel * 100 + s);
      sel = null;
    } else if (slotAt(p, s)) sel = s;
    sig = '';
  }
  function onCtx(e) {
    const t = e.target.closest('[data-slot][data-id]');
    e.preventDefault();
    if (t) {
      order(SIM.PICK.DROP + +t.dataset.slot);
      if (sel === +t.dataset.slot) sel = null;
      sig = '';
    }
  }
  function onDown(e) {
    e.stopPropagation(); // (the window's taps are not the game's)
    downBg = e.target === win;
    if (e.button === 2) return;
    const t = e.target.closest('[data-slot]');
    if (!t) return;
    drag = {
      s: +t.dataset.slot,
      id: t.dataset.id || '',
      x: e.clientX,
      y: e.clientY,
      on: false,
      ghost: null,
      pid: e.pointerId,
    };
  }
  function onMove(e) {
    if (!drag || !drag.id) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
      drag.on = true;
      try {
        win.setPointerCapture(drag.pid);
      } catch (err) {}
      const g = (drag.ghost = document.createElement('img'));
      g.className = 'bg-ghost';
      g.src = pic(drag.id);
      win.appendChild(g);
      win.classList.add('dragging');
    }
    if (drag.on) {
      const r = win.getBoundingClientRect();
      drag.ghost.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px) translate(-50%, -50%)`;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      for (const el of win.querySelectorAll('.drop-on')) el.classList.remove('drop-on');
      const tgt = over && (over.closest('[data-slot]') || over.closest('[data-ground]'));
      if (tgt) tgt.classList.add('drop-on');
    }
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag;
    if (!d.on) {
      endDrag();
      return tapSlot(d.s);
    }
    const over = document.elementFromPoint(e.clientX, e.clientY);
    endDrag();
    dragT = performance.now();
    const slot = over && over.closest('[data-slot]');
    if (slot && +slot.dataset.slot !== d.s) order(SIM.PICK.MOVE + d.s * 100 + +slot.dataset.slot);
    else if (over && over.closest('[data-ground]')) order(SIM.PICK.DROP + d.s);
    if (sel === d.s) sel = null;
    sig = '';
  }
  function endDrag() {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    drag = null;
    if (win) {
      win.classList.remove('dragging');
      for (const el of win.querySelectorAll('.drop-on')) el.classList.remove('drop-on');
    }
  }
  // the keys: Tab or I the window, E takes what is in reach, Esc closes the window (not the pause menu under it), Enter
  // finishes a won run (the button under the clock up)
  addEventListener(
    'keydown',
    (e) => {
      const S = window.GAME && GAME.play;
      if (!live(S) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) B.toggle();
      } else if (e.code === 'Escape' && win) {
        e.preventDefault();
        e.stopPropagation();
        B.close();
      } else if (e.code === 'KeyE' && !e.repeat && !S.pause && !GAME.menu && B.near)
        order(SIM.PICK.take); // (the nearest, as the sim sees it then)
      else if (
        (e.code === 'Enter' || e.code === 'NumpadEnter') &&
        !e.repeat &&
        B.fin &&
        !win &&
        !S.pause &&
        !GAME.menu
      ) {
        e.preventDefault();
        order(SIM.PICK.exit);
      }
    },
    true,
  );
})();
