# micro's cover: the Morro Miúdo field sheet on a desk, three painted glass section plates put down on it,
# a pencil. The sheet and the plates are drawn by plates-data.mjs from deposit.mjs; this lays them out and
# renders them in Cycles.
#
#   blender -b -P tools/micro/docs/manual/cover/plates.py -- [--res 1400] [--samples 256] [--out path.png]
#
# Units: metres, true size (A3 sheet 0.42 × 0.297, plates 0.15 × 0.08 × 0.003). z up; the sheet lies at z 0.
import bpy, json, math, os, sys, random

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
RES = arg('--res', 1000)
SAMPLES = arg('--samples', 128)
OUT = arg('--out', os.path.join(HERE, 'plates.png'))
LAMP_W = arg('--lamp', 42.0); FILL_W = arg('--fill', 0.7); STRIP_W = arg('--strip', 5.0); WORLD = arg('--world', 0.07); CARD_W = arg('--card', 6.0)
EXPOSURE = arg('--exposure', -0.6)
HDRI = os.path.join(HERE, 'assets', 'brown_photostudio_02_2k.hdr')   # Poly Haven, CC0 (build.mjs fetches it)

cfg = json.load(open(os.path.join(HERE, 'plates.json')))
rng = random.Random(2026)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
nodes_of = lambda m: m.node_tree.nodes
def link(m, a, b): m.node_tree.links.new(a, b)

# ── the sheet: a subdivided plane, a gentle wave, one old fold (it was folded in half, A4-wise) ──────────────
SW, SH = cfg['sheet']['w'] / 1000, cfg['sheet']['h'] / 1000
bpy.ops.mesh.primitive_grid_add(x_subdivisions=280, y_subdivisions=200, size=1, calc_uvs=True)
sheet = bpy.context.active_object; sheet.name = 'sheet'
for v in sheet.data.vertices:
    x, y = v.co.x * SW, v.co.y * SH
    z = 0.0012 * math.exp(-(x / 0.012) ** 2)                      # the fold, still a little tented
    z += 0.0009 * math.sin(x * 9.0 + 0.7) * math.cos(y * 7.0)      # the paper never lies quite flat
    # under the glass the paper is pressed flat: the wave and the fold fade out over the plates' footprint
    def fade(a, lo, hi, w=0.03): return min(1.0, max(0.0, (lo - a) / w, (a - hi) / w))
    z *= max(fade(x, -0.175, 0.07), fade(y, -0.095, 0.125))
    z += 0.004 * max(0.0, (x - 0.17) / 0.04) ** 2 * max(0.0, (-y - 0.10) / 0.05)   # a corner lifts (lower right)
    v.co = (x, y, max(z, 0.0) + 0.0002)
bpy.ops.object.shade_smooth()

