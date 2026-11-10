// live/hub.js — NEAR Base between runs (docs/design.md, "Hub base"): Copper walks the bunker (the sim's walking mode,
// index.html GAME.hub) and walks up to its buildings, Walt and Nova. By one of them its name lights up and a prompt
// asks for E (a tap on touch); that opens its panel: a building's level and what its next level needs (economy.js
// BUILDINGS: coins and items), Nova's order (the next mission's goal). Walt opens his trade window and the stash's
// lockers the stash (market.js); so do the stash's button in the corner and I, wherever the hero stands. The scene
// draws the names over the furniture (scene.js hubHud, from spots()); the page draws the rest.
(function () {
  const H = (window.HUB = {}),
    E = window.ECONOMY;
  // every spot and the furniture it is found by in the base's map (the first prop of that name, live/map_base.js): one
  // table, so a new picture for Walt or a building is a change of one name here. b: its building (economy.js), who: a
  // person, soon: shown, not open yet
  const SPOTS = [
    { id: 'generator', prop: 'lb_generator', b: 'generator' },
    { id: 'stash', prop: 'lb_lockers', b: 'stash' },
    { id: 'workbench', prop: 'lb_workbench', b: 'workbench' },
    { id: 'medbay', prop: 'lb_stretcher', b: 'medbay' },
    { id: 'range', prop: 'lb_target', b: 'range' },
    { id: 'walt', prop: 'np_walt', who: 'walt' },
    { id: 'nova', prop: 'np_nova', who: 'nova' },
    { id: 'kitchen', prop: 'lb_counter', soon: 1 },
    { id: 'server', prop: 'lb_servers', soon: 1 },
  ];
  const REACH = 130; // ground units from the hero to a piece of furniture's footprint: near enough to use it
  const KEY_ICO = 'E',
    HOME_ICO =
      '<svg viewBox="0 0 24 24"><path d="M3 11.2L12 3.5l9 7.7V20a1 1 0 0 1-1 1h-5.2v-6.2H9.2V21H4a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
    BASE_ICO =
      '<svg viewBox="0 0 24 24"><path d="M2.5 11L12 4l9.5 7v9.5h-19z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 20.5v-6h8v6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    INV_ICO =
      '<svg viewBox="0 0 24 24"><path d="M3 8.5L12 4l9 4.5v8L12 21l-9-4.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M3 8.5l9 4.5 9-4.5M12 13v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    BOLT =
      '<svg viewBox="0 0 24 24"><path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6z" fill="currentColor" stroke="#000" stroke-width="1" stroke-linejoin="round"/></svg>';
  const pic = (file) => `assets/${file}?v=${window.__V || 0}`;

  let el = null,
    S = null,
    near = null,
    shown = '',
    loop = 0,
    lvCache = null,
    task = null;
  // the first visit after mission 1 (docs/design.md, "Player path" 6): Walt's thanks (walt.1) as Copper comes in, then
  // the task "walk up to Walt" with a mission goal's plaque and arrow (scene.js hubHud, from H.goal) until the hero
  // stands by him (his market comes later); done for good in the save's seen list. task: { t0 } while it is on
  const FIRST = 'walt.task';
  const firstVisit = () => (SAVE.camp || []).includes('office') && !SAVE.seen(FIRST);
  // the spots found in the level (cached per level: the editor rebuilds it)
  function found(LV) {
    if (lvCache && lvCache.LV === LV) return lvCache.list;
    const list = [];
    for (const s of SPOTS) {
      const prop = LV.props.find((o) => o.n === s.prop);
      if (prop) list.push({ s, prop });
    }
    lvCache = { LV, list };
    return list;
  }
  // a building's trophy lock (economy.js lockedBy): open once the mission whose reward it is has been won (save.camp;
  // the base doesn't keep the player's items yet)
  const lockedBy = (b) => {
    if (!b || !b.lockedBy) return null;
    const m = E.MISSIONS.find((q) => q.reward && q.reward.items.some(([id]) => id === b.lockedBy));
    return m && (SAVE.camp || []).includes(m.id) ? null : b.lockedBy;
  };
  const isLocked = (s) => !!s.soon || !!lockedBy(s.b && E.building(s.b));
  // what the scene draws over the furniture: each spot, its prop, whether the hero is by it, whether it is locked
  H.spots = (st) => {
    if (!st || !st.hub) return [];
    const LV = SIM.level(st.seed),
      by = nearest(st, LV);
    return found(LV).map(({ s, prop }) => ({ id: s.id, prop, near: by === s, lock: isLocked(s) }));
  };
  // the task's goal for the scene (missionGoal's shape: its line, the arrow's point over Walt's head, the plaque lower
  // than a run's, under the base's title), or null
  H.goal = (st) => {
    if (!task || !st || !st.hub) return null;
    const w = found(SIM.level(st.seed)).find(({ s }) => s.id === 'walt');
    if (!w) return null;
    const o = w.prop,
      A = window.ASSETS && ASSETS[o.n],
      h = A ? (o.w * A.h) / A.w : 140;
    return { key: 'task.walt', k: 'reach', at: [o.x, o.y], lift: h * 0.78 + 56, y: 124, t0: task.t0 };
  };
  // the spot the hero stands by (the nearest within REACH of its footprint), or null
  function nearest(st, LV) {
    const gx = SIM.toGx(st.p.x, st.p.y),
      gy = SIM.toGy(st.p.x, st.p.y);
    let best = null,
      bd = REACH;
    for (const { s, prop: o } of found(LV)) {
      const dx = Math.max(o.gx - o.fw / 2 - gx, 0, gx - o.gx - o.fw / 2),
        dy = Math.max(o.gy - o.fh / 2 - gy, 0, gy - o.gy - o.fh / 2),
        d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  H.open = (st) => {
    H.close();
    S = st;
    const K = UI.kit,
      { T } = K;
    el = document.createElement('div');
    el.id = 'hub';
    el.innerHTML = `<div class="pg">
      <button class="lbp back" data-map><span class="ic">${K.HICO.back}</span>${T('hub.map')}</button>
      <button class="lbp hhome" data-lobby title="${T('common.toLobby')}" aria-label="${T('common.toLobby')}">
        <span class="ic">${HOME_ICO}</span></button>
      <div class="lbp htitle"><span class="ic">${BASE_ICO}</span><span>${T('hub.title')}</span></div>
      <div class="lbp hcoin">${K.coin()}<span>${K.fmtN(SAVE.coins)}</span></div>
      <button class="lbp hinv" data-inv title="${T('market.stash')}" aria-label="${T('market.stash')}">
        <span class="ic">${INV_ICO}</span><span>${T('market.stash')}</span><kbd>I</kbd></button>
      <button class="lbp hask" data-use hidden><kbd>${KEY_ICO}</kbd><b></b><span></span></button>
      <div class="lbp hpanel" hidden></div></div>`;
    document.getElementById('ui').appendChild(el);
    K.on(el, '[data-map]', () => {
      GAME.quit();
      UI.campaign();
    });
    K.on(el, '[data-lobby]', () => GAME.quit());
    K.on(el, '[data-use]', () => use());
    K.on(el, '[data-inv]', () => window.MARKET && MARKET.open('stash'));
    addEventListener('keydown', onKey, true);
    task = firstVisit() ? { t0: st.t } : null;
    if (task && window.VOICE) VOICE.say('walt.1', true);
    const tick = () => {
      loop = requestAnimationFrame(tick);
      frame();
    };
    loop = requestAnimationFrame(tick);
  };
  H.close = () => {
    if (!el) return;
    cancelAnimationFrame(loop);
    removeEventListener('keydown', onKey, true);
    if (window.MARKET) MARKET.close();
    el.remove();
    el = S = near = task = null;
    shown = '';
    if (window.VOICE) VOICE.hide();
  };
  // E uses the spot the hero is by (or closes its panel); Esc closes a panel. The game's own keys stay as they are
  function onKey(e) {
    if (!el || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.MARKET && MARKET.isOpen()) return; // (its own keys)
    if (e.code === 'KeyI') {
      e.preventDefault();
      panel(null);
      if (window.MARKET) MARKET.open('stash');
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      if (shown) panel(null);
      else use();
    } else if (e.code === 'Escape' && shown) {
      e.stopPropagation();
      panel(null);
    }
  }
  // each frame: which spot the hero is by; the prompt for it; a panel left open closes when the hero walks off
  function frame() {
    const st = GAME.play;
    if (!st || !st.hub) return;
    S = st;
    const purse = el.querySelector('.hcoin span'),
      coins = UI.kit.fmtN(SAVE.coins);
    if (purse.textContent !== coins) purse.textContent = coins; // (a trade with Walt, a save from the server)
    const by = nearest(st, SIM.level(st.seed));
    if (by === near) return;
    near = by;
    if (task && by && by.who === 'walt') {
      task = null;
      SAVE.see(FIRST);
    }
    const ask = el.querySelector('.hask'),
      { T } = UI.kit;
    ask.hidden = !by;
    if (by) {
      ask.querySelector('b').textContent = T('hub.spot.' + by.id);
      ask.querySelector('span').textContent = T(by.who === 'walt' ? 'hub.trade' : by.who ? 'hub.talk' : 'hub.open');
      ask.classList.toggle('lock', isLocked(by));
      ask.classList.toggle('touch', !!window.__touch);
    }
    if (shown && (!by || by.id !== shown)) panel(null);
  }
  function use() {
    const s = near;
    if (!s) return;
    if (s.who === 'walt' || s.id === 'stash') {
      panel(null);
      if (window.MARKET) MARKET.open(s.who === 'walt' ? 'walt' : 'stash');
      return;
    }
    panel(s);
  }
  // a spot's panel (null: closed)
  function panel(s) {
    const box = el.querySelector('.hpanel');
    shown = s ? s.id : '';
    box.hidden = !s;
    if (!s) return;
    const K = UI.kit,
      { T } = K,
      h =
        (s.who === 'nova' ? orders(K) : s.soon ? soon(s, K) : building(s, K)) +
        `<button class="btn ghost hx" data-close>${T('hub.close')}</button>`;
    // its head: Nova's portrait under her name's tab (as the radio's box), a building's own picture beside its name
    const head =
      s.who === 'nova'
        ? `<div class="hhead nova"><div class="hpor"><img src="${pic('por_nova.png')}" alt="" draggable="false"></div>` +
          `<div><span class="htab">${T('voice.name.nova')}</span><h3>${T('hub.order')}</h3></div></div>`
        : `<div class="hhead"><div class="hpic"><img src="${pic(s.prop + '.png')}" alt="" draggable="false"></div>` +
          `<h3>${T('hub.spot.' + s.id)}</h3></div>`;
    box.innerHTML = head + h;
    K.on(box, '[data-close]', () => panel(null));
    K.on(box, '[data-tomap]', () => {
      GAME.quit();
      UI.campaign();
    });
  }
  const soon = (s, K) =>
    `<p class="hgive">${K.T('hub.gives.' + s.id)}</p><div class="hlv lock">${K.T('hub.soon')}</div>`;
  // Nova: her order, the current mission's goal (rules.js current; the campaign map plays it)
  function orders(K) {
    const { T } = K,
      id = RULES.current(SAVE),
      m = id ? E.mission(id) : null;
    if (!m) return `<p class="hgive">${T('hub.noOrder')}</p>`;
    return (
      `<h4>${m.n} · ${T('mission.' + m.id + '.name')}</h4>` +
      `<p class="hgive">${T('mission.' + m.id + '.goal')}</p>` +
      `<button class="btn orange" data-tomap>${T('hub.map')}</button>`
    );
  }
  // a building: what it gives, its level (the save keeps no building levels yet: none built), what the next level
  // needs (coins, items with their pictures, the generator's level, a trophy lock) and Build, not open yet
  function building(s, K) {
    const { T, fmtN, coin } = K,
      b = E.building(s.b),
      lvl = 0,
      next = b.levels[lvl],
      lock = lockedBy(b);
    let h = `<p class="hgive">${T('hub.gives.' + s.id)}</p>`;
    h += `<div class="hlv">${lvl ? T('hub.level', { n: lvl, m: b.levels.length }) : T('hub.none')}</div>`;
    if (!next) return h + `<div class="hlv">${T('hub.top')}</div>`;
    const short = SAVE.coins < next.coins;
    h += `<h4>${T('hub.needs')}</h4><div class="hneed">`;
    h += `<span class="hn${short ? ' short' : ''}">${coin()}<b>${fmtN(next.coins)}</b></span>`;
    for (const [id, n] of next.items) {
      const name = T('item.' + id);
      h += `<span class="hn" title="${name}"><img src="${pic('it_' + id + '.png')}" alt="" draggable="false">`;
      h += `<b>×${n}</b><small>${name}</small></span>`;
    }
    if (next.power) h += `<span class="hn pw">${BOLT}<small>${T('hub.power', { n: next.power })}</small></span>`;
    h += '</div>';
    if (lock) h += `<p class="hlock">${T('hub.lockedBy', { item: T('item.' + lock) })}</p>`;
    return h + `<button class="btn orange" disabled>${T('hub.buildSoon')}</button>`;
  }
})();
