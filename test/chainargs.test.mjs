// The mainnet set-up files in contract/mainnet/ (written by gen/chainargs.mjs, sent by the human with near-cli) must
// register every item, trophy and kit in live/economy.js and every recipe, within the contract's limits, and must be
// exactly what the generator writes today: an economy change without a regenerated file fails here. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chainArgs, render, OUT_DIR } from '../gen/chainargs.mjs';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js');
const ASSETS = path.join(OUT_DIR, '..', '..', 'live', 'assets');

const read = (file) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
// every call of one method, in the order DEPLOY.md sends them (register_tokens.json or register_tokens_1.json, …)
const calls = (method) =>
  fs
    .readdirSync(OUT_DIR)
    .filter((f) => f === `${method}.json` || new RegExp(`^${method}_\\d+\\.json$`).test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map(read);
const tokens = calls('register_tokens').flatMap((c) => c.tokens);
const recipes = calls('set_recipes').flatMap((c) => c.recipes);

test('every item, trophy and kit in economy.js is registered once, named and pictured', () => {
  assert.deepEqual(
    tokens.map((t) => t.token_id),
    E.ITEMS.map((it) => it.id),
  );
  for (const t of tokens) {
    const it = E.item(t.token_id);
    assert.equal(t.base.id, t.token_id);
    assert.ok(t.base.name && t.base.name === t.token.title, t.token_id);
    assert.equal(t.token.media, `https://game.meowdivision.fun/assets/it_${t.token_id}.png`);
    assert.ok(fs.existsSync(path.join(ASSETS, `it_${t.token_id}.png`)), t.token_id);
    assert.deepEqual(JSON.parse(t.token.extra), { kind: it.kind, rarity: it.rarity });
  }
  assert.deepEqual(
    read('token_ids.json').token_ids,
    E.ITEMS.map((it) => it.id),
  );
});

test('every recipe in economy.js goes on chain with the same inputs and output', () => {
  assert.deepEqual(
    recipes.map((r) => r.id),
    E.RECIPES.map((r) => r.id),
  );
  const part = ([id, n]) => ({ token_id: id, amount: String(n) });
  for (const r of E.RECIPES) {
    const sent = recipes.find((x) => x.id === r.id);
    assert.deepEqual(sent.inputs, r.inputs.map(part), r.id);
    assert.deepEqual(sent.outputs, [part(r.output)], r.id);
  }
});

test('each call stays within the contract limits', () => {
  const ID = /^[A-Za-z0-9_.:-]{1,64}$/; // check_id in contract/src/lib.rs
  for (const c of calls('register_tokens')) assert.ok(c.tokens.length >= 1 && c.tokens.length <= 50);
  for (const c of calls('set_recipes')) assert.ok(c.recipes.length >= 1 && c.recipes.length <= 50);
  for (const t of tokens) assert.match(t.token_id, ID);
  for (const r of recipes) {
    assert.match(r.id, ID);
    for (const p of [...r.inputs, ...r.outputs]) {
      assert.ok(
        tokens.some((t) => t.token_id === p.token_id),
        `${r.id}: ${p.token_id} is registered first`,
      );
      assert.match(p.amount, /^[1-9]\d*$/);
    }
  }
  const init = read('new.json');
  assert.deepEqual(Object.keys(init).sort(), ['game_signer_id', 'name', 'owner_id', 'walt_id']);
  assert.equal(init.game_signer_id, 'items.meowdivision.near'); // the server signs through a key on the contract
});

test('the files are what gen/chainargs.mjs writes today', () => {
  const files = chainArgs();
  for (const [file, args] of Object.entries(files)) {
    const at = path.join(OUT_DIR, file);
    assert.ok(fs.existsSync(at), `${file} is missing: run node gen/chainargs.mjs`);
    assert.equal(fs.readFileSync(at, 'utf8'), render(args), `${file} is stale: run node gen/chainargs.mjs`);
  }
  const extra = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && !(f in files));
  assert.deepEqual(extra, [], 'files the generator no longer writes');
});
