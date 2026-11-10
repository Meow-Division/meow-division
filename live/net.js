// live/net.js — playing together (the server's side: server/rooms.mjs). NET.Lock is the run's lockstep: each player's inputs, step by
// step, as they come (its own committed a few steps ahead — D, the input delay — and sent; the partner's as the server passes them on),
// and the steps the sim can take (both players' inputs known). The rest is the page's: the socket to /api/ws, the rooms (open ones
// listed, private ones by code), the run started by the room's host. Loaded by the page; Lock is required by checks under node too.
// The run's clock (tick): the server's, read through the pings (each pong carries it; the round trip least held up gives the offset),
// from t0 the server sends once every page has made its sim (begin) — both pages want the same step at the same moment, and each commits
// its input D steps past it: the partner's inputs come D steps (less the way over) ahead of where it needs them, on both pages alike.
// D: half of each page's round trip, twice their jitter (the round trips' mean deviation) and two frames' worth — from the pings.
(function (root) {
  const N = (root.NET = root.NET || {});
  // ---------------------------------------------------------------- the lockstep (no DOM: node checks use it as the pages do)
  // n players, me: this page's. add(i, u, inp): player i's input for its steps up to u (from where they were); out(i, at): player i
  // left at step at (its input there and after: null). inputs(s): every player's input for step s, or null while one isn't here yet
  // (steps asked in order). avail(): the steps known for everyone still in. commit(inp, to): this page's own input up to step to (a pick:
  // one step of its own first) — returns the messages to send ({u, a}: replay.js pack)
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
  // · rooms: the open ones (while the co-op page watches) · run: the run going (go): { id, me, names, heroes, seed, rs, rank, lock, D }
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
    fresh = false;
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
    ws.onopen = () => {
      retry = 0;
      ws.send(
        JSON.stringify({
          k: 'hello',
          rev: SIM.REV,
          tok: token(),
          nick: SAVE.nick || '',
          ava: SAVE.ava,
          bg: SAVE.bg,
          rank: DATA.rankOf(SAVE.rxp).r,
          pres: 1,
          rd: 1,
        }),
      );
      if (watching) ws.send(JSON.stringify({ k: 'watch', on: true }));
      if (st) ws.send(JSON.stringify({ k: 'st', ...st }));
      if (onlOn) ws.send(JSON.stringify({ k: 'online', on: true }));
      if (specId) ws.send(JSON.stringify({ k: 'spec', id: specId }));
      const q = queued;
      queued = [];
      for (const m of q) ws.send(JSON.stringify(m));
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
      got(m);
    };
    ws.onclose = () => {
      clearTimeout(pingT);
      ws = null;
      const had = N.room || N.run;
      if (N.state !== 'stale') N.state = 'off';
      if (N.run) {
        N.run.lost = true;
        emit('lost');
      }
      N.room = null;
      emit('room');
      emit('state');
      if (had) emit('drop');
      if (wantOn && N.state !== 'stale') later();
    };
  };
  // a ping every second in a room or a run (the clock and the delay keep up), every four otherwise
  const ping = () => {
    clearTimeout(pingT);
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ k: 'ping', t: performance.now(), r: Math.round(N.rtt), j: Math.round(N.jit) }));
    pingT = setTimeout(ping, N.room || N.run ? 1000 : 4000);
  };
  const later = () => {
    const ms = Math.min(15000, 1000 * 2 ** retry++);
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
        if (!sessionStorage.getItem('zh.reloaded')) {
          sessionStorage.setItem('zh.reloaded', '1');
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
        N.jit = N.jit * 0.85 + Math.min(Math.abs(rc - N.rtt), 2 * N.jit + 15) * 0.15;
        N.rtt = N.rtt * 0.8 + rc * 0.2;
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
        const d = delay();
        N.run.D = d >= N.run.D ? d : N.run.D - 1;
      } // (up at once, down a step a second)
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
      N.run = { ...r, lock: N.Lock(r.heroes.length, r.me), D: delay(), over: false, t0: null };
      ping();
      emit('go', N.run);
      return;
    }
    if (m.k === 'begin') {
      const R = N.run;
      if (R && Number.isFinite(m.t0)) {
        R.t0 = m.t0;
        if (N.off === null) N.off = m.t0 - 600 - performance.now();
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
    if (m.k === 'end') {
      emit('end', N.run);
      return;
    }
    if (m.k === 'paid') {
      emit('paid', m.res);
      return;
    }
  }
  // the input delay (steps): the way over (half of each page's round trip), twice the two jitters, two frames (an input waits for its
  // page's frame, and the partner's frame), and a margin: 5 to 48 steps (42 to 400 ms)
  function delay() {
    const ms = (N.rtt || 120) / 2 + (N.mate || 120) / 2 + 2 * (N.jit + N.mjit) + 34 + 10;
    return Math.max(5, Math.min(48, Math.ceil(ms / (1000 / 120))));
  }
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
  N.quit = () => {
    if (N.run) {
      send({ k: 'quit' });
      N.run = null;
    }
  };
  N.done = () => {
    N.run = null;
  };
  // this page's input, for the steps up to D past the clock's (sent at once). s: the page's own sim's step — never more than lead steps
  // past it (a page held up a moment doesn't hold the partner up: its hero stands those steps; one held up longer, its partner waits);
  // ahead: more steps on top (a page put away: its hero stands a while ahead, the partner plays on)
  // (cap: never past it — a page put away goes no further than the partner's inputs and a little)
  N.commit = (inp, s, lead = 36, ahead = 0, cap = Infinity) => {
    const R = N.run;
    if (!R || R.lost) return;
    const T = Math.floor(N.tick());
    if (T < 0) return;
    for (const m of R.lock.commit(inp, Math.min(Math.min(T, s + lead) + R.D + ahead, cap)))
      send({ k: 'in', u: m.u, a: m.a });
  };
  N.isMine = () => !!(N.room && N.room.players[0] && N.room.players[0].id === N.id);
  // a room's invite link: the Telegram bot's (opens the Mini App in the room) inside Telegram, the site's elsewhere
  N.link = (code) =>
    N.tg()
      ? 'https://t.me/ZombieHorde_bot?start=r_' + code
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
})(typeof window !== 'undefined' ? window : globalThis);
