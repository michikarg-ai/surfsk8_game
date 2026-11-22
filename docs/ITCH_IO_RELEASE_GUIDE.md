# SRFSK8 — itch.io HTML5 Release Guide (5-Minute Checklist)

This guide gives you everything needed to build, package, and publish **SRFSK8** (`surfskate-munich`) as a browser-playable HTML5 game on **itch.io** while sharing the live Global Leaderboard with Vercel.

---

## 1. Build the Clean itch.io ZIP (`~105 MB`)

Run the dedicated itch.io release script from the project root:

```bash
npm run build:itch
```

What this does automatically:
1. Compiles TypeScript and bundles with Vite using `ITCH_BUILD=1` (`base: './'` so all asset & chunk paths are relative).
2. Copies **only production runtime assets** from `dist/` into a clean temporary directory—filtering out ~1.4 GB of local raw `.usdz` / `.glb` photogrammetry scans and uncompressed `.png` files.
3. Verifies `index.html` sits at the ZIP root with `./assets/...` relative paths and checks the archive is well under itch.io's 500 MB limit.
4. Outputs the upload-ready archive to:
   - `release/srfsk8-itch-html5.zip` *(git-ignored via `.gitignore`)*

> **Note on `dist/`:** You can delete `dist/` locally after building (`rm -rf dist`) without affecting `release/srfsk8-itch-html5.zip`.

---

## 2. Create & Configure the itch.io Project

