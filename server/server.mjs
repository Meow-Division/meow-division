// server/server.mjs — the game's server: serves the game and keeps every player's progress under their NEAR account. Node 18+, no
// dependencies.   node server/server.mjs [--port 8930]   then open http://127.0.0.1:8930/ (→ /live/index.html)
//
// Who: a NEAR account (mainnet), proven once per login. POST /api/challenge gives a one-time nonce, the wallet signs {message, nonce,
// recipient} (NEP-413: free, no transaction), POST /api/login checks the signature and that the key is a full-access key of the account
// (RPC view_access_key) and returns a session token (HMAC-signed, 30 days). An account seen for the first time starts from a fresh save.
//
// What: the page never writes the progress, it asks (with the token):
//   GET  /api/save                        the account's progress
//   POST /api/act {a}                     one purchase or choice (live/rules.js act: the price, the rank, the mastery are checked here;
//                                         a trade with Walt against his shelf here, server/walt.mjs)
//   GET  /api/walt                        Walt's shelf (no sign-in: guests see the same prices)
//   POST /api/run/start {rev, map, mission}  a ticket for a run: its seeds, the account's survivor rank now, the
//                                         campaign mission it plays if it is the account's current one (one use;
//                                         409 stale to a page whose rules, sim.js REV, are not the server's)
//   POST /api/run/end {id, n, z | log}    the run's inputs, step by step (live/replay.js); a worker plays the run again in the server's
//                                         own copy of the sim and the account is paid what that replay earned (rules.js bank)
//   GET  /api/run/<id>                    the run's result once played (waits up to 25 s for it)
// So coins, rank XP, mastery and upgrades come only from purchases the rules allow and from runs as their inputs play out: an edited
// page, save or request adds nothing. A run's ticket is good once; a run can't hold more steps than the time since its ticket allows (no
// speed-up); runs of one account can't overlap in time (no bots in parallel). The NEAR side: GET /api/health.
// Environment: PORT, HOST (default 127.0.0.1; 0.0.0.0 to serve a network), DATA_DIR (default server/data: accounts, queued replays, the
// token secret), NEAR_RPC (comma-separated mainnet RPC URLs, tried in order), ALLOWED_ORIGINS (comma-separated, for a page on another
// origin), GAME_DIR (default live/: what /live/ serves; a packed build's folder in production), REPLAY_WORKERS (default: the cores but
// one, at most 4), TRUST_PROXY (1: the player's address from X-Forwarded-For, behind nginx or Caddy).
// --editor (a local copy only, map-editor.bat): POST /api/editor/map {map, id} writes live/map.js, live/map_lab.js for
// id 'lab' or live/map_base.js for id 'base' (server/mapfile.mjs checks and formats it); GET and POST
// /api/editor/economy read and write the economy page's tables
// (econ-editor.bat, live/econ.html; server/econfile.mjs).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { rooms } from './rooms.mjs';
import { makeWalt } from './walt.mjs';

const require = createRequire(import.meta.url);
const RULES = require('../live/rules.js'),
  REPLAY = require('../live/replay.js'),
  MISSIONS = require('../live/missions.js'),
  ECONOMY = require('../live/economy.js'),
  REV = require('../live/sim.js').REV;
