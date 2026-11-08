# A cut rig's parts into the game: python gen/rigpack.py <rig>... — each part (art/lab/parts/<rig>__<part>.png, on the rig's whole canvas,
# as gen/rigcut.py leaves it) trimmed to its pixels → live/assets/<rig>__<part>.png, its place on the canvas → live/assets.js crop
import json, os, re, sys
import numpy as np
from PIL import Image
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
AS = os.path.join(ROOT, 'live/assets.js')
A = json.loads(re.sub(r'^window\.ASSETS = |;\s*$', '', open(AS, encoding='utf-8').read().strip()))
R = json.loads(re.sub(r'^window\.RIGS = |;\s*$', '', open(os.path.join(ROOT, 'live/rigs.js')).read().strip()))
for rig in sys.argv[1:]:
    for k in [k for k in list(A) if k.startswith(rig + '__')]: del A[k]
    for p in R[rig]['parts']:
        im = Image.open(os.path.join(ROOT, 'art/lab/parts', f'{rig}__{p}.png')).convert('RGBA')
        al = np.asarray(im)[..., 3]; ys, xs = np.where(al > 0)
        x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        im.crop((x0, y0, x1, y1)).save(os.path.join(ROOT, 'live/assets', f'{rig}__{p}.png'), optimize=True)
        A[f'{rig}__{p}'] = {'w': x1 - x0, 'h': y1 - y0, 'crop': [x0, y0, x1, y1], 'scale': 1}
    print(rig, R[rig]['parts'])
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
