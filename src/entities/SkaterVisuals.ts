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
  private nextParticleIdx = 0;
  private readonly maxParticles = 240;

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

    // Initialize spray & sparks particle system
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleVelocities = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    this.particleLife = new Float32Array(this.maxParticles);

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
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
    const hipsLocal = new THREE.Vector3(0.05 + crouch * 0.06, HIPS_REST_HEIGHT - 0.1 - crouch * 0.3, -0.02);
    hipsLocal.y -= DECK_TOP;
    hipsLocal.applyAxisAngle(AXIS_Z, bodyLean);
    hipsLocal.y += DECK_TOP;
    const hipsWorld = board.localToWorld(hipsLocal.clone());
    b.Hips.position.copy(b.Hips.parent!.worldToLocal(hipsWorld));
    b.Hips.updateMatrixWorld(true);
    this.rotateBoneAxis(b.Hips, boardZ, bodyLean + crouch * 0.18);
    this.rotateBoneAxis(b.Hips, boardY, 0.18 + lead * 0.2); // pelvis slightly open toward the nose

    // 3. Spine: forward bend over the toes when crouching, shoulders lead the turn
    this.rotateBoneAxis(b.Spine, boardZ, crouch * 0.22 + 0.06);
    this.rotateBoneAxis(b.Spine1, boardZ, crouch * 0.14);
    this.rotateBoneAxis(b.Spine1, boardY, lead * 0.3);
    this.rotateBoneAxis(b.Spine2, boardY, 0.22 + lead * 0.35);
    if (ctrl.bertSlideActive) this.rotateBoneAxis(b.Spine2, boardZ, -0.35);

    // 4. Head: keep it level and look down the line toward the nose
    const forwardBend = bodyLean + crouch * 0.54 + 0.06;
    this.rotateBoneAxis(b.Neck, boardZ, -forwardBend * 0.45);
    this.rotateBoneAxis(b.Head, boardZ, -forwardBend * 0.4);
    this.rotateBoneAxis(b.Head, boardY, 0.62 + lead * 0.35);

    // 5. Arms: front arm reaches toward the nose, back arm trails for balance
    const armLift = crouch * 0.3;
    this.aimBone(b.LeftArm, b.LeftForeArm, this.boardDir(-0.3, -0.62 + armLift - lean * 0.35, 0.72));
    this.aimBone(b.LeftForeArm, b.LeftHand, this.boardDir(-0.45, -0.25 + armLift, 0.85));
    if (ctrl.bertSlideActive) {
      // Hand plant on the heel side for the Bert slide
      this.aimBone(b.RightArm, b.RightForeArm, this.boardDir(0.55, -0.82, -0.1));
      this.aimBone(b.RightForeArm, b.RightHand, this.boardDir(0.45, -0.9, 0.0));
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

    const forward = new THREE.Vector3(-Math.sin(ctrl.heading), 0, -Math.cos(ctrl.heading)).normalize();
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

  private updateParticlesAndTrail(
    dt: number,
    ctrl: SurfskateController,
    right: THREE.Vector3,
    up: THREE.Vector3
  ): void {
    // Emit particles during lip snaps, Bert slides, or coping grinds
    if (ctrl.sprayIntensity > 0.15 || ctrl.isGrinding) {
      const count = ctrl.isGrinding ? 6 : 4;
      for (let i = 0; i < count; i++) {
        const idx = this.nextParticleIdx;
        this.nextParticleIdx = (this.nextParticleIdx + 1) % this.maxParticles;

        const tailOffset = new THREE.Vector3(
          Math.sin(ctrl.heading) * 0.28 + (Math.random() - 0.5) * 0.2,
          0.08,
          Math.cos(ctrl.heading) * 0.28 + (Math.random() - 0.5) * 0.2
        );
        this.particlePositions[idx * 3 + 0] = ctrl.position.x + tailOffset.x;
        this.particlePositions[idx * 3 + 1] = ctrl.position.y + tailOffset.y;
        this.particlePositions[idx * 3 + 2] = ctrl.position.z + tailOffset.z;

        const sideSpray = -Math.sign(ctrl.leanAngle || 1) * (1.8 + Math.random() * 2.2);
        this.particleVelocities[idx * 3 + 0] = right.x * sideSpray + (Math.random() - 0.5) * 1.4;
        this.particleVelocities[idx * 3 + 1] = 1.4 + Math.random() * 2.4;
        this.particleVelocities[idx * 3 + 2] = right.z * sideSpray + (Math.random() - 0.5) * 1.4;

        if (ctrl.isGrinding) {
          // Golden-orange coping sparks!
          this.particleColors[idx * 3 + 0] = 1.0;
          this.particleColors[idx * 3 + 1] = 0.72 + Math.random() * 0.25;
          this.particleColors[idx * 3 + 2] = 0.15;
        } else {
          // Cyan/white urethane & concrete surf spray!
          this.particleColors[idx * 3 + 0] = 0.65;
          this.particleColors[idx * 3 + 1] = 0.95;
          this.particleColors[idx * 3 + 2] = 1.0;
        }
        this.particleLife[idx] = 0.45 + Math.random() * 0.25;
      }
    }

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particleLife[i] > 0) {
        this.particleLife[i] -= dt;
        this.particleVelocities[i * 3 + 1] -= 9.8 * dt;
        this.particlePositions[i * 3 + 0] += this.particleVelocities[i * 3 + 0] * dt;
        this.particlePositions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * dt;
        this.particlePositions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * dt;
      } else {
        this.particlePositions[i * 3 + 1] = -999;
      }
    }
    this.particleMesh.geometry.attributes.position.needsUpdate = true;
    this.particleMesh.geometry.attributes.color.needsUpdate = true;

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
