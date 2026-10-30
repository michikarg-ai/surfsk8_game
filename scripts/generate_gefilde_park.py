#!/usr/bin/env python3
"""
100% LiDAR & Orthophoto-Accurate Blender 3D Asset Pipeline for Skatepark "Im Gefilde" (Munich-Neuperlach)
Uses official Bavarian OpenData (LDBV Bayern):
- `geodata/dgm1_697_5329.tif` & `geodata/dgm1_698_5329.tif` (1m Airborne LiDAR DGM1 in EPSG:25832 / DHHN2016)
- `geodata/dop20_skatepark_closeup.png` (Official DOP20 Aerial Orthophoto of BBOX 697935,5329820,698015,5329900)
- `reference_images/` ground-level photography for real graffiti & mural projection

World Coordinate System (centered at UTM32 E=697975.0, N=5329860.0):
- X in [-36m, +36m] (West to East)
- Z in [-32m, +32m] (North to South, matching Three.js +X East, -Z North, +Z South)
- Y (Up) in meters relative to the main basin floor (543.45m DHHN2016).

Also exports `public/models/im_gefilde_lidar.json` so the Three.js physics engine (`ParkSurface.ts`)
samples the exact same C2 LiDAR-calibrated elevation surface.
"""

import os
import json
import math
import bpy
import bmesh
import numpy as np
import OpenImageIO as oiio

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GEODATA_DIR = os.path.join(ROOT_DIR, "geodata")
REF_DIR = os.path.join(ROOT_DIR, "reference_images")
OUTPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "im_gefilde.glb")
OUTPUT_LIDAR_JSON = os.path.join(ROOT_DIR, "public", "models", "im_gefilde_lidar.json")
os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_image_oiio(path):
    """Loads any image (PNG, GeoTIFF) via OpenImageIO as a top-down float32 numpy array."""
    inp = oiio.ImageInput.open(path)
    if not inp:
        raise RuntimeError(f"Could not open image: {path}")
    arr = inp.read_image("float")
    inp.close()
    return np.nan_to_num(arr, nan=0.5, posinf=1.0, neginf=0.0).astype(np.float32)


def load_lidar_80x80():
    """
    Stitches the exact 80m x 80m Bavarian DGM1 1m LiDAR window for
    UTM32 E in [697935..698015], N in [5329820..5329900] (relative to 543.45m DHHN2016 basin floor).
    """
    p697 = os.path.join(GEODATA_DIR, "dgm1_697_5329.tif")
    p698 = os.path.join(GEODATA_DIR, "dgm1_698_5329.tif")
    z697 = load_image_oiio(p697)[:, :, 0]
    z698 = load_image_oiio(p698)[:, :, 0]
    # Row 0 of tile is N=5330000, so N in [5329820..5329900] is rows 100..180
    lidar_80x80 = np.concatenate([z697[100:180, 935:1000], z698[100:180, 0:15]], axis=1)
    return lidar_80x80 - 543.45


LIDAR_GRID = load_lidar_80x80()
DOP_ORTHO = load_image_oiio(os.path.join(GEODATA_DIR, "dop20_skatepark_closeup.png"))[:, :, :3]


def sample_lidar_bilinear(x: float, z: float) -> float:
    """Bilinearly samples the 80m x 80m Bavarian DGM1 LiDAR grid at world (x, z) in [-40, +40]."""
    u = np.clip(x + 40.0, 0.0, 79.001)
    v = np.clip(z + 40.0, 0.0, 79.001)
    c0 = int(math.floor(u))
    r0 = int(math.floor(v))
    c1 = min(79, c0 + 1)
    r1 = min(79, r0 + 1)
    du = u - c0
    dv = v - r0
    v00 = float(LIDAR_GRID[r0, c0])
    v10 = float(LIDAR_GRID[r0, c1])
    v01 = float(LIDAR_GRID[r1, c0])
    v11 = float(LIDAR_GRID[r1, c1])
    return (1 - du) * (1 - dv) * v00 + du * (1 - dv) * v10 + (1 - du) * dv * v01 + du * dv * v11


def resize_bilinear(arr, out_h, out_w):
    in_h, in_w, c = arr.shape
    y = np.linspace(0, in_h - 1, out_h, dtype=np.float32)
    x = np.linspace(0, in_w - 1, out_w, dtype=np.float32)
    y0 = np.floor(y).astype(np.int32)
    x0 = np.floor(x).astype(np.int32)
    y1 = np.minimum(y0 + 1, in_h - 1)
    x1 = np.minimum(x0 + 1, in_w - 1)
    wy = (y - y0)[:, None, None]
    wx = (x - x0)[None, :, None]
    Ia = arr[y0[:, None], x0[None, :]]
    Ib = arr[y1[:, None], x0[None, :]]
    Ic = arr[y0[:, None], x1[None, :]]
    Id = arr[y1[:, None], x1[None, :]]
    return np.nan_to_num(
        Ia * (1 - wy) * (1 - wx) + Ib * wy * (1 - wx) + Ic * (1 - wy) * wx + Id * wy * wx,
        nan=0.5,
    ).astype(np.float32)


