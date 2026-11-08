// live/lobby.js — the main menu scene, live: the cat squad's bunker (bg_lobby4, the user's art): the work lamp over the bench hums and
// now and then stutters, the red lamp over the door B-01 pulses and throws its red on the door, the floor and the cat, motes of dust
// drift glowing through the air, and the hero — the 3D cat — stands on the mat holding the selected gun as it does standing and
// aiming, breathing, blinking, looking round. Also the heroes screen: the survivors' camp (fire, sparks, lanterns) and the cat live
// on its pedestal in its card.
// Drawn straight to the screen (none of the world pipeline), in the window's shape; the DOM menu (ui.js) lies on top.
(function () {
  const LB = (window.LOBBY = {});
  const TAU = Math.PI * 2,
    clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
    ss = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  // a sprite that bends: the free end (top of the texture) sways, the root (bottom) stays
  LB.FS_TEX = `uniform sampler2D u_tex; uniform float u_a, u_bend; uniform vec3 u_tint;   // u_t comes from gl.js COMMON
void main(){ vec2 uv = v_uv; float k = 1.0 - uv.y; uv.x += (sin(u_t * 1.6 + uv.y * 2.5) * 0.7 + sin(u_t * 3.7 + uv.x * 4.0) * 0.3) * u_bend * k * k;
  vec4 c = texture(u_tex, uv); o = vec4(c.rgb * u_tint, c.a) * u_a; }`;
  // the menu pages' backdrop: the blurred bunker, toned down to a cool dusk, darker toward the corners
  LB.FS_DIM = `uniform sampler2D u_src; uniform float u_k;
void main(){ vec2 uv = scr(v_px); vec3 c = texture(u_src, uv).rgb; float l = dot(c, vec3(0.3, 0.59, 0.11)); c = mix(vec3(l), c, 0.6) * u_k;
  c *= 1.0 - 0.55 * smoothstep(0.3, 0.85, length((uv - 0.5) * vec2(1.0, 0.85))); o = vec4(c * vec3(0.9, 0.95, 1.15), 1.0); }`;
  // a page change: the scene left behind (a snapshot), fading out over the new one
  LB.FS_FADE = `uniform sampler2D u_src; uniform float u_a;
void main(){ o = vec4(texture(u_src, scr(v_px)).rgb, 1.0) * u_a; }`;

  // the bunker's layout, in the backdrop's own px (1774 × 887): the cat's feet on the mat and its height, the work lamp's bulb and the
  // pool of its light on the pegboard, the ceiling's tube, the red lamp, its red on the door and on the floor
  const LAY = {
    hero: [1112, 724, 505],
    lamp: [733, 168],
    pool: [640, 265],
    tube: [1062, 44],
    red: [1438, 124],
    door: [1440, 330],
    floor: [1432, 652],
  };
  // the backdrop cover-fits the canvas with a slow breathing push-in; a narrow window crops its left (under the menu), keeping the
  // cat and the door
  const fit = (W, H, bg, k = 1.02, right = 0.75) => {
    const sc = Math.max(W / bg.w, H / bg.h) * k,
      bw = bg.w * sc,
      bh = bg.h * sc;
    return { sc, bw, bh, x: (W - bw) * right, y: (H - bh) / 2 };
  };
  let F, HV; // this frame's fit, the hero on screen
  const at = (X, Y) => [F.x + X * F.sc, F.y + Y * F.sc];
  let ready = false,
    loading = false,
    hready = false;
  LB.ready = () => ready;
  LB.load = async () => {
    if (loading) return;
    loading = true;
    const art = (n) => G.load(n, 'assets/' + n + '.png?v=' + (window.__V || 0));
    try {
      await art('bg_lobby4');
      ready = true;
    } catch (e) {
      console.warn('lobby art', e);
    }
    Promise.all([art('bg_heroes'), art('hcard_bg'), art('lob_leaves')]).then(
      () => {
        hready = true;
      },
      (e) => console.warn('heroes art', e),
    ); // (resolved: the lobby's art is in)
  };

  // a page change cross-fades the scene as the DOM screens fade (style.css .scr): the scene left is drawn once more, into SNAP
  // (OUT: where a scene draws; SNAPPING: no live 3D copied into the old page's canvases, they keep their last frame), and fades out
  const FADE = 0.3;
  let shown = null,
    SNAP = null,
    fadeU = 1,
    OUT = null,
    SNAPPING = false,
    drawnAt = -1;
  function scene(t, sc) {
    if (sc === 'heroes' && hready) return heroesScene(t);
    if (sc === 'arsenal' || sc === 'upgrades') return pageScene(t, sc);
    G.bind(OUT, [0.1, 0.07, 0.12, 1]);
    G.blend();
    bunker(t, sc !== 'heroes'); // heroes before its art is in: the bunker without the armed hero (and its sounds)
  }
  LB.render = (t) => {
    const sc = (window.UI && UI.scene) || 'main',
      now = performance.now() / 1000,
      dt = Math.min(now - drawnAt, 1 / 30); // (a long frame, a shader compiling: the fade doesn't jump)
    if (now - drawnAt > 0.25) shown = null; // back from a run or an opaque page (the map): the screen above fades in, not the scene
    drawnAt = now;
    if (shown !== null && sc !== shown) {
      if (!SNAP || SNAP.w !== G.W || SNAP.h !== G.H) {
        G.free(SNAP);
        SNAP = G.target(G.W, G.H);
      }
      OUT = SNAP;
      SNAPPING = true;
      try {
        scene(t, shown);
      } finally {
        OUT = null;
        SNAPPING = false;
      }
      fadeU = 0;
    } else if (fadeU < 1) fadeU += dt / FADE;
    shown = sc;
    scene(t, sc);
    if (fadeU >= 1 || !SNAP || SNAP.w !== G.W || SNAP.h !== G.H) {
      fadeU = 1;
      return;
    }
    G.bind(null);
    G.blend();
    G.full(LIB.P.lobfade, { u_src: SNAP, u_a: 1 - ss(0, 1, fadeU) });
  };
  // the bunker: the backdrop, its lamps' light, the motes behind the hero, the hero (when asked), the motes in front — into whatever is
  // bound (the screen, or the pages' blur target)
  let LAMP = 1,
    RED = 1; // this frame's: the work lamp's light (1: as painted), the red lamp's pulse
  function bunker(t, withHero) {
    const W = G.W,
      H = G.H,
      B = BATCH,
      P = LIB.P,
      bg = G.tex('bg_lobby4');
    F = fit(W, H, bg, 1.02 + 0.006 * Math.sin(t * 0.15));
    const k = F.sc,
      hp = at(LAY.hero[0], LAY.hero[1]);
    HV = { x: hp[0], y: hp[1], s: (LAY.hero[2] * k) / 1.02 };
    G.draw(P.lobtex, { u_tex: bg, u_a: 1, u_t: t, u_bend: 0, u_tint: [1, 1, 1] }, G.xf(F.x, F.y, F.bw, F.bh));
    LAMP = lampLevel(t);
    RED = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.6), 2);
    // the work lamp dimmed: its light on the pegboard and the bench taken back (the art has it on)
    const dim = 1 - LAMP,
      [lx, ly] = at(LAY.lamp[0], LAY.lamp[1]),
      [px, py] = at(LAY.pool[0], LAY.pool[1]);
    if (dim > 0.01) {
      B.fx(5, px, py, 270 * k, 230 * k, -0.25, 0.02, 0.015, 0.02, Math.min(0.8, dim * 0.9), 1.6, 0, 1);
      B.fx(5, lx, ly + 4 * k, 60 * k, 26 * k, 0, 0.02, 0.015, 0.02, Math.min(0.85, dim * 1.1), 1.6, 0, 1);
      B.flush(B.F, 'fx');
    }
    // light: the bulb and its pool, the ceiling's tube (steady), the red lamp and its red on the door and the floor
    B.fx(0, lx, ly + 6 * k, 78 * k, 40 * k, 0, 1, 0.8, 0.5, 0.36 * LAMP, 1.8, 0, 0);
    B.fx(0, px, py, 250 * k, 200 * k, -0.25, 1, 0.72, 0.42, 0.075 * LAMP, 1.4, 0, 0);
    const [tx, ty] = at(LAY.tube[0], LAY.tube[1]);
    B.fx(0, tx, ty + 8 * k, 140 * k, 34 * k, 0, 0.7, 0.85, 1, 0.12, 2, 0, 0);
    const [rx, ry] = at(LAY.red[0], LAY.red[1]),
      [dx, dy] = at(LAY.door[0], LAY.door[1]),
      [fx, fy] = at(LAY.floor[0], LAY.floor[1]);
    B.fx(0, rx, ry, 30 * k, 26 * k, 0, 1, 0.2, 0.12, 0.7 * RED, 2.2, 0, 0);
    B.fx(0, rx, ry + 10 * k, 170 * k, 130 * k, 0, 1, 0.1, 0.06, 0.2 * RED, 1.4, 0, 0);
    B.fx(0, dx, dy, 240 * k, 250 * k, 0, 1, 0.08, 0.05, 0.07 * RED, 1.2, 0, 0);
    B.fx(0, fx, fy, 150 * k, 46 * k, 0, 1, 0.12, 0.08, 0.14 * RED, 1.6, 0, 0);
    B.flush(B.F, 'fx', 'add');
    motes(t, false);
    if (withHero) hero(t);
    motes(t, true);
  }
  // the work lamp: a steady light with a slight hum; now and then (about one 7 s span in two) a stutter of quick dips, as a loose bulb
  function lampLevel(t) {
    const cyc = 7,
      n = Math.floor(t / cyc),
      u = t - n * cyc;
    let l = 0.97 + 0.02 * Math.sin(t * 2.1) + 0.012 * Math.sin(t * 7.7 + 1.3);
    if (hash(n + 17) < 0.5 && u < 0.9) {
      const q = u / 0.9;
      if (Math.sin(q * (20 + 14 * hash(n + 3)) * Math.PI) > 0.1) l *= 0.3 + 0.5 * q;
    }
    return l;
  }
  // motes of dust glowing in the air: drifting slowly up and round, twinkling, brightest in the lamps' light (warm by the work lamp,
  // red by the door); in front a few large and soft, out of focus
  function motes(t, front) {
    const B = BATCH,
      k = F.sc,
      n = front ? 9 : 90,
      o = front ? 500 : 0;
    for (let i = 0; i < n; i++) {
      const h = (j) => hash(i * 7.31 + j + o),
        per = 16 + 22 * h(1),
        u = (t / per + h(2)) % 1;
      const x = 60 + 1660 * h(3) + Math.sin(t * (0.2 + 0.2 * h(4)) + 6 * h(5)) * 60,
        y = 860 - u * 820 + Math.sin(t * (0.3 + 0.3 * h(6)) + 6 * h(7)) * 24;
      const nl = Math.exp(-(((x - LAY.pool[0]) / 300) ** 2 + ((y - LAY.pool[1]) / 260) ** 2)),
        nr = Math.exp(-(((x - LAY.red[0]) / 200) ** 2 + ((y - LAY.red[1] - 60) / 220) ** 2));
      const tw = 0.55 + 0.45 * Math.sin(t * (1.4 + 2.2 * h(8)) + 9 * h(9)),
        fade = ss(0, 0.1, u) * ss(1, 0.85, u);
      const a = fade * tw * (front ? 0.09 : 0.42 + 0.7 * nl * LAMP + 0.5 * nr * RED),
        r = (front ? 12 + 14 * h(10) : 2.2 + 3 * h(10)) * k,
        red = nr > nl;
      const [qx, qy] = at(x, y);
      B.fx(0, qx, qy, r * 2, r * 2, 0, 1, red ? 0.4 : 0.84, red ? 0.36 : 0.58, a, front ? 1.6 : 2.6, 0, 0);
    }
    B.flush(B.F, 'fx', 'add');
  }
  // vine leaves in the corners, out of focus, swaying
  function ivy(t) {
    const W = G.W,
      H = G.H,
      P = LIB.P,
      lv = G.tex('lob_leaves'),
      lw = 560,
      lh = (lw * lv.h) / lv.w,
      gust = 0.5 + 0.5 * Math.sin(t * 0.43);
    G.draw(
      P.lobtex,
      { u_tex: lv, u_a: 1, u_t: t, u_bend: 0.025 + 0.02 * gust, u_tint: [0.8, 0.78, 0.82] },
      G.xf(-90, H - lh * 0.82, lw, lh, -0.08 + 0.025 * Math.sin(t * 1.1), 40, lh),
    );
    G.draw(
      P.lobtex,
      { u_tex: lv, u_a: 1, u_t: t + 1.7, u_bend: 0.03 + 0.02 * gust, u_tint: [0.75, 0.72, 0.8] },
      G.xf(W - lw + 120, H - lh * 0.72, lw, lh, 0.06 + 0.03 * Math.sin(t * 0.9 + 1), lw - 40, lh),
      [1, 0],
    );
  }

  // ---------- the arsenal and upgrades screens (ui.js): the bunker blurred and dimmed behind the panels; on the upgrades screen the
  // penguin stands big and sharp at its slot, in the arsenal the chosen gun turns slowly in its panel ----------
  let BT = null,
    gvc = null,
    gvx = null;
  const ICONS = {},
    icon = (id, name = 'i_' + id) =>
      ICONS[name] ||
      (ICONS[name] = Object.assign(new Image(), { src: 'assets/' + name + '.png?v=' + (window.__V || 0) }));
  const slot = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect(),
      c = G.canvas.getBoundingClientRect();
    if (!r.width || !c.width) return null;
    const kx = G.W / c.width,
      ky = G.H / c.height;
    return { x: (r.left - c.left) * kx, y: (r.top - c.top) * ky, w: r.width * kx, h: r.height * ky };
  };
  function pageScene(t, sc) {
    if (sc === 'arsenal' && !SNAPPING) gunView(t); // uses the screen as scratch first
    const W = G.W,
      H = G.H,
      P = LIB.P;
    if (!BT || BT.W !== W || BT.H !== H) {
      if (BT) {
        G.free(BT.a);
        G.free(BT.b);
      }
      const w = Math.ceil(W / 4),
        h = Math.ceil(H / 4);
      BT = { W, H, a: G.target(w, h, false, { view: [W, H] }), b: G.target(w, h, false, { view: [W, H] }), t: -9 };
    }
    // (the blurred bunker drawn again ten times a second, not every frame: under the blur its lamp's flicker still shows)
    if (Math.abs(t - BT.t) >= 0.1) {
      BT.t = t;
      G.bind(BT.a, [0.1, 0.07, 0.12, 1]);
      G.blend();
      bunker(t, false);
      G.blend('none');
      for (const d of [3, 6, 11]) {
        G.bind(BT.b);
        G.full(P.blur, { u_src: BT.a, u_dir: [d, 0] });
        G.bind(BT.a);
        G.full(P.blur, { u_src: BT.b, u_dir: [0, d] });
      }
    }
    G.blend('none');
    G.bind(OUT);
    G.full(P.lobdim, { u_src: BT.a, u_k: 0.5 });
    G.blend();
    if (sc === 'upgrades') standing(t);
  }
  // the cat on the upgrades screen: standing at ease, no gun
  function standing(t) {
    const fa = fadeIn();
    if (fa < 0) return;
    const r = slot(SNAPPING ? '#upg .pslot' : '#upg:not(.gone) .pslot');
    if (!r) return; // the snapshot: the page just left
    const B = BATCH,
      s = Math.min(r.h * 0.8, r.w * 1.05),
      x = r.x + r.w / 2,
      y = r.y + r.h * 0.93,
      h = s * 1.0;
    B.fx(0, x, y - s * 0.45, s * 1.15, s * 1.0, 0, 0.3, 0.36, 0.58, 0.2 * fa, 1.3, 0, 0);
    B.flush(B.F, 'fx', 'add'); // a soft light behind
    HERO3D.lobby(ust, t, 2.2 + 0.2 * Math.sin(t * 0.33), gunId());
    heroShadow(ust, x, y, h, fa);
    HERO3D.draw(ust, x, y, h, gunId(), lit(fa));
  }
  // the arsenal's chosen gun, live in 3D: swinging slowly side to side, bobbing, the minigun's barrels turning — drawn on the screen
  // first (scratch: the page's scene is drawn over it), then copied into its canvas. An Android phone's browser can hand drawImage of
  // the WebGL canvas the frame shown last instead of the one just drawn (there: the blurred bunker), so the gun flickered with the
  // bunker: there its pixels are read back from the frame itself (readPixels), every other frame (30 a second: the read costs)
  const READBACK = /Android/i.test(navigator.userAgent);
  let gvN = 0,
    gvBuf = null,
    gvImg = null;
  function gunView(t) {
    if (!gvc || !gvc.isConnected || gvc.closest('.gone')) {
      gvc = document.querySelector('#ars:not(.gone) .gview canvas');
      gvx = gvc && gvc.getContext('2d');
    }
    if (!gvc || !gvx) return;
    const id = gvc.dataset.gun;
    if (!id || !DATA.HOLD[id]) return;
    // its mesh still on the way (ui.js arsenal asked for it): an empty stage, never the old drawn model
    if (DATA.HOLD[id].mesh && window.GUNMESH && !GUNMESH.has(id)) {
      gvx.clearRect(0, 0, gvc.width, gvc.height);
      gvc.dataset.drawn = '';
      return;
    }
    const r = gvc.parentElement.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return; // the box, not the canvas itself
    if (READBACK && gvN++ & 1 && gvc.dataset.drawn === id) return; // (the copy from the frame before stays)
    const q = Math.min(Math.max(1, window.devicePixelRatio || 1), G.W / r.width, G.H / r.height),
      rw = Math.round(r.width * q),
      rh = Math.round(r.height * q);
    const pw = Math.max(1, Math.round((rw * G.PW) / G.W)),
      ph = Math.max(1, Math.round((rh * G.PH) / G.H)),
      cw = READBACK ? pw : rw,
      ch = READBACK ? ph : rh; // (a phone draws the canvas smaller: G.PW)
    if (gvc.width !== cw || gvc.height !== ch) {
      gvc.width = cw;
      gvc.height = ch;
    }
    G.bind(null, [0.086, 0.118, 0.212, 1]);
    G.blend(); // the stage's navy (style.css #ars .gview)
    BATCH.fx(0, rw / 2, rh * 0.56, rw * 0.62, rh * 0.55, 0, 0.22, 0.36, 0.7, 0.3, 1.4, 0, 0);
    BATCH.flush(BATCH.F, 'fx', 'add');
    const L = PENGUIN.gunLen(id),
      th = 2 * DATA.HOLD[id].b[2] * DATA.gunK(id)[0],
      s = Math.min((rw * 0.78) / L, (rh * 0.72) / th); // fit its length and its bulk
    const live = PENGUIN.drawGun(
      LIBP(),
      id,
      rw / 2,
      rh * 0.5 + Math.sin(t * 1.3) * rh * 0.025,
      s,
      Math.PI / 2 - 0.45 + 0.5 * Math.sin(t * 0.45),
      0.3,
      0.1,
      { u_spin: id === 'minigun' ? t * 4 : 0.3, u_t: t },
    );
    if (READBACK) {
      const gl = G.gl,
        n = pw * ph * 4;
      if (!gvBuf || gvBuf.length !== n) {
        gvBuf = new Uint8Array(n);
        gvImg = new ImageData(pw, ph);
      }
      G.bind(null);
      gl.readPixels(0, G.PH - ph, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, gvBuf); // (bottom row first: turned over below)
      const D = gvImg.data,
        row = pw * 4;
      for (let y = 0; y < ph; y++) D.set(gvBuf.subarray((ph - 1 - y) * row, (ph - y) * row), y * row);
      gvx.putImageData(gvImg, 0, 0);
      gvc.dataset.drawn = id;
    } else gvx.drawImage(G.canvas, 0, 0, pw, ph, 0, 0, rw, rh);
    if (!live) {
      const im = icon(id);
      if (im.complete && im.naturalWidth) {
        const k = Math.min((cw * 0.8) / im.naturalWidth, (ch * 0.7) / im.naturalHeight); // its model still compiling: the icon
        gvx.drawImage(
          im,
          (cw - im.naturalWidth * k) / 2,
          (ch - im.naturalHeight * k) / 2,
          im.naturalWidth * k,
          im.naturalHeight * k,
        );
      }
      gvc.dataset.drawn = '';
    }
  }

  // ---------- the heroes screen (ui.js heroes): the survivors' camp at sunset — the fire flickers and throws sparks, the lanterns and
  // the truck's headlight breathe, leaves blow across — and the cat's portrait, live on its pedestal inside its card ----------
  const LAYH = {
    fire: [290, 585],
    lamps: [
      [220, 330, 1],
      [1133, 448, 0.8],
    ],
    ped: [0.5, 0.725],
  }; // backdrop px; the pedestal's top in hcard_bg (uv)
  let pcv = null,
    pctx = null;
  // the main lobby's cat can be turned up to TURN either way by dragging it (mouse or finger); let go, it stays turned a few
  // seconds, then turns back to face us
  const TURN = (15 * Math.PI) / 180,
    SPIN = { v: 0, drag: false, px: 0, at: -99, id: null };
  const onHero = (e) => {
    if (!HV || !G.canvas) return false;
    const r = G.canvas.getBoundingClientRect();
    if (!r.width) return false;
    const x = ((e.clientX - r.left) * G.W) / r.width,
      y = ((e.clientY - r.top) * G.H) / r.height,
      h = HV.s * 1.02;
    return Math.abs(x - HV.x) < h * 0.38 && y < HV.y + h * 0.05 && y > HV.y - h * 1.05;
  };
  const mainShown = () =>
    window.UI &&
    UI.live &&
    UI.scene === 'main' &&
    !(window.GAME && GAME.play) &&
    !document.querySelector('#lobby .setp.open');
  addEventListener('pointerdown', (e) => {
    if (
      !mainShown() ||
      e.button > 0 ||
      (e.target.closest && e.target.closest('button, a, input, .lbp, .cta, .setp')) ||
      !onHero(e)
    )
      return;
    SPIN.drag = true;
    SPIN.px = e.clientX;
    SPIN.id = e.pointerId;
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  });
  addEventListener('pointermove', (e) => {
    if (SPIN.drag && e.pointerId === SPIN.id) {
      SPIN.v = clamp(SPIN.v + (e.clientX - SPIN.px) * 0.004, -TURN, TURN);
      SPIN.px = e.clientX;
      SPIN.at = performance.now() / 1000;
      e.preventDefault();
      return;
    }
    if (mainShown() && !(e.target.closest && e.target.closest('button, a, input, .lbp, .cta, .setp')))
      document.body.style.cursor = onHero(e) ? 'grab' : '';
  });
  const release = (e) => {
    if (!SPIN.drag || e.pointerId !== SPIN.id) return;
    SPIN.drag = false;
    SPIN.at = performance.now() / 1000;
    document.body.style.cursor = '';
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  function heroesScene(t) {
    if (!SNAPPING) portrait(t);
    const W = G.W,
      H = G.H,
      B = BATCH,
      P = LIB.P;
    G.bind(OUT, [0.1, 0.07, 0.12, 1]);
    G.blend();
    const bg = G.tex('bg_heroes');
    F = fit(W, H, bg, 1.02 + 0.006 * Math.sin(t * 0.15), 0.5);
    const at = (x, y) => [F.x + x * F.sc, F.y + y * F.sc],
      k = F.sc / 1.275;
    G.draw(P.lobtex, { u_tex: bg, u_a: 1, u_t: t, u_bend: 0, u_tint: [1, 1, 1] }, G.xf(F.x, F.y, F.bw, F.bh));
    // the campfire: a flickering pool of light and sparks riding the heat up and away on the wind
    const fl = 0.75 + 0.13 * Math.sin(t * 13.1) + 0.08 * Math.sin(t * 23.7 + 1) + 0.06 * Math.sin(t * 5.3),
      [fx, fy] = at(LAYH.fire[0], LAYH.fire[1]);
    B.fx(0, fx, fy - 30 * k, 420 * k, 300 * k, 0, 1, 0.5, 0.18, 0.2 * fl, 1.3, 0, 0);
    B.fx(0, fx, fy - 10 * k, 150 * k, 110 * k, 0, 1, 0.72, 0.32, 0.3 * fl, 2, 0, 0);
    for (let i = 0; i < 28; i++) {
      const life = 1.5 + 1.3 * hash(i + 200),
        ph = ((t + hash(i + 300) * 9) / life) % 1,
        rise = (170 + 160 * hash(i + 500)) * k;
      const x = fx + ((hash(i + 400) - 0.5) * 50 + Math.sin(t * 1.7 + i) * 16 * ph + 70 * ph * ph) * k,
        y = fy - 20 * k - ph * rise;
      const sz = (2.4 + 2.2 * hash(i + 600)) * k * (1 - 0.5 * ph),
        al = ss(0, 0.08, ph) * (1 - ph) * (0.6 + 0.4 * Math.sin(t * 19 + i * 3));
      B.fx(0, x, y, sz * 4, sz * 4, 0, 1, 0.55 + 0.35 * hash(i + 700), 0.2, al, 3, 0, 0);
    }
    // lanterns and the headlight breathe
    LAYH.lamps.forEach(([lx, ly, a], i) => {
      const [x, y] = at(lx, ly),
        f = 0.85 + 0.1 * Math.sin(t * (6 + i * 2.3) + i) + 0.05 * Math.sin(t * 17 + i);
      B.fx(0, x, y, 170 * k, 170 * k, 0, 1, 0.72, 0.38, 0.22 * a * f, 1.6, 0, 0);
    });
    B.flush(B.F, 'fx', 'add');
    leaves(t, 0);
    leaves(t, 1);
    B.flush(B.S, 'spr');
    ivy(t);
  }
  // the hero in the card: the alley and pedestal (hcard_bg, cover-fitted like the locked cards' <img>), the cat on top with its gun —
  // standing at ease, no gun — copied into the card's <canvas>
  function portrait(t) {
    if (!pcv || !pcv.isConnected || pcv.closest('.gone')) {
      pcv = document.querySelector('#heroes:not(.gone) .hc.me .port canvas');
      pctx = pcv && pcv.getContext('2d');
    }
    if (!pcv) return;
    const r = pcv.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const q = Math.min(Math.max(1, window.devicePixelRatio || 1), G.W / r.width, G.H / r.height),
      rw = Math.round(r.width * q),
      rh = Math.round(r.height * q);
    if (pcv.width !== rw || pcv.height !== rh) {
      pcv.width = rw;
      pcv.height = rh;
    }
    const B = BATCH;
    G.bind(null, [0.05, 0.07, 0.14, 1]);
    G.blend();
    const bg = G.tex('hcard_bg'),
      sc = Math.max(rw / bg.w, rh / bg.h),
      bw = bg.w * sc,
      bh = bg.h * sc,
      ox = (rw - bw) / 2,
      oy = (rh - bh) / 2;
    G.draw(LIB.P.lobtex, { u_tex: bg, u_a: 1, u_t: t, u_bend: 0, u_tint: [1, 1, 1] }, G.xf(ox, oy, bw, bh));
    const x = ox + bw * LAYH.ped[0],
      y = oy + bh * LAYH.ped[1],
      s = rh * 0.7;
    B.fx(0, x, y, bw * 0.3, bh * 0.05, 0, 0.3, 0.85, 1, 0.12 + 0.05 * Math.sin(t * 2.2), 1.6, 0, 0);
    B.flush(B.F, 'fx', 'add'); // the rim lights' glow
    const h = s * 1.0,
      fa = fadeIn();
    HERO3D.lobby(pst, t, 2.0 + 0.2 * Math.sin(t * 0.37), gunId());
    B.fx(5, x + 4, y + 2, h * 0.3, h * 0.075, 0, 0.03, 0.02, 0.06, 0.55, 3, 0, 1);
    B.flush(B.F, 'fx');
    if (fa >= 0) HERO3D.draw(pst, x, y, h, gunId(), { alpha: fa, elev: MENU_ELEV, feet: true });
    pctx.drawImage(G.canvas, 0, 0, (rw * G.PW) / G.W, (rh * G.PH) / G.H, 0, 0, rw, rh);
  }

  // ---------- leaves on the wind: drift right to left, flutter (turn edge-on), tumble ----------
  const LEAF = [
    [0.47, 0.62, 0.2],
    [0.9, 0.5, 0.16],
    [0.86, 0.7, 0.22],
    [0.6, 0.4, 0.2],
    [0.35, 0.55, 0.22],
  ];
  function leaves(t, front) {
    const W = G.W,
      H = G.H,
      B = BATCH,
      R = B.R.x_leaf;
    if (!R) return;
    for (let i = 0; i < 18; i++) {
      if ((i % 3 === 0) !== !!front) continue;
      const sp = 70 + 90 * hash(i + 11) + (front ? 60 : 0),
        span = W + 500,
        q = (t * sp + hash(i) * span) % span,
        x = W + 250 - q;
      const y0 = H * (0.08 + 0.75 * hash(i + 23)),
        y = y0 + q * (0.12 + 0.12 * hash(i + 5)) + Math.sin(t * (0.9 + hash(i + 7)) + i) * 40;
      const w = (front ? 30 : 16) + 12 * hash(i + 31),
        h = ((w * R.h) / R.w) * Math.abs(Math.cos(t * (2 + 2 * hash(i + 9)) + i)),
        a = t * (1.2 + 1.5 * hash(i + 13)) * (i % 2 ? 1 : -1) + i;
      const c = Math.cos(a),
        s = Math.sin(a),
        col = LEAF[i % LEAF.length],
        al = ss(0, 120, q) * ss(0, 120, span - q);
      B.spr(
        'x_leaf',
        [c * w, s * w, -s * h, c * h, x - (c * w - s * h) / 2, y - (s * w + c * h) / 2],
        col[0],
        col[1],
        col[2],
        al * (front ? 0.95 : 0.8),
        0,
        0,
      );
    }
  }

  // ---------- the hero (hero3d.js) ----------
  const gunId = () => (window.SAVE && SAVE.selected && DATA.HOLD[SAVE.selected] ? SAVE.selected : 'pistol');
  const MENU_ELEV = 0.38; // the menus' camera: a little above her, as the backdrop's floor is seen (a run's looks down at 30°)
  // its shadow on the floor: the occlusion round where it stands, then its own silhouette laid on the floor away from the work lamp
  // (up to the left: toward the front right), darkest at the boots (CHARMESH cast)
  const CAST = [0.55, 0.45, 0.5]; // floor offset per unit of height (right, toward us), its darkness
  const heroShadow = (st, x, y, h, fa) => {
    const B = BATCH;
    B.fx(5, x + h * 0.04, y + h * 0.012, h * 0.3, h * 0.065, 0, 0.08, 0.03, 0.05, 0.6 * fa, 1.6, 0, 1);
    B.fx(5, x + h * 0.01, y + h * 0.004, h * 0.19, h * 0.032, 0, 0.03, 0.01, 0.02, 0.95 * fa, 2.0, 0, 1);
    B.flush(B.F, 'fx');
    HERO3D.draw(st, x, y, h, gunId(), { alpha: fa, elev: MENU_ELEV, cast: CAST, ccol: [0.12, 0.04, 0.05], feet: true });
  };
  const hst = HERO3D.state(),
    pst = HERO3D.state(),
    ust = HERO3D.state(); // the lobby's cat, the heroes card's, the upgrades page's
  // the cat fades in once its model is in (index.html loads it with the lobby's art): its opacity, or −1 before
  let heroIn = -1;
  const fadeIn = () => {
    const now = performance.now() / 1000;
    if (heroIn < 0) {
      if (!HERO3D.ready()) return -1;
      heroIn = now;
    }
    return ss(0, 0.45, now - heroIn);
  };
  // the main lobby: standing with the gun held as when aiming (herobake.js), facing us straight
  const LOBBY_AIM = Math.PI / 2;
  function hero(t) {
    const fa = fadeIn();
    if (fa < 0) return;
    const B = BATCH,
      x = HV.x,
      y = HV.y,
      h = HV.s * 1.02;
    const now = performance.now() / 1000;
    if (!SPIN.drag && now - SPIN.at > 4) SPIN.v *= Math.exp(-Math.min(0.1, now - (SPIN.last || now)) * 2.5); // turning back, after 4 s
    SPIN.last = now;
    HERO3D.lobby(hst, t, LOBBY_AIM, gunId(), SPIN.v, SPIN.drag);
    sounds(t);
    heroShadow(hst, x, y, h, fa);
    HERO3D.draw(hst, x, y, h, gunId(), lit(fa));
  }
  // the bunker's light on the cat (charmesh mood 2: a dim cool room, a soft warm key) and its lamps as point lights (model units from
  // its feet, as the camera sees it): the work lamp up to the left, flickering with it; the red lamp behind to the right, pulsing
  const PL = new Float32Array([-1.0, 1.4, -0.3, 1.8, 1.1, 1.25, -1.1, 1.7, 0, 0, 0, 0, 0, 0, 0, 0]),
    PC = new Float32Array(12);
  const lit = (fa) => {
    PC.set([
      1.0 * 0.5 * LAMP,
      0.78 * 0.5 * LAMP,
      0.5 * 0.5 * LAMP,
      1.0 * 0.95 * RED,
      0.12 * 0.95 * RED,
      0.08 * 0.95 * RED,
    ]);
    return { alpha: fa, elev: MENU_ELEV, mood: 2, pl: PL, pc: PC, feet: true };
  };
  // now and then a purr (only once the page has had a gesture: AUDIO.cat stays silent before)
  let nextPurr = 5;
  function sounds(t) {
    if (t < nextPurr - 30) nextPurr = t + 5; // (the lobby's clock started over)
    if (t > nextPurr && window.AUDIO && AUDIO.cat) {
      nextPurr = t + 9 + 7 * Math.random();
      AUDIO.cat('purr', 0.16);
    }
  }
  const LIBP = () => LIB.P.peng; // (the arsenal's gun view: penguin.js draws the guns)
})();
