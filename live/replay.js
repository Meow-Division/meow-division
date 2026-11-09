// live/replay.js — a run's inputs, step by step, exactly as the sim took them. The game records them while it plays (quant + push); the
// game's server plays the run again from them (play) and pays what that replay earned, so nothing the page claims about a run counts,
// only what its inputs do in the sim. One input per 120 Hz step, quantised so both sides feed the sim the very same numbers: the
// joystick in 1/256ths, the cursor in whole view px, the view's width in 8 px steps. The log keeps only the steps where the input changed:
//   [steps since the last entry, flags, …fields]   flags: 1 left 2 right 4 up 8 down 16 fire 32 joystick 64 cursor 128 a pick 256 aiming stick
//   512 a view wider than 16:9 · 1024 the reload key
//   fields, in that order when their flag is set: jx·256, jy·256 · the cursor's move since the last cursor (x, y) · the pick · ax·256, ay·256 · vw
// Loaded by the page; required by the server.
(function (root) {
  const R = {},
    J = 256,
    LIM = 20000,
    VW0 = 1920,
    VW1 = 2592; // the view's width: SIM.VIEW.W … MAXW (no flag: VW0)
  const q = (v, k, lo, hi) => Math.round(Math.max(lo, Math.min(hi, +v || 0)) * k) / k + 0; // + 0: never −0 (the log can't tell)
  // the input as the sim gets it (the same object shape on both sides)
  R.quant = (inp) => {
    const j = inp.jx !== undefined && inp.jx !== null,
      m = inp.mx !== undefined && inp.mx !== null,
      a = inp.ax !== undefined && inp.ax !== null,
      vw = Math.min(VW1, Math.round((+inp.vw || 0) / 8) * 8);
    return {
      left: inp.left ? 1 : 0,
      right: inp.right ? 1 : 0,
      up: inp.up ? 1 : 0,
      down: inp.down ? 1 : 0,
      jx: j ? q(inp.jx, J, -1, 1) : undefined,
      jy: j ? q(inp.jy, J, -1, 1) : undefined,
      mx: m ? q(inp.mx, 1, -LIM, LIM) : undefined,
      my: m ? q(inp.my, 1, -LIM, LIM) : undefined,
      fire: !!inp.fire,
      pick: Number.isInteger(inp.pick) && inp.pick >= -2 && inp.pick <= 9 ? inp.pick : null,
      ax: a ? q(inp.ax, J, -1, 1) : undefined,
      ay: a ? q(inp.ay, J, -1, 1) : undefined,
      vw: vw > VW0 ? vw : undefined,
      rl: inp.rl ? 1 : 0,
    };
  };
  const flagsOf = (i) =>
    (i.left ? 1 : 0) |
    (i.right ? 2 : 0) |
    (i.up ? 4 : 0) |
    (i.down ? 8 : 0) |
    (i.fire ? 16 : 0) |
    (i.jx !== undefined ? 32 : 0) |
    (i.mx !== undefined ? 64 : 0) |
    (i.pick !== null ? 128 : 0) |
    (i.ax !== undefined ? 256 : 0) |
    (i.vw !== undefined ? 512 : 0) |
    (i.rl ? 1024 : 0);
  // a recording: plain JSON (the page keeps it in sessionStorage with the run). n: the steps recorded; the rest: what the next entry
  // is measured from
  R.rec = () => ({ n: 0, log: [], at: 0, f: -1, jx: 0, jy: 0, mx: 0, my: 0, cx: 0, cy: 0, ax: 0, ay: 0, vw: 0 });
  R.push = (r, i) => {
    const f = flagsOf(i);
    const same =
      f === r.f &&
      !(f & 128) &&
      (!(f & 32) || (i.jx === r.jx && i.jy === r.jy)) &&
      (!(f & 64) || (i.mx === r.mx && i.my === r.my)) &&
      (!(f & 256) || (i.ax === r.ax && i.ay === r.ay)) &&
      (!(f & 512) || i.vw === r.vw);
    if (!same) {
      r.log.push(r.n - r.at, f);
      r.at = r.n;
      r.f = f;
      if (f & 32) {
        r.log.push(i.jx * J, i.jy * J);
        r.jx = i.jx;
        r.jy = i.jy;
      }
      if (f & 64) {
        r.log.push(i.mx - r.cx, i.my - r.cy);
        r.cx = r.mx = i.mx;
        r.cy = r.my = i.my;
      }
      if (f & 128) r.log.push(i.pick);
      if (f & 256) {
        r.log.push(i.ax * J, i.ay * J);
        r.ax = i.ax;
        r.ay = i.ay;
      }
      if (f & 512) {
        r.log.push(i.vw);
        r.vw = i.vw;
      }
    }
    r.n++;
  };
  // the log back into inputs, one per step: a cursor (next(): the next step's input; end(): throws unless the log was read to its end)
  // and each(i, step) for all n steps; both throw on anything a recording can't hold
  const int = (v, lo, hi) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('bad log');
    return v;
  };
  const fromFlags = (f) => ({
    left: f & 1,
    right: (f >> 1) & 1,
    up: (f >> 2) & 1,
    down: (f >> 3) & 1,
    jx: undefined,
    jy: undefined,
    mx: undefined,
    my: undefined,
    fire: !!(f & 16),
    pick: null,
    ax: undefined,
    ay: undefined,
    vw: undefined,
    rl: (f >> 10) & 1,
  });
  R.cursor = (log, n) => {
    if (!Array.isArray(log) || !Number.isInteger(n) || n < 0) throw new Error('bad log');
    let k = 0,
      next = log.length ? int(log[0], 0, n) : n,
      cur = R.quant({}),
      cx = 0,
      cy = 0,
      s = 0;
    return {
      next() {
        if (s >= n) throw new Error('bad log');
        if (s === next) {
          const f = int(log[k + 1], 0, 2047);
          k += 2;
          cur = fromFlags(f);
          if (f & 32) {
            cur.jx = int(log[k], -J, J) / J;
            cur.jy = int(log[k + 1], -J, J) / J;
            k += 2;
          }
          if (f & 64) {
            cx += int(log[k], -2 * LIM, 2 * LIM);
            cy += int(log[k + 1], -2 * LIM, 2 * LIM);
            k += 2;
            if (Math.abs(cx) > LIM || Math.abs(cy) > LIM) throw new Error('bad log');
            cur.mx = cx;
            cur.my = cy;
          }
          if (f & 128) {
            cur.pick = int(log[k], -2, 9);
            k++;
          }
          if (f & 256) {
            cur.ax = int(log[k], -J, J) / J;
            cur.ay = int(log[k + 1], -J, J) / J;
            k += 2;
          }
          if (f & 512) {
            cur.vw = int(log[k], VW0, VW1);
            k++;
          }
          next = k < log.length ? s + int(log[k], 1, n - s) : n;
        }
        const out = cur;
        s++;
        if (cur.pick !== null) cur = { ...cur, pick: null }; // a pick is one step's
        return out;
      },
      end() {
        if (k !== log.length) throw new Error('bad log');
      },
    };
  };
  R.each = (log, n, fn) => {
    const c = R.cursor(log, n);
    for (let s = 0; s < n; s++) fn(c.next(), s);
    c.end();
  };
  // a log still being written (a run watched as it is played: the lab's spectator): add(part, n) appends what came since — whole
  // entries — and the steps it now covers; next() the next step's input while there is one (s < n), read as cursor reads it
  R.stream = () => {
    const log = [];
    let k = 0,
      at = 0,
      cur = R.quant({}),
      cx = 0,
      cy = 0;
    const st = {
      n: 0,
      s: 0,
      add(part, n) {
        if (Array.isArray(part)) for (const v of part) log.push(v);
        if (Number.isInteger(n) && n > st.n) st.n = n;
      },
      next() {
        if (st.s >= st.n) throw new Error('bad log');
        if (k < log.length && st.s === at + int(log[k], 0, 1e9)) {
          // (the first entry's steps count from 0, the rest from the one before)
          at = st.s;
          const f = int(log[k + 1], 0, 2047);
          k += 2;
          cur = fromFlags(f);
          if (f & 32) {
            cur.jx = int(log[k], -J, J) / J;
            cur.jy = int(log[k + 1], -J, J) / J;
            k += 2;
          }
          if (f & 64) {
            cx += int(log[k], -2 * LIM, 2 * LIM);
            cy += int(log[k + 1], -2 * LIM, 2 * LIM);
            k += 2;
            if (Math.abs(cx) > LIM || Math.abs(cy) > LIM) throw new Error('bad log');
            cur.mx = cx;
            cur.my = cy;
          }
          if (f & 128) {
            cur.pick = int(log[k], -2, 9);
            k++;
          }
          if (f & 256) {
            cur.ax = int(log[k], -J, J) / J;
            cur.ay = int(log[k + 1], -J, J) / J;
            k += 2;
          }
          if (f & 512) {
            cur.vw = int(log[k], VW0, VW1);
            k++;
          }
        }
        const out = cur;
        st.s++;
        if (cur.pick !== null) cur = { ...cur, pick: null };
        return out;
      },
    };
    return st;
  };
  // one input on the wire (a run played together: the room's server passes each player's inputs to the other and keeps them): the
  // flags and fields as in the log, the cursor where it is (not its move). in(): back, checked — null for anything that isn't one.
  // A page plays its own input as in(pack(input)) too, so both pages feed the sim the very same one
  R.pack = (i) => {
    const f = flagsOf(i),
      a = [f];
    if (f & 32) a.push(Math.round(i.jx * J), Math.round(i.jy * J));
    if (f & 64) a.push(i.mx, i.my);
    if (f & 128) a.push(i.pick);
    if (f & 256) a.push(Math.round(i.ax * J), Math.round(i.ay * J));
    if (f & 512) a.push(i.vw);
    return a;
  };
  R.in = (a) => {
    try {
      if (!Array.isArray(a) || a.length > 12) return null;
      const f = int(a[0], 0, 2047),
        cur = fromFlags(f);
      let k = 1;
      if (f & 32) {
        cur.jx = int(a[k], -J, J) / J;
        cur.jy = int(a[k + 1], -J, J) / J;
        k += 2;
      }
      if (f & 64) {
        cur.mx = int(a[k], -LIM, LIM);
        cur.my = int(a[k + 1], -LIM, LIM);
        k += 2;
      }
      if (f & 128) {
        cur.pick = int(a[k], -2, 9);
        k++;
      }
      if (f & 256) {
        cur.ax = int(a[k], -J, J) / J;
        cur.ay = int(a[k + 1], -J, J) / J;
        k += 2;
      }
      if (f & 512) {
        cur.vw = int(a[k], VW0 + 8, VW1);
        k++;
      }
      return k === a.length ? cur : null;
    } catch (e) {
      return null;
    }
  };
  // the run played again: the sim made from the ticket (the server's seed and the loadout it read from the account,
  // the campaign mission it was dealt for), then every step's input; it stops at the run's end (S.over) or after n
  // steps (a quit). Returns the state.
  R.play = (SIM, ticket, log, n) => {
    const S = SIM.create({
      seed: ticket.seed,
      rs: ticket.rs,
      weapon: ticket.weapon,
      meta: ticket.meta,
      wup: ticket.wup,
      rank: ticket.rank,
      mission: ticket.mission,
    });
    try {
      R.each(log, n, (inp) => {
        if (S.over) throw R.END;
        SIM.step(S, inp);
      });
    } catch (e) {
      if (e !== R.END) throw e;
    }
    return S;
  };
  R.END = { end: true };
  // a run played together, again: ticket.heroes (each player's loadout, in the room's order), and each player's log of ns[i] steps —
  // past them (a player who left) its input is null, and the sim takes its hero out at that step, as the pages did. n: the steps
  // played; it stops at the run's end
  R.playCoop = (SIM, ticket, logs, ns, n) => {
    const S = SIM.create({ seed: ticket.seed, rs: ticket.rs, heroes: ticket.heroes, rank: ticket.rank });
    const cs = logs.map((l, i) => R.cursor(l, ns[i]));
    for (let s = 0; s < n && !S.over; s++)
      SIM.step(
        S,
        cs.map((c, i) => (s < ns[i] ? c.next() : null)),
      );
    return S;
  };
  // a fingerprint of a run's state: the page sends its own with the log, the server compares (a difference: the sim isn't deterministic).
  // Together: every hero's, in the room's order (the same whichever page it is)
  R.hash = (S) => {
    const H = S.ps && S.ps.length > 1 ? S.ps : [S.p],
      hs = H.map((p) => [p.x, p.y, p.hp, p.lvl, p.xp, p.main.lvl, p.items.map((i) => i.id + i.lvl).join()].join('|'));
    // (a mission run's: its task under way and what it took too; a classic run's string is as it always was)
    const ms = S.mis ? '|' + S.mis.i + '|' + S.mis.got.join() : '',
      s = [S.steps, S.t, S.rs, S.kills, S.coins, S.bk, S.en.length, ...hs].join('|') + ms;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };

  root.REPLAY = R;
  if (typeof module !== 'undefined') module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
