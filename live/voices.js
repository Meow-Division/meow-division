// live/voices.js — the voice lines page (voices.html; the human's, 2026-11-12: "every line in every language and a way to
// listen to them, to see what is voiced and what is not"). Every line of Nova, Copper and Walt in the order a player
// hears them (docs/voice.md, its "when" written here in Russian), each in the four languages (the language packs'
// voice.<id>) with its recording where one answers: audio/voice/<who>_NN.mp3 is the English, heard in every language
// without its own; audio/voice/<lang>/<who>_NN.mp3 a language's own, played by the game when voice.js DUB lists it.
// A recording counts as there when its file loads (so the page tells what is on this server, not what a list says).
// Loaded first: the packs (lang_*.js) and voice.js fill in after it; the page is drawn once they have.
(function () {
  const P = {};
  window.I18N = { pack: (l, o) => (P[l] = o) }; // (the packs register here as they load)

  // the languages shown, in the order the team reads them
  const LANGS = [
    ['en', 'EN', 'English'],
    ['ru', 'RU', 'Русский'],
    ['uk', 'UK', 'Українська'],
    ['es', 'ES', 'Español'],
  ];
  const WHO = { nova: 'Нова', copper: 'Коппер', walt: 'Уолт' };
  // the order a player hears them, when each is said, and why one isn't said now (docs/voice.md)
  const ORDER = [
    ['nova.1', 'После заставки, перед миссией 1'],
    ['nova.19', 'Миссия 1 начинается: Коппер стоит, пока она говорит'],
    ['copper.1', 'Сразу за Новой: Коппер уже может идти'],
    ['nova.24', 'Открыт ящик с навыками'],
    ['nova.20', 'За фургоном: у КПП просыпается орда'],
    ['nova.4', 'Орда убита, на земле магнит'],
    ['nova.5', 'Первые навыки, когда собраны все кристаллы'],
    ['nova.21', 'Взят дрон: КПП открывается'],
    ['nova.6', 'Парковка: толпа и бомба на земле'],
    ['nova.7', 'Толпа убита бомбой, выпала аптечка'],
    ['nova.22', 'Толпа убита без бомбы'],
    ['nova.8', 'Аптечка подобрана: Нова сбрасывает припасы'],
    ['nova.9', 'Припасы открыты: клевер для дрона'],
    ['nova.10', 'Припасы взяты: дверь офиса открывается'],
    ['copper.2', 'Внутри офиса, по залу бродит толпа'],
    ['nova.23', 'Отвечает Копперу внутри офиса'],
    ['nova.11', 'Босс'],
    ['nova.12', 'Победа в миссии 1'],
    ['walt.1', 'Первый раз на базе, после Новы'],
    ['walt.2', 'Окно Уолта с тесаком на складе: урок продажи'],
    ['walt.3', 'Тесак продан: урок окончен'],
    ['nova.13', 'Сразу за Уолтом, если кошелёк не подключён'],
    ['nova.25', 'База: первый разговор с Новой после продажи тесака'],
    ['nova.26', 'Генератор построен'],
    ['nova.27', 'Ниша расчищена от хлама'],
    ['nova.28', 'Верстак построен'],
    ['nova.29', 'Стеклянная комната расчищена'],
    ['nova.30', 'Медпункт построен: обучение на базе окончено'],
    ['nova.31', 'Рейд в пригороде: первый босс роняет детали для постройки'],
    ['nova.14', 'Миссия 2: Грибной монстр'],
    ['nova.15', 'Миссии 2 и 3: открылась эвакуация (4:00)'],
    ['nova.16', 'Грибной монстр убит: споры заразили Коппера'],
    ['nova.17', 'База после миссии 2: отправляет в лабораторию'],
    ['nova.18', 'Полигон построен', 'Полигона пока нет в игре'],
    ['nova.2', '', 'Больше не звучит: что в ящике, показывают карточки'],
    ['nova.3', '', 'Больше не звучит: её место заняла реплика 20'],
  ];
  // what is known to be off in a recording ('<lang>:<id>')
  const VOLT = 'В записи звучит «Волт», в субтитрах уже «Уолт»: запись нужно переделать';
  const NOTE = { 'uk:nova.10': VOLT, 'uk:nova.12': VOLT, 'uk:copper.2': VOLT };

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fileOf = (id, lg) => {
    const [who, k] = id.split('.');
    return 'audio/voice/' + (lg ? lg + '/' : '') + who + '_' + String(k).padStart(2, '0') + '.mp3';
  };
  const dubbed = (lg, id) => {
    const D = window.VOICE && VOICE.DUB;
    return !!(D && D[lg] && D[lg].split(' ').includes(id));
  };
  const textOf = (lg, id) => {
    const [who, k] = id.split('.'),
      v = P[lg] && P[lg].voice;
    return (v && v[who] && v[who][k]) || '';
  };
  const mmss = (s) => (isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : '');

  // ---------- the recordings: a file is there when its metadata loads (its length with it) ----------
  const rec = {}; // file -> { ok: true | false | null, dur }
  function probe(file) {
    if (rec[file]) return rec[file].p;
    const r = (rec[file] = { ok: null, dur: NaN });
    r.p = new Promise((done) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', () => {
        r.ok = true;
        r.dur = a.duration;
        done();
      });
      a.addEventListener('error', () => {
        r.ok = false;
        done();
      });
      a.src = file;
    });
    return r.p;
  }

  // ---------- the player: one recording at a time; a row's button plays or stops it; "in a row" plays a language's
  // recordings one after another ----------
  const player = new Audio();
  let playing = null, // the button playing now
    queue = null; // { lg, ids, i } while playing in a row
  function stop() {
    player.pause();
    if (playing) {
      playing.classList.remove('on');
      playing.closest('.tr').classList.remove('now');
      const bar = playing.closest('.tr').querySelector('.pr i');
      if (bar) bar.style.width = '0';
    }
    playing = null;
  }
  function play(btn) {
    const same = playing === btn;
    stop();
    if (same) {
      queue = null;
      paintQueue();
      return;
    }
    playing = btn;
    btn.classList.add('on');
    btn.closest('.tr').classList.add('now');
    player.src = btn.dataset.file;
    player.play().catch(() => stop());
  }
  player.addEventListener('timeupdate', () => {
    if (!playing || !isFinite(player.duration)) return;
    const bar = playing.closest('.tr').querySelector('.pr i');
    if (bar) bar.style.width = ((player.currentTime / player.duration) * 100).toFixed(1) + '%';
  });
  player.addEventListener('ended', () => {
    stop();
    if (queue) nextInQueue();
  });
  function nextInQueue() {
    while (queue && queue.i < queue.btns.length) {
      const b = queue.btns[queue.i++];
      if (!b.isConnected) continue;
      b.closest('.ln').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      play(b);
      paintQueue();
      return;
    }
    queue = null;
    paintQueue();
  }
  function startQueue(lg) {
    stop();
    const btns = [...document.querySelectorAll(`.tr[data-lang="${lg}"] .pl:not([disabled])`)];
    queue = btns.length ? { lg, btns, i: 0 } : null;
    if (queue) nextInQueue();
  }

  // ---------- the page ----------
  const FILTERS = [
    ['all', 'Все'],
    ['noen', 'Без английской записи'],
    ['nouk', 'Без своей украинской'],
    ['note', 'Нужно переделать'],
    ['off', 'Не звучат в игре'],
  ];
  let filter = 'all';
  let lines = [];

  function status(id, lg) {
    const en = rec[fileOf(id)],
      own = lg === 'en' ? en : rec[fileOf(id, lg)];
    if (lg === 'en')
      return own && own.ok
        ? { cls: 'ok', t: 'Запись', file: fileOf(id), dur: own.dur }
        : { cls: 'no', t: 'Нет записи' };
    if (own && own.ok)
      return dubbed(lg, id)
        ? { cls: 'ok', t: 'Своя запись', file: fileOf(id, lg), dur: own.dur }
        : { cls: 'warn', t: 'Файл есть, но игра его не играет', file: fileOf(id, lg), dur: own.dur };
    return en && en.ok
      ? { cls: 'en', t: 'Своей записи нет: звучит английская' }
      : { cls: 'no', t: 'Записи нет ни на каком языке' };
  }
  function row(id, lg) {
    const [, short, name] = LANGS.find((l) => l[0] === lg),
      st = status(id, lg),
      note = NOTE[lg + ':' + id];
    return (
      `<div class="tr${note ? ' fix' : ''}" data-lang="${lg}"><span class="lg" title="${name}">${short}</span>` +
      `<p>${esc(textOf(lg, id)) || '<i class="none">текста нет</i>'}</p>` +
      `<div class="pc">${
        st.file
          ? `<button class="pl" type="button" data-file="${st.file}" aria-label="Слушать: ${short} ${id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-play" d="M8 5v14l11-7z"/><path class="i-stop" d="M7 7h10v10H7z"/></svg></button>`
          : '<button class="pl" type="button" disabled aria-label="Записи нет"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-play" d="M8 5v14l11-7z"/></svg></button>'
      }<span class="st ${st.cls}">${st.t}${st.dur ? ` · ${mmss(st.dur)}` : ''}</span></div>` +
      (st.file ? '<span class="pr"><i></i></span>' : '') +
      (note ? `<div class="note">${esc(note)}</div>` : '') +
      '</div>'
    );
  }
  function shown(l) {
    if (filter === 'all') return true;
    if (filter === 'off') return !!l.off;
    if (filter === 'note') return Object.keys(NOTE).some((k) => k.endsWith(':' + l.id));
    if (l.off) return false;
    if (filter === 'noen') return !(rec[fileOf(l.id)] || {}).ok;
    if (filter === 'nouk') return !(rec[fileOf(l.id, 'uk')] || {}).ok || !dubbed('uk', l.id);
    return true;
  }
  function paintList() {
    stop();
    queue = null;
    const box = document.getElementById('list'),
      list = lines.filter(shown);
    box.innerHTML = list.length
      ? list
          .map((l, i) => {
            const who = l.id.split('.')[0];
            return (
              `<article class="ln${l.off ? ' off' : ''}" data-id="${l.id}"><header>` +
              `<span class="n">${i + 1}</span><span class="who ${who}">${WHO[who] || who}</span><code>${l.id}</code>` +
              (l.when ? `<span class="when">${esc(l.when)}</span>` : '') +
              (l.off ? `<span class="offt">${esc(l.off)}</span>` : '') +
              '</header>' +
              LANGS.map(([lg]) => row(l.id, lg)).join('') +
              '</article>'
            );
          })
          .join('')
      : '<p class="empty">Таких реплик нет.</p>';
    paintQueue();
  }
  function paintStats() {
    const said = lines.filter((l) => !l.off),
      en = said.filter((l) => (rec[fileOf(l.id)] || {}).ok).length,
      uk = said.filter((l) => (rec[fileOf(l.id, 'uk')] || {}).ok && dubbed('uk', l.id)).length,
      fix = Object.keys(NOTE).length;
    const stat = (n, of, label, cls = '') =>
      `<div class="stat ${cls}"><b>${n}<small>/${of}</small></b><span>${label}</span></div>`;
    document.getElementById('stats').innerHTML =
      stat(en, said.length, 'English: записаны', en < said.length ? 'warn' : 'ok') +
      stat(uk, said.length, 'Українська: свои записи', uk < said.length ? 'warn' : 'ok') +
      `<div class="stat muted"><b>0</b><span>Русский и Español: своих записей нет, звучит английская</span></div>` +
      (fix ? `<div class="stat bad"><b>${fix}</b><span>записи нужно переделать</span></div>` : '');
  }
  function paintFilters() {
    document.getElementById('filters').innerHTML = FILTERS.map(
      ([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${t}</button>`,
    ).join('');
  }
  function paintQueue() {
    const q = document.getElementById('queue');
    q.innerHTML =
      '<span>Подряд:</span>' +
      [
        ['en', 'English'],
        ['uk', 'Українська'],
      ]
        .map(
          ([lg, t]) =>
            `<button type="button" data-q="${lg}" aria-pressed="${!!(queue && queue.lg === lg)}">${queue && queue.lg === lg ? 'Стоп' : '▶ ' + t}</button>`,
        )
        .join('');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.classList.contains('pl')) {
      queue = null;
      play(b);
      paintQueue();
    } else if (b.dataset.f) {
      filter = b.dataset.f;
      paintFilters();
      paintList();
    } else if (b.dataset.q) {
      if (queue && queue.lg === b.dataset.q) {
        queue = null;
        stop();
        paintQueue();
      } else startQueue(b.dataset.q);
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    // every line the packs have, in the order heard; ones not in that order at the end
    const ids = [];
    const v = (P.en && P.en.voice) || {};
    for (const who of Object.keys(v)) if (WHO[who]) for (const k of Object.keys(v[who])) ids.push(who + '.' + k);
    lines = ORDER.filter(([id]) => ids.includes(id)).map(([id, when, off]) => ({ id, when, off }));
    for (const id of ids) if (!lines.some((l) => l.id === id)) lines.push({ id, when: 'Где звучит, не записано' });
    paintFilters();
    paintList();
    document.getElementById('stats').innerHTML = '<div class="stat muted"><span>Проверяю записи…</span></div>';
    const langs = Object.keys((window.VOICE && VOICE.DUB) || { uk: 1 });
    await Promise.all(lines.flatMap((l) => [probe(fileOf(l.id))].concat(langs.map((lg) => probe(fileOf(l.id, lg))))));
    paintStats();
    paintList();
  });
})();
