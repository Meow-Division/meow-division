# Nova's lines over the radio (docs/voice.md: recorded by the human, the radio effect added here): art/voice/raw/<who>_NN.mp3
# → live/audio/voice/<who>_NN.mp3. Nova's go through the radio: the silence round the line trimmed, the level evened out,
# the band a handheld radio passes (about 300 to 3400 Hz, a lift round 1.7 kHz), a fast compressor and a little overdrive,
# a quiet hiss of the open channel under the words, the key's click before them and the squelch's tail after (a soft
# "kshh" of real radio static, art/voice/sfx/radio_off.mp3 from gen/radio_sfx.mjs: 200 ms, eased in and out, darker and
# well under the words; without that file a noise of the same shape. The old one, a bright burst cut in 6 ms with a
# click after it, sounded like a whip: the human, 2026-11-10). Walt's
# (face to face, no radio) get only the trim and the level; Copper's (to Nova, on the radio) go through the radio as hers do. Every line ends at the same loudness. mp3 mono 32 kHz.
#   python gen/radio.py [ids...]      (no ids: every file in art/voice/raw; an id may name a language's folder, uk/nova_01:
#   art/voice/raw/uk/nova_01.mp3 → live/audio/voice/uk/nova_01.mp3, the lines recorded in that language: live/voice.js DUB)
import glob, os, subprocess, sys, tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OFF = os.path.join(ROOT, 'art/voice/sfx/radio_off.mp3')
RAW = os.path.join(ROOT, 'art/voice/raw')
OUT = os.path.join(ROOT, 'live/audio/voice')
SR = 32000
KBPS = 64
TARGET = -17.0  # the words' loudness (RMS of the spoken parts, dBFS): about -16 LUFS
PEAK = -3.0  # (mp3 overshoots the peaks it was given by up to 2 dB)


def ffmpeg():
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


FF = ffmpeg()
db = lambda v: 10 ** (v / 20)


def load(path):
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, 'a.wav')
        subprocess.run([FF, '-v', 'error', '-y', '-i', path, '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_f32le', w], check=True)
        _, x = wavfile.read(w)
    return x.astype(np.float64)


def save(x, path):
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, 'a.wav')
        wavfile.write(w, SR, x.astype(np.float32))
        subprocess.run([FF, '-v', 'error', '-y', '-i', w, '-c:a', 'libmp3lame', '-b:a', f'{KBPS}k', '-ac', '1', path], check=True)


def env(x, ms):
    k = max(1, int(SR * ms / 1000))
    return np.sqrt(np.convolve(x * x, np.ones(k) / k, mode='same'))


def trim(x, pad_ms=30):
    e = env(x, 10)
    on = np.where(e > db(-42) * e.max())[0]
    a = max(0, on[0] - int(SR * pad_ms / 1000))
    b = min(len(x), on[-1] + int(SR * pad_ms / 1000))
    return x[a:b]


def speech_rms(x):
    e = env(x, 30)
    loud = e > db(-30) * e.max()
    return np.sqrt(np.mean(x[loud] ** 2))


def peaking(f0, gain_db, q):
    # an RBJ peaking biquad
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * a, -2 * np.cos(w), 1 - al * a]
    aa = [1 + al / a, -2 * np.cos(w), 1 - al / a]
    return np.array(b) / aa[0], np.array(aa) / aa[0]


def compress(x, thr_db=-26, ratio=4.0, att_ms=3, rel_ms=90):
    att = np.exp(-1 / (SR * att_ms / 1000))
    rel = np.exp(-1 / (SR * rel_ms / 1000))
    lvl = np.abs(x)
    g = np.empty_like(x)
    e = 0.0
    thr = db(thr_db)
    for i, v in enumerate(lvl):
        e = att * e + (1 - att) * v if v > e else rel * e + (1 - rel) * v
        g[i] = 1.0 if e <= thr else (thr * (e / thr) ** (1 / ratio)) / e
    return x * g


def band(x, lo, hi, order):
    return signal.sosfilt(signal.butter(order, [lo, hi], btype='bandpass', fs=SR, output='sos'), x)


