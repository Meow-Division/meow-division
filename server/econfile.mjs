// server/econfile.mjs — the file work behind the economy page (live/econ.html, local only: server --editor). Reads what the
// page shows out of live/economy.js, live/data.js and the Russian pack; checks what the page sends back; writes only the
// tables between economy.js's <loot>, <recipes>, <buildings> and <upgrades> markers and the upgrade price arrays in
// data.js, every other line staying as it was; formats both with the repo's Prettier (a dev dependency, installed
// wherever the editor runs).
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const LIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live');
export const FILES = {
  econ: path.join(LIVE, 'economy.js'),
  data: path.join(LIVE, 'data.js'),
  ru: path.join(LIVE, 'lang_ru.js'),
};
const REGIONS = { loot: 'LOOT', recipes: 'RECIPES', buildings: 'BUILDINGS', upgrades: 'UPGRADES' };
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });

// a browser script's module.exports, run apart from the server's own globals
const run = (text, extra) => {
  const box = { module: { exports: {} }, ...extra };
  vm.runInNewContext(text, box, { timeout: 2000 });
  return box.module.exports;
};
export const stampOf = (econ, data) =>
  crypto
    .createHash('sha1')
    .update(econ + '\0' + data)
    .digest('hex');

export async function readEcon() {
  const [econ, data, ru] = await Promise.all([FILES.econ, FILES.data, FILES.ru].map((f) => fsp.readFile(f, 'utf8')));
  let pack = {};
  run(ru, { I18N: { pack: (lang, p) => (pack = p) } });
  return { econ, data, E: run(econ), D: run(data), pack, stamp: stampOf(econ, data) };
}

