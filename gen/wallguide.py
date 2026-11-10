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
    # clear glass walls (2026-11-10): whole and broken; a glass door, ivy
    'g1': [('x', H, 'glass'), ('y', H, 'glass'), ('x', H, 'glass'), ('y', H, 'glass')],
    'g2': [('x', H, 'glassdoor'), ('y', H, 'glassdoor'), ('x', H, 'glass'), ('y', H, 'glass')],
    # the reception after the concept (2026-11-10): the whole island both ways (a slat wall with the desk in front of
    # it), and the slat wall alone as kit pieces
    'r': [('sx', 0, 'set'), ('sy', 0, 'set'), ('x', H, 'sign'), ('y', H, 'sign')],
}
# the reception island: its slat wall (run SW_L, T thick, SW_H tall) and its desk (DK_L along, DK_D deep, DK_H tall)
# DK_GAP in front of it, centred on it
SW_L, SW_H, DK_L, DK_D, DK_H, DK_GAP = 300, 180, 260, 70, 55, 70
S_SET = 0.85  # (the island is drawn smaller in its quarter: it is sized in the game by its own width)


def box_lines(d, P, x0, y0, ex, ey, h):
    # one box from (x0, y0) ex along gx, ey along gy, h tall: its visible edges
    Q = lambda gx, gy, z=0.0: P(x0 + gx, y0 + gy, z)
    for gx, gy in ((ex, 0), (ex, ey), (0, ey)):
        d.line([Q(gx, gy), Q(gx, gy, h)], fill=K, width=4)
    d.line([Q(0, ey), Q(ex, ey), Q(ex, 0)], fill=K, width=4)
    d.line([Q(0, 0, h), Q(ex, 0, h), Q(ex, ey, h), Q(0, ey, h), Q(0, 0, h)], fill=K, width=4)


def draw_set(d, cx, cy, run):
    # the slat wall at the back, the desk in front of it (toward +gy for a wall along gx, +gx for one along gy)
    off = (SW_L - DK_L) / 2
    if run == 'sx':
        boxes = [(0, 0, SW_L, T, SW_H), (off, T + DK_GAP, DK_L, DK_D, DK_H)]
    else:
        boxes = [(0, 0, T, SW_L, SW_H), (T + DK_GAP, off, DK_D, DK_L, DK_H)]
    xs, ys = [], []
    for x0, y0, ex, ey, h in boxes:
        for gx, gy in ((x0, y0), (x0 + ex, y0), (x0, y0 + ey), (x0 + ex, y0 + ey)):
            xs.append(gx - gy)
            ys += [(gx + gy) / 2, (gx + gy) / 2 - h]
    ox = cx - (min(xs) + max(xs)) / 2 * S_SET
    oy = cy - (min(ys) + max(ys)) / 2 * S_SET

    def P(gx, gy, z=0.0):
        return (ox + (gx - gy) * S_SET, oy + ((gx + gy) / 2 - z) * S_SET)

    # the sign on the wall's face
    x0, y0, ex, ey, h = boxes[0]
    if run == 'sx':
        q = [P(70, T, 65), P(230, T, 65), P(230, T, 150), P(70, T, 150)]
    else:
        q = [P(T, 70, 65), P(T, 230, 65), P(T, 230, 150), P(T, 70, 150)]
    d.polygon(q, outline=G, width=3)
    for b in boxes:
        box_lines(d, P, *b)


def draw(d, cx, cy, run, h, mark):
    if run in ('sx', 'sy'):
        draw_set(d, cx, cy, run)
        return
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
    elif mark == 'glassdoor':
        face(10, run_len - 10, 8, h - 8)
        face(run_len / 2, run_len / 2, 8, h - 8)
        face(run_len / 2 + 14, run_len - 24, 0, h - 26)
    elif mark == 'sign':
        face(45, run_len - 45, 60, h - 22)
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
