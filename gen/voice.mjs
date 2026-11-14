// gen/voice.mjs — the voice lines made with ElevenLabs (docs/voice.md): each line's English with how it is said as audio
// tags ([serious], [matter-of-fact] …), in its speaker's voice — Nova: the library's "Lauren - Friendly, Comforting and
// Soft"; Copper and Walt: the voices the human picked (2026-11-10) — model eleven_v4, into art/voice/raw/<who>_NN.mp3.
// `python gen/radio.py` then makes the game's files (live/audio/voice). A line's words without its tags must be its
// English subtitle (live/lang_en.js voice.<id>): checked first, a line that differs is not made.
//   node --env-file=.env.local gen/voice.mjs [ids…]   (no ids: every line; ids like nova.12 copper.1)
//   --keep   lines whose raw file is there already are left alone; --check: only the words checked, nothing made; --dry:
//   what would be said, printed; --stt <file.mp3 …>: what a recording says
//   --lang uk   the Ukrainian (2026-11-12, Walt's Ukrainian voice given): each
//   line's Ukrainian subtitle (live/lang_uk.js voice.<id>) in its speaker's Ukrainian voice (UK below; Nova's and Copper's
//   the ones the human made the first Ukrainian lines with, docs/voice.md), the English line's audio tags put before the
//   same sentences (when the sentences don't pair up, its first tag before all), into art/voice/raw/uk/<who>_NN.mp3; then
//   `python gen/radio.py uk/nova_25 …` and the line in live/voice.js DUB.uk
//   --lang es   the Spanish (2026-11-13): ES_LINES, as the Russian, in the Spanish voices (ES), into art/voice/raw/es/
//   --lang ru   the Russian (the human's, 2026-11-12, with the voices below): RU_LINES, the Russian subtitle with tags in
//   Russian that say what is going on and how it is said (the human's way: "[рассказывает] … [с небольшим сожалением] …"),
//   the human's settings (stability 0.5, similarity 0.75), into art/voice/raw/ru/; then `python gen/radio.py ru/nova_01 …`
// The key: ELEVENLABS_API_KEY, from .env.local (never in the code, never printed). A library voice not in the account is
// said straight from the library; --add adds it to the account first (voices.share: the key needs voices_write).
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'),
  RAW = join(ROOT, 'art/voice/raw'),
  MODEL = 'eleven_v4';

// the speakers: voice id, its library name (to add it when the account lacks it), the voice settings (v4 takes only
// stability and similarity: the tags carry the rest)
const VOICES = {
  nova: {
    id: 'DODLEQrClDo8wCz460ld',
    name: 'Lauren - Friendly, Comforting and Soft',
    stability: 0.5,
    similarity: 0.75,
  },
  copper: { id: 'SDARFhQygpPvpLh7Ad1B', name: 'Odd Todd - Nerdy, Pompous Professor', stability: 0.4, similarity: 0.75 },
  walt: { id: '7lJ2JuXZKHyck5zlS7XQ', name: 'Romulus - Deep, Mysterious', stability: 0.5, similarity: 0.75 },
};

// the Ukrainian voices (--lang uk) and the Russian (--lang ru)
const UK = { nova: 'JOQst3wrnXwBfeTEW2ts', copper: '11JUpgNlQsWfppULB2T8', walt: 'WtDqMP4cPOGB6kDiLZgi' };
const RU = { nova: 'D5RRIJYa9pFwxiSpbGbR', copper: '6A9D8WSMm4rFsg2DWFeE', walt: 'q5RNAd4899271dg9W2K8' };

