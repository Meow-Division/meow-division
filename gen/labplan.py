# A top-down picture of the lab's level from gen/labcheck.cjs's JSON: python gen/labplan.py <cols.json> <out.png>
# walls dark, props blue (named), starts green, the arena's circle, squeeze cells orange, cells shut off red
import json, sys
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1])); S = 0.25
im = Image.new('RGB', (int(4800 * S), int(4800 * S)), (210, 214, 220)); g = ImageDraw.Draw(im)
P = lambda x, y: (x * S, y * S)
for c in d['cols']:
    g.rectangle([*P(c['x0'], c['y0']), *P(c['x1'], c['y1'])], fill=(40, 44, 54) if c['wall'] else (90, 130, 200), outline=None if c['wall'] else (20, 40, 90))
for c in d['cols']:
    if not c['wall'] and (c['x1'] - c['x0']) * (c['y1'] - c['y0']) > 3000: g.text(P(c['x0'], c['y0'] - 26), c['n'].replace('lb_', ''), fill=(10, 10, 60))
for x, y in d['sq']: g.rectangle([*P(x, y), *P(x + 20, y + 20)], fill=(255, 140, 0))
for x, y in d['lost']: g.rectangle([*P(x, y), *P(x + 20, y + 20)], fill=(255, 0, 0))
for x, y in d['starts']: g.ellipse([*P(x - 40, y - 40), *P(x + 40, y + 40)], fill=(40, 200, 60))
x0, y0, x1, y1 = d['hall']; g.rectangle([*P(x0, y0), *P(x1, y1)], outline=(200, 40, 40), width=2)
im.save(sys.argv[2]); print(sys.argv[2], im.size)
