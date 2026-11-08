# A rig's cut at a glance: python gen/rigshow.py <out.png> <rig>... — each rig: its drawing, its parts tinted apart, a grid every 20 rig px
# (to write --arm / --thigh polygons for gen/rigcut.py) and its pivots (live/rigs.js)
import json, os, re, sys
import numpy as np
from PIL import Image, ImageDraw
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = json.loads(re.sub(r'^window\.RIGS = |;\s*$', '', open(os.path.join(ROOT, 'live/rigs.js')).read().strip()))
COL = {'body': (255, 255, 255), 'uarmL': (255, 80, 80), 'farmL': (255, 170, 60), 'uarmR': (80, 140, 255), 'farmR': (60, 220, 255), 'thighL': (120, 255, 120), 'shinL': (40, 160, 40),
       'thighR': (255, 120, 255), 'shinR': (170, 60, 200), 'footL': (255, 255, 80), 'footR': (200, 200, 0)}
out, names = sys.argv[1], sys.argv[2:]
K = 2; tiles = []
for n in names:
    M = R[n]; W, H = M['w'], M['h']
    a = Image.new('RGBA', (W * K * 2 + 20, H * K), (40, 44, 52, 255)); d = ImageDraw.Draw(a)
    for p in M['parts']:
        f = os.path.join(ROOT, 'art/lab/parts', f'{n}__{p}.png')
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGBA').resize((W * K, H * K))
        a.alpha_composite(im, (0, 0))
        t = np.asarray(im).astype(np.float32); c = np.array(COL.get(p, (200, 200, 200)), np.float32)
        t[..., :3] = t[..., :3] * 0.35 + c * 0.65; a.alpha_composite(Image.fromarray(t.astype(np.uint8)), (W * K + 20, 0))
    for x in range(0, W, 20): d.line([(W * K + 20 + x * K, 0), (W * K + 20 + x * K, H * K)], fill=(255, 255, 255, 40))
    for y in range(0, H, 20): d.line([(W * K + 20, y * K), (W * K * 2 + 20, y * K)], fill=(255, 255, 255, 40)); d.text((W * K + 22, y * K), str(y), fill=(255, 255, 0))
    for k, v in M.items():
        if isinstance(v, list) and len(v) == 2 and all(isinstance(q, (int, float)) for q in v):
            x, y = W * K + 20 + v[0] * K, v[1] * K; d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 0, 0), width=2); d.text((x + 5, y - 6), k, fill=(255, 220, 220))
    tiles.append(a)
S = Image.new('RGBA', (sum(t.width for t in tiles) + 10 * len(tiles), max(t.height for t in tiles)), (20, 20, 24, 255)); x = 0
for t in tiles: S.alpha_composite(t, (x, 0)); x += t.width + 10
S.convert('RGB').save(out, quality=85); print(out, S.size)
