import * as THREE from 'three';
import { ParkSurface, SurfaceSample } from './ParkSurface';
import { t } from '../i18n/i18n';
import { getBoardById, getSelectedBoardId, SurfBoardSpec } from '../config/SurfBoards';

export interface InputState {
  steerLeft: boolean;
  steerRight: boolean;
  forwardPush: boolean;
  brake?: boolean;
  compressCrouch: boolean;
  jumpOllie: boolean;
  grindSlash: boolean;
  snapSlide: boolean; // V for Bert Slide
  snapTrick: boolean; // F for the surf-style SNAP at the top of a wall
  laybackTrick: boolean; // G for the Layback (hold while carving fast)
  reverseTrick: boolean; // B for the FS Reverse 360
  indyGrabTrick: boolean; // Space (while in air) or I for Indy Grab
  analogSteer?: number; // Optional analog steer [-1.0..1.0] for smooth mobile touch carving
  contextTrick?: boolean; // Optional smart 1-button surf trick (e.g. C)
}

/** Alias for Wave 2 / HUD input wiring */
export type SurfskateInput = InputState;

export type PumpType = 'rail' | 'wall' | 'none';
export type WallPumpCue = 'none' | 'compress' | 'extend';
export type ContextTrickKind = 'none' | 'snap' | 'bert' | 'layback' | 'reverse360';

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

export interface SkaterStats {
  flow: number;
  pump: number;
  agility: number;
}

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
const ROLLING_RESISTANCE = 0.30;
/** Aerodynamic drag coefficient (per metre). */
const AIR_DRAG = 0.014;
/** Hard speed cap (m/s, simulation speed). */
const MAX_SPEED = 9.5;
/** Speed given by the initial push-off from a standstill (~9.5 km/h). */
const PUSH_OFF_SPEED = 2.65;
/** Below this speed the skater counts as standing still (full kick-push allowed). */
const STANDSTILL_SPEED = 0.4;
/** Startup push-boost ceiling: extra pushes / holding push cap cleanly around ~3.0 m/s (~10.8 km/h). */
const PUSH_STARTUP_SPEED = 3.0;
/** Tangential push acceleration while holding forwardPush below PUSH_STARTUP_SPEED (m/s²). */
const PUSH_ACCEL = 2.6;
/** Grounded foot-brake deceleration (m/s²). */
const BRAKE_DECEL = 7.5;

