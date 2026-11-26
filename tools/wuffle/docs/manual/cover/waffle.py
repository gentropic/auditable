# The wuffle: a waffle whose grid is a lower-hemisphere equal-area stereonet, chocolate chips at the Tocher
# (1979) poles, maple syrup pooled where their Kamb density is ≥ 4σ. Geometry from waffle.json (made by
# waffle-data.mjs from wuffle's own maths); rendered with Cycles.
#
#   blender -b -P tools/wuffle/docs/manual/cover/waffle.py -- [--res 2800] [--samples 512] [--out path.png]
#
# Units: the net's unit disc is the waffle's radius (call it 10 cm); z up; x east, y north.
import bpy, bmesh, json, math, os, sys, random
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
RES = arg('--res', 1000)
SAMPLES = arg('--samples', 128)
OUT = arg('--out', os.path.join(HERE, 'waffle.png'))

data = json.load(open(os.path.join(HERE, 'waffle.json')))
rng = random.Random(1979)

# ── the scene, emptied ──
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ── the waffle's height: ridges along the graticule, pockets between, a rim at the primitive ──
N = 1100                     # heightfield resolution across [-L, L]
L = 1.075
xs = np.linspace(-L, L, N)
X, Y = np.meshgrid(xs, xs[::-1])          # row 0 = north
pix = xs[1] - xs[0]
R = np.hypot(X, Y)

FLOOR, TOP = 0.165, 0.235    # pocket floor and ridge crest
HALF, FLANK = 0.02, 0.024   # ridge half-width at the crest, and the flank's width

# distance from every node to the nearest graticule line (per segment, within a small window)
D = np.full((N, N), 1.0)
reach = HALF + FLANK + 2 * pix
for curve in data['graticule']:
    P = np.array(curve)
    for a, b in zip(P[:-1], P[1:]):
        lo = np.minimum(a, b) - reach; hi = np.maximum(a, b) + reach
        i0 = max(0, int((lo[0] + L) / pix)); i1 = min(N, int((hi[0] + L) / pix) + 2)
        j0 = max(0, int((L - hi[1]) / pix)); j1 = min(N, int((L - lo[1]) / pix) + 2)
        if i0 >= i1 or j0 >= j1: continue
        px = X[j0:j1, i0:i1]; py = Y[j0:j1, i0:i1]
        ab = b - a; t = np.clip(((px - a[0]) * ab[0] + (py - a[1]) * ab[1]) / max(ab @ ab, 1e-12), 0, 1)
        d = np.hypot(px - (a[0] + t * ab[0]), py - (a[1] + t * ab[1]))
        D[j0:j1, i0:i1] = np.minimum(D[j0:j1, i0:i1], d)
# the primitive itself: a broader rim
D = np.minimum(D, np.abs(R - 1.0) * 0.55)

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

ridge = smooth(HALF + FLANK, HALF, D)                       # 1 on the crest, 0 in a pocket
crest_round = 1 - 0.12 * (np.clip(D / HALF, 0, 1) ** 2)      # a softly rounded crest
pocket_dish = 1.0    # flat pocket floors (D is only exact near a line: a dish keyed on it stepped mid-pocket)
Z = FLOOR * pocket_dish + (TOP * crest_round - FLOOR * pocket_dish) * ridge
# the edge: beyond the rim the waffle rounds down to its side
edge = smooth(1.03, 1.072, R)
Z = Z * (1 - edge) + 0.05 * edge
Z += 0.004 * np.sin(X * 37 + Y * 11) * np.cos(Y * 29 - X * 7)          # a baked, not machined, surface
INSIDE = R <= L - pix

# browning: crests and rim browner, pockets paler, with a slow blotch
blotch = 0.5 + 0.5 * np.sin(X * 5.1 + 1.3) * np.sin(Y * 4.3 - 0.7)
crest = smooth(HALF, 0, D)                                  # the very top of a ridge: where the iron browns it most
BROWN = np.clip(0.18 + 0.55 * ridge ** 0.7 + 0.3 * crest + 0.3 * smooth(0.96, 1.04, R) + 0.2 * blotch - 0.12 * smooth(0.0, 0.6, 1 - R), 0, 1)

def height_at(x, y):
    i = (x + L) / pix; j = (L - y) / pix
    i0 = int(np.clip(math.floor(i), 0, N - 2)); j0 = int(np.clip(math.floor(j), 0, N - 2)); fi = i - i0; fj = j - j0
    return float(Z[j0, i0] * (1 - fi) * (1 - fj) + Z[j0, i0 + 1] * fi * (1 - fj) + Z[j0 + 1, i0] * (1 - fi) * fj + Z[j0 + 1, i0 + 1] * fi * fj)

