"""
Refine Sophie's chest mesh in skater_female.glb:
Subdivides chest faces and applies smooth dual-mound anatomical shaping
with soft underbust curvature and a gentle sternum bridge to eliminate
all angular corners, creases, and planar facets.
"""

import bpy
import bmesh
import math
from mathutils import Vector


def refine_female_chest_mesh(suit_obj):
    """
    Subdivides chest faces of female_casualsuit01 and sculpts smooth,
    naturally rounded breasts with zero angular corners.
    """
    bm = bmesh.new()
    bm.from_mesh(suit_obj.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    # 1. Identify chest faces for subdivision
    # Range covers entire bust, sternum, underbust, and lateral curves
    z_min, z_max = 0.99, 1.29
    x_max = 0.24
    y_thresh = -0.035

    chest_faces = [
        f for f in bm.faces
        if any(z_min <= v.co.z <= z_max and v.co.y < y_thresh and abs(v.co.x) < x_max for v in f.verts)
    ]
    edges = list({e for f in chest_faces for e in f.edges})
    print(f"Subdividing {len(chest_faces)} chest faces ({len(edges)} edges)...")

    bmesh.ops.subdivide_edges(
        bm,
        edges=edges,
        cuts=1,
        use_grid_fill=True,
        smooth=0.25
    )

    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    chest_verts = [
        v for v in bm.verts
        if z_min <= v.co.z <= z_max and v.co.y < y_thresh and abs(v.co.x) < x_max
    ]
    print(f"Refining {len(chest_verts)} chest vertices...")

    # Anatomical breast geometry parameters (in Blender suit local coordinates)
    # X = lateral (+X left, -X right)
    # Y = front/back (-Y front protrusion)
    # Z = vertical (+Z up)
    cx = 0.072           # Breast center lateral offset (+/- 72mm)
    cz = 1.126           # Breast center vertical height
    rx = 0.082           # Lateral radius of each breast mound
    rz_top = 0.092       # Upper hemisphere vertical radius
    rz_bot = 0.080       # Lower hemisphere vertical radius (firmer underbust)
    max_protrusion = -0.143 # Peak depth (-143mm)

    for v in chest_verts:
        x, y, z = v.co.x, v.co.y, v.co.z

        # Asymmetric vertical radius for natural teardrop slope (soft upper slope, firm rounded lower curve)
        rz = rz_top if z >= cz else rz_bot

        # Normalized distance to left and right breast centers
        dl = math.hypot((x - cx) / rx, (z - cz) / rz)
        dr = math.hypot((x + cx) / rx, (z - cz) / rz)
        d = min(dl, dr)

        # Base ribcage plane behind the breasts
        tz = (z - z_min) / (z_max - z_min)
        lat_r = max(0.0, 1.0 - (abs(x) / 0.25) ** 2) ** 0.5
        base_y = (-0.068 - 0.024 * tz) * (0.35 + 0.65 * lat_r)

        if d < 1.0:
            # Smooth cosine dome profile (zero derivative at center and boundary)
            dome = 0.5 * (1.0 + math.cos(d * math.pi))
            dome = dome ** 0.86  # Plump round contour without cone tip

            target_y = base_y + (max_protrusion - base_y) * dome

            # Smooth C1 continuous sternum valley under T-shirt
            gap_w = 0.046
            if abs(x) < gap_w:
                valley = 0.5 * (1.0 + math.cos(math.pi * abs(x) / gap_w))
                # Subtle 12mm valley recession
                target_y += 0.012 * valley

            # Blend vertex towards target smooth curve
            v.co.y = 0.20 * v.co.y + 0.80 * target_y
        elif d < 1.25:
            # Gentle transition zone to ribcage
            t_blend = (1.25 - d) / 0.25
            blend_dome = 0.5 * (1.0 + math.cos(math.pi * (1.0 - t_blend)))
            target_y = base_y + (max_protrusion - base_y) * 0.05 * blend_dome
            v.co.y = (1.0 - 0.40 * t_blend) * v.co.y + (0.40 * t_blend) * target_y

    # Laplacian curvature relaxation: 10 iterations to eliminate any remaining creases
    for _ in range(10):
        new_cos = {}
        for v in chest_verts:
            neighbors = [e.other_vert(v) for e in v.link_edges]
            if not neighbors:
                continue
            avg = sum((n.co for n in neighbors), Vector((0.0, 0.0, 0.0))) / len(neighbors)

            # Boundary damping: taper relaxation weight to 0 at the boundary of chest_verts
            dist_z = min((v.co.z - z_min), (z_max - v.co.z)) / 0.035
            dist_x = (x_max - abs(v.co.x)) / 0.035
            w_bound = max(0.0, min(1.0, dist_z, dist_x))

            # Apply mostly in Y (depth/normal direction) and Z, subtle in X
            relax_w = 0.50 * w_bound
            new_cos[v] = Vector((
                v.co.x * (1.0 - 0.20 * relax_w) + avg.x * (0.20 * relax_w),
                v.co.y * (1.0 - relax_w) + avg.y * relax_w,
                v.co.z * (1.0 - 0.35 * relax_w) + avg.z * (0.35 * relax_w),
            ))

        for v, co in new_cos.items():
            v.co = co

    # Set smooth shading for all faces
    for f in bm.faces:
        f.smooth = True

    bm.to_mesh(suit_obj.data)
    suit_obj.data.update()
    bm.free()
    print("Chest refinement complete and normals updated!")


def main():
    import sys
    glb_path = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "public/models/skater_female.glb"
    out_path = sys.argv[sys.argv.index("--") + 2] if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 2 else glb_path

    print(f"Loading {glb_path}...")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    suit = bpy.data.objects.get("Skater_female_casualsuit01")
    if not suit:
        # Search by substring
        suit = next((o for o in bpy.data.objects if "female_casualsuit01" in o.name), None)

    if not suit:
        raise RuntimeError("Skater_female_casualsuit01 object not found in scene!")

    refine_female_chest_mesh(suit)

    print(f"Exporting refined model to {out_path}...")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_apply=False,
        export_yup=True,
        export_image_format="AUTO",
    )
    print("GLB export successful!")


if __name__ == "__main__":
    main()
