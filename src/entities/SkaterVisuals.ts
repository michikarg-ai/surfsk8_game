import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SurfskateController } from '../physics/SurfskateController';

type Side = 'Left' | 'Right';

// Board-local frame (glTF / three.js): +Z = nose, -X = the skater's facing (toe-side) edge, +Y = up.
const DECK_TOP = 0.162;
/** Height of the ankle joint above the sole of the shoe. */
const ANKLE_HEIGHT = 0.126;
/** Regular stance: left (front) foot toward the nose, right (back) foot over the tail. */
const ANKLE_TARGETS: Record<Side, THREE.Vector3> = {
  Left: new THREE.Vector3(0.07, DECK_TOP + ANKLE_HEIGHT, 0.17),
  Right: new THREE.Vector3(0.07, DECK_TOP + ANKLE_HEIGHT, -0.21),
};
/** Toe angle of each foot (radians about the deck's up axis, + = toes toward the nose). */
const TOE_YAW: Record<Side, number> = { Left: 0.32, Right: 0.06 };
/** Pelvis height above the board origin in the rest (standing) pose. */
const HIPS_REST_HEIGHT = 1.183;

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

  // Skeleton of the rigged human (Mixamo-style bone names)
  private bones: Record<string, THREE.Bone> = {};
  private restQuat = new Map<THREE.Bone, THREE.Quaternion>();
  private restPos = new Map<THREE.Bone, THREE.Vector3>();
  private legLengths: Record<Side, { upper: number; lower: number }> = {
    Left: { upper: 0.46, lower: 0.44 },
    Right: { upper: 0.46, lower: 0.44 },
  };
  private footRestInDeck: Record<Side, THREE.Quaternion> = {
    Left: new THREE.Quaternion(),
    Right: new THREE.Quaternion(),
  };
  private hasSkeleton = false;
  private smoothCompression = 0.15;
  private smoothLean = 0;

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
  private readonly maxTrailSegments = 90;
  private trailHead = 0;

  // Soft contact ambient-occlusion shadow directly beneath the surfskate deck
  private contactShadowMesh: THREE.Mesh;

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

    // Initialize urethane carve line ribbon
    this.trailPositions = new Float32Array(this.maxTrailSegments * 2 * 3);
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
    const tMat = new THREE.MeshBasicMaterial({
      color: 0x1b1e22,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.trailMesh = new THREE.Mesh(tGeo, tMat);
    this.trailMesh.frustumCulled = false;
    scene.add(this.trailMesh);
  }

  public async load(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('/models/skater.glb');
    this.modelRoot = gltf.scene;

    this.modelRoot.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // Skinned meshes deform far from their bind-pose bounds; never cull them
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) child.frustumCulled = false;
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

    // Rotate the skater and skateboard 180 degrees so the nose and front foot face forward
    this.modelRoot.rotation.y = Math.PI;
    this.root.add(this.modelRoot);

    // Measure the rig in its rest pose
    const required = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
      'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
    this.hasSkeleton = required.every((n) => !!this.bones[n]) && !!this.deckMesh && !!this.boardGroup;
    if (this.hasSkeleton) {
      this.root.updateMatrixWorld(true);
      const deckQ = this.deckMesh!.getWorldQuaternion(new THREE.Quaternion());
      for (const side of ['Left', 'Right'] as Side[]) {
        const hip = this.worldPos(this.bones[`${side}UpLeg`]);
        const knee = this.worldPos(this.bones[`${side}Leg`]);
        const ankle = this.worldPos(this.bones[`${side}Foot`]);
        this.legLengths[side] = { upper: hip.distanceTo(knee), lower: knee.distanceTo(ankle) };
        const footQ = this.bones[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion());
        this.footRestInDeck[side] = deckQ.clone().invert().multiply(footQ);
      }
    }
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

  /** Pose the whole skeleton for the current riding state. */
  private poseSkeleton(ctrl: SurfskateController, dt: number): void {
    const b = this.bones;
    const board = this.boardGroup!;
    const deck = this.deckMesh!;

    // Smooth the inputs a little so the body motion stays fluid
    const k = Math.min(1, dt * 14);
    this.smoothCompression += (ctrl.compression - this.smoothCompression) * k;
    this.smoothLean += (ctrl.leanAngle - this.smoothLean) * k;
    const crouch = this.smoothCompression;
    const lean = this.smoothLean;
    const lead = ctrl.upperBodyLeadYaw;
    const lay = ctrl.laybackAmount; // 0..1 layback body pose

    // 1. Reset to rest pose
    for (const bone of Object.values(b)) {
      bone.quaternion.copy(this.restQuat.get(bone)!);
      bone.position.copy(this.restPos.get(bone)!);
    }
    this.root.updateMatrixWorld(true);

    const boardZ = this.boardDir(0, 0, 1); // nose
    const boardY = this.boardDir(0, 1, 0); // up
    const bodyLean = lean * 0.85; // whole body leans into the rail with the deck

    // 2. Pelvis: lowered by knee bend, centred between the feet, rolled into the carve
    const hipsLocal = new THREE.Vector3(
      0.05 + crouch * 0.06 + lay * 0.12,
      HIPS_REST_HEIGHT - 0.1 - crouch * 0.3 - lay * 0.12,
      -0.02
    );
    hipsLocal.y -= DECK_TOP;
    hipsLocal.applyAxisAngle(AXIS_Z, bodyLean);
    hipsLocal.y += DECK_TOP;
    const hipsWorld = board.localToWorld(hipsLocal.clone());
    b.Hips.position.copy(b.Hips.parent!.worldToLocal(hipsWorld));
    b.Hips.updateMatrixWorld(true);
    this.rotateBoneAxis(b.Hips, boardZ, bodyLean + crouch * 0.18 - lay * 0.3);
    this.rotateBoneAxis(b.Hips, boardY, 0.18 + lead * 0.2); // pelvis slightly open toward the nose

    // 3. Spine: forward bend over the toes when crouching, shoulders lead the turn.
    //    In a layback the whole upper body lays back over the heel-side rail.
    this.rotateBoneAxis(b.Spine, boardZ, crouch * 0.22 + 0.06 - lay * 0.45);
    this.rotateBoneAxis(b.Spine1, boardZ, crouch * 0.14 - lay * 0.35);
    this.rotateBoneAxis(b.Spine1, boardY, lead * 0.3);
    this.rotateBoneAxis(b.Spine2, boardY, 0.22 + lead * 0.35 + lay * 0.3);
    if (ctrl.bertSlideActive) this.rotateBoneAxis(b.Spine2, boardZ, -0.35);

    // 4. Head: keep it level and look down the line toward the nose
    const forwardBend = bodyLean + crouch * 0.54 + 0.06 - lay * 1.1;
    this.rotateBoneAxis(b.Neck, boardZ, -forwardBend * 0.45);
    this.rotateBoneAxis(b.Head, boardZ, -forwardBend * 0.4);
    this.rotateBoneAxis(b.Head, boardY, 0.62 + lead * 0.35);

    // 5. Arms: front arm reaches toward the nose, back arm trails for balance
    const armLift = crouch * 0.3;
    this.aimBone(b.LeftArm, b.LeftForeArm, this.boardDir(-0.3, -0.62 + armLift - lean * 0.35 + lay * 0.6, 0.72));
    this.aimBone(b.LeftForeArm, b.LeftHand, this.boardDir(-0.45, -0.25 + armLift + lay * 0.5, 0.85));
    if (ctrl.bertSlideActive) {
      // Hand plant on the inside of the turn for the Bert slide
      const side = -ctrl.bertSlideHandSide; // + lean (toe-side turn) -> hand on the toe side (-X)
      this.aimBone(b.RightArm, b.RightForeArm, this.boardDir(0.55 * side, -0.82, -0.1));
      this.aimBone(b.RightForeArm, b.RightHand, this.boardDir(0.45 * side, -0.9, 0.0));
    } else if (lay > 0.35) {
      // Layback: back hand drags on the concrete behind the heel-side rail
      this.aimBone(b.RightArm, b.RightForeArm, this.boardDir(0.6, -0.75, -0.35));
      this.aimBone(b.RightForeArm, b.RightHand, this.boardDir(0.4, -0.9, -0.2));
    } else {
      this.aimBone(b.RightArm, b.RightForeArm, this.boardDir(-0.2, -0.82 + armLift + lean * 0.3, -0.5));
      this.aimBone(b.RightForeArm, b.RightHand, this.boardDir(-0.5, -0.55 + armLift, -0.45));
    }

    // 6. Legs: two-bone IK onto the (rolling) deck, knees driving toward the toe-side rail
    const deckQ = deck.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['Left', 'Right'] as Side[]) {
      const target = deck.localToWorld(ANKLE_TARGETS[side].clone());
      const pole = this.boardDir(-1, -0.15, side === 'Left' ? 0.25 : -0.1);
      this.solveLeg(side, target, pole);
      // Feet stay flat on the griptape
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

    // 2. Deck Lean (`DeckMesh`)
    if (this.deckMesh) {
      this.deckMesh.rotation.set(0, 0, ctrl.leanAngle);
    }

    // 3. Dual-Axis Front Surf-Adapter Truck (`FrontTruckPivot`) & Rear Truck (`RearTruckPivot`)
    if (this.frontTruckPivot) {
      this.frontTruckPivot.rotation.set(0, -ctrl.frontTruckYaw, ctrl.leanAngle * 0.35);
    }
    if (this.rearTruckPivot) {
      this.rearTruckPivot.rotation.set(0, -ctrl.rearTruckYaw, ctrl.leanAngle * 0.2);
    }

    // 4. Full-body skeletal surf pose (leg IK on the deck, crouch, lean, torso twist, arms, head)
    if (this.hasSkeleton) {
      this.poseSkeleton(ctrl, dt);
    }

    // 5. Update Spray / Coping Spark Particles & Carve Ribbon Trail
    this.updateParticlesAndTrail(dt, ctrl, right, up);
  }

  /** Spawn one particle of the given kind at the board's rail / tail. */
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

    // Origin: along the outside rail, biased toward the tail
    const along = -0.32 + r() * 0.42;
    const p = ctrl.position
      .clone()
      .addScaledVector(fwd, along)
      .addScaledVector(right, side * (0.12 + r() * 0.05))
      .addScaledVector(up, 0.05 + r() * 0.04);
    this.particlePositions[i3] = p.x;
    this.particlePositions[i3 + 1] = p.y;
    this.particlePositions[i3 + 2] = p.z;

    // Velocity: a curved fan thrown outward + up, trailing behind the board
    const speedCarry = Math.min(1.5, ctrl.speed * 0.15);
    let out: number, lift: number, back: number, jitter: number;
    if (kind === 2) {
      out = (r() - 0.5) * 3; lift = 0.8 + r() * 2.2; back = 1.5 + r() * 2.5; jitter = 1.2;
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
      // Hot golden-orange coping sparks
      cr = 1.0; cg = 0.55 + r() * 0.35; cb = 0.12;
      size = 0.035 + r() * 0.03; life = 0.25 + r() * 0.25; alpha = 1.0;
    } else if (kind === 1) {
      // Warm sunset-orange glow puff
      cr = 1.0; cg = 0.42 + r() * 0.12; cb = 0.1;
      size = 0.3 + r() * 0.3; life = 0.8 + r() * 0.6; alpha = 0.26 + r() * 0.14;
    } else {
      // Glowing orange spray droplets (deep orange to golden)
      const w = r();
      cr = 1.0; cg = 0.38 + w * 0.4; cb = 0.06 + w * 0.12;
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
      for (let i = 0; i < 5; i++) this.emitParticle(2, ctrl, fwd, right, up, side);
    } else if (spray > 0.15) {
      // Fresh burst when a trick starts (spray jumps up), then a steady fan while it lasts
      const burst = spray > 0.9 && this.prevSpray < 0.5 ? 80 : 0;
      const droplets = burst + Math.round(10 * spray);
      for (let i = 0; i < droplets; i++) this.emitParticle(0, ctrl, fwd, right, up, side);
      const mist = (burst ? 16 : 0) + (Math.random() < spray ? 2 : 0);
      for (let i = 0; i < mist; i++) this.emitParticle(1, ctrl, fwd, right, up, side);
    }
    this.prevSpray = spray;

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

      // Shift trail vertices down
      for (let i = this.maxTrailSegments - 1; i > 0; i--) {
        const dst = i * 6;
        const src = (i - 1) * 6;
        for (let k = 0; k < 6; k++) {
          this.trailPositions[dst + k] = this.trailPositions[src + k];
        }
      }
      this.trailPositions[0] = pL.x;
      this.trailPositions[1] = pL.y;
      this.trailPositions[2] = pL.z;
      this.trailPositions[3] = pR.x;
      this.trailPositions[4] = pR.y;
      this.trailPositions[5] = pR.z;
      this.trailHead++;
      this.trailMesh.geometry.attributes.position.needsUpdate = true;
    }
  }
}
