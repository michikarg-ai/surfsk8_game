import * as THREE from 'three';
import { ParkSurface } from '../physics/ParkSurface';
import { SurfHUD } from '../ui/SurfHUD';
import { SurfAudio } from '../audio/SurfAudio';
import { SurfskateController } from '../physics/SurfskateController';

/**
 * Creates a high-contrast floating canvas billboard sprite for 3D world gates.
 */
function createTextSprite(title: string, subtitle: string, accentColor: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas.getContext('2d')!;

  // Rounded rectangular card background
  ctx.fillStyle = 'rgba(12, 16, 24, 0.88)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(16, 16, 480, 112, 24);
  } else {
    const x = 16,
      y = 16,
      w = 480,
      h = 112,
      r = 24;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  ctx.fill();

  // Glowing neon accent border
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Primary title text
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 36px "Barlow Condensed", "Impact", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 52);

  // Subtitle readout / instructions
  ctx.fillStyle = accentColor;
  ctx.font = '700 22px "Barlow Condensed", sans-serif';
  ctx.fillText(subtitle, 256, 94);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.4, 0.96, 1.0);
  return sprite;
}

/**
 * "Follow the Flow" Game Mode Challenge for Skatepark "Im Gefilde".
 *
 * The player enters the Starting Gate in front of the spawn point to activate the challenge.
 * A glowing 3D flow line appears across the park, guiding the skater through a continuous
 * wall-to-wall wave carve without stalling. Finishing the line awards +2000 points.
 */
export class FlowLineChallenge {
  public readonly group = new THREE.Group();

  /** 10 Authentic LiDAR / aerial orthophoto flow waypoints around Skatepark "Im Gefilde". */
  public static readonly WAYPOINTS_2D: readonly THREE.Vector2[] = [
    new THREE.Vector2(11.4, 3.2), // 1. Start Gate in front of spawn (15.2, 4.2)
    new THREE.Vector2(6.8, 1.4), // 2. Sweeping carve past Central Volcano
    new THREE.Vector2(1.4, -2.8), // 3. Transition into NW basin
    new THREE.Vector2(-4.8, -7.2), // 4. NW Upper Spine Roller wall
    new THREE.Vector2(-6.6, -11.5), // 5. NW Cradle Bowl pocket wall-to-wall carve
    new THREE.Vector2(-8.8, -3.2), // 6. West transition bank
    new THREE.Vector2(-4.0, 5.6), // 7. SW transition wall
    new THREE.Vector2(1.2, 10.8), // 8. South Clover Bowl wall
    new THREE.Vector2(10.6, 12.8), // 9. SE Deep Bowl wall
    new THREE.Vector2(16.2, 5.8), // 10. Finish Gate at East Sunset Palm Mural wall
  ];

  public static readonly NUM_SAMPLE_POINTS = 160;
  public static readonly START_TRIGGER_RADIUS = 2.6;
  public static readonly MAX_ALLOWED_DISTANCE = 4.8;
  public static readonly FINISH_TRIGGER_RADIUS = 3.0;
  public static readonly FINISH_MIN_PROGRESS = 0.95;

  public isActive = false;
  private progressIdx = 0;
  private retriggerCooldown = 0;

  // 3D Spline and sampled points
  private curve!: THREE.CatmullRomCurve3;
  private curvePoints: THREE.Vector3[] = [];

  // Scene sub-groups
  private startGateGroup = new THREE.Group();
  private flowLineGroup = new THREE.Group();
  private finishGateGroup = new THREE.Group();

  // Mesh references for animation
  private startOuterRing!: THREE.Mesh;
  private startInnerRing!: THREE.Mesh;
  private startBeacon!: THREE.Mesh;
  private startLabelSprite!: THREE.Sprite;
  private startLight!: THREE.PointLight;

  private tubeMesh!: THREE.Mesh;
  private tubeMaterial!: THREE.MeshStandardMaterial;
  private pulseMarkers: THREE.Mesh[] = [];

  private finishArchRing!: THREE.Mesh;
  private finishLabelSprite!: THREE.Sprite;
  private finishLight!: THREE.PointLight;

  constructor(
    private scene: THREE.Scene,
    private parkSurface: ParkSurface,
    private hud: SurfHUD,
    private audio: SurfAudio
  ) {
    this.group.name = 'FlowLineChallenge';
    this.scene.add(this.group);

    this.group.add(this.startGateGroup);
    this.group.add(this.flowLineGroup);
    this.group.add(this.finishGateGroup);

    this.buildCurveAndGeometry();
    this.buildStartGateVisuals();
    this.buildFlowLineVisuals();
    this.buildFinishGateVisuals();

    // Default state: line and finish gate are hidden until player enters start point
    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;
  }

