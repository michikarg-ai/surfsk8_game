import * as THREE from 'three';
import { ParkSurface } from '../physics/ParkSurface';
import { SurfHUD } from '../ui/SurfHUD';
import { SurfAudio } from '../audio/SurfAudio';
import { SurfskateController } from '../physics/SurfskateController';

/**
 * 3-Tier difficulty system for "Follow the Flow" mode:
 * - Tier 0 (Chill Line): Beginner flow carving line (+1500 PTS, generous distance window)
 * - Tier 1 (Pro Line): Intermediate wall-to-wall bowl line (+3000 PTS)
 * - Tier 2 (Sick Line): Expert full park marathon line (+5000 PTS, tighter track tolerance)
 */
export type FlowLineTier = 0 | 1 | 2;

export interface FlowLineTierConfig {
  tier: FlowLineTier;
  id: 'chill' | 'pro' | 'sick';
  name: string;
  shortName: string;
  desc: string;
  accentColor: string;
  hexColor: number;
  emissiveColor: number;
  maxAllowedDistance: number;
  bonusPoints: number;
  targetPaceSpeed: number; // m/s for virtual pace ghost
}

export interface GhostSample {
  t: number;
  x: number;
  y: number;
  z: number;
  h: number;
  lean: number;
}

export interface GhostRecord {
  parkId: string;
  tier: FlowLineTier;
  bestTimeSec: number;
  date: string;
  isVirtualPace?: boolean;
  samples: GhostSample[];
}

/**
 * Creates or updates a high-contrast floating canvas billboard sprite for 3D world gates.
 */
function createTextSprite(
  title: string,
  subtitle: string,
  accentColor: string
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas.getContext('2d')!;

  renderSpriteCard(ctx, canvas.width, canvas.height, title, subtitle, accentColor);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.35, 0.38, 1.0);
  return sprite;
}

function updateTextSprite(
  sprite: THREE.Sprite,
  title: string,
  subtitle: string,
  accentColor: string
): void {
  if (!sprite?.material?.map) return;
  const canvas = (sprite.material.map as THREE.CanvasTexture).image as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  renderSpriteCard(ctx, canvas.width, canvas.height, title, subtitle, accentColor);
  sprite.material.map.needsUpdate = true;
}

function renderSpriteCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  title: string,
  subtitle: string,
  accentColor: string
): void {
  ctx.clearRect(0, 0, w, h);

  // Rounded rectangular card background
  ctx.fillStyle = 'rgba(10, 16, 26, 0.60)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(16, 16, w - 32, h - 32, 24);
  } else {
    const rx = 16,
      ry = 16,
      rw = w - 32,
      rh = h - 32,
      r = 24;
    ctx.moveTo(rx + r, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
    ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
    ctx.arcTo(rx, ry + rh, rx, ry, r);
    ctx.arcTo(rx, ry, rx + rw, ry, r);
    ctx.closePath();
  }
  ctx.fill();

  // Glowing neon accent border
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Primary title text
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 36px "Barlow Condensed", "Impact", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, w / 2, 52);

  // Subtitle readout / instructions
  ctx.fillStyle = accentColor;
  ctx.font = '700 22px "Barlow Condensed", sans-serif';
  ctx.fillText(subtitle, w / 2, 94);
}

/**
 * "Follow the Flow" Game Mode Challenge for Skateparks:
 * - Im Gefilde
 * - Airport Skatepark
 *
 * Features:
 * - 3 Progressive Difficulty Tiers (Chill, Pro, Sick)
 * - Dynamic route loading per skatepark
 * - Personal-Best & Target Pace Ghost-Skater visualization
 * - Live HUD distance split against ghost
 * - Automatic progression and record persistence in localStorage
 */
export class FlowLineChallenge {
  public readonly group = new THREE.Group();
  public readonly ghostGroup = new THREE.Group();

  public currentTier: FlowLineTier = 0;
  public currentParkId = 'im_gefilde';

  public static readonly TIER_CONFIGS: Record<FlowLineTier, FlowLineTierConfig> = {
    0: {
      tier: 0,
      id: 'chill',
      name: '🟢 CHILL LINE — SOUL CARVE',
      shortName: '🟢 CHILL LINE',
      desc: 'SOUL CARVE',
      accentColor: '#00f5d4',
      hexColor: 0x00f5d4,
      emissiveColor: 0x00d4f5,
      maxAllowedDistance: 6.2,
      bonusPoints: 1500,
      targetPaceSpeed: 6.2,
    },
    1: {
      tier: 1,
      id: 'pro',
      name: '🔵 PRO LINE — WALL-TO-WALL',
      shortName: '🔵 PRO LINE',
      desc: 'WALL-TO-WALL',
      accentColor: '#00d4ff',
      hexColor: 0x00b4d8,
      emissiveColor: 0x0077b6,
      maxAllowedDistance: 5.5,
      bonusPoints: 3000,
      targetPaceSpeed: 7.2,
    },
    2: {
      tier: 2,
      id: 'sick',
      name: '🔴 SICK LINE — FULL PARK MARATHON',
      shortName: '🔴 SICK LINE',
      desc: 'PARK MARATHON',
      accentColor: '#ff0055',
      hexColor: 0xff0055,
      emissiveColor: 0xd90429,
      maxAllowedDistance: 4.8,
      bonusPoints: 5000,
      targetPaceSpeed: 8.0,
    },
  };

  /** Authentic LiDAR / aerial orthophoto flow waypoints around Skatepark "Im Gefilde". */
  public static readonly WAYPOINTS_2D: readonly THREE.Vector2[] = [
    new THREE.Vector2(8.16, 0.63), // 1
    new THREE.Vector2(8.36, 2.23), // 2
    new THREE.Vector2(9.57, 3.31), // 3
    new THREE.Vector2(10.48, 4.69), // 4
    new THREE.Vector2(11.95, 5.35), // 5
    new THREE.Vector2(13.20, 6.40), // 6
    new THREE.Vector2(13.79, 7.93), // 7
    new THREE.Vector2(13.62, 9.57), // 8
    new THREE.Vector2(14.90, 10.57), // 9
    new THREE.Vector2(16.51, 10.56), // 10
    new THREE.Vector2(16.07, 12.12), // 11
    new THREE.Vector2(15.45, 13.60), // 12
    new THREE.Vector2(16.44, 14.89), // 13
    new THREE.Vector2(15.87, 16.41), // 14
    new THREE.Vector2(14.35, 16.97), // 15
    new THREE.Vector2(13.79, 18.51), // 16
    new THREE.Vector2(12.56, 19.54), // 17
    new THREE.Vector2(11.23, 18.60), // 18
    new THREE.Vector2(9.62, 18.16), // 19
    new THREE.Vector2(7.97, 18.12), // 20
    new THREE.Vector2(7.34, 16.63), // 21
    new THREE.Vector2(7.16, 14.98), // 22
    new THREE.Vector2(6.30, 13.57), // 23
    new THREE.Vector2(7.20, 12.23), // 24
    new THREE.Vector2(7.50, 10.66), // 25
    new THREE.Vector2(7.30, 9.05), // 26
    new THREE.Vector2(7.18, 7.40), // 27
    new THREE.Vector2(7.93, 5.96), // 28
    new THREE.Vector2(8.88, 4.56), // 29
    new THREE.Vector2(9.47, 3.05), // 30
    new THREE.Vector2(9.02, 1.44), // 31
    new THREE.Vector2(7.42, 1.06), // 32
    new THREE.Vector2(6.33, 2.27), // 33
    new THREE.Vector2(5.39, 3.66), // 34
    new THREE.Vector2(4.94, 5.21), // 35
    new THREE.Vector2(5.38, 6.77), // 36
    new THREE.Vector2(5.84, 8.37), // 37
    new THREE.Vector2(6.29, 9.94), // 38
    new THREE.Vector2(6.06, 11.54), // 39
    new THREE.Vector2(4.57, 12.20), // 40
    new THREE.Vector2(4.31, 13.79), // 41
    new THREE.Vector2(4.22, 15.40), // 42
    new THREE.Vector2(2.78, 14.60), // 43
    new THREE.Vector2(1.14, 14.44), // 44
    new THREE.Vector2(0.15, 15.72), // 45
    new THREE.Vector2(-0.69, 14.30), // 46
    new THREE.Vector2(-0.46, 12.71), // 47
    new THREE.Vector2(-0.56, 11.10), // 48
    new THREE.Vector2(-1.82, 10.01), // 49
    new THREE.Vector2(-2.18, 8.43), // 50
    new THREE.Vector2(-2.38, 6.83), // 51
    new THREE.Vector2(-3.80, 6.06), // 52
    new THREE.Vector2(-5.28, 6.77), // 53
    new THREE.Vector2(-6.91, 6.99), // 54
    new THREE.Vector2(-8.50, 7.39), // 55
    new THREE.Vector2(-9.73, 8.50), // 56
    new THREE.Vector2(-11.17, 7.79), // 57
    new THREE.Vector2(-11.93, 6.35), // 58
    new THREE.Vector2(-13.46, 5.84), // 59
    new THREE.Vector2(-14.87, 5.01), // 60
    new THREE.Vector2(-14.86, 3.39), // 61
    new THREE.Vector2(-15.13, 1.77), // 62
    new THREE.Vector2(-16.65, 1.21), // 63
    new THREE.Vector2(-17.91, 0.23), // 64
    new THREE.Vector2(-17.20, -1.23), // 65
    new THREE.Vector2(-15.62, -1.64), // 66
    new THREE.Vector2(-14.05, -2.08), // 67
    new THREE.Vector2(-13.05, -3.39), // 68
    new THREE.Vector2(-12.27, -4.81), // 69
    new THREE.Vector2(-11.46, -6.20), // 70
    new THREE.Vector2(-10.47, -7.51), // 71
    new THREE.Vector2(-8.93, -8.07), // 72
    new THREE.Vector2(-8.19, -6.63), // 73
    new THREE.Vector2(-8.44, -5.01), // 74
    new THREE.Vector2(-9.30, -3.65), // 75
    new THREE.Vector2(-8.51, -2.24), // 76
    new THREE.Vector2(-7.11, -3.08), // 77
    new THREE.Vector2(-6.68, -4.65), // 78
    new THREE.Vector2(-6.26, -6.24), // 79
    new THREE.Vector2(-6.74, -7.80), // 80
    new THREE.Vector2(-6.79, -9.43), // 81
    new THREE.Vector2(-7.41, -10.95), // 82
    new THREE.Vector2(-8.81, -11.84), // 83
    new THREE.Vector2(-10.07, -12.82), // 84
    new THREE.Vector2(-8.96, -14.01), // 85
    new THREE.Vector2(-7.38, -13.69), // 86
    new THREE.Vector2(-5.79, -14.05), // 87
    new THREE.Vector2(-4.35, -13.32), // 88
    new THREE.Vector2(-3.76, -11.76), // 89
    new THREE.Vector2(-2.11, -11.62), // 90
    new THREE.Vector2(-0.77, -12.53), // 91
    new THREE.Vector2(0.76, -11.91), // 92
    new THREE.Vector2(2.08, -10.96), // 93
    new THREE.Vector2(3.58, -11.56), // 94
    new THREE.Vector2(4.69, -12.74), // 95
    new THREE.Vector2(6.17, -12.13), // 96
    new THREE.Vector2(7.12, -10.82), // 97
    new THREE.Vector2(8.77, -10.93), // 98
    new THREE.Vector2(10.25, -11.59), // 99
    new THREE.Vector2(10.99, -10.10), // 100
    new THREE.Vector2(11.93, -8.79), // 101
    new THREE.Vector2(13.59, -8.85), // 102
    new THREE.Vector2(15.15, -9.23), // 103
    new THREE.Vector2(15.83, -7.75), // 104
    new THREE.Vector2(16.34, -6.18), // 105
    new THREE.Vector2(17.84, -5.54), // 106
    new THREE.Vector2(19.44, -5.58), // 107
    new THREE.Vector2(20.28, -4.22), // 108
    new THREE.Vector2(20.33, -2.57), // 109
    new THREE.Vector2(20.70, -1.00), // 110
    new THREE.Vector2(22.06, -0.08), // 111
    new THREE.Vector2(23.52, 0.60), // 112
    new THREE.Vector2(23.21, 2.18), // 113
    new THREE.Vector2(21.93, 3.17), // 114
    new THREE.Vector2(20.60, 4.19), // 115
    new THREE.Vector2(19.31, 5.19), // 116
    new THREE.Vector2(17.99, 6.19), // 117
    new THREE.Vector2(16.33, 6.41), // 118
    new THREE.Vector2(15.01, 5.40), // 119
    new THREE.Vector2(13.85, 4.22), // 120
    new THREE.Vector2(13.03, 2.75), // 121
    new THREE.Vector2(11.82, 1.68), // 122
    new THREE.Vector2(10.42, 0.86), // 123
    new THREE.Vector2(8.83, 0.84), // 124
  ];

