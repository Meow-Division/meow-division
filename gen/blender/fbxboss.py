# gen/blender/fbxboss.py — a finished, rigged and animated boss model (an FBX or a GLB from a 3D generator such as Meshy: the mesh skinned to its
# skeleton, one animation per file) into the game, as live/charmesh.js draws it:
#   python gen/blender/bl.py gen/blender/fbxboss.py <boss> sheet      every animation of every file in a sheet (to see what each is)
#   python gen/blender/bl.py gen/blender/fbxboss.py <boss> sheet <part of a file name> <from> <to>   one file's frames from–to
#   python gen/blender/bl.py gen/blender/fbxboss.py <boss> game       the mesh, its bones, the chosen animations → live/assets/c_<boss>.*
# The boss is described by art/bosses3d/<boss>_fbx.json: {"dir": the folder with the FBX files, "skin": the FBX holding the mesh,
#   "anims": {game name: {"file": FBX, "from": frame, "to": frame, "loop": bool, "stride": bool}}, "meta": {...}, "fps": 20}
#   ("stride": the forward travel per cycle measured from the planted foot → meta "stride" for the walk, "stride_<name>" for another gait)
# Everything is measured in world space and normalised: 1 unit tall, the feet on z = 0, centred, facing −Y (an FBX character faces
# −Y once imported); the skin matrices of each sampled frame are exported in the game's axes (x, y up, z toward the viewer).
import bpy, sys, os, json, math, struct, time
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.environ.get('ZH_ROOT') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def P(*a): return os.path.join(ROOT, *a)
ARGS = sys.argv[sys.argv.index('--') + 1:]
BOSS, MODE = ARGS[0], (ARGS[1] if len(ARGS) > 1 else 'sheet')
CFG = json.load(open(P('art', 'bosses3d', f'{BOSS}_fbx.json'), encoding='utf8'))
DIR = CFG['dir'] if os.path.isabs(CFG['dir']) else P(CFG['dir'])
MAXTRI = CFG.get('maxtri', 70000)

def is_gltf(path): return path.lower().endswith(('.glb', '.gltf'))

def load(path):
    """The FBX (one action) or a GLB (Meshy's "All animation" export: every animation an action, picked by "action" in the json)
    into the scene: (armature, [meshes], first action)."""
    before = set(bpy.data.objects); acts = set(bpy.data.actions)
    if is_gltf(path): bpy.ops.import_scene.gltf(filepath=path)
    else: bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE'); meshes = [o for o in new if o.type == 'MESH']
    if is_gltf(path):
        stray = [m for m in meshes if not m.vertex_groups]; meshes = [m for m in meshes if m.vertex_groups]
        for o in stray: bpy.data.objects.remove(o, do_unlink=True)              # Meshy's stray icosphere
        if arm.animation_data:                                                   # the importer stacks the other actions as NLA
            for tr in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(tr)   # strips: they'd add up
    act = [a for a in bpy.data.actions if a not in acts]
    return arm, meshes, (act[0] if act else (arm.animation_data and arm.animation_data.action))

def action_of(a, acts):
    """An animation's action: by its name ("action", the GLB's animations) or the one its FBX file brought."""
    return bpy.data.actions[a['action']] if a.get('action') else acts[a['file']]

def frame_set(f): bpy.context.scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))

def use_action(arm, act):
    """The action onto the armature. Blender 4.4+ (slotted actions): an action imported with another armature keeps its slot bound to
    that one, so assigning the action alone animates nothing — its slot has to be picked too."""
    arm.animation_data.action = act
    if getattr(act, 'slots', None) and hasattr(arm.animation_data, 'action_slot'): arm.animation_data.action_slot = act.slots[0]

def world_rest(arm, meshes):
    """The meshes' bind-pose vertices in world space (the armature in its rest position)."""
    arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); out = []
    for m in meshes:
        e = m.evaluated_get(dg).to_mesh(); v = np.empty(len(e.vertices) * 3); e.vertices.foreach_get('co', v)
        mw = np.array(m.matrix_world); out.append(v.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]); m.evaluated_get(dg).to_mesh_clear()
    arm.data.pose_position = 'POSE'; bpy.context.view_layer.update()
    return np.concatenate(out)

