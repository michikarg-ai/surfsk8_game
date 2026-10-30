import * as THREE from 'three';
import { ParkSurface, SurfaceSample } from './ParkSurface';

export interface InputState {
  steerLeft: boolean;
  steerRight: boolean;
  forwardPush: boolean;
  compressCrouch: boolean;
  jumpOllie: boolean;
  grindSlash: boolean;
  snapSlide: boolean; // C for Bert Slide
  snapTrick: boolean; // Q for the surf-style SNAP at the top of a wall
}

export interface ManeuverEvent {
  name: string;
  points: number;
  zone: string;
  isSpecial?: boolean;
  isSnap?: boolean;
  quality?: 'PERFECT' | 'STYLISH' | 'FLOW' | 'SCRUB';
}

export type TruckFeelPreset = 'smooth' | 'balanced' | 'snappy';

/** Whether a SNAP is currently possible (used by the HUD hint). */
export type SnapWindow = 'NONE' | 'TOO_SLOW' | 'READY' | 'TOO_FAST';

// -----------------------------------------------------------------------------
// Global physics constants
// -----------------------------------------------------------------------------
/** Whole-game translational time scale: 0.5 = gameplay runs 50% slower. */
const TIME_SCALE = 0.5;
/** Real gravity. Combined with energy conservation, max climb height = v² / (2g). */
const GRAVITY = 9.81;
/** Rolling resistance of urethane wheels on concrete (m/s²). */
const ROLLING_RESISTANCE = 0.14;
/** Aerodynamic drag coefficient (per metre). */
const AIR_DRAG = 0.008;
/** Hard speed cap (m/s, simulation speed). */
const MAX_SPEED = 9.5;
/** Top speed reachable by foot-pushing on flat ground. */
const MAX_PUSH_SPEED = 6.4;
/**
 * Extra acceleration (as fraction of the downhill gravity component) gained by actively
 * pumping while dropping DOWN a wall. Only active on walls, never on flat ground.
 */
const WALL_PUMP_GAIN = 0.12;

/** SNAP speed window (simulation m/s), measured at the top of a wall. */
const SNAP_MIN_SPEED = 1.6;
const SNAP_MAX_SPEED = 4.2;
const SNAP_PERFECT_CENTER = 2.8;
const SNAP_PERFECT_TOLERANCE = 0.55;
/** Duration (seconds) of the snap redirection. */
const SNAP_DURATION = 0.34;

export class SurfskateController {
  public position = new THREE.Vector3(15.2, 0.0, 4.2); // Spawn in front of the East Sunset Palm-Tree Mural Wall!
  public velocity = new THREE.Vector3(0, 0, 0);
  public heading = 1.38; // Facing West-North-West across the Central Volcano toward the NW Over-Vert Cradle
  public speed = 0;

  // Truck feel preset (defaults to 'balanced' for immediate, crisp, predictable control!)
  public truckPreset: TruckFeelPreset = 'balanced';

  // Surfskate truck & deck state
  public leanAngle = 0; // Roll angle of the deck (radians, + = right, - = left)
  public leanRate = 0;
  public frontTruckYaw = 0; // Dual-axis surf adapter visual yaw angle
  public rearTruckYaw = 0; // Standard rear truck opposite yaw
  public pitchAngle = 0;
  public wheelSpinAngle = 0;

  // Responsive analog-style steering filter for keyboard control
  private steerHoldTime = 0;
  private lastSteerDir = 0;
  private smoothedYawRate = 0;

  // Skater body compression & upper-body leading state
  public compression = 0.15;
  public compressionVel = 0;
  public upperBodyLeadYaw = 0;
  public bertSlideActive = false;
  public bertSlideHandSide = 0;

  // Ground / Air / Coping Grind state
  public isGrounded = true;
  public isGrinding = false;
  public activeCopingName = '';
  public airTime = 0;
  public airRotation = 0;
  public maxAirHeight = 0;

  // Flow & Pump rhythm state
  public flowMeter = 35;
  public pumpSyncQuality: 'IDLE' | 'PERFECT PUMP!' | 'FLOW PUMP' | 'SCRUB' = 'IDLE';
  public pumpQualityTimer = 0;
  public sprayIntensity = 0;

