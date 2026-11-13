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
import fsp from 'node:fs/promises';
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
  signer = crypto.generateKeyPairSync('ed25519'), // (the server's key on the items contract here: made for this run)
  waltKey = crypto.generateKeyPairSync('ed25519'); // (Walt's: market_give only)
const raw = (k) => k.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const seedOf = (k) => k.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
// ---- the stand-in chain: accounts and their keys; the items contract's game_wallet as mainnet runs it, answering by chain.mode:
// 'ok' (made), 'race' (someone took the name meanwhile: the registrar answers false), 'old' (the server's key not allowed
// game_wallet yet), 'cap' (no places left on the contract), 'lost' (made, but the RPC times out and only the tx lookup knows)
const ITEMS = 'items.meowdivision.near';
const chain = {
  accounts: new Map(),
  mode: 'ok',
  sent: [],
  ops: new Set(),
  lost: new Map(),
  mt: new Map(),
  mtops: new Set(),
  height: 100, // (the chain's last block: each transaction runs in a new one; views read at the last one)
  frozen: null, // ({ height, mt }: the views read at that block, as a lagging RPC node would)
};
const WALT_ACC = 'walt.meowdivision.near';
const rpcSeen = []; // (the view calls asked of the stand-in chain, by method)
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
  if (k.permission.FunctionCall && chain.noAllowance === tx.signer)
    return {
      error: {
        name: 'HANDLER_ERROR',
        cause: { name: 'INVALID_TRANSACTION' },
        data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { NotEnoughAllowance: {} } } } },
      },
    };
  const ran = (status) => ({ result: { status, receipts_outcome: [{ block_hash: 'B' + ++chain.height }] } });
  const panic = (why) => ran({ Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: why } } } } });
  // Walt hands his items over (market_give as the contract runs it: only his account, a request id once, from his stock)
  if (method === 'market_give') {
    if (tx.signer !== WALT_ACC) return panic('Smart contract panicked: only Walt');
    const id = 'g:' + args.request_id,
      from = { ...(chain.mt.get(WALT_ACC) || {}) },
      to = { ...(chain.mt.get(args.receiver_id) || {}) };
    if (chain.mtops.has(id)) return ran({ SuccessValue: b64(false) });
    if (args.token_ids.some((t, i) => (from[t] || 0) < +args.amounts[i]))
      return panic('Smart contract panicked: not enough');
    chain.mtops.add(id);
    args.token_ids.forEach((t, i) => {
      from[t] -= +args.amounts[i];
      to[t] = (to[t] || 0) + +args.amounts[i];
    });
    chain.mt.set(WALT_ACC, from);
    chain.mt.set(args.receiver_id, to);
    return ran({ SuccessValue: b64(true) });
  }
  // the items: game_mint / game_burn as the contract runs them (an op id once; a burn of more than is held refused)
  if (method === 'game_mint' || method === 'game_burn') {
    const mint = method === 'game_mint',
      id = mint ? 'm:' + args.run_id : 'b:' + args.op_id,
      owner = mint ? args.receiver_id : args.owner_id,
      held = { ...(chain.mt.get(owner) || {}) };
    if (chain.mtops.has(id)) return ran({ SuccessValue: b64(false) });
    if (
      !mint &&
      ((chain.refuseBurn && owner !== WALT_ACC) || args.token_ids.some((t, i) => (held[t] || 0) < +args.amounts[i]))
    )
      return panic('Smart contract panicked: not enough');
    chain.mtops.add(id);
    args.token_ids.forEach((t, i) => (held[t] = (held[t] || 0) + (mint ? 1 : -1) * +args.amounts[i]));
    chain.mt.set(owner, held);
    return ran({ SuccessValue: b64(true) });
  }
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
  const reply = (x) => res.end(JSON.stringify({ jsonrpc: '2.0', id: 'md', ...x }));
  if (method === 'block')
    return reply({
      result: {
        header:
          params && params.block_id
            ? { hash: params.block_id, height: Number(String(params.block_id).slice(1)) }
            : { hash: N.b58encode(crypto.randomBytes(32)), height: chain.height },
      },
    });
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
  if (params.request_type === 'call_function') rpcSeen.push(params.method_name);
  if (params.request_type === 'call_function' && params.method_name === 'mt_batch_balance_of') {
    const q = JSON.parse(Buffer.from(params.args_base64, 'base64').toString()),
      view = chain.frozen || { height: chain.height, mt: chain.mt },
      held = view.mt.get(q.account_id) || {};
    return reply({
      result: {
        result: [...Buffer.from(JSON.stringify(q.token_ids.map((t) => String(held[t] || 0))))],
        block_height: view.height,
      },
    });
  }
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
// ---- a stand-in NEAR AI Cloud (server/nearai.mjs): what it is asked, with the header and the flags it came with;
// answers a lines task with two lines an item, a note task with a note, anything else (the market watch) with a summary
const aiSeen = [];
const aiCloud = http.createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  const j = JSON.parse(b),
    u = j.messages[j.messages.length - 1].content;
  aiSeen.push({ path: req.url, auth: req.headers.authorization, thinking: j.chat_template_kwargs?.thinking, u });
  const items = /Items: (\[.*\])/.test(u) ? JSON.parse(u.match(/Items: (\[.*\])/)[1]) : [];
  const out = u.startsWith('Task: lines')
    ? Object.fromEntries(items.map((it) => [it.id, [`${it.name}: беру по {buy}.`, `${it.name}: на полке {stock}.`]]))
    : u.startsWith('Task: note')
      ? { note: `Нужны ${items[0].name}, плачу {${items[0].id}.buy}.` }
      : { summary: 'Рынок спокоен.', flags: [] };
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { total_tokens: 200 } }));
});
await new Promise((r) => aiCloud.listen(0, '127.0.0.1', r));
process.env.NEAR_AI_API_KEY = 'test-ai-key';
process.env.NEAR_AI_BASE_URL = `http://127.0.0.1:${aiCloud.address().port}/v1`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-save-'));
process.env.DATA_DIR = tmp;
process.env.NEAR_RPC = `http://127.0.0.1:${rpc.address().port}`;
process.env.REPLAY_WORKERS = '2';
process.env.TRUST_PROXY = '1'; // (the wallet cases come from several addresses: X-Forwarded-For)
process.env.WALLET_DAILY_CAP = '6';
process.env.WALLET_IP_DAILY_CAP = '2';
process.env.WALLET_KEY_WAIT_MS = '2000';
process.env.CHAIN_LAG_MS = '300'; // (a change just made counts as on its way this long: short here)
process.env.CHAIN_MIRROR_MS = '100'; // (Walt's wallet set to his shelf this soon after a trade)
const N = await import('./near.mjs');
process.env.NEAR_SIGNER_KEY = 'ed25519:' + N.b58encode(Buffer.concat([seedOf(signer), raw(signer)]));
process.env.NEAR_WALT_KEY = 'ed25519:' + N.b58encode(Buffer.concat([seedOf(waltKey), raw(waltKey)]));
const S = await import('./server.mjs');
// a promise that fails with nobody waiting for it: the server logs it and stays up (it used to end the process, and every
// run in flight with it); here it is a failure of the test, wherever it comes from
process.on('unhandledRejection', (e) => ok(false, 'no promise fails unseen: ' + ((e && e.message) || e)));
S.SETTLE_WAIT.first = 20; // (a result that could not be written is tried again this soon here)
function pk(k) {
  return 'ed25519:' + N.b58encode(raw(k));
}
addKey('alice.near', pk(full), 'FullAccess');
addKey('alice.near', pk(fcall), { FunctionCall: { allowance: null, receiver_id: 'game.near', method_names: [] } });
addKey(ITEMS, pk(signer), {
  FunctionCall: { allowance: '1000000000000000000000000', receiver_id: ITEMS, method_names: ['game_wallet'] },
});
addKey('taken.near', pk(stranger), 'FullAccess');
addKey(WALT_ACC, pk(waltKey), {
  FunctionCall: { allowance: '250000000000000000000000', receiver_id: ITEMS, method_names: ['market_give'] },
});
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
// (let: the last cases stop the server and start it again)
let srv = await S.start(0, '127.0.0.1'),
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
  // a challenge leaves nothing on the server: its nonce carries its own expiry and the server's seal (an HMAC with
  // DATA/secret), so a network may ask for any number of them and each still signs in, once. One the server never made,
  // one with its expiry moved, one expired: refused; a wrong signature over a good one does not use it up
  const ip = '2001:db8:bb:1::9',
    ip2 = '2001:db8:bb:2::9',
    got = [];
  for (let i = 0; i < 21; i++) got.push((await call('POST', '/api/challenge', {}, undefined, ip)).j.nonce);
  const use = (nonce, k = full, from = ip2) =>
    call(
      'POST',
      '/api/login',
      { accountId: 'alice.near', publicKey: pk(k), signature: sign(k, nonce), nonce },
      undefined,
      from,
    );
  const first = await use(got[0], full, ip),
    last = await use(got[20], full, ip),
    again = await use(got[0], full, ip);
  ok(
    first.code === 200 &&
      last.code === 200 &&
      new Set(got).size === 21 &&
      got.every((n) => Buffer.from(n, 'base64').length === 32),
    `every one of 21 challenges from one network still signs in, the first as the last (${first.code} ${last.code}): 32 bytes each, as NEP-413 signs`,
  );
  ok(again.code === 401 && again.j.error === 'unknown or expired nonce', '… each of them once');
  const secret = fs.readFileSync(path.join(tmp, 'secret')),
    sealed = (secs) => {
      const head = Buffer.alloc(16);
      crypto.randomBytes(12).copy(head);
      head.writeUInt32BE(Math.floor(Date.now() / 1000) + secs, 12);
      const mac = crypto.createHmac('sha256', secret).update('nonce').update(head).digest().subarray(0, 16);
      return Buffer.concat([head, mac]).toString('base64');
    },
    later = Buffer.from(got[1], 'base64');
  later.writeUInt32BE(later.readUInt32BE(12) + 3600, 12);
  const bad = [
    await use(crypto.randomBytes(32).toString('base64')),
    await use(later.toString('base64')),
    await use(sealed(-5)),
    await use(got[3].slice(0, 20)),
  ];
  ok(
    bad.every((r) => r.code === 401 && r.j.error === 'unknown or expired nonce') &&
      (await use(sealed(60))).code === 200,
    `a nonce the server never made, one with its expiry moved, an expired one, a cut one: refused (${bad.map((r) => r.code)}); the seal is what is checked`,
  );
  const wrong = await call(
    'POST',
    '/api/login',
    { accountId: 'alice.near', publicKey: pk(full), signature: sign(stranger, got[2]), nonce: got[2] },
    undefined,
    ip2,
  );
  ok(
    wrong.code === 401 && wrong.j.error === 'bad signature' && (await use(got[2])).code === 200,
    'a wrong signature over a nonce does not use it up (only a good one does)',
  );
}