  /**
   * Authentic LiDAR-calibrated Wave-Surfing Flow Waypoints for Airport Skatepark (Hallbergmoos).
   * Bowl floor sits at ~-1.10m raw LiDAR height; walls rise +1.35m..+1.65m up to coping (~+0.25m..+0.55m).
   * Start gate (3.30, 8.90) sits ~2.45m ahead of spawn (2.94, 11.32, heading -0.175) at the south roll-in lip.
   */
  public static readonly AIRPORT_WAYPOINTS_TIER_0: readonly THREE.Vector2[] = [
    // Start Gate & South Roll-in Drop-in
    new THREE.Vector2(3.30, 8.90),   // 1 - Start Gate (ahead of spawn)
    new THREE.Vector2(3.55, 7.35),   // 2
    new THREE.Vector2(3.65, 5.75),   // 3
    // Bottom Turn 1 -> carve left across south pool floor
    new THREE.Vector2(3.05, 4.10),   // 4
    new THREE.Vector2(1.55, 2.95),   // 5
    new THREE.Vector2(-0.20, 2.25),  // 6
    new THREE.Vector2(-1.95, 1.50),  // 7
    new THREE.Vector2(-3.70, 0.75),  // 8
    // Wave 1: SW Bend & Mid-NW Diagonal Wall ("67 / BVB 09" wall face)
    new THREE.Vector2(-5.35, -0.05), // 9
    new THREE.Vector2(-6.80, -0.85), // 10 - High Wall Top Turn
    new THREE.Vector2(-6.95, -2.15), // 11
    new THREE.Vector2(-5.95, -3.40), // 12
    new THREE.Vector2(-5.00, -4.65), // 13
    new THREE.Vector2(-4.15, -5.95), // 14
    new THREE.Vector2(-3.40, -7.30), // 15
    // Bottom Turn 2 -> sweep across deep pool trough to East Pocket
    new THREE.Vector2(-1.95, -7.50), // 16
    new THREE.Vector2(-0.20, -6.70), // 17
    new THREE.Vector2(1.55, -5.75),  // 18
    new THREE.Vector2(3.40, -4.85),  // 19
    new THREE.Vector2(5.25, -4.15),  // 20
    new THREE.Vector2(7.15, -3.70),  // 21
    // Wave 2: Deep East Wall ("Green Graffiti / Mushrooms" wall face)
    new THREE.Vector2(9.05, -3.45),  // 22
    new THREE.Vector2(10.80, -3.70), // 23
    new THREE.Vector2(12.00, -4.60), // 24
    new THREE.Vector2(12.15, -6.00), // 25 - High Wall Top Turn
    new THREE.Vector2(11.40, -7.45), // 26
    new THREE.Vector2(10.45, -8.85), // 27
    new THREE.Vector2(9.50, -10.25), // 28
    new THREE.Vector2(8.60, -11.60), // 29
    // Bottom Turn 3 -> carve into North Apex Pocket
    new THREE.Vector2(7.15, -12.15), // 30
    new THREE.Vector2(5.85, -12.65), // 31
    // Wave 3: North Apex Nose ("SPOR" curved bowl peak)
    new THREE.Vector2(5.40, -14.10), // 32
    new THREE.Vector2(4.55, -14.90), // 33 - High Wall Top Turn
    new THREE.Vector2(3.05, -14.95), // 34
    new THREE.Vector2(1.50, -14.90), // 35
    new THREE.Vector2(0.25, -14.55), // 36
    new THREE.Vector2(-0.60, -13.75),// 37
    // Bottom Turn 4 -> diagonal pump down center bowl to East Extension
    new THREE.Vector2(-0.35, -11.90),// 38
    new THREE.Vector2(0.40, -10.20), // 39
    new THREE.Vector2(1.55, -8.65),  // 40
    new THREE.Vector2(2.95, -7.15),  // 41
    new THREE.Vector2(4.35, -5.60),  // 42
    new THREE.Vector2(5.50, -3.85),  // 43
    // Wave 4: East Extension Wall -> South Exit Bank
    new THREE.Vector2(6.35, -1.95),  // 44
    new THREE.Vector2(6.90, -0.35),  // 45 - High Wall Top Turn
    new THREE.Vector2(7.20, 1.25),   // 46
    new THREE.Vector2(7.30, 2.85),   // 47
    new THREE.Vector2(7.55, 4.30),   // 48
    new THREE.Vector2(6.00, 5.45),   // 49
    new THREE.Vector2(4.35, 6.40),   // 50
    new THREE.Vector2(3.10, 7.70),   // 51
    new THREE.Vector2(2.40, 9.25),   // 52
    new THREE.Vector2(2.00, 10.70),  // 53 - Finish Gate
  ];

  public static readonly AIRPORT_WAYPOINTS_TIER_1: readonly THREE.Vector2[] = [
    // Start Gate & Drop-in
    new THREE.Vector2(3.30, 8.90),   // 1 - Start Gate
    new THREE.Vector2(3.55, 7.35),   // 2
    new THREE.Vector2(3.65, 5.75),   // 3
    new THREE.Vector2(3.70, 4.10),   // 4
    // Wave 1: East Extension Wall (South-to-North)
    new THREE.Vector2(5.95, 3.25),   // 5
    new THREE.Vector2(7.15, 2.55),   // 6
    new THREE.Vector2(7.30, 1.15),   // 7
    new THREE.Vector2(7.15, -0.30),  // 8
    new THREE.Vector2(6.50, -1.45),  // 9
    // Bottom Turn 1 -> sweep across waist to SW Blue Graffiti Corner
    new THREE.Vector2(4.80, -1.95),  // 10
    new THREE.Vector2(2.95, -1.85),  // 11
    new THREE.Vector2(1.10, -1.70),  // 12
    new THREE.Vector2(-0.75, -1.45), // 13
    new THREE.Vector2(-2.60, -1.10), // 14
    new THREE.Vector2(-4.45, -0.60), // 15
    // Wave 2: SW Blue Graffiti Corner
    new THREE.Vector2(-6.35, -0.45), // 16
    new THREE.Vector2(-8.05, -0.35), // 17
    new THREE.Vector2(-9.65, -0.25), // 18
    new THREE.Vector2(-10.95, -0.25),// 19
    new THREE.Vector2(-11.30, 1.05), // 20
    // Bottom Turn 2 -> Wide West Bowl -> SW Corner Hip
    new THREE.Vector2(-11.00, 2.55), // 21
    new THREE.Vector2(-10.80, 4.00), // 22
    new THREE.Vector2(-10.95, 5.35), // 23
    // Wave 3: SW Corner Hip
    new THREE.Vector2(-10.75, 6.65), // 24
    new THREE.Vector2(-9.50, 7.30),  // 25
    new THREE.Vector2(-8.25, 7.45),  // 26
    // Bottom Turn 3 -> diagonal setup into NW Wall
    new THREE.Vector2(-6.90, 6.15),  // 27
    new THREE.Vector2(-5.30, 4.65),  // 28
    new THREE.Vector2(-3.85, 2.95),  // 29
    new THREE.Vector2(-3.05, 1.10),  // 30
    new THREE.Vector2(-3.15, -0.75), // 31
    // Wave 4: Long NW Diagonal Wall ("67 / BVB 09")
    new THREE.Vector2(-4.45, -2.45), // 32
    new THREE.Vector2(-5.35, -3.85), // 33
    new THREE.Vector2(-4.75, -5.25), // 34
    new THREE.Vector2(-3.90, -6.70), // 35
    new THREE.Vector2(-3.10, -8.15), // 36
    new THREE.Vector2(-2.40, -9.65), // 37
    new THREE.Vector2(-1.75, -11.15),// 38
    // Bottom Turn 4 -> North Pocket sweep into North Apex
    new THREE.Vector2(-0.55, -12.35),// 39
    new THREE.Vector2(1.10, -12.55), // 40
    // Wave 5: North Apex Nose ("SPOR")
    new THREE.Vector2(2.20, -14.05), // 41
    new THREE.Vector2(3.05, -14.85), // 42
    new THREE.Vector2(4.55, -14.85), // 43
    new THREE.Vector2(6.00, -14.40), // 44
    new THREE.Vector2(6.65, -13.35), // 45
    // Bottom Turn 5 -> drop smoothly into East Wall
    new THREE.Vector2(6.65, -11.65), // 46
    new THREE.Vector2(7.60, -10.45), // 47
    // Wave 6: East "Green Graffiti" Wall (North-to-South)
    new THREE.Vector2(8.95, -9.95),  // 48
    new THREE.Vector2(10.25, -8.90), // 49
    new THREE.Vector2(11.40, -7.50), // 50
    new THREE.Vector2(12.15, -5.90), // 51
    new THREE.Vector2(12.35, -4.25), // 52
    new THREE.Vector2(11.80, -3.00), // 53
    new THREE.Vector2(10.45, -2.15), // 54
    // Bottom Turn 6 -> fast sweep to Mid-NW Wall 2nd Slash
    new THREE.Vector2(8.65, -2.25),  // 55
    new THREE.Vector2(6.85, -2.95),  // 56
    new THREE.Vector2(5.05, -3.75),  // 57
    new THREE.Vector2(3.25, -4.55),  // 58
    new THREE.Vector2(1.45, -5.15),  // 59
    new THREE.Vector2(-0.40, -5.45), // 60
    new THREE.Vector2(-2.35, -5.50), // 61
    // Wave 7: Mid-NW Wall Return Slash
    new THREE.Vector2(-4.45, -5.50), // 62
    new THREE.Vector2(-5.25, -4.15), // 63
    new THREE.Vector2(-6.05, -2.85), // 64
    new THREE.Vector2(-6.45, -1.55), // 65
    // Bottom Turn 7 -> cross center to East Extension Finale
    new THREE.Vector2(-5.15, -0.55), // 66
    new THREE.Vector2(-3.35, -0.45), // 67
    new THREE.Vector2(-1.50, -0.40), // 68
    new THREE.Vector2(0.40, -0.35),  // 69
    new THREE.Vector2(2.30, -0.30),  // 70
    new THREE.Vector2(4.45, -0.15),  // 71
    // Wave 8: East Extension Wall Finale -> South Exit Bank
    new THREE.Vector2(6.85, 0.20),   // 72
    new THREE.Vector2(7.15, 1.45),   // 73
    new THREE.Vector2(7.35, 2.95),   // 74
    new THREE.Vector2(7.55, 4.30),   // 75
    new THREE.Vector2(5.85, 5.45),   // 76
    new THREE.Vector2(4.20, 6.45),   // 77
    new THREE.Vector2(3.00, 7.80),   // 78
    new THREE.Vector2(2.35, 9.35),   // 79
    new THREE.Vector2(1.95, 10.75),  // 80 - Finish Gate
  ];

