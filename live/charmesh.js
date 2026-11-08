// live/charmesh.js — the bosses as real 3D models (art/bosses3d/<boss>.py, modelled in Blender; gen/blender/charlib.py `game`):
// the mesh with its skin (live/assets/c_<boss>.bin: up to 4 bones per vertex), its colour atlas (c_<boss>.jpg: the materials baked,
// unlit) and its skeleton with every animation (c_<boss>.json: per frame, per bone the skin matrix, 3 rows of 4). Drawn each frame:
// skinned on the GPU (the two nearest animation frames blended), turned to face yaw about the vertical, seen by the game's ortho
// camera (tipped ELEV, as the hero), lit by the hero's light (a warm key from the upper left, a cool sky, a warm bounce, a rim)
// and the scene's light map — through a small offscreen layer with depth and multisampling, then laid over the target like a
// sprite (an ink outline from the back faces pushed out, as the guns).
// Model space (the game's axes): x right, y up, z toward the viewer; the feet on y = 0 round the origin; facing +z at yaw 0.
(function () {
  const CM = (window.CHARMESH = {}), M = {}, ELEV = Math.PI / 6;
  let gl = null, P = null, C = null, LY = null, NB = 0;          // NB: the bones a model may have (as many as the GPU's vertex uniforms allow, ≤ 128)

  // ---------------- loading ----------------
  // c_<boss>.bin: 'CHR1', vertex count, index count, bone count, the box (6 floats), then per vertex 32 bytes (position 3 floats,
  // normal 3 signed bytes, specular byte, uv 2 shorts, bone indices 4 bytes, weights 4 bytes, 4 pad), then the indices (uint32)
  CM.load = (ids) => Promise.all(ids.map((id) => (M[id] ? M[id].p : (M[id] = { id, p: load(id) }).p)));
  CM.has = (id) => !!(M[id] && M[id].ready);
  CM.info = (id) => (CM.has(id) ? M[id].info : null);
  CM.clip = (id, anim) => (CM.has(id) && M[id].A[anim]) || null;     // a clip's frames as drawn (per frame a Float32Array: hero3d.js writes the character editor's over them)
  async function load(id) {
    gl = G.gl; const v = '?v=' + (window.__V || 0);
    try {
      // (a model with cut-out parts — the hero's hair cards — has its atlas as a PNG with alpha: meta cut, the alpha below which a texel is not drawn)
      const infoP = fetch('assets/c_' + id + '.json' + v).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [buf, info, tex] = await Promise.all([fetch('assets/c_' + id + '.bin' + v).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
        infoP, infoP.then((i) => G.load('c_' + id, 'assets/c_' + id + (i.cut ? '.png' : '.jpg') + v))]);
      const { vao, n: ni, nb } = mesh(buf);
      // a lighter copy of the mesh (meta lod: its triangles; c_<id>_lo.bin, the same skin): drawn where the model is small (U.lod)
      if (info.lod) fetch('assets/c_' + id + '_lo.bin' + v).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((b) => { const q = mesh(b); if (q.nb === nb) M[id].lo = q; })
        .catch((e) => console.warn('character mesh ' + id + ' (light): ' + e.message));
      const A = {}; for (const k in info.anims) { const a = info.anims[k]; A[k] = { n: a.n, loop: a.loop, fps: a.fps, m: a.m.map((f) => new Float32Array(f)) }; }
      Object.assign(M[id], { vao, n: ni, nb, tex, info, A, H: info.height, B: new Float32Array(nb * 12), ready: true });
      progs();                                                                      // compiled now, not on the frame a boss first shows (a hitch)
    } catch (e) { console.warn('character mesh ' + id + ': ' + e.message); M[id].failed = true; }
  }
  // a CHR1 file's mesh into a vertex array: { vao, n (indices), nb (bones) }
  function mesh(buf) {
    const dv = new DataView(buf); if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'CHR1') throw new Error('not a character mesh');
    const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true), nb = dv.getUint32(12, true), off = 40;
    if (!NB) NB = Math.min(128, Math.floor((gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) - 16) / 3));
    if (nb > NB) throw new Error(nb + ' bones (' + NB + ' at most)');
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(buf, off, nv * 32), gl.STATIC_DRAW);
    const at = (l, n, t, norm, o) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, t, norm, 32, o); };
    at(0, 3, gl.FLOAT, false, 0); at(1, 3, gl.BYTE, true, 12); at(2, 1, gl.UNSIGNED_BYTE, true, 15); at(3, 2, gl.UNSIGNED_SHORT, true, 16);
    at(4, 4, gl.UNSIGNED_BYTE, false, 20); at(5, 4, gl.UNSIGNED_BYTE, true, 24);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(buf, off + nv * 32, ni), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, n: ni, nb };
  }
  // the skin matrices at animation frame f (a float: the two nearest frames blended; looped animations wrap)
  function bones(m, anim, f) {
    const A = m.A[anim] || m.A.idle || Object.values(m.A)[0], n = A.n, i0 = Math.floor(f), k = f - i0;
    const a = A.loop ? ((i0 % n) + n) % n : Math.max(0, Math.min(n - 1, i0)), b = A.loop ? (a + 1) % n : Math.min(n - 1, a + 1);
    const F0 = A.m[a], F1 = A.m[b], B = m.B; for (let i = 0; i < B.length; i++) B[i] = F0[i] + (F1[i] - F0[i]) * k;
    return B;
  }
  // the pose: anim at f, cross-faded toward mix = { anim, f, w } (w 0..1: a change of animation eased over a few frames)
  function pose(m, anim, f, mix) {
    const B = bones(m, anim, f); if (!mix || !(mix.w > 0)) return B;
    const B0 = m.B2 || (m.B2 = new Float32Array(B.length)); B0.set(B);
    const B1 = bones(m, mix.anim, mix.f), w = Math.min(1, mix.w); for (let i = 0; i < B1.length; i++) B1[i] = B0[i] + (B1[i] - B0[i]) * w;
    return B1;
  }
  // a pose blended from layers [{ anim, f, w }] (the weights normalised): a gait's directions, standing and walking, two stances
  function poseL(m, L) {
    const B = m.BL || (m.BL = new Float32Array(m.B.length)), I = m.info, live = L.filter((l) => l.w > 0);
    if (live.length > 1 && I.parent && I.head && I.parent.length * 12 === B.length) return rigid(m, live, B);
    B.fill(0); let tw = 0;
    for (const l of live) { const b = bones(m, l.anim, l.f); for (let i = 0; i < B.length; i++) B[i] += b[i] * l.w; tw += l.w; }
    if (tw > 0 && Math.abs(tw - 1) > 1e-6) for (let i = 0; i < B.length; i++) B[i] /= tw;
    return B;
  }
  // a rigid blend (a model with its skeleton: meta parent — skinned bones in order, parents first — and head, each bone's rest head):
  // per bone its turn against its parent (a quaternion, signs matched, averaged, normalised) and its size (a skin matrix's scale) blended,
  // the chain built again from the root; a bone's head where its parent now puts it, plus the share of it the layers move off that
  // (the hips' bob, a stretched limb). The same layers again (the hero's shadow, then the hero): the last result copied
  function rigid(m, L, B) {
    const I = m.info, P = I.parent, Hd = I.head, n = P.length, nl = L.length;
    let key = ''; for (const l of L) key += l.anim + ':' + l.f + ':' + l.w + ';';
    const G = m.RG || (m.RG = { key: null, out: new Float32Array(B.length) });
    if (G.key === key) { B.set(G.out); return B; }
    if (!G.q || G.nl < nl) Object.assign(G, { nl, q: new Float64Array(n * 4 * nl), R: new Float64Array(n * 9 * nl), s: new Float64Array(n * nl), h: new Float64Array(n * 3 * nl), w: new Float64Array(nl),
      T: new Float64Array(9), Lr: new Float64Array(9), Rw: new Float64Array(n * 9), Hw: new Float64Array(n * 3), ps: new Float64Array(n) });
    const { q: Q, R, s: SC, h: HH, w: W, T, Lr, Rw, Hw, ps: PS } = G;
    let tw = 0; for (let j = 0; j < nl; j++) tw += L[j].w; for (let j = 0; j < nl; j++) W[j] = L[j].w / tw;
    // each layer: per bone its rotation (scale out), its scale, its posed head; then its rotation against its parent's as a quaternion
    for (let j = 0; j < nl; j++) { const F = bones(m, L[j].anim, L[j].f);
      for (let b = 0; b < n; b++) { const o = b * 12, d = F[o] * (F[o + 5] * F[o + 10] - F[o + 6] * F[o + 9]) - F[o + 1] * (F[o + 4] * F[o + 10] - F[o + 6] * F[o + 8]) + F[o + 2] * (F[o + 4] * F[o + 9] - F[o + 5] * F[o + 8]);
        const sc = Math.cbrt(d) || 1, r = (j * n + b) * 9, h = Hd[b], hi = (j * n + b) * 3; SC[j * n + b] = sc;
        for (let a = 0; a < 3; a++) { for (let c = 0; c < 3; c++) R[r + a * 3 + c] = F[o + a * 4 + c] / sc;
          HH[hi + a] = F[o + a * 4] * h[0] + F[o + a * 4 + 1] * h[1] + F[o + a * 4 + 2] * h[2] + F[o + a * 4 + 3]; } }
      for (let b = 0; b < n; b++) { const r = (j * n + b) * 9, p = P[b];
        if (p < 0) { for (let i = 0; i < 9; i++) T[i] = R[r + i]; }
        else { const q = (j * n + p) * 9;                                                                    // parentᵀ · bone
          for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) T[a * 3 + c] = R[q + a] * R[r + c] + R[q + 3 + a] * R[r + 3 + c] + R[q + 6 + a] * R[r + 6 + c]; }
        toQ(T, Q, (j * n + b) * 4); } }
    // blended: from the root down
    for (let b = 0; b < n; b++) {
      let qw = 0, qx = 0, qy = 0, qz = 0, sc = 0;
      for (let j = 0; j < nl; j++) { const o = (j * n + b) * 4, sg = j && qw * Q[o] + qx * Q[o + 1] + qy * Q[o + 2] + qz * Q[o + 3] < 0 ? -W[j] : W[j];
        qw += Q[o] * sg; qx += Q[o + 1] * sg; qy += Q[o + 2] * sg; qz += Q[o + 3] * sg; sc += SC[j * n + b] * W[j]; }
      const ql = Math.hypot(qw, qx, qy, qz) || 1; fromQ(qw / ql, qx / ql, qy / ql, qz / ql, Lr); PS[b] = sc;
      const p = P[b], r = b * 9, h = Hd[b];
      if (p < 0) { for (let i = 0; i < 9; i++) Rw[r + i] = Lr[i]; for (let a = 0; a < 3; a++) { let v = 0; for (let j = 0; j < nl; j++) v += HH[(j * n + b) * 3 + a] * W[j]; Hw[b * 3 + a] = v; } }
      else { const pr = p * 9, hp = Hd[p];
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) Rw[r + a * 3 + c] = Rw[pr + a * 3] * Lr[c] + Rw[pr + a * 3 + 1] * Lr[3 + c] + Rw[pr + a * 3 + 2] * Lr[6 + c];
        // where the parent puts this head (its rest offset turned with it), and what the layers add past that, averaged
        for (let a = 0; a < 3; a++) { let off = 0;
          for (let j = 0; j < nl; j++) { const pq = (j * n + p) * 9, s2 = SC[j * n + p]; let at = HH[(j * n + p) * 3 + a];
            for (let c = 0; c < 3; c++) at += R[pq + a * 3 + c] * s2 * (h[c] - hp[c]);
            off += (HH[(j * n + b) * 3 + a] - at) * W[j]; }
          let at = Hw[p * 3 + a]; for (let c = 0; c < 3; c++) at += Rw[pr + a * 3 + c] * PS[p] * (h[c] - hp[c]);
          Hw[b * 3 + a] = at + off; } }
      const o = b * 12;
      for (let a = 0; a < 3; a++) { for (let c = 0; c < 3; c++) B[o + a * 4 + c] = Rw[r + a * 3 + c] * sc;
        B[o + a * 4 + 3] = Hw[b * 3 + a] - (B[o + a * 4] * h[0] + B[o + a * 4 + 1] * h[1] + B[o + a * 4 + 2] * h[2]); }
    }
    G.key = key; G.out.set(B);
    return B;
  }
  // a rotation (row-major 3×3) as a quaternion [w, x, y, z], and back
  function toQ(a, out, o) { const t = a[0] + a[4] + a[8]; let w, x, y, z;
    if (t > 0) { const S = Math.sqrt(t + 1) * 2; w = S / 4; x = (a[7] - a[5]) / S; y = (a[2] - a[6]) / S; z = (a[3] - a[1]) / S; }
    else if (a[0] > a[4] && a[0] > a[8]) { const S = Math.sqrt(1 + a[0] - a[4] - a[8]) * 2; w = (a[7] - a[5]) / S; x = S / 4; y = (a[1] + a[3]) / S; z = (a[2] + a[6]) / S; }
    else if (a[4] > a[8]) { const S = Math.sqrt(1 + a[4] - a[0] - a[8]) * 2; w = (a[2] - a[6]) / S; x = (a[1] + a[3]) / S; y = S / 4; z = (a[5] + a[7]) / S; }
    else { const S = Math.sqrt(1 + a[8] - a[0] - a[4]) * 2; w = (a[3] - a[1]) / S; x = (a[2] + a[6]) / S; y = (a[5] + a[7]) / S; z = S / 4; }
    out[o] = w; out[o + 1] = x; out[o + 2] = y; out[o + 3] = z; }
  function fromQ(w, x, y, z, o) { o[0] = 1 - 2 * (y * y + z * z); o[1] = 2 * (x * y - z * w); o[2] = 2 * (x * z + y * w); o[3] = 2 * (x * y + z * w); o[4] = 1 - 2 * (x * x + z * z);
    o[5] = 2 * (y * z - x * w); o[6] = 2 * (x * z - y * w); o[7] = 2 * (y * z + x * w); o[8] = 1 - 2 * (x * x + y * y); }
  // the skin matrices of a pose (3 rows of 4 per bone; a shared buffer, valid until the next call): for what a character holds
  CM.pose = (id, anim, f, mix) => (CM.has(id) ? pose(M[id], anim, f, mix) : null);
  CM.poseL = (id, layers) => (CM.has(id) ? poseL(M[id], layers) : null);   // (checks: a blend of layers as drawn)

  // ---------------- programs ----------------
  const VS = `#version 300 es
layout(location = 0) in vec3 a_p; layout(location = 1) in vec3 a_n; layout(location = 2) in float a_s; layout(location = 3) in vec2 a_uv;
layout(location = 4) in vec4 a_bi; layout(location = 5) in vec4 a_bw;
uniform vec4 u_B[NB3]; uniform vec2 u_anchor, u_lres; uniform float u_s, u_yaw, u_out, u_H, u_sq; uniform vec3 u_cast;
out vec3 v_n, v_r, v_w; out vec2 v_uv; out float v_s, v_ht;
uniform float CE, SE;                                                  // the camera's tip: cos, sin (ELEV in a run; a menu may look from lower)
void main(){
  vec4 P = vec4(a_p, 1.0); vec3 q = vec3(0.0), n = vec3(0.0);
  for (int k = 0; k < 4; k++) { float w = a_bw[k]; if (w <= 0.0) continue; int b = int(a_bi[k] + 0.5) * 3;
    vec4 r0 = u_B[b], r1 = u_B[b + 1], r2 = u_B[b + 2];
    q += w * vec3(dot(r0, P), dot(r1, P), dot(r2, P)); n += w * vec3(dot(r0.xyz, a_n), dot(r1.xyz, a_n), dot(r2.xyz, a_n)); }
  n = normalize(n); q.y *= u_sq;
  float c = cos(u_yaw), s = sin(u_yaw);
  vec3 w = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c), nw = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  w += nw * u_out;
  v_ht = clamp(w.y / u_H, 0.0, 1.0);
  if (u_cast.z > 0.0) w = vec3(w.x + w.y * u_cast.x, 0.0, w.z + w.y * u_cast.y);   // its cast shadow: every point laid on the floor along the sun
  vec2 px = u_anchor + vec2(w.x, -(w.y * CE - w.z * SE)) * u_s;
  gl_Position = vec4(px.x / u_lres.x * 2.0 - 1.0, 1.0 - px.y / u_lres.y * 2.0, clamp(-(w.y * SE + w.z * CE) / (u_H * 3.0), -1.0, 1.0), 1.0);
  v_n = nw; v_uv = vec2(a_uv.x, 1.0 - a_uv.y); v_s = a_s; v_r = a_p; v_w = w;
}`;
  // the hero's light (penguin.js / gunmesh.js): the atlas is the materials' own colour, so all of the light is applied
  const FS = `#version 300 es
precision highp float;
in vec3 v_n, v_r, v_w; in vec2 v_uv; in float v_s, v_ht; out vec4 o;
uniform sampler2D u_tex, u_light; uniform float u_cut, u_mood, u_out, u_lit, u_lk, u_flash, u_rim, u_shade, u_blink, SE, CE; uniform vec2 u_org, u_vres; uniform vec3 u_lpx, u_tint, u_lid, u_lid2, u_lash, u_cast, u_ccol; uniform float u_eyez;
uniform vec4 u_eye, u_pl[4]; uniform vec3 u_pc[4];                                        // the eyes (meta eye; eyez: the face's front, lid / lid2: right / left lid); point lights: position (model units, turned), reach; colour
const vec3 INK = vec3(0.06, 0.05, 0.09);
void main(){
  vec4 tx = texture(u_tex, v_uv); if (tx.a < u_cut) discard;                                   // (premultiplied: the cut-out's colour below)
  if (u_out > 0.0) { o = vec4(INK, 1.0); return; }
  if (u_cast.z > 0.0) { float a = u_cast.z * mix(1.0, 0.4, smoothstep(0.0, 0.9, v_ht)); o = vec4(u_ccol * a, a); return; }   // (darkest at the feet, paler toward the head's end)
  vec3 n = normalize(v_n), rd = vec3(0.0, -SE, -CE);
  if (dot(n, rd) > 0.0) n = -n;
  vec3 al = tx.rgb / max(tx.a, 0.004) * u_tint, L = normalize(vec3(-0.6, 0.75, 0.45));
  if (u_blink > 0.0 && v_r.z > u_eyez) {                                                       // a blink: the lid painted down over the eye, its rim dark
    vec2 q = vec2((abs(v_r.x) - u_eye.x) / u_eye.z, (v_r.y - u_eye.y) / u_eye.w); vec3 lid = v_r.x < 0.0 ? u_lid : u_lid2;   // (each eye its own fur round it)
    float e = mix(1.3, -0.35, u_blink) + 0.4 * q.x * q.x, lo = mix(-1.6, e, smoothstep(0.55, 1.0, u_blink));   // the upper lid's edge; the lower lid rising to meet it
    if (dot(q, q) < 1.55 && (q.y > e || q.y < lo)) al = q.y > e ? mix(u_lash, lid * u_tint, smoothstep(0.07, 0.17, q.y - e)) : lid * u_tint;
  }
  float ndl = dot(n, L), dif = smoothstep(-0.45, 0.9, ndl), sky = 0.5 + 0.5 * n.y, nv = clamp(dot(n, -rd), 0.0, 1.0);
  vec3 lin = vec3(1.05, 0.93, 0.8) * dif * 0.95 + vec3(0.42, 0.45, 0.66) * sky * 0.5 + vec3(0.42, 0.31, 0.25) * (1.0 - sky) * 0.45;
  vec3 col = al * mix(vec3(1.0), lin * 1.08, u_shade);                                          // u_shade: how much of the light (1: all of it)
  float m1 = min(u_mood, 1.0);                                                                 // (the menus' moods: less of the run's rim and ink)
  if (u_mood > 1.5) {                                                                          // the lobby's bunker: a dim cool room, a soft warm key
    vec3 Lk = normalize(vec3(-0.55, 0.6, 0.55));                                               // from the work lamp's side (the lamps themselves: point lights)
    float kd = smoothstep(-0.35, 0.9, dot(n, Lk));
    col = al * (vec3(1.0, 0.87, 0.7) * kd * 0.78 + mix(vec3(0.24, 0.26, 0.32), vec3(0.46, 0.5, 0.6), sky) * 0.8);
    col *= mix(0.6, 1.0, smoothstep(0.0, 0.1, v_ht));                                          // the boots darker where they meet the floor
  } else if (u_mood > 0.5) {                                                                   // the lobby's sunset: the sun low behind it, to the left
    vec3 Ls = normalize(vec3(-0.8, 0.4, -0.45));                                               // (so its front is in the warm shade, as the floor's
    float kd = smoothstep(-0.15, 0.8, dot(n, Ls)), fr = smoothstep(-0.4, 0.9, dot(n, normalize(vec3(-0.35, 0.35, 0.87))));   //  shadows are)
    col = al * (vec3(1.0, 0.62, 0.36) * kd * 0.85                                              // the sun on its left side and back
              + vec3(0.62, 0.48, 0.4) * fr * 0.55                                              // the soft fill off the bright sky and the walls
              + mix(vec3(0.46, 0.3, 0.2), vec3(0.3, 0.27, 0.38), sky) * 0.75);                // the sunlit floor's warm bounce below, the dusk above
    col += (al * 0.7 + 0.2) * vec3(1.0, 0.55, 0.22) * pow(1.0 - nv, 1.5) * smoothstep(-0.3, 0.5, dot(n, normalize(vec3(-1.0, 0.35, -0.2)))) * 2.0;   // the sun's rim
    col *= mix(0.5, 1.0, smoothstep(0.0, 0.1, v_ht));                                          // the boots darker where they meet the floor
    col = mix(col, vec3(0.6, 0.38, 0.3), 0.1);                                               // the evening's haze, as over the backdrop
  }
  col += vec3(0.5, 0.55, 0.85) * pow(1.0 - nv, 3.0) * 0.18 * (1.0 - m1 * 0.6);            // a cool rim
  col += vec3(1.0, 0.86, 0.65) * pow(clamp(dot(n, normalize(L - rd)), 0.0, 1.0), mix(10.0, 60.0, v_s)) * v_s * 0.4 * (1.0 - m1 * 0.75);
  col += vec3(1.0, 0.55, 0.25) * u_rim * (0.35 + 0.65 * pow(1.0 - nv, 2.0));                   // a warm rim: rage, a hit
  col = mix(col, INK, smoothstep(0.2, 0.0, nv) * 0.35 * u_shade * (1.0 - m1 * 0.6));
  if (u_lit > 0.5) { vec2 pv = u_org + vec2(gl_FragCoord.x, u_lpx.y - gl_FragCoord.y) / u_lpx.z;
    vec3 Lm = texture(u_light, vec2(pv.x / u_vres.x, 1.0 - pv.y / u_vres.y)).rgb; Lm = min(Lm, vec3(1.0)) + max(Lm - 1.0, 0.0) * 0.3; col *= mix(vec3(1.0), Lm, u_lk); }
  for (int i = 0; i < 4; i++) {                                                                // point lights (lamps, flashes): the side toward each lit, a rim past it
    float r = u_pl[i].w; if (r <= 0.0) continue;
    vec3 d = u_pl[i].xyz - v_w; float dl = length(d); vec3 ld = d / max(dl, 1e-4);
    float att = smoothstep(r * 1.8, 0.0, dl) / (1.0 + dl * dl / (r * r)), nl = dot(n, ld), w = clamp((nl + 0.2) / 1.2, 0.0, 1.0);
    col += u_pc[i] * att * (al * w * w * 1.1 + al * pow(1.0 - nv, 2.0) * clamp(nl + 0.6, 0.0, 1.0) * 0.8 + pow(clamp(dot(n, normalize(ld - rd)), 0.0, 1.0), mix(8.0, 40.0, v_s)) * v_s * 0.5); }
  o = vec4(mix(col, vec3(1.0), u_flash), 1.0);
}`;
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
    const loc = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, u.name); }
    return { p, loc };
  }
  function set(pr, U) { let unit = 0;
    for (const k in U) { const l = pr.loc[k]; if (!l) continue; const v = U[k];
      if (v && (v.t || v instanceof WebGLTexture)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t || v); gl.uniform1i(l, unit++); }
      else if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v); } }

  function progs() { if (!P) { P = compile(VS.replace('NB3', String(NB * 3)), FS, 'charmesh'); C = compile(CVS, CFS, 'charlayer'); } }

  // ---------------- the layer (as gunmesh.js) ----------------
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

  // warm: every loaded model drawn once, fully transparent, at the largest size a boss takes (the layer, the buffers and the driver's
  // first-draw work done at load, not on the frame a boss first shows: a hitch)
  CM.warm = (h = 500) => { for (const id in M) if (M[id].ready) CM.draw(id, 'idle', 0, h, h * 1.2, h, 0, { alpha: 0 }); };
  // draw: the character id in animation anim at frame f (float), its feet at (x, y) in view px of the bound target, h px tall
  // (its rest height on screen), turned to yaw (radians: 0 faces the viewer, + turns it toward the screen's right).
  // U: { tint [r,g,b], flash 0..1, rim 0..1, alpha 0..1, sq (vertical squash), light (the light map target), lk (its share), elev (the
  // camera's tip, default ELEV), mix (a cross-fade, see pose), layers (instead of anim / f: a blend, see poseL), shade (how much of the
  // light it takes, 1: all; less keeps a model's painted colours, as the hero's), mood (1: the lobby's sunset light instead), ink (0: no outline), post (B, info: changes the skin matrices before the draw),
  // blink (0 open … 1 shut: a model with meta eye), lod (the model's lighter copy, meta lod, where it has one: a run's small cat), pl / pc (up to 4 point lights: Float32Array(16) x, y, z, reach in model units
  // turned as drawn, from its feet; Float32Array(12) their colours), cast ([dx, dz, alpha]: instead, its shadow laid on the floor, each
  // point moved dx, dz per unit of its height; ccol its colour) }
  const NOPL = new Float32Array(16), NOPC = new Float32Array(12);
  CM.draw = (id, anim, f, x, y, h, yaw, U = {}) => {
    const m = M[id]; if (!m || !m.ready) return false;
    gl = G.gl; progs();
    const s = h / (m.H * 0.8660254), R = m.H * s;                                   // px per unit; the model's size on screen
    const C3 = U.cast, cx = C3 ? Math.abs(C3[0]) * R * 1.05 : 0, cy = C3 ? Math.max(0, C3[1] * Math.sin(U.elev ?? ELEV)) * R : 0;   // (a cast shadow reaches past the feet)
    const x0 = x - R * 1.1 - (C3 && C3[0] < 0 ? cx : 0), y0 = y - R * 1.15, w = R * 2.2 + cx, hh = R * 1.55 + cy;
    const prev = G.current(), vw = prev ? prev.vw : G.W, vh = prev ? prev.vh : G.H, k = (prev ? prev.w : G.PW || G.W) / vw;
    if (x0 > vw || y0 > vh || x0 + w < 0 || y0 + hh < 0) return true;              // off the view
    const lw = Math.max(1, Math.min(4096, Math.ceil(w * k))), lh = Math.max(1, Math.min(4096, Math.ceil(hh * k))), L = layer(lw, lh);
    G.bind({ fb: L.ms, w: lw, h: lh, vw: lw / k, vh: lh / k }, [0, 0, 0, 0]); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    const ms = U.lod && m.lo ? m.lo : m;                                          // (lod: the lighter copy, where there is one)
    gl.useProgram(P.p); gl.bindVertexArray(ms.vao);
    const Bm = U.layers ? poseL(m, U.layers) : pose(m, anim, f, U.mix); if (U.post) U.post(Bm, m.info);   // post: a change on top (the hero's upper body turned to its aim)
    gl.uniform4fv(P.loc.u_B, Bm);
    const base = { u_anchor: [x - x0, y - y0], u_lres: [lw / k, lh / k], u_s: s, u_yaw: yaw, u_H: m.H, u_sq: U.sq || 1, u_tex: m.tex, u_cut: m.info.cut || 0, u_mood: U.mood || 0, u_light: U.light || m.tex,
      u_lit: U.light ? 1 : 0, u_lk: U.lk ?? 0.55, u_flash: U.flash || 0, u_rim: U.rim || 0, u_tint: U.tint || [1, 1, 1], u_shade: U.shade ?? 1, u_blink: m.info.eye ? U.blink || 0 : 0, u_eye: m.info.eye || [0, 0, 1, 1], u_lid: m.info.lid || [1, 1, 1], u_lid2: m.info.lid2 || m.info.lid || [1, 1, 1], u_eyez: m.info.eyez ?? 0.15, u_lash: m.info.lash || [0, 0, 0], u_org: [x0, y0], u_vres: [vw, vh], u_lpx: [lw, lh, k], CE: Math.cos(U.elev ?? ELEV), SE: Math.sin(U.elev ?? ELEV),
      u_cast: C3 || [0, 0, 0], u_ccol: U.ccol || [0.05, 0.02, 0.06] };
    if (C3) gl.disable(gl.CULL_FACE);                                              // (laid flat, half its faces turn away)
    else if (U.ink !== 0) { set(P, Object.assign(base, { u_out: 1.3 / (s * k) })); gl.cullFace(gl.FRONT); gl.drawElements(gl.TRIANGLES, ms.n, gl.UNSIGNED_INT, 0); }   // the ink outline (ink 0: none)
    gl.uniform4fv(P.loc.u_pl, U.pl || NOPL); gl.uniform3fv(P.loc.u_pc, U.pc || NOPC);              // (every draw: a boss after the hero gets none of its lights)
    set(P, Object.assign(base, { u_out: 0 })); gl.cullFace(gl.BACK); gl.drawElements(gl.TRIANGLES, ms.n, gl.UNSIGNED_INT, 0);
    // what it holds, into the same layer (its depth kept): U.after(ctx), ctx as gunmesh.js GM.begin gives it, plus the model's px
    // per unit (s) and this program's depth range (dz, model units)
    if (U.after && !C3) { gl.bindVertexArray(null); U.after({ x0, y0, k, tg: { vw: lw / k, vh: lh / k }, vres: [vw, vh], lw, lh, s, dz: m.H * 3 }); }
    gl.bindVertexArray(null); gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L.rs);
    gl.blitFramebuffer(0, 0, lw, lh, 0, 0, lw, lh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    G.bind(prev); G.blend(); gl.useProgram(C.p);
    set(C, { u_res: [vw, vh], u_rect: [x0, y0, lw / k, lh / k], u_uv: [0, 0, lw / L.W, lh / L.H], u_src: L.t, u_alpha: U.alpha ?? 1 });
    G.quadAttrib(); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  };
})();
