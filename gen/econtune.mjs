// gen/econtune.mjs — the economy as tuned with the bots (gen/econsim.mjs, the economy page's Progress tab), written
// into live/economy.js and live/data.js by gen/econdraft.mjs. The human's rules (2026-11-09): the NEAR AI office
// (mission 1) drops only the Butcher's cleaver; raids are the suburbs and the laboratory, where nearly every material
// drops at different chances (the vaccine sample only in the lab, trophies only from bosses, microchips, flash drives
// and graphics cards rarely); a raid brings little home, so building up is a grind, but the start is easy: level 1 of
// every upgrade costs coins only, later levels add what the thing is made of. Each material's total need over every
// building, every hero upgrade and three guns' upgrades is matched to its drop rate, so none of them alone holds a
// player back for hundreds of raids, while the commons come in surplus for kits and for selling to Walt.
const L = (id, w, lo = 1, hi = 1) => [id, w, lo, hi];

export default function tune(t) {
  // ---------- loot: one roll per container, small amounts ----------
  t.loot = [
    {
      map: 'suburb', // houses, garages, cars: building stuff, food, fuel
      rolls: 1,
      boxes: 8,
      table: [
        L('scrap', 20, 1, 2),
        L('planks', 16, 1, 2),
        L('nuts', 16, 1, 2),
        L('screws', 14, 1, 2),
        L('fabric', 14, 1, 2),
        L('cans', 12, 1, 2),
        L('tape', 12),
        L('gears', 12),
        L('fuel', 12),
        L('springs', 12),
        L('tools', 9),
        L('bandages', 8),
        L('wires', 8),
        L('bulbs', 6),
        L('catfood', 6),
        L('battery', 4),
        L('antiseptic', 3),
        L('chips', 3),
        L('usb', 1),
        L('gpu', 1),
      ],
    },
    {
      map: 'lab', // wards, offices, server rooms: medicine, electronics
      rolls: 1,
      boxes: 8,
      table: [
        L('bandages', 16, 1, 2),
        L('wires', 14, 1, 2),
        L('scrap', 12, 1, 2),
        L('antiseptic', 12),
        L('bulbs', 10),
        L('springs', 9),
        L('chips', 8),
        L('fabric', 8),
        L('tools', 7),
        L('screws', 6),
        L('nuts', 6),
        L('battery', 6),
        L('gears', 5),
        L('tape', 5),
        L('fuel', 4),
        L('planks', 3),
        L('cans', 3),
        L('catfood', 3),
        L('usb', 3),
        L('vaccine', 3),
        L('gpu', 2),
      ],
    },
  ];

  // ---------- buildings (level 1 of the workbench: a repair paid in coins, the cleaver's sale) ----------
  const B = Object.fromEntries(t.buildings.map((b) => [b.id, b.levels]));
  const set = (b, n, coins, items) => Object.assign(B[b][n - 1], { coins, items });
  set('workbench', 1, 250, []);
  set('workbench', 2, 700, [
    ['tools', 2],
    ['gears', 3],
    ['scrap', 3],
  ]);
  set('workbench', 3, 1500, [
    ['springs', 3],
    ['tools', 2],
    ['chips', 2],
  ]);
  set('generator', 1, 300, [
    ['fuel', 4],
    ['wires', 3],
    ['gears', 2],
  ]);
  set('generator', 2, 900, [
    ['fuel', 6],
    ['battery', 2],
    ['chips', 1],
  ]);
  set('stash', 1, 150, [
    ['planks', 4],
    ['screws', 3],
  ]);
  set('stash', 2, 600, [
    ['scrap', 5],
    ['nuts', 4],
    ['tools', 1],
  ]);
  set('stash', 3, 1300, [
    ['fabric', 6],
    ['tape', 3],
    ['springs', 1],
  ]);
  set('medbay', 1, 200, [
    ['planks', 3],
    ['fabric', 2],
    ['bandages', 2],
  ]);
  set('medbay', 2, 700, [
    ['antiseptic', 3],
    ['bulbs', 3],
    ['wires', 2],
  ]);
  set('medbay', 3, 1500, [
    ['vaccine', 1],
    ['chips', 2],
    ['battery', 1],
  ]);
  set('range', 1, 300, [
    ['planks', 4],
    ['screws', 3],
    ['scrap', 2],
  ]);
  set('range', 2, 1000, [
    ['springs', 2],
    ['bulbs', 3],
    ['battery', 1],
  ]);

  // ---------- the hero's upgrades: level 1 coins only, then what the thing is made of ----------
  t.upgrades.meta = {
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
  };
  // ---------- a gun's upgrades (each gun its own): damage = metal, rate = springs and tools, magazine = springs, tape ----------
  t.upgrades.weapon = {
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
  };

  // ---------- trophies: a boss falls in most raids, so a trophy is a bonus, not the income ----------
  return {
    swaps: [
      [
        `{ id: 't_butcher', kind: 'trophy', rarity: 4, base: 160,`,
        `{ id: 't_butcher', kind: 'trophy', rarity: 4, base: 60,`,
      ],
      [
        `{ id: 't_pustule', kind: 'trophy', rarity: 4, base: 200,`,
        `{ id: 't_pustule', kind: 'trophy', rarity: 4, base: 80,`,
      ],
      [
        `{ id: 't_screamer', kind: 'trophy', rarity: 4, base: 220,`,
        `{ id: 't_screamer', kind: 'trophy', rarity: 4, base: 110,`,
      ],
      [
        `{ id: 't_tank', kind: 'trophy', rarity: 4, base: 320,`,
        `{ id: 't_tank', kind: 'trophy', rarity: 4, base: 150,`,
      ],
      [
        `{ id: 't_shroom', kind: 'trophy', rarity: 4, base: 300,`,
        `{ id: 't_shroom', kind: 'trophy', rarity: 4, base: 140,`,
      ],
    ],
  };
}
