// server/test.mjs — the server end to end, and every way around its rules a player could try: node server/test.mjs
// A stand-in NEAR RPC knows alice.near with one full-access key and one function-call key. Login: a NEP-413 signature by the full-access
// key, nothing else; a new account starts fresh even when an old client-written save of it lies on disk. Progress: only the server
// writes it — a save sent by the page is refused, purchases follow the rules (price, rank, mastery). Runs: the server plays them again
// from their inputs and pays what that replay earned — a run played with god mode and 99 999 coins added in the page earns what its
// inputs earn; a ticket is good once; a run with more steps than time has passed is refused; two runs overlapping in time pay once; a
// broken log is refused; a run dealt under the rules before a deploy is played again by those rules. Static: the game is served,
// nothing else. Exits 1 on any failure.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js'),
  REPLAY = require('../live/replay.js'),
  RULES = require('../live/rules.js'),
  D = require('../live/data.js');
const fails = [],
  ok = (c, m) => {
    console.log((c ? 'ok   ' : 'FAIL ') + m);
    if (!c) fails.push(m);
  };
const full = crypto.generateKeyPairSync('ed25519'),
  fcall = crypto.generateKeyPairSync('ed25519'),
  stranger = crypto.generateKeyPairSync('ed25519');
const raw = (k) => k.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const rpc = http.createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  const { params } = JSON.parse(b);
  const known = {
    [pk(full)]: 'FullAccess',
    [pk(fcall)]: { FunctionCall: { allowance: null, receiver_id: 'game.near', method_names: [] } },
  };
  const perm = params.account_id === 'alice.near' && known[params.public_key];
  res.end(
    JSON.stringify(
      perm
        ? { jsonrpc: '2.0', id: 'zh', result: { nonce: 1, permission: perm, block_height: 1 } }
        : { jsonrpc: '2.0', id: 'zh', error: { cause: { name: 'UNKNOWN_ACCESS_KEY' } } },
    ),
  );
});
await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-save-'));
process.env.DATA_DIR = tmp;
process.env.NEAR_RPC = `http://127.0.0.1:${rpc.address().port}`;
process.env.REPLAY_WORKERS = '2';
const S = await import('./server.mjs');
function pk(k) {
  return 'ed25519:' + S.b58encode(raw(k));
}
const hashA = (a) => crypto.createHash('sha256').update(a).digest('hex'),
  accFile = path.join(tmp, 'accounts', hashA('alice.near') + '.json');
