// live/voice.js — Nova's and Walt's lines (docs/voice.md) in a run and at the base: a subtitle box over the bottom of
// the screen (the speaker's face when its picture is there, else only the name; the line in the player's language,
// voice.<id>) and the recording (live/audio/voice/<who>_NN.ogg) when there is one. A mission's script says a line as a
// sim event (sim.js S.mis.say); sync() shows each one once. The box is the intro's (style.css #intro .isub): one look
// for the radio.
(function () {
  const V = (window.VOICE = {});
  const T = (k, v) => I18N.t(k, v);
  // how long a line stays without its recording: READ ms a letter, between MIN and MAX; with it, TAIL ms past its end
  const READ = 62,
    MIN = 3500,
    MAX = 9000,
    TAIL = 700;
  const url = (f) => f + '?v=' + (window.__V || 0);
  // what this page learnt: the faces that loaded or not, the recordings that are missing (asked once a visit)
  const face = {},
    deaf = {};
  let box = null,
    timer = 0,
    sound = null,
    seen = '';

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
  // a line: id 'nova.3' or 'walt.1'; low: the box at the very bottom (the base: no weapon slots under it)
  V.say = (id, low) => {
    const [who, n] = id.split('.');
    if (!box) build();
    stop();
    const sub = box.querySelector('.isub'),
      line = T('voice.' + id);
    box.classList.toggle('low', !!low);
    box.querySelector('.inm b').textContent = T('voice.name.' + who);
    box.querySelector('.isb p').textContent = line;
    portrait(who);
    sub.classList.add('on');
    const hide = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => sub.classList.remove('on'), ms);
    };
    hide(Math.min(MAX, Math.max(MIN, Array.from(line).length * READ)));
    const file = 'audio/voice/' + who + '_' + String(n).padStart(2, '0') + '.ogg';
    if (deaf[file] || !window.AUDIO || !AUDIO.on) return;
    const a = (sound = new Audio(url(file)));
    a.addEventListener('error', () => {
      deaf[file] = true; // (not recorded yet: the subtitle alone, as above)
    });
    a.addEventListener('ended', () => hide(TAIL));
    const p = a.play();
    if (p) p.catch(() => (deaf[file] = true));
  };
  V.hide = () => {
    stop();
    if (box) box.querySelector('.isub').classList.remove('on');
  };
  // a run's state each frame (ui.js sync): a line its mission's script has just said, once (one said long before, as
  // in a run back from a reload, is not said again); no run (the menus): no box
  let menus = false; // (no run: the box hidden once)
  V.sync = (S) => {
    if (!S) {
      if (!menus && box) V.hide();
      menus = true;
      return;
    }
    menus = false;
    const say = S.mis ? S.mis.say : null;
    if (!say) return;
    const key = S.wt0 + ':' + S.mis.id + ':' + say.id + ':' + say.t; // (wt0: the run's start: a retry says it again)
    if (key === seen) return;
    seen = key;
    if (S.t - say.t < 3) V.say(say.id);
  };
})();
