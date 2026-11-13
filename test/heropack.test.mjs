// The backpacks' placement file (live/hero_pack.js, written by server/herofile.mjs for the character editor): the file is what
// packSource writes for its own placement (so the editor's 409 check can tell it is unchanged), and checkPack refuses anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { checkPack, packSource, samePack, PACK_FILE } from '../server/herofile.mjs';

const P = createRequire(import.meta.url)('../live/hero_pack.js');
const text = fs.readFileSync(PACK_FILE, 'utf8');

test('live/hero_pack.js holds a valid placement for both backpacks and is packSource of it', () => {
  assert.equal(checkPack(P), '');
  assert.deepEqual(Object.keys(P.packs).sort(), ['1', '2']);
  assert.equal(packSource(P), text.replace(/\r\n/g, '\n'));
  assert.ok(samePack(P, text));
});

test('checkPack refuses other shapes, ids and ranges', () => {
  const ok = { p: [0, 0.6, -0.1], r: [0, 0, 0], s: 0.25 };
  assert.equal(checkPack({ v: 1, packs: { 1: ok } }), '');
  assert.equal(checkPack({ v: 1, packs: { 1: ok, 2: ok }, base: { 1: ok, 2: { ...ok, r: [10, -5, 0] } } }), '');
  for (const bad of [
    null,
    { v: 2, packs: { 1: ok } },
    { v: 1, packs: { 1: ok }, extra: 1 },
    { v: 1, packs: { 3: ok } },
    { v: 1, packs: { 1: ok }, base: 1 },
    { v: 1, packs: { 1: ok }, base: { 3: ok } },
    { v: 1, packs: { 1: ok }, base: { 1: { ...ok, s: 0 } } },
    { v: 1, packs: { 1: ok }, base: { 1: { ...ok, r: [0, 300, 0] } } },
    { v: 1, packs: { 1: { ...ok, s: 0 } } },
    { v: 1, packs: { 1: { ...ok, s: 1.5 } } },
    { v: 1, packs: { 1: { ...ok, p: [0, 2, 0] } } },
    { v: 1, packs: { 1: { ...ok, r: [0, 0, 270] } } },
    { v: 1, packs: { 1: { ...ok, p: [0, 0.6] } } },
    { v: 1, packs: { 1: { ...ok, id: 'x' } } },
  ])
    assert.notEqual(checkPack(bad), '', JSON.stringify(bad));
  assert.ok(!samePack({ v: 1, packs: { 1: ok } }, text), 'another placement is not the file');
});

test('a placement with its gun-less backpacks is written and read back as it is', async () => {
  const ok = { p: [0, 0.6, -0.1], r: [0, 0, 0], s: 0.25 },
    Q = { v: 1, packs: { 1: ok, 2: ok }, base: { 1: { ...ok, r: [12, -3, 1] }, 2: { ...ok, p: [0, 0.55, -0.12] } } },
    src = packSource(Q),
    m = { exports: {} };
  vm.runInNewContext(src, { module: m });
  assert.deepEqual(JSON.parse(JSON.stringify(m.exports)), Q); // (its objects another realm's)
  assert.ok(samePack(Q, src));
  assert.ok(!samePack({ v: 1, packs: Q.packs }, src), 'without base: another placement');
});
