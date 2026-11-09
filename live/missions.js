// live/missions.js — the campaign's task scripts (docs/design.md, "Player path"): for each mission an ordered list
// of tasks the sim plays one after another (sim.js mission) with the goal line and the arrow the HUD shows. Rules
// data, shared with the server, which plays a mission run again from its inputs: a change here changes how a run
// plays (SIM.REV).
//
// A task: k, its kind — 'reach' (the hero within r of the place at, the sim's ground metric), 'take' (the pickup
// named n, laid by an action), 'kill' (every one of the group named g; arrow: a pickup the arrow points at while it
// lies, the one to use on them), 'hold' (t seconds), 'perk' (the script's card screen dealt and a card taken); goal: the
// language key of its line; go: the actions when it begins; end: the actions once it is done; lv: 0, the hero's levels
// held back while it runs (the crystals fill the bar to just short of the next level). The last task done wins the
// run. An action: a, its kind —
//   { a: 'director', on }            the zombies' usual stream, hordes and drops held back (0) or let go (1)
//   { a: 'voice', id }               a voice line ('nova.3', docs/voice.md): subtitles and recording (live/voice.js)
//   { a: 'drop', n, at, give }       a supply crate down by parachute: give.items (item ids, each new or a level
//                                    up), give.main (levels on the main gun at once)
//   { a: 'place', k, n, at | near }  a pickup lying still: 'bomb', 'magnet', 'medkit' (near: a free spot that far
//                                    from the hero)
//   { a: 'group', g, at, of, post }  a named group: of [[kind, how many, elite], …]; post: they stand until the hero
//                                    is that near
//   { a: 'boss', k, g }              a boss comes as a run's does (sim.js spawnBoss), as the group g
//   { a: 'hint', id, item }          the HUD points something out for a few seconds (scene.js): 'perkbar' the perk
//                                    bar, 'pair' the item and its partner in it (D.EVOS) and what they make together
//   { a: 'level' }                   the XP bar topped up to the next level (its cards come at once)
//   { a: 'hurt', share, floor }      quietly (no number, no flash) share of the max health off, never below floor
// deal: the mission's own card screens, one for each level up in order until they run out (then the usual cards):
// cards [[kind, item id, locked], …] (a locked card is shown and can't be taken; no reroll on such a screen), voice: the
// line with it.
// at: a place by name: the mark of that name on the mission's map (marks [name, gx, gy] in its map file, set with the
// map editor's marks tool; SIM.marksOf lists the ones a script names). start: where the hero begins.
// classic: 1 — the run begins and goes on as a classic run does (a start of the map's own, the zombies, the bosses and
// the lab's gas on their schedule); each scheduled boss joins as the group named after its kind ('golem': the final
// boss), so a task can ask for its death. Missions 2 and 3 are that for now (containers, the backpack and the evac
// come later).
(function (root) {
  const M = {
    // mission 1 plays on the suburb map until the office has a map of its own (its marks: the crossroads east of the
    // middle, the plaza by it as the parking lot, the warehouse west of the middle plaza as the office, the road east
    // where the horde comes from)
    office: {
      // the first level up: three attack skills shown, only the drone to take (Nova helps from afar through it); the
      // caliber is the pistol's ammo
      deal: [
        {
          cards: [
            ['new', 'drone'],
            ['new', 'chain', 1],
            ['new', 'caliber', 1],
          ],
          voice: 'nova.5',
        },
      ],
      // part A holds the levels back but for that one: the crate, the horde and the magnet fill the bar, the guards'
      // crystals never finish a level; the waves of part B level as a run does
      tasks: [
        {
          k: 'take',
          n: 'crate',
          goal: 'task.crate',
          lv: 0,
          // (Nova's first order, nova.1, is the intro's: live/intro.js plays it before this run)
          go: [
            { a: 'director', on: 0 },
            { a: 'drop', n: 'crate', at: 'crate', give: { items: ['armor', 'medkit'], main: 3 } },
          ],
          end: [
            { a: 'voice', id: 'nova.2' },
            { a: 'hint', id: 'perkbar' },
          ],
        },
        {
          k: 'hold',
          t: 40,
          goal: 'task.horde',
          lv: 0,
          go: [
            { a: 'voice', id: 'nova.3' },
            {
              a: 'group',
              g: 'horde',
              at: 'horde',
              of: [
                ['walker', 16],
                ['runner', 4],
                ['armored', 1, 1],
              ],
            },
          ],
        },
        {
          k: 'take',
          n: 'magnet',
          goal: 'task.magnet',
          lv: 0,
          go: [
            { a: 'place', k: 'magnet', n: 'magnet', near: 260 },
            { a: 'voice', id: 'nova.4' },
          ],
        },
        // the bar full from the horde's crystals: the level up and its screen (deal), Nova's nova.5 with it
        { k: 'perk', goal: 'task.perk', go: [{ a: 'level' }] },
        {
          k: 'reach',
          at: 'gate',
          r: 260,
          goal: 'task.entrance',
          lv: 0,
          go: [{ a: 'director', on: 1 }],
          end: [
            { a: 'director', on: 0 },
            {
              a: 'group',
              g: 'guards',
              at: 'guards',
              post: 330,
              of: [
                ['walker', 2, 1],
                ['walker', 3],
              ],
            },
            { a: 'place', k: 'bomb', n: 'bomb', at: 'bomb' },
            { a: 'voice', id: 'nova.6' },
          ],
        },
        {
          k: 'kill',
          g: 'guards',
          arrow: 'bomb',
          goal: 'task.guards',
          lv: 0,
          end: [
            // the blast's share, quietly: the medkit that comes next always heals
            { a: 'hurt', share: 0.25, floor: 0.1 },
            { a: 'voice', id: 'nova.7' },
            { a: 'place', k: 'medkit', n: 'medkit', near: 200 },
          ],
        },
        {
          k: 'take',
          n: 'medkit',
          goal: 'task.medkit',
          lv: 0,
          end: [
            { a: 'drop', n: 'supply', near: 240, give: { items: ['clover'] } },
            { a: 'voice', id: 'nova.8' },
          ],
        },
        // Nova's drop: the clover alone, nothing to choose; the perk bar shows it with the drone and the super drone
        // they make
        {
          k: 'take',
          n: 'supply',
          goal: 'task.supply',
          lv: 0,
          end: [
            { a: 'hint', id: 'pair', item: 'drone' },
            { a: 'voice', id: 'nova.9' },
          ],
        },
        {
          k: 'hold',
          t: 180,
          goal: 'task.hold',
          go: [
            { a: 'director', on: 1 },
            { a: 'voice', id: 'nova.10' },
          ],
          end: [{ a: 'voice', id: 'nova.11' }],
        },
        {
          k: 'kill',
          g: 'butcher',
          goal: 'task.butcher',
          go: [{ a: 'boss', k: 'butcher', g: 'butcher' }],
          end: [{ a: 'voice', id: 'nova.12' }],
        },
      ],
    },
    // mission 2: the suburbs' Shroom Hulk (the final boss, 'golem'); its spores infect Copper (nova.16)
    suburb: {
      classic: 1,
      tasks: [
        {
          k: 'kill',
          g: 'golem',
          goal: 'task.hulk',
          go: [{ a: 'voice', id: 'nova.14' }],
          end: [{ a: 'voice', id: 'nova.16' }],
        },
      ],
    },
    // mission 3: the laboratory, to its final boss in the hall (the antivirus to find comes later)
    lab: {
      classic: 1,
      tasks: [{ k: 'kill', g: 'golem', goal: 'task.labBoss', go: [{ a: 'voice', id: 'nova.17' }] }],
    },
  };

  root.MISSIONS = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
