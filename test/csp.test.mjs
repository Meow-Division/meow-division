// live/index.html's Content-Security-Policy and the one outside module: scripts only from the game's own origin and the
// inline ones with the page's nonce (no 'unsafe-inline', no 'unsafe-eval'), every inline script of the page carrying it,
// and NEAR Connect imported from live/vendor, not a CDN. A browser check of the same (no violations, the wallets'
// frames run): see the commit that added this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const live = (f) => fs.readFileSync(new URL('../live/' + f, import.meta.url), 'utf8');
const html = live('index.html');
const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html) || [])[1] || '';
const dir = (name) => (csp.split(';').find((d) => d.trim().startsWith(name + ' ')) || '').trim().split(/\s+/).slice(1);

test('the page has a Content-Security-Policy in its head, before any script', () => {
  assert.ok(csp, 'no CSP meta');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'the CSP comes before the scripts');
  assert.deepEqual(dir('default-src'), ["'self'"]);
  assert.deepEqual(dir('object-src'), ["'none'"]);
  assert.deepEqual(dir('base-uri'), ["'self'"]);
});

test('scripts: this origin and the nonce only, nothing inline without it, no eval', () => {
  const s = dir('script-src');
  assert.ok(s.includes("'self'"));
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'https:', 'http:', 'data:', 'blob:', '*'])
    assert.ok(!s.includes(bad), 'script-src allows ' + bad);
  assert.ok(!s.some((x) => /^https?:\/\//.test(x)), 'script-src names a host');
  const nonce = (s.find((x) => x.startsWith("'nonce-")) || '').slice(7, -1);
  assert.match(nonce, /^[A-Za-z0-9+/=]{16,}$/);
  const inline = [...html.matchAll(/<script([^>]*)>/g)].filter((m) => !/\ssrc=/.test(m[1]));
  assert.ok(inline.length >= 1);
  for (const m of inline) assert.ok(m[1].includes(`nonce="${nonce}"`), 'an inline script without the nonce: ' + m[0]);
  assert.ok(!/\son[a-z]+="/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'an inline event handler in the page');
});

test('NEAR Connect comes from live/vendor, no browser code imports from a CDN', () => {
  const w = live('wallet.js'),
    src = (/LIB_SRC = '([^']+)'/.exec(w) || [])[1];
  assert.ok(src && src.startsWith('vendor/'), 'wallet.js imports ' + src);
  assert.ok(fs.existsSync(new URL('../live/' + src, import.meta.url)), src + ' is there');
  assert.match(fs.readFileSync(new URL('../live/' + src, import.meta.url), 'utf8'), /export\{[^}]*NearConnector/);
  for (const f of fs.readdirSync(new URL('../live/', import.meta.url)).filter((f) => f.endsWith('.js')))
    assert.ok(!/import\(\s*['"`]https?:|from\s+['"]https?:/.test(live(f)), f + ' imports from the network');
});
