#!/usr/bin/env python3
"""Blender headless render: procedural back-of-head hairstyles, platinum base.

Fully parameterized hairstyle system — each style is a preset dict rendered
to its own asset set:
  scripts/render/hair-<style>.png  (RGBA, transparent bg)

Every strand is an independent curve (fibonacci-uniform roots over the
scalp, per-strand wave/frequency/phase/length — no guide/child hierarchy,
which reads as visible bundles). Style presets control:
  length distribution, planar wave, 3D helical curl, mid-length puff,
  tip tuck (bob), crown oversampling, camera framing.

Run:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" \
      --background --python scripts/render-hair.py [style ...]
(no args = all styles)
"""
import bpy
import math
import random
import os
import sys
from mathutils import Vector, noise

random.seed(7)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "render")
os.makedirs(OUT_DIR, exist_ok=True)

# ------------------------------------------------------------------ presets
STYLES = {
    "straight": dict(
        n_main=36000, n_crown=14000, n_points=26,
        length_base=1.55, length_back=0.75, length_side=0.35,
        wave_amp=(0.004, 0.012), wave_freq=(1.4, 3.0),
        curl_freq=None, curl_radius=None,
        puff=0.0, tuck=0.0, side_spread=0.8,
        field_scale=2.2, phase_jitter=0.25,
        ortho=4.4, cam_z=-0.55,
    ),
    "wavy": dict(
        n_main=36000, n_crown=14000, n_points=26,
        length_base=1.60, length_back=0.80, length_side=0.35,
        wave_amp=(0.050, 0.095), wave_freq=(1.8, 3.2),
        curl_freq=None, curl_radius=None,
        puff=0.05, tuck=0.0, side_spread=0.9,
        field_scale=2.2, phase_jitter=0.25,
        ortho=4.5, cam_z=-0.55,
    ),
    "curly": dict(
        n_main=32000, n_crown=12000, n_points=48,
        # curls eat length visually; start longer
        length_base=1.95, length_back=0.90, length_side=0.40,
        wave_amp=(0.004, 0.010), wave_freq=(1.2, 2.0),
        curl_freq=(3.0, 5.0), curl_radius=(0.020, 0.038),
        puff=0.05, tuck=0.0, side_spread=1.0,
        field_scale=3.5, phase_jitter=0.35,
        ortho=4.7, cam_z=-0.45,
    ),
    "bob": dict(
        n_main=36000, n_crown=14000, n_points=26,
        length_base=0.75, length_back=0.14, length_side=0.10,
        wave_amp=(0.003, 0.008), wave_freq=(1.2, 2.2),
        curl_freq=None, curl_radius=None,
        puff=0.04, tuck=0.20, side_spread=0.60,
        field_scale=2.2, phase_jitter=0.25,
        ortho=3.2, cam_z=-0.20,
    ),
}

ONLY = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None
SELECTED = ONLY if ONLY else list(STYLES.keys())

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------ render settings
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "ONEAPI"
prefs.refresh_devices()
gpu_ok = any(d.type == "ONEAPI" for d in prefs.devices)
if gpu_ok:
    for d in prefs.devices:
        d.use = d.type == "ONEAPI"
    scene.cycles.device = "GPU"
else:
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 12
scene.cycles.samples = 64
# denoising OFF: OIDN smears sub-pixel strands into a blurry mess
scene.cycles.use_denoising = False
# hair barely needs bounces — capping these is the big saver
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 1
scene.cycles.glossy_bounces = 2
scene.cycles.transmission_bounces = 2
scene.render.resolution_x = 2880
scene.render.resolution_y = 3840
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100

# ---------------------------------------------------------------- head+neck
def add_holdout_sphere(loc, scale):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=loc)
    ob = bpy.context.object
    ob.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    mat = bpy.data.materials.new("holdout")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    ho = nt.nodes.new("ShaderNodeHoldout")
    nt.links.new(ho.outputs[0], out.inputs[0])
    ob.data.materials.append(mat)
    return ob

head = add_holdout_sphere((0, 0.02, 0.0), (0.92, 0.86, 1.02))
neck = add_holdout_sphere((0, 0.05, -1.05), (0.42, 0.40, 0.75))

