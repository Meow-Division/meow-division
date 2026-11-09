// live/map_office.js — the NEAR AI office, mission 1's map (live/missions.js office), edited in the map editor
// (map-editor.bat, its office button, or /live/index.html?editor&map=office; its first draft came from gen/officemap.mjs)
// and written by its server (server/mapfile.mjs). sim.js level() builds it for SIM.OFFICE. Laid out as the town is
// (live/map.js: spawn, roads, areas, props, trees, bushes, decor, marks); void [x0, y0, x1, y1]: solid, never drawn (the
// land round the play area); gates [x0, y0, x1, y1, name]: walls of nothing until the mission's script opens them;
// zones [x0, y0, x1, y1]: yellow dashed rectangles painted on the floor. The office building is a roof prop: it stops
// nothing and hides while a hero is under it.
(function (root) {
  const M = {
    v: 1,
    spawn: [2400,4420],
    roads: [
      [2280,2400,2520,4560,70],
      [1950,3180,2850,3420,70],
      [1850,1250,3300,1950,0],
    ],
    areas: [
      [2310,1950,2490,2400,"plaza"],
    ],
    props: [
      ["iso_cwall",2000,3825,1],
      ["iso_cwall",2000,4075,1],
      ["iso_cwall",2000,4325,1],
      ["iso_rail",2715,3710,1],
      ["iso_rail",2715,3930,1],
      ["iso_rail",2715,4150,1],
      ["iso_rail",2715,4370,1],
      ["iso_barrier2",2230,3700,0],
      ["iso_barrier3",2580,3620,0],
      ["iso_mesh",2095,3065,0],
      ["iso_mesh",2705,3065,0],
      ["iso_mesh",2165,2555,1],
      ["iso_mesh",2165,2825,1],
      ["iso_mesh",2635,2555,1],
      ["iso_mesh",2635,2825,1],
      ["iso_barrier2",2240,2620,0],
      ["iso_block",2295,2025,1],
      ["iso_block",2295,2175,1],
      ["iso_block",2295,2325,1],
      ["iso_block",2505,2025,1],
      ["iso_block",2505,2175,1],
      ["iso_block",2505,2325,1],
      ["iso_barrier2",2700,1890,1],
      ["iso_barrier3",2060,1900,1],
      ["iso_cwall",1840,1425,1],
      ["iso_cwall",1840,1675,1],
      ["iso_mesh",3290,1435,1],
      ["iso_mesh",3290,1705,1],
      ["iso_cwall",2075,1250,0],
      ["iso_cwall",2325,1250,0],
      ["iso_cwall",2825,1250,0],
      ["iso_cwall",3075,1250,0],
      ["iso_cwall",2075,300,0],
      ["iso_cwall",2325,300,0],
      ["iso_cwall",2575,300,0],
      ["iso_cwall",2825,300,0],
      ["iso_cwall",3075,300,0],
      ["iso_cwall",1950,425,1],
      ["iso_cwall",1950,675,1],
      ["iso_cwall",1950,925,1],
      ["iso_cwall",1950,1175,1],
      ["iso_cwall",3200,425,1],
      ["iso_cwall",3200,675,1],
      ["iso_cwall",3200,925,1],
      ["iso_cwall",3200,1175,1],
    ],
    trees: [

    ],
    bushes: [

    ],
    decor: [
      ["manhole",2400,3700],
      ["line",3150,1330,260,0,0],
      ["line",3150,1470,260,0,0],
      ["line",3150,1610,260,0,0],
      ["line",3150,1750,260,0,0],
      ["line",3150,1890,260,0,0],
      ["line",2000,1360,260,0,0],
      ["line",2000,1500,260,0,0],
      ["line",2000,1640,260,0,0],
      ["line",2000,1780,260,0,0],
      ["hatch",2575,1330,250,120],
    ],
    marks: [
      ["start",2400,4420],
      ["crate",2210,3960],
      ["line_a",2020,3880],
      ["line_b",2700,3880],
      ["horde",2400,3270],
      ["parking",2400,2330],
      ["bomb",2400,1985],
      ["guards",2550,1480],
      ["drop",2800,1580],
      ["inside",2575,1050],
    ],
    void: [
      [0,0,4800,300],
      [0,300,1950,1250],
      [3200,300,4800,1250],
      [0,1250,1850,1950],
      [3300,1250,4800,1950],
      [0,1950,2310,2400],
      [2490,1950,4800,2400],
      [0,2400,2150,3050],
      [2650,2400,4800,3050],
      [0,3050,1950,3480],
      [2850,3050,4800,3480],
      [0,3480,2020,4560],
      [2700,3480,4800,4560],
      [0,4560,4800,4800],
    ],
    gates: [
      [2150,2980,2650,3020,"checkpoint"],
      [2450,1232,2700,1268,"door"],
    ],
    zones: [

    ],
  };
  root.MAP_OFFICE = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