// the first build's save of alice: what the page had sent, rich and untrusted
fs.mkdirSync(path.join(tmp, 'saves'), { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'saves', hashA('alice.near') + '.json'),
  JSON.stringify({
    account: 'alice.near',
    t: 1,
    save: { coins: 99999, rxp: 99999, owned: { pistol: true, rocket: true } },
  }),
);
const srv = await S.start(0, '127.0.0.1'),
  base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, p, b, tok) => {
  const r = await fetch(base + p, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { code: r.status, j };
};
const sign = (k, nonce, message = S.MESSAGE) =>
  crypto
    .sign(null, S.nep413Hash({ message, nonce: Buffer.from(nonce, 'base64'), recipient: S.RECIPIENT }), k.privateKey)
    .toString('base64');
const login = async (k, opt = {}) => {
  const c = await call('POST', '/api/challenge', {});
  const nonce = opt.nonce || c.j.nonce;
  return {
    nonce,
    r: await call('POST', '/api/login', {
      accountId: opt.account || 'alice.near',
      publicKey: pk(k),
      signature: sign(k, nonce, opt.message),
      nonce,
    }),
  };
};

// ---------------- login
ok((await call('GET', '/api/health')).j?.network === 'mainnet', 'health: mainnet');
const L = await login(full);
ok(L.r.code === 200 && L.r.j.token && L.r.j.accountId === 'alice.near', 'login with a full-access key: a token');
ok(
  L.r.j.save && L.r.j.save.coins === 0 && L.r.j.save.rxp === 0 && !L.r.j.save.owned.rocket,
  'a new account starts fresh (the old client-written save is set aside, not taken)',
);
ok(fs.existsSync(path.join(tmp, 'legacy', hashA('alice.near') + '.json')), '… and kept aside in legacy/');
ok(
  (
    await call('POST', '/api/login', {
      accountId: 'alice.near',
      publicKey: pk(full),
      signature: sign(full, L.nonce),
      nonce: L.nonce,
    })
  ).code === 401,
  'the same nonce twice: refused',
);
ok((await login(full, { message: 'something else' })).r.code === 401, 'a signature over another message: refused');
ok((await login(fcall)).r.code === 401, 'a function-call key: refused');
ok((await login(stranger)).r.code === 401, 'a key the account does not have: refused');
ok((await login(full, { account: 'Bob..near' })).r.code === 400, 'a malformed account: refused');
ok((await login(full, { account: 'bob.near' })).r.code === 401, "another account with alice's key: refused");
const tok = L.r.j.token;
ok(
  (
    await call(
      'GET',
      '/api/save',
      undefined,
      tok.replace(/.(?=.$)/, (c) => (c === 'A' ? 'B' : 'A')),
    )
  ).code === 401,
  'a forged token: refused',
); // (the second-last character: the last one's low bits are base64 padding, decoded away)
ok((await call('GET', '/api/save')).code === 401, 'no token: refused');

// ---------------- progress: only through the rules
ok((await call('PUT', '/api/save', { save: { coins: 1e9 } }, tok)).code === 410, 'a save sent by the page: refused');
ok((await call('GET', '/api/save', undefined, tok)).j?.save?.coins === 0, '… the coins stay 0');
let r = await call('POST', '/api/act', { a: { k: 'buy', id: 'shotgun' } }, tok);
ok(r.code === 409 && r.j.error === 'rank' && r.j.save.coins === 0, 'buying a gun before its rank: refused');
r = await call('POST', '/api/act', { a: { k: 'meta', s: 'hp' } }, tok);
ok(r.code === 409 && r.j.error === 'coins', 'an upgrade without the coins: refused');
for (const a of [
  { k: 'up', id: 'pistol', s: 'dmg' },
  { k: 'meta', s: '__proto__' },
  { k: 'sel', id: 'rocket' },
  { k: 'buy', id: 'laser' },
  { k: 'gift', coins: 5000 },
  { k: 'lang', v: '<script>' },
])
  ok((await call('POST', '/api/act', { a }, tok)).code === 409, 'refused: ' + JSON.stringify(a));
// coins for the test, the way an admin would (on disk): then buying works and costs
const edit = (f) => {
  const rec = JSON.parse(fs.readFileSync(accFile, 'utf8'));
  f(rec);
  fs.writeFileSync(accFile, JSON.stringify(rec));
};
edit((rec) => {
  rec.save.coins = 1000;
});
r = await call('POST', '/api/act', { a: { k: 'meta', s: 'hp' } }, tok);
ok(
  r.code === 200 && r.j.save.coins === 1000 - D.META.hp.price[0] && r.j.save.meta.hp === 1,
  'an upgrade with the coins: bought, its price taken',
);
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'dmg' } }, tok);
ok(r.code === 200 && r.j.save.wup.pistol.dmg === 1, 'a gun upgrade within its mastery: bought');
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'dmg' } }, tok);
ok(r.code === 409 && r.j.error === 'mastery', 'the next one, above its mastery: refused');
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'mag' } }, tok);
ok(r.code === 200 && r.j.save.wup.pistol.mag === 1, 'the magazine upgrade: bought');
r = await call('POST', '/api/act', { a: { k: 'up', id: 'pistol', s: 'toString' } }, tok);
ok(r.code === 409 && r.j.error === 'unknown upgrade', 'an upgrade that does not exist: refused');

