// server/rooms.mjs — playing together: rooms of two players over a WebSocket (/api/ws, written here: no dependencies), and the run they
// play passed between them step by step.
//
// Rooms: a player makes one, open (listed for everyone on the co-op page) or private (only its code lets one in); the second player
// comes in from the list or with the code (a link from the Telegram bot or the site carries it); each picks a gun; the one who made it
// (the host; the next player when the host leaves) starts the run. After the run both are back in the room, and the host can start
// again.
//
// The run (lockstep): both pages play the same run in their own copy of the sim (live/sim.js, the heroes in the room's order), each
// sending only its player's inputs — every message says "my inputs for the steps up to u are a" (live/replay.js pack). The server checks
// each, keeps it in that player's log (replay.js, as a run alone is kept) and passes it to the other page; a page steps the run only as
// far as it has both players' inputs. A player who leaves (closes the game, its connection drops, it sends nothing for a while) is out
// of the run from the step its inputs ran to: both pages hear that step and take its hero out there (the sim's leave). When the run is
// over on the pages (or every player is out), the server plays it again from the logs (replay-worker.mjs, playCoop) and pays each player
// with an account what its hero earned (server.mjs settle) — the page's numbers count for nothing, as with a run alone. A guest's run
// pays into the guest's own progress, on the page.
//
// Who is playing, and watching them (the balance lab, ?lab): every game page keeps a socket here (hello with pres: also a page with
// another build's rules, which can't play together until it reloads) and says what it is doing (st: in the lobby, a run, a room…).
// A page that asks (online {on}) gets the list every 2 s. A spectator (spec {id}) watches that page's runs as they are played: a run
// alone is sent by the player's page only while someone watches (spec {on} tells it; sv: the run's start, then its inputs as they grow,
// replay.js's log, and the lab's cheats with their steps), kept here and passed on to every spectator (one who comes later gets it all
// so far); a run together the server has itself (each player's log, as it keeps them). The spectator's page plays the very same run in
// its own sim from them, a moment behind.
//
// Messages (JSON, k: the kind). From a page: hello {rev, tok?, nick, ava, bg, rank, pres?, rd?} · watch {on} (the list of open rooms,
// kept up to date) · make {open, gun, want} · join {code, gun, want} · gun {gun, want} · ready {on} · kick · leave · start · in {u, a} ·
// over {s, h} · loaded (its sim is made: the run begins once every page is) · quit
// (out of the run) · ping {t, r: its last round trip ms} · st {s, t, lvl, gun, menu, lab, tg} · online {on} · spec {id: 0 stops} ·
// sv {init?, log, n, cx}. To a page: hi {id, stale?} · stale (another build: reload) · rooms {list} · room {room} · err {e} · kicked ·
// go {run} · begin {t0: the server's ms the run's step 0 is at} · in {i, u, a} · gone {i, at} · end · paid {res} · pong {t, m, mj: the
// partner's round trip and its jitter, st: the server's clock} · online {n, play, list} ·
// spec {on} · sv {init} | {i, log, n, cx?, gone?} | {wait} | {end}.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 64 * 1024,
  MAX_ROOMS = 2000,
  PER_IP = 30,
  HZ = 120; // (every game page keeps a socket: a phone network's shared address has many)
// a watched run alone kept here at most this long (log numbers); the cheats the lab's runs can take; what a page can say it is doing
const MAX_SV = 2e6,
  CHEATS = new Set(['lvl', 'time', 'god', 'boss', 'horde']),
  STATES = new Set(['lobby', 'run', 'room', 'watch', 'coop', 'base']);
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// a player who sends no input for this long while the other waits is out of the run; a socket silent this long is closed; a page's
// inputs may run at most this far ahead of the time since the run began (no speeding up)
const STALL_MS = 15e3,
  IDLE_MS = 70e3,
  AHEAD = 30 * HZ,
  LOAD_MS = 20e3,
  BEGIN_MS = 600; // (LOAD_MS: the longest a run waits for a page to make its sim; BEGIN_MS: the begin's lead, it reaches every page first)