Go to **[itch.io/game/new](https://itch.io/game/new)** and apply these exact settings:

### Project Basics
- **Title:** `SRFSK8 — Surfskate Munich`
- **Project URL:** `srfsk8` (e.g., `https://<your-username>.itch.io/srfsk8`)
- **Short description / Tagline:**
  - *EN:* `3D surfskate physics in real LiDAR-scanned Munich skateparks. Pump, carve, and chase the Flow Line!`
  - *DE:* `3D-Surfskate-Physik in echten LiDAR-gescannten Münchner Skateparks. Pumpe, carve & knacke die Flow Line!`
- **Classification:** `Games`
- **Kind of project:** **`HTML`** *(Required for browser play)*
- **Pricing:** `$0 or donate` (Free + optional tips; itch.io default rev share 10%, configurable down to 0%)

### Upload & Embed Options
1. Under **Uploads**, click **Upload files** and select `release/srfsk8-itch-html5.zip`.
2. Check **`This file will be played in the browser`** (`ON`).
3. Configure **Embed options**:
   - **Embed in page:** `ON` (recommended over "Click to launch in fullscreen" for instant discovery, or either works with Fullscreen enabled)
   - **Viewport dimensions:** **`1280 × 720`** (16:9 HD; scales cleanly on desktop & mobile)
   - **Mobile friendly:** **`ON`** *(Enables SRFSK8's auto-detected Touch Controls on phones/tablets)*
   - **Automatically start on page load:** `OFF` (recommended so players click Play cleanly and Web Audio unlocks reliably on gesture)
   - **Fullscreen button:** **`ON`**
   - **Scrollbars:** `OFF`
   - **SharedArrayBuffer support (Experimental):** **`OFF`** *(Not used; turning it ON adds strict COOP/COEP headers that can break external links/APIs)*

### Visual Assets & Store Media
- **Cover Image (Required):** **`630 × 500 px`** (PNG/JPG — tip: use a sharp Garage or Bowl action shot with the `SRFSK8` logo)
- **Gameplay Screenshots (Recommended 3–5):** **`1920 × 1080 px`** (16:9 PNG/JPG):
  1. Garage Selector (Lukas / Sophie + Board selection)
  2. Skatepark Im Wiesengrund (Night floodlight carve / bowl snap)
  3. Airport Skatepark (Golden Hour bowl flow)
  4. Flow Line / Combo Multiplier HUD in action
- **Optional Gameplay GIF:** `630 × 500 px` or `16:9` (< 3 MB) showing a bowl pump -> coping snap combo.

### Metadata, Genre & Tags
- **Genre:** `Sports` (or `Action`)
- **Tags** (paste these exact tags):
  `surfskate`, `skateboarding`, `3d`, `sports`, `webgl`, `threejs`, `munich`, `arcade`
- **Release status:** `Released`
- **Visibility:** Start with `Draft` or `Restricted` to test inside the itch.io iframe, then switch to **`Public`**.

---

## 3. Ready-to-Paste Game Description

### English Version

```markdown
## Ride Real LiDAR-Scanned Munich Skateparks in 3D

**SRFSK8** brings authentic surfskate carving and pumping physics straight to your browser—set inside real photogrammetry & LiDAR-scanned skateparks from Munich (**Im Wiesengrund** and **Airport Skatepark**).

Generate speed purely by pumping transitions and carving S-turns, snap off the concrete bowl coping, link tricks into huge combo multipliers, and compete on the **Global Leaderboard**!

### Features
- **Authentic Surfskate Physics:** Dynamic rail-to-rail carving, transition pumping, Bert slides, coping grinds, and air grabs.
- **2 Real Scanned Parks:** *Im Wiesengrund* (Night Floodlights) & *Airport Skatepark* (Golden Hour).
- **2 Riders & Custom Setups:** Ride as **Lukas** or **Sophie** with customizable boards.
- **Flow Line & Collectibles:** Chase optimal bowl lines, follow the Ghost Skater, collect Pretzels, and dodge the Scooter Kid NPC.
- **Global Highscores:** Cross-platform live leaderboard shared across web & itch.io.
- **Original Soundtrack & Web Audio SFX:** Urethane wheel roll, concrete slide screech, coping sparks, and 3 high-energy anthems.
- **Desktop + Mobile Ready:** Full keyboard controls and auto-detected on-screen touch controls.

### Controls (Keyboard)
- **Carve Left / Right:** `A` / `D` or `←` / `→`
- **Pump / Crouch:** `W` / `S` or `↑` / `↓`
- **Jump / Snap / Ollie:** `Space`
- **Grab / Bert Slide:** `Shift` / `E`
- **Respawn:** `X`
- **Camera / Music / Garage:** `C` / `M` & `N` / `Esc`
```

---

### Deutsche Version

```markdown
## Fahre echte LiDAR-gescannte Münchner Skateparks in 3D

**SRFSK8** bringt echtes Surfskate-Carving und authentische Pump-Physik direkt in deinen Browser – in realen Photogrammetrie- & LiDAR-Scans der Münchner Parks **Im Wiesengrund** und **Airport Skatepark**.

Baue Speed ganz ohne Pushen nur durch S-Turns und Pumpen in den Transitions auf, snappe am Coping, verkette Combos und kämpfe um Platz 1 im **Global Leaderboard**!

### Features
- **Echte Surfskate-Physik:** Rail-to-Rail-Carving, Bowl-Pumping, Bert Slides, Coping Grinds & Air Grabs.
- **2 echte gescannte Parks:** *Im Wiesengrund* (Nacht-Flutlicht) & *Airport Skatepark* (Golden Hour).
- **2 Skater & Setups:** Fahre als **Lukas** oder **Sophie** auf verschiedenen Surfskate-Boards.
- **Flow Line & Collectibles:** Folge dem Ghost Skater auf der Ideallinie, sammle Brezeln und weiche dem Scooter-Kid aus.
- **Globale Bestenliste:** Live-Highscores über alle Web-Plattformen hinweg.
- **Soundtrack & Web Audio SFX:** Realistischer Rollen-Sound auf Beton, Slide-Quietschen, Coping-Funken und 3 eigene Tracks.
- **Desktop & Mobile:** Tastatursteuerung sowie automatische Touch-Steuerung auf Smartphones/Tablets.

### Steuerung (Tastatur)
- **Carven Links / Rechts:** `A` / `D` oder `←` / `→`
- **Pumpen / Ducken:** `W` / `S` oder `↑` / `↓`
- **Snap / Ollie:** `Leertaste`
- **Grab / Bert Slide:** `Shift` / `E`
- **Respawn:** `X`
- **Kamera / Musik / Garage:** `C` / `M` & `N` / `Esc`
```

---

## 4. How Leaderboard & Assets Work on itch.io

- **Relative Asset Paths (`base: './'`):** When built via `npm run build:itch`, Vite emits `./assets/...` and the codebase resolves all models, LiDAR JSONs, textures, and audio relative to the itch.io CDN directory (`https://v6p9d9t4.ssl.hwcdn.net/html/<id>/`).
- **Live Global Leaderboard:** `src/services/LeaderboardService.ts` detects itch.io hostnames (`*.hwcdn.net`, `*.itch.zone`, `*.itch.io`) automatically and sends leaderboard requests to `https://surfsk8-game.vercel.app/api/leaderboard` (CORS `*` enabled), so itch.io players share the exact same live leaderboard as Vercel players.

---

## 5. Updating Your itch.io Build Later

### Option A: Web Upload (Manual)
1. Run `npm run build:itch`
2. Upload the newly generated `release/srfsk8-itch-html5.zip` in your itch.io Dashboard under **Edit Game -> Uploads** (replace the old file or delete it after the new one finishes processing).

### Option B: `butler` CLI (Fast Diff Updates)
If you install itch.io's official [`butler`](https://itch.io/docs/butler/) CLI:

```bash
# One-time login
butler login

# Build and push update directly to the html5 channel
npm run build:itch
butler push release/srfsk8-itch-html5.zip <your-itch-username>/srfsk8:html5
```

`butler` automatically diffs the ZIP contents and only uploads changed chunks, making updates take seconds.
