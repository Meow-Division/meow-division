// live/sim.js — deterministic survivors run, fixed 120 Hz. Contract (engine.md §6): create / step / at / spawn / respawn /
// outOfPlay / scriptInput, events in S.ev, every reaction lives here. The state is plain JSON (sessionStorage keeps it).
// World: an isometric 2:1 district. Ground coords (gx, gy) ∈ [0, G]²; the screen plane is x = gx − gy + G, y = (gx + gy) / 2.
// Actors move in screen-plane px; distances use the ground metric d² = dx² + (2·dy)² (a ground circle is a 2:1 ellipse).
(function (root) {
  const D = root.DATA || require('./data.js');
  // the campaign's task scripts (live/missions.js, loaded before this file; under node, required when a mission run is
  // made)
  const scripts = () => root.MISSIONS || (typeof module !== 'undefined' ? require('./missions.js') : null);
  const DT = 1 / 120,
    L = 30;
  const REV = 25; // the rules' version: raised with every change to how a run plays (the server deals tickets only to its own)
  // W: the view's width at the least (16:9); a wider window shows more of the world beside, up to MAXW (2.4:1): each hero's p.vw, from
  // its player's input
  const VIEW = { W: 1920, H: 1080, MAXW: 2592 };
  // camera zoom: the world is drawn at ZOOM× (the visible world area is VIEW / ZOOM); the HUD stays at VIEW. Each hero has a camera of
  // its own (p.cam: what its player sees); p: the hero (the one the sim is working for at the moment, S.p, by default)
  const ZOOM = 1.35,
    camW = (S, p = S.p) => (p.vw || VIEW.W) / (S.zoom || 1),
    camH = (S) => VIEW.H / (S.zoom || 1);
  const G = 4800,
    WX = 2 * G,
    WY = G,
    YK = 2;
  const HERO = { h: 74, r: 12, s: 87, gun: 0.6 }; // drawn height, body radius, px per model unit of the 3D penguin, gun size (all 30 % under a zombie's)
  const toS = (gx, gy) => [gx - gy + G, (gx + gy) / 2];
  const toGx = (x, y) => y + (x - G) / 2,
    toGy = (x, y) => y - (x - G) / 2;
  const m2 = (dx, dy) => dx * dx + YK * YK * dy * dy;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  // ---------------- deterministic math ----------------
  // The game's server plays a run again from its inputs (server/server.mjs) and pays what that replay earned, so every browser and the
  // server must reach the very same numbers. The engines may round Math.sin / cos / atan2 / exp / hypot and powers differently; IEEE 754
  // rounds + − × ÷ and sqrt the same everywhere. So the sim uses these instead: fdlibm's kernels written in those operations (~1 ulp).
  const PIO2 = Math.PI / 2,
    INVPIO2 = 6.36619772367581382433e-1,
    PIO2_1 = 1.57079632673412561417,
    PIO2_1T = 6.07710050650619224932e-11;
  let RN = 0; // the quadrant of the last reduction
  const red = (x) => {
    RN = Math.floor(x * INVPIO2 + 0.5);
    return x - RN * PIO2_1 - RN * PIO2_1T;
  };
  const kSin = (x) => {
    const z = x * x,
      v = z * x,
      r =
        8.33333333332248946124e-3 +
        z *
          (-1.98412698298579493134e-4 +
            z * (2.75573137070700676789e-6 + z * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10)));
    return x + v * (-1.66666666666666324348e-1 + z * r);
  };
  const kCos = (x) => {
    const z = x * x,
      r =
        z *
        (4.16666666666666019037e-2 +
          z *
            (-1.38888888888741095749e-3 +
              z *
                (2.48015872894767294178e-5 +
                  z *
                    (-2.75573143513906633035e-7 + z * (2.0875723212981748279e-9 + z * -1.13596475577881948265e-11)))));
    return 1 - (0.5 * z - z * r);
  };
  function dsin(x) {
    const y = red(x),
      n = RN & 3;
    return n === 0 ? kSin(y) : n === 1 ? kCos(y) : n === 2 ? -kSin(y) : -kCos(y);
  }
  function dcos(x) {
    const y = red(x),
      n = RN & 3;
    return n === 0 ? kCos(y) : n === 1 ? -kSin(y) : n === 2 ? -kCos(y) : kSin(y);
  }
  const ATHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
  const ATLO = [
    2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17,
  ];
  const AT = [
    3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
    9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
    4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
  ];
  function datan(x) {
    if (x !== x || x === 0) return x;
    const neg = x < 0;
    let a = neg ? -x : x,
      id = -1;
    if (a > 7.37869762948382e19) return neg ? -PIO2 : PIO2;
    if (a >= 0.4375) {
      if (a < 1.1875) {
        if (a < 0.6875) {
          id = 0;
          a = (2 * a - 1) / (2 + a);
        } else {
          id = 1;
          a = (a - 1) / (a + 1);
        }
      } else if (a < 2.4375) {
        id = 2;
        a = (a - 1.5) / (1 + 1.5 * a);
      } else {
        id = 3;
        a = -1 / a;
      }
    }
    const z = a * a,
      w = z * z,
      s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10]))))),
      s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    const r = id < 0 ? a - a * (s1 + s2) : ATHI[id] - (a * (s1 + s2) - ATLO[id] - a);
    return neg ? -r : r;
  }
  function datan2(y, x) {
    if (x !== x || y !== y) return NaN;
    if (y === 0) return x > 0 || (x === 0 && 1 / x > 0) ? y : 1 / y > 0 ? Math.PI : -Math.PI;
    if (x === 0) return y > 0 ? PIO2 : -PIO2;
    const a = datan(Math.abs(y / x));
    return x > 0 ? (y > 0 ? a : -a) : y > 0 ? Math.PI - a : a - Math.PI;
  }
  const LN2HI = 6.9314718036912381649e-1,
    LN2LO = 1.90821492927058770002e-10,
    INVLN2 = 1.442695040888963387;
  const POW2 = new Float64Array(2098);
  {
    let v = 1;
    for (let k = 0; k <= 1023; k++) {
      POW2[1074 + k] = v;
      v *= 2;
    }
    v = 1;
    for (let k = 0; k <= 1074; k++) {
      POW2[1074 - k] = v;
      v /= 2;
    }
  }
  function dexp(x) {
    if (x !== x) return x;
    if (x > 709.782712893384) return Infinity;
    if (x < -745.1332191019411) return 0;
    const k = Math.floor(x * INVLN2 + 0.5),
      hi = x - k * LN2HI,
      lo = k * LN2LO,
      r = hi - lo,
      t = r * r;
    const c =
      r -
      t *
        (1.66666666666666019037e-1 +
          t *
            (-2.77777777770155933842e-3 +
              t * (6.61375632143793436117e-5 + t * (-1.6533902205465251539e-6 + t * 4.13813679705723846039e-8))));
    return (1 - (lo - (r * c) / (2 - c) - hi)) * POW2[1074 + k];
  }
  const KD9 = dexp(-DT * 9),
    KD14 = dexp(-DT * 14),
    KD35 = dexp(-DT * 3.5);
  const dhypot = (a, b) => Math.sqrt(a * a + b * b),
    sq = (v) => v * v;

  // ---------------- deterministic RNG in the state ----------------
  function rnd(S) {
    let t = (S.rs = (S.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (S, a, b) => a + rnd(S) * (b - a);
  const rpick = (S, arr) => arr[Math.floor(rnd(S) * arr.length)];
  function mulberry(seed) {
    let s = seed >>> 0;
    const f = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.r = (a, b) => a + f() * (b - a);
    f.i = (a, b) => Math.floor(a + f() * (b - a + 1));
    f.p = (arr) => arr[Math.floor(f() * arr.length)];
    return f;
  }

  // =====================================================================================================================
  // LEVEL (static data, generated from the seed and cached; the scene reads it, never duplicates it)
  // =====================================================================================================================
  // props: w = drawn width (view px), fw × fh = ground footprint (along gx × gy) for the unflipped sprite, flip swaps them; mat: what
  // a shot strikes (cars metal, buildings brick) — those stop shots, the lower props are flown over
  const PROP = {
    iso_barrier: { w: 200, fw: 36, fh: 158 },
    iso_fence: { w: 320, fw: 24, fh: 290 },
    iso_block: { w: 190, fw: 38, fh: 148 },
    iso_wall: { w: 380, fw: 40, fh: 334 },
    iso_crate: { w: 112, fw: 50, fh: 50, hp: 26, crate: 1 },
    iso_metalcrate: { w: 100, fw: 44, fh: 44, hp: 40, crate: 1 },
    iso_locker: { w: 74, fw: 32, fh: 32 },
    iso_car_red: { w: 340, fw: 232, fh: 104, mat: 'metal' },
    iso_car_blue: { w: 330, fw: 226, fh: 100, mat: 'metal' },
    iso_van: { w: 380, fw: 258, fh: 117, mat: 'metal' },
    iso_bus: { w: 480, fw: 340, fh: 126, mat: 'metal' },
    iso_dumpster: { w: 170, fw: 98, fh: 64 },
    iso_sign: { w: 270, fw: 40, fh: 200 },
    iso_debris: { w: 180, fw: 74, fh: 74 },
    p_barrel: { w: 50, fw: 26, fh: 26, hp: 18, barrel: 1 },
    p_cone: { w: 32, fw: 12, fh: 12 },
    p_obarrel: { w: 46, fw: 22, fh: 22 },
    p_lamp: { w: 64, fw: 12, fh: 12, lamp: 1 },
    iso_lamp: { w: 128, fw: 16, fh: 16, lamp: 1 },
    iso_bench: { w: 190, fw: 70, fh: 28 },
    bld_house: { w: 600, fw: 300, fh: 300, bld: 1, mat: 'brick' },
    bld_gas: { w: 640, fw: 320, fh: 320, bld: 1, mat: 'brick' },
    bld_warehouse: { w: 640, fw: 320, fh: 320, bld: 1, mat: 'brick' },
    bld_garage: { w: 420, fw: 210, fh: 210, bld: 1, mat: 'brick' },
    bld_shop: { w: 420, fw: 210, fh: 210, bld: 1, mat: 'brick' },
    bld_busstop: { w: 340, fw: 170, fh: 120, bld: 1, mat: 'metal' },
    bld_booth: { w: 280, fw: 140, fh: 140, bld: 1, mat: 'brick' },
    // the user's map set (art/refs/map, gen/mapslice.py): walls, fences and the sign run along gx, barriers, the broken slab and
    // the cars along gy (unflipped)
    iso_cwall_cat: { w: 300, fw: 250, fh: 36, mat: 'brick' },
    iso_cwall: { w: 300, fw: 250, fh: 36, mat: 'brick' },
    iso_ccorner: { w: 170, fw: 100, fh: 60, mat: 'brick' },
    iso_sign2: { w: 220, fw: 170, fh: 22 },
    iso_mesh: { w: 300, fw: 270, fh: 18 },
    iso_gate: { w: 220, fw: 185, fh: 18 },
    iso_rail: { w: 250, fw: 220, fh: 16 },
    iso_ruin: { w: 320, fw: 230, fh: 70, mat: 'brick' },
    iso_pillar: { w: 95, fw: 50, fh: 44, mat: 'brick' },
    iso_lamp2: { w: 72, fw: 16, fh: 16, lamp: 1 },
    iso_lamp3: { w: 110, fw: 16, fh: 16, lamp: 1 },
    iso_redbin: { w: 141, fw: 80, fh: 60, mat: 'metal' },
    iso_trash: { w: 71, fw: 38, fh: 38, mat: 'metal' },
    iso_tbarrel: { w: 54, fw: 26, fh: 26 },
    iso_crate2: { w: 121, fw: 62, fh: 62, hp: 26, crate: 1 },
    iso_crate3: { w: 112, fw: 62, fh: 48, hp: 26, crate: 1 },
    iso_stool: { w: 74, fw: 38, fh: 38, hp: 12, crate: 1 },
    iso_cardboard: { w: 84, fw: 44, fh: 44, hp: 10, crate: 1 },
    iso_barrier2: { w: 191, fw: 36, fh: 158 },
    iso_barrier3: { w: 191, fw: 36, fh: 158 },
    iso_slab: { w: 168, fw: 44, fh: 140 },
    iso_car_white: { w: 340, fw: 104, fh: 220, mat: 'metal' },
    iso_car_red2: { w: 330, fw: 100, fh: 214, mat: 'metal' },
    iso_suv: { w: 350, fw: 108, fh: 226, mat: 'metal' },
    iso_car_sedan: { w: 320, fw: 98, fh: 208, mat: 'metal' },
    // the laboratory's own (art/lab: gen/labart.py); long ones run along gx unflipped
    lb_tank: { w: 330, fw: 200, fh: 200, mat: 'metal' },
    lb_tent: { w: 300, fw: 154, fh: 116 },
    lb_stretcher: { w: 150, fw: 80, fh: 55 },
    lb_flood: { w: 70, fw: 22, fh: 22, lamp: 1 },
    lb_desk: { w: 170, fw: 113, fh: 40 },
    lb_cart: { w: 90, fw: 50, fh: 34 },
    lb_biobarrel: { w: 56, fw: 26, fh: 26 },
    lb_iv: { w: 50, fw: 16, fh: 16 },
    lb_shelf: { w: 330, fw: 231, fh: 66, mat: 'metal' },
    lb_pallet: { w: 130, fw: 63, fh: 54 },
    lb_forklift: { w: 210, fw: 140, fh: 70, mat: 'metal' },
    lb_cabinet: { w: 90, fw: 42, fh: 40 },
    lb_servers: { w: 300, fw: 208, fh: 62, mat: 'metal' },
    lb_server: { w: 96, fw: 52, fh: 52, mat: 'metal' },
    lb_console: { w: 210, fw: 141, fh: 48 },
    lb_pipes: { w: 220, fw: 150, fh: 50, mat: 'metal' },
    lb_tube: { w: 92, fw: 52, fh: 52 },
    lb_tubebroken: { w: 120, fw: 58, fh: 58 },
    lb_optable: { w: 200, fw: 126, fh: 54 },
    lb_generator: { w: 420, fw: 263, fh: 115, mat: 'metal' },
    lb_planter: { w: 330, fw: 238, fh: 59 },
    lb_pots: { w: 120, fw: 60, fh: 56 },
    lb_bigplant: { w: 160, fw: 64, fh: 64 },
    lb_growlight: { w: 80, fw: 20, fh: 20, lamp: 1 },
    lb_cell: { w: 340, fw: 194, fh: 112, mat: 'metal' },
    lb_guarddesk: { w: 200, fw: 131, fh: 49 },
    lb_suits: { w: 200, fw: 144, fh: 36 },
    lb_vending: { w: 86, fw: 46, fh: 40, mat: 'metal' },
    lb_table: { w: 260, fw: 146, fh: 88 },
    lb_counter: { w: 330, fw: 235, fh: 62 },
    lb_shower: { w: 150, fw: 100, fh: 100 },
    lb_coffee: { w: 84, fw: 42, fh: 36 },
    // the second set (gen/labart2.py)
    lb_chembench: { w: 260, fw: 187, fh: 54 },
    lb_cryopod: { w: 240, fw: 177, fh: 39, mat: 'metal' },
    lb_jars: { w: 130, fw: 90, fh: 27 },
    lb_analyzer: { w: 110, fw: 60, fh: 39 },
    lb_fumehood: { w: 150, fw: 94, fh: 41, mat: 'metal' },
    lb_freezer: { w: 100, fw: 52, fh: 38, mat: 'metal' },
    lb_cage: { w: 170, fw: 87, fh: 66 },
    lb_wheelchair: { w: 90, fw: 50, fh: 31 },
    lb_crates: { w: 190, fw: 85, fh: 86, mat: 'brick' },
    lb_screen: { w: 150, fw: 120, fh: 26 },
    lb_oxygen: { w: 130, fw: 91, fh: 30 },
    lb_spool: { w: 120, fw: 64, fh: 56 },
    lb_drums: { w: 130, fw: 62, fh: 56, mat: 'metal' },
    lb_palletjack: { w: 150, fw: 88, fh: 47 },
    lb_fueltank: { w: 340, fw: 188, fh: 118, mat: 'metal' },
    lb_transformer: { w: 200, fw: 130, fh: 50, mat: 'metal' },
    lb_aircon: { w: 190, fw: 55, fh: 116, mat: 'metal' },
    lb_ups: { w: 200, fw: 125, fh: 55, mat: 'metal' },
    lb_fallenrack: { w: 200, fw: 151, fh: 29, mat: 'metal' },
    lb_levers: { w: 120, fw: 60, fh: 48 },
    lb_hydro: { w: 300, fw: 210, fh: 60 },
    lb_barrow: { w: 120, fw: 90, fh: 34 },
    lb_watertank: { w: 140, fw: 80, fh: 64, mat: 'metal' },
    lb_cactus: { w: 150, fw: 73, fh: 62 },
    lb_cafetable: { w: 170, fw: 100, fh: 90 },
    lb_watercooler: { w: 60, fw: 36, fh: 34 },
    lb_wastebins: { w: 150, fw: 50, fh: 110 },
    lb_lockers: { w: 200, fw: 150, fh: 40, mat: 'metal' },
    // (the second set's end) NEAR Base's own (footprints measured by gen/baseart.py)
    lb_workbench: { w: 260, fw: 180, fh: 54, mat: 'metal' },
    lb_target: { w: 110, fw: 60, fh: 40 },
    lb_stall: { w: 320, fw: 235, fh: 53 },
    lb_radio: { w: 200, fw: 130, fh: 50, mat: 'metal' },
    np_walt: { w: 84, fw: 40, fh: 40 },
    np_nova: { w: 74, fw: 38, fh: 38 },
    lb_rubble: { w: 210, fw: 150, fh: 70, mat: 'brick' },
    lb_sandbags: { w: 220, fw: 70, fh: 128, mat: 'brick' },
  };
  // the lab's walls are cut into pieces WALL_M long (gen/labmap.mjs lays them on that grid); each piece, each post and each piece of
  // the void round the walls is a prop of its own with its own footprint (level below): 'lb_wallx' / 'lb_wally' run along gx / gy
  const EDGE = 110,
    WALL_M = 120;
  const levels = {};
  // the levels: the town (the map editor's live/map.js) and the laboratory (live/map_lab.js, made by gen/labmap.mjs), both loaded before
  // this file on the page and required here under node. A level's seed says which: the lab's from LAB0 up (the server deals each map
  // its own seeds, so a ticket, a replay, a watched run and a saved one carry the map in the seed they already have)
  let MAP = root.MAP || (typeof module !== 'undefined' ? require('./map.js') : null);
  let MAP_LAB = root.MAP_LAB || (typeof module !== 'undefined' ? require('./map_lab.js') : null);
  // NEAR Base (live/map_base.js, laid out like the lab: walls, posts, floors): the hub between runs, played on the
  // page alone and never sent to the server, so the server's rules files don't carry it; under node it is read only
  // when its level is first built (tests)
  let MAP_BASE = root.MAP_BASE || null;
  const baseMap = () => MAP_BASE || (MAP_BASE = typeof module !== 'undefined' ? require('./map_base.js') : null);
  // the NEAR AI office (live/map_office.js, mission 1's): laid out as the town is (roads, areas, props, plants) with
  // the office building's roof (a prop that hides while a hero is under it), the void round the play area and the
  // mission's gates (walls of nothing its script opens); under node read when its level is first built
  let MAP_OFFICE = root.MAP_OFFICE || null;
  const officeMap = () =>
    MAP_OFFICE || (MAP_OFFICE = typeof module !== 'undefined' ? require('./map_office.js') : null);
  const LAB0 = 100,
    OFFICE = 800, // the office's one seed (mission 1 only)
    BASE = 900, // the hub's own seed (the server deals the lab's from LAB0 to LAB0 + 5, the town's under it)
    mapOf = (seed) =>
      seed === BASE && baseMap()
        ? 'base'
        : seed === OFFICE && officeMap()
          ? 'office'
          : seed >= LAB0 && MAP_LAB
            ? 'lab'
            : 'city';
  // the editor (live/editor.js) swaps its map in (id 'lab': the laboratory's, 'base': NEAR Base's, 'office': the
  // office's): every level is built again from it
  function setMap(m, id) {
    if (id === 'lab') MAP_LAB = m;
    else if (id === 'base') MAP_BASE = m;
    else if (id === 'office') MAP_OFFICE = m;
    else MAP = m;
    for (const k in levels) delete levels[k];
  }
  // a value in [0, 1) from a ground point and a key (a plant's own lean and sway phase)
  const hash01 = (gx, gy, k) =>
    mulberry(Math.imul(Math.round(gx) + 7919, 73856093) ^ Math.imul(Math.round(gy) + 104729, 19349663) ^ k)();

  function level(seed) {
    if (levels[seed]) return levels[seed];
    const R = mulberry(seed),
      kind = mapOf(seed),
      lab = kind === 'lab' || kind === 'base',
      M = kind === 'base' ? MAP_BASE : kind === 'lab' ? MAP_LAB : kind === 'office' ? MAP_OFFICE : MAP;
    // (the base is indoors as the lab is: its floors, walls and lamps are drawn the lab's way, map 'lab'; base marks
    // it. The office is drawn as the town is, map 'city'; office marks it)
    const LV = {
      seed,
      map: lab ? 'lab' : 'city',
      base: kind === 'base',
      office: kind === 'office',
      spawn: M.spawn.slice(),
      roads: [],
      side: [],
      lots: [],
      plazas: [],
      dirt: [],
      cracks: [],
      grass: [],
      moss: [],
      tints: [],
      props: [],
      trees: [],
      bushes: [],
      decor: [],
      cols: [],
      lamps: [],
      destr: [],
      floors: (M.floors || []).map(([x0, y0, x1, y1, k]) => ({ x0, y0, x1, y1, k })),
      lights: M.lights || [],
      starts: M.starts || null,
      marks: M.marks || [],
      walled: !!M.walls,
      hall: M.hall || null,
      gas: M.gas
        ? { at: M.gas.at, fill: M.gas.fill, rooms: M.gas.rooms.map(([x0, y0, x1, y1, d]) => ({ x0, y0, x1, y1, d })) }
        : null,
    };
    LV.inPlaza = (gx, gy, pad = 0) =>
      LV.plazas.some((r) => gx > r.x0 - pad && gx < r.x1 + pad && gy > r.y0 - pad && gy < r.y1 + pad);
    // roads (each runs along its longer side) with a sidewalk either side; paved areas: yards ('tiles'), plazas, bare earth
    for (const [x0, y0, x1, y1, sw] of M.roads) {
      const ax = y1 - y0 >= x1 - x0 ? 'gy' : 'gx';
      LV.roads.push({ x0, y0, x1, y1, ax });
      if (sw > 0)
        LV.side.push(
          ...(ax === 'gy'
            ? [
                { x0: x0 - sw, y0, x1: x0, y1 },
                { x0: x1, y0, x1: x1 + sw, y1 },
              ]
            : [
                { x0, y0: y0 - sw, x1, y1: y0 },
                { x0, y0: y1, x1, y1: y1 + sw },
              ]),
        );
    }
    for (const [x0, y0, x1, y1, mat] of M.areas)
      (mat === 'plaza' ? LV.plazas : LV.lots).push({ x0, y0, x1, y1, mat: mat === 'dirt' ? 'dirt' : 'concrete' });
    // props: w = drawn width, the footprint is the collider. dir: its turn about its own axis in quarters (0..3): an odd one is the
    // picture mirrored and the footprint's sides swapped (a quarter turn), 2 and 3 its back (the picture <n>_b where there is one; the
    // footprint as 0 and 1: a half turn keeps it)
    for (const [n, gx, gy, dir] of M.props) {
      const d = PROP[n];
      if (!d) continue;
      const flip = dir & 1;
      const fw = flip ? d.fh : d.fw,
        fh = flip ? d.fw : d.fh,
        x0 = gx - fw / 2,
        y0 = gy - fh / 2,
        x1 = gx + fw / 2,
        y1 = gy + fh / 2,
        [sx, sy] = toS(gx, gy);
      const p = {
        i: LV.props.length,
        n,
        gx,
        gy,
        x: sx,
        y: sy,
        fy: toS(x1, y1)[1],
        w: d.w,
        flip: !!flip,
        back: !!(dir & 2),
        fw,
        fh,
        hp: d.hp || 0,
        barrel: !!d.barrel,
        crate: !!d.crate,
        bld: !!d.bld,
        lamp: !!d.lamp,
        mat: d.mat || '',
      };
      p.col = { x0, y0, x1, y1, p: p.i };
      // (a roof stops nothing: the heroes walk in under it, and the scene hides it while one is there)
      if (d.roof) p.roof = 1;
      else LV.cols.push(p.col);
      LV.props.push(p);
      if (p.hp) {
        p.di = LV.destr.length;
        LV.destr.push(p.i);
      }
      if (p.lamp) LV.lamps.push(p.i);
    }
    // the lab: its walls cut into pieces, the posts where they meet and beside the doors, and the void round them (never drawn)
    if (M.walls)
      for (const [x0, y0, x1, y1] of M.walls) {
        const ax = x1 - x0 >= y1 - y0,
          a0 = ax ? x0 : y0,
          len = ax ? x1 - x0 : y1 - y0,
          n = Math.max(1, Math.round(len / WALL_M));
        for (let i = 0; i < n; i++) {
          const a = a0 + (len * i) / n,
            b = a0 + (len * (i + 1)) / n;
          solid(LV, ax ? 'lb_wallx' : 'lb_wally', ax ? a : x0, ax ? y0 : a, ax ? b : x1, ax ? y1 : b, {
            wall: 1,
            v: Math.floor(hash01(a, ax ? y0 : x0, 5) * 4),
          });
        }
      }
    if (M.posts)
      for (const [gx, gy, door] of M.posts)
        solid(LV, 'lb_post', gx - 30, gy - 30, gx + 30, gy + 30, { post: 1, door: !!door });
    if (M.void) for (const [x0, y0, x1, y1] of M.void) solid(LV, 'void', x0, y0, x1, y1, { hide: 1 });
    // a mission's gates [x0, y0, x1, y1, name]: walls of nothing (never drawn, shots fly through) until its script
    // opens them (S.mis.open); the zombies' paths leave them out
    if (M.gates)
      for (const [x0, y0, x1, y1, g] of M.gates) solid(LV, 'void', x0, y0, x1, y1, { hide: 1, gate: g, mat: '' });
    for (const [n, gx, gy, w, flip] of M.trees) {
      const [x, y] = toS(gx, gy);
      LV.trees.push({
        n,
        gx,
        gy,
        x,
        y,
        w,
        rot: (hash01(gx, gy, 1) - 0.5) * 0.5,
        flip: !!flip,
        ph: hash01(gx, gy, 2) * 6.28,
      });
    }
    for (const [n, gx, gy, w, flip] of M.bushes) {
      const [x, y] = toS(gx, gy);
      LV.bushes.push({ n, gx, gy, x, y, w, flip: !!flip, ph: hash01(gx, gy, 3) * 6.28 });
    }
    if (lab)
      for (const d of M.decor) LV.decor.push({ k: d[0], gx: d[1], gy: d[2], s: d[3], a: d[4], e: d.slice(5) }); // (the lab's: painted by ground.js paintLab)
    else
      for (const d of M.decor)
        LV.decor.push(
          d[0] === 'manhole'
            ? { k: d[0], gx: d[1], gy: d[2] }
            : d[0] === 'stain'
              ? { k: d[0], gx: d[1], gy: d[2], s: d[3], a: d[4] }
              : d[0] === 'graf'
                ? { k: d[0], gx: d[1], gy: d[2], img: d[3], s: d[4], a: d[5] }
                : d[0] === 'line' || d[0] === 'hatch'
                  ? { k: d[0], gx: d[1], gy: d[2], s: d[3], a: d[4], e: d.slice(5) }
                  : { k: d[0], gx: d[1], gy: d[2], s: d[3] },
        );
    // the ground's own variety (scene.js paints it): cracks in the asphalt, bare and flowered patches, moss on the plazas, tints, grass beds
    for (let i = 0; i < 90 && LV.roads.length; i++) {
      const r = R.p(LV.roads),
        v = r.ax === 'gy',
        along = v ? R.r(r.y0, r.y1) : R.r(r.x0, r.x1),
        across = v ? R.r(r.x0 + 30, r.x1 - 30) : R.r(r.y0 + 30, r.y1 - 30);
      LV.cracks.push(
        v ? [across, along, R.r(60, 150), R.r(50, 110), R()] : [along, across, R.r(60, 150), R.r(50, 110), R()],
      );
    }
    for (let i = 0; i < 70; i++) LV.dirt.push([R.r(150, G - 150), R.r(150, G - 150), R.r(70, 180), R.r(60, 140), R()]);
    for (const q of LV.plazas)
      for (let i = 0, n = Math.round(((q.x1 - q.x0) * (q.y1 - q.y0)) / 7900); i < n; i++)
        LV.moss.push([R.r(q.x0, q.x1), R.r(q.y0, q.y1), R.r(12, 52), R.r(8, 30), R()]);
    for (let i = 0; i < 420; i++) LV.tints.push([R.r(0, G), R.r(0, G), R.r(150, 410), R() < 0.6 ? 1 : 0]);
    for (let i = 0; i < 160; i++) LV.grass.push([R.r(150, G - 150), R.r(150, G - 150), R.r(40, 110), R.r(30, 90), R()]);
    // balloon bunches tied to the benches and the plazas' lamps (own RNG)
    {
      const R3 = mulberry(seed * 131 + 7);
      LV.balloons = [];
      const ties = lab
        ? []
        : LV.props
            .filter((o) => o.n === 'iso_bench' || (o.lamp && LV.inPlaza(o.gx, o.gy, 200)))
            .map((o) => [o.x, o.y, o.lamp ? 6 : 50]); // (none indoors)
      for (const [x, y, spread] of ties) {
        if (R3() < 0.2) continue;
        for (let i = 0, k = R3.i(2, 4); i < k; i++)
          LV.balloons.push({
            id: LV.balloons.length,
            x: x + R3.r(-spread, spread),
            y: y + R3.r(-4, 4),
            h: R3.r(72, 124),
            ph: R3() * TAU,
            c: Math.floor(R3() * 6),
          });
      }
    }
    buildGrid(LV);
    buildNav(LV);
    levels[seed] = LV;
    return LV;
  }

  // a solid of the lab's (a wall piece, a post, the void): a prop with a footprint of its own, stopping shots (mat)
  function solid(LV, n, x0, y0, x1, y1, o) {
    const gx = (x0 + x1) / 2,
      gy = (y0 + y1) / 2,
      [sx, sy] = toS(gx, gy);
    const p = Object.assign(
      {
        i: LV.props.length,
        n,
        gx,
        gy,
        x: sx,
        y: sy,
        fy: toS(x1, y1)[1],
        w: x1 - x0 + y1 - y0,
        flip: false,
        fw: x1 - x0,
        fh: y1 - y0,
        hp: 0,
        barrel: false,
        crate: false,
        bld: false,
        lamp: false,
        mat: 'brick',
      },
      o,
    );
    p.col = { x0, y0, x1, y1, p: p.i };
    LV.cols.push(p.col);
    LV.props.push(p);
    return p;
  }
  // static collision grid (ground coords)
  const SGC = 240;
  function buildGrid(LV) {
    const n = Math.ceil(G / SGC) + 1;
    LV.gn = n;
    LV.grid = Array.from({ length: n * n }, () => []);
    LV.cols.forEach((c, i) => {
      for (let y = clamp(Math.floor(c.y0 / SGC), 0, n - 1); y <= clamp(Math.floor(c.y1 / SGC), 0, n - 1); y++)
        for (let x = clamp(Math.floor(c.x0 / SGC), 0, n - 1); x <= clamp(Math.floor(c.x1 / SGC), 0, n - 1); x++)
          LV.grid[y * n + x].push(i);
    });
  }
  // a mission's gate opened by its script (sim.js level: M.gates)
  const gateOpen = (S, g) => !!S.mis && S.mis.open.includes(g);
  // push a body (screen-plane x, y; ground-metric radius r) out of solid footprints; dead destructibles are skipped
  function collide(S, LV, o, r) {
    const rg = r * 0.7071;
    let gx = toGx(o.x, o.y),
      gy = toGy(o.x, o.y),
      hit = false;
    const n = LV.gn,
      cx = clamp(Math.floor(gx / SGC), 0, n - 1),
      cy = clamp(Math.floor(gy / SGC), 0, n - 1);
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(n - 1, cy + 1); yy++)
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(n - 1, cx + 1); xx++) {
        const list = LV.grid[yy * n + xx];
        for (let k = 0; k < list.length; k++) {
          const c = LV.cols[list[k]],
            p = LV.props[c.p];
          if (p.hp && S.pd[p.di] <= 0) continue;
          if (p.gate && gateOpen(S, p.gate)) continue;
          const nx = clamp(gx, c.x0, c.x1),
            ny = clamp(gy, c.y0, c.y1),
            dx = gx - nx,
            dy = gy - ny,
            d2 = dx * dx + dy * dy;
          if (d2 >= rg * rg) continue;
          hit = true;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2),
              k2 = (rg - d) / d;
            gx += dx * k2;
            gy += dy * k2;
          } else {
            const l = gx - c.x0,
              rgt = c.x1 - gx,
              t = gy - c.y0,
              b = c.y1 - gy,
              mm = Math.min(l, rgt, t, b);
            if (mm === l) gx = c.x0 - rg;
            else if (mm === rgt) gx = c.x1 + rg;
            else if (mm === t) gy = c.y0 - rg;
            else gy = c.y1 + rg;
          }
        }
      }
    gx = clamp(gx, EDGE, G - EDGE);
    gy = clamp(gy, EDGE, G - EDGE);
    o.x = gx - gy + G;
    o.y = (gx + gy) / 2;
    return hit;
  }
  function blockedG(S, LV, gx, gy, pad) {
    if (gx < EDGE || gy < EDGE || gx > G - EDGE || gy > G - EDGE) return true;
    const n = LV.gn,
      list = LV.grid[clamp(Math.floor(gy / SGC), 0, n - 1) * n + clamp(Math.floor(gx / SGC), 0, n - 1)];
    for (const i of list) {
      const c = LV.cols[i],
        p = LV.props[c.p];
      if (p.hp && S && S.pd[p.di] <= 0) continue;
      if (p.gate && (!S || gateOpen(S, p.gate))) continue; // (the zombies' paths: as if open)
      if (gx > c.x0 - pad && gx < c.x1 + pad && gy > c.y0 - pad && gy < c.y1 + pad) return true;
    }
    return false;
  }
  const blockedS = (S, LV, x, y, pad) => blockedG(S, LV, toGx(x, y), toGy(x, y), pad);
  // shots against cars and buildings: a shot flies z px above the ground (screen px), so the ground under it is z px lower on screen;
  // it stops where that point enters a footprint with a material (PROP.mat). solidAt: that prop or null; clearShot: no such prop
  // between two ground points (screen px), sampled every 24 px (the narrowest car is about 100 deep)
  function solidAt(LV, gx, gy) {
    const n = LV.gn,
      list = LV.grid[clamp(Math.floor(gy / SGC), 0, n - 1) * n + clamp(Math.floor(gx / SGC), 0, n - 1)];
    for (let k = 0; k < list.length; k++) {
      const c = LV.cols[list[k]],
        o = LV.props[c.p];
      if (o.mat && gx > c.x0 && gx < c.x1 && gy > c.y0 && gy < c.y1) return o;
    }
    return null;
  }
  const shotStop = (LV, x, y, z) => solidAt(LV, toGx(x, y + z), toGy(x, y + z));
  function clearShot(LV, x0, y0, x1, y1) {
    const n = Math.ceil(dhypot(x1 - x0, y1 - y0) / 24);
    for (let i = 1; i < n; i++) {
      const t = i / n,
        x = x0 + (x1 - x0) * t,
        y = y0 + (y1 - y0) * t;
      if (solidAt(LV, toGx(x, y), toGy(x, y))) return false;
    }
    return true;
  }

  // flow field toward the player on a coarse ground grid (BFS); derived data, rebuilt on a schedule
  const NC = 48,
    NN = Math.ceil(G / NC);
  const nav = {
    blocked: new Uint8Array(NN * NN),
    dist: new Int32Array(NN * NN),
    q: new Int32Array(NN * NN),
    fx: new Float32Array(NN * NN),
    fy: new Float32Array(NN * NN),
    seed: -1,
    at: -1,
  };
  function buildNav(LV) {
    LV.navBlocked = new Uint8Array(NN * NN);
    for (let cy = 0; cy < NN; cy++)
      for (let cx = 0; cx < NN; cx++)
        LV.navBlocked[cy * NN + cx] = blockedG(null, LV, cx * NC + NC / 2, cy * NC + NC / 2, 8) ? 1 : 0;
  }
  const DIRX = new Float64Array(9),
    DIRY = new Float64Array(9);
  for (let by = -1; by <= 1; by++)
    for (let bx = -1; bx <= 1; bx++) {
      const sx = bx - by,
        sy = (bx + by) / 2,
        m = dhypot(sx, sy) || 1;
      DIRX[(by + 1) * 3 + bx + 1] = sx / m;
      DIRY[(by + 1) * 3 + bx + 1] = sy / m;
    }
  // S.navP: the heroes the zombies go for, [x, y] each one after another (two heroes: the field leads to the nearer)
  function updateFlow(S, LV) {
    const B = LV.navBlocked,
      Dd = nav.dist,
      Q = nav.q,
      P = S.navP,
      cells = [];
    Dd.fill(1 << 30);
    for (let k = 0; k < P.length; k += 2) {
      const pgx = toGx(P[k], P[k + 1]),
        pgy = toGy(P[k], P[k + 1]);
      cells.push(clamp(Math.floor(pgy / NC), 0, NN - 1) * NN + clamp(Math.floor(pgx / NC), 0, NN - 1));
    }
    const s = cells.join();
    if (nav.lv === LV && nav.s === s) {
      nav.seed = LV.seed;
      nav.at = S.navAt;
      nav.key = P.join();
      return;
    }
    nav.lv = LV;
    nav.s = s;
    let h = 0,
      tl = 0;
    for (const c of cells)
      if (Dd[c]) {
        Dd[c] = 0;
        Q[tl++] = c;
      }
    while (h < tl) {
      const i = Q[h++],
        cx = i % NN,
        d = Dd[i] + 1;
      if (cx > 0 && !B[i - 1] && Dd[i - 1] > d) {
        Dd[i - 1] = d;
        Q[tl++] = i - 1;
      }
      if (cx < NN - 1 && !B[i + 1] && Dd[i + 1] > d) {
        Dd[i + 1] = d;
        Q[tl++] = i + 1;
      }
      if (i >= NN && !B[i - NN] && Dd[i - NN] > d) {
        Dd[i - NN] = d;
        Q[tl++] = i - NN;
      }
      if (i < NN * (NN - 1) && !B[i + NN] && Dd[i + NN] > d) {
        Dd[i + NN] = d;
        Q[tl++] = i + NN;
      }
    }
    for (let i = 0; i < NN * NN; i++) {
      const cx = i % NN,
        cy = (i / NN) | 0;
      let best = Dd[i],
        bx = 0,
        by = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= NN || ny >= NN) continue;
          const j = ny * NN + nx;
          if (B[j] || (dx && dy && (B[cy * NN + nx] || B[ny * NN + cx]))) continue;
          const v = Dd[j] + (dx && dy ? 0.4 : 0);
          if (v < best) {
            best = v;
            bx = dx;
            by = dy;
          }
        }
      // ground step → screen direction: x = dgx − dgy, y = (dgx + dgy) / 2
      const q = (by + 1) * 3 + bx + 1;
      nav.fx[i] = DIRX[q];
      nav.fy[i] = DIRY[q];
    }
    nav.seed = LV.seed;
    nav.at = S.navAt;
    nav.key = P.join();
  }
  const flowIdx = (x, y) =>
    clamp(Math.floor(toGy(x, y) / NC), 0, NN - 1) * NN + clamp(Math.floor(toGx(x, y) / NC), 0, NN - 1);
  // the lab's gas: before its final boss the rooms round the hall fill with it one after another (LV.gas: from at s before the boss,
  // each room after its delay d, full in fill s); whoever stands in it chokes (choke: GAS_DMG × its thickness every GAS_TICK, through any
  // armour), so the heroes go to the hall, where the boss comes. gasAt: the thickness (0..1) at a screen point
  const GAS_TICK = 0.5,
    GAS_DMG = 4;
  const gasT0 = (LV) => BOSS_AT[BOSS_AT.length - 1] + LV.gas.at;
  function gasAt(S, LV, x, y) {
    if (!LV.gas) return 0;
    const t = S.t - gasT0(LV);
    if (t <= 0) return 0;
    const gx = toGx(x, y),
      gy = toGy(x, y);
    for (const r of LV.gas.rooms)
      if (gx >= r.x0 && gx < r.x1 && gy >= r.y0 && gy < r.y1) return clamp((t - r.d) / LV.gas.fill, 0, 1);
    return 0;
  }
  const inHall = (LV, x, y) => {
    if (!LV.hall) return false;
    const gx = toGx(x, y),
      gy = toGy(x, y),
      [a, b, c, d] = LV.hall;
    return gx >= a && gx < c && gy >= b && gy < d;
  };
  function choke(S, p, dmg) {
    if (p.dead || p.god || S.winAt || S.demo) return;
    p.hp -= dmg;
    p.gasT = S.t;
    ev(S, 'gas', p.x, p.y, { v: dmg });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      const was = S.p;
      S.p = p;
      if (S.ck === undefined) {
        ev(S, 'pdie', p.x, p.y, { gas: 1 });
        S.over = { win: false, t: S.t, kills: S.kills, lvl: p.lvl, coins: S.coins };
      } else {
        p.down = true;
        p.rv = 0;
        p.bt = D.COOP.revive.die;
        ev(S, 'pdown', p.x, p.y);
        checkOver(S);
      }
      S.p = was;
    }
  }
  // a walled level (the lab): is a wall between e and hero p (the field's way from e longer than the cells straight between)? Then even
  // close by it goes round by the field instead of pushing at the wall
  const walledOff = (e, p) => {
    const i = flowIdx(e.x, e.y),
      j = flowIdx(p.x, p.y),
      d = nav.dist[i];
    if (d >= 1 << 29) return false;
    return d > Math.abs((i % NN) - (j % NN)) + Math.abs(((i / NN) | 0) - ((j / NN) | 0)) + 2;
  };

  // enemy spatial hash in screen coords (counting sort; derived, rebuilt every step)
  const HC = 64,
    HW = Math.ceil(WX / HC) + 1,
    HH = Math.ceil(WY / HC) + 1;
  const hash = {
    start: new Int32Array(HW * HH + 1),
    fill: new Int32Array(HW * HH),
    items: new Int32Array(4096),
    cell: new Int32Array(4096),
    o1: new Int32Array(4096),
    o2: new Int32Array(4096),
  };
  const hidx = (x, y) => clamp((y / HC) | 0, 0, HH - 1) * HW + clamp((x / HC) | 0, 0, HW - 1);
  const CNT = new Int32Array(HW * HH),
    TOUCH = new Int32Array(HW * HH);
  let nT = 0;
  function buildHash(S) {
    const en = S.en,
      st = hash.start;
    for (let j = 0; j < nT; j++) CNT[TOUCH[j]] = 0;
    nT = 0;
    if (en.length > hash.items.length) {
      const n = 1 << Math.ceil(Math.log2(en.length));
      hash.items = new Int32Array(n);
      hash.cell = new Int32Array(n);
      SC.out1 = new Int32Array(n);
      SC.out2 = new Int32Array(n);
    }
    const cell = hash.cell,
      items = hash.items,
      fill = hash.fill;
    for (let i = 0; i < en.length; i++) {
      const c = hidx(en[i].x, en[i].y);
      cell[i] = c;
      if (CNT[c]++ === 0) TOUCH[nT++] = c;
    }
    let off = 0;
    for (let j = 0; j < nT; j++) {
      const c = TOUCH[j];
      st[c] = off;
      fill[c] = off;
      off += CNT[c];
    }
    for (let i = 0; i < en.length; i++) items[fill[cell[i]]++] = i;
  }
  function query(x, y, rx, ry, out) {
    const x0 = clamp(((x - rx) / HC) | 0, 0, HW - 1),
      x1 = clamp(((x + rx) / HC) | 0, 0, HW - 1),
      y0 = clamp(((y - ry) / HC) | 0, 0, HH - 1),
      y1 = clamp(((y + ry) / HC) | 0, 0, HH - 1);
    let n = 0;
    const st = hash.start,
      items = hash.items;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * HW + cx,
          m = CNT[c];
        if (!m) continue;
        for (let k = st[c], e = k + m; k < e; k++) out[n++] = items[k];
      }
    return n;
  }

  // =====================================================================================================================
  // STATE
  // =====================================================================================================================
  const usable = (id) =>
    typeof id === 'string' && Object.prototype.hasOwnProperty.call(D.MAIN, id) && !D.MAIN[id].locked;
  const META0 = () => ({ hp: 0, dmg: 0, speed: 0, magnet: 0, reroll: 0, start: 0 });
  // A run for one hero (opt.weapon, meta, wup) or for two playing together (opt.heroes: [{ weapon, meta, wup }, …], one per player, in the
  // room's order: both pages and the server make it the same). S.ps: the heroes; each has its own gun, items, health, camera (cam: what its
  // player sees), view width (vw), aim lean (aimOff), card screen (pause) and loadout (meta, wup); the level, the XP (every hero gets the
  // same: a level up deals each of them cards), the coins, the kills, the zombies and everything on the ground are the run's.
  // S.p is the hero the sim works for at the moment (its gun's shots, its items, what it picks up: their kills, crits and luck are its),
  // and between steps the one this page plays (S.me; and S.cam, S.camV, S.vw, S.pause are its own, for the scene and the menus).
  // opt.mission: a campaign mission's id (live/missions.js): its tasks are played one after another (mission), from
  // the start its script names, with no zombies about until the script brings them. opt.hub: NEAR Base, the hub
  // between runs (stepped by hubStep: the hero walks, nothing else happens; the page's alone, never recorded or paid)
  function create(opt = {}) {
    const seed = opt.seed ?? 7;
    const LV = level(seed);
    const MS = scripts(),
      plan =
        typeof opt.mission === 'string' && MS && Object.prototype.hasOwnProperty.call(MS, opt.mission)
          ? MS[opt.mission]
          : null,
      hub = !!opt.hub;
    let [px, py] = toS(LV.spawn[0], LV.spawn[1]);
    const zoom = opt.zoom ?? ZOOM,
      list =
        Array.isArray(opt.heroes) && opt.heroes.length > 1
          ? opt.heroes.slice(0, 4)
          : [{ weapon: opt.weapon, meta: opt.meta, wup: opt.wup }];
    const meta = list[0].meta || META0(),
      wup = list[0].wup || { dmg: 0, rate: 0, mag: 0 },
      n = list.length;
    const S = {
      t: 0,
      steps: 0,
      wt0: 0,
      seed,
      rs: Number.isInteger(opt.rs) ? opt.rs | 0 : (seed * 7919 + 13) | 0,
      demo: !!opt.demo,
      zoom, // rs: the run's own RNG seed (the game's server deals one per run); seed: the level's
      meta,
      wup,
      rank: Number.isInteger(opt.rank) ? opt.rank : 0, // rank: the player's survivor rank (0: not given); meta, wup: the first hero's (each hero has its own)
      thr: opt.demo ? { hp: 1, boss: 1, dmg: 1 } : D.threatOf(meta, list[0].wup), // the zombies' and the bosses' health and their bite × for this loadout (D.THREAT)
      ev: [],
      dec: [],
      ban: [],
      warn: null,
      horde: null,
      tele: [],
      eb: [],
      pud: [],
      ps: [],
      p: null,
      me: 0,
      en: [],
      nid: 1,
      bul: [],
      gems: [],
      pk: [],
      chests: [],
      gren: [],
      bq: [],
      ch: [],
      corpses: [],
      bp: {},
      hs: 0,
      fire: [],
      wells: [],
      msl: [],
      tur: [],
      pd: LV.destr.map((i) => LV.props[i].hp),
      kills: 0,
      bk: 0,
      coins: 0,
      cam: null,
      camV: null, // bk: bosses killed (the rank's XP)
      pause: null,
      over: null,
      arena: null,
      boss: 0,
      spawnAcc: 0,
      nextHorde: 30,
      nextElite: 60,
      nextDrop: 110,
      done: {},
      mk: { n: 0, t0: -9, shown: 0 },
      streak: 0,
      lastKill: -9,
      noHit: 0,
      xpFlash: -9,
      coinFlash: -9,
    };
    if (plan) {
      // S.mis: the mission's progress — id, i (the task under way; -1 before the first step), t0 and k0 (the time and
      // the kills when it began), dir (the spawn director on), sch (a classic mission: the bosses and the lab's gas on
      // their schedule), got (the named pickups taken), gs (the named groups brought in: [name, how many]), won, dl
      // (the script's card screens dealt: plan.deal), hint (what the HUD points out: { id, t, item }), open (the map's
      // gates opened), side (a cross task's: the side of its line the hero began on). Its voice lines
      // are events ('voice', id): the page shows each one (live/voice.js)
      S.mis = {
        id: opt.mission,
        i: -1,
        t0: 0,
        k0: 0,
        dir: 1,
        sch: plan.classic ? 1 : 0,
        got: [],
        gs: [],
        won: 0,
        dl: 0,
        hint: null,
        open: [],
        side: 0,
      };
      if (!plan.classic) [px, py] = markAt(LV, 'start');
      else if (!S.demo) [px, py] = startAt(S, LV, px, py); // (a classic mission begins as a classic run does)
    } else if (hub) S.hub = 1;
    else if (!S.demo) [px, py] = startAt(S, LV, px, py); // (a run begins at one of START, the run's own pick)
    const th = n > 1 ? list.map((h) => D.threatOf(h.meta || META0(), h.wup)) : null;
    if (n > 1) {
      // together: the zombies come a little more, and tougher (D.COOP)
      const avg = (k) => th.reduce((a, t) => a + t[k], 0) / n;
      S.thr = { hp: avg('hp'), boss: avg('boss'), dmg: avg('dmg') };
      S.ck = coopK(n);
      S.sc = 0;
    }
    for (let i = 0; i < n; i++) {
      const h = list[i],
        m = i ? h.meta || META0() : meta,
        x = n > 1 ? px + (i - (n - 1) / 2) * 130 : px;
      const p = {
        x,
        y: py,
        vx: 0,
        vy: 0,
        hp: 100,
        maxHp: 100,
        lvl: 1,
        xp: 0,
        need: needOf(S, 1),
        pend: 0,
        aim: 0,
        face: 1,
        dist: 0,
        hurtT: -9,
        ifr: 0,
        dead: false,
        kick: 0,
        main: { id: usable(h.weapon) ? h.weapon : 'pistol', lvl: 1, cd: 0, spin: 0, ft: 0, firing: false },
        items: [],
        rerolls: 1 + (m.reroll || 0),
        god: false,
        pushX: 0,
        pushY: 0,
        moveT: 0,
        st: null,
        i,
        meta: m,
        wup: i ? h.wup || { dmg: 0, rate: 0, mag: 0 } : wup,
        cam: [x - VIEW.W / zoom / 2, py - VIEW.H / zoom / 2],
        camV: [0, 0],
        pause: null,
        kills: 0,
      };
      if (n > 1) p.thr = th[i]; // (its own bite ×: the hero of a newer player is bitten less)
      S.ps.push(p);
    }
    for (const p of S.ps) {
      S.p = p;
      recalc(S);
      p.hp = p.maxHp;
      if (p.meta.start > 0 && !hub) {
        const id = D.SUB_WEAPONS[Math.floor(rnd(S) * D.SUB_WEAPONS.length)];
        p.items.push(newItem(id, p.meta.start));
        recalc(S);
      }
    }
    S.p = S.ps[0];
    if (!S.demo && !(plan && !plan.classic) && !hub) {
      for (let i = 0, tries = 0; i < 16 && tries < 80; tries++) {
        const a = rnd(S) * TAU,
          d = 650 + rnd(S) * 250,
          x = px + dcos(a) * d,
          y = py + dsin(a) * d * 0.5;
        if (blockedS(S, LV, x, y, 24)) continue;
        const e = addEnemy(S, 'walker', x, y);
        e.spT = -9;
        i++;
      }
      const bar = LV.props.filter((o) => o.barrel && m2(o.x - px, o.y - py) < 900 * 900);
      if (bar.length) {
        const cx = bar.reduce((a, o) => a + o.x, 0) / bar.length,
          cy = bar.reduce((a, o) => a + o.y, 0) / bar.length;
        for (let i = 0, tries = 0; i < 5 && tries < 40; tries++) {
          const a = rnd(S) * TAU,
            d = 70 + rnd(S) * 70,
            x = cx + dcos(a) * d,
            y = cy + dsin(a) * d * 0.5;
          if (blockedS(S, LV, x, y, 20)) continue;
          const e = addEnemy(S, 'walker', x, y);
          e.spT = -9;
          i++;
        }
      }
    }
    return alias(S);
  }
  // where a run begins (ground coords): ten open places spread over the town, none in its middle (scratchpad spawnpick.cjs picked them
  // on the map: room for both heroes side by side and round them, joined to the rest by open ground). The run's RNG picks one; one the
  // map has since built over is passed for the next one, and none open: the map's own spawn. Together both heroes begin there
  const START = [
    [3650, 700],
    [3700, 4100],
    [1150, 3800],
    [1150, 1150],
    [3650, 2400],
    [2500, 3400],
    [950, 2450],
    [2550, 1500],
    [3750, 3200],
    [3150, 1900],
  ];
  function startAt(S, LV, px, py) {
    const ST = LV.starts || START,
      k = Math.floor(rnd(S) * ST.length); // (the lab: its own, in the rooms round the hall)
    for (let j = 0; j < ST.length; j++) {
      const [gx, gy] = ST[(k + j) % ST.length],
        [x, y] = toS(gx, gy);
      if (!blockedS(S, LV, x - 65, y, 34) && !blockedS(S, LV, x + 65, y, 34) && !blockedS(S, LV, x, y, 40))
        return [x, y];
    }
    return [px, py];
  }
  // the together-run's factors for n heroes still in it (D.COOP; one hero: none — a run alone)
  function coopK(n) {
    if (n < 2) return null;
    const C = D.COOP,
      k = n - 1;
    return { spawn: 1 + C.spawn * k, hp: 1 + C.hp * k, boss: 1 + C.boss * k, xp: 1 + C.xp * k, coin: C.coin };
  }
  const needOf = (S, lvl) => (S.ck ? Math.round(D.XP_NEED(lvl) * S.ck.xp) : D.XP_NEED(lvl));
  // the hero this page plays as S.p (and its camera, view, card screen as S's own) between steps: the scene and the menus read those.
  // (S.me is the page's alone: the sim never reads it, and every step starts from the first hero)
  function alias(S) {
    const p = S.ps[S.me | 0] || S.ps[0];
    S.p = p;
    S.cam = p.cam;
    S.camV = p.camV;
    S.vw = p.vw;
    S.pause = p.pause || null;
    S.hold = S.ps.length > 1 && !S.over && S.ps.some((o) => o !== p && o.pause) ? 1 : 0; // (the world stands still: a partner's card screen)
    return S;
  }
  const spawn = (worldT, opt = {}) => Object.assign(create(opt), { wt0: worldT });
  const respawn = (S, worldT) =>
    spawn(worldT, {
      weapon: S.p.main.id,
      meta: S.meta,
      wup: S.wup,
      seed: S.seed,
      rank: S.rank,
      mission: S.mis ? S.mis.id : undefined,
    });
  const outOfPlay = () => false;
  const blockedAt = (S, x, y, pad) => blockedS(S, level(S.seed), x, y, pad); // (read only: the balance lab's bot, gen/balbot.cjs)
  const newItem = (id, lvl = 1) => ({ id, lvl, evo: false, cd: 0.5, ang: 0, dr: [] });
  // an event (the scene and the sounds play them); together, the hero it happened for (pi) — a hurt flashes only its own player's screen
  function ev(S, k, x, y, o) {
    const e = { k, t: S.t, x, y };
    if (o) Object.assign(e, o);
    if (S.ck !== undefined && e.pi === undefined) e.pi = S.p.i;
    S.ev.push(e);
    return e;
  }
  function decal(S, k, x, y, s, life) {
    if (S.dec.length > 220) S.dec.shift();
    S.dec.push({ k, x, y, s, t: S.t, life, r: rnd(S) * 6.28, v: (rnd(S) * 6) | 0 });
  }
  // banners and warnings hold language keys (lang_<code>.js) and their slot values (v); the HUD translates them when it draws. own: a
  // banner of the hero's own (an evolution, a medkit): together, shown only to its player (pi)
  function banner(S, ti, sub, chip, col, v, own) {
    if (S.ban.length >= 3) S.ban.shift();
    const b = { ti, sub, chip, col, v, t: S.t };
    if (own && S.ck !== undefined) b.pi = S.p.i;
    S.ban.push(b);
  }

  // ---------- stats ----------
  function itemLvl(S, id) {
    const it = S.p.items.find((i) => i.id === id);
    return it ? it.lvl : 0;
  }
  function recalc(S) {
    const p = S.p,
      m = p.meta || S.meta,
      pl = (id) => {
        const l = itemLvl(S, id);
        return l ? D.ITEMS[id].st[l - 1] : 0;
      };
    const oldMax = p.maxHp;
    p.maxHp = 100 + 10 * (m.hp || 0) + (pl('medkit') ? pl('medkit').hp : 0);
    if (p.maxHp > oldMax) p.hp += p.maxHp - oldMax;
    p.st = {
      speed: 200 * (1 + 0.05 * (m.speed || 0)) * (pl('boots') ? pl('boots').s : 1),
      rlMul: pl('boots') ? pl('boots').rl : 1,
      pickR: 120 * (1 + 0.15 * (m.magnet || 0)) * (pl('magnet') || 1),
      armor: pl('armor') || 0,
      regen: pl('medkit') ? pl('medkit').r : 0,
      crit: 0.05 + (pl('clover') || 0),
      luck: 1 + itemLvl(S, 'clover') * 0.15,
      dmgMul: 1 + 0.08 * (m.dmg || 0),
      // area / dur: the zones' size and time ×; ammo: extra projectiles; block: a hit's chance to be blocked; fang: { n, hp } the kills
      // that heal; cdMul: the extra weapons' cooldowns ×; range: range and projectile speed ×; cal: the main gun's
      area: pl('canister') ? pl('canister').a : 1,
      dur: pl('canister') ? pl('canister').d : 1,
      ammo: pl('bandolier') || 0,
      block: pl('helmet') || 0,
      fang: pl('fang') || null,
      cdMul: pl('battery') || 1,
      range: pl('scope') || 1,
      cal: pl('caliber') || 1,
    };
  }
  function mainStats(S) {
    const id = S.p.main.id,
      Lv = S.p.main.lvl,
      d = D.MAIN[id],
      u = S.p.wup || S.wup;
    let dmg = d.dmg,
      rate = d.rate || 0,
      pierce = d.pierce || 0,
      crit = 0,
      spread = d.spread || 0,
      knock = d.knock || 70;
    let range = d.range,
      aoe = d.aoe || 0,
      slow = d.slow || 0,
      spin = d.spin || 0,
      cone = d.cone || 0,
      burn = d.burn || 0,
      pellets = d.pellets || 1,
      multi = 1;
    const at = (l) => Lv >= l;
    switch (id) {
      case 'pistol':
        if (at(2)) dmg *= 1.2;
        if (at(3)) multi = 2;
        if (at(4)) rate *= 1.25;
        if (at(5)) {
          pierce += 1;
          crit += 0.1;
        }
        break;
      case 'shotgun':
        if (at(2)) dmg *= 1.2;
        if (at(3)) pellets += 2;
        if (at(4)) rate *= 1.2;
        if (at(5)) {
          pellets += 3;
          knock *= 1.5;
        }
        break;
      case 'smg':
        if (at(2)) dmg *= 1.2;
        if (at(3)) rate *= 1.2;
        if (at(4)) pierce += 1;
        if (at(5)) {
          dmg *= 1.3;
          spread *= 0.65;
        }
        break;
      case 'minigun':
        if (at(2)) dmg *= 1.2;
        if (at(3)) spin *= 0.55;
        if (at(4)) pierce += 1;
        if (at(5)) {
          dmg *= 1.3;
          slow *= 0.4;
        }
        break;
      case 'sniper':
        if (at(2)) dmg *= 1.25;
        if (at(3)) pierce += 3;
        if (at(4)) rate *= 1.25;
        if (at(5)) {
          dmg *= 1.4;
          crit += 0.15;
        }
        break;
      case 'flame':
        if (at(2)) dmg *= 1.2;
        if (at(3)) range *= 1.2;
        if (at(4)) cone *= 1.4;
        if (at(5)) {
          dmg *= 1.3;
          burn *= 1.8;
        }
        break;
      case 'rocket':
        if (at(2)) dmg *= 1.2;
        if (at(3)) aoe *= 1.25;
        if (at(4)) rate *= 1.2;
        if (at(5)) multi = 2;
        break;
    }
    // its evolution (level 5 with the caliber): the pistol's shots ricochet (bnc), the shotgun's pellets set alight (inc), the SMG fires
    // two streams, the minigun needs no spin-up, the sniper's rounds burst (boom), the flamethrower is wider and burns longer, the
    // rockets scatter bomblets (cl)
    let bnc = 0,
      inc = 0,
      boom = 0,
      cl = 0,
      burnT = 3;
    if (S.p.main.evo)
      switch (id) {
        case 'pistol':
          bnc = 2;
          break;
        case 'shotgun':
          inc = 1;
          break;
        case 'smg':
          multi = 2;
          break;
        case 'sniper':
          boom = 1;
          break;
        case 'flame':
          cone *= 1.35;
          burn *= 1.5;
          burnT = 6;
          break;
        case 'rocket':
          cl = 1;
          break;
      }
    dmg *= (1 + D.WEAPON_UP.dmg.per * (u.dmg || 0)) * S.p.st.dmgMul * (S.p.st.cal || 1);
    rate *= 1 + D.WEAPON_UP.rate.per * (u.rate || 0);
    range *= S.p.st.range || 1;
    const speed = (d.speed || 1000) * (S.p.st.range || 1);
    // the magazine (rounds; the flamethrower's ticks of fuel): bigger with the arsenal's upgrade, the bandolier and the evolution; the
    // reload shorter with the battery and the boots
    const mag = d.mag
      ? Math.max(
          1,
          Math.round(
            d.mag *
              (1 + D.WEAPON_UP.mag.per * (u.mag || 0)) *
              (1 + D.MAG_BAND * itemLvl(S, 'bandolier')) *
              (S.p.main.evo ? D.MAG_EVO : 1),
          ),
        )
      : 0;
    const rl = (d.rl || 0) * (S.p.st.cdMul || 1) * (S.p.st.rlMul || 1);
    return {
      dmg,
      rate,
      pierce,
      crit,
      spread,
      knock,
      range,
      aoe,
      slow,
      spin,
      cone,
      burn,
      pellets,
      multi,
      speed,
      bnc,
      inc,
      boom,
      cl,
      burnT,
      mag,
      rl,
    };
  }
  // the one origin function: where the gun is, shared by the sim (shots, aim) and the scene (the 3D gun, the flippers). The hero is
  // a 3D penguin (live/penguin.js) seen by an ortho camera 30° down; it faces the aim: ground direction (cos a, 2 sin a). Each gun's
  // placement in the aim frame (D.HOLD: O its rear grip, mz its muzzle) projects to the screen here, exactly as the scene draws it.
  const ELEV = Math.PI / 6,
    yawOf = (a) => datan2(dcos(a), 2 * dsin(a));
  const holdOf = (S) => D.HOLD[S.p.main.id] || D.HOLD.pistol;
  const onScreen = (S, m) => {
    const y = yawOf(S.p.aim),
      wx = m[0] * dcos(y) + m[2] * dsin(y),
      wz = -m[0] * dsin(y) + m[2] * dcos(y);
    return [S.p.x + wx * HERO.s, S.p.y + (-m[1] * dcos(ELEV) + wz * dsin(ELEV)) * HERO.s];
  };
  const hand = (S) => onScreen(S, holdOf(S).O);
  // a gun lying flat along the aim is drawn foreshortened toward / away from the camera (half length straight down or up)
  const gunScale = (a) => 1 / dhypot(dcos(a), 2 * dsin(a));
  // how high the muzzle is (screen px above the ground under it): its shots keep that height
  // (the 3D hero's muzzles, as hero3d.js draws them: D.HERO3D.mz, written by the hero's export; else the old aim frame's)
  const heroMz = (S) => (D.HERO3D && D.HERO3D.mz[S.p.main.id]) || null;
  function muzzleZ(S) {
    const m = heroMz(S);
    if (m) return m[1] * dcos(ELEV) * HERO.s;
    const h = holdOf(S),
      k = h.k || [1, 1, 1];
    return (h.O[1] + h.mz[1] * k[1]) * dcos(ELEV) * HERO.s;
  }
  function muzzle(S) {
    const m = heroMz(S);
    if (m) return onScreen(S, m);
    const h = holdOf(S),
      k = h.k || [1, 1, 1];
    return onScreen(S, [h.O[0] + h.mz[0] * k[0], h.O[1] + h.mz[1] * k[1], h.O[2] + h.mz[2] * k[2]]);
  }

  // =====================================================================================================================
  // STEP
  // =====================================================================================================================
  const SC = { out1: new Int32Array(4096), out2: new Int32Array(4096) };
  // inp: the input of the hero (alone), or one per hero (together: [first's, second's, …]; null: that player left the run at this step —
  // its hero is gone from it, as replay.js and the room's server agree on the step)
  const NOIN = {};
  function step(S, inp) {
    const LV = level(S.seed),
      H = S.ps,
      I = Array.isArray(inp) ? inp : [inp];
    if (S.p && S.pause !== undefined && S.pause !== (S.p.pause || null)) S.p.pause = S.pause || null; // (a card screen set or cleared on S itself, by a check or a tool: the page's own hero's)
    S.p = H[0];
    if (S.over) {
      S.t += DT;
      S.steps++;
      return alias(S);
    } // (the run over: its time runs on for the results)
    for (const p of H) {
      if (p.gone) continue;
      const q = I[p.i];
      if (q == null && H.length > 1) {
        leave(S, p);
        continue;
      }
      view(S, p, q || NOIN);
    }
    S.p = H[0];
    if (S.hub) return hubStep(S, LV, I);
    if (H.some((p) => p.pause)) {
      for (const p of H)
        if (p.pause) {
          S.p = p;
          handlePause(S, I[p.i] || NOIN);
        }
      S.p = H[0];
      S.steps++;
      return alias(S);
    }
    const entrance = (S.arena && S.t - S.arena.t < 4) || (S.warn && S.warn.col === '#ff4a3a' && S.t - S.warn.t < 3);
    if (!S.demo && !entrance && !S.winAt && !lvHeld(S) && H.some((p) => p.pend > 0 && !p.gone)) {
      // (won: the levels count, no cards)
      for (const p of H)
        if (p.pend > 0 && !p.gone) {
          S.p = p;
          openLevelUp(S);
        }
      S.p = H[0];
      S.steps++;
      return alias(S);
    }
    if (S.p.pend > 0 && S.demo) {
      S.p.pend--;
      const c = cardOptions(S)[0];
      if (c) applyCard(S, c);
      levelFx(S);
    }
    if (S.hs > 0) {
      S.hs -= DT;
      S.steps++;
      return alias(S);
    } // hit-stop: the world holds a beat on big blasts
    const t = S.t + DT;
    S.t = t;
    S.steps++;
    if (S.navAt === undefined || t - S.navAt > 0.3 || t < S.navAt) {
      S.navAt = t;
      S.navP = navPoints(S);
    } // the field's schedule is state (see updateFlow)
    if (nav.seed !== S.seed || nav.at !== S.navAt || nav.key !== S.navP.join()) updateFlow(S, LV);
    for (const p of H) {
      S.p = p;
      updatePlayer(S, LV, I[p.i] || NOIN);
    }
    S.p = H[0];
    if (H.length > 1) {
      revive(S);
      S.ka = S.ck;
    } // (the zombies to come: as for the heroes in the run, down or dead too)
    if (S.mis) mission(S, LV);
    director(S, LV);
    buildHash(S);
    updateEnemies(S, LV);
    for (const p of H) {
      S.p = p;
      updateMain(S, I[p.i] || NOIN);
    }
    for (const p of H) {
      S.p = p;
      updateItems(S, LV);
    }
    S.p = H[0];
    if (!H.every((p) => p.dead)) updateThrown(S, LV);
    updateBullets(S, LV);
    updateBlasts(S, LV);
    updateEnemyShots(S);
    if (LV.gas && !S.demo && !scripted(S) && S.t > gasT0(LV))
      for (const p of H) {
        if (p.dead) continue;
        const g = gasAt(S, LV, p.x, p.y); // (the lab's gas: a tick every GAS_TICK)
        if (g <= 0) {
          p.gk = 0;
          continue;
        }
        p.gk = (p.gk || 0) + DT;
        if (p.gk >= GAS_TICK) {
          p.gk = 0;
          choke(S, p, GAS_DMG * g);
        }
      }
    updatePickups(S);
    updateCorpses(S, LV);
    for (const p of H) {
      S.p = p;
      updateCamera(S);
    }
    S.p = H[0];
    // prune: dead enemies, old events, banners
    if (S.en.some((e) => e.dead)) S.en = S.en.filter((e) => !e.dead);
    let k = 0;
    while (k < S.ev.length && t - S.ev[k].t > 3) k++;
    if (k) S.ev.splice(0, k);
    if (S.ev.length > 900) S.ev.splice(0, S.ev.length - 900);
    S.ban = S.ban.filter((b) => t - b.t < 2.1);
    S.tele = S.tele.filter((q) => t - q.t0 < q.dur + 0.3);
    S.pud = S.pud.filter((q) => t - q.t0 < q.dur);
    S.dec = S.dec.filter((q) => t - q.t < q.life);
    if (S.warn && t - S.warn.t > 3) S.warn = null;
    if (S.horde && t - S.horde.t > 2.6) S.horde = null;
    return alias(S);
  }
  // where the zombies' way leads: the heroes standing (alone: the hero, whatever happened to it)
  function navPoints(S) {
    const H = S.ps;
    if (H.length === 1) return [H[0].x, H[0].y];
    const out = [];
    for (const p of H) if (!p.dead) out.push(p.x, p.y);
    return out.length ? out : [H[0].x, H[0].y];
  }

  // NEAR Base (S.hub): the hero walks and bumps into the bunker's walls and furniture, its camera follows; nothing
  // else of a run happens (no zombies, no shots, no clock that matters) and of the input only the walking counts (the
  // hero faces the way it walks)
  function hubStep(S, LV, I) {
    const t = (S.t += DT);
    S.steps++;
    for (const p of S.ps) {
      const q = I[p.i] || NOIN;
      S.p = p;
      updatePlayer(S, LV, { left: q.left, right: q.right, up: q.up, down: q.down, jx: q.jx, jy: q.jy });
      updateCamera(S);
    }
    S.p = S.ps[0];
    let k = 0;
    while (k < S.ev.length && t - S.ev[k].t > 3) k++;
    if (k) S.ev.splice(0, k);
    return alias(S);
  }

  // a hero's view width (view px) as its player's input gives it (replay.js keeps it): VIEW.W … VIEW.MAXW; the first step keeps it centred
  function view(S, p, inp) {
    const w = inp.vw === undefined ? VIEW.W : clamp(Math.round(+inp.vw) || VIEW.W, VIEW.W, VIEW.MAXW),
      was = p.vw || VIEW.W;
    if (w === was) return;
    if (!S.steps) p.cam[0] -= (w - was) / (S.zoom || 1) / 2;
    p.vw = w;
  }
  // together: a player left the run (closed the game, lost the connection): the hero is gone from it — no more cards, it is not
  // hunted, its turrets fold; the zombies come as for the ones left. The last one standing gone too: the run is over
  function leave(S, p) {
    const was = S.p;
    S.p = p;
    p.gone = 1;
    p.dead = true;
    p.down = false;
    p.pause = null;
    p.pend = 0;
    p.rv = 0;
    ev(S, 'left', p.x, p.y);
    S.tur = S.tur.filter((u) => (u.o | 0) !== p.i);
    S.ck = coopK(S.ps.filter((o) => !o.gone).length);
    S.p = was;
    checkOver(S);
  }
  // together: every hero down (or gone): the run is lost
  function checkOver(S) {
    if (S.over || S.ps.some((o) => !o.dead)) return;
    const p = lead(S);
    ev(S, 'pdie', p.x, p.y);
    S.over = { win: false, t: S.t, kills: S.kills, lvl: p.lvl, coins: S.coins };
  }
  const lead = (S) => S.ps.find((o) => !o.gone && !o.out) || S.ps.find((o) => !o.gone) || S.ps[0]; // (the level's numbers: the heroes still playing have the same)
  // together: a hero down gets up again when another stands by it (D.COOP.revive: within r for t s) with hp of its health and a moment
  // of grace; the zombies round it are thrown back. Left lying die s (o.bt: the seconds left; they stand while one gets it up) it dies:
  // out of the run for good (out) — no more XP or cards, its turrets fold, its player's camera follows the partner; the zombies still
  // come as for the heroes in the run
  function revive(S) {
    const R = D.COOP.revive;
    for (const o of S.ps) {
      if (!o.down || o.gone) continue;
      let near = false;
      for (const p of S.ps) if (p !== o && !p.dead && m2(p.x - o.x, p.y - o.y) < R.r * R.r) near = true;
      o.rvn = near ? 1 : 0;
      if (near) o.rv = clamp((o.rv || 0) + DT / R.t, 0, 1);
      else {
        o.bt = (o.bt ?? R.die) - DT;
        if (o.bt <= 0) {
          fall(S, o);
          continue;
        }
      }
      if (o.rv < 1) continue;
      const was = S.p;
      S.p = o;
      o.down = false;
      o.dead = false;
      o.rv = 0;
      o.bt = R.die;
      o.hp = o.maxHp * R.hp;
      o.ifr = R.ifr;
      o.vx = o.vy = o.pushX = o.pushY = 0;
      ev(S, 'revive', o.x, o.y);
      banner(S, 'coop.revived', null, null, '#5cff7a', null, true);
      levelFx(S);
      S.p = was;
    }
  }
  function fall(S, p) {
    const was = S.p;
    S.p = p;
    p.out = 1;
    p.outT = S.t;
    p.down = false;
    p.dead = true;
    p.rv = 0;
    p.rvn = 0;
    p.bt = 0;
    p.pause = null;
    p.pend = 0;
    p.vx = p.vy = p.pushX = p.pushY = 0;
    ev(S, 'pout', p.x, p.y);
    S.tur = S.tur.filter((u) => (u.o | 0) !== p.i);
    S.p = was;
    checkOver(S);
  }

  // ---------- player ----------
  function updatePlayer(S, LV, inp) {
    const p = S.p;
    if (p.dead) {
      if (p.down) p.vx = p.vy = 0;
      return;
    }
    let ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
      iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (inp.jx !== undefined && (Math.abs(inp.jx) > 0.15 || Math.abs(inp.jy) > 0.15)) {
      ix = inp.jx;
      iy = inp.jy;
    }
    const il = dhypot(ix, iy);
    if (il > 1) {
      ix /= il;
      iy /= il;
    }
    let spd = p.st.speed;
    if (p.main.id === 'minigun' && p.main.firing) spd *= 1 - mainStats(S).slow * p.main.spin;
    const tvx = ix * spd,
      tvy = iy * spd,
      acc = 2600 * DT;
    p.vx += clamp(tvx - p.vx, -acc, acc);
    p.vy += clamp(tvy - p.vy, -acc, acc);
    const ox = p.x,
      oy = p.y;
    p.x += (p.vx + p.pushX) * DT;
    p.y += (p.vy + p.pushY) * DT;
    const kk = dexp(-DT * 8);
    p.pushX *= kk;
    p.pushY *= kk;
    collide(S, LV, p, HERO.r);
    if (S.arena) arenaClamp(S.arena, p, 30);
    const moved = dhypot(p.x - ox, p.y - oy);
    if (moved > 0.02) {
      const b = Math.floor(p.dist / 33);
      p.dist += moved;
      if (Math.floor(p.dist / 33) !== b) ev(S, 'step', p.x, p.y);
      p.moveT = S.t;
    }
    const aimed = inp.mx !== undefined || (inp.ax !== undefined && (Math.abs(inp.ax) > 0.2 || Math.abs(inp.ay) > 0.2)); // (the mouse or the aim stick holds the aim)
    if (!p.main.firing && !aimed && (ix || iy)) p.aim = angTo(p.aim, datan2(iy, ix), DT * 10);
    p.face = dcos(p.aim) < 0 ? -1 : 1;
    p.kick = Math.max(0, p.kick - DT * 60);
    p.ifr -= DT;
    if (p.st.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.st.regen * DT);
    if (!p.i) S.noHit += DT;
  }
  function angTo(a, b, k) {
    let d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    return a + d * Math.min(1, k);
  }
  function arenaClamp(A, o, pad) {
    const dx = o.x - A.x,
      dy = (o.y - A.y) * YK,
      d = dhypot(dx, dy),
      R = A.r - pad;
    if (d > R) {
      o.x = A.x + (dx / d) * R;
      o.y = A.y + ((dy / d) * R) / YK;
    }
  }
  // a hit on hero p (its armour, its helmet, its bite ×). Alone its health gone ends the run; together the hero goes down (revive)
  function hurtPlayer(S, p, dmg, fx, fy) {
    if (p.dead || p.god || p.ifr > 0 || S.winAt || (S.demo && p.hp < 25)) return;
    const was = S.p;
    S.p = p;
    if (p.st.block && rnd(S) < p.st.block) {
      p.ifr = 0.45;
      ev(S, 'block', p.x, p.y);
      S.p = was;
      return;
    } // the helmet took it
    const th = p.thr || S.thr;
    dmg *= (1 - p.st.armor) * (th ? th.dmg : 1);
    p.hp -= dmg;
    p.ifr = 0.45;
    p.hurtT = S.t;
    S.noHit = 0;
    S.streak = 0;
    ev(S, 'hurt', p.x, p.y, { v: dmg });
    if (fx !== undefined) {
      const a = datan2(p.y - fy, p.x - fx);
      p.pushX += dcos(a) * 170;
      p.pushY += dsin(a) * 170;
    }
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      if (S.ck === undefined) {
        ev(S, 'pdie', p.x, p.y);
        S.over = { win: false, t: S.t, kills: S.kills, lvl: p.lvl, coins: S.coins };
      } else {
        p.down = true;
        p.rv = 0;
        p.bt = D.COOP.revive.die;
        ev(S, 'pdown', p.x, p.y);
        checkOver(S);
      }
    }
    S.p = was;
  }
  // a hit on every hero standing within r (ground metric) of x, y; dmg: a number, or (hero, its distance) → the hit (0: none)
  function hurtNear(S, x, y, r, dmg, fx, fy) {
    for (const p of S.ps) {
      if (p.dead) continue;
      const d = Math.sqrt(m2(p.x - x, p.y - y));
      if (d < r) {
        const v = typeof dmg === 'function' ? dmg(p, d) : dmg;
        if (v) hurtPlayer(S, p, v, fx, fy);
      }
    }
  }
  const bonusXp = (S, v) => Math.max(2, Math.min(v, Math.round(lead(S).need * 0.25)));
  // the XP is the run's: every hero (still in it, not dead for good) gets the same, and each level up deals each of them its cards
  function addXp(S, v) {
    const held = lvHeld(S);
    for (const p of S.ps) {
      if (p.gone || p.out) continue;
      p.xp += v;
      if (held) p.xp = Math.min(p.xp, p.need - 1); // (a mission's task holding the levels back: the bar stops short)
      while (p.xp >= p.need) {
        p.xp -= p.need;
        p.lvl++;
        p.need = needOf(S, p.lvl);
        p.pend++;
      }
    }
  }
  function levelFx(S) {
    const p = S.p;
    ev(S, 'lvl', p.x, p.y);
    for (const e of S.en) {
      if (e.dead || D.ENEMIES[e.k].boss) continue;
      const d2 = m2(e.x - p.x, e.y - p.y);
      if (d2 < 260 * 260) {
        const d = Math.sqrt(d2) || 1;
        e.kx += ((e.x - p.x) / d) * 520;
        e.ky += ((e.y - p.y) / d) * 520;
      }
    }
  }

  // ---------- level-up cards, chests ----------
  const maxL = (id) => D.ITEMS[id].st.length;
  // a new item that makes a pair with one held (an extra weapon and its passive; the caliber and the main gun) is offered twice as often;
  // the new items together weigh about as much as the nine of old did, so the upgrades still come up
  const pairs = (S, id) => {
    const p = S.p,
      e = D.EVOS[id];
    return e
      ? p.items.some((j) => j.id === e.with)
      : id === D.MAIN_EVO || p.items.some((j) => D.EVOS[j.id] && D.EVOS[j.id].with === id);
  };
  function cardOptions(S) {
    const p = S.p,
      out = [];
    if (p.main.lvl < 5) out.push({ ty: 'main', id: p.main.id, lvl: p.main.lvl + 1, w: 1.1 });
    for (const it of p.items) if (it.lvl < maxL(it.id)) out.push({ ty: 'up', id: it.id, lvl: it.lvl + 1, w: 1.25 });
    if (p.items.length < D.MAX_ITEMS) {
      const ids = [...D.SUB_WEAPONS, ...D.PASSIVES].filter((id) => !p.items.some((i) => i.id === id)),
        wn = Math.min(1, 9 / (ids.length || 1));
      for (const id of ids) out.push({ ty: 'new', id, lvl: 1, w: wn * (pairs(S, id) ? 2 : 1) });
    }
    // weighted shuffle, keep 3
    const pickd = [];
    while (pickd.length < 3 && out.length) {
      let tot = out.reduce((a, c) => a + c.w, 0),
        r = rnd(S) * tot,
        i = 0;
      for (; i < out.length - 1; i++) {
        r -= out[i].w;
        if (r <= 0) break;
      }
      pickd.push(out.splice(i, 1)[0]);
    }
    if (!pickd.length) pickd.push({ ty: 'heal', id: 'medkit', lvl: 0 }, { ty: 'gold', id: 'coin', lvl: 0 });
    return pickd;
  }
  // (s0: the step it came up on — together, a player away too long gets the first card, D.COOP.pick)
  function openLevelUp(S) {
    S.p.pend--;
    levelFx(S);
    S.p.pause = { k: 'lv', cards: dealt(S) || cardOptions(S), t: S.t, s0: S.steps };
  }
  // a run saved by an older build (sessionStorage across hot reloads) can name items that no longer exist: drop them, and re-deal
  // a level-up or chest whose cards name one, so neither the sim nor the card screen ever meets an unknown id. A run saved before
  // heroes came in lists (S.ps): its hero, with the camera, card screen and loadout it kept on the run, made the first of them; a run
  // read back from JSON: S.p made its own hero again (the copy JSON made of it dropped)
  const knownCard = (c, S) =>
    !!c && ((c.ty === 'main' && (!S || c.id === S.p.main.id)) || c.ty === 'heal' || c.ty === 'gold' || !!D.ITEMS[c.id]);
  function migrate(S) {
    if (!Array.isArray(S.ps) || !S.ps.length) {
      const p = S.p;
      S.ps = [p];
      Object.assign(p, {
        i: 0,
        meta: S.meta,
        wup: S.wup,
        cam: S.cam || [p.x - camW(S, p) / 2, p.y - camH(S) / 2],
        camV: S.camV || [0, 0],
        vw: S.vw,
        pause: S.pause || null,
        kills: p.kills || 0,
      });
      if (S.lead) p.lead = S.lead;
      if (S.alead) p.alead = S.alead;
      if (S.aimOff) p.aimOff = S.aimOff;
    }
    S.p = S.ps[S.me | 0] || S.ps[0];
    for (const p of S.ps) {
      S.p = p;
      p.items = p.items.filter((it) => D.ITEMS[it.id]);
      if (!usable(p.main.id)) Object.assign(p.main, { id: 'pistol', lvl: 1, spin: 0, firing: false });
      const P = p.pause;
      if (P && P.k === 'lv' && !(P.cards || []).every((c) => knownCard(c, S))) P.cards = cardOptions(S);
      if (P && P.k === 'chest' && !(P.items || []).every((c) => knownCard(c, S))) {
        P.items = (P.items || []).filter((c) => knownCard(c, S));
        if (!P.items.length) P.items.push({ ty: 'gold', id: 'coin', lvl: 0 });
      }
      recalc(S);
    }
    for (const k of ['fire', 'wells', 'msl', 'tur']) if (!Array.isArray(S[k])) S[k] = [];
    S.en = S.en.filter((e) => Object.prototype.hasOwnProperty.call(D.ENEMIES, e.k));
    return alias(S);
  }
  function applyCard(S, c) {
    const p = S.p;
    // (to: a mission crate's card, the gun up to lvl at once)
    if (c.ty === 'main') p.main.lvl = Math.min(5, c.to ? Math.max(p.main.lvl, c.lvl) : p.main.lvl + 1);
    else if (c.ty === 'up') {
      const it = p.items.find((i) => i.id === c.id);
      if (it) it.lvl = Math.min(maxL(it.id), it.lvl + 1);
    } else if (c.ty === 'new') p.items.push(newItem(c.id));
    else if (c.ty === 'heal') p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
    else if (c.ty === 'gold') S.coins += 25;
    recalc(S);
    checkEvos(S);
  }
  function chestReward(S, big) {
    const p = S.p,
      items = [];
    for (const it of p.items) {
      const ev2 = D.EVOS[it.id],
        m = maxL(it.id);
      if (ev2 && !it.evo && it.lvl === m - 1 && p.items.some((j) => j.id === ev2.with))
        items.push({ ty: 'up', id: it.id, lvl: m });
    }
    if (!p.main.evo && p.main.lvl === 4 && itemLvl(S, D.MAIN_EVO)) items.push({ ty: 'main', id: p.main.id, lvl: 5 }); // the main gun one step from its evolution
    const n = big ? 3 : 1;
    const pool = cardOptions(S).filter((c) => c.ty !== 'heal' && c.ty !== 'gold' && !items.some((i) => i.id === c.id));
    let room = D.MAX_ITEMS - p.items.length;
    while (items.length < n && pool.length) {
      const c = pool.splice(Math.floor(rnd(S) * pool.length), 1)[0];
      if (c.ty === 'new') {
        if (room <= 0) continue;
        room--;
      }
      items.push(c);
    }
    if (!items.length) items.push({ ty: 'gold', id: 'coin', lvl: 0 });
    return items;
  }
  // the hero's card screen (S.p.pause) and its player's pick: a card, -2 a reroll; a chest's take. Together the world waits for every
  // screen, so a player away for D.COOP.pick s gets the first card (the chest's take) and the other one plays on
  function handlePause(S, inp) {
    const p = S.p,
      P = p.pause;
    let pick = inp.pick;
    if ((pick === undefined || pick === null) && S.ck !== undefined && S.steps - (P.s0 ?? S.steps) > D.COOP.pick / DT)
      pick = 0;
    if (pick === undefined || pick === null) return;
    if (P.k === 'lv') {
      if (pick === -2) {
        if (p.rerolls > 0 && !P.cards.some((c) => c.lock)) {
          p.rerolls--;
          P.cards = cardOptions(S);
        }
        return;
      }
      const c = P.cards[pick];
      if (!c || c.lock) return; // (a mission's card shown, not to be taken)
      applyCard(S, c);
      p.pause = null;
      if (S.ck !== undefined) ev(S, 'took', p.x, p.y, { n: pick, c }); // (together: the partner's screen shows the card taken)
    } else if (P.k === 'chest') {
      for (const c of P.items) applyCard(S, c);
      S.coins += P.coins || 0;
      p.pause = null;
      if (S.ck !== undefined) ev(S, 'took', p.x, p.y, { n: -1 });
    }
  }
  function checkEvos(S) {
    const p = S.p;
    for (const it of p.items) {
      const e = D.EVOS[it.id];
      if (!e || it.evo || it.lvl < maxL(it.id) || !p.items.some((j) => j.id === e.with)) continue;
      it.evo = true;
      ev(S, 'evo', p.x, p.y, { id: it.id });
      banner(S, 'hud.evo', 'evos.' + it.id + '.name', null, '#ffd23a');
    }
    if (!p.main.evo && p.main.lvl >= 5 && itemLvl(S, D.MAIN_EVO)) {
      p.main.evo = true;
      ev(S, 'evo', p.x, p.y, { id: p.main.id, main: 1 });
      banner(S, 'hud.evo', 'mevos.' + p.main.id + '.name', null, '#ffd23a');
    }
  }

  // ---------- spawning / director ----------
  function typeAt(S, tm) {
    const k = typeRoll(S, tm);
    if (k === 'bloater' && tm >= BOMBER_AT && !S.demo && rnd(S) < BOMBER_SHARE) return 'bomber';
    return k === 'spitter' && !S.demo && rnd(S) >= D.SPITTER_RATE ? 'walker' : k;
  }
  const BOMBER_AT = 4,
    BOMBER_SHARE = 0.4; // from the 4th minute, this share of the bloaters are bombers
  // late in a run, fewer zombies but tougher ones (the frame rate holds): a plain one rolled (walker, runner) comes one time in two, a
  // strong one (bloater, bomber, armored) brings a second one time in two; the crowd's cap is cut to LATE_CAP, and the cap, the stream
  // and the hordes all by LATE_FEW on top; the plain ones come with LATE_PLAIN_HP of their health (not the elites). It comes in over
  // LATE ± LATE_RAMP min (lateK 0 → 1), not all at once
  const LATE = 5.5,
    LATE_RAMP = 1,
    LATE_CAP = 0.72,
    LATE_FEW = 0.84,
    LATE_PLAIN_HP = 0.7,
    PLAIN = { walker: 1, runner: 1 },
    STRONG = { bloater: 1, bomber: 1, armored: 1 };
  const lateK = (S, tm) => (S.demo ? 0 : clamp((tm - LATE + LATE_RAMP) / (2 * LATE_RAMP), 0, 1)),
    lerp1 = (v, k) => 1 + (v - 1) * k;
  function spawnAt(S, tm, x, y) {
    const k = typeAt(S, tm),
      lk = lateK(S, tm),
      n = !lk ? 1 : PLAIN[k] ? (rnd(S) < 0.5 * lk ? 0 : 1) : STRONG[k] ? (rnd(S) < 0.5 * lk ? 2 : 1) : 1;
    for (let i = 0; i < n; i++) addEnemy(S, k, x + (i ? rr(S, -40, 40) : 0), y + (i ? rr(S, -24, 24) : 0));
  }
  function typeRoll(S, tm) {
    const r = rnd(S);
    if (tm < 2) return 'walker';
    if (tm < 3) return r < 0.7 ? 'walker' : 'runner';
    if (tm < 4) return r < 0.55 ? 'walker' : r < 0.8 ? 'runner' : 'bloater';
    if (tm < 6)
      return r < 0.4 ? 'walker' : r < 0.62 ? 'runner' : r < 0.75 ? 'bloater' : r < 0.88 ? 'armored' : 'spitter';
    return r < 0.32 ? 'walker' : r < 0.52 ? 'runner' : r < 0.64 ? 'bloater' : r < 0.82 ? 'armored' : 'spitter';
  }
  function guardOf(S, id) {
    for (const o of S.en) if (o.id === id) return o.dead ? null : o;
    return null;
  }
  function addEnemy(S, k, x, y, o = {}) {
    const d = D.ENEMIES[k],
      tm = S.t / 60;
    let hpMul = d.boss
      ? (1 + tm * 0.03) * (S.thr ? S.thr.boss : 1)
      : (1 + tm * 0.18 + tm * tm * 0.016) * (S.thr ? S.thr.hp : 1); // (as strong as the account: D.THREAT)
    if (S.ka) hpMul *= d.boss ? S.ka.boss : S.ka.hp; // (together: tougher, as many as stand: D.COOP)
    const e = {
      id: S.nid++,
      k,
      x,
      y,
      vx: 0,
      vy: 0,
      kx: 0,
      ky: 0,
      hp: d.hp * hpMul,
      max: 0,
      r: d.r,
      spd: d.speed * (0.9 + rnd(S) * 0.2),
      dmg: d.dmg * (1 + tm * 0.08),
      face: x < S.p.x ? 1 : -1,
      dist: rnd(S) * 100,
      fl: -9,
      sawT: 0,
      burnT: 0,
      burnD: 0,
      elite: !!o.elite,
      buffT: 0,
      spT: S.t,
      cd: 1 + rnd(S) * 2,
      ph: rnd(S) * 6.28,
      st: 'chase',
      stT: S.t,
      dead: false,
    };
    if (e.elite) {
      e.hp *= 8 * (d.eliteHp || 1);
      e.spd *= 1.15;
      e.r *= 1.3;
      e.dmg *= 1.5;
    } else if (PLAIN[k]) e.hp *= lerp1(LATE_PLAIN_HP, lateK(S, tm)); // late, the plain ones are frailer
    if (d.boss === 'mini') e.dmg *= d.pow || 1;
    e.max = e.hp;
    S.en.push(e);
    return e;
  }
  // a spot just beyond the edge of hero p's view, the way ang points from its middle (together: not in another hero's view either)
  function offscreenPoint(S, LV, ang, p = S.p) {
    const cw = camW(S, p),
      hw = cw / 2 + 90,
      hh = camH(S) / 2 + 110;
    for (let k = 0, n = LV.walled ? 16 : 8; k < n; k++) {
      const a = ang + k * 0.7;
      const c = dcos(a),
        s = dsin(a),
        t = Math.min(hw / Math.abs(c || 1e-6), hh / Math.abs(s || 1e-6)) + rnd(S) * 280; // scattered in depth beyond the edge
      const x = p.cam[0] + cw / 2 + c * t,
        y = p.cam[1] + camH(S) / 2 + s * t * 0.85;
      if (S.arena && m2(x - S.arena.x, y - S.arena.y) > sq(S.arena.r - 60)) continue;
      if (S.ps.length > 1 && seenBy(S, x, y, p)) continue;
      if (!blockedS(S, LV, x, y, 20)) return [x, y];
    }
    return null;
  }
  function seenBy(S, x, y, but) {
    for (const o of S.ps) {
      if (o === but || o.gone || o.out) continue;
      const w = camW(S, o),
        h = camH(S);
      if (Math.abs(x - o.cam[0] - w / 2) < w / 2 + 60 && Math.abs(y - o.cam[1] - h / 2) < h / 2 + 60) return true;
    }
    return false;
  }
  // the heroes the zombies come for: alone the hero; together the ones standing, and the next one in turn (the spawns go round them)
  const hunted = (S) => (S.ps.length === 1 ? S.ps : S.ps.filter((p) => !p.dead));
  function nextHero(S) {
    if (S.ps.length === 1) return S.ps[0];
    const A = hunted(S);
    if (!A.length) return S.ps[0];
    S.sc = ((S.sc | 0) + 1) % 1e6;
    return A[S.sc % A.length];
  }
  // the run won (the final boss down): every zombie left bursts, one after another over WIN_POP s (e.popT), and every gem and coin on the
  // ground — and those the bursts drop — flies to the hero (S.vacuum); no more come (director), and the run ends once they are in (or
  // WIN_WAIT s after S.winAt)
  const WIN_POP = 1.2,
    WIN_WAIT = 3;
  function won(S, boss) {
    S.vacuum = 1;
    for (const o of S.en) if (!o.dead && o !== boss) o.popT = S.t + 0.15 + rnd(S) * WIN_POP;
  }
  const scripted = (S) => !!S.mis && !S.mis.sch; // (a mission whose script, not the schedule, brings its bosses)
  function director(S, LV) {
    if (S.winAt || (S.mis && !S.mis.dir)) return; // (a mission's script may hold the zombies back)
    const tm = S.t / 60,
      alive = S.en.length;
    // scheduled bosses (a scripted mission's come by its script, nor does the lab's gas come; a classic mission's come
    // on time, each one the group named after its kind, so that its script can ask for its death)
    const sched = BOSS_ORDER.map((k, i) => [k, BOSS_AT[i]]);
    if (LV.gas && !S.demo && !scripted(S) && !S.done.hall && S.t >= gasT0(LV)) {
      S.done.hall = 1;
      S.warn = { text: 'hud.gas', t: S.t, col: '#9cff3a', hall: 1 };
    }
    for (const [k, at] of sched)
      if (!S.done[k] && S.t >= at && !S.demo && !scripted(S)) {
        S.done[k] = 1;
        if (S.mis) bossIn(S, LV, k, k);
        else spawnBoss(S, LV, k);
      }
    if (S.arena && !S.boss) {
      /* boss dead: arena stays until results */
    }
    const SR = S.demo ? 1 : D.SPAWN_RATE;
    const lk = lateK(S, tm),
      FEW = lerp1(LATE_FEW, lk);
    let maxAlive =
      Math.min(S.demo ? 160 : 640, 30 + tm * 64) * SR * (S.arena || S.fin ? 0.2 : 1) * lerp1(LATE_CAP, lk) * FEW; // (S.fin: the lab's boss, no ring)
    let more = DT * (S.demo ? 9 : 1.4 + tm * 5.8) * SR * (S.arena || S.fin ? 0.25 : 1) * FEW;
    if (S.ka) {
      maxAlive *= S.ka.spawn;
      more *= S.ka.spawn;
    } // (together: more of them, round each hero)
    S.spawnAcc += more;
    while (S.spawnAcc >= 1) {
      S.spawnAcc--;
      if (alive >= maxAlive) continue;
      const pt = offscreenPoint(S, LV, rnd(S) * TAU, nextHero(S));
      if (pt) spawnAt(S, tm, pt[0], pt[1]);
    }
    // horde from one side, with an edge arrow 2 s before (together: from that side of each hero's view, as many more)
    if (!S.demo && S.t >= S.nextHorde && !S.arena && !S.fin) {
      if (!S.horde) {
        S.horde = {
          a: rnd(S) * TAU,
          t: S.t,
          n: Math.floor((28 + tm * 11) * SR * FEW * (S.ka ? S.ka.spawn : 1)),
          done: false,
        };
      } else if (!S.horde.done && S.t - S.horde.t > 2) {
        S.horde.done = true;
        S.nextHorde = S.t + 45 + rnd(S) * 15;
        for (let i = 0; i < S.horde.n; i++) {
          const pt = offscreenPoint(S, LV, S.horde.a + (rnd(S) - 0.5) * 0.5, nextHero(S));
          if (pt) spawnAt(S, tm, pt[0] + (rnd(S) - 0.5) * 120, pt[1] + (rnd(S) - 0.5) * 80);
        }
      }
    }
    // an elite now and then, and an airdrop (together: one for each hero standing)
    if (!S.demo && S.t >= S.nextElite && S.t > 60 && !S.arena && !S.fin) {
      S.nextElite = S.t + 35 + rnd(S) * 15;
      for (const p of hunted(S)) {
        const pt = offscreenPoint(S, LV, rnd(S) * TAU, p);
        if (pt) addEnemy(S, rpick(S, ['walker', 'armored', 'bloater', 'runner']), pt[0], pt[1], { elite: true });
      }
    }
    if (!S.demo && S.t >= S.nextDrop) {
      S.nextDrop = S.t + 115 + rnd(S) * 20;
      for (const p of hunted(S))
        for (let k = 0; k < 10; k++) {
          const a = rnd(S) * TAU,
            d = 420 + rnd(S) * 260;
          const x = p.x + dcos(a) * d,
            y = p.y + (dsin(a) * d) / YK;
          if (!blockedS(S, LV, x, y, 50) && (!S.arena || m2(x - S.arena.x, y - S.arena.y) < sq(S.arena.r - 80))) {
            S.chests.push(
              S.ps.length > 1 ? { x, y, k: 'air', z: 650, t: S.t, o: p.i } : { x, y, k: 'air', z: 650, t: S.t },
            );
            S.warn = { text: 'hud.airdrop', t: S.t, col: '#ffd23a' };
            break;
          }
        }
    }
  }
  const BOSS_ORDER = ['butcher', 'pustule', 'screamer', 'golem'],
    BOSS_AT = [150, 300, 450, 540]; // the run's bosses and when they come (s)
  function spawnBoss(S, LV, k) {
    S.warn = { text: 'hud.bossWarn', v: { boss: 'bosses.' + k }, boss: k, t: S.t, col: '#ff4a3a' };
    if (D.ENEMIES[k].boss === 'boss') {
      // the final boss: an arena, the fodder outside it cleared
      if (LV.hall) {
        // the lab: no ring — the gas drives the heroes to the hall, the boss waits in its middle
        const [hx, hy] = toS((LV.hall[0] + LV.hall[2]) / 2 + 260, (LV.hall[1] + LV.hall[3]) / 2 + 260);
        S.fin = 1;
        const b = addEnemy(S, k, hx, hy);
        b.st = 'intro';
        b.stT = S.t;
        S.boss = b.id;
        b.phase = 1;
        ev(S, 'arena', hx, hy, { r: 0 });
        return;
      }
      const A = { x: S.p.x, y: S.p.y, r: 900, t: S.t };
      if (S.ps.length > 1) {
        const Hs = hunted(S).length ? hunted(S) : S.ps;
        A.x = Hs.reduce((a, p) => a + p.x, 0) / Hs.length;
        A.y = Hs.reduce((a, p) => a + p.y, 0) / Hs.length;
      } // (together: round them all)
      A.x = clamp(A.x, 1200, WX - 1200);
      A.y = clamp(A.y, 700, WY - 700);
      S.arena = A;
      ev(S, 'arena', A.x, A.y, { r: A.r });
      if (S.ps.length > 1) for (const p of S.ps) if (!p.gone) arenaClamp(A, p, 60); // (a hero far off, or down, brought in)
      for (const e of S.en)
        if (!D.ENEMIES[e.k].boss && m2(e.x - A.x, e.y - A.y) > sq(A.r - 40)) {
          e.dead = true;
        }
      const b = addEnemy(S, k, A.x + (S.p.x < A.x ? 520 : -520), A.y - 160);
      b.st = 'intro';
      b.stT = S.t;
      S.boss = b.id;
      b.phase = 1;
      return;
    }
    const hp = nextHero(S),
      pt = offscreenPoint(S, LV, rnd(S) * TAU, hp) || [hp.x + 700, hp.y];
    const b = addEnemy(S, k, pt[0], pt[1]);
    b.st = 'chase';
    b.stT = S.t;
    b.next = S.t + 2.5;
    const es = D.ENEMIES[k].escort; // its escort: elites in a ring round it (no coin bags)
    if (es)
      for (let i = 0; i < es[1]; i++) {
        const a = (i * TAU) / es[1],
          g = addEnemy(S, es[0], b.x + dcos(a) * 120, b.y + dsin(a) * 60, { elite: true });
        g.guard = b.id;
        g.slot = i;
        g.esc = 1;
      }
    if (!S.en.some((o) => o.id === S.boss && !o.dead)) S.boss = b.id; // keep showing a boss that is still alive
  }

  // ---------- missions (live/missions.js): a campaign mission's tasks, one after another ---------- Each task begins
  // with its actions (go) and, once done, ends with its others (end); the last one done wins the run the way a final
  // boss's death does (won: the zombies left burst, the crystals fly in, the results come). The kinds: reach (the hero
  // within r of a place, the ground metric), take (a pickup the script laid, by its name), kill (a group the script
  // brought in, by its name: every one of them dead), hold (t s). goal() is what the HUD and the tests read of it: the
  // line, the progress, where its arrow points
  function mission(S, LV) {
    const M = S.mis,
      plan = scripts() && scripts()[M.id];
    if (!plan || M.won) return;
    if (M.i < 0) {
      taskStart(S, LV, plan, 0);
      return;
    }
    const k = plan.tasks[M.i];
    if (!taskDone(S, LV, plan, k)) return;
    doActs(S, LV, plan, k.end);
    if (M.i + 1 < plan.tasks.length) taskStart(S, LV, plan, M.i + 1);
    else {
      M.won = 1;
      S.winAt = S.t + 2.5;
      won(S, null);
    }
  }
  function taskStart(S, LV, plan, i) {
    const M = S.mis;
    M.i = i;
    M.t0 = S.t;
    M.k0 = S.kills;
    if (plan.tasks[i].k === 'cross') M.side = sideOf(S.ps[0], LV, plan.tasks[i]);
    doActs(S, LV, plan, plan.tasks[i].go);
  }
  // a cross task's line (marks a to b) and the side of it a hero is on: 1, -1 (0: on it)
  function sideOf(p, LV, k) {
    const [ax, ay] = markAt(LV, k.a),
      [bx, by] = markAt(LV, k.b),
      c = (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
    return c > 0 ? 1 : c < 0 ? -1 : 0;
  }
  // a named group: how many the script brought in (-1: not yet), how many of them still stand
  const groupOf = (M, g) => {
    for (const r of M.gs) if (r[0] === g) return r[1];
    return -1;
  };
  const standing = (S, g) => {
    let n = 0;
    for (const e of S.en) if (e.mg === g && !e.dead) n++;
    return n;
  };
  function taskDone(S, LV, plan, k) {
    const M = S.mis,
      p = S.ps[0];
    if (k.k === 'reach') {
      const [x, y] = markAt(LV, k.at);
      return !p.dead && m2(p.x - x, p.y - y) < k.r * k.r;
    }
    if (k.k === 'cross') {
      const sd = sideOf(p, LV, k);
      return !p.dead && sd !== 0 && sd !== M.side;
    }
    if (k.k === 'take') return M.got.includes(k.n);
    if (k.k === 'kill') return groupOf(M, k.g) >= 0 && standing(S, k.g) === 0;
    if (k.k === 'hold') return S.t - M.t0 >= k.t;
    if (k.k === 'perk') return M.dl >= (k.n || 1) && !p.pause && p.pend <= 0;
    return true;
  }
  // a place a mission's script names: the mark of that name on its map (marks [name, gx, gy], set in the map editor),
  // screen plane; the map's spawn when it has none (test/missions.test.mjs holds every mission's marks to its map)
  function markAt(LV, n) {
    for (const q of LV.marks) if (q[0] === n) return toS(q[1], q[2]);
    return toS(LV.spawn[0], LV.spawn[1]);
  }
  // the marks a mission's script names (live/missions.js): start, and each task's and action's at, each once in the
  // order met (the map editor lists them, the tests hold the maps to them)
  function marksOf(id) {
    const plan = scripts() && Object.prototype.hasOwnProperty.call(scripts(), id) ? scripts()[id] : null,
      out = [];
    if (!plan || plan.classic) return out;
    const add = (n) => {
      if (typeof n === 'string' && !out.includes(n)) out.push(n);
    };
    add('start');
    for (const k of plan.tasks) {
      add(k.at);
      add(k.a);
      add(k.b);
      for (const a of (k.go || []).concat(k.end || [])) add(a.at);
    }
    return out;
  }
  // where an action happens (screen plane): a place the script names (at), or a free spot near the hero (near: that
  // far, the ground metric; the hero's own spot when none is free)
  function spotOf(S, LV, plan, a) {
    if (a.at) return markAt(LV, a.at);
    const p = S.ps[0];
    for (let k = 0; k < 12; k++) {
      const an = p.aim + (k * TAU) / 12,
        x = p.x + dcos(an) * a.near,
        y = p.y + (dsin(an) * a.near) / YK;
      if (!blockedS(S, LV, x, y, 30)) return [x, y];
    }
    return [p.x, p.y];
  }
  function doActs(S, LV, plan, list) {
    const M = S.mis,
      p = S.ps[0];
    for (const a of list || []) {
      if (a.a === 'director') M.dir = a.on ? 1 : 0;
      else if (a.a === 'voice') ev(S, 'voice', p.x, p.y, { id: a.id });
      else if (a.a === 'drop') {
        // a supply crate down by parachute (drawn and opened as an airdrop), holding exactly what the script gives
        // (crateCards)
        const [x, y] = spotOf(S, LV, plan, a);
        S.chests.push({ x, y, k: 'air', z: a.ground ? 0 : 650, t: S.t, n: a.n, give: a.give });
        if (!a.ground) S.warn = { text: 'hud.airdrop', t: S.t, col: '#ffd23a' }; // (ground: lying there already)
      } else if (a.a === 'place') {
        const [x, y] = spotOf(S, LV, plan, a); // (lying still where it is put: no toss)
        S.pk.push({ k: a.k, n: a.n, x, y, v: 1, m: 0, vx: 0, vy: 0, z: 0, vz: 0, t: S.t });
      } else if (a.a === 'group') groupIn(S, LV, plan, a);
      else if (a.a === 'wake') {
        for (const e of S.en) if (e.mg === a.g) e.post = 0; // (standing at their posts no more: they hunt)
      } else if (a.a === 'open') {
        if (!M.open.includes(a.g)) M.open.push(a.g);
      } else if (a.a === 'boss') bossIn(S, LV, a.k, a.g);
      else if (a.a === 'hint') M.hint = { id: a.id, t: S.t, item: a.item };
      else if (a.a === 'level') {
        // the bar topped up to the next level, unless one is on its way already
        if (p.pend <= 0 && !p.pause) {
          p.xp = Math.max(p.xp, p.need);
          addXp(S, 0);
        }
      } else if (a.a === 'hurt') {
        // quietly (no number, no flash): share of the max health off, never below floor of it (full: only from full
        // health, so the medkit that comes next has something to heal)
        if (!a.full || p.hp >= p.maxHp) p.hp = Math.min(p.hp, Math.max(p.hp - p.maxHp * a.share, p.maxHp * a.floor));
      }
    }
  }
  // a task that holds the hero's levels back (lv: 0): the crystals fill the bar to just short of the next level
  function lvHeld(S) {
    const M = S.mis;
    if (!M || M.won || M.i < 0) return false;
    const plan = scripts() && scripts()[M.id],
      k = plan && plan.tasks[M.i];
    return !!k && k.lv === 0;
  }
  // the script's next card screen (plan.deal, one per level up until they run out; its voice line with it), or null
  function dealt(S) {
    const M = S.mis,
      plan = M && scripts() ? scripts()[M.id] : null,
      d = plan && plan.deal && plan.deal[M.dl | 0];
    if (!d) return null;
    M.dl = (M.dl | 0) + 1;
    if (d.voice) ev(S, 'voice', S.p.x, S.p.y, { id: d.voice });
    return d.cards.map(([ty, id, lock]) => (lock ? { ty, id, lvl: 1, lock: 1 } : { ty, id, lvl: 1 }));
  }
  // a boss in a mission run (its script's, or a classic mission's on its schedule): it comes as a run's does
  // (spawnBoss), as the group g (its escort not in it)
  function bossIn(S, LV, k, g) {
    const n0 = S.nid;
    S.done[k] = 1;
    spawnBoss(S, LV, k);
    let n = 0;
    for (const e of S.en)
      if (e.id >= n0 && e.k === k) {
        e.mg = g;
        n++;
      }
    S.mis.gs.push([g, n]);
  }
  // a named group round a place: of [[kind, how many, elite, drop], …], each a little further round the middle (a
  // sunflower's spiral, the next free spot of a few); post: they stand there until the hero comes within that much or
  // one of them is hurt (updateEnemies), or a wake action; drop: the first of that kind leaves that pickup where it
  // dies, named so (a take task waits for it); bare: they leave nothing else (no crystals, coins or pickups)
  function groupIn(S, LV, plan, a) {
    const [cx, cy] = spotOf(S, LV, plan, a);
    let n = 0;
    for (const [kind, count, elite, drop] of a.of)
      for (let c = 0; c < count; c++, n++) {
        let x = cx,
          y = cy;
        for (let k = 0; k < 6; k++) {
          const an = n * 2.39996 + k * 0.9,
            d = 46 * Math.sqrt(n + 1) + k * 30;
          x = cx + dcos(an) * d;
          y = cy + (dsin(an) * d) / YK;
          if (!blockedS(S, LV, x, y, 20)) break;
        }
        const e = addEnemy(S, kind, x, y, { elite: !!elite });
        e.mg = a.g;
        if (a.post) e.post = a.post;
        if (drop && !c) e.drop = drop;
        if (a.bare) e.bare = 1;
      }
    S.mis.gs.push([a.g, n]);
  }
  // a supply crate's cards (opened by hero S.p): give.items each new (a level up where it is held already; none past
  // the slots), and give.main levels on the main gun at once (one card: to, from the level it is at to lvl)
  function crateCards(S, give) {
    const p = S.p,
      out = [];
    let room = D.MAX_ITEMS - p.items.length;
    for (const id of give.items || []) {
      if (!D.ITEMS[id]) continue;
      const it = p.items.find((j) => j.id === id);
      if (it) {
        if (it.lvl < maxL(id)) out.push({ ty: 'up', id, lvl: it.lvl + 1 });
      } else if (room > 0) {
        room--;
        out.push({ ty: 'new', id, lvl: 1 });
      }
    }
    if (give.main && p.main.lvl < 5)
      out.push({ ty: 'main', id: p.main.id, lvl: Math.min(5, p.main.lvl + give.main), to: 1, from: p.main.lvl });
    if (!out.length) out.push({ ty: 'gold', id: 'coin', lvl: 0 });
    return out;
  }
  // what the HUD shows of a mission run (null: none, or not begun, or won): key (the goal's language key), k (the
  // task's kind), n / of (a group's dead / brought in), left (a hold's seconds to go), at (where its arrow points,
  // screen plane: the place, the pickup, the pickup the task says to use first (pk: 1), the group's nearest one
  // standing; null: no arrow). Reads the state only
  function goal(S) {
    const M = S.mis,
      plan = M && scripts() ? scripts()[M.id] : null;
    if (!plan || M.i < 0 || M.won) return null;
    const k = plan.tasks[M.i],
      o = { key: k.goal, k: k.k, n: 0, of: 0, left: 0, at: null };
    if (k.k === 'reach') o.at = markAt(level(S.seed), k.at);
    else if (k.k === 'cross') {
      const LV = level(S.seed),
        [ax, ay] = markAt(LV, k.a),
        [bx, by] = markAt(LV, k.b);
      o.at = [(ax + bx) / 2, (ay + by) / 2];
    } else if (k.k === 'take') o.at = pickAt(S, k.n);
    else if (k.k === 'kill') {
      const of = groupOf(M, k.g);
      o.of = Math.max(0, of);
      o.n = Math.max(0, of - standing(S, k.g));
      const via = k.arrow ? pickAt(S, k.arrow) : null;
      o.at = via || nearestOf(S, k.g);
      if (via) o.pk = 1;
    } else if (k.k === 'hold') o.left = Math.max(0, k.t - (S.t - M.t0));
    return o;
  }
  function pickAt(S, n) {
    for (const o of S.pk) if (o.n === n) return [o.x, o.y];
    for (const c of S.chests) if (c.n === n) return [c.x, c.y];
    return null;
  }
  function nearestOf(S, g) {
    const p = S.ps[0];
    let b = null,
      bd = Infinity;
    for (const e of S.en) {
      if (e.mg !== g || e.dead) continue;
      const d2 = m2(e.x - p.x, e.y - p.y);
      if (d2 < bd) {
        bd = d2;
        b = [e.x, e.y];
      }
    }
    return b;
  }

  // ---------- enemies ----------
  // the hero a zombie goes for: alone the hero; together the nearest one standing (a boss keeps to the one it has unless another is a
  // good deal nearer: e.tg)
  function targetOf(S, e, boss) {
    const H = S.ps;
    if (H.length === 1) return H[0];
    let best = null,
      bd = Infinity;
    for (const p of H) {
      if (p.dead) continue;
      let d2 = m2(p.x - e.x, p.y - e.y);
      if (boss && e.tg === p.i) d2 *= 0.5;
      if (d2 < bd) {
        bd = d2;
        best = p;
      }
    }
    if (!best) return lead(S);
    if (boss) e.tg = best.i;
    return best;
  }
  function updateEnemies(S, LV) {
    const out = SC.out1,
      t = S.t,
      H = S.ps;
    for (let i = 0; i < S.en.length; i++) {
      const e = S.en[i];
      if (e.dead) continue;
      const d = D.ENEMIES[e.k],
        p = H.length === 1 ? H[0] : targetOf(S, e, !!d.boss);
      if (e.popT !== undefined && t >= e.popT) {
        if (Math.abs(e.x - p.x) < 1200 && Math.abs(e.y - p.y) < 700)
          ev(S, 'boom', e.x, e.y - 30, { r: 70, kind: 'fire' });
        kill(S, e, { pop: 1 });
        continue;
      } // the run won: it bursts (seen on screen)
      if (t - e.spT < 0.35) continue; // rising out of the ground
      if (d.bomb && e.fuse !== undefined && t - e.fuse >= d.bomb.fuse) {
        kill(S, e, null);
        continue;
      } // a bomber's fuse burnt down
      let dx = p.x - e.x,
        dy = p.y - e.y,
        dist = Math.sqrt(m2(dx, dy)) || 1;
      let spd = e.spd * (e.buffT > t ? 1.6 : 1) * (e.slowT > t ? 0.5 : 1);
      let tx = dx / dist,
        ty = (dy / dist) * YK; // direction in screen px
      const stun = e.stunT > t; // chain lightning: frozen in place, harmless
      if (stun) {
        const k = dexp(-DT * 18);
        e.vx *= k;
        e.vy *= k;
      } else if (d.boss) {
        bossAI(S, LV, e, d, dist, p);
      } else {
        // a boss's escort keeps its place in the ring round it (turning slowly) until the hero comes close to it or to the boss; a spitter
        // keeps it and shoots from there. With the boss dead it is an ordinary zombie
        const g = e.guard ? guardOf(S, e.guard) : null;
        if (e.guard && !g) e.guard = 0;
        // (a mission's guard, e.post: stands at its post until the hero comes within that much or it is hurt; then it
        // hunts)
        if (e.post && (dist < e.post || e.hp < e.max)) e.post = 0;
        if (e.post) spd = 0;
        const hold = !!g && (d.ranged || (dist > 300 && m2(p.x - g.x, p.y - g.y) > 450 * 450));
        if (hold) {
          const n = D.ENEMIES[g.k].escort[1],
            a = (e.slot * TAU) / n + t * 0.4,
            gx = g.x + dcos(a) * 120 - e.x,
            gy = g.y + dsin(a) * 60 - e.y,
            gd = Math.sqrt(m2(gx, gy)) || 1;
          tx = gx / gd;
          ty = (gy / gd) * YK;
          spd = Math.min(Math.max(e.spd, g.spd) * 1.4, gd * 4);
        } else if (dist > 300 || (LV.walled && walledOff(e, p))) {
          const fi = flowIdx(e.x, e.y),
            fx = nav.fx[fi],
            fy = nav.fy[fi];
          if (fx || fy) {
            tx = tx * 0.25 + fx * 0.75;
            ty = ty * 0.25 + fy * 0.75;
          }
        }
        if (d.bomb) {
          if (e.fuse === undefined && dist < d.bomb.near && !p.dead) {
            e.fuse = t;
            ev(S, 'fuse', e.x, e.y, { r: d.bomb.r });
          } // close: it stops and swells
          if (e.fuse !== undefined) spd = 0;
        }
        if (d.ranged) {
          if (dist < 380 && !hold) {
            tx = -tx * 0.5;
            ty = -ty * 0.5;
          }
          e.cd -= DT;
          if (e.cd <= 0 && dist < 620 && !p.dead) {
            e.cd = 2.6 + rnd(S);
            e.spitT = t;
            const sp = 330,
              a = datan2(p.y - 30 - (e.y - 60), p.x - e.x);
            const tt = dhypot(p.x - e.x, p.y - 30 - (e.y - 60)) / sp; // from 60 px up to the hero's 30
            S.eb.push({
              k: 'acid',
              x: e.x,
              y: e.y - 60,
              vx: dcos(a) * sp,
              vy: dsin(a) * sp,
              life: 2.2,
              dmg: 10 * (1 + t / 600),
              r: 18,
              t0: t,
              z: 60,
              dz: -30 / Math.max(0.1, tt),
            });
            ev(S, 'spit', e.x, e.y - 60, { a });
          }
        }
        const tm = dhypot(tx, ty) || 1;
        e.vx += ((tx / tm) * spd - e.vx) * Math.min(1, DT * 6);
        e.vy += ((ty / tm) * spd * 0.75 - e.vy) * Math.min(1, DT * 6);
      }
      // separation (ground metric), every other step per enemy
      if ((S.steps + i) % 2 === 0 && !d.boss) {
        const n = query(e.x, e.y, 56, 30, out);
        let sx = 0,
          sy = 0,
          cnt = 0;
        for (let k = 0; k < n && cnt < 20; k++) {
          const o = S.en[out[k]];
          if (o === e || o.dead) continue;
          const ddx = e.x - o.x,
            ddy = (e.y - o.y) * YK,
            d2 = ddx * ddx + ddy * ddy,
            rr2 = (e.r + o.r) * 1.15;
          if (d2 < rr2 * rr2) {
            cnt++;
            const dd = Math.sqrt(d2) || 0.01,
              f = (rr2 - dd) / rr2,
              w = D.ENEMIES[o.k].boss ? 3 : 1;
            sx += (d2 > 0.01 ? ddx / dd : dcos(e.id)) * f * w;
            sy += (d2 > 0.01 ? ddy / dd : dsin(e.id)) * f * w;
          }
        }
        e.x += sx * 210 * DT * 2;
        e.y += sy * 105 * DT * 2;
      }
      const ox = e.x,
        oy = e.y;
      e.x += (e.vx + e.kx) * DT;
      e.y += (e.vy + e.ky) * DT;
      const kd = d.boss ? KD14 : KD9;
      e.kx *= kd;
      e.ky *= kd;
      if (!d.boss && (S.steps + i) % 2 === 0) collide(S, LV, e, e.r * 0.8);
      if (S.arena) {
        const inside = m2(ox - S.arena.x, oy - S.arena.y) < S.arena.r * S.arena.r;
        if (inside) arenaClamp(S.arena, e, 20);
      }
      const mv = dhypot(e.x - ox, e.y - oy);
      e.dist += mv;
      if (d.b3d) {
        // a 3D boss: walked ground distance, and its facing
        e.gd = (e.gd || 0) + Math.min(dhypot(e.x - ox, (e.y - oy) * YK), d.speed * 3 * DT); // (shoved or flung: the legs at most 3× their pace;
        // yaw: 0 faces the viewer, + turns toward the screen's right),
        const sp = dhypot(e.vx, e.vy),
          tx = sp > 15 ? e.vx : p.x - e.x,
          tz = sp > 15 ? e.vy * YK : (p.y - e.y) * YK; // to where it goes, standing: the hero
        let dy = datan2(tx, tz) - (e.yaw ?? 0);
        dy = datan2(dsin(dy), dcos(dy));
        const mx = (e.st === 'dash' ? 14 : 6) * DT; // turning at most 6 rad/s
        e.yaw = (e.yaw ?? datan2(tx, tz)) + Math.max(-mx, Math.min(mx, dy));
      }
      if (Math.abs(e.vx) > 4) e.face = e.vx > 0 ? 1 : -1;
      // contact damage
      if (!p.dead && !stun && dist < e.r + HERO.r + 4 && !(d.boss && e.st === 'air')) hurtPlayer(S, p, e.dmg, e.x, e.y);
      // burning (the fire is the hero's who set it: e.bo)
      if (e.burnT > t) {
        e.burnAcc = (e.burnAcc || 0) + DT;
        if (e.burnAcc > 0.33) {
          e.burnAcc = 0;
          const was = S.p;
          S.p = H[e.bo | 0] || was;
          damage(S, e, e.burnD * 0.33, 0, 0, false, null, true);
          if (e.nap && !e.dead) spreadFire(S, e);
          S.p = was;
        }
      } else if (e.nap) e.nap = 0;
      if (e.sawT > 0) e.sawT -= DT;
    }
  }
  function damage(S, e, dmg, kx, ky, crit, src, quiet) {
    if (e.dead) return;
    const d = D.ENEMIES[e.k];
    if (d.armor) dmg *= 1 - d.armor;
    if (d.boss && e.st === 'air') return;
    e.hp -= dmg;
    if (!quiet && S.t - e.fl > 0.16) {
      e.fl = S.t;
      e.ha = kx || ky ? datan2(ky, kx) : null;
    } // flash + recoil away from the hit
    const res = d.boss ? 0.08 : 1 / (d.mass || 1);
    e.kx += kx * res;
    e.ky += ky * res * 0.6;
    // damage numbers: crits, bosses, elites and big hits at once; the rest summed per enemy, at most one number per 0.3 s
    const area = !!(src && src.area); // area weapons hit crowds: no per-zombie numbers
    if (area) {
      /* the bolt / flame wall is the feedback */
    } else if (crit || d.boss || e.elite || dmg >= 0.25 * e.max)
      ev(S, 'dmg', e.x, e.y - d.h * 0.9, { v: Math.round(dmg), c: crit ? 1 : 0 });
    else {
      e.dacc = (e.dacc || 0) + dmg;
      if (S.t - (e.dnT ?? -9) > 0.3 || e.hp <= 0) {
        e.dnT = S.t;
        ev(S, 'dmg', e.x, e.y - d.h * 0.9, { v: Math.round(e.dacc), c: 0 });
        e.dacc = 0;
      }
    }
    if (!quiet) ev(S, 'hit', e.x, e.y - d.h * 0.45, { a: datan2(ky, kx), b: d.boss ? 2 : 1 });
    if (e.hp <= 0) kill(S, e, src);
  }
  function kill(S, e, src) {
    e.dead = true;
    const d = D.ENEMIES[e.k],
      p = S.p,
      t = S.t; // (p: the hero whose shot, blast or fire it was)
    S.kills++;
    p.kills = (p.kills || 0) + 1;
    if (p.st.fang) {
      p.fk = (p.fk || 0) + 1;
      if (p.fk >= p.st.fang.n) {
        p.fk = 0;
        heal(S, p.st.fang.hp);
      }
    }
    ev(S, 'die', e.x, e.y, {
      ek: e.k,
      f: e.face,
      el: e.elite ? 1 : 0,
      s: e.r / d.r,
      fly: src && src.bx !== undefined && !d.boss ? 1 : 0,
    });
    decal(S, 'blood', e.x, e.y, d.boss ? 3 : e.k === 'bloater' ? 1.6 : 1, 26);
    if (!d.explode && !d.bomb && !(src && src.pop)) addCorpse(S, e, d, src);
    if (d.boss) S.hs = 0.25;
    // drops (a mission's: e.drop, its named pickup; a bare one leaves nothing else)
    const luck = p.st.luck;
    let xp = d.xp * (e.elite ? 10 : 1);
    if (e.drop) S.pk.push({ k: e.drop, n: e.drop, x: e.x, y: e.y, v: 1, m: 0, vx: 0, vy: 0, z: 0, vz: 0, t: S.t });
    if (e.bare) xp = 0;
    else if (d.boss) {
      if (d.xp)
        for (let i = 0; i < 10; i++) dropGem(S, e.x + rr(S, -80, 80), e.y + rr(S, -40, 40), Math.ceil(d.xp / 10) * 2);
    } else dropGem(S, e.x, e.y, xp);
    const bag = e.elite && !e.esc && !e.bare; // (a boss's escort: no coin bag)
    if (!e.bare && (rnd(S) < (S.ck ? 0.025 * luck * S.ck.coin : 0.025 * luck) || bag))
      dropPk(S, 'coin', e.x, e.y, bag ? 10 : 1); // (together: the coins are everyone's — fewer drop)
    if (!e.bare && !e.drop) {
      if (e.elite) dropPk(S, rpick(S, ['medkit', 'magnet', 'bomb']), e.x + 20, e.y);
      else if (rnd(S) < 0.0025 * luck) dropPk(S, rpick(S, ['medkit', 'magnet', 'bomb']), e.x, e.y);
    }
    if (d.explode) blast(S, e.x, e.y - 20, 120, 60, { kind: 'acid', hurt: 22, chain: src && src.chain });
    if (d.bomb)
      blast(S, e.x, e.y, d.bomb.r, d.bomb.dmg, { kind: 'fire', hurt: e.dmg * d.bomb.hurt, chain: src && src.chain });
    if (src && src.chain) src.chain.k++;
    if (d.boss) {
      S.bk = (S.bk || 0) + 1;
      ev(S, 'bossdie', e.x, e.y, { ek: e.k });
      for (let i = 0; i < 25; i++) dropPk(S, 'coin', e.x + rr(S, -90, 90), e.y + rr(S, -40, 40), 3);
      if (S.boss === e.id) {
        const nb = S.en.find((o) => !o.dead && o !== e && D.ENEMIES[o.k].boss);
        S.boss = nb ? nb.id : 0;
      }
      if (d.boss === 'boss') {
        blast(S, e.x, e.y - 60, 260, 0, { kind: 'fire' });
        S.winAt = S.t + 2.5;
        won(S, e);
      } else if (S.ps.length === 1) S.chests.push({ x: e.x, y: e.y, k: 'boss', z: 60, t: S.t });
      else {
        const hs = S.ps.filter((o) => !o.gone && !o.out),
          n = hs.length;
        for (let i = 0; i < n; i++)
          S.chests.push({ x: e.x + (i - (n - 1) / 2) * 110, y: e.y, k: 'boss', z: 60, t: S.t, o: hs[i].i });
      } // (together: one each, its own: D.COOP.lock)
      banner(S, 'hud.bossDown', d.boss === 'boss' ? null : 'hud.chest', null, '#ffd23a', { boss: 'bosses.' + e.k });
    }
    // combos
    if (t - S.mk.t0 > 0.45) {
      S.mk.n = 0;
      S.mk.t0 = t;
      S.mk.shown = 0;
    }
    S.mk.n++;
    if (S.mk.n >= 12 + Math.floor(t / 60) * 3 && !S.mk.shown && t - (S.lastSB ?? -99) > 10) {
      S.mk.shown = 1;
      S.lastSB = t;
      const bx = bonusXp(S, 40);
      banner(S, 'hud.multi', 'hud.elim', 'hud.xpGain', '#5cf0ff', { n: S.mk.n, xp: bx });
      addXp(S, bx);
    }
    if (t - S.lastKill > 2.5) S.streak = 0;
    S.streak++;
    S.lastKill = t;
    if (S.streak % 50 === 0 && t - (S.lastSB ?? -99) > 10) {
      S.lastSB = t;
      const bx = bonusXp(S, 50);
      banner(S, 'hud.streak', 'hud.dontStop', 'hud.xpGain', '#ff5a3a', { m: S.streak, xp: bx });
      addXp(S, bx);
    }
  }
  // corpses stay on the ground (the newest 64). A blast throws the body: a ballistic arc away from the centre with a spin,
  // a thud where it lands (moved back along the arc if that spot is inside a wall)
  const GRAV = 1500;
  function addCorpse(S, e, d, src) {
    const c = {
      x: e.x,
      y: e.y,
      ek: e.k,
      f: e.face,
      s: e.r / d.r,
      t: S.t,
      el: e.elite ? 1 : 0,
      fd: rnd(S) < 0.75 ? 1 : -1,
      yaw: e.yaw,
    };
    if (src && src.bx !== undefined && !d.boss) {
      const dx = e.x - src.bx,
        dy = (e.y - src.by) * YK,
        dd = dhypot(dx, dy) || 1,
        k = clamp(1 - dd / (src.br + 60), 0.25, 1),
        m = Math.sqrt(d.mass || 1);
      const sp = ((200 + 300 * k) * rr(S, 0.8, 1.15)) / m,
        vx = (dx / dd) * sp,
        vy = ((dy / dd) * sp) / YK;
      c.vz = ((360 + 380 * k) * rr(S, 0.85, 1.1)) / Math.sqrt(m);
      c.T = (2 * c.vz) / GRAV;
      c.spin = (rnd(S) < 0.5 ? -1 : 1) * rr(S, 6, 11);
      const LV = level(S.seed);
      let q = 1;
      while (q > 0 && blockedS(S, LV, e.x + vx * c.T * q, e.y + vy * c.T * q, 8)) q -= 0.25;
      c.vx = vx * q;
      c.vy = vy * q;
      c.x1 = clamp(e.x + c.vx * c.T, 40, WX - 40);
      c.y1 = clamp(e.y + c.vy * c.T, 40, WY - 40);
      c.f = vx > 0 ? -1 : 1; // thrown backwards: faces the blast
    }
    S.corpses.push(c);
    if (S.corpses.length > 64) S.corpses.shift();
  }
  function updateCorpses(S) {
    for (const c of S.corpses)
      if (c.T && !c.land && S.t - c.t >= c.T) {
        c.land = 1;
        ev(S, 'thud', c.x1, c.y1, { s: c.s });
      }
  }
  function dropGem(S, x, y, v) {
    if (S.gems.length >= 450) {
      const g = S.gems[Math.floor(rnd(S) * S.gems.length)];
      g.v += v;
      return;
    }
    const a = rnd(S) * TAU;
    S.gems.push({
      x,
      y,
      v,
      m: 0,
      vx: dcos(a) * rr(S, 30, 90),
      vy: dsin(a) * rr(S, 15, 45),
      z: 10,
      vz: rr(S, 120, 220),
      t: S.t,
    });
  }
  function dropPk(S, k, x, y, v = 1) {
    const a = rnd(S) * TAU;
    if (S.pk.length >= 240) {
      const j = S.pk.findIndex((o) => !o.n); // the oldest, but never one a mission's task waits for
      S.pk.splice(j < 0 ? 0 : j, 1);
    }
    S.pk.push({
      k,
      x,
      y,
      v,
      m: 0,
      vx: dcos(a) * rr(S, 40, 110),
      vy: dsin(a) * rr(S, 20, 55),
      z: 10,
      vz: rr(S, 160, 260),
      t: S.t,
    });
  }

  // ---------- bosses ----------
  // p: the hero it goes for (targetOf); its attacks hurt whichever heroes they catch
  function bossAI(S, LV, e, d, dist, p) {
    const t = S.t,
      age = t - e.stT,
      K = d.pow || 1; // K: a miniboss's hurts ×
    const near = (h) => Math.sqrt(m2(h.x - e.x, h.y - e.y)) || 1; // (as dist is for p)
    const slow = e.slowT > t ? 0.5 : 1; // chain lightning
    const chase = (k = 1) => {
      let dx = p.x - e.x,
        dy = p.y - e.y;
      const m = dhypot(dx, dy) || 1;
      dx /= m;
      dy /= m;
      if (dist > 300 && d.boss !== 'boss' && blockedS(S, LV, e.x + dx * 70, e.y + dy * 35, e.r * 0.6))
        e.navT = t + 1.5; // a wall ahead: round it
      else if (LV.walled && d.boss !== 'boss' && walledOff(e, p)) e.navT = t + 0.5; // (the lab: a wall between, however close)
      if (t < (e.navT || 0)) {
        const fi = flowIdx(e.x, e.y),
          fx = nav.fx[fi],
          fy = nav.fy[fi] / YK,
          fm = dhypot(fx, fy); // (the field's y is in the ground metric)
        if (fm > 0) {
          dx = dx * 0.1 + (fx / fm) * 0.9;
          dy = dy * 0.1 + (fy / fm) * 0.9;
          const n = dhypot(dx, dy) || 1;
          dx /= n;
          dy /= n;
        }
      }
      e.vx += (dx * e.spd * k * slow - e.vx) * Math.min(1, DT * 4);
      e.vy += (dy * e.spd * k * slow * 0.75 - e.vy) * Math.min(1, DT * 4);
    };
    const stop = () => {
      e.vx *= 0.85;
      e.vy *= 0.85;
    };
    const go = (st) => {
      e.st = st;
      e.stT = t;
    };
    if (e.k === 'butcher') {
      // the scientist: one of his screams (scr), then the charge
      // the charge runs the red line as it is drawn: from where he stands, as far as DASH_L or up to the first wall or car on the way
      // (the line stops there too), and hurts the hero once if he stands within the line's width when the charge reaches his spot
      const ux = dcos(e.ang ?? 0),
        uy = dsin(e.ang ?? 0);
      if (e.st === 'chase') {
        chase();
        if (t > e.next && dist < 800) {
          go('wind');
          e.scr = Math.floor(rnd(S) * 2);
          e.ang = datan2(p.y - e.y, p.x - e.x);
          e.lx = e.x;
          e.ly = e.y;
          e.ll = dashLen(S, LV, e);
          e.dhit = 0;
          S.tele.push({ k: 'line', x: e.x, y: e.y, a: e.ang, len: e.ll, w: DASH_W, t0: t, dur: 0.8 });
        }
      } else if (e.st === 'wind') {
        stop();
        if (age > 0.8) {
          go('dash');
          e.x = e.lx;
          e.y = e.ly;
          ev(S, 'dash', e.x, e.y, { a: e.ang });
        }
      } else if (e.st === 'dash') {
        const sb = (e.x - e.lx) * ux + (e.y - e.ly) * uy; // how far along the line he has come
        for (const h of S.ps) {
          const bit = 1 << h.i;
          if (e.dhit & bit || h.dead) continue;
          const rx = h.x - e.lx,
            ry = h.y - e.ly,
            sh = rx * ux + ry * uy; // (e.dhit: the heroes it has hit, one bit each)
          if (
            Math.abs(rx * uy - ry * ux) < DASH_W / 2 + HERO.r &&
            sh > -e.r &&
            sh < e.ll + e.r &&
            sh < sb + e.r &&
            h.ifr <= 0
          ) {
            hurtPlayer(S, h, e.dmg, e.x, e.y);
            e.dhit |= bit;
          }
        }
        if (sb >= e.ll || age > DASH_L / DASH_V + 0.15) {
          e.vx = 0;
          e.vy = 0;
          go('rec');
          ev(S, 'slam', e.x, e.y, { r: 110 });
        } else {
          e.vx = ux * DASH_V;
          e.vy = uy * DASH_V;
        }
      } else if (e.st === 'rec') {
        stop();
        if (age > 0.6) {
          go('chase');
          e.next = t + 3.2;
        }
      }
    } else if (e.k === 'pustule') {
      if (e.globT === undefined) e.globT = t + 2.5;
      if (e.st === 'chase') {
        chase();
        if (t > e.next) {
          go('swell');
        } else if (t > e.globT && dist < 900 && !p.dead) go('spit');
      } else if (e.st === 'spit') {
        stop();
        if (age > 0.55) {
          // acid balls: one at the hero (led), the rest round him; a green mark where each lands
          const AR = d.acid || 1; // (her acid's radii ×)
          go('chase');
          e.globT = t + 4.2 + rnd(S) * 1.2;
          ev(S, 'spit', e.x, e.y - 150, { a: datan2(p.y - e.y, p.x - e.x), big: 1 });
          const n = e.hp < e.max * 0.5 ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const a = rnd(S) * TAU,
              dd = i ? rr(S, 90, 240) : 0,
              x1 = p.x + dcos(a) * dd + p.vx * 0.5,
              y1 = p.y + (dsin(a) * dd) / YK + p.vy * 0.5,
              dur = 1.05 + 0.12 * i;
            S.eb.push({
              k: 'glob',
              x0: e.x,
              y0: e.y - 150,
              x1,
              y1,
              t0: t,
              dur,
              dmg: 16 * K,
              pw: K,
              r: 70 * AR,
              pr: 62 * AR,
              x: e.x,
              y: e.y - 150,
            });
            S.tele.push({ k: 'mark', x: x1, y: y1, r: 70 * AR, t0: t, dur, col: 1 });
          }
        }
      } else if (e.st === 'swell') {
        stop();
        if (age > 0.8) {
          go('chase');
          e.next = t + 5;
          ev(S, 'pop', e.x, e.y - 100);
          const n = Math.min(6 + Math.floor(rnd(S) * 3), 24 - S.en.filter((o) => !o.dead && o.mom === e.id).length);
          for (let i = 0; i < n; i++) {
            const a = rnd(S) * TAU;
            const z = addEnemy(S, 'runner', e.x + dcos(a) * 90, e.y + dsin(a) * 45);
            z.kx = dcos(a) * 400;
            z.ky = dsin(a) * 200;
            z.mom = e.id;
          }
          for (let i = 0, AR = d.acid || 1; i < 3; i++) {
            const a = rnd(S) * TAU,
              dd = rr(S, 80, 220) * AR;
            S.pud.push({
              x: e.x + dcos(a) * dd,
              y: e.y + (dsin(a) * dd) / YK,
              r: rr(S, 55, 80) * AR,
              t0: t,
              dur: 7,
              pw: K,
            });
          }
        }
      }
    } else if (e.k === 'screamer') {
      // pull: the hero shoved toward her (a = shove per second of push speed, as hurtPlayer's knock), stopping short of her body
      const pull = (h, a) => {
        if (h.dead) return;
        const dx = e.x - h.x,
          dy = e.y - h.y,
          m = dhypot(dx, dy);
        if (m < e.r + HERO.r + 40) return;
        h.pushX += (dx / m) * a * DT;
        h.pushY += (dy / m) * a * DT;
      };
      const RX = d.reach || 1,
        SR = 645 * RX; // the scream's reach (ground metric), shown by the ring
      if (e.st === 'chase') {
        if (dist > 340) chase();
        else chase(-0.4);
        if (t > e.next && dist < 700) {
          e.alt = (e.alt || 0) + 1; // her two attacks in turn: the scream, the sonic wave
          if (e.alt % 2) {
            go('wind');
            S.tele.push({ k: 'ring', x: e.x, y: e.y, r: SR, t0: t, dur: 0.8 });
          } else {
            go('cast');
            e.castW = 0;
          }
        }
      } else if (e.st === 'cast') {
        stop(); // arms flung wide: a sonic wave rolls out, hurting where its front passes
        if (!e.castW && age > 0.55) {
          e.castW = 1;
          S.eb.push({
            k: 'wave',
            sonic: 1,
            x: e.x,
            y: e.y,
            t0: t,
            dur: 1.2 * RX,
            r0: 60 * RX,
            r1: 680 * RX,
            dmg: 14 * K,
            hm: 0,
          });
          ev(S, 'scream', e.x, e.y - 160, { r: 300 * RX });
        }
        if (age > 1.07) {
          go('chase');
          e.next = t + 4.5;
        }
      } else if (e.st === 'wind') {
        stop();
        if (age > 0.8) {
          go('howl');
          e.howlT = t;
          ev(S, 'scream', e.x, e.y - 160, { r: SR });
          for (const o of S.en) if (!o.dead && o !== e && m2(o.x - e.x, o.y - e.y) < 780 * 780) o.buffT = t + 6;
          for (const h of S.ps) {
            const dh = near(h);
            if (dh < SR) {
              hurtPlayer(S, h, (18 - (8 * dh) / SR) * K, e.x, e.y);
              pull(h, 380 / DT);
            }
          } // caught in the ring: hurt and yanked toward her
        }
      } else if (e.st === 'howl') {
        stop();
        if (t - e.howlT >= 0.3) {
          e.howlT = t;
          ev(S, 'howl', e.x, e.y - 160, { r: SR });
          for (const h of S.ps) if (near(h) < SR) hurtPlayer(S, h, 7 * K, e.x, e.y);
        } // stay in the ring and it keeps hurting
        for (const h of S.ps) if (near(h) < SR) pull(h, 1050); // and drags the hero in (at 2/3 of a walk: running away gets out)
        if (age > 1.5) {
          go('chase');
          e.next = t + 5.5;
        }
      }
    } else if (d.boss === 'boss') finalAI(S, LV, e, d, dist, chase, stop, go, age, p);
    if (e.st !== 'air' && d.boss !== 'boss') collide(S, LV, e, e.r * 0.6);
  }
  // the butcher's charge: its speed (px/s), its longest run (px), the red line's width (px); dashLen: how far along the line it gets — the
  // charge run ahead with the same steps and collisions (it slides past a crate it grazes, stops at a car it meets head on, and the line
  // ends where it would leave the line's width)
  const DASH_V = 1000,
    DASH_L = 620,
    DASH_W = 90;
  function dashLen(S, LV, e) {
    const ux = dcos(e.ang),
      uy = dsin(e.ang),
      o = { x: e.x, y: e.y };
    let got = 0;
    for (let i = 0; i < 200; i++) {
      o.x += ux * DASH_V * DT;
      o.y += uy * DASH_V * DT;
      collide(S, LV, o, e.r * 0.6);
      const rx = o.x - e.x,
        ry = o.y - e.y,
        along = rx * ux + ry * uy;
      if (along <= got + 1 || Math.abs(rx * uy - ry * ux) > DASH_W / 2 || along >= DASH_L) {
        if (along >= DASH_L) got = DASH_L;
        break;
      }
      got = along;
    }
    return got;
  }
  const PHASE2 = { tank: 'hud.shed', golem: 'hud.tears' }; // the phase-2 banner per final boss
  function finalAI(S, LV, e, d, dist, chase, stop, go, age, p) {
    const t = S.t,
      hpk = e.hp / e.max,
      K = d.pow || 1,
      Hs = d.haste || 1,
      RX = d.reach || 1; // RX: his attacks' radii ×
    const ph = hpk > 0.66 ? 1 : hpk > 0.33 ? 2 : 3,
      pace = (mul) => e.spd0 * mul * (e.over ? 1.3 : 1);
    if (e.spd0 === undefined) e.spd0 = e.spd;
    if (ph !== e.phase) {
      e.phase = ph;
      if (ph === 2) {
        ev(S, 'shed', e.x, e.y - 150, { ek: e.k });
        e.spd = pace(1.4);
        banner(S, PHASE2[e.k], 'hud.faster', null, '#ff9a2a', { boss: 'bosses.' + e.k });
      }
      if (ph === 3) {
        e.spd = pace(1.8);
        banner(S, 'hud.rage', 'hud.berserk', null, '#ff3a2a', { boss: 'bosses.' + e.k });
      }
    }
    e.rage = ph === 3;
    if (S.t >= D.RUN_LENGTH && !e.over) {
      e.over = 1;
      e.spd *= 1.3;
      e.dmg *= 1.5;
      S.warn = { text: 'hud.timeUp', v: { boss: 'bosses.' + e.k }, t: S.t, col: '#ff3a2a' };
    }
    if (e.st === 'intro') {
      stop();
      if (age > 1.2) {
        go('chase');
        e.next = t + 1.5;
        e.summon = t + 6;
        e.throwT = t + 3;
      }
      return;
    }
    if (e.st === 'chase') {
      chase();
      // zombies: the golem's crawl out of his body (all fight long, a burst of gore), the tank's are called in a ring (phase 1)
      if (t > e.summon && (ph === 1 || d.meat)) {
        e.summon = t + (d.meat ? 10 : 9) * Hs;
        const nz = d.meat ? 5 + ph : 8;
        for (let i = 0; i < nz; i++) {
          const a = (i / nz) * TAU + rnd(S),
            z = addEnemy(
              S,
              d.meat && i % 2 ? 'runner' : 'walker',
              e.x + dcos(a) * (d.meat ? 70 : 140),
              e.y - (d.meat ? 10 : 0) + dsin(a) * (d.meat ? 35 : 70),
            );
          if (d.meat) {
            z.kx = dcos(a) * 520;
            z.ky = dsin(a) * 260;
          }
        }
        ev(S, 'summon', e.x, e.y);
        e.sumT = t;
        if (d.meat) ev(S, d.spores ? 'spores' : 'gore', e.x, e.y - d.h * 0.45);
        if (d.spores)
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TAU + rnd(S),
              dd = rr(S, 140, 260);
            S.pud.push({
              k: 'spore',
              x: e.x + dcos(a) * dd * RX,
              y: e.y + (dsin(a) * dd * RX) / YK,
              r: 80 * RX,
              t0: t,
              dur: 6,
            });
          }
      }
      // thrown lumps: the golem's from the start (2, then 3), the tank's rocks in his rage
      if ((ph === 3 || d.meat) && t > e.throwT) {
        e.throwT = t + (ph === 3 ? 2.1 : 3.4) * Hs;
        e.thrT = t;
        const rel = d.b3d ? 0.4 : 0; // the lumps leave his hand at the release of the throw
        for (let i = 0, n = d.meat && ph === 1 ? 2 : 3; i < n; i++) {
          const a = rnd(S) * TAU,
            dd = i ? rr(S, 60, 200) : 0;
          const x1 = p.x + dcos(a) * dd + p.vx * 0.6,
            y1 = p.y + (dsin(a) * dd) / YK + p.vy * 0.6;
          S.eb.push({
            k: 'rock',
            meat: d.meat ? 1 : 0,
            shroom: d.spores ? 1 : 0,
            x0: e.x,
            y0: e.y - 200,
            x1,
            y1,
            t0: t + rel,
            dur: 1.1,
            dmg: 25 * K,
            r: 80 * RX,
            pr: 60 * RX,
            x: e.x,
            y: e.y,
          });
          S.tele.push({ k: 'mark', x: x1, y: y1, r: 80 * RX, t0: t, dur: 1.1 + rel });
        }
      }
      if (t > e.next) {
        if (ph >= 2 && !d.meat && rnd(S) < 0.6) {
          go('crouch');
          e.tx = p.x;
          e.ty = p.y;
        } // the tank jumps; the golem only pounds the ground
        else {
          go('slamw');
          S.tele.push({ k: 'ring', x: e.x, y: e.y, r: 300 * RX, t0: t, dur: 1.0 });
        }
      }
    } else if (e.st === 'slamw') {
      stop();
      if (age > 1.0) {
        go('slam');
        ev(S, 'slam', e.x, e.y, { r: 300 * RX });
        e.wave = t;
        hurtNear(S, e.x, e.y, 150 * RX, 30 * K, e.x, e.y);
        S.eb.push({ k: 'wave', x: e.x, y: e.y, t0: t, dur: 1.1 * RX, r0: 120 * RX, r1: 620 * RX, dmg: 24 * K, hm: 0 });
      }
    } else if (e.st === 'slam') {
      stop();
      if (age > 0.7) {
        go('chase');
        e.next = t + (ph === 3 ? 2.2 : 3.6) * Hs;
      }
    } else if (e.st === 'crouch') {
      stop();
      if (age > 0.3) {
        go('air');
        e.x0 = e.x;
        e.y0 = e.y;
        e.tx = p.x;
        e.ty = p.y;
        S.tele.push({ k: 'shadow', x: e.tx, y: e.ty, r: 170, t0: t, dur: 1.0 });
      }
    } else if (e.st === 'air') {
      const k = Math.min(1, age / 1.0);
      e.x = e.x0 + (e.tx - e.x0) * k;
      e.y = e.y0 + (e.ty - e.y0) * k;
      e.vx = e.vy = 0;
      if (k >= 1) {
        go('land');
        ev(S, 'slam', e.x, e.y, { r: 220 });
        hurtNear(S, e.x, e.y, 190, 40 * K, e.x, e.y);
        for (const o of S.en)
          if (!o.dead && o !== e && m2(o.x - e.x, o.y - e.y) < 200 * 200)
            damage(S, o, 200, (o.x - e.x) * 3, (o.y - e.y) * 3, false);
      }
    } else if (e.st === 'land') {
      stop();
      if (age > 0.6) {
        go('chase');
        e.next = t + (ph === 3 ? 1.8 : 3) * Hs;
      }
    }
  }
  function updateEnemyShots(S) {
    const t = S.t,
      LV = level(S.seed),
      H = S.ps;
    for (let i = S.eb.length - 1; i >= 0; i--) {
      const b = S.eb[i];
      if (b.k === 'acid') {
        if (b.z === undefined) {
          b.z = 45;
          b.dz = 0;
        }
        b.x += b.vx * DT;
        b.y += b.vy * DT;
        b.life -= DT;
        b.z += b.dz * DT;
        // acid is lobbed: it flies over walls and cars (no hiding behind cover from the spitters)
        let hitP = null;
        for (const p of H)
          if (!p.dead && sq(b.x - p.x) + sq((b.y - (p.y - HERO.h * 0.4)) * YK) < sq(b.r + HERO.r)) {
            hitP = p;
            break;
          }
        if (hitP || b.life <= 0) {
          if (hitP) hurtPlayer(S, hitP, b.dmg, b.x, b.y);
          ev(S, 'splat', b.x, b.y + 40);
          S.pud.push({ x: b.x, y: b.y + 40, r: 40, t0: t, dur: 3 });
          S.eb.splice(i, 1);
        }
      } else if (b.k === 'wave') {
        // expanding ring: hurts each hero once where its front passes (b.hm: one bit each)
        const k = (t - b.t0) / b.dur,
          r = b.r0 + (b.r1 - b.r0) * k;
        for (const p of H) {
          const bit = 1 << p.i;
          if (b.hm & bit || p.dead) continue;
          const d = Math.sqrt(m2(p.x - b.x, p.y - b.y));
          if (Math.abs(d - r) < 34) {
            b.hm |= bit;
            hurtPlayer(S, p, b.dmg, b.x, b.y);
          }
        }
        if (k >= 1) S.eb.splice(i, 1);
      } else if (b.k === 'glob') {
        // the pustule's acid ball: an arc, a splash that burns, a puddle left
        const k = (t - b.t0) / b.dur;
        b.x = b.x0 + (b.x1 - b.x0) * k;
        b.y = b.y0 + (b.y1 - b.y0) * k;
        if (k >= 1) {
          ev(S, 'splat', b.x1, b.y1, { big: 1, r: b.r });
          S.pud.push({ x: b.x1, y: b.y1, r: b.pr || 62, t0: t, dur: 5, pw: b.pw || 1 });
          hurtNear(S, b.x1, b.y1, b.r + HERO.r, b.dmg, b.x1, b.y1);
          S.eb.splice(i, 1);
        }
      } else if (b.k === 'rock') {
        if (t < b.t0) continue; // still in his hand
        const k = (t - b.t0) / b.dur;
        b.x = b.x0 + (b.x1 - b.x0) * k;
        b.y = b.y0 + (b.y1 - b.y0) * k;
        if (k >= 1) {
          ev(S, 'rockhit', b.x1, b.y1, { r: b.r, meat: b.meat && !b.shroom, shroom: b.shroom });
          if (b.shroom) S.pud.push({ k: 'spore', x: b.x1, y: b.y1, r: b.pr || 60, t0: t, dur: 3.5 });
          else if (b.meat) decal(S, 'blood', b.x1, b.y1, 1.4, 20);
          else decal(S, 'crack', b.x1, b.y1, 0.8, 6);
          hurtNear(S, b.x1, b.y1, b.r + HERO.r, b.dmg, b.x1, b.y1);
          S.eb.splice(i, 1);
        }
      }
    }
    // a puddle burns whoever stands in it, every 0.4 s (each hero's own count: tick, tick1, …)
    for (const q of S.pud)
      for (const p of H) {
        if (p.dead || m2(p.x - q.x, p.y - q.y) >= q.r * q.r) continue;
        const k = p.i ? 'tick' + p.i : 'tick';
        q[k] = (q[k] || 0) + DT;
        if (q[k] > 0.4) {
          q[k] = 0;
          hurtPlayer(S, p, 5 * (q.pw || 1));
        }
      }
  }

  // ---------- main weapon ----------
  // z: the shooter's height (screen px); given, a zombie behind a car or a building is skipped
  function findTarget(S, x, y, range, boss, fwd, arc, z) {
    let best = null,
      bd = range * range;
    const LV = z === undefined ? null : level(S.seed);
    for (const e of S.en) {
      if (e.dead || S.t - e.spT < 0.35 || e.st === 'air') continue;
      let d2 = m2(x - e.x, y - (e.y - D.ENEMIES[e.k].h * 0.45)) * 0.5 + sq(x - e.x) * 0.5;
      if (d2 > range * range) continue;
      if (arc !== undefined) {
        let da = datan2(e.y - D.ENEMIES[e.k].h * 0.45 - y, e.x - x) - fwd;
        da = datan2(dsin(da), dcos(da));
        if (Math.abs(da) > arc) continue;
      }
      if (boss && D.ENEMIES[e.k].boss) d2 *= 0.25;
      if (d2 < bd && (!LV || clearShot(LV, x, y + z, e.x, e.y))) {
        bd = d2;
        best = e;
      }
    }
    return best;
  }
  const rollCrit = (S, extra = 0) => rnd(S) < S.p.st.crit + extra;
  // o.z: the shot's height (screen px above the ground under it; the main gun's muzzle by default), o.dz: its change per second
  function shoot(S, x, y, a, speed, dmg, kind, o = {}) {
    if (S.bul.length > 700) return;
    const b = {
      x,
      y,
      px: x,
      py: y,
      vx: dcos(a) * speed,
      vy: dsin(a) * speed,
      dmg,
      kind,
      pierce: o.pierce || 0,
      knock: o.knock ?? 70,
      life: o.life || 0.7,
      r: o.r || 6,
      aoe: o.aoe || 0,
      crit: o.crit || 0,
      hits: [],
      t0: S.t,
      bs: o.bs ?? (S.p.main.bt ? 3 : 0),
      z: o.z ?? muzzleZ(S),
      dz: o.dz || 0,
      o: S.p.i | 0,
    }; // o: whose shot (its crits, its kills)
    if (o.bnc) b.bnc = o.bnc;
    if (o.inc) b.inc = 1;
    if (o.boom) b.boom = 1;
    if (o.cl) b.cl = 1;
    if (o.main) b.main = 1; // main: the main gun's (it sets barrels off)
    S.bul.push(b);
  }
  // mouse (inp.mx/my = cursor in view px): the hero turns to the cursor and fires while the button is held (inp.fire), into the
  // weapon's cone (D.MAIN.spread). The aiming stick (touch: inp.ax/ay): turns the way it is pushed and fires; not pushed (0, 0: touch
  // play sends it so) nothing fires and no target is picked. Neither (the attract demo, keys only): fires by itself at the nearest
  // zombie ahead, in the way it moves. Movement turns the aim only when neither the mouse nor the pushed stick holds it.
  const AUTO_ARC = 1.0;
  function updateMain(S, inp = {}) {
    const p = S.p,
      w = p.main;
    if (p.dead) return;
    const s = mainStats(S),
      d = D.MAIN[w.id],
      h = hand(S);
    let want = false;
    if (inp.mx !== undefined) {
      p.manual = 1;
      w.bt = 0;
      const wx = p.cam[0] + inp.mx / (S.zoom || 1),
        wy = p.cam[1] + inp.my / (S.zoom || 1);
      p.aimOff = [inp.mx / (S.zoom || 1) - camW(S) / 2, inp.my / (S.zoom || 1) - camH(S) / 2]; // cursor from the view centre: the camera leans that way
      p.aim = angTo(p.aim, datan2(wy - h[1], wx - h[0]), DT * 30);
      want = !!inp.fire;
    } else if (inp.ax !== undefined && (Math.abs(inp.ax) > 0.2 || Math.abs(inp.ay) > 0.2)) {
      p.manual = 1;
      w.bt = 0;
      p.aimOff = [inp.ax * 700, inp.ay * 460]; // the camera leans the way it aims, as to a cursor
      p.aim = angTo(p.aim, datan2(inp.ay, inp.ax), DT * 30);
      want = true;
    } else if (inp.ax !== undefined) {
      // touch, the aim stick not pushed: no shot, no target picked for it
      p.manual = 0;
      p.aimOff = null;
      w.bt = 0;
      if (dhypot(p.vx, p.vy) > 30) p.mdir = datan2(p.vy, p.vx);
    } else {
      p.manual = 0;
      p.aimOff = null;
      if (dhypot(p.vx, p.vy) > 30) p.mdir = datan2(p.vy, p.vx);
      const fwd = p.mdir ?? p.aim,
        tg = findTarget(S, h[0], h[1], s.range, true, fwd, AUTO_ARC, muzzleZ(S));
      if (tg) {
        p.aim = angTo(p.aim, datan2(tg.y - D.ENEMIES[tg.k].h * 0.45 - h[1], tg.x - h[0]), DT * 22);
        want = true;
        w.bt = D.ENEMIES[tg.k].boss ? 1 : 0;
      } else {
        p.aim = angTo(p.aim, fwd, DT * 8);
        w.bt = 0;
      }
    }
    p.face = dcos(p.aim) < 0 ? -1 : 1;
    w.spinA = ((w.spinA || 0) + 40 * w.spin * DT) % TAU; // the minigun's barrels (drawn by the scene)
    const busy = magazine(S, w, s, want, inp);
    w.firing = want && !busy;
    if (!w.firing) {
      w.cd = Math.max(0, w.cd - DT);
      if (!want) w.spin = Math.max(0, w.spin - DT * 0.8);
      return;
    } // (reloading at a target: the minigun's barrels keep turning)
    if (w.id === 'flame') return fireFlame(S, s);
    let rate = s.rate;
    if (w.id === 'minigun') {
      w.spin = w.evo ? 1 : Math.min(1, w.spin + DT / s.spin);
      rate = 3 + (s.rate - 3) * w.spin * w.spin;
    }
    w.cd -= DT;
    while (w.cd <= 0 && (!s.mag || w.ammo > 0)) {
      w.cd += 1 / rate;
      fireOnce(S, w.id, s, d);
      w.ammo--;
    }
    if (s.mag && w.ammo <= 0) reload(S, w, s);
  }
  // the magazine: s.mag rounds (the flamethrower's: ticks of fuel). Spent, the gun reloads for s.rl s and fires nothing meanwhile; one
  // that has fired some and then has nothing to shoot for RELOAD_IDLE s tops itself up the same way (w.top: broken off as soon as there
  // is something to shoot again — it still has rounds), and the reload key (inp.rl) starts one at once. A magazine grown mid-run (the
  // bandolier, the evolution) comes with its extra rounds. Returns: reloading
  const RELOAD_IDLE = 0.6;
  function magazine(S, w, s, want, inp) {
    if (!s.mag) return false;
    if (w.cap !== s.mag) {
      w.ammo = w.cap === undefined ? s.mag : clamp(w.ammo + s.mag - w.cap, 0, s.mag);
      w.cap = s.mag;
    }
    w.idle = want ? 0 : (w.idle || 0) + DT;
    if (w.rl > 0) {
      if (w.top && want && w.ammo > 0) {
        w.rl = 0;
        w.top = 0;
        return false;
      }
      w.rl -= DT;
      if (w.rl > 0) return true;
      w.rl = 0;
      w.top = 0;
      w.ammo = s.mag;
      ev(S, 'reloaded', S.p.x, S.p.y, { w: w.id });
      return false;
    }
    if (w.ammo < s.mag && (w.ammo <= 0 || w.idle >= RELOAD_IDLE || inp.rl)) {
      reload(S, w, s, w.ammo > 0 && !inp.rl);
      return true;
    }
    return false;
  }
  // a reload begins (rlT: how long it takes, for the drawing; top: a top-up. The event at the gun, gy: the ground under it — a spent
  // magazine falls there)
  function reload(S, w, s, top = false) {
    if (w.rl > 0) return;
    const h = hand(S);
    w.rl = w.rlT = s.rl;
    w.idle = 0;
    w.top = top ? 1 : 0;
    ev(S, 'reload', h[0], h[1], { w: w.id, d: s.rl, gy: S.p.y, top: w.top });
  }
  function fireOnce(S, id, s, d) {
    const p = S.p,
      m = muzzle(S),
      a = p.aim,
      life = (s.range / s.speed) * 1.15;
    p.kick = d.recoil || 6;
    if (id === 'shotgun') {
      for (let i = 0; i < s.pellets; i++) {
        const aa = a + (i / (s.pellets - 1) - 0.5) * s.spread + rr(S, -0.04, 0.04);
        shoot(S, m[0], m[1], aa, s.speed * rr(S, 0.85, 1.1), s.dmg, 1, {
          main: 1,
          knock: s.knock,
          life: life * rr(S, 0.8, 1),
          r: 7,
          inc: s.inc,
        });
      }
    } else if (id === 'rocket') {
      for (let i = 0; i < s.multi; i++)
        shoot(S, m[0], m[1], a + (s.multi > 1 ? (i - 0.5) * 0.22 : 0), s.speed, s.dmg, 4, {
          main: 1,
          aoe: s.aoe,
          life: 1.4,
          r: 12,
          knock: 0,
          cl: s.cl,
        });
    } else {
      for (let i = 0; i < s.multi; i++) {
        const off = s.multi > 1 ? (i - (s.multi - 1) / 2) * 12 : 0;
        shoot(
          S,
          m[0] - dsin(a) * off,
          m[1] + dcos(a) * off,
          a + rr(S, -s.spread, s.spread) * 0.5,
          s.speed,
          s.dmg,
          id === 'sniper' ? 2 : 0,
          {
            main: 1,
            pierce: s.pierce,
            life,
            crit: s.crit,
            knock: id === 'sniper' ? 160 : 60,
            r: id === 'sniper' ? 9 : 6,
            bnc: s.bnc,
            boom: s.boom,
          },
        );
      }
    }
    ev(S, 'shot', m[0], m[1], { a, w: id });
  }
  function fireFlame(S, s) {
    const p = S.p,
      m = muzzle(S),
      a = p.aim,
      w = p.main;
    w.ft -= DT;
    if (w.ft > 0) return;
    w.ft += D.MAIN.flame.tick / (1 + D.WEAPON_UP.rate.per * ((p.wup || S.wup).rate || 0)); // (its rate upgrade: the ticks come faster)
    if (s.mag && --w.ammo <= 0) reload(S, w, s); // (this tick's the last of the tank)
    ev(S, 'flame', m[0], m[1], { a, r: s.range, c: s.cone });
    const out = SC.out2,
      n = query(m[0], m[1] + 40, s.range + 60, (s.range + 60) / 2 + 40, out),
      ca = dcos(a),
      sa = dsin(a),
      cc = dcos(s.cone);
    for (let k = 0; k < n; k++) {
      const e = S.en[out[k]];
      if (e.dead) continue;
      const dx = e.x - m[0],
        dy = e.y - D.ENEMIES[e.k].h * 0.45 - m[1],
        dd = dhypot(dx, dy);
      if (dd > s.range + e.r || dd < 1) continue;
      if ((dx * ca + dy * sa) / dd < cc && dd > e.r + 20) continue;
      const crit = rollCrit(S);
      damage(S, e, s.dmg * (crit ? 2 : 1), ca * 40, sa * 40, crit, null, true);
      ignite(S, e, s.burn * S.p.st.dmgMul, s.burnT);
    }
    hitPropsNear(S, m[0] + ca * s.range * 0.5, m[1] + sa * s.range * 0.5 + 30, s.range * 0.5, s.dmg);
  }
  function segD2(px, py, ax, ay, bx, by) {
    const dx = bx - ax,
      dy = by - ay,
      l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ax + dx * t - px,
      y = ay + dy * t - py;
    return x * x + y * y;
  }
  function updateBullets(S, LV) {
    const out = SC.out1,
      H = S.ps,
      was = S.p;
    for (let i = S.bul.length - 1; i >= 0; i--) {
      const b = S.bul[i];
      S.p = H[b.o | 0] || was; // (the shooter's: its crits, its kills)
      if (b.z === undefined) {
        b.z = 48;
        b.dz = 0;
      } // a shot from a run saved before shots had heights
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      b.life -= DT;
      const z0 = b.z;
      b.z += b.dz * DT;
      let dead = b.life <= 0;
      // a car or a building stops it where the ground under it enters the footprint (found to a px between this step's ends; a
      // rocket bursts there): sparks off metal, brick dust. Lower props (barriers, fences, crates) it flies over, striking sparks once
      const so = !dead && shotStop(LV, b.x, b.y, b.z);
      if (so) {
        let lo = 0,
          hi = 1;
        for (let j = 0; j < 5; j++) {
          const m = (lo + hi) / 2;
          if (shotStop(LV, b.px + (b.x - b.px) * m, b.py + (b.y - b.py) * m, z0 + (b.z - z0) * m)) hi = m;
          else lo = m;
        }
        b.x = b.px + (b.x - b.px) * hi;
        b.y = b.py + (b.y - b.py) * hi;
        dead = true;
        ev(S, 'hitm', b.x, b.y, { a: datan2(b.vy, b.vx), m: so.mat, w: b.kind, p: so.i });
      } else if (!dead && !b.ric && (S.steps + i) % 2 === 0 && blockedS(S, LV, b.x, b.y + b.z, 0)) {
        b.ric = 1;
        ev(S, 'ric', b.x, b.y, { a: datan2(b.vy, b.vx) });
      }
      if (!dead)
        for (const bl of visBalloons(S, LV)) if (segD2(bl.x, bl.y, b.px, b.py, b.x, b.y) < 24 * 24) popBalloon(S, bl);
      if (!dead) {
        const n = query((b.x + b.px) / 2, (b.y + b.py) / 2 + 50, 120, 180, out);
        for (let k = 0; k < n && !dead; k++) {
          const e = S.en[out[k]];
          if (e.dead || S.t - e.spT < 0.35 || b.hits.includes(e.id)) continue;
          const de = D.ENEMIES[e.k],
            cy = e.y - de.h * 0.45,
            rr2 = e.r * (de.boss ? 1.1 : 1.3) + b.r;
          if (segD2(e.x, cy, b.px, b.py, b.x, b.y) > rr2 * rr2) continue;
          if (de.boss && e.st === 'air') continue;
          if (b.bs > 0 && !de.boss) {
            b.bs--;
            b.hits.push(e.id);
            continue;
          } // boss-aimed: slips past the fodder
          if (b.kind === 4) {
            rocketBurst(S, b, b.x, b.y + 30);
            dead = true;
            break;
          }
          const crit = rollCrit(S, b.crit),
            sp = dhypot(b.vx, b.vy) || 1;
          damage(S, e, b.dmg * (crit ? 2 : 1), (b.vx / sp) * b.knock, (b.vy / sp) * b.knock, crit);
          if (b.inc) ignite(S, e, b.dmg * 0.5, 3);
          if (b.boom) blast(S, e.x, e.y - 10, 70 * S.p.st.area, b.dmg * 0.45, { kind: 'fire', main: b.main });
          b.hits.push(e.id);
          if (b.bnc > 0 && bounce(S, b, e)) {
            b.bnc--;
            break;
          }
          if (b.pierce-- <= 0) dead = true;
        }
        if (!dead)
          for (const di of visDestr(S, LV)) {
            const o = LV.props[di];
            if (S.pd[o.di] <= 0 || (o.barrel && !b.main)) continue; // (a barrel lets the other weapons' shots by)
            if (segD2(o.x, o.y - o.w * 0.35, b.px, b.py, b.x, b.y) < sq(o.w * 0.4)) {
              if (b.kind === 4) rocketBurst(S, b, b.x, b.y + 20);
              else hitProp(S, LV, o, b.dmg, null);
              dead = true;
              break;
            }
          }
      } else if (b.kind === 4) rocketBurst(S, b, b.x, b.y + 30);
      if (dead) S.bul.splice(i, 1);
    }
    S.p = was;
  }
  // a rocket bursts (the evolved launcher's also throws five bomblets round, as the cluster grenade's)
  function rocketBurst(S, b, x, y) {
    blast(S, x, y, b.aoe, b.dmg, { kind: 'fire', main: b.main });
    if (b.cl)
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + rr(S, -0.3, 0.3),
          d = rr(S, 80, 150);
        S.gren.push({
          x0: x,
          y0: y,
          x1: x + dcos(a) * d,
          y1: y + (dsin(a) * d) / YK,
          t0: S.t,
          dur: 0.38,
          dmg: b.dmg * 0.35,
          r: 64,
          cl: 0,
          sm: 1,
          h: 60,
          rot: rnd(S) * 6,
          main: b.main ? 1 : 0,
          o: S.p.i | 0,
        });
      }
  }
  // the evolved pistol's shot ricochets off the zombie it hit to the nearest one it has not
  function bounce(S, b, from) {
    let best = null,
      bd = 300 * 300;
    for (const o of S.en) {
      if (o.dead || o === from || b.hits.includes(o.id) || S.t - o.spT < 0.35 || o.st === 'air') continue;
      const d2 = m2(o.x - from.x, o.y - from.y);
      if (d2 < bd) {
        bd = d2;
        best = o;
      }
    }
    if (!best) return false;
    const sp = dhypot(b.vx, b.vy),
      a = datan2(best.y - D.ENEMIES[best.k].h * 0.45 - b.y, best.x - b.x);
    b.vx = dcos(a) * sp;
    b.vy = dsin(a) * sp;
    b.dz = 0;
    b.life = Math.max(b.life, 0.45);
    ev(S, 'ric', b.x, b.y, { a });
    return true;
  }
  let vdCache = { step: -1, list: [] };
  // the crates and barrels in some hero's view (with a margin): the ones shots and blasts can meet
  function visDestr(S, LV) {
    if (vdCache.step === S.steps && vdCache.S === S) return vdCache.list;
    const R = S.ps.map((p) => {
        const x0 = p.cam[0] - 100,
          y0 = p.cam[1] - 100;
        return [x0, y0, x0 + camW(S, p) + 200, y0 + camH(S) + 260];
      }),
      out = [];
    for (let k = 0; k < LV.destr.length; k++) {
      if (S.pd[k] <= 0) continue;
      const o = LV.props[LV.destr[k]];
      for (const [x0, y0, x1, y1] of R)
        if (o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1) {
          out.push(LV.destr[k]);
          break;
        }
    }
    vdCache = { S, step: S.steps, list: out };
    return out;
  }

  // ---------- blasts, barrels, crates ----------
  // main: set off by the main gun (it sets barrels off too; a barrel's own blast carries its chain, which does); hr: the hero is hurt
  // within this radius (default r)
  // (o: whose blast it is — the hero the sim works for when it is set off)
  function blast(S, x, y, r, dmg, o = {}) {
    S.bq.push({
      x,
      y,
      r,
      dmg,
      delay: o.delay || 0,
      kind: o.kind || 'fire',
      hurt: o.hurt || 0,
      ch: o.chain ? o.chain.id : 0,
      mn: o.main ? 1 : 0,
      hr: o.hr || 0,
      o: S.p.i | 0,
    });
  }
  function updateBlasts(S, LV) {
    const out = SC.out2,
      was = S.p;
    for (let i = 0; i < S.bq.length; i++) {
      const b = S.bq[i];
      b.delay -= DT;
      if (b.delay > 0) continue;
      S.bq.splice(i--, 1);
      S.p = S.ps[b.o | 0] || was;
      const chain = b.ch ? S.ch.find((c) => c.id === b.ch) : null;
      ev(S, 'boom', b.x, b.y, { r: b.r, kind: b.kind });
      decal(S, b.kind === 'acid' ? 'acid' : 'scorch', b.x, b.y, b.r / 100, 16);
      if (chain) chain.t = S.t;
      if (b.kind !== 'acid' && b.r >= 90 && S.t - (S.hsT ?? -9) > (b.r >= 140 ? 0.35 : 0.8)) {
        S.hs = Math.max(S.hs, b.r >= 140 ? 0.05 : 0.022);
        S.hsT = S.t;
      }
      if (b.dmg > 0) {
        const n = query(b.x, b.y, b.r + 90, (b.r + 90) / 2 + 30, out),
          src = { chain, bx: b.x, by: b.y, br: b.r };
        for (let k = 0; k < n; k++) {
          const e = S.en[out[k]];
          if (e.dead) continue;
          const dx = e.x - b.x,
            dy = (e.y - b.y) * YK,
            d = dhypot(dx, dy);
          if (d > b.r + e.r) continue;
          const f = 1 - 0.45 * Math.min(1, d / b.r),
            crit = rollCrit(S);
          damage(S, e, b.dmg * f * (crit ? 2 : 1), (dx / (d || 1)) * 420 * f, (dy / (d || 1)) * 210 * f, crit, src);
        }
      }
      for (const bl of visBalloons(S, LV)) if (m2(bl.b.x - b.x, bl.b.y - b.y) < sq(b.r + 70)) popBalloon(S, bl);
      if (b.hurt) {
        const R = (b.hr || b.r) + HERO.r;
        hurtNear(S, b.x, b.y, R, (h, d) => b.hurt * (1 - (0.5 * d) / R), b.x, b.y);
      }
      for (let k = 0; k < LV.destr.length; k++) {
        if (S.pd[k] <= 0) continue;
        const o = LV.props[LV.destr[k]];
        if (o.barrel && !b.mn && !chain) continue; // (barrels: the main gun's)
        if (Math.abs(o.x - b.x) > b.r + 60 || Math.abs(o.y - b.y) > b.r) continue;
        if (Math.sqrt(m2(o.x - b.x, o.y - b.y)) < b.r + 20) hitProp(S, LV, o, (b.dmg || 40) * 1.5, chain);
      }
    }
    S.p = was;
    for (let i = S.ch.length - 1; i >= 0; i--) {
      const c = S.ch[i];
      if (S.t - c.t > 0.7 && !S.bq.some((b) => b.ch === c.id)) {
        S.ch.splice(i, 1);
        if (c.k >= 1 && (c.b >= 2 || c.k >= 5)) {
          const bonus = bonusXp(S, c.k * 5 + c.b * 10);
          addXp(S, bonus);
          banner(S, 'hud.barrel', 'hud.elim', 'hud.xpGain', '#ff9a2a', { m: c.b, n: c.k, xp: bonus });
        }
      }
    }
  }
  const BARREL_R = 300;
  function hitProp(S, LV, o, dmg, chain) {
    const k = o.di;
    if (S.pd[k] <= 0) return;
    S.pd[k] -= dmg;
    ev(S, 'prophit', o.x, o.y, { i: o.i });
    if (S.pd[k] > 0) return;
    S.pd[k] = 0;
    if (o.barrel) {
      let c = chain;
      if (!c) {
        c = { id: S.nid++, b: 0, k: 0, t: S.t };
        S.ch.push(c);
      }
      c.b++;
      blast(S, o.x, o.y - 20, BARREL_R, 90, { kind: 'fire', hurt: 22, hr: 150, chain: c, delay: chain ? 0.13 : 0 }); // (its blast reaches BARREL_R, hurts the hero within 150)
      ev(S, 'barrel', o.x, o.y);
    } else {
      ev(S, 'crate', o.x, o.y, { n: o.n });
      const luck = S.p.st.luck;
      for (let i = 0; i < 3; i++) dropGem(S, o.x + rr(S, -20, 20), o.y + rr(S, -10, 10), 2);
      if (rnd(S) < 0.6) dropPk(S, 'coin', o.x, o.y, Math.floor(rr(S, 3, 8)));
      const r = rnd(S) / luck;
      if (r < 0.18) dropPk(S, 'medkit', o.x, o.y);
      else if (r < 0.3) dropPk(S, 'magnet', o.x, o.y);
      else if (r < 0.38) dropPk(S, 'bomb', o.x, o.y);
    }
  }
  function hitPropsNear(S, x, y, r, dmg) {
    const LV = level(S.seed);
    for (const di of visDestr(S, LV)) {
      const o = LV.props[di];
      if (Math.sqrt(m2(o.x - x, o.y - y)) < r + 20) hitProp(S, LV, o, dmg, null);
    }
  }

  // ---------- extra weapons ----------
  const itemSt = (it) => D.ITEMS[it.id].st[Math.min(it.lvl, D.ITEMS[it.id].st.length) - 1];
  // the new extra weapons evolved (the older three keep theirs below: CHAIN_EVO, sawGeom, droneGeom)
  const EVO_ST = {
    molotov: { cd: 2.3, n: 3, r: 106, dur: 5, dps: 20 }, // napalm: the puddles run together, the burning set their neighbours alight
    tesla: { r: 210, dmg: 28, tick: 0.35 }, // the dome: bigger, and it burns the spitters' acid out of the air
    turret: { cd: 8, life: 0, dmg: 30, rate: 1.6, hp: 400, aoe: 70 }, // the checkpoint: two at a time, rockets, they stand till broken
    gravity: { cd: 4.5, r: 280, dur: 3.5, pull: 480, dps: 60 }, // the black hole: a stronger pull, its heart hurts
    missiles: { cd: 3, n: 8, dmg: 55, r: 100 }, // hail: eight at a time, spread over the crowd
  };
  const ist = (it) => (it.evo && EVO_ST[it.id]) || itemSt(it);
  const itemStats = (S, it) => ist(it);
  // the hero's own extra weapons (S.p's)
  function updateItems(S, LV) {
    const p = S.p;
    if (p.dead) return;
    if (!S.fire) Object.assign(S, { fire: [], wells: [], msl: [], tur: [] }); // (a run saved before these)
    for (const it of p.items) {
      if (it.id === 'chain') updChain(S, it);
      else if (it.id === 'saws') updSaws(S, LV, it);
      else if (it.id === 'drone') updDrones(S, it);
      else if (it.id === 'grenade') updGrenadeItem(S, it);
      else if (it.id === 'molotov' || it.id === 'gravity') updLobbed(S, it);
      else if (it.id === 'tesla') updTesla(S, it);
      else if (it.id === 'turret') updTurretItem(S, LV, it);
      else if (it.id === 'missiles') updMissileItem(S, it);
    }
  }
  // what the heroes' weapons threw and set down, the run's: grenades, bottles and gravity grenades landing, fire puddles, wells,
  // missiles, turrets (each the hero's who threw it: o)
  function updateThrown(S, LV) {
    const H = S.ps,
      was = S.p;
    for (let i = S.gren.length - 1; i >= 0; i--) {
      const g = S.gren[i];
      if (S.t - g.t0 < g.dur) continue;
      S.gren.splice(i, 1);
      S.p = H[g.o | 0] || was;
      if (g.mol) {
        S.fire.push({ x: g.x1, y: g.y1, r: g.r, t0: S.t, dur: g.fd, dps: g.dps, nap: g.nap, tk: 0, o: g.o | 0 });
        ev(S, 'mol', g.x1, g.y1, { r: g.r });
        decal(S, 'scorch', g.x1, g.y1, g.r / 100, g.fd + 8);
        continue;
      }
      if (g.grav) {
        S.wells.push({
          x: g.x1,
          y: g.y1,
          r: g.r,
          t0: S.t,
          dur: g.fd,
          pull: g.pull,
          dps: g.dps,
          evo: g.evo,
          tk: 0,
          o: g.o | 0,
        });
        ev(S, 'well', g.x1, g.y1, { r: g.r, d: g.fd, evo: g.evo });
        continue;
      }
      blast(S, g.x1, g.y1, g.r, g.dmg, { kind: 'fire', main: g.main });
      if (g.cl)
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + rr(S, -0.3, 0.3),
            d = rr(S, 90, 170);
          S.gren.push({
            x0: g.x1,
            y0: g.y1,
            x1: g.x1 + dcos(a) * d,
            y1: g.y1 + (dsin(a) * d) / YK,
            t0: S.t,
            dur: 0.38,
            dmg: g.dmg * 0.5,
            r: 72,
            cl: 0,
            sm: 1,
            h: 60,
            rot: rnd(S) * 6,
            o: g.o | 0,
          });
        }
    }
    S.p = was;
    updFire(S);
    updWells(S);
    updMissiles(S);
    updTurrets(S);
    S.p = was;
  }
  // a point in the thick of the zombies (the most neighbours among a few random picks)
  function crowdPick(S, cand) {
    let best = cand[0],
      bc = -1;
    for (let k = 0; k < 6; k++) {
      const e = rpick(S, cand);
      let c = 0;
      for (let j = 0; j < 12; j++) {
        const o = rpick(S, cand);
        if (m2(o.x - e.x, o.y - e.y) < 130 * 130) c++;
      }
      if (c > bc) {
        bc = c;
        best = e;
      }
    }
    return best;
  }
  const inReach = (S, R) =>
    S.en.filter((e) => !e.dead && S.t - e.spT > 0.35 && e.st !== 'air' && m2(e.x - S.p.x, e.y - S.p.y) < R * R);
  function heal(S, v) {
    const p = S.p;
    if (p.dead || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + v);
    ev(S, 'lifesteal', p.x, p.y, { v });
  }
  // set alight for s seconds, dps a second (a fire out before starts again from nothing); nap: napalm's, which spreads
  function ignite(S, e, dps, s, nap) {
    if (e.burnT < S.t) e.burnD = 0;
    e.burnT = Math.max(e.burnT, S.t + s);
    e.burnD = Math.max(e.burnD, dps);
    if (nap) e.nap = 1;
    e.bo = S.p.i | 0;
  }
  function spreadFire(S, e) {
    const out = SC.out2,
      n = query(e.x, e.y, 80, 50, out);
    for (let k = 0; k < n; k++) {
      const o = S.en[out[k]];
      if (o === e || o.dead || o.burnT > S.t + 0.5 || m2(o.x - e.x, o.y - e.y) > 75 * 75) continue;
      ignite(S, o, e.burnD, 2.5, 1);
      ev(S, 'ignite', o.x, o.y);
      return;
    }
  }
  // ---------- the molotov and the gravity grenade: thrown into crowds like the grenades (S.gren), a fire puddle or a well where they land
  function updLobbed(S, it) {
    const s = ist(it),
      p = S.p,
      mol = it.id === 'molotov';
    it.cd -= DT;
    if (it.cd > 0) return;
    it.cd = s.cd * p.st.cdMul;
    const cand = inReach(S, 560 * p.st.range);
    if (!cand.length) {
      it.cd = 0.4;
      return;
    }
    for (let i = 0, n = (mol ? s.n : 1) + p.st.ammo; i < n; i++) {
      const e = crowdPick(S, cand);
      const g = {
        x0: p.x,
        y0: p.y - 50,
        x1: e.x + rr(S, -24, 24),
        y1: e.y + rr(S, -12, 12),
        t0: S.t + i * 0.08,
        dur: 0.6,
        h: mol ? 130 : 150,
        rot: rnd(S) * 6,
        dmg: 0,
        r: s.r * p.st.area,
        cl: 0,
        sm: 0,
        fd: s.dur * p.st.dur,
        o: p.i | 0,
      };
      if (mol) Object.assign(g, { mol: 1, dps: s.dps * p.st.dmgMul, nap: it.evo ? 1 : 0 });
      else Object.assign(g, { grav: 1, pull: s.pull, dps: (s.dps || 0) * p.st.dmgMul, evo: it.evo ? 1 : 0 });
      S.gren.push(g);
    }
    ev(S, 'toss', p.x, p.y - 50, { w: it.id });
  }
  function updFire(S) {
    const out = SC.out2;
    for (let i = S.fire.length - 1; i >= 0; i--) {
      const f = S.fire[i];
      if (S.t - f.t0 > f.dur) {
        S.fire.splice(i, 1);
        continue;
      }
      f.tk -= DT;
      if (f.tk > 0) continue;
      f.tk = 0.25;
      S.p = S.ps[f.o | 0] || S.p;
      const n = query(f.x, f.y, f.r + 40, (f.r + 40) / 2 + 30, out);
      for (let k = 0; k < n; k++) {
        const e = S.en[out[k]];
        if (e.dead || e.st === 'air' || m2(e.x - f.x, e.y - f.y) > sq(f.r + e.r * 0.5)) continue;
        damage(S, e, f.dps * 0.25, 0, 0, false, AREA, true);
        ignite(S, e, f.dps * 0.4, 2, f.nap);
      }
    }
  }
  // the well pulls the zombies in toward its heart (the elites less, the bosses only the black hole's, a little); the black hole's heart hurts
  function updWells(S) {
    const out = SC.out2;
    for (let i = S.wells.length - 1; i >= 0; i--) {
      const w = S.wells[i];
      if (S.t - w.t0 > w.dur) {
        S.wells.splice(i, 1);
        continue;
      }
      const tick = w.dps > 0 && (w.tk -= DT) <= 0;
      if (tick) w.tk = 0.25;
      S.p = S.ps[w.o | 0] || S.p;
      const n = query(w.x, w.y, w.r + 40, (w.r + 40) / 2 + 30, out);
      for (let k = 0; k < n; k++) {
        const e = S.en[out[k]];
        if (e.dead || e.st === 'air') continue;
        const dx = e.x - w.x,
          dy = e.y - w.y,
          d = Math.sqrt(m2(dx, dy));
        if (d > w.r + e.r) continue;
        const f = D.ENEMIES[e.k].boss ? (w.evo ? 0.12 : 0) : e.elite ? 0.6 : 1;
        if (f && d > 6) {
          const st = Math.min(d - 6, w.pull * f * (0.55 + 0.45 * (1 - d / w.r)) * DT);
          e.x -= (dx / d) * st;
          e.y -= (dy / d) * st;
          e.vx *= 0.92;
          e.vy *= 0.92;
        }
        if (tick && d < 70) damage(S, e, w.dps * 0.25, 0, 0, false, AREA, true);
      }
    }
  }
  // ---------- tesla field: every tick strikes all in its ring and shoves them out; the dome also burns the spitters' acid out of the air,
  // DOME_STOP of it (each shot's lot drawn once, as it comes into the field: b.dome). The bosses' globs and lumps it cannot
  const DOME_STOP = 0.7;
  function updTesla(S, it) {
    const s = ist(it),
      p = S.p,
      t = S.t,
      R = s.r * p.st.area;
    if (it.evo)
      for (let i = S.eb.length - 1; i >= 0; i--) {
        const b = S.eb[i];
        if (b.k !== 'acid' || b.dome) continue;
        if (m2(b.x - p.x, b.y + (b.z || 0) - p.y) > R * R) continue;
        b.dome = 1;
        if (rnd(S) >= DOME_STOP) continue;
        const o = coil(S);
        ev(S, 'zap', o[0], o[1], {
          pts: [
            [Math.round(o[0]), Math.round(o[1])],
            [Math.round(b.x), Math.round(b.y)],
          ],
          evo: 1,
        });
        ev(S, 'shotdown', b.x, b.y, { w: b.k });
        S.eb.splice(i, 1);
      }
    it.cd -= DT;
    if (it.cd > 0) return;
    it.cd = s.tick * p.st.cdMul;
    const out = SC.out2,
      n = query(p.x, p.y, R + 60, (R + 60) / 2 + 30, out),
      pts = [];
    for (let k = 0; k < n; k++) {
      const e = S.en[out[k]];
      if (e.dead || t - e.spT < 0.35 || e.st === 'air') continue;
      const dx = e.x - p.x,
        dy = e.y - p.y,
        d = Math.sqrt(m2(dx, dy));
      if (d > R + e.r) continue;
      if (pts.length < 8) pts.push([Math.round(e.x), Math.round(e.y - D.ENEMIES[e.k].h * 0.5)]);
      damage(S, e, s.dmg * p.st.dmgMul, (dx / (d || 1)) * 150, (dy / (d || 1)) * 150, false, AREA);
    }
    ev(S, 'tesla', p.x, p.y, { r: R, pts, evo: it.evo ? 1 : 0 });
  }
  // ---------- turrets (S.tur): set down beside the hero for life s; the checkpoint's stand, two at a time, till the zombies break them
  function updTurretItem(S, LV, it) {
    const s = ist(it),
      p = S.p;
    it.cd -= DT;
    if (it.cd > 0) return;
    it.cd = s.cd * p.st.cdMul;
    for (let i = 0, n = it.evo ? 2 : 1; i < n; i++) {
      const a = p.aim + (n > 1 ? (i ? 1.1 : -1.1) : 0.5);
      let x = p.x + dcos(a) * 70,
        y = p.y + dsin(a) * 35;
      if (blockedS(S, LV, x, y, 20)) {
        x = p.x;
        y = p.y;
      }
      S.tur.push({
        x,
        y,
        t0: S.t,
        life: s.life,
        cd: 0.4,
        aim: p.aim,
        hp: s.hp || 0,
        max: s.hp || 0,
        evo: it.evo ? 1 : 0,
        o: p.i | 0,
      });
      ev(S, 'turret', x, y);
    }
    // (its own: the oldest folds when it has more than its share)
    for (let mine = S.tur.filter((u) => (u.o | 0) === (p.i | 0)); mine.length > (it.evo ? 4 : 3);) {
      const o = mine.shift();
      S.tur.splice(S.tur.indexOf(o), 1);
      ev(S, 'turgone', o.x, o.y);
    }
  }
  function updTurrets(S) {
    if (!S.tur.length) return;
    const out = SC.out2;
    for (let i = S.tur.length - 1; i >= 0; i--) {
      const u = S.tur[i],
        p = S.ps[u.o | 0] || S.p;
      S.p = p; // (its hero's: its stats, its kills)
      const it = p.items.find((j) => j.id === 'turret');
      if (!it) {
        S.tur.splice(i, 1);
        continue;
      }
      const s = ist(it),
        rate = s.rate / p.st.cdMul;
      if (!u.evo && S.t - u.t0 > u.life) {
        S.tur.splice(i, 1);
        ev(S, 'turgone', u.x, u.y);
        continue;
      }
      if (u.evo) {
        for (let k = 0, n = query(u.x, u.y, 80, 60, out); k < n; k++) {
          const e = S.en[out[k]];
          if (!e.dead && !D.ENEMIES[e.k].boss && m2(e.x - u.x, e.y - u.y) < sq(e.r + 26)) u.hp -= e.dmg * 2 * DT;
        }
        if (u.hp <= 0) {
          S.tur.splice(i, 1);
          ev(S, 'turgone', u.x, u.y, { boom: 1 });
          blast(S, u.x, u.y - 20, 90, 40, { kind: 'fire' });
          continue;
        }
      }
      u.cd -= DT;
      const tg = findTarget(S, u.x, u.y - 50, 520 * p.st.range, false, undefined, undefined, 50);
      if (!tg) continue;
      u.aim = datan2(tg.y - D.ENEMIES[tg.k].h * 0.45 - (u.y - 50), tg.x - u.x);
      if (u.cd > 0) continue;
      u.cd = 1 / rate;
      const mx = u.x + dcos(u.aim) * 34,
        my = u.y - 50 + dsin(u.aim) * 34,
        zt = D.ENEMIES[tg.k].h * 0.45,
        dd = dhypot(tg.x - mx, tg.y - zt - my);
      if (u.evo)
        shoot(S, mx, my, u.aim, 900, s.dmg * p.st.dmgMul, 4, {
          aoe: s.aoe * p.st.area,
          life: 1.0,
          r: 10,
          knock: 0,
          bs: 0,
          z: 50,
          dz: (zt - 50) / Math.max(0.05, dd / 900),
        });
      else
        for (let j = 0, m = 1 + p.st.ammo; j < m; j++)
          shoot(S, mx, my, u.aim + (j - (m - 1) / 2) * 0.08, 1300, s.dmg * p.st.dmgMul, 3, {
            pierce: s.pierce || 0,
            life: 0.5,
            knock: 40,
            bs: 0,
            z: 50,
            dz: (zt - 50) / Math.max(0.05, dd / 1300),
          });
      ev(S, 'shot', mx, my, { a: u.aim, w: 'turret' });
    }
  }
  // ---------- homing missiles (S.msl: ground x, y and height z): up off the hero's back, then each steers at its zombie and bursts
  function updMissileItem(S, it) {
    const s = ist(it),
      p = S.p;
    it.cd -= DT;
    if (it.cd > 0) return;
    it.cd = s.cd * p.st.cdMul;
    const cand = inReach(S, 820 * p.st.range);
    if (!cand.length) {
      it.cd = 0.5;
      return;
    }
    for (let i = 0, n = s.n + p.st.ammo; i < n; i++) {
      const e = it.evo && i % 2 ? rpick(S, cand) : crowdPick(S, cand),
        f = (i - (n - 1) / 2) * (it.evo ? 0.5 : 0.4) + rr(S, -0.1, 0.1);
      S.msl.push({
        id: S.nid++,
        x: p.x - p.face * 10,
        y: p.y,
        z: 80,
        vx: dsin(f) * 300,
        vy: rr(S, -40, 40),
        vz: 520 - Math.abs(f) * 80,
        tid: e.id,
        tx: e.x,
        ty: e.y,
        t0: S.t + i * 0.06,
        dmg: s.dmg * p.st.dmgMul,
        r: s.r * p.st.area,
        sp: 520 * p.st.range,
        o: p.i | 0,
      });
    }
    ev(S, 'mlaunch', p.x, p.y - 80, { n: s.n + p.st.ammo });
  }
  function updMissiles(S) {
    for (let i = S.msl.length - 1; i >= 0; i--) {
      const m = S.msl[i],
        age = S.t - m.t0;
      if (age < 0) continue;
      if ((S.steps + m.id) % 4 === 0) {
        const e = guardOf(S, m.tid);
        if (e) {
          m.tx = e.x;
          m.ty = e.y;
        }
      }
      if (age > 0.22) {
        const dx = m.tx - m.x,
          dy = m.ty - m.y,
          dz = -m.z,
          d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1,
          sp = m.sp * (1 + Math.min(1, age) * 0.8),
          k = Math.min(1, DT * 7);
        m.vx += ((dx / d) * sp - m.vx) * k;
        m.vy += ((dy / d) * sp - m.vy) * k;
        m.vz += ((dz / d) * sp - m.vz) * k;
      } else m.vz -= 900 * DT;
      m.x += m.vx * DT;
      m.y += m.vy * DT;
      m.z += m.vz * DT;
      if (m.z <= 4 || age > 3.2 || (dhypot(m.tx - m.x, m.ty - m.y) < 18 && m.z < 40)) {
        S.msl.splice(i, 1);
        S.p = S.ps[m.o | 0] || S.p;
        blast(S, m.x, m.y, m.r, m.dmg, { kind: 'fire' });
      }
    }
  }
  // chain lightning (Keep Moving's bug zapper): the coil over the hero's shoulder discharges into the nearest zombie in reach,
  // the arc jumps to the nearest one not yet struck, and every struck zombie is stunned (bosses only slowed)
  const AREA = { area: 1 };
  const CHAIN_EVO = { cd: 0.7, n: 12, dmg: 35.2, r: 620, jump: 240, chains: 3, stun: 0.6 }; // (REV 20: damage −20 %)
  const coil = (S) => [S.p.x - S.p.face * 14, S.p.y - HERO.h * 0.86];
  function updChain(S, it) {
    const p = S.p;
    it.cd -= DT;
    if (it.cd > 0) return;
    const s = it.evo ? CHAIN_EVO : itemSt(it),
      o = coil(S),
      nT = s.n + 2 * p.st.ammo;
    it.cd = s.cd * p.st.cdMul;
    const hit = [];
    for (let c = 0; c < s.chains; c++) {
      const pts = [[Math.round(o[0]), Math.round(o[1])]];
      let cur = null;
      for (let j = 0; j < nT; j++) {
        const fx = cur ? cur.x : p.x,
          fy = cur ? cur.y : p.y;
        let best = null,
          bd = sq(j ? s.jump : s.r * p.st.range);
        for (const e of S.en) {
          if (e.dead || hit.includes(e.id) || S.t - e.spT < 0.35 || e.st === 'air') continue;
          const d2 = m2(e.x - fx, e.y - fy);
          if (d2 < bd) {
            bd = d2;
            best = e;
          }
        }
        if (!best) break;
        hit.push(best.id);
        cur = best;
        pts.push([Math.round(best.x), Math.round(best.y - D.ENEMIES[best.k].h * 0.55)]);
        if (D.ENEMIES[best.k].boss) best.slowT = S.t + s.stun * 2;
        else best.stunT = S.t + s.stun;
        damage(S, best, s.dmg * p.st.dmgMul * (1 - j * 0.03), 0, 0, false, AREA);
      }
      if (pts.length > 1) ev(S, 'zap', o[0], o[1], { pts, evo: it.evo ? 1 : 0 });
      else {
        if (!c) it.cd = 0.25;
        break;
      } // nothing in reach: check again soon
    }
  }
  // ---------- balloons (level data) on strings: sway in the wind, pop from bullets and blasts, come back after a minute ----------
  // wind: a breeze plus gust fronts that sweep the map left to right at 520 px/s (scene reads the same field for trees, litter)
  const fract = (v) => v - Math.floor(v),
    hash1 = (n) => fract(dsin(n * 127.1 + 311.7) * 43758.5453);
  function wind(x, t) {
    const u = t - x / 520,
      n = Math.floor(u / 9),
      q = u / 9 - n,
      g = dexp(-sq((q - 0.5) * 7));
    return 0.22 + 0.1 * dsin(t * 0.7) + (0.55 + 0.6 * hash1(n)) * g;
  }
  function balloonPos(b, t) {
    // the ball's centre (screen plane)
    const a = 0.1 * dsin(t * 1.6 + b.ph) + 0.05 * dsin(t * 3.1 + b.ph * 2) + 0.28 * wind(b.x, t) - 0.08;
    return [b.x + dsin(a) * b.h, b.y - dcos(a) * b.h, a];
  }
  let vbCache = { step: -1, list: [] };
  function visBalloons(S, LV) {
    if (vbCache.step === S.steps && vbCache.S === S) return vbCache.list;
    const R = S.ps.map((p) => {
        const x0 = p.cam[0] - 100,
          y0 = p.cam[1] - 100;
        return [x0, y0, x0 + camW(S, p) + 200, y0 + camH(S) + 360];
      }),
      out = []; // (in some hero's view)
    for (const b of LV.balloons) {
      if ((S.bp[b.id] || 0) > S.t || !R.some(([x0, y0, x1, y1]) => !(b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1)))
        continue;
      const [bx, by] = balloonPos(b, S.t);
      out.push({ b, x: bx, y: by });
    }
    vbCache = { step: S.steps, S, list: out };
    return out;
  }
  function popBalloon(S, bl) {
    if ((S.bp[bl.b.id] || 0) > S.t) return;
    S.bp[bl.b.id] = S.t + 60;
    ev(S, 'balpop', bl.x, bl.y, { c: bl.b.c });
  }
  function sawGeom(S, it) {
    const s = itemSt(it);
    return {
      n: (it.evo ? 8 : s.n) + (S.p.st.ammo || 0),
      R: it.evo ? 225 + dsin(S.t * 2.2) * 90 : s.r,
      spd: it.evo ? 5.2 : s.spd,
      dmg: it.evo ? 46.08 : s.dmg,
    };
  } // (REV 21: the storm's damage +20 %)
  function updSaws(S, LV, it) {
    const g = sawGeom(S, it),
      p = S.p,
      out = SC.out1;
    it.ang += g.spd * DT;
    for (let i = 0; i < g.n; i++) {
      const a = it.ang + (i / g.n) * TAU,
        x = p.x + dcos(a) * g.R,
        y = p.y - 24 + (dsin(a) * g.R) / YK;
      const n = query(x, y + 40, 100, 80, out);
      for (let k = 0; k < n; k++) {
        const e = S.en[out[k]];
        if (e.dead || e.sawT > 0) continue;
        if (m2(e.x - x, e.y - D.ENEMIES[e.k].h * 0.3 - y) > sq(e.r + 26)) continue;
        e.sawT = 0.32;
        const crit = rollCrit(S),
          ta = a + Math.PI / 2;
        damage(S, e, g.dmg * p.st.dmgMul * (crit ? 2 : 1), dcos(ta) * 160, dsin(ta) * 160, crit);
        ev(S, 'sawhit', x, y, { a: ta });
      }
      for (const di of visDestr(S, LV)) {
        const o = LV.props[di];
        if (!o.barrel && m2(o.x - x, o.y - 20 - y) < 50 * 50) hitProp(S, LV, o, g.dmg, null);
      } // (crates, not barrels)
    }
    if (it.evo) for (const gm of S.gems) if (!gm.m && m2(gm.x - p.x, gm.y - p.y) < sq(g.R + 120)) gm.m = 1;
  }
  function droneGeom(it, S) {
    const s = itemSt(it),
      q = S ? S.p.st : null;
    return {
      n: (it.evo ? 5 : s.n) + (q ? q.ammo || 0 : 0),
      dmg: it.evo ? 22 : s.dmg,
      rate: (it.evo ? 3.6 : s.rate) / (q ? q.cdMul || 1 : 1),
      pierce: it.evo ? 1 : s.pierce || 0,
    };
  }
  function updDrones(S, it) {
    const g = droneGeom(it, S),
      p = S.p;
    while (it.dr.length < g.n) it.dr.push({ x: p.x, y: p.y, cd: rnd(S) * 0.5, aim: 0, ph: rnd(S) * 6.28 });
    it.dr.length = g.n;
    it.dr.forEach((d, i) => {
      const t = S.t * 1.25 + (i / g.n) * TAU,
        tx = p.x + dcos(t) * 100 + dsin(t * 2.3 + d.ph) * 18,
        ty = p.y + dsin(t) * 46 - 10;
      const k = 1 - dexp(-DT * 5);
      d.x += (tx - d.x) * k;
      d.y += (ty - d.y) * k;
      d.cd -= DT;
      const tg = findTarget(S, d.x, d.y - 74, 480 * p.st.range, false, undefined, undefined, 74);
      if (!tg) return;
      d.aim = datan2(tg.y - D.ENEMIES[tg.k].h * 0.45 - (d.y - 74), tg.x - d.x);
      if (d.cd <= 0) {
        d.cd = 1 / g.rate;
        const mx = d.x + dcos(d.aim) * 20,
          my = d.y - 74 + dsin(d.aim) * 20;
        const zt = D.ENEMIES[tg.k].h * 0.45,
          tt = dhypot(tg.x - mx, tg.y - zt - my) / 1250;
        shoot(S, mx, my, d.aim, 1250, g.dmg * p.st.dmgMul, 3, {
          pierce: g.pierce,
          life: 0.5,
          knock: 40,
          bs: 0,
          z: 74,
          dz: (zt - 74) / Math.max(0.05, tt),
        });
        ev(S, 'shot', mx, my, { a: d.aim, w: 'drone' });
      }
    });
  }
  function updGrenadeItem(S, it) {
    const s = itemSt(it),
      p = S.p;
    it.cd -= DT;
    if (it.cd > 0) return;
    it.cd = s.cd * p.st.cdMul;
    const cand = S.en.filter((e) => !e.dead && m2(e.x - p.x, e.y - p.y) < sq(560 * p.st.range));
    if (!cand.length) {
      it.cd = 0.4;
      return;
    }
    for (let i = 0, n = s.n + p.st.ammo; i < n; i++) {
      const best = crowdPick(S, cand);
      S.gren.push({
        x0: p.x,
        y0: p.y - 50,
        x1: best.x + rr(S, -20, 20),
        y1: best.y + rr(S, -10, 10),
        t0: S.t,
        dur: 0.62,
        dmg: s.dmg * p.st.dmgMul,
        r: s.r * p.st.area,
        cl: it.evo ? 1 : 0,
        sm: 0,
        h: 140,
        rot: rnd(S) * 6,
        o: p.i | 0,
      });
    }
  }

  // ---------- pickups ----------
  // gems, coins and the rest on the ground: a hero's magnet pulls them in (o.h: the hero it flies to — together, one that goes down or
  // leaves hands it to the nearest one standing), the gems' XP is everyone's, the coins go to the run, a medkit heals who took it, a
  // chest opens for who reached it (one card screen at a time)
  // together: may hero h open chest c — one dropped for a hero (c.o) is that hero's for D.COOP.lock s after it landed (c.lt), then
  // anyone's; its hero gone or dead for good, anyone's at once
  function chestFor(S, c, h) {
    if (c.o === undefined || c.o === h.i) return true;
    const o = S.ps[c.o];
    return !o || o.gone || o.out || (c.lt !== undefined && S.t - c.lt >= D.COOP.lock);
  }
  function updatePickups(S) {
    const H = S.ps,
      solo = H.length === 1,
      t = S.t,
      pr2 = (p) => p.st.pickR * p.st.pickR;
    const fall = (o) => {
      if (o.z > 0 || o.vz) {
        o.vz -= 900 * DT;
        o.z += o.vz * DT;
        o.x += o.vx * DT;
        o.y += o.vy * DT;
        if (o.z <= 0) {
          o.z = 0;
          if (o.vz < -120) o.vz *= -0.3;
          else {
            o.vz = 0;
            o.vx = 0;
            o.vy = 0;
          }
        }
      }
    };
    const near = (x, y) => {
      let b = null,
        bd = Infinity;
      for (const p of H) {
        if (p.dead) continue;
        const d2 = m2(p.x - x, p.y - y);
        if (d2 < bd) {
          bd = d2;
          b = p;
        }
      }
      return b;
    };
    const to = (o) => {
      let p = H[o.h | 0] || H[0];
      if (!solo && p.dead) {
        const q = near(o.x, o.y);
        if (q) {
          o.h = q.i;
          p = q;
        }
      }
      return p;
    };
    const home = (o, p) => {
      const dx = p.x - o.x,
        dy = p.y - 40 - o.y,
        d = dhypot(dx, dy) || 1;
      if (o.m === 1) {
        o.m = 2;
        o.vx = (-dx / d) * 170 - (dy / d) * rr(S, -130, 130);
        o.vy = (-dy / d) * 170 + (dx / d) * rr(S, -130, 130);
        o.z = 0;
        o.vz = 0;
        o.ha = 0;
      }
      o.ha += DT;
      const acc = 2600 + o.ha * 3200;
      o.vx += (dx / d) * acc * DT;
      o.vy += (dy / d) * acc * DT;
      const dm = KD35;
      o.vx *= dm;
      o.vy *= dm;
      o.x += o.vx * DT;
      o.y += o.vy * DT;
      return d;
    };
    const pull = (o, p) => {
      o.m = 1;
      o.h = p ? p.i : 0;
    };
    if (S.vacuum) {
      for (const g of S.gems) if (!g.m) pull(g, solo ? H[0] : near(g.x, g.y));
      for (const o of S.pk) if (o.k === 'coin' && !o.m) pull(o, solo ? H[0] : near(o.x, o.y));
    } // the run won: all of it flies in
    for (let i = S.gems.length - 1; i >= 0; i--) {
      const g = S.gems[i];
      if (!g.m) {
        fall(g);
        for (const p of H)
          if ((solo || !p.dead) && m2(g.x - p.x, g.y - p.y) < pr2(p)) {
            pull(g, p);
            break;
          }
        continue;
      }
      const p = to(g);
      if (home(g, p) < 30) {
        addXp(S, g.v);
        S.xpFlash = t;
        S.p = p;
        ev(S, 'gem', p.x, p.y - 40, { v: g.v });
        S.gems.splice(i, 1);
      }
    }
    for (let i = S.pk.length - 1; i >= 0; i--) {
      const o = S.pk[i];
      if (o.k === 'coin' && !o.m)
        for (const p of H)
          if ((solo || !p.dead) && m2(o.x - p.x, o.y - p.y) < pr2(p)) {
            pull(o, p);
            break;
          }
      let p, d;
      if (o.m) {
        p = to(o);
        d = home(o, p);
      } else {
        fall(o);
        p = solo ? H[0] : near(o.x, o.y + 20);
        d = p ? dhypot(p.x - o.x, p.y - 20 - o.y) : Infinity;
      }
      if (p && d < 44 && !p.dead) {
        S.pk.splice(i, 1);
        S.p = p;
        collect(S, o);
      }
    }
    for (let i = S.chests.length - 1; i >= 0; i--) {
      const c = S.chests[i];
      if (c.z > 0) {
        c.z = Math.max(0, c.z - DT * (c.k === 'air' ? 170 : 500));
        if (c.z === 0) {
          c.lt = t;
          ev(S, 'land', c.x, c.y, { r: 60 });
        }
        continue;
      }
      const p = H.find((h) => !h.dead && m2(c.x - h.x, c.y - h.y) < 75 * 75 && chestFor(S, c, h));
      if (p && !H.some((h) => h.pause)) {
        S.p = p;
        S.chests.splice(i, 1);
        ev(S, 'open', c.x, c.y, { ck: c.k });
        if (c.n && S.mis) S.mis.got.push(c.n); // (a mission's crate: the task that wanted it is done)
        if (S.demo) continue;
        p.pause = {
          k: 'chest',
          items: c.give ? crateCards(S, c.give) : chestReward(S, c.k === 'boss'),
          coins: c.give ? 0 : c.k === 'air' ? 25 : 40,
          kind: c.k,
          t: S.t,
          s0: S.steps,
        };
      }
    }
    S.p = H[0];
    if (
      S.winAt &&
      S.t > S.winAt &&
      !S.over &&
      ((!S.gems.length && !S.pk.some((o) => o.k === 'coin')) || S.t > S.winAt + WIN_WAIT)
    )
      S.over = { win: true, t: S.winAt - 2.5, kills: S.kills, lvl: lead(S).lvl, coins: S.coins }; // (t: when the boss fell — the record)
  }
  function collect(S, o) {
    const p = S.p;
    if (o.n && S.mis) S.mis.got.push(o.n); // (one a mission's script laid: the task that wanted it is done)
    if (o.k === 'coin') {
      S.coins += o.v;
      S.coinFlash = S.t;
      ev(S, 'coin', p.x, p.y - 40);
    } else if (o.k === 'medkit') {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
      ev(S, 'heal', p.x, p.y);
      banner(S, 'hud.medkit', 'hud.heal', null, '#5cff7a', undefined, true);
    } else if (o.k === 'magnet') {
      for (const g of S.gems)
        if (!g.m) {
          g.m = 1;
          g.h = p.i | 0;
        }
      for (const c of S.pk)
        if (c.k === 'coin' && !c.m) {
          c.m = 1;
          c.h = p.i | 0;
        }
      ev(S, 'magnet', p.x, p.y);
    } else if (o.k === 'bomb') {
      ev(S, 'bomb', p.x, p.y);
      const w = camW(S);
      for (const e of S.en)
        if (
          !e.dead &&
          Math.abs(e.x - p.cam[0] - w / 2) < w / 2 + 40 &&
          Math.abs(e.y - p.cam[1] - camH(S) / 2) < camH(S) / 2 + 60
        )
          damage(S, e, D.ENEMIES[e.k].boss ? 300 : 9999, 0, 0, false, null, true);
    }
  }

  // ---------- camera ----------
  // the hero's own (S.p's): what its player sees
  // (a hero dead for good: its player's camera follows the partner still playing)
  function updateCamera(S) {
    const p = S.p,
      f = p.out ? S.ps.find((h) => !h.gone && !h.out) || p : p,
      cam = p.cam,
      cv = p.camV; // (f: the hero it follows)
    const ld = p.lead || (p.lead = [0, 0]),
      q = 1 - dexp(-DT * 3.2); // the lead eases in/out (no whip on reversals)
    const ao = f === p ? p.aimOff : null,
      vk = ao ? 0.4 : 0.7,
      al = p.alead || (p.alead = [0, 0]),
      qa = 1 - dexp(-DT * 4);
    ld[0] += (f.vx * vk - ld[0]) * q;
    ld[1] += (f.vy * vk * 0.8 - ld[1]) * q;
    al[0] += ((ao ? clamp(ao[0] * 0.24, -170, 170) : 0) - al[0]) * qa;
    al[1] += ((ao ? clamp(ao[1] * 0.24, -110, 110) : 0) - al[1]) * qa; // look toward the cursor
    const tx = clamp(f.x - camW(S) / 2 + ld[0] + al[0], 0, WX - camW(S)),
      ty = clamp(f.y - camH(S) / 2 + ld[1] + al[1], 0, WY - camH(S));
    for (const k of [0, 1]) {
      const tg = k ? ty : tx;
      cv[k] += (55 * (tg - cam[k]) - 14.8 * cv[k]) * DT;
      cam[k] += cv[k] * DT;
    }
  }

  // ---------- cheats (play mode) ----------
  function cheat(S, c) {
    if (c === 'lvl') {
      S.p.pend++;
      S.p.lvl++;
      S.p.need = D.XP_NEED(S.p.lvl);
    } else if (c === 'time') {
      S.t += 60;
      S.nextHorde = Math.min(S.nextHorde, S.t + 1);
    } else if (c === 'god') S.p.god = !S.p.god;
    else if (c === 'boss') {
      const k = BOSS_ORDER.find((k) => !S.done[k]); // the next boss now (none while one is alive)
      if (k && !S.en.some((e) => !e.dead && D.ENEMIES[e.k].boss)) {
        S.done[k] = 1;
        if (S.mis)
          bossIn(S, level(S.seed), k, k); // (a mission run's: counted as its group, as on schedule)
        else spawnBoss(S, level(S.seed), k);
      }
    } else if (c === 'horde') {
      const LV = level(S.seed);
      for (let i = 0; i < 300; i++) {
        const pt = offscreenPoint(S, LV, rnd(S) * TAU);
        if (pt) addEnemy(S, typeAt(S, S.t / 60), pt[0], pt[1]);
      }
    }
  }

  // ---------- attract demo ----------
  function scriptInput(t, S) {
    // the bot circles the plaza, steering away from the densest nearby zombies
    const p = S.p,
      inp = { left: 0, right: 0, up: 0, down: 0 };
    let fx = dcos(t * 0.35) * 0.9,
      fy = dsin(t * 0.35 * 1.3) * 0.7;
    for (const e of S.en) {
      const dx = p.x - e.x,
        dy = (p.y - e.y) * 2,
        d2 = dx * dx + dy * dy;
      if (d2 < 180 * 180 && d2 > 1) {
        fx += (dx / d2) * 120;
        fy += (dy / d2) * 60;
      }
    }
    const m = dhypot(fx, fy) || 1;
    inp.jx = fx / m;
    inp.jy = fy / m;
    return inp;
  }
  function demoState() {
    const S = create({ weapon: 'minigun', demo: true, seed: 7 });
    S.p.main.lvl = 4;
    S.p.items.push(newItem('saws', 2), newItem('drone', 2));
    S.p.lvl = 15;
    S.p.need = D.XP_NEED(15);
    S.p.xp = S.p.need * 0.7;
    recalc(S);
    S.t = 0;
    return S;
  }
  let cache = null;
  function at(t) {
    const loop = Math.floor(t / L),
      q = t - loop * L,
      n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n)
      cache = { loop, S: Object.assign(demoState(), { wt0: loop * L }) };
    const S = cache.S;
    while (S.steps < n) step(S, scriptInput(S.t, S));
    return Object.assign({}, S, { loop, q });
  }
  const demoCheck = (S) => S.kills >= 20 && !S.p.dead;
  function selfCheck() {
    const LV = level(7),
      S = create({ seed: 7 }),
      f = [];
    const [px, py] = [S.p.x, S.p.y];
    if (blockedS(S, LV, px, py, 10)) f.push('spawn point is inside a collider');
    let open = 0;
    for (const b of LV.navBlocked) if (!b) open++;
    if (open < NN * NN * 0.5) f.push('less than half of the map is walkable');
    if (MAP_LAB) {
      const LL = level(LAB0 + 1);
      for (const [gx, gy] of LL.starts || []) {
        const [x, y] = toS(gx, gy);
        if (blockedS(null, LL, x - 65, y, 34) || blockedS(null, LL, x + 65, y, 34))
          f.push('a lab start is inside a collider: ' + gx + ',' + gy);
      }
      if (LL.hall) {
        const [x, y] = toS((LL.hall[0] + LL.hall[2]) / 2 + 260, (LL.hall[1] + LL.hall[3]) / 2 + 260);
        if (blockedS(null, LL, x, y, 90)) f.push('the lab boss lands in a collider');
      }
    }
    const old = create({ seed: 7 });
    old.p.items.push(newItem('mine', 2));
    old.pause = { k: 'lv', cards: [{ ty: 'new', id: 'firering', lvl: 1 }], t: 0 };
    migrate(old); // a run saved before items were retired
    if (old.p.items.some((it) => !D.ITEMS[it.id]) || (old.pause && !old.pause.cards.every((c) => knownCard(c, old))))
      f.push('migrate leaves retired items in a restored run');
    return f;
  }

  // the page's own hero (S.me: its index in S.ps) made S.p — and S.cam, S.camV, S.vw, S.pause its own (the sim never reads S.me)
  const focus = (S, me) => {
    S.me = me | 0;
    return alias(S);
  };
  root.SIM = {
    REV,
    DT,
    L,
    VIEW,
    ZOOM,
    G,
    WX,
    WY,
    YK,
    HERO,
    PROP,
    EDGE,
    WALL_M,
    LAB0,
    OFFICE,
    BASE,
    mapOf,
    goal,
    marksOf,
    gasAt,
    inHall,
    GAS_TICK,
    toS,
    toGx,
    toGy,
    level,
    setMap,
    create,
    spawn,
    respawn,
    outOfPlay,
    step,
    at,
    scriptInput,
    demoCheck,
    selfCheck,
    focus,
    coopK,
    chestFor,
    hand,
    muzzle,
    muzzleZ,
    shotStop,
    mainStats,
    sawGeom,
    droneGeom,
    itemLvl,
    itemStats,
    cardOptions,
    spawnAt,
    cheat,
    recalc,
    newItem,
    m2,
    demoState,
    addEnemy,
    ev,
    banner,
    decal,
    kill,
    wind,
    balloonPos,
    coil,
    GRAV,
    migrate,
    typeAt,
    yawOf,
    gunScale,
    blockedAt,
  };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
