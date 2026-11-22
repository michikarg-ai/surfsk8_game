import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveAssetUrl } from '../utils/assetUrl';

type Side = 'Left' | 'Right';

// Board-local frame (glTF / three.js): +Z = nose, -X = skater's facing (toe-side) edge, +Y = up.
const DECK_TOP = 0.162;
const DEFAULT_ANKLE_HEIGHT = 0.126;
const ANKLE_XZ: Record<Side, [number, number]> = {
  Left: [0.07, 0.17],
  Right: [0.07, -0.21],
};
const TOE_YAW: Record<Side, number> = { Left: 0.32, Right: 0.06 };
const DEFAULT_HIPS_REST_HEIGHT = 1.183;

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

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * MakeHuman 3D Holographic Ghost Skater for the Flow Line Challenge.
 *
 * Loads `/models/skater.glb` once asynchronously, strips dark opaque look in favor of
 * a sleek translucent cyan/aqua holographic material with Fresnel rim glow, attaches
 * clean surfskate trucks/wheels, and poses the skeleton via Two-Bone IK in an authentic
 * surfskate carving & pumping stance.
 */
export class FlowGhostSkater {
  public readonly root = new THREE.Group();
  public readonly labelSprite: THREE.Sprite;

  private modelRoot: THREE.Object3D | null = null;
  private boardGroup: THREE.Object3D | null = null;
  private deckMesh: THREE.Object3D | null = null;
  private frontTruckPivot: THREE.Object3D | null = null;
  private rearTruckPivot: THREE.Object3D | null = null;
  private wheels: THREE.Object3D[] = [];

  // Skeleton & Two-Bone IK state
  private bones: Record<string, THREE.Bone> = {};
  private restQuat = new Map<THREE.Bone, THREE.Quaternion>();
  private restPos = new Map<THREE.Bone, THREE.Vector3>();
  private legLengths: Record<Side, { upper: number; lower: number }> = {
    Left: { upper: 0.46, lower: 0.44 },
    Right: { upper: 0.46, lower: 0.44 },
  };
  private armLengths: Record<Side, { upper: number; lower: number }> = {
    Left: { upper: 0.28, lower: 0.26 },
    Right: { upper: 0.28, lower: 0.26 },
  };
  private footRestInDeck: Record<Side, THREE.Quaternion> = {
    Left: new THREE.Quaternion(),
    Right: new THREE.Quaternion(),
  };
  private ankleTargets: Record<Side, THREE.Vector3> = {
    Left: new THREE.Vector3(ANKLE_XZ.Left[0], DECK_TOP + DEFAULT_ANKLE_HEIGHT, ANKLE_XZ.Left[1]),
    Right: new THREE.Vector3(ANKLE_XZ.Right[0], DECK_TOP + DEFAULT_ANKLE_HEIGHT, ANKLE_XZ.Right[1]),
  };
  private hipsRestHeight = DEFAULT_HIPS_REST_HEIGHT;
  private hasSkeleton = false;

  // Lightweight fallback visible only while GLB loads
  private fallbackGroup = new THREE.Group();
  private fallbackDeckGroup = new THREE.Group();
  private fallbackSurferGroup = new THREE.Group();

  // Holographic ground aura & glowing world-space carve trail ribbon
  private groundGlowMesh: THREE.Mesh;
  private trailMesh: THREE.Mesh;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private readonly maxTrailSegments = 26;
  private trailInitialized = false;
  private trailSampleAccum = 0;
  private lastTrailPos = new THREE.Vector3();

  // Animation smoothing
  private smoothLean = 0;
  private smoothCompression = 0.35;
  private holoTimeUniform = { value: 0 };

  // Resource tracking for clean disposal
  private trackedGeometries: THREE.BufferGeometry[] = [];
  private trackedMaterials: THREE.Material[] = [];
  private trackedTextures: THREE.Texture[] = [];
  private disposed = false;

