// scripts/chain-launch.mjs — the items contract's mainnet launch as one page (contract/mainnet/launch.html): the human
// connects the wallet of meowdivision.near and approves one prompt; this helper does the rest.
//   1. wallet (page), one prompt, two transactions:
//      - to items.meowdivision.near: create it, fund it (5.5 NEAR), deploy the checked wasm, `new`, register_tokens and
//        set_recipes (owner calls: the predecessor is meowdivision.near), and add the game server's key (game_mint and
//        game_burn only, 1 NEAR of gas)
//      - to walt.meowdivision.near: create it, fund it (0.5 NEAR), add the server's key for Walt (market_give only)
//      Neither account gets a full-access key (wallets such as HOT refuse to add one, and none is needed): the code
//      changes only through the owner's `update_contract`, a leaked server key is retired with the owner's `set_roles`.
//   2. helper: the two server keys into /etc/meow-division.env on the server, the service restarted
//   3. read-only checks
// Then the update to 0.2.0 (wallets made in the game; DEPLOY.md, "Update"), two more prompts in the same page:
//   4. wallet: the owner's update_contract with the checked new build (1 yoctoNEAR); the contract deploys it and runs its
//      migrate, which gives the server's key game_wallet too
//   5. wallet, one prompt, two transactions: set_wallets (contract/mainnet/set_wallets.json, 1 yoctoNEAR) and a transfer
//      to items.meowdivision.near for the wallets' deposits and gas
//   6. read-only checks: the version, the server key's methods, the wallet settings, the balance
//   node scripts/chain-launch.mjs --update-args   writes contract/target/near/update_contract.json (the update by hand)
// The server keys are made on this PC in ~/meow-keys (outside the repository) and never printed or sent to the page:
// the page gets their public keys only. meowdivision.near's own key never leaves the human's wallet.
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
const WASM_SHA256 = '9f5b12812dd2539a8b2665561bede508749ee12486d3420be7fe65223b915ce2'; // the build DEPLOY.md records
// the update: its checked build, the version it answers, the server's key it re-keys (contract/src/lib.rs GAME_KEY), and
// the NEAR sent along with 0.2.0 for the wallets' deposits (100 × 0.01 by set_wallets.json) and the gas of making them.
// 0.2.1 (contract/mainnet/DEPLOY.md, "Update 0.2.1"): holders pay for the storage they add; the server's key re-keyed
// with a fresh 1 NEAR allowance. 0.2.0 was 64bc52b6f02775e3ccf6e476754ea46fce5f9fda16c24a642b7b587d0d1fb29e
const UPDATE_SHA256 = '4a5ad0732334650c715569b4342c04c95828a5ef5d88107af0a3fcce3efb4671';
const UPDATE_VERSION = '0.2.1';
const GAME_KEY = 'ed25519:136treJ5sBzc1qHxGHZpFyNPaGQ7tYVjNMeNCxsQpfgv';
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
const ALLOW = { game: NEAR, walt: NEAR / 4n }; // the server keys' gas allowances
const FUND = (15n * NEAR) / 10n; // DEPLOY.md, "Update": 1.5 NEAR

