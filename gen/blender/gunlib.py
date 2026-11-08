# gen/blender/gunlib.py — modelling the guns in Blender (headless), shared by every gun script art/guns3d/<gun>.py:
#   python gen/blender/bl.py art/guns3d/<gun>.py            (quick: model + camera fit + silhouette check, seconds)
#   python gen/blender/bl.py art/guns3d/<gun>.py full       (+ projected texture, bake, export to the game, preview sheet)
#
# UNITS AND AXES. 1 unit = the penguin's height (the pistol is ~0.32 long, the rocket launcher ~1.1). Blender axes: +Y forward (toward
# the muzzle), +Z up, +X the gun's RIGHT side — the side every reference picture (art/refs/guns2/<gun>_a.png) shows, seen from the
# front-right and above. The exporter turns this into the game's gun frame (x = the holder's left, y up, z forward).
#
# THE SCRIPT builds the gun from parts (helpers below or plain bpy), each with a palette material, then calls finish(gun, mode).
# Anchors are empties: A_R (where the right flipper holds: the pistol grip), A_L (the left flipper: the foregrip / pump / handle;
# none for one-handed guns), A_muzzle (the bore's exit, centre), A_port (the ejection port, if any), A_spin (a point on the
# minigun's barrel axis; the axis runs along +Y), A_shoulder (the rocket launcher only: where it rests on the shoulder).
# Moving parts: part(obj, 1) spins about A_spin's axis (the minigun's barrels and their clamps), part(obj, 2) slides back
# along −Y (the pistol's slide, the shotgun's pump). Parts not to be textured by mirroring the reference onto their hidden side
# (asymmetric things: a hose on one side only): obj['nomirror'] = True.
#
# THE CAMERA is fitted once and then refined from art/guns3d/<gun>_cam.json each run; set "lock": true in that file to keep it.
# THE TEXTURE. finish() fits a camera to the reference (silhouette match), then paints every face the reference shows with the
# reference's own pixels (faces on the hidden left side take the mirrored right side's pixels), and every other face with its
# material's colour (plus baked ambient occlusion and a little edge wear); all of it is baked into one atlas. So the shape must
# match the picture: where it does, the gun looks exactly like the reference from that angle.
import bpy, bmesh, math, os, json, struct, sys, time
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

ROOT = os.environ.get('ZH_ROOT') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def P(*a): return os.path.join(ROOT, *a)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
MODE = ARGS[0] if ARGS else 'quick'

# ---------------------------------------------------------------------------------------------------------------- materials
# name: (base colour, sRGB 0..1), roughness, metallic, game specular 0..1). Colours can be overridden per gun: mat('orange', (r,g,b))
PALETTE = {
    'gunmetal': ((0.22, 0.23, 0.27), 0.45, 0.5, 0.55), 'dark': ((0.14, 0.14, 0.17), 0.5, 0.3, 0.45),
    'steel': ((0.62, 0.63, 0.66), 0.3, 1.0, 0.85), 'black': ((0.10, 0.10, 0.12), 0.65, 0.0, 0.25),
    'orange': ((0.94, 0.42, 0.12), 0.45, 0.0, 0.35), 'olive': ((0.42, 0.47, 0.20), 0.55, 0.0, 0.25),
    'red': ((0.84, 0.17, 0.11), 0.45, 0.0, 0.35), 'tan': ((0.86, 0.69, 0.45), 0.6, 0.0, 0.2),
    'brass': ((0.92, 0.68, 0.27), 0.3, 1.0, 0.9), 'yellow': ((0.98, 0.78, 0.15), 0.5, 0.0, 0.3),
    'glass': ((0.10, 0.28, 0.78), 0.05, 0.0, 1.0), 'rubber': ((0.12, 0.12, 0.14), 0.8, 0.0, 0.1),
}
def lin(c): return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def mat(name, color=None, rough=None, metal=None, spec=None):
    """The material for a palette name (created once); color (sRGB) overrides the palette's."""
    key = 'M_' + name
    m = bpy.data.materials.get(key)
    base = PALETTE.get(name, ((0.5, 0.5, 0.5), 0.5, 0.0, 0.3))
    if m is None:
        m = bpy.data.materials.new(key); m.use_nodes = True
    c = color or tuple(m.get('srgb', base[0]))
    m['srgb'] = list(c); m['spec'] = spec if spec is not None else m.get('spec', base[3])
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(c), 1.0)
    b.inputs['Roughness'].default_value = rough if rough is not None else base[1]
    b.inputs['Metallic'].default_value = metal if metal is not None else base[2]
    m.diffuse_color = (*lin(c), 1.0)
    return m

