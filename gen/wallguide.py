# The office's inside wall kit (mission 1, live/map_office_in.js): 2:1 isometric wireframes, a geometry reference for an image
# model, one per sheet of four pieces (art/office/refs/guide_walls_<sheet>.png, a 2x2 grid on a square image). Every
# straight piece is the same box: L along its run, T thick, H tall (world px, as gen/m1art.py sizes them: WALL_H for the full
# walls, LOW_H for the low ones), so pieces laid end to end on the floor's grid join into one wall. A piece along gx falls to
# the right on screen (we see its face toward +gy and its right end); one along gy rises to the right (its face toward +gx and
# its left end). On the faces, light grey: where a window, a door or a glass panel goes.
#   python gen/wallguide.py
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
L, T, H, LOW_H = 250, 30, 160, 70  # a wall piece: run, thickness, height; a low one's height
PW, PH, PLOW = 50, 175, 95  # a pillar: square side, height; a low one's height
S = 1.4  # image px per world px (the same in every sheet)
IM, CELL = 1024, 512
K, G = (0, 0, 0), (165, 165, 165)

# the sheets: (piece, run along 'x' or 'y' or 'p' for a pillar, height, face marks)
SHEETS = {
    'a': [('x', H, 'plain'), ('x', H, 'window'), ('x', H, 'door'), ('x', H, 'glass')],
    'b': [('y', H, 'plain'), ('y', H, 'window'), ('y', H, 'door'), ('y', H, 'glass')],
    'c': [('x', LOW_H, 'plain'), ('x', LOW_H, 'plain'), ('y', LOW_H, 'plain'), ('y', LOW_H, 'plain')],
    'd': [('p', PH, 'plain'), ('p', PLOW, 'plain'), ('x', H, 'entrance'), ('y', H, 'entrance')],
}


def draw(d, cx, cy, run, h, mark):
    ex, ey = (L, T) if run == 'x' else (T, L) if run == 'y' else (PW, PW)
    # screen: x = gx - gy, y = (gx + gy) / 2 - z; centred in the cell
    x0, x1 = -ey, ex
    y0, y1 = -h, (ex + ey) / 2
    ox = cx - (x0 + x1) / 2 * S
    oy = cy - (y0 + y1) / 2 * S

    def P(gx, gy, z=0.0):
        return (ox + (gx - gy) * S, oy + ((gx + gy) / 2 - z) * S)

    # face marks first (under the outline): on the visible long face
    def face(a, b, z0, z1, fill=None):
        # a rectangle on the long face from a to b along the run, z0..z1 up
        if run == 'x':
            q = [P(a, ey, z0), P(b, ey, z0), P(b, ey, z1), P(a, ey, z1)]
        else:
            q = [P(ex, a, z0), P(ex, b, z0), P(ex, b, z1), P(ex, a, z1)]
        d.polygon(q, outline=G, fill=fill, width=3)

    run_len = L
    if mark == 'window':
        face(22, run_len - 22, 48, h - 22)
        for k in (1, 2):
            a = 22 + (run_len - 44) * k / 3
            face(a, a, 48, h - 22)
    elif mark == 'door':
        face(run_len / 2 - 38, run_len / 2 + 38, 0, 118)
        face(run_len / 2 - 8, run_len / 2 + 8, 128, 140)
    elif mark == 'glass':
        face(10, run_len - 10, 8, h - 8)
        face(run_len / 2, run_len / 2, 8, h - 8)
    elif mark == 'entrance':
        face(30, run_len - 30, 0, h - 26)
        face(run_len / 2, run_len / 2, 0, h - 26)
    # the box: the visible verticals, the visible ground edges, the top outline
    for gx, gy in ((ex, 0), (ex, ey), (0, ey)):
        d.line([P(gx, gy), P(gx, gy, h)], fill=K, width=4)
    d.line([P(0, ey), P(ex, ey), P(ex, 0)], fill=K, width=4)
    d.line([P(0, 0, h), P(ex, 0, h), P(ex, ey, h), P(0, ey, h), P(0, 0, h)], fill=K, width=4)


for name, pieces in SHEETS.items():
    im = Image.new('RGB', (IM, IM), 'white')
    d = ImageDraw.Draw(im)
    for i, (run, h, mark) in enumerate(pieces):
        draw(d, (i % 2) * CELL + CELL / 2, (i // 2) * CELL + CELL / 2, run, h, mark)
    out = os.path.join(ROOT, f'art/office/refs/guide_walls_{name}.png')
    im.save(out)
    print(out)
