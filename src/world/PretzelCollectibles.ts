import * as THREE from 'three';
import { SurfHUD } from '../ui/SurfHUD';
import { SurfAudio } from '../audio/SurfAudio';

export interface PretzelConfig {
  id: number;
  name: string;
  position: THREE.Vector3;
}

export class PretzelCollectibles {
  public readonly group = new THREE.Group();
  private items: {
    id: number;
    name: string;
    basePos: THREE.Vector3;
    container: THREE.Group;
    mesh: THREE.Mesh;
    light: THREE.PointLight;
    glowRing: THREE.Mesh;
    collected: boolean;
    popping: boolean;
    popTimer: number;
  }[] = [];

  private particleGroup = new THREE.Group();
  private particles: {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
  }[] = [];

  private pretzelGeometry: THREE.BufferGeometry;
  private pretzelMaterial: THREE.MeshStandardMaterial;
  private saltGeometry: THREE.BoxGeometry;
  private saltMaterial: THREE.MeshStandardMaterial;

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
      emissive: 0x3d1a00,
      emissiveIntensity: 0.25,
    });

    this.saltGeometry = new THREE.BoxGeometry(0.016, 0.016, 0.016);
    this.saltMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1,
    });

    this.group.name = 'PretzelCollectibles';
    this.scene.add(this.group);
    this.scene.add(this.particleGroup);

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
      // 1. High NW Over-Vert Cradle Wall Coping (requires maximum speed & wall climb/air)
      { id: 1, name: 'Hohe Cradle-Wand', position: new THREE.Vector3(-6.2, 2.95, -14.6) },
      // 2. East Sunset Palm Mural Quarterpipe Wall (requires speed across the flow basin)
      { id: 2, name: 'Sunset Palm Mural Wall', position: new THREE.Vector3(23.2, 2.75, 4.6) },
      // 3. Central Volcano Dome High Apex (requires fast launch or pop over the crest)
      { id: 3, name: 'Vulkan-Dome', position: new THREE.Vector3(7.6, 2.25, -0.8) },
      // 4. NW Upper Spine Roller Crest (requires high-speed pump or launch over the spine)
      { id: 4, name: 'Spine-Roller', position: new THREE.Vector3(-5.5, 2.20, -7.0) },
      // 5. South-East Deep Bowl High Wall (requires deep bowl carving and pumping to coping)
      { id: 5, name: 'SE Deep Bowl', position: new THREE.Vector3(11.6, 2.35, 19.5) },
    ];

    for (const cfg of configs) {
      const container = new THREE.Group();
      container.position.copy(cfg.position);

      // 1. Pretzel Mesh
      const mesh = new THREE.Mesh(this.pretzelGeometry, this.pretzelMaterial);
      mesh.scale.set(0.68, 0.68, 0.68);
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

      // 2. Subtle Glowing Pickup Halo / Ring
      const ringGeo = new THREE.TorusGeometry(0.55, 0.015, 8, 36);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
      });
      const glowRing = new THREE.Mesh(ringGeo, ringMat);
      glowRing.rotation.x = Math.PI / 2;
      container.add(glowRing);

      // 3. Warm Golden Point Light casting glow onto the concrete bowl at night
      const light = new THREE.PointLight(0xf59e0b, 1.4, 4.2);
      light.position.set(0, 0.1, 0);
      container.add(light);

      this.group.add(container);

      this.items.push({
        id: cfg.id,
        name: cfg.name,
        basePos: cfg.position.clone(),
        container,
        mesh,
        light,
        glowRing,
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
        const progress = item.popTimer / 0.35;
        if (progress >= 1.0) {
          item.popping = false;
          item.container.visible = false;
        } else {
          // Explode / expand and fade out
          const s = 0.68 * (1.0 + progress * 1.4);
          item.mesh.scale.set(s, s, s);
          item.mesh.rotation.y += dt * 12.0;
          item.mesh.position.y += dt * 1.5;
          item.light.intensity = Math.max(0, 1.4 * (1.0 - progress));
          (item.glowRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.65 * (1.0 - progress));
        }
        continue;
      }

      // Idle hover floating bob & gentle spin
      item.container.position.y = item.basePos.y + Math.sin(time * 2.8 + item.id * 1.2) * 0.07;
      item.mesh.rotation.y += dt * 1.6;
      item.glowRing.rotation.z += dt * 1.0;
      item.glowRing.scale.setScalar(1.0 + Math.sin(time * 3.5 + item.id) * 0.08);

      // Collision check with skater: requires skater body/board to reach up towards pretzel altitude
      const dx = skaterPos.x - item.container.position.x;
      const dz = skaterPos.z - item.container.position.z;
      const dy = item.container.position.y - skaterPos.y; // skater body spans y..y+1.8m
      const distXZ = Math.hypot(dx, dz);

      if (distXZ < 1.55 && dy >= -0.45 && dy <= 1.50) {
        this.collectItem(item);
      }
    }

    // Update active particle effects
    this.updateParticles(dt);
  }

  private collectItem(item: (typeof this.items)[0]): void {
    item.collected = true;
    item.popping = true;
    item.popTimer = 0;
    this.collectedCount++;

    const isAllCollected = this.collectedCount === this.totalCount;

    // Spawn golden collection sparkles
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
    const geo = new THREE.SphereGeometry(0.045, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1.0,
    });

    for (let i = 0; i < 28; i++) {
      const p = new THREE.Mesh(geo, mat.clone());
      p.position.copy(pos);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 3.5;
      const up = 1.0 + Math.random() * 3.0;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        up,
        Math.sin(angle) * speed
      );
      this.particleGroup.add(p);
      this.particles.push({
        mesh: p,
        vel,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.4,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particleGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 9.8 * dt; // gravity
      p.mesh.position.addScaledVector(p.vel, dt);
      const progress = p.life / p.maxLife;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1.0 - progress);
      const s = Math.max(0.01, 1.0 - progress * 0.7);
      p.mesh.scale.set(s, s, s);
    }
  }

  public reset(): void {
    this.collectedCount = 0;
    for (const item of this.items) {
      item.collected = false;
      item.popping = false;
      item.popTimer = 0;
      item.container.visible = true;
      item.mesh.scale.set(0.68, 0.68, 0.68);
      item.mesh.position.set(0, 0, 0);
      item.light.intensity = 1.4;
      (item.glowRing.material as THREE.MeshBasicMaterial).opacity = 0.65;
    }
    // Clear particles
    for (const p of this.particles) {
      this.particleGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
    this.hud.updatePretzelCount(this.collectedCount, this.totalCount);
  }
}