def sample_ref(gun, x, y, r=6):
    """The reference's mean colour (sRGB 0..1) round pixel (x, y) of the 1254 px picture (y down) — to pick a material's colour."""
    a = ref_pixels(gun); h = a.shape[0]
    q = a[max(0, h - 1 - y - r):h - y + r, max(0, x - r):x + r + 1]
    w = q[..., 3:4]; return tuple(((q[..., :3] * w).sum((0, 1)) / max(w.sum(), 1e-6)).round(3).tolist())

# ---------------------------------------------------------------------------------------------------------------- building
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def _add(o, name, m, bevel, seg, smooth):
    o.name = name; o.data.name = name
    if m: o.data.materials.append(mat(m) if isinstance(m, str) else m)
    if bevel: bev(o, bevel, seg)
    if smooth: shade_smooth(o)
    return o

def bev(o, width, seg=3, angle=40, clamp=True):
    """Rounded edges (a bevel modifier on the edges sharper than angle°)."""
    md = o.modifiers.new('bevel', 'BEVEL'); md.width = width; md.segments = seg; md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(angle); md.use_clamp_overlap = clamp; md.harden_normals = False
    return md

def shade_smooth(o, angle=35):
    """Smooth shading, flat where faces meet sharper than angle° (Blender 4.1+: by angle)."""
    for p in o.data.polygons: p.use_smooth = True
    try: o.data.set_sharp_from_angle(angle=math.radians(angle))
    except Exception: pass

def box(name, size, loc, m='gunmetal', bevel=0.0, seg=3, rot=(0, 0, 0), smooth=True):
    """A box of full size (sx, sy, sz) centred on loc, rotated rot (radians, XYZ), edges rounded by bevel."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.scale = size; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _add(o, name, m, bevel, seg, smooth)

def cyl(name, r, length, loc, axis='Y', m='steel', verts=48, bevel=0.0, seg=2, r2=None, rot=None, smooth=True):
    """A cylinder (a cone if r2) along axis X / Y / Z, centred on loc."""
    rr = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis] if rot is None else rot
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=length, location=loc, rotation=rr)
    else: bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=length, location=loc, rotation=rr)
    o = bpy.context.object
    if axis == 'Y' and rot is None:                      # +Z of the primitive along +Y (cones: r at the back, r2 at the front)
        o.rotation_euler = (-math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return _add(o, name, m, bevel, seg, smooth)

def sphere(name, r, loc, m='steel', seg=32, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = bpy.context.object; o.scale = scale; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _add(o, name, m, 0, 0, True)

def torus(name, R, r, loc, axis='Y', m='steel', seg=48, mseg=16):
    rr = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=mseg, location=loc, rotation=rr)
    return _add(bpy.context.object, name, m, 0, 0, True)

def prism(name, profile, width, loc=(0, 0, 0), m='gunmetal', bevel=0.0, seg=3, smooth=True):
    """A slab from a 2D outline in the side view: profile = [(y, z), ...] (forward, up; counter-clockwise), extruded width along X."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    vs = [bm.verts.new((-width / 2, y, z)) for y, z in profile]; f = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    r = bmesh.ops.extrude_face_region(bm, geom=[f]); top = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(width, 0, 0)); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.location = loc
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    return _add(o, name, m, bevel, seg, smooth)

