// server/near.mjs — the server's own NEAR transactions, with no dependencies: base58, the borsh of a transaction that
// carries function calls, ed25519 signing with node:crypto, and one RPC client (timeouts, then the next URL of the
// list). The signer reads its nonce (view_access_key) and a final block's hash, signs, sends (send_tx, waiting until
// every receipt ran) and follows a transaction the RPC timed out on until its outcome is known. It refuses a
// full-access key: the server only ever holds a function-call key (docs/chain.md). Keys never reach a log.
import crypto from 'node:crypto';

// ---------------------------------------------------------------- base58 (NEAR's keys, hashes)
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

// ---------------------------------------------------------------- keys
// 'ed25519:<base58 of 32 bytes>' → the 32 bytes, or null
export function publicKeyBytes(text) {
  if (typeof text !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(text)) return null;
  const raw = b58decode(text.slice(8));
  return raw.length === 32 ? raw : null;
}
// a secret key in NEAR's text form ('ed25519:' + base58 of the 32-byte seed and the 32-byte public key) → a signer's key
export function parseSecretKey(text) {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(String(text || '').trim());
  if (!m) throw new Error('the signer key is not an ed25519 key');
  const raw = b58decode(m[1]);
  if (raw.length !== 64 && raw.length !== 32) throw new Error('the signer key has the wrong length');
  const seed = raw.subarray(0, 32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12);
  if (raw.length === 64 && !pub.equals(raw.subarray(32)))
    throw new Error('the signer key does not match its public half');
  return { privateKey, publicKey: Buffer.from(pub), text: 'ed25519:' + b58encode(pub) };
}

// ---------------------------------------------------------------- borsh (nearcore's Transaction V0 and SignedTransaction)
const u8 = (v) => Buffer.from([v]);
const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};
const u64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const u128 = (v) => {
  const n = BigInt(v),
    b = Buffer.alloc(16);
  b.writeBigUInt64LE(n & 0xffffffffffffffffn);
  b.writeBigUInt64LE(n >> 64n, 8);
  return b;
};
const bytes = (b) => Buffer.concat([u32(b.length), Buffer.from(b)]);
const str = (s) => bytes(Buffer.from(s, 'utf8'));
// Action is an enum: CreateAccount 0, DeployContract 1, FunctionCall 2, Transfer 3, … Only function calls are sent here.
function action(a) {
  const f = a.functionCall;
  if (!f) throw new Error('only function calls');
  const args = Buffer.isBuffer(f.args) ? f.args : Buffer.from(JSON.stringify(f.args || {}));
  return Buffer.concat([u8(2), str(f.methodName), bytes(args), u64(f.gas), u128(f.deposit || 0)]);
}
// { signerId, publicKey: 32 bytes, nonce, receiverId, blockHash: 32 bytes, actions: [{ functionCall }] } → its borsh
export function encodeTransaction(tx) {
  if (tx.publicKey.length !== 32 || tx.blockHash.length !== 32) throw new Error('bad key or block hash');
  return Buffer.concat([
    str(tx.signerId),
    u8(0), // KeyType::ED25519
    Buffer.from(tx.publicKey),
    u64(tx.nonce),
    str(tx.receiverId),
    Buffer.from(tx.blockHash),
    u32(tx.actions.length),
    ...tx.actions.map(action),
  ]);
}
// the transaction's borsh and its ed25519 signature of sha256(that borsh) → the SignedTransaction's borsh and the hash
export function signTransaction(txBytes, privateKey) {
  const hash = crypto.createHash('sha256').update(txBytes).digest();
  const signature = crypto.sign(null, hash, privateKey);
  return { signed: Buffer.concat([txBytes, u8(0), signature]), hash: b58encode(hash) };
}

// ---------------------------------------------------------------- RPC
// An answer the chain gave (an unknown account, a transaction refused): definite, never tried on the next URL.
export class RpcError extends Error {
  constructor(error) {
    super((error && error.cause && error.cause.name) || (error && error.name) || 'rpc error');
    this.rpc = error;
    this.text = JSON.stringify(error || {}).slice(0, 2000);
  }
}
// the first URL that answers; a network failure, a timeout or a 5xx moves on to the next one
export function makeRpc(urls, { timeout = 10e3 } = {}) {
  let id = 0;
  return async function rpc(method, params, ms = timeout) {
    let last = null;
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'md' + ++id, method, params }),
          signal: AbortSignal.timeout(ms),
        });
        if (r.status >= 500 && r.status !== 503 && r.status !== 504) {
          last = new Error('rpc ' + r.status);
          continue;
        }
        const j = await r.json();
        if (j.error) {
          const cause = j.error.cause && j.error.cause.name;
          if (!cause || cause === 'INTERNAL_ERROR' || cause === 'NO_SYNCED_BLOCKS') {
            last = new RpcError(j.error);
            continue;
          }
          throw new RpcError(j.error);
        }
        return j.result;
      } catch (e) {
        if (e instanceof RpcError) throw e;
        last = e;
      }
    }
    throw last || new Error('no rpc');
  };
}

