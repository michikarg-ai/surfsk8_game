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

To generate or rebuild the skater models, run:

```bash
# Male skater (Lukas) -> public/models/skater.glb
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build_skater_makehuman.py -- male

# Female skater (Lena) -> public/models/skater_female.glb
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build_skater_makehuman.py -- female
```

Output files:
- `public/models/skater.glb` (~8.3 MB, optimized with 1024x1024 textures).
- `public/models/skater_female.glb` (~9.1 MB, optimized with 1024x1024 textures).

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

## 5. Built-in Production Presets

### Male Skater: Lukas (`preset = "male"`)
- **Base Assets**: `male_casualsuit02.mhclo`, `toigo_light_skin_male_bronze.mhmat`, `shoes06.mhclo`.
- **Gear**: Custom procedural turquoise ribbed knit beanie, charcoal dropped hoodie collar, dual knee pads with elastic straps.
- **Outfit Styling**: Stone-washed faded blue jeans with worn thigh/knee fades and charcoal hoodie.
- **Export Target**: `public/models/skater.glb`.

### Female Skater: Lena (`preset = "female"`)
- **Base Assets**: `female_casualsuit01.mhclo` (short-sleeve cotton T-shirt + slim jeans), `toigo_light_skin_female_bronze.mhmat` (sun-tanned bronze skin), `long01.mhclo` (honey blonde hair), `shoes06.mhclo` (black vulcanized skate shoes).
- **No Knee Pads / No Beanie / No Hoodie**: Configured with `wear_hood=False`, `wear_beanie=False`, and `wear_knee_pads=False`.
- **T-Shirt & Munich Logo**:
  - The top half of the texture is recolored to clean white cotton `(0.94, 0.94, 0.93)`.
  - The circular **Surf Skate Munich** emblem (`scripts/assets/surfskate_munich_logo.png`) is stamped onto the chest center at `u = 0.7856, ys = 0.2327` (~330 px diameter).
  - *UV Notice*: In `female_casualsuit01`, the front chest panel is unwrapped horizontally in UV space (+X points towards the neck, +Y points towards the wearer's left). Stamping the logo rotated 90° clockwise (`np.rot90(logo, -1)`) ensures the Munich Frauenkirche spires point vertically up.
- **Ripped Stone-Washed Blue Jeans**:
  - Base denim colored to stonewashed blue `(0.28, 0.44, 0.68)` with worn thigh and knee highlight fades.
  - Authentic worn holes and distress tears with frayed white threads and warm bronze skin tones showing through at:
    - Left knee: `u = 0.110, ys = 0.718`
    - Right knee: `u = 0.676, ys = 0.697`
    - Right mid-thigh: `u = 0.662, ys = 0.631`
    - Left upper thigh: `u = 0.113, ys = 0.607`
- **Shoe Collar Tapering**:
  - The slim jeans hem ends at local `z = 0.22`, while the puffy tongue of `shoes06` originally reached `z = 0.258`.
  - When `is_female=True`, `style_skate_shoes()` automatically tapers the shoe ankle collar and upper tongue inward by 15-18% above `z = 0.205m`, eliminating any mesh poke-through while keeping the vulcanized sole flat.
- **Hair Styling**:
  - Honey-blonde hair (`long01`) uses `style_blonde_hair(meshes, drape_over_hood=False)` to drop naturally over the shoulders and down the back of the T-shirt.
- **Export Target**: `public/models/skater_female.glb`.

---

## 6. How to Add a New Character Preset

To define a new avatar (e.g. new skater, alternative clothing, or different skin tone):

1. Open [`scripts/build_skater_makehuman.py`](../scripts/build_skater_makehuman.py).
2. Add an entry to `PRESETS` specifying `macro`, `skin`, `assets`, `outfit`, `output`, and accessory flags (`wear_hood`, `wear_beanie`, `wear_knee_pads`).
3. If using custom graphic logos, place the PNG asset in `scripts/assets/` and stamp it within the texture recoloring step.
4. Run:
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build_skater_makehuman.py -- <preset_name>
   ```
5. Register the new character in [`src/ui/LandingPage.ts`](../src/ui/LandingPage.ts) in `SKATER_CHARACTERS` with an `id`, display `name`, and `modelUrl`.
6. Run `npm run build` and test the character live in the Garage selector!
