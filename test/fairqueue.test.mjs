// test/fairqueue.test.mjs — server/fairqueue.mjs, whose replay the workers play next and how much one sender may ask
// for: a sender's pile of runs waits behind everybody else's next run instead of ahead of it, each sender's own runs
// keep their order, and the steps a sender asked for in the last hour are counted and capped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBudget, makeFairQueue } from '../server/fairqueue.mjs';

const drain = (q) => {
  const out = [];
  for (let x = q.shift(); x !== undefined; x = q.shift()) out.push(x);
  return out;
};

test('a backlog of one sender only delays itself: the others are served in between', () => {
  const q = makeFairQueue();
  for (let i = 1; i <= 5; i++) q.push('flood', 'f' + i);
  q.push('alice', 'a1');
  q.push('bob', 'b1');
  assert.equal(q.size, 7);
  // (first in, first out would play all five of the flood before alice)
  assert.deepEqual(drain(q), ['f1', 'a1', 'b1', 'f2', 'f3', 'f4', 'f5']);
  assert.equal(q.size, 0);
  assert.equal(q.shift(), undefined, 'empty: nothing');
});

test("each sender's own jobs keep their order; a sender coming back joins the end of the round", () => {
  const q = makeFairQueue();
  q.push('a', 'a1');
  q.push('a', 'a2');
  q.push('b', 'b1');
  assert.equal(q.shift(), 'a1');
  q.push('c', 'c1'); // (new while a still waits: after a's turn comes round again)
  assert.equal(q.shift(), 'b1');
  q.push('b', 'b2'); // (b had emptied: back at the end)
  assert.deepEqual(drain(q), ['a2', 'c1', 'b2']);
});

test('one sender alone is first in, first out', () => {
  const q = makeFairQueue();
  for (const x of [1, 2, 3]) q.push('only', x);
  assert.deepEqual(drain(q), [1, 2, 3]);
});

test("a budget counts a sender's last hour: past the limit refused and not counted, the old spending forgotten", () => {
  const HOUR = 3600e3,
    b = makeBudget(1000, HOUR);
  assert.equal(b.spend('net', 600, 0), true);
  assert.equal(b.spend('net', 400, 10), true, 'exactly the limit: taken');
  assert.equal(b.spend('net', 1, 20), false, 'one more: refused');
  assert.equal(b.spend('other', 1000, 20), true, "another sender's budget is its own");
  assert.equal(b.spend('net', 600, HOUR - 1), false, 'the first spending is still inside the hour');
  assert.equal(b.spend('net', 600, HOUR), true, 'an hour after it: forgotten');
  assert.equal(b.spend('net', 1, HOUR + 5), false, '(the refusals in between were not counted: 400 + 600)');
  assert.equal(b.spend('net', 400, HOUR + 10), true);
  assert.equal(b.spend('big', 1001, 0), false, 'more than the whole budget at once: never');
});

test('a sweep forgets the senders whose hour has emptied, and only those', () => {
  const b = makeBudget(10, 100);
  b.spend('old', 10, 0);
  b.spend('new', 10, 90);
  b.sweep(150);
  assert.equal(b.spend('old', 10, 150), true);
  assert.equal(b.spend('new', 1, 150), false, 'still inside its window after the sweep');
});