def grid_mesh(name, Zs, mask, attr=None):
    """a heightfield over the masked nodes → a mesh object (faces only where all four corners are in)"""
    idx = -np.ones((N, N), dtype=np.int64)
    js, is_ = np.nonzero(mask)
    idx[js, is_] = np.arange(len(js))
    verts = np.stack([X[js, is_], Y[js, is_], Zs[js, is_]], axis=1)
    q = mask[:-1, :-1] & mask[:-1, 1:] & mask[1:, :-1] & mask[1:, 1:]
    fj, fi = np.nonzero(q)
    faces = np.stack([idx[fj, fi], idx[fj + 1, fi], idx[fj + 1, fi + 1], idx[fj, fi + 1]], axis=1)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.shade_smooth() if hasattr(me, 'shade_smooth') else None
    if attr is not None:
        a = me.attributes.new('brown', 'FLOAT', 'POINT'); a.data.foreach_set('value', attr[js, is_].astype(np.float32))
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob

waffle = grid_mesh('waffle', Z, INSIDE, BROWN)
if '--debug-brown' in argv:
    pk = BROWN[INSIDE & (ridge < 0.05)]; cr = BROWN[INSIDE & (crest > 0.8)]
    print('DEBUG brown pockets', np.percentile(pk, [10, 50, 90]).round(3), 'crests', np.percentile(cr, [10, 50, 90]).round(3),
          'attr', np.percentile([v.value for v in waffle.data.attributes['brown'].data], [10, 50, 90]).round(3))
# its underside and side: a squat rounded cylinder beneath
bpy.ops.mesh.primitive_cylinder_add(vertices=256, radius=1.055, depth=0.05, location=(0, 0, 0.022))
bev = bpy.context.active_object.modifiers.new('round', 'BEVEL'); bev.width = 0.02; bev.segments = 6   # a rounded edge, not a plinth
base = bpy.context.active_object; base.name = 'waffle-base'
bpy.ops.object.shade_smooth()
ba = base.data.attributes.new('brown', 'FLOAT', 'POINT')          # the side is crust: well browned
ba.data.foreach_set('value', np.full(len(base.data.vertices), 0.78, dtype=np.float32))

# ── the syrup: where the Kamb density is ≥ 4σ, filling the pockets, over the ridges where the poles crowd ──
K = data['kamb']; ks = K['size']; kst = K['step']
kv = np.array([np.nan if v is None else v for v in K['values']], dtype=float).reshape(ks, ks)
gi = np.clip((X + 1) / kst, 0, ks - 1.001); gj = np.clip((1 - Y) / kst, 0, ks - 1.001)
i0 = np.floor(gi).astype(int); j0 = np.floor(gj).astype(int); fi = gi - i0; fj = gj - j0
def at(a, b): return kv[np.clip(b, 0, ks - 1), np.clip(a, 0, ks - 1)]
S = at(i0, j0) * (1 - fi) * (1 - fj) + at(i0 + 1, j0) * fi * (1 - fj) + at(i0, j0 + 1) * (1 - fi) * fj + at(i0 + 1, j0 + 1) * fi * fj
S = np.nan_to_num(S, nan=0.0)
wet = smooth(3.7, 4.6, S)                                   # the edge of the pool is the 4σ contour
level = FLOOR + (TOP - FLOOR) * 0.9 + 0.035 * smooth(4.5, 9, S)   # pockets brimming; a sheet over the crests where densest
Zs = np.maximum(Z + 0.004, level) * wet + Z * (1 - wet) + 0.003 * wet
mask_s = (wet > 0.02) & INSIDE & (R < 1.0)
syrup = grid_mesh('syrup', Zs, mask_s)
sol = syrup.modifiers.new('body', 'SOLIDIFY'); sol.thickness = 0.03; sol.offset = -1

# ── the chips: a teardrop at every pole ──
def lathe(profile, segs=48):
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)] if r > 1e-6 else [bm.verts.new((0, 0, z))]
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(segs):
            if len(a) == 1: bm.faces.new((a[0], b[k], b[(k + 1) % segs]))
            elif len(b) == 1: bm.faces.new((a[k], a[(k + 1) % segs], b[0]))
            else: bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    me = bpy.data.meshes.new('chip'); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return me
