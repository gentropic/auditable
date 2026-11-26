# The wuffle: a waffle whose grid is a lower-hemisphere equal-area stereonet, chocolate chips at the Tocher
# (1979) poles, maple syrup pooled where their Kamb density is ≥ 4σ. Geometry from waffle.json (made by
# waffle-data.mjs from wuffle's own maths); rendered with Cycles.
#
#   blender -b -P tools/wuffle/docs/manual/cover/waffle.py -- [--res 2800] [--samples 512] [--out path.png]
#
# Units: the net's unit disc is the waffle's radius (call it 10 cm); z up; x east, y north.
# Everything placed comes from the data (the ridges, every chip, the syrup's extent); everything ELSE —
# the batter's irregularity, crumbs, which chips tipped over — is seeded noise, the same every run.
import bpy, bmesh, json, math, os, sys, random
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
RES = arg('--res', 1000)
SAMPLES = arg('--samples', 128)
OUT = arg('--out', os.path.join(HERE, 'waffle.png'))
HDRI = os.path.join(HERE, 'assets', 'brown_photostudio_02_2k.hdr')   # Poly Haven, CC0

data = json.load(open(os.path.join(HERE, 'waffle.json')))
rng = random.Random(1979)
nrng = np.random.default_rng(1979)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ── grids and noise ──
N = 1400                     # heightfield resolution across [-L, L]
L = 1.09
xs = np.linspace(-L, L, N)
X, Y = np.meshgrid(xs, xs[::-1])          # row 0 = north
pix = xs[1] - xs[0]
R = np.hypot(X, Y)

def field(scale):
    """smooth seeded noise with features ~`scale` (in waffle radii), zero mean, unit-ish amplitude (FFT-filtered)"""
    w = nrng.standard_normal((N, N))
    f = np.fft.fftfreq(N, d=pix)
    kx, ky = np.meshgrid(f, f)
    g = np.exp(-(kx ** 2 + ky ** 2) * (scale * math.pi) ** 2 / 2)
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * g))
    return out / (out.std() + 1e-12)

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

# ── distance to the graticule (the waffle's ridges) ──
HALF, FLANK = 0.02, 0.024
D = np.full((N, N), 1.0)
reach = HALF + FLANK + 3 * pix
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

# batter is not machined: the rim wanders a little, ridges rise and fall along their length
n_big, n_mid, n_fine = field(0.25), field(0.06), field(0.012)
Rw = R + 0.0025 * n_mid                                      # an irregular rim
D = np.minimum(D, np.abs(Rw - 1.0) * 0.55)

FLOOR, TOP = 0.165, 0.235
half_w = HALF * (1 + 0.05 * n_mid)                          # ridges a little wider here, narrower there
ridge = smooth(half_w + FLANK, half_w, D)
crest = smooth(half_w, 0, D)
crest_round = 1 - 0.14 * (np.clip(D / half_w, 0, 1) ** 2)
top = TOP * (1 + 0.03 * n_big + 0.008 * n_mid) + 0.0007 * n_fine          # crests uneven
floor = FLOOR * (1 + 0.04 * n_big) + 0.0035 * n_fine                        # pocket floors uneven

# batter bubbles: small round domes and dimples on the pocket floors
bub = np.zeros((N, N))
for _ in range(2600):
    cx, cy = nrng.uniform(-1, 1, 2)
    if cx * cx + cy * cy > 1: continue
    i = int((cx + L) / pix); j = int((L - cy) / pix)
    bub[j, i] += nrng.choice([1.0, -0.7])
f = np.fft.fftfreq(N, d=pix); kx, ky = np.meshgrid(f, f)
bub = np.real(np.fft.ifft2(np.fft.fft2(bub) * np.exp(-(kx ** 2 + ky ** 2) * (0.006 * math.pi) ** 2 / 2)))
bub /= (np.abs(bub).max() + 1e-12)

