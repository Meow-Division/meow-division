// gen/balreport.cjs — the balance lab's report (balance/report.html): the same accounts (balance/stages.json) played by the bot before and
// after a change (gen/balance.cjs <name> stages), and each gun's damage a second against one target as the rules give it (no bot: the
// numbers alone), old and new. Findings and changes come from balance/notes.json ({ findings, changes, stages: [before, after],
// oldLive: a copy of the old rules' live/ folder }).
// node gen/balreport.cjs
const fs = require('node:fs'), path = require('node:path');
const DIR = path.join(__dirname, '..', 'balance');
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n + '.json'), 'utf8'));
const notes = JSON.parse(fs.readFileSync(path.join(DIR, 'notes.json'), 'utf8'));
const [S0, S1] = notes.stages.map(load), STAGES = JSON.parse(fs.readFileSync(path.join(DIR, 'stages.json'), 'utf8'));
// the old rules first, then the globals they leave (data.js and sim.js publish DATA / SIM / MAP on globalThis, and sim.js takes the
// DATA it finds there) cleared before the new ones load
const OLD = { D: require(notes.oldLive + '/data.js'), SIM: require(notes.oldLive + '/sim.js') };
for (const k of ['DATA', 'SIM', 'MAP', 'RULES', 'REPLAY']) delete globalThis[k];
const NEW = { D: require('../live/data.js'), SIM: require('../live/sim.js') };

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmtT = (s) => { if (s === null) return '—'; const r = Math.round(s); return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); };
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GUN = { pistol: 'Пистолет', shotgun: 'Дробовик', smg: 'Автомат', minigun: 'Миниган', sniper: 'Снайперка', flame: 'Огнемёт', rocket: 'Ракетница' };
const of = (R, id) => R.stages.filter((r) => r.stage === id);
const minuteDmg = (r) => { const m = []; for (let i = 0; i < 10; i++) m.push((r.bins[2 * i] ? r.bins[2 * i].dmg : 0) + (r.bins[2 * i + 1] ? r.bins[2 * i + 1].dmg : 0)); return m; };

