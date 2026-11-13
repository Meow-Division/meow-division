// Walt's words by NEAR AI (server/nearai.mjs, server/waltai.mjs, server/watch.mjs), with a stand-in model: the client
// sends the key only in its header, turns the model's thinking off, keeps to the day's tokens and gives up on time; a
// reply is shown only when it holds no digit, no slot but the allowed ones, no markup and the language's alphabet; the
// lines are made in the background for every tradable item's state and kept, the note for the day's picks; the market
// watch sums the day's trades and runs, marks what is plainly off, keeps the model's flags only for what is in the
// sums, and changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeNearAI, parse } from '../server/nearai.mjs';
import { makeWaltAI, clean, picks, packsFrom, isLang } from '../server/waltai.mjs';
import { makeWatch } from '../server/watch.mjs';

const require = createRequire(import.meta.url);
const E = require('../live/economy.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'md-waltai-'));
const quiet = { log() {}, warn() {} };
const SLOTS = new Set(['stock', 'norm', 'buy', 'sell']);

test('the client: the key in the header only, thinking off, the day budget, the timeout, no body in an error', async () => {
  const seen = [];
  const reply = (content, usage = 120) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: usage } }),
  });
  let next = () => reply('{"a": 1}');
  const fetch = async (url, o) => {
    seen.push({ url, o, body: JSON.parse(o.body) });
    return next(o);
  };
  const ai = makeNearAI({ key: 'sk-secret-123', base: 'https://x.test/v1/', model: 'm', dailyTokens: 2000, fetch });
  assert.deepEqual(await ai.json([{ role: 'user', content: 'hi' }], { maxTokens: 500 }), { a: 1 });
  assert.equal(seen[0].url, 'https://x.test/v1/chat/completions');
  assert.equal(seen[0].o.headers.authorization, 'Bearer sk-secret-123');
  assert.deepEqual(seen[0].body.chat_template_kwargs, { thinking: false });
  assert.equal(seen[0].body.model, 'm');
  assert.equal(seen[0].body.response_format.type, 'json_object');
  assert.ok(!seen[0].o.body.includes('sk-secret'), 'the key is not in the body');
  assert.equal(ai.usage().used, 120);
  // an error: the status only (an API's error text may quote the key)
  next = () => ({ ok: false, status: 401, text: async () => 'Incorrect API key provided: sk-secret-123' });
  await assert.rejects(ai.json([], { maxTokens: 100 }), (e) => e.message === 'http 401' && !/secret/.test(e.message));
  // the day's cap: a call that could pass it is not made
  next = () => reply('{"a": 2}', 1500);
  await ai.json([], { maxTokens: 500 }); // (used 1620 now)
  const n = seen.length;
  await assert.rejects(ai.json([], { maxTokens: 500 }), /spent/);
  assert.equal(seen.length, n, 'no call past the cap');
  // the time out
  const slow = makeNearAI({
    key: 'k',
    timeoutMs: 50,
    fetch: (u, o) =>
      new Promise((ok, no) =>
        o.signal.addEventListener('abort', () => no(Object.assign(new Error('x'), { name: 'AbortError' }))),
      ),
  });
  await assert.rejects(slow.json([]), /timed out/);
  // no key: off, nothing sent
  const off = makeNearAI({ key: '', fetch: () => assert.fail('sent') });
  assert.equal(off.on(), false);
  await assert.rejects(off.json([]), /off/);
  // a reply wrapped in a fence or a word
  assert.deepEqual(parse('```json\n{"x": "y"}\n```'), { x: 'y' });
  assert.throws(() => parse('[1, 2]'));
  assert.throws(() => parse('no json'));
});

