// live/intro.js — the intro before mission 1 (docs/design.md, the player's path, step 2): the NEAR AI office at dawn, the place
// and the time typed out, then Nova's first order over the radio (docs/voice.md, nova.1), then the run. Shown each time mission
// 1's script is played (the lobby's and the campaign's PLAY, the map editor's try: index.html ?mission=office); Skip, any key or
// a tap goes straight to the run. Built from the lobby's kit (ui.js U.kit). SAVE.seen('intro') notes it was seen once.
(function () {
  const I = (window.INTRO = {});
  const PICS = ['bg_intro.jpg', 'bg_mis_office.jpg'], // the painting, or the mission's own picture until it is there
    FACE = 'por_nova.png',
    VOICE = () => (window.VOICE && window.VOICE.file ? window.VOICE.file('nova.1') : 'audio/voice/nova_01.mp3'); // (the player's language: voice.js)
  // the timeline (ms): the picture comes up, the two lines are typed (a letter each TYPE1 / TYPE2, a little uneven), they stand a
  // moment, then Nova speaks; without her voice the subtitle stays READ per letter (READ_MIN to READ_MAX); then the fade into the run
  const START = 700,
    TYPE1 = 55,
    TYPE2 = 85,
    GAP = 450,
    HOLD = 900,
    READ = 62,
    READ_MIN = 4500,
    READ_MAX = 9000,
    TAIL = 700,
    OUT = 650,
    OUT_SKIP = 220,
    DEAF = 400; // a second click of the PLAY that opened it (a double click) is not a skip
  const SKIP_ICO =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5l9 7-9 7zM12 5l9 7-9 7z" fill="currentColor"/></svg>';
  const url = (f) => f + '?v=' + (window.__V || 0);
  I.due = () => true; // (the human, 2026-11-09: every start of mission 1, not only the first)
  // the painting on its way while the campaign map is up (campaign.js), so it is in by the time PLAY is pressed
  let warm = null;
  I.warm = () => {
    if (warm || !I.due()) return;
    warm = new Image();
    warm.src = url('assets/' + PICS[0]);
  };
  // a picture that never shows broken: hidden until it loads (style.css), the next file tried when one fails, removed when none loads
  function picture(img, files) {
    let i = 0;
    img.addEventListener('load', () => img.classList.add('in'));
    img.addEventListener('error', () => {
      if (++i < files.length) img.src = url('assets/' + files[i]);
      else img.remove();
    });
    img.src = url('assets/' + files[0]);
  }

  // the intro over the campaign map; done() starts the run (campaign.js: as its PLAY does)
  I.play = (done) => {
    const K = UI.kit,
      { T } = K,
      line = T('voice.nova.1'),
      t0 = performance.now(),
      timers = [];
    SAVE.see('intro');
    const el = K.show(
      `<div class="iscene"><img class="ibg" alt="" draggable="false"><i class="ishade"></i></div>
      <div class="itype" aria-label="${T('intro.place')} · ${T('intro.base')}"><p class="it1" aria-hidden="true"></p><p class="it2" aria-hidden="true"></p></div>
      <div class="isub" role="status"><div class="iface"><img alt="" draggable="false"></div>
        <div class="isb"><div class="inm"><span class="ibars"><i></i><i></i><i></i><i></i></span>${T('voice.name.nova')}</div><p>${line}</p></div></div>
      <button class="btn ghost iskip" data-skip>${T('intro.skip')}${SKIP_ICO}</button>`,
      'introScr',
    );
    el.id = 'intro';
    UI.scene = '';
    UI.opaque = true; // the picture covers the screen: nothing to draw behind it
    picture(el.querySelector('.ibg'), PICS);
    const face = el.querySelector('.iface img');
    picture(face, [FACE]);
    face.addEventListener('error', () => el.querySelector('.isub').classList.add('noface'));

    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    let over = false,
      vo = null;
    // the end: the picture and the words fade to black, then the run (a skip: at once); the run's start fades this screen away.
    // (another screen put up over it meanwhile: no run behind the player's back)
    function finish(skip) {
      if (over) return;
      over = true;
      timers.forEach(clearTimeout);
      removeEventListener('keydown', onKey);
      if (vo) vo.pause();
      if (window.AUDIO && AUDIO.duck) AUDIO.duck(false);
      el.classList.add('out');
      if (skip) el.classList.add('skip');
      setTimeout(() => !el.classList.contains('gone') && done(), skip ? OUT_SKIP : OUT);
    }
    const skip = () => {
      if (performance.now() - t0 > DEAF) finish(true);
    };
    // any key skips, but M (the sound) and F (full screen) keep their own meaning; M also mutes her voice
    function onKey(e) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyM') {
        if (vo) vo.muted = !(window.AUDIO && AUDIO.on);
        return;
      }
      if (e.code === 'KeyF' || /^(Shift|Control|Alt|Meta)/.test(e.code)) return;
      skip();
    }
    addEventListener('keydown', onKey);
    el.addEventListener('click', skip);

    // the typewriter: a letter at a time behind a blinking cursor, a quiet click for each one
    const cur = document.createElement('i');
    cur.className = 'icur';
    function type(p, text, ms, then) {
      const chars = Array.from(text),
        tx = document.createTextNode('');
      p.append(tx, cur);
      let i = 0;
      const step = () => {
        const c = chars[i++];
        tx.data += c;
        if (c.trim() && window.AUDIO && AUDIO.ui) AUDIO.ui('click', 0.1);
        if (i < chars.length) later(step, ms * (c === ' ' ? 1.8 : 0.8 + Math.random() * 0.4));
        else then();
      };
      step();
    }
    // Nova: her subtitle, and her voice when the file is there and the sound is on; without it the subtitle stays to be read
    function speak() {
      const sub = el.querySelector('.isub');
      sub.classList.add('on');
      const read = () => later(() => finish(false), Math.min(READ_MAX, Math.max(READ_MIN, line.length * READ)));
      if (!window.AUDIO || !AUDIO.on) {
        read();
        return;
      }
      vo = new Audio(url(VOICE()));
      if (AUDIO.voice) AUDIO.voice(vo);
      let heard = false,
        failed = false;
      const fail = () => {
        if (failed || over) return;
        failed = true;
        if (heard) later(() => finish(false), TAIL);
        else read();
      };
      vo.addEventListener('playing', () => {
        heard = true;
        if (AUDIO.duck) AUDIO.duck(true); // (the lobby's music steps back under her)
      });
      vo.addEventListener('ended', () => {
        if (AUDIO.duck) AUDIO.duck(false);
        later(() => finish(false), TAIL);
      });
      vo.addEventListener('error', fail);
      const p = vo.play();
      if (p) p.catch(fail);
    }
    later(
      () =>
        type(el.querySelector('.it1'), T('intro.place'), TYPE1, () =>
          later(() => type(el.querySelector('.it2'), T('intro.base'), TYPE2, () => later(speak, HOLD)), GAP),
        ),
      START,
    );
    return el;
  };
})();