  // SNAP trick state
  public snapWindow: SnapWindow = 'NONE';
  /** Short feedback text for failed snap attempts (shown by the HUD). */
  public snapFeedback = '';
  public snapFeedbackTimer = 0;
  public snapActive = false;
  private snapTimer = 0;
  private snapTurnRate = 0;
  private prevSnapInput = false;

  /** Signed grade along the current heading (dh/ds): > 0 climbing, < 0 dropping in. */
  public gradeAlongHeading = 0;

  // Turn tracking for Bottom Turn, Top Turn, Roundhouse Cutback
  private cumulativeCarveAngle = 0;
  private lastCarveSign = 0;
  private maneuverCooldowns: Record<string, number> = {};
  private lastClimbedWallHeight = 0;
  private wasClimbingTransition = false;
  private pushCooldown = 0;

  public currentSurface: SurfaceSample;

  constructor(private park: ParkSurface) {
    this.currentSurface = this.park.sample(this.position.x, this.position.z);
    this.position.y = this.currentSurface.height;
  }

  public cycleTruckPreset(): TruckFeelPreset {
    const order: TruckFeelPreset[] = ['smooth', 'balanced', 'snappy'];
    this.truckPreset = order[(order.indexOf(this.truckPreset) + 1) % order.length];
    return this.truckPreset;
  }

  public resetToSpawn(): void {
    this.position.set(15.2, 0, 4.2);
    this.currentSurface = this.park.sample(this.position.x, this.position.z);
    this.position.y = this.currentSurface.height;
    this.heading = 1.38; // Facing West-North-West toward the Central Volcano & NW Over-Vert Cradle
    this.speed = 3.0;
    this.velocity.set(-Math.sin(this.heading) * this.speed, 0, -Math.cos(this.heading) * this.speed);
    this.leanAngle = 0;
    this.leanRate = 0;
    this.steerHoldTime = 0;
    this.smoothedYawRate = 0;
    this.frontTruckYaw = 0;
    this.rearTruckYaw = 0;
    this.isGrounded = true;
    this.isGrinding = false;
    this.snapActive = false;
    this.snapTimer = 0;
    this.snapWindow = 'NONE';
  }

