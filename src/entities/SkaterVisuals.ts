import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SurfskateController } from '../physics/SurfskateController';
import { resolveAssetUrl } from '../utils/assetUrl';
import {
  getBoardById,
  getSelectedBoardId,
  SurfBoardId,
  SurfBoardSpec,
} from '../config/SurfBoards';

type Side = 'Left' | 'Right';

// Board-local frame (glTF / three.js): +Z = nose, -X = the skater's facing (toe-side) edge, +Y = up.
const DECK_TOP = 0.162;
/** Default height of the ankle joint above the sole (re-measured from the model on load). */
const DEFAULT_ANKLE_HEIGHT = 0.126;
/** Regular stance foot positions on the deck (x across, z along the board; y set on load). */
const ANKLE_XZ: Record<Side, [number, number]> = {
  Left: [0.07, 0.17], // front foot toward the nose
  Right: [0.07, -0.21], // back foot over the tail
};
/** Toe angle of each foot (radians about the deck's up axis, + = toes toward the nose). */
const TOE_YAW: Record<Side, number> = { Left: 0.32, Right: 0.06 };
/** Default pelvis height above the board origin in the rest pose (re-measured on load). */
const DEFAULT_HIPS_REST_HEIGHT = 1.183;

/**
 * Logical bone names used by the posing code -> accepted names in the GLB.
 * Supports the MakeHuman/MPFB "game_engine" rig (CC0 skater) and Mixamo-style rigs.
 */
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