def cut(target, cutter, apply=True):
    """Boolean difference: carves cutter out of target (the cutter is deleted)."""
    md = target.modifiers.new('cut', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = cutter; md.solver = 'EXACT'
    cutter.display_type = 'WIRE'; cutter.hide_render = True
    if apply: _apply(target, md); bpy.data.objects.remove(cutter, do_unlink=True)
    return target

def union(target, other, apply=True):
    md = target.modifiers.new('join', 'BOOLEAN'); md.operation = 'UNION'; md.object = other; md.solver = 'EXACT'
    if apply: _apply(target, md); bpy.data.objects.remove(other, do_unlink=True)
    return target

def _apply(o, md):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    # modifiers above this one apply first (a boolean on the un-bevelled base, a bevel after); by name: an applied modifier is freed
    stop = md.name
    for name in [m.name for m in o.modifiers]:
        bpy.ops.object.modifier_apply(modifier=name)
        if name == stop: break

def subsurf(o, levels=2):
    md = o.modifiers.new('subsurf', 'SUBSURF'); md.levels = levels; md.render_levels = levels; return md

def array(o, count, offset, merge=False):
    """count copies of o, each moved by offset (world units)."""
    md = o.modifiers.new('array', 'ARRAY'); md.count = count; md.use_relative_offset = False; md.use_constant_offset = True
    md.constant_offset_displace = offset; md.use_merge_vertices = merge; return md

def mirror_x(o):
    """Makes o symmetric about X = 0 (models the right half, mirrors it)."""
    md = o.modifiers.new('mirror', 'MIRROR'); md.use_axis = (True, False, False); md.use_clip = True; return md

def anchor(name, loc):
    e = bpy.data.objects.new(name, None); e.location = loc; bpy.context.collection.objects.link(e); return e

def part(o, k): o['part'] = int(k); return o

# ---------------------------------------------------------------------------------------------------------------- reference
_REF = {}
def ref_pixels(gun):
    """The reference (RGBA float, rows bottom-up as Blender stores them), 1254 px square."""
    if gun not in _REF:
        im = bpy.data.images.load(P('art', 'refs', 'guns2', f'{gun}_a.png'), check_existing=True)
        w, h = im.size; a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); _REF[gun] = a.reshape(h, w, 4); _REF[gun + '_im'] = im
    return _REF[gun]

def ref_mask(gun, n):
    a = ref_pixels(gun)[::-1, :, 3]; h = a.shape[0]                 # rows top-down
    e = np.linspace(0, h, n + 1).astype(int); c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), 0), 1)   # box-average to n × n
    s = c[e[1:]][:, e[1:]] - c[e[:-1]][:, e[1:]] - c[e[1:]][:, e[:-1]] + c[e[:-1]][:, e[:-1]]
    return s / np.outer(np.diff(e), np.diff(e)) > 0.5

# ---------------------------------------------------------------------------------------------------------------- camera
# The reference's camera: looking at the gun from azimuth az (degrees from +X toward +Y: from the right side round to the front),
# elevation el above, roll; perspective lens (mm, 36 mm sensor); frame width fw (world units at the target); the picture shifted
# by (sx, sy) (fractions of the frame); target: the point it looks at.
def cam_basis(c):
    az, el, roll = math.radians(c['az']), math.radians(c['el']), math.radians(c['roll'])
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))     # from the target to the camera
    f = -d; right = f.cross(Vector((0, 0, 1))).normalized(); up = right.cross(f).normalized()
    cr, sr = math.cos(roll), math.sin(roll); right, up = right * cr + up * sr, up * cr - right * sr
    dist = c['fw'] * c['lens'] / 36.0
    return Vector(c['target']) + d * dist, f, right, up, dist

def project(c, pts):
    """World points (N×3) → picture coordinates (N×2, 0..1, y down) for camera c."""
    pos, f, right, up, dist = cam_basis(c)
    q = np.asarray(pts, np.float64) - np.array(pos)
    z = q @ np.array(f); x = q @ np.array(right); y = q @ np.array(up)
    k = c['lens'] / 36.0 / np.maximum(z, 1e-6)
    return np.stack([0.5 + x * k + c['sx'], 0.5 - y * k - c['sy']], -1)

def place_camera(c, name='RefCam', res=1254):
    pos, f, right, up, dist = cam_basis(c)
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); bpy.context.collection.objects.link(cam)
    m = Matrix((right, up, -f)).transposed(); cam.matrix_world = Matrix.Translation(pos) @ m.to_4x4()
    cam.data.lens = c['lens']; cam.data.sensor_width = 36; cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.shift_x = -c['sx']; cam.data.shift_y = -c['sy'];                      # (Blender moves the frame, not the picture)
    cam.data.clip_start = 0.01; cam.data.clip_end = 100
    sc = bpy.context.scene; sc.camera = cam; sc.render.resolution_x = sc.render.resolution_y = res
    return cam

def surface_points(objs, n=150000, seed=1):
    """Points spread over the meshes' surfaces by area (world coordinates), for silhouettes."""
    pts, areas = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    tris = []
    for o in objs:
        me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); mw = np.array(o.matrix_world)
        v = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', v); v = v.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
        t = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('vertices', t); tris.append(v[t.reshape(-1, 3)])
        o.evaluated_get(dg).to_mesh_clear()
    T = np.concatenate(tris); a = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2
    rng = np.random.default_rng(seed); i = rng.choice(len(T), n, p=a / a.sum()); u, v = rng.random(n), rng.random(n); s = u + v > 1
    u[s], v[s] = 1 - u[s], 1 - v[s]; t = T[i]
    return t[:, 0] + (t[:, 1] - t[:, 0]) * u[:, None] + (t[:, 2] - t[:, 0]) * v[:, None], T