const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ROOT = path.resolve(HERE, '..');
const arg = (n) => {
  const i = process.argv.indexOf('--' + n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PORT = +(arg('port') || process.env.PORT || 8930),
  HOST = arg('host') || process.env.HOST || '127.0.0.1';
const DATA = path.resolve(process.env.DATA_DIR || path.join(HERE, 'data')),
  GAME = path.resolve(process.env.GAME_DIR || path.join(ROOT, 'live'));
const WALT = makeWalt(DATA, ECONOMY); // (Walt's shelf: one for every player, server/walt.mjs)
const RPCS = (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com,https://rpc.mainnet.near.org')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const WORKERS = Math.max(1, +process.env.REPLAY_WORKERS || Math.min(4, Math.max(1, os.cpus().length - 1)));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const EDITOR = process.argv.includes('--editor');
export const RECIPIENT = 'zombie-horde',
  MESSAGE = 'Zombie Horde: sign in to keep your progress under this account';
const TOKEN_DAYS = 30,
  NONCE_TTL = 10 * 60e3,
  MAX_BODY = 64 * 1024,
  MAX_RUN_BODY = 8 << 20,
  MAX_LOG = 48 << 20;
// runs: the sim's rate, the longest run taken (pauses on the level-up cards included), how long a ticket keeps, how many a player may
// hold at once (a run sent late while the next one plays), the results kept, the levels the server deals (the maps the game was tuned
// on), the slack of the time checks
const HZ = 120,
  MAX_STEPS = 3600 * HZ,
  TICKET_TTL = 6 * 3600e3,
  OPEN_MAX = 3,
  RECENT_MAX = 30,
  LEVELS = [7, 8, 9, 10, 11],
  LAB_LEVELS = [101, 102, 103, 104, 105],
  OFFICE_LEVELS = [800], // (the office's one level, SIM.OFFICE: mission 1)
  SLACK = 10e3; // (the lab's: from SIM.LAB0 up)
const REPLAY_TIMEOUT = 15 * 60e3;

for (const d of ['accounts', 'jobs']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
// this build's rules kept (DATA/sims/<REV>: the sim and what it reads, copied at every start): a run dealt under them and sent after
// the next deploy is played again by them (replay-worker.mjs), not by the new ones it was never played with
const SIMS = path.join(DATA, 'sims'),
  // (in the order they load: the maps and the missions before sim.js)
  SIM_FILES = [
    'data.js',
    'economy.js',
    'map.js',
    'map_lab.js',
    'map_office.js',
    'map_office_in.js',
    'missions.js',
    'sim.js',
    'replay.js',
    'rules.js',
  ];
{
  const dir = path.join(SIMS, String(REV));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of SIM_FILES) {
    fs.copyFileSync(path.join(ROOT, 'live', f), path.join(dir, f + '.tmp'));
    fs.renameSync(path.join(dir, f + '.tmp'), path.join(dir, f));
  }
}
const SECRET = (() => {
  const f = path.join(DATA, 'secret'); // the key the session tokens are signed with, made once
  try {
    return fs.readFileSync(f);
  } catch {
    const s = crypto.randomBytes(32);
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
})();

// ---------------------------------------------------------------- NEAR: keys, NEP-413, the account's keys on chain
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}
export function b58encode(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')),
    s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}
const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};
const bstr = (s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(b.length), b]);
};
// NEP-413: sha256(borsh(u32 2^31 + 413) ‖ borsh({ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> }))
export function nep413Hash({ message, nonce, recipient, callbackUrl }) {
  const cb = callbackUrl == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), bstr(callbackUrl)]);
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([u32(2 ** 31 + 413), bstr(message), Buffer.from(nonce), bstr(recipient), cb]))
    .digest();
}
const edKey = (raw) =>
  crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  });
function sigBytes(s) {
  // wallets send the signature in base64 (some in base58)
  const t = String(s).replace(/^ed25519:/, '');
  try {
    const b = Buffer.from(t, 'base64');
    if (b.length === 64) return b;
  } catch {}
  const b = b58decode(t);
  if (b.length === 64) return b;
  throw new Error('bad signature');
}
export function verifySigned({ publicKey, signature, message, nonce, recipient }) {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(publicKey || '')) return false;
  const raw = b58decode(publicKey.slice(8));
  if (raw.length !== 32) return false;
  const sig = sigBytes(signature),
    key = edKey(raw);
  return crypto.verify(null, nep413Hash({ message, nonce, recipient }), key, sig);
}
async function rpc(params) {
  // the first mainnet RPC that answers
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'zh', method: 'query', params }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.result || (j.error && j.error.cause)) return j;
      last = new Error('rpc ' + r.status);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('no rpc');
}
async function isFullAccessKey(accountId, publicKey) {
  const j = await rpc({
    request_type: 'view_access_key',
    finality: 'final',
    account_id: accountId,
    public_key: publicKey,
  });
  return !!(j.result && j.result.permission === 'FullAccess');
}
export const validAccount = (a) =>
  typeof a === 'string' &&
  a.length >= 2 &&
  a.length <= 64 &&
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a);

