# The office building's mirror image with its sign still readable: art/office/user/office/1.png flipped left to right
# into office/2.png, then the sign board's face painted back from the original, so NEAR and its logo read the right way.
# gen/m1art.py cuts office/2.png into m1_off_building2.
#   python gen/mirrorsign.py
import os

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art/office/user/office/1.png')
OUT = os.path.join(ROOT, 'art/office/user/office/2.png')

# The sign's face on the original drawing (measured on the 1536 x 1024 sheet): its left and right ends, and its top and
# bottom edges as lines y = y0 + slope * (x - X0). The board's top strip and its right end's side stay mirrored as they
# are: in the mirror they belong where the flip puts them.
X0, X1 = 358, 739
TOP = (426.0, 0.4287)
BOT = (514.0, 0.4215)


def edge(e, x):
    return e[0] + e[1] * (x - X0)


o = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
W = o.shape[1]
m = o[:, ::-1].copy()
ys = np.arange(o.shape[0], dtype=np.float32)
for u in range(X1 - X0 + 1):
    xt = W - 1 - X1 + u  # the column in the mirror, read from the sign's left (reading) end
    xm = X1 - u  # the original's column that the flip put there: the board's edges there
    xs = X0 + u  # the original's column that holds this part of the text
    t0, t1 = edge(TOP, xm), edge(BOT, xm)
    s0, s1 = edge(TOP, xs), edge(BOT, xs)
    rows = np.arange(int(np.ceil(t0)), int(np.floor(t1)) + 1)
    t = (rows - t0) / (t1 - t0)
    src = s0 + t * (s1 - s0)
    for c in range(3):
        m[rows, xt, c] = np.interp(src, ys, o[:, xs, c])
Image.fromarray(np.clip(m + 0.5, 0, 255).astype(np.uint8)).save(OUT)
print(OUT)
