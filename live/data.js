// live/data.js — static game definitions (weapons, items, enemies, meta upgrades, maps, roadmap). Pure data: loaded by the
// page before sim.js and required by sim.js under node (tune.cjs).
(function (root) {
  const D = {};

  // ---------- main weapons (rate = shots/s, range in view px). hold = drawn gun length, grip = pivot fraction from the left ----------
  // rank: the survivor rank from which the gun can be bought (D.RANK_NEED); mag: the rounds in its magazine (the flamethrower's: ticks of
  // fuel), rl: its reload (s)
  // names, feature lines, descriptions and level lines (here and below): lang_<code>.js, written in by I18N.apply
  D.MAIN = {
    pistol: {
      price: 0,
      rank: 1,
      mag: 13,
      rl: 1.4,
      dmg: 12,
      rate: 3,
      speed: 1350,
      spread: 0.06,
      range: 640,
      hold: 50,
      grip: 0.32,
      recoil: 6,
      tracer: 0,
    },
    shotgun: {
      price: 600,
      rank: 2,
      mag: 6,
      rl: 1.8,
      dmg: 10,
      pellets: 6,
      rate: 1.2,
      speed: 1150,
      spread: 0.8,
      range: 440,
      hold: 80,
      grip: 0.42,
      knock: 300,
      recoil: 14,
      tracer: 1,
    },
    smg: {
      price: 1000,
      rank: 4,
      mag: 40,
      rl: 1.5,
      dmg: 9,
      rate: 10,
      speed: 1400,
      spread: 0.3,
      range: 580,
      hold: 66,
      grip: 0.38,
      recoil: 4,
      tracer: 0,
    },
    minigun: {
      price: 1800,
      rank: 6,
      mag: 150,
      rl: 2.8,
      dmg: 7,
      rate: 20,
      spin: 1.3,
      speed: 1450,
      spread: 0.5,
      range: 620,
      hold: 112,
      grip: 0.42,
      slow: 0.22,
      recoil: 3,
      tracer: 0,
    },
    sniper: {
      price: 1800,
      rank: 8,
      mag: 5,
      rl: 2.2,
      dmg: 60,
      rate: 0.8,
      speed: 2800,
      spread: 0,
      range: 1050,
      pierce: 5,
      hold: 104,
      grip: 0.45,
      recoil: 16,
      tracer: 2,
    },
    flame: {
      price: 2400,
      rank: 10,
      mag: 60,
      rl: 2,
      dmg: 5,
      tick: 0.1,
      cone: 0.36,
      range: 280,
      hold: 86,
      grip: 0.42,
      burn: 3,
    },
    rocket: {
      price: 3000,
      rank: 13,
      mag: 5,
      rl: 2.2,
      dmg: 65,
      rate: 0.7,
      speed: 760,
      spread: 0.04,
      range: 720,
      aoe: 125,
      hold: 98,
      grip: 0.45,
      recoil: 18,
    },
    laser: { price: 4000, rank: 16, dmg: 30, locked: true, hold: 96, grip: 0.4 },
    // the Copper Phantom: a rare rifle bosses drop, never sold for coins (not in MAIN_ORDER). The SMG's numbers each 10% better (the
    // spread and the reload 10% shorter, the magazine 10% bigger; REV 51, was 20% and a quarter); levels and evolution as the SMG's
    // (like); a laser sight, a suppressed shot of its own (audio.js)
    phantom: {
      price: 0,
      rank: 1,
      rare: true,
      like: 'smg',
      laser: true,
      mag: 44,
      rl: 1.35,
      dmg: 9.9,
      rate: 11,
      speed: 1540,
      spread: 0.27,
      range: 638,
      hold: 70,
      grip: 0.38,
      recoil: 4,
      tracer: 0,
    },
  };
  D.MAIN_ORDER = ['pistol', 'shotgun', 'smg', 'minigun', 'sniper', 'flame', 'rocket', 'laser'];
  // a gun held as another: the hero's clips for it are that one's (live/herobake.js HB.alias), its own hold tuned on top
  D.GUN_LIKE = { phantom: 'smg' };
  // the magazine grows with the arsenal's upgrade (WEAPON_UP.mag), by MAG_BAND a level of the bandolier and ×MAG_EVO with the gun's
  // evolution; the battery shortens the reload as it does the extra weapons' cooldowns
  D.MAG_BAND = 0.25;
  D.MAG_EVO = 1.5;
  // How the penguin holds each gun (the guns: meshes, live/gunmesh.js — the laser: penguin.js's model; the sim shoots from the same muzzle). Model units (1 = the
  // penguin's height), in the aim frame: x the penguin's left, y up, z along the aim. O: the gun's origin (its rear grip) — the gun's
  // own axes are the aim frame's; mz: the muzzle, port: the ejection port, R / Lh: where the right / left flipper's tip holds (null:
  // that flipper is free), all in the gun's frame; yaw: the body turns this far off the aim (a bladed stance lets the left flipper
  // reach further); pro: how far forward the shoulders come round (rad from the facing); lean: leaning back under the weight;
  // pump: how far the slide / pump racks; b: the gun's bounding capsule [z0, z1, radius, y]; k: the gun drawn this much thicker
  // (x, y) and longer (z) than modelled (the laser, modelled thin; the others are modelled at their drawn size); pole: where the
  // holding flipper's elbow points (x outward; default out, down and back).
  // The pistol and the SMG are held at the right side by the right flipper alone, hanging nearly straight (its elbow back), the
  // bazooka rests on the left shoulder in the left flipper; the rest are held in both.
  D.HOLD = {
    pistol: {
      hand: [-0.217, 0.34, 0.24],
      yaw: 0.13,
      pro: 1.35,
      O: [-0.21, 0.33, 0.27],
      pole: [0.45, -0.3, -0.85],
      mz: [0, 0.07, 0.218],
      port: [-0.03, 0.09, 0.1],
      R: [-0.025, -0.055, -0.035],
      Lh: null,
      pump: 0.04,
      b: [-0.09, 0.22, 0.14, -0.01],
    },
    shotgun: {
      hand: [-0.07, 0.31, 0.3],
      yaw: -0.42,
      pro: 0.56,
      O: [-0.065, 0.385, 0.325],
      mz: [0, 0.075, 0.495],
      port: [-0.036, 0.063, 0.078],
      R: [-0.025, -0.045, -0.035],
      Lh: [0.036, 0.0, 0.25],
      pump: 0.05,
      b: [-0.1, 0.5, 0.13, 0],
    },
    smg: {
      hand: [-0.217, 0.33, 0.24],
      yaw: 0.13,
      pro: 1.35,
      O: [-0.21, 0.32, 0.26],
      pole: [0.45, -0.3, -0.85],
      mz: [0, 0.058, 0.415],
      port: [-0.036, 0.075, 0.1],
      R: [-0.025, -0.05, -0.035],
      Lh: null,
      pump: 0,
      b: [-0.08, 0.42, 0.16, 0],
    },
    phantom: {
      hand: [-0.217, 0.33, 0.24],
      yaw: 0.13,
      pro: 1.35,
      O: [-0.21, 0.32, 0.26],
      pole: [0.45, -0.3, -0.85],
      mz: [0, 0.058, 0.415],
      port: [-0.036, 0.075, 0.1],
      R: [-0.025, -0.05, -0.035],
      Lh: null,
      pump: 0,
      b: [-0.08, 0.42, 0.16, 0],
    },
    minigun: {
      hand: [-0.142, 0.26, 0.3],
      yaw: -0.3,
      pro: 0.6,
      lean: 0.06,
      O: [-0.04, 0.3, 0.37],
      mz: [0, 0.035, 0.535],
      port: null,
      R: [-0.05, 0.03, -0.062],
      Lh: [0.012, 0.157, 0.04],
      pump: 0,
      b: [-0.09, 0.54, 0.16, 0.02],
    },
    sniper: {
      lgrip: [0, -0.06, -0.01],
      hand: [-0.11, 0.375, 0.33],
      yaw: -0.57,
      pro: 0.42,
      O: [-0.05, 0.465, 0.34],
      mz: [0, 0.04, 0.778],
      port: [-0.033, 0.075, 0.02],
      R: [-0.024, -0.05, -0.035],
      Lh: [0.034, 0.02, 0.27],
      pump: 0.04,
      b: [-0.15, 0.78, 0.15, 0.02],
    },
    flame: {
      hand: [-0.122, 0.307, 0.28],
      yaw: -0.4,
      pro: 0.68,
      O: [-0.045, 0.38, 0.325],
      mz: [0, 0.05, 0.47],
      port: null,
      R: [-0.025, -0.05, -0.03],
      Lh: [0.062, -0.072, 0.2],
      pump: 0,
      b: [-0.08, 0.47, 0.15, -0.01],
    },
    rocket: {
      rest: [0.36, 0.48, 0.062],
      yaw: 0.24,
      pro: 1.3,
      O: [0.42, 0.58, 0.1],
      mz: [0, 0, 0.835],
      port: null,
      R: null,
      Lh: [0, -0.17, 0],
      pump: 0,
      b: [-0.29, 0.84, 0.16, -0.03],
    },
    laser: {
      yaw: -0.3,
      pro: 0.68,
      O: [-0.03, 0.38, 0.33],
      mz: [0, 0.034, 0.37],
      port: null,
      R: [-0.026, -0.03, -0.012],
      Lh: [0.022, -0.045, 0.11],
      pump: 0,
      b: [-0.065, 0.39, 0.13, 0.02],
      k: [1.45, 1.45, 1.12],
    },
  };
  D.gunK = (id) => (D.HOLD[id] && D.HOLD[id].k) || [1, 1, 1];
  // the guns modelled in Blender (art/guns3d/<gun>.py with gen/blender; drawn by live/gunmesh.js). gen/guns3d.mjs writes each one's
  // anchors (the gun's own frame, as HOLD's) between the markers: R / L the right / left flipper's grip, muzzle, port, spin (a point
  // on the minigun's barrel axis, which runs along z), shoulder (where the rocket launcher rests), min / max its box, slide how far
  // its slide or pump racks. A gun with a mesh takes its grips, muzzle, port and bounds from them; its hold says where its main grip
  // sits in the aim frame (hand: R's, or L's when it has no R) and the gun is placed by it — or the rocket launcher by its rest point
  // (rest: where its shoulder anchor lies). lgrip: the left flipper's grip instead of the mesh's L, when that is out of its reach.
  // The two blocks below stay one line each: their exports rewrite them, and server/herofile.mjs reads HERO3D as JSON.
  // prettier-ignore
  // <gun3d>
  D.GUN3D = {"flame":{"anchors":{"R":[0,-0.12,-0.219],"L":[0.0675,-0.1365,0.0305],"muzzle":[0,0.002,0.2805]},"min":[-0.0838,-0.2164,-0.276],"max":[0.0705,0.1015,0.2805],"slide":0,"tris":85772},"minigun":{"anchors":{"R":[-0.0583,-0.0423,-0.2305],"L":[0,0.1374,-0.1073],"muzzle":[0,0,0.3275],"spin":[0,0,0.1882]},"min":[-0.0706,-0.1651,-0.2917],"max":[0.0706,0.1515,0.3275],"slide":0,"tris":85758},"pistol":{"anchors":{"R":[0.0,-0.0624,-0.0209],"muzzle":[0.0,0.0619,0.2477],"port":[-0.0215,0.0592,0.09]},"min":[-0.0381,-0.1844,-0.0923],"max":[0.0379,0.0949,0.2477],"slide":0.04,"tris":12000},"rocket":{"anchors":{"L":[0,-0.185,-0.288],"shoulder":[0,-0.0815,-0.14],"muzzle":[0,0,0.598]},"min":[-0.1158,-0.273,-0.525],"max":[0.1158,0.1329,0.598],"slide":0,"tris":70864},"shotgun":{"anchors":{"R":[0.0,-0.1278,-0.1534],"muzzle":[0.0,-0.0011,0.3184],"port":[-0.0347,-0.0353,-0.0233],"L":[0.0,-0.0642,0.1156]},"min":[-0.0546,-0.2155,-0.2316],"max":[0.0549,0.0297,0.3184],"slide":0.03,"tris":11999},"smg":{"anchors":{"R":[0.0,-0.1332,-0.1398],"muzzle":[0.0,-0.0312,0.268],"port":[-0.0394,-0.0228,-0.0057],"L":[0.0,-0.1332,0.0232]},"min":[-0.0545,-0.2621,-0.232],"max":[0.0546,0.0583,0.268],"slide":0,"tris":12000},"sniper":{"anchors":{"R":[0,-0.1645,-0.3025],"L":[0,-0.0608,0.1236],"muzzle":[0,-0.0135,0.5237],"port":[-0.0278,0.0074,-0.0981]},"min":[-0.034,-0.2361,-0.4062],"max":[0.034,0.1298,0.5242],"slide":0,"tris":67894},"phantom":{"anchors":{"R":[0.0,-0.1332,-0.1398],"L":[0.0,-0.1156,0.1209],"muzzle":[0.0,-0.027,0.4223],"port":[-0.0475,-0.0276,-0.0155],"laser":[0.0,0.0204,0.2134]},"min":[-0.0475,-0.2375,-0.4177],"max":[0.0462,0.0769,0.4223],"slide":0,"tris":12000}};
  // </gun3d>
  // prettier-ignore
  // <hero3d>
  D.HERO3D = {"h":116,"mz":{"pistol":[0.0398,1.0229,0.6209],"shotgun":[-0.1037,1.0037,0.6551],"smg":[-0.0456,1.0455,0.7159],"minigun":[0.0312,0.7295,0.8994],"sniper":[-0.122,1.1162,0.793],"rocket":[-0.0562,1.1519,0.7178],"flame":[-0.0563,1.0265,0.5845],"phantom":[-0.085,1.0539,0.8374],"laser":[-0.122,1.1162,0.793]}};
  // </hero3d>
  for (const id in D.GUN3D) {
    const g = D.GUN3D[id],
      a = g.anchors,
      H = D.HOLD[id],
      grip = a.R || a.L;
    Object.assign(H, {
      R: a.R || null,
      Lh: H.lgrip || a.L || null,
      mz: a.muzzle,
      port: a.port || null,
      pump: g.slide || 0,
      k: undefined,
      mesh: true,
      b: [g.min[2], g.max[2], Math.max(g.max[0] - g.min[0], g.max[1] - g.min[1]) / 2, (g.min[1] + g.max[1]) / 2],
    });
    if (H.hand) H.O = [H.hand[0] - grip[0], H.hand[1] - grip[1], H.hand[2] - grip[2]];
    if (H.rest && a.shoulder) H.O = [H.rest[0] - a.shoulder[0], H.rest[1] - a.shoulder[1], H.rest[2] - a.shoulder[2]];
  } // (on the shoulder)

  // ---------- extra weapons & passives (st[level-1]; an item's last level: st.length) ----------
  // molotov: bottles thrown into crowds leave burning puddles (r, dur s, dps); tesla: an aura of radius r that strikes every tick s;
  // turret: set down for life s, fires rate/s; gravity: a well of radius r that pulls zombies in for dur s (its heart crushes, dps);
  // missiles: salvos that home on crowds (r: the blast). The passives: canister — zones bigger (a) and longer (d); bandolier — extra
  // projectiles for every extra weapon; medkit — the health regained a second (r) and the max health added (hp); boots — the hero's
  // speed (s) and the main gun's reload (rl) ×; helmet — the chance a hit is blocked; fang — every n-th kill heals hp; battery — the extra
  // weapons' cooldowns ×; scope — range and projectile speed ×; caliber — the main gun's damage ×
  D.ITEMS = {
    chain: {
      kind: 'weapon',
      icon: 'i_lightning',
      st: [
        { cd: 1.3, n: 4, dmg: 16, r: 470, jump: 200, chains: 1, stun: 0.3 },
        { cd: 1.2, n: 5, dmg: 19.2, r: 490, jump: 205, chains: 1, stun: 0.3 },
        { cd: 1.0, n: 6, dmg: 20.8, r: 510, jump: 210, chains: 1, stun: 0.38 },
        { cd: 0.95, n: 6, dmg: 22.4, r: 530, jump: 215, chains: 2, stun: 0.38 },
        { cd: 0.85, n: 8, dmg: 28, r: 560, jump: 225, chains: 2, stun: 0.42 },
      ],
    }, // (REV 20: damage −20 %)
    saws: {
      kind: 'weapon',
      icon: 'i_saw',
      st: [
        { n: 2, dmg: 14.4, r: 144, spd: 3.2 },
        { n: 3, dmg: 17.28, r: 150, spd: 3.4 },
        { n: 3, dmg: 21.6, r: 177, spd: 3.6 },
        { n: 4, dmg: 24.48, r: 183, spd: 3.9 },
        { n: 5, dmg: 28.8, r: 198, spd: 4.4 },
      ],
    }, // (REV 21: damage +20 %)
    drone: {
      kind: 'weapon',
      icon: 'i_drone',
      st: [
        { n: 1, dmg: 10, rate: 2 },
        { n: 1, dmg: 13, rate: 2.1 },
        { n: 1, dmg: 14, rate: 2.6 },
        { n: 2, dmg: 15, rate: 2.6 },
        { n: 2, dmg: 19, rate: 3, pierce: 1 },
      ],
    },
    grenade: {
      kind: 'weapon',
      icon: 'i_grenade',
      st: [
        { cd: 2.8, n: 1, dmg: 35, r: 95 },
        { cd: 2.6, n: 1, dmg: 44, r: 100 },
        { cd: 2.5, n: 2, dmg: 48, r: 104 },
        { cd: 2.3, n: 2, dmg: 55, r: 120 },
        { cd: 2.1, n: 3, dmg: 66, r: 126 },
      ],
    },
    medkit: {
      kind: 'passive',
      icon: 'i_medkit',
      st: [
        { r: 0.5, hp: 5 },
        { r: 1, hp: 10 },
        { r: 1.5, hp: 15 },
        { r: 2, hp: 23 },
        { r: 2.8, hp: 30 },
      ],
    },
    magnet: { kind: 'passive', icon: 'i_magnet', st: [1.35, 1.7, 2.05, 2.4, 2.8] },
    armor: { kind: 'passive', icon: 'i_armor', st: [0.08, 0.15, 0.22, 0.28, 0.35] },
    boots: {
      kind: 'passive',
      icon: 'i_boots',
      st: [
        { s: 1.08, rl: 0.94 },
        { s: 1.16, rl: 0.88 },
        { s: 1.24, rl: 0.82 },
        { s: 1.32, rl: 0.76 },
        { s: 1.4, rl: 0.7 },
      ],
    },
    clover: { kind: 'passive', icon: 'i_clover', st: [0.05, 0.1, 0.15, 0.2, 0.25] },
    molotov: {
      kind: 'weapon',
      icon: 'i_molotov',
      st: [
        { cd: 3.4, n: 1, r: 70, dur: 3, dps: 9 },
        { cd: 3.2, n: 1, r: 76, dur: 3.5, dps: 11 },
        { cd: 3.0, n: 2, r: 78, dur: 3.5, dps: 12 },
        { cd: 2.8, n: 2, r: 86, dur: 4, dps: 14 },
        { cd: 2.6, n: 3, r: 90, dur: 4, dps: 16 },
      ],
    },
    tesla: {
      kind: 'weapon',
      icon: 'i_coil',
      st: [
        { r: 95, dmg: 8, tick: 0.6 },
        { r: 105, dmg: 10, tick: 0.55 },
        { r: 115, dmg: 12, tick: 0.5 },
        { r: 125, dmg: 14, tick: 0.45 },
        { r: 140, dmg: 17, tick: 0.4 },
      ],
    },
    turret: {
      kind: 'weapon',
      icon: 'i_turret',
      st: [
        { cd: 12, life: 8, dmg: 11, rate: 4 },
        { cd: 11, life: 9, dmg: 13, rate: 4.5 },
        { cd: 10, life: 10, dmg: 14, rate: 5 },
        { cd: 9, life: 10, dmg: 16, rate: 5.5 },
        { cd: 8, life: 12, dmg: 18, rate: 6.5, pierce: 1 },
      ],
    },
    gravity: {
      kind: 'weapon',
      icon: 'i_gravity',
      st: [
        { cd: 7, r: 160, dur: 2, pull: 260, dps: 8 },
        { cd: 6.5, r: 175, dur: 2.2, pull: 280, dps: 10 },
        { cd: 6, r: 190, dur: 2.4, pull: 300, dps: 12 },
        { cd: 5.5, r: 205, dur: 2.6, pull: 320, dps: 14 },
        { cd: 5, r: 220, dur: 3, pull: 340, dps: 16 },
      ],
    },
    missiles: {
      kind: 'weapon',
      icon: 'i_missiles',
      st: [
        { cd: 5, n: 2, dmg: 30, r: 80 },
        { cd: 4.6, n: 2, dmg: 36, r: 85 },
        { cd: 4.3, n: 3, dmg: 38, r: 88 },
        { cd: 4, n: 3, dmg: 44, r: 95 },
        { cd: 3.6, n: 4, dmg: 50, r: 100 },
      ],
    },
    canister: {
      kind: 'passive',
      icon: 'i_canister',
      st: [
        { a: 1.05, d: 1.1 },
        { a: 1.1, d: 1.2 },
        { a: 1.15, d: 1.3 },
        { a: 1.2, d: 1.4 },
        { a: 1.25, d: 1.5 },
      ],
    },
    bandolier: { kind: 'passive', icon: 'i_bandolier', st: [1, 2] },
    helmet: { kind: 'passive', icon: 'i_helmet', st: [0.1, 0.14, 0.18, 0.22, 0.25] },
    fang: {
      kind: 'passive',
      icon: 'i_fang',
      st: [
        { n: 20, hp: 2 },
        { n: 18, hp: 2 },
        { n: 16, hp: 3 },
        { n: 14, hp: 3 },
        { n: 12, hp: 4 },
      ],
    },
    battery: { kind: 'passive', icon: 'i_battery', st: [0.92, 0.84, 0.76, 0.68, 0.6] },
    scope: { kind: 'passive', icon: 'i_scope', st: [1.1, 1.2, 1.3, 1.4, 1.5] },
    caliber: { kind: 'passive', icon: 'i_caliber', st: [1.08, 1.16, 1.24, 1.32, 1.4] },
  };
  D.SUB_WEAPONS = ['chain', 'saws', 'drone', 'grenade', 'molotov', 'tesla', 'turret', 'gravity', 'missiles'];
  D.PASSIVES = [
    'medkit',
    'magnet',
    'armor',
    'boots',
    'clover',
    'canister',
    'bandolier',
    'helmet',
    'fang',
    'battery',
    'scope',
    'caliber',
  ];
  // an extra weapon at its last level with its passive (any level) evolves; the main gun evolves at level 5 with MAIN_EVO
  D.EVOS = {
    saws: { with: 'magnet' },
    chain: { with: 'armor' },
    drone: { with: 'clover' },
    grenade: { with: 'medkit' },
    molotov: { with: 'canister' },
    tesla: { with: 'helmet' },
    turret: { with: 'battery' },
    gravity: { with: 'magnet' },
    missiles: { with: 'scope' },
  };
  D.MAIN_EVO = 'caliber';
  D.MAX_ITEMS = 7; // extra weapons and passives together (the main gun aside)
  // a level up's three cards (sim.js cardOptions, REV 42), by the run's clock: before the first row's t (seconds) one card is a gun
  // (the main gun's or an extra weapon's), one a passive, and the third a gun with the row's chance, else a passive; the same until
  // the second row's t with its chance; after that all three are drawn from everything
  D.CARD_GUN = [
    { t: 120, gun: 0.7 },
    { t: 300, gun: 0.5 },
  ];
  // a crate (an airdrop, a miniboss's) with a slot still free: the chance it brings the partner of something held (sim.js chestReward)
  D.PAIR_DROP = 0.35;

  // ---------- enemies: r = body radius in the ground metric (screen x, 2·screen y), h = drawn height in view px; eliteHp: an elite's
  // health × on top of the elites' own ----------
  D.ENEMIES = {
    walker: { rig: 'a_walker', h: 110, r: 17, hp: 22, speed: 62, dmg: 10, xp: 1, mass: 1, stride: 34 },
    runner: { rig: 'a_runner', h: 102, r: 15, hp: 13, speed: 132, dmg: 7, xp: 1, mass: 0.7, stride: 46 },
    bloater: {
      rig: 'a_bloater',
      h: 128,
      r: 25,
      hp: 110,
      speed: 46,
      dmg: 12,
      xp: 3,
      mass: 2,
      explode: true,
      stride: 26,
    },
    // the bomber, a bloater gone bad: within bomb.near of the hero it stops and swells, and after bomb.fuse s blows up (killed before:
    // at once) — bomb.r the blast, bomb.dmg to the zombies in it, bomb.hurt × its bite to the hero
    bomber: {
      rig: 'a_bloater',
      h: 128,
      r: 25,
      hp: 144,
      speed: 64,
      dmg: 12,
      xp: 3,
      mass: 2,
      stride: 26,
      bomb: { near: 120, fuse: 2, r: 150, dmg: 80, hurt: 2.5 },
    },
    armored: {
      rig: 'a_armored',
      h: 104,
      r: 20,
      hp: 280,
      speed: 52,
      dmg: 14,
      xp: 5,
      mass: 3,
      armor: 0.35,
      stride: 32,
      eliteHp: 0.65,
    },
    spitter: { rig: 'a_spitter', h: 96, r: 17, hp: 68, speed: 58, dmg: 8, xp: 3, mass: 1, ranged: true, stride: 32 },
    // the bosses are 3D models (b3d: art/bosses3d/<model>.py, Blender → live/charmesh.js); without one, the cut-out rig. The minibosses:
    // pow — every hurt they deal ×; escort — the elite zombies that come with them and keep round them (sim.js spawnBoss); reach — the
    // radii of their attacks ×; acid — the radii of the pustule's acid (where a ball hits, the puddles) ×
    butcher: {
      rig: 'a_butcher',
      b3d: 'butcher', // REV 28: his own model (art/bosses3d/butcher_fbx.json); the scientist's waits for the lab
      bar: 1.04,
      h: 220,
      r: 46,
      hp: 5280, // REV 28: ×3 (2200 went down too easily); REV 38: −20 % (mission 1 lost too often at the first try)
      speed: 80,
      dmg: 22,
      hit: 15, // REV 38: every hurt of his this much, whenever he comes (his bite and his cleaver; not grown with the run's time)
      xp: 60,
      mass: 30,
      boss: 'mini',
      stride: 60,
      pow: 2,
    },
    // the Savage (REV 28): the suburbs' first miniboss — the first boss's numbers and charge (sim.js DASH), his own model
    savage: {
      rig: 'a_butcher',
      b3d: 'savage',
      bar: 1.04,
      h: 286, // REV 28: 30 % bigger than the first boss (220, r 46), so he reads as one
      r: 60,
      hp: 6600,
      speed: 80,
      dmg: 22,
      xp: 60,
      mass: 30,
      boss: 'mini',
      stride: 60,
      pow: 1.2, // REV 31: his hurts −40 % (2 before: his bite and his charge each took too much)
    },
    // the Lab Tech (REV 29): the lab's first miniboss, the hazmat scientist (his model was the Butcher's); sprays gas (sim.js SPRAY)
    hazmat: {
      rig: 'a_butcher',
      b3d: 'scientist',
      bar: 1.04,
      h: 240,
      r: 46,
      hp: 6600,
      speed: 80,
      dmg: 22,
      xp: 60,
      mass: 30,
      boss: 'mini',
      stride: 60,
      pow: 2,
    },
    // the Chimera (REV 29): the lab's second, a giant test subject; a fan of spikes off his hump (sim.js SPIKES). The acid
    // spitter's numbers, the place he takes in the lab
    subject: {
      rig: 'a_pustule',
      b3d: 'subject',
      bar: 1.04,
      h: 290,
      r: 52,
      hp: 7600,
      speed: 62,
      dmg: 20,
      xp: 80,
      mass: 40,
      boss: 'mini',
      stride: 50,
      pow: 2,
    },
    pustule: {
      rig: 'a_pustule',
      b3d: 'acid',
      bar: 1.04,
      h: 250,
      r: 48,
      hp: 7600,
      acid: 1.5,
      speed: 62,
      dmg: 20,
      xp: 80,
      mass: 40,
      boss: 'mini',
      stride: 50,
      pow: 2,
      escort: ['spitter', 5],
    },
    screamer: {
      rig: 'a_screamer',
      b3d: 'screamer',
      bar: 1.04,
      h: 240,
      r: 40,
      hp: 8820,
      reach: 1.05,
      speed: 90,
      dmg: 20,
      xp: 90,
      mass: 30,
      boss: 'mini',
      stride: 70,
      pow: 2,
      escort: ['armored', 5],
    },
    tank: { rig: 'a_tank', h: 265, r: 84, hp: 14000, speed: 64, dmg: 30, xp: 0, mass: 99, boss: 'boss', stride: 80 },
    // the run's final boss, a huge zombie overgrown with mushrooms: bar — its hp bar over the head (× h); pow — his blows' damage ×;
    // haste — the pauses between his attacks ×; meat — he throws lumps from the start, zombies come out of his body, no jumps;
    // spores — the lumps are mushroom clumps and the bursts leave clouds of spores that burn (puddles of kind 'spore'); reach — the radii
    // of his attacks × (the slam, its wave, the lumps, the spore clouds)
    golem: {
      rig: 'a_golem',
      b3d: 'shroom', // REV 28: the Mycelium Revenant (art/bosses3d/shroom_fbx.json), half as tall again as the old one
      h: 510,
      r: 84,
      hp: 19688,
      reach: 1.05,
      speed: 66,
      dmg: 36,
      xp: 0,
      mass: 99,
      boss: 'boss',
      stride: 80,
      bar: 1.0,
      pow: 1.2,
      haste: 0.85,
      meat: true,
      spores: true,
      cast: true, // REV 28: no slam; he stops and casts his mushroom clumps at marked spots (sim.js CAST)
    },
    // the lab's final boss (REV 29), the Devourer: a mutated heart (art/bosses3d/core_fbx.json) — the final boss's health, walk and
    // blow, his own attacks (sim.js HEART: the arm's wave, below half his health the core's volley)
    heart: {
      rig: 'a_golem',
      b3d: 'core',
      h: 500,
      r: 84,
      hp: 19688,
      speed: 66,
      dmg: 36,
      xp: 0,
      mass: 99,
      boss: 'boss',
      stride: 80,
      bar: 1.0,
    },
  };

  // ---------- meta (lobby) ----------
  D.META = {
    hp: { icon: 'i_medkit', max: 5, price: [200, 400, 700, 1100, 1600] },
    dmg: { icon: 'i_rocket', max: 5, price: [300, 600, 1000, 1500, 2200] },
    speed: { icon: 'i_boots', max: 5, price: [240, 480, 800, 1200, 1700] },
    magnet: { icon: 'i_magnet', max: 5, price: [160, 320, 560, 900, 1300] },
    reroll: { icon: 'i_clover', max: 3, price: [500, 1000, 1800] },
    start: { icon: 'i_crate', max: 3, price: [600, 1400, 2400] },
  };
  // ---------- the survivor rank (the account's level) and weapon mastery ----------
  // Every run — won, lost or quit — earns rank XP (runXp): 1 per 6 s survived, 1 per 10 kills, 50 per boss killed, 200 for the win, 1 per
  // level reached; a whole won run brings ~750. Rank r takes RANK_NEED(r) XP to pass: the 2nd after one decent run, the 13th (the rocket
  // launcher) after ~8 won runs. Each rank-up pays RANK_COINS(the new rank). A gun is bought only from its rank (MAIN[id].rank).
  // Mastery: every kill of a run counts for the gun that was primary in it; MASTERY[l - 1] kills reach level l (1 from the start, 5 the
  // most), and the gun's upgrades (WEAPON_UP) go no higher than its mastery level.
  D.RANK_MAX = 30;
  // The zombies match the account's strength (the loadout a run starts with: the account's upgrades and those of the gun played, as the
  // server replays it). gun: what the gun's upgrades add to its damage (damage × rate × magazine, the magazine counted at magK of its
  // share); the bosses' health × boss · (META dmg × gun)^(boss8/8) — the main gun does most of a boss's killing — and the other zombies'
  // × hp · (META dmg × (1 + share · (gun − 1)))^(hp8/8), the gun counted at its share of their killing (the extra weapons do the rest and
  // only META dmg makes them stronger); the hurt they deal × dmg · def^(dmg8/8) up to 1, def the health and speed the account bought.
  // A new account meets frailer zombies (×0.6) and bosses (×0.5) that bite softer (×0.85); a maxed one tougher ones (×1.25, bosses
  // ×1.39) with their full bite; everything bought still makes the hero stronger, only less so than it used to. (Replaced the newcomer's
  // help below rank 8, which ended in one step: the hardest runs came right after it.)
  // The powers are whole eighths, taken by square roots: the sim may not use Math.pow (its rounding differs between engines)
  D.THREAT = { hp: 0.6, hp8: 6, share: 0.5, boss: 0.5, boss8: 6, dmg: 0.85, dmg8: 4, magK: 0.33 };
  const pow8 = (x, k) => {
    const r = Math.sqrt(Math.sqrt(Math.sqrt(x)));
    let v = 1;
    for (let i = 0; i < k; i++) v *= r;
    return v;
  };
  D.threatOf = (meta, wup) => {
    const m = meta || {},
      u = wup || {},
      W = D.WEAPON_UP,
      T = D.THREAT;
    const md = 1 + 0.08 * (m.dmg || 0),
      gun = (1 + W.dmg.per * (u.dmg || 0)) * (1 + W.rate.per * (u.rate || 0)) * (1 + W.mag.per * T.magK * (u.mag || 0));
    const def = (1 + 0.1 * (m.hp || 0)) * (1 + 0.05 * (m.speed || 0));
    return {
      hp: T.hp * pow8(md * (1 + T.share * (gun - 1)), T.hp8),
      boss: T.boss * pow8(md * gun, T.boss8),
      dmg: Math.min(1, T.dmg * pow8(def, T.dmg8)),
    };
  };
  D.RANK_NEED = (r) => 80 + 40 * (r - 1) + 5 * (r - 1) * (r - 1);
  D.RANK_COINS = (r) => 50 * r;
  D.rankOf = (xp) => {
    let r = 1;
    while (r < D.RANK_MAX && xp >= D.RANK_NEED(r)) {
      xp -= D.RANK_NEED(r);
      r++;
    }
    return { r, into: xp, need: r < D.RANK_MAX ? D.RANK_NEED(r) : 0 };
  };
  D.runXp = (o) => ({
    time: Math.floor((o.t || 0) / 6),
    kills: Math.floor((o.kills || 0) / 10),
    bosses: 50 * (o.bosses || 0),
    win: o.win ? 200 : 0,
    lvl: o.lvl || 0,
  });
  D.MASTERY = [0, 1000, 3000, 7000, 14000]; // a whole run is ~2500 kills: mastery 2 after one, 5 after ~6
  D.masteryOf = (kills) => {
    let l = 1;
    while (l < D.MASTERY.length && kills >= D.MASTERY[l]) l++;
    return l;
  };
  D.WEAPON_UP = {
    dmg: { per: 0.12, price: [180, 375, 630, 975, 1425] },
    rate: { per: 0.08, price: [180, 375, 630, 975, 1425] },
    mag: { per: 0.15, price: [180, 375, 630, 975, 1425] },
  };
  // ---------- the player's face in the lobby: an avatar (live/assets/av_<n>.png, made by gen/avatars.py), a background behind it and a
  // name — dealt at random once (rules.js fillFace), in English (the screens show it in the player's language: ui.js
  // nickName): a word and the avatar's animal ("Angry Rabbit"), now and then a rank ("Captain Otter"). The player can rename
  // (rules.js nick) ----------
  D.AVATARS = [
    { id: 'av_1', animal: ['Fox'] },
    { id: 'av_2', animal: ['Raccoon'] },
    { id: 'av_3', animal: ['Cat', 'Kitty'] },
    { id: 'av_4', animal: ['Panda'] },
    { id: 'av_5', animal: ['Rabbit', 'Bunny'] },
    { id: 'av_6', animal: ['Bear', 'Grizzly'] },
    { id: 'av_7', animal: ['Otter'] },
  ];
  D.AVATAR_BG = [
    ['#ffb35a', '#a8461c'],
    ['#5ec8ff', '#1d4f9e'],
    ['#8ef07a', '#2f7a3a'],
    ['#ff7aa8', '#8a2457'],
    ['#c59bff', '#4a2a8f'],
    ['#ffe06a', '#b0730c'],
    ['#7ff0e0', '#16716b'],
    ['#ff6a5a', '#7d1d18'],
  ];
  D.NICK_ADJ = [
    'Angry',
    'Grumpy',
    'Sneaky',
    'Brave',
    'Rusty',
    'Crazy',
    'Furious',
    'Silent',
    'Lucky',
    'Wild',
    'Iron',
    'Savage',
    'Fearless',
    'Mighty',
    'Toxic',
    'Feral',
    'Reckless',
    'Stormy',
    'Shady',
    'Fierce',
    'Lone',
    'Sleepy',
    'Hungry',
    'Fluffy',
    'Spicy',
    'Turbo',
    'Mad',
    'Rogue',
    'Steel',
    'Dusty',
    'Grim',
    'Jolly',
  ];
  D.NICK_TITLE = ['Captain', 'Sergeant', 'Major', 'Doc', 'Agent', 'General', 'Private', 'Colonel'];

  D.MAPS = [
    { id: 'suburb', img: 'bg_loc_suburb', boss: 'a_golem', open: true, progress: 100, x: 17, y: 72 },
    // the laboratory (live/map_lab.js; its seeds from SIM.LAB0): the same zombies drawn anew (skin: the rig each kind wears there)
    {
      id: 'lab',
      img: 'bg_loc_lab',
      boss: 'a_golem',
      open: true,
      progress: 100,
      x: 35,
      y: 33,
      skin: {
        walker: 'a_lassist',
        runner: 'a_lsubject',
        bloater: 'a_lflask',
        bomber: 'a_lhazmat',
        armored: 'a_lguard',
        spitter: 'a_lchemist',
      },
    },
    { id: 'metro', img: 'bg_loc_metro', boss: 'a_pustule', progress: 40, x: 50.5, y: 72 },
    { id: 'hospital', img: 'bg_loc_hospital', boss: 'a_screamer', progress: 20, x: 66, y: 33 },
    { id: 'military', img: 'bg_loc_military', boss: 'a_tank', progress: 5, x: 83.5, y: 72 },
  ];
  D.ROADMAP = [
    { id: 'maps', base: 1843 },
    { id: 'heroes', base: 1217 },
    { id: 'weapons', base: 1562 },
    { id: 'daily', base: 904 },
    { id: 'endless', base: 1388 },
  ];

  // difficulty: levels come 30 % faster (less XP per level); zombies spawn at 0.8 × 0.7 of the original rate (stream, cap and
  // hordes); acid spitters at half their share (the other half become walkers)
  D.XP_RATE = 1.3;
  D.SPAWN_RATE = 0.56;
  D.SPITTER_RATE = 0.5;
  D.XP_NEED = (lvl) => Math.max(1, Math.floor((10 + lvl * 8 + lvl * lvl * 0.9) / D.XP_RATE));
  D.RUN_LENGTH = 600;
  // playing together (sim.js: two heroes, each its own gun, items and camera): for each hero past the first the zombies come spawn ×
  // more (the stream, the crowd's cap, the hordes; round each hero in turn) — only a few more, the frame rate holds — with hp × more
  // health (the bosses boss ×), a level takes xp × more XP (each hero still levels about as fast as alone: every gem's XP is
  // everyone's), and the coins drop coin × as often (each player is paid all the run's coins). A hero whose health runs out goes down:
  // another standing within revive.r for revive.t s gets it up with revive.hp of its health and revive.ifr s of grace; left lying
  // revive.die s (the time stands while one gets it up) it dies, out of the run for good; all of them down, the run is lost. The new
  // zombies' numbers and health go by the heroes in the run, down or dead too (one falling doesn't make it easier). A card screen left
  // open for pick s takes the first card (the world waits for every one). A chest dropped for one hero (an airdrop, a boss's) is that
  // hero's for lock s after it lands; then anyone's. The raid's things (sim.js killLoot, REV 45): the crowd's and a boss's × the
  // heroes still in the run, a boss's trophy for each of them
  D.COOP = {
    spawn: 0.2,
    hp: 0.55,
    boss: 0.75,
    xp: 0.2,
    coin: 0.72,
    revive: { r: 130, t: 2.5, die: 30, hp: 0.5, ifr: 2 },
    pick: 25,
    lock: 30,
  };

  root.DATA = D;
  if (typeof module !== 'undefined') module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
