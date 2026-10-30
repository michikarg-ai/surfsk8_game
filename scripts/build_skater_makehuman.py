#!/usr/bin/env python3
"""
CC0 Surfskater Character Pipeline (MakeHuman / MPFB)  ->  `public/models/skater.glb`

Builds a license-free (CC0) rigged skater with the MPFB Blender extension and the official
MakeHuman CC0 asset packs, puts him on our own procedural surfskate board and exports one GLB.

Licensing: characters exported with official, unmodified MPFB from CC0 assets are CC0.
Assets used (all CC0, MakeHuman asset packs):
  - makehuman_system_assets: base mesh, game_engine rig, eyes, eyebrows, eyelashes, hair,
    male_casualsuit02 (long-sleeve top + jeans), shoes06 (sneakers)
  - skins02: toigo_light_skin_male_bronze (sun-tanned skin)
Everything else (hood, helmet, knee pads, recolouring) is generated here.

Setup (one-time):
  1. Install MPFB 2 as a Blender extension
     (https://github.com/makehumancommunity/mpfb2, folder src/mpfb zipped):
       blender --command extension install-file -r user_default -e mpfb_ext.zip
  2. Unzip the CC0 asset packs into MPFB's user data folder, e.g. on macOS:
       ~/Library/Application Support/Blender/<ver>/extensions/.user/user_default/mpfb/data/
     Packs: https://files.makehumancommunity.org/asset_packs/<pack>/<pack>_cc0.zip
       (makehuman_system_assets, skins02)

Run:
  blender -b --python scripts/build_skater_makehuman.py -- [male|female]
"""

import importlib
import math
import os
import sys

import bmesh
import bpy
import numpy as np

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BOARD_GLB = os.path.join(ROOT_DIR, "scripts", "assets", "surfskate_board_source.glb")
OUTPUT_PATH = os.path.join(ROOT_DIR, "public", "models", "skater.glb")

DECK_TOP_Z = 0.162  # Top surface of the deck in board space (Blender Z-up)
TEXTURE_SIZE = 1024  # Downscale all textures for the web build

# -----------------------------------------------------------------------------------------
# Character presets (male now, female variant later)
# -----------------------------------------------------------------------------------------
PRESETS = {
    "male": {
        # MakeHuman macros: age 0.5 = 25 years; gender 1.0 = male
        "macro": {
            "gender": 1.0, "age": 0.5, "muscle": 0.72, "weight": 0.45, "proportions": 0.65,
            "height": 0.55, "cupsize": 0.5, "firmness": 0.5,
            "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0},
        },
        "skin": "toigo_light_skin_male_bronze.mhmat",  # sun-tanned
        "assets": [
            ("eyes", "low-poly.mhclo", "Eyes"),
            ("eyebrows", "eyebrow001.mhclo", "Eyebrows"),
            ("eyelashes", "eyelashes01.mhclo", "Eyelashes"),
            ("clothes", "male_casualsuit02.mhclo", "Clothes"),
            ("clothes", "shoes06.mhclo", "Clothes"),
        ],
        "outfit": "male_casualsuit02",
        "hoodie_color": (0.075, 0.08, 0.09),  # charcoal
        "denim_color": (0.28, 0.43, 0.62),  # faded blue jeans
        "helmet_color": (0.0, 0.55, 0.52),  # turquoise
    },
}


def di(pkg, key):
    """Blender extensions live at unknown module paths; locate MPFB services dynamically."""
    for m in list(sys.modules):
        if m.endswith(pkg):
            return getattr(importlib.import_module(m), key)
    raise ValueError(f"MPFB module {pkg} not found — is the MPFB extension installed?")


