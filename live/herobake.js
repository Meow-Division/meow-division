// live/herobake.js — the character editor's changes (live/hero.js, made in /live/index.html?hero) laid over the hero's baked clips
// (assets/c_cat.json, from art/hero3d/meshycat2.py): parts of the body turned about their joints (for the whole clip, or keyed through
// it), the gun moved, turned and resized in its paws, each paw nudged on it, the arms bent again to reach the paws (two-bone IK; the
// elbows swung round the line from shoulder to paw, the shoulders turned). Numbers only, nothing drawn: hero3d.js bakes the clips it
// draws with it, server/herofile.mjs the sim's muzzles (data.js D.HERO3D) when the editor saves.
// A clip frame's skin matrices (meta anims[k].m): per bone 3 rows of 4, taking a point of the model at rest to where the pose puts it;
// a joint in the pose is its bone's matrix times its rest head (meta head); meta parent links the skinned bones. The gun's frame
// (anims[k].g) has the same shape: origin at its grip, x its left, y up, z along the barrel, in the model's space (x its left, y up,
// z the way it faces). Turns are degrees [x, y, z] about the model's axes (a part) or the gun's (the gun, a paw): x tips forward,
// y turns to its left, z leans it to its right.
(function (root) {
  const HB = {};
  // the parts the editor turns: their bones (a chain — the tail — shares the turn along itself), applied in this order (parents first)
  const PARTS = {
    body: ['Bone_000'],
    waist: ['Bone_004'],
    chest: ['Bone_002'],
    neck: ['Bone_029'],
    head: ['Bone_028'],
    tail: ['Bone_022', 'Bone_021', 'Bone_020', 'Bone_019', 'Bone_018', 'Bone_017', 'Bone_016', 'Bone_015'],
    thighL: ['Bone_014'],
    shinL: ['Bone_013'],
    footL: ['Bone_012'],
    thighR: ['Bone_009'],
    shinR: ['Bone_008'],
    footR: ['Bone_007'],
  };
  // the arms: shoulder, upper arm, forearm, paw (the right paw holds the gun's grip: the gun goes where it goes); each paw's fingers'
  // roots, the index finger's first (the paw's frame: its knuckles' way from the wrist, its palm's way)
  const ARMS = {
    R: ['Bone_034', 'Bone_033', 'Bone_032', 'Bone_031'],
    L: ['Bone_039', 'Bone_038', 'Bone_037', 'Bone_036'],
  };
  const ROOTS = { R: ['Bone_067', 'Bone_061', 'Bone_064'], L: ['Bone_079', 'Bone_076', 'Bone_073'] };
  // how the left paw lies on what it holds, in the gun's frame [knuckles, palm] (the export's PAWDIR, which its wrist could not turn
  // far enough to reach: the palm was left facing away, outward or forward): under the fore-end, the palm up against it, the
  // fingers round its right side; on the SMG's magazine from its left, the palm on it. The pistol (the left paw round the right)
  // and the minigun (on the handle from above) keep the export's.
  // What it holds: a line through a point (the gun's own units, as its anchors: 'L' its left grip anchor) along an axis of the
  // gun, this thick (radius, gun units): the palm is laid against it where the paw is along it.
  const FORE = [
    [-0.75, 0.15, 0.55],
    [-0.5, 0.8, 0],
  ];
  const GRIP = {
    shotgun: { k: [-0.8, 0.1, 0.45], n: [-0.4, 0.85, 0], at: 'L', ax: 2, r: 0.03 },
    sniper: { k: FORE[0], n: FORE[1], at: 'L', ax: 2, r: 0.03 },
    flame: { k: FORE[0], n: FORE[1], at: 'L', ax: 2, r: 0.03 },
    rocket: { k: FORE[0], n: [-0.75, 0.6, 0], at: [0, 0, 0], ax: 2, r: 0.1158 },
    smg: { k: [0, -0.15, 1], n: [-1, 0.15, 0], at: 'L', ax: 1, r: 0.025 },
  };
  const GAP = 0.012; // the palm's middle this far (model units) off what it holds
  const SLIDE = 0.15; // how far (model units) a paw may slide along it toward the body to reach
  const GUNS = () => (root.DATA || (typeof module !== 'undefined' ? require('./data.js') : {})).GUN3D || {};
  HB.GRIP = GRIP;
  HB.PARTS = Object.keys(PARTS).concat(['shoulderR', 'shoulderL', 'elbowR', 'elbowL']);
  // a gun's place: aiming (idle and run). The lobby holds it as standing and aiming does: its arms and gun are the idle clip's,
  // carried by its own chest (Bone_024, the shoulders' parent); its body, head and look round its own. (guns[].lobby: no more)
  HB.kind = () => 'aim';
  const CARRY = 'Bone_024';
  HB.gunOf = (clip) => clip.slice(clip.indexOf('_') + 1);

  // ---------------- the skeleton (once per model)
  const RIG = new WeakMap();
  function rig(info) {
    let r = RIG.get(info);
    if (r) return r;
    const nb = info.bones.length,
      ix = (n) => info.bones.indexOf(n),
      kids = Array.from({ length: nb }, () => []);
    info.parent.forEach((p, i) => {
      if (p >= 0) kids[p].push(i);
    });
    const sub = (i) => {
      const out = [],
        st = [i];
      while (st.length) {
        const b = st.pop();
        out.push(b);
        st.push(...kids[b]);
      }
      return out;
    };
    const part = {};
    for (const k in PARTS) part[k] = PARTS[k].map(ix).filter((i) => i >= 0);
    const arm = {};
    for (const s in ARMS) {
      const [sh, a, f, h] = ARMS[s].map(ix),
        roots = ROOTS[s].map(ix);
      const ua = nrm(sub3(info.head[f], info.head[a])),
        uf = nrm(sub3(info.head[h], info.head[f])); // the upper arm's and forearm's way at rest
      const fr = pawFrame(info.head, info, h, roots); // (its palm at rest faces down: the sign)
      arm[s] = {
        sh,
        a,
        f,
        h,
        roots,
        ua,
        uf,
        palm: fr.n[1] < 0 ? 1 : -1,
        subA: sub(a),
        subF: sub(f),
        subH: sub(h),
        subS: sub(sh),
      };
    }
    r = {
      nb,
      sub: Array.from({ length: nb }, (_, i) => sub(i)),
      part,
      arm,
      carry: ix(CARRY),
      arms: arm.R.subS.concat(arm.L.subS),
    };
    RIG.set(info, r);
    return r;
  }

  // ---------------- 3 × 4 matrices (rows), 3-vectors
  const mul = (A, B) => {
    const o = new Array(12); // A ∘ B
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++)
        o[r * 4 + c] =
          A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + (c === 3 ? A[r * 4 + 3] : 0);
    return o;
  };
  const ap = (M, p, o = 0) =>
    [0, 1, 2].map((r) => M[o + r * 4] * p[0] + M[o + r * 4 + 1] * p[1] + M[o + r * 4 + 2] * p[2] + M[o + r * 4 + 3]);
  const inv = (M) => {
    const R = [M[0], M[4], M[8], M[1], M[5], M[9], M[2], M[6], M[10]],
      t = [M[3], M[7], M[11]]; // (a rigid one: turned back)
    return [
      R[0],
      R[1],
      R[2],
      -(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]),
      R[3],
      R[4],
      R[5],
      -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]),
      R[6],
      R[7],
      R[8],
      -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2]),
    ];
  };
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sc3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]),
    nrm = (a) => {
      const l = len(a) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
  // a turn as a matrix (no move): about an axis (unit) by an angle; from Euler degrees [x, y, z] (x first, about fixed axes)
  const axisRot = (u, a) => {
    const c = Math.cos(a),
      s = Math.sin(a),
      t = 1 - c,
      [x, y, z] = u;
    return [
      t * x * x + c,
      t * x * y - s * z,
      t * x * z + s * y,
      0,
      t * x * y + s * z,
      t * y * y + c,
      t * y * z - s * x,
      0,
      t * x * z - s * y,
      t * y * z + s * x,
      t * z * z + c,
      0,
    ];
  };
  const D2R = Math.PI / 180;
  const euler = (e) => {
    const [x, y, z] = e.map((v) => v * D2R),
      cx = Math.cos(x),
      sx = Math.sin(x),
      cy = Math.cos(y),
      sy = Math.sin(y),
      cz = Math.cos(z),
      sz = Math.sin(z);
    return [
      cz * cy,
      cz * sy * sx - sz * cx,
      cz * sy * cx + sz * sx,
      0,
      sz * cy,
      sz * sy * sx + cz * cx,
      sz * sy * cx - cz * sx,
      0,
      -sy,
      cy * sx,
      cy * cx,
      0,
    ];
  };
  const about = (R, h) => {
    const Rh = ap(R, h);
    const M = R.slice();
    M[3] = h[0] - Rh[0];
    M[7] = h[1] - Rh[1];
    M[11] = h[2] - Rh[2];
    return M;
  }; // R about the point h
  const fromTo = (u, v) => {
    const a = nrm(u),
      b = nrm(v),
      x = cross(a, b),
      s = len(x),
      c = dot(a, b);
    if (s < 1e-9)
      return c > 0
        ? euler([0, 0, 0])
        : axisRot(nrm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0])), Math.PI);
    return axisRot(sc3(x, 1 / s), Math.atan2(s, c));
  };
  const move = (t) => [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]];
  const square = (F) => {
    // a gun frame made orthonormal again (its z kept, its y squared to it)
    const z = nrm([F[2], F[6], F[10]]);
    let y = [F[1], F[5], F[9]];
    y = nrm(sub3(y, sc3(z, dot(y, z))));
    const x = cross(y, z);
    return [x[0], y[0], z[0], F[3], x[1], y[1], z[1], F[7], x[2], y[2], z[2], F[11]];
  };
  const zero = (v) => !v || (Math.abs(v[0]) < 1e-9 && Math.abs(v[1] || 0) < 1e-9 && Math.abs(v[2] || 0) < 1e-9);
  // S: every bone's matrix (12 each); a transform M laid over the bones in list (M ∘ S)
  function over(S, M, list) {
    for (const b of list) {
      const o = b * 12,
        s = Array.from(S.subarray(o, o + 12));
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 4; c++)
          S[o + r * 4 + c] =
            M[r * 4] * s[c] + M[r * 4 + 1] * s[4 + c] + M[r * 4 + 2] * s[8 + c] + (c === 3 ? M[r * 4 + 3] : 0);
    }
  }
  const head = (S, info, b) => ap(S, info.head[b], b * 12);
  // a paw's frame from its joints (J(b) or J[b]: where joint b is): d its knuckles' way, n its palm's (sign: as at rest, palm down = 1)
  function pawFrame(J, info, h, roots, sign = 1) {
    const at = Array.isArray(J) ? (b) => J[b] : J,
      w = at(h),
      r = roots.map(at),
      mid = [0, 1, 2].map((k) => r.reduce((t, q) => t + q[k], 0) / r.length);
    const d = nrm(sub3(mid, w)),
      n0 = sc3(cross(d, sub3(r[0], r[r.length - 1])), sign),
      n = nrm(sub3(n0, sc3(d, dot(n0, d))));
    return { d, n, mid };
  }
  // a bone's turn (its matrix without the stretch along itself u: the export stretches the arms), as 12; a turn's twist about u
  const turnOf = (S, b, u) => {
    const M = Array.from(S.subarray(b * 12, b * 12 + 12));
    if (!u) return M;
    const k = len([0, 1, 2].map((r) => M[r * 4] * u[0] + M[r * 4 + 1] * u[1] + M[r * 4 + 2] * u[2])),
      c = 1 / k - 1;
    const Si = [
      1 + c * u[0] * u[0],
      c * u[0] * u[1],
      c * u[0] * u[2],
      0,
      c * u[1] * u[0],
      1 + c * u[1] * u[1],
      c * u[1] * u[2],
      0,
      c * u[2] * u[0],
      c * u[2] * u[1],
      1 + c * u[2] * u[2],
      0,
    ];
    return mul(M, Si);
  };
  const tr3 = (M) => [M[0], M[4], M[8], 0, M[1], M[5], M[9], 0, M[2], M[6], M[10], 0];
  const twistOf = (P, C, u) => {
    // C's turn against P's: its twist about u (the rest's axes), radians
    const Q = mul(tr3(P), C),
      w = Math.sqrt(Math.max(0, 1 + Q[0] + Q[5] + Q[10])) / 2;
    if (w < 1e-6) return Math.PI;
    const v = [(Q[9] - Q[6]) / (4 * w), (Q[2] - Q[8]) / (4 * w), (Q[4] - Q[1]) / (4 * w)],
      t = 2 * Math.atan2(dot(v, u), w);
    return Math.atan2(Math.sin(t), Math.cos(t));
  };
  const colsM = (d, n) => {
    const b = cross(d, n);
    return [d[0], n[0], b[0], 0, d[1], n[1], b[1], 0, d[2], n[2], b[2], 0];
  };
  const turnV = (M, v) => [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[4] * v[0] + M[5] * v[1] + M[6] * v[2],
    M[8] * v[0] + M[9] * v[1] + M[10] * v[2],
  ];

  // ---------------- the tune
  // a part's turn at frame f of a clip n frames long: { r: [x, y, z] } for the whole clip, or { k: [[frame, x, y, z], ...] } keyed
  // (the keys joined by a smooth curve that loops with the clip: Catmull–Rom)
  HB.track = (t, f, n) => {
    if (!t) return null;
    if (t.r) return t.r;
    const K = t.k;
    if (!K || !K.length) return null;
    if (K.length === 1) return K[0].slice(1);
    const m = K.length;
    let i = m - 1;
    for (let j = 0; j < m; j++) if (K[j][0] <= f) i = j;
    const a = K[i],
      b = K[(i + 1) % m],
      span = ((b[0] - a[0] + n - 1) % n) + 1,
      u = ((((f - a[0]) % n) + n) % n) / span;
    const p0 = K[(i - 1 + m) % m],
      p3 = K[(i + 2) % m];
    return [1, 2, 3].map((c) => {
      const P0 = p0[c],
        P1 = a[c],
        P2 = b[c],
        P3 = p3[c];
      return (
        0.5 *
        (2 * P1 + (-P0 + P2) * u + (2 * P0 - 5 * P1 + 4 * P2 - P3) * u * u + (-P0 + 3 * P1 - 3 * P2 + P3) * u * u * u)
      );
    });
  };
  const placeOf = (T, gun, kind) => ((T.guns || {})[gun] || {})[kind] || {};
  HB.scaleOf = (T, gun) => {
    const g = ((T && T.guns) || {})[gun];
    return g && g.scale > 0 ? g.scale : 1;
  };
  // does the tune change this clip at all (else it is drawn as baked)
  HB.touches = (T, clip) => {
    const gun = HB.gunOf(clip);
    if (GRIP[gun] || clip.startsWith('lobby_')) return true;
    if (!T) return false; // (a designed grip, the lobby: always)
    const pl = placeOf(T, gun, HB.kind(clip)),
      P = (T.poses || {})[clip] || {};
    if (HB.scaleOf(T, gun) !== 1 || !zero(pl.p) || !zero(pl.r)) return true;
    for (const s of ['pawR', 'pawL']) if (pl[s] && (!zero(pl[s].p) || !zero(pl[s].r))) return true;
    for (const k in P) {
      const t = P[k];
      if (t && ((t.r && !zero(t.r)) || (t.k && t.k.length))) return true;
    }
    return false;
  };

  // ---------------- one clip baked: { m: per frame Float32Array (the skin matrices), g: per frame the gun's frame, short: how far
  // each paw is from its place at worst (an arm too short to reach it), model units }
  // cache (optional, one tune): clips already baked, by name (the lobby takes its gun's idle)
  HB.bake = (info, T, clip, cache) => {
    if (cache && cache[clip]) return cache[clip];
    const out = clip.startsWith('lobby_') ? lobby(info, T || {}, clip, cache) : bakeOne(info, T || {}, clip);
    if (cache) cache[clip] = out;
    return out;
  };
  // the body's parts turned about their joints (a chain: an equal share per bone, so it curves); M laid over each turned subtree
  function parts(S, info, R, P, f, n, turn) {
    for (const k in PARTS) {
      const v = HB.track(P[k], f, n);
      if (zero(v)) continue;
      const bs = R.part[k],
        q = v.map((x) => x / bs.length);
      for (const b of bs) turn(b, about(euler(q), head(S, info, b)));
    }
  }
  // the lobby: its own body (and its parts turned), the idle clip's arms and gun moved with the chest from the idle's to the lobby's
  function lobby(info, T, clip, cache) {
    const A = info.anims[clip],
      R = rig(info),
      gun = HB.gunOf(clip),
      idle = 'idle_' + gun,
      I0 = info.anims[idle],
      P = (T.poses || {})[clip] || {};
    const B = HB.bake(info, T, idle, cache),
      out = { m: [], g: [], short: B.short, twist: B.twist };
    for (let f = 0; f < A.n; f++) {
      const S = Float64Array.from(A.m[f]),
        fi = f % I0.n,
        Si = B.m[fi],
        c = R.carry * 12;
      parts(S, info, R, P, f, A.n, (b, M) => over(S, M, R.sub[b]));
      const X = mul(Array.from(S.subarray(c, c + 12)), inv(Array.from(Si.subarray(c, c + 12))));
      for (const b of R.arms) {
        const v = mul(X, Array.from(Si.subarray(b * 12, b * 12 + 12)));
        for (let j = 0; j < 12; j++) S[b * 12 + j] = v[j];
      }
      out.m.push(Float32Array.from(S));
      out.g.push(B.g[fi] ? mul(X, B.g[fi]).map((v) => Math.round(v * 1e5) / 1e5) : null);
    }
    return out;
  }
  function bakeOne(info, T, clip) {
    const A = info.anims[clip],
      R = rig(info),
      gun = HB.gunOf(clip),
      pl = placeOf(T, gun, HB.kind(clip)),
      P = (T.poses || {})[clip] || {};
    const s = HB.scaleOf(T, gun),
      E = mul(move(pl.p || [0, 0, 0]), euler(pl.r || [0, 0, 0])); // the gun's change in its own frame
    const gunMoved =
      s !== 1 ||
      !zero(pl.p) ||
      !zero(pl.r) ||
      ['pawR', 'pawL'].some((k) => pl[k] && (!zero(pl[k].p) || !zero(pl[k].r)));
    const out = { m: [], g: [], short: { R: 0, L: 0 }, twist: { R: 0, L: 0 } }; // (twist: the most each wrist and elbow turns over, radians)
    for (let f = 0; f < A.n; f++) {
      const S = Float64Array.from(A.m[f]);
      let G = A.g ? square(A.g[f]) : null;
      const turn = (b, M) => {
        over(S, M, R.sub[b]);
        if (G && R.sub[b].includes(R.arm.R.h)) G = mul(M, G);
      }; // (the gun goes with the right paw)
      parts(S, info, R, P, f, A.n, turn);
      // where the paws are now (on the gun): the arms reach for them again after the shoulders turn and the gun moves
      const pre = {};
      for (const sd of ['R', 'L']) {
        const a = R.arm[sd];
        pre[sd] = { w: head(S, info, a.h), H: a.subH.map((b) => Array.from(S.subarray(b * 12, b * 12 + 12))) };
      }
      // the left paw laid on the gun as GRIP has it: turned to lie as it says, its palm against what it holds, where it was along it
      const fix = { R: false, L: false },
        gr = GRIP[gun],
        g3 = gr && GUNS()[gun];
      if (G && g3) {
        const a = R.arm.L,
          fr = pawFrame((b) => head(S, info, b), info, a.h, a.roots, a.palm),
          an = g3.anchors,
          grip = an.R || an.L;
        const kg = (typeof info.gunk === 'object' ? info.gunk[gun] : info.gunk || 0.62) * s,
          at = typeof gr.at === 'string' ? an[gr.at] : gr.at;
        const dW = nrm(turnV(G, gr.k)),
          n0 = turnV(G, gr.n),
          nW = nrm(sub3(n0, sc3(dW, dot(n0, dW))));
        const o = ap(
            G,
            sub3(at, grip).map((v) => v * kg),
          ),
          ax = nrm([G[gr.ax], G[4 + gr.ax], G[8 + gr.ax]]),
          on = add3(o, sc3(ax, dot(sub3(fr.mid, o), ax)));
        const to = sub3(on, sc3(nW, gr.r * kg + GAP)); // where the palm's middle goes
        const M = mul(move(to), mul(mul(colsM(dW, nW), tr3(colsM(fr.d, fr.n))), move(sc3(fr.mid, -1))));
        pre.L.H = pre.L.H.map((m) => mul(M, m));
        pre.L.w = ap(M, pre.L.w);
        fix.L = true;
      }
      const sh = { R: HB.track(P.shoulderR, f, A.n), L: HB.track(P.shoulderL, f, A.n) },
        el = { R: HB.track(P.elbowR, f, A.n), L: HB.track(P.elbowL, f, A.n) };
      for (const sd of ['R', 'L'])
        if (!zero(sh[sd])) {
          const a = R.arm[sd];
          over(S, about(euler(sh[sd]), head(S, info, a.sh)), a.subS);
        }
      let Gn = G,
        D = { R: null, L: null };
      if (G && gunMoved) {
        Gn = mul(G, E);
        const Gi = inv(G);
        for (const sd of ['R', 'L']) {
          const pw = pl['paw' + sd] || {},
            c = ap(Gi, pre[sd].w); // the paw in the gun's frame
          let Pm = mul(move(add3(c, pw.p || [0, 0, 0])), mul(euler(pw.r || [0, 0, 0]), move(sc3(c, -1))));
          if (sd === 'L' && s !== 1 && !fix.L) Pm = mul(move(sc3(c, s - 1)), Pm); // (the fore-end's place grows with the gun)
          D[sd] = mul(Gn, mul(Pm, Gi));
        }
      }
      for (const sd of ['R', 'L']) {
        if (!D[sd] && !fix[sd] && zero(sh[sd]) && zero(el[sd])) continue;
        const a = R.arm[sd],
          A0 = head(S, info, a.a),
          E0 = head(S, info, a.f),
          W0 = head(S, info, a.h),
          l1 = len(sub3(E0, A0)),
          l2 = len(sub3(W0, E0));
        let M = D[sd] || euler([0, 0, 0]),
          wt0 = ap(M, pre[sd].w);
        if (fix[sd] && Gn) {
          // (an arm too short for the place: the paw slides along what it holds, toward the body)
          const u = nrm([Gn[gr.ax], Gn[4 + gr.ax], Gn[8 + gr.ax]]),
            v = sub3(wt0, A0),
            Rm = (l1 + l2) * 0.995,
            vu = dot(v, u),
            q = vu * vu - dot(v, v) + Rm * Rm;
          if (len(v) > Rm) {
            const ts = q >= 0 ? [-vu - Math.sqrt(q), -vu + Math.sqrt(q)] : [-vu],
              t = Math.max(
                -SLIDE,
                Math.min(
                  SLIDE,
                  ts.reduce((x, y) => (Math.abs(y) < Math.abs(x) ? y : x)),
                ),
              );
            M = mul(move(sc3(u, t)), M);
            wt0 = ap(M, pre[sd].w);
          }
        }
        const d = sub3(wt0, A0),
          L = len(d),
          dn = nrm(d),
          dist = Math.min(Math.max(L, Math.abs(l1 - l2) * 1.001 + 1e-6), (l1 + l2) * 0.9995);
        let pd = sub3(E0, A0);
        pd = sub3(pd, sc3(dn, dot(pd, dn)));
        pd = len(pd) > 1e-6 ? nrm(pd) : nrm(cross(dn, [0, 1, 0]));
        if (!zero(el[sd])) pd = ap(axisRot(dn, el[sd][0] * D2R), pd); // the elbow swung round
        const ca = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))),
          sa = Math.sqrt(1 - ca * ca);
        const En = add3(A0, add3(sc3(dn, l1 * ca), sc3(pd, l1 * sa))),
          Wt = add3(A0, sc3(dn, dist));
        over(S, about(fromTo(sub3(E0, A0), sub3(En, A0)), A0), a.subA);
        const W1 = head(S, info, a.h);
        over(S, about(fromTo(sub3(W1, En), sub3(Wt, En)), En), a.subF);
        const Mh = mul(move(sub3(Wt, wt0)), M); // the paw as the gun has it (short: where the arm gets it)
        a.subH.forEach((b, i) => {
          const v = mul(Mh, pre[sd].H[i]);
          for (let j = 0; j < 12; j++) S[b * 12 + j] = v[j];
        });
        // the twist from the upper arm to the paw shared evenly by the elbow and the wrist (the model has no twist bones: one joint
        // taking it all wrings the fur round it): the forearm rolled about itself
        {
          const Ra = turnOf(S, a.a, a.ua),
            Rf = turnOf(S, a.f, a.uf),
            Rh = turnOf(S, a.h),
            te = twistOf(Ra, Rf, a.uf),
            tw = twistOf(Rf, Rh, a.uf);
          const rho = Math.max(-1.4, Math.min(1.4, (te + tw) / 2 - te)),
            E1 = head(S, info, a.f),
            ax = nrm(sub3(head(S, info, a.h), E1));
          out.twist[sd] = Math.max(out.twist[sd], Math.abs((te + tw) / 2));
          if (Math.abs(rho) > 1e-4) over(S, about(axisRot(ax, rho), E1), [a.f]);
        }
        out.short[sd] = Math.max(out.short[sd], L - dist);
        if (sd === 'R' && Gn && L - dist > 1e-4) Gn = mul(move(sub3(Wt, wt0)), Gn); // (the gun stays in the right paw)
      }
      out.m.push(Float32Array.from(S));
      out.g.push(Gn ? Gn.map((v) => Math.round(v * 1e5) / 1e5) : null);
    }
    return out;
  }

  // ---------------- the sim's muzzles (data.js D.HERO3D.mz, as the export writes them): per gun the mean muzzle over its aiming clips'
  // frames (idle, walk and run, not turned), in the sim's units (h: the hero's drawn height, simS: sim.js HERO.s). only: these guns (else all)
  HB.muzzles = (info, T, GUN3D, h, simS, only) => {
    const ks = h / 0.8660254 / simS,
      out = {};
    for (const gn of info.holds) {
      if (only && !only.includes(gn)) continue;
      const an = GUN3D[gn].anchors,
        grip = an.R || an.L,
        k = (typeof info.gunk === 'object' ? info.gunk[gn] : info.gunk) * HB.scaleOf(T, gn);
      const v = sub3(an.muzzle, grip).map((x) => x * k),
        acc = [0, 0, 0];
      let n = 0;
      for (const c of ['idle_' + gn, 'walk_' + gn, 'run_' + gn]) {
        const A = info.anims[c];
        if (!A) continue;
        const gs = HB.touches(T, c) ? HB.bake(info, T, c).g : A.g.map(square);
        for (const F of gs) {
          const p = ap(F, v);
          acc[0] += p[0];
          acc[1] += p[1];
          acc[2] += p[2];
          n++;
        }
      }
      out[gn] = acc.map((x) => Math.round((x / n) * ks * 1e4) / 1e4);
    }
    if (out.sniper) out.laser = out.sniper.slice();
    return out;
  };
  // the joints of a pose (for the editor's skeleton): per bone where its head is
  HB.joints = (S, info) => info.bones.map((_, b) => head(S, info, b));
  HB.rig = rig;
  // (the editor's handles: turns as matrices and back to degrees — x first, then y, then z, about fixed axes)
  HB.toEuler = (R) => {
    const y = Math.asin(Math.max(-1, Math.min(1, -R[8]))),
      c = Math.cos(y);
    const x = Math.abs(c) > 1e-6 ? Math.atan2(R[9], R[10]) : Math.atan2(-R[6], R[5]),
      z = Math.abs(c) > 1e-6 ? Math.atan2(R[4], R[0]) : 0;
    return [x, y, z].map((v) => v / D2R);
  };
  Object.assign(HB, { euler, axisRot, mul, ap, square, inv });

  root.HEROBAKE = HB;
  if (typeof module !== 'undefined') module.exports = HB;
})(typeof window !== 'undefined' ? window : globalThis);
