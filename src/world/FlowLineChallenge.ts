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
  ctx.fillStyle = 'rgba(12, 16, 24, 0.45)';
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
  ctx.lineWidth = 2;
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
  sprite.scale.set(1.35, 0.38, 1.0);
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

  /** Authentic LiDAR / aerial orthophoto flow waypoints around Skatepark "Im Gefilde". */
  public static readonly WAYPOINTS_2D: readonly THREE.Vector2[] = [
    // Part 1: Start & initial pump/carve around Central Volcano & Spine
    new THREE.Vector2(13.2, 2.2),   // 1. Start Gate (where skater stands in sketch 1)
    new THREE.Vector2(10.2, 3.8),   // 2. Initial pump into central basin
    new THREE.Vector2(6.2, 2.4),    // 3. Climb up Central Volcano south-west bank
    new THREE.Vector2(7.4, -0.8),   // 4. High carve over Central Volcano dome (h ~ 1.1m)
    new THREE.Vector2(9.6, 1.4),    // 5. Drop down east side of Volcano
    new THREE.Vector2(3.2, 2.2),    // 6. Sweep west across flow basin
    // Part 2: NW Spine Rollers -> High NW Over-Vert Cradle -> 3 Waves along North Wall
    new THREE.Vector2(-4.5, 1.6),   // 7. Carve up SW/West Lower Spine Roller
    new THREE.Vector2(-8.2, -0.4),  // 8. Wrap around West bank (h ~ 0.9m)
    new THREE.Vector2(-4.2, -5.8),  // 9. Carve over NW Upper Spine Roller (h ~ 1.1m)
    new THREE.Vector2(-6.2, -10.2), // 10. Drop into NW Cradle pocket (h ~ 0.1m)
    new THREE.Vector2(-6.4, -14.2), // 11. HIGH wall climb up NW Over-Vert Cradle lip (h ~ 2.2m!)
    new THREE.Vector2(-3.0, -10.0), // 12. Drop down out of NW Cradle into North basin
    new THREE.Vector2(1.5, -14.2),  // 13. North Wall Wave 1 TOP (climb high up wall, h ~ 1.5m)
    new THREE.Vector2(3.5, -9.6),   // 14. North Wall Wave 1 BOTTOM (trough, h ~ 0.0m)
    new THREE.Vector2(7.2, -13.6),  // 15. North Wall Wave 2 TOP (climb high up wall, h ~ 1.7m)
    new THREE.Vector2(9.2, -9.2),   // 16. North Wall Wave 2 BOTTOM (trough, h ~ 0.1m)
    new THREE.Vector2(12.4, -11.6), // 17. North Wall Wave 3 TOP (climb high up NE wall, h ~ 1.8m)
    new THREE.Vector2(11.8, -6.8),  // 18. North Wall Wave 3 BOTTOM (trough, h ~ 0.0m)
    // Part 3: East Wall waves -> High Sunset Palm Mural Wall -> Finish Gate
    new THREE.Vector2(17.6, -5.4),  // 19. East Wall Wave 1 TOP (h ~ 1.2m)
    new THREE.Vector2(14.2, -2.6),  // 20. East Wall Wave 1 BOTTOM (h ~ 0.1m)
    new THREE.Vector2(19.2, -1.0),  // 21. East Wall Wave 2 TOP (h ~ 1.0m)
    new THREE.Vector2(15.2, 1.4),   // 22. East Wall Wave 2 BOTTOM (h ~ 0.1m)
    new THREE.Vector2(19.6, 5.0),   // 23. HIGH climb up East Sunset Palm-Tree Mural Wall (h ~ 1.7m!)
    new THREE.Vector2(15.4, 6.2),   // 24. Drop down Sunset Palm Mural Wall
    new THREE.Vector2(15.0, 8.6),   // 25. Final wall carve on SE lip (h ~ 1.3m)
    new THREE.Vector2(11.4, 3.2),   // 26. Finish Gate right near the Start area
  ];

  public static readonly NUM_SAMPLE_POINTS = 260;
  public static readonly START_TRIGGER_RADIUS = 1.8;
  public static readonly MAX_ALLOWED_DISTANCE = 5.5;
  public static readonly FINISH_TRIGGER_RADIUS = 3.0;
  public static readonly FINISH_MIN_PROGRESS = 0.95;

  public isActive = false;
  public isRecording = false;
  private recordedPoints: THREE.Vector2[] = [];
  private lastExportCode = '';
  public onRecordingStateChange?: (isRecording: boolean, pointCount: number) => void;

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

    this.buildCurveFromWaypoints(FlowLineChallenge.WAYPOINTS_2D);
    this.buildStartGateVisuals();
    this.buildFlowLineVisuals();
    this.buildFinishGateVisuals();
    this.ensureModalExists();

    // Default state: line and finish gate are hidden until player enters start point
    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;
  }

  /**
   * Samples park surface heights and generates the 3D CatmullRom spline and tube geometry.
   */
  public buildCurveFromWaypoints(waypoints: readonly THREE.Vector2[]): void {
    if (waypoints.length < 2) return;

    const rawControlPoints = waypoints.map(
      (pt) =>
        new THREE.Vector3(
          pt.x,
          this.parkSurface.sample(pt.x, pt.y).height + 0.05,
          pt.y
        )
    );

    const rawCurve = new THREE.CatmullRomCurve3(
      rawControlPoints,
      false,
      'centripetal',
      0.5
    );
    const sampleCount = Math.max(
      FlowLineChallenge.NUM_SAMPLE_POINTS,
      waypoints.length * 8
    );
    const sampled = rawCurve.getPoints(sampleCount);

    // Re-sample height exactly from park surface at every single point along the path
    for (const p of sampled) {
      p.y = this.parkSurface.sample(p.x, p.z).height + 0.05;
    }

    this.curvePoints = sampled;
    this.curve = new THREE.CatmullRomCurve3(sampled, false, 'centripetal', 0.5);

    if (this.tubeMesh) {
      this.tubeMesh.geometry.dispose();
      this.tubeMesh.geometry = new THREE.TubeGeometry(
        this.curve,
        sampleCount,
        0.034,
        8,
        false
      );
    }

    this.updateStartGatePosition();
    this.updateFinishGatePosition();
  }

  /**
   * Builds the Starting Gate: glowing cyan/orange concentric ground rings, light beacon & floating label.
   */
  private buildStartGateVisuals(): void {
    // 1. Outer glowing cyan ring
    const outerGeo = new THREE.TorusGeometry(0.52, 0.018, 8, 48);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    });
    this.startOuterRing = new THREE.Mesh(outerGeo, outerMat);
    this.startOuterRing.rotation.x = -Math.PI / 2;
    this.startOuterRing.position.y = 0.02;
    this.startGateGroup.add(this.startOuterRing);

    // 2. Inner glowing warm orange ring
    const innerGeo = new THREE.TorusGeometry(0.36, 0.014, 8, 36);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff9f1c,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    });
    this.startInnerRing = new THREE.Mesh(innerGeo, innerMat);
    this.startInnerRing.rotation.x = -Math.PI / 2;
    this.startInnerRing.position.y = 0.02;
    this.startGateGroup.add(this.startInnerRing);

    // 3. Ground contact glow decal disc
    const discGeo = new THREE.CircleGeometry(0.54, 36);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    this.startGateGroup.add(disc);

    // 4. Vertical cylindrical light beacon
    const beaconGeo = new THREE.CylinderGeometry(0.50, 0.50, 0.65, 32, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.startBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.startBeacon.position.y = 0.32;
    this.startGateGroup.add(this.startBeacon);

    // 5. PointLight casting warm cyan radiance onto concrete
    this.startLight = new THREE.PointLight(0x00f5d4, 0.6, 3.2);
    this.startLight.position.set(0, 0.45, 0);
    this.startGateGroup.add(this.startLight);

    // 6. Floating Canvas Label Sprite: "FLOW LINE START"
    this.startLabelSprite = createTextSprite(
      '🌊 FLOW LINE START',
      'SKATE HERE TO BEGIN',
      '#00f5d4'
    );
    this.startLabelSprite.position.set(0, 0.88, 0);
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
      0.034,
      8,
      false
    );
    this.tubeMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d4f5,
      emissiveIntensity: 0.65,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    this.tubeMesh = new THREE.Mesh(tubeGeo, this.tubeMaterial);
    this.flowLineGroup.add(this.tubeMesh);

    // 12 Animated glowing pulse marker triangles traveling along the line
    const markerGeo = new THREE.ConeGeometry(0.095, 0.22, 3);
    markerGeo.rotateX(Math.PI / 2);
    markerGeo.scale(1.0, 0.35, 1.0);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let i = 0; i < 12; i++) {
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
    const archGeo = new THREE.TorusGeometry(0.55, 0.022, 8, 32);
    const archMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffaa00,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      transparent: true,
      opacity: 0.38,
    });
    this.finishArchRing = new THREE.Mesh(archGeo, archMat);
    this.finishArchRing.position.set(0, 0.65, 0);
    this.finishGateGroup.add(this.finishArchRing);

    // 2. Ground finish bar
    const barGeo = new THREE.BoxGeometry(1.1, 0.015, 0.14);
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.42,
    });
    const finishBar = new THREE.Mesh(barGeo, barMat);
    finishBar.position.set(0, 0.01, 0);
    this.finishGateGroup.add(finishBar);

    // 3. Warm golden PointLight
    this.finishLight = new THREE.PointLight(0xffaa00, 0.8, 3.5);
    this.finishLight.position.set(0, 0.65, 0);
    this.finishGateGroup.add(this.finishLight);

    // 4. Floating Canvas Label Sprite: "FINISH GATE (+2000)"
    this.finishLabelSprite = createTextSprite(
      '🏁 FINISH GATE',
      '+2000 FLOW BONUS',
      '#ffd166'
    );
    this.finishLabelSprite.position.set(0, 0.95, 0);
    this.finishGateGroup.add(this.finishLabelSprite);

    this.updateFinishGatePosition();
  }

  private updateStartGatePosition(): void {
    if (!this.curvePoints.length) return;
    const startPt = this.curvePoints[0];
    this.startGateGroup.position.set(startPt.x, startPt.y - 0.05, startPt.z);
  }

  private updateFinishGatePosition(): void {
    if (!this.curvePoints.length) return;
    const finishPt = this.curvePoints[this.curvePoints.length - 1];
    this.finishGateGroup.position.set(finishPt.x, finishPt.y - 0.05, finishPt.z);

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
      p.y = this.parkSurface.sample(p.x, p.z).height + 0.05;
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
        0.034,
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

    // --- DEV RECORDER MODE: Skater is laying down a custom flow line ---
    if (this.isRecording) {
      const lastPt = this.recordedPoints[this.recordedPoints.length - 1];
      const dx = controller.position.x - lastPt.x;
      const dz = controller.position.z - lastPt.y;
      const dist = Math.hypot(dx, dz);

      if (dist >= 1.6) {
        const newPt = new THREE.Vector2(
          Number(controller.position.x.toFixed(2)),
          Number(controller.position.z.toFixed(2))
        );
        this.recordedPoints.push(newPt);
        if (this.recordedPoints.length >= 2) {
          this.buildCurveFromWaypoints(this.recordedPoints);
        }
        this.hud.setFlowLineHint(
          `🔴 REC FLOW LINE: ${this.recordedPoints.length} pts — Press [L] to finish & export`
        );
        this.onRecordingStateChange?.(true, this.recordedPoints.length);
      }

      if (this.recordedPoints.length >= 2 && this.curve) {
        const numMarkers = this.pulseMarkers.length;
        for (let i = 0; i < numMarkers; i++) {
          const t = (timeSec * 0.12 + i / numMarkers) % 1.0;
          this.curve.getPointAt(t, this.pulseMarkers[i].position);
          const tangent = this.curve.getTangentAt(t);
          this.pulseMarkers[i].quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            tangent
          );
        }
      }
      return;
    }

    if (!this.isActive) {
      // Animate starting gate when idle
      this.startOuterRing.rotation.z = timeSec * 0.8;
      this.startInnerRing.rotation.z = -timeSec * 1.1;
      (this.startBeacon.material as THREE.MeshBasicMaterial).opacity =
        0.06 + Math.sin(timeSec * 2.5) * 0.02;
      this.startLabelSprite.position.y =
        0.88 + Math.sin(timeSec * 2.4) * 0.04;

      if (this.finishGateGroup.visible) {
        this.finishArchRing.rotation.z = timeSec * 1.2;
        this.finishLabelSprite.position.y =
          0.95 + Math.sin(timeSec * 2.6) * 0.04;
      }

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
      const t = (timeSec * 0.08 + i / numMarkers) % 1.0;
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
      0.95 + Math.sin(timeSec * 2.6) * 0.04;

    // 3. Wipeout / Bail ends the challenge
    if (controller.isBailing) {
      this.failChallenge('FLOW LINE LOST!');
      return;
    }

    // 4. Progress tracking along active local window
    const minSearchIdx = Math.max(0, this.progressIdx - 2);
    const maxSearchIdx = Math.min(
      this.curvePoints.length - 1,
      this.progressIdx + 20
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

  public toggleRecording(currentPos: THREE.Vector3): void {
    if (!this.isRecording) {
      // START RECORDING
      this.isRecording = true;
      this.isActive = false;
      this.startGateGroup.visible = false;
      this.finishGateGroup.visible = false;
      this.flowLineGroup.visible = true;

      this.recordedPoints = [
        new THREE.Vector2(
          Number(currentPos.x.toFixed(2)),
          Number(currentPos.z.toFixed(2))
        ),
      ];

      this.closeExportModal();

      this.hud.showTrickBanner(
        '🔴 REC FLOW LINE — SKATE & PRESS [L] TO FINISH',
        true
      );
      this.hud.setFlowLineHint(
        '🔴 RECORDING FLOW LINE (1 pt) — Press [L] to stop'
      );
      this.onRecordingStateChange?.(true, 1);
    } else {
      // STOP RECORDING
      this.isRecording = false;

      const lastPt = this.recordedPoints[this.recordedPoints.length - 1];
      const dist = Math.hypot(currentPos.x - lastPt.x, currentPos.z - lastPt.y);
      if (dist >= 0.5) {
        this.recordedPoints.push(
          new THREE.Vector2(
            Number(currentPos.x.toFixed(2)),
            Number(currentPos.z.toFixed(2))
          )
        );
      }

      if (this.recordedPoints.length >= 3) {
        this.buildCurveFromWaypoints(this.recordedPoints);
        this.updateStartGatePosition();
        this.updateFinishGatePosition();
        this.startGateGroup.visible = true;
        this.finishGateGroup.visible = true;
        this.flowLineGroup.visible = true;

        const code =
          `public static readonly WAYPOINTS_2D: readonly THREE.Vector2[] = [\n` +
          this.recordedPoints
            .map(
              (p, i) =>
                `  new THREE.Vector2(${p.x.toFixed(2)}, ${p.y.toFixed(2)}), // ${i + 1}`
            )
            .join('\n') +
          `\n];`;

        this.lastExportCode = code;
        console.log(code);
        try {
          void navigator.clipboard?.writeText(code);
        } catch (err) {
          console.warn('Clipboard write failed:', err);
        }

        this.openExportModal(code);
        this.hud.showTrickBanner(
          `FLOW LINE SAVED: ${this.recordedPoints.length} PTS!`,
          true
        );
        this.hud.setFlowLineHint(
          'FLOW LINE READY — Enter Start Gate to test line'
        );
        this.onRecordingStateChange?.(false, this.recordedPoints.length);
      } else {
        this.hud.showTrickBanner('REC CANCELLED (NEED >= 3 PTS)', false);
        this.hud.setFlowLineHint(null);
        this.buildCurveFromWaypoints(FlowLineChallenge.WAYPOINTS_2D);
        this.startGateGroup.visible = true;
        this.flowLineGroup.visible = false;
        this.finishGateGroup.visible = false;
        this.onRecordingStateChange?.(false, 0);
      }
    }
  }

  public getRecordedPointsCount(): number {
    return this.recordedPoints.length;
  }

  public isExportModalOpen(): boolean {
    const modal = document.getElementById('flowline-export-modal');
    return !!modal && !modal.classList.contains('hidden');
  }

  public openExportModal(code: string): void {
    this.lastExportCode = code;
    this.ensureModalExists();
    const modal = document.getElementById('flowline-export-modal');
    const textarea = document.getElementById(
      'flowline-export-textarea'
    ) as HTMLTextAreaElement | null;
    const title = document.getElementById('flowline-modal-title');

    if (textarea) {
      textarea.value = code;
    }
    if (title) {
      title.textContent = `🌊 FLOW LINE EXPORT (${this.recordedPoints.length} PTS)`;
    }
    modal?.classList.remove('hidden');
  }

  public reopenExportModal(): void {
    if (this.lastExportCode) {
      this.openExportModal(this.lastExportCode);
    }
  }

  public closeExportModal(): void {
    const modal = document.getElementById('flowline-export-modal');
    modal?.classList.add('hidden');
  }

  private modalInitialized = false;

  private ensureModalExists(): void {
    let modal = document.getElementById('flowline-export-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'flowline-export-modal';
      modal.className = 'flowline-modal-overlay hidden';
      modal.innerHTML = `
        <div class="flowline-modal-backdrop" id="flowline-modal-backdrop"></div>
        <div class="flowline-modal-card">
          <div class="flowline-modal-header">
            <div>
              <span class="flowline-badge">DEV MODE • WAYPOINTS RECORDER</span>
              <h2 class="flowline-title" id="flowline-modal-title">🌊 FLOW LINE EXPORT</h2>
            </div>
            <button class="flowline-close-btn" id="flowline-modal-x-btn" type="button" aria-label="Close">✕</button>
          </div>
          <div class="flowline-modal-body">
            <p class="flowline-desc">
              Your custom Flow Line was recorded live in Skatepark "Im Gefilde"! Copy this snippet to chat or directly into <code class="flowline-code">FlowLineChallenge.WAYPOINTS_2D</code>:
            </p>
            <textarea id="flowline-export-textarea" class="flowline-textarea" readonly spellcheck="false"></textarea>
          </div>
          <div class="flowline-modal-footer">
            <button id="flowline-modal-copy-btn" type="button" class="flowline-btn flowline-btn-primary">📋 COPY WAYPOINTS</button>
            <button id="flowline-modal-test-btn" type="button" class="flowline-btn flowline-btn-accent">▶ TEST RECORDED LINE</button>
            <button id="flowline-modal-close-btn" type="button" class="flowline-btn flowline-btn-ghost">CLOSE</button>
          </div>
        </div>
      `;
      (document.getElementById('viewport-frame') ?? document.body).appendChild(modal);
    }

    if (!this.modalInitialized) {
      this.modalInitialized = true;
      const copyBtn = document.getElementById('flowline-modal-copy-btn');
      const testBtn = document.getElementById('flowline-modal-test-btn');
      const closeBtn = document.getElementById('flowline-modal-close-btn');
      const xBtn = document.getElementById('flowline-modal-x-btn');
      const backdrop = document.getElementById('flowline-modal-backdrop');
      const textarea = document.getElementById(
        'flowline-export-textarea'
      ) as HTMLTextAreaElement | null;

      copyBtn?.addEventListener('click', () => {
        if (!textarea) return;
        textarea.select();
        try {
          void navigator.clipboard?.writeText(textarea.value);
          const origText = copyBtn.textContent;
          copyBtn.textContent = 'COPIED TO CLIPBOARD! ✓';
          setTimeout(() => {
            copyBtn.textContent = origText;
          }, 2000);
        } catch {
          document.execCommand('copy');
        }
      });

      testBtn?.addEventListener('click', () => {
        this.closeExportModal();
        this.isActive = false;
        this.startGateGroup.visible = true;
        this.finishGateGroup.visible = true;
        this.flowLineGroup.visible = true;
        this.hud.showTrickBanner('READY TO TEST — RIDE TO START GATE!', true);
        this.hud.setFlowLineHint('🌊 ENTER START GATE TO BEGIN CHALLENGE');
      });

      closeBtn?.addEventListener('click', () => this.closeExportModal());
      xBtn?.addEventListener('click', () => this.closeExportModal());
      backdrop?.addEventListener('click', () => this.closeExportModal());
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
    this.isRecording = false;
    this.progressIdx = 0;
    this.retriggerCooldown = 0;

    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
    this.closeExportModal();
  }
}
