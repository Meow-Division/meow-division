// The language packs: node gen/langcheck.mjs [lang…] — first the packs themselves (every pack has every key of lang_en.js with the
// same shape and the same {slots}, a plural set every form its language has; English has no Cyrillic at all; the code holds no
// Cyrillic outside lang_*.js), then the game in each language: the lobby, its settings, the wallet's choice, every menu screen, the
// campaign (a mission to play and one won), NEAR Base (Nova's orders), Walt's window with the first sale
// and Nova's wallet offer, the stash, and the in-run overlays (level-up cards, chest, pause, the results of a win, an evac and a
// mission) are opened at two window sizes, text spilling out of its box is reported, and in English any Cyrillic left on screen (text
// or tooltips) fails (except the language picker, which names each language in itself). No wallet window is ever opened.
// Also: a first launch follows the browser's language, and a pick in the settings is kept and wins. Shots go to frames/lang/<lang>_<screen>.png.
// The game's server: http://127.0.0.1:$PORT (default 8930), started from this checkout.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const CYR = /[Ѐ-ӿ]/,
  fails = [],
  ok = (c, m) => {
    if (!c) fails.push(m);
  };

// ---- the packs ----
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('live/i18n.js', 'utf8'), ctx);
const LANGS = fs
  .readdirSync('live')
  .filter((f) => /^lang_\w+\.js$/.test(f))
  .map((f) => (vm.runInContext(fs.readFileSync('live/' + f, 'utf8'), ctx), f.slice(5, -3)));
const P = ctx.I18N.packs,
  slots = (s) =>
    [...s.matchAll(/\{(\w+)\}/g)]
      .map((m) => m[1])
      .sort()
      .join();
