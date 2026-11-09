// scripts/chain-launch.mjs — the items contract's mainnet launch as one page: the human connects the wallet of
// meowdivision.near and approves two prompts there; this helper does the rest (contract/mainnet/DEPLOY.md, same steps).
//   1. wallet (page): create items.meowdivision.near (5.5 NEAR) and walt.meowdivision.near (0.5 NEAR), each with its own
//      full-access key made here, and Walt's server key (market_give only, 0.25 NEAR of gas)
//   2. helper: deploy the wasm with its init call, then add the game server's key to the items account (game_mint and
//      game_burn only, 1 NEAR of gas), both signed by the items account's own key
//   3. wallet (page): register_tokens and set_recipes (owner calls, 1 yoctoNEAR each)
//   4. helper: the two server keys into /etc/meow-division.env on the server, the service restarted
//   5. read-only checks
// Keys are made on this PC in ~/meow-keys (outside the repository) and never printed or sent to the page: the page gets
// public keys only. The full-access keys of the two new accounts stay there; the function-call keys go to the server.
// meowdivision.near's own key never leaves the human's wallet.
//   node scripts/chain-launch.mjs        → http://127.0.0.1:8960/
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'contract', 'mainnet');
const WASM = path.join(ROOT, 'contract', 'target', 'near', 'meow_division_items.wasm');
const WASM_SHA256 = '7851701ac22688685fd3e2d716a63e1992a746f7805d97f5c23101a5cd6c7d0e'; // the build DEPLOY.md checked
const KEYS = path.join(os.homedir(), 'meow-keys');
const PORT = 8960;
const RPCS = ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org'];
const HOST = process.env.MEOW_HOST || 'root@46.224.42.60';
const SSH_KEY = process.env.MEOW_KEY || path.join(os.homedir(), '.ssh', 'parix_codex');
const NEAR = 10n ** 24n;
const A = {
  game: 'meowdivision.near',
  items: 'items.meowdivision.near',
  walt: 'walt.meowdivision.near',
};
const AMOUNT = { items: (55n * NEAR) / 10n, walt: NEAR / 2n }; // DEPLOY.md: 5.5 and 0.5
const ALLOW = { game: NEAR, walt: NEAR / 4n }; // the function-call keys' gas allowances

// ---- keys: ed25519 pairs in NEAR's text form, kept as near-cli access-key files
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let s = '';
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
function newPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return { public_key: 'ed25519:' + b58(pub), private_key: 'ed25519:' + b58(Buffer.concat([seed, pub])) };
}
// name → the account it signs for: the two new accounts' full-access keys, the server's two function-call keys
const KEYFILES = { items: A.items, walt: A.walt, game: A.items, waltfc: A.walt };
function keys() {
  fs.mkdirSync(KEYS, { recursive: true });
  const out = {};
  for (const [name, account] of Object.entries(KEYFILES)) {
    const f = path.join(KEYS, name + '.json');
    if (!fs.existsSync(f))
      fs.writeFileSync(f, JSON.stringify({ account_id: account, ...newPair() }, null, 2), { mode: 0o600 });
    const k = JSON.parse(fs.readFileSync(f, 'utf8'));
    out[name] = { file: f, public_key: k.public_key, private_key: k.private_key };
  }
  return out;
}

// ---- the chain, read only
async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.error) {
        const cause = j.error.cause && j.error.cause.name;
        if (cause === 'UNKNOWN_ACCOUNT' || cause === 'NO_CONTRACT_CODE' || cause === 'CONTRACT_EXECUTION_ERROR')
          return { missing: cause };
        last = new Error(JSON.stringify(j.error).slice(0, 300));
        continue;
      }
      return j.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const view = (account_id) => rpc('query', { request_type: 'view_account', finality: 'final', account_id });
const keyList = (account_id) => rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id });
async function call(method, args = {}) {
  const r = await rpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: A.items,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  if (!r || r.missing || !r.result) return null;
  return JSON.parse(Buffer.from(r.result).toString('utf8'));
}
const near = (yocto) => (Number(BigInt(yocto) / 10n ** 20n) / 1e4).toFixed(2);

