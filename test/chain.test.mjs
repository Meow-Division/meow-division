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
