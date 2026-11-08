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
    new THREE.Vector2(8.16, 0.63), // 1
    new THREE.Vector2(8.36, 2.23), // 2
    new THREE.Vector2(9.57, 3.31), // 3
    new THREE.Vector2(10.48, 4.69), // 4
    new THREE.Vector2(11.95, 5.35), // 5
    new THREE.Vector2(13.20, 6.40), // 6
    new THREE.Vector2(13.79, 7.93), // 7
    new THREE.Vector2(13.62, 9.57), // 8
    new THREE.Vector2(14.90, 10.57), // 9
    new THREE.Vector2(16.51, 10.56), // 10
    new THREE.Vector2(16.07, 12.12), // 11
    new THREE.Vector2(15.45, 13.60), // 12
    new THREE.Vector2(16.44, 14.89), // 13
    new THREE.Vector2(15.87, 16.41), // 14
    new THREE.Vector2(14.35, 16.97), // 15
    new THREE.Vector2(13.79, 18.51), // 16
    new THREE.Vector2(12.56, 19.54), // 17
    new THREE.Vector2(11.23, 18.60), // 18
    new THREE.Vector2(9.62, 18.16), // 19
    new THREE.Vector2(7.97, 18.12), // 20
    new THREE.Vector2(7.34, 16.63), // 21
    new THREE.Vector2(7.16, 14.98), // 22
    new THREE.Vector2(6.30, 13.57), // 23
    new THREE.Vector2(7.20, 12.23), // 24
    new THREE.Vector2(7.50, 10.66), // 25
    new THREE.Vector2(7.30, 9.05), // 26
    new THREE.Vector2(7.18, 7.40), // 27
    new THREE.Vector2(7.93, 5.96), // 28
    new THREE.Vector2(8.88, 4.56), // 29
    new THREE.Vector2(9.47, 3.05), // 30
    new THREE.Vector2(9.02, 1.44), // 31
    new THREE.Vector2(7.42, 1.06), // 32
    new THREE.Vector2(6.33, 2.27), // 33
    new THREE.Vector2(5.39, 3.66), // 34
    new THREE.Vector2(4.94, 5.21), // 35
    new THREE.Vector2(5.38, 6.77), // 36
    new THREE.Vector2(5.84, 8.37), // 37
    new THREE.Vector2(6.29, 9.94), // 38
    new THREE.Vector2(6.06, 11.54), // 39
    new THREE.Vector2(4.57, 12.20), // 40
    new THREE.Vector2(4.31, 13.79), // 41
    new THREE.Vector2(4.22, 15.40), // 42
    new THREE.Vector2(2.78, 14.60), // 43
    new THREE.Vector2(1.14, 14.44), // 44
    new THREE.Vector2(0.15, 15.72), // 45
    new THREE.Vector2(-0.69, 14.30), // 46
    new THREE.Vector2(-0.46, 12.71), // 47
    new THREE.Vector2(-0.56, 11.10), // 48
    new THREE.Vector2(-1.82, 10.01), // 49
    new THREE.Vector2(-2.18, 8.43), // 50
    new THREE.Vector2(-2.38, 6.83), // 51
    new THREE.Vector2(-3.80, 6.06), // 52
    new THREE.Vector2(-5.28, 6.77), // 53
    new THREE.Vector2(-6.91, 6.99), // 54
    new THREE.Vector2(-8.50, 7.39), // 55
    new THREE.Vector2(-9.73, 8.50), // 56
    new THREE.Vector2(-11.17, 7.79), // 57
    new THREE.Vector2(-11.93, 6.35), // 58
    new THREE.Vector2(-13.46, 5.84), // 59
    new THREE.Vector2(-14.87, 5.01), // 60
    new THREE.Vector2(-14.86, 3.39), // 61
    new THREE.Vector2(-15.13, 1.77), // 62
    new THREE.Vector2(-16.65, 1.21), // 63
    new THREE.Vector2(-17.91, 0.23), // 64
    new THREE.Vector2(-17.20, -1.23), // 65
    new THREE.Vector2(-15.62, -1.64), // 66
    new THREE.Vector2(-14.05, -2.08), // 67
    new THREE.Vector2(-13.05, -3.39), // 68
    new THREE.Vector2(-12.27, -4.81), // 69
    new THREE.Vector2(-11.46, -6.20), // 70
    new THREE.Vector2(-10.47, -7.51), // 71
    new THREE.Vector2(-8.93, -8.07), // 72
    new THREE.Vector2(-8.19, -6.63), // 73
    new THREE.Vector2(-8.44, -5.01), // 74
    new THREE.Vector2(-9.30, -3.65), // 75
    new THREE.Vector2(-8.51, -2.24), // 76
    new THREE.Vector2(-7.11, -3.08), // 77
    new THREE.Vector2(-6.68, -4.65), // 78
    new THREE.Vector2(-6.26, -6.24), // 79
    new THREE.Vector2(-6.74, -7.80), // 80
    new THREE.Vector2(-6.79, -9.43), // 81
    new THREE.Vector2(-7.41, -10.95), // 82
    new THREE.Vector2(-8.81, -11.84), // 83
    new THREE.Vector2(-10.07, -12.82), // 84
    new THREE.Vector2(-8.96, -14.01), // 85
    new THREE.Vector2(-7.38, -13.69), // 86
    new THREE.Vector2(-5.79, -14.05), // 87
    new THREE.Vector2(-4.35, -13.32), // 88
    new THREE.Vector2(-3.76, -11.76), // 89
    new THREE.Vector2(-2.11, -11.62), // 90
    new THREE.Vector2(-0.77, -12.53), // 91
    new THREE.Vector2(0.76, -11.91), // 92
    new THREE.Vector2(2.08, -10.96), // 93
    new THREE.Vector2(3.58, -11.56), // 94
    new THREE.Vector2(4.69, -12.74), // 95
    new THREE.Vector2(6.17, -12.13), // 96
    new THREE.Vector2(7.12, -10.82), // 97
    new THREE.Vector2(8.77, -10.93), // 98
    new THREE.Vector2(10.25, -11.59), // 99
    new THREE.Vector2(10.99, -10.10), // 100
    new THREE.Vector2(11.93, -8.79), // 101
    new THREE.Vector2(13.59, -8.85), // 102
    new THREE.Vector2(15.15, -9.23), // 103
    new THREE.Vector2(15.83, -7.75), // 104
    new THREE.Vector2(16.34, -6.18), // 105
    new THREE.Vector2(17.84, -5.54), // 106
    new THREE.Vector2(19.44, -5.58), // 107
    new THREE.Vector2(20.28, -4.22), // 108
    new THREE.Vector2(20.33, -2.57), // 109
    new THREE.Vector2(20.70, -1.00), // 110
    new THREE.Vector2(22.06, -0.08), // 111
    new THREE.Vector2(23.52, 0.60), // 112
    new THREE.Vector2(23.21, 2.18), // 113
    new THREE.Vector2(21.93, 3.17), // 114
    new THREE.Vector2(20.60, 4.19), // 115
    new THREE.Vector2(19.31, 5.19), // 116
    new THREE.Vector2(17.99, 6.19), // 117
    new THREE.Vector2(16.33, 6.41), // 118
    new THREE.Vector2(15.01, 5.40), // 119
    new THREE.Vector2(13.85, 4.22), // 120
    new THREE.Vector2(13.03, 2.75), // 121
    new THREE.Vector2(11.82, 1.68), // 122
    new THREE.Vector2(10.42, 0.86), // 123
    new THREE.Vector2(8.83, 0.84), // 124
  ];

  public static readonly NUM_SAMPLE_POINTS = 372;
  public static readonly TUBULAR_SEGMENTS = FlowLineChallenge.NUM_SAMPLE_POINTS - 1; // 371
  public static readonly RADIAL_SEGMENTS = 6;
  public static readonly INDICES_PER_SEGMENT = FlowLineChallenge.RADIAL_SEGMENTS * 6; // 36
  public static readonly VISIBLE_AHEAD_POINTS = 26; // ~13.5m ahead
  public static readonly VISIBLE_BEHIND_POINTS = 2; // ~1.0m behind skater
  public static readonly CHEVRON_STEP = 8;
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
  private chevronMarkers: THREE.Mesh[] = [];

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
      waypoints.length * 3
    );
    const tubularSegments = sampleCount - 1;
    const sampled = rawCurve.getPoints(tubularSegments);

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
        tubularSegments,
        0.034,
        FlowLineChallenge.RADIAL_SEGMENTS,
        false
      );
    }

    this.buildChevrons();
    this.updateStartGatePosition();
    this.updateFinishGatePosition();
  }

  /**
   * Places directional chevron markers along the sampled flow line.
   */
  private buildChevrons(): void {
    for (const c of this.chevronMarkers) {
      this.flowLineGroup.remove(c);
      c.geometry.dispose();
    }
    this.chevronMarkers = [];

    if (!this.curve || this.curvePoints.length < 2) return;

    const chevronGeo = new THREE.ConeGeometry(0.08, 0.2, 3);
    chevronGeo.rotateX(Math.PI / 2);
    chevronGeo.scale(1.0, 0.3, 1.0);
    const chevronMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const step = FlowLineChallenge.CHEVRON_STEP;
    for (let idx = step; idx < this.curvePoints.length - step; idx += step) {
      const t = idx / (this.curvePoints.length - 1);
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);

      const marker = new THREE.Mesh(chevronGeo, chevronMat);
      marker.position.copy(pos);
      marker.position.y += 0.02;
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      marker.userData.sampleIdx = idx;
      this.flowLineGroup.add(marker);
      this.chevronMarkers.push(marker);
    }
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
    const tubularSegments = Math.max(
      FlowLineChallenge.TUBULAR_SEGMENTS,
      this.curvePoints.length - 1
    );
    const tubeGeo = new THREE.TubeGeometry(
      this.curve,
      tubularSegments,
      0.034,
      FlowLineChallenge.RADIAL_SEGMENTS,
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

    const tubularSegments = Math.max(
      FlowLineChallenge.TUBULAR_SEGMENTS,
      this.curvePoints.length - 1
    );
    if (this.tubeMesh) {
      this.tubeMesh.geometry.dispose();
      this.tubeMesh.geometry = new THREE.TubeGeometry(
        this.curve,
        tubularSegments,
        0.034,
        FlowLineChallenge.RADIAL_SEGMENTS,
        false
      );
    }

    this.buildChevrons();
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

    // 1. Wipeout / Bail ends the challenge
    if (controller.isBailing) {
      this.failChallenge('FLOW LINE LOST!');
      return;
    }

    // 2. Progress tracking along active local window
    const minSearchIdx = Math.max(
      0,
      this.progressIdx - FlowLineChallenge.VISIBLE_BEHIND_POINTS
    );
    const maxSearchIdx = Math.min(
      this.curvePoints.length - 1,
      this.progressIdx + FlowLineChallenge.VISIBLE_AHEAD_POINTS
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

    // 3. Check if skater is too far away from the line
    if (distToLine > FlowLineChallenge.MAX_ALLOWED_DISTANCE) {
      this.failChallenge('FLOW LINE ENDED — TOO FAR!');
      return;
    }

    // 4. Dynamically update visible 10-15m window of tube, chevrons & pulse markers
    this.updateFlowLineVisibility(timeSec);

    // 5. Wave Flow Speed Assist: surfing an endless wave without stalling
    if (controller.speed > 1.0 && controller.speed < 5.2) {
      controller.speed = Math.min(5.8, controller.speed + dt * 1.1);
    }

    // 6. Live HUD Progress Hint
    const progressFrac =
      this.progressIdx / (this.curvePoints.length - 1);
    const pct = Math.round(progressFrac * 100);
    this.hud.setFlowLineHint(`🌊 FOLLOW THE FLOW: ${pct}%`);

    // 7. Finish Gate Visibility:
    // Show finish gate once the track end enters the 15m visibility window (>= NUM_SAMPLE_POINTS - 30, ca. 90% progress)
    const finishThreshold = Math.max(0, this.curvePoints.length - 1 - 30);
    this.finishGateGroup.visible = this.progressIdx >= finishThreshold;

    if (this.finishGateGroup.visible) {
      this.finishArchRing.rotation.z = timeSec * 1.2;
      this.finishLabelSprite.position.y =
        0.95 + Math.sin(timeSec * 2.6) * 0.04;
    }

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
        this.resetFlowLineVisibility();
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

  /**
   * Dynamically renders only the ~10-15m window of the flow line in front of the skater,
   * keeping rendering lightweight with zero per-frame buffer allocations.
   */
  private updateFlowLineVisibility(timeSec: number): void {
    if (!this.tubeMesh?.geometry || !this.curvePoints.length) return;

    const numSegments = this.curvePoints.length - 1;
    const startSeg = Math.max(
      0,
      this.progressIdx - FlowLineChallenge.VISIBLE_BEHIND_POINTS
    );
    const endSeg = Math.min(
      numSegments,
      this.progressIdx + FlowLineChallenge.VISIBLE_AHEAD_POINTS
    );
    const startIndex = startSeg * FlowLineChallenge.INDICES_PER_SEGMENT;
    const count = Math.max(
      0,
      (endSeg - startSeg) * FlowLineChallenge.INDICES_PER_SEGMENT
    );

    this.tubeMesh.geometry.setDrawRange(startIndex, count);

    // Chevron directional markers: visible only within the active 10-15m window ahead
    const windowStart = this.progressIdx;
    const windowEnd = this.progressIdx + FlowLineChallenge.VISIBLE_AHEAD_POINTS;

    for (const marker of this.chevronMarkers) {
      const sampleIdx = (marker.userData.sampleIdx as number) ?? 0;
      if (sampleIdx >= windowStart && sampleIdx <= windowEnd) {
        marker.visible = true;
        const distFromEnd = windowEnd - sampleIdx;
        if (distFromEnd < 6) {
          const s = Math.max(0.2, distFromEnd / 6);
          marker.scale.set(s, s, s);
        } else {
          marker.scale.set(1.0, 1.0, 1.0);
        }
      } else {
        marker.visible = false;
      }
    }

    // Pulse markers: smoothly cruise along the active 10-15m visible segment
    const numMarkers = this.pulseMarkers.length;
    const startFrac = startSeg / numSegments;
    const endFrac = endSeg / numSegments;
    const fracSpan = Math.max(0.001, endFrac - startFrac);

    for (let i = 0; i < numMarkers; i++) {
      const localT = (timeSec * 0.35 + i / numMarkers) % 1.0;
      const t = Math.min(1.0, startFrac + localT * fracSpan);
      this.curve.getPointAt(t, this.pulseMarkers[i].position);
      const tangent = this.curve.getTangentAt(t);
      this.pulseMarkers[i].quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        tangent
      );
      this.pulseMarkers[i].visible = true;

      const edgeDist = Math.min(localT, 1.0 - localT);
      const s = edgeDist < 0.15 ? Math.max(0.2, edgeDist / 0.15) : 1.0;
      this.pulseMarkers[i].scale.set(s, s, s);
    }
  }

  /**
   * Resets draw range and restores visibility of all flow line markers (used outside of active challenge).
   */
  private resetFlowLineVisibility(): void {
    if (this.tubeMesh?.geometry) {
      this.tubeMesh.geometry.setDrawRange(0, Infinity);
    }
    for (const marker of this.chevronMarkers) {
      marker.visible = true;
      marker.scale.set(1.0, 1.0, 1.0);
    }
    for (const marker of this.pulseMarkers) {
      marker.visible = true;
      marker.scale.set(1.0, 1.0, 1.0);
    }
  }

  private startChallenge(): void {
    this.isActive = true;
    this.progressIdx = 0;

    this.startGateGroup.visible = false;
    this.flowLineGroup.visible = true;
    this.finishGateGroup.visible = false;

    this.updateFlowLineVisibility(0);

    this.hud.showTrickBanner('🌊 FOLLOW THE FLOW!', true);
    this.hud.setFlowLineHint('🌊 FOLLOW THE FLOW: 0%');
    this.audio.playManeuverChime();
  }

  private failChallenge(reason: string): void {
    this.isActive = false;
    this.retriggerCooldown = 1.5;

    this.resetFlowLineVisibility();
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

    this.resetFlowLineVisibility();
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

    this.resetFlowLineVisibility();
    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
    this.closeExportModal();
  }
}
