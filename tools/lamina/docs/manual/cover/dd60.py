# lamina's cover — the GCU DD-60 "DADA Diskman" (the Works book-reader skin, made an object), after the DD-8
# reference photos: a big LCD on the raised lid; six lavender F-pills; round domed
# keys (red numbers above the top row); INPUT MODE / SHIFT; NO in its recess, YES a stadium; four round arrow
# buttons in one elliptical recess; the wordmark bottom-left; and the disc in its caddy (brushed shutter, label).
import bpy, math, os, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg('--out', os.path.join(HERE, 'cover.png')); RES = int(arg('--res', '1050'))
HDRI = arg('--hdri', ''); SAMPLES = int(arg('--samples', '96'))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
act = lambda: bpy.context.view_layer.objects.active

def plastic(name, rgb, rough=0.55, bump=0.04, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if bump:
        tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3200; nz.inputs['Detail'].default_value = 3
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector']); bm = nt.nodes.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = bump * 2.6; bm.inputs['Distance'].default_value = 0.00004
        nt.links.new(nz.outputs['Fac'], bm.inputs['Height']); nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
        rn = nt.nodes.new('ShaderNodeTexNoise'); rn.inputs['Scale'].default_value = 60; nt.links.new(tc.outputs['Object'], rn.inputs['Vector'])
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = rough - 0.07; mr.inputs['To Max'].default_value = rough + 0.07
        nt.links.new(rn.outputs['Fac'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])   # handled, a little uneven
    return m
def emitm(name, rgb, s):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = s; return m
def rbox(size, loc, m, r=0.003, segs=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); o = act(); o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if r: bv = o.modifiers.new('b', 'BEVEL'); bv.width = r; bv.segments = segs
    o.data.materials.append(m); return o
def ell(rx, ry, h, loc, m, dome=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=h, location=loc, rotation=rot, vertices=64); o = act()
    o.scale = (rx, ry, 1); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bv = o.modifiers.new('b', 'BEVEL'); bv.width = dome or min(rx, ry) * 0.3; bv.segments = 4; bv.limit_method = 'NONE'
    o.data.materials.append(m); return o
def text(s, loc, size, m, align='LEFT', rot=(0, 0, 0)):
    bpy.ops.object.text_add(location=loc, rotation=rot); t = act(); t.data.body = s; t.data.size = size; t.data.align_x = align; t.data.align_y = 'CENTER'
    t.data.extrude = 0.00012; t.data.materials.append(m); return t

body = plastic('body', (0.07, 0.074, 0.082), rough=0.5)
lid = plastic('lid', (0.085, 0.089, 0.097), rough=0.42)
key = plastic('key', (0.13, 0.135, 0.145), rough=0.4, bump=0.02)
lav = plastic('lav', (0.50, 0.50, 0.66), rough=0.45, bump=0)
white = plastic('ink', (0.95, 0.95, 0.95), rough=0.6, bump=0)
red = plastic('red', (0.85, 0.22, 0.14), rough=0.6, bump=0)
mask = plastic('mask', (0.018, 0.018, 0.02), rough=0.3, bump=0)
recess = plastic('recess', (0.045, 0.047, 0.052), rough=0.55, bump=0)
desk = plastic('desk', (0.035, 0.032, 0.034), rough=0.7, bump=0.02)

W, D, H = 0.112, 0.160, 0.018
rbox((W, D, H - 0.005), (0, 0, 0.005 + (H - 0.005) / 2), body, r=0.006, segs=5)
rbox((W - 0.008, D - 0.008, 0.0055), (0, 0, 0.00275), recess, r=0.002, segs=2)   # the inset foot
# the lid: the top ~48%, raised; a big screen in a black mask with the logo strip on the right
LY0, LY1 = 0.002, 0.080; LYC = (LY0 + LY1) / 2
rbox((W - 0.002, LY1 - LY0, 0.005), (0, LYC, H + 0.0025), lid, r=0.0025, segs=4)
T = H + 0.005
rbox((0.098, 0.064, 0.0010), (0.0, LYC + 0.004, T + 0.0003), mask, r=0.0018)
bpy.ops.mesh.primitive_plane_add(size=1, location=(-0.0065, LYC + 0.0045, T + 0.0009)); lcd = act(); lcd.scale = (0.076, 0.057, 1)
lm = bpy.data.materials.new('lcd'); lm.use_nodes = True; nt = lm.node_tree; bb = nt.nodes['Principled BSDF']
tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(os.path.join(HERE, 'lcd.png')); tx.interpolation = 'Closest'
nt.links.new(tx.outputs['Color'], bb.inputs['Base Color']); nt.links.new(tx.outputs['Color'], bb.inputs['Emission Color'])
bb.inputs['Emission Strength'].default_value = 0.22; bb.inputs['Roughness'].default_value = 0.7
gc_ = nt.nodes.new('ShaderNodeBrightContrast'); gc_.inputs['Contrast'].default_value = 0.35
nt.links.new(tx.outputs['Color'], gc_.inputs['Color']); nt.links.new(gc_.outputs['Color'], bb.inputs['Base Color'])
lcd.data.materials.append(lm)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0.0, LYC + 0.004, T + 0.0016)); gl = act(); gl.scale = (0.097, 0.063, 1)
gm = bpy.data.materials.new('glass'); gm.use_nodes = True; gb = gm.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.90, 0.97, 0.90, 1); gb.inputs['Transmission Weight'].default_value = 1.0; gb.inputs['Roughness'].default_value = 0.04; gb.inputs['IOR'].default_value = 1.5
gl.data.materials.append(gm)
text('D3XA', (0.0405, LYC + 0.022, T + 0.001), 0.0046, white, align='CENTER')
text('Electronic Book', (0.0405, LYC + 0.0165, T + 0.001), 0.0016, white, align='CENTER')
for i in range(4):                                                     # the red dot-matrix block, bottom of the strip
    for j in range(4): ell(0.0006, 0.0006, 0.0004, (0.0365 + i * 0.0021, LYC - 0.020 + j * 0.0021, T + 0.0009), emitm(f'd{i}{j}', (1.0, 0.25, 0.1), 3.0 if (i + j) % 3 else 1.0))
