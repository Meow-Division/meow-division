// server/test.mjs — the server end to end, and every way around its rules a player could try: node server/test.mjs
// A stand-in NEAR RPC knows alice.near with one full-access key and one function-call key. Login: a NEP-413 signature by the full-access
// key, nothing else; a new account starts fresh even when an old client-written save of it lies on disk. Progress: only the server
// writes it — a save sent by the page is refused, purchases follow the rules (price, rank, mastery). Runs: the server plays them again
// from their inputs and pays what that replay earned — a run played with god mode and 99 999 coins added in the page earns what its
// inputs earn; a ticket is good once; a run with more steps than time has passed is refused; two runs overlapping in time pay once; a
// broken log is refused; a run dealt under the rules before a deploy is played again by those rules. A guest's device token takes
// tickets for its current mission only, and its run is played again into the device's record. A wallet made in the game
// (server/wallets.mjs): only a guest's device token, mission 1 proven by its record, a free valid name, once a device, within the
// day's caps; the stand-in chain checks the server's signed transaction and answers as mainnet would (made, a name taken meanwhile,
// the old contract, no places left, an answer lost on the way); then the new key signs in and what the record proves goes along,
// once. Static: the game is served, nothing else. Exits 1 on any failure.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js'),
  D = require('../live/data.js');
const fails = [],
  ok = (c, m) => {
    console.log((c ? 'ok   ' : 'FAIL ') + m);
    if (!c) fails.push(m);
  };
const full = crypto.generateKeyPairSync('ed25519'),
  fcall = crypto.generateKeyPairSync('ed25519'),
  stranger = crypto.generateKeyPairSync('ed25519'),
  signer = crypto.generateKeyPairSync('ed25519'); // (the server's key on the items contract here: made for this run)
const raw = (k) => k.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const seedOf = (k) => k.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
// ---- the stand-in chain: accounts and their keys; the items contract's game_wallet as mainnet runs it, answering by chain.mode:
// 'ok' (made), 'race' (someone took the name meanwhile: the registrar answers false), 'old' (the server's key not allowed
// game_wallet yet), 'cap' (no places left on the contract), 'lost' (made, but the RPC times out and only the tx lookup knows)
const ITEMS = 'items.meowdivision.near';
const chain = { accounts: new Map(), mode: 'ok', sent: [], ops: new Set(), lost: new Map() };
const addKey = (account, publicKey, permission) => {
  if (!chain.accounts.has(account)) chain.accounts.set(account, new Map());
  chain.accounts.get(account).set(publicKey, { nonce: 7, permission });
};
const u32 = (b, o) => b.readUInt32LE(o);
function readTx(buf) {
  // nearcore's Transaction borsh: signer, key, nonce, receiver, block hash, actions (function calls only here)
  let o = 0;
  const str = () => {
    const n = u32(buf, o);
    o += 4 + n;
    return buf.subarray(o - n, o).toString('utf8');
  };
  const signer = str();
  const key = buf.subarray(o + 1, o + 33);
  o += 33;
  const nonce = buf.readBigUInt64LE(o);
  o += 8;
  const receiver = str();
  o += 32;
  const calls = [];
  for (let i = 0, n = u32(buf, (o += 4) - 4); i < n; i++) {
    if (buf[o++] !== 2) throw new Error('not a function call');
    const method = str(),
      len = u32(buf, o);
    const args = JSON.parse(buf.subarray(o + 4, o + 4 + len).toString('utf8')),
      gas = Number(buf.readBigUInt64LE(o + 4 + len));
    o += 4 + len + 8 + 16;
    calls.push({ method, args, gas });
  }
  return { signer, key, nonce, receiver, calls, end: o };
}
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');
function sendTx(signedB64) {
  const buf = Buffer.from(signedB64, 'base64'),
    tx = readTx(buf),
    body = buf.subarray(0, tx.end),
    sig = buf.subarray(tx.end + 1);
  const pub = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.key]),
    format: 'der',
    type: 'spki',
  });
  const good = crypto.verify(null, crypto.createHash('sha256').update(body).digest(), pub, sig);
  const k = chain.accounts.get(tx.signer) && chain.accounts.get(tx.signer).get('ed25519:' + N.b58encode(tx.key));
  if (!good || !k)
    return { error: { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION' }, data: 'InvalidSignature' } };
  if (tx.nonce <= BigInt(k.nonce))
    return { error: { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION' }, data: 'InvalidNonce' } };
  k.nonce = Number(tx.nonce);
  const { method, args, gas } = tx.calls[0];
  chain.sent.push({ signer: tx.signer, receiver: tx.receiver, method, args, gas });
  if (chain.mode === 'old')
    return {
      error: {
        name: 'HANDLER_ERROR',
        cause: { name: 'INVALID_TRANSACTION' },
        data: {
          TxExecutionError: {
            InvalidTxError: { InvalidAccessKeyError: { MethodNameMismatch: { method_name: method } } },
          },
        },
      },
    };
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const fail = (msg) => ({
    status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: msg } } } } },
  });
  let result;
  if (chain.mode === 'cap') result = fail('Smart contract panicked: no wallets left');
  else if (chain.ops.has(args.request_id)) result = { status: { SuccessValue: b64(false) } };
  else if (chain.accounts.has(args.account_id)) result = { status: { SuccessValue: b64(false) } };
  else if (chain.mode === 'race') {
    addKey(args.account_id, pk(stranger), 'FullAccess');
    result = { status: { SuccessValue: b64(false) } };
  } else {
    chain.ops.add(args.request_id);
    addKey(args.account_id, args.public_key, 'FullAccess');
    result = { status: { SuccessValue: b64(true) } };
  }
  if (chain.mode === 'lost') {
    chain.lost.set(hash, result);
    return { error: { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR' } } };
  }
  return { result };
}
const rpc = http.createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  const { method, params } = JSON.parse(b);
  const reply = (x) => res.end(JSON.stringify({ jsonrpc: '2.0', id: 'zh', ...x }));
  if (method === 'block') return reply({ result: { header: { hash: N.b58encode(crypto.randomBytes(32)) } } });
  if (method === 'send_tx') return reply(sendTx(params.signed_tx_base64));
  if (method === 'tx') {
    const r = [...chain.lost.values()].pop();
    return reply(r ? { result: r } : { error: { cause: { name: 'UNKNOWN_TRANSACTION' } } });
  }
  const acc = chain.accounts.get(params.account_id);
  if (params.request_type === 'view_account')
    return reply(
      acc ? { result: { amount: '1', storage_usage: 182 } } : { error: { cause: { name: 'UNKNOWN_ACCOUNT' } } },
    );
  if (params.request_type === 'call_function' && params.method_name === 'op_done') {
    const key = JSON.parse(Buffer.from(params.args_base64, 'base64').toString()).key.replace(/^wallet:/, '');
    return reply({ result: { result: [...Buffer.from(JSON.stringify(chain.ops.has(key)))] } });
  }
  const k = acc && acc.get(params.public_key);
  reply(
    k
      ? { result: { nonce: k.nonce, permission: k.permission, block_height: 1 } }
      : { error: { cause: { name: acc ? 'UNKNOWN_ACCESS_KEY' : 'UNKNOWN_ACCOUNT' } } },
  );
});
await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-save-'));
process.env.DATA_DIR = tmp;
process.env.NEAR_RPC = `http://127.0.0.1:${rpc.address().port}`;
process.env.REPLAY_WORKERS = '2';
process.env.TRUST_PROXY = '1'; // (the wallet cases come from several addresses: X-Forwarded-For)
process.env.WALLET_DAILY_CAP = '6';
process.env.WALLET_IP_DAILY_CAP = '2';
process.env.WALLET_KEY_WAIT_MS = '2000';
const N = await import('./near.mjs');
process.env.NEAR_SIGNER_KEY = 'ed25519:' + N.b58encode(Buffer.concat([seedOf(signer), raw(signer)]));
const S = await import('./server.mjs');
function pk(k) {
  return 'ed25519:' + N.b58encode(raw(k));
}
addKey('alice.near', pk(full), 'FullAccess');
addKey('alice.near', pk(fcall), { FunctionCall: { allowance: null, receiver_id: 'game.near', method_names: [] } });
addKey(ITEMS, pk(signer), {
  FunctionCall: { allowance: '1000000000000000000000000', receiver_id: ITEMS, method_names: ['game_wallet'] },
});
addKey('taken.near', pk(stranger), 'FullAccess');
const hashA = (a) => crypto.createHash('sha256').update(a).digest('hex'),
  accFile = path.join(tmp, 'accounts', hashA('alice.near') + '.json');