  /**
   * Samples park surface heights and generates the 3D CatmullRom spline and tube geometry.
   */
  private buildCurveAndGeometry(): void {
    const rawControlPoints = FlowLineChallenge.WAYPOINTS_2D.map(
      (pt) =>
        new THREE.Vector3(
          pt.x,
          this.parkSurface.sample(pt.x, pt.y).height + 0.08,
          pt.y
        )
    );

    const rawCurve = new THREE.CatmullRomCurve3(
      rawControlPoints,
      false,
      'centripetal',
      0.5
    );
    const sampled = rawCurve.getPoints(FlowLineChallenge.NUM_SAMPLE_POINTS);

    // Re-sample height exactly from park surface at every single point along the path
    for (const p of sampled) {
      p.y = this.parkSurface.sample(p.x, p.z).height + 0.08;
    }

    this.curvePoints = sampled;
    this.curve = new THREE.CatmullRomCurve3(sampled, false, 'centripetal', 0.5);
  }

  /**
   * Builds the Starting Gate: glowing cyan/orange concentric ground rings, light beacon & floating label.
   */
  private buildStartGateVisuals(): void {
    // 1. Outer glowing cyan ring
    const outerGeo = new THREE.TorusGeometry(1.6, 0.045, 8, 48);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.startOuterRing = new THREE.Mesh(outerGeo, outerMat);
    this.startOuterRing.rotation.x = -Math.PI / 2;
    this.startOuterRing.position.y = 0.03;
    this.startGateGroup.add(this.startOuterRing);

    // 2. Inner glowing warm orange ring
    const innerGeo = new THREE.TorusGeometry(1.1, 0.035, 8, 36);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff9f1c,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.startInnerRing = new THREE.Mesh(innerGeo, innerMat);
    this.startInnerRing.rotation.x = -Math.PI / 2;
    this.startInnerRing.position.y = 0.03;
    this.startGateGroup.add(this.startInnerRing);

    // 3. Ground contact glow decal disc
    const discGeo = new THREE.CircleGeometry(1.65, 36);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.015;
    this.startGateGroup.add(disc);

    // 4. Vertical cylindrical light beacon
    const beaconGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 32, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.startBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.startBeacon.position.y = 1.6;
    this.startGateGroup.add(this.startBeacon);

    // 5. Left and right vertical neon totems
    const totemGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 12);
    const totemMat = new THREE.MeshStandardMaterial({
      color: 0xff9f1c,
      emissive: 0xff9f1c,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    const capGeo = new THREE.SphereGeometry(0.09, 12, 12);
    const capMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });

    const leftTotem = new THREE.Mesh(totemGeo, totemMat);
    leftTotem.position.set(-1.6, 1.3, 0);
    const leftCap = new THREE.Mesh(capGeo, capMat);
    leftCap.position.set(-1.6, 2.6, 0);
    this.startGateGroup.add(leftTotem);
    this.startGateGroup.add(leftCap);

    const rightTotem = new THREE.Mesh(totemGeo, totemMat);
    rightTotem.position.set(1.6, 1.3, 0);
    const rightCap = new THREE.Mesh(capGeo, capMat);
    rightCap.position.set(1.6, 2.6, 0);
    this.startGateGroup.add(rightTotem);
    this.startGateGroup.add(rightCap);

    // 6. PointLight casting warm cyan radiance onto concrete
    this.startLight = new THREE.PointLight(0x00f5d4, 2.0, 7.0);
    this.startLight.position.set(0, 1.4, 0);
    this.startGateGroup.add(this.startLight);

    // 7. Floating Canvas Label Sprite: "FLOW LINE START"
    this.startLabelSprite = createTextSprite(
      '🌊 FLOW LINE START',
      'SKATE HERE TO BEGIN',
      '#00f5d4'
    );
    this.startLabelSprite.position.set(0, 2.4, 0);
    this.startGateGroup.add(this.startLabelSprite);