// what is on chain and on the server now; each step is done when its result is there
async function state() {
  const K = keys();
  const wasm = fs.existsSync(WASM) ? fs.readFileSync(WASM) : null;
  const sha = wasm ? crypto.createHash('sha256').update(wasm).digest('hex') : '';
  let argsOk = true;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'gen', 'chainargs.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    argsOk = false;
  }
  const [game, items, walt] = await Promise.all([view(A.game), view(A.items), view(A.walt)]);
  const has = (acc) => acc && !acc.missing;
  const ik = has(items) ? await keyList(A.items) : { keys: [] };
  const wk = has(walt) ? await keyList(A.walt) : { keys: [] };
  const on = (list, pk) => (list.keys || []).some((k) => k.public_key === pk);
  const deployed =
    has(items) &&
    items.code_hash ===
      b58(
        crypto
          .createHash('sha256')
          .update(wasm || '')
          .digest(),
      );
  const tokens = deployed ? await call('mt_tokens', {}) : null;
  const recipes = deployed ? await call('recipes', {}) : null;
  const config = deployed ? await call('config', {}) : null;
  const want = JSON.parse(fs.readFileSync(path.join(MAIN, 'register_tokens.json'), 'utf8'));
  const wantR = JSON.parse(fs.readFileSync(path.join(MAIN, 'set_recipes.json'), 'utf8'));
  const nTok = (want.tokens || []).length,
    nRec = (wantR.recipes || []).length;
  return {
    accounts: A,
    publicKeys: {
      items: K.items.public_key,
      walt: K.walt.public_key,
      game: K.game.public_key,
      waltfc: K.waltfc.public_key,
    },
    amounts: {
      items: AMOUNT.items.toString(),
      walt: AMOUNT.walt.toString(),
      allowGame: ALLOW.game.toString(),
      allowWalt: ALLOW.walt.toString(),
    },
    ready: { wasm: sha === WASM_SHA256, wasmSize: wasm ? wasm.length : 0, sha, args: argsOk },
    balance: has(game) ? near(game.amount) : null,
    steps: {
      accounts:
        has(items) &&
        has(walt) &&
        on(ik, K.items.public_key) &&
        on(wk, K.walt.public_key) &&
        on(wk, K.waltfc.public_key),
      deploy: deployed && !!config && on(ik, K.game.public_key),
      register: Array.isArray(tokens) && tokens.length >= nTok && Array.isArray(recipes) && recipes.length >= nRec,
      server: serverHasKeys(),
    },
    detail: {
      items: has(items)
        ? { balance: near(items.amount), storage: items.storage_usage, keys: (ik.keys || []).length }
        : null,
      walt: has(walt) ? { balance: near(walt.amount), keys: (wk.keys || []).length } : null,
      tokens: Array.isArray(tokens) ? tokens.length : 0,
      wantTokens: nTok,
      recipes: Array.isArray(recipes) ? recipes.length : 0,
      wantRecipes: nRec,
      config,
    },
  };
}

// ---- the helper's own steps
function run(cmd, args, input) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.on('error', (e) => resolve({ code: -1, out: String(e) }));
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
}
// near-cli's output, without anything that could be a key (it prints none; this is a second fence)
const clean = (s) =>
  s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/g, 'ed25519:…')
    .slice(-4000);

