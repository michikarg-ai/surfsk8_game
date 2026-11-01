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
        "wear_beanie": True,
        "wear_basecap": False,
        "wear_knee_pads": False,
        "output": os.path.join(ROOT_DIR, "public", "models", "skater.glb"),
    },
    "female": {
        # Sun-tanned female surfskater with long blonde hair, white logo T-shirt, ripped blue jeans & skate shoes
        "macro": {
            "gender": 0.0, "age": 0.45, "muscle": 0.58, "weight": 0.42, "proportions": 0.62,
            "height": 0.48, "cupsize": 0.48, "firmness": 0.58,
            "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0},
        },
        "skin": "toigo_light_skin_female_bronze.mhmat",  # sun-tanned
        "assets": [
            ("eyes", "low-poly.mhclo", "Eyes"),
            ("eyebrows", "eyebrow002.mhclo", "Eyebrows"),
            ("eyelashes", "eyelashes02.mhclo", "Eyelashes"),
            ("hair", "long01.mhclo", "Hair"),
            ("clothes", "female_casualsuit01.mhclo", "Clothes"),
            ("clothes", "shoes06.mhclo", "Clothes"),
        ],
        "outfit": "female_casualsuit01",
        "tshirt_color": (0.94, 0.94, 0.93),  # clean off-white cotton T-shirt
        "denim_color": (0.28, 0.44, 0.68),  # stonewashed blue denim
        "hair_color": (0.92, 0.78, 0.46),  # sunlit golden blonde
        "basecap_color": (0.04, 0.08, 0.16),  # deep vintage navy twill
        "wear_basecap": True,
        "wear_beanie": False,
        "wear_hood": False,
        "wear_knee_pads": False,
        "output": os.path.join(ROOT_DIR, "public", "models", "skater_female.glb"),
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


def recolor_male_suit(img, hoodie, denim):
    """male_casualsuit02 atlas: shirt = top band + right column, jeans = bottom-left."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)  # row 0 = bottom of the image
    ys = (1.0 - (np.arange(h) + 0.5) / h)[:, None]  # 0 = top of the image
    xs = ((np.arange(w) + 0.5) / w)[None, :]
    shirt = (ys < 0.410) | (xs > 0.778) | ((xs > 0.735) & (ys > 0.658))
    lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]

    # Hoodie: flat charcoal (logo & orange stripes vanish), subtle fabric grain kept
    s_mean = float(lum[shirt].mean())
    s_detail = np.clip((lum - s_mean) * 0.35 + 1.0, 0.7, 1.3)
    d_mean = float(lum[~shirt].mean())
    if sum(denim) / 3.0 > 0.7:
        # Crisp white denim jeans with warm grey-beige seam & fold shading
        d_detail = np.clip((lum - d_mean) * 0.95 + 1.0, 0.68, 1.08)
        fade_lift = np.clip((lum - d_mean) * 0.35, 0.0, 0.07)
        fade_tint = (0.12, 0.12, 0.10)
    else:
        # Faded stone-washed blue denim with lighter worn thigh/knee highlights & darker seams
        d_detail = np.clip((lum - d_mean) * 1.85 + 1.0, 0.48, 1.65)
        fade_lift = np.clip((lum - d_mean) * 1.4, 0.0, 0.25)
        fade_tint = (0.24, 0.26, 0.22)
    for c in range(3):
        jeans_c = np.clip(denim[c] * d_detail + fade_lift * fade_tint[c], 0.0, 1.0)
        px[..., c] = np.where(shirt, hoodie[c] * s_detail, jeans_c)
    px[..., 3] = 1.0

    # Surfskate Munich circular logo on hoodie (front chest and back)
    logo_path = os.path.join(ROOT_DIR, "scripts", "assets", "surfskate_munich_logo.png")
    if os.path.exists(logo_path):
        logo_img = bpy.data.images.load(logo_path)
        lw, lh = logo_img.size
        lpx = np.empty(lw * lh * 4, dtype=np.float32)
        logo_img.pixels.foreach_get(lpx)
        lpx = lpx.reshape(lh, lw, 4)
        bpy.data.images.remove(logo_img)

        def apply_logo(center_u, center_v, diam_px):
            td = int(diam_px)
            scaled = np.zeros((td, td, 4), dtype=np.float32)
            for y in range(td):
                sy = y * lh / td
                iy = int(sy)
                fy = sy - iy
                iy1 = min(lh - 1, iy + 1)
                for x in range(td):
                    sx = x * lw / td
                    ix = int(sx)
                    fx = sx - ix
                    ix1 = min(lw - 1, ix + 1)
                    top = lpx[iy, ix] * (1 - fx) + lpx[iy, ix1] * fx
                    bot = lpx[iy1, ix] * (1 - fx) + lpx[iy1, ix1] * fx
                    scaled[y, x] = top * (1 - fy) + bot * fy

            cx = int(round(center_u * w))
            cy = int(round(center_v * h))
            x0 = cx - td // 2
            y0 = cy - td // 2
            for y in range(td):
                for x in range(td):
                    a = scaled[y, x, 3]
                    if a > 0:
                        px[y0 + y, x0 + x, :3] = px[y0 + y, x0 + x, :3] * (1 - a) + scaled[y, x, :3] * a

        # 1. Front chest logo: centered on pectorals below collar
        apply_logo(0.5604, 0.7840, round(0.110 * w))
        # 2. Back print logo: centered on upper back below draped hood
        apply_logo(0.1696, 0.7550, round(0.128 * w))

    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()


def recolor_female_suit(img, tshirt_color, denim_color):
    """
    female_casualsuit01 atlas:
      - Short-sleeve T-shirt: top half + right sleeves -> clean white cotton with Surfskate Munich chest logo
      - Blue jeans: bottom half -> classic stonewashed blue with authentic worn rips/holes and frayed white threads
    """
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1].copy()  # row 0 = top of image

    ys = (np.arange(h, dtype=np.float32)[:, None]) / h
    xs = (np.arange(w, dtype=np.float32)[None, :]) / w

    # Exact UV island mask: verified with 0 mismatches
    is_shirt = (ys < 0.435) | ((xs > 0.724) & (xs + 0.85 * ys > 1.245))
    lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]

    # 1. T-shirt: clean white/off-white cotton
    t_mean = float(lum[is_shirt].mean())
    t_detail = np.clip((lum - t_mean) * 0.45 + 1.0, 0.78, 1.08)
    is_collar_or_stripe = is_shirt & ((lum < t_mean * 0.7) | (px[..., 0] > px[..., 2] * 1.5))
    t_detail = np.where(is_collar_or_stripe, np.clip(1.0 + (lum - t_mean) * 0.15, 0.88, 1.02), t_detail)

    for c in range(3):
        px[..., c] = np.where(is_shirt, np.clip(tshirt_color[c] * t_detail, 0.0, 1.0), px[..., c])

    # 2. Add Surfskate Munich circular logo to front chest
    logo_path = os.path.join(ROOT_DIR, "scripts", "assets", "surfskate_munich_logo.png")
    if os.path.exists(logo_path):
        logo_img = bpy.data.images.load(logo_path)
        lw, lh = logo_img.size
        lpx = np.empty(lw * lh * 4, dtype=np.float32)
        logo_img.pixels.foreach_get(lpx)
        lpx = lpx.reshape(lh, lw, 4)[::-1]
        bpy.data.images.remove(logo_img)

        # Rotate 90 degrees clockwise to align with front chest UV
        l_rot = np.rot90(lpx, -1)
        cx = int(round(0.7856 * w))
        cy = int(round(0.2327 * h))
        target_diam = int(round(0.161 * w))  # ~330 px at 2048x2048
        scaled_logo = np.zeros((target_diam, target_diam, 4), dtype=np.float32)
        for y in range(target_diam):
            sy = y * lh / target_diam
            iy = int(sy)
            fy = sy - iy
            iy1 = min(lh - 1, iy + 1)
            for x in range(target_diam):
                sx = x * lw / target_diam
                ix = int(sx)
                fx = sx - ix
                ix1 = min(lw - 1, ix + 1)
                top = l_rot[iy, ix] * (1 - fx) + l_rot[iy, ix1] * fx
                bot = l_rot[iy1, ix] * (1 - fx) + l_rot[iy1, ix1] * fx
                scaled_logo[y, x] = top * (1 - fy) + bot * fy

        x0 = cx - target_diam // 2
        y0 = cy - target_diam // 2
        for y in range(target_diam):
            for x in range(target_diam):
                a = scaled_logo[y, x, 3]
                if a > 0:
                    px[y0 + y, x0 + x, :3] = px[y0 + y, x0 + x, :3] * (1 - a) + scaled_logo[y, x, :3] * a

    # 3. Blue jeans: classic stonewashed blue
    d_mean = float(lum[~is_shirt].mean())
    j_detail = np.clip((lum - d_mean) * 1.6 + 1.0, 0.52, 1.55)
    fade_lift = np.clip((lum - d_mean) * 1.4, 0.0, 0.32)
    fade_tint = np.array([0.34, 0.36, 0.32], dtype=np.float32)
    for c in range(3):
        jeans_c = np.clip(denim_color[c] * j_detail + fade_lift * fade_tint[c], 0.0, 1.0)
        px[..., c] = np.where(~is_shirt, jeans_c, px[..., c])

    # 4. Worn rips/holes with frayed white threads and sun-tanned skin
    skin_rgb = np.array([0.76, 0.54, 0.42], dtype=np.float32)
    thread_rgb = np.array([0.95, 0.94, 0.92], dtype=np.float32)
    fray_dark = np.array([0.14, 0.20, 0.30], dtype=np.float32)

    rips = [
        {"u": 0.110, "ys": 0.718, "rx": 0.024, "ry": 0.012, "angle": 0.05},  # Left knee
        {"u": 0.676, "ys": 0.697, "rx": 0.026, "ry": 0.014, "angle": -0.04}, # Right knee
        {"u": 0.662, "ys": 0.631, "rx": 0.018, "ry": 0.007, "angle": -0.06}, # Right mid-thigh
        {"u": 0.113, "ys": 0.607, "rx": 0.016, "ry": 0.006, "angle": 0.08},  # Left upper thigh
    ]

    for rip in rips:
        ru, rys = rip["u"], rip["ys"]
        rx, ry = rip["rx"], rip["ry"]
        ang = rip["angle"]
        cos_a, sin_a = np.cos(ang), np.sin(ang)

        du = xs - ru
        dys = ys - rys
        lx = (du * cos_a + dys * sin_a) / rx
        ly = (-du * sin_a + dys * cos_a) / ry
        dist = np.hypot(lx, ly)

        outer_rim = (dist >= 1.0) & (dist < 1.35)
        rim_w = np.clip((1.35 - dist) / 0.35, 0.0, 1.0)[:, :, None]
        px[outer_rim, :3] = px[outer_rim, :3] * (1.0 - rim_w[outer_rim] * 0.45) + fray_dark * (rim_w[outer_rim] * 0.45)

        in_hole = dist < 1.0
        thread_pattern = 0.5 + 0.5 * np.cos(ly * 14.0 * np.pi)
        thread_mask = (thread_pattern > 0.42) & (np.abs(ly) > 0.25)
        thread_mask |= (thread_pattern > 0.65) & (np.abs(lx) < 0.75)

        skin_shade = np.clip(0.75 + 0.25 * (1.0 - dist), 0.6, 1.0)[:, :, None]
        hole_color = skin_rgb * skin_shade
        hole_color = np.where(thread_mask[:, :, None], thread_rgb * 0.95, hole_color)

        edge_blend = np.clip((1.0 - dist) / 0.12, 0.0, 1.0)[:, :, None]
        px[in_hole, :3] = px[in_hole, :3] * (1.0 - edge_blend[in_hole]) + hole_color[in_hole] * edge_blend[in_hole]

    px[..., 3] = 1.0
    img.pixels.foreach_set(px[::-1].ravel())
    img.update()
    img.pack()


def recolor_outfit(img, preset):
    if preset["outfit"] == "female_casualsuit01":
        recolor_female_suit(img, preset["tshirt_color"], preset["denim_color"])
    else:
        recolor_male_suit(img, preset["hoodie_color"], preset["denim_color"])


def style_blonde_hair(meshes, drape_over_hood=False):
    """Recolor `long01` hair mesh to sunlit golden honey-blonde and drape strands over the back hood if worn."""
    for m in meshes:
        if "long01" not in m.name:
            continue
        if drape_over_hood:
            # Push lower-back strands slightly outward (+X in world space) so they rest cleanly over SkaterHood
            inv_w = m.matrix_world.inverted()
            for v in m.data.vertices:
                wco = m.matrix_world @ v.co
                if wco.x > 0.0 and wco.z < 1.56:
                    t_back = max(0.0, min(1.0, (1.56 - wco.z) / 0.22))
                    wco.x += 0.028 * t_back * min(1.0, wco.x / 0.05)
                    v.co = inv_w @ wco
            m.data.update()

        for mat in m.data.materials:
            if not mat or not mat.node_tree:
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                bsdf.inputs["Roughness"].default_value = 0.58
            img = base_color_image(mat)
            if img is not None:
                w, h = img.size
                px = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(px)
                px = px.reshape(h, w, 4)
                lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]
                t_strand = np.clip((lum - 0.02) / 0.25, 0.0, 1.0) ** 0.70
                px[..., 0] = 0.58 + 0.35 * t_strand
                px[..., 1] = 0.44 + 0.36 * t_strand
                px[..., 2] = 0.22 + 0.28 * t_strand
                img.pixels.foreach_set(px.ravel())
                img.update()
                img.pack()
            # Wire single DiffuseTexture Alpha -> BSDF Alpha and remove duplicate AlphaMapTexture
            diff_node = next(
                (n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and "Alpha" not in n.name),
                None,
            )
            for n in list(mat.node_tree.nodes):
                if n.type == "TEX_IMAGE" and "Alpha" in n.name:
                    mat.node_tree.nodes.remove(n)
            if bsdf and diff_node:
                mat.node_tree.links.new(diff_node.outputs["Alpha"], bsdf.inputs["Alpha"])


def style_skate_shoes(shoes_obj, mat, is_female=False):
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

    # Reshape into a wider, flat-walled vulcanized skate shoe
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
            if is_female:
                # Taper shoe collar & sock inward so it sits cleanly inside the slim jeans hem
                taper = max(0.0, (wco.z - 0.205) / 0.053)
                wco.x = cx + (wco.x - cx) * (1.0 - 0.15 * taper)
                wco.y = cy + (wco.y - cy) * (1.0 - 0.18 * taper)
            else:
                # Padded skate-shoe ankle collar & tongue under baggy jeans
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


def build_basecap(rig, body, meshes, preset):
    """
    Construct a realistic 6-panel surfskate baseball cap / dad cap:
      - Crown: 6-panel hemispherical dome with subtle radial seams and athletic tilt
      - Visor / Brim: curved skate visor extending forward with rounded corners
      - Squatchee: fabric-covered top button at crown apex
      - Rigged & skinned 100% to the head bone
      - Radial & vertical hair compression: neatly tucks blonde hair under the cap dome
    """
    def bone_world(name, tail=False):
        b = rig.data.bones[name]
        return rig.matrix_world @ (b.tail_local if tail else b.head_local)

    neck_top = bone_world("head").z
    all_pts = np.array([body.matrix_world @ v.co for v in body.data.vertices])
    head_pts = all_pts[all_pts[:, 2] > neck_top]
    hmin, hmax = head_pts.min(0), head_pts.max(0)
    hc = (hmin + hmax) / 2

    cranium_cx = float(hmax[0] - 0.093)
    cranium_cy = float(hc[1])
    cranium_cz = float(hmax[2] - 0.065)

    rx = 0.099
    ry = 0.085
    rz = 0.081

    cap_color = preset.get("basecap_color", (0.04, 0.08, 0.16))
    cap_mat = new_material("SkaterBasecap", cap_color, roughness=0.88)

    tilt_angle = math.radians(-5.0)

    def get_rim_unit_z(phi):
        abs_phi = abs(phi)
        if abs_phi < math.radians(55):
            t = abs_phi / math.radians(55)
            return -0.10 - 0.04 * (t ** 2)
        elif abs_phi < math.radians(125):
            t = (abs_phi - math.radians(55)) / math.radians(70)
            return -0.14 - 0.14 * (t ** 1.2)
        else:
            t = (abs_phi - math.radians(125)) / math.radians(55)
            return -0.28 - 0.08 * (t ** 0.8)

    # 1. Crown dome
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=44, radius=1.0)
    crown = bpy.context.active_object
    crown.name = "SkaterBasecapCrown"

    bm = bmesh.new()
    bm.from_mesh(crown.data)

    verts_to_delete = []
    for v in bm.verts:
        phi = math.atan2(v.co.y, -v.co.x)
        angle_mod = (phi + math.pi / 6) % (math.pi / 3) - (math.pi / 6)
        seam_crease = 0.004 * math.exp(-((angle_mod * 8.0) ** 2)) * max(0.0, 1.0 - (v.co.z ** 2))

        if v.co.x < -0.15 and v.co.z > 0.0:
            v.co.x *= (1.0 + 0.035 * (1.0 - v.co.z**2))

        r = math.hypot(v.co.x, v.co.y)
        if r > 0.01:
            v.co.x -= seam_crease * (v.co.x / r)
            v.co.y -= seam_crease * (v.co.y / r)

        rim_z = get_rim_unit_z(phi)
        if v.co.z < rim_z:
            verts_to_delete.append(v)

    bmesh.ops.delete(bm, geom=verts_to_delete, context="VERTS")

    for v in bm.verts:
        if v.is_boundary:
            phi = math.atan2(v.co.y, -v.co.x)
            v.co.z = get_rim_unit_z(phi)
            rad_xy = math.sqrt(max(0.01, 1.0 - v.co.z**2))
            v.co.x = -math.cos(phi) * rad_xy
            v.co.y = math.sin(phi) * rad_xy

    bm.to_mesh(crown.data)
    bm.free()

    crown.scale = (rx, ry, rz)
    crown.location = (cranium_cx, cranium_cy, cranium_cz)
    crown.data.materials.append(cap_mat)
    mod = crown.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = 0.0036
    bpy.context.view_layer.objects.active = crown
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.modifier_apply(modifier="Solidify")

    # 2. Curved Visor / Brim
    bm_v = bmesh.new()
    nu = 24
    nv = 36
    max_phi = math.radians(56.0)

    grid = []
    for i in range(nu + 1):
        u = i / nu
        row = []
        for j in range(nv + 1):
            s = -1.0 + 2.0 * (j / nv)
            phi = s * max_phi

            rim_uz = get_rim_unit_z(phi)
            rim_xy_scale = math.sqrt(max(0.01, 1.0 - rim_uz**2))

            x_rim = cranium_cx - rx * math.cos(phi) * rim_xy_scale
            y_rim = cranium_cy + ry * math.sin(phi) * rim_xy_scale
            z_rim = cranium_cz + rz * rim_uz

            abs_s = abs(s)
            reach = 0.016 + 0.056 * math.sqrt(max(0.0, 1.0 - (abs_s ** 3.0)))

            dir_x = -math.cos(phi * 0.28)
            dir_y = math.sin(phi * 0.45)

            u_eff = max(0.0, u * 1.05 - 0.05)

            x = x_rim + u_eff * reach * dir_x
            y = y_rim + u_eff * reach * dir_y * 0.10

            z_slope = -0.010 * u_eff
            reach_factor = (reach - 0.016) / 0.056
            z_curve = -0.010 * (s ** 2) * u_eff * (0.3 + 0.7 * reach_factor)

            z = z_rim + z_slope + z_curve + 0.001 * (1.0 - u)

            vert = bm_v.verts.new((x, y, z))
            row.append(vert)
        grid.append(row)

    for i in range(nu):
        for j in range(nv):
            v0 = grid[i][j]
            v1 = grid[i+1][j]
            v2 = grid[i+1][j+1]
            v3 = grid[i][j+1]
            bm_v.faces.new((v0, v1, v2, v3))

    bm_v.verts.ensure_lookup_table()
    bm_v.faces.ensure_lookup_table()

    visor_mesh = bpy.data.meshes.new("SkaterBasecapVisor_Mesh")
    bm_v.to_mesh(visor_mesh)
    bm_v.free()

    visor = bpy.data.objects.new("SkaterBasecapVisor", visor_mesh)
    bpy.context.scene.collection.objects.link(visor)
    visor.data.materials.append(cap_mat)

    mod_v = visor.modifiers.new("Solidify", "SOLIDIFY")
    mod_v.thickness = 0.0034
    mod_v.offset = 0.0
    bpy.context.view_layer.objects.active = visor
    bpy.ops.object.shade_smooth()
    bpy.ops.object.modifier_apply(modifier="Solidify")

    # 3. Squatchee / Top Button
    apex_z = cranium_cz + rz + 0.002
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=1.0)
    squatchee = bpy.context.active_object
    squatchee.name = "SkaterBasecapButton"
    squatchee.scale = (0.008, 0.008, 0.004)
    squatchee.location = (cranium_cx, cranium_cy, apex_z)
    squatchee.data.materials.append(cap_mat)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # 4. Athletic tilt rotation around Y axis
    cos_tilt = math.cos(tilt_angle)
    sin_tilt = math.sin(tilt_angle)
    for obj in (crown, visor, squatchee):
        for v in obj.data.vertices:
            wco = obj.matrix_world @ v.co
            dx = wco.x - cranium_cx
            dz = wco.z - cranium_cz
            new_dx = dx * cos_tilt + dz * sin_tilt
            new_dz = -dx * sin_tilt + dz * cos_tilt
            wco.x = cranium_cx + new_dx
            wco.z = cranium_cz + new_dz
            v.co = obj.matrix_world.inverted() @ wco
        obj.data.update()

    # 5. Join crown, visor, squatchee into a single unified SkaterBasecap mesh
    bpy.ops.object.select_all(action="DESELECT")
    crown.select_set(True)
    visor.select_set(True)
    squatchee.select_set(True)
    bpy.context.view_layer.objects.active = crown
    bpy.ops.object.join()
    basecap = crown
    basecap.name = "SkaterBasecap"

    # Skin to head bone
    skin_to_bone(basecap, rig, "head")

    # 6. Realistic radial & vertical hair compression
    hair = next((m for m in meshes if "long01" in m.name), None)
    if hair:
        inv_w = hair.matrix_world.inverted()
        for v in hair.data.vertices:
            wco = hair.matrix_world @ v.co
            dx = (wco.x - cranium_cx) * cos_tilt - (wco.z - cranium_cz) * sin_tilt
            dz = (wco.x - cranium_cx) * sin_tilt + (wco.z - cranium_cz) * cos_tilt
            dy = wco.y - cranium_cy

            phi = math.atan2(dy, -dx)
            rim_uz = get_rim_unit_z(phi)
            rim_z_thresh = rim_uz * rz

            if dz > rim_z_thresh:
                t_z = min(0.98, max(0.0, dz / rz))
                inner_scale = math.sqrt(max(0.01, 1.0 - t_z**2)) * 0.94
                norm_r = math.hypot(dx / (rx * inner_scale), dy / (ry * inner_scale))
                if norm_r > 1.0:
                    dx /= norm_r
                    dy /= norm_r
                if dz > (rz * 0.95):
                    dz = rz * 0.94

                wco.x = cranium_cx + dx * cos_tilt + dz * sin_tilt
                wco.z = cranium_cz - dx * sin_tilt + dz * cos_tilt
                wco.y = cranium_cy + dy
                v.co = inv_w @ wco
            elif wco.x < (cranium_cx - 0.02) and abs(wco.y - cranium_cy) < 0.082 and wco.z > 1.625:
                wco.x += 0.028
                if wco.z > 1.638:
                    wco.z = 1.636
                v.co = inv_w @ wco

        hair.data.update()


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
    for gname in ("Delete.male_casualsuit02", "Delete.female_casualsuit01", "Delete.shoes06"):
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
            if any(k in mat.name for k in ("body", "low-poly", "male_casualsuit02", "female_casualsuit01", "shoes06")):
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

    # ---- Outfit recoloring ----
    for m in meshes:
        for mat in m.data.materials:
            if preset["outfit"] in mat.name:
                img = base_color_image(mat)
                if img is not None:
                    recolor_outfit(img, preset)

    # ---- Stance: left side toward the nose (-Y), facing the toe-side edge (-X) ----
    rig.rotation_mode = "XYZ"
    rig.rotation_euler = (0.0, 0.0, -math.pi / 2)
    rig.location = (0.0, 0.0, DECK_TOP_Z + 0.002)
    bpy.context.view_layer.update()

    # ---- Skate shoes: matte black suede + white stripes/laces + white vulcanized foxing sole ----
    for m in meshes:
        if "shoes06" in m.name and m.data.materials:
            style_skate_shoes(m, m.data.materials[0], is_female=(variant == "female"))

    # ---- Blonde hair styling (if hair asset is present) ----
    style_blonde_hair(meshes, drape_over_hood=preset.get("wear_hood", True))

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

    pad_mat = new_material("SkaterKneePad", (0.02, 0.02, 0.022), roughness=0.5)
    strap_mat = new_material("SkaterPadStrap", (0.0, 0.55, 0.52), roughness=0.7)

    if preset.get("wear_beanie", True):
        beanie_mat = new_material("SkaterBeanie", (0.0, 0.48, 0.46), roughness=0.90)
        cuff_mat = new_material("SkaterBeanieCuff", (0.0, 0.40, 0.39), roughness=0.92)

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

    # ---- Vintage surfskate basecap (curved visor, 6-panel dome + button), skinned to head ----
    if preset.get("wear_basecap", False):
        build_basecap(rig, body, meshes, preset)

    # ---- Draped hoodie collar & back hood (closed manifold torus around neck/upper back) ----
    if preset.get("wear_hood", True):
        # Linear-space charcoal matching the sRGB recolored hoodie texture (0.075 sRGB -> ~0.0068 linear)
        hood_linear = tuple(((c + 0.055) / 1.055) ** 2.4 for c in preset["hoodie_color"])
        fabric = new_material("SkaterHood", hood_linear, roughness=0.92)

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
    if preset.get("wear_knee_pads", True):
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

    out_path = preset.get("output", OUTPUT_PATH)
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
    print(f"Exported CC0 MakeHuman surfskater ({variant}) to {out_path} ({os.path.getsize(out_path) // 1024} KB)")


if __name__ == "__main__":
    main()