// ---------------- runs: played again on the server
// a run as the page plays it: the attract bot steering, firing, taking the first card; cheat: what a hacked page does on top; kit: the
// loadout it is played with (the page sends it with the inputs) — by default the account's own: the pistol, hp 1, the pistol's damage 1
// and magazine 1
const KIT = {
  weapon: 'pistol',
  meta: { hp: 1, dmg: 0, speed: 0, magnet: 0, reroll: 0, start: 0 },
  wup: { dmg: 1, rate: 0, mag: 1 },
};
// careful: the bot also keeps well away from the zombies near it (a run that must last, whatever the seed)
// (sim: another build's rules, as an older page plays them)
function playRun(tk, secs, cheat, kit = KIT, careful = false, sim = SIM) {
  const SIM = sim,
    st = SIM.create({ seed: tk.seed, rs: tk.rs, rank: tk.rank, ...kit }),
    rec = REPLAY.rec();
  let hash = null;
  if (cheat) st.p.god = true;
  for (let i = 0; i < secs * 120 && !st.over; i++) {
    const inp = SIM.scriptInput(st.t, st);
    inp.fire = true;
    inp.mx = 960 + 300 * Math.cos(i / 90);
    inp.my = 540;
    if (st.pause) inp.pick = 0;
    if (careful) {
      let fx = inp.jx * 0.3,
        fy = inp.jy * 0.3;
      for (const e of st.en) {
        const dx = st.p.x - e.x,
          dy = (st.p.y - e.y) * 2,
          d2 = dx * dx + dy * dy;
        if (d2 < 420 * 420 && d2 > 1) {
          fx += (dx / d2) * 400;
          fy += (dy / d2) * 400;
        }
      }
      const m = Math.hypot(fx, fy) || 1;
      inp.jx = fx / m;
      inp.jy = fy / m;
    }
    const q = REPLAY.quant(inp);
    REPLAY.push(rec, q);
    SIM.step(st, q);
    if (cheat && i === 600) {
      st.coins += 99999;
      st.kills += 5000;
    }
    if (st.over && !hash) hash = REPLAY.hash(st);
  }
  return { st, rec, hash: hash || REPLAY.hash(st) };
}
const z = (log) => zlib.gzipSync(Buffer.from(JSON.stringify(log))).toString('base64');
const result = async (id) => {
  for (let i = 0; i < 40; i++) {
    const g = await call('GET', '/api/run/' + id, undefined, tok);
    if (g.j && g.j.done) return g.j;
    if (g.code !== 200) return g.j;
  }
  return null;
};
const backdate = (id, secs) =>
  edit((rec) => {
    const t = rec.open.find((x) => x.id === id);
    t.t0 -= secs * 1000;
  });

let t1 = (await call('POST', '/api/run/start', { weapon: 'rocket', rev: SIM.REV }, tok)).j;
ok(
  t1 &&
    t1.id &&
    [7, 8, 9, 10, 11].includes(t1.seed) &&
    Number.isInteger(t1.rs) &&
    Number.isInteger(t1.rank) &&
    !('meta' in t1),
  "a ticket: the server's seeds and the account's rank, for one run",
);
backdate(t1.id, 130);
const honest = playRun(t1, 120),
  want = RULES.outcome(honest.st);
r = await call(
  'POST',
  '/api/run/end',
  { id: t1.id, n: honest.rec.n, z: z(honest.rec.log), hash: honest.hash, want: KIT },
  tok,
);
ok(r.code === 202, 'an honest run: taken (queued for its replay)');
let res = await result(t1.id);
ok(
  res &&
    res.done &&
    res.match &&
    res.outcome.kills === want.kills &&
    res.outcome.coins === want.coins &&
    Math.abs(res.outcome.t - want.t) < 1e-9,
  `the replay ends where the page's run did (${want.kills} kills, ${want.coins} coins, ${want.t.toFixed(1)} s)`,
);
const before = 1000 - D.META.hp.price[0] - D.WEAPON_UP.dmg.price[0] - D.WEAPON_UP.mag.price[0],
  paid = RULES.bank(RULES.defaults(), want).coins;
ok(
  res && res.save.coins === before + paid && res.gain.coins === paid && res.save.stats.runs === 1,
  `… paid what it earned (+${paid} coins), once`,
);
ok(
  (
    await call(
      'POST',
      '/api/run/end',
      { id: t1.id, n: honest.rec.n, z: z(honest.rec.log), hash: honest.hash, want: KIT },
      tok,
    )
  ).code === 404,
  'the same run sent again: refused',
);