// ---------------------------------------------------------------- sessions, nonces
const nonces = new Map(); // nonce (base64) → expiry; one use each
function token(accountId) {
  const exp = Date.now() + TOKEN_DAYS * 864e5,
    body = Buffer.from(JSON.stringify({ a: accountId, e: exp })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
const who = (req) => whoTok(String(req.headers.authorization || '').replace(/^Bearer /, ''));
function whoTok(tok) {
  const m = /^([\w-]+)\.([\w-]+)$/.exec(tok || '');
  if (!m) return null;
  const want = crypto.createHmac('sha256', SECRET).update(m[1]).digest();
  const got = Buffer.from(m[2], 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(m[1], 'base64url').toString());
    return e > Date.now() && validAccount(a) ? a : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- accounts: one file each, changed one request at a time
// { v: 2, account, t (the progress's last change), save, open: [tickets], recent: [results of runs, newest first] }
const hashA = (a) => crypto.createHash('sha256').update(a).digest('hex');
const accFile = (a) => path.join(DATA, 'accounts', hashA(a) + '.json');
async function readAcc(a) {
  try {
    const r = JSON.parse(await fsp.readFile(accFile(a), 'utf8'));
    fastFromRecent(r);
    const rec = {
      ...r,
      save: RULES.clean(r.save),
      open: Array.isArray(r.open) ? r.open : [],
      recent: Array.isArray(r.recent) ? r.recent : [],
    };
    if (RULES.fillFace(rec.save, Math.random)) rec.dirty = true; // an account from before the faces: dealt one now
    return rec;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  // the first build kept what the page sent (server/data/saves): not to be trusted, set aside, and the account starts afresh
  const old = path.join(DATA, 'saves', hashA(a) + '.json');
  try {
    await fsp.mkdir(path.join(DATA, 'legacy'), { recursive: true });
    await fsp.rename(old, path.join(DATA, 'legacy', hashA(a) + '.json'));
  } catch {}
  const save = RULES.defaults();
  RULES.fillFace(save, Math.random); // a new account: its avatar, background and name dealt here
  return { v: 2, account: a, t: Date.now(), save, open: [], recent: [], dirty: true };
}
// an account from before the record (the fastest win): its fastest win among the results kept, when there is one
function fastFromRecent(r) {
  const st = r && r.save && r.save.stats;
  if (!st || typeof st !== 'object' || 'fast' in st) return;
  const w = (Array.isArray(r.recent) ? r.recent : [])
    .filter((x) => x && x.outcome && x.outcome.win && x.outcome.t > 0)
    .map((x) => x.outcome.t);
  if (w.length) st.fast = Math.min(...w);
}
async function writeAcc(rec) {
  const f = accFile(rec.account),
    tmp = f + '.' + crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(tmp, JSON.stringify(rec));
  await fsp.rename(tmp, f);
}
// fn(rec) reads or changes the account (rec.dirty = true: written afterwards); calls for one account run one after another
const locks = new Map();
function withAcc(a, fn) {
  const p = (locks.get(a) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const rec = await readAcc(a),
        out = await fn(rec);
      if (rec.dirty) {
        delete rec.dirty;
        await writeAcc(rec);
      }
      return out;
    });
  locks.set(a, p);
  p.finally(() => {
    if (locks.get(a) === p) locks.delete(a);
  }).catch(() => {});
  return p;
}
const changed = (rec) => {
  rec.t = Math.max(Date.now(), rec.t + 1);
  rec.dirty = true;
}; // t only grows: the page tells versions apart by it

// ---------------------------------------------------------------- replays: a pool of workers (replay-worker.mjs), the queue on disk
class Pool {
  constructor(n) {
    this.idle = [];
    this.q = [];
    this.all = new Set();
    for (let i = 0; i < n; i++) this.spawn();
  }
  spawn() {
    const w = new Worker(new URL('./replay-worker.mjs', import.meta.url), {
      workerData: { sims: SIMS, files: SIM_FILES },
    });
    w.unref();
    w.it = null;
    w.born = Date.now();
    this.all.add(w);
    this.idle.push(w);
    w.on('message', (m) => {
      const it = w.it;
      if (!it) return;
      clearTimeout(it.timer);
      w.it = null;
      this.idle.push(w);
      it.res(m);
      this.pump();
    });
    w.on('error', (e) => this.drop(w, e, true));
    this.pump();
  }
  // a worker that failed or ran too long: its job fails (crash: the worker itself broke — a bad deploy, out of memory — and the job may
  // be tried again), a new worker (a while later when it broke at once: no spawn loop on a sim.js that can't load)
  drop(w, e, crash = false) {
    if (!this.all.has(w)) return;
    this.all.delete(w);
    this.idle = this.idle.filter((x) => x !== w);
    const it = w.it;
    w.it = null;
    w.terminate().catch(() => {});
    if (it) {
      clearTimeout(it.timer);
      it.res({ error: e.message, crash });
    }
    if (!this.closed) {
      if (crash && Date.now() - w.born < 2000)
        setTimeout(() => {
          if (!this.closed) this.spawn();
        }, 5000);
      else this.spawn();
    }
  }
  run(job) {
    return new Promise((res) => {
      this.q.push({ job, res });
      this.pump();
    });
  }
  pump() {
    while (this.idle.length && this.q.length) {
      const w = this.idle.pop(),
        it = this.q.shift();
      w.it = it;
      it.timer = setTimeout(() => this.drop(w, new Error('replay took too long')), REPLAY_TIMEOUT);
      w.postMessage(it.job);
    }
  }
  close() {
    this.closed = true;
    for (const w of this.all) w.terminate().catch(() => {});
    this.all.clear();
  }
}
let pool = null;
const jobs = new Map(),
  chains = new Map(); // run id → { p: the result's promise, account }; account → its last job
const jobFile = (id) => path.join(DATA, 'jobs', id + '.json');
// the loadout a run is played again with: the one the page says it played with, but never above what the account owns (a gun not
// owned: the pistol; each upgrade at most its level). No word from the page: the account's own, with its primary.
const lv = (v, hi) => (Number.isInteger(v) ? Math.max(0, Math.min(hi, v)) : 0);
function loadout(save, want) {
  if (!want || typeof want !== 'object')
    return { weapon: save.selected, meta: { ...save.meta }, wup: { ...RULES.wupOf(save, save.selected) } };
  const weapon = RULES.usable(want.weapon) && save.owned[want.weapon] ? want.weapon : 'pistol',
    meta = {},
    own = RULES.wupOf(save, weapon),
    w = want.wup || {};
  for (const k in save.meta) meta[k] = lv((want.meta || {})[k], save.meta[k]);
  const wup = {};
  for (const k in RULES.WEAPON_UP) wup[k] = lv(w[k], own[k] || 0);
  return { weapon, meta, wup };
}
// an account's runs are played again one after another (with the loadout fixed when each was sent: job.ticket)
// A worker that broke under it plays it again (three times at most); a result that can't be written into the account (a disk error)
// is tried again until it can, and the job's file is removed only once it was (else a restart picks it up again)
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function replay(job) {
  for (let i = 0; ; i++) {
    const r = await pool.run({ ticket: job.ticket, log: job.log, logs: job.logs, ns: job.ns, n: job.n });
    if (!r.crash || i >= 3) return r;
    await pause(5000 * (i + 1));
  }
}
async function settleSure(job, r) {
  for (let i = 0; ; i++) {
    try {
      return await settle(job, job.ticket, r);
    } catch (e) {
      console.error('settle', job.id, e);
      await pause(Math.min(60e3, 2000 * 2 ** i));
    }
  }
}
function enqueue(job) {
  const prev = chains.get(job.account) || Promise.resolve();
  const p = prev
    .catch(() => {})
    .then(async () => {
      const out = await settleSure(job, await replay(job));
      await fsp.rm(jobFile(job.id), { force: true }).catch(() => {});
      return out;
    })
    .finally(() => {
      jobs.delete(job.id);
      if (chains.get(job.account) === p) chains.delete(job.account);
    });
  chains.set(job.account, p);
  jobs.set(job.id, { p, account: job.account });
  p.catch((e) => console.error('replay', job.id, e));
  return p;
}
// a replay's answer into the account: what the run earned (unless it overlaps another run in time, or its log could not be played)
function settle(job, ticket, r) {
  return withAcc(job.account, (rec) => {
    const had = rec.recent.find((x) => x.id === job.id);
    if (had) return had; // (a queue resumed after a restart, already settled)
    const span = [ticket.t0, ticket.t0 + (job.n / HZ) * 1000];
    let res;
    if (r.error) res = { id: job.id, at: Date.now(), error: 'replay: ' + r.error };
    else if (rec.recent.some((x) => x.span && x.span[0] < span[1] - SLACK && span[0] < x.span[1] - SLACK))
      res = { id: job.id, at: Date.now(), error: 'overlap', outcome: r.outcome };
    else {
      res = {
        id: job.id,
        at: Date.now(),
        outcome: r.outcome,
        gain: RULES.bank(rec.save, r.outcome),
        span,
        match: r.hash === job.hash,
        ms: r.ms,
      };
      if (!res.match && job.hash)
        console.warn(
          `run ${job.id} of ${job.account}: the page's state ${job.hash} ≠ the replay's ${r.hash} (paid the replay's)`,
        );
      changed(rec);
    }
    rec.recent.unshift(res);
    rec.recent.length = Math.min(rec.recent.length, RECENT_MAX);
    rec.dirty = true;
    return res;
  });
}
// a run's log as sent: base64 of gzipped JSON (z) or the JSON array itself (log); read through once here (no sim: quick) so a broken
// one is refused at once. Asked only once the ticket stands and n fits the time since it: n bounds how big a real log can be (at most
// one entry of 7 numbers a step), so nothing larger is unpacked or parsed
const gunzip = (buf, max) =>
  new Promise((ok, no) => zlib.gunzip(buf, { maxOutputLength: max }, (e, r) => (e ? no(e) : ok(r))));
async function readLog(b) {
  const most = 7 * b.n + 8; // numbers
  let log = b.log;
  if (typeof b.z === 'string')
    log = JSON.parse((await gunzip(Buffer.from(b.z, 'base64'), Math.min(MAX_LOG, most * 12 + 64))).toString('utf8'));
  if (!Array.isArray(log) || log.length > most) throw new Error('bad log');
  REPLAY.each(log, b.n, () => {});
  return log;
}

// ---------------------------------------------------------------- a little rate limit per address (and per account)
// behind a proxy (TRUST_PROXY) the player's address is the last one X-Forwarded-For names: the one our proxy added (the ones before it
// are the client's word)
const hits = new Map();
const ipOf = (req) => {
  if (TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (xf.length) return xf[xf.length - 1];
  }
  return req.socket.remoteAddress || '?';
};
function hit(k, n) {
  const now = Date.now(),
    h = hits.get(k) || { t: now, n: 0 };
  if (now - h.t > 60e3) {
    h.t = now;
    h.n = 0;
  }
  h.n++;
  hits.set(k, h);
  return h.n > n;
}
const limited = (req, bucket, n) => hit(bucket + ' ' + ipOf(req), n);
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (now - h.t > 60e3) hits.delete(k);
  for (const [k, e] of nonces) if (e < now) nonces.delete(k);
}, 60e3).unref();

// ---------------------------------------------------------------- HTTP
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
function send(res, code, body, hdr = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body),
    data = json ? JSON.stringify(body) : body;
  res.writeHead(code, {
    'content-type': json ? 'application/json' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...hdr,
  });
  res.end(data);
}
async function body(req, max = MAX_BODY) {
  let n = 0;
  const parts = [];
  for await (const c of req) {
    n += c.length;
    if (n > max) throw Object.assign(new Error('too big'), { code: 413 });
    parts.push(c);
  }
  let b;
  try {
    b = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('bad json'), { code: 400 });
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw Object.assign(new Error('bad request'), { code: 400 });
  return b;
}
const pendingOf = (a) => [...jobs].filter(([, j]) => j.account === a).map(([id]) => id);
// the players' ranking (public): every account with a run played, by rank, then by its record (the fastest win; none: after); read from the account files,
// kept for a while (one read of them all per BOARD_TTL, whoever asks)
const BOARD_TTL = 20e3,
  BOARD_MAX = 100;
