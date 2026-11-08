import * as THREE from 'three';
import { SurfHUD } from '../ui/SurfHUD';
import { SurfAudio } from '../audio/SurfAudio';
import { track } from '@vercel/analytics';

export interface PretzelConfig {
  id: number;
  name: string;
  position: THREE.Vector3;
}

interface BurstParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

interface PretzelItem {
  id: number;
  name: string;
  basePos: THREE.Vector3;
  container: THREE.Group;
  mesh: THREE.Mesh;
  glowRing: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  collected: boolean;
  popping: boolean;
  popTimer: number;
}

export class PretzelCollectibles {
  public readonly group = new THREE.Group();
  private items: PretzelItem[] = [];

  // Zero-allocation particle pool via single InstancedMesh
  private static readonly MAX_BURST_PARTICLES = 64;
  private burstMesh: THREE.InstancedMesh;
  private burstParticles: BurstParticle[] = [];
  private dummyObj = new THREE.Object3D();

  private pretzelGeometry: THREE.BufferGeometry;
  private pretzelMaterial: THREE.MeshStandardMaterial;
  private saltGeometry: THREE.BoxGeometry;
  private saltMaterial: THREE.MeshStandardMaterial;
  private ringGeometry: THREE.TorusGeometry;
  private particleGeometry: THREE.IcosahedronGeometry;
  private particleMaterial: THREE.MeshBasicMaterial;

  public static readonly PRETZEL_SCALE = 0.42;
  private static readonly POP_DURATION = 0.38;

  public collectedCount = 0;
  public readonly totalCount = 5;

