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
      "pistol": {"aim":{"pawL":{"p":[-0.02,0.009049738228230603,0.014],"r":[15.5,-2,0]},"pawR":{"p":[0.01,0.004,0.036],"r":[17.5,-11.5,19.5]},"p":[-0.00421528789826738,0.1219550665751076,0.024912459308189413],"r":[-7.68,1.17,1.97]}},
      "shotgun": {"aim":{"pawL":{"p":[-0.027462587133071866,0.0023577777854628147,0.08888260926717059],"r":[4,-15.5,0]},"pawR":{"p":[0.0037325055209143465,0.014,0.014],"r":[27.5,0,0]},"p":[0.04848728282667688,0.0791750495972548,0.044919643293104564]}},
      "smg": {"aim":{"pawL":{"p":[0.021186847425521897,-0.03360040588583425,0.029848348701670913],"r":[-11,-14,19.5]},"p":[-0.0033978604944136146,0.08285581401167622,0.05588527930490382],"r":[0.95,-0.44,-0.01],"pawR":{"p":[-0.004890827394248675,-0.01703410259730215,0.010661247799067824]}}},
      "minigun": {"aim":{"p":[-0.010736952580429658,-0.035180356586776804,0.04780439654904041],"pawR":{"p":[-0.011145295485652906,0.03753222377913855,-0.022068752784020478]},"pawL":{"p":[-0.04530569783330817,0.028482567973511428,-0.008133405872032531],"r":[0,2,74.5]},"r":[-16.76,6.88,-2.89]}},
      "sniper": {"aim":{"pawL":{"p":[-0.019156252941706618,0.036801394872081256,-0.034007841125080186],"r":[19.5,0,-21.5]},"p":[0.0378393492308999,0.09887640852506495,0.1140226556246865],"pawR":{"p":[0,0.01,0.046],"r":[11.5,6,17.5]}}},
      "flame": {"aim":{"pawL":{"p":[-0.04499237734807769,0.007968725498299188,0.03947043586433808],"r":[35,-19,-19]},"p":[-0.015441002766503197,0.02455506483873168,0.040880183201740666],"r":[-19.99,7.65,-8.5]}},
      "rocket": {"aim":{"p":[-0.04196957962820122,-0.03589444326817805,0.09675807698745942],"pawL":{"p":[-0.06118343552769949,0.01084062195069904,0.009556084792406777]},"pawR":{"p":[0.0019471230103385753,0.07161313124578896,0.1415673095012386],"r":[72.5,39,90]},"r":[-12.29,5.13,2.09]}},
    },
    poses: {
      "idle_pistol": {"footR":{"r":[4,0,0]},"elbowL":{"r":[-60.56345658394513,0,0]}},
      "idle_shotgun": {"elbowL":{"k":[[0,-6.881477785358631,0,0]]},"elbowR":{"r":[-27.528843901793195,0,0]}},
      "idle_smg": {"elbowL":{"r":[120,0,0]}},
      "run_smg": {"footR":{"r":[-31.5,-6,-4]},"shinR":{"r":[-11,0,0]},"thighR":{"r":[24.5,0,0]},"head":{"r":[1.5,0,0]},"elbowL":{"r":[-2.002097738312251,0,0]},"neck":{"r":[20.13,-4.37,2.56]},"chest":{"r":[4.75,-0.94,0.74]}},
      "idle_sniper": {"elbowL":{"r":[-101.48059592061182,0,0]}},
      "idle_flame": {"elbowL":{"r":[-1.5,0,0]}},
      "run_rocket": {"shinR":{"r":[2.34,2.88,13.52]},"footR":{"r":[-18.49,-1.55,-20.32]},"footL":{"r":[4.27,0.73,-7.69]},"head":{"r":[20.9,-6.93,-5.93]},"chest":{"r":[13.4,-4.74,-3.53]},"elbowR":{"r":[-120,0,0]}},
      "lobby_smg": {"head":{"r":[0.32,-0.26,-1.54]}},
      "walk_pistol": {"elbowL":{"r":[-41.52736982643527,0,0]}},
      "walk_shotgun": {"elbowL":{"r":[-20.507343124165573,0,0]},"elbowR":{"r":[61.009345794392495,0,0]}},
      "walk_smg": {"elbowL":{"r":[-43.57810413885183,0,0]},"elbowR":{"r":[58.95861148197591,0,0]}},
      "walk_minigun": {"elbowR":{"r":[112.82242990654203,0,0]},"elbowL":{"r":[1.5380507343124232,0,0]}},
      "walk_sniper": {"elbowL":{"r":[10.766355140186922,0,0]}},
      "walk_flame": {"elbowR":{"r":[-120,0,0]}},
      "walk_rocket": {"elbowR":{"r":[-120,0,0]}},
      "run_pistol": {"head":{"r":[21.65,5.5,4.14]},"shoulderR":{"r":[4.93,-0.16,-2.51]},"chest":{"r":[16.17,0.27,-8.24]}},
      "run_shotgun": {"head":{"r":[23.39,-8.06,8.28]},"chest":{"r":[7.39,-1.64,0.05]}},
      "run_minigun": {"head":{"r":[20.75,-10.59,3.35]},"chest":{"r":[18.51,-8.32,0.13]}},
      "run_sniper": {"head":{"r":[28.34,-12.11,3.28]},"chest":{"r":[11.4,-4.66,2.02]}},
      "run_flame": {"head":{"r":[-10.81,-1.53,-6.2]},"chest":{"r":[28.57,8.72,0.09]}},
    },
    motion: {},
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