m = bpy.data.materials.new('paper'); m.use_nodes = True; n = nodes_of(m); bsdf = n['Principled BSDF']
tex = n.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(os.path.join(HERE, cfg['sheet']['texture'])); tex.interpolation = 'Cubic'
grain = n.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value = 900; grain.inputs['Detail'].default_value = 6
bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.06; bump.inputs['Distance'].default_value = 0.0002
age = n.new('ShaderNodeTexNoise'); age.inputs['Scale'].default_value = 3.0; age.inputs['Detail'].default_value = 3
tone = n.new('ShaderNodeMix'); tone.data_type = 'RGBA'; tone.blend_type = 'MULTIPLY'; tone.inputs['Factor'].default_value = 0.10
ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.86, 0.80, 0.68, 1); ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
link(m, age.outputs['Fac'], ramp.inputs['Fac'])
link(m, tex.outputs['Color'], tone.inputs['A']); link(m, ramp.outputs['Color'], tone.inputs['B'])
link(m, tone.outputs['Result'], bsdf.inputs['Base Color'])
link(m, grain.outputs['Fac'], bump.inputs['Height']); link(m, bump.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.82
bsdf.inputs['Subsurface Weight'].default_value = 0.08; bsdf.inputs['Subsurface Radius'].default_value = (0.002, 0.0015, 0.001)
bsdf.inputs['Sheen Weight'].default_value = 0.15
sheet.data.materials.append(m)

# ── the plates: soda-lime glass, the section painted on the top face ──────────────────────────────────────────
PW, PH, PT = cfg['plate']['w'] / 1000, cfg['plate']['h'] / 1000, cfg['plate']['t'] / 1000

def glass_material():
    m = bpy.data.materials.new('glass'); m.use_nodes = True; n = nodes_of(m); b = n['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.975, 0.992, 0.98, 1)   # the green of a soda-lime edge (light: it compounds per bounce)
    b.inputs['Transmission Weight'].default_value = 1.0; b.inputs['Roughness'].default_value = 0.015; b.inputs['IOR'].default_value = 1.52
    # shadows through it: clear (a hint of green), not black — no caustics needed
    lp = n.new('ShaderNodeLightPath'); tr = n.new('ShaderNodeBsdfTransparent'); tr.inputs['Color'].default_value = (0.9, 0.95, 0.92, 1)
    mix = n.new('ShaderNodeMixShader'); out = n['Material Output']
    link(m, lp.outputs['Is Shadow Ray'], mix.inputs['Fac']); link(m, b.outputs['BSDF'], mix.inputs[1]); link(m, tr.outputs['BSDF'], mix.inputs[2])
    link(m, mix.outputs['Shader'], out.inputs['Surface'])
    return m
GLASS = glass_material()

def paint_material(path):
    m = bpy.data.materials.new('paint'); m.use_nodes = True; n = nodes_of(m); b = n['Principled BSDF']; out = n['Material Output']
    t = n.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path); t.interpolation = 'Cubic'
    t.image.alpha_mode = 'STRAIGHT'
    b.inputs['Roughness'].default_value = 0.55; b.inputs['Coat Weight'].default_value = 0.0
    link(m, t.outputs['Color'], b.inputs['Base Color'])
    clear = n.new('ShaderNodeBsdfTransparent')
    lit = n.new('ShaderNodeMixShader')                    # paint where alpha, clear glass elsewhere
    link(m, t.outputs['Alpha'], lit.inputs['Fac']); link(m, clear.outputs['BSDF'], lit.inputs[1]); link(m, b.outputs['BSDF'], lit.inputs[2])
    # for shadow rays: the paint's colour, as a stained-glass shadow (paint lets a little light through)
    tint = n.new('ShaderNodeBsdfTransparent'); dim = n.new('ShaderNodeMix'); dim.data_type = 'RGBA'; dim.inputs['Factor'].default_value = 0.55
    dim.inputs['B'].default_value = (0, 0, 0, 1); link(m, t.outputs['Color'], dim.inputs['A']); link(m, dim.outputs['Result'], tint.inputs['Color'])
    sh = n.new('ShaderNodeMixShader'); link(m, t.outputs['Alpha'], sh.inputs['Fac']); link(m, clear.outputs['BSDF'], sh.inputs[1]); link(m, tint.outputs['BSDF'], sh.inputs[2])
    lp = n.new('ShaderNodeLightPath'); fin = n.new('ShaderNodeMixShader')
    link(m, lp.outputs['Is Shadow Ray'], fin.inputs['Fac']); link(m, lit.outputs['Shader'], fin.inputs[1]); link(m, sh.outputs['Shader'], fin.inputs[2])
    link(m, fin.outputs['Shader'], out.inputs['Surface'])
    m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else None
    return m

def plate(i, path, loc, rot_z, tilt=(0, 0)):
    """a plate lying at `loc` (centre of its bottom face), turned `rot_z` degrees, tilted (about x, y) degrees"""
    bpy.ops.mesh.primitive_cube_add(size=1)
    g = bpy.context.active_object; g.name = f'plate{i}'; g.scale = (PW, PH, PT)
    bpy.ops.object.transform_apply(scale=True)
    bev = g.modifiers.new('bevel', 'BEVEL'); bev.width = 0.0004; bev.segments = 3      # ground edges catch the light
    g.data.materials.append(GLASS)
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = bpy.context.active_object; p.name = f'paint{i}'; p.scale = (PW * 0.996, PH * 0.996, 1)
    bpy.ops.object.transform_apply(scale=True)
    p.location = (0, 0, PT / 2 + 0.00004); p.parent = g
    p.data.materials.append(paint_material(path))
    g.location = (loc[0], loc[1], loc[2] + PT / 2)
    g.rotation_euler = (math.radians(tilt[0]), math.radians(tilt[1]), math.radians(rot_z))
    return g

T = [os.path.join(HERE, t) for t in cfg['plate']['textures']]
# put down one after another, carelessly: each dropped a few millimetres and left to settle where it lands (rigid
# bodies) — A on the paper, B partly over A, C across both. Placed left of centre: the cover shows the render's
# left half, and the sheet's title block stays out of it.
DROPS = [((-0.115, -0.040), -7, 0.003), ((-0.072, 0.010), 6, 0.009), ((-0.040, 0.056), 15, 0.015)]   # (x, y), turn°, height
plates = [plate(i, T[i], (x, y, h), rz) for i, ((x, y), rz, h) in enumerate(DROPS)]

def rigid(ob, kind, **props):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.rigidbody.object_add(type=kind)
    for k, v in props.items(): setattr(ob.rigid_body, k, v)
bpy.ops.rigidbody.world_add()
rw = scene.rigidbody_world; rw.solver_iterations = 40
try: rw.substeps_per_frame = 40
except AttributeError: pass
FRAMES = 150
rw.point_cache.frame_start = 1; rw.point_cache.frame_end = FRAMES; scene.frame_start = 1; scene.frame_end = FRAMES
# the desk under the (flattened) paper: a thick invisible box whose top is the paper's surface — a thin mesh
# collider lets small fast bodies tunnel straight through it
bpy.ops.mesh.primitive_cube_add(size=1)
desk = bpy.context.active_object; desk.name = 'desk'; desk.scale = (SW, SH, 0.02); desk.location = (0, 0, 0.0002 - 0.01)
desk.hide_render = True
rigid(desk, 'PASSIVE', collision_shape='BOX', friction=0.7, use_margin=True, collision_margin=0.00005)
for g in plates:
    rigid(g, 'ACTIVE', collision_shape='BOX', mass=0.09, friction=0.55, use_margin=True, collision_margin=0.00005,
          linear_damping=0.5, angular_damping=0.6)
for f in range(1, FRAMES + 1): scene.frame_set(f)
dg = bpy.context.evaluated_depsgraph_get()
for g in plates:
    mw = g.evaluated_get(dg).matrix_world
    print(f'{g.name} settled at z {mw.translation.z * 1000:.2f} mm, tilt {math.degrees(mw.to_euler().x):.2f}°/{math.degrees(mw.to_euler().y):.2f}°')

# ── ground: a shadow catcher, so the sheet lands on the cover's basalt ──
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
ground = bpy.context.active_object; ground.is_shadow_catcher = True

# ── light: a dim warm studio for the ambient and the glass's reflections; a desk lamp's soft key from the upper
#    left; a long strip behind, which only the glass sees, to draw its edges ──
world = bpy.data.worlds.new('studio'); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; bg = wn['Background']
if os.path.exists(HDRI):
    env = wn.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
    mapping = wn.new('ShaderNodeMapping'); coord = wn.new('ShaderNodeTexCoord')
    mapping.inputs['Rotation'].default_value = (0, 0, math.radians(200))
    world.node_tree.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    world.node_tree.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    world.node_tree.links.new(env.outputs['Color'], bg.inputs['Color'])
    # dim: a bright world is what the glass's clear margin reflects, and it reads as milk
    bg.inputs['Strength'].default_value = WORLD
else:
    print('no HDRI at', HDRI, '— a plain dim world instead'); bg.inputs['Color'].default_value = (0.04, 0.035, 0.03, 1)

def aim(ob, at):
    d = [at[i] - ob.location[i] for i in range(3)]
    ob.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)

