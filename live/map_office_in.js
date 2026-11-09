// live/map_office_in.js — the NEAR AI office's inside, mission 1's second map: its door (live/missions.js office,
// action 'map') leads in here and nothing leads back. Edited in the map editor (?editor&map=office_in) and written by its
// server (server/mapfile.mjs); sim.js level() builds it for SIM.OFFICE_IN. Laid out as live/map_office.js is.
(function (root) {
  const M = {
    v: 1,
    spawn: [2400,2780],
    backs: [

    ],
    roads: [

    ],
    areas: [
      [1900,1900,2900,2900,"floor"],
    ],
    props: [

    ],
    trees: [

    ],
    bushes: [

    ],
    decor: [

    ],
    marks: [
      ["inside",2400,2780],
    ],
    void: [
      [0,0,4800,1900],
      [0,2900,4800,4800],
      [0,1900,1900,2900],
      [2900,1900,4800,2900],
    ],
    gates: [

    ],
    zones: [

    ],
  };
  root.MAP_OFFICE_IN = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
