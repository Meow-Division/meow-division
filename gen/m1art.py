# Mission 1's own art (the human's sheets, art/office/user: copied from "ассеты для первой миссии") → game pictures:
# live/assets/<name>.png keyed off the magenta and trimmed the way gen/baseart.py / gen/officeart.py cut theirs, their
# live/assets.js entries, and the generated blocks in live/sim.js (PROP), live/scene.js (LAMPG) and live/editor.js (NAMES)
# between their "m1art" marker lines. Names: m1_<group>_<thing> (the editor's palette groups them by the prefix),
# trees p_mtree4.. and bushes p_mbush5.. (they sway and go see-through as the town's).
# Sizes: world px across each drawing (WIDTH below; a zombie stands 110 tall); the office's inside wall pieces instead
# all stand WALL_H tall (one scale per sheet from its straight pieces) so pieces of different sheets join.
# Footprints: the drawing's lowest point is the footprint's front corner (as gen/officeart.py), 0.9 of it; front= overrides it.
# Run: python gen/m1art.py
import json, os, re
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
src = open(os.path.join(HERE, 'labart.py'), encoding='utf-8').read()
ns = {'__file__': os.path.join(HERE, 'labart.py')}
exec(src.split('# ---------- props ----------')[0], ns)
key, trim, to_img, shrink, A, AS = ns['key'], ns['trim'], ns['to_img'], ns['shrink'], ns['A'], ns['AS']
SRC = os.path.join(ROOT, 'art/office/user')
OUT = os.path.join(ROOT, 'live/assets')
WALL_H = 160  # the office's inside walls: world px from the floor to the top of a wall piece
# the office's inside wall kit (gen/wallguide.py, its sheets drawn to its guides: art/office/user/inside/kit): every
# straight piece KIT_L along its run and KIT_T thick, a pillar KIT_P square, footprints exactly that (no 0.9), so pieces
# laid flush join; a piece's drawing is sized by its run (x / y), a pillar by its sheet's straight pieces' scale
KIT_L, KIT_T, KIT_P = 250, 30, 50