let board = null;
function leaderboard() {
  if (board && board.until > Date.now()) return board.p;
  const p = (async () => {
    const dir = path.join(DATA, 'accounts'),
      rows = [];
    for (const f of await fsp.readdir(dir)) {
      if (!/^[0-9a-f]{64}\.json$/.test(f)) continue;
      try {
        const r = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
        fastFromRecent(r);
        const s = RULES.clean(r.save);
        if (s.stats.runs > 0 && validAccount(r.account))
          rows.push({ account: r.account, rank: RULES.rank(s), fast: s.stats.fast, kills: s.stats.kills });
      } catch {}
    }
    const fastest = (a, b) => (a.fast ? (b.fast ? a.fast - b.fast : -1) : b.fast ? 1 : 0);
    rows.sort((a, b) => b.rank - a.rank || fastest(a, b) || a.account.localeCompare(b.account));
    return { t: Date.now(), players: rows.length, top: rows.slice(0, BOARD_MAX) };
  })();
  board = { p, until: Date.now() + BOARD_TTL };
  p.catch(() => {
    board = null;
  });
  return p;
}
async function api(req, res, p) {
  const cors = {},
    origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin))
    Object.assign(cors, {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST',
      vary: 'origin',
    });
  if (req.method === 'OPTIONS') return send(res, 204, '', cors);
  const ok = (b, c = 200) => send(res, c, b, cors),
    no = (c, e, more) => send(res, c, { error: e, ...more }, cors);
  if (p === '/api/health' && req.method === 'GET')
    return ok({ ok: true, network: 'mainnet', rev: REV, recipient: RECIPIENT, v: 2 });
  if (p === '/api/walt' && req.method === 'GET') {
    if (limited(req, 'walt', 120)) return no(429, 'slow down');
    return ok(WALT.view());
  }
  if (p === '/api/leaderboard' && req.method === 'GET') {
    if (limited(req, 'board', 60)) return no(429, 'slow down');
    return ok(await leaderboard());
  }
  // what a phone's Telegram Mini App did around a turn (tg.html report: Telegram's events, the sizes, the frame's layout), appended to
  // DATA/diag.log for a look by hand when a phone shows something wrong — small lines, a few a minute an address, the file rolled at 2 MB
  if (p === '/api/diag' && req.method === 'POST') {
    if (limited(req, 'diag', 12)) return no(429, 'slow down');
    const b = await body(req, 8000),
      f = path.join(DATA, 'diag.log');
    try {
      if ((await fsp.stat(f)).size > 2 << 20) await fsp.rename(f, f + '.1');
    } catch {}
    await fsp.appendFile(f, JSON.stringify({ at: new Date().toISOString(), ...b }) + '\n');
    return ok({ ok: true });
  }
  if (p === '/api/challenge' && req.method === 'POST') {
    if (limited(req, 'auth', 30)) return no(429, 'slow down');
    if (nonces.size > 50000) return no(503, 'busy');
    const nonce = crypto.randomBytes(32).toString('base64');
    nonces.set(nonce, Date.now() + NONCE_TTL);
    return ok({ nonce, message: MESSAGE, recipient: RECIPIENT });
  }
  if (p === '/api/login' && req.method === 'POST') {
    if (limited(req, 'auth', 30)) return no(429, 'slow down');
    const b = await body(req),
      { accountId, publicKey, signature, nonce } = b;
    if (!validAccount(accountId)) return no(400, 'bad account');
    const exp = typeof nonce === 'string' && nonces.get(nonce);
    if (!exp || exp < Date.now()) return no(401, 'unknown or expired nonce');
    nonces.delete(nonce);
    let good = false;
    try {
      good = verifySigned({
        publicKey,
        signature,
        message: MESSAGE,
        nonce: Buffer.from(nonce, 'base64'),
        recipient: RECIPIENT,
      });
    } catch {
      good = false;
    }
    if (!good) return no(401, 'bad signature');
    let full = false;
    try {
      full = await isFullAccessKey(accountId, publicKey);
    } catch (e) {
      return no(502, 'near rpc unavailable');
    }
    if (!full) return no(401, 'the key is not a full-access key of this account');
    const acc = await withAcc(accountId, (rec) => ({ save: rec.save, t: rec.t })); // a new account: a fresh save, made here
    return ok({ token: token(accountId), accountId, ...acc });
  }
  if (EDITOR && p === '/api/editor/map' && req.method === 'POST') {
    // (id 'lab': the laboratory, live/map_lab.js; 'base': NEAR Base, live/map_base.js; 'office': the office, live/map_office.js)
    const v = (await Promise.all(['mapfile.mjs', '../live/sim.js'].map((f) => fsp.stat(path.join(HERE, f)))))
      .map((s) => Math.round(s.mtimeMs))
      .join('-'); // (changed: loaded anew)
    const F = await import('./mapfile.mjs?v=' + v),
      q = await body(req, 8 << 20),
      m = q.map,
      kind = q.id === 'lab' || q.id === 'base' || q.id === 'office' || q.id === 'office_in' ? q.id : 'city',
      [check, source, file] =
        kind === 'lab'
          ? [F.checkLab, F.labSource, 'map_lab.js']
          : kind === 'base'
            ? [F.checkBase, F.baseSource, 'map_base.js']
            : kind === 'office'
              ? [F.checkOffice, F.officeSource, 'map_office.js']
              : kind === 'office_in'
                ? [F.checkOffice, (m) => F.officeSource(m, true), 'map_office_in.js']
                : [F.checkMap, F.mapSource, 'map.js'],
      err = check(m);
    if (err) return no(400, 'bad map: ' + err);
    const f = path.join(ROOT, 'live', file);
    await fsp.writeFile(f + '.tmp', source(m));
    await fsp.rename(f + '.tmp', f);
    return ok({ ok: true });
  }
  if (EDITOR && p === '/api/editor/hero' && req.method === 'POST') {
    const { checkTune, tuneSource, dataWithMuzzles, sameAsFile, isHero, tuneFile, jsonWithMuzzles } =
        await import('./herofile.mjs'),
      q = await body(req, 4 << 20),
      t = q.tune;
    const id = q.id === undefined ? 'cat' : q.id;
    if (!isHero(id)) return no(400, 'no such character'); // (another one than the cat: the editor's ?heroid)
    const err = checkTune(t, id);
    if (err) return no(400, 'bad tune: ' + err);
    const f = tuneFile(id),
      had = await fsp.readFile(f, 'utf8').catch(() => null);
    if (had !== null && !sameAsFile(q.base, had))
      return no(409, path.basename(f) + ' changed since the editor loaded it: reload the page'); // (an old tab must not undo a newer save)
    if (id === 'cat') {
      const d = path.join(ROOT, 'live', 'data.js'),
        dt = dataWithMuzzles(await fsp.readFile(d, 'utf8'), t);
      await fsp.writeFile(d + '.tmp', dt);
      await fsp.rename(d + '.tmp', d);
    } else {
      const j = jsonWithMuzzles(id, t);
      await fsp.writeFile(j.f + '.tmp', j.text);
      await fsp.rename(j.f + '.tmp', j.f);
    } // (its muzzles stay in its own json: data.js is the game's)
    await fsp.writeFile(f + '.tmp', tuneSource(t));
    await fsp.rename(f + '.tmp', f);
    return ok({ ok: true });
  }
  if (EDITOR && p === '/api/editor/economy') {
    // (the economy page: GET its tables, POST them back; server/econfile.mjs checks and writes them)
    const ef = await import('./econfile.mjs');
    if (req.method === 'GET') return ok(ef.pageState(await ef.readEcon()));
    if (req.method === 'POST') return ok(await ef.saveEcon(await body(req, 1 << 20)));
    return no(405, 'method not allowed');
  }
  if (EDITOR && p === '/api/editor/economy/runs' && req.method === 'GET')
    return ok({ runs: await (await import('./econfile.mjs')).readRuns() }); // (the economy bots' run samples)
  if (!p.startsWith('/api/')) return no(404, 'not found');
  if (limited(req, 'api', 600)) return no(429, 'slow down');
  const a = who(req);
  if (!a) return no(401, 'sign in again');
  if (p === '/api/save' && req.method === 'GET')
    return ok(await withAcc(a, (rec) => ({ accountId: a, save: rec.save, t: rec.t, pending: pendingOf(a) })));
  if (p === '/api/save')
    return no(410, 'the progress is kept by the server: purchases go to /api/act, runs to /api/run');
  if (p === '/api/act' && req.method === 'POST') {
    const b = await body(req);
    const r = await withAcc(a, (rec) => {
      const err = RULES.act(rec.save, b.a, WALT.ctx()); // (a trade with Walt: his shelf here, the one all players share)
      if (!err) changed(rec);
      if (!err && b.a && (b.a.k === 'sell' || b.a.k === 'wbuy')) WALT.traded(b.a);
      return { err, save: rec.save, t: rec.t };
    });
    return r.err ? no(409, r.err, { save: r.save, t: r.t }) : ok({ save: r.save, t: r.t });
  }
  if (p === '/api/run/start' && req.method === 'POST') {
    const b = await body(req);
    if (b.rev !== REV) return no(409, 'stale'); // a page with other rules than these: its run would replay otherwise
    if (hit('start ' + a, 8)) return no(429, 'slow down'); // tickets can't be dealt over and over to pick the seeds
    const tk = await withAcc(a, (rec) => {
      // a campaign mission's run (live/missions.js), replayed with its script: only the account's current mission
      // (rules.js current; any other one asked for is a classic run, so a mission won before can't be played again
      // for its reward), on its own map whatever the page says. Else the map the player picked: its seeds
      const mission = typeof b.mission === 'string' && b.mission === RULES.current(rec.save) ? b.mission : null,
        map = mission ? ECONOMY.mission(mission).map : b.map,
        lv = map === 'lab' ? LAB_LEVELS : map === 'office' ? OFFICE_LEVELS : LEVELS;
      const now = Date.now(),
        tk = {
          id: crypto.randomBytes(12).toString('base64url'),
          seed: lv[crypto.randomInt(lv.length)],
          rs: crypto.randomInt(-0x80000000, 0x7fffffff),
          t0: now,
          rev: REV,
          rank: RULES.rank(rec.save),
        }; // (rank: a newcomer's run is easier — DATA.NEWBIE)
      if (mission) tk.mission = mission;
      rec.open = rec.open
        .filter((x) => now - x.t0 < TICKET_TTL)
        .concat(tk)
        .slice(-OPEN_MAX);
      rec.dirty = true;
      return tk;
    });
    return ok({ id: tk.id, seed: tk.seed, rs: tk.rs, rank: tk.rank, mission: tk.mission || null });
  }
  if (p === '/api/run/end' && req.method === 'POST') {
    const b = await body(req, MAX_RUN_BODY);
    if (typeof b.id !== 'string' || !Number.isInteger(b.n) || b.n < 0 || b.n > MAX_STEPS) return no(400, 'bad run');
    // the ticket and the time first (cheap): a run sped up is refused, and a log is only read for a ticket that stands
    const pre = await withAcc(a, (rec) => {
      const i = rec.open.findIndex((x) => x.id === b.id);
      if (i < 0) return { code: 404, error: 'unknown run' };
      if (Date.now() - rec.open[i].t0 > TICKET_TTL) {
        rec.open.splice(i, 1);
        rec.dirty = true;
        return { code: 410, error: 'ticket expired' };
      } // (a ticket's seeds aren't known for ever)
      if ((b.n / HZ) * 1000 <= Date.now() - rec.open[i].t0 + SLACK) return null;
      const tk = rec.open.splice(i, 1)[0];
      rec.dirty = true; // more steps than time has passed: a sped-up run
      rec.recent.unshift({ id: tk.id, at: Date.now(), error: 'too fast' });
      rec.recent.length = Math.min(rec.recent.length, RECENT_MAX);
      return { code: 409, error: 'too fast' };
    });
    if (pre) return no(pre.code, pre.error);
    let log;
    try {
      log = await readLog(b);
    } catch {
      return no(400, 'bad log');
    }
    const r = await withAcc(a, (rec) => {
      const i = rec.open.findIndex((x) => x.id === b.id);
      if (i < 0) return { code: 404, error: 'unknown run' };
      const tk = rec.open.splice(i, 1)[0];
      rec.dirty = true; // a ticket is good once, whatever comes of it
      // the loadout it is played again with: fixed now, from what the account owns now (the purchases sent before it included)
      const ticket = { ...tk, ...loadout(rec.save, b.want && typeof b.want === 'object' ? b.want : null) };
      return {
        job: {
          id: tk.id,
          account: a,
          ticket,
          n: b.n,
          log,
          hash: typeof b.hash === 'string' ? b.hash.slice(0, 16) : '',
          at: Date.now(),
        },
      };
    });
    if (r.error) return no(r.code, r.error);
    await fsp.writeFile(jobFile(r.job.id), JSON.stringify(r.job)); // the queue survives a restart
    enqueue(r.job);
    return ok({ id: r.job.id, queued: pool.q.length }, 202);
  }
  const m = /^\/api\/run\/([\w-]{1,40})$/.exec(p);
  if (m && req.method === 'GET') {
    const find = () =>
      withAcc(a, (rec) => {
        const x = rec.recent.find((y) => y.id === m[1]);
        return x ? { done: true, ...x, save: rec.save, t: rec.t } : null;
      });
    let r = await find();
    if (!r) {
      const j = jobs.get(m[1]);
      if (!j || j.account !== a) return no(404, 'unknown run');
      await Promise.race([j.p.catch(() => {}), new Promise((ok) => setTimeout(ok, 25e3))]);
      r = (await find()) || { done: false };
    }
    return ok(r);
  }
  return no(404, 'not found');
}
// the game: /live/… from GAME_DIR, nothing else
async function files(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  if (p === '/' || p === '' || p === '/live' || p === '/live/') {
    res.writeHead(302, { location: '/live/index.html' });
    return res.end();
  }
  if (!p.startsWith('/live/')) return send(res, 404, 'not found');
  const f = path.resolve(GAME, '.' + p.slice(5));
  if (!f.startsWith(GAME + path.sep)) return send(res, 404, 'not found');
  let st;
  try {
    st = await fsp.stat(f);
  } catch {
    return send(res, 404, 'not found');
  }
  if (!st.isFile()) return send(res, 404, 'not found');
  const lm = st.mtime.toUTCString();
  if (req.headers['if-modified-since'] === lm) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'last-modified': lm,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f)
    .on('error', () => res.destroy())
    .pipe(res);
}
// playing together (rooms.mjs): an account's profile and loadout for its hero, and a run played together paid like a run alone — the
// server plays it again from both players' logs (replay-worker.mjs playCoop) and pays this account what its hero earned
const profile = (a, want) =>
  withAcc(a, (rec) => ({
    nick: rec.save.nick,
    ava: rec.save.ava,
    bg: rec.save.bg,
    rank: RULES.rank(rec.save),
    lo: loadout(rec.save, want),
  }));
