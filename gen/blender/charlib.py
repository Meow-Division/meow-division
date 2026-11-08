# gen/blender/charlib.py — the bosses as 3D models in Blender (headless), shared by every boss script art/bosses3d/<boss>.py:
#   python gen/blender/bl.py art/bosses3d/<boss>.py            quick: model + camera fit + silhouette check (seconds)
#   python gen/blender/bl.py art/bosses3d/<boss>.py anim       + rig + every animation's key frames in flat colours (a sheet to judge motion)
#   python gen/blender/bl.py art/bosses3d/<boss>.py full       + the reference projected and baked, every frame rendered for the game
#
# UNITS AND AXES. 1 unit ≈ the character's height; the feet stand on z = 0 round the origin (x = 0, y = 0 between the feet). +Z up,
# the character faces −Y (toward the viewer of the reference), +X is the character's LEFT (the viewer's right in a front view).
# The model is built IN THE REFERENCE'S POSE (art/refs/bosses3d/<boss>_a.png): that pose is the rig's rest pose.
#
# THE SCRIPT builds the body from parts (gunlib's helpers: box, cyl, sphere, prism, cut, union, subsurf, bev, mat, sample_ref …, or plain
# bpy: metaballs converted to meshes, skin modifiers, sculpted vertices), binds each part to a bone with bind(obj, 'bone') (rigid: the
# whole part follows that bone; overlap the parts at the joints so nothing opens up when a limb bends), declares the skeleton with
# skeleton({...}) and the animations with ANIM / pose() (below), then calls finish(boss, mode).
#
# THE CAMERA is fitted to the reference's silhouette and kept in art/bosses3d/<boss>_cam.json ("lock": true keeps it as it is).
# THE TEXTURE: every part is painted with the reference's own pixels where that part shows from the reference's camera, and with a
# smooth continuation of them where it does not (a chest behind an arm gets chest colours; see proj_tiles). So where the shape matches
# the picture, the model seen from the reference's camera IS the picture, and a limb that moves in an animation keeps its pixels and
# uncovers plausible skin / cloth behind it. Materials only matter for the quick flat-colour checks: pick them with sample_ref(boss,
# x, y) — the reference's colour round picture px x, y of the 1280 px square art/refs/bosses3d/<boss>_a.png, y DOWN from the top.
#
# ANIMATION: the script defines ANIM = {name: dict(n=frames, loop=bool, fps=12)} and pose(anim, i, n) -> {bone: (rx, ry, rz)} in
# degrees (the bone's own XYZ euler from its rest pose) plus optional 'loc:bone': (x, y, z) (an offset in the bone's own axes — for
# the hips' bob). Required animations: idle (loop), walk (loop: one full stride, left and right step), die (not looped; ends lying
# on the ground), plus the boss's attacks (its brief). STRIDE = the distance the body travels during one walk cycle (units), so the
# game moves the feet without sliding.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *                                                      # noqa: F401,F403 — the modelling helpers
import gunlib as GL
import bpy, math, json, time, shutil
import numpy as np
from mathutils import Vector, Matrix

RES = 640                                                                # game frames: px (square, the reference's framing)

def P2(*a): return P('art', 'bosses3d', *a)

def refload(boss):
    """The reference into gunlib's cache, so its helpers (ref_mask, sample_ref, project_reference, bake_atlas, sheet) take boss as the 'gun'."""
    if boss not in GL._REF:
        im = bpy.data.images.load(P2(boss + '_a.png') if os.path.exists(P2(boss + '_a.png')) else P('art', 'refs', 'bosses3d', boss + '_a.png'), check_existing=True)
        w, h = im.size; a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); GL._REF[boss] = a.reshape(h, w, 4); GL._REF[boss + '_im'] = im
    return GL._REF[boss]

def sample_ref(boss, x, y, r=6):
    """The reference's mean colour (sRGB 0..1) round picture px (x, y) of the 1280 px square reference (y down) — to pick a material."""
    a = refload(boss); h = a.shape[0]
    q = a[max(0, h - 1 - y - r):h - y + r, max(0, x - r):x + r + 1]
    w = q[..., 3:4]; return tuple(((q[..., :3] * w).sum((0, 1)) / max(w.sum(), 1e-6)).round(3).tolist())
GL.sample_ref = sample_ref

# ---------------------------------------------------------------------------------------------------------------- skeleton
def skeleton(spec):
    """spec: {bone: (head (x, y, z), tail (x, y, z), parent or None)} — the rest pose = the reference's pose. Returns the armature ARM."""
    arm = bpy.data.objects.get('ARM')
    if arm: bpy.data.objects.remove(arm, do_unlink=True)
    ad = bpy.data.armatures.new('ARM'); arm = bpy.data.objects.new('ARM', ad); bpy.context.collection.objects.link(arm)
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, par) in spec.items():
        b = ad.edit_bones.new(name); b.head = h; b.tail = t
    for name, (h, t, par) in spec.items():
        if par: ad.edit_bones[name].parent = ad.edit_bones[par]; ad.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'
    arm.hide_render = True
    return arm

def bind(o, bone):
    """The part follows this bone rigidly."""
    o['bone'] = bone; return o

def body_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and o.display_type != 'WIRE']

# ---------------------------------------------------------------------------------------------------------------- camera
def fit_camera(boss, objs, start=None, n=128, iters=450):
    """The reference's camera fitted to the model's silhouette (Nelder–Mead on 1 − IoU): az (degrees from +X toward +Y: −90 = straight
    in front), el (above), roll, lens (mm), fw (frame width, units), sx / sy (frame shift)."""
    pts, _ = surface_points(objs, 50000); ref = ref_mask(boss, n)
    lo, hi = pts.min(0), pts.max(0); ctr = (lo + hi) / 2; size = float(np.linalg.norm(hi - lo))
    keys = ['az', 'el', 'roll', 'lens', 'fw', 'sx', 'sy']
    def cam_of(v): return dict(zip(keys, v), target=ctr.tolist())
    def cost(v):
        c = cam_of(v)
        if not (10 < c['lens'] < 600 and -15 < c['el'] < 70 and -200 < c['az'] < 20 and c['fw'] > 0.1): return 2.0
        return 1 - iou(silhouette(c, pts, n), ref)
    if start:
        v0 = np.array([start[k] for k in keys], float); v0[4] *= size / start.get('size', size)
        v, f = nelder_mead(cost, v0, [3, 2, 1, 10, size * 0.03, 0.01, 0.01], iters // 2)
        return dict(cam_of(v), size=size), 1 - f
    best = None
    for az in (-125, -90, -55):
        for el in (6, 22):
            v, f = nelder_mead(cost, np.array([az, el, 0, 80, size * 1.1, 0, 0], float), [15, 8, 4, 30, size * 0.2, 0.05, 0.05], iters // 3)
            if best is None or f < best[1]: best = (v, f)
    v, f = nelder_mead(cost, best[0], [4, 2, 1.5, 12, size * 0.05, 0.01, 0.01], iters)
    return dict(cam_of(v), size=size), 1 - f

def camera(boss, objs):
    camfile = P2(f'{boss}_cam.json'); start = json.load(open(camfile)) if os.path.exists(camfile) else None
    t0 = time.time()
    if start and start.get('lock'):
        c = start; pts, _ = surface_points(objs, 50000); s = iou(silhouette(c, pts, 128), ref_mask(boss, 128))
    else:
        c, s = fit_camera(boss, objs, start); json.dump(c, open(camfile, 'w'), indent=1)
    print(f'camera az {c["az"]:.1f} el {c["el"]:.1f} roll {c["roll"]:.1f} lens {c["lens"]:.0f} — silhouette IoU {s:.3f} ({time.time() - t0:.1f}s)')
    return c, s

# ---------------------------------------------------------------------------------------------------------------- one rigged mesh
def build_body(objs, arm):
    """Every part's modifiers applied, a vertex group per part (its bone, weight 1), all joined into BODY with an armature modifier."""
    for o in objs:
        assert o.get('bone') and o['bone'] in arm.data.bones, f'part {o.name} has no bone (bind(obj, bone)); bones: {[b.name for b in arm.data.bones]}'
        o['nomirror'] = True                                             # a character is not symmetric: hidden faces keep their material
        bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = o; o.select_set(True)
        for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        vg = o.vertex_groups.get(o['bone']) or o.vertex_groups.new(name=o['bone']); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    g = bake_ready(objs); g.name = 'BODY'; g.data.name = 'BODY'
    md = g.modifiers.new('arm', 'ARMATURE'); md.object = arm
    return g

def set_pose(arm, P):
    for pb in arm.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    for k, v in (P or {}).items():
        if k.startswith('loc:'): arm.pose.bones[k[4:]].location = v
        else: arm.pose.bones[k].rotation_euler = tuple(math.radians(a) for a in v)
    bpy.context.view_layer.update()

# ---------------------------------------------------------------------------------------------------------------- renders
def _shade(textured):
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'FLAT' if textured else 'STUDIO'; sh.color_type = 'TEXTURE' if textured else 'MATERIAL'
    sh.show_cavity = not textured; sh.cavity_type = 'BOTH'; sh.show_specular_highlight = False
    sc.display.render_aa = '32'; sc.render.film_transparent = True; sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.resolution_percentage = 100

def render_to(path, res, textured):
    _shade(textured); sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)

def load_rgba(path):
    im = bpy.data.images.load(path, check_existing=False); w, h = im.size; a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1]

