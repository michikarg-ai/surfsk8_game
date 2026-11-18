import * as THREE from 'three';
import { ParkSurface, SurfaceSample } from './ParkSurface';

export interface InputState {
  steerLeft: boolean;
  steerRight: boolean;
  forwardPush: boolean;
  compressCrouch: boolean;
  jumpOllie: boolean;
  grindSlash: boolean;
  snapSlide: boolean; // V for Bert Slide
  snapTrick: boolean; // F for the surf-style SNAP at the top of a wall
  laybackTrick: boolean; // G for the Layback (hold while carving fast)
  reverseTrick: boolean; // B for the FS Reverse 360
  indyGrabTrick: boolean; // Space (while in air) or I for Indy Grab
  analogSteer?: number; // Optional analog steer [-1.0..1.0] for smooth mobile touch carving
}

/** The scoring tricks. Only these give points. */
export type TrickId = 'SNAP' | 'LAYBACK' | 'BERTSLIDE' | 'REVERSE360' | 'INDYGRAB';

export interface ManeuverEvent {
  name: string;
  points: number;
  zone: string;
  isSpecial?: boolean;
  isSnap?: boolean;
  /** Set for every scoring trick: triggers zoom, slow motion, banner and swoosh. */
  trick?: TrickId;
  quality?: 'PERFECT' | 'STYLISH' | 'FLOW' | 'SCRUB';
}

export type TruckFeelPreset = 'smooth' | 'balanced' | 'snappy';

/** Whether a SNAP is currently possible (used by the HUD hint). */
export type SnapWindow = 'NONE' | 'TOO_SLOW' | 'READY' | 'TOO_FAST';

// -----------------------------------------------------------------------------
// Global physics constants
// -----------------------------------------------------------------------------
/** Whole-game translational time scale: 0.75 = gameplay runs at 75% of real time. */
const TIME_SCALE = 0.75;
/** Real gravity. Combined with energy conservation, max climb height = v² / (2g). */
const GRAVITY = 9.81;
/** Rolling resistance of urethane wheels on concrete (m/s²). */
const ROLLING_RESISTANCE = 0.28;
/** Aerodynamic drag coefficient (per metre). */
const AIR_DRAG = 0.010;
/** Hard speed cap (m/s, simulation speed). */
const MAX_SPEED = 9.5;
/** Speed given by the initial push-off from a standstill (+80% crisper startup). */
const PUSH_OFF_SPEED = 3.6;
/** Below this speed the skater counts as standing still (full kick-push allowed). */
const STANDSTILL_SPEED = 0.4;
/** Startup push-boost ceiling: extra pushes / holding push work up to this cruising speed. */
const PUSH_STARTUP_SPEED = 4.2;
/** Tangential push acceleration while holding forwardPush below PUSH_STARTUP_SPEED (m/s²). */
const PUSH_ACCEL = 3.6;

// ---- Flat-ground pumping (alternating ← → carves with the right rhythm) ----
/** Time between two direction switches (real seconds) that still counts as a pump. */
const PUMP_MIN_INTERVAL = 0.15;
const PUMP_MAX_INTERVAL = 1.15;
/** Sweet spot of the rhythm: ~1 full left-right cycle per second. */
const PUMP_PERFECT_MIN = 0.25;
const PUMP_PERFECT_MAX = 0.70;
const PUMP_GAIN_PERFECT = 1.25;
const PUMP_GAIN_GOOD = 0.70;
/** Pumping on flat ground tapers off towards this speed. */
const MAX_PUMP_SPEED = 5.4;

// ---- Wall pumping (stretch on the way up, compress on the way down) ----
/**
 * Extra acceleration (fraction of the downhill gravity component) gained by compressing
 * while dropping DOWN a wall. Holding S/Shift on the drop pumps harder.
 */
const WALL_PUMP_GAIN = 0.40;
const WALL_PUMP_GAIN_ACTIVE = 0.60;
/** Stretching the body on the climb slightly counters gravity (fraction of g·sinθ). */
const WALL_STRETCH_ASSIST = 0.08;

