#!/usr/bin/env python3
"""
scripts/gefilde_graffiti_rebake.py

High-resolution, zero-distortion Blender multi-view orthographic projection +
4K UV re-bake workflow to replace graffiti in Skatepark "Im Gefilde"
(`public/models/skatepark_multi.glb`).

Subcommands:
  --mode extract
      Loads `public/models/skatepark_multi.glb` with its 4K texture
      `public/textures/skatepark_multi_tex0.png` in an Unlit/Emission shader,
      renders straight-on 3:1 orthographic views of the 4 main graffiti/transition
      zones (`data/gefilde_view_1_orig.png` .. `data/gefilde_view_4_orig.png`),
      renders an annotated top-down overview (`data/gefilde_overview.png`), and
      saves exact camera parameters to `data/gefilde_ortho_cams.json`.

  --mode bake
      Projects `data/gefilde_view_1_edited.png` .. `data/gefilde_view_4_edited.png`
      onto bowl/transition faces facing each camera (`-dot(face_normal, cam_forward) > 0.30`),
      bakes each view's color and alpha mask into 4096x4096 on the original
      `UVMap`, blends overlapping views seamlessly in numpy, composites over the
      original 4K texture so 100% of unpainted concrete/grass/stairs/surroundings
      are preserved, optionally cleans flat floor tags, and writes
      `public/textures/skatepark_multi_tex0_aigraffiti_test.jpg` (4096x4096, q=90).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "skatepark_multi.glb")
ORIG_TEX = os.path.join(ROOT_DIR, "public", "textures", "skatepark_multi_tex0.png")
DATA_DIR = os.path.join(ROOT_DIR, "data")

OVERVIEW_IMG = os.path.join(DATA_DIR, "gefilde_overview.png")
CAMS_JSON = os.path.join(DATA_DIR, "gefilde_ortho_cams.json")
OUTPUT_TEX = os.path.join(
    ROOT_DIR, "public", "textures", "skatepark_multi_tex0_aigraffiti_test.jpg"
)

VIEW_SPECS = [
    {
        "key": "view_1",
        "label": "V1: South Curved Quarterpipe (SW-SE)",
        "loc": (-0.20, 0.05, 0.32),
        "target": (-0.20, -0.55, 0.08),
        "ortho_scale": 1.45,
        "res_x": 1536,
        "res_y": 512,
        "color": (0, 220, 255),
    },
    {
        "key": "view_2",
        "label": "V2: East & SE Bank / Quarterpipe",
        "loc": (0.10, -0.05, 0.35),
        "target": (0.75, -0.02, 0.09),
        "ortho_scale": 1.25,
        "res_x": 1536,
        "res_y": 512,
        "color": (80, 255, 80),
    },
    {
        "key": "view_3",
        "label": "V3: North & NW Lobes / Inner Hip",
        "loc": (-0.25, 0.00, 0.35),
        "target": (-0.25, 0.60, 0.09),
        "ortho_scale": 1.40,
        "res_x": 1536,
        "res_y": 512,
        "color": (255, 180, 60),
    },
    {
        "key": "view_4",
        "label": "V4: West Quarterpipe & Hip",
        "loc": (-0.15, -0.05, 0.35),
        "target": (-0.75, -0.05, 0.09),
        "ortho_scale": 1.20,
        "res_x": 1536,
        "res_y": 512,
        "color": (255, 90, 220),
    },
]


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Gefilde skatepark graffiti rebake")
    parser.add_argument(
        "--mode",
        choices=["extract", "bake"],
        required=True,
        help="Workflow step: extract orthographic views or bake edited views to 4K",
    )
    return parser.parse_args(argv)


def load_scene_and_mesh(tex_path=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=INPUT_GLB)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {INPUT_GLB}")
    obj = meshes[0]

    use_tex = tex_path or ORIG_TEX
    if not os.path.exists(use_tex):
        raise FileNotFoundError(f"Texture not found: {use_tex}")
    tex_img = bpy.data.images.load(use_tex, check_existing=True)
    tex_img.colorspace_settings.name = "sRGB"

    # Standard color management for 1:1 albedo fidelity
    scene = bpy.context.scene
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    return obj, tex_img


def apply_unlit_material(obj, tex_img):
    mat = bpy.data.materials.new(name="UnlitAlbedo")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = tex_img
    tex.interpolation = "Linear"

    nt.links.new(tex.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    obj.data.materials.clear()
    obj.data.materials.append(mat)


def _cam_basis_from_look(loc: Vector, target: Vector):
    fwd = (target - loc).normalized()
    world_up = Vector((0.0, 0.0, 1.0))
    right = fwd.cross(world_up).normalized()
    up = right.cross(fwd).normalized()
    return right, up, fwd


def make_ortho_camera(
    name: str,
    location: Vector,
    cam_right: Vector,
    cam_up: Vector,
    cam_forward: Vector,
    ortho_scale: float,
    res_x: int,
    res_y: int,
    clip_start: float = 0.05,
    clip_end: float = 20.0,
):
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.clip_start = clip_start
    cam_data.clip_end = clip_end

    cam_obj = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)

    # Camera local axes: +X = right, +Y = up, -Z = forward
    rot_mat = Matrix(
        (
            (cam_right.x, cam_up.x, -cam_forward.x),
            (cam_right.y, cam_up.y, -cam_forward.y),
            (cam_right.z, cam_up.z, -cam_forward.z),
        )
    )
    cam_obj.location = location
    cam_obj.rotation_euler = rot_mat.to_euler("XYZ")

    meta = {
        "location": [float(location.x), float(location.y), float(location.z)],
        "rotation_euler": [
            float(cam_obj.rotation_euler.x),
            float(cam_obj.rotation_euler.y),
            float(cam_obj.rotation_euler.z),
        ],
        "cam_right": [float(cam_right.x), float(cam_right.y), float(cam_right.z)],
        "cam_up": [float(cam_up.x), float(cam_up.y), float(cam_up.z)],
        "cam_forward": [float(cam_forward.x), float(cam_forward.y), float(cam_forward.z)],
        "ortho_scale": float(ortho_scale),
        "resolution_x": int(res_x),
        "resolution_y": int(res_y),
        "clip_start": float(clip_start),
        "clip_end": float(clip_end),
    }
    return cam_obj, meta


def render_camera(cam_obj, res_x: int, res_y: int, out_path: str):
    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = out_path

    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.12, 0.12, 0.12, 1.0)
        bg.inputs[1].default_value = 1.0

    bpy.ops.render.render(write_still=True)


def run_extract():
    os.makedirs(DATA_DIR, exist_ok=True)
    obj, tex_img = load_scene_and_mesh()
    apply_unlit_material(obj, tex_img)

    cams_out = {}
    for v in VIEW_SPECS:
        loc = Vector(v["loc"])
        target = Vector(v["target"])
        right, up, fwd = _cam_basis_from_look(loc, target)
        cam_obj, meta = make_ortho_camera(
            f"Gefilde_{v['key']}",
            location=loc,
            cam_right=right,
            cam_up=up,
            cam_forward=fwd,
            ortho_scale=v["ortho_scale"],
            res_x=v["res_x"],
            res_y=v["res_y"],
            clip_start=0.05,
            clip_end=10.0,
        )
        out_path = os.path.join(DATA_DIR, f"gefilde_{v['key']}_orig.png")
        render_camera(cam_obj, v["res_x"], v["res_y"], out_path)
        meta["label"] = v["label"]
        meta["target"] = list(v["target"])
        cams_out[v["key"]] = meta
        print(f"Rendered {out_path} ({v['res_x']}x{v['res_y']})")

    # Top-down overview centered on the bowl
    ov_center = (0.0, 0.05)
    ov_scale = 2.4
    ov_res = 1024
    ov_cam, ov_meta = make_ortho_camera(
        "GefildeOverviewCam",
        location=Vector((ov_center[0], ov_center[1], 5.0)),
        cam_right=Vector((1.0, 0.0, 0.0)),
        cam_up=Vector((0.0, 1.0, 0.0)),
        cam_forward=Vector((0.0, 0.0, -1.0)),
        ortho_scale=ov_scale,
        res_x=ov_res,
        res_y=ov_res,
        clip_start=0.1,
        clip_end=20.0,
    )
    render_camera(ov_cam, ov_res, ov_res, OVERVIEW_IMG)

    ann_script = f"""