# a chocolate chip: flat-ish base, a curving cone to a soft point (radius 1 → scaled below)
prof = [(0.0, 0.0)] + [(math.sin(math.pi / 2 * t) ** 0.6 * 1.0, 0.02 * t) for t in (0.3, 0.7, 1.0)] + \
       [((1 - t) ** 1.35 * 1.0, 0.02 + 1.05 * t) for t in np.linspace(0.06, 0.94, 14)] + [(0.0, 1.1)]
chip_mesh = lathe(prof)
CHIP = 0.032
for k, (x, y) in enumerate(data['chips']):
    ob = bpy.data.objects.new(f'chip{k}', chip_mesh); scene.collection.objects.link(ob)
    s = CHIP * rng.uniform(0.82, 1.15)
    ob.scale = (s, s * rng.uniform(0.9, 1.1), s * rng.uniform(0.9, 1.25))
    ob.location = (x, y, height_at(x, y) - 0.004)
    ob.rotation_euler = (rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(0, 2 * math.pi))

# ── materials ──
def principled(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']
# dough
m, nt, bsdf = principled('dough')
att = nt.nodes.new('ShaderNodeAttribute'); att.attribute_name = 'brown'
ramp = nt.nodes.new('ShaderNodeValToRGB')
# (linear colors) pale batter in the pockets → golden → deep caramel on the crests and the rim
# (linear values: sRGB ~ (214,156,74) golden batter, (178,102,40) caramel, (112,54,18) deep crust)
ramp.color_ramp.elements[0].position = 0.15; ramp.color_ramp.elements[0].color = (0.72, 0.43, 0.11, 1)
ramp.color_ramp.elements[1].position = 0.95; ramp.color_ramp.elements[1].color = (0.2, 0.07, 0.012, 1)
mid = ramp.color_ramp.elements.new(0.5); mid.color = (0.46, 0.2, 0.04, 1)
noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 9; noise.inputs['Detail'].default_value = 10; noise.inputs['Roughness'].default_value = 0.6
mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'
center = nt.nodes.new('ShaderNodeMath'); center.operation = 'SUBTRACT'; center.inputs[1].default_value = 0.5
nt.links.new(noise.outputs['Fac'], center.inputs[0]); nt.links.new(center.outputs['Value'], mix.inputs[0])
mix.inputs[1].default_value = 0.7; nt.links.new(att.outputs['Fac'], mix.inputs[2])
# toasted speckle: a fine darker freckling over the crust, mostly on the browned crests
speck = nt.nodes.new('ShaderNodeTexNoise'); speck.inputs['Scale'].default_value = 140; speck.inputs['Detail'].default_value = 4
speckr = nt.nodes.new('ShaderNodeMapRange'); speckr.inputs['From Min'].default_value = 0.55; speckr.inputs['From Max'].default_value = 0.75
nt.links.new(speck.outputs['Fac'], speckr.inputs['Value'])
speckw = nt.nodes.new('ShaderNodeMath'); speckw.operation = 'MULTIPLY'
nt.links.new(speckr.outputs['Result'], speckw.inputs[0]); nt.links.new(att.outputs['Fac'], speckw.inputs[1])
burnt = nt.nodes.new('ShaderNodeMix'); burnt.data_type = 'RGBA'; burnt.blend_type = 'MULTIPLY'
nt.links.new(speckw.outputs['Value'], burnt.inputs['Factor']); nt.links.new(ramp.outputs['Color'], burnt.inputs['A'])
burnt.inputs['B'].default_value = (0.45, 0.3, 0.2, 1)
nt.links.new(burnt.outputs['Result'], bsdf.inputs['Base Color'])
if '--debug-brown' in argv: nt.links.new(att.outputs['Fac'], bsdf.inputs['Base Color'])   # see the browning field itself
bsdf.inputs['Roughness'].default_value = 0.5
bsdf.inputs['Coat Weight'].default_value = 0.12; bsdf.inputs['Coat Roughness'].default_value = 0.35   # a little butter
bsdf.inputs['Subsurface Weight'].default_value = 0.12
bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.75, 0.4)
bsdf.inputs['Subsurface Scale'].default_value = 0.01
pores = nt.nodes.new('ShaderNodeTexVoronoi'); pores.inputs['Scale'].default_value = 260
fine = nt.nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 420; fine.inputs['Detail'].default_value = 6
add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
nt.links.new(pores.outputs['Distance'], add.inputs[0]); nt.links.new(fine.outputs['Fac'], add.inputs[1])
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.002
nt.links.new(add.outputs['Value'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
waffle.data.materials.append(m); base.data.materials.append(m)
# chocolate
m, nt, bsdf = principled('chocolate')
bsdf.inputs['Base Color'].default_value = (0.075, 0.03, 0.012, 1)
bsdf.inputs['Roughness'].default_value = 0.42
bsdf.inputs['Specular IOR Level'].default_value = 0.35
chip_mesh.materials.append(m)
# maple syrup: clear amber with absorption, glossy
m, nt, bsdf = principled('syrup')
bsdf.inputs['Base Color'].default_value = (0.95, 0.62, 0.25, 1)
bsdf.inputs['Transmission Weight'].default_value = 1.0
bsdf.inputs['IOR'].default_value = 1.48
bsdf.inputs['Roughness'].default_value = 0.015
vol = nt.nodes.new('ShaderNodeVolumeAbsorption'); vol.inputs['Color'].default_value = (0.9, 0.5, 0.12, 1); vol.inputs['Density'].default_value = 3.5
nt.links.new(vol.outputs['Volume'], nt.nodes['Material Output'].inputs['Volume'])
syrup.data.materials.append(m)

# ── the ground: a shadow catcher, so the waffle lands on the cover's basalt ──
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.01))
ground = bpy.context.active_object; ground.is_shadow_catcher = True

