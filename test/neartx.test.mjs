// A payment signed in the browser with a wallet made in the game (live/neartx.js): the transaction's bytes must be
// the ones the server's own signer writes (server/near.mjs, proven on mainnet), and the signature must check out.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { encodeTransaction, signTransaction, b58encode, b58decode } from '../server/near.mjs';

const require = createRequire(import.meta.url);
const NT = require('../live/neartx.js'),
  NW = require('../live/newwallet.js');

const WORDS = [...Array(11).fill('abandon'), 'about']; // (BIP39's public test phrase)
  ' ',
);
// what the market page sends for a payment in NEAR: storage for the deposit address, NEAR wrapped, the transfer
const ACTIONS = [
  {
    methodName: 'storage_deposit',
    args: { account_id: 'dep.near', registration_only: true },
    gas: '30000000000000',
    deposit: '1250000000000000000000',
  },
  { methodName: 'near_deposit', args: {}, gas: '30000000000000', deposit: '88006000000000000000000' },
  {
    methodName: 'ft_transfer',
    args: { receiver_id: 'dep.near', amount: '88006000000000000000000', memo: 'm-1' },
    gas: '30000000000000',
    deposit: '1',
  },
];

test('base58 both ways, as the server has it', () => {
  const b = crypto.randomBytes(32);
  b[0] = 0;
  assert.equal(NT.b58(b), b58encode(b));
  assert.deepEqual(Buffer.from(NT.unb58(b58encode(b))), Buffer.from(b58decode(b58encode(b))));
  assert.deepEqual(Buffer.from(NT.unb58(NT.b58(b))), b);
});

test('the transaction is the same bytes as the server signer writes, signed by the wallet key', async () => {
  const key = await NW.keyOf(WORDS),
    pub = NT.unb58(key.publicKey.slice(8)),
    blockHash = crypto.randomBytes(32),
    nonce = 123456789012345n;
  const mine = NT.encode({
    signerId: 'cat.near',
    publicKey: pub,
    nonce,
    receiverId: 'wrap.near',
    blockHash,
    actions: ACTIONS,
  });
  const theirs = encodeTransaction({
    signerId: 'cat.near',
    publicKey: Buffer.from(pub),
    nonce,
    receiverId: 'wrap.near',
    blockHash,
    actions: ACTIONS.map((a) => ({ functionCall: a })),
  });
  assert.deepEqual(Buffer.from(mine), theirs);
  const { signed, hash } = await NT.sign(mine, key.privateKey);
  assert.equal(hash, b58encode(crypto.createHash('sha256').update(theirs).digest()));
  assert.equal(signed.length, mine.length + 65);
  assert.equal(signed[mine.length], 0);
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]);
  assert.ok(
    crypto.verify(
      null,
      crypto.createHash('sha256').update(theirs).digest(),
      crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }),
      Buffer.from(signed.slice(mine.length + 1)),
    ),
  );
  // (ed25519 is deterministic: the server's signer gives the same signature for the same key)
  const der = crypto.createPrivateKey({ key: await crypto.subtle.exportKey('jwk', key.privateKey), format: 'jwk' });
  assert.deepEqual(Buffer.from(signed), signTransaction(theirs, der).signed);
});

test('send: the nonce and the block hash read, the signed bytes posted, a failure thrown with the hash', async () => {
  const key = await NW.keyOf(WORDS),
    block = b58encode(crypto.randomBytes(32)),
    calls = [];
  let status = { SuccessValue: '' };
  const fetch = async (url, o) => {
    const q = JSON.parse(o.body);
    calls.push(q);
    const result = q.method === 'query' ? { nonce: 41, permission: 'FullAccess', block_hash: block } : { status };
    return { json: async () => ({ result }) };
  };
  const arg = { rpc: 'http://rpc', accountId: 'cat.near', key, receiverId: 'wrap.near', actions: ACTIONS, fetch };
  const r = await NT.send(arg);
  assert.equal(calls[0].params.public_key, key.publicKey);
  assert.equal(calls[1].method, 'send_tx');
  const raw = Buffer.from(calls[1].params.signed_tx_base64, 'base64'),
    tx = raw.subarray(0, raw.length - 65);
  assert.equal(r.hash, b58encode(crypto.createHash('sha256').update(tx).digest()));
  // (the nonce is the key's next one: after 'cat.near', the key type and the 32 key bytes)
  assert.equal(tx.readBigUInt64LE(4 + 8 + 1 + 32), 42n);
  status = { Failure: { ActionError: { kind: 'x' } } };
  await assert.rejects(NT.send(arg), (e) => /failed/.test(e.message) && !!e.hash);
  // (a key that is not the account's: nothing is sent)
  calls.length = 0;
  await assert.rejects(
    NT.send({
      ...arg,
      fetch: async () => ({ json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCESS_KEY' } } }) }),
    }),
    /UNKNOWN_ACCESS_KEY/,
  );
});