Z = (floor + 0.006 * bub) + (top * crest_round - (floor + 0.006 * bub)) * ridge
edge = smooth(1.03, 1.08, Rw)
Z = Z * (1 - edge) + (0.05 + 0.0015 * n_fine) * edge
INSIDE = Rw <= L - 2 * pix

# browning: the iron browns crests and rim hardest; pockets stay batter-pale; a slow blotch over it all
BROWN = np.clip(0.18 + 0.55 * ridge ** 0.7 + 0.3 * crest + 0.3 * smooth(0.96, 1.04, Rw)
                + 0.16 * n_big + 0.08 * n_mid - 0.12 * smooth(0.0, 0.6, 1 - R), 0, 1)

def height_at(x, y):
    i = (x + L) / pix; j = (L - y) / pix
    i0 = int(np.clip(math.floor(i), 0, N - 2)); j0 = int(np.clip(math.floor(j), 0, N - 2)); fi = i - i0; fj = j - j0
    return float(Z[j0, i0] * (1 - fi) * (1 - fj) + Z[j0, i0 + 1] * fi * (1 - fj) + Z[j0 + 1, i0] * (1 - fi) * fj + Z[j0 + 1, i0 + 1] * fi * fj)

def grid_mesh(name, Zs, mask, attr=None):
    idx = -np.ones((N, N), dtype=np.int64)
    js, is_ = np.nonzero(mask)
    idx[js, is_] = np.arange(len(js))
    verts = np.stack([X[js, is_], Y[js, is_], Zs[js, is_]], axis=1)
    q = mask[:-1, :-1] & mask[:-1, 1:] & mask[1:, :-1] & mask[1:, 1:]
    fj, fi = np.nonzero(q)
    faces = np.stack([idx[fj, fi], idx[fj + 1, fi], idx[fj + 1, fi + 1], idx[fj, fi + 1]], axis=1)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    if attr is not None:
        a = me.attributes.new('brown', 'FLOAT', 'POINT'); a.data.foreach_set('value', attr[js, is_].astype(np.float32))
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    return ob

def set_brown(ob, v):
    a = ob.data.attributes.new('brown', 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.full(len(ob.data.vertices), v, dtype=np.float32))

waffle = grid_mesh('waffle', Z, INSIDE, BROWN)
bpy.ops.mesh.primitive_cylinder_add(vertices=256, radius=1.06, depth=0.05, location=(0, 0, 0.022))
base = bpy.context.active_object; base.name = 'waffle-base'
bev = base.modifiers.new('round', 'BEVEL'); bev.width = 0.02; bev.segments = 6
for p in base.data.polygons: p.use_smooth = True
set_brown(base, 0.8)

# ── crumbs: a few on the waffle (mostly toward the rim) and a few that fell beside it ──
crumbs = []
for k in range(70):
    on_waffle = k < 40
    if on_waffle:
        a = rng.uniform(0, 2 * math.pi); r = 1 - abs(rng.gauss(0, 0.12)); x, y = r * math.cos(a), r * math.sin(a); z = height_at(x, y)
    else:
        a = rng.uniform(math.radians(200), math.radians(320)); r = rng.uniform(1.1, 1.45); x, y, z = r * math.cos(a), r * math.sin(a), 0.0
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(x, y, z))
    c = bpy.context.active_object
    for v in c.data.vertices: v.co *= rng.uniform(0.6, 1.2)
    s = rng.uniform(0.006, 0.016)
    c.scale = (s * rng.uniform(0.7, 1.4), s * rng.uniform(0.7, 1.4), s * rng.uniform(0.5, 0.9))
    c.rotation_euler = (rng.uniform(0, 6.3), rng.uniform(0, 6.3), rng.uniform(0, 6.3))
    for p in c.data.polygons: p.use_smooth = True
    set_brown(c, rng.uniform(0.35, 0.85)); crumbs.append(c)