def new_material(name, color, roughness=0.6, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def material_images(mat):
    if not mat or not mat.node_tree:
        return []
    return [n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]


def base_color_image(mat):
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return None
    stack = list(bsdf.inputs["Base Color"].links)
    while stack:
        node = stack.pop().from_node
        if node.type == "TEX_IMAGE":
            return node.image
        for inp in node.inputs:
            stack.extend(inp.links)
    return None


def recolor_outfit(img, hoodie, denim):
    """male_casualsuit02 atlas: shirt = top band + right column, jeans = bottom-left."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)  # row 0 = bottom of the image
    ys = (1.0 - (np.arange(h) + 0.5) / h)[:, None]  # 0 = top of the image
    xs = ((np.arange(w) + 0.5) / w)[None, :]
    shirt = (ys < 0.465) | (xs > 0.782) | (px[..., 0] >= px[..., 2] * 0.98)
    lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]

    # Hoodie: flat charcoal (logo & orange stripes vanish), subtle fabric grain kept
    s_mean = float(lum[shirt].mean())
    s_detail = np.clip((lum - s_mean) * 0.35 + 1.0, 0.7, 1.3)
    # Jeans: faded stone-washed blue denim with lighter worn thigh/knee highlights & darker seams
    d_mean = float(lum[~shirt].mean())
    d_detail = np.clip((lum - d_mean) * 1.85 + 1.0, 0.48, 1.65)
    fade_lift = np.clip((lum - d_mean) * 1.4, 0.0, 0.25)
    fade_tint = (0.24, 0.26, 0.22)
    for c in range(3):
        jeans_c = np.clip(denim[c] * d_detail + fade_lift * fade_tint[c], 0.0, 1.0)
        px[..., c] = np.where(shirt, hoodie[c] * s_detail, jeans_c)
    px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()


def style_skate_shoes(shoes_obj, mat):
    """
    Transform `shoes06` into classic vulcanized skate shoes (Vans Old Skool / Half Cab style):
      - Matte black suede upper with crisp off-white side stripes & laces
      - Dark charcoal crew socks under the jeans cuff
      - Chunky, flat-walled off-white vulcanized rubber foxing sole around the bottom perimeter
    """
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Roughness"].default_value = 0.86

    img = base_color_image(mat)
    if img is not None:
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        vs = ((np.arange(h) + 0.5) / h)[:, None]
        us = ((np.arange(w) + 0.5) / w)[None, :]
        r, g, b = px[..., 0], px[..., 1], px[..., 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

        # Royal-blue upper -> matte black/charcoal suede, preserving stitch & grain detail
        blue = (b > r * 1.08) & (b > 0.08)
        b_mean = float(lum[blue].mean()) if blue.any() else 0.25
        suede_detail = np.clip((lum - b_mean) * 0.45 + 1.0, 0.65, 1.45)
        suede_rgb = (0.052, 0.055, 0.062)
        for c in range(3):
            px[..., c] = np.where(blue, suede_rgb[c] * suede_detail, px[..., c])

        # White sock region (bottom-right of UV atlas) -> dark charcoal socks
        sock = (us > 0.76) & (vs < 0.165)
        sock_rgb = (0.065, 0.07, 0.08)
        for c in range(3):
            px[..., c] = np.where(sock, sock_rgb[c] * np.clip(lum * 1.1, 0.6, 1.2), px[..., c])

        px[..., 3] = 1.0
        img.pixels.foreach_set(px.ravel())
        img.update()
        img.pack()

    # Reshape into a wider, flat-walled vulcanized skate shoe & puff the padded collar/tongue
    inv_w = shoes_obj.matrix_world.inverted()
    for v in shoes_obj.data.vertices:
        wco = shoes_obj.matrix_world @ v.co
        # Separate left (y < 0) and right (y > 0) shoe centers
        cy = -0.20 if wco.y < 0 else 0.20
        cx = -0.09
        if wco.z < 0.205:
            # Widen the sole & lower toe-box horizontally for a boxy skate shoe profile
            sole_t = max(0.0, min(1.0, (0.205 - wco.z) / 0.055))
            wco.x = cx + (wco.x - cx) * (1.0 + 0.08 * sole_t)
            wco.y = cy + (wco.y - cy) * (1.0 + 0.10 * sole_t)
            if wco.z < DECK_TOP_Z:
                wco.z = DECK_TOP_Z
        elif 0.205 <= wco.z < 0.258:
            # Padded skate-shoe ankle collar & tongue
            pad_t = math.sin((wco.z - 0.205) / 0.053 * math.pi)
            wco.x = cx + (wco.x - cx) * (1.0 + 0.05 * pad_t)
            wco.y = cy + (wco.y - cy) * (1.0 + 0.07 * pad_t)
        v.co = inv_w @ wco
    shoes_obj.data.update()

    # Slice exact horizontal vulcanized sole & foxing-stripe planes using bmesh.ops.bisect_plane
    # so the white rubber sidewall and black foxing stripe are razor-straight all around the shoe
    sole_mat = new_material("SkaterShoeSole", (0.72, 0.70, 0.64), roughness=0.76)
    fox_mat = new_material("SkaterShoeFoxing", (0.012, 0.012, 0.014), roughness=0.65)
    shoes_obj.data.materials.append(sole_mat)
    sole_mat_idx = len(shoes_obj.data.materials) - 1
    shoes_obj.data.materials.append(fox_mat)
    fox_mat_idx = len(shoes_obj.data.materials) - 1

    bm = bmesh.new()
    bm.from_mesh(shoes_obj.data)
    # Transform bmesh to world space for exact horizontal Z slicing, then back to local
    bmesh.ops.transform(bm, matrix=shoes_obj.matrix_world, verts=bm.verts)
    for z_cut in (0.1825, 0.1855):
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(
            bm, geom=geom, dist=1e-5,
            plane_co=(0.0, 0.0, z_cut), plane_no=(0.0, 0.0, 1.0),
        )
    for f in bm.faces:
        cz = f.calc_center_median().z
        if cz < 0.1825:
            f.material_index = sole_mat_idx
        elif cz < 0.1855:
            f.material_index = fox_mat_idx
    bmesh.ops.transform(bm, matrix=inv_w, verts=bm.verts)
    bm.to_mesh(shoes_obj.data)
    bm.free()
    shoes_obj.data.update()


def skin_to_bone(obj, armature, bone_name):
    """Attach `obj` to `armature` as a skinned mesh weighted 100% to `bone_name`."""
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.matrix_world = world
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature


def shell_from_sphere(name, mat, scale, location, cut, segments=48, rings=24, thickness=0.08, warp=None):
    """Half/partial ellipsoid shell. `cut(v)` returns True for unit-sphere verts to delete."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1.0)
    obj = bpy.context.active_object
    obj.name = name
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if cut(v.co)], context="VERTS")
    if warp is not None:
        for v in bm.verts:
            warp(v.co)
    bm.to_mesh(obj.data)
    bm.free()
    obj.scale = scale
    obj.location = location
    obj.data.materials.append(mat)
    mod = obj.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.modifier_apply(modifier="Solidify")
    return obj


