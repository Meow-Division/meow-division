# gen/blender/phantomgun.py — the Copper Phantom rifle (the rare boss drop) from its Meshy model art/guns3d/phantom/phantom.glb (about
# 0.95 long, the barrel along −X, up +Z, 15.6k triangles, a 2048 colour map) made into the game's gun mesh:
#   python gen/blender/bl.py gen/blender/phantomgun.py          → live/assets/m_phantom.bin, t_phantom.jpg, data.js D.GUN3D.phantom
#   python gen/blender/bl.py gen/blender/phantomgun.py look <png> → only a side view with the anchors marked (nothing written to the game)
#   python gen/blender/bl.py gen/blender/phantomgun.py icon <png> → its picture for the stash (then gen/phantomicon.py makes it_phantom.png)
# The same file format and frame as gunlib.py's export: the game's gun frame (x the holder's left, y up, z toward the muzzle); anchors R
# (the pistol grip, where the right paw closes), L (the vertical foregrip under the handguard, the left paw's), muzzle (the suppressor's
# front, its middle), port (the ejection port), laser (the box on the rail near the front: where the sight's red line starts).
# The anchors are found from the shape: each part's vertices in a box of the file (x along the gun, z up), their middle. The gun is
# LEN gun units long, its grip set where the SMG's is, so a hold made for the SMG starts close.
import bpy, os, sys, json, struct
import numpy as np

ROOT = os.environ.get('ZH_ROOT') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
def P(*a): return os.path.join(ROOT, *a)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
MODE = (ARGS + ['game'])[0]
GUN, LIKE, MAXTRI, LEN = 'phantom', 'smg', 12000, 0.62
# the parts in the file's units: (x from, x to, z from, z to); the anchor is the middle of the vertices inside, at the height given
# (None: their middle). Read off the side view (look): the grip slants back under the receiver, the foregrip hangs under the handguard.
BOX = dict(
    R=((0.10, 0.26), (-0.16, -0.02), -0.06),
    L=((-0.21, -0.10), (-0.10, -0.01), -0.04),
    laser=((-0.30, -0.18), (0.08, 0.16), None),
)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P('art', 'guns3d', GUN, GUN + '.glb'))
for o in list(bpy.data.objects):
    if o.type == 'MESH' and len(o.data.polygons) < 200: bpy.data.objects.remove(o)   # (Meshy's stray icosphere, if any)
g = next(o for o in bpy.data.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = g; g.select_set(True); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tri = sum(len(p.vertices) - 2 for p in g.data.polygons)
if tri > MAXTRI:
    dm = g.modifiers.new('dec', 'DECIMATE'); dm.ratio = MAXTRI / tri; bpy.ops.object.modifier_apply(modifier='dec')
me = g.data; me.calc_loop_triangles()
nv = len(me.vertices); co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
lo, hi = co.min(0), co.max(0)

def part(box):
    (x0, x1), (z0, z1), zh = box
    v = co[(co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1)]
    if not len(v): sys.exit('no vertices in ' + str(box))
    m = (v.min(0) + v.max(0)) / 2
    return np.array([m[0] if zh is None else v[np.abs(v[:, 2] - zh) < 0.015][:, 0].mean(), 0.0, m[2] if zh is None else zh])

# the muzzle: the middle of the front face (the suppressor's end); the port: on the receiver's right side above the magazine well
front = co[co[:, 0] < lo[0] + 0.02]
F = dict(R=part(BOX['R']), L=part(BOX['L']), laser=part(BOX['laser']),
         muzzle=np.array([lo[0], 0.0, (front[:, 2].min() + front[:, 2].max()) / 2]), port=np.array([0.02, hi[1], 0.06]))

if MODE == 'look':
    # a side view of the vertices (x along, z up) with the anchors as red squares, for checking the boxes
    out = ARGS[1]; Wd, Hd = 1200, 500; s = (Wd - 80) / (hi[0] - lo[0])
    img = np.ones((Hd, Wd, 4), np.float32)
    px = lambda p: (int((p[0] - lo[0]) * s) + 40, int((p[2] - lo[2]) * s) + 40)   # (a Blender image's rows go up: z up)
    tc = co[np.array([t.vertices[:] for t in me.loop_triangles])].mean(1)
    for p in np.concatenate([co, tc]):
        x, y = px(p)
        if 0 <= x < Wd and 0 <= y < Hd: img[y, x, :3] = 0.25
    for k, p in F.items():
        x, y = px(p); img[max(0, y - 5):y + 6, max(0, x - 5):x + 6, :3] = (0.9, 0.1, 0.1)
    for b in BOX.values():
        (x0, x1), (z0, z1), _ = b; a, c = px((x0, 0, z0)), px((x1, 0, z1))
        img[a[1]:c[1], a[0], :3] = img[a[1]:c[1], c[0], :3] = (0.1, 0.4, 0.9); img[a[1], a[0]:c[0], :3] = img[c[1], a[0]:c[0], :3] = (0.1, 0.4, 0.9)
    im = bpy.data.images.new('look', Wd, Hd, alpha=True); im.pixels = img.ravel(); im.filepath_raw = out; im.file_format = 'PNG'; im.save()
    print('anchors (file):', {k: [round(float(v), 3) for v in p] for k, p in F.items()}, 'box', lo.round(3), hi.round(3)); sys.exit(0)

if MODE == 'icon':
    # the stash's picture (art for live/assets/it_phantom.png, finished by gen/phantomicon.py): its left side, the muzzle up to the
    # right as the item pictures lean, lit from the front-left, on a transparent ground (Cycles, a few samples)
    import math
    out = ARGS[1]; sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
    sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.view_settings.view_transform = 'Standard'
    g.rotation_euler = (0, math.radians(-22), math.radians(180))                # (muzzle to the right, tipped up)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.08; cam.location = (0, 2, 0.02); cam.rotation_euler = (math.radians(90), 0, math.radians(180))
    for rot, e in (((50, 0, 200), 4.0), ((60, 0, 120), 1.5), ((-30, 0, 20), 1.2)):
        L = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); L.data.energy = e; L.rotation_euler = tuple(math.radians(v) for v in rot); sc.collection.objects.link(L)
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sc.render.filepath = out; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    bpy.ops.render.render(write_still=True); print('icon art', out); sys.exit(0)