// ---------------- progress: only through the rules
ok((await call('PUT', '/api/save', { save: { coins: 1e9 } }, tok)).code === 410, 'a save sent by the page: refused');
ok((await call('GET', '/api/save', undefined, tok)).j?.save?.coins === 0, '… the coins stay 0');
// coins and the like for the test, the way an admin would (on disk)
const edit = (f) => {
  const rec = JSON.parse(fs.readFileSync(accFile, 'utf8'));
  f(rec);
  fs.writeFileSync(accFile, JSON.stringify(rec));
};
// (the guns' upgrades need the base's workbench standing, the cat's its medbay: rules.js up, meta)
edit((rec) => {
  rec.save.base = { lv: { generator: 1, workbench: 1, medbay: 1 }, bt: {}, clr: {}, gift: [] };
});
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
// coins for the test: then buying works and costs
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
// (REV 44) level 2 takes its items too: refused without them, the stash's spent with them
edit((rec) => {
  rec.save.mast = { ...(rec.save.mast || {}), pistol: 1e6 };
});
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'mag' } }, tok);
ok(r.code === 409 && r.j.error === 'items', "an upgrade's level 2 without its items: refused");
edit((rec) => {
  rec.save.items = { ...(rec.save.items || {}), tape: 1 };
  rec.save.coins = 1000;
  rec.save.mast = { ...(rec.save.mast || {}), pistol: 1e6 };
});
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'mag' } }, tok);
ok(
  r.code === 200 && r.j.save.wup.pistol.mag === 2 && !(r.j.save.items || {}).tape,
  "an upgrade's level 2 with its items: bought, the item spent",
);
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
// ---------------- Walt's words by NEAR AI (the stand-in): made in the background, handed out with his shelf; the
// numbers are slots the page fills from the formula. The market watch: the day's trades written down
{
  const w0 = (await call('GET', '/api/walt?lang=ru')).j;
  await S.WALTAI.settled();
  const w1 = (await call('GET', '/api/walt?lang=ru')).j;
  const texts = [...Object.values(w1.lines || {}).flatMap((l) => l.t), w1.note?.t || ''];
  ok(
    w0.pending === true &&
      w1.pending === false &&
      /^Шестерёнки: беру по \{buy\}\.$/.test(w1.lines.gears?.t[0]) &&
      /\{\w+\.buy\}/.test(w1.note?.t) &&
      texts.every((t) => !/\d/.test(t.replace(/\{[^}]*\}/g, ''))),
    `Walt's words: made in the background in Russian, slots for the numbers (${JSON.stringify(w1.note)})`,
  );
  ok(
    aiSeen.length >= 2 &&
      aiSeen.every((x) => x.path === '/v1/chat/completions' && x.auth === 'Bearer test-ai-key' && x.thinking === false),
    'NEAR AI: asked with the key in the header, thinking off',
  );
  ok((await call('GET', '/api/health')).j?.ai === 'deepseek-ai/DeepSeek-V4.1-Flash-1017', 'health: the model named');
  await S.WATCH.flushed();
  const day = await S.WATCH.sums(new Date().toISOString().slice(0, 10));
  ok(
    day.accounts.some((x) => x.acc === 'alice.near' && x.sold >= 2 && x.coinsIn > 0),
    "the market watch: alice's sale written down with its coins",
  );
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