// ---------------------------------------------------------------- reads
export function makeNear({ rpcs, timeout }) {
  const rpc = makeRpc(rpcs, { timeout });
  const missing = (e, name) => e instanceof RpcError && e.message === name;
  // a contract's view method: its JSON answer and the height of the block it was read at (null if the RPC didn't say)
  async function viewAt(contractId, method, args = {}) {
    const r = await rpc('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    return {
      value: JSON.parse(Buffer.from(r.result).toString('utf8')),
      height: Number.isSafeInteger(r.block_height) ? r.block_height : null,
    };
  }
  return {
    rpc,
    // an account's view, or null when there is no such account
    async viewAccount(accountId) {
      try {
        return await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
      } catch (e) {
        if (missing(e, 'UNKNOWN_ACCOUNT')) return null;
        throw e;
      }
    },
    // an access key ({ nonce, permission }), or null
    async accessKey(accountId, publicKey, finality = 'final') {
      try {
        return await rpc('query', {
          request_type: 'view_access_key',
          finality,
          account_id: accountId,
          public_key: publicKey,
        });
      } catch (e) {
        if (missing(e, 'UNKNOWN_ACCESS_KEY') || missing(e, 'UNKNOWN_ACCOUNT')) return null;
        throw e;
      }
    },
    // a contract's view method, its JSON answer
    async view(contractId, method, args = {}) {
      return (await viewAt(contractId, method, args)).value;
    },
    viewAt,
    // a block's height by its hash, or null
    async heightOf(blockHash) {
      try {
        const b = await rpc('block', { block_id: blockHash });
        return (b && b.header && Number.isSafeInteger(b.header.height) && b.header.height) || null;
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------- the signer
// An outcome: { hash, ok: true, value } (the final value, its JSON parsed) or { hash, ok: false, failure } (the chain's
// failure, as text), or { hash, unknown: true } (sent, its outcome not known in time). A transaction the chain refused
// before running it (its key not allowed that method, no allowance left) throws an RpcError.
const parseValue = (b64) => {
  const s = Buffer.from(b64 || '', 'base64').toString('utf8');
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
// (block: the block hash its first receipt ran in, the call's own: what a later view must have reached to show it)
function outcomeOf(hash, result) {
  const st = result && result.status,
    r0 = result && Array.isArray(result.receipts_outcome) && result.receipts_outcome[0],
    block = (r0 && r0.block_hash) || null;
  if (st && 'SuccessValue' in st) return { hash, ok: true, value: parseValue(st.SuccessValue), block };
  if (st && st.Failure) return { hash, ok: false, failure: JSON.stringify(st.Failure).slice(0, 2000) };
  return { hash, unknown: true };
}
export function makeSigner(near, { accountId, secretKey, follow = 60e3 }) {
  const key = parseSecretKey(secretKey);
  let checked = null,
    lastNonce = 0n,
    lane = Promise.resolve();
  // once: the key is on the account, and it is a function-call key
  async function ready() {
    if (!checked)
      checked = near.accessKey(accountId, key.text).then((k) => {
        if (!k) throw new Error('the signer key is not on ' + accountId);
        if (k.permission === 'FullAccess') throw new Error('the signer refuses a full-access key');
        return true;
      });
    try {
      return await checked;
    } catch (e) {
      checked = null;
      throw e;
    }
  }
  async function sendOnce(receiverId, actions) {
    await ready();
    const [k, block] = await Promise.all([
      near.accessKey(accountId, key.text, 'optimistic'),
      near.rpc('block', { finality: 'final' }),
    ]);
    if (!k) throw new Error('the signer key is gone from ' + accountId);
    const chainNonce = BigInt(k.nonce);
    const nonce = (chainNonce > lastNonce ? chainNonce : lastNonce) + 1n;
    lastNonce = nonce;
    const tx = encodeTransaction({
      signerId: accountId,
      publicKey: key.publicKey,
      nonce,
      receiverId,
      blockHash: b58decode(block.header.hash),
      actions,
    });
    const { signed, hash } = signTransaction(tx, key.privateKey);
    const b64 = signed.toString('base64');
    try {
      return outcomeOf(
        hash,
        await near.rpc('send_tx', { signed_tx_base64: b64, wait_until: 'EXECUTED_OPTIMISTIC' }, 30e3),
      );
    } catch (e) {
      if (e instanceof RpcError && e.message !== 'TIMEOUT_ERROR') throw e;
      // the RPC or the network gave up waiting: the transaction may still run; follow it by its hash
      const until = Date.now() + follow;
      while (Date.now() < until) {
        try {
          const r = await near.rpc(
            'tx',
            { tx_hash: hash, sender_account_id: accountId, wait_until: 'EXECUTED_OPTIMISTIC' },
            20e3,
          );
          const out = outcomeOf(hash, r);
          if (!out.unknown) return out;
        } catch (e2) {
          if (e2 instanceof RpcError && e2.message === 'UNKNOWN_TRANSACTION') {
            // not seen yet: send the same signed transaction again (the chain takes one hash once)
            await near.rpc('broadcast_tx_async', [b64], 10e3).catch(() => {});
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return { hash, unknown: true };
    }
  }
  // one transaction at a time (the nonces follow each other); a stale nonce is read again and the call sent once more
  function call(receiverId, method, args, { gas = 30e12, deposit = 0 } = {}) {
    const actions = [{ functionCall: { methodName: method, args, gas: BigInt(gas), deposit: BigInt(deposit) } }];
    const run = lane.then(async () => {
      try {
        return await sendOnce(receiverId, actions);
      } catch (e) {
        if (!(e instanceof RpcError) || !/InvalidNonce/.test(e.text)) throw e;
        lastNonce = 0n;
        return sendOnce(receiverId, actions);
      }
    });
    lane = run.catch(() => {});
    return run;
  }
  return { accountId, publicKey: key.text, ready, call };
}
