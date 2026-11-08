# gen/blender/herocat.py — the hero cat (art/hero3d/cat2/cat.glb: a Meshy model in T-pose, its auto-rig with no tail bones and the
# tail skinned by mistake to a finger and a thigh) made into the game's character, every pose and motion built here:
#   python gen/blender/bl.py gen/blender/herocat.py sheet [clip ...]   clips, 4 moments each, from the front, ¾ and the side (art/hero3d/cat2/out)
#   python gen/blender/bl.py gen/blender/herocat.py game     → live/assets/c_cat.{bin,jpg,json}, live/bosses3d.js
# The rig: a tail chain added along the tail's centre line (its vertices weighted to it, blended into the hips at the root); IK on
# both arms and legs, the paws turned along the gun, the fingers closed round it. Two holds: one-handed (the pistol) and two-handed
# (every other gun); each aimed (crouched a little, leaning in, the gun at the eye line) or at ease (the rifle carried across the
# body, the pistol hanging by the hip).
# Clips (the game's names, see ANIMS): '<legs>_<upper><hold>' — legs idle (standing, breathing, the tail swaying) or a step cycle
# f / b / l / r (forward, back, sideways to the cat's left or right: the game blends the two nearest the way it moves), upper a
# (aiming) or l (at ease), hold 1 or 2 — and die (falling backward). Every frame also carries the gun's frame ("g": origin at the
# grip, z along the barrel, y up), in the game's space, so the game puts the gun where the paws hold it.
# Space: as gen/blender/fbxboss.py — normalised to 1 unit tall, feet on y = 0, facing +z, x right, y up.
import bpy, sys, os, json, math, struct
import numpy as np
from mathutils import Matrix, Vector, Euler

ROOT = os.environ.get('ZH_ROOT') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def P(*a): return os.path.join(ROOT, *a)
MODE = (sys.argv[sys.argv.index('--') + 1:] + ['sheet'])[0]
# MAXTRI: the mesh kept fine enough for the lobby, where the cat stands half the screen tall (the source has 103 k); ATLAS: its colour
# at 2048 (4096 would take some 85 MB of video memory for one character)
SRC, ID, MAXTRI, ATLAS, FPS = P('art', 'hero3d', 'cat2', 'cat.glb'), 'cat', 60000, 2048, 20

# the auto-rig's bones (Blender: facing −Y, +X the cat's left)
HIPS, PELVIS, CHEST, NECK, HEAD = 'Bone_000', 'Bone_001', 'Bone_002', 'Bone_018', 'Bone_017'
SPINE = ['Bone_005', 'Bone_004', 'Bone_003']
R_ARM = dict(clav='Bone_028', up='Bone_027', fore='Bone_026', hand='Bone_025', palm='Bone_024', fingers=['Bone_044', 'Bone_048', 'Bone_052'])
L_ARM = dict(clav='Bone_023', up='Bone_022', fore='Bone_021', hand='Bone_020', palm='Bone_019', fingers=['Bone_032', 'Bone_036', 'Bone_040'])
R_LEG = dict(thigh='Bone_010', shin='Bone_009', foot='Bone_008')
L_LEG = dict(thigh='Bone_015', shin='Bone_014', foot='Bone_013')
TAIL_BAD = {'Bone_045', 'Bone_010'}                                   # what the tail was skinned to (a right finger, the right thigh)
TAIL_FINGER = 'Bone_045'

def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and not o.vertex_groups: bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE'); g = next(o for o in bpy.data.objects if o.type == 'MESH')
    return arm, g

