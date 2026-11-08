# a quick look at the cat GLB's tail: which vertices stand out of the body behind/beside the hips, where they lie, what bones hold them
import bpy, sys, os, numpy as np
ROOT = os.environ.get('ZH_ROOT'); bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'art/hero3d/cat2/cat.glb'))
g = next(o for o in bpy.data.objects if o.type == 'MESH' and o.vertex_groups); me = g.data
co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3) @ np.array(g.matrix_world)[:3, :3].T + np.array(g.matrix_world)[:3, 3]
names = {vg.index: vg.name for vg in g.vertex_groups}
# horizontal slices of the lower body: the extent in x at each height (the legs are ±0.1..0.25; the tail sticks out further)
for z in np.arange(0.1, 0.9, 0.05):
    s = co[(co[:, 2] > z) & (co[:, 2] < z + 0.05)]
    if len(s): print(f'z {z:.2f}: x {s[:,0].min():.3f}..{s[:,0].max():.3f}  y {s[:,1].min():.3f}..{s[:,1].max():.3f}  n {len(s)}')
T = (co[:, 0] < -0.3) & (co[:, 2] < 0.85)
print('tail candidates', T.sum())
tail = co[T]
for x in np.arange(-0.85, -0.25, 0.05):
    s = tail[(tail[:, 0] > x) & (tail[:, 0] < x + 0.05)]
    if len(s): print(f'x {x:.2f}: centre y {s[:,1].mean():.3f} z {s[:,2].mean():.3f}  r {np.ptp(s[:,2])/2:.3f}  n {len(s)}')
from collections import Counter
c = Counter()
for i in np.where(T)[0]:
    for gg in me.vertices[i].groups:
        if gg.weight > 0.3: c[names[gg.group]] += 1
print('tail held by', c.most_common(6))
# the base: vertices between the body and x = -0.3 at tail height, behind the hips
B = (co[:, 0] < -0.15) & (co[:, 0] > -0.3) & (co[:, 2] > 0.25) & (co[:, 2] < 0.6) & (co[:, 1] > 0.0)
print('base candidates', B.sum(), co[B].mean(0).round(3) if B.sum() else '')