def silhouette(c, pts, n):
    q = (project(c, pts) * n).astype(np.int64); ok = (q[:, 0] >= 0) & (q[:, 0] < n) & (q[:, 1] >= 0) & (q[:, 1] < n)
    m = np.zeros((n, n), bool); m[q[ok, 1], q[ok, 0]] = True
    m2 = m.copy(); m2[1:] |= m[:-1]; m2[:-1] |= m[1:]; m2[:, 1:] |= m[:, :-1]; m2[:, :-1] |= m[:, 1:]   # close the pinholes: grow by a
    m3 = m2.copy(); m3[1:] &= m2[:-1]; m3[:-1] &= m2[1:]; m3[:, 1:] &= m2[:, :-1]; m3[:, :-1] &= m2[:, 1:]   # cell, then shrink back
    return m3

def iou(a, b): return (a & b).sum() / max(1, (a | b).sum())

def fit_camera(gun, objs, start=None, n=128, iters=400):
    """Fits the reference's camera to the model's silhouette (Nelder–Mead on 1 − IoU; from the last fit if there is one, else from a
    few starts). Returns (camera, IoU)."""
    pts, _ = surface_points(objs, 45000)
    ref = ref_mask(gun, n)
    lo, hi = pts.min(0), pts.max(0); ctr = (lo + hi) / 2; size = float(np.linalg.norm(hi - lo))
    keys = ['az', 'el', 'roll', 'lens', 'fw', 'sx', 'sy']
    def cam_of(v): return dict(zip(keys, v), target=ctr.tolist())
    def cost(v):
        c = cam_of(v)
        if not (5 < c['lens'] < 400 and -10 < c['el'] < 80 and -30 < c['az'] < 120 and c['fw'] > 0.05): return 2.0
        return 1 - iou(silhouette(c, pts, n), ref)
    if start:                                                              # warm: refine the last fit (the model changed a little)
        v0 = np.array([start[k] for k in keys], float); v0[4] *= size / start.get('size', size)
        v, f = nelder_mead(cost, v0, [2, 1.5, 1, 8, size * 0.03, 0.01, 0.01], iters // 2)
        return dict(cam_of(v), size=size), 1 - f
    best = None
    for az in (25, 50):
        for el in (18, 34):
            v, f = nelder_mead(cost, np.array([az, el, 0, 80, size * 1.25, 0, 0], float), [12, 8, 5, 30, size * 0.2, 0.05, 0.05], iters // 3)
            if best is None or f < best[1]: best = (v, f)
    v, f = nelder_mead(cost, best[0], [3, 2, 1.5, 10, size * 0.05, 0.01, 0.01], iters)
    return dict(cam_of(v), size=size), 1 - f

def nelder_mead(f, x0, step, iters):
    n = len(x0); S = [x0] + [x0 + np.eye(n)[i] * step[i] for i in range(n)]; F = [f(x) for x in S]
    for _ in range(iters):
        o = np.argsort(F); S = [S[i] for i in o]; F = [F[i] for i in o]
        c = np.mean(S[:-1], 0); xr = c + (c - S[-1]); fr = f(xr)
        if fr < F[0]:
            xe = c + 2 * (c - S[-1]); fe = f(xe)
            if fe < fr: S[-1], F[-1] = xe, fe
            else: S[-1], F[-1] = xr, fr
        elif fr < F[-2]: S[-1], F[-1] = xr, fr
        else:
            xc = c + 0.5 * (S[-1] - c); fc = f(xc)
            if fc < F[-1]: S[-1], F[-1] = xc, fc
            else: S = [S[0]] + [S[0] + 0.5 * (s - S[0]) for s in S[1:]]; F = [F[0]] + [f(s) for s in S[1:]]
    i = int(np.argmin(F)); return S[i], F[i]

# ---------------------------------------------------------------------------------------------------------------- finishing
def gun_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and o.display_type != 'WIRE']

def bake_ready(objs):
    """Applies every modifier and joins the parts into one mesh GUN (face attributes: part, nomirror)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        k, nm = int(o.get('part', 0)), int(bool(o.get('nomirror', False)))
        me = o.data
        for name, val in (('part', k), ('nomirror', nm)):
            a = me.attributes.get(name) or me.attributes.new(name, 'INT', 'FACE'); a.data.foreach_set('value', [val] * len(me.polygons))
        o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); g = bpy.context.object; g.name = 'GUN'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return g

def smoothstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def project_reference(gun, g, c):
    """UV map ProjUV (the reference's pixels) and per-corner weight projw. A face facing the camera takes the reference as it is; a face
    facing away takes its mirror image's (X -> -X) pixels unless nomirror; each corner is tested for visibility on its own (a ray from
    the camera to a point just off the face, a little in from the corner), so long faces are painted where they show and the weight
    blends across a face instead of jumping at its edges."""
    me = g.data; pos, f, right, up, dist = cam_basis(c)
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bvh = BVHTree.FromBMesh(bm)
    nf = len(me.polygons); cen = np.empty(nf * 3); nor = np.empty(nf * 3); me.polygons.foreach_get('center', cen); me.polygons.foreach_get('normal', nor)
    cen = cen.reshape(-1, 3); nor = nor.reshape(-1, 3)
    nm = np.zeros(nf, np.int32); me.attributes['nomirror'].data.foreach_get('value', nm)
    camp = np.array(pos); M = np.array([-1.0, 1.0, 1.0])
    def facing(cs, ns): v = camp - cs; return (ns * (v / np.linalg.norm(v, axis=1)[:, None])).sum(1)
    nd1 = facing(cen, nor); nd2 = facing(cen * M, nor * M)
    mirf = (nd1 <= 0.05) & (nd2 > 0.05) & (nm == 0)                       # per face: the mirror image faces the camera instead
    face_w = np.where(mirf, smoothstep(0.08, 0.3, nd2), smoothstep(0.08, 0.3, nd1)) * ((nd1 > 0.05) | mirf)
    lp = np.empty(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lp)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)[lp]
    lf = np.empty(len(me.loops), np.int64)
    for p in me.polygons: lf[p.loop_start:p.loop_start + p.loop_total] = p.index
    mir = mirf[lf]
    q = np.where(mir[:, None], co * M, co)                                  # the point whose picture paints this corner
    qc = np.where(mir[:, None], cen[lf] * M, cen[lf]); qn = np.where(mir[:, None], nor[lf] * M, nor[lf])
    probe = q + (qc - q) * 0.04 + qn * 0.0006
    vis = np.zeros(len(q), np.float32); cam = Vector(camp)
    for i in np.nonzero(face_w[lf] > 0)[0]:
        d = probe[i] - camp; dl = float(np.linalg.norm(d))
        hit = bvh.ray_cast(cam, Vector(d / dl), dl + 0.01)
        if hit[0] is None or hit[3] >= dl - 0.0025: vis[i] = 1.0
    uv = project(c, q); uv[:, 1] = 1 - uv[:, 1]                            # Blender's v runs up
    lay = me.uv_layers.get('ProjUV') or me.uv_layers.new(name='ProjUV'); lay.data.foreach_set('uv', uv.astype(np.float32).ravel())
    w = face_w[lf] * vis
    a = me.attributes.get('projw') or me.attributes.new('projw', 'FLOAT', 'CORNER'); a.data.foreach_set('value', w.astype(np.float32))
    bm.free()
    fw = np.bincount(lf, weights=w, minlength=nf) / np.maximum(np.bincount(lf, minlength=nf), 1)
    return float((fw > 0.5).mean())

def unwrap(g, margin=0.004):
    bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); bpy.context.view_layer.objects.active = g
    if 'UVMap' not in g.data.uv_layers: g.data.uv_layers.new(name='UVMap')
    g.data.uv_layers.active = g.data.uv_layers['UVMap']
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=margin, area_weight=0.6, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')

def bake_atlas(gun, g, size=2048):
    """Bakes colour into image ATLAS on UVMap: the reference where projw, else the material's colour; ambient occlusion, edge wear."""
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.use_denoising = False
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'CUDA'; pr.get_devices()
        for d in pr.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception: pass
    img = bpy.data.images.get('ATLAS') or bpy.data.images.new('ATLAS', size, size, alpha=False)
    ref = ref_pixels(gun) is not None and _REF[gun + '_im']
    for m in g.data.materials:
        nt = m.node_tree; N = nt.nodes; L = nt.links
        for n in [n for n in N if n.name.startswith('bk_')]: N.remove(n)
        def node(t, name, x, y): n = N.new(t); n.name = 'bk_' + name; n.location = (x, y); return n
        out = node('ShaderNodeOutputMaterial', 'out', 900, 0); out.target = 'CYCLES'
        em = node('ShaderNodeEmission', 'em', 700, 0)
        base = node('ShaderNodeRGB', 'base', -400, 200); base.outputs[0].default_value = (*lin(tuple(m.get('srgb', (0.5, 0.5, 0.5)))), 1)
        ao = node('ShaderNodeAmbientOcclusion', 'ao', -400, -50); ao.samples = 16; ao.inputs['Distance'].default_value = 0.03
        geo = node('ShaderNodeNewGeometry', 'geo', -400, -300)
        aom = node('ShaderNodeMapRange', 'aom', -150, -50); aom.inputs['To Min'].default_value = 0.55
        L.new(ao.outputs['AO'], aom.inputs['Value'])
        shade = node('ShaderNodeMixRGB', 'shade', 50, 150); shade.blend_type = 'MULTIPLY'; shade.inputs['Fac'].default_value = 1
        L.new(base.outputs[0], shade.inputs[1]); L.new(aom.outputs[0], shade.inputs[2])
        edge = node('ShaderNodeMapRange', 'edge', -150, -300); edge.inputs['From Min'].default_value = 0.52; edge.inputs['From Max'].default_value = 0.6
        edge.inputs['To Max'].default_value = 0.35; L.new(geo.outputs['Pointiness'], edge.inputs['Value'])
        wear = node('ShaderNodeMixRGB', 'wear', 250, 50); wear.blend_type = 'SCREEN'; L.new(edge.outputs[0], wear.inputs['Fac'])
        L.new(shade.outputs[0], wear.inputs[1]); wear.inputs[2].default_value = (0.55, 0.55, 0.58, 1)
        uvp = node('ShaderNodeUVMap', 'uvp', -400, 450); uvp.uv_map = 'ProjUV'
        tex = node('ShaderNodeTexImage', 'ref', -150, 450); tex.image = ref; tex.interpolation = 'Cubic'; tex.extension = 'CLIP'
        L.new(uvp.outputs[0], tex.inputs[0])
        pw = node('ShaderNodeAttribute', 'pw', -150, 650); pw.attribute_name = 'projw'
        pa = node('ShaderNodeMath', 'pa', 250, 600); pa.operation = 'MULTIPLY'; L.new(pw.outputs['Fac'], pa.inputs[0]); L.new(tex.outputs['Alpha'], pa.inputs[1])
        mix = node('ShaderNodeMixRGB', 'mix', 480, 200); L.new(pa.outputs[0], mix.inputs['Fac']);   # (only inside the picture's silhouette)
        L.new(wear.outputs[0], mix.inputs[1]); L.new(tex.outputs['Color'], mix.inputs[2])
        L.new(mix.outputs[0], em.inputs['Color']); L.new(em.outputs[0], out.inputs['Surface'])
        tgt = node('ShaderNodeTexImage', 'atlas', 900, -300); tgt.image = img
        N.active = tgt
        for n in N: n.select = False
        tgt.select = True
    g.data.uv_layers.active = g.data.uv_layers['UVMap']
    bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); bpy.context.view_layer.objects.active = g
    t0 = time.time(); bpy.ops.object.bake(type='EMIT', margin=10, use_clear=True); print(f'baked {size}px in {time.time() - t0:.1f}s')
    return img

