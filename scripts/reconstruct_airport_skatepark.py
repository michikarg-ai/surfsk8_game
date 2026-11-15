#!/usr/bin/env python3
"""
scripts/reconstruct_airport_skatepark.py

Full multi-video photogrammetry pipeline for Airport Skatepark (Hallbergmoos):
1. Extracts 2.5 FPS rectilinear frames (105 deg FOV, -25 deg pitch, 1920x1920)
   across all 3 8K 360-degree Insta360 videos (~570 frames total).
2. Runs macOS RealityKit PhotogrammetrySession via `scripts/photogrammetry_cli`
   with `detail=full`, `sampleOrdering=unordered`, `isObjectMaskingEnabled=false`
   (which also injects Insta360 105deg EXIF intrinsics into all frames).
3. Cleans floating artifact islands, levels ground normal to +Z, centers XY and
   grounds Z=0 in Blender headless, and exports:
   - `public/models/airport_skatepark.glb`
   - `public/models/airport_skatepark.usdz`
4. Renders angled perspective and top-down preview images for visual QA.
"""

import argparse
import glob
import os
import shutil
import subprocess

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIDEO_DIR = os.path.join(ROOT_DIR, "video", "airport_skatepark")
VIDEOS = [
    ("clip053", os.path.join(VIDEO_DIR, "VID_20261114_170448_00_053.mp4")),
    ("clip054", os.path.join(VIDEO_DIR, "VID_20261114_170654_00_054.mp4")),
    ("clip055", os.path.join(VIDEO_DIR, "VID_20261114_170932_00_055.mp4")),
]

FRAMES_DIR = os.path.join(ROOT_DIR, "data", "frames_airport_skatepark")
RAW_USDZ = os.path.join(ROOT_DIR, "data", "raw_airport_skatepark.usdz")
OUTPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "airport_skatepark.glb")
OUTPUT_USDZ = os.path.join(ROOT_DIR, "public", "models", "airport_skatepark.usdz")

PREVIEW_DIR = "/Users/kargm/.gemini/antigravity/brain/f22ce6f1-21e6-4557-9cee-9bee2420e1f9"
PREVIEW_PERSP = os.path.join(PREVIEW_DIR, "airport_skatepark_preview.png")
PREVIEW_TOP = os.path.join(PREVIEW_DIR, "airport_skatepark_top.png")

BLENDER_BIN = "/Applications/Blender.app/Contents/MacOS/Blender"


def step1_extract_frames():
    print("=" * 60)
    print("STEP 1: Extracting multi-angle rectilinear frames (105 deg FOV, 1920x1920)...")
    print("=" * 60)
    os.makedirs(FRAMES_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(FRAMES_DIR, "*.jpg")):
        os.remove(f)

    # For clip053 & clip054: forward-down (2.2 FPS) for full park coverage.
    # For clip055 (walk around/behind climbing/graffiti wall): forward-down + horizontal
    # side/rear views (pitch=-8, yaw=±90/180) so both sides of the vertical wall reconstruct.
    extractions = [
        ("clip053", "fwd", 2.2, 0, -25),
        ("clip054", "fwd", 2.2, 0, -25),
        ("clip055", "fwd", 2.5, 0, -25),
        ("clip055", "right", 2.5, 90, -8),
        ("clip055", "left", 2.5, -90, -8),
        ("clip055", "back", 2.0, 180, -8),
    ]
    video_map = dict(VIDEOS)

    total = 0
    for prefix, tag, fps, yaw, pitch in extractions:
        vpath = video_map[prefix]
        if not os.path.exists(vpath):
            raise FileNotFoundError(f"Missing video: {vpath}")
        vf_filter = f"fps={fps},v360=e:rectilinear:yaw={yaw}:pitch={pitch}:h_fov=105:v_fov=105:w=1920:h=1920"
        print(f"-> Extracting {prefix} [{tag}] (fps={fps}, yaw={yaw}, pitch={pitch}) from {os.path.basename(vpath)}...")
        cmd = [
            "ffmpeg", "-y",
            "-hwaccel", "videotoolbox",
            "-i", vpath,
            "-vf", vf_filter,
            "-qscale:v", "2",
            os.path.join(FRAMES_DIR, f"{prefix}_{tag}_%05d.jpg"),
        ]
        subprocess.run(cmd, check=True)
        clip_count = len(glob.glob(os.path.join(FRAMES_DIR, f"{prefix}_{tag}_*.jpg")))
        total += clip_count
        print(f"   Extracted {clip_count} frames for {prefix}_{tag}")

    print(f"Total extracted frames: {total} in {FRAMES_DIR}")
    return total


