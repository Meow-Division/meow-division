// server/waltai.mjs — Walt's words by NEAR AI (server/nearai.mjs), in the player's language: a note on how his market
// stands today, said when Copper walks up to his counter, and a line for each item at its price's state (short, glut,
// fair, trophy: economy.js explain), said when the item is picked. The model writes words only. Every number in them is
// a slot ({buy}, {gears.sell}…) that the page fills in from the formula (economy.js, the shelf it holds), and a reply with
// a digit, an unknown slot, markup or the wrong alphabet in it is thrown away: a price never comes from the model.
// Asked in the background, never while a player waits: GET /api/walt hands out what is ready (pending: more on its way)
// and the window keeps its plain texts meanwhile, and for good without NEAR AI.
// A line once made serves again whenever its item is in that state (two of them, said in turn); a note is made again
// when the day changes or the items it speaks of do (picks: the commonest item he is short of, the one he is fullest
// of, the one players brought most today).
// Kept in DATA/waltai.json: { lines: { 'ru:gears:short': [text, text] }, notes: { ru: { sig, t, at } } }.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

export const LANGS = { en: 'English', ru: 'Russian', uk: 'Ukrainian', es: 'Spanish' };
// a language the game speaks. Asked by name only (never LANGS[lang]: the page's word is the key, and 'constructor' or
// '__proto__' are there on any object, each one a language to pay the model for)
export const isLang = (lang) => typeof lang === 'string' && Object.hasOwn(LANGS, lang);
const LINE_MAX = 120,
  NOTE_MAX = 240,
  VARIANTS = 2,
  BATCH = 13, // (items a call: a reply of about 1 000 tokens, 10–15 s; all 26 in one ran past 30 s in Ukrainian)
  HOT = 3, // (players' sales of an item today before the note calls it the day's)
  NOTE_GAP = 10 * 60e3, // (a note made at most this often a language, the shelf going back and forth)
  LINE_GAP = 60e3,
  FAIL_GAP = 5 * 60e3, // (after a call that failed)
  TRIES = 3; // (a line the replies kept failing: left to the plain text until the server restarts)
const LINE_SLOTS = new Set(['stock', 'norm', 'buy', 'sell']);

// the language packs' item names (live/lang_*.js, run here with an I18N that only keeps them)
export function packsFrom(dir) {
  const packs = {};
  for (const code of Object.keys(LANGS)) {
    try {
      const src = fs.readFileSync(path.join(dir, `lang_${code}.js`), 'utf8');
      vm.runInNewContext(src, { I18N: { pack: (c, def) => (packs[c] = def) } }, { timeout: 2000 });
    } catch (e) {
      console.warn(`walt ai: lang_${code}.js unread`, e.message);
    }
  }
  return packs;
}

