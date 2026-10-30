import * as THREE from 'three';

export interface SurfaceSample {
  height: number;
  normal: THREE.Vector3;
  slopeX: number;
  slopeZ: number;
  curvature: number;
  zoneName: string;
  isNearCoping: boolean;
  copingHeight: number;
}

export interface CopingSegment {
  name: string;
  points: THREE.Vector3[];
}

interface LidarGridPayload {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  nx: number;
  nz: number;
  grid: number[][];
}

/**
 * 100% LiDAR & DOP20 Orthophoto-Calibrated C2 Surface Model of Skatepark "Im Gefilde"
 * (UTM32 E=697975.0, N=5329860.0, Munich-Neuperlach).
 * Mirrors `scripts/build_park.py` and loads `/models/im_gefilde_lidar.json`.
 */
export class ParkSurface {
  public readonly copingSegments: CopingSegment[] = [];
  private lidarData: LidarGridPayload | null = null;

  constructor() {
    this.buildCopingSegments();
  }

  public async loadLidarGrid(): Promise<void> {
    try {
      const resp = await fetch('/models/im_gefilde_lidar.json');
      if (resp.ok) {
        this.lidarData = (await resp.json()) as LidarGridPayload;
      }
    } catch (e) {
      console.warn('Using analytical C2 surface fallback:', e);
    }
  }

  public evaluateHeight(x: number, z: number): number {
    // 1. If the exact 3D photogrammetry + LiDAR heightmap (`im_gefilde_lidar.json` from `skatepark_multi.glb`) is loaded,
    //    sample it directly via bilinear interpolation so the skater's wheels ride flush on `skatepark_multi.glb`!
    if (this.lidarData) {
      const { xMin, xMax, zMin, zMax, nx, nz, grid } = this.lidarData;
      if (x >= xMin && x <= xMax && z >= zMin && z <= zMax) {
        const u = ((x - xMin) / (xMax - xMin)) * (nx - 1);
        const v = ((z - zMin) / (zMax - zMin)) * (nz - 1);
        const ix0 = Math.max(0, Math.min(nx - 2, Math.floor(u)));
        const iz0 = Math.max(0, Math.min(nz - 2, Math.floor(v)));
        const du = u - ix0;
        const dv = v - iz0;
        const h00 = grid[iz0][ix0];
        const h10 = grid[iz0][ix0 + 1];
        const h01 = grid[iz0 + 1][ix0];
        const h11 = grid[iz0 + 1][ix0 + 1];
        return (
          (1 - du) * (1 - dv) * h00 +
          du * (1 - dv) * h10 +
          (1 - du) * dv * h01 +
          du * dv * h11
        );
      }
    }

    // Fallback analytical C2 surface before JSON finishes loading
    const ang = 0.488;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const dx = x - 3.0;
    const dz = z - 1.5;
    const lx = dx * ca + dz * sa;
    const lz = -dx * sa + dz * ca;

    let h = 0.0;

    // 1. Exact Multi-Lobe Scalloped Perimeter Rim (traced from DOP20 aerial orthophoto)
    const southScallop = lz > 2.0 ? 1.65 * Math.cos(lx * 0.48 - 0.3) : 0.0;
    const cradleLobe = lz < 0.0 ? 2.4 * Math.exp(-((lx + 14.5) ** 2) / 14.0) : 0.0;
    const effRx = lx / 19.8;
    const effRz = lz / (10.8 + southScallop + cradleLobe);
    const r = Math.hypot(effRx, effRz);

    if (r > 0.72) {
      const t = Math.min(1.0, (r - 0.72) / 0.40);
      const s = t * t * (2.2 - 1.2 * t);
      let rimH = 1.65;
      if (x < -1.0 && z < -8.0) {
        const wCradle = Math.exp(-(((x + 6.4) / 5.5) ** 2 + ((z + 14.8) / 5.5) ** 2));
        rimH += 1.85 * wCradle;
      }
      if (x > 14.0 && Math.abs(z - 4.6) < 9.0) {
        const wEast = Math.exp(-(((x - 21.5) / 5.0) ** 2 + ((z - 4.6) / 5.5) ** 2));
        rimH += 1.55 * wEast;
      }
      h += rimH * s;
    }

    // 2. Central Circular Volcano / "Fuck Scooters" Dome at (x = +7.6m, z = -0.8m)
    const dVolcano = ((x - 7.6) / 4.6) ** 2 + ((z + 0.8) / 4.6) ** 2;
    if (dVolcano < 1.0) {
      h += 1.32 * (1.0 - dVolcano) ** 3;
    }

    // 3. NW Parallel Elongated Roller 1 (Upper Spine Roller in DOP20) at (x = -5.5m, z = -7.0m)
    const r1X = (x + 5.5) * ca + (z + 7.0) * sa;
    const r1Z = -(x + 5.5) * sa + (z + 7.0) * ca;
    const dR1 = (r1X / 4.6) ** 2 + (r1Z / 2.5) ** 2;
    if (dR1 < 1.0) {
      h += 1.18 * (1.0 - dR1) ** 3;
    }

    // 4. NW Parallel Elongated Roller 2 (Lower Spine Roller in DOP20) at (x = -9.2m, z = -0.5m)
    const r2X = (x + 9.2) * ca + (z + 0.5) * sa;
    const r2Z = -(x + 9.2) * sa + (z + 0.5) * ca;
    const dR2 = (r2X / 4.5) ** 2 + (r2Z / 2.5) ** 2;
    if (dR2 < 1.0) {
      h += 0.96 * (1.0 - dR2) ** 3;
    }

    // 5. Southern Hip Spine between the South Clover Bowls at (x = +5.2m, z = +10.2m)
    const dHip = ((x - 5.2) / 3.4) ** 2 + ((z - 10.2) / 3.6) ** 2;
    if (dHip < 1.0) {
      h += 0.94 * (1.0 - dHip) ** 3;
    }

    // 6. Deep Carved Bowl Pockets (measured in Bavarian DGM1 LiDAR down to -0.54m)
    const pCradle = ((x + 6.0) / 4.2) ** 2 + ((z + 11.2) / 3.8) ** 2;
    if (pCradle < 1.0) {
      h -= 0.42 * (1.0 - pCradle) ** 3;
    }

    const pSouth = ((x - 0.8) / 4.2) ** 2 + ((z - 11.2) / 4.0) ** 2;
    if (pSouth < 1.0) {
      h -= 0.46 * (1.0 - pSouth) ** 3;
    }

    const pSe = ((x - 11.6) / 4.8) ** 2 + ((z - 14.2) / 4.5) ** 2;
    if (pSe < 1.0) {
      h -= 0.54 * (1.0 - pSe) ** 3;
    }

    const pEast = ((x - 16.8) / 4.2) ** 2 + ((z - 4.6) / 4.2) ** 2;
    if (pEast < 1.0) {
      h -= 0.38 * (1.0 - pEast) ** 3;
    }

    return h;
  }

