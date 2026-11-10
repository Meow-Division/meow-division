// The server's own NEAR transactions (server/near.mjs): the borsh of a transaction with function calls and its signed
// form must be byte for byte what NEAR's own JavaScript library writes. The vectors below were computed once with
// @near-js/transactions 2.5 (createTransaction, encodeTransaction, SignedTransaction.encode) in a scratch folder outside
// this repository, for a test key made from 32 bytes of 7 (not a real key), a made-up block hash and two calls.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  b58decode,
  b58encode,
  encodeTransaction,
  makeRpc,
  parseSecretKey,
  publicKeyBytes,
  signTransaction,
  RpcError,
} from '../server/near.mjs';

const TX =
  '170000006974656d732e6d656f776469766973696f6e2e6e65617200ea4a6c63e29c520abef5507b132ec5f9954776ae' +
  'bebe7b92421eea691446d22c81c0e7f97fcb0000170000006974656d732e6d656f776469766973696f6e2e6e65617201' +
  '080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3da02000000020b00000067616d655f77616c' +
  '6c6574750000007b226163636f756e745f6964223a22636f707065722e6e656172222c227075626c69635f6b6579223a' +
  '22656432353531393a364538734363693962616479526b5862334a6f5270426a357038433654773431454c445a6f6969' +
  '684b457470222c22726571756573745f6964223a22772d616263227d00407a10f35a0000000000000000000000000000' +
  '00000000020900000067616d655f6d696e74020000007b7d00e057eb481b000001000000000000000000000000000000';
const SIGNATURE =
  '695aec324eef235de06aeaff714d317a361f3788a7fd9611aad9bead0398e93873ad0701fa83e4c3df1f92ffb4a722' +
  'a824b49c13856baecd59d0fdb9e7669006';
const HASH = '8cbFkdjAXnGDjmY6EzGXQ5h96F4i1XvUZeG7DphcU1zE';
const PUBLIC = 'ed25519:GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';

// the test key in NEAR's text form, made here from its seed (no key text in this file)
function testKey() {
  const seed = Buffer.alloc(32, 7);
  const priv = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const pub = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12);
  return 'ed25519:' + b58encode(Buffer.concat([seed, pub]));
}
const blockHash = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 + 1));
const ARGS = {
  account_id: 'copper.near',
  public_key: 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp',
  request_id: 'w-abc',
};

test('a secret key in text form gives its public key, and a wrong one is refused', () => {
  const k = parseSecretKey(testKey());
  assert.equal(k.text, PUBLIC);
  assert.equal(publicKeyBytes(PUBLIC).length, 32);
  assert.equal(publicKeyBytes('ed25519:abc'), null);
  assert.throws(() => parseSecretKey('secp256k1:abc'));
  const raw = b58decode(testKey().slice(8));
  raw[40] ^= 1; // a public half that is not the seed's
  assert.throws(() => parseSecretKey('ed25519:' + b58encode(raw)), /does not match/);
});

test('the borsh of a transaction and its signed form match near-js byte for byte', () => {
  const key = parseSecretKey(testKey());
  const tx = encodeTransaction({
    signerId: 'items.meowdivision.near',
    publicKey: key.publicKey,
    nonce: 223750514000001n,
    receiverId: 'items.meowdivision.near',
    blockHash,
    actions: [
      { functionCall: { methodName: 'game_wallet', args: ARGS, gas: 100000000000000n, deposit: 0n } },
      { functionCall: { methodName: 'game_mint', args: Buffer.from('{}'), gas: 30000000000000n, deposit: 1n } },
    ],
  });
  assert.equal(tx.toString('hex'), TX);
  const { signed, hash } = signTransaction(tx, key.privateKey);
  assert.equal(hash, HASH);
  assert.equal(signed.toString('hex'), TX + '00' + SIGNATURE);
});

test('base58 keeps leading zero bytes', () => {
  for (const hex of ['', '00', '0000ff', '01', 'ffffffff', '000102030405']) {
    const b = Buffer.from(hex, 'hex');
    assert.equal(b58decode(b58encode(b)).toString('hex'), hex);
  }
  assert.equal(b58encode(Buffer.from('0001', 'hex')), '12');
});

test('the RPC client moves on from a broken URL and stops at a definite answer', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    seen.push(url);
    const { method } = JSON.parse(opt.body);
    if (url === 'http://down') throw new Error('connect refused');
    if (method === 'query') return new Response(JSON.stringify({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }));
    return new Response(JSON.stringify({ result: { header: { hash: 'x' } } }));
  };
  try {
    const rpc = makeRpc(['http://down', 'http://up', 'http://never']);
    assert.deepEqual(await rpc('block', { finality: 'final' }), { header: { hash: 'x' } });
    assert.deepEqual(seen, ['http://down', 'http://up']);
    seen.length = 0;
    await assert.rejects(rpc('query', {}), (e) => e instanceof RpcError && e.message === 'UNKNOWN_ACCOUNT');
    assert.deepEqual(seen, ['http://down', 'http://up']);
  } finally {
    globalThis.fetch = real;
  }
});
