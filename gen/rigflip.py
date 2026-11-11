# A cut rig drawn facing right, turned to face left as every rig must (the scene mirrors a rig to walk right, so one drawn the
# other way walks backwards): python gen/rigflip.py <rig>...
# The rig is mirrored whole, in place: each part's picture (live/assets/<rig>__<part>.png) flipped and swapped with its partner on
# the other side (footL <-> footR, ...), its place on the canvas (live/assets.js crop) mirrored, every pivot in live/rigs.js mirrored
# and its side swapped; the toe and the heel then traded so the toe stays the foot's left end (the cut's own rule). The cut itself
# (the parts' edges, the back-fill behind them) stays as it was. A rig turned once is marked (flipped: 1) and never turned again.
import json, os, re, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
AS, RG, PARTS = (os.path.join(ROOT, 'live', f) for f in ('assets.js', 'rigs.js', 'assets'))
A = json.loads(re.sub(r'^window\.ASSETS = |;\s*$', '', open(AS, encoding='utf-8').read().strip()))
R = json.loads(re.sub(r'^window\.RIGS = |;\s*$', '', open(RG, encoding='utf-8').read().strip()))
swap = lambda k: k[:-1] + {'L': 'R', 'R': 'L'}[k[-1]] if k[-1:] in ('L', 'R') else k
for rig in sys.argv[1:]:
    M = R[rig]
    if M.get('flipped'):
        print(rig, 'already turned: left as it is')
        continue
    W = M['w']
    out = {}
    for k, v in M.items():
        if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
            out[swap(k)] = [W - v[0], v[1]]
        else:
            out[k] = v
    for s in 'LR':  # (mirrored, the toe would be the foot's right end: the two traded back)
        if 'toe' + s in out and 'heel' + s in out:
            out['toe' + s], out['heel' + s] = out['heel' + s], out['toe' + s]
    out['flipped'] = 1
    R[rig] = out
    ims, ent = {}, {}
    for p in M['parts']:
        n = f'{rig}__{p}'
        ims[p] = Image.open(os.path.join(PARTS, n + '.png')).convert('RGBA').transpose(Image.FLIP_LEFT_RIGHT)
        x0, y0, x1, y1 = A[n]['crop']
        ent[p] = dict(A[n], crop=[W - x1, y0, W - x0, y1])
    for p in M['parts']:
        q = swap(p)
        ims[p].save(os.path.join(PARTS, f'{rig}__{q}.png'), optimize=True)
        A[f'{rig}__{q}'] = ent[p]
    print(rig, 'turned to face left')
open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')
open(RG, 'w', encoding='utf-8', newline='').write('window.RIGS = ' + json.dumps(R) + ';\n')
