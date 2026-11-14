// live/neartx.js — a NEAR transaction signed in this browser with the key of a wallet made in the game (newwallet.js:
// its words are kept in this browser and never leave it). The market page pays with it (market-page.js): a wallet
// made here is in no wallet app, so NEAR Connect has nothing to sign with. Function calls only. The borsh is
// nearcore's Transaction V0, the same bytes server/near.mjs writes (test/neartx.test.mjs holds the two side by side).
// WebCrypto does the hashing and the Ed25519 signature. Exports its functions for the node tests.
(function () {
  const S = globalThis.crypto && globalThis.crypto.subtle,
    te = new TextEncoder();
  const NT = {};
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  NT.b58 = (bytes) => {
    let n = 0n,
      s = '';
    for (const b of bytes) n = n * 256n + BigInt(b);
    while (n > 0n) {
      s = B58[Number(n % 58n)] + s;
      n /= 58n;
    }
    for (const b of bytes) {
      if (b) break;
      s = '1' + s;
    }
    return s;
  };
  NT.unb58 = (text) => {
    let n = 0n;
    for (const c of text) {
      const i = B58.indexOf(c);
      if (i < 0) throw new Error('not base58');
      n = n * 58n + BigInt(i);
    }
    const out = [];
    while (n > 0n) {
      out.unshift(Number(n & 255n));
      n >>= 8n;
    }
    for (const c of text) {
      if (c !== '1') break;
      out.unshift(0);
    }
    return Uint8Array.from(out);
  };
  const cat = (parts) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const le = (v, n) => {
    let x = BigInt(v);
    if (x < 0n || x >> BigInt(8 * n)) throw new Error('number out of range');
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      b[i] = Number(x & 255n);
      x >>= 8n;
    }
    return b;
  };
  const bytes = (b) => cat([le(b.length, 4), b]),
    str = (s) => bytes(te.encode(s));
  // a function call (Action's variant 2): { methodName, args (an object), gas, deposit }
  const action = (a) => {
    if (!a || !a.methodName) throw new Error('only function calls');
    return cat([
      Uint8Array.of(2),
      str(a.methodName),
      bytes(te.encode(JSON.stringify(a.args || {}))),
      le(a.gas, 8),
      le(a.deposit || 0, 16),
    ]);
  };
  // { signerId, publicKey: 32 bytes, nonce, receiverId, blockHash: 32 bytes, actions } → its borsh
  NT.encode = (tx) => {
    if (tx.publicKey.length !== 32 || tx.blockHash.length !== 32) throw new Error('bad key or block hash');
    return cat([
      str(tx.signerId),
      Uint8Array.of(0), // (KeyType::ED25519)
      tx.publicKey,
      le(tx.nonce, 8),
      str(tx.receiverId),
      tx.blockHash,
      le(tx.actions.length, 4),
      ...tx.actions.map(action),
    ]);
  };
  // the transaction's borsh signed (ed25519 over its sha256) → { signed: the SignedTransaction's borsh, hash }
  NT.sign = async (txBytes, privateKey) => {
    const hash = new Uint8Array(await S.digest('SHA-256', txBytes)),
      sig = new Uint8Array(await S.sign({ name: 'Ed25519' }, privateKey, hash));
    return { signed: cat([txBytes, Uint8Array.of(0), sig]), hash: NT.b58(hash) };
  };
  const b64 = (b) => {
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  };
  // signs and sends: the key's nonce and a final block's hash read first; waits until the transaction has run.
  // key: { publicKey: 'ed25519:…', privateKey: CryptoKey } (newwallet.js keyOf); actions: [{ methodName, args, gas,
  // deposit }]. Resolves to { hash }; throws when the key is not the account's or the chain refused the transaction
  // (the error's hash: the transaction's, when it was sent)
  NT.send = async ({ rpc, accountId, key, receiverId, actions, fetch: f = globalThis.fetch }) => {
    const call = async (method, params) => {
      const r = await f(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) {
        const c = j.error.cause || {};
        throw new Error(c.name || j.error.name || j.error.message || 'rpc error');
      }
      return j.result;
    };
    const ak = await call('query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: accountId,
      public_key: key.publicKey,
    });
    if (!ak || ak.error || ak.nonce == null) throw new Error('this key is not on the account');
    if (ak.permission !== 'FullAccess') throw new Error('this key cannot pay');
    const tx = NT.encode({
        signerId: accountId,
        publicKey: NT.unb58(key.publicKey.replace(/^ed25519:/, '')),
        nonce: BigInt(ak.nonce) + 1n,
        receiverId,
        blockHash: NT.unb58(ak.block_hash),
        actions,
      }),
      { signed, hash } = await NT.sign(tx, key.privateKey);
    const res = await call('send_tx', { signed_tx_base64: b64(signed), wait_until: 'EXECUTED_OPTIMISTIC' });
    const st = res && res.status;
    if (st && st.Failure)
      throw Object.assign(new Error('the transaction failed: ' + JSON.stringify(st.Failure).slice(0, 300)), { hash });
    return { hash };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NT;
  if (typeof window !== 'undefined') window.NEARTX = NT;
})();