  public static readonly AIRPORT_WAYPOINTS_TIER_2: readonly THREE.Vector2[] = [
    // Start Gate & Drop-in
    new THREE.Vector2(3.30, 8.90),   // 1 - Start Gate
    new THREE.Vector2(3.55, 7.35),   // 2
    new THREE.Vector2(3.65, 5.75),   // 3
    new THREE.Vector2(3.70, 4.10),   // 4
    // Wave 1: East Extension Wall
    new THREE.Vector2(5.95, 3.25),   // 5
    new THREE.Vector2(7.15, 2.55),   // 6
    new THREE.Vector2(7.30, 1.15),   // 7
    new THREE.Vector2(7.15, -0.30),  // 8
    new THREE.Vector2(6.50, -1.45),  // 9
    // Bottom Turn 1 -> East Hip into Deep East Wall
    new THREE.Vector2(5.65, -2.65),  // 10
    new THREE.Vector2(5.85, -3.85),  // 11
    new THREE.Vector2(7.45, -4.15),  // 12
    new THREE.Vector2(9.25, -3.95),  // 13
    new THREE.Vector2(10.95, -3.80), // 14
    // Wave 2: Full East Wall ("Green Graffiti")
    new THREE.Vector2(12.00, -4.60), // 15
    new THREE.Vector2(12.10, -5.90), // 16
    new THREE.Vector2(11.55, -7.25), // 17
    new THREE.Vector2(10.70, -8.55), // 18
    new THREE.Vector2(9.75, -9.85),  // 19
    new THREE.Vector2(8.80, -11.15), // 20
    new THREE.Vector2(7.90, -12.35), // 21
    // Bottom Turn 2 -> Upper NW Wall
    new THREE.Vector2(6.30, -12.55), // 22
    new THREE.Vector2(4.45, -12.05), // 23
    new THREE.Vector2(2.65, -11.40), // 24
    new THREE.Vector2(0.85, -10.85), // 25
    new THREE.Vector2(-0.80, -10.45),// 26
    // Wave 3: Upper NW Wall ("BVB 09")
    new THREE.Vector2(-2.25, -9.75), // 27
    new THREE.Vector2(-3.05, -8.25), // 28
    new THREE.Vector2(-3.90, -6.75), // 29
    new THREE.Vector2(-4.40, -5.65), // 30
    // Bottom Turn 3 -> into North Apex Nose
    new THREE.Vector2(-3.85, -4.55), // 31
    new THREE.Vector2(-2.25, -4.75), // 32
    new THREE.Vector2(-0.55, -5.55), // 33
    new THREE.Vector2(1.05, -6.70),  // 34
    new THREE.Vector2(2.45, -8.35),  // 35
    new THREE.Vector2(3.55, -10.25), // 36
    new THREE.Vector2(4.55, -12.15), // 37
    // Wave 4: Full North Apex Nose ("SPOR")
    new THREE.Vector2(5.40, -13.95), // 38
    new THREE.Vector2(4.35, -14.85), // 39
    new THREE.Vector2(2.75, -14.95), // 40
    new THREE.Vector2(1.15, -14.85), // 41
    new THREE.Vector2(0.05, -14.50), // 42
    new THREE.Vector2(-0.65, -13.75),// 43
    // Bottom Turn 4 -> Mid-NW Diagonal Wall
    new THREE.Vector2(-0.35, -11.90),// 44
    new THREE.Vector2(0.25, -10.10), // 45
    new THREE.Vector2(0.35, -8.25),  // 46
    new THREE.Vector2(-0.25, -6.45), // 47
    new THREE.Vector2(-1.55, -5.15), // 48
    // Wave 5: Mid-Lower NW Diagonal Wall ("67")
    new THREE.Vector2(-3.30, -4.85), // 49
    new THREE.Vector2(-4.95, -4.35), // 50
    new THREE.Vector2(-5.95, -3.15), // 51
    new THREE.Vector2(-7.05, -1.95), // 52
    new THREE.Vector2(-5.80, -0.50), // 53
    // Bottom Turn 5 -> wide sweeping S-turn into SW Blue Graffiti Corner
    new THREE.Vector2(-4.95, 0.85),  // 54
    new THREE.Vector2(-5.80, 1.85),  // 55
    new THREE.Vector2(-7.45, 1.55),  // 56
    new THREE.Vector2(-8.80, 0.65),  // 57
    // Wave 6: SW Blue Graffiti Corner
    new THREE.Vector2(-9.80, -0.25), // 58
    new THREE.Vector2(-10.95, -0.22),// 59
    new THREE.Vector2(-11.30, 1.10), // 60
    new THREE.Vector2(-11.15, 2.45), // 61
    // Bottom Turn 6 -> Wide West Bowl -> SW Corner Hip
    new THREE.Vector2(-10.90, 3.80), // 62
    new THREE.Vector2(-10.95, 5.20), // 63
    // Wave 7: SW Corner Hip
    new THREE.Vector2(-10.85, 6.65), // 64
    new THREE.Vector2(-9.60, 7.30),  // 65
    new THREE.Vector2(-8.20, 7.50),  // 66
    // Bottom Turn 7 -> sweep across wide south bowl into East Extension Pass
    new THREE.Vector2(-6.85, 6.10),  // 67
    new THREE.Vector2(-5.15, 4.45),  // 68
    new THREE.Vector2(-3.25, 3.30),  // 69
    new THREE.Vector2(-1.25, 2.75),  // 70
    new THREE.Vector2(0.80, 2.55),   // 71
    new THREE.Vector2(2.85, 2.50),   // 72
    new THREE.Vector2(4.85, 2.45),   // 73
    // Wave 8: East Extension Pass -> East Hip -> East Wall
    new THREE.Vector2(6.35, 2.35),   // 74
    new THREE.Vector2(7.15, 1.45),   // 75
    new THREE.Vector2(7.30, -0.05),  // 76
    new THREE.Vector2(7.20, -1.15),  // 77
    new THREE.Vector2(7.05, -2.05),  // 78
    // Bottom Turn 8 -> East Wall ("Green Graffiti")
    new THREE.Vector2(8.60, -2.95),  // 79
    new THREE.Vector2(10.85, -3.60), // 80
    new THREE.Vector2(11.85, -4.15), // 81
    new THREE.Vector2(12.05, -5.45), // 82
    new THREE.Vector2(11.65, -6.90), // 83
    new THREE.Vector2(10.75, -8.35), // 84
    new THREE.Vector2(9.85, -9.65),  // 85
    new THREE.Vector2(9.05, -10.75), // 86
    // Bottom Turn 9 -> fast sweep to Second NW Wall Slash
    new THREE.Vector2(7.15, -10.85), // 87
    new THREE.Vector2(5.30, -9.85),  // 88
    new THREE.Vector2(3.50, -8.65),  // 89
    new THREE.Vector2(1.75, -7.45),  // 90
    new THREE.Vector2(-0.05, -6.45), // 91
    new THREE.Vector2(-1.85, -5.85), // 92
    // Wave 9: Second NW Wall Slash ("67")
    new THREE.Vector2(-3.45, -5.65), // 93
    new THREE.Vector2(-4.85, -4.75), // 94
    new THREE.Vector2(-5.75, -3.45), // 95
    new THREE.Vector2(-6.65, -2.10), // 96
    new THREE.Vector2(-7.55, -1.15), // 97
    // Bottom Turn 10 -> swift arc to East Extension Finale
    new THREE.Vector2(-5.85, 0.35),  // 98
    new THREE.Vector2(-3.95, 0.75),  // 99
    new THREE.Vector2(-2.05, 0.65),  // 100
    new THREE.Vector2(-0.15, 0.45),  // 101
    new THREE.Vector2(1.75, 0.25),   // 102
    new THREE.Vector2(4.25, 0.15),   // 103
    // Wave 10: East Extension Finale -> South Exit Bank
    new THREE.Vector2(6.85, 0.20),   // 104
    new THREE.Vector2(7.15, 1.35),   // 105
    new THREE.Vector2(7.35, 2.85),   // 106
    new THREE.Vector2(7.55, 4.35),   // 107
    new THREE.Vector2(5.85, 5.45),   // 108
    new THREE.Vector2(4.20, 6.45),   // 109
    new THREE.Vector2(3.00, 7.80),   // 110
    new THREE.Vector2(2.35, 9.35),   // 111
    new THREE.Vector2(1.95, 10.75),  // 112 - Finish Gate
  ];

