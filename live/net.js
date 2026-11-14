// live/net.js — playing together (the server's side: server/rooms.mjs). NET.Lock is the run's lockstep: each player's inputs, step by
// step, as they come (its own committed a few steps ahead — D, the input delay — and sent; the partner's as the server passes them on),
// and the steps the sim can take (both players' inputs known). The rest is the page's: the socket to /api/ws, the rooms (open ones
// listed, private ones by code), the run started by the room's host. Loaded by the page; Lock is required by checks under node too.
// The run's clock (tick): the server's, read through the pings (each pong carries it; the round trip least held up gives the offset),
// from t0 the server sends once every page has made its sim (begin) — both pages want the same step at the same moment, and each commits
// its input D steps past it: the partner's inputs come D steps (less the way over) ahead of where it needs them, on both pages alike.
// The input is committed by the clock from a ticker of its own (N.input, tick), not from the page's frames. A socket lost mid-run:
// the seat is asked back on a new one (dropped, back).
// D: half of each page's round trip, twice their jitter (the round trips' mean deviation) and two frames' worth — from the pings —
// plus what the partner's page measures its inputs to be short by (margin, the pong's g).
(function (root) {
  const N = (root.NET = root.NET || {});
  // ---------------------------------------------------------------- the lockstep (no DOM: node checks use it as the pages do)
  // n players, me: this page's. add(i, u, inp): player i's input for its steps up to u (from where they were); out(i, at): player i
  // left at step at (its input there and after: null). inputs(s): every player's input for step s, or null while one isn't here yet
  // (steps asked in order). avail(): the steps known for everyone still in. commit(inp, to): this page's own input up to step to (a pick:
  // one step of its own first) — returns the messages to send ({u, a}: replay.js pack). cut(i, u): player i's inputs past step u
  // forgotten (a page back after its socket dropped: the server took its own only that far, and wrote the rest itself)
  N.Lock = (n, me) => {
    const q = Array.from({ length: n }, () => []),
      U = new Array(n).fill(0),
      gone = new Array(n).fill(-1);
    const L = {
      n,
      me,
      U,
      gone,
      add(i, u, inp) {
        if (!(u > U[i])) return;
        q[i].push({ u, inp });
        U[i] = u;
      },
      out(i, at) {
        if (gone[i] < 0) gone[i] = at;
      },
      cut(i, u) {
        const Q = q[i];
        let low = null;
        while (Q.length && Q[Q.length - 1].u > u) low = Q.pop();
        // (the lowest one dropped ran from the entry before it: its steps up to u stay)
        if (low && !(Q.length && Q[Q.length - 1].u >= u)) Q.push({ u, inp: low.inp });
        if (U[i] > u) U[i] = u;
      },
      inputs(s) {
        const r = new Array(n);
        for (let i = 0; i < n; i++) {
          if (gone[i] >= 0 && s >= gone[i]) {
            r[i] = null;
            continue;
          }
          const Q = q[i];
          while (Q.length && Q[0].u <= s) Q.shift();
          if (!Q.length) return null;
          r[i] = Q[0].inp;
        }
        return r;
      },
      avail() {
        let m = Infinity;
        for (let i = 0; i < n; i++) if (gone[i] < 0) m = Math.min(m, U[i]);
        return m === Infinity ? 1e9 : m;
      },
      commit(inp, to) {
        const R = root.REPLAY,
          out = [];
        const put = (x, u) => {
          const a = R.pack(x),
            c = R.in(a);
          L.add(me, u, c);
          out.push({ u, a });
        };
        if (inp.pick !== null && inp.pick !== undefined) {
          put(inp, U[me] + 1);
          inp = { ...inp, pick: null };
        }
        if (to > U[me]) put(inp, to);
        return out;
      },
    };
    return L;
  };
  if (typeof module !== 'undefined') module.exports = N;
  if (typeof window === 'undefined') return;

  // ---------------------------------------------------------------- the connection, the rooms
  // state: off | connecting | on | stale (the game was updated: the page reloads) · room: the room as the server shows it (null: none)
  // · rooms: the open ones (while the co-op page watches) · run: the run going (go): { id, me, names, heroes, seed, rs, rank, lock, D,
  // key: this seat's secret, cut: when the socket dropped mid-run (0: it is fine), s: the step the page's sim is at }
  // · rtt, mate: the round trips (ms) to the server, this page's and the partner's
  // · old: the server runs other rules than this page (it can't play together before a reload; it is still counted online)
  // · onl: the list of who is online (online()), for the balance lab
  Object.assign(N, {
    state: 'off',
    room: null,
    rooms: [],
    run: null,
    id: 0,
    me: null,
    rtt: 0,
    mate: 0,
    jit: 0,
    mjit: 0,
    off: null,
    err: '',
    fns: [],
    old: false,
    onl: null,
  });
  const emit = (k, x) =>
    N.fns.forEach((f) => {
      try {
        f(k, x);
      } catch (e) {
        console.error(e);
      }
    });
  N.on = (f) => {
    N.fns.push(f);
    return () => {
      N.fns = N.fns.filter((g) => g !== f);
    };
  };
  let ws = null,
    retry = 0,
    wantOn = false,
    watching = false,
    pingT = 0,
    queued = [],
    st = null,
    onlOn = false,
    specId = 0,
    offs = [],
    fresh = false,
    unheard = 0,
    cutT = 0;
  // a socket lost mid-run: this long to get the seat back on a new one (the server keeps it as long, rooms.mjs GRACE_MS), a new
  // socket not open within OPEN_MS is given up for the next; SILENT pings in a row with nothing heard: the line is dead though
  // nobody closed it
  const GRACE_MS = 10e3,
    OPEN_MS = 2500,
    SILENT = 3;
  const send = (m) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    else queued.push(m);
  };
  const sendNow = (m) => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }; // (nothing kept for later)
  const token = () => {
    try {
      const s = JSON.parse(localStorage.getItem('meow-division-wallet') || 'null');
      return s && s.token && window.WALLET && WALLET.account ? s.token : null;
    } catch (e) {
      return null;
    }
  };
  const hello = () =>
    sendNow({
      k: 'hello',
      rev: SIM.REV,
      tok: token(),
      nick: SAVE.nick || '',
      ava: SAVE.ava,
      bg: SAVE.bg,
      rank: DATA.rankOf(SAVE.rxp).r,
      pres: 1,
      rd: 1,
    });
  N.connect = () => {
    wantOn = true;
    if (ws && ws.readyState <= 1) return;
    N.state = 'connecting';
    emit('state');
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws';
    try {
      ws = new WebSocket(url);
    } catch (e) {
      later();
      return;
    }
    const w = ws;
    setTimeout(() => {
      if (ws === w && w.readyState === 0 && N.run && N.run.cut) kill();
    }, OPEN_MS);
    ws.onopen = () => {
      retry = 0;
      unheard = 0;
      hello();
      if (watching) ws.send(JSON.stringify({ k: 'watch', on: true }));
      if (st) ws.send(JSON.stringify({ k: 'st', ...st }));
      if (onlOn) ws.send(JSON.stringify({ k: 'online', on: true }));
      if (specId) ws.send(JSON.stringify({ k: 'spec', id: specId }));
      const q = queued;
      queued = [];
      for (const m of q) ws.send(JSON.stringify(m));
      // (mid-run on a new socket: the seat asked back — what this page has of each player's inputs, and where its sim stands)
      const R = N.run;
      if (R && R.cut) ws.send(JSON.stringify({ k: 'back', id: R.id, key: R.key, us: R.lock.U.slice(), s: R.s || 0 }));
      clearTimeout(pingT);
      ping();
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      unheard = 0;
      got(m);
    };
    ws.onclose = dropped;
  };
  // the socket is gone. Mid-run (begun, not over): the run is kept GRACE_MS while a new socket asks for the seat back — nothing is
  // committed and the sim stands meanwhile (index.html coopFrame), so the page never plays inputs the server did not take;
  // the room on screen stays as it was. Otherwise, or with the grace used up: the run is lost, as a drop always was
  function dropped() {
    clearTimeout(pingT);
    ws = null;
    if (N.state !== 'stale') N.state = 'off';
    const R = N.run;
    if (R && R.key && R.t0 !== null && !R.over && !R.lost && wantOn && N.state !== 'stale') {
      if (!R.cut) {
        R.cut = performance.now();
        queued = queued.filter((m) => m.k !== 'in');
        clearTimeout(cutT);
        cutT = setTimeout(() => {
          if (N.run === R && R.cut) lose(R);
        }, GRACE_MS);
        emit('cut', R);
      }
      emit('state');
      later();
      return;
    }
    const had = N.room || N.run;
    if (R) {
      R.lost = true;
      emit('lost');
    }
    N.room = null;
    emit('room');
    emit('state');
    if (had) emit('drop');
    if (wantOn && N.state !== 'stale') later();
  }
  function lose(R) {
    clearTimeout(cutT);
    R.cut = 0;
    R.lost = true;
    emit('lost');
    N.room = null;
    emit('room');
    emit('drop');
  }
  // a socket that is open by name only (nothing heard for SILENT pings, or never opened): dropped here and now, without waiting
  // for the browser to notice
  function kill() {
    const w = ws;
    if (!w) return;
    w.onopen = w.onmessage = w.onclose = w.onerror = null;
    try {
      w.close();
    } catch (e) {
      console.warn('ws close', e);
    }
    dropped();
  }
  // a ping every second in a room or a run (the clock and the delay keep up), every four otherwise
  const ping = () => {
    clearTimeout(pingT);
    if (!ws || ws.readyState !== 1) return;
    if (N.run && N.run.t0 !== null && ++unheard > SILENT) return kill();
    ws.send(
      JSON.stringify({ k: 'ping', t: performance.now(), r: Math.round(N.rtt), j: Math.round(N.jit), g: margin() }),
    );
    pingT = setTimeout(ping, N.room || N.run ? 1000 : 4000);
  };
  const later = () => {
    // (mid-run: at once, then every 0.7 s — the grace is short)
    const ms = N.run && N.run.cut ? (retry++ ? 700 : 100) : Math.min(15000, 1000 * 2 ** retry++);
    setTimeout(() => {
      if (wantOn && !ws) N.connect();
    }, ms);
  };
  N.close = () => {
    wantOn = false;
    if (ws) ws.close();
  };
  function got(m) {
    if (m.k === 'hi') {
      N.id = m.id;
      N.me = m.me;
      N.old = !!m.stale;
      N.state = 'on';
      emit('state');
      return;
    }
    if (m.k === 'online') {
      N.onl = m;
      emit('online', m);
      return;
    }
    if (m.k === 'spec') {
      emit('spec', !!m.on);
      return;
    }
    if (m.k === 'sv') {
      emit('sv', m);
      return;
    }
    if (m.k === 'stale') {
      N.state = 'stale';
      wantOn = false;
      emit('state');
      try {
        if (!sessionStorage.getItem('md.reloaded')) {
          sessionStorage.setItem('md.reloaded', '1');
          location.reload();
        }
      } catch (e) {}
      return;
    }
    if (m.k === 'pong') {
      const now = performance.now(),
        r = now - m.t;
      // (one round trip held up a long while — a spike — counts as a little more than the jitter so far: it can't be covered without a
      // delay everyone feels, and the clock and D shouldn't jump for it; held up for good, they follow within some seconds)
      if (!N.rtt) N.rtt = r;
      else {
        const cap = N.rtt + 3 * N.jit + 30,
          rc = Math.min(r, cap);
        // (down faster than up: the jitter a run starts with is the loading pages' own, gone in seconds; a delay cut too far
        // is put right by the partner's measure, the pong's g)
        const dev = Math.min(Math.abs(rc - N.rtt), 2 * N.jit + 15);
        N.jit = dev < N.jit ? N.jit * 0.7 + dev * 0.3 : N.jit * 0.85 + dev * 0.15;
        N.rtt = rc < N.rtt ? N.rtt * 0.5 + rc * 0.5 : N.rtt * 0.8 + rc * 0.2;
      }
      N.mate = m.m || 0;
      N.mjit = m.mj || 0;
      // the server's clock: the least held-up round trip's offset; in a run eased 2 ms a second — but taken at once when it is far off
      // (a phone asleep: its performance.now() may have stood; back on screen the old samples are dropped)
      if (Number.isFinite(m.st)) {
        if (fresh) {
          offs = [];
          fresh = false;
        }
        offs.push([r, m.st - (m.t + r / 2)]);
        if (offs.length > 12) offs.shift();
        let b = offs[0];
        for (const o of offs) if (o[0] < b[0]) b = o;
        const d = N.off === null ? 0 : b[1] - N.off;
        N.off =
          N.off === null || !N.run || N.run.t0 === null || Math.abs(d) > 60
            ? b[1]
            : N.off + Math.max(-2, Math.min(2, d));
      }
      if (N.run) {
        // g: how early this page's inputs really reach the partner (its page's measure, see margin). Short of WANT steps: the
        // shortfall is added to this page's delay at once — and nothing more for 4.5 s: the partner's measure holds the late
        // ones for two seconds more, and comes here two pings later. Well above it: half of what is spare taken back at a time
        const R = N.run;
        if (typeof m.g === 'number' && now > R.holdT) {
          if (m.g < WANT) {
            R.extra = Math.min(D_MAX, R.extra + Math.min(UP_MAX, Math.ceil(WANT - m.g)));
            R.holdT = now + 4500;
          } else if (m.g > WANT + 4 && R.extra > 0) {
            R.extra = Math.max(0, R.extra - Math.max(1, Math.floor((m.g - WANT - 4) / 2)));
            R.holdT = now + 4500;
          }
        }
        // (the pings' guess: up only when it stays higher two pongs running — taken up at once, one noisy
        // ping at a time, it crept from 6 steps to 12 on a link that had not changed; down a third of the way each pong: the
        // guess a run starts with is made while both pages load, and is far too long. What the partner measured counts at once)
        const d = delay();
        if (d > R.base) {
          if (++R.upN >= 2) R.base = d;
        } else {
          R.upN = 0;
          if (d < R.base) R.base -= Math.max(1, Math.floor((R.base - d) / 3));
        }
        R.D = Math.min(D_MAX, R.base + R.extra);
      }
      return;
    }
    if (m.k === 'rooms') {
      N.rooms = m.list || [];
      emit('rooms');
      return;
    }
    if (m.k === 'room') {
      N.room = m.room;
      emit('room');
      return;
    }
    if (m.k === 'err') {
      N.err = m.e;
      emit('err', m.e);
      return;
    }
    if (m.k === 'kicked') {
      N.room = null;
      emit('kicked');
      emit('room');
      return;
    }
    if (m.k === 'go') {
      const r = m.run;
      const d = delay();
      N.run = {
        ...r,
        lock: N.Lock(r.heroes.length, r.me),
        D: d,
        base: d,
        upN: 0,
        extra: 0,
        holdT: 0,
        over: false,
        t0: null,
      };
      marg = [];
      ping();
      emit('go', N.run);
      return;
    }
    if (m.k === 'begin') {
      const R = N.run;
      if (R && Number.isFinite(m.t0)) {
        R.t0 = m.t0;
        if (N.off === null) N.off = m.t0 - 600 - performance.now();
        tickOn();
        emit('begin', R);
      }
      return;
    }
    if (m.k === 'in') {
      const R = N.run;
      if (!R || m.i === R.me) return;
      const inp = REPLAY.in(m.a);
      if (inp) R.lock.add(m.i, m.u, inp);
      return;
    }
    if (m.k === 'gone') {
      const R = N.run;
      if (!R) return;
      R.lock.out(m.i, m.at);
      emit('gone', m.i);
      return;
    }
    if (m.k === 'back') {
      const R = N.run;
      if (!R || !R.cut) return;
      if (!m.run || m.run.id !== R.id || !Number.isInteger(m.uo)) return lose(R);
      // the seat is this page's again: its own inputs as the server took them (uo; past it the stand-still steps written while it
      // was away), the partner's since — the same inputs the partner's page and the replay have
      R.lock.cut(R.me, m.uo);
      for (const e of m.ins || []) {
        const inp = REPLAY.in(e[2]);
        if (inp) R.lock.add(e[0], e[1], inp);
      }
      for (const e of m.gone || []) {
        if (R.lock.gone[e[0]] >= 0) continue;
        R.lock.out(e[0], e[1]);
        emit('gone', e[0]);
      }
      clearTimeout(cutT);
      R.cut = 0;
      emit('back', R);
      return;
    }
    if (m.k === 'desync') {
      emit('desync', m.s);
      return;
    }
    if (m.k === 'end') {
      emit('end', N.run);
      return;
    }
    if (m.k === 'paid') {
      emit('paid', m.res);
      return;
    }
  }
  // the input delay (steps): the way over (half of each page's round trip), one and a half times the two jitters and 12 ms of margin (it was 44 ms:
  // two frames — an input waited for its page's frame and for the partner's; it is committed on its key now, and by the ticker
  // between frames — and 10 ms on top): from 3 steps (25 ms) up. That is a guess from the pings; what the link
  // really does to the inputs is measured by the partner's page and added on top (R.extra, the pong's g). D_MAX steps at the most (a
  // second: a bad link plays with a long delay rather than in stops; the cap was 48 steps, and past it the run stalled for good)
  // (UP_MAX: the most one answer adds, 100 ms — one bad measure is not a second of delay; SETTLE: the steps before any is taken)
  const D_MAX = 120,
    WANT = 2,
    UP_MAX = 12,
    SETTLE = 360;
  function delay() {
    const ms = (N.rtt || 120) / 2 + (N.mate || 120) / 2 + 1.5 * (N.jit + N.mjit) + 12;
    return Math.max(3, Math.min(D_MAX, Math.ceil(ms / (1000 / 120))));
  }
  // how far the partner's inputs run past the run's clock here (steps), sampled at every tick; margin(): the low end of the last two
  // seconds of it (the 5th percentile), sent with the ping — the server passes it to the partner, whose delay answers for it
  let marg = [];
  const sample = (R) => {
    const L = R.lock;
    let u = Infinity;
    for (let i = 0; i < L.n; i++) if (i !== L.me && L.gone[i] < 0) u = Math.min(u, L.U[i]);
    const T = N.tick();
    if (u === Infinity || T < SETTLE || R.cut) return; // (the first seconds: both pages still build their pictures)
    marg.push(u - T);
    if (marg.length > 128) marg.shift();
  };
  const margin = () => {
    if (!N.run || marg.length < 30) return null;
    const s = marg.slice().sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length * 0.05)] * 10) / 10;
  };
  // the run's clock: the step the server's clock is at now (fractional; -1 before the begin)
  N.tick = () => {
    const R = N.run;
    if (!R || R.t0 === null || N.off === null) return -1;
    return (performance.now() + N.off - R.t0) * 0.12;
  };
  N.loaded = () => send({ k: 'loaded' });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fresh = true;
      ping();
    }
  });
  N.watch = (on) => {
    watching = on;
    if (on) N.connect();
    send({ k: 'watch', on });
  };
  // who is playing (the server's list, the balance lab): every game page keeps its socket (presence) and says what it is doing (status:
  // { s: lobby | run | room | watch | coop, t, lvl, gun, menu, lab, tg }, sent when it changes); online(on) asks for the list every 2 s;
  // spec(id) watches that page's runs (0: stops), the server's sv messages come as 'sv'; sv(m) sends this page's own run while it is
  // watched ('spec' says when)
  N.presence = () => N.connect();
  N.status = (s) => {
    const k = JSON.stringify(s);
    if (k === N.stKey) return;
    N.stKey = k;
    st = s;
    sendNow({ k: 'st', ...s });
  };
  N.online = (on) => {
    onlOn = on;
    if (on) N.connect();
    sendNow({ k: 'online', on });
  };
  N.spec = (id) => {
    specId = id || 0;
    if (id) N.connect();
    sendNow({ k: 'spec', id: specId });
  };
  N.sv = (m) => sendNow({ k: 'sv', ...m });
  const want = (gun) => ({ weapon: gun, meta: { ...SAVE.meta }, wup: { ...SAVE.wupOf(gun) } });
  N.make = (open, gun, map) => {
    N.err = '';
    N.connect();
    send({ k: 'make', open: !!open, gun, want: want(gun), map });
  };
  N.join = (code, gun) => {
    N.err = '';
    N.connect();
    send({ k: 'join', code, gun, want: want(gun) });
  };
  N.gun = (gun) => send({ k: 'gun', gun, want: want(gun) });
  N.setOpen = (on) => send({ k: 'open', on });
  N.setMap = (id) => send({ k: 'map', id }); // (the host: where the run goes — DATA.MAPS id)
  N.kick = () => send({ k: 'kick' });
  N.leave = () => {
    send({ k: 'leave' });
    N.room = null;
    emit('room');
  };
  N.start = () => send({ k: 'start' });
  N.ready = (on) => send({ k: 'ready', on: !!on }); // (the guest: ready to start — the host can't start before it)
  N.over = (s, h) => {
    if (N.run && !N.run.over) {
      N.run.over = true;
      send({ k: 'over', s, h });
    }
  };
  // the state's fingerprint at step s (every CHECK steps): the server compares both pages' (rooms.mjs chk) and says so when they differ
  N.CHECK = 600;
  N.check = (s, h) => {
    if (N.run && !N.run.cut) sendNow({ k: 'chk', s, h });
  };
  N.quit = () => {
    if (N.run) {
      send({ k: 'quit' });
      N.run = null;
    }
  };
  N.done = () => {
    N.run = null;
  };
  // this page's input, for the steps up to D past the clock's (sent at once) — by the clock alone, wherever the page's own sim is: a
  // page whose frames run late, or that is catching up, never holds its partner's run up. ahead: more steps on top (a page put
  // away: its hero stands a while ahead, the partner plays on); cap: never past it (a page put away goes no further than the
  // partner's inputs and a little)
  N.commit = (inp, ahead = 0, cap = Infinity) => {
    const R = N.run;
    // (nothing is committed that can't be sent: an input kept here and never taken by the server would be played by this page alone)
    if (!R || R.lost || R.cut || !ws || ws.readyState !== 1) return;
    const T = Math.floor(N.tick());
    if (T < 0) return;
    for (const m of R.lock.commit(inp, Math.min(T + R.D + ahead, cap))) send({ k: 'in', u: m.u, a: m.a });
  };
  // the input the player holds now (the page samples it every frame): committed at once and kept, and the run's ticker commits it
  // again every TICK_MS (a step) until the next sample — the partner hears from this page on time whatever its frames do (a slow frame, a
  // collection pause, a weak phone at 20 fps used to stall the other player's run). A pick goes once, with this call
  N.input = (inp) => {
    const R = N.run;
    if (!R) return;
    R.held = inp.pick === null || inp.pick === undefined ? inp : { ...inp, pick: null };
    N.commit(inp);
  };
  // the run's ticker: from a worker — a browser slows a hidden page's own timers to one a second, a worker's it leaves alone — or,
  // where a worker can't be made, the page's timer. Hidden, the page stands its hero (index.html's away commit, on 'away')
  const TICK_MS = 8;
  let tickW = null,
    tickI = 0;
  const tick = () => {
    const R = N.run;
    if (!R) return tickOff();
    if (document.hidden) {
      R.held = null;
      marg = []; // (its own clock is not read on time while hidden)
      emit('away');
      return;
    }
    sample(R);
    if (R.held) N.commit(R.held);
  };
  const tickOn = () => {
    if (tickW || tickI) return;
    try {
      const src = URL.createObjectURL(
        new Blob(['setInterval(() => postMessage(0), ' + TICK_MS + ');'], { type: 'text/javascript' }),
      );
      tickW = new Worker(src);
      tickW.onmessage = tick;
      tickW.onerror = (e) => {
        console.warn('coop ticker: no worker, the page timer instead', e.message);
        tickOff();
        tickI = setInterval(tick, TICK_MS);
      };
    } catch (e) {
      console.warn('coop ticker: no worker, the page timer instead', e);
      tickI = setInterval(tick, TICK_MS);
    }
  };
  const tickOff = () => {
    if (tickW) tickW.terminate();
    tickW = null;
    clearInterval(tickI);
    tickI = 0;
  };
  N.isMine = () => !!(N.room && N.room.players[0] && N.room.players[0].id === N.id);
  // a room's invite link: the Telegram bot's (opens the Mini App in the room) inside Telegram, the site's elsewhere
  N.link = (code) =>
    N.tg()
      ? 'https://t.me/MeowDivisionBot?start=r_' + code
      : location.origin + location.pathname.replace(/[^/]*$/, '') + '?room=' + code;
  N.tg = () => {
    try {
      return (
        new URLSearchParams(location.search).has('tg') ||
        !!(window.parent !== window && parent.Telegram && parent.Telegram.WebApp && parent.Telegram.WebApp.initData)
      );
    } catch (e) {
      return false;
    }
  };
  // the account changed on this page (another wallet signed in, or out): the socket's identity follows at once — the
  // co-op room and the online list used to show the one before until the socket happened to reconnect (never mid-run:
  // a run's seat keeps the identity it started with)
  if (window.WALLET && WALLET.on)
    WALLET.on((kind) => {
      if (kind === 'profile' && ws && ws.readyState === 1 && !(N.run && !N.run.over)) hello();
    });
})(typeof window !== 'undefined' ? window : globalThis);
