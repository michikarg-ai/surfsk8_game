import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ParkSurface, SurfaceSample } from '../physics/ParkSurface';
import { resolveAssetUrl } from '../utils/assetUrl';

export type WantedParkId = 'im_gefilde' | 'airport_skatepark';

export interface WantedUpdateState {
  active: boolean;
  stars: number;
  signsKnocked: number;
  totalSigns: number;
  inOutlawSpotlight: boolean;
  outlawMultiplier: number;
  bustedProgress: number;
  newlyKnockedSign: boolean;
  escalatedToStar: number | null;
  justBusted: boolean;
  justEscapedSpray: boolean;
  escapeBonus: number;
}

interface SignPlacement {
  id: number;
  label: string;
  x: number;
  z: number;
  yaw: number;
}

interface ParkWantedConfig {
  signs: [SignPlacement, SignPlacement, SignPlacement];
  payNSpray: { x: number; z: number };
  flashlightLoop: [number, number][];
  segwaySpawns: [number, number][];
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
}

const PARK_WANTED_CONFIGS: Record<WantedParkId, ParkWantedConfig> = {
  im_gefilde: {
    signs: [
      { id: 1, label: 'East Sunset Deck', x: 21.0, z: 12.5, yaw: -2.12 },
      { id: 2, label: 'West Rim Entrance', x: -19.5, z: 5.5, yaw: 1.75 },
      { id: 3, label: 'North Rim Perimeter', x: -1.5, z: -12.5, yaw: 0.31 },
    ],
    // Flat upper deck tucked directly behind the East Sunset Palm Mural Wall
    payNSpray: { x: 23.8, z: 9.8 },
    flashlightLoop: [
      [2.5, 3.5],
      [11.5, 3.2],
      [13.5, -1.5],
      [3.5, -6.5],
      [-0.5, 1.8],
      [-2.0, 5.0],
    ],
    segwaySpawns: [
      [0.5, 1.5],
      [11.5, 3.2],
      [3.5, -6.5],
      [-2.0, 5.0],
      [13.5, -1.5],
    ],
    bounds: { xMin: -18.0, xMax: 25.0, zMin: -16.0, zMax: 16.0 },
  },
  airport_skatepark: {
    signs: [
      { id: 1, label: 'South Concrete Perimeter', x: 5.5, z: 25.5, yaw: -2.93 },
      { id: 2, label: 'East Outer Walkway', x: 16.0, z: 5.0, yaw: -1.87 },
      { id: 3, label: 'NW Graffiti Deck', x: -10.0, z: -11.0, yaw: 0.74 },
    ],
    // Flat upper deck right behind the North Graffiti Wall & Bowl apex
    payNSpray: { x: 2.2, z: -17.2 },
    flashlightLoop: [
      [1.2, 2.0],
      [2.8, -4.5],
      [-1.8, -5.5],
      [-2.5, 1.5],
    ],
    segwaySpawns: [
      [-0.5, 1.5],
      [2.0, -5.0],
      [-3.0, 11.2],
      [5.5, 11.2],
      [-9.2, -9.5],
    ],
    bounds: { xMin: -14.5, xMax: 15.0, zMin: -19.5, zMax: 14.5 },
  },
};

const BONE_ALIASES: Record<string, string[]> = {
  Hips: ['pelvis', 'Hips'],
  Spine: ['spine_01', 'Spine'],
  Spine1: ['spine_02', 'Spine1'],
  Spine2: ['spine_03', 'Spine2'],
  Neck: ['neck_01', 'Neck'],
  Head: ['head', 'Head'],
  LeftUpLeg: ['thigh_l', 'LeftUpLeg'],
  LeftLeg: ['calf_l', 'LeftLeg'],
  LeftFoot: ['foot_l', 'LeftFoot'],
  RightUpLeg: ['thigh_r', 'RightUpLeg'],
  RightLeg: ['calf_r', 'RightLeg'],
  RightFoot: ['foot_r', 'RightFoot'],
  LeftArm: ['upperarm_l', 'LeftArm'],
  LeftForeArm: ['lowerarm_l', 'LeftForeArm'],
  LeftHand: ['hand_l', 'LeftHand'],
  RightArm: ['upperarm_r', 'RightArm'],
  RightForeArm: ['lowerarm_r', 'RightForeArm'],
  RightHand: ['hand_r', 'RightHand'],
};

interface SignInstance {
  id: number;
  x: number;
  z: number;
  baseY: number;
  yaw: number;
  root: THREE.Group;
  tumblePivot: THREE.Group;
  groundRing: THREE.Mesh;
  groundRingMat: THREE.MeshBasicMaterial;
  ledMat: THREE.MeshBasicMaterial;
  knocked: boolean;
  tumbleTimer: number;
  tumbleAxis: THREE.Vector3;
  spinSign: number;
}

interface BurstParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
  gravity: number;
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * AFTER HOURS: 5-Sterne Park-Verbot — Secret Night-Mode GTA Wanted System & Bavarian Pay'n'Spray.
 *
 * Pure Three.js + CanvasTexture + InstancedMesh implementation (zero runtime PointLights/SpotLights
 * to prevent synchronous WebGL shader recompiles).
 */
export class AfterHoursWanted {
  public readonly rootGroup = new THREE.Group();

  private parkId: WantedParkId;
  private parkSurface: ParkSurface;
  private isNightMode = false;
  private disposed = false;

  // Core wanted state
  private stars = 0;
  private signsKnocked = 0;
  private readonly totalSigns = 3;
  private inOutlawSpotlight = false;
  private bustedTimer = 0;
  private resetCooldownTimer = 0;
  private outlawTrickAccum = 0;
  private highFlowHeatTimer = 0;
  private elapsedSec = 0;

  // 1. Knockable "Skaten nach 22 Uhr verboten" signs
  private signsGroup = new THREE.Group();
  private signs: SignInstance[] = [];
  private signFaceTex: THREE.CanvasTexture;
  private signFaceMat: THREE.MeshStandardMaterial;
  private signMetalMat: THREE.MeshStandardMaterial;
  private ringGlowTex: THREE.CanvasTexture;

  // 2. Ordnungsamt Patrolling Flashlight Cone (1★-5★)
  private flashlightGroup = new THREE.Group();
  private flashlightBeamPivot = new THREE.Group();
  private flashlightGroundDisc: THREE.Mesh;
  private flashlightGroundMat: THREE.MeshBasicMaterial;
  private flashlightConeMat: THREE.MeshBasicMaterial;
  private flashlightProgress = 0;
  private flashlightPos = new THREE.Vector3();
  private flashlightSpotPos = new THREE.Vector3();

  // 3. Segway-Security 3D Chaser + MakeHuman Officer (2★-5★)
  private segwayGroup = new THREE.Group();
  private segwayVehiclePivot = new THREE.Group();
  private segwaySteeringPivot = new THREE.Group();
  private segwayWheelL = new THREE.Group();
  private segwayWheelR = new THREE.Group();
  private segwayHeadlightDisc: THREE.Mesh;
  private segwayPos = new THREE.Vector3();
  private segwayYaw = 0;
  private segwaySpeed = 0;
  private segwayWheelAngle = 0;
  private segwayFarTimer = 0;
  private segwaySpawned = false;

  // MakeHuman Security Officer Rig & Fallback
  private fallbackOfficerGroup = new THREE.Group();
  private makeHumanGroup = new THREE.Group();
  private makeHumanRoot: THREE.Object3D | null = null;
  private bones: Record<string, THREE.Bone> = {};
  private restQuat = new Map<THREE.Bone, THREE.Quaternion>();
  private restPos = new Map<THREE.Bone, THREE.Vector3>();
  private fingerBones: THREE.Bone[] = [];
  private middleBoneL: THREE.Bone | null = null;
  private middleBoneR: THREE.Bone | null = null;
  private legLengths: Record<'Left' | 'Right', { upper: number; lower: number }> = {
    Left: { upper: 0.44, lower: 0.44 },
    Right: { upper: 0.44, lower: 0.44 },
  };
  private armLengths: Record<'Left' | 'Right', { upper: number; lower: number }> = {
    Left: { upper: 0.26, lower: 0.26 },
    Right: { upper: 0.26, lower: 0.26 },
  };
  private footRestInSegway: Record<'Left' | 'Right', THREE.Quaternion> = {
    Left: new THREE.Quaternion(),
    Right: new THREE.Quaternion(),
  };
  private hasSkeleton = false;
  private gripTargetL = new THREE.Object3D();
  private gripTargetR = new THREE.Object3D();
  private gripCenterL = new THREE.Object3D();
  private gripCenterR = new THREE.Object3D();
  private footTargetL = new THREE.Object3D();
  private footTargetR = new THREE.Object3D();

  // Flashing Red/Blue shoulder & fallback beacons
  private beaconRedMats: THREE.MeshBasicMaterial[] = [];
  private beaconBlueMats: THREE.MeshBasicMaterial[] = [];

  // 4. Police Drone + Searchlight Cone (3★-5★)
  private droneGroup = new THREE.Group();
  private droneChassis = new THREE.Group();
  private droneRotors: THREE.Object3D[] = [];
  private droneRedMat!: THREE.MeshBasicMaterial;
  private droneBlueMat!: THREE.MeshBasicMaterial;
  private droneGroundDisc: THREE.Mesh;
  private droneGroundMat: THREE.MeshBasicMaterial;
  private dronePos = new THREE.Vector3();
  private droneSpotPos = new THREE.Vector3();
  private droneVel = new THREE.Vector3();
  private droneSpawned = false;

  // 5. MUC Heli-Spotlight (4★-5★)
  private heliGroup = new THREE.Group();
  private heliBeamMesh: THREE.Mesh;
  private heliGroundDisc: THREE.Mesh;
  private heliGroundMat: THREE.MeshBasicMaterial;
  private heliSpotPos = new THREE.Vector3();
  private heliPhase = 0;

  // 6. Bavarian Pay'n'Spray Escape Zone (1★-5★)
  private sprayZoneGroup = new THREE.Group();
  private sprayOuterRing: THREE.Mesh;
  private sprayInnerRing: THREE.Mesh;
  private sprayCylinder: THREE.Mesh;
  private sprayCanPivot = new THREE.Group();
  private spraySprite: THREE.Sprite;
  private sprayOuterMat: THREE.MeshBasicMaterial;
  private sprayInnerMat: THREE.MeshBasicMaterial;
  private sprayCylMat: THREE.MeshBasicMaterial;
  private sprayPos = new THREE.Vector3();

  // Shared InstancedMesh Particle Pool (Graffiti Mist + Sign Knock Sparks)
  private static readonly MAX_PARTICLES = 96;
  private particleMesh: THREE.InstancedMesh;
  private particles: BurstParticle[] = [];
  private dummyObj = new THREE.Object3D();
  private readonly graffitiPalette = [
    new THREE.Color(0xff2a85), // Neon Pink
    new THREE.Color(0x00f5d4), // Electric Cyan
    new THREE.Color(0xfacc15), // Bavarian Gold
    new THREE.Color(0x38bdf8), // Sky Blue
    new THREE.Color(0xa855f7), // Ultraviolet
    new THREE.Color(0x4ade80), // Acid Lime
  ];
  private readonly sparkColor = new THREE.Color(0xffb703);

  // Disposable textures created by this module
  private ownedTextures: THREE.Texture[] = [];