  public static readonly NUM_SAMPLE_POINTS = 372;
  public static readonly TUBULAR_SEGMENTS = FlowLineChallenge.NUM_SAMPLE_POINTS - 1; // 371
  public static readonly RADIAL_SEGMENTS = 8;
  public static readonly INDICES_PER_SEGMENT = FlowLineChallenge.RADIAL_SEGMENTS * 6; // 48
  public static readonly VISIBLE_AHEAD_POINTS = 32; // ~16.5m ahead
  public static readonly VISIBLE_BEHIND_POINTS = 2; // ~1.0m behind skater
  public static readonly CHEVRON_STEP = 8;
  public static readonly START_TRIGGER_RADIUS = 1.2;
  public static readonly MAX_ALLOWED_DISTANCE = 5.5; // fallback
  public static readonly FINISH_TRIGGER_RADIUS = 3.0;
  public static readonly FINISH_MIN_PROGRESS = 0.95;

  public isActive = false;
  public isRecording = false;
  private recordedPoints: THREE.Vector2[] = [];
  private lastExportCode = '';
  public onRecordingStateChange?: (isRecording: boolean, pointCount: number) => void;
  public onLineCompleted?: (
    tier: FlowLineTier,
    elapsedSec: number,
    bonusPoints: number
  ) => void;

  private progressIdx = 0;
  private retriggerCooldown = 0;
  private runElapsedSec = 0;

  // 3D Spline and sampled points
  private curve!: THREE.CatmullRomCurve3;
  private curvePoints: THREE.Vector3[] = [];

  // Scene sub-groups
  private startGateGroup = new THREE.Group();
  private flowLineGroup = new THREE.Group();
  private finishGateGroup = new THREE.Group();

  // Mesh references for animation
  private startOuterRing!: THREE.Mesh;
  private startInnerRing!: THREE.Mesh;
  private startBeacon!: THREE.Mesh;
  private startLabelSprite!: THREE.Sprite;
  private startLight!: THREE.PointLight;

  private tubeMesh!: THREE.Mesh;
  private tubeMaterial!: THREE.MeshStandardMaterial;
  private pulseMarkers: THREE.Mesh[] = [];
  private chevronMarkers: THREE.Mesh[] = [];

  private finishArchRing!: THREE.Mesh;
  private finishLabelSprite!: THREE.Sprite;
  private finishLight!: THREE.PointLight;

  // 3D Ghost Skater state & sub-meshes
  private ghostDeckGroup = new THREE.Group();
  private ghostSurferGroup = new THREE.Group();
  private ghostLabelSprite!: THREE.Sprite;
  private ghostGroundGlow!: THREE.Mesh;
  private ghostMaterials: THREE.Material[] = [];
  private ghostRotMatrix = new THREE.Matrix4();

  private activeGhostSamples: GhostSample[] = [];
  private activeGhostTotalTime = 0;
  private activeGhostType: 'PB' | 'PACE' = 'PACE';
  private ghostSamplePlaybackIdx = 0;
  private ghostProgressTimes: Float32Array = new Float32Array(0);

  // Ghost Recording for current run
  private ghostSampleTimer = 0;
  private currentRunSamples: GhostSample[] = [];

  constructor(
    private scene: THREE.Scene,
    private parkSurface: ParkSurface,
    private hud: SurfHUD,
    private audio: SurfAudio
  ) {
    this.group.name = 'FlowLineChallenge';
    this.scene.add(this.group);

    this.group.add(this.startGateGroup);
    this.group.add(this.flowLineGroup);
    this.group.add(this.finishGateGroup);
    this.group.add(this.ghostGroup);

    const srfParkId = this.parkSurface?.getParkId?.();
    if (srfParkId) {
      this.currentParkId = srfParkId;
    }

    const pts = this.getWaypointsForParkAndTier(this.currentParkId, this.currentTier);
    this.buildCurveFromWaypoints(pts);
    this.buildStartGateVisuals();
    this.buildFlowLineVisuals();
    this.buildFinishGateVisuals();
    this.buildGhostSkater();
    this.ensureModalExists();

    this.updateStartGateVisuals();

    // Default state: only start gate is visible
    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;
    this.ghostGroup.visible = false;
    this.progressIdx = 0;
  }

  public getCurrentTierConfig(): FlowLineTierConfig {
    return FlowLineChallenge.TIER_CONFIGS[this.currentTier] ?? FlowLineChallenge.TIER_CONFIGS[0];
  }

  public getPersonalBest(
    parkId: string = this.currentParkId,
    tier: FlowLineTier = this.currentTier
  ): number | null {
    try {
      const raw = localStorage.getItem(`surfsk8.flowGhost.${parkId}_tier_${tier}`);
      if (!raw) return null;
      const data = JSON.parse(raw) as GhostRecord;
      if (typeof data.bestTimeSec === 'number' && !isNaN(data.bestTimeSec)) {
        return data.bestTimeSec;
      }
    } catch {
      // Ignore localStorage error
    }
    return null;
  }

  public isTierCompleted(
    parkId: string = this.currentParkId,
    tier: FlowLineTier = this.currentTier
  ): boolean {
    try {
      const raw = localStorage.getItem('surfsk8.flowLineCompleted');
      if (!raw) return false;
      const comp = JSON.parse(raw) as Record<string, boolean>;
      return !!comp[`${parkId}_tier_${tier}`];
    } catch {
      return false;
    }
  }

  public setTier(tier: FlowLineTier): void {
    this.currentTier = tier;
    this.rebuildCurrentTierCurve();
  }

  public cycleTier(): FlowLineTier {
    const next = ((this.currentTier + 1) % 3) as FlowLineTier;
    this.setTier(next);
    return this.currentTier;
  }

  public rebuildCurrentTierCurve(): void {
    const pts = this.getWaypointsForParkAndTier(this.currentParkId, this.currentTier);
    this.buildCurveFromWaypoints(pts);
    this.updateStartGateVisuals();
  }

  private getWaypointsForParkAndTier(
    parkId: string,
    tier: FlowLineTier
  ): readonly THREE.Vector2[] {
    if (parkId === 'airport_skatepark') {
      if (tier === 0) return FlowLineChallenge.AIRPORT_WAYPOINTS_TIER_0;
      if (tier === 1) return FlowLineChallenge.AIRPORT_WAYPOINTS_TIER_1;
      return FlowLineChallenge.AIRPORT_WAYPOINTS_TIER_2;
    }
    // Default to im_gefilde
    if (tier === 0) return FlowLineChallenge.WAYPOINTS_2D.slice(0, 45);
    if (tier === 1) return FlowLineChallenge.WAYPOINTS_2D.slice(0, 85);
    return FlowLineChallenge.WAYPOINTS_2D;
  }

  /**
   * Minimal shape-preserving 2D smoothing (1 pass) to soften micro-jitter while staying
   * tightly faithful to recorded wall lines and preventing bowl-curve shrinkage.
   */
  private smoothWaypoints2D(
    waypoints: readonly THREE.Vector2[],
    iterations = 1
  ): THREE.Vector2[] {
    let current = waypoints.map((pt) => pt.clone());
    const n = current.length;
    if (n < 3) return current;

    for (let iter = 0; iter < iterations; iter++) {
      const next: THREE.Vector2[] = [];
      next.push(current[0].clone());

      for (let i = 1; i < n - 1; i++) {
        const prev = current[i - 1];
        const curr = current[i];
        const nxt = current[i + 1];
        next.push(
          new THREE.Vector2(
            0.12 * prev.x + 0.76 * curr.x + 0.12 * nxt.x,
            0.12 * prev.y + 0.76 * curr.y + 0.12 * nxt.y
          )
        );
      }

      next.push(current[n - 1].clone());
      current = next;
    }

    return current;
  }

  /**
   * Samples park surface heights and generates the 3D CatmullRom spline and tube geometry.
   */
  public buildCurveFromWaypoints(waypoints: readonly THREE.Vector2[]): void {
    if (waypoints.length < 2) return;

    // 1. Minimal 1-pass shape-preserving smoothing to keep line riding high up on the bowl walls
    const smoothed2D = this.smoothWaypoints2D(waypoints, 1);

    const rawControlPoints = smoothed2D.map(
      (pt) =>
        new THREE.Vector3(
          pt.x,
          this.parkSurface.sample(pt.x, pt.y).height + 0.05,
          pt.y
        )
    );

    const rawCurve = new THREE.CatmullRomCurve3(
      rawControlPoints,
      false,
      'centripetal',
      0.5
    );
    const sampleCount = Math.max(
      FlowLineChallenge.NUM_SAMPLE_POINTS,
      waypoints.length * 3
    );
    const tubularSegments = sampleCount - 1;
    const sampled = rawCurve.getPoints(tubularSegments);

    // Re-sample height exactly from park surface at every single point along the path
    for (const p of sampled) {
      p.y = this.parkSurface.sample(p.x, p.z).height + 0.05;
    }

    this.curvePoints = sampled;
    this.curve = new THREE.CatmullRomCurve3(
      this.curvePoints,
      false,
      'centripetal',
      0.5
    );

    if (this.tubeMesh) {
      this.tubeMesh.geometry.dispose();
      this.tubeMesh.geometry = new THREE.TubeGeometry(
        this.curve,
        tubularSegments,
        0.034,
        FlowLineChallenge.RADIAL_SEGMENTS,
        false
      );
    }

    this.buildChevrons();
    this.updateStartGatePosition();
    this.updateFinishGatePosition();
  }

  /**
   * Places directional chevron markers along the sampled flow line.
   */
  private buildChevrons(): void {
    for (const c of this.chevronMarkers) {
      this.flowLineGroup.remove(c);
      c.geometry.dispose();
    }
    this.chevronMarkers = [];

    if (!this.curve || this.curvePoints.length < 2) return;

    const cfg = this.getCurrentTierConfig();
    const chevronGeo = new THREE.ConeGeometry(0.08, 0.2, 3);
    chevronGeo.rotateX(Math.PI / 2);
    chevronGeo.scale(1.0, 0.3, 1.0);
    const chevronMat = new THREE.MeshBasicMaterial({
      color: cfg.hexColor,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const step = FlowLineChallenge.CHEVRON_STEP;
    for (let idx = step; idx < this.curvePoints.length - step; idx += step) {
      const t = idx / (this.curvePoints.length - 1);
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);

      const marker = new THREE.Mesh(chevronGeo, chevronMat);
      marker.position.copy(pos);
      marker.position.y += 0.02;
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      marker.userData.sampleIdx = idx;
      this.flowLineGroup.add(marker);
      this.chevronMarkers.push(marker);
    }
  }

  /**
   * Builds the Starting Gate: glowing concentric ground rings, light beacon & floating billboard label.
   */
  private buildStartGateVisuals(): void {
    const cfg = this.getCurrentTierConfig();

    // 1. Outer glowing ring
    const outerGeo = new THREE.TorusGeometry(0.52, 0.018, 8, 48);
    const outerMat = new THREE.MeshBasicMaterial({
      color: cfg.hexColor,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    });
    this.startOuterRing = new THREE.Mesh(outerGeo, outerMat);
    this.startOuterRing.rotation.x = -Math.PI / 2;
    this.startOuterRing.position.y = 0.02;
    this.startGateGroup.add(this.startOuterRing);

    // 2. Inner glowing warm orange ring
    const innerGeo = new THREE.TorusGeometry(0.36, 0.014, 8, 36);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff9f1c,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    });
    this.startInnerRing = new THREE.Mesh(innerGeo, innerMat);
    this.startInnerRing.rotation.x = -Math.PI / 2;
    this.startInnerRing.position.y = 0.02;
    this.startGateGroup.add(this.startInnerRing);