s0 = open(P('live', 'data.js'), encoding='utf8').read(); i0 = s0.index('D.GUN3D = ') + len('D.GUN3D = ')
G3 = json.loads(s0[i0:s0.index(';\n', i0)])
R_GAME = np.array(G3[LIKE]['anchors']['R'])                                 # the SMG's grip: this one's goes there
k = LEN / (hi[0] - lo[0])
G = lambda a: np.stack([-a[..., 1], a[..., 2], -a[..., 0]], -1) * k         # file → the game's gun frame (scaled)
off = R_GAME - G(F['R'])
T = lambda a: G(a) + off
nl = len(me.loops); lv = np.empty(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
try: cn = np.array([n.vector[:] for n in me.corner_normals])
except Exception: cn = np.empty(nl * 3); me.loops.foreach_get('normal', cn); cn = cn.reshape(-1, 3)
uv = np.empty(nl * 2); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
lt = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('loops', lt)
# the colour map: the image wired into the material's Base Color (the other two are its metal/roughness and normal maps)
bsdf = next(n for n in g.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
TEX = bsdf.inputs['Base Color'].links[0].from_node.image
TW, TH = TEX.size; pxl = np.array(TEX.pixels[:], np.float32).reshape(TH, TW, 4)
P3 = T(co[lv[lt]]); N3 = G(cn[lt]); U2 = uv[lt]
c = pxl[np.clip((U2[:, 1] * TH).astype(int), 0, TH - 1), np.clip((U2[:, 0] * TW).astype(int), 0, TW - 1), :3]
copper = (c[:, 0] - c[:, 2] > 0.12) & (c[:, 0] > 0.25)
SP = np.where(copper, 0.8, np.where(c.mean(1) < 0.12, 0.3, 0.5))             # the copper inlays shiny, the black polymer matt
PT = np.zeros(len(P3), np.int64)                                            # (no moving part)
key = np.concatenate([np.round(P3, 5), np.round(N3, 3), np.round(U2, 5), PT[:, None]], 1)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
P3, N3, U2, PT, SP = P3[first], N3[first], U2[first], PT[first], SP[first]; idx = inv.astype(np.uint32).ravel(); n = len(P3)
rec = np.zeros(n, dtype=[('p', '<f4', 3), ('n', 'i1', 3), ('s', 'u1'), ('uv', '<u2', 2), ('part', 'u1'), ('pad', 'u1', 3)])
rec['p'] = P3; nn = N3 / np.maximum(np.linalg.norm(N3, axis=1, keepdims=True), 1e-9); rec['n'] = np.round(nn * 127).astype(np.int8)
rec['s'] = np.round(SP * 255).astype(np.uint8); rec['uv'] = np.round(np.clip(U2, 0, 1) * 65535).astype(np.uint16); rec['part'] = PT
blo, bhi = P3.min(0), P3.max(0)
with open(P('live', 'assets', f'm_{GUN}.bin'), 'wb') as fh:
    fh.write(b'GUN1'); fh.write(struct.pack('<III', n, len(idx), 0)); fh.write(struct.pack('<6f', *blo, *bhi)); fh.write(rec.tobytes()); fh.write(idx.tobytes())
vs = bpy.context.scene.view_settings; vs.view_transform = 'Standard'; vs.look = 'None'
st = bpy.context.scene.render.image_settings; st.file_format = 'JPEG'; st.color_mode = 'RGB'; st.quality = 88
TEX.save_render(P('live', 'assets', f't_{GUN}.jpg'))
r5 = lambda a: [round(float(v), 4) for v in a]
anc = {k2: r5(T(F[k2])) for k2 in ('R', 'L', 'muzzle', 'port', 'laser')}
dj = P('live', 'data.js'); s = open(dj, encoding='utf8').read(); i = s.index('D.GUN3D = ') + len('D.GUN3D = '); j = s.index(';\n', i)
G3 = json.loads(s[i:j]); G3[GUN] = dict(anchors=anc, min=r5(blo), max=r5(bhi), slide=0, tris=int(len(idx) // 3))
s = s[:i] + json.dumps(G3, separators=(',', ':')) + s[j:]; open(dj, 'w', encoding='utf8', newline='').write(s)
print(GUN + ':', len(idx) // 3, 'tris', n, 'verts; anchors', anc, 'box', r5(blo), r5(bhi))