def deck_half_width(t):
    """
    SmoothStar 34" Filipe Toledo #77 surfskate outline (measured from top-view reference):
    t = 0.00 at the rounded surfboard nose apex (y = -0.42),
    t = 0.40 at the wide chest point (half_w = 0.136 m),
    t = 1.00 at the wide squared-off squash tail (y = +0.42).
    """
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        t = 1.0
    max_w = 0.136
    if t <= 0.40:
        u = t / 0.40
        # Exact square-root apex at t->0 gives a smooth circular nose cap with zero pinch
        rel = (1.0 - (1.0 - u) ** 2.65) ** 0.5
    elif t <= 0.97:
        u = (t - 0.40) / (0.97 - 0.40)
        rel = 1.0 - 0.175 * (u ** 1.45)
    else:
        c = (t - 0.97) / 0.03
        rel = 0.755 + 0.070 * math.sqrt(max(0.0, 1.0 - c * c))
    return max_w * rel


def reshape_surfskate_deck(board_group):
    """
    Reshape DeckMesh into a rounded surfboard-nose + wide squash-tail surfskate deck,
    fix its inverted face normals from the source GLB, and paint its 2K top griptape texture.
    """
    deck = bpy.data.objects.get("DeckMesh")
    if deck is None:
        return
    verts = deck.data.vertices
    if len(verts) != 49 * 44:
        return

    # Reference normalized X profile [-1..+1] from the middle ring (ring 24)
    ref_x = np.array([verts[24 * 44 + k].co.x for k in range(44)], dtype=np.float32)
    ref_x /= max(1e-6, float(np.abs(ref_x).max()))
    ref_z = np.array([verts[24 * 44 + k].co.z for k in range(44)], dtype=np.float32)

    # Cosine-clustered Y rings give sub-millimeter resolution around the rounded nose & tail corners
    u_lin = np.linspace(0.0, 1.0, 49)
    t_rings = 0.5 - 0.5 * np.cos(u_lin * math.pi)

    for i in range(49):
        t = float(t_rings[i])
        y_base = -0.42 + t * 0.84
        hw = deck_half_width(t)
        # Subtle nose rocker (t < 0.18) and tail kick (t > 0.72)
        rocker_z = 0.0
        if t < 0.18:
            rocker_z = 0.010 * (((0.18 - t) / 0.18) ** 1.8)
        elif t > 0.72:
            rocker_z = 0.028 * (((t - 0.72) / 0.28) ** 1.7)

        for k in range(44):
            xn = float(ref_x[k])
            v = verts[i * 44 + k]
            v.co.x = xn * hw
            # Subtle backward arch across the wide squash tail edge
            tail_arc = 0.005 * (1.0 - xn * xn) * max(0.0, (t - 0.94) / 0.06)
            v.co.y = y_base + tail_arc
            v.co.z = float(ref_z[k]) + rocker_z

    # DeckMesh in surfskate_board_source.glb has inside-out face winding (top faces had nz < 0).
    # Check a top-surface polygon and flip all polygons if inverted.
    deck.data.update()
    top_Verts_z = [
        sum(verts[v].co.z for v in p.vertices) / len(p.vertices)
        for p in deck.data.polygons
        if abs(p.normal.z) > 0.8
    ]
    z_mid = 0.5 * (min(top_Verts_z) + max(top_Verts_z))
    inverted_count = sum(
        1 for p in deck.data.polygons
        if abs(p.normal.z) > 0.8
        and ((sum(verts[v].co.z for v in p.vertices) / len(p.vertices) > z_mid) != (p.normal.z > 0))
    )
    if inverted_count > len(deck.data.polygons) // 4:
        for p in deck.data.polygons:
            p.flip()
        deck.data.update()

    # Map top-surface UVs to metric deck space so the maple border is uniform all around
    uv_layer = deck.data.uv_layers.active.data
    for poly in deck.data.polygons:
        li = list(poly.loop_indices)
        vi = [deck.data.loops[idx].vertex_index for idx in li]
        if poly.normal.z > 0.5:
            for idx, v_idx in zip(li, vi):
                co = verts[v_idx].co
                u = 0.5 + co.x / 0.30
                v_uv = 0.5 - co.y / 0.88
                uv_layer[idx].uv = (u, v_uv)
        else:
            # Side rails & bottom ply: sample clean blonde maple wood strip at u=0.015
            for idx, v_idx in zip(li, vi):
                co = verts[v_idx].co
                uv_layer[idx].uv = (0.015, 0.5 - co.y / 0.88)

    deck.data.update()

    # Paint the 1024x2048 deck texture to match the SmoothStar surfboard-style griptape
    mat = deck.data.materials[0] if deck.data.materials else None
    img = base_color_image(mat) if mat else None
    if img is not None:
        w, h = img.size
        xs = ((np.arange(w, dtype=np.float32) + 0.5) / w - 0.5) * 0.30  # metric X (-0.15..+0.15)
        vs = (np.arange(h, dtype=np.float32) + 0.5) / h                  # row 0 = bottom (v=0, tail)
        ys = (0.5 - vs) * 0.88                                           # metric Y (+0.44.. -0.44)
        abs_x = np.abs(xs)[None, :]

        # Uniform 5.2 mm blonde maple wood border around the entire rounded nose, rails, and squash tail
        border = 0.0052
        max_w = 0.136
        tail_arc_x = 0.005 * np.maximum(0.0, 1.0 - (abs_x / 0.105) ** 2)
        y_nose_grip = -0.42 + border
        y_tail_grip = 0.42 + tail_arc_x - border
        t_grip = (ys[:, None] - y_nose_grip) / (y_tail_grip - y_nose_grip)
        hw_grip = np.vectorize(deck_half_width)(np.clip(t_grip, 0.0, 1.0)).astype(np.float32) * (
            (max_w - border) / max_w
        )
        in_grip = (t_grip > 0.0) & (t_grip < 1.0) & (abs_x < hw_grip)

        # Blonde maple wood base with subtle longitudinal grain
        grain = 0.018 * np.sin(xs[None, :] * 420.0 + np.sin(ys[:, None] * 18.0) * 1.5)
        wood_r = np.clip(0.86 + grain, 0.0, 1.0)
        wood_g = np.clip(0.76 + grain * 0.85, 0.0, 1.0)
        wood_b = np.clip(0.56 + grain * 0.65, 0.0, 1.0)

        # Charcoal silicon-carbide griptape with fine mineral sparkle
        rng = np.random.default_rng(42)
        grit = rng.normal(0.0, 0.022, size=(h, w)).astype(np.float32)
        sparkle = (rng.random((h, w)) > 0.984).astype(np.float32) * 0.095
        grip_base = np.clip(0.14 + grit + sparkle, 0.075, 0.32)
        grip_r = grip_base * 0.97
        grip_g = grip_base * 0.99
        grip_b = grip_base * 1.02

        # Clean griptape across the deck interior with uniform maple wood border
        dx = xs[None, :]
        is_grip_pixel = in_grip

        # 4 front truck bolts (y = -0.255..-0.205) and 4 rear truck bolts (y = +0.215..+0.265)
        bolt_mask = np.zeros((h, w), dtype=bool)
        bolt_rim = np.zeros((h, w), dtype=bool)
        for by in (-0.255, -0.205, 0.215, 0.265):
            for bx in (-0.021, 0.021):
                br = np.hypot(dx - bx, ys[:, None] - by)
                bolt_mask |= br < 0.0040
                bolt_rim |= (br >= 0.0028) & (br < 0.0044)

        out = np.empty((h, w, 4), dtype=np.float32)
        out[..., 0] = np.where(is_grip_pixel, grip_r, wood_r)
        out[..., 1] = np.where(is_grip_pixel, grip_g, wood_g)
        out[..., 2] = np.where(is_grip_pixel, grip_b, wood_b)
        out[..., 0] = np.where(bolt_mask, 0.10, out[..., 0])
        out[..., 1] = np.where(bolt_mask, 0.11, out[..., 1])
        out[..., 2] = np.where(bolt_mask, 0.12, out[..., 2])
        out[..., 0] = np.where(bolt_rim, 0.26, out[..., 0])
        out[..., 1] = np.where(bolt_rim, 0.27, out[..., 1])
        out[..., 2] = np.where(bolt_rim, 0.29, out[..., 2])
        out[..., 3] = 1.0

        img.pixels.foreach_set(out.ravel())
        img.update()
        img.pack()


