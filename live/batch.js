// live/batch.js — instanced quads on top of gl.js for crowds: texture atlases built at load (actors, props, canvas-made
// extras), one sorted sprite batch for the whole depth band (hundreds of rigged zombies = one draw call), and a procedural
// FX batch (soft discs, puffs, sparks, stars, rings, shadows, soft rects, boxes). Pure function of what the scene pushes.
(function () {
  const B = (window.BATCH = {});
  const FL = 20; // floats per instance
  let gl, quad, progS, progF;
  B.R = {}; // name -> { t, u0, v0, u1, v1, w, h }
  B.tex = [null, null, null];
  B.size = 4096;

  const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 i_m; layout(location=2) in vec2 i_t; layout(location=3) in vec4 i_uv; layout(location=4) in vec4 i_col;
layout(location=5) in vec4 i_fx; layout(location=6) in vec2 i_ex;
uniform vec2 u_res;
out vec2 v_uv; out vec2 v_q; out vec4 v_col; out vec4 v_fx; out vec2 v_px; out vec2 v_ex; flat out int v_tex;
void main(){ vec2 p = vec2(i_m.x * a_pos.x + i_m.z * a_pos.y + i_t.x, i_m.y * a_pos.x + i_m.w * a_pos.y + i_t.y);
  v_px = p; v_q = a_pos; v_uv = mix(i_uv.xy, i_uv.zw, a_pos); v_col = i_col; v_fx = i_fx; v_ex = i_ex; v_tex = int(i_fx.y + 0.5);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); }`;
  // sprite: atlas texel × colour, flash to white, light map share (fx.z), extra: ex.x = warm rim amount
  const FS_S = `#version 300 es
precision highp float;
in vec2 v_uv; in vec2 v_q; in vec4 v_col; in vec4 v_fx; in vec2 v_px; in vec2 v_ex; flat in int v_tex; out vec4 o;
uniform sampler2D u_t0, u_t1, u_t2, u_light; uniform vec2 u_res; uniform float u_lit;
void main(){
  vec4 c = v_tex == 0 ? texture(u_t0, v_uv) : v_tex == 1 ? texture(u_t1, v_uv) : texture(u_t2, v_uv);
  if (c.a < 0.003) discard;
  c.rgb *= v_col.rgb;
  if (u_lit > 0.5) { vec3 L = texture(u_light, vec2(v_px.x / u_res.x, 1.0 - v_px.y / u_res.y)).rgb;
    L = min(L, vec3(1.0)) + max(L - 1.0, 0.0) * 0.3;            // sprites: overbright light rolls off, a lamp warms an actor without burning it out
    c.rgb *= mix(vec3(1.0), L, v_fx.z); }
  c.rgb = mix(c.rgb, vec3(c.a), v_fx.x);                       // the hit flash is unlit: a true white blink
  c.rgb += vec3(1.0, 0.55, 0.25) * v_ex.x * c.a;
  o = c * v_col.a; }`;
  // fx: procedural shapes by kind (fx.x): 0 soft disc, 1 puff, 2 spark streak, 3 star, 4 ring, 5 shadow, 6 soft rect, 7 box, 8 ember ring,
  // 9 billow, 10 flame lobe, 11 line segment (bolts)
  const FS_F = `#version 300 es
precision highp float;
in vec2 v_uv; in vec2 v_q; in vec4 v_col; in vec4 v_fx; in vec2 v_px; in vec2 v_ex; flat in int v_tex; out vec4 o;
uniform sampler2D u_noise;
float vnoise(vec2 p){ return texture(u_noise, p * (1.0 / 32.0)).r; }       // value noise, one lattice cell a unit (NOISE: baked, tiling every 32)
void main(){
  int k = int(v_fx.x + 0.5); vec2 q = v_q * 2.0 - 1.0; float d = length(q), a = 0.0;
  if (k == 0) a = exp(-d * d * v_fx.z) * smoothstep(1.0, 0.75, d);
  else if (k == 1) { float n = vnoise(q * 2.6 + v_fx.w * 7.3) * 0.5 + vnoise(q * 5.1 - v_fx.w * 3.1) * 0.3; a = smoothstep(1.0, 0.2, d + n * 0.6 - 0.12); }
  else if (k == 2) { a = exp(-q.y * q.y * 9.0) * smoothstep(-1.0, 0.6, q.x) * smoothstep(1.0, 0.85, q.x); }
  else if (k == 3) { float s = 0.03 / (abs(q.x * q.y) * 6.0 + 0.03) * smoothstep(1.0, 0.0, d); a = clamp(s * 0.9 + exp(-d * d * 16.0), 0.0, 1.0); }
  else if (k == 4) { a = smoothstep(v_fx.z, 0.0, abs(d - 0.86)); }
  else if (k == 5) { a = smoothstep(1.0, 0.15, d); }
  else if (k == 6) { vec2 e = 1.0 - abs(q); float m = min(e.x, e.y); a = smoothstep(0.0, 0.12, m) * (0.55 + 0.45 * smoothstep(0.12, 0.0, m)); }
  else if (k == 7) { vec2 e = 1.0 - abs(q); a = step(0.0, min(e.x, e.y)); vec3 c = v_col.rgb * (q.y < -0.3 ? 1.25 : 1.0); o = vec4(c * a, a) * v_col.a; return; }
  else if (k == 8) { a = smoothstep(v_fx.z, 0.0, abs(d - 0.86)) * (0.6 + 0.4 * vnoise(vec2(atan(q.y, q.x) * 5.0, v_fx.w))); }
  else if (k == 11) { a = exp(-q.y * q.y * v_fx.w) * smoothstep(1.0, 1.0 - 2.0 * v_fx.z, abs(q.x)); }   // line segment: k = end-fade share, seed = edge sharpness
  else if (k == 9) { // billow: a cauliflower puff with a defined rim, lit from the upper left (smoke, fireball lobes)
    float n = vnoise(q * 3.0 + v_fx.w * 7.3) * 0.55 + vnoise(q * 6.5 - v_fx.w * 3.1) * 0.3 + vnoise(q * 13.0 + v_fx.w) * 0.15;
    float sh = d + (n - 0.45) * 0.6; a = smoothstep(0.96, 0.8, sh);
    float lit = mix(0.62, 1.22, smoothstep(0.7, -0.7, q.y + q.x * 0.35)) * (0.85 + 0.3 * n);
    o = vec4(v_col.rgb * lit * a, a * v_ex.x) * v_col.a; return; }
  else if (k == 10) { // flame lobe: emissive billow, hot in the middle, darker ragged rim
    float n = vnoise(q * 3.2 + v_fx.w * 5.1) * 0.55 + vnoise(q * 7.0 - v_fx.w * 2.3) * 0.3 + vnoise(q * 15.0 + v_fx.w) * 0.15;
    float sh = d + (n - 0.45) * 0.7; a = smoothstep(0.98, 0.78, sh);
    vec3 c = v_col.rgb * (1.35 - 0.6 * smoothstep(0.0, 0.95, sh));
    o = vec4(c * a, a * v_ex.x) * v_col.a; return; }
  o = vec4(v_col.rgb * a, a * v_ex.x) * v_col.a; }`;

  // the fx shader's value noise baked into a tiling texture: a 32 × 32 lattice of random values, smooth-interpolated (smoothstep) at 8
  // texels a cell; the GPU's bilinear filter does the rest. The billows and flame lobes take three octaves a pixel — three texture
  // reads instead of twelve hashes, a weak phone's GPU fills smoke and fire several times faster
  function noiseTex() {
    const N = 32,
      K = 8,
      S = N * K,
      h = (i, j) => {
        let p = ((((i % N) + N) % N) * 127.1 + (((j % N) + N) % N) * 311.7) * 0.1031;
        p -= Math.floor(p);
        p *= p + 33.33;
        p *= p + p;
        return p - Math.floor(p);
      };
    const px = new Uint8Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const cx = (x + 0.5) / K,
          cy = (y + 0.5) / K,
          i = Math.floor(cx),
          j = Math.floor(cy),
          fx = cx - i,
          fy = cy - j;
        const u = fx * fx * (3 - 2 * fx),
          v = fy * fy * (3 - 2 * fy),
          a = h(i, j),
          b = h(i + 1, j),
          c = h(i, j + 1),
          d = h(i + 1, j + 1);
        px[y * S + x] = Math.round(255 * ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v));
      }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, S, S, 0, gl.RED, gl.UNSIGNED_BYTE, px);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  let NOISE = null;
  function compile(vs, fs) {
    const mk = (t, s) => {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('batch: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('batch link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const a = gl.getActiveUniform(p, i);
      u[a.name] = gl.getUniformLocation(p, a.name);
    }
    return { p, u };
  }
  function makeVao(buf) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const L = [
      [1, 4, 0],
      [2, 2, 4],
      [3, 4, 6],
      [4, 4, 10],
      [5, 4, 14],
      [6, 2, 18],
    ];
    for (const [loc, n, off] of L) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, FL * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }
  class Buf {
    constructor(cap) {
      this.cap = cap;
      this.d = new Float32Array(cap * FL);
      this.n = 0;
      this.gb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gb);
      gl.bufferData(gl.ARRAY_BUFFER, this.d.byteLength, gl.DYNAMIC_DRAW);
    }
    grow() {
      const d = new Float32Array(this.cap * 2 * FL);
      d.set(this.d);
      this.d = d;
      this.cap *= 2;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gb);
      gl.bufferData(gl.ARRAY_BUFFER, d.byteLength, gl.DYNAMIC_DRAW);
      if (this.vao) gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
    slot() {
      if (this.n >= this.cap) this.grow();
      return this.n++ * FL;
    }
  }
  B.init = () => {
    gl = G.gl;
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    progS = compile(VS, FS_S);
    progF = compile(VS, FS_F);
    NOISE = noiseTex();
    B.S = new Buf(16384);
    B.F = new Buf(16384);
    B.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    B.size = Math.min(4096, B.maxTex);
  };

  // ---------- atlases ----------
  const loadImg = (src) =>
    new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  // A picture's bytes fetched and decoded off the page's thread (createImageBitmap): an Image element decodes on its first
  // drawImage, on the page, and a whole atlas of those froze the lobby for over a second on a slow phone. A browser without
  // createImageBitmap, or one that can't decode this file from a blob, takes the Image path as before. null: no such picture
  const BITMAPS = typeof createImageBitmap === 'function' && typeof fetch === 'function';
  const fetchPic = (src) =>
    BITMAPS
      ? fetch(src)
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => loadImg(src))
      : loadImg(src);
  const decodePic = (pic, src) =>
    pic instanceof Blob ? createImageBitmap(pic).catch(() => loadImg(src)) : Promise.resolve(pic);
  // the page's frames get a turn between batches of drawing (a message is not held back in a background tab as a timer is)
  const breathe = () =>
    new Promise((res) => {
      if (typeof MessageChannel === 'undefined') {
        setTimeout(res, 0);
        return;
      }
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        res();
      };
      ch.port2.postMessage(0);
    });
  const DECODE_N = 8, // pictures decoded at a time: all of an atlas at once would hold hundreds of MB of pixels
    DRAW_MS = 8; // drawing between two turns of the page, all the atlases being made together
  let drawT = 0;
  // list: [{ name, scale }] scale relative to the prepped image; returns when the texture is uploaded
  B.atlas = async (ti, list, extraCanvases = []) => {
    const k = B.size / 4096;
    const items = [];
    const srcs = list.map(
      (e) =>
        'assets/' + e.name + '.png?v=' + ((window.ASSETS && ASSETS[e.name] && ASSETS[e.name].v) || window.__V || 0),
    ); // (a picture redrawn since the build: its own v)
    const pics = await Promise.all(srcs.map(fetchPic));
    const man = window.ASSETS || {}; // painted size (gen/packslim.mjs ships smaller files)
    for (let i = 0; i < list.length; i++) {
      const e = list[i],
        m = man[e.name];
      let pic = pics[i];
      if (!pic) continue;
      // (the packing needs each picture's size: the manifest's; a picture it doesn't list is decoded now for its own)
      if (!(m && m.w && m.h) && pic instanceof Blob) pic = await decodePic(pic, srcs[i]);
      if (!pic) continue;
      const mw = (m && m.w) || pic.width,
        mh = (m && m.h) || pic.height;
      items.push({
        name: e.name,
        src: pic,
        url: srcs[i],
        w: Math.max(2, Math.round(mw * e.scale * k)),
        h: Math.max(2, Math.round(mh * e.scale * k)),
        mw,
        mh,
      });
    }
    for (const c of extraCanvases)
      items.push({
        name: c.name,
        src: c.cv,
        w: c.cv.width,
        h: c.cv.height,
        sw: c.cv.width,
        sh: c.cv.height,
        raw: true,
      });
    items.sort((a, b) => b.h - a.h);
    const S = B.size,
      pad = 3;
    let x, y, rowH;
    for (let tries = 0; ; tries++) {
      // shelf packing; too tall: the scaled items shrink 6 % and pack again
      x = pad;
      y = pad;
      rowH = 0;
      for (const it of items) {
        if (x + it.w + pad > S) {
          x = pad;
          y += rowH + pad * 2;
          rowH = 0;
        }
        it.x = x;
        it.y = y;
        x += it.w + pad * 2;
        rowH = Math.max(rowH, it.h);
      }
      if (y + rowH <= S || tries > 12) break;
      for (const it of items)
        if (!it.raw) {
          it.w = Math.max(2, Math.round(it.w * 0.94));
          it.h = Math.max(2, Math.round(it.h * 0.94));
        }
    }
    const H = Math.min(S, 1 << Math.ceil(Math.log2(y + rowH + pad)));
    if (y + rowH > S) console.warn('atlas', ti, 'overflow', y + rowH);
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const regs = {};
    for (let i0 = 0; i0 < items.length; i0 += DECODE_N) {
      const part = items.slice(i0, i0 + DECODE_N),
        decoded = await Promise.all(part.map((it) => decodePic(it.src, it.url)));
      for (let i = 0; i < part.length; i++) {
        const it = part[i],
          pic = decoded[i];
        it.src = null;
        if (!pic) continue; // (it would not decode: left out, as a picture that never came)
        if (performance.now() - drawT > DRAW_MS) {
          await breathe();
          drawT = performance.now();
        }
        // downscale in halving steps for quality, then bleed the edge 1 px so mips don't pick up the neighbours' colour
        let src = pic,
          sw = it.sw || pic.width,
          sh = it.sh || pic.height;
        const fw = sw,
          fh = sh;
        while (sw > it.w * 2.2) {
          const t = document.createElement('canvas');
          t.width = Math.max(1, sw >> 1);
          t.height = Math.max(1, sh >> 1);
          const tg = t.getContext('2d');
          tg.imageSmoothingQuality = 'high';
          tg.drawImage(src, 0, 0, sw, sh, 0, 0, t.width, t.height);
          src = t;
          sw = t.width;
          sh = t.height;
        }
        g.drawImage(src, 0, 0, sw, sh, it.x, it.y, it.w, it.h);
        if (pic.close) pic.close();
        regs[it.name] = {
          t: ti,
          u0: it.x / S,
          v0: it.y / H,
          u1: (it.x + it.w) / S,
          v1: (it.y + it.h) / H,
          w: it.mw || fw,
          h: it.mh || fh,
          aw: it.w,
          ah: it.h,
        }; // w, h: the painted size
      }
    }
    // (the regions and the texture change together: a frame drawn while a map's atlas is being made keeps the old ones whole)
    Object.assign(B.R, regs);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (B.tex[ti]) gl.deleteTexture(B.tex[ti]); // (atlas 1 is made again for another map)
    B.tex[ti] = t;
    B.atlasCanvas = B.atlasCanvas || [];
    B.atlasCanvas[ti] = { w: S, h: H, n: items.length };
  };
  B.has = (n) => !!B.R[n];

  // ---------- pushing instances ----------
  // m = [a, b, c, d, e, f]: unit quad (u, v) -> screen (a u + c v + e, b u + d v + f)
  B.spr = (name, m, r = 1, g = 1, b = 1, a = 1, flash = 0, lightK = 0.55, rim = 0, buf = B.S) => {
    const R = B.R[name];
    if (!R) return;
    if (LIB.ONLY.length && !LIB.ONLY.includes(name)) return; // ?only= / qa.mjs actor isolation
    const o = buf.slot(),
      d = buf.d;
    d[o] = m[0];
    d[o + 1] = m[1];
    d[o + 2] = m[2];
    d[o + 3] = m[3];
    d[o + 4] = m[4];
    d[o + 5] = m[5];
    d[o + 6] = R.u0;
    d[o + 7] = R.v0;
    d[o + 8] = R.u1;
    d[o + 9] = R.v1;
    d[o + 10] = r;
    d[o + 11] = g;
    d[o + 12] = b;
    d[o + 13] = a;
    d[o + 14] = flash;
    d[o + 15] = R.t;
    d[o + 16] = lightK;
    d[o + 17] = 0;
    d[o + 18] = rim;
    d[o + 19] = 0;
    return o;
  };
  // a horizontal band of a sprite: its rows from f0 to f1 (fractions of its height) on the quad m (a cloth drawn in strips)
  B.band = (name, m, f0, f1, r = 1, g = 1, b = 1, a = 1, flash = 0, lightK = 0.55) => {
    const o = B.spr(name, m, r, g, b, a, flash, lightK);
    if (o === undefined) return;
    const R = B.R[name],
      d = B.S.d;
    d[o + 7] = R.v0 + (R.v1 - R.v0) * f0;
    d[o + 9] = R.v0 + (R.v1 - R.v0) * f1;
  };
  // axis-aligned sprite: top-left (x, y), size (w, h), optional flip
  B.box = (name, x, y, w, h, flip, r, g, b, a, flash, lightK, buf) =>
    B.spr(name, flip ? [-w, 0, 0, h, x + w, y] : [w, 0, 0, h, x, y], r, g, b, a, flash, lightK, 0, buf);
  // procedural fx: kind, centre (x, y), radii (rx, ry), rotation, colour, alpha, k (sharpness / ring width), seed, alphaMul (premult share: 0 = additive glow, 1 = normal)
  B.fx = (kind, x, y, rx, ry, rot, r, g, b, a, k = 3, seed = 0, am = 1, buf = B.F) => {
    if (LIB.ONLY.length) return;
    const o = buf.slot(),
      d = buf.d,
      c = rot ? Math.cos(rot) : 1,
      s = rot ? Math.sin(rot) : 0; // (most come unrotated: no trig)
    const ax = c * rx * 2,
      ay = s * rx * 2,
      bx = -s * ry * 2,
      by = c * ry * 2;
    d[o] = ax;
    d[o + 1] = ay;
    d[o + 2] = bx;
    d[o + 3] = by;
    d[o + 4] = x - (ax + bx) / 2;
    d[o + 5] = y - (ay + by) / 2;
    d[o + 6] = 0;
    d[o + 7] = 0;
    d[o + 8] = 1;
    d[o + 9] = 1;
    d[o + 10] = r;
    d[o + 11] = g;
    d[o + 12] = b;
    d[o + 13] = a;
    d[o + 14] = kind;
    d[o + 15] = 0;
    d[o + 16] = k;
    d[o + 17] = seed;
    d[o + 18] = am;
    d[o + 19] = 0;
  };
  // flush a buffer with a blend mode ('over' premultiplied, 'add'); light: sample the light map
  B.flush = (buf, prog, blend = 'over', light = null, res = G.view()) => {
    if (!buf.n) return;
    const P = prog === 'fx' ? progF : progS;
    gl.useProgram(P.p);
    gl.uniform2fv(P.u.u_res, res);
    if (prog !== 'fx') {
      for (let i = 0; i < 3; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, B.tex[i] || B.tex[0]);
        gl.uniform1i(P.u['u_t' + i], i);
      }
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, light ? light.t : B.tex[0]);
      gl.uniform1i(P.u.u_light, 3);
      gl.uniform1f(P.u.u_lit, light ? 1 : 0);
    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, NOISE);
      gl.uniform1i(P.u.u_noise, 0);
    }
    gl.enable(gl.BLEND);
    if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.gb);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.d, 0, buf.n * FL);
    if (!buf.vao) buf.vao = makeVao(buf.gb);
    gl.bindVertexArray(buf.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buf.n);
    gl.bindVertexArray(null);
    G.blend();
    buf.n = 0;
  };
  // separate buffers for layered passes inside one frame
  B.buf = (cap = 4096) => new Buf(cap);
})();
