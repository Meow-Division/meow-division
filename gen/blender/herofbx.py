# gen/blender/herofbx.py — the hero cat from the user's Meshy FBX (art/hero3d/cat4/anims.fbx, Bandit Whiskers: one Mixamo skeleton,
# its clips Idle_11 and Walking used; Running and Run_and_Shoot left out) made into the game's character:
#   python gen/blender/bl.py gen/blender/herofbx.py sheet [clip ...]   clips, 4 moments each, front / ¾ / side (art/hero3d/cat4/out)
#   python gen/blender/bl.py gen/blender/herofbx.py game               → live/assets/c_cat.{bin,jpg,json}, live/bosses3d.js
# The body is the animations as made (the walk is made in place); with a gun the arms are taken over by IK
# and hold it square in front of the cat, the chest kept facing forward, the fingers closed on it:
# hold 2 (shotgun, smg, sniper, minigun, flamethrower and the rest) in both paws, the barrel a little down; hold 1 (the pistol) in
# both paws, the arms out straight ahead, the barrel level. Clips: lobby (no gun: the menus), idle1 / idle2, run1 / run2 (the walk,
# with a gun). Every frame carries the gun's frame ("g": origin at the grip, z along the barrel, y up) in the game's space.
# Space: as gen/blender/fbxboss.py — 1 unit tall, feet on y = 0, facing +z, x the cat's left, y up.
import bpy, sys, os, json, math, struct
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.environ.get('ZH_ROOT') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def P(*a): return os.path.join(ROOT, *a)
ARGS = sys.argv[sys.argv.index('--') + 1:]; MODE = (ARGS + ['sheet'])[0]
DIR, ID, MAXTRI, ATLAS, SRC = P('art', 'hero3d', 'cat4'), 'cat', 60000, 2048, 'anims.fbx'
TEX = 'Meshy_AI_Bandit_Whiskers_biped_texture_0.png'
MX = lambda n: 'mixamorig:' + n
# the clips: (the file's action, hold: 0 none / 1 pistol / 2 the rest, samples per s, loop, in place)
CLIPS = {
    'lobby': ('Idle_11', 0, 20, True, True),
    'idle1': ('Idle_11', 1, 20, True, True), 'idle2': ('Idle_11', 2, 20, True, True),
    'run1': ('Walking', 1, 30, True, True), 'run2': ('Walking', 2, 30, True, True),
}

def frame_set(f): bpy.context.scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
def load(path):
    before = set(bpy.data.objects); acts = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE'); meshes = [o for o in new if o.type == 'MESH']
    return arm, meshes, {a.name.split('|')[-1]: a for a in bpy.data.actions if a not in acts}
def use_action(arm, act):
    arm.animation_data.action = act
    if getattr(act, 'slots', None) and hasattr(arm.animation_data, 'action_slot'): arm.animation_data.action_slot = act.slots[0]

