#!/usr/bin/env python3
"""
scripts/bake_airport_skatepark.py

Prepares Airport Skatepark (Hallbergmoos) for web & surfskate physics:
1. Loads `public/models/airport_skatepark.glb`.
2. Trims/crops the outer perimeter beyond the concrete slab, bowl, ledges,
   graffiti wall, and immediate grass border to remove light-blue sky-merged
   tree canopy blobs, and discards disconnected floating fragments.
3. Levels the floor tilt, scales to real-world meters (S=3.30, calibrated
   against Bavarian DOP20 orthophoto at 8PCQ+MH Hallbergmoos), and centers at (0,0,0).
4. Welds UV-seam vertices in 3D and applies non-shrinking Taubin (lambda/mu)
   surface fairing so concrete flatground and bowl/bank transitions are silky
   smooth without micro-bumps, while preserving ledges, bowl depth, and walls.
5. Disconnects lumpy baked normal/roughness maps and downscales/compresses the
   8K baked color texture to 4096x4096 JPEG (quality 88) at
   `public/textures/airport_skatepark_tex0.jpg`.
6. Exports lightweight `public/models/airport_skatepark_game.glb`.
7. Raycasts the exact final mesh at ~0.18m resolution to generate
   `public/models/airport_skatepark_lidar.json` for `ParkSurface.ts`.
8. Renders a 1024x533 thumbnail to `public/textures/airport_thumb.png`.
"""

import os
import json
import subprocess
import tempfile
from collections import deque
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Euler
from mathutils.bvhtree import BVHTree

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "airport_skatepark.glb")
OUTPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "airport_skatepark_game.glb")
OUTPUT_TEX = os.path.join(ROOT_DIR, "public", "textures", "airport_skatepark_tex0.jpg")
OUTPUT_LIDAR = os.path.join(ROOT_DIR, "public", "models", "airport_skatepark_lidar.json")
OUTPUT_THUMB = os.path.join(ROOT_DIR, "public", "textures", "airport_thumb.png")

# Real-world calibration (1.5x scale = 4.95; DOP20 Hallbergmoos: 35.3m concrete slab, 21.0m graffiti wall)
SCALE = 4.95
CROP_X_MIN, CROP_X_MAX = -10.8, -1.0
CROP_Y_MIN, CROP_Y_MAX = -8.0, 4.4
CENTER_X = 0.5 * (CROP_X_MIN + CROP_X_MAX)  # -5.90
CENTER_Y = 0.5 * (CROP_Y_MIN + CROP_Y_MAX)  # -1.80

# Fitted raw floor plane: z = A*x + B*y + C
PLANE_A = 0.012143
PLANE_B = 0.013383
PLANE_C = 0.466094
MAX_WORLD_HEIGHT_M = 3.80  # Removes overhanging tree canopy above the ~2.5-3.0m graffiti/climbing wall


def laplacian_step(
    vals: np.ndarray, src_idx: np.ndarray, dst_idx: np.ndarray, deg: np.ndarray, weight: float
) -> np.ndarray:
    nb_avg = np.bincount(src_idx, weights=vals[dst_idx], minlength=len(vals)) / deg
    return vals + weight * (nb_avg - vals)


