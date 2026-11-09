# The perk, gun and lobby icons redrawn in the item icons' style (art/night/out/<name>.png: Codex, 1024 px, transparent
# background; prompts in art/night/make.mjs) → live/assets/<name>.png cropped to the drawing and at most MAX px on the long
# side, and their live/assets.js entries with a new v (the browser cache keys pictures by it).
#   python gen/perkicons.py [names...]      (no names: every i_* and ui_* found in art/night/out)
import glob, json, os, re, sys, time
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art/night/out')
OUT = os.path.join(ROOT, 'live/assets')
AS = os.path.join(ROOT, 'live/assets.js')
MAX = 640  # the old pictures were 700-900 px; a perk card shows one at about 120 CSS px, the arsenal at about 300
PAD = 6

A = json.loads(re.sub(r'^window\.ASSETS = |;\s*$', '', open(AS, encoding='utf-8').read().strip()))
names = sys.argv[1:] or sorted(
    os.path.basename(p)[:-4] for p in glob.glob(os.path.join(SRC, '*.png')) if re.match(r'(i|ui)_', os.path.basename(p))
)
stamp = int(time.time())
for name in names:
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    al = np.asarray(im)[..., 3]
    if al.min() > 200:
        print(f'{name}: no transparent background, skipped')
        continue
    ys, xs = np.where(al > 10)
    box = (max(0, xs.min() - PAD), max(0, ys.min() - PAD), min(im.width, xs.max() + PAD + 1), min(im.height, ys.max() + PAD + 1))
    im = im.crop(box)
    s = MAX / max(im.size)
    if s < 1:
        im = im.convert('RGBa').resize((round(im.width * s), round(im.height * s)), Image.LANCZOS).convert('RGBA')
    im.save(os.path.join(OUT, name + '.png'), optimize=True)
    A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1, 'v': stamp}
    print(f'{name:14s} {im.size}')
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
