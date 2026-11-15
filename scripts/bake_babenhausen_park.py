#!/usr/bin/env python3
"""
scripts/bake_babenhausen_park.py

Headless Blender script to process raw photogrammetry scan into:
1. `public/models/babenhausen_visual.glb` (high-res textured model with leveled orientation)
2. `public/models/babenhausen_collider.glb` (smooth, clean, drivable physics mesh using Shrinkwrap + Corrective Smooth)
"""

import bpy
import bmesh
import math
import mathutils
import sys
import os

argv = sys.argv
if "--" in argv:
    args = argv[argv.index("--") + 1:]
else:
    args = []

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
input_path = args[0] if len(args) > 0 else os.path.join(WORKSPACE_DIR, "data", "raw_babenhausen_scan.usdz")
output_visual = args[1] if len(args) > 1 else os.path.join(WORKSPACE_DIR, "public", "models", "babenhausen_visual.glb")
output_collider = args[2] if len(args) > 2 else os.path.join(WORKSPACE_DIR, "public", "models", "babenhausen_collider.glb")

print("=" * 60)
print(f"Baking Babenhausen Park in Blender:")
print(f"  Input:    {input_path}")
print(f"  Visual:   {output_visual}")
print(f"  Collider: {output_collider}")
print("=" * 60)

# Clear default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# 1. Import USDZ or GLB
if input_path.lower().endswith(".usdz"):
    bpy.ops.wm.usd_import(filepath=input_path, import_materials=True)
elif input_path.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=input_path)
else:
    raise ValueError(f"Unsupported format: {input_path}")

mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH']
if not mesh_objs:
    raise RuntimeError("No mesh objects found after import!")

scan_obj = mesh_objs[0]
bpy.context.view_layer.objects.active = scan_obj
scan_obj.select_set(True)

# Clear parent keeping world transform
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

# Clean isolated floating artifact fragments
bm = bmesh.new()
bm.from_mesh(scan_obj.data)
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
print(f"Found {len(islands)} mesh islands; largest has {len(islands[0])} verts.")
if len(islands) > 1:
    verts_to_remove = [v for comp in islands[1:] if len(comp) < 1500 for v in comp]
    bmesh.ops.delete(bm, geom=verts_to_remove, context='VERTS')
    print(f"Removed {len(verts_to_remove)} floating artifact vertices.")

# Fill small boundary holes
boundary_edges = [e for e in bm.edges if e.is_boundary]
if boundary_edges:
    bmesh.ops.holes_fill(bm, edges=boundary_edges, sides=30)

bm.normal_update()

# Determine orientation: compute area-weighted normal
avg_n = mathutils.Vector((0.0, 0.0, 0.0))
for f in bm.faces:
    avg_n += f.normal * f.calc_area()
if avg_n.length > 0:
    avg_n.normalize()

# Align upward normal with +Z in Blender
target_up = mathutils.Vector((0.0, 0.0, 1.0))
if avg_n.dot(target_up) < 0.95:
    rot_quat = avg_n.rotation_difference(target_up)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot_quat.to_matrix(), verts=bm.verts)

# Center XY and ground Z min to 0
xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts]
zs = [v.co.z for v in bm.verts]
cx = 0.5 * (min(xs) + max(xs))
cy = 0.5 * (min(ys) + max(ys))
min_z = min(zs)
bmesh.ops.translate(bm, vec=(-cx, -cy, -min_z), verts=bm.verts)

bm.normal_update()
bm.to_mesh(scan_obj.data)
bm.free()
scan_obj.data.update()

dim = scan_obj.dimensions
print(f"Visual Scan Mesh '{scan_obj.name}': {len(scan_obj.data.vertices)} verts, {len(scan_obj.data.polygons)} faces. Bounding box: {tuple(round(d, 2) for d in dim)}")

# -------------------------------------------------------------
# 2. Export Visual Model (`babenhausen_visual.glb`)
# -------------------------------------------------------------
os.makedirs(os.path.dirname(output_visual), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_visual,
    export_format='GLB',
    export_apply=True
)
print(f"✅ Exported Visual Model: {output_visual} ({os.path.getsize(output_visual)/(1024*1024):.2f} MB)")

# -------------------------------------------------------------
# 3. Create Clean Physics Collider Mesh (Shrinkwrap + Corrective Smooth)
# -------------------------------------------------------------
print("Creating clean topology collider with Shrinkwrap + Corrective Smooth...")

# Create continuous subdivision grid matching the footprint
width_x = max(dim.x, 2.0)
depth_y = max(dim.y, 2.0)
grid_z = max_z = max(zs) - min_z

bpy.ops.mesh.primitive_grid_add(
    x_subdivisions=64,
    y_subdivisions=64,
    size=max(width_x, depth_y) * 1.05,
    location=(0, 0, max_z + 0.5)
)
collider_obj = bpy.context.active_object
collider_obj.name = "Babenhausen_Collider"

# Scale grid to exact aspect
if width_x > depth_y:
    collider_obj.scale.y = depth_y / width_x
else:
    collider_obj.scale.x = width_x / depth_y
bpy.ops.object.transform_apply(scale=True)

# Add Subdivision modifier for smooth density
subsurf = collider_obj.modifiers.new(name="Subdivision", type='SUBSURF')
subsurf.levels = 1
subsurf.render_levels = 1

# Add Shrinkwrap Modifier targeting the scanned ramps & bowls
shrink = collider_obj.modifiers.new(name="Shrinkwrap", type='SHRINKWRAP')
shrink.target = scan_obj
shrink.wrap_method = 'PROJECT'
shrink.use_project_z = True
shrink.use_negative_direction = True
shrink.use_positive_direction = True
shrink.offset = 0.01

# Add Corrective Smooth Modifier to iron out micro-bumps and noise
smooth = collider_obj.modifiers.new(name="CorrectiveSmooth", type='CORRECTIVE_SMOOTH')
smooth.smooth_type = 'LENGTH_WEIGHTED'
smooth.factor = 0.85
smooth.iterations = 12
smooth.use_only_smooth = True

# Apply modifiers
bpy.ops.object.select_all(action='DESELECT')
collider_obj.select_set(True)
bpy.context.view_layer.objects.active = collider_obj

for mod in [subsurf, shrink, smooth]:
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception as e:
        print(f"Note applying {mod.name}: {e}")

# Assign clean simple physics material
mat = bpy.data.materials.new(name="ConcretePhysicsMaterial")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Roughness"].default_value = 0.65
    bsdf.inputs["Base Color"].default_value = (0.75, 0.76, 0.78, 1.0)
collider_obj.data.materials.append(mat)

# Remove scan object for collider export
bpy.data.objects.remove(scan_obj, do_unlink=True)

# Export collider
os.makedirs(os.path.dirname(output_collider), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_collider,
    export_format='GLB',
    export_apply=True
)
print(f"✅ Exported Physics Collider: {output_collider} ({os.path.getsize(output_collider)/(1024*1024):.2f} MB)")
print("Babenhausen park baking completed successfully!")