// the first build's save of alice: what the page had sent, rich and untrusted
fs.mkdirSync(path.join(tmp, 'saves'), { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'saves', hashA('alice.near') + '.json'),
  JSON.stringify({
    account: 'alice.near',
    t: 1,
    save: { coins: 99999, rxp: 99999, owned: { pistol: true, rocket: true } },
  }),
);
const srv = await S.start(0, '127.0.0.1'),
  base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, p, b, tok, ip) => {
  const r = await fetch(base + p, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(tok ? { authorization: 'Bearer ' + tok } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { code: r.status, j };
};
const sign = (k, nonce, message = S.MESSAGE) =>
  crypto
    .sign(null, S.nep413Hash({ message, nonce: Buffer.from(nonce, 'base64'), recipient: S.RECIPIENT }), k.privateKey)
    .toString('base64');
const login = async (k, opt = {}) => {
  const c = await call('POST', '/api/challenge', {});
  const nonce = opt.nonce || c.j.nonce;
  return {
    nonce,
    r: await call('POST', '/api/login', {
      accountId: opt.account || 'alice.near',
      publicKey: pk(k),
      signature: sign(k, nonce, opt.message),
      nonce,
    }),
  };
};

// ---------------- login
ok((await call('GET', '/api/health')).j?.network === 'mainnet', 'health: mainnet');
{
  const NW = require('../live/newwallet.js'),
    ch = (await call('POST', '/api/challenge', {})).j;
  ok(
    ch.recipient === 'game.meowdivision.fun' &&
      ch.message === NW.LOGIN.message &&
      ch.recipient === NW.LOGIN.recipient &&
      /^Meow Division: /.test(ch.message),
    "the login names the game's domain and the message the page signs",
  );
}
const L = await login(full);
ok(L.r.code === 200 && L.r.j.token && L.r.j.accountId === 'alice.near', 'login with a full-access key: a token');
ok(
  L.r.j.save && L.r.j.save.coins === 0 && L.r.j.save.rxp === 0 && !L.r.j.save.owned.rocket,
  'a new account starts fresh (the old client-written save is set aside, not taken)',
);
ok(fs.existsSync(path.join(tmp, 'legacy', hashA('alice.near') + '.json')), '… and kept aside in legacy/');
ok(
  (
    await call('POST', '/api/login', {
      accountId: 'alice.near',
      publicKey: pk(full),
      signature: sign(full, L.nonce),
      nonce: L.nonce,
    })
  ).code === 401,
  'the same nonce twice: refused',
);
ok((await login(full, { message: 'something else' })).r.code === 401, 'a signature over another message: refused');
ok((await login(fcall)).r.code === 401, 'a function-call key: refused');
ok((await login(stranger)).r.code === 401, 'a key the account does not have: refused');
ok((await login(full, { account: 'Bob..near' })).r.code === 400, 'a malformed account: refused');
ok((await login(full, { account: 'bob.near' })).r.code === 401, "another account with alice's key: refused");
const tok = L.r.j.token;
ok(
  (
    await call(
      'GET',
      '/api/save',
      undefined,
      tok.replace(/.(?=.$)/, (c) => (c === 'A' ? 'B' : 'A')),
    )
  ).code === 401,
  'a forged token: refused',
); // (the second-last character: the last one's low bits are base64 padding, decoded away)
ok((await call('GET', '/api/save')).code === 401, 'no token: refused');
// the limits count a network: an IPv6 client's whole /64, an IPv4-mapped address as its IPv4 one (server/ipnet.mjs)
{
  const codes = [];
  for (let i = 1; i <= 31; i++)
    codes.push((await call('POST', '/api/challenge', {}, undefined, '2001:db8:aa:1::' + i.toString(16))).code);
  const other = (await call('POST', '/api/challenge', {}, undefined, '2001:db8:aa:2::1')).code;
  for (let i = 0; i < 30; i++) await call('POST', '/api/challenge', {}, undefined, '10.77.0.1');
  const mapped = (await call('POST', '/api/challenge', {}, undefined, '::ffff:10.77.0.1')).code;
  ok(
    codes.slice(0, 30).every((c) => c === 200) && codes[30] === 429 && other === 200 && mapped === 429,
    `per-minute limits by /64 (a new address in the same block: slowed down; the next block: not) and IPv4-mapped as IPv4 (${codes[30]} ${other} ${mapped})`,
  );
  // at most 20 nonces held a network: a 21st drops its oldest, so one client can't fill the table
  const ip = '2001:db8:bb:1::9',
    got = [];
  for (let i = 0; i < 21; i++) got.push((await call('POST', '/api/challenge', {}, undefined, ip)).j.nonce);
  const use = (nonce) =>
    call(
      'POST',
      '/api/login',
      { accountId: 'alice.near', publicKey: pk(full), signature: sign(full, nonce), nonce },
      undefined,
      ip,
    );
  const first = await use(got[0]),
    last = await use(got[20]);
  ok(
    first.code === 401 && first.j.error === 'unknown or expired nonce' && last.code === 200,
    `nonces held per network: the oldest of 21 dropped (${first.code}), the newest good (${last.code})`,
  );
}

// ---------------- progress: only through the rules
ok((await call('PUT', '/api/save', { save: { coins: 1e9 } }, tok)).code === 410, 'a save sent by the page: refused');
ok((await call('GET', '/api/save', undefined, tok)).j?.save?.coins === 0, '… the coins stay 0');
let r = await call('POST', '/api/act', { a: { k: 'buy', id: 'shotgun' } }, tok);
ok(r.code === 409 && r.j.error === 'rank' && r.j.save.coins === 0, 'buying a gun before its rank: refused');
r = await call('POST', '/api/act', { a: { k: 'meta', s: 'hp' } }, tok);
ok(r.code === 409 && r.j.error === 'coins', 'an upgrade without the coins: refused');
for (const a of [
  { k: 'up', id: 'pistol', s: 'dmg' },
  { k: 'meta', s: '__proto__' },
  { k: 'sel', id: 'rocket' },
  { k: 'buy', id: 'laser' },
  { k: 'gift', coins: 5000 },
  { k: 'lang', v: '<script>' },
])
  ok((await call('POST', '/api/act', { a }, tok)).code === 409, 'refused: ' + JSON.stringify(a));
// coins for the test, the way an admin would (on disk): then buying works and costs
const edit = (f) => {
  const rec = JSON.parse(fs.readFileSync(accFile, 'utf8'));
  f(rec);
  fs.writeFileSync(accFile, JSON.stringify(rec));
};
edit((rec) => {
  rec.save.coins = 1000;
});
r = await call('POST', '/api/act', { a: { k: 'meta', s: 'hp' } }, tok);
ok(
  r.code === 200 && r.j.save.coins === 1000 - D.META.hp.price[0] && r.j.save.meta.hp === 1,
  'an upgrade with the coins: bought, its price taken',
);
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'dmg' } }, tok);
ok(r.code === 200 && r.j.save.wup.pistol.dmg === 1, 'a gun upgrade within its mastery: bought');
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'dmg' } }, tok);
ok(r.code === 409 && r.j.error === 'mastery', 'the next one, above its mastery: refused');
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'mag' } }, tok);
ok(r.code === 200 && r.j.save.wup.pistol.mag === 1, 'the magazine upgrade: bought');
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'toString' } }, tok);
ok(r.code === 409 && r.j.error === 'unknown upgrade', 'an upgrade that does not exist: refused');
// a trade's count is a whole number: text or an array that reads as one is refused (the shelf counted '11' as text)
{
  edit((rec) => {
    rec.save.items = { gears: 3 };
  });
  const bad = [];
  for (const n of ['11', [1], '1e0', 1.5, 0, 1000])
    bad.push((await call('POST', '/api/act', { a: { k: 'sell', id: 'gears', n } }, tok)).j?.error);
  r = await call('POST', '/api/act', { a: { k: 'sell', id: 'gears', n: 2 } }, tok);
  const w = (await call('GET', '/api/walt')).j;
  ok(
    bad.every((e) => e === 'bad amount') && r.code === 200 && r.j.save.items.gears === 1 && w.recent.gears === 2,
    `a count that is not a whole number 1..999: refused; Walt's day counts numbers (${JSON.stringify(bad)}, ${JSON.stringify(w.recent)})`,
  );
  edit((rec) => {
    rec.save.items = {};
    rec.save.coins = 1000 - D.META.hp.price[0] - D.WEAPON_UP.dmg.price[0] - D.WEAPON_UP.mag.price[0];
  });
}