    // 3. Ground contact glow decal disc
    const discGeo = new THREE.CircleGeometry(0.54, 36);
    const discMat = new THREE.MeshBasicMaterial({
      color: cfg.hexColor,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    this.startGateGroup.add(disc);

    // 4. Vertical cylindrical light beacon
    const beaconGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.65, 32, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: cfg.hexColor,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.startBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.startBeacon.position.y = 0.32;
    this.startGateGroup.add(this.startBeacon);

    // 5. PointLight casting warm radiance onto concrete
    this.startLight = new THREE.PointLight(cfg.hexColor, 0.6, 3.2);
    this.startLight.position.set(0, 0.45, 0);
    this.startGateGroup.add(this.startLight);

    // 6. Floating Canvas Label Sprite
    this.startLabelSprite = createTextSprite(
      cfg.shortName,
      'SKATE HERE TO BEGIN',
      cfg.accentColor
    );
    this.startLabelSprite.position.set(0, 0.88, 0);
    this.startGateGroup.add(this.startLabelSprite);

    this.updateStartGatePosition();
  }

  /**
   * Builds the 3D neon flow line tube and animated pulse markers.
   */
  private buildFlowLineVisuals(): void {
    const cfg = this.getCurrentTierConfig();
    const tubularSegments = Math.max(
      FlowLineChallenge.TUBULAR_SEGMENTS,
      this.curvePoints.length - 1
    );
    const tubeGeo = new THREE.TubeGeometry(
      this.curve,
      tubularSegments,
      0.034,
      FlowLineChallenge.RADIAL_SEGMENTS,
      false
    );
    this.tubeMaterial = new THREE.MeshStandardMaterial({
      color: cfg.hexColor,
      emissive: cfg.emissiveColor,
      emissiveIntensity: 0.65,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    });
    this.tubeMesh = new THREE.Mesh(tubeGeo, this.tubeMaterial);
    this.flowLineGroup.add(this.tubeMesh);

    // 12 Animated glowing pulse marker triangles traveling along the line
    const markerGeo = new THREE.ConeGeometry(0.095, 0.22, 3);
    markerGeo.rotateX(Math.PI / 2);
    markerGeo.scale(1.0, 0.35, 1.0);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let i = 0; i < 12; i++) {
      const marker = new THREE.Mesh(markerGeo, markerMat);
      this.flowLineGroup.add(marker);
      this.pulseMarkers.push(marker);
    }
  }

