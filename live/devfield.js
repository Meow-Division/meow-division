// live/devfield.js — the dev field (index.html?dev&field, a local page only): an empty run (no zombies, the hero can't die) and a
// panel of sliders for how the hero moves, changed while he walks: the sim's speed × and how much of the same-ground-speed rule
// holds (S.tune: sim.js updatePlayer), the medbay's speed level and the boots' (the speed upgrades a player buys), and the gait's
// numbers (HERO_TUNE.motion: the walk's stride, the speed the run starts at, the legs' and the upper body's turn toward the aim, the
// lean). Nothing is saved to the game's files: the values stay in this browser (localStorage) and "Скопировать" puts them on the
// clipboard to hand over.
(function () {
  const KEY = 'devfield3'; // (2: the defaults moved to the human's first picks; 3: the run from the base speed, ×1)
  const ROWS = [
    // [key, label, least, most, step, default, where]
    ['g', 'Выравнивание по земле (0 — одинаково по экрану, 1 — ×1 по земле)', 0, 1, 0.05, 0.7, 'sim'],
    ['k', 'Базовая скорость × (к 230 px/с)', 0.6, 1.8, 0.05, 1, 'sim'],
    ['med', 'Скорость в медпункте, уровень', 0, 5, 1, 0, 'meta'],
    ['boots', 'Ботинки в забеге, уровень', 0, 5, 1, 0, 'boots'],
    ['stride', 'Длина шага (ходьба и бег)', 0.5, 2.5, 0.05, 0.75, 'motion'],
    ['runFrom', 'Бег со скорости × (1 — сразу с базовой)', 1, 1.8, 0.01, 1, 'motion'],
    ['legs', 'Ноги к прицелу, до °', 0, 90, 1, 90, 'motion'],
    ['twist', 'Корпус к прицелу, до °', 0, 130, 1, 30, 'motion'],
    ['lean', 'Наклон вперёд на ходу, °', 0, 15, 0.5, 0, 'motion'],
  ];
  let V = {};
  try {
    V = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch (e) {}
  for (const r of ROWS) if (typeof V[r[0]] !== 'number') V[r[0]] = r[5];
  const keep = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(V));
    } catch (e) {}
  };

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;right:10px;top:70px;width:330px;z-index:9999;background:#0b1020e8;color:#e8eefc;font:12px/1.35 sans-serif;padding:10px 12px;border-radius:10px;border:1px solid #3f6fe0;max-height:calc(100vh - 90px);overflow:auto';
  box.innerHTML =
    '<b style="color:#ffd23a">Тестовое поле</b> <span style="opacity:.7">(без зомби, бессмертие)</span><div id="dfr"></div><div id="dfo" style="margin:8px 0;color:#9fe"></div>' +
    '<button id="dfc" style="margin-right:6px">Скопировать</button><button id="dfz">Как было</button> <label style="margin-left:6px"><input type="checkbox" id="dfm"> зомби</label>';
  const rowsEl = box.querySelector('#dfr');
  for (const [k, label, lo, hi, st] of ROWS) {
    const w = document.createElement('div');
    w.style.margin = '7px 0 0';
    w.innerHTML = `<div>${label}: <b data-v="${k}"></b></div><input type="range" min="${lo}" max="${hi}" step="${st}" data-k="${k}" style="width:100%">`;
    rowsEl.append(w);
  }
  const show = () => {
    for (const r of ROWS) {
      box.querySelector(`[data-k="${r[0]}"]`).value = V[r[0]];
      box.querySelector(`[data-v="${r[0]}"]`).textContent = +V[r[0]].toFixed(r[4] < 1 ? 2 : 0);
    }
  };
  let retuneT = 0;
  const motion = () => {
    const T = (window.HERO_TUNE = window.HERO_TUNE || {});
    T.motion = Object.assign({}, T.motion, {
      stride: V.stride,
      runFrom: V.runFrom,
      legs: V.legs,
      twist: V.twist,
      lean: V.lean,
    });
    clearTimeout(retuneT);
    retuneT = setTimeout(() => window.HERO3D && HERO3D.retune && HERO3D.retune(T), 120);
  };
  // the run's state each frame: the sliders' speed and ground share, the medbay's level, the boots, no zombies, no death
  let calm = true;
  const apply = () => {
    const S = window.GAME && GAME.play;
    if (!S || S.over || S.hub) return;
    S.tune = { k: V.k, g: V.g };
    const p = S.p;
    p.god = true;
    if (calm) {
      S.calm = 1;
      S.en.length = 0;
    } else S.calm = 0;
    let dirty = false;
    const meta = p.meta || S.meta;
    if (meta && (meta.speed || 0) !== V.med) {
      meta.speed = V.med;
      dirty = true;
    }
    const it = p.items.find((i) => i.id === 'boots');
    if (V.boots === 0 && it) {
      p.items.splice(p.items.indexOf(it), 1);
      dirty = true;
    } else if (V.boots > 0 && (!it || it.lvl !== V.boots)) {
      if (it) it.lvl = V.boots;
      else p.items.push(Object.assign(SIM.newItem('boots'), { lvl: V.boots }));
      dirty = true;
    }
    if (dirty) {
      const was = S.p;
      S.p = p;
      SIM.recalc(S);
      S.p = was;
    }
    const sx = Math.hypot(p.vx, p.vy),
      gr = Math.hypot(p.vx, 2 * p.vy),
      top = (p.st.speed * V.k) / SIM.HERO_V;
    box.querySelector('#dfo').innerHTML =
      `скорость по экрану <b>${sx.toFixed(0)}</b> px/с, по земле <b>${gr.toFixed(0)}</b><br>` +
      `максимум ×<b>${top.toFixed(2)}</b> → ${top >= V.runFrom - 1e-6 ? '<b style="color:#ffb347">бег</b>' : '<b>ходьба</b>'}`;
  };
  box.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (!k) return;
    V[k] = +e.target.value;
    keep();
    show();
    motion();
  });
  box.querySelector('#dfc').onclick = () => {
    const t = JSON.stringify(V);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
      () => (box.querySelector('#dfc').textContent = 'Скопировано'),
      () => prompt('Скопируй:', t),
    );
  };
  box.querySelector('#dfz').onclick = () => {
    for (const r of ROWS) V[r[0]] = r[5];
    keep();
    show();
    motion();
  };
  box.querySelector('#dfm').onchange = (e) => (calm = !e.target.checked);
  document.body.append(box);
  show();
  // the run: once the world is in, with the gun picked in the lobby; again whenever it ends
  const go = () => {
    if (!window.GAME) return;
    if (!GAME.play || GAME.play.over) GAME.start((window.SAVE && SAVE.selected) || 'pistol');
  };
  setTimeout(motion, 1500);
  let goT = 0;
  setInterval(() => {
    apply();
    // (tried again every 2 s until a run is up: the first tries can come while the world or the gun is still loading)
    const now = Date.now();
    if (window.GAME && (!GAME.play || GAME.play.over) && now - goT > 2000) {
      goT = now;
      go();
    }
  }, 100);
})();
