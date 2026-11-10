// The NEAR wallet as the player's account, in the game: node gen/walletcheck.mjs [outdir]
// Starts its own game server (server/server.mjs) with a stand-in NEAR RPC and a stand-in NEAR Connect (the page's import of the library
// is answered with a wallet that signs with a test key). A guest with progress connects: the account starts from nothing (the guest's
// progress stays the guest's); disconnecting brings the guest's back. Cheats from the page's console: coins written into SAVE buy
// nothing on the server; a run played in the real game loop is sent and played again by the server — honest, it is counted as the page
// saw it (the browser's sim and the server's agree to the bit); with coins added in the page mid-run, the server pays what the run's
// inputs earned. A "new device" (storage cleared) gets the account's progress; a reload keeps the session; with the server out of reach
// the game goes on. On the new device the wallet is connected from the offer PLAY makes a guest, and the run it was pressed for starts
// with the account. The wallet signs in and signs the login message in one window (a second one, asked for with no tap of its own, is
// blocked on a phone); a wallet's window that hangs leaves the button pressable, and pressing it again starts anew.
// Shots: <outdir>/wallet_*.png. Exits 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const out = process.argv[2] || 'frames/wallet';
fs.mkdirSync(out, { recursive: true });
const fails = [],
  ok = (c, m) => {
    console.log((c ? 'ok   ' : 'FAIL ') + m);
    if (!c) fails.push(m);
  };

const key = crypto.generateKeyPairSync('ed25519'),
  raw = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const rpc = http.createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  const { params } = JSON.parse(b);
  const full = params.account_id === 'alice.near' && params.public_key === pub;
  res.end(
    JSON.stringify(
      full ? { result: { permission: 'FullAccess' } } : { error: { cause: { name: 'UNKNOWN_ACCESS_KEY' } } },
    ),
  );
});
await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-wallet-'));
process.env.DATA_DIR = tmp;
process.env.NEAR_RPC = `http://127.0.0.1:${rpc.address().port}`;
process.env.REPLAY_WORKERS = '1';
const S = await import('../server/server.mjs'),
  pub = 'ed25519:' + S.b58encode(raw);
const srv = await S.start(0, '127.0.0.1'),
  base = `http://127.0.0.1:${srv.address().port}`;
const serverSave = () => {
  const d = path.join(tmp, 'accounts'),
    f = fs.readdirSync(d).filter((n) => n.endsWith('.json'))[0];
  return f ? JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) : null;
};

const b = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }),
  p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/404|409|ERR_|status of 4/.test(m.text())) errors.push(m.text());
});
// NEAR Connect stand-in: one wallet, alice.near, signing in and signing NEP-413 with the test key in one go (window.__ncHang: its
// window never answers); a second window for signing alone fails, as a phone's browser blocks it
await p.route('**/vendor/near-connect-*.js*', (r) =>
  r.fulfill({
    contentType: 'text/javascript',
    body: `export class NearConnector {
  constructor(o) { this.o = o; this.ls = {}; this.whenManifestLoaded = Promise.resolve(); window.__ncOptions = o; }
  on(k, f) { (this.ls[k] = this.ls[k] || []).push(f); } off(k, f) { this.ls[k] = (this.ls[k] || []).filter((g) => g !== f); }
  async selectWallet(o) { window.__ncFeatures = o && o.features; return 'test-wallet'; }
  async connect(i) { window.__ncTries = (window.__ncTries || 0) + 1; if (window.__ncHang) return new Promise(() => {});
    const m = i.signMessageParams, sm = await window.__sign({ ...m, nonce: Array.from(m.nonce) });
    (this.ls['wallet:signInAndSignMessage'] || []).forEach((f) => f({ accounts: [{ accountId: 'alice.near', publicKey: sm.publicKey, signedMessage: sm }], success: true }));
    return { getAccounts: async () => [{ accountId: 'alice.near' }], signMessage: async () => { throw new Error('popup blocked'); } }; }
  async disconnect() { window.__ncDisconnected = true; } }`,
  }),
);
await p.exposeFunction('__sign', ({ message, recipient, nonce }) => ({
  accountId: 'alice.near',
  publicKey: pub,
  signature: crypto
    .sign(null, S.nep413Hash({ message, recipient, nonce: Buffer.from(nonce) }), key.privateKey)
    .toString('base64'),
}));
const open = async () => {
  await p.goto(base + '/live/index.html');
  await p.waitForFunction(() => window.__ready && document.querySelector('#lobby .cta'), null, { timeout: 120000 });
  await p.evaluate(() => WALLET.ready);
  await p.waitForTimeout(300);
};
const st = () =>
  p.evaluate(() => ({
    profile: SAVE.profile,
    coins: SAVE.coins,
    hp: SAVE.meta.hp,
    account: WALLET.account,
    sync: WALLET.sync,
    chip: document.querySelector('#lobby .wal')?.textContent.trim(),
  }));
