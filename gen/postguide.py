# NEAR Base's two people's corners (2026-11-12): Nova's radio post and Walt's trade corner, each one prop drawn whole by an
# image model. The first try (no guide) came out turned off the 2:1 grid and its chairs twice a seated cat's size, so this
# draws each one's geometry as 2:1 isometric wireframe boxes (world px, the game's projection: screen x = gx - gy,
# y = (gx + gy) / 2 - z), the nearer boxes hiding the ones behind. The mat under it all is the flat outline on the floor,
# tight round the furniture: it is the prop's footprint (gen/m1art.py foot=), so the hero walks right up to the desk.
#   python gen/postguide.py
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
S = 1.35  # image px per world px
IM = 1024
K, G = (0, 0, 0), (165, 165, 165)

# a post: its mat (gx, gy extent from 0) and its boxes (gx0, gy0, ex, ey, z0, h) back to front
POSTS = {
    'nova': {
        'mat': (250, 190),
        'boxes': [
            (30, 14, 160, 8, 48, 92),  # the cork board's panel
            (40, 14, 6, 8, 0, 48),  # its two legs
            (174, 14, 6, 8, 0, 48),
            (212, 26, 26, 34, 0, 100),  # the rifle in its floor rack
            (88, 62, 34, 34, 0, 68),  # the chair (its back toward -gy, the seat 28 up)
            (206, 74, 36, 26, 0, 22),  # an ammo case
            (36, 106, 170, 58, 0, 46),  # the desk
            (60, 166, 50, 20, 0, 22),  # a hard case before the desk
        ],
    },
    'walt': {
        'mat': (260, 200),
        'boxes': [
            (16, 12, 214, 40, 0, 150),  # the shelves
            (100, 62, 34, 34, 0, 68),  # the chair
            (222, 64, 34, 34, 0, 64),  # a stack of crates
            (40, 112, 180, 58, 0, 48),  # the counter
            (224, 150, 30, 24, 0, 30),  # a fuel can
        ],
    },
}


def draw(name, post):
    im = Image.new('RGB', (IM, IM), 'white')
    d = ImageDraw.Draw(im)
    mx, my = post['mat']
    pts = [(0, 0, 0), (mx, 0, 0), (mx, my, 0), (0, my, 0)]
    for x0, y0, ex, ey, z0, h in post['boxes']:
        pts += [(x0, y0, z0 + h), (x0 + ex, y0, z0 + h), (x0, y0 + ey, z0 + h)]
    xs = [gx - gy for gx, gy, z in pts]
    ys = [(gx + gy) / 2 - z for gx, gy, z in pts]
    ox = IM / 2 - (min(xs) + max(xs)) / 2 * S
    oy = IM / 2 - (min(ys) + max(ys)) / 2 * S

    def P(gx, gy, z=0.0):
        return (ox + (gx - gy) * S, oy + ((gx + gy) / 2 - z) * S)

    # the mat: its outline on the floor, a hazard band inside its edge in light grey
    d.polygon([P(0, 0), P(mx, 0), P(mx, my), P(0, my)], outline=K, width=4)
    b = 9
    d.polygon([P(b, b), P(mx - b, b), P(mx - b, my - b), P(b, my - b)], outline=G, width=3)
    # the boxes, back to front, each one's three seen faces filled white (hiding what is behind) and outlined
    for x0, y0, ex, ey, z0, h in post['boxes']:
        x1, y1, z1 = x0 + ex, y0 + ey, z0 + h
        top = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]
        front = [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]  # (toward +gy: lower left)
        side = [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]  # (toward +gx: lower right)
        for f in (top, front, side):
            d.polygon(f, fill='white')
        for f in (top, front, side):
            d.line(f + [f[0]], fill=K, width=4, joint='curve')
    out = os.path.join(ROOT, f'art/office/refs/guide_post_{name}.png')
    im.save(out)
    print(out, f'mat {mx}x{my}, screen width {mx + my} world px')


for name, post in POSTS.items():
    draw(name, post)
