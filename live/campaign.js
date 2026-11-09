// live/campaign.js — the campaign screen: the human's map of San Francisco (assets/bg_campaign.jpg) with the missions on it as a
// route of nodes (done, current, next, soon), the chosen mission's panel (picture, goal, rewards, PLAY) and a little life over the
// picture: leaves on the wind, birds far off, glints on the bay, mist in the corners. Built from the lobby's kit (ui.js U.kit);
// the missions and their rewards are numbers in economy.js.
(function () {
  const U = window.UI,
    E = window.ECONOMY;

  // ---------- where things sit on the picture, in its own pixels (it is 1670 × 942) ----------
  const W = 1670,
    H = 942;
  // each mission's node, and the bends of the road from it to the next one (the last one's road leads off the map)
  const SPOT = {
    office: {
      at: [308, 365],
      via: [
        [415, 392],
        [442, 470],
      ],
    },
    suburb: {
      at: [512, 535],
      via: [
        [600, 505],
        [700, 425],
        [820, 348],
      ],
    },
    lab: {
      at: [895, 315],
      via: [
        [985, 350],
        [1015, 418],
      ],
    },
    port: {
      at: [1142, 432],
      via: [
        [1225, 520],
        [1312, 578],
      ],
    },
    military: {
      at: [1412, 555],
      via: [
        [1425, 680],
        [1530, 668],
        [1636, 636],
      ],
    },
  };
  // the mission panel's picture
  const PIC = {
    office: 'bg_mis_office.jpg',
    suburb: 'bg_loc_suburb.png',
    lab: 'bg_loc_lab.png',
    port: 'bg_mis_port.jpg',
    military: 'bg_mis_military.jpg',
  };
  // spots on the water where the sun glints
  const GLINT = [
    [1262, 372],
    [1418, 512],
    [1560, 410],
    [1498, 300],
    [1334, 280],
    [786, 612],
    [868, 708],
    [958, 822],
    [1046, 762],
    [1104, 604],
    [1612, 262],
    [1180, 300],
  ];

  const ICO = {
    skull:
      '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M12 2.5c-5 0-8.5 3.4-8.5 8 0 2.7 1.3 4.6 3 5.6V19a1.5 1.5 0 0 0 1.5 1.5h1v-2.2h1.6v2.2h2.8v-2.2h1.6v2.2h1a1.5 1.5 0 0 0 1.5-1.5v-2.9c1.7-1 3-2.9 3-5.6 0-4.6-3.5-8-8.5-8zM8.6 9.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm6.8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM12 14.2l1.3 2.3h-2.6z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.6 4.6L19.2 7.4" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><path d="M7.6 10.5V8a4.4 4.4 0 0 1 8.8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="4.6" y="10" width="14.8" height="11" rx="2.4" fill="currentColor"/></svg>',
    bang: '<svg viewBox="0 0 24 24"><path d="M12 3.5v10.5" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/><circle cx="12" cy="19.6" r="2.4" fill="currentColor"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-7.4 7-12a7 7 0 1 0-14 0c0 4.6 7 12 7 12z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#1d1f17"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right:
      '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bird: '<svg viewBox="0 0 20 8"><path d="M1 6.5Q5.5 0 10 5Q14.5 0 19 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };
  const xpIcon = (label) =>
    `<svg class="xp" viewBox="0 0 24 24"><defs><linearGradient id="cxpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#1f66d0"/></linearGradient></defs><path d="M12 1.8l3 6.3 6.9.9-5.1 4.7 1.4 6.8L12 17l-6.2 3.5 1.4-6.8L2.1 9l6.9-.9z" fill="url(#cxpg)" stroke="#0b2552" stroke-width="1.1" stroke-linejoin="round"/><text x="12" y="14.4" text-anchor="middle" font-size="6.4" font-weight="900" fill="#fff">${label}</text></svg>`;

  const pct = (v, of) => ((v / of) * 100).toFixed(2) + '%';
  const pic = (file) => `assets/${file}?v=${window.__V || 0}`;
  // a smooth road through the points: Catmull-Rom as cubic Béziers
  const curve = (p) => {
    const r = (n) => Math.round(n * 10) / 10;
    let d = `M${p[0][0]} ${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i - 1] || p[i],
        b = p[i],
        c = p[i + 1],
        e = p[i + 2] || c;
      d +=
        ` C${r(b[0] + (c[0] - a[0]) / 6)} ${r(b[1] + (c[1] - a[1]) / 6)}` +
        ` ${r(c[0] - (e[0] - b[0]) / 6)} ${r(c[1] - (e[1] - b[1]) / 6)} ${c[0]} ${c[1]}`;
    }
    return d;
  };

  // the missions finished (the save's; ?camp=office,suburb on a local page shows a later state)
  const finished = () => {
    if (!window.__STATIC__) {
      const q = new URLSearchParams(location.search).get('camp');
      if (q !== null) return q.split(',').filter(Boolean);
    }
    return (window.SAVE && SAVE.camp) || [];
  };
  // each mission's state: done, cur (the first one not done), next (playable later), soon (locked)
  const states = (done) => {
    let cur = null;
    const st = {};
    for (const m of E.MISSIONS) {
      if (m.soon) st[m.id] = 'soon';
      else if (done.includes(m.id)) st[m.id] = 'done';
      else if (!cur) st[(cur = m.id)] = 'cur';
      else st[m.id] = 'next';
    }
    return { st, cur };
  };

  // the road: the part already travelled (up to the current mission) and the part ahead, which marches
  function route(cur) {
    const pts = [],
      split = { at: 0 };
    for (const m of E.MISSIONS) {
      const s = SPOT[m.id];
      if (m.id === cur) split.at = pts.length;
      pts.push(s.at, ...s.via);
    }
    const tail = pts.slice(-3),
      gone = curve(pts.slice(0, split.at + 1)),
      ahead = curve(pts.slice(split.at)),
      [p, q] = [tail[1], tail[2]],
      ang = Math.atan2(q[1] - p[1], q[0] - p[0]),
      tip = (k, s) => `${q[0] + Math.cos(ang + k) * s} ${q[1] + Math.sin(ang + k) * s}`;
    const arrow = `M${tip(0, 4)} L${tip(2.5, 16)} L${tip(-2.5, 16)} Z`;
    const path = (d, cls) => `<path class="sh ${cls}" d="${d}"/><path class="rd ${cls}" d="${d}"/>`;
    return (
      `<svg class="croute" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      (split.at > 0 ? path(gone, 'gone') : '') +
      path(ahead, 'ahead') +
      `<path class="tip" d="${arrow}"/></svg>`
    );
  }

  function node(m, s, T) {
    const [x, y] = SPOT[m.id].at,
      icon = s === 'done' ? ICO.check : s === 'soon' ? ICO.lock : ICO.skull;
    return (
      `<button class="cnode ${s}" data-m="${m.id}" style="left:${pct(x, W)};top:${pct(y, H)}" aria-label="${T('mission.' + m.id + '.name')}">` +
      (s === 'cur' ? `<span class="cnb">${ICO.bang}</span>` : '') +
      `<span class="cnc">${icon}</span><span class="cnn">${m.n}</span></button>`
    );
  }

  // leaves on the wind, two flocks of birds in the sky, glints on the water, mist in the lower corners; none when the system asks
  // for less motion, fewer leaves on a phone
  function life() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return '';
    const small = matchMedia('(pointer: coarse), (max-width: 900px)').matches,
      rnd = (a, b) => a + Math.random() * (b - a),
      f = (v) => v.toFixed(2);
    let h = '<i class="mist l"></i><i class="mist r"></i>';
    for (let i = 0, n = small ? 7 : 14; i < n; i++)
      h += `<i class="lf" style="--y:${f(rnd(4, 72))}%;--d:${f(rnd(11, 19))}s;--w:${f(-rnd(0, 19))}s;--fall:${f(rnd(6, 20))}cqh;--s:${f(rnd(0.7, 1.25))};--h:${Math.round(rnd(48, 92))}"><i></i></i>`;
    for (const [y, d, w] of [
      [5, 64, -10],
      [11, 86, -52],
    ])
      h += `<span class="fl" style="--y:${y}%;--d:${d}s;--w:${w}s">${ICO.bird}${ICO.bird}${ICO.bird}</span>`;
    for (const [x, y] of GLINT)
      h += `<i class="gl" style="left:${pct(x, W)};top:${pct(y, H)};--d:${f(rnd(2.6, 4.8))}s;--w:${f(-rnd(0, 4))}s"></i>`;
    return `<div class="cfx">${h}</div>`;
  }

  function panel(m, s, K) {
    const { T, fmtN, coin } = K,
      locked = s === 'soon',
      r = m.reward,
      rewards = locked
        ? `<span class="csoon">${T('campaign.soon')}</span>`
        : `<span class="rw">${coin()}<b>${fmtN(r.coins)}</b></span><span class="rw">${xpIcon(T('campaign.xp'))}<b>${fmtN(r.xp)}</b></span>` +
          r.items
            .map(
              ([id, n]) =>
                `<span class="rw" title="${T('item.' + id)}"><img src="${pic('it_' + id + '.png')}" alt="${T('item.' + id)}" draggable="false"><b>×${n}</b></span>`,
            )
            .join('');
    return (
      `<div class="cpic${locked ? ' off' : ''}"><img src="${pic(PIC[m.id])}" alt="" draggable="false">${locked ? `<span class="clk">${ICO.lock}</span>` : ''}</div>` +
      `<div class="ctx"><h3><b>${m.n}</b>${T('mission.' + m.id + '.name')}</h3><p>${T('mission.' + m.id + '.goal')}</p></div>` +
      `<div class="crw"><h4>${T('campaign.rewards')}</h4><div class="crr">${rewards}</div></div>` +
      `<button class="cta" data-play ${s === 'next' || locked ? 'disabled' : ''}><span class="pi">${K.ICO.play}</span><span>${T('common.play')}</span></button>`
    );
  }

  U.campaign = () => {
    const K = U.kit,
      { T } = K,
      { st, cur } = states(finished());
    let sel = cur || E.MISSIONS[0].id;
    if (st.office === 'cur' && window.INTRO) INTRO.warm(); // the intro's picture on its way before PLAY
    const el = K.show(
      `<div class="cwrap"><div class="cmap"><img class="cbg" src="${pic('bg_campaign.jpg')}" alt="" draggable="false">` +
        route(cur) +
        life() +
        E.MISSIONS.map((m) => node(m, st[m.id], T)).join('') +
        `</div></div>
      <div class="pg">
        <button class="lbp back" data-hub><span class="ic">${K.HICO.back}</span>${T('campaign.base')}</button>
        <div class="ctitle"><span class="ic">${ICO.pin}</span><span>${T('campaign.title')}</span></div>
        <div class="tr"><div class="lbp coin">${K.coin()}<span class="cn">${K.fmtN(SAVE.coins)}</span></div></div>
        <button class="lbp carr l" disabled aria-hidden="true">${ICO.left}</button>
        <button class="lbp carr r" disabled aria-hidden="true">${ICO.right}</button>
        <div class="cpanel"></div>
      </div>`,
      'pageScr',
    );
    el.id = 'campaign';
    U.live = false;
    U.scene = '';
    U.opaque = true; // the map covers the screen: nothing to draw behind it
    K.wire(el);
    const box = el.querySelector('.cpanel'),
      pick = (id) => {
        sel = id;
        const m = E.mission(id);
        box.innerHTML = panel(m, st[id], K);
        el.querySelectorAll('.cnode').forEach((b) => b.classList.toggle('sel', b.dataset.m === id));
        K.on(box, '[data-play]', () => {
          const go = () => {
            K.setMap(m.map);
            // the current mission: its own script (live/missions.js); one won before: a classic run on its map (a
            // mission pays once, rules.js current)
            K.startRun(SAVE.selected, RULES.current(SAVE) === m.id ? m.id : null);
          };
          // mission 1 the first time: the intro first (intro.js)
          if (id === 'office' && st[id] === 'cur' && window.INTRO && INTRO.due()) INTRO.play(go);
          else go();
        });
      };
    K.on(el, '.cnode', (b) => pick(b.dataset.m));
    K.on(el, '[data-hub]', () => GAME.hub()); // BASE: NEAR Base, walked (live/hub.js; its way back: the map, the lobby)
    pick(sel);
    return el;
  };
})();