def import_board():
    bpy.ops.import_scene.gltf(filepath=BOARD_GLB)
    board_group = bpy.data.objects["BoardGroup"]
    keep = {board_group}
    stack = [board_group]
    while stack:
        o = stack.pop()
        for c in o.children:
            keep.add(c)
            stack.append(c)
    world = board_group.matrix_world.copy()
    board_group.parent = None
    board_group.matrix_world = world
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    reshape_surfskate_deck(board_group)
    return board_group


def refine_body_delete_masks(body):
    """
    Keep a small cuff overlap at the neck, wrists, and ankles so bending joints never exposes
    hollow gaps, while still deleting covered torso/arm/leg faces under the hoodie and jeans.
    """
    for gname in ("Delete.male_casualsuit02", "Delete.shoes06"):
        vg = body.vertex_groups.get(gname)
        if not vg:
            continue
        keep_indices = []
        for v in body.data.vertices:
            x, y, z = v.co.x, v.co.y, v.co.z
            if (z > 1.47 and abs(x) < 0.12) or abs(x) > 0.56 or (0.07 < z < 0.15):
                keep_indices.append(v.index)
        if keep_indices:
            vg.remove(keep_indices)


def fix_opaque_materials_and_vgroups(rig):
    """
    MPFB's GAMEENGINE material builder wires the diffuse PNG's alpha channel into Principled BSDF
    Alpha on skin, eye, and clothing textures, even though MakeHuman stores specular/SSS masks
    in those PNG alpha channels. Disconnect Alpha on opaque materials so glTF exports them solid.
    Also strip non-bone vertex groups so glTF's 4-joint skinning limit only sees real bones.
    """
    bone_names = {b.name for b in rig.data.bones}
    for m in rig.children:
        if m.type != "MESH":
            continue
        for vg in list(m.vertex_groups):
            if vg.name not in bone_names:
                m.vertex_groups.remove(vg)
        for mat in m.data.materials:
            if not mat or not mat.node_tree:
                continue
            if any(k in mat.name for k in ("body", "low-poly", "male_casualsuit02", "shoes06")):
                bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf:
                    for link in list(bsdf.inputs["Alpha"].links):
                        mat.node_tree.links.remove(link)
                    bsdf.inputs["Alpha"].default_value = 1.0
                for n in list(mat.node_tree.nodes):
                    if n.type == "TEX_IMAGE" and "Alpha" in n.name:
                        mat.node_tree.nodes.remove(n)