// ---------------- runs: played again on the server
// a run as the page plays it: the attract bot steering, firing, taking the first card; cheat: what a hacked page does on top; kit: the
// loadout it is played with (the page sends it with the inputs) — by default the account's own: the pistol, hp 1, the pistol's damage 1
// and magazine 1
const KIT = {
  weapon: 'pistol',
  meta: { hp: 1, dmg: 0, speed: 0, magnet: 0, reroll: 0, start: 0 },
  wup: { dmg: 1, rate: 0, mag: 1 },
};
// careful: the bot also keeps well away from the zombies near it (a run that must last, whatever the seed)
// (sim: another build's rules, as an older page plays them; cheat 'god': god mode alone, so the page's run lasts exactly secs)
function playRun(tk, secs, cheat, kit = KIT, careful = false, sim = SIM) {
  const SIM = sim,
    st = SIM.create({ seed: tk.seed, rs: tk.rs, rank: tk.rank, ...kit }),
    rec = REPLAY.rec();
  let hash = null;
  if (cheat) st.p.god = true;
  for (let i = 0; i < secs * 120 && !st.over; i++) {
    const inp = SIM.scriptInput(st.t, st);
    inp.fire = true;
    inp.mx = 960 + 300 * Math.cos(i / 90);
    inp.my = 540;
    if (st.pause) inp.pick = 0;
    if (careful) {
      let fx = inp.jx * 0.3,
        fy = inp.jy * 0.3;
      for (const e of st.en) {
        const dx = st.p.x - e.x,
          dy = (st.p.y - e.y) * 2,
          d2 = dx * dx + dy * dy;
        if (d2 < 420 * 420 && d2 > 1) {
          fx += (dx / d2) * 400;
          fy += (dy / d2) * 400;
        }
      }
      const m = Math.hypot(fx, fy) || 1;
      inp.jx = fx / m;
      inp.jy = fy / m;
    }
    const q = REPLAY.quant(inp);
    REPLAY.push(rec, q);
    SIM.step(st, q);
    if (cheat === true && i === 600) {
      st.coins += 99999;
      st.kills += 5000;
    }
    if (st.over && !hash) hash = REPLAY.hash(st);
  }
  return { st, rec, hash: hash || REPLAY.hash(st) };
}
const z = (log) => zlib.gzipSync(Buffer.from(JSON.stringify(log))).toString('base64');
const result = async (id) => {
  for (let i = 0; i < 40; i++) {
    const g = await call('GET', '/api/run/' + id, undefined, tok);
    if (g.j && g.j.done) return g.j;
    if (g.code !== 200) return g.j;
  }
  return null;
};
// a ticket dealt secs before T0, one moment fixed for every run below: the runs' times are where the cases put them however long
// the replays before them took (a ticket moved back from its own deal time drifted with a slow machine, and runs meant to stand
// apart could overlap)
const T0 = Date.now();
const backdate = (id, secs) =>
  edit((rec) => {
    const t = rec.open.find((x) => x.id === id);
    t.t0 = T0 - secs * 1000;
  });