text('GCU', (0.0, LY1 - 0.0060, T + 0.0001), 0.0052, white, align='CENTER')
text('ELECTRONIC BOOK PLAYER  DD-60', (0.050, LY1 - 0.0066, T + 0.0001), 0.0021, white, align='RIGHT')
for k in range(6): ell(0.0055, 0.0019, 0.0016, (-0.0415 + k * 0.0166, LY0 + 0.0072, T + 0.0005), lav)      # six F-pills
for k in range(5): text(f'F{k + 1}', (-0.0415 + k * 0.0166, LY0 + 0.0072, T + 0.0014), 0.0018, mask, align='CENTER')
text('B-MARK', (0.0415, LY0 + 0.0030, T + 0.0001), 0.0016, white, align='CENTER')
# the deck: three rows of ROUND domed keys; red numbers above the top row
K = 0.0098; R = 0.0034
rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM-']
for r, letters in enumerate(rows):
    for i, ch in enumerate(letters):
        x = -0.0441 + i * K + r * 0.0049; y = -0.006 - r * 0.0105
        ell(R, R, 0.0026, (x, y, H + 0.0011), key, dome=0.0011)
        text('–' if ch == '-' else ch, (x, y, H + 0.0025), 0.0034, white, align='CENTER')
        if r == 0: text(str((i + 1) % 10), (x, y + 0.0052, H + 0.0001), 0.0022, red, align='CENTER')
# INPUT MODE / SHIFT; NO in a recess; YES a stadium
for x, lab in ((-0.040, 'INPUT MODE'), (-0.022, 'SHIFT')):
    rbox((0.009, 0.0032, 0.0014), (x, -0.040, H + 0.0007), key, r=0.0012); text(lab, (x, -0.0368, H + 0.0001), 0.0014, white, align='CENTER')
ell(0.0062, 0.0062, 0.0008, (-0.042, -0.051, H + 0.0001), recess); ell(0.0045, 0.0045, 0.0026, (-0.042, -0.051, H + 0.0012), key, dome=0.0012)
text('NO', (-0.042, -0.051, H + 0.0026), 0.0024, white, align='CENTER')
rbox((0.014, 0.0072, 0.0026), (-0.024, -0.051, H + 0.0012), key, r=0.0034, segs=6); text('YES', (-0.024, -0.051, H + 0.0026), 0.0024, white, align='CENTER')
text('►❙❙', (-0.024, -0.0455, H + 0.0001), 0.0018, white, align='CENTER')
# the d-pad: four round arrow buttons in one wide elliptical recess, ◄◄ ►► printed either side
CX, CY = 0.019, -0.051
ell(0.0215, 0.0150, 0.0008, (CX, CY, H + 0.0001), recess)
for dx, dy, gl in ((0, 0.0076, '↑'), (0, -0.0076, '↓'), (-0.0120, 0, '←'), (0.0120, 0, '→')):
    ell(0.0042, 0.0042, 0.0028, (CX + dx, CY + dy, H + 0.0013), key, dome=0.0012); text(gl, (CX + dx, CY + dy, H + 0.0028), 0.0042, white, align='CENTER')