  constructor(
    private scene: THREE.Scene,
    private hud: SurfHUD,
    private audio: SurfAudio
  ) {
    this.pretzelGeometry = this.buildPretzelGeometry();
    this.pretzelMaterial = new THREE.MeshStandardMaterial({
      color: 0x9c4e0e, // Warm Bavarian baked lye crust
      roughness: 0.32,
      metalness: 0.06,
      emissive: 0x4a2202,
      emissiveIntensity: 0.32,
    });

    this.saltGeometry = new THREE.BoxGeometry(0.016, 0.016, 0.016);
    this.saltMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1,
    });

    this.ringGeometry = new THREE.TorusGeometry(0.38, 0.012, 8, 36);

    // Pre-allocated particle system: 1 single draw call, zero runtime allocations
    this.particleGeometry = new THREE.IcosahedronGeometry(0.045, 1);
    this.particleMaterial = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    this.burstMesh = new THREE.InstancedMesh(
      this.particleGeometry,
      this.particleMaterial,
      PretzelCollectibles.MAX_BURST_PARTICLES
    );
    this.burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.burstMesh.frustumCulled = false;

    // Initialize particle pool matrices hidden (scale 0)
    this.dummyObj.scale.set(0, 0, 0);
    this.dummyObj.position.set(0, -9999, 0);
    this.dummyObj.updateMatrix();

    for (let i = 0; i < PretzelCollectibles.MAX_BURST_PARTICLES; i++) {
      this.burstMesh.setMatrixAt(i, this.dummyObj.matrix);
      this.burstParticles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1.0,
        baseScale: 1.0,
      });
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;

    this.group.name = 'PretzelCollectibles';
    this.group.add(this.burstMesh);
    this.scene.add(this.group);

    this.spawnPretzels();
  }

  /**
   * Generates a 3D Bavarian Pretzel TubeGeometry with authentic knot and loops.
   */
  private buildPretzelGeometry(): THREE.BufferGeometry {
    const pts = [
      new THREE.Vector3(0, -0.42, 0),
      new THREE.Vector3(0.35, -0.39, 0),
      new THREE.Vector3(0.58, -0.20, 0),
      new THREE.Vector3(0.64, 0.08, 0),
      new THREE.Vector3(0.52, 0.36, 0),
      new THREE.Vector3(0.32, 0.45, 0),
      new THREE.Vector3(0.14, 0.33, 0.025),
      new THREE.Vector3(0.05, 0.14, 0.035),
      new THREE.Vector3(-0.05, 0.02, 0.025),
      new THREE.Vector3(-0.18, -0.10, 0.015),
      new THREE.Vector3(-0.32, -0.25, 0.005),
      new THREE.Vector3(-0.20, -0.41, 0),
      new THREE.Vector3(0.20, -0.41, 0),
      new THREE.Vector3(0.32, -0.25, -0.005),
      new THREE.Vector3(0.18, -0.10, -0.015),
      new THREE.Vector3(0.05, 0.02, -0.025),
      new THREE.Vector3(-0.05, 0.14, -0.035),
      new THREE.Vector3(-0.14, 0.33, -0.025),
      new THREE.Vector3(-0.32, 0.45, 0),
      new THREE.Vector3(-0.52, 0.36, 0),
      new THREE.Vector3(-0.64, 0.08, 0),
      new THREE.Vector3(-0.58, -0.20, 0),
      new THREE.Vector3(-0.35, -0.39, 0),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, true);
    // Tube radius 0.055, 96 segments along curve
    const geo = new THREE.TubeGeometry(curve, 96, 0.058, 12, true);
    geo.computeVertexNormals();
    return geo;
  }

  private spawnPretzels(): void {
    // 5 High-Altitude Signature Spots across Skatepark "Im Gefilde"
    // Placed high up on transition walls, domes and coping so players must build speed and pump to reach them
    const configs: PretzelConfig[] = [
      // 1. High NW Over-Vert Cradle Wall Coping (requires maximum speed & wall climb/air to the high coping)
      { id: 1, name: 'Hohe Cradle-Wand', position: new THREE.Vector3(-6.4, 3.15, -15.4) },
      // 2. East Sunset Palm Mural Quarterpipe Wall (requires speed across the flow basin to hit the wall lip)
      { id: 2, name: 'Sunset Palm Mural Wall', position: new THREE.Vector3(23.2, 1.65, 2.7) },
      // 3. Central Volcano Dome High Apex (requires fast launch or pop over the crest)
      { id: 3, name: 'Vulkan-Dome', position: new THREE.Vector3(6.8, 2.30, -1.2) },
      // 4. NW Upper Spine Roller Crest (requires high-speed pump or launch over the spine)
      { id: 4, name: 'Spine-Roller', position: new THREE.Vector3(-4.0, 2.25, -6.0) },
      // 5. South-East Deep Bowl High Wall Coping (requires deep bowl carving and pumping to coping)
      { id: 5, name: 'SE Deep Bowl', position: new THREE.Vector3(12.8, 3.10, 21.8) },
    ];

    for (const cfg of configs) {
      const container = new THREE.Group();
      container.position.copy(cfg.position);

      // 1. Pretzel Mesh (compact, authentic Bavarian size)
      const mesh = new THREE.Mesh(this.pretzelGeometry, this.pretzelMaterial);
      mesh.scale.set(PretzelCollectibles.PRETZEL_SCALE, PretzelCollectibles.PRETZEL_SCALE, PretzelCollectibles.PRETZEL_SCALE);
      mesh.castShadow = true;
      container.add(mesh);

      // Scatter coarse salt crystals on the top arch
      const saltGroup = new THREE.Group();
      const saltPositions = [
        new THREE.Vector3(-0.18, 0.28, 0.04),
        new THREE.Vector3(0.18, 0.28, -0.04),
        new THREE.Vector3(-0.32, 0.22, 0.03),
        new THREE.Vector3(0.32, 0.22, -0.03),
        new THREE.Vector3(0, -0.28, 0.04),
        new THREE.Vector3(-0.16, -0.26, 0.04),
        new THREE.Vector3(0.16, -0.26, 0.04),
        new THREE.Vector3(-0.25, -0.22, 0.03),
        new THREE.Vector3(0.25, -0.22, 0.03),
      ];
      for (const sp of saltPositions) {
        const salt = new THREE.Mesh(this.saltGeometry, this.saltMaterial);
        salt.position.copy(sp);
        salt.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        saltGroup.add(salt);
      }
      mesh.add(saltGroup);

      // 2. Glowing Pickup Halo / Ring sized to the pretzel (NO PointLight!)
      // PointLights cause synchronous Three.js WebGL shader recompiles when toggled.
      // Emissive materials + additive halo give a brilliant glow without any shader recompile hitch.
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowRing = new THREE.Mesh(this.ringGeometry, ringMaterial);
      glowRing.rotation.x = Math.PI / 2;
      container.add(glowRing);

      this.group.add(container);

      this.items.push({
        id: cfg.id,
        name: cfg.name,
        basePos: cfg.position.clone(),
        container,
        mesh,
        glowRing,
        ringMaterial,
        collected: false,
        popping: false,
        popTimer: 0,
      });
    }

    this.hud.updatePretzelCount(this.collectedCount, this.totalCount);
  }

  public update(dt: number, skaterPos: THREE.Vector3): void {
    const time = performance.now() * 0.001;

    for (const item of this.items) {
      if (item.collected && !item.popping) continue;

      if (item.popping) {
        item.popTimer += dt;
        const progress = item.popTimer / PretzelCollectibles.POP_DURATION;
        if (progress >= 1.0) {
          item.popping = false;
          item.mesh.visible = false;
          item.glowRing.visible = false;
        } else {
          // Zero-allocation, smooth celebratory pop animation:
          // 1. Gently lift upward
          item.mesh.position.y = progress * 1.5;
          // 2. Rapid spin
          item.mesh.rotation.y += dt * 14.0;
          // 3. Smooth expansion then collapse to 0
          const popScale = PretzelCollectibles.PRETZEL_SCALE * (1.0 + Math.sin(progress * Math.PI) * 0.35) * (1.0 - progress);
          item.mesh.scale.set(popScale, popScale, popScale);
          // 4. Halo ring expands and fades out smoothly
          const ringScale = 1.0 + progress * 2.4;
          item.glowRing.scale.set(ringScale, ringScale, ringScale);
          item.ringMaterial.opacity = Math.max(0, 0.65 * (1.0 - progress));
        }
        continue;
      }

      // Idle hover floating bob & gentle spin
      item.container.position.y = item.basePos.y + Math.sin(time * 2.8 + item.id * 1.2) * 0.07;
      item.mesh.rotation.y += dt * 1.6;
      item.glowRing.rotation.z += dt * 1.0;
      item.glowRing.scale.setScalar(1.0 + Math.sin(time * 3.5 + item.id) * 0.08);

      // Collision check with skater: tighter skill-based radius requiring high pump speed / air and accuracy
      const dx = skaterPos.x - item.container.position.x;
      const dz = skaterPos.z - item.container.position.z;
      const dy = item.container.position.y - skaterPos.y;
      const distXZ = Math.hypot(dx, dz);

      // Skateboard must reach within pretzel altitude (no ground roll skimming) and within range horizontally
      if (distXZ < 1.15 && dy >= -0.45 && dy <= 1.25) {
        this.collectItem(item);
      }
    }

    // Update active particle effects via InstancedMesh (zero GC, single draw call)
    this.updateParticles(dt);
  }

  private collectItem(item: PretzelItem): void {
    item.collected = true;
    item.popping = true;
    item.popTimer = 0;
    this.collectedCount++;
    const isAllCollected = this.collectedCount === this.totalCount;

    try {
      track('pretzel_collect', { count: this.collectedCount, all: isAllCollected });
    } catch {}

    // Spawn golden collection sparkles from pre-allocated object pool
    this.emitCollectBurst(item.container.position);

    // Audio feedback
    this.audio.playPretzelPickup(isAllCollected);

    if (isAllCollected) {
      // 500 bonus points for finding all 5 pretzels!
      this.hud.addBonusScore(50 + 500);
      this.hud.showTrickBanner('🥨 ALLE BRETZELN! +500 BONUS!', true);
    } else {
      // 50 points per pretzel
      this.hud.addBonusScore(50);
      this.hud.showTrickBanner(`🥨 BRETZEL! +50 (${this.collectedCount}/${this.totalCount})`, false);
    }

    this.hud.updatePretzelCount(this.collectedCount, this.totalCount);
  }

  private emitCollectBurst(pos: THREE.Vector3): void {
    const countToEmit = 28;
    let emitted = 0;

    for (let i = 0; i < PretzelCollectibles.MAX_BURST_PARTICLES && emitted < countToEmit; i++) {
      const p = this.burstParticles[i];
      if (p.active) continue;

      p.active = true;
      p.pos.copy(pos);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 3.6;
      const up = 1.2 + Math.random() * 3.2;
      p.vel.set(
        Math.cos(angle) * speed,
        up,
        Math.sin(angle) * speed
      );
      p.life = 0;
      p.maxLife = 0.55 + Math.random() * 0.35;
      p.baseScale = 0.8 + Math.random() * 0.5;
      emitted++;
    }
  }

  private updateParticles(dt: number): void {
    let anyActive = false;

    for (let i = 0; i < PretzelCollectibles.MAX_BURST_PARTICLES; i++) {
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
      p.vel.y -= 9.8 * dt; // gravity
      p.pos.addScaledVector(p.vel, dt);

      const progress = p.life / p.maxLife;
      const s = Math.max(0, p.baseScale * (1.0 - progress));
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
    for (let i = 0; i < PretzelCollectibles.MAX_BURST_PARTICLES; i++) {
      this.burstParticles[i].active = false;
      this.burstMesh.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;
  }

  public reset(): void {
    this.collectedCount = 0;
    for (const item of this.items) {
      item.collected = false;
      item.popping = false;
      item.popTimer = 0;
      item.mesh.visible = true;
      item.glowRing.visible = true;
      item.mesh.scale.set(
        PretzelCollectibles.PRETZEL_SCALE,
        PretzelCollectibles.PRETZEL_SCALE,
        PretzelCollectibles.PRETZEL_SCALE
      );
      item.mesh.position.set(0, 0, 0);
      item.ringMaterial.opacity = 0.65;
      item.glowRing.scale.set(1, 1, 1);
    }
    this.resetParticles();
    this.hud.updatePretzelCount(this.collectedCount, this.totalCount);
  }
}