let t1 = (await call('POST', '/api/run/start', { weapon: 'rocket', rev: SIM.REV }, tok)).j;
ok(
  t1 &&
    t1.id &&
    [7, 8, 9, 10, 11].includes(t1.seed) &&
    Number.isInteger(t1.rs) &&
    Number.isInteger(t1.rank) &&
    !('meta' in t1),
  "a ticket: the server's seeds and the account's rank, for one run",
);
backdate(t1.id, 130);
const honest = playRun(t1, 120),
  want = RULES.outcome(honest.st);
r = await call(
  'POST',
  '/api/run/end',
  { id: t1.id, n: honest.rec.n, z: z(honest.rec.log), hash: honest.hash, want: KIT },
  tok,
);
ok(r.code === 202, 'an honest run: taken (queued for its replay)');
let res = await result(t1.id);
ok(
  res &&
    res.done &&
    res.match &&
    res.outcome.kills === want.kills &&
    res.outcome.coins === want.coins &&
    Math.abs(res.outcome.t - want.t) < 1e-9,
  `the replay ends where the page's run did (${want.kills} kills, ${want.coins} coins, ${want.t.toFixed(1)} s)`,
);
const before = 1000 - D.META.hp.price[0] - D.WEAPON_UP.dmg.price[0] - D.WEAPON_UP.mag.price[0],
  paid = RULES.bank(RULES.defaults(), want).coins;
ok(
  res && res.save.coins === before + paid && res.gain.coins === paid && res.save.stats.runs === 1,
  `… paid what it earned (+${paid} coins), once`,
);
ok(
  (
    await call(
      'POST',
      '/api/run/end',
      { id: t1.id, n: honest.rec.n, z: z(honest.rec.log), hash: honest.hash, want: KIT },
      tok,
    )
  ).code === 404,
  'the same run sent again: refused',
);

// (a mission that is not the account's current one asked for: dropped, a classic run on the map asked for — so one
// won before can't be farmed, nor one played out of turn)
const t2 = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'lab', map: 'lab' }, tok)).j;
ok(t2.mission === null && t2.seed >= SIM.LAB0, 'a mission that is not the current one: dropped, the run is classic');
backdate(t2.id, 260); // (before the honest run: runs of one account can't overlap)
const cheat = playRun(t2, 120, true),
  cheatWant = RULES.outcome(cheat.st);
r = await call(
  'POST',
  '/api/run/end',
  { id: t2.id, n: cheat.rec.n, z: z(cheat.rec.log), hash: cheat.hash, want: KIT },
  tok,
);
res = await result(t2.id);
ok(
  cheatWant.coins >= 99999 &&
    res &&
    res.done &&
    !res.error &&
    !res.match &&
    res.outcome.coins < 5000 &&
    res.outcome.kills < cheatWant.kills,
  `a run hacked in the page (god mode, +99 999 coins, +5000 kills): paid what its inputs earn [match ${res && res.match} err ${res && res.error} done ${res && res.done}; the page claimed ${cheatWant.coins} coins, ${cheatWant.kills} kills in ${cheatWant.t.toFixed(1)} s] (${res && res.outcome.coins} coins, ${res && res.outcome.kills} kills)`,
);

const t7 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j;
backdate(t7.id, 900); // (long before the runs above and below)
const RICH = {
    weapon: 'rocket',
    meta: { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 3 },
    wup: { dmg: 5, rate: 5 },
  },
  rich = playRun(t7, 80, false, RICH);
await call('POST', '/api/run/end', { id: t7.id, n: rich.rec.n, z: z(rich.rec.log), hash: rich.hash, want: RICH }, tok);
res = await result(t7.id);
ok(
  res && res.done && !res.error && !res.match && res.outcome.gun === 'pistol',
  'a run played with a gun and upgrades the account lacks: paid as played again with what it owns (the pistol)',
);

// (the hero kept alive: a whole minute whatever the deal, the time is checked before the log is read)
const t3 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j,
  fast = playRun(t3, 60, true);
r = await call('POST', '/api/run/end', { id: t3.id, n: fast.rec.n, z: z(fast.rec.log) }, tok);
ok(
  r.code === 409 && r.j.error === 'too fast',
  'a minute of play sent a second after its ticket (a sped-up run): refused',
);

const t4 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j,
  t5 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j;
backdate(t4.id, 400);
backdate(t5.id, 395); // (before the runs above)
// (both pages' runs last the whole 100 s — god mode in the page, which the replay doesn't take — so they overlap for 95 s whatever
// the deal: a hero dead early made the first run too short to overlap, and the case failed now and then)
const p4 = playRun(t4, 100, 'god', KIT, true),
  p5 = playRun(t5, 100, 'god', KIT, true);