test('a reply is shown only without digits, unknown slots, markup, and in its alphabet', () => {
  assert.equal(
    clean('Шестерёнок мало, плачу {buy} за штуку.', SLOTS, 120, 'ru'),
    'Шестерёнок мало, плачу {buy} за штуку.',
  );
  assert.equal(clean('  «Изоленты полно: {stock}.»  ', SLOTS, 120, 'ru'), 'Изоленты полно: {stock}.');
  for (const bad of [
    'Плачу 24 за штуку.', // a digit
    'Плачу ٢٤ за штуку.', // a digit of another script
    'Плачу {price} за штуку.', // a slot not allowed
    'Плачу {buy за штуку.', // a brace left open
    'Плачу <b>{buy}</b> за штуку.', // markup
    'Смотри https://x.y {buy}', // a link
    'I pay {buy} each, mate.', // English for Russian
    'Плачу {buy}, бо мало їх.', // Ukrainian letters for Russian
    'коротко', // too short
    'Очень '.repeat(30) + '{buy}', // too long
    42,
    null,
  ])
    assert.equal(clean(bad, SLOTS, 120, 'ru'), null, String(bad));
  assert.equal(clean('Плачу {buy}, бо їх мало.', SLOTS, 120, 'uk'), 'Плачу {buy}, бо їх мало.');
  assert.equal(clean('Плачу {buy}, мы их не ждали.', SLOTS, 120, 'uk'), null, 'Russian letters for Ukrainian');
  assert.equal(clean('Pago {buy} por cada uno.', SLOTS, 120, 'es'), 'Pago {buy} por cada uno.');
  // a note's slots name an item: an id with an underscore or a digit in it is no digit in the words
  assert.equal(clean('Bring me {gpu2.buy} worth.', new Set(['gpu2.buy']), 120, 'en'), 'Bring me {gpu2.buy} worth.');
});

test("the note's picks: the commonest item he is short of, the fullest shelf, the day's most sold", () => {
  const stock = { gears: 200, tape: 30, cans: 100, gpu: 0 },
    recent = { tape: 5, fuel: 1 };
  const f = picks(E, stock, recent, 20400);
  const by = Object.fromEntries(f.map((x) => [x.state, x]));
  assert.equal(E.item(by.short.id).rarity, 1, 'a common item first');
  assert.equal(by.short.stock, 0);
  assert.equal(by.glut.id, 'gears', 'gears: 5 × its norm, cans 2 ×');
  assert.equal(by.hot.id, 'tape');
  assert.equal(by.glut.buy, E.buyPrice('gears', 200));
  assert.equal(
    picks(E, stock, recent, 20400)
      .map((x) => x.id)
      .join(),
    f.map((x) => x.id).join(),
    'the same day: the same',
  );
  // nothing sold today past a few: no hot item
  assert.ok(!picks(E, stock, { tape: 2 }, 20400).some((x) => x.state === 'hot'));
});

// a stand-in model: answers a lines task with a line per item (or what bad() says), a note task with a note
function standIn(over = {}) {
  const asked = [];
  const ai = {
    on: () => true,
    model: 'stand-in',
    async json(messages) {
      const u = messages[1].content;
      asked.push(u);
      if (over.fail) throw new Error('down');
      const items = JSON.parse(u.match(/Items: (\[.*\])/)[1]);
      if (u.startsWith('Task: lines')) {
        const out = {};
        for (const it of items)
          out[it.id] = over.digits
            ? ['Плачу 12 за штуку.', 'Беру по 9.']
            : [`${it.name}: плачу {buy}.`, `${it.name}, у меня их {stock}.`];
        return out;
      }
      return {
        note: over.digits ? 'Сегодня плачу 30 за шестерёнки.' : `Нужно ${items[0].name}, плачу {${items[0].id}.buy}.`,
      };
    },
  };
  return { ai, asked };
}
const view = (stock = { gears: 200 }, recent = {}) => ({ stock, recent, day: 20400 });
const packs = packsFrom(path.join(import.meta.dirname, '..', 'live'));

