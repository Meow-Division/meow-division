// test/editor.test.mjs — the team's editor routes (server/server.mjs --editor, /api/editor/…) write the game's source
// files on a team member's own machine, where any site open in the same browser can aim a request at 127.0.0.1. A real
// editor server is started here on a free port with a temp DATA_DIR: another site's request, a form's content type and
// a request addressed to this machine under a site's own name are refused before anything is read or written; the
// editor pages' own requests go through.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-'));
let child = null,
  port = 0;

before(async () => {
  child = spawn(process.execPath, ['server/server.mjs', '--editor', '--port', '0', '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: data, REPLAY_WORKERS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  port = await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('the editor server did not start: ' + out)), 30e3);
    const read = (c) => {
      out += c;
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
      if (!m) return;
      clearTimeout(t);
      ok(+m[1]);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => no(new Error(`the editor server ended (${code}): ${out}`)));
  });
});
after(() => {
  if (child) child.kill();
  fs.rmSync(data, { recursive: true, force: true });
});

// a request with exactly these headers (fetch would not let a test set Host or Origin)
const ask = (method, p, headers = {}, body = null) =>
  new Promise((ok, no) => {
    const rq = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (rs) => {
      let b = '';
      rs.on('data', (c) => (b += c));
      rs.on('end', () => {
        let j = null;
        try {
          j = JSON.parse(b);
        } catch {
          j = null;
        }
        ok({ code: rs.statusCode, j });
      });
    });
    rq.on('error', no);
    rq.end(body === null ? undefined : body);
  });
const here = () => `http://127.0.0.1:${port}`,
  VOICE = '/api/editor/voice',
  note = JSON.stringify({ k: 'note', id: 'nova.1', text: 'slower' }),
  edits = path.join(data, 'voice-edits.json');

test("the editor page's own requests go through: no Origin, or this host's", async () => {
  assert.equal((await ask('GET', VOICE)).code, 200);
  assert.equal((await ask('GET', VOICE, { origin: here() })).code, 200);
  const r = await ask('POST', VOICE, { origin: here(), 'content-type': 'application/json' }, note);
  assert.equal(r.code, 200);
  assert.equal(r.j.note['nova.1'].text, 'slower');
  const r2 = await ask('POST', VOICE, { 'content-type': 'application/json; charset=utf-8' }, note);
  assert.equal(r2.code, 200, 'a charset after the type is still JSON');
  fs.rmSync(edits);
});

test("another site's request is refused, read or write, and nothing is written", async () => {
  const evil = { origin: 'https://evil.example' };
  const get = await ask('GET', '/api/editor/economy', evil);
  assert.equal(get.code, 403);
  assert.equal(get.j.error, 'cross-site request');
  for (const p of [VOICE, '/api/editor/map', '/api/editor/hero', '/api/editor/pack', '/api/editor/economy']) {
    const r = await ask('POST', p, { ...evil, 'content-type': 'application/json' }, note);
    assert.equal(r.code, 403, p);
  }
  assert.equal((await ask('POST', VOICE, { origin: 'null', 'content-type': 'application/json' }, note)).code, 403);
  assert.equal(
    (await ask('POST', VOICE, { origin: 'http://127.0.0.1:1', 'content-type': 'application/json' }, note)).code,
    403,
    'this machine on another port is another site',
  );
  assert.equal(fs.existsSync(edits), false);
});

test('a POST a plain form could send (no JSON content type) is refused', async () => {
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', undefined]) {
    const r = await ask('POST', VOICE, type ? { 'content-type': type } : {}, note);
    assert.equal(r.code, 415, String(type));
    assert.equal(r.j.error, 'json only');
  }
  assert.equal(fs.existsSync(edits), false);
});

test("a request that reaches this machine under a site's own name is refused (a name pointed at 127.0.0.1)", async () => {
  const named = { host: `evil.example:${port}`, origin: `http://evil.example:${port}` };
  assert.equal((await ask('GET', VOICE, named)).code, 403);
  assert.equal((await ask('POST', VOICE, { ...named, 'content-type': 'application/json' }, note)).code, 403);
  assert.equal((await ask('GET', VOICE, { host: `localhost:${port}` })).code, 200, 'localhost is this machine');
  assert.equal(fs.existsSync(edits), false);
});

test('the game itself is not behind the guard: its API answers any origin as before', async () => {
  assert.equal((await ask('GET', '/api/health', { origin: 'https://evil.example' })).code, 200);
});
