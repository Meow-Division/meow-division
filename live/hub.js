// live/hub.js — NEAR Base between runs (docs/design.md, "Hub base"): Copper walks the office's inside (the sim's walking
// mode on SIM.BASE, index.html GAME.hub) and walks up to its buildings, its heaps of old junk, Walt and Nova. By one of them
// its name lights up and a prompt asks for E (a tap on touch); that opens its panel: a building's level, what its next
// level needs (economy.js BUILDINGS: items, coins) and Build; a heap's clearing; Nova's orders. Walt opens his trade window
// and the stash's lockers the stash (market.js); so do the stash's button in the corner and I, wherever the hero stands.
// The scene draws the names over the furniture and the base's goal (scene.js hubHud, from spots() and goal()), the
// buildings faint until they stand and the junk gone once cleared (S.base: sim.js HUB_BUILD, HUB_JUNK); the page draws the rest.
// Nova's base tutorial (the human's, 2026-11-11), each step the base's goal with its arrow, kept in the save (rules.js base)
// but for the lines already heard (SAVE.seen):
//   walk up to Walt (walt.1 as Copper comes in) → talk to him: his window teaches the sale of the cleaver (market.js lesson,
//   walt.2, walt.3) → talk to Nova (nova.25: upgrades need the generator, the workbench and the medbay) → build the
//   generator (its parts from Walt or the suburb's first boss, once: rules.js gift; 5 s; nova.26) → clear the alcove's junk
//   (5 s; nova.27) → build the workbench (nova.28: guns from Walt, upgrades here) → clear the glass room (1 min) and, while it
//   goes, buy a gun from Walt and upgrade it here → build the medbay (nova.29, nova.30: "the rest is yours"). After it every
//   heap of junk has its gear, each clearing longer than the last (economy.js CLEAR_TIME).
(function () {
  const H = (window.HUB = {}),
    E = window.ECONOMY,
    R = window.RULES;
  // every spot and how it is found in the base's level: a building's furniture (sim.js HUB_BUILD, bspot: its id), a
  // person or a building not placed yet by a prop's name (Walt and Nova from sim.js HUB_NPC), a heap of junk by its first
  // prop (sim.js HUB_JUNK). b: its building (economy.js), who: a person, junk: a heap's id, soon: shown, not open yet
  const SPOTS = [
    { id: 'generator', b: 'generator', bspot: 1 },
    { id: 'workbench', b: 'workbench', bspot: 1 },
    { id: 'medbay', b: 'medbay', bspot: 1 },
    { id: 'stash', prop: 'lb_lockers', b: 'stash' },
    { id: 'range', prop: 'lb_target', b: 'range' },
    { id: 'walt', prop: 'np_walt', who: 'walt' },
    { id: 'nova', prop: 'np_nova', who: 'nova' },
    { id: 'kitchen', prop: 'lb_counter', soon: 1 },
    { id: 'server', prop: 'lb_servers', soon: 1 },
  ].concat(E.JUNK.map((j) => ({ id: 'j_' + j, junk: j })));
  const REACH = 130; // ground units from the hero to a piece of furniture's footprint: near enough to use it
  const KEY_ICO = 'E',
    INV_ICO =
      '<svg viewBox="0 0 24 24"><path d="M3 8.5L12 4l9 4.5v8L12 21l-9-4.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M3 8.5l9 4.5 9-4.5M12 13v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    BOLT =
      '<svg viewBox="0 0 24 24"><path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6z" fill="currentColor" stroke="#000" stroke-width="1" stroke-linejoin="round"/></svg>',
    CHECK =
      '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    CROSS =
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
    GEAR =
      '<svg viewBox="0 0 24 24"><path d="M10.3 2h3.4l.5 2.6 1.7.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.7 2.6.5v3.4l-2.6.5-.7 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.7-.5 2.6h-3.4l-.5-2.6-1.7-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.7L2 13.7v-3.4l2.6-.5.7-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.7-.7z" fill="currentColor"/><circle cx="12" cy="12" r="3.4" fill="#1b2130"/></svg>';
  const pic = (file) => `assets/${file}?v=${window.__V || 0}`;
  const now = () => Date.now();
  const NPC_H = { np_nova: 128, np_walt: 118 }; // (the people's height on screen: their models, scene.js NPC3D)

  let el = null,
    S = null,
    near = null,
    shown = '',
    loop = 0,
    lvCache = null,
    task = null,
    taskAt = 0,
    paintAt = 0;
  // the lines the tutorial says once (SAVE.seen) and what they are about
  const FIRST = 'walt.task', // (Copper has stood by Walt)
    SOLD = 'walt.sold', // (the first sale: market.js)
    NOVA_TALK = 'bt.nova', // (Nova's talk on the base's buildings, nova.25)
    LAB_LINE = 'base.nova17';
  // a step done while Copper is at the base (or since he was last here): Nova's line on it, once — the newest one alone
  // when several came at once (a clearing finished while he was out on a raid, say)
  const DONE_LINES = [
    ['bt.gen', 'nova.26', () => R.blv(SAVE, 'generator', now()) >= 1],
    ['bt.alcove', 'nova.27', () => R.cleared(SAVE, 'alcove', now())],
    ['bt.wb', 'nova.28', () => R.blv(SAVE, 'workbench', now()) >= 1],
    ['bt.meeting', 'nova.29', () => R.cleared(SAVE, 'meeting', now())],
    ['bt.med', 'nova.30', () => R.blv(SAVE, 'medbay', now()) >= 1],
  ];

  // ---------- the tutorial's state (rules.js base: the server's for an account) ----------
  const tutorialOn = () => (SAVE.camp || []).includes('office');
  // the cleaver still to be sold to Walt: his window teaches the sale (market.js lesson)
  H.sellDue = () => tutorialOn() && (SAVE.items || {}).t_butcher > 0 && !(SAVE.held || []).includes('t_butcher');
  const standing = (id) => R.blv(SAVE, id, now()) >= 1;
  // a gun Walt has for Copper now (his rank, not his yet, the coins for it) / bought one besides the pistol already
  const gunToBuy = () =>
    DATA.MAIN_ORDER.some(
      (id) =>
        R.usable(id) && !SAVE.owned[id] && DATA.MAIN[id].rank <= R.rank(SAVE) && DATA.MAIN[id].price <= SAVE.coins,
    );
  const hasGun = () => Object.keys(SAVE.owned || {}).some((id) => id !== 'pistol' && SAVE.owned[id]);
  // an upgrade the workbench can give now (a gun owned, under its mastery, the coins) / one given already
  const upToBuy = () =>
    Object.keys(SAVE.owned || {}).some((id) => {
      if (!SAVE.owned[id] || !R.usable(id)) return false;
      const u = SAVE.wupOf(id);
      return Object.keys(DATA.WEAPON_UP).some((k) => {
        const lv = u[k] || 0,
          P = DATA.WEAPON_UP[k].price[lv];
        return P !== undefined && lv < R.mastery(SAVE, id) && P <= SAVE.coins;
      });
    });
  const upgraded = () => Object.values(SAVE.wup || {}).some((u) => Object.values(u || {}).some((n) => n > 0));
  // the base's goal now: { id, key, v, who | spot } or null — the old ones (Walt, the cleaver, Nova's next mission) round
  // the tutorial's steps
  function goalNow() {
    if (!tutorialOn()) return null;
    const t = now();
    if (!SAVE.seen(FIRST)) return { id: 'walt', key: 'task.walt', who: 'walt' };
    if (H.sellDue()) return { id: 'trade', key: 'task.trade', who: 'walt' };
    const bt = R.task(SAVE);
    // a building going up: waited for, its time on the plaque
    for (const id of R.TASKS) {
      const b = R.baseOf(SAVE);
      if (b.lv[id] >= 1 && R.blv(SAVE, id, t) < 1) return { id: 'going:' + id, key: 'task.going.' + id, spot: id };
    }
    if (bt && !SAVE.seen(NOVA_TALK)) return { id: 'nova', key: 'task.nova', who: 'nova' };
    if (bt === 'generator') return { id: 'build:generator', key: 'task.build.generator', spot: 'generator' };
    if (bt) {
      const room = E.ROOM[bt],
        clearing = R.clearing(SAVE, t);
      if (room && !R.cleared(SAVE, room, t) && clearing !== room)
        return { id: 'clear:' + room, key: 'task.clear.' + bt, spot: 'j_' + room, busy: !!clearing };
      // (the medbay's room clearing for a minute: meanwhile a gun from Walt and its upgrade at the workbench)
      if (bt === 'medbay') {
        if (!hasGun() && gunToBuy()) return { id: 'gun', key: 'task.gun', who: 'walt' };
        if (!upgraded() && upToBuy()) return { id: 'upgun', key: 'task.upgun', spot: 'workbench' };
      }
      if (clearing === room) return { id: 'clearing:' + room, key: 'task.clearing', spot: 'j_' + room };
      return { id: 'build:' + bt, key: 'task.build.' + bt, spot: bt };
    }
    if (R.current(SAVE)) return { id: 'next', key: 'task.next', who: 'nova' };
    return null;
  }
  // (each frame reads the save at most every 300 ms; a new goal drops its plaque in anew)
  function retask(t, nowMs) {
    if (nowMs !== undefined && nowMs - taskAt < 300) return;
    taskAt = nowMs || 0;
    const g = goalNow();
    if (!g) task = null;
    else if (!task || task.id !== g.id) task = { ...g, t0: t };
    else task.key = g.key;
    doneLines();
    card();
  }
  // The tutorial's building and its parts in a card by the screen's bottom-right corner, over Walt's window too (the human's,
  // 2026-11-11: "don't take the task away, fold it into a square on the right, to open it by the trader and see what the
  // craft needs"): folded, a square with the building's picture and how many of its parts the stash has; open, the parts
  // one by one with the stash's counts and checks, and where they come from. Hidden while a base panel is up (it says the
  // same) and once the tutorial is done
  const TK_KEY = 'md.taskOpen';
  let tkOpen = (() => {
    try {
      return localStorage.getItem(TK_KEY) !== '0';
    } catch (e) {
      return true;
    }
  })();
  function card() {
    const box = el && el.querySelector('.btask');
    if (!box) return;
    const bt = R.task(SAVE);
    if (!bt || !tutorialOn()) {
      box.hidden = true;
      return;
    }
    const K = UI.kit,
      { T } = K,
      L = E.building(bt).levels[0],
      got = L.items.filter(([id, n]) => ((SAVE.items || {})[id] || 0) >= n).length,
      all = L.items.length,
      img = `<img src="${pic(HUB_BUILD_PIC[bt] + '.png')}" alt="" draggable="false">`,
      html = tkOpen
        ? `<div class="btk-card"><button class="btk-h" data-tk title="${T('hub.taskFold')}">${img}` +
          `<span><small>${T('hub.taskTab')}</small><b>${T('hub.spot.' + bt)}</b></span><i class="btk-fold">−</i></button>` +
          needs(L.items, K) +
          partsHint(bt, K) +
          '</div>'
        : `<button class="btk-sq${got >= all ? ' ok' : ''}" data-tk title="${T('hub.taskTab')}: ${T('hub.spot.' + bt)}">${img}` +
          `<b>${got}/${all}</b></button>`;
    if (box.dataset.h !== html) {
      box.dataset.h = html;
      box.innerHTML = html;
    }
    box.hidden = false;
  }
  // (each building's picture: its furniture in sim.js HUB_BUILD, the first piece)
  const HUB_BUILD_PIC = { generator: 'lb_generator', workbench: 'lb_workbench', medbay: 'lb_stretcher' };
  function doneLines() {
    let say = null;
    for (const [seen, line, done] of DONE_LINES)
      if (!SAVE.seen(seen) && done()) {
        SAVE.see(seen);
        say = line;
      }
    if (say && window.VOICE) VOICE.say(say, true);
  }
  // Copper infected: from mission 2's win (the Mushroom Monster's spores, nova.16) until mission 3 is won; a mark over him
  // at the base (scene.js hubHud), story only
  H.infected = () => {
    const c = SAVE.camp || [];
    return c.includes('suburb') && !c.includes('lab');
  };
  // what stands and what is cleared at the base, for the sim (index.html GAME.hub: sim.js S.base)
  H.baseOpt = () => {
    const t = now(),
      b = R.baseOf(SAVE);
    return {
      b: E.BUILDINGS.map((B) => B.id).filter((id) => R.blv(SAVE, id, t) >= 1),
      j: E.JUNK.filter((id) => R.cleared(SAVE, id, t)),
      p: b,
    };
  };
  // the sim's S.base kept as the save is (a build or a clearing done here, a save from the server), with how far the
  // building going up (p) and the heap being cleared (c) are, 0..1, for the scene
  function syncBase(st) {
    const t = now(),
      b = R.baseOf(SAVE),
      B = (st.base = st.base || { b: {}, j: {} });
    B.b = {};
    B.j = {};
    B.p = {};
    B.c = {};
    for (const D of E.BUILDINGS) {
      const id = D.id,
        n = b.lv[id] || 0;
      if (R.blv(SAVE, id, t) >= 1) B.b[id] = 1;
      if (n && (b.bt[id] || 0) > t && n === 1) {
        const dur = 1000 * E.BUILD_TIME[0];
        B.p[id] = Math.max(0.02, Math.min(1, 1 - (b.bt[id] - t) / dur));
      }
    }
    for (const id of E.JUNK) if (R.cleared(SAVE, id, t)) B.j[id] = 1;
    const cl = R.clearing(SAVE, t);
    if (cl) B.c[cl] = Math.max(0, Math.min(1, 1 - (b.clr[cl] - t) / (1000 * runningClear())));
  }
  // the length of the clearing going on now (s): the last one started (one at a time), the n-th of the base's
  const runningClear = () => {
    const n = Object.keys(R.baseOf(SAVE).clr).length;
    return E.CLEAR_TIME[Math.max(0, Math.min(n - 1, E.CLEAR_TIME.length - 1))];
  };
  // the spots found in the level (cached per level: the editor rebuilds it)
  function found(LV) {
    if (lvCache && lvCache.LV === LV) return lvCache.list;
    const list = [],
      J = SIM.HUB_JUNK || {};
    for (const s of SPOTS) {
      let prop = null;
      if (s.bspot) prop = LV.props.find((o) => o.bspot === s.b);
      else if (s.junk) {
        const [n, gx, gy] = (J[s.junk] || [])[0] || [];
        prop =
          LV.props.find(
            (o) => o.junk === s.junk && o.n === n && Math.abs(o.gx - gx) < 40 && Math.abs(o.gy - gy) < 40,
          ) || LV.props.find((o) => o.junk === s.junk);
      } else prop = LV.props.find((o) => o.n === s.prop);
      if (prop) list.push({ s, prop });
    }
    lvCache = { LV, list };
    return list;
  }
  // a heap of junk shown with its gear: not cleared yet, and the tutorial's own while it is on (the alcove once the
  // generator stands, the glass room once the workbench does); after it, every one
  function junkShown(id) {
    const t = now();
    if (R.cleared(SAVE, id, t)) return false;
    if (R.clearing(SAVE, t) === id) return true;
    const bt = R.task(SAVE);
    if (!bt) return tutorialOn() && R.blv(SAVE, 'medbay', t) >= 1;
    return E.ROOM[bt] === id && standing(R.TASKS[R.TASKS.indexOf(bt) - 1] || 'generator');
  }
  const shownSpot = (s) => !s.junk || junkShown(s.junk);
  // a building's trophy lock (economy.js lockedBy, the range: the Mushroom Monster's cap): open once that trophy has been
  // brought home, while the stash holds it or after it was sold (rules.js save.held)
  const lockedBy = (b) => {
    if (!b || !b.lockedBy) return null;
    const have = (SAVE.items || {})[b.lockedBy] > 0 || (SAVE.held || []).includes(b.lockedBy);
    return have ? null : b.lockedBy;
  };
  const isLocked = (s) => !!s.soon || !!lockedBy(s.b && E.building(s.b));
  // a spot's name over it: a heap of junk's; a building going up or a heap being cleared with the time left
  function spotName(s) {
    const { T } = UI.kit,
      t = now(),
      b = R.baseOf(SAVE);
    if (s.junk) {
      const left = R.clearing(SAVE, t) === s.junk ? (b.clr[s.junk] - t) / 1000 : 0;
      return left > 0 ? T('hub.clearingT', { t: clock(left) }) : T('hub.junk');
    }
    const nm = T('hub.spot.' + s.id);
    if (s.bspot && (b.lv[s.b] || 0) >= 1 && (b.bt[s.b] || 0) > t) return nm + ' · ' + clock((b.bt[s.b] - t) / 1000);
    return nm;
  }
  // what the scene draws over the furniture: each spot shown, its prop, whether the hero is by it, whether it is locked,
  // its name (gear: a heap of junk's)
  H.spots = (st) => {
    if (!st || !st.hub) return [];
    const LV = SIM.level(st.seed),
      by = nearest(st, LV);
    return found(LV)
      .filter(({ s }) => shownSpot(s))
      .map(({ s, prop }) => ({ id: s.id, prop, near: by === s, lock: isLocked(s), name: spotName(s), gear: !!s.junk }));
  };
  // the goal for the scene (missionGoal's shape: its line, the arrow's point over the head of whom or what it is about,
  // the plaque lower than a run's, under the base's title), or null
  H.goal = (st) => {
    if (!task || !st || !st.hub) return null;
    const w = found(SIM.level(st.seed)).find(({ s }) => (task.who ? s.id === task.who : s.id === task.spot));
    if (!w) return null;
    const o = w.prop,
      A = window.ASSETS && ASSETS[o.n],
      h = NPC_H[o.n] || (A ? (o.w * A.h) / A.w : 140);
    return { key: task.key, k: 'reach', at: [o.x, o.y], lift: h * 0.78 + 56, y: 124, t0: task.t0 };
  };
  // the spot the hero stands by (the nearest within REACH of its footprint, of those shown), or null
  function nearest(st, LV) {
    const gx = SIM.toGx(st.p.x, st.p.y),
      gy = SIM.toGy(st.p.x, st.p.y);
    let best = null,
      bd = REACH;
    for (const { s, prop: o } of found(LV)) {
      if (!shownSpot(s)) continue;
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
    el.innerHTML = `<div class="hdark"></div><div class="pg">
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
      <div class="lbp hpanel" hidden></div></div><div class="pg btl"><div class="btask" hidden></div></div>`;
    document.getElementById('ui').appendChild(el);
    K.on(el, '[data-map]', () => {
      GAME.quit();
      UI.campaign();
    });
    K.on(el, '[data-lobby]', () => GAME.quit());
    K.on(el, '[data-use]', () => use());
    K.on(el, '[data-inv]', () => window.MARKET && MARKET.open('stash'));
    // the task's card: a tap folds it into its square or opens it (kept for this browser)
    el.querySelector('.btask').addEventListener('click', (e) => {
      if (!e.target.closest('[data-tk]')) return;
      e.stopPropagation();
      tkOpen = !tkOpen;
      try {
        localStorage.setItem(TK_KEY, tkOpen ? '1' : '0');
      } catch (er) {}
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.25);
      card();
    });
    K.on(el, '[data-snd]', () => {
      if (window.AUDIO) AUDIO.toggle();
      sound();
    });
    sound();
    addEventListener('keydown', onKey, true);
    task = null;
    syncBase(st);
    // (no power yet: the office is dark until the generator runs — the human's "now we have light")
    el.classList.toggle('dark', tutorialOn() && !standing('generator'));
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
    if (window.MARKET) MARKET.close(true);
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
    if (window.__modal) return; // (another window over the base: the wallet's)
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
  // each frame: the base as the save has it, which spot the hero is by, the prompt for it; a panel left open closes when
  // the hero walks off, and one with a time on it is drawn anew each quarter second
  function frame() {
    const st = GAME.play;
    if (!st || !st.hub) return;
    S = st;
    syncBase(st);
    const purse = el.querySelector('.hcoin span'),
      coins = UI.kit.fmtN(SAVE.coins);
    if (purse.textContent !== coins) purse.textContent = coins; // (a trade with Walt, a save from the server)
    retask(st.t, performance.now()); // (a sale to Walt, a save from the server, a building up)
    const dark = tutorialOn() && !standing('generator');
    if (el.classList.contains('dark') !== dark) {
      el.classList.toggle('dark', dark);
      if (!dark) el.classList.add('lit'); // (the lights come on: a flicker)
    }
    if (audioOn() !== el.querySelector('.hsnd').classList.contains('on')) sound(); // (M pressed)
    if (shown && performance.now() - paintAt > 250) {
      const s = SPOTS.find((x) => x.id === shown);
      if (s && (s.junk || s.b)) panel(s, true);
    }
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
      ask.querySelector('b').textContent = by.junk ? T('hub.junk') : T('hub.spot.' + by.id);
      ask.querySelector('span').textContent = T(
        by.who === 'walt' ? 'hub.trade' : by.who ? 'hub.talk' : by.junk ? 'hub.clear' : 'hub.open',
      );
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
      // (the cleaver not sold yet: his window teaches the sale and stays until it is done)
      if (window.MARKET) MARKET.open(s.who === 'walt' ? 'walt' : 'stash', { lesson: s.who === 'walt' && H.sellDue() });
      return;
    }
    // Nova's talk on the base's buildings, the first time after the sale (her orders open with it)
    if (s.who === 'nova' && R.task(SAVE) && !SAVE.seen(NOVA_TALK)) {
      SAVE.see(NOVA_TALK);
      if (window.VOICE) VOICE.say('nova.25', true);
      retask(S.t);
    }
    panel(s);
  }
  // a spot's panel (null: closed); again: drawn anew in place (its times), no sound
  function panel(s, again) {
    const box = el.querySelector('.hpanel');
    shown = s ? s.id : '';
    box.hidden = !s;
    if (!s) return;
    paintAt = performance.now();
    const K = UI.kit,
      { T } = K,
      h =
        (s.who === 'nova' ? orders(K) : s.junk ? junk(s, K) : s.soon ? soon(K) : building(s, K)) +
        `<button class="hx2" data-close title="${T('hub.close')}" aria-label="${T('hub.close')}">${CROSS}</button>`;
    // its head: Nova's portrait under her name's tab (as the radio's box), a building's own picture beside its name, a
    // heap's gear
    const head =
      s.who === 'nova'
        ? `<div class="hhead nova"><div class="hpor"><img src="${pic('por_nova.png')}" alt="" draggable="false"></div>` +
          `<div><span class="htab">${T('voice.name.nova')}</span><h3>${T('hub.order')}</h3></div></div>`
        : s.junk
          ? `<div class="hhead"><div class="hpic gear">${GEAR}</div><h3>${T('hub.junk')}</h3></div>`
          : `<div class="hhead"><div class="hpic"><img src="${pic(spotPic(s) + '.png')}" alt="" draggable="false"></div>` +
            `<h3>${T('hub.spot.' + s.id)}</h3></div>`;
    const html = head + h;
    if (again && box.dataset.h === html) return;
    box.dataset.h = html;
    const scroll = box.scrollTop;
    box.innerHTML = html;
    box.scrollTop = scroll;
    K.on(box, '[data-close]', () => panel(null));
    K.on(box, '[data-tomap]', () => {
      GAME.quit();
      UI.campaign();
    });
    K.on(box, '[data-build]', () => act({ k: 'build', id: s.b }, s));
    K.on(box, '[data-clear]', () => act({ k: 'clear', id: s.junk }, s));
    K.on(box, '[data-walt]', () => {
      panel(null);
      if (window.MARKET) MARKET.open('walt', { tab: 'guns' });
    });
    box
      .querySelectorAll('[data-up]')
      .forEach((b) => b.addEventListener('click', () => act({ k: 'up', id: b.dataset.gun, s: b.dataset.up }, s)));
  }
  const spotPic = (s) => {
    const p = found(SIM.level(S.seed)).find((x) => x.s === s);
    return p ? p.prop.n : s.prop;
  };
  // an action at the base (rules.js act): done (a sound, the panel anew) or why not (shown in the panel)
  let why = null;
  function act(a, s) {
    const err = SAVE.act(a, { now: now() });
    why = err ? { id: s.id, err } : null;
    if (!err && window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.4);
    if (S) syncBase(S);
    retask(S ? S.t : 0);
    panel(s);
  }
  const WHY = [
    'items',
    'room',
    'busy',
    'coins',
    'power',
    'locked',
    'max',
    'mastery',
    'workbench',
    'medbay',
    'cleared',
    'offline',
  ];
  const whyHtml = (s, T) =>
    why && why.id === s.id ? `<p class="hlock">${T('hub.no.' + (WHY.includes(why.err) ? why.err : 'other'))}</p>` : '';
  // the items the base needs now (a check in their slots: the stash, Walt's window, the run's backpack): the tutorial's
  // building's while it is on, after it the next level of each building
  H.needed = () => {
    const out = new Set();
    if (!window.SAVE || !tutorialOn()) return out;
    const bt = R.task(SAVE),
      list = bt ? [E.building(bt)] : E.BUILDINGS;
    for (const B of list) {
      const L = B.levels[R.baseOf(SAVE).lv[B.id] || 0];
      if (L) for (const [id] of L.items) out.add(id);
    }
    return out;
  };
  // a time as a clock: 0:05, 1:00, 1:02:30
  function clock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60,
      p2 = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
  }
  // a length in words: 5 s, 1 min, 3 h 30 min
  function span(sec) {
    const { T } = UI.kit,
      h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60,
      out = [];
    if (h) out.push(T('hub.t.h', { n: h }));
    if (m) out.push(T('hub.t.m', { n: m }));
    if (s || !out.length) out.push(T('hub.t.s', { n: s }));
    return out.join(' ');
  }
  const soon = (K) => `<div class="hlv lock">${K.T('hub.soon')}</div>`;
  // a bar of how far a time has gone, with what is left
  const bar = (k, left, T, key) =>
    `<div class="hbar"><i style="width:${Math.round(100 * Math.max(0, Math.min(1, k)))}%"></i><span>${T(key, { t: clock(left) })}</span></div>`;
  // the items a level asks for, each with the stash's count and a check once there are enough (needs: [[id, n], …])
  function needs(list, K, first = '') {
    const { T, fmtN } = K;
    let h = '<div class="hneed">' + first;
    for (const [id, n] of list) {
      const have = (SAVE.items || {})[id] || 0,
        ok = have >= n,
        name = T('item.' + id);
      h +=
        `<span class="hn${ok ? ' ok' : ' short'}" title="${name}">${ok ? `<i class="hck">${CHECK}</i>` : ''}` +
        `<img src="${pic('it_' + id + '.png')}" alt="" draggable="false">` +
        `<b>${fmtN(Math.min(have, n))}/${fmtN(n)}</b><small>${name}</small></span>`;
    }
    return h + '</div>';
  }
  // where the parts come from: Walt's shelf, and the suburb's first boss once while the tutorial's gift is due
  function partsHint(b, K) {
    const { T } = K,
      g = R.gift(SAVE);
    let h = `<p class="hgive hsm">${T('hub.partsWalt')}`;
    if (g && g.id === b) h += ` <em class="gift">${T('hub.partsGift')}</em>`;
    h += '</p>';
    return h;
  }
  // Nova: the base's task while the tutorial is on (the building, its parts), then her order: the current mission's goal
  // (rules.js current; the campaign map plays it)
  function orders(K) {
    const { T } = K,
      bt = R.task(SAVE),
      id = R.current(SAVE),
      m = id ? E.mission(id) : null;
    let h = '';
    if (bt) {
      const L = E.building(bt).levels[0];
      h += `<h4>${T('hub.taskOf', { b: T('hub.spot.' + bt) })}</h4><p class="hgive hsm">${T('hub.why')}</p>`;
      h += needs(L.items, K) + partsHint(bt, K);
    } else if (tutorialOn() && standing('medbay')) h += `<p class="hgive">${T('hub.yours')}</p>`;
    if (!m) return h + `<p class="hgive">${T('hub.noOrder')}</p>`;
    // (the tutorial on: the mission in a line, its map a tap away — the suburb's raid brings the parts too)
    if (bt)
      return (
        h +
        `<div class="hmis"><h4>${m.n} · ${T('mission.' + m.id + '.name')}</h4>` +
        `<button class="btn orange" data-tomap>${T('hub.map')}</button></div>`
      );
    return (
      h +
      `<h4>${m.n} · ${T('mission.' + m.id + '.name')}</h4>` +
      `<p class="hgive">${T('mission.' + m.id + '.goal')}</p>` +
      `<button class="btn orange" data-tomap>${T('hub.map')}</button>`
    );
  }
  // a heap of junk: its clearing (free, CLEAR_TIME), going on, or another one going on first
  function junk(s, K) {
    const { T } = K,
      t = now(),
      b = R.baseOf(SAVE),
      cl = R.clearing(SAVE, t);
    let h = `<p class="hgive">${T('hub.junkWhy')}</p>`;
    if (cl === s.junk)
      return h + bar(1 - (b.clr[s.junk] - t) / (1000 * runningClear()), (b.clr[s.junk] - t) / 1000, T, 'hub.clearingT');
    h += `<div class="hlv">${T('hub.clearTakes', { t: span(R.clearTime(SAVE)) })}</div>`;
    if (cl)
      return (
        h +
        `<p class="hlock">${T('hub.no.busy')}</p>` +
        `<button class="btn orange" disabled>${GEAR}${T('hub.clear')}</button>`
      );
    return (
      h + whyHtml(s, T) + `<button class="btn orange hgo" data-clear>${GEAR}<span>${T('hub.clear')}</span></button>`
    );
  }
  // a building: what it gives, its level, going up (its bar), what the next level needs (items with the stash's counts,
  // coins, the generator's level, its room, a trophy lock) and Build; the workbench standing: the guns' upgrades
  function building(s, K) {
    const { T, fmtN, coin } = K,
      t = now(),
      B = E.building(s.b),
      base = R.baseOf(SAVE),
      paid = base.lv[s.b] || 0,
      lvl = R.blv(SAVE, s.b, t),
      next = B.levels[paid],
      lock = lockedBy(B);
    let h = `<p class="hgive">${T('hub.gives.' + s.id)}</p>`;
    if (paid > lvl) {
      const dur = 1000 * E.BUILD_TIME[Math.min(paid - 1, E.BUILD_TIME.length - 1)];
      return h + bar(1 - (base.bt[s.b] - t) / dur, (base.bt[s.b] - t) / 1000, T, 'hub.buildingT');
    }
    h += `<div class="hlv">${lvl ? T('hub.level', { n: lvl, m: B.levels.length }) : T('hub.none')}</div>`;
    const tut = paid === 0 && R.TASKS.includes(s.b); // (the tutorial's level 1: its parts, no heading)
    if (s.b === 'workbench' && lvl >= 1) h += guns(K);
    if (s.b === 'medbay' && lvl >= 1) h += `<p class="hgive">${T('hub.metaOpen')}</p>`;
    if (!next) return h + `<div class="hlv">${T('hub.top')}</div>`;
    if (!tut) h += `<h4>${T('hub.needs')}</h4>`;
    const short = SAVE.coins < next.coins;
    // (the coins first in the same row as the items)
    h += needs(
      next.items,
      K,
      next.coins ? `<span class="hn${short ? ' short' : ''}">${coin()}<b>${fmtN(next.coins)}</b></span>` : '',
    );
    if (next.power)
      h += `<div class="hneed"><span class="hn pw${R.blv(SAVE, 'generator', t) >= next.power ? ' ok' : ' short'}">${BOLT}<small>${T('hub.power', { n: next.power })}</small></span></div>`;
    const room = E.ROOM[s.b];
    if (room && !R.cleared(SAVE, room, t)) h += `<p class="hlock">${T('hub.no.room')}</p>`;
    if (lock) h += `<p class="hlock">${T('hub.lockedBy', { item: T('item.' + lock) })}</p>`;
    if (tut) h += partsHint(s.b, K);
    const can =
      !lock &&
      !short &&
      (!room || R.cleared(SAVE, room, t)) &&
      R.blv(SAVE, 'generator', t) >= (next.power || 0) &&
      next.items.every(([id, n]) => ((SAVE.items || {})[id] || 0) >= n);
    return (
      h +
      whyHtml(s, T) +
      `<button class="btn orange hgo" data-build ${can ? '' : 'disabled'}>${T('hub.build')} · ${span(E.BUILD_TIME[Math.min(paid, E.BUILD_TIME.length - 1)])}</button>`
    );
  }
  // the workbench: each gun owned with its three upgrades (rules.js up: the coins, its mastery) and Walt for new ones
  function guns(K) {
    const { T, fmtN, coin } = K,
      W = DATA.WEAPON_UP;
    let h = `<h4>${T('hub.gunUps')}</h4><div class="hguns">`;
    for (const id of DATA.MAIN_ORDER) {
      if (!SAVE.owned[id] || !R.usable(id)) continue;
      const u = SAVE.wupOf(id),
        mast = R.mastery(SAVE, id);
      h += `<div class="hgun"><img src="${pic('i_' + id + '.png')}" alt="" draggable="false"><b>${DATA.MAIN[id].name}</b><div class="hups">`;
      for (const k of Object.keys(W)) {
        const lv = u[k] || 0,
          P = W[k].price[lv],
          dis = P === undefined || lv >= mast || SAVE.coins < P;
        h +=
          `<button class="hup" data-gun="${id}" data-up="${k}" ${dis ? 'disabled' : ''} title="${W[k].name}">` +
          `<small>${W[k].name}</small><em>${lv}/${W[k].price.length}</em>` +
          (P === undefined
            ? `<span>${T('common.max')}</span>`
            : lv >= mast
              ? `<span>${T('arsenal.mastNeed', { l: lv + 1 })}</span>`
              : `<span>${coin()}${fmtN(P)}</span>`) +
          '</button>';
      }
      h += '</div></div>';
    }
    return h + `</div><button class="btn hwalt" data-walt>${T('hub.gunsAtWalt')}</button>`;
  }
})();