test("Walt's lines and note: made in the background, kept, served for the state they were made for", async () => {
  const dir = tmp(),
    { ai, asked } = standIn();
  const W = makeWaltAI({ dataDir: dir, E, ai, packs, log: quiet, gaps: { line: 0, note: 0 } });
  const first = W.words('ru', view());
  assert.equal(first.pending, true);
  assert.deepEqual(first.lines, {});
  assert.equal(first.note, null);
  await W.settled();
  const w = W.words('ru', view());
  assert.equal(w.pending, false);
  const tradable = E.ITEMS.filter((it) => it.base > 0);
  assert.equal(Object.keys(w.lines).length, tradable.length, 'a line for every item Walt trades');
  assert.equal(w.lines.gears.s, 'glut');
  assert.equal(w.lines.t_butcher.s, 'trophy');
  assert.match(w.lines.gears.t[0], /^Шестерёнки: плачу \{buy\}\.$/, 'the item named in its language');
  assert.match(w.note.t, /\{\w+\.buy\}/);
  const lines = () => asked.filter((u) => u.startsWith('Task: lines')),
    notes = () => asked.filter((u) => u.startsWith('Task: note'));
  assert.equal(lines().length, Math.ceil(tradable.length / 13), 'the lines in calls of 13 items');
  assert.equal(notes().length, 1, 'one call for the note');
  // a state not seen before: one more call for that item alone; the rest stay
  const n = lines().length;
  W.words('ru', view({ gears: 40 }));
  await W.settled();
  assert.equal(W.words('ru', view({ gears: 40 })).lines.gears.s, 'fair');
  assert.equal(lines().length, n + 1, 'the fair line');
  assert.equal((lines()[n].match(/"id"/g) || []).length, 1, 'for that item alone');
  assert.equal(notes().length, 2, 'the note for the new picks');
  // kept on disk: a new server serves them with no call
  const { ai: ai2, asked: asked2 } = standIn();
  await new Promise((r) => setTimeout(r, 50));
  const W2 = makeWaltAI({ dataDir: dir, E, ai: ai2, packs, log: quiet });
  const again = W2.words('ru', view());
  assert.equal(again.lines.gears.s, 'glut');
  assert.equal(asked2.filter((u) => u.startsWith('Task: lines')).length, 0);
  // another language: its own
  assert.deepEqual(W2.words('es', view()).lines, {});
  assert.deepEqual(W2.words('xx', view()).lines, W2.words('en', view()).lines, 'an unknown language: English');
});

test("a language is one of the game's four by name: what every object has (constructor, __proto__) is no language", async () => {
  const odd = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', '', 'EN', null, undefined, 7, {}];
  for (const l of odd) assert.equal(isLang(l), false, String(l));
  for (const l of ['en', 'ru', 'uk', 'es']) assert.equal(isLang(l), true, l);
  // asked for Walt's words in such a "language": English's, and the model is asked (and paid) for English alone
  const { ai, asked } = standIn();
  const W = makeWaltAI({ dataDir: tmp(), E, ai, packs, log: quiet, gaps: { line: 0, note: 0 } });
  for (const l of odd) W.words(l, view());
  await W.settled();
  assert.ok(asked.length > 0);
  assert.ok(
    asked.every((u) => /^Task: (lines|note)\. Language: English\.\n/.test(u)),
    'every call names English: ' + [...new Set(asked.map((u) => u.split('\n')[0]))].join(' | '),
  );
  const calls = asked.length;
  for (const l of odd) assert.deepEqual(W.words(l, view()), W.words('en', view()));
  await W.settled();
  assert.equal(asked.length, calls, 'and once made, no call more for any of them');
  // a reply's alphabet is checked by the language's own rule, never by one found on the object's prototype
  assert.equal(clean('Плачу {buy} за штуку.', SLOTS, 120, 'constructor'), null, 'not English: thrown away');
  assert.equal(clean('I pay {buy} for one.', SLOTS, 120, '__proto__'), 'I pay {buy} for one.');
});

test('a reply with digits is thrown away and the plain texts stay; a failing model is not asked again at once', async () => {
  const dir = tmp(),
    { ai, asked } = standIn({ digits: true });
  const W = makeWaltAI({ dataDir: dir, E, ai, packs, log: quiet });
  W.words('ru', view());
  await W.settled();
  const w = W.words('ru', view());
  assert.deepEqual(w.lines, {});
  assert.equal(w.note, null);
  assert.equal(w.pending, false, 'not asked again right away');
  assert.equal(asked.length, 2);
  const { ai: down } = standIn({ fail: true });
  const W2 = makeWaltAI({ dataDir: tmp(), E, ai: down, packs, log: quiet });
  W2.words('en', view());
  await W2.settled();
  assert.equal(W2.words('en', view()).pending, false);
  // NEAR AI off: nothing asked, nothing pending
  const W3 = makeWaltAI({ dataDir: tmp(), E, ai: { on: () => false, json: () => assert.fail() }, packs, log: quiet });
  assert.deepEqual(W3.words('ru', view()), { lines: {}, note: null, pending: false });
});

