// live/scene.js — the look: a pure function of t and the sim state (engine.md §7).
// Layers: iso ground chunks (+ lit decals) → light map multiply → contact shadows → ONE depth-sorted instanced band
// (props, buildings, rigged actors, turrets, pickups, chests) → air FX from events → canopies → bloom/grade → HUD.
(function () {
  const S = (window.SCENE = {}),
    L = LIB,
    B = BATCH,
    D = DATA,
    H = SIM.VIEW.H,
    RIGS = window.RIGS || {};
  let W = SIM.VIEW.W; // the view's width: 1920, more on a window wider than 16:9 (S.view)
  const TAU = Math.PI * 2,
    clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
    SS = L.SS,
    rnd = L.rnd;
  const FONT = '"Rubik", "Trebuchet MS", "Segoe UI", sans-serif';
  const OFFLINE = new URLSearchParams(location.search).has('render'); // render.mjs / qa.mjs: paint every chunk at once
  S.state = null;

  // ================================================================== setup
  S.programs = () => {
    // the light map multiplies the ground; light above 1 (lamp pools, blasts) rolls off instead of burning the ground out
    L.init(W, H, {
      mul: `uniform sampler2D u_src; void main(){ vec3 L = texture(u_src, scr(v_px)).rgb; o = vec4(min(L, vec3(1.0)) + max(L - 1.0, 0.0) * 0.55, 1.0); }`,
      cham: `uniform vec2 u_sz; uniform float u_c, u_a, u_rim, u_bw; uniform vec3 u_c0, u_c1, u_edge, u_rimc;
void main(){ vec2 p = (v_uv - 0.5) * u_sz, h = u_sz * 0.5, q = abs(p);
  float d = max(max(q.x - h.x, q.y - h.y), (q.x + q.y - (h.x + h.y - u_c)) * 0.7071);
  float m = 1.0 - smoothstep(-0.7, 0.7, d), edge = smoothstep(-0.7, 0.7, d + u_bw), rim = smoothstep(-0.7, 0.7, d + u_bw + 2.0) * (1.0 - edge);
  vec3 c = mix(mix(u_c0, u_c1, v_uv.y), u_edge, edge); c = mix(c, u_rimc, rim * u_rim); o = vec4(c * m * u_a, m * u_a); }`,
      lobtex: LOBBY.FS_TEX,
      lobdim: LOBBY.FS_DIM,
      lobfade: LOBBY.FS_FADE,
      // the aimed gun's reach on the ground (aimZone): a wedge from the muzzle along the aim, its spread wide, out to where the
      // shots end — a faint fill fuller toward the reach with bands flowing outward, a fine line down each side, a crisp arc at the reach.
      // The quad: u from the muzzle out along the aim (u_R × 1.04 px), v across (2 u_hw px)
      aimzone: `uniform float u_R, u_h, u_hw, u_r0, u_a, u_tt; uniform vec3 u_c;
void main(){ vec2 lp = vec2(v_uv.x * u_R * 1.04, (v_uv.y - 0.5) * 2.0 * u_hw); float r = length(lp), k = r / u_R, sh = sin(u_h), ch = cos(u_h);
  float ein = min(sh * lp.x - ch * lp.y, sh * lp.x + ch * lp.y);                       // px inside the wedge (< 0: outside)
  float inW = smoothstep(-0.8, 0.8, ein), inR = smoothstep(u_R + 1.0, u_R - 1.0, r) * smoothstep(u_r0, u_r0 + 26.0, r);
  float band = smoothstep(0.78, 1.0, fract(r / 58.0 - u_tt * 1.25)) * smoothstep(0.08, 0.3, k) * (1.0 - smoothstep(0.82, 0.97, k));
  float side = smoothstep(14.0, 0.0, ein);                                            // a soft glow inside along each side
  float fill = (0.1 + 0.16 * k * k + 0.12 * band + 0.12 * side) * inW * inR;
  float edge = (smoothstep(1.8, 0.4, abs(ein)) * 0.85 + exp(-ein * ein / 18.0) * 0.25) * inR * mix(0.9, 0.55, k);
  float ad = r - (u_R - 2.0), arc = (smoothstep(2.4, 0.8, abs(ad)) + exp(-ad * ad / 60.0) * 0.4 + smoothstep(0.0, -22.0, ad) * smoothstep(-40.0, -22.0, ad) * 0.14) * smoothstep(-1.2, 1.2, ein) * step(u_r0, r);
  float a = clamp(fill + edge + arc, 0.0, 1.0) * u_a;
  o = vec4(mix(u_c, vec3(1.0), clamp(arc * 0.6 + edge * 0.4, 0.0, 1.0)) * a, a); }`,
      // the actors' cast shadows (castActors): their mask's coverage darkens the light map in the baked shadows' cool grey
      shade: `uniform sampler2D u_src; uniform float u_k; void main(){ float a = min(texture(u_src, scr(v_px)).r, 1.0); o = vec4(vec3(1.0) - a * u_k * vec3(0.58, 0.6, 0.46), 1.0); }`,
    });
    B.init();
    T.fxHero = B.buf(64); // the minigun's streak: its own additive batch (see drawHero)
    S.scale(1);
    void L.P.crack; // the boss slams' cracks: compiled while loading, not mid-fight
  };
  const T = {};
  // the world drawn at scale × the view's pixels (index.html: a phone's run at 0.6, lower while frames run long); between frames
  S.scale = (sc) => {
    if (L.SCALE !== sc && L.T.bg) L.scale(sc);
    own(sc);
  };
  // the view's width (the canvas's, index.html: a window wider than 16:9 shows more of the world beside, as the sim's S.vw)
  S.view = (w) => {
    if (w === W) return;
    W = w;
    L.view(w);
    own(L.SCALE);
  };
  function own(sc) {
    // the scene's own targets: the light map, the actors' shadow mask
    for (const k of ['light', 'shad', 'shad2']) G.free(T[k]);
    const n = (v) => Math.max(1, Math.round(v));
    T.light = G.target(n((W * sc) / 2), n((H * sc) / 2), true, { view: [W, H] });
    T.shad = G.target(n((W * sc) / 2), n((H * sc) / 2), false, { view: [W, H] });
    T.shad2 = G.target(n((W * sc) / 2), n((H * sc) / 2), false, { view: [W, H] }); // the actors' shadow mask, blurred through shad2
  }
  // the programs a run draws with, compiled in the background while the lobby is up (index.html, once the world is in): PLAY doesn't
  // wait on the driver for them
  S.warm = () =>
    L.warm(['copy', 'sprite', 'blur', 'bright', 'final', 'solid', 'rrect', 'crack', 'shade', 'mul', 'cham', 'aimzone']);
  S.low = false; // a phone: the zombies' cast shadows plain shapes (their rigs drawn once, not twice)
  // atlases: actors & small things (0), the map's own (1: the town's props, buildings and plants, or the lab's props, its zombies and
  // its walls — S.useMap), canvas-made extras (2)
  const LABRIG = /^a_l[a-z]+__/; // the lab's zombies' parts (its atlas only)
  let CITY1 = null,
    RIGSKIN = {}; // the town's atlas list; the rig each zombie kind wears on this map (DATA.MAPS skin)
  S.mapId = 'city';
  // the map a run goes to: its atlas made (a run on another map than the last: under the start spinner, index.html
  // waits). The office ('office') is the town's ground and plants with its own props (the town's, the lab's furniture it
  // borrows, its own of_ ones; the editor: every one of them); its inside and NEAR Base ('base', the same map) draw from it
  let M1IN = false; // (the third atlas holds mission 1's pictures now)
  S.useMap = async (id) => {
    id = id === 'office_in' || id === 'base' ? 'office' : id === 'lab' || id === 'office' ? id : 'city'; // (the office's
    // inside: the same pictures as its outside, both maps' props in the one atlas, so its door needs no loading)
    if (S.mapId === id || !CITY1) return;
    const A = window.ASSETS;
    let list = CITY1,
      list2 = []; // (mission 1's own pictures, m1_: the third atlas, beside the canvas-made extras)
    if (id === 'office') {
      const ed = /[?&]editor\b/.test(location.search),
        own = new Set([
          'iso_barrier',
          'p_lamp',
          ...SIM.HUB_NPC.map((q) => q[0]),
          ...(SIM.HUB_BUILD || []).map((q) => q[0]),
        ]); // (Walt
      // and Nova at the base, its buildings' furniture: sim.js HUB_BUILD)
      for (const M of [window.MAP_OFFICE, window.MAP_OFFICE_IN, window.MAP_BASE]) {
        for (const p of M ? M.props : []) {
          own.add(p[0]);
          if (p[3] & 2) own.add(p[0] + '_b');
        }
        for (const p of M ? M.bushes : []) own.add(p[0]);
      }
      list = CITY1.filter((e) => ed || own.has(e.name) || /^p_/.test(e.name));
      for (const n in A)
        if ((/^(lb_|np_)/.test(n) && (own.has(n) || ed)) || /^of_/.test(n)) {
          const pn = n.replace(/_b$/, '');
          list.push({ name: n, scale: Math.min(1, ((SIM.PROP[pn] ? SIM.PROP[pn].w : 120) * 1.36) / A[n].w) });
        } else if (/^m1_/.test(n) && (own.has(n) || ed))
          list2.push({ name: n, scale: Math.min(1, ((SIM.PROP[n] ? SIM.PROP[n].w : 120) * (ed ? 1 : 1.36)) / A[n].w) }); // (the
      // editor: every one of them, a little smaller)
    } else if (id !== 'city') {
      const ed = /[?&]editor\b/.test(location.search),
        own = new Set(['iso_barrier', 'p_lamp']),
        M = window.MAP_LAB;
      list = []; // (a run: its map's props only; the editor: all)
      for (const p of M ? M.props : []) {
        own.add(p[0]);
        if (p[3] & 2) own.add(p[0] + '_b');
      }
      for (const n in A) {
        if (LABRIG.test(n)) {
          if (id === 'lab') list.push({ name: n, scale: 0.64 });
        } else if (own.has(n) || (ed && /^lb_/.test(n))) {
          const pn = n.replace(/_b$/, '');
          list.push({ name: n, scale: Math.min(1, ((SIM.PROP[pn] ? SIM.PROP[pn].w : 120) * 1.36) / A[n].w) });
        }
      }
    } // (<prop>_b: its back)
    for (const k in B.R) if (B.R[k].t === 1) delete B.R[k];
    const lab = id === 'lab';
    await B.atlas(1, list, lab ? wallCanvases() : []);
    // the third atlas: the canvas-made extras, and on the office's maps mission 1's own pictures (each atlas holds 4096 x
    // 4096 at the most: in the first they would push others out, drawn as nothing but their shadows)
    if (list2.length || M1IN) {
      for (const k in B.R) if (B.R[k].t === 2) delete B.R[k];
      await B.atlas(2, list2, extraCanvases());
      M1IN = list2.length > 0;
    }
    if (lab && !WK) await GP.lab(loadImg); // (painting on the page: the lab's tiles first)
    S.mapId = id;
    const m = D.MAPS.find((q) => q.id === id);
    RIGSKIN = (m && m.skin) || {};
  };
  const rigOf = (k) => RIGSKIN[k] || D.ENEMIES[k].rig;
  S.load = async () => {
    const A = window.ASSETS,
      a0 = [],
      a1 = [];
    const gone = new Set(
      Object.values(D.ENEMIES)
        .filter((d) => d.b3d && window.CHARMESH && CHARMESH.has(d.b3d))
        .map((d) => d.rig),
    ); // cut-out rigs replaced by 3D models (loaded)
    for (const n in A) {
      if (n.includes('__') && (gone.has(n.split('__')[0]) || LABRIG.test(n))) continue;
      if (/^(lb_|t_lf_)/.test(n)) continue; // (the lab's: its atlas, its ground)
      if (n.includes('__')) {
        const rig = n.split('__')[0],
          big = /tank|golem|butcher|pustule|screamer/.test(rig);
        if (rig === 'a_hero') continue;
        a0.push({ name: n, scale: big ? 0.95 : 0.64 });
      } // (0.64: a zombie's parts near 1:1 on a 1080p screen)
      else if (/^(pk_|s_)/.test(n))
        a0.push({ name: n, scale: Math.min(1, 160 / Math.max(A[n].w, A[n].h)) }); // (w_: the guns' pictures, penguin.js loads them)
      else if (/^i_/.test(n)) a0.push({ name: n, scale: Math.min(1, 132 / Math.max(A[n].w, A[n].h)) });
      else if (/^fx_/.test(n))
        a0.push({ name: n, scale: Math.min(1, (/wreck/.test(n) ? 150 : 72) / Math.max(A[n].w, A[n].h)) }); // (the burst barrel and its pieces)
      else if (/^(iso_kerb|p_tufts|p_ivy)/.test(n))
        continue; // painted with the ground only (ground.js)
      // props and plants at about the size the camera shows them (1.35×; the trees as large as the map has them): the trees and the
      // big bushes in the first atlas (the second is full of the props)
      else if (/^(bld_|iso_|p_)/.test(n)) {
        const pw = SIM.PROP[n]
          ? SIM.PROP[n].w
          : /tree/.test(n)
            ? 370
            : /mbush/.test(n)
              ? 200
              : /bush/.test(n)
                ? 130
                : /graffiti/.test(n)
                  ? 150
                  : /clover|tallgrass|daisy|pinkflower|whiteflower/.test(n)
                    ? 150
                    : /flower/.test(n)
                      ? 60
                      : 120;
        (/^p_(m?tree|mbush)/.test(n) ? a0 : a1).push({ name: n, scale: Math.min(1, (pw * 1.36) / A[n].w) });
      }
    }
    if (window.ECONOMY) for (const it of ECONOMY.ITEMS) a0.push({ name: 'it_' + it.id, scale: 0.25 }); // (the things for the backpack: 64 px)
    await B.atlas(0, a0);
    CITY1 = a1;
    await B.atlas(1, a1);
    await B.atlas(2, [], extraCanvases());
    await groundStart();
  };

  // ================================================================== canvas-made extras (decals, digits)
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function blob(g, cx, cy, r, n, jag, R) {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU,
        rr = r * (1 - jag + R() * jag * 2),
        x = cx + Math.cos(a) * rr,
        y = cy + Math.sin(a) * rr;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  }
  function prng(seed) {
    let s = seed;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
  function extraCanvases() {
    const out = [];
    for (let v = 0; v < 6; v++) {
      const R = prng(11 + v * 97),
        c = mk(128, 128),
        g = c.getContext('2d');
      g.fillStyle = 'rgba(150,22,48,0.92)';
      blob(g, 64, 64, 24 + R() * 10, 14, 0.35, R);
      g.fill();
      for (let i = 0; i < 24; i++) {
        const a = R() * TAU,
          d = 30 + R() * 32;
        g.beginPath();
        g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + R() * 3, 0, TAU);
        g.fill();
      }
      for (let i = 0; i < 9; i++) {
        const a = R() * TAU,
          d = 28 + R() * 30;
        g.beginPath();
        g.ellipse(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + R() * 6, 2 + R() * 4, a, 0, TAU);
        g.fill();
      }
      g.fillStyle = 'rgba(190,40,70,0.8)';
      blob(g, 60, 60, 12 + R() * 6, 10, 0.3, R);
      g.fill();
      out.push({ name: 'x_blood' + v, cv: c });
    }
    for (let v = 0; v < 3; v++) {
      const R = prng(301 + v * 13),
        c = mk(128, 128),
        g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      gr.addColorStop(0, 'rgba(12,8,6,0.9)');
      gr.addColorStop(0.55, 'rgba(26,18,12,0.55)');
      gr.addColorStop(1, 'rgba(26,18,12,0)');
      g.fillStyle = gr;
      blob(g, 64, 64, 60, 18, 0.18, R);
      g.fill();
      out.push({ name: 'x_scorch' + v, cv: c });
    }
    for (let v = 0; v < 2; v++) {
      const R = prng(501 + v * 7),
        c = mk(128, 128),
        g = c.getContext('2d');
      g.fillStyle = 'rgba(80,190,30,0.6)';
      blob(g, 64, 64, 56, 16, 0.2, R);
      g.fill();
      g.fillStyle = 'rgba(170,255,70,0.55)';
      blob(g, 60, 60, 34, 12, 0.25, R);
      g.fill();
      g.fillStyle = 'rgba(230,255,170,0.75)';
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        g.arc(30 + R() * 68, 36 + R() * 56, 2 + R() * 4, 0, TAU);
        g.fill();
      }
      out.push({ name: 'x_acid' + v, cv: c });
    }
    // damage digits: white and crit yellow; the hero's own hurt red, hot at the top, with its minus (fill: a colour or gradient stops)
    for (const [nm, px, fill, stroke, chars = '0123456789'] of [
      ['x_dig', 44, '#ffffff', '#2a0a0a'],
      ['x_digc', 60, '#ffd23a', '#4a1400'],
      ['x_digh', 58, ['#ffc2b0', '#ff4436', '#b80c18'], '#2a0206', '0123456789-'],
      ['x_digg', 50, ['#e2ffd8', '#5cff74', '#13a02e'], '#03280a', '0123456789+'],
    ]) {
      const f = `900 ${px}px ${FONT}`,
        m = mk(8, 8).getContext('2d');
      m.font = f;
      const ws = [];
      let x = 0;
      for (const ch of chars) {
        const w = Math.ceil(m.measureText(ch).width) + Math.ceil(px * 0.28);
        ws.push([x, w]);
        x += w;
      }
      const c = mk(x, Math.round(px * 1.35)),
        g = c.getContext('2d');
      g.font = f;
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      let fs = fill;
      if (typeof fill !== 'string') {
        fs = g.createLinearGradient(0, c.height / 2 - px * 0.42, 0, c.height / 2 + px * 0.42);
        fill.forEach((s, i) => fs.addColorStop(i / (fill.length - 1), s));
      }
      for (let d = 0; d < chars.length; d++) {
        const x0 = ws[d][0] + px * 0.14;
        g.lineWidth = px * 0.24;
        g.strokeStyle = stroke;
        g.strokeText(chars[d], x0, c.height / 2);
        g.fillStyle = fs;
        g.fillText(chars[d], x0, c.height / 2);
      }
      S[nm] = { ws, w: c.width, h: c.height, chars };
      out.push({ name: nm, cv: c });
    }
    {
      const c = mk(44, 24),
        g = c.getContext('2d');
      g.fillStyle = '#3a1d08';
      g.beginPath();
      g.roundRect(1, 2, 42, 20, 9);
      g.fill();
      const gr = g.createLinearGradient(0, 3, 0, 21);
      gr.addColorStop(0, '#ffe08a');
      gr.addColorStop(0.35, '#f2c45a');
      gr.addColorStop(1, '#8a5a18');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(3, 4, 38, 16, 7);
      g.fill();
      g.fillStyle = '#b07a26';
      g.fillRect(30, 4, 3, 16);
      out.push({ name: 'x_shell', cv: c });
    }
    // skull icon
    {
      const c = mk(64, 64),
        g = c.getContext('2d');
      g.fillStyle = '#f2f2f2';
      g.beginPath();
      g.arc(32, 27, 20, 0, TAU);
      g.fill();
      g.fillRect(20, 36, 24, 16);
      g.fillStyle = '#1a1420';
      g.beginPath();
      g.arc(24, 28, 6, 0, TAU);
      g.arc(40, 28, 6, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(32, 34);
      g.lineTo(28, 41);
      g.lineTo(36, 41);
      g.fill();
      for (let i = 0; i < 3; i++) g.fillRect(24 + i * 6, 46, 2, 7);
      out.push({ name: 'x_skull', cv: c });
    }
    {
      const c = mk(64, 64),
        g = c.getContext('2d');
      g.fillStyle = '#e8eef8';
      g.strokeStyle = '#e8eef8';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(32, 24, 12, Math.PI, 0);
      g.stroke();
      g.fillRect(14, 26, 36, 28);
      g.fillStyle = '#334';
      g.fillRect(29, 34, 6, 11);
      out.push({ name: 'x_lock', cv: c });
    }
    // comic sound words: a jagged burst behind heavy outlined letters with a hot gradient and a drop shadow
    const wtx = I18N.raw('words');
    WORDS.forEach(([fill, burst], i) => {
      const txt = wtx[i];
      const px = 112,
        f = `900 ${px}px ${FONT}`,
        m = mk(8, 8).getContext('2d');
      m.font = f;
      const tw = Math.ceil(m.measureText(txt).width);
      const c = mk(tw + 150, 250),
        g = c.getContext('2d'),
        cx = c.width / 2,
        cy = c.height / 2,
        R = prng(71 + i * 13);
      g.beginPath();
      for (let k = 0; k <= 32; k++) {
        const a = (k / 32) * TAU,
          rr = (k % 2 ? 0.62 : 1) * (0.85 + 0.15 * R()),
          x = cx + Math.cos(a) * (c.width / 2 - 8) * rr,
          y = cy + Math.sin(a) * (c.height / 2 - 8) * rr;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = burst;
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = '#2b0f12';
      g.lineJoin = 'round';
      g.stroke();
      g.setTransform(1, 0, -0.14, 1, cy * 0.14, 0);
      g.font = f;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 22;
      g.strokeStyle = '#2b0f12';
      g.strokeText(txt, cx + 7, cy + 9);
      g.fillStyle = '#2b0f12';
      g.fillText(txt, cx + 7, cy + 9); // drop shadow
      g.lineWidth = 16;
      g.strokeText(txt, cx, cy);
      const gr = g.createLinearGradient(0, cy - px * 0.45, 0, cy + px * 0.45);
      fill.forEach((col, k) => gr.addColorStop(k / (fill.length - 1), col));
      g.fillStyle = gr;
      g.fillText(txt, cx, cy);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.strokeText(txt, cx - 2, cy - 3);
      out.push({ name: 'x_word' + i, cv: c });
    });
    // litter: a sheet of paper, a newspaper page, a leaf (white, tinted per scrap); a balloon (white, tinted); a pixel for strings
    {
      const c = mk(40, 30),
        g = c.getContext('2d');
      g.fillStyle = '#f4efe6';
      g.fillRect(2, 2, 36, 26);
      g.fillStyle = '#d8d0c4';
      g.fillRect(2, 15, 36, 2);
      g.fillStyle = '#b8c4d8';
      for (let y = 6; y < 26; y += 4) g.fillRect(6, y, 28, 1);
      out.push({ name: 'x_paper', cv: c });
    }
    {
      const c = mk(56, 40),
        g = c.getContext('2d');
      g.fillStyle = '#e2ddd2';
      g.fillRect(2, 2, 52, 36);
      g.fillStyle = '#5a5650';
      g.fillRect(6, 6, 44, 6);
      g.fillStyle = '#8a857c';
      for (let y = 15; y < 36; y += 3) {
        g.fillRect(6, y, 20, 1.5);
        g.fillRect(30, y, 20, 1.5);
      }
      g.fillStyle = '#b0aaa0';
      g.fillRect(27, 2, 1, 36);
      out.push({ name: 'x_news', cv: c });
    }
    {
      const c = mk(36, 24),
        g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(2, 12);
      g.quadraticCurveTo(18, -4, 34, 12);
      g.quadraticCurveTo(18, 28, 2, 12);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(3, 12);
      g.lineTo(33, 12);
      g.stroke();
      out.push({ name: 'x_leaf', cv: c });
    }
    {
      const c = mk(64, 84),
        g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(32, 34, 28, 33, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(26, 64);
      g.lineTo(38, 64);
      g.lineTo(32, 74);
      g.fill();
      const gr = g.createRadialGradient(22, 22, 2, 30, 32, 34);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(32, 34, 28, 33, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.ellipse(21, 20, 6, 10, -0.5, 0, TAU);
      g.fill();
      out.push({ name: 'x_balloon', cv: c });
    }
    {
      const c = mk(4, 4),
        g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 4, 4);
      out.push({ name: 'x_px', cv: c });
    }
    return out;
  }
  // ================================================================== the lab's walls: canvas-made faces (a concrete panel in four
  // kinds, its end, its cap; a post, a door's post striped), laid on each piece's three faces by drawWall (atlas 1, the lab's)
  function wallCanvases() {
    const out = [];
    const grain = (g, w, h, R, n, a) => {
      for (let i = 0; i < n; i++) {
        g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a * R()})` : `rgba(255,255,255,${a * 0.7 * R()})`;
        g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2);
      }
    };
    for (let v = 0; v < 4; v++) {
      const R = prng(77 + v * 31),
        c = mk(240, 60),
        g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 60);
      gr.addColorStop(0, '#aab2bf');
      gr.addColorStop(0.75, '#8c95a4');
      gr.addColorStop(1, '#6f7787');
      g.fillStyle = gr;
      g.fillRect(0, 0, 240, 60);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, 0, 240, 3); // the lip under the cap
      g.fillStyle = '#4a5161';
      g.fillRect(0, 47, 240, 13);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, 47, 240, 2); // the baseboard
      grain(g, 240, 60, R, 900, 0.18);
      for (const x of [1, 120, 239]) {
        g.fillStyle = 'rgba(20,24,34,0.55)';
        g.fillRect(x - 1, 3, 2, 44);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x + 1, 3, 1, 44);
      } // panel seams
      g.fillStyle = '#5c6372';
      for (const x of [12, 108, 132, 228]) {
        g.beginPath();
        g.arc(x, 10, 2.2, 0, TAU);
        g.arc(x, 40, 2.2, 0, TAU);
        g.fill();
      } // bolts
      if (v === 1 || v === 3)
        for (let i = 0; i < 5; i++) {
          const x = R() * 230,
            w = 4 + R() * 10,
            l = 10 + R() * 30,
            gg = g.createLinearGradient(0, 3, 0, 3 + l);
          gg.addColorStop(0, 'rgba(60,50,40,0.45)');
          gg.addColorStop(1, 'rgba(60,50,40,0)');
          g.fillStyle = gg;
          g.fillRect(x, 3, w, l);
        } // grime run down
      if (v === 2) {
        g.save();
        g.beginPath();
        g.rect(0, 30, 240, 12);
        g.clip();
        g.fillStyle = '#2a2a2c';
        g.fillRect(0, 30, 240, 12);
        g.fillStyle = '#e8b51e';
        for (let x = -20; x < 260; x += 20) {
          g.beginPath();
          g.moveTo(x, 30);
          g.lineTo(x + 10, 30);
          g.lineTo(x + 22, 42);
          g.lineTo(x + 12, 42);
          g.closePath();
          g.fill();
        }
        g.restore();
      }
      if (v === 3) {
        g.strokeStyle = 'rgba(20,22,30,0.6)';
        g.lineWidth = 1.2;
        g.beginPath();
        let x = 40 + R() * 150,
          y = 4;
        g.moveTo(x, y);
        while (y < 46) {
          x += (R() - 0.5) * 12;
          y += 4 + R() * 6;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      out.push({ name: 'x_wf' + v, cv: c });
    }
    {
      const R = prng(5),
        c = mk(80, 60),
        g = c.getContext('2d');
      g.fillStyle = '#8f98a7';
      g.fillRect(0, 0, 80, 60);
      g.fillStyle = '#4a5161';
      g.fillRect(0, 47, 80, 13);
      grain(g, 80, 60, R, 300, 0.18);
      out.push({ name: 'x_we', cv: c });
    }
    {
      const R = prng(9),
        c = mk(240, 80),
        g = c.getContext('2d');
      g.fillStyle = '#b9c1cd';
      g.fillRect(0, 0, 240, 80);
      grain(g, 240, 80, R, 700, 0.16);
      g.fillStyle = 'rgba(30,34,46,0.35)';
      g.fillRect(0, 0, 240, 4);
      g.fillRect(0, 76, 240, 4);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(0, 4, 240, 2);
      g.fillStyle = 'rgba(30,34,46,0.4)';
      for (const x of [1, 120, 239]) g.fillRect(x - 1, 0, 2, 80);
      out.push({ name: 'x_wt', cv: c });
    }
    {
      const R = prng(13),
        c = mk(120, 76),
        g = c.getContext('2d');
      g.fillStyle = '#7a8291';
      g.fillRect(0, 0, 120, 76);
      grain(g, 120, 76, R, 400, 0.2);
      g.fillStyle = '#3f4552';
      g.fillRect(0, 60, 120, 16);
      g.fillStyle = '#9aa1ad';
      g.fillRect(0, 8, 120, 6);
      out.push({ name: 'x_pf', cv: c });
    }
    {
      const R = prng(17),
        c = mk(120, 76),
        g = c.getContext('2d');
      g.fillStyle = '#26262a';
      g.fillRect(0, 0, 120, 76);
      g.fillStyle = '#efb920';
      for (let y = -120; y < 100; y += 26) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(120, y + 60);
        g.lineTo(120, y + 73);
        g.lineTo(0, y + 13);
        g.closePath();
        g.fill();
      }
      grain(g, 120, 76, R, 400, 0.25);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 64, 120, 12);
      out.push({ name: 'x_pd', cv: c });
    }
    {
      const R = prng(19),
        c = mk(120, 120),
        g = c.getContext('2d');
      g.fillStyle = '#9ba3b0';
      g.fillRect(0, 0, 120, 120);
      grain(g, 120, 120, R, 300, 0.2);
      g.strokeStyle = 'rgba(30,34,46,0.5)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, 114, 114);
      out.push({ name: 'x_pt', cv: c });
    }
    return out;
  }
  // [letter gradient, burst colour] per word; the words themselves are the language pack's (words[i], baked at load); picked by wordFor()
  const WORDS = [
    [['#fff6a0', '#ffc22e', '#ff6a1a'], '#fff3c4'],
    [['#fff6a0', '#ffb22a', '#ff4a14'], '#ffe7a8'],
    [['#ffe48a', '#ff8a24', '#e8301a'], '#fff1c0'],
    [['#ffffff', '#ffe25a', '#ff9a1e'], '#ffd8a0'],
    [['#ffe0a0', '#ff7a2a', '#d42a18'], '#fff3c4'],
    [['#ffffff', '#8ee8ff', '#2a8cff'], '#d8f6ff'],
    [['#f4ffb0', '#9cf03a', '#3caa1a'], '#efffd0'],
  ];
  const BALC = [
    [1, 0.28, 0.3],
    [1, 0.82, 0.25],
    [0.3, 0.6, 1],
    [0.4, 0.9, 0.45],
    [1, 0.5, 0.8],
    [1, 0.58, 0.2],
  ];

  // ================================================================== iso ground (ground.js paints it: in its own worker where it can)
  const GP = window.GROUND,
    CH = GP.CH,
    LX = GP.LX,
    LY = GP.LY,
    chunks = new Map(),
    stale = new Set();
  let POOL = 40; // painted chunks kept (the map editor's zoomed-out view needs more)
  let GQ = 1; // the ground's resolution (S.groundRes)
  // the chunks painted at q × the full resolution (a phone: its CPU paints a chunk in a third of the time, its screen shows no less);
  // every chunk painted again
  S.groundRes = (q) => {
    job = null;
    GQ = q;
    GP.res(q);
    if (WK) {
      WK.post({ res: q });
      WK.gen++;
      WK.pend.clear();
    }
    for (const k of chunks.keys()) stale.add(k);
  };
  let chkN = 0;
  S.chunkStat = { n: 0, ms: 0, max: 0 };
  const chunkKey = (seed, cx, cy) => seed * 1e6 + cx * 1000 + cy;
  // the map editor: the ground over a ground rect changed (pass the shadows' reach too), or all of it; those chunks are painted again,
  // each keeping its old picture until then. pool: how many painted chunks are kept; budget: chunks painted per frame
  S.dirtyGround = (seed, gx0, gy0, gx1, gy1) => {
    const Gs = SIM.G;
    for (let cy = Math.floor((gx0 + gy0) / 2 / CH); cy <= Math.floor((gx1 + gy1) / 2 / CH); cy++)
      for (let cx = Math.floor((gx0 - gy1 + Gs) / CH); cx <= Math.floor((gx1 - gy0 + Gs) / CH); cx++) {
        const k = chunkKey(seed, cx, cy);
        if (chunks.has(k)) stale.add(k);
      }
  };
  S.resetGround = () => {
    for (const k of chunks.keys()) stale.add(k);
  };
  S.pool = (n) => {
    POOL = n;
  };
  S.budget = 2;
  S.slice = 0; // ms of painting a frame (a phone: a chunk over several frames, no hitch); 0: a chunk whole
  let job = null; // the chunk being painted on the page: { k, it (the painter, paused between layers), ms }
  // the painter: a worker of its own where one can paint (the page's frames never wait on it), else the page itself, its chunk spread
  // over frames (S.slice). ?render and the map editor always paint on the page (at once, in order)
  let WK = null; // { w, post, gen (results of an older resolution are dropped), pend: id → { k, gen }, lv (levels sent), id }
  const loadImg = (n) =>
    new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = 'assets/' + n + '.png?v=' + (window.__V || 0);
    });
  const onPage = () => (GP.ready ? Promise.resolve() : GP.setup(loadImg, { G: SIM.G }));
  const toPage = (why) => {
    if (!WK) return;
    console.warn('ground worker:', why);
    try {
      WK.w.terminate();
    } catch (e) {}
    WK = null;
    job = null;
    onPage();
  };
  const startWorker = () =>
    new Promise((res, rej) => {
      const w = new Worker('ground.js?v=' + ((window.__VER && window.__VER['ground.js']) || window.__V || 0)), // (a hot patch's own stamp)
        wk = { w, gen: 0, pend: new Map(), lv: new Set(), id: 0, post: (m) => w.postMessage(m) };
      const to = setTimeout(() => {
        w.terminate();
        rej(new Error('no answer'));
      }, 30000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m.ready) {
          clearTimeout(to);
          wk.live = true;
          res(wk);
          return;
        }
        if (!wk.live) {
          clearTimeout(to);
          w.terminate();
          rej(new Error(m.fail || 'failed'));
          return;
        }
        const q = wk.pend.get(m.id);
        wk.pend.delete(m.id);
        if (m.fail) {
          toPage(m.fail);
          return;
        }
        if (!q || q.gen !== wk.gen || WK !== wk) {
          m.bmp.close();
          return;
        }
        const st = S.chunkStat;
        st.n++;
        st.ms += m.ms;
        st.max = Math.max(st.max, m.ms);
        const t0 = performance.now();
        put(q.k, m.bmp);
        m.bmp.close();
        const up = performance.now() - t0;
        st.up = (st.up || 0) + up;
        st.upMax = Math.max(st.upMax || 0, up);
      }; // (the upload's cost: perf checks)
      w.onerror = (e) => {
        e.preventDefault();
        if (!wk.live) {
          clearTimeout(to);
          rej(new Error(e.message || 'worker error'));
        } else toPage(e.message || 'error');
      };
      w.postMessage({ setup: { v: window.__V || 0, q: GQ, G: SIM.G } });
    });
  async function groundStart() {
    const own =
      !OFFLINE &&
      !new URLSearchParams(location.search).has('editor') &&
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined';
    if (own)
      try {
        WK = await startWorker();
        return;
      } catch (e) {
        console.warn('ground worker unavailable, painting on the page:', e.message);
        WK = null;
      }
    await onPage();
  }
  // a painted picture into chunk k's texture: a stale chunk keeps its texture, a new one takes the least recently used one's
  function put(k, pic) {
    let s = chunks.get(k);
    if (s || chunks.size >= POOL) {
      if (s) {
        stale.delete(k);
        chunks.delete(k);
      } else {
        const [ok, os] = chunks.entries().next().value;
        chunks.delete(ok);
        stale.delete(ok);
        s = os;
      }
      const gl = G.gl;
      gl.bindTexture(gl.TEXTURE_2D, G.tex(s).t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      s = 'chk' + chkN++;
      G.canvasTex(s, pic);
    }
    chunks.set(k, s);
    return s;
  }
  function chunkTex(LV, cx, cy, budget) {
    const k = chunkKey(LV.seed, cx, cy),
      s = chunks.get(k);
    if (s && !stale.has(k)) {
      chunks.delete(k);
      chunks.set(k, s);
      return s;
    }
    if (WK) {
      // asked of the worker: two at a time (one painting, one waiting), the nearest first
      for (const q of WK.pend.values()) if (q.k === k) return s || null;
      if (budget.n <= 0 || WK.pend.size >= 2) return s || null;
      budget.n--;
      if (!WK.lv.has(LV.seed)) {
        WK.post({ level: GP.slim(LV) });
        WK.lv.add(LV.seed);
      }
      const id = ++WK.id;
      WK.pend.set(id, { k, gen: WK.gen });
      WK.post({ paint: { id, seed: LV.seed, cx, cy } });
      return s || null;
    }
    if (!GP.ready || budget.n <= 0 || (job && job.k !== k)) return s || null; // (one chunk at a time: the others wait their turn)
    budget.n--;
    if (!job) job = { k, it: GP.paint(LV, cx, cy), ms: 0 };
    const t0 = performance.now(),
      lim = S.slice > 0 ? S.slice : Infinity;
    let r;
    const L0 = S.chunkStat.layers || (S.chunkStat.layers = []);
    do {
      const t1 = performance.now();
      r = job.it.next();
      const i = (job.i = (job.i || 0) + 1);
      L0[i] = (L0[i] || 0) + performance.now() - t1;
    } while (!r.done && performance.now() - t0 < lim); // (per layer: perf checks)
    job.ms += performance.now() - t0;
    if (!r.done) return s || null;
    const dt = job.ms,
      st = S.chunkStat;
    job = null; // painting cost (perf.mjs reads it)
    st.n++;
    st.ms += dt;
    st.max = Math.max(st.max, dt);
    return put(k, r.value);
  }
  S.groundWorker = () => !!WK; // (checks: where the ground is painted)
  const lampName = (o) => (B.R[o.n] ? o.n : 'p_lamp'),
    lampW = (o) => (B.R[o.n] ? o.w : 64);
  const lampH = (o) => {
    const R = B.R[lampName(o)];
    return R ? (lampW(o) * R.h) / R.w : o.w * 3;
  };
  // lamp sprites: where the pole stands (bx) and where the luminaire hangs (hx, hy), as fractions of the sprite (measured)
  const LAMPG = {
    lb_flood: { bx: 0.5, hx: 0.5, hy: 0.92 },
    lb_growlight: { bx: 0.34, hx: 0.66, hy: 0.93 },
    iso_lamp: { bx: 0.28, hx: 0.7, hy: 0.94 },
    p_lamp: { bx: 0.49, hx: 0.49, hy: 0.9 },
    iso_lamp2: { bx: 0.49, hx: 0.53, hy: 0.85 },
    iso_lamp3: { bx: 0.3, hx: 0.74, hy: 0.89 },
    of_bluelamp: { bx: 0.5, hx: 0.5, hy: 0.79 },
    // m1art lamps {
    m1_st_lamp: { bx: 0.288, hx: 0.644, hy: 0.833 },
    m1_st_lamppost: { bx: 0.502, hx: 0.474, hy: 0.817 },
    m1_st_lamp2: { bx: 0.273, hx: 0.661, hy: 0.853 },
    m1_st_lamppost2: { bx: 0.495, hx: 0.474, hy: 0.82 },
    m1_in_lantern: { bx: 0.434, hx: 0.305, hy: 0.702 },
    // m1art lamps }
  };
  const lampGeo = (o) => {
    const g = LAMPG[lampName(o)] || LAMPG.p_lamp,
      w = lampW(o),
      s = o.flip ? -1 : 1;
    return { sx: (0.5 - g.bx) * w * s, dx: (g.hx - g.bx) * w * s, hh: g.hy * lampH(o) };
  };

  // ================================================================== rigs
  const mul = (A, Bm) => [
    A[0] * Bm[0] + A[2] * Bm[1],
    A[1] * Bm[0] + A[3] * Bm[1],
    A[0] * Bm[2] + A[2] * Bm[3],
    A[1] * Bm[2] + A[3] * Bm[3],
    A[0] * Bm[4] + A[2] * Bm[5] + A[4],
    A[1] * Bm[4] + A[3] * Bm[5] + A[5],
  ];
  // the same into o (o is neither A nor Bm): a rig's parts go through two scratch matrices, not two new arrays each
  const mulTo = (o, A, Bm) => {
    const a0 = A[0],
      a1 = A[1],
      a2 = A[2],
      a3 = A[3];
    o[0] = a0 * Bm[0] + a2 * Bm[1];
    o[1] = a1 * Bm[0] + a3 * Bm[1];
    o[2] = a0 * Bm[2] + a2 * Bm[3];
    o[3] = a1 * Bm[2] + a3 * Bm[3];
    o[4] = a0 * Bm[4] + a2 * Bm[5] + A[4];
    o[5] = a1 * Bm[4] + a3 * Bm[5] + A[5];
    return o;
  };
  const PT = [0, 0, 0, 0, 0, 0],
    PQ = [0, 0, 0, 0, 0, 0],
    FO = [0, 0, 0],
    SIDES = ['L', 'R'];
  const ap = (A, p) => [A[0] * p[0] + A[2] * p[1] + A[4], A[1] * p[0] + A[3] * p[1] + A[5]];
  const rotAbout = (q, q2, a) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    return [c, s, -s, c, q2[0] - (c * q[0] - s * q[1]), q2[1] - (s * q[0] + c * q[1])];
  }; // rotate about rest point q, move it to q2
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  function partQuad(name) {
    const A = window.ASSETS[name];
    if (!A) return null;
    const c = A.crop;
    return [c[2] - c[0], 0, 0, c[3] - c[1], c[0], c[1]];
  }
  // two-bone IK in rig space: hip (hx, hy), target ankle (tx, ty), segment lengths, bend sign → the knee into K, the ankle it reaches into A
  function ikTo(K, A, hx, hy, tx, ty, l1, l2, sgn) {
    const dx = tx - hx,
      dy = ty - hy,
      d = Math.hypot(dx, dy) || 1e-3;
    const dd = clamp(d, Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.3);
    const a0 = Math.atan2(dy, dx),
      ca = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1),
      al = Math.acos(ca) * sgn;
    K[0] = hx + Math.cos(a0 + al) * l1;
    K[1] = hy + Math.sin(a0 + al) * l1;
    A[0] = hx + Math.cos(a0) * dd;
    A[1] = hy + Math.sin(a0) * dd;
  }
  const restCache = {};
  function restOf(rig) {
    if (restCache[rig]) return restCache[rig];
    const M = RIGS[rig];
    if (!M) return null;
    const r = {
      M,
      rig,
      legs: {},
      arms: {},
      parts: {},
      names: {},
      sn: SIDES.map((sd) => ({
        farm: 'farm' + sd,
        uarm: 'uarm' + sd,
        arm: 'arm' + sd,
        shin: 'shin' + sd,
        foot: 'foot' + sd,
        thigh: 'thigh' + sd,
      })),
    };
    for (const n of M.parts) r.parts[n] = partQuad(rig + '__' + n);
    for (const s of ['L', 'R']) {
      if (M['knee' + s]) {
        const h = M['hip' + s],
          k = M['knee' + s],
          a = M['ankle' + s] || M['foot' + s];
        r.legs[s] = { h, k, a, l1: len(h, k), l2: len(k, a), t1: ang(h, k), t2: ang(k, a), sgn: 1 };
      }
      if (M['sh' + s]) {
        const sh = M['sh' + s],
          e = M['elbow' + s] || [(sh[0] + M['hand' + s][0]) / 2, (sh[1] + M['hand' + s][1]) / 2],
          hd = M['hand' + s];
        r.arms[s] = { s: sh, e, h: hd, l1: len(sh, e), l2: len(e, hd), t1: ang(sh, e), t2: ang(e, hd) };
      }
    }
    r.gy = Math.max(M.footL ? M.footL[1] : M.h, M.footR ? M.footR[1] : M.h) + 2;
    r.gx = M.hipL && M.hipR ? (M.hipL[0] + M.hipR[0]) / 2 : M.w / 2;
    // gait from the legs: the planted foot sweeps ±amp (rig px) through a stance that lasts `duty` of the cycle
    const legs = Object.values(r.legs),
      leg = legs.length ? legs.reduce((a, l) => a + len(l.h, l.a), 0) / legs.length : M.h * 0.3;
    r.duty = DUTY[rig] || 0.6;
    r.amp = leg * (AMP[rig] || 0.4);
    r.step = (r.amp * 2) / r.duty / 2; // rig px of travel per step
    restCache[rig] = r;
    return r;
  }
  const DUTY = {
    a_lsubject: 0.28,
    a_lflask: 0.58,
    a_lhazmat: 0.58,
    a_hero: 0.26,
    a_runner: 0.28,
    a_walker: 0.6,
    a_bloater: 0.58,
    a_armored: 0.6,
    a_spitter: 0.6,
    a_butcher: 0.58,
    a_pustule: 0.6,
    a_screamer: 0.56,
    a_tank: 0.6,
    a_golem: 0.6,
  };
  const AMP = {
    a_lassist: 0.46,
    a_lsubject: 0.4,
    a_lflask: 0.42,
    a_lhazmat: 0.42,
    a_lguard: 0.38,
    a_lchemist: 0.3,
    a_hero: 0.46,
    a_runner: 0.4,
    a_walker: 0.46,
    a_tank: 0.3,
    a_golem: 0.26,
    a_bloater: 0.42,
    a_pustule: 0.38,
    a_spitter: 0.3,
    a_butcher: 0.34,
    a_armored: 0.38,
  };
  // screen px travelled per step for a rig drawn at height h (phase = dist / step · π)
  S.stepOf = (rig, h) => {
    const r = restOf(rig);
    return r ? (r.step * h) / r.M.h : 30;
  };
  // pose: { ph (gait phase), amt (0 idle .. 1 walk), dx, dy (unit travel, screen), bob, lean, armL: [du, df], armR: [du, df] (rad),
  //         fall (0..1 collapse), rise (0..1), handR: [x, y] screen target for the near hand, handL: same, flash, alpha, tint, rim }
  // draws far arm, far leg, body, near leg, near arm (+ held item callback between body and near arm, or before body when facing away)
  // drawRig's scratch (it never runs inside itself — nothing it calls draws a rig): the root and body matrices, per side the leg's three
  // and the arm's two with their joints, two spare matrices, the colours, need()'s two answers. A crowd of rigs allocates nothing a frame
  const m6 = () => new Float64Array(6),
    p2 = () => new Float64Array(2),
    WHITE = [1, 1, 1];
  const RG = {
    root: m6(),
    body: m6(),
    x6: m6(),
    y6: m6(),
    far: [0, 0, 0],
    base: [0, 0, 0],
    nd: [0, 0],
    al: 1,
    fl: 0,
    lk: 0.55,
    rim: 0,
    legs: [0, 1].map(() => ({ on: false, th: m6(), sh: m6(), ft: m6(), hip: p2(), knee: p2(), ankle: p2() })),
    arms: [0, 1].map(() => ({ on: false, u: m6(), f: m6(), sh: p2(), el: p2(), hd: p2() })),
  };
  let RECS = null; // (a recorder: the parts go to it instead of the batch — still corpses)
  const rotTo = (o, qx, qy, q2x, q2y, a) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    o[0] = c;
    o[1] = s;
    o[2] = -s;
    o[3] = c;
    o[4] = q2x - (c * qx - s * qy);
    o[5] = q2y - (s * qx + c * qy);
    return o;
  }; // rotAbout into o
  // R ← X · R for X = (a b c d e f), as mul(X, R) works it out
  const preTo = (R, a, b, c, d, e, f) => {
    const r0 = R[0],
      r1 = R[1],
      r2 = R[2],
      r3 = R[3],
      r4 = R[4],
      r5 = R[5];
    R[0] = a * r0 + c * r1;
    R[1] = b * r0 + d * r1;
    R[2] = a * r2 + c * r3;
    R[3] = b * r2 + d * r3;
    R[4] = a * r4 + c * r5 + e;
    R[5] = b * r4 + d * r5 + f;
  };
  // foot paths (animation.md §12): in stance the foot slides back at exactly body speed (it stays planted in the world), in swing it
  // eases forward with a lift. Forward in rig space is −x after the facing mirror; screen y is rig y. → FO: [x, y, lift] (read at once)
  function rigFoot(left, phase, duty, Ar, ex, ey) {
    const c = (((phase / TAU + (left ? 0 : 0.5)) % 1) + 1) % 1;
    let off, up;
    if (c < duty) {
      off = -1 + (2 * c) / duty;
      up = 0;
    } else {
      const e = (c - duty) / (1 - duty),
        ee = 0.45 * e + 0.55 * e * e * (3 - 2 * e);
      off = 1 - 2 * ee;
      up = Math.pow(Math.sin(Math.PI * e), 0.75);
    }
    FO[0] = off * Ar * ex;
    FO[1] = -off * Ar * ey;
    FO[2] = up;
    return FO;
  }
  const rigTrack = (Lg, gx, amt) => {
    const c = (Lg.h[0] + gx) / 2;
    return c + (Lg.a[0] - c) * (1 - 0.6 * amt);
  }; // toward the line between hip and centre
  // the hips ride the stance legs: how far they must drop for the planted feet to stay in reach (RG.nd[0]) and the room left to rise (RG.nd[1])
  function rigNeed(r, phase, duty, Ar, ex, ey, amt, lift) {
    let dn = 0,
      room = 1e9;
    for (let i = 0; i < 2; i++) {
      const Lg = i ? r.legs.R : r.legs.L;
      if (!Lg) continue;
      const fo = rigFoot(!i, phase, duty, Ar, ex, ey),
        ox = fo[0],
        oy = fo[1],
        up = fo[2];
      const tx = rigTrack(Lg, r.gx, amt) + ox - Lg.h[0],
        ty = Lg.a[1] + oy - up * lift - Lg.h[1],
        R = (Lg.l1 + Lg.l2) * 0.985,
        vy = Math.sqrt(Math.max(0, R * R - tx * tx));
      dn = Math.max(dn, ty - vy);
      if (!up) room = Math.min(room, vy - ty);
    }
    RG.nd[0] = Math.max(0, dn);
    RG.nd[1] = room;
  }
  // one part: its rest quad through pose m and the root, colour c, alpha × am
  function rigPut(r, name, m, c, am) {
    const q = r.parts[name];
    if (!q) return;
    mulTo(PT, RG.root, m);
    mulTo(PQ, PT, q);
    const nm = r.names[name] || (r.names[name] = r.rig + '__' + name);
    if (RECS) RECS.push(nm, PQ, c, RG.al * am);
    else B.spr(nm, PQ, c[0], c[1], c[2], RG.al * am, RG.fl, RG.lk, RG.rim);
  }
  function rigArm(r, i, c) {
    const a = RG.arms[i],
      n = r.sn[i];
    if (!a.on) return;
    if (r.parts[n.farm]) rigPut(r, n.farm, a.f, c, 1);
    rigPut(r, n.uarm, a.u, c, 1);
    if (r.parts[n.arm]) rigPut(r, n.arm, a.u, c, 1);
  }
  function rigLeg(r, i, c) {
    const m = RG.legs[i],
      n = r.sn[i];
    if (!m.on) return;
    rigPut(r, n.shin, m.sh, c, 1);
    rigPut(r, n.foot, m.ft, c, 1);
    rigPut(r, n.thigh, m.th, c, 1);
  }
  function drawRig(rig, x, y, h, face, P, id) {
    const r = restOf(rig);
    if (!r) return;
    const M = r.M,
      s = h / M.h,
      f = face > 0 ? -1 : 1,
      root = RG.root; // drawings face left: facing right mirrors
    root[0] = f * s;
    root[1] = 0;
    root[2] = 0;
    root[3] = s;
    root[4] = x - f * s * r.gx;
    root[5] = y - s * r.gy;
    if (P.fall) {
      const a = -f * P.fall * 1.45 * (P.fdir || 1),
        c = Math.cos(a),
        sn = Math.sin(a),
        sq = 1 - P.fall * 0.35; // topple about the feet
      preTo(root, c, sn, -sn * sq, c * sq, x - (c * x - sn * sq * y), y - (sn * x + c * sq * y));
    }
    if (P.lean) {
      const a = P.lean,
        c = Math.cos(a),
        sn = Math.sin(a);
      preTo(root, c, sn, -sn, c, x - (c * x - sn * y), y - (sn * x + c * y));
    }
    if (P.sq) preTo(root, 1 / P.sq, 0, 0, P.sq, x - x / P.sq, y - y * P.sq);
    if (P.spin) {
      const a = P.spin,
        c = Math.cos(a),
        sn = Math.sin(a),
        cy = y - h * 0.4;
      preTo(root, c, sn, -sn, c, x - (c * x - sn * cy), cy - (sn * x + c * cy));
    } // tumbling through the air
    if (P.shade) {
      const a = P.shade[0],
        b = P.shade[1];
      preTo(root, 1, 0, -a, -b, a * y, y * (1 + b));
    } // its cast shadow (castActors): laid on the ground, height → away from the light
    const amt = P.amt || 0,
      ph = P.ph || 0,
      duty = P.duty || r.duty;
    const ex = Math.abs(P.dx ?? 1),
      ey = P.dy || 0,
      Ar = r.amp * amt;
    const lift = (P.lift || 0.07) * M.h * amt;
    // the hips drop exactly as much as the planted feet need to stay in reach, symmetric over the two steps (no limp), then a small rise
    // over mid-stance where the legs allow it
    rigNeed(r, ph, duty, Ar, ex, ey, amt, lift);
    const d1 = RG.nd[0],
      r1 = RG.nd[1];
    rigNeed(r, ph + Math.PI, duty, Ar, ex, ey, amt, lift);
    const d2 = RG.nd[0],
      r2 = RG.nd[1];
    const rise = Math.min((P.bobA ?? 0.022) * M.h * amt * Math.abs(Math.sin(ph)), Math.max(0, Math.min(r1, r2) - 0.5));
    const hipY = Math.max(d1, d2) - rise + (P.drop || 0);
    const bob = -hipY;
    const tint = P.tint || WHITE,
      far = RG.far,
      base = RG.base;
    RG.fl = P.flash || 0;
    RG.al = P.alpha ?? 1;
    RG.lk = P.lk ?? 0.55;
    RG.rim = P.rim || 0;
    far[0] = tint[0] * 0.78;
    far[1] = tint[1] * 0.74;
    far[2] = tint[2] * 0.8;
    base[0] = tint[0];
    base[1] = tint[1];
    base[2] = tint[2];
    const tl = -(P.tlean || 0),
      hcx = r.gx,
      hcy = r.legs.L ? (r.legs.L.h[1] + (r.legs.R ? r.legs.R.h[1] : r.legs.L.h[1])) / 2 : M.h * 0.65;
    const body = rotTo(RG.body, hcx, hcy, hcx, hcy - bob, tl); // forward is −x in the drawing
    for (let i = 0; i < 2; i++) {
      const Lg = i ? r.legs.R : r.legs.L,
        m = RG.legs[i];
      m.on = !!Lg;
      if (!Lg) continue;
      const fo = rigFoot(!i, ph, duty, Ar, ex, ey),
        ox = fo[0],
        oy = fo[1],
        up = fo[2];
      const hx = Lg.h[0],
        hy = Lg.h[1] - bob,
        K = m.knee,
        A = m.ankle;
      ikTo(K, A, hx, hy, rigTrack(Lg, r.gx, amt) + ox, Lg.a[1] + oy - up * lift, Lg.l1, Lg.l2, Lg.sgn);
      const t1 = Math.atan2(K[1] - hy, K[0] - hx),
        t2 = Math.atan2(A[1] - K[1], A[0] - K[0]);
      rotTo(m.th, Lg.h[0], Lg.h[1], hx, hy, t1 - Lg.t1);
      rotTo(m.sh, Lg.k[0], Lg.k[1], K[0], K[1], t2 - Lg.t2);
      rotTo(m.ft, Lg.a[0], Lg.a[1], A[0], A[1], up * (P.pitch ?? 0.25));
      m.hip[0] = hx;
      m.hip[1] = hy;
    }
    for (let i = 0; i < 2; i++) {
      const A = i ? r.arms.R : r.arms.L,
        a = RG.arms[i];
      a.on = !!A;
      if (!A) continue;
      const sh = a.sh,
        el = a.el,
        hd = a.hd;
      sh[0] = body[0] * A.s[0] + body[2] * A.s[1] + body[4];
      sh[1] = body[1] * A.s[0] + body[3] * A.s[1] + body[5];
      const arm = i ? P.armR : P.armL;
      let du = (arm || NOARM)[0] + tl,
        df = (arm || NOARM)[1];
      if (P.swing) {
        const sp = i ? Math.PI : 0;
        du += P.swing * -Math.cos(ph + sp - 0.35) * (Math.sin(A.t1) >= 0 ? 1 : -1); // the hand travels opposite to its own leg
        df += (P.elbow ?? 0.22) * amt * (0.5 - 0.5 * Math.cos(ph + sp + 0.6));
      }
      const tgtS = i ? P.handR : P.handL;
      if (tgtS) {
        // IK the hand to a screen target (held weapon)
        const inv = invert(mul(root, [1, 0, 0, 1, 0, 0])),
          tg = ap(inv, tgtS);
        ikTo(el, hd, sh[0], sh[1], tg[0], tg[1], A.l1, A.l2, i ? 1 : -1);
        rotTo(a.u, A.s[0], A.s[1], sh[0], sh[1], Math.atan2(el[1] - sh[1], el[0] - sh[0]) - A.t1);
        rotTo(a.f, A.e[0], A.e[1], el[0], el[1], Math.atan2(hd[1] - el[1], hd[0] - el[0]) - A.t2);
      } else {
        const a1 = A.t1 + du,
          a2 = A.t2 + du + df;
        el[0] = sh[0] + Math.cos(a1) * A.l1;
        el[1] = sh[1] + Math.sin(a1) * A.l1;
        hd[0] = el[0] + Math.cos(a2) * A.l2;
        hd[1] = el[1] + Math.sin(a2) * A.l2;
        rotTo(a.u, A.s[0], A.s[1], sh[0], sh[1], du);
        rotTo(a.f, A.e[0], A.e[1], el[0], el[1], du + df);
      }
    }
    if (P.behind) P.behind(root);
    rigArm(r, 0, far);
    rigLeg(r, 0, far);
    const LR = RG.legs[1];
    if (LR.on) rigPut(r, 'thighR', LR.th, base, 1);
    rigPut(r, 'body', body, base, 1);
    if (r.parts.logo && f < 0 !== !!M.mirrored) {
      const q = r.parts.logo;
      rigPut(r, 'logo', mul(body, [-1, 0, 0, 1, 2 * q[4] + q[0], 0]), base, 1);
    } // lettering on screen reads backwards: its patch, flipped back
    // a belly that bounces (stretching down from its hinge row, so it always covers itself on the body) and a head on its neck,
    // its open-mouthed variant faded in over it (gen/rigparts.py)
    if (r.parts.belly) {
      let bm = body;
      if (P.belly) {
        const X = RG.x6;
        X[0] = 1;
        X[1] = 0;
        X[2] = 0;
        X[3] = P.belly;
        X[4] = 0;
        X[5] = M.bellyTop * (1 - P.belly);
        bm = mulTo(RG.y6, body, X);
      }
      rigPut(r, 'belly', bm, base, 1);
    }
    if (r.parts.head) {
      const hm = mulTo(
        RG.y6,
        body,
        rotTo(RG.x6, M.neck[0], M.neck[1], M.neck[0] + (P.headX || 0), M.neck[1] + (P.headY || 0), P.head || 0),
      );
      rigPut(r, 'head', hm, base, 1);
      if (r.parts.headO && P.mouth > 0.01) rigPut(r, 'headO', hm, base, Math.min(1, P.mouth));
    }
    if (LR.on) {
      rigPut(r, 'shinR', LR.sh, base, 1);
      rigPut(r, 'footR', LR.ft, base, 1);
    }
    if (P.held && !P.heldBehind) P.held(root);
    rigArm(r, 1, base);
    // joints for qa.mjs (animation.md §14)
    if (L.TRACE && id) {
      const J = (n, p) => L.joint(id, n, ap(root, p));
      J('ground', [r.gx, r.gy]);
      J('head', ap(body, M.head));
      J('top', ap(body, M.top));
      for (let i = 0; i < 2; i++) {
        const sd = SIDES[i],
          m = RG.legs[i],
          a = RG.arms[i];
        if (m.on) {
          J('hip' + sd, m.hip);
          J('knee' + sd, m.knee);
          J('ankle' + sd, m.ankle);
          const tp = M['toe' + sd],
            hl = M['heel' + sd];
          if (tp) J('toe' + sd, ap(m.ft, tp));
          if (hl) J('heel' + sd, ap(m.ft, hl));
        }
        if (a.on) {
          J('sh' + sd, a.sh);
          J('elbow' + sd, a.el);
          J('hand' + sd, a.hd);
        }
      }
      J('hip', [r.gx, (r.legs.L ? r.legs.L.h[1] : M.h * 0.65) - bob]);
    }
  }
  const NOARM = [0, 0];
  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    const a = m[3] / det,
      b = -m[1] / det,
      c = -m[2] / det,
      d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  S.drawRig = drawRig;

  // ================================================================== render
  let camX = 0,
    camY = 0,
    ZM = 1,
    VW = W,
    VH = H; // ZM: camera zoom of the frame (state.zoom); VW x VH: the world in view
  const HK = SIM.HERO.s / 148; // hero-sized effects (flash, shells) against the size they were drawn for
  const SHAKE = {
    slam: [3.5, 0.4],
    hurt: [3, 0.25],
    bossdie: [6, 0.6],
    rockhit: [2, 0.3],
    pdie: [4, 0.5],
    pout: [5, 0.6],
    scream: [1.5, 0.6],
    thud: [0.5, 0.12],
    arena: [2, 0.5],
  }; // [trauma px, s] (blasts and the hero's own shots: none, the view holds still)
  const sx = (x) => x - camX,
    sy = (y) => y - camY;
  // the heroes drawn: this page's (ST.p) and, playing together, the others still in the run; asHero: the sim's hero-bound helpers
  // (muzzle, coil, saws) asked for another hero
  const heroesOf = (ST) => (ST.ps && ST.ps.length > 1 ? ST.ps.filter((p) => !p.gone) : [ST.p]);
  const asHero = (ST, p, f) => {
    const me = ST.p;
    if (p === me) return f();
    ST.p = p;
    try {
      return f();
    } finally {
      ST.p = me;
    }
  };
  S.render = (t) => {
    if (G.W !== W) S.view(G.W);
    const ST = S.state || SIM.at(t),
      GT = ST.t,
      LV = SIM.level(ST.seed);
    // ---- shake: every recent event adds trauma (px) that fades quadratically, capped; deterministic noise ----
    let sh = 0;
    for (let i = ST.ev.length - 1; i >= 0; i--) {
      const e = ST.ev[i],
        a = GT - e.t;
      if (a > 1) break;
      if (a < 0) continue;
      const T = SHAKE[e.k];
      if (
        T &&
        a < T[1] &&
        !(e.pi !== undefined && e.pi !== ST.p.i && (e.k === 'hurt' || e.k === 'pdie' || e.k === 'pout'))
      )
        sh += T[0] * (1 - a / T[1]) ** 2;
    } // (a partner's hurt doesn't shake this screen)
    sh = Math.min(7, sh);
    camX = ST.cam[0] + sh * (0.6 * Math.sin(GT * 91.7) + 0.4 * Math.sin(GT * 57.1 + 2));
    camY = ST.cam[1] + sh * (0.6 * Math.sin(GT * 73.3 + 1) + 0.4 * Math.sin(GT * 49.9 + 4));
    ZM = ST.zoom || 1;
    VW = W / ZM;
    VH = H / ZM;
    for (const tg of [L.T.bg, L.T.comp, T.light, T.shad, T.shad2]) {
      tg.vw = W / ZM;
      tg.vh = H / ZM;
    }
    BOOMS = ST.ev.filter((e) => e.k === 'boom' && GT - e.t >= 0 && GT - e.t < 2.5);
    fxBudget(ST, GT);
    stepWorld(ST, LV, GT); // litter and the corpse list follow the state (cosmetic, own memory)
    wrecks(ST, LV, GT); // when each burst barrel blew (its shell's heat and smoke)

    // ================= ground → T.bg =================
    const mark = S.mark; // (perf checks: a hook called between the passes, null in play)
    L.beginBG(LV.map === 'lab' ? [0.03, 0.035, 0.05, 1] : [0.07, 0.1, 0.07, 1]);
    const budget = { n: OFFLINE ? 99 : S.budget };
    const c0 = Math.floor(camX / CH),
      c1 = Math.floor((camX + W / ZM) / CH),
      r0 = Math.floor(camY / CH),
      r1 = Math.floor((camY + H / ZM) / CH);
    let miss = 0;
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const s = chunkTex(LV, cx, cy, budget);
        if (s) L.sprite(s, cx * CH - camX - 1, cy * CH - camY - 1, { w: CH + 2, h: CH + 2 });
        else miss++;
      } // (not rounded: the ground moves with the props, which aren't)
    S.groundDone = !miss; // (all the ground in view painted: index.html's start spinner goes)
    for (let cy = r0 - 1; cy <= r1 + 1 && budget.n > 0; cy++)
      for (let cx = c0 - 1; cx <= c1 + 1 && budget.n > 0; cx++)
        if (cy < r0 || cy > r1 || cx < c0 || cx > c1) chunkTex(LV, cx, cy, budget); // the ring ahead
    // ground decals (lit with the ground)
    for (const d of ST.dec) {
      const a = GT - d.t,
        k = 1 - SS(d.life * 0.6, d.life, a),
        x = sx(d.x),
        y = sy(d.y);
      if (x < -150 || x > W + 150 || y < -100 || y > H + 100) continue;
      const nm =
        d.k === 'blood'
          ? 'x_blood' + (d.v % 6)
          : d.k === 'scorch'
            ? 'x_scorch' + (d.v % 3)
            : d.k === 'acid'
              ? 'x_acid' + (d.v % 2)
              : null;
      if (nm) {
        const s = 70 * d.s * (d.k === 'blood' ? SS(0, 0.25, a) * 0.5 + 0.5 : 1),
          c = Math.cos(d.r),
          sn = Math.sin(d.r);
        B.spr(
          nm,
          [c * s, sn * s * 0.5, -sn * s, c * s * 0.5, x - (c * s - sn * s) / 2, y - (sn * s + c * s) * 0.25],
          1,
          1,
          1,
          0.85 * k,
          0,
          0,
        );
      }
    }
    for (const q of ST.pud) {
      const a = GT - q.t0,
        k = SS(0, 0.3, a) * (1 - SS(q.dur - 1, q.dur, a));
      const s = q.r * 2.2;
      if (q.k === 'spore' || q.k === 'gas') {
        const gas = q.k === 'gas'; // (the Lab Tech's: a thicker, toxic green cloud)
        for (let j = 0; j < 6; j++) {
          const an = (j / 6) * TAU + a * 0.3 + q.x,
            d = q.r * 0.45 * (0.6 + 0.4 * Math.sin(a * 1.7 + j)),
            rad = q.r * (0.45 + 0.08 * Math.sin(a * 2.3 + j * 2)); // a drifting cloud of spores
          B.fx(
            1,
            sx(q.x) + Math.cos(an) * d,
            sy(q.y) + Math.sin(an) * d * 0.5 - 10,
            rad * (gas ? 1.25 : 1),
            rad * (gas ? 0.75 : 0.6),
            0,
            gas ? 0.55 : 0.9,
            gas ? 0.9 : 0.68,
            gas ? 0.3 : 0.26,
            (gas ? 0.5 : 0.42) * k,
            1,
            j + Math.floor(q.x),
            1,
          );
        }
        continue;
      }
      if (q.k === 'flesh') continue; // (the Devourer's: drawn over the light, groundFx)
      B.spr(
        'x_acid' + (Math.floor(q.x) % 2),
        [s, 0, 0, s * 0.5, sx(q.x) - s / 2, sy(q.y) - s / 4],
        1,
        1,
        1,
        0.9 * k,
        0,
        0,
      );
    }
    B.flush(B.S, 'spr');
    if (mark) mark('ground');

    // ================= light map → multiply the ground =================
    G.bind(T.light, LV.map === 'lab' ? [0.42, 0.45, 0.55, 1] : [0.65, 0.63, 0.75, 1]); // (the lab: indoors, its light from its lamps)
    castActors(ST, GT); // the actors' cast shadows darken the ambient (on the ground only); lamps and flashes add over them
    if (mark) mark('cast');
    lights(ST, LV, GT, t);
    if (LV.gas) gasLight(ST, LV, GT);
    B.flush(B.F, 'fx', 'add', null);
    G.bind(L.T.bg);
    const gl = G.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    G.full(L.P.mul, { u_src: T.light });
    G.blend();
    if (mark) mark('light');

    // ================= composite =================
    L.beginComp();
    if (mark) mark('copy');
    // ground fissures (the crack shader samples T.bg as its mask, so it draws into the composite, never into T.bg itself)
    for (const d of ST.dec)
      if (d.k === 'crack') {
        const a = GT - d.t;
        L.cracks(sx(d.x), sy(d.y), 90 * d.s, a, d.r, 0, 1);
      }
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (e.k === 'slam' && a >= 0 && a < 2.95)
        L.cracks(sx(e.x), sy(e.y), (e.r || 120) * 0.9, a, e.t * 7, 0, 1 - SS(2.2, 2.95, a));
    }
    groundFx(ST, GT, t); // telegraphs, mines, shells, gem glows (unlit, readable)
    B.flush(B.F, 'fx');
    if (LV.gas) gasGround(ST, LV, GT); // the lab's gas: its edge and the next stage's stop
    shadows(ST, LV, GT);
    B.flush(B.F, 'fx');
    corpses(ST, GT, 'ground');
    litter(ST, GT, 0); // what lies on the ground: bodies, paper and leaves
    B.flush(B.F, 'fx');
    B.flush(B.S, 'spr', 'over', T.light); // the scraps' shadows under them
    if (mark) mark('under');
    band(ST, LV, GT, t); // the depth-sorted band
    B.flush(B.S, 'spr', 'over', T.light);
    if (mark) mark('band');
    airFx(ST, GT, t);
    if (LV.gas) gasAir(ST, LV, GT);
    elemFx(ST, GT);
    canopies(ST, LV, GT, t);
    B.flush(B.S, 'spr', 'over', T.light);
    lowHp(ST, GT);
    if (LV.gas) gasEdge(ST, LV, GT);
    if (mark) mark('air');
    L.finish(t, { bloom: [0.24, 0.2], vignette: 0.6, warm: 0.8, sharp: S.low ? 0.5 : 0.32, vib: 0.14, con: 0.12 });
    if (mark) mark('finish');
    hotCores(ST, GT); // white-hot centres after the grade (it would compress them)
    // a mission's way into another map (SIM goMap: the office's door): the new map comes out of black
    for (let i = ST.ev.length - 1; i >= 0; i--) {
      const e = ST.ev[i];
      if (GT - e.t > 0.9) break;
      if (e.k === 'mapgo' && GT >= e.t) {
        B.spr('x_px', [W, 0, 0, H, 0, 0], 0, 0, 0, 1 - (GT - e.t) / 0.9, 0, 0);
        B.flush(B.S, 'spr');
        break;
      }
    }
    // ================= screen space =================
    words(ST, GT);
    numbers(ST, GT);
    hurtNumbers(ST, GT);
    B.flush(B.S, 'spr');
    reloadMark(ST, GT);
    if (!ST.demo && !(ST.over && ST.t - ST.over.t >= 1.4)) {
      // the results screen (ui.js, from 1.4 s after the end) shows the bare game
      const X = hudXf(),
        s = G.PW / G.W;
      if (X.on)
        G.sub({
          x: Math.round(X.ox * s),
          y: Math.round(X.oy * s),
          w: Math.round(X.w * X.k * s),
          h: Math.round(H * X.k * s),
          vw: X.w,
          vh: H,
        });
      try {
        if (ST.hub) hubHud(ST, GT, X.w);
        else hud(ST, GT, t, X.w);
      } finally {
        if (X.on) G.sub(null);
      }
    }
    if (mark) mark('hud');
  };
  S.mark = null;

  function hotCores(ST, GT) {
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (a < 0) continue;
      const x = sx(e.x) * ZM,
        y = sy(e.y) * ZM;
      if (e.k === 'boom' && e.kind !== 'acid' && e.kind !== 'spore' && a < 0.3) {
        const r = (e.r || 120) * ZM,
          k = 1 - SS(0.08, 0.3, a);
        B.fx(0, x, y - r * 0.22, r * 0.34, r * 0.28, 0, 1, 0.96, 0.86, 0.95 * k, 1.5, 0, 0);
      } else if (e.k === 'shot' && a < 0.045 && e.w !== 'drone' && e.w !== 'turret') {
        const k = 1 - a / 0.045,
          c = Math.cos(e.a),
          s = Math.sin(e.a);
        B.fx(0, x + c * 10 * ZM * HK, y + s * 10 * ZM * HK, 22 * ZM * HK, 18 * ZM * HK, 0, 1, 0.97, 0.88, k, 2, 0, 0);
      }
    }
    B.flush(B.F, 'fx', 'add');
  }
  // ---------- lights: lamp pools, muzzle flashes, explosions, fire, pickups ----------
  // the lab's ceiling lights by the room's tint (map_lab.js lights [gx, gy, r, tint]); a room's lamps hum, one in a few flickers
  const LTINT = {
    white: [0.62, 0.68, 0.78],
    warm: [0.78, 0.64, 0.42],
    blue: [0.36, 0.56, 0.9],
    orange: [0.92, 0.52, 0.2],
    pink: [0.82, 0.38, 0.8],
    green: [0.42, 0.82, 0.5],
    red: [0.9, 0.3, 0.26],
  };
  function labLights(LV, GT, t) {
    for (let i = 0; i < LV.lights.length; i++) {
      const [gx, gy, r, tn] = LV.lights[i],
        x = sx(gx - gy + SIM.G),
        y = sy((gx + gy) / 2);
      if (x < -r * 1.5 || x > VW + r * 1.5 || y < -r || y > VH + r) continue;
      const c = LTINT[tn] || LTINT.white,
        near = BOOMS.some(
          (b) =>
            GT - b.t < 1.5 &&
            Math.abs(gx - gy + SIM.G - b.x) < b.r + 300 &&
            Math.abs((gx + gy) / 2 - b.y) < (b.r + 300) / 2,
        );
      let f = 0.95 + 0.05 * Math.sin(t * 9 + i * 1.7);
      if (near ? rnd(Math.floor(GT * 20), i) < 0.35 : i % 7 === 3 && rnd(Math.floor(t * 8), i) < 0.12) f = 0.25;
      B.fx(0, x, y, r * 1.25, r * 0.66, 0, c[0] * 0.55 * f, c[1] * 0.55 * f, c[2] * 0.55 * f, 1, 1.3, 0, 0);
      B.fx(0, x, y, r * 0.6, r * 0.32, 0, c[0] * 0.5 * f, c[1] * 0.5 * f, c[2] * 0.5 * f, 1, 1.5, 0, 0);
    }
  }
  const LAMPC = { lb_growlight: [0.85, 0.3, 1.0], lb_flood: [1, 0.85, 0.6], of_bluelamp: [0.16, 0.86, 1.0] }; // (the office's server room: cyan)
  // the low sun through the office's windows (ground.js sunPatches lays its patches on the floor): the light map warms the floor
  // round each patch and the glass itself (its sunset seen unshaded), and airFx adds a soft glow over each pane. Per pane: f, the
  // floor glow (world centre, radii); g, the glass's foot (world centre on the floor, half its width along the wall). SUNG: the
  // glass's middle and half height over the floor (world px; the inside walls stand 160), SUNGT a tall window's
  const SUNC = [1.0, 0.62, 0.3],
    SUNG = [88, 48],
    SUNGT = [80, 62],
    sunWins = new WeakMap();
  function sunWindows(LV) {
    let w = sunWins.get(LV);
    if (w) return w;
    w = [];
    const GR = window.GROUND;
    for (const o of LV.props) {
      const qs = GR && GR.sunQuads ? GR.sunQuads(o) : null;
      if (!qs) continue;
      const W = (g) => [o.x + (g[0] - o.gx) - (g[1] - o.gy), o.y + (g[0] - o.gx + g[1] - o.gy) / 2];
      const panes = qs.map((p) => {
        const c = p.map(W),
          xs = c.map((v) => v[0]),
          ys = c.map((v) => v[1]),
          fa = W(p.face[0]),
          fb = W(p.face[1]);
        return {
          f: [
            (Math.max(...xs) + Math.min(...xs)) / 2,
            (Math.max(...ys) + Math.min(...ys)) / 2,
            (Math.max(...xs) - Math.min(...xs)) / 2,
            (Math.max(...ys) - Math.min(...ys)) / 2,
          ],
          g: [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2, Math.hypot(fa[0] - fb[0], fa[1] - fb[1]) / 2],
        };
      });
      w.push({ o, panes, sg: GR.tallWindow(o) ? SUNGT : SUNG });
    }
    sunWins.set(LV, w);
    return w;
  }
  const sunInView = (o) => sx(o.x) > -700 && sx(o.x) < VW + 700 && sy(o.y) > -400 && sy(o.y) < VH + 600;
  function lights(ST, LV, GT, t) {
    if (LV.map === 'lab') labLights(LV, GT, t);
    else B.fx(0, 120, 60, 950, 600, 0, 0.44, 0.29, 0.1, 1, 1.5, 0, 0); // warm key light from the upper left (screen space)
    for (const w of sunWindows(LV)) {
      if (!sunInView(w.o)) continue;
      for (const p of w.panes) {
        const [fx, fy, rx, ry] = p.f,
          [gx, gy, gw] = p.g;
        B.fx(0, sx(fx), sy(fy), rx * 1.3, ry * 1.3, 0, SUNC[0] * 0.5, SUNC[1] * 0.5, SUNC[2] * 0.5, 1, 1.3, 0, 0);
        B.fx(0, sx(gx), sy(gy) - w.sg[0], gw, w.sg[1] + gw * 0.5, 0, 0.8, 0.62, 0.42, 1, 1.4, 0, 0);
      }
    }
    for (const i of LV.lamps) {
      const o = LV.props[i],
        x = sx(o.x),
        y = sy(o.y);
      if (x < -400 || x > VW + 400 || y < -300 || y > VH + 500) continue;
      const fl = lampFlicker(o, GT, t),
        lc = LAMPC[o.n];
      const lg = lampGeo(o);
      if (o.n === 'of_bluelamp') {
        // the server room's cyan: a wide pool on the floor in front of the wall, a bright core, the light box's own glow
        B.fx(0, x, y + 40, 430, 250, 0, 0.1 * fl, 0.62 * fl, 0.78 * fl, 1, 1.3, 0, 0);
        B.fx(0, x, y + 30, 230, 135, 0, 0.14 * fl, 0.9 * fl, 1.12 * fl, 1, 1.5, 0, 0);
        B.fx(0, x + lg.dx, y - lg.hh, 120, 70, 0, 0.1 * fl, 0.55 * fl, 0.7 * fl, 1, 2.2, 0, 0);
        continue;
      }
      if (lc) {
        B.fx(
          0,
          x + lg.dx * 0.9,
          y - lg.hh * 0.05,
          260,
          150,
          0,
          lc[0] * 0.6 * fl,
          lc[1] * 0.6 * fl,
          lc[2] * 0.6 * fl,
          1,
          1.4,
          0,
          0,
        );
        B.fx(0, x + lg.dx, y - lg.hh, 80, 60, 0, lc[0] * 0.5 * fl, lc[1] * 0.5 * fl, lc[2] * 0.5 * fl, 1, 3, 0, 0);
        continue;
      }
      // a pool on the ground under the head: a soft warm skirt and a brighter core (it used to double the light and wash actors out)
      B.fx(0, x + lg.dx * 0.9 + 10, y - lg.hh * 0.08, 400, 240, 0, 0.44 * fl, 0.3 * fl, 0.13 * fl, 1, 1.3, 0, 0);
      B.fx(0, x + lg.dx * 0.9 + 10, y - lg.hh * 0.08, 220, 132, 0, 1.0 * fl, 0.6 * fl, 0.26 * fl, 1, 1.5, 0, 0);
      B.fx(0, x + lg.dx, y - lg.hh, 110, 80, 0, 0.3 * fl, 0.2 * fl, 0.1 * fl, 1, 3, 0, 0);
    }
    // the hero's flashlight: a cone from the muzzle along the aim (lights the ground and everyone in it; at the base no gun, none)
    if (!ST.p.dead && !ST.neutral && !ST.hub) {
      const m = SIM.muzzle(ST),
        mx = sx(m[0]),
        my = sy(m[1]) + 52,
        c = Math.cos(ST.p.aim),
        s = Math.sin(ST.p.aim);
      for (let j = 0; j < 7; j++) {
        const d = 40 + j * 62,
          r = 26 + j * 30;
        B.fx(0, mx + c * d, my + s * d * 0.75, r * 1.15, r * 0.72, 0, 0.62, 0.57, 0.46, 0.5 * (1 - j / 8), 1.6, 0, 0);
      }
    }
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (a < 0) continue;
      const x = sx(e.x),
        y = sy(e.y);
      if (e.k === 'shot' && a < 0.07) B.fx(0, x, y + 30, 200, 110, 0, 1, 0.7, 0.35, 1 - a / 0.07, 2.5, 0, 0);
      else if (e.k === 'boom' && a < 0.7) {
        const k = 1 - a / 0.7;
        B.fx(0, x, y, e.r * 2.2, e.r * 1.2, 0, 1.2 * k, 0.75 * k, 0.4 * k, 1, 2.2, 0, 0);
      } else if (e.k === 'flame' && a < 0.12)
        B.fx(0, x + Math.cos(e.a) * 90, y + 40 + Math.sin(e.a) * 60, 260, 140, 0, 1, 0.55, 0.2, 0.8, 2, 0, 0);
      else if (e.k === 'corefire' && a < 0.4)
        B.fx(0, x, y + 250, 420, 240, 0, 1.1 * (1 - a / 0.4), 0.22 * (1 - a / 0.4), 0.12 * (1 - a / 0.4), 1, 2, 0, 0);
      else if (e.k === 'zap' && a < 0.22) {
        const k = (1 - a / 0.22) * (0.75 + 0.25 * rnd(Math.floor(GT / 0.035), e.t));
        for (const [zx, zy] of e.pts) B.fx(0, sx(zx), sy(zy) + 50, 100, 56, 0, 0.25, 0.42, 0.9, k * 0.35, 2.4, 0, 0);
      }
    }
    for (const c of ST.chests) B.fx(0, sx(c.x), sy(c.y), 170, 90, 0, 0.9, 0.75, 0.35, 0.8, 2.5, 0, 0);
    for (const o of ST.loot || []) {
      const c = lootCol(o);
      B.fx(0, sx(o.x), sy(o.y), 120, 64, 0, c[0], c[1], c[2], 0.7, 2.5, 0, 0);
    }
    for (const f of ST.fire || []) {
      const a = GT - f.t0,
        k = SS(0, 0.2, a) * (1 - SS(f.dur - 0.6, f.dur, a)) * (0.85 + 0.15 * Math.sin(GT * 17 + f.x));
      B.fx(0, sx(f.x), sy(f.y), f.r * 2.4, f.r * 1.3, 0, k, 0.5 * k, 0.15 * k, 1, 1.8, 0, 0);
    }
    for (const q of ST.pud) {
      if (q.k !== 'flesh') continue; // the Devourer's infected puddles glow a dull red
      const a = GT - q.t0,
        k = SS(0, 0.2, a) * (1 - SS(q.dur - 0.6, q.dur, a));
      B.fx(0, sx(q.x), sy(q.y), q.r * 2.2, q.r * 1.2, 0, 0.9 * k, 0.15 * k, 0.12 * k, 1, 1.8, 0, 0);
    }
    for (const w of ST.wells || []) {
      const a = GT - w.t0,
        k = SS(0, 0.2, a) * (1 - SS(w.dur - 0.4, w.dur, a));
      B.fx(0, sx(w.x), sy(w.y), w.r * 1.6, w.r * 0.85, 0, 0.5 * k, 0.2 * k, 0.9 * k, 1, 1.8, 0, 0);
    }
    for (const p of heroesOf(ST)) {
      const it = p.items.find((i) => i.id === 'tesla');
      if (it && !p.dead) {
        const R = SIM.itemStats(ST, it).r * p.st.area;
        B.fx(0, sx(p.x), sy(p.y), R * 1.5, R * 0.8, 0, 0.12, 0.26, 0.6, 1, 1.6, 0, 0);
      }
    }
    for (const m of ST.msl || []) if (GT >= m.t0) B.fx(0, sx(m.x), sy(m.y), 110, 60, 0, 0.9, 0.5, 0.2, 0.6, 2.2, 0, 0);
    if (ST.arena) {
      const a = ST.arena,
        fo = a.open ? 1 - SS(0, 1.2, GT - a.open) : 1; // (the run won: the ring fades)
      if (fo > 0) B.fx(0, sx(a.x), sy(a.y), a.r * 1.1, a.r * 0.55, 0, 0.35, 0.08, 0.05, fo, 1.6, 0, 0);
    }
    for (const e of ST.en)
      if (e.elite) {
        const x = sx(e.x),
          y = sy(e.y);
        if (x > -100 && x < W + 100 && y > -100 && y < H + 200) B.fx(0, x, y, 110, 55, 0, 0.8, 0.6, 0.1, 0.8, 2, 0, 0);
      }
  }

  // ---------- effect density: FX.boom, FX.fire, FX.zap (1: all of it) thin out the small bits — smoke puffs, flame lobes, sparks,
  // embers, a bolt's side branches and finest kinks — when more than BOOM_N blasts, FIRE_N burning puddles or ZAP_N bolts are on screen at
  // once (each gets its share, never under half: piled up, they were a mess anyway) and on a device that can't keep up (S.fxk,
  // 0.5…1: index.html lowers it while a run's frames run long). A blast's flash, fireball and light, a puddle's glow, a bolt's body stay
  // whole; the puffs and lobes left grow a little to keep the mass ----------
  S.fxk = 1;
  const FX = { boom: 1, fire: 1, zap: 1, k: 1 },
    BOOM_N = 6,
    FIRE_N = 8,
    ZAP_N = 24;
  const cnt = (n, k) => (k >= 1 ? n : Math.max(1, Math.round(n * k)));
  function fxBudget(ST, GT) {
    const vis = (x, y, m) => x > -m && x < VW + m && y > -m && y < VH + m;
    let nb = 0,
      nf = 0,
      nz = 0;
    for (const e of BOOMS) if (GT - e.t < 1.8 && vis(sx(e.x), sy(e.y), 300)) nb++;
    for (const f of ST.fire || []) if (vis(sx(f.x), sy(f.y), 200)) nf++;
    for (let i = ST.ev.length - 1; i >= 0; i--) {
      const e = ST.ev[i],
        a = GT - e.t;
      if (a > ZAP_T) break;
      if (a < 0) continue; // (the events come in time order)
      if (e.k === 'zap') nz += e.pts.length - 1;
      else if (e.k === 'tesla') nz += e.pts.length;
    }
    const k = (FX.k = clamp(S.fxk, 0.5, 1)),
      share = (n, N, lo) => Math.max(lo, Math.min(1, N / Math.max(1, n)));
    FX.boom = k * share(nb, BOOM_N, 0.5);
    FX.fire = k * share(nf, FIRE_N, 0.5);
    FX.zap = k * share(nz, ZAP_N, 0.5);
  }
  // ---------- chain lightning, Keep Moving style: the bolt re-forks every 35 ms and is drawn in three layers (blue halo,
  // light-blue body, white core) with side branches, a spark burst and a blue light pool at every struck zombie ----------
  const ZAP_T = 0.22,
    BOLT = [
      [14, 0.2, 0.38, 1, 0.2],
      [5, 0.5, 0.78, 1, 0.6],
      [2.2, 0.95, 0.98, 1, 1],
    ]; // [width px, r, g, b, alpha]
  // a bolt's points: x, y pairs in a scratch path { P, n } (BOUT unless one is given — a bolt that sprouts branches keeps its own)
  const bpath = () => ({ P: new Float64Array(2 * 33), n: 0 }),
    BOUT = bpath(),
    BMAIN = bpath(),
    BTMP = new Float64Array(2 * 33),
    SEGA = new Float64Array(33),
    SEGL = new Float64Array(33);
  function boltPath(ax, ay, bx, by, lv, sd, out = BOUT) {
    // midpoint displacement, lv levels (up to 5)
    let P = out.P,
      Q = BTMP,
      n = 2;
    if (lv & 1) {
      P = BTMP;
      Q = out.P;
    } // (taken in turn so the last level lands in out)
    P[0] = ax;
    P[1] = ay;
    P[2] = bx;
    P[3] = by;
    for (let l = 0; l < lv; l++) {
      Q[0] = P[0];
      Q[1] = P[1];
      let m = 1;
      for (let i = 1; i < n; i++) {
        const x0 = P[2 * i - 2],
          y0 = P[2 * i - 1],
          x1 = P[2 * i],
          y1 = P[2 * i + 1],
          dx = x1 - x0,
          dy = y1 - y0,
          ln = Math.hypot(dx, dy) || 1,
          o = (rnd(sd + l * 17, i) - 0.5) * ln * 0.42;
        Q[2 * m] = (x0 + x1) / 2 - (dy / ln) * o;
        Q[2 * m + 1] = (y0 + y1) / 2 + (dx / ln) * o;
        Q[2 * m + 2] = x1;
        Q[2 * m + 3] = y1;
        m += 2;
      }
      const t = P;
      P = Q;
      Q = t;
      n = m;
    }
    out.n = n;
    return out;
  }
  function boltDraw(path, wk, al) {
    const P = path.P,
      n = path.n;
    for (let i = 1; i < n; i++) {
      const dx = P[2 * i] - P[2 * i - 2],
        dy = P[2 * i + 1] - P[2 * i - 1];
      SEGL[i] = Math.hypot(dx, dy);
      SEGA[i] = Math.atan2(dy, dx);
    }
    for (let L = 0; L < 3; L++) {
      const Bl = BOLT[L],
        w = Bl[0],
        ww = w * wk,
        a = Bl[4] * al,
        sh = w > 10 ? 2.2 : 3.5;
      for (let i = 1; i < n; i++) {
        const hl = SEGL[i] / 2 + ww * 0.5;
        B.fx(
          11,
          (P[2 * i - 2] + P[2 * i]) / 2,
          (P[2 * i - 1] + P[2 * i + 1]) / 2,
          hl,
          ww / 2,
          SEGA[i],
          Bl[1],
          Bl[2],
          Bl[3],
          a,
          Math.min(0.5, (ww * 0.5) / hl),
          sh,
          0,
        );
      }
    }
  }
  function elemFx(ST, GT) {
    for (const e of ST.ev) {
      if (e.k !== 'zap') continue;
      const a = GT - e.t;
      if (a < 0 || a > ZAP_T) continue;
      const fi = Math.floor(GT / 0.035),
        al = (1 - SS(0.12, ZAP_T, a)) * (0.7 + 0.3 * rnd(fi, e.t * 3)),
        wk = e.evo ? 1.3 : 1;
      for (let i = 1; i < e.pts.length; i++) {
        const ax = sx(e.pts[i - 1][0]),
          ay = sy(e.pts[i - 1][1]),
          bx = sx(e.pts[i][0]),
          by = sy(e.pts[i][1]),
          sd = fi * 31 + i * 7 + e.t * 13;
        const BP = boltPath(ax, ay, bx, by, FX.zap < 0.6 ? 3 : 4, sd, BMAIN);
        boltDraw(BP, wk, al);
        for (let f = 0; f < 2 && FX.zap >= 0.55; f++) {
          if (rnd(sd, 50 + f) < 0.6) continue; // side branches
          const k0 = 3 + Math.floor(rnd(sd, 60 + f) * (BP.n - 6)),
            fx = BP.P[2 * k0],
            fy = BP.P[2 * k0 + 1],
            ln = Math.hypot(bx - ax, by - ay) * (0.22 + 0.25 * rnd(sd, 70 + f)),
            an = Math.atan2(by - ay, bx - ax) + (rnd(sd, 80 + f) < 0.5 ? -1 : 1) * (0.5 + 0.6 * rnd(sd, 90 + f));
          boltDraw(
            boltPath(fx, fy, fx + Math.cos(an) * ln, fy + Math.sin(an) * ln, 3, sd + 101 + f),
            wk * 0.55,
            al * 0.75,
          );
        }
        const hk = 1 - SS(0, 0.16, a); // the hit: flash, star, sparks
        B.fx(0, bx, by, 24 * wk, 22 * wk, 0, 0.35, 0.6, 1, 0.5 * hk, 2.6, 0, 0);
        B.fx(3, bx, by, 22 * wk, 22 * wk, rnd(fi, i) * TAU, 0.7, 0.88, 1, 0.8 * hk, 3, 0, 0);
        for (let k = 0, nk = cnt(5, FX.zap); k < nk; k++) {
          const an = rnd(e.t + i, k) * TAU,
            d = 8 + 70 * (a / ZAP_T),
            ln = 9 * (1 - a / ZAP_T) + 3;
          B.fx(
            2,
            bx + Math.cos(an) * d,
            by + Math.sin(an) * d + 30 * (a / ZAP_T) ** 2,
            ln,
            1.5,
            an,
            0.75,
            0.9,
            1,
            al,
            3,
            0,
            0,
          );
        }
      }
      B.fx(0, sx(e.pts[0][0]), sy(e.pts[0][1]), 34, 32, 0, 0.5, 0.75, 1, al, 2.2, 0, 0);
    }
    // the tesla field: a pulse round its ring at each strike, a bolt from the ring to every zombie struck; between strikes arcs crawl
    // along the ring (the dome's also over a faint bubble)
    for (const e of ST.ev) {
      if (e.k !== 'tesla') continue;
      const a = GT - e.t;
      if (a < 0 || a > 0.2) continue;
      const fi = Math.floor(GT / 0.035),
        al = 1 - SS(0.08, 0.2, a),
        x = sx(e.x),
        y = sy(e.y),
        rr = e.r * (0.9 + (0.25 * a) / 0.2);
      B.fx(4, x, y, rr, rr / 2, 0, 0.5, 0.8, 1, 0.7 * al, 0.05, 0, 0);
      e.pts.forEach((pt, i) => {
        const bx = sx(pt[0]),
          by = sy(pt[1]),
          an = Math.atan2((by - y) * 2, bx - x),
          ax = x + Math.cos(an) * e.r * 0.45,
          ay = y - 40 + Math.sin(an) * e.r * 0.22;
        boltDraw(boltPath(ax, ay, bx, by, FX.zap < 0.6 ? 2 : 3, fi * 13 + i * 5 + e.t * 7), e.evo ? 0.75 : 0.55, al);
        B.fx(3, bx, by, 16, 16, rnd(fi, i) * TAU, 0.7, 0.9, 1, 0.8 * al, 3, 0, 0);
      });
    }
    for (const p of heroesOf(ST)) {
      const it = p.items.find((i) => i.id === 'tesla');
      if (it && !p.dead) {
        const R = SIM.itemStats(ST, it).r * p.st.area,
          x = sx(p.x),
          y = sy(p.y),
          fi = Math.floor(GT / 0.06);
        if (it.evo) {
          B.fx(4, x, y - R * 0.32, R * 1.02, R * 0.8, 0, 0.35, 0.6, 1, 0.22 + 0.06 * Math.sin(GT * 7), 0.035, 0, 0);
          B.fx(0, x, y - R * 0.3, R, R * 0.78, 0, 0.1, 0.2, 0.5, 0.16, 1.1, 0, 0);
        }
        for (let k = 0, nk = cnt(it.evo ? 5 : 3, FX.zap); k < nk; k++) {
          const an = rnd(fi, k) * TAU,
            an2 = an + 0.22 + rnd(fi, k + 5) * 0.35;
          boltDraw(
            boltPath(
              x + Math.cos(an) * R,
              y + (Math.sin(an) * R) / 2,
              x + Math.cos(an2) * R,
              y + (Math.sin(an2) * R) / 2,
              2,
              fi * 7 + k,
            ),
            0.28,
            0.55,
          );
        }
      }
    }
    // the coil over the hero's shoulder: a crackling orb that brightens as the next discharge comes due
    for (const p of heroesOf(ST)) {
      const it = p.items.find((i) => i.id === 'chain');
      if (it && !p.dead) {
        const [cx0, cy0] = asHero(ST, p, () => SIM.coil(ST)),
          cx = sx(cx0),
          cy = sy(cy0),
          cd = it.evo ? 0.7 : D.ITEMS.chain.st[it.lvl - 1].cd,
          ch = 1 - clamp(it.cd / cd, 0, 1),
          fi = Math.floor(GT / 0.035);
        B.fx(0, cx, cy, 22 + 14 * ch, 22 + 14 * ch, 0, 0.35, 0.6, 1, 0.45 + 0.4 * ch, 2.2, 0, 0);
        B.fx(0, cx, cy, 6 + 3 * ch, 6 + 3 * ch, 0, 0.9, 0.97, 1, 0.9, 2, 0, 0);
        for (let k = 0; k < 1 + Math.round(ch * 2); k++) {
          const an = rnd(fi, k) * TAU,
            ln = 10 + 12 * ch;
          boltDraw(boltPath(cx, cy, cx + Math.cos(an) * ln, cy + Math.sin(an) * ln, 2, fi * 5 + k), 0.35, 0.7);
        }
      }
    }
    B.flush(B.F, 'fx', 'add');
  }
  // ---------- ground-level FX ----------
  // aiming by hand (mouse or the aim stick; the pistol has its laser instead): the gun's reach on the ground under everyone — a wedge
  // from the muzzle along the aim as wide as its spread (the flamethrower's cone), out to where its shots end; it fades in and out
  const AZ = { a: 0, t: 0 },
    AZC = { flame: [1, 0.52, 0.18], rocket: [1, 0.45, 0.3], sniper: [0.7, 0.9, 1], laser: [0.6, 0.85, 1] };
  function aimZone(ST, GT, t) {
    const p = ST.p,
      on = p.manual && !p.dead && !ST.pause && !ST.over && !ST.hub && p.main.id !== 'pistol',
      dt = clamp(t - AZ.t, 0, 0.1);
    AZ.t = t;
    AZ.a += ((on ? 1 : 0) - AZ.a) * Math.min(1, dt * 12);
    if (AZ.a < 0.01 || p.main.id === 'pistol') return;
    const md = SIM.mainStats(ST),
      R = Math.max(120, md.range || 400),
      h = clamp(p.main.id === 'flame' ? md.cone : (md.spread || 0) / 2, 0.045, 1.2),
      hw = R * Math.sin(h) + 12;
    B.flush(B.F, 'fx'); // (what was queued before stays under it)
    const m = SIM.muzzle(ST),
      x = sx(m[0]),
      y = sy(m[1]); // (from the muzzle, as the shots fly)
    G.draw(
      L.P.aimzone,
      { u_R: R, u_h: h, u_hw: hw, u_r0: 10, u_a: AZ.a, u_tt: GT, u_c: AZC[p.main.id] || [1, 0.86, 0.5] },
      G.xf(x, y - hw, R * 1.04, hw * 2, p.aim, 0, hw),
    );
  }
  // the Devourer's wave (SIM 'slam' with bio: r its reach, r0 and dur its run): his flesh wells up out of the floor as the wave
  // passes, filling the whole ring — the core's lumps' look (dark crimson masses, raw pink tissue, a wet gleam) over a pool of blood
  // spreading with it — then it sinks away. The masses lie on a sunflower spiral (even over the disc), each rising as the crest reaches it
  const GOLDEN = 2.39996;
  function fleshFill(e, GT) {
    const a = GT - e.t,
      R = e.r || 520,
      r0 = e.r0 || 40,
      dur = e.dur || 0.8,
      end = dur + 1.7;
    if (a < 0 || a > end) return;
    const x = sx(e.x),
      y = sy(e.y),
      fade = 1 - SS(dur + 0.8, end, a),
      rc = r0 + (R - r0) * clamp(a / dur, 0, 1); // (the crest now)
    // the pool: deep blood spreading with the crest, its edge ragged (puffs round it), the crevices between the masses this dark
    B.fx(0, x, y, rc * 1.02, rc * 0.51, 0, 0.13, 0.0, 0.02, 0.9 * fade, 1.1, 0, 1);
    const ne = cnt(Math.round(rc / 22), FX.k);
    for (let j = 0; j < ne; j++) {
      const an = (j / ne) * TAU + e.t,
        rr = rc * (0.93 + 0.05 * Math.sin(j * 2.7 + e.t)),
        w = 34 + 20 * rnd(e.t, j + 90);
      B.fx(1, x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.5, w, w * 0.5, 0, 0.2, 0.01, 0.03, 0.85 * fade, 1, j, 1);
    }
    const n = cnt(Math.round((R / 62) ** 2 * 2.2), FX.k);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n,
        rho = R * 0.92 * Math.sqrt(u) * (0.94 + 0.1 * rnd(e.t, i)),
        la = a - (rho <= r0 ? 0 : (dur * (rho - r0)) / (R - r0)); // (how long since the crest passed it)
      if (la < 0) continue;
      const an = i * GOLDEN + e.t + 0.4 * rnd(e.t, i + 1),
        pop = SS(0, 0.16, la) * (1 + 0.25 * Math.sin(Math.min(la, 0.45) * 21) * (1 - SS(0, 0.45, la))), // up with a wobble
        sz = (0.8 + 0.7 * rnd(e.t, i + 7)) * pop * (0.4 + 0.6 * fade),
        px = x + Math.cos(an) * rho,
        py = y + Math.sin(an) * rho * 0.5,
        pu = 1 + 0.07 * Math.sin(GT * (6 + 4 * rnd(e.t, i + 8)) + i),
        tone = rnd(e.t, i + 9), // (from deep maroon to raw red)
        al = fade;
      if (sz < 0.02) continue;
      B.fx(9, px + 9 * sz, py + 6 * sz, 34 * sz, 19 * sz, 0, 0.1, 0.0, 0.02, 0.9 * al, 3, i + 3, 1); // its shade, deep in the blood
      B.fx(
        9,
        px,
        py - 6 * sz,
        33 * sz * pu,
        21 * (sz / pu),
        0,
        0.27 + 0.2 * tone,
        0.03 + 0.05 * tone,
        0.05 + 0.04 * tone,
        al,
        3,
        i,
        1,
      ); // the mass
      if (tone > 0.45) B.fx(9, px - 9 * sz, py - 13 * sz, 13 * sz, 8 * sz, 0, 0.66, 0.27, 0.26, 0.85 * al, 3, i + 7, 1); // raw pink tissue
      if (i % 9 === 4) {
        B.fx(9, px + 4 * sz, py - 9 * sz, 10 * sz * pu, 8 * sz * pu, 0, 0.62, 0.22, 0.12, al, 3, i + 11, 1); // a blister
        B.fx(
          0,
          px + 4 * sz,
          py - 9 * sz,
          9 * sz,
          7 * sz,
          0,
          1,
          0.45,
          0.12,
          (0.45 + 0.35 * Math.sin(GT * 7 + i)) * al,
          2.5,
          0,
          0,
        ); // the core's glow in it
      }
      if (rnd(e.t, i + 12) < 0.6)
        B.fx(0, px - 11 * sz, py - 15 * sz, 5 * sz, 3.2 * sz, 0, 1, 0.86, 0.82, 0.7 * al, 3, 0, 1); // a wet gleam
    }
  }
  function groundFx(ST, GT, t) {
    droppedMags(ST, GT, true);
    for (const e of ST.ev) if (e.k === 'slam' && e.bio) fleshFill(e, GT);
    // a lump of the Devourer's flesh in the air: its shadow sliding over the ground to the mark, growing as it comes down
    for (const b of ST.eb) {
      if (b.k !== 'rock' || !b.flesh || GT < b.t0) continue;
      const k = clamp((GT - b.t0) / b.dur, 0, 1),
        r = 12 + 26 * k;
      B.fx(
        5,
        sx(b.x0 + (b.x1 - b.x0) * k),
        sy(b.g0 + (b.y1 - b.g0) * k),
        r,
        r * 0.5,
        0,
        0.05,
        0,
        0.02,
        0.3 + 0.4 * k,
        3,
        0,
        1,
      );
    }
    // the Devourer's infected puddles — a dark red pool, swollen blisters round its middle: drawn here, over the light map (the dim
    // lab would swallow them), under the actors
    for (const q of ST.pud) {
      if (q.k !== 'flesh') continue;
      const a = GT - q.t0,
        k = SS(0, 0.3, a) * (1 - SS(q.dur - 1, q.dur, a));
      for (let j = 0; j < 5; j++) {
        const an = (j / 5) * TAU + q.x,
          d = j ? q.r * 0.45 : 0,
          rad = q.r * (j ? 0.5 : 0.85) * (0.95 + 0.05 * Math.sin(a * 3 + j));
        B.fx(
          1,
          sx(q.x) + Math.cos(an) * d,
          sy(q.y) + Math.sin(an) * d * 0.5,
          rad,
          rad * 0.5,
          0,
          0.75,
          0.08,
          0.12,
          0.95 * k,
          1,
          j + Math.floor(q.x),
          1,
        );
      }
      // its edge, a pulsing red ring as the danger marks have: what burns is inside it
      B.fx(4, sx(q.x), sy(q.y), q.r, q.r / 2, 0, 1, 0.2, 0.15, (0.6 + 0.25 * Math.sin(a * 6)) * k, 0.06, 0, 1);
    }
    for (const q of ST.tele) {
      const a = GT - q.t0,
        k = clamp(a / q.dur, 0, 1),
        x = sx(q.x),
        y = sy(q.y),
        pulse = 0.65 + 0.35 * Math.sin(a * 22);
      if (q.k === 'line') {
        const cx = x + (Math.cos(q.a) * q.len) / 2,
          cy = y + (Math.sin(q.a) * q.len) / 2;
        B.fx(6, cx, cy, q.len / 2, (q.w / 2) * (0.6 + 0.4 * k), q.a, 1, 0.12, 0.08, 0.55 * pulse, 3, 0, 1);
        B.fx(
          6,
          x + (Math.cos(q.a) * q.len * k) / 2,
          y + (Math.sin(q.a) * q.len * k) / 2,
          (q.len * k) / 2,
          (q.w / 2) * 0.6,
          q.a,
          1,
          0.3,
          0.2,
          0.6,
          3,
          0,
          0,
        );
      } else if (q.k === 'ring' || q.k === 'mark' || q.k === 'shadow') {
        const rx = q.r,
          ry = q.r / 2;
        if (q.k === 'shadow')
          B.fx(5, x, y, rx * (0.3 + 0.7 * k), ry * (0.3 + 0.7 * k), 0, 0.05, 0.0, 0.05, 0.75, 3, 0, 1);
        const C = q.col
          ? [
              [0.25, 0.8, 0.05],
              [0.55, 1, 0.2],
              [0.8, 1, 0.45],
            ]
          : [
              [0.8, 0.05, 0.05],
              [1, 0.2, 0.15],
              [1, 0.5, 0.3],
            ]; // acid green / danger red
        B.fx(5, x, y, rx, ry, 0, C[0][0], C[0][1], C[0][2], 0.28 * pulse * SS(0, 0.15, a), 3, 0, 1);
        B.fx(4, x, y, rx, ry, 0, C[1][0], C[1][1], C[1][2], 0.9 * pulse, 0.05, 0, 1);
        B.fx(4, x, y, rx * k, ry * k, 0, C[2][0], C[2][1], C[2][2], 0.9, 0.08, 0, 0);
        if (q.k === 'mark') {
          B.fx(6, x, y, rx * 0.7, 3, 0, C[1][0], C[1][1], C[1][2], 0.8, 3, 0, 1);
          B.fx(6, x, y, 3, ry * 0.7, 0, C[1][0], C[1][1], C[1][2], 0.8, 3, 0, 1);
        }
      }
    }
    if (ST.arena) {
      const A = ST.arena,
        a = GT - A.t,
        fo = A.open ? 1 - SS(0, 1.2, GT - A.open) : 1;
      if (fo > 0) B.fx(4, sx(A.x), sy(A.y), A.r, A.r / 2, 0, 1, 0.25, 0.15, 0.55 * SS(0, 0.6, a) * fo, 0.025, 0, 0);
    }
    // a mission's closed line (the heroes can't cross it yet: S.mis.bar), red and pulsing; the glowing ring on the spot
    // its reach task wants the hero on (ring), a wave running out from its middle
    const MI = ST.mis;
    if (MI && MI.bar) {
      const [ax, ay, bx, by] = MI.bar,
        x0 = sx(ax),
        y0 = sy(ay),
        x1 = sx(bx),
        y1 = sy(by),
        len = Math.hypot(x1 - x0, y1 - y0) + 80,
        an = Math.atan2(y1 - y0, x1 - x0),
        pl = 0.75 + 0.25 * Math.sin(GT * 5);
      B.fx(6, (x0 + x1) / 2, (y0 + y1) / 2, len / 2, 12, an, 1, 0.15, 0.1, 0.3 * pl, 3, 0, 1);
      B.fx(6, (x0 + x1) / 2, (y0 + y1) / 2, len / 2, 3.5, an, 1, 0.4, 0.3, 0.85 * pl, 3, 0, 1);
    }
    const GL = MI ? SIM.goal(ST) : null;
    if (GL && GL.ring && GL.at) {
      const x = sx(GL.at[0]),
        y = sy(GL.at[1]),
        r = 140,
        pl = 0.7 + 0.3 * Math.sin(GT * 4),
        w = (GT * 0.6) % 1;
      B.fx(5, x, y, r, r / 2, 0, 1, 0.75, 0.2, 0.22 * pl, 3, 0, 1);
      B.fx(4, x, y, r, r / 2, 0, 1, 0.85, 0.3, 0.9 * pl, 0.05, 0, 1);
      B.fx(4, x, y, r * w, (r / 2) * w, 0, 1, 0.95, 0.6, 0.8 * (1 - w), 0.08, 0, 0);
    }
    // a bomber on its fuse: the ring it will blow up in, red as the bosses' marks, filling as the fuse burns down and pulsing with its blinks
    for (const e of ST.en) {
      const d = D.ENEMIES[e.k];
      if (!d.bomb || e.fuse === undefined || e.dead) continue;
      const a = Math.max(0, GT - e.fuse),
        k = clamp(a / d.bomb.fuse, 0, 1),
        x = sx(e.x),
        y = sy(e.y);
      if (x < -300 || x > W + 300 || y < -200 || y > H + 200) continue;
      const rx = d.bomb.r,
        ry = rx / 2,
        pulse = fusePh(a) % 1 < 0.32 ? 1 : 0.6;
      B.fx(5, x, y, rx, ry, 0, 0.8, 0.05, 0.05, 0.3 * pulse * SS(0, 0.15, a), 3, 0, 1);
      B.fx(4, x, y, rx, ry, 0, 1, 0.2, 0.15, 0.9 * pulse, 0.05, 0, 1);
      B.fx(4, x, y, rx * k, ry * k, 0, 1, 0.5, 0.3, 0.9, 0.08, 0, 0);
    }
    // molotov puddles: charred ground under a glowing pool (the flames rise in the air pass)
    for (const f of ST.fire || []) {
      const a = GT - f.t0,
        k = SS(0, 0.15, a) * (1 - SS(f.dur - 0.6, f.dur, a)),
        x = sx(f.x),
        y = sy(f.y);
      B.fx(5, x, y, f.r * 1.05, f.r * 0.52, 0, 0.12, 0.03, 0, 0.55 * k, 3, 0, 1);
      B.fx(0, x, y, f.r, f.r * 0.5, 0, 1, 0.42, 0.08, 0.45 * k, 1.6, 0, 0);
      for (let j = 0, nb = cnt(7, FX.fire); j < nb; j++) {
        const an = rnd(f.t0, j) * TAU,
          d = f.r * 0.62 * Math.sqrt(rnd(f.t0, j + 9));
        B.fx(
          0,
          x + Math.cos(an) * d,
          y + Math.sin(an) * d * 0.5,
          f.r * 0.26,
          f.r * 0.13,
          0,
          1,
          0.72,
          0.22,
          0.4 * k * (0.7 + 0.3 * Math.sin(GT * 13 + j * 2.1)),
          2,
          0,
          0,
        );
      }
    }
    // gravity wells: a dark heart, violet rings closing in, dust spiralling into it
    for (const w of ST.wells || []) {
      const a = GT - w.t0,
        k = SS(0, 0.18, a) * (1 - SS(w.dur - 0.35, w.dur, a)),
        x = sx(w.x),
        y = sy(w.y);
      B.fx(5, x, y, w.r * 0.78, w.r * 0.39, 0, 0.06, 0, 0.12, 0.7 * k, 3, 0, 1);
      for (let j = 0; j < 3; j++) {
        const q = (a * 0.9 + j / 3) % 1,
          r2 = w.r * (1 - q);
        B.fx(4, x, y, r2, r2 / 2, 0, 0.65, 0.35, 1, 0.75 * k * q, 0.06, 0, 0);
      }
      for (let j = 0, nd = cnt(16, FX.k); j < nd; j++) {
        const sp = rnd(w.t0, j),
          q = (a * (0.8 + 0.6 * sp) + sp) % 1,
          an = sp * TAU + a * (3 + 2 * sp) + q * 3,
          d = w.r * (1 - q) * 0.95,
          ta = an + Math.PI / 2 + 0.6;
        B.fx(
          2,
          x + Math.cos(an) * d,
          y + Math.sin(an) * d * 0.5,
          14 + 10 * q,
          2.2,
          Math.atan2(Math.sin(ta) * 0.5, Math.cos(ta)),
          0.75,
          0.55,
          1,
          0.8 * k * Math.sin(Math.PI * q),
          3,
          0,
          0,
        );
      }
    }
    // the tesla field's ring on the ground
    for (const p of heroesOf(ST)) {
      const it = p.items.find((i) => i.id === 'tesla');
      if (it && !p.dead) {
        const R = SIM.itemStats(ST, it).r * p.st.area;
        B.fx(4, sx(p.x), sy(p.y), R, R / 2, 0, 0.35, 0.65, 1, 0.32 + 0.1 * Math.sin(GT * 9), 0.04, 0, 0);
      }
    }
    aimZone(ST, GT, t);
    for (const b of ST.eb)
      if (b.k === 'wave' && !b.bio) {
        const k = clamp((GT - b.t0) / b.dur, 0, 1),
          r = b.r0 + (b.r1 - b.r0) * k,
          x = sx(b.x),
          y = sy(b.y),
          al = 1 - SS(0.7, 1, k);
        if (b.sonic) {
          for (let j = 0; j < 3; j++) {
            const rr = r - j * 22;
            if (rr <= 0) continue; // the banshee's sonic wave: pale violet rings
            B.fx(4, x, y, rr, rr / 2, 0, 0.78, 0.6, 1, (0.9 - j * 0.25) * al, 0.04, 0, 0);
          }
          B.fx(4, x, y, r - 8, r / 2 - 4, 0, 1, 0.92, 1, 0.5 * al, 0.1, 0, 1);
          continue;
        }
        B.fx(4, x, y, r, r / 2, 0, 1, 0.55, 0.3, 0.95 * al, 0.05, 0, 0);
        B.fx(4, x, y, r - 14, r / 2 - 7, 0, 0.9, 0.75, 0.6, 0.5 * al, 0.12, 0, 1);
        for (let j = 0; j < 18; j++) {
          const an = (j / 18) * TAU + b.t0;
          B.fx(
            1,
            x + Math.cos(an) * r,
            y + (Math.sin(an) * r) / 2 - 8,
            26,
            16,
            0,
            0.82,
            0.74,
            0.66,
            0.55 * al,
            1,
            j + b.t0,
            1,
          );
        }
      }
    for (const e of ST.ev) {
      if (e.k !== 'ric') continue;
      const a = GT - e.t;
      if (a < 0 || a > 0.16) continue;
      const x = sx(e.x),
        y = sy(e.y),
        q = a / 0.16;
      B.fx(0, x, y, 14 * (1 - q), 14 * (1 - q), 0, 1, 0.9, 0.6, 1 - q, 3, 0, 0);
      for (let j = 0; j < 3; j++) {
        const an = e.a + Math.PI + (rnd(e.t, j) - 0.5) * 1.8,
          d0 = 8 + 60 * q;
        B.fx(2, x + Math.cos(an) * d0, y + Math.sin(an) * d0, 9, 1.6, an, 1, 0.8, 0.4, 1 - q, 3, 0, 0);
      }
    }
    for (const g of ST.gems) {
      const x = sx(g.x),
        y = sy(g.y);
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      const c = g.v >= 10 ? [1, 0.25, 0.25] : g.v >= 3 ? [0.35, 1, 0.3] : [0.3, 0.75, 1];
      B.fx(0, x, y - 12 - g.z, 26, 22, 0, c[0], c[1], c[2], 0.45 + 0.15 * Math.sin(GT * 4 + g.x), 3, 0, 0);
    }
    // shells lying on the ground for 2 s
    for (const e of ST.ev) {
      if (e.k !== 'shot' || e.w === 'drone' || e.w === 'turret' || e.w === 'rocket') continue;
      const a = GT - e.t;
      if (a > 2.2 || a < 0) continue;
      const side = Math.cos(e.a) > 0 ? -1 : 1,
        j = rnd(e.t * 13, 1),
        fa = Math.min(a, 0.45) / 0.45,
        vx = side * (40 + 60 * j),
        dist = ((vx * (1 - Math.exp(-a * 3))) / 3) * 3;
      const z = Math.max(0, 70 * fa * (1 - fa) * HK) * (a < 0.45 ? 1 : 0),
        x = sx(e.x) - Math.cos(e.a) * 30 * HK + dist * 0.6 * HK,
        y = sy(e.y) + SIM.HERO.h * 0.38 + j * 8 * HK - z;
      const rot = a < 0.45 ? a * 25 : j * 3,
        sw = 17 * HK,
        sh2 = 9 * HK,
        c2 = Math.cos(rot),
        s2 = Math.sin(rot);
      B.spr(
        'x_shell',
        [c2 * sw, s2 * sw, -s2 * sh2, c2 * sh2, x - (c2 * sw - s2 * sh2) / 2, y - (s2 * sw + c2 * sh2) / 2],
        1,
        1,
        1,
        1 - SS(1.8, 2.2, a),
        0,
        0,
      );
    }
    B.flush(B.S, 'spr');
  }

  // ---------- the actors' cast shadows: each zombie's own rig laid on the ground away from the low sun (the props' baked shadows'
  // direction: LX, LY), limbs moving with it; the hero and the 3D bosses their own models laid flat the same way (charmesh cast), as
  // they move. Drawn white into a mask (blend MAX: limbs that overlap never darken twice), blurred, then multiplied into the light map:
  // on the ground, under the actors ----------
  const SHX = (LX - LY) * 0.85,
    SHY = ((LX + LY) / 2) * 0.85; // screen offset of a shadow per px of height
  const CAST3 = [SHX * Math.cos(Math.PI / 6), SHY / Math.tan(Math.PI / 6)]; // the same for a 3D model: its units along x and toward the viewer per unit of height (the run's camera tip)
  // (its strength 2.2: charmesh pales a cast toward the head's end; in the mask, clamped to white, it stays as solid as a zombie's)
  function castActors(ST, GT) {
    const sk = SIM.level(ST.seed).map === 'lab' ? 0.45 : 1,
      SX = SHX * sk,
      SY = SHY * sk,
      C3 = [CAST3[0] * sk, CAST3[1] * sk]; // (the lab: lit from above, short)
    const gl = G.gl,
      vis = (x, y, m) => x > -m && x < W / ZM + m && y > -m && y < H / ZM + m;
    const long = (x, y, h, w, a) => {
      const dx = SX * h,
        dy = SY * h,
        l = Math.hypot(dx, dy);
      B.fx(5, x + dx / 2, y + dy / 2, l / 2 + w / 2, w / 2, Math.atan2(dy, dx), 1, 1, 1, a, 2, 0, 1);
    };
    G.bind(T.shad, [0, 0, 0, 1]);
    for (const e of ST.en) {
      if (e.dead) continue;
      const d = D.ENEMIES[e.k],
        x = sx(e.x),
        y = sy(e.y),
        h = (d.h * e.r) / d.r;
      if (!vis(x, y, h * 2)) continue;
      const rise = clamp((GT - e.spT) / 0.35, 0, 1),
        up = e.st === 'air' ? Math.sin(Math.PI * clamp(GT - e.stT, 0, 1)) : 0;
      if (b3Has(d) && up <= 0.02) {
        const [an, f] = b3Anim(e, d, GT, h);
        CHARMESH.draw(d.b3d, an, f, x, y, h, e.yaw ?? 0, { cast: [C3[0], C3[1], 2.2 * rise], ccol: [1, 1, 1] });
        continue;
      }
      if (b3Has(d) || up > 0.02 || S.low) {
        long(x, y, h * (1 - up * 0.4), h * 0.42, 0.9 * rise * (1 - up * 0.7));
        continue;
      }
      const P = enemyPose(e, d, GT);
      P.shade = [SX, SY];
      P.tint = [1, 1, 1];
      P.flash = 1;
      P.rim = 0;
      P.alpha = 0.9 * rise;
      P.held = P.behind = null;
      drawRig(rigOf(e.k), x, y, h, e.face, P, null);
    }
    for (const p of heroesOf(ST)) {
      const hs = HST[p.i | 0]; // (each hero as it was drawn last frame: its state steps in the band)
      if (!p.dead || p.down) {
        if (hs && hs.layers && HERO3D.ready())
          HERO3D.draw(hs, sx(p.x), sy(p.y), heroH(ST), p.main.id, {
            cast: [C3[0], C3[1], 2.2],
            ccol: [1, 1, 1],
            lod: true,
            pack: p === ST.p ? undefined : 1, // (as the hero is drawn)
          });
        else long(sx(p.x), sy(p.y), heroH(ST) * 0.8, 44, 1);
      }
    }
    for (const c of ST.chests) if (c.k !== 'air') long(sx(c.x), sy(c.y), 40, 52, 0.7);
    gl.blendEquation(gl.MAX);
    B.flush(B.S, 'spr');
    B.flush(B.F, 'fx');
    gl.blendEquation(gl.FUNC_ADD);
    G.blend('none');
    G.bind(T.shad2);
    G.full(L.P.blur, { u_src: T.shad, u_dir: [1.2, 0] });
    G.bind(T.shad);
    G.full(L.P.blur, { u_src: T.shad2, u_dir: [0, 1.2] });
    G.bind(T.light);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    G.full(L.P.shade, { u_src: T.shad, u_k: 1.0 });
    G.blend();
  }
  // ---------- contact shadows (footprint-shaped, offset away from the light): the dark right under the feet ----------
  function shadows(ST, LV, GT) {
    const vis = (x, y, m) => x > -m && x < VW + m && y > -m && y < VH + m;
    for (const e of ST.en) {
      const d = D.ENEMIES[e.k],
        x = sx(e.x),
        y = sy(e.y);
      if (!vis(x, y, 200)) continue;
      const k = e.r / d.r,
        z = e.st === 'air' ? Math.sin(Math.PI * clamp(GT - e.stT, 0, 1)) : 0;
      B.fx(
        5,
        x + 3,
        y + 1,
        d.h * 0.2 * k * (1 - z * 0.5),
        d.h * 0.07 * k * (1 - z * 0.5),
        0,
        0.03,
        0.0,
        0.06,
        0.45,
        3,
        0,
        1,
      );
    }
    for (const p of heroesOf(ST)) {
      if (!p.dead || p.down) {
        B.fx(5, sx(p.x) + 2, sy(p.y) + 1, 28, 10, 0, 0.03, 0, 0.06, 0.6, 2.6, 0, 1);
        B.fx(5, sx(p.x) + 1, sy(p.y) + 1, 16, 6, 0, 0.02, 0, 0.04, 0.55, 3, 0, 1);
      } // (the cat's paws: a wide pool)
      const it = p.items.find((i) => i.id === 'drone');
      if (it && !p.dead) for (const d of it.dr) B.fx(5, sx(d.x), sy(d.y), 16, 5, 0, 0.03, 0, 0.06, 0.2, 3, 0, 1);
    }
    for (const g of ST.pk) B.fx(5, sx(g.x), sy(g.y) + 1, 16, 5, 0, 0.03, 0, 0.06, 0.45, 3, 0, 1);
    for (const c of ST.corpses) {
      const a = GT - c.t;
      if (!c.T || a < 0 || a > c.T) continue;
      const z = c.vz * a - (SIM.GRAV / 2) * a * a,
        k = 1 / (1 + z / 120),
        d = D.ENEMIES[c.ek]; // thrown bodies
      B.fx(
        5,
        sx(c.x + c.vx * a),
        sy(c.y + c.vy * a),
        d.h * 0.36 * k,
        d.h * 0.12 * k,
        0,
        0.03,
        0,
        0.06,
        0.5 * k,
        3,
        0,
        1,
      );
    }
    for (const c of ST.chests) {
      const k = c.k === 'air' ? clamp(1 - c.z / 650, 0.25, 1) : 1;
      B.fx(5, sx(c.x), sy(c.y), 44 * k, 15 * k, 0, 0.03, 0, 0.06, 0.55 * k, 3, 0, 1);
    }
    for (const u of ST.tur || []) B.fx(5, sx(u.x) + 2, sy(u.y) + 1, 34, 12, 0, 0.03, 0, 0.06, 0.55, 3, 0, 1);
    // crates and barrels (the ground bakes every other prop's shadow): a contact pool and a cast shadow along the light, gone with them
    const A = window.ASSETS,
      ca = Math.atan2((LX + LY) / 2, LX - LY);
    for (let k = 0; k < LV.destr.length; k++) {
      const o = LV.props[LV.destr[k]],
        x = sx(o.x),
        y = sy(o.y);
      if (!vis(x, y, 200)) continue;
      if (ST.pd[k] <= 0) {
        if (o.barrel) B.fx(5, x + 3, y + 3, o.w * 0.5, o.w * 0.22, 0, 0.03, 0, 0.06, 0.45, 3, 0, 1);
        continue;
      } // (a burst barrel's shell)
      const a = A[o.n],
        hs = clamp(o.w * (a ? a.h / a.w : 1) - (o.fw + o.fh) / 2, 10, 120),
        cl = hs * Math.hypot(LX - LY, (LX + LY) / 2);
      B.fx(
        5,
        x + Math.cos(ca) * cl * 0.5,
        y + Math.sin(ca) * cl * 0.5,
        cl * 0.5 + o.w * 0.3,
        o.w * 0.2,
        ca,
        0.05,
        0.03,
        0.12,
        0.42,
        3,
        0,
        1,
      );
      B.fx(5, x + 3, y + 3, o.w * 0.42, o.w * 0.2, 0, 0.03, 0, 0.06, 0.4, 3, 0, 1);
    }
  }

  // ---------- the depth band ----------
  const band = (ST, LV, GT, t) => {
    const items = [],
      p = ST.p;
    // the boss arena: a ring of concrete barriers dropping in around it
    if (ST.arena) {
      const A = ST.arena,
        n = 44;
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU,
          x = A.x + Math.cos(an) * A.r,
          y = A.y + (Math.sin(an) * A.r) / 2;
        if (x > camX - 200 && x < camX + VW + 200 && y > camY - 100 && y < camY + VH + 300)
          items.push([y, 9, { x, y, an, i, t: A.t }]);
      }
    }
    const inView = (x, y, mx, myTop, myBot) =>
      x > camX - mx && x < camX + VW + mx && y > camY - myBot && y < camY + VH + myTop;
    for (const o of LV.props) {
      if (o.hide || !inView(o.x, o.fy, o.w, o.w * 1.6, 60)) continue;
      if (o.junk && ST.base && ST.base.j[o.junk]) continue; // (the base: a heap of junk cleared away, hub.js)
      if (o.hp && ST.pd[o.di] <= 0) {
        if (o.barrel) items.push([o.y, 11, o]);
        continue;
      }
      const dz = (o.dz || 0) + (LV.base && NPC3D[o.n] ? NPC_SEAT_DZ : 0);
      items.push([o.roof ? o.fy + 1 : o.flat ? -1e9 + o.y : o.y + dz, 0, o]); // (a roof: over everything under it and
      // behind it; a flat one, blood or litter, under everyone; dz: a set's front layer after the one sitting in it, who
      // comes after the set: gen/m1art.py split)
    }
    for (const b of LV.bushes) if (inView(b.x, b.y, b.w, b.w, 40)) items.push([b.y, 1, b]);
    for (const b of LV.balloons) if (inView(b.x, b.y, 80, 220, 20)) items.push([b.y + 0.5, 10, b]);
    for (const e of ST.en) if (inView(e.x, e.y, 260, D.ENEMIES[e.k].h + 340, 60)) items.push([e.y, 2, e]);
    ST.corpses.forEach((c, i) => {
      const a = GT - c.t;
      if (a >= 0 && corpsePhase(c, a) === 'band' && inView(c.x, c.y, 200, 300, 60)) items.push([c.y - 1, 3, c, i]);
    });
    for (const h of heroesOf(ST)) items.push([h.y, 4, h]);
    for (const g of ST.pk) items.push([g.y, 6, g]);
    for (const g of ST.gems) if (inView(g.x, g.y, 30, 60, 30)) items.push([g.y, 7, g]);
    for (const c of ST.chests) items.push([c.y, 8, c]);
    for (const u of ST.tur || []) if (inView(u.x, u.y, 120, 160, 40)) items.push([u.y, 12, u]);
    for (const o of ST.loot || []) if (inView(o.x, o.y, 80, 260, 30)) items.push([o.y, 13, o]);
    // a prop with a long footprint (a fence, a wall, a building, a car) sorted by its middle alone would let an actor walking along its
    // front slip behind it (or one behind it show through): an actor beside one goes right after it when past either of its front
    // faces (ground x past its x1 or y past its y1), else right before it
    let big = null;
    for (const it of items) if (it[1] === 0 && it[2].fw + it[2].fh > 140 && !it[2].roof) (big || (big = [])).push(it);
    if (big)
      for (const it of items) {
        const k = it[1];
        if (k !== 2 && k !== 3 && k !== 4) continue;
        const a = it[2],
          ax = a.x - SIM.G; // (a screen point's x, less G: its ground x − y)
        for (const b of big) {
          const c = b[2].col;
          if (a.y > b[2].fy + 40 || a.y < b[2].y - 700 || ax < c.x0 - c.y1 - 90 || ax > c.x1 - c.y0 + 90) continue; // (not where it is drawn)
          if (inFront(c, a.x, a.y)) {
            if (it[0] <= b[0]) it[0] = b[0] + 0.01;
          } else if (it[0] >= b[0]) it[0] = b[0] - 0.01;
        }
      }
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, k, o, ci] of items) {
      if (k === 0) drawProp(ST, LV, o, GT, t);
      else if (k === 1) drawBush(ST, o, GT, t);
      else if (k === 2) drawEnemy(ST, o, GT, t);
      else if (k === 3) drawCorpse(ST, o, GT, ci);
      else if (k === 4) drawHero(ST, GT, t, o);
      else if (k === 6) drawPickup(ST, o, GT);
      else if (k === 7) drawGem(ST, o, GT);
      else if (k === 8) drawChest(ST, o, GT);
      else if (k === 9) drawArenaWall(o, GT);
      else if (k === 10) drawBalloon(ST, o, GT);
      else if (k === 11) drawWreck(o, GT);
      else if (k === 12) drawTurret(o, GT);
      else if (k === 13) drawLoot(ST, o, GT);
    }
  };
  // ---------- a turret: dropped in, the tripod and the twin gun on it turned to its aim; one about to go blinks; the checkpoint's shows
  // its wear (a bar) ----------
  function drawTurret(u, GT) {
    const a = GT - u.t0,
      x = sx(u.x),
      y = sy(u.y),
      drop = a < 0.22 ? (1 - a / 0.22) ** 2 * 140 : 0,
      left = u.evo ? 99 : u.life - a,
      al = left < 1.5 && Math.floor(GT * 8) % 2 ? 0.5 : 1;
    const tint = u.evo ? [1.05, 0.92, 0.85] : null,
      flip = Math.cos(u.aim) < 0;
    if (B.R.s_turret_base) sprAt('s_turret_base', x, y - drop, 78, false, al, 0, 0.85, 0, 1, tint);
    else {
      B.fx(7, x, y - 14 - drop, 26, 12, 0, 0.36, 0.34, 0.36, al, 3, 0, 1);
      B.fx(7, x, y - 30 - drop, 9, 14, 0, 0.9, 0.45, 0.1, al, 3, 0, 1);
    }
    const gy = y - drop - 52,
      tilt = clamp(Math.atan2(Math.sin(u.aim), Math.abs(Math.cos(u.aim))) * 0.55, -0.55, 0.55) * (flip ? -1 : 1),
      kick = GT - (u.fT ?? -9) < 0.05 ? 3 : 0;
    const R = B.R.s_turret_gun;
    if (R) {
      const w = 84,
        h = (w * R.h) / R.w,
        c = Math.cos(tilt),
        s = Math.sin(tilt),
        fw = flip ? -w : w,
        px = w * 0.3 * (flip ? -1 : 1),
        py = h * 0.42; // pivot: the gun's body, 30 % in
      B.spr(
        's_turret_gun',
        [c * fw, s * fw, -s * h, c * h, x - (c * px - s * py) - Math.cos(u.aim) * kick, gy - (s * px + c * py)],
        tint ? tint[0] : 1,
        tint ? tint[1] : 1,
        tint ? tint[2] : 1,
        al,
        0,
        0.85,
      );
    } else {
      B.fx(7, x + Math.cos(u.aim) * 18, gy + Math.sin(u.aim) * 9, 22, 6, u.aim, 0.3, 0.3, 0.32, al, 3, 0, 1);
    }
    if (u.evo && u.max) {
      const k = clamp(u.hp / u.max, 0, 1);
      B.fx(7, x, y - 96 - drop, 22, 3, 0, 0.1, 0.1, 0.12, 0.8, 3, 0, 1);
      B.fx(7, x - 22 * (1 - k), y - 96 - drop, 22 * k, 2.2, 0, 1 - k, 0.4 + 0.5 * k, 0.15, 0.95, 3, 0, 1);
    }
  }
  // ---------- burst barrels: the torn shell stays where each stood, glowing hot at first; WRK: when each blew (read from its 'barrel'
  // event while the log still has it: cosmetic memory, as the litter's; one blown before this page saw it is simply cold) ----------
  const WRK = { seed: -1, gt: 0, m: new Map() };
  function wrecks(ST, LV, GT) {
    if (WRK.seed !== ST.seed || GT < WRK.gt) {
      WRK.m.clear();
      WRK.seed = ST.seed;
    }
    WRK.gt = GT;
    for (let i = ST.ev.length - 1; i >= 0; i--) {
      const e = ST.ev[i];
      if (GT - e.t > 6) break;
      if (e.k !== 'barrel' || e.t > GT) continue;
      const key = e.x + ',' + e.y;
      if (!WRK.m.has(key)) {
        const o = LV.props.find((q) => q.barrel && q.x === e.x && q.y === e.y);
        if (o) WRK.m.set(key, { t: e.t, o });
      }
    }
  }
  const wreckAge = (o, GT) => {
    const w = WRK.m.get(o.x + ',' + o.y);
    return w ? GT - w.t : 99;
  };
  function drawWreck(o, GT) {
    const a = wreckAge(o, GT);
    if (a < 0.05) return; // (the fireball's first flash hides the swap)
    const hot = 1 - SS(0.2, 3.2, a);
    sprAt('fx_bwreck', sx(o.x), sy(o.fy) + 3, o.w * 1.38, o.flip, 1, 0, 0.75, 0, 1, [
      1 + 0.55 * hot,
      1 + 0.1 * hot,
      1 - 0.25 * hot,
    ]);
  }
  // a screen point in front of a footprint (ground rect c): past either of its front faces (the faces toward the viewer)
  const inFront = (c, x, y) => SIM.toGx(x, y) >= c.x1 || SIM.toGy(x, y) >= c.y1;
  function drawArenaWall(o, GT) {
    const a = GT - o.t - 0.4 - (o.i % 11) * 0.03,
      k = SS(0, 0.35, a);
    if (k <= 0) return;
    const drop = (1 - k) * 380,
      x = sx(o.x),
      y = sy(o.y) - drop,
      flip = Math.sin(o.an) * Math.cos(o.an) < 0;
    B.fx(5, x, sy(o.y) + 4, 70 * (0.4 + 0.6 * k), 18 * (0.4 + 0.6 * k), 0, 0.03, 0, 0.06, 0.5 * k, 3, 0, 1);
    sprAt('iso_barrier', x, y, 140, flip, 1, 0, 0.75);
    if (a > 0.35 && a < 0.9) {
      const q = (a - 0.35) / 0.55;
      for (let j = 0; j < 4; j++)
        B.fx(
          1,
          x + (j - 1.5) * 34 * (1 + q),
          sy(o.y) - 10 - 20 * q,
          30 + 30 * q,
          18 + 14 * q,
          0,
          0.8,
          0.72,
          0.64,
          0.6 * (1 - q),
          1,
          o.i + j,
          1,
        );
    }
  }
  function sprAt(name, x, y, w, flip, a = 1, flash = 0, lk = 0.85, rot = 0, pivY = 1, col = null) {
    // bottom-centre anchored sprite
    const R = B.R[name];
    if (!R) return;
    const h = (w * R.h) / R.w,
      c0 = col || [1, 1, 1];
    if (rot) {
      const c = Math.cos(rot),
        s = Math.sin(rot),
        fw = flip ? -w : w;
      B.spr(
        name,
        [c * fw, s * fw, -s * h, c * h, x - ((c * fw) / 2 - s * h * pivY), y - ((s * fw) / 2 + c * h * pivY)],
        c0[0],
        c0[1],
        c0[2],
        a,
        flash,
        lk,
      );
      return h;
    }
    B.box(name, x - w / 2, y - h * pivY, w, h, flip, c0[0], c0[1], c0[2], a, flash, lk);
    return h;
  }
  const PROP_FB = {
    iso_bus: ['iso_van', 1.25],
    bld_booth: ['bld_garage', 0.7],
    iso_bench: ['iso_block', 0.75],
    iso_locker: ['iso_metalcrate', 1],
  };
  let BOOMS = [];
  const PROP_TINT = { iso_car_red: [0.8, 0.66, 0.88], iso_van: [0.86, 0.8, 0.95] };
  const CAR = /^iso_(car_|van|bus|suv)/;
  // a piece of the lab's wall (or a post): its two faces toward the viewer and its cap, the canvas-made textures laid on them
  const WALL_H = 30,
    POST_H = 38;
  function drawWall(o) {
    const c = o.col,
      h = o.post ? POST_H : WALL_H,
      Gs = SIM.G,
      P = (gx, gy) => [sx(gx - gy + Gs), sy((gx + gy) / 2)];
    const a = P(c.x0, c.y1),
      b = P(c.x1, c.y1),
      d = P(c.x1, c.y0),
      o0 = P(c.x0, c.y0),
      alongX = c.x1 - c.x0 >= c.y1 - c.y0;
    const face = o.post ? (o.door ? 'x_pd' : 'x_pf') : 'x_wf' + (o.v | 0),
      end = o.post ? face : 'x_we';
    B.spr(o.post || alongX ? face : end, [b[0] - a[0], b[1] - a[1], 0, h, a[0], a[1] - h], 0.8, 0.82, 0.86, 1, 0, 0.85); // toward the lower left: lit
    B.spr(
      o.post || !alongX ? face : end,
      [b[0] - d[0], b[1] - d[1], 0, h, d[0], d[1] - h],
      0.55,
      0.57,
      0.65,
      1,
      0,
      0.85,
    ); // toward the lower right: in shade
    const tc = o.post && o.door ? [1.1, 0.9, 0.5] : [0.9, 0.91, 0.95],
      top = o.post ? 'x_pt' : 'x_wt';
    if (alongX || o.post)
      B.spr(
        top,
        [d[0] - o0[0], d[1] - o0[1], a[0] - o0[0], a[1] - o0[1], o0[0], o0[1] - h],
        tc[0],
        tc[1],
        tc[2],
        1,
        0,
        0.85,
      );
    else
      B.spr(
        top,
        [a[0] - o0[0], a[1] - o0[1], d[0] - o0[0], d[1] - o0[1], o0[0], o0[1] - h],
        tc[0],
        tc[1],
        tc[2],
        1,
        0,
        0.85,
      );
  }
  // a roof (sim.js level: PROP roof, the office's building) fades out while this page's hero is under it and back once he
  // is out: ROOF holds each one's share shown, eased every frame
  const ROOF = {};
  function roofShare(ST, o) {
    const p = ST.p,
      gx = SIM.toGx(p.x, p.y),
      gy = SIM.toGy(p.x, p.y),
      c = o.col,
      to = gx > c.x0 && gx < c.x1 && gy > c.y0 && gy < c.y1 ? 0 : 1,
      v = ROOF[o.i] === undefined ? to : ROOF[o.i] + (to - ROOF[o.i]) * 0.12;
    ROOF[o.i] = Math.abs(v - to) < 0.01 ? to : v;
    return ROOF[o.i];
  }
  // the office's banners (sim.js PROP of_banner, of_flag): the cloth hangs from its rod T px over the floor (the rod's middle),
  // swaying, the rod held still; the flag's two poles stand under the rod's ends. ROD: the rod's ends in the picture
  // (fractions: x, y), measured on live/assets/of_banner.png
  const BANNER = { of_banner: { T: 205, poles: 0 }, of_flag: { T: 160, poles: 1 } },
    ROD = [
      [0.01, 0.04],
      [0.98, 0.18],
    ];
  function drawBanner(o, t, a) {
    const R = B.R[o.n],
      bd = BANNER[o.n];
    if (!R) return;
    const w = o.w,
      h = (w * R.h) / R.w,
      cx = sx(o.x),
      cy = sy(o.y),
      x0 = cx - w / 2,
      y0 = cy - bd.T - h * ((ROD[0][1] + ROD[1][1]) / 2),
      ph = o.i * 1.7,
      off = (f) =>
        w * f ** 1.4 * (0.045 * Math.sin(t * 1.6 + ph - f * 2.2) + 0.018 * Math.sin(t * 3.3 + ph * 1.3 - f * 4.5)),
      N = 12;
    if (bd.poles)
      for (const [fx, fy] of ROD) {
        const px = o.flip ? x0 + (1 - fx) * w : x0 + fx * w,
          top = y0 + fy * h - 9,
          foot = cy + (px - cx) * (o.flip ? -0.5 : 0.5);
        B.spr('x_px', [3.2, 0, 0, foot - top, px - 1.6, top], 0.13, 0.14, 0.16, a, 0, 0.7);
        B.spr('x_px', [1, 0, 0, foot - top, px - 1.2, top], 0.32, 0.34, 0.38, a, 0, 0.7);
        B.spr('x_px', [5, 0, 0, 7, px - 2.5, top - 6], 0.15, 0.16, 0.18, a, 0, 0.7);
        B.spr('x_px', [7, 0, 0, 5, px - 3.5, top - 5], 0.15, 0.16, 0.18, a, 0, 0.7);
        B.spr('x_px', [2, 0, 0, 2, px - 1.5, top - 5], 0.5, 0.52, 0.56, a, 0, 0.7);
      }
    for (let k = 0; k < N; k++) {
      const f0 = k / N,
        f1 = (k + 1) / N,
        o0 = off(f0),
        o1 = off(f1),
        sh = 0.96 + 0.06 * Math.sin(t * 1.6 + ph - f0 * 2.2 + 0.8),
        y = y0 + f0 * h,
        hb = (f1 - f0) * h + 0.6;
      B.band(
        o.n,
        o.flip ? [-w, 0, o1 - o0, hb, x0 + w + o0, y] : [w, 0, o1 - o0, hb, x0 + o0, y],
        f0,
        f1,
        sh,
        sh,
        sh,
        a,
        0,
        0.75,
      );
    }
  }
  function drawProp(ST, LV, o, GT, t) {
    if (NPC3D[o.n] && drawNpc(ST, LV, o, GT)) return;
    if (o.wall || o.post) {
      drawWall(o);
      return;
    }
    if (BANNER[o.n]) {
      drawBanner(o, t, 1);
      return;
    }
    const x = sx(o.x),
      y = sy(o.fy);
    let a = 1;
    // the base (hub.js, ST.base): a building not standing yet faint where it goes (fuller as it goes up: p, 0..1), a
    // heap of junk fading while it is cleared (c)
    if (o.bspot && ST.base && !ST.base.b[o.bspot]) {
      const k = (ST.base.p && ST.base.p[o.bspot]) || 0;
      a = k ? 0.35 + 0.6 * k : 0.34 + 0.1 * Math.sin(GT * 2.4);
    } else if (o.junk && ST.base && ST.base.c && ST.base.c[o.junk]) a = 1 - 0.75 * ST.base.c[o.junk];
    if (o.roof) {
      a = roofShare(ST, o);
      if (a <= 0) return;
    } else if (o.bld || o.w > 200) {
      const p = ST.p,
        R = B.R[o.n];
      const hgt = R ? (o.w * R.h) / R.w : o.w; // see-through when the hero is behind
      if (!inFront(o.col, p.x, p.y) && p.y > o.fy - hgt && Math.abs(p.x - o.x) < o.w / 2) a = Math.min(a, 0.55);
    }
    // a hit: a flash, and a jolt when it was shot (one a blast hit at that moment stands still)
    let jx = 0,
      fl = 0;
    for (let i = ST.ev.length - 1; i >= 0; i--) {
      const e = ST.ev[i];
      if (GT - e.t > 0.15) break;
      if (e.k === 'prophit' && e.i === o.i) {
        fl = 0.5;
        if (!BOOMS.some((b) => b.t === e.t)) jx = Math.sin((GT - e.t) * 90) * 3;
        break;
      }
    }
    const own = o.back && B.R[o.n + '_b'] ? o.n + '_b' : o.n; // (turned 180° or 270°: its back, where it has one)
    const fb = B.R[own] ? null : PROP_FB[o.n] || (o.lamp ? ['p_lamp', 64 / o.w] : null),
      nm = fb ? fb[0] : own,
      ww = fb ? o.w * fb[1] : o.w;
    // blast response (stateless, from the event log): the cars rock on their springs; everything else stands still
    let rot = 0;
    if (CAR.test(o.n))
      for (const b of BOOMS) {
        const dx = o.x - b.x,
          dy = (o.y - b.y) * 2,
          d = Math.hypot(dx, dy),
          R0 = b.r + 220;
        if (d > R0) continue;
        const a2 = GT - b.t;
        rot += Math.sign(dx || 1) * (1 - d / R0) * 0.035 * Math.exp(-a2 * 3) * Math.sin(a2 * 5 * TAU);
      }
    if (nm === 'iso_crate') {
      const R = B.R[nm];
      if (R) {
        const h = (ww * R.h) / R.w;
        B.box(nm, x + jx - ww / 2, y - h, ww, h, o.flip, 0.78, 0.62, 0.58, a, fl, 0.75);
      }
    } else
      sprAt(nm, x + jx + (o.lamp ? lampGeo(o).sx : 0), y, ww, o.flip, a, fl, o.bld ? 0.9 : 0.75, rot, 1, PROP_TINT[nm]);
    if (o.lamp) {
      const lg = lampGeo(o),
        fl2 = lampFlicker(o, GT, t);
      const c = Math.cos(rot),
        s = Math.sin(rot);
      B.fx(
        0,
        x + c * lg.dx + s * lg.hh,
        y + s * lg.dx - c * lg.hh,
        52,
        46,
        0,
        1,
        0.75 * fl2,
        0.4,
        0.75 * fl2,
        4.5,
        0,
        0,
      );
    } // a soft bloom (no rim at its edge)
  }
  // lamps hum; one in five is broken and stutters on its own; a blast nearby makes every lamp around blink for 2.2 s
  function lampFlicker(o, GT, t) {
    const hum = 0.93 + 0.04 * Math.sin(t * 11 + o.i) + 0.03 * Math.sin(t * 23.7 + o.i * 3);
    const near = BOOMS.some(
      (b) => GT - b.t < 2.2 && Math.abs(o.x - b.x) < b.r + 420 && Math.abs(o.y - b.y) < (b.r + 420) / 2,
    );
    if (near) return rnd(Math.floor(GT * 22), o.i) < 0.4 ? 0.15 : hum;
    if (o.i % 5 === 2) {
      const w = Math.floor(t * 9),
        burstOn = rnd(Math.floor(t / 2.7), o.i + 7) < 0.45;
      return burstOn && rnd(w, o.i) < 0.5 ? 0.12 + 0.2 * rnd(w, o.i + 1) : hum;
    }
    return hum;
  }
  function drawBush(ST, b, GT, t) {
    const p = ST.p;
    let a = 1;
    if (Math.abs(b.x - p.x) < b.w * 0.45 && p.y < b.y + 10 && p.y > b.y - b.w * 0.8) a = 0.5;
    const wd = SIM.wind(b.x, GT),
      sway = Math.sin(t * 1.3 + b.ph) * 0.03 + wd * 0.06 + Math.sin(t * 7 + b.ph) * 0.02 * wd + rustle(ST, b, GT);
    sprAt(b.n, sx(b.x), sy(b.y), b.w, b.flip, a, 0, 0.8, sway);
  }
  function rustle(ST, b, GT) {
    const p = ST.p,
      dx = b.x - p.x,
      dy = (b.y - p.y) * 2,
      d = Math.hypot(dx, dy);
    if (d > 90) return 0;
    const sp = Math.hypot(p.vx, p.vy);
    return Math.sign(dx) * (1 - d / 90) * 0.12 * Math.min(1, sp / 150) * Math.sin(GT * 18);
  }
  function drawGem(ST, g, GT) {
    const n = g.v >= 10 ? 'pk_gem_red' : g.v >= 3 ? 'pk_gem_green' : 'pk_gem_blue',
      w = g.v >= 10 ? 30 : g.v >= 3 ? 25 : 21;
    const bob = g.m ? 0 : Math.sin(GT * 3.5 + g.x) * 3;
    sprAt(n, sx(g.x), sy(g.y) - g.z - 4 - bob, w, false, 1, 0, 0.2);
  }
  function drawPickup(ST, o, GT) {
    const x = sx(o.x),
      y = sy(o.y),
      bob = o.m ? 0 : Math.sin(GT * 3 + o.x) * 4;
    if (o.k === 'coin') {
      const R = B.R.pk_coin;
      if (!R) return;
      const w = 26,
        h = (w * R.h) / R.w,
        k = Math.abs(Math.cos(GT * 4 + o.x)) * 0.8 + 0.2;
      B.box('pk_coin', x - (w * k) / 2, y - h - o.z - 6 - bob, w * k, h, false, 1, 1, 1, 1, 0, 0.2);
      return;
    }
    B.fx(
      0,
      x,
      y - 26 - bob,
      46,
      46,
      0,
      o.k === 'medkit' ? 0.3 : o.k === 'magnet' ? 0.3 : 1,
      o.k === 'medkit' ? 1 : o.k === 'magnet' ? 0.7 : 0.6,
      o.k === 'magnet' ? 1 : 0.3,
      0.4 + 0.2 * Math.sin(GT * 5),
      3,
      0,
      0,
    );
    sprAt('pk_' + o.k, x, y - o.z - 4 - bob, 42, false, 1, 0, 0.2);
  }
  // a thing for the backpack lying on the ground (S.loot, sim.js): a pool of light in its rarity's colour (economy.js:
  // common grey-blue, uncommon cyan, rare gold, a trophy red — the stash's frames), a beam standing up from it (a rare
  // one's and a trophy's taller), its picture bobbing over it; one in the hero's reach brighter (bag.js names it)
  const LOOTC = { 1: [0.62, 0.72, 0.92], 2: [0.31, 0.76, 1], 3: [1, 0.7, 0.23], 4: [1, 0.36, 0.29] };
  function lootCol(o) {
    const it = window.ECONOMY && ECONOMY.item(o.it);
    return LOOTC[it ? it.rarity : 1] || LOOTC[1];
  }
  function drawLoot(ST, o, GT) {
    const it = window.ECONOMY && ECONOMY.item(o.it),
      r = it ? it.rarity : 1,
      c = lootCol(o),
      x = sx(o.x),
      y = sy(o.y),
      near = window.BAG && BAG.near === o.id,
      pu = 0.75 + 0.25 * Math.sin(GT * 4 + o.id),
      bob = o.z || o.vz ? 0 : Math.sin(GT * 3 + o.id) * 3;
    B.fx(0, x, y - 2, 64, 30, 0, c[0], c[1], c[2], (near ? 0.75 : 0.45) * pu, 3, 0, 0);
    if (!o.z)
      B.fx(
        0,
        x,
        y - (r >= 3 ? 110 : 70),
        22,
        r >= 3 ? 220 : 140,
        0,
        c[0],
        c[1],
        c[2],
        (near ? 0.4 : 0.22) * pu,
        3,
        0,
        0,
      );
    sprAt('it_' + o.it, x, y - o.z - 8 - bob, r >= 4 ? 56 : 44, false, 1, near ? 0.12 : 0, 0.2);
  }
  function drawChest(ST, c, GT) {
    const x = sx(c.x),
      y = sy(c.y) - c.z;
    if (c.z > 0 && c.k === 'air') {
      const sw = Math.sin(GT * 2) * 0.12;
      sprAt('pk_parachute', x, y - 60, 140, false, 1, 0, 0.6, sw, 1);
    }
    const shut = !SIM.chestFor(ST, c, ST.p),
      hop = c.z === 0 && !shut ? Math.abs(Math.sin(GT * 3)) * 4 : 0; // (shut: the partner's, still its own: D.COOP.lock)
    if (c.z === 0 && shut) B.fx(0, x, y - 40, 80, 60, 0, 0.45, 0.6, 0.85, 0.22, 3, 0, 0);
    else if (c.z === 0)
      B.fx(
        0,
        x,
        y - 40,
        90,
        70,
        0,
        c.k === 'air' ? 1 : 0.8,
        c.k === 'air' ? 0.8 : 0.4,
        c.k === 'air' ? 0.3 : 1,
        0.35 + 0.15 * Math.sin(GT * 5),
        3,
        0,
        0,
      );
    sprAt('pk_chest', x, y - hop, c.k === 'air' ? 84 : 76, false, 1, 0, 0.5);
  }

  // ---------- actors ----------
  const LIFT = {
    runner: 0.05,
    walker: 0.045,
    bloater: 0.032,
    bomber: 0.032,
    pustule: 0.03,
    tank: 0.04,
    golem: 0.04,
    butcher: 0.04,
    screamer: 0.05,
  };
  const TLEAN = {
    walker: 0.4,
    runner: 0.5,
    armored: 0.16,
    spitter: 0.2,
    bloater: 0.2,
    bomber: 0.24,
    butcher: 0.12,
    pustule: 0.18,
    screamer: 0.24,
    tank: 0.12,
    golem: 0.15,
  };
  // a pose with every field drawRig reads, always in this order: the crowd's poses share one shape, so the rig code's reads of them stay
  // fast (poses built field by field took a few shapes each and slowed every read). undefined where drawRig has a default (?? / ||)
  const pose = () => ({
    ph: 0,
    amt: 0,
    dx: undefined,
    dy: undefined,
    lift: undefined,
    bobA: undefined,
    duty: undefined,
    pitch: undefined,
    drop: undefined,
    fall: 0,
    fdir: undefined,
    lean: 0,
    sq: 0,
    spin: 0,
    shade: null,
    tlean: 0,
    armL: null,
    armR: null,
    swing: 0,
    elbow: undefined,
    handL: null,
    handR: null,
    belly: 0,
    head: 0,
    headX: 0,
    headY: 0,
    mouth: 0,
    tint: null,
    flash: 0,
    alpha: undefined,
    lk: undefined,
    rim: 0,
    behind: null,
    held: null,
    heldBehind: false,
  });
  function enemyPose(e, d, GT) {
    const sp = Math.hypot(e.vx, e.vy),
      amt = clamp(sp / 40, 0, 1),
      ph = (e.dist / S.stepOf(rigOf(e.k), (d.h * e.r) / d.r)) * Math.PI;
    const P = pose();
    P.ph = ph;
    P.amt = amt;
    P.dx = sp > 1 ? e.vx / sp : 1;
    P.dy = sp > 1 ? e.vy / sp : 0;
    P.lift = LIFT[e.k] || 0.045;
    P.bobA = e.k === 'runner' ? 0.008 : 0.016;
    const sway = Math.sin(GT * 2.1 + e.ph) * 0.08;
    // zombie arms reach and claw: upper arm swings against the legs, forearm grabs on its own rhythm
    P.armL = [sway, Math.sin(GT * 3.3 + e.ph) * 0.18];
    P.armR = [-sway, Math.sin(GT * 3.1 + e.ph + 1) * 0.18];
    P.swing = (e.k === 'runner' ? 0.34 : 0.2) * amt;
    if (e.k === 'spitter' || e.k === 'butcher') P.bobA = 0.006;
    P.tlean = (TLEAN[e.k] ?? 0.1) * (0.35 + 0.65 * amt) + Math.sin(ph * 2) * 0.01 * amt;
    if (!d.boss) {
      P.armL[0] += 0.45 * amt;
      P.armR[0] += 0.6 * amt;
    }
    if (e.k === 'golem') {
      P.lean = (P.lean || 0) + 0.035 * Math.sin(ph) * amt; // a heavy lurch from foot to foot, the fists swinging low
      P.armL[0] += 0.12 * Math.sin(ph) * amt;
      P.armR[0] -= 0.12 * Math.sin(ph) * amt;
    }
    return P;
  }
  // ---------- the 3D bosses (art/bosses3d, Blender → live/charmesh.js): the model itself, animated by state ----------
  // each boss's state → [animation, its duration (s); 0: looped at its fps × the third value (1 when left out); −1: its first frame held];
  // an animation given as a list: the one the sim picked (e.scr) among those the model has. Moving otherwise: the walk, by the ground
  // distance walked (the feet stay planted); standing: idle. A short throw / summon plays over the walk when it happens (thrT, sumT).
  // The Butcher raises his cleaver over the red line's wind-up, throws it as the wind-up ends, then follows through. The Savage
  // screams and charges — far faster than his legs could carry him: his run, sped up.
  const B3D = window.BOSS3D || {};
  const CLEAVER_Z = 95; // the thrown cleaver's height over the ground (px): about the Butcher's hand
  const SPIKE_Z = 150; // a spike's height (px): the Chimera's hump
  const FLESH_ARC = 150; // how high a lump of the Devourer's flesh flies over its straight way (px; it leaves his chest)
  const B3ST = {
    butcher: { wind: ['throw', SIM.THROW.wind], rec: ['after', SIM.THROW.rec] },
    savage: { wind: ['scream', 0.8], dash: ['run', 0, 1.6] }, // (his scream, then his run sped up: the charge)
    hazmat: { spray: ['wind', SIM.SPRAY.wind], rec: ['idle', -1] },
    subject: { volley: ['volley', SIM.SPIKES.wind], rec: ['idle', -1] },
    pustule: { spit: ['spit', 0.6], swell: ['swell', 0.8] },
    screamer: { wind: ['wind', 0.8], howl: ['howl', 1.5], cast: ['cast', 1.07] },
    heart: {
      intro: ['core', 1.2],
      raise: ['raise', SIM.HEART.wave.wind],
      smash: ['smash', SIM.HEART.wave.rec],
      volley: ['core', SIM.HEART.core.rel + SIM.HEART.core.rec],
    },
    golem: {
      intro: ['cast', 1.2],
      cast: ['cast', SIM.CAST.dur],
      stompw: ['stompw', SIM.STOMP.wind],
      stomp: ['stomp', 0.3],
      slamw: ['slamw', 1.0],
      slam: ['slam', 0.7],
    },
  };
  const b3Has = (d) => !!(d.b3d && window.CHARMESH && CHARMESH.has(d.b3d));
  function b3Anim(e, d, GT, h) {
    const I = CHARMESH.info(d.b3d),
      A = I.anims,
      age = GT - e.stT,
      s0 = (B3ST[e.k] || {})[e.st];
    const has = s0 && (Array.isArray(s0[0]) ? s0[0].filter((n) => A[n]) : [s0[0]]),
      st = s0 && has.length ? [has[(e.scr || 0) % has.length], ...s0.slice(1)] : s0;
    const at = (an, k) => [an, Math.max(0, Math.min(1, k)) * (A[an].n - 1)];
    if (st && A[st[0]])
      return st[1] > 0
        ? at(st[0], age / st[1])
        : st[1] < 0
          ? [st[0], 0]
          : [st[0], Math.max(0, age) * (A[st[0]].fps || 12) * (st[2] || 1)];
    for (const [an, t0, dur] of [
      ['throw', e.thrT, 0.7],
      ['summon', e.sumT, 0.9],
    ])
      if (t0 !== undefined && GT - t0 >= 0 && GT - t0 < dur && A[an]) return at(an, (GT - t0) / dur);
    if (Math.hypot(e.vx, e.vy) > 12 && A.walk) {
      const s = h / (I.height * 0.8660254),
        stride = (I.stride || 0.5) * s;
      return ['walk', (((e.gd || 0) / stride) % 1) * A.walk.n];
    }
    return ['idle', (GT * (A.idle.fps || 12) + e.ph * 3) % A.idle.n];
  }
  // the model at the boss's feet, flushing what the band has queued so far (it is drawn in its depth order)
  function drawB3(d, an, f, x, y, h, yaw, P, sq = 1) {
    B.flush(B.S, 'spr', 'over', T.light);
    B.flush(B.F, 'fx');
    CHARMESH.draw(d.b3d, an, f, x, y + (P.drop || 0), h, yaw, {
      tint: P.tint,
      flash: P.flash || 0,
      rim: P.rim || 0,
      alpha: P.alpha ?? 1,
      sq,
      mood: 3, // (the studio light, as Nova's and Walt's: a model's own colours as Meshy's viewer shows them, no outline;
      ink: 0, //  the map's light and the fights' flashes only a little)
      light: T.light,
      lk: P.lk ?? 0.25,
    });
  }
  S.b3Anim = b3Anim;
  // ---------- Nova and Walt as 3D models (art/bosses3d/nova, walt; loaded behind the world: index.html), in place of their
  // pictures once in. One clip after another, each picked at random by its weight (never the same twice running when there are
  // others), and cross-faded into the next over NPC_FADE s, the fade begun before the one playing ends: no jump between them.
  // In mission 1 they stand; at NEAR Base (2026-11-12) both sit at their own desk, Nova's post and Walt's counter
  // (live/map_base.js: m1_in_novapost, m1_in_waltshop), sitting and now and then dozing off (sit: their clips there).
  // Standing, each faces the viewer three-quarters and turns toward the hero when he comes near; sitting, toward the
  // desk's front (the prop turned: flip, lower right; else lower left), a little toward the hero
  const NPC3D = {
    np_nova: {
      id: 'nova',
      h: 122, // (the human's, 2026-11-11: Copper beside them looked a child, not a soldier — Copper about Walt's height now,
      // Nova a little over him with her ears; they were 152 and 135, as tall as their old pictures)
      stand: [
        ['i3', 3],
        ['i4', 3],
        ['i7', 3],
        ['scratch', 1],
      ],
      sit: [
        ['sit', 3],
        ['doze', 1, 19],
      ],
    }, // (the head scratch: rarer; a sitting clip's third: how far its body leans forward of the seat, screen px, drawn
    // that much back toward the chair)
    np_walt: {
      id: 'walt',
      h: 112,
      stand: [['idle', 1]],
      sit: [
        ['sit', 3],
        ['doze', 1, 6],
      ],
    },
  };
  // NEAR Base: the cats drawn bigger than in a run (the hero, Nova, Walt; the human, 2026-11-12: at the base all three looked
  // children beside the office's furniture). Only drawn: the sim's hero (his radius, muzzles) is the same
  const BASE_K = 1.25,
    heroH = (ST) => HERO3D.H * (ST && ST.hub ? BASE_K : 1),
    npcH = (LV, N) => N.h * (LV && LV.base ? BASE_K : 1);
  const NPC_SEAT_DZ = 30, // (at the base, in their chairs, a little behind their set's middle: drawn after it, before its front layer: SPLIT_DZ 45)
    NPC_FADE = 0.7,
    NPC_NEAR = 460,
    npcSt = new WeakMap(); // (per prop: the clip playing, the one fading out, the turn)
  function npcPick(list, not) {
    const L = list.length > 1 ? list.filter((c) => c[0] !== not) : list;
    let r = Math.random() * L.reduce((a, c) => a + c[1], 0);
    for (const c of L) if ((r -= c[1]) <= 0) return c[0];
    return L[0][0];
  }
  function drawNpc(ST, LV, o, GT) {
    const N = NPC3D[o.n];
    if (!window.CHARMESH || !CHARMESH.has(N.id)) return false;
    const A = CHARMESH.info(N.id).anims,
      seat = !!(LV.base && N.sit && N.sit.every((c) => A[c[0]])),
      list = seat ? N.sit : N.stand,
      fr = (an, t0) => (A[an].loop ? ((GT - t0) * A[an].fps) % A[an].n : Math.min(A[an].n - 1, (GT - t0) * A[an].fps)),
      dur = (an) => (A[an].n - 1) / A[an].fps;
    let s = npcSt.get(o);
    if (!s || s.list !== list || GT < s.t0) {
      const an = npcPick(list);
      s = { list, an, t0: GT - Math.random() * dur(an) * 0.5, prev: null, ft: 0, yaw: null, lt: GT }; // (each starts part way in)
      npcSt.set(o, s);
    }
    if (!A[s.an].loop && GT - s.t0 > dur(s.an) - NPC_FADE) {
      s.prev = { an: s.an, t0: s.t0 };
      s.an = npcPick(list, s.an);
      s.t0 = s.ft = GT;
    }
    let mix = null;
    if (s.prev) {
      const k = clamp((GT - s.ft) / NPC_FADE, 0, 1),
        w = 1 - k * k * (3 - 2 * k); // (eased: the old clip's share, 1 → 0)
      if (w > 0) mix = { anim: s.prev.an, f: fr(s.prev.an, s.prev.t0), w };
      else s.prev = null;
    }
    // the turn: three-quarters toward the side the picture faced, toward the hero when he is near
    const p = ST.p,
      base = (o.flip ? 1 : -1) * (seat ? 1.1 : 0.45),
      dx = p ? sx(p.x) - sx(o.x) : 0,
      dy = p ? sy(p.y) - sy(o.fy) : 0,
      lim = 1.2,
      look = p && !p.dead && Math.hypot(dx, dy * 2) < NPC_NEAR ? clamp(Math.atan2(dx, dy), -lim, lim) : base,
      want = seat ? base + clamp(look - base, -0.35, 0.35) : look; // (sitting: the chair turns a little, no more)
    if (s.yaw === null) s.yaw = base;
    s.yaw += (want - s.yaw) * Math.min(1, Math.max(0, GT - s.lt) * 3);
    s.lt = GT;
    // a clip that leans the body forward off the seat (its third in N.sit) drawn back toward the chair, blended with the
    // fading clip's
    const lean = (an) => ((seat && N.sit.find((c) => c[0] === an)) || [])[2] || 0,
      back = (lean(s.an) * (mix ? 1 - mix.w : 1) + (mix ? lean(mix.anim) * mix.w : 0)) * (LV && LV.base ? BASE_K : 1),
      x = sx(o.x) - Math.sin(s.yaw) * back,
      y = sy(o.fy) - Math.cos(s.yaw) * back;
    const nh = npcH(LV, N);
    if (!seat) B.fx(5, x, y, nh * 0.34, nh * 0.13, 0, 0, 0, 0, 0.4, 3, 0, 1); // (his shadow on the floor; in a chair the chair's)
    B.flush(B.S, 'spr', 'over', T.light);
    B.flush(B.F, 'fx');
    CHARMESH.draw(N.id, s.an, fr(s.an, s.t0), x, y, nh, s.yaw, { mix, mood: 3, ink: 0, light: T.light, lk: 0.12 }); // (the studio light: their
    // own colours as Meshy's viewer shows them, no outline; the map's light only a little)
    return true;
  }
  const SKIN = {
    walker: [0.94, 1.0, 0.96],
    runner: [0.94, 1.0, 0.96],
    golem: [0.9, 1.0, 0.92],
    bomber: [1.14, 0.8, 0.72],
  };
  // a bomber's fuse: the blinks come faster and faster — blink n at fusePh = n (the beeps in audio.js fall on the same moments)
  const fusePh = (a) => 3 * a + 2.75 * a * a;
  S.fusePh = fusePh;
  // a bomber: a bloater flushed red, its pustules lit from inside. On its fuse it stops, swells up to a quarter bigger, shakes, throws
  // its arms up, reddens and blinks white faster and faster while a glow wells up in its belly, till it bursts. Returns the size ×
  function bomberPose(e, d, P, GT, x, y, h) {
    P.rim = Math.max(P.rim || 0, 0.08 + 0.05 * Math.sin(GT * 3 + e.ph));
    if (e.fuse === undefined || e.dead) return 1;
    const a = Math.max(0, GT - e.fuse),
      k = clamp(a / d.bomb.fuse, 0, 1),
      s = 1 + 0.24 * SS(0, 1, k) + Math.sin(GT * 52) * 0.012 * k;
    P.sq = (P.sq || 1) * (1 + Math.sin(GT * 38 + e.ph) * 0.03 * (0.3 + k));
    P.lean = (P.lean || 0) + Math.sin(GT * 47 + e.ph) * (0.03 + 0.07 * k);
    P.amt = 0;
    P.armL = [-1.25 - 0.3 * k, -0.5];
    P.armR = [-1.25 - 0.3 * k, -0.5];
    P.tint = [1.2 + 0.1 * k, 0.74 - 0.12 * k, 0.66 - 0.14 * k];
    P.rim = 0.12 + 0.18 * k;
    const blink = fusePh(a) % 1 < 0.22;
    if (blink) P.flash = Math.max(P.flash || 0, 0.32 + 0.12 * k);
    B.fx(
      0,
      x,
      y - h * s * 0.4,
      h * s * (0.14 + 0.12 * k),
      h * s * (0.12 + 0.1 * k),
      0,
      1,
      0.5,
      0.15,
      (blink ? 0.5 : 0.3) * (0.4 + 0.6 * k),
      2,
      0,
      0,
    );
    return s;
  }
  function drawEnemy(ST, e, GT, t) {
    const d = D.ENEMIES[e.k],
      x = sx(e.x),
      y = sy(e.y),
      k = e.r / d.r;
    let h = d.h * k;
    const P = enemyPose(e, d, GT);
    const fa = GT - e.fl,
      fl = fa < 0.07 ? (d.boss ? 0 : 0.42) * (1 - fa / 0.07) : 0;
    P.flash = fl;
    if (d.boss && fa < 0.1) P.rim = 0.28 * (1 - fa / 0.1); // bosses: a warm rim pulse, never a white-out
    if (!d.boss && fa >= 0 && fa < 0.22) {
      const r = fa < 0.05 ? fa / 0.05 : 1 - SS(0.05, 0.22, fa); // hit: squash 5 % and recoil 0.18 rad away from the shot
      P.sq = 1 - 0.05 * r;
      if (e.ha !== null && e.ha !== undefined) P.lean = Math.sign(Math.cos(e.ha) || 1) * 0.18 * r;
    }
    if (e.stunT > GT) {
      const j = Math.floor(GT * 40); // zapped: frozen mid-step, twitching, blue, sparks crawling over
      P.tint = [0.72, 0.9, 1.4];
      P.rim = 0.2;
      P.amt = 0;
      P.lean = (P.lean || 0) + (rnd(j, e.id) - 0.5) * 0.16;
      P.armL = [-0.7 + rnd(j, e.id + 1) * 0.5, -0.4];
      P.armR = [-0.8 + rnd(j, e.id + 2) * 0.5, 0.3];
      for (let k = 0; k < 2; k++) {
        const an = rnd(j, e.id + 3 + k) * TAU;
        B.fx(
          2,
          x + (rnd(j, e.id + 5 + k) - 0.5) * h * 0.5,
          y - h * (0.25 + 0.6 * rnd(j, e.id + 7 + k)),
          8,
          1.4,
          an,
          0.7,
          0.9,
          1,
          0.9,
          3,
          0,
          0,
        );
      }
    }
    const rise = clamp((GT - e.spT) / 0.35, 0, 1);
    if (rise < 1) {
      P.alpha = rise;
      P.drop = -(1 - rise) * 30;
    }
    if (!(e.stunT > GT) && !RIGSKIN[e.k]) P.tint = SKIN[e.k] || P.tint; // (the lab's own drawings: as painted)                                     // pale skins pushed back to olive under the warm pink light
    if (e.elite) {
      P.tint = [1.15, 1.05, 0.8];
      P.rim = 0.25 + 0.15 * Math.sin(GT * 6);
    }
    if (e.buffT > GT) {
      P.tint = [1.1, 0.92, 0.9];
      P.rim = Math.max(P.rim || 0, 0.35);
    }
    if (e.burnT > GT) {
      P.tint = [1.2, 0.85, 0.65];
      for (let j = 0; j < 3; j++) {
        const q = (GT * 2.2 + j * 0.33 + e.ph) % 1;
        B.fx(
          0,
          x + Math.sin(e.ph + j * 2) * 14,
          y - h * (0.35 + q * 0.6),
          14 * (1 - q),
          18 * (1 - q),
          0,
          1,
          0.55 - q * 0.3,
          0.15,
          0.9 * (1 - q),
          2.5,
          0,
          0,
        );
      }
    }
    let yy = y;
    if (d.boss) {
      bossPose(ST, e, d, P, GT);
      if (fa < 0.1) P.sq = (P.sq || 1) * (1 - 0.025 * (1 - fa / 0.1));
    }
    if (e.st === 'air' && d.boss === 'boss') {
      const a = clamp(GT - e.stT, 0, 1);
      yy -= Math.sin(Math.PI * a) * 360;
      h *= 1 + Math.sin(Math.PI * a) * 0.12;
      P.amt = 0;
      P.armL = [-0.8, -0.4];
      P.armR = [-0.8, -0.4];
    }
    if (e.elite) B.fx(0, x, y - h * 0.45, h * 0.62, h * 0.62, 0, 1, 0.8, 0.25, 0.32 + 0.12 * Math.sin(GT * 5), 2, 0, 0);
    if (d.bomb) h *= bomberPose(e, d, P, GT, x, yy, h);
    if (e.buffT > GT) {
      const q = 0.7 + 0.3 * Math.sin(GT * 9 + e.ph);
      B.fx(3, x + 14, y - h * 1.02, 9 * q, 9 * q, GT * 2, 1, 0.2, 0.12, 0.9, 3, 0, 0);
    }
    if (b3Has(d)) {
      const [an, f] = b3Anim(e, d, GT, h);
      drawB3(d, an, f, x, yy, h, e.yaw ?? 0, P, d.boss && fa >= 0 && fa < 0.1 ? 1 - 0.03 * (1 - fa / 0.1) : 1);
    } else drawRig(rigOf(e.k), x, yy, h, e.face, P, ST.__qaSubject === e.id ? 'subj' : null);
    if (e.elite && !d.boss && rise >= 1) {
      const w = 60,
        hy = yy - h * 1.02 - 10,
        q = clamp(e.hp / e.max, 0, 1); // an elite's health: a slim gold bar over the head
      B.fx(7, x, hy, w / 2 + 2.5, 7, 0, 0.04, 0.06, 0.14, 0.9, 3, 0, 1);
      B.fx(7, x, hy, w / 2, 4.5, 0, 0.26, 0.17, 0.04, 1, 3, 0, 1);
      if (q > 0) {
        B.fx(7, x - w / 2 + (w * q) / 2, hy, (w * q) / 2, 4.5, 0, 1, 0.72, 0.16, 1, 3, 0, 1);
        B.fx(7, x - w / 2 + (w * q) / 2, hy - 2, (w * q) / 2, 1.3, 0, 1, 0.92, 0.6, 0.85, 3, 0, 1);
      }
    }
    if (d.boss && e.st !== 'air' && rise >= 1) {
      const w = d.boss === 'boss' ? 132 : 104,
        hy = yy - h * (d.bar || 0.85) - 14,
        q = clamp(e.hp / e.max, 0, 1);
      B.fx(7, x, hy, w / 2 + 3, 10.5, 0, 0.04, 0.06, 0.14, 0.95, 3, 0, 1);
      B.fx(7, x, hy, w / 2, 7.5, 0, 0.28, 0.05, 0.06, 1, 3, 0, 1);
      if (q > 0) {
        B.fx(7, x - w / 2 + (w * q) / 2, hy, (w * q) / 2, 7.5, 0, 0.92, 0.14, 0.12, 1, 3, 0, 1);
        B.fx(7, x - w / 2 + (w * q) / 2, hy - 3.5, (w * q) / 2, 2.2, 0, 1, 0.48, 0.42, 0.85, 3, 0, 1);
      }
    }
  }
  function bossPose(ST, e, d, P, GT) {
    const a = GT - e.stT;
    if (e.st === 'wind') {
      P.lean = (e.k === 'butcher' ? 0.18 : 0) * (e.face > 0 ? -1 : 1) + Math.sin(GT * 40) * 0.02;
      P.armR = [-1.1, -0.6];
      P.armL = [-0.5, -0.3];
    }
    if (e.st === 'dash') {
      P.lean = -0.22 * (e.face > 0 ? -1 : 1);
      P.armR = [0.9, 0.2];
    }
    if (e.st === 'swell') {
      P.sq = 1 + Math.sin(a * 30) * 0.03 + a * 0.12;
      P.tint = [1.3, 1.1, 0.7];
    }
    if (e.st === 'spit') {
      const k = clamp(a / 0.55, 0, 1);
      P.tlean = (P.tlean || 0) - 0.25 * k;
      P.sq = 1 + 0.06 * Math.sin(k * Math.PI);
      P.tint = [1.1, 1.3, 0.8];
      P.armL = [-0.9 * k, -0.4];
      P.armR = [-0.9 * k, -0.4];
    }
    if (e.k === 'screamer' && (e.st === 'wind' || e.st === 'howl')) {
      P.armL = [-1.4, -0.4];
      P.armR = [-1.4, -0.4];
      P.sq = 1.06;
    }
    if (e.st === 'slamw') {
      const k = clamp(a / 1.0, 0, 1);
      P.armL = [-1.8 * k, -0.8 * k];
      P.armR = [-1.8 * k, -0.8 * k];
      P.drop = -4 * k;
    }
    if (e.st === 'slam') {
      const k = clamp(1 - a / 0.25, 0, 1);
      P.armL = [0.6 * k, 0.2];
      P.armR = [0.6 * k, 0.2];
      P.sq = 1 - 0.08 * k;
    }
    if (e.st === 'crouch') P.sq = 0.9;
    if (e.rage) {
      P.tint = [1.3, 0.75, 0.65];
      P.rim = 0.3 + 0.2 * Math.sin(GT * 9);
    }
    if (d.boss === 'boss' && e.phase >= 2) P.tint = P.tint || [1.08, 0.95, 0.9];
  }
  // corpses (ST.corpses, the newest 64 stay on the ground): a normal death topples in the depth band, then lies in the ground
  // pass; a body thrown by a blast flips once through the air (a silhouette against the fire), bounces and lies where it fell
  const corpsePhase = (c, a) => {
    if (c.T) return a < c.T + 0.2 ? 'air' : 'ground';
    const d = D.ENEMIES[c.ek],
      A = d && b3Has(d) && CHARMESH.info(d.b3d).anims.die;
    return a < (A ? A.n / (A.fps || 12) : 0.5) ? 'band' : 'ground';
  };
  function drawCorpse(ST, c, GT, i) {
    const d = D.ENEMIES[c.ek],
      rg = rigOf(c.ek),
      a = GT - c.t,
      h = d.h * (c.s || 1),
      R0 = RIGS[rg],
      n = ST.corpses.length;
    if (b3Has(d)) {
      const A = CHARMESH.info(d.b3d).anims.die,
        al = clamp((i + 1 - (n - 56)) / 8, 0, 1) * (1 - SS(40, 43, a));
      if (!A || al <= 0) return; // its death, then its body
      const k = 1 - SS(1, 8, a) * 0.12;
      drawB3(d, 'die', Math.min(A.n - 1, a * (A.fps || 12)), sx(c.x), sy(c.y), h, c.yaw ?? 0, {
        tint: [0.9 * k, 0.88 * k, 0.9 * k],
        alpha: al,
        lk: 0.6,
        flash: a < 0.05 ? 0.3 : 0,
      });
      return;
    }
    let x = c.x,
      y = c.y,
      z = 0,
      P;
    if (c.T && a < c.T) {
      const q = a / c.T;
      x += c.vx * a;
      y += c.vy * a;
      z = c.vz * a - (SIM.GRAV / 2) * a * a;
      const fire = BOOMS.some((b) => GT - b.t < 0.7 && Math.abs(b.x - x) < b.r * 1.6 && Math.abs(b.y - y) < b.r),
        dk = fire ? 1 - SS(0.3, 0.7, a) : 0;
      P = Object.assign(pose(), {
        fall: q,
        fdir: -1,
        amt: 0,
        spin: (c.spin > 0 ? 1 : -1) * TAU * q,
        armL: [-1.3 + 0.5 * Math.sin(a * 21), -0.6],
        armR: [-1.5 + 0.5 * Math.cos(a * 17), 0.5],
        tint: [0.85 - 0.5 * dk, 0.82 - 0.52 * dk, 0.85 - 0.5 * dk],
        lk: 0.6 - 0.35 * dk,
      });
    } else if (c.T) {
      const b = a - c.T;
      x = c.x1;
      y = c.y1;
      z = b < 0.2 ? 14 * Math.sin((Math.PI * b) / 0.2) : 0;
      P = Object.assign(pose(), {
        fall: 1,
        fdir: -1,
        amt: 0,
        armL: [-0.9, -0.5],
        armR: [-1.1, 0.4],
        tint: [0.82, 0.78, 0.82],
        lk: 0.6,
      });
    } else {
      const k = SS(0.1, 0.46, a),
        bk = SS(0, 0.12, a) * (1 - 0.5 * k);
      P = Object.assign(pose(), {
        fall: k,
        fdir: c.fd,
        amt: 0,
        drop: bk * 0.1 * (R0 ? R0.h : 300),
        armL: [0.5 * bk - 0.9 * k, -0.5 * k],
        armR: [0.6 * bk - 1.1 * k, 0.4 * k],
        flash: a < 0.05 ? 0.3 : 0,
        tint: [0.85, 0.82, 0.85],
        lk: 0.6,
      });
    }
    if (a > 1) P.tint = P.tint.map((v) => v * (1 - 0.12 * SS(1, 8, a))); // settles into the dusk
    P.alpha = clamp((i + 1 - (n - 56)) / 8, 0, 1) * (1 - SS(40, 43, a)); // the oldest fade before they go
    if (P.alpha <= 0) return;
    if (c.T ? a >= c.T + 0.2 : a >= 0.46) {
      // lying still (fallen, or landed): its pose drawn once, then only moved and tinted
      let R = CORPSE.get(c);
      if (!R || R.h !== h) {
        R = {
          h,
          n: [],
          m: [],
          c: [],
          push(nm, M, cl, al) {
            this.n.push(nm);
            this.m.push(M[0], M[1], M[2], M[3], M[4], M[5]);
            this.c.push(cl[0], cl[1], cl[2], al);
          },
        };
        RECS = R;
        try {
          drawRig(rg, 0, 0, h, c.f, Object.assign(pose(), P, { tint: WHITE, alpha: 1, flash: 0 }), null);
        } finally {
          RECS = null;
        }
        CORPSE.set(c, R);
      }
      const X = sx(x),
        Y = sy(y) - z,
        t = P.tint,
        al = P.alpha,
        lk = P.lk ?? 0.55;
      for (let i = 0, n = R.n.length; i < n; i++) {
        const o = i * 6,
          q = i * 4;
        M6[0] = R.m[o];
        M6[1] = R.m[o + 1];
        M6[2] = R.m[o + 2];
        M6[3] = R.m[o + 3];
        M6[4] = R.m[o + 4] + X;
        M6[5] = R.m[o + 5] + Y;
        B.spr(R.n[i], M6, R.c[q] * t[0], R.c[q + 1] * t[1], R.c[q + 2] * t[2], al * R.c[q + 3], 0, lk, 0);
      }
      return;
    }
    drawRig(rg, sx(x), sy(y) - z, h, c.f, P, null);
  }
  const CORPSE = new WeakMap(),
    M6 = [0, 0, 0, 0, 0, 0]; // (a still body's parts: name, matrix at the origin, colour and alpha shares)
  function corpses(ST, GT, phase) {
    for (let i = 0; i < ST.corpses.length; i++) {
      const c = ST.corpses[i],
        a = GT - c.t;
      if (a < 0 || corpsePhase(c, a) !== phase) continue;
      const fl = c.T && a < c.T,
        x = sx(fl ? c.x + c.vx * a : c.T ? c.x1 : c.x),
        y = sy(fl ? c.y + c.vy * a : c.T ? c.y1 : c.y);
      if (x < -260 || x > W / ZM + 260 || y < -200 || y > H / ZM + 300) continue;
      drawCorpse(ST, c, GT, i);
    }
  }
  // the hero: the cat (hero3d.js), the gun square in front of it in both paws: standing, or running the way it goes, its upper body
  // and the gun turned to the aim (backing away when it aims behind); dead it falls. At NEAR Base it walks with no gun (hero3d.js bare)
  // each hero's animation state (HST[its index]: playing together, the partner's too)
  const HST = [],
    stOf = (p) => HST[p.i | 0] || (HST[p.i | 0] = HERO3D.state());
  S.heroState = () => HST[0] || null; // (checks: the hero's animation state — its layers, its lean)
  // the lights around the hero as points in its own space (charmesh's point lights: model units from its feet, the camera's tip
  // undone): the nearest lamps' heads, its own muzzle flash, a blast or a flame close by — so the side toward a lamp glows warm
  const HPL = new Float32Array(16),
    HPC = new Float32Array(12);
  function heroLights(ST, GT, t, x, y, U) {
    const s = heroH(ST) / 0.8660254,
      CE = Math.cos(Math.PI / 6),
      SE = Math.sin(Math.PI / 6),
      LV = SIM.level(ST.seed),
      cand = [];
    const add = (gx, gy, hpx, r, c, k) => {
      const X = (gx - x) / s,
        Z = (gy - y) / (SE * s),
        Y = hpx / (CE * s),
        d = Math.hypot(X, Z);
      if (d < r * 1.8 && k > 0.01) cand.push({ X, Y, Z, r, c: c.map((v) => v * k), w: k / (1 + d) });
    };
    for (const i of LV.lamps) {
      const o = LV.props[i],
        lx = sx(o.x),
        ly = sy(o.y);
      if (Math.abs(lx - x) > 700 || Math.abs(ly - y) > 500) continue;
      const lg = lampGeo(o);
      add(lx + lg.dx, ly, lg.hh * 0.92, 4.5, [1.0, 0.68, 0.36], 2.2 * lampFlicker(o, GT, t));
    }
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (a < 0) continue;
      if (e.k === 'shot' && a < 0.07) add(sx(e.x), sy(e.y), 55, 1.1, [1.0, 0.75, 0.4], 2.2 * (1 - a / 0.07));
      else if (e.k === 'boom' && a < 0.7) add(sx(e.x), sy(e.y), 60, 3.5, [1.0, 0.6, 0.3], 2.5 * (1 - a / 0.7));
      else if (e.k === 'flame' && a < 0.12)
        add(sx(e.x) + Math.cos(e.a) * 90, sy(e.y) + Math.sin(e.a) * 60, 50, 1.6, [1.0, 0.55, 0.2], 1.6);
    }
    cand.sort((a, b) => b.w - a.w);
    HPL.fill(0);
    HPC.fill(0);
    cand.slice(0, 4).forEach((l, i) => {
      HPL.set([l.X, l.Y, l.Z, l.r], i * 4);
      HPC.set(l.c, i * 3);
    });
    U.pl = HPL;
    U.pc = HPC;
  }
  // the pistol's laser sight (in place of the fire cone's guide lines): a red beam from the drawn muzzle along the aim at the gun's
  // height, stopping on the first zombie in its way (a bright dot there), else fading out at the gun's reach
  function laser(ST, GT, aim, tip) {
    const c = Math.cos(aim),
      s = Math.sin(aim),
      m = SIM.muzzle(ST),
      gx = sx(m[0]),
      gy = sy(m[1]),
      md = SIM.mainStats(ST),
      reach = Math.min(560, (md.range || 400) * 0.9);
    let L = reach,
      hit = false;
    for (const e of ST.en) {
      if (e.dead) continue;
      const dx = sx(e.x) - gx,
        dy = sy(e.y) - gy,
        a = dx * c + dy * s;
      if (a < 0 || a > L) continue;
      if (Math.abs(-dx * s + dy * c) < (e.r || 16) * 1.1) {
        L = a;
        hit = true;
      }
    }
    const fl = 0.85 + 0.15 * Math.sin(GT * 37),
      cx = tip[0] + (c * L) / 2,
      cy = tip[1] + (s * L) / 2;
    B.fx(6, cx, cy, L / 2, 4.5, aim, 1, 0.08, 0.05, 0.28 * fl, 2, 0, 0, T.fxHero); // the glow round it
    B.fx(7, cx, cy, L / 2, 0.9, aim, 1, 0.25, 0.2, 0.95 * fl, 3, 0, 0, T.fxHero); // the beam
    const ex = tip[0] + c * L,
      ey = tip[1] + s * L;
    B.fx(0, ex, ey, hit ? 15 : 9, hit ? 15 : 9, 0, 1, 0.12, 0.08, (hit ? 0.9 : 0.4) * fl, 2, 0, 0, T.fxHero);
    if (hit) B.fx(0, ex, ey, 4, 4, 0, 1, 0.85, 0.8, fl, 3, 0, 0, T.fxHero);
    B.fx(0, tip[0], tip[1], 6, 6, 0, 1, 0.2, 0.15, 0.7 * fl, 2, 0, 0, T.fxHero); // the emitter's glint at the muzzle
    B.flush(T.fxHero, 'fx', 'add');
  }
  // a hero (this page's, ST.p, or a partner's: a green ring under its feet; a hero down lies there, a ring round it filling as it is got up)
  function drawHero(ST, GT, t, p = ST.p) {
    const x = sx(p.x),
      y = sy(p.y),
      aim = p.aim,
      mine = p === ST.p;
    const oa = p.out ? GT - (p.outT ?? -9) : 9,
      fresh = oa >= 0 && oa < 1.4; // (dead for good: the body fades, a wisp goes up)
    if (p.out && !fresh) return;
    if (fresh) {
      const k = oa / 1.4;
      for (let j = 0; j < 3; j++) {
        const q = clamp(k * 1.3 - j * 0.15, 0, 1);
        if (q <= 0 || q >= 1) continue;
        B.fx(
          0,
          x + Math.sin(q * 7 + j * 2) * 10,
          y - 30 - q * 150,
          26 + q * 30,
          34 + q * 40,
          0,
          0.75,
          0.85,
          1,
          0.45 * Math.sin(Math.PI * q),
          2,
          0,
          0,
        );
      }
      B.fx(4, x, y, 50 + k * 70, (50 + k * 70) / 2, 0, 1, 0.35, 0.3, 0.6 * (1 - k), 0.08, 0, 0);
    }
    const st = HERO3D.step(stOf(p), GT, {
      aim,
      vx: p.vx,
      vy: p.vy,
      x: p.x,
      y: p.y,
      dead: p.dead,
      down: p.down || fresh,
      gun: p.main.id,
      h: heroH(ST),
      kick: p.kick,
      rl: p.main.rl > 0 ? 1 - p.main.rl / (p.main.rlT || 1) : -1,
      bare: !!ST.hub, // (NEAR Base: no gun, the model's own idle and walk)
      top: p.st ? (p.st.speed * (ST.tune ? ST.tune.k : 1)) / SIM.HERO_V : 1, // (his top speed × the base: upgraded far enough, he runs)
      // how hard he is driven (the ground he covers against his top speed: a phone's stick barely pushed, he walks)
      push: p.st ? Math.hypot(p.vx, SIM.YK * p.vy) / Math.max(1, p.st.speed * (ST.tune ? ST.tune.k : 1)) : 1,
    });
    if (!mine && !p.dead) B.fx(4, x, y + 2, 34, 17, 0, 0.35, 1, 0.5, 0.75, 0.09, 0, 0);
    if (p.down) {
      const k = clamp(p.rv || 0, 0, 1),
        R = 62,
        N = 28,
        pul = 0.6 + 0.4 * Math.sin(GT * 6);
      B.fx(4, x, y, R + 8, (R + 8) / 2, 0, 1, 0.3, 0.25, 0.55 * pul, 0.06, 0, 0);
      for (let i = 0; i < N; i++) {
        const f = (i + 0.5) / N,
          an = -Math.PI / 2 + f * TAU,
          on = f <= k;
        B.fx(
          7,
          x + Math.cos(an) * R,
          y + (Math.sin(an) * R) / 2,
          ((Math.PI * R) / N) * 0.6,
          2.4,
          an + Math.PI / 2,
          on ? 0.4 : 0.5,
          on ? 1 : 0.5,
          on ? 0.5 : 0.55,
          on ? 1 : 0.5,
          3,
          0,
          1,
        );
      }
    }
    const U = {
      flash: GT - p.hurtT < 0.1 ? 0.6 * (1 - (GT - p.hurtT) / 0.1) : 0,
      alpha: fresh ? 1 - oa / 1.4 : p.ifr > 0 && GT - p.hurtT >= 0.1 ? 0.65 + 0.35 * Math.sin(GT * 50) : 1,
      light: T.light,
      lk: 0.32,
      lod: true,
      pack: mine ? undefined : 1,
    }; // (lod: ~100 px tall, the mesh's lighter copy; pack: a partner's stash isn't known here, so the simple backpack)
    heroLights(ST, GT, t, x, y, U);
    if (p.god) B.fx(0, x, y - 34, 50, 50, 0, 1, 0.8, 0.3, 0.3 + 0.1 * Math.sin(GT * 6), 2, 0, 0);
    const show = !LIB.ONLY.length || LIB.ONLY.includes('hero');
    B.flush(B.S, 'spr', 'over', T.light);
    B.flush(B.F, 'fx'); // everything in front-to-back order before the hero
    // (the laser sight: the pistol's in a run; none at the base)
    const lz = mine && p.main.id === 'pistol' && !p.dead && !ST.neutral && !ST.hub && !(p.main.rl > 0),
      away = Math.sin(aim) < -0.15; // the laser: aimed away, behind the cat (from the last frame's muzzle)
    if (lz && away && HERO3D.last) {
      const l = HERO3D.last;
      laser(ST, GT, aim, HERO3D.screen(l.muzzle, x, y, l.s));
    }
    if (show) HERO3D.draw(st, x, y, heroH(ST), p.dead ? null : p.main.id, U, { spin: p.main.spinA || 0 });
    const hl = HERO3D.last,
      tip = hl ? HERO3D.screen(hl.muzzle, x, y, hl.s) : [x, y];
    if (hl && p.main.id === 'minigun' && p.main.spin > 0.05) {
      const L2 = SIM.gunScale(aim) * 0.42 * SIM.HERO.s;
      B.fx(
        7,
        tip[0] + Math.cos(aim) * L2 * 0.5,
        tip[1] + Math.sin(aim) * L2 * 0.5,
        L2 * 0.5,
        2 + 2 * Math.sin(GT * 80),
        aim,
        1,
        1,
        1,
        0.3 * p.main.spin,
        3,
        0,
        1,
        T.fxHero,
      );
      B.flush(T.fxHero, 'fx', 'add');
    }
    if (hl && lz && !away) laser(ST, GT, aim, tip);
    if (!mine) return;
    // emitter anchor: where the sim shoots from vs where the gun's muzzle is drawn (the base: no gun, nothing emitted)
    if (!ST.hub) {
      const mz = SIM.muzzle(ST);
      L.anchor('muzzle', [sx(mz[0]), sy(mz[1])], tip, 10);
    }
    if (L.TRACE) {
      L.joint('hero', 'ground', [x, y]);
      L.joint('hero', 'tip', tip);
    }
  }

  // ---------- air FX from events (pure functions of age) ----------
  const FIRE = [
    [1, 0.97, 0.78],
    [1, 0.78, 0.3],
    [1, 0.47, 0.1],
    [0.82, 0.22, 0.07],
  ];
  function fireCol(q) {
    const i = clamp(Math.floor(q * 3.99), 0, 3);
    return FIRE[i];
  }
  const BPIECE = [
    ['fx_bshard0', 46, 1, 1],
    ['fx_bshard2', 42, 1.1, 0.9],
    ['fx_bshard3', 28, 1.2, 1],
    ['fx_bshard1', 36, 0.7, 1.6],
    ['fx_bshard0', 30, 1.15, 0.85],
    ['fx_bshard3', 22, 1.3, 1.1],
    ['fx_bshard2', 26, 1.25, 1],
  ]; // picture, width, speed ×, height ×
  function wreckSmoke(GT, add) {
    for (const { t: t0, o } of WRK.m.values()) {
      const a = GT - t0;
      if (a < 0.15 || a > 6.5) continue;
      const x = sx(o.x),
        y = sy(o.fy) - o.w * 0.55;
      if (x < -300 || x > W + 300 || y < -500 || y > H + 200) continue;
      const k = 1 - SS(2, 6.5, a),
        wd = SIM.wind(o.x, GT);
      if (!add) {
        for (let j = 0; j < 40; j++) {
          const s0 = 0.15 + j * 0.15,
            q = a - s0,
            life = 1.7 + 0.6 * rnd(t0, j);
          if (q < 0) break;
          if (q > life) continue;
          const u = q / life;
          const px = x + (rnd(t0, j + 50) - 0.5) * 10 + (18 + 40 * wd) * q * q,
            py = y - 20 - 70 * q,
            rad = (9 + 16 * u) * (0.9 + 0.3 * rnd(t0, j + 60));
          B.fx(
            9,
            px,
            py,
            rad,
            rad * 0.9,
            0,
            0.17,
            0.15,
            0.16,
            0.55 * k * SS(0, 0.15, q) * (1 - u) * (1 - SS(4.5, 6.5, s0)),
            3,
            t0 + j,
            1,
          );
        }
        continue;
      }
      // the fire licking out of the torn top, the glow of the hot metal, embers rising
      const f = 1 - SS(1.2, 4, a);
      if (f <= 0) continue;
      B.fx(0, x, y + 4, o.w * 0.95, o.w * 0.6, 0, 1, 0.45, 0.12, 0.45 * f, 2, 0, 0);
      for (let j = 0; j < 4; j++) {
        const fl = 0.7 + 0.3 * Math.sin(GT * (15 + j * 4.3) + j * 2.1),
          ox = (j - 1.5) * o.w * 0.16,
          hh = o.w * (0.3 + 0.22 * fl) * f;
        B.fx(
          10,
          x + ox + wd * 4,
          y - hh * 0.45,
          o.w * 0.13 * (0.8 + 0.4 * f),
          hh * 0.55,
          wd * 0.15,
          1,
          0.55 + 0.2 * fl,
          0.18,
          0.85 * fl * f,
          3,
          Math.floor(GT * 12) + j * 7,
          0,
        );
      }
      for (let j = 0; j < 9; j++) {
        const q = (a * (0.6 + 0.3 * rnd(t0, j + 70)) + rnd(t0, j + 71)) % 1;
        B.fx(
          0,
          x + (rnd(t0, j + 72) - 0.5) * o.w * 0.6 + Math.sin(GT * 3 + j) * 5 + wd * 30 * q,
          y - 10 - q * 130,
          2.6,
          2.6,
          0,
          1,
          0.62,
          0.22,
          (1 - q) * f,
          3,
          0,
          0,
        );
      }
    }
  }
  function airFx(ST, GT, t) {
    const F = B.F;
    wreckSmoke(GT, false);
    droppedMags(ST, GT, false);
    // the Lab Tech's gas: a toxic green cloud over the ground, drawn here, after the light map, so that it shows in the dim lab
    for (const q of ST.pud) {
      if (q.k !== 'gas') continue;
      const a = GT - q.t0,
        k = SS(0, 0.3, a) * (1 - SS(q.dur - 1, q.dur, a));
      for (let j = 0; j < 7; j++) {
        const an = (j / 7) * TAU + a * 0.4 + q.x,
          d = q.r * 0.5 * (0.6 + 0.4 * Math.sin(a * 1.3 + j)),
          rad = q.r * (0.5 + 0.08 * Math.sin(a * 2.1 + j * 2));
        B.fx(
          9,
          sx(q.x) + Math.cos(an) * d,
          sy(q.y) + Math.sin(an) * d * 0.5 - 20 - 6 * j,
          rad,
          rad * 0.6,
          0,
          0.5,
          0.85,
          0.25,
          0.35 * k,
          3,
          j + Math.floor(q.x),
          1,
        );
      }
    }
    // the Devourer's wave of biomass (here too, after the light map): a dark red ring rolling out from him
    for (const b of ST.eb) {
      if (b.k !== 'wave' || !b.bio) continue;
      const k = clamp((GT - b.t0) / b.dur, 0, 1),
        r = b.r0 + (b.r1 - b.r0) * k,
        x = sx(b.x),
        y = sy(b.y),
        al = 1 - SS(0.75, 1, k);
      B.fx(4, x, y, r, r / 2, 0, 0.75, 0.08, 0.1, 0.8 * al, 0.08, 0, 0); // (its crest; the flesh behind it: groundFx fleshFill)
    }
    // smoke & dust first (normal blend), then additive light layers
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (a < 0) continue;
      const x = sx(e.x),
        y = sy(e.y);
      if (x < -400 || x > W + 400 || y < -400 || y > H + 400) continue;
      if (e.k === 'boom' && a < 2.6) {
        const r = e.r,
          b = r / 100,
          n = cnt(Math.min(20, 8 + 7 * b) | 0, FX.boom),
          acid = e.kind === 'acid' || e.kind === 'spore', // (spore: the Mushroom Monster's clumps — the same burst, red)
          red = e.kind === 'spore',
          gr = 1 + 0.35 * (1 - FX.boom);
        // rolling smoke: dark, brownish, fuller at the rim of the fireball, rising and spreading
        for (let j = 0; j < n; j++) {
          const q = a - 0.08 - rnd(e.t, j) * 0.14;
          if (q < 0) continue;
          const life = 0.8 + rnd(e.t, j + 40) * 0.7;
          if (q > life) continue;
          const u = q / life;
          const an = rnd(e.t, j + 9) * TAU,
            sp = (30 + rnd(e.t, j + 3) * 90) * b,
            dist = r * 0.38 + (sp * (1 - Math.exp(-q * 2))) / 2;
          const px = x + Math.cos(an) * dist,
            py = y + Math.sin(an) * dist * 0.5 - 50 * q - r * 0.3,
            rad = r * (0.2 + 0.14 * rnd(e.t, j + 5)) * (1 + 0.6 * u) * gr;
          const sh = red ? [0.48, 0.2, 0.2] : acid ? [0.42, 0.48, 0.28] : [0.4, 0.25, 0.27];
          B.fx(
            9,
            px,
            py,
            rad,
            rad * 0.85,
            0,
            sh[0],
            sh[1],
            sh[2],
            (acid ? 0.6 : 0.95) * SS(0, 0.12, q) * (1 - u * u),
            3,
            e.t + j,
            1,
          );
        }
      } else if (e.k === 'balpop' && a < 0.7) {
        const col = BALC[e.c] || BALC[0]; // rubber shreds
        for (let j = 0; j < 7; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 60 + 140 * rnd(e.t, j + 1),
            z = 90 * a - 300 * a * a;
          B.fx(
            7,
            x + Math.cos(an) * sp * a,
            y + Math.sin(an) * sp * a * 0.6 - z,
            4,
            2.5,
            a * 14 * (rnd(e.t, j + 2) - 0.5),
            col[0] * 0.8,
            col[1] * 0.8,
            col[2] * 0.8,
            1 - SS(0.4, 0.7, a),
            3,
            0,
            1,
          );
        }
      } else if (e.k === 'slam' && e.bio && a < (e.dur || 0.8) + 0.7) {
        // the Devourer's wave: drops of blood and flesh thrown up off its crest as it runs, each a wet gleam, falling back on the flesh
        const R = e.r || 520,
          r0 = e.r0 || 40,
          dur = e.dur || 0.8,
          n = cnt(Math.round(R / 13), FX.k);
        for (let j = 0; j < n; j++) {
          const te = dur * rnd(e.t, j + 50), // (when the crest threw it)
            q = a - te;
          if (q < 0 || q > 0.7) continue;
          const an = rnd(e.t, j) * TAU,
            rho = r0 + (R - r0) * (te / dur) + 60 * q * rnd(e.t, j + 2),
            z = (240 + 220 * rnd(e.t, j + 3)) * q - 1100 * q * q;
          if (z < -2) continue;
          const px = x + Math.cos(an) * rho,
            py = y + Math.sin(an) * rho * 0.5 - z,
            rad = (8 + 7 * rnd(e.t, j + 4)) * (1 - 0.3 * (q / 0.7));
          B.fx(9, px, py, rad, rad * 0.85, 0, 0.6, 0.07, 0.1, 1, 3, j + e.t, 1);
          B.fx(0, px - rad * 0.3, py - rad * 0.35, rad * 0.35, rad * 0.25, 0, 1, 0.8, 0.75, 0.6, 3, 0, 1);
        }
      } else if (
        (e.k === 'step' && a < 0.45) ||
        (e.k === 'land' && a < 0.8) ||
        (e.k === 'slam' && a < 1.6) ||
        (e.k === 'rockhit' && a < 1.2) ||
        (e.k === 'dash' && a < 0.6) ||
        (e.k === 'thud' && a < 0.6)
      ) {
        const big =
            e.k === 'slam'
              ? 1
              : e.k === 'rockhit'
                ? 0.6
                : e.k === 'land'
                  ? 0.5
                  : e.k === 'dash'
                    ? 0.4
                    : e.k === 'thud'
                      ? 0.22
                      : 0.12,
          life = e.k === 'step' ? 0.45 : e.k === 'thud' ? 0.6 : 0.8 + big,
          n = e.k === 'step' ? 2 : e.k === 'thud' ? 6 : 10;
        for (let j = 0; j < n; j++) {
          const q = a / life;
          if (q > 1) continue;
          const an = (j / n) * TAU + rnd(e.t, j),
            R0 = (e.r || 40) * (0.4 + 0.9 * (1 - Math.exp(-a * 4)));
          const px = x + Math.cos(an) * R0 * (e.k === 'step' ? 0.3 : 1),
            py = y + Math.sin(an) * R0 * 0.5 - 10 * q,
            rad = (12 + 30 * big) * (0.6 + q);
          B.fx(
            1,
            px,
            py,
            rad,
            rad * 0.8,
            0,
            0.62,
            0.52,
            0.42,
            0.5 * (1 - q) * (e.k === 'step' ? 0.5 : 1),
            3,
            e.t + j,
            1,
          );
        }
      } else if (e.k === 'crate' && a < 1.6) {
        const wood = /iso_crate|stool/.test(e.n),
          card = e.n === 'iso_cardboard',
          col = card ? [0.72, 0.56, 0.38] : wood ? [0.6, 0.38, 0.2] : [0.3, 0.32, 0.34]; // splinters, cardboard scraps, metal bits
        for (let j = 0; j < 9; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 90 + 160 * rnd(e.t, j + 1),
            vz = 260 + 200 * rnd(e.t, j + 2),
            tt = Math.min(a, 0.9);
          const z = Math.max(0, vz * tt - 520 * tt * tt),
            px = x + Math.cos(an) * sp * tt,
            py = y - 20 + Math.sin(an) * sp * tt * 0.5 - z;
          B.fx(
            7,
            px,
            py,
            5 + 3 * rnd(e.t, j + 4),
            3 + 2 * rnd(e.t, j + 5),
            a * (6 + 6 * rnd(e.t, j)),
            col[0],
            col[1],
            col[2],
            1 - SS(1, 1.6, a),
            3,
            0,
            1,
          );
        }
      } else if (e.k === 'barrel' && a < 3.4) {
        for (let j = 0; j < 10; j++) {
          const an = rnd(e.t, j + 40) * TAU,
            sp = 120 + 320 * rnd(e.t, j + 41),
            tt = Math.min(a, 0.9),
            z = Math.max(0, 380 * tt - 640 * tt * tt); // black specks
          B.fx(
            0,
            x + Math.cos(an) * sp * tt,
            y - 24 + Math.sin(an) * sp * tt * 0.5 - z,
            3 + 2 * rnd(e.t, j + 42),
            3,
            0,
            0.1,
            0.06,
            0.06,
            1 - SS(0.7, 1.2, a),
            3,
            0,
            1,
          );
        }
        // the shell torn apart: pieces of its wall, a strip, a crumpled chunk and the lid (sent highest) fly out spinning, hit the
        // ground, bounce once, slide a little and lie there a moment (their shadows under them), then fade
        for (let j = 0; j < 7; j++) {
          const P = BPIECE[j],
            R = B.R[P[0]];
          if (!R) continue;
          const an = rnd(e.t, j) * TAU,
            sp = (150 + 260 * rnd(e.t, j + 1)) * P[2],
            vz = (400 + 330 * rnd(e.t, j + 2)) * P[3],
            g = 1150,
            T1 = (2 * vz) / g,
            vz2 = vz * 0.3,
            T2 = (2 * vz2) / g;
          let z, d, rot;
          const spin = (7 + 9 * rnd(e.t, j + 3)) * (j % 2 ? 1 : -1),
            r0 = rnd(e.t, j + 5) * 6;
          if (a < T1) {
            z = vz * a - (g / 2) * a * a;
            d = sp * a;
            rot = r0 + spin * a;
          } else {
            const b2 = a - T1;
            d = sp * T1;
            if (b2 < T2) {
              z = vz2 * b2 - (g / 2) * b2 * b2;
              d += sp * 0.45 * b2;
              rot = r0 + spin * (T1 + b2 * 0.5);
            } else {
              z = 0;
              const s3 = b2 - T2;
              d += sp * 0.45 * T2 + sp * 0.1 * (1 - Math.exp(-s3 * 5));
              rot = r0 + spin * (T1 + T2 * 0.5);
            }
          }
          const gx = x + Math.cos(an) * d,
            gy = y - 14 + Math.sin(an) * d * 0.5,
            w = P[1] * (0.9 + 0.2 * rnd(e.t, j + 4)),
            h = (w * R.h) / R.w,
            al = SS(0.02, 0.08, a) * (1 - SS(2.5, 3.4, a));
          B.fx(5, gx, gy + 2, w * 0.42, w * 0.16, 0, 0.03, 0, 0.05, 0.45 * al * clamp(1 - z / 320, 0.2, 1), 3, 0, 1);
          const c = Math.cos(rot),
            sn = Math.sin(rot),
            py = gy - z - h * 0.35;
          B.spr(
            P[0],
            [c * w, sn * w, -sn * h, c * h, gx - (c * w - sn * h) / 2, py - (sn * w + c * h) / 2],
            0.92,
            0.9,
            0.9,
            al,
            0,
            0.45,
          );
        }
      } else if (e.k === 'shed' && a < 2.4) {
        for (let j = 0; j < 7; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 120 + 160 * rnd(e.t, j + 1),
            vz = 300 + 200 * rnd(e.t, j + 2),
            tt = Math.min(a, 1.2);
          const z = Math.max(0, vz * tt - 500 * tt * tt),
            px = x + Math.cos(an) * sp * tt,
            py = y + 150 + Math.sin(an) * sp * tt * 0.5 - z - 150 * (1 - Math.min(1, tt / 1.2));
          if (e.ek === 'heart') {
            // the Devourer's: torn lumps of his flesh, as his core throws them (dark crimson, raw tissue, a wet gleam)
            const al = 1 - SS(1.8, 2.4, a),
              sz = 0.7 + 0.5 * rnd(e.t, j + 5);
            B.fx(9, px, py, 17 * sz, 14 * sz, 0, 0.52, 0.1, 0.11, al, 3, j + e.t, 1);
            B.fx(9, px - 5 * sz, py - 4 * sz, 8 * sz, 6 * sz, 0, 0.78, 0.4, 0.36, 0.95 * al, 3, j + 7, 1);
            B.fx(0, px - 7 * sz, py - 7 * sz, 4 * sz, 3 * sz, 0, 1, 0.88, 0.85, 0.8 * al, 3, 0, 1);
          } else if (e.ek === 'golem')
            B.fx(7, px, py, 15, 10, a * 7 * (rnd(e.t, j) - 0.5), 0.62, 0.25, 0.24, 1 - SS(1.8, 2.4, a), 3, 0, 1); // lumps of stitched flesh
          else B.fx(7, px, py, 16, 10, a * 5 * (rnd(e.t, j) - 0.5), 0.55, 0.32, 0.2, 1 - SS(1.8, 2.4, a), 3, 0, 1);
        }
      } else if (e.k === 'hit' && a < 0.5) {
        for (let j = 0; j < 4; j++) {
          const an = (e.a || 0) + (rnd(e.t * 7, j) - 0.5) * 1.8,
            sp = 60 + 150 * rnd(e.t * 7, j + 1),
            vz = 60 + 120 * rnd(e.t, j + 3),
            tt = a;
          const z = vz * tt - 500 * tt * tt;
          if (z < -10) continue;
          const px = x + Math.cos(an) * sp * tt,
            py = y + Math.sin(an) * sp * tt * 0.6 - z;
          B.fx(0, px, py, 3.2, 3.2, 0, e.b === 2 ? 0.35 : 0.55, e.b === 2 ? 0.7 : 0.03, 0.04, 1, 1.5, 0, 1);
        }
      } else if ((e.k === 'spores' && a < 1.6) || (e.k === 'rockhit' && e.shroom && a < 1.0)) {
        const big = e.k === 'spores',
          n = cnt(big ? 22 : 10, FX.k),
          life = big ? 1.6 : 1.0; // a burst of spores
        for (let j = 0; j < n; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = (big ? 220 : 110) * (0.4 + rnd(e.t, j + 1)),
            q = a / life,
            px = x + Math.cos(an) * sp * Math.sqrt(q),
            py = y + Math.sin(an) * sp * Math.sqrt(q) * 0.55 - 30 * q,
            rad = (big ? 26 : 18) * (0.5 + q);
          B.fx(1, px, py, rad, rad * 0.85, 0, 0.95, 0.72 + 0.1 * rnd(e.t, j + 2), 0.3, 0.55 * (1 - q), 1, e.t + j, 1);
        }
      } else if ((e.k === 'rockhit' && e.flesh && a < 0.9) || (e.k === 'corefire' && a < 0.9)) {
        // the Devourer's flesh bursting — a lump landing: a crown of thick drops thrown out and falling back round a splat that
        // slaps outwards; his core's shot: a spray of them out of his chest. Dark crimson, each drop with a wet gleam
        const up = e.k === 'corefire',
          q = a / 0.9,
          n = cnt(up ? 14 : 16, FX.k);
        if (!up) {
          const rr = (e.r || 70) * (0.35 + 1.15 * (1 - (1 - q) * (1 - q)));
          B.fx(4, x, y, rr, rr * 0.5, 0, 0.62, 0.04, 0.07, 0.85 * (1 - q), 0.14, 0, 1);
          B.fx(
            9,
            x,
            y - 4,
            (e.r || 70) * 0.55 * (1 - 0.5 * q),
            (e.r || 70) * 0.3 * (1 - 0.5 * q),
            0,
            0.5,
            0.05,
            0.08,
            1 - q,
            3,
            e.t,
            1,
          );
        }
        for (let j = 0; j < n; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = (up ? 170 : 200) * (0.45 + rnd(e.t, j + 1)),
            vz = (up ? 160 : 300) * (0.5 + rnd(e.t, j + 2)),
            z = vz * a - 900 * a * a,
            rad = (up ? 11 : 13) * (0.6 + rnd(e.t, j + 3)) * (1 - 0.35 * q);
          if (!up && z < -4) continue; // (back on the ground: the puddle has it)
          const px = x + Math.cos(an) * sp * a,
            py = y + Math.sin(an) * sp * a * 0.5 - z;
          B.fx(9, px, py, rad, rad * 0.85, 0, 0.68, 0.1, 0.12, 1 - q * q, 3, j + e.t, 1);
          B.fx(0, px - rad * 0.3, py - rad * 0.35, rad * 0.35, rad * 0.25, 0, 1, 0.8, 0.75, 0.6 * (1 - q), 3, 0, 1);
        }
      } else if ((e.k === 'gore' && a < 1.1) || (e.k === 'rockhit' && e.meat && a < 0.7)) {
        const n = cnt(e.k === 'gore' ? 18 : 10, FX.k),
          sp0 = e.k === 'gore' ? 140 : 90;
        for (let j = 0; j < n; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = sp0 * (0.5 + rnd(e.t, j + 1)),
            z = 300 * a - 650 * a * a,
            px = x + Math.cos(an) * sp * a,
            py = y + Math.sin(an) * sp * a * 0.5 - Math.max(e.k === 'gore' ? -150 : 0, z);
          B.fx(
            7,
            px,
            py,
            4 + 4 * rnd(e.t, j + 2),
            3 + 3 * rnd(e.t, j + 3),
            an,
            0.55,
            0.06,
            0.06,
            1 - a / (e.k === 'gore' ? 1.1 : 0.7),
            3,
            0,
            1,
          );
        }
      } else if (e.k === 'pop' && a < 1) {
        for (let j = 0; j < 14; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 100 + 220 * rnd(e.t, j + 1),
            z = 260 * a - 600 * a * a;
          const px = x + Math.cos(an) * sp * a,
            py = y + Math.sin(an) * sp * a * 0.5 - Math.max(-60, z);
          B.fx(0, px, py, 6, 6, 0, 0.8, 0.9, 0.2, 1 - a, 1.5, 0, 1);
        }
      } else if (e.k === 'splat' && e.big && a < 0.7) {
        const g = (e.r || 70) / 70;
        for (let j = 0, ns = cnt(16, FX.k); j < ns; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = (70 + 150 * rnd(e.t, j + 1)) * g,
            z = 220 * a - 500 * a * a;
          B.fx(
            0,
            x + Math.cos(an) * sp * a,
            y + Math.sin(an) * sp * a * 0.5 - Math.max(0, z),
            7,
            7,
            0,
            0.55,
            1,
            0.25,
            1 - a / 0.7,
            1.5,
            0,
            1,
          );
        }
        B.fx(4, x, y, (40 + 120 * a) * g, (20 + 60 * a) * g, 0, 0.5, 1, 0.25, 1 - a / 0.7, 0.07, 0, 0);
      } else if (e.k === 'splat' && a < 0.5) {
        for (let j = 0; j < 6; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 80 * rnd(e.t, j + 1);
          B.fx(
            0,
            x + Math.cos(an) * sp * a * 2,
            y + Math.sin(an) * sp * a - 30 * a,
            5,
            5,
            0,
            0.6,
            1,
            0.25,
            1 - a / 0.5,
            1.5,
            0,
            1,
          );
        }
      }
    }
    B.flush(F, 'fx');
    // additive: fire, flashes, sparks, tracers, muzzle flashes, rings, stars
    wreckSmoke(GT, true);
    // the office's sunlit windows: a soft warm glow over each pane (lights() warms the floor behind them)
    for (const w of sunWindows(SIM.level(ST.seed))) {
      if (!sunInView(w.o)) continue;
      for (const p of w.panes)
        B.fx(
          0,
          sx(p.g[0]),
          sy(p.g[1]) - w.sg[0],
          p.g[2] * 1.4,
          w.sg[1] * 1.5 + p.g[2] * 0.5,
          0,
          ...SUNC,
          0.34,
          1.2,
          0,
          0,
        );
    }
    // the Devourer's core: a red glow in his chest, faint at first; below half his health it pulses hard, brightest as a volley leaves
    for (const e of ST.en) {
      if (e.k !== 'heart' || e.dead) continue;
      const v = e.st === 'volley' ? clamp((GT - e.stT) / SIM.HEART.core.rel, 0, 1) : 0,
        k = (e.phase === 2 ? 0.55 + 0.25 * Math.sin(GT * 7) : 0.16 + 0.06 * Math.sin(GT * 3)) + 0.6 * v,
        x = sx(e.x),
        y = sy(e.y) - D.ENEMIES.heart.h * 0.52;
      B.fx(0, x, y, 60 + 50 * k, 52 + 40 * k, 0, 1, 0.22, 0.08, k, 2, 0, 0);
      B.fx(0, x, y, 20 + 10 * k, 18 + 10 * k, 0, 1, 0.7, 0.35, k, 3, 0, 0);
    }
    let flare = 0,
      bombF = 0; // full-screen flashes: one quad each kind, their strengths summed (the same light, one fill)
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (a < 0) continue;
      const x = sx(e.x),
        y = sy(e.y);
      if (x < -400 || x > W + 400 || y < -400 || y > H + 400) continue;
      if (e.k === 'boom' && a < 1.8) {
        const r = e.r,
          b = r / 100,
          acid = e.kind === 'acid' || e.kind === 'spore',
          red = e.kind === 'spore';
        if (a < 0.08)
          B.fx(
            0,
            x,
            y - 10,
            r * 0.9,
            r * 0.7,
            0,
            red ? 1 : acid ? 0.7 : 1,
            red ? 0.5 : acid ? 1 : 0.82,
            red ? 0.45 : 0.55,
            (1 - a / 0.08) * 0.8,
            2.4,
            0,
            0,
          );
        if (a < 0.4)
          B.fx(
            0,
            x,
            y - r * 0.2,
            r * 0.45,
            r * 0.38,
            0,
            red ? 0.95 : acid ? 0.5 : 1,
            red ? 0.22 : acid ? 0.9 : 0.6,
            red ? 0.16 : 0.2,
            (1 - a / 0.4) * 0.4,
            2.4,
            0,
            0,
          );
        const nf = cnt(Math.min(26, 14 + 7 * b) | 0, FX.boom),
          gr = 1 + 0.35 * (1 - FX.boom);
        for (let j = 0; j < nf; j++) {
          const life = 0.42 + 0.4 * rnd(e.t, j + 11);
          if (a > life) continue;
          const q = a / life,
            an = rnd(e.t, j) * TAU,
            sp = (40 + 220 * rnd(e.t, j + 1)) * b,
            dist = r * 0.1 + (sp * (1 - Math.exp(-a * 4))) / 4;
          const px = x + Math.cos(an) * dist * 0.85,
            py = y + Math.sin(an) * dist * 0.5 - 40 * a - r * 0.25,
            rad = r * (0.09 + 0.1 * rnd(e.t, j + 2)) * (1 + 0.9 * q) * gr;
          const dmax = r * 0.12 + (260 * b * (1 - Math.exp(-a * 4))) / 4,
            heat = q * 0.6 + rnd(e.t, j + 7) * 0.22 + Math.min(1, dist / (dmax + 1)) * 0.42;
          const c = red
            ? [0.8 + 0.2 * (1 - q), 0.16 + 0.12 * (1 - q), 0.12]
            : acid
              ? [0.45 + 0.3 * (1 - q), 0.85, 0.15]
              : heat < 0.22
                ? [1, 0.93, 0.62]
                : heat < 0.45
                  ? [1, 0.7, 0.2]
                  : heat < 0.7
                    ? [1, 0.42, 0.08]
                    : [0.62, 0.15, 0.04];
          B.fx(
            10,
            px,
            py,
            rad * 1.3,
            rad,
            Math.atan2(Math.sin(an) * 0.5, Math.cos(an)),
            c[0],
            c[1],
            c[2],
            Math.min(1, (1 - q) * 2.6),
            3,
            e.t * 3 + j,
            0.9,
          );
        }
        if (a < 0.3) B.fx(0, x, y - r * 0.25, r * 0.38, r * 0.32, 0, 1, 0.97, 0.85, 1 - a / 0.3, 3.2, 0, 0);
        const nk = cnt(Math.min(30, 12 + 9 * b) | 0, FX.boom);
        for (let j = 0; j < nk; j++) {
          const life = 0.2 + 0.3 * rnd(e.t, j + 21);
          if (a > life) continue;
          const an = rnd(e.t, j + 22) * TAU,
            sp = (380 + 520 * rnd(e.t, j + 23)) * Math.sqrt(b),
            d0 = (sp * (1 - Math.exp(-a * 4))) / 4;
          const px = x + Math.cos(an) * d0,
            py = y - 10 + Math.sin(an) * d0 * 0.7,
            ln = sp * 0.05 * (1 - a / life) + 4;
          B.fx(
            2,
            px - (Math.cos(an) * ln) / 2,
            py - Math.sin(an) * ln * 0.35,
            ln,
            2,
            Math.atan2(Math.sin(an) * 0.7, Math.cos(an)),
            1,
            0.8,
            0.4,
            1 - a / life,
            3,
            0,
            0,
          );
        }
        for (let j = 0, ne = cnt(8, FX.boom); j < ne; j++) {
          const life = 1.0 + 0.8 * rnd(e.t, j + 61);
          if (a > life || a < 0.15) continue;
          const q = a / life,
            an = rnd(e.t, j + 62) * TAU,
            d0 = r * (0.3 + 0.7 * rnd(e.t, j + 63));
          B.fx(
            0,
            x + Math.cos(an) * d0,
            y + Math.sin(an) * d0 * 0.5 - 90 * a - r * 0.3,
            4,
            4,
            0,
            1,
            0.6,
            0.2,
            1 - q,
            2,
            0,
            0,
          );
        }
        if (a < 0.35 && !acid) {
          const k = 1 - SS(0.09, 0.35, a);
          B.fx(0, x, y - r * 0.2, r * 0.45, r * 0.4, 0, 1, 1, 0.92, k, 1.4, 0, 0);
          B.fx(
            3,
            x,
            y - r * 0.2,
            r * 0.9 * (0.7 + 0.3 * k),
            r * 0.9 * (0.7 + 0.3 * k),
            rnd(e.t, 3),
            1,
            0.97,
            0.8,
            k,
            3,
            0,
            0,
          );
        }
        if (a < 0.07 && !acid) B.fx(0, x, y - r * 0.2, r * 1.15, r * 0.95, 0, 1, 1, 1, 1 - a / 0.07, 1.3, 0, 0); // the white blink
        if (r >= 140 && a < 0.18) flare += 0.07 * (1 - a / 0.18); // the whole screen flares (all of them at once: below)
        if (!acid)
          for (let j = 0, ns = cnt(14, FX.boom); j < ns; j++) {
            const life = 0.45 + 0.45 * rnd(e.t, j + 120);
            if (a > life) continue; // sparks on ballistic arcs
            const an = rnd(e.t, j + 121) * TAU,
              sp = (260 + 380 * rnd(e.t, j + 122)) * Math.sqrt(b),
              vx = Math.cos(an) * sp,
              vy = Math.sin(an) * sp * 0.5 - 260 * Math.sqrt(b);
            const px = x + vx * a,
              py = y - r * 0.2 + vy * a + 560 * a * a,
              ln = 6 + 10 * (1 - a / life);
            B.fx(2, px, py, ln, 1.7, Math.atan2(vy + 1120 * a, vx), 1, 0.85, 0.45, 1 - a / life, 3, 0, 0);
          }
      } else if (e.k === 'shot' && a < 0.06) {
        const c = Math.cos(e.a),
          s = Math.sin(e.a),
          big =
            (e.w === 'shotgun' || e.w === 'sniper' || e.w === 'rocket' ? 1.5 : e.w === 'drone' ? 0.6 : 1) *
            (e.w === 'drone' ? 1 : HK);
        const k = 1 - a / 0.06,
          fl2 = 0.85 + 0.3 * rnd(e.t, 5);
        B.fx(0, x + c * 14 * big, y + s * 14 * big, 44 * big * fl2, 40 * big * fl2, 0, 1, 0.92, 0.6, k, 1.6, 0, 0);
        B.fx(2, x + c * 40 * big, y + s * 40 * big, 48 * big * fl2, 13 * big, e.a, 1, 0.97, 0.82, k, 3, 0, 0);
        B.fx(3, x + c * 10, y + s * 10, 46 * big * fl2, 46 * big * fl2, e.a + rnd(e.t, 6), 1, 0.95, 0.75, k, 3, 0, 0);
        B.fx(0, x + c * 6, y + s * 6, 26 * big, 22 * big, 0, 1, 1, 1, Math.min(1, k * 1.4), 3, 0, 0);
      } else if (e.k === 'flame' && a < 0.45) {
        for (let j = 0; j < 5; j++) {
          const an = e.a + (rnd(e.t, j) - 0.5) * e.c * 1.6,
            life = 0.32 + 0.12 * rnd(e.t, j + 1);
          if (a > life) continue;
          const q = a / life,
            d0 = e.r * (0.15 + 0.95 * (1 - Math.exp(-a * 5)) * rnd(e.t, j + 2) * 0.6 + q * 0.5);
          const px = x + Math.cos(an) * d0,
            py = y + Math.sin(an) * d0 - 14 * q,
            rad = 10 + 34 * q,
            c = fireCol(q);
          B.fx(0, px, py, rad, rad, 0, c[0], c[1], c[2], 1 - q, 2, 0, 0);
        }
      } else if (e.k === 'hit' && a < 0.12) {
        for (let j = 0; j < 2; j++) {
          const an = (e.a || 0) + Math.PI + (rnd(e.t, j) - 0.5) * 1.5,
            ln = 14 * (1 - a / 0.12) + 3;
          B.fx(
            2,
            x + Math.cos(an) * (8 + 220 * a),
            y + Math.sin(an) * (8 + 220 * a),
            ln,
            1.8,
            an,
            1,
            0.9,
            0.6,
            1 - a / 0.12,
            3,
            0,
            0,
          );
        }
      } else if (e.k === 'sawhit' && a < 0.18) {
        for (let j = 0; j < 3; j++) {
          const an = (e.a || 0) + (rnd(e.t, j) - 0.5) * 0.8,
            ln = 12;
          const d0 = 30 + 300 * a;
          B.fx(
            2,
            x + Math.cos(an) * d0,
            y + Math.sin(an) * d0 * 0.6,
            ln,
            1.6,
            an,
            1,
            0.95,
            0.75,
            1 - a / 0.18,
            3,
            0,
            0,
          );
        }
      } else if (e.k === 'lvl' && a < 1.0) {
        const q = a / 1.0,
          al = q < 0.15 ? q / 0.15 : 1 - (q - 0.15) / 0.85,
          w = 46 + 30 * (1 - q);
        B.fx(6, x, y - 380, w, 400, 0, 0.45, 0.85, 1, al * 0.8, 3, 0, 0);
        B.fx(0, x, y - 20, w * 2, w, 0, 0.6, 0.95, 1, al, 2, 0, 0);
        const e2 = 1 - (1 - q) * (1 - q);
        B.fx(4, x, y, 20 + 380 * e2, (20 + 380 * e2) * 0.5, 0, 0.55, 0.9, 1, 1 - q, 0.06, 0, 0);
        for (let j = 0; j < 18; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 60 + 240 * rnd(e.t, j + 1);
          B.fx(
            3,
            x + Math.cos(an) * sp * q,
            y - 40 + Math.sin(an) * sp * q * 0.6 - 60 * q,
            9,
            9,
            an,
            0.7,
            0.95,
            1,
            1 - q,
            3,
            0,
            0,
          );
        }
      } else if (e.k === 'evo' && a < 1.6) {
        const q = a / 1.6;
        B.fx(0, x, y - 60, 300 * (1 - q) + 60, 300 * (1 - q) + 60, 0, 1, 0.85, 0.4, 1 - q, 1.4, 0, 0);
        for (let j = 0; j < 24; j++) {
          const an = (j / 24) * TAU,
            d0 = 40 + 420 * q;
          B.fx(3, x + Math.cos(an) * d0, y - 50 + Math.sin(an) * d0 * 0.55, 14, 14, an, 1, 0.9, 0.5, 1 - q, 3, 0, 0);
        }
      } else if (e.k === 'gem' && a < 0.18) B.fx(0, x, y, 30, 30, 0, 0.4, 0.85, 1, 1 - a / 0.18, 2.5, 0, 0);
      else if (e.k === 'coin' && a < 0.3) B.fx(3, x, y - 20 * a, 16, 16, a * 8, 1, 0.85, 0.3, 1 - a / 0.3, 3, 0, 0);
      else if (e.k === 'heal' && a < 0.9)
        for (let j = 0; j < 10; j++) {
          const q = a / 0.9,
            an = rnd(e.t, j) * TAU;
          B.fx(3, x + Math.cos(an) * 40, y - 30 - 90 * q * rnd(e.t, j + 1), 8, 8, 0, 0.4, 1, 0.5, 1 - q, 3, 0, 0);
        }
      else if (e.k === 'magnet' && a < 0.7) {
        const q = a / 0.7;
        B.fx(4, x, y, 30 + 900 * q, (30 + 900 * q) * 0.5, 0, 0.5, 0.8, 1, 1 - q, 0.05, 0, 0);
      } else if (e.k === 'bomb' && a < 0.5) bombF += (1 - a / 0.5) * 0.8;
      else if ((e.k === 'scream' || e.k === 'howl') && a < 0.9) {
        for (let j = 0; j < 3; j++) {
          const q = clamp(a / 0.9 - j * 0.15, 0, 1);
          if (q <= 0 || q >= 1) continue;
          const rad = 60 + e.r * q;
          B.fx(4, x, y + 140, rad, rad * 0.5, 0, 1, 0.3, 0.25, (1 - q) * 0.9, 0.05, 0, 0);
        }
      } else if (e.k === 'rockhit' && e.flesh) {
        // a lump of the Devourer's flesh landing: a red flash and a few embers of his core's glow thrown out of it
        if (a < 0.25) B.fx(0, x, y - 10, 120, 66, 0, 1, 0.22, 0.08, 1 - a / 0.25, 2, 0, 0);
        if (a < 0.6)
          for (let j = 0; j < 6; j++) {
            const an = rnd(e.t, j + 9) * TAU,
              sp = 150 + 120 * rnd(e.t, j + 10),
              z = 260 * a - 700 * a * a;
            B.fx(
              0,
              x + Math.cos(an) * sp * a,
              y + Math.sin(an) * sp * a * 0.5 - Math.max(0, z),
              6,
              6,
              0,
              1,
              0.5,
              0.15,
              1 - a / 0.6,
              2,
              0,
              0,
            );
          }
      } else if ((e.k === 'slam' || e.k === 'rockhit') && a < 0.5) {
        const q = a / 0.5,
          e2 = 1 - (1 - q) * (1 - q),
          rad = (e.r || 120) * (0.2 + 1.1 * e2);
        if (e.bio) B.fx(4, x, y, rad * 0.6, rad * 0.3, 0, 1, 0.25, 0.18, 1 - q, 0.06, 0, 0);
        // (his: a red slap, smaller — the ring's own crest runs out after it)
        else B.fx(4, x, y, rad, rad * 0.5, 0, 1, 0.85, 0.6, 1 - q, 0.06, 0, 0);
        if (a < 0.08) B.fx(0, x, y, 120, 70, 0, 1, e.bio ? 0.35 : 0.9, e.bio ? 0.3 : 0.7, 1 - a / 0.08, 2, 0, 0);
      } else if (e.k === 'open' && a < 1.0) {
        const q = a;
        for (let j = 0; j < 20; j++) {
          const an = rnd(e.t, j) * TAU,
            sp = 80 + 220 * rnd(e.t, j + 1);
          B.fx(
            3,
            x + Math.cos(an) * sp * q,
            y - 40 + Math.sin(an) * sp * q * 0.6 - 80 * q,
            12,
            12,
            an,
            1,
            0.85,
            0.4,
            1 - q,
            3,
            0,
            0,
          );
        }
        B.fx(6, x, y - 300, 50, 300, 0, 1, 0.8, 0.4, (1 - q) * 0.6, 3, 0, 0);
      }
    }
    if (flare > 0) B.fx(0, W / ZM / 2, H / ZM / 2, W / ZM, H / ZM, 0, 1, 0.9, 0.7, flare, 0.3, 0, 0);
    if (bombF > 0) B.fx(0, W / ZM / 2, H / ZM / 2, W / ZM, H / ZM, 0, 1, 0.95, 0.85, bombF, 0.5, 0, 0);
    B.flush(B.F, 'fx', 'over');
    for (const e of ST.ev) {
      if (e.k !== 'boom' || e.kind === 'acid' || e.kind === 'spore') continue;
      const a = GT - e.t;
      if (a < 0.12 || a > 1.6) continue;
      const r = e.r,
        x = sx(e.x),
        y = sy(e.y);
      if (a > 1.0) continue;
      for (let j = 0, nl = cnt(9, FX.boom); j < nl; j++) {
        const an = rnd(e.t, j + 80) * TAU,
          q = (a - 0.12) / 0.88,
          d0 = r * (0.42 + 0.3 * rnd(e.t, j + 81)) + 30 * q;
        B.fx(
          9,
          x + Math.cos(an) * d0,
          y + Math.sin(an) * d0 * 0.5 - r * 0.3 - 50 * q,
          r * (0.15 + 0.12 * q),
          r * (0.13 + 0.1 * q),
          0,
          0.34,
          0.21,
          0.23,
          0.85 * SS(0, 0.12, a - 0.12) * (1 - q),
          3,
          e.t + j * 7,
          1,
        );
      }
    }
    // shots stopped by cars and buildings (sim 'hitm'; over them, so in the air pass): off metal a white-hot flash, a glint and sparks that fly back and fall; off
    // brick a dull spark, a puff of red then grey dust drifting down and chips knocked out of the wall, falling
    for (const e of ST.ev) {
      if (e.k !== 'hitm') continue;
      const a = GT - e.t;
      if (a < 0 || a > 0.7) continue;
      const x = sx(e.x),
        y = sy(e.y),
        back = e.a + Math.PI;
      if (e.m === 'metal') {
        if (a > 0.34) continue;
        const q = a / 0.34;
        if (a < 0.07) {
          const f = 1 - a / 0.07;
          B.fx(0, x, y, 8 + 20 * f, 8 + 20 * f, 0, 1, 0.95, 0.78, f, 3, 0, 0);
          B.fx(3, x, y, 30 * f, 30 * f, e.t * 7, 1, 0.92, 0.65, f, 3, 0, 0);
        }
        for (let j = 0; j < 6; j++) {
          const an = back + (rnd(e.t, j) - 0.5) * 2.6,
            v = 240 + 340 * rnd(e.t, j + 9),
            tt = a * (0.8 + 0.4 * rnd(e.t, j + 3));
          const vx = Math.cos(an) * v,
            vy = Math.sin(an) * v + 1600 * tt;
          B.fx(
            2,
            x + Math.cos(an) * v * tt,
            y + Math.sin(an) * v * tt + 800 * tt * tt,
            5 + 6 * (1 - q),
            1.3,
            Math.atan2(vy, vx),
            1,
            0.7 + 0.25 * (1 - q),
            0.3,
            1 - q,
            3,
            0,
            0,
          );
        }
      } else if (e.m === 'brick') {
        const q = a / 0.7;
        if (a < 0.05) B.fx(0, x, y, 12, 12, 0, 1, 0.75, 0.5, 0.75 * (1 - a / 0.05), 3, 0, 0);
        for (let j = 0; j < 3; j++) {
          const r = (12 + 30 * Math.sqrt(q)) * (1 - 0.22 * j),
            dx = Math.cos(back + (j - 1) * 0.7) * (8 + 22 * Math.sqrt(q));
          B.fx(
            1,
            x + dx,
            y + 14 * q + j * 5 - 4,
            r,
            r * 0.85,
            0,
            j === 1 ? 0.74 : 0.82,
            j === 1 ? 0.68 : 0.58,
            j === 1 ? 0.64 : 0.46,
            0.8 * Math.pow(1 - q, 1.3),
            1,
            e.t * 3 + j,
            1,
          );
        }
        for (let j = 0; j < 5; j++) {
          const an = back + (rnd(e.t, j) - 0.5) * 2.0,
            v = 80 + 170 * rnd(e.t, j + 5),
            tt = Math.min(a, 0.55),
            s = 2.2 + 2.6 * rnd(e.t, j + 11);
          B.fx(
            7,
            x + Math.cos(an) * v * tt,
            y + Math.sin(an) * v * tt + 650 * tt * tt,
            s,
            s * 0.8,
            a * 12 + j,
            0.58,
            0.27,
            0.18,
            1 - SS(0.4, 0.7, a),
            3,
            0,
            1,
          );
        }
      }
    }
    // tracers & projectiles
    for (const b of ST.bul) {
      const x = sx(b.x),
        y = sy(b.y);
      if (x < -80 || x > W + 80 || y < -80 || y > H + 80) continue;
      const sp = Math.hypot(b.vx, b.vy),
        an = Math.atan2(b.vy, b.vx),
        age = GT - b.t0,
        grow = Math.min(1, age * 25);
      if (b.kind === 4) {
        B.fx(0, x, y, 30, 30, 0, 1, 0.65, 0.25, 1, 2.5, 0, 0);
        B.fx(7, x - Math.cos(an) * 6, y - Math.sin(an) * 6, 13, 4.5, an, 0.33, 0.37, 0.2, 1, 3, 0, 1);
        B.fx(7, x + Math.cos(an) * 9, y + Math.sin(an) * 9, 4, 4, an, 0.85, 0.2, 0.15, 1, 3, 0, 1);
        for (let j = 1; j < 6; j++) {
          const k = j / 6;
          B.fx(
            0,
            x - b.vx * 0.02 * j,
            y - b.vy * 0.02 * j - 6 * k,
            10 + 8 * k,
            10 + 8 * k,
            0,
            1,
            0.5 * (1 - k),
            0.15,
            (1 - k) * 0.7,
            2.5,
            0,
            0,
          );
        }
        continue;
      }
      const len = (b.kind === 2 ? 0.06 : b.kind === 1 ? 0.022 : 0.026) * sp * grow,
        wdt = b.kind === 2 ? 5 : b.kind === 1 ? 3.4 : 4.5;
      const cx = x - (Math.cos(an) * len) / 2,
        cy = y - (Math.sin(an) * len) / 2;
      const col = b.kind === 2 ? [0.5, 0.85, 1] : b.kind === 3 ? [0.35, 0.9, 1] : [1, 0.55, 0.15];
      B.fx(2, cx, cy, len / 2 + 5, wdt * 1.9, an, col[0], col[1] * 0.8, col[2] * 0.5, 0.9, 3, 0, 0.55);
      B.fx(2, cx, cy, len / 2, wdt * 0.75, an, 1, 0.88, 0.55, 1, 3, 0, 0.85);
    }
    for (const b of ST.eb) {
      if (b.k === 'acid') {
        const x = sx(b.x),
          y = sy(b.y);
        B.fx(0, x, y, 22, 22, 0, 0.5, 1, 0.2, 0.9, 2, 0, 0);
        B.fx(0, x, y, 9, 9, 0, 0.85, 1, 0.6, 1, 2, 0, 1);
      } else if (b.k === 'glob') {
        const k = clamp((GT - b.t0) / b.dur, 0, 1),
          x = sx(b.x),
          gy = sy(b.y + 150 * (1 - k)),
          y = sy(b.y) - Math.sin(Math.PI * k) * 280,
          w = Math.sin(GT * 19 + b.t0) * 0.08;
        B.fx(5, x, gy, 30 * (0.5 + 0.5 * k), 12 * (0.5 + 0.5 * k), 0, 0.02, 0.06, 0, 0.45 * k, 3, 0, 1);
        B.fx(0, x, y, 46, 46, 0, 0.45, 1, 0.15, 0.8, 2, 0, 0);
        B.fx(7, x, y, 20 * (1 + w), 20 * (1 - w), 0, 0.42, 0.8, 0.1, 1, 3, 0, 1);
        B.fx(0, x - 5, y - 6, 9, 8, 0, 0.9, 1, 0.6, 1, 2, 0, 1);
        for (let j = 1; j < 4; j++) {
          const kk = clamp(k - j * 0.035, 0, 1),
            yy = sy(b.y0 + (b.y1 - b.y0) * kk) - Math.sin(Math.PI * kk) * 280;
          B.fx(0, sx(b.x0 + (b.x1 - b.x0) * kk), yy, 14 - j * 3, 14 - j * 3, 0, 0.5, 1, 0.2, 0.5 - j * 0.12, 2, 0, 0);
        }
      } else if (b.k === 'rock' && GT < b.t0) continue;
      else if (b.k === 'rock' && b.shroom) {
        const k = (GT - b.t0) / b.dur,
          x = sx(b.x),
          y = sy(b.y) - Math.sin(Math.PI * k) * 300,
          r = k * 11; // a clump of mushrooms
        for (const [ox, oy, s] of [
          [-8, 4, 0.8],
          [7, 3, 0.7],
          [0, -4, 1],
        ]) {
          const c = Math.cos(r),
            sn = Math.sin(r),
            px = x + ox * c - oy * sn,
            py = y + ox * sn + oy * c;
          B.fx(7, px, py + 6 * s, 4 * s, 7 * s, r, 0.85, 0.78, 0.6, 1, 3, 0, 1);
          B.fx(7, px, py, 12 * s, 7 * s, r, 0.72, 0.13, 0.1, 1, 3, 0, 1); // (red caps, as on the Mushroom Monster)
          B.fx(0, px - 3 * s, py - 3 * s, 5 * s, 3 * s, 0, 1, 0.8, 0.75, 0.8, 2, 0, 1);
        }
        for (let j = 1; j < 4; j++) {
          const kk = clamp(k - j * 0.04, 0, 1);
          B.fx(
            1,
            sx(b.x0 + (b.x1 - b.x0) * kk),
            sy(b.y0 + (b.y1 - b.y0) * kk) - Math.sin(Math.PI * kk) * 300,
            7,
            7,
            0,
            0.95,
            0.75,
            0.3,
            0.45 - j * 0.1,
            1,
            j,
            1,
          );
        }
      } else if (b.k === 'rock' && b.flesh) {
        // a lump of flesh torn out of the Devourer's core: a glistening crimson mass still glowing inside, beating as it tumbles
        // through a high arc (bigger at its top, nearer the eye), a glowing streak behind it shedding drops of ichor (its shadow:
        // groundFx)
        const k = clamp((GT - b.t0) / b.dur, 0, 1),
          px = (kk) => sx(b.x0 + (b.x1 - b.x0) * kk),
          py = (kk) => sy(b.y0 + (b.y1 - b.y0) * kk) - Math.sin(Math.PI * kk) * FLESH_ARC,
          x = px(k),
          y = py(k),
          ph = GT * 17 + b.x1,
          pu = 1 + 0.13 * Math.sin(ph),
          s = 1.5 * (1 + 0.3 * Math.sin(Math.PI * k)); // (big: as large as the hero's head and more)
        for (let j = 1; j <= 7; j++) {
          const kk = k - j * 0.035,
            q = j / 7;
          if (kk <= 0) break;
          const dt = j * 0.035 * b.dur, // (how long ago that drop came off)
            w = (1 - q * 0.7) * s;
          B.fx(0, px(kk), py(kk), 17 * w, 15 * w, 0, 1, 0.24, 0.07, 0.55 * (1 - q), 2, 0, 0);
          B.fx(
            9,
            px(kk) + Math.sin(j * 7.1 + b.x1) * 7,
            py(kk) + 1000 * dt * dt,
            5 * w,
            4.5 * w,
            0,
            0.5,
            0.04,
            0.07,
            0.9 * (1 - q),
            3,
            j + b.x1,
            1,
          );
        }
        B.fx(0, x, y, 40 * s, 34 * s, 0, 0.85, 0.1, 0.04, 0.3, 1.6, 0, 0); // a faint red halo (seen in the dim lab)
        B.fx(9, x + 7 * s, y + 6 * s, 17 * s * pu, 14 * (s / pu), 0, 0.3, 0.03, 0.05, 1, 3, b.x1 + 3, 1); // a dark lobe under it
        B.fx(9, x, y, 24 * s * pu, 20 * (s / pu), 0, 0.52, 0.1, 0.11, 1, 3, b.x1, 1); // the mass, dark crimson
        B.fx(9, x - 7 * s, y - 5 * s, 12 * s, 9 * s, 0, 0.78, 0.4, 0.36, 0.95, 3, b.x1 + 7, 1); // raw pink tissue on it
        B.fx(9, x + 9 * s, y - 8 * s, 7 * s * pu, 6 * s, 0, 0.7, 0.3, 0.28, 0.9, 3, b.x1 + 11, 1); // a blister
        B.fx(0, x + 3 * s, y + 3 * s, 10 * s, 8 * s, 0, 1, 0.5, 0.15, 0.55 + 0.35 * Math.sin(ph), 2.5, 0, 0); // the core's glow seeping out
        B.fx(0, x - 10 * s, y - 9 * s, 5 * s, 3.5 * s, 0, 1, 0.88, 0.85, 0.8, 3, 0, 1); // a wet gleam
      } else if (b.k === 'rock' && b.meat) {
        const k = (GT - b.t0) / b.dur,
          x = sx(b.x),
          y = sy(b.y) - Math.sin(Math.PI * k) * 300;
        B.fx(7, x, y, 19, 15, k * 9, 0.5, 0.14, 0.13, 1, 3, 0, 1);
        B.fx(7, x - 5, y - 5, 10, 6, k * 9, 0.8, 0.45, 0.4, 1, 3, 0, 1);
        B.fx(7, x + 6, y + 3, 6, 4, k * 9, 0.75, 0.7, 0.45, 1, 3, 0, 1);
        for (let j = 1; j < 4; j++) {
          const kk = clamp(k - j * 0.04, 0, 1);
          B.fx(
            0,
            sx(b.x0 + (b.x1 - b.x0) * kk),
            sy(b.y0 + (b.y1 - b.y0) * kk) - Math.sin(Math.PI * kk) * 300,
            5,
            5,
            0,
            0.6,
            0.05,
            0.05,
            0.6 - j * 0.15,
            1.5,
            0,
            1,
          );
        }
      } else if (b.k === 'rock') {
        const k = (GT - b.t0) / b.dur,
          x = sx(b.x),
          y = sy(b.y) - Math.sin(Math.PI * k) * 300;
        B.fx(7, x, y, 16, 13, k * 8, 0.55, 0.52, 0.5, 1, 3, 0, 1);
        B.fx(7, x - 4, y - 4, 8, 6, k * 8, 0.75, 0.72, 0.7, 1, 3, 0, 1);
      } else if (b.k === 'spike') {
        // the Chimera's spike: a bone-white shaft with a dark tip, flying at his hump's height, its shadow under it
        const x = sx(b.x),
          y = sy(b.y),
          an = Math.atan2(Math.sin(b.a) * 0.5, Math.cos(b.a));
        B.fx(5, x, y, 12, 5, 0, 0.02, 0.06, 0, 0.35, 3, 0, 1);
        B.fx(7, x, y - SPIKE_Z, 22, 4, an, 0.88, 0.82, 0.68, 1, 3, 0, 1);
        B.fx(7, x + Math.cos(an) * 16, y - SPIKE_Z + Math.sin(an) * 16, 8, 3, an, 0.35, 0.3, 0.25, 1, 3, 0, 1);
      } else if (b.k === 'cleaver') {
        // the Butcher's cleaver (the trophy's own picture): spinning end over end at his hand's height, its shadow under it
        const x = sx(b.x),
          y = sy(b.y),
          dir = Math.cos(b.a) >= 0 ? 1 : -1;
        B.fx(5, x, y, 26, 9, 0, 0.02, 0.06, 0, 0.4, 3, 0, 1);
        sprAt('it_t_butcher', x, y - CLEAVER_Z, 76, dir < 0, 1, 0, 0.9, (GT - b.t0) * 20 * dir, 0.5);
      }
    }
    // the cleaver where it landed: stuck blade down in the ground (or at the foot of the wall it hit), a few sparks, gone after a while
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (e.k !== 'clank' || a < 0 || a > 1.6) continue;
      const x = sx(e.x),
        y = sy(e.y),
        dir = Math.cos(e.a) >= 0 ? 1 : -1,
        quiver = a < 0.3 ? Math.sin(a * 70) * 0.12 * (1 - a / 0.3) : 0;
      sprAt('it_t_butcher', x, y - 16, 76, dir < 0, 1 - SS(1.2, 1.6, a), 0, 0.9, (2.4 + quiver) * dir, 0.5);
      if (a < 0.25)
        for (let j = 0; j < 6; j++) {
          const an = -Math.PI * (0.15 + 0.7 * rnd(e.t, j)),
            sp = 120 + 160 * rnd(e.t, j + 7);
          B.fx(
            0,
            x + Math.cos(an) * sp * a,
            y - 10 + Math.sin(an) * sp * a,
            4,
            4,
            0,
            1,
            0.85,
            0.5,
            1 - a / 0.25,
            2,
            0,
            0,
          );
        }
    }
    // missiles: an exhaust flame and a smoke trail behind each (from its velocity on screen)
    for (const m of ST.msl || []) {
      if (GT < m.t0) continue;
      const x = sx(m.x),
        y = sy(m.y - m.z),
        vx = m.vx,
        vy = m.vy - m.vz,
        an = Math.atan2(vy, vx),
        c = Math.cos(an),
        s = Math.sin(an);
      B.fx(0, x - c * 14, y - s * 14, 16, 16, 0, 1, 0.6, 0.2, 0.95, 2.5, 0, 0);
      for (let j = 1; j < 9; j++) {
        const k = j / 9;
        B.fx(
          1,
          x - vx * 0.012 * j - c * 14,
          y - vy * 0.012 * j - s * 14 - 4 * k,
          6 + 9 * k,
          6 + 9 * k,
          0,
          0.72,
          0.7,
          0.68,
          (1 - k) * 0.55,
          1,
          m.id + j,
          1,
        );
      }
    }
    // flames over the molotov puddles (napalm's thicker): lobes rising and fading, a few embers
    for (const f of ST.fire || []) {
      const a = GT - f.t0,
        kk = SS(0, 0.15, a) * (1 - SS(f.dur - 0.6, f.dur, a)),
        x = sx(f.x),
        y = sy(f.y),
        n = cnt(f.nap ? 11 : 8, FX.fire),
        gr = 1 + 0.3 * (1 - FX.fire);
      for (let j = 0; j < n; j++) {
        const life = 0.55 + 0.3 * rnd(f.t0, j + 3),
          q = ((a + rnd(f.t0, j + 4) * life) % life) / life,
          an = rnd(f.t0 + Math.floor((a + rnd(f.t0, j + 4) * life) / life), j) * TAU,
          d = f.r * 0.7 * Math.sqrt(rnd(f.t0 + j, 7));
        const px = x + Math.cos(an) * d,
          py = y + Math.sin(an) * d * 0.5 - 10 - q * f.r * 0.7,
          rad = Math.min(26, f.r * (0.1 + 0.11 * (1 - q))) * (f.nap ? 1.15 : 1) * gr,
          c = fireCol(q);
        B.fx(
          10,
          px,
          py,
          rad * 0.75,
          rad * 1.7,
          Math.sin(GT * 6 + j) * 0.15,
          c[0],
          c[1],
          c[2],
          0.8 * kk * (1 - q * q),
          3,
          f.t0 + j,
          0.2,
        );
      }
      for (let j = 0, ne = cnt(4, FX.fire); j < ne; j++) {
        const q = (a * 0.8 + rnd(f.t0, j + 20)) % 1;
        B.fx(0, x + (rnd(f.t0, j + 21) - 0.5) * f.r, y - q * 90, 3, 3, 0, 1, 0.7, 0.3, kk * (1 - q), 2, 0, 0);
      }
    }
    // gravity wells: a violet heart that throbs, stars drawn into it
    for (const w of ST.wells || []) {
      const a = GT - w.t0,
        k = SS(0, 0.18, a) * (1 - SS(w.dur - 0.35, w.dur, a)),
        x = sx(w.x),
        y = sy(w.y) - 18,
        th = 1 + 0.15 * Math.sin(a * 14);
      B.fx(0, x, y, 40 * th * (w.evo ? 1.5 : 1), 34 * th * (w.evo ? 1.5 : 1), 0, 0.6, 0.3, 1, 0.9 * k, 2, 0, 0);
      B.fx(
        0,
        x,
        y,
        12 * th,
        12 * th,
        0,
        w.evo ? 0.1 : 0.95,
        w.evo ? 0 : 0.85,
        w.evo ? 0.15 : 1,
        k,
        2,
        0,
        w.evo ? 1 : 0,
      );
      for (let j = 0; j < 8; j++) {
        const sp = rnd(w.t0, j + 40),
          q = (a * 1.3 + sp) % 1,
          an = sp * TAU + a * 4,
          d = w.r * 0.6 * (1 - q);
        B.fx(3, x + Math.cos(an) * d, y + Math.sin(an) * d * 0.5, 7, 7, an, 0.8, 0.6, 1, k * q, 3, 0, 0);
      }
    }
    // the new weapons' moments
    for (const e of ST.ev) {
      const a = GT - e.t;
      if (a < 0 || a > 0.9) continue;
      const x = sx(e.x),
        y = sy(e.y);
      if (e.k === 'mol' && a < 0.5) {
        const q = a / 0.5; // a bottle bursts: a whoosh of fire, glass flying
        for (let j = 0; j < 7; j++) {
          const an = rnd(e.t, j) * TAU,
            d = e.r * 0.8 * q * (0.5 + 0.5 * rnd(e.t, j + 1)),
            c = fireCol(q);
          B.fx(
            10,
            x + Math.cos(an) * d,
            y + Math.sin(an) * d * 0.5 - 20 - 40 * q,
            e.r * (0.35 - 0.15 * q),
            e.r * (0.4 - 0.15 * q),
            0,
            c[0],
            c[1],
            c[2],
            1 - q,
            3,
            e.t + j,
            0.4,
          );
        }
        for (let j = 0; j < 6; j++) {
          const an = rnd(e.t, j + 9) * TAU,
            d = 20 + 160 * q;
          B.fx(
            2,
            x + Math.cos(an) * d,
            y - 10 + Math.sin(an) * d * 0.5 + 120 * q * q,
            7,
            1.6,
            an,
            0.85,
            0.95,
            1,
            1 - q,
            3,
            0,
            0,
          );
        }
      } else if (e.k === 'well' && a < 0.35) {
        const q = a / 0.35;
        B.fx(4, x, y, e.r * (1 - q) + 10, (e.r * (1 - q) + 10) / 2, 0, 0.75, 0.5, 1, 1 - q, 0.08, 0, 0);
        B.fx(0, x, y - 18, 60 * (1 - q), 50 * (1 - q), 0, 0.85, 0.7, 1, 1 - q, 2, 0, 0);
      } else if (e.k === 'shotdown' && a < 0.3) {
        const q = a / 0.3;
        B.fx(0, x, y, 30 * (1 - q) + 6, 30 * (1 - q) + 6, 0, 0.6, 0.85, 1, 1 - q, 2.4, 0, 0);
        B.fx(3, x, y, 24, 24, e.t * 5, 0.8, 0.95, 1, 1 - q, 3, 0, 0);
      } else if (e.k === 'ignite' && a < 0.3) {
        const q = a / 0.3,
          c = fireCol(q);
        B.fx(10, x, y - 40 - 30 * q, 14 * (1 - q) + 4, 18 * (1 - q) + 4, 0, c[0], c[1], c[2], 1 - q, 3, e.t, 0.4);
      } else if ((e.k === 'turret' || e.k === 'turgone') && a < 0.45) {
        const q = a / 0.45;
        B.fx(1, x, y - 6, 30 + 40 * q, 12 + 14 * q, 0, 0.7, 0.66, 0.6, 0.55 * (1 - q), 1, e.t, 1);
        if (e.k === 'turgone') B.fx(3, x, y - 40, 30 * (1 - q), 30 * (1 - q), 0, 1, 0.8, 0.5, 1 - q, 3, 0, 0);
      } else if (e.k === 'mlaunch' && a < 0.3) {
        const q = a / 0.3;
        B.fx(1, x, y + 10, 26 + 30 * q, 16 + 16 * q, 0, 0.8, 0.78, 0.74, 0.5 * (1 - q), 1, e.t, 1);
      } else if (e.k === 'block' && a < 0.35) {
        const q = a / 0.35,
          hx = x,
          hy = y - HERO3D.H * 0.8; // the helmet rang: a glint on the head, a white ring
        B.fx(3, hx, hy, 42 * (1 - q * 0.4), 42 * (1 - q * 0.4), e.t * 3, 1, 1, 0.9, 1 - q, 3, 0, 0);
        B.fx(4, hx, hy + 20, 30 + 50 * q, 18 + 25 * q, 0, 0.8, 0.95, 1, 0.8 * (1 - q), 0.1, 0, 0);
      }
    }
    // saws: blade + arc trail; drones: body + engine glow; grenades (every hero's)
    for (const p of heroesOf(ST))
      for (const it of p.dead ? [] : p.items) {
        if (it.id === 'saws') {
          const g = asHero(ST, p, () => SIM.sawGeom(ST, it));
          for (let i = 0; i < g.n; i++) {
            const a = it.ang + (i / g.n) * TAU;
            for (let k = 0; k < 6; k++) {
              const a1 = a - k * 0.13,
                px = sx(p.x + Math.cos(a1) * g.R),
                py = sy(p.y - 24 + (Math.sin(a1) * g.R) / 2),
                tg = a1 + Math.PI / 2;
              B.fx(
                2,
                px,
                py,
                12,
                3.2 * (1 - k / 7),
                Math.atan2(Math.sin(tg) * 0.5, Math.cos(tg)),
                it.evo ? 1 : 0.85,
                it.evo ? 0.8 : 0.95,
                it.evo ? 0.4 : 1,
                0.55 * (1 - k / 6),
                3,
                0,
                0,
              );
            }
          }
        }
        if (it.id === 'drone')
          for (const d of it.dr) {
            const x = sx(d.x),
              y = sy(d.y) - 74 + Math.sin(GT * 4 + d.ph) * 5;
            B.fx(0, x, y + 10, 18, 18, 0, 1, 0.6, 0.2, 0.7 + 0.3 * Math.sin(GT * 60 + d.ph), 2.5, 0, 0);
          }
      }
    B.flush(F, 'fx');
    // sprites in the air: bodies thrown by blasts (over the fire), saws, drones, grenades
    corpses(ST, GT, 'air');
    litter(ST, GT, 1);
    for (const p of heroesOf(ST))
      for (const it of p.dead ? [] : p.items) {
        if (it.id === 'saws') {
          const g = asHero(ST, p, () => SIM.sawGeom(ST, it)),
            w = it.evo ? 52 : 44;
          for (let i = 0; i < g.n; i++) {
            const a = it.ang + (i / g.n) * TAU,
              x = sx(p.x + Math.cos(a) * g.R),
              y = sy(p.y - 24 + (Math.sin(a) * g.R) / 2),
              rot = GT * 22 + i;
            if (B.R.s_saw) {
              const c = Math.cos(rot) * w,
                s = Math.sin(rot) * w;
              B.spr('s_saw', [c, s * 0.62, -s, c * 0.62, x - (c - s) / 2, y - (s + c) * 0.31], 1, 1, 1, 1, 0, 0.3);
            } else {
              B.fx(7, x, y, w / 2, w / 3.2, rot, 0.75, 0.78, 0.85, 1, 3, 0, 1);
              B.fx(7, x, y, 7, 5, rot, 0.85, 0.15, 0.15, 1, 3, 0, 1);
            }
          }
        }
        if (it.id === 'drone')
          for (const d of it.dr) {
            const x = sx(d.x),
              y = sy(d.y) - 84 + Math.sin(GT * 4 + d.ph) * 5,
              w = it.evo ? 104 : 96;
            if (B.R.s_drone)
              sprAt('s_drone', x, y + w * 0.35, w, Math.cos(d.aim) < 0, 1, 0, 0.3, Math.sin(GT * 3 + d.ph) * 0.08, 1);
            else {
              B.fx(7, x, y, 18, 8, 0, 0.9, 0.9, 0.92, 1, 3, 0, 1);
              for (const [ox, oy] of [
                [-18, -6],
                [18, -6],
                [-14, 6],
                [14, 6],
              ])
                B.fx(0, x + ox, y + oy, 9, 4, 0, 0.9, 0.9, 1, 0.5, 2, 0, 1);
            }
          }
      }
    for (const g of ST.gren) {
      const k = clamp((GT - g.t0) / g.dur, 0, 1),
        x = sx(g.x0 + (g.x1 - g.x0) * k),
        y = sy(g.y0 + (g.y1 - g.y0) * k) - Math.sin(Math.PI * k) * g.h,
        rot = g.rot + k * 12;
      if (g.mol) {
        const nm = 's_molotov',
          w = 34;
        B.fx(0, x + Math.cos(rot) * 14, y + Math.sin(rot) * 14, 12, 12, 0, 1, 0.6, 0.15, 0.9, 2.2, 0, 0); // the rag burns at its neck
        if (B.R[nm]) sprAt(nm, x, y, w, false, 1, 0, 0.4, rot, 0.5);
        else B.fx(7, x, y, 6, 12, rot, 0.75, 0.45, 0.15, 1, 3, 0, 1);
        continue;
      }
      if (g.grav) {
        B.fx(0, x, y, 22, 22, 0, 0.6, 0.3, 1, 0.9, 2.2, 0, 0);
        if (B.R.s_gravity) sprAt('s_gravity', x, y, 26, false, 1, 0, 0.4, rot, 0.5);
        else B.fx(7, x, y, 9, 9, rot, 0.25, 0.2, 0.35, 1, 3, 0, 1);
        continue;
      }
      if (B.R.s_grenade) {
        const w = g.sm ? 16 : 24,
          c = Math.cos(rot) * w,
          s = Math.sin(rot) * w;
        B.spr('s_grenade', [c, s, -s, c, x - (c - s) / 2, y - (s + c) / 2], 1, 1, 1, 1, 0, 0.4);
      } else B.fx(7, x, y, g.sm ? 6 : 9, g.sm ? 7 : 11, rot, 0.3, 0.45, 0.2, 1, 3, 0, 1);
    }
    for (const m of ST.msl || []) {
      if (GT < m.t0) continue;
      const x = sx(m.x),
        y = sy(m.y - m.z),
        an = Math.atan2(m.vy - m.vz, m.vx);
      if (B.R.s_missile) sprAt('s_missile', x, y, 40, false, 1, 0, 0.5, an, 0.5);
      else {
        B.fx(7, x, y, 13, 4, an, 0.9, 0.9, 0.85, 1, 3, 0, 1);
        B.fx(7, x + Math.cos(an) * 11, y + Math.sin(an) * 11, 4, 4, an, 0.85, 0.15, 0.1, 1, 3, 0, 1);
      }
    }
    B.flush(F, 'fx');
    B.flush(B.S, 'spr', 'over', T.light);
  }
  function canopies(ST, LV, GT, t) {
    const p = ST.p;
    for (const tr of LV.trees) {
      const x = sx(tr.x),
        y = sy(tr.y) - tr.w * 0.38;
      if (x < -tr.w || x > VW + tr.w || y < -tr.w || y > VH + tr.w) continue;
      const d = Math.hypot(tr.x - p.x, (tr.y - tr.w * 0.38 - (p.y - 50)) * 1.2),
        inA = ST.arena && Math.hypot(tr.x - ST.arena.x, (tr.y - ST.arena.y) * 2) < ST.arena.r + 120,
        a = inA ? 0.3 : d < tr.w * 0.45 ? 0.42 : 1;
      B.fx(5, x + 30, y + tr.w * 0.36, tr.w * 0.42, tr.w * 0.2, 0, 0.02, 0.05, 0.03, 0.42 * a, 3, 0, 1);
      const wd = SIM.wind(tr.x, GT),
        sway = Math.sin(t * 0.9 + tr.ph) * 0.02 + wd * 0.045 + Math.sin(t * 5.3 + tr.ph) * 0.012 * wd; // gusts bend the crowns
      const R = B.R[tr.n];
      if (!R) continue;
      const h = (tr.w * R.h) / R.w,
        c = Math.cos(tr.rot + sway),
        s = Math.sin(tr.rot + sway),
        fw = tr.flip ? -tr.w : tr.w;
      B.spr(
        tr.n,
        [c * fw, s * fw, -s * h, c * h, x - (c * fw - s * h) / 2, y - (s * fw + c * h) / 2],
        1,
        1,
        1,
        a,
        0,
        0.7,
      );
    }
    B.flush(B.F, 'fx');
  }
  // ---------- litter: ~640 scraps of paper, newspaper and leaves around the view. The wind field (SIM.wind: a breeze and gust
  // fronts sweeping left to right) lifts and carries them, the hero kicks them up, blasts throw them. Cosmetic state of its
  // own (reset when the run or the time jumps); scraps that leave the view come back on the far side ----------
  const LIT = { gt: -1, seed: -1, boomT: -9, p: [], n: 0 },
    NLIT = 300;
  const lr = () => L.rnd(++LIT.n, 7.31); // its own random numbers, counted from each reset: a frame of a given time is the same every render
  const LITK = [
    ['x_leaf', 11, 1.25, [0.8, 0.46, 0.2]],
    ['x_leaf', 10, 1.25, [0.66, 0.56, 0.22]],
    ['x_leaf', 9, 1.25, [0.6, 0.3, 0.16]],
    ['x_paper', 12, 1, [0.8, 0.76, 0.74]],
    ['x_news', 17, 0.65, [0.74, 0.72, 0.7]],
  ];
  function litSpawn(q, x0, x1, y0, y1) {
    const r = lr;
    Object.assign(q, {
      x: x0 + r() * (x1 - x0),
      y: y0 + r() * (y1 - y0),
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rot: r() * TAU,
      vr: 0,
      fl: r() * TAU,
      k: Math.floor(r() * r() * 5),
      s: 0.7 + 0.5 * r(),
    });
    return q;
  }
  function stepWorld(ST, LV, GT) {
    const W0 = W / ZM,
      H0 = H / ZM,
      cx = ST.cam[0] + W0 / 2,
      cy = ST.cam[1] + H0 / 2,
      mx = W0 * 0.72,
      my = H0 * 0.75;
    LIT.lab = LV.map === 'lab'; // (indoors: paper only, a few)
    if (LIT.seed !== ST.seed || GT < LIT.gt || GT - LIT.gt > 1.5 || !LIT.p.length) {
      LIT.p = [];
      LIT.n = 0;
      for (let i = 0; i < NLIT; i++) LIT.p.push(litSpawn({}, cx - mx, cx + mx, cy - my, cy + my));
      LIT.boomT = GT;
    }
    const dt = clamp(GT - LIT.gt, 0, 0.05);
    LIT.gt = GT;
    LIT.seed = ST.seed;
    if (!dt) return;
    const p = ST.p,
      hs = Math.hypot(p.vx, p.vy),
      booms = [];
    for (const e of ST.ev) if (e.k === 'boom' && e.t > LIT.boomT && e.t <= GT) booms.push(e);
    if (booms.length) LIT.boomT = booms[booms.length - 1].t;
    for (const q of LIT.p) {
      const mob = LITK[q.k][2],
        w = SIM.wind(q.x, GT) * mob,
        air = q.z > 0.5;
      if (!air && w > 0.95) q.vz += (w - 0.95) * 600 * dt; // a strong gust lifts it
      const tv = w * 150,
        kk = air ? 2.2 : w > 0.5 ? 2.5 : 0;
      q.vx += (tv - q.vx) * Math.min(1, kk * dt);
      if (!air && w <= 0.5) {
        const f = Math.exp(-dt * 7);
        q.vx *= f;
        q.vy *= f;
      }
      if (air) {
        q.vz -= 260 * dt;
        q.vy += Math.sin(GT * 3 + q.fl) * 40 * dt;
        q.vr += (Math.sin(GT * 2 + q.fl) * 9 - q.vr) * dt * 2;
      }
      const dx = q.x - p.x,
        dy = (q.y - p.y) * 2,
        d = Math.hypot(dx, dy); // the hero runs through it
      if (hs > 90 && d < 48 && d > 0.1) {
        q.vx += (dx / d) * hs * 0.9 * dt * 12;
        q.vy += (dy / d) * hs * 0.45 * dt * 12;
        q.vz = Math.max(q.vz, 70 + 60 * lr());
        q.vr = (lr() - 0.5) * 18;
      }
      for (const b of booms) {
        const bx = q.x - b.x,
          by = (q.y - b.y) * 2,
          bd = Math.hypot(bx, by),
          R = b.r * 2.4;
        if (bd > R || bd < 0.1) continue;
        const k = 1 - bd / R;
        q.vx += (bx / bd) * 700 * k;
        q.vy += (by / bd) * 350 * k;
        q.vz += 380 * k;
        q.vr = (lr() - 0.5) * 30;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.rot += q.vr * dt;
      q.fl += (air ? 9 : 0) * dt;
      if (q.z <= 0) {
        q.z = 0;
        if (q.vz < 0) {
          q.vz = 0;
          q.vr *= 0.3;
          q.vx *= 0.6;
          q.vy *= 0.6;
        }
      }
      const ox = q.x - cx,
        oy = q.y - cy;
      if (Math.abs(ox) > mx || Math.abs(oy) > my) {
        if (Math.abs(ox) > mx) litSpawn(q, cx - Math.sign(ox) * mx, cx - Math.sign(ox) * mx * 0.85, cy - my, cy + my);
        else litSpawn(q, cx - mx, cx + mx, cy - Math.sign(oy) * my, cy - Math.sign(oy) * my * 0.85);
      }
    }
  }
  function litter(ST, GT, air) {
    for (const q of LIT.p) {
      if (q.z > 14 !== !!air) continue;
      const x = sx(q.x),
        y = sy(q.y);
      if (x < -30 || x > W / ZM + 30 || y < -30 || y > H / ZM + 30) continue;
      if (LIT.lab && q.s > 0.88) continue; // (the lab: two scraps in three left out)
      const [nm, w0, , col] = LITK[LIT.lab && q.k < 3 ? 3 + (q.k & 1) : q.k],
        w = w0 * q.s,
        R = B.R[nm];
      if (!R) continue;
      const h = (w * R.h) / R.w,
        fy = q.z > 0.5 ? Math.cos(q.fl) : 0.55; // flutter: the sheet turns edge-on
      if (q.z > 2) B.fx(5, x, y + 1, w * 0.5, w * 0.16, 0, 0.03, 0, 0.06, 0.35 / (1 + q.z / 40), 3, 0, 1);
      const c = Math.cos(q.rot),
        s = Math.sin(q.rot),
        hy = h * fy;
      B.spr(
        nm,
        [c * w, s * w, -s * hy, c * hy, x - (c * w - s * hy) / 2, y - q.z - (s * w + c * hy) / 2],
        col[0],
        col[1],
        col[2],
        1,
        0,
        0.85,
      );
    }
  }
  // ---------- balloons (level data, popped state in the sim): a string from the knot to the anchor, sways with the wind ----------
  function drawBalloon(ST, b, GT) {
    const until = ST.bp[b.id] || 0;
    if (until > GT) return;
    const al = until ? SS(until, until + 1, GT) : 1;
    const R = B.R.x_balloon;
    if (!R) return;
    const [bx, by, an] = SIM.balloonPos(b, GT),
      w = 34,
      h = (w * R.h) / R.w,
      c = Math.cos(an),
      s = Math.sin(an),
      cx = sx(bx),
      cy = sy(by);
    const x0 = sx(b.x),
      y0 = sy(b.y) - 2,
      x1 = cx - s * h * 0.48,
      y1 = cy + c * h * 0.48,
      sag = Math.sin(an) * 14; // anchor → knot
    let px = x0,
      py = y0;
    for (let i = 1; i <= 6; i++) {
      const q = i / 6,
        qx = x0 + (x1 - x0) * q + sag * Math.sin(Math.PI * q),
        qy = y0 + (y1 - y0) * q,
        ln = Math.hypot(qx - px, qy - py) || 1,
        lc = (qx - px) / ln,
        ls = (qy - py) / ln;
      B.spr(
        'x_px',
        [lc * ln, ls * ln, -ls * 1.3, lc * 1.3, px + ls * 0.65, py - lc * 0.65],
        0.22,
        0.2,
        0.24,
        al,
        0,
        0.5,
      );
      px = qx;
      py = qy;
    }
    const col = BALC[b.c];
    B.spr(
      'x_balloon',
      [c * w, s * w, -s * h, c * h, cx - (c * w * 0.5 - s * h * 0.4), cy - (s * w * 0.5 + c * h * 0.4)],
      col[0],
      col[1],
      col[2],
      al,
      0,
      0.45,
    );
  }
  // ---------- comic sound words: one per series (blasts, slams, big zaps within 0.35 s count as one), popping in with overshoot ----------
  function wordFor(e) {
    if (e.k === 'boom')
      return {
        i:
          e.kind === 'acid' || e.kind === 'spore'
            ? 6
            : e.r >= 140
              ? rnd(e.t, 77) < 0.5
                ? 1
                : 2
              : rnd(e.t, 77) < 0.5
                ? 0
                : 3,
        s: 0.6 + 0.35 * Math.min(1, e.r / 200),
        dy: e.r * 0.65 + 40,
      };
    if (e.k === 'rockhit' && e.flesh) return null; // (a lump of the Devourer's flesh: its splash says it)
    if (e.k === 'slam' || e.k === 'rockhit') return { i: 4, s: 0.8, dy: 120 };
    if (e.k === 'zap' && e.pts.length >= 4) {
      const pt = e.pts[Math.min(e.pts.length - 1, 2)];
      return { i: 5, s: 0.5, dy: 60, x: pt[0], y: pt[1] };
    }
    return null;
  }
  function words(ST, GT) {
    let lastT = -9;
    const show = [];
    for (const e of ST.ev) {
      if (e.k !== 'boom' && e.k !== 'slam' && e.k !== 'rockhit' && e.k !== 'zap') continue;
      const w = wordFor(e);
      if (!w) continue;
      if (e.t - lastT > 0.35) show.push([e, w]);
      lastT = e.t;
    }
    for (const [e, w] of show) {
      const a = GT - e.t;
      if (a < 0 || a > 0.95) continue;
      const R = B.R['x_word' + w.i];
      if (!R) continue;
      const sc =
          (a < 0.07
            ? 0.4 + (0.9 * a) / 0.07
            : a < 0.16
              ? 1.3 - 0.3 * SS(0.07, 0.16, a)
              : 1 - 0.08 * SS(0.16, 0.95, a)) *
          w.s *
          ZM,
        al = 1 - SS(0.62, 0.95, a);
      const rot = (rnd(e.t, 78) - 0.5) * 0.3 + 0.1 * Math.sin(a * 22) * Math.exp(-a * 5),
        ww = R.w * sc * 0.62,
        hh = R.h * sc * 0.62;
      const x = sx((w.x ?? e.x) + (rnd(e.t, 79) - 0.5) * 80) * ZM,
        y = (sy(w.y ?? e.y) - w.dy - 30 * a) * ZM,
        c = Math.cos(rot),
        s = Math.sin(rot);
      B.spr(
        'x_word' + w.i,
        [c * ww, s * ww, -s * hh, c * hh, x - (c * ww - s * hh) / 2, y - (s * ww + c * hh) / 2],
        1,
        1,
        1,
        al,
        0,
        0,
      );
    }
  }
  // ---------- the lab's gas (SIM.gasZone): PUBG's shrinking zone, only gas — a safe circle round the hall (on screen an ellipse
  // twice as wide as tall), the gas everything outside it. On the ground (gasGround, unlit, under the actors): its edge, a glowing
  // toxic line with a pulse flowing along it over a dark band (it reads on the hall's pale tiles too), and the next stage's stop, a
  // thin white line (PUBG's white circle); in the light map (gasLight) the green the gas throws on the floor; in the air (gasAir) a
  // dense green-yellow fog drifting over the gassed floor near the view, a bank of it right behind the edge, wisps curling up off
  // the edge into it; over the screen (gasEdge) a green tint while the hero stands in it. The run won, it all clears in 3 s ----------
  const GAS_LINE = [0.5, 1, 0.2],
    GAS_HOT = [0.9, 1, 0.62],
    GAS_GLOW = [0.18, 0.7, 0.08],
    GAS_INK = [0.01, 0.05, 0.0],
    GAS_FOG = [0.3, 0.5, 0.1],
    GAS_PUFF = [0.66, 0.84, 0.24],
    GAS_WISP = [0.86, 1, 0.56];
  const gasFade = (ST, GT) => (ST.winAt ? 1 - SS(0, 3, GT - ST.winAt) : 1);
  // the view's box in world px, pad px round it (the ring helpers' culling)
  const VB = { x0: 0, x1: 0, y0: 0, y1: 0 };
  function viewBox(pad) {
    VB.x0 = camX - pad;
    VB.x1 = camX + VW + pad;
    VB.y0 = camY - pad;
    VB.y1 = camY + VH + pad;
    return VB;
  }
  // the ring (r ground px round x, y) walked in steps of about st view px, its speed along it evened out: fn(x, y, an, s, tx, ty)
  // for each step whose point is in view (pad px round it) — the point, its angle, the way walked so far (view px), the tangent
  function ringWalk(x, y, r, st, pad, fn) {
    const V = viewBox(pad);
    if (x + r < V.x0 || x - r > V.x1 || y + r / 2 < V.y0 || y - r / 2 > V.y1) return; // (wholly out of view)
    const dx = Math.max(Math.abs(V.x0 - x), Math.abs(V.x1 - x)),
      dy = Math.max(Math.abs(V.y0 - y), Math.abs(V.y1 - y));
    if (dx * dx + 4 * dy * dy < r * r) return; // (the view wholly inside it)
    for (let an = 0, s = 0; an < TAU; s += st) {
      const c = Math.cos(an),
        sn = Math.sin(an),
        px = x + r * c,
        py = y + (r / 2) * sn,
        sp = r * Math.sqrt(sn * sn + (c * c) / 4);
      if (px > V.x0 && px < V.x1 && py > V.y0 && py < V.y1) fn(px, py, an, s, (-r * sn) / sp, (r * c) / 2 / sp);
      an += st / Math.max(sp, 1);
    }
  }
  // points on the ring at fixed angles (GAS_M of them round it), about one every sp view px: each one kept by its own hash against
  // how many its stretch of the ring holds (q: the share kept), so a ring that shrinks thins them out smoothly instead of sliding
  // them along it. fn(x, y, c, sn, w, j) — the point, its angle's cos and sin, its weight (it fades in and out), its index (GAS_CS:
  // each angle's cos, sin and hash)
  const GAS_M = 1440,
    GAS_CS = new Float32Array(GAS_M * 3);
  for (let j = 0; j < GAS_M; j++) {
    GAS_CS[j * 3] = Math.cos((j / GAS_M) * TAU);
    GAS_CS[j * 3 + 1] = Math.sin((j / GAS_M) * TAU);
    GAS_CS[j * 3 + 2] = rnd(j, 71.3);
  }
  function ringDots(x, y, r, sp, pad, fn) {
    const V = viewBox(pad);
    if (x + r < V.x0 || x - r > V.x1 || y + r / 2 < V.y0 || y - r / 2 > V.y1) return;
    const st = (r * TAU) / GAS_M / sp;
    for (let j = 0; j < GAS_M; j++) {
      const c = GAS_CS[j * 3],
        sn = GAS_CS[j * 3 + 1],
        px = x + r * c,
        py = y + (r / 2) * sn;
      if (px < V.x0 || px > V.x1 || py < V.y0 || py > V.y1) continue;
      const q = st * Math.sqrt(sn * sn + (c * c) / 4),
        p = q - GAS_CS[j * 3 + 2];
      if (p > 0) fn(px, py, c, sn, Math.min(1, p / (0.3 * q)), j);
    }
  }
  // the ground cells (c ground px a side) round the view whose middle, wandering wob px about it, lies in the gas: fn(x, y, d, h, i)
  // — the point, how deep in it (ground px past the edge), the cell's own hash, its index
  const GBOX = [0, 0, 0, 0];
  function gasCells(Z, GT, c, wob, fn) {
    const V = viewBox(c * 1.2);
    GBOX[0] = GBOX[2] = 1e9;
    GBOX[1] = GBOX[3] = -1e9;
    for (let q = 0; q < 4; q++) {
      const x = q & 1 ? V.x1 : V.x0,
        y = q & 2 ? V.y1 : V.y0,
        gx = SIM.toGx(x, y),
        gy = SIM.toGy(x, y);
      GBOX[0] = Math.min(GBOX[0], gx);
      GBOX[1] = Math.max(GBOX[1], gx);
      GBOX[2] = Math.min(GBOX[2], gy);
      GBOX[3] = Math.max(GBOX[3], gy);
    } // (the view's ground box: its corners' ground coords)
    for (let j = Math.floor(GBOX[2] / c); j <= Math.ceil(GBOX[3] / c); j++)
      for (let i = Math.floor(GBOX[0] / c); i <= Math.ceil(GBOX[1] / c); i++) {
        const h = rnd(i * 1.37 + 0.5, j * 2.11 + 0.25),
          [x, y] = SIM.toS(
            (i + 0.5) * c + wob * Math.sin(GT * 0.21 + h * 40),
            (j + 0.5) * c + wob * Math.cos(GT * 0.17 + h * 23),
          );
        if (x < V.x0 || x > V.x1 || y < V.y0 || y > V.y1) continue;
        const d = Math.sqrt(SIM.m2(x - Z.x, y - Z.y)) - Z.r;
        if (d > 0) fn(x, y, d, h, i * 7919 + j);
      }
  }
  function gasGround(ST, LV, GT) {
    const Z = SIM.gasZone(ST, LV),
      fo = gasFade(ST, GT);
    if (!Z || fo <= 0) return;
    // the next stage's stop while it is coming or moving: a thin pale line on a dark one, breathing
    if (Z.ph !== 'held' && Z.next < Z.r - 1) {
      const al = fo * (Z.ph === 'warn' ? SS(0, 0.05, Z.k) : 1) * (0.8 + 0.2 * Math.sin(GT * 2.2));
      ringWalk(Z.x, Z.y, Z.next, 26, 40, (x, y, an, s, tx, ty) => {
        const r = Math.atan2(ty, tx);
        B.fx(11, sx(x), sy(y), 16, 5, r, GAS_INK[0], GAS_INK[1], GAS_INK[2], 0.45 * al, 0.19, 2.2, 1);
        B.fx(11, sx(x), sy(y), 16, 2.1, r, 0.94, 0.97, 1, 0.9 * al, 0.19, 2.6, 1);
      });
    }
    // the edge, once it is in the map (the first stage on): a dark band on the gas's side, a wide green glow, the line, a hot core;
    // a pulse flowing along it, a slow flicker
    if (Z.ph !== 'warn')
      ringWalk(Z.x, Z.y, Z.r, 22, 60, (x, y, an, s, tx, ty) => {
        const r = Math.atan2(ty, tx),
          X = sx(x),
          Y = sy(y),
          fl = 0.5 + 0.5 * Math.sin(s * 0.009 - GT * 2.4),
          nz = 0.85 + 0.15 * Math.sin(s * 0.047 + GT * 1.7) * Math.sin(s * 0.019 - GT * 0.8),
          k = fo * nz * (0.62 + 0.38 * fl * fl);
        B.fx(
          11,
          X + Math.cos(an) * 14,
          Y + Math.sin(an) * 7,
          15,
          12,
          r,
          GAS_INK[0],
          GAS_INK[1],
          GAS_INK[2],
          0.5 * fo,
          0.27,
          1.4,
          1,
        );
        B.fx(11, X, Y, 15, 22, r, GAS_GLOW[0], GAS_GLOW[1], GAS_GLOW[2], 0.3 * k, 0.27, 1.8, 0);
        B.fx(11, X, Y, 15, 3.6, r, GAS_LINE[0], GAS_LINE[1], GAS_LINE[2], k, 0.27, 2.6, 0);
        B.fx(11, X, Y, 15, 1.4, r, GAS_HOT[0], GAS_HOT[1], GAS_HOT[2], k * (0.45 + 0.55 * fl), 0.27, 2.6, 0);
      });
    B.flush(B.F, 'fx');
  }
  // the light the gas throws: green pools along its edge, a dim green over the floor deeper in (into the light map, added)
  function gasLight(ST, LV, GT) {
    const Z = SIM.gasZone(ST, LV),
      fo = gasFade(ST, GT);
    if (!Z || Z.ph === 'warn' || fo <= 0) return;
    ringDots(Z.x, Z.y, Z.r + 50, 110, 260, (x, y, c, sn, w, j) => {
      const k = fo * w * (0.8 + 0.2 * Math.sin(GT * 1.3 + j));
      B.fx(0, sx(x), sy(y), 190, 95, 0, 0.08 * k, 0.3 * k, 0.04 * k, 1, 1.4, 0, 0);
    });
    gasCells(Z, GT, 320, 0, (x, y, d) => {
      const k = fo * SS(80, 400, d);
      if (k > 0) B.fx(0, sx(x), sy(y), 420, 210, 0, 0.03 * k, 0.12 * k, 0.015 * k, 1, 1.2, 0, 0);
    });
  }
  function gasAir(ST, LV, GT) {
    const Z = SIM.gasZone(ST, LV),
      fo = gasFade(ST, GT);
    if (!Z || Z.ph === 'warn' || fo <= 0) return;
    const fk = clamp(S.fxk, 0.5, 1); // (a device that can't keep up: fewer, bigger puffs)
    // the fog over the gassed floor: a soft dark murk under noisy puffs churning slowly, each one kept clear of the edge (its size
    // at most its depth: the edge stays crisp, the bank below fills up to it), thicker deeper in
    gasCells(Z, GT, 150 / fk, 55, (x, y, d, h, i) => {
      const a = fo * SS(30, 120, d) * (0.75 + 0.25 * SS(150, 700, d)),
        rad = clamp(d - 12, 50, 220) * (0.92 + 0.16 * h) * (fk < 1 ? 1.2 : 1),
        br = 0.85 + 0.15 * Math.sin(GT * 0.6 + h * 30),
        c = h < 0.5 ? 1 : 0.86;
      if (a <= 0.01) return;
      B.fx(
        0,
        sx(x),
        sy(y) - 16,
        rad * 1.15,
        rad * 0.62,
        0,
        GAS_FOG[0],
        GAS_FOG[1],
        GAS_FOG[2],
        0.3 * a * br,
        1.6,
        0,
        1,
      );
      B.fx(
        1,
        sx(x),
        sy(y) - 26,
        rad,
        rad * 0.56,
        h * 6 + GT * 0.05 * (h - 0.5),
        GAS_PUFF[0] * c,
        GAS_PUFF[1],
        GAS_PUFF[2] * c,
        0.27 * a * br,
        1,
        i,
        1,
      );
    });
    // the front: a dense band of murk flat on the floor from the edge out (as wide on the ground every way round: f, the screen px
    // a ground px out from it takes there)
    ringWalk(Z.x, Z.y, Z.r, 30, 140, (x, y, an, s, tx, ty) => {
      const c = Math.cos(an),
        sn = Math.sin(an),
        f = Math.sqrt(c * c + (sn * sn) / 4),
        X = sx(x + c * 48),
        Y = sy(y + (sn * 48) / 2);
      B.fx(11, X, Y, 22, 46 * f, Math.atan2(ty, tx), GAS_FOG[0], GAS_FOG[1], GAS_FOG[2], 0.34 * fo, 0.3, 2.4, 1);
    });
    // the bank right behind the edge: two rows of puffs along it, the inner ones no bigger than their way out from it
    ringDots(Z.x, Z.y, Z.r, 64 / fk, 260, (x, y, c, sn, w, j) => {
      const h = GAS_CS[j * 3 + 2],
        br = 0.82 + 0.18 * Math.sin(GT * 0.9 + j * 1.7);
      for (let q = 0; q < 2; q++) {
        const dd = q ? 150 : 58,
          rr = (q ? 125 : 62) * (0.9 + 0.2 * h),
          px = x + c * dd,
          py = y + (sn * dd) / 2 - 18;
        B.fx(
          1,
          sx(px),
          sy(py),
          rr,
          rr * 0.5,
          h * 9 + GT * 0.07,
          GAS_PUFF[0],
          GAS_PUFF[1],
          GAS_PUFF[2],
          (q ? 0.3 : 0.34) * w * br * fo,
          1,
          j + dd,
          1,
        );
      }
    });
    // wisps: off the edge every so often, each rising and drifting out into the gas over its life, curling, growing, fading; a soft
    // glowing head and a fainter puff behind it
    const LIFE = 3.2;
    ringDots(Z.x, Z.y, Z.r, 80 / fk, 220, (x, y, c, sn, w, j) => {
      const h = GAS_CS[j * 3 + 2],
        tt = GT + h * LIFE * 7,
        cyc = Math.floor(tt / LIFE);
      if (rnd(j, cyc) > 0.72) return;
      const tl = Math.sqrt(sn * sn + (c * c) / 4),
        tx = -sn / tl,
        ty = c / 2 / tl;
      for (let q = 0; q < 3; q++) {
        const u = tt / LIFE - cyc - q * 0.1;
        if (u <= 0) continue;
        const env = SS(0, 0.16, u) * (1 - SS(0.45, 1, u)) * w * fo,
          out = 12 + 90 * u,
          curl = 30 * Math.sin(u * 4.6 + j) * u,
          rad = (18 + 40 * u) * (1 - q * 0.18),
          px = x + c * out + tx * curl,
          py = y + (sn * out) / 2 + ty * curl - 8 - 150 * u;
        B.fx(
          1,
          sx(px),
          sy(py),
          rad * 0.8,
          rad * 0.9,
          j + u * 2.5,
          GAS_WISP[0],
          GAS_WISP[1],
          GAS_WISP[2],
          (0.62 - q * 0.16) * env,
          1,
          j * 3 + cyc + q,
          0.4,
        );
      }
    });
    B.flush(B.F, 'fx');
  }
  function gasEdge(ST, LV, GT) {
    const p = ST.p;
    if (p.dead) return;
    const k = SIM.gasAt(ST, LV, p.x, p.y) * gasFade(ST, GT);
    if (k <= 0) return;
    const ch = GT - (p.gasT ?? -9) < 0.25 ? 1 - (GT - p.gasT) / 0.25 : 0,
      a = (0.25 + 0.3 * k) * (0.75 + 0.25 * Math.sin(GT * 5)) + 0.25 * ch;
    const [vw, vh] = G.view();
    for (const [x, y] of [
      [0, vh / 2],
      [vw, vh / 2],
      [vw / 2, 0],
      [vw / 2, vh],
    ])
      B.fx(0, x, y, vw * 0.42, vh * 0.48, 0, 0.45, 0.9, 0.1, a * 0.6, 2.2, 0, 1);
    B.flush(B.F, 'fx');
  }
  function lowHp(ST, GT) {
    const p = ST.p,
      k = p.hp / p.maxHp,
      die = D.COOP.revive.die;
    let pulse = k > 0.3 || p.dead ? 0 : ((0.3 - k) / 0.3) * (0.55 + 0.45 * Math.sin(GT * 6));
    // together: a hero down and no one getting it up — the edges beat with the call's heartbeat (quicker as its time runs out; this
    // hero's own fall harder)
    if (ST.ps && ST.ps.length > 1 && !ST.over)
      for (const o of ST.ps)
        if (o.down && !o.rvn) {
          const u = 1 - clamp(o.bt ?? die, 0, die) / die;
          pulse = Math.max(pulse, beat(GT * (0.9 + u * 1.5)) * (o === p ? 0.75 : 0.4) * (0.55 + 0.45 * u));
        }
    if (pulse <= 0.005) return;
    const [vw, vh] = G.view();
    for (const [x, y] of [
      [0, vh / 2],
      [vw, vh / 2],
      [vw / 2, 0],
      [vw / 2, vh],
    ])
      B.fx(0, x, y, vw * 0.4, vh * 0.45, 0, 0.9, 0.04, 0.04, pulse * 0.55, 2.2, 0, 1);
    B.flush(B.F, 'fx');
  }
  function numbers(ST, GT) {
    let shown = 0;
    for (let i = ST.ev.length - 1; i >= 0 && shown < 24; i--) {
      const e = ST.ev[i];
      if (e.k !== 'dmg') continue;
      const a = GT - e.t;
      if (a > 0.75) break;
      if (a < 0) continue;
      shown++;
      const A = e.c ? S.x_digc : S.x_dig,
        R = B.R[e.c ? 'x_digc' : 'x_dig'];
      if (!A || !R) continue;
      const str = String(e.v),
        pop = a < 0.08 ? 1 + (1 - a / 0.08) * 0.6 : 1,
        al = a > 0.5 ? 1 - (a - 0.5) / 0.25 : 1,
        sc = (e.c ? 0.62 : 0.52) * pop;
      let w = 0;
      for (const ch of str) w += A.ws[ch.charCodeAt(0) - 48][1] * sc;
      let x = sx(e.x) * ZM - w / 2 + (rnd(e.t, 3) - 0.5) * 20;
      const y = sy(e.y) * ZM - a * (e.c ? 50 : 40);
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      for (const ch of str) {
        const [ox, ow] = A.ws[ch.charCodeAt(0) - 48];
        const u0 = R.u0 + ((R.u1 - R.u0) * ox) / A.w,
          u1 = R.u0 + ((R.u1 - R.u0) * (ox + ow)) / A.w;
        const o = B.S.slot(),
          d = B.S.d,
          hh = A.h * sc;
        d.set([ow * sc, 0, 0, hh, x, y - hh / 2, u0, R.v0, u1, R.v1, 1, 1, 1, al, 0, R.t, 0, 0, 0, 0], o);
        x += ow * sc * 0.92;
      }
    }
  }

  // the hero's hurts: a red "−N" over its head for each, following it — popping in big with a kick of tilt, settling, rising and
  // fading (a run of them steps aside left and right so they don't stack on one another)
  function hurtNumbers(ST, GT) {
    healNumbers(ST, GT);
    const A = S.x_digh,
      R = B.R.x_digh,
      p = ST.p;
    if (!A || !R) return;
    let shown = 0;
    for (let i = ST.ev.length - 1; i >= 0 && shown < 6; i--) {
      const e = ST.ev[i];
      if (e.k !== 'hurt' || (e.pi !== undefined && e.pi !== p.i)) continue;
      const a = GT - e.t;
      if (a > 1.05) break;
      if (a < 0) continue;
      shown++;
      const str = '-' + Math.max(1, Math.round(e.v)),
        big = clamp(0.8 + e.v / 60, 0.85, 1.3);
      const pop = a < 0.07 ? 0.45 + (0.95 * a) / 0.07 : a < 0.17 ? 1.4 - 0.4 * SS(0.07, 0.17, a) : 1,
        sc = 0.5 * big * pop * ZM,
        al = 1 - SS(0.72, 1.05, a);
      const rot = (rnd(e.t, 11) < 0.5 ? -1 : 1) * 0.16 * Math.exp(-a * 9) * Math.cos(a * 30),
        side = (rnd(e.t, 12) - 0.5) * 46;
      const adv = (ch, gw) => gw * (ch === '-' ? 0.74 : 0.92); // (the minus sits close to its number)
      let w = 0;
      for (const ch of str) w += adv(ch, A.ws[A.chars.indexOf(ch)][1] * sc);
      const cx = (sx(p.x) + side * SS(0, 0.3, a)) * ZM,
        cy = (sy(p.y) - HERO3D.H * 1.08 - 70 * (1 - Math.exp(-a * 3))) * ZM,
        c = Math.cos(rot),
        s = Math.sin(rot),
        hh = A.h * sc;
      let x = -w / 2;
      for (const ch of str) {
        const k = A.chars.indexOf(ch),
          [ox, ow] = A.ws[k],
          u0 = R.u0 + ((R.u1 - R.u0) * ox) / A.w,
          u1 = R.u0 + ((R.u1 - R.u0) * (ox + ow)) / A.w,
          gw = ow * sc;
        const mx = x + gw / 2,
          px = cx + c * mx,
          py = cy + s * mx; // the glyph's middle, turned with the number
        const o = B.S.slot(),
          d = B.S.d;
        d.set(
          [
            c * gw,
            s * gw,
            -s * hh,
            c * hh,
            px - (c * gw - s * hh) / 2,
            py - (s * gw + c * hh) / 2,
            u0,
            R.v0,
            u1,
            R.v1,
            1,
            1,
            1,
            al,
            0,
            R.t,
            0,
            0,
            0,
            0,
          ],
          o,
        );
        x += adv(ch, gw);
      }
    }
  }

  // the main gun reloading: a ring over the hero's shoulder that fills round as it goes (on a dark disc, so it reads over anything)
  function reloadMark(ST, GT) {
    const p = ST.p,
      w = p.main;
    if (!(w.rl > 0) || p.dead || ST.over || ST.hub) return;
    const k = clamp(1 - w.rl / (w.rlT || 1), 0, 1),
      x = (sx(p.x) + 46) * ZM,
      y = (sy(p.y) - HERO3D.H * 1.02) * ZM,
      R = (window.__touch ? 24 : 17) * ZM,
      N = 22; // (bigger on a phone's small screen)
    B.fx(5, x, y, R * 1.55, R * 1.55, 0, 0.02, 0.03, 0.07, 0.6, 3, 0, 1);
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N,
        an = -Math.PI / 2 + f * TAU,
        on = f <= k;
      B.fx(
        7,
        x + Math.cos(an) * R,
        y + Math.sin(an) * R,
        ((Math.PI * R) / N) * 0.72,
        2.3 * ZM,
        an + Math.PI / 2,
        on ? 1 : 0.42,
        on ? 0.82 : 0.48,
        on ? 0.3 : 0.58,
        on ? 1 : 0.55,
        3,
        0,
        1,
      );
    }
    B.fx(7, x, y + 1.5 * ZM, 2.6 * ZM, 5 * ZM, 0.18, 1, 0.82, 0.3, 0.9, 3, 0, 1); // a little magazine in the middle
    B.flush(B.F, 'fx');
  }
  // the magazine let go at a reload (the guns that have one; the minigun's ammo box — a top-up keeps its own): it drops from the gun
  // beside the hero, tumbling, and lies on the ground a moment. Falling it is drawn over the actors (airFx), lying under them (groundFx)
  const MAGD = { pistol: [6, 3], smg: [8, 3.2], sniper: [7, 3.2], minigun: [11, 7] },
    MAG_FALL = 0.26;
  function droppedMags(ST, GT, lying) {
    for (const e of ST.ev) {
      if (e.k !== 'reload' || e.top || !MAGD[e.w]) continue;
      const a = GT - e.t;
      if (a < 0 || a > 2.2 || a >= MAG_FALL !== lying) continue;
      const [hw, hh] = MAGD[e.w],
        side = rnd(e.t, 31) < 0.5 ? -1 : 1,
        q = Math.min(1, a / MAG_FALL),
        dx = side * (12 + 10 * rnd(e.t, 32)) * q;
      const y0 = sy(e.y),
        y1 = sy(e.gy ?? e.y) + 8,
        x = sx(e.x) + dx,
        y = y0 + (y1 - y0) * q * q - (lying ? 0 : Math.sin(q * Math.PI) * 6);
      const rot = side * (0.3 + 1.3 * q) + (rnd(e.t, 33) - 0.5) * 0.4,
        al = 1 - SS(1.5, 2.2, a),
        c = Math.cos(rot),
        s = Math.sin(rot);
      B.fx(7, x, y, hw, hh, rot, 0.11, 0.12, 0.14, al, 3, 0, 1);
      B.fx(7, x + s * hh * 0.45, y - c * hh * 0.45, hw * 0.88, hh * 0.32, rot, 0.36, 0.38, 0.42, 0.85 * al, 3, 0, 1);
    } // its lit edge
  }
  // a heal's green "+N" rising from the hero's chest, smaller and quicker than a hurt (a run of them added up while they show)
  function healNumbers(ST, GT) {
    const A = S.x_digg,
      R = B.R.x_digg,
      p = ST.p;
    if (!A || !R) return;
    let v = 0,
      t0 = -9;
    for (let i = ST.ev.length - 1; i >= 0; i--) {
      const e = ST.ev[i];
      if (e.k !== 'lifesteal') continue;
      const a = GT - e.t;
      if (a > 0.8) break;
      if (a < 0) continue;
      v += e.v;
      if (t0 < 0) t0 = e.t;
    }
    if (!v) return;
    const a = GT - t0,
      str = '+' + Math.round(v),
      sc = 0.42 * ZM * (a < 0.06 ? 0.6 + (0.4 * a) / 0.06 : 1),
      al = 1 - SS(0.55, 0.8, a),
      hh = A.h * sc;
    let w = 0;
    for (const ch of str) w += A.ws[A.chars.indexOf(ch)][1] * sc * 0.92;
    let x = (sx(p.x) + 46) * ZM - w / 2;
    const y = (sy(p.y) - HERO3D.H * 0.62 - 40 * a) * ZM;
    for (const ch of str) {
      const [ox, ow] = A.ws[A.chars.indexOf(ch)],
        u0 = R.u0 + ((R.u1 - R.u0) * ox) / A.w,
        u1 = R.u0 + ((R.u1 - R.u0) * (ox + ow)) / A.w,
        gw = ow * sc;
      const o = B.S.slot(),
        d = B.S.d;
      d.set([gw, 0, 0, hh, x, y - hh / 2, u0, R.v0, u1, R.v1, 1, 1, 1, al, 0, R.t, 0, 0, 0, 0], o);
      x += gw * 0.92;
    }
  }

  // ================================================================== HUD (strictly as specified; styled after the reference)
  // chamfered navy plaques with a bright cyan inner rim, medium-weight type without heavy outlines
  const NAVY = [0.05, 0.09, 0.22],
    NAVY2 = [0.08, 0.15, 0.33],
    EDGE = [0.1, 0.22, 0.45],
    RIM = [0.3, 0.78, 1.0];
  function cham(x, y, w, h, c, o = {}) {
    G.draw(
      L.P.cham,
      {
        u_sz: [w, h],
        u_c: c,
        u_a: o.a ?? 0.96,
        u_rim: o.rim ?? 1,
        u_c0: o.c0 || NAVY2,
        u_c1: o.c1 || NAVY,
        u_edge: o.edge || EDGE,
        u_rimc: o.rimc || RIM,
        u_bw: o.bw ?? 3,
      },
      G.xf(x, y, w, h),
    );
  }
  function panel(id, x, y, w, h, c = 12, o = {}) {
    cham(x, y, w, h, c, o);
    L.uiBox(id, x, y, w, h, o.pad ?? 4);
  }
  const ICON_ALIAS = { i_medkit: 'pk_medkit', i_magnet: 'pk_magnet' };
  function icon(name, x, y, w, h, a = 1, sil = false) {
    if (!B.R[name] && ICON_ALIAS[name]) name = ICON_ALIAS[name];
    const R = B.R[name];
    if (!R) return;
    const k = Math.min(w / R.w, h / R.h),
      ww = R.w * k,
      hh = R.h * k;
    B.box(
      name,
      x + (w - ww) / 2,
      y + (h - hh) / 2,
      ww,
      hh,
      false,
      sil ? 0.03 : 1,
      sil ? 0.04 : 1,
      sil ? 0.08 : 1,
      a,
      0,
      0,
    );
  }
  const mmss = (t) => {
    const s = Math.max(0, Math.floor(t));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  // the HUD's still parts — the panels, the bar backs, the words and the level, the slots with their icons and level badges, the kills and
  // coins plaques, the pause button — drawn into HUDC once and kept till one of them changes (a level, an item, a reload starting or
  // ending, the language, the view's size): a frame draws them as one quad instead of some sixty draws, each a handful of GL calls (a
  // weak phone's CPU paid about 2 ms a frame for them). The live parts go over it every frame. (?render: all of it live, every frame)
  let HUDC = null,
    HUDK = '';
  // the HUD inside the window's safe area (window.__SAFE, CSS px of the window, index.html: a phone's notch and home bar, Telegram's
  // own buttons over a full-screen Mini App): the world fills the whole screen, the HUD is drawn as a view of its own laid into the
  // safe rectangle (G.sub), the view's height tall and as wide as the rectangle's shape. HX: ox, oy where it starts (view px), k (one
  // HUD px in view px), w (its width, the W hud draws with); on false: nothing inset, the HUD is the view
  const HX = { on: false, ox: 0, oy: 0, k: 1, w: SIM.VIEW.W, vw: SIM.VIEW.W }; // (vw: the whole view's width)
  function hudXf() {
    const s = window.__SAFE;
    HX.on = false;
    HX.ox = HX.oy = 0;
    HX.k = 1;
    HX.w = HX.vw = W;
    if (!s || !(s.l || s.t || s.r || s.b)) return HX;
    // (the canvas: a box of the view's shape in the middle of the window, as big as fits — style.css canvas)
    const iw = innerWidth,
      ih = innerHeight,
      ar = G.W / G.H,
      cw = Math.min(iw, ih * ar),
      ch = cw / ar,
      cl = (iw - cw) / 2,
      ct = (ih - ch) / 2,
      kv = G.W / cw;
    const x0 = Math.max(0, s.l - cl) * kv,
      y0 = Math.max(0, s.t - ct) * kv,
      x1 = G.W - Math.max(0, s.r - cl) * kv,
      y1 = G.H - Math.max(0, s.b - ct) * kv;
    if (x1 - x0 < G.W * 0.5 || y1 - y0 < G.H * 0.5) return HX; // (insets eating half the screen: not believed)
    HX.on = true;
    HX.ox = x0;
    HX.oy = y0;
    HX.k = (y1 - y0) / H;
    HX.w = (x1 - x0) / HX.k;
    return HX;
  }
  // a point of the view → the HUD's (its pause button's touch: index.html), and the HUD's width now
  S.hudPt = (x, y) => [(x - HX.ox) / HX.k, (y - HX.oy) / HX.k];
  // NEAR Base: the spot whose picture is under a view point (view px, as the mouse's), or null — a person (their model's box),
  // their post, a piece of furniture or a heap of junk (its picture's box), a building's unseen spot (its footprint's), the
  // nearest to the viewer first (live/hub.js: a click opens it as E does)
  S.spotAt = (ST, vx, vy) => {
    if (!ST || !ST.hub || !window.HUB || !HUB.spots) return null;
    const LV = SIM.level(ST.seed),
      x = vx / ZM + camX,
      y = vy / ZM + camY;
    let best = null;
    const hit = (s, o, k) => {
      let x0, x1, y0, y1;
      if (NPC3D[o.n]) {
        const h = npcH(LV, NPC3D[o.n]);
        x0 = o.x - h * 0.3;
        x1 = o.x + h * 0.3;
        y0 = o.fy - h * (LV.base ? 0.75 : 1);
        y1 = o.fy + 10;
      } else if (o.hide) {
        const r = (o.fw + o.fh) / 2;
        x0 = o.x - r;
        x1 = o.x + r;
        y0 = o.y - r / 2 - 60;
        y1 = o.fy;
      } else {
        const R = B.R[o.n],
          h = R ? (o.w * R.h) / R.w : o.w * 0.8;
        x0 = o.x - o.w / 2;
        x1 = o.x + o.w / 2;
        y0 = o.fy - h;
        y1 = o.fy;
      }
      if (x < x0 || x > x1 || y < y0 || y > y1) return;
      const d = o.fy + k; // (the one drawn last: in front)
      if (!best || d > best.d) best = { id: s.id, d };
    };
    for (const s of HUB.spots(ST)) {
      hit(s, s.prop, 1000); // (a person over their own post)
      if (s.post) hit(s, s.post, 0);
    }
    return best ? best.id : null;
  };
  S.hudW = () => HX.w;
  // ---- playing together, in the HUD: the partner's panel under this hero's — its name, its health, its gun and items (down: the
  // seconds it has left, or how far it is got up; dead for good or gone: greyed) — the call on the right while one of the two is down
  // or has just died (a ring of the seconds left, the time it stands while one gets it up, a heartbeat quickening as it runs out), and
  // over a chest dropped for one hero whose it is (the partner's, still its own: a lock and the seconds till anyone may take it)
  const MATE = { x: 52, y: 122, w: 396, h: 96 },
    MB = { x: 236, w: 198 },
    MS = 40,
    MSH = 44,
    MG = 5; // (MB: its health bar)
  const mateOf = (ST) => (ST.ps && ST.ps.length > 1 ? ST.ps.find((o) => o !== ST.p) || null : null);
  const nickOf = (i) => {
    const G2 = window.GAME,
      R = G2 && (G2.coopRun || (G2.watching && G2.watching.W && G2.watching.W.init)),
      n = R && R.names && R.names[i];
    return (n && n.nick) || '';
  };
  const mateState = (o) => (o.gone ? 'gone' : o.out ? 'out' : o.down ? 'down' : 'up');
  const mateSlots = (o) => {
    const s = [{ icon: 'i_' + o.main.id, lvl: o.main.lvl, main: true, evo: o.main.evo }];
    for (const it of o.items) if (D.ITEMS[it.id]) s.push({ icon: D.ITEMS[it.id].icon, lvl: it.lvl, evo: it.evo });
    return s;
  };
  const mateKey = (o, T) =>
    [
      o.i,
      mateState(o),
      nickOf(o.i),
      T('coop.mate'),
      mateSlots(o)
        .map((s) => s.icon + s.lvl + (s.evo ? '*' : ''))
        .join(','),
    ].join(';');
  const fitText = (slot, s, max, o) => {
    if (L.labelW(slot, s, o) <= max) return s;
    let t = s;
    while (t.length > 1 && L.labelW(slot, t + '…', o) > max) t = t.slice(0, -1);
    return t + '…';
  };
  const MOK = { edge: [0.08, 0.34, 0.2], rimc: [0.45, 1, 0.6] },
    MDOWN = { edge: [0.5, 0.08, 0.05], rimc: [1, 0.4, 0.3] },
    MDIM = { edge: [0.12, 0.15, 0.22], rimc: [0.45, 0.5, 0.6], rim: 0.45, a: 0.86 };
  function mateStill(o, T, lab) {
    const { x, y, w, h } = MATE,
      st = mateState(o),
      dim = st === 'gone' || st === 'out',
      bx = MB.x,
      by = y + 12,
      bw = MB.w;
    panel('mate', x, y, w, h, 12, st === 'down' ? MDOWN : dim ? MDIM : MOK);
    L.solid(
      x + 3,
      y + 10,
      5,
      h - 20,
      st === 'down' ? [1, 0.35, 0.3] : dim ? [0.4, 0.45, 0.55] : [0.4, 1, 0.55],
      0,
      0,
      0,
      0.85,
    ); // (the team colour down its edge)
    const fo = { size: 19, font: FONT, weight: '800' },
      nm = fitText('matenm', nickOf(o.i) || T('coop.mate'), bx - x - 30, fo);
    lab('matenm', nm, x + 18, by + 9, {
      size: 19,
      weight: '800',
      col: dim ? '#8a95ab' : st === 'down' ? '#ffb0a4' : '#b9f5c3',
      al: 0,
    });
    L.rrect(bx, by, bw, 19, 3, [0.02, 0.04, 0.1], [0.02, 0.04, 0.1], 1);
    if (dim)
      lab('matest', T(st === 'out' ? 'coop.tagOut' : 'coop.tagGone'), bx + bw / 2, by + 10, {
        size: 15,
        weight: '800',
        col: st === 'out' ? '#ff7a6a' : '#9aa6bd',
        al: 0.5,
      });
    const sl = mateSlots(o),
      y0 = y + h - MSH - 9,
      x0 = x + 14,
      n = 1 + D.MAX_ITEMS;
    for (let i = 0; i < n; i++) {
      const s = sl[i],
        sx0 = x0 + i * (MS + MG);
      cham(sx0, y0, MS, MSH, 6, {
        c0: s ? [0.04, 0.2, 0.28] : [0.04, 0.07, 0.13],
        c1: s ? [0.02, 0.1, 0.17] : [0.03, 0.05, 0.1],
        a: dim ? 0.6 : 0.96,
        edge:
          s && s.main ? [0.95, 0.72, 0.12] : s && s.evo ? [0.95, 0.5, 0.1] : s ? [0.05, 0.3, 0.42] : [0.08, 0.13, 0.22],
        rimc: s && s.main ? [1, 0.92, 0.35] : [0.25, 0.85, 0.95],
        rim: s ? 0.8 : 0.2,
        bw: 2,
      });
    }
    sl.forEach((s, i) => icon(s.icon, x0 + i * (MS + MG) + 4, y0 + 3, MS - 8, MSH - 12, dim ? 0.4 : 1));
    B.flush(B.S, 'spr');
    sl.forEach((s, i) => {
      const bx2 = x0 + i * (MS + MG) + MS - 15,
        by2 = y0 + MSH - 15;
      L.rrect(
        bx2,
        by2,
        14,
        13,
        3,
        s.main ? [1, 0.88, 0.35] : [0.95, 0.97, 1],
        s.main ? [0.92, 0.66, 0.1] : [0.78, 0.84, 0.92],
        dim ? 0.5 : 1,
      );
      lab('mlv' + i, s.evo ? '★' : String(s.lvl), bx2 + 7, by2 + 7, {
        size: 12,
        weight: '800',
        col: s.main ? '#3a1d00' : '#0e1a33',
        al: 0.5,
      });
    });
  }
  function mateLive(ST, GT, o, T, lab) {
    const st = mateState(o),
      bx = MB.x,
      by = MATE.y + 12,
      bw = MB.w,
      die = D.COOP.revive.die;
    if (st === 'up') {
      const k = clamp(o.hp / o.maxHp, 0, 1),
        c =
          k > 0.5
            ? [
                [0.55, 1, 0.6],
                [0.12, 0.66, 0.3],
              ]
            : k > 0.25
              ? [
                  [1, 0.9, 0.4],
                  [0.9, 0.58, 0.08],
                ]
              : [
                  [1, 0.36, 0.3],
                  [0.8, 0.1, 0.1],
                ];
      if (k > 0) L.rrect(bx + 2, by + 2, (bw - 4) * k, 15, 2, c[0], c[1], 1);
      lab('matehp', Math.ceil(o.hp) + ' / ' + Math.round(o.maxHp), bx + bw - 8, by + 10, {
        size: 13,
        weight: '800',
        col: '#ffffff',
        al: 1,
      });
    } else if (st === 'down') {
      if (o.rvn) {
        const k = clamp(o.rv || 0, 0, 1);
        if (k > 0) L.rrect(bx + 2, by + 2, (bw - 4) * k, 15, 2, [0.55, 1, 0.6], [0.12, 0.66, 0.3], 1);
        lab('matedn', T('coop.tagUp', { p: Math.floor(k * 100) }), bx + bw / 2, by + 10, {
          size: 13,
          weight: '800',
          col: '#ffffff',
          al: 0.5,
        });
      } else {
        const k = clamp((o.bt ?? die) / die, 0, 1);
        if (k > 0)
          L.rrect(
            bx + 2,
            by + 2,
            (bw - 4) * k,
            15,
            2,
            [1, 0.32, 0.26],
            [0.7, 0.04, 0.04],
            0.72 + 0.28 * Math.sin(GT * 9),
          );
        lab('matedn', T('coop.tagDown', { s: Math.ceil(o.bt ?? die) }), bx + bw / 2, by + 10, {
          size: 13,
          weight: '800',
          col: '#ffffff',
          al: 0.5,
        });
      }
    }
  }
  // the call on the right: this hero down or dead, or the partner down (or dead a moment ago)
  const CALL = { key: '', t0: 0 };
  const beat = (ph) => {
    const f = ph - Math.floor(ph);
    return Math.exp(-((f / 0.07) ** 2)) + 0.65 * Math.exp(-(((f - 0.2) / 0.07) ** 2));
  }; // lub-dub
  function coopCall(ST, GT, W, T, lab) {
    const me = ST.p,
      o = mateOf(ST),
      die = D.COOP.revive.die;
    const who = me.down || me.out ? me : o && (o.down || (o.out && ST.t - (o.outT ?? -99) < 6)) ? o : null;
    if (!who || ST.over) {
      CALL.key = '';
      return;
    }
    const mine = who === me,
      key = (who.out ? 'out' : 'down') + who.i;
    if (CALL.key !== key) {
      CALL.key = key;
      CALL.t0 = GT;
    }
    const a = GT - CALL.t0,
      inK = SS(0, 0.32, a),
      outK = !mine && who.out ? SS(5.4, 6, ST.t - who.outT) : 0,
      al = inK * (1 - outK);
    if (al <= 0.01) return;
    const left = who.out ? 0 : clamp(who.bt ?? die, 0, die),
      urg = 1 - left / die,
      rv = who.out ? 0 : clamp(who.rv || 0, 0, 1),
      up = !who.out && !!who.rvn;
    const title = T(mine ? (who.out ? 'coop.meOut' : 'coop.meDown') : who.out ? 'coop.mateOut' : 'coop.mateDown');
    const sub = mine ? (who.out ? T('coop.watchMate') : T('coop.waitHelp')) : nickOf(who.i) || T('coop.mate');
    const hint = who.out
      ? mine
        ? ''
        : T('coop.alone')
      : up
        ? T(mine ? 'coop.helped' : 'coop.helping', { p: Math.floor(rv * 100) })
        : mine
          ? T('coop.helpHint')
          : T('coop.goHelp');
    const fT = { size: 30, font: FONT, weight: '800' },
      fS = { size: 20, font: FONT, weight: '700' },
      fH = { size: 17, font: FONT, weight: '700' };
    const tw = Math.max(L.labelW('cct', title, fT), L.labelW('ccs', sub, fS), hint ? L.labelW('cch', hint, fH) : 0);
    const w = Math.max(380, 132 + tw + 30),
      h = 132,
      x = W - 40 - w + (1 - inK) * 70 + outK * 40,
      y = 168,
      cx = x + 68,
      cy = y + h / 2,
      R = 46;
    const red = who.out ? [0.7, 0.75, 0.85] : [1, 0.3, 0.24];
    // the heartbeat behind it, quicker and harder as the time runs out
    const hb = who.out ? 0 : up ? 0.25 : beat(GT * (0.9 + urg * 1.5)) * (0.45 + 0.55 * urg);
    B.fx(
      0,
      x + w / 2,
      cy,
      w * 0.62,
      h * 0.95,
      0,
      red[0],
      red[1] * 0.6,
      red[2] * 0.6,
      al * (0.18 + 0.32 * hb),
      2.2,
      0,
      0,
    );
    B.flush(B.F, 'fx');
    panel('ccall', x, y, w, h, 16, {
      edge: who.out ? [0.16, 0.18, 0.26] : up ? [0.08, 0.4, 0.2] : [0.55, 0.08, 0.05],
      rimc: who.out ? [0.6, 0.65, 0.75] : up ? [0.45, 1, 0.6] : [1, 0.42, 0.3],
      a: 0.96 * al,
      bw: 3,
    });
    L.solid(
      x + 4,
      y + 12,
      6,
      h - 24,
      who.out ? [0.5, 0.55, 0.65] : up ? [0.4, 1, 0.55] : [1, 0.35, 0.28],
      0,
      0,
      0,
      0.9 * al,
    );
    // the ring: the seconds left (red, draining clockwise from the top), how far it is got up (green, inside)
    const N = 40,
      segW = ((Math.PI * R) / N) * 0.62;
    B.fx(5, cx, cy, R + 12, R + 12, 0, 0.02, 0.03, 0.08, 0.75 * al, 2, 0, 1);
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N,
        an = -Math.PI / 2 + f * TAU,
        on = !who.out && f >= 1 - left / die;
      const c = on ? (up ? [1, 0.55, 0.45] : red) : [0.18, 0.22, 0.32],
        gl = on && !up && left < 10 ? 0.75 + 0.25 * Math.sin(GT * 14) : 1;
      B.fx(
        7,
        cx + Math.cos(an) * R,
        cy + Math.sin(an) * R,
        segW,
        3.6,
        an + Math.PI / 2,
        c[0] * gl,
        c[1] * gl,
        c[2] * gl,
        al,
        3,
        0,
        1,
      );
    }
    if (rv > 0)
      for (let i = 0; i < N; i++) {
        const f = (i + 0.5) / N;
        if (f > rv) break;
        const an = -Math.PI / 2 + f * TAU;
        B.fx(
          7,
          cx + Math.cos(an) * (R - 11),
          cy + Math.sin(an) * (R - 11),
          segW * 0.8,
          3,
          an + Math.PI / 2,
          0.45,
          1,
          0.55,
          al,
          3,
          0,
          1,
        );
      }
    if (!who.out && !up) B.fx(0, cx, cy, R * 0.9, R * 0.9, 0, 1, 0.25, 0.2, al * 0.35 * hb, 2, 0, 0);
    B.flush(B.F, 'fx');
    if (who.out) {
      icon('x_skull', cx - 26, cy - 26, 52, 52, al);
      B.flush(B.S, 'spr');
    } else {
      const s = Math.ceil(left),
        fr = left - Math.floor(left),
        pop = up ? 1 : 1 + 0.22 * SS(0.72, 1, fr);
      lab('ccn', String(s), cx, cy + 1, {
        size: 44,
        weight: '900',
        col: up ? '#d8ffe0' : s <= 10 ? '#ff6a5a' : '#ffffff',
        al: 0.5,
        a: al,
        scale: pop,
      });
    }
    // the words
    const tx = x + 132;
    lab('cct', title, tx, y + 34, { size: 30, weight: '800', col: who.out ? '#c9d2e4' : '#ff5a4a', al: 0, a: al });
    lab('ccs', sub, tx, y + 68, {
      size: 20,
      weight: '700',
      col: who.out ? '#9aa6bd' : mine ? '#ffd0c8' : '#b9f5c3',
      al: 0,
      a: al,
    });
    if (hint) lab('cch', hint, tx, y + 98, { size: 17, weight: '700', col: up ? '#8dffb0' : '#c8d3ea', al: 0, a: al });
    if (up) {
      L.rrect(tx, y + 112, w - 132 - 26, 7, 3, [0.02, 0.04, 0.1], [0.02, 0.04, 0.1], al);
      if (rv > 0) L.rrect(tx + 1, y + 113, (w - 132 - 28) * rv, 5, 2, [0.55, 1, 0.6], [0.12, 0.66, 0.3], al);
    }
  }
  // over the chests dropped for one hero: whose (this player's: "yours"; the partner's still its own: a lock and the seconds left)
  function chestMarks(ST, GT, W, T, lab) {
    let n = 0;
    for (const c of ST.chests) {
      if (c.o === undefined || n >= 4) continue;
      const own = ST.ps[c.o];
      if (!own || own.gone || own.out) continue;
      const mine = c.o === ST.p.i,
        shut = !SIM.chestFor(ST, c, ST.p);
      if (!mine && !shut) continue;
      const [hx, hy] = S.hudPt(sx(c.x) * ZM, (sy(c.y) - c.z - 104) * ZM);
      if (hx < -80 || hx > W + 80 || hy < -40 || hy > H + 40) continue;
      const txt = mine
        ? T('coop.chestMine')
        : T('coop.chestMate', { s: Math.ceil(D.COOP.lock - (c.lt === undefined ? 0 : ST.t - c.lt)) });
      const fo = { size: 17, font: FONT, weight: '800' },
        tw = L.labelW('chm' + n, txt, fo),
        w = tw + (mine ? 24 : 46),
        x = hx - w / 2;
      panel(
        'chmp' + n,
        x,
        hy - 15,
        w,
        30,
        9,
        mine
          ? { edge: [0.55, 0.38, 0.05], rimc: [1, 0.85, 0.3], bw: 2 }
          : { edge: [0.16, 0.2, 0.3], rimc: [0.55, 0.68, 0.9], bw: 2 },
      );
      if (!mine) {
        icon('x_lock', x + 8, hy - 11, 22, 22, 0.95);
        B.flush(B.S, 'spr');
      }
      lab('chm' + n, txt, x + (mine ? 12 : 34), hy + 1, {
        size: 17,
        weight: '800',
        col: mine ? '#ffd23a' : '#c9d8f5',
        al: 0,
      });
      n++;
    }
  }
  // ---- a mission run's task (SIM.goal): its line on a plaque under the timer (GOAL, the words, the progress: a
  // group's dead of all, a hold's time to go), dropping in as each task begins; and its arrow: at the screen's edge
  // while the target is out of view (on a dark ringed badge), a chevron bobbing over it once it is in view
  const GOAL_C = [1, 0.62, 0.18],
    INK = [0.06, 0.03, 0.01];
  // a chevron pointing along an, s times the edge arrows' size; first its dark shadow (it reads on bright ground too)
  const chev = (x, y, an, c, al, s) => {
    for (const [col, o, k] of [
      [INK, 3 * s, 0.55],
      [c, 0, 1],
    ])
      for (const sd of [-1, 1])
        B.fx(
          7,
          x + o * 0.6 + (Math.cos(an) * 10 + sd * Math.sin(an) * 8) * s,
          y + o + (Math.sin(an) * 10 - sd * Math.cos(an) * 8) * s,
          14 * s,
          5 * s,
          an + sd * 0.7,
          col[0],
          col[1],
          col[2],
          al * k,
          3,
          0,
          1,
        );
  };
  function missionGoal(ST, GT, W, T, lab, g) {
    const a = SS(0, 0.35, GT - ST.mis.t0),
      gk = T('task.goal'),
      gl = T(g.key),
      pr = g.k === 'kill' && g.of > 1 ? g.n + '/' + g.of : g.k === 'hold' ? mmss(Math.ceil(g.left)) : '';
    const wk = L.labelW('goalk', gk, { size: 18, font: FONT, weight: '800' }),
      wl = L.labelW('goall', gl, { size: 26, font: FONT, weight: '700' }),
      wp = pr ? L.labelW('goalr', pr, { size: 26, font: FONT, weight: '800' }) : 0;
    const w = 24 + wk + 14 + wl + (pr ? 24 + wp : 0) + 24,
      x = W / 2 - w / 2,
      y = (g.y || 76) - (1 - a) * 18;
    // (bare: the arrow alone — the base says its goal in the page's tracker and banners, hub.js)
    if (!g.bare) {
      panel('goalp', x, y, w, 48, 12, { edge: [0.55, 0.3, 0.06], rimc: [1, 0.72, 0.3], a: 0.96 * a });
      lab('goalk', gk, x + 24, y + 25, { size: 18, col: '#ffb43a', a, al: 0, weight: '800' });
      lab('goall', gl, x + 38 + wk, y + 25, { size: 26, col: '#ffffff', a, al: 0 });
      if (pr) lab('goalr', pr, x + w - 24, y + 25, { size: 26, col: '#7ff0ff', a, al: 1, weight: '800' });
    }
    if (!g.at) return;
    // (a place: just over the ground; a pickup: over its picture; a zombie: over its head)
    const lift = g.lift || (g.k === 'reach' ? 30 : g.k === 'take' || g.pk ? 70 : 150),
      [hx, hy] = S.hudPt(sx(g.at[0]) * ZM, (sy(g.at[1]) - lift) * ZM),
      pulse = 0.82 + 0.18 * Math.sin(GT * 8);
    if (hx < 40 || hx > W - 40 || hy < 40 || hy > H - 40) {
      // out of view: a double chevron at the screen's edge, the way to it
      const dx = hx - W / 2,
        dy = hy - H / 2,
        k = Math.min((W / 2 - 90) / Math.abs(dx || 1e-3), (H / 2 - 120) / Math.abs(dy || 1e-3)),
        ax = W / 2 + dx * k,
        ay = Math.max(H / 2 + dy * k, g.bare ? 150 : y + 48 + 60), // (never over the goal's plaque, nor the base's top row)
        an = Math.atan2(dy, dx),
        push = Math.sin(GT * 6) * 5;
      // (on a dark badge with the goal's ring: it reads over any ground)
      B.fx(0, ax, ay, 104, 104, 0, GOAL_C[0], GOAL_C[1], GOAL_C[2], 0.36 * pulse, 2, 0, 0);
      B.fx(5, ax, ay, 46, 46, 0, INK[0], INK[1], INK[2], 0.62, 3, 0, 1);
      B.fx(4, ax, ay, 44, 44, 0, GOAL_C[0], GOAL_C[1], GOAL_C[2], 0.9 * pulse, 0.07, 0, 1);
      chev(ax - Math.cos(an) * (24 - push), ay - Math.sin(an) * (24 - push), an, GOAL_C, 0.6 * pulse, 1.4);
      chev(ax - Math.cos(an) * (8 - push), ay - Math.sin(an) * (8 - push), an, GOAL_C, pulse, 1.4);
      return;
    }
    // in view: a double chevron bobbing over it
    const bob = Math.sin(GT * 4.5) * 9;
    B.fx(0, hx, hy - 40 + bob, 76, 76, 0, GOAL_C[0], GOAL_C[1], GOAL_C[2], 0.32 * pulse, 2, 0, 0);
    chev(hx, hy - 62 + bob, Math.PI / 2, GOAL_C, 0.6 * pulse, 1.6);
    chev(hx, hy - 38 + bob, Math.PI / 2, GOAL_C, pulse, 1.6);
  }
  // ---- NEAR Base (S.hub): no run HUD (no timer, levels or weapons); each spot's name on a plaque over its furniture
  // (live/hub.js HUB.spots: the one the hero stands by lit up, a locked one greyed). The prompt and the panels are the
  // page's
  function hubHud(ST, GT, W) {
    const T = (k, v) => I18N.t(k, v, ST.lang),
      lab = (slot, s, x, y, o) => L.label(slot, s, x, y, { font: FONT, weight: '800', out: '', ...o });
    const GREY = { c0: [0.12, 0.13, 0.15], c1: [0.07, 0.08, 0.1], edge: [0.2, 0.22, 0.26], rim: 0.35, a: 0.85 },
      LIT = { edge: [0.85, 0.5, 0.1], rimc: [1, 0.78, 0.3] },
      JUNK = { c0: [0.2, 0.15, 0.06], c1: [0.12, 0.09, 0.03], edge: [0.75, 0.55, 0.18], rimc: [1, 0.8, 0.35], a: 0.92 }, // (a heap of junk to clear)
      SICK = { c0: [0.12, 0.24, 0.06], c1: [0.06, 0.14, 0.03], edge: [0.36, 0.7, 0.14], rimc: [0.62, 1, 0.3], a: 0.92 };
    for (const s of window.HUB && HUB.spots ? HUB.spots(ST) : []) {
      const o = s.prop,
        R = B.R[o.n],
        h = NPC3D[o.n] ? npcH(SIM.level(ST.seed), NPC3D[o.n]) * 1.05 : R ? (o.w * R.h) / R.w : 120, // (a person: the model's height)
        [hx, hy] = S.hudPt(sx(o.x) * ZM, (sy(o.y) - h * 0.78 - 24) * ZM);
      // (a name gone up under the page's top row fades out: it never sits over the buttons, hub.js)
      const fa = Math.max(0, Math.min(1, (hy - 150) / 50));
      if (hx < -200 || hx > W + 200 || fa <= 0 || hy > H + 60) continue;
      const nm = s.name || T('hub.spot.' + s.id),
        size = s.near ? 25 : 20,
        w = L.labelW('hubn' + s.id, nm, { size, font: FONT, weight: '800' }) + 34,
        look = s.near ? LIT : s.lock ? GREY : s.gear ? JUNK : { a: 0.9 };
      panel('hubp' + s.id, hx - w / 2, hy - 19, w, 38, 10, { ...look, a: (look.a ?? 0.96) * fa });
      lab('hubn' + s.id, nm, hx, hy, { size, col: s.lock && !s.near ? '#9aa3ad' : '#ffffff', al: 0.5, a: fa });
    }
    // Copper infected (live/hub.js H.infected: mission 2 won, mission 3 not yet): a sickly green tag over his head
    if (window.HUB && HUB.infected && HUB.infected()) {
      const nm = T('hub.infected'),
        [hx, hy] = S.hudPt(sx(ST.p.x) * ZM, (sy(ST.p.y) - 150) * ZM),
        w = L.labelW('hubinf', nm, { size: 18, font: FONT, weight: '800' }) + 30;
      panel('hubinf', hx - w / 2, hy - 16, w, 32, 9, SICK);
      lab('hubinf', nm, hx, hy, { size: 18, col: '#c9ff7a', al: 0.5 });
    }
    // the base's goal (live/hub.js H.goal: walk up to Walt, sell him the cleaver, the next mission from Nova), drawn
    // as a mission's
    const g = window.HUB && HUB.goal ? HUB.goal(ST) : null;
    if (g) missionGoal({ mis: { t0: g.t0 } }, GT, W, T, lab, g);
    B.flush(B.F, 'fx');
  }
  // (W: the HUD's width — the view's, or the safe rectangle's above; world and touch points come in through S.hudPt)
  const HINT_T = 7; // a mission's hint at the perk bar stays this long (s)
  function hud(ST, GT, t, W) {
    const p = ST.p,
      lab = (slot, s, x, y, o) => L.label(slot, s, x, y, { font: FONT, weight: '700', out: '', ...o });
    const T = (k, v) => I18N.t(k, v, ST.lang); // ST.lang: a QA state drawn in another language
    const bx = 200,
      bw = 234,
      tw = 172,
      tx = W / 2 - tw / 2;
    const SW = 100,
      SH = 70,
      gap = 12,
      n = 1 + D.MAX_ITEMS,
      total = n * SW + (n - 1) * gap,
      x0 = W / 2 - total / 2,
      y0 = 966;
    const slots = [{ icon: 'i_' + p.main.id, lvl: p.main.lvl, main: true, evo: p.main.evo }];
    for (const it of p.items) if (D.ITEMS[it.id]) slots.push({ icon: D.ITEMS[it.id].icon, lvl: it.lvl, evo: it.evo });
    while (slots.length < n) slots.push(null);
    const w = p.main,
      ms = w.cap === undefined ? SIM.mainStats(ST).mag : w.cap,
      ammo = w.cap === undefined ? ms : w.ammo,
      rel = w.rl > 0;
    const kr = W - 168; // (from the right edge: a wider view keeps them in its corner)
    const mate = mateOf(ST),
      mk = mate ? mateKey(mate, T) : '';
    const still = () => {
      // ---- top left: LVL + HP + XP ----
      panel('stats', 52, 42, 396, 68, 12);
      L.solid(150, 52, 2, 48, RIM, 0, 0, 0, 0.55);
      lab('lvlw', T('hud.lvl'), 68, 82, { size: 21, col: '#e4ecff', al: 0 });
      lab('lvl', String(p.lvl), 108, 78, { size: 36, col: '#ffffff', al: 0 });
      lab('hpw', T('hud.hp'), 164, 61, { size: 18, col: '#ffffff', al: 0 });
      lab('xpw', T('hud.xp'), 164, 90, { size: 18, col: '#7ff0ff', al: 0 });
      L.rrect(bx, 52, bw, 19, 3, [0.02, 0.04, 0.1], [0.02, 0.04, 0.1], 1);
      L.rrect(bx, 81, bw, 19, 3, [0.02, 0.04, 0.1], [0.02, 0.04, 0.1], 1);
      // ---- top centre: the timer only ----
      panel('timer', tx, 17, tw, 46, 14, { pad: 3 });
      // ---- bottom centre: the main gun (gold) and D.MAX_ITEMS slots for the extra weapons and passives ----
      const TEAL0 = [0.04, 0.2, 0.28],
        TEAL1 = [0.02, 0.1, 0.17];
      slots.forEach((s, i) => {
        const x = x0 + i * (SW + gap),
          y = y0,
          main = s && s.main,
          evo = s && s.evo,
          lock = s && s.lock;
        cham(x, y, SW, SH, 10, {
          c0: lock || !s ? [0.04, 0.07, 0.13] : TEAL0,
          c1: lock || !s ? [0.03, 0.05, 0.1] : TEAL1,
          edge: main
            ? [0.95, 0.72, 0.12]
            : evo
              ? [0.95, 0.5, 0.1]
              : lock || !s
                ? [0.08, 0.13, 0.22]
                : [0.05, 0.3, 0.42],
          rimc: main ? [1, 0.92, 0.35] : evo ? [1, 0.7, 0.25] : [0.25, 0.85, 0.95],
          rim: lock || !s ? 0.25 : 1,
          bw: main ? 4 : 3,
        });
        L.uiBox('slot' + i, x, y, SW, SH, 0);
      });
      slots.forEach((s, i) => {
        const x = x0 + i * (SW + gap),
          y = y0;
        if (!s) return;
        if (s.lock) icon('x_lock', x + SW / 2 - 15, y + 10, 30, 30, 0.5);
        else icon(s.icon, x + 10, y + 5, SW - 20, SH - 10, s.main && rel ? 0.45 : 1);
      });
      B.flush(B.S, 'spr');
      slots.forEach((s, i) => {
        const x = x0 + i * (SW + gap),
          y = y0;
        if (!s) return;
        if (s.lock) {
          lab('lock' + i, T('common.soon'), x + SW / 2, y + SH - 15, { size: 15, col: '#8fa0bc', al: 0.5 });
          return;
        }
        const bxd = x + 14,
          byd = y + SH - 12; // diamond level badges
        cham(bxd - 15, byd - 15, 30, 30, 15, {
          c0: s.main ? [1, 0.9, 0.35] : [1, 1, 1],
          c1: s.main ? [0.95, 0.68, 0.1] : [0.82, 0.88, 0.95],
          edge: [0.05, 0.08, 0.16],
          rim: 0,
          bw: 2.5,
        });
        L.uiBox('badge' + i, bxd - 15, byd - 15, 30, 30, 0);
        lab('lv' + i, s.evo ? '★' : String(s.lvl), bxd, byd + 1, {
          size: 18,
          col: s.main ? '#3a1d00' : '#0e1a33',
          al: 0.5,
        });
      });
      // ---- bottom right: kills and coins ----
      panel('kills', kr, 970, 140, 40, 10);
      icon('x_skull', kr + 98, 974, 32, 32);
      panel('coins', kr, 1018, 140, 40, 10);
      icon('pk_coin', kr + 98, 1022, 32, 32);
      B.flush(B.S, 'spr');
      if (mate) mateStill(mate, T, lab);
      // touch: pause button
      if (window.__touch) {
        panel('pausebtn', W - 110, 34, 70, 70, 16);
        L.solid(W - 88, 52, 9, 34, [1, 1, 1], 0, 0, 0, 0.95);
        L.solid(W - 70, 52, 9, 34, [1, 1, 1], 0, 0, 0, 0.95);
        L.uiBox('pausei', W - 110, 34, 70, 70, 0);
      }
    };
    if (OFFLINE) still();
    else {
      const key = [
        W,
        G.PW,
        G.PH,
        T('hud.lvl'),
        T('hud.xp'),
        T('common.soon'),
        p.lvl,
        rel ? 1 : 0,
        window.__touch ? 1 : 0,
        slots.map((s) => (s ? s.icon + s.lvl + (s.evo ? '*' : '') : '-')).join(','),
        mk,
      ].join('|');
      const pw = HX.on ? Math.round((W * HX.k * G.PW) / G.W) : G.PW,
        ph = HX.on ? Math.round((H * HX.k * G.PH) / G.H) : G.PH; // (the safe rectangle's buffer px)
      if (!HUDC || HUDC.w !== pw || HUDC.h !== ph || HUDC.vw !== W) {
        G.free(HUDC);
        HUDC = G.target(pw, ph, false, { view: [W, H] });
        HUDK = '';
      }
      if (key !== HUDK) {
        B.flush(B.S, 'spr');
        B.flush(B.F, 'fx');
        const back = G.current();
        G.bind(HUDC, [0, 0, 0, 0]);
        G.blend();
        still();
        G.bind(back);
        HUDK = key;
      }
      G.blend();
      G.full(L.P.copy, { u_src: HUDC });
    }
    // ---- the live parts: the HP and XP bars, the timer, the ammo, the counts ----
    const hk = clamp(p.hp / p.maxHp, 0, 1);
    if (hk > 0) L.rrect(bx + 2, 54, (bw - 4) * hk, 15, 2, [1, 0.3, 0.33], [0.82, 0.08, 0.12], 1);
    const xk = clamp(p.xp / p.need, 0, 1),
      seg = 2,
      sw = (bw - 4) / seg;
    for (let i = 0; i < seg; i++) {
      const f = clamp(xk * seg - i, 0, 1);
      if (f > 0)
        L.rrect(
          bx + 2 + i * sw,
          83,
          sw * f - (f >= 1 ? 3 : 0),
          15,
          2,
          [0.42, 0.95, 1],
          [0.1, 0.68, 0.9],
          GT - ST.xpFlash < 0.15 ? 1 : 0.95,
        );
    }
    lab('timer', mmss(ST.t), W / 2, 41, { size: 33, col: '#ffffff', al: 0.5 });
    if (mate) mateLive(ST, GT, mate, T, lab);
    if (ms) {
      const bx = x0 + 3,
        bw = SW - 6,
        by = y0 - 11,
        bh = 6;
      L.rrect(bx - 2, by - 2, bw + 4, bh + 4, 3, [0.02, 0.04, 0.1], [0.02, 0.04, 0.1], 0.85);
      if (rel) {
        const k = clamp(1 - w.rl / (w.rlT || 1), 0, 1);
        if (k > 0) L.rrect(bx, by, bw * k, bh, 2, [1, 0.62, 0.2], [0.85, 0.36, 0.06], 1);
      } else if (ms <= 16) {
        const gp = 2,
          pw = (bw - gp * (ms - 1)) / ms;
        for (let j = 0; j < ms; j++)
          L.rrect(
            bx + j * (pw + gp),
            by,
            pw,
            bh,
            1.5,
            j < ammo ? [1, 0.9, 0.45] : [0.16, 0.2, 0.3],
            j < ammo ? [0.9, 0.66, 0.15] : [0.12, 0.15, 0.24],
            1,
          );
      } else {
        const k = clamp(ammo / ms, 0, 1);
        L.rrect(bx, by, bw, bh, 2, [0.16, 0.2, 0.3], [0.12, 0.15, 0.24], 1);
        if (k > 0) L.rrect(bx, by, bw * k, bh, 2, [1, 0.9, 0.45], [0.9, 0.66, 0.15], 1);
      }
      if (!rel)
        lab('ammo', String(ammo), x0 + SW - 9, y0 + SH - 12, {
          size: 20,
          col: ammo <= ms / 4 ? '#ff7a5a' : '#ffffff',
          al: 1,
        });
    }
    lab('kills', String(ST.kills), kr + 54, 990, { size: 26, col: '#ffffff', al: 0.5 });
    lab('coins', String(ST.coins), kr + 54, 1038, {
      size: 26,
      col: GT - ST.coinFlash < 0.2 ? '#ffe680' : '#ffffff',
      al: 0.5,
    });
    // ---- boss bar above the slots ----
    const boss = ST.en.find((e) => e.id === ST.boss && !e.dead);
    if (boss) {
      const bw2 = 640,
        bx2 = W / 2 - bw2 / 2,
        by = 926,
        k = clamp(boss.hp / boss.max, 0, 1);
      cham(bx2, by, bw2, 22, 6, { edge: [0.45, 0.08, 0.06], rimc: [1, 0.45, 0.3], rim: 0.6, bw: 2 });
      L.uiBox('bossbar', bx2, by, bw2, 22, 0);
      L.rrect(bx2 + 5, by + 5, (bw2 - 10) * k, 12, 3, [1, 0.3, 0.25], [0.72, 0.05, 0.05], 1);
      // a final boss's phases marked on it (the Devourer has one, at half his health)
      if (D.ENEMIES[boss.k].boss === 'boss')
        for (const m of boss.k === 'heart' ? [SIM.HEART.core.from] : [0.66, 0.33])
          L.solid(bx2 + 5 + (bw2 - 10) * m, by + 4, 2, 14, [1, 0.9, 0.6], 0, 0, 0, 0.8);
      const bn = T('bosses.' + boss.k),
        nw = L.labelW('bossname', bn, { size: 18, font: FONT, weight: '700' });
      panel('bossnamep', W / 2 - nw / 2 - 16, by - 28, nw + 32, 26, 8, {
        edge: [0.45, 0.08, 0.06],
        rimc: [1, 0.45, 0.3],
        rim: 0.6,
        bw: 2,
      });
      lab('bossname', bn, W / 2, by - 15, { size: 18, col: '#ffd0c8', al: 0.5 });
    }
    // ---- a mission's hint at the perk bar (sim.js S.mis.hint, for HINT_T s): 'perkbar' frames the bar; 'pair' frames
    // the item and its partner (D.EVOS) in gold. No words: Nova says them, her subtitle over that spot ----
    const hint = ST.mis && ST.mis.hint;
    if (hint && GT - hint.t < HINT_T && !boss) {
      const a = GT - hint.t,
        al = SS(0, 0.25, a) * (1 - SS(HINT_T - 0.7, HINT_T, a)),
        glow = al * (0.55 + 0.45 * Math.sin(a * 5) ** 2),
        fx = (i) => x0 + i * (SW + gap);
      // a frame round slots i0..i1, 4 px a side, 6 px out
      const frame = (i0, i1, c0, c1) => {
        const x = fx(i0) - 7,
          w = fx(i1) + SW - fx(i0) + 14,
          y = y0 - 7,
          h = SH + 14;
        L.rrect(x, y, w, 4, 2, c0, c1, glow);
        L.rrect(x, y + h - 4, w, 4, 2, c0, c1, glow);
        L.rrect(x, y, 4, h, 2, c0, c1, glow);
        L.rrect(x + w - 4, y, 4, h, 2, c0, c1, glow);
      };
      if (hint.id === 'perkbar') {
        const last = slots.reduce((m, sl, i) => (sl && !sl.lock ? i : m), 0);
        frame(0, last, [0.5, 0.95, 1], [0.2, 0.75, 0.95]);
      } else if (hint.id === 'pair' && D.EVOS[hint.item] && D.ITEMS[hint.item]) {
        const e = D.EVOS[hint.item],
          at = (id) => slots.findIndex((sl) => sl && !sl.main && sl.icon === D.ITEMS[id].icon);
        for (const i of [at(hint.item), at(e.with)]) if (i > 0) frame(i, i, [1, 0.88, 0.35], [0.95, 0.6, 0.1]);
      }
    }
    // ---- combo plaques: slide in from the right, hold 1.5 s ----
    ST.ban.forEach((b, i) => {
      const a = GT - b.t,
        inK = SS(0, 0.2, a),
        outK = SS(1.5, 1.78, a),
        slide = (1 - inK) * 420 + outK * 420,
        alpha = 1 - outK;
      const ti = T(b.ti, b.v),
        sub = T(b.sub, b.v),
        chip = b.chip ? T(b.chip, b.v) : '';
      const mm = /^(.*?)\s*(×\d+)$/.exec(ti),
        title = mm ? mm[1] : ti,
        mult = mm ? mm[2] : '';
      const tW = L.labelW('bant' + i, title, { size: 26, font: FONT, weight: '700' }),
        mW = mult ? L.labelW('banm' + i, mult, { size: 40, font: FONT, weight: '800' }) : 0;
      const sW = L.labelW('bans' + i, sub, { size: 19, font: FONT, weight: '700' });
      const w1 = Math.max(tW + mW + 104, sW + 100, 300),
        x = W - 198 - w1 + slide,
        y = 382 + i * 120;
      panel('ban' + i, x, y, w1, 74, 12, { edge: [0.85, 0.6, 0.1], rimc: [1, 0.85, 0.3], a: 0.96 * alpha, bw: 3 });
      for (let j = 0; j < 8; j++) {
        const an = (j / 8) * TAU + a * 2;
        B.fx(2, x + 42 + Math.cos(an) * 14, y + 37 + Math.sin(an) * 14, 14, 5, an, 1, 0.65, 0.15, alpha, 3, 0, 0.6);
      }
      B.fx(0, x + 42, y + 37, 24, 24, 0, 1, 0.75, 0.3, alpha, 2, 0, 0.3);
      B.fx(3, x + 42, y + 37, 22, 22, a * 3, 1, 0.95, 0.7, alpha, 3, 0, 0);
      B.flush(B.F, 'fx');
      lab('bant' + i, title, x + 76, y + 27, { size: 26, col: '#ffffff', a: alpha, al: 0 });
      if (mult)
        lab('banm' + i, mult, x + w1 - 14, y + 30, { size: 40, col: '#ffd23a', a: alpha, al: 1, weight: '800' });
      lab('bans' + i, sub, x + 76, y + 55, { size: 19, col: b.col || '#ffcf3a', a: alpha, al: 0 });
      if (chip) {
        const cw = L.labelW('banc' + i, chip, { size: 20, font: FONT, weight: '700' }) + 56;
        panel('banchip' + i, x + 76, y + 80, cw, 32, 10, { a: alpha, bw: 2 });
        B.fx(0, x + 96, y + 96, 11, 11, 0, 0.35, 0.85, 1, alpha, 1.2, 0, 1);
        B.fx(4, x + 96, y + 96, 11, 11, 0, 0.8, 0.95, 1, alpha, 0.1, 0, 1);
        B.flush(B.F, 'fx');
        lab('banc' + i, chip, x + 76 + 30 + (cw - 30) / 2, y + 96, { size: 20, col: '#ffffff', a: alpha, al: 0.5 });
      }
    });
    // ---- the lab's gas (SIM.gasZone): its line under the timer (under a mission's task when there is one), in the evac
    // countdown's green — what the gas does next and when, a bar filling toward it; the warnings below it ----
    const goal = ST.mis ? SIM.goal(ST) : null,
      GZ = ST.winAt ? null : SIM.gasZone(ST, SIM.level(ST.seed));
    let bannerY = 150;
    if (GZ && GZ.ph !== 'held') {
      const mv = GZ.ph === 'move',
        left = Math.max(0, Math.ceil(GZ.left)),
        gt = T(mv ? 'hud.gasMoves' : GZ.ph === 'warn' ? 'hud.gasSoon' : 'hud.gasNext', {
          t: Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'),
        }),
        gw = L.labelW('gasl', gt, { size: 25, font: FONT, weight: '800' }) + 64,
        gy = goal ? (goal.y || 76) + 56 : 76,
        gx = W / 2 - gw / 2,
        pl = mv ? 0.88 + 0.12 * Math.sin(GT * 6) : 1;
      panel('gasp', gx, gy, gw, 46, 12, {
        c0: [0.08, 0.22, 0.1],
        c1: [0.04, 0.12, 0.06],
        edge: [0.2, 0.5 * pl, 0.1],
        rimc: [0.5, 1, 0.35],
        a: 0.95,
      });
      lab('gasl', gt, W / 2, gy + 20, { size: 25, col: mv ? '#eaff7a' : '#c4ffa0', a: pl, al: 0.5, weight: '800' });
      L.rrect(gx + 16, gy + 35, gw - 32, 4, 2, [0.02, 0.06, 0.03], [0.02, 0.06, 0.03], 0.9);
      L.rrect(gx + 16, gy + 35, (gw - 32) * clamp(GZ.k, 0, 1), 4, 2, [0.62, 1, 0.3], [0.36, 0.9, 0.2], 1);
      if (goal) bannerY = gy + 60;
    }
    // ---- warnings and edge arrows ----
    if (ST.warn) {
      const a = GT - ST.warn.t,
        al = SS(0, 0.15, a) * (1 - SS(2.4, 3, a)),
        pulse = 1 + 0.04 * Math.sin(a * 12);
      const wt = T(ST.warn.text, ST.warn.v),
        ww = L.labelW('warn', wt, { size: 40, font: FONT, weight: '800' }) + 70;
      panel('warnp', W / 2 - ww / 2, bannerY, ww, 62, 14, { edge: [0.5, 0.08, 0.05], rimc: [1, 0.4, 0.3], a: al });
      lab('warn', wt, W / 2, bannerY + 31, {
        size: 40,
        scale: pulse,
        col: ST.warn.col || '#ff5a4a',
        a: al,
        al: 0.5,
        weight: '800',
      });
    }
    const arrow = (wx, wy, col) => {
      const [x, y] = S.hudPt((wx - camX) * ZM, (wy - camY) * ZM);
      if (x > 40 && x < W - 40 && y > 40 && y < H - 40) return;
      const cx = W / 2,
        cy = H / 2,
        dx = x - cx,
        dy = y - cy,
        k = Math.min((W / 2 - 70) / Math.abs(dx || 1e-3), (H / 2 - 90) / Math.abs(dy || 1e-3));
      const ax = cx + dx * k,
        ay = cy + dy * k,
        an = Math.atan2(dy, dx);
      const pulse = 0.75 + 0.25 * Math.sin(GT * 8);
      B.fx(0, ax, ay, 46, 46, 0, col[0], col[1], col[2], 0.5 * pulse, 2, 0, 0);
      for (let j = 0; j < 3; j++)
        B.fx(
          7,
          ax - Math.cos(an) * j * 9,
          ay - Math.sin(an) * j * 9,
          14 - j * 3,
          4,
          an,
          col[0],
          col[1],
          col[2],
          pulse,
          3,
          0,
          1,
        );
      B.fx(
        7,
        ax + Math.cos(an) * 10 - Math.sin(an) * 8,
        ay + Math.sin(an) * 10 + Math.cos(an) * 8,
        12,
        4,
        an - 0.7,
        col[0],
        col[1],
        col[2],
        pulse,
        3,
        0,
        1,
      );
      B.fx(
        7,
        ax + Math.cos(an) * 10 + Math.sin(an) * 8,
        ay + Math.sin(an) * 10 - Math.cos(an) * 8,
        12,
        4,
        an + 0.7,
        col[0],
        col[1],
        col[2],
        pulse,
        3,
        0,
        1,
      );
    };
    if (boss) arrow(boss.x, boss.y - 80, [1, 0.25, 0.2]);
    for (const c of ST.chests) arrow(c.x, c.y, SIM.chestFor(ST, c, ST.p) ? [1, 0.85, 0.25] : [0.55, 0.68, 0.9]);
    if (goal) missionGoal(ST, GT, W, T, lab, goal);
    // playing together: the partner — an arrow at the edge when out of view (red: down), its name and health over its head, and over a
    // hero down a call to come and get it up
    if (ST.ps && ST.ps.length > 1) {
      const names = window.GAME && GAME.coopRun ? GAME.coopRun.names : null;
      for (const o of ST.ps) {
        if (o === ST.p || o.gone || o.out) continue;
        arrow(o.x, o.y - 40, o.down ? [1, 0.3, 0.25] : [0.35, 1, 0.5]);
        const [hx, hy] = S.hudPt(sx(o.x) * ZM, (sy(o.y) - HERO3D.H * 1.12) * ZM);
        if (hx < -60 || hx > W + 60 || hy < -40 || hy > H + 60) continue;
        const nm = names && names[o.i] ? names[o.i].nick : '';
        if (nm)
          lab('mate' + o.i, nm, hx, hy - 18, { size: 22, col: o.down ? '#ff8a7a' : '#b9f5c3', al: 0.5, weight: '800' });
        if (!o.down) {
          const k = clamp(o.hp / o.maxHp, 0, 1);
          B.fx(7, hx, hy + 4, 34, 4.5, 0, 0.05, 0.06, 0.08, 0.85, 3, 0, 1);
          B.fx(7, hx - 33 * (1 - k), hy + 4, 33 * k, 3.2, 0, 1 - k * 0.7, 0.35 + 0.6 * k, 0.25, 1, 3, 0, 1);
        } else
          lab('rv' + o.i, T('coop.revive'), hx, hy + 8, {
            size: 26,
            col: '#ffffff',
            al: 0.5,
            weight: '900',
            scale: 1 + 0.06 * Math.sin(GT * 8),
          });
      }
      B.flush(B.F, 'fx');
      chestMarks(ST, GT, W, T, lab);
      B.flush(B.S, 'spr');
      coopCall(ST, GT, W, T, lab);
    }
    if (ST.horde && !ST.horde.done) {
      const a = ST.horde.a;
      arrow(
        ST.cam[0] + HX.vw / ZM / 2 + Math.cos(a) * 3000,
        ST.cam[1] + H / ZM / 2 + Math.sin(a) * 3000,
        [1, 0.35, 0.15],
      );
    } // (the world's centre on screen: the whole view's)
    // (the lab's gas, from its warning: the way to the hall's middle while the hero stands outside the circle it closes to next)
    if (GZ && SIM.m2(ST.p.x - GZ.x, ST.p.y - GZ.y) > GZ.next * GZ.next) arrow(GZ.x, GZ.y, [0.62, 1, 0.24]);
    B.flush(B.F, 'fx');
    if (ST.horde && !ST.horde.done) {
      const a = ST.horde.a,
        cx = W / 2 + Math.cos(a) * (W / 2 - 180),
        cy = H / 2 + Math.sin(a) * (H / 2 - 150);
      const w = L.labelW('horde', T('hud.horde'), { size: 28, font: FONT, weight: '800' }) + 40;
      panel('hordep', cx - w / 2, cy - 22, w, 44, 12, { edge: [0.5, 0.12, 0.05], rimc: [1, 0.5, 0.25] });
      lab('horde', T('hud.horde'), cx, cy, { size: 28, col: '#ffb070', al: 0.5, weight: '800' });
    }
    // the touch sticks (index.html): left walks, right aims and fires while pushed. Each where a thumb holds it, else in its corner a
    // little fainter: a dark base, its rim, the knob — arrows on the walking one, a sight on the aiming one
    if (window.__touch && !ST.pause && !ST.over) {
      const R = (window.__stickR || 120) / HX.k; // (a held stick: where the thumb is, view px → the HUD's)
      const bar = (x, y, l, an, c, a) => B.fx(7, x, y, l, 3.2, an, c[0], c[1], c[2], a, 3, 0, 1);
      const stick = (J, hx, hy, c, aim) => {
        const on = J && J.on,
          [bx, by] = on ? S.hudPt(J.bx, J.by) : [hx, hy],
          [kx, ky] = on ? S.hudPt(J.kx, J.ky) : [hx, hy],
          a = on ? 1 : 0.62;
        B.fx(5, bx, by, R * 1.12, R * 1.12, 0, 0.02, 0.03, 0.06, 0.34 * a, 3, 0, 1);
        B.fx(4, bx, by, R, R, 0, c[0], c[1], c[2], 0.6 * a, 0.045, 0, 1);
        if (!aim)
          for (let i = 0; i < 4; i++) {
            const an = (i * Math.PI) / 2,
              x = bx + Math.cos(an) * R * 0.72,
              y = by + Math.sin(an) * R * 0.72; // arrows, out
            for (const sd of [-1, 1]) {
              const b = an + Math.PI + sd * 0.8;
              bar(x + Math.cos(b) * 7, y + Math.sin(b) * 7, 9, b, c, 0.55 * a);
            }
          }
        B.fx(5, kx, ky, R * 0.5, R * 0.5, 0, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0.5 * a, 3, 0, 1);
        B.fx(4, kx, ky, R * 0.44, R * 0.44, 0, c[0], c[1], c[2], 0.85 * a, 0.1, 0, 1);
        if (aim)
          for (let i = 0; i < 4; i++) {
            const an = (i * Math.PI) / 2;
            bar(kx + Math.cos(an) * R * 0.2, ky + Math.sin(an) * R * 0.2, 7, an, c, 0.9 * a);
          }
      }; // a sight
      stick(window.__joy, 250, H - 250, [1, 1, 1], false);
      stick(window.__aim, W - 250, H - 250, [1, 0.62, 0.32], true);
      B.flush(B.F, 'fx');
    }
  }

  // ================================================================== QA hooks
  S.QA = () => {
    const mkS = (o = {}) => {
      const s = SIM.demoState();
      s.demo = false;
      s.zoom = 1;
      Object.assign(s, o);
      return s;
    };
    const states = [];
    // HUD worst cases
    const big = mkS();
    big.t = 599;
    big.kills = 99999;
    big.coins = 99999;
    big.p.lvl = 99;
    big.p.main.lvl = 5;
    for (const id of ['chain', 'grenade', 'saws']) big.p.items.push(SIM.newItem(id, 5));
    big.p.items[0].evo = true;
    big.ban = [
      {
        ti: 'hud.barrel',
        sub: 'hud.elim',
        chip: 'hud.xpGain',
        v: { m: 12, n: 48, xp: 360 },
        col: '#ff9a2a',
        t: big.t - 0.6,
      },
      {
        ti: 'hud.streak',
        sub: 'hud.dontStop',
        chip: 'hud.xpGain',
        v: { m: 500, xp: 500 },
        col: '#ff5a3a',
        t: big.t - 0.6,
      },
    ];
    big.warn = { text: 'hud.timeUp', t: big.t - 0.5, col: '#ff4a3a' };
    const fin = SIM.addEnemy(big, 'golem', big.p.x + 300, big.p.y - 120);
    big.boss = fin.id; // the final boss: the longest boss name
    states.push(['hud_worst', big]);
    for (const lg of I18N.list)
      if (lg !== 'en') {
        const s = Object.assign(SIM.create({ seed: big.seed }), JSON.parse(JSON.stringify(big)), { lang: lg });
        states.push(['hud_worst_' + lg, s]);
      }
    states.push(['match', matchState()]);
    for (const [nm, a] of [
      ['aim_r', 0],
      ['aim_dr', 0.8],
      ['aim_d', 1.57],
      ['aim_dl', 2.4],
      ['aim_l', 3.14],
      ['aim_ul', -2.4],
      ['aim_u', -1.57],
      ['aim_ur', -0.8],
    ]) {
      const s = mkS();
      s.en = [];
      s.p.aim = a;
      s.p.face = Math.cos(a) < 0 ? -1 : 1;
      s.p.main.id = 'minigun';
      states.push([nm, s]);
    }
    const cycles = {},
      cycleT = {},
      subject = {},
      sprites = {},
      boxes = {};
    const parts = (rig) => (RIGS[rig] ? RIGS[rig].parts.map((n) => rig + '__' + n) : []);
    const walkCycle = (k) => {
      const d = D.ENEMIES[k],
        step = S.stepOf(d.rig, d.h),
        fr = [];
      for (let i = 0; i < 12; i++) {
        const s = mkS();
        s.en = [];
        s.p.items = [];
        s.ev = [];
        s.dec = [];
        const e = SIM.addEnemy(s, k, s.p.x - 300, s.p.y + 60);
        const dist = (i / 12) * step * 2;
        e.spT = -9;
        e.vx = d.speed;
        e.vy = 0;
        e.x += dist;
        e.dist = dist;
        e.face = 1;
        s.__qaSubject = e.id;
        s.cam = [Math.round(s.p.x - 300 - W / 2), Math.round(s.p.y + 60 - H / 2 - d.h * 0.4)];
        s.p.x += 2000;
        fr.push(s);
      }
      return fr;
    };
    for (const k of [
      'walker',
      'runner',
      'bloater',
      'armored',
      'spitter',
      'butcher',
      'savage',
      'hazmat',
      'subject',
      'pustule',
      'screamer',
      'tank',
      'golem',
      'heart',
    ].filter((k) => !B3D[D.ENEMIES[k].b3d])) {
      const d = D.ENEMIES[k],
        nm = k + '_walk';
      cycles[nm] = walkCycle(k);
      cycleT[nm] = (S.stepOf(d.rig, d.h) * 2) / d.speed;
      subject[nm] = 'subj';
      sprites[nm] = parts(d.rig);
      boxes[nm] = [W / 2 - d.h * 0.9 - 40, H / 2 - d.h * 0.95, d.h * 1.8 + 80, d.h * 1.4];
    }
    const hstep = 33,
      hc = []; // ground px per step of the hero's walk (QA cycles)
    for (let i = 0; i < 12; i++) {
      const s = mkS();
      s.en = [];
      s.p.items = [];
      s.ev = [];
      const dist = (i / 12) * hstep * 2;
      s.p.vx = 140;
      s.p.vy = 0;
      s.p.x += dist;
      s.p.dist = dist;
      s.p.aim = 0;
      s.p.face = 1;
      s.p.main.firing = false;
      s.cam = [Math.round(s.p.x - dist - W / 2), Math.round(s.p.y - H / 2 - 40)];
      hc.push(s);
    }
    cycles.hero_walk = hc;
    cycleT.hero_walk = (hstep * 2) / 140;
    subject.hero_walk = 'hero';
    sprites.hero_walk = ['hero'];
    boxes.hero_walk = [W / 2 - 160, H / 2 - 120, 420, 220];
    // walking toward / away from the camera is checked in the world by gen/penguin_slide.mjs (on screen a forward foot also moves down)
    // standing references (painted layout = idle stance) for segment lengths and the stance check
    const restOfKind = (k) => {
      const s = mkS();
      s.en = [];
      s.p.items = [];
      s.ev = [];
      const d = D.ENEMIES[k],
        e = SIM.addEnemy(s, k, s.p.x - 300, s.p.y + 60);
      e.spT = -9;
      e.vx = e.vy = 0;
      e.face = 1;
      s.__qaSubject = e.id;
      s.cam = [Math.round(s.p.x - 300 - W / 2), Math.round(s.p.y + 60 - H / 2 - d.h * 0.4)];
      s.p.x += 2000;
      s.neutral = true;
      return s;
    };
    const rest = { walker_walk: restOfKind('walker'), armored_walk: restOfKind('armored') };
    {
      const s = mkS();
      s.en = [];
      s.p.items = [];
      s.ev = [];
      s.p.vx = s.p.vy = 0;
      s.p.main.firing = false;
      s.cam = [Math.round(s.p.x - W / 2), Math.round(s.p.y - H / 2 - 40)];
      s.neutral = true;
      rest.hero_walk = s;
    }
    return {
      rest,
      states,
      cycles,
      cycleT,
      subject,
      sprites,
      actors: [
        'hero',
        'walker',
        'runner',
        'bloater',
        'armored',
        'spitter',
        'butcher',
        'savage',
        'hazmat',
        'subject',
        'pustule',
        'screamer',
        'tank',
        'golem',
        'heart',
      ].filter((k) => k === 'hero' || !B3D[D.ENEMIES[k].b3d]),
      box: (name) => boxes[name] || [0, 0, W, H],
    };
  };
  // the reference's composition restaged (study/MATCH.md): minigun at level 4, two saws, a drone, the tank boss upper right,
  // a barrel chain blowing up to the right, a crowd of walkers/runners and three bloaters, BARREL BLAST ×5, 08:27, LVL 15
  function matchState() {
    const s = SIM.demoState();
    s.demo = false;
    s.zoom = 1;
    s.t = 507.2;
    s.kills = 432;
    s.coins = 0;
    s.p.lvl = 15;
    s.p.hp = s.p.maxHp * 0.82;
    s.p.xp = s.p.need * 0.72;
    s.p.main.id = 'minigun';
    s.p.main.lvl = 4;
    s.p.main.spin = 1;
    s.p.main.firing = true;
    s.p.aim = 0.08;
    s.p.face = 1;
    s.p.items = [
      SIM.newItem('saws', 2),
      SIM.newItem('drone', 2),
      SIM.newItem('chain', 1),
      SIM.newItem('grenade', 1),
      SIM.newItem('medkit', 1),
    ];
    s.p.items[0].ang = 2.6;
    s.p.items[1].dr = [{ x: s.p.x + 70, y: s.p.y - 50, cd: 0, aim: 0.2, ph: 1 }];
    const P = [s.p.x, s.p.y],
      K = 1920 / 1672;
    const at = (rx, ry) => [P[0] + (rx - 752) * K, P[1] + (ry - 522) * K];
    s.cam = [P[0] - 752 * K, P[1] - 522 * K];
    s.en = [];
    const Z = [
      ['walker', 330, 225],
      ['walker', 410, 250],
      ['runner', 495, 255],
      ['walker', 315, 330],
      ['walker', 395, 340],
      ['walker', 500, 400],
      ['runner', 590, 330],
      ['walker', 730, 180],
      ['runner', 945, 330],
      ['walker', 1090, 450],
      ['runner', 1110, 470],
      ['walker', 1480, 490],
      ['walker', 1490, 610],
      ['runner', 1600, 520],
      ['walker', 1180, 640],
      ['walker', 880, 640],
      ['walker', 260, 600],
      ['walker', 365, 660],
      ['runner', 160, 640],
      ['walker', 520, 720],
      ['walker', 1240, 820],
      ['walker', 1100, 790],
      ['walker', 1640, 650],
      ['walker', 1430, 920],
      ['runner', 1050, 515],
      ['walker', 1020, 580],
      ['bloater', 865, 230],
      ['bloater', 90, 590],
      ['bloater', 1495, 830],
      ['walker', 1300, 380],
      ['walker', 1360, 470],
      ['walker', 240, 180],
      ['runner', 480, 160],
      ['walker', 640, 260],
      ['walker', 1000, 240],
      ['walker', 1560, 420],
      ['runner', 1620, 330],
      ['walker', 1410, 560],
      ['walker', 1250, 520],
      ['walker', 170, 470],
      ['walker', 300, 520],
      ['walker', 640, 620],
      ['runner', 780, 760],
      ['walker', 960, 870],
      ['walker', 1180, 900],
      ['walker', 1340, 700],
      ['walker', 1580, 760],
      ['armored', 1000, 690],
    ];
    for (const [k, rx, ry] of Z) {
      const [x, y] = at(rx, ry);
      const e = SIM.addEnemy(s, k, x, y);
      e.spT = -9;
      const dx = s.p.x - x,
        dy = s.p.y - y,
        m = Math.hypot(dx, dy) || 1;
      e.vx = (dx / m) * e.spd;
      e.vy = (dy / m) * e.spd * 0.75;
      e.face = dx > 0 ? 1 : -1;
      e.dist = (rx * 7 + ry * 3) % 100;
    }
    const [bx, by] = at(1130, 330);
    const b = SIM.addEnemy(s, 'tank', bx, by);
    b.spT = -9;
    b.face = -1;
    b.st = 'chase';
    b.stT = s.t;
    b.hp = b.max * 0.95;
    s.boss = b.id;
    s.ev = [];
    const [ex, ey] = at(1290, 580);
    s.ev.push(
      { k: 'boom', t: s.t - 0.22, x: ex - 30, y: ey + 10, r: 190, kind: 'fire' },
      { k: 'boom', t: s.t - 0.12, x: ex + 40, y: ey - 20, r: 150, kind: 'fire' },
      { k: 'barrel', t: s.t - 0.22, x: ex - 30, y: ey + 10 },
      { k: 'barrel', t: s.t - 0.12, x: ex + 40, y: ey - 20 },
    );
    for (const [rx, ry, k] of [
      [1150, 670, 'walker'],
      [920, 730, 'walker'],
      [1240, 640, 'walker'],
      [600, 830, 'walker'],
    ]) {
      const [x, y] = at(rx, ry);
      s.corpses.push({ x, y, ek: k, f: 1, s: 1, t: s.t - 0.6, el: 0, fd: 1 });
      s.dec.push({ k: 'blood', x, y, s: 1.4, t: s.t - 2, life: 30, r: 1, v: 2 });
    }
    for (let i = 0; i < 36; i++)
      s.ev.push({ k: 'shot', t: s.t - i * 0.055, x: SIM.muzzle(s)[0], y: SIM.muzzle(s)[1], a: 0.08, w: 'minigun' });
    {
      const LV = SIM.level(s.seed);
      for (const i of LV.destr) {
        const o = LV.props[i];
        if (!o.barrel) continue;
        const dx = o.x - (ex - 30),
          dy = o.y - (ey + 10);
        if (dx * dx + 4 * dy * dy < 160 * 160) s.pd[o.di] = 0;
      }
    }
    for (const [rx, ry, k] of [
      [1380, 700, 'walker'],
      [820, 560, 'runner'],
    ]) {
      const [x, y] = at(rx, ry);
      s.corpses.push({ x, y, ek: k, f: -1, s: 1, t: s.t - 0.9, el: 0, fd: -1 });
    }
    s.ev.sort((a, b) => a.t - b.t);
    const m = SIM.muzzle(s);
    for (let i = 0; i < 6; i++)
      s.bul.push({
        x: m[0] + 90 + i * 110 + ((i * 37) % 23),
        y: m[1] + 4 + i * 11 + ((i * 53) % 7) - 3,
        px: 0,
        py: 0,
        vx: 1450,
        vy: 110,
        dmg: 1,
        kind: 0,
        pierce: 0,
        knock: 0,
        life: 1,
        r: 6,
        aoe: 0,
        crit: 0,
        hits: [],
        t0: s.t - 0.1,
      });
    s.ban = [{ ti: 'BARREL BLAST ×5', sub: '5 ELIMINATED', chip: '+125 XP', col: '#ffcf6a', t: s.t - 0.7 }];
    for (const [rx, ry] of [
      [700, 700, 'walker'],
      [1180, 700, 'walker'],
      [1000, 760, 'walker'],
      [1230, 300, 'walker'],
      [1380, 720, 'walker'],
      [820, 580, 'walker'],
      [450, 760, 'walker'],
      [1520, 600, 'walker'],
      [300, 380, 'walker'],
      [560, 300, 'walker'],
      [980, 520, 'walker'],
      [1120, 860, 'walker'],
      [1650, 880, 'walker'],
      [260, 820, 'walker'],
      [700, 420, 'walker'],
      [1420, 380, 'walker'],
      [880, 900, 'walker'],
      [1560, 300, 'walker'],
    ]) {
      const [x, y] = at(rx, ry);
      s.dec.push({ k: 'blood', x, y, s: 1.2, t: s.t - 3, life: 30, r: rx, v: ry % 6 });
    }
    return s;
  }
  S.matchState = matchState;
})();
