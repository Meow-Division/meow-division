// A wallet made in the game (live/newwallet.js): the 12 words and the key must be what NEAR's wallets make of the same
// entropy, so the words open the wallet in HOT, Meteor or MyNearWallet. The vectors were computed once with
// near-seed-phrase 0.2.1 (generateSeedPhrase(entropy): bip39 + SLIP-10 ed25519 at m/44'/397'/0') in a scratch folder
// outside this repository. The words are kept as lists (no phrase as one string in the repository), the keys only by
// their public half. The login message the new key signs must be the NEP-413 payload server/server.mjs checks.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { b58decode } from '../server/near.mjs';

const require = createRequire(import.meta.url);
const NW = require('../live/newwallet.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = fs
  .readFileSync(path.join(ROOT, 'live', 'bip39_en.txt'), 'utf8')
  .trim()
  .split('\n');
NW.useWords(LIST);

const VECTORS = [
  {
    entropy: '00000000000000000000000000000000',
    words: ['abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon'].concat([
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'about',
    ]),
    publicKey: 'ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25',
  },
  {
    entropy: '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    words: ['legal', 'winner', 'thank', 'year', 'wave', 'sausage'].concat([
      'worth',
      'useful',
      'legal',
      'winner',
      'thank',
      'yellow',
    ]),
    publicKey: 'ed25519:5shPrRr1NRJL7aTdCMqSSKxfUHvacCTEjCkCEpd26RmJ',
  },
  {
    entropy: '9e885d952ad362caeb4efe34a8e91bd2',
    words: ['ozone', 'drill', 'grab', 'fiber', 'curtain', 'grace'].concat([
      'pudding',
      'thank',
      'cruise',
      'elder',
      'eight',
      'picnic',
    ]),
    publicKey: 'ed25519:3DcxURvH9Rq7EyLyrs3zYh24MDmacQscktZAavoEcmXX',
  },
  {
    entropy: 'ffffffffffffffffffffffffffffffff',
    words: ['zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo'].concat(['zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'wrong']),
    publicKey: 'ed25519:Cxua8Jtcu4414fr97m1CHqVt7WWFdkca1pFkdtLefD5n',
  },
];

test('the vendored word list is the BIP39 English list', () => {
  const sha = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, 'live', 'bip39_en.txt')))
    .digest('hex');
  assert.equal(sha, '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  assert.equal(LIST.length, 2048);
});

test('entropy gives the same 12 words and the same key as near-seed-phrase', async () => {
  for (const v of VECTORS) {
    const words = await NW.phraseOf(Buffer.from(v.entropy, 'hex'));
    assert.deepEqual(words, v.words, v.entropy);
    const key = await NW.keyOf(words);
    assert.equal(key.publicKey, v.publicKey, v.entropy);
  }
  // the words as a player might type them back: capitals and spaces do not change the key
  const typed = VECTORS[1].words.map((w, i) => (i % 2 ? ' ' + w.toUpperCase() + ' ' : w));
  assert.equal((await NW.keyOf(typed)).publicKey, VECTORS[1].publicKey);
});

test('a new phrase is 12 words of the list, never the same twice', async () => {
  const a = await NW.newPhrase(),
    b = await NW.newPhrase();
  assert.equal(a.length, 12);
  assert.ok(a.every((w) => LIST.includes(w)));
  assert.notDeepEqual(a, b);
});

// the server's side of NEP-413, written out here from the standard: sha256(borsh(u32 2^31 + 413, message, nonce[32],
// recipient, Option<callbackUrl> = None))
function serverHash(message, nonce, recipient) {
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    return b;
  };
  const str = (s) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([u32(2 ** 31 + 413), str(message), nonce, str(recipient), Buffer.from([0])]))
    .digest();
}

test('the new key signs the login message the server checks', async () => {
  const key = await NW.keyOf(VECTORS[2].words);
  const nonce = crypto.randomBytes(32);
  const ch = {
    message: 'Zombie Horde: sign in to keep your progress under this account',
    nonce: nonce.toString('base64'),
    recipient: 'zombie-horde',
  };
  assert.deepEqual(
    Buffer.from(await NW.nep413(ch.message, nonce, ch.recipient)),
    serverHash(ch.message, nonce, ch.recipient),
  );
  const sig = Buffer.from(await NW.signLogin(key, ch), 'base64');
  assert.equal(sig.length, 64);
  const pub = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), b58decode(key.publicKey.slice(8))]),
    format: 'der',
    type: 'spki',
  });
  assert.ok(crypto.verify(null, serverHash(ch.message, nonce, ch.recipient), pub, sig));
  assert.ok(!crypto.verify(null, serverHash('another message', nonce, ch.recipient), pub, sig));
});

test('a wallet name: 2 to 40 of a-z and digits, - or _ between them', () => {
  assert.equal(NW.nameOf(' Copper '), 'copper');
  assert.equal(NW.nameOf('copper-cat_2'), 'copper-cat_2');
  for (const bad of ['c', 'a'.repeat(41), 'copper.cat', '-copper', 'copper_', 'cop--per', 'кот', 'copper cat', ''])
    assert.equal(NW.nameOf(bad), null, bad);
});
