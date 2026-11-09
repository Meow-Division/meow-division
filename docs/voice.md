# Voice lines: Nova and Walt (English is the source; subtitles in four languages follow it exactly)

Status: final text (the human, 2026-11-08) except Nova's lines 14, 16 and 17 (the new story: drafts). Recorded (2026-11-08):
Nova's 1–5 and 10–12. Lines 5 and 12 were recorded with other words than the table had then; the table and the subtitles
now follow the recordings. Line 5's text before that was "Crystals buy skills. Take the drone so I can help you remotely."
(mission 1 lets only the drone be picked there): a new recording can bring it back, with its subtitles.
Changes to a line are the human's call.
Rows are in the order a player hears them. Build triggers against the ids (`nova.N`, `walt.N`), not the wording.

## Nova (recorded by the human in English, radio effect added in post)

Tone: strict, short, imperative. No jokes, no exclamation marks.

| # | Trigger | English | Russian subtitle |
| --- | --- | --- | --- |
| 1 | after the intro | Copper, this is Nova. Orders stand: clear the base and bring our man Walt out alive. Supplies are at the drop zone. Move out. | Коппер, это Нова. Приказ в силе: зачистить базу и вывести Уолта живым. Припасы на месте высадки. Вперёд. |
| 2 | crate opened | Armor, a medkit, a better pistol. That's all you get. Gear up. | Броня, аптечка, пистолет получше. Это всё. Снаряжайся. |
| 3 | past the line in front of the van: the horde at the checkpoint wakes | Horde inbound, heading straight for you. Stop it before it reaches the base. | Орда идёт прямо на тебя. Останови её до базы. |
| 4 | the horde dead, the super mob's magnet on the ground | Magnet dropped. Take it. It pulls in every crystal around you. | Упал магнит. Возьми, он соберёт все кристаллы. |
| 5 | first perks (only the drone can be picked) | Crystals buy skills. Pick one. Make it count. | Кристаллы дают навыки. Выбери один. Не ошибись. |
| 6 | guard at the entrance seen, bomb on the ground | Guards at the entrance. Don't take them head-on. There's a bomb on the ground ahead. Use it. | У входа охрана. В лоб не лезь. Впереди на земле бомба. Используй её. |
| 7 | guards blown up, a medkit dropped | Good work. One of them dropped a medkit. Pick it up and patch yourself up. | Хорошая работа. С одного выпала аптечка. Подбери и подлатайся. |
| 8 | Nova drops supplies after the medkit is picked up | Supplies inbound. Grab the drop. | Сбрасываю припасы. Забирай. |
| 9 | the clover from the drop picked up (the perk bar links it to the drone) | I sent you a clover. Every attack skill has a partner, and the clover is your drone's. Max out the drone with it and it turns into something worse. | Отправила тебе клевер. У каждого боевого навыка есть напарник, клевер — напарник твоего дрона. Прокачай дрон до конца вместе с ним, и он станет страшнее. |
| 10 | the drop picked up: the office door opens | Entrance is clear. Walt is inside. Go in. Eyes open. | Вход свободен. Уолт внутри. Заходи. Смотри в оба. |
| 11 | boss | Big one coming. Hold the line. | Идёт большой. Держи рубеж. |
| 12 | victory | Area secure, and Walt is safe. Good work, Copper. Welcome to NEAR Base. This is home now. | Зона зачищена, Уолт в безопасности. Хорошая работа, Коппер. Добро пожаловать на базу NEAR. Теперь это дом. |
| 13 | the cleaver sold to Walt and no wallet connected yet: plays as the choice "Connect a NEAR account" / "Create a wallet" appears | One more thing. Connect a NEAR wallet. Without it, your gear doesn't follow you. | И ещё. Подключи кошелёк NEAR. Без него снаряжение за тобой не пойдёт. |
| 14 | mission 2 (the Shroom Hulk is the main threat) | The Shroom Hulk in the suburbs is our biggest threat now. Its spores are spreading toward the base. Kill it. Bring back what it drops, plus any planks and screws you find. The range doesn't build itself. | Грибной толстяк в пригороде — сейчас наша главная угроза. Его споры ползут к базе. Убей его. Принеси его добычу и все доски и саморезы, что найдёшь. Полигон сам себя не построит. |
| 15 | evac open (stand on the point for 10 s to leave) | Evac is open. Leave with what you've got, or stay and finish the job. Decide. | Эвакуация открыта. Уходи с тем, что есть, или останься и доделай. Решай. |
| 16 | the Shroom Hulk killed: its spores infect Copper | Hulk is down. But the spores got you, Copper. You're infected. | Толстяк готов. Но споры тебя достали, Коппер. Ты заражён. |
| 17 | mission 3 (back at the base, infected) | Before the outbreak the lab ran an antivirus program. Go there and find it. It's your only cure. | До вспышки в лаборатории разрабатывали антивирус. Иди туда и найди его. Это твоё единственное лекарство. |
| 18 | range built | Range is open. Test your weapons there before you take them outside. | Полигон открыт. Проверяй оружие там, а не в поле. |

Files: the recordings as given in `art/voice/raw/nova_NN.mp3`; `python gen/radio.py` puts them through the radio
(the band of a handheld radio, compression, a little overdrive, the channel's hiss, the key's click and the squelch) into
`live/audio/voice/nova_01.mp3` … `nova_18.mp3`, all at one loudness. A line without its file shows the subtitle alone.
Subtitle keys: `voice.nova.1` … `voice.nova.18`.

## Walt

Recorded by the human in English, a different voice from Nova's. He talks to Copper face to face: no radio effect.

Tone: warm, practical, few words.

| # | Trigger | English | Russian subtitle |
| --- | --- | --- | --- |
| 1 | first time at NEAR Base, after Nova's line 12; then the task "walk up to Walt" appears | Hey Copper, thanks for getting me out. I've got my old contacts back, so now I can sell you all sorts of things and buy what you bring. Come over if you need anything. | Эй, Коппер, спасибо, что спас меня. Я наладил старые связи, теперь смогу продавать тебе разные вещи и покупать то, что принесёшь. Подходи, если что-то нужно. |

Files: `art/voice/raw/walt_01.mp3` → `python gen/radio.py` (only the trim and the level for him) → `live/audio/voice/walt_01.mp3`.
Subtitle keys: `voice.walt.1`.