await call('POST', '/api/run/end', { id: t4.id, n: p4.rec.n, z: z(p4.rec.log), want: KIT }, tok);
const r4 = await result(t4.id);
// refusals since then fill the results kept (RECENT_MAX): the paid run they push out still counts for the overlap
edit((rec) => {
  rec.recent = Array.from({ length: 30 }, (_, i) => ({ id: 'refused' + i, at: Date.now(), error: 'too fast' }));
});
await call('POST', '/api/run/end', { id: t5.id, n: p5.rec.n, z: z(p5.rec.log), want: KIT }, tok);
const r5 = await result(t5.id);
ok(
  p4.rec.n === 12000 && p5.rec.n === 12000 && r4 && !r4.error && r5 && r5.error === 'overlap',
  'two runs of one account at the same time (bots in parallel): the second pays nothing, even with the first out of the results kept' +
    ` [${p4.st.t.toFixed(1)} s ${JSON.stringify(r4 && (r4.error || r4.outcome))}; ${p5.st.t.toFixed(1)} s ${JSON.stringify(r5 && (r5.error || r5.outcome))}]`,
);

// a run dealt under the rules before a deploy and sent after it: played again by those rules (the server keeps them: DATA/sims/<rev>),
// not by the new ones it was never played with — here the old rules' pistol never runs dry
{
  const OLD = SIM.REV - 1,
    dir = path.join(tmp, 'sims', String(OLD)),
    FILES = ['data.js', 'economy.js', 'map.js', 'missions.js', 'sim.js', 'replay.js', 'rules.js'];
  ok(
    fs.existsSync(path.join(tmp, 'sims', String(SIM.REV), 'sim.js')),
    'the server keeps its own rules for later (sims/' + SIM.REV + ')',
  );
  fs.mkdirSync(dir, { recursive: true });
  // The old rules differ from today's by their REV and the pistol's magazine. A patch that finds nothing would make the
  // two rule sets equal and the case below pass for the wrong reason, so a missing pattern stops the test.
  const patch = (s, re, to, f) => {
    if (!re.test(s)) throw new Error(`${f}: ${re} not found, update this test`);
    return s.replace(re, to);
  };
  for (const f of FILES) {
    let s = fs.readFileSync(new URL('../live/' + f, import.meta.url), 'utf8');
    if (f === 'sim.js') s = patch(s, new RegExp(`const REV = ${SIM.REV};`), `const REV = ${OLD};`, f);
    if (f === 'data.js') s = patch(s, /mag: 13,(\s*)rl: 1\.4/, 'mag: 1000,$1rl: 1.4', f);
    fs.writeFileSync(path.join(dir, f), s);
  }
  const ctx = vm.createContext({ console });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
  const t8 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j;
  backdate(t8.id, 700);
  edit((rec) => {
    rec.open.find((x) => x.id === t8.id).rev = OLD;
  });
  const p8 = playRun(t8, 100, false, KIT, true, ctx.SIM),
    now8 = REPLAY.hash(REPLAY.play(SIM, { ...t8, ...KIT }, p8.rec.log, p8.rec.n));
  await call('POST', '/api/run/end', { id: t8.id, n: p8.rec.n, z: z(p8.rec.log), hash: p8.hash, want: KIT }, tok);
  const r8 = await result(t8.id),
    k8 = (ctx.RULES || RULES).outcome(p8.st).kills; // (the page's own count: a run ended by a death counts the kills at that moment)
  ok(
    ctx.SIM.REV === OLD && now8 !== p8.hash && r8 && r8.match && r8.outcome.kills === k8,
    `a run dealt under the rules before a deploy: played again by them (match ${r8 && r8.match}, ${r8 && r8.outcome && r8.outcome.kills} kills of ${k8}; by the new rules it would not match: ${now8 !== p8.hash})`,
  );
}

// a campaign mission's run: the ticket carries the mission, the replay plays its script (live/missions.js) and ends
// where the page did
const t6 = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'office', map: 'lab' }, tok)).j;
{
  backdate(t6.id, 2000); // (long before every other run here: runs of one account can't overlap)
  const pm = playRun(t6, 60, false, { ...KIT, mission: 'office' });
  await call('POST', '/api/run/end', { id: t6.id, n: pm.rec.n, z: z(pm.rec.log), hash: pm.hash, want: KIT }, tok);
  const rm = await result(t6.id);
  ok(
    t6.mission === 'office' && t6.seed === SIM.OFFICE && rm && rm.match && rm.outcome.mission === 'office',
    `a mission's run: its ticket names the current mission, on its own map, the replay plays its script ` +
      `(match ${rm && rm.match}, task ${pm.st.mis.i})`,
  );
}
const coinsNow = (await call('GET', '/api/save', undefined, tok)).j.save.coins;
ok(
  (await call('POST', '/api/run/end', { id: 'nope', n: 10, log: [] }, tok)).code === 404 &&
    (await call('GET', '/api/run/nope', undefined, tok)).code === 404,
  'a run with no ticket: refused',
);
ok((await call('GET', '/api/save', undefined, tok)).j.save.coins === coinsNow, '… and the coins did not move');

