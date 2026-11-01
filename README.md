# Surfskate Im Gefilde 🛹🌊

A realistic 3D WebGL surfskate simulator set in the real-world **Skatepark "Im Gefilde"** in Munich/Neubiberg, Germany. Built with **Three.js**, **TypeScript**, and **Vite**.

![Surfskate Munich](reference_images/skater_in_skatepark.png)

---

## 🎮 Highlights & Features

- **Landing Page & Character Selector**:
  - Interactive 3D garage / character showcase before starting the session.
  - Cycle between male skater (**LUKAS**) and female skater (**LENA**) in real time with live 3D preview.
  - Community callout hooks encouraging players to visit [@surfskate_munich](https://www.instagram.com/surfskate_munich/) on Instagram to vote for future skaters, skateparks, and surfskate boards.
  - Seamless in-game return to the Garage at any time via <kbd>ESC</kbd> or the HUD broadcast button.
- **Broadcast-Style Skewed Parallelogram HUD**:
  - High-impact italic typography (Barlow Condensed) featuring session clock, score counters, 12-segment flow bar, real-time speed in km/h, and an analog surf-adapter lean gauge.
  - Dynamic right-edge **PERFECT PUMP** alert banner that completely tucks away when idle.
- **Aspect Ratio Toggle (16:9 ↔ 9:16 Reel Mode)**:
  - Press <kbd>R</kbd> to switch between full 16:9 desktop presentation and 9:16 vertical smartphone/Instagram Reel format with instant canvas and camera aspect recalculation.
- **Authentic Surfskate Physics & Maneuvers**:
  - **Dynamic Pumping**: Pumping up and down transitions builds real speed (just like on actual surfskate trucks such as Carver C7 / YOW Meraki), while flat ground requires deliberate rail carving.
  - **Transition & Wall Gravity**: Realistic momentum conservation prevents climbing high vertical walls at low speeds; carving into wall pockets converts vertical speed into lateral drive.
  - **Sharp Surf Carves**: Responsive dual-pivot front truck steering enables tight cutbacks and flowing figure-8 lines.
- **The Scoring Tricks**:
  - **SNAP** (<kbd>Q</kbd>): High-speed lip redirection at the crest of transitions with dynamic slow-motion time dilation, camera zoom, and score prompt.
  - **BERTSLIDE** (<kbd>C</kbd>): High-speed hand-plant slide requiring an established carve (`≥ 14 km/h`), dropping the hips low, planting the inside hand, and kicking the tail out around a Bertleman arc.
  - **LAYBACK** (<kbd>F</kbd>): High-speed power carve (`≥ 16 km/h`), laying the shoulders back and dragging the trailing hand through the turn.
  - **FS REVERSE 360** (<kbd>E</kbd>): Frontside carve carving into a full 360° tail whip while maintaining forward travel.
- **Realistic Rigged Skaters & IK**:
  - Full skeletal humanoid models with real-time inverse kinematics (IK) anchoring feet to the deck.
  - **Lukas**: Custom CC0 MakeHuman/MPFB avatar with turquoise knit beanie, charcoal hoodie, stone-washed faded blue jeans, and vulcanized black-suede skate shoes.
  - **Lena**: Sun-tanned female surfskater with honey-blonde hair, dynamic GPU wind & flutter physics (hair streams backwards in the wind, ripples with turbulent eddies, and sways outward under centrifugal force during deep carves), white *Surf Skate Munich* circular logo T-shirt, stone-washed ripped blue jeans, and vulcanized skate shoes.
  - 34" SmoothStar Filipe Toledo-inspired surfboard deck with rounded nose, wide rail chest, and wide squash tail.
- **Real-World Photogrammetry & LiDAR Park**:
  - 3D reconstruction generated from drone and action camera photogrammetry.
  - Combined with official Bavarian DGM1 LiDAR elevation data for smooth, accurate wheel collision.
- **Procedural Audio Engine**:
  - 100% synthesized in real time via the Web Audio API — featuring granular urethane wheel roll, transition hiss, and band-passed airy swooshes for snaps.
- **Atmospheric Environment**:
  - Night sky dome panorama, perimeter stadium floodlights illuminating the bowl concrete, and HDR environmental lighting.

---

## 🕹️ Controls

| Action | Keyboard | Notes |
| :--- | :--- | :--- |
| **Push off** | <kbd>W</kbd> / <kbd>↑</kbd> | Single kick, **only from a standstill** |
| **Carve / Pump** | <kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd> | Alternate left/right in rhythm (≈ 1 left-right cycle/sec) to generate speed |
| **Wall pump** | Automatic stretch up, compression down | Hold <kbd>S</kbd> / <kbd>Shift</kbd> while dropping down a wall to pump harder |
| **SNAP** | <kbd>Q</kbd> | At the top of a transition wall within the speed window |
| **BERTSLIDE** | Hold <kbd>C</kbd> | High speed (`≥ 14 km/h`) + deep carve (plants hand & kicks tail out) |
| **LAYBACK** | Hold <kbd>F</kbd> | High speed (`≥ 16 km/h`) + deep carve (drags trailing hand) |
| **FS REVERSE 360** | <kbd>E</kbd> | Frontside (<kbd>→</kbd>) carve with speed |
| **Ollie** | <kbd>Space</kbd> | Pop an air |
| **Aspect mode (16:9 / 9:16)** | <kbd>R</kbd> | Toggle desktop ↔ Instagram Reel frame |
| **Camera / Truck feel / Auto-shred** | <kbd>V</kbd> / <kbd>T</kbd> / <kbd>P</kbd> | Cycle camera, truck stiffness, or auto-line filmer |
| **Tricks & Options overlay** | <kbd>H</kbd> | Toggle help dock |
| **Return to Garage** | <kbd>ESC</kbd> | Return to character / park selector landing page |
| **Reset session** | <kbd>X</kbd> / <kbd>Backspace</kbd> | Return to spawn point |

Only the four scoring tricks award points. Each landed trick triggers slow motion, a dynamic camera zoom, scoring notifications, and a synthesized swoosh.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Installation
```bash
git clone https://github.com/michikarg-ai/surfsk8_game.git
cd surfsk8_game
npm install
```

### Running Locally
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### Building for Production
```bash
npm run build
```
The compiled, optimized production bundle will be in `dist/`.

---

## 📁 Project Architecture

```
surfskate_game/
├── index.html                   # Game entry point and HUD overlays
├── public/
│   ├── env/                     # HDRI environment map
│   ├── models/
│   │   ├── skatepark_multi.glb  # 3D photogrammetry park mesh
│   │   ├── im_gefilde_lidar.json# LiDAR elevation grid for physical collision
│   │   ├── skater.glb           # Male skater (Lukas) + procedural surfskate board
│   │   └── skater_female.glb    # Female skater (Lena) + procedural surfskate board
│   └── textures/                # Color maps and night sky dome
├── scripts/                     # Python & Swift asset processing tools
│   ├── assets/                  # Logos and base board source assets
│   ├── build_park.py            # LiDAR & mesh processing
│   ├── build_skater_makehuman.py# CC0 MakeHuman/MPFB character & gear builder
│   └── photogrammetry_cli.swift # Apple Object Capture photogrammetry tool
├── src/
│   ├── audio/SurfAudio.ts       # Web Audio API procedural sound synthesizer
│   ├── camera/SurfCamera.ts     # Smooth trailing surf action camera
│   ├── entities/SkaterVisuals.ts# Skater skeletal posing and leg IK
│   ├── physics/
│   │   ├── ParkSurface.ts       # Heightfield, slope & normal collision
│   │   └── SurfskateController.ts# Surfskate kinematics and trick logic
│   ├── ui/
│   │   ├── LandingPage.ts       # 3D Garage character & park selector overlay
│   │   └── SurfHUD.ts           # HUD displays and score notifications
│   ├── world/ImGefildeScene.ts  # Three.js scene graph, lights, and sky dome
│   └── main.ts                  # Main game loop and input routing
└── vite.config.ts
```

---

## ⚖️ Assets, Licenses & Attributions

When publishing or distributing this game, keep the following license terms and asset origins in mind:

### 1. Codebase
- **Source Code**: MIT License.
- **Three.js**: MIT License (Copyright © 2010-2026 Three.js authors).
- **Vite**: MIT License.

### 2. The Surfskate Board
- **100% Custom / Procedural**: The surfskate deck, concave profile, kicktail, Carver-style swing-arm front truck, rear truck, urethane wheels, bearings, and bushings were generated purely via mathematical formulas in `scripts/build_skater.py`.
- No third-party copyright applies to the board geometry.

### 3. Skater Character Model & Avatar Generation Pipeline
- **100% CC0 (Public Domain)**: Generated with the official MakeHuman / MPFB 2 Blender extension (`scripts/build_skater_makehuman.py`) using only official CC0 MakeHuman system and skin asset packs (`makehuman_system_assets`, `skins02`) plus custom procedural skate gear (turquoise knit skater beanie, hoodie collar, knee pads, stone-washed denim jeans, and vulcanized black-suede skate shoes).
- Free for unrestricted commercial and non-commercial publishing with no attribution or third-party terms required.
- 📖 **Detailed Avatar Creation Guide**: See [`docs/avatar_pipeline_guide.md`](docs/avatar_pipeline_guide.md) for full reproduction steps, setup instructions, vertex mask optimization rules, texture atlas recoloring techniques, and instructions for adding new character variants (e.g. female surfskater).

### 4. Skatepark Photogrammetry & Geodata
- **Photogrammetry 3D Mesh**: Reconstructed from drone and camera video footage recorded at the public skatepark "Im Gefilde" in Neubiberg/Munich (*Panoramafreiheit* / Freedom of Panorama applies under § 59 German UrhG).
- **LiDAR & Aerial Elevation Data**: Derived from DGM1 / DOP20 data provided by the Bavarian Surveying and Cadastre Administration:
  - *Data source*: Geodaten © [Bayerische Vermessungsverwaltung](https://vermessung.bayern.de/) (dl-de/by-2-0).

### 5. Sound Effects & Music
- **100% Procedural Web Audio API**: All sounds (wheel rolling hiss, carve crunch, SNAP airy swooshes) are synthesized mathematically on the fly in `src/audio/SurfAudio.ts`. No copyrighted audio samples are used.

### 6. Environment & Sky
- HDRI and night sky background licensed under CC0 (Public Domain via Poly Haven & Wikimedia Commons).

### 7. Fonts
- **Barlow Condensed**, **Rubik Dirt**, **Permanent Marker**, and **Sedgwick Ave Display** (self-hosted in `public/fonts/`, from Google Fonts) are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/) — free for commercial use and redistribution.