def empty(name):
    o = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(o); o.empty_display_size = 0.05; return o

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm, meshes, acts = load(os.path.join(DIR, SRC))
    if arm.animation_data is None: arm.animation_data_create()
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes: m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1: bpy.ops.object.join()
    g = bpy.context.view_layer.objects.active
    pb = arm.pose.bones; E = {'curl': empty('curl')}; E['curl'].rotation_euler = (math.radians(55), 0, 0)
    # the arms: IK to the wrists' targets, the paws turned along the gun (damped track); the chest kept facing forward (the run is
    # side-on); the fingers closed (a rotation added after the animation's)
    for s in ('Right', 'Left'):
        E['w' + s] = empty('w' + s); E['e' + s] = empty('e' + s); E['h' + s] = empty('h' + s)
        c = pb[MX(s + 'ForeArm')].constraints.new('IK'); c.target = E['w' + s]; c.pole_target = E['e' + s]; c.chain_count = 2; c.pole_angle = math.radians(-90); c.name = 'hold'
        d = pb[MX(s + 'Hand')].constraints.new('DAMPED_TRACK'); d.target = E['h' + s]; d.track_axis = 'TRACK_Y'; d.name = 'hold'
        for fn in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
            for k in (1, 2, 3):
                n = MX(f'{s}Hand{fn}{k}')
                if n in pb:
                    cr = pb[n].constraints.new('COPY_ROTATION'); cr.target = E['curl']; cr.mix_mode = 'AFTER'; cr.target_space = 'LOCAL'; cr.owner_space = 'LOCAL'; cr.name = 'hold'
    E['fwd'] = empty('fwd')
    for bn in ('Spine2', 'Head'):                                             # the chest and the head to the front (the run looks along a gun held side-on)
        lt = pb[MX(bn)].constraints.new('LOCKED_TRACK'); lt.target = E['fwd']; lt.track_axis = 'TRACK_Z'; lt.lock_axis = 'LOCK_Y'; lt.name = 'hold'
    E['gun'] = empty('gun')
    return arm, g, acts, E

def holding(arm, on):
    for b in arm.pose.bones:
        for c in b.constraints:
            if c.name.startswith('hold'): c.mute = not on

REST = {}
def set_frame(arm, E, acts, name, u):
    """the clip at u (0..1 of its length): the action's frame, then (with a gun) where the gun is and the arms on it"""
    f, hold, fps, loop, inpl = CLIPS[name]; act = acts[f]; use_action(arm, act); f0, f1 = act.frame_range
    holding(arm, False); frame_set(f0 + (f1 - f0) * u); bpy.context.view_layer.update()
    if not hold: return
    AW = arm.matrix_world; pb = arm.pose.bones
    head = lambda n: np.array(AW @ pb[n].head)
    sR, sL = head(MX('RightArm')), head(MX('LeftArm')); c = (sR + sL) / 2; hip = head(MX('Hips'))
    L = REST['arm']; W = np.linalg.norm(sR - sL)
    fwd, up, left = np.array([0, -1.0, 0]), np.array([0, 0, 1.0]), np.array([1.0, 0, 0])
    base = np.array([hip[0], hip[1], c[2]])                                  # square in front of the body, at the shoulders' height
    if hold == 1:                                                            # the pistol: both arms out straight ahead, the barrel level
        grip = base + fwd * (0.78 * L) - up * (0.16 * L) - left * (0.02 * W); bar = fwd
        foreL = grip + left * 0.03 * W - up * 0.05 * L
    else:                                                                    # the long guns: in both paws, the barrel a little down
        grip = base + fwd * (0.40 * L) - up * (0.42 * L) - left * (0.12 * W); bar = fwd * math.cos(math.radians(12)) - up * math.sin(math.radians(12))
        foreL = grip + bar * (0.55 * L) + left * 0.05 * W
    z = bar / np.linalg.norm(bar); y = up - z * np.dot(up, z); y /= np.linalg.norm(y); x = np.cross(y, z)
    gm = Matrix.Identity(4)
    for r in range(3): gm[r][0], gm[r][1], gm[r][2], gm[r][3] = x[r], y[r], z[r], grip[r]
    E['gun'].matrix_world = gm
    E['wRight'].location = grip - z * 0.03 * L; E['hRight'].location = grip + z * 0.5 * L + y * 0.06 * L
    E['eRight'].location = sR + np.array([-0.6 * W, 0.4 * L, -0.8 * L])
    E['wLeft'].location = foreL - y * 0.05 * L; E['hLeft'].location = foreL + z * 0.5 * L
    E['eLeft'].location = sL + np.array([0.6 * W, 0.4 * L, -0.8 * L])
    E['fwd'].location = c + fwd * 5
    holding(arm, True); bpy.context.view_layer.update()

