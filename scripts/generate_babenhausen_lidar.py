#!/usr/bin/env python3
"""
scripts/generate_babenhausen_lidar.py

Generates a high-precision elevation grid JSON `public/models/babenhausen_lidar.json`
from `public/models/babenhausen_collider.glb` using Blender's BVHTree raycasting.
Allows Three.js `ParkSurface` to sample real physics elevations when skating in Babenhausen.
"""

import os
import json
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
COLLIDER_GLB = os.path.join(ROOT_DIR, "public", "models", "babenhausen_collider.glb")
OUTPUT_JSON = os.path.join(ROOT_DIR, "public", "models", "babenhausen_lidar.json")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=COLLIDER_GLB)

mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not mesh_objs:
    raise RuntimeError("No mesh objects found in collider glb!")

obj = mesh_objs[0]
depsgraph = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(obj, depsgraph)

mw = obj.matrix_world
verts_w = [mw @ v.co for v in obj.data.vertices]

# Blender coords: X is X, Y is -Z_three, Z is Y_three (height)
# Three coords: X in [-10, 10], Z in [-12, 12]
x_min, x_max = -8.0, 8.0
z_min, z_max = -10.0, 10.0
nx, nz = 161, 201

raw_grid = np.zeros((nz, nx), dtype=np.float32)
hit_mask = np.zeros((nz, nx), dtype=bool)

for iz in range(nz):
    zw = z_min + (z_max - z_min) * (iz / (nz - 1))
    yb = -zw # Blender Y
    for ix in range(nx):
        xw = x_min + (x_max - x_min) * (ix / (nx - 1))
        xb = xw # Blender X
        
        # Raycast downward along -Z in Blender
        loc, norm, idx, dist = bvh.ray_cast(Vector((xb, yb, 10.0)), Vector((0.0, 0.0, -1.0)))
        if loc is not None:
            raw_grid[iz, ix] = float(loc.z)
            hit_mask[iz, ix] = True

# Fill outside margins from nearest valid hits
for _ in range(30):
    padded = np.pad(raw_grid, 1, mode="edge")
    avg = 0.25 * (padded[1:-1, :-2] + padded[1:-1, 2:] + padded[:-2, 1:-1] + padded[2:, 1:-1])
    raw_grid = np.where(hit_mask, raw_grid, avg)

# Smooth filter
for _ in range(2):
    padded = np.pad(raw_grid, 1, mode="edge")
    nb = (
        0.20 * raw_grid
        + 0.12 * (padded[1:-1, :-2] + padded[1:-1, 2:] + padded[:-2, 1:-1] + padded[2:, 1:-1])
        + 0.08 * (padded[:-2, :-2] + padded[:-2, 2:] + padded[2:, :-2] + padded[2:, 2:])
    )
    raw_grid = raw_grid + 0.35 * (nb - raw_grid)

# Offset so minimum ground level is ~0.0
min_h = float(np.min(raw_grid))
raw_grid = raw_grid - min_h

grid_list = [[round(float(raw_grid[iz, ix]), 4) for ix in range(nx)] for iz in range(nz)]

payload = {
    "park": "Babenhausen",
    "xMin": x_min,
    "xMax": x_max,
    "zMin": z_min,
    "zMax": z_max,
    "nx": nx,
    "nz": nz,
    "grid": grid_list,
}

os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(payload, f, separators=(",", ":"))

print(f"✅ Exported Babenhausen elevation grid to {OUTPUT_JSON} ({os.path.getsize(OUTPUT_JSON)/1024:.1f} KB)")