// a log as big as the body allows, for a run with no ticket: refused before it is unpacked
{
  const big = zlib.gzipSync(Buffer.from(JSON.stringify(Array.from({ length: 3e6 }, () => 1)))).toString('base64'),
    t0 = Date.now();
  const rr = await call('POST', '/api/run/end', { id: 'bogus', n: 400000, z: big }, tok);
  ok(rr.code === 404, `a huge log for no ticket: refused without being read (${Date.now() - t0} ms)`);
}
// a log that can't be read closes its ticket (another account: alice's tickets this minute are used up); a small gzip that
// unpacks to far more than a log of its steps can hold stops at that size
{
  const mk = crypto.generateKeyPairSync('ed25519');
  addKey('mallory.near', pk(mk), 'FullAccess');
  const mt = (await login(mk, { account: 'mallory.near' })).r.j.token,
    t = (await call('POST', '/api/run/start', { rev: SIM.REV }, mt)).j;
  let r1 = await call('POST', '/api/run/end', { id: t.id, n: 100, log: [0, 255, 0, 0, 5, 5, 99999999] }, mt);
  const again = await call('POST', '/api/run/end', { id: t.id, n: 100, log: [] }, mt),
    seen = (await call('GET', '/api/run/' + t.id, undefined, mt)).j;
  ok(
    r1.code === 400 && again.code === 404 && seen.done && seen.error === 'bad log',
    `a broken log: refused, and its ticket is closed (${r1.code}, then ${again.code}: ${seen.error})`,
  );
  // (the office is mission 1's map alone: a classic run asked for there is dealt the town)
  const tc = (await call('POST', '/api/run/start', { rev: SIM.REV, map: 'office' }, mt)).j;
  ok(
    tc.mission === null && [7, 8, 9, 10, 11].includes(tc.seed),
    `a classic run asked for on the office map: dealt the town (seed ${tc.seed})`,
  );
  const tb = (await call('POST', '/api/run/start', { rev: SIM.REV }, mt)).j,
    bomb = zlib.gzipSync(Buffer.concat([Buffer.from('['), Buffer.alloc(64 << 20, 0x30)])).toString('base64'),
    t0 = Date.now();
  r1 = await call('POST', '/api/run/end', { id: tb.id, n: 600, z: bomb }, mt);
  ok(
    bomb.length < 1 << 20 &&
      r1.code === 400 &&
      (await call('POST', '/api/run/end', { id: tb.id, n: 600, log: [] }, mt)).code === 404,
    `a gzip bomb (${(bomb.length / 1024).toFixed(0)} kB unpacking to 64 MB) for 5 s of steps: refused at a 5 s log's size, its ticket closed (${Date.now() - t0} ms)`,
  );
}
// the face: dealt once (avatar, background, an English name from its animal); a new name in any letters; no markup
{
  const s0 = (await call('GET', '/api/save', undefined, tok)).j.save;
  ok(
    Number.isInteger(s0.ava) &&
      Number.isInteger(s0.bg) &&
      /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(s0.nick) &&
      D.AVATARS[s0.ava].animal.some((x) => s0.nick.endsWith(x)),
    `a face was dealt: avatar ${s0.ava}, background ${s0.bg}, "${s0.nick}"`,
  );
  let rn = await call('POST', '/api/act', { a: { k: 'nick', v: '  Злой   Кролик ' } }, tok);
  ok(rn.code === 200 && rn.j.save.nick === 'Злой Кролик', 'a new name in any letters (spaces tidied)');
  rn = await call('POST', '/api/act', { a: { k: 'nick', v: '‮evil' } }, tok);
  ok(
    rn.code === 200 && rn.j.save.nick === 'evil',
    'invisible characters dropped from a name (a right-to-left override)',
  );
  for (const v of ['<b>x</b>', 'a', 'x'.repeat(19), '‮​', 42])
    ok(
      (await call('POST', '/api/act', { a: { k: 'nick', v } }, tok)).code === 409,
      'a name refused: ' + JSON.stringify(v),
    );
}
// tickets can't be dealt over and over (to pick the seeds)
{
  let codes = [];
  for (let i = 0; i < 10; i++) codes.push((await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).code);
  ok(codes.includes(429), 'tickets asked for again and again: slowed down (' + codes.join(' ') + ')');
}

// ---------------- the ranking: by rank, then the record — the fastest win (none: after); an account from before the record takes its
// fastest win among its kept results
{
  const put = (acc, stats, recent = []) =>
    fs.writeFileSync(
      path.join(tmp, 'accounts', hashA(acc) + '.json'),
      JSON.stringify({ v: 2, account: acc, t: 1, save: { stats, rxp: 0 }, open: [], recent }),
    );
  put('bob.near', { runs: 4, wins: 2, best: 700, fast: 580 });
  put('carol.near', { runs: 9, wins: 0, best: 650, fast: 0 });
  put('dave.near', { runs: 3, wins: 1, best: 620, fast: 620 });
  put('erin.near', { runs: 5, wins: 1, best: 700 }, [
    { id: 'x', outcome: { win: false, t: 700 } },
    { id: 'y', outcome: { win: true, t: 590 } },
  ]);
  const b = (await call('GET', '/api/leaderboard')).j,
    ones = b.top.filter((r) => ['bob.near', 'carol.near', 'dave.near', 'erin.near'].includes(r.account));
  ok(
    JSON.stringify(ones.map((r) => [r.account, r.fast])) ===
      JSON.stringify([
        ['bob.near', 580],
        ['erin.near', 590],
        ['dave.near', 620],
        ['carol.near', 0],
      ]),
    'the ranking: the fastest win first, no win after, the record of an old account from its kept wins: ' +
      JSON.stringify(ones.map((r) => [r.account, r.fast])),
  );
}
// ---------------- a guest's mission runs, proven on the server: its device token takes a ticket for its record's current
// mission (no other run), the run is played again like an account's, and what it earned goes into the device's record
// (DATA/guests); the wallet made in the game and a first sign-in read that record, never the page's save
const gdev = async (ip = '10.2.0.1') => (await call('POST', '/api/guest', {}, undefined, ip)).j.device;
const gfile = (d) =>
  path.join(tmp, 'guests', hashA(JSON.parse(Buffer.from(d.split('.')[0], 'base64url').toString()).g) + '.json');