// what the page gets: the editable tables as they are, plus the names and limits it shows them with
export function pageState({ E, D, pack, stamp }) {
  const names = pack.item || {},
    meta = pack.meta || {};
  return {
    stamp,
    items: E.ITEMS.map((it) => ({ id: it.id, kind: it.kind, rarity: it.rarity, name: names[it.id] || it.id })),
    loot: E.LOOT,
    recipes: E.RECIPES,
    buildings: E.BUILDINGS,
    upgrades: E.UPGRADES,
    missions: E.MISSIONS.filter((m) => !m.soon).map((m) => ({ id: m.id, n: m.n, map: m.map, items: m.reward.items })),
    meta: Object.keys(D.META).map((id) => ({
      id,
      icon: D.META[id].icon,
      max: D.META[id].max,
      price: D.META[id].price,
      name: meta[id]?.name || id,
      desc: meta[id]?.desc || '',
    })),
    weapon: Object.keys(D.WEAPON_UP).map((id) => ({ id, per: D.WEAPON_UP[id].per, price: D.WEAPON_UP[id].price })),
    bag: { slots: E.BAG_SLOTS, stack: E.STACK },
  };
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const sameCount = (a, b, where) => {
  if (!Array.isArray(a) || a.length !== b.length) throw bad(`${where}: expected ${b.length}`);
};

// the page's edit checked against the files as they are now; returns the clean tables to write. The page changes numbers
// and item lists only: which maps, recipes, buildings, levels and upgrades exist, and what a level opens, stay as the
// files have them.
export function applyEdit(q, { E, D }) {
  const kindOf = (id) => E.ITEMS.find((it) => it.id === id)?.kind;
  const material = (id) => kindOf(id) === 'material';
  const stuff = (id) => material(id) || kindOf(id) === 'trophy';
  const pairs = (v, where, ok) => {
    if (!Array.isArray(v) || v.length > 12) throw bad(`${where}: a list of up to 12 items`);
    const seen = new Set();
    return v.map((p) => {
      if (!Array.isArray(p) || p.length !== 2 || !ok(p[0]) || !int(p[1], 1, 999) || seen.has(p[0]))
        throw bad(`${where}: bad item ${JSON.stringify(p)}`);
      seen.add(p[0]);
      return [p[0], p[1]];
    });
  };

  sameCount(q.loot, E.LOOT, 'loot');
  const loot = E.LOOT.map((cur, i) => {
    const l = q.loot[i],
      w = 'loot ' + cur.map;
    if (!l || l.map !== cur.map) throw bad(w + ': maps out of order');
    if (!int(l.rolls, 1, 10) || !int(l.boxes, 1, 200)) throw bad(w + ': rolls 1..10, boxes 1..200');
    if (!Array.isArray(l.table) || l.table.length < 1 || l.table.length > 40) throw bad(w + ': 1..40 entries');
    const seen = new Set();
    const table = l.table.map((e) => {
      const fine =
        Array.isArray(e) &&
        e.length === 4 &&
        material(e[0]) &&
        !seen.has(e[0]) &&
        int(e[1], 1, 1000) &&
        int(e[2], 1, 99) &&
        int(e[3], e[2], 99);
      if (!fine) throw bad(`${w}: bad entry ${JSON.stringify(e)}`);
      seen.add(e[0]);
      return [e[0], e[1], e[2], e[3]];
    });
    return { map: cur.map, rolls: l.rolls, boxes: l.boxes, table };
  });

  sameCount(q.recipes, E.RECIPES, 'recipes');
  const recipes = E.RECIPES.map((cur, i) => {
    const r = q.recipes[i],
      w = 'recipe ' + cur.id;
    if (!r || r.id !== cur.id) throw bad(w + ': recipes out of order');
    if (!int(r.coins, 0, 1e6)) throw bad(w + ': coins 0..1000000');
    const inputs = pairs(r.inputs, w, material);
    if (!inputs.length) throw bad(w + ': needs at least one item');
    return { id: cur.id, at: cur.at, level: cur.level, coins: r.coins, inputs, output: cur.output };
  });

  sameCount(q.buildings, E.BUILDINGS, 'buildings');
  const buildings = E.BUILDINGS.map((cur, i) => {
    const b = q.buildings[i],
      w = 'building ' + cur.id;
    if (!b || b.id !== cur.id) throw bad(w + ': buildings out of order');
    sameCount(b.levels, cur.levels, w + ' levels');
    const levels = cur.levels.map((cl, n) => {
      const l = b.levels[n];
      if (!l || !int(l.coins, 1, 1e6)) throw bad(`${w} ${n + 1}: coins 1..1000000`);
      return { coins: l.coins, items: pairs(l.items, `${w} ${n + 1}`, stuff), power: cl.power, opens: cl.opens };
    });
    return cur.lockedBy ? { id: cur.id, lockedBy: cur.lockedBy, levels } : { id: cur.id, levels };
  });

  const groups = {
    meta: Object.keys(D.META).map((id) => [id, D.META[id].price.length]),
    weapon: Object.keys(D.WEAPON_UP).map((id) => [id, D.WEAPON_UP[id].price.length]),
  };
  const upgrades = {},
    prices = {};
  for (const [g, list] of Object.entries(groups)) {
    upgrades[g] = {};
    prices[g] = {};
    for (const [id, n] of list) {
      const w = `upgrade ${g}.${id}`,
        items = q.upgrades?.[g]?.[id],
        coins = q.prices?.[g]?.[id];
      sameCount(items, Array(n), w);
      sameCount(coins, Array(n), w + ' coins');
      if (!coins.every((c) => int(c, 1, 1e6))) throw bad(w + ': coins 1..1000000');
      upgrades[g][id] = items.map((lv, k) => pairs(lv, `${w} ${k + 1}`, stuff));
      prices[g][id] = coins.slice();
    }
  }
  return { loot, recipes, buildings, upgrades, prices };
}

// a value as a JavaScript literal in the repo's style (Prettier lays it out afterwards)
const lit = (v) => {
  if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
  if (v && typeof v === 'object') {
    const kv = Object.entries(v).map(([k, x]) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`) + ': ' + lit(x));
    return kv.length ? '{ ' + kv.join(', ') + ' }' : '{}';
  }
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  return String(v);
};

// economy.js with the four marked tables written anew
export function econSource(text, t) {
  for (const [key, name] of Object.entries(REGIONS)) {
    const re = new RegExp(`(\\n[ \\t]*// <${key}>\\n)[\\s\\S]*?(\\n[ \\t]*// </${key}>)`);
    if (!re.test(text)) throw bad(`economy.js has no <${key}> markers`, 500);
    text = text.replace(re, (all, open, close) => `${open}  E.${name} = ${lit(t[key])};${close}`);
  }
  return text;
}

// data.js with the upgrade price arrays replaced (D.META and D.WEAPON_UP share ids such as dmg: each block on its own)
export function dataSource(text, prices) {
  for (const [name, g] of [
    ['META', 'meta'],
    ['WEAPON_UP', 'weapon'],
  ]) {
    const start = text.indexOf(`\n  D.${name} = {\n`),
      end = text.indexOf('\n  };', start);
    if (start < 0 || end < 0) throw bad(`data.js has no D.${name} block`, 500);
    let block = text.slice(start, end);
    for (const [id, arr] of Object.entries(prices[g])) {
      const re = new RegExp(`(\\n    ${id}: \\{[^\\n]*price: \\[)[^\\]]*(\\])`);
      if (!re.test(block)) throw bad(`data.js has no price line for D.${name}.${id}`, 500);
      block = block.replace(re, (all, a, b) => a + arr.join(', ') + b);
    }
    text = text.slice(0, start) + block + text.slice(end);
  }
  return text;
}

export async function formatJs(text, file) {
  let prettier;
  try {
    prettier = await import('prettier');
  } catch (e) {
    console.warn('econfile: prettier not installed, writing unformatted', e.message);
    return text;
  }
  return prettier.format(text, { ...(await prettier.resolveConfig(file)), filepath: file });
}

// the page's save: checked, written (both files load before either is replaced), and the new state for the page
export async function saveEcon(q) {
  const cur = await readEcon();
  if (q.stamp !== cur.stamp)
    throw bad('economy.js or data.js changed since the page loaded them: reload the page', 409);
  const t = applyEdit(q, cur);
  const econ = await formatJs(econSource(cur.econ, t), FILES.econ),
    data = await formatJs(dataSource(cur.data, t.prices), FILES.data);
  run(econ);
  run(data);
  for (const [f, now, was] of [
    [FILES.econ, econ, cur.econ],
    [FILES.data, data, cur.data],
  ]) {
    if (now === was) continue;
    await fsp.writeFile(f + '.tmp', now);
    await fsp.rename(f + '.tmp', f);
  }
  return pageState(await readEcon());
}
