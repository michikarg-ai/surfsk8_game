import * as THREE from 'three';
import { ParkSurface } from '../physics/ParkSurface';
import { SurfHUD } from '../ui/SurfHUD';
import { SurfAudio } from '../audio/SurfAudio';

export type StuntMoveType =
  | 'DOUBLE_TAILWHIP'
  | 'BACKFLIP_BARSPIN'
  | 'SUPERMAN'
  | 'HEEL_CLICK_BARSPIN';

interface ScooterRoute {
  id: string;
  name: string;
  curve: THREE.CatmullRomCurve3;
  duration: number; // total crossing duration in seconds (~11 - 13s)
  airStart: number; // normalized progress (0..1) when air launch starts
  airEnd: number; // normalized progress (0..1) when landing occurs
  maxJumpH: number; // peak jump altitude in meters above terrain
  stunt: StuntMoveType;
  stuntName: string;
}

/**
 * Procedural 3D Stunt-Scooter NPC ("Scooter Kid") for Skatepark "Im Gefilde".
 *
 * Requirements (Issue #13):
 * - Active ONLY in Skatepark "Im Gefilde" (currentParkId === 'im_gefilde').
 * - 100% royalty-free, procedurally built Three.js 3D model (stunt scooter + articulated rider).
 * - Crosses the park every 5 minutes (300 seconds), with first run ~25s after game start.
 * - Rides flush on authentic Bavarian LiDAR terrain (ParkSurface.sample(x, z)).
 * - Hits transitions, pumps, launches over volcano/hips and executes wild stunt scooter tricks:
 *   1) Double Tailwhip Air (720° deck spin around headtube headset)
 *   2) Backflip + 360° Barspin
 *   3) Superman / Air Transfer
 *   4) Double Barspin + Heel-Clicker
 * - High-contrast floating 3D callout billboard sprite + optional subtle HUD notice.
 * - Public API: `triggerCrossingNow()`, `isActive()`, `reset()`.
 */
export class ScooterRiderNPC {
  public readonly rootGroup = new THREE.Group();

  // Timing configuration
  public static readonly CROSSING_INTERVAL_SEC = 300.0; // 5 minutes
  public static readonly INITIAL_DELAY_SEC = 25.0; // 25s after entering park

  private isCrossingActive = false;
  private timerSec = 0;
  private nextIntervalSec = ScooterRiderNPC.INITIAL_DELAY_SEC;
  private currentProgress = 0; // 0..1 along current route
  private currentRouteIndex = 0;
  private routes: ScooterRoute[] = [];

  // Articulated 3D Model references
  private flipGroup = new THREE.Group();
  private deckPivot = new THREE.Group();
  private barPivot = new THREE.Group();
  private riderPivot = new THREE.Group();
  private wheelFront = new THREE.Group();
  private wheelRear = new THREE.Group();

  // Rider limb joints for stunts & pumping kinematics
  private hipL = new THREE.Group();
  private kneeL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeR = new THREE.Group();
  private shoulderL = new THREE.Group();
  private elbowL = new THREE.Group();
  private shoulderR = new THREE.Group();
  private elbowR = new THREE.Group();
  private torsoGroup = new THREE.Group();

  // Ground contact shadow decal
  private shadowMesh: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;

  // Floating 3D Callout Billboard Sprite
  private calloutSprite: THREE.Sprite;
  private calloutCanvas: HTMLCanvasElement;
  private calloutCtx: CanvasRenderingContext2D;
  private calloutTex: THREE.CanvasTexture;

  // Animation state
  private wheelAngle = 0;
  private stuntSoundTriggered = false;
  private tempVec = new THREE.Vector3();
  private tempTangent = new THREE.Vector3();
  private tempNormal = new THREE.Vector3();
  private currentQuat = new THREE.Quaternion();
  private targetQuat = new THREE.Quaternion();
  private rotMatrix = new THREE.Matrix4();

  constructor(
    private scene: THREE.Scene,
    private parkSurface: ParkSurface,
    private hud: SurfHUD,
    private audio: SurfAudio
  ) {
    this.rootGroup.name = 'ScooterRiderNPC';
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // Build the procedural 3D model & hierarchies
    this.build3DModel();

    // Build soft ground contact shadow
    const [shadowMesh, shadowMat] = this.buildShadowDecal();
    this.shadowMesh = shadowMesh;
    this.shadowMat = shadowMat;
    this.rootGroup.add(this.shadowMesh);

    // Build 3D Callout Billboard Sprite
    const [sprite, canvas, ctx, tex] = this.buildCalloutSprite();
    this.calloutSprite = sprite;
    this.calloutCanvas = canvas;
    this.calloutCtx = ctx;
    this.calloutTex = tex;
    this.rootGroup.add(this.calloutSprite);

    // Build the 4 crossing lines through Im Gefilde
    this.initRoutes();
  }