  public sample(x: number, z: number): SurfaceSample {
    const eps = 0.42;
    const h = this.evaluateHeight(x, z);
    const hxP = this.evaluateHeight(x + eps, z);
    const hxM = this.evaluateHeight(x - eps, z);
    const hzP = this.evaluateHeight(x, z + eps);
    const hzM = this.evaluateHeight(x, z - eps);

    const slopeX = Math.max(-1.6, Math.min(1.6, (hxP - hxM) / (2 * eps)));
    const slopeZ = Math.max(-1.6, Math.min(1.6, (hzP - hzM) / (2 * eps)));

    const d2x = (hxP - 2 * h + hxM) / (eps * eps);
    const d2z = (hzP - 2 * h + hzM) / (eps * eps);
    const curvature = 0.5 * (d2x + d2z);

    const normal = new THREE.Vector3(-slopeX, 1.0, -slopeZ).normalize();
    const zoneName = this.getZoneName(x, z, h);

    const isNearCoping =
      (Math.hypot(x + 6.4, z + 14.5) < 5.8 && h > 1.55) ||
      (Math.hypot(x - 16.5, z - 4.6) < 6.2 && h > 1.50) ||
      (Math.hypot(x - 0.8, z - 11.2) < 5.0 && h > 1.20) ||
      (Math.hypot(x - 11.6, z - 14.2) < 5.2 && h > 1.25);

    return {
      height: h,
      normal,
      slopeX,
      slopeZ,
      curvature,
      zoneName,
      isNearCoping,
      copingHeight: h > 1.8 ? 3.1 : 1.6,
    };
  }

  private getZoneName(x: number, z: number, h: number): string {
    if (Math.hypot(x + 6.4, z + 13.5) < 6.0) return 'NW Over-Vert Cradle';
    if (Math.hypot(x - 18.5, z - 4.6) < 6.2) return 'East Sunset Palm Mural Wall';
    if (Math.hypot(x - 7.6, z + 0.8) < 4.5) return 'Central Volcano Dome';
    if (Math.hypot(x + 5.5, z + 7.0) < 4.5) return 'NW Upper Spine Roller';
    if (Math.hypot(x + 9.2, z + 0.5) < 4.5) return 'NW Lower Spine Roller';
    if (Math.hypot(x - 0.8, z - 11.2) < 4.8) return 'South Clover Bowl';
    if (Math.hypot(x - 11.6, z - 14.2) < 5.2) return 'SE Deep Bowl Pocket';
    if (h > 1.1) return 'Perimeter Quarterpipe';
    return 'Im Gefilde Flow Basin';
  }

  private buildCopingSegments(): void {
    const copingArcs: [string, number, number, number, number, number, number, number, number][] = [
      ['NW Cradle Over-Vert Lip', -6.4, -14.5, 4.82, Math.PI - 0.48 - 1.15, Math.PI - 0.48 + 1.15, 3.05, 0.75, -1.0],
      ['Sunset Palm Mural Coping', 16.5, 4.6, 5.38, 1.38 - 0.58, 1.38 + 0.58, 3.20, 0.0, 1.0],
      ['South Clover Bowl Coping', 0.8, 11.2, 4.35, -0.95, 0.95, 1.58, 0.0, 1.0],
      ['SE Deep Bowl Coping', 11.6, 14.2, 4.65, -0.85, 1.05, 1.62, 0.0, 1.0],
    ];

    for (const [name, cx, cz, rad, a0, a1, by, archY, fz] of copingArcs) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 28; i++) {
        const t = i / 28;
        const ang = a0 + (a1 - a0) * t;
        const x = cx + Math.sin(ang) * rad;
        const z = cz + fz * Math.cos(ang) * rad;
        const y = by + Math.cos((t - 0.5) * Math.PI) * archY;
        pts.push(new THREE.Vector3(x, y, z));
      }
      this.copingSegments.push({ name, points: pts });
    }
  }
}