async function settleCoop(job) {
  await fsp.writeFile(jobFile(job.id), JSON.stringify(job)); // the queue survives a restart
  const out = await enqueue(job),
    acc = await withAcc(job.account, (rec) => ({ save: rec.save, t: rec.t }));
  return { done: true, ...out, ...acc };
}
let ROOMS = null;
export async function start(port = PORT, host = HOST) {
  if (!pool) {
    pool = new Pool(WORKERS);
    for (const f of await fsp.readdir(path.join(DATA, 'jobs'))) {
      // replays queued before a restart
      if (!f.endsWith('.json')) continue;
      try {
        enqueue(JSON.parse(await fsp.readFile(path.join(DATA, 'jobs', f), 'utf8')));
      } catch (e) {
        console.error('queued run dropped', f, e.message);
        fsp.rm(path.join(DATA, 'jobs', f), { force: true }).catch(() => {});
      }
    }
  }
  const srv = http.createServer(async (req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(res, 400, 'bad url');
    }
    try {
      if (p.startsWith('/api/')) await api(req, res, p);
      else await files(req, res, p);
    } catch (e) {
      if (!res.headersSent)
        send(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.code >= 400 ? e.message : 'server error' });
      if (!(e.code >= 400)) console.error(e);
    }
  });
  srv.on('close', () => {
    if (pool) {
      pool.close();
      pool = null;
    }
  });
  if (!ROOMS)
    ROOMS = rooms({
      REV,
      REPLAY,
      RULES,
      D: require('../live/data.js'),
      LEVELS,
      LAB_LEVELS,
      MISSIONS,
      who: whoTok,
      profile,
      settle: settleCoop,
      ipOf,
      MAX_STEPS,
    });
  srv.on('upgrade', (req, socket) => {
    let p = '';
    try {
      p = new URL(req.url, 'http://x').pathname;
    } catch (e) {}
    if (p === '/api/ws') ROOMS.upgrade(req, socket);
    else socket.destroy();
  });
  return new Promise((r) =>
    srv.listen(port, host, () => {
      console.log(`Zombie Horde: http://${host}:${srv.address().port}/  (data: ${DATA}, replay workers: ${WORKERS})`);
      r(srv);
    }),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
