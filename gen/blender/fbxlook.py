# gen/blender/fbxlook.py — one FBX animation from four sides (front, his left, back, his right), 8 frames, to see what it is and which
# way the character faces in it:  python gen/blender/bl.py gen/blender/fbxlook.py <file.fbx> <out.png>   (paths relative to the project)
# Also prints where the hips go over the animation (root motion) and which way the feet point at its start and middle.
import bpy, sys, os, math
import numpy as np
from mathutils import Vector
ROOT = os.environ.get('ZH_ROOT', os.getcwd()); A = sys.argv[sys.argv.index('--') + 1:]
src, out = (a if os.path.isabs(a) else os.path.join(ROOT, a) for a in A[:2])
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False, ignore_leaf_bones=False)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE'); act = arm.animation_data.action if arm.animation_data else bpy.data.actions[0]
f0, f1 = act.frame_range; sc = bpy.context.scene
def bone_w(n): return arm.matrix_world @ arm.pose.bones[n].head
hips = next(n for n in ('mixamorig:Hips', 'Hips') if n in arm.pose.bones)
for f in (f0, (f0 + f1) / 2, f1):
    sc.frame_set(int(f)); h = bone_w(hips); lt = bone_w('mixamorig:LeftToeBase') - bone_w('mixamorig:LeftFoot'); rt = bone_w('mixamorig:RightToeBase') - bone_w('mixamorig:RightFoot')
    fw = (lt + rt); fw.z = 0; print(f'frame {f:.0f}: hips {tuple(round(v, 2) for v in h)}  toes point {math.degrees(math.atan2(fw.x, -fw.y)):.0f}° from −Y (+ toward +X)')
sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
res = 260; sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = res; sc.render.image_settings.file_format = 'PNG'
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
sc.frame_set(int(f0)); hz = bone_w(hips).z; cam.data.ortho_scale = hz * 2 * 1.5; tmp = out + '.tmp.png'; rows = []
for az in (0, 90, 180, 270):
    row = []
    for k in range(8):
        f = f0 + (f1 - f0) * k / 7; sc.frame_set(int(f)); c = Vector((bone_w(hips).x, bone_w(hips).y, hz))
        d = Vector((math.sin(math.radians(az)), -math.cos(math.radians(az)), 0.25)).normalized(); cam.location = c + d * 8; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = tmp; bpy.ops.render.render(write_still=True); im = bpy.data.images.load(tmp, check_existing=False)
        px = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(px); bpy.data.images.remove(im); px = px.reshape(res, res, 4)[::-1]
        row.append(px[..., :3] * px[..., 3:] + np.array([0.12, 0.13, 0.17]) * (1 - px[..., 3:]))
    rows.append(np.concatenate(row, 1))
o = np.concatenate(rows, 0); h, w = o.shape[:2]; im = bpy.data.images.new('S', w, h); im.pixels.foreach_set(np.ascontiguousarray(np.concatenate([o[::-1], np.ones((h, w, 1))], -1)).astype(np.float32).ravel())
im.filepath_raw = out; im.file_format = 'PNG'; im.save(); os.remove(tmp); print('rows: from the front (−Y), from +X, from behind, from −X')
