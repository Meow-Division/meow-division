// server/watch.mjs — a look over the market's day, for the people who balance the game. Every trade with Walt and every
// run's loot is written to DATA/market/<YYYY-MM-DD>.jsonl (UTC days). Every few hours while players trade, and once
// more when the day is over, the day is summed up here: per item, what players sold and bought and for how many coins,
// Walt's shelf against its norm, a price down at its floor; per account, its trades, coins in and out, what its runs
// brought, its fastest minute. Plain checks mark what is plainly off (an account trading faster than a hand can, one
// selling far more than its runs brought; a shelf piled far past its norm, a price at its floor). Then NEAR AI
// (server/nearai.mjs) reads the sums and says in a few lines what looks off and why (in WATCH_LANG). The sums, the
// checks and its words go to DATA/market/<day>.watch.json and to the server's log ("market watch"). It changes nothing:
// no price, no shelf, no account.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const HOUR = 3600e3,
  EVERY = 3 * HOUR, // (a look at today at most this often, when there were trades since)
  FAST = 30, // (trades in one minute: faster than a hand)
  OUTSOLD = 60, // (items sold in a day past what the day's runs brought: an old stash, or something else)
  PILE = 4, // (a shelf this many times its norm)
  TOP = 20; // (accounts the model reads: the busiest)
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export function makeWatch({ dataDir, E, ai, walt, names = {}, lang = 'ru', log = console, now = () => Date.now() }) {
  const dir = path.join(dataDir, 'market');
  fs.mkdirSync(dir, { recursive: true });
  let q = Promise.resolve(),
    looking = null;
  const seen = new Map(); // day -> { n: lines written this run, at: the last look, looked: n at that look }
  const file = (d, ext = '.jsonl') => path.join(dir, d + ext);
  function write(o) {
    const t = now(),
      d = dayOf(t),
      s = seen.get(d) || { n: 0, at: 0, looked: 0 };
    s.n++;
    seen.set(d, s);
    const line = JSON.stringify({ t, ...o }) + '\n';
    q = q.then(() => fsp.appendFile(file(d), line)).catch((e) => log.warn('market watch: not written', e.message));
  }
  const who = (acc) => (/^g:/.test(acc) ? 'guest:' + acc.slice(2, 10) : acc);

  // a day's lines summed up, and the plain checks
  async function sums(d) {
    let text = '';
    try {
      text = await fsp.readFile(file(d), 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const acc = {},
      item = {};
    const A = (a) =>
      (acc[a] ||= { trades: 0, sold: 0, bought: 0, coinsIn: 0, coinsOut: 0, runs: 0, found: 0, runCoins: 0, mins: {} });
    const I = (id) => (item[id] ||= { sold: 0, bought: 0, paid: 0, took: 0, found: 0 });
    for (const l of text.split('\n')) {
      let r;
      try {
        r = l && JSON.parse(l);
      } catch {}
      if (!r || typeof r.a !== 'string') continue;
      const a = A(r.a);
      if (r.k === 'sell' || r.k === 'wbuy') {
        const n = Number.isSafeInteger(r.n) ? r.n : 0,
          c = Math.abs(Number.isSafeInteger(r.c) ? r.c : 0),
          it = I(r.id);
        a.trades++;
        const m = Math.floor(r.t / 60e3);
        a.mins[m] = (a.mins[m] || 0) + 1;
        if (r.k === 'sell') {
          a.sold += n;
          a.coinsIn += c;
          it.sold += n;
          it.paid += c;
        } else {
          a.bought += n;
          a.coinsOut += c;
          it.bought += n;
          it.took += c;
        }
      } else if (r.k === 'run') {
        a.runs++;
        a.runCoins += Number.isSafeInteger(r.c) ? r.c : 0;
        for (const [id, n] of Array.isArray(r.items) ? r.items : [])
          if (Number.isSafeInteger(n)) {
            a.found += n;
            I(id).found += n;
          }
      }
    }
    const shelf = walt.view().stock,
      checks = [];
    const accounts = Object.entries(acc)
      .map(([a, s]) => {
        const { mins, ...rest } = s;
        const peak = Math.max(0, ...Object.values(mins));
        if (peak >= FAST) checks.push({ acc: who(a), check: 'fast', peak });
        if (s.sold > s.found + OUTSOLD) checks.push({ acc: who(a), check: 'outsold', sold: s.sold, found: s.found });
        return { acc: who(a), ...rest, peak };
      })
      .sort((x, y) => y.trades - x.trades || y.runs - x.runs);
    const items = E.ITEMS.filter((it) => it.base > 0).map((it) => {
      const stock = shelf[it.id] || 0,
        buy = E.buyPrice(it.id, stock),
        s = item[it.id] || { sold: 0, bought: 0, paid: 0, took: 0, found: 0 };
      if (stock > it.norm * PILE) checks.push({ item: it.id, check: 'pile', stock, norm: it.norm });
      if (buy <= E.MIN_PRICE) checks.push({ item: it.id, check: 'floor', buy });
      return {
        id: it.id,
        name: names[it.id] || it.id,
        ...s,
        stock,
        norm: it.norm,
        buy,
        sell: E.sellPrice(it.id, stock),
      };
    });
    const total = accounts.reduce(
      (t, a) => ({
        accounts: t.accounts + 1,
        trades: t.trades + a.trades,
        runs: t.runs + a.runs,
        coinsIn: t.coinsIn + a.coinsIn,
        coinsOut: t.coinsOut + a.coinsOut,
      }),
      { accounts: 0, trades: 0, runs: 0, coinsIn: 0, coinsOut: 0 },
    );
    return { day: d, total, items, accounts, checks };
  }

  // the model's word on the sums: { summary, flags: [{ acc | item, why }] } (a flag only for an account or an item in the
  // sums), or null without NEAR AI or a reply fit to keep
  async function words(s) {
    if (!ai.on() || !s.total.trades) return null;
    const moving = s.items.filter((i) => i.sold || i.bought || i.found || s.checks.some((c) => c.item === i.id));
    const r = await ai.json(
      [
        {
          role: 'system',
          content:
            'You watch the market of the game Meow Division for its designers. Players sell Walt, the trader, what ' +
            'their runs found and buy what others sold him. His price for an item falls as his shelf of it fills ' +
            '(buy = base × 2 × norm / (norm + stock), sell about 1.4 × that), his shelf loses 5 % a day. The server ' +
            'checks every trade and every run, so nobody can cheat a price; look for what the designers should know: ' +
            'an item that piles up or never moves, a price stuck at its floor, coins flowing too fast one way, an ' +
            'account that trades much faster than a person can or sells much more than its runs found. Plain words, ' +
            'no guesses beyond the numbers. Reply with a JSON object only.',
        },
        {
          role: 'user',
          content:
            `Language: ${lang}. The day ${s.day} (UTC), its sums:\n` +
            JSON.stringify({ total: s.total, items: moving, accounts: s.accounts.slice(0, TOP), checks: s.checks }) +
            '\nReply as {"summary": "<three to five sentences>", "flags": [{"acc": "<account>", "why": "<one sentence>"}, ' +
            '{"item": "<item id>", "why": "<one sentence>"}]}; flags only for what looks off, none if nothing does.',
        },
      ],
      { maxTokens: 900, temperature: 0.3 },
    );
    const txt = (t, max) =>
      typeof t === 'string' && t.trim() && !/[<>`]/.test(t) ? t.replace(/\s+/g, ' ').trim().slice(0, max) : null;
    const summary = txt(r.summary, 1200);
    if (!summary) return null;
    const accs = new Set(s.accounts.map((a) => a.acc)),
      ids = new Set(s.items.map((i) => i.id));
    const flags = (Array.isArray(r.flags) ? r.flags : [])
      .map((f) =>
        f && txt(f.why, 300)
          ? accs.has(f.acc)
            ? { acc: f.acc, why: txt(f.why, 300) }
            : ids.has(f.item)
              ? { item: f.item, why: txt(f.why, 300) }
              : null
          : null,
      )
      .filter(Boolean)
      .slice(0, 12);
    return { model: ai.model, summary, flags };
  }

  // one look at a day: its sums, the checks and the model's word, kept and logged (final: the day is over)
  async function look(d, final) {
    const s = await sums(d);
    let said = null;
    try {
      said = await words(s);
    } catch (e) {
      log.warn('market watch: NEAR AI not asked', e.message);
    }
    const out = { at: now(), final, ...s, ai: said };
    await fsp.writeFile(file(d, '.watch.json.tmp'), JSON.stringify(out, null, 1));
    await fsp.rename(file(d, '.watch.json.tmp'), file(d, '.watch.json'));
    const t = s.total;
    log.log(
      `market watch ${d}${final ? '' : ' so far'}: ${t.accounts} accounts, ${t.trades} trades, ${t.runs} runs, ` +
        `coins paid ${t.coinsIn}, taken ${t.coinsOut}; checks: ${s.checks.map((c) => `${c.acc || c.item} ${c.check}`).join(', ') || 'none'}`,
    );
    if (said) {
      log.log(`market watch ${d} (NEAR AI): ${said.summary}`);
      for (const f of said.flags) log.log(`market watch ${d} flag ${f.acc || f.item}: ${f.why}`);
    }
    return out;
  }
  function once(d, final) {
    if (looking) return looking;
    looking = q
      .then(() => look(d, final))
      .catch((e) => log.warn('market watch: no look at', d, e.message))
      .finally(() => (looking = null));
    return looking;
  }
  // every quarter of an hour: yesterday's last look, once (a log there and no final look yet), and today's every EVERY
  // when there were trades or runs since the last
  async function tick() {
    const t = now(),
      d = dayOf(t),
      y = dayOf(t - 864e5);
    if (!fs.existsSync(file(y, '.done')) && fs.existsSync(file(y))) {
      await once(y, true);
      await fsp.writeFile(file(y, '.done'), '').catch(() => {});
    }
    const s = seen.get(d);
    if (s && s.n > s.looked && t - s.at >= EVERY) {
      s.at = t;
      s.looked = s.n;
      await once(d, false);
    }
  }
  return {
    // a trade done (POST /api/act): k 'sell' | 'wbuy', how many, the coins it moved (c: + paid, − taken)
    trade: (a, k, id, n, c) => write({ a, k, id, n, c }),
    // a run paid (its replay: rules.js bank): its loot [[id, n]] and coins
    run: (a, items, c) => write({ a, k: 'run', items, c }),
    tick,
    look: once,
    sums,
    start() {
      setInterval(() => tick().catch(() => {}), 15 * 60e3).unref();
      setTimeout(() => tick().catch(() => {}), 60e3).unref();
    },
    flushed: () => q,
  };
}
