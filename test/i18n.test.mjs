// The language packs' counts (live/i18n.js plural sets): I18N.t picks the form the language asks for by the count in
// {n} (a number or a number already written out with its digits grouped), an exact 0 takes a zero form when there is
// one, a plain string with {n} still works as before, and every plural set in every pack has each form its language has.
// The dealt names' words (data.js NICK_ADJ, NICK_TITLE, the avatars' animals) are all in the packs' nick lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

function packs() {
  const ctx = vm.createContext({});
  for (const f of ['i18n.js', 'lang_en.js', 'lang_ru.js', 'lang_uk.js', 'lang_es.js'])
    vm.runInContext(fs.readFileSync(new URL('../live/' + f, import.meta.url), 'utf8'), ctx);
  return ctx.I18N;
}

test('a count picks its plural form in each language', () => {
  const I = packs();
  assert.equal(I.t('market.count', { n: 1 }, 'en'), '1 kind');
  assert.equal(I.t('market.count', { n: 3 }, 'en'), '3 kinds');
  assert.equal(I.t('market.count', { n: 0 }, 'en'), 'empty');
  assert.equal(I.t('rank.winCoins', { n: '1,500' }, 'en'), '+1,500 coins');
  assert.equal(I.t('rank.winCoins', { n: 1 }, 'ru'), '+1 монета');
  assert.equal(I.t('rank.winCoins', { n: 3 }, 'ru'), '+3 монеты');
  assert.equal(I.t('rank.winCoins', { n: 5 }, 'ru'), '+5 монет');
  assert.equal(I.t('rank.winCoins', { n: 21 }, 'uk'), '+21 монета');
  assert.equal(I.t('rank.winCoins', { n: '1 234' }, 'uk'), '+1 234 монети');
  assert.equal(I.t('rank.winCoins', { n: 1 }, 'es'), '+1 moneda');
  assert.equal(I.t('rank.winCoins', { n: 7 }, 'es'), '+7 monedas');
});

test('a set without a count gives its other form; plain strings fill as before', () => {
  const I = packs();
  assert.equal(I.t('market.count', null, 'en'), '{n} kinds');
  assert.equal(I.t('hud.elim', { n: 48 }, 'en'), '48 eliminated');
  assert.equal(I.plural(2, 'ru'), 'few');
  assert.equal(I.plural(1, 'en'), 'one');
});

test('every plural set has the forms its language uses', () => {
  const I = packs(),
    missing = [];
  const walk = (o, path, lang) => {
    if (I.isPlural(o)) {
      const cats = new Intl.PluralRules(I.locale(lang)).resolvedOptions().pluralCategories;
      for (const f of cats) if (typeof o[f] !== 'string') missing.push(`${lang}: ${path}.${f}`);
      return;
    }
    if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path ? path + '.' + k : k, lang);
  };
  for (const lang of I.list) walk(I.packs[lang], '', lang);
  assert.deepEqual(missing, []);
});

test('every word a dealt name is made of has its translation', () => {
  const I = packs(),
    D = createRequire(import.meta.url)('../live/data.js'),
    N = I.packs.en.nick;
  for (const w of D.NICK_ADJ) assert.ok(w in N.adj, 'adjective ' + w);
  for (const w of D.NICK_TITLE) assert.ok(w in N.title, 'rank ' + w);
  for (const a of D.AVATARS) for (const w of a.animal) assert.ok(w in N.animal, 'animal ' + w);
  for (const lang of I.list)
    for (const w of Object.values(I.packs[lang].nick.animal).filter((v) => v.includes('|')))
      assert.match(w, /\|[mf]$/, lang + ' ' + w);
});