# (sheet, columns, rows, [(name, Russian name, world width, options)]) in reading order; options: m material, bld,
# lamp, nocol (stops nothing), flat (painted flat under everyone: blood, litter), wall (an inside wall piece: sized by
# WALL_H), kit ('x' / 'y': a straight piece of the wall kit along gx / gy; 'p': its pillar), glass (its panes, keyed out
# inside the frame, get a faint cool tint), tree / bush (k: the bush's width over 95)
B, M_ = 'brick', 'metal'
SHEETS = [
    ('checkpoint/1.png', 2, 2, [
        ('m1_cp_booth', 'Будка блокпоста', 280, dict(m=B, bld=1)),
        ('m1_cp_arch', 'Арка блокпоста', 440, dict(nocol=1)),
        ('m1_cp_wallnear', 'Стена с NEAR', 300, dict(m=B)),
        ('m1_cp_wall', 'Бетонная стена', 300, dict(m=B))]),
    ('cars/1.png', 2, 2, [
        ('m1_car_van', 'Фургон', 380, dict(m=M_)),
        ('m1_car_hatchred', 'Красный хэтчбек', 330, dict(m=M_)),
        ('m1_car_sedanbeige', 'Бежевый седан', 340, dict(m=M_)),
        ('m1_car_sedanblue', 'Синий седан', 340, dict(m=M_))]),
    ('cars/2.png', 2, 2, [
        ('m1_car_suvblack', 'Чёрный внедорожник', 360, dict(m=M_)),
        ('m1_car_muscle', 'Чёрное купе', 340, dict(m=M_)),
        ('m1_car_pickupred', 'Красный пикап', 380, dict(m=M_)),
        ('m1_car_sedanbeige2', 'Бежевый седан 2', 340, dict(m=M_))]),
    ('cars/3.png', 2, 2, [
        ('m1_car_suvbeige', 'Бежевый внедорожник', 360, dict(m=M_)),
        ('m1_car_pickupblue', 'Синий пикап', 380, dict(m=M_)),
        ('m1_car_suvyellow', 'Жёлтый внедорожник', 360, dict(m=M_)),
        ('m1_car_hatchwhite', 'Белый хэтчбек', 330, dict(m=M_))]),
    ('street/1.png', 2, 2, [
        ('m1_st_biobanner', 'Баннер с биознаком', 170, dict(nocol=1)),
        ('m1_st_debris', 'Мусор', 160, dict(flat=1)),
        ('p_mbush9', 'Трава с цветами', 0, dict(bush=1, k=1.6)),
        ('m1_st_blood', 'Кровь', 150, dict(flat=1))]),
    ('street/2.png', 2, 2, [
        ('m1_st_chest', 'Красный ящик', 100, dict(m=M_)),
        ('m1_st_blocks', 'Бетонные блоки', 150, dict(m=B)),
        ('m1_st_cratepile', 'Гора ящиков', 170, dict(m=M_)),
        ('m1_st_sandbags', 'Мешки с песком', 190, dict(m=B))]),
    ('street/3.png', 2, 2, [
        ('m1_st_cone', 'Конус', 50, dict()),
        ('m1_st_barrel', 'Красная бочка', 70, dict(m=M_)),
        ('m1_st_boxyellow', 'Жёлтый ящик', 95, dict(m=M_)),
        ('m1_st_boxmetal', 'Металлический ящик', 120, dict(m=M_))]),
    ('street/4.png', 2, 2, [
        ('m1_st_lamp', 'Фонарь', 110, dict(lamp=1)),
        ('m1_st_lamppost', 'Низкий фонарь', 70, dict(lamp=1)),
        ('m1_st_crates', 'Ящики', 150, dict(m=M_)),
        ('m1_st_sandbags2', 'Мешки с песком 2', 190, dict(m=B))]),
    ('street/5.png', 2, 2, [
        ('m1_st_lamp2', 'Фонарь 2', 110, dict(lamp=1)),
        ('m1_st_lamppost2', 'Низкий фонарь 2', 70, dict(lamp=1)),
        ('m1_st_crates2', 'Ящики 2', 150, dict(m=M_)),
        ('m1_st_sandbags3', 'Мешки с песком 3', 190, dict(m=B))]),
    ('barriers/1.png', 2, 2, [
        ('m1_bar_jerseyred', 'Блок красно-белый', 210, dict(m=B)),
        ('m1_bar_jersey', 'Бетонный блок', 210, dict(m=B)),
        ('m1_bar_fence', 'Сетка', 260, dict()),
        ('m1_bar_rail', 'Отбойник', 260, dict())]),
    ('barriers/2.png', 2, 2, [
        ('m1_bar_fencebase', 'Сетка на блоке', 290, dict(m=B)),
        ('m1_bar_sandbags', 'Мешки с песком 4', 200, dict(m=B)),
        ('m1_bar_railcurve', 'Отбойник изогнутый', 280, dict()),
        ('m1_bar_slabs', 'Бетонные плиты', 290, dict(m=B))]),
    ('barriers/3.png', 2, 2, [
        ('m1_bar_wallnear', 'Стена с NEAR 2', 300, dict(m=B)),
        ('m1_bar_fence2', 'Сетка 2', 260, dict()),
        ('m1_bar_jerseyred2', 'Блок красно-белый 2', 210, dict(m=B)),
        ('m1_bar_rail2', 'Отбойник 2', 260, dict())]),
    ('barriers/4.png', 2, 4, [
        ('m1_bar_fence3', 'Сетка 3', 260, dict()),
        ('m1_bar_wallbio', 'Стена с биознаком', 300, dict(m=B)),
        ('m1_bar_wallnear2', 'Стена с NEAR 3', 300, dict(m=B)),
        ('m1_bar_sandbags2', 'Мешки с песком 5', 200, dict(m=B)),
        ('m1_bar_jerseyred3', 'Блок красно-белый 3', 210, dict(m=B)),
        ('m1_bar_jersey2', 'Бетонный блок 2', 210, dict(m=B)),
        ('m1_bar_rail3', 'Отбойник 3', 260, dict()),
        ('m1_bar_railcurve2', 'Отбойник изогнутый 2', 280, dict())]),
    ('barriers/5.png', 2, 2, [
        ('m1_bar_jerseyred4', 'Блок красно-белый 4', 220, dict(m=B)),
        ('m1_bar_cube', 'Бетонный куб', 90, dict(m=B)),
        ('m1_bar_pillar', 'Бетонный столб', 50, dict(m=B)),
        ('m1_bar_rail4', 'Отбойник 4', 260, dict())]),
    ('barriers/6.png', 2, 2, [
        ('m1_bar_fence4', 'Сетка 4', 260, dict()),
        ('m1_bar_wallnear3', 'Стена с NEAR 4', 300, dict(m=B)),
        ('m1_bar_arch', 'Арка блокпоста 2', 440, dict(nocol=1)),
        ('m1_bar_fencegate', 'Ворота-сетка', 260, dict())]),
    ('office/1.png', 1, 1, [
        ('m1_off_building', 'Здание офиса', 1800, dict(m=B, bld=1, front=0.69, up=2))]),
    ('office/2.png', 1, 1, [  # gen/mirrorsign.py: the mirror image with the sign still readable
        ('m1_off_building2', 'Здание офиса (зеркало)', 1800, dict(m=B, bld=1, front=0.31, up=2))]),
    ('inside/1.png', 2, 2, [
        ('m1_in_reception', 'Ресепшен', 330, dict(m=B)),
        ('m1_in_slatwall', 'Стена с логотипом', 280, dict(m=B)),
        ('m1_in_lounge', 'Диваны', 360, dict()),
        ('m1_in_meeting', 'Переговорный стол', 380, dict())]),
    ('inside/reception.png', 1, 1, [
        ('m1_in_receptionset', 'Ресепшен со стеной', 440, dict(m=B))]),
    ('inside/desks/computers.png', 2, 2, [
        ('m1_in_desk1', 'Стол с компьютером', 200, dict()),
        ('m1_in_desk2', 'Двойной стол', 260, dict()),
        ('m1_in_desk4', 'Четыре стола', 330, dict()),
        ('m1_in_cubicle', 'Угловой стол', 260, dict())]),
    ('inside/desks/lounge_table.png', 1, 1, [
        ('m1_in_lounge2', 'Диваны 2', 360, dict())]),
    ('inside/walls_back_right/1.png', 2, 2, [
        ('m1_iw_plain', 'Стена', 0, dict(m=B, wall=1)),
        ('m1_iw_ivy', 'Стена с плющом', 0, dict(m=B, wall=1)),
        ('m1_iw_exit', 'Стена с выходом', 0, dict(m=B, wall=1)),
        ('m1_iw_lamp', 'Стена с лампой', 0, dict(m=B, wall=1))]),
    ('inside/walls_front/1.png', 2, 2, [
        ('m1_iw_fglass', 'Окно у входа', 0, dict(wall=1)),
        ('m1_iw_fdoor', 'Стеклянные двери', 0, dict(wall=1)),
        ('m1_iw_fwall', 'Стена у входа', 0, dict(m=B, wall=1)),
        ('m1_iw_fcorner', 'Угол у входа', 0, dict(m=B, wall=1, corner=1))]),
    ('inside/walls_front/2.png', 2, 2, [
        ('m1_iw_fglass2', 'Окно у входа 2', 0, dict(wall=1)),
        ('m1_iw_fdoor2', 'Стеклянные двери 2', 0, dict(wall=1)),
        ('m1_iw_fwall2', 'Стена у входа 2', 0, dict(m=B, wall=1)),
        ('m1_iw_fcorner2', 'Угол у входа 2', 0, dict(m=B, wall=1, corner=1))]),
    ('inside/walls_left/1.png', 2, 2, [
        ('m1_iw_lglass', 'Окно слева', 0, dict(wall=1)),
        ('m1_iw_lglass2', 'Окно слева 2', 0, dict(wall=1)),
        ('m1_iw_lwall', 'Стена слева', 0, dict(m=B, wall=1)),
        ('m1_iw_lwall2', 'Стена слева 2', 0, dict(m=B, wall=1))]),
    ('inside/walls_left/2.png', 2, 2, [
        ('m1_iw_lglass3', 'Окно слева 3', 0, dict(wall=1)),
        ('m1_iw_lglass4', 'Окно слева 4', 0, dict(wall=1)),
        ('m1_iw_lwall3', 'Стена слева 3', 0, dict(m=B, wall=1)),
        ('m1_iw_lwall4', 'Стена слева 4', 0, dict(m=B, wall=1))]),
    ('inside/walls_left/3.png', 2, 2, [
        ('m1_iw_lglass5', 'Окно слева 5', 0, dict(wall=1)),
        ('m1_iw_lglass6', 'Окно слева 6', 0, dict(wall=1)),
        ('m1_iw_lwall5', 'Стена слева 5', 0, dict(m=B, wall=1)),
        ('m1_iw_lwall6', 'Стена слева 6', 0, dict(m=B, wall=1))]),
    # the wall kit (2026-11-10): ↘ runs along gx (falls to the right), ↗ along gy (rises to the right)
    ('inside/kit/a.png', 2, 2, [
        ('m1_wk_x_plain', 'Стена ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_x_window', 'Окно ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_x_door', 'Дверь ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_x_glass', 'Стеклянная перегородка ↘', 0, dict(kit='x'))]),
    ('inside/kit/b.png', 2, 2, [
        ('m1_wk_y_plain', 'Стена ↗', 0, dict(m=B, kit='y')),
        ('m1_wk_y_window', 'Окно ↗', 0, dict(m=B, kit='y')),
        ('m1_wk_y_door', 'Дверь ↗', 0, dict(m=B, kit='y')),
        ('m1_wk_y_glass', 'Стеклянная перегородка ↗', 0, dict(kit='y'))]),
    ('inside/kit/c.png', 2, 2, [
        ('m1_wk_xl_plain', 'Низкая стена ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_xl_ivy', 'Низкая стена с плющом ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_yl_plain', 'Низкая стена ↗', 0, dict(m=B, kit='y')),
        ('m1_wk_yl_ivy', 'Низкая стена с плющом ↗', 0, dict(m=B, kit='y'))]),
    ('inside/kit/d.png', 2, 2, [
        ('m1_wk_pillar', 'Столб', 0, dict(m=B, kit='p')),
        ('m1_wk_pillar_low', 'Низкий столб', 0, dict(m=B, kit='p')),
        ('m1_wk_x_entrance', 'Вход ↘', 0, dict(kit='x')),
        ('m1_wk_y_entrance', 'Вход ↗', 0, dict(kit='y'))]),
    # clear glass (its panes keyed out: glass= gives them a faint tint), whole, with a door, with ivy; broken (no tint)
    ('inside/kit/g1.png', 2, 2, [
        ('m1_wk_x_clear', 'Стекло ↘', 0, dict(kit='x', glass=1)),
        ('m1_wk_y_clear', 'Стекло ↗', 0, dict(kit='y', glass=1)),
        ('m1_wk_x_broken', 'Разбитое стекло ↘', 0, dict(kit='x')),
        ('m1_wk_y_broken', 'Разбитое стекло ↗', 0, dict(kit='y'))]),
    ('inside/kit/g2.png', 2, 2, [
        ('m1_wk_x_glassdoor', 'Стеклянная дверь ↘', 0, dict(kit='x', glass=1)),
        ('m1_wk_y_glassdoor', 'Стеклянная дверь ↗', 0, dict(kit='y', glass=1)),
        ('m1_wk_x_glassivy', 'Стекло с плющом ↘', 0, dict(kit='x', glass=1)),
        ('m1_wk_y_glassivy', 'Стекло с плющом ↗', 0, dict(kit='y', glass=1))]),
    # the rest of the inside after the human's concept art (2026-11-10): the server room, the survivors' post, plants
    ('inside/set/s.png', 2, 2, [
        ('m1_in_rack', 'Серверная стойка', 80, dict(m=M_)),
        ('m1_in_rackopen', 'Открытая стойка', 100, dict(m=M_)),
        ('m1_in_rackfallen', 'Упавшая стойка', 200, dict(m=M_)),
        ('m1_in_screen', 'Разбитый экран', 140, dict(m=M_))]),
    ('inside/set/o.png', 2, 2, [
        ('m1_in_fenceflag', 'Сетка с флагом NEAR', 220, dict(m=M_)),
        ('m1_in_lantern', 'Фонарь на столбе', 80, dict(lamp=1)),
        ('m1_in_candles', 'Стол со свечами', 110, dict()),
        ('m1_in_flagpole', 'Флаг на флагштоке', 90, dict(m=M_))]),
    ('inside/set/d.png', 2, 2, [
        ('m1_in_planter', 'Кашпо с растением', 110, dict(m=B)),
        ('m1_in_planterlong', 'Длинное кашпо', 250, dict(m=B)),
        ('m1_in_pot', 'Растение в горшке', 65, dict()),
        ('m1_in_shards', 'Осколки стекла', 140, dict(flat=1))]),
    # the reception as in the concept (2026-11-10): the island both ways (a wooden slat wall with the desk in front, no
    # concrete), and the slat wall alone as kit pieces
    ('inside/set/r.png', 2, 2, [
        ('m1_in_receptionisle', 'Ресепшен ↘', 470, dict(m=B, up=1.4)),
        ('m1_in_receptionisle2', 'Ресепшен ↗', 470, dict(m=B, up=1.4)),
        ('m1_wk_x_slat', 'Деревянная стена с логотипом ↘', 0, dict(kit='x')),
        ('m1_wk_y_slat', 'Деревянная стена с логотипом ↗', 0, dict(kit='y'))]),
    ('nature/1.png', 2, 2, [
        ('p_mtree4', 'Дерево', 0, dict(tree=1)),
        ('m1_nat_rock', 'Скала', 380, dict(m=B)),
        ('p_mbush5', 'Куст', 0, dict(bush=1, k=2.0)),
        ('p_mbush6', 'Папоротник', 0, dict(bush=1, k=1.6))]),
    ('nature/2.png', 2, 2, [
        ('m1_nat_rock2', 'Скала 2', 380, dict(m=B)),
        ('m1_nat_rocks', 'Камни', 220, dict(m=B)),
        ('p_mtree5', 'Дерево 2', 0, dict(tree=1)),
        ('p_mbush7', 'Куст 2', 0, dict(bush=1, k=1.9))]),
    ('nature/3.png', 2, 2, [
        ('p_mtree6', 'Дерево 3', 0, dict(tree=1)),
        ('p_mtree7', 'Дерево 4', 0, dict(tree=1)),
        ('p_mbush8', 'Куст 3', 0, dict(bush=1, k=1.9)),
        ('m1_nat_rock3', 'Скала 3', 300, dict(m=B))]),
]


