// live/i18n.js — language packs. Every word the game shows lives in lang_<code>.js (English is the base and the fallback for a
// missing key). I18N.t('a.b', { x }) looks a dotted key up in the current pack and fills its {x} slots; a slot value that is itself
// a key ('bosses.tank') is translated too, so the sim can store keys and the screen translates them when it draws. A string that is
// not a key comes back as is. I18N.apply(DATA) writes the names, descriptions and level lines into the game data (data.js holds
// none), so the screens keep reading d.name. The language: ?lang=xx (tried, not kept), else the player's pick (SAVE.language),
// else the first of the browser's languages there is a pack for, else English.
(function (root) {
  const P = {}, I = (root.I18N = { packs: P, list: [], lang: 'en' });
  const get = (o, k) => (o ? k.split('.').reduce((v, p) => (v == null ? v : v[p]), o) : undefined);
  const KEY = /^[a-z][A-Za-z]*\.[\w.]+$/;
  I.pack = (code, def) => { P[code] = def; if (!I.list.includes(code)) I.list.push(code); };
  I.raw = (k, lang) => { const v = get(P[lang || I.lang], k); return v == null ? get(P.en, k) : v; };
  I.t = (k, v, lang) => {
    if (typeof k !== 'string') return k == null ? '' : String(k);
    const s = KEY.test(k) ? I.raw(k, lang) : null;
    if (typeof s !== 'string') return k;
    return v ? s.replace(/\{(\w+)\}/g, (m, n) => (v[n] == null ? m : typeof v[n] === 'string' ? I.t(v[n], null, lang) : String(v[n]))) : s;
  };
  I.locale = (lang) => I.raw('lang.locale', lang) || 'en-US';
  I.num = (n, lang) => Number(n).toLocaleString(I.locale(lang));
  I.dec = (n, lang) => (Math.round(n * 10) / 10).toLocaleString(I.locale(lang), { maximumFractionDigits: 1 });
  // names, descriptions and level lines: the base pack's first, then the chosen one's over them (a missing field stays English)
  I.apply = (D) => {
    const both = (k) => Object.assign({}, get(P.en, k), I.lang !== 'en' ? get(P[I.lang], k) : null);
    for (const id in D.MAIN) Object.assign(D.MAIN[id], both('weapons.' + id));
    for (const id in D.ITEMS) Object.assign(D.ITEMS[id], both('items.' + id));
    for (const id in D.EVOS) Object.assign(D.EVOS[id], both('evos.' + id));
    for (const k in D.ENEMIES) if (D.ENEMIES[k].boss) D.ENEMIES[k].name = I.t('bosses.' + k);
    for (const k in D.META) Object.assign(D.META[k], both('meta.' + k));
    for (const k in D.WEAPON_UP) D.WEAPON_UP[k].name = I.t('stats.' + k);
    for (const m of D.MAPS) m.name = I.t('maps.' + m.id);
    for (const r of D.ROADMAP) Object.assign(r, both('roadmap.' + r.id));
  };
  I.set = (code) => {
    I.lang = P[code] ? code : 'en';
    if (root.DATA) I.apply(root.DATA);
    if (root.document) { document.documentElement.lang = I.t('lang.html'); }   // the tab's title stays index.html's in every language
  };
  const ALIAS = { ua: 'uk' };                                         // a non-standard code some systems report for Ukrainian
  I.detect = (langs) => { for (const l of langs || []) { const c = String(l).toLowerCase().split(/[-_]/)[0]; const k = ALIAS[c] || c; if (P[k]) return k; } return 'en'; };
  I.init = () => {
    let q = null; try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    const pick = root.SAVE && P[SAVE.language] ? SAVE.language : null, nav = root.navigator ? navigator.languages || [navigator.language] : [];
    I.set(q && P[q] ? q : pick || I.detect(nav));
  };
})(typeof window !== 'undefined' ? window : globalThis);
