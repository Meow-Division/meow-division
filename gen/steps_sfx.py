# The hero's steps by surface, live/audio/steps.mp3 + steps.json, from Kenney's Impact Sounds (kenney.nl, CC0 1.0):
#   python gen/steps_sfx.py <the pack's Audio folder> [out dir = live/audio]
# soft (grass, earth): footstep_carpet 000/001/003 and footstep_grass 000/003/004, as before;
# conc (asphalt, slabs, concrete, tiles): footstep_concrete 000..004;
# metal (plate and grating floors, manholes, drains): impactMetal_light 000..004;
# glass (glass floor panels, broken glass): impactGlass_light 000..004.
# Each clip low-passed (a paw, not a boot: the soft ones at 4.5 kHz, the hard ones a little brighter), trimmed, levelled
# to one A-weighted loudness, 0.15 s apart, 32 kHz mono 64 kbit/s mp3. Needs soundfile, scipy, imageio-ffmpeg.
import sys, os, json, subprocess
import numpy as np, soundfile as sf, imageio_ffmpeg
from scipy.signal import butter, sosfilt, resample_poly, lfilter, bilinear

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'live', 'audio')
SR = 32000
FF = imageio_ffmpeg.get_ffmpeg_exe()
SETS = [  # (key, low-pass Hz, longest it may ring s, files)
    ('step', 4500, 0.2, ['footstep_carpet_000', 'footstep_carpet_001', 'footstep_carpet_003',
                         'footstep_grass_000', 'footstep_grass_003', 'footstep_grass_004']),
    ('conc', 5500, 0.2, ['footstep_concrete_%03d' % i for i in range(5)]),
    ('metal', 6000, 0.22, ['impactMetal_light_%03d' % i for i in range(5)]),
    ('glass', 7000, 0.2, ['impactGlass_light_%03d' % i for i in range(5)]),
]


def aweight():
    f1, f2, f3, f4 = 20.598997, 107.65265, 737.86223, 12194.217
    num = [(2 * np.pi * f4) ** 2 * (10 ** (1.9997 / 20)), 0, 0, 0, 0]
    den = np.polymul([1, 4 * np.pi * f4, (2 * np.pi * f4) ** 2], [1, 4 * np.pi * f1, (2 * np.pi * f1) ** 2])
    den = np.polymul(np.polymul(den, [1, 2 * np.pi * f3]), [1, 2 * np.pi * f2])
    return bilinear(num, den, SR)


bA, aA = aweight()
loud = lambda x: np.sqrt((lfilter(bA, aA, x) ** 2).sum())
clips = []
for key, lp, ring, files in SETS:
    sos = butter(2, lp, 'low', fs=SR, output='sos')
    for i, f in enumerate(files):
        x, sr = sf.read(os.path.join(SRC, f + '.ogg'))
        x = x.mean(1) if x.ndim > 1 else x
        x = sosfilt(sos, resample_poly(x, SR, sr))
        a = np.abs(x)
        on = max(0, np.argmax(a > a.max() * 0.05) - int(SR * 0.002))
        end = min(np.where(a > a.max() * 0.003)[0][-1] + 1, on + int(SR * ring))
        x = x[on:end].copy()
        fl = min(len(x), int(SR * 0.03))
        x[-fl:] *= np.linspace(1, 0, fl)
        clips.append(('%s%d' % (key, i), x))
ref = min(loud(c) / np.abs(c).max() for _, c in clips) * 0.85  # the quietest one at peak .85
gap = np.zeros(int(SR * 0.15))
out, pos, M = [np.zeros(int(SR * 0.1))], 0.1, {}
for name, x in clips:
    x = x * ref / loud(x)
    M[name] = [round(pos, 4), round(len(x) / SR, 4)]
    out += [x, gap]
    pos += len(x) / SR + 0.15
y = np.concatenate(out).astype(np.float32)
print('clips', len(clips), 'peak', round(float(np.abs(y).max()), 3), 'seconds', round(len(y) / SR, 2))
wav = os.path.join(OUT, 'steps.tmp.wav')
sf.write(wav, y, SR)
subprocess.run([FF, '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(SR), '-b:a', '64k',
                '-codec:a', 'libmp3lame', os.path.join(OUT, 'steps.mp3')], check=True)
os.remove(wav)
json.dump(M, open(os.path.join(OUT, 'steps.json'), 'w'))
print(json.dumps(M))
