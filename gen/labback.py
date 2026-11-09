# The lab props' back sides and every lab prop's base line: python gen/labback.py [--sheets]
#   --sheets: the Codex sheets art/lab/src/bk_<n>.png (gen: each prop of a 2 × 2 sheet turned 180° about its vertical axis; prompts in
#             art/lab/prompts) keyed and cut → live/assets/lb_<name>_b.png, at the front picture's pixel width. Turned 180° a prop keeps
#             its footprint, so its lowest point (the footprint's front corner) sits where the front picture's does; a sheet that came
#             out turned 90° instead (the lowest point on the other side) is mirrored.
#   always:   each lb_ picture's base line → its live/assets.js entry, base: [u, v, ...]: the lower convex hull of the lowest opaque
#             pixel of every column (u: across the width 0..1, v: up from the bottom, in widths). ground.js lays the lab's prop shadows
#             along it (where the drawing meets the floor), not along the footprint rectangle (a round tank's square footprint stuck out
#             of it as a dark plate)
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art/lab/src'); OUT = os.path.join(ROOT, 'live/assets'); AS = os.path.join(ROOT, 'live/assets.js')
SHEETS = {'bk_1': ['lb_tent', 'lb_generator', 'lb_cell', 'lb_counter'], 'bk_2': ['lb_servers', 'lb_shelf', 'lb_tank', 'lb_pipes'],
          'bk_3': ['lb_desk', 'lb_console', 'lb_guarddesk', 'lb_optable'], 'bk_4': ['lb_forklift', 'lb_stretcher', 'lb_suits', 'lb_cabinet'],
          'bk_5': ['lb_server', 'lb_vending', 'lb_coffee', 'lb_growlight'],
          # the second set's (gen/labart2.py)
          'bk_6': ['lb_fueltank', 'lb_chembench', 'lb_cryopod', 'lb_ups'], 'bk_7': ['lb_transformer', 'lb_aircon', 'lb_lockers', 'lb_palletjack'],
          'bk_8': ['lb_fumehood', 'lb_freezer', 'lb_analyzer', 'lb_levers'], 'bk_9': ['lb_jars', 'lb_cage', 'lb_barrow', 'lb_watercooler']}
ONLY = [a for a in sys.argv[1:] if a.startswith('bk_')]          # (--sheets bk_6 ...: those sheets only)

# (labart.py's keying, without running its main)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'labart.py'), encoding='utf-8').read()
ns = {'__file__': os.path.join(os.path.dirname(os.path.abspath(__file__)), 'labart.py')}; exec(src.split('# ---------- props ----------')[0], ns)
key, trim, to_img = ns['key'], ns['trim'], ns['to_img']
A = ns['A']

def low_k(im):                                                 # the lowest point across the width (0..1)
    al = np.asarray(im)[..., 3] > 100; ys, xs = np.where(al); yb = ys.max()
    return (xs[ys >= yb - max(2, im.height * 0.012)].mean() + 0.5) / im.width

def base(im, n=48):
    al = np.asarray(im)[..., 3] > 128; H, W = al.shape
    pts = []
    for x in np.unique(np.linspace(0, W - 1, n * 3).round().astype(int)):
        ys = np.where(al[:, x])[0]
        if len(ys): pts.append(((x + 0.5) / W, (H - 1 - ys.max()) / W))
    h = []                                                    # the lower hull (monotone chain) in (u, v), v up
    for p in pts:
        while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0: h.pop()
        h.append(p)
    return [round(c, 3) for q in h for c in q]

# fitted by height (the front's open door widens its picture: by width the back came out a size too big); none (the grow light: the
# back sheet's stand stood off its footprint, and the lamp is near enough symmetric for its mirror to do)
FIT_H = {'lb_cabinet', 'lb_server'}; SKIP = {'lb_growlight'}
if '--sheets' in sys.argv:
    P = json.load(open(os.path.join(ROOT, 'art/lab/props.json')))  # (the footprints: only the back sheets need them)
    for sheet, names in SHEETS.items():
        if ONLY and sheet not in ONLY: continue
        rgba = key(os.path.join(SRC, sheet + '.png')); H, W = rgba.shape[:2]
        lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
        coms = ndimage.center_of_mass(np.ones_like(lab), lab, range(1, n + 1)); sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        for q, name in enumerate(names):
            ids = [i + 1 for i, (cy, cx) in enumerate(coms) if sizes[i] >= 400 and (cx >= W / 2) == (q % 2 == 1) and (cy >= H / 2) == (q // 2 == 1)]
            part = rgba.copy(); part[..., 3] *= np.isin(lab, ids)
            part, _ = trim(part)
            if name in SKIP:
                A.pop(name + '_b', None); f = os.path.join(OUT, name + '_b.png'); os.path.exists(f) and os.remove(f); continue
            im = to_img(part); front = Image.open(os.path.join(OUT, name + '.png'))
            if name in FIT_H: im = im.convert('RGBa').resize((max(1, round(im.width * front.height / im.height)), front.height), Image.LANCZOS).convert('RGBA')
            else: im = im.convert('RGBa').resize((front.width, max(1, round(im.height * front.width / im.width))), Image.LANCZOS).convert('RGBA')
            kf, kb = low_k(front), low_k(im); flip = abs(kf - 0.5) > 0.06 and abs(kb - (1 - kf)) < abs(kb - kf)
            if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT); kb = low_k(im)
            if name in FIT_H:                                      # on the front's canvas, its lowest point on the footprint's front corner
                p = P[name]; t = p['fw'] / (p['fw'] + p['fh']); c = Image.new('RGBA', (max(front.width, im.width), im.height), (0, 0, 0, 0))
                c.paste(im, (min(c.width - im.width, max(0, round(t * c.width - kb * im.width))), 0)); im = c; kb = low_k(im)
            im.save(os.path.join(OUT, name + '_b.png'), optimize=True)
            A[name + '_b'] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
            print(f'{name:14s} front {front.size} low {kf:.2f} | back {im.size} low {kb:.2f}{"  (mirrored)" if flip else ""}')

for nm in sorted(k for k in A if k.startswith('lb_')):
    f = os.path.join(OUT, nm + '.png')
    if os.path.exists(f): A[nm]['base'] = base(Image.open(f).convert('RGBA'))
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
print('assets.js', len(A), 'bases', sum(1 for k in A if 'base' in A[k]))
