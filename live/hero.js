// live/hero.js — the hero's tune, made in the character editor (hero-editor.bat → /live/index.html?hero) and written by its server
// (server/herofile.mjs). hero3d.js lays it over the cat's baked clips (herobake.js); the sim's muzzles in data.js (D.HERO3D) follow it.
// guns: per gun its scale and its place aiming (aim: idle and run) and in the lobby: p moved (model units: x its left, y up, z along
//   the barrel), r turned (degrees about those axes at its grip); pawR / pawL: each paw moved and turned on it the same way.
// poses: per clip, per part of the body (herobake.js PARTS; the elbows: their swing round the line from shoulder to paw) its turn
//   [forward, to its left, leaning right] in degrees: r for the whole clip, or k keyed [[frame, x, y, z], ...] (a loop through them).
// motion (hero3d.js): twist, legs, rest (degrees), legRate, twistRate, kick, kickBack, lobbySpeed, idleSpeed, stride (×), blink (s, 0: never).
(function (root) {
  const T = {
    v: 1,
    guns: {},
    poses: {},
    motion: {},
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
