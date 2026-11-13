// server/tg.mjs — a player's Telegram told of their market trades (the bot @MeowDivisionBot, server/tgbot.mjs).
// The link: the game opened as the bot's Mini App hands the server Telegram's signed initData once a wallet is signed in
// (POST /api/tg); checked with the bot's token (core.telegram.org/bots/webapps: HMAC-SHA256 under the key
// HMAC("WebAppData", token)), it names the person's Telegram id and the language their Telegram is set to. Kept in
// DATA_DIR/tg.json: { account: { id, lang, at } }. No token (TG_TOKEN unset): nothing is linked, nothing is sent.
// A trade: the seller is told their item was bought; a bidder is told their bid was filled (a buyer who took a lot
// themselves has just done it, no message). One message per account, item and side for a purchase's or a sale's fills.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const T = {
  en: {
    sold: 'Your item {name} ×{n} was just bought on the market for {sum}.',
    bought: 'Your bid was filled: {name} ×{n} bought on the market for {sum}.',
  },
  ru: {
    sold: 'Ваш предмет {name} ×{n} только что купили на маркете за {sum}.',
    bought: 'Ваша заявка исполнена: {name} ×{n} куплено на маркете за {sum}.',
  },
  uk: {
    sold: 'Ваш предмет {name} ×{n} щойно купили на маркеті за {sum}.',
    bought: 'Вашу заявку виконано: {name} ×{n} куплено на маркеті за {sum}.',
  },
  es: {
    sold: 'Tu objeto {name} ×{n} se acaba de vender en el mercado por {sum}.',
    bought: 'Tu oferta se ha cumplido: {name} ×{n} comprado en el mercado por {sum}.',
  },
};
const langOf = (code) => {
  const c = String(code || '')
    .slice(0, 2)
    .toLowerCase();
  return T[c] ? c : 'en';
};
const DAY = 86400e3;

// Telegram's initData checked with the bot's token: { id, lang } of the person, or null
export function checkInit(initData, token, now = Date.now()) {
  if (!token || typeof initData !== 'string' || initData.length > 4096) return null;
  const q = new URLSearchParams(initData),
    hash = q.get('hash') || '';
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const lines = [];
  for (const [k, v] of q) if (k !== 'hash') lines.push(`${k}=${v}`);
  lines.sort();
  const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest(),
    want = crypto.createHmac('sha256', key).update(lines.join('\n')).digest(),
    got = Buffer.from(hash, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const at = +q.get('auth_date') * 1000;
  if (!(at > now - DAY && at < now + 600e3)) return null;
  try {
    const u = JSON.parse(q.get('user') || 'null');
    return u && Number.isSafeInteger(u.id) && u.id > 0 ? { id: u.id, lang: langOf(u.language_code) } : null;
  } catch {
    return null;
  }
}

// trades: one purchase's or one sale's [{ it, n, p (cents each), s, b, k: 'b' a lot taken | 's' sold into a bid }]
// → [{ acc, key: 'sold' | 'bought', it, n, cents }]
export function notes(trades) {
  const by = new Map();
  const add = (acc, key, x) => {
    const id = `${acc}|${key}|${x.it}`,
      r = by.get(id) || { acc, key, it: x.it, n: 0, cents: 0 };
    r.n += x.n;
    r.cents += x.n * x.p;
    by.set(id, r);
  };
  for (const x of trades) {
    add(x.s, 'sold', x);
    if (x.k === 's') add(x.b, 'bought', x);
  }
  return [...by.values()];
}
export const text = (lang, key, name, n, cents) =>
  T[langOf(lang)][key]
    .replace('{name}', name)
    .replace('{n}', n)
    .replace('{sum}', '$' + (cents / 100).toFixed(2));

export function makeTg({ dataDir, token = '', names = () => null, send = null, now = Date.now, log = console }) {
  const file = path.join(dataDir, 'tg.json');
  let st = {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j === 'object' && !Array.isArray(j)) st = j;
  } catch {}
  const save = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(st));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      log.warn('tg: links not written: ' + e.message);
    }
  };
  const post =
    send ||
    (async (chat, body) => {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: body }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) throw Object.assign(new Error((j && j.description) || 'HTTP ' + r.status), { code: r.status });
    });
  return {
    on: () => !!token,
    // the account linked to the Telegram person whose signed initData this is
    link(acc, initData) {
      const u = checkInit(initData, token, now());
      if (!u) return false;
      const was = st[acc];
      if (!was || was.id !== u.id || was.lang !== u.lang) {
        st[acc] = { id: u.id, lang: u.lang, at: now() };
        save();
      }
      return true;
    },
    of: (acc) => st[acc] || null,
    // a purchase's or a sale's trades: each linked side told (never thrown: the market does not wait for it)
    async trade(trades) {
      if (!token) return 0;
      let sent = 0;
      for (const r of notes(trades)) {
        const l = st[r.acc];
        if (!l) continue;
        try {
          await post(l.id, text(l.lang, r.key, names(l.lang, r.it) || r.it, r.n, r.cents));
          sent++;
        } catch (e) {
          // (the person blocked the bot or never started it: the link is of no use any more)
          if (e.code === 403) {
            delete st[r.acc];
            save();
          }
          log.warn('tg: trade message not sent: ' + e.message);
        }
      }
      return sent;
    },
  };
}
