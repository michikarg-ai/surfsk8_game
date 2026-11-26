# Machbarkeits- & Lizenz-Analyse: Meshy-AI-Modell „Venice Park“ für SRFSK8

> **Issue:** [#43 — Investigate use of Venice Park model](https://github.com/michikarg-ai/surfsk8_game/issues/43)  
> **Untersuchtes Modell:** `https://www.meshy.ai/posts/019f3e25-b56b-76b1-bea3-8cf283fdd953`  
> **Stand:** November 2026  
> **Hinweis vorab:** Der konkrete Meshy-Post (`019f3e25-b56b-76b1-bea3-8cf283fdd953`) ist in der Websuche **nicht indexiert** (vermutlich dynamisch gerenderte SPA-URL oder neuer Community-Post). Die folgende Bewertung stützt sich daher auf die offiziellen **Meshy.ai Terms of Use / Community Guidelines**, die Rechtslage rund um den **Venice Beach Skatepark** sowie eine **Code-Analyse der SRFSK8-Engine & -Pipeline**.

---

## Executive Verdict (Ampel-Bewertung)

| Bereich | Ampel | Kurzfazit |
| :--- | :---: | :--- |
| **1. Meshy-Lizenz & Nutzung** | 🟡 **GELB** | **Grundsätzlich nutzbar** (Community-3D-Modelle stehen laut Meshy-ToS unter **CC0**, Free-Plan-Generierungen unter **CC BY 4.0** inkl. kommerzieller Web-/itch.io-Nutzung). **Aber:** Wir kennen weder die Download-Freigabe noch die Herkunft des Inputs (*Text-to-3D* vs. fremdes *Image-to-3D*-Foto). |
| **2. Real-World IP (Venice Beach)** | 🟡 **GELB** | Der reine Skatepark-Beton ist rechtlich meist unkritisch (`17 U.S.C. § 120(a)` / US-Ausschluss nicht bewohnbarer Landschaftsbauten; in DE `§ 59 UrhG` für Spielgrafik). **Stolperfallen:** Erkennbare **Graffiti/Murals** (z. B. *Venice Art Walls*), **Stadt-LA-Logos** und die direkte Nutzung des offiziellen Namens **„Venice Beach Skatepark“** (besser generisch benennen). |
| **3. Technische Eignung für SRFSK8** | 🔴 **ROT / ORANGE** | **Für unsere Surfskate-Physik ungeeignet ohne massives Rework.** `ParkSurface.ts` & `SurfskateController.ts` benötigen ein rauschfreies, C2-glattes 2,5D-Höhenfeld mit sauber definierten Bowl-Radien. AI-Umgebungs-Meshes von Meshy haben typischerweise wellige Oberflächen, verschmolzene Props (Bäume/Rails im Raycast), Überhang-Artefakte und verwaschene Nahbereichs-Texturen. |

### Gesamtempfehlung in einem Satz
**Das Meshy-Modell höchstens als visuelle Referenz / Ideen-Blockout nutzen – nicht als direktes Spiel-Asset.** Für einen Beach-Bowl in SRFSK8 ist ein **sauber in Blender modellierter, von Venice Beach inspirierter Bowl** (z. B. *„Pacific Beach Bowl“*) qualitativ um Welten besser, rechtlich zu 100 % sauber und am Ende sogar **schneller** sauber fahrbar zu machen als das Reparieren eines verrauschten AI-Meshes.

---

## 1. Lizenz & Copyright (Meshy.ai & Venice Beach)

### 1.1 Meshy.ai Terms of Use & Community-Posts

Bei Meshy muss man sauber zwischen **eigenen privaten Generierungen** und **öffentlichen Community-Posts (`/posts/<id>`)** unterscheiden:

1. **Öffentliche Community-Posts (`meshy.ai/posts/...`):**
   - Laut Meshy’s *Terms of Use* („Community Content“) werden 3D-Modelle (*Customer Output*), die Nutzer öffentlich auf der Meshy-Community-Seite posten, unter **CC0 1.0 Universal (Public Domain Dedication)** für die Öffentlichkeit lizenziert.
   - Das bedeutet grundsätzlich: Herunterladen (sofern technisch freigegeben), Bearbeiten in Blender und **kommerzielle Nutzung** in Browser-Spielen (Vercel, **itch.io**, Steam etc.) sind ohne Lizenzgebühren erlaubt.
   - **Achtung bei Begleitmaterial:** Alle *anderen* vom Nutzer im Community-Post hochgeladenen Inhalte (z. B. hochgeladene Referenzbilder) stehen laut Meshy-ToS nur unter **CC BY-NC 4.0** (*Non-Commercial*!).
2. **Falls das Modell über Free-Plan / CC BY 4.0 lizenziert ist:**
   - Eigenständige Free-Plan-Generierungen (oder Assets, die explizit unter CC BY 4.0 stehen) erlauben ebenfalls **kommerzielle Nutzung** (auch für Paid-Releases oder `$0 or donate` auf itch.io), verlangen aber eine **zwingende Namensnennung (Attribution)** – Meshy empfiehlt z. B.:
     > *"Model created with Meshy – CC BY 4.0 License"* (plus Hinweis auf Modifikationen und ggf. den Creator-Namen).
   - *Hinweis für spätere Stores:* Während Vercel und **itch.io** mit CC BY 4.0 problemlos funktionieren, akzeptieren manche restriktive Asset-Stores/Partner keine CC-BY-Pflichten. (Nur **Paid Plans** wie Pro/Studio gewähren private Eigentumsrechte ohne Attribution).
3. **Fremder Creator & das „Input-Material-Risiko“ (wichtig!):**
   - Wenn der Post `019f3e25-b56b-76b1-bea3-8cf283fdd953` von einem **dritten Nutzer** stammt, überträgt CC0/CC BY 4.0 nur die Rechte, die dieser Nutzer selbst besitzt.
   - **Kritische Gefahr bei Image-to-3D:** Hat der Creator das Modell aus einem fremden urheberrechtlich geschützten Foto (z. B. Drohnenfoto eines Fotografen, Street-Art-Bild) generiert, **heilt** die Meshy-Lizenz diese Drittrechte nicht. Bei reinem *Text-to-3D* besteht dieses Foto-Risiko nicht.
4. **Urheberrecht an KI-3D-Modellen (USCO & deutsches UrhG):**
   - Nach aktueller USCO-Praxis und deutschem Urheberrecht (§ 2 Abs. 2 UrhG, Erfordernis menschlicher Schöpfung) sind **rein KI-generierte 3D-Meshes nicht urheberrechtsfähig** (kein Schutz durch bloßes Prompting).
   - Erst durch wesentliche eigene Nachbearbeitung in Blender (Retopology, Smoothing, eigene Texturen/Graffiti) entstehen schutzfähige eigene Beiträge (*Hybrid Work*). Fehlender KI-Schutz bewahrt aber **nicht** vor Drittrechten (Marken/Graffiti/Quellfotos).

> **Manueller Check auf der Meshy-Seite (falls wir es überhaupt testen wollen):**  
> Da der Post nicht indexiert ist, müsste man im Browser kurz prüfen: (1) Ist der **Download-Button** (.glb/.obj) aktiv? (2) Welcher **Lizenzhinweis** steht direkt am Post (CC0 vs. CC BY 4.0)? (3) Wurde es per **Text-to-3D** oder **Image-to-3D** (mit fremdem Foto?) erstellt?

---

### 1.2 Real-World IP, Markenrecht & Architektur: Venice Beach Skatepark

*Fakten zum Original:* Der reale **Venice Beach Skatepark** (offiziell *Dennis „Polar Bear“ Agnew Memorial Skatepark*, eröffnet Ende 2009, ~16.000 sq ft / ~1.500 m²) liegt auf öffentlichem Grund der **City of Los Angeles Department of Recreation and Parks (RAP)**, wurde von **RRM Design Group / Zack Wormhoudt** (mit lokalen Skatern) entworfen und von **California Skateparks** gebaut.

1. **Architektur-Urheberrecht:**
   - **USA (`17 U.S.C. § 120(a)`):** Erlaubt visuelle Darstellungen (*pictorial representations*) von öffentlich sichtbaren Bauwerken in Medien/Spielen. Zudem beschränkt das US-Copyright-Recht „Architectural Works“ grundsätzlich auf **bewohnbare Gebäude** (*humanly habitable structures*) – Beton-Skateparks, Gehwege und Landschaftselemente genießen dort in der Regel keinen Architekturschutz.
   - **Deutschland (`§ 59 UrhG` Panoramafreiheit):** Für rein zweidimensionale/filmische Spielgrafiken greift oft die Panoramafreiheit, bei 3D-Nachbauten gibt es zwar strengere Auslegungen (und das Schutzlandprinzip gilt), aber ein **stilisiertes KI-Modell** kopiert weder Baupläne noch exakte Maße 1:1.
2. **Drei echte rechtliche Stolperfallen (Muss-Checkliste):**
   - **Graffiti, Murals & Street Art (HOHES RISIKO):** Weder `§ 120(a)` noch `§ 59 UrhG` decken eigenständige Kunstwerke/Murals ab (in unmittelbarer Nähe zum Venice Skatepark liegen die weltbekannten *Venice Beach Public Art Walls*). Falls das Meshy-Mesh erkennbare reale Murals oder Tags in der Textur hat, **müssen diese zwingend entfernt/übermalt werden** (analog unserer bereits erprobten Blender-Multi-View-Inpainting-Pipeline aus `.agents/skills/skatepark-3d-pipeline/SKILL.md`).
   - **Städtische Logos / Schilder / Sponsoren:** Schilder von *LA Recreation & Parks*, reale Strandbuden-Marken oder Logos gehören entfernt.
   - **Namensgebung („Venice Beach Skatepark“ vs. fiktiver Name):**
     - Zwar schützt in den USA die *Rogers v. Grimaldi*-Rechtsprechung (z. B. *E.S.S. Entertainment v. Rockstar Games*) künstlerische Werke vor Markenrechtsklagen bei realen Ortsbezügen, solange keine offizielle Partnerschaft vorgetäuscht wird.
     - Dennoch hat selbst Rockstar Games Venice Beach in *GTA* bewusst in **„Verona Beach“** umbenannt – und auch spielerisch wäre „Venice Beach Skatepark“ bei einem ungenauen KI-Mesh irreführend (Spieler erwarten unter dem echten Namen den exakten Snake Run und die exakten Pools).
     - **Empfehlung:** Generischer/inspirierter Name wie **`Pacific Concrete Bowl`**, **`Boardwalk Beach Bowl`** oder **`Venice-Style Beach Bowl`** (Subtitel: *„Inspired by SoCal Beach Bowls“*).

---

## 2. Technische Machbarkeit in SRFSK8 (Three.js + `ParkSurface`)

### 2.1 Wie SRFSK8-Parks technisch funktionieren

Im Gegensatz zu Spielen mit Standard-Mesh-Collidern nutzt SRFSK8 eine **physikalisch hochsensible 2,5D-Höhenfeld-Architektur**:

1. **Heightfield statt Triangle-Mesh-Physik (`src/physics/ParkSurface.ts`):**
   - Jeder Park benötigt zusätzlich zum optischen `.glb` eine **LiDAR-/Raycast-Höhenkarte** (`LidarGridPayload` als `.json`, z. B. `im_gefilde_lidar.json` mit 241×201 Punkten / 304 KB, `airport_skatepark_lidar.json` mit 201×253 Punkten / 371 KB).
   - `ParkSurface.evaluateHeight(x, z)` interpoliert bilinear; `ParkSurface.sample(x, z)` berechnet per zentraler Finiter Differenz (`eps = 0.42 m`) die Steigungen **`slopeX`, `slopeZ`**, die **`curvature`** und die Flächennormale **`normal`**.
   - **Keine Überhänge möglich:** Ein Heightfield speichert exakt **eine** Höhe `y` pro `(x, z)`-Punkt. Echte Over-Vert-Tunnel, Brücken oder schwebende Rails lassen sich darüber nicht abbilden.
2. **Empfindlichkeit der Surfskate-Physik (`src/physics/SurfskateController.ts`):**
   - `computeGradeAlongHeading()` tastet Steigungen mit `e = 0.3 m` ab.
   - Die energieerhaltende Geschwindigkeitsintegration (`v1² = v0² + 2·a_extra·s − 2·g·Δh`), das **Wall-Pumping** (`WALL_PUMP_GAIN`, `isOnWall` ab `h0 >= 0.18 || slopeMag >= 0.12`), **`Perfect Pump`** (`h0 > 0.35 && sinT < -0.08`) und das **`SnapWindow`** (`h >= 0.55 && slopeMag >= 0.18`) reagieren extrem empfindlich auf die Stetigkeit und Glätte der Oberfläche!

### 2.2 Konkrete Risiken eines Meshy-AI-Skateparks

| Technisches Problemfeld | Typisches Verhalten bei Meshy-AI-Umgebungen | Konkrete Auswirkung in SRFSK8 |
| :--- | :--- | :--- |
| **1. Oberflächen-Rauschen („Micro-Noise“)** | AI-Meshes bilden Betonflächen selten plan ab; statt ebener Slabs und glatter Radien entstehen wellige Triangulierungen. | Schon 3–5 cm Wellen erzeugen bei `eps = 0.30–0.42 m` falsche `slopeMag`-Werte: das Board wackelt (`pitchAngle`), verliert Pump-Energie, bremst unlogisch ab oder triggert Phantom-Walls. |
| **2. Verschmolzene Props & falsche Raycast-Treffer** | Meshy generiert Park + Umgebung (Palmen, Zäune, Laternen, Bänke, Treppen) oft als **einen verschmolzenen Mesh-Klumpen** oder mit geschlossenen/abgeflachten Bowl-Mulden. | Unsere Pipeline (`bake_airport_skatepark.py`) raycastet von oben nach unten (`BVHTree.ray_cast` ab `z = 10.0`). Steckt eine Palme oder ein Zaun im Mesh, landet im JSON eine **3 m hohe unsichtbare Betonsäule**. |
| **3. Fehlende Maßstabstreue & Fahrbarkeit** | AI-Meshes haben willkürliche Einheiten (z. B. 1–2 Units groß) und unskalierte Proportionen (zu enge Bowls, zu steile/eckige Kanten). | Unsere Physik ist auf reale Meter kalibriert (`MAX_SPEED = 9.5 m/s` bei `TIME_SCALE = 0.75`). Zu kleine Bowls oder knickige Transitions machen Carven/Snaps unspielbar. |
| **4. Textur-Matsche & eingebrannte Schatten** | AI-Texturen (meist 1K–2K) sehen aus der Vogelperspektive gut aus, wirken aber in unserer nahen Skater-Kamera matschig, verzerrt (UV-Stretching an Wänden) und enthalten **eingebrannte Schatten**. | `ImGefildeScene.ts` rendert Parks mit `MeshStandardMaterial` (`roughness: 0.78`) unter dynamischer Golden-Hour- oder Nachtbeleuchtung – eingebrannte AI-Schatten beißen sich dann mit den echten Lichtern. |
| **5. Dateigröße & Mobile/itch.io-Budget** | Unoptimierte AI-Meshes (oft 50k–250k+ Tris + unkomprimierte PNGs) blähen das GLB auf. | Für **itch.io** (`srfsk8-itch-html5.zip` ~105 MB) und **iOS `WKWebView`** (4K-Texturen belegen ~64 MB VRAM unkomprimiert!) halten wir Parks schlank (**10–19 MB GLB** + **1,5–3,1 MB JPG**). |

### 2.3 Wie eine Integration in SRFSK8 trotzdem ablaufen müsste

Wollte man das Meshy-GLB unbedingt integrieren, wären zwei Phasen nötig:

1. **Phase A — Blender-Rettungs-Pipeline (~1–3 Tage, mit Qualitätsrisiko):**
   - **Inspektion & Trennung:** Prüfen, ob Bowls tief & offen sind; alle Nicht-Boden-Objekte (Palmen, Zäune, Deko) manuell per `bmesh`/Edit-Mode vom **Collider-Mesh** abtrennen.
   - **Skalierung & Nivellierung:** Skalieren auf realistische ~35–50 m Grundfläche (Bowl-Tiefe ~1,5–2,8 m) und Planieren der Flatground-Ebene analog `scripts/smooth_multi_park.py`.
   - **Taubin-Smoothing & Normal-Cleanup:** UV-Seam-Vertices verschweißen, nicht-schrumpfendes Taubin-Fairing (`λ = 0.45, μ = -0.472`) anwenden, lumpy AI-Normal-Maps entfernen, Textur ggf. neu aufbereiten/komprimieren (4K/2K JPG) und reale Murals/Logos entfernen.
   - **Heightfield-Bake:** BVH-Raycast auf ~0,20–0,25 m Grid + 2-Pass-Grid-Filter für glatte `slopeX`/`slopeZ` (analog `bake_airport_skatepark.py`).
2. **Phase B — Engine- & Gameplay-Verdrahtung (~1–2 Tage):**
   Aktuell sind die Parks `im_gefilde` und `airport_skatepark` **an über 10 Stellen im Code hart verdrahtet** (noch kein rein datengetriebenes Park-Manifest):
   - `src/ui/LandingPage.ts` (`SKATEPARK_LOCATIONS`, `?park=` Query-Param)
   - `src/world/ImGefildeScene.ts` (`load(parkId)`, eigene Beach-Skybox/Atmosphäre statt Alpen-Nacht/Hallbergmoos-Sunset)
   - `src/physics/ParkSurface.ts` (`parkId`, `getZoneName()`, `isNearCoping`, manuelle `copingSegments`)
   - `src/physics/SurfskateController.ts` (Park-Bounds, Spawn, `computeSafeBailRecovery()`)
   - `src/main.ts` (`switchPark()`, Spawn-Koordinaten, `normalizeSpecialParkId()`)
   - `src/world/FlowLineChallenge.ts` (3 Tiers `WAYPOINTS_2D`), `src/world/HotSpotZone.ts` (`HOT_SPOTS_BY_PARK`)
   - `src/world/ParkCrewEncounters.ts` (`CrewParkId`), `src/world/AfterHoursWanted.ts` (`WantedParkId`)
   - `src/world/PretzelCollectibles.ts` (aktuell noch feste *Im-Gefilde*-Spots), `src/services/LeaderboardService.ts` & `api/leaderboard.ts` (`LeaderboardPark`, `ValidParkId`, Redis-Keys)
   - `scripts/build_itch_zip.mjs` (`PRODUCTION_PUBLIC_FILES` Allowlist)

**Realistischer Gesamtaufwand:** ca. **2–5 Arbeitstage** – wobei Phase A stark davon abhängt, ob das Ausgangs-Mesh überhaupt eine befahrbare Bowl-Geometrie hat.

---

## 3. Konkrete Empfehlung & nächste Schritte

### Empfehlung: Lieber sauber in Blender bauen (oder echte Photogrammetrie nutzen)

| Kriterium | Option 1: Meshy-Modell bereinigen | Option 2: Eigener Blender „Pacific Beach Bowl“ (Empfohlen) | Option 3: Echte Photogrammetrie (bestehende Skill-Pipeline) |
| :--- | :---: | :---: | :---: |
| **Lizenz- & IP-Sicherheit** | 🟡 Bedingt (Creator-Input unbekannt; evtl. CC BY 4.0) | 🟢 **100 % eigen & kommerziell sicher** | 🟢 Eigene Scans + Graffiti-Ersatz |
| **Fahrgefühl / Transitions** | 🔴 Meist wellig / unpräzise Radien | 🟢 **Perfekte C2-Kurven & ideale Bowl-Tiefe** | 🟢 Realistisch nach Taubin + LiDAR |
| **Textur- & Optik-Qualität** | 🟠 Oft verwaschen in Skater-Nähe | 🟢 **Knackige Tileable Concrete + eigene Surf-Murals** | 🟢 4K Photogrammetrie-Atlas |
| **Dateigröße (Web / itch.io)** | 🟡 Nach Decimation ~5–15 MB | 🟢 **Sehr leicht (~2–6 MB GLB)** | 🟡 ~10–19 MB GLB |
| **Aufwand (3D + Pipeline)** | ~1–3 Tage (mit Fehlschlag-Risiko) | **~1,5–3 Tage (planbares Top-Ergebnis)** | Vor-Ort-Aufnahme nötig |

### Konkrete nächste Schritte (Empfohlene Reihenfolge)

1. **Kurz-Check am Meshy-Link (2 Min, optional):** Falls noch Neugier besteht, in Meshy prüfen, ob das Modell überhaupt herunterladbar ist, ob es aus *Text-to-3D* stammt und ob der Bowl in Blender im Rohzustand sauber offen/tief genug ist. Falls der Bowl flach/vermatscht ist → **sofort verwerfen**.
2. **Park-Konzept „Pacific Beach Bowl“ (statt exaktem „Venice Beach Skatepark“) festlegen:**
   - Layout inspiriert vom Venice-Vibe (Snake Run + 2 saubere Concrete Bowls + flache Street-Bank + Strand-Skybox + separate Palmen/Geländer außerhalb der Fahrfläche).
   - Generischer Name + Verzicht auf reale Murals/Logos → **0 % IP-/Marken-Risiko**.
3. **Vor dem 3. Park: Park-Architektur in SRFSK8 entkoppeln (Tech-Debt-Abbau):**
   - Bevor ein 3. Park dazukommt, sollte ein kleines `ParkConfig`-Registry-Ticket die hart verdrahteten `if (parkId === 'airport_skatepark')`-Weichen (`LandingPage`, `ParkSurface`, `HotSpotZone`, `FlowLineChallenge`, `PretzelCollectibles`, `LeaderboardService`) vereinheitlichen. Dadurch sinkt der Integrationsaufwand für jeden weiteren Park (3, 4, 5 …) auf wenige Stunden.
