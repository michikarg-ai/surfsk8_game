#!/usr/bin/env python3
"""
scripts/reconstruct_babenhausen_v2.py

Full, dense sequential photogrammetry pipeline for Skatepark Babenhausen:
1. Extracts 3 FPS continuous rectilinear video stream (105 deg FOV, -25 deg pitch, 1920x1920) across all 194 seconds.
2. Injects precise EXIF intrinsics (13.81mm 35mm equiv, f/2.0).
3. Reconstructs via macOS RealityKit PhotogrammetrySession in sequential mode with high feature sensitivity.
4. Smooths & levels in Blender, exports to `public/models/babenhausen_v2.glb` for viewer inspection.
"""

import os
import sys
import glob
import subprocess
import shutil

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIDEO_PATH = os.path.join(ROOT_DIR, "video", "bbh", "VID_20261102_173618_00_052.mp4")
FRAMES_DIR = os.path.join(ROOT_DIR, "data", "frames_babenhausen_v2")
RAW_USDZ = os.path.join(ROOT_DIR, "data", "raw_babenhausen_v2.usdz")
OUTPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "babenhausen_v2.glb")
OUTPUT_USDZ = os.path.join(ROOT_DIR, "public", "models", "babenhausen_v2.usdz")

def step1_extract_frames():
    print("=" * 60)
    print("STEP 1: Extracting dense continuous video stream (3 FPS, FOV 105)...")
    print("=" * 60)
    os.makedirs(FRAMES_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(FRAMES_DIR, "*.jpg")):
        os.remove(f)

    # 105 deg rectilinear FOV, pitch -25 deg tilted down toward ramps/concrete
    vf_filter = "fps=3,v360=e:rectilinear:yaw=0:pitch=-25:h_fov=105:v_fov=105:w=1920:h=1920"
    cmd = [
        "ffmpeg", "-y",
        "-hwaccel", "videotoolbox",
        "-i", VIDEO_PATH,
        "-vf", vf_filter,
        "-qscale:v", "2",
        os.path.join(FRAMES_DIR, "frame_%05d.jpg")
    ]
    subprocess.run(cmd, check=True)
    count = len(glob.glob(os.path.join(FRAMES_DIR, "*.jpg")))
    print(f"✅ Extracted {count} sequential frames into {FRAMES_DIR}")
    return count

def step2_reconstruct():
    print("=" * 60)
    print("STEP 2: RealityKit Photogrammetry Reconstruction...")
    print("=" * 60)
    cli_bin = os.path.join(ROOT_DIR, "scripts", "photogrammetry_cli")
    cmd = [
        cli_bin,
        FRAMES_DIR,
        RAW_USDZ,
        "full",
        "sequential",
        "false"
    ]
    subprocess.run(cmd, check=True)
    print(f"✅ Raw scan reconstructed: {RAW_USDZ} ({os.path.getsize(RAW_USDZ)/(1024*1024):.2f} MB)")

def step3_bake_blender():
    print("=" * 60)
    print("STEP 3: Blender Leveling, Cleaning & Export...")
    print("=" * 60)
    blender_bin = "/Applications/Blender.app/Contents/MacOS/Blender"
    
    script = f"""
import bpy
import bmesh
import mathutils
import os

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath='{RAW_USDZ}', import_materials=True)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError('No mesh imported!')

obj = meshes[0]
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Remove non-mesh objects
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

# Clean small disconnected fragments
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
    bmesh.ops.delete(bm, geom=to_delete, context='VERTS')
    print(f'Removed {{len(to_delete)}} floating artifact vertices.')

# Orient ground normal along +Z
avg_n = mathutils.Vector((0.0, 0.0, 0.0))
for f in bm.faces:
    avg_n += f.normal * f.calc_area()
if avg_n.length > 0:
    avg_n.normalize()

target_up = mathutils.Vector((0.0, 0.0, 1.0))
if avg_n.dot(target_up) < 0.95:
    rot_quat = avg_n.rotation_difference(target_up)
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
print(f'Processed Mesh: {{len(obj.data.vertices)}} verts, {{len(obj.data.polygons)}} faces. Bounding box: {{tuple(round(d, 2) for d in dim)}}')

# Export GLB
os.makedirs(os.path.dirname('{OUTPUT_GLB}'), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath='{OUTPUT_GLB}',
    export_format='GLB',
    export_apply=True
)
print(f'✅ Exported GLB: {OUTPUT_GLB} ({{os.path.getsize("{OUTPUT_GLB}")/(1024*1024):.2f}} MB)')

# Also copy raw usdz to public
import shutil
shutil.copy2('{RAW_USDZ}', '{OUTPUT_USDZ}')
"""

    cmd = [
        blender_bin,
        "-b",
        "--python-expr",
        script
    ]
    subprocess.run(cmd, check=True)

if __name__ == "__main__":
    step1_extract_frames()
    step2_reconstruct()
    step3_bake_blender()
    print("All steps completed successfully!")
