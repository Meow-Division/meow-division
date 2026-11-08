# The laboratory's art from the Codex sheets (art/lab/src: one picture per job, magenta keyed): python gen/labart.py
#   props  — 2 × 2 sheets → live/assets/lb_<name>.png (trimmed), their footprints measured from the drawing (the lowest point of a
#            prop is its footprint's front corner: its distance from the left edge over the width is fw / (fw + fh)) → art/lab/props.json
#   tiles  — 2 × 2 sheets of floor tiles → live/assets/t_lf_<kind><n>.png (256 px: a tile is drawn under 200)
#   mobs   — one character each → art/lab/<rig>.png (keyed, for gen rigcut: python gen/rigcut.py <rig> --src art/lab --out art/lab/parts)
#   card   — bg_loc_lab.png (the world map's picture)
# and their entries in live/assets.js (window.ASSETS).
import json, os, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art/lab/src'); OUT = os.path.join(ROOT, 'live/assets'); ART = os.path.join(ROOT, 'art/lab')

def key(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g                                   # magenta-ness
    al = 1 - np.clip((m - 0.18) / (0.55 - 0.18), 0, 1)
    # only the background is keyed: the magenta-ish pixels joined to the picture's edge (a purple glove, a glowing sac, a grow light
    # inside the drawing stay); their soft edge a few px into the drawing kept
    lab, n = ndimage.label(m > 0.6)                                          # (the flat background: m near 1; a purple inside: under 0.5)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])); edge = edge[edge > 0]
    pocket = (m > 0.55) & (r > 0.8) & (b > 0.8) & (g < 0.25)                 # background shut inside the drawing (between a strap and the head)
    bg = ndimage.binary_dilation(np.isin(lab, edge) | pocket, iterations=3)
    al = np.where(bg, al, 1).astype(np.float32)
    k = np.array([1, 0, 1], np.float32)
    c = (a - (1 - al[..., None]) * k) / np.maximum(al[..., None], 1e-3)
    c = np.clip(c, 0, 1)
    d = c.copy()                                                              # the key's colour out of the edges only (purples inside kept)
    d[..., 0] = np.minimum(d[..., 0], np.maximum(d[..., 1], d[..., 2]) + 0.6 * np.clip(d[..., 0] - d[..., 2], 0, 1) + 0.35)
    d[..., 2] = np.minimum(d[..., 2], np.maximum(d[..., 1], d[..., 0] * 0.9) + 0.05)
    c = np.where(bg[..., None], d, c)
    al[al < 0.04] = 0
    return np.dstack([c, al])

def clean(rgba, minpx):                                        # specks off: alpha islands smaller than minpx
    lab, n = ndimage.label(rgba[..., 3] > 0.25)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= minpx])
        grow = ndimage.binary_dilation(keep, iterations=3)
        rgba = rgba.copy(); rgba[..., 3] *= grow
    return rgba

def trim(rgba, pad=4):
    ys, xs = np.where(rgba[..., 3] > 0.04)
    y0, y1, x0, x1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + pad + 1), max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + pad + 1)
    return rgba[y0:y1, x0:x1], (x0, y0, x1, y1)

def to_img(rgba):
    return Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')

def shrink(im, maxside):
    s = maxside / max(im.size)
    if s < 1: im = im.convert('RGBa').resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS).convert('RGBA')
    return im

AS = os.path.join(ROOT, 'live/assets.js')
A = json.loads(re.sub(r'^window\.ASSETS = |;\s*$', '', open(AS, encoding='utf-8').read().strip()))
def asset(name, im):
    A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}

# ---------- props ----------
SHEETS = {'pr_hall1': ['lb_tank', 'lb_tent', 'lb_stretcher', 'lb_flood'], 'pr_hall2': ['lb_desk', 'lb_cart', 'lb_biobarrel', 'lb_iv'],
          'pr_store': ['lb_shelf', 'lb_pallet', 'lb_forklift', 'lb_cabinet'], 'pr_server': ['lb_servers', 'lb_server', 'lb_console', 'lb_pipes'],
          'pr_lab': ['lb_tube', 'lb_tubebroken', 'lb_optable', 'lb_generator'], 'pr_green': ['lb_planter', 'lb_pots', 'lb_bigplant', 'lb_growlight'],
          'pr_cells': ['lb_cell', 'lb_guarddesk', 'lb_suits', 'lb_vending'], 'pr_cafe': ['lb_table', 'lb_counter', 'lb_shower', 'lb_coffee']}
# the drawn width (world px) each is given; the footprint follows from the drawing (shrunk a little: no snagging on its air)
WIDTH = {'lb_tank': 330, 'lb_tent': 300, 'lb_stretcher': 150, 'lb_flood': 70, 'lb_desk': 170, 'lb_cart': 90, 'lb_biobarrel': 56, 'lb_iv': 50,
         'lb_shelf': 330, 'lb_pallet': 130, 'lb_forklift': 210, 'lb_cabinet': 90, 'lb_servers': 300, 'lb_server': 96, 'lb_console': 210, 'lb_pipes': 220,
         'lb_tube': 92, 'lb_tubebroken': 120, 'lb_optable': 200, 'lb_generator': 420, 'lb_planter': 330, 'lb_pots': 120, 'lb_bigplant': 160, 'lb_growlight': 80,
         'lb_cell': 340, 'lb_guarddesk': 200, 'lb_suits': 200, 'lb_vending': 86, 'lb_table': 260, 'lb_counter': 330, 'lb_shower': 150, 'lb_coffee': 84}
