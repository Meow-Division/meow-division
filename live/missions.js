// live/missions.js — the campaign's task scripts (docs/design.md, "Player path"): for each mission an ordered list
// of tasks the sim plays one after another (sim.js mission) with the goal line and the arrow the HUD shows. Rules
// data, shared with the server, which plays a mission run again from its inputs: a change here changes how a run
// plays (SIM.REV).
//
// A task: k, its kind — 'reach' (the hero within r of the place at, the sim's ground metric), 'cross' (the hero
// past the line from mark a to mark b: on its other side from where the task began), 'take' (the pickup named n,
// laid by an action or dropped by a group's zombie), 'kill' (every one of the group named g; arrow: a pickup the arrow
// points at while it lies, the one to use on them), 'hold' (t seconds), 'perk' (the script's card screen dealt and a
// card taken), 'talk' (its go's voice lines said to the end on the page — the heroes stand still meanwhile; the page
// tells the sim with SIM.PICK.talk; dim: the screen a little darker meanwhile, keys: how to walk shown; move: the heroes
// not held, free to walk and shoot while she talks), 'pull' (every
// crystal and coin the magnet pulls in), 'stir' (the hero walks or shoots); a take of a crate is done once its screen
// is closed. cross and reach: to, the mark its arrow points at (else the line's middle, the place); reach: ring, a
// glowing ring on the spot; woke: done as well once one of that group has noticed the hero. id: a task's name (skip).
// goal: the language key of its
// line; go: the actions when it begins; end: the actions once it is done; lv: 0, the hero's levels held back while it
// runs (the crystals fill the bar to just short of the next level). The last task done wins the run. An action: a, its
// kind (got / not: only if the pickup of that name was / wasn't taken) —
//   { a: 'director', on }            the zombies' usual stream, hordes and drops held back (0), let go (1) or a share
//                                    of them (0 … 1)
//   { a: 'voice', id }               a voice line ('nova.3', docs/voice.md): subtitles and recording (live/voice.js)
//   { a: 'bar', m: [a, b] }          a closed line from mark a to mark b: the heroes can't cross it ('unbar' opens it)
//   { a: 'drop', n, at, give, voice }  a supply crate down by parachute (ground: 1, lying there already): give.items
//                                    (item ids, each new or a level up), give.main (levels on the main gun at once);
//                                    voice: Nova's line (or lines) as it is opened (its take waits until she is done)
//   { a: 'place', k, n, at | near }  a pickup lying still: 'bomb', 'magnet', 'medkit' (near: a free spot that far
//                                    from the hero)
//   { a: 'group', g, at, mid, spread, of, post, roam, last, bare }  a named group: of [[kind, how many, elite, drop],
//                                    …] (drop: the first of that kind leaves that pickup, named so, where it dies); mid:
//                                    the map lacking the mark at, they stand in its middle; spread {near, gap}: each
//                                    on a spot of its own over the map where the hero can walk to (none nearer him
//                                    than near, gap apart, a third in his sight: sim.js spreadSpots); last: the pickup the last
//                                    of them to die leaves; post: they stand until the hero is that near, one of them
//                                    is hurt or a wake action (meanwhile no gun aims at them by itself); roam: they
//                                    wander that far round their spot meanwhile; bare: they leave nothing else (no
//                                    crystals, coins or pickups)
//   { a: 'wake', g }                 the group g leaves its posts and hunts
//   { a: 'open', g }                 the map's gate g (a wall of nothing in its map file: gates) opens for good
//   { a: 'boss', k, g }              a boss comes as a run's does (sim.js spawnBoss), as the group g
//   { a: 'loot', it, n, nm }         a thing for the backpack (item it, n of it) laid where the last boss fell (else at
//                                    the hero), named nm: a 'take' task of that name is done once a hero takes it
//   { a: 'hint', id, item }          the HUD points something out for a few seconds (scene.js): 'perkbar' the perk
//                                    bar, 'pair' the item and its partner in it (D.EVOS) and what they make together
//   { a: 'level' }                   the XP bar topped up to the next level (its cards come at once)
//   { a: 'hurt', share, floor, full }  quietly (no number, no flash) share of the max health off, never below floor
//                                    (full: only when the health is full)
// deal: the mission's own card screens, one for each level up in order until they run out (then the usual cards):
// cards [[kind, item id, locked], …] (a locked card can't be taken: the screen shows every card alike and makes the one
// to take blink; no reroll on such a screen), voice: the line with it (the cards wait until it is said).
// skip: the tutorial's skip (the HUD's button, SIM.PICK.skip) from the task named from until the one named to: give
// (item ids), main (the main gun's level at least), lvl (the level the skipped part ends at), deal (its card screens counted as dealt), open (its gates),
// map and at (where it leads).
// at, a, b: places by name: the mark of that name on the mission's map (marks [name, gx, gy] in its map file, set with
// the map editor's marks tool; SIM.marksOf lists the ones a script names). start: where the hero begins.
// soft: { map, hp, dmg } — on that map the zombies' health and bite × (its bosses as they are: sim.js addEnemy).
// classic: 1 — the run begins and goes on as a classic run does (a start of the map's own, the zombies, the bosses and
// the lab's gas on their schedule); each scheduled boss joins as the group named after its kind ('golem', 'heart': the final
// boss), so a task can ask for its death. Missions 2 and 3 are that for now (containers, the backpack and the evac
// come later).
(function (root) {
  const M = {
    // mission 1 on the NEAR AI office's two maps (the human's script, 2026-11-09): outside (live/map_office.js) the road
    // to the checkpoint, the parking lot, the office's door; its door leads inside (live/map_office_in.js), no way back.
    // The horde stands at the checkpoint and the guards wander the parking lot from the start; a closed line in front
    // of the start until the crate is taken, gate 'checkpoint' holds the hero on the road until the drone is taken,
    // gate 'door' keeps the office shut until Nova's drop is taken. Nova talks over the radio, Copper answers her
    // (docs/voice.md)
    office: {
      map: 'office', // (its marks' map until its door's 'map' action: SIM.marksOf)
      noEvac: 1, // (no evac before its win: the tutorial's way is through the office)
      soft: { map: 'office_in', hp: 0.75, dmg: 0.75 }, // (REV 38: inside, the zombies 25 % frailer and softer — a first try should win)
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
      // the tutorial skipped from Nova's first words on (the HUD's button; REV 39, was: once the crate is taken): what the
      // outside would have given — the crate's armour, medkit and gun levels, the drone and the clover, the level it ends
      // at — and straight inside (at the inside map's spawn)
      skip: {
        from: 'start',
        to: 'inside',
        give: ['armor', 'medkit', 'drone', 'clover'],
        main: 3,
        lvl: 2,
        deal: 1,
        open: ['checkpoint', 'door'],
        map: 'office_in',
      },
      // part A holds the levels back but for that one: the crate, the horde and the magnet fill the bar, the guards
      // leave nothing but the medkit; the waves inside level as a run does
      tasks: [
        // the hero comes in: Nova's order, the hero free to walk at once (REV 39: no shade, not held), how to walk shown;
        // Copper answers as she ends. A closed line in front of him until he has the crate (Nova's first order, nova.1, is
        // the intro's: live/intro.js plays it before this run)
        {
          id: 'start',
          k: 'talk',
          goal: 'task.crate',
          lv: 0,
          move: 1,
          keys: 1,
          go: [
            { a: 'director', on: 0 },
            { a: 'bar', m: ['line_a', 'line_b'] },
            {
              a: 'drop',
              n: 'crate',
              at: 'crate',
              ground: 1,
              give: { items: ['armor', 'medkit'], main: 3 },
              voice: 'nova.24', // (what skills are: what is in it shows on its cards)
            },
            {
              a: 'group',
              g: 'horde',
              at: 'horde',
              post: 1,
              of: [
                ['walker', 16],
                ['runner', 4],
                ['armored', 1, 1, 'magnet'],
              ],
            },
            // the parking lot's crowd: three times the guards there were, wandering the lot until the hero is near;
            // the last of them to die leaves the medkit (one picked up in the fight would leave Nova's line about it
            // with nothing to pick up)
            {
              a: 'group',
              g: 'guards',
              at: 'guards',
              post: 380,
              roam: 320,
              last: 'medkit',
              bare: 1,
              of: [
                ['walker', 6, 1],
                ['walker', 9],
              ],
            },
            { a: 'voice', id: 'nova.19' },
          ],
          end: [{ a: 'voice', id: 'copper.1' }],
        },
        // the crate: Nova says what is in it while its screen is up (the screen frames its cards one by one); then the
        // line opens
        {
          k: 'take',
          n: 'crate',
          goal: 'task.crate',
          lv: 0,
          end: [{ a: 'unbar' }],
        },
        // past the line in front of the van (its arrow on to the parking lot's middle): Nova sees the zombies ahead, and
        // they come
        {
          id: 'road',
          k: 'cross',
          a: 'line_a',
          b: 'line_b',
          to: 'guards',
          goal: 'task.ahead',
          lv: 0,
          end: [
            { a: 'voice', id: 'nova.20' },
            { a: 'wake', g: 'horde' },
          ],
        },
        // no time limit: every one of them dead; the super mob leaves the magnet
        { k: 'kill', g: 'horde', goal: 'task.horde', lv: 0, end: [{ a: 'voice', id: 'nova.4' }] },
        { k: 'take', n: 'magnet', goal: 'task.magnet', lv: 0 },
        // every crystal pulled in before the cards
        { k: 'pull', goal: 'task.pull', lv: 0 },
        // the bar full from the horde's crystals: the level up and its screen (deal; nova.5 with it, the cards wait for
        // her); then the checkpoint opens and Nova sends him on
        {
          k: 'perk',
          goal: 'task.perk',
          go: [{ a: 'level' }],
          end: [
            { a: 'open', g: 'checkpoint' },
            { a: 'voice', id: 'nova.21' },
          ],
        },
        // the parking lot: its crowd seen (at its mark, or one of them has noticed him first), the bomb at the passage's
        // end; the arrow on the lot's middle
        {
          k: 'reach',
          at: 'parking',
          r: 260,
          to: 'guards',
          woke: 'guards',
          goal: 'task.parking',
          lv: 0,
          end: [
            { a: 'place', k: 'bomb', n: 'bomb', at: 'bomb' },
            { a: 'voice', id: 'nova.6' },
          ],
        },
        // the bomb or the pistol, all the same: every one dead; Nova's medkit line tells which
        {
          k: 'kill',
          g: 'guards',
          arrow: 'bomb',
          goal: 'task.guards',
          lv: 0,
          end: [
            // the blast's share, quietly, when the hero is unhurt: the medkit that comes next always heals
            { a: 'hurt', share: 0.15, floor: 0.1, full: 1 },
            { a: 'voice', id: 'nova.7', got: 'bomb' },
            { a: 'voice', id: 'nova.22', not: 'bomb' },
          ],
        },
        {
          k: 'take',
          n: 'medkit',
          goal: 'task.medkit',
          lv: 0,
          end: [
            { a: 'drop', n: 'supply', at: 'drop', give: { items: ['clover'] }, voice: 'nova.9' },
            { a: 'voice', id: 'nova.8' },
          ],
        },
        // Nova's drop: the clover alone, nothing to choose; she tells of the pairs while its screen is up; once taken
        // the perk bar shows it with the drone, and the office opens
        {
          k: 'take',
          n: 'supply',
          goal: 'task.supply',
          lv: 0,
          end: [
            { a: 'hint', id: 'pair', item: 'drone' },
            { a: 'voice', id: 'nova.10' },
            { a: 'open', g: 'door' },
          ],
        },
        // to the office's door (a glowing ring on it): through it into the office's inside, another map
        // (live/map_office_in.js), at its spawn; no way back
        {
          k: 'reach',
          at: 'door',
          r: 150,
          ring: 1,
          goal: 'task.entrance',
          lv: 0,
          end: [{ a: 'map', to: 'office_in' }],
        },
        // inside: a crowd spread over the building wanders it (a third of it in sight); Copper sees Walt, the hero
        // standing still while he speaks; Nova answers as he is free (the crowd still waits for a step or a shot)
        {
          id: 'inside',
          k: 'talk',
          goal: 'task.hall',
          go: [
            {
              a: 'group',
              g: 'hall',
              spread: { near: 380, gap: 260 },
              post: 1,
              roam: 160,
              of: [
                ['walker', 10],
                ['runner', 3],
                ['armored', 1],
              ],
            },
            { a: 'voice', id: 'copper.2' },
          ],
          end: [{ a: 'voice', id: 'nova.23' }],
        },
        // they wait until he walks or shoots; then they come, and a third of a run's stream with them
        {
          k: 'stir',
          goal: 'task.hall',
          end: [
            { a: 'wake', g: 'hall' },
            { a: 'director', on: 1 / 3 },
          ],
        },
        // two minutes of it (REV 38, was three), then the Butcher; Walt is freed with his death
        { k: 'hold', t: 120, goal: 'task.hold', end: [{ a: 'voice', id: 'nova.11' }] },
        {
          k: 'kill',
          g: 'butcher',
          goal: 'task.butcher',
          go: [{ a: 'boss', k: 'butcher', g: 'butcher' }],
          end: [{ a: 'voice', id: 'nova.12' }],
        },
      ],
    },
    // mission 2: the suburbs' Mushroom Monster (the final boss, 'golem'); its spores infect Copper (nova.16)
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
    // mission 3: the laboratory, to its final boss in the hall (Nova's 17 sends him here from the base: hub.js); the Devourer
    // dead, the antivirus lies where he fell (a vaccine for the backpack): taken, the mission is done (docs/design.md)
    lab: {
      classic: 1,
      tasks: [
        { k: 'kill', g: 'heart', goal: 'task.labBoss', end: [{ a: 'loot', it: 'vaccine', nm: 'antivirus' }] },
        { k: 'take', n: 'antivirus', goal: 'task.antivirus' },
      ],
    },
  };

  root.MISSIONS = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