def compare_sheet(boss, c, textured, res=520, tag=''):
    """art/bosses3d/out/<boss>_cmp.png: the reference | the model from its camera | silhouettes (white both, red model only, cyan
    reference only) | colour difference (where both are opaque; brighter = further off). Returns (IoU, mean colour error 0..1)."""
    os.makedirs(P2('out'), exist_ok=True); tmp = P2('out', f'_r_{boss}.png')
    place_camera(c, 'RefCam', res); render_to(tmp, res, textured); a = load_rgba(tmp); os.remove(tmp)
    ref = refload(boss)[::-1]; k = ref.shape[0] / res; ix = (np.arange(res) * k + k / 2).astype(int); r = ref[ix][:, ix]
    mm, rm = a[..., 3] > 0.5, r[..., 3] > 0.5
    sil = np.zeros((res, res, 4)); sil[..., 3] = 1; sil[mm & rm] = (1, 1, 1, 1); sil[mm & ~rm] = (1, 0.15, 0.15, 1); sil[~mm & rm] = (0.1, 0.9, 1, 1)
    both = mm & rm; err = np.abs(a[..., :3] - r[..., :3]).mean(-1); de = np.zeros((res, res, 4)); de[..., 3] = 1
    de[both, :3] = np.clip(err[both] * 3, 0, 1)[:, None]
    BG = (0.1, 0.11, 0.15)
    out = np.concatenate([over(r, BG), over(a, BG), sil, de], 1); save_png(out, P2('out', f'{boss}_cmp{tag}.png'))
    return iou(mm, rm), float(err[both].mean()) if both.any() else 1.0

def views_sheet(boss, objs, textured, res=360):
    """art/bosses3d/out/<boss>_views.png: the model from its left, right, back, above and two 3/4 views (lit) — a real body in 3D, not a card."""
    pts = np.array([v for o in objs for v in [o.matrix_world @ Vector(b) for b in o.bound_box]]); lo, hi = pts.min(0), pts.max(0); ctr = (lo + hi) / 2
    fw = float(np.linalg.norm(hi - lo)) * 1.0; tmp = P2('out', f'_v_{boss}.png'); row = []
    for i, (az, el) in enumerate([(0, 8), (180, 8), (90, 8), (-90, 70), (-40, 25), (-140, 25)]):
        view_cam('V%d' % i, az, el, ctr, fw); _shade(textured); sc = bpy.context.scene; sc.display.shading.light = 'STUDIO'
        sc.render.resolution_x = sc.render.resolution_y = res; sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
        row.append(over(load_rgba(tmp), (0.1, 0.11, 0.15)))
    os.remove(tmp); save_png(np.concatenate(row, 1), P2('out', f'{boss}_views.png'))

def anim_sheet(boss, arm, c, anims, pose_fn, textured, res=300, path=None):
    """Every animation in a row (at most 12 frames each, evenly picked), from the reference's camera: to judge the motion."""
    tmp = P2('out', f'_a_{boss}.png'); rows = []
    place_camera(c, 'RefCam', res)
    for name, A in anims.items():
        n = A['n']; pick = sorted(set(np.linspace(0, n - 1, min(n, 12)).round().astype(int).tolist())); row = []
        for i in pick:
            set_pose(arm, pose_fn(name, i, n)); render_to(tmp, res, textured); row.append(over(load_rgba(tmp), (0.1, 0.11, 0.15)))
        while len(row) < 12: row.append(np.concatenate([np.full((res, res, 3), 0.05), np.ones((res, res, 1))], -1))
        rows.append(np.concatenate(row, 1))
    set_pose(arm, {}); os.remove(tmp)
    save_png(np.concatenate(rows, 0), path or P2('out', f'{boss}_anims.png'))

def render_frames(boss, arm, c, anims, pose_fn, meta):
    """art/bosses3d/<boss>/frames/<anim>_<NN>.png (RES px, the reference's framing) + art/bosses3d/<boss>/meta.json."""
    d = P2(boss, 'frames'); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    place_camera(c, 'RefCam', RES)
    for name, A in anims.items():
        for i in range(A['n']):
            set_pose(arm, pose_fn(name, i, A['n'])); render_to(os.path.join(d, f'{name}_{i:02d}.png'), RES, True)
    set_pose(arm, {})
    # where the ground origin lands in a frame, the rest pose's height in px, px per unit at the origin
    uv = project(c, np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]))
    a = load_rgba(os.path.join(d, 'idle_00.png')) if 'idle' in anims else None
    ys = np.nonzero(a[..., 3].max(1) > 0.5)[0] if a is not None else np.array([0, RES - 1])
    info = dict(meta, boss=boss, res=RES, anchor=[float(uv[0, 0] * RES), float(uv[0, 1] * RES)], upx=float(np.hypot(*(uv[1] - uv[0])) * RES),
                height=int(ys.max() - ys.min() + 1), top=int(ys.min()), anims={k: dict(n=v['n'], loop=bool(v.get('loop')), fps=v.get('fps', 12)) for k, v in anims.items()})
    json.dump(info, open(P2(boss, 'meta.json'), 'w'), indent=1); print('frames', sum(v['n'] for v in anims.values()), '→', d)
    return info

# ---------------------------------------------------------------------------------------------------------------- texture
# Each part (bone) is painted from its own picture: the reference's pixels where that part shows from the reference's camera, and
# a smooth continuation of them (pull-push fill) where it does not — so the chest hidden behind an arm gets chest-coloured skin, not
# the arm, and a limb that swings away in an animation leaves no hole. All the parts' pictures sit side by side in one image PROJ;
# every corner is projected from the camera into its part's tile (front faces and back faces alike: a back face takes the front's
# colour there); corners hidden from the camera are shaded a little darker.
TILE = 640

