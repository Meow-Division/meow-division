# A 2:1 isometric wireframe of a box building, a geometry reference for an image model (art/office/refs/guide_building.png).
# The long face (W) is the lower-left face with the entrance; the short face (D) is the lower-right one.
#   python gen/isoguide.py [W D H]   (world px; defaults 1000 520 470)
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
W, D, H = (float(v) for v in sys.argv[1:4]) if len(sys.argv) > 3 else (1000.0, 520.0, 470.0)
IW, IH, FILL = 1536, 1024, 1100  # image size, building width in the image

s = FILL / (W + D)
top = (IH - (H + (W + D) / 2) * s) / 2
ox = (IW - FILL) / 2 + W * s  # the front corner's x


def P(gx, gy, z=0.0):
    """gx along the long face (0 = left corner .. W = front corner), gy along the short face (0 = front .. D = right)."""
    x = ox - (W - gx) * s + gy * s
    y = top + H * s + (W + D) / 2 * s - ((W - gx) + gy) / 2 * s - z * s
    return (x, y)


im = Image.new('RGB', (IW, IH), 'white')
d = ImageDraw.Draw(im)
K, G = (0, 0, 0), (170, 170, 170)
# floors (thin grey bands on both faces)
for f in (1, 2):
    z = H * f / 3.15
    d.line([P(0, 0, z), P(W, 0, z), P(W, D, z)], fill=G, width=2)
# the entrance: door, canopy, steps on the long face's middle
c = W * 0.5
d.polygon([P(c - 60, 0, 0), P(c + 60, 0, 0), P(c + 60, 0, 120), P(c - 60, 0, 120)], fill=(120, 120, 120))
d.polygon([P(c - 85, 0, 135), P(c + 85, 0, 135), P(c + 85, -60, 135), P(c - 85, -60, 135)], fill=(200, 200, 200), outline=K)
d.polygon([P(c - 75, 0, 0), P(c + 75, 0, 0), P(c + 75, -55, 0), P(c - 75, -55, 0)], outline=K)
# the box: visible verticals, ground edges, roof outline
for gx, gy in ((0, 0), (W, 0), (W, D)):
    d.line([P(gx, gy), P(gx, gy, H)], fill=K, width=4)
d.line([P(0, 0), P(W, 0), P(W, D)], fill=K, width=4)
d.line([P(0, 0, H), P(W, 0, H), P(W, D, H), P(0, D, H), P(0, 0, H)], fill=K, width=4)
out = os.path.join(ROOT, 'art/office/refs/guide_building.png')
im.save(out)
print(out, [round(v) for v in P(0, 0) + P(W, 0) + P(W, D)])