def build_character(preset):
    HumanService = di("mpfb.services.humanservice", "HumanService")
    AssetService = di("mpfb.services.assetservice", "AssetService")
    TargetService = di("mpfb.services.targetservice", "TargetService")
    ExportService = di("mpfb.services.exportservice", "ExportService")
    ObjectService = di("mpfb.services.objectservice", "ObjectService")

    basemesh = HumanService.create_human(macro_detail_dict=preset["macro"])
    TargetService.bake_targets(basemesh)
    skin = AssetService.find_asset_absolute_path(preset["skin"], asset_subdir="skins")
    if not skin:
        raise RuntimeError(f"Skin {preset['skin']} not found — install the CC0 skin asset packs")
    HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE")
    HumanService.add_builtin_rig(basemesh, "game_engine")
    for subdir, fname, atype in preset["assets"]:
        path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
        if not path:
            raise RuntimeError(f"Asset {fname} not found — install makehuman_system_assets")
        HumanService.add_mhclo_asset(path, basemesh, asset_type=atype, material_type="GAMEENGINE")

    # Game-ready copy: modifiers baked, helper geometry removed
    rig = ExportService.create_character_copy(basemesh, name_suffix="_export")
    export_body = ObjectService.find_object_of_type_amongst_nearest_relatives(rig, "Basemesh")
    refine_body_delete_masks(export_body)
    ExportService.bake_modifiers_remove_helpers(
        export_body, bake_masks=True, bake_subdiv=True, remove_helpers=True, also_proxy=True
    )
    fix_opaque_materials_and_vgroups(rig)
    # Drop the editable original
    keep = {rig, *ObjectService.get_list_of_children(rig)}
    for o in list(bpy.data.objects):
        if o not in keep and not o.name.startswith(("Board", "Deck", "Front", "Rear")):
            bpy.data.objects.remove(o, do_unlink=True)
    rig.name = "SkaterArmature"
    meshes = [c for c in rig.children if c.type == "MESH"]
    for m in meshes:
        m.name = m.name.replace("Human.", "Skater_").replace("_export", "").replace("Human", "Skater_Body")
    return rig, meshes, export_body


