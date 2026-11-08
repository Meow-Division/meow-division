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
    { id: 't_butcher', kind: 'trophy', rarity: 4, base: 160, norm: 4, boss: 'butcher' }, // the cleaver: the first sale buys the workbench
    { id: 't_pustule', kind: 'trophy', rarity: 4, base: 200, norm: 4, boss: 'pustule' },
    { id: 't_screamer', kind: 'trophy', rarity: 4, base: 220, norm: 4, boss: 'screamer' },
    { id: 't_tank', kind: 'trophy', rarity: 4, base: 320, norm: 3, boss: 'tank' },
    { id: 't_shroom', kind: 'trophy', rarity: 4, base: 300, norm: 3, boss: 'golem' }, // the Mushroom boss: also opens the range
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

  // ---------- loot: what a container gives, per map ----------
  // Each container rolls `rolls` times on its map's table. An entry is [token id, weight, least, most]: the chance
  // of an entry is its weight over the table's total; the amount is least..most, evenly.
  E.LOOT = [
    {
      map: 'office', // mission 1: the NEAR AI office (parking lot, then inside)
      rolls: 1,
      table: [
        ['bulbs', 6, 1, 2],
        ['bandages', 4, 1, 2],
        ['chips', 3, 1, 1],
        ['usb', 1, 1, 1],
        ['gpu', 1, 1, 1],
      ],
    },
    {
      map: 'suburb', // mission 2 and the suburb raids
      rolls: 2,
      table: [
        ['gears', 6, 1, 3],
        ['tape', 6, 1, 2],
        ['cans', 6, 1, 3],
        ['fuel', 5, 1, 2],
        ['bandages', 4, 1, 2],
        ['tools', 2, 1, 1],
        ['catfood', 2, 1, 1],
      ],
    },
    {
      map: 'lab', // the laboratory
      rolls: 2,
      table: [
        ['bandages', 5, 1, 2],
        ['bulbs', 4, 1, 2],
        ['antiseptic', 3, 1, 1],
        ['chips', 2, 1, 1],
        ['vaccine', 1, 1, 1],
        ['usb', 1, 1, 1],
      ],
    },
  ];

  // ---------- Walt's market ----------
  E.SELL_MARKUP = 1.4; // Walt sells for 1.4 × what he would pay for the same item at the same stock
  E.DECAY_PER_DAY = 0.05; // every day Walt's stock of each item shrinks by 5 % (rounded down): he uses it up
  E.MIN_PRICE = 1; // no price falls below one coin

  // ---------- kit recipes (crafted at a building of the given level; mirrored on chain by the contract) ----------
  E.RECIPES = [
    {
      id: 'medkit',
      at: 'medbay',
      level: 1,
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
      inputs: [
        ['fuel', 2],
        ['tape', 1],
        ['gears', 1],
      ],
      output: ['k_grenades', 1],
    },
    {
      id: 'magnet',
      at: 'workbench',
      level: 2,
      inputs: [
        ['gears', 3],
        ['chips', 1],
      ],
      output: ['k_magnet', 1],
    },
    {
      id: 'vest',
      at: 'workbench',
      level: 2,
      inputs: [
        ['tape', 3],
        ['tools', 1],
      ],
      output: ['k_vest', 1],
    },
    {
      id: 'vaccine',
      at: 'medbay',
      level: 3,
      inputs: [
        ['vaccine', 1],
        ['antiseptic', 1],
      ],
      output: ['k_vaccine', 1],
    },
  ];

  // ---------- the base: buildings and their levels ----------
  // levels[n - 1] is what level n costs: coins (kept by the server) and items (spent from the wallet).
  // power: the generator level a building's level needs (level 2 needs generator 1, level 3 needs generator 2).
  // opens: what the player gets at that level. lockedBy: a trophy the player must have brought home once.
  E.BUILDINGS = [
    {
      id: 'generator',
      levels: [
        {
          coins: 150,
          items: [
            ['fuel', 3],
            ['gears', 2],
          ],
          power: 0,
          opens: 'power1',
        },
        {
          coins: 600,
          items: [
            ['fuel', 6],
            ['chips', 2],
            ['gpu', 1],
          ],
          power: 0,
          opens: 'power2',
        },
      ],
    },
    {
      id: 'stash',
      levels: [
        { coins: 100, items: [['tape', 2]], power: 0, opens: 'safe1' },
        {
          coins: 500,
          items: [
            ['tools', 1],
            ['gears', 4],
          ],
          power: 1,
          opens: 'safe2',
        },
        {
          coins: 1200,
          items: [
            ['tools', 2],
            ['catfood', 2],
          ],
          power: 2,
          opens: 'bag10',
        },
      ],
    },
    {
      id: 'workbench',
      levels: [
        { coins: 250, items: [['bulbs', 2]], power: 0, opens: 'craft1' }, // affordable right after selling the cleaver
        {
          coins: 700,
          items: [
            ['tools', 2],
            ['gears', 6],
          ],
          power: 1,
          opens: 'craft2',
        },
        {
          coins: 1500,
          items: [
            ['chips', 3],
            ['gpu', 1],
          ],
          power: 2,
          opens: 'craft3',
        },
      ],
    },
    {
      id: 'medbay',
      levels: [
        { coins: 200, items: [['bandages', 4]], power: 0, opens: 'craft1' },
        {
          coins: 600,
          items: [
            ['antiseptic', 3],
            ['catfood', 2],
          ],
          power: 1,
          opens: 'craft2',
        },
        {
          coins: 1400,
          items: [
            ['vaccine', 1],
            ['chips', 2],
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
            ['t_shroom', 1],
            ['gears', 4],
            ['bulbs', 2],
          ],
          power: 0,
          opens: 'range1',
        },
        {
          coins: 900,
          items: [
            ['tools', 3],
            ['chips', 2],
          ],
          power: 1,
          opens: 'range2',
        },
      ],
    },
  ];

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

  // ---------- lookups and prices (pure functions of the numbers above) ----------
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