def _down(a): h, w = a.shape[:2]; a = np.pad(a, [(0, h % 2), (0, w % 2)] + [(0, 0)] * (a.ndim - 2)); return a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]
def _up(a, shape):
    b = np.repeat(np.repeat(a, 2, 0), 2, 1)[:shape[0], :shape[1]]                          # nearest, then a 3×3 blur: smooth enough
    p = np.pad(b, [(1, 1), (1, 1)] + [(0, 0)] * (b.ndim - 2), mode='edge')
    return sum(p[i:i + shape[0], j:j + shape[1]] for i in range(3) for j in range(3)) / 9
def pullpush(rgb, m):
    """rgb H×W×3 filled outside the weight mask m (H×W, 0..1) with a smooth continuation of what is inside."""
    lv = [(rgb * m[..., None], m.astype(np.float64))]
    while min(lv[-1][1].shape) > 1: c, w = lv[-1]; lv.append((_down(c), _down(w)))
    F = lv[-1][0] / np.maximum(lv[-1][1], 1e-9)[..., None]
    for c, w in reversed(lv[:-1]):
        col = c / np.maximum(w, 1e-9)[..., None]; a = np.minimum(w, 1)[..., None]; F = col * a + _up(F, w.shape) * (1 - a)
    return F

def id_map(objs, bones, c, res):
    """Which part shows at each px of the reference's camera (−1: none): a flat render, the part's bone index in the red channel."""
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'FLAT'; sh.color_type = 'OBJECT'; sh.show_cavity = False; sh.show_specular_highlight = False
    sc.display.render_aa = 'OFF'; sc.render.film_transparent = True; sc.view_settings.view_transform = 'Raw'
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    for o in objs: o.color = ((bones.index(o['bone']) + 1) * 8 / 255, 0, 0, 1)
    place_camera(c, 'RefCam', res); tmp = P2('out', '_id.png'); sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
    a = load_rgba(tmp); os.remove(tmp); sc.view_settings.view_transform = 'Standard'
    ids = np.round(a[..., 0] * 255 / 8).astype(int) - 1; ids[a[..., 3] < 0.5] = -1; return ids

def proj_tiles(boss, objs, c):
    """PROJ (one tile per bone) + {bone: (col, row)}, cols, rows."""
    bones = sorted({o['bone'] for o in objs}); ids = id_map(objs, bones, c, TILE)
    ref = refload(boss)[::-1]; k = ref.shape[0] // TILE; r = ref[:TILE * k, :TILE * k].reshape(TILE, k, TILE, k, 4).mean((1, 3))   # box-down to TILE
    ra = r[..., 3] > 0.5; rgb = r[..., :3] / np.maximum(r[..., 3:4], 1e-6)                    # un-premultiplied colour
    body = pullpush(rgb, ra.astype(float))
    cols = int(math.ceil(math.sqrt(len(bones)))); rows = int(math.ceil(len(bones) / cols)); big = np.ones((rows * TILE, cols * TILE, 4))
    where = {}
    for i, b in enumerate(bones):
        m = (ids == i) & ra
        mm = m.copy(); mm[1:] &= m[:-1]; mm[:-1] &= m[1:]; mm[:, 1:] &= m[:, :-1]; mm[:, :-1] &= m[:, 1:]   # in by 1 px: no neighbour's fringe
        if mm.sum() < 30: mm = m
        t = pullpush(rgb, mm.astype(float)) if mm.sum() >= 30 else body
        cx, cy = i % cols, i // cols; big[cy * TILE:(cy + 1) * TILE, cx * TILE:(cx + 1) * TILE, :3] = t; where[b] = (cx, cy)
        print(f'  part {b}: {int(m.sum())} px shown')
    im = bpy.data.images.get('PROJ') or bpy.data.images.new('PROJ', cols * TILE, rows * TILE, alpha=False)
    if tuple(im.size) != (cols * TILE, rows * TILE): im.scale(cols * TILE, rows * TILE)
    im.pixels.foreach_set(np.ascontiguousarray(np.clip(big[::-1], 0, 1)).astype(np.float32).ravel())
    return dict(img=im, where=where, cols=cols, rows=rows)

def proj_uv(boss, g, c, T):
    """UV map ProjUV (each corner in its part's tile) and per-corner visibility projw."""
    me = g.data; pos, f, right, up, dist = cam_basis(c)
    names = [vg.name for vg in g.vertex_groups]; vb = np.zeros(len(me.vertices), np.int64)
    for v in me.vertices: vb[v.index] = v.groups[0].group if len(v.groups) else 0
    lp = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lp)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    lf = np.empty(len(me.loops), np.int64)
    for p in me.polygons: lf[p.loop_start:p.loop_start + p.loop_total] = p.index
    fv = np.array([p.vertices[0] for p in me.polygons]); fb = vb[fv]                       # a face's part: its first corner's
    uv = project(c, co[lp]); tx = np.array([T['where'][names[b]][0] for b in fb])[lf]; ty = np.array([T['where'][names[b]][1] for b in fb])[lf]
    U = (tx + np.clip(uv[:, 0], 0, 1)) / T['cols']; V = 1 - (ty + np.clip(uv[:, 1], 0, 1)) / T['rows']
    lay = me.uv_layers.get('ProjUV') or me.uv_layers.new(name='ProjUV'); lay.data.foreach_set('uv', np.stack([U, V], 1).astype(np.float32).ravel())
    # visibility: a ray from the camera to each corner (a little in from it, just off its face)
    bm = bmesh.new(); bm.from_mesh(me); bvh = BVHTree.FromBMesh(bm)
    cen = np.empty(len(me.polygons) * 3); nor = np.empty(len(me.polygons) * 3); me.polygons.foreach_get('center', cen); me.polygons.foreach_get('normal', nor)
    cen = cen.reshape(-1, 3)[lf]; nor = nor.reshape(-1, 3)[lf]; camp = np.array(pos); q = co[lp]
    probe = q + (cen - q) * 0.04 + nor * 0.0006; v = camp - probe; fac = (nor * v / np.linalg.norm(v, axis=1)[:, None]).sum(1)
    vis = np.zeros(len(q), np.float32); cam = Vector(camp)
    for i in np.nonzero(fac > 0.02)[0]:
        d = probe[i] - camp; dl = float(np.linalg.norm(d)); hit = bvh.ray_cast(cam, Vector(d / dl), dl + 0.01)
        if hit[0] is None or hit[3] >= dl - 0.0025: vis[i] = 1.0
    bm.free()
    a = me.attributes.get('projw') or me.attributes.new('projw', 'FLOAT', 'CORNER'); a.data.foreach_set('value', vis)
    return float(vis.mean())

