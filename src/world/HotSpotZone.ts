import * as THREE from 'three';
import { ParkSurface } from '../physics/ParkSurface';

export interface HotSpotDefinition {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

const HOT_SPOTS_BY_PARK: Record<string, HotSpotDefinition[]> = {
  im_gefilde: [
    { id: 'palm_wall', name: '🌴 SUNSET PALM WALL', x: 13.5, z: 4.5, radius: 5.5 },
    { id: 'volcano', name: '🌋 CENTRAL VOLCANO', x: 3.5, z: 1.5, radius: 5.5 },
    { id: 'cradle', name: '🌊 NW OVER-VERT CRADLE', x: -11.0, z: 5.5, radius: 5.5 },
    { id: 'south_pocket', name: '🥨 DEEP SOUTH POCKET', x: 6.5, z: 16.5, radius: 5.5 },
  ],
  airport_skatepark: [
    { id: 'runway_spine', name: '✈️ RUNWAY SPINE', x: 0.0, z: 2.0, radius: 5.5 },
    { id: 'terminal_bowl', name: '🛫 TERMINAL BOWL', x: -6.5, z: -4.5, radius: 5.5 },
    { id: 'tower_ext', name: '🔥 TOWER EXTENSION', x: 6.5, z: -3.0, radius: 5.5 },
    { id: 'gate_hip', name: '⚡ GATE TRANSFER HIP', x: -2.0, z: 8.0, radius: 5.5 },
  ],
};

export class HotSpotZone {
  public readonly group = new THREE.Group();
  public activeSpot: HotSpotDefinition | null = null;
  public activeTimer = 0;
  public isSkaterInZone = false;

  private sessionElapsed = 0;
  private nextSpawnTime = 15.0; // First Hot-Spot after 15s, then every 30s
  private readonly spawnInterval = 30.0;
  private readonly activeDuration = 18.0;
  private lastPickedIdx = -1;
  private enabled = true;
  private parkId = 'im_gefilde';

  private outerRingMesh: THREE.Mesh;
  private innerRingMesh: THREE.Mesh;
  private cylinderMesh: THREE.Mesh;
  private labelSprite: THREE.Sprite;

  private outerRingMat: THREE.MeshBasicMaterial;
  private innerRingMat: THREE.MeshBasicMaterial;
  private cylinderMat: THREE.MeshBasicMaterial;
  private spriteMat: THREE.SpriteMaterial;
  private labelCanvas: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;
  private labelTexture: THREE.CanvasTexture;

  public onHotSpotActivated?: (spot: HotSpotDefinition, durationSec: number) => void;
  public onHotSpotEnded?: () => void;