// (a mission that is not the account's current one asked for: dropped, a classic run on the map asked for — so one
// won before can't be farmed, nor one played out of turn)
const t2 = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'lab', map: 'lab' }, tok)).j;
ok(t2.mission === null && t2.seed >= SIM.LAB0, 'a mission that is not the current one: dropped, the run is classic');
backdate(t2.id, 260); // (before the honest run: runs of one account can't overlap)
const cheat = playRun(t2, 120, true),
  cheatWant = RULES.outcome(cheat.st);
r = await call(
  'POST',
  '/api/run/end',
  { id: t2.id, n: cheat.rec.n, z: z(cheat.rec.log), hash: cheat.hash, want: KIT },
  tok,
);
res = await result(t2.id);
ok(
  cheatWant.coins >= 99999 &&
    res &&
    res.done &&
    !res.error &&
    !res.match &&
    res.outcome.coins < 5000 &&
    res.outcome.kills < cheatWant.kills,
  `a run hacked in the page (god mode, +99 999 coins, +5000 kills): paid what its inputs earn [match ${res && res.match} err ${res && res.error} done ${res && res.done}; the page claimed ${cheatWant.coins} coins, ${cheatWant.kills} kills in ${cheatWant.t.toFixed(1)} s] (${res && res.outcome.coins} coins, ${res && res.outcome.kills} kills)`,
);

const t7 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j;
backdate(t7.id, 900); // (long before the runs above and below)
const RICH = {
    weapon: 'rocket',
    meta: { hp: 5, dmg: 5, speed: 5, magnet: 5, reroll: 3, start: 3 },
    wup: { dmg: 5, rate: 5 },
  },
  rich = playRun(t7, 80, false, RICH);
await call('POST', '/api/run/end', { id: t7.id, n: rich.rec.n, z: z(rich.rec.log), hash: rich.hash, want: RICH }, tok);
res = await result(t7.id);
ok(
  res && res.done && !res.error && !res.match && res.outcome.gun === 'pistol',
  'a run played with a gun and upgrades the account lacks: paid as played again with what it owns (the pistol)',
);

// (the hero kept alive: a whole minute whatever the deal, the time is checked before the log is read)
const t3 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j,
  fast = playRun(t3, 60, true);
r = await call('POST', '/api/run/end', { id: t3.id, n: fast.rec.n, z: z(fast.rec.log) }, tok);
ok(
  r.code === 409 && r.j.error === 'too fast',
  'a minute of play sent a second after its ticket (a sped-up run): refused',
);

const t4 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j,
  t5 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j;
backdate(t4.id, 400);
backdate(t5.id, 395); // (before the runs above)
const p4 = playRun(t4, 100, false, KIT, true),
  p5 = playRun(t5, 100, false, KIT, true);
await call('POST', '/api/run/end', { id: t4.id, n: p4.rec.n, z: z(p4.rec.log), want: KIT }, tok);
const r4 = await result(t4.id);
await call('POST', '/api/run/end', { id: t5.id, n: p5.rec.n, z: z(p5.rec.log), want: KIT }, tok);
const r5 = await result(t5.id);
ok(
  r4 && !r4.error && r5 && r5.error === 'overlap',
  'two runs of one account at the same time (bots in parallel): the second pays nothing' +
    ` [${p4.st.t.toFixed(1)} s ${JSON.stringify(r4 && (r4.error || r4.outcome))}; ${p5.st.t.toFixed(1)} s ${JSON.stringify(r5 && (r5.error || r5.outcome))}]`,
);

