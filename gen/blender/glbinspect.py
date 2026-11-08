# gen/blender/glbinspect.py — what is inside a GLB: objects, skeleton, mesh, actions; front/side/back/¾ previews
#   python gen/blender/bl.py gen/blender/glbinspect.py <file.glb> <out folder>   (paths relative to the project)
import bpy, sys, os, math
import numpy as np
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
ROOT = os.environ.get('ZH_ROOT', os.getcwd()); path, out = (a if os.path.isabs(a) else os.path.join(ROOT, a) for a in args[:2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path); [bpy.data.objects.remove(o) for o in list(bpy.data.objects) if o.type == 'MESH' and not o.vertex_groups and len(o.data.polygons) < 200]   # Meshy's stray icosphere
for o in bpy.data.objects:
    print('OBJ', o.type, o.name, 'parent', o.parent.name if o.parent else None, 'scale', tuple(round(v, 4) for v in o.scale), 'rot', tuple(round(v, 3) for v in o.rotation_euler), 'loc', tuple(round(v, 3) for v in o.location))
    if o.type == 'MESH':
        me = o.data; print('  tris', sum(len(p.vertices) - 2 for p in me.polygons), 'verts', len(me.vertices), 'groups', len(o.vertex_groups), 'uv', [u.name for u in me.uv_layers], 'mats', [m.name for m in me.materials], 'shapekeys', [k.name for k in me.shape_keys.key_blocks] if me.shape_keys else None)
        for m in me.materials:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE': print('   tex', n.image.name, n.image.size[:], [l.to_socket.name for l in n.outputs[0].links])
        print('  mods', [(md.type, getattr(md, 'object', None) and md.object.name) for md in o.modifiers])
for a in bpy.data.actions: print('ACTION', a.name, a.frame_range[:])
arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if arm:
    mw = arm.matrix_world
    for b in arm.data.bones:
        h = mw @ b.head_local; t = mw @ b.tail_local
        print('BONE', b.name, 'parent', b.parent.name if b.parent else None, 'head', tuple(round(v, 3) for v in h), 'tail', tuple(round(v, 3) for v in t), 'deform', b.use_deform)
# world bbox of meshes
dg = bpy.context.evaluated_depsgraph_get(); P = []
for o in bpy.data.objects:
    if o.type == 'MESH':
        e = o.evaluated_get(dg).to_mesh(); v = np.empty(len(e.vertices) * 3); e.vertices.foreach_get('co', v); v = v.reshape(-1, 3)
        mw = np.array(o.matrix_world); P.append(v @ mw[:3, :3].T + mw[:3, 3]); o.evaluated_get(dg).to_mesh_clear()
P = np.concatenate(P); lo, hi = P.min(0), P.max(0); print('BBOX', lo.round(3), hi.round(3))
# previews: front (-Y), side (+X), back, 3/4
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
sc.render.film_transparent = True; res = 600; sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.image_settings.file_format = 'PNG'
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
H = hi[2] - lo[2]; c = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] + H / 2)); cam.data.ortho_scale = max(H, hi[0] - lo[0], hi[1] - lo[1]) * 1.1
for nm, d in [('front', (0, -1, 0.1)), ('side', (1, 0, 0.1)), ('back', (0, 1, 0.1)), ('q34', (0.7, -0.7, 0.45))]:
    d = Vector(d).normalized(); cam.location = c + d * H * 4; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out, f'glb_{nm}.png'); bpy.ops.render.render(write_still=True)
print('done')