// a reply's text kept only when it is safe to show: one line, short enough, no digits (in any script), no slot but the
// ones allowed, no markup or links, in the language's alphabet. Returns the text tidied, or null
const CYR = /[а-яёіїєґ]/i;
const SCRIPT = {
  en: (s) => !CYR.test(s),
  es: (s) => !CYR.test(s),
  ru: (s) => CYR.test(s) && !/[іїєґ]/i.test(s),
  uk: (s) => CYR.test(s) && !/[ыэъё]/i.test(s),
};
export function clean(t, slots, max, lang) {
  if (typeof t !== 'string') return null;
  t = t
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«“„]+|["'»”]+$/g, '')
    .trim();
  if (t.length < 8 || t.length > max) return null;
  let bad = false;
  const words = t.replace(/\{([^{}]*)\}/g, (m, n) => {
    if (!slots.has(n)) bad = true;
    return ' ';
  });
  if (bad || /[{}<>`*#_\\[\]|~^=]|\p{Nd}|https?:|www\./iu.test(words)) return null;
  return (Object.hasOwn(SCRIPT, lang) ? SCRIPT[lang] : SCRIPT.en)(words) ? t : null;
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const stateOf = (E, id, stock, recent) =>
  E.explain(id, stock || 0, recent || 0)
    .key.split('.')
    .pop();

// what the day's note speaks of (materials only): the item he is short of (the commonest first: a rare one is short
// most days; among them one by the day), the one his shelf is fullest of, the one players brought most today (at least
// HOT). Each with its numbers (the model's to read, never to write) and the slots its sentence may hold
export function picks(E, stock, recent, day) {
  const all = E.ITEMS.filter((it) => it.base > 0 && it.kind === 'material').map((it) => {
    const w = E.explain(it.id, stock[it.id] || 0, recent[it.id] || 0);
    return { id: it.id, rarity: it.rarity, state: w.key.split('.').pop(), ...w.vars };
  });
  const tie = (a, b) => hash(day + a.id) - hash(day + b.id);
  const out = [];
  const add = (f, state) => f && !out.some((o) => o.id === f.id) && out.push({ ...f, state });
  add(all.filter((f) => f.state === 'short').sort((a, b) => a.rarity - b.rarity || tie(a, b))[0], 'short');
  add(
    all.filter((f) => f.state === 'glut').sort((a, b) => b.stock / b.norm - a.stock / a.norm || tie(a, b))[0],
    'glut',
  );
  add(all.filter((f) => f.recent >= HOT).sort((a, b) => b.recent - a.recent || tie(a, b))[0], 'hot');
  return out.map(({ rarity, ...f }) => f);
}
const sigOf = (day, facts) => day + '|' + facts.map((f) => f.id + ':' + f.state).join(',');
const noteSlots = (facts) =>
  new Set(facts.flatMap((f) => [f.id + '.buy', f.id + '.stock', ...(f.stock > 0 ? [f.id + '.sell'] : [])]));

const WALT =
  'You write what Walt says in the game Meow Division. Walt is a cat, the quartermaster of NEAR Base, a bunker under ' +
  'a San Francisco office overrun by zombies. Copper, the player, a cat operative, got him out of the office; now Walt ' +
  'buys what Copper finds on his runs and sells what the other players brought him. Walt talks plainly and calmly, like ' +
  'a shopkeeper who knows his shelf: short sentences, friendly, a dry remark at most. No metaphors, no slogans, no ' +
  'exclamation marks, no emojis. He speaks to Copper as "you" (Russian and Ukrainian: ты, Spanish: tú). ' +
  'Reply with a JSON object only.';

export function makeWaltAI({ dataDir, E, ai, packs, log = console, gaps = {} }) {
  const G = { line: LINE_GAP, note: NOTE_GAP, fail: FAIL_GAP, ...gaps }; // (the tests: shorter)
  const file = path.join(dataDir, 'waltai.json');
  let st = { lines: {}, notes: {} };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(j.lines || {}))
      if (Array.isArray(v) && v.length && v.every((t) => typeof t === 'string')) st.lines[k] = v.slice(0, VARIANTS);
    for (const [l, n] of Object.entries(j.notes || {}))
      if (isLang(l) && n && typeof n.sig === 'string' && typeof n.t === 'string') st.notes[l] = n;
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('walt ai: waltai.json unreadable, starting anew', e.message);
  }
  let dirty = false,
    writing = null;
  function save() {
    if (writing || !dirty) return;
    dirty = false;
    writing = (async () => {
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.writeFile(file + '.tmp', JSON.stringify(st));
      await fsp.rename(file + '.tmp', file);
    })()
      .catch((e) => {
        dirty = true;
        log.warn('walt ai: not saved', e.message);
      })
      .finally(() => {
        writing = null;
        if (dirty) setTimeout(save, 2000).unref?.();
      });
  }
  const name = (lang, id) => packs?.[lang]?.item?.[id] || packs?.en?.item?.[id] || id;
  // one job a kind and language at a time, and not again before its gap: true while one runs (the page asks again)
  const busy = new Map(),
    next = new Map(),
    tries = new Map();
  function kick(job, gap, fn) {
    if (busy.has(job)) return true;
    if (!ai.on() || Date.now() < (next.get(job) || 0)) return false;
    const p = fn()
      .then(() => next.set(job, Date.now() + gap))
      .catch((e) => {
        next.set(job, Date.now() + G.fail);
        log.warn(`walt ai: ${job} not made:`, e.message);
      })
      .finally(() => busy.delete(job));
    busy.set(job, p);
    return true;
  }

  async function makeLines(lang, want) {
    for (let i = 0; i < want.length; i += BATCH) {
      const part = want.slice(i, i + BATCH);
      const items = part.map(({ id, s }) => ({ id, name: name(lang, id), state: s, kind: E.item(id).kind }));
      const r = await ai.json(
        [
          { role: 'system', content: WALT },
          {
            role: 'user',
            content:
              `Task: lines. Language: ${LANGS[lang]}.\n` +
              `For each item below write ${VARIANTS} different lines Walt says when Copper looks at that item at his ` +
              'counter. Each line at most 100 characters, one or two short sentences. The line gives the reason for his ' +
              'price, from the state of his shelf:\n' +
              '- short: he holds few of it, fewer than he needs, so he pays more than usual;\n' +
              '- glut: his shelf is full of it, more than he needs, so he pays little for it;\n' +
              '- fair: he holds about as many as he needs, an ordinary price;\n' +
              "- trophy: a boss's trophy, rare, he pays well for it.\n" +
              'Write no digits and no numbers in words. Where a number goes, put a slot and the game fills the number ' +
              'in: {stock} how many he holds, {norm} how many he likes to hold, {buy} what he pays for one, {sell} what ' +
              'he asks for one. One or two slots a line, at least one. Any number must read right in the slot: never a ' +
              'counted noun right after a slot (not "{stock} pieces"; "on the shelf: {stock}" is right).\n' +
              'Name the item as given, in the form the sentence needs, or say it/them.\n' +
              `Items: ${JSON.stringify(items)}\n` +
              'Reply as {"<id>": ["<line>", "<line>"]} with every id.',
          },
        ],
        { maxTokens: 1800, temperature: 0.9 },
      );
      let got = 0;
      for (const { id, s } of part) {
        const k = `${lang}:${id}:${s}`,
          v = [].concat(r[id] || []).map((t) => clean(t, LINE_SLOTS, LINE_MAX, lang)),
          ok = [...new Set(v.filter(Boolean))].slice(0, VARIANTS);
        if (ok.length) {
          st.lines[k] = ok;
          got++;
        } else tries.set(k, (tries.get(k) || 0) + 1);
      }
      dirty = true;
      save();
      if (!got) throw new Error('no line in the reply was fit to show');
    }
  }

  async function makeNote(lang, facts, sig) {
    const items = facts.map((f) => ({ ...f, name: name(lang, f.id) }));
    const r = await ai.json(
      [
        { role: 'system', content: WALT },
        {
          role: 'user',
          content:
            `Task: note. Language: ${LANGS[lang]}.\n` +
            "Copper walks up to Walt's counter. Write what Walt says first: a word on how his market stands today, " +
            'one or two short sentences, at most 200 characters in all. Speak of the items below (all of them, or the ' +
            'two that matter most):\n' +
            '- short: he has few of it and pays more for it now, a good thing to bring him;\n' +
            '- glut: his shelf is full of it, he pays little for it now;\n' +
            '- hot: the players brought him a lot of it today.\n' +
            'Their numbers are there for you to know how things stand. Write no digits and no numbers in words. To ' +
            'give a number put a slot the game fills in: {<id>.buy} what he pays for one, {<id>.sell} what he asks for ' +
            'one (only where he holds some), {<id>.stock} how many he holds; at most two slots, never a counted noun ' +
            'right after one.\n' +
            'Name the items as given, in the form the sentence needs.\n' +
            `Items: ${JSON.stringify(items)}\n` +
            'Reply as {"note": "<what he says>"}.',
        },
      ],
      { maxTokens: 400, temperature: 0.9 },
    );
    const t = clean(r.note, noteSlots(facts), NOTE_MAX, lang);
    if (!t) throw new Error('the note was not fit to show');
    st.notes[lang] = { sig, t, at: Date.now() };
    dirty = true;
    save();
  }

  return {
    // the words for GET /api/walt?lang=: each tradable item's lines in its state now ({ id: { s, t: [..] } }; the page
    // shows them while the item is in that state on its shelf too), the note when one is made for the shelf as it is
    // now ({ t, sig }), pending while a call for the missing ones runs. view: WALT.view()
    words(lang, view) {
      lang = isLang(lang) ? lang : 'en';
      const out = { lines: {}, note: null, pending: false };
      const want = [];
      for (const it of E.ITEMS) {
        if (!(it.base > 0)) continue;
        const s = stateOf(E, it.id, view.stock[it.id], view.recent[it.id]),
          k = `${lang}:${it.id}:${s}`;
        if (st.lines[k]) out.lines[it.id] = { s, t: st.lines[k] };
        else if ((tries.get(k) || 0) < TRIES) want.push({ id: it.id, s });
      }
      if (want.length && kick('lines:' + lang, G.line, () => makeLines(lang, want))) out.pending = true;
      const facts = picks(E, view.stock, view.recent, view.day),
        sig = sigOf(view.day, facts),
        n = st.notes[lang];
      if (facts.length && n && n.sig === sig) out.note = { t: n.t, sig };
      else if (facts.length && kick('note:' + lang, G.note, () => makeNote(lang, facts, sig))) out.pending = true;
      return out;
    },
    // (the tests: every job running now done)
    settled: () => Promise.allSettled([...busy.values()]),
  };
}
