// server/bossmind.mjs — what a final boss learns between runs (REV 30: live/sim.js MIND). The replay sums up each run's
// fight with the final boss (SIM.fight: how long it took, where the hero kept and which way he went, what hit him, the
// gun); the account's record keeps the last few with each boss (rec.boss[k].fights). After a fight the hero won, the
// boss thinks it over in the background: NEAR AI (server/nearai.mjs) reads those fights and picks one or two of his
// tactics from the fixed menu (two when the hero beat him fast) and writes what Nova says about it on the radio, in the
// four languages. Without NEAR AI, or with a reply not fit to keep, plain rules pick (one who fights up close: more rings
// or he keeps away; one far off: more zombies; then his fiercer phases sooner… — REV 45: no aiming ahead or to the side
// the hero dodges to any more) and Nova says her plain line (the
// page's language pack, mind.*). A fight the hero lost: the boss forgets (nothing to answer).
// The pick waits in rec.boss[k].mind for the account's next run on that boss's map: POST /api/run/start puts it in the
// ticket ({ k, tac, side }), which the replay plays with, and hands the page Nova's line in its language. The model
// chooses among the menu's ids only and writes words only; what each tactic does is the sim's (MIND), the same for all.
import { LANGS, clean } from './waltai.mjs';

const GONE = ['lead', 'flank']; // (REV 45: tactics dropped — the aim ahead, the throws to the side he dodges to)
const FIGHTS = 5, // (the fights kept with each boss, the newest last)
  FAST = 45, // (a win under this many seconds: the boss answers with two tactics, else one)
  SAY_MAX = 160,
  ID = /^[a-z0-9_]{1,24}$/;
// a final boss's map: the lab's is the Devourer, the town's the Mushroom Monster (the office has none)
export const bossOf = (map) => (map === 'lab' ? 'heart' : map === 'office' ? null : 'golem');
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : 0);

