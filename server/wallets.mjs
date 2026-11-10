// server/wallets.mjs — a NEAR wallet made inside the game, for a guest (docs/chain.md, "Create"). The page picks a
// name and makes the key pair itself, from a new recovery phrase the player writes down; only the public key comes
// here. The server checks the request and asks the items contract (`game_wallet`, through the server's function-call
// key) to create `<name>.near` with that key; the contract pays the small deposit from its own balance and keeps its
// own cap. The page then signs in with the new key like any wallet (POST /api/login), and the guest's first steps go
// along as on any first sign-in (rules.js adopt, from the device's record).
//   POST /api/guest                        a device token: this browser's guest session (HMAC-signed, a year)
//   GET  /api/wallet/free?name=<name>      { name, accountId, free }
//   POST /api/wallet/create {name, publicKey, device}   → { accountId } once the account is there
// Mission 1 must be proven: the device's record on the server (server.mjs, guests: its mission runs played again by the
// server) holds it finished; what the page's save says counts for nothing (a device token is free, a save is typed).
// Refused with a code the page puts into words: 'name' (not a name), 'key', 'guest' (no device token), 'signed_in'
// (a wallet is connected), 'mission' (mission 1 not proven by this device), 'once' (this device made one), 'busy',
// 'taken', 'limit' (the day's cap, this address's, the contract's), 'not_ready' (the contract or the server's key not
// updated yet, or no key configured), 'rpc' (the network). One wallet per device token: its request id is fixed, so
// the contract applies it once whatever the server remembers. The day's counts and the devices that made one live in
// DATA/wallets.json; addresses only as salted hashes. Keys never reach a log.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { publicKeyBytes, RpcError } from './near.mjs';

const NAME = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/,
  NAME_MIN = 2,
  NAME_MAX = 40,
  DEVICE_DAYS = 365,
  // the gas attached to game_wallet. It needs its own run (2.6 Tgas on mainnet, tx 724tj6MK… of 2026-11-10) plus the 30 Tgas
  // it hands the registrar and the 10 Tgas it holds for its callback (contract/src/wallet.rs): about 43 Tgas; the rest
  // goes to the callback, which burnt 1.8. 60 Tgas leaves a third on top. The function-call key's allowance is charged
  // for what is attached, not burnt, so 100 Tgas used it up nearly twice as fast
  GAS = 60e12;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const fail = (code, error) => ({ code, body: { error } });
const done = (body) => ({ code: 200, body });