def rest(arm):
    b = arm.data.bones; AW = arm.matrix_world
    REST['arm'] = (AW @ b[MX('RightArm')].head_local - AW @ b[MX('RightForeArm')].head_local).length + (AW @ b[MX('RightForeArm')].head_local - AW @ b[MX('RightHand')].head_local).length

# ------------------------------------------------------------------------------------------------ sheet
def sheet():
    arm, g, acts, E = build(); rest(arm)
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
    sc.render.film_transparent = True; res = 300; sc.render.resolution_x = sc.render.resolution_y = res; sc.render.image_settings.file_format = 'PNG'
    for o in bpy.data.objects:
        if o.type == 'EMPTY': o.hide_render = True
    lo = min((arm.matrix_world @ Vector(v)).z for v in [b.head_local for b in arm.data.bones]); H = 1.75
    cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'; cam.data.ortho_scale = H * 1.25
    out = os.path.join(DIR, 'out'); os.makedirs(out, exist_ok=True); tmp = os.path.join(out, '_t.png'); rows = []
    names = ARGS[1:] or ['idle2', 'run2', 'idle1', 'run1']
    for name in names:
        row = []
        for u in (0, 0.25, 0.5, 0.75):
            set_frame(arm, E, acts, name, u)
            hip = arm.matrix_world @ arm.pose.bones[MX('Hips')].head
            for d in ((0, -1, 0.3), (0.75, -0.75, 0.6), (1, 0, 0.2)):
                d = Vector(d).normalized(); cc = Vector((hip.x, hip.y, H * 0.5)); cam.location = cc + d * 6; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
                sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
                im = bpy.data.images.load(tmp, check_existing=False); a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); bpy.data.images.remove(im)
                a = a.reshape(res, res, 4)[::-1]; row.append(np.concatenate([a[..., :3] * a[..., 3:] + np.array([0.12, 0.13, 0.17]) * (1 - a[..., 3:]), np.ones((res, res, 1))], -1))
        rows.append(np.concatenate(row, 1)); print('sheet', name)
    o = np.concatenate(rows, 0); h, w = o.shape[:2]; im = bpy.data.images.new('S', w, h, alpha=True)
    im.pixels.foreach_set(np.ascontiguousarray(o[::-1]).astype(np.float32).ravel()); im.filepath_raw = os.path.join(out, 'sheet.png'); im.file_format = 'PNG'; im.save(); os.remove(tmp)
    print('→ art/hero3d/cat4/out/sheet.png (rows:', ', '.join(names), '; columns: 4 moments × front, ¾, side)')