def bake_char(g, proj, size=2048):
    """The atlas on UVMap: every corner's colour from PROJ; hidden from the camera: 18 % darker."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.use_denoising = False
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'CUDA'; pr.get_devices()
        for d in pr.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception: pass
    img = bpy.data.images.get('ATLAS') or bpy.data.images.new('ATLAS', size, size, alpha=False)
    for m in g.data.materials:
        nt = m.node_tree; N = nt.nodes; L = nt.links
        for n in [n for n in N if n.name.startswith('bk_')]: N.remove(n)
        def node(t, name, x, y): n = N.new(t); n.name = 'bk_' + name; n.location = (x, y); return n
        out = node('ShaderNodeOutputMaterial', 'out', 900, 0); out.target = 'CYCLES'; em = node('ShaderNodeEmission', 'em', 700, 0)
        uvp = node('ShaderNodeUVMap', 'uvp', -400, 300); uvp.uv_map = 'ProjUV'
        tex = node('ShaderNodeTexImage', 'proj', -150, 300); tex.image = proj; tex.interpolation = 'Cubic'; tex.extension = 'EXTEND'; L.new(uvp.outputs[0], tex.inputs[0])
        pw = node('ShaderNodeAttribute', 'pw', -150, 0); pw.attribute_name = 'projw'
        sh = node('ShaderNodeMapRange', 'sh', 100, 0); sh.inputs['To Min'].default_value = 0.82; L.new(pw.outputs['Fac'], sh.inputs['Value'])
        mul = node('ShaderNodeMixRGB', 'mul', 400, 200); mul.blend_type = 'MULTIPLY'; mul.inputs['Fac'].default_value = 1
        L.new(tex.outputs['Color'], mul.inputs[1]); L.new(sh.outputs[0], mul.inputs[2])
        L.new(mul.outputs[0], em.inputs['Color']); L.new(em.outputs[0], out.inputs['Surface'])
        tgt = node('ShaderNodeTexImage', 'atlas', 900, -300); tgt.image = img; N.active = tgt
        for n in N: n.select = False
        tgt.select = True
    g.data.uv_layers.active = g.data.uv_layers['UVMap']
    bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); bpy.context.view_layer.objects.active = g
    t0 = time.time(); bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True); print(f'baked {size}px in {time.time() - t0:.1f}s')
    return img

# ---------------------------------------------------------------------------------------------------------------- turntable
def turntable(boss, arm, c, anims, pose_fn, n=24, res=480):
    """art/bosses3d/<boss>/turn/: the textured model alone, the camera orbiting it at the reference's elevation — rest pose
    (rest_NN.png, n angles) and the walk seen from the front, the side and the back (walk<az>_NN.png) — to see the real 3D body."""
    d = P2(boss, 'turn'); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for k in range(n):
        place_camera(dict(c, az=c['az'] + k * 360 / n), 'RefCam', res); set_pose(arm, pose_fn('idle', 0, anims['idle']['n']) if 'idle' in anims else {})
        render_to(os.path.join(d, f'rest_{k:02d}.png'), res, True)
    if 'walk' in anims:
        for az in (0, 90, 180):
            place_camera(dict(c, az=c['az'] + az), 'RefCam', res)
            for i in range(anims['walk']['n']): set_pose(arm, pose_fn('walk', i, anims['walk']['n'])); render_to(os.path.join(d, f'walk{az:03d}_{i:02d}.png'), res, True)
    set_pose(arm, {}); print('turntable', n, 'angles →', d)

# ================================================================================================================ REAL 3D (v2)
# The bosses are real 3D models: real materials (procedural shader nodes: colour variation, blotches, veins, weave, wear, bump),
# lit and rendered — the reference picture is NEVER painted onto the model; it is only the target the renders are compared with
# (and the source of colours picked with sample_ref). The game draws the model itself (live/charmesh.js): the mesh skinned to
# its skeleton, every animation, turned to face where it goes, lit by the game's light.
#   look  — a lit Cycles render from the reference's camera next to the reference (art/bosses3d/out/<boss>_look.png: reference |
#           render | silhouettes | colour difference of the blurred images) + the model lit from 6 sides (<boss>_look_views.png).
#           Prints IoU and the colour error (mean |Δ| of the blurred images where both are opaque, 0..1).
#   anim3 — every animation seen from the front, the side and the back (<boss>_anims3.png), solid shading: motion from all sides.
#   game  — the mesh, its skeleton, every animation and its baked colour atlas into the game (live/assets/c_<boss>.bin / .jpg /
#           .json, live/bosses3d.js); `full` = look + game.
LOOK = dict(key=(-0.55, -0.55, 0.62), key_col=(1.0, 0.86, 0.7), key_e=3.2, fill=(0.8, -0.3, 0.25), fill_col=(0.62, 0.66, 0.9), fill_e=0.9,
            rim=(0.3, 0.9, 0.5), rim_col=(1.0, 0.8, 0.6), rim_e=2.2, amb=(0.32, 0.3, 0.36), amb_e=1.0, exposure=0.0)
def set_look(**kw):
    """The lighting of the look renders (directions from the model toward the light, Blender axes: +X the character's left, −Y toward
    the viewer, +Z up): tune it to the reference's light (where the highlights and shadows fall) — it is not used by the game."""
    LOOK.update(kw)

def _node(N, t, x=0, y=0, **inp):
    n = N.new(t); n.location = (x, y)
    for k, v in inp.items():
        if k in n.inputs: n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n