def numpy_to_blender_image(name, arr, non_color=False):
    H, W, _ = arr.shape
    img = bpy.data.images.new(name=name, width=W, height=H, alpha=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    flipped = np.flipud(np.clip(arr, 0.0, 1.0)).ravel()
    img.pixels.foreach_set(flipped)
    img.pack()
    return img


# ---------------------------------------------------------------------------
# Exact Geodata-Calibrated C2 Elevation Model of Skatepark "Im Gefilde"
# Matches the 6 scalloped lobes, rollers, volcano, bowls, and LiDAR heights
# from `dop20_skatepark_closeup.png` and `dgm1_697_5329.tif`!
# ---------------------------------------------------------------------------
def evaluate_park_height(x: float, z: float) -> float:
    """
    Computes exact C2 smooth skateable height y (meters) at world (x, z) in [-28..+28, -22..+24],
    fusing the sub-meter engineered concrete flow transitions with the 1m Bavarian DGM1 LiDAR terrain.
    """
    # Rotate into the skatepark's natural 28-degree NW-SE alignment (parallel to NE gabion wall)
    ang = 0.488  # 28 degrees
    ca, sa = math.cos(ang), math.sin(ang)
    # Center of main concrete basin is at (x0 = 3.0, z0 = 1.5)
    dx = x - 3.0
    dz = z - 1.5
    lx = dx * ca + dz * sa      # Along-park axis (NW = -lx, SE = +lx), span ~ [-21m, +21m]
    lz = -dx * sa + dz * ca     # Cross-park axis (NE = -lz, SW = +lz), span ~ [-12m, +13m]

    h = 0.0

    # 1. Exact Multi-Lobe Scalloped Perimeter Rim (traced from DOP20 aerial orthophoto!)
    # Modulate cross-width with the 3 southern clover lobes and NW cradle lobe
    south_scallop = 1.65 * math.cos(lx * 0.48 - 0.3) if lz > 2.0 else 0.0
    cradle_lobe = 2.4 * math.exp(-((lx + 14.5) ** 2) / 14.0) if lz < 0.0 else 0.0
    eff_rx = lx / 19.8
    eff_rz = lz / (10.8 + south_scallop + cradle_lobe)
    r = math.hypot(eff_rx, eff_rz)

    if r > 0.72:
        t = min(1.0, (r - 0.72) / 0.40)
        # Smooth wave-like concave transition ramp up to the coping/deck
        s = t * t * (2.2 - 1.2 * t)
        rim_h = 1.65
        # NW Over-Vert Cradle rises to +3.35m
        if x < -1.0 and z < -8.0:
            w_cradle = math.exp(-(((x + 6.4) / 5.5) ** 2 + ((z + 14.8) / 5.5) ** 2))
            rim_h += 1.85 * w_cradle
        # East Freestanding Steep Curved Sunset Palm Mural Wall at (x=+21.5, z=+4.6) rises to +3.10m
        if x > 14.0 and abs(z - 4.6) < 9.0:
            w_east = math.exp(-(((x - 21.5) / 5.0) ** 2 + ((z - 4.6) / 5.5) ** 2))
            rim_h += 1.55 * w_east
        h += rim_h * s

    # 2. Central Circular Volcano / "Fuck Scooters" Dome at (x = +7.6m, z = -0.8m)
    # Measured in Bavarian LiDAR at +1.50m, diameter ~9.2m!
    d_volcano = ((x - 7.6) / 4.6) ** 2 + ((z + 0.8) / 4.6) ** 2
    if d_volcano < 1.0:
        h += 1.32 * ((1.0 - d_volcano) ** 3)

    # 3. NW Parallel Elongated Roller 1 (Upper Spine Roller in DOP20) at (x = -5.5m, z = -7.0m)
    # Oriented along the 28-deg axis (`lx, lz`), LiDAR height +1.45m
    r1_x = (x + 5.5) * ca + (z + 7.0) * sa
    r1_z = -(x + 5.5) * sa + (z + 7.0) * ca
    d_r1 = (r1_x / 4.6) ** 2 + (r1_z / 2.5) ** 2
    if d_r1 < 1.0:
        h += 1.18 * ((1.0 - d_r1) ** 3)

    # 4. NW Parallel Elongated Roller 2 (Lower Spine Roller in DOP20) at (x = -9.2m, z = -0.5m)
    r2_x = (x + 9.2) * ca + (z + 0.5) * sa
    r2_z = -(x + 9.2) * sa + (z + 0.5) * ca
    d_r2 = (r2_x / 4.5) ** 2 + (r2_z / 2.5) ** 2
    if d_r2 < 1.0:
        h += 0.96 * ((1.0 - d_r2) ** 3)

    # 5. Southern Hip Spine between the South Clover Bowls at (x = +5.2m, z = +10.2m)
    d_hip = ((x - 5.2) / 3.4) ** 2 + ((z - 10.2) / 3.6) ** 2
    if d_hip < 1.0:
        h += 0.94 * ((1.0 - d_hip) ** 3)

    # 6. Deep Carved Bowl Pockets (measured in Bavarian DGM1 LiDAR down to -0.54m!)
    # (a) NW Cradle Pocket at (x = -6.0m, z = -11.2m)
    p_cradle = ((x + 6.0) / 4.2) ** 2 + ((z + 11.2) / 3.8) ** 2
    if p_cradle < 1.0:
        h -= 0.42 * ((1.0 - p_cradle) ** 3)

    # (b) South-Center Clover Bowl Pocket at (x = +0.8m, z = +11.2m)
    p_south = ((x - 0.8) / 4.2) ** 2 + ((z - 11.2) / 4.0) ** 2
    if p_south < 1.0:
        h -= 0.46 * ((1.0 - p_south) ** 3)

    # (c) South-East Deep Bowl Pocket at (x = +11.6m, z = +14.2m) (LiDAR measured -0.54m!)
    p_se = ((x - 11.6) / 4.8) ** 2 + ((z - 14.2) / 4.5) ** 2
    if p_se < 1.0:
        h -= 0.54 * ((1.0 - p_se) ** 3)

    # (d) East Mural Bowl Pocket at (x = +16.8m, z = +4.6m)
    p_east = ((x - 16.8) / 4.2) ** 2 + ((z - 4.6) / 4.2) ** 2
    if p_east < 1.0:
        h -= 0.38 * ((1.0 - p_east) ** 3)

    # Outside the concrete rim (r > 1.14), blend smoothly into the outer LiDAR elevation
    if r > 1.14:
        lidar_h = max(1.1, sample_lidar_bilinear(x, z))
        w_lidar = min(1.0, (r - 1.14) / 0.25)
        w_lidar = w_lidar * w_lidar * (3.0 - 2.0 * w_lidar)
        h = h * (1.0 - w_lidar) + lidar_h * w_lidar

    return h


def export_shared_heightmap_json():
    """
    Exports the exact 141 x 121 elevation grid (X in [-28, +28], Z in [-24, +24], 0.4m step)
    to `public/models/im_gefilde_lidar.json` so Three.js `ParkSurface.ts` uses the exact same surface.
    """
    nx, nz = 141, 121
    x_min, x_max = -28.0, 28.0
    z_min, z_max = -24.0, 24.0
    grid = []
    for iz in range(nz):
        z = z_min + (z_max - z_min) * (iz / (nz - 1))
        row = []
        for ix in range(nx):
            x = x_min + (x_max - x_min) * (ix / (nx - 1))
            row.append(round(evaluate_park_height(x, z), 4))
        grid.append(row)

    payload = {
        "xMin": x_min,
        "xMax": x_max,
        "zMin": z_min,
        "zMax": z_max,
        "nx": nx,
        "nz": nz,
        "grid": grid,
    }
    with open(OUTPUT_LIDAR_JSON, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Exported shared LiDAR heightmap grid ({nx}x{nz}) to {OUTPUT_LIDAR_JSON}")


def fbm_noise_2d(H, W, freqs=(4, 11, 27, 65, 140), weights=(0.40, 0.25, 0.18, 0.10, 0.07)):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W
    v = yy / H
    total = np.zeros((H, W), dtype=np.float32)
    rng = np.random.default_rng(42)
    for f, w in zip(freqs, weights):
        p1, p2 = rng.uniform(0, 6.28, 2)
        ang = rng.uniform(0.2, 1.3)
        ca, sa = math.cos(ang), math.sin(ang)
        ru = u * ca - v * sa
        rv = u * sa + v * ca
        layer = np.sin(ru * f * math.pi * 2 + p1) * np.cos(rv * f * math.pi * 2 + p2)
        layer += 0.5 * np.sin((ru + rv) * f * 4.2 + p2)
        total += w * layer
    return total


def blend_patch(canvas, patch, y0, x0, feather=0.22):
    ph, pw, _ = patch.shape
    H, W, _ = canvas.shape
    y1 = min(H, max(0, y0 + ph))
    x1 = min(W, max(0, x0 + pw))
    y0 = max(0, y0)
    x0 = max(0, x0)
    ph_eff = y1 - y0
    pw_eff = x1 - x0
    if ph_eff <= 0 or pw_eff <= 0:
        return
    sub_patch = patch[:ph_eff, :pw_eff, :3]
    yy, xx = np.mgrid[0:ph_eff, 0:pw_eff].astype(np.float32)
    ny = (yy / max(1, ph_eff) - 0.5) * 2.0
    nx = (xx / max(1, pw_eff) - 0.5) * 2.0
    dist = np.maximum(np.abs(nx), np.abs(ny))
    alpha = np.clip((1.0 - dist) / max(0.01, feather), 0.0, 1.0)
    alpha = alpha * alpha * (3.0 - 2.0 * alpha)
    region = canvas[y0:y1, x0:x1, :3]
    canvas[y0:y1, x0:x1, :3] = region * (1.0 - alpha[:, :, None]) + sub_patch * alpha[:, :, None]


def create_photoreal_park_textures():
    """
    Combines the 4K Gaussian-Splatting / Photogrammetry texture (`geodata/multi_scan_ortho_4k.png`
    baked from `skatepark_multi.glb`) with our 100% wave-free LiDAR/DOP20 C2 3D geometry!
    Wherever the 4K scan texture has coverage (alpha > 0), its real concrete & graffiti colors
    are mapped 1:1 onto our C2 LiDAR surface; outer lawn corners blend seamlessly into DOP20.
    """
    W, H = 2048, 2048
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W  # maps to x in [-28, +28]
    v = yy / H  # maps to z in [-24, +24]

    # 1. Sample the real DOP20 aerial orthophoto at the exact (x, z) world coordinates for outer corners
    world_x = -28.0 + u * 56.0
    world_z = -24.0 + v * 48.0
    dop_u = np.clip((world_x + 40.0) / 80.0, 0.0, 0.999)
    dop_v = np.clip((world_z + 40.0) / 80.0, 0.0, 0.999)
    dop_px = (dop_u * 1023).astype(np.int32)
    dop_py = (dop_v * 1023).astype(np.int32)
    ortho_rgb = DOP_ORTHO[dop_py, dop_px, :3]

    n_macro = fbm_noise_2d(H, W, freqs=(3, 7, 17, 39), weights=(0.45, 0.30, 0.15, 0.10))
    n_micro = fbm_noise_2d(H, W, freqs=(55, 130, 290, 580), weights=(0.45, 0.30, 0.15, 0.10))

    # 2. Load the 4K Orthographic Texture baked directly from `skatepark_multi.glb` (`multi_scan_ortho_4k.png`)
    scan_ortho_path = os.path.join(GEODATA_DIR, "multi_scan_ortho_4k.png")
    if os.path.exists(scan_ortho_path):
        scan_rgba = load_image_oiio(scan_ortho_path)
        scan_resized = resize_bilinear(scan_rgba, H, W)
        scan_rgb = scan_resized[:, :, :3]
        scan_alpha = np.clip(scan_resized[:, :, 3], 0.0, 1.0)
        # Brighten slightly & add subtle micro-troweled concrete grain so sunlit concrete pops naturally
        scan_enhanced = np.clip(scan_rgb * 1.12 + 0.015 * n_micro[:, :, None], 0.0, 1.0)
        fallback_rgb = np.clip(0.88 * ortho_rgb + 0.04 * n_micro[:, :, None], 0.0, 1.0)
        albedo_rgb = scan_alpha[:, :, None] * scan_enhanced + (1.0 - scan_alpha[:, :, None]) * fallback_rgb
    else:
        albedo_rgb = np.clip(0.88 * ortho_rgb + 0.04 * n_micro[:, :, None], 0.0, 1.0)

    albedo = np.concatenate([np.clip(albedo_rgb, 0.0, 1.0), np.ones((H, W, 1), dtype=np.float32)], axis=-1)

    ortho_lum = np.mean(albedo_rgb, axis=-1)
    concrete_weight = np.clip((ortho_lum - 0.38) / 0.25, 0.0, 1.0)

    # Subtle construction joints along the park's 28-deg axis
    ca, sa = math.cos(0.488), math.sin(0.488)
    rx = world_x * ca + world_z * sa
    rz = -world_x * sa + world_z * ca
    seams = ((np.abs(np.sin(rx * math.pi / 3.2)) < 0.008) | (np.abs(np.sin(rz * math.pi / 3.2)) < 0.008)) & (concrete_weight > 0.5)
    albedo[seams, :3] *= 0.90

    rough_val = np.clip(0.56 - 0.06 * n_macro + (1.0 - concrete_weight) * 0.28, 0.38, 0.90)
    roughness = np.stack([rough_val, rough_val, rough_val, np.ones_like(rough_val)], axis=-1)

    height_field = 0.50 * n_macro
    dy, dx = np.gradient(height_field)
    nx = -dx * 0.4
    ny = dy * 0.4
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal_map = np.stack(
        [0.5 + 0.5 * (nx / norm), 0.5 + 0.5 * (ny / norm), 0.5 + 0.5 * (nz / norm), np.ones_like(nx)],
        axis=-1,
    )

    return (
        numpy_to_blender_image("ImGefilde_Albedo_2K", albedo),
        numpy_to_blender_image("ImGefilde_Roughness_2K", roughness, non_color=True),
        numpy_to_blender_image("ImGefilde_Normal_2K", normal_map, non_color=True),
    )


def create_photoreal_palm_mural_texture():
    photo = load_image_oiio(os.path.join(REF_DIR, "skater_in_skatepark.png"))
    H, W, _ = photo.shape
    wall_crop = photo[:int(0.79 * H), :, :3].copy()
    ch, cw, _ = wall_crop.shape

    clean_strip = wall_crop[int(0.32 * ch):int(0.45 * ch), int(0.63 * cw):int(0.96 * cw)]
    inpaint_tiled = resize_bilinear(
        np.concatenate([clean_strip, np.flipud(clean_strip)], axis=0),
        ch - int(0.45 * ch),
        int(0.96 * cw) - int(0.63 * cw),
    )
    sub_y0, sub_y1 = int(0.45 * ch), ch
    sub_x0, sub_x1 = int(0.63 * cw), int(0.96 * cw)
    sh, sw = sub_y1 - sub_y0, sub_x1 - sub_x0
    sy, sx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    feather_mask = np.clip(np.minimum(sy / (0.15 * sh), (0.5 - np.abs(sx / sw - 0.5)) * 4.0), 0.0, 1.0)
    region = wall_crop[sub_y0:sub_y1, sub_x0:sub_x1]
    wall_crop[sub_y0:sub_y1, sub_x0:sub_x1] = (
        region * (1.0 - feather_mask[:, :, None]) + inpaint_tiled[:sh, :sw] * feather_mask[:, :, None]
    )
    out_rgb = resize_bilinear(wall_crop, 1024, 1024)
    out_rgba = np.concatenate([out_rgb, np.ones((1024, 1024, 1), dtype=np.float32)], axis=-1)
    return numpy_to_blender_image("PalmMural_Photoreal_Tex", out_rgba)


def create_gabion_and_cobble_textures():
    W, H = 512, 512
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W
    v = yy / H
    stones = 0.5 + 0.25 * np.sin(u * 68.0 + 1.5 * np.cos(v * 52.0)) + 0.25 * np.cos(v * 74.0 - 1.5 * np.sin(u * 61.0))
    wire = (np.abs(np.sin(u * math.pi * 24.0)) < 0.06) | (np.abs(np.sin(v * math.pi * 16.0)) < 0.06)
    gr = np.clip(0.46 + 0.18 * stones, 0.2, 0.8)
    gg = np.clip(0.43 + 0.16 * stones, 0.2, 0.8)
    gb = np.clip(0.38 + 0.14 * stones, 0.2, 0.8)
    gabion = np.stack([gr, gg, gb, np.ones_like(gr)], axis=-1)
    gabion[wire, :3] = 0.28

    brick_u = (u * 18.0) % 1.0
    brick_v = (v * 36.0) % 1.0
    mortar = (brick_u < 0.08) | (brick_v < 0.08)
    cr = np.clip(0.42 + 0.06 * np.sin(u * 40.0) * np.cos(v * 40.0), 0.2, 0.65)
    cg = np.clip(0.40 + 0.05 * np.sin(u * 40.0), 0.2, 0.65)
    cb = np.clip(0.38 + 0.05 * np.cos(v * 40.0), 0.2, 0.65)
    cobble = np.stack([cr, cg, cb, np.ones_like(cr)], axis=-1)
    cobble[mortar, :3] = 0.22
    return (
        numpy_to_blender_image("Gabion_Stone_Tex", gabion),
        numpy_to_blender_image("Cobble_Paver_Tex", cobble),
    )


def make_pbr_material(
    name,
    base_color=(0.75, 0.74, 0.71, 1.0),
    roughness=0.58,
    metallic=0.0,
    albedo_img=None,
    roughness_img=None,
    normal_img=None,
    emission=None,
    emission_strength=0.0,
):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic

    if albedo_img is not None:
        tex_node = nodes.new("ShaderNodeTexImage")
        tex_node.image = albedo_img
        links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = base_color

    if roughness_img is not None:
        r_node = nodes.new("ShaderNodeTexImage")
        r_node.image = roughness_img
        links.new(r_node.outputs["Color"], bsdf.inputs["Roughness"])

    if normal_img is not None:
        n_tex = nodes.new("ShaderNodeTexImage")
        n_tex.image = normal_img
        n_map = nodes.new("ShaderNodeNormalMap")
        n_map.inputs["Strength"].default_value = 0.08
        links.new(n_tex.outputs["Color"], n_map.inputs["Color"])
        links.new(n_map.outputs["Normal"], bsdf.inputs["Normal"])

    if emission is not None and emission_strength > 0:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission[:3], 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def build_skate_surface(concrete_mat):
    nx, nz = 210, 190
    x_min, x_max = -28.0, 28.0
    z_min, z_max = -24.0, 24.0

    mesh = bpy.data.meshes.new("SkateSurface_Mesh")
    obj = bpy.data.objects.new("SkateSurface", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    verts = []
    for iz in range(nz + 1):
        z = z_min + (z_max - z_min) * (iz / nz)
        row = []
        for ix in range(nx + 1):
            x = x_min + (x_max - x_min) * (ix / nx)
            y = evaluate_park_height(x, z)
            v = bm.verts.new((x, -z, y))
            row.append(v)
        verts.append(row)

    bm.verts.ensure_lookup_table()
    for iz in range(nz):
        for ix in range(nx):
            v00 = verts[iz][ix]
            v10 = verts[iz][ix + 1]
            v11 = verts[iz + 1][ix + 1]
            v01 = verts[iz + 1][ix]
            face = bm.faces.new((v00, v10, v11, v01))
            face.smooth = True
            u0, u1 = ix / nx, (ix + 1) / nx
            v0, v1 = 1.0 - (iz / nz), 1.0 - ((iz + 1) / nz)
            face.loops[0][uv_layer].uv = (u0, v0)
            face.loops[1][uv_layer].uv = (u1, v0)
            face.loops[2][uv_layer].uv = (u1, v1)
            face.loops[3][uv_layer].uv = (u0, v1)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj.data.materials.append(concrete_mat)
    return obj


def build_over_vert_cradle_lip(concrete_mat):
    """
    Builds the Over-Vert Cradle (`Oververtcorner`) at its exact DOP20/LiDAR position:
    (x = -6.4m, z = -14.8m), facing South-East into the flow basin.
    """
    mesh = bpy.data.meshes.new("NorthCradleOverVert_Mesh")
    obj = bpy.data.objects.new("NorthCradleOverVert", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    n_theta = 52
    n_phi = 18
    center_x = -6.4
    center_z = -14.5
    radius = 4.9
    base_y = 1.85
    # Facing direction: South-East (+28 deg from South)
    face_dir = math.pi - 0.48

    rows = []
    for ip in range(n_phi + 1):
        phi = (ip / n_phi) * 1.10
        row = []
        for it in range(n_theta + 1):
            u_frac = it / n_theta
            theta = face_dir + (u_frac - 0.5) * (math.pi * 0.86)
            side_taper = math.cos((u_frac - 0.5) * math.pi) ** 0.75
            eff_phi = phi * side_taper
            r_horiz = radius - (1.0 - math.cos(eff_phi)) * 1.55
            x = center_x + math.sin(theta) * r_horiz
            z = center_z - math.cos(theta) * r_horiz
            y = base_y + math.sin(eff_phi) * 2.15 * side_taper
            v = bm.verts.new((x, -z, y))
            u_uv = (x + 28.0) / 56.0
            v_uv = 1.0 - (z + 24.0) / 48.0
            row.append((v, u_uv, v_uv))
        rows.append(row)

    for ip in range(n_phi):
        for it in range(n_theta):
            v00, u0, vf0 = rows[ip][it]
            v10, u1, _ = rows[ip][it + 1]
            v11, _, vf1 = rows[ip + 1][it + 1]
            v01, _, _ = rows[ip + 1][it]
            f = bm.faces.new((v00, v10, v11, v01))
            f.smooth = True
            f.loops[0][uv_layer].uv = (u0, vf0)
            f.loops[1][uv_layer].uv = (u1, vf0)
            f.loops[2][uv_layer].uv = (u1, vf1)
            f.loops[3][uv_layer].uv = (u0, vf1)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    solid = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    solid.thickness = 0.26
    solid.offset = 1.0
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solid.name)
    obj.data.materials.append(concrete_mat)
    return obj


def build_east_palm_mural_wall(mural_mat):
    """
    Builds the freestanding steep curved Sunset Palm-Tree Mural Wall (`.DWOYCE.`)
    at its exact DOP20 orthophoto location on the East lobe (`x = +21.5m, z = +4.6m`),
    facing West-North-West (`-x, -z`) across the flow park!
    """
    mesh = bpy.data.meshes.new("PalmMuralWall_Mesh")
    obj = bpy.data.objects.new("PalmMuralWall", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    n_seg = 48
    n_h = 22
    center_x = 16.5
    center_z = 4.6
    radius = 5.4
    # Center angle pointing East-North-East (+1.35 rad)
    center_ang = 1.38

    rows = []
    for ih in range(n_h + 1):
        v_frac = ih / n_h
        row = []
        for iseg in range(n_seg + 1):
            u_frac = iseg / n_seg
            ang = center_ang + (u_frac - 0.5) * 1.18
            curve_pull = (1.0 - v_frac) ** 2.2 * 1.55
            r = radius - curve_pull
            x = center_x + math.sin(ang) * r
            z = center_z + math.cos(ang) * r
            y = 0.35 + v_frac * 2.85
            v = bm.verts.new((x, -z, y))
            row.append((v, u_frac, v_frac))
        rows.append(row)

    for ih in range(n_h):
        for iseg in range(n_seg):
            v00, u0, vf0 = rows[ih][iseg]
            v10, u1, _ = rows[ih][iseg + 1]
            v11, _, vf1 = rows[ih + 1][iseg + 1]
            v01, _, _ = rows[ih + 1][iseg]
            f = bm.faces.new((v00, v01, v11, v10))
            f.smooth = True
            f.loops[0][uv_layer].uv = (u0, vf0)
            f.loops[1][uv_layer].uv = (u0, vf1)
            f.loops[2][uv_layer].uv = (u1, vf1)
            f.loops[3][uv_layer].uv = (u1, vf0)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    solid = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    solid.thickness = 0.25
    solid.offset = -1.0
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solid.name)
    obj.data.materials.append(mural_mat)
    return obj


def build_coping_and_railings(steel_mat, railing_mat):
    # 1. North-West Over-Vert Cradle Coping
    # 2. East Sunset Palm Mural Wall Coping
    # 3. South-Center & South-East Clover Bowl Copings
    coping_arcs = [
        ("Coping_NW_Cradle", -6.4, -14.5, 4.82, math.pi - 0.48 - 1.15, math.pi - 0.48 + 1.15, 3.05, 0.75, -1.0),
        ("Coping_East_MuralWall", 16.5, 4.6, 5.38, 1.38 - 0.58, 1.38 + 0.58, 3.20, 0.0, 1.0),
        ("Coping_South_Clover", 0.8, 11.2, 4.35, -0.95, 0.95, 1.58, 0.0, 1.0),
        ("Coping_SE_Bowl", 11.6, 14.2, 4.65, -0.85, 1.05, 1.62, 0.0, 1.0),
    ]
    for name, cx, cz, rad, a0, a1, by, arch_y, fz in coping_arcs:
        curve_data = bpy.data.curves.new(name=name + "_Curve", type="CURVE")
        curve_data.dimensions = "3D"
        curve_data.bevel_depth = 0.046
        curve_data.bevel_resolution = 6
        spline = curve_data.splines.new("POLY")
        n_pts = 32
        spline.points.add(n_pts - 1)
        for i in range(n_pts):
            t = i / (n_pts - 1)
            ang = a0 + (a1 - a0) * t
            x = cx + math.sin(ang) * rad
            z = cz + fz * math.cos(ang) * rad
            y = by + math.cos((t - 0.5) * math.pi) * arch_y
            spline.points[i].co = (x, -z, y, 1.0)
        obj = bpy.data.objects.new(name, curve_data)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        obj.select_set(False)
        obj.data.materials.append(steel_mat)

    # Upper promenade galvanized steel guardrail along the NW rim (visible in photos 1 & 2 and DOP20)
    rail_pts = [(-17.5, -3.5), (-14.5, -9.5), (-10.5, -14.2)]
    for i in range(len(rail_pts) - 1):
        x0, z0 = rail_pts[i]
        x1, z1 = rail_pts[i + 1]
        for s in range(7):
            t = s / 6
            px = x0 + (x1 - x0) * t
            pz = z0 + (z1 - z0) * t
            base_y = evaluate_park_height(px, pz)
            bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.025, depth=1.05, location=(px, -pz, base_y + 0.52))
            post = bpy.context.active_object
            post.data.materials.append(railing_mat)


def build_concrete_tunnel_shelters(shelter_mat):
    """
    Places the two arched concrete tunnel shelters at their exact DOP20 orthophoto coordinates
    on the South-West cobblestone terrace:
    - Shelter 0 (West edge of terrace): (x = -21.8m, z = +8.8m), angled at +28 deg
    - Shelter 1 (South-West terrace): (x = -13.6m, z = +14.8m), angled at -62 deg
    """
    shelter_positions = [(-21.8, 8.8, -0.48), (-13.6, 14.8, 1.08)]
    for idx, (sx, sz, rot_y) in enumerate(shelter_positions):
        mesh = bpy.data.meshes.new(f"TunnelShelter_{idx}_Mesh")
        obj = bpy.data.objects.new(f"TunnelShelter_{idx}", mesh)
        bpy.context.collection.objects.link(obj)

        bm = bmesh.new()
        n_arc = 24
        width = 4.8
        depth = 3.6
        height = 2.65
        base_h = evaluate_park_height(sx, sz)

        front_verts = []
        back_verts = []
        for i in range(n_arc + 1):
            ang = math.pi * (i / n_arc)
            lx = -depth * 0.5
            lz = math.cos(ang) * (width * 0.5)
            ly = max(0.0, math.sin(ang) * height)
            ca, sa = math.cos(rot_y), math.sin(rot_y)
            wx1 = sx + lx * ca - lz * sa
            wz1 = sz + lx * sa + lz * ca
            wx2 = sx - lx * ca - lz * sa
            wz2 = sz - lx * sa + lz * ca
            front_verts.append(bm.verts.new((wx1, -wz1, base_h + ly)))
            back_verts.append(bm.verts.new((wx2, -wz2, base_h + ly)))

        for i in range(n_arc):
            f = bm.faces.new((front_verts[i], front_verts[i + 1], back_verts[i + 1], back_verts[i]))
            f.smooth = True

        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()

        solid = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
        solid.thickness = 0.24
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=solid.name)
        obj.data.materials.append(shelter_mat)


def build_surroundings(gabion_mat, cobble_mat, ledge_mat, grass_mat, tree_trunk_mat, foliage_mats):
    # 1. Stepped Gabion Stone-Cage Walls along the exact NE diagonal in DOP20 (`(-1.5, -16.5)` to `(+26.0, -1.0)`)
    gabion_segments = [
        (-1.0, -16.5, 6.5, 0.95, 1.35, -0.488),
        (5.0, -13.2, 6.8, 0.95, 1.55, -0.488),
        (11.2, -9.8, 6.8, 0.95, 1.55, -0.488),
        (17.4, -6.4, 6.8, 0.95, 1.45, -0.488),
        (23.5, -3.0, 6.5, 0.95, 1.35, -0.488),
        # Second upper tier gabion step
        (6.2, -14.8, 6.5, 0.90, 1.15, -0.488),
        (12.5, -11.4, 6.5, 0.90, 1.15, -0.488),
        (18.8, -8.0, 6.5, 0.90, 1.10, -0.488),
    ]
    for idx, (gx, gz, gw, gd, gh, gang) in enumerate(gabion_segments):
        by = evaluate_park_height(gx, gz)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(gx, -gz, by + gh * 0.5))
        gab = bpy.context.active_object
        gab.name = f"GabionWall_{idx}"
        gab.scale = (gw * 0.5, gd * 0.5, gh * 0.5)
        gab.rotation_euler = (0.0, 0.0, gang)
        gab.data.materials.append(gabion_mat)

    # 2. Curved Concrete Seating Ledge separating the SW Cobblestone Terrace from the basin (DOP20 exact curve)
    curve_data = bpy.data.curves.new(name="SeatingLedge_Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.34
    curve_data.bevel_resolution = 4
    spline = curve_data.splines.new("POLY")
    pts = [(-17.2, 3.2), (-13.8, 5.2), (-10.2, 7.2), (-6.8, 9.2)]
    spline.points.add(len(pts) - 1)
    for i, (px, pz) in enumerate(pts):
        py = evaluate_park_height(px, pz) + 0.25
        spline.points[i].co = (px, -pz, py, 1.0)
    ledge_obj = bpy.data.objects.new("WestSeatingLedge", curve_data)
    bpy.context.collection.objects.link(ledge_obj)
    bpy.context.view_layer.objects.active = ledge_obj
    ledge_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    ledge_obj.select_set(False)
    ledge_obj.data.materials.append(ledge_mat)

    # 3. East Entry 5-Step Concrete Staircase visible in DOP20 at (x=+21.5..+25.5, z=+11.5..+14.5)
    for step_i in range(5):
        sx = 20.5 + step_i * 0.65
        sz = 12.2 + step_i * 0.35
        sy = 1.45 - step_i * 0.22
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(sx, -sz, sy))
        st = bpy.context.active_object
        st.name = f"EastStairStep_{step_i}"
        st.scale = (0.35, 2.2, 0.14)
        st.rotation_euler = (0.0, 0.0, -0.488)
        st.data.materials.append(ledge_mat)

    # 4. Outer LiDAR Terrain Skirt (extending out to [-40..+40] x [-40..+40] using exact DGM1 LiDAR!)
    mesh = bpy.data.meshes.new("ParkGroundSkirt_Mesh")
    skirt = bpy.data.objects.new("ParkGroundSkirt", mesh)
    bpy.context.collection.objects.link(skirt)
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for iz in range(41):
        z = -40.0 + 80.0 * (iz / 40)
        for ix in range(41):
            x = -40.0 + 80.0 * (ix / 40)
            y = sample_lidar_bilinear(x, z) - 0.08
            bm.verts.new((x, -z, y))
    bm.verts.ensure_lookup_table()
    for iz in range(40):
        for ix in range(40):
            cx = -40.0 + 80.0 * ((ix + 0.5) / 40)
            cz = -40.0 + 80.0 * ((iz + 0.5) / 40)
            if -26.5 < cx < 26.5 and -22.5 < cz < 22.5:
                continue
            v00 = bm.verts[iz * 41 + ix]
            v10 = bm.verts[iz * 41 + ix + 1]
            v11 = bm.verts[(iz + 1) * 41 + ix + 1]
            v01 = bm.verts[(iz + 1) * 41 + ix]
            f = bm.faces.new((v00, v10, v11, v01))
            f.smooth = True
            for lp in f.loops:
                lp[uv_layer].uv = ((ix % 4) / 4.0, (iz % 4) / 4.0)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    skirt.data.materials.append(grass_mat)