# ── the syrup: where the Kamb density is ≥ 4σ; brimming the pockets, a sheet over the crests where densest ──
K = data['kamb']; ks = K['size']; kst = K['step']
kv = np.array([np.nan if v is None else v for v in K['values']], dtype=float).reshape(ks, ks)
gi = np.clip((X + 1) / kst, 0, ks - 1.001); gj = np.clip((1 - Y) / kst, 0, ks - 1.001)
i0 = np.floor(gi).astype(int); j0 = np.floor(gj).astype(int); fi = gi - i0; fj = gj - j0
def at(a, b): return kv[np.clip(b, 0, ks - 1), np.clip(a, 0, ks - 1)]
S = at(i0, j0) * (1 - fi) * (1 - fj) + at(i0 + 1, j0) * fi * (1 - fj) + at(i0, j0 + 1) * (1 - fi) * fj + at(i0 + 1, j0 + 1) * fi * fj
S = np.nan_to_num(S, nan=0.0)
wet = smooth(3.7, 4.6, S)
level = FLOOR + (TOP - FLOOR) * 0.9 + 0.035 * smooth(4.5, 9, S) + 0.002 * n_mid
Zs = np.maximum(Z + 0.004, level) * wet + Z * (1 - wet) + 0.003 * wet
mask_s = (wet > 0.02) & INSIDE & (Rw < 1.0)
syrup = grid_mesh('syrup', Zs, mask_s)
sol = syrup.modifiers.new('body', 'SOLIDIFY'); sol.thickness = 0.03; sol.offset = -1
def wet_at(x, y):
    i = int(np.clip((x + L) / pix, 0, N - 1)); j = int(np.clip((L - y) / pix, 0, N - 1)); return float(wet[j, i])

# drips: where the pool reaches the rim, syrup runs over it and down the side (metaballs: they flow)
mb = bpy.data.metaballs.new('drips'); mb.resolution = 0.006; mb.render_resolution = 0.004; mb.threshold = 0.6
drip_obj = bpy.data.objects.new('drips', mb); scene.collection.objects.link(drip_obj)
starts = []
for a in np.linspace(0, 2 * math.pi, 720, endpoint=False):
    x, y = 0.985 * math.cos(a), 0.985 * math.sin(a)
    if wet_at(x, y) > 0.7 and all(abs(math.atan2(math.sin(a - b), math.cos(a - b))) > 0.12 for b in starts): starts.append(a)
for a in starts[:6]:
    ca, sa = math.cos(a), math.sin(a)
    # over the lip, following the crust's own surface…
    for k in range(14):
        r = 0.98 + 0.095 * k / 13
        e = mb.elements.new(); e.type = 'BALL'
        e.co = (r * ca, r * sa, height_at(r * ca, r * sa) + 0.006); e.radius = 0.024 - 0.004 * k / 13
    # …then down the side, thinning, with a bead hanging at the end
    run = rng.uniform(0.035, 0.065)
    for k in range(12):
        t = (k + 1) / 12
        e = mb.elements.new(); e.type = 'BALL'
        e.co = (1.074 * ca, 1.074 * sa, 0.05 - run * t); e.radius = 0.019 - 0.007 * t + (0.009 if k == 11 else 0)
drip_obj.select_set(True); bpy.context.view_layer.objects.active = drip_obj
bpy.ops.object.convert(target='MESH')
drips = next(o for o in scene.objects if o.name.startswith('drips') and o.type == 'MESH')   # (the converted object, by name)
for p in drips.data.polygons: p.use_smooth = True

