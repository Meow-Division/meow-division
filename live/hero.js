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
      "pistol": {"aim":{"pawL":{"p":[-0.01471567432647415,0.018496513023302567,0.0398863305363526],"r":[15.5,-2,0]},"pawR":{"p":[0.01,0.004,0.036],"r":[17.5,-11.5,19.5]},"p":[-0.05086185022882937,0.048233718333785605,0.11984600289112363],"r":[-4.8,0.75,1.59]}},
      "shotgun": {"aim":{"pawL":{"p":[-0.027462587133071866,0.0023577777854628147,0.08888260926717059],"r":[4,-15.5,0]},"pawR":{"p":[0.0037325055209143465,0.014,0.014],"r":[27.5,0,0]},"p":[0.04848728282667688,0.0791750495972548,0.044919643293104564]}},
      "smg": {"aim":{"pawL":{"p":[0.05608879504629825,0.0019218580335446584,-0.02941624787373819],"r":[-11,-14,19.5]},"p":[-0.021978482543161655,0.004253353426484147,0.09900198430666618],"r":[2.44,-0.91,-2.05],"pawR":{"p":[-0.004890827394248675,-0.01703410259730215,0.010661247799067824]}}},
      "minigun": {"aim":{"p":[0.03931390659657051,-0.04313935527304199,0.02446316143289004],"pawR":{"p":[-0.011145295485652906,0.03753222377913855,-0.022068752784020478]},"pawL":{"p":[-0.04530569783330817,0.028482567973511428,-0.008133405872032531],"r":[0,2,74.5]},"r":[-0.41,4.82,3.26]}},
      "sniper": {"aim":{"pawL":{"p":[-0.019156252941706618,0.036801394872081256,-0.034007841125080186],"r":[19.5,0,-21.5]},"p":[0.0378393492308999,0.09887640852506495,0.1140226556246865],"pawR":{"p":[0,0.01,0.046],"r":[11.5,6,17.5]},"r":[-6.88,5.03,2.25]}},
      "flame": {"aim":{"pawL":{"p":[-0.04499237734807769,0.007968725498299188,0.03947043586433808],"r":[35,-19,-19]},"p":[-0.0762947395738513,-0.10057832068128243,0.05090167044228725],"r":[-5.17,5.22,-14.07]}},
      "rocket": {"aim":{"p":[-0.056211532320221684,-0.025668535521832257,0.05037084849280554],"pawL":{"p":[-0.06118343552769949,0.01084062195069904,0.009556084792406777]},"pawR":{"p":[0.0019471230103385753,0.07161313124578896,0.1415673095012386],"r":[72.5,39,90]},"r":[-13.09,6.14,0.74]}},
    },
    poses: {
      "idle_pistol": {"footR":{"r":[4,0,0]},"elbowL":{"r":[-60.56345658394513,0,0]}},
      "idle_shotgun": {"elbowL":{"k":[[0,-6.881477785358631,0,0]]},"elbowR":{"r":[-27.528843901793195,0,0]}},
      "idle_smg": {"elbowL":{"r":[120,0,0]}},
      "run_smg": {"footR":{"r":[-31.5,-6,-4]},"shinR":{"r":[-11,0,0]},"thighR":{"r":[24.5,0,0]},"head":{"r":[-7.05,-3.39,-1.48]},"elbowL":{"r":[-2.002097738312251,0,0]},"neck":{"r":[20.13,-4.37,2.56]},"chest":{"r":[4.75,-0.94,0.74]},"elbowR":{"r":[120,0,0]}},
      "idle_sniper": {"elbowL":{"r":[-101.48059592061182,0,0]}},
      "idle_flame": {"elbowL":{"r":[-1.5,0,0]},"head":{"r":[-22.41,2.44,-5.92]}},
      "run_rocket": {"shinR":{"r":[2.34,2.88,13.52]},"footR":{"r":[-18.49,-1.55,-20.32]},"footL":{"r":[4.27,0.73,-7.69]},"head":{"r":[-9.04,2.67,8.42]},"chest":{"r":[13.4,-4.74,-3.53]},"elbowR":{"r":[-120,0,0]},"neck":{"r":[-0.12,0.25,0.74]}},
      "lobby_smg": {"head":{"r":[0.32,-0.26,-1.54]}},
      "walk_pistol": {"elbowL":{"r":[-41.52736982643527,0,0]}},
      "walk_shotgun": {"elbowL":{"r":[-20.507343124165573,0,0]},"elbowR":{"r":[61.009345794392495,0,0]}},
      "walk_smg": {"elbowL":{"r":[-43.57810413885183,0,0]},"elbowR":{"r":[58.95861148197591,0,0]}},
      "walk_minigun": {"elbowR":{"r":[112.82242990654203,0,0]},"elbowL":{"r":[1.5380507343124232,0,0]}},
      "walk_sniper": {"elbowL":{"r":[10.766355140186922,0,0]}},
      "walk_flame": {"elbowR":{"r":[-120,0,0]}},
      "walk_rocket": {"elbowR":{"r":[-120,0,0]}},
      "run_pistol": {"head":{"r":[1.57,10.38,10.58]},"shoulderR":{"r":[4.93,-0.16,-2.51]},"chest":{"r":[16.17,0.27,-8.24]}},
      "run_shotgun": {"head":{"r":[11.16,-2.78,10.89]},"chest":{"r":[7.39,-1.64,0.05]}},
      "run_minigun": {"head":{"r":[-10.4,2.67,8.97]},"chest":{"r":[18.51,-8.32,0.13]}},
      "run_sniper": {"head":{"r":[-9.91,3.69,13.57]},"chest":{"r":[11.4,-4.66,2.02]}},
      "run_flame": {"head":{"r":[-11.53,-1.44,-6.23]},"chest":{"r":[28.57,8.72,0.09]},"elbowR":{"r":[86.16288384512691,0,0]}},
    },
    motion: {},
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