  // Reusable scratch math objects (zero per-frame GC allocations)
  private tmpVecA = new THREE.Vector3();
  private tmpQuatA = new THREE.Quaternion();
  private tmpQuatB = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    parkSurface: ParkSurface,
    parkId: WantedParkId
  ) {
    this.parkSurface = parkSurface;
    this.parkId = this.normalizeParkId(parkId);

    this.rootGroup.name = 'AfterHoursWanted';
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // Build shared CanvasTextures
    this.signFaceTex = this.createProhibitionSignTexture();
    this.ringGlowTex = this.createSoftRadialTexture('rgba(239, 68, 68, 0.92)', 'rgba(239, 68, 68, 0.0)', 0.55);
    this.ownedTextures.push(this.signFaceTex, this.ringGlowTex);

    this.signFaceMat = new THREE.MeshStandardMaterial({
      map: this.signFaceTex,
      roughness: 0.42,
      metalness: 0.08,
      emissive: 0x381010,
      emissiveIntensity: 0.35,
    });
    this.signMetalMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.78,
      roughness: 0.32,
    });

    // 1. Build 3 knockable signs
    this.rootGroup.add(this.signsGroup);
    this.buildSigns();

    // 2. Build Ordnungsamt Flashlight Patrol
    const [fDisc, fMat, fConeMat] = this.buildFlashlightPatrol();
    this.flashlightGroundDisc = fDisc;
    this.flashlightGroundMat = fMat;
    this.flashlightConeMat = fConeMat;
    this.flashlightGroup.visible = false;
    this.rootGroup.add(this.flashlightGroup);

    // 3. Build Segway-Security Chaser + Fallback + async MakeHuman Officer
    this.segwayHeadlightDisc = this.buildSegwaySecurity();
    this.segwayGroup.visible = false;
    this.rootGroup.add(this.segwayGroup);
    void this.loadMakeHumanSecurity();

    // 4. Build Police Drone + Searchlight
    const [dDisc, dMat] = this.buildPoliceDrone();
    this.droneGroundDisc = dDisc;
    this.droneGroundMat = dMat;
    this.droneGroup.visible = false;
    this.rootGroup.add(this.droneGroup);

    // 5. Build MUC Heli-Spotlight
    const [hBeam, hDisc, hMat] = this.buildHeliSpotlight();
    this.heliBeamMesh = hBeam;
    this.heliGroundDisc = hDisc;
    this.heliGroundMat = hMat;
    this.heliGroup.visible = false;
    this.rootGroup.add(this.heliGroup);

    // 6. Build Bavarian Pay'n'Spray Zone
    const sprayRefs = this.buildPayNSprayZone();
    this.sprayOuterRing = sprayRefs.outerRing;
    this.sprayInnerRing = sprayRefs.innerRing;
    this.sprayCylinder = sprayRefs.cylinder;
    this.spraySprite = sprayRefs.sprite;
    this.sprayOuterMat = sprayRefs.outerMat;
    this.sprayInnerMat = sprayRefs.innerMat;
    this.sprayCylMat = sprayRefs.cylMat;
    this.sprayZoneGroup.visible = false;
    this.rootGroup.add(this.sprayZoneGroup);

    // 7. Pre-allocated InstancedMesh Particle Pool (Graffiti Mist & Sparks)
    this.particleMesh = this.buildParticlePool();
    this.rootGroup.add(this.particleMesh);

    // Snap everything to current park surface
    this.layoutForPark();
  }

  private normalizeParkId(parkId: string): WantedParkId {
    return parkId === 'airport_skatepark' ? 'airport_skatepark' : 'im_gefilde';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public setPark(parkId: WantedParkId, parkSurface: ParkSurface): void {
    this.parkId = this.normalizeParkId(parkId);
    this.parkSurface = parkSurface;
    this.resetSession();
    this.layoutForPark();
  }

  public setNightMode(isNight: boolean): { escapedViaDaylight: boolean } {
    if (isNight === this.isNightMode) {
      return { escapedViaDaylight: false };
    }

    if (!isNight) {
      const escapedViaDaylight = this.stars > 0;
      this.isNightMode = false;
      this.clearActiveChaseState(true);
      this.rootGroup.visible = false;
      return { escapedViaDaylight };
    }

    this.isNightMode = true;
    this.rootGroup.visible = true;
    this.refreshSurfaceHeights(this.parkSurface);
    this.syncGroupVisibility();
    return { escapedViaDaylight: false };
  }

  public refreshSurfaceHeights(parkSurface: ParkSurface): void {
    this.parkSurface = parkSurface;
    const cfg = PARK_WANTED_CONFIGS[this.parkId];

    // 1. Update sign ground heights & ground-ring slope alignment
    for (let i = 0; i < this.signs.length; i++) {
      const sign = this.signs[i];
      const placement = cfg.signs[i];
      sign.x = placement.x;
      sign.z = placement.z;
      sign.yaw = placement.yaw;
      const sample = this.parkSurface.sample(sign.x, sign.z);
      sign.baseY = sample.height;
      sign.root.position.set(sign.x, sign.baseY, sign.z);
      sign.root.rotation.y = sign.yaw;

      // Tilt red pulsing ground ring flush onto local slope
      this.tmpQuatA.setFromUnitVectors(UP_AXIS, sample.normal);
      sign.groundRing.quaternion.copy(this.tmpQuatA);
      sign.groundRing.position.set(0, 0.04, 0);
    }

    // 2. Update Pay'n'Spray terrain projection
    this.sprayPos.set(
      cfg.payNSpray.x,
      this.parkSurface.evaluateHeight(cfg.payNSpray.x, cfg.payNSpray.z),
      cfg.payNSpray.z
    );
    this.conformPayNSprayGeometry(cfg.payNSpray.x, cfg.payNSpray.z);

    // 3. Snap active Segway if on terrain
    if (this.segwaySpawned) {
      this.segwayPos.y = this.parkSurface.evaluateHeight(this.segwayPos.x, this.segwayPos.z);
      this.segwayGroup.position.copy(this.segwayPos);
    }
  }

  public resetSession(): void {
    this.clearActiveChaseState(true);
    this.resetParticles();
    this.syncGroupVisibility();
  }

  public notifyTrickLanded(points: number): { escalatedToStar: number | null } {
    if (!this.isNightMode || this.stars < 1 || this.stars >= 5 || !this.inOutlawSpotlight || points <= 0) {
      return { escalatedToStar: null };
    }

    // Big tricks (>= 300 pts) inside the spotlight immediately push +1 star; smaller tricks build up quickly
    this.outlawTrickAccum += points >= 300 ? 1.0 : 0.6;
    if (this.outlawTrickAccum >= 1.0) {
      this.outlawTrickAccum -= 1.0;
      this.stars = Math.min(5, this.stars + 1);
      this.syncGroupVisibility();
      return { escalatedToStar: this.stars };
    }
    return { escalatedToStar: null };
  }

  public update(dt: number, playerPos: THREE.Vector3, playerSpeed: number): WantedUpdateState {
    const safeDt = Math.min(0.05, Math.max(0.0001, dt));
    this.elapsedSec += safeDt;

    // Zero-cost early exit when not in Night Mode
    if (!this.isNightMode) {
      return {
        active: false,
        stars: 0,
        signsKnocked: 0,
        totalSigns: this.totalSigns,
        inOutlawSpotlight: false,
        outlawMultiplier: 1.0,
        bustedProgress: 0,
        newlyKnockedSign: false,
        escalatedToStar: null,
        justBusted: false,
        justEscapedSpray: false,
        escapeBonus: 0,
      };
    }

    let newlyKnockedSign = false;
    let escalatedToStar: number | null = null;
    let justBusted = false;
    let justEscapedSpray = false;
    let escapeBonus = 0;

    // Handle post-bust / post-escape sign respawn cooldown
    if (this.resetCooldownTimer > 0) {
      this.resetCooldownTimer -= safeDt;
      if (this.resetCooldownTimer <= 0) {
        this.resetCooldownTimer = 0;
        this.resetAllSigns();
      }
    }

    // 1. Update sign animations & check knock collisions
    for (const sign of this.signs) {
      if (!sign.knocked) {
        // Subtle pulsing red ground ring & top beacon LED
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 4.5 + sign.id * 1.4);
        sign.groundRingMat.opacity = 0.34 + 0.28 * pulse;
        const ringScale = 0.94 + 0.1 * pulse;
        sign.groundRing.scale.set(ringScale, ringScale, 1);
        sign.ledMat.color.setHex(Math.sin(this.elapsedSec * 6.0 + sign.id) > 0 ? 0xff3b3b : 0x550808);

        if (this.resetCooldownTimer <= 0) {
          const dx = sign.x - playerPos.x;
          const dz = sign.z - playerPos.z;
          const distXZ = Math.hypot(dx, dz);
          const dy = Math.abs(playerPos.y - sign.baseY);
          if (distXZ < 1.5 && dy < 2.2) {
            this.knockOverSign(sign, playerPos);
            newlyKnockedSign = true;
            this.signsKnocked = Math.min(this.totalSigns, this.signsKnocked + 1);
            const targetMinStars = this.signsKnocked;
            const nextStars = Math.min(5, Math.max(targetMinStars, this.stars + 1));
            if (nextStars > this.stars) {
              this.stars = nextStars;
              escalatedToStar = this.stars;
            }
          }
        }
      } else {
        // Animate juicy physics tumble & fade ground ring
        sign.groundRingMat.opacity = Math.max(0, sign.groundRingMat.opacity - safeDt * 1.6);
        if (sign.groundRingMat.opacity <= 0.01) {
          sign.groundRing.visible = false;
        }
        sign.ledMat.color.setHex(0x220404);
        this.animateKnockedSign(sign, safeDt);
      }
    }

    // Sync active pursuer visibility after potential star bump
    this.syncGroupVisibility();

    // Reset spotlight flag; pursuers set it true if player is inside any active beam
    this.inOutlawSpotlight = false;

    // 2. Update active pursuers & spotlights when Wanted (stars >= 1)
    if (this.stars >= 1) {
      this.updateFlashlightPatrol(safeDt, playerPos);

      if (this.stars >= 2) {
        this.updateSegwaySecurity(safeDt, playerPos);
      }

      if (this.stars >= 3) {
        this.updatePoliceDrone(safeDt, playerPos);
      }

      if (this.stars >= 4) {
        this.updateHeliSpotlight(safeDt, playerPos);
      }

      // High-flow skating near pursuers or inside spotlights can also escalate heat (1★..5★)
      if (this.stars < 5) {
        const nearPursuer = this.isNearAnyPursuer(playerPos, 12.0);
        if (playerSpeed >= 4.2 && (this.inOutlawSpotlight || nearPursuer)) {
          this.highFlowHeatTimer += safeDt * (this.inOutlawSpotlight ? 1.15 : 0.75);
          if (this.highFlowHeatTimer >= 8.5) {
            this.highFlowHeatTimer = 0;
            this.stars = Math.min(5, this.stars + 1);
            escalatedToStar = this.stars;
            this.syncGroupVisibility();
          }
        } else {
          this.highFlowHeatTimer = Math.max(0, this.highFlowHeatTimer - safeDt * 0.25);
        }
      }

      // 3. Check Bavarian Pay'n'Spray Escape (< 2.4m)
      this.updatePayNSprayVisuals(safeDt);
      const sprayDistXZ = Math.hypot(playerPos.x - this.sprayPos.x, playerPos.z - this.sprayPos.z);
      const sprayDy = Math.abs(playerPos.y - this.sprayPos.y);
      if (sprayDistXZ < 2.4 && sprayDy < 2.6) {
        justEscapedSpray = true;
        escapeBonus = 1500;
        this.emitGraffitiBurst(this.sprayPos);
        this.clearActiveChaseState(false);
        this.resetCooldownTimer = 2.5;
      }

      // 4. Check Busted Condition (stars >= 2, Segway within 2.1m, speed < 2.0 m/s for 2.2s)
      if (!justEscapedSpray && this.stars >= 2 && this.segwaySpawned) {
        const secDistXZ = Math.hypot(playerPos.x - this.segwayPos.x, playerPos.z - this.segwayPos.z);
        const secDy = Math.abs(playerPos.y - this.segwayPos.y);
        if (secDistXZ <= 2.1 && secDy <= 1.75 && playerSpeed < 2.0) {
          this.bustedTimer = Math.min(2.2, this.bustedTimer + safeDt);
          if (this.bustedTimer >= 2.2) {
            justBusted = true;
            this.clearActiveChaseState(false);
            this.resetCooldownTimer = 2.5;
          }
        } else {
          this.bustedTimer = Math.max(0, this.bustedTimer - safeDt * 1.4);
        }
      } else {
        this.bustedTimer = 0;
      }
    } else {
      this.bustedTimer = 0;
      this.inOutlawSpotlight = false;
    }

    // Always animate active particles (graffiti mist / sparks) even right after escape/knock
    this.updateParticles(safeDt);

    return {
      active: true,
      stars: this.stars,
      signsKnocked: this.signsKnocked,
      totalSigns: this.totalSigns,
      inOutlawSpotlight: this.inOutlawSpotlight,
      outlawMultiplier: this.inOutlawSpotlight ? 2.5 : 1.0,
      bustedProgress: this.stars >= 2 ? THREE.MathUtils.clamp(this.bustedTimer / 2.2, 0, 1) : 0,
      newlyKnockedSign,
      escalatedToStar,
      justBusted,
      justEscapedSpray,
      escapeBonus,
    };
  }

  public dispose(): void {
    this.disposed = true;
    this.scene.remove(this.rootGroup);

    const disposedGeos = new Set<THREE.BufferGeometry>();
    const disposedMats = new Set<THREE.Material>();

    this.rootGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !disposedGeos.has(mesh.geometry)) {
        mesh.geometry.dispose();
        disposedGeos.add(mesh.geometry);
      }
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m && !disposedMats.has(m)) {
            const std = m as THREE.MeshStandardMaterial;
            if (std.map && this.ownedTextures.includes(std.map)) {
              std.map.dispose();
            }
            m.dispose();
            disposedMats.add(m);
          }
        }
      }
    });

    for (const tex of this.ownedTextures) {
      tex.dispose();
    }
    this.ownedTextures = [];
  }

  // ---------------------------------------------------------------------------
  // State Helpers
  // ---------------------------------------------------------------------------

  private layoutForPark(): void {
    this.refreshSurfaceHeights(this.parkSurface);
    const cfg = PARK_WANTED_CONFIGS[this.parkId];
    this.flashlightPos.set(cfg.flashlightLoop[0][0], 0, cfg.flashlightLoop[0][1]);
    this.segwayPos.set(cfg.segwaySpawns[0][0], 0, cfg.segwaySpawns[0][1]);
  }

  private clearActiveChaseState(resetSignsImmediately: boolean): void {
    this.stars = 0;
    this.inOutlawSpotlight = false;
    this.bustedTimer = 0;
    this.outlawTrickAccum = 0;
    this.highFlowHeatTimer = 0;
    this.segwaySpawned = false;
    this.droneSpawned = false;
    this.segwayFarTimer = 0;
    this.segwaySpeed = 0;

    if (resetSignsImmediately) {
      this.resetCooldownTimer = 0;
      this.resetAllSigns();
    }
    this.syncGroupVisibility();
  }

  private resetAllSigns(): void {
    this.signsKnocked = 0;
    for (const sign of this.signs) {
      sign.knocked = false;
      sign.tumbleTimer = 0;
      sign.tumblePivot.quaternion.identity();
      sign.tumblePivot.position.set(0, 0.04, 0);
      sign.groundRing.visible = true;
      sign.groundRingMat.opacity = 0.48;
      sign.ledMat.color.setHex(0xff3b3b);
    }
  }

  private syncGroupVisibility(): void {
    const activeWanted = this.isNightMode && this.stars >= 1;
    this.flashlightGroup.visible = activeWanted;
    this.sprayZoneGroup.visible = activeWanted;
    this.segwayGroup.visible = this.isNightMode && this.stars >= 2;
    this.droneGroup.visible = this.isNightMode && this.stars >= 3;
    this.heliGroup.visible = this.isNightMode && this.stars >= 4;
  }

  // ---------------------------------------------------------------------------
  // 1. Knockable "Skaten nach 22 Uhr verboten" Signs
  // ---------------------------------------------------------------------------

  private createProhibitionSignTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Transparent outside circle
    ctx.clearRect(0, 0, 512, 512);

    // Outer white metallic rim
    ctx.beginPath();
    ctx.arc(256, 256, 248, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();

    // Thick German StVO Red Ring
    ctx.beginPath();
    ctx.arc(256, 256, 224, 0, Math.PI * 2);
    ctx.lineWidth = 42;
    ctx.strokeStyle = '#dc2626';
    ctx.stroke();

    // Top arched text: "NO SKATING"
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 42px "Barlow Condensed", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SKATEN VERBOTEN', 256, 118);

    // Center skateboarder/deck silhouette
    ctx.save();
    ctx.translate(256, 240);
    // Skateboard deck
    ctx.beginPath();
    ctx.roundRect(-84, 30, 168, 16, 8);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    // Wheels
    ctx.beginPath();
    ctx.arc(-50, 56, 13, 0, Math.PI * 2);
    ctx.arc(50, 56, 13, 0, Math.PI * 2);
    ctx.fill();
    // Skater silhouette
    ctx.beginPath();
    ctx.arc(10, -70, 20, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    // Torso
    ctx.beginPath();
    ctx.moveTo(6, -45);
    ctx.lineTo(-8, 0);
    ctx.stroke();
    // Legs
    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-34, 30);
    ctx.moveTo(-8, 0);
    ctx.lineTo(30, 30);
    // Arms
    ctx.moveTo(2, -32);
    ctx.lineTo(-42, -18);
    ctx.moveTo(2, -32);
    ctx.lineTo(48, -42);
    ctx.stroke();
    ctx.restore();

    // Diagonal StVO Prohibition Slash
    ctx.save();
    ctx.translate(256, 256);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(-195, -18, 390, 36);
    ctx.restore();

    // Bottom Time Banner ("NACH 22:00 / 22h")
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.roundRect(108, 344, 296, 66, 14);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px "Barlow Condensed", Impact, sans-serif';
    ctx.fillText('NACH 22:00 (22h)', 256, 379);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildSigns(): void {
    const basePlateGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.04, 16);
    const poleGeo = new THREE.CylinderGeometry(0.026, 0.028, 1.46, 12);
    const plateGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.026, 32);
    const faceGeo = new THREE.CircleGeometry(0.335, 32);
    const ledGeo = new THREE.SphereGeometry(0.036, 10, 10);
    const ringGeo = new THREE.RingGeometry(0.45, 1.05, 36);

    const darkBackMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.72,
      roughness: 0.38,
    });

    for (let i = 0; i < this.totalSigns; i++) {
      const root = new THREE.Group();
      root.name = `ProhibitionSign_${i + 1}`;

      // Red pulsing ground ring
      const groundRingMat = new THREE.MeshBasicMaterial({
        map: this.ringGlowTex,
        color: 0xff3b3b,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const groundRingGeo = ringGeo.clone();
      groundRingGeo.rotateX(-Math.PI / 2);
      const groundRing = new THREE.Mesh(groundRingGeo, groundRingMat);
      groundRing.position.y = 0.04;
      root.add(groundRing);

      // Anchor base plate
      const basePlate = new THREE.Mesh(basePlateGeo, this.signMetalMat);
      basePlate.position.y = 0.02;
      basePlate.castShadow = true;
      basePlate.receiveShadow = true;
      root.add(basePlate);

      // Tumble pivot above base plate
      const tumblePivot = new THREE.Group();
      tumblePivot.position.y = 0.04;
      root.add(tumblePivot);

      const pole = new THREE.Mesh(poleGeo, this.signMetalMat);
      pole.position.y = 0.73;
      pole.castShadow = true;
      tumblePivot.add(pole);

      // Circular aluminum sign housing
      const plate = new THREE.Mesh(plateGeo, darkBackMat);
      plate.rotation.x = Math.PI / 2;
      plate.position.y = 1.42;
      plate.castShadow = true;
      tumblePivot.add(plate);

      // Front & Back printed StVO faces so readable from both sides
      const frontFace = new THREE.Mesh(faceGeo, this.signFaceMat);
      frontFace.position.set(0, 1.42, 0.015);
      tumblePivot.add(frontFace);

      const backFace = new THREE.Mesh(faceGeo, this.signFaceMat);
      backFace.rotation.y = Math.PI;
      backFace.position.set(0, 1.42, -0.015);
      tumblePivot.add(backFace);

      // Top red LED warning beacon
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(0, 1.78, 0);
      tumblePivot.add(led);

      this.signsGroup.add(root);

      this.signs.push({
        id: i + 1,
        x: 0,
        z: 0,
        baseY: 0,
        yaw: 0,
        root,
        tumblePivot,
        groundRing,
        groundRingMat,
        ledMat,
        knocked: false,
        tumbleTimer: 0,
        tumbleAxis: new THREE.Vector3(1, 0, 0),
        spinSign: 1,
      });
    }
  }

  private knockOverSign(sign: SignInstance, playerPos: THREE.Vector3): void {
    sign.knocked = true;
    sign.tumbleTimer = 0;

    // Direction away from player in world XZ, transformed into sign's local frame
    const worldDirX = sign.x - playerPos.x;
    const worldDirZ = sign.z - playerPos.z;
    const len = Math.max(0.01, Math.hypot(worldDirX, worldDirZ));
    const nx = worldDirX / len;
    const nz = worldDirZ / len;

    // Rotate direction into sign.root local XZ (undo rotation.y = sign.yaw)
    const cy = Math.cos(-sign.yaw);
    const sy = Math.sin(-sign.yaw);
    const lx = nx * cy + nz * sy;
    const lz = -nx * sy + nz * cy;

    // Axis perpendicular to impact direction in horizontal plane (right-hand rule: UP x impactDir)
    sign.tumbleAxis.set(lz, 0, -lx).normalize();
    sign.spinSign = Math.random() < 0.5 ? 1 : -1;

    // Emit impact metal spark burst
    this.tmpVecA.set(sign.x, sign.baseY + 0.85, sign.z);
    this.emitSparkBurst(this.tmpVecA);
  }

  private animateKnockedSign(sign: SignInstance, dt: number): void {
    const duration = 0.85;
    if (sign.tumbleTimer >= duration) return;

    sign.tumbleTimer = Math.min(duration, sign.tumbleTimer + dt);
    const u = sign.tumbleTimer / duration;

    // Accelerating tip-over + crisp bounce upon hitting concrete at u = 0.62
    let tilt: number;
    let hopY = 0.04;
    if (u < 0.62) {
      const f = u / 0.62;
      tilt = (Math.PI * 0.485) * (f * f);
      hopY = 0.04 + Math.sin(f * Math.PI) * 0.14;
    } else {
      const b = (u - 0.62) / 0.38;
      const bounce = Math.abs(Math.sin(b * Math.PI * 1.5)) * (1 - b) * 0.14;
      tilt = Math.PI * 0.485 - bounce;
      hopY = 0.04 + bounce * 0.45;
    }

    const spinAngle = sign.spinSign * 0.65 * Math.min(1, u * 1.3);
    this.tmpQuatA.setFromAxisAngle(sign.tumbleAxis, tilt);
    this.tmpQuatB.setFromAxisAngle(UP_AXIS, spinAngle);
    sign.tumblePivot.quaternion.copy(this.tmpQuatA).multiply(this.tmpQuatB);
    sign.tumblePivot.position.y = hopY;
  }

  // ---------------------------------------------------------------------------
  // 2. Ordnungsamt Patrolling Flashlight Cone (1★-5★)
  // ---------------------------------------------------------------------------

  private buildFlashlightPatrol(): [THREE.Mesh, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] {
    const tex = this.createSoftRadialTexture('rgba(255, 247, 200, 0.92)', 'rgba(255, 224, 130, 0.0)', 0.45);
    const beamTex = this.createVerticalFadeTexture('rgba(255, 245, 190, 0.42)', 'rgba(255, 230, 150, 0.0)');
    this.ownedTextures.push(tex, beamTex);

    // Torch emitter body at guard hand height
    const torchGroup = new THREE.Group();
    const torchBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.045, 0.28, 12),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.35 })
    );
    torchBody.rotation.x = Math.PI / 2;
    torchGroup.add(torchBody);

    const lensMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.055, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff7cc })
    );
    lensMesh.position.z = 0.145;
    torchGroup.add(lensMesh);

    // Volumetric forward-down cone beam
    const coneLen = 5.4;
    const coneGeo = new THREE.CylinderGeometry(0.09, 2.55, coneLen, 24, 1, true);
    // Translate so apex sits at origin and cone extends along +Z/+Down
    coneGeo.translate(0, -coneLen * 0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      map: beamTex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.rotation.x = 0.26; // aim downward onto concrete ahead
    torchGroup.add(coneMesh);

    this.flashlightBeamPivot.position.set(0, 1.38, 0);
    this.flashlightBeamPivot.add(torchGroup);
    this.flashlightGroup.add(this.flashlightBeamPivot);

    // Ground spotlight disc
    const discGeo = new THREE.CircleGeometry(3.4, 32);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    this.flashlightGroup.add(discMesh);

    return [discMesh, discMat, coneMat];
  }

  private updateFlashlightPatrol(dt: number, playerPos: THREE.Vector3): void {
    const loop = PARK_WANTED_CONFIGS[this.parkId].flashlightLoop;
    const count = loop.length;
    const speed = 0.16 + this.stars * 0.025;
    this.flashlightProgress = (this.flashlightProgress + dt * speed) % count;

    const idx0 = Math.floor(this.flashlightProgress);
    const idx1 = (idx0 + 1) % count;
    const frac = this.flashlightProgress - idx0;

    const px = THREE.MathUtils.lerp(loop[idx0][0], loop[idx1][0], frac);
    const pz = THREE.MathUtils.lerp(loop[idx0][1], loop[idx1][1], frac);
    const py = this.parkSurface.evaluateHeight(px, pz);
    this.flashlightPos.set(px, py, pz);

    const dirX = loop[idx1][0] - loop[idx0][0];
    const dirZ = loop[idx1][1] - loop[idx0][1];
    const baseYaw = Math.atan2(dirX, dirZ);
    const sweepYaw = baseYaw + Math.sin(this.elapsedSec * 2.1) * 0.48;

    this.flashlightBeamPivot.position.set(px, py + 1.38, pz);
    this.flashlightBeamPivot.rotation.y = sweepYaw;

    // Ground spotlight spot ~3.8m ahead of torch along sweepYaw
    const spotX = px + Math.sin(sweepYaw) * 3.8;
    const spotZ = pz + Math.cos(sweepYaw) * 3.8;
    const spotSample = this.parkSurface.sample(spotX, spotZ);
    this.flashlightSpotPos.set(spotX, spotSample.height + 0.06, spotZ);

    this.flashlightGroundDisc.position.copy(this.flashlightSpotPos);
    this.tmpQuatA.setFromUnitVectors(UP_AXIS, spotSample.normal);
    this.flashlightGroundDisc.quaternion.copy(this.tmpQuatA);
    this.flashlightConeMat.opacity = 0.42 + 0.12 * Math.sin(this.elapsedSec * 5.0);

    // Check if player is inside flashlight beam
    const dSpotXZ = Math.hypot(playerPos.x - spotX, playerPos.z - spotZ);
    const dSpotY = Math.abs(playerPos.y - spotSample.height);
    if (dSpotXZ <= 3.4 && dSpotY <= 2.4) {
      this.inOutlawSpotlight = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Segway-Security 3D Chaser + MakeHuman Officer (2★-5★)
  // ---------------------------------------------------------------------------

  private buildSegwaySecurity(): THREE.Mesh {
    this.segwayGroup.name = 'SegwaySecurityGroup';
    this.segwayVehiclePivot.name = 'SegwayVehiclePivot';
    this.segwayGroup.add(this.segwayVehiclePivot);

    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.75,
      roughness: 0.35,
    });
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.88,
      roughness: 0.24,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.88,
      metalness: 0.06,
    });
    const neonTrimMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const yellowStripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    // 1. Two chunky all-terrain Segway X2 wheels (radius = 0.23m)
    const buildWheel = (side: -1 | 1): THREE.Group => {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.11, 20), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wg.add(tire);

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.116, 14), alloyMat);
      hub.rotation.z = Math.PI / 2;
      wg.add(hub);

      const accentRing = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.011, 8, 20), neonTrimMat);
      accentRing.rotation.y = Math.PI / 2;
      accentRing.position.x = side * 0.06;
      wg.add(accentRing);

      return wg;
    };

    this.segwayWheelL = buildWheel(1);
    this.segwayWheelL.position.set(0.32, 0.23, 0);
    this.segwayVehiclePivot.add(this.segwayWheelL);

    this.segwayWheelR = buildWheel(-1);
    this.segwayWheelR.position.set(-0.32, 0.23, 0);
    this.segwayVehiclePivot.add(this.segwayWheelR);

    // Wheel fenders with yellow reflective patrol trim
    for (const sx of [-0.32, 0.32]) {
      const fender = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.125, 16, 1, false, -Math.PI * 0.42, Math.PI * 0.84),
        chassisMat
      );
      fender.rotation.z = Math.PI / 2;
      fender.position.set(sx, 0.23, 0);
      this.segwayVehiclePivot.add(fender);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.22), yellowStripeMat);
      stripe.position.set(sx + (sx > 0 ? 0.058 : -0.058), 0.34, 0);
      this.segwayVehiclePivot.add(stripe);
    }

    // 2. Self-balancing base platform (top surface at y = 0.24m)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.40), chassisMat);
    deck.position.set(0, 0.21, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.segwayVehiclePivot.add(deck);

    // Rubber footpads (left +X, right -X)
    const padMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.94 });
    const padL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.015, 0.32), padMat);
    padL.position.set(0.145, 0.246, -0.01);
    this.segwayVehiclePivot.add(padL);
    const padR = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.015, 0.32), padMat);
    padR.position.set(-0.145, 0.246, -0.01);
    this.segwayVehiclePivot.add(padR);

    // Front headlight bar & Rear red brake bar
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.032, 0.025),
      new THREE.MeshBasicMaterial({ color: 0xe0f7ff })
    );
    headlight.position.set(0, 0.22, 0.205);
    this.segwayVehiclePivot.add(headlight);

    const taillight = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.028, 0.022),
      new THREE.MeshBasicMaterial({ color: 0xff2233 })
    );
    taillight.position.set(0, 0.22, -0.205);
    this.segwayVehiclePivot.add(taillight);

    // Forward ground headlight projection disc (additive, zero PointLight)
    const hlTex = this.createSoftRadialTexture('rgba(205, 240, 255, 0.85)', 'rgba(180, 225, 255, 0.0)', 0.42);
    this.ownedTextures.push(hlTex);
    const hlDiscGeo = new THREE.CircleGeometry(1.45, 24);
    hlDiscGeo.rotateX(-Math.PI / 2);
    const hlDiscMat = new THREE.MeshBasicMaterial({
      map: hlTex,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const hlDisc = new THREE.Mesh(hlDiscGeo, hlDiscMat);
    hlDisc.position.set(0, 0.04, 1.55);
    this.segwayVehiclePivot.add(hlDisc);

    // 3. LeanSteer Steering Column + Handlebar
    this.segwaySteeringPivot.position.set(0, 0.24, 0.14);
    this.segwayVehiclePivot.add(this.segwaySteeringPivot);

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.032, 0.84, 12), alloyMat);
    column.position.set(0, 0.42, 0.02);
    column.rotation.x = 0.06;
    column.castShadow = true;
    this.segwaySteeringPivot.add(column);

    // InfoKey cyan dash display
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.065, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9 })
    );
    dash.position.set(0, 0.84, 0.045);
    dash.rotation.x = -0.35;
    this.segwaySteeringPivot.add(dash);

    // Handlebar crossbar + ergonomic grips
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.56, 12), chassisMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.84, 0.045);
    this.segwaySteeringPivot.add(bar);

    const gripGeo = new THREE.CylinderGeometry(0.023, 0.023, 0.12, 12);
    const gripL = new THREE.Mesh(gripGeo, padMat);
    gripL.rotation.z = Math.PI / 2;
    gripL.position.set(0.24, 0.84, 0.045);
    this.segwaySteeringPivot.add(gripL);

    const gripR = new THREE.Mesh(gripGeo, padMat);
    gripR.rotation.z = Math.PI / 2;
    gripR.position.set(-0.24, 0.84, 0.045);
    this.segwaySteeringPivot.add(gripR);

    // IK targets for MakeHuman hands & feet
    this.gripTargetL.position.set(0.21, 0.84, 0.02);
    this.gripTargetR.position.set(-0.21, 0.84, 0.02);
    this.gripCenterL.position.set(0.25, 0.84, 0.05);
    this.gripCenterR.position.set(-0.25, 0.84, 0.05);
    this.segwaySteeringPivot.add(this.gripTargetL, this.gripTargetR, this.gripCenterL, this.gripCenterR);

    // Side-by-side feet on Segway pads (Left = +X, Right = -X)
    this.footTargetL.position.set(0.145, 0.30, -0.02);
    this.footTargetR.position.set(-0.145, 0.30, -0.02);
    this.segwayVehiclePivot.add(this.footTargetL, this.footTargetR);

    // 4. MakeHuman Group & Procedural Fallback Group
    this.makeHumanGroup.name = 'SegwayMakeHumanOfficer';
    this.makeHumanGroup.visible = false;
    this.segwayVehiclePivot.add(this.makeHumanGroup);

    this.buildFallbackSecurityOfficer();
    this.segwayVehiclePivot.add(this.fallbackOfficerGroup);

    return hlDisc;
  }

  private buildFallbackSecurityOfficer(): void {
    const navyMat = new THREE.MeshStandardMaterial({ color: 0x16294a, roughness: 0.82 });
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0xeaff00,
      emissive: 0x556600,
      emissiveIntensity: 0.45,
      roughness: 0.65,
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xdca586, roughness: 0.72 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });

    // Legs standing on Segway deck
    for (const sx of [-0.145, 0.145]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.76, 10), navyMat);
      leg.position.set(sx, 0.63, -0.02);
      leg.castShadow = true;
      this.fallbackOfficerGroup.add(leg);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.21), darkMat);
      boot.position.set(sx, 0.285, 0.02);
      this.fallbackOfficerGroup.add(boot);
    }

    // Torso & High-Vis Vest
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.20), navyMat);
    torso.position.set(0, 1.24, -0.01);
    torso.castShadow = true;
    this.fallbackOfficerGroup.add(torso);

    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.22), vestMat);
    vest.position.set(0, 1.25, -0.01);
    this.fallbackOfficerGroup.add(vest);

    // Arms reaching forward to Segway handlebars
    for (const sx of [-0.21, 0.21]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.50, 8), navyMat);
      arm.position.set(sx, 1.24, 0.11);
      arm.rotation.x = 0.85;
      this.fallbackOfficerGroup.add(arm);
    }

    // Head & Peaked Security Cap
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), skinMat);
    head.position.set(0, 1.60, 0.01);
    this.fallbackOfficerGroup.add(head);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.085, 16), navyMat);
    cap.position.set(0, 1.67, 0.01);
    this.fallbackOfficerGroup.add(cap);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.10), darkMat);
    visor.position.set(0, 1.64, 0.10);
    visor.rotation.x = 0.22;
    this.fallbackOfficerGroup.add(visor);

    // Flashing shoulder beacons
    this.attachShoulderBeacons(this.fallbackOfficerGroup, 0.20, 1.48, -0.01);
  }

  private attachShoulderBeacons(parent: THREE.Object3D, offsetX: number, y: number, z: number): void {
    const bulbGeo = new THREE.SphereGeometry(0.042, 10, 10);
    const haloGeo = new THREE.SphereGeometry(0.11, 10, 10);

    const redMat = new THREE.MeshBasicMaterial({ color: 0xff1e38 });
    const redHaloMat = new THREE.MeshBasicMaterial({
      color: 0xff1e38,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const redBulb = new THREE.Mesh(bulbGeo, redMat);
    redBulb.position.set(offsetX, y, z);
    const redHalo = new THREE.Mesh(haloGeo, redHaloMat);
    redBulb.add(redHalo);
    parent.add(redBulb);
    this.beaconRedMats.push(redMat, redHaloMat);

    const blueMat = new THREE.MeshBasicMaterial({ color: 0x1d7bff });
    const blueHaloMat = new THREE.MeshBasicMaterial({
      color: 0x1d7bff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const blueBulb = new THREE.Mesh(bulbGeo, blueMat);
    blueBulb.position.set(-offsetX, y, z);
    const blueHalo = new THREE.Mesh(haloGeo, blueHaloMat);
    blueBulb.add(blueHalo);
    parent.add(blueBulb);
    this.beaconBlueMats.push(blueMat, blueHaloMat);
  }

  private createSecurityBadgeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 112, 14);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#facc15';
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.font = '900 32px "Barlow Condensed", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ORDNUNGSAMT', 128, 46);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px "Barlow Condensed", Impact, sans-serif';
    ctx.fillText('PARK PATROL', 128, 86);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private async loadMakeHumanSecurity(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(resolveAssetUrl('models/skater.glb'));
      if (this.disposed) return;

      this.makeHumanRoot = gltf.scene;
      this.bones = {};
      this.restQuat.clear();
      this.restPos.clear();
      this.fingerBones = [];

      // Strip skateboard meshes completely
      const toRemove: THREE.Object3D[] = [];
      this.makeHumanRoot.traverse((child) => {
        if (
          child.name === 'BoardGroup' ||
          child.name === 'DeckMesh' ||
          child.name === 'FrontTruckPivot' ||
          child.name === 'RearTruckPivot' ||
          child.name.startsWith('FrontWheel_') ||
          child.name.startsWith('RearWheel_') ||
          child.name === 'FrontAxle' ||
          child.name === 'RearAxle' ||
          child.name === 'FrontBushing' ||
          child.name === 'FrontSurfAdapterArm'
        ) {
          toRemove.push(child);
        }
      });
      for (const obj of toRemove) {
        obj.removeFromParent();
      }

      // Clone materials & style into sharp dark-navy Security Uniform
      this.makeHumanRoot.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            mesh.frustumCulled = false;
          }

          if (mesh.material) {
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map((m) => m.clone())
              : mesh.material.clone();
          }

          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const rawMat of mats) {
            const mat = rawMat as THREE.MeshStandardMaterial;
            if (!mat) continue;

            if (mat.name === 'Human.male_casualsuit02') {
              // Dark-navy uniform jacket & trousers (emissive subtly lifts night legibility)
              mat.color.setHex(0x284a8a);
              mat.emissive.setHex(0x091630);
              mat.emissiveIntensity = 0.35;
              mat.roughness = 0.78;
              mat.metalness = 0.06;
              mat.needsUpdate = true;
            } else if (mat.name === 'SkaterBeanie' || mat.name === 'SkaterBeanieCuff') {
              // Dark-navy security cap dome
              mat.color.setHex(0x10203d);
              mat.emissive.setHex(0x040b18);
              mat.emissiveIntensity = 0.25;
              mat.roughness = 0.72;
              mat.needsUpdate = true;
            } else if (mat.name === 'SkaterHood') {
              mat.color.setHex(0x0b162c);
              mat.roughness = 0.85;
              mat.needsUpdate = true;
            } else if (
              mat.name === 'Human.shoes06' ||
              mat.name === 'SkaterShoeSole' ||
              mat.name === 'SkaterShoeFoxing'
            ) {
              mat.color.setHex(0x141821);
              mat.roughness = 0.55;
              mat.needsUpdate = true;
            }
          }
        }

        if ((child as THREE.Bone).isBone) {
          const bone = child as THREE.Bone;
          this.bones[bone.name] = bone;
          this.restQuat.set(bone, bone.quaternion.clone());
          this.restPos.set(bone, bone.position.clone());
          if (bone.name === 'middle_01_l') this.middleBoneL = bone;
          if (bone.name === 'middle_01_r') this.middleBoneR = bone;
          if (
            bone.name.startsWith('index_') ||
            bone.name.startsWith('middle_') ||
            bone.name.startsWith('ring_') ||
            bone.name.startsWith('pinky_') ||
            bone.name.startsWith('thumb_')
          ) {
            this.fingerBones.push(bone);
          }
        }
      });

      // Rotate +PI/2 around Y so MakeHuman faces +Z (straight forward on Segway!)
      this.makeHumanRoot.rotation.y = Math.PI / 2;
      this.makeHumanRoot.scale.setScalar(0.95);
      this.makeHumanGroup.add(this.makeHumanRoot);

      const allBones = { ...this.bones };
      for (const [logical, candidates] of Object.entries(BONE_ALIASES)) {
        const found = candidates.map((n) => allBones[n]).find((b) => !!b);
        if (found) this.bones[logical] = found;
      }

      const required = [
        'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
        'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
      ];
      this.hasSkeleton = required.every((n) => !!this.bones[n]);

      if (this.hasSkeleton) {
        // Attach custom Security Cap Visor + Badge + Tactical Shades onto Head bone
        this.attachSecurityHeadGear(this.bones.Head);

        // Attach High-Vis Reflective Vest + Badge + Flashing Red/Blue Shoulder LEDs onto Spine2 bone
        this.attachSecurityChestGear(this.bones.Spine2);

        this.segwayGroup.updateMatrixWorld(true);
        const segwayQ = this.segwayVehiclePivot.getWorldQuaternion(new THREE.Quaternion());
        for (const side of ['Left', 'Right'] as const) {
          const hip = this.worldPos(this.bones[`${side}UpLeg`]);
          const knee = this.worldPos(this.bones[`${side}Leg`]);
          const ankle = this.worldPos(this.bones[`${side}Foot`]);
          this.legLengths[side] = {
            upper: Math.max(0.1, hip.distanceTo(knee)),
            lower: Math.max(0.1, knee.distanceTo(ankle)),
          };
          const footQ = this.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion());
          this.footRestInSegway[side] = segwayQ.clone().invert().multiply(footQ);

          const shoulder = this.worldPos(this.bones[`${side}Arm`]);
          const elbow = this.worldPos(this.bones[`${side}ForeArm`]);
          const wrist = this.worldPos(this.bones[`${side}Hand`]);
          this.armLengths[side] = {
            upper: Math.max(0.1, shoulder.distanceTo(elbow)),
            lower: Math.max(0.1, elbow.distanceTo(wrist)),
          };
        }

        // Swap out fallback block guard cleanly
        this.fallbackOfficerGroup.visible = false;
        this.makeHumanGroup.visible = true;
        this.poseMakeHumanSecurity(0);
      }
    } catch (err) {
      console.warn('[AfterHoursWanted] Could not load MakeHuman security model, using fallback:', err);
      this.hasSkeleton = false;
      this.fallbackOfficerGroup.visible = true;
      this.makeHumanGroup.visible = false;
    }
  }

  private attachSecurityHeadGear(headBone: THREE.Bone): void {
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x050912, roughness: 0.25, metalness: 0.4 });
    const neonBandMat = new THREE.MeshStandardMaterial({
      color: 0xeaff00,
      emissive: 0x778800,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    });
    const badgeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.92, roughness: 0.18 });

    const capGroup = new THREE.Group();
    capGroup.position.set(0, 0.055, 0.005);

    // Peaked cap visor protruding forward (+Z)
    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.118, 0.125, 0.014, 16, 1, false, -Math.PI * 0.36, Math.PI * 0.72),
      visorMat
    );
    visor.position.set(0, 0.018, 0.045);
    visor.rotation.x = 0.16;
    capGroup.add(visor);

    // Reflective neon-yellow cap band
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.008, 8, 24), neonBandMat);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.036, -0.005);
    capGroup.add(band);

    // Silver metallic front police/security badge
    const badge = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), badgeMat);
    badge.scale.set(1.0, 1.25, 0.38);
    badge.position.set(0, 0.068, 0.098);
    capGroup.add(badge);

    // Dark tactical sunglasses
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.028, 0.032), visorMat);
    shades.position.set(0, -0.015, 0.088);
    capGroup.add(shades);

    headBone.add(capGroup);
  }

  private attachSecurityChestGear(spine2Bone: THREE.Bone): void {
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0x6b7700,
      emissiveIntensity: 0.45,
      roughness: 0.62,
      metalness: 0.05,
    });
    const silverReflectMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      emissive: 0x64748b,
      emissiveIntensity: 0.4,
      metalness: 0.65,
      roughness: 0.25,
    });
    const badgeTex = this.createSecurityBadgeTexture();
    this.ownedTextures.push(badgeTex);
    const badgeMat = new THREE.MeshBasicMaterial({ map: badgeTex });

    const vestGroup = new THREE.Group();
    // Centered on upper torso (spine_03 sits at y~1.36m, chest/shoulders span +0.04..+0.26m)
    vestGroup.position.set(0, 0.12, 0.025);

    // High-vis vest torso shell
    const vestShell = new THREE.Mesh(new THREE.BoxGeometry(0.325, 0.275, 0.255), vestMat);
    vestGroup.add(vestShell);

    // Horizontal reflective silver safety stripes (front + back)
    const stripeFront = new THREE.Mesh(new THREE.BoxGeometry(0.332, 0.034, 0.01), silverReflectMat);
    stripeFront.position.set(0, -0.075, 0.129);
    vestGroup.add(stripeFront);

    const stripeBack = new THREE.Mesh(new THREE.BoxGeometry(0.332, 0.034, 0.01), silverReflectMat);
    stripeBack.position.set(0, -0.075, -0.129);
    vestGroup.add(stripeBack);

    // Chest & Back "ORDNUNGSAMT / PARK PATROL" badges
    const patchGeo = new THREE.PlaneGeometry(0.18, 0.09);
    const frontPatch = new THREE.Mesh(patchGeo, badgeMat);
    frontPatch.position.set(0, 0.035, 0.131);
    vestGroup.add(frontPatch);

    const backPatch = new THREE.Mesh(patchGeo, badgeMat);
    backPatch.rotation.y = Math.PI;
    backPatch.position.set(0, 0.035, -0.131);
    vestGroup.add(backPatch);

    // Flashing Red / Blue Shoulder Epaulette LED Beacons
    this.attachShoulderBeacons(vestGroup, 0.195, 0.165, 0.0);

    spine2Bone.add(vestGroup);
  }

  private worldPos(obj: THREE.Object3D): THREE.Vector3 {
    return obj.getWorldPosition(new THREE.Vector3());
  }

  private segwayDir(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).normalize().transformDirection(this.segwayVehiclePivot.matrixWorld);
  }

  private rotateBoneWorld(bone: THREE.Bone, q: THREE.Quaternion): void {
    if (!bone.parent) return;
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const target = q.clone().multiply(boneQ);
    bone.quaternion.copy(parentQ.invert().multiply(target));
    bone.updateMatrixWorld(true);
  }

  private rotateBoneAxis(bone: THREE.Bone, axisWorld: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-5) return;
    this.rotateBoneWorld(bone, new THREE.Quaternion().setFromAxisAngle(axisWorld, angle));
  }

  private aimBone(bone: THREE.Bone, child: THREE.Object3D, dirWorld: THREE.Vector3): void {
    const cur = this.worldPos(child).sub(this.worldPos(bone)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(cur, dirWorld.clone().normalize());
    this.rotateBoneWorld(bone, q);
  }

  private setBoneWorldQuat(bone: THREE.Bone, qWorld: THREE.Quaternion): void {
    if (!bone.parent) return;
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQ.invert().multiply(qWorld));
    bone.updateMatrixWorld(true);
  }

  private solveLeg(side: 'Left' | 'Right', target: THREE.Vector3, poleDir: THREE.Vector3): void {
    const upLeg = this.bones[`${side}UpLeg`];
    const leg = this.bones[`${side}Leg`];
    const foot = this.bones[`${side}Foot`];
    if (!upLeg || !leg || !foot) return;
    const { upper, lower } = this.legLengths[side];

    const hip = this.worldPos(upLeg);
    const toTarget = target.clone().sub(hip);
    const dist = THREE.MathUtils.clamp(toTarget.length(), 0.05, (upper + lower) * 0.999);
    const dir = toTarget.normalize();
    const along = (upper * upper - lower * lower + dist * dist) / (2 * dist);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const pole = poleDir.clone().sub(dir.clone().multiplyScalar(poleDir.dot(dir))).normalize();
    const kneeTarget = hip.clone().addScaledVector(dir, along).addScaledVector(pole, height);

    this.aimBone(upLeg, leg, kneeTarget.clone().sub(hip));
    const knee = this.worldPos(leg);
    this.aimBone(leg, foot, target.clone().sub(knee));
  }

  private solveArm(side: 'Left' | 'Right', target: THREE.Vector3, poleDir: THREE.Vector3): void {
    const arm = this.bones[`${side}Arm`];
    const foreArm = this.bones[`${side}ForeArm`];
    const hand = this.bones[`${side}Hand`];
    if (!arm || !foreArm || !hand) return;
    const { upper, lower } = this.armLengths[side];

    const shoulder = this.worldPos(arm);
    const toTarget = target.clone().sub(shoulder);
    const dist = THREE.MathUtils.clamp(toTarget.length(), 0.05, (upper + lower) * 0.999);
    const dir = toTarget.normalize();
    const along = (upper * upper - lower * lower + dist * dist) / (2 * dist);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const pole = poleDir.clone().sub(dir.clone().multiplyScalar(poleDir.dot(dir))).normalize();
    const elbowTarget = shoulder.clone().addScaledVector(dir, along).addScaledVector(pole, height);

    this.aimBone(arm, foreArm, elbowTarget.clone().sub(shoulder));
    const elbow = this.worldPos(foreArm);
    this.aimBone(foreArm, hand, target.clone().sub(elbow));
  }

  private poseMakeHumanSecurity(leanNorm: number): void {
    if (!this.hasSkeleton || !this.bones.Hips) return;
    const b = this.bones;

    for (const [bone, rq] of this.restQuat) {
      bone.quaternion.copy(rq);
      const rp = this.restPos.get(bone);
      if (rp) bone.position.copy(rp);
    }
    this.segwayGroup.updateMatrixWorld(true);

    const segwayX = this.segwayDir(1, 0, 0);

    // Standing on Segway deck (top y=0.24m), slight athletic knee bend & forward chase lean
    const hipsLocal = new THREE.Vector3(0, 1.07 - 0.03 * leanNorm, -0.04 + 0.05 * leanNorm);

    // Lean upper torso slightly forward while keeping head level watching skater
    this.rotateBoneAxis(b.Hips, segwayX, 0.05 + 0.06 * leanNorm);
    this.rotateBoneAxis(b.Spine, segwayX, 0.08 + 0.10 * leanNorm);
    this.rotateBoneAxis(b.Spine1, segwayX, 0.06 + 0.08 * leanNorm);
    this.rotateBoneAxis(b.Neck, segwayX, -0.10 - 0.10 * leanNorm);
    this.rotateBoneAxis(b.Head, segwayX, -0.06 - 0.06 * leanNorm);

    const hipsWorld = this.segwayVehiclePivot.localToWorld(hipsLocal);
    if (b.Hips.parent) {
      b.Hips.position.copy(b.Hips.parent.worldToLocal(hipsWorld));
      b.Hips.updateMatrixWorld(true);
    }

    // Knees point forward (+Z) slightly outward
    const kneePoleL = this.segwayDir(0.15, 0.1, 1.0);
    const kneePoleR = this.segwayDir(-0.15, 0.1, 1.0);
    this.solveLeg('Left', this.worldPos(this.footTargetL), kneePoleL);
    this.solveLeg('Right', this.worldPos(this.footTargetR), kneePoleR);

    // Keep feet planted flat on Segway rubber footpads
    const baseQ = this.segwayVehiclePivot.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['Left', 'Right'] as const) {
      const foot = b[`${side}Foot`];
      const restQ = this.footRestInSegway[side];
      if (foot && restQ) {
        this.setBoneWorldQuat(foot, baseQ.clone().multiply(restQ));
      }
    }

    // Arms reach forward to Segway handlebar grips
    const armPoleL = this.segwayDir(0.75, -0.45, -0.45);
    const armPoleR = this.segwayDir(-0.75, -0.45, -0.45);
    this.solveArm('Left', this.worldPos(this.gripTargetL), armPoleL);
    this.solveArm('Right', this.worldPos(this.gripTargetR), armPoleR);

    if (b.LeftHand && this.middleBoneL) {
      const toGripL = this.worldPos(this.gripCenterL).sub(this.worldPos(b.LeftHand)).normalize();
      this.aimBone(b.LeftHand, this.middleBoneL, toGripL);
    }
    if (b.RightHand && this.middleBoneR) {
      const toGripR = this.worldPos(this.gripCenterR).sub(this.worldPos(b.RightHand)).normalize();
      this.aimBone(b.RightHand, this.middleBoneR, toGripR);
    }
    for (const finger of this.fingerBones) {
      finger.rotateX(0.38);
    }
  }

  private spawnSegwayNearFlatZone(playerPos: THREE.Vector3): void {
    const spawns = PARK_WANTED_CONFIGS[this.parkId].segwaySpawns;
    let best = spawns[0];
    let bestScore = Infinity;

    for (const candidate of spawns) {
      const d = Math.hypot(candidate[0] - playerPos.x, candidate[1] - playerPos.z);
      // Prefer a flat spawn between 9m and 16m away so chase begins cleanly without ambush
      const penalty = d < 6.0 ? (6.0 - d) * 4.0 : Math.abs(d - 12.0);
      if (penalty < bestScore) {
        bestScore = penalty;
        best = candidate;
      }
    }

    const y = this.parkSurface.evaluateHeight(best[0], best[1]);
    this.segwayPos.set(best[0], y, best[1]);
    this.segwayYaw = Math.atan2(playerPos.x - best[0], playerPos.z - best[1]);
    this.segwaySpeed = 2.0;
    this.segwayFarTimer = 0;
    this.segwaySpawned = true;
  }

  private isFlatEnoughForSegway(x: number, z: number): boolean {
    const b = PARK_WANTED_CONFIGS[this.parkId].bounds;
    if (x < b.xMin || x > b.xMax || z < b.zMin || z > b.zMax) {
      return false;
    }
    const sample = this.parkSurface.sample(x, z);
    const slope = Math.hypot(sample.slopeX, sample.slopeZ);
    // Surfskate Physics Twist: refuse steep bowl transitions & volcano domes!
    return slope <= 0.35 && sample.normal.y >= 0.94;
  }

  private updateSegwaySecurity(dt: number, playerPos: THREE.Vector3): void {
    if (!this.segwaySpawned) {
      this.spawnSegwayNearFlatZone(playerPos);
    }

    const dxToPlayer = playerPos.x - this.segwayPos.x;
    const dzToPlayer = playerPos.z - this.segwayPos.z;
    const distToPlayer = Math.hypot(dxToPlayer, dzToPlayer);

    // If player pumped across a big bowl/wall and left Security far behind (> 24m for > 5.5s),
    // re-route Security to a reachable flat anchor
    if (distToPlayer > 24.0) {
      this.segwayFarTimer += dt;
      if (this.segwayFarTimer > 5.5) {
        this.spawnSegwayNearFlatZone(playerPos);
      }
    } else {
      this.segwayFarTimer = Math.max(0, this.segwayFarTimer - dt);
    }

    const desiredYaw = Math.atan2(dxToPlayer, dzToPlayer);
    let yawDiff = desiredYaw - this.segwayYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

    const maxTurn = 2.9 * dt;
    let candidateYaw = this.segwayYaw + THREE.MathUtils.clamp(yawDiff, -maxTurn, maxTurn);

    const maxSpeed = 3.6 + this.stars * 0.52; // 2★: 4.64 -> 5★: 6.20 m/s
    const lookAhead = 0.90;

    // Check forward & tangential steering offsets so Security slides cleanly around steep bowl walls
    const s = yawDiff >= 0 ? 1 : -1;
    const offsets = [0, 0.55 * s, -0.55 * s, 1.05 * s, -1.05 * s, 1.5 * s, -1.5 * s];
    let foundClearPath = false;
    for (const off of offsets) {
      const testYaw = candidateYaw + off;
      const testX = this.segwayPos.x + Math.sin(testYaw) * lookAhead;
      const testZ = this.segwayPos.z + Math.cos(testYaw) * lookAhead;
      if (this.isFlatEnoughForSegway(testX, testZ)) {
        candidateYaw = testYaw;
        foundClearPath = true;
        break;
      }
    }

    this.segwayYaw = candidateYaw;

    // Slow down gently when very close or blocked by a steep bowl wall
    const targetSpeed = !foundClearPath
      ? 0
      : distToPlayer < 1.35
      ? 0.4
      : maxSpeed;

    this.segwaySpeed = THREE.MathUtils.lerp(this.segwaySpeed, targetSpeed, Math.min(1, dt * 5.0));

    if (this.segwaySpeed > 0.05) {
      const step = this.segwaySpeed * dt;
      const nextX = this.segwayPos.x + Math.sin(this.segwayYaw) * step;
      const nextZ = this.segwayPos.z + Math.cos(this.segwayYaw) * step;
      if (this.isFlatEnoughForSegway(nextX, nextZ)) {
        this.segwayPos.x = nextX;
        this.segwayPos.z = nextZ;
      } else {
        this.segwaySpeed *= 0.25;
      }
    }

    const groundSample: SurfaceSample = this.parkSurface.sample(this.segwayPos.x, this.segwayPos.z);
    this.segwayPos.y = groundSample.height;
    this.segwayGroup.position.copy(this.segwayPos);
    this.segwayGroup.rotation.y = this.segwayYaw;

    // Tilt Segway gently to gentle terrain normal + lean forward during pursuit
    const leanNorm = THREE.MathUtils.clamp(this.segwaySpeed / 6.0, 0, 1);
    this.segwayVehiclePivot.rotation.x = 0.09 * leanNorm;
    this.segwaySteeringPivot.rotation.z = THREE.MathUtils.clamp(-yawDiff * 0.18, -0.18, 0.18);

    // Spin wheels proportionally to linear travel
    this.segwayWheelAngle += (this.segwaySpeed * dt) / 0.23;
    this.segwayWheelL.rotation.x = this.segwayWheelAngle;
    this.segwayWheelR.rotation.x = this.segwayWheelAngle;

    // Conform ground headlight projection height slightly
    const hlWorldX = this.segwayPos.x + Math.sin(this.segwayYaw) * 1.55;
    const hlWorldZ = this.segwayPos.z + Math.cos(this.segwayYaw) * 1.55;
    const hlY = this.parkSurface.evaluateHeight(hlWorldX, hlWorldZ);
    this.segwayHeadlightDisc.position.y = hlY - this.segwayPos.y + 0.04;

    // Flash alternating red/blue shoulder beacons rapidly
    const flash = Math.sin(this.elapsedSec * 16.0) > 0;
    for (let i = 0; i < this.beaconRedMats.length; i++) {
      const m = this.beaconRedMats[i];
      if (m.transparent) m.opacity = flash ? 0.55 : 0.08;
      else m.color.setHex(flash ? 0xff1e38 : 0x450a14);
    }
    for (let i = 0; i < this.beaconBlueMats.length; i++) {
      const m = this.beaconBlueMats[i];
      if (m.transparent) m.opacity = !flash ? 0.55 : 0.08;
      else m.color.setHex(!flash ? 0x1d7bff : 0x091d42);
    }

    // Pose MakeHuman skeleton when loaded
    if (this.hasSkeleton) {
      this.poseMakeHumanSecurity(leanNorm);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Police Drone + Additive Searchlight Cone (3★-5★)
  // ---------------------------------------------------------------------------

  private buildPoliceDrone(): [THREE.Mesh, THREE.MeshBasicMaterial] {
    this.droneGroup.name = 'PoliceDroneGroup';
    this.droneGroup.add(this.droneChassis);

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.72, roughness: 0.35 });
    const rotorMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const rotorBlurMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Central quadcopter body
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.58), frameMat);
    this.droneChassis.add(core);

    // 4 diagonal X-arms + rotors
    const armAngles = [Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.25, -Math.PI * 0.75];
    const rotorGeo = new THREE.BoxGeometry(0.44, 0.012, 0.045);
    const blurGeo = new THREE.RingGeometry(0.06, 0.23, 20);
    blurGeo.rotateX(-Math.PI / 2);

    for (const ang of armAngles) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.72), frameMat);
      arm.rotation.y = ang;
      this.droneChassis.add(arm);

      const rx = Math.sin(ang) * 0.44;
      const rz = Math.cos(ang) * 0.44;
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 10), frameMat);
      pod.position.set(rx, 0.04, rz);
      this.droneChassis.add(pod);

      const blade = new THREE.Mesh(rotorGeo, rotorMat);
      blade.position.set(rx, 0.095, rz);
      this.droneChassis.add(blade);
      this.droneRotors.push(blade);

      const blur = new THREE.Mesh(blurGeo, rotorBlurMat);
      blur.position.set(rx, 0.092, rz);
      this.droneChassis.add(blur);
    }

    // Blinking Red & Blue underbelly police strobes
    this.droneRedMat = new THREE.MeshBasicMaterial({ color: 0xff1e38 });
    this.droneBlueMat = new THREE.MeshBasicMaterial({ color: 0x1d7bff });
    const strobeR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), this.droneRedMat);
    strobeR.position.set(0.16, -0.09, 0.08);
    const strobeB = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), this.droneBlueMat);
    strobeB.position.set(-0.16, -0.09, 0.08);
    this.droneChassis.add(strobeR, strobeB);

    // Searchlight gimbal pod & additive volumetric beam cone
    const gimbal = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xe0f7ff })
    );
    gimbal.position.set(0, -0.12, 0.14);
    this.droneChassis.add(gimbal);

    const coneTex = this.createVerticalFadeTexture('rgba(190, 238, 255, 0.44)', 'rgba(140, 210, 255, 0.0)');
    this.ownedTextures.push(coneTex);
    const coneLen = 6.2;
    const coneGeo = new THREE.CylinderGeometry(0.14, 3.05, coneLen, 28, 1, true);
    coneGeo.translate(0, -coneLen * 0.5, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      map: coneTex,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(0, -0.12, 0.14);
    this.droneChassis.add(cone);

    // Ground searchlight disc (radius = 3.2m)
    const discTex = this.createSoftRadialTexture('rgba(205, 245, 255, 0.94)', 'rgba(130, 210, 255, 0.0)', 0.45);
    this.ownedTextures.push(discTex);
    const discGeo = new THREE.CircleGeometry(3.2, 36);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      map: discTex,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    this.droneGroup.add(disc);

    return [disc, discMat];
  }

  private updatePoliceDrone(dt: number, playerPos: THREE.Vector3): void {
    if (!this.droneSpawned) {
      this.dronePos.set(playerPos.x + 12.0, playerPos.y + 6.0, playerPos.z - 12.0);
      this.droneVel.set(0, 0, 0);
      this.droneSpawned = true;
    }

    // Track slightly ahead of / toward player with smooth inertia
    const targetX = playerPos.x + Math.sin(this.elapsedSec * 0.85) * 1.4;
    const targetZ = playerPos.z + Math.cos(this.elapsedSec * 0.72) * 1.4;
    const dx = targetX - this.dronePos.x;
    const dz = targetZ - this.dronePos.z;
    const dist = Math.hypot(dx, dz);

    const maxSpeed = 4.2 + (this.stars - 3) * 1.05; // 3★: 4.2, 4★: 5.25, 5★: 6.3 m/s
    const desiredVx = dist > 0.25 ? (dx / dist) * Math.min(maxSpeed, dist * 1.8) : 0;
    const desiredVz = dist > 0.25 ? (dz / dist) * Math.min(maxSpeed, dist * 1.8) : 0;

    this.droneVel.x = THREE.MathUtils.lerp(this.droneVel.x, desiredVx, Math.min(1, dt * 2.4));
    this.droneVel.z = THREE.MathUtils.lerp(this.droneVel.z, desiredVz, Math.min(1, dt * 2.4));

    this.dronePos.x += this.droneVel.x * dt;
    this.dronePos.z += this.droneVel.z * dt;

    const groundSample = this.parkSurface.sample(this.dronePos.x, this.dronePos.z);
    const hoverY = groundSample.height + 5.6 + Math.sin(this.elapsedSec * 3.1) * 0.22;
    this.dronePos.y = THREE.MathUtils.lerp(this.dronePos.y, hoverY, Math.min(1, dt * 4.0));

    this.droneChassis.position.copy(this.dronePos);
    // Bank chassis smoothly into flight velocity
    this.droneChassis.rotation.z = THREE.MathUtils.clamp(-this.droneVel.x * 0.045, -0.25, 0.25);
    this.droneChassis.rotation.x = THREE.MathUtils.clamp(this.droneVel.z * 0.045, -0.25, 0.25);

    for (let i = 0; i < this.droneRotors.length; i++) {
      this.droneRotors[i].rotation.y += dt * (i % 2 === 0 ? 42 : -42);
    }

    const strobe = Math.sin(this.elapsedSec * 18.0) > 0;
    this.droneRedMat.color.setHex(strobe ? 0xff1e38 : 0x3b0710);
    this.droneBlueMat.color.setHex(!strobe ? 0x1d7bff : 0x071a3e);

    // Ground spotlight disc conforms to LiDAR surface directly beneath drone
    this.droneSpotPos.set(this.dronePos.x, groundSample.height + 0.06, this.dronePos.z);
    this.droneGroundDisc.position.copy(this.droneSpotPos);
    this.tmpQuatA.setFromUnitVectors(UP_AXIS, groundSample.normal);
    this.droneGroundDisc.quaternion.copy(this.tmpQuatA);
    this.droneGroundMat.opacity = 0.72 + 0.1 * Math.sin(this.elapsedSec * 6.0);

    // Check Outlaw spotlight overlap
    const dXZ = Math.hypot(playerPos.x - this.dronePos.x, playerPos.z - this.dronePos.z);
    const dY = Math.abs(playerPos.y - groundSample.height);
    if (dXZ <= 3.2 && dY <= 3.2) {
      this.inOutlawSpotlight = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. MUC Heli-Spotlight (4★-5★)
  // ---------------------------------------------------------------------------

  private buildHeliSpotlight(): [THREE.Mesh, THREE.Mesh, THREE.MeshBasicMaterial] {
    this.heliGroup.name = 'MucHeliSpotlightGroup';

    const beamTex = this.createVerticalFadeTexture('rgba(160, 225, 255, 0.02)', 'rgba(210, 244, 255, 0.36)', 0.92);
    const discTex = this.createSoftRadialTexture('rgba(225, 248, 255, 0.92)', 'rgba(155, 220, 255, 0.0)', 0.48);
    this.ownedTextures.push(beamTex, discTex);

    const beamLen = 22.0;
    const beamGeo = new THREE.CylinderGeometry(0.65, 5.1, beamLen, 32, 1, true);
    beamGeo.translate(0, beamLen * 0.5, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      map: beamTex,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.rotation.z = 0.14; // subtle angled helicopter search beam from night sky
    beamMesh.rotation.x = -0.10;
    this.heliGroup.add(beamMesh);

    const discGeo = new THREE.CircleGeometry(5.2, 40);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      map: discTex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    this.heliGroup.add(discMesh);

    return [beamMesh, discMesh, discMat];
  }

  private updateHeliSpotlight(dt: number, playerPos: THREE.Vector3): void {
    const speedFactor = this.stars >= 5 ? 1.15 : 0.85;
    this.heliPhase += dt * speedFactor;

    // Sweeping figure-eight hunt pattern around the skater's neighborhood
    const sweepRadius = this.stars >= 5 ? 5.2 : 6.8;
    const hx = playerPos.x + Math.sin(this.heliPhase * 1.1) * sweepRadius;
    const hz = playerPos.z + Math.sin(this.heliPhase * 2.2) * (sweepRadius * 0.65);

    const sample = this.parkSurface.sample(hx, hz);
    this.heliSpotPos.set(hx, sample.height + 0.07, hz);

    this.heliBeamMesh.position.copy(this.heliSpotPos);
    this.heliGroundDisc.position.copy(this.heliSpotPos);
    this.tmpQuatA.setFromUnitVectors(UP_AXIS, sample.normal);
    this.heliGroundDisc.quaternion.copy(this.tmpQuatA);
    this.heliGroundMat.opacity = 0.66 + 0.14 * Math.sin(this.elapsedSec * 7.5);

    const dXZ = Math.hypot(playerPos.x - hx, playerPos.z - hz);
    const dY = Math.abs(playerPos.y - sample.height);
    if (dXZ <= 5.2 && dY <= 3.8) {
      this.inOutlawSpotlight = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Bavarian Pay'n'Spray Escape Zone (1★-5★)
  // ---------------------------------------------------------------------------

  private buildPayNSprayZone(): {
    outerRing: THREE.Mesh;
    innerRing: THREE.Mesh;
    cylinder: THREE.Mesh;
    sprite: THREE.Sprite;
    outerMat: THREE.MeshBasicMaterial;
    innerMat: THREE.MeshBasicMaterial;
    cylMat: THREE.MeshBasicMaterial;
  } {
    this.sprayZoneGroup.name = 'BavarianPayNSprayGroup';

    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xff2a85, // Neon Pink
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outerRing = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.45, 40, 1), outerMat);
    this.sprayZoneGroup.add(outerRing);

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4, // Electric Cyan
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerRing = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.62, 40, 1), innerMat);
    this.sprayZoneGroup.add(innerRing);

    const cylMat = new THREE.MeshBasicMaterial({
      color: 0xff2a85,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(2.28, 2.28, 2.6, 36, 1, true), cylMat);
    this.sprayZoneGroup.add(cylinder);

    // Floating 3D Chrome + Neon-Pink Spray Can prop
    const canBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.44, 18),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.22 })
    );
    const canLabel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.165, 0.165, 0.24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xff2a85,
        emissive: 0xaa1155,
        emissiveIntensity: 0.6,
        roughness: 0.35,
      })
    );
    const canShoulder = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.11, 18),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.28 })
    );
    canShoulder.position.y = 0.275;
    const canNozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.045, 0.06, 12),
      new THREE.MeshBasicMaterial({ color: 0x00f5d4 })
    );
    canNozzle.position.y = 0.35;

    this.sprayCanPivot.add(canBody, canLabel, canShoulder, canNozzle);
    this.sprayZoneGroup.add(this.sprayCanPivot);

    // Floating "🎨 PAY'N'SPRAY" CanvasTexture Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.transform(1, 0, -0.15, 1, 20, 0);
    const grad = ctx.createLinearGradient(0, 16, 0, 144);
    grad.addColorStop(0, 'rgba(20, 12, 34, 0.92)');
    grad.addColorStop(1, 'rgba(42, 12, 46, 0.92)');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(24, 18, 444, 124, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'italic 900 44px "Barlow Condensed", Impact, sans-serif';
    ctx.fillStyle = '#ff2a85';
    ctx.textAlign = 'center';
    ctx.fillText("🎨 PAY'N'SPRAY", 246, 74);

    ctx.font = '800 25px "Barlow Condensed", Impact, sans-serif';
    ctx.fillStyle = '#00f5d4';
    ctx.fillText('CLEAR HEAT  •  +1500 PTS', 246, 114);
    ctx.restore();

    const spriteTex = new THREE.CanvasTexture(canvas);
    spriteTex.colorSpace = THREE.SRGBColorSpace;
    spriteTex.minFilter = THREE.LinearFilter;
    this.ownedTextures.push(spriteTex);

    const spriteMat = new THREE.SpriteMaterial({
      map: spriteTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(4.8, 1.5, 1);
    this.sprayZoneGroup.add(sprite);

    return { outerRing, innerRing, cylinder, sprite, outerMat, innerMat, cylMat };
  }

  private conformPayNSprayGeometry(cx: number, cz: number): void {
    const projectRing = (mesh: THREE.Mesh, rMin: number, rMax: number, yOffset: number) => {
      const geo = new THREE.RingGeometry(rMin, rMax, 40, 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const wx = cx + pos.getX(i);
        const wz = cz + pos.getZ(i);
        const wy = this.parkSurface.evaluateHeight(wx, wz) + yOffset;
        pos.setXYZ(i, wx, wy, wz);
      }
      pos.needsUpdate = true;
      mesh.geometry.dispose();
      mesh.geometry = geo;
    };

    projectRing(this.sprayOuterRing, 2.05, 2.45, 0.06);
    projectRing(this.sprayInnerRing, 1.35, 1.62, 0.07);

    const cylGeo = new THREE.CylinderGeometry(2.3, 2.3, 2.5, 36, 1, true);
    const cPos = cylGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
      const wx = cx + cPos.getX(i);
      const ly = cPos.getY(i);
      const wz = cz + cPos.getZ(i);
      const groundY = this.parkSurface.evaluateHeight(wx, wz);
      cPos.setXYZ(i, wx, groundY + (ly > 0 ? 2.45 : 0.05), wz);
    }
    cPos.needsUpdate = true;
    this.sprayCylinder.geometry.dispose();
    this.sprayCylinder.geometry = cylGeo;

    this.sprayCanPivot.position.set(cx, this.sprayPos.y + 1.15, cz);
    this.spraySprite.position.set(cx, this.sprayPos.y + 2.7, cz);
  }

  private updatePayNSprayVisuals(dt: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 5.2);
    this.sprayOuterMat.opacity = 0.62 + 0.34 * pulse;
    this.sprayInnerMat.opacity = 0.52 + 0.38 * (1 - pulse);
    this.sprayCylMat.opacity = 0.14 + 0.1 * pulse;
    this.sprayCylMat.color.setHex(pulse > 0.5 ? 0xff2a85 : 0x00f5d4);

    this.sprayCanPivot.rotation.y += dt * 2.4;
    this.sprayCanPivot.rotation.z = Math.sin(this.elapsedSec * 2.8) * 0.16;
    this.sprayCanPivot.position.y = this.sprayPos.y + 1.12 + Math.sin(this.elapsedSec * 3.4) * 0.14;
    this.spraySprite.position.y = this.sprayPos.y + 2.65 + Math.sin(this.elapsedSec * 2.6) * 0.18;
  }

  // ---------------------------------------------------------------------------
  // 7. InstancedMesh Graffiti Mist & Impact Sparks
  // ---------------------------------------------------------------------------

  private buildParticlePool(): THREE.InstancedMesh {
    const geo = new THREE.IcosahedronGeometry(0.11, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, AfterHoursWanted.MAX_PARTICLES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    this.dummyObj.scale.set(0, 0, 0);
    this.dummyObj.position.set(0, -9999, 0);
    this.dummyObj.updateMatrix();

    for (let i = 0; i < AfterHoursWanted.MAX_PARTICLES; i++) {
      mesh.setMatrixAt(i, this.dummyObj.matrix);
      mesh.setColorAt(i, this.graffitiPalette[i % this.graffitiPalette.length]);
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1.0,
        baseScale: 1.0,
        gravity: 3.5,
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private emitGraffitiBurst(center: THREE.Vector3): void {
    const targetCount = 64;
    let emitted = 0;
    for (let i = 0; i < AfterHoursWanted.MAX_PARTICLES && emitted < targetCount; i++) {
      const p = this.particles[i];
      if (p.active) continue;

      p.active = true;
      p.pos.set(
        center.x + (Math.random() - 0.5) * 1.4,
        center.y + 0.35 + Math.random() * 0.8,
        center.z + (Math.random() - 0.5) * 1.4
      );
      const ang = Math.random() * Math.PI * 2;
      const spd = 2.0 + Math.random() * 4.5;
      p.vel.set(Math.cos(ang) * spd, 2.2 + Math.random() * 3.8, Math.sin(ang) * spd);
      p.life = 0;
      p.maxLife = 0.8 + Math.random() * 0.6;
      p.baseScale = 1.2 + Math.random() * 1.6;
      p.gravity = 1.8;

      this.particleMesh.setColorAt(i, this.graffitiPalette[emitted % this.graffitiPalette.length]);
      emitted++;
    }
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private emitSparkBurst(center: THREE.Vector3): void {
    const targetCount = 18;
    let emitted = 0;
    for (let i = 0; i < AfterHoursWanted.MAX_PARTICLES && emitted < targetCount; i++) {
      const p = this.particles[i];
      if (p.active) continue;

      p.active = true;
      p.pos.copy(center);
      const ang = Math.random() * Math.PI * 2;
      const spd = 2.2 + Math.random() * 3.4;
      p.vel.set(Math.cos(ang) * spd, 1.5 + Math.random() * 2.8, Math.sin(ang) * spd);
      p.life = 0;
      p.maxLife = 0.4 + Math.random() * 0.25;
      p.baseScale = 0.45 + Math.random() * 0.35;
      p.gravity = 9.8;

      this.particleMesh.setColorAt(i, this.sparkColor);
      emitted++;
    }
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateParticles(dt: number): void {
    let anyChanged = false;

    for (let i = 0; i < AfterHoursWanted.MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.dummyObj.scale.set(0, 0, 0);
        this.dummyObj.position.set(0, -9999, 0);
        this.dummyObj.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);
        anyChanged = true;
        continue;
      }

      anyChanged = true;
      p.vel.y -= p.gravity * dt;
      p.vel.x *= Math.max(0, 1 - dt * 1.4);
      p.vel.z *= Math.max(0, 1 - dt * 1.4);
      p.pos.addScaledVector(p.vel, dt);

      const u = p.life / p.maxLife;
      // Mist puffs expand softly then fade away
      const scaleCurve = p.gravity < 3.0 ? (0.7 + u * 0.9) * (1 - u) : 1 - u;
      const s = Math.max(0, p.baseScale * scaleCurve);
      this.dummyObj.position.copy(p.pos);
      this.dummyObj.scale.set(s, s, s);
      this.dummyObj.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);
    }

    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private resetParticles(): void {
    this.dummyObj.scale.set(0, 0, 0);
    this.dummyObj.position.set(0, -9999, 0);
    this.dummyObj.updateMatrix();
    for (let i = 0; i < AfterHoursWanted.MAX_PARTICLES; i++) {
      this.particles[i].active = false;
      this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Utility Helpers
  // ---------------------------------------------------------------------------

  private isNearAnyPursuer(playerPos: THREE.Vector3, radius: number): boolean {
    if (this.stars >= 1) {
      if (Math.hypot(playerPos.x - this.flashlightPos.x, playerPos.z - this.flashlightPos.z) <= radius) {
        return true;
      }
    }
    if (this.stars >= 2 && this.segwaySpawned) {
      if (Math.hypot(playerPos.x - this.segwayPos.x, playerPos.z - this.segwayPos.z) <= radius) {
        return true;
      }
    }
    if (this.stars >= 3 && this.droneSpawned) {
      if (Math.hypot(playerPos.x - this.dronePos.x, playerPos.z - this.dronePos.z) <= radius) {
        return true;
      }
    }
    return false;
  }

  private createSoftRadialTexture(
    innerColor: string,
    outerColor: string,
    midStop: number
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0.0, innerColor);
    grad.addColorStop(midStop, innerColor);
    grad.addColorStop(1.0, outerColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createVerticalFadeTexture(
    topColor: string,
    bottomColor: string,
    midStop = 0.82
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.0, topColor);
    grad.addColorStop(midStop, bottomColor);
    grad.addColorStop(1.0, bottomColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
