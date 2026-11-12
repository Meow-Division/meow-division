// live/voices.js — the voice lines page (voices.html; the human's, 2026-11-12: "every line in every language and a way to
// listen to them, to see what is voiced and what is not"). Every line of Nova, Copper and Walt in the order a player
// hears them (docs/voice.md, its "when" written here in Russian), each in the four languages (the language packs'
// voice.<id>) with its recording where one answers: audio/voice/<who>_NN.mp3 is the English, heard in every language
// without its own; audio/voice/<lang>/<who>_NN.mp3 a language's own, played by the game when voice.js DUB lists it.
// A recording counts as there when its file loads (so the page tells what is on this server, not what a list says).
// Editing (the human's, 2026-11-12: "write the new lines right there, so you see which and change them"): on the local
// editor's server (server.mjs --editor, /api/editor/voice) each text has a pencil, each line a note, and a form asks for
// a new line; they are kept in DATA_DIR/voice-edits.json until Claude puts them into the language packs (and asks for new
// recordings where the words changed). Elsewhere the page only reads.
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
    ['nova.34', 'Пошла расчистка стеклянной комнаты, нового оружия ещё нет: задание «Купи новое оружие у Уолта»'],
    ['nova.35', 'Новое оружие куплено, ничего ещё не улучшено: задание «Улучши оружие на верстаке»'],
    ['nova.29', 'Стеклянная комната расчищена'],
    ['nova.33', 'Медпункт: расходников нет (сразу после 29 или позже): задание «Зачисти Пригород»'],
    ['nova.30', 'Медпункт построен: обучение на базе окончено'],
    ['nova.31', 'Рейд в пригороде: первый босс роняет детали для постройки'],
    [
      'nova.14',
      'Миссия 2: Грибной монстр. База: по рации, как расчищена стеклянная комната (после 29 и 33); в рейде тогда не повторяется',
    ],
    ['nova.15', 'Миссии 2 и 3: открылась эвакуация (4:00)'],
    ['nova.16', 'Грибной монстр убит: споры заразили Коппера'],
    ['nova.17', 'База после миссии 2: отправляет в лабораторию'],
    ['copper.3', 'Смерть Коппера: одна из двух фраз, случайно, по рации'],
    ['copper.4', 'Смерть Коппера: вторая из двух фраз, случайно, по рации'],
    ['nova.18', 'Полигон построен', 'Полигона пока нет в игре'],
    ['nova.2', '', 'Больше не звучит: что в ящике, показывают карточки'],
    ['nova.3', '', 'Больше не звучит: её место заняла реплика 20'],
    ['nova.32', '', 'Больше не звучит: убрана после смерти Коппера (2026-11-12)'],
  ];
  // what is known to be off in a recording ('<lang>:<id>': its words). (The three Ukrainian ones that said «Волт» were
  // made again on 2026-11-12.)
  const NOTE = {};

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

  // ---------- the human's edits: { text: {'<lang>:<id>': {text}}, note: {'<id>': {text}}, add: [{id, who, when, text}] } ----------
  let ED = null, // null: the page only reads (no editor's server here)
    editing = ''; // the editor open: 'text:<lang>:<id>' or 'note:<id>'
  async function api(b) {
    const r = await fetch(
      '/api/editor/voice',
      b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {},
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  }
  // a save: the server's answer is the state; the page drawn anew; a failure said in the corner
  async function edit(b) {
    try {
      ED = await api(b);
      editing = '';
      paintList();
      paintStats();
      paintAdds();
      toast('Сохранено');
    } catch (e) {
      toast('Не сохранилось: ' + e.message, true);
    }
  }
  const editCount = () => (ED ? Object.keys(ED.text).length + Object.keys(ED.note).length + ED.add.length : 0);
  function toast(t, bad) {
    let n = document.getElementById('toast');
    if (!n) {
      n = document.createElement('div');
      n.id = 'toast';
      n.setAttribute('role', 'status');
      document.body.appendChild(n);
    }
    n.textContent = t;
    n.className = bad ? 'bad on' : 'on';
    clearTimeout(n.t);
    n.t = setTimeout(() => (n.className = ''), 2200);
  }

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
    ['edits', 'Мои правки'],
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
        : { cls: 'warn', t: 'Своя запись, в игре пока не включена', file: fileOf(id, lg), dur: own.dur };
    return en && en.ok
      ? { cls: 'en', t: 'Своей записи нет: звучит английская' }
      : { cls: 'no', t: 'Записи нет ни на каком языке' };
  }
  function row(id, lg) {
    const [, short, name] = LANGS.find((l) => l[0] === lg),
      st = status(id, lg),
      note = NOTE[lg + ':' + id],
      key = lg + ':' + id,
      orig = textOf(lg, id),
      ed = ED && ED.text[key],
      open = editing === 'text:' + key;
    const text = open
      ? `<div class="tx ed"><textarea data-key="${key}" rows="3" aria-label="Новый текст: ${short} ${id}">${esc(ed ? ed.text : orig)}</textarea>` +
        `<div class="eb"><button type="button" class="go" data-act="save" data-key="${key}">Сохранить</button>` +
        `<button type="button" data-act="cancel">Отмена</button>` +
        (ed ? `<button type="button" data-act="revert" data-key="${key}">Вернуть как было</button>` : '') +
        '<small>Ctrl+Enter: сохранить, Esc: отмена</small></div></div>'
      : `<div class="tx">${
          ed
            ? `<p class="new">${esc(ed.text)}</p><p class="was">Было: ${esc(orig) || '—'}</p>`
            : `<p>${esc(orig) || '<i class="none">текста нет</i>'}</p>`
        }${ED ? `<button type="button" class="pen" data-act="edit" data-key="${key}" aria-label="Изменить: ${short} ${id}" title="Изменить текст"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>` : ''}</div>`;
    return (
      `<div class="tr${note ? ' fix' : ''}${ed ? ' chg' : ''}" data-lang="${lg}"><span class="lg" title="${name}">${short}</span>` +
      text +
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
    if (filter === 'edits')
      return !!ED && (!!ED.note[l.id] || Object.keys(ED.text).some((k) => k.endsWith(':' + l.id)));
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
            const nt = ED && ED.note[l.id],
              chg = !!nt || (!!ED && Object.keys(ED.text).some((k) => k.endsWith(':' + l.id)));
            return (
              `<article class="ln${l.off ? ' off' : ''}${chg ? ' chg' : ''}" data-id="${l.id}"><header>` +
              `<span class="n">${i + 1}</span><span class="who ${who}">${WHO[who] || who}</span><code>${l.id}</code>` +
              (l.when ? `<span class="when">${esc(l.when)}</span>` : '') +
              (l.off ? `<span class="offt">${esc(l.off)}</span>` : '') +
              (ED
                ? `<button type="button" class="nb" data-act="note" data-id="${l.id}">${nt ? 'Изменить заметку' : '+ Заметка'}</button>`
                : '') +
              '</header>' +
              (editing === 'note:' + l.id
                ? `<div class="ned"><textarea data-note="${l.id}" rows="2" placeholder="Что поменять: например, переозвучить, звучит слишком медленно, Нова так не скажет">${esc(nt ? nt.text : '')}</textarea>` +
                  `<div class="eb"><button type="button" class="go" data-act="nsave" data-id="${l.id}">Сохранить</button><button type="button" data-act="cancel">Отмена</button>` +
                  (nt ? `<button type="button" data-act="ndel" data-id="${l.id}">Удалить заметку</button>` : '') +
                  '</div></div>'
                : nt
                  ? `<div class="nt"><b>Заметка:</b> ${esc(nt.text)}</div>`
                  : '') +
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
      own = (lg) => said.filter((l) => (rec[fileOf(l.id, lg)] || {}).ok).length,
      uk = said.filter((l) => (rec[fileOf(l.id, 'uk')] || {}).ok && dubbed('uk', l.id)).length,
      ru = own('ru'),
      ruOn = said.filter((l) => (rec[fileOf(l.id, 'ru')] || {}).ok && dubbed('ru', l.id)).length,
      fix = Object.keys(NOTE).length;
    const stat = (n, of, label, cls = '') =>
      `<div class="stat ${cls}"><b>${n}<small>/${of}</small></b><span>${label}</span></div>`;
    document.getElementById('stats').innerHTML =
      stat(en, said.length, 'English: записаны', en < said.length ? 'warn' : 'ok') +
      stat(uk, said.length, 'Українська: свои записи', uk < said.length ? 'warn' : 'ok') +
      stat(
        ru,
        said.length,
        ru && ruOn < ru ? 'Русский: свои записи, в игре пока не включены' : 'Русский: свои записи',
        ru < said.length ? 'warn' : 'ok',
      ) +
      `<div class="stat muted"><b>0</b><span>Español: своих записей нет, звучит английская</span></div>` +
      (fix ? `<div class="stat bad"><b>${fix}</b><span>записи нужно переделать</span></div>` : '') +
      (editCount()
        ? `<div class="stat edit"><b>${editCount()}</b><span>моих правок ждут, пока Claude их внесёт</span></div>`
        : '');
  }
  // the form for a new line and the ones asked for (the editor's server only)
  function paintAdds() {
    const box = document.getElementById('adds');
    if (!ED) {
      box.innerHTML = '';
      return;
    }
    const form = box.querySelector('.af');
    if (!form)
      box.innerHTML =
        '<h2>Новая реплика</h2><p class="lead">Кто говорит, когда и что. Я добавлю её в игру, подключу к этому моменту и переведу на остальные языки.</p>' +
        '<div class="af"><label>Кто говорит<select data-af="who"><option value="nova">Нова</option><option value="walt">Уолт</option><option value="copper">Коппер</option></select></label>' +
        '<label class="w">Когда звучит<input data-af="when" maxlength="300" placeholder="Например: Уолт выдаёт задание дня"></label>' +
        '<label class="w">Русский<textarea data-af="ru" rows="2" maxlength="2000"></textarea></label>' +
        '<label class="w">English<textarea data-af="en" rows="2" maxlength="2000" placeholder="Можно оставить пустым: переведу"></textarea></label>' +
        '<label class="w">Українська<textarea data-af="uk" rows="2" maxlength="2000" placeholder="Можно оставить пустым"></textarea></label>' +
        '<label class="w">Español<textarea data-af="es" rows="2" maxlength="2000" placeholder="Можно оставить пустым"></textarea></label>' +
        '<div class="eb"><button type="button" class="go" data-act="add">Добавить реплику</button></div></div><div class="al"></div>';
    box.querySelector('.al').innerHTML = ED.add
      .map(
        (a) =>
          `<div class="ai"><div class="ah"><span class="who ${a.who}">${WHO[a.who]}</span>${a.when ? `<span class="when">${esc(a.when)}</span>` : ''}` +
          `<button type="button" data-act="unadd" data-id="${a.id}">Убрать</button></div>` +
          LANGS.filter(([lg]) => a.text[lg])
            .map(
              ([lg, short]) =>
                `<div class="tr"><span class="lg">${short}</span><div class="tx"><p>${esc(a.text[lg])}</p></div></div>`,
            )
            .join('') +
          '</div>',
      )
      .join('');
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
        ['ru', 'Русский'],
      ]
        .map(
          ([lg, t]) =>
            `<button type="button" data-q="${lg}" aria-pressed="${!!(queue && queue.lg === lg)}">${queue && queue.lg === lg ? 'Стоп' : '▶ ' + t}</button>`,
        )
        .join('');
  }

  // the editors: open one (the others close), save, cancel, put a line back as it was
  function act(b) {
    const a = b.dataset.act;
    if (a === 'edit' || a === 'note') {
      editing = a === 'edit' ? 'text:' + b.dataset.key : 'note:' + b.dataset.id;
      paintList();
      const t = document.querySelector(
        a === 'edit' ? `textarea[data-key="${b.dataset.key}"]` : `textarea[data-note="${b.dataset.id}"]`,
      );
      if (t) {
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      }
    } else if (a === 'cancel') {
      editing = '';
      paintList();
    } else if (a === 'save') {
      const key = b.dataset.key,
        [lg, id] = key.split(':'),
        v = document.querySelector(`textarea[data-key="${key}"]`).value.trim();
      edit({ k: 'text', lang: lg, id, text: v === textOf(lg, id) ? '' : v }); // (the words as they were: no edit)
    } else if (a === 'revert') {
      const [lg, id] = b.dataset.key.split(':');
      edit({ k: 'text', lang: lg, id, text: '' });
    } else if (a === 'nsave')
      edit({
        k: 'note',
        id: b.dataset.id,
        text: document.querySelector(`textarea[data-note="${b.dataset.id}"]`).value,
      });
    else if (a === 'ndel') edit({ k: 'note', id: b.dataset.id, text: '' });
    else if (a === 'add') {
      const f = (k) => document.querySelector(`[data-af="${k}"]`).value.trim(),
        text = {};
      for (const [lg] of LANGS) if (f(lg)) text[lg] = f(lg);
      if (!Object.keys(text).length) return toast('Впиши текст хотя бы на одном языке', true);
      edit({ k: 'add', who: f('who'), when: f('when'), text }).then(() => {
        for (const k of ['when', 'ru', 'en', 'uk', 'es']) document.querySelector(`[data-af="${k}"]`).value = '';
      });
    } else if (a === 'unadd') edit({ k: 'unadd', id: b.dataset.id });
  }
  // Ctrl+Enter saves the editor open, Esc closes it
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('textarea[data-key], textarea[data-note]')) return;
    if (e.key === 'Escape') {
      editing = '';
      paintList();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const b = t.closest('.ed, .ned').querySelector('[data-act="save"], [data-act="nsave"]');
      if (b) act(b);
    }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.act) act(b);
    else if (b.classList.contains('pl')) {
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
    ED = await api().catch(() => null); // (the editor's server: the edits waiting; else the page only reads)
    document.getElementById('how').textContent = ED
      ? 'Нажми карандаш у текста, чтобы его изменить, или «Заметка» у реплики. Новую реплику впиши внизу. Всё сохраняется сразу; потом скажи Claude «примени правки».'
      : 'Здесь только чтение. Править тексты можно на локальной странице (сервер с редактором).';
    paintFilters();
    paintList();
    paintAdds();
    document.getElementById('stats').innerHTML = '<div class="stat muted"><span>Проверяю записи…</span></div>';
    const langs = ['uk', 'ru', 'es'];
    await Promise.all(lines.flatMap((l) => [probe(fileOf(l.id))].concat(langs.map((lg) => probe(fileOf(l.id, lg))))));
    paintStats();
    paintList();
  });
})();
