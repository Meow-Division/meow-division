# Meow Division: game design canon

Decisions the human made on 2026-11-08. Change them only when the human changes them.
Player-facing text exists in four languages (en, ru, uk, es); the English line is the source.

## Names

| Thing | Name | Notes |
| --- | --- | --- |
| Game | Meow Division | backup: Cat Division. Never "Zombie Horde" in player-facing text. |
| Hero | Copper | ginger tabby cat in helmet and vest; the existing hero |
| Agent (voice on the radio) | Nova | woman, strict, short orders; recorded by the human, radio effect added by us |
| Merchant | Walt | freed in mission 1, trades at the base, has his own wallet |
| Base | NEAR Base | a bunker under the NEAR AI office in San Francisco |
| Tokens, NFTs, contracts | named after the game | no separate token or NFT brand |

Naming rule for anything new: two plain words everyone knows (Meow Division, Cat Division), easy to say aloud in Russian. No puns, no rare English, no mushroom or tech themes.

## Setting

San Francisco, 7:32 AM. The NEAR AI office has been overrun. Nova runs operations from a bunker under the office; Copper is the operative. Walt, the quartermaster, is trapped inside the office. The base and the campaign exist so that every item in the game has a reason to exist and a place to be used.

## Player path (first session)

1. Start screen: "Play". Wallet connect / create is one visible, optional button from the first screen. Nothing asks for it.
2. Intro: typewriter text "SAN FRANCISCO · 7:32 AM / NEAR AI BASE", Nova's voice, skippable.
3. Mission 1, part A (parking lot at the NEAR AI office). Each step is a task with an arrow; Nova's line numbers are in `docs/voice.md`.
   1. Supply crate: armour +1, medkit +1, pistol +3.
   2. Hint: the perk bar.
   3. A horde and a super mob; stop them before the base.
   4. A magnet drops and pulls in the crystals.
   5. First level-up: three active perks are shown (drone, lightning, pistol ammo); only the drone can be picked. Nova:
      take the drone so she can help Copper remotely.
   6. The entrance guard: 2 super mob defenders and 3 ordinary zombies. Before Copper reaches them, a bomb lies on the
      ground. Nova: don't fight them, use the bomb; the task arrow points at the bomb. Picking it up blows up all five.
   7. The blast quietly takes 25 % of Copper's max health (no effect, no number on screen; never below 10 %), so the
      medkit that comes next always heals. Nova: good work. A super mob drops a medkit (a health pickup, not the perk);
      Nova: pick it up to heal. The guards' crystals never complete a level here: no perk screen at this point.
   8. Nova drops supplies: a drop lands next to Copper and holds exactly one perk, the clover; there is nothing to
      choose. When he picks it up, the perk bar lights the drone and the clover together and shows the super drone they
      make at the drone's top level (`D.EVOS` in `live/data.js`). Nova: she sent the clover; every attack perk has a
      passive partner that turns it into a super perk. Copper now holds pistol 4, armour 1, medkit 1, drone 1,
      clover 1. No second perk screen in mission 1.
   9. The entrance is clear: go inside.
4. Mission 1, part B (inside the office; the roof disappears): three minutes of waves, the Butcher miniboss, Walt freed, first trophy (the cleaver).
5. Arrive at NEAR Base: Copper walks the bunker between runs. Nova and Walt stand there; buildings are broken.
6. First trade: Walt thanks Copper and says he can now buy and sell (Walt's line 1); the task "walk up to Walt" appears with an arrow. At Walt: sell the cleaver, then build the workbench. If no wallet is connected, Nova gives the "connect a wallet" task here (never earlier; never if a wallet is already connected).
7. Mission 2 (suburbs): first raid with containers, backpack and safe, the Mushroom boss. Its trophy and materials unlock the shooting range and open suburb raids.
8. From here: the loop below. Missions 3+ are shown locked ("soon").

Classic 10-minute runs (the existing mode, solo and co-op for two) stay available from the campaign screen.

## Loop and cadence

Base → run (10 min; evac from 4:00; boss kill = full extraction) → bring loot home → build, craft, upgrade → next run.

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
| gears | Gears | 1 | suburbs |
| tape | Duct tape | 1 | suburbs |
| fuel | Fuel | 1 | suburbs |
| cans | Canned food | 1 | suburbs |
| bandages | Bandages | 1 | suburbs, laboratory |
| bulbs | Light bulbs | 1 | NEAR AI office, laboratory |
| tools | Tools | 2 | suburbs |
| catfood | Cat food | 2 | suburbs |
| antiseptic | Antiseptic | 2 | laboratory |
| chips | Microchips | 2 | laboratory, NEAR AI office |
| gpu | Graphics card | 3 | NEAR AI office |
| vaccine | Vaccine sample | 3 | laboratory |
| usb | Flash drive | 3 | NEAR AI office, laboratory |
| t_butcher, t_pustule, t_screamer, t_tank, t_shroom | Boss trophies (the Butcher's cleaver, ..., the Mushroom boss's cap; `t_shroom` is the `golem` enemy) | 4 | one per boss kill |
| k_medkit, k_grenades, k_magnet, k_vest, k_vaccine | Kits (crafted, taken into a run, consumed) | - | workbench, medbay |
| s_* | Cat skins | - | Walt, Intents shop |

Rules: containers are searched by standing 1.5 s beside them; backpack 8 slots plus a safe of 2; death loses everything but the safe; map-specific loot tables; one trophy per boss per run.

## Walt's market (all numbers in `live/economy.js`, the one readable pricing file)

- Buy price = `base × 2 × norm / (norm + stock)`: the more Walt holds, the less he pays.
- Sell price = buy price × 1.4. Walt sells only what players have sold him. Stock decays 5% per day.
- Barter offers (e.g. a graphics card for a machine gun) and six quests from Nova and Walt.
- Every price shows Walt's reasoning in a tooltip (stock, recent demand). NEAR AI may phrase it; the numbers never come from the model.
- Fast-forward mode for judges: a week of trading simulated in a minute, visible on the market screen.
- Walt's stock is on-chain in his own wallet; prices are computed from that stock.

## Identity

- Wallet only. No Telegram login, no email login, no separate accounts. Telegram behaves exactly like the PC: guest or wallet.
- A guest plays fully; progress and items sit in a server-side guest ledger keyed by a device token.
- "Connect" or "Create" both open a wallet (HOT inside Telegram, Meteor or any NEAR wallet on PC). On the first connect, the guest ledger is minted to the wallet and the device joins that wallet.
- One approval at connect (a function-call key limited to the game's contract). After that, selling, crafting and equipping never open a wallet window.
- The wallet is where the data lives: open the game on another device, connect the same wallet, continue.

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
- Nova's 16 lines and Walt's lines (English, drafts until recorded) are in `docs/voice.md`; subtitles follow them exactly.

## Not in this game

Telegram login. Testnet. Wallet popups during a run. Gameplay that waits for an AI response. Separate token or NFT brands. Marketing copy anywhere in the product.
