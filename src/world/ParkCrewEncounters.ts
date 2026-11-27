import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ParkSurface } from '../physics/ParkSurface';
import { resolveAssetUrl } from '../utils/assetUrl';

export type CrewParkId = 'im_gefilde' | 'airport_skatepark';
export type CrewNpcId = 'sepp' | 'michi';
export type CrewQuestState = 'idle' | 'active' | 'completed';

export interface CrewUpdateState {
  canInteract: boolean;
  npcId: CrewNpcId;
  questState: CrewQuestState;
  collected: number;
  total: number;
  newlyCollected: boolean;
  justCompleted: boolean;
  bonusPoints: number;
}

export interface CrewInteractResult {
  action: 'started' | 'reminder' | 'completed_chat';
  npcId: CrewNpcId;
  collected: number;
  total: number;
}

interface CollectibleSpot {
  x: number;
  z: number;
  label: string;
}

interface ParkCrewConfig {
  parkId: CrewParkId;
  npcId: CrewNpcId;
  npcPos: { x: number; z: number };
  npcLookTarget: { x: number; z: number };
  wastiPos?: { x: number; z: number };
  spots: readonly CollectibleSpot[];
}

interface CollectibleRuntime {
  index: number;
  spot: CollectibleSpot;
  basePos: THREE.Vector3;
  container: THREE.Group;
  visualPivot: THREE.Group;
  glowRing: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  collected: boolean;
  popping: boolean;
  popTimer: number;
  revealTimer: number;
}

interface BurstParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

interface MakeHumanRig {
  npcId: CrewNpcId;
  group: THREE.Group;
  modelRoot: THREE.Object3D | null;
  bones: Record<string, THREE.Bone>;
  restQuat: Map<THREE.Bone, THREE.Quaternion>;
  restPos: Map<THREE.Bone, THREE.Vector3>;
  fingerBones: THREE.Bone[];
  legLengths: Record<'Left' | 'Right', { upper: number; lower: number }>;
  armLengths: Record<'Left' | 'Right', { upper: number; lower: number }>;
  footRestInNpc: Record<'Left' | 'Right', THREE.Quaternion>;
  hipsRestHeight: number;
  ankleHeight: number;
  hasSkeleton: boolean;
  scale: number;
  currentYaw: number;
  baseYaw: number;
  headLookYaw: number;
  headLookPitch: number;
}

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

/**
 * Verified flat LiDAR coordinates and reachable skateable collectible spots for both parks:
 * - 'im_gefilde': Opa Sepp & Dackel Wasti at (12.2, -5.2), Wasti at (12.92, -4.85)
 * - 'airport_skatepark': Planespotter Michi at (11.2, 4.5)
 */
const PARK_CREW_CONFIGS: Record<CrewParkId, ParkCrewConfig> = {
  im_gefilde: {
    parkId: 'im_gefilde',
    npcId: 'sepp',
    npcPos: { x: 12.2, z: -5.2 },
    npcLookTarget: { x: 14.0, z: 2.0 },
    wastiPos: { x: 12.92, z: -4.85 },
    spots: [
      { x: -3.5, z: 4.5, label: 'West Flow Basin' },
      { x: -6.2, z: -9.8, label: 'NW Cradle Pocket' },
      { x: 1.5, z: 11.0, label: 'South Clover Bowl' },
      { x: 11.6, z: 14.2, label: 'SE Deep Bowl' },
    ],
  },
  airport_skatepark: {
    parkId: 'airport_skatepark',
    npcId: 'michi',
    npcPos: { x: 11.2, z: 4.5 },
    npcLookTarget: { x: 0.0, z: -3.0 },
    spots: [
      { x: 0.2, z: 1.8, label: 'Center Plaza Spine' },
      { x: -9.5, z: 2.5, label: 'West Bowl Pocket' },
      { x: 2.2, z: -7.2, label: 'Deep Bowl North' },
      { x: 10.0, z: -5.5, label: 'East Corner Bowl' },
    ],
  },
};

const AXIS_Y = new THREE.Vector3(0, 1, 0);

/**
 * Self-contained 3D & gameplay module for MUC Park Crew Encounters (Issue #37).
 *
 * Places one interactive MakeHuman-rigged local NPC per park on flat LiDAR-sampled concrete:
 * - Im Wiesengrund ('im_gefilde'): Opa Sepp & Dackel Wasti — "Wasti's 4 Golden Treats"
 * - Airport Skatepark ('airport_skatepark'): Planespotter Michi — "4 Lost SD Cards"
 */
export class ParkCrewEncounters {
  public readonly rootGroup = new THREE.Group();

  private static readonly INTERACT_RADIUS = 4.6;
  private static readonly COLLECT_RADIUS = 1.65;
  private static readonly COLLECT_HEIGHT_OFFSET = 0.65;
  private static readonly COMPLETION_BONUS_POINTS = 2500;
  private static readonly TOTAL_COLLECTIBLES = 4;
  private static readonly POP_OUT_DURATION = 0.38;
  private static readonly POP_IN_DURATION = 0.42;
  private static readonly MAX_BURST_PARTICLES = 72;
  private static readonly CROWD_HYPE_RADIUS = 9.5;
  private static readonly CROWD_HYPE_MIN_POINTS = 350;
  private static readonly CROWD_HYPE_BONUS = 500;
  private static readonly CROWD_HYPE_COOLDOWN_SEC = 12.0;
  private static readonly CHEER_DURATION_SEC = 2.2;
  private static readonly HYPE_POPUP_DURATION_SEC = 1.65;

  private parkId: CrewParkId;
  private currentNpcId: CrewNpcId;
  private parkSurface: ParkSurface;
  private questState: CrewQuestState = 'idle';
  private collectedCount = 0;
  private elapsedSec = 0;
  private isDisposed = false;
  private playerInRange = false;

  // Crowd Hype state & cooldowns (per NPC)
  private crowdHypeCooldownByNpc: Record<CrewNpcId, number> = {
    sepp: 0,
    michi: 0,
  };
  private cheerTimer = 0;
  private cheerNpcId: CrewNpcId | null = null;
  private hypePopupTimer = 0;
  private hypePopupOrigin = new THREE.Vector3();

  // NPC Groups & Rigs
  private seppRig: MakeHumanRig;
  private michiRig: MakeHumanRig;
  private seppRoot = new THREE.Group();
  private michiRoot = new THREE.Group();
  private seppCaneGroup: THREE.Group | null = null;
  private seppCaneRestPos = new THREE.Vector3(0.255, 0, 0.155);

  // Wasti (Sculpted 3D Dachshund)
  private wastiRoot = new THREE.Group();
  private wastiHeadPivot = new THREE.Group();
  private wastiTailPivot = new THREE.Group();
  private wastiEarL = new THREE.Group();
  private wastiEarR = new THREE.Group();
  private wastiHopTimer = 0;
  private wastiBaseY = 0;

  // Michi Camera Rig & IK Grip Targets
  private camRigPivot = new THREE.Group();
  private camGripL = new THREE.Object3D();
  private camGripR = new THREE.Object3D();
  private camRaiseBlend = 1.0;
  private camFlashSprite: THREE.Sprite | null = null;
  private camFlashMat: THREE.SpriteMaterial | null = null;

  // Floating 3D Overhead Marker Sprite & Hype Popup Sprite
  private markerSprite: THREE.Sprite;
  private markerCanvas: HTMLCanvasElement;
  private markerCtx: CanvasRenderingContext2D;
  private markerTex: THREE.CanvasTexture;
  private markerMat: THREE.SpriteMaterial;
  private lastMarkerKey = '';
  private hypeSprite: THREE.Sprite;
  private hypeMat: THREE.SpriteMaterial;

  // Collectibles per park
  private collectiblesByPark: Record<CrewParkId, CollectibleRuntime[]> = {
    im_gefilde: [],
    airport_skatepark: [],
  };
  private seppCollectiblesGroup = new THREE.Group();
  private michiCollectiblesGroup = new THREE.Group();

  // Lightweight Additive Particle Pool (1 InstancedMesh, zero PointLights)
  private burstMesh: THREE.InstancedMesh;
  private burstMat: THREE.MeshBasicMaterial;
  private burstParticles: BurstParticle[] = [];
  private dummyObj = new THREE.Object3D();

  // Resource tracking for clean dispose()
  private trackedGeometries: THREE.BufferGeometry[] = [];
  private trackedMaterials: THREE.Material[] = [];
  private trackedTextures: THREE.Texture[] = [];
  private gltfRoots: THREE.Object3D[] = [];