// a run dealt under the rules before a deploy and sent after it: played again by those rules (the server keeps them: DATA/sims/<rev>),
// not by the new ones it was never played with — here the old rules' pistol never runs dry
{
  const OLD = SIM.REV - 1,
    dir = path.join(tmp, 'sims', String(OLD)),
    FILES = ['data.js', 'economy.js', 'map.js', 'missions.js', 'sim.js', 'replay.js', 'rules.js'];
  ok(
    fs.existsSync(path.join(tmp, 'sims', String(SIM.REV), 'sim.js')),
    'the server keeps its own rules for later (sims/' + SIM.REV + ')',
  );
  fs.mkdirSync(dir, { recursive: true });
  // The old rules differ from today's by their REV and the pistol's magazine. A patch that finds nothing would make the
  // two rule sets equal and the case below pass for the wrong reason, so a missing pattern stops the test.
  const patch = (s, re, to, f) => {
    if (!re.test(s)) throw new Error(`${f}: ${re} not found, update this test`);
    return s.replace(re, to);
  };
  for (const f of FILES) {
    let s = fs.readFileSync(new URL('../live/' + f, import.meta.url), 'utf8');
    if (f === 'sim.js') s = patch(s, new RegExp(`const REV = ${SIM.REV};`), `const REV = ${OLD};`, f);
    if (f === 'data.js') s = patch(s, /mag: 13,(\s*)rl: 1\.4/, 'mag: 1000,$1rl: 1.4', f);
    fs.writeFileSync(path.join(dir, f), s);
  }
  const ctx = vm.createContext({ console });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
  const t8 = (await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).j;
  backdate(t8.id, 700);
  edit((rec) => {
    rec.open.find((x) => x.id === t8.id).rev = OLD;
  });
  const p8 = playRun(t8, 100, false, KIT, true, ctx.SIM),
    now8 = REPLAY.hash(REPLAY.play(SIM, { ...t8, ...KIT }, p8.rec.log, p8.rec.n));
  await call('POST', '/api/run/end', { id: t8.id, n: p8.rec.n, z: z(p8.rec.log), hash: p8.hash, want: KIT }, tok);
  const r8 = await result(t8.id);
  ok(
    ctx.SIM.REV === OLD && now8 !== p8.hash && r8 && r8.match && r8.outcome.kills === p8.st.kills,
    `a run dealt under the rules before a deploy: played again by them (match ${r8 && r8.match}, ${r8 && r8.outcome && r8.outcome.kills} kills of ${p8.st.kills}; by the new rules it would not match: ${now8 !== p8.hash})`,
  );
}

// (a campaign mission's ticket: the broken log below leaves it standing, and the mission's run after it is played on
// it)
const t6 = (await call('POST', '/api/run/start', { rev: SIM.REV, mission: 'office', map: 'lab' }, tok)).j;
backdate(t6.id, 30);
ok(
  (await call('POST', '/api/run/end', { id: t6.id, n: 100, log: [0, 255, 0, 0, 5, 5, 99] }, tok)).code === 400,
  'a broken log: refused',
);
// a campaign mission's run: the ticket carries the mission, the replay plays its script (live/missions.js) and ends
// where the page did
{
  backdate(t6.id, 2000); // (long before every other run here: runs of one account can't overlap)
  const pm = playRun(t6, 60, false, { ...KIT, mission: 'office' });
  await call('POST', '/api/run/end', { id: t6.id, n: pm.rec.n, z: z(pm.rec.log), hash: pm.hash, want: KIT }, tok);
  const rm = await result(t6.id);
  ok(
    t6.mission === 'office' && t6.seed === SIM.OFFICE && rm && rm.match && rm.outcome.mission === 'office',
    `a mission's run: its ticket names the current mission, on its own map, the replay plays its script ` +
      `(match ${rm && rm.match}, task ${pm.st.mis.i})`,
  );
}
const coinsNow = (await call('GET', '/api/save', undefined, tok)).j.save.coins;
ok(
  (await call('POST', '/api/run/end', { id: 'nope', n: 10, log: [] }, tok)).code === 404 &&
    (await call('GET', '/api/run/nope', undefined, tok)).code === 404,
  'a run with no ticket: refused',
);
ok((await call('GET', '/api/save', undefined, tok)).j.save.coins === coinsNow, '… and the coins did not move');

