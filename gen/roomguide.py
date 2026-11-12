# NEAR Base's rooms drawn whole by an image model (2026-11-12, the human's: the generator room, the medbay, the workbench
# and the kitchen, each after its crop of the base concept): a 2:1 isometric wireframe of each room as a geometry guide
# (world px, the game's projection: screen x = gx - gy, y = (gx + gy) / 2 - z). The flat outline is the room's floor
# between its walls' inner faces (live/map_base.js), the picture's floor edge to edge, so the art lays into the room by its
# corners; each box is one object, the nearer boxes hiding the ones behind. x runs along gx (to the lower right), y along
# gy (to the lower left); the back walls are y = 0 (upper right) and x = 0 (upper left).
#   python gen/roomguide.py
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IW, IH, M = 1536, 1024, 80  # the image (landscape) and its margin
K = (0, 0, 0)

# a room: its floor (gx, gy extent from its back corner) and its boxes (x0, y0, ex, ey, z0, h) back to front
ROOMS = {
    # gx 1765..1985, gy 1655..1905: the glass wall with its doorway at x = 220 (the doorway y 140..232), a solid wall at
    # y = 250 (it hides the left of the floor: the machine stands along the back right wall, seen through the glass)
    'gen': {
        'floor': (220, 250),
        'boxes': [
            (8, 10, 48, 100, 0, 55),  # the red fuel tank on its cradle, in the back corner
            (64, 14, 116, 80, 0, 82),  # the yellow diesel generator
            (186, 6, 28, 44, 0, 125),  # the control cabinet, by the glass
        ],
    },
    # gx 1765..2015, gy 1935..2265 (the meeting room): glass on both front sides, the way in at x = 250, y 0..110
    'med': {
        'floor': (250, 330),
        'boxes': [
            (10, 62, 36, 36, 0, 115),  # the heart monitor on its rolling stand
            (60, 6, 76, 34, 0, 120),  # the glass-fronted medicine cabinet
            (14, 108, 20, 20, 0, 125),  # the drip stand
            (150, 6, 50, 44, 0, 140),  # the glowing medicine fridge
            (4, 150, 118, 64, 0, 42),  # bed 1
            (4, 226, 64, 6, 0, 110),  # the curtain on its rail between the beds (half the beds' length)
            (4, 246, 118, 64, 0, 42),  # bed 2
        ],
    },
    # gx 2905..3265, gy 1435..1685 (the right alcove, its front wall gone with the junk): the exit door in the back right
    # wall at x 245..340 kept clear, a low wall at x = 360, open at y = 250
    'wb': {
        'floor': (360, 250),
        'boxes': [
            (12, 6, 110, 58, 0, 48),  # bench 1 (drawers)
            (16, 4, 100, 8, 48, 100),  # its tool pegboard
            (26, 16, 30, 30, 48, 62),  # the drill press on it
            (128, 6, 112, 58, 0, 48),  # bench 2
            (132, 4, 104, 8, 48, 100),  # its pegboard of rifles
            (200, 30, 24, 20, 48, 18),  # the vise
            (6, 90, 46, 70, 0, 74),  # the rolling tool chest
            (140, 72, 64, 38, 0, 30),  # ammo cases
        ],
    },
    # gx 2515..2875, gy 1435..1685 (the store room between the server room and the workbench): glass at x = 0 (the
    # server room behind it), a tall wall at x = 360 (it hides the right of the floor), open at y = 250
    'kit': {
        'floor': (360, 250),
        'boxes': [
            (10, 6, 70, 52, 0, 46),  # the stove
            (84, 6, 110, 52, 0, 46),  # two counter cabinets
            (90, 4, 100, 18, 46, 95),  # the open shelf rack on them
            (200, 10, 44, 44, 0, 62),  # the blue water barrel
            (40, 130, 120, 64, 0, 38),  # the table
            (252, 6, 56, 50, 0, 135),  # the old fridge
            (60, 205, 26, 26, 0, 26),  # stools
            (120, 205, 26, 26, 0, 26),
            (170, 150, 26, 26, 0, 26),
        ],
    },
}


def draw(name, room):
    im = Image.new('RGB', (IW, IH), 'white')
    d = ImageDraw.Draw(im)
    mx, my = room['floor']
    pts = [(0, 0, 0), (mx, 0, 0), (mx, my, 0), (0, my, 0)]
    for x0, y0, ex, ey, z0, h in room['boxes']:
        pts += [(x0, y0, z0 + h), (x0 + ex, y0, z0 + h), (x0, y0 + ey, z0 + h)]
    xs = [gx - gy for gx, gy, z in pts]
    ys = [(gx + gy) / 2 - z for gx, gy, z in pts]
    S = min((IW - 2 * M) / (max(xs) - min(xs)), (IH - 2 * M) / (max(ys) - min(ys)))
    ox = IW / 2 - (min(xs) + max(xs)) / 2 * S
    oy = IH / 2 - (min(ys) + max(ys)) / 2 * S

    def P(gx, gy, z=0.0):
        return (ox + (gx - gy) * S, oy + ((gx + gy) / 2 - z) * S)

    d.polygon([P(0, 0), P(mx, 0), P(mx, my), P(0, my)], outline=K, width=5)
    for x0, y0, ex, ey, z0, h in room['boxes']:
        x1, y1, z1 = x0 + ex, y0 + ey, z0 + h
        top = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]
        front = [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]
        side = [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]
        for f in (top, front, side):
            d.polygon(f, fill='white')
        for f in (top, front, side):
            d.line(f + [f[0]], fill=K, width=4, joint='curve')
    out = os.path.join(ROOT, f'art/office/refs/guide_room_{name}.png')
    im.save(out)
    c = [tuple(round(v) for v in P(*q)) for q in ((0, 0), (mx, 0), (mx, my), (0, my))]
    print(out, f'floor {mx}x{my}, {S:.2f} px per world px, floor corners {c}')


for name, room in ROOMS.items():
    draw(name, room)
