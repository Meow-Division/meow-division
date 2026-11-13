// test/rooms.test.mjs — the co-op rooms (server/rooms.mjs) on a bare HTTP server with stand-in accounts: what a hostile, a
// slow or an unlucky socket can do to the server and to the partner's run, case by case as the audit found them.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { rooms } from '../server/rooms.mjs';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js'),
  D = require('../live/data.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = [];
after(() => {
  for (const x of open) x.close();
});

// a server with only the rooms on it. accounts: token → account id; o: the rooms' options on top (the tests' short timings)
async function boot(o = {}) {
  const jobs = [],
    socks = new Set();
  const R = rooms({
    REV: SIM.REV,
    REPLAY,
    RULES,
    D,
    LEVELS: [7],
    who: (t) => (/^tok-[a-z]+$/.test(t) ? t.slice(4) + '.near' : null),
    profile: async (a, want) => {
      if (o.profileMs) await sleep(o.profileMs);
      return { nick: a.split('.')[0], ava: 0, bg: 0, rank: 1, lo: { weapon: 'pistol', meta: {}, wup: {}, ...want } };
    },
    settle: async (job) => {
      jobs.push(job);
      return { id: job.id };
    },
    ipOf: () => '127.0.0.1',
    MAX_STEPS: 3600 * 120,
    ...o,
  });
  const srv = http.createServer((req, res) => res.end());
  srv.on('upgrade', (req, s) => {
    socks.add(s);
    R.upgrade(req, s);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const x = {
    R,
    jobs,
    port: srv.address().port,
    close() {
      for (const s of socks) s.destroy();
      srv.close();
    },
  };
  open.push(x);
  return x;
}
// a page's socket: got: every message so far; wait(f): the first one f takes (null after ms)
function page(x, hello) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${x.port}/api/ws`),
      got = [];
    const p = {
      ws,
      got,
      closed: 0,
      send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
      async wait(f, ms = 3000) {
        for (const t = Date.now(); Date.now() - t < ms; await sleep(5)) {
          const m = got.find(f);
          if (m) return m;
        }
        return null;
      },
    };
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.onclose = (e) => (p.closed = e.code || 1);
    ws.onerror = rej;
    ws.onopen = () => {
      if (hello !== false)
        p.send({ k: 'hello', rev: SIM.REV, nick: 'Tester', ava: 0, bg: 0, rank: 1, rd: 1, ...hello });
      res(p);
    };
  });
}
const alive = async (x) => {
  const p = await page(x, false);
  p.send({ k: 'ping', t: 5 });
  const pong = await p.wait((m) => m.k === 'pong', 1500);
  p.ws.close();
  return !!pong && pong.t === 5;
};

test('a message built to throw closes its socket, never the server', async () => {
  const x = await boot();
  const bad = { valueOf: 1, toString: 1 }; // (+bad and String(bad) both throw)
  const hostile = [
    { k: 'ping', t: 1, r: bad },
    { k: 'ping', t: bad, j: bad },
    { k: 'over', s: bad, h: bad },
    { k: 'join', code: bad },
    { k: 'join', code: '__proto__' },
    { k: 'join', code: ['A', 'B'] },
    { k: 'make', open: bad, gun: bad, want: { meta: { hp: bad }, wup: bad }, map: bad },
    { k: 'make', gun: '__proto__', want: { meta: '__proto__', wup: [bad] } },
    { k: 'gun', gun: { length: 1 }, want: 7 },
    { k: 'sv', init: { rid: bad, seed: bad, meta: { hp: bad }, mission: bad }, log: bad, n: bad, cx: bad },
    { k: 'spec', id: bad },
    { k: 'st', s: bad, t: bad, lvl: bad, gun: bad },
    { k: 'in', u: bad, a: bad },
    { k: 'in', u: 1, a: 'x'.repeat(60000) },
    { k: 'hello', rev: bad, tok: bad, nick: bad, ava: bad },
    { k: 'map', id: bad },
    { k: bad },
    [1, 2, 3],
    'null',
    '"k"',
  ];
  for (const helloFirst of [false, true]) {
    for (const m of hostile) {
      const p = await page(x, helloFirst ? {} : false);
      if (helloFirst) await p.wait((g) => g.k === 'hi');
      p.send(m);
      p.send({ k: 'ping', t: 9 });
      // (answered, or closed for it: either way the server goes on)
      for (const t = Date.now(); Date.now() - t < 1500 && !p.closed && !p.got.some((g) => g.k === 'pong');)
        await sleep(5);
      p.ws.close();
    }
  }
  assert.equal(await alive(x), true, 'the server still answers a new socket');
  // a hostile message inside a room and a run: the partner's run is not harmed either
  const a = await page(x, { tok: 'tok-alice' }),
    b = await page(x, {});
  a.send({ k: 'make', open: false, gun: 'pistol' });
  const room = await a.wait((m) => m.k === 'room' && m.room);
  b.send({ k: 'join', code: room.room.code, gun: 'pistol' });
  await a.wait((m) => m.k === 'room' && m.room && m.room.players.length === 2);
  b.send({ k: 'ready', on: true });
  await a.wait((m) => m.k === 'room' && m.room.players[1] && m.room.players[1].ready);
  a.send({ k: 'start' });
  assert.ok(await a.wait((m) => m.k === 'go'), 'the run starts');
  for (const m of hostile) b.send(m);
  assert.ok(await a.wait((m) => m.k === 'gone' && m.i === 1), 'the hostile player is out of the run, its partner told');
  assert.equal(await alive(x), true);
});

// a socket driven by hand (masked text frames), for a page that never reads what it is sent
function rawSock(x) {
  return new Promise((res) => {
    const s = net.connect(x.port, '127.0.0.1');
    const frame = (m) => {
      const d = Buffer.from(JSON.stringify(m)),
        mask = crypto.randomBytes(4),
        h =
          d.length < 126
            ? Buffer.from([0x81, 0x80 | d.length])
            : Buffer.from([0x81, 0xfe, d.length >> 8, d.length & 255]);
      for (let i = 0; i < d.length; i++) d[i] ^= mask[i & 3];
      return Buffer.concat([h, mask, d]);
    };
    s.on('error', () => {});
    s.once('data', () => res({ s, send: (m) => s.write(frame(m)) }));
    s.write(
      'GET /api/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' +
        crypto.randomBytes(16).toString('base64') +
        '\r\nSec-WebSocket-Version: 13\r\n\r\n',
    );
  });
}
// two pages in a room, the run started and begun: [host, mate, go]
async function pair(x, ha = { tok: 'tok-alice' }, hb = { tok: 'tok-bob' }) {
  const a = await page(x, ha),
    b = await page(x, hb);
  await a.wait((m) => m.k === 'hi');
  await b.wait((m) => m.k === 'hi');
  a.send({ k: 'make', open: false, gun: 'pistol' });
  const room = await a.wait((m) => m.k === 'room' && m.room);
  b.send({ k: 'join', code: room.room.code, gun: 'pistol' });
  await a.wait((m) => m.k === 'room' && m.room && m.room.players.length === 2);
  b.send({ k: 'ready', on: true });
  await a.wait((m) => m.k === 'room' && m.room.players[1] && m.room.players[1].ready);
  a.send({ k: 'start' });
  const go = await a.wait((m) => m.k === 'go');
  await b.wait((m) => m.k === 'go');
  a.send({ k: 'loaded' });
  b.send({ k: 'loaded' });
  a.t0 = b.t0 = (await a.wait((m) => m.k === 'begin')).t0;
  await b.wait((m) => m.k === 'begin');
  return [a, b, go.run];
}

test('a spectator that does not read is sent a bounded amount; one that reads gets the whole run', async () => {
  const x = await boot();
  // a run alone, watched: its page sends 1.2 million log numbers (several megabytes as JSON)
  const t = await page(x, {}),
    first = await page(x, {});
  const tid = (await t.wait((m) => m.k === 'hi')).id;
  await first.wait((m) => m.k === 'hi');
  first.send({ k: 'spec', id: tid });
  assert.ok(await t.wait((m) => m.k === 'spec' && m.on), 'the watched page is told to send its run');
  t.send({ k: 'sv', init: { rid: 'r1', seed: 7, rs: 1, rank: 1, weapon: 'pistol' }, log: [], n: 0 });
  const piece = Array.from({ length: 8000 }, (_, i) => i % 1000);
  for (let k = 0; k < 150; k++) {
    t.send({ k: 'sv', log: piece, n: k === 149 ? 5000 : undefined, cx: k === 149 ? [[10, 'god']] : [] });
    if (k % 50 === 49) await sleep(2100); // (under the socket's message rate)
  }
  const total = 150 * 8000;
  const whole = (p) => p.got.filter((m) => m.k === 'sv' && m.log).reduce((n, m) => n + m.log.length, 0);
  for (const t0 = Date.now(); whole(first) < total && Date.now() - t0 < 8000;) await sleep(20);
  assert.equal(whole(first), total, 'the spectator there from the start has the whole log');
  // a late spectator that reads: all of it, in pieces, the steps and the cheats only with the last piece
  const late = await page(x, {});
  await late.wait((m) => m.k === 'hi');
  late.send({ k: 'spec', id: tid });
  for (const t0 = Date.now(); whole(late) < total && Date.now() - t0 < 8000;) await sleep(20);
  const parts = late.got.filter((m) => m.k === 'sv' && m.log);
  assert.equal(whole(late), total);
  assert.ok(parts.length >= 50 && parts.every((m) => m.log.length <= 20000), `sent in pieces (${parts.length})`);
  assert.deepEqual(
    parts.filter((m) => m.n !== undefined).map((m) => [m.n, m.cx]),
    [[5000, [[10, 'god']]]],
  );
  assert.ok(parts[parts.length - 1].n === 5000, 'the steps come with the last piece');
  // one that never reads asks fifty times a second for three seconds
  const rss0 = process.memoryUsage().rss,
    told = t.got.filter((m) => m.k === 'spec').length;
  const dead = await rawSock(x);
  dead.s.pause();
  dead.send({ k: 'hello', rev: SIM.REV, nick: 'Leech' });
  await sleep(100);
  let most = 0;
  for (let k = 0; k < 150; k++) {
    dead.send({ k: 'spec', id: tid });
    await sleep(20);
    most = Math.max(most, x.R.stats().waiting);
  }
  await sleep(1200);
  most = Math.max(most, x.R.stats().waiting);
  const grown = (process.memoryUsage().rss - rss0) / 1e6;
  assert.ok(most < 3e6, `bytes waiting in the sockets stay bounded (${most})`);
  assert.ok(grown < 150, `the process did not grow by the logs it was asked for (${grown.toFixed(0)} MB)`);
  assert.ok(
    t.got.filter((m) => m.k === 'spec').length - told <= 2,
    'the watched page is not told to stop and start with every ask',
  );
  dead.s.destroy();
});

test('watching a run together: both logs as they grow, a leave, and an ask a second at most', async () => {
  const x = await boot();
  const [a, b] = await pair(x);
  const aid = a.got.find((m) => m.k === 'hi').id;
  const s = await page(x, {});
  await s.wait((m) => m.k === 'hi');
  for (let k = 0; k < 5; k++) s.send({ k: 'spec', id: aid }); // (a burst: the first and the last count)
  a.send({ k: 'in', u: 10, a: [2] });
  b.send({ k: 'in', u: 12, a: [1] });
  a.send({ k: 'in', u: 20, a: [0] });
  await sleep(300);
  const inits = () => s.got.filter((m) => m.k === 'sv' && m.init).length;
  assert.equal(inits(), 1, 'one start of the run for a burst of asks');
  const ns = () =>
    [0, 1].map((i) => Math.max(-1, ...s.got.filter((m) => m.k === 'sv' && m.i === i).map((m) => m.n ?? -1)));
  assert.deepEqual(ns(), [20, 12], 'both players inputs reach the spectator as they come');
  await sleep(900);
  assert.equal(inits(), 2, 'the burst last ask is served a second later');
  b.send({ k: 'quit' });
  assert.ok(await s.wait((m) => m.k === 'sv' && m.i === 1 && m.gone === 12), 'the leave, with its step');
  const log = s.got.filter((m) => m.k === 'sv' && m.i === 0 && m.log).slice(-2);
  assert.ok(log.length, 'the log itself');
});

// a page's inputs by the run's clock, as its timer sends them: standing still, D steps ahead; pace: of the clock's (1: as an honest
// page). Returns { u(): how far they ran, stop() }
function drive(p, pace = 1, D = 8) {
  let u = 0;
  const iv = setInterval(() => {
    const to = Math.floor((Date.now() - p.t0) * 0.12 * pace) + D;
    if (to <= u) return;
    u = to;
    p.send({ k: 'in', u, a: [0] });
  }, 16);
  return { u: () => u, stop: () => clearInterval(iv) };
}
const SHORT = { STALL_MS: 700, BEHIND: 60, LAG_MS: 600, BEGIN_MS: 50 };

test('a partner that says over and goes silent, or says it too early, cannot hold the run', async () => {
  const x = await boot({ times: SHORT });
  let [a, b] = await pair(x);
  let da = drive(a),
    db = drive(b);
  await sleep(300);
  db.stop();
  b.send({ k: 'over', s: db.u() - 8, h: 'abc' }); // (a step its inputs cover: taken, and then nothing more from it)
  await sleep(200);
  assert.equal(a.got.filter((m) => m.k === 'gone').length, 0, 'an over within its inputs is taken');
  const gone = await a.wait((m) => m.k === 'gone' && m.i === 1, 2000);
  assert.ok(gone, 'silent after its over: out of the run like any silent player');
  assert.equal(gone.at, db.u(), 'from the step its inputs ran to');
  await sleep(300);
  assert.equal(a.got.filter((m) => m.k === 'gone' && m.i === 0).length, 0, 'the one who played on stays');
  da.stop();
  a.send({ k: 'quit' });

  [a, b] = await pair(x, { tok: 'tok-carol' }, { tok: 'tok-dave' });
  da = drive(a);
  db = drive(b);
  await sleep(200);
  b.send({ k: 'over', s: db.u() + 500, h: 'abc' });
  assert.ok(await a.wait((m) => m.k === 'gone' && m.i === 1, 500), 'over past its own inputs: out at once');
  da.stop();
  db.stop();
});

test('a partner at half pace is taken out; one by the clock, or put away, is not', async () => {
  const x = await boot({ times: SHORT });
  let [a, b] = await pair(x);
  let da = drive(a),
    db = drive(b, 0.5);
  const t0 = Date.now();
  const gone = await a.wait((m) => m.k === 'gone', 5000);
  assert.ok(gone && gone.i === 1, 'the slow one is out');
  const took = Date.now() - t0;
  // (half a second behind after one second, then LAG_MS more)
  assert.ok(took > 1200 && took < 3500, `after its inputs stayed behind a while (${took} ms)`);
  await sleep(400);
  assert.equal(a.got.filter((m) => m.k === 'gone' && m.i === 0).length, 0);
  da.stop();
  db.stop();
  a.send({ k: 'quit' });

  // honest: one by the clock, one put away (its timer runs twice a second, each time half a second and more ahead)
  [a, b] = await pair(x, { tok: 'tok-carol' }, { tok: 'tok-dave' });
  da = drive(a);
  let u = 0;
  const away = setInterval(() => {
    u = Math.floor((Date.now() - b.t0) * 0.12) + 120;
    b.send({ k: 'in', u, a: [0] });
  }, 500);
  await sleep(2500);
  assert.equal(a.got.filter((m) => m.k === 'gone').length, 0, 'nobody is taken out of an honest run');
  clearInterval(away);
  da.stop();
});

test('what a page sends right behind its hello is done once the hello is answered, in order', async () => {
  const x = await boot({ profileMs: 150 }); // (an account's profile comes from its file: the hello takes a moment)
  for (const hello of [{ tok: 'tok-alice' }, {}]) {
    const p = await page(x, false);
    p.send({ k: 'hello', rev: SIM.REV, nick: 'Tester', ava: 0, bg: 0, rank: 1, rd: 1, ...hello });
    p.send({ k: 'watch', on: true });
    p.send({ k: 'make', open: true, gun: 'pistol' });
    p.send({ k: 'open', on: false });
    const room = await p.wait((m) => m.k === 'room' && m.room && m.room.open === false, 2000);
    assert.ok(room, `the room is made and then closed (${hello.tok ? 'an account' : 'a guest'})`);
    assert.deepEqual(
      p.got.filter((m) => m.k !== 'pong').map((m) => m.k),
      ['hi', 'rooms', 'room', 'room'],
    );
    assert.equal(p.got[0].acc, hello.tok ? 'alice.near' : null);
    p.ws.close();
  }
  // more than the queue holds while the hello is out: the socket is closed, the server goes on
  const p = await page(x, false);
  p.send({ k: 'hello', rev: SIM.REV, tok: 'tok-alice', nick: 'Tester' });
  for (let k = 0; k < 40; k++) p.send({ k: 'watch', on: true });
  for (const t = Date.now(); !p.closed && Date.now() - t < 2000;) await sleep(10);
  assert.ok(p.closed, 'a flood behind a hello closes the socket');
  assert.equal(await alive(x), true);
});
