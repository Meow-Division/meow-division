# Meow Division: game design canon

Decisions the human made on 2026-11-08. Change them only when the human changes them.
Player-facing text exists in four languages (en, ru, uk, es); the English line is the source.

## Names

| Thing | Name | Notes |
| --- | --- | --- |
| Game | Meow Division | backup: Cat Division. No other game's name anywhere in the product. |
| Hero | Copper | ginger tabby cat in helmet and vest; the existing hero |
| Agent (voice on the radio) | Nova | woman, strict, short orders; recorded by the human, radio effect added by us |
| Merchant | Walt | freed in mission 1, trades at the base, has his own wallet |
| Base | NEAR Base | the NEAR AI office in San Francisco, its inside, once mission 1 takes it back |
| Tokens, NFTs, contracts | named after the game | no separate token or NFT brand |

Naming rule for anything new: two plain words everyone knows (Meow Division, Cat Division), easy to say aloud in Russian. No puns, no rare English, no mushroom or tech themes.

## Setting

San Francisco, 7:32 AM. The NEAR AI office has been overrun. Nova runs operations from a bunker under the office; Copper is the operative. Walt, the quartermaster, is trapped inside the office. The base and the campaign exist so that every item in the game has a reason to exist and a place to be used.

The story (the campaign map, in order):
1. **NEAR AI office**: clear it and free Walt; its inside becomes NEAR Base.
2. **Suburbs**: the Mushroom Monster is the base's biggest threat, its spores spreading toward the bunker. Copper kills it,
   but the spores infect him.
3. **Laboratory**: before the outbreak the lab ran an antivirus programme. Nova sends Copper there to find the
   antivirus and cure himself.
4. **Port** (the ship) and 5. **Military base**: on the map, locked ("soon"), after the hackathon. The broken bridges
   are scenery.

The campaign screen (`live/campaign.js`) is the human's map of San Francisco (`art/campaign/map_src.png` →
`live/assets/bg_campaign.jpg`) with everything else drawn in code over it, after their mockup
(`art/campaign/mockup.png`): the BASE button, the CAMPAIGN plate, the coins; the missions as numbered nodes on a dashed
road (done: green check; current: orange with "!"; not reached: skull; locked: padlock); the chosen mission's panel
with its picture, goal, rewards (`ECONOMY.MISSIONS`) and PLAY; leaves on the wind, birds, glints on the bay, mist.

## Player path (first session)