// ---- the server's two keys: ed25519 pairs in NEAR's text form, kept as near-cli access-key files
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
const KEYFILES = { game: A.items, waltfc: A.walt }; // name → the account the key signs for
function keys() {
  fs.mkdirSync(KEYS, { recursive: true });
  const out = {};
  for (const [name, account] of Object.entries(KEYFILES)) {
    const f = path.join(KEYS, name + '.json');
    if (!fs.existsSync(f))
      fs.writeFileSync(f, JSON.stringify({ account_id: account, ...newPair() }, null, 2), { mode: 0o600 });
    const k = JSON.parse(fs.readFileSync(f, 'utf8'));
    out[name] = { public_key: k.public_key, private_key: k.private_key };
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
const wasm = () => (fs.existsSync(WASM) ? fs.readFileSync(WASM) : null);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const NO_CODE = '11111111111111111111111111111111';

// what is on chain and on the server now; each step is done when its result is there
async function state() {
  const K = keys();
  const code = wasm();
  const sha = code ? crypto.createHash('sha256').update(code).digest('hex') : '';
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
  const full = (list) => (list.keys || []).filter((k) => k.access_key.permission === 'FullAccess').length;
  // (a contract is there: the launch's or a later version's; the update compares the code with the new build)
  const deployed = has(items) && items.code_hash !== NO_CODE;
  const current = has(items) && !!code && items.code_hash === b58(crypto.createHash('sha256').update(code).digest());
  const tokens = deployed ? await call('mt_tokens', {}) : null;
  const recipes = deployed ? await call('recipes', {}) : null;
  const config = deployed ? await call('config', {}) : null;
  const version = deployed ? await call('version', {}) : null;
  const wallets = deployed ? await call('wallets', {}) : null; // (null on 0.1.0: no such method)
  const gk = (ik.keys || []).find((k) => k.public_key === GAME_KEY);
  const gfc = gk && gk.access_key.permission && gk.access_key.permission.FunctionCall;
  const want = JSON.parse(fs.readFileSync(path.join(MAIN, 'set_wallets.json'), 'utf8'));
  const nTok = JSON.parse(fs.readFileSync(path.join(MAIN, 'register_tokens.json'), 'utf8')).tokens.length;
  const nRec = JSON.parse(fs.readFileSync(path.join(MAIN, 'set_recipes.json'), 'utf8')).recipes.length;
  return {
    accounts: A,
    publicKeys: { game: K.game.public_key, waltfc: K.waltfc.public_key },
    amounts: {
      items: AMOUNT.items.toString(),
      walt: AMOUNT.walt.toString(),
      allowGame: ALLOW.game.toString(),
      allowWalt: ALLOW.walt.toString(),
    },
    ready: { wasm: sha === WASM_SHA256, wasmSize: code ? code.length : 0, sha, args: argsOk },
    balance: has(game) ? near(game.amount) : null,
    steps: {
      launch:
        deployed &&
        !!config &&
        Array.isArray(tokens) &&
        tokens.length >= nTok &&
        Array.isArray(recipes) &&
        recipes.length >= nRec &&
        on(ik, K.game.public_key) &&
        has(walt) &&
        on(wk, K.waltfc.public_key),
      server: serverHasKeys(),
      update: current && version === UPDATE_VERSION && !!gfc && gfc.method_names.includes('game_wallet'),
      wallets: !!wallets && wallets.wallets_left > 0,
    },
    update: {
      ready: sha === UPDATE_SHA256,
      want: UPDATE_SHA256,
      wantVersion: UPDATE_VERSION,
      version,
      current,
      gameKey: gk ? { methods: gfc ? gfc.method_names : ['FullAccess'], allowance: gfc ? gfc.allowance : null } : null,
      wallets,
      set: want,
      fund: FUND.toString(),
    },
    detail: {
      items: has(items)
        ? {
            balance: near(items.amount),
            free: near(BigInt(items.amount) - BigInt(items.storage_usage) * 10n ** 19n),
            storage: items.storage_usage,
            keys: (ik.keys || []).length,
            full: full(ik),
            deployed,
          }
        : null,
      walt: has(walt) ? { balance: near(walt.amount), keys: (wk.keys || []).length, full: full(wk) } : null,
      tokens: Array.isArray(tokens) ? tokens.length : 0,
      wantTokens: nTok,
      recipes: Array.isArray(recipes) ? recipes.length : 0,
      wantRecipes: nRec,
      config,
    },
  };
}

// ---- the server's env file holds the two keys; they go over ssh's stdin, never on a command line or in a log
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
// output without colour codes or anything that could be a key (none is printed; this is a second fence)
const clean = (s) =>
  s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/g, 'ed25519:…')
    .slice(-4000);
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
const ARGS = {
  new: 'new.json',
  register_tokens: 'register_tokens.json',
  set_recipes: 'set_recipes.json',
  set_wallets: 'set_wallets.json',
};
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
// the update by hand (DEPLOY.md): its args file for near-cli's file-args, from the checked build only
if (process.argv.includes('--update-args')) {
  const code = wasm();
  if (!code || sha256(code) !== UPDATE_SHA256) {
    console.error(
      `contract/target/near/meow_division_items.wasm is not the checked ${UPDATE_VERSION} build: build it first`,
    );
    process.exit(1);
  }
  const out = path.join(path.dirname(WASM), 'update_contract.json');
  fs.writeFileSync(out, JSON.stringify({ code: code.toString('base64') }));
  console.log(`${out}: ${fs.statSync(out).size} bytes`);
  process.exit(0);
}
let busy = false;
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && u.pathname === '/')
        return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && u.pathname === '/api/state') return send(res, 200, await state());
      if (req.method === 'GET' && u.pathname === '/api/wasm') {
        const code = wasm();
        if (!code || ![WASM_SHA256, UPDATE_SHA256].includes(sha256(code)))
          return send(res, 409, { error: 'the wasm is not a checked build' });
        return send(res, 200, code, 'application/wasm');
      }
      if (req.method === 'GET' && u.pathname.startsWith('/api/args/')) {
        const f = ARGS[u.pathname.slice(10)];
        return f
          ? send(res, 200, fs.readFileSync(path.join(MAIN, f), 'utf8'))
          : send(res, 404, { error: 'no such args' });
      }
      if (req.method === 'POST' && u.pathname === '/api/server') {
        if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}`)
          return send(res, 403, { error: 'other origin' });
        if (busy) return send(res, 409, { error: 'busy' });
        busy = true;
        try {
          return send(res, 200, { ok: true, log: await server() });
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
    console.log(`launch page: http://127.0.0.1:${PORT}/  (server keys in ${KEYS})`);
  });