def export(gun, g, img, quality=82, slide=0.0):
    """live/assets/m_<gun>.bin (the mesh, in the game's gun frame) + t_<gun>.jpg (the atlas) + art/guns3d/<gun>.json (anchors)."""
    me = g.data; me.calc_loop_triangles()
    nv = len(me.vertices); co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nl = len(me.loops); lv = np.empty(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
    try: cn = np.array([n.vector[:] for n in me.corner_normals])
    except Exception: cn = np.empty(nl * 3); me.loops.foreach_get('normal', cn); cn = cn.reshape(-1, 3)
    uv = np.empty(nl * 2); me.uv_layers['UVMap'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    pa = np.zeros(len(me.polygons), np.int64); me.attributes['part'].data.foreach_get('value', pa)
    mi = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get('material_index', mi)
    spec = np.array([float(m.get('spec', 0.3)) for m in me.materials])
    lt = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('loops', lt)
    tp = np.empty(len(me.loop_triangles), np.int64); me.loop_triangles.foreach_get('polygon_index', tp)
    lpoly = np.repeat(tp, 3)
    # the game's frame: x = −X, y = Z, z = Y
    G = lambda a: np.stack([-a[:, 0], a[:, 2], a[:, 1]], -1)
    P3 = G(co[lv[lt]]); N3 = G(cn[lt]); U2 = uv[lt]; PT = pa[lpoly]; SP = spec[mi[lpoly]]
    key = np.concatenate([np.round(P3, 5), np.round(N3, 3), np.round(U2, 5), PT[:, None]], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P3, N3, U2, PT, SP = P3[first], N3[first], U2[first], PT[first], SP[first]
    idx = inv.astype(np.uint32).ravel()
    n = len(P3); rec = np.zeros(n, dtype=[('p', '<f4', 3), ('n', 'i1', 3), ('s', 'u1'), ('uv', '<u2', 2), ('part', 'u1'), ('pad', 'u1', 3)])
    rec['p'] = P3; nn = N3 / np.maximum(np.linalg.norm(N3, axis=1, keepdims=True), 1e-9); rec['n'] = np.round(nn * 127).astype(np.int8)
    rec['s'] = np.round(SP * 255).astype(np.uint8); rec['uv'] = np.round(np.clip(U2, 0, 1) * 65535).astype(np.uint16); rec['part'] = PT
    lo, hi = P3.min(0), P3.max(0)
    with open(P('live', 'assets', f'm_{gun}.bin'), 'wb') as fh:
        fh.write(b'GUN1'); fh.write(struct.pack('<III', n, len(idx), 0)); fh.write(struct.pack('<6f', *lo, *hi)); fh.write(rec.tobytes()); fh.write(idx.tobytes())
    img.filepath_raw = P('live', 'assets', f't_{gun}.jpg'); img.file_format = 'JPEG'
    st = bpy.context.scene.render.image_settings; st.file_format = 'JPEG'; st.color_mode = 'RGB'; st.quality = quality
    img.save_render(P('live', 'assets', f't_{gun}.jpg'))
    anc = {}
    for o in bpy.context.scene.objects:
        if o.type == 'EMPTY' and o.name.startswith('A_'): l = o.matrix_world.translation; anc[o.name[2:]] = [round(-l.x, 5), round(l.z, 5), round(l.y, 5)]
    info = {'gun': gun, 'verts': int(n), 'tris': int(len(idx) // 3), 'min': lo.round(5).tolist(), 'max': hi.round(5).tolist(), 'anchors': anc,
            'parts': sorted(set(PT.tolist())), 'slide': float(slide)}
    os.makedirs(P('art', 'guns3d'), exist_ok=True); json.dump(info, open(P('art', 'guns3d', f'{gun}.json'), 'w'), indent=1)
    print('exported', gun, info['tris'], 'tris', info['verts'], 'verts', 'anchors', anc)
    return info

# ---------------------------------------------------------------------------------------------------------------- previews
def _render(path, res, cam=None, flat=False, tex=None, transparent=True):
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'FLAT' if flat else 'STUDIO'; sh.color_type = 'TEXTURE' if tex else 'MATERIAL'; sh.show_cavity = not flat
    sh.cavity_type = 'BOTH'; sh.show_specular_highlight = not flat; sc.display.render_aa = '16'
    sc.render.film_transparent = transparent; sc.render.resolution_x = sc.render.resolution_y = res; sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    if cam: sc.camera = cam
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(path, check_existing=False); a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); bpy.data.images.remove(im)
    return a.reshape(res, res, 4)[::-1]                                     # rows top-down

def view_cam(name, az, el, target, fw, ortho=True, roll=0):
    c = dict(az=az, el=el, roll=roll, lens=200 if ortho else 60, fw=fw, sx=0, sy=0, target=list(target)); return place_camera(c, name)

def textured_preview_material(g, img):
    for m in g.data.materials:
        nt = m.node_tree; N = nt.nodes
        t = N.get('pv_tex') or N.new('ShaderNodeTexImage'); t.name = 'pv_tex'; t.image = img
        uvn = N.get('pv_uv') or N.new('ShaderNodeUVMap'); uvn.name = 'pv_uv'; uvn.uv_map = 'UVMap'; nt.links.new(uvn.outputs[0], t.inputs[0])
        N.active = t

def save_png(arr, path):
    """arr: H×W×4 float rows top-down."""
    h, w = arr.shape[:2]; im = bpy.data.images.new('tmp_save', w, h, alpha=True)
    im.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel()); im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)

def over(a, bg):
    return np.concatenate([a[..., :3] * a[..., 3:4] + np.array(bg) * (1 - a[..., 3:4]), np.ones_like(a[..., :1])], -1)

def sheet(gun, objs, c, tex=None, res=420):
    """art/guns3d/out/<gun>_cmp.png: top row: the reference | the model from the reference's camera (textured once baked, else its
    materials) | silhouettes (white: both, red: model only, cyan: reference only); below: right side, left side, top, front-left,
    the game's view (30° down) and from behind, lit."""
    os.makedirs(P('art', 'guns3d', 'out'), exist_ok=True); tmp = P('art', 'guns3d', 'out', f'_r_{gun}.png')
    cam = place_camera(c, 'RefCam', res)
    a = _render(tmp, res, cam, flat=bool(tex), tex=tex)
    ref = ref_pixels(gun)[::-1]; k = ref.shape[0] / res; ix = (np.arange(res) * k).astype(int); r = ref[ix][:, ix]
    mm, rm = a[..., 3] > 0.5, r[..., 3] > 0.5
    sil = np.zeros((res, res, 4)); sil[..., 3] = 1; sil[mm & rm] = (1, 1, 1, 1); sil[mm & ~rm] = (1, 0.15, 0.15, 1); sil[~mm & rm] = (0.1, 0.9, 1, 1)
    BG = (0.1, 0.11, 0.15)
    row1 = [over(r, BG), over(a, BG), sil]
    pts = np.array([v for o in objs for v in [o.matrix_world @ Vector(b) for b in o.bound_box]]); lo, hi = pts.min(0), pts.max(0); ctr = (lo + hi) / 2
    fw = float(np.linalg.norm(hi - lo)) * 1.05
    views = [(0, 0), (180, 0), (0, 89), (125, 25), (60, 30), (-90, 15)]
    row2 = [over(_render(tmp, res, view_cam('V%d' % i, az, el, ctr, fw), tex=tex), BG) for i, (az, el) in enumerate(views)]
    top = np.concatenate(row1, 1); pad = np.zeros((res, res * 3, 4)); pad[..., 3] = 1
    bottom = np.concatenate([np.concatenate(row2[:3], 1), np.concatenate(row2[3:], 1)], 0)
    out = np.concatenate([top, bottom], 0); save_png(out, P('art', 'guns3d', 'out', f'{gun}_cmp.png'))
    os.remove(tmp)
    return iou(mm, rm)

def finish(gun, mode=None, slide=0.0):
    """Quick: fit the camera, silhouette IoU, preview sheet. Full: + projected texture, atlas bake, export to the game.
    slide: how far the part-2 pieces travel back when racked (the pistol's slide ~0.04, the shotgun's pump ~0.05)."""
    mode = mode or MODE; objs = gun_objects(); t0 = time.time()
    camfile = P('art', 'guns3d', f'{gun}_cam.json'); start = json.load(open(camfile)) if os.path.exists(camfile) else None
    if start and start.get('lock'):                                        # a camera settled by hand: kept as it is
        c = start; pts, _ = surface_points(objs, 45000); s = iou(silhouette(c, pts, 128), ref_mask(gun, 128))
    else:
        c, s = fit_camera(gun, objs, start); json.dump(c, open(camfile, 'w'), indent=1)
    print(f'camera az {c["az"]:.1f} el {c["el"]:.1f} roll {c["roll"]:.1f} lens {c["lens"]:.0f} — silhouette IoU {s:.3f} ({time.time() - t0:.1f}s)')
    if mode != 'full':
        v = sheet(gun, objs, c); print(f'quick sheet: art/guns3d/out/{gun}_cmp.png  IoU at 420px {v:.3f}'); return
    g = bake_ready(objs); unwrap(g)
    cover = project_reference(gun, g, c); print(f'faces painted from the reference: {cover * 100:.0f} %')
    img = bake_atlas(gun, g); info = export(gun, g, img, slide=slide)
    textured_preview_material(g, img)
    v = sheet(gun, [g], c, tex=img); print(f'full sheet: art/guns3d/out/{gun}_cmp.png  IoU at 420px {v:.3f}  ({time.time() - t0:.0f}s)')