def pmat(name, base, dark=None, light=None, kind='noise', scale=8.0, detail=6.0, rough=0.6, metal=0.0, spec=0.3, bump=0.25,
         accent=None, accent_amt=0.0, accent_scale=4.0, emit=0.0, wear=0.0, coords='Object'):
    """A real material (procedural; sRGB colours 0..1, pick them with sample_ref). kind:
      'noise'    colour varies between dark, base and light by a fractal noise (any surface);
      'skin'     + blotches (accent: bruises / rot) and a network of fine veins (accent) — zombie skin;
      'cloth'    + a woven grain and dirt toward dark; 'leather' + fine creases and scuffs toward light (wear);
      'metal'    metallic, with rust patches (accent) and scratches; 'rubber' dull, fine grain;
      'mushroom' a cap: spots (light) and a darker rim; 'slime' glowing (accent / emit), wet;
      'hair'     streaks along the strands (use on hair meshes).
    scale: the pattern's size (bigger = finer, per model unit); bump: relief strength; wear: lighter worn edges (0..1)."""
    m = bpy.data.materials.get('M_' + name) or bpy.data.materials.new('M_' + name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    for n in list(N): N.remove(n)
    dark = dark or tuple(c * 0.6 for c in base); light = light or tuple(min(1, c * 1.25 + 0.03) for c in base)
    out = _node(N, 'ShaderNodeOutputMaterial', 1300, 0); bs = _node(N, 'ShaderNodeBsdfPrincipled', 1000, 0)
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    L.new(bs.outputs[0], out.inputs['Surface'])
    tc = _node(N, 'ShaderNodeTexCoord', -1200, 0); mp = _node(N, 'ShaderNodeMapping', -1000, 0); mp.inputs['Scale'].default_value = (scale, scale, scale)
    L.new(tc.outputs[coords], mp.inputs['Vector']); V = mp.outputs['Vector']
    nz = _node(N, 'ShaderNodeTexNoise', -800, 200, Detail=detail, Roughness=0.58); L.new(V, nz.inputs['Vector'])
    ramp = _node(N, 'ShaderNodeValToRGB', -560, 200); e = ramp.color_ramp.elements
    e[0].position, e[1].position = 0.3, 0.7; e[0].color = (*lin(dark), 1); e[1].color = (*lin(light), 1)
    mid = e.new(0.5); mid.color = (*lin(base), 1)
    L.new(nz.outputs['Fac'], ramp.inputs['Fac']); col = ramp.outputs['Color']
    height = nz.outputs['Fac']
    def mix(a, b, fac, blend='MIX'):
        n = _node(N, 'ShaderNodeMixRGB', 0, 0); n.blend_type = blend
        if isinstance(fac, float): n.inputs['Fac'].default_value = fac
        else: L.new(fac, n.inputs['Fac'])
        (L.new(a, n.inputs[1]) if not isinstance(a, tuple) else setattr(n.inputs[1], 'default_value', (*lin(a), 1)))
        (L.new(b, n.inputs[2]) if not isinstance(b, tuple) else setattr(n.inputs[2], 'default_value', (*lin(b), 1)))
        return n.outputs[0]
    def mr(sock, a, b, c=0.0, d=1.0):
        n = _node(N, 'ShaderNodeMapRange', 0, 0); n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d; L.new(sock, n.inputs['Value']); return n.outputs[0]
    acc = accent or dark
    if kind == 'skin':
        bl = _node(N, 'ShaderNodeTexNoise', -800, -150, Detail=3.0); mpb = _node(N, 'ShaderNodeMapping', -1000, -150); mpb.inputs['Scale'].default_value = (accent_scale,) * 3
        L.new(tc.outputs[coords], mpb.inputs['Vector']); L.new(mpb.outputs['Vector'], bl.inputs['Vector'])
        col = mix(col, acc, mr(bl.outputs['Fac'], 0.58, 0.75, 0, accent_amt or 0.6))
        vo = _node(N, 'ShaderNodeTexVoronoi', -800, -400); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = scale * 1.6; L.new(V, vo.inputs['Vector'])
        veins = mr(vo.outputs['Distance'], 0.0, 0.035, 0.35, 0.0); col = mix(col, acc, veins)
        height = mr(nz.outputs['Fac'], 0, 1, 0, 1)
    elif kind == 'cloth':
        wv = _node(N, 'ShaderNodeTexWave', -800, -150, Scale=scale * 6, Distortion=2.0, Detail=1.0); L.new(V, wv.inputs['Vector'])
        col = mix(col, dark, mr(wv.outputs['Fac'], 0.2, 0.9, 0.0, 0.18))
        dirt = _node(N, 'ShaderNodeTexNoise', -800, -400, Scale=1.5, Detail=4.0); L.new(V, dirt.inputs['Vector'])
        col = mix(col, acc, mr(dirt.outputs['Fac'], 0.55, 0.75, 0, accent_amt or 0.35)); height = wv.outputs['Fac']
    elif kind == 'leather':
        cr = _node(N, 'ShaderNodeTexVoronoi', -800, -150); cr.feature = 'DISTANCE_TO_EDGE'; cr.inputs['Scale'].default_value = scale * 2.5; L.new(V, cr.inputs['Vector'])
        col = mix(col, dark, mr(cr.outputs['Distance'], 0.0, 0.05, 0.45, 0.0)); height = cr.outputs['Distance']
    elif kind == 'metal':
        bs.inputs['Metallic'].default_value = max(metal, 0.7)
        rs = _node(N, 'ShaderNodeTexNoise', -800, -150, Scale=accent_scale, Detail=8.0); L.new(V, rs.inputs['Vector'])
        rust = mr(rs.outputs['Fac'], 0.5, 0.62, 0, accent_amt or 0.8); col = mix(col, acc, rust)
        mm = _node(N, 'ShaderNodeMath', 700, -200, operation='SUBTRACT'); mm.inputs[0].default_value = max(metal, 0.7); L.new(rust, mm.inputs[1]); L.new(mm.outputs[0], bs.inputs['Metallic'])
    elif kind == 'rubber':
        bs.inputs['Roughness'].default_value = max(rough, 0.75)
    elif kind == 'mushroom':
        gz = _node(N, 'ShaderNodeSeparateXYZ', -800, -150); L.new(tc.outputs['Generated'], gz.inputs[0])
        col = mix(col, dark, mr(gz.outputs['Z'], 0.0, 0.55, 0.7, 0.0))
        sp = _node(N, 'ShaderNodeTexVoronoi', -800, -400); sp.inputs['Scale'].default_value = scale * 1.5; L.new(V, sp.inputs['Vector'])
        col = mix(col, light, mr(sp.outputs['Distance'], 0.0, 0.12, accent_amt or 0.6, 0.0))
    elif kind == 'slime':
        bs.inputs['Roughness'].default_value = min(rough, 0.2)
        try: bs.inputs['Coat Weight'].default_value = 0.6
        except KeyError: pass
        bs.inputs['Emission Color'].default_value = (*lin(acc), 1); bs.inputs['Emission Strength'].default_value = emit or 1.5
    elif kind == 'hair':
        hw = _node(N, 'ShaderNodeTexWave', -800, -150, Scale=scale * 4, Distortion=6.0, Detail=3.0); hw.wave_type = 'BANDS'; L.new(V, hw.inputs['Vector'])
        col = mix(col, dark, mr(hw.outputs['Fac'], 0.3, 0.9, 0, 0.5)); height = hw.outputs['Fac']
    if wear > 0:
        gm = _node(N, 'ShaderNodeNewGeometry', -800, -600); col = mix(col, light, mr(gm.outputs['Pointiness'], 0.5, 0.58, 0, wear))
    if emit and kind != 'slime':
        bs.inputs['Emission Color'].default_value = (*lin(acc), 1); bs.inputs['Emission Strength'].default_value = emit
    L.new(col, bs.inputs['Base Color'])
    if bump > 0:
        bp = _node(N, 'ShaderNodeBump', 700, -300, Strength=bump, Distance=0.004); L.new(height, bp.inputs['Height']); L.new(bp.outputs['Normal'], bs.inputs['Normal'])
    m['srgb'] = list(base); m['spec'] = spec; m.diffuse_color = (*lin(base), 1)
    return m

# ---------------------------------------------------------------- lit renders and the look check
def _cycles(samples=48):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'CUDA'; pr.get_devices()
        for d in pr.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception: pass
    sc.render.film_transparent = True; sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = LOOK['exposure']
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.resolution_percentage = 100

def look_rig(target=(0, 0, 0.5)):
    """The look lights (LOOK): a warm key, a cool fill, a rim, and an ambient world."""
    for o in [o for o in bpy.data.objects if o.name.startswith('LK_')]: bpy.data.objects.remove(o, do_unlink=True)
    for nm, dk, ck, ek in (('key', 'key', 'key_col', 'key_e'), ('fill', 'fill', 'fill_col', 'fill_e'), ('rim', 'rim', 'rim_col', 'rim_e')):
        ld = bpy.data.lights.new('LK_' + nm, 'SUN'); ld.energy = LOOK[ek]; ld.color = LOOK[ck]; ld.angle = math.radians(12)
        o = bpy.data.objects.new('LK_' + nm, ld); bpy.context.collection.objects.link(o)
        d = Vector(LOOK[dk]).normalized(); o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    w = bpy.data.worlds.get('LOOK') or bpy.data.worlds.new('LOOK'); w.use_nodes = True; bpy.context.scene.world = w
    bg = w.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (*lin(LOOK['amb']), 1); bg.inputs['Strength'].default_value = LOOK['amb_e']

def look_render(path, res, c, samples=48):
    _cycles(samples); place_camera(c, 'RefCam', res); sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); return load_rgba(path)

def _blur(a, s):
    from math import ceil
    r = int(ceil(s * 2.5)); x = np.arange(-r, r + 1); k = np.exp(-x * x / (2 * s * s)); k /= k.sum()
    out = a.copy()
    for ax in (0, 1): out = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode='edge'), k, 'valid'), ax, out)
    return out

