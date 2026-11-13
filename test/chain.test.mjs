// test/chain.test.mjs — server/chain.mjs, the queue that sends the players' items to their wallets: a burst of
// changes of one kind goes as one call, a change never jumps ahead of one of the other kind, a send whose outcome
// isn't known is tried again with the same op id, a refused one is failed (the stash then follows the wallet), the
// queue survives a restart, and the first look at an account sends what its stash held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeChain } from '../server/chain.mjs';

const TOKENS = ['gears', 'tape', 't_butcher'];
const quiet = { warn() {}, error() {} };
// a stand-in signer: answers each call by the script (ok, refused, unknown, or throws), records what was sent
function signerOf(script = () => ({ ok: true })) {
  const sent = [];
  let gate = null;
  return {
    sent,
    hold() {
      let open;
      gate = new Promise((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
    async call(contract, method, args, opt) {
      if (gate) await gate;
      sent.push({ contract, method, args, opt });
      const r = script(sent.length, method, args);
      if (r instanceof Error) throw r;
      return { hash: 'h' + sent.length, ...r };
    },
  };
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'md-chain-'));
const until = async (f, ms = 3000) => {
  for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 10))) if (f()) return;
  throw new Error('timed out');
};
const make = (signer, o = {}) =>
  makeChain({
    dataDir: o.dir || dir(),
    near: o.near || {},
    signer,
    contract: 'items.near',
    tokens: TOKENS,
    on: true,
    lag: 0,
    mirrorMs: 10,
    log: quiet,
    ...o,
  });

test('off: nothing is queued or sent', () => {
  const s = signerOf(),
    c = makeChain({
      dataDir: dir(),
      near: {},
      signer: s,
      contract: 'items.near',
      tokens: TOKENS,
      on: false,
      log: quiet,
    });
  assert.equal(c.add('a.near', 'mint', [['gears', 1]], 'r1'), null);
  assert.equal(c.status('a.near').on, false);
});

test('a burst of one kind goes as one call; the other kind waits behind it, in order', async () => {
  const s = signerOf(),
    release = s.hold(),
    c = make(s);
  c.add('a.near', 'mint', [['gears', 2]], 'run-1'); // (sent at once: in flight, held)
  await new Promise((r) => setTimeout(r, 20));
  c.add('a.near', 'mint', [['tape', 1]], 'buy-1');
  c.add('a.near', 'mint', { gears: 1 }, 'buy-2'); // (joins buy-1: the last queued is a mint)
  c.add('a.near', 'burn', [['gears', 1]], 'sell-1');
  c.add('a.near', 'mint', [['tape', 1]], 'run-2'); // (not into buy-1: a burn lies between them)
  c.add(
    'a.near',
    'mint',
    [
      ['bogus', 5],
      ['gears', 0],
    ],
    'run-3',
  ); // (nothing the contract knows: no call)
  assert.deepEqual(c.pending('a.near'), { gears: 2, tape: 2 });
  release();
  await until(() => c.idle());
  assert.deepEqual(
    s.sent.map((x) => [x.method, x.args.run_id || x.args.op_id, x.args.token_ids.join(), x.args.amounts.join()]),
    [
      ['game_mint', 'run-1', 'gears', '2'],
      ['game_mint', 'buy-1', 'gears,tape', '1,1'],
      ['game_burn', 'sell-1', 'gears', '1'],
      ['game_mint', 'run-2', 'tape', '1'],
    ],
  );
  assert.ok(s.sent.every((x) => x.contract === 'items.near' && x.opt.gas <= 10e12));
  assert.deepEqual(
    c.status('a.near').ops.map((o) => [o.ops.join('+'), o.st]),
    [
      ['run-2', 'done'],
      ['sell-1', 'done'],
      ['buy-1+buy-2', 'done'],
      ['run-1', 'done'],
    ],
  );
});

test('an outcome not known is sent again with the same op id; a refusal is failed for good', async () => {
  let n = 0;
  const s = signerOf((i, method) => {
      if (method === 'game_burn') return { ok: false, failure: 'Smart contract panicked: not enough' };
      n++;
      return n === 1
        ? { unknown: true }
        : n === 2
          ? new Error('fetch failed')
          : { ok: true, value: n === 3 ? false : true };
    }),
    c = make(s);
  c.add('a.near', 'mint', [['gears', 1]], 'run-9');
  c.add('a.near', 'burn', [['gears', 7]], 'sell-9');
  // (the retries wait 2 s and 5 s: the queue's clock is real here)
  await until(() => c.idle(), 12000);
  const mints = s.sent.filter((x) => x.method === 'game_mint');
  assert.equal(mints.length, 3);
  assert.ok(
    mints.every((x) => x.args.run_id === 'run-9'),
    'the same op id each time',
  );
  const st = c.status('a.near').ops;
  assert.equal(st.find((o) => o.k === 'burn').st, 'fail');
  assert.equal(st.find((o) => o.k === 'mint').st, 'done', 'applied before (false) counts as done');
});

