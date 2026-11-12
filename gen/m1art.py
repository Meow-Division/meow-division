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
# the kit's footprints by kind: x / y a piece along gx / gy, xh / yh a half one, p a pillar, r a server rack (a pillar's
# square); every one but the pillar is drawn exactly its box (its width: the footprint's two sides)
KIT = {'x': (KIT_L, KIT_T), 'y': (KIT_T, KIT_L), 'xh': (KIT_L // 2, KIT_T), 'yh': (KIT_T, KIT_L // 2),
       'p': (KIT_P, KIT_P), 'r': (KIT_P, KIT_P)}
SPLIT_DZ = 45  # (a set's front layer drawn this far, in screen px of sort, after its place: split= below. Small, inside its
# own footprint's depth: a bigger one (it was 200) put it after the wall in front of it, so a hero between the two was drawn
# under the desk)
# a doorway through a kit piece (gap=: its span along the run, shares of the piece's length): DOOR_W wide in its middle
# (gap='x' / 'xh'), or anywhere along it (gap=(u0, u1): the base's glass wall, its doorway in one half)
DOOR_W = 90
GAP = {'x': 0.5 - DOOR_W / 2 / KIT_L, 'xh': 0.5 - DOOR_W / 2 / (KIT_L // 2)}

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
    # NEAR Base: Nova's radio post and Walt's trade corner (2026-11-12, after the human's concept art/office/refs/
    # ref_npc_posts.png, the cats left out: their 3D models sit in the chairs, between the set and its front layer).
    # Drawn on gen/postguide.py's boxes (the first try came out off the grid, its chairs twice a seated cat): w the
    # guide's mat across (250 + 190, 260 + 200), the office furniture's scale (the cats at the base are drawn 1.25 × bigger
    # than these chairs were made for, live/scene.js BASE_K: grown-ups at their desks), iso= squares the mat to the grid, the
    # footprint is the mat
    ('inside/set/novapost.png', 1, 1, [
        # (split: under the desk's back edge where she sits, up round the laptop, the radio and the lamp all in front)
        ('m1_in_novapost', 'Пост Новы', 440, dict(m=M_, despill=1, iso=1, split=[
            (0, .279), (.364, .279), (.376, .515), (.520, .607), (.544, .599), (.647, .539), (1, .758)]))]),
    ('inside/set/waltshop.png', 1, 1, [
        # (split: under the counter's back edge where he sits, the coin jar and the clipboard in front of him)
        ('m1_in_waltshop', 'Лавка Уолта', 460, dict(m=B, despill=1, iso=1, split=[
            (0, .427), (.396, .427), (.403, .595), (.453, .595), (.460, .670), (.600, .719), (.655, .719), (.659, .570),
            (1, .570)]))]),
    # NEAR Base's entrance and parking (2026-11-12, the human's reference art/office/refs/ref_entrance.png): a glass door
    # leaf swung open (two stand out of the open entrance), a parking wheel stop, a curb piece, a strip of wild flowers
    ('inside/set/pk.png', 2, 2, [
        ('m1_pk_door', 'Распахнутая стеклянная створка', 70, dict(glass=1, despill=1)),
        ('m1_pk_stop', 'Отбойник парковки', 100, dict(m=B, nocol=1)),
        ('m1_pk_curb', 'Бордюр', 260, dict(m=B, nocol=1)),
        ('m1_pk_flowers', 'Цветы и трава', 270, dict(nocol=1))]),
    # the reception as in the concept (2026-11-10): the island both ways (a wooden slat wall with the desk in front, no
    # concrete), and the slat wall alone as kit pieces
    ('inside/set/r.png', 2, 2, [
        ('m1_in_receptionisle', 'Ресепшен ↘', 470, dict(m=B, up=1.4)),
        ('m1_in_receptionisle2', 'Ресепшен ↗', 470, dict(m=B, up=1.4)),
        ('m1_wk_x_slat', 'Деревянная стена с логотипом ↘', 0, dict(kit='x')),
        ('m1_wk_y_slat', 'Деревянная стена с логотипом ↗', 0, dict(kit='y'))]),
    # (2026-11-10) server racks to set in a row: their fronts toward the lower left (↘ rows) or the lower right (↗ rows)
    ('inside/kit/srv.png', 2, 2, [
        ('m1_wk_rack_x', 'Сервер ↘', 0, dict(m=M_, kit='r')),
        ('m1_wk_rack_y', 'Сервер ↗', 0, dict(m=M_, kit='r')),
        ('m1_wk_rackopen_x', 'Открытый сервер ↘', 0, dict(m=M_, kit='r')),
        ('m1_wk_rackopen_y', 'Открытый сервер ↗', 0, dict(m=M_, kit='r'))]),
    # half glass: a pane, and a glass door standing open (its doorway lets through)
    ('inside/kit/gh.png', 2, 2, [
        ('m1_wk_xh_clear', 'Половина стекла ↘', 0, dict(kit='xh', glass=1)),
        ('m1_wk_xh_glassopen', 'Половина: открытая стеклянная дверь ↘', 0, dict(kit='xh', glass=1, gap='xh')),
        ('m1_wk_yh_clear', 'Половина стекла ↗', 0, dict(kit='yh', glass=1)),
        ('m1_wk_yh_glassopen', 'Половина: открытая стеклянная дверь ↗', 0, dict(kit='yh', glass=1, gap='xh'))]),
    # concrete: a wall with its door open, half walls; half walls with a closed and an open door
    ('inside/kit/cw1.png', 2, 2, [
        ('m1_wk_x_opendoor', 'Открытая дверь ↘', 0, dict(m=B, kit='x', gap='x')),
        ('m1_wk_y_opendoor', 'Открытая дверь ↗', 0, dict(m=B, kit='y', gap='x')),
        ('m1_wk_xh_plain', 'Половина стены ↘', 0, dict(m=B, kit='xh')),
        ('m1_wk_yh_plain', 'Половина стены ↗', 0, dict(m=B, kit='yh'))]),
    ('inside/kit/cw2.png', 2, 2, [
        ('m1_wk_xh_door', 'Половина с дверью ↘', 0, dict(m=B, kit='xh')),
        ('m1_wk_yh_door', 'Половина с дверью ↗', 0, dict(m=B, kit='yh')),
        ('m1_wk_xh_opendoor', 'Половина с открытой дверью ↘', 0, dict(m=B, kit='xh', gap='xh')),
        ('m1_wk_yh_opendoor', 'Половина с открытой дверью ↗', 0, dict(m=B, kit='yh', gap='xh'))]),
    # (2026-11-11) tall windows as in the human's reference: three panes and a transom, plain and with ivy; the sun
    # through them lies on the floor (live/ground.js sunny)
    ('inside/kit/w.png', 2, 2, [
        ('m1_wk_x_tallwin', 'Высокое окно ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_y_tallwin', 'Высокое окно ↗', 0, dict(m=B, kit='y')),
        ('m1_wk_x_tallwinivy', 'Высокое окно с плющом ↘', 0, dict(m=B, kit='x')),
        ('m1_wk_y_tallwinivy', 'Высокое окно с плющом ↗', 0, dict(m=B, kit='y'))]),
    # NEAR Base (2026-11-12, the human's reference art/office/refs/ref_entrance.png): a glass wall with its doorway open
    # in one half (the generator's room), the main entrance open (its two leaves: m1_pk_door props out on the parking)
    ('inside/kit/eo.png', 2, 2, [
        ('m1_wk_x_glassopen', 'Стеклянная стена, дверь открыта ↘', 0, dict(kit='x', glass=1, despill=1, gap=(0.56, 0.93))),
        ('m1_wk_y_glassopen', 'Стеклянная стена, дверь открыта ↗', 0, dict(kit='y', glass=1, despill=1, gap=(0.56, 0.93))),
        ('m1_wk_x_entranceopen', 'Открытый вход ↘', 0, dict(m=B, kit='x', glass=1, despill=1, gap=(0.15, 0.89))),
        ('m1_wk_y_entranceopen', 'Открытый вход ↗', 0, dict(m=B, kit='y', glass=1, despill=1, gap=(0.15, 0.89)))]),
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


def isofix(im, log=''):
    """iso=: a prop on a mat whose floor edges came out a few degrees off the 2:1 grid (Nova's post, Walt's corner): its
    mat's left, front and right corners found on the alpha, then a vertical shear y += c x (verticals stay vertical) and a
    vertical scale that set both its floor edges to exactly 2:1"""
    a = np.asarray(im)[..., 3] > 128
    ys, xs = np.where(a)
    low = ys > ys.max() - 0.4 * (ys.max() - ys.min())  # (the mat's corners: low down, not a sign sticking out higher up)
    F = (xs[ys >= ys.max() - 2].mean(), ys.max())
    ys, xs = ys[low], xs[low]
    L = (xs.min(), ys[xs <= xs.min() + 2].mean())
    R = (xs.max(), ys[xs >= xs.max() - 2].mean())
    s1 = (F[1] - L[1]) / (F[0] - L[0])
    s2 = (R[1] - F[1]) / (R[0] - F[0])
    c = -(s1 + s2) / 2
    k = 0.5 / (s1 + c)
    W, H = im.size
    ys_ = [k * (y + c * x) for x in (0, W) for y in (0, H)]
    off = -min(ys_)
    out = im.convert('RGBa').transform((W, round(max(ys_) + off) + 1), Image.AFFINE, (1, 0, 0, -c, 1 / k, -off / k),
                                       resample=Image.BICUBIC).convert('RGBA')
    print(f'  {log} iso: edges {s1:.3f} / {s2:.3f} -> shear {c:.3f}, scale {k:.3f}')
    return to_img(trim(np.asarray(out).astype(np.float32) / 255)[0])


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


def despill(im):
    """despill=: the magenta the key leaves in pale streaks on glass (reflections drawn half over the background)
    taken out of them: red and blue no higher than green, so pink turns grey-white"""
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    over = np.clip(np.minimum(r, b) - g, 0, 255)
    a[..., 0] = r - over
    a[..., 2] = b - over
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


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
        im = to_img(p)
        if o.get('iso'):
            im = isofix(im, name)
        cut.append((im, name, ru, w, o))
    # the inside wall pieces: one scale for the sheet, from its straight pieces' height (box height less the 2:1 drop)
    st = [WALL_H / max(10, im.height - 0.5 * im.width) for im, n, ru, w, o in cut if o.get('wall') and not o.get('corner')]
    ws = float(np.median(st)) if st else None
    # the wall kit: world px per picture px from the sheet's straight pieces (their run: KIT_L + KIT_T across)
    ks = [sum(KIT[o['kit']]) / im.width for im, n, ru, w, o in cut if o.get('kit') in KIT and o['kit'] != 'p']
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
            w = sum(KIT[o['kit']]) if o['kit'] != 'p' else round(im.width * kscale)
        im = shrink(im, max(im.size) * min(1, w * 1.45 / im.width))
        if o.get('up') and im.width < w * 1.36:
            im = grow(im, min(w * 1.36 / im.width, o['up']))
        if o.get('glass'):
            im = glassy(despill(im) if o.get('despill') else im)
        elif o.get('despill'):
            im = despill(im)
        im.save(os.path.join(OUT, name + '.png'), optimize=True)
        A[name] = {'w': im.width, 'h': im.height, 'crop': [0, 0, im.width, im.height], 'scale': 1}
        al = np.asarray(im)[..., 3] > 100
        ys, xs = np.where(al)
        low = xs[ys >= ys.max() - max(2, im.height * 0.012)].mean()
        k = o.get('front', (low + 0.5) / im.width)  # front: the front corner's x when something sticks out lower (planters)
        sh = 1 if o.get('iso') else 0.9  # (a set on its mat: the footprint is the mat, the hero walks up to its edge)
        fw, fh = (12, 12) if o.get('lamp') or o.get('flat') else (round(w * k * sh), round(w * (1 - k) * sh))
        if o.get('kit'):
            fw, fh = KIT[o['kit']]
        # (gap: a kit kind's middle doorway, or (u0, u1) one off the middle: its own span along the run)
        g = o.get('gap')
        g = (GAP[g], 1 - GAP[g]) if isinstance(g, str) else g
        extra = ''.join([', kit: 1' if o.get('kit') else '', f', gap: [{g[0]:.3f}, {g[1]:.3f}]' if g else '', ', bld: 1' if o.get('bld') else '', ', lamp: 1' if o.get('lamp') else '',
                         ', nocol: 1' if o.get('nocol') else '', ', flat: 1' if o.get('flat') else '',
                         f", mat: '{o['m']}'" if o.get('m') else ''])
        # split=(x0, y0, x1, y1): a set someone sits in (Walt's counter, Nova's desk), its picture cut along that line
        # (shares of the picture, left to right): the whole set drawn where it stands, the one sitting in it a little after
        # (live/scene.js NPC_SEAT_DZ), the part under the line, its desk or counter, again after them (<name>_front: dz
        # +SPLIT_DZ, stops nothing, no shadow)
        sp = o.get('split')
        if sp:
            fr = np.asarray(im).copy()
            yy, xx = np.mgrid[0:im.height, 0:im.width]
            if isinstance(sp[0], tuple):  # (a line through several points, each (x, y) shares, left to right)
                line = np.interp(xx, [q[0] * im.width for q in sp], [q[1] * im.height for q in sp])
            else:
                x0, y0, x1, y1 = sp[0] * im.width, sp[1] * im.height, sp[2] * im.width, sp[3] * im.height
                line = y0 + (xx - x0) * (y1 - y0) / (x1 - x0)
            fr[..., 3][yy < line] = 0
            Image.fromarray(fr, 'RGBA').save(os.path.join(OUT, name + '_front.png'), optimize=True)
            A[name + '_front'] = dict(A[name])
            props.append(f'    {name}_front: {{ w: {w}, fw: {max(12, fw)}, fh: {max(12, fh)}, nocol: 1, dz: {SPLIT_DZ} }},')
            names[name + '_front'] = ru + ' (передняя часть)'
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