    this.updateStartGatePosition();
  }

  /**
   * Builds the 3D neon flow line tube and animated pulse markers.
   */
  private buildFlowLineVisuals(): void {
    const tubeGeo = new THREE.TubeGeometry(
      this.curve,
      FlowLineChallenge.NUM_SAMPLE_POINTS,
      0.075,
      8,
      false
    );
    this.tubeMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d4f5,
      emissiveIntensity: 1.3,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.95,
    });
    this.tubeMesh = new THREE.Mesh(tubeGeo, this.tubeMaterial);
    this.flowLineGroup.add(this.tubeMesh);

    // 8 Animated glowing pulse markers traveling along the line
    const markerGeo = new THREE.TorusGeometry(0.24, 0.04, 8, 20);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < 8; i++) {
      const marker = new THREE.Mesh(markerGeo, markerMat);
      this.flowLineGroup.add(marker);
      this.pulseMarkers.push(marker);
    }
  }

  /**
   * Builds the Finish Gate: glowing golden arch, light beam & floating bonus banner.
   */
  private buildFinishGateVisuals(): void {
    // 1. Glowing golden finish arch
    const archGeo = new THREE.TorusGeometry(1.6, 0.065, 8, 36);
    const archMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffaa00,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
    this.finishArchRing = new THREE.Mesh(archGeo, archMat);
    this.finishArchRing.position.set(0, 1.4, 0);
    this.finishGateGroup.add(this.finishArchRing);

    // 2. Ground finish bar
    const barGeo = new THREE.BoxGeometry(3.0, 0.03, 0.28);
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.9,
    });
    const finishBar = new THREE.Mesh(barGeo, barMat);
    finishBar.position.set(0, 0.02, 0);
    this.finishGateGroup.add(finishBar);

    // 3. Side support pillars
    const pillarGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.6, 12);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xff9900,
      emissiveIntensity: 0.8,
    });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-1.6, 0.8, 0);
    this.finishGateGroup.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(1.6, 0.8, 0);
    this.finishGateGroup.add(rightPillar);

    // 4. Warm golden PointLight
    this.finishLight = new THREE.PointLight(0xffaa00, 2.4, 8.0);
    this.finishLight.position.set(0, 1.5, 0);
    this.finishGateGroup.add(this.finishLight);

    // 5. Floating Canvas Label Sprite: "FINISH GATE (+2000)"
    this.finishLabelSprite = createTextSprite(
      '🏁 FINISH GATE',
      '+2000 FLOW BONUS',
      '#ffd166'
    );
    this.finishLabelSprite.position.set(0, 2.4, 0);
    this.finishGateGroup.add(this.finishLabelSprite);

    this.updateFinishGatePosition();
  }

  private updateStartGatePosition(): void {
    if (!this.curvePoints.length) return;
    const startPt = this.curvePoints[0];
    this.startGateGroup.position.set(startPt.x, startPt.y - 0.08, startPt.z);
  }

  private updateFinishGatePosition(): void {
    if (!this.curvePoints.length) return;
    const finishPt = this.curvePoints[this.curvePoints.length - 1];
    this.finishGateGroup.position.set(finishPt.x, finishPt.y - 0.08, finishPt.z);

    const tangent = this.curve.getTangentAt(1.0);
    const angle = Math.atan2(tangent.x, tangent.z);
    this.finishGateGroup.rotation.y = angle;
  }

  /**
   * Refreshes the curve and tube geometry to hug the exact LiDAR / C2 surface.
   * Called on initial LiDAR grid load and when switching skateparks.
   */
  public refreshSurfaceHeights(): void {
    for (const p of this.curvePoints) {
      p.y = this.parkSurface.sample(p.x, p.z).height + 0.08;
    }
    this.curve = new THREE.CatmullRomCurve3(
      this.curvePoints,
      false,
      'centripetal',
      0.5
    );

    if (this.tubeMesh) {
      this.tubeMesh.geometry.dispose();
      this.tubeMesh.geometry = new THREE.TubeGeometry(
        this.curve,
        FlowLineChallenge.NUM_SAMPLE_POINTS,
        0.075,
        8,
        false
      );
    }

    this.updateStartGatePosition();
    this.updateFinishGatePosition();
  }

  public update(
    dt: number,
    timeSec: number,
    controller: SurfskateController
  ): void {
    if (this.retriggerCooldown > 0) {
      this.retriggerCooldown = Math.max(0, this.retriggerCooldown - dt);
    }

    if (!this.isActive) {
      // Animate starting gate when idle
      this.startOuterRing.rotation.z = timeSec * 0.8;
      this.startInnerRing.rotation.z = -timeSec * 1.1;
      (this.startBeacon.material as THREE.MeshBasicMaterial).opacity =
        0.24 + Math.sin(timeSec * 3.0) * 0.08;
      this.startLabelSprite.position.y =
        2.4 + Math.sin(timeSec * 2.4) * 0.08;

      // Check if skater enters starting gate
      const startPt = this.curvePoints[0];
      const distToStart = Math.hypot(
        controller.position.x - startPt.x,
        controller.position.z - startPt.z
      );

      if (
        this.retriggerCooldown <= 0 &&
        distToStart < FlowLineChallenge.START_TRIGGER_RADIUS
      ) {
        this.startChallenge();
      }
      return;
    }

    // --- ACTIVE FLOW LINE CHALLENGE ---

    // 1. Animate pulse markers cruising along the line
    const numMarkers = this.pulseMarkers.length;
    for (let i = 0; i < numMarkers; i++) {
      const t = (timeSec * 0.18 + i / numMarkers) % 1.0;
      this.curve.getPointAt(t, this.pulseMarkers[i].position);
      const tangent = this.curve.getTangentAt(t);
      this.pulseMarkers[i].quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        tangent
      );
    }

    // 2. Animate finish gate arch
    this.finishArchRing.rotation.z = timeSec * 1.2;
    this.finishLabelSprite.position.y =
      2.4 + Math.sin(timeSec * 2.6) * 0.08;

    // 3. Wipeout / Bail ends the challenge
    if (controller.isBailing) {
      this.failChallenge('FLOW LINE LOST!');
      return;
    }

    // 4. Progress tracking along active local window
    const minSearchIdx = Math.max(0, this.progressIdx - 2);
    const maxSearchIdx = Math.min(
      this.curvePoints.length - 1,
      this.progressIdx + 14
    );

    let closestIdx = this.progressIdx;
    let minDistSq = Infinity;

    for (let i = minSearchIdx; i <= maxSearchIdx; i++) {
      const pt = this.curvePoints[i];
      const dx = controller.position.x - pt.x;
      const dz = controller.position.z - pt.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDistSq) {
        minDistSq = dSq;
        closestIdx = i;
      }
    }

    if (closestIdx > this.progressIdx) {
      this.progressIdx = closestIdx;
    }

    const distToLine = Math.sqrt(minDistSq);

    // 5. Check if skater is too far away from the line
    if (distToLine > FlowLineChallenge.MAX_ALLOWED_DISTANCE) {
      this.failChallenge('FLOW LINE ENDED — TOO FAR!');
      return;
    }

    // 6. Wave Flow Speed Assist: surfing an endless wave without stalling
    if (controller.speed > 1.0 && controller.speed < 5.2) {
      controller.speed = Math.min(5.8, controller.speed + dt * 1.1);
    }

    // 7. Live HUD Progress Hint
    const progressFrac =
      this.progressIdx / (this.curvePoints.length - 1);
    const pct = Math.round(progressFrac * 100);
    this.hud.setFlowLineHint(`🌊 FOLLOW THE FLOW: ${pct}%`);

    // 8. Check Finish Gate completion
    const finishPt = this.curvePoints[this.curvePoints.length - 1];
    const distToFinish = Math.hypot(
      controller.position.x - finishPt.x,
      controller.position.z - finishPt.z
    );

    if (
      progressFrac >= FlowLineChallenge.FINISH_MIN_PROGRESS &&
      distToFinish < FlowLineChallenge.FINISH_TRIGGER_RADIUS
    ) {
      this.completeChallenge();
    }
  }

  private startChallenge(): void {
    this.isActive = true;
    this.progressIdx = 0;

    this.startGateGroup.visible = false;
    this.flowLineGroup.visible = true;
    this.finishGateGroup.visible = true;

    this.hud.showTrickBanner('🌊 FOLLOW THE FLOW!', true);
    this.hud.setFlowLineHint('🌊 FOLLOW THE FLOW: 0%');
    this.audio.playManeuverChime();
  }

  private failChallenge(reason: string): void {
    this.isActive = false;
    this.retriggerCooldown = 1.5;

    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
    if (reason === 'FLOW LINE LOST!') {
      this.hud.showBailBanner(reason);
    } else {
      this.hud.showTrickBanner(reason, false);
    }
  }

  private completeChallenge(): void {
    this.isActive = false;
    this.retriggerCooldown = 2.0;

    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
    this.hud.awardBonusPoints(2000, 'FLOW LINE COMPLETE! +2000');
    this.audio.playPretzelPickup(true);
  }

  public reset(): void {
    this.isActive = false;
    this.progressIdx = 0;
    this.retriggerCooldown = 0;

    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
  }
}