def step2_reconstruct():
    print("=" * 60)
    print("STEP 2: RealityKit Photogrammetry Reconstruction (detail=full, unordered)...")
    print("=" * 60)
    cli_bin = os.path.join(ROOT_DIR, "scripts", "photogrammetry_cli")
    cmd = [
        cli_bin,
        FRAMES_DIR,
        RAW_USDZ,
        "full",
        "unordered",
        "false",
    ]
    subprocess.run(cmd, check=True)
    size_mb = os.path.getsize(RAW_USDZ) / (1024 * 1024)
    print(f"Raw scan reconstructed: {RAW_USDZ} ({size_mb:.2f} MB)")


def step3_bake_blender_and_preview():
    print("=" * 60)
    print("STEP 3: Blender Leveling, Cleaning, Export & Preview Render...")
    print("=" * 60)

    os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    script = f"""
import bpy
import bmesh
import mathutils
import math
import os

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath={RAW_USDZ!r}, import_materials=True)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError('No mesh imported!')

bpy.ops.object.select_all(action='DESELECT')
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()

obj = bpy.context.view_layer.objects.active
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

bm = bmesh.new()
bm.from_mesh(obj.data)
bm.verts.ensure_lookup_table()

visited = set()
islands = []
for v in bm.verts:
    if v.index in visited:
        continue
    comp = []
    stack = [v]
    visited.add(v.index)
    while stack:
        curr = stack.pop()
        comp.append(curr)
        for e in curr.link_edges:
            other = e.other_vert(curr)
            if other.index not in visited:
                visited.add(other.index)
                stack.append(other)
    islands.append(comp)

islands.sort(key=len, reverse=True)
if len(islands) > 1:
    to_delete = [v for comp in islands[1:] if len(comp) < 2000 for v in comp]
    if to_delete:
        bmesh.ops.delete(bm, geom=to_delete, context='VERTS')
        print(f'Removed {{len(to_delete)}} floating artifact vertices across {{len(islands)-1}} small islands.')

# Orient ground normal along +Z using iterative dominant-plane refinement
# (excludes vertical walls and tall tree blobs from pulling the ground normal)
curr_n = mathutils.Vector((0.0, 0.0, 0.0))
for f in bm.faces:
    curr_n += f.normal * f.calc_area()
if curr_n.length > 0:
    curr_n.normalize()
else:
    curr_n = mathutils.Vector((0.0, 0.0, 1.0))

for _ in range(4):
    refined = mathutils.Vector((0.0, 0.0, 0.0))
    for f in bm.faces:
        if f.normal.dot(curr_n) > 0.85:
            refined += f.normal * f.calc_area()
    if refined.length > 0:
        curr_n = refined.normalized()

print(f'Estimated ground normal before leveling: {{tuple(round(c, 4) for c in curr_n)}}')
target_up = mathutils.Vector((0.0, 0.0, 1.0))
if curr_n.dot(target_up) < 0.9999:
    rot_quat = curr_n.rotation_difference(target_up)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot_quat.to_matrix(), verts=bm.verts)

# Center XY and ground Z to 0
xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts]
zs = [v.co.z for v in bm.verts]
cx = 0.5 * (min(xs) + max(xs))
cy = 0.5 * (min(ys) + max(ys))
min_z = min(zs)
bmesh.ops.translate(bm, vec=(-cx, -cy, -min_z), verts=bm.verts)

bm.normal_update()
bm.to_mesh(obj.data)
bm.free()
obj.data.update()

dim = obj.dimensions
n_verts = len(obj.data.vertices)
n_faces = len(obj.data.polygons)
print(f'Processed Mesh: {{n_verts}} verts, {{n_faces}} faces. Bounding box (X,Y,Z): {{tuple(round(d, 3) for d in dim)}}')

# Export GLB
bpy.ops.export_scene.gltf(
    filepath={OUTPUT_GLB!r},
    export_format='GLB',
    export_apply=True
)
glb_mb = os.path.getsize({OUTPUT_GLB!r}) / (1024 * 1024)
print(f'Exported GLB: {OUTPUT_GLB} ({{glb_mb:.2f}} MB)')

# Render preview images
scene = bpy.context.scene
available_engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
if 'BLENDER_EEVEE_NEXT' in available_engines:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
elif 'BLENDER_EEVEE' in available_engines:
    scene.render.engine = 'BLENDER_EEVEE'
else:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16

scene.render.resolution_x = 1280
scene.render.resolution_y = 800
scene.render.image_settings.file_format = 'PNG'

world = bpy.data.worlds.new('PreviewWorld')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.06, 0.08, 0.12, 1.0)
    bg.inputs[1].default_value = 1.6

sun_data = bpy.data.lights.new('Sun', type='SUN')
sun_data.energy = 3.0
sun_obj = bpy.data.objects.new('Sun', sun_data)
sun_obj.rotation_euler = (math.radians(40), math.radians(20), math.radians(35))
scene.collection.objects.link(sun_obj)

max_xy = max(dim.x, dim.y, 1.0)
center_z = dim.z * 0.35

def look_at(cam_obj, target_pt):
    direction = mathutils.Vector(target_pt) - cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()

cam_data = bpy.data.cameras.new('PreviewCam')
cam_data.clip_start = 0.05
cam_data.clip_end = 1000.0
cam_obj = bpy.data.objects.new('PreviewCam', cam_data)
scene.collection.objects.link(cam_obj)
scene.camera = cam_obj

# 1. Angled perspective
cam_obj.location = (max_xy * 0.85, -max_xy * 0.85, max_xy * 0.55)
look_at(cam_obj, (0.0, 0.0, center_z))
scene.render.filepath = {PREVIEW_PERSP!r}
bpy.ops.render.render(write_still=True)
print(f'Rendered perspective preview: {PREVIEW_PERSP}')

# 2. Top-down
cam_obj.location = (0.0, -0.01, max_xy * 1.35)
look_at(cam_obj, (0.0, 0.0, 0.0))
scene.render.filepath = {PREVIEW_TOP!r}
bpy.ops.render.render(write_still=True)
print(f'Rendered top-down preview: {PREVIEW_TOP}')
"""

    subprocess.run([BLENDER_BIN, "-b", "--python-expr", script], check=True)
    shutil.copy2(RAW_USDZ, OUTPUT_USDZ)
    usdz_mb = os.path.getsize(OUTPUT_USDZ) / (1024 * 1024)
    print(f"Copied USDZ: {OUTPUT_USDZ} ({usdz_mb:.2f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Airport Skatepark 360° Multi-Video Photogrammetry Pipeline")
    parser.add_argument("--skip-extract", action="store_true", help="Skip frame extraction")
    parser.add_argument("--skip-reconstruct", action="store_true", help="Skip RealityKit reconstruction")
    args = parser.parse_args()

    if not args.skip_extract:
        step1_extract_frames()
    if not args.skip_reconstruct:
        step2_reconstruct()
    step3_bake_blender_and_preview()
    print("All steps completed successfully!")


if __name__ == "__main__":
    main()
