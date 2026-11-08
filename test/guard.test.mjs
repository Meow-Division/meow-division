// The Claude Code guard hook (.claude/hooks/guard.mjs) must block what HACKATHON.md reserves for the human
// and let ordinary work through. Run: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(root, '.claude', 'hooks', 'guard.mjs');

const run = (toolName, toolInput) => {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return { code: r.status, err: r.stderr };
};
const bash = (command) => run('Bash', { command });

const blocked = [
  ['git push origin main', /push needs the human/],
  ['git -C D:/x push --force', /push needs the human/],
  ['git status && git push', /push needs the human/],
  ['cargo near deploy items.meowdivision.near', /deploy needs the human/],
  ['near contract deploy items.meowdivision.near use-file a.wasm', /transaction needs the human/],
  ['near tokens meowdivision.near send-near walt.meowdivision.near 1NEAR', /transaction needs the human/],
  ['near account add-key meowdivision.near grant-full-access', /transaction needs the human/],
  ['near contract call-function as-transaction items.meowdivision.near game_mint', /transaction needs the human/],
  ['curl -sS -X POST https://nearhackathon.com/api/applications -d @p.json', /sent once, by hand/],
  ['gh repo edit Meow-Division/meow-division --visibility public', /public needs the human/],
  ['gh repo create Meow-Division/x --public', /public needs the human/],
  ['curl -X POST https://api.x.com/2/tweets', /posting on X/],
  ['git add .env', /never committed/],
  ['git add server/.env.local live/ui.js', /never committed/],
  ['git commit --no-verify -m x', /not skipped/],
  ['rm -rf /', /too broad/],
  ['rm -rf ~', /too broad/],
  [
    'ssh -i ~/.ssh/parix_codex root@46.224.42.60 "sed -i s/a/b/ /etc/nginx/sites-available/parix"',
    /Parix is never touched/,
  ],
  [
    'ssh -i ~/.ssh/parix_codex root@46.224.42.60 "certbot renew --cert-name parixsolutions.com"',
    /Parix is never touched/,
  ],
  ['ls /var/www/parix', /Parix is never touched/],
];

const allowed = [
  'git status && git log --oneline -3',
  'git add .env.example',
  'git add -A',
  'pushd /tmp && popd',
  'near contract call-function as-read-only items.meowdivision.near mt_supply json-args {} network-config mainnet now',
  'near account view-account-summary meowdivision.near network-config mainnet now',
  'gh repo create Meow-Division/meow-division --private',
  'rm -rf dist/game.new',
  'curl -s https://nearhackathon.com/HACKATHON.md',
  'cargo near build',
  'npm test',
  'ssh -o BatchMode=yes -i ~/.ssh/parix_codex root@46.224.42.60 "ls /srv/meow"',
  'bash scripts/setup-server.sh',
];

for (const [cmd, re] of blocked) {
  test(`blocks: ${cmd}`, () => {
    const r = bash(cmd);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, re);
  });
}

for (const cmd of allowed) {
  test(`allows: ${cmd}`, () => {
    const r = bash(cmd);
    assert.equal(r.code, 0, r.err);
  });
}

test('blocks editing .env files, Windows and POSIX paths', () => {
  assert.equal(run('Edit', { file_path: 'D:\\game\\meow-division\\.env', old_string: 'a', new_string: 'b' }).code, 2);
  assert.equal(run('Write', { file_path: '/srv/meow/server/.env.production', content: 'x' }).code, 2);
  assert.equal(run('Write', { file_path: 'D:/game/meow-division/.env.example', content: 'x' }).code, 0);
  assert.equal(run('Write', { file_path: 'D:/game/meow-division/docs/secret-handling.md', content: 'x' }).code, 0);
});

test('blocks writing key material', () => {
  assert.equal(run('Write', { file_path: 'C:/Users/me/.ssh/id_ed25519', content: 'x' }).code, 2);
  assert.equal(run('Write', { file_path: '/root/.ssh/authorized_keys', content: 'x' }).code, 2);
  assert.equal(run('Write', { file_path: 'D:/game/meow-division/server/signer.key', content: 'x' }).code, 2);
  assert.equal(run('Write', { file_path: 'D:/game/meow-division/server/config.mjs', content: 'x' }).code, 0);
});

test('blocks editing anything of Parix', () => {
  assert.equal(run('Edit', { file_path: 'D:\\work\\parix\\index.html', old_string: 'a', new_string: 'b' }).code, 2);
  assert.equal(run('Write', { file_path: '/etc/nginx/sites-available/parix', content: 'x' }).code, 2);
});

test('malformed input never blocks', () => {
  const r = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});
