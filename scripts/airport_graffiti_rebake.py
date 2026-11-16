#!/usr/bin/env python3
"""
scripts/airport_graffiti_rebake.py

High-resolution, zero-distortion Blender orthographic projection + 4K re-bake
workflow to replace graffiti on the 21m graffiti/bouldering wall (and neutralize
small floor/bowl tags) in `public/models/airport_skatepark_game.glb`.

Subcommands:
  --mode extract
      Loads `public/models/airport_skatepark_game.glb` with its 4K texture
      `public/textures/airport_skatepark_tex0.jpg` in an Unlit/Emission shader,
      locates the 21m graffiti/bouldering wall, renders straight-on orthographic
      views of the front (`data/wall_front_orig.png`) and back
      (`data/wall_back_orig.png`) plus a top-down overview
      (`data/airport_topdown_orig.png`), and saves exact camera parameters to
      `data/wall_ortho_cams.json`.

  --mode bake
      Projects `data/wall_front_edited.png` and `data/wall_back_edited.png`
      back onto ONLY the wall faces facing each saved ortho camera
      (`dot(face_normal, cam_forward) < -0.5` within the wall bounding box),
      bakes into 4096x4096 on the original `UVMap`, composites over the original
      4K texture so 100% of concrete/grass/mulch/paving outside the wall is
      untouched, neutralizes/patches small floor/bowl tags if configured, and
      writes `public/textures/airport_skatepark_tex0_aigraffiti_test.jpg` (q=90).
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INPUT_GLB = os.path.join(ROOT_DIR, "public", "models", "airport_skatepark_game.glb")
ORIG_TEX = os.path.join(ROOT_DIR, "public", "textures", "airport_skatepark_tex0.jpg")
DATA_DIR = os.path.join(ROOT_DIR, "data")

WALL_FRONT_ORIG = os.path.join(DATA_DIR, "wall_front_orig.png")
WALL_BACK_ORIG = os.path.join(DATA_DIR, "wall_back_orig.png")
TOPDOWN_ORIG = os.path.join(DATA_DIR, "airport_topdown_orig.png")
CAMS_JSON = os.path.join(DATA_DIR, "wall_ortho_cams.json")
BOWL_CAMS_JSON = os.path.join(DATA_DIR, "bowl_ortho_cams.json")
BOWL_OVERVIEW = os.path.join(DATA_DIR, "bowl_overview.png")

WALL_FRONT_EDITED = os.path.join(DATA_DIR, "wall_front_edited.png")
WALL_BACK_EDITED = os.path.join(DATA_DIR, "wall_back_edited.png")
OUTPUT_TEX = os.path.join(
    ROOT_DIR, "public", "textures", "airport_skatepark_tex0_aigraffiti_test.jpg"
)


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Airport skatepark graffiti rebake")
    parser.add_argument(
        "--mode",
        choices=["extract", "bake", "extract-bowl", "bake-bowl"],
        required=True,
        help="Workflow step: extract/bake wall or extract-bowl/bake-bowl",
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

    # Configure Standard color management for 1:1 albedo fidelity
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


def locate_graffiti_wall(obj):
    """Locate the 21m graffiti/bouldering wall and compute its oriented bounding frame."""
    mw = obj.matrix_world
    coords = np.array([list(mw @ v.co) for v in obj.data.vertices], dtype=np.float64)

    # Filter to the wall strip (Y in [19.8, 21.8] excludes tree canopy behind at Y>22)
    mask = (
        (coords[:, 1] > 19.8)
        & (coords[:, 1] < 21.8)
        & (coords[:, 2] > 1.2)
        & (coords[:, 0] > -10.0)
        & (coords[:, 0] < 16.0)
    )
    wall_pts = coords[mask]
    if len(wall_pts) < 100:
        raise RuntimeError(f"Too few wall vertices found: {len(wall_pts)}")

    mean_xy = wall_pts[:, :2].mean(axis=0)
    cov = np.cov((wall_pts[:, :2] - mean_xy).T)
    _, eigvecs = np.linalg.eigh(cov)
    major = eigvecs[:, 1]
    normal = eigvecs[:, 0]
    if major[0] < 0:
        major = -major
    if normal[1] < 0:
        normal = -normal

    proj_len = (wall_pts[:, :2] - mean_xy) @ major
    proj_thick = (wall_pts[:, :2] - mean_xy) @ normal

    along_min = float(proj_len.min())
    along_max = float(proj_len.max())
    along_mid = 0.5 * (along_min + along_max)
    center_xy = mean_xy + major * along_mid

    # Ground Z right in front of wall
    gnd_mask = (
        (coords[:, 1] > 18.5)
        & (coords[:, 1] < 20.0)
        & (coords[:, 0] > -8.0)
        & (coords[:, 0] < 14.0)
    )
    z_ground = float(np.median(coords[gnd_mask, 2])) if np.any(gnd_mask) else 0.13
    z_max = float(wall_pts[:, 2].max())

    return {
        "center_xy": [float(center_xy[0]), float(center_xy[1])],
        "major_dir": [float(major[0]), float(major[1])],
        "normal_dir": [float(normal[0]), float(normal[1])],
        "along_min": float(along_min - along_mid),
        "along_max": float(along_max - along_mid),
        "thick_min": float(proj_thick.min()),
        "thick_max": float(proj_thick.max()),
        "z_ground": z_ground,
        "z_max": z_max,
    }


def make_ortho_camera(
    name: str,
    location: Vector,
    cam_right: Vector,
    cam_up: Vector,
    cam_forward: Vector,
    ortho_scale: float,
    res_x: int,
    res_y: int,
    clip_start: float = 0.1,
    clip_end: float = 100.0,
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
    scene.cycles.samples = 1  # Unlit emission needs only 1 sample
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

    wall_info = locate_graffiti_wall(obj)
    print("Located wall:", json.dumps(wall_info, indent=2))

    center_xy = Vector((wall_info["center_xy"][0], wall_info["center_xy"][1], 0.0))
    major = Vector((wall_info["major_dir"][0], wall_info["major_dir"][1], 0.0)).normalized()
    normal = Vector((wall_info["normal_dir"][0], wall_info["normal_dir"][1], 0.0)).normalized()
    up = Vector((0.0, 0.0, 1.0))

    wall_len = wall_info["along_max"] - wall_info["along_min"]
    ortho_scale = round(wall_len + 1.2, 2)  # ~24.6m tight framing with small margin
    z_mid = 0.5 * (wall_info["z_ground"] + wall_info["z_max"])
    res_x, res_y = 2048, 512

    # Front camera: in front of wall (-normal), looking +normal
    front_loc = Vector((center_xy.x, center_xy.y, z_mid)) - normal * 8.0
    front_cam, front_meta = make_ortho_camera(
        "WallFrontCam",
        location=front_loc,
        cam_right=major,
        cam_up=up,
        cam_forward=normal,
        ortho_scale=ortho_scale,
        res_x=res_x,
        res_y=res_y,
        clip_start=0.1,
        clip_end=30.0,
    )
    render_camera(front_cam, res_x, res_y, WALL_FRONT_ORIG)
    print(f"Rendered {WALL_FRONT_ORIG} ({res_x}x{res_y})")

    # Back camera: behind wall (+normal), looking -normal.
    # Place close (1.1m behind wall center) so tree canopy at Y>22 doesn't occlude it.
    back_loc = Vector((center_xy.x, center_xy.y, z_mid)) + normal * 1.1
    back_cam, back_meta = make_ortho_camera(
        "WallBackCam",
        location=back_loc,
        cam_right=-major,
        cam_up=up,
        cam_forward=-normal,
        ortho_scale=ortho_scale,
        res_x=res_x,
        res_y=res_y,
        clip_start=0.05,
        clip_end=15.0,
    )
    render_camera(back_cam, res_x, res_y, WALL_BACK_ORIG)
    print(f"Rendered {WALL_BACK_ORIG} ({res_x}x{res_y})")

    # Top-down camera for inspecting floor tags ("KOMM SPORT", bowl throw-ups)
    top_loc = Vector((0.0, 0.0, 20.0))
    top_cam, top_meta = make_ortho_camera(
        "TopDownCam",
        location=top_loc,
        cam_right=Vector((1.0, 0.0, 0.0)),
        cam_up=Vector((0.0, 1.0, 0.0)),
        cam_forward=Vector((0.0, 0.0, -1.0)),
        ortho_scale=62.0,
        res_x=2048,
        res_y=2048,
        clip_start=0.1,
        clip_end=40.0,
    )
    render_camera(top_cam, 2048, 2048, TOPDOWN_ORIG)
    print(f"Rendered {TOPDOWN_ORIG} (2048x2048)")

    cams_data = {
        "wall_info": wall_info,
        "front": front_meta,
        "back": back_meta,
        "topdown": top_meta,
    }
    with open(CAMS_JSON, "w") as f:
        json.dump(cams_data, f, indent=2)
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
        raise FileNotFoundError(f"Edited wall image not found: {img_path}")
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

    wall_info = cams["wall_info"]
    c_xy = Vector((wall_info["center_xy"][0], wall_info["center_xy"][1], 0.0))
    major = Vector((wall_info["major_dir"][0], wall_info["major_dir"][1], 0.0)).normalized()
    w_norm = Vector((wall_info["normal_dir"][0], wall_info["normal_dir"][1], 0.0)).normalized()

    along_min = wall_info["along_min"] - 0.5
    along_max = wall_info["along_max"] + 0.5
    thick_min = wall_info["thick_min"] - 0.5
    thick_max = wall_info["thick_max"] + 0.5
    z_min = wall_info["z_ground"] - 0.05
    z_max = wall_info["z_max"] + 0.25

    front_fwd = Vector(cams["front"]["cam_forward"]).normalized()
    back_fwd = Vector(cams["back"]["cam_forward"]).normalized()

    # Create projection UV layers
    project_uv_from_cam(me, mw, "UV_Front", cams["front"])
    project_uv_from_cam(me, mw, "UV_Back", cams["back"])

    # Materials: 0 = UnlitOriginal (black mask for non-wall), 1 = Front, 2 = Back
    mat_orig = bpy.data.materials.new("Mat_NonWall")
    mat_orig.use_nodes = True
    nt0 = mat_orig.node_tree
    nt0.nodes.clear()
    out0 = nt0.nodes.new("ShaderNodeOutputMaterial")
    emit0 = nt0.nodes.new("ShaderNodeEmission")
    emit0.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    emit0.inputs["Strength"].default_value = 1.0
    nt0.links.new(emit0.outputs["Emission"], out0.inputs["Surface"])

    mat_front = make_projected_material("Mat_WallFront", "UV_Front", WALL_FRONT_EDITED, orig_img)
    mat_back = make_projected_material("Mat_WallBack", "UV_Back", WALL_BACK_EDITED, orig_img)

    me.materials.clear()
    me.materials.append(mat_orig)
    me.materials.append(mat_front)
    me.materials.append(mat_back)

    front_count = 0
    back_count = 0
    for poly in me.polygons:
        p = mw @ poly.center
        d_xy = Vector((p.x - c_xy.x, p.y - c_xy.y, 0.0))
        along = d_xy.dot(major)
        thick = d_xy.dot(w_norm)
        in_wall_bbox = (
            (along_min <= along <= along_max)
            and (thick_min <= thick <= thick_max)
            and (z_min <= p.z <= z_max)
        )
        if not in_wall_bbox:
            poly.material_index = 0
            continue

        fn = (normal_mat @ poly.normal).normalized()
        if fn.dot(front_fwd) < -0.5:
            poly.material_index = 1
            front_count += 1
        elif fn.dot(back_fwd) < -0.5:
            poly.material_index = 2
            back_count += 1
        else:
            poly.material_index = 0

    print(f"Assigned wall faces: front={front_count}, back={back_count}")

    # Bake 4096x4096 wall projection + mask onto original UVMap
    me.uv_layers["UVMap"].active = True
    me.uv_layers["UVMap"].active_render = True

    bake_img = bpy.data.images.new("WallBake4K", width=4096, height=4096, alpha=False)
    bake_img.colorspace_settings.name = "sRGB"

    # Add bake target image node to all 3 materials and select it
    for m in [mat_orig, mat_front, mat_back]:
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bake_img
        nt.nodes.active = node

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.cycles.bake_type = "EMIT"
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True

    bpy.ops.object.bake(type="EMIT")

    # Also bake a binary mask (white on wall mats, black on non-wall) so non-wall pixels are 100% preserved
    mask_img = bpy.data.images.new("WallMask4K", width=4096, height=4096, alpha=False)
    mask_img.colorspace_settings.name = "Non-Color"
    for idx, m in enumerate([mat_orig, mat_front, mat_back]):
        nt = m.node_tree
        emit = [n for n in nt.nodes if n.type == "EMISSION"][0]
        for l in list(nt.links):
            if l.to_node == emit:
                nt.links.remove(l)
        emit.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0) if idx > 0 else (0.0, 0.0, 0.0, 1.0)
        for n in nt.nodes:
            if n.type == "TEX_IMAGE" and n.image == bake_img:
                n.image = mask_img
                nt.nodes.active = n

    scene.render.bake.margin = 2
    bpy.ops.object.bake(type="EMIT")

    # Bake a floor-tag region mask (FICK DIE AFD, WEED, KOMM SPORT) in UV space
    tag_boxes = [
        (-2.2, 2.8, 2.8, 8.2),     # FICK DIE AFD
        (-5.8, -1.8, -0.8, 3.2),   # WEED
        (0.6, 3.2, -14.0, -10.8),  # KOMM SPORT
    ]
    mat_tag = bpy.data.materials.new("Mat_FloorTag")
    mat_tag.use_nodes = True
    nt_t = mat_tag.node_tree
    nt_t.nodes.clear()
    out_t = nt_t.nodes.new("ShaderNodeOutputMaterial")
    emit_t = nt_t.nodes.new("ShaderNodeEmission")
    emit_t.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emit_t.inputs["Strength"].default_value = 1.0
    nt_t.links.new(emit_t.outputs["Emission"], out_t.inputs["Surface"])

    floor_mask_img = bpy.data.images.new("FloorTagMask4K", width=4096, height=4096, alpha=False)
    floor_mask_img.colorspace_settings.name = "Non-Color"
    node_t = nt_t.nodes.new("ShaderNodeTexImage")
    node_t.image = floor_mask_img
    nt_t.nodes.active = node_t

    me.materials.append(mat_tag)
    tag_mat_idx = len(me.materials) - 1

    # Reset non-wall faces to black, assign tag_mat_idx to floor tag boxes
    for poly in me.polygons:
        if poly.material_index == 0:
            p = mw @ poly.center
            if p.z < 0.8:
                for x0, x1, y0, y1 in tag_boxes:
                    if x0 <= p.x <= x1 and y0 <= p.y <= y1:
                        poly.material_index = tag_mat_idx
                        break

    for m in [mat_orig, mat_front, mat_back]:
        nt = m.node_tree
        emit = [n for n in nt.nodes if n.type == "EMISSION"][0]
        emit.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        for n in nt.nodes:
            if n.type == "TEX_IMAGE" and n.image == mask_img:
                n.image = floor_mask_img
                nt.nodes.active = n

    scene.render.bake.margin = 0
    bpy.ops.object.bake(type="EMIT")

    # Composite in numpy using Blender's loaded orig_img (zero PIL dependency inside Blender)
    orig_px = np.array(orig_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]
    bake_px = np.array(bake_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]
    mask_px = np.clip(
        np.array(mask_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, 0:1],
        0.0,
        1.0,
    )
    comp_px = np.clip(orig_px * (1.0 - mask_px) + bake_px * mask_px, 0.0, 1.0)

    comp_rgba = np.ones((4096, 4096, 4), dtype=np.float32)
    comp_rgba[:, :, :3] = comp_px
    out_img = bpy.data.images.new("Comp4K", width=4096, height=4096, alpha=False)
    out_img.colorspace_settings.name = "sRGB"
    out_img.pixels.foreach_set(comp_rgba.ravel())

    tmp_comp = os.path.join(DATA_DIR, "tmp_comp_4k.png")
    tmp_fmask = os.path.join(DATA_DIR, "tmp_floormask_4k.png")
    out_img.filepath_raw = tmp_comp
    out_img.file_format = "PNG"
    out_img.save()

    floor_mask_img.filepath_raw = tmp_fmask
    floor_mask_img.file_format = "PNG"
    floor_mask_img.save()

    # Inpaint dark marker tags inside floor_mask_img using system python3 + cv2, write JPEG q=90
    os.makedirs(os.path.dirname(OUTPUT_TEX), exist_ok=True)
    inpaint_script = f"""
