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
