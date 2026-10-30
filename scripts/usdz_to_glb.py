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

usdz_path = args[0] if len(args) > 0 else "/Users/kargm/Documents/projects/surfskate_game/video/skatepark.usdz"
glb_path = args[1] if len(args) > 1 else "/Users/kargm/Documents/projects/surfskate_game/video/skatepark.glb"

print(f"Converting & cleaning {usdz_path} -> {glb_path}")

# Clear default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import USDZ
bpy.ops.wm.usd_import(filepath=usdz_path, import_materials=True)

mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH']

for obj in mesh_objs:
    world_mat = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mathutils.Matrix.Identity(4)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(world_mat)
    bm.verts.ensure_lookup_table()

    # Find connected components (islands) and remove floating fragments
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
    print(f"Found {len(islands)} mesh islands; sizes: {[len(c) for c in islands]}")

    if len(islands) > 1:
        verts_to_remove = [v for comp in islands[1:] for v in comp]
        bmesh.ops.delete(bm, geom=verts_to_remove, context='VERTS')
        print(f"Removed {len(verts_to_remove)} floating artifact vertices.")

    # Fill small internal boundary holes (excluding outer perimeter loop)
    boundary_edges = [e for e in bm.edges if e.is_boundary]
    if boundary_edges:
        bmesh.ops.holes_fill(bm, edges=boundary_edges, sides=30)

    bm.normal_update()

    # Check average surface normal in true world space
    avg_n = mathutils.Vector((0.0, 0.0, 0.0))
    for f in bm.faces:
        avg_n += f.normal * f.calc_area()
    if avg_n.length > 0:
        avg_n.normalize()
    print(f"Initial world-space normal in Blender: {tuple(round(c, 3) for c in avg_n)}")

    # Rotate mesh so average normal aligns with +Z (0, 0, 1) in Blender (which becomes +Y in glTF)
    target_up = mathutils.Vector((0.0, 0.0, 1.0))
    rot_quat = avg_n.rotation_difference(target_up)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot_quat.to_matrix(), verts=bm.verts)

    # Center X/Y and place minimum Z at 0
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

    v = len(obj.data.vertices)
    f = len(obj.data.polygons)
    print(f"Cleaned & Leveled Mesh '{obj.name}': {v} vertices, {f} faces, dimensions={tuple(round(d, 3) for d in obj.dimensions)}")

for obj in list(bpy.data.objects):
    if obj.type != 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)

# Export GLB with packed textures
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    export_apply=True
)

print(f"Successfully exported cleaned GLB to {glb_path} ({os.path.getsize(glb_path) / (1024*1024):.2f} MB)")
