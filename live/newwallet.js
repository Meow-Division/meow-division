// live/newwallet.js — a NEAR wallet made inside the game, with no window of another site (docs/chain.md, "Create").
// wallet.js loads it the first time it is needed. The player types a name; the page checks it is free
// (GET /api/wallet/free) and makes a new 12-word recovery phrase here, its key derived the way NEAR wallets do it
// (near-seed-phrase: BIP39 seed by PBKDF2-HMAC-SHA512, SLIP-10 ed25519 at m/44'/397'/0'), so the same words open the
// wallet in HOT, Meteor or MyNearWallet. The words stay in this browser (localStorage md.wallets) and nothing but the
// public key leaves it: the server (POST /api/wallet/create) has the game's contract create `<name>.near` with that
// key, once mission 1 is proven by this browser's device token (its mission run played again by the server). The page
// then signs the login message with the new key (NEP-413, the payload server.mjs checks) and the wallet is connected
// like any other (WALLET.keyLogin; what the device's runs proved goes along, rules.js adopt). The words are shown
// once right after, to write down; the wallet panel shows them again. The same window offers a wallet made here when
// the player taps Connect. WebCrypto does the work (PBKDF2, HMAC-SHA512, SHA-256, Ed25519); the BIP39 English list is
// live/bip39_en.txt. Exports the key functions for the node tests (test/newwallet.test.mjs).
(function () {
  const CRYPTO = globalThis.crypto && globalThis.crypto.subtle ? globalThis.crypto : null,
    S = CRYPTO && CRYPTO.subtle,
    te = new TextEncoder();
  const PATH = [44, 397, 0], // m/44'/397'/0', every step hardened
    STORE = 'md.wallets', // { [accountId]: { words, publicKey, at, made } }
    DEVICE = 'md.device', // this browser's guest token (POST /api/guest)
    NAME = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/,
    NAME_MAX = 40,
    PARENT = 'near';
  const NW = {};

  // ---------------- bytes
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) {
    let n = 0n,
      s = '';
    for (const b of bytes) n = n * 256n + BigInt(b);
    while (n > 0n) {
      s = B58[Number(n % 58n)] + s;
      n /= 58n;
    }
    for (const b of bytes) {
      if (b) break;
      s = '1' + s;
    }
    return s;
  }
  const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const toB64 = (bytes) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };

  // ---------------- the recovery phrase (BIP39, English, 12 words: 128 bits and a 4-bit checksum)
  let LIST = null;
  NW.useWords = (list) => {
    if (!Array.isArray(list) || list.length !== 2048) throw new Error('bad word list');
    LIST = list;
  };
  async function words() {
    if (LIST) return LIST;
    const src = 'bip39_en.txt',
      v = (window.__VER && window.__VER[src]) || window.__V || 0,
      r = await fetch(src + '?v=' + v);
    if (!r.ok) throw new Error('word list ' + r.status);
    NW.useWords((await r.text()).trim().split(/\s+/));
    return LIST;
  }
  NW.phraseOf = async (entropy) => {
    const list = await words(),
      hash = new Uint8Array(await S.digest('SHA-256', entropy)),
      bits =
        Array.from(entropy, (b) => b.toString(2).padStart(8, '0')).join('') +
        hash[0]
          .toString(2)
          .padStart(8, '0')
          .slice(0, entropy.length / 4);
    const out = [];
    for (let i = 0; i < bits.length; i += 11) out.push(list[parseInt(bits.slice(i, i + 11), 2)]);
    return out;
  };
  NW.newPhrase = () => NW.phraseOf(CRYPTO.getRandomValues(new Uint8Array(16)));

  // ---------------- the key: seed, SLIP-10 ed25519 at m/44'/397'/0', an Ed25519 CryptoKey and its public key
  async function hmac512(key, data) {
    const k = await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    return new Uint8Array(await S.sign('HMAC', k, data));
  }
  async function seedOf(list) {
    const phrase = list.join(' ').normalize('NFKD'),
      k = await S.importKey('raw', te.encode(phrase), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(
      await S.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: te.encode('mnemonic'), iterations: 2048 }, k, 512),
    );
  }
  async function slip10(seed) {
    let I = await hmac512(te.encode('ed25519 seed'), seed),
      key = I.slice(0, 32),
      chain = I.slice(32);
    for (const i of PATH) {
      const data = new Uint8Array(37),
        idx = (i | 0x80000000) >>> 0;
      data.set(key, 1);
      data.set([idx >>> 24, (idx >>> 16) & 255, (idx >>> 8) & 255, idx & 255], 33);
      I = await hmac512(chain, data);
      key = I.slice(0, 32);
      chain = I.slice(32);
    }
    return key;
  }
  const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
  async function keyOf(secret) {
    const der = new Uint8Array(48);
    der.set(PKCS8);
    der.set(secret, 16);
    const privateKey = await S.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']),
      jwk = await S.exportKey('jwk', privateKey);
    return { privateKey, publicKey: 'ed25519:' + b58(fromB64(jwk.x)) };
  }
  // the words → { publicKey: 'ed25519:…', privateKey: CryptoKey }
  NW.keyOf = async (list) => keyOf(await slip10(await seedOf(list.map((w) => String(w).trim().toLowerCase()))));
  // can this browser do it: WebCrypto with Ed25519
  let can = null;
  NW.supported = () =>
    can ||
    (can = (async () => {
      try {
        return !!S && !!(await keyOf(new Uint8Array(32).fill(1))).publicKey;
      } catch (e) {
        return false;
      }
    })());

  // ---------------- the login message (NEP-413): sha256(borsh(u32 2^31 + 413, message, nonce[32], recipient, None))
  NW.nep413 = async (message, nonce, recipient) => {
    const m = te.encode(message),
      r = te.encode(recipient),
      buf = new Uint8Array(4 + 4 + m.length + 32 + 4 + r.length + 1),
      dv = new DataView(buf.buffer);
    let o = 0;
    dv.setUint32(o, 2 ** 31 + 413, true);
    dv.setUint32((o += 4), m.length, true);
    buf.set(m, (o += 4));
    buf.set(nonce, (o += m.length));
    dv.setUint32((o += 32), r.length, true);
    buf.set(r, (o += 4));
    buf[o + r.length] = 0; // callbackUrl: none
    return new Uint8Array(await S.digest('SHA-256', buf));
  };
  // the one message this page signs, for the game's domain (server.mjs RECIPIENT, MESSAGE): the key is a full-access
  // key and signs without a wallet's window, so a challenge naming anything else is refused, never signed
  NW.LOGIN = {
    recipient: 'game.meowdivision.fun',
    message: 'Meow Division: sign in to keep your progress under this account',
  };
  // the server's challenge ({ message, nonce (base64), recipient }) signed with the key: the signature in base64
  NW.signLogin = async (key, ch) => {
    if (!ch || ch.recipient !== NW.LOGIN.recipient || ch.message !== NW.LOGIN.message) throw new Error('bad challenge');
    const hash = await NW.nep413(ch.message, fromB64(ch.nonce), ch.recipient);
    return toB64(new Uint8Array(await S.sign({ name: 'Ed25519' }, key.privateKey, hash)));
  };
  NW.nameOf = (v) => {
    const n = String(v || '')
      .trim()
      .toLowerCase();
    return n.length >= 2 && n.length <= NAME_MAX && NAME.test(n) ? n : null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NW;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.NEWWALLET = NW;

  // ---------------- this browser's wallets: their words, never sent anywhere
  const store = {
    all: () => {
      try {
        const v = JSON.parse(localStorage.getItem(STORE) || '{}');
        return v && typeof v === 'object' ? v : {};
      } catch (e) {
        return {};
      }
    },
    put: (id, entry) => {
      const all = store.all();
      if (entry) all[id] = entry;
      else delete all[id];
      try {
        localStorage.setItem(STORE, JSON.stringify(all));
        return true;
      } catch (e) {
        console.warn('wallet store', e.message);
        return false;
      }
    },
  };
  NW.made = () =>
    Object.entries(store.all())
      .filter(([, w]) => w && w.made && Array.isArray(w.words))
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id]) => id);

  const API = window.SAVE_API || '/api',
    T = (k, v) => I18N.t(k, v),
    esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  // (ms: a wallet's creation waits for the chain on the server, a slow RPC included: up to about two minutes)
  async function api(method, path, body, ms = 150000) {
    const r = await fetch(API + path, {
      method,
      signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j = null;
    try {
      j = await r.json();
    } catch (e) {}
    if (!r.ok) throw Object.assign(new Error((j && j.error) || 'http ' + r.status), { status: r.status });
    return j;
  }
  // (wallet.js keeps it: the same token its guest mission runs went to the server with, whose record proves mission 1)
  async function device() {
    if (window.WALLET && WALLET.device) return WALLET.device();
    try {
      const t = localStorage.getItem(DEVICE);
      if (t) return t;
    } catch (e) {}
    const { device: t } = await api('POST', '/guest', {});
    try {
      localStorage.setItem(DEVICE, t);
    } catch (e) {
      console.warn('device token', e.message); // (this visit only)
    }
    return t;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // the new key signs in; the key shows in a final block a moment after the account is made, so a refusal is tried again
  async function login(accountId, list) {
    const key = await NW.keyOf(list);
    for (let i = 0; ; i++) {
      try {
        return await WALLET.keyLogin(accountId, key.publicKey, (ch) => NW.signLogin(key, ch));
      } catch (e) {
        if (i >= 4 || !(e.status === 401 || e.status === 502 || !e.status)) throw e;
        await sleep(2500);
      }
    }
  }

  // ---------------- the window: name → making → the words (or what went wrong); and the pick on Connect
  let el = null,
    view = null, // { k: 'name' | 'busy' | 'words' | 'error' | 'pick', … }
    modal = false,
    checkT = 0,
    asked = '';
  const ERR = {
    name: 'wallet.make.bad',
    taken: 'wallet.make.taken',
    once: 'wallet.make.once',
    mission: 'wallet.make.mission',
    limit: 'wallet.make.limit',
    not_ready: 'wallet.make.notReady',
    browser: 'wallet.make.browser',
    login: 'wallet.make.login',
    signed_in: 'wallet.make.signedIn',
  };
  const por = () => `assets/por_nova.png?v=${window.__V || 0}`;
  const EYE =
      '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    EYE_OFF =
      '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    TICK =
      '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function card(title, body, wide) {
    return (
      `<div class="nw-card${wide ? ' wide' : ''}"><div class="nw-por"><img src="${por()}" alt="" draggable="false"></div>` +
      `<div class="nw-text"><div class="nw-name">${T('voice.name.nova')}</div><h3>${title}</h3>${body}</div></div>`
    );
  }
  function html() {
    const v = view;
    if (v.k === 'name') {
      const hint = v.hint ? `<div class="nw-hint ${v.hint.cls}">${T(v.hint.key)}</div>` : '<div class="nw-hint"></div>';
      return card(
        T('wallet.make.title'),
        `<p>${T('wallet.make.text')}</p>` +
          `<label class="nw-field"><input data-nw-name maxlength="${NAME_MAX}" autocomplete="off" autocapitalize="off" ` +
          `spellcheck="false" enterkeyhint="go" placeholder="${esc(T('wallet.make.placeholder'))}" value="${esc(v.name || '')}">` +
          `<span>.${PARENT}</span></label>${hint}<div class="nw-btns">` +
          `<button class="btn orange" data-nw="go"${v.free ? '' : ' disabled'}>${T('wallet.make.go')}</button>` +
          `<button class="btn ghost" data-nw="close">${T('wallet.make.close')}</button></div>`,
      );
    }
    if (v.k === 'busy')
      return card(
        T('wallet.make.title'),
        `<p class="nw-busy"><i class="nw-spin"></i>${T(v.text || 'wallet.make.busy')}</p>`,
      );
    // the words: blurred until the eye is pressed (anyone looking over the shoulder sees nothing); copied: the button
    // goes green with a tick for a moment
    if (v.k === 'words') {
      const list = v.words.map((w, i) => `<li><i>${i + 1}</i><b>${esc(w)}</b></li>`).join('');
      return card(
        T('wallet.phrase.title'),
        `<p class="nw-acc">${esc(v.accountId)}</p><p>${T('wallet.phrase.text')}</p>` +
          `<div class="nw-wbox${v.shown ? ' shown' : ''}"><ol class="nw-words">${list}</ol>` +
          `<button class="nw-eye" data-nw="eye" aria-pressed="${v.shown ? 'true' : 'false'}">${v.shown ? EYE_OFF : EYE}<span>${T(v.shown ? 'wallet.phrase.hide' : 'wallet.phrase.reveal')}</span></button></div>` +
          (v.note ? `<p class="nw-note">${T(v.note)}</p>` : '') +
          `<div class="nw-btns"><button class="btn orange" data-nw="done">${T(v.again ? 'wallet.make.close' : 'wallet.phrase.done')}</button>` +
          `<button class="btn ghost nw-copy${v.copied ? ' ok' : ''}" data-nw="copy">${v.copied ? `<span class="nw-tick">${TICK}</span>` : ''}${T(v.copied ? 'wallet.phrase.copied' : 'wallet.phrase.copy')}</button></div>`,
        true,
      );
    }
    if (v.k === 'pick')
      return card(
        T('wallet.pick.title'),
        `<p>${T('wallet.pick.text')}</p><div class="nw-btns col">` +
          v.list
            .map((id) => `<button class="btn orange" data-nw="use" data-id="${esc(id)}">${esc(id)}</button>`)
            .join('') +
          `<button class="btn" data-nw="other">${T('wallet.pick.other')}</button>` +
          `<button class="btn ghost" data-nw="close">${T('wallet.make.close')}</button></div>`,
      );
    return card(
      T('wallet.make.title'),
      `<p>${T(ERR[v.code] || 'wallet.make.rpc')}</p><div class="nw-btns">` +
        (v.retry ? `<button class="btn orange" data-nw="again">${T('wallet.make.again')}</button>` : '') +
        `<button class="btn ghost" data-nw="close">${T('wallet.make.close')}</button></div>`,
    );
  }
  function paint() {
    if (!el) return;
    el.innerHTML = html();
    const inp = el.querySelector('[data-nw-name]');
    if (inp && view.focus) {
      view.focus = false;
      inp.focus();
    }
  }
  // while the name is typed only its hint and the button change (the field stays as it is: a phone keeps its keyboard)
  function hint() {
    const h = el && el.querySelector('.nw-hint'),
      go = el && el.querySelector('[data-nw="go"]');
    if (!h || !go) return;
    h.className = 'nw-hint' + (view.hint && view.hint.cls ? ' ' + view.hint.cls : '');
    h.textContent = view.hint ? T(view.hint.key) : '';
    go.disabled = !view.free;
  }
  function show(v) {
    view = v;
    if (!el) {
      el = document.createElement('div');
      el.id = 'nw';
      (document.getElementById('ui') || document.body).appendChild(el);
      el.addEventListener('click', onClick);
      el.addEventListener('input', onInput);
      addEventListener('keydown', onKey, true);
      modal = !!window.__modal;
      window.__modal = true; // (the hero stands at the base while the window is up)
      requestAnimationFrame(() => el && el.classList.add('on'));
    }
    paint();
  }
  function close() {
    if (!el || (view && view.k === 'busy')) return;
    clearTimeout(checkT);
    removeEventListener('keydown', onKey, true);
    el.remove();
    el = null;
    view = null;
    window.__modal = modal;
  }
  NW.close = close;
  function onKey(e) {
    if (!el) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!(view.k === 'words' && !view.again)) close();
      return;
    }
    if (e.key === 'Enter' && view.k === 'name' && view.free) {
      e.preventDefault();
      make();
    }
    // (the game's keys don't reach the base under the window; typing in the name field goes on as usual)
    if (!e.ctrlKey && !e.metaKey && !/^F\d+$/.test(e.code)) e.stopPropagation();
  }
  // the name as typed: lower case, checked, then asked about once the typing stops
  function onInput(e) {
    if (!e.target.matches('[data-nw-name]') || view.k !== 'name') return;
    const raw = e.target.value,
      low = raw.toLowerCase();
    if (low !== raw) {
      const p = e.target.selectionStart;
      e.target.value = low;
      e.target.setSelectionRange(p, p);
    }
    view.name = low;
    view.free = false;
    clearTimeout(checkT);
    const name = NW.nameOf(low);
    if (!low.trim()) view.hint = null;
    else if (!name) view.hint = { cls: 'bad', key: 'wallet.make.bad' };
    else {
      view.hint = { cls: '', key: 'wallet.make.checking' };
      checkT = setTimeout(() => check(name), 400);
    }
    hint();
  }
  async function check(name) {
    asked = name;
    let free = null;
    try {
      free = (await api('GET', '/wallet/free?name=' + encodeURIComponent(name), undefined, 15000)).free;
    } catch (e) {
      console.warn('wallet name', e.message);
    }
    if (!el || view.k !== 'name' || asked !== name || NW.nameOf(view.name) !== name) return;
    view.free = free === true;
    view.hint =
      free === true
        ? { cls: 'ok', key: 'wallet.make.free' }
        : free === false
          ? { cls: 'bad', key: 'wallet.make.taken' }
          : { cls: 'bad', key: 'wallet.make.rpc' };
    hint();
  }
  function onClick(e) {
    const b = e.target.closest('[data-nw]');
    if (!b) {
      if (e.target === el && view.k !== 'busy' && !(view.k === 'words' && !view.again)) close();
      return;
    }
    const a = b.dataset.nw;
    if (a === 'close' || a === 'done') close();
    else if (a === 'go') make();
    else if (a === 'again') NW.open('make');
    else if (a === 'copy') copy();
    else if (a === 'eye' && view.k === 'words') {
      view.shown = !view.shown;
      paint();
    } else if (a === 'use') use(b.dataset.id);
    else if (a === 'other') {
      close();
      WALLET.connect({ other: true });
    }
  }
  // the words to the clipboard (a web view without the clipboard API: the old way, through a selected text field)
  async function copy() {
    const text = view.words.join(' ');
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      try {
        ok = document.execCommand('copy');
      } catch (e2) {
        console.warn('copy', e2.message);
      }
      t.remove();
    }
    if (ok && view && view.k === 'words') {
      const v = view;
      v.copied = true;
      paint();
      clearTimeout(v.copyT);
      v.copyT = setTimeout(() => {
        v.copied = false;
        if (view === v) paint();
      }, 2600);
    }
  }

  // the wallet itself: words and key here, the account by the server, then the login with the new key
  async function make() {
    const name = NW.nameOf(view.name);
    if (!name || !view.free) return;
    const accountId = name + '.' + PARENT;
    show({ k: 'busy' });
    let entry = store.all()[accountId];
    try {
      if (!entry || entry.made || !Array.isArray(entry.words)) {
        const list = await NW.newPhrase(),
          key = await NW.keyOf(list);
        entry = { words: list, publicKey: key.publicKey, at: Date.now(), made: false };
        // (kept before anything is sent: an answer lost on the way never loses the words of a wallet that was made)
        if (!store.put(accountId, entry)) throw Object.assign(new Error('storage'), { code: 'browser' });
      }
      const r = await api('POST', '/wallet/create', { name, publicKey: entry.publicKey, device: await device() });
      entry.made = true;
      store.put(r.accountId, entry);
      let note = '';
      try {
        await login(r.accountId, entry.words);
      } catch (e) {
        console.warn('wallet login', e.message);
        note = 'wallet.make.login';
      }
      show({ k: 'words', accountId: r.accountId, words: entry.words, note });
    } catch (e) {
      const code = e.code || e.message;
      if (code === 'taken' || code === 'name' || code === 'mission' || code === 'limit' || code === 'not_ready')
        store.put(accountId, null); // (nothing was made with these words)
      if (code === 'once' && (await recover())) return;
      show({ k: 'error', code, retry: code !== 'once' && code !== 'mission' && code !== 'signed_in' });
    }
  }
  // words kept from a try whose answer never came: if one of them made its wallet, it signs in and its words show
  async function recover() {
    for (const [id, w] of Object.entries(store.all())) {
      if (!w || w.made || !Array.isArray(w.words)) continue;
      try {
        await login(id, w.words);
        w.made = true;
        store.put(id, w);
        show({ k: 'words', accountId: id, words: w.words });
        return true;
      } catch (e) {
        console.warn('wallet recover', id, e.message);
      }
    }
    return false;
  }
  async function use(id) {
    const w = store.all()[id];
    if (!w) return;
    show({ k: 'busy', text: 'wallet.pick.busy' });
    try {
      await login(id, w.words);
      close();
    } catch (e) {
      console.warn('wallet open', id, e.message);
      show({ k: 'error', code: 'login', retry: false });
    }
  }

  // what wallet.js opens: 'make' (Create), 'pick' (Connect, with wallets made here), 'words' (the wallet panel)
  NW.open = async (what, accountId) => {
    if (what === 'words') {
      const w = store.all()[accountId];
      if (w && Array.isArray(w.words)) show({ k: 'words', accountId, words: w.words, again: true });
      return;
    }
    if (what === 'pick') return show({ k: 'pick', list: NW.made() });
    if (window.WALLET && WALLET.account) return;
    if (!(await NW.supported())) return show({ k: 'error', code: 'browser' });
    if (!(Array.isArray(SAVE.camp) && SAVE.camp.includes(ECONOMY.MISSIONS[0].id)))
      return show({ k: 'error', code: 'mission' });
    show({ k: 'name', name: '', free: false, hint: null, focus: true });
  };
})();