# ---------------------------------------------------------------------------------------------------------------- sheet
def sheet(only=None, rng=None):
    """art/bosses3d/out/<boss>_fbx.png: each FBX's animation, 10 frames, from the front (Workbench, textured)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    files = sorted(f for f in os.listdir(DIR) if f.lower().endswith('.fbx') and (not only or only.lower() in f.lower())); rows = []; res = 220
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
    sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = res; sc.render.image_settings.file_format = 'PNG'
    cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
    tmp = P('art', 'bosses3d', 'out', '_fbx_tmp.png'); os.makedirs(os.path.dirname(tmp), exist_ok=True)
    glb = is_gltf(CFG['skin'])
    if glb:                                                                     # one GLB: a row per action (only: part of its name)
        arm0, meshes0, _ = load(os.path.join(DIR, CFG['skin']))
        files = sorted(a.name for a in bpy.data.actions if not only or only.lower() in a.name.lower())
    for f in files:
        if glb:
            arm, meshes, act = arm0, meshes0, bpy.data.actions[f]
            if arm.animation_data is None: arm.animation_data_create()
            use_action(arm, act)
        else:
            for o in list(bpy.data.objects):
                if o != cam: bpy.data.objects.remove(o, do_unlink=True)
            arm, meshes, act = load(os.path.join(DIR, f))
        rest = world_rest(arm, meshes); lo, hi = rest.min(0), rest.max(0); H = hi[2] - lo[2]
        cam.data.ortho_scale = H * 1.6; c = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] + H * 0.5))
        d = Vector((0.35, -1.0, 0.35)).normalized(); cam.location = c + d * H * 4; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        f0, f1 = rng or (act.frame_range if act else (1, 1)); row = []
        for k in range(10):
            frame_set(f0 + (f1 - f0) * k / 9); sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
            im = bpy.data.images.load(tmp, check_existing=False); a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); bpy.data.images.remove(im)
            a = a.reshape(res, res, 4)[::-1]; row.append(np.concatenate([a[..., :3] * a[..., 3:] + np.array([0.12, 0.13, 0.17]) * (1 - a[..., 3:]), np.ones((res, res, 1))], -1))
        rows.append(np.concatenate(row, 1)); print(f'{f}: action {act.name if act else None} frames {f0:.0f}–{f1:.0f} ({(f1 - f0) / sc.render.fps:.2f} s at {sc.render.fps} fps), height {H:.3f}; columns at frames', [round(f0 + (f1 - f0) * k / 9) for k in range(10)])
    out = np.concatenate(rows, 0); h, w = out.shape[:2]; im = bpy.data.images.new('S', w, h, alpha=True)
    im.pixels.foreach_set(np.ascontiguousarray(out[::-1]).astype(np.float32).ravel()); im.filepath_raw = P('art', 'bosses3d', 'out', f'{BOSS}_fbx.png'); im.file_format = 'PNG'; im.save()
    os.remove(tmp); print('→ art/bosses3d/out/' + BOSS + '_fbx.png')

# ---------------------------------------------------------------------------------------------------------------- game
def game():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm, meshes, act0 = load(os.path.join(DIR, CFG['skin']))
    fps_src = bpy.context.scene.render.fps
    # the other files' actions onto this armature (the same skeleton: same bone names)
    acts = {CFG['skin']: act0}
    for nm, A in CFG['anims'].items():
        f = A.get('file', CFG['skin'])
        if f in acts or 'fall' in A: continue
        a2, m2, ac = load(os.path.join(DIR, f)); acts[f] = ac
        for o in [a2] + m2: bpy.data.objects.remove(o, do_unlink=True)
    if arm.animation_data is None: arm.animation_data_create()
    # one mesh, lighter: modifiers other than the armature applied, the parts joined, decimated
    for m in meshes:
        bpy.ops.object.select_all(action='DESELECT'); m.select_set(True); bpy.context.view_layer.objects.active = m
    if len(meshes) > 1:
        for m in meshes: m.select_set(True)
        bpy.ops.object.join()
    g = bpy.context.view_layer.objects.active; me = g.data
    tri = sum(len(p.vertices) - 2 for p in me.polygons); print(f'source mesh: {tri} triangles' + (f', decimated to {MAXTRI}' if tri > MAXTRI else ''))
    if tri > MAXTRI:
        dm = g.modifiers.new('dec', 'DECIMATE'); dm.ratio = MAXTRI / tri
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0); bpy.ops.object.modifier_apply(modifier='dec')
    # normalisation: world → 1 unit tall, feet on z = 0, centred on the hips
    arm.animation_data.action = None
    for pb in arm.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    rest = world_rest(arm, [g]); lo, hi = rest.min(0), rest.max(0); k = CFG.get('height', 1.0) / (hi[2] - lo[2])
    N = Matrix.Scale(k, 4) @ Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])); Ni = N.inverted()
    C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))); T = C @ N; Ti = T.inverted()      # world → the game's model space
    # the vertices (bind pose, world, then the game's space), normals, uv, weights over the deforming bones
    nv = len(me.vertices); mw = g.matrix_world
    co_w = rest; co_g = (np.c_[co_w, np.ones(nv)] @ np.array(T).T)[:, :3]
    used = sorted({vg.name for vg in g.vertex_groups if vg.name in arm.data.bones and any(vg.index == x.group for v in me.vertices for x in v.groups if x.weight > 1e-4)}) if nv < 0 else None
    wsum = {}
    for v in me.vertices:
        for x in v.groups:
            if x.weight > 1e-4: wsum[x.group] = wsum.get(x.group, 0) + x.weight
    gname = {vg.index: vg.name for vg in g.vertex_groups}
    bones = [b.name for b in arm.data.bones if any(gname.get(i) == b.name for i in wsum)]
    bix = {n: i for i, n in enumerate(bones)}
    W4 = np.zeros((nv, 4), np.float32); I4 = np.zeros((nv, 4), np.int64)
    for v in me.vertices:
        gs = sorted([(x.weight, bix[gname[x.group]]) for x in v.groups if gname.get(x.group) in bix and x.weight > 1e-4], reverse=True)[:4] or [(1.0, 0)]
        s = sum(w for w, _ in gs)
        for j, (w, b) in enumerate(gs): W4[v.index, j] = w / s; I4[v.index, j] = b
    me.calc_loop_triangles(); nl = len(me.loops)
    lv = np.empty(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
    try: cn = np.array([n.vector[:] for n in me.corner_normals])
    except Exception: cn = np.empty(nl * 3); me.loops.foreach_get('normal', cn); cn = cn.reshape(-1, 3)
    R3 = np.array(T)[:3, :3] @ np.array(mw)[:3, :3]; cn = cn @ R3.T                       # normals: the same rotation (the scale drops with normalising)
    uvl = me.uv_layers.active or me.uv_layers[0]; uv = np.empty(nl * 2); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    lt = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('loops', lt)
    P3 = co_g[lv[lt]]; N3 = cn[lt]; U2 = uv[lt]; BI = I4[lv[lt]]; BW = W4[lv[lt]]
    key = np.concatenate([np.round(P3, 5), np.round(N3, 3), np.round(U2, 5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P3, N3, U2, BI, BW = P3[first], N3[first], U2[first], BI[first], BW[first]; idx = inv.astype(np.uint32).ravel(); n = len(P3)
    rec = np.zeros(n, dtype=[('p', '<f4', 3), ('n', 'i1', 3), ('s', 'u1'), ('uv', '<u2', 2), ('bi', 'u1', 4), ('bw', 'u1', 4), ('pad', 'u1', 4)])
    rec['p'] = P3; nn = N3 / np.maximum(np.linalg.norm(N3, axis=1, keepdims=True), 1e-9); rec['n'] = np.round(nn * 127).astype(np.int8)
    rec['s'] = int(CFG.get('spec', 0.25) * 255); rec['uv'] = np.round(np.clip(U2, 0, 1) * 65535).astype(np.uint16); rec['bi'] = BI.astype(np.uint8)
    bw = np.round(BW * 255); bw[:, 0] += 255 - bw.sum(1); rec['bw'] = np.clip(bw, 0, 255).astype(np.uint8)
    lo3, hi3 = P3.min(0), P3.max(0)
    with open(P('live', 'assets', f'c_{BOSS}.bin'), 'wb') as fh:
        fh.write(b'CHR1'); fh.write(struct.pack('<III', n, len(idx), len(bones))); fh.write(struct.pack('<6f', *lo3, *hi3)); fh.write(rec.tobytes()); fh.write(idx.tobytes())
    # the colour: the model's own base colour texture, as a JPEG at most `atlas` px
    tex = CFG.get('texture'); img = bpy.data.images.load(os.path.join(DIR, tex)) if tex else next(n.image for mm in me.materials for n in mm.node_tree.nodes if n.type == 'TEX_IMAGE' and 'normal' not in n.image.name.lower() and 'rough' not in n.image.name.lower() and 'metal' not in n.image.name.lower())
    sz = CFG.get('atlas', 2048)
    if img.size[0] > sz: img.scale(sz, sz)
    st = bpy.context.scene.render.image_settings; st.file_format = 'JPEG'; st.color_mode = 'RGB'; st.quality = 90
    img.save_render(P('live', 'assets', f'c_{BOSS}.jpg'))
    # the animations: each sampled at fps; per frame, per bone: the skin matrix (posed × rest⁻¹ in world), in the game's space
    fps = CFG.get('fps', 20); AW = arm.matrix_world; AWi = AW.inverted(); restm = {b: arm.data.bones[b].matrix_local.inverted() for b in bones}
    A = {}; dg = None
    for name, a in CFG['anims'].items():
        if 'fall' in a:
            # a made-up death for a model without one: the first frame of animation `fall` tipped over backwards round the feet,
            # falling faster and faster (as a body does), `angle` degrees in `dur` s, then lying still for a few frames ("ground"
            # below keeps the lowest point on the ground). Backwards is −z: the character faces +z in the game's space
            base = np.array(A[a['fall']]['m'][0]).reshape(len(bones), 3, 4); cnt = int(round(a.get('dur', 0.9) * fps)) + 4; fr = []
            for i in range(cnt):
                k = min(1.0, i / (cnt - 4)); th = math.radians(a.get('angle', -86)) * k * k; c, s = math.cos(th), math.sin(th)
                R = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
                Mf = np.concatenate([np.einsum('ij,njk->nik', R, base[:, :, :3]), (base[:, :, 3] @ R.T)[:, :, None]], 2)
                fr.append([round(float(x), 5) for x in Mf.reshape(-1)])
            A[name] = dict(n=cnt, loop=False, fps=fps, m=fr); print(f'{name}: made up — {a["fall"]} tipped {a.get("angle", -86)}° in {a.get("dur", 0.9)} s → {cnt} samples')
        else:
            act = action_of(a, acts); use_action(arm, act)
            f0, f1 = a.get('from', act.frame_range[0]), a.get('to', act.frame_range[1]); dur = (f1 - f0) / a.get('src_fps', fps_src)   # (src_fps: a file made at another frame rate than the first)
            cnt = max(2, int(round(dur * fps)) + (0 if a.get('loop') else 1)); fr = []
            for i in range(cnt):
                frame_set(f0 + (f1 - f0) * i / (cnt if a.get('loop') else cnt - 1)); bpy.context.view_layer.update()
                row = []
                for b in bones:
                    Mx = T @ (AW @ arm.pose.bones[b].matrix @ restm[b] @ AWi) @ Ti
                    row += [round(Mx[r][c], 5) for r in range(3) for c in range(4)]
                fr.append(row)
            mv = float(np.abs(np.array(fr) - np.array(fr[0])).max())                       # an animation whose pose never changes: the action drives nothing
            if f1 > f0 and mv < 1e-3: raise SystemExit(f'{name}: {a.get("action") or a.get("file")} — the pose never changes over frames {f0:.0f}–{f1:.0f} (the action is not on the skeleton)')
            A[name] = dict(n=cnt, loop=bool(a.get('loop')), fps=fps, m=fr); print(f'{name}: {a.get("action") or a.get("file")} frames {f0:.0f}–{f1:.0f} ({dur:.2f} s) → {cnt} samples, motion {mv:.3f}')
            if a.get('stride') and CFG.get('feet'):                                       # the walk: how far the planted (lower) foot goes back per cycle
                ft = []
                for i in range(cnt + 1):
                    frame_set(f0 + (f1 - f0) * i / cnt); bpy.context.view_layer.update()
                    ft.append([np.array(T @ (AW @ arm.pose.bones[b].head))[:3] for b in CFG['feet']])
                ft = np.array(ft); low = ft[:, :, 1].argmin(1); travel = 0.0
                for i in range(cnt):
                    if low[i] == low[i + 1]: travel += ft[i, low[i], 2] - ft[i + 1, low[i], 2]   # forward is +z: a planted foot moves −z
                CFG.setdefault('meta', {})['stride' if name == 'walk' else 'stride_' + name] = round(float(travel), 4); print(f'   stride {travel:.3f} units per cycle')
            # self-check on the middle frame: Blender's own deformation against the exported skinning
            i = cnt // 2; frame_set(f0 + (f1 - f0) * i / (cnt if a.get('loop') else cnt - 1)); bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get(); ev = g.evaluated_get(dg).to_mesh(); pc = np.empty(len(ev.vertices) * 3); ev.vertices.foreach_get('co', pc)
            pc = pc.reshape(-1, 3) @ np.array(mw)[:3, :3].T + np.array(mw)[:3, 3]; pc = (np.c_[pc, np.ones(len(pc))] @ np.array(T).T)[:, :3]; g.evaluated_get(dg).to_mesh_clear()
            Mf = np.array(fr[i]).reshape(len(bones), 3, 4); sk = np.zeros_like(co_g)
            for j in range(4): sk += W4[:, j:j + 1] * (np.einsum('nij,nj->ni', Mf[I4[:, j]][:, :, :3], co_g) + Mf[I4[:, j]][:, :, 3])
            print(f'   skinning check: max error {np.abs(sk - pc).max():.5f} units')
        A[name]['m'] = fr
        # "inplace": the body kept over its spot (an animation that travels — a step into a kick, a run that moves on — would slide
        # off it and snap back at the loop); "ground": each frame's lowest point on the ground (no sinking in, no floating over the
        # shadow). Per frame, every bone's matrix moved by the same amount; the animation's option, else the file's
        inpl, gnd = a.get('inplace', CFG.get('inplace', False)), a.get('ground', CFG.get('ground', False))
        if inpl or gnd:
            sub = np.arange(0, len(co_g), 5); P0 = co_g[sub]; c0 = np.zeros(2); drift = 0.0; lift = 0.0   # (kept over the origin: the feet's point)
            for i, row in enumerate(fr):
                Mf = np.array(row).reshape(len(bones), 3, 4); sk = np.zeros((len(sub), 3))
                for j in range(4): sk += W4[sub, j:j + 1] * (np.einsum('nij,nj->ni', Mf[I4[sub, j]][:, :, :3], P0) + Mf[I4[sub, j]][:, :, 3])
                d = np.zeros(3)
                if inpl: d[[0, 2]] = c0 - sk[:, [0, 2]].mean(0)
                if gnd: d[1] = -sk[:, 1].min()
                drift = max(drift, float(np.hypot(d[0], d[2]))); lift = max(lift, abs(float(d[1])))
                Mf[:, :, 3] += d; fr[i] = [round(float(x), 5) for x in Mf.reshape(-1)]
            print(f'   in place: moved back by up to {drift:.3f}' if inpl else '', f'   grounded: up to {lift:.3f}' if gnd else '')
    meta = dict(CFG.get('meta', {})); H = float(hi3[1])
    # "attach": bones something is held by (the hero's gun in its hand): each one's rest frame in the game's space, 3 rows of 4 (the
    # game gets its posed frame as that bone's skin matrix of the frame × this); in c_<boss>.json only
    att = {b: dict(i=bones.index(b), m=[round((T @ AW @ arm.data.bones[b].matrix_local)[r][c], 5) for r in range(3) for c in range(4)]) for b in CFG.get('attach', [])}
    info = dict(meta, attach=att, boss=BOSS, height=round(H, 4), tris=int(len(idx) // 3), verts=int(n), bones=bones, anims=A)
    json.dump(info, open(P('live', 'assets', f'c_{BOSS}.json'), 'w'), separators=(',', ':'))
    js = P('live', 'bosses3d.js'); B3 = {}
    if os.path.exists(js): s = open(js, encoding='utf8').read(); B3 = json.loads(s[s.index('{'):s.rindex('}') + 1])
    B3[BOSS] = dict(meta, height=round(H, 4), mesh=1, anims={k: dict(n=v['n'], loop=v['loop'], fps=v['fps']) for k, v in A.items()})
    open(js, 'w', encoding='utf8', newline='\n').write('window.BOSS3D = ' + json.dumps(B3, separators=(',', ':')) + ';\n')
    print(f'game: c_{BOSS}.bin {info["tris"]} tris {n} verts {len(bones)} bones; height {H:.3f}; animations {list(A)}')

if MODE == 'sheet': sheet(ARGS[2] if len(ARGS) > 2 else None, (float(ARGS[3]), float(ARGS[4])) if len(ARGS) > 4 else None)
elif MODE == 'game': game()
