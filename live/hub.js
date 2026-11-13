// live/hub.js — NEAR Base between runs (docs/design.md, "Hub base"): Copper walks the office's inside (the sim's walking
// mode on SIM.BASE, index.html GAME.hub) and walks up to its buildings, its heaps of old junk, Walt and Nova. By one of them
// its name lights up and a prompt asks for E (a tap on touch); that opens its panel: a building's level, what its next
// level needs (economy.js BUILDINGS: items, coins) and Build; a heap's clearing; Nova's orders. Walt opens his trade window
// and the stash's lockers the stash (market.js); so do the stash's button in the corner and I, wherever the hero stands.
// The scene draws the names over the furniture and the goal's arrow (scene.js hubHud, from spots() and goal()), the
// buildings faint until they stand and the junk gone once cleared (S.base: sim.js HUB_BUILD, HUB_JUNK); the page draws the
// rest: the task's tracker by the right edge with every step of the tutorial's chapter, the banners of a new goal and of a
// step done across the top, a spot's window on the right (one screen, never a scroll).
// Nova's base tutorial (the human's, 2026-11-11), each step the base's goal with its arrow, kept in the save (rules.js base)
// but for the lines already heard (SAVE.seen):
//   walk up to Walt (walt.1 as Copper comes in) → talk to him: his window teaches the sale of the cleaver (market.js lesson,
//   walt.2, walt.3) → talk to Nova (nova.25: upgrades need the generator, the workbench and the medbay) → build the
//   generator (its parts from Walt or the suburb's first boss, once: rules.js gift; 5 s; nova.26) → clear the alcove's junk
//   (5 s; nova.27) → build the workbench (nova.28: guns from Walt, upgrades here) → clear the glass room (1 min) and, while it
//   goes, buy a gun from Walt (nova.34) and upgrade it here (nova.35) — both stay tasks past the medbay until done → the
//   room clear (nova.29), mission 2 given over the radio (nova.14; the suburbs first when the medbay's parts are short,
//   nova.33) → build the medbay (nova.30: "the rest is yours") → the Mushroom Monster. After it every heap of junk has its
//   gear, each clearing longer than the last (economy.js CLEAR_TIME).
(function () {
  const H = (window.HUB = {}),
    E = window.ECONOMY,
    R = window.RULES;
  // every spot and how it is found in the base's level: a building's furniture (sim.js HUB_BUILD, bspot: its id), a
  // person or a building not placed yet by a prop's name (Walt and Nova from sim.js HUB_NPC), a heap of junk by its first
  // prop (sim.js HUB_JUNK). b: its building (economy.js), who: a person, junk: a heap's id, soon: shown, not open yet;
  // post: the furniture a person sits at (the nearest one so named): the hero talks to them from its edge, at the desk
  const SPOTS = [
    { id: 'generator', b: 'generator', bspot: 1 },
    { id: 'workbench', b: 'workbench', bspot: 1 },
    { id: 'medbay', b: 'medbay', bspot: 1 },
    { id: 'stash', prop: 'lb_lockers', b: 'stash' },
    { id: 'range', prop: 'lb_target', b: 'range' },
    { id: 'walt', prop: 'np_walt', who: 'walt', post: 'm1_in_waltshop' },
    { id: 'nova', prop: 'np_nova', who: 'nova', post: 'm1_in_novapost' },
    { id: 'kitchen', prop: 'm1_rm_kit', soon: 1, after: 'storage' }, // (after: there once that heap of junk is cleared)
    { id: 'server', prop: 'lb_servers', soon: 1 },
  ].concat(E.JUNK.map((j) => ({ id: 'j_' + j, junk: j })));
  const REACH = 130; // ground units from the hero to a piece of furniture's footprint: near enough to use it
  const KEY_ICO = 'E',
    WAL_ICO =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="3.5" y="7.5" width="17.5" height="12" rx="2.5"/><path d="M21 11.5h-4a2 2 0 0 0 0 4h4z"/></svg>',
    INV_ICO =
      '<svg viewBox="0 0 24 24"><path d="M3 8.5L12 4l9 4.5v8L12 21l-9-4.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M3 8.5l9 4.5 9-4.5M12 13v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    BOLT =
      '<svg viewBox="0 0 24 24"><path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6z" fill="currentColor" stroke="#000" stroke-width="1" stroke-linejoin="round"/></svg>',
    CHECK =
      '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    CROSS =
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
    CLOCK =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/></svg>',
    MINUS =
      '<svg viewBox="0 0 24 24"><path d="M6 12h12" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>',
    PLUS =
      '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>',
    CART =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h3l2.4 11h10.6l2-7.5H7"/><circle cx="9.5" cy="19.5" r="1.6" fill="currentColor"/><circle cx="17" cy="19.5" r="1.6" fill="currentColor"/></svg>',
    LOCK =
      '<svg viewBox="0 0 24 24"><rect x="4.5" y="10" width="15" height="11" rx="2.5" fill="currentColor"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
    STAR =
      '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.3L21 9l-5 4.4 1.6 6.6L12 16.6 6.4 20l1.6-6.6L3 9l6.6-.7z" fill="currentColor"/></svg>',
    ARROW =
      '<svg viewBox="0 0 24 24"><path d="M5 12h12M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    GEAR =
      '<svg viewBox="0 0 24 24"><path d="M10.3 2h3.4l.5 2.6 1.7.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.7 2.6.5v3.4l-2.6.5-.7 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.7-.5 2.6h-3.4l-.5-2.6-1.7-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.7L2 13.7v-3.4l2.6-.5.7-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.7-.7z" fill="currentColor"/><circle cx="12" cy="12" r="3.4" fill="#1b2130"/></svg>';
  const pic = (file) => `assets/${file}?v=${window.__V || 0}`;
  const now = () => Date.now();
  const NPC_H = { np_nova: 160, np_walt: 148 }; // (the people's height on screen: their models, scene.js NPC3D × BASE_K)

  let el = null,
    S = null,
    near = null,
    shown = '',
    loop = 0,
    lvCache = null,
    task = null,
    taskAt = 0,
    paintAt = 0,
    clicked = null; // (a panel opened by a click from afar: where the hero stood, it stays open till he walks off from there)
  // the lines the tutorial says once (SAVE.seen) and what they are about
  const FIRST = 'walt.task', // (Copper has stood by Walt)
    SOLD = 'walt.sold', // (the first sale: market.js)
    NOVA_TALK = 'bt.nova', // (Nova's talk on the base's buildings, nova.25)
    SUBURB_LINE = 'bt.suburb', // (Nova sending Copper to the suburbs for the medbay's parts, nova.33)
    GUN_LINE = 'bt.gun', // (Nova sending Copper to Walt for a gun as the glass room is being cleared, nova.34)
    UPGUN_LINE = 'bt.upgun', // (a gun bought: Nova sends him with it to the workbench, nova.35)
    MIS_LINE = 'bt.mis.suburb', // (mission 2 given over the radio once the glass room is clear, nova.14: voice.js BASE_SAID)
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
  // a gun Walt has for Copper now (his rank, not his yet; with `pay`, the coins for it too) / bought one besides the
  // pistol already
  const gunToBuy = (pay = true) =>
    DATA.MAIN_ORDER.some(
      (id) =>
        R.usable(id) &&
        !SAVE.owned[id] &&
        DATA.MAIN[id].rank <= R.rank(SAVE) &&
        (!pay || DATA.MAIN[id].price <= SAVE.coins),
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
  // a building's first level's parts not all in the stash
  const partsShort = (id) => E.building(id).levels[0].items.some(([i, n]) => ((SAVE.items || {})[i] || 0) < n);
  // the gun from Walt and its upgrade at the workbench: from the glass room's clearing on (the medbay's turn) and past
  // the tutorial, until both are done (2026-11-12: a medbay built before a gun was bought used to drop
  // the gun's task). The gun is the goal while the room is being cleared (Copper waits anyway), else when he has the coins for one;
  // the upgrade when he has the coins for it. null: neither now
  const gunTime = (bt, t) => {
    const room = E.ROOM.medbay;
    return !bt || (bt === 'medbay' && (R.clearing(SAVE, t) === room || R.cleared(SAVE, room, t)));
  };
  function gunGoal(bt, t) {
    if (!gunTime(bt, t)) return null;
    if (!hasGun() && (gunToBuy() || (R.clearing(SAVE, t) === E.ROOM.medbay && gunToBuy(false))))
      return { id: 'gun', key: 'task.gun', who: 'walt' };
    if (!upgraded() && upToBuy()) return { id: 'upgun', key: 'task.upgun', spot: 'workbench' };
    return null;
  }
  // mission 2 is the next one: Nova gives it over the radio once the glass room is clear (2026-11-12), nova.14
  const misDue = () => R.current(SAVE) === 'suburb';
  const misGiven = () => misDue() && SAVE.seen(MIS_LINE);
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
    const gun = gunGoal(bt, t);
    if (bt) {
      const room = E.ROOM[bt],
        clearing = R.clearing(SAVE, t);
      if (room && !R.cleared(SAVE, room, t) && clearing !== room)
        return { id: 'clear:' + room, key: 'task.clear.' + bt, spot: 'j_' + room, busy: !!clearing };
      // (the medbay's room clearing for a minute: meanwhile a gun from Walt and its upgrade at the workbench)
      if (gun) return gun;
      if (clearing === room) return { id: 'clearing:' + room, key: 'task.clearing', spot: 'j_' + room };
      // (the medbay's parts not in the stash: Nova sends Copper to the suburbs — the human's, 2026-11-12: out of coins for
      // Walt's, nobody said where to go next; their first boss drops them too, rules.js gift — on mission 2 while it is
      // the next one)
      if (bt === 'medbay' && partsShort(bt)) return { id: 'suburb', key: misDue() ? 'task.mis.suburb' : 'task.suburb' };
      return { id: 'build:' + bt, key: 'task.build.' + bt, spot: bt };
    }
    if (gun) return gun;
    if (misGiven()) return { id: 'mis:suburb', key: 'task.mis.suburb' };
    if (R.current(SAVE)) return { id: 'next', key: 'task.next', who: 'nova' };
    return null;
  }
  // the base's goal is a gun from Walt (market.js lights his guns' tab, then the guns Copper can buy)
  H.gunDue = () => {
    const g = goalNow();
    return !!g && g.id === 'gun';
  };
  // ---------- the base's HUD: the task's tracker, its banners (2026-11-12) ----------
  const T = (k, v) => I18N.t(k, v);
  // (each frame reads the save at most every 300 ms; a new goal gets its banner, the tracker is drawn anew)
  function retask(t, nowMs) {
    if (nowMs !== undefined && nowMs - taskAt < 300) return;
    taskAt = nowMs || 0;
    // (mission 2 given once the glass room is clear: marked before the goal is read, so the goal turns to it at once;
    // said after her lines on the room and on the suburbs' supplies)
    const give = tutorialOn() && misDue() && R.cleared(SAVE, E.ROOM.medbay, now()) && !SAVE.seen(MIS_LINE);
    if (give) SAVE.see(MIS_LINE);
    const g = goalNow(),
      was = task;
    if (!g) task = null;
    else if (!task || task.id !== g.id) task = { ...g, t0: t };
    else task.key = g.key;
    doneLines();
    miles();
    // (a goal that is a wait — a building going up, a heap being cleared — has its clock in the tracker, no banner)
    if (task && (!was || was.id !== task.id) && !/^(going|clearing):/.test(task.id))
      banner('goal', T(task.key), was ? 'hub.newGoal' : 'task.goal');
    // (a gun from Walt while the glass room is being cleared: Nova says so once — her words are about that minute)
    if (task && task.id === 'gun' && !SAVE.seen(GUN_LINE) && R.clearing(SAVE, now()) === E.ROOM.medbay) {
      SAVE.see(GUN_LINE);
      if (window.VOICE) VOICE.say('nova.34', true);
    }
    // (the suburbs: Nova says so once, after her glass room line when they come together; the map's button glows)
    const sub = !!task && (task.id === 'suburb' || task.id === 'mis:suburb');
    if (task && task.id === 'suburb' && !SAVE.seen(SUBURB_LINE)) {
      SAVE.see(SUBURB_LINE);
      if (window.VOICE) VOICE.say('nova.33', true);
    }
    if (give && window.VOICE) VOICE.say('nova.14', true);
    const mb = el && el.querySelector('[data-map]');
    if (mb && mb.classList.contains('due') !== sub) mb.classList.toggle('due', sub);
    tracker();
  }
  // the tutorial's milestones: one turning done while Copper is at the base gets its banner ("Generator built"); the
  // first look after the base opens only takes them in
  const MILES = [
    ['sold', () => (SAVE.held || []).includes('t_butcher')],
    ['gen', () => standing('generator')],
    ['alcove', () => R.cleared(SAVE, 'alcove', now())],
    ['wb', () => standing('workbench')],
    ['gun', () => hasGun()],
    ['upgun', () => upgraded()],
    ['meeting', () => R.cleared(SAVE, 'meeting', now())],
    ['med', () => standing('medbay')],
  ];
  let mile = null;
  function miles() {
    if (!tutorialOn()) return;
    const cur = MILES.map(([, f]) => f());
    // (once the medbay stands, only the gun's and its upgrade's: those go on past the tutorial)
    if (mile)
      MILES.forEach(([k], i) => {
        if (!cur[i] || mile[i] || (mile[MILES.length - 1] && k !== 'gun' && k !== 'upgun')) return;
        banner('done', T('hub.done.' + k));
        // (a gun bought, none upgraded yet: Nova sends Copper with it to the workbench, once)
        if (k === 'gun' && !upgraded() && standing('workbench') && !SAVE.seen(UPGUN_LINE)) {
          SAVE.see(UPGUN_LINE);
          if (window.VOICE) VOICE.say('nova.35', true);
        }
      });
    mile = cur;
  }
  // The banners across the top: "New goal" with the goal (orange), "Done" with what was done (green), one at a time, each
  // with its chime; while Walt's window (or another) is up they wait for it to close
  let banQ = [],
    banOn = null,
    banTimer = 0;
  function banner(kind, text, kick) {
    if (banQ.some((b) => b.text === text) || (banOn && banOn.text === text)) return;
    if (kind === 'goal') banQ = banQ.filter((b) => b.kind !== 'goal'); // (only the newest goal)
    banQ.push({ kind, text, kick: kick || (kind === 'done' ? 'hub.goalDone' : 'hub.newGoal') });
    pump();
  }
  function pump() {
    if (!el || banOn || !banQ.length || (window.MARKET && MARKET.isOpen()) || window.__modal) return;
    const b = banQ.shift(),
      box = el.querySelector('.qban');
    banOn = b;
    box.innerHTML =
      `<div class="qb ${b.kind}"><i class="qb-line"></i><small>${b.kind === 'done' ? CHECK : ''}${T(b.kick)}</small>` +
      `<b>${b.text}</b><i class="qb-line"></i></div>`;
    box.hidden = false;
    if (window.AUDIO && AUDIO.chime) AUDIO.chime(b.kind === 'done' ? 'done' : 'new');
    const qt = el.querySelector('.qt');
    if (qt && b.kind === 'goal') {
      qt.classList.remove('ping');
      void qt.offsetWidth;
      qt.classList.add('ping'); // (the tracker's new line flashes)
    }
    banTimer = setTimeout(
      () => {
        if (!el) return;
        box.hidden = true;
        box.innerHTML = '';
        banOn = null;
        pump();
      },
      b.kind === 'done' ? 2100 : 2900,
    );
  }
  // The tracker by the right edge, under the coins (2026-11-11: it folds into a
  // square on the right and opens by the trader too): the tutorial's chapter now — its picture, its name — and its steps
  // in order: done (a green check), the one to do now (orange), one waited on (its clock), the rest; the parts' step
  // lists each part with the stash's count. Folded: a square with the picture and the steps done. Hidden while a base
  // window or Walt's is up (they show the same)
  const TK_KEY = 'md.taskOpen';
  let tkOpen = (() => {
    try {
      return localStorage.getItem(TK_KEY) !== '0';
    } catch (e) {
      return true;
    }
  })();
  // the chapter: { pic, por (a face), title, steps: [{ key, done, left (s, waited on), items ([[id, n]]: the parts) }] }
  function quest() {
    if (!tutorialOn()) return null;
    const t = now(),
      b = R.baseOf(SAVE);
    if (!SAVE.seen(FIRST) || H.sellDue())
      return {
        pic: pic('por_walt.png'),
        por: 1,
        title: T('hub.q.trade'),
        steps: [
          { key: 'task.walt', done: SAVE.seen(FIRST) },
          { key: 'task.sell', done: !H.sellDue() },
        ],
      };
    // (a building going up is still its chapter: rules.js task has moved on to the next one)
    const id = R.TASKS.find((x) => b.lv[x] >= 1 && R.blv(SAVE, x, t) < 1) || R.task(SAVE);
    // (the gun from Walt and its upgrade: the medbay's chapter and every one after it until both are done)
    const gunSteps = () =>
      hasGun() && upgraded()
        ? []
        : (hasGun() || gunToBuy(false) ? [{ key: 'task.gun', done: hasGun() }] : []).concat([
            { key: 'task.upgun', done: upgraded() },
          ]);
    if (!id) {
      const mid = R.current(SAVE),
        m = mid ? E.mission(mid) : null;
      return m
        ? {
            pic: pic('por_nova.png'),
            por: 1,
            title: `${m.n} · ${T('mission.' + m.id + '.name')}`,
            steps: gunSteps().concat([{ key: misGiven() ? 'task.mis.suburb' : 'task.next', done: false }]),
          }
        : null;
    }
    const L = E.building(id).levels[0],
      paid = (b.lv[id] || 0) >= 1,
      room = E.ROOM[id],
      cl = R.clearing(SAVE, t),
      have = (i) => (SAVE.items || {})[i] || 0,
      steps = [];
    if (id === 'generator') steps.push({ key: 'task.nova', done: SAVE.seen(NOVA_TALK) });
    if (room)
      steps.push({
        key: 'task.clear.' + id,
        done: paid || R.cleared(SAVE, room, t),
        left: cl === room ? (b.clr[room] - t) / 1000 : 0,
      });
    // (the suburbs for the medbay's parts: mission 2 while it is the next one, once Nova has given it — before the parts
    // while they are short, the way to them; after the medbay when they are in, the next thing)
    const mis = misDue()
        ? { key: 'task.mis.suburb', done: false }
        : { key: 'task.suburb', done: paid || !partsShort(id) },
      short = !paid && partsShort(id);
    if (id === 'medbay') {
      steps.push(...gunSteps());
      if (!misDue() || (short && misGiven())) steps.push(mis);
    }
    steps.push({ key: 'hub.q.parts', done: paid || L.items.every(([i, n]) => have(i) >= n), items: L.items });
    steps.push({ key: 'task.build.' + id, done: R.blv(SAVE, id, t) >= 1, left: paid ? (b.bt[id] - t) / 1000 : 0 });
    if (id === 'medbay' && !short && misGiven()) steps.push(mis);
    return { pic: pic(HUB_BUILD_PIC[id] + '.png'), title: T('hub.spot.' + id), steps, b: id };
  }
  H.quest = quest;
  function tracker() {
    const box = el && el.querySelector('.qt');
    if (!box) return;
    const q = quest();
    if (!q) {
      box.hidden = true;
      return;
    }
    // the step to do now: the base's goal when it is one of them (a gun with no coins for it waits behind the suburbs);
    // else the first not done that isn't a wait; all left are waits: the first of them
    let cur = task ? q.steps.findIndex((s) => !s.done && s.key === task.key) : -1;
    if (cur < 0) cur = q.steps.findIndex((s) => !s.done && !(s.left > 0));
    if (cur < 0) cur = q.steps.findIndex((s) => !s.done);
    const nDone = q.steps.filter((s) => s.done).length,
      face = `<img class="qt-pic${q.por ? ' por' : ''}" src="${q.pic}" alt="" draggable="false">`;
    let h;
    if (!tkOpen)
      h =
        `<button class="qt-sq${nDone >= q.steps.length ? ' ok' : ''}" data-tk title="${T('hub.taskTab')}: ${q.title}">` +
        `${face}<b>${nDone}/${q.steps.length}</b></button>`;
    else {
      h =
        `<div class="qt-card"><button class="qt-h" data-tk title="${T('hub.taskFold')}">${face}` +
        `<span><small>${T('hub.taskTab')}</small><b>${q.title}</b></span><i class="qt-fold">${MINUS}</i></button><ol>`;
      q.steps.forEach((s, i) => {
        const st = s.done ? 'done' : i === cur ? 'cur' : s.left > 0 ? 'wait' : '';
        h +=
          `<li class="${st}"><i class="qt-m">${s.done ? CHECK : s.left > 0 ? CLOCK : ''}</i><span>${T(s.key)}</span>` +
          (s.left > 0 ? `<em>${clock(s.left)}</em>` : '');
        if (s.items && !s.done) {
          h += '<ul>';
          for (const [id, n] of s.items) {
            const have = (SAVE.items || {})[id] || 0;
            h +=
              `<li class="${have >= n ? 'ok' : ''}"><img src="${pic('it_' + id + '.png')}" alt="" draggable="false">` +
              `<span>${T('item.' + id)}</span><b>${Math.min(have, n)}/${n}</b></li>`;
          }
          h += '</ul>';
          if (i === cur) {
            const g = R.gift(SAVE);
            h += `<p class="qt-tip">${T('hub.partsWalt')}</p>`;
            if (g && g.id === q.b) h += `<p class="qt-tip gift">${STAR}${T('hub.partsGift')}</p>`;
          }
        }
        h += '</li>';
      });
      h += '</ol></div>';
    }
    if (box.dataset.h !== h) {
      box.dataset.h = h;
      box.innerHTML = h;
    }
    box.hidden = false;
  }
  // (each building's picture: the bunker's furniture it had — the base's map marks a building by an unseen spot now,
  // sim.js HUB_BUILD hb_spot, until its own pictures are drawn)
  const HUB_BUILD_PIC = { generator: 'lb_generator', workbench: 'lb_workbench', medbay: 'lb_stretcher' };
  // (every building's, for Walt's window: its task strip, market.js)
  H.BPIC = { ...HUB_BUILD_PIC, stash: 'lb_lockers', range: 'lb_target' };
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
    // a building not up yet whose spot is open: its room drawn faint where it goes (scene.js)
    B.g = {};
    for (const s of SPOTS) if (s.bspot && !B.b[s.b] && shownSpot(s)) B.g[s.b] = 1;
    const cl = R.clearing(SAVE, t);
    if (cl) B.c[cl] = Math.max(0, Math.min(1, 1 - (b.clr[cl] - t) / (1000 * runningClear())));
  }
  // the length of the clearing going on now (s): the last one started (one at a time), the n-th of the base's
  const runningClear = () => {
    const n = Object.keys(R.baseOf(SAVE).clr).length;
    return E.CLEAR_TIME[Math.max(0, Math.min(n - 1, E.CLEAR_TIME.length - 1))];
  };
  // the spots found in the level (cached per level: the editor rebuilds it)
  const dist2 = (a, b) => (a.gx - b.gx) ** 2 + (a.gy - b.gy) ** 2;
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
      if (!prop) continue;
      let post = null;
      if (s.post)
        for (const o of LV.props)
          if (o.n === s.post && (!post || dist2(o, prop) < dist2(post, prop)) && dist2(o, prop) < 400 * 400) post = o;
      list.push({ s, prop, post });
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
  // a building whose room is still the old office's junk (economy.js ROOM) isn't there to open until the room is cleared (the
  // human's, 2026-11-12: the medbay's spot opened over the glass room's junk, so its gear couldn't be reached)
  const roomFree = (s) =>
    !s.b || !E.ROOM[s.b] || R.cleared(SAVE, E.ROOM[s.b], now()) || (R.baseOf(SAVE).lv[s.b] || 0) >= 1;
  const shownSpot = (s) => (s.junk ? junkShown(s.junk) : s.after ? R.cleared(SAVE, s.after, now()) : roomFree(s));
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
    const t = now(),
      b = R.baseOf(SAVE);
    if (s.junk) {
      const left = R.clearing(SAVE, t) === s.junk ? (b.clr[s.junk] - t) / 1000 : 0;
      return left > 0 ? T('hub.clearingT', { t: clock(left) }) : T('hub.junk');
    }
    // (a building standing: its level in its name, "Medbay Lv. 1": one picture for every level, the human's, 2026-11-12)
    const lv = s.b ? R.blv(SAVE, s.b, t) : 0,
      nm = lv >= 1 ? T('hub.lvName', { name: T('hub.spot.' + s.id), n: lv }) : T('hub.spot.' + s.id);
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
      .map(({ s, prop, post }) => ({
        id: s.id,
        prop,
        post,
        near: by === s,
        lock: isLocked(s),
        name: spotName(s),
        gear: !!s.junk,
      }));
  };
  // the goal for the scene: the arrow over the head of whom or what it is about (bare: no plaque — the tracker and the
  // banners say it at the base), or null
  H.goal = (st) => {
    if (!task || !st || !st.hub) return null;
    const w = found(SIM.level(st.seed)).find(({ s }) => (task.who ? s.id === task.who : s.id === task.spot));
    if (!w) return null;
    const o = w.prop,
      A = window.ASSETS && ASSETS[o.n],
      h = NPC_H[o.n] || (o.room ? 150 : A ? (o.w * A.h) / A.w : 140); // (a room drawn whole: over its floor's middle)
    return { key: task.key, k: 'reach', at: [o.x, o.y], lift: h * 0.78 + 56, y: 0, t0: task.t0, bare: true };
  };
  // the spot the hero stands by (the nearest within REACH of its footprint, of those shown), or null. In a room drawn whole
  // (sim.js HUB_ROOM: its floor's box, its building up or not) only what is in that room (the human's, 2026-11-12: in the
  // medbay by its back wall the generator behind it was offered)
  const boxOf = (o) => ({ x0: o.gx - o.fw / 2, x1: o.gx + o.fw / 2, y0: o.gy - o.fh / 2, y1: o.gy + o.fh / 2 });
  const meets = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  function nearest(st, LV) {
    const gx = SIM.toGx(st.p.x, st.p.y),
      gy = SIM.toGy(st.p.x, st.p.y),
      rm = LV.props.find(
        (o) => o.room && o.fw && (({ x0, x1, y0, y1 }) => gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1)(boxOf(o)),
      ),
      rb = rm && boxOf(rm);
    let best = null,
      bd = REACH;
    const off = (o) =>
      Math.hypot(
        Math.max(o.gx - o.fw / 2 - gx, 0, gx - o.gx - o.fw / 2),
        Math.max(o.gy - o.fh / 2 - gy, 0, gy - o.gy - o.fh / 2),
      );
    for (const { s, prop: o, post } of found(LV)) {
      if (!shownSpot(s)) continue;
      if (rb && !meets(boxOf(o), rb)) continue;
      const d = post ? Math.min(off(o), off(post)) : off(o);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // The base's page over the scene: top left the ways out (the map, the lobby) and the sound; top right the stash and the
  // coins; under them the task's tracker; across the top its banners; at the bottom the prompt by a spot; a spot's window
  // on the right
  H.open = (st) => {
    H.close();
    S = st;
    const K = UI.kit;
    el = document.createElement('div');
    el.id = 'hub';
    el.innerHTML = `<div class="pg">
      <div class="htl"><button class="lbp back" data-map><span class="ic">${K.HICO.back}</span>${T('hub.map')}</button>
        <button class="lbp hhome" data-lobby title="${T('common.toLobby')}" aria-label="${T('common.toLobby')}">
          <span class="ic">${K.ICO.lobby}</span></button>
        <button class="lbp hsnd" data-snd title="${T('settings.sound')} (M)" aria-label="${T('settings.sound')}">
          <span class="ic"></span></button></div>
      <div class="htr">
        <button class="lbp hwal" data-wal title="${T('wallet.title')}" aria-label="${T('market.offer.connect')}" hidden>
          <span class="ic">${WAL_ICO}</span></button>
        <button class="lbp hinv" data-inv title="${T('market.stash')}" aria-label="${T('market.stash')}">
          <span class="ic">${INV_ICO}</span><span>${T('market.stash')}</span><kbd>I</kbd></button>
        <div class="lbp hcoin">${K.coin()}<span>${K.fmtN(SAVE.coins)}</span></div></div>
      <div class="qt" hidden></div>
      <div class="qban" hidden></div>
      <button class="lbp hask" data-use hidden><kbd>${KEY_ICO}</kbd><b></b><span></span></button>
      <div class="hwin" hidden></div></div>`;
    document.getElementById('ui').appendChild(el);
    K.on(el, '[data-map]', () => {
      GAME.quit();
      UI.campaign();
    });
    K.on(el, '[data-lobby]', () => GAME.quit());
    K.on(el, '[data-use]', () => use());
    K.on(el, '[data-inv]', () => window.MARKET && MARKET.open('stash'));
    // the wallet (2026-11-12: a connect button up top, just the wallet's icon): its card —
    // connect or create, as Nova's offer and the lobby's; there while no wallet is connected
    K.on(el, '[data-wal]', () => {
      if (!window.WALLET) return;
      if (WALLET.state === 'connecting') WALLET.connect();
      else if (window.MARKET && MARKET.wallet) MARKET.wallet();
    });
    // the tracker: a tap folds it into its square or opens it (kept for this browser)
    el.querySelector('.qt').addEventListener('click', (e) => {
      if (!e.target.closest('[data-tk]')) return;
      e.stopPropagation();
      tkOpen = !tkOpen;
      try {
        localStorage.setItem(TK_KEY, tkOpen ? '1' : '0');
      } catch (er) {}
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.25);
      tracker();
    });
    K.on(el, '[data-snd]', () => {
      if (window.AUDIO) AUDIO.toggle();
      sound();
    });
    sound();
    addEventListener('keydown', onKey, true);
    cv().addEventListener('pointerdown', onClick);
    cv().addEventListener('pointermove', onHover);
    addEventListener('pointerup', onTapUp);
    task = mile = null;
    syncBase(st);
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
    clearTimeout(banTimer);
    removeEventListener('keydown', onKey, true);
    cv().removeEventListener('pointerdown', onClick);
    cv().removeEventListener('pointermove', onHover);
    removeEventListener('pointerup', onTapUp);
    tap = null;
    cv().style.cursor = '';
    if (window.MARKET) MARKET.close(true);
    el.remove();
    el = S = near = task = mile = banOn = null;
    banQ = [];
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
  // E uses the spot the hero is by (or closes its window); Esc closes a window. The game's own keys stay as they are
  function onKey(e) {
    if (!el || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.MARKET && MARKET.isOpen()) return; // (its own keys)
    if (window.__modal) return; // (another window over the base: the wallet's)
    if (e.code === 'KeyI') {
      e.preventDefault();
      win(null);
      if (window.MARKET) MARKET.open('stash');
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      clicked = null;
      if (shown) win(null);
      else use();
    } else if (e.code === 'Escape' && shown) {
      e.stopPropagation();
      win(null);
    }
  }
  // each frame: the base as the save has it, which spot the hero is by, the prompt for it; a window left open closes when
  // the hero walks off, and one with a time on it is drawn anew each quarter second
  function frame() {
    const st = GAME.play;
    if (!st || !st.hub) return;
    S = st;
    syncBase(st);
    const purse = el.querySelector('.hcoin span'),
      coins = UI.kit.fmtN(SAVE.coins);
    if (purse.textContent !== coins) purse.textContent = coins; // (a trade with Walt, a save from the server)
    const wal = el.querySelector('.hwal'),
      walOff = !(window.WALLET && WALLET.available && !WALLET.account);
    if (wal.hidden !== walOff) wal.hidden = walOff;
    retask(st.t, performance.now()); // (a sale to Walt, a save from the server, a building up)
    pump(); // (banners waiting for Walt's window to close)
    if (audioOn() !== el.querySelector('.hsnd').classList.contains('on')) sound(); // (M pressed)
    if (shown && performance.now() - paintAt > 250) {
      const s = SPOTS.find((x) => x.id === shown);
      // (a time it showed now up — the building stands, the heap is gone: it closes, the banner and the place are seen)
      if (wBusy && !(s && running(s))) {
        wBusy = false;
        win(null);
      } else if (s && (s.junk || s.b)) win(s, true);
    }
    const by = nearest(st, SIM.level(st.seed));
    if (by === near) return;
    near = by;
    if (task && task.id === 'walt' && by && by.who === 'walt') {
      SAVE.see(FIRST);
      retask(st.t);
    }
    if (clicked && Math.hypot(st.p.x - clicked.x, st.p.y - clicked.y) > 30) clicked = null;
    if (shown && !clicked && (!by || by.id !== shown)) win(null);
    ask();
  }
  // the prompt at the bottom: the spot's name and what E does there (its window up: closes it)
  function ask() {
    const box = el.querySelector('.hask'),
      by = near;
    box.hidden = !by;
    if (!by) return;
    box.querySelector('b').textContent = by.junk ? T('hub.junk') : spotName(by); // (a building: its level too)
    box.querySelector('span').textContent = T(
      shown ? 'hub.close' : by.who === 'walt' ? 'hub.trade' : by.who ? 'hub.talk' : by.junk ? 'hub.clear' : 'hub.open',
    );
    box.classList.toggle('lock', isLocked(by));
    box.classList.toggle('touch', !!window.__touch);
  }
  // the mouse (the human, 2026-11-12: on a PC too, besides E): a click on a person, their post, a piece of furniture or a heap of
  // junk opens it as E does, from wherever the hero stands; the cursor a hand over one
  const cv = () => document.getElementById('c');
  const viewPt = (e) => {
    const r = cv().getBoundingClientRect();
    const GW = (window.G && G.W) || SIM.VIEW.W,
      GH = (window.G && G.H) || SIM.VIEW.H; // (the view's size now, as index.html's toView)
    return [((e.clientX - r.left) / r.width) * GW, ((e.clientY - r.top) / r.height) * GH];
  };
  const blocked = () => !el || !S || (window.MARKET && MARKET.isOpen()) || window.__modal;
  // a finger (the human, 2026-11-12: on a phone a tap on the workbench did nothing): a short tap that didn't drag opens what it
  // landed on, as a click does; a drag is the stick's (index.html), and opens nothing
  let tap = null;
  function onClick(e) {
    if (e.pointerType !== 'mouse') {
      tap = blocked() ? null : { id: e.pointerId, cx: e.clientX, cy: e.clientY, t: performance.now(), at: viewPt(e) };
      return;
    }
    if (e.button !== 0 || blocked() || !window.SCENE || !SCENE.spotAt) return;
    const id = SCENE.spotAt(S, ...viewPt(e)),
      s = id && SPOTS.find((x) => x.id === id);
    if (!s) return;
    e.preventDefault();
    clicked = { x: S.p.x, y: S.p.y };
    use(s);
  }
  function onTapUp(e) {
    const p = tap;
    if (!p || e.pointerId !== p.id) return;
    tap = null;
    if (Math.hypot(e.clientX - p.cx, e.clientY - p.cy) > 14 || performance.now() - p.t > 450) return;
    if (blocked() || !window.SCENE || !SCENE.spotAt) return;
    const id = SCENE.spotAt(S, ...p.at),
      s = id && SPOTS.find((x) => x.id === id);
    if (!s) return;
    clicked = { x: S.p.x, y: S.p.y };
    use(s);
  }
  function onHover(e) {
    if (e.pointerType !== 'mouse') return;
    const on = !blocked() && window.SCENE && SCENE.spotAt && SCENE.spotAt(S, ...viewPt(e));
    cv().style.cursor = on ? 'pointer' : '';
  }
  function use(s = near) {
    if (!s) return;
    if (s.who === 'walt' || s.id === 'stash') {
      win(null);
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
    win(s);
  }
  // A spot's window on the right (null: closed; again: drawn anew in place, its times): its head (a building's picture,
  // its name and level; a heap's gear; Nova's face), then one screen of what it is about — never a scroll
  let gunSel = null, // (the workbench: the gun in view)
    wtab = 'own', // (the workbench or the medbay standing: what it is for — the guns', the cat's upgrades — or its next level)
    wBusy = false; // (the window shows a time going: a building going up, a heap being cleared)
  // a spot's time going now: its building going up, its heap being cleared
  const running = (s) =>
    s.junk ? R.clearing(SAVE, now()) === s.junk : !!s.b && (R.baseOf(SAVE).lv[s.b] || 0) > R.blv(SAVE, s.b, now());
  function win(s, again) {
    const box = el.querySelector('.hwin');
    const was = shown;
    shown = s ? s.id : '';
    box.hidden = !s;
    if (was !== shown) ask();
    if (!s) return;
    paintAt = performance.now();
    wBusy = running(s);
    const K = UI.kit,
      body = s.who === 'nova' ? orders(K) : s.junk ? junk(s, K) : s.soon ? soon() : building(s, K);
    const html =
      head(s, K) +
      body +
      `<button class="hw-x" data-close title="${T('hub.close')}" aria-label="${T('hub.close')}">${CROSS}</button>`;
    if (again && box.dataset.h === html) return;
    box.dataset.h = html;
    box.className = 'hwin' + (s.who === 'nova' ? ' nova' : '');
    box.innerHTML = html;
    if (!again) {
      box.classList.remove('in');
      void box.offsetWidth;
      box.classList.add('in'); // (it slides in once, not on each redraw)
    } else box.classList.add('in');
    K.on(box, '[data-close]', () => win(null));
    K.on(box, '[data-tomap]', () => {
      GAME.quit();
      UI.campaign();
    });
    K.on(box, '[data-build]', () => act({ k: 'build', id: s.b }, s));
    K.on(box, '[data-clear]', () => act({ k: 'clear', id: s.junk }, s));
    K.on(box, '[data-walt]', () => {
      win(null);
      if (window.MARKET) MARKET.open('walt', { tab: 'guns' });
    });
    K.on(box, '[data-shop]', () => {
      const B = E.building(s.b),
        L = B && B.levels[R.baseOf(SAVE).lv[s.b] || 0];
      win(null);
      if (window.MARKET) MARKET.open('walt', { need: L ? { b: s.b, items: L.items } : null });
    });
    K.on(box, '[data-gsel]', (b) => {
      gunSel = b.dataset.gsel;
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.25);
      win(s, true);
    });
    K.on(box, '[data-wtab]', (b) => {
      wtab = b.dataset.wtab;
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.25);
      win(s, true);
    });
    K.on(box, '[data-up]', (b) => act({ k: 'up', id: b.dataset.gun, s: b.dataset.up }, s));
    K.on(box, '[data-meta]', (b) => act({ k: 'meta', s: b.dataset.meta }, s));
    // (an upgrade's item short: Walt's window with its items over his shelf; this one back once his shuts)
    const back = () => el && win(s);
    K.on(box, '[data-ushop]', (b) => {
      win(null);
      K.upShop({ k: 'up', id: b.dataset.gun, s: b.dataset.ushop }, back);
    });
    K.on(box, '[data-mshop]', (b) => {
      win(null);
      K.upShop({ k: 'meta', s: b.dataset.mshop }, back);
    });
  }
  function head(s, K) {
    if (s.who === 'nova')
      return (
        `<div class="hw-h"><div class="hw-pic por"><img src="${pic('por_nova.png')}" alt="" draggable="false"></div>` +
        `<div class="hw-tt"><span class="hw-tag">${T('voice.name.nova')}</span><h3>${T('hub.order')}</h3></div></div>`
      );
    if (s.junk)
      return `<div class="hw-h"><div class="hw-pic gear">${GEAR}</div><div class="hw-tt"><h3>${T('hub.junk')}</h3></div></div>`;
    const B = s.b && E.building(s.b),
      lvl = B ? R.blv(SAVE, s.b, now()) : 0,
      m = B ? B.levels.length : 0;
    return (
      `<div class="hw-h"><div class="hw-pic"><img src="${pic((H.BPIC[s.b] || spotPic(s)) + '.png')}" alt="" draggable="false"></div>` +
      `<div class="hw-tt"><h3>${T('hub.spot.' + s.id)}</h3>` +
      (B
        ? `<div class="hw-lv"><span class="pips">${K.pips(lvl, m)}</span><small>${lvl ? T('hub.level', { n: lvl, m }) : T('hub.none')}</small></div>`
        : '') +
      '</div></div>'
    );
  }
  const spotPic = (s) => {
    const p = found(SIM.level(S.seed)).find((x) => x.s === s);
    if (p && p.prop.hide && HUB_BUILD_PIC[s.b]) return HUB_BUILD_PIC[s.b]; // (a building's unseen spot: its old picture)
    return p ? p.prop.n : s.prop;
  };
  // an action at the base (rules.js act): done (a sound, the window anew) or why not (shown in the window)
  let why = null;
  function act(a, s) {
    const err = SAVE.act(a, { now: now() });
    why = err ? { id: s.id, err } : null;
    if (!err && window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.4);
    if (S) syncBase(S);
    retask(S ? S.t : 0);
    win(s, true);
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
  const whyHtml = (s) =>
    why && why.id === s.id
      ? `<p class="hw-note bad">${T('hub.no.' + (WHY.includes(why.err) ? why.err : 'other'))}</p>`
      : '';
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
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60,
      out = [];
    if (h) out.push(T('hub.t.h', { n: h }));
    if (m) out.push(T('hub.t.m', { n: m }));
    if (s || !out.length) out.push(T('hub.t.s', { n: s }));
    return out.join(' ');
  }
  const soon = () => `<p class="hw-note">${LOCK}${T('hub.soon')}</p>`;
  // a bar of how far a time has gone, with what is left
  const bar = (k, left, key) =>
    `<div class="hw-bar"><i style="width:${Math.round(100 * Math.max(0, Math.min(1, k)))}%"></i><span>${CLOCK}${T(key, { t: clock(left) })}</span></div>`;
  // a level's cost as slots: the coins, then each item with the stash's count (green with a check once there are enough)
  function slots(L, K) {
    const { fmtN, coin } = K;
    let h = '<div class="hw-slots">';
    if (L.coins)
      h += `<div class="hw-sl coin${SAVE.coins >= L.coins ? ' ok' : ' short'}">${coin()}<b>${fmtN(L.coins)}</b></div>`;
    for (const [id, n] of L.items) {
      const have = (SAVE.items || {})[id] || 0,
        ok = have >= n,
        name = T('item.' + id);
      h +=
        `<div class="hw-sl${ok ? ' ok' : ' short'}" title="${name}">${ok ? `<i class="hw-ck">${CHECK}</i>` : ''}` +
        `<img src="${pic('it_' + id + '.png')}" alt="" draggable="false"><b>${fmtN(Math.min(have, n))}/${fmtN(n)}</b>` +
        `<small>${name}</small></div>`;
    }
    return h + '</div>';
  }
  // a condition of a level (the generator's level, the room cleared, a trophy): met (green) or not
  const cond = (ok, ico, text) => `<li class="${ok ? 'ok' : 'no'}"><i>${ok ? CHECK : ico}</i><span>${text}</span></li>`;
  // Nova: her word on what is next (the tutorial: why the base; after it: the base is yours, the next mission) and the
  // next mission on its card with the map a tap away. The parts are the tracker's
  function orders(K) {
    const bt = R.task(SAVE),
      id = R.current(SAVE),
      m = id ? E.mission(id) : null,
      say = bt
        ? T('hub.why')
        : tutorialOn() && standing('medbay')
          ? T('hub.yours')
          : m
            ? T('mission.' + m.id + '.goal')
            : T('hub.noOrder');
    let h = `<div class="hw-say"><p>${say}</p>${task && bt ? `<b>${ARROW}${T(task.key)}</b>` : ''}</div>`;
    if (m)
      h +=
        `<div class="hw-mis"><img src="assets/bg_mis_${m.id}.jpg?v=${window.__V || 0}" alt="" draggable="false">` +
        `<span><small>${T('hub.nextMis')}</small><b>${m.n} · ${T('mission.' + m.id + '.name')}</b></span>` +
        `<button class="btn orange" data-tomap>${T('hub.map')}</button></div>`;
    // her tasks of the day once the base's tutorial is over (rules.js bank, economy.js DAILY_NOVA): a raid won on the
    // suburb's map and one on the lab's, each with its coins and XP, a check once done; a map the campaign hasn't
    // reached yet: later
    if (!bt) {
      const dy = R.dailyOf(SAVE, now()),
        camp = SAVE.camp || [];
      const row = (k, open) => {
        const r = E.DAILY_NOVA[k],
          ok = !!dy[k];
        return (
          `<div class="hw-dl${ok ? ' ok' : ''}${open ? '' : ' lock'}">` +
          `<img src="assets/bg_mis_${k}.jpg?v=${window.__V || 0}" alt="" draggable="false">` +
          `<span><b>${T('hub.daily.' + k)}</b><small>${!open ? T('hub.daily.lock') : ok ? T('hub.daily.done') : T('hub.daily.pay', { c: K.fmtN(r.coins), x: K.fmtN(r.xp) })}</small></span>` +
          (ok ? CHECK : '') +
          '</div>'
        );
      };
      h +=
        `<h4 class="hw-h4">${T('hub.daily.title')}</h4>` +
        row('suburb', R.dailyOpen(SAVE, 'suburb')) +
        row('lab', R.dailyOpen(SAVE, 'lab'));
    }
    return h;
  }
  // a heap of junk: how long its clearing takes (free) and Clear; going on: its bar; another one going on: wait
  function junk(s) {
    const t = now(),
      b = R.baseOf(SAVE),
      cl = R.clearing(SAVE, t);
    let h = `<p class="hw-gives">${T('hub.junkWhy')}</p>`;
    if (cl === s.junk)
      return h + bar(1 - (b.clr[s.junk] - t) / (1000 * runningClear()), (b.clr[s.junk] - t) / 1000, 'hub.clearingT');
    h += `<div class="hw-time">${CLOCK}<b>${span(R.clearTime(SAVE))}</b><small>${T('hub.free')}</small></div>`;
    if (cl)
      return (
        h +
        `<p class="hw-note bad">${T('hub.no.busy')}</p>` +
        `<div class="hw-f"><button class="btn orange hw-go" disabled>${GEAR}<span>${T('hub.clear')}</span></button></div>`
      );
    return (
      h +
      whyHtml(s) +
      `<div class="hw-f"><button class="btn orange hw-go" data-clear>${GEAR}<span>${T('hub.clear')}</span></button></div>`
    );
  }
  // A building: what it gives; going up, its bar; else what its next level needs (the coins and items as slots, the
  // generator's level, its room, a trophy lock) with Build (its time) and, parts short, Walt's shop. The workbench
  // standing: two tabs, its guns' upgrades and its own next level
  function building(s, K) {
    const t = now(),
      B = E.building(s.b),
      base = R.baseOf(SAVE),
      paid = base.lv[s.b] || 0,
      lvl = R.blv(SAVE, s.b, t),
      next = B.levels[paid],
      lock = lockedBy(B);
    let h = `<p class="hw-gives">${T('hub.gives.' + s.id)}</p>`;
    if (paid > lvl) {
      const dur = 1000 * E.BUILD_TIME[Math.min(paid - 1, E.BUILD_TIME.length - 1)];
      return h + bar(1 - (base.bt[s.b] - t) / dur, (base.bt[s.b] - t) / 1000, 'hub.buildingT');
    }
    if ((s.b === 'workbench' || s.b === 'medbay') && lvl >= 1) {
      h = ''; // (its tabs say what it is)
      const wb = s.b === 'workbench',
        tabs = next
          ? `<div class="hw-tabs"><button class="${wtab === 'own' ? 'on' : ''}" data-wtab="own">` +
            `${T(wb ? 'hub.tabGuns' : 'hub.tabCat')}</button>` +
            `<button class="${wtab === 'lvl' ? 'on' : ''}" data-wtab="lvl">${T('hub.tabLevel', { n: paid + 1 })}</button></div>`
          : '';
      if (!next || wtab === 'own') return h + tabs + (wb ? guns(K) : cat(K));
      h += tabs;
    }
    if (!next) return h + `<p class="hw-note ok">${CHECK}${T('hub.top')}</p>`;
    const t0 = R.TASKS.includes(s.b) && paid === 0, // (the tutorial's level 1)
      short = SAVE.coins < next.coins,
      room = E.ROOM[s.b],
      roomOk = !room || R.cleared(SAVE, room, t),
      powOk = R.blv(SAVE, 'generator', t) >= (next.power || 0),
      itemsOk = next.items.every(([id, n]) => ((SAVE.items || {})[id] || 0) >= n),
      can = !lock && !short && roomOk && powOk && itemsOk;
    h += `<h4 class="hw-h4">${T('hub.needLv', { n: paid + 1 })}</h4>` + slots(next, K);
    let c = '';
    if (next.power) c += cond(powOk, BOLT, T('hub.power', { n: next.power }));
    if (room) c += cond(roomOk, GEAR, T(roomOk ? 'hub.roomOk' : 'hub.no.room'));
    if (lock) c += cond(false, LOCK, T('hub.lockedBy', { item: T('item.' + lock) }));
    if (c) h += `<ul class="hw-conds">${c}</ul>`;
    if (t0 && !itemsOk) {
      const g = R.gift(SAVE);
      if (g && g.id === s.b) h += `<p class="hw-note gift">${STAR}${T('hub.partsGift')}</p>`;
    }
    return (
      h +
      whyHtml(s) +
      '<div class="hw-f">' +
      (itemsOk ? '' : `<button class="btn ghost hw-shop" data-shop>${CART}<span>${T('hub.buyParts')}</span></button>`) +
      `<button class="btn orange hw-go" data-build ${can ? '' : 'disabled'}><span>${T('hub.build')}</span>` +
      `<small>${CLOCK}${span(E.BUILD_TIME[Math.min(paid, E.BUILD_TIME.length - 1)])}</small></button></div>`
    );
  }
  // the workbench: the guns owned as tabs (and Walt's for new ones), the one in view with its mastery and its three
  // upgrades (rules.js up: the coins, its mastery), as the arsenal shows them
  function guns(K) {
    const { fmtN, coin, MICO, pips, mbar } = K,
      W = DATA.WEAPON_UP,
      own = DATA.MAIN_ORDER.filter((id) => SAVE.owned[id] && R.usable(id));
    if (!own.length) return '';
    if (!own.includes(gunSel)) gunSel = own.includes(SAVE.selected) ? SAVE.selected : own[0];
    const id = gunSel,
      u = SAVE.wupOf(id),
      M = mbar(id),
      mast = R.mastery(SAVE, id);
    let h =
      '<div class="hw-gt">' +
      own
        .map(
          (g) =>
            `<button class="${g === id ? 'on' : ''}" data-gsel="${g}" title="${DATA.MAIN[g].name}">` +
            `<img src="${pic('i_' + g + '.png')}" alt="" draggable="false"></button>`,
        )
        .join('') +
      `<button class="add" data-walt title="${T('hub.gunsAtWalt')}">${PLUS}<small>${T('hub.atWalt')}</small></button></div>`;
    h +=
      `<div class="hw-gun"><b>${DATA.MAIN[id].name}</b><small>${T('arsenal.mastery', { l: M.l })}</small>` +
      `<div class="mbar"><i style="width:${M.w.toFixed(0)}%"></i></div></div>`;
    h += '<div class="hw-ups">';
    for (const [k, ico] of [
      ['dmg', 'star'],
      ['rate', 'bullet'],
      ['mag', 'mag'],
    ]) {
      const lv = u[k] || 0,
        P = W[k].price[lv],
        n = P === undefined ? { html: '', short: false } : K.upNeed({ k: 'up', id, s: k });
      const btn =
        P === undefined
          ? `<span class="hw-max">${T('common.max')}</span>`
          : lv >= mast
            ? `<span class="hw-mlk">${MICO.lock}${T('arsenal.mastNeed', { l: lv + 1 })}</span>`
            : n.short && SAVE.coins >= P
              ? `<button class="btn ghost hw-buy hw-ushop" data-ushop="${k}" data-gun="${id}">${CART}<b>${T('upgrades.shop')}</b></button>`
              : `<button class="btn orange hw-buy" data-up="${k}" data-gun="${id}" ${n.short || SAVE.coins < P ? 'disabled' : ''}>${coin()}<b>${fmtN(P)}</b></button>`;
      h +=
        `<div class="hw-up"><i class="hw-ui">${MICO[ico]}</i><div><b>${W[k].name}</b>` +
        `<span class="pips">${pips(lv, W[k].price.length)}</span>${n.html}</div>${btn}</div>`;
    }
    return h + '</div>';
  }
  // the medbay: the cat's upgrades (DATA.META, rules.js meta: the coins, the medbay standing) as tiles — its picture, its
  // name, its level, the price to raise it
  function cat(K) {
    const { fmtN, coin, pips } = K;
    let h = '<div class="hw-cat">';
    for (const [k, m] of Object.entries(DATA.META)) {
      const lv = SAVE.meta[k] || 0,
        P = m.price[lv],
        top = lv >= m.max || P === undefined,
        n = top ? { html: '', short: false } : K.upNeed({ k: 'meta', s: k });
      const btn = top
        ? `<span class="hw-max">${T('common.max')}</span>`
        : n.short && SAVE.coins >= P
          ? `<button class="btn ghost hw-buy hw-ushop" data-mshop="${k}">${CART}<b>${T('upgrades.shop')}</b></button>`
          : `<button class="btn orange hw-buy" data-meta="${k}" ${n.short || SAVE.coins < P ? 'disabled' : ''}>${coin()}<b>${fmtN(P)}</b></button>`;
      h +=
        `<div class="hw-ct" title="${m.desc}"><img src="${pic(m.icon + '.png')}" alt="" draggable="false">` +
        `<div><b>${m.name}</b><span class="pips">${pips(lv, m.max)}</span>${n.html}</div>${btn}</div>`;
    }
    return h + '</div>';
  }
})();