def extract_and_compress_texture(me: bpy.types.Mesh) -> bpy.types.Image:
    """Extract 8K baked color texture and compress to 4096x4096 JPEG q=88."""
    os.makedirs(os.path.dirname(OUTPUT_TEX), exist_ok=True)
    color_img = None
    for mat in me.materials:
        if mat and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image and "tex0" in node.image.name:
                    color_img = node.image
                    break
    if color_img is None:
        raise RuntimeError("Could not find baked color texture (*tex0*) in material!")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_png = tmp.name

    try:
        color_img.filepath_raw = tmp_png
        color_img.file_format = "PNG"
        color_img.save()
        subprocess.run(
            [
                "sips",
                "-z",
                "4096",
                "4096",
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                "88",
                tmp_png,
                "--out",
                OUTPUT_TEX,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    finally:
        if os.path.exists(tmp_png):
            os.remove(tmp_png)

    print(f"Saved compressed 4K texture to {OUTPUT_TEX} ({os.path.getsize(OUTPUT_TEX) / (1024*1024):.2f} MB)")
    jpg_img = bpy.data.images.load(OUTPUT_TEX)
    jpg_img.colorspace_settings.name = "sRGB"
    jpg_img.pack()
    return jpg_img


def keep_largest_components(bm: bmesh.types.BMesh, min_faces: int = 300) -> None:
    """Remove small disconnected floating sky/tree fragments above ground or at outer edges."""
    bm.faces.ensure_lookup_table()
    visited = set()
    to_delete = []
    for f in bm.faces:
        if f.index in visited:
            continue
        comp = []
        queue = deque([f])
        visited.add(f.index)
        while queue:
            cur = queue.popleft()
            comp.append(cur)
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index not in visited:
                        visited.add(nf.index)
                        queue.append(nf)
        if len(comp) < min_faces:
            # Never delete small UV-island patches that sit on the skatepark ground/bowl
            zs = [
                (v.co.z - (PLANE_A * v.co.x + PLANE_B * v.co.y + PLANE_C)) * SCALE
                for face in comp
                for v in face.verts
            ]
            if max(zs) > 1.5:
                to_delete.extend(comp)

    if to_delete:
        bmesh.ops.delete(bm, geom=to_delete, context="FACES")
        # Clean up any loose verts
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        print(f"Removed {len(to_delete)} faces from small disconnected fragments.")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=INPUT_GLB)
    mesh_obj = [o for o in bpy.data.objects if o.type == "MESH"][0]
    me = mesh_obj.data

    # 1. Extract & compress color texture to 4096x4096 JPEG, rebuild clean material
    jpg_img = extract_and_compress_texture(me)
    for mat in me.materials:
        if mat and mat.node_tree:
            nodes = mat.node_tree.nodes
            links = mat.node_tree.links
            nodes.clear()
            out_node = nodes.new("ShaderNodeOutputMaterial")
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
            bsdf.inputs["Roughness"].default_value = 0.78
            tex_node = nodes.new("ShaderNodeTexImage")
            tex_node.image = jpg_img
            links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
            links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    # Remove unused 8K packed images so they aren't bundled into the exported GLB
    for img in list(bpy.data.images):
        if img != jpg_img and img.users == 0:
            bpy.data.images.remove(img)

    # 2. Perimeter cleanup & transform to leveled real-world meters
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()

    verts_to_del = []
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        z_world = (z - (PLANE_A * x + PLANE_B * y + PLANE_C)) * SCALE
        if (
            x < CROP_X_MIN
            or x > CROP_X_MAX
            or y < CROP_Y_MIN
            or y > CROP_Y_MAX
            or z_world > MAX_WORLD_HEIGHT_M
        ):
            verts_to_del.append(v)

    bmesh.ops.delete(bm, geom=verts_to_del, context="VERTS")
    keep_largest_components(bm, min_faces=300)

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    n_v = len(bm.verts)
    print(f"After perimeter cleanup: {n_v} verts, {len(bm.faces)} faces")

    # Transform remaining vertices into leveled, centered real-world meters
    coords_m = np.zeros((n_v, 3), dtype=np.float64)
    for i, v in enumerate(bm.verts):
        x, y, z = v.co.x, v.co.y, v.co.z
        z_tilt = PLANE_A * x + PLANE_B * y + PLANE_C
        coords_m[i, 0] = (x - CENTER_X) * SCALE
        coords_m[i, 1] = (y - CENTER_Y) * SCALE
        coords_m[i, 2] = (z - z_tilt) * SCALE

    # 3. Weld co-located UV-seam vertices in 3D & apply non-shrinking Taubin fairing
    quant = np.round(coords_m * 10000.0).astype(np.int64)
    _, unique_inv, unique_counts = np.unique(quant, axis=0, return_inverse=True, return_counts=True)
    n_u = len(unique_counts)
    print(f"Welded {n_v} split UV vertices into {n_u} unique 3D spatial vertices.")

    u_coords = np.zeros((n_u, 3), dtype=np.float64)
    for axis in range(3):
        u_coords[:, axis] = np.bincount(unique_inv, weights=coords_m[:, axis], minlength=n_u) / unique_counts

    src_idx = []
    dst_idx = []
    for e in bm.edges:
        u0 = int(unique_inv[e.verts[0].index])
        u1 = int(unique_inv[e.verts[1].index])
        if u0 != u1:
            src_idx.append(u0)
            dst_idx.append(u1)
            src_idx.append(u1)
            dst_idx.append(u0)
    src_idx = np.array(src_idx, dtype=np.int32)
    dst_idx = np.array(dst_idx, dtype=np.int32)
    deg = np.maximum(1.0, np.bincount(src_idx, minlength=n_u).astype(np.float64))

    # Non-shrinking Taubin fairing on height (Z) to remove micro-bumps while preserving bowl & ledges
    zw = u_coords[:, 2].copy()
    lam, mu = 0.45, -0.472
    for _ in range(24):
        zw = laplacian_step(zw, src_idx, dst_idx, deg, lam)
        zw = laplacian_step(zw, src_idx, dst_idx, deg, mu)

    # Gentle XY tangent Taubin smoothing
    xy = u_coords[:, :2].copy()
    for _ in range(6):
        xy[:, 0] = laplacian_step(xy[:, 0], src_idx, dst_idx, deg, 0.30)
        xy[:, 0] = laplacian_step(xy[:, 0], src_idx, dst_idx, deg, -0.31)
        xy[:, 1] = laplacian_step(xy[:, 1], src_idx, dst_idx, deg, 0.30)
        xy[:, 1] = laplacian_step(xy[:, 1], src_idx, dst_idx, deg, -0.31)

    for i, v in enumerate(bm.verts):
        ui = unique_inv[i]
        v.co.x = float(xy[ui, 0])
        v.co.y = float(xy[ui, 1])
        v.co.z = float(zw[ui])

    for f in bm.faces:
        f.smooth = True
    bm.normal_update()

    # Average vertex normals across UV seams
    v_norms = np.array([v.normal[:] for v in bm.verts], dtype=np.float64)
    u_norms = np.zeros((n_u, 3), dtype=np.float64)
    for axis in range(3):
        u_norms[:, axis] = np.bincount(unique_inv, weights=v_norms[:, axis], minlength=n_u)
    u_norms /= np.maximum(1e-8, np.linalg.norm(u_norms, axis=1, keepdims=True))

    bm.to_mesh(me)
    bm.free()

    welded_normals = [tuple(u_norms[unique_inv[i]]) for i in range(n_v)]
    me.normals_split_custom_set_from_vertices(welded_normals)
    me.update()

    # Print final mesh stats
    pts_final = np.array([v.co[:] for v in me.vertices])
    print(f"Final mesh: {len(me.vertices)} verts, {len(me.polygons)} polys")
    print(f"Final bbox min: {pts_final.min(axis=0)}, max: {pts_final.max(axis=0)}")

    # 4. Export lightweight game GLB
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_image_format="JPEG",
        export_jpeg_quality=88,
    )
    print(f"Exported {OUTPUT_GLB} ({os.path.getsize(OUTPUT_GLB) / (1024*1024):.2f} MB)")

    # 5. Raycast final mesh at ~0.18m step to generate airport_skatepark_lidar.json
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(mesh_obj, depsgraph)

    x_min, x_max = -24.5, 24.5
    z_min, z_max = -31.0, 31.0
    nx, nz = 201, 253  # ~0.245m step
    raw_grid = np.zeros((nz, nx), dtype=np.float32)
    hit_mask = np.zeros((nz, nx), dtype=bool)

    for iz in range(nz):
        zw_pt = z_min + (z_max - z_min) * (iz / (nz - 1))
        yb = -zw_pt  # Blender Y = -Three.js Z
        for ix in range(nx):
            xw_pt = x_min + (x_max - x_min) * (ix / (nx - 1))
            loc, norm, idx, dist = bvh.ray_cast(Vector((xw_pt, yb, 10.0)), Vector((0.0, 0.0, -1.0)))
            if loc is not None:
                raw_grid[iz, ix] = float(np.clip(loc.z, -2.5, 3.8))
                hit_mask[iz, ix] = True

    # Smoothly fill any exterior un-scanned corner cells
    for _ in range(40):
        padded = np.pad(raw_grid, 1, mode="edge")
        avg = 0.25 * (padded[1:-1, :-2] + padded[1:-1, 2:] + padded[:-2, 1:-1] + padded[2:, 1:-1])
        raw_grid = np.where(hit_mask, raw_grid, avg)

    # Light 2-pass grid filter for silky-smooth finite-difference slopes
    for _ in range(2):
        padded = np.pad(raw_grid, 1, mode="edge")
        nb = (
            0.20 * raw_grid
            + 0.12 * (padded[1:-1, :-2] + padded[1:-1, 2:] + padded[:-2, 1:-1] + padded[2:, 1:-1])
            + 0.08 * (padded[:-2, :-2] + padded[:-2, 2:] + padded[2:, :-2] + padded[2:, 2:])
        )
        raw_grid = raw_grid + 0.35 * (nb - raw_grid)

    # Find best flatground spawn point near the center of the concrete plaza
    best_score = 1e9
    best_spawn = (0.0, 0.0, 0.0)
    for iz in range(nz // 4, (3 * nz) // 4):
        for ix in range(nx // 4, (3 * nx) // 4):
            if not hit_mask[iz, ix]:
                continue
            h_c = float(raw_grid[iz, ix])
            # Prefer flatground near 0.0m height with minimal local slope
            patch = raw_grid[iz - 3 : iz + 4, ix - 3 : ix + 4]
            rough = float(np.max(patch) - np.min(patch))
            xw_pt = x_min + (x_max - x_min) * (ix / (nx - 1))
            zw_pt = z_min + (z_max - z_min) * (iz / (nz - 1))
            dist_center = (xw_pt ** 2 + zw_pt ** 2) ** 0.5
            score = rough * 10.0 + abs(h_c) * 2.0 + dist_center * 0.05
            if score < best_score:
                best_score = score
                best_spawn = (round(xw_pt, 2), round(h_c, 3), round(zw_pt, 2))
    print(f"Recommended flatground spawn (Three.js X, Y, Z): {best_spawn}, local roughness: {best_score:.4f}")

    grid_list = [[round(float(raw_grid[iz, ix]), 4) for ix in range(nx)] for iz in range(nz)]
    payload = {
        "park": "Airport Skatepark (Hallbergmoos)",
        "xMin": x_min,
        "xMax": x_max,
        "zMin": z_min,
        "zMax": z_max,
        "nx": nx,
        "nz": nz,
        "grid": grid_list,
    }
    with open(OUTPUT_LIDAR, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Exported {OUTPUT_LIDAR} ({os.path.getsize(OUTPUT_LIDAR) / 1024:.1f} KB)")

    # 6. Render clean 1024x533 thumbnail for the level selector
    scene = bpy.context.scene
    scene.render.engine = (
        "BLENDER_EEVEE_NEXT"
        if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
        else "BLENDER_EEVEE"
    )
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 533
    scene.render.image_settings.file_format = "PNG"

    world = bpy.data.worlds.new("ThumbWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.04, 0.07, 0.13, 1.0)
    bg.inputs[1].default_value = 1.6

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 2.5
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = Euler((0.7, 0.2, 0.8), "XYZ")

    cam_data = bpy.data.cameras.new("ThumbCam")
    cam_data.lens = 28.0
    cam_obj = bpy.data.objects.new("ThumbCam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_pos = Vector((-24.0, -32.0, 21.0))
    target = Vector((0.5, 0.5, 0.6))
    cam_obj.location = cam_pos
    cam_obj.rotation_euler = (target - cam_pos).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam_obj
    scene.render.filepath = OUTPUT_THUMB
    bpy.ops.render.render(write_still=True)
    print(f"Rendered thumbnail to {OUTPUT_THUMB}")


if __name__ == "__main__":
    main()
