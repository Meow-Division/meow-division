// live/economy.js — every number of Meow Division's economy in one readable file: the items (their ids are the
// NEP-245 token ids, fixed forever), what containers and bosses drop on each map, Walt's prices and the reasons
// he gives, kit recipes, building levels, the backpack and the safe. The game, its server (the run replay and
// Walt's market) and the contract set-up script all read this file; no other file holds an economy number.
// It is a rules file (the server replays loot rolls with it): arrays only, Math limited to round/floor/min/max.
(function (root) {
  const E = {};

  // ---------- items ----------
  // id: the token id on chain, never renamed (the name a player sees is item.<id> in the language packs).
  // kind: material (found, sold, crafted with), trophy (one per boss kill), kit (crafted, taken into a run, used up).
  // rarity: 1 common, 2 uncommon, 3 rare, 4 trophy (the colour of its frame).
  // base: what Walt pays, in coins, when he holds `norm` of it. With an empty shelf he pays twice that; with three
  // times `norm` on the shelf, half. Kits have no price: Walt does not trade them.
  E.ITEMS = [
    { id: 'gears', kind: 'material', rarity: 1, base: 12, norm: 40 },
    { id: 'tape', kind: 'material', rarity: 1, base: 10, norm: 40 },
    { id: 'fuel', kind: 'material', rarity: 1, base: 14, norm: 30 },
    { id: 'cans', kind: 'material', rarity: 1, base: 8, norm: 50 },
    { id: 'bandages', kind: 'material', rarity: 1, base: 10, norm: 40 },
    { id: 'bulbs', kind: 'material', rarity: 1, base: 12, norm: 40 },
    { id: 'tools', kind: 'material', rarity: 2, base: 35, norm: 20 },
    { id: 'catfood', kind: 'material', rarity: 2, base: 30, norm: 20 },
    { id: 'antiseptic', kind: 'material', rarity: 2, base: 32, norm: 20 },
    { id: 'chips', kind: 'material', rarity: 2, base: 40, norm: 20 },
    { id: 'gpu', kind: 'material', rarity: 3, base: 150, norm: 8 },
    { id: 'vaccine', kind: 'material', rarity: 3, base: 120, norm: 8 },
    { id: 'usb', kind: 'material', rarity: 3, base: 110, norm: 8 },
    // building materials: what the base and the kits are made of (stash racks, range stands, generator wiring, gun
    // parts, the backpack and the vest)
    { id: 'nuts', kind: 'material', rarity: 1, base: 8, norm: 50 },
    { id: 'screws', kind: 'material', rarity: 1, base: 8, norm: 50 },
    { id: 'planks', kind: 'material', rarity: 1, base: 10, norm: 40 },
    { id: 'scrap', kind: 'material', rarity: 1, base: 9, norm: 50 },
    { id: 'wires', kind: 'material', rarity: 1, base: 12, norm: 40 },
    { id: 'springs', kind: 'material', rarity: 2, base: 28, norm: 20 },
    { id: 'battery', kind: 'material', rarity: 2, base: 40, norm: 15 },
    { id: 'fabric', kind: 'material', rarity: 1, base: 9, norm: 50 },
    { id: 't_butcher', kind: 'trophy', rarity: 4, base: 60, norm: 4, boss: 'butcher' }, // the cleaver: the first sale buys the workbench
    { id: 't_pustule', kind: 'trophy', rarity: 4, base: 80, norm: 4, boss: 'pustule' },
    { id: 't_screamer', kind: 'trophy', rarity: 4, base: 110, norm: 4, boss: 'screamer' },
    { id: 't_tank', kind: 'trophy', rarity: 4, base: 150, norm: 3, boss: 'tank' },
    { id: 't_shroom', kind: 'trophy', rarity: 4, base: 140, norm: 3, boss: 'golem' }, // the Mushroom boss: also opens the range
    { id: 'k_medkit', kind: 'kit', rarity: 2, base: 0, norm: 0 },
    { id: 'k_grenades', kind: 'kit', rarity: 2, base: 0, norm: 0 },
    { id: 'k_magnet', kind: 'kit', rarity: 2, base: 0, norm: 0 },
    { id: 'k_vest', kind: 'kit', rarity: 3, base: 0, norm: 0 },
    { id: 'k_vaccine', kind: 'kit', rarity: 3, base: 0, norm: 0 },
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

  // ---------- Walt's market ----------
  E.SELL_MARKUP = 1.4; // Walt sells for 1.4 × what he would pay for the same item at the same stock
  E.DECAY_PER_DAY = 0.05; // every day Walt's stock of each item shrinks by 5 % (rounded down): he uses it up
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
  // lockedBy: a trophy the player must have brought home once (shown, not spent). Workbench level 1 (planks and
  // screws: the table itself) is paid for by selling the Butcher's cleaver, and its items come with mission 1.
  // <buildings>
  E.BUILDINGS = [
    {
      id: 'generator',
      levels: [
        {
          coins: 300,
          items: [
            ['fuel', 4],
            ['wires', 3],
            ['gears', 2],
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
        { coins: 250, items: [], power: 0, opens: 'craft1' },
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
          coins: 200,
          items: [
            ['planks', 3],
            ['fabric', 2],
            ['bandages', 2],
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

  // upgrades: the items each level costs on top of its coins (the coins: D.META[id].price for the account's upgrades,
  // D.WEAPON_UP[id].price for a gun's, in live/data.js). meta.<id>[n - 1] and weapon.<id>[n - 1]: level n. Not charged
  // in the game yet: they are paid once the base keeps the player's items.
  // <upgrades>
  E.UPGRADES = {
    meta: {
      hp: [
        [],
        [['fabric', 2]],
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
        [['scrap', 3]],
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
        [['tape', 2]],
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
        [['wires', 2]],
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
        [
          ['usb', 1],
          ['wires', 2],
        ],
        [
          ['usb', 1],
          ['chips', 2],
        ],
      ],
      start: [
        [],
        [
          ['planks', 4],
          ['nuts', 4],
        ],
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
        [['scrap', 2]],
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
        [['tape', 2]],
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
      reward: {
        coins: 150,
        xp: 300,
        items: [['t_butcher', 1]],
      },
    },
    {
      id: 'suburb',
      n: '1-2',
      map: 'suburb',
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
        items: [
          ['antiseptic', 2],
          ['vaccine', 1],
        ],
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
    const s = Math.max(0, Math.floor(stock || 0));
    return Math.max(E.MIN_PRICE, Math.round((it.base * 2 * it.norm) / (it.norm + s)));
  };
  // what Walt asks for one `id` while he holds `stock` of it (0: he has none to sell)
  E.sellPrice = (id, stock) =>
    stock > 0 ? Math.max(E.MIN_PRICE, Math.round(E.buyPrice(id, stock) * E.SELL_MARKUP)) : 0;
  // the stock after one day of decay
  E.decay = (stock) => Math.max(0, stock - Math.floor(stock * E.DECAY_PER_DAY));
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
