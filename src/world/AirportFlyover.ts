import * as THREE from 'three';
import { SurfAudio } from '../audio/SurfAudio';

interface FlightCorridor {
  name: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  speed: number;
  bankAngle: number;
  pitchAngle: number;
}

/**
 * AirportFlyover
 *
 * Spawns a photorealistic, 100% copyright-free procedural commercial passenger jet
 * (Airbus A320 / Boeing 737 twin-jet style) flying low over the Airport Skatepark
 * (Hallbergmoos near Munich Airport MUC) every 5 minutes (300s), with the first flyover
 * occurring 18 seconds after entering the park.
 *
 * Major Realistic Redesign & Performance Overhaul:
 * 1. Organically lofted continuous fuselage (z = +18.5m to -20.5m) with authentic
 *    drooped nose, windshield brow, seamless underbelly wing-fairing bulge, and
 *    smooth upswept tailcone tapering to the APU exhaust nozzle (no boxy stripes or crude belly boxes!).
 * 2. High-resolution 2048x1024 fuselage CanvasTexture with pearl white gloss base,
 *    curved turquoise/orange/navy cheatlines, 6-pane cockpit windshield mask,
 *    32 oval passenger windows per side with silver frames, passenger doors, and "SRFSK8" branding.
 * 3. Aerodynamic swept wings with 26° sweep, 5.5° dihedral, NACA cambered airfoil profile,
 *    continuous curved blended sharklets (+2.1m height with safety-orange tips),
 *    and 4 streamlined teardrop flap-track fairing canoes per wing pointing correctly into the airstream.
 * 4. High-bypass turbofan engines built with lathe geometries (CFM LEAP / PW1100G style):
 *    polished chrome intake lip, swelled barrel fan cowl, silver thrust reverser ring,
 *    titanium exhaust nozzle, aerodynamic core plug cone, and 20 spinning titanium fan blades.
 * 5. Swept empennage: NACA symmetric vertical fin with aerodynamic dorsal fin fillet,
 *    painted canvas wave livery, and swept NACA horizontal stabilizers.
 * 6. High-performance aviation lighting using additive glowing THREE.Sprites (zero PointLights,
 *    preventing scene shader re-compilations!).
 * 7. Soft ground shadow tracking beneath the aircraft across skatepark concrete at y ≈ 0.04.
 */
export class AirportFlyover {
  public static readonly INITIAL_DELAY_SEC = 18;
  public static readonly FLYOVER_INTERVAL_SEC = 300; // 5 minutes

  private rootGroup = new THREE.Group();
  private airplaneGroup = new THREE.Group();
  private shadowGroup = new THREE.Group();
  private shadowMesh!: THREE.Mesh;
  private shadowMat!: THREE.MeshBasicMaterial;

  private fanSpinners: THREE.Object3D[] = [];
  private beaconSprites: THREE.Sprite[] = [];
  private strobeSprites: THREE.Sprite[] = [];
  private navSprites: THREE.Sprite[] = [];
  private beaconBulbMat!: THREE.MeshBasicMaterial;
  private strobeBulbMat!: THREE.MeshBasicMaterial;

  private flightTimer = 0;
  private flyoverElapsed = 0;
  private flyoverDuration = 13.0;
  private currentFlyoverActive = false;
  private isFirstFlyover = true;
  private corridorIndex = 0;
  private activeCorridor: FlightCorridor;

  private corridors: FlightCorridor[] = [
    {
      name: 'Runway 26R Approach (SE to NW)',
      start: new THREE.Vector3(230, 41, -120),
      end: new THREE.Vector3(-230, 28, 120),
      speed: 37.5,
      bankAngle: -0.08, // -4.6 deg left bank
      pitchAngle: 0.04,  // slightly nose up on approach
    },
    {
      name: 'Runway 08L Departure (SW to NE)',
      start: new THREE.Vector3(-230, 27, -110),
      end: new THREE.Vector3(230, 47, 110),
      speed: 39.5,
      bankAngle: 0.09,   // +5.1 deg right bank
      pitchAngle: 0.08,  // climbing nose up
    },
    {
      name: 'Overhead Crossfield Transition',
      start: new THREE.Vector3(-85, 33, -230),
      end: new THREE.Vector3(85, 35, 230),
      speed: 36.5,
      bankAngle: 0.03,
      pitchAngle: 0.03,
    },
  ];

  constructor(private scene: THREE.Scene, private audio: SurfAudio) {
    this.rootGroup.name = 'AirportFlyoverRoot';
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // Bulb fixture materials for unlit state
    this.beaconBulbMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    this.strobeBulbMat = new THREE.MeshBasicMaterial({ color: 0x222222 });

    // Build 3D aircraft model & ground shadow
    this.buildAirplaneModel();
    this.buildGroundShadow();

    this.rootGroup.add(this.airplaneGroup);
    this.rootGroup.add(this.shadowGroup);

    this.activeCorridor = this.corridors[0];
  }