1. Start screen: "Play". Wallet connect / create is one visible, optional button from the first screen. Nothing asks for it.
2. Intro: typewriter text "SAN FRANCISCO · 7:32 AM / NEAR AI BASE", Nova's voice, skippable.
3. Mission 1, part A, on the NEAR AI office's own map (`live/map_office.js`, after the human's concept art: the road
   with a checkpoint, the parking lot, the office; the human's script of 2026-11-09, reworked the same evening). Each
   step is a task with an arrow (`live/missions.js` office); the line numbers are in `docs/voice.md`. While Nova or
   Copper talks Copper stands still; a card screen she talks over waits for her (its take counts the seconds down).
   1. The intro (the place and the time typed out, Nova's first order) comes each time mission 1 is started. Copper
      comes in on the road below the checkpoint and stands still, the screen a little darker and the keys to walk
      shown (the left thumb on a phone): Nova (19) sends him to the supplies by the van. As she ends the shade goes and
      Copper answers (copper 1) already free to walk; the keys stay until he walks off. A red closed line in front of
      him holds until he has the crate.
   2. The crate: armour +1, medkit +1, pistol +3. While its screen is up Nova says what skills are (24; what is in it
      shows on its cards), a gold frame going round its cards one by one; then it can be taken. No words under the perk bar: she
      said it. From here on the HUD offers to skip the tutorial (a second tap confirms): Copper goes straight inside
      with the drone and the clover at level 2.
   3. The arrow points on to the parking lot's middle (mark `guards`). Past an invisible line in front of the van Nova sees the zombies ahead
      (20): a horde and a super mob by the checkpoint come. No timer: kill them all. An invisible wall beyond the
      checkpoint holds Copper on the road.
   4. The super mob always drops the magnet (only the magnet). Nova (4): pick it up; it pulls in the crystals. The
      cards come once every crystal has flown in.
   5. First level-up: three attack perks shown (drone, lightning, pistol ammo), all drawn alike; the drone's frame
      blinks and only it can be taken, once Nova (5) is done. Then the invisible wall goes and Nova sends him on to
      the parking lot (21), the arrow on its middle again.
   6. The parking lot: a crowd of 15 (6 super mob and 9 ordinary zombies) wanders it and comes when Copper is near or
      shoots. At the mark `parking`, or as soon as one of them notices him, Nova (6): there are many, use the bomb; the
      arrow points at the bomb. Picking it up blows up every one on
      screen; shooting them all works as well.
   7. They leave only a medkit (a health pickup, not the perk), no crystals: the last of them to die drops it. If Copper is at full health the blast
      quietly takes 15 % of it (no effect, no number on screen), so the medkit always heals. Nova: good work, pick it
      up (7), or, when the bomb was left lying, she notes he doesn't take the easy way (22).
   8. Nova drops supplies before he goes in (8): a drop lands by the entrance and holds exactly one perk, the clover;
      there is nothing to choose. While its screen is up Nova tells of the pairs (9); once taken the perk bar lights
      the drone and the clover together and shows the super drone they make at the drone's top level (`D.EVOS` in
      `live/data.js`). Until then the office door stays shut. Copper now holds pistol 4, armour 1, medkit 1, drone 1,
      clover 1. No second perk screen in part A.
   9. Nova: the entrance is clear (10). A glowing ring marks the door: stepping on it the screen goes dark and comes
      back inside.