test('the queue survives a restart: a change in flight is sent again', async () => {
  const d = dir(),
    s1 = signerOf(),
    hold = s1.hold(),
    c1 = make(s1, { dir: d });
  c1.add('a.near', 'mint', [['gears', 1]], 'run-5');
  await new Promise((r) => setTimeout(r, 50)); // (written, in flight)
  const s2 = signerOf();
  make(s2, { dir: d });
  await until(() => s2.sent.length === 1);
  assert.equal(s2.sent[0].args.run_id, 'run-5');
  hold();
});

test('the first look sends the stash beyond the wallet; later the stash follows the wallet', async () => {
  const s = signerOf(),
    c = make(s);
  const rec = { save: { items: { gears: 5, t_butcher: 1 } } };
  assert.ok(c.sync('a.near', rec, { gears: 2 }));
  assert.equal(rec.chain, 1);
  await until(() => c.idle());
  assert.deepEqual(s.sent[0].args.token_ids, ['gears', 't_butcher']);
  assert.deepEqual(s.sent[0].args.amounts, ['3', '1']);
  assert.deepEqual(rec.save.items, { gears: 5, t_butcher: 1 }, 'the first look keeps the stash');
  // later: the wallet is the truth (the cleaver sent to a friend, gears received from one)
  assert.ok(c.sync('a.near', rec, { gears: 6 }));
  assert.deepEqual(rec.save.items, { gears: 6 });
  assert.equal(c.sync('a.near', rec, { gears: 6 }), false, 'nothing moved: no change');
  assert.equal(c.sync('a.near', rec, null), false, 'the RPC down: the stash stays');
});

test('a change never joins one sent before (its outcome unknown: it may have gone through as it was)', async () => {
  let n = 0;
  const s = signerOf(() => (++n === 1 ? { unknown: true } : { ok: true })),
    c = make(s);
  c.add('a.near', 'mint', [['gears', 1]], 'run-1');
  await until(() => s.sent.length === 1);
  c.add('a.near', 'mint', [['tape', 1]], 'buy-1'); // (not into run-1: it went once already)
  await until(() => c.idle(), 6000);
  assert.deepEqual(
    s.sent.map((x) => [x.args.run_id, x.args.token_ids.join()]),
    [
      ['run-1', 'gears'],
      ['run-1', 'gears'],
      ['buy-1', 'tape'],
    ],
  );
});

test('Walt hands a purchase over with his own key; his wallet follows his shelf', async () => {
  const game = signerOf(),
    waltKey = signerOf(() => ({ ok: true, block: 'B51' })), // (its outcome: the block it ran in)
    stock = { gears: 5, tape: 0 },
    held = { 'walt.near': ['2', '3', '0'] };
  const near = {
    viewAt: async (contract, method, args) => ({ value: held[args.account_id] || ['0', '0', '0'], height: 50 }),
    heightOf: async () => 51,
  };
  // (its own looks far off: the one below is asked for)
  const c = make(game, { near, walt: { acc: 'walt.near', signer: waltKey, stock: () => stock }, mirrorMs: 60e3 });
  const release = waltKey.hold();
  c.add('a.near', 'give', [['gears', 1]], 'wbuy-1');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(c.pending('a.near'), { gears: 1 }, 'on its way to the player');
  assert.deepEqual(c.pending('walt.near'), { gears: -1 }, 'and off Walt');
  release();
  await until(() => c.status('a.near').ops[0].st === 'done');
  assert.equal(waltKey.sent[0].method, 'market_give');
  assert.deepEqual(waltKey.sent[0].args, {
    receiver_id: 'a.near',
    token_ids: ['gears'],
    amounts: ['1'],
    request_id: 'wbuy-1',
  });
  // done at block 51: a view at 50 hasn't seen it yet, one at 51 has
  assert.deepEqual(c.pending('a.near', 50), { gears: 1 });
  assert.deepEqual(c.pending('a.near', 51), {});
  // his wallet (read at 50: 2 gears, 3 tape, the purchase not in it yet) set to his shelf (5 gears, no tape)
  const m = await c.mirror();
  assert.deepEqual(m, { up: { gears: 4 }, down: { tape: 3 } });
  await until(() => game.sent.length === 2);
  assert.deepEqual(
    game.sent.map((x) => [
      x.method,
      x.args.receiver_id || x.args.owner_id,
      x.args.token_ids.join(),
      x.args.amounts.join(),
    ]),
    [
      ['game_burn', 'walt.near', 'tape', '3'],
      ['game_mint', 'walt.near', 'gears', '4'],
    ],
  );
  assert.ok(c.walt() === 'walt.near');
});

test("a purchase Walt can't hand over goes to onFail at once (his key out of allowance); no key for him: minted", async () => {
  const failed = [],
    nope = Object.assign(new Error('NotEnoughAllowance'), {}),
    waltKey = signerOf(() => nope),
    c = make(signerOf(), {
      walt: { acc: 'walt.near', signer: waltKey, stock: () => ({}) },
      onFail: (x) => failed.push(x.k + ':' + x.id),
    });
  c.add('a.near', 'give', [['gears', 1]], 'wbuy-2');
  await until(() => c.idle());
  assert.equal(waltKey.sent.length, 1, 'no retries');
  assert.deepEqual(failed, ['give:wbuy-2']);
  const plain = signerOf(),
    c2 = make(plain, { walt: { acc: 'walt.near', signer: null, stock: () => ({}) } });
  c2.add('a.near', 'give', [['gears', 1]], 'wbuy-3');
  await until(() => c2.idle());
  assert.equal(plain.sent[0].method, 'game_mint');
});

