# Which emission makes a surface come out as the page's basalt (#161616) under plates.py's view transform?
# AgX is not linear in the darks, so this is measured, not computed:
#   blender -b -P basalt-calib.py -- [--exposure -0.6]
# prints, per candidate emission, the 8-bit value it renders to; plates.py's BASALT_EMIT comes from here.
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
EXPOSURE = float(argv[argv.index('--exposure') + 1]) if '--exposure' in argv else -0.6
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.active_object
m = bpy.data.materials.new('e'); m.use_nodes = True; n = m.node_tree.nodes; n.remove(n['Principled BSDF'])
em = n.new('ShaderNodeEmission'); m.node_tree.links.new(em.outputs['Emission'], n['Material Output'].inputs['Surface'])
plane.data.materials.append(m)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.location = (0, 0, 3)
r = scene.render; r.engine = 'CYCLES'; r.resolution_x = r.resolution_y = 8; scene.cycles.samples = 1; scene.cycles.use_denoising = False
r.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'; scene.view_settings.exposure = EXPOSURE
try: scene.view_settings.look = 'AgX - Punchy'
except Exception: pass
import tempfile, os
out = os.path.join(tempfile.gettempdir(), 'basalt-calib.png')
for e in [0.008, 0.016, 0.024, 0.032, 0.04, 0.048, 0.056, 0.064, 0.08]:
    em.inputs['Color'].default_value = (e, e, e, 1)
    r.filepath = out; bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out, check_existing=False)
    px = img.pixels[:]                           # linear floats of the saved (display-encoded) PNG
    v = px[(4 * 8 + 4) * 4]                       # a centre pixel's red
    print(f'CALIB emission {e:.3f} -> {round(v * 255)} / 255')
    bpy.data.images.remove(img)