def parts(path, cols, rows):
    """the sheet keyed, its pieces grouped by the grid cell their middle falls in"""
    rgba = key(path)
    H, W = rgba.shape[:2]
    lab, n = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0.25, iterations=2))
    idx = range(1, n + 1)
    coms = ndimage.center_of_mass(np.ones_like(lab), lab, idx)
    sizes = ndimage.sum(np.ones_like(lab), lab, idx)
    cells = []
    for r in range(rows):
        for c in range(cols):
            ids = [i + 1 for i, (cy, cx) in enumerate(coms)
                   if sizes[i] >= 300 and int(cx * cols / W) == c and int(cy * rows / H) == r]
            part = rgba.copy()
            part[..., 3] *= np.isin(lab, ids)
            cells.append(part)
    return cells


def lamp_geo(im):
    """a lamp's pole foot (bx) and its glowing head (hx, hy) as fractions of the picture"""
    a = np.asarray(im).astype(np.float32) / 255
    al = a[..., 3] > 0.4
    ys, xs = np.where(al)
    bx = xs[ys >= ys.max() - 3].mean() / im.width
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    top = np.arange(im.height)[:, None] < im.height * 0.5  # (the head is up top; the pole's lit side is not it)
    hot = al & top & (r > 0.85) & (g > 0.6) & (b < 0.75)
    if hot.sum() < 6:
        hot = al & top & (r + g > 1.6)
    hy_, hx_ = np.where(hot)
    return round(bx, 3), round(hx_.mean() / im.width, 3), round(1 - hy_.mean() / im.height, 3)