# ------------------------------------------------------------------ material
hair_mat = bpy.data.materials.new("hair_platinum")
hair_mat.use_nodes = True
nt = hair_mat.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
hair_bsdf = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
hair_bsdf.parametrization = "COLOR"
hair_bsdf.inputs["Color"].default_value = (0.93, 0.90, 0.86, 1.0)
hair_bsdf.inputs["Roughness"].default_value = 0.28
hair_bsdf.inputs["IOR"].default_value = 1.55
nt.links.new(hair_bsdf.outputs[0], out.inputs[0])

# -------------------------------------------------------------- strand model
BACK = Vector((0, -1, 0))
UP = Vector((0, 0, 1))

def scalp_point(theta, phi):
    r_xy = math.sin(theta)
    return Vector((r_xy * math.sin(phi), -r_xy * math.cos(phi), math.cos(theta)))

THETA_MAX = math.radians(128)
PHI_MAX = math.radians(118)

def strand_path(root_dir, length, wave_amp, wave_freq, phase, side_bias,
                frizz=0.0015, n=26, curl_freq=None, curl_radius=0.0,
                puff=0.0, tuck=0.0):
    """One strand via velocity integration for the base flow (tangent at the
    root, gravity ramps in), with BOUNDED positional effects layered on top:
    planar wave, 3D helical curl, mid-length puff, tip tuck. All effects are
    smooth functions of t, so the path stays smooth; none of them accumulate
    (velocity-integrated effects balloon or vanish unpredictably)."""
    down = Vector((0, 0, -1))
    flow = (down + BACK * 0.25 + side_bias * 0.4)
    v = flow - root_dir * flow.dot(root_dir)
    if v.length < 1e-4:
        v = BACK + down
    v = v.normalized()

    pos = Vector((root_dir.x * 0.92, root_dir.y * 0.86, root_dir.z * 1.02))
    pts = [pos.copy()]
    step = length / (n - 1)
    for i in range(1, n):
        t = i / (n - 1)
        g = min(1.0, max(0.0, (t - 0.08) / 0.5))
        g = g * g * (3 - 2 * g)
        v = (v * (1 - g * 0.30) + down * (g * 0.30)).normalized()
        v = (v + side_bias * (0.05 * t)).normalized()
        pos = pos + v * step

        # planar wave: direct positional S-curve, grows toward the tip
        w = wave_amp * (0.2 + 0.8 * t)
        pos.x += w * (math.sin(phase + t * wave_freq * math.tau)
                      + 0.4 * math.sin(phase * 1.7 + t * wave_freq * 2.2 * math.tau))
        pos.y += w * 0.35 * math.sin(phase * 2.1 + t * wave_freq * 1.3 * math.tau)

        if curl_freq is not None:
            # helix around the (mostly vertical) travel axis
            ang = phase + t * curl_freq * math.tau
            r_c = curl_radius * (0.35 + 0.65 * t)
            pos.x += r_c * math.sin(ang)
            pos.y += r_c * 0.7 * math.cos(ang)

        if puff > 0:
            # bounded radial outward push, max at mid-length = body/volume
            radial = Vector((pos.x, pos.y, 0))
            if radial.length > 1e-6:
                pos += radial.normalized() * (puff * math.sin(math.pi * t))

        if tuck > 0:
            # tips pull forward (+Y, toward the head) and inward (bob
            # undercurl). Proportional in x — no sign flips near the center.
            k = tuck * (t ** 4)
            pos.y += k
            pos.x *= (1 - 0.5 * k)

        pos += noise.noise_vector(pos * 2.5) * frizz * (0.3 + t)
        pts.append(pos.copy())
    return pts

