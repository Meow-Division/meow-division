// live/audio.js — the sound, driven by the sim event bus (S.ev). Guns, blasts, hits, the zapper and zombies are recorded
// clips (live/audio/pack.mp3, BigSoundBank.com / Joseph Sardin, CC0; 64 kbit/s mono, decoded gaplessly, so the offsets in
// pack.json hold); the hero's steps are recorded too (audio/steps.mp3: Kenney's Impact Sounds, CC0), heard as a paw comes down in the drawn gait, on the surface under it; pickups and UI stings are synthesised. Mixer: sfx bus → glue compressor, UI bus, music bus (its own low-pass for menus), one shared reverb (an open
// street at dusk), master limiter. A voice table caps what plays at once (24 voices) by priority; sounds pan with their
// screen x and fade with distance off screen. Explosions in a chain come in later and quieter. M toggles mute.
// Nova's and Walt's lines (voice.js, intro.js): <audio> into their own bus; while one is said the music and the battle step back.
// Music: two recorded tracks, live/audio/music_lobby.mp3 in the menus and music_game.mp3 in a run, streamed (<audio> into the music bus)
// and crossfaded; the run's track starts over with each run and goes dull under the pause menu, the level-up cards and the results.
(function () {
  const A = (window.AUDIO = { on: true });
  // the step clips of each surface: [clip key, how many, level, pitch, reverb] (audio/steps.json: gen/steps_sfx.py)
  const STEP_SF = {
    soft: ['step', 6, 0.07, 1, 0.02],
    conc: ['conc', 5, 0.06, 1, 0.04],
    tile: ['conc', 5, 0.055, 1.22, 0.06],
    metal: ['metal', 5, 0.045, 1, 0.08],
    glass: ['glass', 5, 0.04, 1, 0.06],
  };
  let ctx = null,
    tap = null,
    lim = null,
    master,
    sfxBus,
    uiBus,
    musBus,
    musLP,
    voxBus,
    revIn,
    noise = null,
    sprite = null,
    MAP = null,
    PHANTOM = null, // the Copper Phantom's shot: { map, buf } from audio/phantom.json + .mp3 (a suppressed rifle: gen/phantom_sfx.mjs)
    STEPS = null, // the hero's steps: { map, buf } from audio/steps.json + .mp3 (Kenney's Impact Sounds, CC0)
    lastRun = null;
  const heard = new WeakSet(); // events (and warnings) already played
  // the buses' levels; under a voice line the music goes to DUCK_MUS of its own and the battle to DUCK_SFX
  const SFX = 0.9,
    MUS = 0.36,
    DUCK_MUS = 0.4,
    DUCK_SFX = 0.7;
  A.mus = true; // the music on (its own switch in the settings, the rest of the sound kept: the human's, 2026-11-12)
  A.musVol = 1; // how loud the music is, 0..1 of its level (the settings' slider: the human's, 2026-11-12), kept
  try {
    A.on = localStorage.getItem('md-mute') !== '1';
    A.mus = localStorage.getItem('md-music') !== '0';
    const v = parseFloat(localStorage.getItem('md-music-vol'));
    if (v >= 0 && v <= 1) A.musVol = v;
  } catch (e) {}
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
    R = Math.random,
    pick = (a) => a[Math.floor(R() * a.length)],
    vary = (k) => 1 + (R() * 2 - 1) * k;

  // ---------- graph ----------
  // The reverb's impulse, handed to done once filled: a slice of it a turn of the page (a quarter of a million samples with a
  // power and an exponent each in one go held the page for 100 ms and more while the game came up). Until then the reverb
  // has nothing to say, for a fraction of a second after the first sound could play
  const IMPULSE_SLICE = 16384;
  function impulse(T, done) {
    // decaying noise that darkens toward the tail + street slap
    const sr = ctx.sampleRate,
      n = Math.round(sr * T),
      b = ctx.createBuffer(2, n, sr),
      ch = [b.getChannelData(0), b.getChannelData(1)],
      lps = [0, 0];
    let at = 0;
    const part = () => {
      const end = Math.min(n, at + IMPULSE_SLICE);
      for (let c = 0; c < 2; c++) {
        const d = ch[c];
        let lp = lps[c];
        for (let i = at; i < end; i++) {
          const t = i / sr,
            k = Math.min(0.92, 0.25 + t * 0.35);
          lp += (R() * 2 - 1 - lp) * (1 - k);
          d[i] = lp * Math.pow(1 - t / T, 2.2) * Math.exp(-t * 1.1);
        }
        lps[c] = lp;
      }
      at = end;
      if (at < n) {
        setTimeout(part, 0);
        return;
      }
      for (let c = 0; c < 2; c++)
        for (const [ms, g] of [
          [11, 0.5],
          [23, 0.35],
          [37, 0.25],
          [61, 0.18],
        ])
          ch[c][Math.round((sr * (ms + c * 3)) / 1000)] += g;
      done(b);
    };
    part();
  }
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return;
    }
    lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.12;
    lim.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = A.on ? 0.9 : 0;
    master.connect(lim);
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.2;
    glue.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX;
    sfxBus.connect(glue);
    uiBus = ctx.createGain();
    uiBus.gain.value = 0.7;
    uiBus.connect(master);
    musLP = ctx.createBiquadFilter();
    musLP.type = 'lowpass';
    musLP.frequency.value = 18000;
    musLP.Q.value = 0.5;
    musLP.connect(master);
    musBus = ctx.createGain();
    musBus.gain.value = MUS * A.musVol;
    musBus.connect(musLP);
    voxBus = ctx.createGain();
    voxBus.gain.value = 1;
    voxBus.connect(master);
    const rev = ctx.createConvolver();
    impulse(2.6, (b) => (rev.buffer = b));
    revIn = ctx.createGain();
    revIn.connect(rev);
    const rg = ctx.createGain();
    rg.gain.value = 0.42;
    rev.connect(rg);
    rg.connect(master);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = R() * 2 - 1;
    const base = 'audio/pack';
    const v = '?v=' + (window.__V || 0); // the build's stamp, as every other asset
    Promise.all([
      fetch(base + '.json' + v).then((r) => r.json()),
      fetch(base + '.mp3' + v)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b)),
    ])
      .then(([m, b]) => {
        MAP = m;
        sprite = b;
      })
      .catch((e) => console.warn('sfx pack', e));
    Promise.all([
      fetch('audio/steps.json' + v).then((r) => r.json()),
      fetch('audio/steps.mp3' + v)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b)),
    ])
      .then(([map, buf]) => (STEPS = { map, buf }))
      .catch((e) => console.warn('steps', e));
    Promise.all([
      fetch('audio/phantom.json' + v).then((r) => r.json()),
      fetch('audio/phantom.mp3' + v)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b)),
    ])
      .then(([map, buf]) => (PHANTOM = { map, buf }))
      .catch((e) => console.warn('phantom', e));
    musInit();
    if (!A.on) ctx.suspend().catch(() => {});
  }
  const unlock = () => {
    init();
    if (ctx && A.on && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden)
      ctx.resume().catch(() => {});
    music(true);
  }; // (a track may start only from a gesture)
  // (capture: a button that keeps its touch or click to itself still lets the sound in; an iPhone counts touchend and click as the
  // gesture, not pointerdown)
  for (const k of ['pointerdown', 'pointerup', 'touchend', 'click']) addEventListener(k, unlock, true);
  // the sound without waiting for a touch, once the page is up (index.html, the world loaded: its downloads come first): the clips and
  // the tracks start loading and the sound starts where the browser lets a page play by itself — a Telegram Mini App's web view does
  // (the menus were silent until the first touch: a player looking at the lobby heard nothing for half a minute). A browser that
  // wants a gesture keeps the context suspended, and the first touch starts it as before
  A.boot = () => {
    if (!document.hidden) unlock();
  };
  addEventListener('keydown', (e) => {
    unlock();
    if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) A.toggle();
  });
  // a hidden tab is silent (the frame loop that stops the flamethrower / minigun loops doesn't run there)
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend().catch(() => {});
      for (const k in mus) mus[k].el.pause();
    } else if (A.on) ctx.resume().catch(() => {});
  }); // (the track: picked up again by the next frame)
  // muted: silent and idle (the tracks paused, the audio graph suspended: nothing decoded or mixed on a phone's battery)
  A.toggle = () => {
    A.on = !A.on;
    try {
      localStorage.setItem('md-mute', A.on ? '0' : '1');
    } catch (e) {}
    if (!master) return;
    master.gain.setTargetAtTime(A.on ? 0.9 : 0, ctx.currentTime, 0.03);
    if (A.on) {
      if (!document.hidden) ctx.resume().catch(() => {});
      music(true);
    } else {
      for (const k in mus) mus[k].el.pause();
      setTimeout(() => {
        if (!A.on) ctx.suspend().catch(() => {});
      }, 150);
    }
  };
  // the music alone off or on (kept): its track fades out and stops, or comes back where the player is
  A.setMusic = (on) => {
    A.mus = !!on;
    try {
      localStorage.setItem('md-music', A.mus ? '1' : '0');
    } catch (e) {}
    if (A.mus && A.musVol < 0.05) A.setMusicVol(0.5); // (turned on at nothing: heard again)
    music(true);
  };
  // how loud the music is (0..1, kept): at once, under a voice line too
  A.setMusicVol = (v) => {
    A.musVol = clamp(+v || 0, 0, 1);
    try {
      localStorage.setItem('md-music-vol', String(A.musVol));
    } catch (e) {}
    if (ctx && musBus) musBus.gain.setTargetAtTime(MUS * A.musVol * (ducked ? DUCK_MUS : 1), ctx.currentTime, 0.04);
  };

  // ---------- voices ----------
  const VOICES = [],
    KIND = {},
    MAXV = 24;
  function admit(k, prio, max, gap, t, synth = false) {
    // synth: a tone / burst that takes no voice (gap only)
    for (let i = VOICES.length - 1; i >= 0; i--) if (VOICES[i].end < ctx.currentTime) VOICES.splice(i, 1);
    const kk = KIND[k] || (KIND[k] = { last: -9 });
    if (t - kk.last < gap) return false;
    if (synth) {
      kk.last = t;
      return true;
    }
    const same = VOICES.filter((v) => v.k === k);
    if (same.length >= max) {
      if (prio < 2) return false;
      kill(same[0]);
    }
    if (VOICES.length >= MAXV) {
      let lo = null;
      for (const v of VOICES) if (!lo || v.p < lo.p || (v.p === lo.p && v.t0 < lo.t0)) lo = v;
      if (lo.p > prio) return false;
      kill(lo);
    }
    kk.last = t;
    return true;
  }
  function kill(v) {
    const i = VOICES.indexOf(v);
    if (i >= 0) VOICES.splice(i, 1);
    try {
      v.g.gain.cancelScheduledValues(ctx.currentTime);
      v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
      v.src.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }
  // the reverb's sends: one gain for each amount in use, shared by every sound sent that much (the same sum as a gain of its
  // own for each sound; the amounts are a handful of fixed numbers — were they ever many, the ones past SENDS_MAX get their own)
  const SENDS = new Map(),
    SENDS_MAX = 32;
  function sendOf(rev) {
    let s = SENDS.get(rev);
    if (s) return s;
    s = ctx.createGain();
    s.gain.value = rev;
    s.connect(revIn);
    if (SENDS.size < SENDS_MAX) SENDS.set(rev, s);
    return s;
  }
  // a sound's way out: panned, to its bus and the reverb. Returns what its source calls when it ends (src.onended): the sound's
  // own nodes taken out of the graph — left connected, every sound ever played kept its gain and panner alive (hundreds of
  // them after a few runs)
  function route(node, { pan = 0, rev = 0.12, bus = sfxBus } = {}) {
    let o = node,
      p = null,
      own = null;
    if (pan) {
      p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      o = p;
    }
    o.connect(bus);
    if (rev > 0) {
      const s = sendOf(rev);
      if (SENDS.get(rev) !== s) own = s;
      o.connect(s);
    }
    return () => {
      try {
        node.disconnect();
        if (p) p.disconnect();
        if (own) own.disconnect();
      } catch (e) {
        console.warn('audio release', e);
      }
    };
  }
  // a recorded clip from the sprite
  function clip(
    name,
    t,
    {
      vol = 1,
      rate = 1,
      pan = 0,
      rev = 0.12,
      dur,
      bus,
      k = name.replace(/\d+$/, ''),
      prio = 1,
      max = 4,
      gap = 0,
      swell = 0,
      sheet, // (another sheet of clips than the pack: { map, buf })
    } = {},
  ) {
    const map = sheet ? sheet.map : MAP,
      buf = sheet ? sheet.buf : sprite,
      m = map && map[name];
    if (!m || !buf || !(vol >= 0.004)) return null; // NaN plays nothing
    if (!admit(k, prio, max, gap, t)) return null;
    const d = Math.min(dur ?? m[1], m[1]),
      real = d / rate,
      src = ctx.createBufferSource(),
      g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    g.gain.setValueAtTime(swell ? 0 : vol, t);
    if (swell) g.gain.linearRampToValueAtTime(vol, t + swell);
    if (d < m[1]) {
      g.gain.setValueAtTime(vol, t + Math.max(swell, real * 0.7));
      g.gain.linearRampToValueAtTime(0, t + real);
    }
    src.connect(g);
    src.onended = route(g, { pan, rev, bus });
    src.start(t, m[0], d);
    const v = { k, p: prio, t0: t, end: t + real, src, g };
    VOICES.push(v);
    return v;
  }
  // synthesis helpers
  const env = (g, t, a, peak, dec) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  };
  function burst(
    t,
    { f = 1200, q = 0.8, type = 'bandpass', vol = 0.3, a = 0.002, dec = 0.08, f2, pan = 0, rev = 0.1, bus } = {},
  ) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + R() * 0.4;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    fl.Q.value = q;
    const g = ctx.createGain();
    env(g, t, a, vol, dec);
    src.connect(fl);
    fl.connect(g);
    src.onended = route(g, { pan, rev, bus });
    src.start(t, R() * 0.5);
    src.stop(t + a + dec + 0.05);
  }
  function tone(t, { f = 440, f2, type = 'sine', vol = 0.2, a = 0.005, dec = 0.15, pan = 0, rev = 0.1, bus } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    const g = ctx.createGain();
    env(g, t, a, vol, dec);
    o.connect(g);
    o.onended = route(g, { pan, rev, bus });
    o.start(t);
    o.stop(t + a + dec + 0.05);
  }
  const ui = (o) => Object.assign({ bus: uiBus, rev: 0.08 }, o);

  // ---------- where a sound sits: pan by screen x, fade with the distance off screen ----------
  let CAM = null;
  function at(x, y) {
    if (!CAM || x === undefined) return { pan: 0, g: 1 };
    const [cx, cy, hw, hh] = CAM,
      dx = x - cx,
      dy = y - cy,
      ox = Math.max(0, Math.abs(dx) - hw),
      oy = Math.max(0, Math.abs(dy) - hh);
    return { pan: clamp(dx / hw, -1, 1) * 0.75, g: Math.exp(-Math.hypot(ox, oy * 1.4) / 450) };
  }

  const onScreen = (x, y) => {
    if (!CAM) return true;
    const [cx, cy, hw, hh] = CAM;
    return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh;
  }; // (where at() doesn't fade it)

  // ---------- gems: an A-minor pentatonic ladder that climbs while you keep collecting ----------
  const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88];
  let gemN = 0,
    gemT = -9;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // explosions: the next one inside 0.14 s is a link in a chain — later, quieter, no sub of its own
  let boomT = -9,
    boomK = 0;

  const GUN = 0.2; // the hero's main gun (shots, casings, pump, torch): a fifth of the clips' level
  const OWN = {
    hurt: 1,
    pdie: 1,
    lvl: 1,
    gem: 1,
    coin: 1,
    heal: 1,
    magnet: 1,
    block: 1,
    lifesteal: 1,
    evo: 1,
    reload: 1,
    reloaded: 1,
  };
  const like = (w) => (window.DATA && DATA.MAIN[w] && DATA.MAIN[w].like) || w; // (a gun that sounds as another: the Copper Phantom as the SMG)
  const SND = {
    shot: (e, t, P) => {
      // the Copper Phantom: its own shot, a suppressed rifle's (the clip is quiet as it came, hence the gain); until its file
      // is in, the SMG's
      if (e.w === 'phantom' && PHANTOM) {
        clip('shot', t, {
          sheet: PHANTOM,
          k: 'phantom',
          vol: 2.6 * GUN * vary(0.06),
          rate: vary(0.04),
          dur: 0.3,
          gap: 0.04,
          max: 4,
          prio: 3,
          rev: 0.06,
        });
        return;
      }
      const w = like(e.w);
      if (w === 'drone')
        return clip('pistol', t, { vol: 0.13 * P.g, rate: 1.7 * vary(0.05), pan: P.pan, gap: 0.06, max: 3, rev: 0.05 });
      if (w === 'turret')
        return clip('smg', t, {
          vol: 0.16 * P.g,
          rate: 1.35 * vary(0.05),
          dur: 0.2,
          pan: P.pan,
          gap: 0.07,
          max: 3,
          rev: 0.06,
        });
      if (w === 'pistol') {
        clip('pistol', t, { vol: 0.62 * GUN, rate: vary(0.05), gap: 0.03, max: 3, prio: 3, rev: 0.16 });
        if (R() < 0.5)
          clip(pick(['casing0', 'casing1', 'casing2']), t + 0.28 + R() * 0.12, {
            vol: 0.09 * GUN,
            rate: vary(0.1),
            pan: 0.2,
            max: 3,
            rev: 0.03,
          });
        return;
      }
      if (w === 'smg') {
        clip('smg', t, { vol: 0.42 * GUN, rate: 1.12 * vary(0.04), dur: 0.3, gap: 0.045, max: 4, prio: 3, rev: 0.12 });
        if (R() < 0.3)
          clip(pick(['casing0', 'casing1', 'casing2']), t + 0.3, {
            vol: 0.07 * GUN,
            rate: vary(0.1),
            pan: 0.2,
            max: 3,
            rev: 0.03,
          });
        return;
      }
      if (w === 'minigun') {
        clip('smg', t, { vol: 0.34 * GUN, rate: 1.4 * vary(0.05), dur: 0.2, gap: 0.035, max: 5, prio: 3, rev: 0.08 });
        if (R() < 0.25)
          clip(pick(['casing0', 'casing1', 'casing2']), t + 0.2, {
            vol: 0.06 * GUN,
            rate: 1.2 * vary(0.1),
            pan: (R() - 0.5) * 0.6,
            max: 4,
            rev: 0.02,
          });
        return;
      }
      if (w === 'shotgun') {
        clip(pick(['shotgun0', 'shotgun1', 'shotgun2', 'shotgun3']), t, {
          vol: 0.8 * GUN,
          rate: vary(0.04),
          gap: 0.05,
          max: 2,
          prio: 4,
          rev: 0.2,
        });
        clip('pump', t + 0.3, { vol: 0.32 * GUN, rate: vary(0.03), max: 1, prio: 2, rev: 0.05 });
        return;
      }
      if (w === 'sniper') {
        clip('shotgun1', t, { vol: 0.75 * GUN, rate: 0.82, max: 2, prio: 4, rev: 0.3 });
        clip('pistol', t, { vol: 0.5 * GUN, rate: 0.7, max: 3, prio: 3, rev: 0.2 });
        clip('bolt', t + 0.38, { vol: 0.35 * GUN, max: 1 });
        return;
      }
      if (w === 'rocket') {
        clip(pick(['whoosh0', 'whoosh1', 'whoosh2']), t, {
          vol: 0.55 * GUN,
          rate: 0.62 * vary(0.05),
          max: 2,
          prio: 3,
          rev: 0.15,
        });
        clip('shotgun2', t, { vol: 0.42 * GUN, rate: 0.55, max: 2, prio: 3, rev: 0.12 });
        return;
      }
    },
    boom: (e, t, P) => {
      const b = clamp(e.r / 150, 0.5, 1.5),
        chain = t - boomT < 0.14;
      boomK = chain ? boomK + 1 : 0;
      boomT = t;
      if (e.kind === 'acid' || e.kind === 'spore') {
        clip('tear', t, { vol: 0.5 * P.g, rate: 0.8 * vary(0.08), pan: P.pan, prio: 3, rev: 0.15 });
        clip(pick(['squish0', 'squish2', 'squish4']), t, { vol: 0.5 * P.g, rate: 0.7, pan: P.pan, prio: 3 });
        return;
      }
      const tt = t + (chain ? 0.05 + 0.03 * Math.min(4, boomK) : 0),
        v = (chain ? 0.75 / (1 + 0.3 * boomK) : 1) * P.g;
      if (b >= 0.9)
        clip('boom0', tt, {
          vol: 0.95 * v,
          rate: vary(0.06) * (chain ? 1.1 : 1),
          pan: P.pan,
          prio: 5,
          max: 3,
          rev: 0.3,
        });
      else
        clip(pick(['boom1', 'boom2', 'boom3']), tt, {
          vol: 0.85 * v,
          rate: vary(0.08),
          pan: P.pan,
          prio: 5,
          max: 4,
          rev: 0.3,
        });
      if (!chain) {
        clip('rumble', tt + 0.02, {
          vol: 0.5 * b * P.g,
          rate: 0.9 * vary(0.05),
          pan: P.pan * 0.5,
          prio: 2,
          max: 2,
          rev: 0.2,
        });
        tone(tt, { f: 90, f2: 32, vol: 0.45 * b * P.g, dec: 0.5, rev: 0 });
      }
    },
    hit: (e, t, P) =>
      clip(R() < 0.55 ? pick(['punch0', 'punch1', 'punch2', 'punch3']) : pick(['squish1', 'squish3']), t, {
        vol: (e.b === 2 ? 0.3 : 0.17) * P.g,
        rate: vary(0.12) * (e.b === 2 ? 0.75 : 1.1),
        pan: P.pan,
        dur: 0.15,
        gap: 0.03,
        max: 4,
        prio: 1,
        rev: 0.04,
      }),
    die: (e, t, P) => {
      if (!e.fly)
        clip(pick(['squish0', 'squish2', 'squish3', 'squish4']), t, {
          vol: 0.32 * P.g,
          rate: (e.ek === 'tank' || e.ek === 'butcher' ? 0.6 : 0.9) * vary(0.1),
          pan: P.pan,
          dur: 0.4,
          gap: 0.05,
          max: 3,
          prio: 2,
          rev: 0.06,
        });
      if (R() < 0.16)
        clip(pick(['growl0', 'growl1', 'growl2', 'growl3', 'growl4']), t + 0.05, {
          vol: 0.2 * P.g,
          rate: 1.15 * vary(0.12),
          pan: P.pan,
          dur: 0.6,
          k: 'moan',
          gap: 0.3,
          max: 2,
          prio: 1,
          rev: 0.15,
        });
    },
    thud: (e, t, P) => {
      clip(pick(['punch0', 'punch2']), t, {
        vol: 0.4 * P.g,
        rate: 0.55 * vary(0.08),
        pan: P.pan,
        gap: 0.04,
        max: 3,
        prio: 2,
        rev: 0.05,
      });
      burst(t, { f: 260, q: 0.7, type: 'lowpass', vol: 0.18 * P.g, dec: 0.12, pan: P.pan });
    },
    zap: (e, t, P) => {
      clip(pick(['snap0', 'snap1', 'snap2']), t, { vol: 0.6, rate: vary(0.1), gap: 0.05, max: 3, prio: 3, rev: 0.12 });
      clip(pick(['crackle0', 'crackle1', 'crackle2']), t + 0.01, {
        vol: 0.42,
        rate: vary(0.12),
        dur: 0.22 + 0.03 * e.pts.length,
        gap: 0.08,
        max: 3,
        prio: 3,
        rev: 0.18,
      });
      for (let i = 2; i < Math.min(6, e.pts.length); i++) {
        const q = at(e.pts[i][0], e.pts[i][1]);
        clip(pick(['snap0', 'snap1', 'snap2']), t + i * 0.025, {
          vol: 0.22 * q.g,
          rate: 1.2 * vary(0.15),
          pan: q.pan,
          k: 'snapj',
          max: 4,
          rev: 0.1,
        });
      }
    },
    ric: (e, t, P) => {
      if (R() < 0.6)
        tone(t, { f: 2600 + R() * 1200, f2: 1700, type: 'sine', vol: 0.05 * P.g, dec: 0.16, pan: P.pan, rev: 0.2 });
    },
    // a shot stopped by a car (a bright clank: two inharmonic partials over a hiss, now and then a whine off it) or a wall (a dull
    // knock and a crumble of grit); the minigun's stream is thinned to a few a second
    hitm: (e, t, P) => {
      if (!admit('hitm', 0, 3, 0.045, t, true)) return;
      if (e.m === 'metal') {
        const f = 1500 + R() * 900;
        tone(t, { f, f2: f * 0.94, type: 'triangle', vol: 0.07 * P.g, dec: 0.09, pan: P.pan, rev: 0.12 });
        tone(t, { f: f * 2.76, type: 'sine', vol: 0.03 * P.g, dec: 0.06, pan: P.pan, rev: 0.1 });
        burst(t, { f: 4200, q: 0.9, type: 'highpass', vol: 0.12 * P.g, a: 0.001, dec: 0.035, pan: P.pan, rev: 0.05 });
        if (R() < 0.25)
          tone(t + 0.02, {
            f: 3200 + R() * 900,
            f2: 1600,
            type: 'sine',
            vol: 0.035 * P.g,
            dec: 0.22,
            pan: P.pan,
            rev: 0.25,
          });
      } else {
        burst(t, { f: 420, q: 0.8, type: 'lowpass', vol: 0.22 * P.g, a: 0.001, dec: 0.07, pan: P.pan, rev: 0.06 });
        burst(t + 0.008, { f: 2300, q: 1.1, vol: 0.09 * P.g, dec: 0.09, pan: P.pan, rev: 0.08 });
        if (R() < 0.4)
          clip(pick(['snap0', 'snap1', 'snap2']), t + 0.01, {
            vol: 0.12 * P.g,
            rate: 0.55 * vary(0.1),
            dur: 0.12,
            pan: P.pan,
            k: 'grit',
            gap: 0.06,
            max: 2,
            rev: 0.05,
          });
      }
    },
    // the hero's step: a soft paw (the human, 2026-11-12: the old synthesised tick knocked and rang), one of six recorded steps on
    // carpet and grass, never the same twice running, its pitch and level a little off each time; ~2 dB under the old tick
    // By what is under the paw (e.sf, scene.js surfaceAt): soft ground (grass, earth) the old six; asphalt, slabs and
    // concrete; tiles (the same clips a little higher); metal plate and grating; glass. Each set its own level, so a
    // hard floor is heard but stays a paw's step.
    step: (e, t) => {
      if (!STEPS) return;
      const s = (stepN++ % 2 ? 1 : -1) * 0.08,
        [key, cnt, vol, rate, rev] = STEP_SF[e.sf] || STEP_SF.soft;
      let n = (R() * (cnt - 1)) | 0;
      if (n >= lastStep) n++;
      lastStep = n;
      clip(key + n, t, {
        sheet: STEPS,
        k: 'step',
        vol: vol * vary(0.12),
        rate: rate * vary(0.08),
        pan: s,
        rev,
        max: 2,
      });
    },
    gem: (e, t) => {
      if (t - gemT > 0.5) gemN = 0;
      gemT = t;
      const m = PENTA[Math.min(PENTA.length - 1, gemN++)];
      if (!admit('gem', 1, 6, 0.03, t, true)) return;
      tone(t, ui({ f: hz(m), type: 'sine', vol: 0.09, dec: 0.18 }));
      tone(t, ui({ f: hz(m + 12), type: 'triangle', vol: 0.03, dec: 0.08 }));
    },
    coin: (e, t) => {
      if (!admit('coin', 1, 3, 0.05, t, true)) return;
      tone(t, ui({ f: 1320, type: 'square', vol: 0.04, dec: 0.06 }));
      tone(t + 0.06, ui({ f: 1760, type: 'square', vol: 0.04, dec: 0.12 }));
    },
    lvl: (e, t) => {
      [523, 659, 784, 1046].forEach((f, i) =>
        tone(t + i * 0.07, ui({ f, type: 'triangle', vol: 0.15, dec: 0.3, rev: 0.25 })),
      );
    },
    evo: (e, t) => {
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) =>
        tone(t + i * 0.06, ui({ f, type: 'square', vol: 0.07, dec: 0.35, rev: 0.3 })),
      );
    },
    hurt: (e, t) => {
      clip(pick(['punch1', 'punch3']), t, { vol: 0.55, rate: 0.8, gap: 0.2, max: 1, prio: 4, rev: 0.05 });
      tone(t, { f: 210, f2: 120, type: 'sawtooth', vol: 0.06, dec: 0.15 });
    },
    pdown: (e, t) => SND.pdie(e, t),
    revive: (e, t) => {
      for (const [f, d] of [
        [392, 0],
        [523.3, 0.07],
        [659.3, 0.14],
      ])
        tone(t + d, ui({ f, type: 'triangle', vol: 0.05, a: 0.01, dec: 0.5, rev: 0.3 }));
    },
    pdie: (e, t) => {
      for (const [f, d] of [
        [146.8, 0],
        [174.6, 0.02],
        [220, 0.04],
        [293.7, 0.06],
      ])
        tone(t + d, ui({ f, f2: f * 0.7, type: 'sawtooth', vol: 0.05, a: 0.05, dec: 2.2, rev: 0.5 }));
      clip('rumble', t, { vol: 0.5, rate: 0.7, prio: 5 });
      A.cat('mew', 0.22, 0.15);
    },
    open: (e, t) => {
      [659, 784, 988, 1318].forEach((f, i) =>
        tone(t + i * 0.08, ui({ f, type: 'triangle', vol: 0.13, dec: 0.3, rev: 0.3 })),
      );
    },
    slam: (e, t, P) => {
      clip('boom1', t, { vol: 0.9 * P.g, rate: 0.55, pan: P.pan, prio: 5, rev: 0.3 });
      clip('rumble', t, { vol: 0.6 * P.g, rate: 0.8, pan: P.pan, prio: 3 });
      if (e.bio) clip('squish4', t + 0.03, { vol: 0.6 * P.g, rate: 0.55, dur: 0.6, pan: P.pan, prio: 4 }); // (the Devourer's wave)
    },
    rockhit: (e, t, P) => {
      if (!e.flesh) return clip('boom2', t, { vol: 0.75 * P.g, rate: 0.7, pan: P.pan, prio: 4, rev: 0.25 });
      // a lump of the Devourer's flesh landing: a soft thud and a wet slap (five at once: each a little different)
      clip('boom2', t, { vol: 0.4 * P.g, rate: 0.55, pan: P.pan, prio: 3, gap: 0.04, max: 3 });
      clip(pick(['squish0', 'squish1', 'squish3', 'squish4']), t, {
        vol: 0.55 * P.g,
        rate: 0.75 * vary(0.12),
        dur: 0.5,
        pan: P.pan,
        prio: 4,
        gap: 0.04,
        max: 3,
      });
    },
    spores: (e, t, P) => {
      burst(t, { f: 700, q: 0.7, vol: 0.32 * P.g, dec: 0.9, pan: P.pan });
      clip('squish0', t, { vol: 0.45 * P.g, rate: 0.5, dur: 0.7, pan: P.pan, prio: 3 });
    }, // a puff of spores
    gore: (e, t, P) => {
      clip(pick(['squish0', 'squish4']), t, { vol: 0.6 * P.g, rate: 0.6, dur: 0.6, pan: P.pan, prio: 4 });
      clip('growl1', t + 0.05, { vol: 0.4 * P.g, rate: 0.55, dur: 1.2, pan: P.pan, prio: 3, rev: 0.3 });
    },
    scream: (e, t, P) => {
      clip('growl4', t, { vol: 0.75 * P.g, rate: 1.55, pan: P.pan, prio: 5, rev: 0.4 });
      clip('roar', t, { vol: 0.4 * P.g, rate: 1.3, dur: 1.5, pan: P.pan, prio: 4, rev: 0.4 });
    },
    // the Lab Tech's spray (a long hiss), the Chimera's spikes (a wet tear and their whoosh) and one striking (a dull thock)
    spray: (e, t, P) => {
      burst(t, { f: 2600, q: 0.6, type: 'highpass', vol: 0.3 * P.g, a: 0.05, dec: 0.9, pan: P.pan, rev: 0.2 });
      clip('squish0', t, { vol: 0.35 * P.g, rate: 0.6, dur: 0.6, pan: P.pan, prio: 3 });
    },
    spikes: (e, t, P) => {
      clip('tear', t, { vol: 0.45 * P.g, rate: 0.9, pan: P.pan, prio: 3 });
      clip('whoosh1', t + 0.04, { vol: 0.4 * P.g, rate: 1.3, pan: P.pan, prio: 3 });
    },
    // the Devourer's core looses its lumps of flesh: a deep thump, the wet tear, his groan
    corefire: (e, t, P) => {
      clip('boom3', t, { vol: 0.55 * P.g, rate: 0.45, pan: P.pan, prio: 5 });
      clip(pick(['squish0', 'squish4']), t + 0.04, { vol: 0.6 * P.g, rate: 0.6, dur: 0.6, pan: P.pan, prio: 4 });
      clip('growl1', t + 0.08, { vol: 0.4 * P.g, rate: 0.5, dur: 1.0, pan: P.pan, prio: 3, rev: 0.3 });
    },
    spikehit: (e, t, P) => clip('punch2', t, { vol: 0.25 * P.g, rate: 1.4, pan: P.pan, prio: 1, gap: 0.05, max: 3 }),
    // the Savage's charge (a whoosh and a growl)
    dash: (e, t, P) => {
      clip('whoosh2', t, { vol: 0.5 * P.g, rate: 0.5, pan: P.pan, prio: 3 });
      clip('growl1', t, { vol: 0.5 * P.g, rate: 0.7, dur: 0.8, pan: P.pan, prio: 4, rev: 0.3 });
    },
    // the Butcher throws his cleaver (a grunt and a heavy whoosh), and it lands (a bright clank of steel with a short ring)
    cleave: (e, t, P) => {
      clip('whoosh2', t, { vol: 0.55 * P.g, rate: 0.75, pan: P.pan, prio: 3 });
      clip('growl1', t, { vol: 0.5 * P.g, rate: 0.7, dur: 0.6, pan: P.pan, prio: 4, rev: 0.3 });
    },
    clank: (e, t, P) => {
      const f = 1300 + R() * 300;
      tone(t, { f, f2: f * 0.96, type: 'triangle', vol: 0.12 * P.g, dec: 0.35, pan: P.pan, rev: 0.25 });
      tone(t, { f: f * 2.76, type: 'sine', vol: 0.05 * P.g, dec: 0.25, pan: P.pan, rev: 0.2 });
      burst(t, { f: 3800, q: 0.9, type: 'highpass', vol: 0.18 * P.g, a: 0.001, dec: 0.05, pan: P.pan, rev: 0.05 });
    },
    summon: (e, t, P) => clip('roar', t, { vol: 0.45 * P.g, rate: 0.9, dur: 1.6, pan: P.pan, prio: 3, rev: 0.4 }),
    shed: (e, t, P) => {
      clip('boom3', t, { vol: 0.6 * P.g, rate: 0.8, pan: P.pan, prio: 4 });
      clip('bolt', t + 0.05, { vol: 0.5 * P.g, rate: 0.6, pan: P.pan });
    },
    pop: (e, t, P) => {
      clip('tear', t, { vol: 0.7 * P.g, rate: 0.7, pan: P.pan, prio: 4, rev: 0.25 });
      clip('boom2', t, { vol: 0.5 * P.g, rate: 0.8, pan: P.pan, prio: 4 });
    },
    spit: (e, t, P) =>
      clip(pick(['squish1', 'squish3']), t, {
        vol: (e.big ? 0.6 : 0.22) * P.g,
        rate: e.big ? 0.8 : 1.5,
        dur: e.big ? 0.45 : 0.2,
        pan: P.pan,
        gap: 0.1,
        max: 2,
      }), // big: the pustule's volley
    splat: (e, t, P) =>
      clip(pick(['squish0', 'squish4']), t, {
        vol: (e.big ? 0.55 : 0.3) * P.g,
        rate: e.big ? 0.75 : 1.2,
        dur: e.big ? 0.5 : 0.3,
        pan: P.pan,
        gap: 0.08,
        max: 3,
      }),
    howl: (e, t, P) =>
      clip('growl4', t, {
        vol: 0.25 * P.g,
        rate: 1.7 + 0.1 * Math.random(),
        dur: 0.3,
        pan: P.pan,
        gap: 0.25,
        max: 1,
        prio: 3,
      }),
    sawhit: (e, t, P) => {
      if (!admit('saw', 1, 3, 0.06, t, true)) return;
      tone(t, { f: 1900 + R() * 300, f2: 1300, type: 'sawtooth', vol: 0.025 * P.g, dec: 0.06, pan: P.pan, rev: 0.05 });
    },
    crate: (e, t, P) => {
      clip('boom3', t, { vol: 0.35 * P.g, rate: 1.7, pan: P.pan, max: 3 });
      burst(t, { f: 900, q: 1.5, vol: 0.2 * P.g, dec: 0.12, pan: P.pan });
    },
    prophit: (e, t, P) => {
      if (!admit('prophit', 0, 2, 0.07, t, true)) return;
      tone(t, { f: 700 + R() * 300, f2: 500, type: 'triangle', vol: 0.05 * P.g, dec: 0.08, pan: P.pan });
    },
    balpop: (e, t, P) => {
      burst(t, { f: 2400, q: 0.5, type: 'highpass', vol: 0.4 * P.g, a: 0.001, dec: 0.05, pan: P.pan, rev: 0.25 });
      tone(t, { f: 380, f2: 120, vol: 0.12 * P.g, dec: 0.06, pan: P.pan });
    },
    arena: (e, t) => {
      clip('boom1', t + 0.4, { vol: 0.8, rate: 0.5, prio: 5, rev: 0.4 });
      clip('rumble', t + 0.4, { vol: 0.7, rate: 0.7, prio: 4 });
    },
    bossdie: (e, t, P) => {
      clip('boom0', t, { vol: 1, rate: 0.75, pan: P.pan, prio: 6, rev: 0.4 });
      clip('rumble', t, { vol: 0.8, rate: 0.6, prio: 5 });
      clip('growl3', t, { vol: 0.7, rate: e.ek === 'golem' ? 0.45 : 0.55, pan: P.pan, prio: 5, rev: 0.5 });
    },
    land: (e, t, P) => clip('punch2', t, { vol: 0.45 * P.g, rate: 0.5, pan: P.pan, prio: 2 }),
    bomb: (e, t) => {
      clip('boom0', t, { vol: 1, rate: 0.85, prio: 6, rev: 0.4 });
      clip('rumble', t, { vol: 0.9, prio: 5 });
    },
    magnet: (e, t) => tone(t, ui({ f: 300, f2: 1200, type: 'sine', vol: 0.12, a: 0.02, dec: 0.4 })),
    // the extra weapons of the second wave: a bottle bursting into flame, a vortex sucking in, the field's crackle, a turret set down,
    // missiles off the back, the helmet ringing, a heal from the fang
    mol: (e, t, P) => {
      burst(t, { f: 5200, q: 0.8, type: 'highpass', vol: 0.3 * P.g, a: 0.001, dec: 0.09, pan: P.pan, rev: 0.15 });
      clip('ignite', t + 0.02, {
        vol: 0.35 * P.g,
        rate: vary(0.08),
        pan: P.pan,
        max: 2,
        gap: 0.08,
        prio: 2,
        rev: 0.15,
      });
    },
    toss: (e, t, P) =>
      clip(pick(['whoosh0', 'whoosh1']), t, {
        vol: 0.12 * P.g,
        rate: 1.5 * vary(0.08),
        pan: P.pan,
        gap: 0.12,
        max: 2,
        rev: 0.05,
      }),
    well: (e, t, P) => {
      tone(t, { f: 420, f2: 55, type: 'sine', vol: 0.18 * P.g, a: 0.02, dec: 0.7, pan: P.pan, rev: 0.4 });
      burst(t, { f: 300, q: 0.6, type: 'lowpass', vol: 0.2 * P.g, dec: 0.6, pan: P.pan });
    },
    tesla: (e, t, P) => {
      if (!e.pts.length || !admit('tesla', 1, 2, 0.25, t, true)) return;
      clip(pick(['crackle0', 'crackle1', 'crackle2']), t, {
        vol: 0.16 * P.g,
        rate: 1.3 * vary(0.1),
        dur: 0.18,
        pan: P.pan,
        rev: 0.12,
      });
    },
    shotdown: (e, t, P) =>
      clip(pick(['snap0', 'snap1', 'snap2']), t, {
        vol: 0.3 * P.g,
        rate: 1.2 * vary(0.1),
        pan: P.pan,
        gap: 0.05,
        max: 3,
        rev: 0.1,
      }),
    turret: (e, t, P) => {
      clip('punch2', t, { vol: 0.4 * P.g, rate: 0.7, pan: P.pan, prio: 2 });
      tone(t + 0.05, { f: 900, f2: 700, type: 'triangle', vol: 0.05 * P.g, dec: 0.12, pan: P.pan });
    },
    mlaunch: (e, t, P) => {
      for (let i = 0; i < Math.min(4, e.n || 1); i++)
        clip(pick(['whoosh0', 'whoosh1', 'whoosh2']), t + i * 0.06, {
          vol: 0.2 * P.g,
          rate: 1.25 * vary(0.08),
          pan: P.pan,
          max: 4,
          rev: 0.1,
        });
    },
    block: (e, t) => {
      const f = 1700 + R() * 300;
      tone(t, { f, f2: f * 0.97, type: 'triangle', vol: 0.14, dec: 0.18, rev: 0.25 });
      tone(t, { f: f * 2.4, type: 'sine', vol: 0.06, dec: 0.12, rev: 0.2 });
      burst(t, { f: 4200, q: 0.9, type: 'highpass', vol: 0.12, a: 0.001, dec: 0.04 });
    },
    lifesteal: (e, t) => {
      if (!admit('lifesteal', 1, 1, 0.3, t, true)) return;
      tone(t, ui({ f: 784, f2: 988, type: 'sine', vol: 0.05, a: 0.01, dec: 0.18, rev: 0.25 }));
    },
    // the main gun's reload (e.d: how long it takes): the magazine out, the new one in at about half way (the shotgun: shells pushed in
    // one by one; the flamethrower: the tank's valve and a hiss); 'reloaded' racks it when it is done
    reload: (e, t) => {
      const d = e.d || 1.4,
        w = like(e.w),
        heavy = w === 'minigun' || w === 'rocket';
      if (w === 'shotgun') {
        for (let i = 0; i < 4; i++)
          clip('click', t + 0.16 + (i * (d - 0.5)) / 4, { vol: 0.75 * GUN, rate: 0.7 * vary(0.06), max: 2, rev: 0.05 });
        return;
      }
      if (w === 'flame') {
        clip('click', t + 0.04, { vol: 0.75 * GUN, rate: 0.55, max: 2, rev: 0.05 });
        burst(t + 0.35, { f: 1400, q: 0.8, type: 'bandpass', vol: 0.03, a: 0.15, dec: d * 0.5 });
        return;
      }
      clip('click', t + 0.04, { vol: 0.7 * GUN, rate: (heavy ? 0.55 : 0.8) * vary(0.05), max: 2, rev: 0.05 });
      clip('click', t + d * 0.55, { vol: 0.85 * GUN, rate: (heavy ? 0.6 : 0.95) * vary(0.05), max: 2, rev: 0.05 });
    },
    reloaded: (e, t) => {
      const w = e.w;
      if (w === 'shotgun') return clip('pump', t, { vol: 0.45 * GUN, rate: vary(0.03), max: 1, rev: 0.05 });
      clip('bolt', t, {
        vol: 0.6 * GUN,
        rate: w === 'minigun' ? 0.7 : w === 'sniper' ? 0.9 : w === 'flame' || w === 'rocket' ? 0.6 : 1.1,
        max: 1,
        rev: 0.05,
      });
    },
    // a bomber's fuse: a hiss, and beeps faster and faster till it bursts (beep n at 3a + 2.75a² = n, as its blinks in scene.js)
    fuse: (e, t, P) => {
      burst(t, { f: 3800, q: 0.7, type: 'highpass', vol: 0.12 * P.g, a: 0.05, dec: 1.9, pan: P.pan });
      for (let n = 0; ; n++) {
        const a = (-3 + Math.sqrt(9 + 11 * n)) / 5.5;
        if (a > 1.97) break;
        tone(t + a, { f: 1250 + 45 * n, type: 'square', vol: 0.045 * P.g, a: 0.002, dec: 0.07, pan: P.pan });
      }
    },
    heal: (e, t) => {
      tone(t, ui({ f: 523, f2: 784, type: 'sine', vol: 0.1, a: 0.02, dec: 0.35, rev: 0.3 }));
      tone(t + 0.08, ui({ f: 659, f2: 988, type: 'sine', vol: 0.08, a: 0.02, dec: 0.35, rev: 0.3 }));
    },
  };
  let stepN = 0,
    lastStep = -1;

  // ---------- loops that follow the hero's weapon: the flamethrower's torch, the minigun's motor ----------
  let torch = null,
    motor = null,
    groanT = 0;
  function loops(S) {
    const w = S && !S.pause && !S.over && !S.p.dead ? S.p.main : null,
      t = ctx.currentTime;
    const fl = !!(w && w.id === 'flame' && w.firing && sprite);
    if (fl && !torch) {
      const m = MAP.torch,
        src = ctx.createBufferSource(),
        g = ctx.createGain();
      src.buffer = sprite;
      src.loop = true;
      src.loopStart = m[0] + 0.05;
      src.loopEnd = m[0] + m[1] - 0.05;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.42 * GUN, t + 0.08);
      src.connect(g);
      src.onended = route(g, { rev: 0.12 });
      src.start(t, m[0] + 0.05);
      torch = { src, g };
      clip('ignite', t, { vol: 0.5 * GUN, rate: vary(0.05), max: 1, prio: 3, gap: 0.3 });
    } else if (!fl && torch) {
      torch.g.gain.cancelScheduledValues(t);
      torch.g.gain.setTargetAtTime(0, t, 0.06);
      torch.src.stop(t + 0.4);
      torch = null;
    }
    const sp = w && w.id === 'minigun' ? w.spin : 0;
    if (sp > 0.03 && !motor) {
      const o = ctx.createOscillator(),
        f = ctx.createBiquadFilter(),
        g = ctx.createGain();
      o.type = 'sawtooth';
      f.type = 'bandpass';
      f.Q.value = 3;
      g.gain.value = 0;
      o.connect(f);
      f.connect(g);
      o.onended = route(g, { rev: 0.05 });
      o.start();
      motor = { o, f, g };
    }
    if (motor) {
      motor.o.frequency.setTargetAtTime(48 + 120 * sp, t, 0.05);
      motor.f.frequency.setTargetAtTime(300 + 900 * sp, t, 0.05);
      motor.g.gain.setTargetAtTime(0.06 * sp * GUN, t, 0.05);
      if (sp <= 0.03) {
        motor.g.gain.setTargetAtTime(0, t, 0.05);
        motor.o.stop(t + 0.3);
        motor = null;
      }
    }
    // the horde mutters: now and then a zombie on screen groans
    if (S && !S.pause && !S.over && t > groanT) {
      groanT = t + 0.9 + R() * 2.2;
      let n = 0,
        e = null; // (one of those on screen, picked as they're counted)
      for (const z of S.en) if (onScreen(z.x, z.y) && R() * ++n < 1) e = z;
      if (e) {
        const q = at(e.x, e.y);
        clip(pick(['growl0', 'growl1', 'growl2', 'growl3', 'growl4']), t, {
          vol: 0.08 + Math.min(0.1, n / 600),
          rate: (e.k === 'runner' ? 1.25 : e.k === 'tank' || e.k === 'butcher' ? 0.7 : 0.95) * vary(0.1),
          pan: q.pan,
          dur: 1.1,
          k: 'groan',
          max: 2,
          prio: 0,
          rev: 0.25,
        });
      }
    }
  }

  // ---------- music: the menus' track and the run's, each an <audio> element streamed into the music bus through its own fader ----------
  const TRACKS = { lobby: 'audio/music_lobby.mp3', game: 'audio/music_game.mp3' },
    mus = {};
  function musInit() {
    for (const k in TRACKS) {
      const el = new Audio(TRACKS[k] + '?v=' + (window.__V || 0)),
        g = ctx.createGain();
      el.loop = true;
      el.preload = k === 'game' ? 'none' : 'auto'; // (the run's track: fetched once the world is in, see music)
      g.gain.value = 0;
      g.connect(musBus);
      try {
        ctx.createMediaElementSource(el).connect(g);
      } catch (e) {
        continue;
      }
      mus[k] = { el, g, on: false, offT: 0, tryT: 0 };
    }
  }
  // each frame (and on a gesture: kick): the track for where the player is fades in, the other out and stops once silent
  function music(kick) {
    if (!ctx || !mus.lobby) return;
    const run = window.GAME && GAME.play,
      want = !A.mus ? '' : run ? (run.hub ? '' : 'game') : 'lobby', // (the base, the shelter: no music, its own sounds only)
      now = ctx.currentTime,
      wall = performance.now();
    // the run's track (1.7 MB) is not fetched while the lobby's art and the world are still loading, where it took its share
    // of a slow connection: once the world is in (index.html marks it), or at once when a run wants it
    if (!gameAsked && mus.game && (want === 'game' || (window.__boot && window.__boot.scene))) {
      gameAsked = true;
      mus.game.el.preload = 'auto';
      if (want !== 'game') mus.game.el.load();
    }
    for (const k in mus) {
      const m = mus[k],
        on = k === want;
      if (on !== m.on) {
        m.on = on;
        m.g.gain.cancelScheduledValues(now);
        m.g.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.6 : 0.25);
        m.offT = on ? 0 : now + 1.5;
        if (on && k === 'game') {
          try {
            m.el.currentTime = 0;
          } catch (e) {}
        }
      } // a run: its track from the top
      if (!on && m.offT && now > m.offT) {
        m.el.pause();
        m.offT = 0;
      }
      if (on && m.el.paused && A.on && !document.hidden && (kick || wall > m.tryT)) {
        m.tryT = wall + 1000;
        const p = m.el.play();
        if (p) p.catch(() => {});
      }
    }
    const dim = !!(run && (GAME.menu || run.pause || run.over)); // the pause menu, cards, results
    if (dim !== musDim) {
      musDim = dim;
      musLP.frequency.setTargetAtTime(dim ? 1400 : 18000, now, 0.25);
    }
  }
  let musDim = false,
    gameAsked = false;

  // called by the page loop with the run state (null in menus): plays every event not heard yet, once
  const fresh = (S) => {
    let i = S.ev.length;
    while (i > 0 && !heard.has(S.ev[i - 1])) i--;
    return i;
  }; // events are appended, the old ones trimmed
  const hearAll = (S) => {
    for (let i = fresh(S); i < S.ev.length; i++) heard.add(S.ev[i]);
    if (S.warn) heard.add(S.warn);
  };
  // a hero's paw came down (scene.js, from the drawn gait: the step is heard when the foot lands, at the pace it runs
  // at), on the surface sf under it. A.gait(): the scene says each frame that it gives the steps, so the sim's own
  // step events (one per stretch of ground covered) stay silent
  let gaitAt = -1e9,
    running = false;
  A.gait = () => (gaitAt = performance.now());
  A.step = (x, y, sf) => {
    if (!ctx || !A.on || !running || ctx.state !== 'running') return;
    const p = at(x, y);
    if (p.g < 0.05) return;
    SND.step({ sf }, ctx.currentTime + 0.01, p);
  };
  A.update = (S) => {
    if (!ctx) return;
    music();
    if (S && S !== lastRun) {
      lastRun = S;
      hearAll(S);
    }
    if (!A.on || ctx.state !== 'running') {
      loops(null);
      if (S) hearAll(S);
      return;
    }
    if (S) {
      const z = S.zoom || 1,
        hw = (S.vw || SIM.VIEW.W) / z / 2,
        hh = SIM.VIEW.H / z / 2;
      CAM = [S.cam[0] + hw, S.cam[1] + hh, hw, hh];
    }
    loops(S);
    running = !!S;
    if (!S) return;
    const t0 = ctx.currentTime + 0.01;
    // (playing together: a partner's own moments — its hurt, its level, its pickups — are not this player's to hear)
    for (let i = fresh(S); i < S.ev.length; i++) {
      const e = S.ev[i],
        f = SND[e.k];
      heard.add(e);
      if (e.k === 'step' && performance.now() - gaitAt < 600) continue; // (the drawn gait gives the steps: A.step)
      if (e.pi !== undefined && S.p && e.pi !== S.p.i && OWN[e.k]) continue;
      if (f) f(e, t0, at(e.x, e.y));
    }
    if (S.warn && !heard.has(S.warn)) {
      heard.add(S.warn);
      if (S.warn.boss) {
        // the horde: a far roar swells, then a drum hit
        clip('roar', t0, { vol: 0.7, rate: 0.85, dur: 1.6, swell: 1.3, prio: 5, rev: 0.5 });
        clip('boom1', t0 + 1.35, { vol: 0.8, rate: 0.45, prio: 5, rev: 0.4 });
      }
    }
  };
  A.ctx = () => ctx;
  // a voice line's <audio> (voice.js, intro.js) into the voice bus, so the mute and the limiter take it with the rest; false
  // when there is no sound yet (it then plays straight out)
  A.voice = (el) => {
    if (!ctx) return false;
    try {
      ctx.createMediaElementSource(el).connect(voxBus);
      return true;
    } catch (e) {
      return false;
    }
  };
  // a line is being said (on) or is over: the music and the battle step back under it and come up again after
  let ducked = false;
  A.duck = (on) => {
    if (!ctx || on === ducked) return;
    ducked = on;
    const t = ctx.currentTime;
    musBus.gain.setTargetAtTime(MUS * A.musVol * (on ? DUCK_MUS : 1), t, on ? 0.08 : 0.5);
    sfxBus.gain.setTargetAtTime(SFX * (on ? DUCK_SFX : 1), t, on ? 0.08 : 0.5);
  };
  A.ui = (name, vol = 0.4, delay = 0) => {
    if (ctx && A.on && sprite)
      clip(name, ctx.currentTime + 0.01 + delay, { vol, bus: uiBus, k: 'ui-' + name, max: 2, rev: 0.15 });
  }; // menu sounds
  // a short chime on the UI bus (the base's banners, hub.js): 'new' two notes up (a new goal), 'done' three up and bright
  // (a step done); soft sine bells, nothing before the page has had a gesture
  A.chime = (kind = 'new', vol = 0.22) => {
    if (!ctx || !A.on || ctx.state !== 'running') return;
    const notes = kind === 'done' ? [659.3, 830.6, 987.8] : [523.3, 784],
      t0 = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09,
        o = ctx.createOscillator(),
        o2 = ctx.createOscillator(),
        g = ctx.createGain(),
        g2 = ctx.createGain();
      o.type = 'sine';
      o2.type = 'triangle';
      o.frequency.value = f;
      o2.frequency.value = f * 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      g2.gain.value = 0.18;
      o.connect(g);
      o2.connect(g2);
      g2.connect(g);
      g.connect(uiBus);
      o.start(t);
      o2.start(t);
      o.stop(t + 0.6);
      o2.stop(t + 0.6);
    });
  };
  // the hero cat's voice, synthesised: purr (a breath out and a breath in: a ~26 Hz buzz under noise pulsing at the same rate),
  // mrrp (a rolled trill rising), mew (a cry falling away). On the UI bus, quiet; nothing before the page has had a gesture
  A.cat = (kind, vol = 0.3, delay = 0) => {
    if (!ctx || !A.on || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.02 + delay,
      out = ctx.createGain();
    out.connect(uiBus);
    const end = (nodes, t) => {
      for (const x of nodes) {
        x.start(Math.max(ctx.currentTime, t0));
        x.stop(t);
      }
    };
    if (kind === 'purr') {
      out.gain.value = vol;
      for (const [s, l, a, hz] of [
        [0, 1.35, 1, 25],
        [1.5, 1.2, 0.6, 27.5],
      ]) {
        // breaths: start, length, loudness, buzz rate
        const ts = t0 + s,
          g = ctx.createGain();
        g.connect(out);
        g.gain.setValueAtTime(0, ts);
        g.gain.linearRampToValueAtTime(a, ts + 0.2);
        g.gain.setValueAtTime(a, ts + l - 0.35);
        g.gain.linearRampToValueAtTime(0, ts + l);
        const o = ctx.createOscillator(),
          lp = ctx.createBiquadFilter(),
          og = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = hz * vary(0.03);
        lp.type = 'lowpass';
        lp.frequency.value = 300;
        lp.Q.value = 1.4;
        og.gain.value = 0.55;
        o.connect(lp);
        lp.connect(og);
        og.connect(g);
        const n = ctx.createBufferSource(),
          bp = ctx.createBiquadFilter(),
          am = ctx.createGain(),
          lfo = ctx.createOscillator(),
          lg = ctx.createGain();
        n.buffer = noise;
        n.loop = true;
        bp.type = 'bandpass';
        bp.frequency.value = 240;
        bp.Q.value = 0.8;
        am.gain.value = 0.5;
        lfo.frequency.value = hz;
        lg.gain.value = 0.5;
        lfo.connect(lg);
        lg.connect(am.gain);
        n.connect(bp);
        bp.connect(am);
        am.connect(g);
        end([o, n, lfo], ts + l + 0.05);
      }
      return;
    }
    const mew = kind === 'mew',
      L = mew ? 0.6 : 0.32,
      o = ctx.createOscillator(),
      f = o.frequency,
      g = ctx.createGain();
    out.gain.value = vol * 3;
    o.type = 'sawtooth';
    if (mew) {
      f.setValueAtTime(600, t0);
      f.linearRampToValueAtTime(760, t0 + 0.12);
      f.exponentialRampToValueAtTime(400, t0 + L);
    } else {
      f.setValueAtTime(380, t0);
      f.exponentialRampToValueAtTime(640, t0 + 0.2);
      f.exponentialRampToValueAtTime(560, t0 + L);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.03);
    g.gain.setValueAtTime(1, t0 + L * 0.6);
    g.gain.linearRampToValueAtTime(0, t0 + L);
    const f1 = ctx.createBiquadFilter(),
      f2 = ctx.createBiquadFilter(); // formants: from an 'm' open to 'aa' (the mew closes to 'u')
    f1.type = f2.type = 'bandpass';
    f1.Q.value = 5;
    f2.Q.value = 6;
    f1.frequency.setValueAtTime(700, t0);
    f1.frequency.linearRampToValueAtTime(mew ? 900 : 1100, t0 + L * 0.4);
    f1.frequency.linearRampToValueAtTime(mew ? 500 : 900, t0 + L);
    f2.frequency.setValueAtTime(1800, t0);
    f2.frequency.linearRampToValueAtTime(mew ? 1400 : 2200, t0 + L);
    o.connect(f1);
    o.connect(f2);
    f1.connect(g);
    f2.connect(g);
    g.connect(out);
    if (!mew) {
      const tr = ctx.createOscillator(),
        tg = ctx.createGain();
      tr.frequency.value = 28;
      tg.gain.value = 0.45;
      tr.connect(tg);
      tg.connect(g.gain);
      end([tr], t0 + 0.14);
    } // the rolled r
    end([o], t0 + L + 0.05);
  };
  A.level = () => {
    if (!lim) return null;
    if (!tap) {
      tap = ctx.createAnalyser();
      tap.fftSize = 2048;
      lim.connect(tap);
    } // (checks: what actually comes out)
    const d = new Float32Array(tap.fftSize);
    tap.getFloatTimeDomainData(d);
    let s = 0,
      bad = 0;
    for (const v of d) {
      if (!Number.isFinite(v)) bad++;
      else s += v * v;
    }
    return { rms: +Math.sqrt(s / d.length).toFixed(4), bad };
  };
  A.debug = () => ({
    state: ctx && ctx.state,
    pack: !!sprite,
    clips: MAP ? Object.keys(MAP).length : 0,
    voices: VOICES.length,
    musBus: musBus ? +musBus.gain.value.toFixed(3) : null, // (the music's level: MUS × the slider × the duck)
    music: Object.fromEntries(
      Object.entries(mus).map(([k, m]) => [
        k,
        { on: m.on, playing: !m.el.paused, t: +m.el.currentTime.toFixed(1), gain: +m.g.gain.value.toFixed(2) },
      ]),
    ),
  });
})();
