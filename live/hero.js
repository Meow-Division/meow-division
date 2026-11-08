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
      "pistol": {"aim":{"p":[0.07341584855595773,-0.04517313963556062,-0.03221385211033815],"pawR":{"p":[-0.016,0.002,0.042482477685670865],"r":[35,0,0]},"r":[8.42,-1.16,-4.97],"pawL":{"p":[-0.009504265992546921,-0.010558399309167132,0.03602601935193653]}}},
      "shotgun": {"aim":{"pawR":{"p":[-0.038838541939493695,-0.004931967481819252,0.017689170511920278]},"pawL":{"p":[-0.040289930286628826,-0.003163595004857993,0.011396268369207128]},"r":[2.43,5.65,4.28],"p":[0.11284459851130196,-0.01239400958922989,0.05696586241204176]}},
      "smg": {"aim":{"pawL":{"p":[0.021456042374768655,-0.03771621741160566,0.005184580262838899],"r":[-11,-14,19.5]},"p":[0.06294036168352052,0.053438453587106166,0.049759226610204835],"r":[0.95,-0.44,-0.01]}},
      "minigun": {"aim":{"p":[0.02026424267908395,-0.01476005267986601,0.04003445001624001],"pawR":{"p":[-0.011145295485652906,0.03753222377913855,-0.022068752784020478]}}},
      "sniper": {"aim":{"pawL":{"p":[-0.00912579930661638,-0.014396527331712372,-0.035843754747927344],"r":[1.5,-3.5,-14]},"p":[0.0032624865046733086,0.007856928671914315,0.09454816989364886]}},
      "flame": {"aim":{"pawL":{"p":[-0.02768854377814775,-0.012519754056559309,0.023933694944684603],"r":[35,-19,-19]},"p":[0.017527138467131817,0.007771136194546811,0.061293655369598174]}},
      "rocket": {"aim":{"p":[-0.000012777784221660053,-0.057874031849842945,0.12920243884964167],"pawL":{"p":[-0.04272001997133448,0.01693697276409823,-0.0048988049186435845]},"pawR":{"p":[-0.012323118180032056,0.041600674042104976,0.05243146880841539]}}},
    },
    poses: {
      "idle_pistol": {"footR":{"r":[4,0,0]},"elbowL":{"r":[-60.56345658394513,0,0]}},
      "idle_shotgun": {"elbowL":{"k":[[0,-6.881477785358631,0,0]]},"elbowR":{"r":[-27.528843901793195,0,0]}},
      "idle_smg": {"elbowL":{"r":[120,0,0]}},
      "run_smg": {"footR":{"r":[52.5,-3.5,12]},"shinR":{"r":[-11,0,0]},"thighR":{"r":[24.5,0,0]},"head":{"r":[1.5,0,0]},"elbowL":{"r":[-2.002097738312251,0,0]}},
      "idle_sniper": {"elbowL":{"r":[-101.48059592061182,0,0]}},
      "idle_flame": {"elbowL":{"r":[-1.5,0,0]}},
      "run_rocket": {"shinR":{"r":[-43.29,19.45,1.81]},"footR":{"r":[87.94,25.42,-26.18]},"footL":{"r":[4.27,0.73,-7.69]}},
    },
    motion: {
      "twist": 80,
    },
  };
  root.HERO_TUNE = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