export function rooms(o) {
  const {
    REV,
    REPLAY,
    RULES,
    D,
    LEVELS,
    LAB_LEVELS = LEVELS,
    MISSIONS = {},
    who,
    profile,
    settle,
    ipOf,
    MAX_STEPS,
  } = o;
  const conns = new Set(),
    rooms = new Map(),
    perIp = new Map();
  let nid = 1,
    listDirty = false;

  // ---------------------------------------------------------------- the socket (RFC 6455: text frames, ping/pong, close)
  function upgrade(req, socket) {
    const key = req.headers['sec-websocket-key'],
      ip = ipOf(req);
    if (
      !key ||
      String(req.headers.upgrade || '').toLowerCase() !== 'websocket' ||
      +req.headers['sec-websocket-version'] !== 13
    ) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    if ((perIp.get(ip) || 0) >= PER_IP) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        crypto
          .createHash('sha1')
          .update(key + GUID)
          .digest('base64') +
        '\r\n\r\n',
    );
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 20e3);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const c = {
      id: nid++,
      socket,
      ip,
      last: Date.now(),
      alive: true,
      hello: false,
      acc: null,
      me: null,
      room: null,
      gun: 'pistol',
      want: null,
      rtt: 0,
      watch: false,
      bucket: 0,
      bt: Date.now(),
      stale: false,
      st: null,
      onl: false,
      specs: null,
      specOf: null,
      specRun: null,
      sv: null,
      ready: false,
      rd: false,
    }; // (ready: the guest pressed Ready; rd: its page has the button)
    conns.add(c);
    let buf = Buffer.alloc(0),
      frag = null,
      closed = false;
    const frame = (op, data) => {
      if (closed) return;
      const n = data.length,
        h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
      if (!h) {
        const b = Buffer.alloc(10);
        b[0] = 0x80 | op;
        b[1] = 127;
        b.writeUInt32BE(0, 2);
        b.writeUInt32BE(n, 6);
        socket.write(Buffer.concat([b, data]));
      } else socket.write(Buffer.concat([h, data]));
    };
    c.send = (m) => {
      try {
        frame(1, Buffer.from(JSON.stringify(m)));
      } catch (e) {}
    };
    c.close = (code = 1000) => {
      if (closed) return;
      try {
        frame(8, Buffer.from([code >> 8, code & 255]));
      } catch (e) {}
      closed = true;
      socket.end();
      setTimeout(() => socket.destroy(), 2000).unref();
    };
    const drop = () => {
      if (c.gone) return;
      c.gone = true;
      closed = true;
      conns.delete(c);
      perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1));
      if (!perIp.get(ip)) perIp.delete(ip);
      leaveRoom(c, 'drop');
      unspec(c);
      if (c.specs) {
        for (const s of c.specs) {
          s.specOf = null;
          s.send({ k: 'sv', end: 'gone' });
        }
        c.specs = null;
        c.sv = null;
      }
    };
    socket.on('close', drop);
    socket.on('error', drop);
    socket.on('end', drop);
    socket.on('data', (d) => {
      c.last = Date.now();
      c.alive = true;
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      for (;;) {
        if (buf.length < 2) break;
        const b0 = buf[0],
          b1 = buf[1],
          fin = b0 & 0x80,
          op = b0 & 0x0f;
        let len = b1 & 0x7f,
          off = 2;
        if (!(b1 & 0x80)) return c.close(1002); // a page's frames are masked
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          if (buf.readUInt32BE(2)) return c.close(1009);
          len = buf.readUInt32BE(6);
          off = 10;
        }
        if (len > MAX_FRAME) return c.close(1009);
        if (buf.length < off + 4 + len) break;
        const mask = buf.subarray(off, off + 4),
          data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(off + 4 + len);
        if (op === 8) {
          c.close(1000);
          return;
        }
        if (op === 9) {
          frame(10, data);
          continue;
        }
        if (op === 10) continue;
        if (op === 1 || op === 2) {
          if (fin) message(c, data);
          else frag = [data];
        } else if (op === 0 && frag) {
          frag.push(data);
          if (Buffer.concat(frag).length > MAX_FRAME) return c.close(1009);
          if (fin) {
            const m = Buffer.concat(frag);
            frag = null;
            message(c, m);
          }
        }
      }
    });
  }
  // every 15 s: a ping to every socket; one silent since the last round is closed. Every 2 s: players stalled in a run are taken out
  setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      if (now - c.last > IDLE_MS) {
        c.close(1001);
        c.socket.destroy();
        continue;
      }
      try {
        c.socket.write(Buffer.from([0x89, 0]));
      } catch (e) {}
    }
  }, 15e3).unref();
  setInterval(() => {
    const now = Date.now();
    for (const R of rooms.values()) {
      const run = R.run;
      if (!run) continue;
      if (!run.begun) continue; // (before the begin: LOAD_MS)
      // the player the others wait for — its inputs reach the least far — out when silent STALL_MS; the ones waiting on it went quiet
      // only because their sims stand (a page's inputs follow its sim), so they stay and play on
      let w = -1;
      run.ps.forEach((P, i) => {
        if (!P.gone && !P.over && (w < 0 || P.u < run.ps[w].u)) w = i;
      });
      if (w >= 0 && now - run.ps[w].last > STALL_MS) out(run, w);
    }
    if (listDirty) {
      listDirty = false;
      const L = list();
      for (const c of conns) if (c.watch && !c.room) c.send({ k: 'rooms', list: L });
    }
    let M = null;
    for (const c of conns) if (c.onl) c.send(M || (M = online()));
  }, 2000).unref();

  // ---------------------------------------------------------------- messages
  function message(c, data) {
    const now = Date.now();
    if (now - c.bt > 2000) {
      c.bt = now;
      c.bucket = 0;
    }
    if (++c.bucket > 600) return c.close(1008); // (inputs: ~60 a second)
    let m;
    try {
      m = JSON.parse(data.toString('utf8'));
    } catch (e) {
      return c.close(1007);
    }
    if (!m || typeof m !== 'object' || typeof m.k !== 'string') return;
    if (m.k === 'in') return input(c, m);
    if (m.k === 'ping') {
      c.rtt = Math.max(0, Math.min(5000, +m.r || 0));
      c.jit = Math.max(0, Math.min(2000, +m.j || 0));
      const mate = c.room && c.room.players.find((x) => x !== c);
      c.send({ k: 'pong', t: m.t, m: mate ? mate.rtt : 0, mj: mate ? mate.jit || 0 : 0, st: Date.now() });
      return;
    }
    if (m.k === 'loaded') {
      const run = c.room && c.room.run,
        i = run ? run.ps.findIndex((P) => P.c === c) : -1;
      if (i >= 0 && !run.begun) {
        run.loaded.add(i);
        ready(run);
      }
      return;
    }
    if (m.k === 'hello') return hello(c, m);
    if (!c.hello) return;
    if (m.k === 'st') {
      c.st = {
        s: STATES.has(m.s) ? m.s : 'lobby',
        t: int(m.t, 0, 36000),
        lvl: int(m.lvl, 0, 999),
        gun: RULES.usable(m.gun) ? m.gun : '',
        menu: !!m.menu,
        lab: !!m.lab,
        tg: !!m.tg,
      };
      return;
    }
    if (m.k === 'online') {
      c.onl = !!m.on;
      if (c.onl) c.send(online());
      return;
    }
    if (m.k === 'spec') return spec(c, Number.isInteger(m.id) ? m.id : 0);
    if (m.k === 'sv') return sv(c, m);
    if (c.stale) {
      c.send({ k: 'stale' });
      c.close(1000);
      return;
    } // (playing together on another build's rules: the page reloads first)
    if (m.k === 'watch') {
      c.watch = !!m.on;
      if (c.watch) c.send({ k: 'rooms', list: list() });
      return;
    }
    if (m.k === 'make') return make(c, m);
    if (m.k === 'join') return join(c, m);
    if (m.k === 'gun') {
      pick(c, m);
      if (c.room) roomSend(c.room);
      return;
    }
    if (m.k === 'ready') {
      const R = c.room;
      if (!R || R.state !== 'lobby' || R.players[0] === c) return;
      c.ready = !!m.on;
      roomSend(R);
      return;
    }
    if (m.k === 'leave') {
      leaveRoom(c, 'leave');
      c.send({ k: 'room', room: null });
      return;
    }
    if (m.k === 'kick') {
      const R = c.room;
      if (!R || R.players[0] !== c || R.state !== 'lobby') return;
      const g = R.players[1];
      if (g) {
        leaveRoom(g, 'kick');
        g.send({ k: 'kicked' });
      }
      return;
    }
    if (m.k === 'open') {
      const R = c.room;
      if (!R || R.players[0] !== c) return;
      R.open = !!m.on;
      roomSend(R);
      listDirty = true;
      return;
    }
    if (m.k === 'map') {
      const R = c.room;
      if (!R || R.players[0] !== c || R.state !== 'lobby') return;
      R.map = mapId(m.id);
      roomSend(R);
      return;
    } // (the host picks where they go)
    if (m.k === 'start') return start(c);
    if (m.k === 'over') {
      const R = c.room,
        run = R && R.run,
        i = run ? run.ps.findIndex((P) => P.c === c) : -1;
      if (i < 0) return;
      const P = run.ps[i];
      P.over = { s: +m.s | 0, h: String(m.h || '').slice(0, 16) };
      const other = run.ps.find((Q) => Q !== P && Q.over);
      if (other && other.over.s === P.over.s && other.over.h !== P.over.h)
        console.warn(
          `coop run ${run.id}: the pages ended in different states (${other.over.h} vs ${P.over.h} at step ${P.over.s})`,
        );
      check(run);
      return;
    }
    if (m.k === 'quit') {
      const R = c.room,
        run = R && R.run,
        i = run ? run.ps.findIndex((P) => P.c === c) : -1;
      if (i >= 0) out(run, i);
      return;
    }
  }
  async function hello(c, m) {
    if (m.rev !== REV) {
      if (!m.pres) {
        c.send({ k: 'stale' });
        c.close(1000);
        return;
      }
      c.stale = true;
    } // (a page that is only there: kept, counted, not playing together)
    const acc = typeof m.tok === 'string' ? who(m.tok) : null;
    let me = {
      nick: RULES.nick(m.nick) || 'Guest',
      ava: int(m.ava, 0, D.AVATARS.length - 1),
      bg: int(m.bg, 0, D.AVATAR_BG.length - 1),
      rank: int(m.rank, 1, 99) || 1,
    };
    if (acc) {
      try {
        const p = await profile(acc, null);
        me = { nick: p.nick || me.nick, ava: p.ava ?? me.ava, bg: p.bg ?? me.bg, rank: p.rank };
      } catch (e) {
        console.error('coop profile', e);
      }
    }
    c.acc = acc;
    c.me = me;
    c.hello = true;
    c.rd = !!m.rd;
    c.send({ k: 'hi', id: c.id, acc: acc || null, me, stale: c.stale || undefined });
  }
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : lo);
  // a player's gun and loadout as the page says: an account's is checked against its save when the run starts; one with no
  // account can't be checked (its progress is its page's), so it plays together with the starting loadout — the pistol, no
  // upgrades — or a page could hand its partner's account a run won by a hero it made up
  const START = () => ({ weapon: 'pistol', ...levels({}) });
  function pick(c, m) {
    c.gun = c.acc && RULES.usable(m.gun) ? m.gun : 'pistol';
    c.want = c.acc ? { weapon: c.gun, ...levels(m.want) } : START();
  }
  const levels = (w) => {
    w = w && typeof w === 'object' ? w : {};
    const meta = {},
      wup = {};
    for (const k in D.META) meta[k] = Math.max(0, Math.min(D.META[k].max, Math.floor(+(w.meta || {})[k] || 0)));
    for (const k in D.WEAPON_UP)
      wup[k] = Math.max(0, Math.min(D.WEAPON_UP[k].price.length, Math.floor(+(w.wup || {})[k] || 0)));
    return { meta, wup };
  };
  const code = () => {
    for (;;) {
      let s = '';
      for (let i = 0; i < 5; i++) s += CODE_ABC[crypto.randomInt(CODE_ABC.length)];
      if (!rooms.has(s)) return s;
    }
  };
  // (ready: the host always; a guest once it pressed Ready — or at once when its page is from before the button: it can't press it)
  const mapId = (id) => (id === 'lab' ? 'lab' : 'suburb');
  const view = (R) => ({
    code: R.code,
    open: R.open,
    state: R.state,
    map: R.map || 'suburb',
    players: R.players.map((c, i) => ({
      id: c.id,
      ...c.me,
      gun: c.gun,
      acc: !!c.acc,
      ready: i === 0 || !c.rd || c.ready,
    })),
  });
  const roomSend = (R) => {
    const v = view(R);
    for (const c of R.players) c.send({ k: 'room', room: v });
  };
  const list = () =>
    [...rooms.values()]
      .filter((R) => R.open && R.state === 'lobby' && R.players.length === 1)
      .sort((a, b) => b.t - a.t)
      .slice(0, 50)
      .map((R) => {
        const h = R.players[0];
        return {
          code: R.code,
          nick: h.me.nick,
          ava: h.me.ava,
          bg: h.me.bg,
          rank: h.me.rank,
          gun: h.gun,
          n: R.players.length,
        };
      });
  function make(c, m) {
    if (c.room) leaveRoom(c, 'leave');
    if (rooms.size >= MAX_ROOMS) return c.send({ k: 'err', e: 'busy' });
    pick(c, m);
    c.ready = false;
    const R = {
      code: code(),
      open: !!m.open,
      map: mapId(m.map),
      state: 'lobby',
      players: [c],
      run: null,
      t: Date.now(),
    };
    rooms.set(R.code, R);
    c.room = R;
    roomSend(R);
    listDirty = true;
  }
  function join(c, m) {
    const R = rooms.get(
      String(m.code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8),
    );
    if (!R) return c.send({ k: 'err', e: 'none' });
    if (R.players.includes(c)) return roomSend(R);
    if (R.state !== 'lobby') return c.send({ k: 'err', e: 'started' });
    if (R.players.length >= 2) return c.send({ k: 'err', e: 'full' });
    if (c.room) leaveRoom(c, 'leave');
    pick(c, m);
    c.ready = false;
    R.players.push(c);
    c.room = R;
    roomSend(R);
    listDirty = true;
  }
  function leaveRoom(c, why) {
    const R = c.room;
    if (!R) return;
    c.room = null;
    if (R.run) {
      const i = R.run.ps.findIndex((P) => P.c === c);
      if (i >= 0) out(R.run, i);
    }
    R.players = R.players.filter((x) => x !== c);
    if (!R.players.length) {
      if (!R.run) rooms.delete(R.code);
      else R.dead = true;
    } else roomSend(R);
    listDirty = true;
  }

  // ---------------------------------------------------------------- the run
  async function start(c) {
    const R = c.room;
    if (!R || R.players[0] !== c || R.state !== 'lobby' || R.players.length < 2 || R.starting) return;
    if (R.players.some((p, i) => i > 0 && p.rd && !p.ready)) return c.send({ k: 'err', e: 'notready' }); // (the partner hasn't pressed Ready)
    R.starting = true;
    try {
      const ps = R.players.slice();
      // the loadouts: an account's from its save (never above what it owns: server.mjs loadout), a player's with no account
      // the starting one (pick); an account's save out of reach: the starting one too
      const heroes = await Promise.all(
        ps.map(async (p) => {
          if (p.acc) {
            try {
              return (await profile(p.acc, p.want)).lo;
            } catch (e) {
              console.error('coop loadout', e);
            }
          }
          return START();
        }),
      );
      if (R.players.length < 2 || R.players.some((p, i) => p !== ps[i])) return; // (someone left meanwhile)
      const lv = R.map === 'lab' ? LAB_LEVELS : LEVELS;
      const run = {
        id: crypto.randomBytes(12).toString('base64url'),
        t0: Date.now(),
        seed: lv[crypto.randomInt(lv.length)],
        rs: crypto.randomInt(-0x80000000, 0x7fffffff),
        rank: ps[0].me.rank,
        heroes,
        room: R,
        done: false,
        ps: ps.map((p) => ({ c: p, acc: p.acc, rec: REPLAY.rec(), u: 0, last: Date.now(), gone: false, over: null })),
      };
      run.loaded = new Set();
      run.begun = false;
      run.lt = setTimeout(() => begin(run), LOAD_MS);
      run.lt.unref(); // (the begin: once every page made its sim)
      R.run = run;
      R.state = 'play';
      listDirty = true;
      const names = (run.names = ps.map((p) => ({
        nick: p.me.nick,
        ava: p.me.ava,
        bg: p.me.bg,
        rank: p.me.rank,
        acc: !!p.acc,
      })));
      ps.forEach((p, i) =>
        p.send({
          k: 'go',
          run: { id: run.id, seed: run.seed, rs: run.rs, rank: run.rank, heroes, names, me: i, rev: REV },
        }),
      );
      roomSend(R);
      ps.forEach((p, i) => {
        if (p.specs) for (const s of [...p.specs]) specRun(s, run, i);
      }); // (its spectators: on to the run together)
    } finally {
      R.starting = false;
    }
  }
  // the run begins once every page still in it has made its sim (or LOAD_MS went by): all of them at the same moment of the server's
  // clock, t0 — each page steps by it (net.js tick), so neither one runs on the edge of the other's inputs
  function ready(run) {
    if (!run.begun && run.ps.every((P, i) => P.gone || run.loaded.has(i))) begin(run);
  }
  function begin(run) {
    if (run.begun || run.done) return;
    run.begun = true;
    clearTimeout(run.lt);
    const t0 = (run.tb = Date.now() + BEGIN_MS);
    for (const P of run.ps) {
      P.last = t0;
      if (!P.gone) P.c.send({ k: 'begin', t0 });
    }
  }
  // a page's inputs: for its steps from where they were up to u (one step for a pick), checked, kept, passed on
  function input(c, m) {
    const R = c.room,
      run = R && R.run;
    if (!run || run.done) return;
    const i = run.ps.findIndex((P) => P.c === c);
    if (i < 0) return;
    const P = run.ps[i];
    if (P.gone) return;
    const u = m.u,
      inp = REPLAY.in(m.a);
    if (
      !inp ||
      !Number.isInteger(u) ||
      u <= P.u ||
      u - P.u > 20 * HZ ||
      (inp.pick !== null && u - P.u !== 1) ||
      u > MAX_STEPS
    ) {
      console.warn(
        `coop run ${run.id}: a bad input from player ${i}`,
        JSON.stringify({ u, Pu: P.u, a: m.a, inp: inp && inp.pick }),
      );
      return out(run, i);
    }
    if (u > ((Date.now() - run.t0) / 1000) * HZ + AHEAD) {
      console.warn(`coop run ${run.id}: player ${i} ahead of time`);
      return out(run, i);
    }
    const L0 = P.rec.log.length;
    for (let s = P.u; s < u; s++) REPLAY.push(P.rec, inp);
    P.u = u;
    P.last = Date.now();
    for (const Q of run.ps) if (Q !== P && !Q.gone) Q.c.send({ k: 'in', i, u, a: m.a });
    if (run.specs && run.specs.size) {
      const d = { k: 'sv', i, log: P.rec.log.slice(L0), n: u };
      for (const s of run.specs) s.send(d);
    }
  }
  // a player out of the run: from the step its inputs ran to; the others hear it (their pages take its hero out there)
  function out(run, i) {
    const P = run.ps[i];
    if (P.gone || run.done) return;
    P.gone = true;
    P.at = P.u;
    for (const Q of run.ps) if (!Q.gone) Q.c.send({ k: 'gone', i, at: P.at });
    if (P.c && !P.c.gone) P.c.send({ k: 'gone', i, at: P.at }); // (its own page: it is out)
    if (!run.begun) ready(run);
    if (run.specs) for (const s of run.specs) s.send({ k: 'sv', i, gone: P.at });
    check(run);
  }
  // over on every page still in it (or nobody left): the room back to its lobby, and each account paid what its hero earned
  function check(run) {
    if (run.done || !run.ps.every((P) => P.gone || P.over)) return;
    run.done = true;
    const R = run.room;
    R.run = null;
    R.state = 'lobby';
    listDirty = true;
    for (const p of R.players) p.ready = false; // (the next run: Ready again)
    if (R.dead || !R.players.length) rooms.delete(R.code);
    else roomSend(R);
    for (const P of run.ps) if (!P.gone) P.c.send({ k: 'end' });
    // (its spectators: back to watching the page each watched)
    if (run.specs) {
      for (const s of [...run.specs]) {
        s.specRun = null;
        s.send({ k: 'sv', end: 'done' });
        const T = s.specOf;
        s.specOf = null;
        if (T && !T.gone) spec(s, T.id);
      }
      run.specs = null;
    }
    const live = run.ps.filter((P) => !P.gone),
      ns = run.ps.map((P) => P.u),
      n = live.length ? Math.min(...live.map((P) => P.u)) : Math.max(...ns);
    if (n <= 0) return;
    const logs = run.ps.map((P) => P.rec.log);
    run.ps.forEach((P, i) => {
      if (!P.acc) return;
      const job = {
        id: run.id + '-' + i,
        account: P.acc,
        ticket: {
          seed: run.seed,
          rs: run.rs,
          rank: run.rank,
          rev: REV,
          t0: run.t0,
          heroes: run.heroes,
          hero: i,
          coop: 1,
        },
        logs,
        ns,
        n,
        hash: P.over ? P.over.h : '',
        at: Date.now(),
      };
      settle(job).then(
        (res) => {
          for (const c of conns) if (c.acc === P.acc) c.send({ k: 'paid', res });
        },
        (e) => console.error('coop settle', job.id, e),
      );
    });
  }

  // ---------------------------------------------------------------- who is playing, and watching them
  // the list (every page with a hello): what each is doing — a room and a run together as the server knows them, the rest as the page says
  function online() {
    const all = [...conns].filter((c) => c.hello),
      list = all.slice(0, 200).map((c) => {
        const run = c.room && c.room.run,
          i = run ? run.ps.findIndex((P) => P.c === c) : -1,
          P = i >= 0 ? run.ps[i] : null,
          st = c.st || { s: 'lobby', t: 0, lvl: 0, gun: '' };
        const s = P && !P.gone ? 'coop' : c.room ? 'room' : st.s === 'coop' ? 'lobby' : st.s;
        return {
          id: c.id,
          nick: c.me.nick,
          ava: c.me.ava,
          bg: c.me.bg,
          rank: c.me.rank,
          acc: !!c.acc,
          s,
          t: P ? Math.floor(P.u / HZ) : st.t,
          lvl: st.lvl,
          gun: P ? run.heroes[i].weapon : st.gun,
          menu: st.menu,
          lab: st.lab,
          tg: st.tg,
          old: c.stale,
          specs: (c.specs ? c.specs.size : 0) + (run && run.specs ? run.specs.size : 0),
        };
      });
    return { k: 'online', n: all.length, play: list.filter((x) => x.s === 'run' || x.s === 'coop').length, list };
  }
  // a spectator stops watching (it watches one page at a time)
  function unspec(c) {
    const T = c.specOf;
    c.specOf = null;
    if (c.specRun) {
      if (c.specRun.specs) c.specRun.specs.delete(c);
      c.specRun = null;
    }
    if (T && T.specs) {
      T.specs.delete(c);
      if (!T.specs.size) {
        T.specs = null;
        T.sv = null;
        T.send({ k: 'spec', on: false });
      }
    }
  }
  // watching page id: its run together (the server has it), or its runs alone (its page sends them while it is watched: wait till then)
  function spec(c, id) {
    unspec(c);
    if (!id) return;
    const T = [...conns].find((x) => x.id === id && x.hello);
    if (!T || T === c) return c.send({ k: 'sv', end: 'none' });
    c.specOf = T;
    const run = T.room && T.room.run;
    if (run && !run.done)
      return specRun(
        c,
        run,
        run.ps.findIndex((P) => P.c === T),
      );
    if (!T.specs) {
      T.specs = new Set();
      T.sv = null;
    }
    T.specs.add(c);
    if (T.sv) {
      c.send({ k: 'sv', init: T.sv.init });
      c.send({ k: 'sv', i: 0, log: T.sv.log, n: T.sv.n, cx: T.sv.cx });
    } else c.send({ k: 'sv', wait: 1 });
    if (T.specs.size === 1) T.send({ k: 'spec', on: true });
  }
  function specRun(c, run, i) {
    const T = c.specOf;
    if (T && T.specs) {
      T.specs.delete(c);
      if (!T.specs.size) {
        T.specs = null;
        T.sv = null;
        T.send({ k: 'spec', on: false });
      }
    }
    (run.specs || (run.specs = new Set())).add(c);
    c.specRun = run;
    c.send({
      k: 'sv',
      init: {
        rid: run.id,
        coop: 1,
        seed: run.seed,
        rs: run.rs,
        rank: run.rank,
        heroes: run.heroes,
        names: run.names,
        me: Math.max(0, i),
      },
    });
    run.ps.forEach((P, j) => c.send({ k: 'sv', i: j, log: P.rec.log, n: P.u, gone: P.gone ? P.at : -1 }));
  }
  // a watched page's run alone: its start (init: what its sim was made with), then its log as it grows, passed on to the spectators
  function sv(c, m) {
    if (!c.specs || !c.specs.size) return;
    if (m.init && typeof m.init === 'object') {
      const x = m.init;
      c.sv = {
        init: {
          rid: String(x.rid || '').slice(0, 24),
          coop: 0,
          seed: int(x.seed, 0, 1e6),
          rs: Number.isInteger(x.rs) ? x.rs | 0 : 0,
          rank: int(x.rank, 1, 99),
          weapon: RULES.usable(x.weapon) ? x.weapon : 'pistol',
          ...levels(x),
          // (a campaign mission's run: the spectators' sim plays its script too, or it would not follow the run)
          ...(typeof x.mission === 'string' && Object.prototype.hasOwnProperty.call(MISSIONS, x.mission)
            ? { mission: x.mission }
            : {}),
          names: [{ nick: c.me.nick, ava: c.me.ava, bg: c.me.bg, rank: c.me.rank, acc: !!c.acc }],
          me: 0,
        },
        log: [],
        n: 0,
        cx: [],
      };
      for (const s of c.specs) s.send({ k: 'sv', init: c.sv.init });
    }
    const S = c.sv;
    if (!S) return;
    const part = Array.isArray(m.log) && m.log.length <= 8000 && m.log.every(Number.isInteger) ? m.log : [];
    const n = Number.isInteger(m.n) && m.n >= S.n && m.n <= MAX_STEPS ? m.n : S.n;
    const cx = Array.isArray(m.cx)
      ? m.cx
          .slice(0, 50)
          .filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && CHEATS.has(e[1]))
          .map((e) => [e[0], e[1]])
      : [];
    if (S.log.length + part.length > MAX_SV) {
      for (const s of c.specs) s.send({ k: 'sv', end: 'big' });
      c.sv = null;
      return;
    }
    for (const v of part) S.log.push(v);
    S.n = n;
    for (const e of cx) S.cx.push(e);
    const d = { k: 'sv', i: 0, log: part, n, cx };
    for (const s of c.specs) s.send(d);
  }
  return {
    upgrade,
    stats: () => ({ conns: conns.size, rooms: rooms.size, runs: [...rooms.values()].filter((R) => R.run).length }),
  };
}