# ── light: a low sun raking across the ridges from the north-west, a sky for the fill ──
world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
try: sky.sky_type = 'NISHITA'
except Exception: pass
sky.sun_elevation = math.radians(32); sky.sun_rotation = math.radians(130)
try: sky.sun_disc = False          # the sun is the lamp below; the sky is only the ambient
except Exception: pass
bg = world.node_tree.nodes['Background']; bg.inputs['Strength'].default_value = 0.06
world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 4.0; sun_data.angle = math.radians(2.5); sun_data.color = (1.0, 0.92, 0.82)
sun = bpy.data.objects.new('sun', sun_data); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(58), 0, math.radians(-125))
fill_data = bpy.data.lights.new('fill', 'AREA'); fill_data.energy = 12; fill_data.size = 3; fill_data.color = (0.85, 0.9, 1.0)
fill = bpy.data.objects.new('fill', fill_data); scene.collection.objects.link(fill)
fill.location = (2.2, -2.0, 2.4); fill.rotation_euler = (math.radians(50), 0, math.radians(45))
# the glint: a broad softbox mirrored about the waffle's surface from the camera (north, as high as the
# lens), so the syrup's surface and the buttered crust reflect it back — what makes a liquid look wet
glint_data = bpy.data.lights.new('glint', 'AREA'); glint_data.energy = 260; glint_data.size = 2.6; glint_data.size_y = 1.4
glint_data.shape = 'RECTANGLE'; glint_data.color = (1.0, 0.96, 0.9)
glint = bpy.data.objects.new('glint', glint_data); scene.collection.objects.link(glint)
gel, gd = math.radians(64), 6.0
glint.location = (0.4, gd * math.cos(gel), gd * math.sin(gel))
gdir = [-glint.location[0], -glint.location[1], 0.15 - glint.location[2]]
glint.rotation_euler = (math.atan2(math.hypot(gdir[0], gdir[1]), -gdir[2]), 0, math.atan2(gdir[1], gdir[0]) - math.pi / 2)
glint.visible_camera = False
glint.visible_diffuse = False      # reflections only: it must not wash the crust's diffuse color

# ── camera: high and a little south, so it still reads as a net; a touch of depth of field ──
cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 85
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
el, dist = math.radians(66), 6.4
cam.location = (0, -dist * math.cos(el), dist * math.sin(el) + 0.15)
look = (0, 0.02, 0.15)
d = [look[i] - cam.location[i] for i in range(3)]
cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
cam_data.dof.use_dof = True; cam_data.dof.focus_distance = dist; cam_data.dof.aperture_fstop = 5.6

# ── render ──
r = scene.render
r.engine = 'CYCLES'; r.resolution_x = RES; r.resolution_y = RES; r.film_transparent = True
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.filepath = OUT
cy = scene.cycles; cy.samples = SAMPLES; cy.use_denoising = True
cy.max_bounces = 16; cy.transmission_bounces = 16; cy.volume_bounces = 4
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'HIP'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    cy.device = 'GPU'
except Exception as e:
    print('GPU unavailable, rendering on the CPU:', e)
scene.view_settings.view_transform = 'AgX'; scene.view_settings.exposure = 0.45
try: scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass
bpy.ops.render.render(write_still=True)
print('wrote', OUT)