// a plural set (i18n.js: { one, few, many, other, zero? }): every form the pack's language has (Intl.PluralRules), each with
// the English set's {slots} (zero, an exact 0, may leave the number out)
const plural = (a, b, path, lg) => {
  if (!ctx.I18N.isPlural(b)) {
    fails.push(`${lg}: ${path} should be a plural set like the English one`);
    return;
  }
  const want = slots(a.other),
    cats = new Intl.PluralRules(P[lg].lang.locale).resolvedOptions().pluralCategories;
  for (const f of cats) ok(typeof b[f] === 'string', `${lg}: ${path}.${f} missing (a plural form ${lg} has)`);
  for (const f in b)
    if (f === 'zero')
      ok(
        slots(b[f])
          .split(',')
          .every((x) => !x || want.split(',').includes(x)),
        `${lg}: ${path}.zero slots`,
      );
    else ok(slots(b[f]) === want, `${lg}: ${path}.${f} slots {${slots(b[f])}} vs {${want}}`);
};
const walk = (a, b, path, lg) => {
  if (ctx.I18N.isPlural(a)) return plural(a, b, path, lg);
  if (typeof a === 'string') {
    ok(typeof b === 'string', `${lg}: ${path} missing`);
    if (typeof b === 'string') ok(slots(a) === slots(b), `${lg}: ${path} slots {${slots(a)}} vs {${slots(b)}}`);
    return;
  }
  if (Array.isArray(a)) {
    ok(Array.isArray(b) && b.length === a.length, `${lg}: ${path} should be a list of ${a.length}`);
    if (Array.isArray(b)) a.forEach((v, i) => walk(v, b[i], path + '[' + i + ']', lg));
    return;
  }
  if (!b || typeof b !== 'object') {
    fails.push(`${lg}: ${path} missing`);
    return;
  }
  for (const k in a) walk(a[k], b[k], path ? path + '.' + k : k, lg);
  for (const k in b) ok(k in a, `${lg}: ${path ? path + '.' + k : k} is not in the English pack`);
};
for (const lg of LANGS) walk(P.en, P[lg], '', lg);
ok(!CYR.test(JSON.stringify(P.en)), 'en: the English pack has Cyrillic');
for (const f of fs
  .readdirSync('live')
  .filter(
    (f) =>
      /\.(js|html|css|cjs)$/.test(f) &&
      !/^lang_/.test(f) &&
      !['editor.js', 'heroeditor.js', 'devfield.js', 'lab.js', 'econ.js', 'econ.html', 'econbot.js'].includes(f),
  )) {
  // (the map and character editors: local tools, Russian only, not in the build; the balance lab, ?lab: a test tool, Russian only)
  // (exempt: index.html's note for a game that didn't load, in the phone's language — the packs may not have come — and
  // the comments a tool writes at the top of a generated map, live/map*.js, from the map editor's Russian names)
  const bad = fs
    .readFileSync('live/' + f, 'utf8')
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => CYR.test(l))
    .filter(([, l]) => !(f === 'index.html' && /^\s*(const W = \{ )?(ru|uk): \['/.test(l)))
    .filter(([, l]) => !(/^map(_\w+)?\.js$/.test(f) && /^\s*\/\//.test(l)));
  for (const [n, l] of bad) fails.push(`${f}:${n} has Cyrillic outside the packs: ${l.trim().slice(0, 60)}`);
}
const only = process.argv.slice(2).length ? process.argv.slice(2) : LANGS;

// ---- the game in each language ----
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
fs.mkdirSync('frames/lang', { recursive: true });
const errors = [];
const URL0 = `http://127.0.0.1:${process.env.PORT || 8930}/live/index.html`;

// ---- which language a first launch picks: the browser's, unless the player picked one (an old save's default 'lang' is no pick) ----
const KEY = 'meow-division-save-v1',
  lobby = (p) => p.waitForFunction(() => document.querySelector('#lobby .cta'), null, { timeout: 90000 });
for (const [locale, save, want] of [
  ['es-ES', null, 'es'],
  ['uk-UA', null, 'uk'],
  ['ru-RU', null, 'ru'],
  ['de-DE', null, 'en'],
  ['es-ES', { language: 'ru' }, 'ru'],
  ['ru-RU', { lang: 'en' }, 'ru'],
]) {
  const c = await b.newContext({ locale, viewport: { width: 1280, height: 720 } }),
    p = await c.newPage();
  p.on('pageerror', (e) => errors.push(locale + ': ' + e.message));
  await p.goto(URL0);
  await p.evaluate(
    ([k, s]) => {
      sessionStorage.clear();
      localStorage.clear();
      if (s) localStorage.setItem(k, JSON.stringify(s));
    },
    [KEY, save],
  );
  await p.reload();
  await lobby(p);
  const got = await p.evaluate(() => I18N.lang);
  ok(got === want, `detect: browser ${locale}, save ${JSON.stringify(save)} → ${got}, want ${want}`);
  if (locale === 'uk-UA') {
    // a pick in the settings is kept and wins over the browser
    await p.click('#lobby [data-set]');
    await p.click('#lobby .lg[data-lang="es"]');
    await p.waitForTimeout(1500);
    await lobby(p);
    ok(
      await p.evaluate(
        () => I18N.lang === 'es' && SAVE.language === 'es' && !!document.querySelector('#lobby .setp.open'),
      ),
      'detect: picking Español in the settings did not stick',
    );
    await p.reload();
    await lobby(p);
    ok(await p.evaluate(() => I18N.lang === 'es'), 'detect: the pick was lost on the next launch');
  }
  await c.close();
}
const audit = (p, lg) =>
  p.evaluate((lg) => {
    // (the screen on top: a menu or card screen, else Walt's or the stash's window, else NEAR Base's page)
    const out = [],
      root =
        document.querySelector('.scr.on') ||
        document.querySelector('#mkt:not(.gone)') ||
        document.querySelector('#hub') ||
        document.body;
    for (const e of root.querySelectorAll('*')) {
      const cs = getComputedStyle(e);
      if (cs.display === 'inline' || cs.display === 'none' || !e.clientWidth || e.closest('svg')) continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis')
        out.push(`overflows: .${[...e.classList].join('.') || e.tagName} "${e.textContent.trim().slice(0, 40)}"`);
    }
    if (lg === 'en') {
      const own = root.cloneNode(true);
      own.querySelectorAll('[lang]').forEach((e) => e.remove()); // the language picker names each language in itself
      const txt =
        own.textContent +
        ' ' +
        [...root.querySelectorAll('[title]')].map((e) => e.title).join(' ') +
        ' ' +
        document.title;
      const m = txt.match(/\S*[Ѐ-ӿ]\S*/g);
      if (m) out.push('Cyrillic on screen: ' + [...new Set(m)].slice(0, 8).join(' '));
    }
    return out;
  }, lg);
for (const lg of only) {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => errors.push(lg + ': ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_NO_BUFFER_SPACE/.test(m.text())) errors.push(lg + ': ' + m.text());
  });
  await p.goto(URL0 + '?lang=' + lg);
  await p.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await p.reload();
  await p.waitForFunction(() => window.LOBBY && LOBBY.ready() && document.querySelector('#lobby .cta'), null, {
    timeout: 90000,
  });
  ok(
    await p.evaluate((lg) => I18N.lang === lg && document.documentElement.lang === I18N.t('lang.html'), lg),
    `${lg}: the page is not in ${lg}`,
  );
  await p.evaluate(() => {
    SAVE.coins = 123456;
    SAVE.owned.shotgun = true;
    SAVE.persist();
    UI.lobby();
  });
  await p.waitForTimeout(500);
  const shot = async (name) => {
    for (const [w, h] of [
      [1600, 900],
      [1024, 768],
    ]) {
      await p.setViewportSize({ width: w, height: h });
      await p.waitForTimeout(350);
      const bad = await audit(p, lg);
      ok(!bad.length, `${lg} ${name} ${w}x${h}: ` + bad.join('; '));
    }
    await p.setViewportSize({ width: 1600, height: 900 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `frames/lang/${lg}_${name}.png` });
  };
  await shot('lobby');
  await p.click('#lobby [data-set]');
  await p.waitForTimeout(300);
  await shot('settings');
  await p.click('#lobby [data-close]');
  // the wallet's button with none connected: the choice, connect or create (nothing pressed in it: no wallet window)
  await p.waitForFunction(
    () => window.WALLET && WALLET.available && document.querySelector('#lobby [data-wal]'),
    null,
    {
      timeout: 20000,
    },
  );
  await p.click('#lobby [data-wal]');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector('#lobby .walc.open')), `${lg}: no wallet choice for a guest`);
  await shot('wallet');
  await p.click('#lobby .walc [data-wcclose]');
  for (const [go, name] of [
    ['arsenal', 'arsenal'],
    ['upgrades', 'upgrades'],
    ['maps', 'map'],
    ['heroes', 'heroes'],
    ['roadmap', 'roadmap'],
    ['select', 'select'],
  ]) {
    // (the arsenal and the upgrades left the lobby for the base, 2026-11-12: each page opened as the game opens it)
    await p.evaluate((go) => UI.kit.go(go), go);
    await p.waitForTimeout(900);
    if (name === 'arsenal') {
      await p.click('#ars .acard[data-v="flame"]');
      await p.waitForTimeout(300);
    }
    await shot(name);
    await p.evaluate(() => UI.lobby());
    await p.waitForTimeout(500);
  }
  // the campaign with mission 1 won: its panel leads to NEAR Base; mission 2's is the one to play
  await p.evaluate(() => {
    SAVE.camp = ['office'];
    SAVE.items = { t_butcher: 1, gears: 4, planks: 2 };
    SAVE.persist();
    UI.campaign();
  });
  await p.waitForTimeout(900);
  await p.click('#campaign .cnode[data-m="office"]');
  await p.waitForTimeout(200);
  await shot('map_done');
  // NEAR Base (the office's inside since 0520642: no buildings there yet, only Walt and Nova): its goal and Nova's orders (the
  // hero put beside her, E); Walt's window below
  await p.evaluate(() => GAME.hub());
  await p.waitForFunction(() => GAME.play && GAME.play.hub && document.querySelector('#hub'), null, { timeout: 60000 });
  await p.waitForTimeout(800);
  await shot('base');
  for (const [prop, name] of [['np_nova', 'nova']]) {
    await p.evaluate((n) => {
      const o = SIM.level(GAME.play.seed).props.find((q) => q.n === n);
      GAME.play.p.x = o.x;
      GAME.play.p.y = o.y + 60;
    }, prop);
    await p.waitForTimeout(400);
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => !document.querySelector('#hub .hwin').hidden), `${lg}: no ${name} panel at the base`);
    await shot('base_' + name);
    await p.keyboard.press('Escape');
  }
  // the generator's panel (the base tutorial: its parts, where they come from)
  await p.evaluate(() => {
    const o = SIM.level(GAME.play.seed).props.find((q) => q.bspot === 'generator');
    const gx = o.gx + o.fw / 2 + 60,
      gy = o.gy;
    GAME.play.p.x = gx - gy + SIM.G;
    GAME.play.p.y = (gx + gy) / 2;
  });
  await p.waitForTimeout(400);
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => !document.querySelector('#hub .hwin').hidden), `${lg}: no generator panel at the base`);
  await shot('base_generator');
  await p.keyboard.press('Escape');
  // Walt's window, the lesson (hub.js: the cleaver not sold yet): the cleaver picked, sold by holding its button down
  // (market.js HOLD), then Nova's offer to keep it all in a wallet
  await p.evaluate(() => MARKET.open('walt', { lesson: true }));
  await p.waitForTimeout(1200);
  await shot('walt_lesson');
  await p.click('#mkt .mk-slot[data-id="t_butcher"][data-side="me"]');
  await p.waitForTimeout(300);
  await shot('walt');
  const hold = await (await p.$('#mkt [data-a="trade"]')).boundingBox();
  await p.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(2300);
  await p.mouse.up();
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!document.querySelector('#mkt .mk-offer')), `${lg}: no wallet offer after the first sale`);
  await shot('offer');
  await p.click('#mkt [data-a="later"]');
  await p.click('#mkt [data-a="tab"][data-tab="guns"]');
  await p.waitForTimeout(300);
  await shot('walt_guns');
  await p.evaluate(() => {
    MARKET.close();
    MARKET.open('stash');
  });
  await p.waitForTimeout(600);
  await shot('stash');
  await p.evaluate(() => {
    MARKET.close();
    GAME.quit();
  });
  await p.waitForTimeout(600);
  // in-run overlays: level-up cards (an evolution hint on a card), a chest, the pause menu, the results
  await p.evaluate(() => UI.kit.startRun('pistol'));
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const S = GAME.play;
    S.p.items.push(SIM.newItem('saws', 4));
    S.p.items.push(SIM.newItem('magnet', 2));
    SIM.recalc && SIM.recalc(S);
    SIM.cheat(S, 'lvl');
  });
  await p.waitForTimeout(900);
  ok(await p.evaluate(() => !!document.querySelector('.scr.on .lv')), `${lg}: no level-up cards`);
  await shot('levelup');
  await p.evaluate(() => {
    const S = GAME.play;
    S.pause = {
      k: 'chest',
      kind: 'boss',
      t: S.t,
      coins: 120,
      items: [{ ty: 'up', id: 'saws', lvl: 5 }, { ty: 'main', id: 'pistol', lvl: 3 }, { ty: 'gold' }],
    };
  });
  await p.waitForTimeout(700);
  ok(await p.evaluate(() => !!document.querySelector('.scr.on .chestItems')), `${lg}: no chest`);
  await shot('chest');
  await p.evaluate(() => {
    const S = GAME.play;
    S.pause = null;
    GAME.pause(true);
  });
  await p.waitForTimeout(600);
  await shot('pause');
  await p.evaluate(() => {
    GAME.pause(false);
    const S = GAME.play;
    S.over = { win: true, t: 333, kills: 12345, lvl: 42, coins: 6789 };
    S.t = 336;
  });
  await p.waitForTimeout(1900);
  ok(await p.evaluate(() => !!document.querySelector('.scr.on .res .total')), `${lg}: no results`);
  await shot('results');
  // the results of an evac (on to NEAR Base) and of a campaign mission won (its own line)
  for (const [name, mission, over] of [
    ['evac', false, { win: false, evac: 1, t: 300, kills: 2345, lvl: 21, coins: 4321 }],
    ['mission', true, { win: true, t: 333, kills: 12345, lvl: 42, coins: 6789 }],
  ]) {
    await p.evaluate(() => GAME.quit());
    await p.waitForTimeout(600);
    await p.evaluate((m) => (m ? UI.kit.playCurrent() : UI.kit.startRun('pistol')), mission);
    await p.waitForFunction(() => GAME.play && !GAME.play.over, null, { timeout: 60000 });
    await p.waitForTimeout(800);
    await p.evaluate((o) => {
      const S = GAME.play;
      if (o.evac) S.p.evac = 1;
      S.over = o;
      S.t = o.t + 3;
    }, over);
    await p.waitForTimeout(1900);
    ok(await p.evaluate(() => !!document.querySelector('.scr.on .res .total')), `${lg}: no ${name} results`);
    await shot('results_' + name);
  }
  await p.close();
}
console.log(JSON.stringify({ langs: LANGS, fails, errors }, null, 1));
await b.close();
process.exit(fails.length || errors.length ? 1 : 0);