const until = (f, ms = 8000, arg = null) =>
  p.waitForFunction(f, arg, { timeout: ms }).then(
    () => true,
    () => false,
  );

await open();
await p.evaluate(() => {
  localStorage.clear();
});
await open();
await p.evaluate(() => {
  SAVE.coins = 777;
  SAVE.meta.hp = 2;
  SAVE.persist();
  UI.lobby();
});
await p.waitForTimeout(300);
let s = await st();
ok(
  !s.account && s.coins === 777 && /КОШЕЛ|WALLET|ГАМАНЕЦЬ|BILLETERA/i.test(s.chip || ''),
  'guest with progress: the connect button in the lobby',
);
await p.screenshot({ path: `${out}/wallet_guest.png` });
await p.evaluate(() => {
  window.__ncHang = 1;
});
await p.click('#lobby .wal');
ok(
  await until(
    () => WALLET.state === 'connecting' && window.__ncTries === 1 && !document.querySelector('#lobby .wal').disabled,
    4000,
  ),
  'a wallet window that hangs: the button stays and can be pressed',
);
await p.evaluate(() => {
  window.__ncHang = 0;
});
await p.click('#lobby .wal');
ok(
  await until(() => WALLET.account === 'alice.near' && WALLET.sync === 'saved'),
  'connect pressed again: signed in as alice.near',
);
ok(
  await p.evaluate(
    () =>
      window.__ncOptions &&
      window.__ncOptions.network === 'mainnet' &&
      window.__ncFeatures &&
      window.__ncFeatures.signInAndSignMessage === true,
  ),
  'NEAR Connect on mainnet, signing in and signing in one window',
);
s = await st();
ok(
  s.profile === 'alice.near' && s.coins === 0 && s.hp === 0 && serverSave()?.save?.coins === 0,
  "a new account starts from nothing: the guest's 777 coins and upgrades stay the guest's",
);
{
  const f = await p.evaluate(() => ({
    nick: SAVE.nick,
    ava: SAVE.ava,
    bg: SAVE.bg,
    shown: document.querySelector('#lobby .pl .nm')?.textContent,
  }));
  ok(
    f.nick &&
      Number.isInteger(f.ava) &&
      Number.isInteger(f.bg) &&
      f.nick === serverSave()?.save?.nick &&
      f.shown === f.nick,
    `the account's face is the server's: "${f.nick}", avatar ${f.ava}, background ${f.bg}`,
  );
}
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/wallet_on.png` });

// cheating from the console: coins written into the page buy nothing on the server
await p.evaluate(() => {
  SAVE.coins = 99999;
  return SAVE.act({ k: 'meta', s: 'hp' });
});
ok(
  (await until(() => WALLET.sync === 'saved' && SAVE.coins === 0 && SAVE.meta.hp === 0, 8000)) &&
    serverSave().save.meta.hp === 0 &&
    serverSave().save.coins === 0,
  'coins written into SAVE from the console: the purchase is refused by the server, the page back to 0',
);
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/wallet_refused.png` });

