// server/walt.mjs — Walt's shelf on the game's server (docs/design.md, "Walt's market"): what he holds of each item,
// one shelf for every player, his prices worked out from it (live/economy.js). Players' sales fill it and their buys
// empty it (live/rules.js trade, applied by POST /api/act); between them the other players' days go by
// (economy.js otherPlayersDay: a few sales and buys, then the day's decay), one for each day since the last one seen,
// so a shelf left alone thins out and a new server opens with a week of trading behind it (FAST_FORWARD.days).
// Kept in DATA_DIR/walt.json: { day, stock: { id: n }, recent: { id: n sold by players today }, rest: { id: the decay's
// hundredths carried to the next day (economy.js decayDay) } } (a file from before rest: none carried yet).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DAY = 864e5;
const today = () => Math.floor(Date.now() / DAY);

export function makeWalt(DATA, E) {
  const file = path.join(DATA, 'walt.json');
  let st = null;
  try {
    st = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('walt: shelf unreadable, opening a new one', e.message);
  }
  if (!st || typeof st !== 'object' || !Number.isInteger(st.day))
    st = { day: today() - E.FAST_FORWARD.days, stock: {} };
  st.stock = clean(st.stock);
  // an item that became the players' own only (economy.js band): the ones the other players' days had put on his shelf
  // go, once (st.own: the ids done)
  st.own = Array.isArray(st.own) ? st.own.filter((id) => typeof id === 'string') : [];
  for (const it of E.ITEMS)
    if (it.band && !st.own.includes(it.id)) {
      delete st.stock[it.id];
      st.own.push(it.id);
    }
  st.recent = clean(st.recent);
  st.rest = clean(st.rest, 99);
  let dirty = true,
    writing = null;
  function clean(o, most = Infinity) {
    const out = {};
    for (const it of E.ITEMS) {
      const n = o && Number.isInteger(o[it.id]) ? o[it.id] : 0;
      if (n > 0 && n <= most && E.tradable(it.id)) out[it.id] = n;
    }
    return out;
  }
  // the days gone by since the shelf was last seen, each one the other players' (at most a month: a server
  // asleep longer opens on an emptied shelf all the same)
  function catchUp() {
    const now = today();
    if (st.day >= now) return;
    for (let d = Math.max(st.day, now - 30); d < now; d++) E.otherPlayersDay(st.stock, Math.random, st.rest);
    st.day = now;
    st.recent = {};
    basics();
    dirty = true;
  }
  // the cheap parts the base tutorial asks for (economy.js WALT_BASICS): each morning his shelf holds at least these.
  // The generator's and the workbench's first-level parts (ALWAYS) are put back after every purchase as well (traded),
  // so a crowd of new players building the two at once never finds them bought out; the medbay's parts keep to the
  // morning (his wallet follows the shelf, server/chain.mjs)
  const ALWAYS = new Set(
    (E.BUILDINGS || [])
      .filter((b) => b.id === 'generator' || b.id === 'workbench')
      .flatMap((b) => ((b.levels[0] && b.levels[0].items) || []).map((it) => it[0])),
  );
  function basics(only) {
    for (const [id, n] of Object.entries(E.WALT_BASICS || {}))
      if ((!only || only.has(id)) && E.tradable(id) && (st.stock[id] || 0) < n) {
        st.stock[id] = n;
        dirty = true;
      }
  }
  async function save() {
    if (writing || !dirty) return;
    dirty = false;
    writing = (async () => {
      await fsp.mkdir(DATA, { recursive: true });
      await fsp.writeFile(file + '.tmp', JSON.stringify(st));
      await fsp.rename(file + '.tmp', file);
    })()
      .catch((e) => {
        dirty = true;
        console.warn('walt: shelf not saved', e.message);
      })
      .finally(() => {
        writing = null;
        if (dirty) setTimeout(save, 2000);
      });
  }
  catchUp();
  basics(); // (a server updated today: the parts on the shelf at once)
  save();
  return {
    // what the market screen shows (GET /api/walt): the shelf, today's sales by players, the day
    view() {
      catchUp();
      save();
      return { stock: { ...st.stock }, recent: { ...st.recent }, day: st.day };
    },
    // the trade's context for rules.js act: the live shelf (the rules change it) and today's sales by players (read:
    // his answer to haggling)
    ctx() {
      catchUp();
      return { stock: st.stock, recent: st.recent };
    },
    // a sale undone (the player's wallet refused to give the items up: server/chain.mjs, its coins taken back): what it
    // put on the shelf and into today's sales taken off again, as far as they are still there
    unsold(items) {
      for (const [id, n] of Object.entries(items || {})) {
        if (!Number.isSafeInteger(n) || n <= 0) continue;
        for (const o of [st.stock, st.recent]) {
          const left = (o[id] || 0) - n;
          if (left > 0) o[id] = left;
          else delete o[id];
        }
      }
      dirty = true;
      save();
    },
    // a trade done (rules.js act said yes): today's sales counted, the shelf kept (n: a whole count, as the rules took it)
    traded(a) {
      const n = Number.isSafeInteger(a.n) && a.n > 0 ? a.n : 0;
      if (a.k === 'sell' && n && E.tradable(a.id)) st.recent[a.id] = (st.recent[a.id] || 0) + n;
      if (a.k === 'wbuy') basics(ALWAYS); // (the generator's and the workbench's parts just bought are back at once)
      dirty = true;
      save();
    },
  };
}