  /**
   * Builds the Finish Gate: glowing golden arch, light beam & floating bonus banner.
   */
  private buildFinishGateVisuals(): void {
    const cfg = this.getCurrentTierConfig();

    // 1. Glowing golden finish arch
    const archGeo = new THREE.TorusGeometry(0.55, 0.022, 8, 32);
    const archMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffaa00,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      transparent: true,
      opacity: 0.38,
    });
    this.finishArchRing = new THREE.Mesh(archGeo, archMat);
    this.finishArchRing.position.set(0, 0.65, 0);
    this.finishGateGroup.add(this.finishArchRing);

    // 2. Ground finish bar
    const barGeo = new THREE.BoxGeometry(1.1, 0.015, 0.14);
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.42,
    });
    const finishBar = new THREE.Mesh(barGeo, barMat);
    finishBar.position.set(0, 0.01, 0);
    this.finishGateGroup.add(finishBar);

    // 3. Warm golden PointLight
    this.finishLight = new THREE.PointLight(0xffaa00, 0.8, 3.5);
    this.finishLight.position.set(0, 0.65, 0);
    this.finishGateGroup.add(this.finishLight);

    // 4. Floating Canvas Label Sprite: "FINISH GATE (+BONUS)"
    this.finishLabelSprite = createTextSprite(
      '🏁 FINISH GATE',
      `+${cfg.bonusPoints} FLOW BONUS`,
      '#ffd166'
    );
    this.finishLabelSprite.position.set(0, 0.95, 0);
    this.finishGateGroup.add(this.finishLabelSprite);

    this.updateFinishGatePosition();
  }

  /**
   * Builds the 3D Ghost Skater: semi-transparent glowing surfskate deck with wheels,
   * stylized surfer silhouette in deep carve stance, and floating overhead split banner.
   */
  private buildGhostSkater(): void {
    const cfg = this.getCurrentTierConfig();
    this.ghostGroup.name = 'FlowLineGhostSkater';

    // Deck group rolls around board axis with leanAngle
    this.ghostDeckGroup = new THREE.Group();
    this.ghostGroup.add(this.ghostDeckGroup);

    // 1. Deck Mesh (nose toward local -Z, tail toward local +Z)
    const deckGeo = new THREE.BoxGeometry(0.24, 0.024, 0.82);
    const deckMat = new THREE.MeshStandardMaterial({
      color: cfg.hexColor,
      emissive: cfg.emissiveColor,
      emissiveIntensity: 0.65,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.ghostMaterials.push(deckMat);
    const deckMesh = new THREE.Mesh(deckGeo, deckMat);
    deckMesh.position.set(0, 0.08, 0);
    this.ghostDeckGroup.add(deckMesh);

    // Grip accent line
    const gripGeo = new THREE.PlaneGeometry(0.18, 0.74);
    gripGeo.rotateX(-Math.PI / 2);
    const gripMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.ghostMaterials.push(gripMat);
    const gripMesh = new THREE.Mesh(gripGeo, gripMat);
    gripMesh.position.set(0, 0.093, 0);
    this.ghostDeckGroup.add(gripMesh);

    // 4 Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.045, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: cfg.hexColor,
      emissive: cfg.emissiveColor,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.ghostMaterials.push(wheelMat);

    const wheelOffsets: [number, number, number][] = [
      [-0.12, 0.038, -0.26], // front-left
      [0.12, 0.038, -0.26],  // front-right
      [-0.12, 0.038, 0.26],  // rear-left
      [0.12, 0.038, 0.26],   // rear-right
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, wy, wz);
      this.ghostDeckGroup.add(wheel);
    }

    // 2. Stylized Surfer Silhouette in Carve Stance
    this.ghostSurferGroup = new THREE.Group();
    this.ghostDeckGroup.add(this.ghostSurferGroup);

    const surferMat = new THREE.MeshStandardMaterial({
      color: cfg.hexColor,
      emissive: cfg.emissiveColor,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.ghostMaterials.push(surferMat);

    // Feet on deck
    const frontFoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.04, 0.16),
      surferMat
    );
    frontFoot.position.set(0.02, 0.11, -0.18);
    this.ghostSurferGroup.add(frontFoot);

    const rearFoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.04, 0.16),
      surferMat
    );
    rearFoot.position.set(-0.02, 0.11, 0.18);
    this.ghostSurferGroup.add(rearFoot);

    // Calves & Thighs (deep surf crouch)
    const calfGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.26, 8);
    const frontCalf = new THREE.Mesh(calfGeo, surferMat);
    frontCalf.position.set(0.02, 0.24, -0.16);
    frontCalf.rotation.x = -0.2;
    this.ghostSurferGroup.add(frontCalf);

    const rearCalf = new THREE.Mesh(calfGeo, surferMat);
    rearCalf.position.set(-0.02, 0.22, 0.15);
    rearCalf.rotation.x = 0.35;
    this.ghostSurferGroup.add(rearCalf);

    const thighGeo = new THREE.CylinderGeometry(0.045, 0.048, 0.28, 8);
    const frontThigh = new THREE.Mesh(thighGeo, surferMat);
    frontThigh.position.set(0.02, 0.38, -0.08);
    frontThigh.rotation.x = 0.35;
    this.ghostSurferGroup.add(frontThigh);

    const rearThigh = new THREE.Mesh(thighGeo, surferMat);
    rearThigh.position.set(-0.02, 0.35, 0.06);
    rearThigh.rotation.x = -0.45;
    this.ghostSurferGroup.add(rearThigh);

    // Torso / Pelvis
    const torsoGeo = new THREE.CylinderGeometry(0.08, 0.065, 0.32, 8);
    const torso = new THREE.Mesh(torsoGeo, surferMat);
    torso.position.set(0, 0.54, 0.0);
    torso.rotation.x = -0.2; // leaning into the carve
    this.ghostSurferGroup.add(torso);

    // Head
    const headGeo = new THREE.SphereGeometry(0.075, 12, 8);
    const head = new THREE.Mesh(headGeo, surferMat);
    head.position.set(0, 0.74, -0.06);
    this.ghostSurferGroup.add(head);

    // Arms: trailing arm touching wave, lead arm reaching forward
    const armGeo = new THREE.CylinderGeometry(0.026, 0.03, 0.26, 6);
    const leadArm = new THREE.Mesh(armGeo, surferMat);
    leadArm.position.set(-0.16, 0.56, -0.22);
    leadArm.rotation.set(-0.7, 0, 0.5);
    this.ghostSurferGroup.add(leadArm);

    const trailArm = new THREE.Mesh(armGeo, surferMat);
    trailArm.position.set(0.18, 0.34, 0.08);
    trailArm.rotation.set(0.9, 0, -0.5);
    this.ghostSurferGroup.add(trailArm);

    // 3. Ground contact glow decal disc
    const groundGlowGeo = new THREE.CircleGeometry(0.36, 18);
    groundGlowGeo.rotateX(-Math.PI / 2);
    const groundGlowMat = new THREE.MeshBasicMaterial({
      color: cfg.hexColor,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ghostGroundGlow = new THREE.Mesh(groundGlowGeo, groundGlowMat);
    this.ghostGroundGlow.position.set(0, 0.02, 0);
    this.ghostGroup.add(this.ghostGroundGlow);

    // 4. Overhead Floating Ghost Mini-Sprite
    this.ghostLabelSprite = createTextSprite('👻 PB GHOST', '', cfg.accentColor);
    this.ghostLabelSprite.scale.set(0.95, 0.26, 1.0);
    this.ghostLabelSprite.position.set(0, 1.42, 0);
    this.ghostGroup.add(this.ghostLabelSprite);
  }

  private updateGhostMaterials(): void {
    const cfg = this.getCurrentTierConfig();
    for (const m of this.ghostMaterials) {
      if ('color' in m) {
        (m as THREE.MeshStandardMaterial).color.setHex(cfg.hexColor);
      }
      if ('emissive' in m) {
        (m as THREE.MeshStandardMaterial).emissive.setHex(cfg.emissiveColor);
      }
    }
    if (this.ghostGroundGlow?.material) {
      (this.ghostGroundGlow.material as THREE.MeshBasicMaterial).color.setHex(cfg.hexColor);
    }
  }

  private updateStartGatePosition(): void {
    if (!this.curvePoints.length) return;
    const startPt = this.curvePoints[0];
    this.startGateGroup.position.set(startPt.x, startPt.y - 0.05, startPt.z);

    if (this.curve) {
      const tangent = this.curve.getTangentAt(0);
      const angle = Math.atan2(tangent.x, tangent.z);
      this.startGateGroup.rotation.y = angle;
    }
  }

  private updateFinishGatePosition(): void {
    if (!this.curvePoints.length) return;
    const finishPt = this.curvePoints[this.curvePoints.length - 1];
    this.finishGateGroup.position.set(finishPt.x, finishPt.y - 0.05, finishPt.z);

    const tangent = this.curve.getTangentAt(1.0);
    const angle = Math.atan2(tangent.x, tangent.z);
    this.finishGateGroup.rotation.y = angle;
  }

  private updateStartGateVisuals(): void {
    const cfg = this.getCurrentTierConfig();
    const pb = this.getPersonalBest(this.currentParkId, this.currentTier);
    const subtitle =
      pb !== null
        ? `PB: ${pb.toFixed(1)}s • SKATE IN TO START`
        : `${cfg.desc} • +${cfg.bonusPoints} PTS`;

    updateTextSprite(this.startLabelSprite, cfg.shortName, subtitle, cfg.accentColor);

    if (this.startOuterRing?.material) {
      (this.startOuterRing.material as THREE.MeshBasicMaterial).color.setHex(cfg.hexColor);
    }
    if (this.startBeacon?.material) {
      (this.startBeacon.material as THREE.MeshBasicMaterial).color.setHex(cfg.hexColor);
    }
    if (this.startLight) {
      this.startLight.color.setHex(cfg.hexColor);
    }
    if (this.tubeMaterial) {
      this.tubeMaterial.color.setHex(cfg.hexColor);
      this.tubeMaterial.emissive.setHex(cfg.emissiveColor);
    }
    for (const c of this.chevronMarkers) {
      (c.material as THREE.MeshBasicMaterial).color.setHex(cfg.hexColor);
    }
    if (this.finishLabelSprite) {
      updateTextSprite(
        this.finishLabelSprite,
        '🏁 FINISH GATE',
        `+${cfg.bonusPoints} FLOW BONUS`,
        '#ffd166'
      );
    }
    this.updateGhostMaterials();
  }

  /**
   * Refreshes the curve and tube geometry to hug the exact LiDAR / C2 surface.
   * Called on initial LiDAR grid load and when switching skateparks.
   */
  public refreshSurfaceHeights(parkId?: string): void {
    if (parkId) {
      this.currentParkId = parkId;
    } else {
      const srfParkId = this.parkSurface?.getParkId?.();
      if (srfParkId) {
        this.currentParkId = srfParkId;
      }
    }

    if (this.isActive) {
      this.failChallenge('PARK CHANGED');
    }

    this.rebuildCurrentTierCurve();

    if (this.isRecording) {
      this.updateFlowLineVisibility(0);
    } else {
      this.flowLineGroup.visible = false;
      this.startGateGroup.visible = true;
    }
  }

  public update(
    dt: number,
    timeSec: number,
    controller: SurfskateController
  ): void {
    if (this.retriggerCooldown > 0) {
      this.retriggerCooldown = Math.max(0, this.retriggerCooldown - dt);
    }

    // --- DEV RECORDER MODE: Skater is laying down a custom flow line ---
    if (this.isRecording) {
      const lastPt = this.recordedPoints[this.recordedPoints.length - 1];
      const dx = controller.position.x - lastPt.x;
      const dz = controller.position.z - lastPt.y;
      const dist = Math.hypot(dx, dz);

      if (dist >= 1.6) {
        const newPt = new THREE.Vector2(
          Number(controller.position.x.toFixed(2)),
          Number(controller.position.z.toFixed(2))
        );
        this.recordedPoints.push(newPt);
        if (this.recordedPoints.length >= 2) {
          this.buildCurveFromWaypoints(this.recordedPoints);
        }
        this.hud.setFlowLineHint(
          `🔴 REC FLOW LINE: ${this.recordedPoints.length} pts — Press [L] to finish & export`
        );
        this.onRecordingStateChange?.(true, this.recordedPoints.length);
      }

      if (this.recordedPoints.length >= 2 && this.curve) {
        const numMarkers = this.pulseMarkers.length;
        for (let i = 0; i < numMarkers; i++) {
          const t = (timeSec * 0.12 + i / numMarkers) % 1.0;
          this.curve.getPointAt(t, this.pulseMarkers[i].position);
          const tangent = this.curve.getTangentAt(t);
          this.pulseMarkers[i].quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            tangent
          );
        }
      }
      return;
    }

    if (!this.isActive) {
      // Animate starting gate when idle
      this.startOuterRing.rotation.z = timeSec * 0.8;
      this.startInnerRing.rotation.z = -timeSec * 1.1;
      (this.startBeacon.material as THREE.MeshBasicMaterial).opacity =
        0.06 + Math.sin(timeSec * 2.5) * 0.02;
      this.startLabelSprite.position.y =
        0.88 + Math.sin(timeSec * 2.4) * 0.04;

      if (this.finishGateGroup.visible) {
        this.finishArchRing.rotation.z = timeSec * 1.2;
        this.finishLabelSprite.position.y =
          0.95 + Math.sin(timeSec * 2.6) * 0.04;
      }

      this.flowLineGroup.visible = false;
      this.ghostGroup.visible = false;

      // Check if skater enters starting gate
      if (this.curvePoints.length > 0) {
        const startPt = this.curvePoints[0];
        const distToStart = Math.hypot(
          controller.position.x - startPt.x,
          controller.position.z - startPt.z
        );

        if (
          this.retriggerCooldown <= 0 &&
          distToStart < FlowLineChallenge.START_TRIGGER_RADIUS
        ) {
          this.startChallenge(controller);
        }
      }
      return;
    }

    // --- ACTIVE FLOW LINE CHALLENGE ---

    // 1. Wipeout / Bail ends the challenge
    if (controller.isBailing) {
      this.failChallenge('FLOW LINE LOST!');
      return;
    }

    // 2. Progress tracking along active local window
    const minSearchIdx = Math.max(
      0,
      this.progressIdx - FlowLineChallenge.VISIBLE_BEHIND_POINTS
    );
    const maxSearchIdx = Math.min(
      this.curvePoints.length - 1,
      this.progressIdx + 36
    );

    let closestIdx = this.progressIdx;
    let minDistSq = Infinity;

    for (let i = minSearchIdx; i <= maxSearchIdx; i++) {
      const pt = this.curvePoints[i];
      const dx = controller.position.x - pt.x;
      const dz = controller.position.z - pt.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDistSq) {
        minDistSq = dSq;
        closestIdx = i;
      }
    }

    if (closestIdx > this.progressIdx) {
      this.progressIdx = closestIdx;
    }

    const distToLine = Math.sqrt(minDistSq);
    const cfg = this.getCurrentTierConfig();

    // 3. Check if skater is too far away from the line (tier-dependent tolerance)
    if (distToLine > cfg.maxAllowedDistance) {
      this.failChallenge('FLOW LINE ENDED — TOO FAR!');
      return;
    }

    // 4. Update elapsed timer and record player samples at 10 Hz (every 0.10s)
    this.runElapsedSec += dt;
    this.ghostSampleTimer += dt;
    if (this.ghostSampleTimer >= 0.1) {
      this.ghostSampleTimer -= 0.1;
      this.currentRunSamples.push({
        t: Number(this.runElapsedSec.toFixed(2)),
        x: Number(controller.position.x.toFixed(2)),
        y: Number(controller.position.y.toFixed(2)),
        z: Number(controller.position.z.toFixed(2)),
        h: Number(controller.heading.toFixed(3)),
        lean: Number(controller.leanAngle.toFixed(3)),
      });
    }

    // 5. Update Ghost Skater 3D position & animation
    this.updateGhostPlayback(timeSec, dt);

    // 6. Dynamically update visible 10-15m window of tube, chevrons & pulse markers
    this.updateFlowLineVisibility(timeSec);

    // 7. Wave Flow Speed Assist: surfing an endless wave without stalling
    const minAssist = cfg.targetPaceSpeed * 0.72;
    if (controller.speed > 1.0 && controller.speed < minAssist) {
      controller.speed = Math.min(minAssist, controller.speed + dt * 1.15);
    }

    // 8. Live HUD Progress Hint with Ghost Split Time
    const progressFrac =
      this.progressIdx / Math.max(1, this.curvePoints.length - 1);
    const pct = Math.round(progressFrac * 100);

    const ghostT = this.ghostProgressTimes[this.progressIdx] ?? 0;
    const splitSec = this.runElapsedSec - ghostT;
    const splitStr =
      splitSec <= 0
        ? `-${Math.abs(splitSec).toFixed(1)}s`
        : `+${splitSec.toFixed(1)}s`;

    this.hud.setFlowLineHint(`${cfg.shortName}: ${pct}% | 👻 ${splitStr}`);

    // 9. Finish Gate Visibility:
    // Show finish gate once the track end enters the 15m visibility window
    const finishThreshold = Math.max(0, this.curvePoints.length - 1 - 30);
    this.finishGateGroup.visible = this.progressIdx >= finishThreshold;

    if (this.finishGateGroup.visible) {
      this.finishArchRing.rotation.z = timeSec * 1.2;
      this.finishLabelSprite.position.y =
        0.95 + Math.sin(timeSec * 2.6) * 0.04;
    }

    // 10. Check Finish Gate completion
    const finishPt = this.curvePoints[this.curvePoints.length - 1];
    const distToFinish = Math.hypot(
      controller.position.x - finishPt.x,
      controller.position.z - finishPt.z
    );

    if (
      progressFrac >= FlowLineChallenge.FINISH_MIN_PROGRESS &&
      distToFinish < FlowLineChallenge.FINISH_TRIGGER_RADIUS
    ) {
      this.completeChallenge();
    }
  }

  public toggleRecording(currentPos: THREE.Vector3): void {
    if (!this.isRecording) {
      // START RECORDING
      this.isRecording = true;
      this.isActive = false;
      this.startGateGroup.visible = false;
      this.finishGateGroup.visible = false;
      this.ghostGroup.visible = false;
      this.flowLineGroup.visible = true;

      this.recordedPoints = [
        new THREE.Vector2(
          Number(currentPos.x.toFixed(2)),
          Number(currentPos.z.toFixed(2))
        ),
      ];

      this.closeExportModal();

      this.hud.showTrickBanner(
        '🔴 REC FLOW LINE — SKATE & PRESS [L] TO FINISH',
        true
      );
      this.hud.setFlowLineHint(
        '🔴 RECORDING FLOW LINE (1 pt) — Press [L] to stop'
      );
      this.onRecordingStateChange?.(true, 1);
    } else {
      // STOP RECORDING
      this.isRecording = false;

      const lastPt = this.recordedPoints[this.recordedPoints.length - 1];
      const dist = Math.hypot(currentPos.x - lastPt.x, currentPos.z - lastPt.y);
      if (dist >= 0.5) {
        this.recordedPoints.push(
          new THREE.Vector2(
            Number(currentPos.x.toFixed(2)),
            Number(currentPos.z.toFixed(2))
          )
        );
      }

      if (this.recordedPoints.length >= 3) {
        this.buildCurveFromWaypoints(this.recordedPoints);
        this.updateStartGatePosition();
        this.updateFinishGatePosition();
        this.startGateGroup.visible = true;
        this.finishGateGroup.visible = true;
        this.flowLineGroup.visible = true;

        const code =
          `public static readonly WAYPOINTS_2D: readonly THREE.Vector2[] = [\n` +
          this.recordedPoints
            .map(
              (p, i) =>
                `  new THREE.Vector2(${p.x.toFixed(2)}, ${p.y.toFixed(2)}), // ${i + 1}`
            )
            .join('\n') +
          `\n];`;

        this.lastExportCode = code;
        console.log(code);
        try {
          void navigator.clipboard?.writeText(code);
        } catch (err) {
          console.warn('Clipboard write failed:', err);
        }

        this.openExportModal(code);
        this.hud.showTrickBanner(
          `FLOW LINE SAVED: ${this.recordedPoints.length} PTS!`,
          true
        );
        this.hud.setFlowLineHint(
          'FLOW LINE READY — Enter Start Gate to test line'
        );
        this.onRecordingStateChange?.(false, this.recordedPoints.length);
      } else {
        this.hud.showTrickBanner('REC CANCELLED (NEED >= 3 PTS)', false);
        this.hud.setFlowLineHint(null);
        this.rebuildCurrentTierCurve();
        this.startGateGroup.visible = true;
        this.flowLineGroup.visible = false;
        this.finishGateGroup.visible = false;
        this.onRecordingStateChange?.(false, 0);
      }
    }
  }

  public getRecordedPointsCount(): number {
    return this.recordedPoints.length;
  }

  public isExportModalOpen(): boolean {
    const modal = document.getElementById('flowline-export-modal');
    return !!modal && !modal.classList.contains('hidden');
  }

  public openExportModal(code: string): void {
    this.lastExportCode = code;
    this.ensureModalExists();
    const modal = document.getElementById('flowline-export-modal');
    const textarea = document.getElementById(
      'flowline-export-textarea'
    ) as HTMLTextAreaElement | null;
    const title = document.getElementById('flowline-modal-title');

    if (textarea) {
      textarea.value = code;
    }
    if (title) {
      title.textContent = `🌊 FLOW LINE EXPORT (${this.recordedPoints.length} PTS)`;
    }
    modal?.classList.remove('hidden');
  }

  public reopenExportModal(): void {
    if (this.lastExportCode) {
      this.openExportModal(this.lastExportCode);
    }
  }

  public closeExportModal(): void {
    const modal = document.getElementById('flowline-export-modal');
    modal?.classList.add('hidden');
  }

  private modalInitialized = false;

  private ensureModalExists(): void {
    let modal = document.getElementById('flowline-export-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'flowline-export-modal';
      modal.className = 'flowline-modal-overlay hidden';
      modal.innerHTML = `
        <div class="flowline-modal-backdrop" id="flowline-modal-backdrop"></div>
        <div class="flowline-modal-card">
          <div class="flowline-modal-header">
            <div>
              <span class="flowline-badge">DEV MODE • WAYPOINTS RECORDER</span>
              <h2 class="flowline-title" id="flowline-modal-title">🌊 FLOW LINE EXPORT</h2>
            </div>
            <button class="flowline-close-btn" id="flowline-modal-x-btn" type="button" aria-label="Close">✕</button>
          </div>
          <div class="flowline-modal-body">
            <p class="flowline-desc">
              Your custom Flow Line was recorded live in Skatepark! Copy this snippet to chat or directly into <code class="flowline-code">FlowLineChallenge.WAYPOINTS_2D</code>:
            </p>
            <textarea id="flowline-export-textarea" class="flowline-textarea" readonly spellcheck="false"></textarea>
          </div>
          <div class="flowline-modal-footer">
            <button id="flowline-modal-copy-btn" type="button" class="flowline-btn flowline-btn-primary">📋 COPY WAYPOINTS</button>
            <button id="flowline-modal-test-btn" type="button" class="flowline-btn flowline-btn-accent">▶ TEST RECORDED LINE</button>
            <button id="flowline-modal-close-btn" type="button" class="flowline-btn flowline-btn-ghost">CLOSE</button>
          </div>
        </div>
      `;
      (document.getElementById('viewport-frame') ?? document.body).appendChild(modal);
    }

    if (!this.modalInitialized) {
      this.modalInitialized = true;
      const copyBtn = document.getElementById('flowline-modal-copy-btn');
      const testBtn = document.getElementById('flowline-modal-test-btn');
      const closeBtn = document.getElementById('flowline-modal-close-btn');
      const xBtn = document.getElementById('flowline-modal-x-btn');
      const backdrop = document.getElementById('flowline-modal-backdrop');
      const textarea = document.getElementById(
        'flowline-export-textarea'
      ) as HTMLTextAreaElement | null;

      copyBtn?.addEventListener('click', () => {
        if (!textarea) return;
        textarea.select();
        try {
          void navigator.clipboard?.writeText(textarea.value);
          const origText = copyBtn.textContent;
          copyBtn.textContent = 'COPIED TO CLIPBOARD! ✓';
          setTimeout(() => {
            copyBtn.textContent = origText;
          }, 2000);
        } catch {
          document.execCommand('copy');
        }
      });

      testBtn?.addEventListener('click', () => {
        this.closeExportModal();
        this.isActive = false;
        this.resetFlowLineVisibility();
        this.startGateGroup.visible = true;
        this.finishGateGroup.visible = true;
        this.flowLineGroup.visible = true;
        this.hud.showTrickBanner('READY TO TEST — RIDE TO START GATE!', true);
        this.hud.setFlowLineHint('🌊 ENTER START GATE TO BEGIN CHALLENGE');
      });

      closeBtn?.addEventListener('click', () => this.closeExportModal());
      xBtn?.addEventListener('click', () => this.closeExportModal());
      backdrop?.addEventListener('click', () => this.closeExportModal());
    }
  }

  /**
   * Dynamically renders only the ~10-15m window of the flow line in front of the skater,
   * keeping rendering lightweight with zero per-frame buffer allocations.
   */
  private updateFlowLineVisibility(timeSec: number): void {
    if (!this.tubeMesh?.geometry || !this.curvePoints.length) return;

    const numSegments = this.curvePoints.length - 1;
    const startSeg = Math.max(
      0,
      this.progressIdx - FlowLineChallenge.VISIBLE_BEHIND_POINTS
    );
    const endSeg = Math.min(
      numSegments,
      this.progressIdx + FlowLineChallenge.VISIBLE_AHEAD_POINTS
    );
    const startIndex = startSeg * FlowLineChallenge.INDICES_PER_SEGMENT;
    const count = Math.max(
      0,
      (endSeg - startSeg) * FlowLineChallenge.INDICES_PER_SEGMENT
    );

    this.tubeMesh.geometry.setDrawRange(startIndex, count);

    // Chevron directional markers: visible only within the active 10-15m window ahead
    const windowStart = this.progressIdx;
    const windowEnd = this.progressIdx + FlowLineChallenge.VISIBLE_AHEAD_POINTS;

    for (const marker of this.chevronMarkers) {
      const sampleIdx = (marker.userData.sampleIdx as number) ?? 0;
      if (sampleIdx >= windowStart && sampleIdx <= windowEnd) {
        marker.visible = true;
        const distFromEnd = windowEnd - sampleIdx;
        if (distFromEnd < 6) {
          const s = Math.max(0.2, distFromEnd / 6);
          marker.scale.set(s, s, s);
        } else {
          marker.scale.set(1.0, 1.0, 1.0);
        }
      } else {
        marker.visible = false;
      }
    }

    // Pulse markers: smoothly cruise along the active 10-15m visible segment
    const numMarkers = this.pulseMarkers.length;
    const startFrac = startSeg / numSegments;
    const endFrac = endSeg / numSegments;
    const fracSpan = Math.max(0.001, endFrac - startFrac);

    for (let i = 0; i < numMarkers; i++) {
      const localT = (timeSec * 0.35 + i / numMarkers) % 1.0;
      const t = Math.min(1.0, startFrac + localT * fracSpan);
      this.curve.getPointAt(t, this.pulseMarkers[i].position);
      const tangent = this.curve.getTangentAt(t);
      this.pulseMarkers[i].quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        tangent
      );
      this.pulseMarkers[i].visible = true;

      const edgeDist = Math.min(localT, 1.0 - localT);
      const s = edgeDist < 0.15 ? Math.max(0.2, edgeDist / 0.15) : 1.0;
      this.pulseMarkers[i].scale.set(s, s, s);
    }
  }

  /**
   * Resets draw range and restores visibility of all flow line markers (used outside of active challenge).
   */
  private resetFlowLineVisibility(): void {
    if (this.tubeMesh?.geometry) {
      this.tubeMesh.geometry.setDrawRange(0, Infinity);
    }
    for (const marker of this.chevronMarkers) {
      marker.visible = true;
      marker.scale.set(1.0, 1.0, 1.0);
    }
    for (const marker of this.pulseMarkers) {
      marker.visible = true;
      marker.scale.set(1.0, 1.0, 1.0);
    }
  }

  public startChallenge(controller?: SurfskateController): void {
    this.isActive = true;
    this.progressIdx = 0;
    this.runElapsedSec = 0;
    this.ghostSampleTimer = 0;
    this.ghostSamplePlaybackIdx = 0;
    this.currentRunSamples = [];

    const cfg = this.getCurrentTierConfig();

    if (controller) {
      this.currentRunSamples.push({
        t: 0,
        x: Number(controller.position.x.toFixed(2)),
        y: Number(controller.position.y.toFixed(2)),
        z: Number(controller.position.z.toFixed(2)),
        h: Number(controller.heading.toFixed(3)),
        lean: Number(controller.leanAngle.toFixed(3)),
      });
    } else if (this.curvePoints.length > 0) {
      const p = this.curvePoints[0];
      const tangent = this.curve.getTangentAt(0);
      const h = Math.atan2(-tangent.x, -tangent.z);
      this.currentRunSamples.push({
        t: 0,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        h: Number(h.toFixed(3)),
        lean: 0,
      });
    }

    this.startGateGroup.visible = false;
    this.flowLineGroup.visible = true;
    this.finishGateGroup.visible = false;

    this.setupGhostForRun();
    this.updateFlowLineVisibility(0);

    this.hud.showTrickBanner(`🌊 ${cfg.name}!`, true);
    this.hud.setFlowLineHint(`🌊 ${cfg.shortName}: 0% | 👻 ±0.0s`);
    this.audio.playManeuverChime();
  }

  private setupGhostForRun(): void {
    const cfg = this.getCurrentTierConfig();
    const storageKey = `surfsk8.flowGhost.${this.currentParkId}_tier_${this.currentTier}`;
    let loadedRecord: GhostRecord | null = null;

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as GhostRecord;
        if (
          parsed &&
          Array.isArray(parsed.samples) &&
          parsed.samples.length >= 3 &&
          typeof parsed.bestTimeSec === 'number'
        ) {
          loadedRecord = parsed;
        }
      }
    } catch {
      // LocalStorage error fallback
    }

    if (loadedRecord) {
      this.activeGhostSamples = loadedRecord.samples;
      this.activeGhostTotalTime = loadedRecord.bestTimeSec;
      this.activeGhostType = 'PB';
      updateTextSprite(
        this.ghostLabelSprite,
        '👻 PB GHOST',
        `${loadedRecord.bestTimeSec.toFixed(1)}s`,
        cfg.accentColor
      );
    } else {
      // Generate virtual target pace ghost
      const totalLen = this.curve.getLength();
      const totalTime = totalLen / cfg.targetPaceSpeed;
      this.activeGhostTotalTime = totalTime;
      this.activeGhostType = 'PACE';

      const numSamples = Math.max(10, Math.ceil(totalTime * 10)); // 10 Hz
      const generated: GhostSample[] = [];

      for (let i = 0; i <= numSamples; i++) {
        const frac = i / numSamples;
        const t = Number((frac * totalTime).toFixed(2));
        const pos = this.curve.getPointAt(frac);
        const tangent = this.curve.getTangentAt(frac);
        const h = Math.atan2(-tangent.x, -tangent.z);

        // Procedural carve lean based on curve turn rate
        const nextFrac = Math.min(1.0, frac + 0.02);
        const nextTangent = this.curve.getTangentAt(nextFrac);
        const cross = tangent.x * nextTangent.z - tangent.z * nextTangent.x;
        const lean = Math.max(-0.55, Math.min(0.55, cross * 25));

        const groundH = this.parkSurface.sample(pos.x, pos.z).height;

        generated.push({
          t,
          x: Number(pos.x.toFixed(2)),
          y: Number((groundH + 0.05).toFixed(2)),
          z: Number(pos.z.toFixed(2)),
          h: Number(h.toFixed(3)),
          lean: Number(lean.toFixed(3)),
        });
      }

      this.activeGhostSamples = generated;
      updateTextSprite(
        this.ghostLabelSprite,
        '👻 TARGET PACE',
        `${cfg.targetPaceSpeed.toFixed(1)} m/s`,
        cfg.accentColor
      );
    }

    this.buildGhostProgressLookup();
    this.ghostSamplePlaybackIdx = 0;
    this.ghostGroup.visible = true;
    this.updateGhostPlayback(0, 0);
  }

  private buildGhostProgressLookup(): void {
    const n = this.curvePoints.length;
    if (this.ghostProgressTimes.length !== n) {
      this.ghostProgressTimes = new Float32Array(n);
    }

    if (this.activeGhostType === 'PACE') {
      const totalTime = this.activeGhostTotalTime;
      for (let i = 0; i < n; i++) {
        this.ghostProgressTimes[i] = (i / Math.max(1, n - 1)) * totalTime;
      }
      return;
    }

    // For PB Ghost: forward search closest sample timestamp
    let lastG = 0;
    for (let i = 0; i < n; i++) {
      const pt = this.curvePoints[i];
      let bestIdx = lastG;
      let bestDistSq = Infinity;
      const searchMax = Math.min(this.activeGhostSamples.length - 1, lastG + 25);
      for (let g = lastG; g <= searchMax; g++) {
        const s = this.activeGhostSamples[g];
        const dx = pt.x - s.x;
        const dz = pt.z - s.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = g;
        }
      }
      lastG = bestIdx;
      this.ghostProgressTimes[i] = this.activeGhostSamples[bestIdx].t;
    }
  }

  private updateGhostPlayback(timeSec: number, _dt: number): void {
    if (!this.activeGhostSamples.length) return;

    const t = this.runElapsedSec;

    // If ghost finished more than 2.0s ago, hide it
    if (t > this.activeGhostTotalTime + 2.0) {
      this.ghostGroup.visible = false;
      return;
    }
    this.ghostGroup.visible = true;

    // Advance playback index
    while (
      this.ghostSamplePlaybackIdx < this.activeGhostSamples.length - 2 &&
      this.activeGhostSamples[this.ghostSamplePlaybackIdx + 1].t < t
    ) {
      this.ghostSamplePlaybackIdx++;
    }

    const s0 = this.activeGhostSamples[this.ghostSamplePlaybackIdx];
    const s1 =
      this.activeGhostSamples[
        Math.min(this.activeGhostSamples.length - 1, this.ghostSamplePlaybackIdx + 1)
      ];

    const span = Math.max(0.0001, s1.t - s0.t);
    const alpha = Math.max(0, Math.min(1, (t - s0.t) / span));

    // Position lerp
    const gx = s0.x + (s1.x - s0.x) * alpha;
    const gz = s0.z + (s1.z - s0.z) * alpha;

    // Sample surface at ghost position for accurate slope alignment
    const srf = this.parkSurface.sample(gx, gz);
    const gy = srf.height + 0.05;

    // Heading lerp with angle wrap-around
    let dh = s1.h - s0.h;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const gh = s0.h + dh * alpha;

    // Lean lerp
    const glean = s0.lean + (s1.lean - s0.lean) * alpha;

    // Orientation along surface normal and heading
    const forward = new THREE.Vector3(-Math.sin(gh), 0, -Math.cos(gh)).normalize();
    const up = srf.normal.clone().lerp(new THREE.Vector3(0, 1, 0), 0.28).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const orthoForward = new THREE.Vector3().crossVectors(up, right).normalize();

    this.ghostRotMatrix.makeBasis(right, up, orthoForward.clone().negate());
    this.ghostGroup.quaternion.setFromRotationMatrix(this.ghostRotMatrix);
    this.ghostGroup.position.set(gx, gy, gz);

    // Deck roll around longitudinal axis
    this.ghostDeckGroup.rotation.z = glean;

    // Procedural subtle surfing motion
    const bob = Math.sin(timeSec * 6) * 0.015;
    this.ghostSurferGroup.position.y = bob;

    // Floating label stays above deck
    this.ghostLabelSprite.position.set(0, 1.42 + bob * 0.5, 0);
  }

  public failChallenge(reason: string): void {
    this.isActive = false;
    this.retriggerCooldown = 1.5;
    this.progressIdx = 0;
    this.ghostGroup.visible = false;

    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
    if (reason === 'FLOW LINE LOST!') {
      this.hud.showBailBanner(reason);
    } else {
      this.hud.showTrickBanner(reason, false);
    }
  }

  public completeChallenge(): void {
    const elapsed = this.runElapsedSec;
    this.isActive = false;
    this.retriggerCooldown = 2.0;
    this.progressIdx = 0;
    this.ghostGroup.visible = false;

    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;
    this.hud.setFlowLineHint(null);

    const cfg = this.getCurrentTierConfig();
    const prevPB = this.getPersonalBest(this.currentParkId, this.currentTier);
    const isNewRecord = prevPB === null || elapsed < prevPB;

    if (isNewRecord) {
      const record: GhostRecord = {
        parkId: this.currentParkId,
        tier: this.currentTier,
        bestTimeSec: Number(elapsed.toFixed(2)),
        date: new Date().toISOString(),
        isVirtualPace: false,
        samples: this.currentRunSamples,
      };
      try {
        localStorage.setItem(
          `surfsk8.flowGhost.${this.currentParkId}_tier_${this.currentTier}`,
          JSON.stringify(record)
        );
      } catch (err) {
        console.warn('Failed to save ghost record:', err);
      }
      this.hud.awardBonusPoints(
        cfg.bonusPoints,
        `🏆 NEW RECORD! ${elapsed.toFixed(1)}s (+${cfg.bonusPoints} PTS)`
      );
    } else {
      this.hud.awardBonusPoints(
        cfg.bonusPoints,
        `FLOW LINE COMPLETE! ${elapsed.toFixed(1)}s (+${cfg.bonusPoints} PTS)`
      );
    }

    // Save completed tier in localStorage
    try {
      const raw = localStorage.getItem('surfsk8.flowLineCompleted');
      const comp = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      comp[`${this.currentParkId}_tier_${this.currentTier}`] = true;
      localStorage.setItem('surfsk8.flowLineCompleted', JSON.stringify(comp));
    } catch (err) {
      console.warn('Failed to save completed flow line status:', err);
    }

    // Notify listeners (missions, achievements)
    this.onLineCompleted?.(this.currentTier, elapsed, cfg.bonusPoints);
    this.audio.playPretzelPickup(true);

    // Auto-advance to next difficulty tier (0 -> 1 -> 2 -> 0)
    const nextTier = ((this.currentTier + 1) % 3) as FlowLineTier;
    this.setTier(nextTier);
  }

  public reset(): void {
    this.isActive = false;
    this.isRecording = false;
    this.progressIdx = 0;
    this.retriggerCooldown = 0;
    this.runElapsedSec = 0;
    this.ghostSampleTimer = 0;
    this.currentRunSamples = [];

    this.ghostGroup.visible = false;
    this.startGateGroup.visible = true;
    this.flowLineGroup.visible = false;
    this.finishGateGroup.visible = false;

    this.hud.setFlowLineHint(null);
    this.closeExportModal();
  }
}