def look_sheet(boss, c, res=520):
    """reference | lit render | silhouettes | colour difference (blurred, brighter = further off) → (IoU, colour error)."""
    os.makedirs(P2('out'), exist_ok=True); tmp = P2('out', f'_l_{boss}.png'); a = look_render(tmp, res, c); os.remove(tmp)
    ref = refload(boss)[::-1]; k = ref.shape[0] / res; ix = (np.arange(res) * k + k / 2).astype(int); r = ref[ix][:, ix]
    mm, rm = a[..., 3] > 0.5, r[..., 3] > 0.5; both = mm & rm
    sil = np.zeros((res, res, 4)); sil[..., 3] = 1; sil[mm & rm] = (1, 1, 1, 1); sil[mm & ~rm] = (1, 0.15, 0.15, 1); sil[~mm & rm] = (0.1, 0.9, 1, 1)
    s = res / 130                                                                    # blur: the colour of regions, not of pixels
    def bl(img):
        pm = np.stack([_blur(img[..., i] * img[..., 3], s) for i in range(3)], -1); al = _blur(img[..., 3], s)[..., None]
        return pm / np.maximum(al, 1e-3)
    ab, rb = bl(a), bl(r); err = np.abs(ab - rb).mean(-1); de = np.zeros((res, res, 4)); de[..., 3] = 1; de[both, :3] = np.clip(err[both] * 3, 0, 1)[:, None]
    BG = (0.1, 0.11, 0.15); save_png(np.concatenate([over(r, BG), over(a, BG), sil, de], 1), P2('out', f'{boss}_look.png'))
    return iou(mm, rm), float(err[both].mean()) if both.any() else 1.0

def look_views(boss, c, res=400, n=6):
    """The model lit, the camera orbiting it at the reference's height: a real body from every side."""
    tmp = P2('out', f'_lv_{boss}.png'); row = []
    for k in range(n): row.append(over(look_render(tmp, res, dict(c, az=c['az'] + k * 360 / n), 24), (0.1, 0.11, 0.15)))
    os.remove(tmp); save_png(np.concatenate(row, 1), P2('out', f'{boss}_look_views.png'))

def anim3_sheet(boss, arm, c, anims, pose_fn, res=220):
    """Every animation (≤ 10 frames each) from the front, the side and the back (rows), solid shading: the motion from all sides."""
    tmp = P2('out', f'_a3_{boss}.png'); rows = []
    for name, A in anims.items():
        n = A['n']; pick = sorted(set(np.linspace(0, n - 1, min(n, 10)).round().astype(int).tolist()))
        for az in (0, 90, 180):
            row = []
            place_camera(dict(c, az=c['az'] + az), 'RefCam', res)
            for i in pick: set_pose(arm, pose_fn(name, i, n)); render_to(tmp, res, False); row.append(over(load_rgba(tmp), (0.1, 0.11, 0.15)))
            while len(row) < 10: row.append(np.concatenate([np.full((res, res, 3), 0.05), np.ones((res, res, 1))], -1))
            rows.append(np.concatenate(row, 1))
    set_pose(arm, {}); os.remove(tmp); save_png(np.concatenate(rows, 0), P2('out', f'{boss}_anims3.png'))

# ---------------------------------------------------------------- an imported model
def import_model(path, height=1.0, turn=0.0):
    """A finished model (GLB / GLTF / FBX / OBJ, e.g. from a 3D generator) as the boss's body: its meshes joined into one, the
    transforms applied, scaled to `height` units tall, the feet on z = 0, centred on x = 0, y = 0, turned `turn` degrees about Z
    (a glTF model faces −Y once imported: turn 0). Its own materials and textures are kept (the game export bakes them). Returns it."""
    ext = os.path.splitext(path)[1].lower(); before = set(bpy.data.objects)
    if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=path)
    elif ext == '.obj': bpy.ops.wm.obj_import(filepath=path)
    else: raise ValueError('unknown model format ' + ext)
    new = [o for o in bpy.data.objects if o not in before]; meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type != 'MESH': o.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:                                                                 # parents (glTF nodes) baked into the meshes
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    if len(meshes) > 1: bpy.ops.object.join()
    g = bpy.context.view_layer.objects.active; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o.name in bpy.data.objects and o != g and o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
    v = np.empty(len(g.data.vertices) * 3); g.data.vertices.foreach_get('co', v); v = v.reshape(-1, 3)
    lo, hi = v.min(0), v.max(0); k = height / max(hi[2] - lo[2], 1e-6); c = (lo + hi) / 2
    R = Matrix.Rotation(math.radians(turn), 4, 'Z')
    g.data.transform(R @ Matrix.Scale(k, 4) @ Matrix.Translation((-c[0], -c[1], -lo[2]))); g.data.update()
    g.name = 'IMPORTED'; print(f'imported {os.path.basename(path)}: {len(g.data.polygons)} faces, {len(g.data.materials)} materials, scaled ×{k:.4f}')
    return g

# ---------------------------------------------------------------- into the game
MAXTRI = 70000

def bake_albedo(g, size=2048):
    """The atlas on UVMap: each material's own base colour (whatever drives its Principled BSDF's Base Color) × baked ambient
    occlusion × the relief of its bump (a shade from the bumped normal), as emission — the game lights it."""
    _cycles(16); sc = bpy.context.scene; sc.cycles.use_denoising = False
    img = bpy.data.images.get('ALB') or bpy.data.images.new('ALB', size, size, alpha=False)
    for m in g.data.materials:
        nt = m.node_tree; N = nt.nodes; L = nt.links
        for n in [n for n in N if n.name.startswith('bk_')]: N.remove(n)
        bsdf = next((n for n in N if n.type == 'BSDF_PRINCIPLED'), None); out = next((n for n in N if n.type == 'OUTPUT_MATERIAL'), None)
        def node(t, nm, **kw): n = _node(N, t, 0, -900, **kw); n.name = 'bk_' + nm; return n
        emi = node('ShaderNodeEmission', 'em'); o2 = node('ShaderNodeOutputMaterial', 'out'); o2.target = 'CYCLES'
        if bsdf is None: emi.inputs['Color'].default_value = m.diffuse_color; base = None
        else:
            bi = bsdf.inputs['Base Color']; base = bi.links[0].from_socket if bi.links else None
        ao = node('ShaderNodeAmbientOcclusion', 'ao', samples=16); ao.inputs['Distance'].default_value = 0.05
        aom = node('ShaderNodeMapRange', 'aom'); aom.inputs['To Min'].default_value = 0.8 if any(n.type == 'TEX_IMAGE' for n in N) else 0.5; L.new(ao.outputs['AO'], aom.inputs['Value'])
        m1 = node('ShaderNodeMixRGB', 'm1'); m1.blend_type = 'MULTIPLY'; m1.inputs['Fac'].default_value = 1
        if base is not None: L.new(base, m1.inputs[1])
        elif bsdf is not None: m1.inputs[1].default_value = bsdf.inputs['Base Color'].default_value
        else: m1.inputs[1].default_value = m.diffuse_color
        L.new(aom.outputs[0], m1.inputs[2]); res_sock = m1.outputs[0]
        if bsdf is not None and bsdf.inputs['Normal'].links:                    # the bump's relief as a shade
            geo = node('ShaderNodeNewGeometry', 'geo'); dp = node('ShaderNodeVectorMath', 'dp', operation='DOT_PRODUCT')
            L.new(bsdf.inputs['Normal'].links[0].from_socket, dp.inputs[0]); L.new(geo.outputs['Normal'], dp.inputs[1])
            sh = node('ShaderNodeMapRange', 'sh'); sh.inputs['From Min'].default_value = 0.7; sh.inputs['To Min'].default_value = 0.72
            L.new(dp.outputs['Value'], sh.inputs['Value'])
            m2 = node('ShaderNodeMixRGB', 'm2'); m2.blend_type = 'MULTIPLY'; m2.inputs['Fac'].default_value = 1; L.new(res_sock, m2.inputs[1]); L.new(sh.outputs[0], m2.inputs[2]); res_sock = m2.outputs[0]
        if bsdf is not None and bsdf.inputs['Emission Strength'].default_value > 0:     # glow: kept as brighter colour
            ec = bsdf.inputs['Emission Color']; ad = node('ShaderNodeMixRGB', 'ad'); ad.blend_type = 'ADD'; ad.inputs['Fac'].default_value = min(1, bsdf.inputs['Emission Strength'].default_value * 0.35)
            L.new(res_sock, ad.inputs[1]); (L.new(ec.links[0].from_socket, ad.inputs[2]) if ec.links else setattr(ad.inputs[2], 'default_value', ec.default_value)); res_sock = ad.outputs[0]
        L.new(res_sock, emi.inputs['Color']); L.new(emi.outputs[0], o2.inputs['Surface'])
        if out: out.is_active_output = False
        o2.is_active_output = True
        tgt = node('ShaderNodeTexImage', 'tgt'); tgt.image = img; N.active = tgt
        for n in N: n.select = False
        tgt.select = True
    g.data.uv_layers.active = g.data.uv_layers['UVMap']
    bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); bpy.context.view_layer.objects.active = g
    t0 = time.time(); bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True); print(f'albedo baked {size}px in {time.time() - t0:.1f}s')
    for m in g.data.materials:                                                      # the materials' own outputs back
        N = m.node_tree.nodes; o2 = N.get('bk_out')
        if o2: o2.is_active_output = False
        for n in N:
            if n.type == 'OUTPUT_MATERIAL' and not n.name.startswith('bk_'): n.is_active_output = True
    return img