  constructor(private worldParent: THREE.Group, labelSprite: THREE.Sprite) {
    this.root.name = 'FlowLineGhostSkater';
    this.worldParent.add(this.root);

    this.labelSprite = labelSprite;
    this.labelSprite.position.set(0, 1.98, 0);
    this.labelSprite.renderOrder = 12;
    this.root.add(this.labelSprite);

    this.groundGlowMesh = this.buildGroundAura();
    this.root.add(this.groundGlowMesh);

    const { mesh, positions, colors } = this.buildTrailRibbon();
    this.trailMesh = mesh;
    this.trailPositions = positions;
    this.trailColors = colors;
    this.worldParent.add(this.trailMesh);

    this.buildLightweightFallback();
    this.root.add(this.fallbackGroup);

    void this.loadMakeHumanModel();
  }

  private createHologramMaterial(opts: {
    color: number;
    emissive: number;
    emissiveIntensity: number;
    opacity: number;
    roughness?: number;
    metalness?: number;
    fresnelColor?: [number, number, number];
    fresnelBoost?: number;
  }): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color,
      emissive: opts.emissive,
      emissiveIntensity: opts.emissiveIntensity,
      roughness: opts.roughness ?? 0.25,
      metalness: opts.metalness ?? 0.14,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
    });

    const fCol = opts.fresnelColor ?? [0.16, 0.96, 0.88];
    const fBoost = opts.fresnelBoost ?? 0.9;
    const timeUniform = this.holoTimeUniform;

    mat.customProgramCacheKey = () => `FlowGhostHolo_${fBoost.toFixed(2)}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGhostTime = timeUniform;
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `uniform float uGhostTime;\nvoid main() {`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        float holoNdotV = abs(dot(normalize(normal), normalize(vViewPosition)));
        float holoFresnel = pow(max(0.0001, 1.0 - clamp(holoNdotV, 0.0, 1.0)), 2.1);
        float holoPulse = 0.90 + 0.10 * sin(uGhostTime * 3.4);
        outgoingLight += vec3(${fCol[0].toFixed(3)}, ${fCol[1].toFixed(3)}, ${fCol[2].toFixed(3)}) * holoFresnel * ${fBoost.toFixed(3)} * holoPulse;
        diffuseColor.a = clamp(diffuseColor.a + holoFresnel * 0.34, 0.0, 0.92);
        #include <opaque_fragment>
        `
      );
    };

    this.trackedMaterials.push(mat);
    return mat;
  }

  private buildGroundAura(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
    grad.addColorStop(0.0, 'rgba(0, 245, 224, 0.55)');
    grad.addColorStop(0.45, 'rgba(0, 245, 224, 0.22)');
    grad.addColorStop(1.0, 'rgba(0, 245, 224, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    this.trackedTextures.push(tex);

    const geo = new THREE.PlaneGeometry(0.76, 1.28);
    geo.rotateX(-Math.PI / 2);
    this.trackedGeometries.push(geo);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.trackedMaterials.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.015, 0);
    mesh.renderOrder = 8;
    return mesh;
  }

  private buildTrailRibbon(): {
    mesh: THREE.Mesh;
    positions: Float32Array;
    colors: Float32Array;
  } {
    const segs = this.maxTrailSegments;
    const positions = new Float32Array(segs * 2 * 3);
    const colors = new Float32Array(segs * 2 * 3);

    const indices: number[] = [];
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }

    const geo = new THREE.BufferGeometry();
    geo.setIndex(indices);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trackedGeometries.push(geo);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.trackedMaterials.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 8;
    return { mesh, positions, colors };
  }

  private buildLightweightFallback(): void {
    this.fallbackGroup.name = 'FlowGhostFallback';
    this.fallbackGroup.add(this.fallbackDeckGroup);
    this.fallbackDeckGroup.add(this.fallbackSurferGroup);

    const deckMat = this.createHologramMaterial({
      color: 0x5efce8,
      emissive: 0x00f5e0,
      emissiveIntensity: 0.65,
      opacity: 0.56,
    });
    const bodyMat = this.createHologramMaterial({
      color: 0x38f8ec,
      emissive: 0x00f5e0,
      emissiveIntensity: 0.52,
      opacity: 0.44,
    });

    const addPart = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Object3D,
      pos: [number, number, number],
      rot?: [number, number, number]
    ) => {
      this.trackedGeometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      m.renderOrder = 10;
      parent.add(m);
      return m;
    };

    // Surfskate deck (nose -Z, tail +Z)
    addPart(new THREE.BoxGeometry(0.24, 0.024, 0.84), deckMat, this.fallbackDeckGroup, [0, 0.09, 0]);
    const wheelGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.045, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    this.trackedGeometries.push(wheelGeo);
    for (const [wx, wz] of [
      [-0.11, -0.25],
      [0.11, -0.25],
      [-0.11, 0.25],
      [0.11, 0.25],
    ]) {
      const w = new THREE.Mesh(wheelGeo, deckMat);
      w.position.set(wx, 0.038, wz);
      w.renderOrder = 10;
      this.fallbackDeckGroup.add(w);
    }

    // Streamlined surf-stance silhouette while GLB loads
    addPart(new THREE.CapsuleGeometry(0.11, 0.44, 6, 12), bodyMat, this.fallbackSurferGroup, [0, 0.96, 0.02], [0.18, 0.35, 0]);
    addPart(new THREE.SphereGeometry(0.095, 12, 10), bodyMat, this.fallbackSurferGroup, [0.02, 1.44, -0.06]);
    addPart(new THREE.CapsuleGeometry(0.055, 0.38, 4, 8), bodyMat, this.fallbackSurferGroup, [-0.04, 0.42, -0.15], [-0.25, 0, 0]);
    addPart(new THREE.CapsuleGeometry(0.055, 0.38, 4, 8), bodyMat, this.fallbackSurferGroup, [0.04, 0.42, 0.17], [0.25, 0, 0]);
  }

  private async loadMakeHumanModel(modelUrl = 'models/skater.glb'): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(resolveAssetUrl(modelUrl));

      if (this.disposed) {
        this.disposeObjectResources(gltf.scene);
        return;
      }

      this.modelRoot = gltf.scene;
      this.bones = {};
      this.restQuat.clear();
      this.restPos.clear();
      this.wheels = [];

      const holoBodyMat = this.createHologramMaterial({
        color: 0x22d3ee,
        emissive: 0x00f5e0,
        emissiveIntensity: 0.42,
        opacity: 0.30,
        roughness: 0.28,
        fresnelBoost: 0.72,
      });
      const holoOutfitMat = this.createHologramMaterial({
        color: 0x52fff0,
        emissive: 0x00f5e0,
        emissiveIntensity: 0.55,
        opacity: 0.48,
        roughness: 0.25,
        fresnelBoost: 0.95,
      });
      const holoDeckMat = this.createHologramMaterial({
        color: 0x70fff3,
        emissive: 0x00f5e0,
        emissiveIntensity: 0.65,
        opacity: 0.62,
        roughness: 0.20,
        metalness: 0.25,
        fresnelBoost: 1.0,
      });
      const holoWheelMat = this.createHologramMaterial({
        color: 0xb8fff9,
        emissive: 0x00fff0,
        emissiveIntensity: 0.85,
        opacity: 0.76,
        roughness: 0.18,
        fresnelBoost: 0.9,
      });

      const legacyPlaceholders = new Set([
        'FrontSurfAdapterArm',
        'FrontBushing',
        'FrontAxle',
        'RearAxle',
      ]);

      const disposedOrigMats = new Set<THREE.Material>();

      this.modelRoot.traverse((child) => {
        if (legacyPlaceholders.has(child.name)) {
          child.visible = false;
        }

        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            mesh.frustumCulled = false;
          }

          if (mesh.geometry) {
            this.trackedGeometries.push(mesh.geometry);
          }

          // Hide internal eyeballs / eyelashes / eyebrows so translucent face looks sleek
          if (
            mesh.name.includes('eyebrow') ||
            mesh.name.includes('eyelashes') ||
            mesh.name.includes('low-poly')
          ) {
            mesh.visible = false;
          }

          // Dispose original GLB materials once so we don't leak textures/materials
          const oldMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const om of oldMats) {
            if (!om || disposedOrigMats.has(om)) continue;
            disposedOrigMats.add(om);
            const std = om as THREE.MeshStandardMaterial;
            std.map?.dispose();
            std.normalMap?.dispose();
            std.roughnessMap?.dispose();
            std.metalnessMap?.dispose();
            std.aoMap?.dispose();
            std.emissiveMap?.dispose();
            std.dispose();
          }

          if (mesh.name.includes('Wheel')) {
            mesh.material = holoWheelMat;
            mesh.renderOrder = 11;
          } else if (mesh.name.includes('Deck') || mesh.name.includes('SurfskateDeck')) {
            mesh.material = holoDeckMat;
            mesh.renderOrder = 11;
          } else if (mesh.name.includes('Body')) {
            mesh.material = holoBodyMat;
            mesh.renderOrder = 9;
          } else {
            mesh.material = holoOutfitMat;
            mesh.renderOrder = 10;
          }
        }

        if ((child as THREE.Bone).isBone) {
          const bone = child as THREE.Bone;
          this.bones[bone.name] = bone;
          this.restQuat.set(bone, bone.quaternion.clone());
          this.restPos.set(bone, bone.position.clone());
        }

        if (child.name === 'BoardGroup') this.boardGroup = child;
        if (child.name === 'DeckMesh') this.deckMesh = child;
        if (child.name === 'FrontTruckPivot') this.frontTruckPivot = child;
        if (child.name === 'RearTruckPivot') this.rearTruckPivot = child;
        if (child.name.startsWith('FrontWheel_') || child.name.startsWith('RearWheel_')) {
          this.wheels.push(child);
        }
      });

      // Attach clean holographic surfskate truck hangers & axles
      this.attachGhostSurfskateTrucks(holoDeckMat, holoWheelMat);

      // Rotate 180° around Y so GLTF +Z (nose) faces root's -Z (curve forward tangent)
      // and GLTF -X (toe-side chest) faces root's +X (right).
      this.modelRoot.rotation.y = Math.PI;
      this.root.add(this.modelRoot);

      const allBones = { ...this.bones };
      for (const [logical, candidates] of Object.entries(BONE_ALIASES)) {
        const found = candidates.map((n) => allBones[n]).find((bone) => !!bone);
        if (found) this.bones[logical] = found;
      }

      const required = [
        'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
        'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
      ];
      this.hasSkeleton = required.every((n) => !!this.bones[n]) && !!this.deckMesh && !!this.boardGroup;

      if (this.hasSkeleton) {
        // Temporarily reset root to identity to measure rest pose accurately
        const prevPos = this.root.position.clone();
        const prevQuat = this.root.quaternion.clone();
        this.root.position.set(0, 0, 0);
        this.root.quaternion.identity();
        this.root.updateMatrixWorld(true);

        const deckQ = this.deckMesh!.getWorldQuaternion(new THREE.Quaternion());
        const boardInv = this.boardGroup!.matrixWorld.clone().invert();
        const hipsLocal = this.worldPos(this.bones.Hips).applyMatrix4(boardInv);
        this.hipsRestHeight = hipsLocal.y;

        for (const side of ['Left', 'Right'] as Side[]) {
          const ankleLocal = this.worldPos(this.bones[`${side}Foot`]).applyMatrix4(boardInv);
          const ankleHeight = THREE.MathUtils.clamp(ankleLocal.y - DECK_TOP, 0.04, 0.2);
          this.ankleTargets[side].set(ANKLE_XZ[side][0], DECK_TOP + ankleHeight, ANKLE_XZ[side][1]);

          const hip = this.worldPos(this.bones[`${side}UpLeg`]);
          const knee = this.worldPos(this.bones[`${side}Leg`]);
          const ankle = this.worldPos(this.bones[`${side}Foot`]);
          this.legLengths[side] = {
            upper: hip.distanceTo(knee),
            lower: knee.distanceTo(ankle),
          };
          const footQ = this.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion());
          this.footRestInDeck[side] = deckQ.clone().invert().multiply(footQ);
        }

        for (const side of ['Left', 'Right'] as Side[]) {
          const shoulder = this.worldPos(this.bones[`${side}Arm`]);
          const elbow = this.worldPos(this.bones[`${side}ForeArm`]);
          const wrist = this.worldPos(this.bones[`${side}Hand`]);
          this.armLengths[side] = {
            upper: shoulder.distanceTo(elbow),
            lower: elbow.distanceTo(wrist),
          };
        }

        // Apply initial authentic surfskate stance
        this.poseSkeleton(0.016, 4.5, 0, 0);

        this.root.position.copy(prevPos);
        this.root.quaternion.copy(prevQuat);
        this.root.updateMatrixWorld(true);

        // Hide & detach fallback now that MakeHuman rig is ready
        this.fallbackGroup.visible = false;
        this.fallbackGroup.removeFromParent();
      }
    } catch (err) {
      console.warn('[FlowGhostSkater] Could not load MakeHuman GLB, keeping lightweight fallback:', err);
      this.hasSkeleton = false;
      this.fallbackGroup.visible = true;
    }
  }

  private attachGhostSurfskateTrucks(
    truckMat: THREE.Material,
    accentMat: THREE.Material
  ): void {
    if (!this.deckMesh || !this.frontTruckPivot || !this.rearTruckPivot) return;

    const transformGeo = (
      geo: THREE.BufferGeometry,
      pos: [number, number, number],
      rot?: [number, number, number]
    ): THREE.BufferGeometry => {
      const m = new THREE.Matrix4();
      const q = rot
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
        : new THREE.Quaternion();
      m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(1, 1, 1));
      const cloned = geo.clone();
      cloned.applyMatrix4(m);
      return cloned;
    };

    const mergeAndAttach = (
      geos: THREE.BufferGeometry[],
      mat: THREE.Material,
      parent: THREE.Object3D
    ) => {
      const merged = BufferGeometryUtils.mergeGeometries(geos);
      for (const g of geos) g.dispose();
      this.trackedGeometries.push(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = 11;
      parent.add(mesh);
    };

    // Baseplates beneath DeckMesh
    mergeAndAttach(
      [
        transformGeo(new THREE.BoxGeometry(0.056, 0.008, 0.076), [0, 0.098, 0.25]),
        transformGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.022, 16), [0, 0.083, 0.25]),
        transformGeo(new THREE.BoxGeometry(0.056, 0.008, 0.076), [0, 0.098, -0.25]),
      ],
      truckMat,
      this.deckMesh
    );

    // Front Surf-Adapter & Hanger
    mergeAndAttach(
      [
        transformGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.024, 14), [0, 0.014, 0]),
        transformGeo(new THREE.BoxGeometry(0.032, 0.018, 0.028), [0, -0.008, -0.018], [-0.6, 0, 0]),
        transformGeo(new THREE.CylinderGeometry(0.008, 0.014, 0.115, 12), [-0.03, -0.025, -0.03], [0, 0, Math.PI * 0.5]),
        transformGeo(new THREE.CylinderGeometry(0.014, 0.008, 0.115, 12), [0.03, -0.025, -0.03], [0, 0, Math.PI * 0.5]),
        transformGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.236, 10), [0, -0.025, -0.03], [0, 0, Math.PI * 0.5]),
      ],
      accentMat,
      this.frontTruckPivot
    );

    // Rear Truck Hanger
    mergeAndAttach(
      [
        transformGeo(new THREE.CylinderGeometry(0.006, 0.008, 0.024, 10), [0, 0.008, 0.024], [0.55, 0, 0]),
        transformGeo(new THREE.CylinderGeometry(0.008, 0.014, 0.115, 12), [-0.03, -0.025, 0], [0, 0, Math.PI * 0.5]),
        transformGeo(new THREE.CylinderGeometry(0.014, 0.008, 0.115, 12), [0.03, -0.025, 0], [0, 0, Math.PI * 0.5]),
        transformGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.236, 10), [0, -0.025, 0], [0, 0, Math.PI * 0.5]),
      ],
      accentMat,
      this.rearTruckPivot
    );
  }

  private worldPos(obj: THREE.Object3D): THREE.Vector3 {
    return obj.getWorldPosition(new THREE.Vector3());
  }

  private boardDir(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).normalize().transformDirection(this.boardGroup!.matrixWorld);
  }

  private rotateBoneWorld(bone: THREE.Bone, q: THREE.Quaternion): void {
    const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
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
    const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQ.invert().multiply(qWorld));
    bone.updateMatrixWorld(true);
  }

  private solveLeg(side: Side, target: THREE.Vector3, poleDir: THREE.Vector3): void {
    const upLeg = this.bones[`${side}UpLeg`];
    const leg = this.bones[`${side}Leg`];
    const foot = this.bones[`${side}Foot`];
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

  private poseSkeleton(dt: number, speed: number, lean: number, timeSec: number): void {
    if (!this.hasSkeleton || !this.boardGroup || !this.deckMesh) return;

    const b = this.bones;
    const board = this.boardGroup;
    const deck = this.deckMesh;

    // Rhythmic surfskate pump compression synced to speed & carve angle
    const pumpFreq = 2.6 + Math.min(3.5, speed * 0.45);
    const pumpWave = speed > 0.4 ? Math.sin(timeSec * pumpFreq) * 0.14 : 0;
    const targetCrouch = THREE.MathUtils.clamp(
      0.34 + Math.abs(lean) * 0.40 + pumpWave,
      0.16,
      0.78
    );
    this.smoothCompression += (targetCrouch - this.smoothCompression) * Math.min(1, dt * 10);

    const crouch = this.smoothCompression;
    const lead = -lean * 1.45;

    // 1. Reset to rest pose
    for (const bone of Object.values(b)) {
      bone.quaternion.copy(this.restQuat.get(bone)!);
      bone.position.copy(this.restPos.get(bone)!);
    }
    this.root.updateMatrixWorld(true);

    const boardY = this.boardDir(0, 1, 0);
    const boardZ = this.boardDir(0, 0, 1);
    const bodyLean = lean * 0.85;

    // 2. Pelvis: lowered by athletic surf knee bend & rolled into the carve
    const hipsLocal = new THREE.Vector3(
      0.05 + crouch * 0.06,
      this.hipsRestHeight - 0.1 - crouch * 0.3,
      -0.02
    );
    hipsLocal.y -= DECK_TOP;
    hipsLocal.applyAxisAngle(AXIS_Z, bodyLean);
    hipsLocal.y += DECK_TOP;
    const hipsWorld = board.localToWorld(hipsLocal);
    b.Hips.position.copy(b.Hips.parent!.worldToLocal(hipsWorld));
    b.Hips.updateMatrixWorld(true);

    this.rotateBoneAxis(b.Hips, boardY, 0.18 + lead * 0.2);
    this.rotateBoneAxis(b.Hips, boardZ, bodyLean + crouch * 0.18);

    // 3. Spine & Shoulders: lead into the surf carve
    this.rotateBoneAxis(b.Spine, boardZ, crouch * 0.22 + 0.06);
    this.rotateBoneAxis(b.Spine1, boardY, lead * 0.3);
    this.rotateBoneAxis(b.Spine1, boardZ, crouch * 0.14);
    this.rotateBoneAxis(b.Spine2, boardY, 0.22 + lead * 0.35);

    // 4. Head: eyes locked ahead down the Flow Line nose (+Z)
    const forwardBend = bodyLean + crouch * 0.54 + 0.06;
    this.rotateBoneAxis(b.Neck, boardZ, -forwardBend * 0.45);
    this.rotateBoneAxis(b.Neck, boardY, 0.28 + lead * 0.18);
    this.rotateBoneAxis(b.Head, boardZ, -forwardBend * 0.4);
    this.rotateBoneAxis(b.Head, boardY, 0.28 + lead * 0.18);

    // 5. Arms: stylish surfskate flow balance
    const armLift = crouch * 0.28;
    const targetLArm = this.boardDir(-0.32, -0.58 + armLift - lean * 0.35, 0.74);
    const targetLFore = this.boardDir(-0.46, -0.22 + armLift, 0.86);
    this.aimBone(b.LeftArm, b.LeftForeArm, targetLArm);
    this.aimBone(b.LeftForeArm, b.LeftHand, targetLFore);

    const targetRArm = this.boardDir(-0.22, -0.78 + armLift + lean * 0.32, -0.52);
    const targetRFore = this.boardDir(-0.48, -0.50 + armLift, -0.46);
    this.aimBone(b.RightArm, b.RightForeArm, targetRArm);
    this.aimBone(b.RightForeArm, b.RightHand, targetRFore);

    // 6. Legs: Two-Bone IK locking feet onto the carving deck
    const deckQ = deck.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['Left', 'Right'] as Side[]) {
      const target = deck.localToWorld(this.ankleTargets[side].clone());
      const pole = this.boardDir(-1, -0.15, side === 'Left' ? 0.25 : -0.1);
      this.solveLeg(side, target, pole);
      const yaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, TOE_YAW[side]);
      this.setBoneWorldQuat(
        b[`${side}Foot`],
        deckQ.clone().multiply(yaw).multiply(this.footRestInDeck[side])
      );
    }
  }

  /**
   * Updates MakeHuman skeleton, surfskate trucks/wheels, holographic pulse,
   * and world-space carve trail ribbon.
   */
  public update(
    dt: number,
    timeSec: number,
    speed: number,
    targetLean: number,
    right: THREE.Vector3,
    up: THREE.Vector3
  ): void {
    this.holoTimeUniform.value = timeSec;

    const k = Math.min(1, Math.max(0.05, dt * 10.0));
    this.smoothLean += (targetLean - this.smoothLean) * k;

    // Subtle floating sprite bob above head
    const bob = Math.sin(timeSec * 4.5) * 0.02;
    this.labelSprite.position.set(0, 1.98 + bob, 0);

    // Pulse ground aura gently
    const auraMat = this.groundGlowMesh.material as THREE.MeshBasicMaterial;
    auraMat.opacity = 0.58 + 0.16 * Math.sin(timeSec * 3.8);

    if (this.hasSkeleton && this.deckMesh) {
      // Deck leans right on right turns (+smoothLean in modelRoot frame where +Z is nose, -X is right)
      this.deckMesh.rotation.set(0, 0, this.smoothLean);

      if (this.frontTruckPivot) {
        this.frontTruckPivot.rotation.set(0, -this.smoothLean * 1.45, this.smoothLean * 0.35);
      }
      if (this.rearTruckPivot) {
        this.rearTruckPivot.rotation.set(0, this.smoothLean * 0.38, this.smoothLean * 0.2);
      }
      if (speed > 0.05 && dt > 0) {
        const rollDelta = (speed * dt) / 0.035;
        for (let i = 0; i < this.wheels.length; i++) {
          this.wheels[i].rotateY(rollDelta);
        }
      }

      this.poseSkeleton(dt, speed, this.smoothLean, timeSec);
    } else {
      // Fallback: in root frame (-Z = nose, +X = right), negative rotation.z leans right
      this.fallbackDeckGroup.rotation.z = -this.smoothLean;
      this.fallbackSurferGroup.position.y = Math.sin(timeSec * 5.0) * 0.015;
    }

    this.updateTrail(dt, speed, right, up);
  }

  private updateTrail(
    dt: number,
    speed: number,
    right: THREE.Vector3,
    up: THREE.Vector3
  ): void {
    if (!this.root.visible) {
      this.trailMesh.visible = false;
      return;
    }

    const pos = this.root.position;
    if (!this.trailInitialized) {
      this.trailInitialized = true;
      this.lastTrailPos.copy(pos);
      const lift = up.clone().multiplyScalar(0.025);
      const pL = pos.clone().addScaledVector(right, -0.09).add(lift);
      const pR = pos.clone().addScaledVector(right, 0.09).add(lift);
      for (let i = 0; i < this.maxTrailSegments; i++) {
        const idx = i * 6;
        this.trailPositions[idx] = pL.x;
        this.trailPositions[idx + 1] = pL.y;
        this.trailPositions[idx + 2] = pL.z;
        this.trailPositions[idx + 3] = pR.x;
        this.trailPositions[idx + 4] = pR.y;
        this.trailPositions[idx + 5] = pR.z;
        const fade = 1.0 - i / (this.maxTrailSegments - 1);
        this.trailColors[idx] = 0.0;
        this.trailColors[idx + 1] = 0.96 * fade;
        this.trailColors[idx + 2] = 0.88 * fade;
        this.trailColors[idx + 3] = 0.0;
        this.trailColors[idx + 4] = 0.96 * fade;
        this.trailColors[idx + 5] = 0.88 * fade;
      }
      this.trailMesh.geometry.attributes.position.needsUpdate = true;
      this.trailMesh.geometry.attributes.color.needsUpdate = true;
      this.trailMesh.visible = true;
      return;
    }

    // Add a new segment every ~0.22m or 0.045s while moving
    this.trailSampleAccum += dt;
    const distMoved = pos.distanceTo(this.lastTrailPos);
    if (speed > 0.3 && (distMoved >= 0.22 || this.trailSampleAccum >= 0.05)) {
      this.trailSampleAccum = 0;
      this.lastTrailPos.copy(pos);

      const halfW = 0.095 + Math.abs(this.smoothLean) * 0.055;
      const lift = up.clone().multiplyScalar(0.025);
      const pL = pos.clone().addScaledVector(right, -halfW).add(lift);
      const pR = pos.clone().addScaledVector(right, halfW).add(lift);

      for (let i = this.maxTrailSegments - 1; i > 0; i--) {
        const dst = i * 6;
        const src = (i - 1) * 6;
        for (let c = 0; c < 6; c++) {
          this.trailPositions[dst + c] = this.trailPositions[src + c];
        }
      }

      this.trailPositions[0] = pL.x;
      this.trailPositions[1] = pL.y;
      this.trailPositions[2] = pL.z;
      this.trailPositions[3] = pR.x;
      this.trailPositions[4] = pR.y;
      this.trailPositions[5] = pR.z;

      for (let i = 0; i < this.maxTrailSegments; i++) {
        const fade = Math.pow(1.0 - i / (this.maxTrailSegments - 1), 1.4);
        const idx = i * 6;
        this.trailColors[idx] = 0.0;
        this.trailColors[idx + 1] = 0.96 * fade;
        this.trailColors[idx + 2] = 0.88 * fade;
        this.trailColors[idx + 3] = 0.0;
        this.trailColors[idx + 4] = 0.96 * fade;
        this.trailColors[idx + 5] = 0.88 * fade;
      }

      this.trailMesh.geometry.attributes.position.needsUpdate = true;
      this.trailMesh.geometry.attributes.color.needsUpdate = true;
    }

    this.trailMesh.visible = true;
  }

  public resetTrail(): void {
    this.trailInitialized = false;
    this.trailSampleAccum = 0;
    this.smoothLean = 0;
    this.smoothCompression = 0.35;
    this.trailMesh.visible = false;
  }

  private disposeObjectResources(root: THREE.Object3D): void {
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          std.normalMap?.dispose();
          std.roughnessMap?.dispose();
          std.dispose();
        }
      }
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.resetTrail();

    this.root.removeFromParent();
    this.trailMesh.removeFromParent();

    for (const geo of this.trackedGeometries) {
      geo.dispose();
    }
    this.trackedGeometries = [];

    for (const mat of this.trackedMaterials) {
      mat.dispose();
    }
    this.trackedMaterials = [];

    for (const tex of this.trackedTextures) {
      tex.dispose();
    }
    this.trackedTextures = [];

    if (this.labelSprite.material) {
      this.labelSprite.material.map?.dispose();
      this.labelSprite.material.dispose();
    }

    this.bones = {};
    this.restQuat.clear();
    this.restPos.clear();
    this.wheels = [];
    this.modelRoot = null;
  }
}
