// A player's Telegram told of their market trades (server/tg.mjs): the Mini App's initData checked with the bot's
// token, who is told of a trade and in which words.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkInit, notes, text, makeTg } from '../server/tg.mjs';

const TOKEN = '12345:test-token';
const NOW = 1_800_000_000_000;
// Telegram's own signing (core.telegram.org/bots/webapps)
function sign(fields, token = TOKEN) {
  const q = new URLSearchParams(fields),
    lines = [...q].map(([k, v]) => `${k}=${v}`).sort(),
    key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  q.set('hash', crypto.createHmac('sha256', key).update(lines.join('\n')).digest('hex'));
  return q.toString();
}
const init = (user, at = NOW / 1000 - 60) => sign({ auth_date: String(at), query_id: 'q', user: JSON.stringify(user) });

test('initData signed with the bot token names the person and their language', () => {
  assert.deepEqual(checkInit(init({ id: 77, language_code: 'ru' }), TOKEN, NOW), { id: 77, lang: 'ru' });
  assert.deepEqual(checkInit(init({ id: 77, language_code: 'uk-UA' }), TOKEN, NOW), { id: 77, lang: 'uk' });
  assert.deepEqual(checkInit(init({ id: 77, language_code: 'de' }), TOKEN, NOW), { id: 77, lang: 'en' });
});

test('initData that is forged, changed, old or without a token is refused', () => {
  const good = init({ id: 77, language_code: 'ru' });
  assert.equal(checkInit(good, 'another:token', NOW), null);
  assert.equal(checkInit(good.replace('77', '78'), TOKEN, NOW), null);
  assert.equal(checkInit(good, '', NOW), null);
  assert.equal(checkInit(init({ id: 77 }, NOW / 1000 - 2 * 86400), TOKEN, NOW), null);
  assert.equal(checkInit('hash=zz', TOKEN, NOW), null);
  assert.equal(checkInit(sign({ auth_date: String(NOW / 1000), user: '{"id":"x"}' }), TOKEN, NOW), null);
});

test('a lot taken: the seller alone is told; a sale into a bid: the seller and the bidder', () => {
  assert.deepEqual(
    notes([
      { it: 'gears', n: 1, p: 26, s: 'sel.near', b: 'buy.near', k: 'b' },
      { it: 'gears', n: 2, p: 30, s: 'sel.near', b: 'buy.near', k: 'b' },
    ]),
    [{ acc: 'sel.near', key: 'sold', it: 'gears', n: 3, cents: 86 }],
  );
  assert.deepEqual(notes([{ it: 'tape', n: 2, p: 13, s: 'sel.near', b: 'bid.near', k: 's' }]), [
    { acc: 'sel.near', key: 'sold', it: 'tape', n: 2, cents: 26 },
    { acc: 'bid.near', key: 'bought', it: 'tape', n: 2, cents: 26 },
  ]);
});

test('the words: the item, how many, the money, in the language asked', () => {
  assert.equal(text('en', 'sold', 'Gears', 1, 26), 'Your item Gears ×1 was just bought on the market for $0.26.');
  assert.match(text('ru', 'sold', 'Шестерёнки', 2, 52), /Шестерёнки ×2 .* за \$0\.52\./);
  assert.match(text('xx', 'bought', 'Gears', 1, 5), /^Your bid was filled/);
});

test('a trade is sent to the linked sides only, in their language; a blocked bot unlinks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tg-')),
    sent = [];
  let fail = 0;
  const mk = () =>
    makeTg({
      dataDir: dir,
      token: TOKEN,
      now: () => NOW,
      names: (lang, id) => ({ ru: { gears: 'Шестерёнки' }, en: { gears: 'Gears' } })[lang]?.[id],
      send: async (chat, body) => {
        if (fail) throw Object.assign(new Error('blocked'), { code: fail });
        sent.push([chat, body]);
      },
      log: { warn() {} },
    });
  let tg = mk();
  assert.equal(tg.link('sel.near', init({ id: 5, language_code: 'ru' })), true);
  assert.equal(tg.link('x.near', 'user=%7B%7D&hash=' + '0'.repeat(64)), false);
  tg = mk(); // (the links are kept in the data folder)
  assert.deepEqual(tg.of('sel.near'), { id: 5, lang: 'ru', at: NOW });
  const trade = [{ it: 'gears', n: 1, p: 26, s: 'sel.near', b: 'buy.near', k: 'b' }];
  assert.equal(await tg.trade(trade), 1);
  assert.deepEqual(sent, [[5, 'Ваш предмет Шестерёнки ×1 только что купили на маркете за $0.26.']]);
  fail = 403;
  assert.equal(await tg.trade(trade), 0);
  assert.equal(tg.of('sel.near'), null);
  // (no token: nothing linked, nothing sent)
  const off = makeTg({ dataDir: dir, token: '' });
  assert.equal(off.link('sel.near', init({ id: 5 })), false);
  assert.equal(await off.trade(trade), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