// a run in the real game loop: the server plays it again from its inputs
async function playRun(secs, cheat) {
  await p.evaluate(() => GAME.start('pistol'));
  ok(await until(() => GAME.play && GAME.run && GAME.run.id, 8000), 'a run with a ticket from the server');
  await p.mouse.move(800, 300);
  await p.keyboard.down('Space');
  await p.keyboard.down('KeyD');
  for (let i = 0; i < secs; i++) {
    await p.waitForTimeout(1000);
    if (i % 3 === 0) await p.mouse.move(600 + 200 * Math.cos(i), 450 + 150 * Math.sin(i));
    if (i === 4) await p.keyboard.up('KeyD');
    if (i === 5) await p.keyboard.down('KeyW');
    await p.evaluate(() => {
      if (GAME.play && GAME.play.pause && GAME.play.pause.k) GAME.pick(0);
    });
  }
  await p.keyboard.up('Space');
  await p.keyboard.up('KeyW');
  if (cheat)
    await p.evaluate(() => {
      GAME.play.coins += 5000;
      GAME.play.kills += 900;
    });
  await p.evaluate(() => GAME.pause(true));
  await p.waitForTimeout(400);
  const pred = await p.evaluate(() => {
    const pl = GAME.play;
    document.querySelector('[data-quit]').click();
    return { coins: pl.gain.coins, kills: pl.kills, id: pl.bid, bst: pl.bst };
  });
  return pred;
}
const c0 = (await st()).coins;
let pred = await playRun(24);
ok(pred.bst === 'pending', `run sent (${pred.kills} kills, ${pred.coins} coins as the page saw it)`);
ok(await until(() => WALLET.sync === 'saved', 30000), 'the server played it again');
let rec = serverSave(),
  last = rec.recent[0];
ok(
  last && last.id === pred.id && last.match && last.gain.coins === pred.coins && last.outcome.kills === pred.kills,
  `an honest run: the server's replay matches the browser's to the bit and pays the same (${last && last.gain.coins} coins)`,
);
ok((await st()).coins === c0 + pred.coins && rec.save.coins === c0 + pred.coins, '… the account has them');
pred = await playRun(6, true);
ok(
  await until(() => WALLET.sync === 'saved', 30000),
  'a run with +5000 coins and +900 kills added in the page: sent and played again',
);
rec = serverSave();
last = rec.recent[0];
ok(
  last && last.id === pred.id && !last.match && last.gain.coins < 5000 && last.outcome.kills < 900,
  `… the server pays what the inputs earned (${last && last.gain.coins} coins, ${last && last.outcome.kills} kills), not the page's ${pred.coins}`,
);
ok((await st()).coins === rec.save.coins, "… and the page shows the server's sum");
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/wallet_lobby_after.png` });
const want = rec.save.coins;

await p.click('#lobby .wal');
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/wallet_panel.png` });
await p.click('#lobby [data-wdis]');
ok(
  await until(() => !WALLET.account && SAVE.profile === null && SAVE.coins === 777 && SAVE.meta.hp === 2),
  "disconnect: back to the guest's progress",
);
// another device: nothing in storage; connecting brings the account's progress down
await p.evaluate(() => localStorage.clear());
await open();
s = await st();
ok(!s.account && s.coins === 0, 'new device: a fresh guest');
await p.click('#lobby [data-play]');
await p.waitForTimeout(400);
ok(
  await p.evaluate(() => !GAME.play && !!document.querySelector('#lobby .gstp.open')),
  'new device: PLAY as a guest offers the wallet first',
);
await p.screenshot({ path: `${out}/wallet_offer.png` });
await p.click('#lobby [data-gcon]');
ok(
  await until((w) => WALLET.account === 'alice.near' && SAVE.coins === w, 8000, want),
  `new device: connecting from the offer brings the account's progress (${want} coins)`,
);
ok(
  await until(() => GAME.play && GAME.run && GAME.run.id && GAME.run.account === 'alice.near', 8000),
  '… and the run starts with the account (a ticket from the server)',
);
await p.evaluate(() => GAME.quit());
await p.waitForTimeout(400);
await open();
s = await st();
ok(s.account === 'alice.near' && s.coins === want && s.sync === 'saved', 'reload: still signed in, the same progress');
// the save server unreachable: the game goes on with this browser's copy of the account
await p.route('**/api/**', (r) => r.abort());
await open();
s = await st();
ok(s.coins === want && s.account === 'alice.near', 'save server unreachable: the account as this browser last saw it');
srv.close();
console.log(JSON.stringify({ errors }));
await b.close();
rpc.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails.length || errors.length ? 1 : 0);
