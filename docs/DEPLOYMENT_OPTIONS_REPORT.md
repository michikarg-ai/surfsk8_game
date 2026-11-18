# SRFSK8 — Game Deployment & Distribution Options Report

> **Issue:** [#26 — Investigation on game deployment options](https://github.com/michikarg-ai/surfsk8_game/issues/26)  
> **Project:** SRFSK8 (`surfskate-munich` v1.0.0)  
> **Date:** November 18, 2026  
> **Prepared for:** Michi Karg (`michi.karg@gmail.com`)

---

## 1. Executive Summary

**SRFSK8** is a 3D WebGL2 surfskate game built with **TypeScript (5.6)**, **Vite (5.4)**, **Three.js (0.170)**, and **cannon-es (0.20)**, using Web Audio for dynamic soundtracks and `localStorage` for client-side progression and settings. Because the entire engine runs on standard browser APIs without a native C++ runtime, **you do not need to rewrite the game** to ship on mobile, macOS, Windows, or gaming storefronts like Steam and itch.io.

However, shipping a browser-native 3D game to app stores and PC gaming platforms carries specific packaging, performance, input, and store-review requirements. Most critically, a technical audit of the current repository reveals that **`npm run build` currently emits a 1.5 GB `dist/` directory** because raw photogrammetry `.usdz` and intermediate `.glb` files reside inside `public/models/`. Separating raw source scans from runtime assets reduces the actual shipping payload to **~70–85 MB** (core game) or **~115 MB** (including optional Pumptrack Aschheim assets).

### Quick-Glance Comparison Matrix

| Platform / Store | Recommended Tech Stack | Dev Effort | Upfront Fees | Store Rev Share | Final App Size | Strategic Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Web / itch.io** | Vite static ZIP (`base: './'`) | **0.5 – 1 day** | **$0** | **0% – 10%** (creator choice) | ~85 MB ZIP | **Phase 1 (Immediate):** Zero friction, instant community feedback. |
| **Mobile PWA** | Vite + `vite-plugin-pwa` (Service Worker) | **1 – 2 days** | **$0** | **0%** | ~85 MB cached | **Phase 1 (Immediate):** Bypass App Store fees; offline-capable on iOS/Android. |
| **Web Portals (Poki / CrazyGames)** | Vite + Portal SDK + lazy-load parks | **3 – 5 days** | **$0** | **~50%** (Ad share) | < 30 MB initial | **Optional:** Best monetization for free browser traffic. |
| **Steam (Win / macOS / Steam Deck)** | Electron or Tauri 2.0 + `steamworks.js` + Gamepad API | **7 – 12 days** | **$100** (recoupable at $1k rev) | **30%** (25% >$10M) | ~100–210 MB | **Phase 2 (Highest ROI):** Core PC gamer audience, Achievements, Cloud Saves. |
| **Windows (Direct / MS Store)** | Tauri 2.0 (WebView2) or Electron + MSIX / NSIS | **4 – 7 days** | **$19–$99** (MS Store) or **$200–400/yr** (Code Sign) | **12%** (MS Store games) / **0%** (Direct) | ~95 MB (Tauri) / ~205 MB (Electron) | **Phase 2:** Piggybacks directly on the Steam desktop build. |
| **Mac App Store (macOS)** | Tauri 2.0 (WKWebView) or Swift WKWebView + Sandbox | **5 – 8 days** | **$99 / yr** (Apple Dev) | **30%** (15% Small Biz) | ~95 MB (Tauri) | **Phase 2/3:** Clean Apple Silicon binary, strict Sandbox & Notarization. |
| **Mobile Native (iOS & Android)** | Capacitor 6/7 + Haptics + Game Center / Play Games | **8 – 14 days** | **$99/yr** (Apple) + **$25** (Google once) | **30%** (15% Small Biz) | ~90–105 MB | **Phase 3:** Touch controls & Safe-Area CSS already exist; Guideline 4.2 risk needs native polish. |
| **Native Rewrite (Unity / Unreal / Consoles)** | Full engine port (C# / C++) | **8 – 16 weeks** | Console devkits + fees | **30%** | N/A | **Not Recommended:** Disproportionate cost unless targeting Switch/PS5/Xbox. |

---

## 2. Technical Audit of SRFSK8 (Current Codebase Baseline)

Before estimating any wrapper or store submission, the table below summarizes the exact technical footprint observed in the repository (`package.json`, `vite.config.ts`, `index.html`, `src/`, and `dist/`):

| Technical Dimension | Current Implementation in SRFSK8 | Impact on Packaging & Porting |
| :--- | :--- | :--- |
| **Core Engine & Build** | `typescript@5.6.3`, `vite@5.4.10`, `three@0.170.0`, `cannon-es@0.20.0` | Pure client-side WebGL2 + JS. Zero backend server dependencies. |
| **JS / HTML Bundle** | `dist/index.html`: **145.30 kB** (24.4 kB gzip)<br>`dist/assets/index-*.js`: **890.45 kB** (232.9 kB gzip) | Lightweight code footprint (~1.04 MB uncompressed). Fast startup once assets are local. |
| **Asset Bloat Risk (`public/`)** | `public/models/` is **1.4 GB** on disk (`dist/` currently outputs **1.5 GB**) due to git-ignored raw photogrammetry files (`.usdz` up to 330 MB, raw `.glb` up to 192 MB). | **Critical Blocker:** Must relocate raw scans out of `public/` before building any app bundle. |
| **Active Runtime Assets** | **Models:** `skater.glb` (8.1 MB), `skater_female.glb` (9.5 MB), `skatepark_multi.glb` (19 MB), `airport_skatepark_game.glb` (10 MB), LiDAR JSONs (~675 KB) [+ optional `pumptrack_aschheim.glb` (32 MB)].<br>**Audio:** 5 MP3 tracks in `public/audio/` (**20.1 MB**).<br>**Textures/Env/Fonts:** ~15 MB active (`autumn_field_puresky_2k.hdr` 4.2 MB, 4K park JPEGs, background JPEG, `.woff2` fonts). | **Net Active Payload:** **~83 MB** (core 2 parks) or **~115 MB** (with Aschheim). Fits cleanly inside Google Play AAB (200 MB base limit), iOS App Store (4 GB limit, 200 MB cellular tip), and desktop installers. |
| **URL Routing (`base`)** | `vite.config.ts` has no `base` set (defaults to `/`). `index.html`, `LandingPage.ts`, `ImGefildeScene.ts`, `ParkSurface.ts` fetch root-absolute paths (`/models/...`, `/textures/...`, `/fonts/...`). | Works in `capacitor://localhost` and `tauri://localhost`, but **breaks** on itch.io subpaths or Electron `file://` unless `base: './'` and relative paths are used. |
| **Controls & Input** | Keyboard (`Arrows`/`WASD`) + full `TouchControls.ts` (auto-detected). **No Gamepad API (`navigator.getGamepads()`) implemented.** | Mobile touch UI is ready; **Gamepad support must be added** for Steam, Steam Deck, and desktop gaming credibility. |
| **Mobile Viewport & Audio** | `viewport-fit=cover`, `100dvh`/`-webkit-fill-available`, `env(safe-area-inset-*)` CSS, and `AudioContext` gesture unlock (`SurfAudio.ts`) are **already implemented**. | Saves ~3–4 days of mobile CSS/audio debugging right out of the box. |
| **Persistence & Analytics** | `localStorage` (`surfsk8.*` keys for progression, ghost runs, settings). `@vercel/analytics` (`inject`, `track`) active in `main.ts` and `PretzelCollectibles.ts`. | `localStorage` works offline, but needs Cloud Save hooks for Steam/Apple/Google. `@vercel/analytics` must be gated off in offline native builds. |

---

## 3. Detailed Investigation by Distribution Channel

### Option A: Mobile App (Android & iOS)

#### Evaluated Approaches
1. **PWA (Progressive Web App — Installable Web App):**
   - **How it works:** Add `vite-plugin-pwa`, a `manifest.webmanifest`, app icons, and a Service Worker (Workbox) that precaches the ~83 MB runtime assets locally. Users install directly from Safari ("Add to Home Screen") or Chrome.
   - **Effort:** **1 – 2 days (8 – 14 hours)**.
   - **Cost:** **$0** store fees.
   - **Pros / Cons:** Zero App Store review risk, instant updates, works offline after first load. Downside: No App Store / Play Store search discoverability, and iOS Safari imposes stricter storage eviction if unused for weeks.
2. **Capacitor (Ionic) Hybrid Native Wrapper — *Recommended for App Stores*:**
   - **How it works:** Wraps `dist/` inside a native iOS (`WKWebView`) and Android (`Android System WebView` / Chromium) shell via `@capacitor/core`, `@capacitor/ios`, and `@capacitor/android`. Serves local assets over `capacitor://localhost` / `https://localhost`, enabling 100% offline play with zero network latency for the 70–85 MB GLB/audio payload.
   - **Effort:** **8 – 14 days** (first-time setup, native plugins, Xcode/Android Studio builds, performance tuning, and store submission).
   - **Cost:** **$99/year** (Apple Developer Program) + **$25 one-time** (Google Play Console).
3. **Native Rewrite (Unity / Unreal / Swift Metal):**
   - **Effort:** **8 – 16 weeks**. Completely uneconomical given Three.js + cannon-es physics already work.

#### SRFSK8-Specific Mobile Technical Risks & Mitigations
- **iOS `WKWebView` Memory Ceiling (High Risk):** iOS terminates WebKit content processes when GPU/RAM usage spikes (typically around ~1.0–1.5 GB total process footprint on 4 GB iPhones). Currently, SRFSK8 uses 4K JPEG park textures (`skatepark_multi_tex0.jpg`, `airport_skatepark_tex0.jpg`) + a 2K HDR environment (`autumn_field_puresky_2k.hdr`) + uncompressed GLB meshes. Uncompressed 4K textures decompress to ~64 MB VRAM *each*, and simultaneous scene/landing-page WebGL contexts multiply memory pressure.
  - *Mitigation:* Dispose Landing Page renderer when entering gameplay, expose a Mobile/Low texture preset (downscaling 4K textures to 2K or KTX2/Basis Universal GPU compression), and limit `devicePixelRatio` to `Math.min(window.devicePixelRatio, 2)`.
- **Apple App Store Review Guideline 4.2 (*Minimum Functionality*):** Apple routinely rejects apps that feel like *"repackaged websites"*. A bare `WKWebView` wrapper loading SRFSK8 without native OS integration carries significant rejection risk.
  - *Mitigation:* Bundle all ~85 MB assets locally (works in Airplane Mode), integrate `@capacitor/haptics` (tactile feedback on snaps, landings, and pretzel pickups), `@capacitor/status-bar` / `@capacitor/screen-orientation` (lock landscape or clean portrait/landscape handling), and native **Apple Game Center / Google Play Games** leaderboards + achievements.
- **Google Play 150–200 MB AAB Limit & Target API:** Moving raw `.usdz`/`.glb` scans out of `public/` keeps the Android App Bundle well under Google Play's 200 MB base limit without needing Play Asset Delivery.
- **Already Solved in SRFSK8:** `TouchControls.ts`, `env(safe-area-inset-*)`, `viewport-fit=cover`, and `SurfAudio.ts` Web Audio unlock are already implemented.

---

### Option B: Mac App Store (macOS)

#### Evaluated Approaches
1. **Tauri 2.0 (`WKWebView` + Rust Core) — *Recommended*:**
   - **How it works:** Bundles `dist/` into a native macOS `.app` using the system's built-in Apple WebKit (`WKWebView`) instead of shipping Chromium.
   - **Binary Size:** Tauri runtime adds only **~8–10 MB**; total `.app` size with SRFSK8 runtime assets is **~95 MB**.
   - **Effort:** **5 – 8 days** (including Apple Sandbox, Notarization, App Store Connect metadata, and testing).
2. **Electron (Bundled Chromium + Node.js):**
   - **Binary Size:** Ships full Chromium (~120 MB overhead) -> **~205–220 MB** `.app`.
   - **Effort:** **5 – 8 days**. Slightly easier WebGL predictability across macOS versions (no Safari WebGL quirks), and slightly higher Mac App Store Sandboxing friction (`mas` target requires stripping non-MAS APIs and careful helper-process entitlements).
3. **Native Swift / `WKWebView` App (~100 lines Swift):**
   - **Binary Size:** ~85–90 MB. Low overhead, zero third-party framework, but Mac-only (cannot be reused for Windows/Steam).

#### Mac App Store Specific Requirements
- **Cost:** **$99/year** (same Apple Developer Program membership as iOS; 15% Small Business Program commission vs. standard 30%).
- **App Sandbox & Hardened Runtime:** Mandatory for Mac App Store (`com.apple.security.app-sandbox`). Since SRFSK8 only renders WebGL, plays local audio, and uses `localStorage`, no sensitive entitlements (camera/mic/file-picker) are needed. External links (such as the Instagram link in `LandingPage.ts`) must open cleanly via the system default browser (`tauri-plugin-shell` / `NSWorkspace`).
- **Code Signing & Apple Notarization:** Required both for Mac App Store (`3rd Party Mac Developer Application` + `Installer` certs) and for direct `.dmg` distribution (`Developer ID Application` + `xcrun notarytool`).
- **Apple Silicon & Universal Binary:** Must compile as Universal (`arm64` + `x86_64`) or `arm64` (Apple Silicon) via `cargo tauri build --target universal-apple-darwin`.
- **Input Expectation:** Mac desktop users expect Keyboard + **Gamepad (Xbox/PlayStation controllers via Bluetooth)**; adding the standard Web Gamepad API works automatically inside both `WKWebView` and Electron.

---

### Option C: Windows Desktop App

#### Evaluated Approaches
1. **Tauri 2.0 (Microsoft Edge WebView2):**
   - **How it works:** Uses Chromium-based Edge WebView2 pre-installed on Windows 10/11.
   - **Binary Size:** **~90–100 MB** installer (NSIS `.exe` or `.msi` / MSIX).
   - **WebGL Performance:** Because WebView2 *is* Edge/Chromium under the hood, Three.js WebGL2 performance matches desktop Chrome/Edge almost identically. Minor edge case: older Windows machines occasionally run WebView2 on software/integrated GPU unless `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` or high-performance GPU flags are configured.
2. **Electron (Bundled Chromium):**
   - **Binary Size:** **~200–220 MB** installer.
   - **WebGL Performance:** Completely deterministic Chromium version with full command-line GPU flag control (`--ignore-gpu-blocklist`, `--enable-webgl`), zero dependency on user OS WebView2 state.
3. **Distribution Channels on Windows:**
   - **Direct Installer (`.exe` / NSIS / Inno Setup):** **$0** store fee, **0%** rev share, **3 – 5 days** effort. **Major Caveat:** Unsigned `.exe` installers trigger intimidating **Windows Defender SmartScreen ("Windows protected your PC")** warnings. Mitigating this requires an Authenticode Code Signing certificate (**~$200–$400/year** via DigiCert/Sectigo/SSL.com or Azure Trusted Signing ~$9.99/mo where eligible).
   - **Microsoft Store (MSIX Package):** **$19 one-time** (individual) or **$99** (company), **12% revenue share** for PC games (or 0% if using own commerce), **4 – 7 days** effort. **Huge Advantage:** Microsoft signs MSIX packages from the Store automatically — **zero SmartScreen warnings** and no external code-signing certificate cost!

---

### Option D: Gaming Platforms (What Gamers Actually Use)

Most PC/indie players do not look for games on the Mac App Store or Microsoft Store. The dominant ecosystems for an indie 3D action-sports game like SRFSK8 are:

#### 1. Steam (Steamworks) — *Primary PC/Mac Storefront*
- **Costs & Revenue Share:** **$100 Steam Direct fee** per game (recouped automatically once the game reaches $1,000 in gross revenue). **30% standard revenue share** (drops to 25% above $10M and 20% above $50M).
- **Technical Integration for SRFSK8:**
  - **Wrapper:** **Electron** (most battle-tested for Steamworks JS games) or **Tauri 2.0** (using `steamworks-rs` Rust crate). With Electron, the community package `steamworks.js` provides clean TypeScript bindings for the Steamworks C++ SDK.
  - **Core Steam Features to Add:**
    1. **Gamepad / Steam Input Support (`navigator.getGamepads()`):** Essential for controllers and **Steam Deck**.
    2. **Steam Overlay Compatibility:** Requires GPU-accelerated rendering without exclusive fullscreen glitches (borderless fullscreen works reliably in Electron/Tauri).
    3. **Steam Achievements & Cloud Saves:** Bridge `SurfProgression.ts` / `FlowLineChallenge.ts` (`localStorage`) to Steam Cloud (`ISteamRemoteStorage`) and unlock Steam Achievements on Rank-ups, Flow Lines, and Highscores.
    4. **Steam Deck & Proton:** A Windows Electron/Tauri build runs well via Valve's Proton compatibility layer, or you can ship a native Linux build (`AppImage`/binary). Shipping at **1280×800** cleanly with controller glyphs makes **Steam Deck Verified** realistic.
- **Effort:** **7 – 12 days** (Desktop wrapper + `steamworks.js` integration + Gamepad API + Steamworks store page, capsule art, build Depot upload via `steamcmd`, and Valve build review ~3–5 business days).

#### 2. itch.io — *Fastest Zero-Cost Indie Launchpad*
- **Costs & Revenue Share:** **$0 upfront**. Open revenue share (**default 10%, configurable down to 0%**).
- **Technical Integration:** Run `vite build` (with `base: './'` and cleaned `public/`), zip `dist/`, and upload as an **HTML5 Playable-in-Browser** build (or downloadable Win/Mac builds).
- **Effort:** **0.5 – 1 day (< 4 hours once `public/` is cleaned)**.
- **Best Use:** Immediate soft-launch, collecting player feedback on skate physics/parks, devlogs, and testing builds before paying Steam's $100 fee. *(Note: Keep HTML5 ZIP below itch.io's recommended size limits — ideally under 150–200 MB; our cleaned ~85 MB build fits comfortably).*

#### 3. Web Game Portals (Poki, CrazyGames, GameDistribution)
- **Costs & Revenue Share:** **$0 upfront**; typically **50% ad/IAP revenue share** (or fixed licensing/exclusivity deals on Poki).
- **Technical Fit:** Browser-native Three.js games are their bread and butter—zero download friction drives massive casual reach.
- **Effort:** **3 – 5 days**. Requires integrating the portal's lightweight JS SDK (ad triggers between 2-minute runs, mute/pause hooks), removing outbound external links (like the Instagram callout in `LandingPage.ts`), and **reducing initial load size** (< 25–30 MB for initial Garage + 1 park, lazy-loading additional parks/audio tracks on demand).

#### 4. Epic Games Store & Consoles (Context)
- **Epic Games Store:** Opened self-publishing (**$100 fee per product**, **12% rev-share**). Uses the exact same packaged Windows/Mac Electron or Tauri build as Steam, swapping `steamworks.js` for Epic Online Services (`EOS`) if achievements are desired (+3–4 days on top of Steam).
- **Consoles (Nintendo Switch, PS5, Xbox):** **Not viable** with Three.js/WebGL because console SDKs prohibit uncompiled JIT browser engines / WebGL wrappers. Requires a full engine rewrite in Unity, Unreal, or Godot (**8–16+ weeks**, plus NDA devkit approval).

---

## 4. Mandatory Pre-Deployment Engineering Checklist (All Platforms)

Before targeting *any* platform beyond Vercel web hosting, five foundational cleanups are required in the SRFSK8 repository:

1. **Separate Raw Photogrammetry Scans from `public/` (Critical):**
   Move the ~1.4 GB of `.usdz`, raw `.glb`, and unused `skatepark_multi_tex0.png` (17 MB) out of `public/` into `data/raw_assets/` (or similar). Verify `dist/` drops from **1.5 GB** to **~85 MB**.
2. **Switch to Relative Asset Paths (`base: './'`):**
   Configure `base: './'` in `vite.config.ts` and replace leading `/` asset strings in `index.html`, `LandingPage.ts`, `ImGefildeScene.ts`, `ParkSurface.ts`, and `SkaterVisuals.ts` (matching the `resolveUrl` pattern already used in `SurfAudio.ts`) so the game works in Electron `file://`, itch.io subpaths, and Capacitor/Tauri.
3. **Gate `@vercel/analytics` for Offline / Native Builds:**
   Guard `inject()` and `track()` behind a build-time env flag (`import.meta.env.VITE_PLATFORM === 'web'`) so offline desktop/mobile builds do not attempt external telemetry calls (critical for App Store privacy declarations and offline play).
4. **Implement Web Gamepad API (`navigator.getGamepads()`):**
   Map left stick to carving/steering, triggers/bumpers to pumping/crouching and grabs, and face buttons to snaps/reverses/UI navigation. Required for Steam, Steam Deck, Mac, and Windows.
5. **Abstract Persistence (`StorageAdapter`):**
   Wrap `localStorage` (`surfsk8.*`) behind an async adapter interface so Steam Cloud, Apple iCloud/Game Center, or Capacitor Preferences can plug in cleanly without rewriting `SurfProgression.ts` or `FlowLineChallenge.ts`.

---

## 5. Product Owner Recommendation & Phased Roadmap

Rather than tackling all platforms simultaneously, **SRFSK8 should follow a 3-Phase rollout** that validates gameplay engagement first and reuses each technical milestone for the next platform:

### Phase 1: Instant Web Validation & Mobile Offline (Days 1–3 | $0 Cost)
- **Actions:** Complete the 5-item Pre-Deployment Cleanup (especially shrinking `dist/` from 1.5 GB -> ~85 MB), add PWA support (`vite-plugin-pwa`), and publish an HTML5 build on **itch.io**.
- **Outcome:** Immediate offline-capable mobile installability via PWA + zero-cost indie distribution on itch.io to gather telemetry and physics/engagement feedback (aligns with `GAME_ENGAGEMENT_CONCEPT.md` Issue #16).

### Phase 2: PC / Mac Gamer Launch via Steam (+ Windows / macOS Direct) (Weeks 2–4 | $100 Steam Fee)
- **Actions:** Add **Gamepad API** support, wrap the cleaned build in **Electron + `steamworks.js`** (or **Tauri 2.0** if prioritizing ~95 MB binary size over `steamworks.js` maturity), add Steam Achievements + Cloud Saves, and target **Steam** (Windows + macOS + Steam Deck) as the primary storefront.
- **Bonus Output:** From the exact same desktop pipeline, export a **Microsoft Store MSIX** ($19 fee, avoids Windows SmartScreen certificate costs) and optionally submit to **Epic Games Store** ($100 fee, 12% rev-share).

### Phase 3: Native Mobile App Stores — iOS & Android (Weeks 5–7 | $124 Combined Fees)
- **Actions:** Wrap with **Capacitor**, optimize textures for `WKWebView` memory limits (2K mobile textures / KTX2), add `@capacitor/haptics`, and integrate **Apple Game Center / Google Play Games** achievements & leaderboards so the app cleanly clears Apple **Guideline 4.2** review. Submit to Google Play ($25) and Apple App Store ($99/yr), followed optionally by the **Mac App Store** using the same Apple Developer membership.