  public update(dt: number, input: InputState, onManeuver: (ev: ManeuverEvent) => void): void {
    const clampedDt = Math.min(dt, 0.033);
    // Translational simulation step (gameplay runs at TIME_SCALE of real time)
    const simDt = clampedDt * TIME_SCALE;

    for (const key of Object.keys(this.maneuverCooldowns)) {
      this.maneuverCooldowns[key] = Math.max(0, this.maneuverCooldowns[key] - clampedDt);
    }
    this.pushCooldown = Math.max(0, this.pushCooldown - clampedDt);
    if (this.pumpQualityTimer > 0) {
      this.pumpQualityTimer = Math.max(0, this.pumpQualityTimer - clampedDt);
      if (this.pumpQualityTimer === 0) this.pumpSyncQuality = 'IDLE';
    }
    if (this.snapFeedbackTimer > 0) {
      this.snapFeedbackTimer = Math.max(0, this.snapFeedbackTimer - clampedDt);
      if (this.snapFeedbackTimer === 0) this.snapFeedback = '';
    }

    this.currentSurface = this.park.sample(this.position.x, this.position.z);

    // -------------------------------------------------------------------------
    // 1. Steering & Dual-Axis Surf-Adapter Geometry
    // -------------------------------------------------------------------------
    const rawSteer = (input.steerRight ? 1 : 0) - (input.steerLeft ? 1 : 0);

    if (rawSteer !== 0) {
      if (rawSteer !== this.lastSteerDir) {
        this.steerHoldTime = 0.15;
        this.lastSteerDir = rawSteer;
      } else {
        this.steerHoldTime = Math.min(1.0, this.steerHoldTime + clampedDt * 3.5);
      }
    } else {
      this.steerHoldTime = 0;
      this.lastSteerDir = 0;
    }

    // Immediate 82% authority on key press, ramping to 100% for ultra-tight surfskate carves
    const progressiveFactor = 0.82 + 0.18 * this.steerHoldTime;
    const maxLean = 0.68; // ~39 deg deep surf-adapter rail lean for tight pivot turns
    const targetLean = rawSteer * maxLean * progressiveFactor;

    const prevLean = this.leanAngle;
    const responseRate = rawSteer === 0 ? 36.0 : 32.0;
    this.leanAngle += (targetLean - this.leanAngle) * Math.min(1, responseRate * clampedDt);
    if (rawSteer === 0 && Math.abs(this.leanAngle) < 0.008) {
      this.leanAngle = 0;
    }
    this.leanRate = (this.leanAngle - prevLean) / Math.max(0.001, clampedDt);

    this.frontTruckYaw = this.leanAngle * 1.55;
    this.rearTruckYaw = -this.leanAngle * 0.42;

    const targetLeadYaw = -this.leanAngle * 1.48;
    this.upperBodyLeadYaw += (targetLeadYaw - this.upperBodyLeadYaw) * Math.min(1, 26.0 * clampedDt);

    // -------------------------------------------------------------------------
    // 2. Surface analysis along the current heading (correct sign!)
    // -------------------------------------------------------------------------
    const grade = this.computeGradeAlongHeading();
    this.gradeAlongHeading = grade;
    const slopeX = this.currentSurface.slopeX;
    const slopeZ = this.currentSurface.slopeZ;
    const slopeMag = Math.hypot(slopeX, slopeZ);
    const h0 = this.currentSurface.height;
    const isOnWall = h0 >= 0.18 || slopeMag >= 0.12;

    // Automatic surf-pump body motion on walls: compress at the bottom & the apex, extend on the faces
    let autoWallCompression = 0.15;
    if (isOnWall && this.isGrounded) {
      if (h0 < 0.45 && grade > 0.05) {
        autoWallCompression = 0.85; // bottom turn: load the rail
      } else if (grade > 0.12) {
        autoWallCompression = 0.08; // climbing: extend & unweight
      } else if (Math.abs(grade) <= 0.12 && h0 >= 0.35) {
        autoWallCompression = 0.9; // apex: compress before re-entry
      } else if (grade < -0.12) {
        autoWallCompression = 0.06; // drop-in: drive down through the legs
      }
    }

    const targetCompression = input.compressCrouch
      ? 0.92
      : input.snapSlide || this.snapActive
      ? 0.95
      : autoWallCompression;
    const prevCompression = this.compression;
    this.compression += (targetCompression - this.compression) * Math.min(1, 11.5 * clampedDt);
    this.compressionVel = (this.compression - prevCompression) / Math.max(0.001, clampedDt);

    // -------------------------------------------------------------------------
    // 3. Coping Grind / Lip Slash Mode
    // -------------------------------------------------------------------------
    if (this.isGrinding) {
      this.updateCopingGrind(simDt, input, onManeuver);
      return;
    }

    if (input.grindSlash && this.tryEnterCopingGrind(onManeuver)) {
      return;
    }

    // -------------------------------------------------------------------------
    // 4. Grounded Surfskate Physics (energy-conserving)
    // -------------------------------------------------------------------------
    if (this.isGrounded) {
      const presetGain =
        this.truckPreset === 'smooth' ? 0.78 : this.truckPreset === 'balanced' ? 1.0 : 1.28;

      // ---- 4a. SNAP trick (Q at the top of a wall within the right speed window) ----
      this.updateSnapWindow(h0, grade, slopeMag);
      const snapPressed = input.snapTrick && !this.prevSnapInput;
      this.prevSnapInput = input.snapTrick;
      if (snapPressed && !this.snapActive) {
        this.attemptSnap(rawSteer, slopeX, slopeZ, onManeuver);
      }

      // ---- 4b. Steering (surfskates pivot tightly even at low speed) ----
      if (this.snapActive) {
        // Snap redirection overrides normal carving for a fraction of a second
        this.heading += this.snapTurnRate * clampedDt;
        this.snapTimer -= clampedDt;
        this.sprayIntensity = 1.0;
        if (this.snapTimer <= 0) {
          this.snapActive = false;
          this.smoothedYawRate = 0;
        }
      } else {
        const lowSpeedPivotFactor = 1.35 - 0.055 * Math.min(5.5, this.speed);
        const baseTurnRate = 4.5 * presetGain;
        const bertMultiplier = input.snapSlide ? 1.6 : 1.0;
        const targetYawRate = -this.leanAngle * baseTurnRate * lowSpeedPivotFactor * bertMultiplier;
        this.smoothedYawRate +=
          (targetYawRate - this.smoothedYawRate) * Math.min(1, (rawSteer === 0 ? 38.0 : 34.0) * clampedDt);
        this.heading += this.smoothedYawRate * clampedDt;
      }

      // Track continuous carve angle for Roundhouse Cutback detection (NO speed gain on flat ground!)
      const carveSign = Math.sign(rawSteer || this.leanAngle);
      if (Math.abs(this.leanAngle) > 0.05 && carveSign !== 0) {
        if (carveSign === this.lastCarveSign) {
          this.cumulativeCarveAngle += Math.abs(this.smoothedYawRate * clampedDt);
        } else {
          this.cumulativeCarveAngle = Math.abs(this.smoothedYawRate * clampedDt);
          this.lastCarveSign = carveSign;
        }
      } else {
        this.cumulativeCarveAngle *= 0.94;
      }

      // ---- 4c. Forces along the path ----
      const sinT = grade / Math.sqrt(1 + grade * grade);
      const cosT = 1 / Math.sqrt(1 + grade * grade);

      // Non-gravitational tangential acceleration (push, pump, friction)
      let aExtra = -ROLLING_RESISTANCE - AIR_DRAG * this.speed * this.speed;
      if (input.snapSlide && this.speed > 0.5) aExtra -= 3.0; // Bert slide scrubs speed

      // Foot-pushing only works on (nearly) flat ground — you can't push your way up a wall.
      const canPush = Math.abs(grade) < 0.12 && h0 < 0.35;
      if (input.forwardPush && canPush && this.speed < MAX_PUSH_SPEED) {
        if (this.speed < 2.6 && this.pushCooldown <= 0) {
          this.speed += 1.1; // kick-push
          this.pushCooldown = 0.5;
        } else {
          aExtra += 1.9;
        }
      }

      // Wall pumping: driving down through the legs on the way DOWN a wall adds energy.
      // Climbing a wall is pure kinetic energy — no free speed on the way up.
      if (isOnWall && sinT < -0.05) {
        aExtra += WALL_PUMP_GAIN * GRAVITY * -sinT;
        this.pumpSyncQuality = 'FLOW PUMP';
        this.pumpQualityTimer = 0.4;
        this.flowMeter = Math.min(100, this.flowMeter + 12.0 * clampedDt);
      }

      // Manual pump: release the crouch (S/Shift) at the bottom of a transition for a small boost
      if (
        isOnWall &&
        this.compressionVel < -2.2 &&
        (this.currentSurface.curvature > 0.03 || sinT < -0.08) &&
        this.canTrigger('ManualPump')
      ) {
        this.speed = Math.min(MAX_SPEED, this.speed + 0.35);
        this.pumpSyncQuality = 'PERFECT PUMP!';
        this.pumpQualityTimer = 0.9;
        this.flowMeter = Math.min(100, this.flowMeter + 6);
        this.setCooldown('ManualPump', 0.6);
      }

      this.detectSurfManeuvers(input, grade, onManeuver);

      if (input.jumpOllie) {
        // ---- 4d. Ollie / Air ----
        this.isGrounded = false;
        this.airTime = 0;
        this.airRotation = 0;
        this.maxAirHeight = 0;
        const upPop = 3.4;
        const vy = Math.max(upPop * 0.75, this.speed * sinT * 0.9 + upPop * 0.8);
        this.velocity.set(
          -Math.sin(this.heading) * this.speed * cosT,
          vy,
          -Math.cos(this.heading) * this.speed * cosT
        );
      } else {
        // ---- 4e. Energy-conserving integration ----
        const v0 = this.speed;
        const vPred = v0 + (-GRAVITY * sinT + aExtra) * simDt;
        const pathDist = Math.max(0, 0.5 * (v0 + Math.max(0, vPred))) * simDt;

        const prevX = this.position.x;
        const prevZ = this.position.z;
        const horiz = pathDist * cosT;
        this.position.x += -Math.sin(this.heading) * horiz;
        this.position.z += -Math.cos(this.heading) * horiz;
        this.constrainToParkBounds(clampedDt);

        const h1 = this.park.evaluateHeight(this.position.x, this.position.z);
        const dh = h1 - h0;

        // v1² = v0² + 2·a_extra·s − 2·g·Δh   (exact energy balance → no free climbing)
        const v1Sq = v0 * v0 + 2 * aExtra * pathDist - 2 * GRAVITY * dh;

        if (v1Sq <= 0.0025 && dh > 0) {
          // Out of energy: we cannot make this height. Stay put and let gravity swing us around.
          this.position.x = prevX;
          this.position.z = prevZ;
          this.speed = 0;
        } else {
          this.speed = Math.min(MAX_SPEED, Math.sqrt(Math.max(0, v1Sq)));
        }

        // Stall on a wall: at very low speed gravity pulls the nose down the fall line
        if (slopeMag > 0.12 && this.speed < 0.9 && !this.snapActive) {
          const downhillHeading = Math.atan2(slopeX, slopeZ);
          let diff = downhillHeading - this.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const swingRate = (2.4 + 2.0 * Math.min(1.5, slopeMag)) * (1 - this.speed / 0.9);
          this.heading += Math.sign(diff) * Math.min(Math.abs(diff), swingRate * clampedDt);
          if (this.speed < 0.05 && Math.abs(diff) < 0.6) {
            this.speed = 0.25; // start rolling back down
          }
        }

        this.currentSurface = this.park.sample(this.position.x, this.position.z);
        this.position.y = this.currentSurface.height;
        this.pitchAngle = Math.atan(grade) * 0.72;
      }
    } else {
      // -------------------------------------------------------------------------
      // 5. Airborne Physics (Alley-Oops & Lip Launches)
      // -------------------------------------------------------------------------
      this.prevSnapInput = input.snapTrick;
      this.snapWindow = 'NONE';
      this.airTime += simDt;
      this.velocity.y -= GRAVITY * simDt;
      this.position.addScaledVector(this.velocity, simDt);
      this.constrainToParkBounds(clampedDt);

      const airSpinRate = -rawSteer * 4.1;
      this.heading += airSpinRate * clampedDt;
      this.airRotation += Math.abs(airSpinRate * clampedDt);

      this.currentSurface = this.park.sample(this.position.x, this.position.z);
      const heightAboveSurface = this.position.y - this.currentSurface.height;
      this.maxAirHeight = Math.max(this.maxAirHeight, heightAboveSurface);

      if (this.position.y <= this.currentSurface.height && this.velocity.y <= 0) {
        this.position.y = this.currentSurface.height;
        this.isGrounded = true;

        // Keep only the velocity component tangent to the landing surface
        const n = this.currentSurface.normal;
        const vDotN = this.velocity.dot(n);
        const tangentVel = this.velocity.clone().addScaledVector(n, -vDotN);
        this.speed = Math.min(MAX_SPEED, tangentVel.length());
        if (Math.hypot(tangentVel.x, tangentVel.z) > 0.2) {
          this.heading = Math.atan2(-tangentVel.x, -tangentVel.z);
        }
        this.flowMeter = Math.min(100, this.flowMeter + 10);

        if (this.airTime > 0.25 && this.maxAirHeight > 0.28) {
          const deg = Math.round((this.airRotation * 180) / Math.PI);
          if (deg >= 120) {
            this.triggerManeuver(
              onManeuver,
              `Alley-Oop ${deg >= 270 ? '360' : '180'} Air`,
              650 + deg * 2,
              this.currentSurface.zoneName,
              false,
              'PERFECT'
            );
          } else {
            this.triggerManeuver(
              onManeuver,
              `Hip Transfer Air (${this.maxAirHeight.toFixed(1)}m)`,
              420,
              this.currentSurface.zoneName,
              false,
              'STYLISH'
            );
          }
        }
      }
    }

    this.wheelSpinAngle = (this.wheelSpinAngle + this.speed * simDt * 18.0) % (Math.PI * 2);

    if (this.speed < 1.05) {
      this.flowMeter = Math.max(0, this.flowMeter - 4.0 * clampedDt);
    }
  }