// the Russian lines: the subtitle (live/lang_ru.js) with what is happening and how it is said, in Russian
const RU_LINES = {
  'nova.1':
    '[по рации, строго, отдаёт приказ] Коппер, это Нова. Приказ в силе: зачистить базу и вывести Уолта живым. [деловито] Припасы на месте высадки. [коротко] Вперёд.',
  'nova.19': '[по рации, деловито, Коппер на позиции] Ты на месте. Припасы для миссии у фургона. Забери их.',
  'copper.1': '[спокойно, отвечает на приказ] Принял, Нова. Выдвигаюсь.',
  'nova.24': '[быстро объясняет, по делу] Это твои навыки. На каждом уровне бери новый или улучшай тот, что есть.',
  'nova.20': '[настороженно, заметила врага] Впереди зомби. [твёрдо] Уничтожь их.',
  'nova.4': '[деловито, подсказывает] Магнит выпал. Подбери, он притянет все кристаллы вокруг.',
  'nova.5': '[быстро объясняет] Кристаллы дают навыки. Выбери один. [серьёзно] Не ошибись.',
  'nova.21': '[деловито, ведёт дальше] Продвигайся дальше, к парковке.',
  'nova.6':
    '[осторожно, предупреждает об опасности] На парковке их много. В лоб не лезь. [подсказывает] Впереди на земле бомба. Используй её.',
  'nova.7': '[с одобрением] Хорошая работа. [деловито] С одного выпала аптечка. Подбери и подлатайся.',
  'nova.22':
    '[с лёгкой иронией, но одобрительно] Вижу, лёгких путей ты не ищешь. [деловито] Возьми аптечку и подлечись.',
  'nova.8': '[деловито, по рации] Сбрасываю припасы, пока ты не зашёл в здание. Забирай.',
  'nova.9':
    '[объясняет, по делу] Отправила тебе клевер. У каждого боевого навыка есть напарник, клевер — напарник твоего дрона. [с интересом] Прокачай дрон до конца вместе с ним, и он станет сильнее.',
  'nova.10': '[деловито, путь открыт] Вход свободен. Уолт внутри. Заходи. [серьёзно, предупреждает] Смотри в оба.',
  'copper.2':
    '[тихо, спокойно, докладывает по рации] Нова, вижу Уолта. [деловито] Зомби тут до чёрта. [собранно] Начинаю зачистку.',
  'nova.23': '[с тревогой] Будь осторожен. [поддерживает] Ты справишься.',
  'nova.11': '[срочно, по рации, на героя идёт босс] На тебя идёт Мясник. [твёрдо] Держи рубеж.',
  'nova.12':
    '[серьёзно, с облегчением, миссия выполнена] Зона зачищена, Уолт в безопасности. Хорошая работа, Коппер. [теплее] Добро пожаловать на базу NEAR. Теперь это твой дом.',
  'walt.1':
    '[с облегчением, благодарит спасителя] Эй, Коппер, спасибо, что вытащил меня. [тепло] Я поднял старые связи, так что теперь достану тебе что угодно и куплю всё, что принесёшь. [дружелюбно] Заходи, если что понадобится.',
  'walt.2':
    '[дружелюбно, торговец встречает покупателя] Ну, показывай, что принёс. Тесак я заберу. [по-деловому объясняет] Выбери его слева и зажми «Продать».',
  'walt.3':
    '[довольно, сделка прошла] Приятно иметь с тобой дело. [непринуждённо] А теперь сходи к Нове, она тебя искала.',
  'nova.13': '[деловито] И ещё. Подключи кошелёк NEAR. [серьёзно] Без него снаряжение не сохранится.',
  'nova.25':
    '[бодро, ставит задачу] Коппер, чтобы становиться сильнее, нужны улучшения — и тебе, и оружию. [деловито] Для этого на базе нужны генератор, верстак и медпункт. Начнём с генератора. Детали добудешь в рейде или купишь у Уолта, если у него есть.',
  'nova.26':
    '[довольно, зажёгся свет] Есть свет. [бодро] Дальше верстак. Сначала расчисти комнату: подойди к хламу и жми на шестерёнку.',
  'nova.27':
    '[бодро] Комната расчищена. [деловито перечисляет] Для верстака нужны гайки и болты, саморезы, изолента, доска и немного металлолома. Загляни к Уолту. Если у него нет — поищи в пригороде.',
  'nova.28':
    '[с удовлетворением] Верстак готов. [деловито] Здесь улучшаешь оружие. Новые стволы покупай у Уолта. [бодро] Дальше медпункт. Сначала расчисти стеклянную комнату.',
  'nova.29': '[бодро] Стеклянная комната свободна. [деловито] Для медпункта нужны два антисептика и три бинта.',
  'nova.30':
    '[тепло, обучение закончено] Медпункт работает. Теперь можешь качать и себя. [уверенно] Остальную базу строй сам, Коппер. Ты знаешь как.',
  'nova.31': '[настороженно, по рации] С него выпали детали для базы. [твёрдо] Подбирай.',
  'nova.14':
    '[серьёзно, ставит задачу] Грибной монстр в пригороде — сейчас наша главная угроза. [с тревогой] Его споры ползут к базе. [твёрдо] Убей его. [деловито] Принеси всё, что с него выпадет, и все доски и саморезы, что найдёшь. [сухо] Полигон сам себя не построит.',
  'nova.15':
    '[срочно] Эвакуация открыта. [серьёзно] Уходи с тем, что есть, или останься и закончи дело. [твёрдо] Решай.',
  'nova.16': '[с облегчением] Монстр мёртв. [с тревогой] Но споры до тебя добрались, Коппер. [серьёзно] Ты заражён.',
  'nova.17':
    '[рассказывает] До вспышки в лаборатории разрабатывали вакцину. [твёрдо] Иди туда и найди её. [с небольшим сожалением] Это твоё единственное лекарство.',
  'copper.3': '[тяжело ранен, слабым голосом, по рации] Нова… [кашляет]',
  'copper.4': '[тяжело ранен, слабым сдавленным голосом, по рации] Нова, я трёхсотый. [кашляет]',
  'nova.32': '[встревоженно, срочно, по рации] Коппер, ты меня слышишь?',
  'nova.33':
    '[деловито, по рации, подсказывает] Не хватает монет? Расходники найдёшь в пригороде. [твёрдо, ставит задачу] Иди и зачисти его.',
  'nova.34':
    '[деловито, подсказывает] Пока расчищается стеклянная комната, зайди к Уолту. [бодро] У него есть стволы получше пистолета. Возьми себе один.',
  'nova.35': '[с одобрением] Хороший выбор. [деловито] Теперь неси ствол на верстак и улучши его.',
  'nova.36':
    '[с облегчением, тепло, герой вылечился] Вакцина подействовала. [искренне] Я очень рада, что ты её нашёл, Коппер. [уверенно] Ты снова в строю.',
};

