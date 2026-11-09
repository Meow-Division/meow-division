# The NEAR AI office's props from the Codex sheets (art/office/out/of_1..of_3.png: 2 x 2 on magenta, of_office.png: the
# building alone; prompts in art/office/make.mjs) → live/assets/<name>.png keyed and trimmed the way gen/baseart.py
# cuts the base's, their live/assets.js entries, and the line each needs in live/sim.js's prop table (printed: the
# drawing's lowest point is the footprint's front corner). The building is the office's roof: its footprint is worked
# out from the drawing's corners so the picture stands exactly on it (gen/officemap.mjs builds the walls round it).
# Run: python gen/officeart.py
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
SRC = os.path.join(ROOT, 'art/office/out')
OUT = os.path.join(ROOT, 'live/assets')

SHEETS = {
    'of_1': ['of_booth', 'of_gate', 'of_wallnear', 'of_rock'],
    'of_2': ['of_reception', 'of_logowall', 'of_lounge', 'of_meeting'],
    'of_3': ['of_desks', 'of_banner', 'of_glass', 'of_corner'],
}
# the drawn width in world px (the van is 380, the concrete wall 300, the booth we had 280)
WIDTH = {'of_booth': 300, 'of_gate': 500, 'of_wallnear': 300, 'of_rock': 380,
         'of_reception': 330, 'of_logowall': 260, 'of_lounge': 360, 'of_meeting': 380,
         'of_desks': 330, 'of_banner': 130, 'of_glass': 280, 'of_corner': 300}
# footprints by hand where the drawing's lowest point misleads: the gate stands on its front pillar only (the road
# under its beam stays open), the banner on its pole, the wall and the glass as the walls we have
FOOT = {'of_gate': (40, 40), 'of_banner': (24, 24), 'of_wallnear': (250, 36), 'of_glass': (250, 18),
        'of_logowall': (210, 34)}
MAT = {'of_booth': 'brick', 'of_wallnear': 'brick', 'of_rock': 'brick', 'of_reception': 'brick', 'of_logowall': 'brick'}
BLD = {'of_booth'}
# the office building: its footprint's long side (along gx), ground units; the rest follows from the drawing
OFFICE_FW = 1250


def cut(part, name):
    part, box = trim(part)
    return to_img(part)


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
        im = cut(part, name)
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
        bld = ', bld: 1' if name in BLD else ''
        lines.append(f'    {name}: {{ w: {w}, fw: {max(12, fw)}, fh: {max(12, fh)}{bld}{mat} }},')
        print(f'{name:14s} {im.size} low {k:.2f} parts {len(ids)}')

# single takes (art/office/run_room.sh: one object on magenta, two takes each): the prop and the take the human and the
# check chose; every part of the drawing big enough is kept (a table's chairs stand apart from it)
SINGLE = {'of_meeting': 'of_meeting_b', 'of_board': 'of_board_a', 'of_servers': 'of_servers_a',
          'of_console': 'of_console_a', 'of_banner': 'of_banner_a'}
WIDTH.update({'of_meeting': 320, 'of_board': 150, 'of_servers': 210, 'of_console': 80, 'of_banner': 68})
MAT.update({'of_servers': 'metal', 'of_console': 'metal'})
FOOT.update({'of_banner': (12, 12)})
for name, take in SINGLE.items():
    path = os.path.join(SRC, take + '.png')
    if not os.path.exists(path):
        print('missing', path)
        continue
    rgba = key(path)
    lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    rgba[..., 3] *= np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 400])
    im = cut(rgba, name)
    im = shrink(im, max(im.size) * min(1, WIDTH[name] * 1.45 / im.width))
    im.save(os.path.join(OUT, name + '.png'), optimize=True)
    A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
    al = np.asarray(im)[..., 3] > 100
    ys, xs = np.where(al)
    low = xs[ys >= ys.max() - max(2, im.height * 0.012)].mean()
    w = WIDTH[name]
    k = (low + 0.5) / im.width
    fw, fh = FOOT.get(name) or (round(w * k * 0.9), round(w * (1 - k) * 0.9))
    mat = f", mat: '{MAT[name]}'" if name in MAT else ''
    lines.append(f'    {name}: {{ w: {w}, fw: {max(12, fw)}, fh: {max(12, fh)}{mat} }},')
    print(f'{name:14s} {im.size} low {k:.2f} from {take}')

# the building: the whole drawing; its lowest point the footprint's front corner, its leftmost and rightmost the side
# corners (screen x − front x = −fw on the left, +fh on the right, in world px at the drawn width)
path = os.path.join(SRC, 'of_office.png')
if os.path.exists(path):
    rgba = key(path)
    lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = int(np.argmax(sizes)) + 1
    rgba[..., 3] *= lab == big
    im = cut(rgba, 'of_office')
    al = np.asarray(im)[..., 3] > 100
    ys, xs = np.where(al)
    yb = ys.max()
    low = xs[ys >= yb - max(2, im.height * 0.006)].mean()
    left, right = xs.min(), xs.max()
    k = (low - left) / max(1, right - left)
    w = round(OFFICE_FW / k)
    fh = round(w * (1 - k))
    im = shrink(im, max(im.size) * min(1, w * 0.8 / im.width))
    im.save(os.path.join(OUT, 'of_office.png'), optimize=True)
    A['of_office'] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
    lines.append(f'    of_office: {{ w: {w}, fw: {OFFICE_FW}, fh: {fh}, roof: 1 }},')
    print(f'of_office      {im.size} front at {k:.2f} of the width → footprint {OFFICE_FW} x {fh}, drawn {w} wide')
else:
    print('missing', path)
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
print('\n'.join(lines))