# ------------------------------------------------------------------------------------------------ the tail: bones and weights
def add_tail(arm, g):
    me = g.data; mw = np.array(g.matrix_world)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    names = {vg.index: vg.name for vg in g.vertex_groups}
    # the tail: what the finger bone holds below the paws (z < 0.85) and out from the body (x < −0.1) — the thigh's own vertices are
    # the right leg's, rightly
    tail = [v.index for v in me.vertices if any(names[x.group] == TAIL_FINGER and x.weight > 0.05 for x in v.groups) and co[v.index, 2] < 0.85 and co[v.index, 0] < -0.1]
    T = co[tail]
    # its centre line: the mean of thin slices along x, from the root behind the hips to the tip
    xs = np.linspace(T[:, 0].max(), T[:, 0].min(), 7); pts = []
    for a, b in zip(xs[:-1], xs[1:]):
        s = T[(T[:, 0] <= a) & (T[:, 0] >= b)]
        if len(s): pts.append(s.mean(0))
    pts = [np.array([-0.1, T[:, 1].mean(), pts[0][2]])] + pts + [T[T[:, 0].argmin()]]
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT'); eb = arm.data.edit_bones
    aw = arm.matrix_world.inverted(); parent = eb[HIPS]; chain = []
    for i in range(len(pts) - 1):
        b = eb.new(f'Tail_{i}'); b.head = aw @ Vector(pts[i]); b.tail = aw @ Vector(pts[i + 1]); b.parent = parent; b.use_connect = i > 0; b.roll = 0
        parent = b; chain.append(b.name)
    bpy.ops.object.mode_set(mode='OBJECT')
    # weights: along the line (the projection onto the polyline), shared by the two nearest bones' middles; the first stretch blends
    # into the hips; the bad groups taken off these vertices
    seg = [(np.array(pts[i]), np.array(pts[i + 1])) for i in range(len(pts) - 1)]
    groups = {n: g.vertex_groups.get(n) or g.vertex_groups.new(name=n) for n in chain + [HIPS]}
    for vi in tail:
        p = co[vi]; best = None
        for k, (a, b) in enumerate(seg):
            d = b - a; t = np.clip(np.dot(p - a, d) / np.dot(d, d), 0, 1); dist = np.linalg.norm(a + d * t - p)
            if best is None or dist < best[0]: best = (dist, k, t)
        _, k, t = best; u = k + t                                                 # bones' middles at k + 0.5
        for n in TAIL_BAD:
            if n in g.vertex_groups: g.vertex_groups[n].remove([vi])
        w = {}
        if u < 0.5: w[chain[0]] = 0.35 + 0.65 * u / 0.5; w[HIPS] = 1 - w[chain[0]]
        else:
            j = min(int(u - 0.5), len(chain) - 1); f = u - 0.5 - j
            w[chain[j]] = 1 - f
            if j + 1 < len(chain): w[chain[j + 1]] = f
            else: w[chain[j]] = 1
        for n, x in w.items():
            if x > 1e-3: groups[n].add([vi], x, 'REPLACE')
    print(f'tail: {len(tail)} vertices on {len(chain)} bones from {np.round(pts[0], 3)} to {np.round(pts[-1], 3)}')
    return chain

