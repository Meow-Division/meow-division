// The page's queue of actions (live/wallet.js): a sale of an item that a run just brought home, sent while the server is
// still playing that run again, waits for the run's result and is sent again, instead of being dropped as refused
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../live/wallet.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const copy = (x) => JSON.parse(JSON.stringify(x));
// (each page signed out after its test: its queue and its polling stop)
const pages = [];
afterEach(() => {
  for (const W of pages.splice(0)) W.account = null;
});

// a page with wallet.js on it: its rules cut down to a sale and a run's items, its server a stub
function page(server) {
  const store = new Map(),
    events = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  localStorage.setItem('meow-division-wallet', JSON.stringify({ token: 't', accountId: 'cat.near' }));
  localStorage.setItem(
    'meow-division-save-v1@cat.near',
    JSON.stringify({
      base: server.save,
      t: server.t,
      ops: [{ k: 'run', id: 'R1', sent: true, o: { items: { medal: 1 } } }],
    }),
  );
  const RULES = {
    clean: copy,
    defaults: () => ({ coins: 0, items: {} }),
    act(s, a) {
      if (a.k !== 'sell') return 'unknown';
      if ((s.items[a.id] || 0) < a.n) return 'not enough';
      s.items[a.id] -= a.n;
      s.coins += 240 * a.n;
      return null;
    },
    bank(s, o) {
      for (const [id, n] of Object.entries(o.items)) s.items[id] = (s.items[id] || 0) + n;
      return {};
    },
  };
  let shown = null;
  const SAVE = { useProfile: (acc, s) => (shown = s), data: () => shown };
  async function fetch(url, opt) {
    const path = url.replace(/^\/api/, ''),
      body = opt.body ? JSON.parse(opt.body) : null,
      reply = (status, j) => ({ ok: status < 300, status, json: async () => j });
    server.calls.push(opt.method + ' ' + path);
    await sleep(5);
    if (path === '/health') return reply(200, { ok: true });
    if (path === '/save') return reply(200, { save: server.save, t: server.t });
    if (path === '/run/R1') {
      if (!server.replayed) return reply(200, { done: false });
      return reply(200, { done: true, save: server.save, t: server.t });
    }
    if (path === '/act') {
      const s = copy(server.save),
        err = RULES.act(s, body.a);
      if (err) return reply(409, { error: err, save: server.save, t: server.t });
      server.save = s;
      server.t++;
      return reply(200, { save: s, t: server.t });
    }
    return reply(404, { error: 'not found' });
  }
  const win = {
    RULES,
    SAVE,
    localStorage,
    sessionStorage: localStorage,
    fetch,
    AbortSignal,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    console,
    addEventListener() {},
    document: { addEventListener() {}, querySelector: () => null },
  };
  win.window = win;
  vm.runInNewContext(SRC, win);
  win.WALLET.on((kind, x) => events.push([kind, x]));
  pages.push(win.WALLET);
  return { W: win.WALLET, events, shown: () => shown };
}

test('a sale of a run’s item waits for the run instead of being refused', async () => {
  const server = { save: { coins: 0, items: {} }, t: 1, replayed: false, calls: [] };
  const { W, events, shown } = page(server);
  await W.ready;
  await sleep(20);
  assert.equal(shown().items.medal, 1, 'the page shows the run’s medal before the server has it');
  assert.equal(W.act({ k: 'sell', id: 'medal', n: 1 }), null);
  await sleep(60);
  assert.ok(server.calls.includes('POST /act'), 'the sale was sent');
  assert.deepEqual(
    events.filter(([k]) => k === 'refused'),
    [],
    'not dropped while the run is still being played again',
  );
  assert.equal(shown().items.medal || 0, 0, 'still shown as sold');
  // the server's replay done: the run's items are the account's now
  server.save = { coins: 0, items: { medal: 1 } };
  server.t = 2;
  server.replayed = true;
  for (let i = 0; i < 100 && W.sync !== 'saved'; i++) await sleep(10);
  assert.equal(W.sync, 'saved');
  assert.deepEqual(
    events.filter(([k]) => k === 'refused'),
    [],
  );
  assert.equal(server.save.coins, 240, 'the server took the sale');
  assert.equal(server.save.items.medal, 0);
  assert.equal(shown().coins, 240);
});

test('a sale refused with no run on its way is dropped at once', async () => {
  const server = { save: { coins: 0, items: {} }, t: 1, replayed: true, calls: [] };
  const { W, events, shown } = page(server);
  await W.ready;
  for (let i = 0; i < 100 && W.sync !== 'saved'; i++) await sleep(10);
  // the run came home with no medal after all (the server's replay differs): the page's medal is gone with it
  assert.equal(shown().items.medal || 0, 0);
  // a sale the page's rules let through but the server refuses (its stash short): dropped, the refusal said
  server.save = { coins: 0, items: {} };
  const s = shown();
  s.items.medal = 1;
  assert.equal(W.act({ k: 'sell', id: 'medal', n: 1 }), null);
  for (let i = 0; i < 100 && !events.some(([k]) => k === 'refused'); i++) await sleep(10);
  assert.deepEqual(
    events.filter(([k]) => k === 'refused').map(([, x]) => x.error),
    ['not enough'],
  );
});