def radio(x, seed):
    rng = np.random.default_rng(seed)
    x = band(x, 300, 3400, 4)
    b, a = peaking(1700, 5, 0.9)
    x = signal.lfilter(b, a, x)
    x = compress(x / (np.abs(x).max() + 1e-9))
    x /= np.abs(x).max() + 1e-9
    drive = 2.6
    x = np.tanh(drive * x) / np.tanh(drive)
    x = band(x, 330, 3300, 2)
    x /= np.abs(x).max() + 1e-9
    # the open channel: a hiss under the words with a slow drift, and now and then a faint crackle
    n = len(x)
    t = np.arange(n) / SR
    hiss = band(rng.standard_normal(n), 600, 4200, 2)
    hiss *= db(-36) / (np.sqrt(np.mean(hiss**2)) + 1e-9) * (1 + 0.25 * np.sin(2 * np.pi * 0.6 * t + rng.uniform(0, 6)))
    crack = np.zeros(n)
    for i in rng.integers(0, n, size=max(1, n // SR * 3)):
        k = int(SR * rng.uniform(0.002, 0.006))
        crack[i : i + k] += rng.standard_normal(min(k, n - i)) * rng.uniform(0.05, 0.12)
    x = x + hiss + band(crack, 900, 4500, 2)
    # the key's click and a short breath of the channel before the words; the squelch's burst after them
    pre = int(SR * 0.09)
    click = np.zeros(pre)
    k = int(SR * 0.004)
    click[:k] = rng.standard_normal(k) * np.linspace(1, 0, k) * 0.5
    sh = int(SR * 0.05)
    click[k : k + sh] += band(rng.standard_normal(sh), 800, 5000, 2) * np.exp(-np.arange(sh) / (SR * 0.012)) * 0.35
    tn = squelch(rng)
    end = np.zeros(int(SR * 0.04))
    bed = lambda m: band(rng.standard_normal(m), 600, 4200, 2) * db(-38)
    # (all of it through the radio's speaker: nothing above about 4 kHz, the hiss and the squelch included)
    y = np.concatenate([click + bed(pre), x, tn + bed(len(tn)), end])
    return signal.sosfilt(signal.butter(4, 4000, btype='lowpass', fs=SR, output='sos'), y)


# the squelch's tail: 200 ms of the channel's static (the recorded one when it is there), 12 ms in, 150 ms even, 60 ms
# out, within the radio's band and darker above 2.5 kHz, its peak at 0.3 of the words' (about 12 dB under them)
def squelch(rng):
    n = int(SR * 0.21)
    if os.path.exists(OFF):
        st = load(OFF)
        e = env(st, 10)
        a = int(np.argmax(e > 0.5 * e.max()))
        st = st[a : a + n]
        if len(st) < n:
            st = np.pad(st, (0, n - len(st)))
    else:
        st = rng.standard_normal(n)
    st = band(st, 400, 3000, 2)
    st = signal.sosfilt(signal.butter(2, 2500, btype='lowpass', fs=SR, output='sos'), st)
    t = np.arange(n) / SR
    shape = np.clip(t / 0.012, 0, 1) * np.clip((0.21 - t) / 0.06, 0, 1) ** 1.5
    st = st * shape
    return st / (np.abs(st).max() + 1e-9) * 0.3


def level(x, words):
    # the words at TARGET; a soft limiter keeps the peaks under PEAK
    x = x * (db(TARGET) / (words + 1e-12))
    p = db(PEAK)
    over = np.abs(x) > 0.7 * p
    x[over] = np.sign(x[over]) * (0.7 * p + 0.3 * p * np.tanh((np.abs(x[over]) - 0.7 * p) / (0.3 * p)))
    return x


def fade(x, ms=8):
    k = int(SR * ms / 1000)
    x[:k] *= np.linspace(0, 1, k)
    x[-k:] *= np.linspace(1, 0, k)
    return x


os.makedirs(OUT, exist_ok=True)
ids = sys.argv[1:] or sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(RAW, '*.mp3')))
for i, name in enumerate(ids):
    x = trim(load(os.path.join(RAW, name + '.mp3')))
    os.makedirs(os.path.dirname(os.path.join(OUT, name)), exist_ok=True)
    # (Copper talks to Nova over the radio too, his last words with them: the human's, 2026-11-12)
    if os.path.basename(name).startswith(('nova_', 'copper_')):
        y = radio(x, seed=int(name[-2:]) * 7919)
        # (the loudness of the words alone: the click and the burst round them don't count)
        pre = int(SR * 0.09)
        words = speech_rms(y[pre : pre + len(x)])
    else:
        y = x
        words = speech_rms(y)
    y = fade(level(y, words))
    save(y, os.path.join(OUT, name + '.mp3'))
    print(f'{name}: {len(y) / SR:.2f} s, peak {20 * np.log10(np.abs(y).max()):.1f} dB')