// a log as big as the body allows, for a run with no ticket: refused before it is unpacked
{
  const big = zlib.gzipSync(Buffer.from(JSON.stringify(Array.from({ length: 3e6 }, () => 1)))).toString('base64'),
    t0 = Date.now();
  const rr = await call('POST', '/api/run/end', { id: 'bogus', n: 400000, z: big }, tok);
  ok(rr.code === 404, `a huge log for no ticket: refused without being read (${Date.now() - t0} ms)`);
}
// the face: dealt once (avatar, background, an English name from its animal); a new name in any letters; no markup
{
  const s0 = (await call('GET', '/api/save', undefined, tok)).j.save;
  ok(
    Number.isInteger(s0.ava) &&
      Number.isInteger(s0.bg) &&
      /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(s0.nick) &&
      D.AVATARS[s0.ava].animal.some((x) => s0.nick.endsWith(x)),
    `a face was dealt: avatar ${s0.ava}, background ${s0.bg}, "${s0.nick}"`,
  );
  let rn = await call('POST', '/api/act', { a: { k: 'nick', v: '  Злой   Кролик ' } }, tok);
  ok(rn.code === 200 && rn.j.save.nick === 'Злой Кролик', 'a new name in any letters (spaces tidied)');
  rn = await call('POST', '/api/act', { a: { k: 'nick', v: '‮evil' } }, tok);
  ok(
    rn.code === 200 && rn.j.save.nick === 'evil',
    'invisible characters dropped from a name (a right-to-left override)',
  );
  for (const v of ['<b>x</b>', 'a', 'x'.repeat(19), '‮​', 42])
    ok(
      (await call('POST', '/api/act', { a: { k: 'nick', v } }, tok)).code === 409,
      'a name refused: ' + JSON.stringify(v),
    );
}
// tickets can't be dealt over and over (to pick the seeds)
{
  let codes = [];
  for (let i = 0; i < 10; i++) codes.push((await call('POST', '/api/run/start', { rev: SIM.REV }, tok)).code);
  ok(codes.includes(429), 'tickets asked for again and again: slowed down (' + codes.join(' ') + ')');
}

// ---------------- the ranking: by rank, then the record — the fastest win (none: after); an account from before the record takes its
// fastest win among its kept results
{
  const put = (acc, stats, recent = []) =>
    fs.writeFileSync(
      path.join(tmp, 'accounts', hashA(acc) + '.json'),
      JSON.stringify({ v: 2, account: acc, t: 1, save: { stats, rxp: 0 }, open: [], recent }),
    );
  put('bob.near', { runs: 4, wins: 2, best: 700, fast: 580 });
  put('carol.near', { runs: 9, wins: 0, best: 650, fast: 0 });
  put('dave.near', { runs: 3, wins: 1, best: 620, fast: 620 });
  put('erin.near', { runs: 5, wins: 1, best: 700 }, [
    { id: 'x', outcome: { win: false, t: 700 } },
    { id: 'y', outcome: { win: true, t: 590 } },
  ]);
  const b = (await call('GET', '/api/leaderboard')).j,
    ones = b.top.filter((r) => ['bob.near', 'carol.near', 'dave.near', 'erin.near'].includes(r.account));
  ok(
    JSON.stringify(ones.map((r) => [r.account, r.fast])) ===
      JSON.stringify([
        ['bob.near', 580],
        ['erin.near', 590],
        ['dave.near', 620],
        ['carol.near', 0],
      ]),
    'the ranking: the fastest win first, no win after, the record of an old account from its kept wins: ' +
      JSON.stringify(ones.map((r) => [r.account, r.fast])),
  );
}
// ---------------- static
ok((await call('GET', '/live/index.html')).code === 200, 'static: the game is served');
ok((await call('GET', '/')).code === 302, 'static: / goes to the game');
for (const p of [
  '/server/server.mjs',
  '/server/data/secret',
  '/live/../server/data/secret',
  '/live/%2e%2e/server/server.mjs',
  '/.git/config',
  '/art/style_bible.txt',
  '/gen/runcal.cjs',
])
  ok((await call('GET', p)).code === 404, 'static: ' + p + ' is not served');
srv.close();
rpc.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
process.exit(fails.length ? 1 : 0);
