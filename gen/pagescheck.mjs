// The menu pages (arsenal, upgrades, world map): node gen/pagescheck.mjs — each opened from the lobby, shot at a few window sizes,
// checked for text spilling out of its box and boxes off the screen; then the arsenal and upgrades are used: view a gun, buy it, upgrade
// it, make it primary, buy a permanent upgrade (the save changes as it should), and the map's play button starts a run.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const b = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_NO_BUFFER_SPACE/.test(m.text())) errors.push(m.text());
});
await p.goto('http://127.0.0.1:8930/live/index.html');
await p.evaluate(() => {
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem('md.guest', '1');
});
await p.reload(); // (the wallet offer: lobbynav)
await p.waitForFunction(() => window.LOBBY && LOBBY.ready() && document.querySelector('#lobby .cta'), null, {
  timeout: 90000,
});
await p.evaluate(() => {
  SAVE.coins = 5000;
  SAVE.rxp = 950;
  SAVE.persist();
  UI.lobby();
});
await p.waitForTimeout(400); // rank 6: the minigun can be bought
const fails = [],
  ok = (c, m) => {
    if (!c) fails.push(m);
  };
const audit = () =>
  p.evaluate(() => {
    const out = [],
      root = document.querySelector('.scr.on .pg');
    if (!root) return ['no page'];
    root
      .querySelectorAll('.anm, .dnm, .dsub, .unm, .uds, .mnm, .mwip, .pbtn, .bigb, .dst, .amh, .alock, .back, .ttl')
      .forEach((e) => {
        if (e.scrollWidth > e.clientWidth + 1)
          out.push('overflows: ' + e.className + ' "' + e.textContent.trim().slice(0, 30) + '"');
      });
    root.querySelectorAll('.acard, .adet, .ulist, .pslot, .mcard, .back, .tr').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5)
        out.push('off-screen: ' + e.className);
    });
    const cards = [...root.querySelectorAll('.mcard, .adet, .ulist, .pslot')].map((e) => [
      e.className,
      e.getBoundingClientRect(),
    ]);
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const [a, A] = cards[i],
          [c, C] = cards[j];
        if (A.left < C.right - 1 && C.left < A.right - 1 && A.top < C.bottom - 1 && C.top < A.bottom - 1)
          out.push(a + ' × ' + c);
      }
    return out;
  });
for (const [go, id] of [
  ['arsenal', 'ars'],
  ['upgrades', 'upg'],
  ['maps', 'map'],
]) {
  await p.setViewportSize({ width: 1600, height: 900 });
  await p.click(`#lobby [data-go="${go}"]`);
  await p.waitForTimeout(900);
  ok(await p.evaluate((id) => !!document.querySelector('#' + id + '.scr.on'), id), go + ': page did not open');
  for (const [w, h] of [
    [1600, 900],
    [1280, 720],
    [1024, 768],
    [1920, 1200],
    [2560, 1080],
  ]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(450);
    const bad = await audit();
    ok(!bad.length, `${go} ${w}x${h}: ` + bad.join('; '));
    if (go === 'arsenal')
      for (const v of ['pistol', 'flame', 'laser']) {
        await p.click(`#ars .acard[data-v="${v}"]`);
        await p.waitForTimeout(150);
        const o = await p.evaluate(() => {
          const d = document.querySelector('#ars .adet').getBoundingClientRect(),
            b = document.querySelector('#ars .bigb').getBoundingClientRect();
          return { d: d.bottom, b: b.bottom };
        });
        ok(
          o.b <= o.d + 1,
          `arsenal ${w}x${h} ${v}: the panel's button sticks out below it (${o.b.toFixed(0)} > ${o.d.toFixed(0)})`,
        );
      }
    if (w === 1600 || w === 1024) await p.screenshot({ path: `frames/page_${go}_${w}x${h}.png` });
  }
  await p.setViewportSize({ width: 1600, height: 900 });
  await p.waitForTimeout(300);
  if (go === 'arsenal') {
    await p.click('#ars .acard[data-v="minigun"]');
    await p.waitForTimeout(500);
    ok(
      await p.evaluate(() => document.querySelector('#ars .gview canvas')?.dataset.gun === 'minigun'),
      'arsenal: the panel did not switch to the minigun',
    );
    const lit = await p.evaluate(() => {
      const c = document.querySelector('#ars .gview canvas'),
        d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 240) n++;
      return n;
    });
    ok(lit > 50, 'arsenal: the 3D gun view looks empty (' + lit + ')');
    await p.click('#ars [data-buy]');
    await p.waitForTimeout(300);
    ok(
      await p.evaluate(
        () => SAVE.owned.minigun && SAVE.selected === 'minigun' && SAVE.coins === 5000 - DATA.MAIN.minigun.price,
      ),
      'arsenal: buying the minigun did not work',
    );
    await p.click('#ars [data-up="dmg"]');
    await p.waitForTimeout(300);
    ok(
      await p.evaluate(
        () => SAVE.wup.minigun.dmg === 1 && SAVE.coins === 5000 - DATA.MAIN.minigun.price - DATA.WEAPON_UP.dmg.price[0],
      ),
      'arsenal: the damage upgrade did not apply',
    );
    await p.click('#ars [data-up="mag"]');
    await p.waitForTimeout(300);
    ok(
      await p.evaluate(
        () =>
          SAVE.wup.minigun.mag === 1 &&
          SAVE.coins === 5000 - DATA.MAIN.minigun.price - DATA.WEAPON_UP.dmg.price[0] - DATA.WEAPON_UP.mag.price[0],
      ),
      'arsenal: the magazine upgrade did not apply',
    );
    ok(
      await p.evaluate(() => [...document.querySelectorAll('#ars .dst b')].some((b) => /^173 · /.test(b.textContent))),
      'arsenal: the magazine line of the minigun does not show 173 rounds',
    );
    await p.click('#ars .acard[data-v="pistol"]');
    await p.waitForTimeout(300);
    await p.click('#ars [data-sel]');
    await p.waitForTimeout(300);
    ok(await p.evaluate(() => SAVE.selected === 'pistol'), 'arsenal: making the pistol primary did not work');
    await p.click('#ars .acard[data-v="minigun"]');
    await p.waitForTimeout(700);
    await p.screenshot({ path: 'frames/page_arsenal_used.png' });
  }
  if (go === 'upgrades') {
    const c0 = await p.evaluate(() => SAVE.coins);
    await p.click('#upg [data-m="hp"]');
    await p.waitForTimeout(300);
    ok(
      await p.evaluate((c0) => SAVE.meta.hp === 1 && SAVE.coins === c0 - DATA.META.hp.price[0], c0),
      'upgrades: buying max health did not work',
    );
  }
  if (go === 'maps') {
    await p.click('#map [data-play]');
    await p.waitForTimeout(700);
    ok(await p.evaluate(() => !!GAME.play), 'map: play did not start a run');
    await p.evaluate(() => GAME.quit());
    await p.waitForTimeout(400);
    continue;
  }
  await p.click('.scr.on [data-go="lobby"]');
  await p.waitForTimeout(500);
  ok(
    await p.evaluate(() => !!document.querySelector('#lobby .cta') && UI.scene === 'main'),
    go + ': back did not return to the lobby',
  );
}
console.log(JSON.stringify({ fails, errors }));
await b.close();
process.exit(fails.length || errors.length ? 1 : 0);
