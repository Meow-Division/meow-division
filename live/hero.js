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
    guns: {
      "pistol": {"aim":{"pawL":{"p":[-0.02,0.009049738228230603,0.014],"r":[15.5,-2,0]},"pawR":{"p":[0.01,0.004,0.036],"r":[17.5,-11.5,19.5]},"p":[-0.01874488388661673,0.04525950534196665,0.009533736332414328]}},
      "shotgun": {"aim":{"pawL":{"p":[-0.027462587133071866,0.0023577777854628147,0.08888260926717059],"r":[4,-15.5,0]},"pawR":{"p":[0.0037325055209143465,0.014,0.014],"r":[27.5,0,0]},"p":[0.037516765503790614,0.026615117930000622,0.018480917991875418]}},
      "smg": {"aim":{"pawL":{"p":[0.021186847425521897,-0.03360040588583425,0.029848348701670913],"r":[-11,-14,19.5]},"p":[-0.0188927926550195,-0.031358144419927604,0.019424015525661607],"r":[0.95,-0.44,-0.01],"pawR":{"p":[-0.004890827394248675,-0.01703410259730215,0.010661247799067824]}}},
      "minigun": {"aim":{"p":[-0.034934242279800444,-0.10042995174003792,0.00800739846657946],"pawR":{"p":[-0.011145295485652906,0.03753222377913855,-0.022068752784020478]},"pawL":{"p":[-0.010830635622392986,0.04947168255637834,-0.008143411472855772],"r":[0,2,74.5]}}},
      "sniper": {"aim":{"pawL":{"p":[-0.019156252941706618,0.036801394872081256,-0.034007841125080186],"r":[19.5,0,-21.5]},"p":[0.06403548864811558,-0.007316781142675802,0.15942364471363132],"pawR":{"p":[0,0.01,0.046],"r":[11.5,6,17.5]}}},
      "flame": {"aim":{"pawL":{"p":[-0.04499237734807769,0.007968725498299188,0.03947043586433808],"r":[35,-19,-19]},"p":[-0.020278676655965343,-0.028197557213346255,-0.01313460660145786]}},
      "rocket": {"aim":{"p":[-0.04196957962820122,-0.03589444326817805,0.09675807698745942],"pawL":{"p":[-0.06118343552769949,0.01084062195069904,0.009556084792406777]},"pawR":{"p":[-0.052,0.134,0.15],"r":[72.5,39,90]}}},
    },
    poses: {
      "idle_pistol": {"footR":{"r":[4,0,0]},"elbowL":{"r":[-60.56345658394513,0,0]}},
      "idle_shotgun": {"elbowL":{"k":[[0,-6.881477785358631,0,0]]},"elbowR":{"r":[-27.528843901793195,0,0]}},
      "idle_smg": {"elbowL":{"r":[120,0,0]}},
      "run_smg": {"footR":{"r":[52.5,-3.5,12]},"shinR":{"r":[-11,0,0]},"thighR":{"r":[24.5,0,0]},"head":{"r":[1.5,0,0]},"elbowL":{"r":[-2.002097738312251,0,0]}},
      "idle_sniper": {"elbowL":{"r":[-101.48059592061182,0,0]}},
      "idle_flame": {"elbowL":{"r":[-1.5,0,0]}},
      "run_rocket": {"shinR":{"r":[-43.29,19.45,1.81]},"footR":{"r":[87.94,25.42,-26.18]},"footL":{"r":[4.27,0.73,-7.69]}},
      "lobby_smg": {"head":{"r":[0.32,-0.26,-1.54]}},
      "walk_pistol": {"elbowL":{"r":[-41.52736982643527,0,0]}},
      "walk_shotgun": {"elbowL":{"r":[-20.507343124165573,0,0]},"elbowR":{"r":[61.009345794392495,0,0]}},
      "walk_smg": {"elbowL":{"r":[-43.57810413885183,0,0]},"elbowR":{"r":[58.95861148197591,0,0]}},
      "walk_minigun": {"elbowR":{"r":[112.82242990654203,0,0]},"elbowL":{"r":[1.5380507343124232,0,0]}},
      "walk_sniper": {"elbowL":{"r":[10.766355140186922,0,0]}},
      "walk_flame": {"elbowR":{"r":[-120,0,0]}},
      "walk_rocket": {"elbowR":{"r":[-120,0,0]}},
    },
    motion: {},
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
