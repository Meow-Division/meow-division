# The lab's second set of props (art/lab/src/px_<n>.png: 2 × 2 Codex sheets, prompts in art/lab/prompts) → live/assets/lb_<name>.png,
# footprints measured as gen/labart.py does (the drawing's lowest point is the footprint's front corner) merged into art/lab/props.json,
# and their live/assets.js entries. Then: python gen/labback.py (every lb_ picture's base line). python gen/labart2.py [names...]
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
src = open(os.path.join(HERE, 'labart.py'), encoding='utf-8').read()
ns = {'__file__': os.path.join(HERE, 'labart.py')}; exec(src.split('# ---------- props ----------')[0], ns)
key, trim, to_img, shrink, A, AS = ns['key'], ns['trim'], ns['to_img'], ns['shrink'], ns['A'], ns['AS']
SRC = os.path.join(ROOT, 'art/lab/src'); OUT = os.path.join(ROOT, 'live/assets'); PJ = os.path.join(ROOT, 'art/lab/props.json')

SHEETS = {'px_1': ['lb_chembench', 'lb_cryopod', 'lb_jars', 'lb_analyzer'], 'px_2': ['lb_fumehood', 'lb_freezer', 'lb_cage', 'lb_wheelchair'],
          'px_3': ['lb_crates', 'lb_screen', 'lb_oxygen', 'lb_spool'], 'px_4': ['lb_drums', 'lb_palletjack', 'lb_fueltank', 'lb_transformer'],
          'px_5': ['lb_aircon', 'lb_ups', 'lb_fallenrack', 'lb_levers'], 'px_6': ['lb_hydro', 'lb_barrow', 'lb_watertank', 'lb_cactus'],
          'px_7': ['lb_cafetable', 'lb_watercooler', 'lb_wastebins', 'lb_lockers']}
# the drawn width (world px; the metal crate is 100)
WIDTH = {'lb_chembench': 260, 'lb_cryopod': 240, 'lb_jars': 130, 'lb_analyzer': 110, 'lb_fumehood': 150, 'lb_freezer': 100, 'lb_cage': 170, 'lb_wheelchair': 90,
         'lb_crates': 190, 'lb_screen': 150, 'lb_oxygen': 130, 'lb_spool': 120, 'lb_drums': 130, 'lb_palletjack': 150, 'lb_fueltank': 340, 'lb_transformer': 200,
         'lb_aircon': 190, 'lb_ups': 200, 'lb_fallenrack': 200, 'lb_levers': 120, 'lb_hydro': 300, 'lb_barrow': 120, 'lb_watertank': 140, 'lb_cactus': 150,
         'lb_cafetable': 170, 'lb_watercooler': 60, 'lb_wastebins': 150, 'lb_lockers': 200}
FOOT = {'lb_drums': (62, 56), 'lb_chembench': (187, 54), 'lb_screen': (120, 26), 'lb_oxygen': (91, 30), 'lb_spool': (64, 56), 'lb_barrow': (90, 34),
        'lb_watertank': (80, 64), 'lb_cafetable': (100, 90), 'lb_watercooler': (36, 34), 'lb_wastebins': (50, 110), 'lb_lockers': (150, 40)}                                                      # footprint by hand where the drawing's lowest point misleads
CUT = {'lb_transformer': 0.854}                                # the picture cut off below this share of its height (cables that ran on into the floor in front of it)
PINK = {'lb_screen'}
props = json.load(open(PJ))
only = set(sys.argv[1:])
for sheet, names in SHEETS.items():
    if (only and not (only & set(names))) or not os.path.exists(os.path.join(SRC, sheet + '.png')): continue
    rgba = key(os.path.join(SRC, sheet + '.png')); H, W = rgba.shape[:2]
    lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
    coms = ndimage.center_of_mass(np.ones_like(lab), lab, range(1, n + 1)); sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    for q, name in enumerate(names):
        if only and name not in only: continue
        ids = [i + 1 for i, (cy, cx) in enumerate(coms) if sizes[i] >= 400 and (cx >= W / 2) == (q % 2 == 1) and (cy >= H / 2) == (q // 2 == 1)]
        part = rgba.copy(); part[..., 3] *= np.isin(lab, ids)
        part, box = trim(part)
        if name in PINK:                                         # (a thin cloth let the magenta through: its pink back to grey, as labart.py's shower)
            c = part[..., :3]; pink = np.clip((np.minimum(c[..., 0], c[..., 2]) - c[..., 1]) * 4, 0, 1)[..., None]; c[:] = c * (1 - pink) + c.mean(axis=2, keepdims=True) * pink
        im = to_img(part); im = shrink(im, max(im.size) * min(1, WIDTH[name] * 1.45 / im.width))
        if name in CUT: im = im.crop((0, 0, im.width, round(im.height * CUT[name])))
        im.save(os.path.join(OUT, name + '.png'), optimize=True)
        A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
        al = np.asarray(im)[..., 3] > 100; ys, xs = np.where(al); yb = ys.max(); low = xs[ys >= yb - max(2, im.height * 0.012)].mean()
        w = WIDTH[name]; k = (low + 0.5) / im.width
        fw, fh = FOOT.get(name) or (round(w * k * 0.9), round(w * (1 - k) * 0.9))
        props[name] = {'w': w, 'fw': max(12, fw), 'fh': max(12, fh), 'ar': round(im.height / im.width, 3)}
        print(f'{name:16s} {im.size} low {k:.2f} -> fw {props[name]["fw"]} fh {props[name]["fh"]}  (parts {len(ids)})')
json.dump(props, open(PJ, 'w'), indent=1)
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
print('props.json', len(props), 'assets.js', len(A))
