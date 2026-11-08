// live/gunmesh.js — the guns as meshes, modelled in Blender to match art/refs/guns2 (art/guns3d/<gun>.py, gen/blender): the mesh
// live/assets/m_<gun>.bin and its baked colour atlas t_<gun>.jpg, its anchors (grips, muzzle, port, spin axis) in DATA.GUN3D.
// The penguin is raymarched in one quad (penguin.js) and the canvas has no depth, so the hero is drawn through a small offscreen
// LAYER with depth and multisampling: the gun first (an ink outline from its back faces pushed out, then the gun), then the penguin
// (its LAYER variant writes the depth of what each pixel shows), so the flippers close round the grips and the gun passes in front
// of and behind the body as it should; the layer is then laid over the target like a sprite, faded by the hero's alpha.
// Coordinates: the penguin's model space (1 = its height, y up), seen by the same ortho camera tipped ELEV; screen x = anchor.x +
// x·s, screen y = anchor.y − (y·cos e − z·sin e)·s, depth = −(y·sin e + z·cos e) (the penguin's fw), mapped to [−4, 4].
(function () {
  const GM = (window.GUNMESH = {}), M = {};
  let gl = null, P = null, C = null, LY = null;

  // ---------------- loading ----------------
  // m_<gun>.bin: 'GUN1', vertex count, index count, 0, the box (6 floats), then per vertex 24 bytes (position 3 floats, normal 3
  // signed bytes, specular byte, uv 2 shorts, part byte, 3 pad), then the indices (uint32)
  GM.load = (ids) => Promise.all(ids.map((id) => (M[id] ? M[id].p : (M[id] = { id, p: load(id) }).p)));
  GM.has = (id) => !!(M[id] && M[id].ready);
  GM.points = (id) => (GM.has(id) ? M[id].pts : null);                // every 7th vertex (gun frame): for the clipping checks
  async function load(id) {
    gl = G.gl; const v = '?v=' + (window.__V || 0);
    try {
      const [buf, tex] = await Promise.all([fetch('assets/m_' + id + '.bin' + v).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
        G.load('t_' + id, 'assets/t_' + id + '.jpg' + v)]);
      const dv = new DataView(buf); if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'GUN1') throw new Error('not a gun mesh');
      const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true), off = 40;
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(buf, off, nv * 24), gl.STATIC_DRAW);
      const at = (l, n, t, norm, o) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, t, norm, 24, o); };
      at(0, 3, gl.FLOAT, false, 0); at(1, 3, gl.BYTE, true, 12); at(2, 1, gl.UNSIGNED_BYTE, true, 15); at(3, 2, gl.UNSIGNED_SHORT, true, 16); at(4, 1, gl.UNSIGNED_BYTE, false, 20);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(buf, off + nv * 24, ni), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const pts = new Float32Array(Math.ceil(nv / 7) * 3); for (let i = 0, j = 0; i < nv; i += 7, j += 3) { pts[j] = dv.getFloat32(off + i * 24, true); pts[j + 1] = dv.getFloat32(off + i * 24 + 4, true); pts[j + 2] = dv.getFloat32(off + i * 24 + 8, true); }
      Object.assign(M[id], { vao, n: ni, tex, pts, ready: true });
    } catch (e) { console.warn('gun mesh ' + id + ': ' + e.message); M[id].failed = true; }
  }

  // ---------------- programs ----------------
  const VS = `#version 300 es
layout(location = 0) in vec3 a_p; layout(location = 1) in vec3 a_n; layout(location = 2) in float a_s; layout(location = 3) in vec2 a_uv; layout(location = 4) in float a_part;
uniform mat3 u_Rg; uniform vec3 u_tg, u_gk, u_spinP; uniform vec2 u_anchor, u_lres; uniform float u_s, u_elev, u_spin, u_slide, u_out, u_dz;
out vec3 v_n; out vec2 v_uv; out float v_s;
void main(){
  vec3 q = a_p, n = a_n;
  if (a_part > 0.5 && a_part < 1.5) { float c = cos(u_spin), s = sin(u_spin); mat2 r = mat2(c, s, -s, c); q.xy = u_spinP.xy + r * (q.xy - u_spinP.xy); n.xy = r * n.xy; }
  else if (a_part > 1.5) q.z -= u_slide;
  vec3 nw = normalize((n / u_gk) * u_Rg), w = u_tg + (q * u_gk) * u_Rg + nw * u_out;
  float ce = cos(u_elev), se = sin(u_elev);
  vec2 px = u_anchor + vec2(w.x, -(w.y * ce - w.z * se)) * u_s;
  gl_Position = vec4(px.x / u_lres.x * 2.0 - 1.0, 1.0 - px.y / u_lres.y * 2.0, clamp(-(w.y * se + w.z * ce) / u_dz, -1.0, 1.0), 1.0);
  v_n = nw; v_uv = vec2(a_uv.x, 1.0 - a_uv.y); v_s = a_s;
}`;
  // the penguin's light (key from the upper left, a cool sky, a warm bounce), less of it than the penguin takes: the atlas already
  // carries the reference's painted shading; a cool rim, a warm highlight by the material's specular, a soft inked edge
  const FS = `#version 300 es
precision highp float;
in vec3 v_n; in vec2 v_uv; in float v_s; out vec4 o;
uniform sampler2D u_tex, u_light; uniform float u_out, u_elev, u_lit, u_lk, u_flash, u_shade; uniform vec2 u_org, u_vres; uniform vec3 u_lpx;
const vec3 INK = vec3(0.06, 0.05, 0.09);
void main(){
  if (u_out > 0.0) { o = vec4(INK, 1.0); return; }
  vec3 n = normalize(v_n); float ce = cos(u_elev), se = sin(u_elev); vec3 rd = vec3(0.0, -se, -ce);
  if (dot(n, rd) > 0.0) n = -n;                                                       // a back face seen through a gap
  vec3 al = texture(u_tex, v_uv).rgb, L = normalize(vec3(-0.6, 0.75, 0.45));
  float ndl = dot(n, L), dif = smoothstep(-0.55, 0.85, ndl), sky = 0.5 + 0.5 * n.y, nv = clamp(dot(n, -rd), 0.0, 1.0);
  vec3 lin = vec3(1.0, 0.9, 0.78) * dif + vec3(0.44, 0.46, 0.68) * sky * 0.55 + vec3(0.45, 0.33, 0.26) * (1.0 - sky) * 0.6;
  vec3 col = al * mix(vec3(1.0), lin * 1.05, u_shade);
  col += vec3(0.5, 0.52, 0.8) * pow(1.0 - nv, 3.0) * 0.16;
  col += vec3(1.0, 0.84, 0.6) * pow(clamp(dot(n, normalize(L - rd)), 0.0, 1.0), mix(14.0, 70.0, v_s)) * v_s * 0.55;
  col = mix(col, INK, smoothstep(0.22, 0.0, nv) * 0.4);
  if (u_lit > 0.5) { vec2 pv = u_org + vec2(gl_FragCoord.x, u_lpx.y - gl_FragCoord.y) / u_lpx.z;      // the pixel in the view
    vec3 Lm = texture(u_light, vec2(pv.x / u_vres.x, 1.0 - pv.y / u_vres.y)).rgb; Lm = min(Lm, vec3(1.0)) + max(Lm - 1.0, 0.0) * 0.3; col *= mix(vec3(1.0), Lm, u_lk); }
  o = vec4(mix(col, vec3(1.0), u_flash), 1.0);
}`;
  // the layer laid over the target: its premultiplied colour, faded
  const CVS = `#version 300 es
in vec2 a_pos; uniform vec2 u_res; uniform vec4 u_rect, u_uv; out vec2 v_uv;
void main(){ vec2 p = u_rect.xy + a_pos * u_rect.zw; v_uv = u_uv.xy + vec2(a_pos.x, 1.0 - a_pos.y) * u_uv.zw;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); }`;
  const CFS = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_src; uniform float u_alpha;