  /**
   * Constructs the 100% royalty-free procedural 3D stunt scooter and rider model.
   */
  private build3DModel(): void {
    // Top-level flip group handles full body/scooter pitch for backflips & rolls
    this.flipGroup = new THREE.Group();
    this.rootGroup.add(this.flipGroup);

    // High quality street materials
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, // Electric cyan anodized aluminum
      metalness: 0.82,
      roughness: 0.28,
    });

    const griptapeMat = new THREE.MeshStandardMaterial({
      color: 0x18181b, // Dark charcoal rough griptape
      roughness: 0.96,
      metalness: 0.05,
    });

    const clampMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7, // Anodized violet clamp & headset
      metalness: 0.88,
      roughness: 0.22,
    });

    const barsMat = new THREE.MeshStandardMaterial({
      color: 0x27272a, // Satin matte black chromoly steel T-bar
      metalness: 0.65,
      roughness: 0.35,
    });

    const gripsMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e, // Hot coral-pink ribbed stunt grips
      roughness: 0.82,
      metalness: 0.05,
    });

    const wheelCoreMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // CNC aluminum alloy spokes
      metalness: 0.9,
      roughness: 0.2,
    });

    const wheelTireMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe, // Semi-translucent 88A high-rebound PU tire
      roughness: 0.35,
      metalness: 0.08,
    });

    const hoodieMat = new THREE.MeshStandardMaterial({
      color: 0xff6b35, // Vibrant Munich sunset orange streetwear hoodie
      roughness: 0.88,
      metalness: 0.02,
    });

    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Deep navy baggy cargo shorts
      roughness: 0.92,
      metalness: 0.04,
    });

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe0a98b, // Stylized warm skin
      roughness: 0.75,
      metalness: 0.0,
    });

    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Matte dark slate dome helmet
      roughness: 0.45,
      metalness: 0.15,
    });

    const shoesMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Crisp white chunky skate sneakers
      roughness: 0.6,
      metalness: 0.05,
    });

    // -------------------------------------------------------------
    // 1. FRONT STEERER / HEADTUBE ASSEMBLY
    // -------------------------------------------------------------
    const headtubeGroup = new THREE.Group();
    headtubeGroup.position.set(0, 0.16, 0.04);
    headtubeGroup.rotation.x = 0.21; // ~82 deg headtube rake angle
    this.flipGroup.add(headtubeGroup);

    // Headtube outer cup
    const headtubeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.12, 14),
      deckMat
    );
    headtubeGroup.add(headtubeMesh);

    // Quad Clamp
    const clampMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.055, 14),
      clampMat
    );
    clampMesh.position.y = 0.085;
    headtubeGroup.add(clampMesh);

    // Downtube connecting headtube to deck
    const downtubeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.16, 0.045),
      deckMat
    );
    downtubeMesh.position.set(0, -0.06, -0.065);
    downtubeMesh.rotation.x = -0.58;
    headtubeGroup.add(downtubeMesh);

    // Front Fork blades
    const forkLeft = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.02), clampMat);
    forkLeft.position.set(-0.024, -0.075, 0);
    headtubeGroup.add(forkLeft);

    const forkRight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.02), clampMat);
    forkRight.position.set(0.024, -0.075, 0);
    headtubeGroup.add(forkRight);

    // Front Wheel (110mm / diameter 0.11m)
    this.wheelFront = this.buildStuntWheel(wheelCoreMat, wheelTireMat);
    this.wheelFront.position.set(0, -0.11, 0);
    headtubeGroup.add(this.wheelFront);

    // -------------------------------------------------------------
    // 2. BAR PIVOT (Handlebar assembly rotates for 360°/720° BARSPINS)
    // -------------------------------------------------------------
    this.barPivot = new THREE.Group();
    this.barPivot.position.set(0, 0.11, 0);
    headtubeGroup.add(this.barPivot);

    // Vertical Chromoly Stem
    const stemMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.54, 12),
      barsMat
    );
    stemMesh.position.y = 0.27;
    this.barPivot.add(stemMesh);

    // Crossbar (T-Bar)
    const crossbarMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.48, 12),
      barsMat
    );
    crossbarMesh.position.y = 0.54;
    crossbarMesh.rotation.z = Math.PI / 2;
    this.barPivot.add(crossbarMesh);

    // Grips on ends
    const gripL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12), gripsMat);
    gripL.position.set(-0.18, 0.54, 0);
    gripL.rotation.z = Math.PI / 2;
    this.barPivot.add(gripL);

    const gripR = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12), gripsMat);
    gripR.position.set(0.18, 0.54, 0);
    gripR.rotation.z = Math.PI / 2;
    this.barPivot.add(gripR);

    // -------------------------------------------------------------
    // 3. DECK PIVOT (Deck assembly rotates for 360°/720° TAILWHIPS)
    // -------------------------------------------------------------
    this.deckPivot = new THREE.Group();
    this.deckPivot.position.set(0, 0.065, 0);
    this.flipGroup.add(this.deckPivot);

    // Main Aluminum Extruded Deck (0.12m wide, 0.50m long, 0.028m thick)
    const deckExtrusion = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.028, 0.50),
      deckMat
    );
    deckExtrusion.position.set(0, 0, -0.25);
    this.deckPivot.add(deckExtrusion);

    // Griptape Layer
    const griptapeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.116, 0.48),
      griptapeMat
    );
    griptapeMesh.position.set(0, 0.0145, -0.25);
    griptapeMesh.rotation.x = -Math.PI / 2;
    this.deckPivot.add(griptapeMesh);

    // Rear Dropouts & Axle plates
    const rearDropoutL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.07), deckMat);
    rearDropoutL.position.set(-0.045, -0.01, -0.50);
    this.deckPivot.add(rearDropoutL);

    const rearDropoutR = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.07), deckMat);
    rearDropoutR.position.set(0.045, -0.01, -0.50);
    this.deckPivot.add(rearDropoutR);

    // Rear Stunt Peg on right axle
    const rearPeg = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.055, 12), clampMat);
    rearPeg.position.set(0.075, -0.01, -0.50);
    rearPeg.rotation.z = Math.PI / 2;
    this.deckPivot.add(rearPeg);

    // Rear Flex Brake Fender
    const brakeFender = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.008, 0.09), barsMat);
    brakeFender.position.set(0, 0.038, -0.46);
    brakeFender.rotation.x = 0.32;
    this.deckPivot.add(brakeFender);

    // Rear Wheel (110mm)
    this.wheelRear = this.buildStuntWheel(wheelCoreMat, wheelTireMat);
    this.wheelRear.position.set(0, -0.01, -0.50);
    this.deckPivot.add(this.wheelRear);

    // -------------------------------------------------------------
    // 4. ARTICULATED 3D RIDER (Streetwear teen scooter rider)
    // -------------------------------------------------------------
    this.riderPivot = new THREE.Group();
    // Rider center of mass above deck
    this.riderPivot.position.set(0, 0.08, -0.22);
    this.flipGroup.add(this.riderPivot);

    // Pelvis & Baggy Cargo Shorts
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.14), pantsMat);
    pelvis.position.set(0, 0.44, 0);
    this.riderPivot.add(pelvis);

    // Torso (Oversized Hoodie)
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.50, 0);
    this.riderPivot.add(this.torsoGroup);

    const hoodieBody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.16), hoodieMat);
    hoodieBody.position.y = 0.16;
    this.torsoGroup.add(hoodieBody);

    // Neck & Head
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 10), skinMat);
    neckMesh.position.y = 0.34;
    this.torsoGroup.add(neckMesh);

    const headGroup = new THREE.Group();
    headGroup.position.y = 0.43;
    this.torsoGroup.add(headGroup);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), skinMat);
    headGroup.add(headMesh);

    // Stunt Helmet (Classic dome skate/scooter helmet)
    const helmetDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.098, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
      helmetMat
    );
    helmetDome.position.set(0, 0.015, -0.005);
    headGroup.add(helmetDome);

    // Helmet Chin-Strap
    const chinStrap = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 6, 16), barsMat);
    chinStrap.position.set(0, -0.02, 0);
    chinStrap.rotation.x = Math.PI / 2;
    headGroup.add(chinStrap);

    // Sunglasses / Street Visor
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.024, 0.03), barsMat);
    glasses.position.set(0, 0.015, 0.08);
    headGroup.add(glasses);

    // -------------------------------------------------------------
    // 5. LIMBS & JOINTS (Kinematic animation for tricks & pumping)
    // -------------------------------------------------------------
    // Left Leg (Front Stance on deck)
    this.hipL = new THREE.Group();
    this.hipL.position.set(-0.07, 0.44, 0.02);
    this.riderPivot.add(this.hipL);

    const thighL = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.22, 0.09), pantsMat);
    thighL.position.y = -0.11;
    this.hipL.add(thighL);

    this.kneeL = new THREE.Group();
    this.kneeL.position.y = -0.22;
    this.hipL.add(this.kneeL);

    const shinL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.20, 0.075), skinMat);
    shinL.position.y = -0.10;
    this.kneeL.add(shinL);

    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.065, 0.18), shoesMat);
    shoeL.position.set(0, -0.18, 0.05);
    this.kneeL.add(shoeL);

    // Right Leg (Rear Stance on deck)
    this.hipR = new THREE.Group();
    this.hipR.position.set(0.07, 0.44, -0.06);
    this.riderPivot.add(this.hipR);

    const thighR = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.22, 0.09), pantsMat);
    thighR.position.y = -0.11;
    this.hipR.add(thighR);

    this.kneeR = new THREE.Group();
    this.kneeR.position.y = -0.22;
    this.hipR.add(this.kneeR);

    const shinR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.20, 0.075), skinMat);
    shinR.position.y = -0.10;
    this.kneeR.add(shinR);

    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.065, 0.18), shoesMat);
    shoeR.position.set(0, -0.18, 0.02);
    shoeR.rotation.y = 0.45; // Angled 45 deg across deck
    this.kneeR.add(shoeR);

    // Left Arm (Grips left handlebar)
    this.shoulderL = new THREE.Group();
    this.shoulderL.position.set(-0.15, 0.28, 0.02);
    this.torsoGroup.add(this.shoulderL);

    const upperArmL = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.075), hoodieMat);
    upperArmL.position.y = -0.09;
    this.shoulderL.add(upperArmL);

    this.elbowL = new THREE.Group();
    this.elbowL.position.y = -0.18;
    this.shoulderL.add(this.elbowL);

    const forearmL = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.17, 0.065), skinMat);
    forearmL.position.y = -0.085;
    this.elbowL.add(forearmL);

    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), skinMat);
    handL.position.y = -0.17;
    this.elbowL.add(handL);

    // Right Arm (Grips right handlebar)
    this.shoulderR = new THREE.Group();
    this.shoulderR.position.set(0.15, 0.28, 0.02);
    this.torsoGroup.add(this.shoulderR);

    const upperArmR = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.075), hoodieMat);
    upperArmR.position.y = -0.09;
    this.shoulderR.add(upperArmR);

    this.elbowR = new THREE.Group();
    this.elbowR.position.y = -0.18;
    this.shoulderR.add(this.elbowR);

    const forearmR = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.17, 0.065), skinMat);
    forearmR.position.y = -0.085;
    this.elbowR.add(forearmR);

    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), skinMat);
    handR.position.y = -0.17;
    this.elbowR.add(handR);

    // Set natural riding stance angles
    this.setNeutralRidingPose();
  }

  /**
   * Builds a high-rebound 110mm stunt scooter wheel.
   */
  private buildStuntWheel(
    coreMat: THREE.Material,
    tireMat: THREE.Material
  ): THREE.Group {
    const wheelGroup = new THREE.Group();

    // CNC aluminum wheel core
    const coreMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.024, 16),
      coreMat
    );
    coreMesh.rotation.z = Math.PI / 2;
    wheelGroup.add(coreMesh);

    // Polyurethane 88A tire
    const tireMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.046, 0.015, 12, 24),
      tireMat
    );
    tireMesh.rotation.y = Math.PI / 2;
    wheelGroup.add(tireMesh);

    return wheelGroup;
  }

  /**
   * Sets natural riding pose when cruising on the deck.
   */
  private setNeutralRidingPose(): void {
    // Deck and bar neutral
    this.deckPivot.rotation.set(0, 0, 0);
    this.barPivot.rotation.set(0, 0, 0);
    this.flipGroup.rotation.set(0, 0, 0);

    // Rider posture
    this.riderPivot.position.set(0, 0.08, -0.22);
    this.riderPivot.rotation.set(0, 0, 0);
    this.torsoGroup.rotation.set(0.12, 0, 0);

    // Legs bent slightly to absorb bumps
    this.hipL.rotation.set(-0.25, 0, -0.08);
    this.kneeL.rotation.set(0.42, 0, 0);

    this.hipR.rotation.set(-0.18, 0.35, 0.08);
    this.kneeR.rotation.set(0.38, 0, 0);

    // Arms angled forward gripping T-bar
    this.shoulderL.rotation.set(-0.75, 0.15, -0.22);
    this.elbowL.rotation.set(0.68, 0, 0);

    this.shoulderR.rotation.set(-0.75, -0.15, 0.22);
    this.elbowR.rotation.set(0.68, 0, 0);
  }

  /**
   * Creates a realistic contact shadow decal with radial falloff.
   */
  private buildShadowDecal(): [THREE.Mesh, THREE.MeshBasicMaterial] {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.72)');
    grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.38)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(64, 64, 38, 58, 0, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
    });

    const geo = new THREE.PlaneGeometry(0.55, 1.1);
    geo.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.015;
    return [mesh, mat];
  }

  /**
   * Creates a billboard 3D callout sprite that displays trick names above the rider.
   */
  private buildCalloutSprite(): [
    THREE.Sprite,
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    THREE.CanvasTexture,
  ] {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 144;
    const ctx = canvas.getContext('2d')!;

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.4, 0.39, 1.0);
    sprite.position.set(0, 1.48, -0.15);
    sprite.visible = false;

    return [sprite, canvas, ctx, tex];
  }

  /**
   * Updates the billboard canvas texture with the active stunt name.
   */
  private updateCalloutText(stuntTitle: string): void {
    const ctx = this.calloutCtx;
    ctx.clearRect(0, 0, 512, 144);

    // Glowing badge background
    ctx.fillStyle = 'rgba(10, 15, 26, 0.85)';
    ctx.beginPath();
    const x = 12,
      y = 12,
      w = 488,
      h = 120,
      r = 24;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();

    // Cyan / Gold Neon border
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Subtitle
    ctx.fillStyle = '#fbbf24';
    ctx.font = '900 24px "Barlow Condensed", "Impact", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛴 SCOOTER KID!', 256, 44);

    // Stunt Name
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 38px "Barlow Condensed", "Impact", sans-serif';
    ctx.fillText(stuntTitle, 256, 88);

    this.calloutTex.needsUpdate = true;
  }

  /**
   * Initializes 4 distinct, authentic crossing lines through Skatepark "Im Gefilde".
   */
  private initRoutes(): void {
    // -------------------------------------------------------------
    // Route 0: East Volcano Blitz (Double Tailwhip Air)
    // -------------------------------------------------------------
    const pts0 = [
      new THREE.Vector3(23.0, 0, 1.2),
      new THREE.Vector3(18.0, 0, 0.8),
      new THREE.Vector3(13.0, 0, 0.2),
      new THREE.Vector3(9.5, 0, -0.4),
      new THREE.Vector3(7.6, 0, -0.8), // Volcano apex
      new THREE.Vector3(5.2, 0, -1.2),
      new THREE.Vector3(0.5, 0, -2.8),
      new THREE.Vector3(-4.5, 0, -4.5),
      new THREE.Vector3(-9.5, 0, -2.0),
      new THREE.Vector3(-15.5, 0, 0.2),
      new THREE.Vector3(-22.0, 0, 1.0),
    ];

    // -------------------------------------------------------------
    // Route 1: South Bowl to East Palm Wall (Backflip + 360 Barspin)
    // -------------------------------------------------------------
    const pts1 = [
      new THREE.Vector3(1.0, 0, 17.5),
      new THREE.Vector3(1.2, 0, 12.5), // Drop into South Clover Bowl
      new THREE.Vector3(2.8, 0, 7.8),
      new THREE.Vector3(4.8, 0, 4.2), // Southern Hip takeoff
      new THREE.Vector3(7.5, 0, 1.2), // Transfer peak
      new THREE.Vector3(10.2, 0, -0.4),
      new THREE.Vector3(14.0, 0, 1.5),
      new THREE.Vector3(16.5, 0, 4.2), // East Palm Wall high carve
      new THREE.Vector3(18.8, 0, 1.2),
      new THREE.Vector3(22.5, 0, -2.5),
    ];

    // -------------------------------------------------------------
    // Route 2: NW Cradle to SE Deep Bowl (Superman Air Transfer)
    // -------------------------------------------------------------
    const pts2 = [
      new THREE.Vector3(-11.5, 0, -14.0),
      new THREE.Vector3(-6.5, 0, -11.0),
      new THREE.Vector3(-2.2, 0, -6.5),
      new THREE.Vector3(2.5, 0, -3.2),
      new THREE.Vector3(6.2, 0, -1.8), // Volcano launch
      new THREE.Vector3(8.8, 0, 1.2), // Huge gap transfer
      new THREE.Vector3(11.2, 0, 5.2),
      new THREE.Vector3(12.8, 0, 10.2),
      new THREE.Vector3(14.5, 0, 14.5), // SE Deep Bowl Pocket
      new THREE.Vector3(17.8, 0, 18.0),
    ];

    // -------------------------------------------------------------
    // Route 3: West Spine Roller Blitz (Double Barspin + Heel Click)
    // -------------------------------------------------------------
    const pts3 = [
      new THREE.Vector3(-18.5, 0, 0.2),
      new THREE.Vector3(-13.5, 0, -0.6),
      new THREE.Vector3(-9.2, 0, -0.5), // NW Lower Spine
      new THREE.Vector3(-6.2, 0, -4.5),
      new THREE.Vector3(-5.0, 0, -7.0), // NW Upper Spine takeoff
      new THREE.Vector3(-2.2, 0, -5.2),
      new THREE.Vector3(1.0, 0, -3.0),
      new THREE.Vector3(6.0, 0, -1.4),
      new THREE.Vector3(12.5, 0, 0.4),
      new THREE.Vector3(18.5, 0, 1.8),
      new THREE.Vector3(23.5, 0, 2.2),
    ];

    this.routes = [
      {
        id: 'route_volcano_tailwhip',
        name: 'Volcano Double Tailwhip Blitz',
        curve: new THREE.CatmullRomCurve3(pts0, false, 'catmullrom', 0.5),
        duration: 12.0,
        airStart: 0.35,
        airEnd: 0.55,
        maxJumpH: 1.85,
        stunt: 'DOUBLE_TAILWHIP',
        stuntName: 'DOUBLE TAILWHIP!',
      },
      {
        id: 'route_south_backflip',
        name: 'South Hip Backflip Barspin',
        curve: new THREE.CatmullRomCurve3(pts1, false, 'catmullrom', 0.5),
        duration: 12.5,
        airStart: 0.34,
        airEnd: 0.54,
        maxJumpH: 1.95,
        stunt: 'BACKFLIP_BARSPIN',
        stuntName: 'BACKFLIP BARSPIN!',
      },
      {
        id: 'route_cradle_superman',
        name: 'Cradle Superman Transfer',
        curve: new THREE.CatmullRomCurve3(pts2, false, 'catmullrom', 0.5),
        duration: 12.2,
        airStart: 0.36,
        airEnd: 0.56,
        maxJumpH: 1.90,
        stunt: 'SUPERMAN',
        stuntName: 'SUPERMAN AIR!',
      },
      {
        id: 'route_spine_barspin',
        name: 'NW Spine Double Barspin',
        curve: new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0.5),
        duration: 11.8,
        airStart: 0.35,
        airEnd: 0.55,
        maxJumpH: 1.75,
        stunt: 'HEEL_CLICK_BARSPIN',
        stuntName: 'DOUBLE BARSPIN!',
      },
    ];
  }

  /**
   * Main game loop update called from `src/main.ts`.
   */
  public update(dt: number, timeSec: number, currentParkId: string): void {
    // Issue #13 requirement: ONLY active in Skatepark "Im Gefilde"
    if (currentParkId !== 'im_gefilde') {
      if (this.rootGroup.visible) {
        this.reset();
      }
      return;
    }

    // Interval countdown when waiting between crossings
    if (!this.isCrossingActive) {
      this.timerSec += dt;
      if (this.timerSec >= this.nextIntervalSec) {
        this.triggerCrossingNow();
      }
      return;
    }

    // Active crossing traversal
    const route = this.routes[this.currentRouteIndex];
    this.currentProgress += dt / route.duration;

    if (this.currentProgress >= 1.0) {
      // Crossing finished: hide scooter, reset timer for next 5-minute interval
      this.isCrossingActive = false;
      this.rootGroup.visible = false;
      this.timerSec = 0;
      this.nextIntervalSec = ScooterRiderNPC.CROSSING_INTERVAL_SEC;
      return;
    }

    // Compute 3D position, surface altitude, jump parabola & orientation
    this.animateCrossingFrame(dt, timeSec, route);
  }

  /**
   * Positions and animates scooter and rider along the route.
   */
  private animateCrossingFrame(
    dt: number,
    timeSec: number,
    route: ScooterRoute
  ): void {
    const t = Math.max(0, Math.min(1, this.currentProgress));

    // Sample path curve position
    route.curve.getPoint(t, this.tempVec);
    const x = this.tempVec.x;
    const z = this.tempVec.z;

    // Sample authentic Bavarian LiDAR surface model
    const sample = this.parkSurface.sample(x, z);
    const groundH = sample.height;

    // Check if currently airborne
    const isAirborne = t >= route.airStart && t <= route.airEnd;
    let jumpH = 0;
    let normAirTime = 0;

    if (isAirborne) {
      normAirTime = (t - route.airStart) / (route.airEnd - route.airStart);
      // Parabolic jump trajectory: 4 * h_max * u * (1 - u)
      jumpH = 4.0 * route.maxJumpH * normAirTime * (1.0 - normAirTime);
    }

    const currentY = groundH + jumpH;
    this.rootGroup.position.set(x, currentY, z);

    // Compute movement tangent
    route.curve.getTangent(t, this.tempTangent);
    const tanXZ = new THREE.Vector3(this.tempTangent.x, 0, this.tempTangent.z).normalize();

    // Orientation:
    if (!isAirborne) {
      // Grounded: align flush with surface normal and forward tangent
      const N = sample.normal;
      const R = new THREE.Vector3().crossVectors(tanXZ, N).normalize();
      const F = new THREE.Vector3().crossVectors(N, R).normalize();

      this.rotMatrix.makeBasis(R, N, F);
      this.targetQuat.setFromRotationMatrix(this.rotMatrix);

      // Smooth orientation slerp
      this.currentQuat.slerp(this.targetQuat, Math.min(1.0, 18.0 * dt));
      this.rootGroup.quaternion.copy(this.currentQuat);

      // Contact shadow on ground
      this.shadowMesh.position.set(0, 0.015, 0);
      this.shadowMesh.quaternion.identity();
      this.shadowMat.opacity = 0.45;
      this.calloutSprite.visible = false;
    } else {
      // Airborne: orient along parabolic trajectory tangent
      const dJump = 4.0 * route.maxJumpH * (1.0 - 2.0 * normAirTime);
      const airTangent = new THREE.Vector3(
        this.tempTangent.x,
        this.tempTangent.y + dJump * 0.15,
        this.tempTangent.z
      ).normalize();

      const upVec = new THREE.Vector3(0, 1, 0);
      const R = new THREE.Vector3().crossVectors(airTangent, upVec).normalize();
      const trueUp = new THREE.Vector3().crossVectors(R, airTangent).normalize();

      this.rotMatrix.makeBasis(R, trueUp, airTangent);
      this.targetQuat.setFromRotationMatrix(this.rotMatrix);
      this.currentQuat.slerp(this.targetQuat, Math.min(1.0, 14.0 * dt));
      this.rootGroup.quaternion.copy(this.currentQuat);

      // Contact shadow stays down on surface
      this.shadowMesh.position.set(0, -jumpH + 0.015, 0);
      this.shadowMat.opacity = Math.max(0.08, 0.45 - jumpH * 0.22);

      // Floating 3D Callout Billboard Sprite above rider
      this.calloutSprite.visible = true;
      const scalePop = Math.min(1.0, normAirTime * 3.5) * (1.0 + 0.25 * Math.sin(normAirTime * Math.PI));
      this.calloutSprite.scale.set(1.4 * scalePop, 0.39 * scalePop, 1.0);
    }

    // Wheel rolling rotation
    const speed = route.curve.getLength() / route.duration;
    this.wheelAngle += (speed * dt) / 0.055; // 110mm wheels (radius 0.055m)
    this.wheelFront.rotation.x = this.wheelAngle;
    this.wheelRear.rotation.x = this.wheelAngle;

    // Apply stunt animations or grounded pumping kinematics
    if (isAirborne) {
      this.applyStuntAnimation(normAirTime, route);
    } else {
      this.applyGroundedPumpingAnimation(t, route, sample.slopeX, sample.slopeZ);
    }
  }

  /**
   * Executes wild stunt scooter moves during airborne phases.
   */
  private applyStuntAnimation(u: number, route: ScooterRoute): void {
    // Trigger sound swoosh & HUD callout once near apex of jump
    if (u >= 0.35 && !this.stuntSoundTriggered) {
      this.stuntSoundTriggered = true;
      this.audio.playSnapSwoosh(false);

      // Show subtle HUD banner if player is not currently engaged in a high combo
      if (this.hud.comboTimeout <= 0.1 && this.hud.comboMultiplier <= 1) {
        this.hud.showTrickBanner(`🛴 SCOOTER KID: ${route.stuntName}`, false);
      }
    }

    switch (route.stunt) {
      case 'DOUBLE_TAILWHIP': {
        // Double Tailwhip: deck spins 720° (4 * Math.PI) around headtube headset
        // Legs kick deck, spread outward, then catch before landing
        if (u >= 0.08 && u <= 0.84) {
          const w = (u - 0.08) / (0.84 - 0.08);
          this.deckPivot.rotation.y = w * 4.0 * Math.PI;

          const legSpread = Math.sin(w * Math.PI);
          this.hipL.rotation.set(0.35 * legSpread, 0, -0.65 * legSpread);
          this.hipR.rotation.set(-0.45 * legSpread, 0.35, 0.75 * legSpread);
          this.kneeL.rotation.set(0.65 * legSpread, 0, 0);
          this.kneeR.rotation.set(0.55 * legSpread, 0, 0);
        } else {
          this.deckPivot.rotation.y = 0;
          this.hipL.rotation.set(-0.35, 0, -0.08);
          this.hipR.rotation.set(-0.25, 0.35, 0.08);
        }
        break;
      }

      case 'BACKFLIP_BARSPIN': {
        // Backflip: full 360° flip of scooter + rider
        // Barspin: handlebars spin 360° around steerer axis while inverted
        if (u >= 0.05 && u <= 0.92) {
          const w = (u - 0.05) / (0.92 - 0.05);
          this.flipGroup.rotation.x = -w * 2.0 * Math.PI;

          // Barspin occurs mid-flip (w: 0.2..0.8)
          if (w >= 0.2 && w <= 0.8) {
            const b = (w - 0.2) / 0.6;
            this.barPivot.rotation.y = b * 2.0 * Math.PI;

            // Hands release bar briefly during spin
            this.shoulderL.rotation.z = -0.55;
            this.shoulderR.rotation.z = 0.55;
          } else {
            this.barPivot.rotation.y = 0;
            this.shoulderL.rotation.z = -0.22;
            this.shoulderR.rotation.z = 0.22;
          }
        } else {
          this.flipGroup.rotation.x = 0;
          this.barPivot.rotation.y = 0;
        }
        break;
      }

      case 'SUPERMAN': {
        // Superman: rider's body stretches horizontally backward behind the scooter
        // Legs extend straight together, hands hold handlebars with straight arms
        if (u >= 0.10 && u <= 0.86) {
          const w = (u - 0.10) / (0.86 - 0.10);
          const p = Math.sin(w * Math.PI);

          this.riderPivot.position.z = -0.22 - 0.42 * p;
          this.riderPivot.position.y = 0.08 + 0.18 * p;
          this.riderPivot.rotation.x = -1.18 * p;

          // Arms stretch forward
          this.shoulderL.rotation.set(-1.42 * p, 0.1, -0.15);
          this.shoulderR.rotation.set(-1.42 * p, -0.1, 0.15);
          this.elbowL.rotation.set(0.15 * p, 0, 0);
          this.elbowR.rotation.set(0.15 * p, 0, 0);

          // Legs locked together behind
          this.hipL.rotation.set(1.25 * p, 0, 0);
          this.hipR.rotation.set(1.25 * p, 0, 0);
          this.kneeL.rotation.set(0.05, 0, 0);
          this.kneeR.rotation.set(0.05, 0, 0);
        } else {
          this.riderPivot.position.set(0, 0.08, -0.22);
          this.riderPivot.rotation.set(0, 0, 0);
          this.setNeutralRidingPose();
        }
        break;
      }

      case 'HEEL_CLICK_BARSPIN': {
        // Double Barspin + Heel Click: bars spin 720° while feet click heels
        if (u >= 0.08 && u <= 0.88) {
          const w = (u - 0.08) / (0.88 - 0.08);
          this.barPivot.rotation.y = w * 4.0 * Math.PI;

          const click = Math.sin(w * Math.PI);
          this.hipL.rotation.set(-0.65 * click, 0, -0.42 * click);
          this.hipR.rotation.set(-0.65 * click, 0, 0.42 * click);
          this.kneeL.rotation.set(0.55 * click, 0, 0);
          this.kneeR.rotation.set(0.55 * click, 0, 0);
        } else {
          this.barPivot.rotation.y = 0;
          this.setNeutralRidingPose();
        }
        break;
      }
    }
  }

  /**
   * Applies realistic body compression, pumping and shock-absorption when grounded.
   */
  private applyGroundedPumpingAnimation(
    t: number,
    route: ScooterRoute,
    slopeX: number,
    slopeZ: number
  ): void {
    // Reset stunt pivots
    this.deckPivot.rotation.y = 0;
    this.barPivot.rotation.y = 0;
    this.flipGroup.rotation.x = 0;

    // Check if right before takeoff (crouching to pop)
    const dtPreLaunch = route.airStart - t;
    const dtPostLanding = t - route.airEnd;

    let crouch = 0;
    if (dtPreLaunch >= 0 && dtPreLaunch <= 0.04) {
      // Compressing legs to pump into launch ramp
      crouch = 1.0 - dtPreLaunch / 0.04;
    } else if (dtPostLanding >= 0 && dtPostLanding <= 0.06) {
      // Absorbing landing shock
      crouch = 1.0 - dtPostLanding / 0.06;
    } else {
      // Rhythmic subtle pumping with terrain slope
      const slopeMagnitude = Math.hypot(slopeX, slopeZ);
      crouch = 0.15 + 0.25 * Math.sin(t * 35.0) * Math.min(1.0, slopeMagnitude);
    }

    // Apply crouch posture
    this.riderPivot.position.y = 0.08 - 0.06 * crouch;
    this.torsoGroup.rotation.x = 0.12 + 0.28 * crouch;

    this.hipL.rotation.x = -0.25 - 0.45 * crouch;
    this.kneeL.rotation.x = 0.42 + 0.65 * crouch;

    this.hipR.rotation.x = -0.18 - 0.42 * crouch;
    this.kneeR.rotation.x = 0.38 + 0.62 * crouch;

    this.shoulderL.rotation.x = -0.75 - 0.25 * crouch;
    this.shoulderR.rotation.x = -0.75 - 0.25 * crouch;
    this.elbowL.rotation.x = 0.68 + 0.35 * crouch;
    this.elbowR.rotation.x = 0.68 + 0.35 * crouch;
  }

  /**
   * Force triggers a random crossing immediately (Dev / QA / Test button).
   */
  public triggerCrossingNow(): void {
    if (this.routes.length === 0) return;

    this.currentRouteIndex = Math.floor(Math.random() * this.routes.length);
    const route = this.routes[this.currentRouteIndex];

    this.currentProgress = 0;
    this.isCrossingActive = true;
    this.stuntSoundTriggered = false;
    this.setNeutralRidingPose();
    this.updateCalloutText(route.stuntName);

    // Initial position on route
    route.curve.getPoint(0, this.tempVec);
    const sample = this.parkSurface.sample(this.tempVec.x, this.tempVec.z);
    this.rootGroup.position.set(this.tempVec.x, sample.height, this.tempVec.z);
    this.rootGroup.visible = true;
  }

  /**
   * Returns whether the scooter kid is currently crossing the park.
   */
  public isActive(): boolean {
    return this.isCrossingActive;
  }

  /**
   * Resets the scooter NPC state (e.g. on park switch or game reset).
   */
  public reset(): void {
    this.isCrossingActive = false;
    this.rootGroup.visible = false;
    this.currentProgress = 0;
    this.timerSec = 0;
    this.nextIntervalSec = ScooterRiderNPC.INITIAL_DELAY_SEC;
    this.setNeutralRidingPose();
  }
}