const gedit = (d, f) => {
  const rec = JSON.parse(fs.readFileSync(gfile(d), 'utf8'));
  f(rec);
  fs.writeFileSync(gfile(d), JSON.stringify(rec));
};
// what a won mission 1 leaves in a device's record (as its replay would: written here the way an admin would, on disk)
const prove = (d) =>
  fs.writeFileSync(
    gfile(d),
    JSON.stringify({
      v: 2,
      guest: 1,
      account: 'g:' + path.basename(gfile(d), '.json'),
      t: Date.now(),
      e: Date.now() + 864e5,
      save: {
        ...RULES.defaults(),
        camp: ['office'],
        items: { t_butcher: 1 },
        coins: 170,
        rxp: 400,
        stats: { runs: 1 },
      },
      open: [],
      recent: [],
      spans: [],
    }),
  );
{
  const gd = await gdev('10.2.0.9');
  let r = await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'office', map: 'office', rank: 1 }, gd);
  const gt = r.j;
  ok(
    r.code === 200 && gt.mission === 'office' && gt.seed === SIM.OFFICE && gt.rank === 1,
    "a guest's device token: a ticket for its current mission, on its map",
  );
  const refused = [
    (await call('POST', '/api/run/start', { rev: SIM.REV, map: 'suburb' }, gd)).j?.error,
    (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'lab', map: 'lab' }, gd)).j?.error,
  ];
  ok(
    refused.every((e) => e === 'mission') &&
      (await call('GET', '/api/save', undefined, gd)).code === 401 &&
      (await call('POST', '/api/act', { a: { k: 'meta', s: 'hp' } }, gd)).code === 401,
    `… no classic run, no mission out of turn (${refused}); no save or purchase with it`,
  );
  gedit(gd, (rec) => {
    rec.open[0].t0 = Date.now() - 40e3;
  });
  const gp = playRun(gt, 30, false, { ...KIT, mission: 'office' }, true);
  r = await call('POST', '/api/run/end', { id: gt.id, n: gp.rec.n, z: z(gp.rec.log), hash: gp.hash, want: KIT }, gd);
  let gr = null;
  for (let i = 0; i < 40 && !(gr && gr.done); i++) gr = (await call('GET', '/api/run/' + gt.id, undefined, gd)).j;
  const kept = JSON.parse(fs.readFileSync(gfile(gd), 'utf8'));
  ok(
    r.code === 202 &&
      gr &&
      gr.done &&
      gr.match &&
      gr.outcome.mission === 'office' &&
      kept.save.stats.runs === 1 &&
      !kept.save.camp.length &&
      !fs.readdirSync(path.join(tmp, 'accounts')).includes(path.basename(gfile(gd))),
    `… its run played again by the server into the device's record, not an account (match ${gr && gr.match}, ${kept.save.stats.runs} run, missions ${JSON.stringify(kept.save.camp)})`,
  );
  // the record (not the page) is what proves mission 1
  const key = crypto.generateKeyPairSync('ed25519'),
    played = { ...RULES.defaults(), camp: ['office'], coins: 99999, items: { t_butcher: 1 } };
  r = await call(
    'POST',
    '/api/wallet/create',
    { name: 'guesty', publicKey: pk(key), device: gd, guest: played },
    undefined,
    '10.1.9.1',
  );
  ok(r.j?.error === 'mission', "a page's save claiming mission 1, its record without it: no wallet");
}
// ---------------- a wallet made in the game (wallets.mjs)
{
  const dA = await gdev(),
    dB = await gdev(),
    dC = await gdev(),
    dD = await gdev(),
    dE = await gdev(),
    dF = await gdev(),
    dG = await gdev(),
    dH = await gdev(),
    dM = await gdev();
  ok(typeof dA === 'string' && dA !== dB, 'a guest gets a device token of its own');
  for (const d of [dA, dB, dC, dD, dE, dF, dG, dH]) prove(d);
  const played = { ...RULES.defaults(), camp: ['office'], coins: 99999, rxp: 99999, items: { t_butcher: 1 } };
  const keyA = crypto.generateKeyPairSync('ed25519');
  let n = 0; // (each request from an address of its own unless it says which: the per-minute limit stays out of the way)
  const make = (name, device, opt = {}) =>
    call(
      'POST',
      '/api/wallet/create',
      { name, publicKey: opt.key || pk(keyA), device, guest: played },
      opt.tok,
      opt.ip || '10.1.0.' + ++n,
    );
  const sent = () => chain.sent.length;
  let r = await call('GET', '/api/wallet/free?name=Copper');
  ok(r.code === 200 && r.j.accountId === 'copper.near' && r.j.free === true, 'a free name: free (copper.near)');
  r = await call('GET', '/api/wallet/free?name=taken');
  ok(r.code === 200 && r.j.free === false, 'a name in use: not free');
  ok((await call('GET', '/api/wallet/free?name=a.b')).j.error === 'name', 'a name with a dot: not a name');
  ok((await make('copper', undefined)).j?.error === 'guest', 'no device token: refused');
  const forged = dA.replace(/.(?=.$)/, (c) => (c === 'A' ? 'B' : 'A'));
  ok((await make('copper', forged)).j?.error === 'guest', 'a forged device token: refused');
  ok((await make('copper', tok)).j?.error === 'guest', "an account's token as a device token: refused");
  ok((await make('copper', dA, { tok })).j?.error === 'signed_in', 'with a wallet connected: refused');
  ok(
    (await make('copper', dM)).j?.error === 'mission',
    'mission 1 not proven by the device (whatever its page says): refused',
  );
  ok((await make('Copper.cat', dA)).j?.error === 'name', 'a name that is not one: refused');
  ok((await make('copper', dA, { key: 'ed25519:short' })).j?.error === 'key', 'a key that is not one: refused');
  ok((await make('taken', dA)).j?.error === 'taken', 'a name in use: taken');
  ok(sent() === 0, '… and none of these sent anything to the chain');
  chain.mode = 'old';
  r = await make('copper', dA);
  ok(r.code === 503 && r.j.error === 'not_ready', "the server's key not allowed game_wallet yet: not ready");
  chain.mode = 'cap';
  ok((await make('copper', dA)).j?.error === 'limit', "the contract's places used up: limit");
  chain.mode = 'ok';
  r = await make('copper', dA, { ip: '10.0.0.1' });
  const tx = chain.sent[chain.sent.length - 1];
  ok(r.code === 200 && r.j.accountId === 'copper.near', 'a wallet made: copper.near');
  ok(
    tx.signer === ITEMS && tx.receiver === ITEMS && tx.method === 'game_wallet' && tx.args.account_id === 'copper.near',
    '… by game_wallet, signed by the server key on the items contract',
  );
  // (game_wallet needs about 43 Tgas: its run, 30 for the registrar, 10 for its callback; the key's allowance pays the rest)
  ok(tx.gas === 60e12, `… with 60 Tgas attached, not 100 (${tx.gas / 1e12} Tgas)`);
  ok(
    tx.args.public_key === pk(keyA) && /^w-[0-9a-f]{40}$/.test(tx.args.request_id),
    "… with the page's key, a device's id",
  );
  ok((await make('nova', dA)).j?.error === 'once', 'the same device again: once');
  chain.mode = 'lost';
  const keyB = crypto.generateKeyPairSync('ed25519');
  r = await make('nova', dB, { key: pk(keyB), ip: '10.0.0.1' });
  ok(r.code === 200 && r.j.accountId === 'nova.near', 'an answer lost on the way: followed by its hash, made');
  chain.mode = 'ok';
  ok(
    (await make('walt', dC, { ip: '10.0.0.1' })).j?.error === 'limit',
    "a third from one address in a day: the address's cap",
  );
  ok(
    (await make('walt', dC, { ip: '2001:db8:cc:1::1' })).code === 200 &&
      (await make('owl', dE, { ip: '2001:db8:cc:1::2' })).code === 200 &&
      (await make('lark', dF, { ip: '2001:db8:cc:1:ffff::3' })).j?.error === 'limit',
    "… an IPv6 /64 counts as one address: a third from it, the address's cap",
  );
  chain.mode = 'race';
  ok((await make('walter', dD, { ip: '10.0.0.2' })).j?.error === 'taken', 'a name taken meanwhile: taken');
  chain.mode = 'ok';
  ok((await make('walter', dD, { ip: '10.0.0.2' })).code === 409, '… (the race left the name taken)');
  ok((await make('walter2', dD, { ip: '10.0.0.2' })).code === 200, '… and the place came back: another name is made');
  ok((await make('dove', dG, { ip: '10.0.0.3' })).code === 200, 'a sixth wallet today');
  ok((await make('lark', dH, { ip: '10.0.0.4' })).j?.error === 'limit', "a seventh: the day's cap");
  const kept = fs.readFileSync(path.join(tmp, 'wallets.json'), 'utf8');
  ok(
    !/10\.0\.0\.|2001:db8|ed25519:/.test(kept) && !kept.includes(dA.split('.')[0]),
    'the record keeps no address, key or token',
  );
  // the new key signs in like any wallet's, and what the device's record proves goes along (rules.js adopt): not what the
  // page's save claims (99 999 coins and XP), and only once
  const login2 = async (accountId, k, device, ip) => {
    const c = await call('POST', '/api/challenge', {}, undefined, ip);
    return call(
      'POST',
      '/api/login',
      { accountId, publicKey: pk(k), signature: sign(k, c.j.nonce), nonce: c.j.nonce, guest: played, device },
      undefined,
      ip,
    );
  };
  r = await login2('copper.near', keyA, dA, '10.3.0.1');
  ok(
    r.code === 200 &&
      r.j.accountId === 'copper.near' &&
      JSON.stringify(r.j.save.camp) === '["office"]' &&
      r.j.save.coins === 170 &&
      r.j.save.rxp === 400 &&
      r.j.save.items.t_butcher === 1,
    `the new key signs in: the device's proven mission 1, its cleaver, its coins and XP along, not the page's (${r.j?.save?.coins} coins, ${r.j?.save?.rxp} XP)`,
  );
  r = await login2('walt.near', keyA, dA, '10.3.0.2');
  ok(
    r.code === 200 && !r.j.save.camp.length && r.j.save.coins === 0 && !Object.keys(r.j.save.items).length,
    '… once: another new account signing in from that device takes nothing along',
  );
  r = await login2('owl.near', keyA, undefined, '10.3.0.3');
  ok(
    r.code === 200 && !r.j.save.camp.length && r.j.save.coins === 0,
    '… nor one with no device record, whatever its page says',
  );
}
// ---------------- playing together (rooms.mjs): an account's hero from its save, a player with no account's with the
// starting loadout whatever its page says (it can't be checked, and its partner's account is paid from the run)
{
  const url = base.replace(/^http/, 'ws') + '/api/ws';
  const socket = (t) =>
    new Promise((res, rej) => {
      const ws = new WebSocket(url),
        got = [];
      ws.onmessage = (e) => got.push(JSON.parse(e.data));
      ws.onerror = rej;
      ws.onopen = () => {
        ws.send(JSON.stringify({ k: 'hello', rev: SIM.REV, tok: t, nick: 'Tester', ava: 0, bg: 0, rank: 1, rd: 1 }));
        res({ ws, got, send: (m) => ws.send(JSON.stringify(m)) });
      };
    });
  const wait = async (s, f) => {
    for (let i = 0; i < 100; i++) {
      const m = s.got.find(f);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  const MAXED = { meta: { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 3 }, wup: { dmg: 5, rate: 5, mag: 5 } };
  const host = await socket(tok),
    mate = await socket(null);
  await wait(host, (m) => m.k === 'hi');
  await wait(mate, (m) => m.k === 'hi');
  host.send({ k: 'make', open: false, gun: 'pistol', want: { meta: { hp: 1 }, wup: { dmg: 1, mag: 1 } } });
  const room = await wait(host, (m) => m.k === 'room' && m.room);
  mate.send({ k: 'join', code: room.room.code, gun: 'rocket', want: MAXED });
  await wait(host, (m) => m.k === 'room' && m.room && m.room.players.length === 2);
  mate.send({ k: 'ready', on: true });
  await wait(host, (m) => m.k === 'room' && m.room && m.room.players[1] && m.room.players[1].ready);
  host.send({ k: 'start' });
  const go = await wait(mate, (m) => m.k === 'go'),
    h = go && go.run.heroes;
  const zero = (o) => Object.values(o).every((v) => v === 0);
  ok(
    h &&
      h[1].weapon === 'pistol' &&
      zero(h[1].meta) &&
      zero(h[1].wup) &&
      h[0].weapon === 'pistol' &&
      h[0].meta.hp === 1 &&
      h[0].wup.dmg === 1,
    `together: the account's hero from its save, the one with no account on the starting loadout (${JSON.stringify(h)})`,
  );
  host.send({ k: 'quit' });
  mate.send({ k: 'quit' });
  host.ws.close();
  mate.ws.close();
}
// ---------------- static
ok((await call('GET', '/live/index.html')).code === 200, 'static: the game is served');
ok((await call('GET', '/')).code === 302, 'static: / goes to the game');
for (const p of [
  '/server/server.mjs',
  '/server/data/secret',
  '/live/../server/data/secret',
  '/live/%2e%2e/server/server.mjs',
  '/.git/config',
  '/art/style_bible.txt',
  '/gen/runcal.cjs',
])
  ok((await call('GET', p)).code === 404, 'static: ' + p + ' is not served');
srv.close();
rpc.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
process.exit(fails.length ? 1 : 0);