def _game_frame(Mx):
    C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))       # Blender (X, Y, Z) → game (x, y up, z toward the viewer) = (X, Z, −Y)
    return C @ Mx @ C.inverted()

def export_game(boss, g, arm, anims, pose_fn, meta, atlas=2048):
    """live/assets/c_<boss>.bin (mesh + skin), c_<boss>.jpg (colour), c_<boss>.json (skeleton, every animation's skin matrices),
    window.BOSS3D[boss] in live/bosses3d.js (height, stride, animations, impacts)."""
    me = g.data; tri = sum(len(p.vertices) - 2 for p in me.polygons)
    bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); bpy.context.view_layer.objects.active = g
    if tri > MAXTRI:                                                                   # lighter for the game: collapse, keeping the groups
        dm = g.modifiers.new('dec', 'DECIMATE'); dm.ratio = MAXTRI / tri
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0); bpy.ops.object.modifier_apply(modifier='dec')
    # an imported model (a GLB with its own textures): its UVs stay as SrcUV, its image textures read them explicitly, and a new
    # atlas layout UVMap is made for the bake (procedural materials read object coordinates and do not care)
    imgs = [n for m in me.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    if imgs and len(me.uv_layers) and 'SrcUV' not in me.uv_layers:
        src = me.uv_layers.active or me.uv_layers[0]; src.name = 'SrcUV'
        for m in me.materials:
            if not (m and m.use_nodes): continue
            for n in [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']:
                if not n.inputs['Vector'].links: u = m.node_tree.nodes.new('ShaderNodeUVMap'); u.uv_map = 'SrcUV'; m.node_tree.links.new(u.outputs[0], n.inputs['Vector'])
        print(f'imported textures: {len(imgs)} image(s) read through SrcUV')
    if 'UVMap' not in me.uv_layers: me.uv_layers.new(name='UVMap')
    me.uv_layers.active = me.uv_layers['UVMap']
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.5, scale_to_bounds=True); bpy.ops.object.mode_set(mode='OBJECT')
    set_pose(arm, {}); img = bake_albedo(g, atlas)
    bones = [b.name for b in arm.data.bones]; bix = {n: i for i, n in enumerate(bones)}
    gi = {vg.index: bix.get(vg.name, -1) for vg in g.vertex_groups}
    me.calc_loop_triangles()
    nv = len(me.vertices); co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    W4 = np.zeros((nv, 4), np.float32); I4 = np.zeros((nv, 4), np.int64); root = bix.get('root', 0)
    for v in me.vertices:
        gs = sorted([(x.weight, gi.get(x.group, -1)) for x in v.groups if gi.get(x.group, -1) >= 0 and x.weight > 1e-4], reverse=True)[:4]
        if not gs: gs = [(1.0, root)]
        s = sum(w for w, _ in gs)
        for k, (w, b) in enumerate(gs): W4[v.index, k] = w / s; I4[v.index, k] = b
    nl = len(me.loops); lv = np.empty(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
    try: cn = np.array([n.vector[:] for n in me.corner_normals])
    except Exception: cn = np.empty(nl * 3); me.loops.foreach_get('normal', cn); cn = cn.reshape(-1, 3)
    uv = np.empty(nl * 2); me.uv_layers['UVMap'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    mi = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get('material_index', mi)
    spec = np.array([float(m.get('spec', 0.3)) for m in me.materials] or [0.3])
    lt = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('loops', lt)
    tp = np.empty(len(me.loop_triangles), np.int64); me.loop_triangles.foreach_get('polygon_index', tp); lpoly = np.repeat(tp, 3)
    Gv = lambda a: np.stack([a[:, 0], a[:, 2], -a[:, 1]], -1)
    P3 = Gv(co[lv[lt]]); N3 = Gv(cn[lt]); U2 = uv[lt]; SP = spec[mi[lpoly]]; BI = I4[lv[lt]]; BW = W4[lv[lt]]
    key = np.concatenate([np.round(P3, 5), np.round(N3, 3), np.round(U2, 5)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P3, N3, U2, SP, BI, BW = P3[first], N3[first], U2[first], SP[first], BI[first], BW[first]; idx = inv.astype(np.uint32).ravel()
    n = len(P3); rec = np.zeros(n, dtype=[('p', '<f4', 3), ('n', 'i1', 3), ('s', 'u1'), ('uv', '<u2', 2), ('bi', 'u1', 4), ('bw', 'u1', 4), ('pad', 'u1', 4)])
    rec['p'] = P3; nn = N3 / np.maximum(np.linalg.norm(N3, axis=1, keepdims=True), 1e-9); rec['n'] = np.round(nn * 127).astype(np.int8)
    rec['s'] = np.round(SP * 255).astype(np.uint8); rec['uv'] = np.round(np.clip(U2, 0, 1) * 65535).astype(np.uint16)
    rec['bi'] = BI.astype(np.uint8); bw = np.round(BW * 255); bw[:, 0] += 255 - bw.sum(1); rec['bw'] = np.clip(bw, 0, 255).astype(np.uint8)
    lo, hi = P3.min(0), P3.max(0)
    with open(P('live', 'assets', f'c_{boss}.bin'), 'wb') as fh:
        fh.write(b'CHR1'); fh.write(struct.pack('<III', n, len(idx), len(bones))); fh.write(struct.pack('<6f', *lo, *hi)); fh.write(rec.tobytes()); fh.write(idx.tobytes())
    st = bpy.context.scene.render.image_settings; st.file_format = 'JPEG'; st.color_mode = 'RGB'; st.quality = 88
    img.save_render(P('live', 'assets', f'c_{boss}.jpg'))
    # every animation: per frame, per bone the skin matrix (posed × rest⁻¹, model space, the game's axes), 3 rows of 4
    AW = arm.matrix_world; AWi = AW.inverted(); rest = {b.name: b.matrix_local.inverted() for b in arm.data.bones}
    A = {}; err = 0.0
    for name, an in anims.items():
        fr = []
        for i in range(an['n']):
            set_pose(arm, pose_fn(name, i, an['n'])); bpy.context.view_layer.update()
            row = []
            for b in bones:
                Mx = _game_frame(AW @ arm.pose.bones[b].matrix @ rest[b] @ AWi)
                row += [round(Mx[r][c2], 5) for r in range(3) for c2 in range(4)]
            fr.append(row)
        A[name] = dict(n=an['n'], loop=bool(an.get('loop')), fps=an.get('fps', 12), m=fr)
    # self-check: the skinned rest vertices of one posed frame against Blender's own deformation
    name = next(iter(anims)); i = anims[name]['n'] // 2; set_pose(arm, pose_fn(name, i, anims[name]['n'])); bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); ev = g.evaluated_get(dg).to_mesh(); pc = np.empty(len(ev.vertices) * 3); ev.vertices.foreach_get('co', pc); pc = Gv(pc.reshape(-1, 3)); g.evaluated_get(dg).to_mesh_clear()
    Mf = np.array(A[name]['m'][i]).reshape(len(bones), 3, 4); rp = Gv(co); sk = np.zeros_like(rp)
    for k in range(4): sk += W4[:, k:k + 1] * (np.einsum('nij,nj->ni', Mf[I4[:, k]][:, :, :3], rp) + Mf[I4[:, k]][:, :, 3])
    err = float(np.abs(sk - pc).max()); print(f'skinning check ({name} {i}): max error {err:.5f} units')
    set_pose(arm, {})
    H = float(hi[1]); info = dict(meta, boss=boss, height=round(H, 4), tris=int(len(idx) // 3), verts=int(n), bones=bones,
        parents=[(arm.data.bones[b].parent.name if arm.data.bones[b].parent else None) for b in bones], anims=A)
    json.dump(info, open(P('live', 'assets', f'c_{boss}.json'), 'w'), separators=(',', ':'))
    js = P('live', 'bosses3d.js'); B3 = {}
    if os.path.exists(js):
        s = open(js, encoding='utf8').read(); B3 = json.loads(s[s.index('{'):s.rindex('}') + 1])
    B3[boss] = dict({k: v for k, v in meta.items()}, height=round(H, 4), mesh=1, anims={k: dict(n=v['n'], loop=v['loop'], fps=v['fps']) for k, v in A.items()})
    open(js, 'w', encoding='utf8').write('window.BOSS3D = ' + json.dumps(B3, separators=(',', ':')) + ';\n')
    print(f'game: c_{boss}.bin {info["tris"]} tris {n} verts, {len(bones)} bones, {sum(v["n"] for v in A.values())} frames; height {H:.3f}')
    return info

def finish3d(boss, skel, anims, pose_fn, mode, meta):
    objs = body_objects(); c, s = camera(boss, objs); look_rig(); t0 = time.time()
    if mode in ('look', 'full'):
        v, e = look_sheet(boss, c); look_views(boss, c)
        print(f'look: art/bosses3d/out/{boss}_look.png  IoU {v:.3f}  colour error {e:.3f}; views: {boss}_look_views.png ({time.time() - t0:.0f}s)')
        if mode == 'look': return
        meta = dict(meta or {}, iou=round(v, 4), err=round(e, 4))
    arm = skeleton(skel); g = build_body(objs, arm)
    for name, A in anims.items():
        for i in (0, A['n'] - 1):
            for k in pose_fn(name, i, A['n']) or {}: assert (k[4:] if k.startswith(('loc:', 'scl:')) else k) in arm.data.bones, f'{name}: no bone {k}'
    if mode == 'anim3': anim3_sheet(boss, arm, c, anims, pose_fn); print(f'anim3: art/bosses3d/out/{boss}_anims3.png ({time.time() - t0:.0f}s)'); return
    if mode == 'turn':                                                               # lit, all round: the rest pose, then the walk from 3 sides
        d = P2(boss, 'turn'); shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
        for k in range(24): set_pose(arm, pose_fn('idle', 0, anims['idle']['n'])); look_render(os.path.join(d, f'rest_{k:02d}.png'), 400, dict(c, az=c['az'] + k * 15), 20)
        for az in (0, 90, 180):
            for i in range(anims['walk']['n']): set_pose(arm, pose_fn('walk', i, anims['walk']['n'])); look_render(os.path.join(d, f'walk{az:03d}_{i:02d}.png'), 400, dict(c, az=c['az'] + az), 20)
        set_pose(arm, {}); print('turn →', d, f'({time.time() - t0:.0f}s)'); return
    export_game(boss, g, arm, anims, pose_fn, dict(meta or {}), atlas=int((meta or {}).get('atlas', 2048))); print(f'done ({time.time() - t0:.0f}s)')

# ---------------------------------------------------------------------------------------------------------------- the run
def finish(boss, skel, anims, pose_fn, mode=None, meta=None):
    """quick: camera fit + compare sheet (flat colours). anim: + rig + animation sheet (flat colours). full: + projected texture, bake,
    textured compare + animation sheets, every game frame and meta.json. turn: the textured model orbited (turntable())."""
    mode = mode or MODE; refload(boss); os.makedirs(P2('out'), exist_ok=True); t0 = time.time()
    if mode in ('look', 'anim3', 'game', 'full', 'turn'): return finish3d(boss, skel, anims, pose_fn, mode, meta)     # the real 3D model
    objs = body_objects(); c, s = camera(boss, objs)
    if mode == 'quick':
        v, e = compare_sheet(boss, c, False); views_sheet(boss, objs, False)
        print(f'quick: art/bosses3d/out/{boss}_cmp.png  IoU {v:.3f}  colour error {e:.3f} (flat colours); views: art/bosses3d/out/{boss}_views.png'); return
    arm = skeleton(skel); T = proj_tiles(boss, objs, c) if mode in ('full', 'turn') else None; g = build_body(objs, arm)
    for name, A in anims.items():                                         # every pose must name real bones
        for i in (0, A['n'] - 1):
            for k in pose_fn(name, i, A['n']) or {}: assert (k[4:] if k.startswith('loc:') else k) in arm.data.bones, f'{name}: no bone {k}'
    if mode == 'anim':
        anim_sheet(boss, arm, c, anims, pose_fn, False); print(f'anim: art/bosses3d/out/{boss}_anims.png ({time.time() - t0:.0f}s)'); return
    unwrap(g); cover = proj_uv(boss, g, c, T); print(f'corners seen from the reference camera: {cover * 100:.0f} %')
    img = bake_char(g, T['img'], 2048); os.makedirs(P2(boss), exist_ok=True)
    img.filepath_raw = P2(boss, 'atlas.png'); img.file_format = 'PNG'; img.save()
    img.alpha_mode = 'NONE'; textured_preview_material(g, img)                 # (the baked atlas is opaque: no see-through body)
    if mode == 'turn': turntable(boss, arm, c, anims, pose_fn); return            # turn: the textured model orbited, nothing else written
    v, e = compare_sheet(boss, c, True); views_sheet(boss, [g], True); print(f'full: art/bosses3d/out/{boss}_cmp.png  IoU {v:.3f}  colour error {e:.3f}')
    anim_sheet(boss, arm, c, anims, pose_fn, True)
    info = render_frames(boss, arm, c, anims, pose_fn, dict(meta or {}, iou=round(v, 4), err=round(e, 4)))
    print(f'full done ({time.time() - t0:.0f}s): stride {info.get("stride")} height {info["height"]}px anchor {info["anchor"]}')
