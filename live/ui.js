// live/ui.js — DOM screens: lobby (main, arsenal, upgrades, heroes, roadmap; the campaign map is live/campaign.js), weapon select, and the in-run overlays
// (level-up cards, chest, pause, results). Reads SIM state, never steps it; choices go through GAME.
(function () {
  const U = (window.UI = {}),
    D = DATA,
    root = () => document.getElementById('ui');
  // the build's stamp (a new icon is fetched anew), or the picture's own (assets.js v: one redrawn since, its old copy cached for a year)
  const A = (n) => `assets/${n}.png?v=${(window.ASSETS && ASSETS[n] && ASSETS[n].v) || window.__V || 0}`;
  const has = (n) => !!(window.ASSETS && ASSETS[n]);
  const src = (n) => (has(n) ? A(n) : null);
  const img = (n, cls = '', alt = '') => {
    const s = src(n);
    return s
      ? `<img class="${cls}" src="${s}" alt="${alt}" draggable="false">`
      : `<span class="${cls}" style="font-size:42px">${alt || '❔'}</span>`;
  };
  const coin = () => img('pk_coin', '', '🪙');
  const T = (k, v) => I18N.t(k, v),
    fmtN = (n) => I18N.num(n); // every word on screen comes from the language pack
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); // text from outside the game
  let curKey = '';
  // repaint: the page up redraws its numbers in place (the account's progress changed: the server answered); noteRun: the results
  // screen takes a run's verdict; runResults: the verdicts that came before their screen
  let repaint = null,
    noteRun = null;
  const runResults = {};
  U.opaque = false;

  function show(html, cls = '') {
    U.live = false; // only the main lobby shows the live menu scene
    repaint = noteRun = null;
    const r = root();
    const olds = [...r.querySelectorAll('.scr:not(.gone)')]; // every screen still up, even one not yet faded in
    const el = document.createElement('div');
    el.className = 'scr ' + cls;
    el.innerHTML = html;
    // its hidden state laid out by the next frame first, so it fades in (not pops); no layout forced here (a card screen opening
    // mid-run: the frame it opens on would wait for the whole page's layout) — a card screen is sized to the window (fit) the frame after
    r.appendChild(el);
    requestAnimationFrame(() => {
      fit(el);
      requestAnimationFrame(() => {
        if (!el.classList.contains('gone')) el.classList.add('on');
      });
    });
    for (const old of olds) {
      old.classList.remove('on');
      old.classList.add('gone');
      setTimeout(() => old.remove(), 300);
    } // it keeps its id (its styles) as it fades: look screens up with :not(.gone)
    return el;
  }
  // the run's card screens (level-up, a chest or an airdrop, the pause menu: their content in .fit) fit the window whole and never
  // scroll: laid out at their own size, the cards side by side (a chest's four and more also tried in two rows: whichever comes out
  // bigger), then shrunk to the window (CSS zoom) when it is smaller. A phone held sideways, Telegram's window less its strip for
  // Telegram's buttons (an iPhone: 738 × 393) had the third card wrap below the edge, and a chest's Take button with it: only
  // scrolling reached them. Done before the screen fades in (show), and again when the window changes size
  function fit(el) {
    const box = el && el.querySelector('.ov > .fit');
    if (!box) return;
    const ov = box.parentElement,
      row = box.querySelector('.cards'),
      n = row ? row.children.length : 0;
    const zoomFor = (cols) => {
      if (row) {
        row.style.width = '';
        row.style.flexWrap = cols < n ? 'wrap' : '';
        if (cols < n) {
          const g = parseFloat(getComputedStyle(row).columnGap) || 0;
          row.style.width = cols * row.children[0].offsetWidth + (cols - 1) * g + 1 + 'px';
        }
      }
      box.style.zoom = '';
      const pad = 12; // (offset sizes: the screen's fade-in scale doesn't count)
      return Math.min(1, (ov.clientWidth - pad * 2) / box.offsetWidth, (ov.clientHeight - pad * 2) / box.offsetHeight);
    };
    let k = zoomFor(n);
    if (n > 3) {
      const k2 = zoomFor(Math.ceil(n / 2));
      if (k2 <= k) k = zoomFor(n);
      else k = k2;
    }
    box.style.zoom = k < 0.995 ? k.toFixed(3) : '';
    ov.style.overflow = 'visible'; // (it fits: no scrolling, and the title's glow isn't cut at the top)
  }
  U.refit = () => document.querySelectorAll('#ui > .scr:not(.gone)').forEach(fit); // (also when the safe area changes: index.html)
  addEventListener('resize', U.refit);
  U.hide = () => {
    U.live = false;
    const r = root();
    r.querySelectorAll('.scr').forEach((e) => {
      e.classList.remove('on');
      e.classList.add('gone');
      setTimeout(() => e.remove(), 300);
    });
    curKey = '';
    U.opaque = false;
  }; // gone: a second click on a fading PLAY / Again starts nothing
  const on = (el, sel, fn) =>
    el.querySelectorAll(sel).forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn(b, e);
      }),
    );
  // the run's card screens: a click, or a touch let go on the button it pressed (a phone sends no click for a tap made while another
  // thumb still holds a stick); the click that may follow such a touch is not a second press
  const tap = (el, sel, fn) =>
    el.querySelectorAll(sel).forEach((b) => {
      let down = -1,
        done = 0;
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') down = e.pointerId;
      });
      b.addEventListener('pointercancel', () => {
        down = -1;
      });
      b.addEventListener('pointerup', (e) => {
        if (e.pointerId !== down) return;
        down = -1;
        const r = b.getBoundingClientRect();
        if (b.disabled || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          return;
        done = performance.now();
        e.stopPropagation();
        fn(b, e);
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (performance.now() - done > 600) fn(b, e);
      });
    });
  const topbar = (title, back = true) =>
    `<div class="top">${back ? `<button class="btn ghost back" data-go="lobby">${T('common.backArrow')}</button>` : '<span></span>'}<h2>${title}</h2><div class="panel coins">${coin()}<span>${fmtN(SAVE.coins)}</span></div></div>`;
  const FSI =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><g class="en"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></g><g class="ex"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></g></svg>';
  const fsBtn = () =>
    GAME.canFullscreen ? `<button class="btn ghost fs" data-fs title="${T('common.fullscreen')}">${FSI}</button>` : '';
  const wire = (el) => {
    on(el, '[data-go]', (b) => go(b.dataset.go));
    on(el, '[data-fs]', () => GAME.fullscreen());
  };
  function go(where) {
    ({
      lobby: U.lobby,
      arsenal,
      upgrades,
      maps: () => U.campaign(),
      heroes,
      roadmap,
      board,
      select,
      coop: () => U.coop(),
    })[where]();
  }

  // ---------------- main lobby (the bunker, after the user's mockup art/refs/lobby_bunker_ref.png; the scene behind it is live: lobby.js):
  // the player top left, the wallet, full screen and gold top right; a card on the left — the chapter, the location with its map (the
  // level seen from above, lob_map), the weapon, PLAY; under it the arsenal and the upgrades, bottom right the settings and the ranking
  // ----------------
  const ICO = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-7.4 7-12a7 7 0 1 0-14 0c0 4.6 7 12 7 12z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#141c33"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M6 3.5l15 8.5-15 8.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l3 2.2h3.6v3.6L21 12l-2.4 3.2v3.6H15L12 21l-3-2.2H5.4v-3.6L3 12l2.4-3.2V5.2H9z"/><path d="M12 16V8.5M8.8 11.5L12 8.3l3.2 3.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M10.3 2.5h3.4l.6 2.7 2 .9 2.4-1.5 2.4 2.4-1.5 2.4.9 2 2.7.6v3.4l-2.7.6-.9 2 1.5 2.4-2.4 2.4-2.4-1.5-2 .9-.6 2.7h-3.4l-.6-2.7-2-.9-2.4 1.5-2.4-2.4 1.5-2.4-.9-2-2.7-.6v-3.4l2.7-.6.9-2-1.5-2.4 2.4-2.4 2.4 1.5 2-.9z"/><circle cx="12" cy="12" r="3.3"/></svg>',
    cup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h10v6a5 5 0 0 1-10 0z"/><path d="M7 5.5H3.5v1.5a3.5 3.5 0 0 0 3.8 3.5M17 5.5h3.5v1.5a3.5 3.5 0 0 1-3.8 3.5"/><path d="M12 14.5v3.5M8 21h8M9 18h6"/></svg>',
    chest:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3.5 10.5h17V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 10.5V8A3.5 3.5 0 0 1 7 4.5h10A3.5 3.5 0 0 1 20.5 8v2.5"/><path d="M3.5 14h17"/><rect x="10" y="12" width="4" height="4" rx=".6"/><path d="M7.5 4.5v6M16.5 4.5v6"/></svg>',
    two: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8.5" cy="7.5" r="3.6"/><path d="M1.8 20.5c0-4 3-6.8 6.7-6.8s6.7 2.8 6.7 6.8z"/><circle cx="16.8" cy="8.3" r="3" opacity=".8"/><path d="M16.3 13.3c3.4 0 5.9 2.6 5.9 6.2v1h-5.4c0-2.9-.9-5.3-2.6-6.8.6-.3 1.3-.4 2.1-.4z" opacity=".8"/></svg>',
  };
  // a cog drawn as art (the upgrades button's corner): n teeth round a ring, a hole in the middle, brushed metal
  const GEAR = (() => {
    const n = 10,
      p = [];
    for (let i = 0; i < n; i++)
      for (const [r, k] of [
        [46, 0],
        [46, 0.3],
        [36, 0.45],
        [36, 0.85],
        [46, 1],
      ]) {
        const a = ((i + k * 0.999) / n) * Math.PI * 2;
        p.push((50 + r * Math.cos(a)).toFixed(1) + ' ' + (50 + r * Math.sin(a)).toFixed(1));
      }
    return (
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="lbgm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9ccd0"/><stop offset=".5" stop-color="#80858c"/><stop offset="1" stop-color="#43474d"/></linearGradient></defs>' +
      '<path fill="url(#lbgm)" fill-rule="evenodd" stroke="#16181b" stroke-width="2" d="M' +
      p.join(' L') +
      ' Z M50 35 A15 15 0 1 0 50.01 35 Z"/><circle cx="50" cy="50" r="24" fill="none" stroke="#ffffff22" stroke-width="2"/></svg>'
    );
  })();
  // the location's map: the route there, dashed, and the pin where it ends (over lob_map)
  const ROUTE =
    '<svg class="route" viewBox="0 0 100 37" preserveAspectRatio="none"><path d="M6 31 C18 29 24 24 34 23 S52 25 60 21 S70 16 76 15"/></svg>';
  // the map a run goes to: the one picked on the world map (kept in this browser), else the town; the lobby's card shows it
  const MAPK = 'zh.map',
    LOBMAP = { suburb: 'lob_map', lab: 'lob_map_lab' };
  U.mapId = () => {
    let m = null;
    try {
      m = localStorage.getItem(MAPK);
    } catch (e) {}
    return D.MAPS.some((q) => q.id === m && q.open) ? m : 'suburb';
  };
  const setMap = (id) => {
    try {
      localStorage.setItem(MAPK, id);
    } catch (e) {}
  };
  // a word as a title: its first letter kept, the rest small (the packs keep the menu's words in capitals)
  const titled = (t) => t.charAt(0) + t.slice(1).toLocaleLowerCase(I18N.lang);
  U.lobby = () => {
    if (window.GUNMESH && D.GUN3D[SAVE.selected]) GUNMESH.load([SAVE.selected]).catch(() => {}); // a gun chosen since the start
    const w = SAVE.selected,
      s = SAVE.stats,
      loc = D.MAPS.find((m) => m.id === U.mapId()) || D.MAPS[0],
      // while PLAY means mission 1 (its handler below), the card shows its office, not the map picked
      first = RULES.current(SAVE) === 'office',
      best = s.fast || 0,
      R = D.rankOf(SAVE.rxp); // the record: the fastest win
    U.opaque = false;
    const el = show(
      `
      <div class="lb">
        <div class="lbp pl" data-go="heroes" title="${T('lobby.heroes')}">${avatar()}
          <div class="who"><div class="nmr"><div class="nm">${esc(SAVE.nick || T('lobby.hero'))}</div><button class="nickb" data-nick title="${T('lobby.rename')}">${PENCIL}</button></div><div class="sub"><span class="rk">${T('lobby.rank', { r: R.r })}</span><div class="xp"><i style="width:${R.need ? ((R.into / R.need) * 100).toFixed(0) : 100}%"></i></div><span>${T('lobby.best', { t: best ? fmt(best) : '—' })}</span></div></div></div>
        <div class="card">
          <div class="chh" data-go="roadmap"><span>${T('lobby.chapter')}</span></div>
          <div class="loc" data-go="maps"><span class="ic">${ICO.pin}</span><span class="tx">${first ? T('mission.office.name') : loc.name}</span></div>
          <div class="lmap" data-go="maps">${first ? `<img src="assets/bg_mis_office.jpg?v=${window.__V || 0}" alt="" draggable="false">` : `<img src="${A(LOBMAP[loc.id] || 'lob_map')}" alt="" draggable="false">${ROUTE}<span class="rpin">${ICO.pin}</span>`}</div>
          <div class="wlab">${T('lobby.weapon')}</div>
          <div class="wsel" data-go="select"><span class="wbox">${img('i_' + w, 'wi', '')}</span><span class="tx">${D.MAIN[w].name}</span><span class="dn">${ICO.down}</span></div>
          <button class="cta" data-play><span class="pi">${ICO.play}</span><span>${T('common.play')}</span></button>
        </div>
        <div class="mb">
          <button class="lbp big" data-go="arsenal"><span class="ic">${ICO.chest}</span><span class="tx">${titled(T('lobby.arsenal'))}</span>${img('iso_metalcrate', 'art', '')}</button>
          <button class="lbp big" data-go="upgrades"><span class="ic">${ICO.up}</span><span class="tx">${titled(T('lobby.upgrades'))}</span><span class="art gear">${GEAR}</span></button>
        </div>
        ${window.NET ? `<button class="lbp mco" data-go="coop"><span class="ic">${ICO.two}</span><span class="tx"><b>${titled(T('coop.btn'))}</b><small>${T('coop.btnSub')}</small></span></button>` : ''}
        <div class="mr">
          <button class="lbp sm" data-set><span class="ic">${ICO.gear}</span><span>${titled(T('lobby.settings'))}</span></button>
          <button class="lbp sm" data-go="board"><span class="ic">${ICO.cup}</span><span>${titled(T('lobby.board'))}</span></button>
        </div>
        <div class="tr">${walletChip()}${fsBtn()}<div class="lbp coin">${coin()}<span>${fmtN(SAVE.coins)}</span></div></div>
        <div class="setp"><div class="lbp box"><h3>${T('settings.title')}</h3>
          <label><span>${T('settings.sound')}</span><button class="tg" data-tg="snd"></button></label>
          ${GAME.canFullscreen ? `<label><span>${T('settings.fullscreen')}</span><button class="tg" data-tg="fs"></button></label>` : ''}
          <div class="lng"><span>${T('settings.language')}</span><div class="lgs">${I18N.list.map((c) => `<button class="lg ${c === I18N.lang ? 'on' : ''}" data-lang="${c}" lang="${I18N.raw('lang.html', c)}">${I18N.raw('lang.name', c)}</button>`).join('')}</div></div>
          <p class="hint">${T('settings.hint')}</p><button class="btn" data-close>${T('settings.done')}</button></div></div>
        <div class="setp walp"><div class="lbp box"><h3>${T('wallet.title')}</h3><div class="wacc"></div><div class="wst"></div>
          <button class="btn" data-wdis>${T('wallet.disconnect')}</button><button class="btn" data-wclose>${T('settings.done')}</button></div></div>
      </div>`,
      'lobbyScr',
    );
    el.id = 'lobby';
    U.live = true;
    U.scene = 'main';
    wire(el);
    // PLAY: in the first session (docs/design.md, "Player path") mission 1, as the campaign plays it (the intro the
    // first time, then its script), until it is won; from then on a classic run on the map picked
    on(el, '[data-play]', () => {
      const m = RULES.current(SAVE) === 'office' && window.ECONOMY && ECONOMY.mission('office');
      if (!m) return startRun(SAVE.selected);
      const go = () => {
        setMap(m.map);
        startRun(SAVE.selected, 'office');
      };
      if (window.INTRO && INTRO.due()) INTRO.play(go);
      else go();
    });
    const setp = el.querySelector('.setp'),
      sync = () => {
        const st = {
          snd: !!(window.AUDIO && AUDIO.on),
          fs: !!(document.fullscreenElement || document.webkitFullscreenElement),
        };
        el.querySelectorAll('[data-tg]').forEach((b) => b.classList.toggle('on', st[b.dataset.tg]));
      };
    on(el, '[data-set]', () => {
      sync();
      setp.classList.add('open');
    });
    on(el, '[data-close]', () => setp.classList.remove('open'));
    setp.addEventListener('click', (e) => {
      if (e.target === setp) setp.classList.remove('open');
    });
    on(el, '[data-tg]', (b) => {
      const k = b.dataset.tg;
      if (k === 'snd' && window.AUDIO) AUDIO.toggle();
      if (k === 'fs') GAME.fullscreen();
      setTimeout(sync, 120);
    });
    // a new language: kept, then the page reloads (the comic words over blasts are baked into textures at load) back into these settings
    on(el, '[data-lang]', (b) => {
      const c = b.dataset.lang;
      SAVE.act({ k: 'lang', v: c });
      if (c === I18N.lang) return; // kept even when it is the detected one
      let kept = false;
      try {
        localStorage.setItem('zh-probe', '1');
        localStorage.removeItem('zh-probe');
        kept = true;
      } catch (e) {}
      if (!kept) {
        I18N.set(c);
        U.lobby();
        return;
      } // storage blocked: a reload would lose this visit's progress, so the words change in place
      try {
        sessionStorage.setItem('zh-settings', '1');
      } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.delete('lang');
      u.searchParams.delete('autoplay');
      location.replace(u.href);
    }); // (a ?lang would win over the pick)
    let reopen = false;
    try {
      reopen = sessionStorage.getItem('zh-settings') === '1';
      sessionStorage.removeItem('zh-settings');
    } catch (e) {}
    if (reopen) {
      sync();
      setp.classList.add('open');
    }
    // the name: the pencil makes it a field — Enter or leaving it keeps a name the rules take (rules.js nick), Esc puts the old one back
    el.querySelector('[data-nick]').addEventListener('click', (e) => {
      e.stopPropagation();
      editNick(el);
    });
    // the wallet: not connected — connect; connected — its panel (where the progress is kept, the last save, disconnect)
    const walp = el.querySelector('.walp');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-wal]');
      if (!b || !window.WALLET) return;
      e.stopPropagation();
      if (WALLET.account) {
        paintWallet(el);
        walp.classList.add('open');
      } else WALLET.connect();
    });
    on(el, '[data-wdis]', () => {
      walp.classList.remove('open');
      WALLET.disconnect();
    });
    on(el, '[data-wclose]', () => walp.classList.remove('open'));
    walp.addEventListener('click', (e) => {
      if (e.target === walp) walp.classList.remove('open');
    });
  };
  // mission: the campaign mission the run plays (campaign.js PLAY; none: a classic run), kept for GAME.start and its
  // restarts. PLAY plays at once, as a guest or with the wallet connected: nothing asks for a wallet before a run
  // (docs/design.md, "Player path" 1; the offer comes after the first sale to Walt: walt.js)
  U.mission = null;
  function startRun(id, mission) {
    U.mission = mission || null;
    GAME.start(id);
  }
  // the player's face: the avatar dealt (DATA.AVATARS) on the background dealt (DATA.AVATAR_BG); until it is dealt (an account's, the
  // server not heard from yet) the cat
  const PENCIL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  function avatar() {
    const av = D.AVATARS[SAVE.ava],
      bg = D.AVATAR_BG[SAVE.bg];
    return av
      ? `<div class="ava has" style="--av0:${bg ? bg[0] : '#ffb35a'};--av1:${bg ? bg[1] : '#a8461c'}">${img(av.id, 'av', '')}</div>`
      : `<div class="ava">${img('av_3', 'av', '')}</div>`;
  }
  function editNick(el) {
    const row = el.querySelector('.nmr'),
      nm = row && row.querySelector('.nm');
    if (!nm) return;
    const inp = document.createElement('input');
    Object.assign(inp, {
      className: 'nicki',
      maxLength: 24,
      value: SAVE.nick || '',
      spellcheck: false,
      autocomplete: 'off',
    });
    nm.replaceWith(inp);
    row.classList.add('edit');
    inp.focus();
    inp.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const v = keep && RULES.nick(inp.value);
      if (v && v !== SAVE.nick) SAVE.act({ k: 'nick', v });
      const d = document.createElement('div');
      d.className = 'nm';
      d.textContent = SAVE.nick || T('lobby.hero');
      inp.replaceWith(d);
      row.classList.remove('edit');
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    }); // (the game's keys stay out of it)
    inp.addEventListener('input', () => inp.classList.toggle('bad', !RULES.nick(inp.value)));
    inp.addEventListener('blur', () => finish(true));
    for (const k of ['click', 'pointerdown']) inp.addEventListener(k, (e) => e.stopPropagation()); // (not the panel's way to the heroes)
  }
  // the wallet's chip in the lobby's top right (wallet.js): the account and a dot for the last save, or the button to connect
  const WICO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="3.5" y="7.5" width="17.5" height="12" rx="2.5"/><path d="M21 11.5h-4a2 2 0 0 0 0 4h4z"/></svg>';
  const shortAcc = (a) => (a.length > 22 ? a.slice(0, 8) + '…' + a.slice(-6) : a);
  const walletState = () => {
    const W = window.WALLET;
    if (!W || !W.account) return '';
    return W.sync === 'saving'
      ? T('wallet.saving')
      : W.sync === 'saved'
        ? T('wallet.saved', {
            t: new Date(W.at).toLocaleTimeString(I18N.raw('lang.locale') || undefined, {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })
        : W.sync === 'error'
          ? T(W.error === 'offline' ? 'wallet.offline' : 'wallet.err')
          : '';
  };
  function walletChip() {
    const W = window.WALLET;
    if (!W || !W.available) return '';
    if (W.account)
      return `<button class="lbp wal on" data-wal title="${T('wallet.title')}: ${esc(W.account)}"><span class="ic">${WICO}</span><span class="tx">${esc(shortAcc(W.account))}</span><i class="dot ${W.sync}"></i></button>`;
    const err = W.error ? (W.error === 'expired' ? T('wallet.expired') : esc(T('wallet.fail', { e: W.error }))) : '';
    return `<button class="lbp wal ${W.state === 'connecting' ? 'busy' : ''}" data-wal><span class="ic">${WICO}</span><span class="tx">${T(W.state === 'connecting' ? 'wallet.connecting' : 'wallet.connect')}</span>${err ? `<span class="werr">${err}</span>` : ''}</button>`;
  }
  function paintWallet(el) {
    const W = window.WALLET;
    el.querySelector('.walp .wacc').textContent = W.account || '';
    el.querySelector('.walp .wst').textContent = walletState();
  }
  if (window.WALLET)
    WALLET.on((kind, x) => {
      if (kind === 'run') {
        runResults[x.id] = x;
        if (noteRun) noteRun(x);
        return;
      }
      if (kind === 'refused') {
        toast(T('wallet.refused'));
        return;
      }
      if (kind === 'save' && repaint) {
        repaint();
        return;
      } // the arsenal / upgrades: their numbers in place
      const el = document.querySelector('#lobby:not(.gone)');
      if (!el || !el.classList.contains('on') || (window.GAME && GAME.play)) return;
      if (kind === 'profile' || (kind === 'save' && !el.querySelector('.setp.open'))) {
        U.lobby();
        return;
      } // another account, or new numbers: the lobby anew
      const c = el.querySelector('.wal'),
        h = walletChip();
      if (c) c.outerHTML = h;
      else if (h) el.querySelector('.tr').insertAdjacentHTML('afterbegin', h);
      paintWallet(el);
    });
  // a line of news at the bottom of the screen for a few seconds
  const toast = (U.toast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    root().appendChild(t);
    setTimeout(() => t.remove(), 3200);
  });
  const fmt = (t) => {
    t = Math.floor(t || 0);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  };

  // ---------------- weapon select before a run ----------------
  function select() {
    U.opaque = false;
    const owned = D.MAIN_ORDER.filter((id) => SAVE.owned[id] && !D.MAIN[id].locked);
    const el = show(
      `${topbar(T('select.title'))}
      <div class="body scroll"><div class="grid">${owned
        .map((id) => {
          const d = D.MAIN[id],
            u = SAVE.wupOf(id);
          return `<div class="panel card ${SAVE.selected === id ? 'sel' : ''}" data-w="${id}"><div class="ic">${img('i_' + id)}</div><div class="nm">${d.name}</div><div class="ds">${d.desc}</div>
          <div class="uprow"><span>${T('stats.dmg')}</span><span class="pips">${pips(u.dmg, 5)}</span></div><div class="uprow"><span>${T('stats.rate')}</span><span class="pips">${pips(u.rate, 5)}</span></div>
          <div class="uprow"><span>${T('stats.mag')}</span><span class="pips">${pips(u.mag || 0, 5)}</span></div>
          <button class="btn ${SAVE.selected === id ? 'orange' : ''}" data-start="${id}">${SAVE.selected === id ? T('select.go') : T('select.take')}</button></div>`;
        })
        .join('')}</div>
      <p class="hint" style="text-align:center;margin-top:18px">${T('select.hint')}</p></div>`,
      'sub',
    );
    wire(el);
    on(el, '[data-start]', (b) => {
      const id = b.dataset.start;
      if (SAVE.selected !== id) {
        SAVE.act({ k: 'sel', id });
        select();
        return;
      }
      startRun(id);
    });
  }
  const pips = (n, m) => Array.from({ length: m }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');

  // ---------------- the menu pages: arsenal, upgrades, world map (after art/refs/arsenal_ref, upgrades_ref, map_ref; the lobby's look) ---------
  // The arsenal and upgrades pages float over the rooftop scene blurred (lobby.js pageScene), which also draws the cat standing on
  // the upgrades page and the chosen gun turning in the arsenal's panel; the world map lies over a dark city map. Each page is built
  // once and repainted in place on a click (no screen fade).
  const head = (
    title,
  ) => `<button class="lbp back" data-go="lobby"><span class="ic">${HICO.back}</span>${T('common.back')}</button><h2 class="ttl">${title}</h2>
    <div class="tr"><div class="lbp coin">${coin()}<span class="cn">${fmtN(SAVE.coins)}</span></div></div>`;
  const priceBtn = (P, attr) =>
    `<button class="pbtn" ${attr} ${SAVE.coins < P ? 'disabled' : ''}>${coin()}<b>${fmtN(P)}</b></button>`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const page = (id, scene, body) => {
    const el = show(`<div class="pg">${body}</div>`, 'pageScr');
    el.id = id;
    U.live = !!scene;
    U.scene = scene || '';
    U.opaque = !scene;
    wire(el);
    return el;
  };
  const MICO = {
    lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10" width="15" height="11" rx="2.5" fill="currentColor"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="15.5" r="1.7" fill="#1b2130"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.3L21 9l-5 4.4 1.6 6.6L12 16.6 6.4 20l1.6-6.6L3 9l6.6-.7z" fill="currentColor"/></svg>',
    bullet:
      '<svg viewBox="0 0 24 24"><path d="M9 9.5C9 5.5 12 2 12 2s3 3.5 3 7.5V20H9z" fill="currentColor"/><rect x="8" y="20" width="8" height="2.5" rx="1" fill="currentColor"/></svg>',
    mag: '<svg viewBox="0 0 24 24"><path d="M8.5 6h7l1.6 13.4a2 2 0 0 1-2 2.3H9.9a2 2 0 0 1-2-1.8z" fill="currentColor"/><path d="M10 1.8h4l.6 3.2H9.4z" fill="currentColor"/><rect x="9.6" y="10" width="5.6" height="1.6" rx=".8" fill="#1b2130"/><rect x="9.9" y="14" width="5.6" height="1.6" rx=".8" fill="#1b2130"/></svg>',
  };

  // ---------------- arsenal: the guns in a grid, the one in view in a panel with its stats, upgrades and the primary button ----------------
  // A gun not yet bought waits for its rank (the lock and the rank on its card), then for its price; a gun owned shows its mastery, and
  // each of its upgrades waits for the mastery level it needs.
  let arsView = null;
  const rank = () => D.rankOf(SAVE.rxp).r,
    mlv = (id) => D.masteryOf(SAVE.mast[id] || 0);
  const mbar = (id) => {
    const k = SAVE.mast[id] || 0,
      l = D.masteryOf(k),
      a = D.MASTERY[l - 1],
      b = D.MASTERY[l];
    return { l, k, b, w: b ? Math.min(100, ((k - a) / (b - a)) * 100) : 100 };
  };
  const SECRET = ['i_railgun', 'i_tesla'];
  function arsenal() {
    // the arsenal turns each gun in 3D: every mesh loads when it opens (behind the lobby only the owned ones did, index.html)
    if (window.GUNMESH) GUNMESH.load(Object.keys(D.GUN3D)).catch(() => {});
    const el = page('ars', 'arsenal', `${head(T('arsenal.title'))}<div class="agrid"></div><div class="adet"></div>`);
    const grid = el.querySelector('.agrid'),
      det = el.querySelector('.adet');
    const paint = () => {
      const sel = SAVE.selected,
        view = arsView && D.MAIN[arsView] ? arsView : sel;
      grid.innerHTML =
        D.MAIN_ORDER.map((id) => {
          const d = D.MAIN[id],
            own = SAVE.owned[id],
            lk = d.locked,
            rl = !own && !lk && rank() < d.rank;
          const foot = lk
            ? `<div class="asub">${T('common.soon')}</div><div class="alock">${MICO.lock}${coin()}<b>${fmtN(d.price)}</b></div>`
            : own
              ? `<span class="pips">${pips(mlv(id), 5)}</span>`
              : rl
                ? `<div class="alock rk">${MICO.lock}<b>${T('lobby.rank', { r: d.rank })}</b></div>`
                : `<div class="alock">${MICO.lock}${coin()}<b>${fmtN(d.price)}</b></div>`;
          return `<div class="acard ${id === sel ? 'prim' : ''} ${id === view ? 'view' : ''} ${lk ? 'locked' : ''} ${rl ? 'rlock' : ''}" data-v="${id}">${id === sel ? `<i class="chk">${HICO.check}</i>` : ''}
          <div class="aic">${img('i_' + id)}</div><div class="anm">${d.name}</div>${foot}</div>`;
        }).join('') +
        SECRET.map(
          (n) =>
            `<div class="acard locked secret"><div class="aic">${img(n)}</div><div class="anm">???</div><div class="asub">${T('common.soon')}</div></div>`,
        ).join('');
      const d = D.MAIN[view],
        own = SAVE.owned[view],
        lk = d.locked,
        rl = !own && !lk && rank() < d.rank,
        u = SAVE.wupOf(view),
        W = D.WEAPON_UP,
        M = mbar(view);
      const dm = d.dmg * (1 + W.dmg.per * u.dmg),
        rt = (d.rate || 0) * (1 + W.rate.per * u.rate),
        r1 = (v) => I18N.dec(v),
        ps = (v) => T('common.perSec', { v: r1(v) });
      const dmg = d.pellets ? `${r1(dm)} × ${d.pellets}` : d.tick ? ps(dm / d.tick) : r1(dm);
      const rate =
        view === 'flame'
          ? T('arsenal.stream')
          : view === 'minigun'
            ? T('arsenal.upTo', { v: r1(rt) })
            : d.rate
              ? ps(rt)
              : '—';
      const mg = d.mag ? Math.max(1, Math.round(d.mag * (1 + W.mag.per * (u.mag || 0)))) : 0;
      const mag = !mg
        ? '—'
        : view === 'flame'
          ? T('arsenal.fuelVal', { v: r1(mg * d.tick), s: r1(d.rl) })
          : T('arsenal.magVal', { n: mg, s: r1(d.rl) });
      const up = (k, ico) => {
        const lv = u[k] || 0,
          P = W[k].price[lv];
        return `<div class="aup"><span class="ui">${ico}</span><div class="um"><div class="un">${W[k].name}</div><span class="pips">${pips(lv, 5)}</span></div>
          ${
            lv >= 5
              ? `<div class="pbtn maxb">${T('common.max')}</div>`
              : !own || lk
                ? `<button class="pbtn" disabled>${MICO.lock}</button>`
                : lv >= M.l
                  ? `<button class="pbtn mlk" disabled>${MICO.lock}<b>${T('arsenal.mastNeed', { l: lv + 1 })}</b></button>`
                  : priceBtn(P, `data-up="${k}"`)
          }</div>`;
      };
      const mast = own
        ? `<div class="amst"><div class="amh"><span>${T('arsenal.mastery', { l: M.l })}</span><b>${M.b ? T('arsenal.mastKills', { a: fmtN(M.k), b: fmtN(M.b) }) : T('arsenal.mastMax')}</b></div>
        <div class="mbar"><i style="width:${M.w.toFixed(0)}%"></i></div></div>`
        : '';
      const big = lk
        ? `<button class="bigb dis" disabled><span class="ic">${MICO.lock}</span>${T('common.soonCaps')}</button>`
        : rl
          ? `<button class="bigb dis" disabled><span class="ic">${MICO.lock}</span>${T('arsenal.rankBtn', { r: d.rank })}</button>`
          : !own
            ? `<button class="bigb buy" data-buy ${SAVE.coins < d.price ? 'disabled' : ''}>${T('arsenal.buy')} <span class="bp">${coin()}<b>${fmtN(d.price)}</b></span></button>`
            : view === sel
              ? `<button class="bigb prim"><span class="ic">${HICO.check}</span>${T('arsenal.primary')}</button>`
              : `<button class="bigb" data-sel>${T('arsenal.makePrimary')}</button>`;
      det.innerHTML = `<div class="dnm">${d.name}</div><div class="dsub">${own ? T('arsenal.owned') : lk ? T('arsenal.wip') : rl ? T('arsenal.needRank', { r: d.rank }) : T('arsenal.notOwned')}</div>
        <div class="gview">${lk ? img('i_' + view, 'sil', '') : `<canvas data-gun="${view}"></canvas>`}</div>
        <div class="dfeat">${(lk ? [d.feat] : d.feat.split(', ').concat(d.desc)).map((s) => `<div>${cap(s)}</div>`).join('')}</div>
        <div class="dst"><span>${T('stats.dmg')}</span><b>${dmg}</b></div><div class="dst"><span>${T('stats.rate')}</span><b>${rate}</b></div>
        <div class="dst"><span>${T(view === 'flame' ? 'stats.fuel' : 'stats.mag')}</span><b>${mag}</b></div>
        ${mast}${up('dmg', MICO.star)}${up('rate', MICO.bullet)}${up('mag', MICO.mag)}${big}`;
      el.querySelector('.cn').textContent = fmtN(SAVE.coins);
    };
    el.addEventListener('click', (e) => {
      const view = arsView && D.MAIN[arsView] ? arsView : SAVE.selected,
        t = e.target.closest('[data-v],[data-buy],[data-sel],[data-up]');
      if (!t) return;
      if (t.dataset.v) {
        if (arsView !== t.dataset.v) {
          arsView = t.dataset.v;
          if (window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.25);
          paint();
        }
        return;
      }
      const a = t.hasAttribute('data-buy')
        ? { k: 'buy', id: view }
        : t.hasAttribute('data-sel')
          ? { k: 'sel', id: view }
          : { k: 'up', id: view, s: t.dataset.up };
      if (SAVE.act(a)) return; // not allowed (rules.js): nothing happens
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.3);
      paint();
    });
    paint();
    repaint = paint;
  }

  // ---------------- permanent upgrades: the cat standing on the left (drawn live), the list on the right ----------------
  function upgrades() {
    const el = page(
      'upg',
      'upgrades',
      `${head(T('upgrades.title'))}<div class="pslot"></div><div class="ulist"></div>`,
    );
    const list = el.querySelector('.ulist');
    const paint = () => {
      list.innerHTML = Object.entries(D.META)
        .map(([k, m]) => {
          const lv = SAVE.meta[k] || 0,
            P = m.price[lv],
            [d1, d2] = m.desc.split(' (');
          return `<div class="urow"><div class="uic">${img(m.icon)}</div><div class="umid"><div class="unm">${m.name}</div><div class="uds">${d1}</div>${d2 ? `<div class="uds2">${cap(d2.replace(/\)$/, ''))}</div>` : ''}<span class="pips">${pips(lv, m.max)}</span></div>
          ${lv < m.max ? priceBtn(P, `data-m="${k}"`) : `<div class="pbtn maxb">${T('common.max')}</div>`}</div>`;
        })
        .join('');
      el.querySelector('.cn').textContent = fmtN(SAVE.coins);
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (SAVE.act({ k: 'meta', s: b.dataset.m })) return;
      if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.3);
      paint();
    });
    paint();
    repaint = paint;
  }

  // ---------------- heroes (styled after the lobby; the camp behind and the cat on its pedestal are live: lobby.js) ----------------
  const HICO = {
    heart:
      '<svg viewBox="0 0 24 24"><path d="M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 3.2C20.5 15.7 12 21 12 21z" fill="#ff3b4e" stroke="#9e1626" stroke-width="1.4"/><path d="M7.2 8.6a2.4 2.4 0 0 1 2.4-1.4" stroke="#ffb3bb" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    run: '<svg viewBox="0 0 24 24" fill="none" stroke="#4fd8ff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="4.2" r="2.2" fill="#4fd8ff" stroke="none"/><path d="M8 9.5l4-2 3.5 3.5 3 1"/><path d="M12 7.5l-1.5 6 3.5 3V21"/><path d="M10.5 13.5L8 17H4"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10" width="15" height="11" rx="2.5" fill="currentColor"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="15.5" r="1.7" fill="#1b2130"/></svg>',
    check:
      '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M20 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function heroes() {
    U.opaque = false;
    const hp = 100 + 10 * ((SAVE.meta && SAVE.meta.hp) || 0);
    const soon = (
      pic,
    ) => `<div class="hc locked"><div class="in"><span class="htag">${T('heroes.soon')}</span><i class="bolt l"></i><i class="bolt r"></i>
        <div class="port">${img('hcard_bg', 'pbg', '')}${img(pic, 'sil', '')}<span class="q">?</span></div>
        <div class="info"><div class="hn">???</div><div class="any">${T('heroes.newSoon')}</div><button class="hbtn lock" disabled><span class="ic">${HICO.lock}</span>${T('heroes.soon')}</button></div></div></div>`;
    const el = show(
      `
      <div class="hb">
        <button class="lbp back" data-go="lobby"><span class="ic">${HICO.back}</span>${T('common.back')}</button>
        <h2 class="ttl">${T('heroes.title')}</h2>
        <div class="tr"><div class="lbp coin">${coin()}<span>${fmtN(SAVE.coins)}</span></div></div>
        <div class="hcards">
          <div class="hc me"><div class="in"><span class="htag">${T('heroes.unlocked')}</span><i class="bolt l"></i><i class="bolt r"></i>
            <div class="port"><canvas></canvas></div>
            <div class="info"><div class="hn">${T('heroes.name')}</div>
              <div class="st"><span class="chip"><span class="ic">${HICO.heart}</span>${T('heroes.hp', { v: hp })}</span><span class="chip"><span class="ic">${HICO.run}</span>${T('heroes.speed', { v: 230 })}</span></div>
              <div class="any">${T('heroes.any')}</div>
              <button class="hbtn sel"><span class="ic">${HICO.check}</span>${T('heroes.selected')}</button></div></div></div>
          ${soon('hero_cat')}${soon('hero_bear')}
        </div>
      </div>`,
      'heroScr',
    );
    el.id = 'heroes';
    U.live = true;
    U.scene = 'heroes';
    wire(el);
  }

  // ---------------- roadmap with local votes ----------------
  function roadmap() {
    U.opaque = false;
    const rows = D.ROADMAP.map((r) => {
      const v = !!SAVE.votes[r.id];
      return `<div class="panel row vote"><div class="mid"><span class="tag up">${r.tag}</span><div style="font:900 22px var(--font)">${r.title}</div><div class="hint">${r.text}</div></div>
        <div class="cnt">❤ ${fmtN(r.base + (v ? 1 : 0))}</div><button class="btn ${v ? 'gold' : 'orange'}" data-v="${r.id}" ${v ? 'disabled' : ''}>${v ? T('rm.voted') : T('rm.want')}</button></div>`;
    }).join('');
    const el = show(`${topbar(T('rm.title'))}<div class="body scroll"><div class="list">${rows}</div></div>`, 'sub');
    wire(el);
    on(el, '[data-v]', (b) => {
      SAVE.act({ k: 'vote', id: b.dataset.v });
      roadmap();
    });
  }

  // ---------------- the players' ranking (the server's GET /api/leaderboard): by rank, then by the record (the fastest win); a player is their wallet ----------------
  function board() {
    U.opaque = false;
    const el = show(
      `${topbar(T('lb.title'))}<div class="body scroll"><div class="list board"><div class="hint lbst">${T('lb.loading')}</div></div></div>`,
      'sub',
    );
    wire(el);
    const me = window.WALLET && WALLET.account,
      list = el.querySelector('.board');
    fetch((window.SAVE_API || '/api') + '/leaderboard')
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(
        (b) => {
          const rows = (b.top || [])
            .map((p, i) => {
              const mine = p.account === me;
              return `<div class="panel brow${mine ? ' me' : ''}"><span class="pos">${i + 1}</span><span class="acc" title="${esc(p.account)}">${esc(shortAcc(p.account))}${mine ? ` <span class="you">${T('lb.you')}</span>` : ''}</span><span class="rk">${T('lobby.rank', { r: +p.rank | 0 })}</span><span class="bt">${+p.fast ? fmt(+p.fast) : '—'}</span></div>`;
            })
            .join('');
          list.innerHTML = rows
            ? `<div class="brow bhead"><span class="pos">#</span><span class="acc">${T('lb.player')}</span><span class="rk">${T('lb.rank')}</span><span class="bt">${T('lb.best')}</span></div>${rows}`
            : `<div class="hint lbst">${T('lb.empty')}</div>`;
        },
        () => {
          list.innerHTML = `<div class="hint lbst">${T('lb.error')}</div>`;
        },
      );
  }

  // ---------------- playing together (net.js; the server: server/rooms.mjs): make a room (open — listed for everyone here — or private:
  // only its code or link lets one in), join one from the list or by its code; in the room both players' faces and guns, the code and a
  // way to invite a friend (Telegram's share inside the Mini App, the phone's share sheet, else the link copied), each player's own gun,
  // the host's START. The page follows the server's word (NET's events); leaving it leaves the room ----------------
  const face = (ava, bg, cls = '') => {
    const av = D.AVATARS[ava],
      b = D.AVATAR_BG[bg];
    return `<span class="cface ${cls}" style="--av0:${b ? b[0] : '#ffb35a'};--av1:${b ? b[1] : '#a8461c'}">${img(av ? av.id : 'av_3', 'av', '')}</span>`;
  };
  let coopOff = null;
  U.coop = (code) => {
    if (!window.NET) {
      U.lobby();
      return;
    }
    U.opaque = false;
    const el = show(
      `${topbar(T('coop.title'))}<div class="body scroll coopb"><div class="cbody"></div><div class="cnet hint"></div></div>`,
      'sub',
    );
    el.id = 'coop';
    wire(el);
    el.querySelector('.back').addEventListener(
      'click',
      () => {
        if (NET.room) NET.leave();
        NET.watch(false);
      },
      true,
    ); // (the page left: the room too)
    let mode = '',
      openSel = true,
      picked = SAVE.selected;
    const body = el.querySelector('.cbody'),
      net = el.querySelector('.cnet');
    const err = (e) => T('coop.err.' + e) || e;
    const paintNet = () => {
      net.textContent =
        NET.state === 'on'
          ? NET.rtt
            ? T('coop.ping', { ms: Math.round(NET.rtt) })
            : ''
          : NET.state === 'connecting'
            ? T('coop.connecting')
            : NET.state === 'stale'
              ? ''
              : T('coop.offline');
    };
    const owned = () => D.MAIN_ORDER.filter((id) => SAVE.owned[id] && !D.MAIN[id].locked);
    function paintList() {
      const L = body.querySelector('.clist');
      if (!L) return;
      L.innerHTML = NET.rooms.length
        ? NET.rooms
            .map(
              (
                r,
              ) => `<div class="panel crow"><span class="cwho">${face(r.ava, r.bg)}<span><b>${esc(r.nick)}</b><small>${T('lobby.rank', { r: +r.rank | 0 })}</small></span></span>
        <span class="cgunic">${img('i_' + (D.MAIN[r.gun] ? r.gun : 'pistol'))}</span><button class="btn orange" data-jc="${esc(r.code)}">${T('coop.join')}</button></div>`,
            )
            .join('')
        : `<div class="hint cempty">${T('coop.empty')}</div>`;
      on(L, '[data-jc]', (b) => NET.join(b.dataset.jc, picked));
    }
    function paint() {
      const R = NET.room,
        m = R ? 'room' : 'out';
      if (m !== mode) {
        mode = m;
        NET.watch(!R);
      }
      if (!R) {
        body.innerHTML = `<div class="cgrid">
          <div class="panel cbox"><h3>${T('coop.make')}</h3><div class="cseg"><button data-open="1" class="${openSel ? 'on' : ''}">${T('coop.open')}</button><button data-open="0" class="${openSel ? '' : 'on'}">${T('coop.private')}</button></div>
            <p class="hint">${T('coop.openHint')}</p><button class="btn orange" data-make>${T('coop.create')}</button></div>
          <div class="panel cbox"><h3>${T('coop.joinTitle')}</h3><div class="cjrow"><input class="ccode" maxlength="5" autocomplete="off" spellcheck="false" placeholder="${T('coop.codePh')}"><button class="btn" data-join>${T('coop.join')}</button></div>
            <div class="cerr">${NET.err ? err(NET.err) : ''}</div><p class="hint">${T('coop.rules')}</p></div></div>
          <h3 class="clh">${T('coop.list')}</h3><div class="list clist"></div>`;
        paintList();
        on(body, '[data-open]', (b) => {
          openSel = b.dataset.open === '1';
          body.querySelectorAll('[data-open]').forEach((x) => x.classList.toggle('on', x === b));
        });
        on(body, '[data-make]', () => NET.make(openSel, picked, U.mapId()));
        const inp = body.querySelector('.ccode');
        for (const k of ['keydown', 'keyup'])
          inp.addEventListener(k, (e) => {
            e.stopPropagation();
            if (k === 'keydown' && e.key === 'Enter') join();
          }); // (the game's keys stay out of it)
        inp.addEventListener('input', () => {
          inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });
        const join = () => {
          const c = inp.value.trim();
          if (c.length >= 4) NET.join(c, picked);
        };
        on(body, '[data-join]', join);
        return;
      }
      const mine = NET.isMine(),
        me = R.players.find((p) => p.id === NET.id),
        two = R.players.length >= 2,
        mate = R.players[1],
        lobby = R.state === 'lobby';
      const go = two && lobby && mate.ready !== false; // (the host starts only once the guest pressed Ready)
      if (me && me.gun !== picked && SAVE.owned[me.gun]) picked = me.gun;
      const slot = (p, i) =>
        p
          ? `<div class="panel cslot ${p.id === NET.id ? 'me' : ''}">${face(p.ava, p.bg, 'big')}<div class="cnm"><b>${esc(p.nick)}${p.id === NET.id ? ` <em>${T('coop.you')}</em>` : ''}</b><small>${T('lobby.rank', { r: +p.rank | 0 })}${i === 0 ? ` · <span class="chost">${T('coop.host')}</span>` : ''}</small></div>
          <div class="cgw">${img('i_' + (D.MAIN[p.gun] ? p.gun : 'pistol'), 'cgi')}<span>${D.MAIN[p.gun] ? D.MAIN[p.gun].name : ''}</span></div>${mine && i > 0 ? `<button class="btn ghost ckick" data-kick>${T('coop.kick')}</button>` : ''}
          ${i > 0 && lobby ? `<span class="crdy ${p.ready !== false ? 'on' : ''}">${p.ready !== false ? '✔ ' : ''}${T(p.ready !== false ? 'coop.ready' : 'coop.notReady')}</span>` : ''}</div>`
          : `<div class="panel cslot empty"><span class="cdots"><i></i><i></i><i></i></span><b>${T('coop.waiting')}</b></div>`;
      body.innerHTML = `<div class="croom">
        <div class="panel ccodeb"><span class="cl">${T('coop.code')}</span><b class="cc">${esc(R.code)}</b><button class="btn ghost" data-copy>${T('coop.copy')}</button><button class="btn orange" data-invite>${T('coop.invite')}</button>
          <span class="cseg sm">${mine ? `<button data-ro="1" class="${R.open ? 'on' : ''}">${T('coop.open')}</button><button data-ro="0" class="${R.open ? '' : 'on'}">${T('coop.private')}</button>` : `<span class="on">${T(R.open ? 'coop.open' : 'coop.private')}</span>`}</span></div>
        <div class="panel cmapb"><span class="cl">${T('coop.map')}</span><span class="cseg sm">${D.MAPS.filter(
          (q) => q.open,
        )
          .map((q) =>
            mine && lobby
              ? `<button data-map="${q.id}" class="${(R.map || 'suburb') === q.id ? 'on' : ''}">${esc(q.name)}</button>`
              : (R.map || 'suburb') === q.id
                ? `<span class="on">${esc(q.name)}</span>`
                : '',
          )
          .join('')}</span></div>
        <div class="cslots">${slot(R.players[0], 0)}${slot(R.players[1], 1)}</div>
        <div class="panel cguns"><span class="cl">${T('coop.yourGun')}</span><div class="cgl">${owned()
          .map(
            (id) =>
              `<button class="cgb ${id === picked ? 'on' : ''}" data-g="${id}" title="${D.MAIN[id].name}">${img('i_' + id)}</button>`,
          )
          .join('')}</div></div>
        <div class="btns">${
          mine
            ? `<button class="btn orange cstart" data-start ${go ? '' : 'disabled'}>${R.state === 'play' ? T('coop.playing') : T('coop.start')}</button>`
            : !lobby
              ? `<span class="hint cwait">${T('coop.playing')}</span>`
              : `<button class="btn ${me && me.ready ? 'ghost' : 'orange'} crdyb" data-ready="${me && me.ready ? 0 : 1}">${T(me && me.ready ? 'coop.unready' : 'coop.readyBtn')}</button>`
        }
          <button class="btn" data-leave>${T('coop.leave')}</button></div>
        ${mine && two && lobby && !go ? `<p class="hint cwait">${T('coop.waitReady')}</p>` : !mine && lobby && me ? `<p class="hint cwait">${T(me.ready ? 'coop.waitHost' : 'coop.pressReady')}</p>` : ''}
        <p class="hint">${T('coop.rules')}${SAVE.profile ? '' : ' ' + T('coop.guestNote')}</p></div>`;
      on(body, '[data-g]', (b) => {
        picked = b.dataset.g;
        if (SAVE.selected !== picked) SAVE.act({ k: 'sel', id: picked });
        NET.gun(picked);
        paint();
      });
      on(body, '[data-start]', () => NET.start());
      on(body, '[data-ready]', (b) => NET.ready(b.dataset.ready === '1'));
      on(body, '[data-kick]', () => NET.kick());
      on(body, '[data-ro]', (b) => NET.setOpen(b.dataset.ro === '1'));
      on(body, '[data-map]', (b) => {
        setMap(b.dataset.map);
        NET.setMap(b.dataset.map);
      });
      on(body, '[data-leave]', () => {
        NET.leave();
      });
      on(body, '[data-copy]', () => copy(R.code));
      on(body, '[data-invite]', () => invite(R.code));
    }
    const copy = (s) => {
      const ok = () => toast(T('coop.copied'));
      try {
        navigator.clipboard.writeText(s).then(ok, () => {
          fallbackCopy(s);
          ok();
        });
      } catch (e) {
        fallbackCopy(s);
        ok();
      }
    };
    const fallbackCopy = (s) => {
      const t = document.createElement('textarea');
      t.value = s;
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand('copy');
      } catch (e) {}
      t.remove();
    };
    function invite(c) {
      const link = NET.link(c),
        text = T('coop.inviteText', { code: c });
      let tg = null;
      try {
        tg = window.parent !== window && parent.Telegram && parent.Telegram.WebApp;
      } catch (e) {}
      if (tg && tg.openTelegramLink) {
        try {
          tg.openTelegramLink(
            'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text),
          );
          return;
        } catch (e) {}
      }
      if (navigator.share) {
        navigator.share({ title: T('lang.title'), text, url: link }).catch(() => {});
        return;
      }
      copy(text + ' ' + link);
    }
    if (coopOff) coopOff();
    coopOff = NET.on((k, x) => {
      if (!el.isConnected || el.classList.contains('gone')) {
        coopOff();
        coopOff = null;
        return;
      }
      if (k === 'rooms') {
        if (!NET.room) paintList();
      } else if (k === 'room' || k === 'err') {
        if (k === 'err' && NET.room) toast(err(x));
        paint();
      } else if (k === 'kicked') toast(T('coop.kicked'));
      else if (k === 'state') paintNet();
    });
    const pt = setInterval(() => {
      if (!el.isConnected) {
        clearInterval(pt);
        return;
      }
      paintNet();
    }, 2000);
    NET.connect();
    paint();
    paintNet();
    if (code && !NET.room) {
      const c = String(code).toUpperCase();
      if (NET.state === 'on') NET.join(c, picked);
      else {
        const off = NET.on((k) => {
          if (k === 'state' && NET.state === 'on') {
            off();
            NET.join(c, picked);
          }
        });
      }
    }
  };
  // the bar over a run together (index.html: the partner late, its card screen, this hero down): one line at the top, '' hides it
  U.coopBar = (t) => {
    let b = document.getElementById('coopw');
    if (!t) {
      if (b && !b.hidden) b.hidden = true;
      return;
    }
    if (!b) {
      b = document.createElement('div');
      b.id = 'coopw';
      document.body.appendChild(b);
    }
    if (b.textContent !== t) b.textContent = t;
    if (b.hidden) b.hidden = false;
  };

  // ---------------- in-run overlays ----------------
  // a card: its icon, tag, name, level, what this level gives (ds) and, for an extra weapon or a passive, what it does at all (dd)
  const cardHtml = (c, i, clickable, hl) => {
    let icon,
      name,
      tag,
      lvl,
      ds,
      dd = '',
      evo = '';
    if (c.ty === 'main') {
      const d = D.MAIN[c.id];
      icon = 'i_' + c.id;
      name = d.name;
      tag = `<span class="tag main">${T('cards.primary')}</span>`;
      lvl = T('cards.lvl', { a: c.from ?? c.lvl - 1, b: c.lvl }); // (from: a mission crate's, several levels at once)
      ds = c.from === undefined ? d.lv[c.lvl - 1] || '' : d.lv.slice(c.from, c.lvl).join(', ');
      evo = `<div class="evo">${T('cards.evoWith', { item: D.ITEMS[D.MAIN_EVO].name, evo: T('mevos.' + c.id + '.name') })}</div>`;
    } else if (c.ty === 'heal') {
      icon = 'i_medkit';
      name = T('cards.heal');
      tag = `<span class="tag new">${T('cards.bonus')}</span>`;
      lvl = '';
      ds = T('cards.healDesc');
    } else if (c.ty === 'gold') {
      icon = 'pk_coin';
      name = T('cards.gold');
      tag = `<span class="tag new">${T('cards.bonus')}</span>`;
      lvl = '';
      ds = T('cards.goldDesc');
    } else {
      const it = D.ITEMS[c.id];
      if (!it) return ''; // unknown id (an old saved run): SIM.migrate re-deals these
      icon = it.icon;
      name = it.name;
      tag =
        c.ty === 'new'
          ? `<span class="tag new">${T(it.kind === 'weapon' ? 'cards.newWeapon' : 'cards.newPassive')}</span>`
          : `<span class="tag up">${T(it.kind === 'weapon' ? 'cards.weapon' : 'cards.passive')}</span>`;
      lvl = c.ty === 'new' ? T('cards.lvl1') : T('cards.lvl', { a: c.lvl - 1, b: c.lvl });
      ds = it.lv[c.lvl - 1] || '';
      dd = it.desc || '';
      const ev = D.EVOS[c.id];
      if (ev) evo = `<div class="evo">${T('cards.evoWith', { item: D.ITEMS[ev.with].name, evo: ev.name })}</div>`;
      for (const [w, e2] of Object.entries(D.EVOS))
        if (e2.with === c.id)
          evo += `<div class="evo">${T('cards.evoFor', { item: D.ITEMS[w].name, evo: e2.name })}</div>`; // (the magnet serves two)
      const mg = window.GAME && GAME.play && GAME.play.p.main.id; // the caliber: the gun held now
      if (c.id === D.MAIN_EVO && mg)
        evo = `<div class="evo">${T('cards.evoFor', { item: D.MAIN[mg].name, evo: T('mevos.' + mg + '.name') })}</div>`;
    }
    const kind = c.ty === 'main' ? 'main' : c.ty === 'new' ? 'new' : c.ty === 'up' ? 'up' : 'bonus';
    // (lock: a mission's card shown, not to be taken: drawn as any other, it just takes no pick; hl: the one to take on
    // such a screen, its frame blinking)
    if (c.lock)
      return `<div class="panel lv k-${kind} still"><div class="lvh"><div class="ic">${img(icon, '', '✨')}</div><div class="lvt">${tag}<div class="nm">${name}</div><div class="lvl">${lvl}</div></div></div><div class="ds">${ds}</div>${dd ? `<div class="dd">${dd}</div>` : ''}${evo}</div>`;
    return `<div class="panel lv k-${kind}${hl ? ' hl' : ''}" data-pick="${i}">${clickable ? `<span class="key">${i + 1}</span>` : ''}<div class="lvh"><div class="ic">${img(icon, '', '✨')}</div><div class="lvt">${tag}<div class="nm">${name}</div><div class="lvl">${lvl}</div></div></div><div class="ds">${ds}</div>${dd ? `<div class="dd">${dd}</div>` : ''}${evo}</div>`;
  };
  function levelUp(P, play) {
    const el =
      show(`<div class="ov"><div class="fit"><h1 class="cyan">${T('run.levelUp')}</h1><div class="cards">${P.cards
        .map((c, i) =>
          cardHtml(
            c,
            i,
            true,
            P.cards.some((q) => q.lock),
          ),
        )
        .join('')}</div>
      <div class="btns"><button class="btn" data-rr ${play.p.rerolls > 0 && !P.cards.some((c) => c.lock) ? '' : 'disabled'}>${T('run.reroll', { n: play.p.rerolls })}</button></div><div class="hint">${T('run.levelHint')}</div></div></div>`);
    tap(el, '[data-pick]', (b) => GAME.pick(+b.dataset.pick));
    tap(el, '[data-rr]', () => GAME.pick(-2));
    voiceWait(el);
  }
  function chest(P) {
    const el =
      show(`<div class="ov"><div class="fit"><h1>${T(P.kind !== 'air' ? 'run.bossChest' : GAME.play && GAME.play.mis ? 'run.supplies' : 'run.airdrop')}</h1><div class="chestItems cards">${P.items.map((c, i) => cardHtml(c, i, false)).join('')}</div>
      ${P.coins ? `<div class="coins panel">${coin()}<span>+${P.coins}</span></div>` : ''}<div class="btns"><button class="btn orange" data-take>${T('run.take')}</button></div></div></div>`);
    tap(el, '[data-take]', () => GAME.pick(0));
    voiceWait(el, true);
  }
  // a screen Nova talks over (a mission's crate, its first level up): its cards and its take wait until she is done,
  // the take counting the seconds down (the keys' picks wait too: index.html GAME.pick, window.__vwait); seq: its
  // cards framed one after another meanwhile (a crate: what she names), each for SEQ ms, round again
  const SEQ = 1100;
  function voiceWait(el, seq) {
    if (!window.VOICE || VOICE.idle()) return;
    const b = el.querySelector('[data-take]'),
      txt = b ? b.textContent : '',
      cards = seq ? [...el.querySelectorAll('.cards .panel.lv')] : [],
      t0 = performance.now();
    el.classList.add('vwait');
    window.__vwait = true;
    if (b) b.disabled = true;
    const tick = () => {
      if (!el.isConnected || VOICE.idle()) {
        el.classList.remove('vwait');
        window.__vwait = false;
        for (const c of cards) c.classList.remove('vhl');
        if (b) {
          b.disabled = false;
          b.textContent = txt;
        }
        return;
      }
      if (b) b.textContent = txt + ' · ' + Math.max(1, Math.ceil(VOICE.left() / 1000));
      const on = Math.floor((performance.now() - t0) / SEQ) % Math.max(1, cards.length);
      cards.forEach((c, i) => c.classList.toggle('vhl', i === on));
      setTimeout(tick, 100);
    };
    tick();
  }
  // a mission's talk that dims the screen (SIM.goal dim): a shade over the run and, keys, how to walk (the keys on a
  // computer, the left thumb on a phone), left up once the talk is over until the hero walks off (or KEYS_T ms)
  const KEYS_T = 6000;
  let dimEl = null,
    keysEl = null,
    keysAt = null;
  function talkFx(play) {
    const g = play && play.mis && !play.over && !GAME.menu ? SIM.goal(play) : null,
      dim = !!(g && g.k === 'talk' && g.dim && !play.pause),
      ui = document.getElementById('ui');
    if (!ui) return;
    if (dim && !dimEl) {
      dimEl = document.createElement('div');
      dimEl.id = 'tdim';
      ui.prepend(dimEl); // (under the radio's subtitle and the screens)
      keysEl = document.createElement('div');
      keysEl.id = 'tkeys';
      keysEl.innerHTML = `<div class="kpc"><div class="kcl"><b>W</b></div><div class="kcl"><b>A</b><b>S</b><b>D</b></div><span>${T('task.move')}</span></div><div class="ktouch"><i class="kstick"></i><span>${T('task.moveTouch')}</span></div>`;
      ui.appendChild(keysEl);
    }
    if (!dimEl) return;
    dimEl.classList.toggle('on', dim);
    const p = play && play.p;
    if (dim && g.keys) keysAt = null;
    else if (!keysAt && p && keysEl.classList.contains('on')) keysAt = { t: performance.now(), x: p.x, y: p.y };
    const keys =
      (dim && g.keys) ||
      (!!keysAt &&
        !!p &&
        !play.over &&
        performance.now() - keysAt.t < KEYS_T &&
        Math.hypot(p.x - keysAt.x, p.y - keysAt.y) < 60);
    keysEl.classList.toggle('on', keys);
  }
  // a mission's talk (SIM.goal k 'talk'): once its lines are said to the end (live/voice.js) and no screen is up the sim
  // is told (SIM.PICK.talk), again every half second until it moves on
  let talkT = 0;
  function talkDone(play) {
    const g = play.mis && !play.pause && !play.over ? SIM.goal(play) : null;
    if (!g || g.k !== 'talk' || !window.VOICE || !VOICE.idle() || play.t - play.mis.t0 < 0.6) return;
    const now = performance.now();
    if (now - talkT < 500) return;
    talkT = now;
    GAME.pick(SIM.PICK.talk);
  }
  // the tutorial's skip (SIM.goal skip: the mission's plan.skip, from past the crate to the door): a button under the
  // goal line; the first tap asks again, a second one within 3 s skips (SIM.PICK.skip)
  let skipEl = null,
    skipAsk = 0;
  function skipBtn(play) {
    const g = play && play.mis && !play.pause && !play.over && !GAME.menu ? SIM.goal(play) : null;
    if (!g || !g.skip) {
      if (skipEl) skipEl.classList.remove('on');
      return;
    }
    if (!skipEl) {
      skipEl = document.createElement('button');
      skipEl.id = 'tutskip';
      skipEl.className = 'btn';
      skipEl.onclick = (e) => {
        e.stopPropagation();
        if (performance.now() - skipAsk < 3000) {
          skipAsk = 0;
          skipEl.classList.remove('on');
          GAME.pick(SIM.PICK.skip);
        } else skipAsk = performance.now();
      };
      skipEl.onpointerdown = (e) => e.stopPropagation(); // (a tap on it is not a shot)
      document.getElementById('ui').appendChild(skipEl);
    }
    const t = T(performance.now() - skipAsk < 3000 ? 'task.skipSure' : 'task.skip');
    if (skipEl.textContent !== t) skipEl.textContent = t;
    skipEl.classList.add('on');
  }
  U.pauseMenu = (onP) => {
    const play = GAME.play;
    if (!onP) {
      U.hide();
      return;
    }
    const co = !!GAME.coopRun; // (together: the run goes on under the menu)
    const items = [
      { icon: 'i_' + play.p.main.id, lvl: play.p.main.lvl },
      ...play.p.items.filter((i) => D.ITEMS[i.id]).map((i) => ({ icon: D.ITEMS[i.id].icon, lvl: i.evo ? '★' : i.lvl })),
    ];
    const el =
      show(`<div class="ov"><div class="fit"><h1 class="cyan">${T(co ? 'coop.menu' : 'run.paused')}</h1>${co ? `<div class="hint">${T('coop.menuHint')}</div>` : ''}<div class="panel res"><div class="r">${T('run.time')} <b>${fmt(play.t)}</b></div><div class="r">${T('run.kills')} <b>${fmtN(co ? play.p.kills || 0 : play.kills)}</b></div><div class="r">${T('run.level')} <b>${play.p.lvl}</b></div><div class="r">${T('run.coins')} <b>${fmtN(play.coins)}</b></div></div>
      <div class="pitems">${items.map((i) => `<div class="it">${img(i.icon)}<b>${i.lvl}</b></div>`).join('')}</div>${play.p.bag && play.p.bag.some(Boolean) && !play.hub ? `<div class="hint bagwarn">${T('bag.quitLost')}</div>` : ''}
      <div class="btns"><button class="btn orange" data-res>${T('run.resume')}</button><button class="btn" data-quit>${T(co ? 'coop.leaveRun' : 'common.toLobby')}</button>${fsBtn()}</div></div></div>`);
    on(el, '[data-res]', () => GAME.pause(false));
    on(el, '[data-fs]', () => GAME.fullscreen());
    on(el, '[data-quit]', () => {
      bank(play);
      GAME.quit();
    });
  };
  // A run's end (or a quit) pays once (save.js bankRun → rules.js bank): its coins and the win bonus, the survivor rank's XP with the
  // coins of every rank it passes, its kills to the mastery of its gun — into the guest's progress, or for an account by the server
  // once it has played the run again. What it pays is kept on the run (play.gain, play.bst: local | pending | unranked) for the results.
  function bank(play) {
    if (!play || play.banked) return;
    play.banked = true;
    const run = GAME.run;
    if (run && !run.hash) run.hash = REPLAY.hash(play);
    const b = SAVE.bankRun(play, run);
    play.gain = b.gain;
    play.bst = b.status;
    play.bid = b.id || null;
  }
  U.bankRun = bank;
  // the results (after art/refs/ui/results_dead.png, results_win.png), over the dimmed game: the emblem (the skull and bullets, the trophy)
  // over the title; the run's numbers and the coins on the left; on the right the survivor rank — its badge, the bar filling from where it
  // stood (a rank passed: the number pops, a gun it opens shows its card), the gun's mastery — and a card: a gun opened, the victory's
  // reward, or else the next gun to come
  const RICO = {
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    watch:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.2 6.8l1.6-1.6"/></svg>',
    skull:
      '<svg viewBox="0 0 24 24"><path d="M12 2.5c-5 0-8.5 3.4-8.5 8 0 2.6 1.2 4.4 2.8 5.5V19c0 1.1.9 2 2 2h7.4c1.1 0 2-.9 2-2v-3c1.6-1.1 2.8-2.9 2.8-5.5 0-4.6-3.5-8-8.5-8z" fill="currentColor"/><circle cx="8.6" cy="11.2" r="2.3" fill="#141c33"/><circle cx="15.4" cy="11.2" r="2.3" fill="#141c33"/><path d="M12 13.6l-1.3 2.4h2.6z" fill="#141c33"/><path d="M9.6 18.2v2.6M12 18.2v2.6M14.4 18.2v2.6" stroke="#141c33" stroke-width="1.3"/></svg>',
    lvl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l7-6 7 6M5 19l7-6 7 6"/></svg>',
    cup: '<svg viewBox="0 0 24 24"><path d="M6 3h12v5.5a6 6 0 0 1-12 0z" fill="#ffd23a"/><path d="M6 5H3v1.8a3.5 3.5 0 0 0 3.5 3.5M18 5h3v1.8a3.5 3.5 0 0 1-3.5 3.5" fill="none" stroke="#ffd23a" stroke-width="2"/><path d="M10.5 14h3v3.5h-3z" fill="#e8a316"/><rect x="7" y="17.5" width="10" height="3.5" rx="1" fill="#ffd23a"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.1 6 20.4l1.3-6.7-5-4.7 6.8-.8z" fill="currentColor"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11.2L12 3.5l9 7.7V20a1 1 0 0 1-1 1h-5.2v-6.2H9.2V21H4a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
    again:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M4 3.5v5h5"/></svg>',
  };
  const rankBadge = (
    r,
  ) => `<div class="rkbadge"><svg viewBox="0 0 64 70"><defs><linearGradient id="rkgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe58a"/><stop offset=".55" stop-color="#f3a51e"/><stop offset="1" stop-color="#b8640c"/></linearGradient></defs>
    <polygon points="32,2 61,18.5 61,51.5 32,68 3,51.5 3,18.5" fill="url(#rkgrad)" stroke="#6b3a05" stroke-width="2.5"/><polygon points="32,11 53,23 53,47 32,59 11,47 11,23" fill="#24190c" stroke="#ffd56a" stroke-width="1.8"/></svg><b class="rkno">${r}</b></div>`;
  // an account's run: what the server says of it, under the title (checking → counted, or what it paid when that differs, or why not)
  const runNote = (play, r) =>
    play.bst === 'unranked'
      ? T('rank.offline')
      : play.bst !== 'pending'
        ? ''
        : !r
          ? T('rank.checking')
          : r.error
            ? T('rank.refused')
            : r.gain && r.gain.coins !== play.gain.coins
              ? T('rank.recount', { c: fmtN(r.gain.coins) })
              : T('rank.counted');
  function results(play) {
    const o = play.over,
      win = o.win,
      co = !!GAME.coopRun,
      home = win && !!play.mis; // (a mission won: on to NEAR Base, docs/design.md's player path)
    bank(play);
    const G = play.gain,
      bonus = G.bonus,
      ml0 = D.masteryOf(G.m0),
      ml1 = D.masteryOf(G.m1),
      ma = D.MASTERY[ml1 - 1],
      mb = D.MASTERY[ml1];
    const R0 = D.rankOf(G.xp0),
      R1 = D.rankOf(G.xp0 + G.xp);
    const why = Object.entries(G.parts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${T('rank.' + k)} +${fmtN(v)}`)
      .join(' · '); // the XP line by line: the +XP's tooltip
    const row = (ic, label, val, cls = '') =>
      `<div class="rr ${cls}"><span class="ic">${ic}</span><span class="rl">${label}</span><b>${val}</b></div>`;
    const next = D.MAIN_ORDER.find((id) => !D.MAIN[id].locked && !SAVE.owned[id] && D.MAIN[id].rank > R1.r);
    const card = (cls, pic, tag, line, attr = '') =>
      `<div class="rcard ${cls}" ${attr}>${pic}<div class="rct"><span class="rtag">${tag}</span><b>${line}</b></div></div>`;
    // the guns the ranks open: one card, each gun on it shown as the bar passes its rank
    const cards =
      (G.opened.length
        ? card(
            'new',
            `<div class="rguns">${G.opened.map((id) => `<span data-r="${D.MAIN[id].rank}" data-g="${id}" hidden>${img('i_' + id)}</span>`).join('')}</div>`,
            T('rank.newGun'),
            '',
            `data-r="${D.MAIN[G.opened[0]].rank}" hidden`,
          )
        : '') +
      (G.items && G.items.length
        ? card(
            'loot',
            `<div class="rloot">${G.items.map(([id, n]) => `<span><img src="assets/it_${id}.png?v=${window.__V || 0}" alt="" draggable="false">${n > 1 ? `<b>×${n}</b>` : ''}</span>`).join('')}</div>`,
            T('market.loot'),
            G.items.map(([id]) => T('item.' + id)).join(', '),
          )
        : '') +
      (win ? card('win', img('ui_chest', '', '🧰'), T('rank.winReward'), T('rank.winCoins', { c: fmtN(bonus) })) : '') +
      (!G.opened.length && !win && next
        ? card(
            'next',
            img('i_' + next),
            T('rank.nextGun'),
            T('rank.nextAt', { w: D.MAIN[next].name, r: D.MAIN[next].rank }),
          )
        : '');
    const fx = Array.from(
      { length: 14 },
      (_, i) => `<i style="--i:${i};--x:${((i * 37) % 100) - 50};--d:${((i * 53) % 17) / 10}"></i>`,
    ).join(''); // confetti / embers
    const out = !win && !!(play.over && play.over.evac); // (left by the evac before the goal: alive, with what was carried)
    const el = show(`<div class="ov rso ${win || out ? 'win' : 'dead'}">
      <div class="rhead"><div class="remb"><div class="rfx">${fx}</div>${img(win ? 'ui_trophy' : out ? 'ui_chest' : 'ui_skull', '', win ? '🏆' : out ? '🧰' : '💀')}</div>
        <h1>${T(win ? 'run.victory' : out ? 'bag.outT' : co ? 'coop.lostT' : 'run.dead')}</h1><div class="rsub">${T(win ? 'run.winSub' : out ? 'bag.outSub' : co ? 'coop.lostSub' : 'run.deadSub')}</div><div class="rsync ${play.bst} ${runResults[play.bid] ? 'done' : ''}">${runNote(play, runResults[play.bid])}</div></div>
      <div class="resrow">
        <div class="panel res rp"><div class="rph"><span class="ic">${RICO.clock}</span><span>${T('run.result')}</span></div>
          ${row(RICO.watch, T('run.survived'), fmt(o.t))}${row(RICO.skull, T(co ? 'coop.kills' : 'run.kills'), fmtN(co ? G.m1 - G.m0 : o.kills))}${row(RICO.lvl, T('rank.lvl'), o.lvl)}${row(coin(), T(co ? 'coop.coinsTeam' : 'run.coinsGot'), fmtN(o.coins), 'coin')}
          ${win || G.rc ? '<div class="rdiv"></div>' : ''}${win ? row(RICO.cup, T('run.winBonus'), '+' + fmtN(bonus)) : ''}${G.mission ? row(RICO.cup, T('task.reward'), '+' + fmtN(G.mission.coins)) : ''}${G.rc ? row(RICO.cup, T('rank.coins'), '+' + fmtN(G.rc)) : ''}
          <div class="rtot total">${img('ui_coins', 'pile', '')}<span>${T('run.total')}</span><b>${coin()}${fmtN(G.coins)}</b></div></div>
        <div class="panel res rp rankp"><div class="rph"><span class="ic st">${RICO.star}</span><span>${T('rank.progress')}</span><b class="rkg" title="${why}">${T('rank.xp', { v: fmtN(G.xp) })}</b></div>
          <div class="rkl">${rankBadge(R0.r)}<div class="rkr"><b class="rkn"></b><div class="rkrow"><div class="rkbar"><i></i></div><span class="rkv"></span></div></div></div>
          <div class="rdiv"></div>
          <div class="rkm">${img('i_' + G.gun)}<div class="mm"><div class="mn">${D.MAIN[G.gun].name}${ml1 > ml0 ? `<em>▲ ${T('rank.newUps')}</em>` : ''}</div><div class="ml ${ml1 > ml0 ? 'up' : ''}">${T('arsenal.mastery', { l: ml1 })}</div>
            <div class="mrow"><div class="mbar"><i style="width:${mb ? Math.min(100, ((G.m1 - ma) / (mb - ma)) * 100).toFixed(0) : 100}%"></i></div><b>+${fmtN(G.m1 - G.m0)}</b></div></div></div>
          ${cards}</div></div>
      <div class="btns"><button class="btn rbtn" data-l><span class="ic">${RICO.home}</span>${T('common.toLobby')}</button><button class="btn orange rbtn" data-a><span class="ic">${co ? ICO.two : home ? RICO.home : win ? ICO.play : RICO.again}</span>${T(co ? 'coop.toRoom' : home ? 'campaign.base' : win ? 'run.next' : 'run.again')}</button></div></div>`);
    on(el, '[data-l]', () => {
      if (co && window.NET) {
        NET.leave();
        NET.watch(false);
        GAME.quit();
        U.lobby();
      } else GAME.quit();
    });
    on(el, '[data-a]', () => {
      if (!home) return GAME.restart();
      GAME.quit();
      GAME.hub();
    });
    if (play.bst === 'pending')
      noteRun = (r) => {
        const n = el.querySelector('.rsync');
        if (n && r.id === play.bid) {
          n.textContent = runNote(play, r);
          n.classList.toggle('bad', !!r.error);
          n.classList.add('done');
        }
      };
    const bar = el.querySelector('.rkbar i'),
      num = el.querySelector('.rkn'),
      no = el.querySelector('.rkno'),
      badge = el.querySelector('.rkbadge'),
      val = el.querySelector('.rkv');
    let shown = R0.r;
    const paint = (x) => {
      const R = D.rankOf(x);
      num.textContent = T('lobby.rank', { r: R.r });
      no.textContent = R.r;
      bar.style.width = (R.need ? (R.into / R.need) * 100 : 100).toFixed(1) + '%';
      val.textContent = R.need ? `${fmtN(Math.floor(R.into))} / ${fmtN(R.need)}` : T('rank.max');
      while (shown < R.r) {
        shown++;
        el.querySelectorAll(`[data-r="${shown}"]`).forEach((c) => {
          c.hidden = false;
        });
        const got = [...el.querySelectorAll('.rguns [data-g]:not([hidden])')].map((g) => D.MAIN[g.dataset.g].name),
          gl = el.querySelector('.rcard.new b');
        if (gl) gl.textContent = T('rank.unlocked', { w: got.join(', ') });
        badge.classList.remove('pop');
        void badge.offsetWidth;
        badge.classList.add('pop');
        if (window.AUDIO && AUDIO.ui) AUDIO.ui('bolt', 0.35);
      }
    };
    paint(G.xp0);
    const dur = 700 + Math.min(1800, G.xp * 2.5);
    let t0 = 0;
    const tick = (now) => {
      if (!bar.isConnected) return;
      t0 = t0 || now;
      const k = Math.min(1, (now - t0) / dur);
      paint(G.xp0 + G.xp * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(tick);
    };
    setTimeout(() => requestAnimationFrame(tick), 450);
  }
  // ---------------- a run together: the partner's card screen ----------------
  // the world waits for every card screen: while the partner's is open and this player has none (its own taken first, or none came),
  // the partner's cards show here, small, as it chooses — a look goes over them one by one and the auto pick's time runs down
  // (D.COOP.pick) — then the card it took lights up with a stamp, the others drop away, and the panel goes as the run goes on (the
  // sim's 'took' event says which). Nothing in it takes a touch
  let MP = null;
  const mateNick = (i) => {
    const R = GAME.coopRun || (GAME.watching && GAME.watching.W && GAME.watching.W.init),
      n = R && R.names && R.names[i];
    return (n && n.nick) || T('coop.mate');
  };
  const mpDrop = () => {
    if (MP) {
      MP.el.remove();
      MP = null;
    }
  };
  function mpFit(el) {
    const box = el.querySelector('.mpk');
    if (!box) return;
    box.style.zoom = '';
    const k = Math.min(0.74, (el.clientWidth - 24) / box.offsetWidth, (el.clientHeight * 0.8) / box.offsetHeight);
    box.style.zoom = k.toFixed(3);
  }
  addEventListener('resize', () => {
    if (MP) mpFit(MP.el);
  });
  function mpOpen(mate, P, key) {
    mpDrop();
    const lv = P.k === 'lv',
      list = (lv ? P.cards : P.items) || [];
    const el = document.createElement('div');
    el.id = 'mpick';
    el.innerHTML = `<div class="mpk ${lv ? '' : 'chest'}"><div class="mph"><b>${esc(mateNick(mate.i))}</b><span class="mpw">${T(lv ? 'coop.picking' : 'coop.opening')}</span><span class="dots"><i></i><i></i><i></i></span></div>
      <div class="cards">${list.map((c, i) => cardHtml(c, i, false)).join('')}</div>
      <div class="mpt"><div class="mpb"><i></i></div><span></span></div></div>`;
    root().appendChild(el);
    MP = {
      el,
      key,
      i: mate.i,
      t: P.t,
      s: -1,
      tl: el.querySelector('.mpt span'),
      bar: el.querySelector('.mpb i'),
      done: 0,
    };
    mpFit(el);
    requestAnimationFrame(() => {
      if (el.isConnected) el.classList.add('on');
    });
  }
  function mpClose(play) {
    const M = MP;
    M.done = 1;
    let e = null;
    for (let i = (play.ev || []).length - 1; i >= 0; i--) {
      const x = play.ev[i];
      if (x.k === 'took' && x.pi === M.i && x.t >= M.t) {
        e = x;
        break;
      }
    }
    const gone = () => {
      M.el.classList.add('gone');
      setTimeout(() => {
        M.el.remove();
        if (MP === M) MP = null;
      }, 320);
    };
    if (!e || play.over) {
      gone();
      return;
    }
    M.el.classList.add('took');
    M.el.querySelectorAll('.cards > .lv').forEach((c, i) => {
      if (e.n < 0 || i === e.n) {
        c.classList.add('pk');
        if (e.n >= 0) c.insertAdjacentHTML('beforeend', `<span class="stamp">${T('coop.stamp')}</span>`);
      } else c.classList.add('drop');
    });
    M.el.querySelector('.mpw').textContent = T(e.n < 0 ? 'coop.tookChest' : 'coop.took');
    M.el.querySelector('.dots').remove();
    setTimeout(gone, 450); // (the run goes on under it: it mustn't hide it long)
    const c = e.n >= 0 ? e.c : null,
      it = c
        ? c.ty === 'main'
          ? { icon: 'i_' + c.id, name: D.MAIN[c.id] && D.MAIN[c.id].name }
          : c.ty === 'heal'
            ? { icon: 'i_medkit', name: T('cards.heal') }
            : c.ty === 'gold'
              ? { icon: 'pk_coin', name: T('cards.gold') }
              : D.ITEMS[c.id]
                ? { icon: D.ITEMS[c.id].icon, name: D.ITEMS[c.id].name }
                : null
        : { icon: 'pk_chest', name: T('coop.tookChest') };
    if (it && it.name) {
      const t = document.createElement('div');
      t.className = 'mtook';
      t.innerHTML = `${img(it.icon, '', '')}<div><b>${esc(mateNick(M.i))}${c ? ' ' + T('coop.took') : ''}</b><span>${esc(it.name)}</span></div>`;
      root().appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }
  }
  function matePick(play) {
    const co = play && play.ps && play.ps.length > 1;
    if (!co || play.pause || GAME.menu) {
      if (MP && (!co || play.pause)) mpDrop();
      return;
    } // (its own card screen comes first)
    const me = play.p,
      mate = play.over ? null : play.ps.find((o) => o !== me && o.pause && !o.gone);
    if (mate) {
      const P = mate.pause,
        key = mate.i + ':' + P.k + ':' + P.t + ':' + (P.cards || P.items || []).map((c) => c.ty + c.id + c.lvl).join();
      if (!MP || MP.key !== key || MP.done) mpOpen(mate, P, key);
      const left = Math.max(0, D.COOP.pick - (play.steps - (P.s0 ?? play.steps)) * SIM.DT),
        s = Math.ceil(left);
      if (s !== MP.s) {
        MP.s = s;
        MP.tl.textContent = T('coop.autoPick', { s });
        MP.bar.style.transform = `scaleX(${(left / D.COOP.pick).toFixed(3)})`;
      }
      return;
    }
    if (MP && !MP.done) mpClose(play);
  }
  // keeps overlays in step with the run state
  U.sync = (play, simT) => {
    matePick(play);
    if (window.BAG) BAG.sync(play); // (the run's backpack: live/bag.js)
    if (window.VOICE) VOICE.sync(play); // (a mission's voice lines: subtitles and recordings)
    skipBtn(play);
    talkFx(play);
    if (!play) return;
    talkDone(play);
    let key = '';
    if (play.over) key = 'over';
    else if (play.pause)
      key =
        play.pause.k +
        ':' +
        play.pause.t +
        ':' +
        (play.pause.cards ? play.pause.cards.map((c) => c.id + c.lvl).join() : '') +
        play.p.rerolls;
    else if (GAME.menu) key = 'menu';
    if (key === curKey) return;
    if (key === 'over') {
      if (play.t - play.over.t < 1.4) return;
      results(play);
    } else if (key.startsWith('lv')) levelUp(play.pause, play);
    else if (key.startsWith('chest')) chest(play.pause);
    else if (key === 'menu') {
      curKey = key;
      return;
    } else U.hide();
    curKey = key;
  };
  // the pieces the screens in other files build with (live/campaign.js)
  U.kit = { show, wire, on, img, coin, T, fmtN, startRun, setMap, ICO, HICO };
})();