  /**
   * Main per-frame update loop.
   * Advances the 5-minute timer when in Airport Skatepark, animates active flyovers,
   * spins turbofan blades, pulses aviation strobes/beacons, and updates ground shadow.
   */
  public update(dt: number, currentParkId: string): void {
    // Only active in airport_skatepark
    if (currentParkId !== 'airport_skatepark') {
      if (this.currentFlyoverActive || this.rootGroup.visible) {
        this.endFlyover();
      }
      this.flightTimer = 0;
      this.isFirstFlyover = true;
      return;
    }

    const clampedDt = Math.min(dt, 0.1);

    if (!this.currentFlyoverActive) {
      this.flightTimer += clampedDt;
      const targetDelay = this.isFirstFlyover
        ? AirportFlyover.INITIAL_DELAY_SEC
        : AirportFlyover.FLYOVER_INTERVAL_SEC;

      if (this.flightTimer >= targetDelay) {
        this.startFlyover();
      }
    } else {
      this.flyoverElapsed += clampedDt;
      const progress = Math.min(1.0, this.flyoverElapsed / this.flyoverDuration);

      // Interpolate position along flight corridor
      const currentPos = this.activeCorridor.start.clone().lerp(this.activeCorridor.end, progress);
      this.airplaneGroup.position.copy(currentPos);

      // Orientation: nose (+Z) faces flight direction with bank & pitch
      const flightDir = this.activeCorridor.end.clone().sub(this.activeCorridor.start).normalize();
      this.airplaneGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flightDir);
      this.airplaneGroup.rotateZ(this.activeCorridor.bankAngle);
      this.airplaneGroup.rotateX(this.activeCorridor.pitchAngle);

      // Shadow on ground at y = 0.04
      this.shadowGroup.position.set(currentPos.x, 0.04, currentPos.z);
      const heading = Math.atan2(flightDir.x, flightDir.z);
      this.shadowGroup.rotation.y = heading;

      // Soft shadow opacity fade: stronger near center of skatepark
      const distFromCenter = Math.hypot(currentPos.x, currentPos.z);
      const shadowAlpha = THREE.MathUtils.clamp(1.0 - (distFromCenter - 45) / 130, 0.0, 1.0);
      this.shadowMat.opacity = 0.48 * shadowAlpha;

      // Animate turbofan blade rotation
      const spinSpeed = 38.0;
      for (const spinner of this.fanSpinners) {
        spinner.rotation.z += clampedDt * spinSpeed;
      }

      // Animate aviation lighting
      this.updateAviationLighting(this.flyoverElapsed);

      if (progress >= 1.0) {
        this.endFlyover();
      }
    }
  }

  /**
   * Immediately triggers a flyover across the skatepark.
   * Essential for developer testing, QA validation, and interactive demoing.
   */
  public triggerFlyoverNow(): void {
    this.startFlyover();
  }

  /**
   * Returns true if an airplane is currently actively flying overhead.
   */
  public isActive(): boolean {
    return this.currentFlyoverActive;
  }

  private startFlyover(): void {
    this.currentFlyoverActive = true;
    this.rootGroup.visible = true;
    this.flyoverElapsed = 0;
    this.flightTimer = 0;
    this.isFirstFlyover = false;

    // Pick next flight corridor
    this.activeCorridor = this.corridors[this.corridorIndex];
    this.corridorIndex = (this.corridorIndex + 1) % this.corridors.length;

    const flightDistance = this.activeCorridor.start.distanceTo(this.activeCorridor.end);
    this.flyoverDuration = flightDistance / this.activeCorridor.speed;

    // Position immediately at start
    this.airplaneGroup.position.copy(this.activeCorridor.start);
    this.shadowGroup.position.set(
      this.activeCorridor.start.x,
      0.04,
      this.activeCorridor.start.z
    );

    // Play Doppler-shifted jet flyover sound effect
    this.audio.playJetFlyover(this.flyoverDuration);
  }

  private endFlyover(): void {
    this.currentFlyoverActive = false;
    this.rootGroup.visible = false;
    this.flyoverElapsed = 0;
    this.flightTimer = 0;
  }

  /**
   * Updates flashing anti-collision beacons (1.0 Hz) and wingtip strobes (1.25 Hz double-flash)
   * using performant additive sprite glows without any THREE.PointLights.
   */
  private updateAviationLighting(timeSec: number): void {
    // 1. Red anti-collision beacon pulse (every 1.0 sec, on for 0.14 sec)
    const beaconCycle = timeSec % 1.0;
    const isBeaconOn = beaconCycle < 0.14;
    this.beaconBulbMat.color.setHex(isBeaconOn ? 0xff2222 : 0x330000);
    const beaconScale = isBeaconOn ? 3.4 : 0.01;
    const beaconOpacity = isBeaconOn ? 1.0 : 0.0;
    for (const sprite of this.beaconSprites) {
      sprite.scale.set(beaconScale, beaconScale, 1.0);
      sprite.material.opacity = beaconOpacity;
    }

    // 2. White wingtip strobe double-flash (every 1.25 sec)
    const strobeCycle = timeSec % 1.25;
    const isStrobeOn = strobeCycle < 0.05 || (strobeCycle > 0.11 && strobeCycle < 0.16);
    this.strobeBulbMat.color.setHex(isStrobeOn ? 0xffffff : 0x222222);
    const strobeScale = isStrobeOn ? 4.5 : 0.01;
    const strobeOpacity = isStrobeOn ? 1.0 : 0.0;
    for (const sprite of this.strobeSprites) {
      sprite.scale.set(strobeScale, strobeScale, 1.0);
      sprite.material.opacity = strobeOpacity;
    }

    // 3. Steady navigation lights
    for (const sprite of this.navSprites) {
      sprite.scale.set(1.8, 1.8, 1.0);
      sprite.material.opacity = 0.85;
    }
  }

  /**
   * Builds the realistic procedural 3D passenger aircraft model.
   * Proportions inspired by Airbus A320 / Boeing 737:
   * - Wingspan: ~36.4m (with blended sharklets)
   * - Fuselage length: ~39.0m (nose z=+18.5 to tail APU z=-20.5)
   * - Height: ~11.8m
   */
  private buildAirplaneModel(): void {
    // ==========================================
    // 1. ORGANIC CONTINUOUS FUSELAGE LOFT & TEXTURE
    // ==========================================
    const fuselageTex = this.createFuselageTexture();
    const fuselageMat = new THREE.MeshStandardMaterial({
      map: fuselageTex,
      roughness: 0.28,
      metalness: 0.14,
    });

    const fuselageGeo = this.createFuselageGeometry();
    const fuselageMesh = new THREE.Mesh(fuselageGeo, fuselageMat);
    this.airplaneGroup.add(fuselageMesh);

    // Titanium APU exhaust nozzle cap at tail cone (z = -20.5)
    const apuMat = new THREE.MeshStandardMaterial({
      color: 0x34343a,
      roughness: 0.35,
      metalness: 0.88,
    });
    const apuGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.75, 20);
    apuGeo.rotateX(Math.PI / 2);
    const apuMesh = new THREE.Mesh(apuGeo, apuMat);
    apuMesh.position.set(0, 0.95, -20.45);
    this.airplaneGroup.add(apuMesh);

    // ==========================================
    // 2. MAIN WINGS WITH BLENDED SHARKLETS
    // ==========================================
    const wingMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });

    const rightWingGeo = this.createWingGeometry(true);
    const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
    this.airplaneGroup.add(rightWing);

    const leftWingGeo = this.createWingGeometry(false);
    const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
    this.airplaneGroup.add(leftWing);

    // Streamlined flap track fairing canoes (4 under each wing, round blunt nose +Z, slender tail -Z)
    const fairingStations = [
      { x: 4.2, len: 2.5, r: 0.16 },
      { x: 7.5, len: 2.2, r: 0.14 },
      { x: 10.8, len: 1.9, r: 0.12 },
      { x: 14.1, len: 1.6, r: 0.10 },
    ];

    const fairingMat = new THREE.MeshStandardMaterial({
      color: 0xdde3ea,
      roughness: 0.36,
      metalness: 0.18,
    });

    [-1, 1].forEach((sideSign) => {
      fairingStations.forEach((station) => {
        const fairingGeo = this.createFlapTrackFairingGeometry(station.len, station.r);
        const fairingMesh = new THREE.Mesh(fairingGeo, fairingMat);
        const xPos = station.x * sideSign;
        // Calculate wing underside attachment position
        const spanRatio = (station.x - 1.98) / (17.6 - 1.98);
        const yPos = -0.32 + spanRatio * 1.51 - station.r * 0.7;
        const zPos = -1.35 - spanRatio * 2.55;
        fairingMesh.position.set(xPos, yPos, zPos);
        this.airplaneGroup.add(fairingMesh);
      });
    });

    // ==========================================
    // 3. HIGH-BYPASS TURBOFAN ENGINES (CFM LEAP STYLE)
    // ==========================================
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      roughness: 0.12,
      metalness: 0.95,
    });

    const fanCowlMat = new THREE.MeshStandardMaterial({
      color: 0xf5f7fb,
      roughness: 0.28,
      metalness: 0.14,
    });

    const reverserSilverMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.28,
      metalness: 0.75,
    });

    const exhaustTitaniumMat = new THREE.MeshStandardMaterial({
      color: 0x3d3d44,
      roughness: 0.38,
      metalness: 0.85,
    });

    [-5.8, 5.8].forEach((engX) => {
      const engineGroup = new THREE.Group();
      engineGroup.position.set(engX, -1.15, 1.8);

      // Aerodynamic swept pylon connecting nacelle top to wing underside
      const pylonGeo = this.createEnginePylonGeometry();
      const pylonMesh = new THREE.Mesh(pylonGeo, fairingMat);
      pylonMesh.position.set(0, 0.75, 0.1);
      engineGroup.add(pylonMesh);

      // 1. Chrome intake lip ring (LatheGeometry)
      const lipPoints = [
        new THREE.Vector2(0.98, 1.7),
        new THREE.Vector2(1.0, 1.95),
        new THREE.Vector2(1.09, 2.18),
        new THREE.Vector2(1.14, 2.05),
        new THREE.Vector2(1.16, 1.7),
      ];
      const lipGeo = this.createLatheAlongZ(lipPoints, 32);
      const lipMesh = new THREE.Mesh(lipGeo, chromeMat);
      engineGroup.add(lipMesh);

      // 2. Swelled barrel fan cowl (LatheGeometry)
      const cowlPoints = [
        new THREE.Vector2(1.16, 1.7),
        new THREE.Vector2(1.2, 1.15),
        new THREE.Vector2(1.18, 0.3),
        new THREE.Vector2(1.14, -0.4),
        new THREE.Vector2(1.1, -0.75),
      ];
      const cowlGeo = this.createLatheAlongZ(cowlPoints, 32);
      const cowlMesh = new THREE.Mesh(cowlGeo, fanCowlMat);
      engineGroup.add(cowlMesh);

      // 3. Thrust reverser sleeve (LatheGeometry)
      const reverserPoints = [
        new THREE.Vector2(1.1, -0.75),
        new THREE.Vector2(1.06, -1.2),
        new THREE.Vector2(1.0, -1.6),
      ];
      const reverserGeo = this.createLatheAlongZ(reverserPoints, 32);
      const reverserMesh = new THREE.Mesh(reverserGeo, reverserSilverMat);
      engineGroup.add(reverserMesh);

      // 4. Rear exhaust nozzle (LatheGeometry)
      const nozzlePoints = [
        new THREE.Vector2(1.0, -1.6),
        new THREE.Vector2(0.82, -2.15),
        new THREE.Vector2(0.76, -2.15),
        new THREE.Vector2(0.76, -1.6),
      ];
      const nozzleGeo = this.createLatheAlongZ(nozzlePoints, 32);
      const nozzleMesh = new THREE.Mesh(nozzleGeo, exhaustTitaniumMat);
      engineGroup.add(nozzleMesh);

      // 5. Central aerodynamic exhaust plug cone (LatheGeometry)
      const coreConePoints = [
        new THREE.Vector2(0.0, -2.85),
        new THREE.Vector2(0.12, -2.55),
        new THREE.Vector2(0.24, -2.1),
        new THREE.Vector2(0.36, -1.6),
        new THREE.Vector2(0.42, -1.25),
      ];
      const coreConeGeo = this.createLatheAlongZ(coreConePoints, 24);
      const coreConeMesh = new THREE.Mesh(coreConeGeo, exhaustTitaniumMat);
      engineGroup.add(coreConeMesh);

      // 6. Dark interior intake duct
      const ductGeo = new THREE.CylinderGeometry(0.98, 0.95, 0.9, 24);
      ductGeo.rotateX(Math.PI / 2);
      const ductMat = new THREE.MeshBasicMaterial({ color: 0x141418 });
      const ductMesh = new THREE.Mesh(ductGeo, ductMat);
      ductMesh.position.set(0, 0, 1.25);
      engineGroup.add(ductMesh);

      // 7. Spinning turbofan blades & spinner cone
      const fanGroup = new THREE.Group();
      fanGroup.position.set(0, 0, 0.95);

      const spinnerConeGeo = new THREE.ConeGeometry(0.3, 0.7, 20);
      spinnerConeGeo.rotateX(Math.PI / 2);
      const spinnerMat = new THREE.MeshStandardMaterial({
        color: 0x0c2340,
        roughness: 0.25,
        metalness: 0.4,
      });
      const spinnerMesh = new THREE.Mesh(spinnerConeGeo, spinnerMat);
      fanGroup.add(spinnerMesh);

      // 20 titanium fan blades with aerodynamic twist
      const bladeGeo = new THREE.BoxGeometry(0.03, 0.62, 0.16);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x5a626c,
        roughness: 0.25,
        metalness: 0.8,
      });

      for (let b = 0; b < 20; b++) {
        const bladeAngle = (b / 20) * Math.PI * 2;
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(Math.cos(bladeAngle) * 0.48, Math.sin(bladeAngle) * 0.48, 0);
        blade.rotation.z = bladeAngle + 0.35;
        fanGroup.add(blade);
      }

      this.fanSpinners.push(fanGroup);
      engineGroup.add(fanGroup);

      this.airplaneGroup.add(engineGroup);
    });

    // ==========================================
    // 4. EMPENNAGE (VERTICAL FIN & HORIZONTAL STABILIZERS)
    // ==========================================
    const finTex = this.createFinTexture();
    const finMat = new THREE.MeshStandardMaterial({
      map: finTex,
      roughness: 0.3,
      metalness: 0.16,
      side: THREE.DoubleSide,
    });

    const finGeo = this.createVerticalFinGeometry();
    const finMesh = new THREE.Mesh(finGeo, finMat);
    this.airplaneGroup.add(finMesh);

    // Horizontal stabilizers (Höhenleitwerk)
    [-1, 1].forEach((sign) => {
      const hStabGeo = this.createHorizontalStabGeometry(sign > 0);
      const hStab = new THREE.Mesh(hStabGeo, fairingMat);
      this.airplaneGroup.add(hStab);
    });

    // ==========================================
    // 5. AVIATION LIGHTING (SPRITES ONLY - NO POINTLIGHTS!)
    // ==========================================
    const redGlowTex = this.createGlowTexture('#ff1525');
    const greenGlowTex = this.createGlowTexture('#00ff44');
    const whiteGlowTex = this.createGlowTexture('#ffffff');

    // Sprite materials with AdditiveBlending for intense glare/bloom effect
    const redSpriteMat = new THREE.SpriteMaterial({
      map: redGlowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    const greenSpriteMat = new THREE.SpriteMaterial({
      map: greenGlowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    const whiteSpriteMat = new THREE.SpriteMaterial({
      map: whiteGlowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    // Small physical fixture bulb spheres
    const bulbGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const portNavBulbMat = new THREE.MeshBasicMaterial({ color: 0xff1525 });
    const stbdNavBulbMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });

    // 1. Port Navigation Light (Red on left wingtip)
    const portNavBulb = new THREE.Mesh(bulbGeo, portNavBulbMat);
    portNavBulb.position.set(-18.15, 3.2, -4.7);
    this.airplaneGroup.add(portNavBulb);

    const portNavSprite = new THREE.Sprite(redSpriteMat.clone());
    portNavSprite.position.set(-18.15, 3.2, -4.7);
    this.navSprites.push(portNavSprite);
    this.airplaneGroup.add(portNavSprite);

    // 2. Starboard Navigation Light (Green on right wingtip)
    const stbdNavBulb = new THREE.Mesh(bulbGeo, stbdNavBulbMat);
    stbdNavBulb.position.set(18.15, 3.2, -4.7);
    this.airplaneGroup.add(stbdNavBulb);

    const stbdNavSprite = new THREE.Sprite(greenSpriteMat.clone());
    stbdNavSprite.position.set(18.15, 3.2, -4.7);
    this.navSprites.push(stbdNavSprite);
    this.airplaneGroup.add(stbdNavSprite);

    // 3. Wingtip White Strobes
    [-18.15, 18.15].forEach((xPos) => {
      const strobeBulb = new THREE.Mesh(bulbGeo, this.strobeBulbMat);
      strobeBulb.position.set(xPos, 3.25, -4.9);
      this.airplaneGroup.add(strobeBulb);

      const strobeSprite = new THREE.Sprite(whiteSpriteMat.clone());
      strobeSprite.position.set(xPos, 3.25, -4.9);
      this.strobeSprites.push(strobeSprite);
      this.airplaneGroup.add(strobeSprite);
    });

    // 4. Tail White Strobe Light (at APU cone)
    const tailStrobeBulb = new THREE.Mesh(bulbGeo, this.strobeBulbMat);
    tailStrobeBulb.position.set(0, 1.08, -20.55);
    this.airplaneGroup.add(tailStrobeBulb);

    const tailStrobeSprite = new THREE.Sprite(whiteSpriteMat.clone());
    tailStrobeSprite.position.set(0, 1.08, -20.55);
    this.strobeSprites.push(tailStrobeSprite);
    this.airplaneGroup.add(tailStrobeSprite);

    // 5. Red Anti-Collision Beacons (Roof & Belly)
    const roofBeaconBulb = new THREE.Mesh(bulbGeo, this.beaconBulbMat);
    roofBeaconBulb.position.set(0, 2.15, 1.2);
    this.airplaneGroup.add(roofBeaconBulb);

    const roofBeaconSprite = new THREE.Sprite(redSpriteMat.clone());
    roofBeaconSprite.position.set(0, 2.15, 1.2);
    this.beaconSprites.push(roofBeaconSprite);
    this.airplaneGroup.add(roofBeaconSprite);

    const bellyBeaconBulb = new THREE.Mesh(bulbGeo, this.beaconBulbMat);
    bellyBeaconBulb.position.set(0, -2.75, 0.5);
    this.airplaneGroup.add(bellyBeaconBulb);

    const bellyBeaconSprite = new THREE.Sprite(redSpriteMat.clone());
    bellyBeaconSprite.position.set(0, -2.75, 0.5);
    this.beaconSprites.push(bellyBeaconSprite);
    this.airplaneGroup.add(bellyBeaconSprite);
  }

  /**
   * Constructs the organically lofted commercial aircraft fuselage.
   * Continuous smooth mesh from nose tip (z = +18.5) to APU cone (z = -20.5).
   */
  private createFuselageGeometry(): THREE.BufferGeometry {
    const numRings = 64;
    const numSlices = 48;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const zFront = 18.5;
    const zBack = -20.5;
    const totalLength = zFront - zBack; // 39.0m

    for (let i = 0; i <= numRings; i++) {
      const u = i / numRings;
      const z = zFront - u * totalLength;

      // Calculate profile parameters along fuselage axis
      let centerY = 0.0;
      let rx = 1.98;
      let ry = 2.1;
      let bellyBulge = 0.0;
      let bellyWiden = 0.0;
      let cockpitBrow = 0.0;

      if (z >= 12.5) {
        // Nose & Cockpit radome zone (z = 18.5 to 12.5)
        const tNose = (18.5 - z) / 6.0; // 0 at tip, 1 at cockpit base
        // Smooth downward droop of radome nose tip
        const droopCurve = Math.pow(1.0 - tNose, 1.8);
        centerY = -0.48 * droopCurve;

        // Rounded radome nose profile blending into cylindrical cabin
        const noseShape = Math.sqrt(Math.max(0, 1.0 - Math.pow(1.0 - tNose, 2.2)));
        rx = 1.98 * noseShape;
        ry = 2.1 * noseShape;

        // Cockpit windshield brow slope
        if (z >= 13.2 && z <= 16.2) {
          cockpitBrow = Math.sin((Math.PI * (z - 13.2)) / 3.0) * 0.14;
        }
      } else if (z < 12.5 && z >= -8.5) {
        // Constant passenger cabin section with seamless underbelly wing fairing
        centerY = 0.0;
        rx = 1.98;
        ry = 2.1;

        // Aerodynamic belly fairing bulge (z = +5.0 to -3.5)
        if (z <= 5.0 && z >= -3.5) {
          const w = 1.0 - Math.pow((z - 0.75) / 4.25, 2);
          if (w > 0) {
            bellyBulge = 0.62 * Math.pow(w, 1.5);
            bellyWiden = 0.28 * Math.pow(w, 1.5);
          }
        }
      } else if (z < -8.5 && z >= -19.8) {
        // Sleek upswept tailcone (z = -8.5 to -19.8)
        const tTail = (-8.5 - z) / 11.3; // 0 at -8.5, 1 at -19.8
        // Upsweep: centerline gently curves upward towards APU
        centerY = 0.95 * Math.pow(tTail, 1.4);

        // Smooth taper down to APU diameter
        const taper = 1.0 - 0.86 * Math.pow(tTail, 0.92);
        rx = 1.98 * taper;
        ry = 2.1 * taper;
      } else {
        // APU exhaust cone section (z = -19.8 to -20.5)
        const tApu = (-19.8 - z) / 0.7;
        centerY = 0.95 + 0.02 * tApu;
        const apuTaper = 0.28 * (1.0 - 0.15 * tApu);
        rx = apuTaper;
        ry = apuTaper;
      }

      for (let j = 0; j <= numSlices; j++) {
        const v = j / numSlices;
        // theta: v=0 at top spine (angle = pi/2), v=0.25 starboard, v=0.5 belly, v=0.75 port, v=1.0 top
        const theta = Math.PI / 2 - v * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        let vertX = rx * cosT;
        let vertY = centerY + ry * sinT;

        // Seamless underbelly fairing downward and outward expansion
        if (bellyBulge > 0 && sinT < 0) {
          const bellyFactor = Math.pow(-sinT, 3.0);
          vertY -= bellyBulge * bellyFactor;
          vertX += bellyWiden * cosT * Math.pow(-sinT, 2.0);
        }

        // Cockpit windshield rake flattening on upper forehead
        if (cockpitBrow > 0 && sinT > 0) {
          vertY -= cockpitBrow * Math.pow(sinT, 2.0);
        }

        // Clamp tip ring to exact point
        if (i === 0) {
          vertX = 0;
          vertY = centerY;
        }

        positions.push(vertX, vertY, z);
        uvs.push(u, v);
      }
    }

    // Build quad strips between adjacent rings
    for (let i = 0; i < numRings; i++) {
      for (let j = 0; j < numSlices; j++) {
        const idx0 = i * (numSlices + 1) + j;
        const idx1 = (i + 1) * (numSlices + 1) + j;
        const idx2 = (i + 1) * (numSlices + 1) + (j + 1);
        const idx3 = i * (numSlices + 1) + (j + 1);

        indices.push(idx0, idx1, idx2);
        indices.push(idx0, idx2, idx3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Generates a high-resolution 2048x1024 CanvasTexture directly mapping the fuselage UVs.
   * Eliminates all protruding boxes, rendering painted cheatlines, 6-pane cockpit windshield,
   * passenger doors, and 32 oval windows per side directly on the fuselage surface.
   */
  private createFuselageTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    // 1. High-gloss airline pearl white base coat
    ctx.fillStyle = '#f8fafd';
    ctx.fillRect(0, 0, 2048, 1024);

    // Subtle atmospheric shading along top spine and bottom
    const baseGradient = ctx.createLinearGradient(0, 0, 0, 1024);
    baseGradient.addColorStop(0.0, 'rgba(230, 235, 245, 0.4)');
    baseGradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.0)');
    baseGradient.addColorStop(0.5, 'rgba(215, 222, 232, 0.25)');
    baseGradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.0)');
    baseGradient.addColorStop(1.0, 'rgba(230, 235, 245, 0.4)');
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, 2048, 1024);

    // 2. Aerodynamic Belly Fairing (Airline graphite gray, centered around belly v = 0.5 -> y = 512)
    // Fuselage z = +5.0 to -3.5 corresponds to u = 0.346 to 0.564 -> x = 708 to 1155
    ctx.save();
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.ellipse(930, 512, 225, 88, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner lighter gray fairing highlight
    ctx.fillStyle = '#606d7d';
    ctx.beginPath();
    ctx.ellipse(930, 512, 195, 62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. Dynamic Wave Livery Cheatlines (Turquoise, Orange, Oceanic Navy)
    // Starboard side: window line at y = 256, below window line is y = 285 to 330
    // Port side: window line at y = 768, below window line (towards belly) is y = 739 to 694
    const drawLiveryLines = (isPort: boolean) => {
      ctx.save();
      const centerY = isPort ? 768 : 256;
      const dir = isPort ? -1 : 1; // downwards toward belly (512)

      // Navy lower rocker stripe
      ctx.fillStyle = '#0c2340';
      ctx.beginPath();
      ctx.moveTo(220, centerY + dir * 65);
      ctx.quadraticCurveTo(800, centerY + dir * 62, 1420, centerY + dir * 45);
      ctx.quadraticCurveTo(1720, centerY + dir * 20, 1860, centerY + dir * 5);
      ctx.lineTo(1860, centerY + dir * 18);
      ctx.quadraticCurveTo(1720, centerY + dir * 32, 1420, centerY + dir * 57);
      ctx.quadraticCurveTo(800, centerY + dir * 75, 220, centerY + dir * 77);
      ctx.closePath();
      ctx.fill();

      // Turquoise wave swoop
      ctx.fillStyle = '#00b4d8';
      ctx.beginPath();
      ctx.moveTo(180, centerY + dir * 32);
      ctx.quadraticCurveTo(700, centerY + dir * 30, 1400, centerY + dir * 16);
      ctx.quadraticCurveTo(1700, centerY - dir * 5, 1850, centerY - dir * 28);
      ctx.lineTo(1850, centerY - dir * 18);
      ctx.quadraticCurveTo(1700, centerY + dir * 5, 1400, centerY + dir * 26);
      ctx.quadraticCurveTo(700, centerY + dir * 40, 180, centerY + dir * 42);
      ctx.closePath();
      ctx.fill();

      // High-visibility Orange accent stripe
      ctx.fillStyle = '#f77f00';
      ctx.beginPath();
      ctx.moveTo(240, centerY + dir * 45);
      ctx.quadraticCurveTo(750, centerY + dir * 44, 1410, centerY + dir * 30);
      ctx.quadraticCurveTo(1710, centerY + dir * 8, 1855, centerY - dir * 12);
      ctx.lineTo(1855, centerY - dir * 6);
      ctx.quadraticCurveTo(1710, centerY + dir * 14, 1410, centerY + dir * 36);
      ctx.quadraticCurveTo(750, centerY + dir * 50, 240, centerY + dir * 51);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    };

    drawLiveryLines(false); // Starboard
    drawLiveryLines(true);  // Port

    // 4. Cockpit Windshield Band (Authentic 6-pane passenger jet windshield)
    // Windshield is located around u = (18.5 - 14.8) / 39 = 0.095 -> x = 194
    // Spans across the top spine: Starboard (y = 20 to 140), Port (y = 884 to 1004)
    const drawCockpitWindows = () => {
      ctx.save();

      // Starboard windshield panes
      const drawWindshieldSide = (isPort: boolean) => {
        const yBase = isPort ? 1024 : 0;
        const sign = isPort ? -1 : 1;

        // Black raccoon mask surrounding cockpit windows
        ctx.fillStyle = '#111622';
        ctx.beginPath();
        ctx.moveTo(160, yBase + sign * 18);
        ctx.lineTo(218, yBase + sign * 28);
        ctx.lineTo(238, yBase + sign * 138);
        ctx.lineTo(178, yBase + sign * 124);
        ctx.closePath();
        ctx.fill();

        // Pane 1: Center Front windshield
        ctx.fillStyle = '#0a0e17';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(165, yBase + sign * 22);
        ctx.lineTo(212, yBase + sign * 30);
        ctx.lineTo(206, yBase + sign * 68);
        ctx.lineTo(168, yBase + sign * 64);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Pane 2: Sliding side window
        ctx.beginPath();
        ctx.moveTo(172, yBase + sign * 72);
        ctx.lineTo(210, yBase + sign * 76);
        ctx.lineTo(216, yBase + sign * 106);
        ctx.lineTo(182, yBase + sign * 102);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Pane 3: Aft triangular quarter window
        ctx.beginPath();
        ctx.moveTo(186, yBase + sign * 108);
        ctx.lineTo(220, yBase + sign * 112);
        ctx.lineTo(232, yBase + sign * 132);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Sky reflection highlight across windshield glass
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.45)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(170, yBase + sign * 36);
        ctx.lineTo(205, yBase + sign * 44);
        ctx.stroke();
      };

      drawWindshieldSide(false);
      drawWindshieldSide(true);
      ctx.restore();
    };

    drawCockpitWindows();

    // 5. Twin Rows of Passenger Windows (32 rounded oval windows per side)
    const drawPassengerWindows = () => {
      ctx.save();
      const winCount = 32;
      const xStart = 370;
      const xEnd = 1360;
      const xStep = (xEnd - xStart) / winCount;

      const drawWindowRow = (centerY: number) => {
        for (let i = 0; i < winCount; i++) {
          const wx = xStart + i * xStep;

          // Skip gaps for passenger boarding and emergency overwing doors
          if (Math.abs(wx - 860) < 28) continue; // Overwing exit 1
          if (Math.abs(wx - 910) < 28) continue; // Overwing exit 2

          // Silver window trim ring
          ctx.fillStyle = '#b0b8c4';
          ctx.beginPath();
          ctx.roundRect(wx - 7, centerY - 12, 14, 24, 6);
          ctx.fill();

          // Dark tinted passenger glass
          ctx.fillStyle = '#0e131d';
          ctx.beginPath();
          ctx.roundRect(wx - 5.5, centerY - 10.5, 11, 21, 5);
          ctx.fill();

          // Subtle sky reflection inside glass
          ctx.fillStyle = '#223247';
          ctx.beginPath();
          ctx.arc(wx + 1.5, centerY - 3, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      drawWindowRow(256); // Starboard row
      drawWindowRow(768); // Port row
      ctx.restore();
    };

    drawPassengerWindows();

    // 6. Passenger Doors & Overwing Exits
    const drawDoors = () => {
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3.0;

      const drawDoor = (dx: number, dy: number, w: number, h: number) => {
        ctx.beginPath();
        ctx.roundRect(dx - w / 2, dy - h / 2, w, h, 8);
        ctx.stroke();

        // Door inspection window
        ctx.fillStyle = '#0e131d';
        ctx.beginPath();
        ctx.roundRect(dx - 5, dy - 18, 10, 16, 4);
        ctx.fill();

        // Door handle bar
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(dx + 4, dy + 2, 4, 10);
      };

      // Forward Passenger Door (L1 / R1)
      drawDoor(310, 256, 30, 68);
      drawDoor(310, 768, 30, 68);

      // Overwing Emergency Exits (L2 / R2)
      drawDoor(860, 256, 22, 48);
      drawDoor(860, 768, 22, 48);
      drawDoor(910, 256, 22, 48);
      drawDoor(910, 768, 22, 48);

      // Aft Passenger Door (L3 / R3)
      drawDoor(1410, 256, 28, 64);
      drawDoor(1410, 768, 28, 64);

      ctx.restore();
    };

    drawDoors();

    // 7. Airline Branding & Typography ("SRFSK8" & "D-ASK8" registration)
    ctx.save();
    ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0c2340';
    ctx.letterSpacing = '3px';

    // Starboard forward logo
    ctx.fillText('SRFSK8', 410, 222);
    // Port forward logo
    ctx.fillText('SRFSK8', 410, 734);

    // Registration code near tail
    ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('D-ASK8', 1510, 230);
    ctx.fillText('D-ASK8', 1510, 742);

    // Radome nose seam ring
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(85, 0);
    ctx.lineTo(85, 1024);
    ctx.stroke();

    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Generates swept main wing geometry with 26° sweep, 5.5° dihedral, NACA cambered profile,
   * and smooth continuous blended sharklets curving upward (+2.1m height).
   */
  private createWingGeometry(isRight: boolean): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();

    // 12 Spanwise stations from root to blended sharklet tip
    const stations = [
      // Main wing (stations 0 - 6)
      { x: 1.98, y: -0.30, zLE: 4.20, chord: 5.80, cantRad: 0.0, col: [0.87, 0.89, 0.92] },
      { x: 3.80, y: -0.12, zLE: 3.30, chord: 5.30, cantRad: 0.0, col: [0.87, 0.89, 0.92] },
      { x: 5.80, y:  0.07, zLE: 2.35, chord: 4.80, cantRad: 0.0, col: [0.87, 0.89, 0.92] },
      { x: 8.80, y:  0.36, zLE: 0.90, chord: 3.80, cantRad: 0.0, col: [0.87, 0.89, 0.92] },
      { x: 11.8, y:  0.65, zLE: -0.55, chord: 2.90, cantRad: 0.0, col: [0.87, 0.89, 0.92] },
      { x: 14.8, y:  0.94, zLE: -2.00, chord: 2.00, cantRad: 0.0, col: [0.87, 0.89, 0.92] },
      { x: 17.6, y:  1.21, zLE: -3.36, chord: 1.38, cantRad: 0.0, col: [0.87, 0.89, 0.92] },

      // Blended Sharklet curve (stations 7 - 11, curving smoothly up to y = +3.30m)
      { x: 17.82, y: 1.38, zLE: -3.52, chord: 1.20, cantRad: 0.38, col: [0.0, 0.70, 0.85] },
      { x: 17.98, y: 1.68, zLE: -3.76, chord: 1.02, cantRad: 0.78, col: [0.0, 0.70, 0.85] },
      { x: 18.08, y: 2.12, zLE: -4.10, chord: 0.84, cantRad: 1.15, col: [0.0, 0.70, 0.85] },
      { x: 18.14, y: 2.68, zLE: -4.55, chord: 0.62, cantRad: 1.36, col: [0.97, 0.50, 0.0] },
      { x: 18.18, y: 3.30, zLE: -5.00, chord: 0.38, cantRad: 1.46, col: [0.97, 0.50, 0.0] },
    ];

    // NACA 2412 Airfoil Profile: 28 perimeter points
    const numHalf = 14;
    const numProfilePoints = numHalf * 2;
    interface ProfilePt { s: number; dy: number }
    const profilePoints: ProfilePt[] = [];

    // Upper surface from leading edge (s = 0) to trailing edge (s = 1)
    for (let i = 0; i <= numHalf; i++) {
      const s = (1.0 - Math.cos((Math.PI * i) / numHalf)) / 2.0;
      const { yUpper } = this.getNaca4Profile(s, 0.12, 0.02, 0.4);
      profilePoints.push({ s, dy: yUpper });
    }

    // Lower surface from trailing edge (s = 1) back to leading edge (s = 0)
    for (let i = numHalf - 1; i > 0; i--) {
      const s = (1.0 - Math.cos((Math.PI * i) / numHalf)) / 2.0;
      const { yLower } = this.getNaca4Profile(s, 0.12, 0.02, 0.4);
      profilePoints.push({ s, dy: yLower });
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // Generate 3D vertices for all stations
    for (let st = 0; st < stations.length; st++) {
      const sInfo = stations[st];
      const col = sInfo.col;

      for (let p = 0; p < numProfilePoints; p++) {
        const pt = profilePoints[p];
        const scaledDy = pt.dy * sInfo.chord;

        // Rotate thickness vector by cant angle around chord axis
        const dxCant = scaledDy * Math.sin(sInfo.cantRad);
        const dyCant = scaledDy * Math.cos(sInfo.cantRad);

        let vertX = sInfo.x + dxCant;
        const vertY = sInfo.y + dyCant;
        const vertZ = sInfo.zLE - pt.s * sInfo.chord;

        if (!isRight) {
          vertX = -vertX;
        }

        positions.push(vertX, vertY, vertZ);
        colors.push(col[0], col[1], col[2]);
      }
    }

    // Build quad strips between adjacent stations
    for (let st = 0; st < stations.length - 1; st++) {
      for (let p = 0; p < numProfilePoints; p++) {
        const p0 = p;
        const p1 = (p + 1) % numProfilePoints;

        const idx0 = st * numProfilePoints + p0;
        const idx1 = (st + 1) * numProfilePoints + p0;
        const idx2 = (st + 1) * numProfilePoints + p1;
        const idx3 = st * numProfilePoints + p1;

        if (isRight) {
          indices.push(idx0, idx1, idx2);
          indices.push(idx0, idx2, idx3);
        } else {
          indices.push(idx0, idx2, idx1);
          indices.push(idx0, idx3, idx2);
        }
      }
    }

    // End cap at sharklet tip (station 11)
    const tipStationIdx = stations.length - 1;
    let tipCenterX = 0;
    let tipCenterY = 0;
    let tipCenterZ = 0;
    for (let p = 0; p < numProfilePoints; p++) {
      const vIdx = tipStationIdx * numProfilePoints + p;
      tipCenterX += positions[vIdx * 3];
      tipCenterY += positions[vIdx * 3 + 1];
      tipCenterZ += positions[vIdx * 3 + 2];
    }
    tipCenterX /= numProfilePoints;
    tipCenterY /= numProfilePoints;
    tipCenterZ /= numProfilePoints;

    const tipCenterIdx = positions.length / 3;
    positions.push(tipCenterX, tipCenterY, tipCenterZ);
    const tipCol = stations[tipStationIdx].col;
    colors.push(tipCol[0], tipCol[1], tipCol[2]);

    for (let p = 0; p < numProfilePoints; p++) {
      const p0 = tipStationIdx * numProfilePoints + p;
      const p1 = tipStationIdx * numProfilePoints + ((p + 1) % numProfilePoints);
      if (isRight) {
        indices.push(tipCenterIdx, p1, p0);
      } else {
        indices.push(tipCenterIdx, p0, p1);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Constructs aerodynamic teardrop flap-track fairing canoes.
   * Round blunt nose points forward (+Z), slender conical tail points aft (-Z).
   */
  private createFlapTrackFairingGeometry(length = 2.4, radius = 0.16): THREE.BufferGeometry {
    const numRings = 14;
    const numSlices = 14;
    const positions: number[] = [];
    const indices: number[] = [];

    const zFront = length * 0.28;
    const zAft = -length * 0.72;

    for (let i = 0; i <= numRings; i++) {
      const t = i / numRings; // 0 (front +Z) to 1 (aft -Z)
      const z = zFront * (1.0 - t) + zAft * t;
      let r = 0;

      if (t < 0.28) {
        // Blunt rounded nose cap
        const u = t / 0.28;
        r = radius * Math.sqrt(Math.max(0, 1.0 - Math.pow(1.0 - u, 2.0)));
      } else {
        // Slender conical tail tapering to sharp needle
        const u = (t - 0.28) / 0.72;
        r = radius * Math.pow(1.0 - u, 1.35);
      }

      for (let j = 0; j <= numSlices; j++) {
        const angle = (j / numSlices) * Math.PI * 2;
        positions.push(Math.cos(angle) * r, Math.sin(angle) * r, z);
      }
    }

    for (let i = 0; i < numRings; i++) {
      for (let j = 0; j < numSlices; j++) {
        const a = i * (numSlices + 1) + j;
        const b = (i + 1) * (numSlices + 1) + j;
        const c = (i + 1) * (numSlices + 1) + (j + 1);
        const d = i * (numSlices + 1) + (j + 1);
        indices.push(a, b, c, a, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Helper that revolves 2D profile points around the Y axis and re-orients along +Z.
   */
  private createLatheAlongZ(points: THREE.Vector2[], segments = 32): THREE.BufferGeometry {
    const geo = new THREE.LatheGeometry(points, segments);
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Constructs aerodynamic swept pylon connecting turbofan engine to wing underside.
   */
  private createEnginePylonGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const halfThick = 0.14;

    // Swept pylon vertices
    const fTop = [0, 0.45, 1.6];
    const aTop = [0, 0.45, -0.9];
    const fBot = [0, -0.45, 1.9];
    const aBot = [0, -0.45, -0.6];

    const positions: number[] = [
      // Right side
      halfThick, fTop[1], fTop[2],
      halfThick, fBot[1], fBot[2],
      halfThick, aBot[1], aBot[2],
      halfThick, fTop[1], fTop[2],
      halfThick, aBot[1], aBot[2],
      halfThick, aTop[1], aTop[2],

      // Left side
      -halfThick, fTop[1], fTop[2],
      -halfThick, aBot[1], aBot[2],
      -halfThick, fBot[1], fBot[2],
      -halfThick, fTop[1], fTop[2],
      -halfThick, aTop[1], aTop[2],
      -halfThick, aBot[1], aBot[2],

      // Leading edge
      halfThick, fTop[1], fTop[2],
      -halfThick, fTop[1], fTop[2],
      -halfThick, fBot[1], fBot[2],
      halfThick, fTop[1], fTop[2],
      -halfThick, fBot[1], fBot[2],
      halfThick, fBot[1], fBot[2],

      // Trailing edge
      halfThick, aTop[1], aTop[2],
      halfThick, aBot[1], aBot[2],
      -halfThick, aBot[1], aBot[2],
      halfThick, aTop[1], aTop[2],
      -halfThick, aBot[1], aBot[2],
      -halfThick, aTop[1], aTop[2],
    ];

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Constructs swept vertical fin with aerodynamic dorsal fin fillet.
   */
  private createVerticalFinGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const numStations = 8;
    const numPoints = 16;

    // Height stations from fuselage roof (y = 1.95) to fin tip (y = 8.8)
    for (let st = 0; st <= numStations; st++) {
      const v = st / numStations;
      const y = 1.95 + v * (8.8 - 1.95);

      // Leading edge sweep with dorsal fin fillet
      let zLE = -10.5 - v * (18.2 - 10.5);
      if (v < 0.25) {
        // Dorsal fin fillet extending forward to z = -13.5
        const filletBlend = (0.25 - v) / 0.25;
        zLE += filletBlend * 3.0;
      }

      // Trailing edge sweep
      const zTE = -18.8 - v * (20.2 - 18.8);
      const chord = zLE - zTE;
      const halfThick = (0.22 * (1.0 - v * 0.65)) * 0.5;

      for (let p = 0; p < numPoints; p++) {
        const u = p / numPoints;
        const angle = u * Math.PI * 2;
        // Symmetric NACA 0010 thickness
        const s = (1.0 - Math.cos(angle)) / 2.0;
        const { yUpper } = this.getNaca4Profile(s, 0.1, 0, 0);

        const x = yUpper * halfThick * 2.0 * (Math.sin(angle) >= 0 ? 1 : -1);
        const z = zLE - s * chord;

        positions.push(x, y, z);
        uvs.push(s, v);
      }
    }

    // Build quad strips between height stations
    for (let st = 0; st < numStations; st++) {
      for (let p = 0; p < numPoints; p++) {
        const p0 = p;
        const p1 = (p + 1) % numPoints;

        const idx0 = st * numPoints + p0;
        const idx1 = (st + 1) * numPoints + p0;
        const idx2 = (st + 1) * numPoints + p1;
        const idx3 = st * numPoints + p1;

        indices.push(idx0, idx1, idx2);
        indices.push(idx0, idx2, idx3);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Generates a 512x512 CanvasTexture for the vertical fin with SRFSK8 wave livery.
   */
  private createFinTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Oceanic navy background
    ctx.fillStyle = '#0c2340';
    ctx.fillRect(0, 0, 512, 512);

    // High-visibility Orange fin cap at top
    ctx.fillStyle = '#f77f00';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(512, 0);
    ctx.lineTo(512, 70);
    ctx.lineTo(0, 110);
    ctx.closePath();
    ctx.fill();

    // Turquoise dynamic surf wave swirl
    ctx.fillStyle = '#00b4d8';
    ctx.beginPath();
    ctx.moveTo(0, 480);
    ctx.quadraticCurveTo(240, 360, 420, 160);
    ctx.quadraticCurveTo(460, 120, 500, 110);
    ctx.lineTo(500, 160);
    ctx.quadraticCurveTo(380, 240, 220, 430);
    ctx.lineTo(0, 512);
    ctx.closePath();
    ctx.fill();

    // White surf wave crest accent
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(280, 310);
    ctx.quadraticCurveTo(390, 210, 460, 140);
    ctx.lineTo(460, 155);
    ctx.quadraticCurveTo(370, 235, 260, 340);
    ctx.closePath();
    ctx.fill();

    // Brand typography "SRFSK8"
    ctx.save();
    ctx.translate(280, 340);
    ctx.rotate(-0.55);
    ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SRFSK8', 0, 0);
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Constructs horizontal stabilizer wings with symmetric NACA profile.
   */
  private createHorizontalStabGeometry(isRight: boolean): THREE.BufferGeometry {
    const s = isRight ? 1 : -1;
    const geo = new THREE.BufferGeometry();

    const rLead = [0.55 * s, 1.15, -15.8];
    const rTrail = [0.55 * s, 1.15, -18.8];
    const tLead = [6.2 * s, 1.55, -19.4];
    const tTrail = [6.2 * s, 1.55, -20.6];

    const thickRoot = 0.18;
    const thickTip = 0.08;

    const rLeadTop = [rLead[0], rLead[1] + thickRoot, rLead[2]];
    const rLeadBot = [rLead[0], rLead[1] - thickRoot, rLead[2]];
    const rTrailTop = [rTrail[0], rTrail[1] + thickRoot * 0.3, rTrail[2]];
    const rTrailBot = [rTrail[0], rTrail[1] - thickRoot * 0.3, rTrail[2]];

    const tLeadTop = [tLead[0], tLead[1] + thickTip, tLead[2]];
    const tLeadBot = [tLead[0], tLead[1] - thickTip, tLead[2]];
    const tTrailTop = [tTrail[0], tTrail[1] + thickTip * 0.3, tTrail[2]];
    const tTrailBot = [tTrail[0], tTrail[1] - thickTip * 0.3, tTrail[2]];

    const positions: number[] = [];
    const addQuad = (v0: number[], v1: number[], v2: number[], v3: number[], flip = false) => {
      if (flip) {
        positions.push(...v0, ...v2, ...v1, ...v0, ...v3, ...v2);
      } else {
        positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
      }
    };

    addQuad(rLeadTop, tLeadTop, tTrailTop, rTrailTop, !isRight);
    addQuad(rLeadBot, rTrailBot, tTrailBot, tLeadBot, !isRight);
    addQuad(rLeadTop, rLeadBot, tLeadBot, tLeadTop, isRight);
    addQuad(rTrailTop, tTrailTop, tTrailBot, rTrailBot, isRight);
    addQuad(tLeadTop, tTrailTop, tTrailBot, tLeadBot, isRight);

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Evaluates standard NACA 4-digit airfoil thickness and camber curves.
   */
  private getNaca4Profile(
    s: number,
    maxThickness: number,
    maxCamber: number,
    camberLoc: number
  ): { yUpper: number; yLower: number } {
    const clampedS = Math.max(0, Math.min(1, s));

    // Standard NACA half-thickness distribution
    const yt =
      5 *
      maxThickness *
      (0.2969 * Math.sqrt(clampedS) -
        0.126 * clampedS -
        0.3516 * clampedS * clampedS +
        0.2843 * clampedS * clampedS * clampedS -
        0.1015 * clampedS * clampedS * clampedS * clampedS);

    let yc = 0;
    if (maxCamber > 0 && camberLoc > 0) {
      if (clampedS < camberLoc) {
        yc = (maxCamber / (camberLoc * camberLoc)) * (2 * camberLoc * clampedS - clampedS * clampedS);
      } else {
        yc =
          (maxCamber / ((1 - camberLoc) * (1 - camberLoc))) *
          (1 - 2 * camberLoc + 2 * camberLoc * clampedS - clampedS * clampedS);
      }
    }

    return {
      yUpper: yc + yt,
      yLower: yc - yt,
    };
  }

  /**
   * Generates a 128x128 radial gradient glow texture for additive aviation light sprites.
   */
  private createGlowTexture(colorHex: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const radial = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    radial.addColorStop(0.0, '#ffffff'); // Intense hot core
    radial.addColorStop(0.2, colorHex);   // Rich saturated halo
    radial.addColorStop(0.55, colorHex);  // Soft atmospheric bloom
    radial.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Builds the soft radial ground shadow that projects onto the concrete skatepark surface.
   */
  private buildGroundShadow(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 256, 256);

    // Soft ambient ground shadow falloff
    const radial = ctx.createRadialGradient(128, 128, 8, 128, 128, 120);
    radial.addColorStop(0, 'rgba(8, 12, 18, 0.72)');
    radial.addColorStop(0.25, 'rgba(12, 16, 22, 0.52)');
    radial.addColorStop(0.6, 'rgba(16, 20, 28, 0.22)');
    radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();

    // Center silhouette darkening for fuselage & wings
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath();
    // Fuselage shadow (along Y axis in texture)
    ctx.ellipse(128, 128, 16, 92, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wings shadow (along X axis in texture)
    ctx.beginPath();
    ctx.ellipse(128, 128, 98, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    const shadowTex = new THREE.CanvasTexture(canvas);
    shadowTex.colorSpace = THREE.SRGBColorSpace;
    shadowTex.needsUpdate = true;

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const shadowGeo = new THREE.PlaneGeometry(46, 46);
    this.shadowMesh = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadowMesh.rotation.x = -Math.PI / 2; // Lie flat on ground plane
    this.shadowGroup.add(this.shadowMesh);
  }
}
