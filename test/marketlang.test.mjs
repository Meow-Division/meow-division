// test/marketlang.test.mjs — the market page's language packs (live/lang_market.<lang>.js): every key of the English
// pack is in all four with the same {slots} and the same markup, every item has a name, every key the page and its HTML
// ask for exists, and no Cyrillic is left outside the Russian and Ukrainian packs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const LIVE = new URL('../live/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, LIVE), 'utf8');
const LANGS = ['en', 'ru', 'uk', 'es'];
const win = {};
for (const lg of LANGS) vm.runInNewContext(read(`lang_market.${lg}.js`), { window: win });
const P = win.MARKET_LANG;
const CYR = /[Ѐ-ӿ]/;
const slots = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
const tags = (s) => (s.match(/<\/?\w+>/g) || []).sort().join();
const page = read('market-page.js'),
  html = read('market.html');

test('all four packs are there, each with names, sources and texts', () => {
  assert.deepEqual(Object.keys(P).sort(), [...LANGS].sort());
  for (const lg of LANGS) assert.deepEqual(Object.keys(P[lg]).sort(), ['from', 'names', 't'], lg);
});

test('every key of the English pack is in every pack, with the same slots and markup, and nothing extra', () => {
  for (const part of ['names', 'from', 't'])
    for (const lg of LANGS) {
      const en = P.en[part],
        x = P[lg][part];
      assert.deepEqual(
        Object.keys(en).filter((k) => !(k in x)),
        [],
        `${lg}.${part} lacks keys`,
      );
      assert.deepEqual(
        Object.keys(x).filter((k) => !(k in en)),
        [],
        `${lg}.${part} has keys English lacks`,
      );
      for (const k in en) {
        assert.equal(typeof x[k], 'string', `${lg}.${part}.${k}`);
        assert.ok(x[k].trim(), `${lg}.${part}.${k} is empty`);
        assert.equal(slots(x[k]), slots(en[k]), `${lg}.${part}.${k} slots`);
        assert.equal(tags(x[k]), tags(en[k]), `${lg}.${part}.${k} markup`);
      }
    }
});

test('every item of the page has a name and every kind a source, in every pack', () => {
  const list = /const ITEMS = \[([\s\S]*?)\]\.map/.exec(page)[1],
    ids = [...list.matchAll(/\['(\w+)', '(\w+)'/g)];
  assert.equal(ids.length, 31);
  for (const lg of LANGS)
    for (const [, id, kind] of ids) {
      assert.ok(P[lg].names[id], `${lg}: no name for ${id}`);
      assert.ok(P[lg].from[kind], `${lg}: no source for ${kind}`);
    }
});

test('every key the page and its HTML ask for is in the packs', () => {
  const T = P.en.t,
    want = new Set();
  for (const m of html.matchAll(/data-t[pa]?="([^"]+)"/g)) want.add(m[1]);
  for (const m of page.matchAll(/\bt\('([^']+)'\)/g)) want.add(m[1]);
  // (keys put together from a state or a kind: every value the code can give them)
  const built = {
    'ev.': ['sale'],
    'kind.': ['all', 'material', 'trophy', 'kit'],
    'rar.': ['1', '2', '3', '4'],
    'os.': ['new', 'wait', 'done', 'gone', 'dropped', 'refunded', 'failed', 'back'],
    'ps.': ['q', 'done', 'fail'],
    'pw.': ['sale', 'refund'],
    'bs.': ['open', 'done', 'gone'],
    'sale.': ['wait', 'fail'],
  };
  for (const [pre, vals] of Object.entries(built)) {
    assert.ok(page.includes(`t('${pre}' +`), `the page no longer builds ${pre}… keys`);
    for (const v of vals) want.add(pre + v);
  }
  // (the server's refusals, shown as err.<message>: server/market.mjs and the routes of server/server.mjs)
  for (const e of [
    'below minimum',
    'not enough on sale',
    'too many open orders',
    'intents out of reach',
    'coin refused',
    'payments off',
    'not enough',
    'wallet out of reach',
    'sign in again',
    'held by a purchase',
    'too many lots',
    'no such lot',
    'your own lot',
    'bids changed',
    'too many bids',
    'no such bid',
    'slow down',
    'too much at once',
    'being listed',
    'market closed',
    'restarting',
    'payment on its way',
  ])
    want.add('err.' + e);
  assert.deepEqual(
    [...want].filter((k) => !(k in T)),
    [],
    'asked for and missing',
  );
});

test('the page offers the four languages and holds no Cyrillic of its own', () => {
  for (const lg of LANGS) {
    assert.ok(html.includes(`data-lang="${lg}"`), `no button for ${lg}`);
    assert.ok(html.includes(`/lang_market.${lg}.js`), `market.html does not load ${lg}`);
  }
  assert.ok(html.indexOf('/lang_market.ru.js') < html.indexOf('/market-page.js'), 'the packs load before the page');
  for (const f of ['market-page.js', 'market.html', 'market-page.css', 'lang_market.en.js', 'lang_market.es.js'])
    assert.ok(!CYR.test(read(f)), `${f} has Cyrillic`);
  assert.ok(CYR.test(JSON.stringify(P.ru.t)) && CYR.test(JSON.stringify(P.uk.t)));
  // (Ukrainian is not Russian with a few letters changed: no letters Ukrainian lacks)
  assert.ok(!/[ыэъё]/i.test(JSON.stringify(P.uk)), 'the Ukrainian pack has Russian letters');
});

test("the game passes its own language to the market's frame", () => {
  const game = read('market.js');
  assert.ok(/market\.html\?embed=1&lang=\$\{encodeURIComponent\(I18N\.lang\)\}/.test(game));
  assert.ok(/langOf\(QS\.get\('lang'\)\)/.test(page));
});