void main(){ o = texture(u_src, v_uv) * u_alpha; }`;
  function compile(vs, fs, name) {
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    const loc = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
    return { p, loc };
  }
  function set(pr, U) { let unit = 0;
    for (const k in U) { const l = pr.loc[k]; if (!l) continue; const v = U[k];
      if (v && (v.t || v instanceof WebGLTexture)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t || v); gl.uniform1i(l, unit++); }
      else if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v); else if (v.length === 9) gl.uniformMatrix3fv(l, false, v); } }

  // ---------------- the layer ----------------
  function layer(w, h) {
    const need = (v) => Math.max(256, 1 << Math.ceil(Math.log2(v)));
    if (LY && LY.W >= w && LY.H >= h) return LY;
    const W = need(w), H = need(h), S = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    if (LY) { gl.deleteFramebuffer(LY.ms); gl.deleteFramebuffer(LY.rs); gl.deleteRenderbuffer(LY.cb); gl.deleteRenderbuffer(LY.db); gl.deleteTexture(LY.t); }
    const ms = gl.createFramebuffer(), cb = gl.createRenderbuffer(), db = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, cb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, S, gl.RGBA8, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, S, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, cb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rs = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, rs); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return (LY = { ms, rs, cb, db, t, W, H });
  }

  // begin: the layer for the view rect (x0, y0, w, h) of the bound target, cleared, bound, depth on; returns the context
  GM.begin = (x0, y0, w, h) => {
    gl = G.gl; if (!P) { P = compile(VS, FS, 'gunmesh'); C = compile(CVS, CFS, 'gunlayer'); }
    const prev = G.current(), vw = prev ? prev.vw : G.W, vh = prev ? prev.vh : G.H, k = (prev ? prev.w : G.PW || G.W) / vw;   // device px per view px
    const lw = Math.max(1, Math.ceil(w * k)), lh = Math.max(1, Math.ceil(h * k)), L = layer(Math.min(lw, 4096), Math.min(lh, 4096));
    const tg = { fb: L.ms, w: lw, h: lh, vw: lw / k, vh: lh / k };
    G.bind(tg, [0, 0, 0, 0]); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    return { prev, tg, x0, y0, k, vres: [vw, vh], lw, lh, L };
  };
  // the gun: g = { id, Rg (flat), tg, K, spinP, spin, slide }, anchor (x, y) in view px of the bound target, s px per unit
  GM.draw = (ctx, g, x, y, s, U = {}) => {
    const m = M[g.id]; if (!m || !m.ready) return false;
    gl = G.gl; if (!P) { P = compile(VS, FS, 'gunmesh'); C = compile(CVS, CFS, 'gunlayer'); }   // (into a layer another module began: charmesh's)
    gl.useProgram(P.p); gl.bindVertexArray(m.vao); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
    const base = { u_Rg: g.Rg, u_tg: g.tg, u_gk: g.K || [1, 1, 1], u_spinP: g.spinP || [0, 0, 0], u_spin: g.spin || 0, u_slide: g.slide || 0, u_anchor: [x - ctx.x0, y - ctx.y0], u_dz: ctx.dz || 4,
      u_lres: [ctx.tg.vw, ctx.tg.vh], u_s: s, u_elev: U.u_elev ?? Math.PI / 6, u_tex: m.tex, u_light: U.u_light || m.tex, u_lit: U.u_lit || 0, u_lk: U.u_lk ?? 0.45, u_flash: U.u_flash || 0,
      u_shade: U.u_shade ?? 0.55, u_org: [ctx.x0, ctx.y0], u_vres: ctx.vres, u_lpx: [ctx.lw, ctx.lh, ctx.k] };
    set(P, Object.assign(base, { u_out: 1.4 / (s * ctx.k) })); gl.cullFace(gl.FRONT); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);   // the ink outline
    set(P, { u_out: 0 }); gl.cullFace(gl.BACK); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null); gl.disable(gl.CULL_FACE); G.blend();
    return true;
  };
  // end: resolve the samples, back to the target, the layer laid over it at the rect, faded by alpha
  GM.end = (ctx, alpha = 1) => {
    const L = ctx.L; gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L.rs);
    gl.blitFramebuffer(0, 0, ctx.lw, ctx.lh, 0, 0, ctx.lw, ctx.lh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    G.bind(ctx.prev); G.blend(); gl.useProgram(C.p);
    set(C, { u_res: ctx.vres, u_rect: [ctx.x0, ctx.y0, ctx.lw / ctx.k, ctx.lh / ctx.k], u_uv: [0, 0, ctx.lw / L.W, ctx.lh / L.H], u_src: L.t, u_alpha: alpha });
    G.quadAttrib(); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
})();
