// live/voice.js — Nova's and Walt's lines (docs/voice.md) in a run and at the base: a subtitle box over the bottom of
// the screen (the speaker's face when its picture is there, else only the name; the line in the player's language,
// voice.<id>) and the recording (live/audio/voice/<who>_NN.mp3) when there is one. A mission's script says a line as a
// sim event ('voice', id); sync() hears each one once. Lines come one after another: one said while another is up
// waits until that one has been read (or heard) to the end. The box is the intro's (style.css #intro .isub): one look
// for the radio.
(function () {
  const V = (window.VOICE = {});
  const T = (k, v) => I18N.t(k, v);
  // how long a line stays without its recording: READ ms a letter, between MIN and MAX; with it, TAIL ms past its end
  // (LONG at the most); GAP ms between two lines (the box fades out and in)
  const READ = 62,
    MIN = 3500,
    MAX = 9000,
    TAIL = 700,
    LONG = 20000,
    GAP = 450;
  const url = (f) => f + '?v=' + (window.__V || 0);
  // the lines recorded in a language of their own (live/audio/voice/<lang>/<who>_NN.mp3: docs/voice.md); the others are
  // heard in English under that language's subtitles
  const DUB = {
    uk: 'nova.1 nova.19 nova.24 nova.20 nova.4 nova.5 nova.21 nova.6 nova.7 nova.22 nova.8 nova.9 nova.10 nova.23 nova.11 nova.12 nova.13 copper.1 copper.2 walt.1',
  };
  // the voice the player picked in the settings (the human's, 2026-11-12): English, a language with lines of its own (DUB),
  // or 'off' (the words alone); not picked, the game's language's when it has its own lines, else English
  V.LANGS = ['en'].concat(Object.keys(DUB));
  const VK = 'md-voice';
  V.pick = () => {
    let v = null;
    try {
      v = localStorage.getItem(VK);
    } catch (e) {}
    if (v === 'off' || V.LANGS.includes(v)) return v;
    const lg = window.I18N && I18N.lang;
    return DUB[lg] ? lg : 'en';
  };
  V.setPick = (v) => {
    if (v !== 'off' && !V.LANGS.includes(v)) return;
    try {
      localStorage.setItem(VK, v);
    } catch (e) {}
  }; // (from the next line on: one being said ends as it is)
  // a line's recording in the voice picked (intro.js asks it too); null: no voice
  V.file = (id) => {
    const lg = V.pick();
    if (lg === 'off') return null;
    const [who, k] = id.split('.'),
      own = DUB[lg] && DUB[lg].split(' ').includes(id);
    return 'audio/voice/' + (own ? lg + '/' : '') + who + '_' + String(k).padStart(2, '0') + '.mp3';
  };
  // what this page learnt: the faces that loaded or not, the recordings that are missing (asked once a visit)
  const face = {},
    deaf = {};
  const queue = [], // the lines waiting their turn: { id, low }
    said = {}; // (lines with no recording, their text given here: V.mind)
  let box = null,
    timer = 0,
    endAt = 0, // (when the line up ends without its recording: performance.now ms)
    sound = null,
    now = '', // the line up ('' none)
    serial = 0; // (each line its number: a timer or a recording of one gone by is ignored)

  function build() {
    const ui = document.getElementById('ui');
    box = document.createElement('div');
    box.id = 'vbox';
    box.innerHTML =
      '<div class="isub" role="status"><div class="iface"><img alt="" draggable="false"></div>' +
      '<div class="isb"><div class="inm"><span class="ibars"><i></i><i></i><i></i><i></i></span><b></b></div>' +
      '<p></p></div></div>';
    ui.appendChild(box);
  }
  // the speaker's picture (assets/por_<who>.png): shown once it has loaded, the name alone when there is none
  function portrait(who) {
    const sub = box.querySelector('.isub'),
      img = box.querySelector('.iface img');
    sub.classList.toggle('noface', face[who] === false);
    if (face[who] === false || img.dataset.who === who) return;
    img.dataset.who = who;
    img.classList.remove('in');
    img.onload = () => {
      face[who] = true;
      img.classList.add('in');
    };
    img.onerror = () => {
      face[who] = false;
      sub.classList.add('noface');
    };
    img.src = url('assets/por_' + who + '.png');
  }
  const duck = (on) => window.AUDIO && AUDIO.duck && AUDIO.duck(on); // (the music and the battle step back under her)
  function stop() {
    clearTimeout(timer);
    if (sound) {
      sound.pause();
      duck(false);
    }
    sound = null;
  }
  // the next line waiting, or none
  function next() {
    stop();
    const q = queue.shift();
    now = q ? q.id : '';
    if (q) show(q, ++serial);
  }
  function show(q, n) {
    const [who] = q.id.split('.');
    if (!box) build();
    const sub = box.querySelector('.isub'),
      line = text(q.id);
    box.classList.toggle('low', q.low);
    box.querySelector('.inm b').textContent = T('voice.name.' + who);
    box.dataset.who = who; // (the speaker's colour, and the hero's lines on the right: style.css)
    typeLine(box.querySelector('.isb p'), line, n);
    portrait(who);
    sub.classList.remove('on');
    void sub.offsetWidth; // (a new line comes in anew: its entrance plays again)
    sub.classList.add('on');
    // the line ends ms from now: the box goes, and after GAP the next line comes
    const end = (ms) => {
      if (n !== serial) return;
      endAt = performance.now() + ms;
      clearTimeout(timer);
      timer = setTimeout(() => {
        sub.classList.remove('on');
        timer = setTimeout(next, GAP);
      }, ms);
    };
    end(Math.min(MAX, Math.max(MIN, Array.from(line).length * READ)));
    const file = V.file(q.id);
    if (!file || said[q.id] || deaf[file] || !window.AUDIO || !AUDIO.on) return; // (a line written for this run: no recording)
    const a = (sound = new Audio(url(file)));
    if (AUDIO.voice) AUDIO.voice(a);
    a.addEventListener('playing', () => {
      end(LONG); // (heard: it ends with the recording)
      if (sound === a) duck(true);
    });
    a.addEventListener('ended', () => {
      end(TAIL);
      if (sound === a) duck(false);
    });
    a.addEventListener('error', () => {
      deaf[file] = true; // (not recorded yet: the subtitle alone, as above)
    });
    const p = a.play();
    if (p) p.catch(() => (deaf[file] = true));
  }
  // the line typed out a letter at a time, as a game's dialogue box does, quickly (about 45 letters a second, at most
  // TYPE ms): what is still to come is laid out unseen behind it, so the box never grows while it types
  const TYPE = 1600;
  function typeLine(p, line, n) {
    const chars = Array.from(line),
      ms = Math.min(TYPE, chars.length * 22),
      t0 = performance.now(),
      shown = document.createElement('span'),
      rest = document.createElement('span');
    rest.className = 'irest';
    p.replaceChildren(shown, rest);
    let k = -1;
    const step = () => {
      if (n !== serial) return;
      const at = Math.min(chars.length, Math.ceil(((performance.now() - t0) / ms) * chars.length));
      if (at !== k) {
        k = at;
        shown.textContent = chars.slice(0, k).join('');
        rest.textContent = chars.slice(k).join('');
      }
      if (k < chars.length) requestAnimationFrame(step);
    };
    step();
  }
  const text = (id) => said[id] || T('voice.' + id);
  // Nova's line on what the final boss learnt between runs (the run's mind: sim.js MIND; 'voice' nova.mind as his fight
  // begins): say, NEAR AI's words in the player's language (server/bossmind.mjs), else her plain one from the tactics
  // (mind.*: the first sentence, then one for each tactic; flank says the side). No mind: none
  V.mind = (m, say) => {
    if (!m || !Array.isArray(m.tac) || !m.tac.length) return void delete said['nova.mind'];
    said['nova.mind'] =
      (typeof say === 'string' && say) ||
      [T('mind.head')]
        .concat(m.tac.map((id) => T('mind.' + (id === 'flank' ? (m.side < 0 ? 'flank_l' : 'flank_r') : id))))
        .join(' ');
  };
  // a line: id 'nova.3' or 'walt.1'; low: the box at the very bottom (the base: no weapon slots under it). It waits its
  // turn behind the ones before it; one already up or waiting is not said twice
  V.say = (id, low) => {
    if (now === id || queue.some((q) => q.id === id)) return;
    queue.push({ id, low: !!low });
    if (!now) next();
  };
  // nothing said and nothing waiting (a mission's talk is over: ui.js tells the sim; its screens' picks wait for it)
  V.idle = () => !now && !queue.length;
  // about how long until it is (ms): the line up (its recording's rest, else its subtitle's), and the ones waiting
  V.left = () => {
    if (V.idle()) return 0;
    let ms =
      sound && !sound.paused && isFinite(sound.duration)
        ? (sound.duration - sound.currentTime) * 1000 + TAIL
        : Math.max(0, endAt - performance.now());
    for (const q of queue) ms += GAP + Math.min(MAX, Math.max(MIN, Array.from(text(q.id)).length * READ));
    return ms + GAP;
  };
  // every line gone at once (the run left, the base closed)
  V.hide = () => {
    queue.length = 0;
    serial++;
    now = '';
    stop();
    if (box) box.querySelector('.isub').classList.remove('on');
  };
  // a run's state each frame (ui.js sync): the voice lines its sim has said (its 'voice' events of the last 3 s, as
  // long as the sim keeps them), each one once and in order; a new run starts afresh. No run (the menus): no lines
  let menus = false,
    run = null;
  const heard = new Set();
  V.sync = (S) => {
    if (!S) {
      if (!menus) V.hide();
      menus = true;
      return;
    }
    menus = false;
    if (box) box.classList.toggle('over', !!S.pause); // (a card screen up: the box over it, at the very bottom)
    if (S.wt0 !== run) {
      run = S.wt0;
      heard.clear();
    }
    const E = S.ev;
    let i = E.length;
    while (i > 0 && S.t - E[i - 1].t < 3) i--;
    for (; i < E.length; i++) {
      const e = E[i];
      if (e.k !== 'voice' || heard.has(e.t + ':' + e.id)) continue;
      heard.add(e.t + ':' + e.id);
      V.say(e.id);
    }
  };
})();
