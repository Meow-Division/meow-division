// live/economy.js — every number of Meow Division's economy in one readable file: the items (their ids are the
// NEP-245 token ids, fixed forever), what containers and bosses drop on each map, Walt's prices and the reasons
// he gives, kit recipes, building levels, the backpack and the safe. The game, its server (the run replay and
// Walt's market) and the contract set-up script all read this file; no other file holds an economy number.
// It is a rules file (the server replays loot rolls with it): arrays only, Math limited to round/floor/min/max.
(function (root) {
  const E = {};

  // ---------- items ----------
  // id: the token id on chain, never renamed (the name a player sees is item.<id> in the language packs).
  // kind: material (found, sold, crafted with), trophy (one per boss kill), kit (crafted, taken into a run, used up), weapon (a
  // rare gun: data.js MAIN of the same id; put in the gear's gun slot it is played with, rules.js gear).
  // rarity: 1 common, 2 uncommon, 3 rare, 4 trophy, 5 legendary (the colour of its frame; 5 red).
  // base: what Walt pays, in coins, when he holds `norm` of it. With an empty shelf he pays twice that; with three
  // times `norm` on the shelf, half. Kits have no price: Walt does not trade them. (REV 45, 2026-11-12:
  // every base × 3, what Walt pays; what he asks × 5: SELL_MARKUP 1.4 → 1.4 × 5 / 3)
  E.ITEMS = [
    { id: 'gears', kind: 'material', rarity: 1, base: 36, norm: 40 },
    { id: 'tape', kind: 'material', rarity: 1, base: 30, norm: 40 },
    { id: 'fuel', kind: 'material', rarity: 1, base: 42, norm: 30 },
    { id: 'cans', kind: 'material', rarity: 1, base: 24, norm: 50 },
    { id: 'bandages', kind: 'material', rarity: 1, base: 30, norm: 40 },
    { id: 'bulbs', kind: 'material', rarity: 1, base: 36, norm: 40 },
    { id: 'tools', kind: 'material', rarity: 2, base: 105, norm: 20 },
    { id: 'catfood', kind: 'material', rarity: 2, base: 90, norm: 20 },
    { id: 'antiseptic', kind: 'material', rarity: 2, base: 96, norm: 20 },
    { id: 'chips', kind: 'material', rarity: 2, base: 120, norm: 20 },
    { id: 'gpu', kind: 'material', rarity: 3, base: 450, norm: 8 },
    { id: 'vaccine', kind: 'material', rarity: 3, base: 360, norm: 8 },
    { id: 'usb', kind: 'material', rarity: 3, base: 330, norm: 8 },
    // building materials: what the base and the kits are made of (stash racks, range stands, generator wiring, gun
    // parts, the backpack and the vest)
    { id: 'nuts', kind: 'material', rarity: 1, base: 24, norm: 50 },
    { id: 'screws', kind: 'material', rarity: 1, base: 24, norm: 50 },
    { id: 'planks', kind: 'material', rarity: 1, base: 30, norm: 40 },
    { id: 'scrap', kind: 'material', rarity: 1, base: 27, norm: 50 },
    { id: 'wires', kind: 'material', rarity: 1, base: 36, norm: 40 },
    { id: 'springs', kind: 'material', rarity: 2, base: 84, norm: 20 },
    { id: 'battery', kind: 'material', rarity: 2, base: 120, norm: 15 },
    { id: 'fabric', kind: 'material', rarity: 1, base: 27, norm: 50 },
    { id: 't_butcher', kind: 'trophy', rarity: 4, base: 180, norm: 4, boss: 'butcher' }, // the cleaver: the first sale buys the workbench
    { id: 't_pustule', kind: 'trophy', rarity: 4, base: 240, norm: 4, boss: 'pustule' },
    { id: 't_screamer', kind: 'trophy', rarity: 4, base: 330, norm: 4, boss: 'screamer' },
    { id: 't_tank', kind: 'trophy', rarity: 4, base: 450, norm: 3, boss: 'tank' },
    { id: 't_shroom', kind: 'trophy', rarity: 4, base: 420, norm: 3, boss: 'golem' }, // the Mushroom boss: also opens the range
    { id: 'k_medkit', kind: 'kit', rarity: 2, base: 0, norm: 0 },
    { id: 'k_grenades', kind: 'kit', rarity: 2, base: 0, norm: 0 },
    { id: 'k_magnet', kind: 'kit', rarity: 2, base: 0, norm: 0 },
    { id: 'k_vest', kind: 'kit', rarity: 3, base: 0, norm: 0 },
    { id: 'k_vaccine', kind: 'kit', rarity: 3, base: 0, norm: 0 },
    // the Phantom, the rare rifle bosses drop (RARE below): Walt pays `base` for it and asks `ask`, whatever his shelf, and
    // has one to sell only when a player sold him one (none of his own; it never wears off his shelf). late: added after the
    // contract's launch, so on the wallets only once its owner has registered it (server/chain.mjs late)
    { id: 'phantom', kind: 'weapon', rarity: 5, base: 5000, norm: 1, ask: 15000, late: 1 },
  ];

  // ---------- a run: what the player can carry out ----------
  E.BAG_SLOTS = 8; // items carried in a run; lost on death
  E.BAG_SLOTS_STASH3 = 10; // the backpack with the stash at level 3
  E.SAFE_SLOTS = [0, 1, 2, 2]; // kept even on death, by stash level 0..3
  E.STACK = 5; // one slot holds up to 5 of one material; trophies and kits take a slot each
  E.SEARCH_SECONDS = 1.5; // standing next to a container this long opens it
  E.EVAC_FROM = 240; // seconds into a run when the evacuation point opens (leave with what you carry)
  E.EVAC_HOLD = 10; // seconds Copper must stay on the evacuation point before the run ends
  E.KITS_PER_RUN = 2; // kits a player may take into one run
  // In the run (as Escape from Duckov has it; live/sim.js plays it): what lies on the ground is taken by hand into the
  // backpack's first slot that fits; with it full the player opens it and throws out or moves what he doesn't need.
  // The way out is the evac button: from EVAC_FROM s, or at once when the run's goal is done (the map is clear then
  // and it takes EVAC_CLEAR s, not EVAC_HOLD). Out by the evac: the backpack and the safe are kept; fallen or quit:
  // the safe only.
  E.EVAC_CLEAR = 3;
  // how many of one item one slot holds
  E.stack = (id) => {
    const it = E.item(id);
    return it && it.kind === 'material' ? E.STACK : 1;
  };
  // what the zombies leave on the raids' maps (those with a loot table below: suburb, lab): each one killed rolls its
  // map's table with the chance `kill`, a boss `boss` times and its trophy besides (every boss leaves its own). Some
  // 4500 die in a ten-minute raid: about five rolls from the crowd and four from the bosses, as `boxes` plans. Together
  // (sim.js killLoot, REV 45) both × the heroes still in the run, and each of them gets every boss's trophy. The clover
  // (the run's passive) makes both clover × its level more of them for the hero who killed (REV 45,
  // 2026-11-12: +5 % a level, +25 % in all; its luck for the coins and
  // the pickups stays as it is, +15 % a level): a boss's rolls past a whole one are one more by that chance
  // (REV 51: kill 0.0012 → 0.001, about four rolls from the crowd)
  E.DROP = { kill: 0.001, boss: 1, clover: 0.05 };
  // the rare guns a boss may leave on the raids' maps (those with a loot table) besides its trophy and its rolls: `boss`
  // the chance from any boss, `final` from a map's last boss (FINAL_BOSSES). One roll a boss whoever plays; the clover
  // doesn't touch it. It lies on the ground for whoever takes it first (a backpack thing: lost on a death before the evac)
  E.RARE = [{ id: 'phantom', boss: 0.003, final: 0.02 }]; // (REV 51: 1 % and 5 % before)
  E.FINAL_BOSSES = ['golem', 'heart']; // the suburb's Mushroom Monster, the lab's Devourer

  // ---------- Walt's market ----------
  // Walt sells for SELL_MARKUP × what he would pay for the same item at the same stock (and always more than he pays to take it
  // back). REV 45: 1.4 → 2.33, with the bases × 3 his asks × 5
  E.SELL_MARKUP = 2.33;
  E.DECAY_PER_DAY = 0.05; // every day Walt's stock of each item shrinks by 5 %: he uses it up (a small shelf too, see decayDay)
  E.MIN_PRICE = 1; // no price falls below one coin

  // ---------- the tables the economy page edits (econ-editor.bat → live/econ.html) ----------
  // Between each <name> and </name> marker the page writes its table anew (server/econfile.mjs). Edit them there or by
  // hand; a comment inside a table does not survive the page's next save, so notes go above the markers.

  // loot: what a container gives, per map (office: mission 1 at the NEAR AI office; suburb: mission 2 and the suburb
  // raids; lab: the laboratory). Each container rolls `rolls` times on its map's table; `boxes` is about how many
  // containers one raid opens, an estimate the page plans "raids needed" with until the maps count their own. An entry
  // is [token id, weight, least, most]: its chance is its weight over the table's total; the amount is least..most,
  // evenly. Planks and fabric in the office: broken desks and chairs. Battery in the suburbs: the cars in driveways.
  // <loot>
  E.LOOT = [
    {
      map: 'suburb',
      rolls: 1,
      boxes: 8,
      table: [
        ['scrap', 20, 1, 2],
        ['planks', 16, 1, 2],
        ['nuts', 16, 1, 2],
        ['screws', 14, 1, 2],
        ['fabric', 14, 1, 2],
        ['cans', 12, 1, 2],
        ['tape', 12, 1, 1],
        ['gears', 12, 1, 1],
        ['fuel', 12, 1, 1],
        ['springs', 12, 1, 1],
        ['tools', 9, 1, 1],
        ['bandages', 8, 1, 1],
        ['wires', 8, 1, 1],
        ['bulbs', 6, 1, 1],
        ['catfood', 6, 1, 1],
        ['battery', 4, 1, 1],
        ['antiseptic', 3, 1, 1],
        ['chips', 3, 1, 1],
        ['usb', 1, 1, 1],
        ['gpu', 1, 1, 1],
      ],
    },
    {
      map: 'lab',
      rolls: 1,
      boxes: 8,
      table: [
        ['bandages', 16, 1, 2],
        ['wires', 14, 1, 2],
        ['scrap', 12, 1, 2],
        ['antiseptic', 12, 1, 1],
        ['bulbs', 10, 1, 1],
        ['springs', 9, 1, 1],
        ['chips', 8, 1, 1],
        ['fabric', 8, 1, 1],
        ['tools', 7, 1, 1],
        ['screws', 6, 1, 1],
        ['nuts', 6, 1, 1],
        ['battery', 6, 1, 1],
        ['gears', 5, 1, 1],
        ['tape', 5, 1, 1],
        ['fuel', 4, 1, 1],
        ['planks', 3, 1, 1],
        ['cans', 3, 1, 1],
        ['catfood', 3, 1, 1],
        ['usb', 3, 1, 1],
        ['vaccine', 3, 1, 1],
        ['gpu', 2, 1, 1],
      ],
    },
  ];
  // </loot>

  // kit recipes: crafted at a building of the given level, for `coins` (kept by the server) and the inputs (spent from
  // the wallet; mirrored on chain by the contract). Grenades: a can for the casing, fuel inside, nuts for shrapnel.
  // Magnet: a wire coil on a scrap core, a battery to run it. Vest: fabric with scrap plates.
  // <recipes>
  E.RECIPES = [
    {
      id: 'medkit',
      at: 'medbay',
      level: 1,
      coins: 0,
      inputs: [
        ['bandages', 2],
        ['antiseptic', 1],
      ],
      output: ['k_medkit', 1],
    },
    {
      id: 'grenades',
      at: 'workbench',
      level: 1,
      coins: 0,
      inputs: [
        ['cans', 1],
        ['fuel', 1],
        ['nuts', 2],
        ['tape', 1],
      ],
      output: ['k_grenades', 1],
    },
    {
      id: 'magnet',
      at: 'workbench',
      level: 2,
      coins: 0,
      inputs: [
        ['wires', 3],
        ['scrap', 2],
        ['battery', 1],
      ],
      output: ['k_magnet', 1],
    },
    {
      id: 'vest',
      at: 'workbench',
      level: 2,
      coins: 0,
      inputs: [
        ['fabric', 2],
        ['scrap', 3],
        ['tape', 1],
      ],
      output: ['k_vest', 1],
    },
    {
      id: 'vaccine',
      at: 'medbay',
      level: 3,
      coins: 0,
      inputs: [
        ['vaccine', 1],
        ['antiseptic', 1],
      ],
      output: ['k_vaccine', 1],
    },
  ];
  // </recipes>

  // the base: buildings and their levels. levels[n - 1] is what level n costs: coins (kept by the server) and items
  // (spent from the wallet). power: the generator level that level needs. opens: what the player gets at that level.
  // lockedBy: a trophy the player must have brought home once (shown, not spent). Level 1 of the generator, the
  // workbench and the medbay is Nova's base tutorial (the human's, 2026-11-11: hub.js): cheap parts only, no coins —
  // Walt keeps them on his shelf (WALT_BASICS) and the first suburb boss drops a set once (rules.js gift).
  // <buildings>
  E.BUILDINGS = [
    {
      id: 'generator',
      levels: [
        {
          coins: 0,
          items: [
            ['fuel', 1],
            ['bulbs', 2],
            ['wires', 1],
          ],
          power: 0,
          opens: 'power1',
        },
        {
          coins: 900,
          items: [
            ['fuel', 6],
            ['battery', 2],
            ['chips', 1],
          ],
          power: 0,
          opens: 'power2',
        },
      ],
    },
    {
      id: 'stash',
      levels: [
        {
          coins: 150,
          items: [
            ['planks', 4],
            ['screws', 3],
          ],
          power: 0,
          opens: 'safe1',
        },
        {
          coins: 600,
          items: [
            ['scrap', 5],
            ['nuts', 4],
            ['tools', 1],
          ],
          power: 1,
          opens: 'safe2',
        },
        {
          coins: 1300,
          items: [
            ['fabric', 6],
            ['tape', 3],
            ['springs', 1],
          ],
          power: 2,
          opens: 'bag10',
        },
      ],
    },
    {
      id: 'workbench',
      levels: [
        {
          coins: 0,
          items: [
            ['nuts', 1],
            ['screws', 1],
            ['tape', 1],
            ['planks', 1],
            ['scrap', 1],
          ],
          power: 0,
          opens: 'craft1',
        },
        {
          coins: 700,
          items: [
            ['tools', 2],
            ['gears', 3],
            ['scrap', 3],
          ],
          power: 1,
          opens: 'craft2',
        },
        {
          coins: 1500,
          items: [
            ['springs', 3],
            ['tools', 2],
            ['chips', 2],
          ],
          power: 2,
          opens: 'craft3',
        },
      ],
    },
    {
      id: 'medbay',
      levels: [
        {
          coins: 0,
          items: [
            ['antiseptic', 2],
            ['bandages', 3],
          ],
          power: 0,
          opens: 'craft1',
        },
        {
          coins: 700,
          items: [
            ['antiseptic', 3],
            ['bulbs', 3],
            ['wires', 2],
          ],
          power: 1,
          opens: 'craft2',
        },
        {
          coins: 1500,
          items: [
            ['vaccine', 1],
            ['chips', 2],
            ['battery', 1],
          ],
          power: 2,
          opens: 'craft3',
        },
      ],
    },
    {
      id: 'range',
      lockedBy: 't_shroom',
      levels: [
        {
          coins: 300,
          items: [
            ['planks', 4],
            ['screws', 3],
            ['scrap', 2],
          ],
          power: 0,
          opens: 'range1',
        },
        {
          coins: 1000,
          items: [
            ['springs', 2],
            ['bulbs', 3],
            ['battery', 1],
          ],
          power: 1,
          opens: 'range2',
        },
      ],
    },
  ];
  // </buildings>
  // seconds a building's level takes to put up once paid for (level 1, 2, 3; the human's: the generator in 5 s)
  E.BUILD_TIME = [5, 60, 300];
  // the room a building stands in, cleared of the old office's junk first (sim.js HUB_JUNK: the props of each heap)
  E.ROOM = { workbench: 'alcove', medbay: 'meeting' };
  // the base's heaps of junk, each cleared once for free (a gear over it, hub.js): the n-th clearing takes CLEAR_TIME[n]
  // seconds of real time (the last one for every later one) — the human's, 2026-11-11: 5 s, a minute, 5 min, half an
  // hour, an hour, two, three and a half and so on. One at a time
  // (the alcove's heap takes the desk before it; the reception's, the blood in front of it)
  E.JUNK = ['alcove', 'meeting', 'storage', 'desk2', 'desk3', 'desk4', 'reception', 'mess'];
  E.CLEAR_TIME = [5, 60, 300, 1800, 3600, 7200, 12600, 18000, 25200, 36000];
  // what Walt always keeps of the cheap parts the base tutorial asks for (server/walt.mjs tops his shelf up to these
  // each day: the first players find them there)
  E.WALT_BASICS = {
    fuel: 6,
    bulbs: 8,
    wires: 6,
    nuts: 6,
    screws: 6,
    tape: 6,
    planks: 6,
    scrap: 6,
    antiseptic: 6,
    bandages: 8,
  };

  // upgrades: the items each level costs on top of its coins (the coins: D.META[id].price for the account's upgrades,
  // D.WEAPON_UP[id].price for a gun's, in live/data.js). meta.<id>[n - 1] and weapon.<id>[n - 1]: level n. Level 1 is
  // coins alone; from level 2 the stash pays the items too (rules.js upItems, SIM.REV 44): one at level 2, then more and
  // rarer, so Walt's shelf and the raids' loot are wanted all along (the human's, 2026-11-12)
  // <upgrades>
  E.UPGRADES = {
    meta: {
      hp: [
        [],
        [['bandages', 1]],
        [
          ['bandages', 3],
          ['cans', 2],
        ],
        [
          ['fabric', 4],
          ['catfood', 2],
          ['antiseptic', 1],
        ],
        [
          ['catfood', 3],
          ['antiseptic', 2],
          ['vaccine', 1],
        ],
      ],
      dmg: [
        [],
        [['scrap', 1]],
        [
          ['gears', 3],
          ['nuts', 3],
        ],
        [
          ['tools', 2],
          ['chips', 1],
        ],
        [
          ['chips', 2],
          ['gpu', 1],
        ],
      ],
      speed: [
        [],
        [['tape', 1]],
        [
          ['fabric', 3],
          ['tape', 2],
        ],
        [
          ['springs', 2],
          ['fabric', 3],
        ],
        [
          ['springs', 2],
          ['tools', 1],
        ],
      ],
      magnet: [
        [],
        [['wires', 1]],
        [
          ['wires', 3],
          ['scrap', 2],
        ],
        [
          ['battery', 1],
          ['wires', 4],
        ],
        [
          ['battery', 2],
          ['chips', 1],
        ],
      ],
      reroll: [
        [],
        [['usb', 1]],
        [
          ['usb', 1],
          ['chips', 2],
        ],
      ],
      start: [
        [],
        [['planks', 1]],
        [
          ['tools', 2],
          ['battery', 1],
          ['scrap', 4],
        ],
      ],
    },
    weapon: {
      dmg: [
        [],
        [['scrap', 1]],
        [
          ['gears', 2],
          ['scrap', 2],
        ],
        [
          ['scrap', 3],
          ['tools', 1],
        ],
        [
          ['tools', 1],
          ['chips', 1],
        ],
      ],
      rate: [
        [],
        [['springs', 1]],
        [
          ['springs', 1],
          ['nuts', 2],
        ],
        [
          ['springs', 1],
          ['tools', 1],
        ],
        [
          ['springs', 2],
          ['gears', 2],
        ],
      ],
      mag: [
        [],
        [['tape', 1]],
        [
          ['scrap', 2],
          ['nuts', 2],
        ],
        [
          ['springs', 1],
          ['tape', 2],
        ],
        [
          ['springs', 2],
          ['scrap', 2],
        ],
      ],
    },
  };
  // </upgrades>

  // ---------- the day's tasks (the human's, 2026-11-12; rules.js daily: a day is a UTC day) ----------
  // Walt's: one a day, the same for every player (the day's number picks it), n of an item brought to him: he takes them
  // as a sale on his shelf and pays DAILY_WALT_K times what that sale pays — more than selling, and less than buying
  // them back from him would cost (rules.js waltPay: bought from him and brought back, they never earn). Trophies come
  // from the raids'
  // bosses: the Pustule's, the Screamer's, the Golem's (the suburb's final boss: its mushroom)
  E.DAILY_WALT = [
    ['springs', 15],
    ['gears', 15],
    ['tape', 15],
    ['wires', 12],
    ['nuts', 20],
    ['scrap', 20],
    ['fabric', 15],
    ['bandages', 12],
    ['bulbs', 12],
    ['planks', 15],
    ['tools', 4],
    ['chips', 4],
    ['battery', 3],
    ['antiseptic', 4],
    ['catfood', 4],
    ['t_shroom', 3],
    ['t_pustule', 3],
    ['t_screamer', 2],
  ];
  E.DAILY_WALT_K = 1.3;
  // Nova's: a raid won on the suburb's map and one on the lab's, each once a day (a mission's win there too): coins and
  // rank XP on the run's results
  E.DAILY_NOVA = { suburb: { coins: 500, xp: 250 }, lab: { coins: 1000, xp: 500 } };

  // ---------- barter: Walt trades a weapon for items ----------
  E.BARTER = [
    { id: 'gpu_minigun', give: [['gpu', 1]], weapon: 'minigun' },
    {
      id: 'usb_sniper',
      give: [
        ['usb', 1],
        ['chips', 2],
      ],
      weapon: 'sniper',
    },
  ];

  // ---------- fast-forward: a week of trading in a minute, for judges ----------
  // Each simulated day other players sell `sales` random materials to Walt and buy `buys` from him, then decay runs.
  E.FAST_FORWARD = { days: 7, seconds: 60, sales: 6, buys: 3 };

  // ---------- the campaign (docs/design.md, "The story"): the missions in their order on the map ----------
  // n: the number shown on the map. map: the run map it plays on (mission 1: the office's own, live/map_office.js).
  // reward: what the first finish pays: coins, rank XP and items. soon: on the map, locked, not playable yet.
  E.MISSIONS = [
    {
      id: 'office',
      n: '1-1',
      map: 'office',
      // (REV 45: 150 → 1400, the human's, 2026-11-12: Walt's rescue pays for the parts of the generator's and the workbench's
      // first levels bought from him — 1146 at his usual shelf (WALT_BASICS), 1293 with it down to the last ones, at his
      // asks × 5; with the win's bonus and the cleaver sold, the medbay's too: test/economy.test)
      reward: {
        coins: 1400,
        xp: 300,
        items: [['t_butcher', 1]],
      },
    },
    {
      id: 'suburb',
      n: '1-2',
      map: 'suburb',
      anyWin: 1, // (its one task is the suburbs' final boss, a raid's win: any raid won there while it is next counts as it, rules.js bank)
      reward: {
        coins: 250,
        xp: 500,
        items: [['t_shroom', 1]],
      },
    },
    {
      id: 'lab',
      n: '1-3',
      map: 'lab',
      reward: {
        coins: 350,
        xp: 700,
        items: [['antiseptic', 2]], // (the vaccine: the mission's goal, taken where the Devourer fell — missions.js lab)
      },
    },
    { id: 'port', n: '1-4', soon: true },
    { id: 'military', n: '1-5', soon: true },
  ];

  // ---------- lookups and prices (pure functions of the numbers above) ----------
  E.mission = (id) => {
    for (let i = 0; i < E.MISSIONS.length; i++) if (E.MISSIONS[i].id === id) return E.MISSIONS[i];
    return null;
  };
  E.item = (id) => {
    for (let i = 0; i < E.ITEMS.length; i++) if (E.ITEMS[i].id === id) return E.ITEMS[i];
    return null;
  };
  E.tradable = (id) => {
    const it = E.item(id);
    return !!it && it.base > 0;
  };
  // what Walt pays for one `id` while he holds `stock` of it
  E.buyPrice = (id, stock) => {
    const it = E.item(id);
    if (!it || it.base <= 0) return 0;
    if (it.ask) return it.base; // (a rare gun: one price)
    const s = Math.max(0, Math.floor(stock || 0));
    return Math.max(E.MIN_PRICE, Math.round((it.base * 2 * it.norm) / (it.norm + s)));
  };
  // what Walt asks for one `id` while he holds `stock` of it (0: he has none to sell): the markup on what he pays, and at
  // least a coin more than he pays for that one back (at stock - 1, where the sale leaves him), so buying from him and
  // selling straight back never earns, not even where the prices are down to a coin or two
  E.sellPrice = (id, stock) =>
    stock > 0 && (E.item(id) || {}).ask
      ? E.item(id).ask
      : stock > 0
        ? Math.max(E.MIN_PRICE, Math.round(E.buyPrice(id, stock) * E.SELL_MARKUP), E.buyPrice(id, stock - 1) + 1)
        : 0;
  // one day of decay: DECAY_PER_DAY of the stock, counted in hundredths of an item. owed: the hundredths not taken on the
  // days before (0..99), carried on, so a small shelf thins out too (10 lose one every other day; rounded down each day,
  // a shelf under 20 never did). Returns [the stock left, the hundredths carried to the next day]
  const DUE = Math.round(E.DECAY_PER_DAY * 100);
  E.decayDay = (stock, owed) => {
    const s = Math.max(0, Math.floor(stock || 0)),
      due = s * DUE + Math.max(0, Math.min(99, Math.floor(owed || 0))),
      left = Math.max(0, s - Math.floor(due / 100));
    return [left, left > 0 ? due % 100 : 0];
  };
  // the stock after one day of decay (owed: as decayDay)
  E.decay = (stock, owed) => E.decayDay(stock, owed)[0];
  // what Walt pays for n of `id` sold one after another from `stock` (each one sold fills his shelf: the next pays a
  // little less), and what he asks for n bought one after another (each one taken empties it: the next costs more);
  // 0 when he has fewer than n to sell
  E.sellTotal = (id, n, stock) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += E.buyPrice(id, (stock || 0) + i);
    return sum;
  };
  E.buyTotal = (id, n, stock) => {
    if ((stock || 0) < n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += E.sellPrice(id, stock - i);
    return sum;
  };
  // one day of the other players at Walt's (the server's Walt between real players' trades, and the week before the
  // market opened): FAST_FORWARD.sales random materials sold to him, one or two of each, FAST_FORWARD.buys bought
  // from what he holds, then the day's decay. stock: { id: n } changed in place; u: a random number in [0, 1) each
  // call (the server's; this is no part of a run); rest: { id: hundredths } the decay carried from day to day
  // (decayDay; changed in place: the server's shelf keeps it) — without one, each item's carry is drawn with u, which
  // takes the same 5 % on average. on (optional): told of each step as it is done, for the market's fast-forward
  // (market.js plays them out one by one): { k: 'sell', id, n } a player's sale to him, { k: 'buy', id } a player's buy,
  // { k: 'decay', gone: { id: n } } the day's decay
  E.otherPlayersDay = (stock, u, rest, on) => {
    const mats = [],
      gone = {};
    for (let i = 0; i < E.ITEMS.length; i++) if (E.ITEMS[i].kind === 'material') mats.push(E.ITEMS[i].id);
    for (let i = 0; i < E.FAST_FORWARD.sales; i++) {
      const id = mats[Math.floor(u() * mats.length)],
        n = 1 + Math.floor(u() * 2);
      stock[id] = (stock[id] || 0) + n;
      if (on) on({ k: 'sell', id, n });
    }
    for (let i = 0; i < E.FAST_FORWARD.buys; i++) {
      const id = mats[Math.floor(u() * mats.length)];
      if (stock[id] > 0) {
        stock[id]--;
        if (on) on({ k: 'buy', id });
      }
    }
    for (let i = 0; i < E.ITEMS.length; i++) {
      const id = E.ITEMS[i].id;
      if (E.ITEMS[i].ask) continue; // (a rare gun stays on his shelf till a player buys it)
      if (stock[id] > 0) {
        const [n, carry] = E.decayDay(stock[id], rest ? rest[id] : Math.floor(u() * 100));
        if (n < stock[id]) gone[id] = stock[id] - n;
        stock[id] = n;
        if (rest && carry) rest[id] = carry;
        else if (rest) delete rest[id];
      } else if (rest) delete rest[id];
      if (stock[id] === 0) delete stock[id];
    }
    if (on) on({ k: 'decay', gone });
    return stock;
  };
  // Walt's reasoning for a price, as a language-pack key and its numbers (the tooltip; NEAR AI may rephrase the
  // sentence, never the numbers). `recent`: how many of the item players sold him in the last day.
  E.explain = (id, stock, recent) => {
    const it = E.item(id);
    if (!it || it.base <= 0) return { key: 'walt.why.noTrade', vars: {} };
    const vars = {
      stock,
      norm: it.norm,
      buy: E.buyPrice(id, stock),
      sell: E.sellPrice(id, stock),
      recent: recent || 0,
    };
    if (it.kind === 'trophy') return { key: 'walt.why.trophy', vars }; // one per boss kill: no talk of a shelf to fill
    if (it.ask) return { key: 'walt.why.rare', vars: { ...vars, sell: it.ask } }; // a rare gun: one price, whatever the shelf
    if (stock < it.norm / 2) return { key: 'walt.why.short', vars }; // few on the shelf: he pays more
    if (stock > it.norm * 2) return { key: 'walt.why.glut', vars }; // shelf full: he pays less
    return { key: 'walt.why.fair', vars };
  };
  E.recipe = (id) => {
    for (let i = 0; i < E.RECIPES.length; i++) if (E.RECIPES[i].id === id) return E.RECIPES[i];
    return null;
  };
  E.building = (id) => {
    for (let i = 0; i < E.BUILDINGS.length; i++) if (E.BUILDINGS[i].id === id) return E.BUILDINGS[i];
    return null;
  };
  E.loot = (map) => {
    for (let i = 0; i < E.LOOT.length; i++) if (E.LOOT[i].map === map) return E.LOOT[i];
    return null;
  };
  // the trophy a boss leaves (null: that enemy leaves none)
  E.trophyOf = (boss) => {
    for (let i = 0; i < E.ITEMS.length; i++) if (E.ITEMS[i].boss === boss) return E.ITEMS[i].id;
    return null;
  };
  // one container roll from a loot table with a random number u in [0, 1) and another v for the amount
  E.roll = (table, u, v) => {
    let total = 0;
    for (let i = 0; i < table.length; i++) total += table[i][1];
    let pick = Math.floor(u * total);
    for (let i = 0; i < table.length; i++) {
      const [id, w, least, most] = table[i];
      if (pick < w) return [id, least + Math.floor(v * (most - least + 1))];
      pick -= w;
    }
    return null;
  };

  root.ECONOMY = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
