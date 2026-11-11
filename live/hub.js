// live/hub.js — NEAR Base between runs (docs/design.md, "Hub base"): Copper walks the office's inside (the sim's walking
// mode on SIM.BASE, index.html GAME.hub) and walks up to its buildings, Walt and Nova. By one of them its name lights up and a prompt
// asks for E (a tap on touch); that opens its panel: a building's level and what its next level needs (economy.js
// BUILDINGS: coins and items), Nova's order (the next mission's goal). Walt opens his trade window and the stash's
// lockers the stash (market.js); so do the stash's button in the corner and I, wherever the hero stands. The scene
// draws the names over the furniture and the base's goal (scene.js hubHud, from spots() and goal()); the page draws
// the rest.
(function () {
  const H = (window.HUB = {}),
    E = window.ECONOMY;
  // every spot and the furniture it is found by in the base's level (the first prop of that name: Walt and Nova from
  // sim.js HUB_NPC; the buildings' furniture is not in the office yet, so their spots wait for it): one table, so a new
  // picture for Walt or a building is a change of one name here. b: its building (economy.js), who: a person, soon:
  // shown, not open yet
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
    task = null,
    taskAt = 0;
  // the base's goals once mission 1 is won (docs/design.md, "Player path" 6), each a mission goal's plaque and arrow
  // (scene.js hubHud, from H.goal): walk up to Walt (Walt's thanks, walt.1, as Copper comes in) until the hero stands
  // by him; sell him the cleaver while the stash holds it, until the first sale (market.js); then, while a campaign
  // mission is to be played (rules.js current), the next one from Nova (her panel: the order, the map). Kept in the
  // save's seen list. task: { id, key, who, t0 } or null
  const FIRST = 'walt.task',
    SOLD = 'walt.sold',
    LAB_LINE = 'base.nova17';
  function goalNow() {
    if (!(SAVE.camp || []).includes('office')) return null;
    if (!SAVE.seen(FIRST)) return { id: 'walt', key: 'task.walt', who: 'walt' };
    if (!SAVE.seen(SOLD) && (SAVE.items || {}).t_butcher > 0) return { id: 'sell', key: 'task.sell', who: 'walt' };
    if (RULES.current(SAVE)) return { id: 'next', key: 'task.next', who: 'nova' };
    return null;
  }
  // (each frame reads the seen list at most every 300 ms; a new goal drops its plaque in anew)
  function retask(t, now) {
    if (now !== undefined && now - taskAt < 300) return;
    taskAt = now || 0;
    const g = goalNow();
    if (!g) task = null;
    else if (!task || task.id !== g.id) task = { ...g, t0: t };
  }
  // Copper infected: from mission 2's win (the Mushroom Monster's spores, nova.16) until mission 3 is won; a mark over him
  // at the base (scene.js hubHud), story only
  H.infected = () => {
    const c = SAVE.camp || [];
    return c.includes('suburb') && !c.includes('lab');
  };
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
  // a building's trophy lock (economy.js lockedBy, the range: the Mushroom Monster's cap): open once that trophy has been
  // brought home, while the stash holds it or after it was sold (rules.js save.held)
  const lockedBy = (b) => {
    if (!b || !b.lockedBy) return null;
    const have = (SAVE.items || {})[b.lockedBy] > 0 || (SAVE.held || []).includes(b.lockedBy);
    return have ? null : b.lockedBy;
  };
  const isLocked = (s) => !!s.soon || !!lockedBy(s.b && E.building(s.b));
  // what the scene draws over the furniture: each spot, its prop, whether the hero is by it, whether it is locked
  H.spots = (st) => {
    if (!st || !st.hub) return [];
    const LV = SIM.level(st.seed),
      by = nearest(st, LV);
    return found(LV).map(({ s, prop }) => ({ id: s.id, prop, near: by === s, lock: isLocked(s) }));
  };
  // the goal for the scene (missionGoal's shape: its line, the arrow's point over the head of whom it is about, the
  // plaque lower than a run's, under the base's title), or null
  H.goal = (st) => {
    if (!task || !st || !st.hub) return null;
    const w = found(SIM.level(st.seed)).find(({ s }) => s.id === task.who);
    if (!w) return null;
    const o = w.prop,
      A = window.ASSETS && ASSETS[o.n],
      h = A ? (o.w * A.h) / A.w : 140;
    return { key: task.key, k: 'reach', at: [o.x, o.y], lift: h * 0.78 + 56, y: 124, t0: task.t0 };
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
        <span class="ic">${K.ICO.lobby}</span></button>
      <button class="lbp hsnd" data-snd title="${T('settings.sound')} (M)" aria-label="${T('settings.sound')}">
        <span class="ic"></span></button>
      <div class="lbp htitle"><span class="ic">${K.ICO.base}</span><span>${T('hub.title')}</span></div>
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
    K.on(el, '[data-snd]', () => {
      if (window.AUDIO) AUDIO.toggle();
      sound();
    });
    sound();
    addEventListener('keydown', onKey, true);
    task = null;
    retask(st.t);
    if (task && task.id === 'walt' && window.VOICE) VOICE.say('walt.1', true);
    // mission 2 won, mission 3 not yet: Nova sends Copper to the lab for the antivirus (nova.17), once
    if (H.infected() && !SAVE.seen(LAB_LINE) && window.VOICE) {
      SAVE.see(LAB_LINE);
      VOICE.say('nova.17', true);
    }
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
  // the sound's button: on or off as the game's sound is (audio.js; M toggles it too)
  const audioOn = () => !!(window.AUDIO && AUDIO.on);
  function sound() {
    const b = el && el.querySelector('.hsnd');
    if (!b) return;
    b.classList.toggle('on', audioOn());
    b.querySelector('.ic').innerHTML = audioOn() ? UI.kit.ICO.snd : UI.kit.ICO.mute;
  }
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
    retask(st.t, performance.now()); // (a sale to Walt, a save from the server)
    if (audioOn() !== el.querySelector('.hsnd').classList.contains('on')) sound(); // (M pressed)
    const by = nearest(st, SIM.level(st.seed));
    if (by === near) return;
    near = by;
    if (task && task.id === 'walt' && by && by.who === 'walt') {
      SAVE.see(FIRST);
      retask(st.t);
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
        (s.who === 'nova' ? orders(K) : s.soon ? soon(K) : building(s, K)) +
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
  const soon = (K) => `<div class="hlv lock">${K.T('hub.soon')}</div>`;
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