text('◄◄', (CX - 0.0255, CY + 0.004, H + 0.0001), 0.0020, white, align='CENTER'); text('►►', (CX + 0.0255, CY - 0.009, H + 0.0001), 0.0020, white, align='CENTER')
# the wordmark, bottom-left; the LED dot, bottom-right
text('MULTI-MEDIA', (-0.049, -0.0625, H + 0.0001), 0.0024, white)
text('DADA Diskman', (-0.049, -0.0680, H + 0.0001), 0.0050, white)
ell(0.0008, 0.0008, 0.0004, (0.045, -0.070, H + 0.0001), emitm('led', (0.2, 1.0, 0.3), 1.2))   # on the flat face, not the bevel

# the caddy: a square black cartridge, ribbed plastic left, a brushed shutter down the middle, a mauve label right
CX2, CY2, CS = 0.064, 0.016, 0.092
cad = plastic('caddy', (0.03, 0.031, 0.034), rough=0.45)
ribbed = bpy.data.materials.new('ribs'); ribbed.use_nodes = True; nt = ribbed.node_tree; b = nt.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.035, 0.036, 0.04, 1); b.inputs['Roughness'].default_value = 0.5
wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'Y'; wv.inputs['Scale'].default_value = 700
tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
bm = nt.nodes.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = 0.25; nt.links.new(wv.outputs['Fac'], bm.inputs['Height']); nt.links.new(bm.outputs['Normal'], b.inputs['Normal'])
rot = (0, 0, math.radians(-7))
cb = rbox((CS, CS, 0.004), (CX2, CY2, 0.002), cad, r=0.0012, rot=rot)
def onc(dx, dy):                                                       # a point on the caddy's top face
    a = rot[2]; return (CX2 + dx * math.cos(a) - dy * math.sin(a), CY2 + dx * math.sin(a) + dy * math.cos(a), 0.0041)
rbox((0.030, 0.070, 0.0004), onc(-0.028, 0.004), ribbed, r=0.0006, rot=rot)
rbox((0.022, 0.060, 0.0008), onc(-0.002, 0.012), plastic('shutter', (0.62, 0.63, 0.65), rough=0.3, bump=0, metal=1.0), r=0.0008, rot=rot)
bpy.ops.mesh.primitive_plane_add(size=1, location=onc(0.026, 0.006), rotation=rot); lb = act(); lb.location.z = 0.0043; lb.scale = (0.028, 0.064, 1)
lbm = bpy.data.materials.new('label'); lbm.use_nodes = True; lnt = lbm.node_tree; lbb = lnt.nodes['Principled BSDF']
ltx = lnt.nodes.new('ShaderNodeTexImage'); ltx.image = bpy.data.images.load(os.path.join(HERE, 'label.png')); lnt.links.new(ltx.outputs['Color'], lbb.inputs['Base Color'])
lbb.inputs['Roughness'].default_value = 0.65; lb.data.materials.append(lbm)
text('↑', tuple(Vector(onc(-0.036, 0.022)) + Vector((0, 0, 0.0003))), 0.006, white, align='CENTER', rot=rot)
text('OPEN', tuple(Vector(onc(0.036, -0.040)) + Vector((0, 0, 0.0001))), 0.0018, white, align='CENTER', rot=rot)

bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0)); gnd = act(); gnd.data.materials.append(desk); gnd.is_shadow_catcher = True
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.01, 0.012, 1)
if HDRI and os.path.exists(HDRI):
    wn = w.node_tree.nodes; env = wn.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
    w.node_tree.links.new(env.outputs['Color'], wn['Background'].inputs['Color']); wn['Background'].inputs['Strength'].default_value = 0.12
bpy.ops.object.light_add(type='AREA', location=(-0.30, 0.25, 0.42)); k = act(); k.data.energy = 10; k.data.size = 0.35; k.data.color = (1.0, 0.92, 0.82)
k.rotation_euler = (Vector((0, 0, 0.01)) - k.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.light_add(type='AREA', location=(0.40, 0.20, 0.15)); rl = act(); rl.data.energy = 3.5; rl.data.size = 0.25; rl.data.color = (0.8, 0.88, 1.0)
rl.rotation_euler = (Vector((0, 0, 0.01)) - rl.location).to_track_quat('-Z', 'Y').to_euler()

target = Vector((-0.020, 0.030, 0.008))
bpy.ops.object.camera_add(location=(0.03, -0.26, 0.36)); cam = act(); sc.camera = cam
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = 52
cam.data.dof.use_dof = True; cam.data.dof.focus_distance = (Vector((0.0, 0.0, 0.02)) - cam.location).length; cam.data.dof.aperture_fstop = 5.6

sc.render.engine = 'CYCLES'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try: prefs.compute_device_type = kind; prefs.get_devices(); break
        except Exception: pass
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU' if any(d.type != 'CPU' for d in prefs.devices) else 'CPU'
except Exception: sc.cycles.device = 'CPU'
sc.render.resolution_x = RES; sc.render.resolution_y = int(RES * 240 / 210); sc.render.film_transparent = True
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('rendered', OUT, sc.cycles.device)