4. Mission 1, part B (inside the office, `live/map_office_in.js`): a crowd (a third of what was planned) wanders the
   building (spread over every spot the hero can walk to, none near him, a third in sight) and doesn't come at once;
   no gun aims at it by itself
   meanwhile. Copper sees Walt and the zombies (copper 2), standing still while he speaks; Nova: be careful (23), he
   is free by then. The crowd comes when he walks or shoots, with a third of a run's stream; three
   minutes of it, then the Butcher miniboss, Walt freed, first trophy (the cleaver).
   Its walls are the office wall kit (2026-11-10, after the human's concept art `art/office/refs/concept_inside.png`):
   `gen/wallguide.py` draws the 2:1 guides, Codex paints four sheets to them (`art/office/user/inside/kit`), and
   `gen/m1art.py` cuts them into `m1_wk_*`: full walls along gx (↘) and gy (↗) — plain, window, door with its red
   lamp, frosted glass, entrance doors — low front walls and pillars. Every piece is exactly 250 × 30 on the ground
   (a pillar 50 × 50), and the map editor puts a kit piece down flush against the kit piece nearest it. Half pieces
   (125 × 30: concrete plain, with a closed or an open door; glass pane, open glass door) and server racks (50 × 50,
   their fronts either way) join the same way. A piece with an open door (PROP gap) stops bodies only either side of
   its doorway.
5. Arrive at NEAR Base: Copper walks the office's inside between runs. Nova and Walt stand there; buildings are broken.
6. First trade: Walt thanks Copper and says he can now buy and sell (Walt's line 1); the task "walk up to Walt" appears with an arrow. At Walt: sell the cleaver. Right after the sale, if no wallet is connected yet, a choice appears: "Connect a NEAR account" or "Create a wallet" (both open the wallet window; never shown earlier, never if a wallet is already connected), with Nova's line 13. Then build the workbench.
7. Mission 2 (suburbs): Nova names the Mushroom Monster the biggest threat to the base. First raid with containers, backpack and safe; the Mushroom Monster (the `golem` boss). Its trophy and materials unlock the shooting range and open suburb raids. When it dies, its spores infect Copper (Nova's line 16): the hero shows an "infected" mark at the base until mission 3 is done (story only, no penalty).
8. Mission 3 (laboratory, if time allows): Nova sends Copper to the lab for the antivirus (line 17). Goal: find the antivirus and bring it out; it cures Copper and opens lab raids. Its materials (antiseptic, vaccine samples) feed the medbay.
9. From here: the loop below. The bridge, the ship and the military base are on the campaign map, locked ("soon").

Classic 10-minute runs (the existing mode, solo and co-op for two) stay available from the campaign screen.

## Loop and cadence

Base → run (10 min; from 4:00 the Evac button opens (the human, 2026-11-10: every mission is left by its button, not by a point to stand on): pressed, a 10 s countdown, then out with what you carry; a run won (its final boss or its goal) is a full extraction: the Evac button counts down 3 s, and leaving it any other way after the win (the pause menu, a partner gone, ten minutes standing) counts the same) → bring loot home → build, craft, upgrade → next run.

| Every 30 seconds | Every 5 minutes | Every session |
| --- | --- | --- |
| fight, pick crystals, search a container, choose a perk | a boss or an evac decision: leave with what you have or stay | sell to Walt, build or upgrade, take kits into the next run, see prices move |

## Hub base (no zombies)

| Building | Levels | Gives | Locked |
| --- | --- | --- | --- |
| Generator | 2 | level 2 of other buildings | no |
| Stash | 3 | more slots, the safe | no |
| Workbench | 3 | weapon levels, kit crafting | no |
| Medbay | 3 | medkits, vaccine | no |
| Shooting range | 2 | test weapons without a run | until the Mushroom boss trophy |
| Walt | - | buys, sells, barters, gives quests | no |
| Kitchen | 1 | "soon" | yes |
| NEAR AI server room | 1 | "soon" | yes |

Each building has a visible list of what it needs (coins plus items). Coins and levels are off-chain; items are on-chain.

### Nova's base tutorial (the human's, 2026-11-11; SIM.REV 41)

After mission 1 the base teaches itself, one goal at a time (its plaque and arrow, `live/hub.js`; the state in the save,
`rules.js` base, the server's for an account):

1. Walk up to Walt (his line 1), talk to him: his window opens as a lesson (`market.js`) that can't be closed until the
   cleaver is sold. A pointer shows the cleaver, then the Sell button; a sale is a 2-second hold of its button (it fills
   up), never a "sure?" (every sale, not only this one). Walt sends Copper to Nova (line 3); a player without a wallet then
   gets her wallet offer (nova.13) as before.
2. Talk to Nova (nova.25): upgrades for the cat and his guns need a generator, a workbench and a medbay at level 1.
3. The generator (fuel ×1, light bulbs ×2, wires ×1; 5 s) in the small closed room, used from its door (nova.26). The
   office is not darkened before it runs (the human, 2026-11-12: the dark filter read as a parody).
4. The workbench's room (the right alcove) cleared of junk: a gear on it, tap, Clear (free, 5 s; nova.27). Then the
   workbench (nuts and bolts, screws, duct tape, planks, scrap metal ×1; nova.28).
5. The glass meeting room cleared (1 min). While it goes: buy a gun from Walt (his Guns tab: the guns the cat's rank opens,
   coins into the account, not items on the wallet) and upgrade it at the workbench (the guns' upgrades need it; the lobby
   arsenal says "Walt sells it" and "Workbench"). Nova's line 29 when the room is clear.
6. The medbay (antiseptic ×2, bandages ×3; nova.30): the cat's upgrades open (they need it), and the rest of the base is
   the player's: every heap of junk shows its gear.

The parts are cheap and always on Walt's shelf (`economy.js` WALT_BASICS: his shelf is topped up to them each morning).
Or the suburb: while a building of the tutorial waits for its parts, the first boss of the next suburb raid drops all of
them, once (`rules.js` gift: the server puts it in the run's ticket, the replay plays it, the bank marks it given; Nova's
line 31). In a raid, items the base needs now carry a green check in their backpack slot (and in the stash and Walt's
window). Clearing junk: the base's n-th clearing takes 5 s, 1 min, 5 min, 30 min, 1 h, 2 h, 3.5 h, 5 h, 7 h, 10 h (real
time, one at a time; `economy.js` CLEAR_TIME); junk heaps: `sim.js` HUB_JUNK, the buildings' furniture `HUB_BUILD`.

### The base moves into the office (planned with the human, 2026-11-11; first step built)

Built (2026-11-11, the human's call: "make the base in the office now, Walt and Nova by the sofa left of the reception,
move nothing else over, remove the old base"): NEAR Base is mission 1's office inside (live/map_office_in.js, the hub's own
seed SIM.BASE), the bunker (live/map_base.js, gen/basemap.mjs, the editor's base map) is gone. Walt and Nova stand on the
floor between the lounge and the reception (sim.js HUB_NPC; mission 1's Walt stays in his alcove there); no buildings yet,
so their panels don't show (live/hub.js finds a building by its furniture). Walt stands (his stool went with the bunker).

Its own map (2026-11-12, the human's call): live/map_base.js is now NEAR Base's, a copy of the office's inside the human
reworks in the editor (its База button, ?editor&map=base): part of the street and the parking come with it, Walt and Nova
stand on it as props (sim.js HUB_NPC only where it has none), mission 1 keeps live/map_office_in.js. The junk heaps and
the buildings' spots (sim.js HUB_JUNK, HUB_BUILD) are matched to its props. New pieces after the human's reference
(art/office/refs/ref_entrance.png): a glass wall with its doorway open (m1_wk_x/y_glassopen, the generator's room), the
main entrance open (m1_wk_x/y_entranceopen) with its two glass leaves swung out onto the parking (m1_pk_door), parking
wheel stops, curbs and a strip of wild flowers (m1_pk_stop, m1_pk_curb, m1_pk_flowers).

Nova's post and Walt's trading post (2026-11-12, after the human's concept art/office/refs/ref_npc_posts.png): each one prop on
a hazard mat against the window wall, its front toward the room (m1_in_novapost, m1_in_waltshop), the cat seated in its
chair (their sit and doze clips, live/scene.js NPC3D sit; doze leans forward, drawn back toward the chair) between the prop
and its front layer (<name>_front, sorted only a little after it, SPLIT_DZ 45: more put it after the wall in front and the
hero under the desk). Drawn on gen/postguide.py's boxes and squared to the grid by gen/m1art.py iso=, the footprint is the
mat. Walt is a trader of today, after Tarkov's traders, S.T.A.L.K.E.R.'s Sidorovich and Zero Sievert's hub (the human: "is he
a merchant from a historical game?"): steel shelves of ammo, meds and supplies, guns for sale on a mesh, a cash register of
gold coins, a laptop with price charts; no scales, lanterns or banners. Nova's own rifle stands in its rack (the game's
sniper rifle, its scope on top). At the base the three cats are drawn 1.25 × bigger (scene.js BASE_K; the human: they looked
children beside the furniture), the posts stay at the office furniture's scale. The hero talks to them from their desk's
edge (live/hub.js: a person's post counts as theirs). The windows they stand against let in no low sun (sim.js
shutWindows, the base only: their glow washed over Nova).

The plan: the base is mission 1's office inside instead of the bunker. After mission 1
its furniture (desks, the reception, the meeting table, the lounge, planters, crates, sandbags) can be broken to free room for
the buildings; litter, glass and blood go by themselves. The server room stays as it is. Every building looks bigger and
richer at each level (its own picture per level), so each one's spot is kept for its biggest level. Nova and Walt look the
same always (their 3D models).

| Building | Levels | Each level opens (planned) |
| --- | --- | --- |
| Generator | 2 | power for the other buildings' level 2, then level 3 |
| Stash | 3 | a 1-slot safe; a 2-slot safe; a 10-slot backpack |
| Workbench | 3 | which guns can be upgraded: pistol, shotgun; then smg, minigun, sniper; then flame, rocket, laser (a gun's mastery still caps how far); kits as now |
| Medbay | 3 | the hero's upgrades up to: health, damage, speed, magnet 2 / 4 / 5; rerolls, start crate 1 / 2 / 3 (what was bought above stays); medkits, vaccine as now |
| Kitchen | 2 | in a run the hero slowly heals; then faster, and +10% XP |
| Shooting range | 2 | as above (its mode is not made yet: "soon"); later it moves out to the parking lot |

Layout (the human's pick, art/night/out/base_lay_c.png, drawn by Codex on the office emptied of furniture): Walt's counter,
Nova's command post and the stash together in the right alcove by the door with the red exit light (where Walt stands in
mission 1); the workbench on the open floor in the middle; the generator in the small closed room at the top; the medbay in
the glass meeting room; the kitchen in the sunlit floor by the left windows; the shooting range by the glass entrance doors.
Next: the same picture with every building at level 2 and at level 3, then each building cut as its own sprite per level.

## Items (NEP-245 token ids are fixed forever; display names live in the language packs)

| token_id | Name (en) | Rarity | Found in |
| --- | --- | --- | --- |
| gears | Gears | 1 | suburbs, laboratory |
| tape | Duct tape | 1 | suburbs, laboratory |
| fuel | Fuel | 1 | suburbs, laboratory |
| cans | Canned food | 1 | suburbs, laboratory |
| bandages | Bandages | 1 | suburbs, laboratory |
| bulbs | Light bulbs | 1 | suburbs, laboratory |
| tools | Tools | 2 | suburbs, laboratory |
| catfood | Cat food | 2 | suburbs, laboratory |
| antiseptic | Antiseptic | 2 | suburbs, laboratory |
| chips | Microchips | 2 | suburbs, laboratory |
| gpu | Graphics card | 3 | suburbs, laboratory |
| vaccine | Vaccine sample | 3 | laboratory |
| usb | Flash drive | 3 | suburbs, laboratory |
| nuts | Nuts and bolts | 1 | suburbs, laboratory |
| screws | Screws | 1 | suburbs, laboratory |
| planks | Planks | 1 | suburbs, laboratory |
| scrap | Scrap metal | 1 | suburbs, laboratory |
| wires | Wires | 1 | suburbs, laboratory |
| springs | Springs | 2 | suburbs, laboratory |
| battery | Car battery | 2 | suburbs, laboratory |
| fabric | Fabric | 1 | suburbs, laboratory |
| t_butcher, t_pustule, t_screamer, t_tank, t_shroom | Boss trophies (the Butcher's cleaver, ..., the Mushroom boss's cap; `t_shroom` is the `golem` enemy) | 4 | one per boss kill |
| k_medkit, k_grenades, k_magnet, k_vest, k_vaccine | Kits (crafted, taken into a run, consumed) | - | workbench, medbay |
| s_* | Cat skins | - | Walt, Intents shop |

The building materials (nuts to fabric, added 2026-11-08) are what the base and the kits are made of, and every cost
names what the thing is physically made of: the workbench gets a vise and a drill (tools, gears, scrap), then gun
parts (springs, tools, chips); the stash gets racks (planks, screws), then a steel safe, then a fabric backpack; the
generator runs on fuel, wires and batteries; the medbay starts with a cot (planks, fabric) and gets an operating lamp
(bulbs, wires); the range is planks, screws and scrap targets, then sprung, lit targets. Grenades: a can, fuel, nuts
for shrapnel, tape. Magnet: wires on a scrap core with a battery. Vest: fabric and scrap plates. The hero's upgrades:
health = fabric, food, medicine; damage = metal, then chips and a graphics card; speed = tape, fabric, springs; pickup
radius = wires, batteries; rerolls = flash drives, chips; starting gear = a crate (planks, nuts), then tools. A gun's
upgrades: damage = scrap, gears, tools; rate of fire = springs, tools; magazine = springs, tape, scrap. The Mushroom
boss trophy unlocks the range and is not spent.

Where things drop (the human, 2026-11-09): the NEAR AI office (mission 1) is a small map that becomes the shelter
once cleared; it has no containers and gives only the Butcher's cleaver, so workbench level 1 is a repair paid in
coins (the cleaver's sale). Raids are the suburbs and the laboratory: nearly every material drops on both, at
different chances; the vaccine sample only in the lab; trophies only from bosses; microchips, flash drives and
graphics cards rarely. A raid brings little home, so building up is a grind: the first level of every upgrade costs
coins only, the next ones add the items the thing is made of.

Upgrades (the hero's and each gun's) will also cost items on top of coins. The human sets every amount on the economy
page (`econ-editor.bat` → `live/econ.html`): building, kit and upgrade costs, loot tables, and how many raids each cost
takes on average (loot is random: one raid is often not enough). It writes `live/economy.js` and the upgrade coin
prices in `live/data.js`.

### Economy pace (tuned 2026-11-09 with the bots)

The economy bots (`live/econbot.js`; the page's Progress tab, `node gen/econsim.mjs`) do not play: each takes finished
runs that the balance bot played headless on the current rules (`gen/econruns.json`, from `gen/balance.cjs`: when the
hero would have died, kills over time, when each boss fell) and lives the economy around them: leaves at the evac or
dies (bag lost but the safe), opens containers on the loot table, sells the surplus to Walt, buys the cheapest thing
it can, crafts kits, plays its newest gun. The current numbers (written by `gen/econtune.mjs`) give, for the median of
200 bots, a raid being about 7 minutes with the base:

| When | What the median player has |
| --- | --- |
| raid 1 (mission 1) | workbench, pickup radius 1, gun upgrades 1 |
| raids 2-5 | missions 2 and 3, health 1-2, speed 1, damage 1, medbay 1, stash 1 (its safe), gun upgrades 2 |
| raids 6-12 (about 1.5 h) | generator 1, range 1, the shotgun, the other hero upgrades at level 2 |
| raids 25-35 (about 4 h) | workbench, stash, medbay level 2; hero upgrades at 3 |
| raids 45-90 (6-10 h) | generator 2, range 2, stash 3, medbay 3, workbench 3; gun upgrades at 5 |
| raids 95-150+ (11-18 h) | the hero's upgrades at 5 (speed and health about raid 100, damage about 150), the late guns: the grind |

A raid brings about 5-6 items home and 330-530 coins; 4 to 5 raids in 10 end in death (the bag lost but the safe). What holds the next
purchase back is coins slightly more often than items; of the items, springs (rate of fire, magazine, speed), nuts and
scrap (the stash's safe), planks early (stash and range) and fabric (the backpack). `test/econbot.test.mjs` keeps
these promises: the workbench right after mission 1, the first buildings within a few raids, level 2 in tens of
raids, the top levels in a hundred and more, a few items per raid, and nothing out of reach. Evacuating earlier
(tried at 3:00 and 3:30) lowers deaths but slows progress (shorter raids, fewer coins), so the evac stays at 4:00.

Rules: containers are searched by standing 1.5 s beside them; backpack 8 slots plus a safe of 2; death loses everything but the safe; map-specific loot tables; one trophy per boss per run. A boss's trophy and a mission's reward items go straight into the backpack (the human, 2026-11-10); everything else that drops flies into the backpack once the hero is within his pickup radius, like the medkit or the bomb; a full backpack leaves it lying and the player is told the backpack is full (open it and drop something, then walk back). What the hero throws out himself is taken back only by hand (E or a tap). Together: a hero down when the evac ends is carried out with his backpack; one who leaves the run drops his on the ground for the partner.

## Walt's market (all numbers in `live/economy.js`, the one readable pricing file)

- Buy price = `base × 2 × norm / (norm + stock)`: the more Walt holds, the less he pays.
- Sell price = buy price × 1.4, and at least a coin more than he pays for the same item back, so buying from him and selling straight back never earns. Walt sells only what players have sold him. Stock decays 5% per day, a small shelf too (the fraction is carried to the next day).
- Barter offers (e.g. a graphics card for a machine gun) and six quests from Nova and Walt.
- Every price shows Walt's reasoning in his bubble (stock, recent demand). NEAR AI writes the words (`server/waltai.mjs`), and his note on the day's market when the window opens; the numbers in them are slots the page fills from the formula, never the model's.
- Fast-forward mode for judges: a week of trading simulated in a minute, visible on the market screen. Built
  (2026-11-11): the **Fast-forward a week** button in Walt's window (`market.js` ffStart) plays the other players' days
  (`economy.js otherPlayersDay`, the same days the server's shelf lives) step by step on a copy of the shelf: the slot
  each sale or buy hits flashes, the middle shows what Walt paid at the start and pays now, Walt sums up each day. The
  real shelf is left as it is and no trade is made on the copy; **Back to today** (or closing the window) ends it.
- Walt's stock is on-chain in his own wallet; prices are computed from that stock.
- Built so far (2026-11-10): one shelf for every player kept by the server (`server/walt.mjs`, `GET /api/walt`); a
  new server opens with a week of the other players' trading behind it and each day since goes by the same way
  (`economy.js otherPlayersDay`). Trades are rules (`rules.js act` 'sell' and 'wbuy', priced unit by unit from the
  shelf: `economy.js sellTotal`, `buyTotal`): an account's are checked and applied by the server against its shelf,
  a guest's against the page's copy. The windows are `live/market.js`: the stash (I, the corner button, the stash's
  lockers) and Walt's trade window (walking up to him): slot grids by rarity, the picked item with its price and what
  it goes into, how many and the total, Walt's reasoning in his bubble, a second tap before a trophy or a rare item
  is sold. Not yet on chain: his stock and the players' items live in the server's saves until the mint is built.

## Identity

- Wallet only. No Telegram login, no email login, no separate accounts. Telegram behaves exactly like the PC: guest or wallet.
- A guest plays fully; progress and items sit in a server-side guest ledger keyed by a device token.
- "Connect" or "Create" both open a wallet (HOT inside Telegram, Meteor or any NEAR wallet on PC). On the first connect, the guest ledger is minted to the wallet and the device joins that wallet.
- One approval at connect (a function-call key limited to the game's contract). After that, selling, crafting and equipping never open a wallet window.
- The wallet is where the data lives: open the game on another device, connect the same wallet, continue.
- Built so far (2026-11-10): nothing asks for a wallet before a run. After the first sale to Walt, Nova's offer
  (nova.13): "Connect a NEAR account" (NEAR Connect's window) or "Create a wallet" (inside the game, no other
  window: a name, `<name>.near` made by the game's contract, the 12-word recovery phrase shown once to write down and
  again from the wallet panel; `live/newwallet.js`; open once the device proved mission 1). A guest's mission runs go
  to the server with its device token and are played again there into the device's record. A wallet's first sign-in
  takes that record into the new account, once (`rules.js adopt`: the missions finished in order, the items the runs
  carried out, coins and rank XP up to a first session's worth, each no more than the page still has).

## On-chain vs off-chain

| On-chain (contract under `meowdivision.near`) | Off-chain (server, replay-verified) |
| --- | --- |
| items, trophies, kits, skins (NEP-245) | coins, levels, building levels, campaign progress |
| Walt's stock (his wallet) | prices (derived), quests, leaderboards |
| mint on run end, sell, craft, barter, equip (NEP-297 events) | run inputs, replay hashes, guest ledger |

## Player-facing language

- Never show chain jargon in the game: no "mint", "burn", "NFT", "token", "gas", "transaction", "sign". Say "sent to your wallet", "yours", "sold", "built".
- Nova: strict, short, imperative, no jokes, no exclamation marks. Walt: warm, practical, few words.
- Four languages, same meaning, no machine-sounding text. The human checks Russian.
- Nova's 18 lines and Walt's lines (English, drafts until recorded) are in `docs/voice.md`; subtitles follow them exactly.

## Not in this game

Telegram login. Testnet. Wallet popups during a run. Gameplay that waits for an AI response. Separate token or NFT brands. Marketing copy anywhere in the product.
