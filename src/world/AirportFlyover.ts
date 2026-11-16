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
 * Spawns a high-fidelity, 100% copyright-free procedural commercial passenger jet
 * (Airbus A320 / Boeing 737 twin-jet style) flying low over the Airport Skatepark
 * (Hallbergmoos near Munich Airport MUC) every 5 minutes (300s), with the first flyover
 * occurring 18 seconds after entering the park.
 *
 * Features:
 * - Full procedural commercial airliner with A320/737 proportions (~36m wingspan & length)
 * - Glossy white fuselage with aerodynamic gray belly fairing & SRFSK8 turquoise/orange wave livery
 * - Dark tinted cockpit window band and twin passenger window lines
 * - Swept wings with realistic dihedral, upturned Sharklets / winglets, and flap-track fairing canoes
 * - Two high-bypass turbofan engines with polished chrome intake lips and spinning fan blades
 * - Swept empennage (vertical fin with wave design + horizontal stabilizers)
 * - Full aviation lighting: port (red) & starboard (green) nav lights, blinking white wingtip strobes,
 *   and flashing red anti-collision beacon lights
 * - Large soft ground shadow sweeping over the skatepark concrete at y ≈ 0.04
 * - Multiple approach and takeoff flight corridors across the skatepark airspace
 * - Synchronized Web Audio Doppler-shifted jet engine flyover sound
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
  private beaconMat: THREE.MeshBasicMaterial;
  private beaconLight: THREE.PointLight;
  private strobeMat: THREE.MeshBasicMaterial;
  private strobeLight: THREE.PointLight;

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

    // Initialize aviation lighting materials & lights
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    this.beaconLight = new THREE.PointLight(0xff1818, 0, 30);
    this.strobeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    this.strobeLight = new THREE.PointLight(0xffffff, 0, 45);

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

      // Orientation: nose faces flight direction with bank & pitch
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
   * Updates flashing anti-collision beacons (1.0 Hz) and wingtip strobes (1.2 Hz double-flash).
   */
  private updateAviationLighting(timeSec: number): void {
    // 1. Red anti-collision beacon pulse (every 1.0 sec)
    const beaconCycle = timeSec % 1.0;
    const isBeaconOn = beaconCycle < 0.14;
    this.beaconMat.color.setHex(isBeaconOn ? 0xff1515 : 0x2b0404);
    this.beaconLight.intensity = isBeaconOn ? 2.2 : 0;

    // 2. White wingtip strobe double-flash (every 1.25 sec)
    const strobeCycle = timeSec % 1.25;
    const isStrobeOn =
      strobeCycle < 0.05 || (strobeCycle > 0.11 && strobeCycle < 0.16);
    this.strobeMat.color.setHex(isStrobeOn ? 0xffffff : 0x1a1a1a);
    this.strobeLight.intensity = isStrobeOn ? 3.5 : 0;
  }

  /**
   * Builds the procedural 3D passenger aircraft model.
   * Airbus A320 / Boeing 737 twin-jet dimensions:
   * - Wingspan: ~35.8m
   * - Fuselage length: ~37.2m
   * - Height: ~11.6m
   */
  private buildAirplaneModel(): void {
    const fuselageWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf4f6fa,
      roughness: 0.28,
      metalness: 0.12,
    });

    const bellyGrayMat = new THREE.MeshStandardMaterial({
      color: 0x636e7a,
      roughness: 0.42,
      metalness: 0.18,
    });

    const liveryCyanMat = new THREE.MeshStandardMaterial({
      color: 0x00b4d8,
      roughness: 0.32,
      metalness: 0.15,
    });

    const liveryOrangeMat = new THREE.MeshStandardMaterial({
      color: 0xf77f00,
      roughness: 0.35,
      metalness: 0.15,
    });

    const darkNavyMat = new THREE.MeshStandardMaterial({
      color: 0x0c2340,
      roughness: 0.38,
      metalness: 0.15,
    });

    const windowGlassMat = new THREE.MeshStandardMaterial({
      color: 0x111622,
      roughness: 0.12,
      metalness: 0.88,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd8d8d8,
      roughness: 0.14,
      metalness: 0.92,
    });

    const exhaustTitaniumMat = new THREE.MeshStandardMaterial({
      color: 0x3d3d44,
      roughness: 0.35,
      metalness: 0.85,
    });

    // ==========================================
    // 1. FUSELAGE (Rumpf)
    // ==========================================
    // Main cylindrical fuselage tube (radius 1.95m, length 22m)
    const mainTubeGeo = new THREE.CylinderGeometry(1.95, 1.95, 22, 28);
    mainTubeGeo.rotateX(Math.PI / 2);
    const mainTube = new THREE.Mesh(mainTubeGeo, fuselageWhiteMat);
    mainTube.position.set(0, 0, 0);
    this.airplaneGroup.add(mainTube);

    // Nose cone (smooth transition from cylinder to rounded nose)
    const noseConeGeo = new THREE.CylinderGeometry(0.35, 1.95, 6.0, 28);
    noseConeGeo.rotateX(Math.PI / 2);
    const noseCone = new THREE.Mesh(noseConeGeo, fuselageWhiteMat);
    noseCone.position.set(0, -0.15, 14.0);
    this.airplaneGroup.add(noseCone);

    // Front radome sphere cap
    const radomeGeo = new THREE.SphereGeometry(0.42, 18, 14);
    const radome = new THREE.Mesh(radomeGeo, fuselageWhiteMat);
    radome.position.set(0, -0.15, 17.0);
    this.airplaneGroup.add(radome);

    // Tail cone (tapering to APU exhaust)
    const tailConeGeo = new THREE.CylinderGeometry(0.55, 1.95, 9.2, 28);
    tailConeGeo.rotateX(Math.PI / 2);
    const tailCone = new THREE.Mesh(tailConeGeo, fuselageWhiteMat);
    tailCone.position.set(0, 0.45, -15.6);
    this.airplaneGroup.add(tailCone);

    // APU exhaust nozzle
    const apuGeo = new THREE.CylinderGeometry(0.25, 0.32, 0.8, 16);
    apuGeo.rotateX(Math.PI / 2);
    const apu = new THREE.Mesh(apuGeo, exhaustTitaniumMat);
    apu.position.set(0, 0.85, -20.4);
    this.airplaneGroup.add(apu);

    // Aerodynamic belly fairing underneath center fuselage
    const bellyGeo = new THREE.BoxGeometry(4.2, 0.95, 13.5);
    const belly = new THREE.Mesh(bellyGeo, bellyGrayMat);
    belly.position.set(0, -1.55, 0.5);
    this.airplaneGroup.add(belly);

    // Stylized livery cheatlines along fuselage (Cyan & Orange stripes)
    const cyanStripeGeo = new THREE.BoxGeometry(3.96, 0.18, 26.0);
    const cyanStripe = new THREE.Mesh(cyanStripeGeo, liveryCyanMat);
    cyanStripe.position.set(0, -0.4, 1.5);
    this.airplaneGroup.add(cyanStripe);

    const orangeStripeGeo = new THREE.BoxGeometry(3.96, 0.12, 24.5);
    const orangeStripe = new THREE.Mesh(orangeStripeGeo, liveryOrangeMat);
    orangeStripe.position.set(0, -0.58, 1.0);
    this.airplaneGroup.add(orangeStripe);

    // ==========================================
    // 2. COCKPIT & CABIN WINDOWS
    // ==========================================
    // Dark cockpit windshield wrap
    const cockpitGeo = new THREE.BoxGeometry(2.35, 0.52, 1.3);
    const cockpit = new THREE.Mesh(cockpitGeo, windowGlassMat);
    cockpit.position.set(0, 0.92, 14.2);
    cockpit.rotation.x = -0.32; // tilted back to match nose curve
    this.airplaneGroup.add(cockpit);

    // Side passenger windows (InstancedMesh for optimal performance)
    const singleWinGeo = new THREE.BoxGeometry(0.08, 0.36, 0.26);
    const winCountPerSide = 28;
    const totalWindows = winCountPerSide * 2;
    const windowsMesh = new THREE.InstancedMesh(singleWinGeo, windowGlassMat, totalWindows);
    const dummyMat = new THREE.Matrix4();
    let winIdx = 0;

    for (let i = 0; i < winCountPerSide; i++) {
      const zPos = 8.5 - i * 0.65;
      // Skip over emergency exit door gap
      if (Math.abs(zPos - 1.2) < 0.4) continue;

      // Right side windows
      dummyMat.setPosition(1.94, 0.38, zPos);
      windowsMesh.setMatrixAt(winIdx++, dummyMat);

      // Left side windows
      dummyMat.setPosition(-1.94, 0.38, zPos);
      windowsMesh.setMatrixAt(winIdx++, dummyMat);
    }
    windowsMesh.instanceMatrix.needsUpdate = true;
    this.airplaneGroup.add(windowsMesh);

    // ==========================================
    // 3. MAIN WINGS (Haupttragflächen)
    // ==========================================
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xdee3eb,
      roughness: 0.36,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });

    const rightWingGeo = this.createWingGeometry(true);
    const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
    this.airplaneGroup.add(rightWing);

    const leftWingGeo = this.createWingGeometry(false);
    const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
    this.airplaneGroup.add(leftWing);

    // Upturned Sharklets / Winglets at wingtips (1.8m height)
    [-17.65, 17.65].forEach((xPos, idx) => {
      const isRight = idx === 1;
      const sharkletGeo = new THREE.BoxGeometry(0.12, 1.75, 1.2);
      sharkletGeo.rotateX(-0.35); // swept back
      const sharklet = new THREE.Mesh(sharkletGeo, liveryCyanMat);
      sharklet.position.set(xPos, 1.82, -3.9);
      this.airplaneGroup.add(sharklet);

      // High-visibility orange tip on sharklet
      const sharkletTipGeo = new THREE.BoxGeometry(0.14, 0.45, 0.85);
      sharkletTipGeo.rotateX(-0.35);
      const sharkletTip = new THREE.Mesh(sharkletTipGeo, liveryOrangeMat);
      sharkletTip.position.set(xPos, 2.58, -4.15);
      this.airplaneGroup.add(sharkletTip);

      // Flap track fairings under each wing
      const fairingOffsets = [4.5, 8.4, 12.3];
      fairingOffsets.forEach((fx) => {
        const sign = isRight ? 1 : -1;
        const fairingGeo = new THREE.CylinderGeometry(0.16, 0.04, 2.4, 10);
        fairingGeo.rotateX(Math.PI / 2);
        const fairing = new THREE.Mesh(fairingGeo, wingMat);
        const yDihedral = -0.35 + (fx / 17.65) * 1.3;
        const zSweep = -2.6 - (fx / 17.65) * 2.1;
        fairing.position.set(fx * sign, yDihedral, zSweep);
        this.airplaneGroup.add(fairing);
      });
    });

    // ==========================================
    // 4. TURBOFAN ENGINES
    // ==========================================
    [-5.8, 5.8].forEach((engX) => {
      const engineGroup = new THREE.Group();
      engineGroup.position.set(engX, -1.05, 2.1);

      // Engine pylon connecting nacelle to wing underside
      const pylonGeo = new THREE.BoxGeometry(0.28, 0.85, 2.9);
      const pylon = new THREE.Mesh(pylonGeo, wingMat);
      pylon.position.set(0, 0.65, -0.2);
      engineGroup.add(pylon);

      // Nacelle outer cowl (length 4.2m, diameter 2.2m)
      const cowlGeo = new THREE.CylinderGeometry(1.12, 1.05, 4.1, 24);
      cowlGeo.rotateX(Math.PI / 2);
      const cowl = new THREE.Mesh(cowlGeo, fuselageWhiteMat);
      engineGroup.add(cowl);

      // Chrome intake lip ring
      const lipGeo = new THREE.TorusGeometry(1.09, 0.08, 12, 28);
      const lip = new THREE.Mesh(lipGeo, chromeMat);
      lip.position.set(0, 0, 2.05);
      engineGroup.add(lip);

      // Dark inner intake duct
      const ductGeo = new THREE.CylinderGeometry(0.98, 0.94, 1.4, 20);
      ductGeo.rotateX(Math.PI / 2);
      const ductMat = new THREE.MeshBasicMaterial({ color: 0x141416 });
      const duct = new THREE.Mesh(ductGeo, ductMat);
      duct.position.set(0, 0, 1.35);
      engineGroup.add(duct);

      // Spinning turbofan blades & spinner cone
      const fanGroup = new THREE.Group();
      fanGroup.position.set(0, 0, 1.2);

      const spinnerConeGeo = new THREE.ConeGeometry(0.32, 0.78, 16);
      spinnerConeGeo.rotateX(Math.PI / 2);
      const spinner = new THREE.Mesh(spinnerConeGeo, darkNavyMat);
      fanGroup.add(spinner);

      // 16 radial titanium fan blades
      const bladeGeo = new THREE.BoxGeometry(0.04, 0.62, 0.16);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x5a6068,
        roughness: 0.3,
        metalness: 0.7,
      });

      for (let b = 0; b < 16; b++) {
        const bladeAngle = (b / 16) * Math.PI * 2;
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(Math.cos(bladeAngle) * 0.48, Math.sin(bladeAngle) * 0.48, 0);
        blade.rotation.z = bladeAngle + 0.35; // aerodynamic pitch angle
        fanGroup.add(blade);
      }

      this.fanSpinners.push(fanGroup);
      engineGroup.add(fanGroup);

      // Rear exhaust nozzle
      const exhaustGeo = new THREE.CylinderGeometry(0.82, 0.68, 1.1, 20);
      exhaustGeo.rotateX(Math.PI / 2);
      const exhaust = new THREE.Mesh(exhaustGeo, exhaustTitaniumMat);
      exhaust.position.set(0, 0, -2.35);
      engineGroup.add(exhaust);

      // Core exhaust cone tip
      const coreConeGeo = new THREE.ConeGeometry(0.34, 1.2, 16);
      coreConeGeo.rotateX(-Math.PI / 2);
      const coreCone = new THREE.Mesh(coreConeGeo, exhaustTitaniumMat);
      coreCone.position.set(0, 0, -2.8);
      engineGroup.add(coreCone);

      this.airplaneGroup.add(engineGroup);
    });

    // ==========================================
    // 5. EMPENNAGE (Leitwerk)
    // ==========================================
    // Vertical fin (Seitenleitwerk) with dynamic SRFSK8 wave livery
    const finMat = new THREE.MeshStandardMaterial({
      color: 0x0c2340, // deep oceanic navy
      roughness: 0.32,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });

    const finGeo = this.createVerticalFinGeometry();
    const fin = new THREE.Mesh(finGeo, finMat);
    this.airplaneGroup.add(fin);

    // Decorative turquoise wave arc on the fin
    const finWaveGeo = new THREE.BoxGeometry(0.38, 2.8, 2.6);
    finWaveGeo.rotateX(-0.65);
    const finWave = new THREE.Mesh(finWaveGeo, liveryCyanMat);
    finWave.position.set(0, 5.2, -16.4);
    this.airplaneGroup.add(finWave);

    // Orange fin cap
    const finTipGeo = new THREE.BoxGeometry(0.34, 0.8, 1.6);
    finTipGeo.rotateX(-0.65);
    const finTip = new THREE.Mesh(finTipGeo, liveryOrangeMat);
    finTip.position.set(0, 8.2, -18.7);
    this.airplaneGroup.add(finTip);

    // Horizontal stabilizers (Höhenleitwerk, span ~12.2m)
    [-1, 1].forEach((sign) => {
      const hStabGeo = this.createHorizontalStabGeometry(sign > 0);
      const hStab = new THREE.Mesh(hStabGeo, wingMat);
      this.airplaneGroup.add(hStab);
    });

    // ==========================================
    // 6. AVIATION LIGHTING
    // ==========================================
    // Red navigation light on left wingtip (Port)
    const portNavGeo = new THREE.SphereGeometry(0.18, 12, 10);
    const portNavMat = new THREE.MeshBasicMaterial({ color: 0xff1525 });
    const portNav = new THREE.Mesh(portNavGeo, portNavMat);
    portNav.position.set(-17.7, 1.1, -3.8);
    this.airplaneGroup.add(portNav);

    // Green navigation light on right wingtip (Starboard)
    const stbdNavGeo = new THREE.SphereGeometry(0.18, 12, 10);
    const stbdNavMat = new THREE.MeshBasicMaterial({ color: 0x15ff35 });
    const stbdNav = new THREE.Mesh(stbdNavGeo, stbdNavMat);
    stbdNav.position.set(17.7, 1.1, -3.8);
    this.airplaneGroup.add(stbdNav);

    // White wingtip strobe lights
    [-17.75, 17.75].forEach((xPos) => {
      const strobeMesh = new THREE.Mesh(portNavGeo, this.strobeMat);
      strobeMesh.position.set(xPos, 1.1, -4.2);
      this.airplaneGroup.add(strobeMesh);
    });

    // Tail white strobe light
    const tailStrobeMesh = new THREE.Mesh(portNavGeo, this.strobeMat);
    tailStrobeMesh.position.set(0, 1.25, -20.6);
    this.airplaneGroup.add(tailStrobeMesh);

    // Red anti-collision beacons (top and belly of fuselage)
    const topBeacon = new THREE.Mesh(portNavGeo, this.beaconMat);
    topBeacon.position.set(0, 2.08, 1.2);
    this.airplaneGroup.add(topBeacon);

    const bellyBeacon = new THREE.Mesh(portNavGeo, this.beaconMat);
    bellyBeacon.position.set(0, -2.08, -0.6);
    this.airplaneGroup.add(bellyBeacon);

    // Lighting point sources for ambient flash reflections
    this.beaconLight.position.set(0, 2.6, 1.2);
    this.airplaneGroup.add(this.beaconLight);

    this.strobeLight.position.set(0, 1.5, -4.0);
    this.airplaneGroup.add(this.strobeLight);
  }

  /**
   * Constructs the swept, tapered main wing with dihedral and root break.
   */
  private createWingGeometry(isRight: boolean): THREE.BufferGeometry {
    const s = isRight ? 1 : -1;
    const geo = new THREE.BufferGeometry();

    // Key wing cross-sections: Root (x=1.95), Crank/Kink (x=5.8), Tip (x=17.6)
    // Vertices [x, y, z]
    const rLeadTop = [1.95 * s, 0.05, 4.2];
    const rTrailTop = [1.95 * s, -0.15, -2.4];
    const rLeadBot = [1.95 * s, -0.55, 4.2];
    const rTrailBot = [1.95 * s, -0.35, -2.4];

    const kLeadTop = [5.8 * s, 0.38, 1.8];
    const kTrailTop = [5.8 * s, 0.06, -3.1];
    const kLeadBot = [5.8 * s, -0.12, 1.8];
    const kTrailBot = [5.8 * s, -0.08, -3.1];

    const tLeadTop = [17.6 * s, 1.18, -3.0];
    const tTrailTop = [17.6 * s, 0.98, -4.7];
    const tLeadBot = [17.6 * s, 0.88, -3.0];
    const tTrailBot = [17.6 * s, 0.84, -4.7];

    const positions: number[] = [];

    const addQuad = (
      v0: number[],
      v1: number[],
      v2: number[],
      v3: number[],
      flip = false
    ) => {
      if (flip) {
        positions.push(...v0, ...v2, ...v1, ...v0, ...v3, ...v2);
      } else {
        positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
      }
    };

    // Upper wing surface (root to kink, kink to tip)
    addQuad(rLeadTop, kLeadTop, kTrailTop, rTrailTop, !isRight);
    addQuad(kLeadTop, tLeadTop, tTrailTop, kTrailTop, !isRight);

    // Lower wing surface
    addQuad(rLeadBot, rTrailBot, kTrailBot, kLeadBot, !isRight);
    addQuad(kLeadBot, kTrailBot, tTrailBot, tLeadBot, !isRight);

    // Leading edge
    addQuad(rLeadTop, rLeadBot, kLeadBot, kLeadTop, isRight);
    addQuad(kLeadTop, kLeadBot, tLeadBot, tLeadTop, isRight);

    // Trailing edge
    addQuad(rTrailTop, kTrailTop, kTrailBot, rTrailBot, isRight);
    addQuad(kTrailTop, tTrailTop, tTrailBot, kTrailBot, isRight);

    // Tip end cap
    addQuad(tLeadTop, tTrailTop, tTrailBot, tLeadBot, isRight);

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Constructs the swept vertical stabilizer fin.
   */
  private createVerticalFinGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const halfThickBase = 0.22;
    const halfThickTip = 0.08;

    // Base root vertices
    const bLeadR = [halfThickBase, 1.85, -10.5];
    const bLeadL = [-halfThickBase, 1.85, -10.5];
    const bTrailR = [halfThickBase * 0.7, 1.85, -18.8];
    const bTrailL = [-halfThickBase * 0.7, 1.85, -18.8];

    // Tip top vertices
    const tLeadR = [halfThickTip, 8.6, -18.4];
    const tLeadL = [-halfThickTip, 8.6, -18.4];
    const tTrailR = [halfThickTip * 0.6, 8.6, -20.2];
    const tTrailL = [-halfThickTip * 0.6, 8.6, -20.2];

    const positions: number[] = [];

    const addQuad = (v0: number[], v1: number[], v2: number[], v3: number[]) => {
      positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
    };

    // Right side
    addQuad(bLeadR, tLeadR, tTrailR, bTrailR);
    // Left side
    addQuad(bLeadL, bTrailL, tTrailL, tLeadL);
    // Leading edge
    addQuad(bLeadR, bLeadL, tLeadL, tLeadR);
    // Trailing edge
    addQuad(bTrailR, tTrailR, tTrailL, bTrailL);
    // Top cap
    addQuad(tLeadR, tLeadL, tTrailL, tTrailR);

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Constructs horizontal stabilizer wings.
   */
  private createHorizontalStabGeometry(isRight: boolean): THREE.BufferGeometry {
    const s = isRight ? 1 : -1;
    const geo = new THREE.BufferGeometry();

    const rLead = [0.55 * s, 1.05, -15.8];
    const rTrail = [0.55 * s, 1.05, -18.6];
    const tLead = [6.1 * s, 1.38, -19.4];
    const tTrail = [6.1 * s, 1.38, -20.6];

    const thickness = 0.16;
    const rLeadTop = [rLead[0], rLead[1] + thickness, rLead[2]];
    const rLeadBot = [rLead[0], rLead[1] - thickness, rLead[2]];
    const rTrailTop = [rTrail[0], rTrail[1] + thickness * 0.5, rTrail[2]];
    const rTrailBot = [rTrail[0], rTrail[1] - thickness * 0.5, rTrail[2]];

    const tLeadTop = [tLead[0], tLead[1] + thickness * 0.5, tLead[2]];
    const tLeadBot = [tLead[0], tLead[1] - thickness * 0.5, tLead[2]];
    const tTrailTop = [tTrail[0], tTrail[1] + thickness * 0.3, tTrail[2]];
    const tTrailBot = [tTrail[0], tTrail[1] - thickness * 0.3, tTrail[2]];

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
