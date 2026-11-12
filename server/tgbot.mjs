// The Telegram bot @MeowDivisionBot: the game as a Telegram Mini App (live/tg.html, the game full screen and sideways).
// node server/tgbot.mjs   (env TG_TOKEN = the bot's token; TG_APP_URL = the Mini App, https://game.meowdivision.fun/tg.html by default)
// Long polling, no packages (node 18+: fetch). On the server it runs as systemd meow-division-bot.service (DynamicUser), the token
// in /etc/meow-division-bot.env (root only), never in the sources (scripts/setup-service.sh).
// At every start it writes the bot's commands, its descriptions (the empty chat's "what can this bot do" and the profile's line) in the
// game's four languages, and the menu button by the message field (Play: opens the game). /start, or any message in a private chat,
// is answered with a Play button under a line on how the game opens; that chat's menu button then speaks the person's language.
// A friend's invite into a room to play together (the game's Invite: t.me/MeowDivisionBot?start=r_CODE) is answered with a button that
// opens the game straight in that room (tg.html?room=CODE).
const TOKEN = process.env.TG_TOKEN,
  APP = process.env.TG_APP_URL || 'https://game.meowdivision.fun/tg.html';
if (!TOKEN) {
  console.error('TG_TOKEN is not set');
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}/`;

const T = {
  en: {
    play: 'Play',
    cmd: 'Play Meow Division',
    short: 'Copper the cat clears San Francisco of zombies. Play right in Telegram.',
    desc: 'Meow Division: Copper the cat fights zombies in San Francisco, frees Walt and builds up NEAR Base. Missions, loot, and a backpack you carry out yourself.\n\nTap Play: the game opens full screen and sideways, just turn your phone.',
    hello: 'Tap Play below. The game opens full screen and sideways, just turn your phone.',
    room: 'Your friend invites you to play together. Tap the button to join their room {code}.',
    join: 'Join the room',
  },
  ru: {
    play: 'Играть',
    cmd: 'Играть в Meow Division',
    short: 'Кот Коппер зачищает Сан-Франциско от зомби. Играй прямо в Telegram.',
    desc: 'Meow Division: кот Коппер сражается с зомби в Сан-Франциско, спасает Уолта и отстраивает базу NEAR. Миссии, добыча и рюкзак, который выносишь сам.\n\nНажми «Играть», игра откроется на весь экран и горизонтально, просто поверни телефон.',
    hello: 'Нажми «Играть» ниже. Игра откроется на весь экран и горизонтально, просто поверни телефон.',
    room: 'Друг зовёт тебя сыграть вдвоём. Нажми кнопку, чтобы зайти в его комнату {code}.',
    join: 'Зайти в комнату',
  },
  uk: {
    play: 'Грати',
    cmd: 'Грати в Meow Division',
    short: 'Кіт Коппер зачищає Сан-Франциско від зомбі. Грай просто в Telegram.',
    desc: 'Meow Division: кіт Коппер бʼється із зомбі в Сан-Франциско, рятує Уолта й відбудовує базу NEAR. Місії, здобич і рюкзак, який виносиш сам.\n\nНатисни «Грати», гра відкриється на весь екран і горизонтально, просто поверни телефон.',
    hello: 'Натисни «Грати» нижче. Гра відкриється на весь екран і горизонтально, просто поверни телефон.',
    room: 'Друг кличе тебе зіграти удвох. Натисни кнопку, щоб зайти в його кімнату {code}.',
    join: 'Зайти в кімнату',
  },
  es: {
    play: 'Jugar',
    cmd: 'Jugar a Meow Division',
    short: 'El gato Copper limpia San Francisco de zombis. Juega directamente en Telegram.',
    desc: 'Meow Division: el gato Copper lucha contra zombis en San Francisco, rescata a Walt y reconstruye la base NEAR. Misiones, botín y una mochila que sacas tú mismo.\n\nPulsa Jugar: el juego se abre a pantalla completa y en horizontal, solo tienes que girar el teléfono.',
    hello:
      'Pulsa Jugar abajo. El juego se abre a pantalla completa y en horizontal, solo tienes que girar el teléfono.',
    room: 'Un amigo te invita a jugar juntos. Pulsa el botón para entrar en su sala {code}.',
    join: 'Entrar en la sala',
  },
};
const langOf = (code) => {
  const c = String(code || '')
    .slice(0, 2)
    .toLowerCase();
  return T[c] ? c : 'en';
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, body) {
  const r = await fetch(API + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(75000),
  });
  const j = await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
  if (!j.ok)
    throw Object.assign(new Error(`${method}: ${j.description}`), { retry: j.parameters && j.parameters.retry_after });
  return j.result;
}
const menuButton = (l) => ({ type: 'web_app', text: T[l].play, web_app: { url: APP } });

// the bot's face: English is the default for every language without its own
async function setup() {
  for (const l of Object.keys(T)) {
    const lc = l === 'en' ? {} : { language_code: l };
    await api('setMyCommands', { commands: [{ command: 'start', description: T[l].cmd }], ...lc });
    await api('setMyDescription', { description: T[l].desc, ...lc });
    await api('setMyShortDescription', { short_description: T[l].short, ...lc });
  }
  await api('setChatMenuButton', { menu_button: menuButton('en') });
  console.log('set up: commands, descriptions, menu button →', APP);
}

async function onMessage(m) {
  if (!m.chat || m.chat.type !== 'private') return;
  const l = langOf(m.from && m.from.language_code),
    r = /^\/start r_([A-Za-z0-9]{4,8})\b/.exec(m.text || '');
  if (r) {
    const code = r[1].toUpperCase(),
      url = APP + (APP.includes('?') ? '&' : '?') + 'room=' + code;
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: T[l].room.replace('{code}', code),
      reply_markup: { inline_keyboard: [[{ text: T[l].join, web_app: { url } }]] },
    });
  } else
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: T[l].hello,
      reply_markup: { inline_keyboard: [[{ text: T[l].play, web_app: { url: APP } }]] },
    });
  await api('setChatMenuButton', { chat_id: m.chat.id, menu_button: menuButton(l) }).catch((e) =>
    console.error(e.message),
  );
}

async function main() {
  for (let i = 0; ; i++) {
    try {
      await setup();
      break;
    } catch (e) {
      console.error('setup', e.message);
      await sleep(Math.min(60, 5 * (i + 1)) * 1000);
    }
  }
  let offset = 0;
  for (;;) {
    try {
      const ups = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      for (const u of ups) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch((e) => console.error('reply', e.message));
      }
    } catch (e) {
      console.error('poll', e.message);
      await sleep((e.retry || 5) * 1000);
    }
  }
}
if (process.env.TG_DRY !== '1') main();
export { T, langOf, setup, onMessage };