  constructor(
    private scene: THREE.Scene,
    private parkSurface: ParkSurface
  ) {
    this.group.name = 'HotSpotZoneGroup';
    this.group.visible = false;

    // 1. Terrain-projected Outer & Inner Glowing Rings
    const outerGeo = new THREE.RingGeometry(4.85, 5.5, 48, 1);
    outerGeo.rotateX(-Math.PI / 2);
    this.outerRingMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.outerRingMesh = new THREE.Mesh(outerGeo, this.outerRingMat);
    this.group.add(this.outerRingMesh);

    const innerGeo = new THREE.RingGeometry(3.8, 4.15, 48, 1);
    innerGeo.rotateX(-Math.PI / 2);
    this.innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.innerRingMesh = new THREE.Mesh(innerGeo, this.innerRingMat);
    this.group.add(this.innerRingMesh);

    // 2. Transparent Light Cylinder Beacon
    const cylGeo = new THREE.CylinderGeometry(5.35, 5.35, 3.2, 40, 1, true);
    this.cylinderMat = new THREE.MeshBasicMaterial({
      color: 0xff8c1a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.cylinderMesh = new THREE.Mesh(cylGeo, this.cylinderMat);
    this.group.add(this.cylinderMesh);

    // 3. Floating 3D Sprite ("🔥 2X HOT SPOT!")
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 160;
    this.labelCtx = this.labelCanvas.getContext('2d')!;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.minFilter = THREE.LinearFilter;
    this.spriteMat = new THREE.SpriteMaterial({
      map: this.labelTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.labelSprite = new THREE.Sprite(this.spriteMat);
    this.labelSprite.scale.set(5.4, 1.68, 1);
    this.group.add(this.labelSprite);

    this.renderSpriteText('🔥 2X HOT SPOT!', 'DOUBLE TRICK POINTS');
    this.scene.add(this.group);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.deactivate();
    }
  }

  public setPark(parkId: string): void {
    this.parkId = parkId;
    if (this.activeSpot) {
      this.confromGeometryToSurface(this.activeSpot);
    }
  }

  public reset(): void {
    this.sessionElapsed = 0;
    this.nextSpawnTime = 15.0;
    this.activeTimer = 0;
    this.activeSpot = null;
    this.isSkaterInZone = false;
    this.group.visible = false;
  }

  private deactivate(): void {
    if (this.activeSpot) {
      this.activeSpot = null;
      this.activeTimer = 0;
      this.isSkaterInZone = false;
      this.group.visible = false;
      this.onHotSpotEnded?.();
    }
  }

  public isSkaterInside(pos: THREE.Vector3): boolean {
    if (!this.enabled || !this.activeSpot || this.activeTimer <= 0) {
      return false;
    }
    const distXZ = Math.hypot(pos.x - this.activeSpot.x, pos.z - this.activeSpot.z);
    return distXZ <= this.activeSpot.radius;
  }

  public update(dt: number, timeSec: number, skaterPos: THREE.Vector3, parkId?: string): void {
    if (parkId && parkId !== this.parkId) {
      this.parkId = parkId;
    }

    if (!this.enabled) {
      this.isSkaterInZone = false;
      return;
    }

    this.sessionElapsed += dt;

    // Trigger next Hot-Spot every 30s (first at 15s)
    if (this.sessionElapsed >= this.nextSpawnTime) {
      this.nextSpawnTime += this.spawnInterval;
      this.spawnRandomHotSpot();
    }

    if (!this.activeSpot || this.activeTimer <= 0) {
      this.isSkaterInZone = false;
      return;
    }

    this.activeTimer = Math.max(0, this.activeTimer - dt);
    if (this.activeTimer <= 0) {
      this.deactivate();
      return;
    }

    this.isSkaterInZone = this.isSkaterInside(skaterPos);

    // Pulse animation
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6.5);
    const urgentBlink = this.activeTimer < 4.0 ? (Math.sin(timeSec * 18.0) > 0 ? 1.0 : 0.35) : 1.0;

    this.outerRingMat.color.setHex(this.isSkaterInZone ? 0x00f5d4 : 0xff6b1a);
    this.innerRingMat.color.setHex(this.isSkaterInZone ? 0xfef08a : 0xfacc15);
    this.cylinderMat.color.setHex(this.isSkaterInZone ? 0x00f5d4 : 0xff7b1a);

    this.outerRingMat.opacity = (0.65 + 0.3 * pulse) * urgentBlink;
    this.innerRingMat.opacity = (0.45 + 0.35 * (1 - pulse)) * urgentBlink;
    this.cylinderMat.opacity = (this.isSkaterInZone ? 0.26 : 0.14 + 0.08 * pulse) * urgentBlink;

    const baseH = this.parkSurface.evaluateHeight(this.activeSpot.x, this.activeSpot.z);
    this.labelSprite.position.set(
      this.activeSpot.x,
      baseH + 2.85 + Math.sin(timeSec * 3.2) * 0.22,
      this.activeSpot.z
    );
    const scaleBoost = this.isSkaterInZone ? 1.12 : 1.0 + 0.04 * pulse;
    this.labelSprite.scale.set(5.4 * scaleBoost, 1.68 * scaleBoost, 1);
  }

  private spawnRandomHotSpot(): void {
    const spots = HOT_SPOTS_BY_PARK[this.parkId] || HOT_SPOTS_BY_PARK.im_gefilde;
    if (!spots || spots.length === 0) return;

    let idx = Math.floor(Math.random() * spots.length);
    if (spots.length > 1 && idx === this.lastPickedIdx) {
      idx = (idx + 1) % spots.length;
    }
    this.lastPickedIdx = idx;

    this.activeSpot = spots[idx];
    this.activeTimer = this.activeDuration;
    this.group.visible = true;

    this.confromGeometryToSurface(this.activeSpot);
    this.renderSpriteText('🔥 2X HOT SPOT!', this.activeSpot.name);
    this.onHotSpotActivated?.(this.activeSpot, this.activeDuration);
  }

  private confromGeometryToSurface(spot: HotSpotDefinition): void {
    // Project ring vertices onto ParkSurface so the ring hugs bowl transitions & volcano domes
    const projectRing = (mesh: THREE.Mesh, rMin: number, rMax: number, yOffset: number) => {
      const geo = new THREE.RingGeometry(rMin, rMax, 48, 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = spot.x + lx;
        const wz = spot.z + lz;
        const wy = this.parkSurface.evaluateHeight(wx, wz) + yOffset;
        pos.setXYZ(i, wx, wy, wz);
      }
      pos.needsUpdate = true;
      mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.position.set(0, 0, 0);
    };

    projectRing(this.outerRingMesh, spot.radius - 0.55, spot.radius, 0.07);
    projectRing(this.innerRingMesh, spot.radius - 1.45, spot.radius - 1.15, 0.08);

    // Also conform cylinder bottom/top to surface height
    const cylGeo = new THREE.CylinderGeometry(spot.radius - 0.15, spot.radius - 0.15, 2.8, 40, 1, true);
    const cPos = cylGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
      const lx = cPos.getX(i);
      const ly = cPos.getY(i); // -1.4 .. +1.4
      const lz = cPos.getZ(i);
      const wx = spot.x + lx;
      const wz = spot.z + lz;
      const groundY = this.parkSurface.evaluateHeight(wx, wz);
      const isTop = ly > 0;
      cPos.setXYZ(i, wx, groundY + (isTop ? 2.5 : 0.05), wz);
    }
    cPos.needsUpdate = true;
    this.cylinderMesh.geometry.dispose();
    this.cylinderMesh.geometry = cylGeo;
    this.cylinderMesh.position.set(0, 0, 0);
  }

  private renderSpriteText(headline: string, subline: string): void {
    const ctx = this.labelCtx;
    const w = this.labelCanvas.width;
    const h = this.labelCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Skewed dark badge background with fiery orange-gold border
    ctx.save();
    ctx.transform(1, 0, -0.18, 1, 24, 0);

    const grad = ctx.createLinearGradient(0, 16, 0, h - 16);
    grad.addColorStop(0, 'rgba(24, 18, 14, 0.92)');
    grad.addColorStop(1, 'rgba(45, 22, 10, 0.92)');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.roundRect(24, 18, w - 76, h - 36, 10);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'italic 900 44px "Barlow Condensed", Impact, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(242, 116, 31, 0.85)';
    ctx.shadowBlur = 12;
    ctx.fillText(headline, (w - 28) / 2, 76);

    ctx.font = '800 26px "Barlow Condensed", Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.fillText(subline, (w - 28) / 2, 116);

    ctx.restore();
    this.labelTexture.needsUpdate = true;
  }
}