def glassy(im, tint=(0.72, 0.84, 0.9), share=0.17):
    """glass=: the panes (keyed out, shut inside the frame) a faint cool tint, so the glass shows and the room shows
    through it"""
    a = np.asarray(im).astype(np.float32) / 255
    al = a[..., 3]
    pane = ndimage.binary_fill_holes(al > 0.5) & (al < share)
    na = np.where(pane, share, al)
    c = a[..., :3] * al[..., None] + np.array(tint, np.float32) * (na - al)[..., None]
    c = c / np.maximum(na, 1e-3)[..., None]
    out = np.dstack([np.clip(c, 0, 1), na])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')


def grow(im, f):
    """up=: a drawing too small for its size in the game, enlarged (Lanczos on premultiplied colour, so the transparent
    border's colour does not bleed in) and sharpened a little"""
    big = im.convert('RGBa').resize((round(im.width * f), round(im.height * f)), Image.LANCZOS).convert('RGBA')
    rgb = big.convert('RGB').filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    rgb.putalpha(big.getchannel('A'))
    return rgb


props, names, lamps, trees, bushes = [], {}, {}, [], {}
for sheet, cols, rows, items in SHEETS:
    path = os.path.join(SRC, sheet)
    cells = parts(path, cols, rows)
    cut = []
    for part, (name, ru, w, o) in zip(cells, items):
        p, box = trim(part)
        cut.append((to_img(p), name, ru, w, o))
    # the inside wall pieces: one scale for the sheet, from its straight pieces' height (box height less the 2:1 drop)
    st = [WALL_H / max(10, im.height - 0.5 * im.width) for im, n, ru, w, o in cut if o.get('wall') and not o.get('corner')]
    ws = float(np.median(st)) if st else None
    # the wall kit: world px per picture px from the sheet's straight pieces (their run: KIT_L + KIT_T across)
    ks = [(KIT_L + KIT_T) / im.width for im, n, ru, w, o in cut if o.get('kit') in ('x', 'y')]
    kscale = float(np.median(ks)) if ks else None
    for im, name, ru, w, o in cut:
        names[name] = ru
        if o.get('tree') or o.get('bush'):
            pw = 370 if o.get('tree') else 95 * o['k']
            im = shrink(im, max(im.size) * min(1, pw * 1.4 / im.width))
            im.save(os.path.join(OUT, name + '.png'), optimize=True)
            A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
            (trees.append(name) if o.get('tree') else bushes.__setitem__(name, o['k']))
            print(f'{name:22s} {im.size} {"tree" if o.get("tree") else "bush"}')
            continue
        if o.get('wall'):
            w = round(im.width * ws)
        if o.get('kit'):
            w = KIT_L + KIT_T if o['kit'] in ('x', 'y') else round(im.width * kscale)
        im = shrink(im, max(im.size) * min(1, w * 1.45 / im.width))
        if o.get('up') and im.width < w * 1.36:
            im = grow(im, min(w * 1.36 / im.width, o['up']))
        if o.get('glass'):
            im = glassy(im)
        im.save(os.path.join(OUT, name + '.png'), optimize=True)
        A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
        al = np.asarray(im)[..., 3] > 100
        ys, xs = np.where(al)
        low = xs[ys >= ys.max() - max(2, im.height * 0.012)].mean()
        k = o.get('front', (low + 0.5) / im.width)  # front: the front corner's x when something sticks out lower (planters)
        fw, fh = (12, 12) if o.get('lamp') or o.get('flat') else (round(w * k * 0.9), round(w * (1 - k) * 0.9))
        if o.get('kit'):
            fw, fh = {'x': (KIT_L, KIT_T), 'y': (KIT_T, KIT_L), 'p': (KIT_P, KIT_P)}[o['kit']]
        extra = ''.join([', kit: 1' if o.get('kit') else '', ', bld: 1' if o.get('bld') else '', ', lamp: 1' if o.get('lamp') else '',
                         ', nocol: 1' if o.get('nocol') else '', ', flat: 1' if o.get('flat') else '',
                         f", mat: '{o['m']}'" if o.get('m') else ''])
        props.append(f'    {name}: {{ w: {w}, fw: {max(12, fw)}, fh: {max(12, fh)}{extra} }},')
        if o.get('lamp'):
            lamps[name] = lamp_geo(im)
        print(f'{name:22s} {im.size} w {w} low {k:.2f}')

