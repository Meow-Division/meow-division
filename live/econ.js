// live/econ.js — the economy page (live/econ.html; econ-editor.bat starts the local editor server and opens it). Shows
// what every building level, kit and upgrade costs in coins and items, and how many raids those items take on the
// current loot tables (simulated: containers roll random items in random amounts, so one raid may not be enough).
// Every number and item list is editable; Save writes live/economy.js and live/data.js through server/econfile.mjs.
// A team tool: Russian only, never shipped (gen/build.mjs leaves it out, gen/langcheck.mjs knows it).
(function () {
  'use strict';
  const API = '/api/editor/economy';
  const TAB_KEY = 'md.econTab';
  const SIM_RAIDS = 1500; // raids simulated per map for the estimates
  const SIM_TRIALS = 300; // how often "raids until it is all collected" is played out per cost

  const BUILDING = {
    generator: 'Генератор',
    stash: 'Склад',
    workbench: 'Верстак',
    medbay: 'Медпункт',
    range: 'Полигон',
  };
  const OPENS = {
    power1: 'питание для 2-го уровня построек',
    power2: 'питание для 3-го уровня построек',
    safe1: 'сейф на 1 ячейку',
    safe2: 'сейф на 2 ячейки',
    bag10: 'рюкзак на 10 ячеек',
    range1: 'полигон: проверка оружия',
    range2: 'мишени, которые поднимаются сами',
  };
  const MAP = { office: 'Офис NEAR AI', suburb: 'Пригород', lab: 'Лаборатория' };
  const WEAPON = {
    dmg: ['Урон ствола', 'i_caliber'],
    rate: ['Скорострельность', 'i_smg'],
    mag: ['Магазин', 'i_bandolier'],
  };
  const COIN =
    '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#e8a317"/><circle cx="10" cy="10" r="6.5" fill="#ffd23a"/>' +
    '<path d="M10 6v8M7.5 8h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" stroke="#b9770e" stroke-width="1.4" fill="none"/></svg>';

  let S = null; // the state as saved (from the server)
  let W = null; // the working copy the page edits
  let tab = 'build';
  let sims = {}; // map → { mean: {id: per raid}, raids: [{id: n}, …] }
  let calcs = []; // functions that refill the computed parts on screen after an edit

  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const item = (id) => S.items.find((it) => it.id === id) || { id, name: id, rarity: 1, kind: 'material' };
  const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString('ru-RU');
  const raidsWord = (x) => {
    if (!Number.isInteger(x)) return 'рейда';
    const d = x % 10,
      dd = x % 100;
    if (d === 1 && dd !== 11) return 'рейд';
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'рейда';
    return 'рейдов';
  };
  // a seeded random source: the same tables always give the same estimates, so numbers do not jitter while typing
  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---------- the editable part, as the server takes it ----------
  const editable = (x) => ({
    loot: x.loot,
    recipes: x.recipes.map((r) => ({ id: r.id, coins: r.coins, inputs: r.inputs })),
    buildings: x.buildings.map((b) => ({
      id: b.id,
      levels: b.levels.map((l) => ({ coins: l.coins, items: l.items })),
    })),
    upgrades: x.upgrades,
    prices: {
      meta: Object.fromEntries(x.meta.map((m) => [m.id, m.price])),
      weapon: Object.fromEntries(x.weapon.map((w) => [w.id, w.price])),
    },
  });
  const dirty = () => !!W && JSON.stringify(editable(W)) !== JSON.stringify(editable(S));

  // ---------- loot simulation ----------
  function simulate() {
    sims = {};
    const rand = rng(7);
    for (const l of W.loot) {
      const total = l.table.reduce((s, e) => s + e[1], 0);
      const raids = [],
        sum = {};
      for (let r = 0; r < SIM_RAIDS; r++) {
        const got = {};
        for (let k = 0; k < l.boxes * l.rolls; k++) {
          let pick = rand() * total;
          let e = l.table[l.table.length - 1];
          for (const x of l.table) {
            if (pick < x[1]) {
              e = x;
              break;
            }
            pick -= x[1];
          }
          got[e[0]] = (got[e[0]] || 0) + e[2] + Math.floor(rand() * (e[3] - e[2] + 1));
        }
        raids.push(got);
        for (const id in got) sum[id] = (sum[id] || 0) + got[id];
      }
      const mean = {};
      for (const id in sum) mean[id] = sum[id] / SIM_RAIDS;
      sims[l.map] = { mean, raids };
    }
  }
  // the map where an item comes most per raid (null: it drops nowhere)
  const bestMap = (id) => {
    let best = null;
    for (const m in sims) if ((sims[m].mean[id] || 0) > (best ? sims[best].mean[id] : 0)) best = m;
    return best;
  };
  // a cost's estimate: on each item's best map, raids until all of it is collected, averaged over random play-outs
  function estimate(list) {
    const groups = {},
      lines = [],
      missing = [];
    for (const [id, n] of list) {
      const it = item(id);
      if (it.kind === 'trophy') {
        lines.push(`${it.name} ×${n}: трофей с босса`);
        continue;
      }
      const m = bestMap(id);
      if (!m) {
        missing.push(id);
        lines.push(`${it.name} ×${n}: не падает ни на одной карте`);
        continue;
      }
      (groups[m] = groups[m] || []).push([id, n]);
    }
    let total = 0,
      counted = 0;
    const rand = rng(11);
    for (const m in groups) {
      const raids = sims[m].raids,
        need = groups[m];
      let sum = 0;
      for (let t = 0; t < SIM_TRIALS; t++) {
        const have = {};
        let k = 0;
        while (k < 99 && !need.every(([id, n]) => (have[id] || 0) >= n)) {
          const r = raids[Math.floor(rand() * raids.length)];
          for (const [id] of need) have[id] = (have[id] || 0) + (r[id] || 0);
          k++;
        }
        sum += k;
      }
      const avg = sum / SIM_TRIALS;
      total += avg;
      counted += need.length;
      const share = (ok) => Math.round((raids.filter(ok).length / raids.length) * 100);
      for (const [id, n] of need)
        lines.push(
          `${item(id).name} ×${n}: ${MAP[m] || m}, в среднем ${fmt(sims[m].mean[id])} за рейд, ` +
            `за 1 рейд хватит с шансом ${share((r) => (r[id] || 0) >= n)}%`,
        );
      const all = share((r) => need.every(([id, n]) => (r[id] || 0) >= n));
      lines.push(`→ ${MAP[m] || m}: всё за 1 рейд с шансом ${all}%, в среднем ${fmt(avg)} ${raidsWord(avg)}`);
    }
    return { raids: total, counted, lines, missing, items: list.length };
  }
  function fillEstimate(el, list) {
    const e = estimate(list);
    el.className = 'est';
    el.title = e.lines.join('\n');
    if (e.missing.length) {
      el.classList.add('r');
      el.textContent = 'не падает';
    } else if (!e.counted) {
      el.classList.add('n');
      el.textContent = e.items ? 'с босса' : 'без предметов';
    } else {
      const r = Math.round(e.raids * 10) / 10;
      el.classList.add(r <= 1.2 ? 'g' : r <= 3 ? 'a' : 'r');
      el.textContent = `≈ ${fmt(r)} ${raidsWord(r)}`;
    }
  }
  function refresh() {
    for (const fn of calcs) fn();
    const st = $('#status'),
      d = dirty(),
      bad = document.querySelector('input.bad');
    $('#save').disabled = !d || !!bad;
    $('#undo').disabled = !d;
    if (st.classList.contains('err')) return;
    st.className = d || bad ? 'dirty' : '';
    st.textContent = bad ? 'есть неверные числа' : d ? 'есть несохранённые изменения' : 'всё сохранено';
  }
  let simTimer = 0;
  const resim = () => {
    clearTimeout(simTimer);
    simTimer = setTimeout(() => {
      simulate();
      refresh();
    }, 200);
  };

  // ---------- small parts ----------
  function icon(name, file, cls) {
    const img = h('img', cls);
    img.src = `assets/${file}.png`;
    img.alt = name;
    img.draggable = false;
    img.onerror = () => img.replaceWith(h('span', (cls || '') + ' tile', esc(name.slice(0, 2))));
    return img;
  }
  const itemIcon = (id) => icon(item(id).name, 'it_' + id, 'ic');
  // a number input bound to obj[key]; whole numbers lo..hi only (a wrong one turns red and is not taken)
  function num(obj, key, lo, hi, after) {
    const inp = h('input');
    inp.type = 'number';
    inp.min = lo;
    inp.max = hi;
    inp.step = 1;
    inp.value = obj[key];
    inp.oninput = () => {
      const v = Number(inp.value);
      const ok = inp.value !== '' && Number.isInteger(v) && v >= lo && v <= hi;
      inp.classList.toggle('bad', !ok);
      if (ok) obj[key] = v;
      if (ok && after) after();
      refresh();
    };
    return inp;
  }
  function coins(obj, key, lo) {
    const c = h('label', 'coins', COIN);
    c.title = 'монеты';
    c.append(num(obj, key, lo, 1e6));
    return c;
  }
  // the item chips of one cost list, with + to add an item; kinds: what may be picked
  function chips(list, kinds) {
    const box = h('div', 'chips');
    list.forEach((pair, i) => {
      const it = item(pair[0]);
      const c = h('span', 'chip r' + it.rarity);
      if (it.kind !== 'trophy' && !bestMap(it.id)) c.classList.add('nodrop');
      c.title = it.name;
      const nm = h('span', 'nm', esc(it.name));
      nm.append(num(pair, 1, 1, 999));
      const x = h('button', 'x', '×');
      x.title = 'убрать';
      x.onclick = () => {
        list.splice(i, 1);
        render();
      };
      c.append(itemIcon(it.id), nm, x);
      box.append(c);
    });
    const add = h('button', 'add', '+');
    add.title = 'добавить предмет';
    add.onclick = (ev) =>
      pick(
        ev.currentTarget,
        kinds,
        list.map((p) => p[0]),
        (id) => {
          list.push([id, 1]);
          render();
        },
      );
    box.append(add);
    return box;
  }
  function est(list) {
    const el = h('span', 'est');
    calcs.push(() => fillEstimate(el, list));
    return el;
  }
  // one cost: coins at obj[key] (whole numbers from lo), items in list
  function costRow(label, obj, key, lo, list, kinds, extra) {
    const row = h('div', 'row');
    row.append(h('span', 'lv', label), coins(obj, key, lo), chips(list, kinds), est(list));
    if (extra) row.append(h('div', 'opens', extra));
    return row;
  }

  // ---------- the item picker ----------
  function pick(anchor, kinds, taken, done) {
    const box = $('#pick');
    box.innerHTML = '';
    const close = () => {
      box.style.display = 'none';
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const outside = (e) => {
      if (!box.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    for (const [k, title] of [
      ['material', 'Материалы'],
      ['trophy', 'Трофеи с боссов'],
    ]) {
      if (!kinds.includes(k)) continue;
      box.append(h('h4', '', title));
      const grid = h('div', 'pk');
      for (const it of S.items.filter((x) => x.kind === k && !taken.includes(x.id))) {
        const b = h('button');
        b.append(itemIcon(it.id), document.createTextNode(it.name));
        b.onclick = () => {
          close();
          done(it.id);
        };
        grid.append(b);
      }
      box.append(grid);
    }
    const r = anchor.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = Math.max(8, Math.min(scrollX + r.left, scrollX + innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = scrollY + r.bottom + 6 + 'px';
    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ---------- tab: buildings and kits ----------
  function tabBuild(main) {
    main.append(
      h(
        'p',
        'note',
        'Справа у каждой строки — сколько в среднем рейдов нужно, чтобы собрать её предметы на лучшей для них карте ' +
          '(наведи, чтобы увидеть шансы). Зелёный — хватит одного рейда, жёлтый — 2–3, красный — больше.',
      ),
      h('h2', '', 'Постройки'),
    );
    const grid = h('div', 'grid');
    for (const b of W.buildings) {
      const card = h('div', 'card');
      const lock = b.lockedBy ? `открывается, когда принесёшь: ${esc(item(b.lockedBy).name)} (не тратится)` : '&nbsp;';
      card.append(h('h3', '', esc(BUILDING[b.id] || b.id)), h('div', 'sub', lock));
      b.levels.forEach((l, n) => {
        const crafts = W.recipes.filter((r) => r.at === b.id && r.level === n + 1).map((r) => item(r.output[0]).name);
        const opens = [OPENS[l.opens], crafts.length ? 'крафт: ' + crafts.join(', ') : ''].filter(Boolean).join('; ');
        const extra = esc(opens) + (l.power ? ` · нужен генератор ${l.power}` : '');
        card.append(costRow(`ур.<b>${n + 1}</b>`, l, 'coins', 1, l.items, ['material', 'trophy'], extra));
      });
      grid.append(card);
    }
    main.append(grid, h('h2', '', 'Крафт наборов (цена одной штуки)'));
    const card = h('div', 'card');
    for (const r of W.recipes) {
      const o = item(r.output[0]);
      const out = h('div', 'out');
      out.append(
        itemIcon(o.id),
        h('div', '', `<b>${esc(o.name)}</b><span>${esc(BUILDING[r.at] || r.at)} ${r.level}</span>`),
      );
      const row = h('div', 'row');
      row.append(out, coins(r, 'coins', 0), chips(r.inputs, ['material']), est(r.inputs));
      card.append(row);
    }
    main.append(card);
  }

  // ---------- tab: upgrades ----------
  function tabUps(main) {
    main.append(
      h(
        'p',
        'note',
        'Монеты за уровень уже работают в игре. Предметы за улучшения игра начнёт списывать, когда на базе появится ' +
          'инвентарь игрока; пока здесь задаётся план.',
      ),
      h('h2', '', 'Улучшения героя'),
    );
    const grid = h('div', 'grid');
    for (const m of W.meta) {
      const card = h('div', 'card');
      const t = h('h3');
      t.append(icon(m.name, m.icon, ''), document.createTextNode(m.name));
      card.append(t, h('div', 'sub', esc(m.desc)));
      W.upgrades.meta[m.id].forEach((list, n) =>
        card.append(costRow(`ур.<b>${n + 1}</b>`, m.price, n, 1, list, ['material', 'trophy'])),
      );
      grid.append(card);
    }
    main.append(grid, h('h2', '', 'Улучшения ствола (одинаковые для каждого ствола)'));
    const grid2 = h('div', 'grid');
    for (const w of W.weapon) {
      const [name, ic] = WEAPON[w.id] || [w.id, 'i_pistol'];
      const card = h('div', 'card');
      const t = h('h3');
      t.append(icon(name, ic, ''), document.createTextNode(name));
      card.append(t, h('div', 'sub', `+${Math.round(w.per * 100)}% за уровень`));
      W.upgrades.weapon[w.id].forEach((list, n) =>
        card.append(costRow(`ур.<b>${n + 1}</b>`, w.price, n, 1, list, ['material', 'trophy'])),
      );
      grid2.append(card);
    }
    main.append(grid2);
  }

  // ---------- tab: loot ----------
  function itemCell(id) {
    const td = h('td'),
      it = h('div', 'it');
    it.append(itemIcon(id), document.createTextNode(item(id).name));
    td.append(it);
    return td;
  }
  function numCell(input) {
    const td = h('td', 'num');
    td.append(input);
    return td;
  }
  function tabLoot(main) {
    main.append(
      h(
        'p',
        'note',
        'Каждый контейнер несколько раз «бросает кубик»: шанс предмета — его вес от суммы весов карты, количество — ' +
          'случайное от «от» до «до». «Контейнеров за рейд» — примерная цифра для расчётов, пока карты не считают их сами. ' +
          'Место в рюкзаке в расчётах не учитывается.',
      ),
    );
    // everything together: buildings and upgrades, all levels (kits are crafted again and again: left out)
    const sum = h('div', 'card');
    sum.append(
      h('h3', '', 'Сколько нужно на всё'),
      h('div', 'sub', 'все уровни построек и улучшений вместе, без крафта'),
    );
    const tb = h('table');
    sum.append(tb);
    calcs.push(() => {
      const need = {};
      const add = (list) => {
        for (const [id, n] of list) if (item(id).kind === 'material') need[id] = (need[id] || 0) + n;
      };
      W.buildings.forEach((b) => b.levels.forEach((l) => add(l.items)));
      for (const g of ['meta', 'weapon']) for (const id in W.upgrades[g]) W.upgrades[g][id].forEach(add);
      const rows = Object.keys(need).map((id) => {
        const m = bestMap(id),
          per = m ? sims[m].mean[id] : 0;
        return { id, n: need[id], m, per, raids: per ? need[id] / per : Infinity };
      });
      rows.sort((a, b) => b.raids - a.raids);
      tb.innerHTML =
        '<tr><th>предмет</th><th class="num">нужно</th><th>лучше всего падает</th>' +
        '<th class="num">в среднем за рейд</th><th class="num">рейдов</th></tr>';
      for (const r of rows) {
        const tr = h('tr');
        tr.append(
          itemCell(r.id),
          h('td', 'num', String(r.n)),
          h('td', r.m ? '' : 'red', r.m ? esc(MAP[r.m] || r.m) : 'не падает нигде'),
          h('td', 'num', r.m ? fmt(r.per) : '—'),
          h('td', 'num', r.m ? '≈ ' + fmt(r.raids) : '—'),
        );
        tb.append(tr);
      }
    });
    main.append(sum, h('h2', '', 'Что падает из контейнеров'));

    const grid = h('div', 'grid');
    for (const l of W.loot) {
      const card = h('div', 'card');
      const ups = []; // the rows' computed cells, refilled after any number of this map changes
      const changed = () => {
        for (const fn of ups) fn();
        resim();
      };
      const knobs = h('div', 'knobs');
      const k1 = h('label', '', 'контейнеров за рейд');
      k1.append(num(l, 'boxes', 1, 200, changed));
      const k2 = h('label', '', 'бросков на контейнер');
      k2.append(num(l, 'rolls', 1, 10, changed));
      knobs.append(k1, k2);
      card.append(h('h3', '', esc(MAP[l.map] || l.map)), knobs);
      const t = h('table');
      t.innerHTML =
        '<tr><th>предмет</th><th class="num">вес</th><th class="num">шанс</th><th class="num">от</th>' +
        '<th class="num">до</th><th class="num">за рейд</th><th></th></tr>';
      l.table.forEach((e, i) => {
        const chance = h('td', 'num'),
          per = h('td', 'num');
        ups.push(() => {
          const total = l.table.reduce((s, x) => s + x[1], 0);
          chance.textContent = Math.round((e[1] / total) * 1000) / 10 + '%';
          per.textContent = fmt((l.boxes * l.rolls * e[1] * (e[2] + e[3])) / 2 / total);
        });
        const x = h('button', 'btn', '×');
        x.title = 'убрать';
        x.disabled = l.table.length < 2;
        x.onclick = () => {
          l.table.splice(i, 1);
          simulate();
          render();
        };
        const xt = h('td');
        xt.append(x);
        const tr = h('tr');
        tr.append(
          itemCell(e[0]),
          numCell(num(e, 1, 1, 1000, changed)),
          chance,
          numCell(num(e, 2, 1, 99, changed)),
          numCell(num(e, 3, 1, 99, changed)),
          per,
          xt,
        );
        t.append(tr);
      });
      for (const fn of ups) fn();
      const add = h('button', 'btn', '+ предмет');
      add.style.marginTop = '8px';
      add.onclick = (ev) =>
        pick(
          ev.currentTarget,
          ['material'],
          l.table.map((e) => e[0]),
          (id) => {
            l.table.push([id, 1, 1, 1]);
            simulate();
            render();
          },
        );
      card.append(t, add);
      grid.append(card);
    }
    main.append(grid);
  }

  function render() {
    const main = $('#main'),
      y = scrollY;
    main.innerHTML = '';
    calcs = [];
    for (const b of document.querySelectorAll('.tabs button'))
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    if (tab === 'ups') tabUps(main);
    else if (tab === 'loot') tabLoot(main);
    else tabBuild(main);
    scrollTo(0, y);
    refresh();
  }

  // ---------- load and save ----------
  function take(state) {
    S = state;
    W = clone(state);
    simulate();
    render();
  }
  async function load() {
    let r = null;
    try {
      r = await fetch(API, { cache: 'no-store' });
    } catch (e) {
      console.warn('econ load', e);
    }
    if (!r || !r.ok) {
      $('#fail').style.display = 'block';
      $('header').style.display = 'none';
      return;
    }
    take(await r.json());
  }
  async function save() {
    if ($('#save').disabled) return;
    const st = $('#status');
    $('#save').disabled = true;
    st.className = '';
    st.textContent = 'сохраняю…';
    let r = null,
      j = {};
    try {
      r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stamp: S.stamp, ...editable(W) }),
      });
      j = await r.json();
    } catch (e) {
      console.warn('econ save', e);
    }
    if (!r || !r.ok) {
      st.className = 'err';
      st.textContent = !r
        ? 'сервер редактора не отвечает'
        : r.status === 409
          ? 'файл изменился на диске: обнови страницу'
          : 'не сохранено: ' + (j.error || r.status);
      $('#save').disabled = false;
      setTimeout(() => {
        st.classList.remove('err');
        refresh();
      }, 8000);
      return;
    }
    take(j);
    st.textContent = 'сохранено в economy.js';
  }

  for (const b of document.querySelectorAll('.tabs button'))
    b.onclick = () => {
      tab = b.dataset.tab;
      try {
        localStorage.setItem(TAB_KEY, tab);
      } catch (e) {
        console.warn('econ tab', e);
      }
      render();
    };
  try {
    tab = localStorage.getItem(TAB_KEY) || tab;
  } catch (e) {
    console.warn('econ tab', e);
  }
  $('#save').onclick = save;
  $('#undo').onclick = () => take(S);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
  addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
  });
  load();
})();
