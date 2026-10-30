# CC0 3D Humanoid Avatar & Gear Generation Pipeline 🛹👤

This document provides a comprehensive guide to generating, styling, and rigging the 3D skater avatar for **Surfskate Munich**, ensuring that future avatars (female variant, alternative outfits, or new gear) can be reproduced or customized seamlessly.

---

## 1. Pipeline Overview & Licensing

The character generation pipeline in `scripts/build_skater_makehuman.py` produces a game-ready, fully rigged humanoid avatar mounted on a surfskate board and exports it directly to `public/models/skater.glb`.

- **100% CC0 (Public Domain)**: All underlying base meshes, rigs, skins, and clothes originate from official CC0 MakeHuman / MPFB 2 asset packs.
- **Unrestricted Commercial & Non-Commercial Use**: No third-party copyright, royalty, or attribution obligations.
- **Headless Execution**: Runs directly from the terminal via Blender's background mode (`blender -b`).

---

## 2. Prerequisites & Setup

### A. Blender Version
- **Blender 4.2+ or 5.x LTS** installed (e.g. `/Applications/Blender.app/Contents/MacOS/Blender` on macOS).

### B. Install MPFB 2 (MakeHuman Plugin for Blender)
1. Download or clone MPFB 2 from [github.com/makehumancommunity/mpfb2](https://github.com/makehumancommunity/mpfb2).
2. Zip the `src/mpfb` folder as `mpfb_ext.zip`.
3. Install into Blender:
   ```bash
   blender --command extension install-file -r user_default -e mpfb_ext.zip
   ```

### C. Download CC0 Asset Packs
Download the official CC0 asset packs from [files.makehumancommunity.org/asset_packs/](https://files.makehumancommunity.org/asset_packs/):
1. `makehuman_system_assets_cc0.zip` (base mesh, game engine rig, eyes, eyebrows, eyelashes, clothes).
2. `skins02_cc0.zip` (high-res CC0 photorealistic skin textures).

Unzip both packs into the MPFB user data directory:
- **macOS**: `~/Library/Application Support/Blender/<version>/extensions/.user/user_default/mpfb/data/`
- **Linux**: `~/.config/blender/<version>/extensions/.user/user_default/mpfb/data/`
- **Windows**: `%APPDATA%\Blender Foundation\Blender\<version>\extensions\.user\user_default\mpfb\data\`

---

## 3. Running the Generator

To generate or rebuild the skater model, run:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build_skater_makehuman.py -- male
```

To create a female variant:
```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build_skater_makehuman.py -- female
```

Output file: `public/models/skater.glb` (~8 MB, optimized with 1024x1024 textures).

---

## 4. Architecture & Step-by-Step Processing

The script [`scripts/build_skater_makehuman.py`](../scripts/build_skater_makehuman.py) executes the following stages:

### Step 1: Morphological Character Generation (`build_character`)
- Uses MPFB services (`HumanService`, `TargetService`, `AssetService`, `ExportService`).
- Configures target macro sliders defined in `PRESETS`:
  - `gender`: 1.0 (male) or 0.0 (female)
  - `age`: 0.5 (approx. 25 years old)
  - `muscle`: 0.72 (athletic surfskater physique)
  - `weight`: 0.45 (lean)
  - `proportions`: 0.65
- Applies the sun-tanned skin texture: `toigo_light_skin_male_bronze.mhmat`.
- Attaches CC0 facial and clothing assets:
  - Eyes: `low-poly.mhclo`
  - Eyebrows: `eyebrow001.mhclo`
  - Eyelashes: `eyelashes01.mhclo`
  - Top & Jeans: `male_casualsuit02.mhclo`
  - Shoes: `shoes06.mhclo`

### Step 2: Rigging & glTF 4-Bone Skinning Optimization
- Adds the built-in `game_engine` rig with 23 primary animation bones:
  - `Root`, `pelvis`, `spine_01`, `spine_02`, `spine_03`
  - `clavicle_l/r`, `upperarm_l/r`, `lowerarm_l/r`, `hand_l/r`
  - `neck_01`, `head`
  - `thigh_l/r`, `calf_l/r`, `foot_l/r`, `ball_l/r`
- **Geometry Mask Optimization (`refine_body_delete_masks`)**:
  - Deletes hidden body vertices under clothing to save triangles and prevent z-fighting.
  - **Crucial Rule**: Preserves a small buffer overlap around wrists, ankles, and neck so joint flexion during extreme poses (e.g. Bertslide, deep rail carves) never reveals hollow mesh gaps.
- **Bone Group Cleansing (`fix_opaque_materials_and_vgroups`)**:
  - Strips helper vertex groups that don't match the 23 game bones, ensuring strict compliance with glTF's 4-bone-per-vertex hardware skinning limit.
- **Material Alpha Disconnection**:
  - MPFB's `GAMEENGINE` builder mistakenly wires PNG alpha (used internally for specular/SSS masks) into `BSDF Principled Alpha`. The script unlinks alpha on all opaque clothes, skin, and shoes to prevent glTF export transparency bugs.

### Step 3: Texture Atlas Recoloring & Styling
- **Faded Blue Jeans & Charcoal Hoodie (`recolor_outfit`)**:
  - Operates on `male_casualsuit02.png`.
  - Distinguishes shirt pixels from trousers using spatial coordinate bounds and chroma conditions (`shirt = (ys < 0.465) | (xs > 0.782) | (px[..., 0] >= px[..., 2] * 0.98)`).
  - Transforms the top into a clean charcoal hoodie while preserving cloth wrinkles.
  - Colors the lower section into stone-washed faded blue denim with worn thigh/knee highlights and dark seam shading.
- **Classic Vulcanized Skate Shoes (`style_skate_shoes`)**:
  - Operates on `shoes06.png` and vertex geometry.
  - Converts upper to matte black suede with white side stitch lines.
  - Recovers crew socks under jeans cuffs into dark charcoal.
  - Widens the toe box and sole horizontally for flat-bottom skate shoe contact.
  - Uses `bmesh.ops.bisect_plane` to slice clean horizontal planes for the off-white vulcanized rubber sidewall foxing sole and black foxing stripe.

### Step 4: Procedural Skater Gear & Accessories
- **Turquoise Knit Beanie (`build_beanie`)**:
  - Bounded directly from the head vertex coordinates (`head_pts`).
  - Creates a rounded dome shell with an inverted folded brim.
  - Adds a procedural rib-knit micro-normal ripple texture and turquoise woolen material.
  - Weight-painted 100% to the `head` bone.
- **Dropped Hoodie Collar (`build_hoodie_collar`)**:
  - Contoured torus hugging the neck between `1.47m` and `1.57m` Z.
  - Weight-painted to `spine_03`.
- **Knee Pads & Elastic Straps**:
  - Modeled with `build_dome_shell` and `primitive_torus_add` positioned around the knee joints.
  - Hard plastic matte outer shell with textile padding and rear elastic bands.
  - Weight-painted to `calf_l` and `calf_r`.

### Step 5: Surfskate Deck Outline & Griptape Atlas
- Imports the base mechanics from `scripts/assets/surfskate_board_source.glb`.
- **Deck Outline Reshaping (`reshape_surfskate_deck`)**:
  - Redefines the deck into a 34" SmoothStar Filipe Toledo profile via `deck_half_width(t)`:
    - Rounded surfboard nose apex at `t = 0.0`.
    - Wide chest rail (width = 0.272m) at `t = 0.40`.
    - Squared-off wide squash tail at `t = 1.0`.
  - Non-linear cosine ring distribution clusters geometry at the nose tip and tail corners for smooth curves.
  - Normal validation flips inverted face normals automatically.
- **Griptape Texture Generation**:
  - Synthesizes a 1024x2048 griptape texture with mineral sparkle, blonde maple wood rail border (5.2 mm inset), and 8 truck mounting bolt rings.

### Step 6: glTF / GLB Export
- Reparents the armature and board group under `SurfskaterRoot`.
- Downscales high-resolution textures to `TEXTURE_SIZE = 1024` for fast web delivery.
- Exports to `public/models/skater.glb` with `export_skins=True`, `export_yup=True`.

---

## 5. How to Add a New Character Preset

To define a new avatar (e.g. female surfskater, alternative clothing, or different skin tone):

1. Open [`scripts/build_skater_makehuman.py`](../scripts/build_skater_makehuman.py).
2. Add an entry to `PRESETS`:
   ```python
   PRESETS["female"] = {
       "macro": {
           "gender": 0.0,
           "age": 0.45,
           "muscle": 0.58,
           "weight": 0.38,
           "proportions": 0.62,
           "height": 0.48,
           "cupsize": 0.45,
           "firmness": 0.5,
           "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0},
       },
       "skin": "toigo_light_skin_female_bronze.mhmat",
       "assets": [
           ("eyes", "low-poly.mhclo", "Eyes"),
           ("eyebrows", "eyebrow001.mhclo", "Eyebrows"),
           ("eyelashes", "eyelashes01.mhclo", "Eyelashes"),
           ("clothes", "female_casualsuit01.mhclo", "Clothes"),
           ("clothes", "shoes06.mhclo", "Clothes"),
       ],
       "outfit": "female_casualsuit01",
       "hoodie_color": (0.12, 0.12, 0.14),
       "denim_color": (0.30, 0.45, 0.65),
       "helmet_color": (0.85, 0.35, 0.20),
   }
   ```
3. Run:
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build_skater_makehuman.py -- female
   ```
4. Verify the newly exported `public/models/skater.glb` in game.