// the lines, in the order a player hears them (nova.3 and nova.2 are no longer said: not made). Nova is on a mission:
// brisk, never slow (the human, 2026-11-10)
// the Spanish lines (2026-11-13): the subtitle (live/lang_es.js) with what is happening and how it is said, in Spanish
const ES = { nova: 'yiWEefwu5z3DQCM79clN', copper: 'E3gU1I86D0XjvRrEszPm', walt: 'orF2qy9215xjwqqxqsWW' };
const ES_LINES = {
  'nova.1':
    '[por radio, seria, da una orden] Copper, aquí Nova. Las órdenes no cambian: limpia la base y saca a Walt con vida. [con tono práctico] Tienes suministros en el punto de entrega. [firme] En marcha.',
  'nova.19':
    '[por radio, ágil] Ya estás en posición. [con tono práctico] Tus suministros están junto a la camioneta. Recógelos.',
  'copper.1': '[tranquilo] Recibido, Nova. En marcha.',
  'nova.24':
    '[explica rápido, al grano] Estas son tus habilidades. Con cada nivel, elige una nueva o mejora una que ya tengas.',
  'nova.20': '[alerta] Zombis al frente. [firme] Acaba con ellos.',
  'nova.4': '[con tono práctico, da una pista] Cayó un imán. Recógelo. Atrae todos los cristales que tengas cerca.',
  'nova.5': '[explica rápido] Con los cristales consigues habilidades. Elige una. [seria] Elige bien.',
  'nova.21': '[con tono práctico, lo guía] No te detengas. Avanza hacia el estacionamiento.',
  'nova.6':
    '[con cautela, advierte del peligro] El estacionamiento está lleno de ellos. [seria] No te lances de frente. [da una pista] Más adelante hay una bomba en el suelo. Úsala.',
  'nova.7': '[con aprobación] Buen trabajo. [con tono práctico] Uno de ellos soltó un botiquín. Recógelo y cúrate.',
  'nova.22':
    '[impresionada, con una leve sonrisa] Ya veo que lo tuyo no es el camino fácil. [con tono práctico] Recoge el botiquín y cúrate.',
  'nova.8': '[con tono práctico] Te envío suministros antes de que entres al edificio. Recógelos.',
  'nova.9':
    '[explica, al grano] Te envié un trébol. Cada habilidad de ataque tiene su pareja, y el trébol es la de tu dron. [con interés] Sube el dron al máximo con él y se volverá mucho más letal.',
  'nova.10': '[con tono práctico] Entrada despejada. Walt está dentro. Entra. [seria] Mantente alerta.',
  'copper.2':
    '[tranquilo, en voz baja] Nova, tengo a Walt a la vista. [con tono práctico] Y esto está infestado de zombis. [concentrado] Comienzo la limpieza.',
  'nova.23': '[con preocupación] Ten cuidado. [le da ánimo] Tú puedes.',
  'nova.11': '[con urgencia] Viene uno grande. [firme] Mantén la posición.',
  'nova.12':
    '[seria, con alivio] Zona asegurada y Walt está a salvo. Buen trabajo, Copper. [con tono práctico] Bienvenido a la Base NEAR. Ahora este es tu hogar.',
  'walt.1':
    '[aliviado, agradecido] Hola, Copper, gracias por sacarme de ahí. [cálido] Recuperé mis viejos contactos, así que puedo venderte de todo y comprarte lo que traigas. [amable] Pásate cuando necesites algo.',
  'walt.2':
    '[amable, curioso] A ver qué trajiste. Esa cuchilla me la quedo. [con tono práctico] Selecciónala a la izquierda y mantén presionado Vender.',
  'walt.3': '[cálido] Un placer hacer negocios contigo. [relajado] Ahora ve a ver a Nova, anda preguntando por ti.',
  'nova.13':
    '[con tono práctico] Una cosa más. Conecta una billetera NEAR. [seria] Sin ella, no conservarás tu equipo.',
  'nova.25':
    '[ágil, explica el plan] Copper, para hacerte más fuerte necesitas mejoras, para ti y para tus armas. [con tono práctico] Y para eso la base necesita un generador, un banco de trabajo y una enfermería. Empieza por el generador. Consigue las piezas en una incursión o cómpraselas a Walt, si las tiene.',
  'nova.26':
    '[satisfecha] Bien, ya hay energía. [ágil] Ahora, el banco de trabajo. Primero despeja la sala: acércate a los trastos y presiona el engranaje.',
  'nova.27':
    '[ágil] Sala despejada. [con tono práctico, enumera] Para el banco de trabajo hacen falta tuercas y pernos, tornillos, cinta adhesiva, un tablón y algo de chatarra. Revisa el estante de Walt. Si no tiene, los encontrarás en los suburbios.',
  'nova.28':
    '[satisfecha] El banco de trabajo está listo. [con tono práctico] Ahí mejoras tus armas. Las nuevas se las compras a Walt. [ágil] Ahora, la enfermería. Primero despeja la sala de cristal.',
  'nova.29':
    '[ágil] La sala de cristal está despejada. [con tono práctico] Para la enfermería hacen falta dos antisépticos y tres vendas.',
  'nova.30':
    '[cálida] La enfermería ya funciona. Ahora también puedes mejorarte a ti mismo. [con confianza] El resto de la base lo construyes tú, Copper. Ya sabes cómo.',
  'nova.31': '[alerta] Ese soltó las piezas que necesitamos para la base. [firme] Recógelas.',
  'nova.14':
    '[seria, plantea la misión] El Monstruo Hongo de los suburbios es ahora nuestra mayor amenaza. [con preocupación] Sus esporas avanzan hacia la base. [firme] Elimínalo. [con tono práctico] Trae lo que suelte, y todos los tablones y tornillos que encuentres. [seca] El campo de tiro no se va a construir solo.',
  'nova.15':
    '[con urgencia] Evacuación disponible. [seria] Sal con lo que tienes o quédate a terminar el trabajo. [firme] Tú decides.',
  'nova.16':
    '[con alivio] El Monstruo cayó. [con preocupación] Pero las esporas te alcanzaron, Copper. [seria] Estás infectado.',
  'nova.17':
    '[seria] Antes del brote, el laboratorio estaba desarrollando una vacuna. [firme] Ve y encuéntrala. [en voz baja] Es tu única cura.',
  'copper.3': '[débil, con esfuerzo] Nova… [tose]',
  'copper.4': '[débil, con esfuerzo] Nova, me dieron. [tose]',
  'nova.32': '[con urgencia, preocupada] Copper, ¿me copias?',
  'nova.33':
    '[con tono práctico, por radio] ¿Te faltan monedas? En los suburbios hay suministros. [firme] Ve y límpialos.',
  'nova.34':
    '[con tono práctico] Mientras se despeja la sala de cristal, pasa a ver a Walt. [ágil] Tiene armas mejores que tu pistola. Consíguete una.',
  'nova.35': '[con aprobación] Buena elección. [con tono práctico] Ahora llévala al banco de trabajo y mejórala.',
  'nova.36':
    '[aliviada, con calidez] La vacuna funcionó. [sincera] Me alegra mucho que la encontraras, Copper. [segura] Estás de vuelta en la pelea.',
};