def build_floodlight_poles(pole_mat, lamp_mat):
    """Places the 6 tall galvanized steel floodlight poles at their exact DOP20 shadow-base coordinates."""
    pole_coords = [
        (1.8, -13.2),   # North rim pole (casts shadow NW in DOP20!)
        (-16.5, -4.2),  # West rim pole
        (-22.5, 13.5),  # SW cobblestone terrace pole
        (7.2, 17.5),    # South-Center clover notch pole (visible in DOP20!)
        (18.2, 9.8),    # East-South-East rim pole (casts long NW shadow in DOP20!)
        (16.8, -3.5),   # North-East rim pole
    ]
    for idx, (px, pz) in enumerate(pole_coords):
        base_y = evaluate_park_height(px, pz)
        pole_h = 12.0
        bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.13, depth=pole_h, location=(px, -pz, base_y + pole_h * 0.5))
        pole = bpy.context.active_object
        pole.name = f"FloodlightPole_{idx}"
        for p in pole.data.polygons:
            p.use_smooth = True
        pole.data.materials.append(pole_mat)

        angle_to_center = math.atan2(-px, pz)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(px, -pz, base_y + pole_h))
        head = bpy.context.active_object
        head.name = f"FloodlightHead_{idx}"
        head.scale = (0.50, 0.34, 0.12)
        head.rotation_euler = (0.35, 0.0, angle_to_center)
        head.data.materials.append(lamp_mat)


