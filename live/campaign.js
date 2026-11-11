// live/campaign.js — the campaign screen: the human's map of San Francisco (assets/bg_campaign.jpg) with the missions on it as a
// route of nodes (done, current, next, soon), the chosen mission's panel (picture, goal, rewards, PLAY) and a little life over the
// picture: the bay's water moving (WebGL), leaves on the wind, birds far off, glints on the bay, mist in the corners. Built from
// the lobby's kit (ui.js U.kit); the missions and their rewards are numbers in economy.js. Each mission's picture is its card
// cut from this map (assets/bg_mis_<id>.jpg), the lobby's card shows the same one.
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

  // the bay's water: the box on the picture its mask covers (gen/watermask.py prints it), x y w h
  const WATER = [744, 256, 926, 643];

  const ICO = {
    skull:
      '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M12 2.5c-5 0-8.5 3.4-8.5 8 0 2.7 1.3 4.6 3 5.6V19a1.5 1.5 0 0 0 1.5 1.5h1v-2.2h1.6v2.2h2.8v-2.2h1.6v2.2h1a1.5 1.5 0 0 0 1.5-1.5v-2.9c1.7-1 3-2.9 3-5.6 0-4.6-3.5-8-8.5-8zM8.6 9.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm6.8 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM12 14.2l1.3 2.3h-2.6z"/></svg>',
    // a mission won: its map is open for raids again (two arrows round)
    again:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12a7 7 0 0 1-12.2 4.7M5 12a7 7 0 0 1 12.2-4.7M17.6 3.4v4.2h-4.2M6.4 20.6v-4.2h4.2"/></svg>',
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

  // a mission's node: mission 1 won is NEAR Base, a house; another one won, a raid again; locked, a padlock; else the skull
  function node(m, s, K) {
    const [x, y] = SPOT[m.id].at,
      home = s === 'done' && m.map === 'office',
      icon = home ? K.ICO.base : s === 'done' ? ICO.again : s === 'soon' ? ICO.lock : ICO.skull,
      T = K.T;
    return (
      `<button class="cnode ${s}${home ? ' home' : ''}" data-m="${m.id}" style="left:${pct(x, W)};top:${pct(y, H)}" aria-label="${T('mission.' + m.id + '.name')}">` +
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

  // the bay alive: the map's own water drawn again over it by a small WebGL layer on the water's box, a pixel or two off its
  // place in slow swells (the ripples painted on it move), light running over the open water, the surf round the rocks coming
  // and going. The mask (assets/mask_water.png, gen/watermask.py): red the water, green the surf; land is never pulled into the
  // water. None when the system asks for less motion or without WebGL: the picture stays as it is. It stops with the screen.
  const WATER_VS =
    'attribute vec2 a;varying vec2 v;void main(){v=a;gl_Position=vec4(a.x*2.0-1.0,1.0-a.y*2.0,0.0,1.0);}';
  const WATER_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D map, mask;
uniform float t;
uniform vec4 box; // the water's box on the map, in its uv
uniform vec2 px; // the map's size in pixels
varying vec2 v;
void main() {
  vec3 w = texture2D(mask, v).rgb;
  float a = max(w.r, w.g);
  if (a < 0.004) { gl_FragColor = vec4(0.0); return; }
  vec2 uv = box.xy + v * box.zw, q = uv * px;
  // the swell: two slow waves across each other move the water a pixel or two
  vec2 d = vec2(sin(q.y * 0.06 + t * 1.1) + 0.7 * sin(q.x * 0.031 + q.y * 0.045 - t * 0.8),
                cos(q.x * 0.045 - t * 0.9) + 0.7 * sin(q.y * 0.04 - q.x * 0.027 + t * 0.6)) * 1.5;
  float k = texture2D(mask, v + d / px / box.zw).r * w.r; // only water is pulled into water
  vec3 c = texture2D(map, uv + k * d / px).rgb;
  // light running over the open water in long streaks
  float l = sin(q.x * 0.02 + q.y * 0.07 - t * 1.3 + 1.8 * sin(q.x * 0.011 - q.y * 0.017 + t * 0.35));
  float l2 = 0.5 + 0.5 * sin(q.x * 0.05 - q.y * 0.02 + t * 0.7);
  c += vec3(0.62, 0.86, 1.0) * smoothstep(0.8, 1.0, l) * l2 * 0.2 * w.r * (1.0 - w.g);
  // the surf: it washes in and out along the shore
  float f = 0.5 + 0.5 * sin(t * 1.6 - (q.x * 0.9 + q.y) * 0.03);
  c = mix(c, vec3(0.15, 0.52, 0.71), w.g * (1.0 - f) * 0.85);
  gl_FragColor = vec4(c * a, a);
}`;
  function water(wrap) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bg = wrap.querySelector('.cbg'),
      mask = new Image(),
      cv = document.createElement('canvas'),
      gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl) return;
    cv.className = 'cwater';
    cv.style.cssText = `left:${pct(WATER[0], W)};top:${pct(WATER[1], H)};width:${pct(WATER[2], W)};height:${pct(WATER[3], H)}`;
    mask.src = pic('mask_water.png');
    Promise.all([bg.decode(), mask.decode()]).then(
      () => {
        if (!wrap.isConnected) return;
        const pr = gl.createProgram(),
          sh = (type, src) => {
            const o = gl.createShader(type);
            gl.shaderSource(o, src);
            gl.compileShader(o);
            gl.attachShader(pr, o);
          };
        sh(gl.VERTEX_SHADER, WATER_VS);
        sh(gl.FRAGMENT_SHADER, WATER_FS);
        gl.bindAttribLocation(pr, 0, 'a');
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return console.warn('water', gl.getProgramInfoLog(pr));
        gl.useProgram(pr);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        [bg, mask].forEach((im, i) => {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          // the map's colours as the page shows them; the mask's numbers as they are
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, i ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
          for (const [k, val] of [
            [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
            [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
          ])
            gl.texParameteri(gl.TEXTURE_2D, k, val);
        });
        const u = (n) => gl.getUniformLocation(pr, n);
        gl.uniform1i(u('map'), 0);
        gl.uniform1i(u('mask'), 1);
        gl.uniform4f(u('box'), WATER[0] / W, WATER[1] / H, WATER[2] / W, WATER[3] / H);
        gl.uniform2f(u('px'), W, H);
        const ut = u('t'),
          t0 = performance.now();
        let raf = 0;
        cv.addEventListener('webglcontextlost', () => {
          cancelAnimationFrame(raf);
          cv.remove();
        });
        // drawn at the screen's pixels, at most twice the picture's own (more shows nothing new)
        const frame = (now) => {
          if (!cv.isConnected) {
            const x = gl.getExtension('WEBGL_lose_context'); // the screen gone: its context let go at once
            return x && x.loseContext();
          }
          raf = requestAnimationFrame(frame);
          const dpr = window.devicePixelRatio || 1,
            w = Math.round(Math.min(cv.clientWidth * dpr, WATER[2] * 2)),
            h = Math.round((w * WATER[3]) / WATER[2]);
          if (w !== cv.width || h !== cv.height) {
            cv.width = w;
            cv.height = h;
            gl.viewport(0, 0, w, h);
          }
          gl.uniform1f(ut, (now - t0) / 1000);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        bg.after(cv);
        raf = requestAnimationFrame(frame);
      },
      () => {},
    );
  }

  // the chosen mission's panel. Its button: the current mission's PLAY (its script); one won before: mission 1's office
  // is NEAR Base now (its inside, the base's map), so it goes there; the others play a raid on their map (a
  // classic run: containers, the evac, no story, no reward again); one not reached yet or locked: nothing
  function panel(m, s, K) {
    const { T, fmtN, coin } = K,
      locked = s === 'soon',
      done = s === 'done',
      home = done && m.map === 'office',
      label = T(home ? 'hub.title' : done ? 'campaign.raid' : 'common.play'),
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
      `<div class="cpic${locked ? ' off' : ''}"><img src="${pic('bg_mis_' + m.id + '.jpg')}" alt="" draggable="false">${locked ? `<span class="clk">${ICO.lock}</span>` : ''}</div>` +
      `<div class="ctx"><h3><b>${m.n}</b>${T('mission.' + m.id + '.name')}</h3>` +
      `<p>${T(home ? 'campaign.doneBase' : done ? 'campaign.doneRaid' : 'mission.' + m.id + '.goal')}</p></div>` +
      `<div class="crw"><h4>${T(done ? 'campaign.got' : 'campaign.rewards')}</h4><div class="crr${done ? ' got' : ''}">${rewards}</div></div>` +
      `<button class="cta${label.length > 7 ? ' long' : ''}" data-play ${s === 'next' || locked ? 'disabled' : ''}>` +
      `<span class="pi">${home ? K.ICO.base : done ? ICO.again : K.ICO.play}</span><span class="tx">${label}</span></button>`
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
        E.MISSIONS.map((m) => node(m, st[m.id], K)).join('') +
        `</div></div>
      <div class="pg">
        <button class="lbp back" data-hub><span class="ic">${K.HICO.back}</span>${T('campaign.base')}</button>
        <div class="ctitle"><span class="ic">${ICO.pin}</span><span>${T('campaign.title')}</span></div>
        <div class="tr"><div class="lbp coin">${K.coin()}<span class="cn">${K.fmtN(SAVE.coins)}</span></div></div>
        <button class="lbp carr l" data-step="-1" aria-label="${T('campaign.prev')}">${ICO.left}</button>
        <button class="lbp carr r" data-step="1" aria-label="${T('campaign.next')}">${ICO.right}</button>
        <div class="cpanel"></div>
      </div>`,
      'pageScr',
    );
    el.id = 'campaign';
    water(el);
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
        const at = E.MISSIONS.indexOf(m);
        el.querySelector('.carr.l').disabled = at <= 0;
        el.querySelector('.carr.r').disabled = at >= E.MISSIONS.length - 1;
        K.on(box, '[data-play]', () => {
          // the current mission: its own script (live/missions.js, ui.js playCurrent: the intro before mission 1);
          // the office won: NEAR Base; another one won: a raid, a classic run on its map (a mission pays once)
          if (RULES.current(SAVE) === m.id) K.playCurrent();
          else if (m.map === 'office') GAME.hub();
          else {
            K.setMap(m.map);
            K.startRun(SAVE.selected, null);
          }
        });
      };
    K.on(el, '.cnode', (b) => pick(b.dataset.m));
    // the arrows: the mission before or after the one shown
    K.on(el, '[data-step]', (b) => {
      const i = E.MISSIONS.findIndex((q) => q.id === sel) + +b.dataset.step;
      if (E.MISSIONS[i]) pick(E.MISSIONS[i].id);
    });
    K.on(el, '[data-hub]', () => GAME.hub()); // BASE: NEAR Base, walked (live/hub.js; its way back: the map, the lobby)
    pick(sel);
    return el;
  };
})();
