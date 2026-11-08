// scripts/check-secrets.mjs must catch keys in the staged diff and in the tree, and stay quiet on clean files.
// It runs inside a temporary git repository so the real one is never touched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir;

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const scan = (...args) =>
  spawnSync(process.execPath, ['scripts/check-secrets.mjs', ...args], { cwd: dir, encoding: 'utf8' });

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-secrets-'));
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(path.join(root, 'scripts', 'check-secrets.mjs'), path.join(dir, 'scripts', 'check-secrets.mjs'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('clean files pass', () => {
  writeFileSync(path.join(dir, 'ok.js'), "const greeting = 'hello';\n");
  // two empty keys in a row: the shape of the real .env.example
  writeFileSync(path.join(dir, '.env.example'), 'NEAR_SIGNER_KEY=\nNEAR_WALT_KEY=\nPORT=8930\n');
  git('add', '.');
  const r = scan('--staged');
  assert.equal(r.status, 0, r.stderr);
  git('commit', '-q', '-m', 'clean');
  const tree = scan();
  assert.equal(tree.status, 0, tree.stderr);
});

test('a NEAR private key in the staged diff fails', () => {
  const fake = 'ed25519:' + '3'.repeat(88);
  writeFileSync(path.join(dir, 'leak.js'), `const k = '${fake}';\n`);
  git('add', 'leak.js');
  const r = scan('--staged');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NEAR private key/);
  git('reset', '-q', 'leak.js');
  rmSync(path.join(dir, 'leak.js'));
});

test('a Telegram bot token and a staged .env fail', () => {
  writeFileSync(path.join(dir, 'conf.txt'), `TELEGRAM_BOT_TOKEN=123456789:${'A'.repeat(35)}\n`);
  writeFileSync(path.join(dir, '.env'), 'NEAR_SIGNER_KEY=supersecretvalue123\n');
  git('add', '-f', 'conf.txt', '.env');
  const r = scan('--staged');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Telegram bot token/);
  assert.match(r.stderr, /\.env file staged/);
  git('reset', '-q', 'conf.txt', '.env');
});

test('a seed phrase fails, a long comment about map seeds passes', () => {
  // The BIP-39 test vector, assembled at run time so this file does not trip the scan itself.
  const phrase = 'abandon '.repeat(11) + 'about';
  const comment = '// the run keeps its own seeds so a ticket and a replay carry the map in the seed they have\n';
  writeFileSync(path.join(dir, 'notes.js'), comment);
  git('add', 'notes.js');
  assert.equal(scan('--staged').status, 0);
  writeFileSync(path.join(dir, 'wallet.json'), `{ "seedPhrase": "${phrase}" }\n`);
  writeFileSync(path.join(dir, 'w.js'), `const words = '${phrase}';\n`);
  git('add', 'wallet.json', 'w.js');
  const r = scan('--staged');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /wallet\.json: Seed phrase/);
  assert.match(r.stderr, /w\.js: Seed phrase/);
  git('reset', '-q', 'notes.js', 'wallet.json', 'w.js');
  for (const f of ['notes.js', 'wallet.json', 'w.js']) rmSync(path.join(dir, f));
});

test('the tree scan finds the same leaks', () => {
  const r = scan();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /conf\.txt/);
});
