---
name: skatepark-3d-pipeline
description: >-
  End-to-end workflow for creating game-ready 3D skatepark models (RealityKit photogrammetry,
  Blender decimation/baking, LiDAR alignment) and replacing real-world/offensive graffiti via
  Blender multi-view projection, AI image generation, and 4K UV re-baking.
---

# Skatepark 3D Reconstruction & AI Graffiti Replacement Pipeline

Use this skill when adding a new photogrammetry skatepark to SRFSK8 or replacing real-world, offensive, or copyrighted graffiti/tags on an existing park texture.

---

## Part 1: Creating Game-Ready 3D Skatepark Models

1. **Frame Extraction & Photogrammetry (`USDZ`)**
   - Extract sharp frames from GoPro / 360° / drone footage (see [`scripts/reconstruct_airport_skatepark.py`](../../../scripts/reconstruct_airport_skatepark.py), [`scripts/reconstruct_babenhausen_v2.py`](../../../scripts/reconstruct_babenhausen_v2.py), [`scripts/process_360_babenhausen.py`](../../../scripts/process_360_babenhausen.py)).
   - Reconstruct raw `.usdz` mesh via Apple RealityKit Object Capture ([`scripts/photogrammetry_cli.swift`](../../../scripts/photogrammetry_cli.swift)).
2. **Blender Optimization, LiDAR Calibration & 4K Texture Bake**
   - Decimate raw photogrammetry mesh, preserve bowl/wall transitions, flatten floor noise, and align to real-world metric scale / LiDAR heightmap (see [`scripts/bake_airport_skatepark.py`](../../../scripts/bake_airport_skatepark.py), [`scripts/bake_babenhausen_park.py`](../../../scripts/bake_babenhausen_park.py), [`scripts/generate_babenhausen_lidar.py`](../../../scripts/generate_babenhausen_lidar.py)).
   - Export game-ready `.glb` to `public/models/` (typically ~10–35 MB) and externalize its 4K color atlas to `public/textures/<park>_tex0.jpg` (keeping an untouched `.png` backup where applicable).
3. **Viewer & Game Integration**
   - Test geometry & scale in [`public/viewer.html`](../../../public/viewer.html).
   - Wire the park in [`src/ui/LandingPage.ts`](../../../src/ui/LandingPage.ts) (`SKATEPARK_LOCATIONS`), [`src/world/ImGefildeScene.ts`](../../../src/world/ImGefildeScene.ts) (explicit `loader.loadAsync` + `texLoader.loadAsync` with `flipY = false`, `THREE.SRGBColorSpace`), and [`src/physics/ParkSurface.ts`](../../../src/physics/ParkSurface.ts).

---

## Part 2: Replacing Graffiti via Blender Multi-View Projection + 4K UV Re-Bake

**Rule #1: Never edit a photogrammetry 4K `UVMap` atlas directly with AI.**  
Photogrammetry UVs are fragmented into thousands of tiny, rotated islands; direct 2D edits cause severe seam tearing and perspective distortion on curved transitions. Always project through 3D cameras in Blender.

Reference implementations:
- [`scripts/airport_graffiti_rebake.py`](../../../scripts/airport_graffiti_rebake.py) (climbing wall + bowl transitions)
- [`scripts/gefilde_graffiti_rebake.py`](../../../scripts/gefilde_graffiti_rebake.py) (bowl transitions + world-space floor cleanup + oblique hump cleanup)

### Step 1: Extract Distortion-Free Camera Views (`--mode extract`)
- Load `public/models/<park>.glb` and `public/textures/<park>_tex0.jpg` in Blender (`bpy`, Unlit/`Emission` shader).
- Place orthographic (or wide perspective) cameras perpendicular to each graffiti wall, bowl lobe, or floor hump and save camera transforms to `data/*_cams.json`.
- Render `*_orig.png` views (e.g. `1536×512` for wide curved transitions, `1024×1024` for focused walls/humps) plus a top-down overview (`*_overview.png`).

### Step 2: Generate & Align Clean Surfskate Murals
- Use `image-generator` with `*_orig.png` as reference to replace real-world/offensive tags with weathered concrete or surfskate-themed murals (`CARVE`, `DRIFT`, `FLOW`, ocean waves).
- **Aspect Ratio Tip:** Request `16:9` when generating wide transition murals so `image-generator` does not default to `1:1` and compress/hallucinate extra geometry.
- Align generated artwork back onto the exact `*_orig.png` silhouette/dimensions (`*_edited.png`) before baking.

### Step 3: Project & Bake Back into 4K `UVMap` (`--mode bake`)
- Project `*_edited.png` from the saved cameras onto `UVMap` in Blender and bake at `4096×4096`, saving first to a test texture `public/textures/<park>_tex0_aigraffiti_test.jpg` (JPEG q=90).
- **Critical Pitfalls to Avoid:**
  1. **No hard Z/normal cutoffs on bowl transitions:** Filtering faces with hard thresholds like `p.z >= 0.064` or `fn.z < 0.86` slices off the bottom of murals (`DRIFT`, wave bases) with jagged sawtooth edges. Use smooth spatial bounds + ray-angle/dot-product falloff (`-fn.dot(fwd) > 0.20`) instead.
  2. **Separate RGB & Grayscale mask projection:** Bake projection masks in a dedicated grayscale pass (never premultiplied RGBA) to prevent dark halos or rectangular seams on flat concrete floors.
  3. **Overlapping `UVMap` islands:** Background/tree polygons in photogrammetry GLBs sometimes share `UVMap` coordinates with bowl/hump faces and overwrite localized patches with `0.0` during bake. Isolate target faces via `bmesh` world-space bounding boxes before baking localized cleanups (see `run_hump_clean()` in [`scripts/gefilde_graffiti_rebake.py`](../../../scripts/gefilde_graffiti_rebake.py)).
  4. **Inpainting floor tags cleanly:** For flat/hump floor graffiti, render an overhead or oblique view, compute a dilated difference/target mask, run `cv2.inpaint(..., INPAINT_TELEA)`, add subtle concrete grain (`std ≈ 2.2`), and feather the alpha mask with Gaussian blur.

### Step 4: 3D QA, Viewer Check & Game Deployment
1. Render 3D QA views (`qa_bowl.png`, `qa_topdown.png`, and oblique closeups for tricky humps) and visually inspect for cropped murals, residual tags, or projection seams.
2. Add/verify the test option in [`public/viewer.html`](../../../public/viewer.html) (`?model=/models/<park>.glb&tex=/textures/<park>_tex0_aigraffiti_test.jpg`) and confirm HTTP 200 (`image/jpeg`) on the dev server.
3. Once approved, copy `*_aigraffiti_test.jpg` over `public/textures/<park>_tex0.jpg`, bump the `?v=N` cache-buster in [`src/world/ImGefildeScene.ts`](../../../src/world/ImGefildeScene.ts), run `npm run build`, and commit/push.