async function deploy() {
  const K = keys();
  const st = await state();
  if (!st.ready.wasm) throw new Error('wasm hash differs from the checked build');
  if (!st.ready.args) throw new Error('contract/mainnet/*.json are stale: node gen/chainargs.mjs');
  if (!st.detail.items) throw new Error('items.meowdivision.near does not exist yet');
  const log = [];
  const S = ['network-config', 'mainnet', 'sign-with-access-key-file', K.items.file, 'send'];
  const code = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: A.items });
  if (!st.steps.deploy && code.code_hash === '11111111111111111111111111111111') {
    const r = await run('near', [
      'contract',
      'deploy',
      A.items,
      'use-file',
      WASM,
      'with-init-call',
      'new',
      'file-args',
      path.join(MAIN, 'new.json'),
      'prepaid-gas',
      '100 Tgas',
      'attached-deposit',
      '0 NEAR',
      ...S,
    ]);
    log.push('deploy: ' + clean(r.out));
    if (r.code !== 0) throw new Error(log.join('\n'));
  }
  const ik = await keyList(A.items);
  if (!(ik.keys || []).some((k) => k.public_key === K.game.public_key)) {
    const r = await run('near', [
      'account',
      'add-key',
      A.items,
      'grant-function-call-access',
      '--allowance',
      '1 NEAR',
      '--contract-account-id',
      A.items,
      '--function-names',
      'game_mint, game_burn',
      'use-manually-provided-public-key',
      K.game.public_key,
      ...S,
    ]);
    log.push('game key: ' + clean(r.out));
    if (r.code !== 0) throw new Error(log.join('\n'));
  }
  return log;
}

// the server's env file holds the two function-call keys; they go over ssh's stdin, never on a command line or in a log
let serverCache = null;
function serverHasKeys() {
  if (serverCache !== null) return serverCache;
  try {
    const out = execFileSync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-i',
        SSH_KEY,
        HOST,
        "grep -cE '^NEAR_(SIGNER|WALT)_KEY=ed25519:' /etc/meow-division.env || true",
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    serverCache = out.trim() === '2';
  } catch {
    serverCache = false;
  }
  return serverCache;
}
async function server() {
  const K = keys();
  const remote = `set -eu
read -r game; read -r walt
f=/etc/meow-division.env
tmp=$(mktemp /etc/meow-division.env.XXXXXX)
grep -vE '^(NEAR_SIGNER_ACCOUNT|NEAR_SIGNER_KEY|NEAR_WALT_ACCOUNT|NEAR_WALT_KEY|NEAR_ITEMS_CONTRACT|NEAR_GAME_ACCOUNT)=' "$f" > "$tmp" || true
printf 'NEAR_GAME_ACCOUNT=${A.game}\\nNEAR_ITEMS_CONTRACT=${A.items}\\nNEAR_WALT_ACCOUNT=${A.walt}\\nNEAR_SIGNER_ACCOUNT=${A.items}\\nNEAR_SIGNER_KEY=%s\\nNEAR_WALT_KEY=%s\\n' "$game" "$walt" >> "$tmp"
chown root:meow "$tmp"; chmod 640 "$tmp"; mv "$tmp" "$f"
systemctl restart meow-division
echo "env: $(grep -cE '^NEAR_(SIGNER|WALT)_KEY=ed25519:' $f) keys; service: $(systemctl is-active meow-division)"`;
  const r = await run(
    'ssh',
    ['-o', 'BatchMode=yes', '-i', SSH_KEY, HOST, remote],
    K.game.private_key + '\n' + K.waltfc.private_key + '\n',
  );
  serverCache = null;
  if (r.code !== 0) throw new Error(clean(r.out));
  return [clean(r.out).trim()];
}

// ---- the page and its API (this PC only)
const PAGE = path.join(MAIN, 'launch.html');
const ARGS = { register_tokens: 'register_tokens.json', set_recipes: 'set_recipes.json' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
let busy = false;
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && u.pathname === '/')
        return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && u.pathname === '/api/state') return send(res, 200, await state());
      if (req.method === 'GET' && u.pathname.startsWith('/api/args/')) {
        const f = ARGS[u.pathname.slice(10)];
        return f
          ? send(res, 200, fs.readFileSync(path.join(MAIN, f), 'utf8'))
          : send(res, 404, { error: 'no such args' });
      }
      if (req.method === 'POST' && (u.pathname === '/api/deploy' || u.pathname === '/api/server')) {
        if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}`)
          return send(res, 403, { error: 'other origin' });
        if (busy) return send(res, 409, { error: 'busy' });
        busy = true;
        try {
          const log = u.pathname === '/api/deploy' ? await deploy() : await server();
          return send(res, 200, { ok: true, log });
        } finally {
          busy = false;
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e.message || e) });
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    keys();
    console.log(`launch page: http://127.0.0.1:${PORT}/  (keys in ${KEYS})`);
  });
