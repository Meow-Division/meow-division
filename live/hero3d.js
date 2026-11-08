// live/hero3d.js — the hero: the user's ginger Meshy cat in an olive helmet, orange goggles and bandana, a black vest (art/hero3d/meshycat2.py
// → assets/c_cat.*), drawn by charmesh.js as the 3D bosses are, the selected gun (gunmesh.js) in its paws, drawn into the same layer so
// the paws and the gun cover each other as they should. (An older model's own gun — meta own — is still understood.)
// The clips (c_cat.json), per gun: lobby_<gun> (standing upright at ease, the gun at the ready), idle_<gun> (aiming, standing),
// walk_<gun> and run_<gun> (aiming, walking and running): the upper body turned a little, as a shooter stands, the gun straight ahead
// in both paws. Dead, it stops
// where it stands and fades out (no clip of its own). Each frame carries where the gun is held (anims[].g: its frame — origin at the
// grip, z along the barrel, y up — in the model's space); a game gun is drawn meta gunk of the cat's height per gun unit.
// In a run it moves as a shooter's character does: the legs walk the way it goes, slow a walk, fast a run, the two blended between
// WALK_V and RUN_V on one phase (the left foot comes down at 0 in both) that follows the ground covered (meta gaitw, gait: the walk's
// and the run's stride, blended too, so a planted foot stays put); the upper body leans into the way it goes, more the faster and more
// still while it speeds up, back a little as it stops (a spring: it sways; over the hips, each bone its share as for the turn) and the upper body — chest, arms, head, the gun — turns to the aim on top of them (each bone
// its share: meta up), the legs leaning toward the aim too so the waist never winds far; aiming more than a quarter turn from the way
// it goes it faces the aim and backs away (the walk played backward). Each shot kicks the upper body and the gun back a little (the sim's p.kick). The muzzle drawn is where the sim's shots
// leave (data.js D.HERO3D, written by the export).
// The character editor's changes (live/hero.js → window.HERO_TUNE, /live/index.html?hero) are baked over the clips as they load
// (herobake.js: parts of the body turned, the gun moved in its paws, the arms reaching for it again) and set how it moves (motion:
// the turns' limits and speeds, the kick, the clips' speeds, the blinks); H3.retune(tune) bakes them again (the editor).
(function () {
  const H3 = (window.HERO3D = {}),
    ID = window.HERO_ID || 'cat'; // (another character: index.html ?heroid, a local copy only)
  H3.H = (DATA.HERO3D && DATA.HERO3D.h) || 128; // drawn height in the run (view px): the sim's muzzles are measured at it
  let TWIST = 1.2; // rad: how far the upper body may turn from the legs (a moment, while they catch up)
  let LEGS_OFF = 0.8,
    REST_OFF = 0.55; // rad: walking, how far the legs lean off the way it goes; standing, how far the aim strays before the feet follow
  let LEG_RATE = 9,
    TWIST_RATE = 16,
    KICK_BACK = 60,
    LOBBY_SPEED = 1,
    IDLE_SPEED = 1,
    STRIDE = 1,
    BLINK = 4; // rad/s, rad/s, kick units/s, ×, ×, ×, s
  let WALK_V = 0.55,
    RUN_V = 0.95,
    LEAN_V = 4,
    LEAN_A = 5; // heights/s: walking up to, running from; degrees: the lean at full speed, speeding up
  const D2R = Math.PI / 180;
  let I = null,
    UP = null,
    TUNE = window.HERO_TUNE || {}; // UP: per bone, the share of the upper body's turn it takes
  let PV = [0, 0.28, 0.05]; // the hips at rest (model units): what the upper body leans over
  const GA = {}; // per clip: the gun's frames as the tune has them
  H3.load = () =>
    CHARMESH.load([ID]).then(() => {
      I = CHARMESH.info(ID);
      if (I && ID !== 'cat' && I.mz) {
        H3.H = I.h;
        DATA.HERO3D = { h: I.h, mz: I.mz };
      } // (its own height and muzzles: the sim takes them)
      if (I) {
        UP =
          I.up ||
          I.bones.map((n) =>
            /Spine2|Neck|Head|Shoulder|Arm|Hand/.test(n) ? 1 : /Spine1/.test(n) ? 0.65 : /Spine$/.test(n) ? 0.3 : 0,
          );
        if (I.head && I.parent) PV = I.head[Math.max(0, I.parent.indexOf(-1))];
        H3.retune(TUNE);
      }
      return !!I;
    });
  // the tune laid over the clips (only: just these clips; the rest as they are): their frames rewritten in charmesh's copy, the gun's
  // frames here; the motion's numbers. Returns { clip: { R, L } } how far each paw falls short of its place (an arm too short)
  H3.retune = (T, only) => {
    TUNE = T || {};
    const M = TUNE.motion || {},
      rad = (k, d) => (M[k] != null ? (M[k] * Math.PI) / 180 : d),
      x = (k, d) => (M[k] != null ? M[k] : d);
    TWIST = rad('twist', 1.2);
    LEGS_OFF = rad('legs', 0.8);
    REST_OFF = rad('rest', 0.55);
    LEG_RATE = 9 * x('legRate', 1);
    TWIST_RATE = 16 * x('twistRate', 1);
    KICK_K = KICK * x('kick', 1);
    KICK_BACK = 60 * x('kickBack', 1);
    LOBBY_SPEED = x('lobbySpeed', 1);
    IDLE_SPEED = x('idleSpeed', 1);
    STRIDE = x('stride', 1);
    BLINK = x('blink', 4);
    WALK_V = x('walkV', 0.55);
    RUN_V = Math.max(WALK_V + 0.05, x('runV', 0.95));
    LEAN_V = x('lean', 4);
    LEAN_A = x('leanAcc', 5);
    const short = {},
      cache = {};
    if (!I) return short;
    for (const k in I.anims) {
      if (only && !only.includes(k)) continue;
      const C = CHARMESH.clip(ID, k),
        A = I.anims[k];
      if (!C) continue;
      if (window.HEROBAKE && I.parent && HEROBAKE.touches(TUNE, k)) {
        const b = HEROBAKE.bake(I, TUNE, k, cache);
        b.m.forEach((m, i) => C.m[i].set(m));
        GA[k] = b.g;
        short[k] = b.short;
      } else {
        A.m.forEach((m, i) => C.m[i].set(m));
        GA[k] = A.g;
      }
    }
    return short;
  };
  H3.info = () => I;
  H3.ready = () => !!(I && I.anims.lobby_pistol);
  const held = (gun) => (DATA.GUN3D[gun] ? gun : 'sniper'); // the clip's gun: the one drawn (the laser has no mesh: the long one)
  const clip = (k, gun) => (I.anims[k + '_' + held(gun)] ? k + '_' + held(gun) : k + '_shotgun');
  const groundYaw = (a) => Math.atan2(Math.cos(a), 2 * Math.sin(a)); // the screen direction a (radians, screen y down) as a turn of the model
  const ease = (v, to, up, down, dt) => (to > v ? Math.min(to, v + up * dt) : Math.max(to, v - down * dt));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const turnTo = (v, to, rate, dt) => v + Math.max(-rate * dt, Math.min(rate * dt, wrap(to - v)));

  H3.state = () => ({
    t: -1,
    yaw: 0,
    twist: 0,
    kick: 0,
    moveW: 0,
    runW: 1,
    ph: 0,
    it: 0,
    back: false,
    dieT: -1,
    fade: 1,
    layers: null,
    gun: false,
    bs: -1,
    blink: 0,
    lean: 0,
    leanV: 0,
    fwd: 0,
    acc: 0,
  });
  // a blink now and then (every 2–6 s, sometimes twice running): shut in 0.07 s, open again in 0.11 → st.blink, 0 open … 1 shut
  const blink = (st) => {
    if (!(BLINK > 0)) {
      st.blink = H3.forceBlink ?? 0;
      return;
    } // (the tune: never)
    if (st.bs < 0 || st.bs > st.it + 2 * BLINK) st.bs = st.it + 1 + 2 * Math.random();
    const a = st.it - st.bs;
    if (a > 0.18) {
      st.bs = st.it + (Math.random() < 0.2 ? 0.1 : BLINK * (0.5 + Math.random()));
      st.blink = 0;
    } else st.blink = a < 0 ? 0 : a < 0.07 ? a / 0.07 : 1 - (a - 0.07) / 0.11;
    if (H3.forceBlink != null) st.blink = H3.forceBlink; // (checks: a lid held where asked)
  };
  // the menus: standing at ease, the selected gun held at the ready, facing aim (turned spin more: the lobby's drag; held: at once)
  H3.lobby = (st, t, aim, gun, spin = 0, held = false) => {
    if (!H3.ready()) return st;
    if (t < st.t) st.t = -1;
    const first = st.t < 0,
      dt = first ? 0 : Math.max(0, Math.min(0.1, t - st.t));
    st.t = t;
    st.it += dt;
    const want = groundYaw(aim) + spin;
    st.yaw = first || held ? want : turnTo(st.yaw, want, 3, dt);
    st.twist = 0;
    st.gun = true;
    st.fade = 1;
    st.kick = 0;
    st.lean = 0;
    st.rlw = 0;
    const a = clip('lobby', gun);
    blink(st);
    st.layers = [{ anim: a, f: st.it * I.anims[a].fps * LOBBY_SPEED, w: 1 }];
    return st;
  };
  // a run: o = { aim (screen direction it aims), vx, vy (screen px/s), x, y (where it is: the speed it really goes is read from these —
  // pressed against a wall or a crowd it doesn't run on the spot; without them vx, vy), dead, gun, h (drawn height) } → st.layers, st.yaw, st.twist
  const CADENCE = 3.2; // cycles/s at the most: faster than that the stride lengthens (no frantic legs)
  H3.step = (st, t, o) => {
    if (!H3.ready()) return st;
    if (t < st.t) st.t = -1; // the clock went back (a new run): start over
    const first = st.t < 0,
      dt = first ? 0 : Math.max(0, Math.min(0.1, t - st.t));
    st.t = t;
    st.gun = true;
    const A = I.anims;
    if (o.dead) {
      // the pose it had, held, fading out
      if (st.dieT < 0) {
        st.dieT = 0;
        st.layers = (st.layers || []).map((l) => Object.assign({}, l));
      } else st.dieT += dt;
      st.twist = ease(st.twist, 0, 4, 4, dt);
      st.lean = ease(st.lean, 0, 1, 1, dt);
      st.fade = Math.max(o.down ? 0.55 : 0, 1 - st.dieT / 0.8);
      return st; // (playing together a hero down stays in sight)
    }
    st.dieT = -1;
    st.fade = 1;
    st.kick = Math.max(o.kick || 0, st.kick - KICK_BACK * dt);
    // reloading (o.rl: how far through it, 0…1; else none): the upper body bows over the gun, turning it side-on, and straightens up as
    // the new magazine goes home
    st.rlw = first ? 0 : ease(st.rlw || 0, o.rl >= 0 && o.rl < 0.86 ? 1 : 0, 8, 6, dt);
    // how fast it really goes: its position's change, smoothed over a few frames (a jump of the position — a new run — starts over)
    let vx = o.vx || 0,
      vy = o.vy || 0;
    if (o.x !== undefined) {
      const jx = o.x - (st.px ?? o.x),
        jy = o.y - (st.py ?? o.y);
      if (first || st.px === undefined || Math.hypot(jx, jy) > 80) {
        st.mvx = vx;
        st.mvy = vy;
      } else if (dt > 0) {
        const k = Math.min(1, dt * 18);
        st.mvx += (jx / dt - st.mvx) * k;
        st.mvy += (jy / dt - st.mvy) * k;
      }
      st.px = o.x;
      st.py = o.y;
      vx = st.mvx;
      vy = st.mvy;
    }
    // the ground it covers: the screen velocity back through the camera (screen y is the ground squashed by half)
    const s = (o.h || H3.H) / 0.8660254,
      gx = vx / s,
      gz = vy / (0.5 * s),
      sp = Math.hypot(gx, gz);
    const aimY = groundYaw(o.aim ?? Math.PI / 2),
      moving = sp > 0.25;
    let legs,
      mv = 0;
    if (moving) {
      // walking: the legs go the way it moves, or (aiming more than a quarter turn away) face back and walk backward; between the
      // two they lean toward the aim by half the difference (at most LEGS_OFF), the upper body takes the rest
      mv = Math.atan2(gx, gz);
      const rel = wrap(aimY - mv);
      st.back = st.back ? Math.abs(rel) > Math.PI / 2 - 0.25 : Math.abs(rel) > Math.PI / 2 + 0.25; // (hysteresis: no flicking between the two)
      const base = st.back ? wrap(mv + Math.PI) : mv,
        r = wrap(aimY - base);
      legs = wrap(base + Math.max(-LEGS_OFF, Math.min(LEGS_OFF, r * 0.5)));
    } else {
      // standing: the feet stay put while the aim is within REST_OFF of them, then step round after it
      const d = first ? 0 : wrap(aimY - st.yaw);
      legs = Math.abs(d) > REST_OFF ? wrap(aimY - Math.sign(d) * REST_OFF) : first ? aimY : st.yaw;
    }
    st.yaw = first ? legs : turnTo(st.yaw, legs, LEG_RATE, dt);
    const tw = Math.max(-TWIST, Math.min(TWIST, wrap(aimY - st.yaw)));
    st.twist = first ? tw : turnTo(st.twist, tw, TWIST_RATE, dt);
    st.moveW = first ? (moving ? 1 : 0) : ease(st.moveW, moving ? 1 : 0, 7, 6, dt);
    // walking or running: by the speed (a walk up to WALK_V, a run from RUN_V, between them both), eased so a change of pace takes a
    // step or so; the stride theirs blended (a model without a walk: the run alone)
    const idle = clip('idle', o.gun),
      run = clip('run', o.gun),
      walk = A['walk_' + held(o.gun)] ? 'walk_' + held(o.gun) : A.walk_shotgun ? 'walk_shotgun' : null;
    const u = walk ? Math.max(0, Math.min(1, (sp - WALK_V) / (RUN_V - WALK_V))) : 1,
      runTo = u * u * (3 - 2 * u);
    st.runW = first ? runTo : moving ? ease(st.runW, runTo, 3, 3, dt) : st.runW; // (stopping: the gait it had, fading out)
    const stride = Math.max(
      ((I.gaitw || I.gait || 0.5) + ((I.gait || 0.5) - (I.gaitw || I.gait || 0.5)) * st.runW) * STRIDE,
      sp / CADENCE,
    );
    // the phase: the ground covered along the legs (backward when they face away from the way it goes)
    const fwd = moving ? sp * Math.cos(wrap(mv - st.yaw)) : 0;
    st.ph = (((st.ph + (fwd / stride) * dt) % 1) + 1) % 1;
    st.it += dt;
    blink(st);
    // the lean: into the way it goes with the speed along the legs, more while speeding up, back as it stops (the change of that speed,
    // smoothed); the upper body follows on a spring (it sways a little past and back)
    if (first) {
      st.fwd = fwd;
      st.acc = 0;
      st.lean = st.leanV = 0;
    } else {
      const a = (fwd - st.fwd) / Math.max(dt, 1e-3);
      st.fwd = fwd;
      st.acc += (a - st.acc) * Math.min(1, dt * 12);
      const want =
        (LEAN_V * Math.max(-1, Math.min(1, fwd / 1.6)) + LEAN_A * Math.max(-1, Math.min(1, st.acc / 16))) * D2R;
      st.leanV += ((want - st.lean) * 120 - st.leanV * 17) * dt;
      st.lean += st.leanV * dt;
    }
    st.layers = [];
    if (1 - st.moveW > 0.01) st.layers.push({ anim: idle, f: st.it * A[idle].fps * IDLE_SPEED, w: 1 - st.moveW });
    const wW = walk ? st.moveW * (1 - st.runW) : 0,
      rW = st.moveW - wW;
    if (wW > 0.01) st.layers.push({ anim: walk, f: st.ph * A[walk].n, w: wW });
    if (rW > 0.01) st.layers.push({ anim: run, f: st.ph * A[run].n, w: rW });
    return st;
  };
  // the upper body turned by st.twist about the vertical through the model's origin (each bone its share): charmesh's post hook
  const turnRows = (B, o, a) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    for (let k = 0; k < 4; k++) {
      const x = B[o + k],
        z = B[o + 8 + k];
      B[o + k] = c * x + s * z;
      B[o + 8 + k] = -s * x + c * z;
    }
  };
  // the upper body leaned forward by a (radians) over the hips (PV: its height and depth): a bone matrix's (or the gun frame's) y and z
  // rows turned about the model's x through them
  const leanRows = (B, o, a) => {
    const c = Math.cos(a),
      s = Math.sin(a),
      py = PV[1],
      pz = PV[2];
    B[o + 7] -= py;
    B[o + 11] -= pz;
    for (let k = 0; k < 4; k++) {
      const y = B[o + 4 + k],
        z = B[o + 8 + k];
      B[o + 4 + k] = c * y - s * z;
      B[o + 8 + k] = s * y + c * z;
    }
    B[o + 7] += py;
    B[o + 11] += pz;
  };
  const KICK = 0.0022; // model units back per unit of the sim's kick (6: one shot)
  let KICK_K = KICK; // (the tune's share of it)
  const RL_LEAN = 22 * D2R,
    RL_TURN = -0.55; // the reload pose at its fullest: bowed forward, turned (rad)
  const leanOf = (st) => (st.lean || 0) + (st.rlw || 0) * RL_LEAN,
    twistOf = (st) => st.twist + (st.rlw || 0) * RL_TURN;
  const twistPost = (st) => (B) => {
    const kb = st.gun ? st.kick * KICK_K : 0,
      ln = leanOf(st),
      tw = twistOf(st);
    if (!tw && !kb && !ln) return;
    for (let b = 0; b < UP.length; b++)
      if (UP[b]) {
        if (ln) leanRows(B, b * 12, ln * UP[b]);
        B[b * 12 + 11] -= kb * UP[b];
        if (tw) turnRows(B, b * 12, tw * UP[b]);
      }
  };
  // the gun's frame of a clip at frame f (the two nearest frames blended; loops wrap): 12 numbers, 3 rows of 4
  function gunAt(anim, f) {
    const A = I.anims[anim],
      n = A.n,
      i0 = Math.floor(f),
      k = f - i0,
      g = GA[anim] || A.g;
    const a = A.loop ? ((i0 % n) + n) % n : Math.max(0, Math.min(n - 1, i0)),
      b = A.loop ? (a + 1) % n : Math.min(n - 1, a + 1);
    return g[a].map((v, i) => v + (g[b][i] - v) * k);
  }
  // the gun as gunmesh.js draws it: its grip at the frame's origin, its barrel along the frame's z (the blended frame squared up
  // again), turned with the upper body and then by yaw as charmesh turns the model — { id, Rg, tg, K, muzzle, spinP } in model units
  function place(F, id, yaw, twist, kick, lean = 0) {
    F = F.slice();
    if (lean) leanRows(F, 0, lean);
    F[11] -= kick; // (leaning with the upper body; the shot's kick: back along the model's z, before the turns)
    const own = I.own && I.own.gun === id;
    const mid = own ? id : DATA.GUN3D[id] ? id : 'sniper',
      g = DATA.GUN3D[mid],
      gk =
        (typeof I.gunk === 'object' ? I.gunk[mid] || 0.62 : I.gunk || 0.62) *
        (window.HEROBAKE ? HEROBAKE.scaleOf(TUNE, mid) : 1),
      K = DATA.gunK(mid).map((k) => k * gk); // (the laser has no mesh: the long one)
    const rot = (a) => {
      const c = Math.cos(a),
        s = Math.sin(a);
      return (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    };
    const tw = rot(twist),
      turn = rot(yaw),
      T = (v) => turn(tw(v));
    const nrm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    let z = nrm([F[2], F[6], F[10]]),
      y = [F[1], F[5], F[9]];
    const yz = y[0] * z[0] + y[1] * z[1] + y[2] * z[2];
    y = nrm([y[0] - z[0] * yz, y[1] - z[1] * yz, y[2] - z[2] * yz]);
    const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    const X = T(x),
      Y = T(y),
      Z = T(z),
      o = T([F[3], F[7], F[11]]);
    if (own) {
      const m = I.own.mz;
      return { id: mid, own: true, muzzle: [0, 1, 2].map((i) => o[i] + X[i] * m[0] + Y[i] * m[1] + Z[i] * m[2]) };
    } // its own: in its paws already
    const at = (p) => [0, 1, 2].map((i) => X[i] * p[0] * K[0] + Y[i] * p[1] * K[1] + Z[i] * p[2] * K[2]);
    const grip = at(g.anchors.R || g.anchors.L || g.anchors.shoulder || [0, 0, 0]),
      tg = o.map((v, i) => v - grip[i]),
      mz = at(g.anchors.muzzle || [0, 0, 0.3]);
    return {
      id: mid,
      Rg: [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]],
      tg,
      K,
      o,
      muzzle: tg.map((v, i) => v + mz[i]),
      spinP: g.anchors.spin || [0, 0, 0],
    };
  }
  // the middle of its boots in a clip, [x, z] in model units: the bones near the floor in its first frame, skinned. The model's origin
  // sits behind the boots (between the hips), so turned about it the cat swings round a circle; the menus turn it about this instead
  const FEET = {};
  const feet = (anim) =>
    FEET[anim] ||
    (FEET[anim] = (() => {
      const c = CHARMESH.clip(ID, anim),
        m = c && c.m[0],
        p = [0, 0];
      let n = 0;
      if (!m || !I.head) return p;
      I.head.forEach((r, b) => {
        const o = b * 12,
          v = (k) => m[o + k] * r[0] + m[o + k + 1] * r[1] + m[o + k + 2] * r[2] + m[o + k + 3];
        if (v(4) < 0.1 * I.height) {
          p[0] += v(0);
          p[1] += v(8);
          n++;
        }
      });
      return n ? [p[0] / n, p[1] / n] : p;
    })());
  // draw: the hero as st has it (H3.step / H3.lobby), its feet at (x, y) in view px of the bound target, h px tall, holding gun (an
  // id) where its clips hold one. U as charmesh's (light, lk, flash, rim, alpha, tint, elev; feet: turned about the middle of its
  // boots, which stay where they stand unturned); gunU: the gun's (spin, slide)
  H3.draw = (st, x, y, h, gun, U = {}, gunU = {}) => {
    if (!H3.ready() || !st.layers || !st.layers.length) return false;
    if (U.feet && st.yaw) {
      const p = feet(st.layers[0].anim),
        c = Math.cos(st.yaw),
        s = Math.sin(st.yaw),
        k = h / (I.height * 0.8660254);
      x += (p[0] - p[0] * c - p[1] * s) * k;
      y += (p[1] + p[0] * s - p[1] * c) * Math.sin(U.elev ?? Math.PI / 6) * k;
    }
    let g = null;
    const held = st.layers.filter((l) => I.anims[l.anim].g);
    if (gun && st.gun && held.length) {
      const F = new Array(12).fill(0);
      let tw = 0;
      for (const l of held) {
        const f = gunAt(l.anim, l.f);
        for (let i = 0; i < 12; i++) F[i] += f[i] * l.w;
        tw += l.w;
      }
      for (let i = 0; i < 12; i++) F[i] /= tw || 1;
      g = place(F, gun, st.yaw, twistOf(st), st.kick * KICK_K, leanOf(st));
      g.spin = gunU.spin || 0;
      g.slide = gunU.slide || 0;
    }
    const after =
      g && !g.own && GUNMESH.has(g.id)
        ? (ctx) =>
            GUNMESH.draw(ctx, g, x, y, ctx.s, {
              u_elev: U.elev ?? Math.PI / 6,
              u_lit: U.light ? 1 : 0,
              u_light: U.light,
              u_lk: U.lk ?? 0.45,
              u_flash: U.flash || 0,
            })
        : null;
    // the light: in a run most of the hero's light and the scene's light map over it; in the menus (no light map) nearly all of the
    // lobby's sunset light (charmesh mood: warm from the left, the dusk's violet, the sun's rim) — her map is plain albedo: unlit, she
    // reads flat and pale against that sky
    if (st.fade <= 0) {
      H3.last = null;
      return true;
    }
    const ok = CHARMESH.draw(
      ID,
      st.layers[0].anim,
      st.layers[0].f,
      x,
      y,
      h,
      st.yaw,
      Object.assign(U.light ? { shade: 0.8 } : { shade: 1, mood: 1, ink: 0 }, U, {
        alpha: (U.alpha ?? 1) * st.fade,
        layers: st.layers,
        after,
        post: twistPost(st),
        blink: st.blink,
      }),
    );
    H3.last = g ? { muzzle: g.muzzle, grip: g.o, s: h / (I.height * 0.8660254), x, y } : null; // the muzzle drawn (model units), for the flash and checks
    return ok;
  };
  // the gun's frame in a clip at frame f as drawn (not turned; the editor's handles)
  H3.gunFrame = (anim, f) => (I && I.anims[anim] && (GA[anim] || I.anims[anim].g) ? gunAt(anim, f) : null);
  // a point of the model (model units, turned) on screen: as charmesh's camera sees it in a run
  H3.screen = (p, x, y, s) => [x + p[0] * s, y - (p[1] * 0.8660254 - p[2] * 0.5) * s];
})();