# ── the chips: one at every pole. Six chip shapes (a flat base, slightly irregular sides, a tip that curls),
#    sizes varied, a few tipped over; in the syrup they sink a little and turn glossy ──
def chip_variant(seed):
    r2 = random.Random(seed)
    segs, rows = 40, 22
    curl = r2.uniform(0.08, 0.22); cdir = r2.uniform(0, 2 * math.pi)
    lumps = [r2.uniform(-0.06, 0.06) for _ in range(5)]
    bm = bmesh.new(); rings = []
    for i in range(rows + 1):
        t = i / rows
        z = 1.05 * t
        rad = (1 - t) ** 1.25 * (1.0 if t > 0.04 else 0.96 + t)            # a sloped cone, a soft edge at the base
        ring = []
        for k in range(segs):
            th = 2 * math.pi * k / segs
            wob = 1 + sum(l * math.cos((j + 2) * th + j) for j, l in enumerate(lumps)) * (1 - t)
            x = rad * wob * math.cos(th) + curl * t ** 3 * math.cos(cdir)
            y = rad * wob * math.sin(th) + curl * t ** 3 * math.sin(cdir)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    bottom = bm.verts.new((0, 0, 0)); tip = bm.verts.new((curl * math.cos(cdir), curl * math.sin(cdir), 1.1))
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(segs): bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    for k in range(segs):
        bm.faces.new((rings[0][(k + 1) % segs], rings[0][k], bottom)); bm.faces.new((rings[-1][k], rings[-1][(k + 1) % segs], tip))
    me = bpy.data.meshes.new(f'chip-{seed}'); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return me
variants = [chip_variant(s) for s in range(6)]
CHIP = 0.046
chips_wet, chips_dry = [], []
for k, (x, y) in enumerate(data['chips']):
    me = variants[k % 6]
    ob = bpy.data.objects.new(f'chip{k}', me); scene.collection.objects.link(ob)
    s = CHIP * rng.uniform(0.75, 1.2); w = wet_at(x, y)
    ob.scale = (s, s * rng.uniform(0.92, 1.08), s * rng.uniform(0.85, 1.15) * (1 - 0.25 * w))
    tipped = rng.random() < 0.1
    ob.location = (x, y, height_at(x, y) - 0.003 - 0.006 * w + (0.012 if tipped else 0))
    ob.rotation_euler = ((rng.uniform(1.2, 1.6) if tipped else rng.uniform(-0.2, 0.2)), rng.uniform(-0.2, 0.2), rng.uniform(0, 2 * math.pi))
    (chips_wet if w > 0.5 else chips_dry).append(ob)

