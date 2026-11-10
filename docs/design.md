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
| Base | NEAR Base | a bunker under the NEAR AI office in San Francisco |
| Tokens, NFTs, contracts | named after the game | no separate token or NFT brand |

Naming rule for anything new: two plain words everyone knows (Meow Division, Cat Division), easy to say aloud in Russian. No puns, no rare English, no mushroom or tech themes.

## Setting

San Francisco, 7:32 AM. The NEAR AI office has been overrun. Nova runs operations from a bunker under the office; Copper is the operative. Walt, the quartermaster, is trapped inside the office. The base and the campaign exist so that every item in the game has a reason to exist and a place to be used.

The story (the campaign map, in order):
1. **NEAR AI office**: clear it and free Walt; the bunker under it becomes NEAR Base.
2. **Suburbs**: the Shroom Hulk is the base's biggest threat, its spores spreading toward the bunker. Copper kills it,
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
5. Arrive at NEAR Base: Copper walks the bunker between runs. Nova and Walt stand there; buildings are broken.
6. First trade: Walt thanks Copper and says he can now buy and sell (Walt's line 1); the task "walk up to Walt" appears with an arrow. At Walt: sell the cleaver. Right after the sale, if no wallet is connected yet, a choice appears: "Connect a NEAR account" or "Create a wallet" (both open the wallet window; never shown earlier, never if a wallet is already connected), with Nova's line 13. Then build the workbench.
7. Mission 2 (suburbs): Nova names the Shroom Hulk the biggest threat to the base. First raid with containers, backpack and safe; the Shroom Hulk (the `golem` boss). Its trophy and materials unlock the shooting range and open suburb raids. When it dies, its spores infect Copper (Nova's line 16): the hero shows an "infected" mark at the base until mission 3 is done (story only, no penalty).
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
- Every price shows Walt's reasoning in a tooltip (stock, recent demand). NEAR AI may phrase it; the numbers never come from the model.
- Fast-forward mode for judges: a week of trading simulated in a minute, visible on the market screen.
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
