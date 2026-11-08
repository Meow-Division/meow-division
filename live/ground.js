// live/ground.js — the iso ground painter: one chunk of the level's ground at a time, Canvas 2D, into a picture the scene uploads as a
// texture (scene.js chunkTex). It runs in a worker of its own (the page's frames never wait for it; the scene starts it, see
// GROUND.worker below) or, where a worker can't paint (no OffscreenCanvas), on the page itself. The level comes as plain data
// (GROUND.slim: the parts of sim.js's level the painter reads), the pictures it lays (slabs, grass, plants, kerbs, graffiti) it loads
// itself (GROUND.setup with a loader).
(function (root) {
  const GR = (root.GROUND = {});
  const TAU = Math.PI * 2,
    clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }; // (lib.js L.rnd)
  const DOC = typeof document !== 'undefined';
  function mk(w, h) {
    if (!DOC) return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function prng(seed) {
    let s = seed;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
  let GS = 4800,
    IMG = {}; // the ground's size (sim.js G); graffiti and flower pictures
  const inPlaza = (LV, gx, gy, pad = 0) =>
    LV.plazas.some((r) => gx > r.x0 - pad && gx < r.x1 + pad && gy > r.y0 - pad && gy < r.y1 + pad);
  // a prop's picture: height over width (GROUND.slim writes it; on the page the asset list has it)
  const sprite = (o) => (o.back && root.ASSETS && root.ASSETS[o.n + '_b'] ? o.n + '_b' : o.n); // (a prop turned to its back: <n>_b)
  const aspect = (o, d) => {
    if (o.ar !== undefined) return o.ar || d;
    const a = root.ASSETS && root.ASSETS[sprite(o)];
    return a ? a.h / a.w : d;
  };
  // a lab prop's base line (gen/labback.py: the lower hull of its drawing, [u, v, ...]), or null (the town's: footprint shadows)
  const baseOf = (o) => {
    if (o.base !== undefined) return o.base;
    const a = root.ASSETS && root.ASSETS[sprite(o)];
    return (a && a.base) || null;
  };

  // ================================================================== iso ground (Canvas 2D painter → chunk textures)
  // A chunk is CH world px square (painted with a 1 px apron, which the next chunk's edge overlaps), at K px per world px (the
  // camera zoom), so it lands on screen 1:1. Ground space:
  // screen x = gx − gy + G − x0, y = (gx + gy)/2 − y0. Paved ground is the map set's floor tiles (art/refs/map → gen/mapslice.py:
  // the slabs' top faces squared, the sheet's baked light taken out) laid cell by cell: light slabs on the plaza, the sidewalks
  // and the yards, dark ones on the roads; a 2 × 2 block is one four-slab tile or four single slabs, each turned, mirrored and
  // toned by its own hash. The plaza's edge breaks up and slabs are missing here and there, grass showing through. Grass is the
  // set's grass tile; the set's small plants grow along paved edges, in the gaps and over the yards; every static prop, tree and
  // bush casts a soft shadow away from the key light (upper left), baked in with the ground.
  // ================================================================== the laboratory's floor (sim.js level for the lab's seeds)
  // Every room its own tiles (LAB_T: art/lab → gen/labart.py), laid cell by cell from the room's corner, each turned (rot: the turns its
  // pattern allows), toned and picked by its own hash; at each door a hazard strip across the threshold; then the decor (goo, glass,
  // cables, papers, drains, grates, stains, moss, blood, puddles, stripes), the props' contact and cast shadows; the void outside dark
  const many = (a, k) => Array(k).fill(a),
    LAB_T = {
      hall: { n: [...many('hall0', 18), ...many('hall1', 10), ...many('hall3', 10), 'hall2'], c: 120, rot: 4 },
      store: { n: ['store0', 'store1', 'store1'], c: 120, rot: 4 },
      server: { n: ['server0', 'server1', 'server0'], c: 80, rot: 4 },
      exp: { n: ['exp0', 'exp0', 'exp1'], c: 100, rot: 4 },
      green: { n: ['green0', 'green1', 'green0'], c: 100, rot: 4 },
      gen: { n: ['gen0', 'gen1', 'gen0'], c: 120, rot: 2 },
      cells: { n: ['cells0', 'cells0', 'cells1'], c: 120, rot: 4 },
      cafe: { n: ['cafe0', 'cafe0', 'cafe1'], c: 120, rot: 2 },
      decon: { n: [...many('decon0', 14), 'decon1'], c: 100, rot: 2 },
    };
  const LT = {};
  let labP = null;
  // the lab's tiles, loaded once the first lab level is painted (the town's runs never fetch them)
  GR.lab = (load) =>
    labP ||
    (labP = (async () => {
      for (const [k, t] of Object.entries(LAB_T))
        for (const n of new Set(t.n)) {
          const im = await load('t_lf_' + n);
          LT[k + ':' + n] = im ? shrink(im, Math.round(t.c * TEXK * Math.max(1, K / 1.35))) : null;
        }
    })());
  function* paintLab(LV, g, x0, y0, ground, vis, V, gx0, gy0, gx1, gy1) {
    g.fillStyle = '#0b0d12';
    g.fillRect(gx0 - 200, gy0 - 200, gx1 - gx0 + 400, gy1 - gy0 + 400);
    for (const f of LV.floors) {
      if (!vis(f)) continue;
      const T = LAB_T[f.k] || LAB_T.hall,
        c = T.c;
      g.save();
      g.beginPath();
      g.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
      g.clip();
      for (let gy = f.y0; gy < f.y1; gy += c)
        for (let gx = f.x0; gx < f.x1; gx += c) {
          if (gx + c < gx0 || gx > gx1 || gy + c < gy0 || gy > gy1 || !V(gx + c / 2, gy + c / 2, c * 1.5)) continue;
          const h = rnd(gx * 0.0137 + 3.1, gy * 0.0211 + 7.7),
            h2 = rnd(gx * 0.0071 + 11, gy * 0.0193 + 5),
            h3 = rnd(gx * 0.0233 + 2, gy * 0.0047 + 13);
          const im = LT[f.k + ':' + T.n[Math.floor(h * T.n.length) % T.n.length]];
          g.save();
          g.translate(gx + c / 2, gy + c / 2);
          g.rotate(Math.floor(h2 * T.rot) * (TAU / T.rot));
          if (im) g.drawImage(im, -c / 2, -c / 2, c, c);
          else {
            g.fillStyle = '#6c7380';
            g.fillRect(-c / 2, -c / 2, c, c);
          }
          g.fillStyle = h3 < 0.5 ? `rgba(8,10,20,${(0.5 - h3) * 0.22})` : `rgba(255,248,230,${(h3 - 0.5) * 0.1})`;
          g.fillRect(-c / 2, -c / 2, c, c);
          g.restore();
        }
      g.restore();
    }
    yield;
    ground();
    // the thresholds: a hazard strip between each door's two posts (on the wall line, as wide as the wall)
    const dp = LV.props.filter((o) => o.post && o.door);
    for (const a of dp)
      for (const b of dp) {
        if (b === a) continue;
        const vert = a.gx === b.gx && b.gy > a.gy && b.gy - a.gy < 800,
          hor = a.gy === b.gy && b.gx > a.gx && b.gx - a.gx < 800;
        if (!vert && !hor) continue;
        const r = vert
          ? { x0: a.gx - 24, y0: a.gy + 30, x1: a.gx + 24, y1: b.gy - 30 }
          : { x0: a.gx + 30, y0: a.gy - 24, x1: b.gx - 30, y1: a.gy + 24 };
        if (!vis(r)) continue;
        g.save();
        g.beginPath();
        g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        g.clip();
        g.fillStyle = '#1c1c1e';
        g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        g.fillStyle = '#e8b51e';
        for (let t = (vert ? r.y0 : r.x0) - 60; t < (vert ? r.y1 : r.x1) + 60; t += 36) {
          g.beginPath();
          if (vert) {
            g.moveTo(r.x0, t);
            g.lineTo(r.x0, t + 18);
            g.lineTo(r.x1, t + 18 + 48);
            g.lineTo(r.x1, t + 48);
          } else {
            g.moveTo(t, r.y0);
            g.lineTo(t + 18, r.y0);
            g.lineTo(t + 18 + 48, r.y1);
            g.lineTo(t + 48, r.y1);
          }
          g.closePath();
          g.fill();
        }
        g.globalCompositeOperation = 'multiply';
        for (let i = 0; i < 26; i++) {
          const q = rnd(i * 3.3 + r.x0, r.y0 + i),
            w = rnd(i + r.y0, r.x0 * 0.1 + i);
          g.fillStyle = `rgba(90,80,70,${0.4 + w * 0.4})`;
          g.beginPath();
          g.ellipse(r.x0 + (r.x1 - r.x0) * q, r.y0 + (r.y1 - r.y0) * w, 6 + w * 14, 4 + q * 8, q * 3, 0, TAU);
          g.fill();
        }
        g.restore();
      }
    yield;
    // decor
    const near = (d, m) => d.gx + m > gx0 && d.gx - m < gx1 && d.gy + m > gy0 && d.gy - m < gy1;
    const ell = (x, y, rx, ry, a) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, a, 0, TAU);
    };
    for (const d of LV.decor) {
      const s = d.s || 60,
        a = d.a || 0;
      if (!near(d, d.k === 'cable' ? s + 60 : s * 1.6 + 40)) continue;
      const R = prng(Math.floor(d.gx * 7 + d.gy * 13) | 0 || 1);
      if (d.k === 'goo' || d.k === 'puddle' || d.k === 'blood') {
        const col =
          d.k === 'goo'
            ? ['rgba(60,150,30,0.55)', 'rgba(150,255,70,0.55)', 'rgba(230,255,180,0.7)']
            : d.k === 'blood'
              ? ['rgba(90,10,20,0.6)', 'rgba(150,20,35,0.55)', 'rgba(220,90,100,0.4)']
              : ['rgba(60,80,110,0.35)', 'rgba(150,180,215,0.3)', 'rgba(240,250,255,0.55)'];
        g.fillStyle = col[0];
        blobAt(g, d.gx, d.gy, s, s * 0.8, R());
        g.fill();
        for (let i = 0; i < 6; i++) {
          const an = R() * TAU,
            dd = s * (0.8 + R() * 0.5);
          ell(d.gx + Math.cos(an) * dd, d.gy + Math.sin(an) * dd, 4 + R() * s * 0.12, 3 + R() * s * 0.08, an);
          g.fill();
        }
        g.fillStyle = col[1];
        blobAt(g, d.gx - s * 0.1, d.gy - s * 0.1, s * 0.6, s * 0.5, R());
        g.fill();
        g.fillStyle = col[2];
        for (let i = 0; i < 4; i++) {
          ell(d.gx + (R() - 0.6) * s * 0.7, d.gy + (R() - 0.6) * s * 0.5, 2 + R() * 5, 1.5 + R() * 3, R() * 3);
          g.fill();
        }
      } else if (d.k === 'glass') {
        for (let i = 0; i < 22; i++) {
          const an = R() * TAU,
            dd = R() * s,
            x = d.gx + Math.cos(an) * dd,
            y = d.gy + Math.sin(an) * dd,
            z = 3 + R() * 9;
          g.fillStyle = R() < 0.5 ? 'rgba(200,240,235,0.75)' : 'rgba(120,200,190,0.6)';
          g.beginPath();
          g.moveTo(x, y - z);
          g.lineTo(x + z * 0.7, y + z * 0.3);
          g.lineTo(x - z * 0.5, y + z * 0.6);
          g.closePath();
          g.fill();
        }
      } else if (d.k === 'cable') {
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * 14,
            ca = Math.cos(a),
            sa = Math.sin(a),
            ox = -sa * off,
            oy = ca * off;
          const p0 = [d.gx + ox + ca * 160, d.gy + oy + sa * 160],
            p3 = [d.gx + ox + ca * s, d.gy + oy + sa * s],
            w1 = (R() - 0.5) * 120,
            w2 = (R() - 0.5) * 120;
          for (const [lw, col] of [
            [10, 'rgba(10,10,14,0.5)'],
            [7, k === 1 ? '#2a3140' : '#1d1f24'],
            [2, 'rgba(255,255,255,0.12)'],
          ]) {
            g.lineWidth = lw;
            g.strokeStyle = col;
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(p0[0], p0[1]);
            g.bezierCurveTo(
              p0[0] + ca * s * 0.3 - sa * w1,
              p0[1] + sa * s * 0.3 + ca * w1,
              p0[0] + ca * s * 0.6 - sa * w2,
              p0[1] + sa * s * 0.6 + ca * w2,
              p3[0],
              p3[1],
            );
            g.stroke();
          }
        }
      } else if (d.k === 'paper') {
        for (let i = 0; i < 3; i++) {
          g.save();
          g.translate(d.gx + (R() - 0.5) * 70, d.gy + (R() - 0.5) * 70);
          g.rotate(R() * TAU);
          g.fillStyle = '#e9e4da';
          g.fillRect(-11, -15, 22, 30);
          g.fillStyle = 'rgba(80,90,110,0.5)';
          for (let y = -11; y < 13; y += 4) g.fillRect(-8, y, 16, 1.2);
          g.restore();
        }
      } else if (d.k === 'drain') {
        ell(d.gx, d.gy, s * 0.5, s * 0.5, 0);
        g.fillStyle = '#26272c';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = '#6a6d74';
        g.stroke();
        g.strokeStyle = 'rgba(10,10,12,0.9)';
        g.lineWidth = 2.4;
        for (let k = -2; k <= 2; k++) {
          g.beginPath();
          g.moveTo(d.gx - s * 0.32, d.gy + k * s * 0.13);
          g.lineTo(d.gx + s * 0.32, d.gy + k * s * 0.13);
          g.stroke();
        }
      } else if (d.k === 'grate') {
        g.fillStyle = '#2b2d33';
        g.fillRect(d.gx - s / 2, d.gy - s / 2, s, s);
        g.strokeStyle = '#7b7f88';
        g.lineWidth = 3;
        g.strokeRect(d.gx - s / 2, d.gy - s / 2, s, s);
        g.strokeStyle = '#555963';
        g.lineWidth = 2.5;
        for (let k = 1; k < 7; k++) {
          g.beginPath();
          g.moveTo(d.gx - s / 2 + (k * s) / 7, d.gy - s / 2 + 3);
          g.lineTo(d.gx - s / 2 + (k * s) / 7, d.gy + s / 2 - 3);
          g.stroke();
        }
      } else if (d.k === 'stain') {
        ell(d.gx, d.gy, s, s * 0.6, a);
        g.fillStyle = 'rgba(8,6,14,0.22)';
        g.fill();
        ell(d.gx + 8, d.gy - 4, s * 0.55, s * 0.3, a);
        g.fillStyle = 'rgba(8,6,14,0.14)';
        g.fill();
      } else if (d.k === 'stripe') {
        const ca = Math.cos(a),
          sa = Math.sin(a);
        g.save();
        g.translate(d.gx, d.gy);
        g.rotate(a);
        g.beginPath();
        g.rect(-s / 2, -24, s, 48);
        g.clip();
        g.fillStyle = 'rgba(25,25,28,0.85)';
        g.fillRect(-s / 2, -24, s, 48);
        g.fillStyle = 'rgba(232,181,30,0.85)';
        for (let t = -s / 2 - 60; t < s / 2 + 60; t += 36) {
          g.beginPath();
          g.moveTo(t, -24);
          g.lineTo(t + 18, -24);
          g.lineTo(t + 66, 24);
          g.lineTo(t + 48, 24);
          g.closePath();
          g.fill();
        }
        g.restore();
        void ca;
        void sa;
      }
    }
    yield;
    // moss over the greenhouse's floor: the grass texture through soft blobs
    softLayer(
      g,
      PAT.grass,
      x0,
      y0,
      (mg) => {
        for (const d of LV.decor)
          if (d.k === 'moss' && near(d, d.s * 1.5)) {
            blobAt(mg, d.gx, d.gy, d.s, d.s * 0.75, d.a || 0.3);
            mg.fill();
          }
      },
      2,
    );
    yield;
    ground();
    // contact shadows under every standing footprint (the walls' too), then the cast shadows
    for (const p of LV.props) {
      const cl = p.col;
      if (p.hide || p.hp || cl.x1 < gx0 || cl.x0 > gx1 || cl.y1 < gy0 || cl.y0 > gy1) continue;
      const pad = p.wall || p.post ? 22 : 16,
        al = p.wall || p.post ? 0.5 : 0.55;
      g.save();
      g.translate((cl.x0 + cl.x1) / 2 + 6, (cl.y0 + cl.y1) / 2 + 6);
      g.scale((cl.x1 - cl.x0) / 2 + pad, (cl.y1 - cl.y0) / 2 + pad);
      const gr = g.createRadialGradient(0, 0, 0.2, 0, 0, 1.15);
      gr.addColorStop(0, `rgba(6,4,14,${al})`);
      gr.addColorStop(0.7, `rgba(6,4,14,${al * 0.55})`);
      gr.addColorStop(1, 'rgba(6,4,14,0)');
      g.fillStyle = gr;
      g.fillRect(-1.2, -1.2, 2.4, 2.4);
      g.restore();
    }
    yield;
    castShadows(g, LV, x0, y0, V);
  }
  const CH = 512;
  let K = 1.35,
    CP = Math.round((CH + 2) * K); // (GROUND.res: a phone paints its chunks smaller)   // + a 1 px apron all round: drawn at CH + 2, exactly
  const CELL = 64,
    RCELL = 120,
    GRASS = 150,
    TEXK = 1.6; // slab cell on paved ground and on roads, grass tile (ground units); texels per unit
  const SLABS = {
    light: {
      one: ['t_slab1', 't_slab1', 't_slab3', 't_slab1', 't_slab2', 't_slab3'],
      two: ['t_slab5', 't_slab8', 't_slab5', 't_slab8', 't_slab6'],
      c: CELL,
      big: 0.42,
    },
    road: { one: ['t_slab4'], two: ['t_slab7'], c: RCELL, big: 0.4 },
  };
  // the small plants painted with the ground: [sprite, width, + random width] (world px)
  const PLANTS = [
    ['p_tufts', 30, 20],
    ['p_clover2', 38, 24],
    ['p_grassdaisy', 40, 26],
    ['p_whiteflower', 32, 16],
    ['p_daisy', 30, 14],
    ['p_pinkflower', 28, 12],
    ['p_tallgrass', 30, 18],
    ['p_clover1', 46, 22],
    ['p_tufts', 26, 16],
    ['p_clover2', 32, 18],
    ['p_tufts', 24, 14],
  ];
  const KERBS = ['iso_kerb1', 'iso_kerb3', 'iso_kerb4', 'iso_kerb1', 'iso_kerb4']; // the set's kerb-stone runs (along gx; mirrored for gy)
  const LX = 1.2,
    LY = 0.36; // cast shadows: ground offset per px of height (a low dusk sun)
  const LAB_SHADOW = 0.2; // the lab's: that × (its ceiling lamps: a shadow close round its prop's foot)
  // value noise in ground units (beds of grass in the plaza)
  const vn = (x, y, s, sd) => {
    const X = x / s,
      Y = y / s,
      i = Math.floor(X),
      j = Math.floor(Y),
      u = X - i,
      v = Y - j,
      su = u * u * (3 - 2 * u),
      sv = v * v * (3 - 2 * v);
    const a = rnd(i + sd, j),
      b = rnd(i + 1 + sd, j),
      c = rnd(i + sd, j + 1),
      d = rnd(i + 1 + sd, j + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  const fbm = (x, y) => vn(x, y, 300, 3.3) * 0.65 + vn(x, y, 110, 7.7) * 0.35;
  let PAT = {};
  const TILE = {},
    MIP = {};
  let NOISE = null;
  async function groundTextures(load) {
    const tmp = mk(8, 8).getContext('2d');
    for (const set of Object.values(SLABS))
      for (const [list, sz] of [
        [set.one, set.c],
        [set.two, set.c * 2],
      ])
        for (const n of new Set(list)) {
          const im = await load(n);
          TILE[n + '@' + sz] = im ? shrink(im, Math.round(sz * TEXK * Math.max(1, K / 1.35))) : null;
        } // (a finer ground: finer slabs)
    for (const [k, n] of [
      ['grass', 't_grass1'],
      ['flowers', 't_grass3'],
      ['dirt', 't_grass2'],
    ]) {
      const im = await load(n);
      const c = im
        ? shrink(im, Math.round(GRASS * TEXK * Math.max(1, K / 1.35)))
        : (() => {
            const c = mk(8, 8),
              g = c.getContext('2d');
            g.fillStyle = '#3d5a22';
            g.fillRect(0, 0, 8, 8);
            return c;
          })();
      PAT[k] = tmp.createPattern(c, 'repeat');
      PAT.k = GRASS / c.width;
    }
    for (const n of [...PLANTS.map((p) => p[0]), ...KERBS])
      if (!MIP[n]) {
        const im = await load(n);
        if (im) MIP[n] = mips(im);
      }
    IMG = {};
    for (const n of ['p_graffiti1', 'p_graffiti2', 'p_flowers']) IMG[n] = await load(n);
    NOISE = mk(128, 128);
    {
      const g = NOISE.getContext('2d'),
        R = prng(77); // worn paint: specks the road markings are eaten through
      for (let i = 0; i < 420; i++) {
        g.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.7})`;
        g.beginPath();
        g.arc(R() * 128, R() * 128, 0.6 + R() * R() * 5, 0, TAU);
        g.fill();
      }
    }
  }
  // downscale by halves (no aliasing in a texture drawn at a fraction of its size), then to the exact size
  function shrink(im, px) {
    let c = im,
      w = im.width,
      h = im.height;
    const ph = Math.round((im.height * px) / im.width);
    while (w * 0.5 >= px * 1.3) {
      w = Math.round(w / 2);
      h = Math.round(h / 2);
      const d = mk(w, h),
        g = d.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, w, h);
      c = d;
    }
    const d = mk(px, ph),
      g = d.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, 0, 0, px, ph);
    return d;
  }
  function mips(im) {
    const c0 = mk(im.width, im.height),
      g0 = c0.getContext('2d');
    g0.filter = 'saturate(0.8) brightness(0.9)';
    g0.drawImage(im, 0, 0);
    const out = [c0];
    let c = c0;
    while (c.width > 24) {
      const d = mk(Math.round(c.width / 2), Math.round(c.height / 2)),
        g = d.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, d.width, d.height);
      out.push(d);
      c = d;
    }
    return out;
  }
  // a pattern laid in ground units: the context is scaled, not the pattern (Chrome drops CanvasPattern.setTransform on some
  // canvases, and those chunks came out with the grass 1.6× too big: a seam at every chunk edge)
  function patFill(g, pat, x, y, w, h) {
    const k = PAT.k;
    g.save();
    g.scale(k, k);
    g.fillStyle = pat;
    g.fillRect(x / k, y / k, w / k, h / k);
    g.restore();
  }
  const mipFor = (m, px) => {
    let k = 0;
    while (k + 1 < m.length && m[k + 1].width >= px) k++;
    return m[k];
  };
  const SP = 24;
  let SW = CP + SP * 2,
    SCR = [mk(SW, SW), mk(SW, SW), mk(SW, SW)]; // scratch canvases (padded, so blurs have no edge)
  const scrT = (x0, y0) => [K, K * 0.5, -K, K * 0.5, K * (GS - x0) + SP, -K * y0 + SP];

  let CHC = mk(CP, CP);
  // the chunks painted at q × the full resolution (a phone: its CPU paints a chunk in a third of the time, its screen shows no less)
  GR.res = (q) => {
    K = 1.35 * q;
    CP = Math.round((CH + 2) * K);
    SW = CP + SP * 2;
    SCR = [mk(SW, SW), mk(SW, SW), mk(SW, SW)];
    CHC = mk(CP, CP);
  };
  GR.CH = CH;
  GR.LX = LX;
  GR.LY = LY;
  // the pictures the ground lays, at the painting size: load(name) → an image (or an ImageBitmap; null if missing)
  GR.setup = async (load, { G = 4800 } = {}) => {
    GS = G;
    await groundTextures(load);
    GR.ready = true;
  };
  // the parts of a level (sim.js level) the painter reads, as plain data a worker can be sent
  GR.slim = (LV) => ({
    seed: LV.seed,
    map: LV.map,
    floors: LV.floors,
    roads: LV.roads,
    side: LV.side,
    lots: LV.lots,
    plazas: LV.plazas,
    dirt: LV.dirt,
    moss: LV.moss,
    grass: LV.grass,
    tints: LV.tints,
    decor: LV.decor,
    trees: LV.trees.map((t) => ({ gx: t.gx, gy: t.gy, w: t.w })),
    bushes: LV.bushes.map((b) => ({ gx: b.gx, gy: b.gy, w: b.w })),
    props: LV.props
      .filter((o) => !o.hide)
      .map((o) => ({
        n: o.n,
        gx: o.gx,
        gy: o.gy,
        w: o.w,
        fw: o.fw,
        fh: o.fh,
        flip: o.flip,
        bld: o.bld,
        lamp: o.lamp,
        hp: o.hp,
        wall: o.wall,
        post: o.post,
        door: o.door,
        col: { x0: o.col.x0, y0: o.col.y0, x1: o.col.x1, y1: o.col.y1 },
        ar: aspect(o, 0),
        base: LV.map === 'lab' && !o.wall && !o.post ? baseOf(o) : null,
      })),
  });
  // a chunk: a generator that paints it layer by layer (yields between them: the page can spread one over frames) and returns the canvas
  GR.paint = (LV, cx, cy) => paintChunk(LV, cx, cy);
  function* paintChunk(LV, cx, cy) {
    const c = CHC,
      g = c.getContext('2d'),
      x0 = cx * CH - 1,
      y0 = cy * CH - 1,
      Gs = GS;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.fillStyle = '#1d2a1a';
    g.fillRect(0, 0, CP, CP);
    const ground = () => g.setTransform(K, K * 0.5, -K, K * 0.5, K * (Gs - x0), -K * y0);
    ground();
    const gx0 = y0 + (x0 - Gs) / 2 - CH,
      gx1 = gx0 + CH * 3,
      gy0 = y0 - (x0 + CH - Gs) / 2 - CH,
      gy1 = gy0 + CH * 3;
    const vis = (r) => r.x1 > gx0 && r.x0 < gx1 && r.y1 > gy0 && r.y0 < gy1;
    const V = (gx, gy, s) => {
      const X = gx - gy + Gs - x0,
        Y = (gx + gy) / 2 - y0;
      return X > -s && X < CH + s && Y > -s && Y < CH + s;
    };
    const inR = (r, x, y, m = 0) => x > r.x0 - m && x < r.x1 + m && y > r.y0 - m && y < r.y1 + m;
    const inPZ = (x, y, m = 0) => LV.plazas.some((r) => inR(r, x, y, m));
    const road = (x, y, m = 0) => LV.roads.some((r) => inR(r, x, y, m));
    const paved = (x, y, m = 0) =>
      road(x, y, m) ||
      inPZ(x, y, m) ||
      LV.side.some((r) => inR(r, x, y, m)) ||
      LV.lots.some((l) => l.mat !== 'dirt' && inR(l, x, y, m));
    const cols = LV.props
      .filter((o) => vis({ x0: o.col.x0 - 80, y0: o.col.y0 - 80, x1: o.col.x1 + 80, y1: o.col.y1 + 80 }))
      .map((o) => o.col);
    const solid = (x, y, m) => cols.some((q) => inR(q, x, y, m));
    const near = (x, y, rx, ry) => x + rx > gx0 && x - rx < gx1 && y + ry > gy0 && y - ry < gy1;
    const P = [],
      BED = []; // plants: [gx, gy, sprite, width, flip]; beds where slabs are gone: [gx, gy, r, hash]
    if (LV.map === 'lab') {
      yield* paintLab(LV, g, x0, y0, ground, vis, V, gx0, gy0, gx1, gy1);
      g.setTransform(1, 0, 0, 1, 0, 0);
      return c;
    }
    const plant = (gx, gy, h, sc = 1) => {
      const k = PLANTS[Math.floor(h * PLANTS.length) % PLANTS.length];
      P.push([gx, gy, k[0], (k[1] + ((h * 97.3) % 1) * k[2]) * sc, (h * 13.7) % 1 < 0.5]);
    };
    BEDS = BED;
    // grass everywhere, meadows with flowers and bare patches in it, the world's edge in shadow
    patFill(g, PAT.grass, gx0, gy0, gx1 - gx0, gy1 - gy0);
    softLayer(
      g,
      PAT.flowers,
      x0,
      y0,
      (mg) => {
        LV.dirt.forEach(([x, y, rx, ry, s], i) => {
          if (i % 2 && near(x, y, rx * 1.4, ry * 1.4)) {
            blobAt(mg, x, y, rx * 1.4, ry * 1.4, s);
            mg.fill();
          }
        });
      },
      10,
    );
    softLayer(
      g,
      PAT.dirt,
      x0,
      y0,
      (mg) => {
        LV.dirt.forEach(([x, y, rx, ry, s], i) => {
          if (!(i % 2) && near(x, y, rx, ry)) {
            blobAt(mg, x, y, rx, ry, s);
            mg.fill();
          }
        });
        for (const l of LV.lots) if (l.mat === 'dirt' && vis(l)) mg.fillRect(l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0);
      },
      6,
    );
    yield;
    ground();
    g.fillStyle = 'rgba(14,28,12,0.4)';
    g.fillRect(-2400, -2400, Gs + 4800, 2400);
    g.fillRect(-2400, Gs, Gs + 4800, 2400);
    g.fillRect(-2400, 0, 2400, Gs);
    g.fillRect(Gs, 0, 2400, Gs);
    // the plazas, under the roads and sidewalks (laid over them): slabs breaking up at the plaza's edge, beds of grass along the
    // sidewalks and here and there inside (value noise), single slabs missing; weeds in the gaps, tufts in the joints
    const walks = LV.roads
      .concat(LV.side)
      .filter((r) => vis({ x0: r.x0 - 300, y0: r.y0 - 300, x1: r.x1 + 300, y1: r.y1 + 300 }));
    const dWalk = (x, y) => {
      let d = 1e9;
      for (const r of walks) d = Math.min(d, Math.max(r.x0 - x, x - r.x1, r.y0 - y, y - r.y1));
      return d;
    }; // to the nearest road or sidewalk (on one: <= 0)
    for (const q of LV.plazas) {
      if (!vis(q)) continue;
      g.fillStyle = 'rgba(10,6,16,0.24)';
      g.fillRect(q.x0 - 6, q.y0 - 6, q.x1 - q.x0 + 12, q.y1 - q.y0 + 12);
      slabs(
        g,
        q,
        'light',
        V,
        59,
        (x, y, s) => {
          const dr = dWalk(x, y);
          if (dr <= 0) return false;
          const de = Math.min(x - q.x0, q.x1 - x, y - q.y0, q.y1 - y),
            n = fbm(x, y),
            h = rnd(Math.floor(x / s) * 1.37 + 5, Math.floor(y / s) * 2.11 + 9),
            belt = dr < 230 ? Math.min(1, 1.5 - dr / 150) : 0;
          return n * 0.5 + belt * 0.6 > 0.64 || n > 0.77 || h < (de < CELL * 1.2 ? 0.5 : de < CELL * 2.6 ? 0.2 : 0.035);
        },
        (x, y, s, hole, h) => {
          if (dWalk(x, y) <= 0) return;
          if (hole) {
            const j = (k) => (((h * k) % 1) - 0.5) * s;
            plant(x + j(3.1) * 0.3, y + j(7.3) * 0.3, h, 1.25);
            plant(x - s * 0.36, y + j(5.9) * 0.6, (h * 3.3) % 1, 0.9);
            plant(x + j(9.7) * 0.6, y - s * 0.36, (h * 6.1) % 1, 0.85);
          } else if (h < 0.08) plant(x - s / 2, y - s / 2, (h * 11.1) % 1, 0.6);
        },
      );
    }
    yield;
    ground();
    // yards, sidewalks: light slabs; a yard's edge crumbles into the grass
    for (const l of LV.lots)
      if (l.mat !== 'dirt' && vis(l)) {
        g.fillStyle = 'rgba(10,6,16,0.22)';
        g.fillRect(l.x0 - 5, l.y0 - 5, l.x1 - l.x0 + 10, l.y1 - l.y0 + 10);
        slabs(
          g,
          l,
          'light',
          V,
          11,
          (x, y, s) => Math.min(x - l.x0, l.x1 - x, y - l.y0, l.y1 - y) < s * 0.8 && rnd(x * 0.37 + 3, y * 0.21) < 0.3,
          (x, y, s, hole, h) => {
            if (hole && h < 0.7) plant(x, y, h);
          },
        );
      }
    yield;
    for (const sd of LV.side)
      if (vis(sd))
        slabs(
          g,
          sd,
          'light',
          V,
          23,
          (x, y) => !road(x, y, 40) && rnd(x * 0.29 + 1, y * 0.43) < (inPZ(x, y) ? 0.22 : 0.07),
          (x, y, s, hole, h) => {
            if (hole) {
              plant(x, y, h, 1.15);
              if (h < 0.5) plant(x + s * 0.3, y - s * 0.25, (h * 4.7) % 1, 0.8);
            }
          },
        );
    yield;
    // roads: dark slabs, kerbs, worn paint
    for (const r of LV.roads)
      if (vis(r)) {
        g.fillStyle = '#5a5a63';
        g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        g.globalAlpha = 0.72;
        slabs(g, r, 'road', V, 41, null, null);
        g.globalAlpha = 1;
      }
    kerbs(g, LV, V);
    yield;
    markings(g, LV, x0, y0);
    yield;
    ground();
    ground();
    BEDS = null;
    yield;
    softLayer(
      g,
      'rgba(14,18,8,0.3)',
      x0,
      y0,
      (mg) => {
        for (const [x, y, r, h] of BED) {
          blobAt(mg, x + 3, y + 3, r * (1.1 + h * 0.3), r * (1.1 + ((h * 3.7) % 0.3)), h);
          mg.fill();
        }
      },
      2.5,
    );
    yield;
    softLayer(
      g,
      PAT.grass,
      x0,
      y0,
      (mg) => {
        for (const [x, y, r, h] of BED) {
          blobAt(mg, x, y, r * (1.05 + h * 0.3), r * (1.05 + ((h * 3.7) % 0.3)), h);
          mg.fill();
        }
        for (const [x, y, rx, ry, s] of LV.moss)
          if (near(x, y, rx, ry) && !road(x, y, 76)) {
            blobAt(mg, x, y, rx, ry, s);
            mg.fill();
          }
        for (const [x, y, rx, ry, s] of LV.grass)
          if (near(x, y, rx, ry) && !road(x, y, 30) && !inPZ(x, y, 60)) {
            blobAt(mg, x, y, rx * 0.8, ry * 0.8, s);
            mg.fill();
          }
      },
      1.6,
    );
    for (const [x, y, rx, ry, s] of LV.moss)
      if (near(x, y, rx + 60, ry + 60) && s < 0.75 && !road(x, y, 76)) plant(x, y, s);
    for (const [x, y, rx, ry, s] of LV.grass)
      if (near(x, y, rx + 60, ry + 60) && !road(x, y, 30) && !inPZ(x, y, 60)) {
        plant(x, y, s);
        plant(x + rx * 0.4, y - ry * 0.3, (s * 5.7) % 1, 0.85);
      }
    yield;
    // weeds along every paved edge and over the yards
    for (const sd of LV.side)
      if (vis(sd)) {
        const v = sd.y1 - sd.y0 > sd.x1 - sd.x0;
        for (const e of v ? [sd.x0, sd.x1] : [sd.y0, sd.y1]) {
          const o = v
            ? road(e - 6, sd.y0 + 1) || road(e + 6, sd.y0 + 1)
            : road(sd.x0 + 1, e - 6) || road(sd.x0 + 1, e + 6);
          if (o) continue;
          for (let t = Math.ceil((v ? sd.y0 : sd.x0) / 34) * 34; t < (v ? sd.y1 : sd.x1); t += 34) {
            const x = v ? e : t,
              y = v ? t : e,
              h = rnd(x * 0.13 + 7, y * 0.17 + 3);
            if (h > 0.55 || !V(x, y, 80)) continue;
            if (paved(v ? x + (e === sd.x0 ? -10 : 10) : x, v ? y : y + (e === sd.y0 ? -10 : 10))) continue;
            plant(x + (h - 0.27) * 14, y + (h - 0.27) * 10, h / 0.55);
          }
        }
      }
    for (const l of LV.lots)
      if (l.mat !== 'dirt' && vis(l))
        for (let t = 0; t < 1; t += 0.06)
          for (const [x, y] of [
            [l.x0 + (l.x1 - l.x0) * t, l.y1],
            [l.x1, l.y0 + (l.y1 - l.y0) * t],
            [l.x0 + (l.x1 - l.x0) * t, l.y0],
            [l.x0, l.y0 + (l.y1 - l.y0) * t],
          ]) {
            const h = rnd(x * 0.11 + 2, y * 0.19 + 5);
            if (h < 0.5 && V(x, y, 80) && !solid(x, y, 4)) plant(x, y, h * 2);
          }
    yield;
    for (let gy = Math.floor(gy0 / 70) * 70; gy < gy1; gy += 70)
      for (let gx = Math.floor(gx0 / 70) * 70; gx < gx1; gx += 70) {
        const h = rnd(gx * 0.071 + 13, gy * 0.053 + 17),
          x = gx + (h - 0.5) * 50,
          y = gy + (((h * 7.1) % 1) - 0.5) * 50;
        if (h > 0.3 || !V(x, y, 80) || paved(x, y, 8) || solid(x, y, 12)) continue;
        plant(x, y, h / 0.3);
      }
    // kerb-stone runs (the set's tile row 3): along the front edges of the yards and the plaza's sidewalks on their grass side
    const kerb = (gx, gy, alongX, h) => {
      if (h > 0.42 || !V(gx, gy, 140) || road(gx, gy, 12) || solid(gx, gy, 30)) return;
      P.push([
        gx + (alongX ? 0 : 8),
        gy + (alongX ? 8 : 0),
        KERBS[Math.floor((h / 0.42) * KERBS.length) % KERBS.length],
        112 + ((h * 31.7) % 1) * 24,
        !alongX,
        0.55,
      ]);
    }; // a run's middle sits on the edge (a plant's foot does)
    for (const l of LV.lots)
      if (l.mat !== 'dirt' && vis(l)) {
        for (let x = l.x0 + 50; x < l.x1 - 40; x += 104) kerb(x, l.y1, true, rnd(x * 0.07 + 1, l.y1 * 0.03));
        for (let y = l.y0 + 50; y < l.y1 - 40; y += 104) kerb(l.x1, y, false, rnd(l.x1 * 0.05 + 3, y * 0.09));
      }
    for (const pz of LV.plazas)
      for (const sd of LV.side)
        if (vis(sd)) {
          const v = sd.y1 - sd.y0 > sd.x1 - sd.x0,
            e = v ? (road(sd.x0 - 6, sd.y0 + 1) ? sd.x1 : sd.x0) : road(sd.x0 + 1, sd.y0 - 6) ? sd.y1 : sd.y0;
          for (let t = (v ? pz.y0 : pz.x0) + 50; t < (v ? pz.y1 : pz.x1) - 40; t += 104) {
            const x = v ? e : t,
              y = v ? t : e;
            if (inR(pz, x, y) && !paved(v ? x + (e === sd.x0 ? -12 : 12) : x, v ? y : y + (e === sd.y0 ? -12 : 12)))
              kerb(x, y, !v, rnd(x * 0.11 + 5, y * 0.13 + 2) * 0.8);
          }
        }
    yield;
    // ground decor: manholes, stains, graffiti, flower clumps
    const ell = (x, y, rx, ry, a) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, a, 0, TAU);
    };
    for (const d of LV.decor) {
      if (d.gx < gx0 - 100 || d.gx > gx1 + 100 || d.gy < gy0 - 100 || d.gy > gy1 + 100) continue;
      if (d.k === 'manhole') {
        ell(d.gx, d.gy, 26, 26, 0);
        g.fillStyle = '#25242a';
        g.fill();
        g.strokeStyle = '#4e4a50';
        g.lineWidth = 4;
        g.stroke();
        g.strokeStyle = 'rgba(110,105,110,0.5)';
        g.lineWidth = 2;
        for (let k = -2; k <= 2; k++) {
          g.beginPath();
          g.moveTo(d.gx - 17, d.gy + k * 7);
          g.lineTo(d.gx + 17, d.gy + k * 7);
          g.stroke();
        }
      } else if (d.k === 'stain') {
        ell(d.gx, d.gy, d.s, d.s * 0.6, d.a);
        g.fillStyle = 'rgba(8,6,14,0.2)';
        g.fill();
      } else if (
        d.k === 'graf' &&
        IMG[d.img] &&
        !BED.some(([x, y, r]) => Math.abs(d.gx - x) < r + 40 && Math.abs(d.gy - y) < r + 40) &&
        paved(d.gx, d.gy)
      ) {
        const im = IMG[d.img];
        g.save();
        g.setTransform(K, 0, 0, K, 0, 0);
        const sx = d.gx - d.gy + Gs - x0,
          sy = (d.gx + d.gy) / 2 - y0;
        g.translate(sx, sy);
        g.rotate(d.a * 0.3);
        g.globalAlpha = 0.7;
        g.drawImage(im, -d.s / 2, -d.s * 0.3, d.s, d.s * 0.6);
        g.restore();
      } else if (d.k === 'flower' && !road(d.gx, d.gy, 10)) plant(d.gx, d.gy, (d.s * 0.137) % 1, 0.9);
    }
    yield;
    // the plants, back to front, each on a little contact shadow
    g.setTransform(K, 0, 0, K, 0, 0);
    P.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    for (const [gx, gy, n, w, fl, an = 0.9] of P) {
      const m = MIP[n];
      if (!m) continue;
      const X = gx - gy + Gs - x0,
        Y = (gx + gy) / 2 - y0,
        im = mipFor(m, w * K),
        h = (w * im.height) / im.width;
      if (X < -w || X > CH + w || Y < -h * 0.5 || Y > CH + h) continue;
      if (an > 0.8) {
        g.fillStyle = 'rgba(14,24,8,0.16)';
        g.beginPath();
        g.ellipse(X + w * 0.06, Y + 1, w * 0.36, w * 0.13, 0, 0, TAU);
        g.fill();
      }
      if (fl) {
        g.save();
        g.translate(X, 0);
        g.scale(-1, 1);
        g.drawImage(im, -w / 2, Y - h * an, w, h);
        g.restore();
      } else g.drawImage(im, X - w / 2, Y - h * an, w, h);
    }
    ground();
    // contact shadows (ambient occlusion) under every standing footprint, then the cast shadows
    for (const p of LV.props) {
      const cl = p.col;
      if (p.hp || cl.x1 < gx0 || cl.x0 > gx1 || cl.y1 < gy0 || cl.y0 > gy1) continue;
      const pad = p.bld ? 34 : 16,
        a = p.bld ? 0.6 : 0.55;
      g.save();
      g.translate((cl.x0 + cl.x1) / 2 + 6, (cl.y0 + cl.y1) / 2 + 6);
      g.scale((cl.x1 - cl.x0) / 2 + pad, (cl.y1 - cl.y0) / 2 + pad);
      const gr = g.createRadialGradient(0, 0, 0.2, 0, 0, 1.15);
      gr.addColorStop(0, `rgba(12,4,20,${a})`);
      gr.addColorStop(0.7, `rgba(12,4,20,${a * 0.55})`);
      gr.addColorStop(1, 'rgba(12,4,20,0)');
      g.fillStyle = gr;
      g.fillRect(-1.2, -1.2, 2.4, 2.4);
      g.restore();
    }
    yield;
    castShadows(g, LV, x0, y0, V);
    yield;
    // large soft tint variation so tiling never reads as a grid
    ground();
    for (const [bx, by, br, dk] of LV.tints) {
      if (bx + br < gx0 || bx - br > gx1 || by + br < gy0 || by - br > gy1) continue;
      const gr = g.createRadialGradient(bx, by, 0, bx, by, br);
      gr.addColorStop(0, dk ? 'rgba(30,10,40,0.14)' : 'rgba(255,220,140,0.07)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }
  // paved ground over a rect r (ground units, clipped to it): the set's slabs, a 2 × 2 block at a time (one four-slab tile or
  // four single slabs). hole(x, y, s) → true where the slab at that centre is gone; each(x, y, s, hole, hash) for the plants
  function slabs(g, r, set, V, sd, hole, each) {
    const T0 = SLABS[set],
      c = T0.c,
      c2 = c * 2;
    g.save();
    g.beginPath();
    g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    g.clip();
    for (let bj = Math.floor(r.y0 / c2); bj * c2 < r.y1; bj++)
      for (let bi = Math.floor(r.x0 / c2); bi * c2 < r.x1; bi++) {
        const bx = bi * c2,
          by = bj * c2;
        if (!V(bx + c, by + c, c2)) continue;
        if (rnd(bi * 7.13 + sd, bj * 3.71 + 1) < T0.big) {
          const x = bx + c,
            y = by + c,
            ho = !!(hole && hole(x, y, c2));
          if (!ho) slab(g, T0.two, bx, by, c2, bi, bj, sd + 3);
          else gap(g, bx + c, by + c, c2);
          if (each) each(x, y, c2, ho, rnd(bi * 5.3 + sd, bj * 2.9 + 4));
          continue;
        }
        for (let q = 0; q < 4; q++) {
          const ci = bi * 2 + (q & 1),
            cj = bj * 2 + (q >> 1),
            x = ci * c + c / 2,
            y = cj * c + c / 2,
            ho = !!(hole && hole(x, y, c));
          if (!ho) slab(g, T0.one, ci * c, cj * c, c, ci, cj, sd);
          else gap(g, x, y, c);
          if (each) each(x, y, c, ho, rnd(ci * 5.3 + sd, cj * 2.9 + 4));
        }
      }
    g.restore();
  }
  let BEDS = null; // the chunk being painted collects its beds here (paintChunk)
  function gap(g, x, y, s) {
    if (BEDS) BEDS.push([x, y, s * 0.62, rnd(x * 0.31 + 2, y * 0.17 + 5)]);
  }
  function slab(g, list, x, y, s, i, j, sd) {
    const h1 = rnd(i * 3.1 + sd, j * 1.7 + 3),
      h2 = rnd(i * 1.1 + sd, j * 2.9 + 7),
      h3 = rnd(i + sd * 3, j * 0.5 + 11);
    const im = TILE[list[Math.floor(h1 * list.length)] + '@' + s];
    if (!im) return;
    g.save();
    g.translate(x + s / 2, y + s / 2);
    g.rotate((Math.floor(h2 * 4) * Math.PI) / 2);
    if (h3 < 0.5) g.scale(-1, 1);
    g.drawImage(im, -s / 2, -s / 2, s, s);
    const tn = (h3 * 7.3) % 1;
    g.fillStyle = tn < 0.6 ? `rgba(24,16,34,${(0.6 - tn) * 0.18})` : `rgba(255,238,214,${(tn - 0.6) * 0.14})`;
    g.fillRect(-s / 2, -s / 2, s, s);
    g.strokeStyle = 'rgba(20,14,26,0.38)';
    g.lineWidth = 1.3;
    g.strokeRect(-s / 2 + 0.75, -s / 2 + 0.75, s - 1.5, s - 1.5);
    g.restore();
  }
  // another road crossing road r between t0 and t1 along it (m: the margin either side of the crossing road)
  const crossing = (LV, r, t0, t1, m) =>
    LV.roads.some(
      (q) =>
        q.ax !== r.ax &&
        (r.ax === 'gy'
          ? q.x0 < r.x1 && q.x1 > r.x0 && t1 > q.y0 - m && t0 < q.y1 + m
          : q.y0 < r.y1 && q.y1 > r.y0 && t1 > q.x0 - m && t0 < q.x1 + m),
    );
  // kerb stones along both edges of every road, between the crossings (a gutter shadow on the road side)
  function kerbs(g, LV, V) {
    for (const r of LV.roads) {
      const v = r.ax === 'gy',
        t0 = v ? r.y0 : r.x0,
        t1 = v ? r.y1 : r.x1;
      for (const e of v ? [r.x0, r.x1] : [r.y0, r.y1]) {
        const lo = e === (v ? r.x0 : r.y0),
          k0 = lo ? e - 11 : e;
        for (let t = Math.ceil(t0 / 48) * 48; t + 48 <= t1; t += 48) {
          if (crossing(LV, r, t, t + 48, 74) || !V(v ? e : t + 24, v ? t + 24 : e, 90)) continue;
          g.fillStyle = '#9d979b';
          v ? g.fillRect(k0, t + 1, 11, 46) : g.fillRect(t + 1, k0, 46, 11);
          g.fillStyle = 'rgba(255,244,228,0.3)';
          v ? g.fillRect(lo ? k0 : k0 + 8, t + 1, 3, 46) : g.fillRect(t + 1, lo ? k0 : k0 + 8, 46, 3);
          g.fillStyle = 'rgba(10,6,16,0.4)';
          v ? g.fillRect(lo ? e : e - 5, t, 5, 48) : g.fillRect(t, lo ? e : e - 5, 48, 5);
        }
      }
    }
  }
  // road paint: amber centre dashes, white edge lines, zebra crossings; drawn apart, eaten through by specks, laid on the road
  function markings(g, LV, x0, y0) {
    const [m] = SCR,
      mg = m.getContext('2d');
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.clearRect(0, 0, SW, SW);
    mg.setTransform(...scrT(x0, y0));
    for (const r of LV.roads) {
      const v = r.ax === 'gy',
        c = v ? (r.x0 + r.x1) / 2 : (r.y0 + r.y1) / 2,
        e0 = v ? r.x0 : r.y0,
        e1 = v ? r.x1 : r.y1,
        t0 = v ? r.y0 : r.x0,
        t1 = v ? r.y1 : r.x1;
      const inX = (t, m) => crossing(LV, r, t, t, m);
      mg.fillStyle = 'rgba(228,168,48,0.92)';
      for (let t = Math.ceil(t0 / 120) * 120; t + 64 <= t1; t += 120) {
        if (inX(t, 12) || inX(t + 64, 12)) continue;
        v ? mg.fillRect(c - 5, t, 10, 64) : mg.fillRect(t, c - 5, 64, 10);
      }
      mg.fillStyle = 'rgba(238,234,224,0.86)';
      for (const e of [e0 + 16, e1 - 22])
        for (let t = Math.ceil(t0 / 24) * 24; t + 24 <= t1; t += 24) {
          if (inX(t, 96) || inX(t + 24, 96)) continue;
          v ? mg.fillRect(e, t, 6, 24) : mg.fillRect(t, e, 24, 6);
        }
    }
    mg.fillStyle = 'rgba(240,236,224,0.84)';
    // zebras on every arm of a crossing that goes on past it (none on a crossing inside a plaza)
    for (const r of LV.roads)
      if (r.ax === 'gy')
        for (const q of LV.roads)
          if (q.ax === 'gx' && q.x0 < r.x1 && q.x1 > r.x0 && r.y0 < q.y1 && r.y1 > q.y0) {
            const a = r.x0,
              b = r.x1,
              c = q.y0,
              d = q.y1;
            if (inPlaza(LV, (a + b) / 2, (c + d) / 2)) continue;
            for (let y = c + 20; y < d - 16; y += 36) {
              if (q.x0 < a - 86) mg.fillRect(a - 86, y, 62, 20);
              if (q.x1 > b + 86) mg.fillRect(b + 24, y, 62, 20);
            }
            for (let x = a + 20; x < b - 16; x += 36) {
              if (r.y0 < c - 86) mg.fillRect(x, c - 86, 20, 62);
              if (r.y1 > d + 86) mg.fillRect(x, d + 24, 20, 62);
            }
          }
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.globalCompositeOperation = 'destination-out';
    mg.fillStyle = mg.createPattern(NOISE, 'repeat');
    mg.fillRect(0, 0, SW, SW);
    mg.globalCompositeOperation = 'source-over';
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(m, -SP, -SP);
    g.restore();
  }
  // cast shadows: a prop's footprint swept along the light by its height (the union of every slice of a box), poles and trunks as
  // thin sweeps, crowns and bushes as discs; drawn darkest-wins in a cool grey, blurred, and multiplied over the ground.
  // Destructibles cast theirs live (shadows()), so a crate's shadow goes with it. The lab's props (a base line each, baseOf) lay theirs
  // along where the drawing meets the floor: the ground from that line back to the footprint's far edge, swept a little along the light
  // (a round tank's shadow is round, a table's lies between its legs; the footprint rectangle stuck out of them as a dark plate)
  function castShadows(g, LV, x0, y0, V) {
    const [m] = SCR,
      sg = m.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalCompositeOperation = 'source-over';
    sg.fillStyle = '#fff';
    sg.fillRect(0, 0, SW, SW);
    sg.setTransform(...scrT(x0, y0));
    sg.globalCompositeOperation = 'darken';
    const hull = (q, ox, oy, col) => {
      sg.fillStyle = col;
      sg.beginPath();
      sg.moveTo(q.x0, q.y0);
      sg.lineTo(q.x1, q.y0);
      sg.lineTo(q.x1 + ox, q.y0 + oy);
      sg.lineTo(q.x1 + ox, q.y1 + oy);
      sg.lineTo(q.x0 + ox, q.y1 + oy);
      sg.lineTo(q.x0, q.y1);
      sg.closePath();
      sg.fill();
    };
    const disc = (x, y, r, col) => {
      sg.fillStyle = col;
      sg.beginPath();
      sg.ellipse(x, y, r, r * 0.9, 0.3, 0, TAU);
      sg.fill();
    };
    const lab = LV.map === 'lab',
      sk = lab ? LAB_SHADOW : 1; // (the lab: lit from above, the shadows short)
    for (const o of LV.props) {
      if (o.hp || o.hide) continue;
      const q = o.col;
      const H =
          (o.wall ? 30 : o.post ? 38 : clamp(o.w * aspect(o, 0.8) - (o.fw + o.fh) / 2, 6, o.bld ? 200 : 210)) * sk,
        ox = LX * H,
        oy = LY * H;
      if (!V((q.x0 + q.x1) / 2 + ox / 2, (q.y0 + q.y1) / 2 + oy / 2, (q.x1 - q.x0 + q.y1 - q.y0) / 2 + H + 40))
        continue;
      const bl = lab ? baseOf(o) : null;
      if (bl && bl.length >= 4) {
        baseShadow(sg, o, bl, ox - oy, (ox + oy) / 2, x0, y0);
        continue;
      }
      if (o.lamp) {
        hull({ x0: o.gx - 6, y0: o.gy - 6, x1: o.gx + 6, y1: o.gy + 6 }, ox * 0.95, oy * 0.95, '#7d7898');
        disc(o.gx + ox, o.gy + oy, 16, '#7d7898');
        continue;
      }
      hull(
        q,
        ox,
        oy,
        /fence|mesh|gate|rail/.test(o.n) ? '#b3aec6' : /sign/.test(o.n) ? '#9a95b2' : o.bld ? '#66617f' : '#6c6789',
      );
    }
    for (const t of LV.trees) {
      const H = t.w * 0.55,
        ox = LX * H,
        oy = LY * H;
      if (!V(t.gx + ox, t.gy + oy, t.w)) continue;
      hull({ x0: t.gx - 5, y0: t.gy - 5, x1: t.gx + 5, y1: t.gy + 5 }, ox * 0.8, oy * 0.8, '#948fab');
      disc(t.gx + ox, t.gy + oy, t.w * 0.3, '#8e89a6');
    }
    for (const b of LV.bushes) {
      const H = b.w * 0.3;
      if (!V(b.gx + LX * H, b.gy + LY * H, b.w)) continue;
      disc(b.gx + LX * H, b.gy + LY * H, b.w * 0.34, '#a29db7');
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.filter = `blur(${((lab ? 4.2 : 3.2) * K).toFixed(1)}px)`;
    g.drawImage(m, -SP, -SP);
    g.restore();
  }
  // a lab prop's shadow (castShadows): in the chunk's screen px, the band between its drawing's base line (bl: [u, v, ...] across the
  // drawn width, up from its bottom; mirrored with the prop) and the far edge of its footprint, kept to the footprint's width (and a
  // little more: a drawing is a tenth wider), laid at the foot and swept by (dx, dy) along the light, a shade lighter as it goes
  function baseShadow(sg, o, bl, dx, dy, x0, y0) {
    const q = o.col,
      S = (gx, gy) => [gx - gy + GS - x0, (gx + gy) / 2 - y0],
      w = o.w,
      xl = o.gx - o.gy + GS - x0 - w / 2,
      yb = S(q.x1, q.y1)[1];
    const L = S(q.x0, q.y1),
      Bk = S(q.x0, q.y0),
      R = S(q.x1, q.y0);
    const far = (x) => {
      x = clamp(x, L[0], R[0]);
      return x <= Bk[0]
        ? L[1] + ((x - L[0]) * (Bk[1] - L[1])) / Math.max(1e-3, Bk[0] - L[0])
        : Bk[1] + ((x - Bk[0]) * (R[1] - Bk[1])) / Math.max(1e-3, R[0] - Bk[0]);
    };
    const pts = [];
    for (let i = 0; i < bl.length; i += 2) pts.push([xl + (o.flip ? 1 - bl[i] : bl[i]) * w, yb - bl[i + 1] * w]);
    if (o.flip) pts.reverse();
    const at = (x) => {
      if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++)
        if (x <= pts[i][0]) {
          const a = pts[i - 1],
            b = pts[i];
          return a[1] + ((x - a[0]) * (b[1] - a[1])) / Math.max(1e-3, b[0] - a[0]);
        }
      return pts[pts.length - 1][1];
    };
    const m = w * 0.06,
      xa = Math.max(pts[0][0], L[0] - m),
      xb = Math.min(pts[pts.length - 1][0], R[0] + m);
    if (xb - xa < 2) return;
    const N = 20,
      bot = [],
      top = [];
    for (let i = 0; i <= N; i++) {
      const x = xa + ((xb - xa) * i) / N,
        y = at(x);
      bot.push([x, y]);
      top.push([x, Math.min(y - 6, far(x))]);
    }
    sg.save();
    sg.setTransform(K, 0, 0, K, SP, SP);
    for (const [t, col] of [
      [1, '#7d7898'],
      [0.66, '#76718f'],
      [0.33, '#706b8a'],
      [0, '#655f80'],
    ]) {
      sg.fillStyle = col;
      sg.beginPath();
      bot.forEach(([x, y], i) => (i ? sg.lineTo(x + dx * t, y + dy * t) : sg.moveTo(x + dx * t, y + dy * t)));
      for (let i = N; i >= 0; i--) sg.lineTo(top[i][0] + dx * t, top[i][1] + dy * t);
      sg.closePath();
      sg.fill();
    }
    sg.restore();
  }
  // a material poured through a blurred mask: crisp texture, soft organic edge (no hard programmer polygons)
  function softLayer(g, pat, x0, y0, shapes, blur) {
    const [m, m2, t] = SCR,
      Gs = GS,
      tr = scrT(x0, y0);
    const mg = m.getContext('2d');
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.globalCompositeOperation = 'source-over';
    mg.clearRect(0, 0, SW, SW);
    mg.setTransform(...tr);
    mg.fillStyle = '#fff';
    shapes(mg);
    const m2g = m2.getContext('2d');
    m2g.setTransform(1, 0, 0, 1, 0, 0);
    m2g.clearRect(0, 0, SW, SW);
    m2g.filter = `blur(${(blur * K).toFixed(1)}px)`;
    m2g.drawImage(m, 0, 0);
    m2g.filter = 'none';
    const tg = t.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, SW, SW);
    tg.setTransform(...tr);
    patFill(tg, pat, -3000, -3000, Gs + 6000, Gs + 6000);
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(m2, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(t, -SP, -SP);
    g.restore();
  }
  function blobAt(g, x, y, rx, ry, s) {
    const n = 22;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU,
        k = 0.74 + 0.2 * Math.sin(a * 3 + s * 20) + 0.1 * Math.sin(a * 5 + s * 9) + 0.07 * Math.sin(a * 11 + s * 31);
      const px = x + Math.cos(a) * rx * k,
        py = y + Math.sin(a) * ry * k;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
  }
  // ---------------- the worker (scene.js starts it: new Worker('ground.js')) ----------------
  // { setup: { v, q, G } } → { ready } (or { fail }: the page paints instead); { level: GROUND.slim(LV) }; { res: q };
  // { paint: { id, seed, cx, cy } } → { id, bmp, ms } (the picture, transferred) or { id, fail }
  if (!DOC && typeof importScripts === 'function') {
    const levels = {};
    let LOAD = null;
    self.onmessage = async (e) => {
      const m = e.data;
      try {
        if (m.setup) {
          const { v, q, G } = m.setup;
          if (
            typeof OffscreenCanvas === 'undefined' ||
            !new OffscreenCanvas(1, 1).getContext('2d') ||
            typeof createImageBitmap !== 'function'
          )
            throw new Error('no OffscreenCanvas 2d here');
          GR.res(q);
          const load = async (n) => {
            try {
              const r = await fetch('assets/' + n + '.png?v=' + v, { headers: { Accept: 'image/webp,image/*,*/*' } });
              return r.ok ? await createImageBitmap(await r.blob()) : null;
            } catch (err) {
              return null;
            }
          };
          LOAD = load;
          await GR.setup(load, { G });
          postMessage({ ready: true });
        } else if (m.level) levels[m.level.seed] = m.level;
        else if (m.res !== undefined) GR.res(m.res);
        else if (m.paint) {
          const { id, seed, cx, cy } = m.paint;
          if (levels[seed] && levels[seed].map === 'lab') await GR.lab(LOAD);
          const t0 = performance.now(),
            it = GR.paint(levels[seed], cx, cy);
          let r;
          do r = it.next();
          while (!r.done);
          const bmp = r.value.transferToImageBitmap();
          postMessage({ id, bmp, ms: performance.now() - t0 }, [bmp]);
        }
      } catch (err) {
        postMessage({ fail: String((err && err.message) || err), id: m.paint ? m.paint.id : undefined });
      }
    };
  }
})(typeof window !== 'undefined' ? window : self);