  /** Signed grade (dh/ds) along the current heading, sampled from the raw heightfield. */
  private computeGradeAlongHeading(): number {
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const e = 0.3;
    const hAhead = this.park.evaluateHeight(this.position.x + fx * e, this.position.z + fz * e);
    const hBehind = this.park.evaluateHeight(this.position.x - fx * e, this.position.z - fz * e);
    return Math.max(-4, Math.min(4, (hAhead - hBehind) / (2 * e)));
  }

  /** Highest point of the surrounding terrain within ~3.6 m (approximates the local wall top). */
  private estimateLocalWallTop(): number {
    let top = this.currentSurface.height;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (const r of [1.2, 2.4, 3.6]) {
        top = Math.max(top, this.park.evaluateHeight(this.position.x + ca * r, this.position.z + sa * r));
      }
    }
    return top;
  }

  /** Is the skater near the top of a wall? Returns the snap window state. */
  private updateSnapWindow(h: number, grade: number, slopeMag: number): void {
    if (h < 0.55 || slopeMag < 0.18 || grade < -0.25) {
      this.snapWindow = 'NONE';
      return;
    }
    const top = this.estimateLocalWallTop();
    const inTopZone = h >= top * 0.6 || top - h < 0.5;
    if (!inTopZone) {
      this.snapWindow = 'NONE';
      return;
    }
    if (this.speed < SNAP_MIN_SPEED) this.snapWindow = 'TOO_SLOW';
    else if (this.speed > SNAP_MAX_SPEED) this.snapWindow = 'TOO_FAST';
    else this.snapWindow = 'READY';
  }

  private attemptSnap(
    rawSteer: number,
    slopeX: number,
    slopeZ: number,
    onManeuver: (ev: ManeuverEvent) => void
  ): void {
    if (this.snapWindow === 'NONE') {
      this.snapFeedback = 'SNAP: get to the top of a wall!';
      this.snapFeedbackTimer = 1.1;
      return;
    }
    if (this.snapWindow === 'TOO_SLOW') {
      // Bogged the snap: lose the little speed that was left
      this.snapFeedback = 'TOO SLOW!';
      this.snapFeedbackTimer = 1.1;
      this.speed *= 0.5;
      return;
    }
    if (this.snapWindow === 'TOO_FAST') {
      this.snapFeedback = 'TOO FAST!';
      this.snapFeedbackTimer = 1.1;
      this.speed *= 0.85;
      return;
    }

    // Successful SNAP: whip the board back down the face of the wall
    const downhillHeading = Math.atan2(slopeX, slopeZ);
    let diff = downhillHeading - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Snap toward the side the player is leaning into if they are steering
    if (rawSteer !== 0) {
      const wanted = -rawSteer; // steering right turns heading negative
      if (Math.sign(diff) !== wanted && Math.abs(diff) > 0.4) {
        diff += wanted * Math.PI * 2;
      }
    }
    this.snapActive = true;
    this.snapTimer = SNAP_DURATION;
    this.snapTurnRate = diff / SNAP_DURATION;
    this.sprayIntensity = 1.0;

    const perfect = Math.abs(this.speed - SNAP_PERFECT_CENTER) <= SNAP_PERFECT_TOLERANCE;
    this.speed = Math.max(this.speed * 0.95, 1.2);
    this.flowMeter = Math.min(100, this.flowMeter + (perfect ? 30 : 20));
    this.setCooldown('TopTurn', 1.5);
    onManeuver({
      name: perfect ? 'PERFECT SNAP!' : 'SNAP!',
      points: perfect ? 1500 : 900,
      zone: this.currentSurface.zoneName,
      isSnap: true,
      quality: perfect ? 'PERFECT' : 'STYLISH',
    });
  }

  private detectSurfManeuvers(
    input: InputState,
    grade: number,
    onManeuver: (ev: ManeuverEvent) => void
  ): void {
    const h = this.currentSurface.height;
    const absLean = Math.abs(this.leanAngle);
    this.bertSlideActive = false;
    this.sprayIntensity = Math.max(0, this.sprayIntensity - 0.08);

    if (grade > 0.06 && h > 0.22) {
      this.wasClimbingTransition = true;
      this.lastClimbedWallHeight = Math.max(this.lastClimbedWallHeight, h);
    } else if (h < 0.12) {
      this.wasClimbingTransition = false;
      this.lastClimbedWallHeight = 0;
    }

    // 1. Bert Slide
    if (input.snapSlide && absLean > 0.15 && this.speed > 1.9) {
      this.bertSlideActive = true;
      this.bertSlideHandSide = Math.sign(this.leanAngle) || 1;
      this.sprayIntensity = 1.0;
      this.flowMeter = Math.min(100, this.flowMeter + 0.35);

      if (this.canTrigger('BertSlide')) {
        this.triggerManeuver(
          onManeuver,
          h > 1.05 ? 'High-Line Layback Bert Slide' : 'Surf Bert Slide',
          520,
          this.currentSurface.zoneName,
          false,
          'STYLISH'
        );
        this.setCooldown('BertSlide', 2.1);
      }
    }

    // 2. Top Turn (carving over the apex of a wall without the SNAP button)
    if (
      this.wasClimbingTransition &&
      this.lastClimbedWallHeight > 0.55 &&
      grade <= 0.06 &&
      absLean > 0.18 &&
      this.speed > 1.6
    ) {
      this.wasClimbingTransition = false;
      this.flowMeter = Math.min(100, this.flowMeter + 8);

      if (this.canTrigger('TopTurn')) {
        this.triggerManeuver(
          onManeuver,
          this.lastClimbedWallHeight > 1.35 ? 'High Top Turn' : 'Top Turn',
          this.lastClimbedWallHeight > 1.35 ? 380 : 240,
          this.currentSurface.zoneName,
          false,
          'STYLISH'
        );
        this.setCooldown('TopTurn', 1.6);
      }
      this.lastClimbedWallHeight = 0;
    }

    // 3. Bottom Turn
    if (
      h < 0.55 &&
      this.currentSurface.curvature > 0.05 &&
      absLean > 0.22 &&
      this.speed > 2.5 &&
      grade > 0.06 &&
      this.canTrigger('BottomTurn')
    ) {
      this.flowMeter = Math.min(100, this.flowMeter + 9);
      this.triggerManeuver(
        onManeuver,
        'Deep Rail Bottom Turn',
        310,
        this.currentSurface.zoneName,
        false,
        'FLOW'
      );
      this.setCooldown('BottomTurn', 2.2);
    }

    // 4. Roundhouse Cutback
    if (this.cumulativeCarveAngle > 1.85 && this.speed > 2.2 && this.canTrigger('Cutback')) {
      this.cumulativeCarveAngle = 0;
      this.sprayIntensity = 0.85;
      this.flowMeter = Math.min(100, this.flowMeter + 15);
      this.triggerManeuver(
        onManeuver,
        'Roundhouse Cutback',
        580,
        this.currentSurface.zoneName,
        false,
        'PERFECT'
      );
      this.setCooldown('Cutback', 2.4);
    }
  }

  private tryEnterCopingGrind(onManeuver: (ev: ManeuverEvent) => boolean | void): boolean {
    if (!this.canTrigger('CopingGrind') || this.speed < 1.95) return false;

    let bestSeg: { name: string; points: THREE.Vector3[]; idx: number; dist: number } | null = null;
    for (const seg of this.park.copingSegments) {
      for (let i = 0; i < seg.points.length - 1; i++) {
        const p = seg.points[i];
        const d = Math.hypot(this.position.x - p.x, this.position.z - p.z);
        if (d < 1.85 && (!bestSeg || d < bestSeg.dist)) {
          bestSeg = { name: seg.name, points: seg.points, idx: i, dist: d };
        }
      }
    }

    if (!bestSeg) return false;

    this.isGrinding = true;
    this.isGrounded = true;
    this.activeCopingName = bestSeg.name;
    this.sprayIntensity = 1.0;
    this.flowMeter = Math.min(100, this.flowMeter + 18);

    this.triggerManeuver(
      onManeuver as (ev: ManeuverEvent) => void,
      `Carve Grind (${bestSeg.name})`,
      750,
      this.currentSurface.zoneName,
      false,
      'PERFECT'
    );
    this.setCooldown('CopingGrind', 1.8);
    return true;
  }

  private updateCopingGrind(
    dt: number,
    input: InputState,
    onManeuver: (ev: ManeuverEvent) => void
  ): void {
    const seg = this.park.copingSegments.find((s) => s.name === this.activeCopingName);
    if (!seg || input.jumpOllie || this.speed < 1.5) {
      this.isGrinding = false;
      this.position.x *= 0.92;
      this.position.z *= 0.92;
      this.currentSurface = this.park.sample(this.position.x, this.position.z);
      this.position.y = this.currentSurface.height + (input.jumpOllie ? 0.35 : 0);
      if (input.jumpOllie) {
        this.isGrounded = false;
        this.velocity.set(-Math.sin(this.heading) * this.speed, 3.4, -Math.cos(this.heading) * this.speed);
        this.triggerManeuver(onManeuver, 'Lip Re-Entry Air', 420, this.currentSurface.zoneName, false, 'STYLISH');
      }
      return;
    }

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < seg.points.length; i++) {
      const d = this.position.distanceToSquared(seg.points[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx <= 0 || bestIdx >= seg.points.length - 1) {
      this.isGrinding = false;
      return;
    }

    const tangent = new THREE.Vector3()
      .subVectors(seg.points[bestIdx + 1], seg.points[bestIdx - 1])
      .normalize();
    const forward = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    if (tangent.dot(forward) < 0) tangent.negate();

    this.position.copy(seg.points[bestIdx]).addScaledVector(tangent, this.speed * dt);
    this.heading = Math.atan2(-tangent.x, -tangent.z);
    this.sprayIntensity = 1.0;
    this.flowMeter = Math.min(100, this.flowMeter + 15 * dt);
  }

  private constrainToParkBounds(dt = 0.016): void {
    // Allow full, unobstructed freedom across the ENTIRE multi-view 3D skatepark model!
    // Only at the extreme outer edge of the 3D scan (`maxRx = 33.5m, maxRz = 24.5m`) do we
    // keep the skater from riding off the outer boundary of the scanned mesh.
    const ang = 0.488;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const dx = this.position.x - 2.5;
    const dz = this.position.z - 1.0;
    const lx = dx * ca + dz * sa;
    const lz = -dx * sa + dz * ca;

    const maxRx = 33.5;
    const maxRz = 24.5;

    const r = Math.hypot(lx / maxRx, lz / maxRz);
    if (r > 1.0) {
      const scale = 1.0 / r;
      const newLx = lx * scale;
      const newLz = lz * scale;
      this.position.x = 2.5 + newLx * ca - newLz * sa;
      this.position.z = 1.0 + newLx * sa + newLz * ca;

      const inwardAngle = Math.atan2(this.position.x - 2.5, this.position.z - 1.0);
      let diff = inwardAngle - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      const turnSign = Math.sign(diff) || 1;
      this.heading += turnSign * Math.min(Math.abs(diff), 4.5 * dt);
      this.sprayIntensity = 1.0;
    }
  }

  private canTrigger(id: string): boolean {
    return (this.maneuverCooldowns[id] ?? 0) <= 0;
  }

  private setCooldown(id: string, seconds: number): void {
    this.maneuverCooldowns[id] = seconds;
  }

  private triggerManeuver(
    cb: (ev: ManeuverEvent) => void,
    name: string,
    points: number,
    zone: string,
    isSpecial = false,
    quality: 'PERFECT' | 'STYLISH' | 'FLOW' | 'SCRUB' = 'FLOW'
  ): void {
    cb({ name, points, zone, isSpecial, quality });
  }
}