function stageTable() {
  const cell = (R, id) => { const rs = of(R, id), bt = (k) => { const v = rs.map((r) => r.bosses[k] && r.bosses[k].ttk).filter((x) => x != null); return v.length ? med(v) : null; };
    const b = ['butcher', 'pustule', 'screamer', 'golem'].map(bt).filter((x) => x !== null);
    return { t: med(rs.map((r) => Math.min(600, r.t))), d: med(rs.map((r) => r.deaths.length)), b: b.length === 4 ? b.reduce((x, y) => x + y, 0) : null, n: rs.length }; };
  let h = '<div class="scroll"><table class="data"><thead><tr><th rowspan="2">аккаунт</th><th colspan="2">до первой смерти</th><th colspan="2">смертей за забег</th><th colspan="2">4 босса убиты за</th></tr><tr><th>было</th><th>стало</th><th>было</th><th>стало</th><th>было</th><th>стало</th></tr></thead><tbody>';
  for (const st of STAGES) { const a = cell(S0, st.id), b = cell(S1, st.id), T = NEW.D.threatOf(st.meta, st.wup);
    h += `<tr><th>${esc(st.name)}<br><span class="mute">теперь зомби ×${T.hp.toFixed(2)}, боссы ×${T.boss.toFixed(2)}, их урон ×${T.dmg.toFixed(2)}</span></th>
      <td>${fmtT(a.t)}</td><td class="now">${fmtT(b.t)}</td><td>${a.d}</td><td class="now">${b.d}</td>
      <td>${a.b === null ? '—' : Math.round(a.b) + ' с'}</td><td class="now">${b.b === null ? '—' : Math.round(b.b) + ' с'}</td></tr>`; }
  return h + `</tbody></table></div><p class="mute">По ${cell(S1, STAGES[0].id).n} забегов на каждый аккаунт, одни и те же забеги до и после. Медианы. Бот после смерти встаёт и доигрывает, поэтому «смертей за забег» показывает, сколько раз забег убил бы его целиком.</p>`;
}
function heat(R, label) {
  const cell = (v) => { const k = Math.min(1, v / 1.5); return `background: color-mix(in oklch, var(--heat) ${Math.round(6 + k * 94)}%, var(--surface)); color: ${k > 0.55 ? 'var(--on-heat)' : 'var(--fg)'}`; };
  let h = `<div class="scroll"><table class="heat"><caption>${esc(label)}</caption><thead><tr><th></th>${Array.from({ length: 10 }, (_, k) => `<th>${k + 1}</th>`).join('')}</tr></thead><tbody>`;
  for (const st of STAGES) { const m = of(R, st.id).map(minuteDmg), v = Array.from({ length: 10 }, (_, k) => med(m.map((x) => x[k])));
    h += `<tr><th>${esc(st.short || st.name)}</th>${v.map((x, k) => `<td style="${cell(x || 0)}" title="${esc(st.name)}, ${k + 1}-я минута: ${Math.round((x || 0) * 100)}% здоровья за минуту">${x === null ? '—' : Math.round(x * 100)}</td>`).join('')}</tr>`; }
  return h + '</tbody></table></div>';
}
function dpsTable() {
  const T = { zero: [{}, {}], mid: [{ dmg: 2 }, { dmg: 2, rate: 2, mag: 2 }], max: [{ dmg: 5 }, { dmg: 5, rate: 5, mag: 5 }] };
  const dps = (R, gun, m, u, newFlame) => { const S = R.SIM.create({ weapon: gun, meta: m, wup: u, seed: 7 }), s = R.SIM.mainStats(S), d = R.D.MAIN[gun];
    const rate = gun === 'flame' ? (1 / d.tick) * (newFlame ? 1 + R.D.WEAPON_UP.rate.per * (u.rate || 0) : 1) : s.rate, per = s.dmg * (s.pellets || 1) * (s.multi || 1), fire = s.mag / rate;
    return Math.round(per * rate * fire / (fire + s.rl)); };
  let h = '<div class="scroll"><table class="data"><thead><tr><th rowspan="2">пушка</th><th colspan="2">без улучшений</th><th colspan="2">всё по 2</th><th colspan="2">всё по 5</th></tr><tr>' + '<th>было</th><th>стало</th>'.repeat(3) + '</tr></thead><tbody>';
  for (const g of Object.keys(GUN)) { h += `<tr><th>${GUN[g]}</th>`;
    for (const k in T) { const a = dps(OLD, g, ...T[k], false), b = dps(NEW, g, ...T[k], true); h += `<td>${a}</td><td${b > a ? ' class="up"' : ''}>${b}</td>`; }
    h += '</tr>'; }
  return h + '</tbody></table></div>';
}
const list = (a) => (a && a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
const n0 = S0.stages.length + S1.stages.length;

const html = `<title>Лаборатория баланса</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@600;800&family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* layout: one reading column — what was found and changed, then the measurements as tables */
:root {
  --bg: #f3f2ec; --surface: #fbfaf6; --fg: #1c1f1a; --muted: #6b6f62; --line: #dcdace; --heat: #c2410c; --on-heat: #fff8f0; --accent: #b4530a; --good: #1d7a3a; --bad: #b42318;
  --display: "Rubik", "Trebuchet MS", sans-serif; --body: "Golos Text", "Segoe UI", sans-serif; --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #14171a; --surface: #1b1f23; --fg: #eceae2; --muted: #a3a69a; --line: #30353a; --heat: #f07a3a; --on-heat: #1a0d05; --accent: #f0a050; --good: #5fd383; --bad: #ff8a7a; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #14171a; --surface: #1b1f23; --fg: #eceae2; --muted: #a3a69a; --line: #30353a; --heat: #f07a3a; --on-heat: #1a0d05; --accent: #f0a050; --good: #5fd383; --bad: #ff8a7a; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 28px 56px; }
main { max-width: 820px; margin: 0 auto; display: grid; gap: 34px; }
header { display: grid; gap: 6px; }
.eyebrow { font: 600 12px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
h1 { font: 800 clamp(28px, 5vw, 40px)/1.1 var(--display); margin: 0; text-wrap: balance; }
h2 { font: 800 21px/1.25 var(--display); margin: 0; text-wrap: balance; }
section { display: grid; gap: 12px; min-width: 0; }
p { margin: 0; max-width: 66ch; } .mute { color: var(--muted); } .lead { font-size: 16.5px; }
ul { margin: 0; padding-left: 1.2em; display: grid; gap: 8px; max-width: 70ch; }
code { font: 13px var(--mono); background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
.meta { font: 13px var(--mono); color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: grid; gap: 10px; min-width: 0; }
.scroll { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
caption { text-align: left; font: 600 13px var(--body); color: var(--muted); padding-bottom: 6px; }
.heat th, .heat td { padding: 7px 4px; text-align: center; font: 600 12.5px var(--mono); min-width: 32px; }
.heat td { border: 2px solid var(--surface); border-radius: 4px; } .heat thead th { color: var(--muted); font-weight: 400; } .heat tbody th { text-align: left; white-space: nowrap; padding-right: 10px; font: 500 13px var(--body); }
.data th, .data td { padding: 7px 8px; text-align: left; border-top: 1px solid var(--line); font-size: 13.5px; vertical-align: top; }
.data thead th { color: var(--muted); font-weight: 500; font-size: 12.5px; border-top: 0; } .data td { font-family: var(--mono); font-size: 13px; } .data th .mute { font-size: 12px; font-weight: 400; }
.data td.up { color: var(--good); font-weight: 600; } .data td.now { font-weight: 600; }
.two { display: grid; gap: 22px; }
</style>
<main>
<header><span class="eyebrow">Zombie Horde · правила забега версии ${NEW.SIM.REV}</span><h1>Где игра слишком трудная, а где слишком лёгкая</h1>
<p class="meta">${n0} забегов бота до и после правок · ${new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}</p></header>
<section><p class="lead">Бот играет как осторожный игрок: бегает от толпы, целится в ближнюю угрозу, собирает опыт и сундуки, уходит от атак боссов, которые видит, и выбирает перки. После смерти он встаёт и доигрывает забег до конца.</p>
<p class="mute">Уворачивается он хуже человека, поэтому сами минуты у живого игрока будут другими. Надёжна разница между этапами прокачки и между «было» и «стало»: это одни и те же забеги одного и того же бота. Таблица урона пушек посчитана прямо из правил, без бота.</p></section>
<section><h2>Что видно</h2>${list(notes.findings)}</section>
<section><h2>Что поменял</h2>${list(notes.changes)}</section>
<section><h2>Одни и те же аккаунты до и после</h2><div class="card">${stageTable()}</div></section>
<section><h2>Урон по минутам забега</h2><p class="mute">Сколько процентов здоровья бот теряет за каждую минуту (медиана). 100 значит, что за минуту ушло всё здоровье. Боссы приходят на 3-й, 6-й, 8-й и 10-й минуте.</p>
<div class="card"><div class="two">${heat(S0, 'было')}${heat(S1, 'стало')}</div></div></section>
<section><h2>Урон пушек по одной цели</h2><p class="mute">Урон в секунду с учётом магазина и перезарядки, без уровней внутри забега. У дробовика считаются все дробинки в цель, у ракетницы и огнемёта не учтён урон по толпе вокруг.</p>
<div class="card">${dpsTable()}</div></section>
<section><h2>Проверить самому</h2><p>Открой игру с <code>?lab</code> в адресе: <code>baldingalex.fun/?lab</code>. Там отдельный тестовый прогресс, настоящий аккаунт и рейтинг не трогаются. Внизу слева кнопка «ЛАБ»: этапы от нового аккаунта до полной прокачки, монеты, ранг и журнал забегов с уроном по минутам. Кнопка «скопировать отчёт» копирует журнал, его можно прислать мне. В забеге работают клавиши F1 (уровень), F2 (+1 минута), F3 (бессмертие), F4 (толпа), F5 (босс), на телефоне те же кнопки есть в меню паузы.</p></section>
</main>`;
fs.writeFileSync(path.join(DIR, 'report.html'), html);
console.log('wrote balance/report.html', Math.round(html.length / 1024) + ' KB');