# footprint by hand where the drawing's lowest point misleads (a puddle, a lamp's base, a tripod)
FOOT = {'lb_tubebroken': (58, 58), 'lb_flood': (22, 22), 'lb_growlight': (20, 20), 'lb_iv': (16, 16), 'lb_tank': (200, 200), 'lb_tube': (52, 52), 'lb_bigplant': (64, 64),
        'lb_pots': (60, 56), 'lb_server': (52, 52), 'lb_shower': (100, 100), 'lb_vending': (46, 40), 'lb_coffee': (42, 36), 'lb_biobarrel': (26, 26),
        'lb_forklift': (140, 70), 'lb_cabinet': (42, 40), 'lb_pipes': (150, 50), 'lb_cart': (50, 34)}
props = {}
def do_props():
    for sheet, names in SHEETS.items():
        rgba = key(os.path.join(SRC, sheet + '.png')); H, W = rgba.shape[:2]
        # each piece of the sheet (connected alpha) goes to the quarter its middle is in, whole (one crossing the midline stays whole,
        # and leaves nothing in its neighbour's picture)
        lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
        coms = ndimage.center_of_mass(np.ones_like(lab), lab, range(1, n + 1)); sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        for q, name in enumerate(names):
            ids = [i + 1 for i, (cy, cx) in enumerate(coms) if sizes[i] >= 400 and (cx >= W / 2) == (q % 2 == 1) and (cy >= H / 2) == (q // 2 == 1)]
            part = rgba.copy(); part[..., 3] *= np.isin(lab, ids)
            part, box = trim(part)
            if name == 'lb_shower':                                  # the curtain let the magenta through: its pink back to grey
                c = part[..., :3]; pink = np.clip((np.minimum(c[..., 0], c[..., 2]) - c[..., 1]) * 4, 0, 1)[..., None]; c[:] = c * (1 - pink) + c.mean(axis=2, keepdims=True) * pink
            im = to_img(part); im = shrink(im, max(im.size) * min(1, WIDTH[name] * 1.45 / im.width)); im.save(os.path.join(OUT, name + '.png'), optimize=True); asset(name, im)
            al = np.asarray(im)[..., 3] > 100; ys, xs = np.where(al); yb = ys.max(); low = xs[ys >= yb - max(2, im.height * 0.012)].mean()
            w = WIDTH[name]; k = (low + 0.5) / im.width
            fw, fh = FOOT.get(name) or (round(w * k * 0.9), round(w * (1 - k) * 0.9))
            props[name] = {'w': w, 'fw': max(12, fw), 'fh': max(12, fh), 'ar': round(im.height / im.width, 3)}
            print(f'{name:16s} {im.size} low {k:.2f} → fw {props[name]["fw"]} fh {props[name]["fh"]}')
    json.dump(props, open(os.path.join(ART, 'props.json'), 'w'), indent=1)

# ---------- floor tiles ----------
TILES = {'fl_a': ['hall0', 'hall1', 'hall2', 'hall3'], 'fl_b': ['store0', 'store1', 'server0', 'server1'], 'fl_c': ['exp0', 'exp1', 'green0', 'green1'],
         'fl_d': ['gen0', 'gen1', 'cells0', 'cells1'], 'fl_e': ['cafe0', 'cafe1', 'decon0', 'decon1']}
def do_tiles():
    for sheet, names in TILES.items():
        im = Image.open(os.path.join(SRC, sheet + '.png')).convert('RGB'); W, H = im.size
        for q, name in enumerate(names):
            x0, y0 = (q % 2) * W // 2, (q // 2) * H // 2
            t = im.crop((x0 + 3, y0 + 3, x0 + W // 2 - 3, y0 + H // 2 - 3)).resize((256, 256), Image.LANCZOS)
            t.save(os.path.join(OUT, 't_lf_' + name + '.png'), optimize=True); A['t_lf_' + name] = {'w': 256, 'h': 256, 'crop': [0, 0, 256, 256], 'scale': 1}
        print('tiles', sheet, names)

# ---------- the new zombies (cut into rig parts by rigcut afterwards) ----------
MOBS = ['lassist', 'lsubject', 'lflask', 'lhazmat', 'lguard', 'lchemist']
def do_mobs():
    os.makedirs(ART, exist_ok=True)
    for n in MOBS:
        rgba = clean(key(os.path.join(SRC, n + '.png')), 3000)
        if n == 'lhazmat':                                           # the visor's pink glint (the magenta seen through the glass) to grey
            c = rgba[..., :3]; pink = np.clip((np.minimum(c[..., 0], c[..., 2]) - c[..., 1] - 0.15) * 5, 0, 1)[..., None]; c[:] = c * (1 - pink) + c.mean(axis=2, keepdims=True) * pink
        part, _ = trim(rgba, 24); to_img(part).save(os.path.join(ART, 'a_' + n + '.png'))
        print('mob', n, part.shape[1], part.shape[0])

def do_card():
    im = Image.open(os.path.join(SRC, 'bg_loc_lab.png')).convert('RGB').resize((1536, 1024), Image.LANCZOS)
    im.save(os.path.join(OUT, 'bg_loc_lab.png'), optimize=True); A['bg_loc_lab'] = {'w': 1536, 'h': 1024, 'crop': [0, 0, 1536, 1024], 'scale': 1}

what = sys.argv[1:] or ['props', 'tiles', 'mobs', 'card']
if 'props' in what: do_props()
if 'tiles' in what: do_tiles()
if 'mobs' in what: do_mobs()
if 'card' in what: do_card()
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
print('assets.js', len(A))
