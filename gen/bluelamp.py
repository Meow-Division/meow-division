# The office's blue wall lamp (live/assets/of_bluelamp.png): the server room's cyan light bar, drawn here, not painted.
# A dark housing along gx with a bright cyan tube and its glow, mounted HIGH above the floor point the sprite stands on
# (the sprite's bottom centre): the lamp prop's footprint sits at the wall's foot, the bar near the wall's top. Its light
# on the floor is scene.js's (LAMPC of_bluelamp); its head for LAMPG: hx 0.5, hy = MOUNT / the sprite's height.
# Run: python gen/bluelamp.py
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
K = 1.45 * 4  # drawn 4x (smooth edges), stored at 1.45 px per world px as the other props
L, MOUNT, GLOW = 100, 200, 14  # the bar's length along gx, its height over the floor, the glow's reach (world px)
W = L + 2 * GLOW
H = MOUNT + L / 4 + 2 * GLOW
cw, ch = round(W * K), round(H * K)
cx = cw / 2
cy = ch - MOUNT * K  # the bar's centre


def bar(d, t, off, fill):
    # a strip along gx (screen: 2 across, 1 down) t px thick, its centre line off px below the bar's centre
    hx, hy = L * K / 2, L * K / 4
    d.polygon([(cx - hx, cy - hy + off - t / 2), (cx + hx, cy + hy + off - t / 2), (cx + hx, cy + hy + off + t / 2),
               (cx - hx, cy - hy + off + t / 2)], fill=fill)


glow = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
bar(ImageDraw.Draw(glow), 26 * K, 1 * K, (50, 225, 255, 235))
glow = glow.filter(ImageFilter.GaussianBlur(GLOW * K / 2))
im = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
im.alpha_composite(glow)
im.alpha_composite(glow)
d = ImageDraw.Draw(im)
bar(d, 17 * K, 0, (26, 31, 38, 255))  # the housing's front
bar(d, 2.5 * K, -7.2 * K, (92, 104, 118, 255))  # its lit top edge
bar(d, 11 * K, 1.4 * K, (64, 226, 250, 255))  # the glowing face
bar(d, 4.5 * K, 1.4 * K, (170, 252, 255, 255))  # its bright middle
cw, ch = round(cw / 4), round(ch / 4)
im = im.resize((cw, ch), Image.LANCZOS)
im.save(os.path.join(ROOT, 'live/assets/of_bluelamp.png'), optimize=True)

AS = os.path.join(ROOT, 'live/assets.js')
t = open(AS, encoding='utf-8').read()
pre = 'window.ASSETS = '
A = json.loads(t[len(pre):].rstrip().rstrip(';'))
A['of_bluelamp'] = {'w': cw, 'h': ch, 'crop': [0, 0, cw, ch], 'scale': 1}
open(AS, 'w', encoding='utf-8', newline='').write(pre + json.dumps(A, separators=(',', ':')) + ';\n')
print('of_bluelamp', (cw, ch), 'w', round(W), 'hy %.3f' % (MOUNT / H))