// ---- Tricks ----
const LAYBACK_MIN_SPEED = 3.7;
const LAYBACK_HOLD_TIME = 0.65;
const BERT_MIN_SPEED = 3.5;
const BERT_HOLD_TIME = 0.55;
const REVERSE_MIN_SPEED = 3.6;
/** Duration (seconds) of the full 360° tail spin of the FS Reverse. */
const REVERSE_DURATION = 0.8;

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
  public smoothedYawRate = 0;

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
  public ollieCooldown = 0;
  private postJumpFlatTimer = 0;

  // Slide trick difficulty & cooldown balance (Issue #22)
  public slideTrickCooldown = 0;

  // Session timer, Overtime & Endless Mode state
  public endlessMode = false;
  public sessionTimer = 120.0;
  public sessionOvertime = false;
  public sessionFinished = false;
  public comboCount = 0;
  public comboScore = 0;
  public hotSpotMultiplier = 1.0;

  // Surf-Zone Overdrive (>= 80% Flow) & Perfect Pump state
  public isSurfZoneActive = false;
  public surfZoneTimer = 0;
  public perfectPumpFlashTimer = 0;
  private perfectPumpCooldown = 0;
  private surfZoneOverdriveCooldown = 0;
  private prevSurfZoneActive = false;
  private prevCompressInput = false;
  private prevSinT = 0;

  // Bail / Wipeout state (triggered when landing not aligned or holding grab)
  public isBailing = false;
  public bailTimer = 0;
  public readonly bailDuration = 1.35;
  public bailImpactPos = new THREE.Vector3();
  public bailImpactHeading = 0;
  public bailReason = '';
  public onBail?: (reason: string) => void;

  // Flow & Pump rhythm state
  public flowMeter = 35;
  public pumpSyncQuality: 'IDLE' | 'PERFECT PUMP!' | 'FLOW PUMP' | 'SCRUB' = 'IDLE';
  public pumpQualityTimer = 0;
  public sprayIntensity = 0;

  // SNAP trick state
  public snapWindow: SnapWindow = 'NONE';
  /** Short feedback text for failed trick attempts (shown by the HUD). */
  public snapFeedback = '';
  public snapFeedbackTimer = 0;
  public snapActive = false;
  private snapTimer = 0;
  private snapTurnRate = 0;
  private prevSnapInput = false;

  // Coaching hint (e.g. "alternate ← → to pump") shown by the HUD
  public coachHint = '';
  public coachHintTimer = 0;

  // Flat-ground pump rhythm tracking
  private lastPumpDir = 0;
  private timeSincePumpSwitch = 99;
  private prevPushInput = false;
  /** 0..1 pulse that drives a visible body pump when a pump lands. */
  public pumpPulse = 0;

  // Layback
  public laybackActive = false;
  /** Smoothed 0..1 amount of the layback body pose. */
  public laybackAmount = 0;
  private laybackHold = 0;
  private laybackScored = false;
  private prevLaybackInput = false;
  private laybackAccumulatedYaw = 0;
  private laybackKeyReleased = true;

  // Bert slide
  /** Smoothed 0..1 amount of the Bertleman hand-plant slide pose. */
  public bertSlideAmount = 0;
  private bertHold = 0;
  private bertScored = false;
  private prevBertInput = false;
  private bertSlideAccumulatedYaw = 0;
  private bertKeyReleased = true;

  // FS Reverse 360
  public reverseActive = false;
  private reverseTimer = 0;
  private prevReverseInput = false;

  // Indy Grab (airborne trick)
  public indyGrabActive = false;
  /** Smoothed 0..1 amount of the airborne Indy grab tuck and board tweak. */
  public indyGrabAmount = 0;
  public indyGrabReady = false;
  public indyGrabHold = 0;
  public indyGrabScored = false;
  private airLaunchedFromWall = false;
  private airLaunchHeight = 0;
  private airLaunchSpeed = 0;
  private prevIndyInput = false;

  /**
   * Visual yaw of the board relative to the direction of travel (radians):
   * the tail sliding out during a Bert slide and the full spin of the FS Reverse 360.
   */
  public boardYawOffset = 0;

  /** Signed grade along the current heading (dh/ds): > 0 climbing, < 0 dropping in. */
  public gradeAlongHeading = 0;

  // Turn tracking for Bottom Turn, Top Turn, Roundhouse Cutback
  private cumulativeCarveAngle = 0;
  private lastCarveSign = 0;
  private maneuverCooldowns: Record<string, number> = {};
  private lastClimbedWallHeight = 0;
  private wasClimbingTransition = false;

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

  private spawnX = 15.2;
  private spawnZ = 4.2;
  private spawnHeading = 1.38;

  public setSpawn(x: number, z: number, heading: number): void {
    this.spawnX = x;
    this.spawnZ = z;
    this.spawnHeading = heading;
  }

  /** Top speed cap (m/s), boosted by +8% during Surf-Zone Overdrive (>= 80% Flow). */
  public get maxSpeedLimit(): number {
    return this.isSurfZoneActive ? MAX_SPEED * 1.08 : MAX_SPEED;
  }

  /**
   * Apply Surf-Zone Overdrive (1.5x) and Hot-Spot multiplier to trick / maneuver points.
   */
  public applyScoreMultipliers(basePoints: number): number {
    if (basePoints <= 0) return 0;
    const surfZoneMult = this.isSurfZoneActive ? 1.5 : 1.0;
    return Math.round(basePoints * surfZoneMult * this.hotSpotMultiplier);
  }

  public resetToSpawn(): void {
    this.position.set(this.spawnX, 0, this.spawnZ);
    this.currentSurface = this.park.sample(this.position.x, this.position.z);
    this.position.y = this.currentSurface.height;
    this.heading = this.spawnHeading;
    this.speed = 0; // start standing still: one push-off, then pump!
    this.velocity.set(0, 0, 0);
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
    this.laybackActive = false;
    this.laybackAmount = 0;
    this.laybackHold = 0;
    this.laybackScored = false;
    this.laybackAccumulatedYaw = 0;
    this.laybackKeyReleased = true;
    this.bertSlideActive = false;
    this.bertSlideAmount = 0;
    this.bertHold = 0;
    this.bertScored = false;
    this.bertSlideAccumulatedYaw = 0;
    this.bertKeyReleased = true;
    this.reverseActive = false;
    this.boardYawOffset = 0;
    this.indyGrabActive = false;
    this.indyGrabAmount = 0;
    this.indyGrabReady = false;
    this.indyGrabHold = 0;
    this.indyGrabScored = false;
    this.airLaunchedFromWall = false;
    this.isBailing = false;
    this.bailTimer = 0;
    this.lastPumpDir = 0;
    this.timeSincePumpSwitch = 99;

    // Reset session timer, overtime, Surf-Zone & Perfect Pump state
    this.sessionTimer = 120.0;
    this.sessionOvertime = false;
    this.sessionFinished = false;
    this.surfZoneTimer = 0;
    this.comboCount = 0;
    this.comboScore = 0;
    this.isSurfZoneActive = false;
    this.prevSurfZoneActive = false;
    this.surfZoneOverdriveCooldown = 0;
    this.perfectPumpCooldown = 0;
    this.perfectPumpFlashTimer = 0;
    this.prevCompressInput = false;
    this.prevSinT = 0;
    this.slideTrickCooldown = 0;
    this.ollieCooldown = 0;
    this.postJumpFlatTimer = 0;
  }

  public update(dt: number, input: InputState, onManeuver: (ev: ManeuverEvent) => void): void {
    const clampedDt = Math.min(dt, 0.033);
    // Translational simulation step (gameplay runs at TIME_SCALE of real time)
    const simDt = clampedDt * TIME_SCALE;

    // While bailing: skater is sliding/falling on the ground, then respawns right at impact point
    if (this.isBailing) {
      this.bailTimer -= clampedDt;
      this.speed = 0;
      this.velocity.set(0, 0, 0);
      this.position.copy(this.bailImpactPos);
      this.currentSurface = this.park.sample(this.position.x, this.position.z);
      this.position.y = this.currentSurface.height;
      this.leanAngle = 0;
      this.frontTruckYaw = 0;
      this.rearTruckYaw = 0;
      this.sprayIntensity = Math.max(0, this.sprayIntensity - clampedDt * 2.5);

      if (this.bailTimer <= 0) {
        // Respawn exactly where the player landed!
        this.isBailing = false;
        this.position.copy(this.bailImpactPos);
        this.currentSurface = this.park.sample(this.position.x, this.position.z);
        this.position.y = this.currentSurface.height;
        this.heading = this.bailImpactHeading;
        this.boardYawOffset = 0;
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        this.compression = 0.15;
        this.coachHint = 'Aligned landings: point your board in travel direction!';
        this.coachHintTimer = 2.5;
      }
      return;
    }

    // -------------------------------------------------------------------------
    // Session Timer, Overtime & Endless Mode
    // -------------------------------------------------------------------------
    if (!this.endlessMode) {
      if (this.sessionTimer > 0) {
        this.sessionTimer = Math.max(0, this.sessionTimer - clampedDt);
      }
      if (this.sessionTimer <= 0) {
        const isInComboOrAir =
          this.comboCount > 0 ||
          this.comboScore > 0 ||
          !this.isGrounded ||
          this.isGrinding;
        if (isInComboOrAir) {
          this.sessionOvertime = true;
        } else {
          this.sessionOvertime = false;
          this.sessionFinished = true;
        }
      }
    } else {
      this.sessionTimer = 120.0;
      this.sessionOvertime = false;
      this.sessionFinished = false;
    }

    // Cooldown & feedback timers
    if (this.perfectPumpCooldown > 0) {
      this.perfectPumpCooldown = Math.max(0, this.perfectPumpCooldown - clampedDt);
    }
    if (this.perfectPumpFlashTimer > 0) {
      this.perfectPumpFlashTimer = Math.max(0, this.perfectPumpFlashTimer - clampedDt);
    }
    if (this.surfZoneOverdriveCooldown > 0) {
      this.surfZoneOverdriveCooldown = Math.max(0, this.surfZoneOverdriveCooldown - clampedDt);
    }
    if (this.slideTrickCooldown > 0) {
      this.slideTrickCooldown = Math.max(0, this.slideTrickCooldown - clampedDt);
    }
    if (this.ollieCooldown > 0) {
      this.ollieCooldown = Math.max(0, this.ollieCooldown - clampedDt);
    }
    if (this.postJumpFlatTimer > 0) {
      this.postJumpFlatTimer = Math.max(0, this.postJumpFlatTimer - clampedDt);
    }

    // -------------------------------------------------------------------------
    // Surf-Zone Overdrive State (>= 80% Flow)
    // -------------------------------------------------------------------------
    if (this.flowMeter >= 80) {
      this.isSurfZoneActive = true;
      this.surfZoneTimer += clampedDt;
    } else {
      this.isSurfZoneActive = false;
    }

    if (this.isSurfZoneActive && !this.prevSurfZoneActive && this.surfZoneOverdriveCooldown <= 0) {
      this.surfZoneOverdriveCooldown = 6.0;
      onManeuver({
        name: '🔥 SURF-ZONE OVERDRIVE (1.5x)!',
        points: this.applyScoreMultipliers(200),
        zone: this.currentSurface.zoneName,
        quality: 'PERFECT',
        isSpecial: true,
      });
    }
    this.prevSurfZoneActive = this.isSurfZoneActive;

    for (const key of Object.keys(this.maneuverCooldowns)) {
      this.maneuverCooldowns[key] = Math.max(0, this.maneuverCooldowns[key] - clampedDt);
    }
    if (this.pumpQualityTimer > 0) {
      this.pumpQualityTimer = Math.max(0, this.pumpQualityTimer - clampedDt);
      if (this.pumpQualityTimer === 0) this.pumpSyncQuality = 'IDLE';
    }
    if (this.snapFeedbackTimer > 0) {
      this.snapFeedbackTimer = Math.max(0, this.snapFeedbackTimer - clampedDt);
      if (this.snapFeedbackTimer === 0) this.snapFeedback = '';
    }
    if (this.coachHintTimer > 0) {
      this.coachHintTimer = Math.max(0, this.coachHintTimer - clampedDt);
      if (this.coachHintTimer === 0) this.coachHint = '';
    }
    this.pumpPulse = Math.max(0, this.pumpPulse - clampedDt * 3.2);
    this.timeSincePumpSwitch += clampedDt;

    this.currentSurface = this.park.sample(this.position.x, this.position.z);

    // -------------------------------------------------------------------------
    // 1. Steering & Dual-Axis Surf-Adapter Geometry
    // -------------------------------------------------------------------------
    const rawSteer =
      input.analogSteer !== undefined && Math.abs(input.analogSteer) > 0.05
        ? input.analogSteer
        : (input.steerRight ? 1 : 0) - (input.steerLeft ? 1 : 0);

    if (rawSteer === 0) {
      this.postJumpFlatTimer = 0;
    }

    if (this.isGrounded && this.postJumpFlatTimer <= 0 && rawSteer !== 0) {
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

    if (this.isGrounded && this.postJumpFlatTimer <= 0) {
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
    } else {
      // Airborne or settling immediately after touchdown: keep deck flat (no surfboard rail tilt)
      this.leanAngle = 0;
      this.leanRate = 0;
      this.frontTruckYaw = 0;
      this.rearTruckYaw = 0;
      if (!this.isGrounded) {
        this.pitchAngle = 0;
      }
      this.upperBodyLeadYaw += (0 - this.upperBodyLeadYaw) * Math.min(1, 26.0 * clampedDt);
    }

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

    // Automatic surf-pump body motion on walls (like pumping a wave):
    //  - climbing the face: STRETCH the body tall to fight gravity (no speed gain)
    //  - dropping down the face: COMPRESS into the knees — this is where speed is gained
    let autoWallCompression = 0.15;
    if (isOnWall && this.isGrounded) {
      if (grade > 0.08) {
        autoWallCompression = 0.04; // climbing: extend tall & unweight
      } else if (grade < -0.08) {
        autoWallCompression = 0.88; // dropping in: drive down through the knees
      } else if (h0 >= 0.35) {
        autoWallCompression = 0.45; // apex: transition from stretch to compression
      }
    }
    // Visible body pump on flat ground every time a rhythm pump lands
    autoWallCompression = Math.max(autoWallCompression, this.pumpPulse * 0.75);

    const targetCompression = input.compressCrouch
      ? 0.92
      : this.bertSlideActive || this.snapActive || this.indyGrabActive
      ? 0.95
      : this.laybackActive
      ? 0.7
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

      // ---- 4a2. Layback / Bert slide / FS Reverse 360 ----
      this.updateTricks(clampedDt, input, onManeuver);

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
        // Layback strictly carves backside (left / negative effectiveLean) — regular stance back hand into wall
        const effectiveLean = this.bertSlideActive
          ? this.bertSlideHandSide * Math.max(Math.abs(this.leanAngle), 0.65)
          : this.laybackActive
          ? -Math.max(Math.abs(this.leanAngle), 0.58)
          : this.leanAngle;

        let trickMultiplier = this.bertSlideActive ? 2.2 : this.laybackActive ? 1.35 : 1.0;

        // Capping Layback & Bert Slide turn rate near 180° (Math.PI radians) to prevent doughnuts
        if (this.laybackActive) {
          const yawProgress = this.laybackAccumulatedYaw;
          if (yawProgress >= 2.4) {
            const dampFactor = Math.max(0, 1 - (yawProgress - 2.4) / (Math.PI - 2.4));
            trickMultiplier *= dampFactor;
          }
        } else if (this.bertSlideActive) {
          const yawProgress = this.bertSlideAccumulatedYaw;
          if (yawProgress >= 2.4) {
            const dampFactor = Math.max(0, 1 - (yawProgress - 2.4) / (Math.PI - 2.4));
            trickMultiplier *= dampFactor;
          }
        }

        const targetYawRate = -effectiveLean * baseTurnRate * lowSpeedPivotFactor * trickMultiplier;
        this.smoothedYawRate +=
          (targetYawRate - this.smoothedYawRate) * Math.min(1, (rawSteer === 0 ? 38.0 : 34.0) * clampedDt);

        if (
          (this.laybackActive && this.laybackAccumulatedYaw >= Math.PI * 0.98) ||
          (this.bertSlideActive && this.bertSlideAccumulatedYaw >= Math.PI * 0.98)
        ) {
          this.smoothedYawRate = 0;
        }

        const frameYawDelta = Math.abs(this.smoothedYawRate * clampedDt);
        this.heading += this.smoothedYawRate * clampedDt;

        if (this.laybackActive) {
          this.laybackAccumulatedYaw += frameYawDelta;
        }
        if (this.bertSlideActive) {
          this.bertSlideAccumulatedYaw += frameYawDelta;
        }
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

      // Non-gravitational tangential acceleration (pump, friction, slides)
      let aExtra = -ROLLING_RESISTANCE - AIR_DRAG * this.speed * this.speed;
      if (this.bertSlideActive) aExtra -= 2.2;
      if (this.laybackActive) aExtra -= 1.8;
      if (this.reverseActive) aExtra -= 2.0;

      // ---- Push-off: snappy surfskate kick-start up to cruising speed, then pump! ----
      const canPush = Math.abs(grade) < 0.12 && h0 < 0.35;
      const pushPressed = input.forwardPush && !this.prevPushInput;
      this.prevPushInput = input.forwardPush;
      if (input.forwardPush) {
        if (canPush && this.speed < PUSH_STARTUP_SPEED) {
          if (pushPressed) {
            if (this.speed < STANDSTILL_SPEED) {
              this.speed = PUSH_OFF_SPEED; // immediate punchy kick-push from standstill
            } else {
              this.speed = Math.min(PUSH_STARTUP_SPEED, Math.max(PUSH_OFF_SPEED, this.speed + 1.4));
            }
            this.pumpPulse = Math.max(this.pumpPulse, 0.7);
            this.pumpSyncQuality = 'FLOW PUMP';
            this.pumpQualityTimer = 0.6;
            this.coachHint = 'Now PUMP: alternate ← → in rhythm to gain speed';
            this.coachHintTimer = 3.0;
          }
          // Smooth startup acceleration while holding push below cruising speed
          aExtra += PUSH_ACCEL;
        } else if (this.speed >= PUSH_STARTUP_SPEED) {
          this.coachHint = 'At cruise speed — PUMP: alternate ← → in rhythm (≈ 1 left-right cycle per second)';
          this.coachHintTimer = 2.5;
        }
      }

      // ---- Flat-ground pumping: alternate left/right carves with the right timing ----
      this.updateRhythmPump(rawSteer, onManeuver);

      // ---- Wall pumping (like pumping a wave) ----
      // Going UP: the body stretches tall — barely any speed is lost to the stretch itself,
      // but gravity still slows you towards the apex (no free climbing!).
      if (isOnWall && sinT > 0.05) {
        aExtra += WALL_STRETCH_ASSIST * GRAVITY * sinT;
      }
      // Going DOWN: compress into the knees and drive the board down the face → speed!
      if (isOnWall && sinT < -0.05 && !this.bertSlideActive) {
        const active = input.compressCrouch;
        aExtra += (active ? WALL_PUMP_GAIN_ACTIVE : WALL_PUMP_GAIN) * GRAVITY * -sinT * (0.4 + 0.6 * this.compression);
        this.pumpSyncQuality = active ? 'PERFECT PUMP!' : 'FLOW PUMP';
        this.pumpQualityTimer = 0.4;
        this.flowMeter = Math.min(100, this.flowMeter + (active ? 16.0 : 12.0) * clampedDt);

        // Perfect Pump in transitions:
        // When dropping down a wall (h0 > 0.35, sinT < -0.08) at the optimal moment
        const compressPressed = input.compressCrouch && !this.prevCompressInput;
        const apexDropPump = input.compressCrouch && (this.wasClimbingTransition || this.prevSinT >= -0.05) && sinT < -0.08;
        if (
          this.perfectPumpCooldown <= 0 &&
          h0 > 0.35 &&
          sinT < -0.08 &&
          (compressPressed || apexDropPump)
        ) {
          this.perfectPumpCooldown = 2.5;
          this.speed = Math.min(this.maxSpeedLimit, this.speed + 0.85);
          this.flowMeter = Math.min(100, this.flowMeter + 12);
          this.perfectPumpFlashTimer = 0.45;
          this.pumpSyncQuality = 'PERFECT PUMP!';
          this.pumpQualityTimer = 0.8;
          this.pumpPulse = 1.0;
          onManeuver({
            name: '⚡ PERFECT PUMP!',
            points: this.applyScoreMultipliers(150),
            zone: this.currentSurface.zoneName,
            quality: 'PERFECT',
          });
        }
      }

      this.detectSurfManeuvers(input, grade, onManeuver);

      if (input.jumpOllie && this.ollieCooldown <= 0) {
        // ---- 4d. Ollie / Air ----
        this.isGrounded = false;
        this.airTime = 0;
        this.airRotation = 0;
        this.maxAirHeight = 0;
        this.leanAngle = 0;
        this.leanRate = 0;
        this.frontTruckYaw = 0;
        this.rearTruckYaw = 0;
        this.pitchAngle = 0;
        this.smoothedYawRate = 0;
        this.steerHoldTime = 0;
        this.lastSteerDir = 0;
        this.cancelGroundTricks();
        this.airLaunchedFromWall = isOnWall;
        this.airLaunchHeight = h0;
        this.airLaunchSpeed = this.speed;
        this.indyGrabActive = false;
        this.indyGrabHold = 0;
        this.indyGrabScored = false;
        this.indyGrabAmount = 0;
        this.indyGrabReady = false;

        const isWallPop = isOnWall && (grade > 0.04 || h0 > 0.35);
        // Ollie physics:
        // - Flat ground: base pop 2.55 m/s (with crouch up to 3.05 m/s)
        // - Wall/lip launch: ramp boost factor 0.78 with controlled pop
        const wallBase = isWallPop ? 3.1 : 2.55;
        const rampLaunchBoost = this.speed * Math.max(0, sinT) * 0.78;
        const compressionPop = this.compression * (isWallPop ? 0.75 : 0.50);
        const vy = wallBase + rampLaunchBoost + compressionPop;

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
          this.speed = Math.min(this.maxSpeedLimit, Math.sqrt(Math.max(0, v1Sq)));
        }

        // Stall on a wall: at very low speed gravity pulls the nose down the fall line
        if (
          slopeMag > 0.12 &&
          this.speed < 0.9 &&
          !this.snapActive &&
          !this.laybackActive &&
          !this.bertSlideActive &&
          !this.reverseActive
        ) {
          const downhillHeading = Math.atan2(slopeX, slopeZ);
          let diff = downhillHeading - this.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const swingRate = (2.4 + 2.0 * Math.min(1.5, slopeMag)) * (1 - this.speed / 0.9);
          this.heading += Math.sign(diff) * Math.min(Math.abs(diff), swingRate * clampedDt);
          if (this.speed < 0.05 && Math.abs(diff) < 0.6) {
            this.heading = downhillHeading; // kick-turn: drop back in straight down the fall line
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
      this.cancelGroundTricks();
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

      // ---- INDY GRAB in mid-air ----
      const indyPressed = input.indyGrabTrick && !this.prevIndyInput;
      this.prevIndyInput = input.indyGrabTrick;

      // High enough to grab: above 0.36m from surface or reached apex >= 0.45m
      const isHighEnough =
        heightAboveSurface >= 0.36 || (this.maxAirHeight >= 0.45 && heightAboveSurface >= 0.22);
      this.indyGrabReady = this.airLaunchedFromWall && isHighEnough;

      if (input.indyGrabTrick) {
        if (!this.airLaunchedFromWall) {
          if (indyPressed) {
            this.trickFail('INDY GRAB: Ollie off a steep wall for more air!');
          }
        } else if (!isHighEnough && this.velocity.y < 0) {
          if (indyPressed) {
            this.trickFail('INDY GRAB: Need more height off the wall!');
          }
        } else if (isHighEnough) {
          this.indyGrabActive = true;
          this.indyGrabHold += dt;
          if (!this.indyGrabScored && this.indyGrabHold >= 0.26) {
            this.indyGrabScored = true;
            const isBigAir = this.maxAirHeight >= 0.82 || this.airLaunchSpeed >= 3.8;
            this.emitTrick(
              onManeuver,
              'INDYGRAB',
              isBigAir ? 'PERFECT INDY AIR!' : 'INDY GRAB!',
              isBigAir ? 1800 : 1300,
              isBigAir
            );
          }
        }
      } else {
        this.indyGrabActive = false;
      }

      const targetGrabAmt = this.indyGrabActive ? 1.0 : 0.0;
      const grabRate = this.indyGrabActive ? 14.0 : 9.0;
      this.indyGrabAmount += (targetGrabAmt - this.indyGrabAmount) * Math.min(1, dt * grabRate);

      if (this.position.y <= this.currentSurface.height && this.velocity.y <= 0) {
        this.position.y = this.currentSurface.height;
        this.isGrounded = true;
        this.ollieCooldown = 0.40; // Short cooldown after landing to prevent bunny-hop spam

        // Keep only the velocity component tangent to the landing surface
        const n = this.currentSurface.normal;
        const vDotN = this.velocity.dot(n);
        const tangentVel = this.velocity.clone().addScaledVector(n, -vDotN);
        const horizSpeed = Math.hypot(tangentVel.x, tangentVel.z);

        // Check whether landing is straight enough or if the skater bailed
        const hadSignificantAir =
          this.airTime >= 0.18 || this.maxAirHeight >= 0.25 || this.airLaunchedFromWall;
        const grabActiveOnImpact = this.indyGrabActive;

        let shouldBail = false;
        let bailReason = '';

        if (grabActiveOnImpact) {
          shouldBail = true;
          bailReason = 'LET GO OF GRAB BEFORE IMPACT!';
        } else if (hadSignificantAir && horizSpeed >= 0.8) {
          const travelHeading = Math.atan2(-tangentVel.x, -tangentVel.z);
          const currentBoardHeading = this.heading + this.boardYawOffset;
          let alignDiff = currentBoardHeading - travelHeading;
          while (alignDiff > Math.PI) alignDiff -= Math.PI * 2;
          while (alignDiff < -Math.PI) alignDiff += Math.PI * 2;
          const alignError = Math.abs(alignDiff);

          // Allowed landing angle: ~40° (0.70 rad)
          const MAX_LANDING_ANGLE = 0.70;
          if (alignError > MAX_LANDING_ANGLE) {
            shouldBail = true;
            if (alignError > 2.0) {
              bailReason = 'LANDED BACKWARDS!';
            } else {
              bailReason = 'NOT ALIGNED WITH TRAVEL!';
            }
          }
        }

        if (shouldBail) {
          const travelHeading =
            horizSpeed >= 0.5 ? Math.atan2(-tangentVel.x, -tangentVel.z) : this.heading;
          this.triggerBail(bailReason, travelHeading, onManeuver);
          return;
        }

        if (this.indyGrabActive && !this.indyGrabScored) {
          this.trickFail('INDY GRAB: Let go before landing or get more air!');
        } else if (this.indyGrabScored) {
          this.flowMeter = Math.min(100, this.flowMeter + 15);
        }
        this.indyGrabActive = false;
        this.indyGrabAmount = 0;
        this.indyGrabReady = false;

        // Land flat on the concrete with zero lingering surfboard tilt/roll
        this.leanAngle = 0;
        this.leanRate = 0;
        this.frontTruckYaw = 0;
        this.rearTruckYaw = 0;
        this.smoothedYawRate = 0;
        this.steerHoldTime = 0;
        this.lastSteerDir = 0;
        this.bertSlideAmount = 0;
        this.laybackAmount = 0;
        this.postJumpFlatTimer = 0.14;

        this.speed = Math.min(this.maxSpeedLimit, tangentVel.length());
        if (Math.hypot(tangentVel.x, tangentVel.z) > 0.2) {
          this.heading = Math.atan2(-tangentVel.x, -tangentVel.z);
        }
        this.pitchAngle = Math.atan(this.computeGradeAlongHeading()) * 0.72;
        this.flowMeter = Math.min(100, this.flowMeter + 10);
      }
    }

    this.wheelSpinAngle = (this.wheelSpinAngle + this.speed * simDt * 18.0) % (Math.PI * 2);

    if (this.speed < 1.05) {
      this.flowMeter = Math.max(0, this.flowMeter - 4.0 * clampedDt);
    }

    // Save previous inputs & slope for next frame
    this.prevCompressInput = input.compressCrouch;
    const currentGrade = this.gradeAlongHeading;
    this.prevSinT = currentGrade / Math.sqrt(1 + currentGrade * currentGrade);
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
      points: this.applyScoreMultipliers(perfect ? 1500 : 900),
      zone: this.currentSurface.zoneName,
      isSnap: true,
      trick: 'SNAP',
      quality: perfect ? 'PERFECT' : 'STYLISH',
    });
  }

  /**
   * Non-scoring line tracking (top/bottom turns, cutbacks keep the flow meter alive).
   * Only SNAP, LAYBACK, BERTSLIDE and FS REVERSE 360 give points.
   */
  private detectSurfManeuvers(
    _input: InputState,
    grade: number,
    _onManeuver: (ev: ManeuverEvent) => void
  ): void {
    const h = this.currentSurface.height;
    const absLean = Math.abs(this.leanAngle);
    if (!this.bertSlideActive && !this.reverseActive && !this.snapActive) {
      this.sprayIntensity = Math.max(0, this.sprayIntensity - 0.08);
    }

    if (grade > 0.06 && h > 0.22) {
      this.wasClimbingTransition = true;
      this.lastClimbedWallHeight = Math.max(this.lastClimbedWallHeight, h);
    } else if (h < 0.12) {
      this.wasClimbingTransition = false;
      this.lastClimbedWallHeight = 0;
    }

    // Top turn over the apex: flow only
    if (this.wasClimbingTransition && this.lastClimbedWallHeight > 0.55 && grade <= 0.06 && absLean > 0.18) {
      this.wasClimbingTransition = false;
      this.lastClimbedWallHeight = 0;
      this.flowMeter = Math.min(100, this.flowMeter + 8);
    }

    // Big continuous carve: flow only
    if (this.cumulativeCarveAngle > 1.85 && this.speed > 2.2) {
      this.cumulativeCarveAngle = 0;
      this.flowMeter = Math.min(100, this.flowMeter + 10);
    }
  }

  /**
   * Flat-ground pumping (Surfskate Maneuver #1). Every switch between a left and a right
   * carve is one pump. The interval between switches decides how much speed it gives:
   * too hectic scrubs speed, too lazy gives nothing, the right rhythm accelerates.
   */
  private updateRhythmPump(rawSteer: number, _onManeuver: (ev: ManeuverEvent) => void): void {
    // Only detect a pump switch when steering direction actually reverses between Left and Right.
    // Require a clear steer intention (|rawSteer| >= 0.20) so analog stick wiggles don't falsely scrub speed.
    if (Math.abs(rawSteer) < 0.20) return;
    const currentDir = rawSteer > 0 ? 1 : -1;
    if (currentDir === this.lastPumpDir) return;

    const interval = this.timeSincePumpSwitch;
    const firstSwitch = this.lastPumpDir === 0;
    this.lastPumpDir = currentDir;
    this.timeSincePumpSwitch = 0;
    if (firstSwitch) return;

    if (this.speed < STANDSTILL_SPEED) {
      this.coachHint = 'Too slow to pump — press ↑ once to push off';
      this.coachHintTimer = 2.0;
      return;
    }
    // Pumping only works while the wheels are on the ground and not mid-trick
    if (this.bertSlideActive || this.reverseActive || this.snapActive) return;

    // Pumping gets harder the faster you already go
    const taper = Math.max(0, 1 - this.speed / MAX_PUMP_SPEED);

    if (interval < PUMP_MIN_INTERVAL) {
      // Wiggling hectically just scrubs speed
      this.speed = Math.max(0, this.speed - 0.08);
      this.pumpSyncQuality = 'SCRUB';
      this.pumpQualityTimer = 0.6;
      this.coachHint = 'Too hectic! Slow down your ← → rhythm';
      this.coachHintTimer = 1.6;
    } else if (interval > PUMP_MAX_INTERVAL) {
      // Too lazy: just a carve, no pump
      if (this.speed < 2.0) {
        this.coachHint = 'Faster rhythm: switch ← → about twice per second';
        this.coachHintTimer = 1.8;
      }
    } else if (interval >= PUMP_PERFECT_MIN && interval <= PUMP_PERFECT_MAX) {
      this.speed = Math.min(this.maxSpeedLimit, this.speed + PUMP_GAIN_PERFECT * taper);
      this.pumpSyncQuality = 'PERFECT PUMP!';
      this.pumpQualityTimer = 0.7;
      this.pumpPulse = 1;
      this.flowMeter = Math.min(100, this.flowMeter + 4);
    } else {
      this.speed = Math.min(this.maxSpeedLimit, this.speed + PUMP_GAIN_GOOD * taper);
      this.pumpSyncQuality = 'FLOW PUMP';
      this.pumpQualityTimer = 0.6;
      this.pumpPulse = 0.7;
      this.flowMeter = Math.min(100, this.flowMeter + 2);
    }
  }

  /** Abort all ground tricks (e.g. when going airborne). */
  private cancelGroundTricks(): void {
    if (this.bertSlideActive || this.laybackActive || this.reverseActive) {
      this.slideTrickCooldown = 1.5;
    }
    this.laybackActive = false;
    this.laybackAmount = 0;
    this.laybackHold = 0;
    this.laybackAccumulatedYaw = 0;
    this.bertSlideActive = false;
    this.bertSlideAmount = 0;
    this.bertHold = 0;
    this.bertSlideAccumulatedYaw = 0;
    this.reverseActive = false;
    this.boardYawOffset = 0;
  }

  public triggerBail(
    reason: string,
    travelHeading: number,
    onManeuver?: (ev: ManeuverEvent) => void
  ): void {
    this.isBailing = true;
    this.bailTimer = this.bailDuration;
    this.bailReason = reason;
    this.bailImpactPos.copy(this.position);
    this.bailImpactHeading = travelHeading;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.isGrounded = true;
    this.airTime = 0;
    this.maxAirHeight = 0;
    this.airLaunchedFromWall = false;
    this.postJumpFlatTimer = 0;
    this.indyGrabActive = false;
    this.indyGrabReady = false;
    this.indyGrabAmount = 0;
    this.flowMeter = 0;
    this.sprayIntensity = 0.95;

    this.onBail?.(reason);

    if (onManeuver) {
      this.triggerManeuver(
        onManeuver,
        `WIPEOUT! (${reason})`,
        0,
        this.currentSurface.zoneName,
        false,
        'SCRUB'
      );
    }
  }

  private trickFail(text: string): void {
    this.snapFeedback = text;
    this.snapFeedbackTimer = 1.3;
  }

  private emitTrick(
    onManeuver: (ev: ManeuverEvent) => void,
    trick: TrickId,
    name: string,
    points: number,
    perfect: boolean
  ): void {
    this.flowMeter = Math.min(100, this.flowMeter + 20);
    onManeuver({
      name,
      points: this.applyScoreMultipliers(points),
      zone: this.currentSurface.zoneName,
      trick,
      isSpecial: true,
      quality: perfect ? 'PERFECT' : 'STYLISH',
    });
  }

  /** Layback, Bert slide and FS Reverse 360. */
  private updateTricks(dt: number, input: InputState, onManeuver: (ev: ManeuverEvent) => void): void {
    // ---------------- FS REVERSE 360 (B) ----------------
    // Carve into a turn, whip the tail around a full 360°, ride out forward.
    const reversePressed = input.reverseTrick && !this.prevReverseInput;
    this.prevReverseInput = input.reverseTrick;
    if (reversePressed && !this.reverseActive && !this.snapActive) {
      if (this.slideTrickCooldown > 0) {
        this.trickFail('REVERSE 360: reset line before next slide!');
      } else if (this.speed < REVERSE_MIN_SPEED) {
        this.trickFail(`REVERSE 360: need speed (${REVERSE_MIN_SPEED.toFixed(1)}+ m/s) — pump!`);
      } else if (Math.abs(this.leanAngle) < 0.14) {
        this.trickFail('REVERSE 360: carve into turn (← or →) first!');
      } else if (!this.canPerformReverse()) {
        this.trickFail('REVERSE 360: requires carve or transition!');
      } else {
        this.reverseActive = true;
        this.reverseTimer = 0;
        this.laybackActive = false;
        this.bertSlideActive = false;
      }
    }
    if (this.reverseActive) {
      this.reverseTimer += dt;
      // Keep speed fluid: never stall mid-trick
      this.speed = Math.max(2.4, this.speed);
      const t = Math.min(1, this.reverseTimer / REVERSE_DURATION);
      // Ease-in-out spin; rotation follows carve direction
      const spinDir = Math.sign(this.leanAngle) || 1;
      const eased = t * t * (3 - 2 * t);
      this.boardYawOffset = -spinDir * eased * Math.PI * 2;
      this.sprayIntensity = 1.0;
      if (t >= 1) {
        this.reverseActive = false;
        this.boardYawOffset = 0;
        // Moderate exit scrub (~18% speed loss)
        this.speed = Math.max(2.6, this.speed * 0.82);
        this.slideTrickCooldown = 1.5;
        this.emitTrick(onManeuver, 'REVERSE360', 'FS REVERSE 360!', 2000, true);
      }
      return; // nothing else while spinning
    }

    // ---------------- BERT SLIDE (V) ----------------
    // Hand-plant slide: carve at speed, plant inside hand, swing tail through pivot arc.
    const bertPressed = input.snapSlide && !this.prevBertInput;
    this.prevBertInput = input.snapSlide;

    if (!input.snapSlide) {
      this.bertKeyReleased = true;
    }

    if (input.snapSlide && !this.laybackActive) {
      if (!this.bertSlideActive) {
        if (bertPressed && this.slideTrickCooldown > 0) {
          this.trickFail('BERT SLIDE: reset line before next slide!');
        } else if (bertPressed && this.speed < BERT_MIN_SPEED) {
          this.trickFail(`BERT SLIDE: need speed (${BERT_MIN_SPEED.toFixed(1)}+ m/s) — pump harder!`);
        } else if (bertPressed && Math.abs(this.leanAngle) < 0.22) {
          this.trickFail('BERT SLIDE: carve deeper into turn (← or →) first!');
        } else if (bertPressed && !this.canPerformBertSlide()) {
          this.trickFail('BERT SLIDE: carve on a bank or deep turn!');
        } else if (this.bertKeyReleased && this.canPerformBertSlide()) {
          this.bertSlideActive = true;
          this.bertHold = 0;
          this.bertScored = false;
          this.bertSlideAccumulatedYaw = 0;
          this.bertSlideHandSide = Math.sign(this.leanAngle) || 1;
          this.laybackActive = false;
          this.bertKeyReleased = false;
        }
      }
    } else {
      if (this.bertSlideActive) {
        this.slideTrickCooldown = 1.5;
        if (this.bertHold >= 0.50 || this.bertSlideAccumulatedYaw >= 2.0) {
          if (!this.bertScored) {
            this.bertScored = true;
            this.speed = Math.max(2.6, this.speed * 0.82);
            this.emitTrick(onManeuver, 'BERTSLIDE', 'BERTSLIDE!', 900, false);
          } else {
            this.speed = Math.max(2.6, this.speed * 0.82);
          }
        } else if (!this.bertScored) {
          this.trickFail('BERT SLIDE: hold V through the slide!');
        }
        this.bertSlideActive = false;
      }
    }

    if (this.bertSlideActive) {
      this.bertHold += dt;
      // Keep speed fluid: never stall mid-trick
      this.speed = Math.max(2.4, this.speed);
      this.sprayIntensity = 1.0;

      if (this.bertSlideAccumulatedYaw >= 3.05 || this.bertHold >= 0.85) {
        // Turn completed: maximum 180° rotation (no doughnuts!) or hold limit reached
        this.bertSlideActive = false;
        this.slideTrickCooldown = 1.5;
        this.speed = Math.max(2.6, this.speed * 0.82);
        if (!this.bertScored) {
          this.bertScored = true;
          this.emitTrick(onManeuver, 'BERTSLIDE', 'BERTSLIDE 180°!', 1200, true);
        }
      } else if (!this.bertScored && (this.bertHold >= BERT_HOLD_TIME || this.bertSlideAccumulatedYaw >= 2.4)) {
        this.bertScored = true;
        this.emitTrick(onManeuver, 'BERTSLIDE', 'BERTSLIDE 180°!', 1200, true);
      }
    }

    // Tail swings out wide around the planted hand
    if (this.bertSlideActive) {
      const slideEnv = Math.sin(Math.min(1, this.bertHold / 0.22) * (Math.PI * 0.5));
      const target = -this.bertSlideHandSide * 0.96 * slideEnv;
      this.boardYawOffset += (target - this.boardYawOffset) * Math.min(1, dt * 14);
    } else {
      this.boardYawOffset += (0 - this.boardYawOffset) * Math.min(1, dt * 10);
    }
    const bertRate = this.bertSlideActive ? 11.0 : 8.5;
    this.bertSlideAmount += ((this.bertSlideActive ? 1 : 0) - this.bertSlideAmount) * Math.min(1, dt * bertRate);

    // ---------------- LAYBACK (G) ----------------
    // Power carve: lay the body back into a fast carve and drag the trailing hand (RightHand)
    // on the concrete wall face. Regular stance: strictly backside / heelside carve (←).
    const laybackPressed = input.laybackTrick && !this.prevLaybackInput;
    this.prevLaybackInput = input.laybackTrick;

    if (!input.laybackTrick) {
      this.laybackKeyReleased = true;
    }

    if (input.laybackTrick && !this.bertSlideActive) {
      if (!this.laybackActive) {
        if (laybackPressed && this.slideTrickCooldown > 0) {
          this.trickFail('LAYBACK: reset line before next slide!');
        } else if (laybackPressed && this.speed < LAYBACK_MIN_SPEED) {
          this.trickFail(`LAYBACK: need speed (${LAYBACK_MIN_SPEED.toFixed(1)}+ m/s) — pump harder!`);
        } else if (laybackPressed && this.leanAngle > -0.22) {
          this.trickFail('LAYBACK: carve backside (←) so your back hand drops into the wall!');
        } else if (laybackPressed && !this.canPerformLayback()) {
          this.trickFail('LAYBACK: approach a wall or bank to lay back into the face!');
        } else if (this.laybackKeyReleased && this.canPerformLayback()) {
          this.laybackActive = true;
          this.laybackHold = 0;
          this.laybackScored = false;
          this.laybackAccumulatedYaw = 0;
          this.laybackKeyReleased = false;
        }
      }
    } else {
      if (this.laybackActive) {
        this.slideTrickCooldown = 1.5;
        if (this.laybackHold >= 0.50 || this.laybackAccumulatedYaw >= 2.0) {
          if (!this.laybackScored) {
            this.laybackScored = true;
            this.speed = Math.max(2.6, this.speed * 0.82);
            this.emitTrick(onManeuver, 'LAYBACK', 'LAYBACK!', 900, false);
          }
        } else if (!this.laybackScored) {
          this.trickFail('LAYBACK: hold G through the carve!');
        }
        this.laybackActive = false;
      }
    }

    if (this.laybackActive) {
      this.laybackHold += dt;
      // Keep speed fluid: never stall mid-trick
      this.speed = Math.max(2.4, this.speed);
      this.sprayIntensity = Math.max(this.sprayIntensity, 0.75);

      if (this.leanAngle > -0.15) {
        // Skater stopped carving backside
        this.laybackActive = false;
        this.slideTrickCooldown = 1.5;
        if (!this.laybackScored) this.trickFail('LAYBACK: keep carving backside (←)!');
      } else if (this.laybackAccumulatedYaw >= 3.05 || this.laybackHold >= 0.85) {
        // Turn completed: maximum 180° rotation (no doughnuts!) or hold limit reached
        this.laybackActive = false;
        this.slideTrickCooldown = 1.5;
        this.speed = Math.max(2.6, this.speed * 0.82);
        if (!this.laybackScored) {
          this.laybackScored = true;
          this.emitTrick(onManeuver, 'LAYBACK', 'LAYBACK 180°!', 1200, true);
        }
      } else if (!this.laybackScored && (this.laybackHold >= LAYBACK_HOLD_TIME || this.laybackAccumulatedYaw >= 2.4)) {
        this.laybackScored = true;
        this.emitTrick(onManeuver, 'LAYBACK', 'LAYBACK 180°!', 1200, true);
      }
    }
    this.laybackAmount += ((this.laybackActive ? 1 : 0) - this.laybackAmount) * Math.min(1, dt * 7);
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
        this.leanAngle = 0;
        this.leanRate = 0;
        this.frontTruckYaw = 0;
        this.rearTruckYaw = 0;
        this.pitchAngle = 0;
        this.smoothedYawRate = 0;
        this.steerHoldTime = 0;
        this.lastSteerDir = 0;
        this.cancelGroundTricks();
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
    if (this.park.getParkId() !== 'im_gefilde') {
      const bounds = this.park.getBounds();
      if (bounds) {
        const margin = 0.9;
        const minX = bounds.xMin + margin;
        const maxX = bounds.xMax - margin;
        const minZ = bounds.zMin + margin;
        const maxZ = bounds.zMax - margin;
        let hit = false;
        if (this.position.x < minX) { this.position.x = minX; hit = true; }
        if (this.position.x > maxX) { this.position.x = maxX; hit = true; }
        if (this.position.z < minZ) { this.position.z = minZ; hit = true; }
        if (this.position.z > maxZ) { this.position.z = maxZ; hit = true; }
        if (hit) {
          const inwardAngle = Math.atan2(this.position.x, this.position.z);
          let diff = inwardAngle - this.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          this.heading += (Math.sign(diff) || 1) * Math.min(Math.abs(diff), 4.5 * dt);
          this.sprayIntensity = 1.0;
        }
        return;
      }
    }

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
    cb({
      name,
      points: this.applyScoreMultipliers(points),
      zone,
      isSpecial,
      quality,
    });
  }

  /** Whether the skater is currently eligible to perform a Bert Slide. */
  public canPerformBertSlide(): boolean {
    if (
      !this.isGrounded ||
      this.isGrinding ||
      this.snapActive ||
      this.reverseActive ||
      this.bertSlideActive ||
      this.laybackActive ||
      this.slideTrickCooldown > 0
    ) {
      return false;
    }

    if (this.speed < BERT_MIN_SPEED) return false;
    const absLean = Math.abs(this.leanAngle);
    if (absLean < 0.22) return false;

    const slopeMag = Math.hypot(this.currentSurface.slopeX, this.currentSurface.slopeZ);
    return slopeMag >= 0.07 || this.currentSurface.height >= 0.15 || absLean >= 0.28;
  }

  /** Whether the skater is currently eligible to perform a Layback Carve. */
  public canPerformLayback(): boolean {
    if (
      !this.isGrounded ||
      this.isGrinding ||
      this.snapActive ||
      this.reverseActive ||
      this.laybackActive ||
      this.bertSlideActive ||
      this.slideTrickCooldown > 0
    ) {
      return false;
    }

    if (this.speed < LAYBACK_MIN_SPEED) return false;

    // Layback is strictly a backside / heelside carve (steering left, leanAngle <= -0.22)
    // for a regular stance skater where the trailing RightHand drops down into the wall.
    if (this.leanAngle > -0.22) return false;

    const slopeMag = Math.hypot(this.currentSurface.slopeX, this.currentSurface.slopeZ);
    const hasTransition = slopeMag >= 0.08 || this.currentSurface.height >= 0.18;
    if (!hasTransition) return false;

    // When on a bank or transition, ensure the wall is ahead or to the heel-side (left)
    // so the back hand actually drops toward the concrete wall/face
    if (slopeMag >= 0.10) {
      const leftX = -Math.cos(this.heading);
      const leftZ = Math.sin(this.heading);
      const slopeLeft = this.currentSurface.slopeX * leftX + this.currentSurface.slopeZ * leftZ;
      if (this.gradeAlongHeading < -0.15 && slopeLeft < -0.05) {
        return false;
      }
    }

    return true;
  }

  /** Whether the skater is currently eligible to perform an FS Reverse 360. */
  public canPerformReverse(): boolean {
    if (
      !this.isGrounded ||
      this.isGrinding ||
      this.snapActive ||
      this.reverseActive ||
      this.bertSlideActive ||
      this.laybackActive ||
      this.slideTrickCooldown > 0
    ) {
      return false;
    }

    if (this.speed < REVERSE_MIN_SPEED) return false;
    return Math.abs(this.leanAngle) >= 0.14;
  }
}
