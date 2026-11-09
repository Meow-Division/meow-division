# NEAR Base's props from the Codex sheets (art/night/out/px_8.png, px_9.png: 2 x 2 on magenta, prompts in art/night/make.mjs)
# → live/assets/<name>.png keyed and trimmed the way gen/labart2.py cuts the lab's, their live/assets.js entries, and the
# footprint line each needs in live/sim.js's prop table (printed: the drawing's lowest point is the footprint's front corner).
# Then: python gen/labback.py (every lb_ picture's base line, for the shadows). Run: python gen/baseart.py
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
src = open(os.path.join(HERE, 'labart.py'), encoding='utf-8').read()
ns = {'__file__': os.path.join(HERE, 'labart.py')}
exec(src.split('# ---------- props ----------')[0], ns)
key, trim, to_img, shrink, A, AS = ns['key'], ns['trim'], ns['to_img'], ns['shrink'], ns['A'], ns['AS']
SRC = os.path.join(ROOT, 'art/night/out')
OUT = os.path.join(ROOT, 'live/assets')

SHEETS = {
    'px_8': ['lb_workbench', 'lb_target', 'lb_stall', 'lb_radio'],
    'px_9': ['np_walt', 'np_nova', 'lb_rubble', 'lb_sandbags'],
}
# the drawn width in world px (the metal crate is 100, the vending machine 86 and as tall as a person)
WIDTH = {'lb_workbench': 260, 'lb_target': 110, 'lb_stall': 320, 'lb_radio': 200,
         'np_walt': 84, 'np_nova': 74, 'lb_rubble': 210, 'lb_sandbags': 220}
# footprints by hand where the drawing's lowest point misleads (a person stands on a small square)
FOOT = {'np_walt': (40, 40), 'np_nova': (38, 38), 'lb_target': (60, 40), 'lb_radio': (130, 50), 'lb_rubble': (150, 70)}
MAT = {'lb_workbench': 'metal', 'lb_radio': 'metal', 'lb_rubble': 'brick', 'lb_sandbags': 'brick'}

lines = []
for sheet, names in SHEETS.items():
    path = os.path.join(SRC, sheet + '.png')
    if not os.path.exists(path):
        print('missing', path)
        continue
    rgba = key(path)
    H, W = rgba.shape[:2]
    lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
    idx = range(1, n + 1)
    coms = ndimage.center_of_mass(np.ones_like(lab), lab, idx)
    sizes = ndimage.sum(np.ones_like(lab), lab, idx)
    for q, name in enumerate(names):
        ids = [i + 1 for i, (cy, cx) in enumerate(coms)
               if sizes[i] >= 400 and (cx >= W / 2) == (q % 2 == 1) and (cy >= H / 2) == (q // 2 == 1)]
        part = rgba.copy()
        part[..., 3] *= np.isin(lab, ids)
        part, box = trim(part)
        im = to_img(part)
        im = shrink(im, max(im.size) * min(1, WIDTH[name] * 1.45 / im.width))
        im.save(os.path.join(OUT, name + '.png'), optimize=True)
        A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
        al = np.asarray(im)[..., 3] > 100
        ys, xs = np.where(al)
        yb = ys.max()
        low = xs[ys >= yb - max(2, im.height * 0.012)].mean()
        w = WIDTH[name]
        k = (low + 0.5) / im.width
        fw, fh = FOOT.get(name) or (round(w * k * 0.9), round(w * (1 - k) * 0.9))
        mat = f", mat: '{MAT[name]}'" if name in MAT else ''
        lines.append(f'    {name}: {{ w: {w}, fw: {max(12, fw)}, fh: {max(12, fh)}{mat} }},')
        print(f'{name:14s} {im.size} low {k:.2f} parts {len(ids)}')
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
print('\n'.join(lines))