const LINES = {
  'nova.1':
    '[serious] Copper, this is Nova. [firm] Orders stand: clear the base and bring our man Walt out alive. [matter-of-fact] Supplies are at the drop zone. Move out.',
  'nova.19': "[brisk] You're in position. [matter-of-fact] The mission supplies are by the van. Take them.",
  'copper.1': '[calm] Roger that, Nova. Moving out.',
  'nova.24': '[brisk, fast-paced] These are your skills. Each level, take a new one or upgrade one you have.',
  'nova.20': '[alert] Zombies ahead. [firm] Take them out.',
  'nova.4': '[matter-of-fact] Magnet dropped. Take it. It pulls in every crystal around you.',
  'nova.5': '[brisk] Crystals buy skills. Pick one. [serious] Make it count.',
  'nova.21': '[matter-of-fact] Keep moving. Head for the parking lot.',
  'nova.6':
    "[cautious] There are a lot of them in the parking lot. [serious] Don't take them head-on. [matter-of-fact] There's a bomb on the ground up ahead. Use it.",
  'nova.7': '[warm] Good work. [matter-of-fact] One of them dropped a medkit. Pick it up and patch yourself up.',
  'nova.22': '[impressed] I see you like doing things the hard way. [warm] Grab the medkit and patch yourself up.',
  'nova.8': '[matter-of-fact] Dropping supplies before you go into the building. Grab them.',
  'nova.9':
    "[matter-of-fact] I sent you a clover. Every attack skill has a partner, and the clover is your drone's. [intrigued] Max out the drone with it and it turns into something far deadlier.",
  'nova.10': '[matter-of-fact] Entrance is clear. Walt is inside. Go in. [serious] Eyes open.',
  'copper.2':
    "[calm, quiet] Nova, I've got eyes on Walt. [matter-of-fact] And there's a hell of a lot of zombies in here. [focused] Starting the sweep.",
  'nova.23': '[concerned] Be careful. [reassuring] You can do this.',
  'nova.11': '[urgent] Big one coming. [firm] Hold the line.',
  'nova.12':
    "[serious] Area's secure, and Walt is safe. Good work, Copper. [matter-of-fact] Welcome to NEAR Base. This is home now.",
  'walt.1':
    "[relieved] Hey Copper, thanks for getting me out. [warm] I've got my old contacts back, so I can sell you all kinds of gear and buy whatever you bring in. [friendly] Stop by if you need anything.",
  'nova.13':
    "[matter-of-fact] One more thing. Connect a NEAR wallet. [serious] Without it, your gear won't carry over.",
  'nova.14':
    "[serious] The Mushroom Monster in the suburbs is our biggest threat now. [concerned] Its spores are spreading toward the base. [firm] Kill it. [matter-of-fact] Bring back what it drops, plus any planks and screws you find. [dry] The range doesn't build itself.",
  'nova.15': "[urgent] Evac is open. [serious] Leave with what you've got, or stay and finish the job. [firm] Decide.",
  'nova.16': "[relieved] The Monster is down. [concerned] But the spores got you, Copper. [serious] You're infected.",
  'nova.17':
    "[serious] Before the outbreak, the lab was developing a vaccine. [firm] Go there and find it. [softly] It's your only cure.",
  'nova.18': '[pleased] Range is open. [matter-of-fact] Test your weapons there before you take them outside.',
  // NEAR Base's tutorial (2026-11-11: hub.js, market.js lesson): Walt teaches the cleaver's sale, Nova the buildings
  'walt.2':
    "[friendly] Let's see what you brought. That cleaver, I'll take it. [matter-of-fact] Select it on the left, then hold Sell.",
  'walt.3': "[warm] Pleasure doing business. [casual] Now go see Nova, she's been asking for you.",
  'nova.25':
    '[brisk] Copper, to get stronger you need upgrades, for you and for your weapons. [matter-of-fact] For that the base needs a generator, a workbench and a medbay. Start with the generator. Find the parts on a raid, or buy them from Walt if he has them.',
  'nova.26':
    '[pleased] Good, we have power. [brisk] Next, the workbench. Clear the room first. Walk up to the junk and hit the gear.',
  'nova.27':
    "[brisk] Room's clear. [matter-of-fact] The workbench needs nuts and bolts, screws, duct tape, a plank and some scrap metal. Check Walt's shelf. If he's out, you'll find them in the suburbs.",
  'nova.28':
    '[satisfied] The workbench is up. [matter-of-fact] You upgrade your weapons there. New guns you buy from Walt. [brisk] Next, the medbay. Clear the glass room first.',
  'nova.29': '[brisk] The glass room is clear. [matter-of-fact] The medbay needs two antiseptics and three bandages.',
  'nova.30':
    '[warm] The medbay is up and running. Now you can upgrade yourself too. [confident] The rest of the base is yours to build, Copper. You know how.',
  'nova.31': '[alert] That one dropped the parts we need for the base. [firm] Grab them.',
  // the hero dead (the human's, 2026-11-12; ui.js sync): his last words over the radio, one of the two, then Nova calls him.
  // The human's Ukrainian recordings came first (Copper: "Ново." / "Ново, я трьохсотий.", a cough after each; Nova: "Коппере,
  // ти мене чуєш?"); these are their English, said the same way
  'copper.3': '[weak, strained] Nova… [coughs]',
  'copper.4': "[weak, strained] Nova, I'm hit. [coughs]",
  'nova.32': '[urgent, worried] Copper, do you copy?',
  'nova.33':
    "[matter-of-fact, over the radio] Short on coins? You'll find supplies in the suburbs. [firm] Go clear them out.", // the gun from Walt while the glass room is being cleared, then its upgrade (2026-11-12: the task used to drop in
  // with no words and no voice)
  'nova.34':
    '[matter-of-fact] While the glass room is being cleared, go see Walt. [brisk] He has better guns than your pistol. Get yourself one.',
  'nova.35': '[approving] Good choice. [matter-of-fact] Now take it to the workbench and upgrade it.',
  // back at the base with the lab's vaccine (mission 3 won): Copper is cured
  'nova.36':
    "[relieved, warm] The vaccine worked. [sincere] I'm really glad you found it, Copper. [confident] You're back in the fight.",
};