def main():
    variant = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 1 else "male"
    preset = PRESETS[variant]

    # Start from an empty scene (keep preferences so the MPFB extension stays enabled)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    board_group = import_board()
    rig, meshes, body = build_character(preset)

    # ---- Outfit: long-sleeve top -> charcoal hoodie, jeans -> dark indigo ----
    for m in meshes:
        for mat in m.data.materials:
            if preset["outfit"] in mat.name:
                img = base_color_image(mat)
                if img is not None:
                    recolor_outfit(img, preset["hoodie_color"], preset["denim_color"])

    # ---- Stance: left side toward the nose (-Y), facing the toe-side edge (-X) ----
    rig.rotation_mode = "XYZ"
    rig.rotation_euler = (0.0, 0.0, -math.pi / 2)
    rig.location = (0.0, 0.0, DECK_TOP_Z + 0.002)
    bpy.context.view_layer.update()

    # ---- Skate shoes: matte black suede + white stripes/laces + white vulcanized foxing sole ----
    for m in meshes:
        if "shoes06" in m.name and m.data.materials:
            style_skate_shoes(m, m.data.materials[0])

    def bone_world(name, tail=False):
        b = rig.data.bones[name]
        return rig.matrix_world @ (b.tail_local if tail else b.head_local)

    # Head extents from baked body vertices above the neck joint (world space)
    neck_top = bone_world("head").z
    all_pts = np.array([body.matrix_world @ v.co for v in body.data.vertices])
    print("NECK_TOP", round(neck_top, 3), "BODY Z", all_pts[:, 2].min().round(3), all_pts[:, 2].max().round(3))
    head_pts = all_pts[all_pts[:, 2] > neck_top]
    hmin, hmax = head_pts.min(0), head_pts.max(0)
    hc = (hmin + hmax) / 2
    print("HEAD BBOX", hmin.round(3), hmax.round(3))

    # Linear-space charcoal matching the sRGB recolored hoodie texture (0.075 sRGB -> ~0.0068 linear)
    hood_linear = tuple(((c + 0.055) / 1.055) ** 2.4 for c in preset["hoodie_color"])
    fabric = new_material("SkaterHood", hood_linear, roughness=0.92)
    beanie_mat = new_material("SkaterBeanie", (0.0, 0.48, 0.46), roughness=0.90)
    cuff_mat = new_material("SkaterBeanieCuff", (0.0, 0.40, 0.39), roughness=0.92)
    pad_mat = new_material("SkaterKneePad", (0.02, 0.02, 0.022), roughness=0.5)
    strap_mat = new_material("SkaterPadStrap", (0.0, 0.55, 0.52), roughness=0.7)

    # ---- Turquoise knit skater beanie (snug ribbed dome + closed torus cuff), skinned to head ----
    cranium_cx = hmax[0] - 0.096  # center of cranium (excluding nose tip)
    beanie_center = (cranium_cx, hc[1], hmax[2] - 0.075)
    beanie_scale = (0.106, (hmax[1] - hmin[1]) * 0.545, 0.088)

    def beanie_warp(co):
        theta = math.atan2(co.y, co.x)
        rib = 1.0 + 0.006 * math.cos(36.0 * theta) * co.z
        co.x *= rib
        co.y *= rib
        # Tilt rim: sits mid-forehead in front (-X) and dips down over upper ears to nape at back (+X)
        rim_tilt = -0.24 * co.x - 0.06 * (co.x ** 2)
        slouch = 0.12 * (co.z ** 1.6) * max(0.0, co.x + 0.15)
        co.x += 0.07 * (co.z ** 1.8)
        # Keep bottom edge (co.z == 0) tucked inside the cuff band (+0.06)
        co.z = co.z * 0.94 + 0.06 + (1.0 - 0.55 * co.z) * rim_tilt + slouch

    beanie = shell_from_sphere(
        "SkaterBeanie", beanie_mat,
        scale=beanie_scale,
        location=beanie_center,
        cut=lambda co: co.z < -0.001,
        segments=72, rings=32, thickness=0.045,
        warp=beanie_warp,
    )
    skin_to_bone(beanie, rig, "head")

    # Closed torus cuff around the beanie rim (zero cut edges, smooth rolled knit band)
    bpy.ops.mesh.primitive_torus_add(
        major_segments=72, minor_segments=24, major_radius=1.0, minor_radius=0.14
    )
    beanie_cuff = bpy.context.active_object
    beanie_cuff.name = "SkaterBeanieCuff"
    for v in beanie_cuff.data.vertices:
        theta = math.atan2(v.co.y, v.co.x)
        r = math.hypot(v.co.x, v.co.y)
        # Pill-shaped vertical cuff cross-section with subtle vertical knit ribs
        dr = (r - 1.0) * 0.42 + 0.008 * math.cos(36.0 * theta) * max(0.0, r - 0.98)
        nr = 1.0 + dr
        v.co.x = nr * math.cos(theta) * beanie_scale[0] * 0.995
        v.co.y = nr * math.sin(theta) * beanie_scale[1] * 1.005
        nx = math.cos(theta)
        rim_tilt = -0.24 * nx - 0.06 * (nx ** 2)
        v.co.z = (v.co.z * 1.75 + rim_tilt + 0.04) * beanie_scale[2]
    beanie_cuff.location = beanie_center
    beanie_cuff.data.materials.append(cuff_mat)
    bpy.ops.object.shade_smooth()
    skin_to_bone(beanie_cuff, rig, "head")

    # ---- Draped hoodie collar & back hood (closed manifold torus around neck/upper back) ----
    neck = bone_world("neck_01")
    bpy.ops.mesh.primitive_torus_add(
        major_segments=64, minor_segments=28, major_radius=1.0, minor_radius=0.32
    )
    hood = bpy.context.active_object
    hood.name = "SkaterHood"
    for v in hood.data.vertices:
        theta = math.atan2(v.co.y, v.co.x)  # 0 = back (+X), +-pi = front (-X)
        r = math.hypot(v.co.x, v.co.y)
        dr = r - 1.0  # -0.32 (inner neck side) .. +0.32 (outer edge)
        dz = v.co.z   # -0.32 (bottom of tube) .. +0.32 (top of tube)

        # Smooth weight: 0 at front throat, 0.5 at shoulders, 1.0 at center back
        back_w = 0.5 * (1.0 + math.cos(theta))
        back_pouch = back_w ** 1.6

        # Collar ring framing the neck + flat draped hood resting flush against the upper back
        rad_x = 0.074 + 0.024 * back_pouch + dr * (0.042 + 0.028 * back_pouch)
        rad_y = 0.096 + dr * 0.052 * (1.0 - 0.22 * back_pouch)

        x = rad_x * math.cos(theta) + 0.018 * back_pouch
        y = rad_y * math.sin(theta) * (1.0 - 0.15 * back_pouch * max(0.0, dr))

        # Subtle center-back hood seam/fold
        crease = -0.007 * back_pouch * math.exp(-((theta * 2.8) ** 2)) * max(0.0, dz)

        # Height: low in front (tucked into neckline), raised collar on sides, draped down upper back
        z = (
            dz * (0.038 + 0.048 * (back_w ** 0.8))
            + 0.024 * math.sin(back_w * math.pi * 0.82)
            - 0.068 * back_pouch * max(0.0, dr + 0.18)
            - 0.032 * (1.0 - back_w)
            + crease
        )
        # Follow slope of upper back (+X as Z drops) so hood lies flat against the shirt
        x += max(0.0, -z) * 0.32 * back_pouch
        v.co.x, v.co.y, v.co.z = x, y, z

    hood.location = (neck.x + 0.008, neck.y, neck.z - 0.022)
    hood.data.materials.append(fabric)
    bpy.ops.object.shade_smooth()
    skin_to_bone(hood, rig, "spine_03")

    # ---- Knee pads (hard shells in front of the jeans knee + snug elastic straps), skinned to shins ----
    suit_mesh = next((m for m in meshes if preset["outfit"] in m.name), body)
    suit_pts = np.array([suit_mesh.matrix_world @ v.co for v in suit_mesh.data.vertices])
    for side in ("l", "r"):
        knee = bone_world(f"calf_{side}")
        side_mask = (suit_pts[:, 1] < 0) if side == "l" else (suit_pts[:, 1] > 0)
        pad_z = knee.z + 0.008
        knee_slice = suit_pts[side_mask & (np.abs(suit_pts[:, 2] - pad_z) < 0.018)]
        kx_min, kx_max = float(knee_slice[:, 0].min()), float(knee_slice[:, 0].max())
        ky_min, ky_max = float(knee_slice[:, 1].min()), float(knee_slice[:, 1].max())
        kx_c = 0.5 * (kx_min + kx_max)
        ky_c = 0.5 * (ky_min + ky_max)
        rx = 0.5 * (kx_max - kx_min)
        ry = 0.5 * (ky_max - ky_min)

        pad = shell_from_sphere(
            f"SkaterKneePad_{side}", pad_mat,
            scale=(rx + 0.022, ry + 0.008, 0.080),
            location=(kx_c - 0.012, ky_c, pad_z),
            cut=lambda co: co.x > 0.08, segments=32, rings=18, thickness=0.12,
        )
        skin_to_bone(pad, rig, f"calf_{side}")

        # Elastic strap hugging the jeans leg cross-section just below the kneecap
        strap_z = knee.z - 0.028
        strap_slice = suit_pts[side_mask & (np.abs(suit_pts[:, 2] - strap_z) < 0.015)]
        sx_min, sx_max = float(strap_slice[:, 0].min()), float(strap_slice[:, 0].max())
        sy_min, sy_max = float(strap_slice[:, 1].min()), float(strap_slice[:, 1].max())
        sx_c = 0.5 * (sx_min + sx_max)
        sy_c = 0.5 * (sy_min + sy_max)
        srx = 0.5 * (sx_max - sx_min) + 0.003
        sry = 0.5 * (sy_max - sy_min) + 0.003

        bpy.ops.mesh.primitive_torus_add(
            major_segments=40, minor_segments=14, major_radius=1.0, minor_radius=0.07
        )
        strap = bpy.context.active_object
        strap.name = f"SkaterKneeStrap_{side}"
        for v in strap.data.vertices:
            v.co.z *= 3.2  # flat ribbon profile
        strap.scale = (srx, sry, 0.055)
        strap.location = (sx_c, sy_c, strap_z)
        strap.data.materials.append(strap_mat)
        bpy.ops.object.shade_smooth()
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        skin_to_bone(strap, rig, f"calf_{side}")

    # ---- Web-friendly textures ----
    for img in bpy.data.images:
        if img.size[0] > TEXTURE_SIZE:
            img.scale(TEXTURE_SIZE, TEXTURE_SIZE * img.size[1] // img.size[0])
            img.pack()

    # ---- Root hierarchy & export ----
    root = bpy.data.objects.new("SurfskaterRoot", None)
    bpy.context.scene.collection.objects.link(root)
    for o in (board_group, rig):
        w = o.matrix_world.copy()
        o.parent = root
        o.matrix_world = w

    print("BONES", [b.name for b in rig.data.bones if not any(k in b.name for k in ("index", "middle", "pinky", "ring", "thumb"))])
    print("PELVIS_Z", round(bone_world("pelvis").z, 3), "FOOT_Z", round(bone_world("foot_l").z, 3))

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_PATH,
        export_format="GLB",
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_apply=False,
        export_yup=True,
        export_image_format="AUTO",
    )
    print(f"Exported CC0 MakeHuman surfskater ({variant}) to {OUTPUT_PATH} ({os.path.getsize(OUTPUT_PATH) // 1024} KB)")


if __name__ == "__main__":
    main()