// what the town's final boss learnt from alice's fights (server/bossmind.mjs, SIM.MIND; the lab's knowing nothing:
// test/bossmind.test.mjs): his pick in the ticket, Nova's line in the page's language, the replay played with it
edit((rec) => {
  rec.boss = {
    golem: {
      n: 1,
      fights: [],
      mind: { tac: ['rings', 'rush', 'bogus'], side: -1, say: { ru: 'Коппер, он запомнил твой шаг.' }, by: 'ai' },
    },
  };
});
let t1 = (await call('POST', '/api/run/start', { weapon: 'rocket', rev: SIM.REV, lang: 'ru' }, tok)).j;
ok(
  t1 &&
    t1.id &&
    [7, 8, 9, 10, 11].includes(t1.seed) &&
    Number.isInteger(t1.rs) &&
    Number.isInteger(t1.rank) &&
    !('meta' in t1),
  "a ticket: the server's seeds and the account's rank, for one run",
);
const kept = JSON.parse(fs.readFileSync(accFile, 'utf8')).open.find((x) => x.id === t1.id);
ok(
  JSON.stringify(t1.mind) ===
    JSON.stringify({ k: 'golem', tac: ['rings', 'rush'], side: -1, say: 'Коппер, он запомнил твой шаг.' }) &&
    JSON.stringify(kept.mind) === JSON.stringify({ k: 'golem', tac: ['rings', 'rush'], side: -1 }),
  `the final boss's mind in the ticket, Nova's line in the page's language (${JSON.stringify(t1.mind)})`,
);
backdate(t1.id, 130);
const honest = playRun(t1, 120, false, { ...KIT, mind: t1.mind }), // (the page plays it with the boss's mind, as the replay does)
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
// a device token is free, so a request with one the server never saw leaves no file behind, whatever it asks; and the
// sends of runs (megabytes each, read on the main thread) are counted for a device and for a network
{
  const ip = '10.2.7.1',
    gd = await gdev(ip),
    codes = [];
  codes.push((await call('GET', '/api/run/nosuchrun', undefined, gd, ip)).code);
  codes.push((await call('POST', '/api/run/start', { rev: SIM.REV, map: 'suburb' }, gd, ip)).j?.error);
  for (let i = 0; i < 13; i++)
    codes.push((await call('POST', '/api/run/end', { id: 'nosuchrun', n: 10, log: [] }, gd, ip)).code);
  ok(
    codes[0] === 404 && codes[1] === 'mission' && !fs.existsSync(gfile(gd)),
    `a device token never seen before asks for a run's result, a ticket it can't have, sends runs: no record written (${codes.slice(0, 3)})`,
  );
  ok(
    codes.slice(2, 14).every((c) => c === 404) && codes[14] === 429,
    `12 sends of a run a minute from one device, the 13th slowed down (${codes[13]} ${codes[14]})`,
  );
  const gd2 = await gdev(ip),
    gd3 = await gdev(ip);
  for (let i = 0; i < 12; i++)
    codes.push((await call('POST', '/api/run/end', { id: 'x', n: 1, log: [] }, gd2, ip)).code);
  codes.push((await call('POST', '/api/run/end', { id: 'x', n: 1, log: [] }, gd3, ip)).code);
  ok(
    codes[26] === 404 && codes[27] === 429 && !fs.existsSync(gfile(gd2)),
    `… and 24 a minute from one network, whatever the devices (${codes[26]} ${codes[27]})`,
  );
}
// a run's body is refused by its declared length before a byte of it is read, and the cap follows the ticket: a ticket
// seconds old can't have megabytes of inputs. The workers' time is shared: a sender whose runs already asked for four
// hours of steps this hour is told to wait, its ticket kept; the others' runs go on
{
  const ip = '10.2.7.2',
    gd = await gdev(ip),
    gt = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'office', map: 'office', rank: 1 }, gd, ip)).j;
  const declared = (bytes) =>
    new Promise((done) => {
      const rq = http.request(
        base + '/api/run/end',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + gd,
            'x-forwarded-for': ip,
            'content-length': bytes,
          },
        },
        (rs) => {
          rs.resume();
          done(rs.statusCode);
          rq.destroy();
        },
      );
      rq.on('error', () => done(0));
      rq.flushHeaders(); // (the headers alone: the answer must come before any of the body)
    });
  const early = await declared(2 << 20);
  ok(early === 413, `a run's body declared at 2 MB for a ticket seconds old: refused before it is read (${early})`);
  gedit(gd, (rec) => {
    rec.open[0].t0 = Date.now() - 40e3;
  });
  const HOUR = 3600 * 120;
  ok(S.REPLAY_BUDGET.spend('n ' + ip, 4 * HOUR - 100), '(four hours of steps but 100 asked for from this network)');
  let r = await call('POST', '/api/run/end', { id: gt.id, n: 600, log: [] }, gd, ip);
  const open = JSON.parse(fs.readFileSync(gfile(gd), 'utf8')).open;
  ok(
    r.code === 429 && r.j.error === 'too many runs' && open.length === 1 && open[0].id === gt.id,
    `a network past its hour's replay budget: its next run waits (${r.code} ${r.j && r.j.error}), the ticket kept`,
  );
  r = await call('POST', '/api/run/end', { id: gt.id, n: 60, log: [] }, gd, ip);
  let gr = null;
  for (let i = 0; i < 40 && !(gr && gr.done); i++) gr = (await call('GET', '/api/run/' + gt.id, undefined, gd, ip)).j;
  ok(r.code === 202 && gr && gr.done && !gr.error, `… a run within what is left is taken and played (${r.code})`);
}
// a write of the record that fails (the disk full): the run just sent is queued all the same (its job is on disk first),
// its result is written at the next try, once, and nothing ends the server
{
  const ip = '10.2.7.4',
    gd = await gdev(ip),
    gt = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'office', map: 'office', rank: 1 }, gd, ip)).j;
  gedit(gd, (rec) => {
    rec.open[0].t0 = Date.now() - 40e3;
  });
  const rename = fsp.rename,
    target = gfile(gd);
  let failed = 0;
  fsp.rename = (from, to) =>
    to === target && failed < 2
      ? Promise.reject(
          Object.assign(new Error('ENOSPC: no space left on device (the test)'), { code: 'ENOSPC', n: ++failed }),
        )
      : rename(from, to);
  const quiet = console.error;
  console.error = () => {}; // (the two failures are logged in full: not this test's output)
  const r = await call('POST', '/api/run/end', { id: gt.id, n: 60, log: [] }, gd, ip);
  let gr = null;
  for (let i = 0; i < 40 && !(gr && gr.done); i++) gr = (await call('GET', '/api/run/' + gt.id, undefined, gd, ip)).j;
  console.error = quiet;
  fsp.rename = rename;
  const kept = JSON.parse(fs.readFileSync(target, 'utf8'));
  ok(
    r.code === 202 &&
      failed === 2 &&
      gr &&
      gr.done &&
      kept.recent.filter((x) => x.id === gt.id).length === 1 &&
      !kept.open.length &&
      !fs.existsSync(path.join(tmp, 'jobs', gt.id + '.json')) &&
      (await call('GET', '/api/health')).code === 200,
    `the record's write failing twice (as the ticket closes, as the result lands): the run queued (${r.code}), settled once at the next try, the server up`,
  );
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
  // an account made before the page's purchases came along (no adopt mark, as those of 2026-11-12): signing in again from the
  // device's guest page adds them once (rules.js topUp) — here a heap the page cleared, free — its coins kept; then no more
  const accDir = path.join(tmp, 'accounts'),
    cf = fs
      .readdirSync(accDir)
      .map((f) => path.join(accDir, f))
      .find((f) => JSON.parse(fs.readFileSync(f, 'utf8')).account === 'copper.near'),
    was = JSON.parse(fs.readFileSync(cf, 'utf8'));
  ok(was.adopt === 2, 'a new account is marked as having taken the purchases along');
  delete was.adopt;
  fs.writeFileSync(cf, JSON.stringify(was));
  const login3 = async (guest, ip) => {
    const c = await call('POST', '/api/challenge', {}, undefined, ip);
    return call(
      'POST',
      '/api/login',
      {
        accountId: 'copper.near',
        publicKey: pk(keyA),
        signature: sign(keyA, c.j.nonce),
        nonce: c.j.nonce,
        guest,
        device: dA,
      },
      undefined,
      ip,
    );
  };
  const t0 = Date.now() - 60000;
  r = await login3({ ...played, base: { lv: {}, bt: {}, clr: { alcove: t0 }, gift: [] } }, '10.3.0.4');
  ok(
    r.code === 200 && r.j.save.base.clr.alcove === t0 && r.j.save.coins === 170,
    `an account from before: signing in again from the device's guest page adds what the page did (a heap cleared), its coins kept (${r.j?.save?.coins})`,
  );
  r = await login3({ ...played, base: { lv: {}, bt: {}, clr: { alcove: t0, storage: t0 }, gift: [] } }, '10.3.0.5');
  ok(r.code === 200 && !r.j.save.base.clr.storage, '… once');
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
// ---------------- items on the wallet (server/chain.mjs): sent by the server's key, the stash set to the wallet; Walt's
// shelf on his own wallet, his purchases handed over by his own key
{
  const wait = async (f, ms = 8000) => {
    for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 50)))
      if (await f()) return true;
    return false;
  };
  const held = () => chain.mt.get('alice.near') || {},
    walt = () => chain.mt.get(WALT_ACC) || {},
    calls = ['game_mint', 'game_burn', 'market_give'],
    sends = () =>
      chain.sent.filter(
        (x) => calls.includes(x.method) && (x.args.receiver_id === 'alice.near' || x.args.owner_id === 'alice.near'),
      ),
    toWalt = () =>
      chain.sent.filter(
        (x) => calls.includes(x.method) && (x.args.receiver_id === WALT_ACC || x.args.owner_id === WALT_ACC),
      ),
    shelf = async () => (await call('GET', '/api/walt')).j,
    // (Walt's wallet as his shelf: every item the same count)
    same = (st, w) =>
      [...new Set([...Object.keys(st), ...Object.keys(w)])].every((id) => (st[id] || 0) === (w[id] || 0));
  edit((rec) => {
    rec.save.items = { gears: 3, tape: 1 };
    rec.save.coins = 5000;
    delete rec.chain;
  });
  let r = await call('GET', '/api/save', undefined, tok);
  ok(
    !sends().length &&
      !toWalt().length &&
      (await call('GET', '/api/chain', undefined, tok)).j.on === false &&
      (await shelf()).wallet === null &&
      r.j.save.items.gears === 3,
    'items on the wallet: off until CHAIN_ITEMS=1 (nothing sent, the stash as it was, no wallet for Walt)',
  );
  S.CHAIN.enable(true);
  S.CHAIN.keep(0); // (the cases below move items on the stand-in chain by hand: every look reads the wallet anew)
  r = await call('GET', '/api/save', undefined, tok);
  await wait(() => S.CHAIN.idle());
  const first = sends()[0];
  ok(
    held().gears === 3 &&
      held().tape === 1 &&
      first.method === 'game_mint' &&
      first.signer === 'items.meowdivision.near' &&
      first.args.receiver_id === 'alice.near' &&
      first.args.run_id === 'sync-alice.near' &&
      first.gas <= 6e12 &&
      r.j.save.items.gears === 3,
    `the first look at an account sends its stash to its wallet, by the server's key, one call (${JSON.stringify(held())})`,
  );
  let w = await shelf();
  ok(
    w.wallet === WALT_ACC &&
      Object.keys(w.stock).length > 5 &&
      same(w.stock, walt()) &&
      toWalt().length === 1 &&
      toWalt()[0].method === 'game_mint' &&
      toWalt()[0].signer === ITEMS &&
      toWalt()[0].gas < 20e12,
    `Walt's wallet holds his shelf: one mint by the game's key (${Object.keys(walt()).length} kinds)`,
  );
  r = await call('GET', '/api/save', undefined, tok);
  await wait(() => S.CHAIN.idle());
  ok(sends().length === 1 && toWalt().length === 1, 'the next look sends nothing again');
  const w0 = walt().gears || 0;
  r = await call('POST', '/api/act', { a: { k: 'sell', id: 'gears', n: 2 } }, tok);
  await wait(() => S.CHAIN.idle());
  const burn = sends()[1];
  ok(
    r.code === 200 &&
      held().gears === 1 &&
      burn.method === 'game_burn' &&
      burn.args.owner_id === 'alice.near' &&
      burn.args.amounts[0] === '2' &&
      walt().gears === w0 + 2 &&
      toWalt().length === 2 &&
      toWalt()[1].method === 'game_mint' &&
      same((await shelf()).stock, walt()),
    "a sale to Walt takes the items off the wallet; his wallet gets them at its next look (his shelf's count)",
  );
  r = await call('POST', '/api/act', { a: { k: 'wbuy', id: 'gears', n: 1 } }, tok);
  await wait(() => S.CHAIN.idle());
  const give = sends()[2];
  // (read right after it, the view already past the purchase's block: counted once, not as on its way too)
  const now = (await call('GET', '/api/save', undefined, tok)).j.save,
    pendNow = (await call('GET', '/api/chain', undefined, tok)).j.pend;
  ok(
    r.code === 200 &&
      held().gears === 2 &&
      give.method === 'market_give' &&
      give.signer === WALT_ACC &&
      give.args.receiver_id === 'alice.near' &&
      give.gas <= 6e12 &&
      walt().gears === w0 + 1 &&
      toWalt().length === 2 &&
      same((await shelf()).stock, walt()) &&
      now.items.gears === 2 &&
      !Object.keys(pendNow).length,
    `a purchase from Walt: he hands it over from his wallet with his own key; the stash counts it once, not on its way (${now.items.gears}, ${JSON.stringify(pendNow)})`,
  );
  // a view behind the purchase's block (a lagging RPC node): the purchase counts as on its way, once
  chain.frozen = { height: chain.height, mt: new Map([...chain.mt].map(([k, v]) => [k, { ...v }])) };
  r = await call('POST', '/api/act', { a: { k: 'wbuy', id: 'gears', n: 1 } }, tok);
  await wait(() => S.CHAIN.idle());
  const behind = (await call('GET', '/api/save', undefined, tok)).j.save.items.gears;
  chain.frozen = null;
  const past = (await call('GET', '/api/save', undefined, tok)).j.save.items.gears;
  ok(
    r.code === 200 && held().gears === 3 && behind === 3 && past === 3,
    `a view behind the purchase's block counts it as on its way; one past it doesn't count it twice (${behind}, ${past})`,
  );
  // Walt's wallet short of what his shelf sells (a trade the mirror hasn't caught up with): the game's key mints it
  w = await shelf();
  const odd = Object.keys(w.stock).find((id) => id !== 'gears' && w.stock[id] > 0 && !held()[id]);
  chain.mt.set(WALT_ACC, { ...walt(), [odd]: 0 });
  r = await call('POST', '/api/act', { a: { k: 'wbuy', id: odd, n: 1 } }, tok);
  await wait(() => S.CHAIN.idle());
  const [refused, minted] = sends().slice(-2);
  ok(
    r.code === 200 &&
      held()[odd] === 1 &&
      refused.method === 'market_give' &&
      minted.method === 'game_mint' &&
      minted.signer === ITEMS &&
      minted.args.run_id.startsWith('gm-') &&
      same((await shelf()).stock, walt()) &&
      (await call('GET', '/api/save', undefined, tok)).j.save.items[odd] === 1,
    `a purchase Walt's wallet can't hand over (${odd}) is minted by the game's key; his wallet set to his shelf again`,
  );
  // his key out of allowance: no retries, minted at once the same way
  chain.noAllowance = WALT_ACC;
  r = await call('POST', '/api/act', { a: { k: 'wbuy', id: 'gears', n: 1 } }, tok);
  await wait(() => S.CHAIN.idle());
  chain.noAllowance = null;
  const last2 = sends().slice(-2);
  ok(
    r.code === 200 &&
      held().gears === 4 &&
      last2[0].method === 'market_give' &&
      last2[1].method === 'game_mint' &&
      same((await shelf()).stock, walt()),
    "Walt's key out of allowance: his purchase minted by the game's key at once",
  );
  // the player sends the tape to a friend from the wallet itself: the stash follows the wallet
  await new Promise((ok) => setTimeout(ok, 400)); // (past CHAIN_LAG_MS)
  chain.mt.set('alice.near', { ...held(), tape: 0 });
  r = await call('GET', '/api/save', undefined, tok);
  ok(!r.j.save.items.tape && r.j.save.items.gears === 4, 'items moved off the wallet leave the stash too');
  // a sale of what was just sent away from the wallet: the stash follows the wallet first, the sale is refused
  chain.mt.set('alice.near', { ...held(), gears: 0 });
  r = await call('POST', '/api/act', { a: { k: 'sell', id: 'gears', n: 1 } }, tok);
  ok(
    r.code === 409 && r.j.error === 'not enough' && !r.j.save.items.gears,
    'items sent away from the wallet cannot be sold too',
  );
  // a sale the wallet refuses all the same (sent away between the look and the burn): its coins taken back
  chain.mt.set('alice.near', { ...held(), gears: 2 });
  await new Promise((ok) => setTimeout(ok, 400));
  chain.refuseBurn = true;
  // (one coin short of the next upgrade: only the sale's coins would pay for it)
  const lvl = (await call('GET', '/api/save', undefined, tok)).j.save.meta.speed || 0,
    price = D.META.speed.price[lvl];
  edit((rec) => {
    rec.save.coins = price - 1;
  });
  const c0 = (await call('GET', '/api/save', undefined, tok)).j.save.coins,
    g0 = (await shelf()).stock.gears || 0;
  r = await call('POST', '/api/act', { a: { k: 'sell', id: 'gears', n: 1 } }, tok);
  const paid = r.j.save.coins - c0;
  // spent at once: the purchase waits for the sale's burn (refused: its coins back first), so it can't spend them
  const bought = await call('POST', '/api/act', { a: { k: 'meta', s: 'speed' } }, tok);
  await wait(() => S.CHAIN.idle());
  await new Promise((ok) => setTimeout(ok, 400));
  const after = (await call('GET', '/api/save', undefined, tok)).j.save;
  chain.refuseBurn = false;
  ok(
    r.code === 200 &&
      paid > 0 &&
      c0 + paid >= price &&
      bought.code === 409 &&
      bought.j.error === 'coins' &&
      (after.meta.speed || 0) === lvl &&
      after.coins === c0 &&
      after.items.gears === 2 &&
      ((await shelf()).stock.gears || 0) === g0,
    `a sale the wallet refuses: its ${paid} coins taken back before a purchase could spend them, the stash as the wallet holds it, Walt's shelf as before (${after.coins} vs ${c0}, the purchase ${bought.code})`,
  );
  // the same at once: a purchase sent together with the sale never spends its coins
  chain.refuseBurn = true;
  edit((rec) => {
    rec.save.coins = price - 1;
  });
  const both = await Promise.all([
    call('POST', '/api/act', { a: { k: 'meta', s: 'speed' } }, tok),
    call('POST', '/api/act', { a: { k: 'sell', id: 'gears', n: 1 } }, tok),
    call('POST', '/api/act', { a: { k: 'meta', s: 'speed' } }, tok),
  ]);
  await wait(() => S.CHAIN.idle());
  await new Promise((ok) => setTimeout(ok, 400));
  const end = (await call('GET', '/api/save', undefined, tok)).j.save;
  chain.refuseBurn = false;
  ok(
    (end.meta.speed || 0) === lvl && end.coins === price - 1,
    `a purchase sent at the same moment as a refused sale doesn't spend its coins (${both.map((x) => x.code)}; ${end.coins})`,
  );
  await S.CHAIN.mirror();
  await wait(() => S.CHAIN.idle());
  ok(same((await shelf()).stock, walt()), "after all of it Walt's wallet holds his shelf");
  const st = (await call('GET', '/api/chain', undefined, tok)).j;
  ok(
    st.on &&
      st.ops.every((o) => (o.st === 'done' && o.tx) || o.st === 'fail') &&
      st.ops.filter((o) => o.st === 'fail').length === 4 &&
      st.ops.some((o) => o.k === 'give' && o.st === 'done') &&
      st.ops[st.ops.length - 1].ops[0] === 'sync-alice.near',
    "the page sees each change done, with its transaction's hash",
  );
  // the page's looks share one read of the wallet for a couple of seconds (every open page asks again and again)
  S.CHAIN.keep(2500);
  const views = () => rpcSeen.filter((m) => m === 'mt_batch_balance_of').length,
    v0 = views();
  await Promise.all([
    call('GET', '/api/save', undefined, tok),
    call('GET', '/api/chain', undefined, tok),
    call('GET', '/api/save', undefined, tok),
  ]);
  await call('GET', '/api/chain', undefined, tok);
  ok(views() - v0 === 1, `four looks at the stash in a row: the wallet read once (${views() - v0})`);
  S.CHAIN.keep(0);
  S.CHAIN.enable(false);
}
// ---------------- static
ok((await call('GET', '/live/index.html')).code === 200, 'static: the game is served');
ok((await call('GET', '/')).code === 302, 'static: / goes to the game');
{
  // a co-op invite link keeps its room through the redirect
  const r = await fetch(base + '/live/?room=AB12&lang=es', { redirect: 'manual' });
  ok(
    r.status === 302 && r.headers.get('location') === '/live/index.html?room=AB12&lang=es',
    `static: /live/?room= keeps its query (${r.status} ${r.headers.get('location')})`,
  );
  ok(
    (await fetch(base + '/live/', { redirect: 'manual' })).headers.get('location') === '/live/index.html',
    'static: /live/ with no query goes to the plain page',
  );
}
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
// ---------------- a stop of the server at the worst moments, and a start on what it left
// A run's job file is written before its ticket is closed, so a stop between the two leaves a job beside a ticket still
// open: the next start plays it, closes the ticket and pays once. A file a write cut short is swept. A queued run whose
// account's file is broken on disk is set aside (DATA/jobs-aside) for a human; the server starts and serves all the same
{
  const ip = '10.2.7.3',
    gd = await gdev(ip),
    gt = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'office', map: 'office', rank: 1 }, gd, ip)).j;
  gedit(gd, (rec) => {
    rec.open[0].t0 = Date.now() - 40e3;
  });
  const rec = JSON.parse(fs.readFileSync(gfile(gd), 'utf8')),
    job = (id, account) => ({
      id,
      account,
      by: 'n ' + ip,
      ticket: { ...rec.open[0], id, ...KIT },
      n: 60,
      log: [],
      hash: '',
      at: Date.now(),
    }),
    jobs = path.join(tmp, 'jobs'),
    broken = path.join(tmp, 'accounts', hashA('broken.near') + '.json');
  await new Promise((r) => srv.close(r));
  fs.writeFileSync(path.join(jobs, gt.id + '.json'), JSON.stringify(job(gt.id, rec.account)));
  fs.writeFileSync(path.join(jobs, 'cutshort.json.0a1b2c3d'), '{"id":"cutshort","acc');
  fs.writeFileSync(path.join(jobs, 'brokenrun.json'), JSON.stringify(job('brokenrun', 'broken.near')));
  fs.writeFileSync(broken, '{"v":2,"account":"broken.near","save":{"coi');
  const quiet = console.error;
  console.error = () => {}; // (the broken account's three tries are logged in full: not this test's output)
  srv = await S.start(0, '127.0.0.1');
  base = `http://127.0.0.1:${srv.address().port}`;
  let gr = null;
  for (let i = 0; i < 40 && !(gr && gr.done); i++) gr = (await call('GET', '/api/run/' + gt.id, undefined, gd, ip)).j;
  const aside = path.join(tmp, 'jobs-aside', 'brokenrun.json');
  for (let i = 0; i < 200 && !fs.existsSync(aside); i++) await new Promise((r) => setTimeout(r, 50));
  console.error = quiet;
  const kept = JSON.parse(fs.readFileSync(gfile(gd), 'utf8')),
    resent = await call('POST', '/api/run/end', { id: gt.id, n: 60, log: [] }, gd, ip);
  ok(
    gr &&
      gr.done &&
      !gr.error &&
      kept.recent.filter((x) => x.id === gt.id).length === 1 &&
      kept.save.stats.runs === 1 &&
      !kept.open.length &&
      resent.code === 404,
    `a stop between a run's job file and its ticket's close: played at the next start, paid once, the ticket closed (sent again: ${resent.code})`,
  );
  ok(
    !fs.existsSync(path.join(jobs, 'cutshort.json.0a1b2c3d')) && !fs.existsSync(path.join(jobs, gt.id + '.json')),
    '… a job file a write cut short is swept at the start; the played job is gone from the queue',
  );
  ok(
    fs.existsSync(aside) &&
      !fs.existsSync(path.join(jobs, 'brokenrun.json')) &&
      fs.readFileSync(broken, 'utf8').startsWith('{"v":2,"account":"broken.near","save":{"coi') &&
      (await call('GET', '/api/health')).code === 200,
    'a queued run of an account whose file is broken on disk: set aside in jobs-aside, the file left as found, the server up',
  );
}
srv.close();
rpc.close();
aiCloud.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
process.exit(fails.length ? 1 : 0);
