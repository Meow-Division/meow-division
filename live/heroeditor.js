// live/heroeditor.js — the character editor (hero-editor.bat → /live/index.html?hero): the hero drawn big by the game's own renderer
// (hero3d.js, charmesh.js, gunmesh.js), its tune (live/hero.js) edited with sliders and handles, baked over the clips as it changes
// (herobake.js, H3.retune), saved by the local server (server.mjs --editor: server/herofile.mjs checks it, writes live/hero.js and the
// sim's muzzles in data.js). Per gun: where it sits in the paws (aiming, and in the lobby), its size, each paw on it; per clip: the
// parts of the body turned (for the whole clip or keyed through it); for all: how it moves. "Как в игре" plays it as a run does
// (WASD, the mouse aims, the left button fires). Not in the packed build (gen/build.mjs leaves it out).
(function () {
  if (!HERO3D.ready()) {
    // (its model not in: not exported yet, or a name with no c_<id>.json)
    const m = document.createElement('div');
    m.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;background:#0b0f17;color:#ffd23a;font:600 18px sans-serif;z-index:99;text-align:center;white-space:pre-line';
    m.textContent =
      'Модель персонажа «' +
      (window.HERO_ID || 'cat') +
      '» не загрузилась: её файлы (live/assets/c_' +
      (window.HERO_ID || 'cat') +
      '.json) ещё не готовы.\nОбнови страницу, когда экспорт закончится.';
    document.body.append(m);
    return;
  }
  const cv = document.getElementById('c'),
    W = SIM.VIEW.W,
    H = SIM.VIEW.H,
    HB = HEROBAKE,
    H3 = HERO3D,
    I = H3.info(),
    B = BATCH,
    gl = G.gl;
  const ID = window.HERO_ID || 'cat',
    DRAFT = 'md-hero-draft' + (ID === 'cat' ? '' : '-' + ID),
    D2R = Math.PI / 180,
    BASE_H = 720,
    GAME_ELEV = Math.PI / 6;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
    esc = (t) => String(t).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const HEROES = { cat: 'Кот (в игре)', calico: 'Калико-коммандос' };
  const GUN_NAMES = {
    pistol: 'Пистолет',
    shotgun: 'Дробовик',
    smg: 'Автомат',
    phantom: 'Медный фантом',
    minigun: 'Миниган',
    sniper: 'Снайперка',
    flame: 'Огнемёт',
    rocket: 'Ракетница',
  };
  const GUNS = DATA.MAIN_ORDER.concat(Object.keys(DATA.GUN_LIKE || {})).filter((g) => I.holds.includes(g)); // (and the rare ones)
  // standing still it holds the gun as it walks or runs (the stance, herobake.js: made from those clips, nothing of its own to tune);
  // a model without it (the calico) aims standing in its own idle clips
  const STANCE = !!I.anims.stand_pistol;
  const MODES = [
    ['lobby', 'В лобби', '1'],
    ['idle', 'Стоит, целится', '2'],
    ['walk', 'Идёт', '3'],
    ['run', 'Бежит (как в забеге с базовой скорости)', '4'],
    ['live', 'Как в игре', '5'],
  ].filter(
    (m) =>
      (m[0] !== 'walk' || I.anims.walk_pistol) &&
      (m[0] !== 'idle' || !STANCE) &&
      (m[0] !== 'lobby' || !I.anims.free_idle) /* (the menus show it with no gun, free_idle: nothing to tune there) */,
  );
  // the parts (herobake.js PARTS), the joint each one's handle sits on (the model's bones by role: HB.names; a part it has no bone
  // for, as the hero's tail, is left out)
  const NM = HB.names(I);
  const PARTS = [
    ['body', 'Всё тело', NM.parts.body[0]],
    ['waist', 'Поясница', NM.parts.waist[0]],
    ['chest', 'Грудь', NM.parts.chest[0]],
    ['neck', 'Шея', NM.parts.neck[0]],
    ['head', 'Голова', NM.parts.head[0]],
    ['tail', 'Хвост', (NM.parts.tail || [])[0]],
    ['shoulderR', 'Правое плечо', NM.arms.R[0]],
    ['shoulderL', 'Левое плечо', NM.arms.L[0]],
    ['elbowR', 'Правый локоть', NM.arms.R[2]],
    ['elbowL', 'Левый локоть', NM.arms.L[2]],
    ['thighR', 'Правое бедро', NM.parts.thighR[0]],
    ['thighL', 'Левое бедро', NM.parts.thighL[0]],
    ['shinR', 'Правое колено', NM.parts.shinR[0]],
    ['shinL', 'Левое колено', NM.parts.shinL[0]],
    ['footR', 'Правая стопа', NM.parts.footR[0]],
    ['footL', 'Левая стопа', NM.parts.footL[0]],
  ]
    .map(([k, t, b]) => ({ k, t, b: I.bones.indexOf(b), one: k.startsWith('elbow') }))
    .filter((p) => p.b >= 0);
  const PART = Object.fromEntries(PARTS.map((p) => [p.k, p])),
    ARMP = /^(shoulder|elbow)/; // (the lobby's arms are the idle clip's: not turned there)
  const partsHere = () => PARTS.filter((p) => mode !== 'lobby' || !ARMP.test(p.k));
  // how it moves (hero3d.js): [label, least, most, step, default, what it does]
  const MOTION = {
    twist: [
      'Корпус к прицелу, до °',
      0,
      120,
      1,
      30,
      'На сколько градусов верх тела может повернуться к прицелу относительно ног. Корпус и ноги вместе должны доставать до 105°, иначе на ходу оружие иногда не смотрит на прицел',
    ],
    legs: [
      'Ноги к прицелу на ходу, до °',
      0,
      90,
      1,
      90,
      'На ходу ноги смотрят туда, куда он идёт, и доворачивают к прицелу не больше этого. Больше — ступни сильнее скользят по земле, меньше — сильнее скручен корпус',
    ],
    rest: [
      'Стоя без шага, до °',
      0,
      90,
      1,
      0.55 / D2R,
      'Стоя на месте: на сколько может уйти прицел, прежде чем ноги переступят за ним',
    ],
    legRate: ['Поворот ног, скорость ×', 0.2, 4, 0.05, 1, 'Как быстро ноги поворачиваются в новую сторону'],
    twistRate: ['Поворот корпуса, скорость ×', 0.2, 4, 0.05, 1, 'Как быстро верх тела догоняет прицел'],
    kick: ['Отдача, сила ×', 0, 4, 0.05, 1, 'Насколько выстрел откидывает верх тела и оружие назад'],
    kickBack: ['Отдача, возврат ×', 0.2, 4, 0.05, 1, 'Как быстро он возвращается после выстрела'],
    lobbySpeed: ['Анимация в лобби ×', 0.2, 3, 0.05, 1, 'Скорость анимации в лобби'],
    idleSpeed: ['Анимация стоя ×', 0.2, 3, 0.05, 1, 'Скорость анимации, когда стоит на месте'],
    stride: [
      'Длина шага ×',
      0.5,
      2,
      0.01,
      0.75,
      'Больше: шаги реже и шире, меньше: чаще. Не совпадает с клипом — ноги начнут скользить по земле',
    ],
    lean: [
      'Наклон на ходу, °',
      0,
      20,
      0.5,
      0,
      'Насколько он ещё наклоняется вперёд на полной скорости, сверх наклона в самих клипах',
    ],
    leanAcc: ['Наклон при разгоне, °', 0, 20, 0.5, 5, 'Насколько ещё подаётся вперёд, когда разгоняется'],
    blink: ['Моргает раз в, сек', 0, 20, 0.5, 4, 'Как часто моргает, в среднем. 0: не моргает'],
  };

  // ================================================================== the tune and its history
  const blank = () => ({ v: 1, guns: {}, poses: {}, motion: {} });
  const norm = (t) => Object.assign(blank(), JSON.parse(JSON.stringify(t || {})));
  const zero = (v) => !v || v.every((x) => Math.abs(x) < 1e-9);
  // the tune without what changes nothing (zero moves, empty keys, defaults): what is saved and compared
  function prune(t) {
    const o = norm(t);
    for (const g of Object.keys(o.guns)) {
      const q = o.guns[g];
      if (q.scale === 1) delete q.scale;
      delete q.lobby; // (the lobby holds it as aiming does: herobake.js)
      for (const k of ['aim']) {
        const p = q[k];
        if (!p) continue;
        for (const v of ['p', 'r']) if (zero(p[v])) delete p[v];
        for (const s of ['pawR', 'pawL'])
          if (p[s]) {
            for (const v of ['p', 'r']) if (zero(p[s][v])) delete p[s][v];
            if (!Object.keys(p[s]).length) delete p[s];
          }
        if (!Object.keys(p).length) delete q[k];
      }
      if (!Object.keys(q).length) delete o.guns[g];
    }
    for (const c of Object.keys(o.poses)) {
      const P = o.poses[c];
      for (const k of Object.keys(P)) {
        const t = P[k];
        if ((t.r && zero(t.r)) || (t.k && !t.k.length) || (!t.r && !t.k) || (c.startsWith('lobby_') && ARMP.test(k)))
          delete P[k];
      }
      if (!Object.keys(P).length) delete o.poses[c];
    }
    for (const k of Object.keys(o.motion))
      if (!MOTION[k] || Math.abs(o.motion[k] - MOTION[k][4]) < 1e-9) delete o.motion[k]; // (and a setting no longer here)
    return o;
  }
  // the backpacks' placement (the cat's alone: live/hero_pack.js, hero3d.js H3.repack), edited beside the tune but saved to its own
  // file; per backpack p, r, s rounded as they are kept
  const PACKED = ID === 'cat',
    rnd = (v, k) => Math.round(v * k) / k;
  const packNorm = (P) => {
    const o = { v: 1, packs: {} };
    for (const n of ['1', '2']) {
      const q = Object.assign({}, H3.PACK0, P && P.packs && P.packs[n]);
      o.packs[n] = { p: q.p.map((v) => rnd(v, 1e4)), r: q.r.map((v) => rnd(v, 100)), s: rnd(q.s, 1e4) };
    }
    return o;
  };
  let tune = prune(window.HERO_TUNE),
    saved = JSON.stringify(tune),
    pack = packNorm(window.HERO_PACK),
    packSaved = JSON.stringify(pack);
  const changed = () =>
    JSON.stringify(prune(tune)) !== saved || (PACKED && JSON.stringify(packNorm(pack)) !== packSaved);
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
    if (
      d &&
      d.tune &&
      (JSON.stringify(prune(d.tune)) !== saved ||
        (PACKED && d.pack && JSON.stringify(packNorm(d.pack)) !== packSaved)) &&
      confirm('Есть несохранённые изменения персонажа от ' + new Date(d.t).toLocaleString('ru') + '. Открыть их?')
    ) {
      tune = prune(d.tune);
      if (d.pack) pack = packNorm(d.pack);
    }
  } catch (e) {}
  const undo = [],
    redo = [];
  const state = () => JSON.stringify({ tune, pack }); // (a step of the history: both)
  let snap = state();
  // after an edit is done (a slider let go, a handle dropped): one step of the history, the draft kept
  function commit() {
    const now = state();
    if (now === snap) return;
    undo.push(snap);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    snap = now;
    try {
      if (changed()) localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), tune, pack }));
      else localStorage.removeItem(DRAFT);
    } catch (e) {}
    bar();
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(state());
    const s = JSON.parse(from.pop());
    tune = norm(s.tune);
    pack = packNorm(s.pack);
    snap = state();
    rebake(true);
    panel();
    bar();
  }

  // ================================================================== the view's state
  let gun = GUNS.includes(SAVE.selected) ? SAVE.selected : GUNS[0],
    mode = STANCE ? 'walk' : 'idle',
    part = 'head',
    f = 0,
    playing = true,
    speed = 1;
  let yaw = 0.55,
    elev = GAME_ELEV,
    zoom = 1,
    pan = [0, 0],
    skel = true,
    lobbyLight = false,
    original = false,
    short = {},
    help = false;
  const clipOf = () => (mode === 'live' ? (STANCE ? 'stand_' : 'idle_') + gun : mode + '_' + gun),
    kindOf = () => 'aim';
  const frames = () => I.anims[clipOf()].n,
    fps = () => I.anims[clipOf()].fps * (mode === 'lobby' ? val('lobbySpeed') : mode === 'idle' ? val('idleSpeed') : 1);
  const val = (k) => (tune.motion[k] != null ? tune.motion[k] : MOTION[k][4]);
  const place = (make) => {
    const q = tune.guns[gun] || (make ? (tune.guns[gun] = {}) : {}),
      k = kindOf();
    return q[k] || (make ? (q[k] = {}) : {});
  };
  const pose = (make) => tune.poses[clipOf()] || (make ? (tune.poses[clipOf()] = {}) : {});
  // the tune baked over the clips: this gun's (all: every clip)
  let bakeDue = false;
  function rebake(all) {
    const T = original ? blank() : tune,
      mine = ['lobby_', 'idle_', 'walk_', 'run_', 'stand_', 'standrun_'].map((k) => k + gun),
      r = H3.retune(T, all ? undefined : mine);
    if (all) short = {};
    Object.assign(short, r);
    for (const c of mine) if (!r[c]) delete short[c];
    if (PACKED) H3.repack(original ? JSON.parse(packSaved) : pack); // (as it was: as last saved)
    bakeDue = false;
  }
  const dirty = () => {
    bakeDue = true;
  };

  // ================================================================== the page
  const css = document.createElement('style');
  css.textContent = `
body.hed { background: #0b0f17; }
body.hed canvas { inset: auto; margin: 0; aspect-ratio: auto; cursor: default; position: absolute; }
#htop { position: absolute; left: 0; right: 0; top: 0; height: 44px; display: flex; gap: 5px; align-items: center; padding: 0 10px; background: #121a28; border-bottom: 1px solid #26324a; box-sizing: border-box; z-index: 5; }
#htop button, #hside button, #htime button { font: 600 13px var(--font); color: #e8eefc; background: #1d2a42; border: 1px solid #33456a; border-radius: 6px; padding: 6px 9px; cursor: pointer; white-space: nowrap; }
#htop button:hover, #hside button:hover, #htime button:hover { background: #26375a; }
#htop button.on, #hside button.on { background: #e2600c; border-color: #ff9a2a; color: #fff; }
#htop .sep { width: 1px; height: 26px; background: #2c3a56; margin: 0 3px; }
#htop .sp { flex: 1; }
#htop select { font: 600 13px var(--font); color: #fff; background: #2a1f12; border: 1px solid #ff9a2a; border-radius: 6px; padding: 5px 6px; }
#htop button.save { background: #1f6a3a; border-color: #2f9a55; }
#htop button.save.dirty { background: #b3401a; border-color: #ff7a3a; }
#hside { position: absolute; left: 0; top: 44px; bottom: 0; width: 380px; overflow-y: auto; background: #101724; border-right: 1px solid #26324a; box-sizing: border-box; padding: 6px 10px 20px; z-index: 5; font: 500 12.5px var(--font); color: #cdd8ee; }
#hside h3 { font: 700 13.5px var(--font); color: #ffd23a; margin: 12px 0 4px; }
#hside h4 { font: 700 12px var(--font); color: #9fc0ff; margin: 9px 0 2px; }
#hside .row { display: grid; grid-template-columns: 140px 1fr 62px 16px; gap: 6px; align-items: center; margin: 2px 0; min-height: 24px; padding: 0; background: none; border: 0; box-shadow: none; border-radius: 0; }   /* (style.css has a .row of its own) */
#hside .row label { color: #b9c6e0; line-height: 1.15; font-size: 12px; }
#hside .row input[type=range] { width: 100%; height: 16px; margin: 0; padding: 0; }
#hside .row input[type=number] { width: 62px; background: #0e1522; color: #fff; border: 1px solid #33456a; border-radius: 4px; padding: 2px 3px; font: 500 12px var(--font); box-sizing: border-box; }
#hside .row .rs { color: #6f84aa; cursor: pointer; text-align: center; font-size: 14px; } #hside .row .rs:hover { color: #ffd23a; }
#hside .row.changed label { color: #ffd9a0; }
#hside .chips { display: flex; flex-wrap: wrap; gap: 4px; } #hside .chips button { padding: 4px 7px; font-size: 12px; }
#hside .chips button.has { box-shadow: inset 0 -2px 0 #ffb04a; }
#hside .btns { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; } #hside .btns button { font-size: 12px; padding: 5px 8px; }
#hside .note { color: #8fa3c8; font-size: 11.5px; line-height: 1.35; margin: 4px 0; }
#hside .warn { color: #ff8a6a; font-size: 12px; margin: 5px 0; }
#hside .seg { display: flex; gap: 0; margin: 4px 0; } #hside .seg button { border-radius: 0; flex: 1; font-size: 12px; } #hside .seg button:first-child { border-radius: 6px 0 0 6px; } #hside .seg button:last-child { border-radius: 0 6px 6px 0; }
#htime { position: absolute; left: 380px; right: 0; bottom: 0; height: 58px; background: #121a28; border-top: 1px solid #26324a; display: flex; gap: 10px; align-items: center; padding: 0 12px; z-index: 5; font: 500 12.5px var(--font); color: #b9c6e0; box-sizing: border-box; }
#htime .track { position: relative; flex: 1; height: 34px; }
#htime .track input { position: absolute; left: 0; right: 0; top: 14px; width: 100%; margin: 0; }
#htime .keys { position: absolute; left: 8px; right: 8px; top: 0; height: 12px; }
#htime .keys i { position: absolute; top: 1px; width: 9px; height: 9px; margin-left: -5px; background: #ffb04a; transform: rotate(45deg); cursor: pointer; }
#htime .keys i.cur { background: #fff; }
#htime .msg { color: #ffd23a; min-width: 200px; text-align: right; }
#htime select { background: #0e1522; color: #fff; border: 1px solid #33456a; border-radius: 4px; padding: 3px; }
#hov { z-index: 1; }
#hhelp { position: absolute; right: 12px; top: 54px; width: 340px; background: #101724f2; border: 1px solid #33456a; border-radius: 8px; padding: 10px 12px; font: 500 12px/1.5 var(--font); color: #cdd8ee; z-index: 6; display: none; }
#hhelp.on { display: block; } #hhelp b { color: #ffd23a; }`;
  document.head.appendChild(css);
  document.body.classList.add('hed');
  for (const id of ['ui', 'fsbtn', 'dev', 'flash']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
  const el = (tag, attrs = {}, html = '') => {
    const e = document.createElement(tag);
    Object.assign(e, attrs);
    if (html) e.innerHTML = html;
    return e;
  };
  const top = el('div', { id: 'htop' }),
    side = el('div', { id: 'hside' }),
    time = el('div', { id: 'htime' }),
    ov = el('canvas', { id: 'hov' });
  const helpEl = el(
    'div',
    { id: 'hhelp' },
    `
<b>Окно с героем</b><br>тащить по пустому месту: вращать (влево-вправо) и смотреть сверху или сбоку<br>правая кнопка или Shift + тащить: двигать вид · колесо: масштаб · двойной клик: вид как был<br>
<b>Ручки</b> (тащи мышью)<br><span style="color:#ffd23a">●</span> рукоять: двигает оружие · <span style="color:#ff5a4a">●</span> дуло: поворачивает его<br><span style="color:#5ad1ff">●</span> <span style="color:#7aff9a">●</span> правая и левая лапа на оружии<br>
<span style="color:#fff">●</span> суставы: поворачивают часть тела (локоть: тащи вбок)<br><b>Клавиши</b><br>${MODES.map((m) => m[2]).join(' ')} — ${MODES.map((m) => m[1].replace(/ \(.*\)/, '').toLowerCase()).join(', ')} · Q / E — пушка<br>пробел — пауза · ← → — кадр · K — ключ в этом кадре · Delete — убрать ключ<br>
H — скелет · Ctrl+Z / Ctrl+Y — отменить / вернуть · Ctrl+S — сохранить<br><b>Как в игре</b>: WASD идёт, мышь целится, левая кнопка стреляет<br>
<b>Ключи</b>: у части тела режим «По кадрам» — ставишь позу в нескольких кадрах, между ними она плавно перетекает по кругу`,
  );
  document.body.append(top, side, time, ov, helpEl);
  const btn = (t, fn, cls = '', title = '') => {
    const b = el('button', { textContent: t, className: cls, title });
    b.onclick = (e) => {
      b.blur();
      fn(e);
    };
    return b;
  }; // (blurred: a space bar later doesn't press it again)
  const pause = () => {
    playing = false;
    if (playB) playB.textContent = '▶';
  };
  const say = (m) => {
    msgEl.textContent = m;
    clearTimeout(say.t);
    say.t = setTimeout(() => (msgEl.textContent = ''), 4000);
  };

  // ---------------- the top bar
  function bar() {
    top.innerHTML = '';
    // the character: the game's hero or another one being made (index.html ?heroid: its own model and tune)
    const who = el('select', { title: 'Персонаж' });
    for (const [id, t] of Object.entries(HEROES))
      who.append(el('option', { value: id, textContent: t, selected: id === ID }));
    who.onchange = () => {
      if (changed() && !confirm('Есть несохранённые правки. Переключить персонажа без них?')) {
        who.value = ID;
        return;
      }
      location.search = '?hero' + (who.value === 'cat' ? '' : '&heroid=' + who.value);
    };
    top.append(who, el('div', { className: 'sep' }));
    for (const g of GUNS) top.append(btn(GUN_NAMES[g] || g, () => setGun(g), g === gun ? 'on' : ''));
    top.append(el('div', { className: 'sep' }));
    for (const [m, t, k] of MODES) top.append(btn(t, () => setMode(m), m === mode ? 'on' : '', 'клавиша ' + k));
    top.append(
      el('div', { className: 'sep' }),
      btn('↶', () => history(undo, redo), '', 'Отменить (Ctrl+Z)'),
      btn('↷', () => history(redo, undo), '', 'Вернуть (Ctrl+Y)'),
    );
    const orig = btn('Как было', () => {}, original ? 'on' : '', 'Зажми, чтобы увидеть героя без правок');
    orig.onpointerdown = () => {
      original = true;
      rebake();
      orig.className = 'on';
    };
    orig.onpointerup = orig.onpointerleave = () => {
      if (!original) return;
      original = false;
      rebake();
      orig.className = '';
    };
    top.append(
      orig,
      btn(
        'Скелет',
        () => {
          skel = !skel;
          bar();
        },
        skel ? 'on' : '',
        'H',
      ),
      btn(
        'Свет лобби',
        () => {
          lobbyLight = !lobbyLight;
          bar();
        },
        lobbyLight ? 'on' : '',
      ),
    );
    top.append(el('div', { className: 'sp' }));
    top.append(
      btn('Сбросить всё', () => {
        if (!confirm('Убрать все правки персонажа (всех пушек, поз и движения)?')) return;
        tune = blank();
        rebake(true);
        commit();
        panel();
      }),
    );
    const dirtyNow = changed();
    top.append(
      btn(dirtyNow ? 'Сохранить*' : 'Сохранить', save, 'save' + (dirtyNow ? ' dirty' : ''), 'Ctrl+S'),
      btn('Играть ▶', playGame, '', 'Сохранить и запустить забег с этой пушкой'),
      btn(
        '?',
        () => {
          help = !help;
          helpEl.classList.toggle('on', help);
        },
        help ? 'on' : '',
      ),
    );
  }
  function setGun(g) {
    gun = g;
    f = 0;
    rebake();
    panel();
    bar();
  }
  function setMode(m) {
    mode = m;
    f = Math.min(f, frames() - 1);
    if (mode === 'live') live = null;
    panel();
    bar();
    timeline();
  }

  // ---------------- the side panel
  // a slider row: get() → value, set(v); [least, most, step]; def: its value untouched (↺ puts it back)
  function row(parent, label, get, set, lo, hi, step, def = 0, fmt) {
    const r = el('div', { className: 'row' }),
      l = el('label', { textContent: label }),
      rg = el('input', { type: 'range', min: lo, max: hi, step }),
      nb = el('input', { type: 'number', min: lo, max: hi, step }),
      rs = el('span', { className: 'rs', textContent: '↺', title: 'Как было' });
    const show = () => {
      const v = get();
      rg.value = v;
      nb.value = fmt ? fmt(v) : +(+v).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 1);
      r.classList.toggle('changed', Math.abs(v - def) > 1e-9);
    };
    const put = (v) => {
      if (!Number.isFinite(v)) return;
      set(clamp(v, lo, hi));
      dirty();
      show();
    };
    rg.oninput = () => put(+rg.value);
    rg.onchange = commit;
    nb.oninput = () => put(+nb.value);
    nb.onchange = commit;
    rs.onclick = () => {
      set(def);
      dirty();
      show();
      commit();
    };
    r.append(l, rg, nb, rs);
    parent.append(r);
    show();
    rows.push(show);
    return r;
  }
  let rows = [];
  const vec = (o, k) => o[k] || (o[k] = [0, 0, 0]);
  function panel() {
    const sc = side.scrollTop; // (built again: scrolled where it was)
    side.innerHTML = '';
    rows = [];
    // ----- the gun
    const g = gun,
      k = kindOf();
    side.append(el('h3', { textContent: `Оружие: ${GUN_NAMES[g]} (стоит, идёт и бежит)` }));
    const P = () => place(true);
    side.append(el('h4', { textContent: 'Сдвиг' }));
    row(
      side,
      'Влево / вправо',
      () => -(place().p || [0])[0],
      (v) => (vec(P(), 'p')[0] = -v),
      -0.3,
      0.3,
      0.002,
    );
    row(
      side,
      'Вверх / вниз',
      () => (place().p || [0, 0])[1],
      (v) => (vec(P(), 'p')[1] = v),
      -0.3,
      0.3,
      0.002,
    );
    row(
      side,
      'Вперёд / назад',
      () => (place().p || [0, 0, 0])[2],
      (v) => (vec(P(), 'p')[2] = v),
      -0.3,
      0.3,
      0.002,
    );
    side.append(el('h4', { textContent: 'Поворот' }));
    row(
      side,
      'Ствол вверх / вниз',
      () => -(place().r || [0])[0],
      (v) => (vec(P(), 'r')[0] = -v),
      -80,
      80,
      0.5,
    );
    row(
      side,
      'Ствол влево / вправо',
      () => (place().r || [0, 0])[1],
      (v) => (vec(P(), 'r')[1] = v),
      -80,
      80,
      0.5,
    );
    row(
      side,
      'Завалить набок',
      () => (place().r || [0, 0, 0])[2],
      (v) => (vec(P(), 'r')[2] = v),
      -90,
      90,
      0.5,
    );
    row(
      side,
      'Размер оружия (везде)',
      () => HB.scaleOf(tune, g),
      (v) => {
        (tune.guns[g] || (tune.guns[g] = {})).scale = v;
      },
      0.5,
      2,
      0.01,
      1,
    );
    for (const [s, t] of [
      ['pawR', 'Правая лапа на оружии'],
      ['pawL', 'Левая лапа на оружии'],
    ]) {
      const Q = () => P()[s] || (P()[s] = {}),
        q = () => place()[s] || {};
      side.append(el('h4', { textContent: t }));
      row(
        side,
        'Влево / вправо',
        () => -(q().p || [0])[0],
        (v) => (vec(Q(), 'p')[0] = -v),
        -0.15,
        0.15,
        0.002,
      );
      row(
        side,
        'Вверх / вниз',
        () => (q().p || [0, 0])[1],
        (v) => (vec(Q(), 'p')[1] = v),
        -0.15,
        0.15,
        0.002,
      );
      row(
        side,
        'Вдоль ствола',
        () => (q().p || [0, 0, 0])[2],
        (v) => (vec(Q(), 'p')[2] = v),
        -0.15,
        0.15,
        0.002,
      );
      row(
        side,
        'Лапу вверх / вниз',
        () => (q().r || [0])[0],
        (v) => (vec(Q(), 'r')[0] = v),
        -90,
        90,
        0.5,
      );
      row(
        side,
        'Лапу влево / вправо',
        () => (q().r || [0, 0])[1],
        (v) => (vec(Q(), 'r')[1] = v),
        -90,
        90,
        0.5,
      );
      row(
        side,
        'Повернуть вокруг ствола',
        () => (q().r || [0, 0, 0])[2],
        (v) => (vec(Q(), 'r')[2] = v),
        -90,
        90,
        0.5,
      );
    }
    warnEl = el('div', { className: 'warn' });
    side.append(warnEl);
    const gb = el('div', { className: 'btns' });
    gb.append(
      btn('Сбросить оружие', () => {
        const q = tune.guns[g];
        if (q) delete q[k];
        dirty();
        commit();
        panel();
      }),
    );
    side.append(gb);
    side.append(
      el('div', {
        className: 'note',
        textContent:
          (STANCE
            ? 'Стоя на месте он держит оружие так же, как на ходу, а если умеет бегать — как на бегу. Ноги при этом прямые. '
            : 'В лобби оружие и руки такие же, как «Стоит, целится». ') +
          'Пули вылетают из нарисованного дула: при сохранении точка вылета для игры пересчитается сама.',
      }),
    );
    // ----- the pose
    side.append(
      el('h3', {
        textContent:
          mode === 'live'
            ? 'Поза'
            : 'Поза — ' + MODES.find((m) => m[0] === mode)[1].toLowerCase() + ', ' + GUN_NAMES[g].toLowerCase(),
      }),
    );
    if (mode === 'live')
      side.append(
        el('div', {
          className: 'note',
          textContent:
            'Позу правят в режимах ' +
            MODES.filter((m) => m[0] !== 'live')
              .map((m) => '«' + m[1].replace(/ \(.*\)/, '') + '»')
              .join(', ')
              .replace(/, ([^,]*)$/, ' и $1') +
            '. Здесь видно, как она смешивается в игре.',
        }),
      );
    else {
      const chips = el('div', { className: 'chips' }),
        P2 = pose();
      if (mode === 'lobby' && ARMP.test(part)) part = 'head';
      for (const p of partsHere())
        chips.append(
          btn(
            p.t,
            () => {
              part = p.k;
              panel();
            },
            (p.k === part ? 'on' : '') + (P2[p.k] ? ' has' : ''),
          ),
        );
      side.append(chips);
      const pt = PART[part],
        tr = P2[part],
        keyed = !!(tr && tr.k);
      const seg = el('div', { className: 'seg' });
      seg.append(
        btn('На весь клип', () => toConst(), keyed ? '' : 'on'),
        btn('По кадрам (ключи)', () => toKeys(), keyed ? 'on' : ''),
      );
      side.append(seg);
      const axes = pt.one
        ? [['Локоть наружу / внутрь', 0, 1]]
        : [
            ['Наклон вперёд / назад', 0, 1],
            ['Поворот влево / вправо', 1, 1],
            ['Наклон вбок', 2, 1],
          ];
      for (const [t, c, sg] of axes)
        row(
          side,
          t,
          () => partVal()[c] * sg,
          (v) => setPart(c, v * sg),
          pt.one ? -120 : -90,
          pt.one ? 120 : 90,
          0.5,
        );
      if (keyed)
        side.append(
          el('div', {
            className: 'note',
            textContent: `Ключи в кадрах: ${tr.k.map((q) => q[0]).join(', ')}. Ползунок ставит ключ в текущем кадре (${Math.floor(f)}).`,
          }),
        );
      const pb = el('div', { className: 'btns' });
      if (keyed) pb.append(btn('Ключ здесь (K)', addKey), btn('Убрать ключ (Del)', delKey));
      pb.append(
        btn('Сбросить часть', () => {
          const P3 = pose();
          delete P3[part];
          dirty();
          commit();
          panel();
        }),
        btn('Сбросить позу клипа', () => {
          delete tune.poses[clipOf()];
          dirty();
          commit();
          panel();
        }),
        btn('Эту позу — всем пушкам', () => {
          const src = tune.poses[clipOf()];
          if (!confirm('Скопировать позу «' + MODES.find((m) => m[0] === mode)[1] + '» этой пушки на все остальные?'))
            return;
          for (const o of GUNS)
            if (o !== g) {
              const c = mode + '_' + o;
              if (src) tune.poses[c] = JSON.parse(JSON.stringify(src));
              else delete tune.poses[c];
            }
          rebake(true);
          commit();
          say('Поза скопирована на все пушки');
        }),
      );
      side.append(pb);
    }
    // ----- the motion
    side.append(el('h3', { textContent: 'Движение (для всех пушек)' }));
    for (const k2 in MOTION) {
      const [t, lo, hi, st, def, tip] = MOTION[k2];
      row(
        side,
        t,
        () => val(k2),
        (v) => {
          if (Math.abs(v - def) < 1e-9) delete tune.motion[k2];
          else tune.motion[k2] = v;
        },
        lo,
        hi,
        st,
        def,
        (v) => +(+v).toFixed(st < 1 ? 2 : 1),
      ).title = tip;
    }
    side.append(
      el('div', { className: 'note', textContent: 'Повороты и отдачу лучше смотреть в режиме «Как в игре».' }),
    );
    if (PACKED) packPanel();
    side.scrollTop = sc;
  }
  // ----- the backpack: the one shown (1 the simple one, 2 the upgraded one) moved, turned, sized on his back at rest; ↺: as saved
  let packLv = H3.packLevel();
  H3.packLv = packLv; // (the one switched to here, whatever the stash)
  function packPanel() {
    side.append(el('h3', { textContent: 'Рюкзак (во всех клипах)' }));
    const seg = el('div', { className: 'seg' });
    for (const [n, t] of [
      [1, '1 — простой'],
      [2, '2 — улучшенный'],
    ])
      seg.append(
        btn(
          t,
          () => {
            packLv = H3.packLv = n;
            panel();
          },
          n === packLv ? 'on' : '',
        ),
      );
    side.append(seg);
    const q = () => pack.packs[packLv],
      s0 = JSON.parse(packSaved).packs[packLv];
    side.append(el('h4', { textContent: 'Сдвиг' }));
    row(
      side,
      'Влево / вправо',
      () => -q().p[0],
      (v) => (q().p[0] = -v),
      -0.3,
      0.3,
      0.002,
      -s0.p[0],
    );
    row(
      side,
      'Вверх / вниз',
      () => q().p[1],
      (v) => (q().p[1] = v),
      0.2,
      1,
      0.002,
      s0.p[1],
    );
    row(
      side,
      'Вперёд / назад',
      () => q().p[2],
      (v) => (q().p[2] = v),
      -0.4,
      0.2,
      0.002,
      s0.p[2],
    );
    side.append(el('h4', { textContent: 'Поворот' }));
    row(
      side,
      'Наклон вперёд / назад',
      () => q().r[0],
      (v) => (q().r[0] = v),
      -60,
      60,
      0.5,
      s0.r[0],
    );
    row(
      side,
      'Поворот влево / вправо',
      () => q().r[1],
      (v) => (q().r[1] = v),
      -60,
      60,
      0.5,
      s0.r[1],
    );
    row(
      side,
      'Наклон вбок',
      () => q().r[2],
      (v) => (q().r[2] = v),
      -60,
      60,
      0.5,
      s0.r[2],
    );
    side.append(el('h4', { textContent: 'Размер' }));
    row(
      side,
      'Высота рюкзака',
      () => q().s,
      (v) => (q().s = v),
      0.1,
      0.6,
      0.005,
      s0.s,
    );
    const pb = el('div', { className: 'btns' });
    pb.append(
      btn('Как сохранено', () => {
        pack.packs[packLv] = JSON.parse(JSON.stringify(s0));
        dirty();
        commit();
        panel();
      }),
    );
    side.append(pb);
    side.append(
      el('div', {
        className: 'note',
        textContent:
          'Рюкзак едет на груди (кость Spine2) и поворачивается вместе с корпусом. Сдвиг и поворот — как он висит, когда кот стоит прямо; высота — в ростах кота. В игре улучшенный рюкзак у героя с того уровня тайника, где открывается рюкзак на 10 мест. Сохраняется отдельно, в live/hero_pack.js.',
      }),
    );
  }
  let warnEl = null;
  // the selected part's value in this frame, and setting one of its three numbers (keyed: in this frame's key)
  const curFrame = () => Math.floor(f) % frames();
  const partVal = () => HB.track(pose()[part], curFrame(), frames()) || [0, 0, 0];
  function setPart(c, v) {
    const P = pose(true),
      t = P[part] || (P[part] = { r: [0, 0, 0] });
    if (t.k) {
      pause();
      const fr = curFrame();
      let q = t.k.find((x) => x[0] === fr);
      if (!q) {
        q = [fr, ...partVal()];
        t.k.push(q);
        t.k.sort((a, b) => a[0] - b[0]);
      }
      q[c + 1] = v;
    } else t.r[c] = v;
  }
  function toKeys() {
    const P = pose(true),
      v = partVal();
    P[part] = { k: [[curFrame(), ...v]] };
    dirty();
    commit();
    panel();
    timeline();
  }
  function toConst() {
    const P = pose(true),
      v = partVal();
    P[part] = { r: v.slice() };
    dirty();
    commit();
    panel();
    timeline();
  }
  function addKey() {
    if (mode === 'live') return;
    const P = pose(true);
    let t = P[part];
    if (!t || !t.k) {
      toKeys();
      return;
    }
    const fr = curFrame();
    if (!t.k.find((x) => x[0] === fr)) {
      t.k.push([fr, ...partVal()]);
      t.k.sort((a, b) => a[0] - b[0]);
    }
    dirty();
    commit();
    panel();
    timeline();
  }
  function delKey() {
    const t = pose()[part];
    if (!t || !t.k) return;
    const fr = curFrame();
    const i = t.k.findIndex((x) => x[0] === fr);
    if (i < 0) {
      say('В этом кадре ключа нет');
      return;
    }
    t.k.splice(i, 1);
    dirty();
    commit();
    panel();
    timeline();
  }

  // ---------------- the timeline
  const msgEl = el('div', { className: 'msg' });
  let fr = null,
    keysEl = null,
    playB = null,
    frameL = null;
  function timeline() {
    time.innerHTML = '';
    if (mode === 'live') {
      time.append(
        el('div', {
          innerHTML:
            '<b>Как в игре:</b> WASD — идёт с игровой скоростью, с Shift — медленнее, мышь — прицел, левая кнопка — стрельба. Так же он двигается в забеге: вбок шагом, вверх, вниз и по диагонали бегом, а с ×1.15 скорости всегда бегом.',
        }),
        el('div', { style: 'flex:1' }),
        msgEl,
      );
      return;
    }
    playB = btn(
      playing ? '❚❚' : '▶',
      () => {
        playing = !playing;
        playB.textContent = playing ? '❚❚' : '▶';
      },
      '',
      'Пробел',
    );
    const tr = el('div', { className: 'track' });
    keysEl = el('div', { className: 'keys' });
    fr = el('input', { type: 'range', min: 0, max: frames() - 1, step: 1 });
    fr.oninput = () => {
      playing = false;
      playB.textContent = '▶';
      f = +fr.value;
      rows.forEach((s) => s());
    };
    tr.append(keysEl, fr);
    frameL = el('div', { style: 'min-width:92px' });
    const sp = el('select');
    for (const v of [0.1, 0.25, 0.5, 1])
      sp.append(el('option', { value: v, textContent: '×' + v, selected: v === speed }));
    sp.onchange = () => (speed = +sp.value);
    time.append(playB, tr, frameL, sp, msgEl);
    keyMarks();
  }
  function keyMarks() {
    if (!keysEl) return;
    keysEl.innerHTML = '';
    const t = pose()[part],
      n = frames();
    if (t && t.k)
      for (const q of t.k) {
        const m = el('i', { title: 'Ключ, кадр ' + q[0] });
        m.style.left = (q[0] / (n - 1)) * 100 + '%';
        if (q[0] === curFrame()) m.className = 'cur';
        m.onclick = () => {
          playing = false;
          playB.textContent = '▶';
          f = q[0];
          rows.forEach((s) => s());
        };
        keysEl.append(m);
      }
  }

  // ---------------- saving
  // the backpacks to live/hero_pack.js when they changed; the tune to live/hero.js unless the backpacks alone changed (each file only
  // with what is its own: a backpack's change never rewrites the tune's file)
  async function save() {
    const t = prune(tune),
      pk = packNorm(pack),
      packDue = PACKED && JSON.stringify(pk) !== packSaved,
      tuneDue = JSON.stringify(t) !== saved || !packDue,
      files = [];
    const post = async (url, body) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }); // (base: the file as this page has it)
      if (r.status === 409) return false;
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      return true;
    };
    try {
      if (packDue) {
        if (!(await post('/api/editor/pack', { pack: pk, base: JSON.parse(packSaved) }))) return outdated();
        packSaved = JSON.stringify(pk);
        files.push('live/hero_pack.js');
      }
      if (tuneDue) {
        if (!(await post('/api/editor/hero', { tune: t, base: JSON.parse(saved), id: ID }))) return outdated();
        saved = JSON.stringify(t);
        files.push(ID === 'cat' ? 'live/hero.js' : 'live/hero_' + ID + '.js');
      }
      try {
        localStorage.removeItem(DRAFT);
      } catch (e) {}
      say('Сохранено в ' + files.join(' и '));
      bar();
      panel(); // (the backpack's ↺: to what is saved now)
      return true;
    } catch (e) {
      say(
        'Не сохранилось: ' +
          e.message +
          (String(e.message).includes('sign in') ? ' (редактор открыт не через «Редактор персонажа.bat»?)' : ''),
      );
      return false;
    }
  }
  function outdated() {
    say(
      'Не сохранилось: файл персонажа поменялся после того, как открылся редактор (сохранили из другой вкладки или поправили). Обнови страницу (F5).',
    );
    bar();
    return false;
  }
  async function playGame() {
    if (await save()) window.open('/live/index.html?autoplay=' + gun + (ID === 'cat' ? '' : '&heroid=' + ID), '_blank');
  }
  addEventListener('beforeunload', (e) => {
    if (changed()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ================================================================== the view: layout, projection, handles
  function layout() {
    const L = 380,
      T = 44,
      Bt = 58,
      aw = innerWidth - L,
      ah = innerHeight - T - Bt,
      k = Math.min(aw / W, ah / H),
      w = Math.floor(W * k),
      h = Math.floor(H * k);
    for (const c of [cv, ov])
      Object.assign(c.style, {
        left: L + Math.floor((aw - w) / 2) + 'px',
        top: T + Math.floor((ah - h) / 2) + 'px',
        width: w + 'px',
        height: h + 'px',
      });
    const d = devicePixelRatio || 1;
    ov.width = Math.round(w * d);
    ov.height = Math.round(h * d);
    bgDue = true;
  }
  addEventListener('resize', layout);
  const view = (e) => {
    const r = ov.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  // where the feet stand, how big it is, px per model unit
  const feet = () => [W * 0.5 + pan[0], H * 0.9 + pan[1]],
    hgt = () => BASE_H * zoom,
    ppu = () => hgt() / (I.height * 0.8660254);
  const camE = () => (mode === 'live' ? GAME_ELEV : elev);
  // a point of the model (not turned) on the view, turned by a (the yaw it is drawn with)
  function proj(p, a = yaw) {
    const c = Math.cos(a),
      s = Math.sin(a),
      [X, Y] = feet(),
      S = ppu(),
      e = camE();
    const w0 = p[0] * c + p[2] * s,
      w2 = -p[0] * s + p[2] * c;
    return [X + w0 * S, Y - (p[1] * Math.cos(e) - w2 * Math.sin(e)) * S];
  }
  const projT = (w) => {
    const [X, Y] = feet(),
      S = ppu(),
      e = camE();
    return [X + w[0] * S, Y - (w[1] * Math.cos(e) - w[2] * Math.sin(e)) * S];
  }; // (turned already)
  // a drag on the view (view px) as a move of the model (not turned), in the plane facing the camera
  function dragVec(dx, dy) {
    const S = ppu(),
      e = camE(),
      c = Math.cos(yaw),
      s = Math.sin(yaw),
      t = [dx / S, (-dy * Math.cos(e)) / S, (dy * Math.sin(e)) / S];
    return [t[0] * c - t[2] * s, t[1], t[0] * s + t[2] * c];
  }
  // the axis through the screen toward the viewer, in the model's space (not turned)
  function viewAxis() {
    const e = camE(),
      c = Math.cos(yaw),
      s = Math.sin(yaw),
      t = [0, Math.sin(e), Math.cos(e)];
    return [t[0] * c - t[2] * s, t[1], t[0] * s + t[2] * c];
  }
  // the pose shown (the clip's baked frames blended at f): its joints
  function joints() {
    const C = CHARMESH.clip(ID, clipOf()),
      n = frames(),
      i0 = Math.floor(f) % n,
      i1 = (i0 + 1) % n,
      k = f - Math.floor(f),
      A = C.m[i0],
      Bm = C.m[i1],
      S = new Float64Array(A.length);
    for (let i = 0; i < A.length; i++) S[i] = A[i] + (Bm[i] - A[i]) * k;
    return HB.joints(S, I);
  }
  const R3 = (M) => [M[0], M[1], M[2], 0, M[4], M[5], M[6], 0, M[8], M[9], M[10], 0];
  const tmul = (M, v) => [
    M[0] * v[0] + M[4] * v[1] + M[8] * v[2],
    M[1] * v[0] + M[5] * v[1] + M[9] * v[2],
    M[2] * v[0] + M[6] * v[1] + M[10] * v[2],
  ]; // Mᵀ v
  const rmul = (M, v) => [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[4] * v[0] + M[5] * v[1] + M[6] * v[2],
    M[8] * v[0] + M[9] * v[1] + M[10] * v[2],
  ];
  const nrm = (v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l);
  };
  let handles = [],
    hover = null,
    drag = null;
  function makeHandles() {
    handles = [];
    if (mode === 'live' || !H3.last) return;
    const L = H3.last,
      J = joints();
    handles.push({ id: 'grip', t: 'Рукоять: двигать оружие', p: projT(L.grip), c: '#ffd23a', r: 9 });
    handles.push({ id: 'muzzle', t: 'Дуло: поворачивать оружие', p: projT(L.muzzle), c: '#ff5a4a', r: 8 });
    handles.push({ id: 'pawR', t: 'Правая лапа', p: proj(J[I.bones.indexOf(NM.palm.R)]), c: '#5ad1ff', r: 7 });
    handles.push({ id: 'pawL', t: 'Левая лапа', p: proj(J[I.bones.indexOf(NM.palm.L)]), c: '#7aff9a', r: 7 });
    if (skel)
      for (const p of partsHere())
        handles.push({
          id: 'part:' + p.k,
          t: p.t,
          p: proj(J[p.b]),
          c: p.k === part ? '#ff9a2a' : '#ffffff',
          r: p.k === part ? 7 : 5,
        });
    handles.J = J;
  }
  const pick = (v) => {
    let best = null,
      bd = 18;
    for (const h of handles) {
      const d = Math.hypot(h.p[0] - v[0], h.p[1] - v[1]);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  };

  ov.addEventListener('contextmenu', (e) => e.preventDefault());
  ov.addEventListener('pointerdown', (e) => {
    const v = view(e);
    ov.setPointerCapture(e.pointerId);
    if (mode === 'live') {
      if (e.button === 0) shooting = true;
      return;
    }
    const h = e.button === 0 && !e.shiftKey ? pick(v) : null;
    if (h) {
      playing = false;
      if (playB) playB.textContent = '▶';
      if (h.id.startsWith('part:')) {
        part = h.id.slice(5);
        panel();
        keyMarks();
      }
      drag = { t: 'h', h, v };
      return;
    }
    drag = { t: e.button === 0 && !e.shiftKey ? 'rot' : 'pan', v };
  });
  ov.addEventListener('pointermove', (e) => {
    const v = view(e);
    mouse = v;
    if (!drag) {
      hover = mode === 'live' ? null : pick(v);
      ov.style.cursor = hover ? 'grab' : 'default';
      return;
    }
    const dx = v[0] - drag.v[0],
      dy = v[1] - drag.v[1];
    if (drag.t === 'rot') {
      yaw += dx * 0.008;
      elev = clamp(elev + dy * 0.004, -0.1, 1.45);
      bgDue = true;
    } else if (drag.t === 'pan') {
      pan[0] += dx;
      pan[1] += dy;
      bgDue = true;
    } else handleDrag(drag.h, drag.v, v, dx, dy);
    drag.v = v;
  });
  const up = () => {
    if (drag && drag.t === 'h') commit();
    drag = null;
    shooting = false;
  };
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
  ov.addEventListener('dblclick', () => {
    if (mode === 'live') return;
    yaw = 0.55;
    elev = GAME_ELEV;
    zoom = 1;
    pan = [0, 0];
    bgDue = true;
  });
  ov.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.15, 3);
      bgDue = true;
    },
    { passive: false },
  );
  // a handle dragged from view point a to b (dx, dy): the gun moved or turned, a paw moved, a part turned
  function handleDrag(h, a, b, dx, dy) {
    const Gf = H3.gunFrame(clipOf(), f);
    if (!Gf) return;
    const Gs = HB.square(Gf),
      d = dragVec(dx, dy);
    if (h.id === 'grip') {
      const pl = place(true),
        Re = HB.euler(pl.r || [0, 0, 0]),
        q = rmul(Re, tmul(Gs, d)),
        p = vec(pl, 'p');
      for (let i = 0; i < 3; i++) p[i] = clamp(p[i] + q[i], -0.3, 0.3);
    } else if (h.id === 'muzzle') {
      const g = projT(H3.last.grip),
        th = -(Math.atan2(b[1] - g[1], b[0] - g[0]) - Math.atan2(a[1] - g[1], a[0] - g[0]));
      const pl = place(true),
        Re = HB.euler(pl.r || [0, 0, 0]),
        ax = nrm(rmul(Re, tmul(Gs, viewAxis()))),
        R = HB.mul(HB.axisRot(ax, th), Re);
      pl.r = HB.toEuler(R).map((x) => clamp(Math.round(x * 100) / 100, -90, 90));
    } else if (h.id === 'pawR' || h.id === 'pawL') {
      const pl = place(true),
        q = pl[h.id] || (pl[h.id] = {}),
        l = tmul(Gs, d),
        p = vec(q, 'p');
      for (let i = 0; i < 3; i++) p[i] = clamp(p[i] + l[i], -0.15, 0.15);
    } else if (h.id.startsWith('part:')) {
      const k = h.id.slice(5),
        P = PART[k];
      part = k;
      if (P.one) setPart(0, clamp(partVal()[0] + dx * 0.4, -120, 120));
      else {
        const J = handles.J,
          c = proj(J[P.b]),
          th = -(Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]));
        const R = HB.mul(HB.axisRot(nrm(viewAxis()), th), HB.euler(partVal())),
          e = HB.toEuler(R).map((x) => clamp(Math.round(x * 100) / 100, -90, 90));
        for (let i = 0; i < 3; i++) setPart(i, e[i]);
      }
    }
    dirty();
    rows.forEach((s) => s());
  }

  // ---------------- keys
  const keys = {};
  let mouse = [W / 2, H / 2],
    shooting = false;
  addEventListener('keydown', (e) => {
    const c = e.code,
      ctrl = e.ctrlKey || e.metaKey;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && !ctrl) return; // (typing a number, a slider's own arrows)
    keys[c] = true;
    if (ctrl && c === 'KeyZ') {
      e.preventDefault();
      history(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo);
      return;
    }
    if (ctrl && c === 'KeyY') {
      e.preventDefault();
      history(redo, undo);
      return;
    }
    if (ctrl && c === 'KeyS') {
      e.preventDefault();
      save();
      return;
    }
    if (ctrl) return;
    const m = MODES.find((x) => x[2] === e.key);
    if (m) {
      setMode(m[0]);
      return;
    }
    if (mode === 'live' && /^Key[WASD]$/.test(c)) {
      e.preventDefault();
      return;
    }
    if (c === 'KeyQ' || c === 'KeyE') {
      const i = GUNS.indexOf(gun);
      setGun(GUNS[(i + (c === 'KeyE' ? 1 : GUNS.length - 1)) % GUNS.length]);
      return;
    }
    if (c === 'KeyH') {
      skel = !skel;
      bar();
      return;
    }
    if (mode === 'live') return;
    if (c === 'Space') {
      e.preventDefault();
      playing = !playing;
      if (playB) playB.textContent = playing ? '❚❚' : '▶';
      return;
    }
    if (c === 'ArrowLeft' || c === 'ArrowRight') {
      e.preventDefault();
      playing = false;
      if (playB) playB.textContent = '▶';
      f = (Math.floor(f) + (c === 'ArrowRight' ? 1 : frames() - 1)) % frames();
      rows.forEach((s) => s());
      return;
    }
    if (c === 'KeyK') {
      addKey();
      return;
    }
    if (c === 'Delete') {
      delKey();
      return;
    }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    shooting = false;
  });

  // ================================================================== drawing
  // the backdrop: a dark floor with a grid round the feet (turned with the model; in "как в игре" the run's ground, moving under it)
  const bgc = document.createElement('canvas');
  bgc.width = 960;
  bgc.height = 540;
  let BG = null,
    bgDue = true,
    ground = [0, 0];
  function paintBg() {
    const g = bgc.getContext('2d'),
      k = bgc.width / W,
      [X, Y] = feet(),
      S = ppu() * k,
      e = camE(),
      se = Math.sin(e);
    const gr = g.createLinearGradient(0, 0, 0, bgc.height);
    gr.addColorStop(0, '#1d2638');
    gr.addColorStop(1, '#0c1018');
    g.fillStyle = gr;
    g.fillRect(0, 0, bgc.width, bgc.height);
    const a = mode === 'live' ? Math.PI / 4 : yaw + Math.PI / 4,
      c = Math.cos(a),
      s = Math.sin(a),
      sp = 0.25,
      N = 14;
    const P = (u, v) => {
      const x = u * c + v * s,
        z = -u * s + v * c;
      return [X * k + x * S, Y * k + z * se * S];
    };
    g.lineWidth = 1;
    const ou = ((ground[0] % sp) + sp) % sp,
      ovv = ((ground[1] % sp) + sp) % sp;
    for (let i = -N; i <= N; i++)
      for (const dir of [0, 1]) {
        const t = i * sp - (dir ? ovv : ou);
        g.beginPath();
        for (let j = -N; j <= N; j += 0.5) {
          const q = dir ? P(j * sp, t) : P(t, j * sp);
          j === -N ? g.moveTo(...q) : g.lineTo(...q);
        }
        g.strokeStyle = 'rgba(140,170,220,0.10)';
        g.stroke();
      }
    const rg = g.createRadialGradient(X * k, Y * k, 0, X * k, Y * k, hgt() * k * 1.4);
    rg.addColorStop(0, 'rgba(12,16,24,0)');
    rg.addColorStop(1, 'rgba(12,16,24,0.92)');
    g.fillStyle = rg;
    g.fillRect(0, 0, bgc.width, bgc.height);
    if (!BG) {
      BG = G.canvasTex('heroed_bg', bgc);
      gl.bindTexture(gl.TEXTURE_2D, BG.t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, BG.t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgc);
    }
    bgDue = false;
  }
  // "как в игре": its own state, stepped as a run steps it
  let live = null,
    liveT = 0,
    fireT = 0,
    spinA = 0,
    spin = 0,
    kickNow = 0;
  function stepLive(dt) {
    if (!live) {
      live = H3.state();
      liveT = 0;
      ground = [0, 0];
    }
    liveT += dt;
    const sp = keys.ShiftLeft || keys.ShiftRight ? 60 : 200,
      mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      my = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0),
      l = Math.hypot(mx, my) || 1;
    const vx = (mx / l) * sp,
      vy = (my / l) * sp,
      [X, Y] = feet(),
      aim = Math.atan2(mouse[1] - (Y - hgt() * 0.45), mouse[0] - X);
    const Sg = H3.H / (I.height * 0.8660254);
    ground[0] += (vx / Sg) * dt;
    ground[1] += (vy / (Math.sin(GAME_ELEV) * Sg)) * dt;
    if (vx || vy) bgDue = true;
    const d = DATA.MAIN[gun] || {};
    kickNow = 0;
    spin = gun === 'minigun' ? clamp(spin + ((shooting ? 1 : -1) * dt) / (d.spin || 1.3), 0, 1) : 0;
    spinA += spin * 30 * dt;
    fireT -= dt;
    if (shooting && fireT <= 0 && (gun !== 'minigun' || spin > 0.6)) {
      fireT = 1 / ((d.rate || 3) * (gun === 'minigun' ? spin : 1));
      kickNow = d.recoil || 6;
    }
    H3.step(live, liveT, { aim, vx, vy, dead: false, gun, h: H3.H, kick: kickNow });
    return live;
  }
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now; // (a first frame stamped before the page took its time: not backward)
    if (bakeDue) rebake();
    if (mode !== 'live' && playing) f = (f + dt * fps() * speed) % frames();
    if (fr && mode !== 'live' && +fr.value !== Math.floor(f)) fr.value = Math.floor(f);
    let st;
    if (mode === 'live') st = stepLive(dt);
    else st = { layers: [{ anim: clipOf(), f, w: 1 }], yaw, twist: 0, kick: 0, gun: true, fade: 1, blink: 0, dieT: -1 };
    if (bgDue || mode === 'live') paintBg();
    G.bind(null, [0.05, 0.06, 0.09, 1]);
    G.blend();
    G.draw(LIB.P.lobtex, { u_tex: BG, u_a: 1, u_t: 0, u_bend: 0, u_tint: [1, 1, 1] }, G.xf(0, 0, W, H));
    const [X, Y] = feet(),
      h = hgt();
    B.fx(
      5,
      X + h * 0.03,
      Y + h * 0.01,
      h * 0.3,
      h * 0.065 * Math.sin(camE()) * 2,
      0,
      0.02,
      0.02,
      0.03,
      0.55,
      1.6,
      0,
      1,
    );
    if (mode === 'walk' || mode === 'run') floor();
    B.flush(B.F, 'fx');
    const U = lobbyLight ? { elev: camE(), mood: 1, shade: 1, ink: 0 } : { elev: camE(), mood: 0, shade: 0.9, ink: 1 };
    try {
      H3.draw(st, X, Y, h, gun, U, { spin: spinA });
    } catch (e) {
      console.error(e);
    }
    makeHandles();
    overlay();
    if (frameL && mode !== 'live') frameL.textContent = 'кадр ' + Math.floor(f) + ' / ' + (frames() - 1);
    if (Math.floor(f) !== frame.lf) {
      frame.lf = Math.floor(f);
      keyMarks();
      if (!playing) rows.forEach((s) => s());
    }
    if (now > (frame.wt || 0)) {
      frame.wt = now + 300;
      warn();
    }
  }
  // walking or running on the spot: the ground passing under it as the game moves it — one stride of the clip a cycle (times the stride
  // set here, as the game does): a foot that stands on a line while it is down doesn't slide
  function floor() {
    const n = frames(),
      gait = (mode === 'run' ? I.gait : I.gaitw || I.gait) * val('stride'),
      d = gait / 4,
      off = ((f / n) * gait) % d;
    for (let i = -6; i <= 6; i++) {
      const z = i * d - off,
        a = proj([-0.32, 0, z]),
        b = proj([0.32, 0, z]),
        al = 0.32 * Math.max(0, 1 - Math.abs(z) / (d * 6.5));
      B.fx(
        11,
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
        1.3,
        Math.atan2(b[1] - a[1], b[0] - a[0]),
        0.75,
        0.82,
        0.95,
        al,
        0.25,
        6,
        1,
      );
    }
  }
  function warn() {
    if (!warnEl) return;
    const s = short[clipOf()],
      t = [];
    if (s && s.R > 0.004) t.push('правая');
    if (s && s.L > 0.004) t.push('левая');
    warnEl.textContent = t.length
      ? `${t.join(' и ')} лапа не дотягивается до своего места на оружии (руки короткие): подвинь оружие ближе к телу или лапу.`
      : '';
  }
  function overlay() {
    const g = ov.getContext('2d'),
      k = ov.width / W;
    g.clearRect(0, 0, ov.width, ov.height);
    if (mode === 'live') {
      const [X, Y] = feet();
      g.strokeStyle = 'rgba(255,90,74,0.6)';
      g.lineWidth = 1.5 * k;
      g.beginPath();
      g.arc(mouse[0] * k, mouse[1] * k, 10 * k, 0, 7);
      g.stroke();
      return;
    }
    if (!handles.length) return;
    const J = handles.J,
      P = (p) => proj(p).map((v) => v * k);
    if (skel) {
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 1.2 * k;
      g.beginPath();
      I.parent.forEach((p, i) => {
        if (p < 0) return;
        const a = P(J[p]),
          b = P(J[i]);
        g.moveTo(...a);
        g.lineTo(...b);
      });
      g.stroke();
    }
    const gp = handles.find((x) => x.id === 'grip'),
      mp = handles.find((x) => x.id === 'muzzle');
    if (gp && mp) {
      g.strokeStyle = 'rgba(255,210,60,0.7)';
      g.setLineDash([5 * k, 4 * k]);
      g.lineWidth = 1.5 * k;
      g.beginPath();
      g.moveTo(gp.p[0] * k, gp.p[1] * k);
      g.lineTo(mp.p[0] * k, mp.p[1] * k);
      g.stroke();
      g.setLineDash([]);
    }
    for (const h of handles) {
      const on = (hover && hover.id === h.id) || (drag && drag.h && drag.h.id === h.id),
        r = (h.r + (on ? 3 : 0)) * k;
      g.fillStyle = h.c;
      g.strokeStyle = '#000';
      g.lineWidth = 2 * k;
      g.beginPath();
      g.arc(h.p[0] * k, h.p[1] * k, r, 0, 7);
      g.globalAlpha = h.id.startsWith('part:') ? 0.85 : 1;
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
    }
    const lab = (drag && drag.h) || hover;
    if (lab) {
      const h = handles.find((x) => x.id === lab.id) || lab;
      g.font = `700 ${Math.round(14 * k)}px Rubik, sans-serif`;
      g.textAlign = 'left';
      g.lineWidth = 3 * k;
      g.strokeStyle = '#000';
      g.fillStyle = '#fff';
      g.strokeText(h.t, (h.p[0] + 14) * k, (h.p[1] - 10) * k);
      g.fillText(h.t, (h.p[0] + 14) * k, (h.p[1] - 10) * k);
    }
  }

  layout();
  rebake(true);
  bar();
  panel();
  timeline();
  requestAnimationFrame(frame);
  window.HEROED = {
    get tune() {
      return tune;
    },
    set: (t) => {
      tune = norm(t);
      rebake(true);
      panel();
    },
    save,
    prune,
    rebake,
    setGun,
    setMode,
    get handles() {
      return handles;
    },
    get pack() {
      return pack;
    },
    get short() {
      return short;
    },
    get f() {
      return f;
    },
    set f(v) {
      f = v;
      playing = false;
    },
    drag: handleDrag,
    commit,
    proj,
    view: () => ({ yaw, elev, zoom, pan: pan.slice() }),
    look: (o) => {
      if (o.yaw != null) yaw = o.yaw;
      if (o.elev != null) elev = o.elev;
      if (o.zoom != null) zoom = o.zoom;
      if (o.pan) pan = o.pan.slice();
      bgDue = true;
    },
  }; // (gen/heroeditcheck.mjs)
})();