open(AS, 'w', encoding='utf-8', newline='').write('window.ASSETS = ' + json.dumps(A, separators=(',', ':')) + ';\n')


def block(path, start, end, lines):
    p = os.path.join(ROOT, path)
    s = open(p, encoding='utf-8').read()
    i = s.index(start)
    j = s.index(end, i)
    i = s.index('\n', i) + 1
    j = s.rindex('\n', 0, j) + 1
    s = s[:i] + '\n'.join(lines) + '\n' + s[j:]
    open(p, 'w', encoding='utf-8', newline='').write(s)


block('live/sim.js', '// m1art props {', '// m1art props }', props)
block('live/scene.js', '// m1art lamps {', '// m1art lamps }',
      [f'    {n}: {{ bx: {g[0]}, hx: {g[1]}, hy: {g[2]} }},' for n, g in lamps.items()])
block('live/editor.js', '// m1art names {', '// m1art names }', [f"    {n}: '{ru}'," for n, ru in names.items()])
block('live/editor.js', '// m1art trees {', '// m1art trees }', [f"    '{n}'," for n in trees])
block('live/editor.js', '// m1art bushes {', '// m1art bushes }', [f'    {n}: {k},' for n, k in bushes.items()])
print(len(props), 'props,', len(trees), 'trees,', len(bushes), 'bushes,', len(lamps), 'lamps')
