// live/voice.js — Nova's and Walt's lines (docs/voice.md) in a run and at the base: a subtitle box over the bottom of
// the screen (the speaker's face when its picture is there, else only the name; the line in the player's language,
// voice.<id>) and the recording (live/audio/voice/<who>_NN.ogg) when there is one. A mission's script says a line as a
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
  // what this page learnt: the faces that loaded or not, the recordings that are missing (asked once a visit)
  const face = {},
    deaf = {};
  const queue = []; // the lines waiting their turn: { id, low }
  let box = null,
    timer = 0,
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
  function stop() {
    clearTimeout(timer);
    if (sound) sound.pause();
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
    const [who, k] = q.id.split('.');
    if (!box) build();
    const sub = box.querySelector('.isub'),
      line = T('voice.' + q.id);
    box.classList.toggle('low', q.low);
    box.querySelector('.inm b').textContent = T('voice.name.' + who);
    box.querySelector('.isb p').textContent = line;
    portrait(who);
    sub.classList.add('on');
    // the line ends ms from now: the box goes, and after GAP the next line comes
    const end = (ms) => {
      if (n !== serial) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        sub.classList.remove('on');
        timer = setTimeout(next, GAP);
      }, ms);
    };
    end(Math.min(MAX, Math.max(MIN, Array.from(line).length * READ)));
    const file = 'audio/voice/' + who + '_' + String(k).padStart(2, '0') + '.ogg';
    if (deaf[file] || !window.AUDIO || !AUDIO.on) return;
    const a = (sound = new Audio(url(file)));
    a.addEventListener('playing', () => end(LONG)); // (heard: it ends with the recording)
    a.addEventListener('ended', () => end(TAIL));
    a.addEventListener('error', () => {
      deaf[file] = true; // (not recorded yet: the subtitle alone, as above)
    });
    const p = a.play();
    if (p) p.catch(() => (deaf[file] = true));
  }
  // a line: id 'nova.3' or 'walt.1'; low: the box at the very bottom (the base: no weapon slots under it). It waits its
  // turn behind the ones before it; one already up or waiting is not said twice
  V.say = (id, low) => {
    if (now === id || queue.some((q) => q.id === id)) return;
    queue.push({ id, low: !!low });
    if (!now) next();
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