# the desk lamp: a warm spot, soft-shadowed, its pool centred on the plates and falling off toward the sheet's corners
LAMP_AT = (-0.075, 0.010, 0)
key_d = bpy.data.lights.new('lamp', 'SPOT'); key_d.energy = LAMP_W; key_d.color = (1.0, 0.85, 0.66)
key_d.spot_size = math.radians(62); key_d.spot_blend = 1.0; key_d.shadow_soft_size = 0.035
key = bpy.data.objects.new('lamp', key_d); scene.collection.objects.link(key)
key.location = (-0.30, 0.21, 0.52); aim(key, LAMP_AT)
# a broad dim fill from above, so the corners fall to shade, not to black — and the glass never sees it
fill_d = bpy.data.lights.new('fill', 'AREA'); fill_d.size = 1.6; fill_d.energy = FILL_W; fill_d.color = (0.92, 0.95, 1.0)
fill = bpy.data.objects.new('fill', fill_d); scene.collection.objects.link(fill)
fill.location = (0.0, -0.1, 1.2); aim(fill, (0, 0, 0))
fill.visible_glossy = False; fill.visible_camera = False
# a white card behind the camera that only reflections see: the lifted plates' front edges face the camera, and
# mirroring a dark room they read as black bars
card_d = bpy.data.lights.new('card', 'AREA'); card_d.size = 0.6; card_d.size_y = 0.25; card_d.shape = 'RECTANGLE'; card_d.energy = CARD_W
card = bpy.data.objects.new('card', card_d); scene.collection.objects.link(card)
card.location = (0.05, -0.85, 0.35); aim(card, (-0.07, 0.01, 0.004))
card.visible_diffuse = False; card.visible_camera = False
strip_d = bpy.data.lights.new('strip', 'AREA'); strip_d.shape = 'RECTANGLE'; strip_d.size = 1.2; strip_d.size_y = 0.08; strip_d.energy = STRIP_W
strip = bpy.data.objects.new('strip', strip_d); scene.collection.objects.link(strip)
strip.location = (0.05, 0.55, 0.30); aim(strip, (0.02, 0.0, 0))
strip.visible_camera = False; strip.visible_diffuse = False

# ── camera: from the front, looking down at the sheet like a person standing at the desk ──
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 70
cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam
el, dist, look = math.radians(52), 0.80, (-0.02, 0.0, 0.0)
cam.location = (look[0] + 0.12, look[1] - dist * math.cos(el), dist * math.sin(el)); aim(cam, look)
cam_d.dof.use_dof = True; cam_d.dof.focus_object = bpy.data.objects['plate1']; cam_d.dof.aperture_fstop = 7.0

# ── render ──
r = scene.render
r.engine = 'CYCLES'; r.resolution_x = RES; r.resolution_y = RES; r.film_transparent = True
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.filepath = OUT
cy = scene.cycles; cy.samples = SAMPLES; cy.use_denoising = True
cy.max_bounces = 16; cy.transmission_bounces = 16; cy.transparent_max_bounces = 16
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'HIP'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    cy.device = 'GPU'
except Exception as e:
    print('GPU unavailable, rendering on the CPU:', e)
scene.view_settings.view_transform = 'AgX'; scene.view_settings.exposure = EXPOSURE
try: scene.view_settings.look = 'AgX - Punchy'
except Exception: pass
bpy.ops.render.render(write_still=True)
print('wrote', OUT)