interface HairWindUniforms {
  uHairWind: THREE.IUniform<THREE.Vector3>;
  uHairTurnInertia: THREE.IUniform<THREE.Vector3>;
  uHairFlutter: THREE.IUniform<number>;
  uHairTime: THREE.IUniform<number>;
}

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class SkaterVisuals {
  public root = new THREE.Group();
  private modelRoot: THREE.Object3D | null = null;

  // Named rig nodes from `public/models/skater.glb`
  private boardGroup: THREE.Object3D | null = null;
  private deckMesh: THREE.Object3D | null = null;
  private frontTruckPivot: THREE.Object3D | null = null;
  private rearTruckPivot: THREE.Object3D | null = null;
  private wheels: THREE.Object3D[] = [];
  private baseFrontTruckZ = 0.25;
  private baseRearTruckZ = -0.25;

  // Custom unlockable board visuals & GPU resource caches
  private activeBoardSpec: SurfBoardSpec = getBoardById(getSelectedBoardId());
  private deckTextureCache = new Map<SurfBoardId, THREE.CanvasTexture>();
  private deckMaterialCache = new Map<SurfBoardId, THREE.MeshStandardMaterial>();
  private wheelMaterialClones: THREE.MeshStandardMaterial[] = [];
  private activeWheelMat: THREE.MeshStandardMaterial | null = null;

  // Skeleton of the rigged human (Mixamo-style bone names)
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
  private rightFingerBones: THREE.Bone[] = [];
  private footRestInDeck: Record<Side, THREE.Quaternion> = {
    Left: new THREE.Quaternion(),
    Right: new THREE.Quaternion(),
  };
  private hasSkeleton = false;
  private hipsRestHeight = DEFAULT_HIPS_REST_HEIGHT;
  private ankleTargets: Record<Side, THREE.Vector3> = {
    Left: new THREE.Vector3(ANKLE_XZ.Left[0], DECK_TOP + DEFAULT_ANKLE_HEIGHT, ANKLE_XZ.Left[1]),
    Right: new THREE.Vector3(ANKLE_XZ.Right[0], DECK_TOP + DEFAULT_ANKLE_HEIGHT, ANKLE_XZ.Right[1]),
  };
  private smoothCompression = 0.15;
  private smoothLean = 0;

  // Dynamic hair wind, flutter & inertia simulation (female skater Sophie)
  private hairUniforms: HairWindUniforms | null = null;
  private hairElapsed = 0;
  private smoothedHairWind = new THREE.Vector3(0, 0, 0);
  private smoothedHairInertia = new THREE.Vector3(0, 0, 0);

  // Particle system for Lip Slash / Bert Slide urethane spray & coping grind sparks
  public particleMesh: THREE.Points;
  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleColors: Float32Array;
  private particleLife: Float32Array;
  private particleMaxLife: Float32Array;
  private particleBaseSize: Float32Array;
  private particleSize: Float32Array;
  private particleAlpha: Float32Array;
  private particleBaseAlpha: Float32Array;
  /** 0 = spray droplet, 1 = mist puff, 2 = coping spark */
  private particleKind: Uint8Array;
  private nextParticleIdx = 0;
  private readonly maxParticles = 700;
  private prevSpray = 0;

  // Dual urethane wheel carve ribbon trail on the concrete
  public trailMesh: THREE.Mesh;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private readonly maxTrailSegments = 90;
  private trailHead = 0;

  // Soft contact ambient-occlusion shadow directly beneath the surfskate deck
  private contactShadowMesh: THREE.Mesh;
  private currentQuality: 'high' | 'medium' | 'low' = 'high';

  public setQuality(quality: 'high' | 'medium' | 'low'): void {
    this.currentQuality = quality;
    if (quality === 'low') {
      this.trailMesh.visible = false;
    } else {
      this.trailMesh.visible = true;
    }
  }

  constructor(scene: THREE.Scene) {
    scene.add(this.root);

    // Build soft contact shadow decal under the board
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 256;
    const sCtx = shadowCanvas.getContext('2d')!;
    const grad = sCtx.createRadialGradient(64, 128, 8, 64, 128, 62);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 128, 256);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);

    const shadowGeo = new THREE.PlaneGeometry(0.46, 0.98);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.contactShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadowMesh.position.y = 0.012;
    this.root.add(this.contactShadowMesh);

    // Initialize spray, mist & spark particle system: soft glowing sprites (custom shader)
    const n = this.maxParticles;
    this.particlePositions = new Float32Array(n * 3).fill(-999);
    this.particleVelocities = new Float32Array(n * 3);
    this.particleColors = new Float32Array(n * 3);
    this.particleLife = new Float32Array(n);
    this.particleMaxLife = new Float32Array(n).fill(1);
    this.particleBaseSize = new Float32Array(n);
    this.particleSize = new Float32Array(n);
    this.particleAlpha = new Float32Array(n);
    this.particleBaseAlpha = new Float32Array(n);
    this.particleKind = new Uint8Array(n);

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(this.particleSize, 1));
    pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.particleAlpha, 1));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 620 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0 || vAlpha <= 0.001) discard;
          float soft = 1.0 - smoothstep(0.0, 1.0, d);
          float core = pow(soft, 5.0);
          vec3 col = mix(vColor, vec3(1.0, 0.9, 0.7), core * 0.5);
          gl_FragColor = vec4(col, pow(soft, 1.6) * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particleMesh = new THREE.Points(pGeo, pMat);
    this.particleMesh.frustumCulled = false;
    scene.add(this.particleMesh);

    // Initialize urethane carve line ribbon with vertex colors for thanelines & overdrive shimmer
    this.trailPositions = new Float32Array(this.maxTrailSegments * 2 * 3);
    this.trailColors = new Float32Array(this.maxTrailSegments * 2 * 3);
    for (let i = 0; i < this.maxTrailSegments * 2; i++) {
      this.trailColors[i * 3] = 0.11;
      this.trailColors[i * 3 + 1] = 0.12;
      this.trailColors[i * 3 + 2] = 0.14;
    }
    const tGeo = new THREE.BufferGeometry();
    const indices: number[] = [];
    for (let i = 0; i < this.maxTrailSegments - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    tGeo.setIndex(indices);
    tGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    const tMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.trailMesh = new THREE.Mesh(tGeo, tMat);
    this.trailMesh.frustumCulled = false;
    scene.add(this.trailMesh);
  }

  public async load(modelUrl = 'models/skater.glb'): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(resolveAssetUrl(modelUrl));

    if (this.modelRoot) {
      this.root.remove(this.modelRoot);
    }
    for (const wm of this.wheelMaterialClones) {
      wm.dispose();
    }
    this.wheelMaterialClones = [];
    this.activeWheelMat = null;
    this.modelRoot = gltf.scene;
    this.bones = {};
    this.restQuat.clear();
    this.restPos.clear();
    this.wheels = [];
    this.boardGroup = null;
    this.deckMesh = null;
    this.frontTruckPivot = null;
    this.rearTruckPivot = null;
    this.hasSkeleton = false;
    this.hairUniforms = null;

    const prevPos = this.root.position.clone();
    const prevRot = this.root.rotation.clone();
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);

    this.modelRoot.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Skinned meshes deform far from their bind-pose bounds; never cull them
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
        if (mesh.name.includes('long01') && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          if (!this.hairUniforms) {
            this.hairUniforms = {
              uHairWind: { value: new THREE.Vector3(0, 0, 0) },
              uHairTurnInertia: { value: new THREE.Vector3(0, 0, 0) },
              uHairFlutter: { value: 0 },
              uHairTime: { value: 0 },
            };
          }
          for (const rawMat of mats) {
            const mat = rawMat as THREE.MeshStandardMaterial;
            mat.alphaTest = 0.18;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            this.attachHairWindShader(mat, this.hairUniforms, 'SophieWindHair_standard');
            mat.needsUpdate = true;

            const depthMat = new THREE.MeshDepthMaterial({
              depthPacking: THREE.RGBADepthPacking,
              alphaTest: 0.18,
            });
            if (mat.map) depthMat.map = mat.map;
            this.attachHairWindShader(depthMat, this.hairUniforms, 'SophieWindHair_depth');
            mesh.customDepthMaterial = depthMat;
          }
        }
        if (mesh.name.includes('Basecap') || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => m?.name === 'SkaterBasecap')) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const rawMat of mats) {
            const mat = rawMat as THREE.MeshStandardMaterial;
            if (mat) {
              mat.color.setRGB(0.015, 0.015, 0.016);
              mat.roughness = 0.90;
              mat.needsUpdate = true;
            }
          }
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
      if (child.name === 'FrontTruckPivot') {
        this.frontTruckPivot = child;
        this.baseFrontTruckZ = child.position.z;
      }
      if (child.name === 'RearTruckPivot') {
        this.rearTruckPivot = child;
        this.baseRearTruckZ = child.position.z;
      }
      if (child.name.startsWith('FrontWheel_') || child.name.startsWith('RearWheel_')) {
        this.wheels.push(child);
      }
    });

    // Rotate the skater and skateboard 180 degrees so the nose and front foot face forward
    this.modelRoot.rotation.y = Math.PI;
    this.root.add(this.modelRoot);

    // Map the rig's bone names onto the logical names used by the posing code
    const allBones = { ...this.bones };
    for (const [logical, candidates] of Object.entries(BONE_ALIASES)) {
      const found = candidates.map((n) => allBones[n]).find((bone) => !!bone);
      if (found) this.bones[logical] = found;
    }

    // Measure the rig in its rest pose
    const required = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
      'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
    this.hasSkeleton = required.every((n) => !!this.bones[n]) && !!this.deckMesh && !!this.boardGroup;
    if (this.hasSkeleton) {
      this.root.updateMatrixWorld(true);
      const deckQ = this.deckMesh!.getWorldQuaternion(new THREE.Quaternion());
      // Rest-pose heights above the board (the model stands on the deck in its rest pose)
      const boardInv = this.boardGroup!.matrixWorld.clone().invert();
      const hipsLocal = this.worldPos(this.bones.Hips).applyMatrix4(boardInv);
      this.hipsRestHeight = hipsLocal.y;
      for (const side of ['Left', 'Right'] as Side[]) {
        const ankleLocal = this.worldPos(this.bones[`${side}Foot`]).applyMatrix4(boardInv);
        const ankleHeight = THREE.MathUtils.clamp(ankleLocal.y - DECK_TOP, 0.04, 0.2);
        this.ankleTargets[side].set(ANKLE_XZ[side][0], DECK_TOP + ankleHeight, ANKLE_XZ[side][1]);
      }
      for (const side of ['Left', 'Right'] as Side[]) {
        const hip = this.worldPos(this.bones[`${side}UpLeg`]);
        const knee = this.worldPos(this.bones[`${side}Leg`]);
        const ankle = this.worldPos(this.bones[`${side}Foot`]);
        this.legLengths[side] = { upper: hip.distanceTo(knee), lower: knee.distanceTo(ankle) };
        const footQ = this.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion());
        this.footRestInDeck[side] = deckQ.clone().invert().multiply(footQ);
      }
      for (const side of ['Left', 'Right'] as Side[]) {
        const shoulder = this.worldPos(this.bones[`${side}Arm`]);
        const elbow = this.worldPos(this.bones[`${side}ForeArm`]);
        const wrist = this.worldPos(this.bones[`${side}Hand`]);
        this.armLengths[side] = { upper: shoulder.distanceTo(elbow), lower: elbow.distanceTo(wrist) };
      }
      this.rightFingerBones = [];
      this.bones.RightHand.traverse((child) => {
        if (child !== this.bones.RightHand && (child as THREE.Bone).isBone) {
          this.rightFingerBones.push(child as THREE.Bone);
        }
      });
    }

    // Prepare clean Top / Rail / Bottom UVs on DeckMesh & share a cloned urethane material across wheels
    this.prepareDeckAndWheelMaterials();

    // Attach authentic surfskate trucks physically connecting deck to wheels
    this.attachRealisticSurfskateTrucks();

    // Re-apply active board texture, scale, wheel color & metallic finish across skater reloads
    this.applyBoardVisuals();

    this.root.position.copy(prevPos);
    this.root.rotation.copy(prevRot);
  }

  public setBoardSpec(board: SurfBoardSpec): void {
    this.activeBoardSpec = board;
    this.applyBoardVisuals();
  }

  public dispose(): void {
    for (const tex of this.deckTextureCache.values()) {
      tex.dispose();
    }
    this.deckTextureCache.clear();
    for (const mat of this.deckMaterialCache.values()) {
      mat.dispose();
    }
    this.deckMaterialCache.clear();
    for (const wm of this.wheelMaterialClones) {
      wm.dispose();
    }
    this.wheelMaterialClones = [];
    this.activeWheelMat = null;
  }

  private prepareDeckAndWheelMaterials(): void {
    if (this.deckMesh && (this.deckMesh as THREE.Mesh).isMesh) {
      const mesh = this.deckMesh as THREE.Mesh;
      const srcGeo = mesh.geometry;
      if (srcGeo) {
        const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
        srcGeo.dispose();
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const halfW = Math.max(0.05, Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)));
        const minZ = bb.min.z;
        const lenZ = Math.max(0.1, bb.max.z - minZ);
        const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
        const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
        const uvArray = new Float32Array(posAttr.count * 2);

        for (let i = 0; i < posAttr.count; i += 3) {
          const avgNy =
            (normAttr.getY(i) + normAttr.getY(i + 1) + normAttr.getY(i + 2)) / 3;
          const isTop = avgNy > 0.22;
          const isBottom = avgNy < -0.22;

          for (let k = 0; k < 3; k++) {
            const idx = i + k;
            const px = posAttr.getX(idx);
            const pz = posAttr.getZ(idx);
            const v = THREE.MathUtils.clamp(((pz - minZ) / lenZ) * 0.94 + 0.03, 0.01, 0.99);
            let u: number;
            if (isTop) {
              u = THREE.MathUtils.clamp(0.24 + (px / halfW) * 0.21, 0.02, 0.46);
            } else if (isBottom) {
              u = THREE.MathUtils.clamp(0.76 + (px / halfW) * 0.21, 0.54, 0.98);
            } else {
              // Rail ply veneer strip [0.484 .. 0.516]
              const edgeFactor = THREE.MathUtils.clamp(Math.abs(normAttr.getX(idx)), 0, 1);
              u = 0.485 + edgeFactor * 0.03;
            }
            uvArray[idx * 2] = u;
            uvArray[idx * 2 + 1] = v;
          }
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
        mesh.geometry = geo;
      }
    }

    if (this.wheels.length > 0) {
      let sharedMat: THREE.MeshStandardMaterial | null = null;
      for (const wheelObj of this.wheels) {
        wheelObj.traverse((node) => {
          if ((node as THREE.Mesh).isMesh) {
            const wMesh = node as THREE.Mesh;
            if (!sharedMat) {
              const raw = Array.isArray(wMesh.material) ? wMesh.material[0] : wMesh.material;
              if (raw && (raw as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                sharedMat = (raw as THREE.MeshStandardMaterial).clone();
              } else {
                sharedMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.0 });
              }
              this.wheelMaterialClones.push(sharedMat);
            }
            wMesh.material = sharedMat;
          }
        });
      }
      this.activeWheelMat = sharedMat;
    }
  }

  private getDeckMaterial(spec: SurfBoardSpec): THREE.MeshStandardMaterial {
    const cached = this.deckMaterialCache.get(spec.id);
    if (cached) return cached;

    let tex = this.deckTextureCache.get(spec.id);
    if (!tex) {
      tex = this.createBoardDeckTexture(spec);
      this.deckTextureCache.set(spec.id, tex);
    }

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      side: THREE.DoubleSide,
      metalness: spec.metallic ? 0.54 : 0.04,
      roughness: spec.metallic ? 0.28 : 0.58,
      emissive: spec.metallic ? new THREE.Color('#3b2600') : new THREE.Color(0x000000),
      emissiveIntensity: spec.metallic ? 0.14 : 0.0,
    });
    this.deckMaterialCache.set(spec.id, mat);
    return mat;
  }

  private applyBoardVisuals(): void {
    const spec = this.activeBoardSpec;

    if (this.deckMesh) {
      this.deckMesh.scale.set(spec.deckScale.x, 1.0, spec.deckScale.z);
      if ((this.deckMesh as THREE.Mesh).isMesh) {
        (this.deckMesh as THREE.Mesh).material = this.getDeckMaterial(spec);
      }
    }

    if (this.frontTruckPivot) {
      this.frontTruckPivot.position.z = this.baseFrontTruckZ * spec.deckScale.z;
    }
    if (this.rearTruckPivot) {
      this.rearTruckPivot.position.z = this.baseRearTruckZ * spec.deckScale.z;
    }

    if (this.activeWheelMat) {
      this.activeWheelMat.color.set(spec.wheelColor);
      this.activeWheelMat.roughness = 0.34;
      if (spec.goldTrail) {
        this.activeWheelMat.emissive.set('#ffb800');
        this.activeWheelMat.emissiveIntensity = 0.32;
      } else {
        this.activeWheelMat.emissive.setRGB(0, 0, 0);
        this.activeWheelMat.emissiveIntensity = 0;
      }
      this.activeWheelMat.needsUpdate = true;
    }
  }

  private createBoardDeckTexture(spec: SurfBoardSpec): THREE.CanvasTexture {
    const W = 1024;
    const H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // -----------------------------------------------------------------------
    // 1. LEFT HALF [0..491]: TOP DECK (Wood/Metallic Rim + Textured Griptape)
    // -----------------------------------------------------------------------
    const topCx = 245;
    const topBaseColors: Record<SurfBoardId, [string, string]> = {
      the_spiral: ['#e6b67e', '#b97a3e'],
      isar_swallowtail: ['#7de8dc', '#0e9087'],
      sunset_cruiser: ['#f9a86b', '#b92b6c'],
      golden_pretzel: ['#ffe484', '#b88214'],
    };
    const [topLight, topDark] = topBaseColors[spec.id];
    const topGrad = ctx.createLinearGradient(0, 0, 491, H);
    topGrad.addColorStop(0, topLight);
    topGrad.addColorStop(0.5, topDark);
    topGrad.addColorStop(1, topLight);
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, 491, H);

    // Subtle longitudinal wood / brushed sheen lines on top base
    ctx.strokeStyle = spec.metallic ? 'rgba(255, 250, 220, 0.24)' : 'rgba(60, 28, 8, 0.14)';
    ctx.lineWidth = 2;
    for (let x = 18; x < 480; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + Math.sin(x * 0.13) * 6, H);
      ctx.stroke();
    }

    // Center racing reveal graphic underneath the die-cut griptape
    if (spec.id === 'the_spiral') {
      ctx.fillStyle = '#ff6b1a';
      ctx.fillRect(topCx - 20, 0, 40, H);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(topCx - 6, 0, 12, H);
    } else if (spec.id === 'isar_swallowtail') {
      ctx.fillStyle = '#00e5d4';
      ctx.fillRect(topCx - 28, 0, 56, H);
      ctx.fillStyle = '#ecfeff';
      ctx.fillRect(topCx - 8, 0, 16, H);
    } else if (spec.id === 'sunset_cruiser') {
      const sGrad = ctx.createLinearGradient(topCx - 36, 0, topCx + 36, 0);
      sGrad.addColorStop(0, '#ff3d8a');
      sGrad.addColorStop(0.5, '#ffd54a');
      sGrad.addColorStop(1, '#ff6b1a');
      ctx.fillStyle = sGrad;
      ctx.fillRect(topCx - 34, 0, 68, H);
    } else {
      // Golden Pretzel: rich brushed champagne-gold center & dark pretzel mark near nose
      const gGrad = ctx.createLinearGradient(80, 0, 410, 0);
      gGrad.addColorStop(0, '#c78c18');
      gGrad.addColorStop(0.5, '#fff1a6');
      gGrad.addColorStop(1, '#c78c18');
      ctx.fillStyle = gGrad;
      ctx.fillRect(40, 0, 410, H);
    }

    // Matte black griptape inset (leaving clean deck rim + nose/tail graphic windows)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(36, 38, 418, H - 76, 95);
    ctx.clip();

    ctx.fillStyle = '#18181b';
    ctx.fillRect(36, 38, 418, H - 76);

    // Grip speckles
    for (let i = 0; i < 3600; i++) {
      const sx = 36 + ((i * 197) % 418);
      const sy = 38 + ((i * 523) % (H - 76));
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.35)';
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Die-cut griptape windows at nose & tail so board personality pops from top camera!
    ctx.globalCompositeOperation = 'destination-out';
    if (spec.id === 'the_spiral') {
      // Curved diagonal wood/orange racing stripe gap near nose & tail
      ctx.beginPath();
      ctx.moveTo(topCx - 55, 86);
      ctx.lineTo(topCx + 55, 118);
      ctx.lineTo(topCx + 55, 146);
      ctx.lineTo(topCx - 55, 114);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(topCx - 55, H - 146);
      ctx.lineTo(topCx + 55, H - 114);
      ctx.lineTo(topCx + 55, H - 86);
      ctx.lineTo(topCx - 55, H - 118);
      ctx.closePath();
      ctx.fill();
    } else if (spec.id === 'isar_swallowtail') {
      // Aqua swallowtail chevron cutouts
      ctx.beginPath();
      ctx.moveTo(topCx - 90, 92);
      ctx.lineTo(topCx, 140);
      ctx.lineTo(topCx + 90, 92);
      ctx.lineTo(topCx + 90, 122);
      ctx.lineTo(topCx, 170);
      ctx.lineTo(topCx - 90, 122);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(topCx - 85, H - 90);
      ctx.lineTo(topCx, H - 148);
      ctx.lineTo(topCx + 85, H - 90);
      ctx.lineTo(topCx + 85, H - 62);
      ctx.lineTo(topCx, H - 118);
      ctx.lineTo(topCx - 85, H - 62);
      ctx.closePath();
      ctx.fill();
    } else if (spec.id === 'sunset_cruiser') {
      // Miami sunset centerline racing stripe cutout
      ctx.fillRect(topCx - 22, 40, 44, 130);
      ctx.fillRect(topCx - 22, H - 170, 44, 130);
    } else {
      // Golden Pretzel: exposed gold nose, tail & center emblem window
      ctx.fillRect(0, 0, 491, 148);
      ctx.fillRect(0, H - 148, 491, 148);
      ctx.beginPath();
      ctx.arc(topCx, H * 0.5, 68, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Redraw clean top background underneath transparent destination-out cutouts
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, 491, H);
    ctx.restore();

    // For Golden Pretzel top, stamp crisp dark pretzel crest in the center window
    if (spec.id === 'golden_pretzel') {
      this.drawPretzelCrest(ctx, topCx, H * 0.5, 48, '#17130d', '#ffd54a');
      this.drawPretzelCrest(ctx, topCx, 95, 26, '#17130d', '#ffd54a');
    }

    // 8 Truck Mounting Bolts on Top Deck (front y ≈ 224, rear y ≈ 794)
    const boltColor = spec.wheelColor;
    for (const by of [224, 794]) {
      for (const dx of [-36, 36]) {
        for (const dy of [-32, 32]) {
          ctx.beginPath();
          ctx.arc(topCx + dx, by + dy, 6.5, 0, Math.PI * 2);
          ctx.fillStyle = '#09090b';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(topCx + dx, by + dy, 4.2, 0, Math.PI * 2);
          ctx.fillStyle = boltColor;
          ctx.fill();
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. CENTER STRIP [491..533]: 7-PLY RAIL VENEER
    // -----------------------------------------------------------------------
    const plyColors = spec.metallic
      ? ['#92610d', '#ffd54a', '#1c1917', '#ffe885', '#1c1917', '#ffd54a', '#92610d']
      : ['#e8c391', '#9c632b', '#e8c391', spec.wheelColor, '#e8c391', '#9c632b', '#e8c391'];
    const plyW = 42 / plyColors.length;
    for (let p = 0; p < plyColors.length; p++) {
      ctx.fillStyle = plyColors[p];
      ctx.fillRect(491 + p * plyW, 0, plyW + 1, H);
    }

    // -----------------------------------------------------------------------
    // 3. RIGHT HALF [533..1024]: BOTTOM DECK GRAPHIC
    // -----------------------------------------------------------------------
    const botX = 533;
    const botW = W - botX;
    const botCx = botX + botW * 0.5;

    if (spec.id === 'the_spiral') {
      // Warm roasted maple wood deck + bold sunset-orange hypnotic spiral
      const bg = ctx.createLinearGradient(botX, 0, W, H);
      bg.addColorStop(0, '#e0aa6d');
      bg.addColorStop(0.5, '#c58040');
      bg.addColorStop(1, '#9d5b24');
      ctx.fillStyle = bg;
      ctx.fillRect(botX, 0, botW, H);

      ctx.strokeStyle = 'rgba(72, 34, 10, 0.16)';
      ctx.lineWidth = 3;
      for (let x = botX + 16; x < W; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(x * 0.11) * 10, H);
        ctx.stroke();
      }

      // Center stringer stripe
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(botCx - 14, 0, 28, H);
      ctx.fillStyle = '#ff6b1a';
      ctx.fillRect(botCx - 6, 0, 12, H);

      // Hypnotic Spiral Medallion
      ctx.save();
      ctx.translate(botCx, H * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 155, 0, Math.PI * 2);
      ctx.fillStyle = '#181411';
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#ff6b1a';
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 7.2; a += 0.12) {
        const r = 6 + a * 6.2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fef3c7';
      ctx.beginPath();
      for (let a = 0.35; a < Math.PI * 6.8; a += 0.12) {
        const r = 4 + a * 6.0;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (a === 0.35) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    } else if (spec.id === 'isar_swallowtail') {
      // Vintage bone-cream & retro turquoise-aqua surf stripes + Isar wave crest
      ctx.fillStyle = '#ecfeff';
      ctx.fillRect(botX, 0, botW, H);

      const tGrad = ctx.createLinearGradient(botX, 0, W, H);
      tGrad.addColorStop(0, '#00e5d4');
      tGrad.addColorStop(0.55, '#0891b2');
      tGrad.addColorStop(1, '#0f766e');
      ctx.fillStyle = tGrad;
      ctx.fillRect(botX, 240, botW, 540);

      // Diagonal surf stripes
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.moveTo(botX, 200);
      ctx.lineTo(W, 330);
      ctx.lineTo(W, 372);
      ctx.lineTo(botX, 242);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(botX, 680);
      ctx.lineTo(W, 550);
      ctx.lineTo(W, 588);
      ctx.lineTo(botX, 718);
      ctx.closePath();
      ctx.fill();

      // Stylized Isar wave circle crest
      ctx.save();
      ctx.translate(botCx, H * 0.47);
      ctx.beginPath();
      ctx.arc(0, 0, 128, 0, Math.PI * 2);
      ctx.fillStyle = '#083344';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#99f6e4';
      ctx.stroke();
      // 3 crisp surf waves inside medallion
      for (let w = -1; w <= 1; w++) {
        ctx.beginPath();
        const wy = w * 32;
        ctx.moveTo(-95, wy + 12);
        ctx.quadraticCurveTo(-40, wy - 28, 0, wy + 6);
        ctx.quadraticCurveTo(40, wy + 34, 95, wy - 10);
        ctx.strokeStyle = w === 0 ? '#00e5d4' : '#ecfeff';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();

      // Swallowtail V-notch emblem near tail
      ctx.fillStyle = '#083344';
      ctx.beginPath();
      ctx.moveTo(botCx - 110, H - 150);
      ctx.lineTo(botCx, H - 40);
      ctx.lineTo(botCx + 110, H - 150);
      ctx.lineTo(botCx + 110, H);
      ctx.lineTo(botCx - 110, H);
      ctx.closePath();
      ctx.fill();
    } else if (spec.id === 'sunset_cruiser') {
      // Miami Sunset gradient + retro slatted sun + pintail stripes
      const mGrad = ctx.createLinearGradient(botX, 0, botX, H);
      mGrad.addColorStop(0, '#2e1065');
      mGrad.addColorStop(0.32, '#831843');
      mGrad.addColorStop(0.62, '#ff3d8a');
      mGrad.addColorStop(0.85, '#ff7b1c');
      mGrad.addColorStop(1, '#ffd54a');
      ctx.fillStyle = mGrad;
      ctx.fillRect(botX, 0, botW, H);

      // Center pintail speed lines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(botCx - 56, 0, 12, H);
      ctx.fillRect(botCx + 44, 0, 12, H);

      // Retro Miami Sun Disc with scanline cuts
      ctx.save();
      ctx.translate(botCx, H * 0.45);
      const sunGrad = ctx.createLinearGradient(0, -130, 0, 130);
      sunGrad.addColorStop(0, '#fef08a');
      sunGrad.addColorStop(0.5, '#ff7b1c');
      sunGrad.addColorStop(1, '#ff3d8a');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 132, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b0764';
      for (const barY of [18, 44, 68, 90, 110]) {
        ctx.fillRect(-140, barY, 280, 11);
      }
      ctx.restore();

      // Twin sunset chevrons toward tail
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 10;
      for (const cy of [730, 790, 850]) {
        ctx.beginPath();
        ctx.moveTo(botCx - 105, cy - 35);
        ctx.lineTo(botCx, cy + 15);
        ctx.lineTo(botCx + 105, cy - 35);
        ctx.stroke();
      }
    } else {
      // GOLDEN PRETZEL PRO: brushed gold metallic base + dark obsidian pretzel crest emblem
      const gBg = ctx.createLinearGradient(botX, 0, W, H);
      gBg.addColorStop(0, '#fde047');
      gBg.addColorStop(0.28, '#f59e0b');
      gBg.addColorStop(0.55, '#fef08a');
      gBg.addColorStop(0.82, '#d97706');
      gBg.addColorStop(1, '#fde047');
      ctx.fillStyle = gBg;
      ctx.fillRect(botX, 0, botW, H);

      // Brushed metal horizontal micro-strokes
      for (let y = 0; y < H; y += 4) {
        ctx.fillStyle =
          y % 8 === 0 ? 'rgba(255, 255, 255, 0.14)' : 'rgba(120, 53, 15, 0.08)';
        ctx.fillRect(botX, y, botW, 2);
      }

      // Dark obsidian pinstripe frame
      ctx.strokeStyle = '#17130d';
      ctx.lineWidth = 12;
      ctx.strokeRect(botX + 34, 48, botW - 68, H - 96);
      ctx.strokeStyle = '#fef9c3';
      ctx.lineWidth = 4;
      ctx.strokeRect(botX + 48, 62, botW - 96, H - 124);

      // Center Shield Medallion & Bavarian Pretzel Crest
      ctx.save();
      ctx.translate(botCx, H * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 144, 0, Math.PI * 2);
      ctx.fillStyle = '#17130d';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffd54a';
      ctx.stroke();
      ctx.restore();

      this.drawPretzelCrest(ctx, botCx, H * 0.5, 96, '#ffd54a', '#17130d');

      // PRO banner pills nose & tail
      ctx.fillStyle = '#17130d';
      ctx.fillRect(botCx - 110, 128, 220, 44);
      ctx.fillRect(botCx - 110, H - 172, 220, 44);
      ctx.fillStyle = '#ffd54a';
      ctx.font = '900 24px Impact, Arial Black, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PRETZEL PRO', botCx, 150);
      ctx.fillText('LIMITED EDITION', botCx, H - 150);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  private drawPretzelCrest(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    strokeColor: string,
    innerHoleColor: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    const s = radius / 100;
    ctx.scale(s, s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer loop of classic Bavarian pretzel
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(0, 72);
    ctx.bezierCurveTo(-92, 72, -108, -20, -56, -64);
    ctx.bezierCurveTo(-18, -96, 18, -42, 42, 16);
    ctx.bezierCurveTo(60, 58, 86, 52, 92, 10);
    ctx.bezierCurveTo(98, -32, 62, -78, 22, -68);
    ctx.bezierCurveTo(-12, -58, -28, -2, -46, 26);
    ctx.bezierCurveTo(-68, 58, -42, 74, 0, 72);
    ctx.stroke();

    // Inner twist highlight / core definition
    ctx.strokeStyle = innerHoleColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-24, -18);
    ctx.lineTo(24, 18);
    ctx.moveTo(24, -18);
    ctx.lineTo(-24, 18);
    ctx.stroke();

    // Salt crystals on pretzel
    ctx.fillStyle = '#fefce8';
    for (const [sx, sy] of [
      [-62, -26],
      [62, -28],
      [-52, 46],
      [54, 44],
      [0, -48],
    ]) {
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Skeleton helpers (all axis-agnostic: rotations are applied in world space)
  // ---------------------------------------------------------------------------
  private worldPos(obj: THREE.Object3D): THREE.Vector3 {
    return obj.getWorldPosition(new THREE.Vector3());
  }

  /** Board-local direction -> world direction. */
  private boardDir(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).normalize().transformDirection(this.boardGroup!.matrixWorld);
  }

  /** ModelRoot-local direction -> world direction (unaffected by detached board motion). */
  private modelDir(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).normalize().transformDirection(this.modelRoot!.matrixWorld);
  }

  /** Pre-multiply a world-space rotation onto a bone, keeping its parent untouched. */
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

  /** Rotate `bone` so that the direction toward `child` becomes `dirWorld`. */
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

  /** Analytic two-bone IK: hip -> knee -> ankle reaching `target`, knee bending toward `poleDir`. */
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

  /** Analytic two-bone IK: shoulder -> elbow -> wrist/hand reaching `target`, elbow bending toward `poleDir`. */
  private solveArm(side: Side, target: THREE.Vector3, poleDir: THREE.Vector3): void {
    const arm = this.bones[`${side}Arm`];
    const foreArm = this.bones[`${side}ForeArm`];
    const hand = this.bones[`${side}Hand`];
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

  /** Pose the whole skeleton for the current riding state. */
  private poseSkeleton(ctrl: SurfskateController, dt: number): void {
    const b = this.bones;
    const board = this.boardGroup!;
    const deck = this.deckMesh!;

    // Smooth the inputs a little so the body motion stays fluid
    const k = Math.min(1, dt * 14);
    this.smoothCompression += (ctrl.compression - this.smoothCompression) * k;
    if (!ctrl.isGrounded) {
      this.smoothLean = 0;
    } else {
      this.smoothLean += (ctrl.leanAngle - this.smoothLean) * k;
    }
    const crouch = this.smoothCompression;
    const lean = this.smoothLean;
    const lead = ctrl.upperBodyLeadYaw;
    const lay = ctrl.laybackAmount; // 0..1 layback body pose
    const bert = ctrl.bertSlideAmount; // 0..1 Bertleman slide body pose
    const indy = ctrl.indyGrabAmount; // 0..1 airborne Indy grab body pose
    const bSide = ctrl.bertSlideHandSide || 1; // +1 = toe-side (-X), -1 = heel-side (+X)
    const inX = -bSide; // board-local X sign pointing into the turn

    // 1. Reset to rest pose
    for (const bone of Object.values(b)) {
      bone.quaternion.copy(this.restQuat.get(bone)!);
      bone.position.copy(this.restPos.get(bone)!);
    }
    this.root.updateMatrixWorld(true);

    const boardX = this.boardDir(1, 0, 0); // heel-side (+X), toe-side (-X)
    const boardY = this.boardDir(0, 1, 0); // up
    const boardZ = this.boardDir(0, 0, 1); // nose
    const bodyLean = lean * 0.85; // whole body leans into the rail with the deck

    // Handle bailing / wipeout falling pose:
    // Skater's hips smoothly drop into a natural, athletic knee & palm slide on the concrete,
    // protecting the head, with natural forward knee flexion and trailing legs.
    if (ctrl.isBailing) {
      const p = 1.0 - Math.max(0, ctrl.bailTimer / ctrl.bailDuration);
      // Smooth fall curve: quick natural drop in first 0.22s, steady slide until 0.75s, smooth recovery
      const dropCurve = THREE.MathUtils.clamp(p / 0.22, 0, 1);
      const easeDrop = 1.0 - Math.pow(1.0 - dropCurve, 2);
      const recoverCurve = p > 0.75 ? Math.pow((p - 0.75) / 0.25, 2) : 0;
      const fallCurve = easeDrop * (1.0 - recoverCurve);

      // Model reference directions (stable root-relative frame, independent of sliding board)
      const modelX = this.modelDir(1, 0, 0);
      const modelY = this.modelDir(0, 1, 0);
      const modelZ = this.modelDir(0, 0, 1);

      // 1. Pelvis/Hips: drop smoothly into a low athletic knee/hip slide
      const hipsX = THREE.MathUtils.lerp(0.05, 0.14, fallCurve);
      const hipsY = THREE.MathUtils.lerp(this.hipsRestHeight - 0.1, 0.32, fallCurve);
      const hipsZ = THREE.MathUtils.lerp(-0.02, -0.14, fallCurve);

      const bailHips = new THREE.Vector3(hipsX, hipsY, hipsZ);
      const hipsWorld = this.modelRoot!.localToWorld(bailHips);
      b.Hips.position.copy(b.Hips.parent!.worldToLocal(hipsWorld));
      b.Hips.updateMatrixWorld(true);

      // 2. Torso & Head posture: forward waist bend over toes, slight tilt toward tail, head up looking forward
      this.rotateBoneAxis(b.Hips, modelY, 0.18 + 0.15 * fallCurve);
      this.rotateBoneAxis(b.Hips, modelZ, 0.36 * fallCurve);
      this.rotateBoneAxis(b.Hips, modelX, -0.24 * fallCurve);

      this.rotateBoneAxis(b.Spine, modelZ, 0.06 + 0.28 * fallCurve);
      this.rotateBoneAxis(b.Spine, modelX, -0.12 * fallCurve);

      this.rotateBoneAxis(b.Spine1, modelZ, 0.18 * fallCurve);
      this.rotateBoneAxis(b.Spine1, modelX, -0.10 * fallCurve);

      this.rotateBoneAxis(b.Spine2, modelY, 0.22 + 0.12 * fallCurve);

      this.rotateBoneAxis(b.Neck, modelZ, -0.28 * fallCurve);
      this.rotateBoneAxis(b.Neck, modelY, 0.28);

      this.rotateBoneAxis(b.Head, modelZ, -0.28 * fallCurve);
      this.rotateBoneAxis(b.Head, modelY, 0.28);

      // 3. Arms: brace naturally with hands protecting torso and knees
      const targetLArm = this.modelDir(-0.3, -0.62, 0.72).lerp(this.modelDir(-0.58, -0.64, 0.50), fallCurve);
      const targetLFore = this.modelDir(-0.45, -0.25, 0.85).lerp(this.modelDir(-0.74, -0.32, 0.58), fallCurve);
      this.aimBone(b.LeftArm, b.LeftForeArm, targetLArm);
      this.aimBone(b.LeftForeArm, b.LeftHand, targetLFore);

      const targetRArm = this.modelDir(-0.2, -0.82, -0.5).lerp(this.modelDir(-0.32, -0.86, -0.38), fallCurve);
      const targetRFore = this.modelDir(-0.5, -0.55, -0.45).lerp(this.modelDir(-0.56, -0.72, -0.40), fallCurve);
      this.aimBone(b.RightArm, b.RightForeArm, targetRArm);
      this.aimBone(b.RightForeArm, b.RightHand, targetRFore);

      // 4. Legs: knees bend naturally forward/toe-side (-X), feet stay cleanly uncrossed
      const lLegLocal = this.ankleTargets.Left.clone().lerp(new THREE.Vector3(-0.08, 0.11, 0.22), fallCurve);
      const rLegLocal = this.ankleTargets.Right.clone().lerp(new THREE.Vector3(0.06, 0.10, -0.34), fallCurve);
      const lLegTarget = this.modelRoot!.localToWorld(lLegLocal);
      const rLegTarget = this.modelRoot!.localToWorld(rLegLocal);

      const lKneePole = this.modelDir(-0.92, 0.25, 0.32);
      const rKneePole = this.modelDir(-0.92, 0.18, -0.22);
      this.solveLeg('Left', lLegTarget, lKneePole);
      this.solveLeg('Right', rLegTarget, rKneePole);

      // 5. Feet: maintain clean anatomical alignment with skater's body
      const modelQ = this.modelRoot!.getWorldQuaternion(new THREE.Quaternion());
      for (const side of ['Left', 'Right'] as Side[]) {
        const yaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, TOE_YAW[side]);
        this.setBoneWorldQuat(
          b[`${side}Foot`],
          modelQ.clone().multiply(yaw).multiply(this.footRestInDeck[side])
        );
      }
      return;
    }

    // 2. Pelvis: lowered by knee bend, centred between the feet, rolled into the carve.
    //    During a Bertslide (`bert`), drop the hips low and sling them toward the tail (-Z) and inside rail.
    //    During an Indy grab (`indy`), tuck hips low toward the deck so knees compress tightly to chest.
    const hipsLocal = new THREE.Vector3(
      0.05 + crouch * 0.06 + lay * 0.12,
      this.hipsRestHeight - 0.1 - crouch * 0.3 - lay * 0.12,
      -0.02
    );
    hipsLocal.y -= DECK_TOP;
    hipsLocal.applyAxisAngle(AXIS_Z, bodyLean);
    hipsLocal.y += DECK_TOP;
    if (bert > 0.001) {
      hipsLocal.x = THREE.MathUtils.lerp(hipsLocal.x, 0.08, bert);
      hipsLocal.y = THREE.MathUtils.lerp(hipsLocal.y, DECK_TOP + 0.22, bert);
      hipsLocal.z = THREE.MathUtils.lerp(hipsLocal.z, -0.30, bert);
    }
    if (indy > 0.001) {
      // In a deep tuck for Indy grab: hips shift back over heel rail (+X) and drop low,
      // so knees compress tightly to chest and the center of mass stays right over the deck.
      hipsLocal.x = THREE.MathUtils.lerp(hipsLocal.x, 0.10, indy);
      hipsLocal.y = THREE.MathUtils.lerp(hipsLocal.y, DECK_TOP + 0.14, indy);
      hipsLocal.z = THREE.MathUtils.lerp(hipsLocal.z, 0.02, indy);
    }
    const hipsWorld = board.localToWorld(hipsLocal.clone());
    b.Hips.position.copy(b.Hips.parent!.worldToLocal(hipsWorld));
    b.Hips.updateMatrixWorld(true);
    // Apply yaw around boardY BEFORE tilting around boardX so the chest stays open toward -X!
    this.rotateBoneAxis(
      b.Hips,
      boardY,
      (0.18 + lead * 0.2) * (1 - bert) * (1 - indy) + 0.16 * bert + 0.16 * indy
    );
    this.rotateBoneAxis(
      b.Hips,
      boardZ,
      (bodyLean + crouch * 0.18 - lay * 0.3) * (1 - bert) * (1 - indy) - 0.22 * bert + 0.22 * indy
    );
    this.rotateBoneAxis(b.Hips, boardX, -0.76 * bert + 0.12 * indy);

    // 3. Spine: forward bend over the toes when crouching, shoulders lead the turn.
    //    In a Bertslide the torso tilts laterally toward the tail (-Z) while keeping the chest open (-X).
    //    In an Indy grab, the torso crunches deeply forward (+boardZ) toward the frontside toe rail.
    this.rotateBoneAxis(b.Spine, boardY, 0.12 * bert + 0.18 * indy);
    this.rotateBoneAxis(
      b.Spine,
      boardZ,
      (crouch * 0.22 + 0.06 - lay * 0.45) * (1 - bert) * (1 - indy) - 0.12 * bert + 0.28 * indy
    );
    this.rotateBoneAxis(b.Spine, boardX, -0.24 * bert + 0.16 * indy);
    this.rotateBoneAxis(b.Spine1, boardY, lead * 0.3 * (1 - bert) * (1 - indy) + 0.14 * bert + 0.14 * indy);
    this.rotateBoneAxis(
      b.Spine1,
      boardZ,
      (crouch * 0.14 - lay * 0.35) * (1 - bert) * (1 - indy) - 0.08 * bert + 0.20 * indy
    );
    this.rotateBoneAxis(b.Spine1, boardX, -0.20 * bert + 0.14 * indy);
    this.rotateBoneAxis(
      b.Spine2,
      boardY,
      (0.22 + lead * 0.35 + lay * 0.3) * (1 - bert) * (1 - indy) + 0.10 * bert + 0.10 * indy
    );
    this.rotateBoneAxis(b.Spine2, boardZ, 0.14 * indy);
    this.rotateBoneAxis(b.Spine2, boardX, 0.08 * indy);

    // 4. Head: lift the head and turn to look toward the nose (+Z) / camera (-X)
    const forwardBend = (bodyLean + crouch * 0.54 + 0.06 - lay * 1.1) * (1 - bert) * (1 - indy);
    this.rotateBoneAxis(b.Neck, boardZ, -forwardBend * 0.45 - 0.18 * bert + 0.12 * indy);
    this.rotateBoneAxis(b.Neck, boardX, 0.42 * bert + 0.08 * indy);
    this.rotateBoneAxis(
      b.Neck,
      boardY,
      (0.28 + lead * 0.18) * (1 - bert) * (1 - indy) + 0.32 * bert + 0.18 * indy
    );
    this.rotateBoneAxis(b.Head, boardZ, -forwardBend * 0.4 - 0.22 * bert + 0.10 * indy);
    this.rotateBoneAxis(b.Head, boardX, 0.38 * bert + 0.08 * indy);
    this.rotateBoneAxis(
      b.Head,
      boardY,
      (0.28 + lead * 0.18) * (1 - bert) * (1 - indy) + 0.36 * bert + 0.20 * indy
    );

    // 5. Arms:
    //    In a Bertslide, the low/trailing arm (RightArm) plants straight vertically down beneath the right shoulder.
    //    In an Indy grab, the trailing arm (RightArm) reaches down and grips the toe rail between feet,
    //    while the leading arm (LeftArm) flies high in the air with stylish flair!
    const armLift = crouch * 0.3;
    const normLArm = this.boardDir(-0.3, -0.62 + armLift - lean * 0.35 + lay * 0.6, 0.72);
    const normLFore = this.boardDir(-0.45, -0.25 + armLift + lay * 0.5, 0.85);
    const bertLArm = this.boardDir(-0.16, 0.90, 0.38);
    const bertLFore = this.boardDir(-0.10, 0.92, 0.36);
    const indyLArm = this.boardDir(0.48, 0.85, -0.15);
    const indyLFore = this.boardDir(0.55, 0.75, -0.25);
    const targetLArm = normLArm.lerp(bertLArm, bert).lerp(indyLArm, indy);
    const targetLFore = normLFore.lerp(bertLFore, bert).lerp(indyLFore, indy);
    this.aimBone(b.LeftArm, b.LeftForeArm, targetLArm);
    this.aimBone(b.LeftForeArm, b.LeftHand, targetLFore);

    const normRArm =
      lay > 0.35
        ? this.boardDir(0.6, -0.75, -0.35)
        : this.boardDir(-0.2, -0.82 + armLift + lean * 0.3, -0.5);
    const normRFore =
      lay > 0.35
        ? this.boardDir(0.4, -0.9, -0.2)
        : this.boardDir(-0.5, -0.55 + armLift, -0.45);
    const bertRArm = this.boardDir(-0.10, -0.99, -0.04);
    const bertRFore = this.boardDir(-0.08, -0.99, 0.04);

    if (indy > 0.001) {
      // 1. Exact contact target on the frontside (toe-side) rail of the board between the feet:
      // Front foot is at Z = +0.17, Back foot is at Z = -0.21.
      // Midpoint between feet is Z = -0.02.
      // Frontside (toe-side) rail is at X = -0.134 (half-width of deck is 0.136m).
      // Height is DECK_TOP + 0.018m (resting right on the rail/deck edge).
      const indyGrabLocal = new THREE.Vector3(-0.134, DECK_TOP + 0.018, -0.020);
      const indyGrabWorld = deck.localToWorld(indyGrabLocal);

      // Normal unconstrained hand target from directional aiming
      const targetRArm = normRArm.lerp(bertRArm, bert);
      const targetRFore = normRFore.lerp(bertRFore, bert);
      const shoulderWorld = this.worldPos(b.RightArm);
      const { upper, lower } = this.armLengths.Right;
      const restHandWorld = shoulderWorld.clone()
        .addScaledVector(targetRArm, upper)
        .addScaledVector(targetRFore, lower);

      // Smoothly blend from normal hand target to the exact frontside rail grab point
      const targetHand = restHandWorld.lerp(indyGrabWorld, indy);

      // Elbow pole: elbow bends outward & slightly rearward away from torso and knees
      const indyElbowPole = this.boardDir(-0.48, 0.28, -0.78);
      const normElbowPole = this.boardDir(0.6, -0.2, -0.6);
      const targetElbowPole = normElbowPole.lerp(indyElbowPole, indy);

      // Two-bone IK solving shoulder and elbow so RightHand touches the frontside rail
      this.solveArm('Right', targetHand, targetElbowPole);

      // Orient RightHand to grip the rail cleanly with fingers curling over the frontside edge:
      // Local +Y is finger direction; local +X is thumb (towards nose +Z); local +Z is palm normal.
      if (indy > 0.02) {
        const railTangent = this.boardDir(0, 0, 1); // thumb toward nose (+Z)
        const fingerDir = this.boardDir(-0.45, -0.89, 0); // fingers curl down and around toe rail
        const palmNormal = new THREE.Vector3().crossVectors(railTangent, fingerDir).normalize();
        const gripRot = new THREE.Matrix4().makeBasis(railTangent, fingerDir, palmNormal);
        const gripQuat = new THREE.Quaternion().setFromRotationMatrix(gripRot);
        const curHandQuat = b.RightHand.getWorldQuaternion(new THREE.Quaternion());
        this.setBoneWorldQuat(b.RightHand, curHandQuat.slerp(gripQuat, indy));

        if (this.rightFingerBones.length > 0 && indy > 0.05) {
          const curl = 0.40 * indy;
          for (const finger of this.rightFingerBones) {
            finger.rotateX(curl);
          }
        }
      }
    } else {
      const targetRArm = normRArm.lerp(bertRArm, bert);
      const targetRFore = normRFore.lerp(bertRFore, bert);
      this.aimBone(b.RightArm, b.RightForeArm, targetRArm);
      this.aimBone(b.RightForeArm, b.RightHand, targetRFore);
    }

    // 6. Legs: two-bone IK onto the (rolling) deck
    const deckQ = deck.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['Left', 'Right'] as Side[]) {
      const target = deck.localToWorld(this.ankleTargets[side].clone());
      const normPole = this.boardDir(-1, -0.15, side === 'Left' ? 0.25 : -0.1);
      const bertPole =
        side === 'Left'
          ? this.boardDir(-0.52, 0.82, 0.18)
          : this.boardDir(-0.68, 0.16, -0.72);
      const indyPole =
        side === 'Left'
          ? this.boardDir(-0.75, 0.35, 0.55)
          : this.boardDir(-0.80, 0.30, -0.52);
      const targetPole = normPole.lerp(bertPole, bert).lerp(indyPole, indy);
      this.solveLeg(side, target, targetPole);
      // Feet stay planted on the griptape
      const yaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, TOE_YAW[side]);
      this.setBoneWorldQuat(b[`${side}Foot`], deckQ.clone().multiply(yaw).multiply(this.footRestInDeck[side]));
    }
  }

  public update(dt: number, ctrl: SurfskateController): void {
    // 1. Align root position & surface-normal tilt
    this.root.position.copy(ctrl.position);
    this.contactShadowMesh.visible = ctrl.isGrounded;

    // Board yaw relative to travel: tail slid out (Bert slide) or the full FS Reverse 360 spin
    const visHeading = ctrl.heading + ctrl.boardYawOffset;
    const forward = new THREE.Vector3(-Math.sin(visHeading), 0, -Math.cos(visHeading)).normalize();
    const up = ctrl.isGrounded
      ? ctrl.currentSurface.normal.clone().lerp(new THREE.Vector3(0, 1, 0), 0.32).normalize()
      : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const orthoForward = new THREE.Vector3().crossVectors(up, right).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(right, up, orthoForward.clone().negate());
    this.root.quaternion.setFromRotationMatrix(rotMatrix);

    // 2. Deck Lean (`DeckMesh`) and board separation during bail
    if (this.boardGroup) {
      if (ctrl.isBailing) {
        const p = 1.0 - Math.max(0, ctrl.bailTimer / ctrl.bailDuration);
        // Board slides ahead on the concrete, then glides back under feet as skater recovers
        const boardDisplace = p < 0.75
          ? Math.min(1.35, p * 2.8)
          : Math.max(0, 1.35 * (1.0 - (p - 0.75) / 0.25));
        this.boardGroup.position.set(
          Math.sin(p * Math.PI) * 0.12,
          0.01,
          boardDisplace
        );
        this.boardGroup.rotation.set(
          0.04 * Math.sin(p * Math.PI),
          0.10 * Math.sin(p * Math.PI),
          0.26 * Math.sin(p * Math.PI)
        );
      } else {
        this.boardGroup.position.set(0, 0, 0);
        this.boardGroup.rotation.set(0, 0, 0);
      }
    }

    const groundedLean = ctrl.isGrounded ? ctrl.leanAngle : 0;

    if (this.deckMesh && !ctrl.isBailing) {
      const b = ctrl.isGrounded ? ctrl.bertSlideAmount : 0;
      const indy = !ctrl.isGrounded ? ctrl.indyGrabAmount : 0;
      const deckRoll = groundedLean * (1 - b) * (1 - indy) - 0.34 * b - 0.36 * indy;
      const deckPitch = -0.18 * b + 0.16 * indy;
      this.deckMesh.rotation.set(deckPitch, 0, deckRoll);
    }

    // 3. Dual-Axis Front Surf-Adapter Truck (`FrontTruckPivot`) & Rear Truck (`RearTruckPivot`)
    if (this.frontTruckPivot) {
      this.frontTruckPivot.rotation.set(0, ctrl.isGrounded ? -ctrl.frontTruckYaw : 0, groundedLean * 0.35);
    }
    if (this.rearTruckPivot) {
      this.rearTruckPivot.rotation.set(0, ctrl.isGrounded ? -ctrl.rearTruckYaw : 0, groundedLean * 0.2);
    }

    // 4. Spin wheels based on riding speed (radius 0.035m = 70mm surfskate wheel)
    if (ctrl.isGrounded && Math.abs(ctrl.speed) > 0.02) {
      const rollDelta = (ctrl.speed * dt) / 0.035;
      for (let i = 0; i < this.wheels.length; i++) {
        this.wheels[i].rotateY(rollDelta);
      }
    }

    // 4. Full-body skeletal surf pose (leg IK on the deck, crouch, lean, torso twist, arms, head)
    if (this.hasSkeleton) {
      this.poseSkeleton(ctrl, dt);
    }

    // 5. Dynamic hair wind, flutter & inertia simulation (female skater Sophie)
    if (this.hairUniforms) {
      this.hairElapsed += dt;

      // Compute world travel velocity of the skater
      let worldVel: THREE.Vector3;
      if (ctrl.isGrounded) {
        const pitch = ctrl.pitchAngle || 0;
        const vy = Math.sin(pitch) * ctrl.speed;
        worldVel = new THREE.Vector3(
          -Math.sin(ctrl.heading) * ctrl.speed,
          vy,
          -Math.cos(ctrl.heading) * ctrl.speed
        );
      } else {
        worldVel = ctrl.velocity.clone();
      }

      // Apparent wind blows opposite to movement direction
      const targetWind = worldVel.clone().negate();
      if (ctrl.speed < 0.2) {
        // At standstill / calm, let hair rest naturally
        targetWind.set(0, 0, 0);
      }

      const smoothFactor = Math.min(1.0, dt * 7.0);
      this.smoothedHairWind.lerp(targetWind, smoothFactor);

      // Centrifugal inertia: slight outward lag during sharp carves
      const turnRate = ctrl.smoothedYawRate || 0;
      const targetInertia = right.clone().multiplyScalar(-turnRate * ctrl.speed * 0.08);
      this.smoothedHairInertia.lerp(targetInertia, Math.min(1.0, dt * 10.0));

      const flutterIntensity =
        THREE.MathUtils.clamp((ctrl.speed - 1.0) / 4.0, 0.0, 1.0) +
        (ctrl.snapActive ? 0.4 : 0.0) +
        (ctrl.bertSlideActive ? 0.3 : 0.0);

      this.hairUniforms.uHairWind.value.copy(this.smoothedHairWind);
      this.hairUniforms.uHairTurnInertia.value.copy(this.smoothedHairInertia);
      this.hairUniforms.uHairFlutter.value = flutterIntensity;
      this.hairUniforms.uHairTime.value = this.hairElapsed;
    }

    // 6. Update Spray / Coping Spark Particles & Carve Ribbon Trail
    this.updateParticlesAndTrail(dt, ctrl, right, up);
  }

  /** Spawn one particle of the given kind at the board's rail / tail / wheels. */
  private emitParticle(
    kind: 0 | 1 | 2,
    ctrl: SurfskateController,
    fwd: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    side: number
  ): void {
    const i = this.nextParticleIdx;
    this.nextParticleIdx = (this.nextParticleIdx + 1) % this.maxParticles;
    const i3 = i * 3;
    const r = Math.random;

    const isPumpFlash = kind === 2 && ctrl.perfectPumpFlashTimer > 0;

    // Origin: along the outside rail, biased toward the tail, or near wheels during pump flash
    const along = isPumpFlash
      ? (r() < 0.5 ? 0.24 : -0.24) + (r() - 0.5) * 0.08
      : -0.32 + r() * 0.42;
    const wheelTrack = isPumpFlash ? 0.10 : 0.12;
    const p = ctrl.position
      .clone()
      .addScaledVector(fwd, along)
      .addScaledVector(right, side * (wheelTrack + r() * 0.05))
      .addScaledVector(up, (isPumpFlash ? 0.035 : 0.05) + r() * 0.04);
    this.particlePositions[i3] = p.x;
    this.particlePositions[i3 + 1] = p.y;
    this.particlePositions[i3 + 2] = p.z;

    // Velocity: a curved fan thrown outward + up, trailing behind the board
    const speedCarry = Math.min(1.5, ctrl.speed * 0.15);
    let out: number, lift: number, back: number, jitter: number;
    if (kind === 2) {
      out = (r() - 0.5) * 3;
      lift = (isPumpFlash ? 1.2 : 0.8) + r() * 2.2;
      back = (isPumpFlash ? 1.0 : 1.5) + r() * 2.5 + speedCarry;
      jitter = 1.2;
    } else if (kind === 1) {
      out = 0.6 + r() * 1.2; lift = 0.3 + r() * 0.8; back = 0.3 + r() * 0.6; jitter = 0.5;
    } else {
      out = 2.2 + r() * 4.0; lift = 1.8 + r() * 3.6; back = 0.2 + r() * 1.4 + speedCarry; jitter = 0.9;
    }
    const v = new THREE.Vector3()
      .addScaledVector(right, side * out)
      .addScaledVector(up, lift)
      .addScaledVector(fwd, -back)
      .add(new THREE.Vector3((r() - 0.5) * jitter, (r() - 0.5) * jitter * 0.5, (r() - 0.5) * jitter));
    this.particleVelocities[i3] = v.x;
    this.particleVelocities[i3 + 1] = v.y;
    this.particleVelocities[i3 + 2] = v.z;

    let cr: number, cg: number, cb: number, size: number, life: number, alpha: number;
    if (kind === 2) {
      // Hot golden-orange coping / perfect-pump sparks
      cr = 1.0;
      cg = isPumpFlash ? 0.82 + r() * 0.18 : 0.55 + r() * 0.35;
      cb = isPumpFlash ? 0.28 : 0.12;
      size = (isPumpFlash ? 0.048 : 0.035) + r() * 0.035;
      life = (isPumpFlash ? 0.32 : 0.25) + r() * 0.25;
      alpha = 1.0;
    } else if (kind === 1) {
      // Warm sunset-orange glow puff (or molten champagne-gold on Golden Pretzel Pro)
      if (this.activeBoardSpec.goldTrail) {
        cr = 1.0; cg = 0.78 + r() * 0.14; cb = 0.22 + r() * 0.14;
      } else {
        cr = 1.0; cg = 0.42 + r() * 0.12; cb = 0.1;
      }
      size = 0.3 + r() * 0.3; life = 0.8 + r() * 0.6; alpha = 0.26 + r() * 0.14;
    } else {
      // Glowing spray droplets (deep orange to golden, or pure liquid gold on Golden Pretzel Pro)
      const w = r();
      if (this.activeBoardSpec.goldTrail) {
        cr = 1.0; cg = 0.74 + w * 0.22; cb = 0.18 + w * 0.24;
      } else {
        cr = 1.0; cg = 0.38 + w * 0.4; cb = 0.06 + w * 0.12;
      }
      size = 0.045 + r() * 0.09; life = 0.55 + r() * 0.55; alpha = 0.8 + r() * 0.2;
    }
    this.particleColors[i3] = cr;
    this.particleColors[i3 + 1] = cg;
    this.particleColors[i3 + 2] = cb;
    this.particleKind[i] = kind;
    this.particleLife[i] = life;
    this.particleMaxLife[i] = life;
    this.particleBaseSize[i] = size;
    this.particleSize[i] = size;
    this.particleBaseAlpha[i] = alpha;
    this.particleAlpha[i] = alpha;
  }

  private updateParticlesAndTrail(
    dt: number,
    ctrl: SurfskateController,
    right: THREE.Vector3,
    up: THREE.Vector3
  ): void {
    // Emit spray during snaps / slides / reverses, sparks during coping grinds.
    const spray = ctrl.sprayIntensity;
    const fwd = new THREE.Vector3(-Math.sin(ctrl.heading), 0, -Math.cos(ctrl.heading));
    // Spray flies off the OUTSIDE rail of the turn, like water off a surfboard
    const side = -Math.sign(ctrl.leanAngle || 1);
    if (ctrl.isGrinding) {
      const sparkCount = this.currentQuality === 'low' ? 2 : this.currentQuality === 'medium' ? 3 : 5;
      for (let i = 0; i < sparkCount; i++) this.emitParticle(2, ctrl, fwd, right, up, side);
    } else if (spray > 0.15) {
      // Fresh burst when a trick starts (spray jumps up), then a steady fan while it lasts
      const scale = this.currentQuality === 'low' ? 0.35 : this.currentQuality === 'medium' ? 0.65 : 1.0;
      const burst = Math.round((spray > 0.9 && this.prevSpray < 0.5 ? 80 : 0) * scale);
      const droplets = Math.max(1, Math.round((burst + 10 * spray) * scale));
      for (let i = 0; i < droplets; i++) this.emitParticle(0, ctrl, fwd, right, up, side);
      const mist = Math.round(((burst ? 16 : 0) + (Math.random() < spray ? 2 : 0)) * scale);
      for (let i = 0; i < mist; i++) this.emitParticle(1, ctrl, fwd, right, up, side);
    }
    this.prevSpray = spray;

    // Golden sparks & glow burst at the wheels during Perfect Pump flash!
    if (ctrl.perfectPumpFlashTimer > 0) {
      const flashCount = this.currentQuality === 'low' ? 2 : 4;
      for (let i = 0; i < flashCount; i++) {
        const wheelSide = Math.random() < 0.5 ? -1 : 1;
        this.emitParticle(2, ctrl, fwd, right, up, wheelSide);
      }
      if (Math.random() < 0.35) {
        this.emitParticle(1, ctrl, fwd, right, up, Math.random() < 0.5 ? -1 : 1);
      }
    }

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particleLife[i] <= 0) {
        this.particleAlpha[i] = 0;
        continue;
      }
      this.particleLife[i] -= dt;
      const kind = this.particleKind[i];
      const t = Math.max(0, this.particleLife[i] / this.particleMaxLife[i]); // 1 -> 0
      const i3 = i * 3;
      const gravity = kind === 1 ? 0.6 : kind === 2 ? 6.0 : 7.5;
      const drag = kind === 1 ? 2.6 : kind === 2 ? 0.6 : 1.1;
      const dk = Math.exp(-drag * dt);
      this.particleVelocities[i3] *= dk;
      this.particleVelocities[i3 + 2] *= dk;
      this.particleVelocities[i3 + 1] = this.particleVelocities[i3 + 1] * dk - gravity * dt;
      this.particlePositions[i3] += this.particleVelocities[i3] * dt;
      this.particlePositions[i3 + 1] += this.particleVelocities[i3 + 1] * dt;
      this.particlePositions[i3 + 2] += this.particleVelocities[i3 + 2] * dt;

      if (kind === 1) {
        // Mist puffs swell and fade softly
        this.particleSize[i] = this.particleBaseSize[i] * (1 + (1 - t) * 2.2);
        this.particleAlpha[i] = this.particleBaseAlpha[i] * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.4 + 0.15)) * t;
      } else if (kind === 2) {
        // Sparks flicker and shrink
        this.particleSize[i] = this.particleBaseSize[i] * (0.4 + 0.6 * t);
        this.particleAlpha[i] = this.particleBaseAlpha[i] * t * (0.7 + 0.3 * Math.random());
      } else {
        // Droplets shrink a little and fade out
        this.particleSize[i] = this.particleBaseSize[i] * (0.55 + 0.45 * t);
        this.particleAlpha[i] = this.particleBaseAlpha[i] * Math.pow(t, 0.8);
      }
      if (this.particleLife[i] <= 0) this.particleAlpha[i] = 0;
    }
    const attrs = this.particleMesh.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.color.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;

    // Update carve ribbon trail when grounded and moving
    if (ctrl.isGrounded && ctrl.speed > 1.2) {
      const halfW = 0.095 + Math.abs(ctrl.leanAngle) * 0.08;
      const lift = up.clone().multiplyScalar(0.025);
      const pL = ctrl.position.clone().addScaledVector(right, -halfW).add(lift);
      const pR = ctrl.position.clone().addScaledVector(right, halfW).add(lift);

      // Determine Thaneline / Overdrive color for new vertices
      const isBertOrLayback = ctrl.bertSlideActive || ctrl.laybackActive;
      const isSnapOrReverse = ctrl.snapActive || ctrl.reverseActive;
      const isSlideTrick = isBertOrLayback || isSnapOrReverse;
      const isSurfZone = ctrl.isSurfZoneActive;
      const isPumpFlash = ctrl.perfectPumpFlashTimer > 0;

      // Base: subtle dark urethane track on concrete (or exclusive golden-amber Thaneline for Golden Pretzel Pro)
      const hasGoldTrail = this.activeBoardSpec.goldTrail;
      let lR = 0.11, lG = 0.12, lB = 0.14;
      let rR = 0.11, rG = 0.12, rB = 0.14;

      if (hasGoldTrail) {
        const goldPulse = Math.sin(performance.now() * 0.011) * 0.5 + 0.5;
        lR = 1.0;
        lG = THREE.MathUtils.lerp(0.68, 0.88, goldPulse);
        lB = THREE.MathUtils.lerp(0.12, 0.34, goldPulse);
        rR = 1.0;
        rG = THREE.MathUtils.lerp(0.88, 0.68, goldPulse);
        rB = THREE.MathUtils.lerp(0.34, 0.12, goldPulse);
      }

      if (isBertOrLayback) {
        if (hasGoldTrail) {
          lR = 1.0; lG = 0.76; lB = 0.12;
          rR = 1.0; rG = 0.86; rB = 0.28;
        } else {
          // Sunset-Orange Thanelines (#ff6a1a)
          lR = 1.0; lG = 0.416; lB = 0.102;
          rR = 1.0; rG = 0.416; rB = 0.102;
        }
      } else if (isSnapOrReverse) {
        if (hasGoldTrail) {
          lR = 1.0; lG = 0.92; lB = 0.42;
          rR = 1.0; rG = 0.78; rB = 0.16;
        } else {
          // Electric-Cyan Thanelines (#00e5ff)
          lR = 0.0; lG = 0.898; lB = 1.0;
          rR = 0.0; rG = 0.898; rB = 1.0;
        }
      }

      if (isSurfZone) {
        // Cyan-Gold Overdrive Shimmer under the board (pure champagne-gold shimmer on Golden Pretzel Pro)
        const shimmer = Math.sin(performance.now() * 0.009) * 0.5 + 0.5;
        const cyanR = hasGoldTrail ? 1.0 : 0.0;
        const cyanG = hasGoldTrail ? 0.94 : 0.9;
        const cyanB = hasGoldTrail ? 0.52 : 1.0;
        const goldR = 1.0, goldG = 0.82, goldB = 0.12;

        if (isSlideTrick) {
          // Slide trick in Surf-Zone: vivid dual-tone electric boost!
          lR = THREE.MathUtils.lerp(lR, cyanR, 0.45);
          lG = THREE.MathUtils.lerp(lG, cyanG, 0.45);
          lB = THREE.MathUtils.lerp(lB, cyanB, 0.45);

          rR = THREE.MathUtils.lerp(rR, goldR, 0.45);
          rG = THREE.MathUtils.lerp(rG, goldG, 0.45);
          rB = THREE.MathUtils.lerp(rB, goldB, 0.45);
        } else {
          // Pure shimmering overdrive ribbon
          lR = THREE.MathUtils.lerp(cyanR, goldR, shimmer);
          lG = THREE.MathUtils.lerp(cyanG, goldG, shimmer);
          lB = THREE.MathUtils.lerp(cyanB, goldB, shimmer);

          rR = THREE.MathUtils.lerp(goldR, cyanR, shimmer);
          rG = THREE.MathUtils.lerp(goldG, cyanG, shimmer);
          rB = THREE.MathUtils.lerp(goldB, cyanB, shimmer);
        }
      }

      if (isPumpFlash) {
        // Radiant golden spark flash pulse at wheels
        const flashFactor = Math.min(1.0, ctrl.perfectPumpFlashTimer / 0.45);
        lR = THREE.MathUtils.lerp(lR, 1.0, flashFactor);
        lG = THREE.MathUtils.lerp(lG, 0.92, flashFactor);
        lB = THREE.MathUtils.lerp(lB, 0.25, flashFactor);

        rR = THREE.MathUtils.lerp(rR, 1.0, flashFactor);
        rG = THREE.MathUtils.lerp(rG, 0.92, flashFactor);
        rB = THREE.MathUtils.lerp(rB, 0.25, flashFactor);
      }

      // Dynamically adjust trail mesh opacity
      const trailMat = this.trailMesh.material as THREE.MeshBasicMaterial;
      const targetOpacity =
        isSlideTrick || isSurfZone || isPumpFlash
          ? 0.94
          : hasGoldTrail
            ? 0.76
            : 0.42;
      trailMat.opacity = THREE.MathUtils.lerp(trailMat.opacity, targetOpacity, Math.min(1, 8.0 * dt));

      // Shift trail vertices and colors down
      for (let i = this.maxTrailSegments - 1; i > 0; i--) {
        const dst = i * 6;
        const src = (i - 1) * 6;
        for (let k = 0; k < 6; k++) {
          this.trailPositions[dst + k] = this.trailPositions[src + k];
          this.trailColors[dst + k] = this.trailColors[src + k] * 0.982; // smooth fade towards tail
        }
      }
      this.trailPositions[0] = pL.x;
      this.trailPositions[1] = pL.y;
      this.trailPositions[2] = pL.z;
      this.trailPositions[3] = pR.x;
      this.trailPositions[4] = pR.y;
      this.trailPositions[5] = pR.z;

      this.trailColors[0] = lR;
      this.trailColors[1] = lG;
      this.trailColors[2] = lB;
      this.trailColors[3] = rR;
      this.trailColors[4] = rG;
      this.trailColors[5] = rB;

      this.trailHead++;
      this.trailMesh.geometry.attributes.position.needsUpdate = true;
      this.trailMesh.geometry.attributes.color.needsUpdate = true;
    } else {
      const trailMat = this.trailMesh.material as THREE.MeshBasicMaterial;
      trailMat.opacity = THREE.MathUtils.lerp(trailMat.opacity, 0.35, Math.min(1, 4.0 * dt));
    }
  }

  /**
   * Inject procedural wind, flutter, and centrifugal inertia deformation into hair materials.
   * Runs 100% on GPU in vertex shader with cross-platform WebGL 1/2 compatibility.
   */
  private attachHairWindShader(
    material: THREE.Material,
    uniforms: HairWindUniforms,
    cacheKey: string
  ): void {
    material.customProgramCacheKey = () => cacheKey;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uHairWind = uniforms.uHairWind;
      shader.uniforms.uHairTurnInertia = uniforms.uHairTurnInertia;
      shader.uniforms.uHairFlutter = uniforms.uHairFlutter;
      shader.uniforms.uHairTime = uniforms.uHairTime;

      shader.vertexShader = shader.vertexShader.replace(
        'void main()',
        `
        uniform vec3 uHairWind;
        uniform vec3 uHairTurnInertia;
        uniform float uHairFlutter;
        uniform float uHairTime;

        void main()
        `
      );

      const projectTarget = '#include <project_vertex>';
      const projectReplacement = `
        // --- SOPHIE PURE BACKWARD HAIR WIND SIMULATION ---
        // Roots at crown (Y > 1.63) are anchored; ends (Y < 1.60) flex smoothly
        float rootFactor = clamp((1.63 - position.y) / 0.55, 0.0, 1.0);
        float flex = pow(rootFactor, 1.6);
        float backWeight = smoothstep(-0.06, 0.04, position.x);
        flex *= mix(0.15, 1.0, backWeight);

        vec4 hairWorldPos = modelMatrix * vec4( transformed, 1.0 );
        float windSpeed = length(uHairWind);

        // Horizontal backward wind direction: strictly backwards along the travel path
        vec3 windDir = vec3(0.0);
        if (windSpeed > 0.05) {
          windDir = normalize(vec3(uHairWind.x, 0.0, uHairWind.z));
        }

        // Pure backward aerodynamic deflection: streams backwards, stronger with speed
        float windPushMag = (windSpeed * 0.038) * flex;
        windPushMag = min(windPushMag, 0.35 * flex);
        vec3 backwardDeflection = windDir * windPushMag;

        // Slight lift so trailing strands float cleanly off the shoulders
        backwardDeflection.y += windPushMag * 0.16 * backWeight;

        hairWorldPos.xyz += backwardDeflection;

        vec4 mvPosition = viewMatrix * hairWorldPos;
        gl_Position = projectionMatrix * mvPosition;
      `;

      shader.vertexShader = shader.vertexShader.replace(projectTarget, projectReplacement);
    };
  }

  /**
   * Build authentic, realistic surfskate trucks physically connecting the deck to the wheels:
   * - Front: Surfskate swing-arm adapter (Carver C7 / YOW Meraki style) with encapsulated spring drum,
   *   swivel bearing housing, angled kingpin, vibrant orange urethane bushings, washers, locknut,
   *   sculpted T-hanger, axle rod, speed rings and outer wheel nuts.
   * - Rear: Standard surfskate / reverse-kingpin rear truck with cast baseplate, pivot cup,
   *   angled kingpin, orange urethane bushings, cupped washers, locknut, sculpted T-hanger,
   *   axle rod, and outer wheel nuts.
   * - Baseplates & Riser Pads mounted flush beneath DeckMesh.
   * Replaces the crude floating placeholder rods from the base model.
   */
  private attachRealisticSurfskateTrucks(): void {
    if (!this.deckMesh || !this.frontTruckPivot || !this.rearTruckPivot) return;

    // 1. Hide legacy crude placeholder rods & cubes from original GLB
    const legacyPlaceholders = new Set([
      'FrontSurfAdapterArm',
      'FrontBushing',
      'FrontAxle',
      'RearAxle',
    ]);
    this.boardGroup?.traverse((child) => {
      if (legacyPlaceholders.has(child.name)) {
        child.visible = false;
      }
    });

    // 2. Remove previously attached realistic truck meshes if reloading
    const removeExisting = (parent: THREE.Object3D) => {
      for (let i = parent.children.length - 1; i >= 0; i--) {
        const child = parent.children[i];
        if (child.name.startsWith('RealisticTruck_')) {
          parent.remove(child);
          if ((child as THREE.Mesh).geometry) {
            (child as THREE.Mesh).geometry.dispose();
          }
        }
      }
    };
    removeExisting(this.deckMesh);
    removeExisting(this.frontTruckPivot);
    removeExisting(this.rearTruckPivot);

    // 3. Materials
    // Brushed cast aluminum for baseplates, swing-arm & hangers
    const matAlu = new THREE.MeshStandardMaterial({
      color: 0xd8dde4,
      metalness: 0.82,
      roughness: 0.28,
    });
    // High-density damping rubber for riser pads and pivot cups
    const matRubber = new THREE.MeshStandardMaterial({
      color: 0x16181c,
      roughness: 0.85,
      metalness: 0.1,
    });
    // High-rebound orange urethane for surfskate bushings
    const matBushing = new THREE.MeshStandardMaterial({
      color: 0xff6a1a,
      roughness: 0.38,
      metalness: 0.05,
    });
    // Dark oxide steel for mounting screws, kingpin shaft & locknuts
    const matSteel = new THREE.MeshStandardMaterial({
      color: 0x22252a,
      metalness: 0.85,
      roughness: 0.3,
    });
    // Polished precision steel for washers, bearing caps & axle rods
    const matPolishedSteel = new THREE.MeshStandardMaterial({
      color: 0xc8cdd4,
      metalness: 0.90,
      roughness: 0.20,
    });

    const transformGeo = (
      geo: THREE.BufferGeometry,
      pos: [number, number, number],
      rot?: [number, number, number]
    ): THREE.BufferGeometry => {
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const q = rot
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
        : new THREE.Quaternion();
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      const cloned = geo.clone();
      cloned.applyMatrix4(m);
      return cloned;
    };

    const createMergedMesh = (
      geos: THREE.BufferGeometry[],
      material: THREE.Material,
      name: string,
      parent: THREE.Object3D
    ): THREE.Mesh => {
      const merged = BufferGeometryUtils.mergeGeometries(geos);
      for (let i = 0; i < geos.length; i++) {
        geos[i].dispose();
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // -------------------------------------------------------------------------
    // A. DECK MESH: Riser Pads & Baseplates (mounted flush against deck underside)
    // -------------------------------------------------------------------------
    const deckRubberGeos = [
      // Front rubber riser pad (deck underside at Z = 0.25 is Y = 0.105)
      transformGeo(new THREE.BoxGeometry(0.058, 0.005, 0.078), [0, 0.1025, 0.25]),
      // Rear rubber riser pad (deck underside at Z = -0.25 is Y = 0.107)
      transformGeo(new THREE.BoxGeometry(0.058, 0.006, 0.078), [0, 0.104, -0.25]),
      // Rear pivot cup rubber collar (angled 32 deg)
      transformGeo(new THREE.CylinderGeometry(0.0075, 0.0075, 0.010, 12), [0, 0.077, -0.218], [0.55, 0, 0]),
    ];
    createMergedMesh(deckRubberGeos, matRubber, 'RealisticTruck_DeckRubber', this.deckMesh);

    const deckAluGeos = [
      // Front aluminum baseplate mounting flange
      transformGeo(new THREE.BoxGeometry(0.054, 0.006, 0.074), [0, 0.097, 0.25]),
      // Front adapter swivel collar (bearing cup housing)
      transformGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.022, 22), [0, 0.083, 0.25]),
      transformGeo(new THREE.CylinderGeometry(0.0235, 0.0235, 0.004, 22), [0, 0.074, 0.25]),
      // Front baseplate stiffener gussets
      transformGeo(new THREE.BoxGeometry(0.008, 0.016, 0.038), [-0.018, 0.086, 0.25]),
      transformGeo(new THREE.BoxGeometry(0.008, 0.016, 0.038), [0.018, 0.086, 0.25]),
      // Rear aluminum baseplate mounting flange
      transformGeo(new THREE.BoxGeometry(0.054, 0.006, 0.074), [0, 0.098, -0.25]),
      // Rear pivot cup housing
      transformGeo(new THREE.CylinderGeometry(0.010, 0.010, 0.018, 14), [0, 0.079, -0.218], [0.55, 0, 0]),
      // Rear kingpin base boss
      transformGeo(new THREE.BoxGeometry(0.026, 0.016, 0.028), [0, 0.084, -0.260], [-0.35, 0, 0]),
      // Rear center stiffener spine
      transformGeo(new THREE.BoxGeometry(0.012, 0.016, 0.032), [0, 0.088, -0.238]),
    ];
    createMergedMesh(deckAluGeos, matAlu, 'RealisticTruck_DeckAlu', this.deckMesh);

    const boltGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 6);
    const deckSteelGeos: THREE.BufferGeometry[] = [];
    for (const bx of [-0.0205, 0.0205]) {
      for (const bz of [-0.026, 0.026]) {
        deckSteelGeos.push(transformGeo(boltGeo, [bx, 0.093, 0.25 + bz]));
        deckSteelGeos.push(transformGeo(boltGeo, [bx, 0.094, -0.25 + bz]));
      }
    }
    boltGeo.dispose();
    createMergedMesh(deckSteelGeos, matSteel, 'RealisticTruck_DeckSteel', this.deckMesh);

    // -------------------------------------------------------------------------
    // B. FRONT TRUCK: Surfskate Swing-Arm Adapter & Hanger (attached to FrontTruckPivot)
    // -------------------------------------------------------------------------
    const frontAluGeos = [
      // Swivel pin drum (rotates inside baseplate swivel collar)
      transformGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.024, 20), [0, 0.014, 0]),
      // Encapsulated torsion spring drum / adapter body
      transformGeo(new THREE.CylinderGeometry(0.020, 0.020, 0.026, 20), [0, 0.003, -0.011]),
      // Swing-arm cast body
      transformGeo(new THREE.BoxGeometry(0.032, 0.018, 0.028), [0, -0.008, -0.018], [-0.60, 0, 0]),
      // Cast T-hanger central eyelet / bushing collar
      transformGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 16), [0, -0.020, -0.027], [-0.75, 0, 0]),
      // Hanger center bridge
      transformGeo(new THREE.BoxGeometry(0.040, 0.018, 0.016), [0, -0.025, -0.030]),
      // Left & right tapered hanger wings
      transformGeo(new THREE.CylinderGeometry(0.008, 0.012, 0.045, 14), [-0.042, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
      transformGeo(new THREE.CylinderGeometry(0.012, 0.008, 0.045, 14), [0.042, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
      // Left & right axle sleeves (against inner wheel faces)
      transformGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.014, 14), [-0.062, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
      transformGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.014, 14), [0.062, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
    ];
    createMergedMesh(frontAluGeos, matAlu, 'RealisticTruck_FrontAlu', this.frontTruckPivot);

    const frontBushingGeos = [
      // Board-side orange urethane bushing
      transformGeo(new THREE.CylinderGeometry(0.0135, 0.0145, 0.009, 16), [0, -0.014, -0.020], [-0.75, 0, 0]),
      // Road-side orange urethane bushing
      transformGeo(new THREE.CylinderGeometry(0.0115, 0.013, 0.009, 16), [0, -0.022, -0.024], [-0.75, 0, 0]),
    ];
    createMergedMesh(frontBushingGeos, matBushing, 'RealisticTruck_FrontBushing', this.frontTruckPivot);

    const frontSteelGeos = [
      // Spring preload adjuster hex bolt
      transformGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.005, 6), [0, 0.003, 0.002], [Math.PI * 0.5, 0, 0]),
      // Angled kingpin bolt shaft
      transformGeo(new THREE.CylinderGeometry(0.0048, 0.0048, 0.038, 12), [0, -0.018, -0.022], [-0.75, 0, 0]),
      // Kingpin nylon locknut
      transformGeo(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6), [0, -0.030, -0.028], [-0.75, 0, 0]),
      // Left outer wheel locknut
      transformGeo(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6), [-0.119, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
      // Right outer wheel locknut
      transformGeo(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6), [0.119, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
    ];
    createMergedMesh(frontSteelGeos, matSteel, 'RealisticTruck_FrontSteel', this.frontTruckPivot);

    const frontPolishedGeos = [
      // Chrome seal cap on swivel pin
      transformGeo(new THREE.CylinderGeometry(0.019, 0.019, 0.003, 20), [0, 0.025, 0]),
      // Board-side cupped bushing washer
      transformGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.002, 16), [0, -0.010, -0.018], [-0.75, 0, 0]),
      // Road-side cupped bushing washer
      transformGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.002, 16), [0, -0.026, -0.026], [-0.75, 0, 0]),
      // Steel axle rod (running through entire hanger & wheels)
      transformGeo(new THREE.CylinderGeometry(0.0045, 0.0045, 0.240, 12), [0, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
      // Left outer speed ring washer
      transformGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.0015, 12), [-0.116, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
      // Right outer speed ring washer
      transformGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.0015, 12), [0.116, -0.025, -0.030], [0, 0, Math.PI * 0.5]),
    ];
    createMergedMesh(frontPolishedGeos, matPolishedSteel, 'RealisticTruck_FrontPolished', this.frontTruckPivot);

    // -------------------------------------------------------------------------
    // C. REAR TRUCK: Surfskate Rear Truck & Hanger (attached to RearTruckPivot)
    // -------------------------------------------------------------------------
    const rearAluGeos = [
      // Pivot pin (nests into baseplate rubber pivot cup)
      transformGeo(new THREE.CylinderGeometry(0.0055, 0.0075, 0.026, 12), [0, 0.008, 0.024], [0.55, 0, 0]),
      // Cast T-hanger central eyelet / collar
      transformGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 16), [0, -0.018, -0.005], [-0.65, 0, 0]),
      // Hanger center bridge
      transformGeo(new THREE.BoxGeometry(0.040, 0.018, 0.016), [0, -0.025, 0]),
      // Left & right tapered hanger wings
      transformGeo(new THREE.CylinderGeometry(0.008, 0.012, 0.045, 14), [-0.042, -0.025, 0], [0, 0, Math.PI * 0.5]),
      transformGeo(new THREE.CylinderGeometry(0.012, 0.008, 0.045, 14), [0.042, -0.025, 0], [0, 0, Math.PI * 0.5]),
      // Left & right axle sleeves (against inner wheel faces)
      transformGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.014, 14), [-0.062, -0.025, 0], [0, 0, Math.PI * 0.5]),
      transformGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.014, 14), [0.062, -0.025, 0], [0, 0, Math.PI * 0.5]),
    ];
    createMergedMesh(rearAluGeos, matAlu, 'RealisticTruck_RearAlu', this.rearTruckPivot);

    const rearBushingGeos = [
      // Board-side orange urethane bushing
      transformGeo(new THREE.CylinderGeometry(0.0135, 0.0145, 0.010, 16), [0, -0.012, -0.006], [-0.65, 0, 0]),
      // Road-side orange urethane bushing
      transformGeo(new THREE.CylinderGeometry(0.0115, 0.013, 0.009, 16), [0, -0.020, -0.010], [-0.65, 0, 0]),
    ];
    createMergedMesh(rearBushingGeos, matBushing, 'RealisticTruck_RearBushing', this.rearTruckPivot);

    const rearSteelGeos = [
      // Reverse kingpin bolt shaft
      transformGeo(new THREE.CylinderGeometry(0.0048, 0.0048, 0.038, 12), [0, -0.016, -0.008], [-0.65, 0, 0]),
      // Kingpin nylon locknut
      transformGeo(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6), [0, -0.028, -0.014], [-0.65, 0, 0]),
      // Left outer wheel locknut
      transformGeo(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6), [-0.119, -0.025, 0], [0, 0, Math.PI * 0.5]),
      // Right outer wheel locknut
      transformGeo(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 6), [0.119, -0.025, 0], [0, 0, Math.PI * 0.5]),
    ];
    createMergedMesh(rearSteelGeos, matSteel, 'RealisticTruck_RearSteel', this.rearTruckPivot);

    const rearPolishedGeos = [
      // Board-side cupped washer
      transformGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.002, 16), [0, -0.008, -0.004], [-0.65, 0, 0]),
      // Road-side cupped washer
      transformGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.002, 16), [0, -0.024, -0.012], [-0.65, 0, 0]),
      // Steel axle rod (running through entire hanger & wheels)
      transformGeo(new THREE.CylinderGeometry(0.0045, 0.0045, 0.240, 12), [0, -0.025, 0], [0, 0, Math.PI * 0.5]),
      // Left outer speed ring washer
      transformGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.0015, 12), [-0.116, -0.025, 0], [0, 0, Math.PI * 0.5]),
      // Right outer speed ring washer
      transformGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.0015, 12), [0.116, -0.025, 0], [0, 0, Math.PI * 0.5]),
    ];
    createMergedMesh(rearPolishedGeos, matPolishedSteel, 'RealisticTruck_RearPolished', this.rearTruckPivot);
  }
}