import cv2, numpy as np
img = cv2.imread({tmp_comp!r})
fmask = cv2.imread({tmp_fmask!r}, cv2.IMREAD_GRAYSCALE)
region = fmask > 128
if np.any(region):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    local_bg = cv2.medianBlur(gray.astype(np.uint8), 31).astype(np.float32)
    # Detect dark marker strokes relative to surrounding concrete
    strokes = ((local_bg - gray) > 14.0) & region
    strokes_u8 = (strokes.astype(np.uint8) * 255)
    strokes_u8 = cv2.dilate(strokes_u8, np.ones((5, 5), np.uint8), iterations=1)
    img = cv2.inpaint(img, strokes_u8, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
cv2.imwrite({OUTPUT_TEX!r}, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", inpaint_script], check=True)
    for p in (tmp_comp, tmp_fmask):
        if os.path.exists(p):
            os.remove(p)
    print(f"Saved 4K rebaked & cleaned texture to {OUTPUT_TEX}")


def _cam_basis_from_look(loc: Vector, target: Vector):
    fwd = (target - loc).normalized()
    world_up = Vector((0.0, 0.0, 1.0))
    right = fwd.cross(world_up).normalized()
    up = right.cross(fwd).normalized()
    return right, up, fwd


def run_extract_bowl():
    os.makedirs(DATA_DIR, exist_ok=True)
    base_tex = OUTPUT_TEX if os.path.exists(OUTPUT_TEX) else ORIG_TEX
    obj, tex_img = load_scene_and_mesh(tex_path=base_tex)
    apply_unlit_material(obj, tex_img)

    bowl_views = [
        {
            "key": "view_1",
            "label": "V1: North Apex (SPOR / Maxi)",
            "loc": (1.8, 4.5, 3.0),
            "target": (1.8, 14.8, -0.45),
            "ortho_scale": 11.5,
            "res_x": 1536,
            "res_y": 512,
            "out": os.path.join(DATA_DIR, "bowl_view_1_orig.png"),
            "color": (0, 220, 255),
        },
        {
            "key": "view_2",
            "label": "V2: NE/East Curve (Mushrooms / Green)",
            "loc": (1.5, 4.5, 3.0),
            "target": (9.5, 11.0, -0.45),
            "ortho_scale": 12.5,
            "res_x": 1536,
            "res_y": 512,
            "out": os.path.join(DATA_DIR, "bowl_view_2_orig.png"),
            "color": (80, 255, 80),
        },
        {
            "key": "view_3",
            "label": "V3: West/NW Wall (BVB 09 / 67)",
            "loc": (3.5, 3.0, 3.2),
            "target": (-4.8, 9.2, -0.45),
            "ortho_scale": 15.0,
            "res_x": 1536,
            "res_y": 512,
            "out": os.path.join(DATA_DIR, "bowl_view_3_orig.png"),
            "color": (255, 180, 60),
        },
    ]

    cams_out = {}
    for v in bowl_views:
        loc = Vector(v["loc"])
        target = Vector(v["target"])
        right, up, fwd = _cam_basis_from_look(loc, target)
        cam_obj, meta = make_ortho_camera(
            f"Bowl_{v['key']}",
            location=loc,
            cam_right=right,
            cam_up=up,
            cam_forward=fwd,
            ortho_scale=v["ortho_scale"],
            res_x=v["res_x"],
            res_y=v["res_y"],
            clip_start=0.2,
            clip_end=40.0,
        )
        render_camera(cam_obj, v["res_x"], v["res_y"], v["out"])
        meta["label"] = v["label"]
        meta["target"] = list(v["target"])
        cams_out[v["key"]] = meta
        print(f"Rendered {v['out']} ({v['res_x']}x{v['res_y']})")

    # Render top-down bowl overview (1024x1024, centered at (1.5, 9.5), ortho_scale=26.0)
    ov_center = (1.5, 9.5)
    ov_scale = 26.0
    ov_res = 1024
    ov_cam, ov_meta = make_ortho_camera(
        "BowlOverviewCam",
        location=Vector((ov_center[0], ov_center[1], 20.0)),
        cam_right=Vector((1.0, 0.0, 0.0)),
        cam_up=Vector((0.0, 1.0, 0.0)),
        cam_forward=Vector((0.0, 0.0, -1.0)),
        ortho_scale=ov_scale,
        res_x=ov_res,
        res_y=ov_res,
        clip_start=0.1,
        clip_end=40.0,
    )
    render_camera(ov_cam, ov_res, ov_res, BOWL_OVERVIEW)

    # Annotate camera positions & look arrows on bowl_overview.png via cv2
    ann_script = f"""
import cv2
img = cv2.imread({BOWL_OVERVIEW!r})
def w2p(x, y):
    px = int(((x - {ov_center[0]}) / {ov_scale} + 0.5) * {ov_res})
    py = int((0.5 - (y - {ov_center[1]}) / {ov_scale}) * {ov_res})
    return (px, py)
views = {[(v['key'], v['loc'][:2], v['target'][:2], v['color'], v['label']) for v in bowl_views]!r}
for key, loc_xy, tgt_xy, col, label in views:
    p0 = w2p(loc_xy[0], loc_xy[1])
    p1 = w2p(tgt_xy[0], tgt_xy[1])
    cv2.arrowedLine(img, p0, p1, col, 3, tipLength=0.12)
    cv2.circle(img, p0, 8, col, -1)
    cv2.putText(img, key, (p0[0] + 10, p0[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.65, col, 2)
cv2.imwrite({BOWL_OVERVIEW!r}, img)
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", ann_script], check=True)
    print(f"Rendered annotated {BOWL_OVERVIEW} ({ov_res}x{ov_res})")

    cams_out["overview"] = ov_meta
    with open(BOWL_CAMS_JSON, "w") as f:
        json.dump(cams_out, f, indent=2)
    print(f"Saved bowl camera parameters to {BOWL_CAMS_JSON}")


def run_bake_bowl():
    if not os.path.exists(BOWL_CAMS_JSON):
        raise FileNotFoundError(f"Run --mode extract-bowl first; missing {BOWL_CAMS_JSON}")
    with open(BOWL_CAMS_JSON, "r") as f:
        cams = json.load(f)

    base_tex = OUTPUT_TEX if os.path.exists(OUTPUT_TEX) else ORIG_TEX
    obj, base_img = load_scene_and_mesh(tex_path=base_tex)
    me = obj.data
    mw = obj.matrix_world
    normal_mat = mw.to_3x3().inverted().transposed()

    view_keys = ["view_1", "view_2", "view_3"]
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
        uv_name = f"UV_Bowl_{k}"
        project_uv_from_cam(me, mw, uv_name, cams[k])
        ed_path = os.path.join(DATA_DIR, f"bowl_{k}_edited.png")
        m = make_projected_material(f"Mat_Bowl_{k}", uv_name, ed_path, base_img)
        me.materials.append(m)
        view_mats.append(m)
        fwds.append(Vector(cams[k]["cam_forward"]).normalized())

    me.uv_layers["UVMap"].active = True
    me.uv_layers["UVMap"].active_render = True

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.cycles.bake_type = "EMIT"
    scene.render.bake.use_clear = True

    # Bake each view separately with smooth angular weights, then blend seamlessly in numpy
    orig_px = np.array(base_img.pixels[:], dtype=np.float32).reshape((4096, 4096, 4))[:, :, :3]
    accum_rgb = np.zeros((4096, 4096, 3), dtype=np.float32)
    accum_w = np.zeros((4096, 4096, 1), dtype=np.float32)

    for vi, k in enumerate(view_keys):
        fwd = fwds[vi]
        # Assign faces facing this view (dot > 0.30) to view_mats[vi], others to mat_non
        v_count = 0
        for poly in me.polygons:
            p = mw @ poly.center
            in_bowl = (-11.5 <= p.x <= 13.0) and (1.0 <= p.y <= 17.0) and (-1.25 <= p.z <= 0.22)
            if not in_bowl:
                poly.material_index = 0
                continue
            fn = (normal_mat @ poly.normal).normalized()
            if -fn.dot(fwd) > 0.30:
                poly.material_index = vi + 1
                v_count += 1
            else:
                poly.material_index = 0
        print(f"View {k}: {v_count} faces")

        # Bake color
        col_img = bpy.data.images.new(f"BowlCol_{k}", width=4096, height=4096, alpha=False)
        col_img.colorspace_settings.name = "sRGB"
        for m in [mat_non, view_mats[vi]]:
            nt = m.node_tree
            node = nt.nodes.get("BakeTarget") or nt.nodes.new("ShaderNodeTexImage")
            node.name = "BakeTarget"
            node.image = col_img
            nt.nodes.active = node

        scene.render.bake.margin = 4
        bpy.ops.object.bake(type="EMIT")

        # Bake mask (using view image's alpha so grass/coping stays 0)
        msk_img = bpy.data.images.new(f"BowlMsk_{k}", width=4096, height=4096, alpha=False)
        msk_img.colorspace_settings.name = "Non-Color"

        # Temporarily swap view_mats[vi] emission to output TexProj Alpha
        nt_v = view_mats[vi].node_tree
        emit_v = [n for n in nt_v.nodes if n.type == "EMISSION"][0]
        mix_v = [n for n in nt_v.nodes if n.type == "MIX_RGB"][0]
        tex_proj_v = [n for n in nt_v.nodes if n.type == "TEX_IMAGE" and n.name != "BakeTarget" and n.image != base_img][0]
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

        # Restore color link
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
        # Smoothly feather mask edges to eliminate any seam between adjacent views
        accum_rgb += c_px * w_px
        accum_w += w_px

    has_w = accum_w > 1e-4
    blended_bowl = np.where(has_w, accum_rgb / np.maximum(accum_w, 1e-4), orig_px)
    final_alpha = np.clip(accum_w, 0.0, 1.0)
    comp_px = np.clip(orig_px * (1.0 - final_alpha) + blended_bowl * final_alpha, 0.0, 1.0)

    comp_rgba = np.ones((4096, 4096, 4), dtype=np.float32)
    comp_rgba[:, :, :3] = comp_px
    out_img = bpy.data.images.new("BowlComp4K", width=4096, height=4096, alpha=False)
    out_img.colorspace_settings.name = "sRGB"
    out_img.pixels.foreach_set(comp_rgba.ravel())

    tmp_comp = os.path.join(DATA_DIR, "tmp_bowl_comp_4k.png")
    out_img.filepath_raw = tmp_comp
    out_img.file_format = "PNG"
    out_img.save()

    # Also bake UV mask for remaining small tags (SE bowl floor + left entrance blue throw-up)
    extra_tag_boxes = [
        # (x0, x1, y0, y1, z_max)
        (3.5, 9.2, 2.5, 11.2, -0.55),     # SE bowl floor ("Baleon" & sketches)
        (6.0, 12.2, 0.5, 5.5, -0.55),     # SE bowl pocket floor sketches
        (-12.5, -6.5, -0.8, 3.2, 0.15),   # Left bowl entrance blue throw-up
    ]
    mat_etag = bpy.data.materials.new("Mat_ExtraBowlTag")
    mat_etag.use_nodes = True
    nt_et = mat_etag.node_tree
    nt_et.nodes.clear()
    out_et = nt_et.nodes.new("ShaderNodeOutputMaterial")
    emit_et = nt_et.nodes.new("ShaderNodeEmission")
    emit_et.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emit_et.inputs["Strength"].default_value = 1.0
    nt_et.links.new(emit_et.outputs["Emission"], out_et.inputs["Surface"])

    me.materials.append(mat_etag)
    etag_idx = len(me.materials) - 1
    for poly in me.polygons:
        p = mw @ poly.center
        hit = False
        for x0, x1, y0, y1, zmax in extra_tag_boxes:
            if x0 <= p.x <= x1 and y0 <= p.y <= y1 and p.z <= zmax:
                hit = True
                break
        poly.material_index = etag_idx if hit else 0

    # Set mat_non emission back to black
    nt0 = mat_non.node_tree
    emit0 = [n for n in nt0.nodes if n.type == "EMISSION"][0]
    emit0.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)

    emask_img = bpy.data.images.new("ExtraBowlTagMask4K", width=4096, height=4096, alpha=False)
    emask_img.colorspace_settings.name = "Non-Color"
    for m in [mat_non, mat_etag]:
        nt = m.node_tree
        node = nt.nodes.get("BakeTarget") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "BakeTarget"
        node.image = emask_img
        nt.nodes.active = node

    scene.render.bake.margin = 0
    bpy.ops.object.bake(type="EMIT")

    tmp_emask = os.path.join(DATA_DIR, "tmp_bowl_emask_4k.png")
    emask_img.filepath_raw = tmp_emask
    emask_img.file_format = "PNG"
    emask_img.save()

    inpaint_bowl_script = f"""
import cv2, numpy as np
img = cv2.imread({tmp_comp!r})
fmask = cv2.imread({tmp_emask!r}, cv2.IMREAD_GRAYSCALE)
region = fmask > 128
if np.any(region):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    local_bg = cv2.medianBlur(gray.astype(np.uint8), 35).astype(np.float32)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # Detect dark marker strokes OR saturated spray paint inside the extra tag regions
    strokes = (((local_bg - gray) > 13.0) | (hsv[:, :, 1] > 48)) & region
    strokes_u8 = (strokes.astype(np.uint8) * 255)
    strokes_u8 = cv2.dilate(strokes_u8, np.ones((5, 5), np.uint8), iterations=1)
    img = cv2.inpaint(img, strokes_u8, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
cv2.imwrite({OUTPUT_TEX!r}, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
"""
    subprocess.run(["/usr/bin/env", "python3", "-c", inpaint_bowl_script], check=True)
    for p in (tmp_comp, tmp_emask):
        if os.path.exists(p):
            os.remove(p)
    print(f"Saved 4K bowl-rebaked & cleaned texture to {OUTPUT_TEX}")


def main():
    args = parse_args()
    if args.mode == "extract":
        run_extract()
    elif args.mode == "bake":
        run_bake()
    elif args.mode == "extract-bowl":
        run_extract_bowl()
    elif args.mode == "bake-bowl":
        run_bake_bowl()


if __name__ == "__main__":
    main()
