# Voice lines: Nova and Walt (English is the source; subtitles in four languages follow it exactly)

Status: final text (the human, 2026-11-08; mission 1 reworked 2026-11-09) except Nova's lines 14, 16 and 17 (the new
story: drafts). 3 is no longer said (20 says it now). Every line said in the game is made with ElevenLabs (2026-11-10,
`gen/voice.mjs`: the English with audio tags for how it is said, model eleven_v4, each speaker's voice below); the
human's own recordings of Nova's 1–5 and 10–12 (2026-11-08) are kept in `art/voice/raw_human_2026-11-08/` (nova_03,
no longer said, stays as the human recorded it). The tags are in `gen/voice.mjs`; a line's words without its tags must be its
English subtitle (the script checks it).
Changes to a line are the human's call.
Rows are in the order a player hears them. Build triggers against the ids (`nova.N`, `walt.N`), not the wording.

## Nova (ElevenLabs: the library voice "Lauren - Friendly, Comforting and Soft"; radio effect added in post)

Tone: strict, short, imperative, brisk (she is on a mission: never slow, never soothing). No jokes, no exclamation marks.

| # | Trigger | English | Russian subtitle |
| --- | --- | --- | --- |
| 1 | after the intro | Copper, this is Nova. Orders stand: clear the base and bring our man Walt out alive. Supplies are at the drop zone. Move out. | Коппер, это Нова. Приказ в силе: зачистить базу и вывести Уолта живым. Припасы на месте высадки. Вперёд. |
| 19 | mission 1 begins: Copper stands still until she is done (the screen a little darker) | You're in position. The mission supplies are by the van. Take them. | Ты на месте. Припасы для миссии у фургона. Забери их. |
| 2 | (no longer said: the crate's cards show what is in it) | Armor, a medkit, a better pistol. That's all you get. Gear up. | Броня, аптечка, пистолет получше. Это всё. Снаряжайся. |
| 24 | crate opened (its take waits for her; a frame goes round its cards) | These are your skills. Each level, take a new one or upgrade one you have. | Это твои навыки. На каждом уровне бери новый или улучшай тот, что есть. |
| 20 | past the line in front of the van: the horde at the checkpoint wakes | Zombies ahead. Take them out. | Впереди зомби. Устрани их. |
| 3 | (no longer said: 20 took its place) | Horde inbound, heading straight for you. Stop it before it reaches the base. | Орда идёт прямо на тебя. Останови её до базы. |
| 4 | the horde dead, the super mob's magnet on the ground | Magnet dropped. Take it. It pulls in every crystal around you. | Упал магнит. Возьми, он соберёт все кристаллы. |
| 5 | first perks, once every crystal is in (only the drone can be picked, after her) | Crystals buy skills. Pick one. Make it count. | Кристаллы дают навыки. Выбери один. Не ошибись. |
| 21 | the drone taken: the checkpoint opens | Keep moving. Head for the parking lot. | Продвигайся дальше, к парковке. |
| 6 | at the parking lot: its crowd seen, the bomb on the ground | There are a lot of them on the parking lot. Don't take them head-on. There's a bomb on the ground ahead. Use it. | На парковке их много. В лоб не лезь. Впереди на земле бомба. Используй её. |
| 7 | the crowd dead with the bomb taken, a medkit dropped | Good work. One of them dropped a medkit. Pick it up and patch yourself up. | Хорошая работа. С одного выпала аптечка. Подбери и подлатайся. |
| 22 | the crowd dead, the bomb left lying | I see you don't take the easy way. Grab the medkit and patch yourself up. | Вижу, лёгких путей ты не ищешь. Возьми аптечку и восстанови здоровье. |
| 8 | Nova drops supplies after the medkit is picked up | Dropping supplies before you go into the building. Grab them. | Сбрасываю припасы перед тем, как ты войдёшь в здание. Забирай. |
| 9 | the drop opened: the clover (its take waits for her; the perk bar links it to the drone) | I sent you a clover. Every attack skill has a partner, and the clover is your drone's. Max out the drone with it and it turns into something worse. | Отправила тебе клевер. У каждого боевого навыка есть напарник, клевер — напарник твоего дрона. Прокачай дрон до конца вместе с ним, и он станет страшнее. |
| 10 | the drop taken: the office door opens, a ring glows on it | Entrance is clear. Walt is inside. Go in. Eyes open. | Вход свободен. Уолт внутри. Заходи. Смотри в оба. |
| 23 | inside, as Copper's line 2 ends (he stood still while he spoke; now free: the crowd comes when he walks or shoots) | Be careful. You can do this. | Будь осторожен. Ты справишься. |
| 11 | boss | Big one coming. Hold the line. | Идёт большой. Держи рубеж. |
| 12 | victory | Area's secure, and Walt is safe. Good work, Copper. Welcome to NEAR Base. This is home now. | Зона зачищена, Уолт в безопасности. Хорошая работа, Коппер. Добро пожаловать на базу NEAR. Теперь это дом. |
| 13 | the cleaver sold to Walt and no wallet connected yet: plays as the choice "Connect a NEAR account" / "Create a wallet" appears | One more thing. Connect a NEAR wallet. Without it, your gear doesn't follow you. | И ещё. Подключи кошелёк NEAR. Без него снаряжение за тобой не пойдёт. |
| 14 | mission 2 (the Mushroom Monster is the main threat) | The Mushroom Monster in the suburbs is our biggest threat now. Its spores are spreading toward the base. Kill it. Bring back what it drops, plus any planks and screws you find. The range doesn't build itself. | Грибной монстр в пригороде — сейчас наша главная угроза. Его споры ползут к базе. Убей его. Принеси его добычу и все доски и саморезы, что найдёшь. Полигон сам себя не построит. |
| 15 | missions 2 and 3: the Evac button opens (4:00; pressed, out in 10 s) | Evac is open. Leave with what you've got, or stay and finish the job. Decide. | Эвакуация открыта. Уходи с тем, что есть, или останься и доделай. Решай. |
| 16 | the Mushroom Monster killed: its spores infect Copper | The Monster is down. But the spores got you, Copper. You're infected. | Монстр готов. Но споры тебя достали, Коппер. Ты заражён. |
| 17 | at NEAR Base once, after mission 2 is won and before mission 3 (Copper infected; `hub.js`) | Before the outbreak the lab ran an antivirus program. Go there and find it. It's your only cure. | До вспышки в лаборатории разрабатывали антивирус. Иди туда и найди его. Это твоё единственное лекарство. |
| 18 | range built | Range is open. Test your weapons there before you take them outside. | Полигон открыт. Проверяй оружие там, а не в поле. |
| 25 | NEAR Base, the first talk with her after the cleaver is sold (the base tutorial: `hub.js`) | Copper, to get stronger you need upgrades, for you and for your weapons. For that the base needs a generator, a workbench and a medbay. Start with the generator. Find the parts on a raid, or buy them from Walt if he has them. | Коппер, чтобы становиться сильнее, нужны улучшения — и тебе, и оружию. Для этого на базе нужны генератор, верстак и медпункт. Начнём с генератора. Детали добудешь в рейде или купишь у Уолта, если у него есть. |
| 26 | the generator stands (the lights come on) | Good, we have power. Next, the workbench. Clear the room first. Walk up to the junk and hit the gear. | Есть свет. Дальше верстак. Сначала расчисти комнату: подойди к хламу и жми на шестерёнку. |
| 27 | the alcove's junk cleared | Room's clear. The workbench needs nuts and bolts, screws, duct tape, a plank and some scrap metal. Check Walt's shelf. If he's out, the suburb has them. | Комната чистая. Для верстака нужны гайки и болты, саморезы, изолента, доска и немного металлолома. Загляни к Уолту. Если нет — поищи в пригороде. |
| 28 | the workbench stands | The workbench is up. You upgrade your weapons there. New guns you buy from Walt. Next, the medbay. Clear the glass room first. | Верстак готов. Здесь улучшаешь оружие. Новые стволы покупай у Уолта. Дальше медпункт. Сначала расчисти стеклянную комнату. |
| 29 | the glass room cleared | The glass room is clear. The medbay needs two antiseptics and three bandages. | Стеклянная комната свободна. Для медпункта нужны два антисептика и три бинта. |
| 30 | the medbay stands: the tutorial is over | The medbay works. Now you can upgrade yourself too. The rest of the base is yours to build, Copper. You know how. | Медпункт работает. Теперь можешь качать и себя. Остальную базу строй сам, Коппер. Ты знаешь как. |
| 31 | in a suburb raid, the first boss down drops the tutorial's parts (once per building) | That one dropped the parts we need for the base. Grab them. | С него выпали детали для базы. Подбирай. |
| 32 | the hero dead, after his last words (Copper's 3 or 4): over the radio, the results wait for it | Copper, do you copy? | Коппер, ты меня слышишь? |

Files: `node --env-file=.env.local gen/voice.mjs [ids]` makes `art/voice/raw/nova_NN.mp3`; `python gen/radio.py` puts them through the radio
(the band of a handheld radio, compression, a little overdrive, the channel's hiss, the key's click and the squelch) into
`live/audio/voice/nova_01.mp3` … `nova_31.mp3`, all at one loudness. A line without its file shows the subtitle alone.
Subtitle keys: `voice.nova.1` … `voice.nova.31`.

## Copper

The hero answers Nova over the radio (mission 1, 2026-11-09). ElevenLabs, the library voice "Odd Todd - Nerdy, Pompous
Professor" (SDARFhQygpPvpLh7Ad1B, the human's pick); heard as the hero himself: no radio effect. His name on the
subtitles (`voice.name.copper`; a face when `assets/por_copper.png` exists).

Tone: calm, a soldier's radio manner ("Roger that", as in a shooter game); short; he never shouts (the human, 2026-11-10).

| # | Trigger | English | Russian subtitle |
| --- | --- | --- | --- |
| 1 | mission 1 begins, as Nova's 19 ends: he is free to walk as he says it | Roger that, Nova. Moving out. | Принял, Нова. Выдвигаюсь. |
| 2 | inside the office, the crowd wandering the hall; Nova's 23 answers | Nova, I see Walt. And there are a hell of a lot of zombies in here. Starting the sweep. | Нова, вижу Уолта. И тут чертовски много зомби. Начинаю зачистку. |
| 3 | the hero dead: one of 3 and 4 at random, over the radio (the human's, 2026-11-12; `ui.js` sync), then Nova's 32 | Nova… *(coughs)* | Нова… |
| 4 | as 3 | Nova, I'm hit. *(coughs)* | Нова, я трёхсотый. |

Files: `gen/voice.mjs` → `art/voice/raw/copper_NN.mp3` → `python gen/radio.py` (the trim and the level) →
`live/audio/voice/copper_NN.mp3`. Subtitle keys:
`voice.copper.1`, `voice.copper.2`.

## Walt

ElevenLabs, the library voice "Romulus - Deep, Mysterious" (7lJ2JuXZKHyck5zlS7XQ, the human's pick). He talks to
Copper face to face: no radio effect.

Tone: warm, practical, few words.

| # | Trigger | English | Russian subtitle |
| --- | --- | --- | --- |
| 1 | first time at NEAR Base, after Nova's line 12; then the task "walk up to Walt" appears | Hey Copper, thanks for getting me out. I've got my old contacts back, so now I can sell you all sorts of things and buy what you bring. Come over if you need anything. | Эй, Коппер, спасибо, что спас меня. Я наладил старые связи, теперь смогу продавать тебе разные вещи и покупать то, что принесёшь. Подходи, если что-то нужно. |
| 2 | his window opens with the cleaver in the stash: the sale's lesson (`market.js`: the window stays until it is sold) | Let's see what you brought. That cleaver, I'll take it. Pick it on the left, then hold Sell. | Ну, показывай, что принёс. Тесак я заберу. Выбери его слева и зажми «Продать». |
| 3 | the cleaver sold: the lesson is over | Pleasure doing business. Now go see Nova, she was asking about you. | Приятно иметь с тобой дело. А теперь иди к Нове, она про тебя спрашивала. |

Files: `gen/voice.mjs` → `art/voice/raw/walt_01.mp3` → `python gen/radio.py` (only the trim and the level for him) → `live/audio/voice/walt_01.mp3`.
Subtitle keys: `voice.walt.1` … `voice.walt.3`. Lines 2–3 and Nova's 25–31 were made 2026-11-11 (English; in the other
languages under their subtitles until recorded there).

## Ukrainian recordings (the human's, 2026-11-10; the rest made 2026-11-12)

The human made the first Ukrainian lines in ElevenLabs and worded them freely (the Ukrainian subtitles follow these
recordings, not the English). ElevenLabs voices: Nova `JOQst3wrnXwBfeTEW2ts`, Copper `11JUpgNlQsWfppULB2T8`, Walt
`WtDqMP4cPOGB6kDiLZgi` (the human, 2026-11-12).

Recorded (36, every line said in the game): the human's nova 1, 19, 24, 20, 4, 5, 21, 6, 7, 22, 8, 9, 23, 11, 13, 32;
copper 1–4 (copper 1 and 2 recorded again 2026-11-12: «Плюс. Вирушаю.», «Ново, бачу Уолта…»; 3 and 4 the hero's last words,
the English made after them); walt 1. Made 2026-11-12 (the human: "voice all the missing lines") with `node --env-file=.env.local gen/voice.mjs --lang uk
<ids>`: the Ukrainian subtitle in the speaker's Ukrainian voice, the English line's audio tags before the same sentences:
walt 2, 3; nova 14–17, 25–31; and nova 10, 12 again (the human's said «Волт»; the subtitles say «Уолт» since
2026-11-12; the human's first ones, with copper 1 and 2, kept in `art/voice/raw/uk_human_2026-11-10/`). Not said in the game, not made: nova 2, 3, 18.

Files: the mp3 → `art/voice/raw/uk/<who>_NN.mp3` → `python gen/radio.py uk/nova_01 …`
(Nova's through the radio, Copper's and Walt's only the trim and the level) → `live/audio/voice/uk/<who>_NN.mp3`. A new
line recorded is added to `DUB.uk` in `live/voice.js` (the lines not there are played in English). Every line, its texts
and recordings: `live/voices.html` (the voice lines page).
