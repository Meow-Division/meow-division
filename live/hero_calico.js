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
      "shotgun": {"aim":{"p":[0.11347908316393905,0.033872931437295986,0.1523490766597057],"r":[0.76,2.28,2.08],"pawR":{"p":[-0.003373971915859577,-0.004372328034299373,0.010681276358189561]},"pawL":{"p":[-0.018277560276712037,0.01437686760544966,-0.013627004063203586]}}},
      "smg": {"aim":{"pawL":{"p":[0.02384250633435546,0.05644142755907755,0.04307872701460578],"r":[32,-14,-26.5]},"p":[0.0716912963935499,-0.07296419895621678,-0.008372276806509593]}},
      "sniper": {"aim":{"p":[0.07558984462026146,-0.08421750634116501,0.1732520082061746],"pawL":{"p":[0.006246899434542201,0.05351825863298384,-0.016003879366796158],"r":[19.5,-34,14.5]}}},
      "pistol": {"aim":{"pawL":{"p":[-0.04197483355705748,0.03458681407870549,-0.011342386451163538],"r":[37.5,27,-60]},"p":[0.009506823312202234,0.0021889247257384017,0.03615868409798615],"pawR":{"p":[0.0038186477925416,-0.0021956046929018447,0.006818150088758862]}}},
      "minigun": {"aim":{"p":[-0.08654225157534405,-0.022475042035363584,-0.04845730358903323],"pawL":{"p":[0.022389877985218066,-0.10685611244277832,0.004574704395870919],"r":[12,14.5,-85.5]},"r":[0.21,-0.51,-2.02]}},
      "flame": {"aim":{"p":[0.14637748733601116,-0.0640269729887411,0.0226865383563608],"pawL":{"p":[-0.06649071471462607,0.03185382852633636,-0.023608192423045418],"r":[17,37.5,42.5]}}},
      "rocket": {"aim":{"p":[0.04817567664064275,0.0016200225555295118,0.046390668818642955],"pawR":{"p":[0.013685530524750624,0.011344500904753365,0.04849680113034176]},"pawL":{"p":[-0.009035061693699886,0.054,-0.044],"r":[32,-8.5,-1]}}},
    },
    poses: {
      "idle_smg": {"elbowR":{"r":[74.07761631755285,0,0]},"elbowL":{"r":[-120,0,0]},"shoulderL":{"r":[28.62,21.3,33.1]}},
      "walk_smg": {"elbowL":{"r":[-112.4921334813291,0,0]}},
      "idle_pistol": {"elbowL":{"r":[-89.9685339253164,0,0]},"tail":{"r":[61.42,-59.46,43.08]},"shoulderL":{"r":[-6.41,-2.76,-2.97]},"waist":{"r":[2.55,1.02,1.24]}},
      "idle_shotgun": {"elbowL":{"r":[62.43969002352322,0,0]},"tail":{"r":[30.64,4.33,-7.02]}},
      "idle_minigun": {"elbowL":{"r":[-120,0,0]},"elbowR":{"r":[120,0,0]}},
      "idle_sniper": {"elbowL":{"r":[-120,0,0]},"shoulderL":{"r":[-0.03,-6.36,-5.43]}},
      "idle_flame": {"shoulderL":{"r":[59.82,3.74,16.02]},"elbowL":{"r":[-15.390393173185654,0,0]}},
      "idle_rocket": {"elbowL":{"r":[120,0,0]}},
    },
    motion: {},
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