// ---- Flat-ground pumping (Carver C7 / YOW Meraki rail-to-rail whip) ----
/** Below this interval (real seconds), frantic wiggling scrubs speed. */
const PUMP_MIN_INTERVAL = 0.16;
/** Valid half-cycle surfskate rail-switch rhythm window (~0.32s – 1.45s). */
const PUMP_WINDOW_MIN = 0.32;
const PUMP_WINDOW_MAX = 1.45;
/** Sweet spot of the rail-to-rail whip rhythm (~0.42s – 0.95s). */
const PUMP_PERFECT_MIN = 0.42;
const PUMP_PERFECT_MAX = 0.95;
/** Minimum meaningful rail lean (radians) built during the half-cycle before switching. */
const PUMP_MIN_LEAN = 0.26;
/** Minimum carve hold duration (real seconds) per half-cycle to prevent micro-wiggle speed spam. */
const PUMP_MIN_CARVE_TIME = 0.11;
/** Speed threshold (m/s) above which flat-ground pumping experiences diminishing returns (~15.8 km/h). */
const FLAT_PUMP_SOFT_START = 4.4;
/** Flat-ground rail-to-rail pumping tops out around ~18.5 km/h (5.15 m/s). */
const FLAT_PUMP_CAP = 5.15;
/** Bowl / transition pumping accelerates up to ~24 km/h (6.67 m/s). */
const MAX_PUMP_SPEED = 6.67;

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
const LAYBACK_MIN_SPEED = 3.0;
const LAYBACK_HOLD_TIME = 0.65;
const BERT_MIN_SPEED = 2.8;
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

  // Character stats (Lukas baseline 92/88/85 = 1.0x across all modifiers)
  private skaterStats: SkaterStats = { flow: 92, pump: 88, agility: 85 };

  // Selected surfskate board spec (The Spiral 32" = 1.0x baseline)
  private boardSpec: SurfBoardSpec = getBoardById(getSelectedBoardId());

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
  public sessionTimerPaused = false;
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
  public bailGraceTimer = 0;
  private readonly bailGraceDuration = 1.15;
  public bailImpactPos = new THREE.Vector3();
  public bailImpactHeading = 0;
  private bailRecoveryPos = new THREE.Vector3();
  private bailRecoveryHeading = 0;
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

  // Flat-ground & bowl-wall surfskate pump tracking
  private lastPumpDir = 0;
  private timeSincePumpSwitch = 99;
  private halfCyclePeakLean = 0;
  private halfCycleCarveTime = 0;
  private prevPushInput = false;
  /** 0..1 pulse that drives a visible body pump when a pump lands. */
  public pumpPulse = 0;
  /** Cumulative count of landed rhythm/wall pumps in the current session. */
  public pumpCount = 0;
  /** 0..1 surge magnitude on pump hit (decays smoothly to 0). */
  public lastPumpSurge = 0;
  /** Monotonic sequence counter incremented on every rail or wall pump hit. */
  public pumpEventSeq = 0;
  /** Type of the most recent pump hit ('rail' | 'wall' | 'none'). */
  public lastPumpType: PumpType = 'none';
  /** Bowl wall compress -> extend timing cue for HUD & pump release trigger. */
  public wallPumpCue: WallPumpCue = 'none';
  private prevWallPumpCue: WallPumpCue = 'none';
  private wallPumpCooldown = 0;

  // Smart 1-button context trick & rail-drift state
  public availableContextTrick: ContextTrickKind = 'none';
  private prevContextTrick = false;
  private contextStartedSlide = false;
  /** 0..1 edge-of-traction drift intensity during hard carves or active slides. */
  public railDriftIntensity = 0;
  /** True whenever an active slide/snap/reverse trick is running on the ground. */
  public isSlidingNow = false;

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
  private reverseSpinDir = 1;
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

  public setSkaterStats(stats: SkaterStats): void {
    this.skaterStats = { ...stats };
  }

  public setBoardSpec(board: SurfBoardSpec): void {
    this.boardSpec = board;
  }

  private get agilityScale(): number {
    return (
      THREE.MathUtils.clamp(1 + (this.skaterStats.agility - 85) * 0.008, 0.9, 1.12) *
      this.boardSpec.physics.carveScale
    );
  }

  private get pumpScale(): number {
    return (
      THREE.MathUtils.clamp(1 + (this.skaterStats.pump - 88) * 0.008, 0.88, 1.12) *
      this.boardSpec.physics.pumpScale
    );
  }

  private get flowScale(): number {
    return THREE.MathUtils.clamp(1 + (this.skaterStats.flow - 92) * 0.005, 0.92, 1.08);
  }

  private get boardSpeedScale(): number {
    return this.boardSpec.physics.speedScale;
  }

  private get boardPopScale(): number {
    return this.boardSpec.physics.popScale;
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
    const base = this.isSurfZoneActive ? MAX_SPEED * 1.08 : MAX_SPEED;
    return base * this.boardSpeedScale;
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
    this.resetMotionAndTrickState();
    this.compression = 0.15;
    this.isBailing = false;
    this.bailTimer = 0;
    this.bailGraceTimer = 0;
    this.bailImpactPos.copy(this.position);
    this.bailImpactHeading = this.heading;
    this.bailRecoveryPos.copy(this.position);
    this.bailRecoveryHeading = this.heading;
    this.lastPumpDir = 0;
    this.timeSincePumpSwitch = 99;
    this.halfCyclePeakLean = 0;
    this.halfCycleCarveTime = 0;
    this.pumpCount = 0;
    this.lastPumpSurge = 0;
    this.lastPumpType = 'none';
    this.wallPumpCue = 'none';
    this.prevWallPumpCue = 'none';
    this.wallPumpCooldown = 0;
    this.availableContextTrick = 'none';
    this.prevContextTrick = false;
    this.contextStartedSlide = false;
    this.railDriftIntensity = 0;
    this.isSlidingNow = false;

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
  }

  public update(dt: number, input: InputState, onManeuver: (ev: ManeuverEvent) => void): void {
    const clampedDt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.033)) : 0;
    // Translational simulation step (gameplay runs at TIME_SCALE of real time)
    const simDt = clampedDt * TIME_SCALE;

    // While bailing: skater slides smoothly onto a safe flat concrete recovery spot
    if (this.isBailing) {
      this.bailTimer -= clampedDt;
      this.speed = 0;
      this.velocity.set(0, 0, 0);
      this.isGrounded = true;
      this.leanAngle = 0;
      this.leanRate = 0;
      this.frontTruckYaw = 0;
      this.rearTruckYaw = 0;
      this.boardYawOffset = 0;
      this.indyGrabActive = false;
      this.indyGrabAmount = 0;
      this.wallPumpCue = 'none';
      this.prevWallPumpCue = 'none';
      this.availableContextTrick = 'none';
      this.isSlidingNow = false;
      this.railDriftIntensity = 0;
      this.lastPumpSurge = 0;
      this.sprayIntensity = Math.max(0, this.sprayIntensity - clampedDt * 2.5);

      const p = 1.0 - Math.max(0, this.bailTimer / Math.max(0.01, this.bailDuration));
      const slideT = Math.min(1, p / 0.80);
      const slideEase = slideT * slideT * (3 - 2 * slideT);
      this.position.x = THREE.MathUtils.lerp(this.bailImpactPos.x, this.bailRecoveryPos.x, slideEase);
      this.position.z = THREE.MathUtils.lerp(this.bailImpactPos.z, this.bailRecoveryPos.z, slideEase);
      this.currentSurface = this.park.sample(this.position.x, this.position.z);
      this.position.y = this.currentSurface.height;

      const headingDiff = this.normalizeAngleDiff(this.bailRecoveryHeading - this.bailImpactHeading);
      this.heading = this.bailImpactHeading + headingDiff * slideEase;

      if (this.bailTimer <= 0) {
        // Re-evaluate safe flat ground & clear rollout heading at recovery completion
        const safe = this.computeSafeBailRecovery(this.bailRecoveryPos, this.bailRecoveryHeading);
        this.isBailing = false;
        this.bailTimer = 0;
        this.bailGraceTimer = this.bailGraceDuration;
        this.position.set(safe.pos.x, safe.surface.height, safe.pos.z);
        this.currentSurface = safe.surface;
        this.heading = safe.heading;
        this.resetMotionAndTrickState(input);
        this.pitchAngle = Math.atan(this.computeGradeAlongHeading()) * 0.72;
        this.compression = 0.15;
        this.ollieCooldown = 0.35;
        this.coachHint = t('ctrl.coachAligned');
        this.coachHintTimer = 2.5;
      }
      return;
    }

    if (this.bailGraceTimer > 0) {
      this.bailGraceTimer = Math.max(0, this.bailGraceTimer - clampedDt);
    }

    // -------------------------------------------------------------------------
    // Session Timer, Overtime & Endless Mode
    // -------------------------------------------------------------------------
    if (!this.endlessMode) {
      if (!this.sessionTimerPaused && this.sessionTimer > 0) {
        this.sessionTimer = Math.max(0, this.sessionTimer - clampedDt);
      }
      if (!this.sessionTimerPaused && this.sessionTimer <= 0) {
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
    if (this.wallPumpCooldown > 0) {
      this.wallPumpCooldown = Math.max(0, this.wallPumpCooldown - clampedDt);
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

    for (const key in this.maneuverCooldowns) {
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
    this.lastPumpSurge = Math.max(0, this.lastPumpSurge - clampedDt * 2.4);
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
      const responseRate = (rawSteer === 0 ? 36.0 : 32.0) * this.agilityScale;
      this.leanAngle += (targetLean - this.leanAngle) * Math.min(1, responseRate * clampedDt);
      if (rawSteer === 0 && Math.abs(this.leanAngle) < 0.008) {
        this.leanAngle = 0;
      }
      this.leanRate = (this.leanAngle - prevLean) / Math.max(0.001, clampedDt);

      // Track meaningful lean built during the active carve half-cycle for rail-to-rail pumping
      if (
        !this.isGrinding &&
        Math.abs(this.leanAngle) >= 0.18 &&
        (this.lastPumpDir === 0 || Math.sign(this.leanAngle) === this.lastPumpDir)
      ) {
        this.halfCyclePeakLean = Math.max(this.halfCyclePeakLean, Math.abs(this.leanAngle));
        this.halfCycleCarveTime += clampedDt;
      } else if (rawSteer === 0 && Math.abs(this.leanAngle) < 0.12) {
        this.halfCyclePeakLean = Math.max(0, this.halfCyclePeakLean - clampedDt * 0.55);
      }

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
      this.halfCyclePeakLean = 0;
      this.halfCycleCarveTime = 0;
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
    const isBraking = Boolean(input.brake);
    const isCrouching = input.compressCrouch;

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

    const targetCompression = isCrouching
      ? 0.92
      : this.bertSlideActive || this.snapActive || this.indyGrabActive
      ? 0.95
      : this.laybackActive
      ? 0.7
      : isBraking && this.speed > 0.15
      ? 0.48
      : autoWallCompression;
    const prevCompression = this.compression;
    this.compression += (targetCompression - this.compression) * Math.min(1, 11.5 * clampedDt);
    this.compressionVel = (this.compression - prevCompression) / Math.max(0.001, clampedDt);

    // -------------------------------------------------------------------------
    // 3. Coping Grind / Lip Slash Mode
    // -------------------------------------------------------------------------
    if (this.isGrinding) {
      this.wallPumpCue = 'none';
      this.prevWallPumpCue = 'none';
      this.availableContextTrick = 'none';
      this.isSlidingNow = false;
      this.railDriftIntensity = 0;
      this.prevContextTrick = Boolean(input.contextTrick);
      this.updateCopingGrind(simDt, input, onManeuver);
      return;
    }

    if (input.grindSlash && this.tryEnterCopingGrind(onManeuver)) {
      this.wallPumpCue = 'none';
      this.prevWallPumpCue = 'none';
      this.availableContextTrick = 'none';
      this.isSlidingNow = false;
      this.railDriftIntensity = 0;
      this.prevContextTrick = Boolean(input.contextTrick);
      return;
    }

    // -------------------------------------------------------------------------
    // 4. Grounded Surfskate Physics (energy-conserving)
    // -------------------------------------------------------------------------
    if (this.isGrounded) {
      const presetGain =
        this.truckPreset === 'smooth' ? 0.78 : this.truckPreset === 'balanced' ? 1.0 : 1.28;

      // ---- 4a. SNAP trick (F at the top of a wall) & Smart 1-Button Context Trick (C) ----
      this.updateSnapWindow(h0, grade, slopeMag);
      this.updateAvailableContextTrick(slopeMag);
      const contextPressed = Boolean(input.contextTrick) && !this.prevContextTrick;
      this.prevContextTrick = Boolean(input.contextTrick);

      const snapPressed = input.snapTrick && !this.prevSnapInput;
      this.prevSnapInput = input.snapTrick;
      if ((snapPressed || (contextPressed && this.availableContextTrick === 'snap')) && !this.snapActive) {
        const forceLipSnap = contextPressed && this.availableContextTrick === 'snap';
        this.attemptSnap(rawSteer, slopeX, slopeZ, onManeuver, forceLipSnap);
      }

      // ---- 4a2. Layback / Bert slide / FS Reverse 360 (dedicated keys + contextTrick) ----
      this.updateTricks(clampedDt, input, contextPressed, onManeuver);

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
        const baseTurnRate = 4.5 * presetGain * this.agilityScale;
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

      // ---- Slide & edge-of-traction drift state ----
      this.isSlidingNow =
        this.bertSlideActive || this.laybackActive || this.snapActive || this.reverseActive;
      if (this.bertSlideActive || this.laybackActive || this.snapActive) {
        this.railDriftIntensity = 1.0;
      } else {
        let targetDrift = 0;
        if (this.speed > 3.2 && Math.abs(this.leanAngle) > 0.48) {
          const leanFactor = THREE.MathUtils.clamp((Math.abs(this.leanAngle) - 0.48) / (0.68 - 0.48), 0, 1);
          const speedFactor = THREE.MathUtils.clamp((this.speed - 3.2) / 2.0, 0.38, 1);
          targetDrift = THREE.MathUtils.clamp(0.45 + 0.55 * leanFactor * speedFactor, 0, 1);
        }
        const driftRate = targetDrift > this.railDriftIntensity ? 7.5 : 6.0;
        this.railDriftIntensity = THREE.MathUtils.clamp(
          this.railDriftIntensity + (targetDrift - this.railDriftIntensity) * Math.min(1, driftRate * clampedDt),
          0,
          1
        );
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
      const effectiveRolling = ROLLING_RESISTANCE / this.boardSpeedScale;
      const highSpeedExcess = Math.max(0, this.speed - 4.8);
      const carveScrub =
        highSpeedExcess > 0
          ? (0.05 + 0.13 * Math.min(1, Math.abs(this.leanAngle) / 0.68)) * highSpeedExcess
          : 0;
      const totalDrag = effectiveRolling + AIR_DRAG * this.speed * this.speed + carveScrub;
      let aExtra = -totalDrag;
      if (isBraking) aExtra -= BRAKE_DECEL;
      if (this.bertSlideActive) aExtra -= 2.2;
      if (this.laybackActive) aExtra -= 1.8;
      if (this.reverseActive) aExtra -= 2.0;

      // ---- Push-off: snappy surfskate kick-start capped around ~3.15 m/s (~11.3 km/h), then pump! ----
      // Gate pushing by local slope/grade (not absolute elevation h0) so elevated flat
      // decks, street boxes, and bowl plateaus remain pushable while steep walls still require pumping.
      const canPush = slopeMag < 0.28 && grade < 0.18;
      const pushPressed = input.forwardPush && !this.prevPushInput;
      this.prevPushInput = input.forwardPush;
      const effectivePushOff = PUSH_OFF_SPEED * this.boardSpeedScale;
      const effectivePushStartup = PUSH_STARTUP_SPEED * this.boardSpeedScale;
      if (input.forwardPush && !isBraking) {
        if (canPush && this.speed < effectivePushStartup) {
          if (pushPressed) {
            if (this.speed < STANDSTILL_SPEED) {
              this.speed = effectivePushOff; // immediate punchy kick-push from standstill (~9.5 km/h)
            } else {
              this.speed = Math.min(effectivePushStartup, Math.max(effectivePushOff, this.speed + 0.75));
            }
            this.pumpPulse = Math.max(this.pumpPulse, 0.7);
            this.pumpSyncQuality = 'FLOW PUMP';
            this.pumpQualityTimer = 0.6;
            this.coachHint = t('ctrl.coachPumpNow');
            this.coachHintTimer = 3.0;
          }
          // Smooth startup acceleration capped cleanly at effectivePushStartup (~3.15 m/s)
          const maxAccelToCap = Math.max(
            0,
            (effectivePushStartup - this.speed) / Math.max(0.012, simDt) + totalDrag
          );
          aExtra += Math.min(PUSH_ACCEL * this.boardSpeedScale, maxAccelToCap);
        } else if (this.speed >= effectivePushStartup) {
          this.coachHint = t('ctrl.coachPumpCruise');
          this.coachHintTimer = 2.5;
        }
      }

      // ---- Flat-ground pumping: rail-to-rail Carver C7 / YOW Meraki whip ----
      if (!isBraking) {
        this.updateRhythmPump(rawSteer, onManeuver);
      }

      // ---- Bowl Wall Compress -> Extend Cue & Release Pump ----
      const fx = -Math.sin(this.heading);
      const fz = -Math.cos(this.heading);
      const aheadSample = this.park.sample(this.position.x + fx * 0.75, this.position.z + fz * 0.75);
      const aheadSlopeMag = Math.hypot(aheadSample.slopeX, aheadSample.slopeZ);
      const onSlopeTransition = slopeMag > 0.14 || h0 >= 0.22 || aheadSlopeMag > 0.14;
      const compressReleased = !isCrouching && this.prevCompressInput;

      if (
        !isBraking &&
        compressReleased &&
        (this.prevWallPumpCue === 'extend' || (this.compression > 0.45 && onSlopeTransition)) &&
        this.wallPumpCooldown <= 0 &&
        this.speed >= 1.1 &&
        !this.bertSlideActive &&
        !this.laybackActive &&
        !this.snapActive &&
        !this.reverseActive
      ) {
        const compressQuality = THREE.MathUtils.clamp((this.compression - 0.35) / 0.55, 0.55, 1.0);
        const normQuality = (compressQuality - 0.55) / 0.45;
        const wallSurge = THREE.MathUtils.lerp(0.68, 0.90, normQuality) * this.pumpScale;
        this.wallPumpCooldown = 1.05;
        this.perfectPumpCooldown = Math.max(this.perfectPumpCooldown, 1.2);
        this.wallPumpCue = 'none';
        this.prevWallPumpCue = 'none';
        this.triggerWallPumpBoost(
          wallSurge,
          0.8 + 0.2 * compressQuality,
          '⚡ WALL PUMP!',
          180,
          onManeuver
        );
      } else if (
        !isBraking &&
        this.wallPumpCooldown <= 0 &&
        this.speed >= 1.1 &&
        !this.bertSlideActive &&
        !this.laybackActive &&
        !this.snapActive &&
        !this.reverseActive
      ) {
        if (isCrouching && this.compression > 0.45 && onSlopeTransition) {
          this.wallPumpCue = 'extend';
        } else if (
          this.compression <= 0.45 &&
          ((slopeMag > 0.14 && grade >= -0.05) ||
            (aheadSlopeMag > 0.14 && aheadSample.height > h0 + 0.05))
        ) {
          this.wallPumpCue = 'compress';
        } else {
          this.wallPumpCue = 'none';
        }
        this.prevWallPumpCue = this.wallPumpCue;
      } else {
        this.wallPumpCue = 'none';
        this.prevWallPumpCue = 'none';
      }

      // ---- Wall pumping (like pumping a wave) ----
      // Going UP: the body stretches tall — barely any speed is lost to the stretch itself,
      // but gravity still slows you towards the apex (no free climbing!).
      if (!isBraking && isOnWall && sinT > 0.05) {
        aExtra += WALL_STRETCH_ASSIST * GRAVITY * sinT;
      }
      // Going DOWN: compress into the knees and drive the board down the face → speed!
      if (!isBraking && isOnWall && sinT < -0.05 && !this.bertSlideActive) {
        const active = isCrouching;
        aExtra +=
          (active ? WALL_PUMP_GAIN_ACTIVE : WALL_PUMP_GAIN) *
          this.pumpScale *
          GRAVITY *
          -sinT *
          (0.4 + 0.6 * this.compression);
        this.pumpSyncQuality = active ? 'PERFECT PUMP!' : 'FLOW PUMP';
        this.pumpQualityTimer = 0.4;
        this.flowMeter = Math.min(100, this.flowMeter + (active ? 16.0 : 12.0) * this.flowScale * clampedDt);

        // Perfect Pump in transitions:
        // When dropping down a wall (h0 > 0.35, sinT < -0.08) at the optimal moment
        const compressPressed = isCrouching && !this.prevCompressInput;
        const apexDropPump = isCrouching && (this.wasClimbingTransition || this.prevSinT >= -0.05) && sinT < -0.08;
        if (
          this.perfectPumpCooldown <= 0 &&
          h0 > 0.35 &&
          sinT < -0.08 &&
          (compressPressed || apexDropPump)
        ) {
          this.perfectPumpCooldown = 2.5;
          this.wallPumpCooldown = Math.max(this.wallPumpCooldown, 1.0);
          this.triggerWallPumpBoost(0.72 * this.pumpScale, 0.9, '⚡ PERFECT PUMP!', 150, onManeuver);
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
        this.wallPumpCue = 'none';
        this.prevWallPumpCue = 'none';
        this.availableContextTrick = 'none';
        this.isSlidingNow = false;
        this.railDriftIntensity = 0;
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
        const vy = (wallBase + compressionPop) * this.boardPopScale + rampLaunchBoost;

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
        const hitBounds = this.constrainToParkBounds(clampedDt);

        const h1 = this.park.evaluateHeight(this.position.x, this.position.z);
        const dh = h1 - h0;

        // v1² = v0² + 2·a_extra·s − 2·g·Δh   (exact energy balance → no free climbing)
        const v1Sq = v0 * v0 + 2 * aExtra * pathDist - 2 * GRAVITY * dh;

        if (v1Sq <= 0.0025 && (dh > 0 || isBraking)) {
          // Out of energy uphill, or braked cleanly to a stop
          if (dh > 0) {
            this.position.x = prevX;
            this.position.z = prevZ;
          }
          this.speed = 0;
        } else if (isBraking && vPred <= 0) {
          this.speed = 0;
        } else {
          this.speed = Math.min(this.maxSpeedLimit, Math.sqrt(Math.max(0, v1Sq)));
        }

        // Stall on a wall: at very low speed gravity pulls the nose down the fall line
        // (hold cleanly at 0 when foot-braking on flat or gentle slopes)
        if (
          !hitBounds &&
          slopeMag > 0.12 &&
          (!isBraking || slopeMag > 0.35) &&
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
      this.prevContextTrick = Boolean(input.contextTrick);
      this.snapWindow = 'NONE';
      this.wallPumpCue = 'none';
      this.prevWallPumpCue = 'none';
      this.availableContextTrick = 'none';
      this.isSlidingNow = false;
      this.railDriftIntensity = 0;
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
          bailReason = t('ctrl.bailGrab');
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
              bailReason = t('ctrl.bailBackwards');
            } else {
              bailReason = t('ctrl.bailNotAligned');
            }
          }
        }

        if (shouldBail && this.bailGraceTimer <= 0) {
          const travelHeading =
            horizSpeed >= 0.5 && Number.isFinite(tangentVel.x) && Number.isFinite(tangentVel.z)
              ? Math.atan2(-tangentVel.x, -tangentVel.z)
              : this.heading;
          this.triggerBail(bailReason, travelHeading, onManeuver);
          return;
        }

        if (this.bailGraceTimer <= 0 && this.indyGrabActive && !this.indyGrabScored) {
          this.trickFail('INDY GRAB: Let go before landing or get more air!');
        } else if (this.indyGrabScored) {
          this.flowMeter = Math.min(100, this.flowMeter + 15);
        }
        this.indyGrabActive = false;
        this.indyGrabAmount = 0;
        this.indyGrabReady = false;
        this.indyGrabHold = 0;
        this.indyGrabScored = false;
        this.airTime = 0;
        this.airRotation = 0;
        this.maxAirHeight = 0;
        this.airLaunchedFromWall = false;

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
      this.flowMeter = Math.max(0, this.flowMeter - (4.0 / this.flowScale) * clampedDt);
    }

    // Save previous inputs & slope for next frame
    this.prevCompressInput = isCrouching;
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
    const atLip = this.currentSurface.isNearCoping && h >= 0.55 && grade >= -0.25;
    if (!atLip && (h < 0.55 || slopeMag < 0.18 || grade < -0.25)) {
      this.snapWindow = 'NONE';
      return;
    }
    const top = this.estimateLocalWallTop();
    const inTopZone = atLip || h >= top * 0.6 || top - h < 0.5;
    if (!inTopZone) {
      this.snapWindow = 'NONE';
      return;
    }
    if (this.speed < SNAP_MIN_SPEED) this.snapWindow = 'TOO_SLOW';
    else if (this.speed > SNAP_MAX_SPEED) this.snapWindow = 'TOO_FAST';
    else this.snapWindow = 'READY';
  }

  /** Compute the contextual 1-button surf trick currently available while grounded. */
  private updateAvailableContextTrick(slopeMag: number): void {
    if (
      !this.isGrounded ||
      this.isGrinding ||
      this.isBailing ||
      this.snapActive ||
      this.bertSlideActive ||
      this.laybackActive ||
      this.reverseActive
    ) {
      this.availableContextTrick = 'none';
      return;
    }

    const nearLipForSnap =
      this.snapWindow === 'READY' ||
      (this.currentSurface.isNearCoping &&
        this.gradeAlongHeading >= -0.25 &&
        this.speed >= SNAP_MIN_SPEED &&
        this.speed <= SNAP_MAX_SPEED);
    if (nearLipForSnap) {
      this.availableContextTrick = 'snap';
      return;
    }

    if (this.slideTrickCooldown > 0) {
      this.availableContextTrick = 'none';
      return;
    }

    const lean = this.leanAngle;
    if (lean >= 0.14) {
      // Frontside carve: high-speed whip / flat blast -> Reverse 360; otherwise Bert Slide
      if (
        this.speed >= 5.2 &&
        (slopeMag < 0.24 || Math.abs(this.leanRate) > 1.2 || this.lastPumpSurge > 0.25)
      ) {
        this.availableContextTrick = 'reverse360';
      } else if (this.speed >= 2.8) {
        this.availableContextTrick = 'bert';
      } else {
        this.availableContextTrick = 'none';
      }
      return;
    }

    if (lean <= -0.14) {
      // Backside carve: bias toward Layback at >= 3.0 m/s, Bert Slide down to 2.8 m/s
      if (this.speed >= 3.0) {
        this.availableContextTrick = 'layback';
      } else if (this.speed >= 2.8) {
        this.availableContextTrick = 'bert';
      } else {
        this.availableContextTrick = 'none';
      }
      return;
    }

    this.availableContextTrick = 'none';
  }

  private attemptSnap(
    rawSteer: number,
    slopeX: number,
    slopeZ: number,
    onManeuver: (ev: ManeuverEvent) => void,
    forceLipSnap = false
  ): void {
    if (!forceLipSnap) {
      if (this.snapWindow === 'NONE') {
        this.snapFeedback = t('ctrl.snapTopOfWall');
        this.snapFeedbackTimer = 1.1;
        return;
      }
      if (this.snapWindow === 'TOO_SLOW') {
        // Bogged the snap: lose the little speed that was left
        this.snapFeedback = t('ctrl.snapFeedbackSlow');
        this.snapFeedbackTimer = 1.1;
        this.speed *= 0.5;
        return;
      }
      if (this.snapWindow === 'TOO_FAST') {
        this.snapFeedback = t('ctrl.snapFeedbackFast');
        this.snapFeedbackTimer = 1.1;
        this.speed *= 0.85;
        return;
      }
    }

    // Successful SNAP: whip the board back down the face of the wall
    const hasSlope = Math.hypot(slopeX, slopeZ) >= 0.05;
    const downhillHeading = hasSlope ? Math.atan2(slopeX, slopeZ) : this.heading + Math.PI;
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

  /** Apply a juicy bowl-wall pump speed surge (with diminishing returns near MAX_PUMP_SPEED) and update HUD/audio event signals. */
  private triggerWallPumpBoost(
    surge: number,
    surgeStrength: number,
    label: string,
    points: number,
    onManeuver: (ev: ManeuverEvent) => void
  ): void {
    const pumpCap = MAX_PUMP_SPEED * this.boardSpeedScale;
    const taperStart = 5.0 * this.boardSpeedScale;
    const highSpeedTaper = THREE.MathUtils.clamp(
      1 - (Math.max(0, this.speed - taperStart) / Math.max(0.5, pumpCap - taperStart)) * 0.65,
      0.35,
      1.0
    );
    if (this.speed < pumpCap) {
      this.speed = Math.min(this.maxSpeedLimit, Math.min(pumpCap, this.speed + surge * highSpeedTaper));
    }
    this.flowMeter = Math.min(100, this.flowMeter + 12 * this.flowScale);
    this.perfectPumpFlashTimer = 0.45;
    this.pumpSyncQuality = 'PERFECT PUMP!';
    this.pumpQualityTimer = 0.85;
    this.pumpPulse = 1.0;
    this.pumpCount += 1;
    this.lastPumpSurge = THREE.MathUtils.clamp(surgeStrength, 0.6, 1.0);
    this.pumpEventSeq += 1;
    this.lastPumpType = 'wall';
    onManeuver({
      name: label,
      points: this.applyScoreMultipliers(points),
      zone: this.currentSurface.zoneName,
      quality: 'PERFECT',
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
   * Flat-ground pumping (Carver C7 / YOW Meraki rail-to-rail whip).
   * Switching rails at ~0.32s - 1.45s after building meaningful lean delivers a
   * realistic forward speed surge right at the rail-switch apex (topping out around ~20 km/h on flat).
   */
  private updateRhythmPump(rawSteer: number, _onManeuver: (ev: ManeuverEvent) => void): void {
    // Only detect a pump switch when steering direction actually reverses between Left and Right.
    // Require a clear steer intention (|rawSteer| >= 0.20) so analog stick wiggles don't falsely scrub speed.
    if (Math.abs(rawSteer) < 0.20) return;
    const currentDir = rawSteer > 0 ? 1 : -1;
    if (currentDir === this.lastPumpDir) return;

    const interval = this.timeSincePumpSwitch;
    const firstSwitch = this.lastPumpDir === 0;
    const prevPeakLean = this.halfCyclePeakLean;
    const prevCarveTime = this.halfCycleCarveTime;
    this.lastPumpDir = currentDir;
    this.timeSincePumpSwitch = 0;
    this.halfCyclePeakLean = Math.abs(this.leanAngle);
    this.halfCycleCarveTime = 0;
    if (firstSwitch) return;

    if (this.speed < STANDSTILL_SPEED) {
      this.coachHint = t('ctrl.coachTooSlowPush');
      this.coachHintTimer = 2.0;
      return;
    }
    // Pumping only works while the wheels are on the ground and not mid-trick
    if (this.bertSlideActive || this.reverseActive || this.snapActive || this.laybackActive) return;

    if (interval < PUMP_MIN_INTERVAL) {
      // Wiggling hectically just scrubs speed
      this.speed = Math.max(0, this.speed - 0.08);
      this.pumpSyncQuality = 'SCRUB';
      this.pumpQualityTimer = 0.6;
      this.coachHint = t('ctrl.coachTooHectic');
      this.coachHintTimer = 1.6;
      return;
    }

    if (interval > PUMP_WINDOW_MAX) {
      // Too lazy: just a carve, no pump
      if (this.speed < 2.0) {
        this.coachHint = t('ctrl.coachFasterRhythm');
        this.coachHintTimer = 1.8;
      }
      return;
    }

    const hasMeaningfulLean = prevPeakLean >= PUMP_MIN_LEAN && prevCarveTime >= PUMP_MIN_CARVE_TIME;
    if (!hasMeaningfulLean) {
      return;
    }

    const flatPumpCap = FLAT_PUMP_CAP * this.boardSpeedScale;
    const flatSoftStart = FLAT_PUMP_SOFT_START * this.boardSpeedScale;
    const highSpeedTaper = THREE.MathUtils.clamp(
      1 - (Math.max(0, this.speed - flatSoftStart) / Math.max(0.4, flatPumpCap - flatSoftStart)) * 0.50,
      0.50,
      1.0
    );

    if (interval < PUMP_WINDOW_MIN) {
      // Slightly rushed switch: slight glide without full pump surge / whoosh spam
      if (this.speed < flatPumpCap) {
        this.speed = Math.min(
          this.maxSpeedLimit,
          Math.min(flatPumpCap, this.speed + 0.09 * this.pumpScale * highSpeedTaper)
        );
      }
      this.pumpPulse = Math.max(this.pumpPulse, 0.35);
      return;
    }

    const isPerfect = interval >= PUMP_PERFECT_MIN && interval <= PUMP_PERFECT_MAX;
    let rhythmQuality: number;
    if (isPerfect) {
      const centerDist = Math.abs(interval - 0.68) / 0.27;
      rhythmQuality = 1.0 - 0.18 * Math.min(1, centerDist);
    } else if (interval < PUMP_PERFECT_MIN) {
      rhythmQuality =
        0.55 + 0.25 * ((interval - PUMP_WINDOW_MIN) / Math.max(0.01, PUMP_PERFECT_MIN - PUMP_WINDOW_MIN));
    } else {
      rhythmQuality =
        0.80 - 0.35 * ((interval - PUMP_PERFECT_MAX) / Math.max(0.01, PUMP_WINDOW_MAX - PUMP_PERFECT_MAX));
    }

    const leanQuality = THREE.MathUtils.clamp((prevPeakLean - 0.24) / (0.65 - 0.24), 0.25, 1.0);
    const combinedQuality = THREE.MathUtils.clamp(rhythmQuality * (0.65 + 0.35 * leanQuality), 0, 1);

    const rawSurge = THREE.MathUtils.lerp(0.25, 0.50, combinedQuality) * this.pumpScale;

    if (this.speed < flatPumpCap) {
      this.speed = Math.min(
        this.maxSpeedLimit,
        Math.min(flatPumpCap, this.speed + rawSurge * highSpeedTaper)
      );
    }

    this.pumpSyncQuality = isPerfect ? 'PERFECT PUMP!' : 'FLOW PUMP';
    this.pumpQualityTimer = isPerfect ? 0.75 : 0.6;
    this.pumpPulse = isPerfect ? 1.0 : 0.75;
    this.pumpCount += 1;
    this.lastPumpSurge = THREE.MathUtils.clamp(0.60 + 0.40 * combinedQuality, 0.6, 1.0);
    this.pumpEventSeq += 1;
    this.lastPumpType = 'rail';
    this.flowMeter = Math.min(100, this.flowMeter + (isPerfect ? 5.5 : 3.0) * this.flowScale);
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
    this.contextStartedSlide = false;
  }

  /** Wrap an angle difference into [-PI, PI]. */
  private normalizeAngleDiff(diff: number): number {
    let wrapped = diff;
    while (wrapped > Math.PI) wrapped -= Math.PI * 2;
    while (wrapped < -Math.PI) wrapped += Math.PI * 2;
    return wrapped;
  }

  /**
   * Reset all air, ollie, grab, slide, trick, lean, steering, and velocity state
   * so recovery / spawn starts cleanly on the concrete.
   */
  private resetMotionAndTrickState(input?: InputState): void {
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.isGrounded = true;
    this.isGrinding = false;
    this.activeCopingName = '';

    this.airTime = 0;
    this.airRotation = 0;
    this.maxAirHeight = 0;
    this.airLaunchedFromWall = false;
    this.airLaunchHeight = 0;
    this.airLaunchSpeed = 0;
    this.postJumpFlatTimer = 0;

    this.leanAngle = 0;
    this.leanRate = 0;
    this.frontTruckYaw = 0;
    this.rearTruckYaw = 0;
    this.pitchAngle = 0;
    this.steerHoldTime = 0;
    this.lastSteerDir = 0;
    this.smoothedYawRate = 0;
    this.upperBodyLeadYaw = 0;
    this.compressionVel = 0;

    this.snapActive = false;
    this.snapTimer = 0;
    this.snapTurnRate = 0;
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
    this.reverseTimer = 0;
    this.boardYawOffset = 0;

    this.indyGrabActive = false;
    this.indyGrabAmount = 0;
    this.indyGrabReady = false;
    this.indyGrabHold = 0;
    this.indyGrabScored = false;

    this.prevPushInput = false;
    this.prevIndyInput = input ? input.indyGrabTrick : false;
    this.prevSnapInput = input ? input.snapTrick : false;
    this.prevLaybackInput = input ? input.laybackTrick : false;
    this.prevBertInput = input ? input.snapSlide : false;
    this.prevReverseInput = input ? input.reverseTrick : false;
    this.prevContextTrick = input ? Boolean(input.contextTrick) : false;
    this.contextStartedSlide = false;
    this.availableContextTrick = 'none';
    this.wallPumpCue = 'none';
    this.prevWallPumpCue = 'none';
    this.lastPumpSurge = 0;
    this.railDriftIntensity = 0;
    this.isSlidingNow = false;
    this.halfCyclePeakLean = 0;
    this.halfCycleCarveTime = 0;
  }

  /** Return true if (x, z) lies comfortably inside the active park's recovery bounds. */
  private isInsideRecoveryBounds(x: number, z: number, margin: number): boolean {
    const bounds = this.park.getBounds();
    if (this.park.getParkId() === 'im_gefilde') {
      const ang = 0.488;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const dx = x - 2.5;
      const dz = z - 1.0;
      const lx = dx * ca + dz * sa;
      const lz = -dx * sa + dz * ca;
      const rx = Math.max(5, 33.5 - margin);
      const rz = Math.max(5, 24.5 - margin);
      if (Math.hypot(lx / rx, lz / rz) > 1.0) return false;
      if (bounds) {
        return (
          x >= bounds.xMin + margin &&
          x <= bounds.xMax - margin &&
          z >= bounds.zMin + margin &&
          z <= bounds.zMax - margin
        );
      }
      return true;
    }
    if (!bounds) return true;
    return (
      x >= bounds.xMin + margin &&
      x <= bounds.xMax - margin &&
      z >= bounds.zMin + margin &&
      z <= bounds.zMax - margin
    );
  }

  /**
   * Ensure Im Gefilde recovery candidates stay inside the skateable concrete bowl
   * rather than on outside grass/berms or behind-wall trenches.
   */
  private isInsideParkBasin(x: number, z: number): boolean {
    if (this.park.getParkId() !== 'im_gefilde') return true;
    const ang = 0.488;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const dx = x - 3.0;
    const dz = z - 1.5;
    const lx = dx * ca + dz * sa;
    const lz = -dx * sa + dz * ca;
    if (Math.hypot(lx / 23.5, lz / 15.8) > 1.0) return false;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      if (this.park.evaluateHeight(x + (3.0 - x) * t, z + (1.5 - z) * t) > 1.35) {
        return false;
      }
    }
    return true;
  }

  /** Score a candidate rollout heading: penalize uphill grades, walls, coping, and bounds. */
  private scoreForwardRolloutHeading(
    x: number,
    z: number,
    h0: number,
    heading: number
  ): number {
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const e = 0.3;
    const hAhead = this.park.evaluateHeight(x + fx * e, z + fz * e);
    const hBehind = this.park.evaluateHeight(x - fx * e, z - fz * e);
    const grade = Math.max(-4, Math.min(4, (hAhead - hBehind) / (2 * e)));
    if (grade > 0.16) return -1e6;

    let penalty = Math.max(0, grade) * 20;
    for (const dist of [0.8, 1.6, 2.5, 3.5]) {
      const px = x + fx * dist;
      const pz = z + fz * dist;
      if (!this.isInsideRecoveryBounds(px, pz, 1.4)) return -1e5 + dist;
      const ps = this.park.sample(px, pz);
      const slopeMag = Math.hypot(ps.slopeX, ps.slopeZ);
      if (ps.height - h0 > 0.40 || slopeMag > 0.55 || ps.isNearCoping) {
        penalty += (4.0 - dist) * 50 + Math.max(0, ps.height - h0) * 30;
      }
      if (!this.isInsideParkBasin(px, pz)) {
        penalty += 100;
      }
    }
    return -penalty - Math.abs(grade) * 2;
  }

  /** Choose a clear rollout heading away from walls/bounds, keeping flow direction when safe. */
  private pickSafeRolloutHeading(
    x: number,
    z: number,
    surface: SurfaceSample,
    preferredHeading: number
  ): { heading: number; score: number } {
    const baseScore = this.scoreForwardRolloutHeading(x, z, surface.height, preferredHeading);
    if (baseScore > -15) {
      return { heading: preferredHeading, score: baseScore };
    }

    const isImGefilde = this.park.getParkId() === 'im_gefilde';
    const centerX = isImGefilde ? 3.0 : 0.0;
    const centerZ = isImGefilde ? 1.5 : 0.0;
    const inwardHeading = Math.atan2(-(centerX - x), -(centerZ - z));

    const candidates: number[] = [preferredHeading, inwardHeading];
    if (Math.hypot(surface.slopeX, surface.slopeZ) > 0.05) {
      candidates.push(Math.atan2(surface.slopeX, surface.slopeZ));
    }
    for (let i = 0; i < 16; i++) {
      candidates.push((i / 16) * Math.PI * 2 - Math.PI);
    }

    let bestHeading = inwardHeading;
    let bestScore = -Infinity;
    for (const cand of candidates) {
      const diff = Math.abs(this.normalizeAngleDiff(cand - preferredHeading));
      const sc = this.scoreForwardRolloutHeading(x, z, surface.height, cand) - diff * 0.5;
      if (sc > bestScore) {
        bestScore = sc;
        bestHeading = cand;
      }
    }
    return { heading: bestHeading, score: bestScore };
  }

  /** Return true if (x, z) is a safe, flat, unobstructed concrete recovery spot. */
  private isSafeRecoverySpot(
    x: number,
    z: number,
    maxSlope: number,
    requireClearRollout: boolean
  ): SurfaceSample | null {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    if (!this.isInsideRecoveryBounds(x, z, 2.0)) return null;

    const s = this.park.sample(x, z);
    if (!Number.isFinite(s.height)) return null;

    const slopeMag = Math.hypot(s.slopeX, s.slopeZ);
    if (slopeMag > maxSlope || s.isNearCoping) return null;

    const maxH = this.park.getParkId() === 'im_gefilde' ? 1.35 : 1.1;
    if (s.height > maxH || !this.isInsideParkBasin(x, z)) return null;

    // Reject narrow knife-edge ridges or steep drops right next to the landing spot
    for (const [ox, oz] of [
      [0.7, 0],
      [-0.7, 0],
      [0, 0.7],
      [0, -0.7],
    ]) {
      if (Math.abs(this.park.evaluateHeight(x + ox, z + oz) - s.height) > 0.42) {
        return null;
      }
    }

    if (requireClearRollout) {
      const { score } = this.pickSafeRolloutHeading(x, z, s, 0);
      if (score <= -20) return null;
    }

    return s;
  }

  /**
   * Evaluate the recovery point and, if on a steep slope (> 0.25), coping/wall, or
   * near/outside park bounds, find the nearest safe flat concrete spot and align
   * heading toward an unobstructed rollout direction.
   */
  private computeSafeBailRecovery(
    impactPos: THREE.Vector3,
    impactHeading: number
  ): { pos: THREE.Vector3; surface: SurfaceSample; heading: number } {
    const rawX = Number.isFinite(impactPos.x) ? impactPos.x : this.spawnX;
    const rawZ = Number.isFinite(impactPos.z) ? impactPos.z : this.spawnZ;
    const rawHeading = Number.isFinite(impactHeading)
      ? impactHeading
      : Number.isFinite(this.heading)
      ? this.heading
      : this.spawnHeading;

    const directSurface = this.isSafeRecoverySpot(rawX, rawZ, 0.25, true);
    if (directSurface) {
      const { heading } = this.pickSafeRolloutHeading(rawX, rawZ, directSurface, rawHeading);
      return {
        pos: new THREE.Vector3(rawX, directSurface.height, rawZ),
        surface: directSurface,
        heading,
      };
    }

    // If impact was outside/far past perimeter, start search from nearest in-bounds anchor
    let anchorX = rawX;
    let anchorZ = rawZ;
    if (!this.isInsideRecoveryBounds(anchorX, anchorZ, 1.5)) {
      const centerX = this.park.getParkId() === 'im_gefilde' ? 3.0 : 0.0;
      const centerZ = this.park.getParkId() === 'im_gefilde' ? 1.5 : 0.0;
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const tx = THREE.MathUtils.lerp(rawX, centerX, t);
        const tz = THREE.MathUtils.lerp(rawZ, centerZ, t);
        if (this.isInsideRecoveryBounds(tx, tz, 2.0)) {
          anchorX = tx;
          anchorZ = tz;
          break;
        }
      }
    }

    const impactSample = this.park.sample(anchorX, anchorZ);
    const downhillX = -impactSample.slopeX;
    const downhillZ = -impactSample.slopeZ;
    const downhillLen = Math.hypot(downhillX, downhillZ);

    let bestPos: THREE.Vector3 | null = null;
    let bestSurface: SurfaceSample | null = null;
    let bestCost = Infinity;

    for (const r of [0.8, 1.6, 2.5, 3.6, 5.0, 6.8, 9.0, 12.0, 16.0, 21.0, 26.0]) {
      const steps = r <= 3 ? 12 : 20;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const dirX = Math.cos(a);
        const dirZ = Math.sin(a);
        const cx = anchorX + dirX * r;
        const cz = anchorZ + dirZ * r;
        const cs = this.isSafeRecoverySpot(cx, cz, 0.22, true);
        if (!cs) continue;

        const slopeMag = Math.hypot(cs.slopeX, cs.slopeZ);
        const downBias =
          downhillLen > 0.05 ? -0.35 * ((dirX * downhillX + dirZ * downhillZ) / downhillLen) : 0;
        const cost = r + slopeMag * 4.0 + Math.max(0, cs.height) * 0.5 + downBias;
        if (cost < bestCost) {
          bestCost = cost;
          bestPos = new THREE.Vector3(cx, cs.height, cz);
          bestSurface = cs;
        }
      }
      if (bestPos) break;
    }

    if (!bestPos || !bestSurface) {
      for (const r of [2.0, 5.0, 9.0, 14.0, 20.0, 26.0]) {
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          const cx = anchorX + Math.cos(a) * r;
          const cz = anchorZ + Math.sin(a) * r;
          const cs = this.isSafeRecoverySpot(cx, cz, 0.25, false);
          if (cs) {
            bestPos = new THREE.Vector3(cx, cs.height, cz);
            bestSurface = cs;
            break;
          }
        }
        if (bestPos) break;
      }
    }

    if (!bestPos || !bestSurface) {
      const spawnSurf = this.park.sample(this.spawnX, this.spawnZ);
      bestPos = new THREE.Vector3(this.spawnX, spawnSurf.height, this.spawnZ);
      bestSurface = spawnSurf;
    }

    const { heading } = this.pickSafeRolloutHeading(bestPos.x, bestPos.z, bestSurface, rawHeading);
    return { pos: bestPos, surface: bestSurface, heading };
  }

  public triggerBail(
    reason: string,
    travelHeading: number,
    onManeuver?: (ev: ManeuverEvent) => void
  ): void {
    const safeImpactX = Number.isFinite(this.position.x) ? this.position.x : this.spawnX;
    const safeImpactZ = Number.isFinite(this.position.z) ? this.position.z : this.spawnZ;
    this.position.x = safeImpactX;
    this.position.z = safeImpactZ;
    this.currentSurface = this.park.sample(safeImpactX, safeImpactZ);
    this.position.y = this.currentSurface.height;

    const safeTravelHeading = Number.isFinite(travelHeading)
      ? travelHeading
      : Number.isFinite(this.heading)
      ? this.heading
      : this.spawnHeading;

    const recovery = this.computeSafeBailRecovery(this.position, safeTravelHeading);

    this.isBailing = true;
    this.bailTimer = this.bailDuration;
    this.bailReason = reason;
    this.bailImpactPos.copy(this.position);
    this.bailImpactHeading = safeTravelHeading;
    this.bailRecoveryPos.copy(recovery.pos);
    this.bailRecoveryHeading = recovery.heading;

    this.resetMotionAndTrickState();
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

  /** Layback, Bert slide and FS Reverse 360 (dedicated keys + smart contextTrick). */
  private updateTricks(
    dt: number,
    input: InputState,
    contextPressed: boolean,
    onManeuver: (ev: ManeuverEvent) => void
  ): void {
    if (
      contextPressed &&
      !this.snapActive &&
      !this.reverseActive &&
      !this.bertSlideActive &&
      !this.laybackActive
    ) {
      if (this.availableContextTrick === 'reverse360') {
        this.reverseActive = true;
        this.reverseTimer = 0;
        this.reverseSpinDir = Math.sign(this.leanAngle) || 1;
        this.laybackActive = false;
        this.bertSlideActive = false;
        this.contextStartedSlide = false;
      } else if (this.availableContextTrick === 'bert') {
        this.bertSlideActive = true;
        this.bertHold = 0;
        this.bertScored = false;
        this.bertSlideAccumulatedYaw = 0;
        this.bertSlideHandSide = Math.sign(this.leanAngle) || 1;
        this.laybackActive = false;
        this.contextStartedSlide = true;
        this.bertKeyReleased = false;
      } else if (this.availableContextTrick === 'layback') {
        this.laybackActive = true;
        this.laybackHold = 0;
        this.laybackScored = false;
        this.laybackAccumulatedYaw = 0;
        this.contextStartedSlide = true;
        this.laybackKeyReleased = false;
      } else if (this.availableContextTrick === 'none') {
        if (this.slideTrickCooldown > 0) {
          this.trickFail('SURF TRICK: reset line before next slide!');
        } else if (this.speed < BERT_MIN_SPEED) {
          this.trickFail(`SURF TRICK: pump faster (${BERT_MIN_SPEED.toFixed(1)}+ m/s) or approach a wall lip!`);
        } else {
          this.trickFail('SURF TRICK: carve (← or →) or hit a wall lip, then press [C]!');
        }
      }
    }

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
        this.reverseSpinDir = Math.sign(this.leanAngle) || 1;
        this.laybackActive = false;
        this.bertSlideActive = false;
        this.contextStartedSlide = false;
      }
    }
    if (this.reverseActive) {
      this.reverseTimer += dt;
      // Keep speed fluid: never stall mid-trick
      this.speed = Math.max(2.4, this.speed);
      const t = Math.min(1, this.reverseTimer / REVERSE_DURATION);
      // Ease-in-out spin; rotation follows carve direction
      const spinDir = this.reverseSpinDir || Math.sign(this.leanAngle) || 1;
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

    if (!input.snapSlide && !input.contextTrick) {
      this.bertKeyReleased = true;
    }

    const bertHoldActive = input.snapSlide || (this.bertSlideActive && this.contextStartedSlide);
    if (bertHoldActive && !this.laybackActive) {
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
          this.contextStartedSlide = false;
          this.bertKeyReleased = false;
        }
      }
    } else {
      if (this.bertSlideActive) {
        this.slideTrickCooldown = 1.5;
        this.contextStartedSlide = false;
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
        this.contextStartedSlide = false;
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

    if (!input.laybackTrick && !input.contextTrick) {
      this.laybackKeyReleased = true;
    }

    const laybackHoldActive = input.laybackTrick || (this.laybackActive && this.contextStartedSlide);
    if (laybackHoldActive && !this.bertSlideActive) {
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
          this.contextStartedSlide = false;
          this.laybackKeyReleased = false;
        }
      }
    } else {
      if (this.laybackActive) {
        this.slideTrickCooldown = 1.5;
        this.contextStartedSlide = false;
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

      if (!this.contextStartedSlide && this.leanAngle > -0.15) {
        // Skater stopped carving backside
        this.laybackActive = false;
        this.slideTrickCooldown = 1.5;
        if (!this.laybackScored) this.trickFail('LAYBACK: keep carving backside (←)!');
      } else if (this.laybackAccumulatedYaw >= 3.05 || this.laybackHold >= 0.85) {
        // Turn completed: maximum 180° rotation (no doughnuts!) or hold limit reached
        this.laybackActive = false;
        this.contextStartedSlide = false;
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
        this.velocity.set(-Math.sin(this.heading) * this.speed, 3.4 * this.boardPopScale, -Math.cos(this.heading) * this.speed);
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

  private constrainToParkBounds(dt = 0.016): boolean {
    if (this.park.getParkId() !== 'im_gefilde') {
      const bounds = this.park.getBounds();
      if (bounds) {
        const margin = 0.9;
        const minX = bounds.xMin + margin;
        const maxX = bounds.xMax - margin;
        const minZ = bounds.zMin + margin;
        const maxZ = bounds.zMax - margin;
        let hit = false;
        if (this.position.x < minX) {
          this.position.x = minX;
          if (!this.isGrounded && this.velocity.x < 0) this.velocity.x = 0;
          hit = true;
        }
        if (this.position.x > maxX) {
          this.position.x = maxX;
          if (!this.isGrounded && this.velocity.x > 0) this.velocity.x = 0;
          hit = true;
        }
        if (this.position.z < minZ) {
          this.position.z = minZ;
          if (!this.isGrounded && this.velocity.z < 0) this.velocity.z = 0;
          hit = true;
        }
        if (this.position.z > maxZ) {
          this.position.z = maxZ;
          if (!this.isGrounded && this.velocity.z > 0) this.velocity.z = 0;
          hit = true;
        }
        if (hit) {
          const inwardAngle = Math.atan2(this.position.x, this.position.z);
          const diff = this.normalizeAngleDiff(inwardAngle - this.heading);
          this.heading += (Math.sign(diff) || 1) * Math.min(Math.abs(diff), 4.5 * dt);
          this.sprayIntensity = 1.0;
        }
        return hit;
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

      if (!this.isGrounded) {
        const outX = this.position.x - 2.5;
        const outZ = this.position.z - 1.0;
        const outLen = Math.hypot(outX, outZ);
        if (outLen > 0.001) {
          const nx = outX / outLen;
          const nz = outZ / outLen;
          const vOut = this.velocity.x * nx + this.velocity.z * nz;
          if (vOut > 0) {
            this.velocity.x -= vOut * nx;
            this.velocity.z -= vOut * nz;
          }
        }
      }

      const inwardAngle = Math.atan2(this.position.x - 2.5, this.position.z - 1.0);
      const diff = this.normalizeAngleDiff(inwardAngle - this.heading);

      const turnSign = Math.sign(diff) || 1;
      this.heading += turnSign * Math.min(Math.abs(diff), 4.5 * dt);
      this.sprayIntensity = 1.0;
      return true;
    }
    return false;
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
    if (!hasTransition && this.leanAngle > -0.28) return false;

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
