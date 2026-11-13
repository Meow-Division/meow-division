#!/usr/bin/env node
// Secret scan. `node scripts/check-secrets.mjs` scans the working tree (what git tracks plus staged files);
// `--staged` scans only the staged diff (used by the Claude Code hook before every commit and by CI).
// Exit 1 and print the hits when something looks like a key. Add false positives to ALLOW below, with a reason.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = process.argv.includes('--staged');

// A BIP-39 phrase: 12, 15, 18, 21 or 24 lowercase words of 3 to 8 letters. Ordinary comments about map and RNG seeds
// also run past 12 words, so a phrase counts only as a whole quoted string or as the value of a seed/mnemonic key.
const WORDS = '(?:[a-z]{3,8} ){11}(?:(?:[a-z]{3,8} ){3}){0,4}[a-z]{3,8}';
const SEED_PHRASE = new RegExp(
  `(['"\`])${WORDS}\\1|(?:seed|mnemonic|phrase|SEED|MNEMONIC|PHRASE)\\w*['"]?\\s*[=:]\\s*['"]?${WORDS}`,
);

const PATTERNS = [
  ['NEAR private key', /\bed25519:[1-9A-HJ-NP-Za-km-z]{80,90}\b/],
  ['NEAR secp256k1 key', /\bsecp256k1:[1-9A-HJ-NP-Za-km-z]{80,100}\b/],
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Seed phrase', SEED_PHRASE],
  [
    'Env assignment with a value',
    // [ \t], not \s: the tree scan reads a whole file, and \s would take the next line as the value of an empty key
    /^\+?[ \t]*(NEAR_SIGNER_KEY|NEAR_WALT_KEY|NEAR_AI_API_KEY|MARKET_KEY|ONECLICK_API_KEY|INTENTS_1CLICK_JWT|TELEGRAM_BOT_TOKEN|SESSION_SECRET)[ \t]*=[ \t]*\S{8,}/m,
  ],
];

// Known safe strings (public keys, test vectors). Each entry: [substring, why].
const ALLOW = [['ed25519:AAAAC3NzaC1lZDI1NTE5', 'ssh public key prefix']];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

let hits = 0;
const check = (where, text) => {
  for (const [name, re] of PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    if (ALLOW.some(([s]) => m[0].includes(s))) continue;
    hits++;
    process.stderr.write(`${where}: ${name}: ${m[0].slice(0, 12)}...\n`);
  }
};

if (staged) {
  const diff = git('diff', '--cached', '--unified=0', '--no-color');
  let file = '?';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) check(file, line);
  }
  const names = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  for (const n of names) {
    const base = n.split('/').pop();
    if (/^\.env(\..+)?$/.test(base) && !/example$/.test(base)) {
      hits++;
      process.stderr.write(`${n}: .env file staged\n`);
    }
  }
} else {
  const names = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
  for (const n of names) {
    if (/\.(png|jpg|jpeg|webp|gif|ogg|mp3|wav|bin|wasm|glb|fbx|woff2?|ttf|ico|gz|zip)$/i.test(n)) continue;
    let text;
    try {
      text = readFileSync(n, 'utf8');
    } catch {
      continue;
    }
    if (text.length > 4_000_000) continue;
    check(n, text);
  }
}

if (hits) {
  process.stderr.write(
    `\n${hits} possible secret(s). Secrets live in .env and the server's environment, never in git.\n`,
  );
  process.exit(1);
}