// the subtitles (live/lang_en.js, lang_uk.js through a stand-in I18N)
const require = createRequire(import.meta.url);
const PACK = {};
globalThis.I18N = { pack: (id, p) => (PACK[id] = p) };
require(join(ROOT, 'live/lang_en.js'));
require(join(ROOT, 'live/lang_uk.js'));
require(join(ROOT, 'live/lang_ru.js'));
require(join(ROOT, 'live/lang_es.js'));
const subIn = (lg, id) => {
  const [who, n] = id.split('.'),
    v = PACK[lg] && PACK[lg].voice;
  return v && v[who] && v[who][n];
};
const sub = (id) => subIn('en', id);
const words = (s) =>
  s
    .replace(/\s*\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// a language whose lines are written here with their own tags, and each language's own voices
const OWN_LINES = { ru: RU_LINES, es: ES_LINES },
  OWN_VOICES = { uk: UK, ru: RU, es: ES };

const args = process.argv.slice(2),
  keep = args.includes('--keep'),
  ADD = args.includes('--add'),
  li = args.indexOf('--lang'),
  LANG = li >= 0 ? args[li + 1] : 'en',
  ids = args.filter((a, i) => !a.startsWith('--') && !(li >= 0 && i === li + 1) && !/\.mp3$/i.test(a));
if (!['en', 'uk', 'ru', 'es'].includes(LANG)) {
  console.error('--lang: en, uk, ru or es');
  process.exit(1);
}
const file = (id) => {
  const [who, n] = id.split('.');
  return join(RAW, LANG === 'en' ? '' : LANG, `${who}_${String(n).padStart(2, '0')}.mp3`);
};
// a text's sentences (each with its stop)
const sentences = (t) => (t.match(/[^.!?…]+[.!?…]+["»”]?|[^.!?…]+$/g) || [t]).map((x) => x.trim()).filter(Boolean);
// the Ukrainian words with the English line's tags before the same sentences (unpaired: its first tag before all)
function tagged(line, text) {
  const chunks = [...line.matchAll(/(\[[^\]]*\])\s*([^[]*)/g)].map((m) => [m[1], m[2].trim()]),
    at = [];
  let n = 0;
  for (const [tag, w] of chunks) {
    at[n] = tag;
    n += sentences(w).length;
  }
  const us = sentences(text);
  if (us.length !== n) return (chunks[0] ? chunks[0][0] + ' ' : '') + text;
  return us.map((x, i) => (at[i] ? at[i] + ' ' : '') + x).join(' ');
}
// what is said: the English line as written, or the language's subtitle with its tags
const say = (id) =>
  LANG === 'en' ? LINES[id] : OWN_LINES[LANG] ? OWN_LINES[LANG][id] : tagged(LINES[id], subIn(LANG, id));
const todo = ids.length ? ids : Object.keys(OWN_LINES[LANG] || LINES);
let bad = 0;
for (const id of todo) {
  if (!LINES[id]) {
    console.error(id + ': no such line');
    bad++;
  } else if (OWN_LINES[LANG]) {
    const own = OWN_LINES[LANG][id];
    if (!own || words(own) !== subIn(LANG, id)) {
      console.error(
        `${id}: the ${LANG} line's words differ from its subtitle\n  line:     ${own && words(own)}\n  subtitle: ${subIn(LANG, id)}`,
      );
      bad++;
    }
  } else if (LANG !== 'en') {
    if (!subIn(LANG, id)) {
      console.error(`${id}: no ${LANG} subtitle`);
      bad++;
    }
  } else if (words(LINES[id]) !== sub(id)) {
    console.error(`${id}: the words differ from its subtitle\n  line:     ${words(LINES[id])}\n  subtitle: ${sub(id)}`);
    bad++;
  }
}
if (bad) process.exit(1);
if (args.includes('--dry')) {
  for (const id of todo) console.log(`${id}: ${say(id)}`); // (what would be said, nothing made)
  process.exit(0);
}
if (args.includes('--check')) {
  console.log(todo.length + ' lines match their subtitles');
  process.exit(0);
}

const el = new ElevenLabsClient();
// --stt <file.mp3 …> [--lang uk]: what a recording says (ElevenLabs speech to text, scribe_v2), printed; nothing made (the
// human's own recordings: their words for the subtitles)
if (args.includes('--stt')) {
  const { readFileSync } = await import('node:fs');
  for (const f of args.filter((a) => /\.mp3$/i.test(a))) {
    const r = await el.speechToText.convert({
      file: new Blob([readFileSync(f)], { type: 'audio/mpeg' }),
      modelId: 'scribe_v2',
      languageCode: LANG === 'en' ? 'en' : LANG,
      tagAudioEvents: true,
    });
    console.log(`${path.basename(f)}: ${r.text}`);
  }
  process.exit(0);
}
// a speaker's voice in the account: as it is, or added from the library under its name
const ready = {};
async function voiceOf(who) {
  if (ready[who]) return ready[who];
  if (OWN_VOICES[LANG]) return (ready[who] = OWN_VOICES[LANG][who]); // (the voices picked for that language)
  const V = VOICES[who];
  try {
    await el.voices.get(V.id);
    return (ready[who] = V.id);
  } catch (e) {
    // (401 missing_permissions: a key that may speak but not read the account's voices — the voice is said by its id)
    const blind = e.statusCode === 401 && /voices_read/.test(JSON.stringify(e.body || ''));
    if (e.statusCode !== 400 && e.statusCode !== 404 && !blind) throw e;
  }
  if (!ADD) return (ready[who] = V.id); // (a library voice said straight from the library)
  const r = await el.voices.getShared({ search: V.id, pageSize: 10 }),
    lib = r.voices.find((v) => v.voiceId === V.id);
  if (!lib) throw new Error(`${who}: voice ${V.id} is neither in the account nor in the library`);
  const added = await el.voices.share(lib.publicOwnerId, lib.voiceId, { newName: V.name });
  console.log(`${who}: added "${V.name}" to the account`);
  return (ready[who] = added.voiceId || V.id);
}

mkdirSync(join(RAW, LANG === 'en' ? '' : LANG), { recursive: true });
let chars = 0;
for (const id of todo) {
  const out = file(id);
  if (keep && existsSync(out)) continue;
  const who = id.split('.')[0],
    V = VOICES[who];
  const text = say(id);
  if (LANG !== 'en') console.log(`${id}: ${text}`);
  const audio = await el.textToSpeech.convert(await voiceOf(who), {
    text,
    modelId: MODEL,
    outputFormat: 'mp3_44100_128',
    languageCode: LANG,
    voiceSettings: OWN_LINES[LANG]
      ? { stability: 0.5, similarityBoost: 0.75 }
      : { stability: V.stability, similarityBoost: V.similarity },
  });
  const buf = Buffer.from(await new Response(audio).arrayBuffer());
  writeFileSync(out, buf);
  chars += text.length;
  console.log(`${id} → ${out.slice(ROOT.length + 1).replace(/\\/g, '/')} (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`done: about ${chars} characters`);
