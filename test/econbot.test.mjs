// The economy as the bots live it (live/econbot.js on the run samples in gen/econruns.json): the start is easy, the
// rest is a grind, and nothing is out of reach. These are the promises the numbers in live/economy.js were tuned to
// (docs/design.md, "Economy pace"); a change on the economy page that breaks one shows up here. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js');
const D = require('../live/data.js');
const M = require('../live/econbot.js');
const { runs } = JSON.parse(fs.readFileSync(new URL('../gen/econruns.json', import.meta.url), 'utf8'));
const res = M.simulate(E, D, runs, { bots: 120, runs: 150 });
const med = Object.fromEntries(M.summary(res).map((r) => [r.key, r]));
const at = (key) => (med[key] ? med[key].med : Infinity);

test('the first session is easy: the workbench right after mission 1, the first buildings within a few raids', () => {
  assert.equal(at('b:workbench:1'), 1, 'the cleaver pays for the workbench');
  for (const k of ['m:hp:1', 'b:medbay:1', 'b:stash:1']) assert.ok(at(k) <= 6, `${k} at raid ${at(k)}`);
  for (const k of ['b:generator:1', 'b:range:1', 'g:shotgun']) assert.ok(at(k) <= 15, `${k} at raid ${at(k)}`);
});

test('building up is a grind: level 2 of the buildings takes tens of raids, the top levels a hundred and more', () => {
  for (const k of ['b:workbench:2', 'b:stash:2', 'b:medbay:2'])
    assert.ok(at(k) >= 15 && at(k) <= 60, `${k} at ${at(k)}`);
  for (const k of ['m:hp:5', 'm:dmg:5', 'b:workbench:3']) assert.ok(at(k) >= 60, `${k} at ${at(k)}`);
});

test('a raid brings a few items home, not everything at once', () => {
  let n = 0,
    items = 0;
  for (const s of res.per.slice(1)) {
    n += s.n;
    items += s.items;
  }
  assert.ok(items / n >= 3 && items / n <= 10, `${(items / n).toFixed(1)} items per raid`);
});

test('nothing is out of reach: every building level and every upgrade level is bought by some bots', () => {
  for (const B of E.BUILDINGS)
    B.levels.forEach((l, n) => assert.ok(med[`b:${B.id}:${n + 1}`]?.share > 0, `${B.id} ${n + 1} never bought`));
  for (const m in D.META)
    for (let n = 1; n <= D.META[m].price.length; n++)
      assert.ok(med[`m:${m}:${n}`]?.share > 0, `${m} ${n} never bought`);
  for (const s in D.WEAPON_UP)
    for (let n = 1; n <= D.WEAPON_UP[s].price.length; n++)
      assert.ok(med[`w:${s}:${n}`]?.share > 0, `gun ${s} ${n} never bought`);
});