import cv2
img = cv2.imread({OVERVIEW_IMG!r})
def w2p(x, y):
    px = int(((x - {ov_center[0]}) / {ov_scale} + 0.5) * {ov_res})
    py = int((0.5 - (y - {ov_center[1]}) / {ov_scale}) * {ov_res})
    return (px, py)
views = {[(v['key'], v['loc'][:2], v['target'][:2], v['color'], v['label']) for v in VIEW_SPECS]!r}
for key, loc_xy, tgt_xy, col, label in views:
    p0 = w2p(loc_xy[0], loc_xy[1])
    p1 = w2p(tgt_xy[0], tgt_xy[1])
    cv2.arrowedLine(img, p0, p1, col, 3, tipLength=0.14)
    cv2.circle(img, p0, 8, col, -1)
    cv2.putText(img, key, (p0[0] + 10, p0[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.65, col, 2)
cv2.imwrite({OVERVIEW_IMG!r}, img)
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", ann_script], check=True)
    print(f"Rendered annotated {OVERVIEW_IMG} ({ov_res}x{ov_res})")

    cams_out["overview"] = ov_meta
    with open(CAMS_JSON, "w") as f:
        json.dump(cams_out, f, indent=2)
    print(f"Saved camera parameters to {CAMS_JSON}")


def project_uv_from_cam(me: bpy.types.Mesh, mw: Matrix, uv_name: str, cam_meta: dict):
    uv_layer = me.uv_layers.new(name=uv_name)
    loc = Vector(cam_meta["location"])
    right = Vector(cam_meta["cam_right"])
    up = Vector(cam_meta["cam_up"])
    ortho_scale = cam_meta["ortho_scale"]
    aspect = cam_meta["resolution_y"] / cam_meta["resolution_x"]
    v_scale = ortho_scale * aspect

    for poly in me.polygons:
        for loop_idx in poly.loop_indices:
            v_idx = me.loops[loop_idx].vertex_index
            p = mw @ me.vertices[v_idx].co
            d = p - loc
            u = 0.5 + d.dot(right) / ortho_scale
            v = 0.5 + d.dot(up) / v_scale
            uv_layer.data[loop_idx].uv = (u, v)
    return uv_layer


def make_projected_material(name: str, uv_name: str, img_path: str, orig_img):
    if not os.path.exists(img_path):
        raise FileNotFoundError(f"Edited view image not found: {img_path}")
    ed_img = bpy.data.images.load(img_path, check_existing=True)
    ed_img.colorspace_settings.name = "sRGB"

    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0

    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"

    uv_orig = nt.nodes.new("ShaderNodeUVMap")
    uv_orig.uv_map = "UVMap"
    tex_orig = nt.nodes.new("ShaderNodeTexImage")
    tex_orig.image = orig_img

    uv_proj = nt.nodes.new("ShaderNodeUVMap")
    uv_proj.uv_map = uv_name
    tex_proj = nt.nodes.new("ShaderNodeTexImage")
    tex_proj.image = ed_img
    tex_proj.extension = "CLIP"

    nt.links.new(uv_orig.outputs["UV"], tex_orig.inputs["Vector"])
    nt.links.new(uv_proj.outputs["UV"], tex_proj.inputs["Vector"])
    nt.links.new(tex_proj.outputs["Alpha"], mix.inputs["Fac"])
    nt.links.new(tex_orig.outputs["Color"], mix.inputs[1])
    nt.links.new(tex_proj.outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def run_bake():
    if not os.path.exists(CAMS_JSON):
        raise FileNotFoundError(f"Run --mode extract first; missing {CAMS_JSON}")
    with open(CAMS_JSON, "r") as f:
        cams = json.load(f)

    obj, orig_img = load_scene_and_mesh()
    me = obj.data
    mw = obj.matrix_world
    normal_mat = mw.to_3x3().inverted().transposed()
    orig_px = np.array(orig_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]

    me.uv_layers["UVMap"].active = True
    me.uv_layers["UVMap"].active_render = True

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.cycles.bake_type = "EMIT"
    scene.render.bake.use_clear = True

    # --- 1. Wall/Transition Hero Murals (view_1 DRIFT + view_4 CARVE/Wave) ---
    view_keys = ["view_1", "view_4"]
    mat_non = bpy.data.materials.new("Mat_NonBowl")
    mat_non.use_nodes = True
    nt0 = mat_non.node_tree
    nt0.nodes.clear()
    out0 = nt0.nodes.new("ShaderNodeOutputMaterial")
    emit0 = nt0.nodes.new("ShaderNodeEmission")
    emit0.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    emit0.inputs["Strength"].default_value = 1.0
    nt0.links.new(emit0.outputs["Emission"], out0.inputs["Surface"])

    me.materials.clear()
    me.materials.append(mat_non)

    fwds = []
    view_mats = []
    for k in view_keys:
        uv_name = f"UV_Gefilde_{k}"
        project_uv_from_cam(me, mw, uv_name, cams[k])
        ed_path = os.path.join(DATA_DIR, f"gefilde_{k}_edited.png")
        m = make_projected_material(f"Mat_Gefilde_{k}", uv_name, ed_path, orig_img)
        me.materials.append(m)
        view_mats.append(m)
        fwds.append(Vector(cams[k]["cam_forward"]).normalized())

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    accum_rgb = np.zeros((4096, 4096, 3), dtype=np.float32)
    accum_w = np.zeros((4096, 4096, 1), dtype=np.float32)

    for vi, k in enumerate(view_keys):
        fwd = fwds[vi]
        v_count = 0
        for poly in me.polygons:
            p = mw @ poly.center
            in_bowl = (-0.98 <= p.x <= 0.94) and (-0.64 <= p.y <= 0.76) and (0.04 <= p.z <= 0.22)
            if not in_bowl:
                poly.material_index = 0
                continue
            fn = (normal_mat @ poly.normal).normalized()
            # Project across entire transition down into the apron (no hard p.z/fn.z cutoff!)
            # Keep view_1 (DRIFT) south of y=-0.22 and view_4 (CARVE+Wave) west of x=-0.36
            in_view_zone = (p.y < -0.22) if k == "view_1" else (p.x < -0.36)
            if in_view_zone and (-fn.dot(fwd) > 0.20):
                poly.material_index = vi + 1
                v_count += 1
            else:
                poly.material_index = 0
        print(f"View {k}: {v_count} faces")

        col_img = bpy.data.images.new(f"GefildeCol_{k}", width=4096, height=4096, alpha=False)
        col_img.colorspace_settings.name = "sRGB"
        for m in [mat_non, view_mats[vi]]:
            nt = m.node_tree
            node = nt.nodes.get("BakeTarget") or nt.nodes.new("ShaderNodeTexImage")
            node.name = "BakeTarget"
            node.image = col_img
            nt.nodes.active = node

        scene.render.bake.margin = 4
        bpy.ops.object.bake(type="EMIT")

        msk_img = bpy.data.images.new(f"GefildeMsk_{k}", width=4096, height=4096, alpha=False)
        msk_img.colorspace_settings.name = "Non-Color"

        nt_v = view_mats[vi].node_tree
        emit_v = [n for n in nt_v.nodes if n.type == "EMISSION"][0]
        mix_v = [n for n in nt_v.nodes if n.type == "MIX_RGB"][0]
        tex_proj_v = [
            n for n in nt_v.nodes
            if n.type == "TEX_IMAGE" and n.name != "BakeTarget" and n.image != orig_img
        ][0]
        for l in list(nt_v.links):
            if l.to_node == emit_v:
                nt_v.links.remove(l)
        nt_v.links.new(tex_proj_v.outputs["Alpha"], emit_v.inputs["Color"])

        for m in [mat_non, view_mats[vi]]:
            nt = m.node_tree
            node = nt.nodes["BakeTarget"]
            node.image = msk_img
            nt.nodes.active = node

        scene.render.bake.margin = 2
        bpy.ops.object.bake(type="EMIT")

        for l in list(nt_v.links):
            if l.to_node == emit_v:
                nt_v.links.remove(l)
        nt_v.links.new(mix_v.outputs["Color"], emit_v.inputs["Color"])

        c_px = np.array(col_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]
        w_px = np.clip(
            np.array(msk_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, 0:1],
            0.0,
            1.0,
        )
        accum_rgb += c_px * w_px
        accum_w += w_px

    has_w = accum_w > 1e-4
    blended_bowl = np.where(has_w, accum_rgb / np.maximum(accum_w, 1e-4), orig_px)
    final_alpha = np.clip(accum_w, 0.0, 1.0)
    wall_comp_px = np.clip(orig_px * (1.0 - final_alpha) + blended_bowl * final_alpha, 0.0, 1.0)

    wall_rgba = np.ones((4096, 4096, 4), dtype=np.float32)
    wall_rgba[:, :, :3] = wall_comp_px
    wall_img = bpy.data.images.new("WallComp4K", width=4096, height=4096, alpha=False)
    wall_img.colorspace_settings.name = "sRGB"
    wall_img.pixels.foreach_set(wall_rgba.ravel())

    # --- 2. World-space Top-Down Floor-Tag Cleanup (runs ON TOP OF wall_img!) ---
    td_center = (0.0, 0.0)
    td_scale = 2.10
    td_res = 1536
    td_cam, td_meta = make_ortho_camera(
        "FloorCleanTopCam",
        location=Vector((td_center[0], td_center[1], 5.0)),
        cam_right=Vector((1.0, 0.0, 0.0)),
        cam_up=Vector((0.0, 1.0, 0.0)),
        cam_forward=Vector((0.0, 0.0, -1.0)),
        ortho_scale=td_scale,
        res_x=td_res,
        res_y=td_res,
        clip_start=0.1,
        clip_end=20.0,
    )
    apply_unlit_material(obj, wall_img)
    tmp_dir = tempfile.mkdtemp(prefix="gefilde_bake_")
    tmp_td_orig = os.path.join(tmp_dir, "tmp_gefilde_td_orig.png")
    tmp_td_clean = os.path.join(tmp_dir, "tmp_gefilde_td_clean.png")
    tmp_td_mask = os.path.join(tmp_dir, "tmp_gefilde_td_mask.png")
    render_camera(td_cam, td_res, td_res, tmp_td_orig)

    td_boxes = [
        (-0.86, -0.70, 0.00, 0.09, "solid", 0.0),      # Left lip "2PAC" (safe from CARVE)
        (0.20, 0.76, -0.02, 0.30, "color", 11.0),      # Center-east "WE FIGHT BACK" + yellow 2
        (-0.05, 0.16, -0.10, 0.08, "dark", 12.0),      # Center floor "420"
        (-0.26, 0.06, 0.16, 0.48, "dark", 15.0),       # North lobe black arrow tag
        (0.16, 0.76, -0.52, 0.02, "dark", 15.0),       # SE hip & pocket marker tags
        (-0.85, -0.45, -0.05, 0.24, "dark", 15.0),     # West inner hip yellow spraycan
    ]
    td_inpaint_script = f"""
import cv2, numpy as np
img = cv2.imread({tmp_td_orig!r})
H, W = img.shape[:2]
def w2p(x, y):
    px = int(round(((x - {td_center[0]}) / {td_scale} + 0.5) * W))
    py = int(round((0.5 - (y - {td_center[1]}) / {td_scale}) * H))
    return max(0, min(W, px)), max(0, min(H, py))

inpaint_mask = np.zeros((H, W), dtype=np.uint8)
small_bgr = cv2.resize(img, (384, 384), interpolation=cv2.INTER_AREA)
local_bg_bgr = cv2.resize(cv2.medianBlur(small_bgr, 35), (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
local_gray = cv2.cvtColor(local_bg_bgr.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
diff_bgr = np.linalg.norm(img.astype(np.float32) - local_bg_bgr, axis=2)

for x0, x1, y0, y1, mode, thresh in {td_boxes!r}:
    px0, py1 = w2p(x0, y0)
    px1, py0 = w2p(x1, y1)
    roi = np.zeros((H, W), dtype=bool)
    roi[py0:py1, px0:px1] = True
    if mode == "solid":
        hits = roi
    elif mode == "color":
        hits = (diff_bgr > thresh) & roi
    else:
        hits = ((local_gray - gray) > thresh) & roi
    inpaint_mask[hits] = 255

inpaint_mask = cv2.dilate(inpaint_mask, np.ones((21, 21), np.uint8), iterations=1)
cleaned = cv2.inpaint(img, inpaint_mask, inpaintRadius=18, flags=cv2.INPAINT_TELEA)
alpha = cv2.GaussianBlur(inpaint_mask, (21, 21), 0)
cv2.imwrite({tmp_td_clean!r}, cleaned)
cv2.imwrite({tmp_td_mask!r}, alpha)
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", td_inpaint_script], check=True)

    # Direct projection (separate RGB + grayscale mask, zero premultiplication dark halos!)
    project_uv_from_cam(me, mw, "UV_FloorClean", td_meta)
    fc_ed_img = bpy.data.images.load(tmp_td_clean, check_existing=False)
    fc_ed_img.colorspace_settings.name = "sRGB"
    fc_mk_img = bpy.data.images.load(tmp_td_mask, check_existing=False)
    fc_mk_img.colorspace_settings.name = "Non-Color"

    mat_fclean = bpy.data.materials.new("Mat_FloorClean")
    mat_fclean.use_nodes = True
    nt_fc = mat_fclean.node_tree
    nt_fc.nodes.clear()
    out_fc = nt_fc.nodes.new("ShaderNodeOutputMaterial")
    emit_fc = nt_fc.nodes.new("ShaderNodeEmission")
    emit_fc.inputs["Strength"].default_value = 1.0
    uv_fc = nt_fc.nodes.new("ShaderNodeUVMap")
    uv_fc.uv_map = "UV_FloorClean"
    tex_fc = nt_fc.nodes.new("ShaderNodeTexImage")
    tex_fc.image = fc_ed_img
    tex_fc.extension = "CLIP"
    nt_fc.links.new(uv_fc.outputs["UV"], tex_fc.inputs["Vector"])
    nt_fc.links.new(tex_fc.outputs["Color"], emit_fc.inputs["Color"])
    nt_fc.links.new(emit_fc.outputs["Emission"], out_fc.inputs["Surface"])

    me.materials.clear()
    me.materials.append(mat_fclean)
    for poly in me.polygons:
        poly.material_index = 0

    fc_col_img = bpy.data.images.new("FloorCleanCol4K", width=4096, height=4096, alpha=False)
    fc_col_img.colorspace_settings.name = "sRGB"
    bt_node = nt_fc.nodes.new("ShaderNodeTexImage")
    bt_node.name = "BakeTarget"
    bt_node.image = fc_col_img
    nt_fc.nodes.active = bt_node
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="EMIT")

    fc_msk_img = bpy.data.images.new("FloorCleanMsk4K", width=4096, height=4096, alpha=False)
    fc_msk_img.colorspace_settings.name = "Non-Color"
    tex_fc.image = fc_mk_img
    bt_node.image = fc_msk_img
    nt_fc.nodes.active = bt_node
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="EMIT")

    fc_c = np.array(fc_col_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]
    fc_a = np.clip(
        np.array(fc_msk_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, 0:1],
        0.0,
        1.0,
    )
    comp_px = np.clip(wall_comp_px * (1.0 - fc_a) + fc_c * fc_a, 0.0, 1.0)
    diff_fc = np.abs(comp_px - wall_comp_px).mean(axis=2)
    print(f"FloorClean baked: fc_a_max={fc_a.max():.4f}, changed_pct={(diff_fc > 0.02).mean()*100:.2f}%")

    comp_rgba = np.ones((4096, 4096, 4), dtype=np.float32)
    comp_rgba[:, :, :3] = comp_px
    out_img = bpy.data.images.new("GefildeComp4K", width=4096, height=4096, alpha=False)
    out_img.colorspace_settings.name = "sRGB"
    out_img.pixels.foreach_set(comp_rgba.ravel())

    tmp_comp = os.path.join(tmp_dir, "tmp_gefilde_comp_4k.png")
    out_img.filepath_raw = tmp_comp
    out_img.file_format = "PNG"
    out_img.save()

    os.makedirs(os.path.dirname(OUTPUT_TEX), exist_ok=True)
    save_script = f"""
import cv2
img = cv2.imread({tmp_comp!r})
cv2.imwrite({OUTPUT_TEX!r}, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", save_script], check=True)
    shutil.rmtree(tmp_dir, ignore_errors=True)

    # --- 3. Dedicated Oblique Hump Camera on clean scene ---
    run_hump_clean()


def run_hump_clean():
    """Dedicated oblique camera pass on OUTPUT_TEX to cleanly remove FUCK COPS / Fuck + Crown."""
    obj, base_img = load_scene_and_mesh(tex_path=OUTPUT_TEX)
    me = obj.data
    mw = obj.matrix_world
    base_px = np.array(base_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]

    me.uv_layers["UVMap"].active = True
    me.uv_layers["UVMap"].active_render = True

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.cycles.bake_type = "EMIT"
    scene.render.bake.use_clear = True

    h_loc = Vector((0.22, 0.25, 0.35))
    h_tgt = Vector((-0.18, -0.07, 0.07))
    h_r, h_u, h_fwd = _cam_basis_from_look(h_loc, h_tgt)
    h_res = 1024
    h_cam, h_meta = make_ortho_camera(
        "HumpCleanCam",
        location=h_loc,
        cam_right=h_r,
        cam_up=h_u,
        cam_forward=h_fwd,
        ortho_scale=0.55,
        res_x=h_res,
        res_y=h_res,
        clip_start=0.05,
        clip_end=10.0,
    )
    apply_unlit_material(obj, base_img)
    tmp_dir = tempfile.mkdtemp(prefix="gefilde_hump_")
    tmp_h_orig = os.path.join(tmp_dir, "tmp_hump_orig.png")
    tmp_h_clean = os.path.join(tmp_dir, "tmp_hump_clean.png")
    tmp_h_mask = os.path.join(tmp_dir, "tmp_hump_mask.png")
    render_camera(h_cam, h_res, h_res, tmp_h_orig)

    h_inpaint_script = f"""
import cv2, numpy as np
img = cv2.imread({tmp_h_orig!r})
H, W = img.shape[:2]
small = cv2.resize(img, (256, 256), interpolation=cv2.INTER_AREA)
local_bg = cv2.resize(cv2.medianBlur(small, 21), (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32)
diff_bgr = np.linalg.norm(img.astype(np.float32) - local_bg, axis=2)

roi = np.zeros((H, W), dtype=bool)
roi[395:675, 515:770] = True
hits = (diff_bgr > 10.0) & roi
mask = cv2.dilate(hits.astype(np.uint8) * 255, np.ones((15, 15), np.uint8), iterations=1)
cleaned = cv2.inpaint(img, mask, inpaintRadius=12, flags=cv2.INPAINT_TELEA)

rng = np.random.default_rng(42)
grain = rng.normal(0.0, 2.2, (H, W, 1)).astype(np.float32)
cleaned_f = np.clip(cleaned.astype(np.float32) + grain * (mask[:, :, None] > 0), 0, 255).astype(np.uint8)

alpha = cv2.GaussianBlur(mask, (15, 15), 0)
cv2.imwrite({tmp_h_clean!r}, cleaned_f)
cv2.imwrite({tmp_h_mask!r}, alpha)
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", h_inpaint_script], check=True)

    project_uv_from_cam(me, mw, "UV_HumpClean", h_meta)

    # Remove non-hump faces before baking because skatepark_multi.glb has overlapping UVMap islands
    # (e.g. distant trees/background share UVMap coords with the hump and would overwrite it with 0).
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    to_del = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if abs(c.x + 0.18) > 0.45 or abs(c.y + 0.07) > 0.45 or c.z > 0.22:
            to_del.append(f)
    bmesh.ops.delete(bm, geom=to_del, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(f"HumpClean bake mesh faces kept: {len(me.polygons)}")
    h_ed_img = bpy.data.images.load(tmp_h_clean, check_existing=False)
    h_ed_img.colorspace_settings.name = "sRGB"
    h_mk_img = bpy.data.images.load(tmp_h_mask, check_existing=False)
    h_mk_img.colorspace_settings.name = "Non-Color"

    mat_hclean = bpy.data.materials.new("Mat_HumpClean")
    mat_hclean.use_nodes = True
    nt_h = mat_hclean.node_tree
    nt_h.nodes.clear()
    out_h = nt_h.nodes.new("ShaderNodeOutputMaterial")
    emit_h = nt_h.nodes.new("ShaderNodeEmission")
    emit_h.inputs["Strength"].default_value = 1.0
    uv_h = nt_h.nodes.new("ShaderNodeUVMap")
    uv_h.uv_map = "UV_HumpClean"
    tex_h = nt_h.nodes.new("ShaderNodeTexImage")
    tex_h.image = h_ed_img
    tex_h.extension = "CLIP"
    nt_h.links.new(uv_h.outputs["UV"], tex_h.inputs["Vector"])
    nt_h.links.new(tex_h.outputs["Color"], emit_h.inputs["Color"])
    nt_h.links.new(emit_h.outputs["Emission"], out_h.inputs["Surface"])

    me.materials.clear()
    me.materials.append(mat_hclean)
    for poly in me.polygons:
        poly.material_index = 0

    hc_col_img = bpy.data.images.new("HumpCleanCol4K", width=4096, height=4096, alpha=False)
    hc_col_img.colorspace_settings.name = "sRGB"
    bt_h = nt_h.nodes.new("ShaderNodeTexImage")
    bt_h.name = "BakeTarget"
    bt_h.image = hc_col_img
    nt_h.nodes.active = bt_h
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="EMIT")

    mat_h_msk = bpy.data.materials.new("Mat_HumpCleanMsk")
    mat_h_msk.use_nodes = True
    nt_hm = mat_h_msk.node_tree
    nt_hm.nodes.clear()
    out_hm = nt_hm.nodes.new("ShaderNodeOutputMaterial")
    emit_hm = nt_hm.nodes.new("ShaderNodeEmission")
    emit_hm.inputs["Strength"].default_value = 1.0
    uv_hm = nt_hm.nodes.new("ShaderNodeUVMap")
    uv_hm.uv_map = "UV_HumpClean"
    tex_hm = nt_hm.nodes.new("ShaderNodeTexImage")
    tex_hm.image = h_mk_img
    tex_hm.extension = "CLIP"
    nt_hm.links.new(uv_hm.outputs["UV"], tex_hm.inputs["Vector"])
    nt_hm.links.new(tex_hm.outputs["Color"], emit_hm.inputs["Color"])
    nt_hm.links.new(emit_hm.outputs["Emission"], out_hm.inputs["Surface"])

    hc_msk_img = bpy.data.images.new("HumpCleanMsk4K", width=4096, height=4096, alpha=False)
    hc_msk_img.colorspace_settings.name = "Non-Color"
    bt_hm = nt_hm.nodes.new("ShaderNodeTexImage")
    bt_hm.name = "BakeTarget"
    bt_hm.image = hc_msk_img
    nt_hm.nodes.active = bt_hm
    me.materials.clear()
    me.materials.append(mat_h_msk)
    for poly in me.polygons:
        poly.material_index = 0
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="EMIT")

    hc_c = np.array(hc_col_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]
    hc_a = np.clip(
        np.array(hc_msk_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, 0:1],
        0.0,
        1.0,
    )
    comp_px = np.clip(base_px * (1.0 - hc_a) + hc_c * hc_a, 0.0, 1.0)
    print(f"HumpClean baked: hc_a_max={hc_a.max():.4f}, changed_pct={(np.abs(comp_px - base_px).mean(axis=2) > 0.02).mean()*100:.2f}%")

    comp_rgba = np.ones((4096, 4096, 4), dtype=np.float32)
    comp_rgba[:, :, :3] = comp_px
    out_img = bpy.data.images.new("GefildeFinal4K", width=4096, height=4096, alpha=False)
    out_img.colorspace_settings.name = "sRGB"
    out_img.pixels.foreach_set(comp_rgba.ravel())

    tmp_comp = os.path.join(tmp_dir, "tmp_gefilde_final_4k.png")
    out_img.filepath_raw = tmp_comp
    out_img.file_format = "PNG"
    out_img.save()

    save_script = f"""
import cv2
img = cv2.imread({tmp_comp!r})
cv2.imwrite({OUTPUT_TEX!r}, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", save_script], check=True)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"Saved 4K rebaked & cleaned Gefilde texture to {OUTPUT_TEX}")


def main():
    args = parse_args()
    if args.mode == "extract":
        run_extract()
    elif args.mode == "bake":
        run_bake()


if __name__ == "__main__":
    main()