# ── materials ──
def principled(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']

# dough: browning from the attribute, multi-scale variation, toasted speckle, pores, a little butter
m, nt, bsdf = principled('dough')
att = nt.nodes.new('ShaderNodeAttribute'); att.attribute_name = 'brown'
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.12; ramp.color_ramp.elements[0].color = (0.74, 0.46, 0.13, 1)
ramp.color_ramp.elements[1].position = 0.97; ramp.color_ramp.elements[1].color = (0.13, 0.042, 0.008, 1)
e = ramp.color_ramp.elements.new(0.45); e.color = (0.5, 0.23, 0.05, 1)
e = ramp.color_ramp.elements.new(0.75); e.color = (0.3, 0.11, 0.02, 1)
n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 7; n1.inputs['Detail'].default_value = 10; n1.inputs['Roughness'].default_value = 0.6
c1 = nt.nodes.new('ShaderNodeMath'); c1.operation = 'SUBTRACT'; c1.inputs[1].default_value = 0.5
nt.links.new(n1.outputs['Fac'], c1.inputs[0])
mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'
nt.links.new(c1.outputs['Value'], mix.inputs[0]); mix.inputs[1].default_value = 0.6; nt.links.new(att.outputs['Fac'], mix.inputs[2])
nt.links.new(mix.outputs['Value'], ramp.inputs['Fac'])
speck = nt.nodes.new('ShaderNodeTexNoise'); speck.inputs['Scale'].default_value = 150; speck.inputs['Detail'].default_value = 4
speckr = nt.nodes.new('ShaderNodeMapRange'); speckr.inputs['From Min'].default_value = 0.56; speckr.inputs['From Max'].default_value = 0.74
nt.links.new(speck.outputs['Fac'], speckr.inputs['Value'])
speckw = nt.nodes.new('ShaderNodeMath'); speckw.operation = 'MULTIPLY'
nt.links.new(speckr.outputs['Result'], speckw.inputs[0]); nt.links.new(att.outputs['Fac'], speckw.inputs[1])
burnt = nt.nodes.new('ShaderNodeMix'); burnt.data_type = 'RGBA'; burnt.blend_type = 'MULTIPLY'
nt.links.new(speckw.outputs['Value'], burnt.inputs['Factor']); nt.links.new(ramp.outputs['Color'], burnt.inputs['A'])
burnt.inputs['B'].default_value = (0.42, 0.27, 0.17, 1)
nt.links.new(burnt.outputs['Result'], bsdf.inputs['Base Color'])
rough = nt.nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = 0.42; rough.inputs['To Max'].default_value = 0.7
nt.links.new(n1.outputs['Fac'], rough.inputs['Value']); nt.links.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
bsdf.inputs['Coat Weight'].default_value = 0.04; bsdf.inputs['Coat Roughness'].default_value = 0.55
bsdf.inputs['Subsurface Weight'].default_value = 0.12
bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.7, 0.35)
bsdf.inputs['Subsurface Scale'].default_value = 0.012
pores = nt.nodes.new('ShaderNodeTexVoronoi'); pores.inputs['Scale'].default_value = 300; pores.feature = 'F1'
pores2 = nt.nodes.new('ShaderNodeTexVoronoi'); pores2.inputs['Scale'].default_value = 90
fine = nt.nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 500; fine.inputs['Detail'].default_value = 6
add1 = nt.nodes.new('ShaderNodeMath'); add1.operation = 'ADD'
add2 = nt.nodes.new('ShaderNodeMath'); add2.operation = 'MULTIPLY_ADD'; add2.inputs[1].default_value = 0.5
nt.links.new(pores.outputs['Distance'], add1.inputs[0]); nt.links.new(fine.outputs['Fac'], add1.inputs[1])
nt.links.new(pores2.outputs['Distance'], add2.inputs[0]); nt.links.new(add1.outputs['Value'], add2.inputs[2])
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.45; bump.inputs['Distance'].default_value = 0.0025
nt.links.new(add2.outputs['Value'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
if '--debug-brown' in argv: nt.links.new(att.outputs['Fac'], bsdf.inputs['Base Color'])
for ob in [waffle, base] + crumbs: ob.data.materials.append(m)

# chocolate: tempered, a little bloom, roughness that varies; in syrup, half-melted and glossy
def chocolate(name, gloss):
    m, nt, bsdf = principled(name)
    bsdf.inputs['Base Color'].default_value = (0.052, 0.022, 0.011, 1)
    bsdf.inputs['Subsurface Weight'].default_value = 0.08
    bsdf.inputs['Subsurface Radius'].default_value = (0.6, 0.25, 0.12)
    bsdf.inputs['Subsurface Scale'].default_value = 0.003
    rn = nt.nodes.new('ShaderNodeTexNoise'); rn.inputs['Scale'].default_value = 240; rn.inputs['Detail'].default_value = 5
    rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = gloss[0]; rr.inputs['To Max'].default_value = gloss[1]
    nt.links.new(rn.outputs['Fac'], rr.inputs['Value']); nt.links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    bloom = nt.nodes.new('ShaderNodeTexNoise'); bloom.inputs['Scale'].default_value = 60
    bm2 = nt.nodes.new('ShaderNodeMapRange'); bm2.inputs['From Min'].default_value = 0.6; bm2.inputs['From Max'].default_value = 0.85
    bm2.inputs['To Max'].default_value = 0.0 if gloss[0] < 0.2 else 0.35
    nt.links.new(bloom.outputs['Fac'], bm2.inputs['Value'])
    bmix = nt.nodes.new('ShaderNodeMix'); bmix.data_type = 'RGBA'
    nt.links.new(bm2.outputs['Result'], bmix.inputs['Factor'])
    bmix.inputs['A'].default_value = (0.052, 0.022, 0.011, 1); bmix.inputs['B'].default_value = (0.2, 0.13, 0.09, 1)
    nt.links.new(bmix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Specular IOR Level'].default_value = 0.4
    return m
choc_dry = chocolate('chocolate', (0.3, 0.52)); choc_wet = chocolate('chocolate-wet', (0.06, 0.14))
for ob in chips_dry: ob.material_slots and None
for me in variants: me.materials.append(choc_dry)
for ob in chips_wet:
    ob.data = ob.data.copy(); ob.data.materials.clear(); ob.data.materials.append(choc_wet)

# maple syrup: clear amber, glossy, with absorption — darker where deeper
m, nt, bsdf = principled('syrup')
bsdf.inputs['Base Color'].default_value = (0.95, 0.62, 0.25, 1)
bsdf.inputs['Transmission Weight'].default_value = 1.0
bsdf.inputs['IOR'].default_value = 1.48
bsdf.inputs['Roughness'].default_value = 0.012
vol = nt.nodes.new('ShaderNodeVolumeAbsorption'); vol.inputs['Color'].default_value = (0.9, 0.5, 0.12, 1); vol.inputs['Density'].default_value = 3.5
nt.links.new(vol.outputs['Volume'], nt.nodes['Material Output'].inputs['Volume'])
syrup.data.materials.append(m); drips.data.materials.append(m)

# ── ground: a shadow catcher, so the waffle lands on the cover's basalt ──
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.01))
ground = bpy.context.active_object; ground.is_shadow_catcher = True

# ── light: a warm studio (HDRI, for the ambient and what wet things reflect), a low sun raking the ridges ──
world = bpy.data.worlds.new('studio'); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; bg = wn['Background']
if os.path.exists(HDRI):
    env = wn.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
    mapping = wn.new('ShaderNodeMapping'); coord = wn.new('ShaderNodeTexCoord')
    mapping.inputs['Rotation'].default_value = (0, 0, math.radians(150))
    world.node_tree.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    world.node_tree.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    world.node_tree.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.55
else:
    print('no HDRI at', HDRI, '— a plain dim world instead'); bg.inputs['Color'].default_value = (0.05, 0.045, 0.04, 1)
sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 3.4; sun_data.angle = math.radians(2.5); sun_data.color = (1.0, 0.9, 0.78)
sun = bpy.data.objects.new('sun', sun_data); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(58), 0, math.radians(-125))
glint_data = bpy.data.lights.new('glint', 'AREA'); glint_data.energy = 90; glint_data.size = 3.2; glint_data.size_y = 1.8
glint_data.shape = 'RECTANGLE'; glint_data.color = (1.0, 0.96, 0.9)
glint = bpy.data.objects.new('glint', glint_data); scene.collection.objects.link(glint)
gel, gd = math.radians(64), 6.0
glint.location = (0.4, gd * math.cos(gel), gd * math.sin(gel))
gdir = [-glint.location[0], -glint.location[1], 0.15 - glint.location[2]]
glint.rotation_euler = (math.atan2(math.hypot(gdir[0], gdir[1]), -gdir[2]), 0, math.atan2(gdir[1], gdir[0]) - math.pi / 2)
glint.visible_camera = False; glint.visible_diffuse = False

# ── camera ──
cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 85
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
el, dist = math.radians(66), 6.4
cam.location = (0, -dist * math.cos(el), dist * math.sin(el) + 0.15)
look = (0, 0.02, 0.15)
d = [look[i] - cam.location[i] for i in range(3)]
cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
cam_data.dof.use_dof = True; cam_data.dof.focus_distance = dist; cam_data.dof.aperture_fstop = 4.5

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
scene.view_settings.view_transform = 'AgX'; scene.view_settings.exposure = 0.4
try: scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass
bpy.ops.render.render(write_still=True)
print('wrote', OUT)