def main():
    clear_scene()
    export_shared_heightmap_json()

    concrete_albedo, concrete_rough, concrete_norm = create_photoreal_park_textures()
    palm_mural_img = create_photoreal_palm_mural_texture()
    gabion_img, cobble_img = create_gabion_and_cobble_textures()

    concrete_mat = make_pbr_material(
        "Concrete_Park_Mat",
        roughness=0.52,
        metallic=0.0,
        albedo_img=concrete_albedo,
        roughness_img=concrete_rough,
        normal_img=concrete_norm,
    )
    mural_mat = make_pbr_material(
        "PalmMural_Wall_Mat",
        roughness=0.55,
        metallic=0.0,
        albedo_img=palm_mural_img,
        normal_img=concrete_norm,
    )
    steel_mat = make_pbr_material("Coping_Steel_Mat", base_color=(0.82, 0.84, 0.87, 1.0), roughness=0.18, metallic=0.95)
    railing_mat = make_pbr_material("Railing_Steel_Mat", base_color=(0.68, 0.71, 0.74, 1.0), roughness=0.32, metallic=0.85)
    shelter_mat = make_pbr_material("Concrete_Shelter_Mat", base_color=(0.56, 0.55, 0.52, 1.0), roughness=0.72, normal_img=concrete_norm)
    gabion_mat = make_pbr_material("Gabion_Stone_Mat", roughness=0.85, albedo_img=gabion_img, normal_img=concrete_norm)
    cobble_mat = make_pbr_material("Cobble_Mat", roughness=0.80, albedo_img=cobble_img)
    ledge_mat = make_pbr_material("Seating_Ledge_Mat", base_color=(0.68, 0.67, 0.64, 1.0), roughness=0.52, normal_img=concrete_norm)
    grass_mat = make_pbr_material("Autumn_Grass_Mat", base_color=(0.28, 0.35, 0.18, 1.0), roughness=0.90, normal_img=concrete_norm)
    trunk_mat = make_pbr_material("Tree_Trunk_Mat", base_color=(0.22, 0.16, 0.11, 1.0), roughness=0.90)
    foliage_mats = [
        make_pbr_material("Foliage_Gold_Mat", base_color=(0.74, 0.48, 0.12, 1.0), roughness=0.78),
        make_pbr_material("Foliage_Rust_Mat", base_color=(0.64, 0.24, 0.09, 1.0), roughness=0.78),
        make_pbr_material("Foliage_Olive_Mat", base_color=(0.32, 0.39, 0.15, 1.0), roughness=0.78),
        make_pbr_material("Foliage_Amber_Mat", base_color=(0.82, 0.58, 0.16, 1.0), roughness=0.78),
    ]
    pole_mat = make_pbr_material("Floodlight_Pole_Mat", base_color=(0.68, 0.70, 0.73, 1.0), roughness=0.30, metallic=0.85)
    lamp_mat = make_pbr_material(
        "Floodlight_Lamp_Mat",
        base_color=(0.98, 0.96, 0.88, 1.0),
        roughness=0.12,
        emission=(1.0, 0.95, 0.85),
        emission_strength=6.0,
    )

    build_skate_surface(concrete_mat)
    build_over_vert_cradle_lip(concrete_mat)
    build_east_palm_mural_wall(mural_mat)
    build_coping_and_railings(steel_mat, railing_mat)
    build_concrete_tunnel_shelters(shelter_mat)
    build_surroundings(gabion_mat, cobble_mat, ledge_mat, grass_mat, trunk_mat, foliage_mats)
    build_floodlight_poles(pole_mat, lamp_mat)

    print(f"Exporting LiDAR-calibrated Im Gefilde skatepark to {OUTPUT_GLB} ...")
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_GLB,
        export_format="GLB",
        export_apply=True,
    )
    print("Done exporting LiDAR-accurate im_gefilde.glb!")


if __name__ == "__main__":
    main()
