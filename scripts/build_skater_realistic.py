#!/usr/bin/env python3
"""
Realistic Rigged Surfskater Pipeline (`public/models/skater.glb`)

Replaces the old rigid primitive-based skater with a properly modelled, skinned human
(Ready Player Me avatar shipped with the three.js examples, `scripts/assets/readyplayer.me.glb`):

1. Imports the rigged avatar (Mixamo-compatible skeleton: Hips, Spine*, Neck, Head, *UpLeg, *Leg,
   *Foot, *Arm, *ForeArm, *Hand ...) and removes its cowboy hat + helper geometry.
2. Re-colours the outfit into dark skate wear: charcoal jacket top (tails trimmed at the hip),
   dark indigo denim, black skate shoes (texture luminance is kept so fabric folds and seams survive).
3. Adds a matte-black skate helmet shell (bone-parented to `Head`).
4. Re-uses the existing surfskate board hierarchy (`BoardGroup`, `DeckMesh`, `FrontTruckPivot`,
   `RearTruckPivot`, wheels) from `scripts/assets/surfskate_board_source.glb`.
5. Places the skater in a regular stance (left foot toward the nose, facing the toe-side edge) on the
   deck and exports one skinned GLB. The game poses the skeleton at runtime (leg IK, crouch, lean,
   arm balance, head look) in `src/entities/SkaterVisuals.ts`.
"""

import math
import os

import bpy
import numpy as np

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AVATAR_GLB = os.path.join(ROOT_DIR, "scripts", "assets", "readyplayer.me.glb")
BOARD_GLB = os.path.join(ROOT_DIR, "scripts", "assets", "surfskate_board_source.glb")
OUTPUT_PATH = os.path.join(ROOT_DIR, "public", "models", "skater.glb")

DECK_TOP_Z = 0.162  # Top surface of the deck in board space (Blender Z-up)


def new_material(name, color, roughness=0.6, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def recolor_image(img, tint, contrast=1.0, lift=0.0):
    """Replace hue/saturation of an image with `tint`, keeping its luminance detail."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lum = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
    mean = float(lum.mean()) if lum.size else 0.5
    detail = np.clip((lum - mean) * contrast + 1.0, 0.25, 2.2)
    for c in range(3):
        px[:, c] = np.clip(tint[c] * detail + lift, 0.0, 1.0)
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()


def base_color_image(mat):
    if not mat or not mat.node_tree:
        return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return None
    links = bsdf.inputs["Base Color"].links
    if links and links[0].from_node.type == "TEX_IMAGE":
        return links[0].from_node.image
    return None


def parent_to_bone(obj, armature, bone_name):
    """Parent `obj` to an armature bone while keeping its current world transform."""
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = world


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ------------------------------------------------------------------
    # 1. Board (re-use the existing surfskate hierarchy)
    # ------------------------------------------------------------------
    bpy.ops.import_scene.gltf(filepath=BOARD_GLB)
    board_group = bpy.data.objects["BoardGroup"]
    keep = {board_group}
    stack = [board_group]
    while stack:
        o = stack.pop()
        for c in o.children:
            keep.add(c)
            stack.append(c)
    board_world = board_group.matrix_world.copy()
    board_group.parent = None
    board_group.matrix_world = board_world
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)

    # ------------------------------------------------------------------
    # 2. Rigged human avatar
    # ------------------------------------------------------------------
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=AVATAR_GLB)
    avatar_objs = [o for o in bpy.data.objects if o not in before]
    armature = next(o for o in avatar_objs if o.type == "ARMATURE")
    armature.name = "SkaterArmature"

    for o in avatar_objs:
        if o.type == "MESH" and (o.name.startswith("Icosphere") or "Headwear" in o.name):
            bpy.data.objects.remove(o, do_unlink=True)

    import bmesh

    # Cut the suit-jacket tails off at hip level so the top reads as a hoodie
    for o in [o for o in bpy.data.objects if o.type == "MESH" and "Outfit_Top" in o.name]:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = [v for v in bm.verts if (o.matrix_world @ v.co).z < 0.965]
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        bm.to_mesh(o.data)
        bm.free()

    # Re-colour outfit textures into skate wear
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o.parent == armature]:
        for mat in o.data.materials:
            img = base_color_image(mat)
            if img is None:
                continue
            if "Outfit_Top" in mat.name:
                recolor_image(img, (0.1, 0.104, 0.115), contrast=0.35)  # flat charcoal (hides suit details)
            elif "Outfit_Bottom" in mat.name:
                recolor_image(img, (0.055, 0.075, 0.12), contrast=1.8)  # dark indigo denim
            elif "Footwear" in mat.name:
                recolor_image(img, (0.06, 0.06, 0.065), contrast=2.4, lift=0.01)  # black skate shoes
        for o2 in [o]:
            o2.name = o2.name.replace("Wolf3D_", "Skater_")

    # Regular stance: rotate so the skater's left side points at the nose (-Y) and he faces -X
    armature.rotation_mode = "XYZ"
    armature.rotation_euler = (0.0, 0.0, -math.pi / 2)
    armature.location = (0.0, 0.0, DECK_TOP_Z + 0.002)
    bpy.context.view_layer.update()

    def bone_world(name, tail=False):
        b = armature.data.bones[name]
        return armature.matrix_world @ (b.tail_local if tail else b.head_local)

    # ------------------------------------------------------------------
    # 3. Skate protection: helmet, neck gaiter, knee pads (bone-parented)
    # ------------------------------------------------------------------
    # Head mesh (avatar space): z 1.521..1.833, depth (face→back) 0.234 m, width 0.19 m.
    # After the stance rotation the face points toward -X, depth runs along X, width along Y.
    z0 = armature.location.z
    helmet_mat = new_material("SkaterHelmet", (0.025, 0.026, 0.03), roughness=0.42)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0)
    helmet = bpy.context.active_object
    helmet.name = "SkaterHelmet"
    bm = bmesh.new()
    bm.from_mesh(helmet.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.22], context="VERTS")
    bm.to_mesh(helmet.data)
    bm.free()
    helmet.scale = (0.136, 0.112, 0.122)
    helmet.location = (-0.018, 0.0, z0 + 1.782)
    helmet.data.materials.append(helmet_mat)
    mod = helmet.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = 0.1
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.modifier_apply(modifier="Solidify")
    parent_to_bone(helmet, armature, "Head")

    # ------------------------------------------------------------------
    # 4. Root hierarchy & export
    # ------------------------------------------------------------------
    root = bpy.data.objects.new("SurfskaterRoot", None)
    bpy.context.scene.collection.objects.link(root)
    for o in (board_group, armature):
        w = o.matrix_world.copy()
        o.parent = root
        o.matrix_world = w

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_PATH,
        export_format="GLB",
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_apply=False,
        export_yup=True,
    )
    print(f"Exported realistic rigged surfskater to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