test('the gas attached follows the token ids', async () => {
  const { gasFor } = await import('../server/chain.mjs');
  assert.equal(gasFor(1), 5.4e12);
  assert.ok(gasFor(31) > 9.5e12 * 1.5 && gasFor(31) < 20e12);
  assert.equal(gasFor(1000), 100e12);
});

test('an op id is one change: asked for twice (a result written again after a failed write), sent once', async () => {
  const s = signerOf(),
    hold = s.hold(),
    c = make(s);
  c.add('a.near', 'burn', [['tape', 1]], 'sell-1'); // (in flight: the mint below waits behind it, unsent)
  await until(() => c.status('a.near').ops.length === 1);
  assert.equal(c.add('a.near', 'mint', { gears: 3 }, 'run-9'), 'run-9');
  assert.equal(c.add('a.near', 'mint', { gears: 3 }, 'run-9'), 'run-9', 'the second ask: the same change');
  hold();
  await until(() => c.idle());
  assert.equal(s.sent.length, 2);
  assert.deepEqual(s.sent[1].args.amounts, ['3'], 'not 6: the loot is minted once');
  assert.equal(c.add('a.near', 'mint', { gears: 3 }, 'run-9'), 'run-9');
  await until(() => c.idle());
  assert.equal(s.sent.length, 2, 'nor after it was done');
});

test('a write of the queue that fails is logged and tried again; nothing fails unseen, nothing is lost', async () => {
  const d = dir(),
    warned = [],
    unseen = [],
    onUnseen = (e) => unseen.push(e);
  process.on('unhandledRejection', onUnseen);
  const s = signerOf(),
    c = make(s, { dir: d, log: { warn: (...a) => warned.push(a.join(' ')), error() {} } });
  fs.rmSync(d, { recursive: true, force: true }); // (the disk gone from under it: every write fails)
  c.add('a.near', 'mint', [['gears', 2]], 'run-7');
  await until(() => warned.some((w) => w.includes('the queue not saved')));
  await until(() => c.idle());
  assert.equal(s.sent.length, 1, 'the change is sent all the same: the queue is whole in memory');
  assert.equal(fs.existsSync(path.join(d, 'chain.json')), false);
  fs.mkdirSync(d, { recursive: true }); // (the disk back)
  await until(() => fs.existsSync(path.join(d, 'chain.json')), 6000);
  const kept = JSON.parse(fs.readFileSync(path.join(d, 'chain.json'), 'utf8'));
  assert.deepEqual(
    kept.q.map((x) => [x.id, x.st]),
    [['run-7', 'done']],
    'written at a later try, as it stands now',
  );
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnseen);
  assert.deepEqual(unseen, []);
});

test("the page's looks share one read of a wallet for a while; a change done drops it; a sale reads anew", async () => {
  let views = 0,
    held = 2,
    open = null;
  const near = {
    viewAt: async () => {
      views++;
      if (open) await open;
      return { value: [String(held), '0', '0'], height: 100 + views };
    },
    heightOf: async () => 500,
  };
  const s = signerOf(),
    c = make(s, { near });
  let go;
  open = new Promise((r) => (go = r));
  const looks = [c.soon('a.near'), c.soon('a.near'), c.soon('a.near')]; // (while the first is still on its way)
  go();
  open = null;
  const got = await Promise.all(looks);
  assert.equal(views, 1, 'three looks at once: one view call');
  assert.equal(got[0], got[2]);
  assert.equal(got[0].gears, 2);
  assert.equal(got[0].at, 101, 'with the block it was read at');
  await c.soon('a.near');
  assert.equal(views, 1, 'a look right after: the same read');
  await c.soon('b.near');
  assert.equal(views, 2, "another account's wallet is its own read");
  held = 5;
  assert.equal((await c.balances('a.near')).gears, 5, 'a sale never takes the kept read');
  assert.equal(views, 3);
  assert.equal((await c.soon('a.near')).gears, 2, 'the kept one still serves the page');
  c.add('a.near', 'mint', [['gears', 1]], 'run-1');
  await until(() => c.idle());
  assert.equal((await c.soon('a.near')).gears, 5, 'a change of the account done: its wallet read anew');
  assert.equal(views, 4);
  c.keep(0);
  await c.soon('a.near');
  await c.soon('a.near');
  assert.equal(views, 6, 'kept for no time: every look reads');
});

test('a wallet out of reach is not kept: the next look asks again', async () => {
  let views = 0;
  const near = {
    viewAt: async () => {
      if (++views === 1) throw new Error('rpc down');
      return { value: ['1', '0', '0'], height: 7 };
    },
  };
  const c = make(signerOf(), { near });
  assert.equal(await c.soon('a.near'), null);
  assert.equal((await c.soon('a.near')).gears, 1);
  assert.equal(views, 2);
});