export function makeBossMind({ ai, MIND, names = {}, log = console, now = () => Date.now() }) {
  const ids = Object.keys(MIND);
  const his = (k) => ids.filter((id) => MIND[id][k]);
  // a replay's fight made safe to keep (or null)
  function fight(f) {
    if (!f || typeof f !== 'object' || (f.k !== 'golem' && f.k !== 'heart')) return null;
    const by = f.by && typeof f.by === 'object' ? f.by : {};
    return {
      k: f.k,
      at: now(),
      dur: num(f.dur, 0, 3600),
      won: f.won ? 1 : 0,
      hp: num(f.hp, 0, 100),
      dist: num(f.dist, 0, 5000),
      left: num(f.left, 0, 100),
      right: num(f.right, 0, 100),
      still: num(f.still, 0, 100),
      hits: num(f.hits, 0, 1e5),
      hurt: num(f.hurt, 0, 1e7),
      by: Object.fromEntries(['wave', 'lump', 'pud', 'touch', 'adds'].map((s) => [s, num(by[s], 0, 1e7)])),
      gun: typeof f.gun === 'string' && ID.test(f.gun) ? f.gun : '',
      items: Array.isArray(f.items) ? f.items.filter((i) => typeof i === 'string' && ID.test(i)).slice(0, 12) : [],
      mind: Array.isArray(f.mind) ? f.mind.filter((i) => ids.includes(i)).slice(0, 2) : [],
    };
  }
  // the side the hero dodges to in his last fights with him: −1 left, 1 right (on screen), 0 neither by much
  function sideOf(fights) {
    const last = fights.slice(-3);
    if (!last.length) return 0;
    const b = last.reduce((s, f) => s + (f.right - f.left) / Math.max(1, f.left + f.right), 0) / last.length;
    return b <= -0.25 ? -1 : b >= 0.25 ? 1 : 0;
  }
  const many = (fights) => (fights[fights.length - 1].dur < FAST ? 2 : 1);
  // the plain rules' pick: { tac, side }
  function rules(k, fights) {
    const f = fights[fights.length - 1],
      side = sideOf(fights),
      want = [];
    if (f.dist < 300) want.push(k === 'golem' ? 'keep' : 'rings');
    if (f.dist >= 450) want.push('adds');
    want.push('rush', 'rings', 'adds');
    const tac = [...new Set(want)].filter((id) => MIND[id] && MIND[id][k]).slice(0, many(fights));
    return { tac, side };
  }
  const TAC = {
    rings:
      'hit all around yourself more often (the golem stamps whenever the hero comes close; the heart waves every 3 s)',
    keep: 'step back from a hero who comes close and throw more often',
    adds: 'call in more zombies',
    rush: 'reach your later, fiercer phases sooner',
  };
  const SAY =
    'say: what Nova tells Copper on the radio as the fight begins, in English, Russian, Ukrainian and Spanish: ' +
    'calm and short (one or two sentences, at most 140 characters), what the boss learnt from the last fights and ' +
    'what to watch for now. No numbers or digits, no names but Copper.';
  // Nova's words kept per language: those safe to show (waltai.mjs clean: no digits, markup or links, the language's
  // alphabet)
  function said(o) {
    const say = {};
    for (const lg of Object.keys(LANGS)) {
      const t = clean(o && o[lg], new Set(), SAY_MAX, lg);
      if (t) say[lg] = t;
    }
    return say;
  }
  // NEAR AI's pick: { tac, side, say: { lang: text } }, or null (no reply fit to keep)
  async function asked(k, fights) {
    const side = sideOf(fights),
      n = many(fights),
      menu = his(k);
    const r = await ai.json(
      [
        {
          role: 'system',
          content:
            `You are the mind of ${names[k] || k}, a final boss in the game Meow Division, a top-down zombie shooter ` +
            'where Copper, a cat soldier, fights you. Between runs you read how Copper fought you and choose how you ' +
            'fight him next time, from a fixed menu only. Nova, his commander, warns him on the radio about what you ' +
            'learnt. Reply with a JSON object only.',
        },
        {
          role: 'user',
          content:
            `Your tactics (choose exactly ${n}, the ones that answer how he beat you):\n` +
            menu.map((id) => `${id}: ${TAC[id] || id}`).join('\n') +
            '\nHis last fights with you, oldest first (dur: seconds from your first wound to your death; won 1: he ' +
            'killed you; hp: your health left, %; dist: his mean distance from you, px (300 is close, 600 far); left, ' +
            'right, still: % of the fight he moved left or right on screen, or stood; hits, hurt: what hit him and by ' +
            'what (wave: your rings, lump: your throws, pud: puddles, touch: your body, adds: your zombies); gun, ' +
            'items: what he fought with; mind: your tactics that fight):\n' +
            JSON.stringify(fights.map(({ at, k: _, ...f }) => f)) +
            `\nHe dodges ${side < 0 ? 'to the left' : side > 0 ? 'to the right' : 'to no side in particular'}.` +
            '\nReply as {"tac": ["<tactic>"], "why": "<one sentence>", "say": {"en": "…", "ru": "…", "uk": "…", ' +
            '"es": "…"}}, all three required. ' +
            SAY,
        },
      ],
      { maxTokens: 700, temperature: 0.7 },
    );
    const tac = [...new Set(Array.isArray(r.tac) ? r.tac : [])].filter((id) => menu.includes(id)).slice(0, n);
    if (!tac.length) return null;
    let say = said(r.say);
    if (!Object.keys(say).length)
      try {
        // (a reply with the tactics alone, as the model sometimes gives: Nova's words asked for on their own)
        const w = await ai.json(
          [
            {
              role: 'system',
              content:
                'You write radio lines for Nova, the commander in the game Meow Division, to Copper, a cat soldier. ' +
                'Reply with a JSON object only.',
            },
            {
              role: 'user',
              content:
                `${names[k] || k}, a boss Copper beat, learnt from the fight and now will: ` +
                tac.map((id) => TAC[id]).join('; ') +
                '.\nReply as {"say": {"en": "…", "ru": "…", "uk": "…", "es": "…"}}. ' +
                SAY,
            },
          ],
          { maxTokens: 400, temperature: 0.7 },
        );
        say = said(w.say);
      } catch (e) {
        log.warn(`boss mind: Nova's words for ${k} not asked`, e.message);
      }
    return { tac, side, say, why: typeof r.why === 'string' ? r.why.slice(0, 300) : '' };
  }
  // the boss's pick after a win: NEAR AI's, else the rules'
  async function think(k, fights) {
    if (ai.on())
      try {
        const m = await asked(k, fights);
        if (m) return { ...m, by: 'ai', at: now() };
        log.warn(`boss mind: NEAR AI's pick for ${k} not kept`);
      } catch (e) {
        log.warn(`boss mind: NEAR AI not asked for ${k}`, e.message);
      }
    return { ...rules(k, fights), say: {}, by: 'rules', at: now() };
  }
  return {
    fight,
    rules,
    sideOf,
    think,
    // a replay's fight into the record: kept with the boss's others; a win → { k, n, fights } to think over (the
    // boss's pick to come: set() it then), a loss → he forgets. null: no fight
    remember(rec, raw) {
      const f = fight(raw);
      if (!f) return null;
      const B = (rec.boss ||= {}),
        b = (B[f.k] ||= { n: 0, fights: [] });
      b.fights = (Array.isArray(b.fights) ? b.fights : []).concat(f).slice(-FIGHTS);
      b.n = (b.n | 0) + 1;
      rec.dirty = true;
      if (!f.won) {
        delete b.mind;
        return null;
      }
      return { k: f.k, n: b.n, fights: b.fights.slice() };
    },
    // the pick into the record, if no fight came in since it was asked for
    set(rec, job, m) {
      const b = rec.boss && rec.boss[job.k];
      if (!b || b.n !== job.n) return false;
      b.mind = m;
      rec.dirty = true;
      return true;
    },
    // the ticket's part for a run on this map: { k, tac, side }, or null
    ticket(rec, map) {
      const k = bossOf(map),
        m = k && rec.boss && rec.boss[k] && rec.boss[k].mind;
      if (!m || !Array.isArray(m.tac) || !m.tac.length) return null;
      const tac = m.tac.filter((id) => MIND[id] && MIND[id][k]).slice(0, 2); // (a tactic since dropped — lead, flank: REV 45 — left out)
      if (!tac.length) return null;
      return { k, tac, side: m.side === 1 || m.side === -1 ? m.side : 0 };
    },
    // Nova's line in this language (the model's), or null: the page says its plain one
    say(rec, map, lang) {
      const k = bossOf(map),
        m = k && rec.boss && rec.boss[k] && rec.boss[k].mind;
      // (picked with a tactic since dropped: her words may tell of it — the page's plain lines for those left)
      const stale = m && Array.isArray(m.tac) && m.tac.some((id) => GONE.includes(id));
      return (!stale && m && m.say && typeof m.say[lang] === 'string' && m.say[lang]) || null;
    },
  };
}