test('the market watch: the day summed up, plain checks, flags kept only for what is in the sums, nothing changed', async () => {
  const dir = tmp(),
    lines = [],
    log = { log: (s) => lines.push(s), warn: (...a) => lines.push('WARN ' + a.join(' ')) };
  let t = Date.parse('2026-11-11T10:00:00Z');
  const shelf = { gears: 400, tape: 10 };
  const walt = { view: () => ({ stock: { ...shelf }, recent: {}, day: 0 }) };
  let asked = null;
  const ai = {
    on: () => true,
    model: 'stand-in',
    async json(m) {
      asked = m[1].content;
      return {
        summary: 'Шестерёнки копятся, bot.near торгует слишком быстро.',
        flags: [
          { acc: 'bot.near', why: 'Сорок сделок за минуту.' },
          { acc: 'nobody.near', why: 'Нет в сводке.' },
          { item: 'gears', why: 'Полка в десять раз больше нормы.' },
          { item: 'nothing', why: 'Нет такого.' },
        ],
      };
    },
  };
  const W = makeWatch({ dataDir: dir, E, ai, walt, names: packs.en.item, lang: 'Russian', log, now: () => t });
  W.run('alice.near', [['gears', 5]], 120);
  W.trade('alice.near', 'sell', 'gears', 5, 60);
  W.trade('alice.near', 'wbuy', 'tape', 1, -14);
  for (let i = 0; i < 40; i++) W.trade('bot.near', 'sell', 'cans', 2, 8);
  W.run('g:0123456789abcdef', [['tape', 1]], 10);
  await W.flushed();
  const s = await W.sums('2026-11-11');
  const alice = s.accounts.find((a) => a.acc === 'alice.near'),
    bot = s.accounts.find((a) => a.acc === 'bot.near');
  assert.deepEqual(
    [alice.trades, alice.sold, alice.bought, alice.coinsIn, alice.coinsOut, alice.runs, alice.found],
    [2, 5, 1, 60, 14, 1, 5],
  );
  assert.equal(bot.peak, 40);
  assert.ok(
    s.accounts.some((a) => a.acc === 'guest:01234567'),
    "a guest's device: a short name",
  );
  assert.equal(s.items.find((i) => i.id === 'cans').sold, 80);
  const checks = s.checks.map((c) => `${c.acc || c.item} ${c.check}`);
  assert.ok(checks.includes('bot.near fast'));
  assert.ok(checks.includes('bot.near outsold'));
  assert.ok(checks.includes('gears pile'));
  assert.ok(!checks.some((c) => c.startsWith('alice.near')));
  const out = await W.look('2026-11-11', false);
  assert.match(asked, /Language: Russian/);
  assert.deepEqual(
    out.ai.flags.map((f) => f.acc || f.item),
    ['bot.near', 'gears'],
    'flags for what is in the sums only',
  );
  assert.ok(fs.existsSync(path.join(dir, 'market', '2026-11-11.watch.json')));
  assert.ok(lines.some((l) => l.startsWith('market watch 2026-11-11 so far: 3 accounts, 42 trades, 2 runs')));
  assert.ok(lines.some((l) => l.includes('flag bot.near: Сорок сделок')));
  assert.deepEqual(walt.view().stock, { gears: 400, tape: 10 }, 'the shelf untouched');
  // the next day's first tick: yesterday's last look, once
  lines.length = 0;
  t += 864e5;
  await W.tick();
  await W.tick();
  assert.equal(lines.filter((l) => /^market watch 2026-11-11: /.test(l)).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'market', '2026-11-11.watch.json'), 'utf8')).final, true);
});
