// live/lab.js — the balance lab inside the game: the page opened with ?lab plays on a progress of its own (save.js keeps it apart from
// the guest's and never connects a wallet; its runs go to no server). A panel in the menus sets that progress to a stage of the game
// (a new account … everything bought) or changes it by hand (coins, rank, the gun), and keeps a log of the runs played there: how long,
// what killed the hero, the damage taken minute by minute (share of the max health), each boss's fight — with a button that copies the
// log as text. In a run a line of numbers sits bottom left; the cheat keys work (F1 a level, F2 +1 min, F3 god mode, F4 a horde, F5 the
// next boss) and the pause menu has the same as buttons. Loaded by index.html only with ?lab.
// Who is online (net.js online: the server's list every 2 s): their number on the button, and in the panel each page — what it is
// doing, its gun, Telegram or the site — with a button to watch its runs (index.html GAME.watch: this page plays the very same run from
// the player's inputs, a moment behind; a bar on top says how it goes and leads back).
(function () {
  if (!window.LAB) return;
  const D = DATA,
    R = RULES,
    LOG = 'md.lab.log',
    OPT = 'md.lab.opt';
  const get = (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null') ?? d;
    } catch (e) {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  };
  const opt = Object.assign({ hud: true }, get(OPT, {}));
  const rxpOf = (r) => {
    let x = 0;
    for (let i = 1; i < r; i++) x += D.RANK_NEED(i);
    return x;
  };
  const META0 = { hp: 0, dmg: 0, speed: 0, magnet: 0, reroll: 0, start: 0 };
  const NAME = {
    walker: 'зомби',
    runner: 'бегун',
    bloater: 'толстяк',
    bomber: 'подрывник',
    armored: 'бронированный',
    spitter: 'плевун',
    butcher: 'Учёный',
    pustule: 'Кислотник',
    screamer: 'Крикунья',
    tank: 'Бронетанк',
    golem: 'Грибной монстр',
  };
  const GUN = {
    pistol: 'пистолет',
    shotgun: 'дробовик',
    smg: 'автомат',
    minigun: 'миниган',
    sniper: 'снайперка',
    flame: 'огнемёт',
    rocket: 'ракетница',
  };
  // the stages (as in balance/stages.json, the balance lab's fixed accounts)
  const PRESETS = [
    {
      id: 'new',
      name: 'Новый аккаунт',
      sub: 'ранг 1, пистолет, ничего не куплено',
      rank: 1,
      guns: ['pistol'],
      gun: 'pistol',
      meta: {},
      wup: {},
    },
    {
      id: 'r4',
      name: 'После 3 забегов',
      sub: 'ранг 4, дробовик',
      rank: 4,
      guns: ['pistol', 'shotgun'],
      gun: 'shotgun',
      meta: { hp: 1 },
      wup: {},
    },
    {
      id: 'r8',
      name: 'Ранг 8',
      sub: 'автомат без улучшений (раньше здесь кончалась фора)',
      rank: 8,
      guns: ['pistol', 'shotgun', 'smg', 'minigun'],
      gun: 'smg',
      meta: { hp: 1 },
      wup: {},
    },
    {
      id: 'r12',
      name: 'Ранг 12',
      sub: 'огнемёт, немного улучшений',
      rank: 12,
      guns: ['pistol', 'shotgun', 'smg', 'minigun', 'sniper', 'flame'],
      gun: 'flame',
      meta: { hp: 1, speed: 1, magnet: 1 },
      wup: { dmg: 1, rate: 1, mag: 1 },
    },
    {
      id: 'r17',
      name: 'Ранг 17',
      sub: 'пистолет 4/4/4, аккаунт почти прокачан',
      rank: 17,
      guns: ['pistol', 'shotgun', 'smg', 'minigun', 'sniper', 'flame', 'rocket'],
      gun: 'pistol',
      meta: { hp: 4, dmg: 3, speed: 4, magnet: 5, reroll: 2, start: 1 },
      wup: { dmg: 4, rate: 4, mag: 4 },
    },
    {
      id: 'max',
      name: 'Всё на максимум',
      sub: 'ранг 25, все пушки, всё улучшено',
      rank: 25,
      guns: 'all',
      gun: 'rocket',
      meta: { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 3 },
      wup: { dmg: 5, rate: 5, mag: 5 },
      all: true,
    },
  ];
  function apply(P) {
    const s = R.defaults(),
      guns = P.guns === 'all' ? D.MAIN_ORDER.filter((id) => R.usable(id)) : P.guns;
    s.rxp = rxpOf(P.rank);
    for (const g of guns) s.owned[g] = true;
    s.selected = P.gun;
    Object.assign(s.meta, META0, P.meta);
    for (const g of guns) if (P.all || g === P.gun) s.wup[g] = Object.assign({ dmg: 0, rate: 0, mag: 0 }, P.wup);
    s.language = SAVE.language;
    s.ava = SAVE.ava;
    s.bg = SAVE.bg;
    s.nick = SAVE.nick;
    set(s);
  }
  function set(s) {
    Object.assign(SAVE, R.clean(s), { profile: null });
    SAVE.persist();
    if (window.UI && !GAME.play) UI.lobby();
    paint();
  }

  // ---------- the panel ----------
  const css = document.createElement('style');
  css.textContent = `
#labbtn { position: absolute; left: 12px; bottom: 36px; z-index: 60; font: 800 14px var(--font); letter-spacing: 1px; color: #3a1d00; background: linear-gradient(180deg, #ffe17a, #e9a515);
  border: 2px solid #fff0b0; border-radius: 10px; padding: 7px 12px; cursor: pointer; box-shadow: 0 4px 0 #8a5a04; }
#labp { position: absolute; left: 12px; bottom: 82px; z-index: 61; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 100px); overflow: auto; touch-action: pan-y;
  -webkit-user-select: text; user-select: text; box-sizing: border-box; padding: 14px 16px; font: 13px/1.35 var(--font); color: var(--text); }
#labp[hidden], #labbtn[hidden], #labhud[hidden], #labcheat[hidden] { display: none; }
#labp h3 { margin: 0 0 2px; font: 900 18px var(--font); } #labp .note { color: var(--muted); margin: 0 0 10px; }
#labp .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 12px; }
#labp .pre { text-align: left; padding: 8px 10px; border-radius: 10px; border: 2px solid var(--edge); background: #0d1830; color: #fff; cursor: pointer; font: 700 13px var(--font); }
#labp .pre small { display: block; font-weight: 400; color: var(--muted); margin-top: 2px; }
#labp .pre:hover, #labp .row button:hover { border-color: var(--orange); }
#labp .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
#labp .row button, #labcheat button { font: 700 12px var(--font); color: #fff; background: #172a52; border: 2px solid var(--edge); border-radius: 8px; padding: 5px 9px; cursor: pointer; }
#labp .row b { font-weight: 800; } #labp .acc { margin-bottom: 8px; color: var(--muted); } #labp .acc b { color: #fff; }
#labp table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 12px; }
#labp th, #labp td { text-align: left; padding: 4px 6px; border-top: 1px solid #ffffff1a; vertical-align: top; }
#labp th { color: var(--muted); font-weight: 600; } #labp td.win { color: #7dff8a; } #labp td.dead { color: #ff8a7a; }
#labp .dm { display: inline-flex; gap: 1px; align-items: flex-end; height: 18px; } #labp .dm i { width: 5px; background: var(--orange); display: block; min-height: 1px; }
#labhud { position: absolute; left: 10px; bottom: 36px; z-index: 55; font: 12px ui-monospace, Menlo, Consolas, monospace; color: #fff; background: #000a; padding: 5px 8px; border-radius: 6px; pointer-events: none; white-space: pre; }
#labcheat { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 62; display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
#labp .on { margin-bottom: 12px; } #labp .on .row { margin-bottom: 6px; } #labp .on td.me { color: var(--muted); }
#labp .on .tag { display: inline-block; font-size: 10px; font-weight: 700; color: #9fb0cf; border: 1px solid #3d6aa8; border-radius: 5px; padding: 0 4px; margin-left: 4px; vertical-align: 1px; }
#labp .on button { font: 700 12px var(--font); color: #3a1d00; background: linear-gradient(180deg, #ffe17a, #e9a515); border: 0; border-radius: 7px; padding: 4px 9px; cursor: pointer; }
#labw { position: absolute; left: max(12px, var(--sl, 0px)); bottom: max(36px, var(--sb, 0px)); z-index: 62; display: flex; gap: 10px; align-items: center; max-width: min(620px, calc(100vw - 24px));
  font: 700 13px var(--font); color: #fff; background: #0d1830e6; border: 2px solid var(--edge); border-radius: 10px; padding: 6px 8px 6px 12px; box-sizing: border-box; }
#labw b { color: var(--gold); } #labw span { color: var(--muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#labw button { font: 800 12px var(--font); color: #fff; background: #172a52; border: 2px solid var(--edge); border-radius: 8px; padding: 4px 10px; cursor: pointer; flex: none; }
#labw[hidden] { display: none; }
html.watching #ui > .scr, html.watching #ui > .scr * { pointer-events: none !important; }   /* (a watched run's card screens: to look at only) */`;
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'labbtn';
  btn.textContent = 'ЛАБ';
  const P = document.createElement('div');
  P.id = 'labp';
  P.className = 'panel';
  P.hidden = true;
  const hud = document.createElement('div');
  hud.id = 'labhud';
  hud.hidden = true;
  const cheat = document.createElement('div');
  cheat.id = 'labcheat';
  cheat.hidden = true;
  cheat.innerHTML = [
    ['lvl', '+уровень'],
    ['time', '+1 минута'],
    ['boss', 'следующий босс'],
    ['horde', 'толпа'],
    ['god', 'бессмертие'],
  ]
    .map(([c, t]) => `<button data-c="${c}">${t}</button>`)
    .join('');
  const wbar = document.createElement('div');
  wbar.id = 'labw';
  wbar.hidden = true;
  wbar.innerHTML = '<div><b></b> <span></span></div><button type="button">Выйти</button>';
  wbar.querySelector('button').addEventListener('click', () => GAME.unwatch());
  document.body.append(btn, P, hud, cheat, wbar);
  for (const el of [btn, P, cheat, wbar])
    for (const k of ['pointerdown', 'touchstart', 'mousedown']) el.addEventListener(k, (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    P.hidden = !P.hidden;
    paint();
  });
  cheat.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (b) {
      GAME.cheat(b.dataset.c);
      flash(b);
    }
  });
  const flash = (b) => {
    b.style.borderColor = '#ffd23a';
    setTimeout(() => (b.style.borderColor = ''), 300);
  };

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const fmt = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const lv = (o, keys) => keys.map((k) => o[k] || 0).join('/');
  function acct() {
    const w = SAVE.wupOf(SAVE.selected),
      r = R.rank(SAVE);
    const t = D.threatOf(SAVE.meta, w),
      x = (v) => Math.round(v * 100) / 100;
    return {
      rank: r,
      gun: SAVE.selected,
      wup: lv(w, ['dmg', 'rate', 'mag']),
      meta: lv(SAVE.meta, ['hp', 'dmg', 'speed', 'magnet', 'reroll', 'start']),
      thr: [x(t.hp), x(t.boss), x(t.dmg)],
    };
  }
  function paint() {
    if (P.hidden) return;
    const a = acct(),
      log = get(LOG, []);
    P.innerHTML = `<div class="on"></div><h3>Лаборатория баланса</h3><p class="note">Отдельный прогресс только для тестов: настоящий аккаунт и рейтинг не трогаются. Выбери этап, сыграй, забеги запишутся ниже.</p>
      <div class="grid">${PRESETS.map((p) => `<button class="pre" data-p="${p.id}">${p.name}<small>${p.sub}</small></button>`).join('')}</div>
      <div class="acc">Сейчас: ранг <b>${a.rank}</b>, пушка <b>${GUN[a.gun] || a.gun}</b>, её улучшения урон/скорость/магазин <b>${a.wup}</b>,
        улучшения аккаунта здоровье/урон/скорость/магнит/перебросы/старт <b>${a.meta}</b>, монет <b>${SAVE.coins}</b>.
        Под эту прокачку зомби получают <b>×${a.thr[0]}</b> здоровья, боссы <b>×${a.thr[1]}</b>, урон по герою <b>×${a.thr[2]}</b>.</div>
      <div class="row"><button data-a="coins">+5000 монет</button><button data-a="rank-">ранг −1</button><button data-a="rank+">ранг +1</button>
        <button data-a="hud">цифры в забеге: ${opt.hud ? 'вкл' : 'выкл'}</button></div>
      <div class="row"><b>Забеги (${log.length})</b><button data-a="copy">скопировать отчёт</button><button data-a="clear">очистить</button></div>
      ${log.length ? `<div style="overflow-x:auto"><table><tr><th>аккаунт</th><th>итог</th><th>урон по минутам</th><th>боссы</th></tr>${log.slice(-40).reverse().map(row).join('')}</table></div>` : '<p class="note">Пока пусто.</p>'}`;
    paintOnline();
  }
  // ---------- who is online ----------
  let ONL = null;
  const WHERE = { lobby: 'в лобби', room: 'в комнате вдвоём', watch: 'смотрит чужой забег', base: 'на базе' };
  const where = (x) =>
    (x.s === 'run' ? `забег ${fmt(x.t)}, ур. ${x.lvl}` : x.s === 'coop' ? `вдвоём, ${fmt(x.t)}` : WHERE[x.s] || x.s) +
    (x.menu && x.s !== 'coop' ? ' (пауза или свёрнуто)' : '');
  function paintOnline() {
    btn.textContent = ONL ? `ЛАБ · онлайн ${ONL.n}` : 'ЛАБ';
    const box = P.querySelector('.on');
    if (!box || P.hidden) return;
    if (!ONL) {
      box.innerHTML = '<p class="note">Онлайн: подключаюсь к серверу…</p>';
      return;
    }
    const me = NET.id,
      rows = ONL.list
        .slice()
        .sort((a, b) => (b.s === 'run' || b.s === 'coop') - (a.s === 'run' || a.s === 'coop') || b.t - a.t);
    box.innerHTML = `<div class="row"><b>Онлайн сейчас: ${ONL.n}</b><span style="color:var(--muted)">в забеге ${ONL.play}</span></div>
      <div style="overflow-x:auto"><table><tr><th>игрок</th><th>что делает</th><th>пушка</th><th></th></tr>${rows
        .map((x) => {
          const tags = [
            x.tg ? 'Telegram' : 'сайт',
            x.acc ? 'кошелёк' : '',
            x.lab ? 'лаб' : '',
            x.old ? 'старая версия' : '',
            x.specs ? `смотрят: ${x.specs}` : '',
          ]
            .filter(Boolean)
            .map((t) => `<span class="tag">${t}</span>`)
            .join('');
          const can = x.id !== me && !x.old && (x.s === 'run' || x.s === 'coop' || x.s === 'lobby' || x.s === 'room');
          return `<tr><td class="${x.id === me ? 'me' : ''}">${esc(x.nick)}${x.id === me ? ' (ты)' : ''} <span style="color:var(--muted)">р${x.rank}</span><br>${tags}</td><td>${esc(where(x))}</td>
          <td>${esc(GUN[x.gun] || x.gun || '')}</td><td>${can ? `<button data-w="${x.id}" data-n="${esc(x.nick)}">смотреть</button>` : ''}</td></tr>`;
        })
        .join('')}</table></div>`;
  }
  if (window.NET) {
    NET.on((k, m) => {
      if (k === 'online') {
        ONL = m;
        paintOnline();
      }
    });
    NET.online(true);
  }
  // the bar over a watched run: whose, how it is going, the way back
  const WMSG = {
    wait: 'ждём, когда начнёт забег',
    load: 'загружаю забег…',
    'end:gone': 'игрок закрыл игру',
    'end:none': 'игрок уже не в сети',
    'end:big': 'забег слишком длинный для просмотра',
    'end:done': 'забег вдвоём закончился',
    err: 'не получилось показать этот забег',
  };
  function paintWatch(WT) {
    const S = GAME.play,
      W = WT.W,
      R = GAME.run;
    let t = WMSG[WT.msg] || '';
    if (!t && S && R && R.watch) {
      if (S.over)
        t = `забег окончен: ${S.over.win ? 'победа' : 'смерть'} на ${fmt(S.over.t)}, ур. ${S.p.lvl}. Ждём следующий`;
      else if (W.err) t = 'забег разошёлся с игроком, показ остановлен';
      else if (W.catch) t = `догоняю: ${fmt(S.t)}, до прямого эфира ${Math.ceil(W.behind / 120)} с`;
      else if (W.wait > 1.5) t = `${fmt(S.t)} · ждём игрока (пауза, свёрнуто или связь)`;
      else t = `в прямом эфире · ${fmt(S.t)} · ур. ${S.p.lvl} · здоровье ${Math.ceil(S.p.hp)}/${S.p.maxHp}`;
    }
    const b = wbar.querySelector('b'),
      sp = wbar.querySelector('span'),
      who = 'Смотришь: ' + WT.nick;
    if (b.textContent !== who) b.textContent = who;
    if (sp.textContent !== t) sp.textContent = t;
  }
  function row(e) {
    const mx = Math.max(0.5, ...e.dmg),
      bars = e.dmg
        .map(
          (v, i) =>
            `<i title="${i + 1}-я минута: ${Math.round(v * 100)}% здоровья" style="height:${Math.max(1, Math.round((v / mx) * 18))}px"></i>`,
        )
        .join('');
    const bosses = Object.entries(e.bosses)
      .map(([k, b]) => `${esc(NAME[k] || k)} ${b.ttk !== null ? Math.round(b.ttk) + ' с' : '—'}`)
      .join(', ');
    return `<tr><td>р${e.a.rank} ${esc(GUN[e.a.gun] || e.a.gun)} ${esc(e.a.wup)}<br><span style="color:var(--muted)">акк ${esc(e.a.meta)}${e.a.thr ? ' · зомби ×' + esc(e.a.thr[0]) : ''}</span></td>
      <td class="${e.win ? 'win' : 'dead'}">${e.win ? 'победа ' + fmt(e.t) : 'смерть ' + fmt(e.t)}<br><span style="color:var(--muted)">${e.win ? '' : esc(e.cause) + ', '}ур. ${e.lvl}</span></td>
      <td><span class="dm">${bars}</span></td><td>${bosses || '—'}</td></tr>`;
  }
  P.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]');
    if (p) {
      apply(PRESETS.find((x) => x.id === p.dataset.p));
      return;
    }
    const w = e.target.closest('[data-w]');
    if (w) {
      if (GAME.watch(+w.dataset.w, w.dataset.n)) P.hidden = true;
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'coins') {
      SAVE.coins += 5000;
      set(SAVE.data());
    }
    if (a === 'rank+' || a === 'rank-') {
      const r = Math.max(1, Math.min(D.RANK_MAX, R.rank(SAVE) + (a === 'rank+' ? 1 : -1)));
      const s = SAVE.data();
      s.rxp = rxpOf(r);
      set(s);
    }
    if (a === 'hud') {
      opt.hud = !opt.hud;
      put(OPT, opt);
      paint();
    }
    if (a === 'clear') {
      put(LOG, []);
      paint();
    }
    if (a === 'copy') {
      const text = get(LOG, [])
        .map((e) => JSON.stringify(e))
        .join('\n');
      const done = () => {
        b.textContent = 'скопировано';
        setTimeout(paint, 1200);
      };
      const fall = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch (er) {}
        ta.remove();
        done();
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fall);
      else fall();
    }
  });

  // ---------- a run: its numbers as it goes, its record when it ends ----------
  let cur = null;
  const gd = (dx, dy) => Math.hypot(dx, dy * SIM.YK);
  function causeAt(S) {
    const p = S.p;
    let best = null,
      bd = 1e9;
    for (const e of S.en) {
      if (e.dead) continue;
      const d = gd(p.x - e.x, p.y - e.y) - e.r;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best && bd < 40) return (best.elite ? 'элитный ' : '') + (NAME[best.k] || best.k);
    const boss = S.en.find((e) => !e.dead && D.ENEMIES[e.k].boss);
    if (boss) return 'атака: ' + (NAME[boss.k] || boss.k);
    return S.pud.some((q) => gd(p.x - q.x, p.y - q.y) < q.r) ? 'лужа' : 'взрыв';
  }
  function tick() {
    const S = GAME.play,
      menus = !S || GAME.menu || (S && S.over),
      WT = GAME.watching;
    wbar.hidden = !WT;
    if (WT) paintWatch(WT);
    btn.hidden = !menus || !!WT;
    if (!menus || WT) P.hidden = true;
    cheat.hidden = !(S && GAME.menu && !S.over) || !!WT;
    if (!S || WT) {
      cur = null;
      hud.hidden = true;
      return;
    } // (a watched run: not this lab's to log)
    if (!cur || cur.S !== S) cur = { S, a: acct(), dmg: [], seen: new WeakSet(), last: [], bosses: {}, done: false };
    for (const v of S.ev)
      if ((v.k === 'hurt' || v.k === 'gas') && !cur.seen.has(v)) {
        cur.seen.add(v);
        const m = Math.floor(v.t / 60);
        while (cur.dmg.length <= m) cur.dmg.push(0);
        cur.dmg[m] += v.v / S.p.maxHp;
        cur.last.push([v.t, v.v]);
        cur.cause = v.k === 'gas' ? 'газ' : causeAt(S);
      } // (the lab's gas)
    for (const e of S.en)
      if (D.ENEMIES[e.k].boss) {
        const b = cur.bosses[e.k] || (cur.bosses[e.k] = { at: S.t, ttk: null });
        if (e.dead && b.ttk === null) b.ttk = S.t - b.at;
      }
    for (const k in cur.bosses) {
      const b = cur.bosses[k];
      if (b.ttk === null && !S.en.some((e) => e.k === k && !e.dead)) b.ttk = S.t - b.at;
    }
    cur.last = cur.last.filter((x) => S.t - x[0] < 60);
    if (opt.hud && !S.over) {
      const lm = cur.last.reduce((s, x) => s + x[1], 0) / S.p.maxHp;
      hud.textContent = `${fmt(S.t)}  здоровье ${Math.ceil(S.p.hp)}/${S.p.maxHp}  урон за минуту ${Math.round(lm * 100)}%  зомби ${S.en.length}  ур. ${S.p.lvl}${S.p.god ? '  БЕССМЕРТИЕ' : ''}\nF1 уровень · F2 +1 мин · F3 бессмертие · F4 толпа · F5 босс`;
      hud.hidden = false;
    } else hud.hidden = true;
    if (S.over && !cur.done) {
      cur.done = true;
      const o = S.over,
        log = get(LOG, []);
      log.push({
        at: new Date().toISOString().slice(0, 16),
        a: cur.a,
        win: !!o.win,
        t: Math.round(o.t),
        cause: o.win ? null : cur.cause || '?',
        lvl: o.lvl,
        kills: o.kills,
        dmg: cur.dmg.map((v) => Math.round(v * 100) / 100),
        bosses: Object.fromEntries(
          Object.entries(cur.bosses).map(([k, b]) => [
            k,
            { at: Math.round(b.at), ttk: b.ttk === null ? null : Math.round(b.ttk) },
          ]),
        ),
        items: S.p.items.map((i) => i.id + i.lvl + (i.evo ? '*' : '')),
        god: !!S.p.god,
      });
      put(LOG, log.slice(-200));
    }
  }
  setInterval(tick, 200);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !GAME.play) {
      P.hidden = !P.hidden;
      paint();
    }
  });
})();