# ------------------------------------------------------------------------------------------------ the rig: IK, aims, targets
def empty(name, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(o); o.location = loc; o.empty_display_size = 0.05; return o

def rig(arm):
    pb = arm.pose.bones; E = {}
    for side, A in (('R', R_ARM), ('L', L_ARM)):
        E['w' + side] = empty('wrist' + side); E['e' + side] = empty('elbow' + side); E['h' + side] = empty('aim' + side)
        c = pb[A['fore']].constraints.new('IK'); c.target = E['w' + side]; c.pole_target = E['e' + side]; c.chain_count = 2; c.pole_angle = math.radians(-90)
        d = pb[A['hand']].constraints.new('DAMPED_TRACK'); d.target = E['h' + side]; d.track_axis = 'TRACK_Y'
    for side, Lg in (('R', R_LEG), ('L', L_LEG)):
        E['a' + side] = empty('ankle' + side); E['k' + side] = empty('knee' + side); E['t' + side] = empty('toe' + side)
        c = pb[Lg['shin']].constraints.new('IK'); c.target = E['a' + side]; c.pole_target = E['k' + side]; c.chain_count = 2; c.pole_angle = math.radians(-90)
        d = pb[Lg['foot']].constraints.new('DAMPED_TRACK'); d.target = E['t' + side]; d.track_axis = 'TRACK_Y'
    E['gun'] = empty('gun')
    for b in pb: b.rotation_mode = 'XYZ'
    return E

REST = {}
def rest_points(arm):
    """bone heads / tails at rest, armature space (Blender units, the GLB's 1.7 tall)"""
    for b in arm.data.bones: REST[b.name] = (np.array(b.head_local), np.array(b.tail_local))

# ------------------------------------------------------------------------------------------------ poses
# Armature space: −Y forward, +Z up, +X the cat's left. A pose = the legs (standing, or a step cycle in one of four directions
# relative to the body) × the upper body (aiming, or at ease) × the hold (1: the pistol in the right paw, 2: every other gun in both).
FWD, UP, LEFT = np.array([0, -1.0, 0]), np.array([0, 0, 1.0]), np.array([1.0, 0, 0])
def nrm(v): v = np.asarray(v, float); return v / np.linalg.norm(v)
# the upper bodies. grip: where the right paw holds the gun; bar: the barrel's direction; fore: the left paw (on the gun, or by the
# side); crouch: the hips lowered (knees bent); lean: the chest tipped forward (deg). Aiming brings the gun to the eye line, the
# barrel level; at ease the rifle is carried across the body — the right paw at the right hip, the left on the fore-end on the
# left, the muzzle up and to the left (each arm on its own side) — and the pistol hangs in the right paw, the muzzle down and forward
UPPER = {
    ('a', 1): dict(grip=[-0.10, -0.45, 1.00], bar=[0, -1, 0], fore=None, crouch=0.05, lean=6),
    ('a', 2): dict(grip=[-0.08, -0.24, 0.96], bar=[0, -1, 0], fore=[-0.055, -0.43, 0.955], crouch=0.06, lean=9),
    ('l', 1): dict(grip=[-0.26, -0.11, 0.60], bar=[0, -0.75, -0.66], fore=None, crouch=0.0, lean=0),
    ('l', 2): dict(grip=[-0.17, -0.20, 0.66], bar=[0.62, -0.55, 0.56], fore=[0.06, -0.33, 0.80], crouch=0.0, lean=2),
}
# the step cycles: direction, STRIDE (Blender units a planted foot travels back under the body), the swing's lift. Sideways the
# steps are shorter and the feet set wider (they never cross)
# The legs are short (hip 0.64 over the ankle, thigh and shin 0.51 together: straight they reach a hand's breadth): so moving the
# hips drop (STEP_DROP), the knees work, the steps are only as long as the legs reach, and the gait is a run — each foot planted
# STANCE of the cycle, a short flight between the steps — so it covers the ground the hero does without the paws sliding
DIRS = {'f': (FWD, 0.50, 0.10), 'b': (-FWD, 0.42, 0.08), 'l': (LEFT, 0.38, 0.07), 'r': (-LEFT, 0.38, 0.07)}
STANCE, STEP_DROP = 0.38, 0.08
def legs(E, d=None, S=0.0, lift=0.11, ph=0.0, aim=False):
    side_w = 0.06 if d is not None and abs(d[0]) > 0.5 else (0.02 if aim else 0.0)
    for side, Lg, sgn in (('R', R_LEG, -1), ('L', L_LEG, 1)):
        h, a = REST[Lg['shin']]; up = 0.0; off = 0.0
        if d is not None:
            c = (ph + (0 if side == 'R' else 0.5)) % 1.0
            if c < STANCE: off = S / 2 - S * c / STANCE                                   # planted: sliding back as the body goes on
            else: e = (c - STANCE) / (1 - STANCE); ee = e * e * (3 - 2 * e); off = -S / 2 + S * ee; up = math.sin(math.pi * e) * lift
        stag = (0.05 if side == 'R' else -0.03) if (aim and d is None) else 0.0             # a shooter's stance: the right foot a little back
        ank = a + (d if d is not None else FWD) * off + np.array([sgn * side_w, stag, up])
        E['a' + side].location = ank; E['k' + side].location = h + np.array([sgn * 0.03, -0.7, 0.05])
        E['t' + side].location = ank + FWD * 0.16 + np.array([sgn * 0.02, 0, -0.07 + up * 0.5])
def pose(arm, E, chain, hold, up='l', d=None, ph=0.0, t=0.0, die=None):
    pb = arm.pose.bones
    for b in pb: b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
    U = UPPER[(up, hold)]; br = math.sin(t * 2 * math.pi / 2.4)                     # breath: a 2.4 s cycle
    moving = d is not None
    dv, S, lift = DIRS[d] if moving else (None, 0.0, 0.0)
    legs(E, dv, S, lift, ph, up == 'a')
    bob = -0.03 * math.cos(4 * math.pi * (ph - STANCE / 2)) if moving else 0.0         # lowest mid-stance, highest in the flight
    sway = 0.02 * math.sin(ph * 2 * math.pi) if moving else 0.0                       # over the planted foot
    hip = pb[HIPS]; hip.matrix = Matrix.Translation((sway, 0, bob - (max(U['crouch'], STEP_DROP) if moving else U['crouch']) + 0.004 * br)) @ hip.bone.matrix_local
    bpy.context.view_layer.update()
    lean_mv = 4 if d == 'f' else (-3 if d == 'b' else 0)
    twist = 5 * math.sin(ph * 2 * math.pi) if (d in ('f', 'b') and up == 'l') else 0      # at ease the shoulders turn against the hips
    pb[CHEST].rotation_euler = (math.radians(U['lean'] + lean_mv + 1.2 * br), 0, math.radians(twist))
    pb[HEAD].rotation_euler = (math.radians(-U['lean'] * 0.7 - 2 + 1.0 * br), 0, 0)  # the head kept level
    # the tail: a slow wave from the root to the tip, wider toward the tip; moving: swinging in step
    tp = (ph * 2 * math.pi) if moving else t * 2 * math.pi / 1.2
    for i, n in enumerate(chain):
        k = (i + 1) / len(chain); amp = (8 + 12 * k) if moving else (10 + 14 * k)
        pb[n].rotation_euler = (math.radians(4 * math.sin(tp - i * 0.7)), 0, math.radians(amp * math.sin(tp - i * 0.8)))
    # the gun: rides the chest (the bob, the breath); the paws on it
    lift_v = np.array([sway * 0.6, 0, bob * 0.8 + 0.004 * br])
    grip = np.array(U['grip'], float) + lift_v; z = nrm(U['bar']); y = nrm(UP - z * np.dot(UP, z)); x = np.cross(y, z)
    gm = Matrix.Identity(4)
    for r in range(3): gm[r][0], gm[r][1], gm[r][2], gm[r][3] = x[r], y[r], z[r], grip[r]
    E['gun'].matrix_world = arm.matrix_world @ gm
    sh = {s: REST[A['up']][0] for s, A in (('R', R_ARM), ('L', L_ARM))}
    E['wR'].location = grip - z * 0.03 - y * 0.02; E['hR'].location = grip + z * 0.3 + y * 0.05
    E['eR'].location = sh['R'] + (np.array([-0.3, 0.25, -0.3]) if up == 'a' else np.array([-0.35, 0.1, -0.2]))
    if U['fore'] is not None:
        fore = np.array(U['fore'], float) + lift_v; E['wL'].location = fore - y * 0.025; E['hL'].location = fore + z * 0.3
        E['eL'].location = sh['L'] + (np.array([0.2, 0.15, -0.5]) if up == 'a' else np.array([0.35, 0.1, -0.25]))
    else:                                                                           # the free paw: down by the side, swinging a little in step
        sw = 0.06 * math.sin(ph * 2 * math.pi) if moving else 0.0
        wl = sh['L'] + np.array([0.06, -0.04 - sw, -0.37]) + lift_v
        E['wL'].location = wl; E['hL'].location = wl + np.array([0.01, -0.02, -0.2]); E['eL'].location = sh['L'] + np.array([0.3, 0.3, -0.1])
    # fingers closed round the gun (the free paw half closed)
    for A, curl in ((R_ARM, 1.0), (L_ARM, 1.0 if U['fore'] is not None else 0.35)):
        for f0 in A['fingers']:
            b = pb[f0]
            for depth in range(4):
                b.rotation_euler = (math.radians(-55 * curl), 0, 0)
                if not b.children: break
                b = b.children[0]
    if die is not None:                                                       # thrown back off the feet, about them, a bounce as it lands
        u = min(1, die / 0.55); e = u * u; land = max(0, die - 0.55)
        ang = math.radians(-88 * e + 6 * math.sin(min(1, land / 0.25) * math.pi) * (1 - min(1, land / 0.25)))
        E['wR'].location = sh['R'] + np.array([-0.35, 0.05, 0.1]); E['wL'].location = sh['L'] + np.array([0.35, 0.05, 0.1])
        E['hR'].location = sh['R'] + np.array([-0.8, 0.0, 0.2]); E['hL'].location = sh['L'] + np.array([0.8, 0.0, 0.2])
        piv = Vector((0, 0.05, 0.0)); R = Matrix.Translation(piv) @ Matrix.Rotation(ang, 4, 'X') @ Matrix.Translation(-piv)
        hip.matrix = R @ Matrix.Translation((0, 0, -0.05 * e)) @ hip.bone.matrix_local
        for s in ('R', 'L'):                                                          # the legs ride the fall: their targets turned with it
            for k in ('a', 'k', 't'): E[k + s].location = R @ Vector(E[k + s].location)
    bpy.context.view_layer.update()

# the clips: '<legs>_<upper><hold>': legs idle / f / b / l / r (standing; stepping forward, back, to the cat's left, to its right),
# upper a (aiming) / l (at ease); and die. A step cycle is sampled over one cycle (the game drives its phase by the ground covered:
# meta gait, model units per cycle); standing over the breath's 2.4 s
IDLE_S, STEP_N = 2.4, 12
ANIMS = {}
for _up in 'al':
    for _hold in (1, 2):
        ANIMS[f'idle_{_up}{_hold}'] = (_hold, _up, None, IDLE_S, True, 12)
        for _d in DIRS: ANIMS[f'{_d}_{_up}{_hold}'] = (_hold, _up, _d, 1.0, True, STEP_N)
ANIMS['die'] = (2, 'l', 'die', 1.3, False, FPS)
def set_anim(arm, E, chain, name, u):
    hold, up, d, dur, loop, _ = ANIMS[name]
    if d == 'die': pose(arm, E, chain, hold, up, None, 0, u * dur, die=u * dur)
    elif d is None: pose(arm, E, chain, hold, up, None, 0, u * dur)
    else: pose(arm, E, chain, hold, up, d, u, u * IDLE_S)

def build():
    arm, g = load()
    chain = add_tail(arm, g); rest_points(arm)
    E = rig(arm)
    return arm, g, chain, E

# ------------------------------------------------------------------------------------------------ sheet
def sheet():
    arm, g, chain, E = build()
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
    sc.render.film_transparent = True; res = 300; sc.render.resolution_x = sc.render.resolution_y = res; sc.render.image_settings.file_format = 'PNG'
    for o in bpy.data.objects:
        if o.type == 'EMPTY': o.hide_render = True
    cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
    out = P('art', 'hero3d', 'cat2', 'out'); os.makedirs(out, exist_ok=True); tmp = os.path.join(out, '_t.png'); rows = []
    views = [('front', (0, -1, 0.35)), ('q34', (0.75, -0.75, 0.6)), ('side', (1, 0, 0.25))]
    names = sys.argv[sys.argv.index('--') + 2:] or ['idle_l2', 'idle_a2', 'f_a2', 'l_a2', 'idle_l1', 'f_l1']
    for name in names:
        row = []
        for u in (0, 0.25, 0.5, 0.75):
            set_anim(arm, E, chain, name, u)
            for vn, d in views:
                d = Vector(d).normalized(); c = Vector((0, 0, 0.8)); cam.location = c + d * 5; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
                sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
                im = bpy.data.images.load(tmp, check_existing=False); a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); bpy.data.images.remove(im)
                a = a.reshape(res, res, 4)[::-1]; row.append(np.concatenate([a[..., :3] * a[..., 3:] + np.array([0.12, 0.13, 0.17]) * (1 - a[..., 3:]), np.ones((res, res, 1))], -1))
        rows.append(np.concatenate(row, 1)); print('sheet', name)
    o = np.concatenate(rows, 0); h, w = o.shape[:2]; im = bpy.data.images.new('S', w, h, alpha=True)
    im.pixels.foreach_set(np.ascontiguousarray(o[::-1]).astype(np.float32).ravel()); im.filepath_raw = os.path.join(out, 'sheet.png'); im.file_format = 'PNG'; im.save(); os.remove(tmp)
    print('→ art/hero3d/cat2/out/sheet.png (rows:', ', '.join(names), '; columns: 4 moments × front, ¾, side)')