# ------------------------------------------------- uniform independent strands
def build_splines(st):
    all_splines = []

    # Coherent parameter fields over the scalp: strands whose roots are close
    # share nearly the same wave/curl phase, so neighborhoods move together —
    # that is what forms continuous waves and ringlets. Fully independent
    # phases turn curls into a fuzz ball (learned the hard way).
    fscale = st["field_scale"]
    pjitter = st["phase_jitter"]

    def field_phase(rd):
        v = noise.turbulence(Vector((rd.x * fscale, rd.y * fscale, rd.z * fscale)))
        return math.tau * (v % 1.0) + random.gauss(0, pjitter)

    def field_freq(rd, base_range):
        lo, hi = base_range
        mid = random.uniform(lo, hi)
        v = noise.turbulence(Vector((rd.x * fscale * 1.7, rd.y * fscale * 1.7, rd.z * fscale * 1.7)))
        return mid * (0.9 + 0.2 * v)

    def add_strand(rd, theta):
        side = 1 if rd.x >= 0 else -1
        side_damp = 0.22 if theta < math.radians(45) else 1.0
        side_amt = min(1.0, abs(rd.x) * 1.6) * side_damp
        side_bias = Vector((side * side_amt, 0, 0)) * st["side_spread"]

        backness = max(0.0, -rd.y)
        length = (st["length_base"] + st["length_back"] * backness
                  - st["length_side"] * abs(rd.x)
                  + random.uniform(-0.05, 0.05))
        if theta > math.radians(100):
            length *= 0.94

        wave_amp = random.uniform(*st["wave_amp"])
        wave_freq = field_freq(rd, st["wave_freq"])
        phase = field_phase(rd)
        curl_freq = field_freq(rd, st["curl_freq"]) if st["curl_freq"] else None
        curl_radius = random.uniform(*st["curl_radius"]) if st["curl_radius"] else 0.0

        pts = strand_path(rd, length, wave_amp, wave_freq, phase, side_bias,
                          frizz=0.0015, n=st["n_points"], curl_freq=curl_freq,
                          curl_radius=curl_radius, puff=st["puff"],
                          tuck=st["tuck"])

        if random.random() < 0.006:
            npts = len(pts)
            pts = [p + Vector((random.gauss(0, 0.008) * (i / (npts - 1)), 0,
                               abs(random.gauss(0, 0.006)) * (i / (npts - 1)) * 0.5))
                   for i, p in enumerate(pts)]

        all_splines.append((pts, random.uniform(0.5, 0.85)))

    def fib_scalp(count, theta_cap, phi_cap):
        for si in range(count):
            u = (si + 0.5) / count
            theta = math.acos(1 - u * (1 - math.cos(theta_cap)))
            golden = si * 2.399963
            phi = ((golden % math.tau) / math.tau) * 2 - 1
            phi = phi * phi_cap + random.uniform(-0.02, 0.02)
            yield scalp_point(theta, phi), theta

    for rd, theta in fib_scalp(st["n_main"], THETA_MAX, PHI_MAX):
        add_strand(rd, theta)
    for rd, theta in fib_scalp(st["n_crown"], math.radians(50), math.radians(95)):
        add_strand(rd, theta)

    return all_splines

# ------------------------------------------------------------------- lights
def area_light(name, loc, energy, size, color, look_at=(0, 0, -0.4)):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    bpy.context.collection.objects.link(ob)
    direction = Vector(look_at) - ob.location
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return ob

area_light("key", (1.6, -2.2, 3.2), 900, 2.4, (1.0, 0.96, 0.90))
area_light("fill", (-2.2, -1.0, 1.6), 650, 2.8, (0.92, 0.95, 1.0))
area_light("rim", (2.6, 0.6, 0.6), 750, 2.0, (1.0, 0.90, 0.82))

world = bpy.data.worlds.new("studio")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.75, 0.74, 0.72, 1.0)
bg.inputs[1].default_value = 0.45
scene.world = world

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam

# ------------------------------------------------------------- render styles
for name in SELECTED:
    st = STYLES[name]
    splines = build_splines(st)

    curve = bpy.data.curves.new(f"hair_{name}", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.0006
    curve.bevel_resolution = 1
    curve.resolution_u = 1
    curve.materials.append(hair_mat)

    for pts, radius_scale in splines:
        sp = curve.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            t = i / (len(pts) - 1)
            taper = (1.0 - 0.7 * t) * radius_scale
            sp.points[i].co = (p.x, p.y, p.z, taper)

    hair_obj = bpy.data.objects.new(f"hair_{name}", curve)
    bpy.context.collection.objects.link(hair_obj)

    cam_data.ortho_scale = st["ortho"]
    cam.location = (0.05, -9.0, st["cam_z"])
    target = Vector((0, 0, st["cam_z"]))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = os.path.join(OUT_DIR, f"hair-{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[{name}] wrote {scene.render.filepath}")

    bpy.data.objects.remove(hair_obj, do_unlink=True)
    bpy.data.curves.remove(curve)

print("all done:", ", ".join(SELECTED))