// proven(g): what the record of device g proves (its save: camp, items…), or null — server.mjs guestProof
export function makeWallets({
  dataDir,
  secret,
  near,
  signer,
  items,
  parent,
  proven,
  firstMission,
  daily,
  perIp,
  wait,
}) {
  const file = path.join(dataDir, 'wallets.json');
  const hmac = (s) => crypto.createHmac('sha256', secret).update(s).digest();
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const keyWait = wait || { ms: 20e3, step: 1000 };

  // ---- the device token: { k: 'device', g: random id, e: expiry }, signed like the session tokens
  function guest() {
    const body = Buffer.from(
      JSON.stringify({
        k: 'device',
        g: crypto.randomBytes(16).toString('base64url'),
        e: Date.now() + DEVICE_DAYS * 864e5,
      }),
    ).toString('base64url');
    return done({ device: body + '.' + hmac(body).toString('base64url') });
  }
  // the device a token names: { g: its id, e: the token's expiry }, or null (not one of ours, or expired)
  function device(tok) {
    const m = /^([\w-]+)\.([\w-]+)$/.exec(typeof tok === 'string' ? tok : '');
    if (!m) return null;
    const want = hmac(m[1]),
      got = Buffer.from(m[2], 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    try {
      const t = JSON.parse(Buffer.from(m[1], 'base64url').toString());
      return t.k === 'device' && typeof t.g === 'string' && t.g.length <= 64 && t.e > Date.now()
        ? { g: t.g, e: t.e }
        : null;
    } catch {
      return null;
    }
  }
  const deviceOf = (tok) => (device(tok) || {}).g || null;
  const nameOf = (v) => {
    const n = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return n.length >= NAME_MIN && n.length <= NAME_MAX && NAME.test(n) ? n : null;
  };

  // ---- DATA/wallets.json: { devices: { <hash>: { accountId, at } }, days: { <date>: { n, ips: { <hash>: n } } } },
  // changed one request at a time
  let state = null,
    lane = Promise.resolve();
  async function load() {
    try {
      const s = JSON.parse(await fs.readFile(file, 'utf8'));
      return { devices: s.devices || {}, days: s.days || {} };
    } catch (e) {
      if (e.code === 'ENOENT') return { devices: {}, days: {} };
      throw e;
    }
  }
  function locked(fn) {
    const p = lane.then(async () => {
      state = state || (await load());
      const out = fn(state);
      const keep = [day(), day(Date.now() - 864e5)];
      for (const d of Object.keys(state.days)) if (!keep.includes(d)) delete state.days[d];
      const tmp = file + '.' + crypto.randomBytes(4).toString('hex');
      await fs.writeFile(tmp, JSON.stringify(state));
      await fs.rename(tmp, file);
      return out;
    });
    lane = p.catch(() => {});
    return p;
  }
  const busy = new Set();

  async function free(q) {
    const name = nameOf(q);
    if (!name) return fail(400, 'name');
    const accountId = name + '.' + parent;
    try {
      return done({ name, accountId, free: !(await near.viewAccount(accountId)) });
    } catch (e) {
      console.warn('wallet free', accountId, e.message);
      return fail(502, 'rpc');
    }
  }

  // the key on the new account, as a final block shows it (the login reads it there)
  async function keyThere(accountId, publicKey) {
    const k = await near.accessKey(accountId, publicKey).catch(() => null);
    return !!(k && k.permission === 'FullAccess');
  }
  async function waitKey(accountId, publicKey) {
    for (const until = Date.now() + keyWait.ms; Date.now() < until;) {
      if (await keyThere(accountId, publicKey)) return true;
      await new Promise((r) => setTimeout(r, keyWait.step));
    }
    return false;
  }
  // a chain failure in the page's words
  function why(text) {
    if (/MethodNameMismatch|MethodNotFound|CodeDoesNotExist|ReceiverMismatch/.test(text)) return fail(503, 'not_ready');
    if (/no wallets left|storage top-up|NotEnoughAllowance|NotEnoughBalance|LackBalanceForState/.test(text))
      return fail(429, 'limit');
    return fail(502, 'rpc');
  }

  async function create(b, { ip, signedIn }) {
    if (signedIn) return fail(409, 'signed_in');
    const g = deviceOf(b.device);
    if (!g) return fail(401, 'guest');
    const name = nameOf(b.name);
    if (!name) return fail(400, 'name');
    if (!publicKeyBytes(b.publicKey)) return fail(400, 'key');
    const proof = await proven(g);
    if (!proof || !proof.camp.includes(firstMission)) return fail(409, 'mission');
    if (!signer) return fail(503, 'not_ready');
    const accountId = name + '.' + parent,
      publicKey = b.publicKey,
      dev = sha(g),
      requestId = 'w-' + dev.slice(0, 40),
      ipKey = hmac('ip ' + ip)
        .toString('hex')
        .slice(0, 16);
    if (busy.has(dev)) return fail(409, 'busy');
    busy.add(dev);
    try {
      // once a device; the day's cap and this address's, counted now and given back if nothing is made
      const held = await locked((st) => {
        if (st.devices[dev]) return 'once';
        const d = (st.days[day()] = st.days[day()] || { n: 0, ips: {} });
        if (d.n >= daily || (d.ips[ipKey] || 0) >= perIp) return 'limit';
        d.n++;
        d.ips[ipKey] = (d.ips[ipKey] || 0) + 1;
        return null;
      });
      if (held) return fail(held === 'once' ? 409 : 429, held);
      const today = day();
      let keep = false;
      const record = (made) =>
        locked((st) => {
          st.devices[dev] = { accountId: made, at: Date.now() };
        });
      try {
        try {
          await signer.ready();
        } catch (e) {
          console.error('wallet signer', e.message);
          return fail(503, 'not_ready');
        }
        try {
          if (await near.viewAccount(accountId)) return fail(409, 'taken');
        } catch (e) {
          console.warn('wallet view', accountId, e.message);
          return fail(502, 'rpc');
        }
        let out;
        try {
          out = await signer.call(
            items,
            'game_wallet',
            { account_id: accountId, public_key: publicKey, request_id: requestId },
            { gas: GAS },
          );
        } catch (e) {
          // refused before it ran (a key not allowed the method yet, no allowance) or never sent
          console.warn('wallet call', accountId, e instanceof RpcError ? e.text.slice(0, 300) : e.message);
          return e instanceof RpcError ? why(e.text) : fail(502, 'rpc');
        }
        if (out.unknown) {
          keep = true; // (it may have gone through: its place stays counted; the same request id is safe to send again)
          console.warn('wallet unknown', accountId, out.hash);
          return fail(502, 'rpc');
        }
        if (!out.ok) {
          console.warn('wallet failed', accountId, out.hash, out.failure.slice(0, 300));
          return why(out.failure);
        }
        if (out.value !== true) {
          // false: the registrar refused (the name was taken meanwhile), or this device's request id was applied
          // before — the wallet made then, its answer lost on the way (the same name and key), or another one
          if (await keyThere(accountId, publicKey)) {
            keep = true;
            await record(accountId);
            return done({ accountId });
          }
          const applied = await near.view(items, 'op_done', { key: 'wallet:' + requestId }).catch(() => null);
          if (applied === true) {
            await record(null);
            return fail(409, 'once');
          }
          const taken = await near.viewAccount(accountId).catch(() => null);
          return taken ? fail(409, 'taken') : fail(502, 'rpc');
        }
        keep = true;
        await record(accountId);
        console.log('wallet made', accountId, out.hash);
        if (!(await waitKey(accountId, publicKey))) console.warn('wallet key not final yet', accountId);
        return done({ accountId });
      } finally {
        if (!keep)
          await locked((st) => {
            const d = st.days[today];
            if (!d) return;
            d.n = Math.max(0, d.n - 1);
            if (d.ips[ipKey] > 1) d.ips[ipKey]--;
            else delete d.ips[ipKey];
          });
      }
    } finally {
      busy.delete(dev);
    }
  }

  return { guest, free, create, device, deviceOf };
}