# ------------------------------------------------------------------------------------------------ game
def game():
    arm, g, chain, E = build()
    me = g.data; tri = sum(len(p.vertices) - 2 for p in me.polygons)
    if tri > MAXTRI:
        bpy.context.view_layer.objects.active = g; dm = g.modifiers.new('dec', 'DECIMATE'); dm.ratio = MAXTRI / tri
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0); bpy.ops.object.modifier_apply(modifier='dec')
    # the rest pose in world space, the normalisation (as fbxboss.py)
    for c in [c for b in arm.pose.bones for c in b.constraints]: c.mute = True
    for b in arm.pose.bones: b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
    arm.data.pose_position = 'REST'; bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    e = g.evaluated_get(dg).to_mesh(); co = np.empty(len(e.vertices) * 3); e.vertices.foreach_get('co', co); g.evaluated_get(dg).to_mesh_clear()
    mw = np.array(g.matrix_world); co_w = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    arm.data.pose_position = 'POSE'
    for c in [c for b in arm.pose.bones for c in b.constraints]: c.mute = False
    lo, hi = co_w.min(0), co_w.max(0); k = 1.0 / (hi[2] - lo[2])
    N = Matrix.Scale(k, 4) @ Matrix.Translation((0, 0, -lo[2])); C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))); T = C @ N; Ti = T.inverted()
    nv = len(me.vertices); co_g = (np.c_[co_w, np.ones(nv)] @ np.array(T).T)[:, :3]
    gname = {vg.index: vg.name for vg in g.vertex_groups}; used = set()
    for v in me.vertices:
        for x in v.groups:
            if x.weight > 1e-4 and gname.get(x.group) in arm.data.bones: used.add(gname[x.group])
    bones = [b.name for b in arm.data.bones if b.name in used]; bix = {n: i for i, n in enumerate(bones)}
    W4 = np.zeros((nv, 4), np.float32); I4 = np.zeros((nv, 4), np.int64)
    for v in me.vertices:
        gs = sorted([(x.weight, bix[gname[x.group]]) for x in v.groups if gname.get(x.group) in bix and x.weight > 1e-4], reverse=True)[:4] or [(1.0, bix.get(HIPS, 0))]
        s = sum(w for w, _ in gs)
        for j, (w, b) in enumerate(gs): W4[v.index, j] = w / s; I4[v.index, j] = b
    me.calc_loop_triangles(); nl = len(me.loops); lv = np.empty(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
    try: cn = np.array([n.vector[:] for n in me.corner_normals])
    except Exception: cn = np.empty(nl * 3); me.loops.foreach_get('normal', cn); cn = cn.reshape(-1, 3)
    R3 = np.array(T)[:3, :3] @ np.array(g.matrix_world)[:3, :3]; cn = cn @ R3.T
    uvl = me.uv_layers.active or me.uv_layers[0]; uv = np.empty(nl * 2); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    lt = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('loops', lt)
    P3 = co_g[lv[lt]]; N3 = cn[lt]; U2 = uv[lt]; BI = I4[lv[lt]]; BW = W4[lv[lt]]
    key = np.concatenate([np.round(P3, 5), np.round(N3, 3), np.round(U2, 5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P3, N3, U2, BI, BW = P3[first], N3[first], U2[first], BI[first], BW[first]; idx = inv.astype(np.uint32).ravel(); n = len(P3)
    rec = np.zeros(n, dtype=[('p', '<f4', 3), ('n', 'i1', 3), ('s', 'u1'), ('uv', '<u2', 2), ('bi', 'u1', 4), ('bw', 'u1', 4), ('pad', 'u1', 4)])
    rec['p'] = P3; nn = N3 / np.maximum(np.linalg.norm(N3, axis=1, keepdims=True), 1e-9); rec['n'] = np.round(nn * 127).astype(np.int8)
    rec['s'] = int(0.25 * 255); rec['uv'] = np.round(np.clip(U2, 0, 1) * 65535).astype(np.uint16); rec['bi'] = BI.astype(np.uint8)
    bw = np.round(BW * 255); bw[:, 0] += 255 - bw.sum(1); rec['bw'] = np.clip(bw, 0, 255).astype(np.uint8)
    lo3, hi3 = P3.min(0), P3.max(0)
    with open(P('live', 'assets', f'c_{ID}.bin'), 'wb') as fh:
        fh.write(b'CHR1'); fh.write(struct.pack('<III', n, len(idx), len(bones))); fh.write(struct.pack('<6f', *lo3, *hi3)); fh.write(rec.tobytes()); fh.write(idx.tobytes())
    img = next(nd.image for mm in me.materials for nd in mm.node_tree.nodes if nd.type == 'TEX_IMAGE' and any(l.to_socket.name == 'Base Color' for l in nd.outputs[0].links))
    # the colour as the model has it: Blender's view transform (AgX by default) would flatten and desaturate it on the way out
    vs = bpy.context.scene.view_settings; vs.view_transform = 'Standard'; vs.look = 'None'; vs.exposure = 0.0; vs.gamma = 1.0
    img.scale(ATLAS, ATLAS); st = bpy.context.scene.render.image_settings; st.file_format = 'JPEG'; st.color_mode = 'RGB'; st.quality = 95
    img.save_render(P('live', 'assets', f'c_{ID}.jpg'))
    # the animations: per frame the skin matrices (posed × rest⁻¹, world, the game's space) and the gun's frame
    AW = arm.matrix_world; AWi = AW.inverted(); restm = {b: arm.data.bones[b].matrix_local.inverted() for b in bones}; A = {}
    sub = np.arange(0, nv, 5)
    for name, (hold, up, d, dur, loop, fps) in ANIMS.items():
        cnt = max(2, int(round(dur * fps)) + (0 if loop else 1)); fr, gf, low = [], [], 9.0
        for i in range(cnt):
            set_anim(arm, E, chain, name, i / (cnt if loop else cnt - 1))
            row = []
            for b in bones:
                Mx = T @ (AW @ arm.pose.bones[b].matrix @ restm[b] @ AWi) @ Ti; row += [round(Mx[r][c], 4) for r in range(3) for c in range(4)]
            G = T @ E['gun'].matrix_world; gp = []
            for r in range(3):
                ax = [G[r][c] for c in range(3)]
                gp += ax + [G[r][3]]
            Gm = np.array(gp).reshape(3, 4); Gm[:, :3] /= np.linalg.norm(Gm[:, :3], axis=0, keepdims=True)
            fr.append(row); gf.append([round(float(x), 5) for x in Gm.ravel()])
        # grounded: each frame's lowest point on the ground (standing; the body lying after the fall) — not the steps: their feet
        # are set on the ground by the IK, and their flight is meant
        for i, row in enumerate(fr if d is None or d == 'die' else []):
            Mf = np.array(row).reshape(len(bones), 3, 4); sk = np.zeros((len(sub), 3))
            for j in range(4): sk += W4[sub, j:j + 1] * (np.einsum('nij,nj->ni', Mf[I4[sub, j]][:, :, :3], co_g[sub]) + Mf[I4[sub, j]][:, :, 3])
            dy = -sk[:, 1].min(); Mf[:, :, 3] += [0, dy, 0]; fr[i] = [round(float(x), 4) for x in Mf.ravel()]; gf[i][7] = round(gf[i][7] + dy, 4)
        A[name] = dict(n=cnt, loop=loop, fps=fps, m=fr, g=gf); print(f'{name}: {cnt} frames ({dur} s)')
    # the ground a step cycle covers (model units), as the paws do it: the planted foot's speed back along the step's direction inside
    # its stance (the right foot planted for phase [0, STANCE), the left for [½, ½ + STANCE)), measured on the skinned feet — the
    # game turns the hero's speed into the cycles' phase with it, so a planted paw stays put (the IK falling a little short at the
    # stride's ends is in it)
    def planted(name, d):
        Am = A[name]['m']; nn = len(Am); dv = {'f': (0, 1), 'b': (0, -1), 'l': (1, 0), 'r': (-1, 0)}[d]; sp = []
        for bn, c0 in ((R_LEG['foot'], 0.0), (L_LEG['foot'], 0.5)):
            vi = np.where((I4[:, 0] == bix[bn]) & (W4[:, 0] > 0.8))[0]; P0 = co_g[vi]; tr = ph = 0.0
            for i in range(nn):
                if ((i + 0.5) / nn - c0) % 1.0 >= STANCE: continue
                q = [np.array(Am[ii]).reshape(len(bones), 3, 4)[bix[bn]] for ii in (i, (i + 1) % nn)]
                a0, a1 = [(Q[:, :3] @ P0.T).T.mean(0) + Q[:, 3] for Q in q]
                tr += -((a1[0] - a0[0]) * dv[0] + (a1[2] - a0[2]) * dv[1]); ph += 1.0 / nn
            sp.append(tr / ph)
        return round(float(np.mean(sp)), 4)
    gait = {d: planted(f'{d}_a2', d) for d in DIRS}
    print('gait (model units per cycle, from the planted feet):', gait, ' — the strides as set:', {d: round(DIRS[d][1] / STANCE * k, 4) for d in DIRS})
    meta = dict(src='meshy glb', hero=1, holds={'1': 'pistol', '2': 'the rest'}, gait=gait)
    info = dict(meta, boss=ID, height=round(float(hi3[1]), 4), tris=int(len(idx) // 3), verts=int(n), bones=bones, anims=A)
    json.dump(info, open(P('live', 'assets', f'c_{ID}.json'), 'w'), separators=(',', ':'))
    js = P('live', 'bosses3d.js'); s = open(js, encoding='utf8').read(); B3 = json.loads(s[s.index('{'):s.rindex('}') + 1])
    B3[ID] = dict(meta, height=info['height'], mesh=1, anims={k: dict(n=v['n'], loop=v['loop'], fps=v['fps']) for k, v in A.items()})
    open(js, 'w', encoding='utf8').write('window.BOSS3D = ' + json.dumps(B3, separators=(',', ':')) + ';\n')
    print(f'game: c_{ID}.bin {info["tris"]} tris {n} verts {len(bones)} bones; animations {list(A)}')

if MODE == 'sheet': sheet()
elif MODE == 'game': game()
