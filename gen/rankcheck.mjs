// The survivor rank and weapon mastery in the menus: node gen/rankcheck.mjs [outdir]   (needs the live server on :8930)
// A fresh save: the lobby shows rank 1, the arsenal locks every gun above it by rank (no buying it, even with the coins), the pistol's
// upgrades stop at its mastery. Then a won 10-minute run: the results show its rank XP line by line, the bar runs through the ranks it
// passes (their coins, the guns they open) and the pistol's mastery; the save has the XP, the coins, the mastery; the shotgun can be
// bought. A save from before the rank gets XP from its stats. Shots: <outdir>/rank_*.png. Fails on page errors or a wrong save.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const out = process.argv[2] || 'frames/rank';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [],
  fails = [],
  ok = (c, m) => {
    if (!c) fails.push(m);
  };
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/404|ERR_/.test(m.text())) errors.push(m.text());
});
const KEY = 'meow-division-save-v1',
  load = async (save) => {
    await p.goto('http://127.0.0.1:8930/live/index.html');
    await p.evaluate(
      ([k, s]) => {
        localStorage.clear();
        if (s) localStorage.setItem(k, JSON.stringify(s));
      },
      [KEY, save],
    );
    await p.reload();
    await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
    await p.waitForTimeout(800);
  };
const shot = (n) => p.screenshot({ path: `${out}/rank_${n}.png` });
const click = async (sel) => {
  await p.click(sel);
  await p.waitForTimeout(350);
};

await load({ language: 'ru' });
ok(
  await p.evaluate(() => document.querySelector('#lobby .pl .rk').textContent.includes('1')),
  'lobby: rank 1 on a fresh save',
);
await shot('lobby');
await p.evaluate(() => {
  SAVE.coins = 5000;
  SAVE.persist();
});
await click('[data-go="arsenal"]');
await click('#ars [data-v="shotgun"]');
await shot('arsenal_locked');
ok(
  await p.evaluate(
    () => !!document.querySelector('#ars .acard.rlock[data-v="shotgun"]') && !document.querySelector('#ars [data-buy]'),
  ),
  'arsenal: the shotgun locked by rank 2, no buy button',
);
await click('#ars [data-v="pistol"]');
await p.evaluate(() => document.querySelector('#ars [data-up="dmg"]').click());
await p.waitForTimeout(200);
ok(
  await p.evaluate(
    () =>
      SAVE.wup.pistol.dmg === 1 &&
      !document.querySelector('#ars [data-up="dmg"]') &&
      !!document.querySelector('#ars .pbtn.mlk'),
  ),
  'arsenal: pistol damage 1 bought, then held at mastery 1',
);
await shot('arsenal_pistol');

// a won run of 10 minutes: 2500 kills, 4 bosses, level 30
await p.evaluate(() => GAME.start('pistol'));
await p.waitForTimeout(1500);
await p.evaluate(() => {
  const S = GAME.play;
  S.t = 600;
  S.kills = 2500;
  S.bk = 4;
  S.p.lvl = 30;
  S.coins = 420;
  S.over = { win: true, t: 600, kills: 2500, lvl: 30, coins: 420 };
});
await p.waitForTimeout(2100);
await shot('results_mid');
await p.waitForTimeout(3500);
await shot('results');
for (const [w, h] of [
  [1280, 720],
  [1024, 768],
]) {
  // the results with every line it can have still fit the window
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(300);
  const bad = await p.evaluate(() =>
    [...document.querySelectorAll('.rso .remb, .rso h1, .rso .rp, .rso .btns')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth;
      })
      .map((e) => e.className),
  );
  ok(!bad.length, `results ${w}x${h}: off the window: ${bad.join(', ')}`);
  await shot(`results_${w}x${h}`);
}
await p.setViewportSize({ width: 1600, height: 900 });
const sv = await p.evaluate(() => ({
  rxp: SAVE.rxp,
  coins: SAVE.coins,
  mast: SAVE.mast.pistol,
  rank: DATA.rankOf(SAVE.rxp).r,
  badge: document.querySelector('.rso .rkno').textContent,
  opened: [...document.querySelectorAll('.rso .rcard.new:not([hidden])')].map((e) => e.textContent),
  win: !!document.querySelector('.rso .rcard.win'),
}));
console.log('after the run', JSON.stringify(sv));
ok(sv.rxp === 100 + 250 + 200 + 200 + 30, "save: the run's rank XP (780)");
ok(sv.rank === 5 && sv.badge === '5', 'results: the badge ran up to rank 5');
ok(sv.win, 'results: the victory reward card');
ok(sv.mast === 2500, 'save: pistol mastery 2500 kills (level 2)');
ok(
  sv.opened.some((t) => /Дробовик/.test(t)) && sv.opened.some((t) => /Автомат/.test(t)),
  'results: the shotgun and the SMG opened',
);
ok(sv.coins === 5000 - 120 + 420 + 500 + (100 + 150 + 200 + 250), 'save: coins + win bonus + rank rewards');
await p.evaluate(() => GAME.restart());
await p.waitForTimeout(1500); // a lost run: the defeat screen, the next gun to come
await p.evaluate(() => {
  const S = GAME.play;
  S.t = 200;
  S.kills = 400;
  S.bk = 0;
  S.p.lvl = 9;
  S.coins = 35;
  S.over = { win: false, t: 200, kills: 400, lvl: 9, coins: 35 };
});
await p.waitForTimeout(4200);
await shot('results_dead');
ok(
  await p.evaluate(
    () =>
      !!document.querySelector('.rso.dead') &&
      /Миниган/.test(document.querySelector('.rso .rcard.next')?.textContent || ''),
  ),
  'defeat: the next-gun card (the minigun, rank 6)',
);
for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(300);
  await shot(`results_dead_${w}x${h}`);
}
await p.setViewportSize({ width: 1600, height: 900 });
await p.evaluate(() => GAME.quit());
await p.waitForTimeout(800);
await click('[data-go="arsenal"]');
await click('#ars [data-v="shotgun"]');
ok(await p.evaluate(() => !!document.querySelector('#ars [data-buy]')), 'arsenal: the shotgun can be bought at rank 5');
await click('#ars [data-v="pistol"]');
await shot('arsenal_after');

// a save from before the rank: XP from its stats, mastery up to its upgrades
await load({
  coins: 10,
  owned: { pistol: true, rocket: true },
  wup: { rocket: { dmg: 4, rate: 2 } },
  stats: { runs: 12, wins: 2, kills: 20000, best: 600 },
});
const old = await p.evaluate(() => ({ rxp: SAVE.rxp, m: SAVE.mast.rocket, own: SAVE.owned.rocket }));
ok(
  old.rxp === 2000 + 300 + 500 && old.m === 7000 && old.own,
  'old save: rank XP from stats, rocket kept, mastery 4 for its upgrades ' + JSON.stringify(old),
);
await shot('lobby_old');
console.log(JSON.stringify({ errors, fails }));
await b.close();
process.exit(errors.length || fails.length ? 1 : 0);