# ------------------------------------------------------------------------------------------------ game
def game():
    arm, g, acts, E = build(); rest(arm)
    me = g.data; tri = sum(len(p.vertices) - 2 for p in me.polygons)
    if tri > MAXTRI:
        bpy.context.view_layer.objects.active = g; dm = g.modifiers.new('dec', 'DECIMATE'); dm.ratio = MAXTRI / tri
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0); bpy.ops.object.modifier_apply(modifier='dec')
    # rest pose, world; the normalisation (fbxboss.py)
    arm.animation_data.action = None; holding(arm, False)
    for b in arm.pose.bones: b.location = (0, 0, 0); b.rotation_quaternion = (1, 0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
    arm.data.pose_position = 'REST'; bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    e = g.evaluated_get(dg).to_mesh(); co = np.empty(len(e.vertices) * 3); e.vertices.foreach_get('co', co); g.evaluated_get(dg).to_mesh_clear()
    mw = np.array(g.matrix_world); co_w = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]; arm.data.pose_position = 'POSE'
    lo, hi = co_w.min(0), co_w.max(0); k = 1.0 / (hi[2] - lo[2])
    N = Matrix.Scale(k, 4) @ Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])); C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))); T = C @ N; Ti = T.inverted()
    nv = len(me.vertices); co_g = (np.c_[co_w, np.ones(nv)] @ np.array(T).T)[:, :3]
    gname = {vg.index: vg.name for vg in g.vertex_groups}; used = set()
    for v in me.vertices:
        for x in v.groups:
            if x.weight > 1e-4 and gname.get(x.group) in arm.data.bones: used.add(gname[x.group])
    bones = [b.name for b in arm.data.bones if b.name in used]; bix = {n: i for i, n in enumerate(bones)}
    W4 = np.zeros((nv, 4), np.float32); I4 = np.zeros((nv, 4), np.int64)
    for v in me.vertices:
        gs = sorted([(x.weight, bix[gname[x.group]]) for x in v.groups if gname.get(x.group) in bix and x.weight > 1e-4], reverse=True)[:4] or [(1.0, bix[MX('Hips')])]
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
    # the colour as made (the file's own PNG, its colours untouched: Standard view, no AgX; 8192² brought down to ATLAS)
    img = bpy.data.images.load(os.path.join(DIR, TEX))
    vs = bpy.context.scene.view_settings; vs.view_transform = 'Standard'; vs.look = 'None'; vs.exposure = 0.0; vs.gamma = 1.0
    img.scale(ATLAS, ATLAS); st = bpy.context.scene.render.image_settings; st.file_format = 'JPEG'; st.color_mode = 'RGB'; st.quality = 95
    img.save_render(P('live', 'assets', f'c_{ID}.jpg'))
    # the clips: per frame the skin matrices and the gun's frame; set in place (the horizontal drift of the body taken out) and
    # grounded (a loop on its lowest point over the clip, so a swinging toe dipping lower does not lift the body), the gun moved with it
    AW = arm.matrix_world; AWi = AW.inverted(); restm = {b: arm.data.bones[b].matrix_local.inverted() for b in bones}; A = {}
    sub = np.arange(0, nv, 5); fps_src = bpy.context.scene.render.fps
    for name, (f, hold, fps, loop, inpl) in CLIPS.items():
        act = acts[f]; f0, f1 = act.frame_range; dur = (f1 - f0) / fps_src; cnt = max(2, int(round(dur * fps)) + (0 if loop else 1)); fr, gf = [], []
        for i in range(cnt):
            set_frame(arm, E, acts, name, i / (cnt if loop else cnt - 1))
            fr.append([T @ (AW @ arm.pose.bones[b].matrix @ restm[b] @ AWi) @ Ti for b in bones])
            G = T @ E['gun'].matrix_world; Gm = np.array([[G[r][c] for c in range(4)] for r in range(3)]); Gm[:, :3] /= np.linalg.norm(Gm[:, :3], axis=0, keepdims=True); gf.append(Gm)
        rows, fl = [], []
        for i, Ms in enumerate(fr):
            Mf = np.array([[[Mx[r][c] for c in range(4)] for r in range(3)] for Mx in Ms]); sk = np.zeros((len(sub), 3))
            for j in range(4): sk += W4[sub, j:j + 1] * (np.einsum('nij,nj->ni', Mf[I4[sub, j]][:, :, :3], co_g[sub]) + Mf[I4[sub, j]][:, :, 3])
            d = np.zeros(3)
            if inpl: d[[0, 2]] = -sk[:, [0, 2]].mean(0)
            fl.append(sk[:, 1].min()); rows.append((Mf, d))
        g0 = min(fl) if loop else None                                       # a loop stands on one ground level (its lowest point over the clip);
        for i, (Mf, d) in enumerate(rows):                                   # a one-off on its lowest point frame by frame
            d[1] = -(g0 if loop else fl[i])
            Mf[:, :, 3] += d; gf[i][:, 3] += d
            rows[i] = [round(float(x), 4) for x in Mf.ravel()]; gf[i] = [round(float(x), 4) for x in gf[i].ravel()]
        A[name] = dict(n=cnt, loop=loop, fps=round(cnt / dur, 4) if loop else round((cnt - 1) / dur, 4), m=rows, g=gf if hold else None); print(f'{name}: {f} {cnt} frames ({dur:.2f} s)')
    # the run's ground per cycle, as the paws do it: the planted (lower) foot's speed back along +z inside the cycle, measured on the
    # skinned feet — the game turns the hero's speed into the run's phase with it, so a planted paw stays put
    def gait(name):                                                          # ground per cycle: the soles' speed back while they stand
        Am = A[name]['m']; nn = len(Am); paws = []
        for s_ in ('Left', 'Right'):                                         # the sole: the paw's lowest vertices at rest (the foot or the toes)
            fb = [bix[MX(s_ + k)] for k in ('Foot', 'ToeBase') if MX(s_ + k) in bix]
            fv = np.where(np.isin(I4[:, 0], fb) & (W4[:, 0] > 0.5))[0]; fv = fv[co_g[fv, 1] < co_g[fv, 1].min() + 0.012]
            pos = []
            for i in range(nn):
                Q = np.array(Am[i]).reshape(len(bones), 3, 4)[I4[fv, 0]]; pos.append((np.einsum('nij,nj->ni', Q[:, :, :3], co_g[fv]) + Q[:, :, 3]).mean(0))
            pos = np.array(pos); paws.append((s_, pos))
        # standing: in a walk a paw goes back only while it stands (the swing brings it forward, near the ground in this one: its height
        # does not tell), so the stance is each paw's longest stretch going back, its two turning frames left off; the ground per
        # cycle is the soles' mean speed back over the stances
        dz, cnt, st = 0.0, 0, []
        for s_, p_ in paws:
            back = [p_[(i + 1) % nn, 2] < p_[i, 2] for i in range(nn)]; best, cur = (0, 0), None
            for k in range(2 * nn):
                if back[k % nn]: cur = (cur[0], k - cur[0] + 1) if cur else (k, 1)
                else: cur = None
                if cur and cur[1] > best[1] and cur[1] <= nn: best = cur
            fr_ = [(best[0] + j) % nn for j in range(1, best[1] - 1)]; st.append((s_, p_, fr_))
            for i in fr_: dz += p_[i, 2] - p_[(i + 1) % nn, 2]; cnt += 1
        g = dz / max(cnt, 1) * nn
        for s_, p_, fr_ in st:                                               # what is left of the slip once the phase follows the ground
            on = [p_[i, 2] + g * k / nn for k, i in enumerate(fr_)]; hov = p_[fr_, 1].mean() - p_[:, 1].min()
            print(f'  {s_} paw stands {len(fr_)}/{nn} frames, slides {(max(on) - min(on)) * 100:.1f} % of the height, sole {hov * 100:.1f} % above its lowest')
        return round(g, 4)
    meta = dict(src='meshy fbx', hero=1, holds={'1': 'pistol', '2': 'the rest'}, gait=gait('run2'))
    print('run gait (model units per cycle):', meta['gait'])
    info = dict(meta, boss=ID, height=round(float(hi3[1]), 4), tris=int(len(idx) // 3), verts=int(n), bones=bones, anims=A)
    json.dump(info, open(P('live', 'assets', f'c_{ID}.json'), 'w'), separators=(',', ':'))
    js = P('live', 'bosses3d.js'); s = open(js, encoding='utf8').read(); B3 = json.loads(s[s.index('{'):s.rindex('}') + 1])
    B3[ID] = dict(src=meta['src'], hero=1, height=info['height'], mesh=1, anims={k: dict(n=v['n'], loop=v['loop'], fps=v['fps']) for k, v in A.items()})
    open(js, 'w', encoding='utf8').write('window.BOSS3D = ' + json.dumps(B3, separators=(',', ':')) + ';\n')
    print(f'game: c_{ID}.bin {info["tris"]} tris {n} verts {len(bones)} bones; clips {list(A)}')

if MODE == 'sheet': sheet()
elif MODE == 'game': game()