  // Reusable math temporaries
  private tempVecA = new THREE.Vector3();
  private tempVecB = new THREE.Vector3();
  private tempQuatA = new THREE.Quaternion();
  private tempQuatB = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    parkSurface: ParkSurface,
    parkId: CrewParkId = 'im_gefilde'
  ) {
    this.parkSurface = parkSurface;
    this.parkId = parkId;
    this.currentNpcId = PARK_CREW_CONFIGS[parkId].npcId;

    this.rootGroup.name = 'ParkCrewEncounters';
    this.scene.add(this.rootGroup);

    // 1. Setup NPC container groups
    this.seppRoot.name = 'CrewNPC_OpaSepp';
    this.michiRoot.name = 'CrewNPC_PlanespotterMichi';
    this.wastiRoot.name = 'CrewNPC_DackelWasti';
    this.rootGroup.add(this.seppRoot);
    this.rootGroup.add(this.michiRoot);
    this.rootGroup.add(this.wastiRoot);

    this.seppRig = this.createEmptyRig('sepp', this.seppRoot, 0.97);
    this.michiRig = this.createEmptyRig('michi', this.michiRoot, 1.0);

    // Contact shadow decals under NPCs and Wasti
    this.seppRoot.add(this.buildShadowDecal(0.85, 0.85, 0.44));
    this.michiRoot.add(this.buildShadowDecal(0.85, 0.85, 0.44));
    this.wastiRoot.add(this.buildShadowDecal(0.45, 0.68, 0.36));

    // Build sculpted 3D Dachshund Wasti & Michi's telephoto camera rig
    this.buildDachshundWasti();
    this.buildMichiCameraRig();

    // Load real MakeHuman rigged characters (models/skater.glb)
    void this.loadMakeHumanNpc(this.seppRig);
    void this.loadMakeHumanNpc(this.michiRig);

    // 2. Floating 3D Overhead Marker Sprite & Crowd Hype Popup Sprite
    const marker = this.buildOverheadMarker();
    this.markerSprite = marker.sprite;
    this.markerCanvas = marker.canvas;
    this.markerCtx = marker.ctx;
    this.markerTex = marker.tex;
    this.markerMat = marker.mat;
    this.rootGroup.add(this.markerSprite);

    const hypePopup = this.buildHypePopupSprite();
    this.hypeSprite = hypePopup.sprite;
    this.hypeMat = hypePopup.mat;
    this.rootGroup.add(this.hypeSprite);

    // 3. Collectibles for both parks
    this.seppCollectiblesGroup.name = 'CrewCollectibles_Sepp';
    this.michiCollectiblesGroup.name = 'CrewCollectibles_Michi';
    this.rootGroup.add(this.seppCollectiblesGroup);
    this.rootGroup.add(this.michiCollectiblesGroup);
    this.buildCollectiblesForPark('im_gefilde');
    this.buildCollectiblesForPark('airport_skatepark');

    // 4. Shared Additive Particle Pool
    const particleGeo = this.trackGeo(new THREE.IcosahedronGeometry(0.052, 1));
    this.burstMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      })
    );
    this.burstMesh = new THREE.InstancedMesh(
      particleGeo,
      this.burstMat,
      ParkCrewEncounters.MAX_BURST_PARTICLES
    );
    this.burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.burstMesh.frustumCulled = false;
    this.rootGroup.add(this.burstMesh);
    for (let i = 0; i < ParkCrewEncounters.MAX_BURST_PARTICLES; i++) {
      this.burstParticles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        baseScale: 1,
      });
    }
    this.resetParticles();

    // 5. Apply active park visibility, positions & surface heights
    this.applyParkState(this.parkId, this.parkSurface);
  }

  public setPark(parkId: CrewParkId, parkSurface: ParkSurface): void {
    this.parkId = parkId;
    this.currentNpcId = PARK_CREW_CONFIGS[parkId].npcId;
    this.parkSurface = parkSurface;
    this.crowdHypeCooldownByNpc.sepp = 0;
    this.crowdHypeCooldownByNpc.michi = 0;
    this.applyParkState(parkId, parkSurface);
  }

  public refreshSurfaceHeights(parkSurface: ParkSurface): void {
    this.parkSurface = parkSurface;

    const seppCfg = PARK_CREW_CONFIGS.im_gefilde;
    const seppSample = parkSurface.sample(seppCfg.npcPos.x, seppCfg.npcPos.z);
    this.seppRoot.position.set(seppCfg.npcPos.x, seppSample.height, seppCfg.npcPos.z);

    if (seppCfg.wastiPos) {
      const wastiSample = parkSurface.sample(seppCfg.wastiPos.x, seppCfg.wastiPos.z);
      this.wastiBaseY = wastiSample.height;
      this.wastiRoot.position.set(seppCfg.wastiPos.x, this.wastiBaseY, seppCfg.wastiPos.z);
    }

    const michiCfg = PARK_CREW_CONFIGS.airport_skatepark;
    const michiSample = parkSurface.sample(michiCfg.npcPos.x, michiCfg.npcPos.z);
    this.michiRoot.position.set(michiCfg.npcPos.x, michiSample.height, michiCfg.npcPos.z);

    for (const pId of ['im_gefilde', 'airport_skatepark'] as const) {
      for (const item of this.collectiblesByPark[pId]) {
        const s = parkSurface.sample(item.spot.x, item.spot.z);
        item.basePos.set(
          item.spot.x,
          s.height + ParkCrewEncounters.COLLECT_HEIGHT_OFFSET,
          item.spot.z
        );
        item.container.position.copy(item.basePos);
      }
    }

    this.updateMarkerPosition();
  }

  public resetSession(): void {
    this.questState = 'idle';
    this.collectedCount = 0;
    this.playerInRange = false;
    this.wastiHopTimer = 0;
    this.crowdHypeCooldownByNpc.sepp = 0;
    this.crowdHypeCooldownByNpc.michi = 0;
    this.cheerTimer = 0;
    this.cheerNpcId = null;
    this.hypePopupTimer = 0;
    this.hypeSprite.visible = false;
    if (this.camFlashSprite) {
      this.camFlashSprite.visible = false;
    }
    if (this.seppCaneGroup) {
      this.seppCaneGroup.position.copy(this.seppCaneRestPos);
      this.seppCaneGroup.rotation.set(0, 0, 0);
    }

    for (const pId of ['im_gefilde', 'airport_skatepark'] as const) {
      for (const item of this.collectiblesByPark[pId]) {
        item.collected = false;
        item.popping = false;
        item.popTimer = 0;
        item.revealTimer = 0;
        item.container.visible = false;
        item.container.position.copy(item.basePos);
        item.container.scale.setScalar(1);
        item.visualPivot.visible = true;
        item.visualPivot.position.set(0, 0, 0);
        item.visualPivot.scale.setScalar(1);
        item.glowRing.visible = true;
        item.glowRing.scale.setScalar(1);
        item.ringMat.opacity = 0.68;
      }
    }

    this.resetParticles();
    this.updateMarkerVisual(true);
  }

  public update(dt: number, playerPos: THREE.Vector3, playerSpeed: number): CrewUpdateState {
    const safeDt = Math.min(Math.max(dt, 0), 0.1);
    this.elapsedSec += safeDt;

    // Tick per-NPC Crowd Hype cooldowns & active cheer/popup timers
    if (this.crowdHypeCooldownByNpc.sepp > 0) {
      this.crowdHypeCooldownByNpc.sepp = Math.max(0, this.crowdHypeCooldownByNpc.sepp - safeDt);
    }
    if (this.crowdHypeCooldownByNpc.michi > 0) {
      this.crowdHypeCooldownByNpc.michi = Math.max(0, this.crowdHypeCooldownByNpc.michi - safeDt);
    }
    if (this.cheerTimer > 0) {
      this.cheerTimer = Math.max(0, this.cheerTimer - safeDt);
      if (this.cheerTimer <= 0) {
        this.cheerNpcId = null;
      }
    }
    if (this.hypePopupTimer > 0) {
      this.hypePopupTimer = Math.max(0, this.hypePopupTimer - safeDt);
      const u = 1.0 - this.hypePopupTimer / ParkCrewEncounters.HYPE_POPUP_DURATION_SEC;
      const rise = (1.0 - Math.pow(1.0 - u, 2.0)) * 0.95;
      this.hypeSprite.position.set(
        this.hypePopupOrigin.x,
        this.hypePopupOrigin.y + rise,
        this.hypePopupOrigin.z
      );
      const popScale =
        u < 0.18
          ? THREE.MathUtils.lerp(0.35, 1.18, u / 0.18)
          : THREE.MathUtils.lerp(1.18, 1.0, Math.min(1, (u - 0.18) / 0.25));
      this.hypeSprite.scale.set(1.25 * popScale, 0.625 * popScale, 1);
      this.hypeMat.opacity = u > 0.68 ? Math.max(0, 1.0 - (u - 0.68) / 0.32) : 1.0;
      if (this.hypePopupTimer <= 0) {
        this.hypeSprite.visible = false;
      }
    }

    const cfg = PARK_CREW_CONFIGS[this.parkId];
    const activeRig = this.parkId === 'im_gefilde' ? this.seppRig : this.michiRig;
    const npcPos = activeRig.group.position;

    // 1. Player proximity to active NPC
    const distNpcXZ = Math.hypot(playerPos.x - npcPos.x, playerPos.z - npcPos.z);
    const dyNpc = Math.abs(playerPos.y - npcPos.y);
    this.playerInRange =
      distNpcXZ <= ParkCrewEncounters.INTERACT_RADIUS && dyNpc <= 3.2;

    const canInteract = this.playerInRange;

    // 2. Animate active NPC (MakeHuman skeleton + accessories)
    if (this.parkId === 'im_gefilde') {
      this.updateSeppAndWasti(safeDt, playerPos, playerSpeed, distNpcXZ);
    } else {
      this.updateMichi(safeDt, playerPos, playerSpeed, distNpcXZ);
    }

    // 3. Update Floating 3D Overhead Marker
    this.updateMarkerVisual(false);
    this.updateMarkerPosition();
    const markerPulse =
      this.questState === 'idle'
        ? 1.0 + 0.085 * Math.sin(this.elapsedSec * 4.5)
        : canInteract
          ? 1.06
          : 1.0;
    const rangeBoost = canInteract ? 1.12 : 1.0;
    this.markerSprite.scale.setScalar(0.76 * markerPulse * rangeBoost);

    // 4. Update Collectibles & Check Pickup
    let newlyCollected = false;
    let justCompleted = false;
    let bonusPoints = 0;

    const items = this.collectiblesByPark[this.parkId];
    for (const item of items) {
      if (item.collected && !item.popping) continue;

      if (item.popping) {
        item.popTimer += safeDt;
        const p = item.popTimer / ParkCrewEncounters.POP_OUT_DURATION;
        if (p >= 1.0) {
          item.popping = false;
          item.container.visible = false;
        } else {
          item.visualPivot.position.y = p * 1.35;
          item.visualPivot.rotation.y += safeDt * 15.0;
          const s = Math.max(0.001, (1.0 + Math.sin(p * Math.PI) * 0.35) * (1.0 - p));
          item.visualPivot.scale.setScalar(s);
          const ringS = 1.0 + p * 2.5;
          item.glowRing.scale.setScalar(ringS);
          item.ringMat.opacity = Math.max(0, 0.68 * (1.0 - p));
        }
        continue;
      }

      if (this.questState !== 'active') continue;

      // Pop-in reveal animation
      if (item.revealTimer < ParkCrewEncounters.POP_IN_DURATION) {
        item.revealTimer += safeDt;
        if (item.revealTimer <= 0) {
          item.container.scale.setScalar(0.001);
        } else {
          const u = Math.min(1, item.revealTimer / ParkCrewEncounters.POP_IN_DURATION);
          // Springy easeOutBack
          const c1 = 1.70158;
          const c3 = c1 + 1;
          const ease = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
          item.container.scale.setScalar(Math.max(0.001, ease));
        }
      } else {
        item.container.scale.setScalar(1);
      }

      // Idle hover bob & spin
      item.container.position.y =
        item.basePos.y + Math.sin(this.elapsedSec * 2.9 + item.index * 1.45) * 0.08;
      item.visualPivot.rotation.y += safeDt * 2.0;
      item.glowRing.rotation.z += safeDt * 1.25;
      item.glowRing.scale.setScalar(
        1.0 + Math.sin(this.elapsedSec * 3.6 + item.index) * 0.08
      );

      // Pickup collision check (within 1.65m XZ and reasonable Y delta)
      const dx = playerPos.x - item.container.position.x;
      const dz = playerPos.z - item.container.position.z;
      const distXZ = Math.hypot(dx, dz);
      const dy = item.container.position.y - playerPos.y;

      if (
        distXZ <= ParkCrewEncounters.COLLECT_RADIUS &&
        dy >= -1.4 &&
        dy <= 1.9
      ) {
        item.collected = true;
        item.popping = true;
        item.popTimer = 0;
        this.collectedCount++;
        newlyCollected = true;

        this.burstMat.color.setHex(this.parkId === 'im_gefilde' ? 0xfbbf24 : 0x22d3ee);
        this.emitCollectBurst(item.container.position, 28);

        if (this.collectedCount >= ParkCrewEncounters.TOTAL_COLLECTIBLES) {
          this.questState = 'completed';
          justCompleted = true;
          bonusPoints = ParkCrewEncounters.COMPLETION_BONUS_POINTS;
          this.wastiHopTimer = 1.1;
          // Extra celebratory burst above NPC
          this.tempVecA.copy(npcPos).add(this.tempVecB.set(0, 2.0, 0));
          this.emitCollectBurst(this.tempVecA, 32);
        }

        this.updateMarkerVisual(true);
      }
    }

    // 5. Update additive particle pool
    this.updateParticles(safeDt);

    return {
      canInteract,
      npcId: cfg.npcId,
      questState: this.questState,
      collected: this.collectedCount,
      total: ParkCrewEncounters.TOTAL_COLLECTIBLES,
      newlyCollected,
      justCompleted,
      bonusPoints,
    };
  }

  public interact(): CrewInteractResult | null {
    if (!this.playerInRange) {
      return null;
    }

    const cfg = PARK_CREW_CONFIGS[this.parkId];

    if (this.questState === 'idle') {
      this.questState = 'active';
      this.collectedCount = 0;

      const items = this.collectiblesByPark[this.parkId];
      items.forEach((item, idx) => {
        item.collected = false;
        item.popping = false;
        item.popTimer = 0;
        item.revealTimer = -idx * 0.08;
        item.container.visible = true;
        item.container.position.copy(item.basePos);
        item.container.scale.setScalar(0.001);
        item.visualPivot.visible = true;
        item.visualPivot.position.set(0, 0, 0);
        item.visualPivot.scale.setScalar(1);
        item.glowRing.visible = true;
        item.glowRing.scale.setScalar(1);
        item.ringMat.opacity = 0.68;
      });

      this.wastiHopTimer = 0.85;
      this.updateMarkerVisual(true);

      return {
        action: 'started',
        npcId: cfg.npcId,
        collected: this.collectedCount,
        total: ParkCrewEncounters.TOTAL_COLLECTIBLES,
      };
    }

    if (this.questState === 'active') {
      return {
        action: 'reminder',
        npcId: cfg.npcId,
        collected: this.collectedCount,
        total: ParkCrewEncounters.TOTAL_COLLECTIBLES,
      };
    }

    this.wastiHopTimer = 0.75;
    return {
      action: 'completed_chat',
      npcId: cfg.npcId,
      collected: this.collectedCount,
      total: ParkCrewEncounters.TOTAL_COLLECTIBLES,
    };
  }

  /**
   * Checks whether a landed trick near the active park NPC triggers Crowd Hype.
   * Requires trickPoints >= 350 and player within 9.5m XZ, with a 12.0s per-NPC cooldown.
   */
  public checkCrowdHype(
    playerPos: THREE.Vector3,
    trickPoints: number
  ): { npcId: CrewNpcId; bonus: number } | null {
    if (this.isDisposed || trickPoints < ParkCrewEncounters.CROWD_HYPE_MIN_POINTS) {
      return null;
    }

    const npcId = this.currentNpcId;
    if (this.crowdHypeCooldownByNpc[npcId] > 0) {
      return null;
    }

    const activeRig = npcId === 'sepp' ? this.seppRig : this.michiRig;
    const npcPos = activeRig.group.position;
    const distXZ = Math.hypot(playerPos.x - npcPos.x, playerPos.z - npcPos.z);
    if (distXZ > ParkCrewEncounters.CROWD_HYPE_RADIUS) {
      return null;
    }

    // Activate cooldown, 2.2s NPC cheer reaction, floating 🔥 +500 popup & golden burst
    this.crowdHypeCooldownByNpc[npcId] = ParkCrewEncounters.CROWD_HYPE_COOLDOWN_SEC;
    this.cheerTimer = ParkCrewEncounters.CHEER_DURATION_SEC;
    this.cheerNpcId = npcId;

    this.hypePopupTimer = ParkCrewEncounters.HYPE_POPUP_DURATION_SEC;
    this.hypePopupOrigin.set(npcPos.x, npcPos.y + 2.48, npcPos.z);
    this.hypeSprite.position.copy(this.hypePopupOrigin);
    this.hypeSprite.scale.set(0.45, 0.225, 1);
    this.hypeSprite.visible = true;
    this.hypeMat.opacity = 1.0;

    this.burstMat.color.setHex(0xfbbf24);
    this.tempVecA.set(npcPos.x, npcPos.y + 1.95, npcPos.z);
    this.emitCollectBurst(this.tempVecA, 34);

    return {
      npcId,
      bonus: ParkCrewEncounters.CROWD_HYPE_BONUS,
    };
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.scene.remove(this.rootGroup);

    for (const root of this.gltfRoots) {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (!mat) continue;
            const std = mat as THREE.MeshStandardMaterial;
            std.map?.dispose();
            std.normalMap?.dispose();
            std.roughnessMap?.dispose();
            std.dispose();
          }
        }
      });
    }
    this.gltfRoots = [];

    for (const g of this.trackedGeometries) g.dispose();
    for (const m of this.trackedMaterials) m.dispose();
    for (const t of this.trackedTextures) t.dispose();

    this.trackedGeometries = [];
    this.trackedMaterials = [];
    this.trackedTextures = [];
    this.burstParticles = [];
    this.rootGroup.clear();
  }

  // ---------------------------------------------------------------------------
  // Park Switching & Setup
  // ---------------------------------------------------------------------------
  private applyParkState(parkId: CrewParkId, parkSurface: ParkSurface): void {
    this.currentNpcId = PARK_CREW_CONFIGS[parkId].npcId;
    const isSepp = parkId === 'im_gefilde';
    this.seppRoot.visible = isSepp;
    this.wastiRoot.visible = isSepp;
    this.seppCollectiblesGroup.visible = isSepp;

    this.michiRoot.visible = !isSepp;
    this.michiCollectiblesGroup.visible = !isSepp;

    // Set initial idle facing angles
    const seppCfg = PARK_CREW_CONFIGS.im_gefilde;
    this.seppRig.baseYaw = Math.atan2(
      seppCfg.npcLookTarget.x - seppCfg.npcPos.x,
      seppCfg.npcLookTarget.z - seppCfg.npcPos.z
    );
    this.seppRig.currentYaw = this.seppRig.baseYaw;
    this.seppRoot.rotation.y = this.seppRig.currentYaw;

    if (seppCfg.wastiPos) {
      this.wastiRoot.rotation.y = this.seppRig.baseYaw - 0.25;
    }

    const michiCfg = PARK_CREW_CONFIGS.airport_skatepark;
    this.michiRig.baseYaw = Math.atan2(
      michiCfg.npcLookTarget.x - michiCfg.npcPos.x,
      michiCfg.npcLookTarget.z - michiCfg.npcPos.z
    );
    this.michiRig.currentYaw = this.michiRig.baseYaw;
    this.michiRoot.rotation.y = this.michiRig.currentYaw;

    // Update particle burst accent color for the park theme
    this.burstMat.color.setHex(isSepp ? 0xfbbf24 : 0x22d3ee);

    this.refreshSurfaceHeights(parkSurface);
    this.resetSession();
  }

  // ---------------------------------------------------------------------------
  // MakeHuman GLB Rig Loading & Customization
  // ---------------------------------------------------------------------------
  private createEmptyRig(
    npcId: CrewNpcId,
    group: THREE.Group,
    scale: number
  ): MakeHumanRig {
    return {
      npcId,
      group,
      modelRoot: null,
      bones: {},
      restQuat: new Map(),
      restPos: new Map(),
      fingerBones: [],
      legLengths: {
        Left: { upper: 0.45, lower: 0.44 },
        Right: { upper: 0.45, lower: 0.44 },
      },
      armLengths: {
        Left: { upper: 0.27, lower: 0.26 },
        Right: { upper: 0.27, lower: 0.26 },
      },
      footRestInNpc: {
        Left: new THREE.Quaternion(),
        Right: new THREE.Quaternion(),
      },
      hipsRestHeight: 0.96 * scale,
      ankleHeight: 0.076 * scale,
      hasSkeleton: false,
      scale,
      currentYaw: 0,
      baseYaw: 0,
      headLookYaw: 0,
      headLookPitch: 0,
    };
  }

  private async loadMakeHumanNpc(rig: MakeHumanRig): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(resolveAssetUrl('models/skater.glb'));

      if (this.isDisposed) {
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            m.geometry?.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mat) => mat?.dispose());
          }
        });
        return;
      }

      const modelRoot = gltf.scene;
      rig.modelRoot = modelRoot;
      this.gltfRoots.push(modelRoot);

      // Strip skateboard meshes completely
      const toRemove: THREE.Object3D[] = [];
      modelRoot.traverse((child) => {
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

      // Customize materials & collect skeleton bones
      modelRoot.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            mesh.frustumCulled = false;
          }

          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map((m) => m.clone());
            } else {
              mesh.material = mesh.material.clone();
            }
          }

          this.customizeNpcMesh(rig.npcId, mesh);
        }

        if ((child as THREE.Bone).isBone) {
          const bone = child as THREE.Bone;
          rig.bones[bone.name] = bone;
          rig.restQuat.set(bone, bone.quaternion.clone());
          rig.restPos.set(bone, bone.position.clone());
          if (
            bone.name.startsWith('index_') ||
            bone.name.startsWith('middle_') ||
            bone.name.startsWith('ring_') ||
            bone.name.startsWith('pinky_') ||
            bone.name.startsWith('thumb_')
          ) {
            rig.fingerBones.push(bone);
          }
        }
      });

      // Bind-pose character faces -X and soles sit at y = 0.162.
      // Rotate +PI/2 around Y so character faces +Z in rig.group space, and drop soles to y = 0.
      modelRoot.rotation.y = Math.PI / 2;
      modelRoot.scale.setScalar(rig.scale);
      modelRoot.position.set(0, -0.162 * rig.scale, 0);
      rig.group.add(modelRoot);

      // Map logical bone names
      const allBones = { ...rig.bones };
      for (const [logical, candidates] of Object.entries(BONE_ALIASES)) {
        const found = candidates.map((n) => allBones[n]).find((b) => !!b);
        if (found) rig.bones[logical] = found;
      }

      const required = [
        'Hips',
        'Spine',
        'Spine1',
        'Spine2',
        'Neck',
        'Head',
        'LeftUpLeg',
        'LeftLeg',
        'LeftFoot',
        'RightUpLeg',
        'RightLeg',
        'RightFoot',
        'LeftArm',
        'LeftForeArm',
        'LeftHand',
        'RightArm',
        'RightForeArm',
        'RightHand',
      ];
      rig.hasSkeleton = required.every((n) => !!rig.bones[n]);

      if (rig.hasSkeleton) {
        rig.group.updateMatrixWorld(true);
        const npcQ = rig.group.getWorldQuaternion(new THREE.Quaternion());
        const groupY = rig.group.getWorldPosition(new THREE.Vector3()).y;

        rig.hipsRestHeight = this.worldPos(rig.bones.Hips).y - groupY;
        rig.ankleHeight = Math.max(0.05, this.worldPos(rig.bones.LeftFoot).y - groupY);

        for (const side of ['Left', 'Right'] as const) {
          const hip = this.worldPos(rig.bones[`${side}UpLeg`]);
          const knee = this.worldPos(rig.bones[`${side}Leg`]);
          const ankle = this.worldPos(rig.bones[`${side}Foot`]);
          rig.legLengths[side] = {
            upper: Math.max(0.1, hip.distanceTo(knee)),
            lower: Math.max(0.1, knee.distanceTo(ankle)),
          };
          const footQ = rig.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion());
          rig.footRestInNpc[side] = npcQ.clone().invert().multiply(footQ);

          const shoulder = this.worldPos(rig.bones[`${side}Arm`]);
          const elbow = this.worldPos(rig.bones[`${side}ForeArm`]);
          const wrist = this.worldPos(rig.bones[`${side}Hand`]);
          rig.armLengths[side] = {
            upper: Math.max(0.1, shoulder.distanceTo(elbow)),
            lower: Math.max(0.1, elbow.distanceTo(wrist)),
          };
        }

        // Attach sculpted 3D accessories directly to Head / Spine2 / Hand bones
        if (rig.npcId === 'sepp') {
          this.attachSeppAccessories(rig);
          this.poseSepp(rig, 0.016, 0, false);
        } else {
          this.attachMichiAccessories(rig);
          this.poseMichi(rig, 0.016, 0);
        }
      }
    } catch (err) {
      console.warn(`[ParkCrewEncounters] Could not load MakeHuman NPC (${rig.npcId}):`, err);
    }
  }

  private customizeNpcMesh(npcId: CrewNpcId, mesh: THREE.Mesh): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    // Hide skater beanie on Opa Sepp (replaced with silver hair + Bavarian flat cap)
    if (
      npcId === 'sepp' &&
      (mesh.name === 'SkaterBeanie' || mesh.name === 'SkaterBeanieCuff')
    ) {
      mesh.visible = false;
      return;
    }

    for (const rawMat of mats) {
      const mat = rawMat as THREE.MeshStandardMaterial;
      if (!mat) continue;

      if (mat.name === 'Human.male_casualsuit02') {
        this.applyOutfitSplitShader(mat, npcId);
        mat.roughness = 0.84;
        mat.metalness = 0.03;
        mat.needsUpdate = true;
      } else if (mat.name === 'SkaterHood') {
        if (npcId === 'sepp') {
          mat.color.setHex(0x364428); // Warm loden collar
        } else {
          mat.color.setHex(0x0f172a); // Aviation navy collar
        }
        mat.roughness = 0.88;
        mat.needsUpdate = true;
      } else if (mat.name === 'SkaterBeanie') {
        // Michi's aviation spotter cap
        mat.color.setHex(0x0f172a);
        mat.roughness = 0.78;
        mat.needsUpdate = true;
      } else if (mat.name === 'SkaterBeanieCuff') {
        mat.color.setHex(0x0ea5e9); // MUC cyan accent stripe
        mat.roughness = 0.72;
        mat.needsUpdate = true;
      } else if (mat.name === 'Human.shoes06') {
        mat.color.setHex(npcId === 'sepp' ? 0x5c361e : 0x334155);
        mat.roughness = npcId === 'sepp' ? 0.72 : 0.65;
        mat.needsUpdate = true;
      } else if (mat.name === 'SkaterShoeSole') {
        mat.color.setHex(npcId === 'sepp' ? 0x261d17 : 0xe2e8f0);
        mat.needsUpdate = true;
      } else if (mat.name === 'Human.eyebrow001' && npcId === 'sepp') {
        mat.color.setHex(0xd8dee9); // Silver-grey eyebrows for Opa Sepp
        mat.needsUpdate = true;
      } else if (mat.name === 'Human.body' && npcId === 'sepp') {
        mat.color.setHex(0xf8e5d8);
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * Splits `Human.male_casualsuit02` cleanly by bind-pose vertex height (`y = 1.12` waist):
   * - Opa Sepp: Bavarian olive-loden jacket + dark brown Trachten trousers
   * - Planespotter Michi: High-vis safety yellow-lime jacket with reflective stripes + dark navy jeans
   */
  private applyOutfitSplitShader(
    mat: THREE.MeshStandardMaterial,
    npcId: CrewNpcId
  ): void {
    const jacketCol = new THREE.Color(npcId === 'sepp' ? 0x5a6e38 : 0xeaf522);
    const pantsCol = new THREE.Color(npcId === 'sepp' ? 0x3b281c : 0x1e3454);
    const stripeMode = npcId === 'michi' ? 1.0 : 0.0;

    mat.customProgramCacheKey = () => `ParkCrewOutfit_${npcId}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uJacketColor = { value: jacketCol };
      shader.uniforms.uPantsColor = { value: pantsCol };
      shader.uniforms.uStripeMode = { value: stripeMode };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying float vOutfitRestY;\n`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\nvOutfitRestY = position.y;\n`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vOutfitRestY;
uniform vec3 uJacketColor;
uniform vec3 uPantsColor;
uniform float uStripeMode;
`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
float fabricLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
float fabricShade = clamp(0.65 + fabricLuma * 1.25, 0.52, 1.18);
float isJacket = smoothstep(1.10, 1.14, vOutfitRestY);
vec3 outfitCol = mix(uPantsColor, uJacketColor, isJacket);
if (uStripeMode > 0.5) {
  float bandLower = smoothstep(0.026, 0.0, abs(vOutfitRestY - 1.24)) * step(1.15, vOutfitRestY);
  float bandUpper = smoothstep(0.024, 0.0, abs(vOutfitRestY - 1.43)) * step(1.15, vOutfitRestY);
  float navyShoulder = smoothstep(1.56, 1.63, vOutfitRestY);
  outfitCol = mix(outfitCol, vec3(0.06, 0.11, 0.24), navyShoulder);
  outfitCol = mix(outfitCol, vec3(0.92, 0.96, 1.0), clamp(bandLower + bandUpper, 0.0, 1.0) * 0.90);
} else {
  float lapelTrim = smoothstep(1.55, 1.62, vOutfitRestY);
  outfitCol = mix(outfitCol, vec3(0.18, 0.22, 0.11), lapelTrim * 0.65);
}
diffuseColor.rgb = outfitCol * fabricShade;
`
        );
    };
  }

  private attachSeppAccessories(rig: MakeHumanRig): void {
    const head = rig.bones.Head;
    if (!head) return;

    const hairMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd8dee9,
        roughness: 0.78,
        metalness: 0.02,
      })
    );
    const tweedMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b4432, // Bavarian dark herringbone loden flat cap
        roughness: 0.92,
        metalness: 0.04,
      })
    );
    const brimMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x2a3123,
        roughness: 0.9,
        metalness: 0.05,
      })
    );

    // Silver hair around back and temples
    const hairBackGeo = this.trackGeo(new THREE.SphereGeometry(0.104, 16, 12));
    const hairBack = new THREE.Mesh(hairBackGeo, hairMat);
    hairBack.position.set(0, 0.046, -0.018);
    hairBack.scale.set(0.98, 0.88, 0.92);
    hairBack.castShadow = true;
    head.add(hairBack);

    // Bavarian Flat Cap (Schiebermütze)
    const capGroup = new THREE.Group();
    capGroup.position.set(0, 0.095, 0.008);
    capGroup.rotation.x = 0.08; // slightly pitched forward over brow
    head.add(capGroup);

    const crownGeo = this.trackGeo(new THREE.SphereGeometry(0.112, 18, 12));
    const crown = new THREE.Mesh(crownGeo, tweedMat);
    crown.scale.set(0.98, 0.52, 1.18);
    crown.position.set(0, 0.018, 0.014);
    crown.castShadow = true;
    capGroup.add(crown);

    const visorGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.102, 0.108, 0.012, 16, 1, false, -Math.PI * 0.42, Math.PI * 0.84)
    );
    const visor = new THREE.Mesh(visorGeo, brimMat);
    visor.position.set(0, -0.015, 0.072);
    visor.rotation.x = 0.18;
    visor.scale.set(0.95, 1.0, 1.15);
    visor.castShadow = true;
    capGroup.add(visor);

    const buttonGeo = this.trackGeo(new THREE.SphereGeometry(0.011, 8, 8));
    const button = new THREE.Mesh(buttonGeo, brimMat);
    button.position.set(0, 0.075, 0.008);
    capGroup.add(button);

    // Silver-grey Bavarian handlebar moustache
    const stacheGeo = this.trackGeo(new THREE.CapsuleGeometry(0.010, 0.025, 6, 10));
    const stacheL = new THREE.Mesh(stacheGeo, hairMat);
    stacheL.position.set(0.020, -0.016, 0.104);
    stacheL.rotation.set(0.12, 0.25, Math.PI * 0.42);
    head.add(stacheL);

    const stacheR = new THREE.Mesh(stacheGeo, hairMat);
    stacheR.position.set(-0.020, -0.016, 0.104);
    stacheR.rotation.set(0.12, -0.25, -Math.PI * 0.42);
    head.add(stacheR);

    // Wooden Bavarian walking stick (Spazierstock) held by Sepp's left hand
    const woodMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x6b3e22,
        roughness: 0.62,
        metalness: 0.06,
      })
    );
    const brassMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd4a342,
        roughness: 0.3,
        metalness: 0.78,
      })
    );
    const caneGroup = new THREE.Group();
    caneGroup.position.copy(this.seppCaneRestPos);
    rig.group.add(caneGroup);
    this.seppCaneGroup = caneGroup;

    const shaftGeo = this.trackGeo(new THREE.CylinderGeometry(0.012, 0.010, 0.85, 10));
    const shaft = new THREE.Mesh(shaftGeo, woodMat);
    shaft.position.y = 0.425;
    shaft.castShadow = true;
    caneGroup.add(shaft);

    const tipGeo = this.trackGeo(new THREE.CylinderGeometry(0.011, 0.009, 0.04, 10));
    const tip = new THREE.Mesh(tipGeo, brassMat);
    tip.position.y = 0.02;
    caneGroup.add(tip);

    const crookGeo = this.trackGeo(new THREE.TorusGeometry(0.038, 0.013, 8, 14, Math.PI));
    const crook = new THREE.Mesh(crookGeo, woodMat);
    crook.position.set(0, 0.85, -0.038);
    crook.rotation.y = Math.PI / 2;
    crook.castShadow = true;
    caneGroup.add(crook);
  }

  private attachMichiAccessories(rig: MakeHumanRig): void {
    const head = rig.bones.Head;
    if (head) {
      const frameMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xcbd5e1,
          metalness: 0.85,
          roughness: 0.22,
        })
      );
      const lensMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x090d16,
          metalness: 0.72,
          roughness: 0.12,
        })
      );

      // Aviator sunglasses
      const glassesGroup = new THREE.Group();
      glassesGroup.position.set(0, 0.026, 0.104);
      head.add(glassesGroup);

      const lensGeo = this.trackGeo(new THREE.CylinderGeometry(0.022, 0.020, 0.006, 12));
      lensGeo.rotateX(Math.PI / 2);

      const lensL = new THREE.Mesh(lensGeo, lensMat);
      lensL.position.set(0.029, 0, 0);
      lensL.scale.set(1.12, 0.92, 1);
      glassesGroup.add(lensL);

      const lensR = new THREE.Mesh(lensGeo, lensMat);
      lensR.position.set(-0.029, 0, 0);
      lensR.scale.set(1.12, 0.92, 1);
      glassesGroup.add(lensR);

      const bridgeGeo = this.trackGeo(new THREE.BoxGeometry(0.022, 0.005, 0.005));
      const bridge = new THREE.Mesh(bridgeGeo, frameMat);
      bridge.position.set(0, 0.008, 0);
      glassesGroup.add(bridge);

      const armGeo = this.trackGeo(new THREE.BoxGeometry(0.005, 0.005, 0.09));
      const armL = new THREE.Mesh(armGeo, frameMat);
      armL.position.set(0.056, 0.006, -0.045);
      glassesGroup.add(armL);

      const armR = new THREE.Mesh(armGeo, frameMat);
      armR.position.set(-0.056, 0.006, -0.045);
      glassesGroup.add(armR);
    }

    // Neck camera strap on Spine2
    const spine2 = rig.bones.Spine2;
    if (spine2) {
      const strapMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0x0ea5e9,
          roughness: 0.75,
          metalness: 0.08,
        })
      );
      const strapGeo = this.trackGeo(new THREE.TorusGeometry(0.115, 0.011, 8, 22));
      const strap = new THREE.Mesh(strapGeo, strapMat);
      strap.position.set(0, 0.14, 0.02);
      strap.rotation.x = Math.PI * 0.44;
      spine2.add(strap);
    }
  }

  // ---------------------------------------------------------------------------
  // Sculpted 3D Dachshund "Wasti" & Michi's Telephoto DSLR Camera
  // ---------------------------------------------------------------------------
  private buildDachshundWasti(): void {
    const coatMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x6b3216, // Rich mahogany-chocolate dachshund coat
        roughness: 0.72,
        metalness: 0.04,
      })
    );
    const tanMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd18642, // Warm tan dachshund markings (muzzle, chest, paws, brows)
        roughness: 0.76,
        metalness: 0.02,
      })
    );
    const noseMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.25,
        metalness: 0.12,
      })
    );
    const eyeWhiteMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    const collarMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xdc2626, // Bright Bavarian red collar
        roughness: 0.55,
        metalness: 0.1,
      })
    );
    const goldMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0x92400e,
        emissiveIntensity: 0.25,
        metalness: 0.85,
        roughness: 0.22,
      })
    );

    const bodyPivot = new THREE.Group();
    bodyPivot.position.y = 0.20;
    this.wastiRoot.add(bodyPivot);

    // Long sausage torso
    const torsoGeo = this.trackGeo(new THREE.CapsuleGeometry(0.095, 0.25, 10, 16));
    torsoGeo.rotateX(Math.PI / 2);
    const torso = new THREE.Mesh(torsoGeo, coatMat);
    torso.castShadow = true;
    bodyPivot.add(torso);

    // Warm tan chest patch
    const chestGeo = this.trackGeo(new THREE.SphereGeometry(0.082, 12, 10));
    const chest = new THREE.Mesh(chestGeo, tanMat);
    chest.position.set(0, -0.01, 0.14);
    chest.scale.set(0.88, 0.92, 0.85);
    bodyPivot.add(chest);

    // 4 short stubby dachshund legs + tan paws
    const legGeo = this.trackGeo(new THREE.CapsuleGeometry(0.028, 0.075, 6, 10));
    const pawGeo = this.trackGeo(new THREE.SphereGeometry(0.032, 10, 8));
    const legCoords: [number, number][] = [
      [0.056, 0.115],
      [-0.056, 0.115],
      [0.056, -0.115],
      [-0.056, -0.115],
    ];
    for (const [lx, lz] of legCoords) {
      const leg = new THREE.Mesh(legGeo, coatMat);
      leg.position.set(lx, -0.105, lz);
      leg.castShadow = true;
      bodyPivot.add(leg);

      const paw = new THREE.Mesh(pawGeo, tanMat);
      paw.position.set(lx, -0.172, lz + 0.012);
      paw.scale.set(0.95, 0.65, 1.25);
      paw.castShadow = true;
      bodyPivot.add(paw);
    }

    // Neck & red leather collar + gold tag
    const neckGeo = this.trackGeo(new THREE.CylinderGeometry(0.058, 0.076, 0.11, 12));
    const neck = new THREE.Mesh(neckGeo, coatMat);
    neck.position.set(0, 0.075, 0.155);
    neck.rotation.x = 0.35;
    neck.castShadow = true;
    bodyPivot.add(neck);

    const collarGeo = this.trackGeo(new THREE.TorusGeometry(0.068, 0.013, 8, 18));
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.set(0, 0.072, 0.16);
    collar.rotation.x = Math.PI * 0.42;
    bodyPivot.add(collar);

    const tagGeo = this.trackGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.006, 12));
    const tag = new THREE.Mesh(tagGeo, goldMat);
    tag.position.set(0, 0.045, 0.228);
    tag.rotation.x = Math.PI / 2;
    bodyPivot.add(tag);

    // Head Pivot (looks toward skater)
    this.wastiHeadPivot = new THREE.Group();
    this.wastiHeadPivot.position.set(0, 0.135, 0.185);
    bodyPivot.add(this.wastiHeadPivot);

    const skullGeo = this.trackGeo(new THREE.SphereGeometry(0.082, 14, 12));
    const skull = new THREE.Mesh(skullGeo, coatMat);
    skull.scale.set(0.92, 0.94, 1.08);
    skull.castShadow = true;
    this.wastiHeadPivot.add(skull);

    // Tapered tan dachshund muzzle + glossy nose
    const snoutGeo = this.trackGeo(new THREE.CapsuleGeometry(0.036, 0.065, 8, 12));
    snoutGeo.rotateX(Math.PI / 2);
    const snout = new THREE.Mesh(snoutGeo, tanMat);
    snout.position.set(0, -0.016, 0.088);
    snout.castShadow = true;
    this.wastiHeadPivot.add(snout);

    const noseGeo = this.trackGeo(new THREE.SphereGeometry(0.020, 10, 8));
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, -0.008, 0.138);
    nose.scale.set(1.1, 0.85, 0.9);
    this.wastiHeadPivot.add(nose);

    // Glossy eyes + tan brow dots
    const eyeGeo = this.trackGeo(new THREE.SphereGeometry(0.015, 10, 8));
    const glintGeo = this.trackGeo(new THREE.SphereGeometry(0.005, 6, 6));
    const browGeo = this.trackGeo(new THREE.SphereGeometry(0.013, 8, 6));
    for (const sx of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, noseMat);
      eye.position.set(sx * 0.036, 0.020, 0.068);
      this.wastiHeadPivot.add(eye);

      const glint = new THREE.Mesh(glintGeo, eyeWhiteMat);
      glint.position.set(sx * 0.039, 0.025, 0.081);
      this.wastiHeadPivot.add(glint);

      const brow = new THREE.Mesh(browGeo, tanMat);
      brow.position.set(sx * 0.034, 0.044, 0.062);
      brow.scale.set(1.1, 0.7, 0.8);
      this.wastiHeadPivot.add(brow);
    }

    // Long floppy velvet ears
    const earGeo = this.trackGeo(new THREE.CapsuleGeometry(0.028, 0.09, 6, 10));
    this.wastiEarL = new THREE.Group();
    this.wastiEarL.position.set(0.072, 0.024, -0.005);
    const earMeshL = new THREE.Mesh(earGeo, coatMat);
    earMeshL.position.set(0.012, -0.055, 0.005);
    earMeshL.rotation.z = 0.22;
    earMeshL.scale.set(0.55, 1.0, 1.15);
    earMeshL.castShadow = true;
    this.wastiEarL.add(earMeshL);
    this.wastiHeadPivot.add(this.wastiEarL);

    this.wastiEarR = new THREE.Group();
    this.wastiEarR.position.set(-0.072, 0.024, -0.005);
    const earMeshR = new THREE.Mesh(earGeo, coatMat);
    earMeshR.position.set(-0.012, -0.055, 0.005);
    earMeshR.rotation.z = -0.22;
    earMeshR.scale.set(0.55, 1.0, 1.15);
    earMeshR.castShadow = true;
    this.wastiEarR.add(earMeshR);
    this.wastiHeadPivot.add(this.wastiEarR);

    // Wagging Tail Pivot
    this.wastiTailPivot = new THREE.Group();
    this.wastiTailPivot.position.set(0, 0.035, -0.175);
    bodyPivot.add(this.wastiTailPivot);

    const tailGeo = this.trackGeo(new THREE.CapsuleGeometry(0.017, 0.125, 6, 10));
    const tailMesh = new THREE.Mesh(tailGeo, coatMat);
    tailMesh.position.set(0, 0.055, -0.045);
    tailMesh.rotation.x = -0.72;
    tailMesh.castShadow = true;
    this.wastiTailPivot.add(tailMesh);
  }

  private buildMichiCameraRig(): void {
    this.camRigPivot.name = 'MichiTelephotoCamera';
    this.camRigPivot.position.set(0, 1.48, 0.25);
    this.michiRoot.add(this.camRigPivot);

    const bodyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.52,
        metalness: 0.25,
      })
    );
    const whiteLensMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0, // Pro L-series telephoto white barrel
        roughness: 0.34,
        metalness: 0.28,
      })
    );
    const redRingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        roughness: 0.35,
        metalness: 0.2,
      })
    );
    const glassMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0c4a6e,
        emissive: 0x0284c7,
        emissiveIntensity: 0.3,
        roughness: 0.08,
        metalness: 0.9,
      })
    );
    const lcdMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );

    // DSLR body
    const bodyGeo = this.trackGeo(new THREE.BoxGeometry(0.155, 0.105, 0.075));
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    this.camRigPivot.add(body);

    // Prism viewfinder hump
    const prismGeo = this.trackGeo(new THREE.BoxGeometry(0.068, 0.036, 0.065));
    const prism = new THREE.Mesh(prismGeo, bodyMat);
    prism.position.set(0, 0.064, -0.002);
    this.camRigPivot.add(prism);

    // Rear LCD screen
    const lcdGeo = this.trackGeo(new THREE.PlaneGeometry(0.072, 0.048));
    const lcd = new THREE.Mesh(lcdGeo, lcdMat);
    lcd.position.set(0.008, -0.005, -0.0385);
    lcd.rotation.y = Math.PI;
    this.camRigPivot.add(lcd);

    // Telephoto barrel (extending forward +Z)
    const mountGeo = this.trackGeo(new THREE.CylinderGeometry(0.042, 0.044, 0.05, 16));
    mountGeo.rotateX(Math.PI / 2);
    const mount = new THREE.Mesh(mountGeo, bodyMat);
    mount.position.z = 0.06;
    this.camRigPivot.add(mount);

    const barrelGeo = this.trackGeo(new THREE.CylinderGeometry(0.046, 0.042, 0.175, 18));
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, whiteLensMat);
    barrel.position.z = 0.165;
    barrel.castShadow = true;
    this.camRigPivot.add(barrel);

    // Rubber zoom grip ring
    const gripRingGeo = this.trackGeo(new THREE.CylinderGeometry(0.0485, 0.0485, 0.045, 18));
    gripRingGeo.rotateX(Math.PI / 2);
    const gripRing = new THREE.Mesh(gripRingGeo, bodyMat);
    gripRing.position.z = 0.145;
    this.camRigPivot.add(gripRing);

    // Red pro lens ring
    const proRingGeo = this.trackGeo(new THREE.CylinderGeometry(0.0475, 0.0475, 0.010, 18));
    proRingGeo.rotateX(Math.PI / 2);
    const proRing = new THREE.Mesh(proRingGeo, redRingMat);
    proRing.position.z = 0.232;
    this.camRigPivot.add(proRing);

    // Telephoto lens hood & front glass element
    const hoodGeo = this.trackGeo(new THREE.CylinderGeometry(0.056, 0.046, 0.062, 18, 1, true));
    hoodGeo.rotateX(Math.PI / 2);
    const hood = new THREE.Mesh(hoodGeo, bodyMat);
    hood.position.z = 0.278;
    hood.castShadow = true;
    this.camRigPivot.add(hood);

    const glassGeo = this.trackGeo(new THREE.CylinderGeometry(0.041, 0.041, 0.008, 16));
    glassGeo.rotateX(Math.PI / 2);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.z = 0.252;
    this.camRigPivot.add(glass);

    // IK Hand Grip Markers on camera (wrists offset ~5.5cm back so palms/fingers wrap around barrel & grip)
    this.camGripL.position.set(0.075, -0.025, 0.085);
    this.camRigPivot.add(this.camGripL);

    this.camGripR.position.set(-0.115, -0.012, -0.055);
    this.camRigPivot.add(this.camGripR);

    // Lightweight additive shutter flash sprite on camera front (zero PointLights)
    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = 64;
    flashCanvas.height = 64;
    const fCtx = flashCanvas.getContext('2d')!;
    const fGrad = fCtx.createRadialGradient(32, 32, 0, 32, 32, 30);
    fGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    fGrad.addColorStop(0.32, 'rgba(224, 242, 254, 0.85)');
    fGrad.addColorStop(0.68, 'rgba(56, 189, 248, 0.28)');
    fGrad.addColorStop(1.0, 'rgba(56, 189, 248, 0)');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 64, 64);

    const flashTex = this.trackTex(new THREE.CanvasTexture(flashCanvas));
    flashTex.colorSpace = THREE.SRGBColorSpace;
    this.camFlashMat = this.trackMat(
      new THREE.SpriteMaterial({
        map: flashTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.camFlashSprite = new THREE.Sprite(this.camFlashMat);
    this.camFlashSprite.position.set(0, 0.085, 0.055);
    this.camFlashSprite.scale.setScalar(0.55);
    this.camFlashSprite.visible = false;
    this.camRigPivot.add(this.camFlashSprite);
  }

  // ---------------------------------------------------------------------------
  // NPC Animation & Two-Bone IK Skeleton Posing
  // ---------------------------------------------------------------------------
  private updateSeppAndWasti(
    dt: number,
    playerPos: THREE.Vector3,
    playerSpeed: number,
    distNpcXZ: number
  ): void {
    const rig = this.seppRig;

    const isCheering = this.cheerTimer > 0 && this.cheerNpcId === 'sepp';
    const cheerElapsed = isCheering
      ? ParkCrewEncounters.CHEER_DURATION_SEC - this.cheerTimer
      : 0;

    // Smoothly turn Opa Sepp slightly toward nearby player (or directly when cheering)
    const toPlayerYaw = Math.atan2(
      playerPos.x - rig.group.position.x,
      playerPos.z - rig.group.position.z
    );
    const targetBodyYaw = isCheering
      ? toPlayerYaw
      : distNpcXZ < 11.0
        ? this.lerpAngle(rig.baseYaw, toPlayerYaw, THREE.MathUtils.clamp((11.0 - distNpcXZ) / 6.0, 0, 0.85))
        : rig.baseYaw;
    rig.currentYaw = this.lerpAngle(rig.currentYaw, targetBodyYaw, Math.min(1, dt * (isCheering ? 7.5 : 4.5)));
    rig.group.rotation.y = rig.currentYaw;

    // Head look toward player
    let relYaw = toPlayerYaw - rig.currentYaw;
    while (relYaw > Math.PI) relYaw -= Math.PI * 2;
    while (relYaw < -Math.PI) relYaw += Math.PI * 2;
    const desiredHeadYaw = distNpcXZ < 14.0 ? THREE.MathUtils.clamp(relYaw, -0.78, 0.78) : 0;
    const dyHead = playerPos.y + 1.35 - (rig.group.position.y + 1.6);
    const desiredHeadPitch =
      distNpcXZ < 14.0
        ? THREE.MathUtils.clamp(-Math.atan2(dyHead, Math.max(1.0, distNpcXZ)), -0.35, 0.35)
        : 0;

    rig.headLookYaw = THREE.MathUtils.lerp(rig.headLookYaw, desiredHeadYaw, Math.min(1, dt * 6));
    rig.headLookPitch = THREE.MathUtils.lerp(
      rig.headLookPitch,
      desiredHeadPitch,
      Math.min(1, dt * 6)
    );

    const isWaving = distNpcXZ < 6.0 && this.questState === 'idle';
    if (rig.hasSkeleton) {
      this.poseSepp(rig, dt, this.elapsedSec, isWaving, isCheering, cheerElapsed);
    }

    // Animate Dackel Wasti
    const wagRate =
      7.5 +
      (distNpcXZ < 6.5 ? 6.0 : 0) +
      (isCheering ? 10.0 : 0) +
      Math.min(3.5, playerSpeed * 0.35);
    const wagAmp = isCheering ? 0.62 : distNpcXZ < 6.5 ? 0.52 : 0.34;
    this.wastiTailPivot.rotation.y = Math.sin(this.elapsedSec * wagRate) * wagAmp;
    this.wastiTailPivot.rotation.x = 0.12 + Math.sin(this.elapsedSec * wagRate * 0.5) * 0.08;

    // Floppy ear bounce & breathing
    const earAmp = isCheering && cheerElapsed < 0.9 ? 0.15 : 0.04;
    const earSpeed = isCheering && cheerElapsed < 0.9 ? 16.0 : 4.2;
    this.wastiEarL.rotation.z = earAmp * Math.sin(this.elapsedSec * earSpeed);
    this.wastiEarR.rotation.z = -earAmp * Math.sin(this.elapsedSec * earSpeed);

    // Excited hops: 2 distinct happy hops on Crowd Hype cheer, or hop on quest start/completion
    if (isCheering && cheerElapsed < 0.9) {
      const hopU = cheerElapsed / 0.9;
      this.wastiRoot.position.y = this.wastiBaseY + Math.abs(Math.sin(hopU * Math.PI * 2)) * 0.18;
    } else if (this.wastiHopTimer > 0) {
      this.wastiHopTimer = Math.max(0, this.wastiHopTimer - dt);
      const hopPhase = this.wastiHopTimer * 14.0;
      this.wastiRoot.position.y = this.wastiBaseY + Math.abs(Math.sin(hopPhase)) * 0.14;
    } else {
      this.wastiRoot.position.y = this.wastiBaseY;
    }

    // Wasti looks up warmly at player
    const toWastiPlayerYaw = Math.atan2(
      playerPos.x - this.wastiRoot.position.x,
      playerPos.z - this.wastiRoot.position.z
    );
    let relWastiYaw = toWastiPlayerYaw - this.wastiRoot.rotation.y;
    while (relWastiYaw > Math.PI) relWastiYaw -= Math.PI * 2;
    while (relWastiYaw < -Math.PI) relWastiYaw += Math.PI * 2;
    const targetWastiHeadYaw =
      distNpcXZ < 12.0 ? THREE.MathUtils.clamp(relWastiYaw, -0.75, 0.75) : 0;
    this.wastiHeadPivot.rotation.y = THREE.MathUtils.lerp(
      this.wastiHeadPivot.rotation.y,
      targetWastiHeadYaw,
      Math.min(1, dt * 6)
    );
    this.wastiHeadPivot.rotation.x =
      distNpcXZ < 8.0 ? -0.18 + Math.sin(this.elapsedSec * 2.5) * 0.04 : 0;
  }

  private updateMichi(
    dt: number,
    playerPos: THREE.Vector3,
    playerSpeed: number,
    distNpcXZ: number
  ): void {
    const rig = this.michiRig;
    const isNear = distNpcXZ < 7.8;
    const isCheering = this.cheerTimer > 0 && this.cheerNpcId === 'michi';
    const cheerElapsed = isCheering
      ? ParkCrewEncounters.CHEER_DURATION_SEC - this.cheerTimer
      : 0;

    const toPlayerYaw = Math.atan2(
      playerPos.x - rig.group.position.x,
      playerPos.z - rig.group.position.z
    );

    // When player is nearby or cheering, turn toward skater; otherwise pan skyward spotting planes
    const skyPanYaw = rig.baseYaw + Math.sin(this.elapsedSec * 0.48) * 0.36;
    const targetBodyYaw =
      isNear || isCheering
        ? toPlayerYaw
        : distNpcXZ < 13.0
          ? this.lerpAngle(skyPanYaw, toPlayerYaw, (13.0 - distNpcXZ) / 5.2)
          : skyPanYaw;
    rig.currentYaw = this.lerpAngle(
      rig.currentYaw,
      targetBodyYaw,
      Math.min(1, dt * (isCheering ? 7.5 : 4.2))
    );
    rig.group.rotation.y = rig.currentYaw;

    // Blend camera: during cheer Phase 1 (0..0.38s) snap photo at eye level, then lower to chest while saluting
    const targetBlend = isCheering
      ? cheerElapsed < 0.38
        ? 0.88
        : 0.12
      : isNear
        ? 0.0
        : 1.0;
    this.camRaiseBlend = THREE.MathUtils.lerp(
      this.camRaiseBlend,
      targetBlend,
      Math.min(1, dt * (isCheering ? 10.0 : 5.0))
    );

    // Camera double-shutter flash during Phase 1 of cheer
    if (this.camFlashSprite && this.camFlashMat) {
      const flashA = isCheering && cheerElapsed < 0.12;
      const flashB = isCheering && cheerElapsed >= 0.18 && cheerElapsed < 0.30;
      if (flashA || flashB) {
        const localT = flashA ? cheerElapsed / 0.12 : (cheerElapsed - 0.18) / 0.12;
        this.camFlashSprite.visible = true;
        this.camFlashSprite.scale.setScalar(0.35 + localT * 0.45);
        this.camFlashMat.opacity = Math.sin(localT * Math.PI) * 0.95;
      } else {
        this.camFlashSprite.visible = false;
      }
    }

    // Position & tilt camera in Michi local frame
    const skyPitch = isCheering ? -0.06 : -0.36 - Math.sin(this.elapsedSec * 0.72) * 0.08;
    const skyLocalYaw = isCheering ? 0 : Math.sin(this.elapsedSec * 0.85) * 0.14;
    this.camRigPivot.position.set(
      isCheering && cheerElapsed >= 0.38 ? 0.05 : 0,
      THREE.MathUtils.lerp(1.23, 1.50, this.camRaiseBlend) + Math.sin(this.elapsedSec * 1.9) * 0.004,
      THREE.MathUtils.lerp(0.24, 0.26, this.camRaiseBlend)
    );
    this.camRigPivot.rotation.set(
      THREE.MathUtils.lerp(0.16, skyPitch, this.camRaiseBlend),
      THREE.MathUtils.lerp(0, skyLocalYaw, this.camRaiseBlend),
      0
    );

    // Head look follows player when near or cheering, or tracks camera viewfinder when spotting sky
    let relYaw = toPlayerYaw - rig.currentYaw;
    while (relYaw > Math.PI) relYaw -= Math.PI * 2;
    while (relYaw < -Math.PI) relYaw += Math.PI * 2;
    const speedFocus = Math.min(0.12, playerSpeed * 0.01);
    const desiredHeadYaw =
      isNear || isCheering
        ? THREE.MathUtils.clamp(relYaw, -0.75, 0.75)
        : skyLocalYaw * 0.85;
    const desiredHeadPitch =
      isNear || isCheering ? 0.04 + speedFocus : skyPitch * 0.72;

    rig.headLookYaw = THREE.MathUtils.lerp(rig.headLookYaw, desiredHeadYaw, Math.min(1, dt * 6));
    rig.headLookPitch = THREE.MathUtils.lerp(
      rig.headLookPitch,
      desiredHeadPitch,
      Math.min(1, dt * 6)
    );

    if (rig.hasSkeleton) {
      this.poseMichi(rig, dt, this.elapsedSec, isCheering, cheerElapsed);
    }
  }

  private poseSepp(
    rig: MakeHumanRig,
    _dt: number,
    timeSec: number,
    isWaving: boolean,
    isCheering = false,
    cheerElapsed = 0
  ): void {
    const b = rig.bones;
    this.resetRigToRest(rig);
    rig.group.updateMatrixWorld(true);

    const npcX = this.localDir(rig.group, 1, 0, 0);
    const npcY = this.localDir(rig.group, 0, 1, 0);
    const breath = Math.sin(timeSec * 1.95);
    const cheerBounce = isCheering ? Math.abs(Math.sin(cheerElapsed * 8.5)) * 0.016 : 0;

    // Pelvis standing upright with tiny natural ease (plus cheerful bounce)
    const hipsLocal = new THREE.Vector3(
      0,
      rig.hipsRestHeight - 0.014 + breath * 0.003 + cheerBounce,
      0
    );
    const hipsWorld = rig.group.localToWorld(hipsLocal);
    if (b.Hips.parent) {
      b.Hips.position.copy(b.Hips.parent.worldToLocal(hipsWorld));
      b.Hips.updateMatrixWorld(true);
    }

    // Subtle upright breathing & head look toward player
    this.rotateBoneAxis(b.Spine1, npcX, 0.025 * breath - (isCheering ? 0.04 : 0));
    this.rotateBoneAxis(b.Spine2, npcX, -0.015 * breath);
    this.rotateBoneAxis(b.Neck, npcY, rig.headLookYaw * 0.45);
    this.rotateBoneAxis(b.Head, npcY, rig.headLookYaw * 0.55);
    this.rotateBoneAxis(b.Head, npcX, rig.headLookPitch - (isCheering ? 0.06 * Math.sin(cheerElapsed * 7) : 0));

    // Legs standing solidly on flat ground
    const ankleL = rig.group.localToWorld(new THREE.Vector3(0.125, rig.ankleHeight, 0.018));
    const ankleR = rig.group.localToWorld(new THREE.Vector3(-0.125, rig.ankleHeight, -0.018));
    this.solveLeg(rig, 'Left', ankleL, this.localDir(rig.group, 0.14, 0, 1));
    this.solveLeg(rig, 'Right', ankleR, this.localDir(rig.group, -0.14, 0, 1));
    this.alignStandingFeet(rig);

    // Left hand holds wooden walking cane (lifted enthusiastically when cheering!)
    let caneGrip: THREE.Vector3;
    if (this.seppCaneGroup) {
      if (isCheering) {
        const pump = Math.sin(cheerElapsed * 11.0);
        const caneLiftY = 0.24 + Math.max(0, Math.sin(cheerElapsed * 8.5)) * 0.16;
        const caneTilt = 0.24 + pump * 0.09;
        this.seppCaneGroup.position.set(
          this.seppCaneRestPos.x,
          caneLiftY,
          this.seppCaneRestPos.z + 0.08
        );
        this.seppCaneGroup.rotation.set(caneTilt, 0, -0.08);
      } else {
        this.seppCaneGroup.position.copy(this.seppCaneRestPos);
        this.seppCaneGroup.rotation.set(0, 0, 0);
      }
      this.seppCaneGroup.updateMatrixWorld(true);
      caneGrip = this.seppCaneGroup.localToWorld(
        new THREE.Vector3(0, 0.935 + breath * 0.005, -0.01)
      );
    } else {
      caneGrip = rig.group.localToWorld(
        new THREE.Vector3(0.255, 0.935 + breath * 0.005, 0.145)
      );
    }
    this.solveArm(rig, 'Left', caneGrip, this.localDir(rig.group, 0.72, -0.35, -0.60));

    // Right hand: enthusiastic high pump when cheering, warm wave when idle near player, else relaxed
    let handRTarget: THREE.Vector3;
    let poleR: THREE.Vector3;
    if (isCheering) {
      const cheerPump = Math.sin(cheerElapsed * 11.5);
      handRTarget = rig.group.localToWorld(
        new THREE.Vector3(
          -0.34 + Math.cos(cheerElapsed * 6.5) * 0.06,
          1.66 + cheerPump * 0.11,
          0.20
        )
      );
      poleR = this.localDir(rig.group, -0.65, -0.55, -0.25);
    } else {
      const waveX = isWaving ? -0.34 + Math.sin(timeSec * 5.8) * 0.075 : -0.245;
      const waveY = isWaving
        ? 1.46 + Math.cos(timeSec * 5.8) * 0.035
        : 0.835 + breath * 0.008;
      const waveZ = isWaving ? 0.22 : 0.08;
      handRTarget = rig.group.localToWorld(new THREE.Vector3(waveX, waveY, waveZ));
      poleR = isWaving
        ? this.localDir(rig.group, -0.65, -0.55, -0.25)
        : this.localDir(rig.group, -0.78, -0.25, -0.62);
    }
    this.solveArm(rig, 'Right', handRTarget, poleR);

    for (const f of rig.fingerBones) {
      f.rotateX(isCheering ? 0.22 : isWaving ? 0.14 : 0.28);
    }
  }

  private poseMichi(
    rig: MakeHumanRig,
    _dt: number,
    timeSec: number,
    isCheering = false,
    cheerElapsed = 0
  ): void {
    const b = rig.bones;
    this.resetRigToRest(rig);
    rig.group.updateMatrixWorld(true);

    const npcX = this.localDir(rig.group, 1, 0, 0);
    const npcY = this.localDir(rig.group, 0, 1, 0);
    const breath = Math.sin(timeSec * 1.85);
    const cheerBounce = isCheering && cheerElapsed >= 0.36
      ? Math.abs(Math.sin(cheerElapsed * 8.0)) * 0.014
      : 0;

    const hipsLocal = new THREE.Vector3(
      0,
      rig.hipsRestHeight - 0.016 + breath * 0.003 + cheerBounce,
      0
    );
    const hipsWorld = rig.group.localToWorld(hipsLocal);
    if (b.Hips.parent) {
      b.Hips.position.copy(b.Hips.parent.worldToLocal(hipsWorld));
      b.Hips.updateMatrixWorld(true);
    }

    this.rotateBoneAxis(b.Spine1, npcX, 0.02 * breath - (isCheering && cheerElapsed >= 0.36 ? 0.045 : 0));
    this.rotateBoneAxis(b.Neck, npcY, rig.headLookYaw * 0.4);
    this.rotateBoneAxis(b.Head, npcY, rig.headLookYaw * 0.6);
    this.rotateBoneAxis(b.Head, npcX, rig.headLookPitch);

    // Legs standing solidly
    const ankleL = rig.group.localToWorld(new THREE.Vector3(0.135, rig.ankleHeight, 0.025));
    const ankleR = rig.group.localToWorld(new THREE.Vector3(-0.135, rig.ankleHeight, -0.025));
    this.solveLeg(rig, 'Left', ankleL, this.localDir(rig.group, 0.15, 0, 1));
    this.solveLeg(rig, 'Right', ankleR, this.localDir(rig.group, -0.15, 0, 1));
    this.alignStandingFeet(rig);

    // Left hand grips the DSLR telephoto camera
    const gripLWorld = this.worldPos(this.camGripL);
    this.solveArm(rig, 'Left', gripLWorld, this.localDir(rig.group, 0.62, -0.62, -0.38));

    // Right hand: after snapping the photo (0.36s), raise hand in salute / celebratory cheer
    if (isCheering && cheerElapsed >= 0.36) {
      const saluteTarget = rig.group.localToWorld(
        new THREE.Vector3(
          -0.31 + Math.sin(cheerElapsed * 9.0) * 0.045,
          1.63 + Math.cos(cheerElapsed * 9.0) * 0.055,
          0.22
        )
      );
      this.solveArm(rig, 'Right', saluteTarget, this.localDir(rig.group, -0.68, -0.55, -0.30));
    } else {
      const gripRWorld = this.worldPos(this.camGripR);
      this.solveArm(rig, 'Right', gripRWorld, this.localDir(rig.group, -0.65, -0.58, -0.40));
    }

    for (const f of rig.fingerBones) {
      f.rotateX(isCheering && cheerElapsed >= 0.36 ? 0.18 : 0.36);
    }
  }

  private alignStandingFeet(rig: MakeHumanRig): void {
    const npcQ = rig.group.getWorldQuaternion(this.tempQuatA);
    const yawL = this.tempQuatB.setFromAxisAngle(AXIS_Y, 0.12);
    this.setBoneWorldQuat(
      rig.bones.LeftFoot,
      npcQ.clone().multiply(yawL).multiply(rig.footRestInNpc.Left)
    );
    const yawR = this.tempQuatB.setFromAxisAngle(AXIS_Y, -0.12);
    this.setBoneWorldQuat(
      rig.bones.RightFoot,
      npcQ.clone().multiply(yawR).multiply(rig.footRestInNpc.Right)
    );
  }

  private resetRigToRest(rig: MakeHumanRig): void {
    for (const [bone, rq] of rig.restQuat) {
      bone.quaternion.copy(rq);
      const rp = rig.restPos.get(bone);
      if (rp) bone.position.copy(rp);
    }
  }

  private worldPos(obj: THREE.Object3D): THREE.Vector3 {
    return obj.getWorldPosition(new THREE.Vector3());
  }

  private localDir(group: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).normalize().transformDirection(group.matrixWorld);
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

  private solveLeg(
    rig: MakeHumanRig,
    side: 'Left' | 'Right',
    target: THREE.Vector3,
    poleDir: THREE.Vector3
  ): void {
    const upLeg = rig.bones[`${side}UpLeg`];
    const leg = rig.bones[`${side}Leg`];
    const foot = rig.bones[`${side}Foot`];
    if (!upLeg || !leg || !foot) return;

    const { upper, lower } = rig.legLengths[side];
    const hip = this.worldPos(upLeg);
    const toTarget = target.clone().sub(hip);
    const dist = THREE.MathUtils.clamp(toTarget.length(), 0.05, (upper + lower) * 0.998);
    const dir = toTarget.normalize();
    const along = (upper * upper - lower * lower + dist * dist) / (2 * dist);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const pole = poleDir.clone().sub(dir.clone().multiplyScalar(poleDir.dot(dir))).normalize();
    const kneeTarget = hip.clone().addScaledVector(dir, along).addScaledVector(pole, height);

    this.aimBone(upLeg, leg, kneeTarget.clone().sub(hip));
    const knee = this.worldPos(leg);
    this.aimBone(leg, foot, target.clone().sub(knee));
  }

  private solveArm(
    rig: MakeHumanRig,
    side: 'Left' | 'Right',
    target: THREE.Vector3,
    poleDir: THREE.Vector3
  ): void {
    const arm = rig.bones[`${side}Arm`];
    const foreArm = rig.bones[`${side}ForeArm`];
    const hand = rig.bones[`${side}Hand`];
    if (!arm || !foreArm || !hand) return;

    const { upper, lower } = rig.armLengths[side];
    const shoulder = this.worldPos(arm);
    const toTarget = target.clone().sub(shoulder);
    const dist = THREE.MathUtils.clamp(toTarget.length(), 0.05, (upper + lower) * 0.998);
    const dir = toTarget.normalize();
    const along = (upper * upper - lower * lower + dist * dist) / (2 * dist);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const pole = poleDir.clone().sub(dir.clone().multiplyScalar(poleDir.dot(dir))).normalize();
    const elbowTarget = shoulder.clone().addScaledVector(dir, along).addScaledVector(pole, height);

    this.aimBone(arm, foreArm, elbowTarget.clone().sub(shoulder));
    const elbow = this.worldPos(foreArm);
    this.aimBone(foreArm, hand, target.clone().sub(elbow));
  }

  // ---------------------------------------------------------------------------
  // Floating 3D Overhead Marker (`CanvasTexture` Sprite)
  // ---------------------------------------------------------------------------
  private buildOverheadMarker(): {
    sprite: THREE.Sprite;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    tex: THREE.CanvasTexture;
    mat: THREE.SpriteMaterial;
  } {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;

    const mat = this.trackMat(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      })
    );
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.76);
    sprite.renderOrder = 12;

    return { sprite, canvas, ctx, tex, mat };
  }

  private buildHypePopupSprite(): {
    sprite: THREE.Sprite;
    mat: THREE.SpriteMaterial;
  } {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.shadowColor = 'rgba(251, 191, 36, 0.9)';
    ctx.shadowBlur = 20;

    // Rounded golden pill badge
    const bx = 46;
    const by = 52;
    const bw = 420;
    const bh = 148;
    const r = 44;

    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();

    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fde047';
    ctx.font = '900 74px "Barlow Condensed", Impact, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔥 +500 ★', canvas.width / 2, by + bh / 2 + 4);
    ctx.restore();

    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;

    const mat = this.trackMat(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.25, 0.625, 1);
    sprite.renderOrder = 14;
    sprite.visible = false;

    return { sprite, mat };
  }

  private updateMarkerPosition(): void {
    const activeRoot = this.parkId === 'im_gefilde' ? this.seppRoot : this.michiRoot;
    const bob = Math.sin(this.elapsedSec * 3.1) * 0.055;
    this.markerSprite.position.set(
      activeRoot.position.x,
      activeRoot.position.y + 2.28 + bob,
      activeRoot.position.z
    );
  }

  private updateMarkerVisual(force: boolean): void {
    const key = `${this.questState}:${this.collectedCount}:${this.playerInRange ? 1 : 0}`;
    if (!force && key === this.lastMarkerKey) return;
    this.lastMarkerKey = key;

    const ctx = this.markerCtx;
    const w = this.markerCanvas.width;
    const h = this.markerCanvas.height;
    ctx.clearRect(0, 0, w, h);

    let borderCol = '#fbbf24';
    let glowCol = 'rgba(251, 191, 36, 0.72)';
    let textCol = '#fde047';
    let label = '!';
    let fontSize = 112;

    if (this.questState === 'active') {
      borderCol = '#22d3ee';
      glowCol = 'rgba(34, 211, 238, 0.72)';
      textCol = '#67e8f9';
      label = `${this.collectedCount}/${ParkCrewEncounters.TOTAL_COLLECTIBLES}`;
      fontSize = 76;
    } else if (this.questState === 'completed') {
      borderCol = '#10b981';
      glowCol = 'rgba(16, 185, 129, 0.72)';
      textCol = '#6ee7b7';
      label = '✓';
      fontSize = 104;
    }

    ctx.save();
    ctx.shadowColor = glowCol;
    ctx.shadowBlur = this.playerInRange ? 26 : 16;

    // Speech-bubble rounded badge + pointer tail
    const bx = 40;
    const by = 28;
    const bw = 176;
    const bh = 152;
    const r = 34;

    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(w / 2 + 20, by + bh);
    ctx.lineTo(w / 2, by + bh + 28);
    ctx.lineTo(w / 2 - 20, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();

    ctx.fillStyle = this.playerInRange
      ? 'rgba(15, 23, 42, 0.95)'
      : 'rgba(10, 15, 28, 0.88)';
    ctx.fill();

    ctx.lineWidth = this.playerInRange ? 8 : 6;
    ctx.strokeStyle = borderCol;
    ctx.stroke();

    // Glyph
    ctx.shadowBlur = 12;
    ctx.fillStyle = textCol;
    ctx.font = `900 ${fontSize}px "Barlow Condensed", Impact, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, by + bh / 2 + 4);
    ctx.restore();

    this.markerTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Collectibles Construction (Golden Dog-Bone Treats & Neon-Cyan SD Cards)
  // ---------------------------------------------------------------------------
  private buildCollectiblesForPark(parkId: CrewParkId): void {
    const cfg = PARK_CREW_CONFIGS[parkId];
    const targetGroup =
      parkId === 'im_gefilde' ? this.seppCollectiblesGroup : this.michiCollectiblesGroup;
    const ringColor = parkId === 'im_gefilde' ? 0xfbbf24 : 0x22d3ee;

    const ringGeo = this.trackGeo(new THREE.TorusGeometry(0.42, 0.015, 8, 36));
    const list: CollectibleRuntime[] = [];

    cfg.spots.forEach((spot, index) => {
      const container = new THREE.Group();
      container.visible = false;

      const visualPivot =
        parkId === 'im_gefilde'
          ? this.createGoldenBoneVisual()
          : this.createSdCardVisual();
      container.add(visualPivot);

      const ringMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: ringColor,
          transparent: true,
          opacity: 0.68,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const glowRing = new THREE.Mesh(ringGeo, ringMat);
      glowRing.rotation.x = Math.PI / 2;
      container.add(glowRing);

      targetGroup.add(container);

      const sample = this.parkSurface.sample(spot.x, spot.z);
      const basePos = new THREE.Vector3(
        spot.x,
        sample.height + ParkCrewEncounters.COLLECT_HEIGHT_OFFSET,
        spot.z
      );
      container.position.copy(basePos);

      list.push({
        index,
        spot,
        basePos,
        container,
        visualPivot,
        glowRing,
        ringMat,
        collected: false,
        popping: false,
        popTimer: 0,
        revealTimer: 0,
      });
    });

    this.collectiblesByPark[parkId] = list;
  }

  private createGoldenBoneVisual(): THREE.Group {
    const pivot = new THREE.Group();
    const boneGroup = new THREE.Group();
    boneGroup.rotation.z = 0.28;
    pivot.add(boneGroup);

    const goldMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.58,
        metalness: 0.72,
        roughness: 0.2,
      })
    );

    const shaftGeo = this.trackGeo(new THREE.CapsuleGeometry(0.068, 0.30, 8, 12));
    shaftGeo.rotateZ(Math.PI / 2);
    const shaft = new THREE.Mesh(shaftGeo, goldMat);
    shaft.castShadow = true;
    boneGroup.add(shaft);

    const knobGeo = this.trackGeo(new THREE.SphereGeometry(0.088, 12, 10));
    const knobOffsets: [number, number][] = [
      [-0.18, 0.068],
      [-0.18, -0.068],
      [0.18, 0.068],
      [0.18, -0.068],
    ];
    for (const [kx, ky] of knobOffsets) {
      const knob = new THREE.Mesh(knobGeo, goldMat);
      knob.position.set(kx, ky, 0);
      knob.scale.set(1.0, 0.92, 0.78);
      knob.castShadow = true;
      boneGroup.add(knob);
    }

    return pivot;
  }

  private createSdCardVisual(): THREE.Group {
    const pivot = new THREE.Group();
    const cardGroup = new THREE.Group();
    cardGroup.rotation.z = 0.16;
    pivot.add(cardGroup);

    // Classic notched SD-card silhouette via ExtrudeGeometry
    const w = 0.175;
    const h = 0.225;
    const notch = 0.078;
    const shape = new THREE.Shape();
    shape.moveTo(-w, -h);
    shape.lineTo(w, -h);
    shape.lineTo(w, h - notch);
    shape.lineTo(w - notch, h);
    shape.lineTo(-w, h);
    shape.closePath();

    const bodyGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.042,
        bevelEnabled: true,
        bevelThickness: 0.009,
        bevelSize: 0.009,
        bevelSegments: 2,
      })
    );
    bodyGeo.translate(0, 0, -0.021);

    const shellMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x00f5d4,
        emissiveIntensity: 0.55,
        metalness: 0.35,
        roughness: 0.22,
      })
    );
    const body = new THREE.Mesh(bodyGeo, shellMat);
    body.castShadow = true;
    cardGroup.add(body);

    // Front sticker label (CanvasTexture)
    const stickerTex = this.buildSdStickerTexture();
    const stickerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: stickerTex,
        emissive: 0x0891b2,
        emissiveIntensity: 0.22,
        roughness: 0.4,
        metalness: 0.08,
      })
    );
    const stickerGeo = this.trackGeo(new THREE.PlaneGeometry(0.26, 0.28));
    const stickerFront = new THREE.Mesh(stickerGeo, stickerMat);
    stickerFront.position.set(0, -0.02, 0.032);
    cardGroup.add(stickerFront);

    // Gold contact pins on back
    const pinMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.3,
        metalness: 0.9,
        roughness: 0.18,
      })
    );
    const pinGeo = this.trackGeo(new THREE.BoxGeometry(0.026, 0.085, 0.008));
    for (let i = -3; i <= 3; i++) {
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(i * 0.038, 0.135, -0.032);
      cardGroup.add(pin);
    }

    // Bright orange write-protect switch on left edge
    const lockMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0xea580c,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      })
    );
    const lockGeo = this.trackGeo(new THREE.BoxGeometry(0.026, 0.065, 0.044));
    const lockSwitch = new THREE.Mesh(lockGeo, lockMat);
    lockSwitch.position.set(-w - 0.004, 0.06, 0);
    cardGroup.add(lockSwitch);

    return pivot;
  }

  private buildSdStickerTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 128, 128);

    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(0, 0, 128, 34);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MUC SPOT', 64, 24);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 32px sans-serif';
    ctx.fillText('128GB', 64, 78);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 18px sans-serif';
    ctx.fillText('RAW PRO', 64, 108);

    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------------------------------------------------------------------------
  // Additive InstancedMesh Particle Burst Pool (Zero PointLights)
  // ---------------------------------------------------------------------------
  private emitCollectBurst(pos: THREE.Vector3, count: number): void {
    let emitted = 0;
    for (
      let i = 0;
      i < ParkCrewEncounters.MAX_BURST_PARTICLES && emitted < count;
      i++
    ) {
      const p = this.burstParticles[i];
      if (p.active) continue;

      p.active = true;
      p.pos.copy(pos);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 3.8;
      const up = 1.4 + Math.random() * 3.4;
      p.vel.set(Math.cos(angle) * speed, up, Math.sin(angle) * speed);
      p.life = 0;
      p.maxLife = 0.52 + Math.random() * 0.35;
      p.baseScale = 0.8 + Math.random() * 0.55;
      emitted++;
    }
  }

  private updateParticles(dt: number): void {
    let anyActive = false;

    for (let i = 0; i < ParkCrewEncounters.MAX_BURST_PARTICLES; i++) {
      const p = this.burstParticles[i];
      if (!p.active) continue;

      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.dummyObj.scale.set(0, 0, 0);
        this.dummyObj.position.set(0, -9999, 0);
        this.dummyObj.updateMatrix();
        this.burstMesh.setMatrixAt(i, this.dummyObj.matrix);
        anyActive = true;
        continue;
      }

      anyActive = true;
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);

      const s = Math.max(0, p.baseScale * (1.0 - p.life / p.maxLife));
      this.dummyObj.position.copy(p.pos);
      this.dummyObj.scale.set(s, s, s);
      this.dummyObj.updateMatrix();
      this.burstMesh.setMatrixAt(i, this.dummyObj.matrix);
    }

    if (anyActive) {
      this.burstMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private resetParticles(): void {
    this.dummyObj.scale.set(0, 0, 0);
    this.dummyObj.position.set(0, -9999, 0);
    this.dummyObj.updateMatrix();
    for (let i = 0; i < ParkCrewEncounters.MAX_BURST_PARTICLES; i++) {
      this.burstParticles[i].active = false;
      this.burstMesh.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Helpers & Resource Tracking
  // ---------------------------------------------------------------------------
  private buildShadowDecal(w: number, h: number, opacity: number): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.72)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    const mat = this.trackMat(
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    const geo = this.trackGeo(new THREE.PlaneGeometry(w, h));
    geo.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.015;
    return mesh;
  }

  private lerpAngle(from: number, to: number, alpha: number): number {
    let diff = to - from;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * alpha;
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.trackedGeometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.trackedMaterials.push(mat);
    return mat;
  }

  private trackTex<T extends THREE.Texture>(tex: T): T {
    this.trackedTextures.push(tex);
    return tex;
  }
}
