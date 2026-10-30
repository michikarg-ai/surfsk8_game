import { ManeuverEvent, SurfskateController, TruckFeelPreset } from '../physics/SurfskateController';
import { AspectMode, CameraStyle } from '../camera/SurfCamera';
import { AtmosphereMode } from '../world/ImGefildeScene';

export interface HUDCallbacks {
  onToggleAspect: () => void;
  onToggleAtmosphere: () => void;
  onCycleCamera: () => void;
  onCycleTruckFeel: () => void;
  onToggleAutoFlow: () => void;
  onResetSession: () => void;
}

export class SurfHUD {
  public totalScore = 0;
  public bestCombo = 0;
  public activeComboBase = 0;
  public comboMultiplier = 0;
  public comboManeuvers: string[] = [];
  public comboTimeout = 0;
  private readonly comboMaxHold = 4.2;

  public sessionTimeRemaining = 120.0; // 2-minute THPS session timer
  public sessionEnded = false;

  private scoreEl: HTMLElement;
  private bestComboEl: HTMLElement;
  private timerEl: HTMLElement;
  private zoneEl: HTMLElement;
  private speedEl: HTMLElement;
  private flowFillEl: HTMLElement;
  private flowPctEl: HTMLElement;
  private pumpBadgeEl: HTMLElement;
  private comboContainerEl: HTMLElement;
  private comboPointsEl: HTMLElement;
  private comboStringEl: HTMLElement;
  private comboTimerBarEl: HTMLElement;
  private truckDialFrontEl: HTMLElement;
  private leanReadoutEl: HTMLElement;

  private btnAspectEl: HTMLButtonElement;
  private btnAtmosphereEl: HTMLButtonElement;
  private btnCameraEl: HTMLButtonElement;
  private btnTruckFeelEl: HTMLButtonElement;
  private btnAutoFlowEl: HTMLButtonElement;

  // SNAP trick overlays
  private snapBannerEl: HTMLDivElement;
  private snapHintEl: HTMLDivElement;
  private coachHintEl: HTMLDivElement;
  private snapBannerTimeout: number | null = null;

  constructor(private callbacks: HUDCallbacks) {
    this.injectSnapStyles();
    const frame = document.getElementById('viewport-frame') ?? document.body;
    this.snapBannerEl = document.createElement('div');
    this.snapBannerEl.id = 'hud-snap-banner';
    frame.appendChild(this.snapBannerEl);
    this.snapHintEl = document.createElement('div');
    this.snapHintEl.id = 'hud-snap-hint';
    frame.appendChild(this.snapHintEl);
    this.coachHintEl = document.createElement('div');
    this.coachHintEl.id = 'hud-coach-hint';
    frame.appendChild(this.coachHintEl);
    this.scoreEl = document.getElementById('hud-score')!;
    this.bestComboEl = document.getElementById('hud-best-combo')!;
    this.timerEl = document.getElementById('hud-timer')!;
    this.zoneEl = document.getElementById('hud-zone')!;
    this.speedEl = document.getElementById('hud-speed')!;
    this.flowFillEl = document.getElementById('hud-flow-fill')!;
    this.flowPctEl = document.getElementById('hud-flow-pct')!;
    this.pumpBadgeEl = document.getElementById('hud-pump-badge')!;
    this.comboContainerEl = document.getElementById('hud-combo-box')!;
    this.comboPointsEl = document.getElementById('hud-combo-points')!;
    this.comboStringEl = document.getElementById('hud-combo-string')!;
    this.comboTimerBarEl = document.getElementById('hud-combo-bar')!;
    this.truckDialFrontEl = document.getElementById('hud-truck-front')!;
    this.leanReadoutEl = document.getElementById('hud-lean-deg')!;

    this.btnAspectEl = document.getElementById('btn-aspect') as HTMLButtonElement;
    this.btnAtmosphereEl = document.getElementById('btn-atmosphere') as HTMLButtonElement;
    this.btnCameraEl = document.getElementById('btn-camera') as HTMLButtonElement;
    this.btnTruckFeelEl = document.getElementById('btn-truckfeel') as HTMLButtonElement;
    this.btnAutoFlowEl = document.getElementById('btn-autoflow') as HTMLButtonElement;
    const btnResetEl = document.getElementById('btn-reset') as HTMLButtonElement;

    this.btnAspectEl.addEventListener('click', () => this.callbacks.onToggleAspect());
    this.btnAtmosphereEl.addEventListener('click', () => this.callbacks.onToggleAtmosphere());
    this.btnCameraEl.addEventListener('click', () => this.callbacks.onCycleCamera());
    this.btnTruckFeelEl.addEventListener('click', () => this.callbacks.onCycleTruckFeel());
    this.btnAutoFlowEl.addEventListener('click', () => this.callbacks.onToggleAutoFlow());
    btnResetEl.addEventListener('click', () => this.callbacks.onResetSession());
  }

  public onManeuver(ev: ManeuverEvent): void {
    if (this.sessionEnded) return;

    this.activeComboBase += ev.points;
    this.comboMultiplier += 1;
    this.comboManeuvers.push(ev.name);
    if (this.comboManeuvers.length > 6) {
      this.comboManeuvers.shift();
    }
    this.comboTimeout = this.comboMaxHold;

    this.comboContainerEl.classList.add('active');
    if (ev.isSpecial || ev.isSnap) {
      this.comboContainerEl.classList.add('special-flash');
      setTimeout(() => this.comboContainerEl.classList.remove('special-flash'), 800);
    }
    this.renderCombo();
  }

  public update(dt: number, ctrl: SurfskateController): void {
    // 1. Session Timer (2:00 countdown)
    if (!this.sessionEnded) {
      this.sessionTimeRemaining = Math.max(0, this.sessionTimeRemaining - dt);
      if (this.sessionTimeRemaining === 0) {
        this.bankCombo();
        this.sessionEnded = true;
      }
    }
    const mins = Math.floor(this.sessionTimeRemaining / 60);
    const secs = Math.floor(this.sessionTimeRemaining % 60);
    const tenths = Math.floor((this.sessionTimeRemaining % 1) * 10);
    this.timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
    if (this.sessionTimeRemaining < 15) {
      this.timerEl.classList.add('urgent');
    } else {
      this.timerEl.classList.remove('urgent');
    }

    // 2. Active Combo Timeout & Banking
    if (this.comboTimeout > 0) {
      // Keep combo alive slightly longer while actively carving or grinding
      const decayRate = ctrl.isGrinding || Math.abs(ctrl.leanAngle) > 0.25 ? 0.55 : 1.0;
      this.comboTimeout = Math.max(0, this.comboTimeout - dt * decayRate);
      const pct = (this.comboTimeout / this.comboMaxHold) * 100;
      this.comboTimerBarEl.style.width = `${pct}%`;

      if (this.comboTimeout === 0 && ctrl.isGrounded && !ctrl.isGrinding) {
        this.bankCombo();
      }
    }

    // 3. Speed, Zone, and Surf-Adapter Telemetry
    const kmh = Math.round(ctrl.speed * 3.6);
    this.speedEl.textContent = `${kmh} km/h`;
    this.zoneEl.textContent = ctrl.currentSurface.zoneName;

    const flowPct = Math.round(ctrl.flowMeter);
    this.flowFillEl.style.width = `${flowPct}%`;
    this.flowPctEl.textContent = `${flowPct}%`;
    this.flowFillEl.classList.toggle('special-ready', flowPct >= 99);

    // Pump rhythm feedback badge
    if (ctrl.pumpSyncQuality !== 'IDLE') {
      this.pumpBadgeEl.textContent = ctrl.pumpSyncQuality;
      this.pumpBadgeEl.className =
        'pump-badge ' +
        (ctrl.pumpSyncQuality === 'PERFECT PUMP!'
          ? 'perfect'
          : ctrl.pumpSyncQuality === 'FLOW PUMP'
          ? 'good'
          : 'scrub');
    } else {
      this.pumpBadgeEl.textContent = ctrl.isGrinding
        ? 'COPING SLASH GRIND!'
        : Math.abs(ctrl.leanAngle) > 0.25
        ? 'DEEP RAIL CARVE'
        : 'PUMP: ← → IN RHYTHM';
      this.pumpBadgeEl.className = 'pump-badge neutral';
    }

    // Dual-axis front surf-adapter visual indicator
    const yawDeg = Math.round((ctrl.frontTruckYaw * 180) / Math.PI);
    const leanDeg = Math.round((ctrl.leanAngle * 180) / Math.PI);
    this.truckDialFrontEl.style.transform = `rotate(${yawDeg}deg)`;
    this.leanReadoutEl.textContent = `Lean ${leanDeg > 0 ? '+' : ''}${leanDeg}° | Surf Truck ${yawDeg > 0 ? '+' : ''}${yawDeg}°`;

    // 4. SNAP hint / failure feedback
    if (ctrl.snapFeedback) {
      this.snapHintEl.textContent = ctrl.snapFeedback;
      this.snapHintEl.className = 'visible fail';
    } else if (ctrl.snapWindow === 'READY' && !ctrl.snapActive) {
      this.snapHintEl.textContent = 'SNAP READY — press Q';
      this.snapHintEl.className = 'visible ready';
    } else if (ctrl.snapWindow === 'TOO_SLOW') {
      this.snapHintEl.textContent = 'Too slow to snap';
      this.snapHintEl.className = 'visible dim';
    } else if (ctrl.snapWindow === 'TOO_FAST') {
      this.snapHintEl.textContent = 'Too fast to snap';
      this.snapHintEl.className = 'visible dim';
    } else {
      this.snapHintEl.className = '';
    }

    // 5. Coaching hints: push-off from standstill, then how to pump
    if (ctrl.coachHint) {
      this.coachHintEl.textContent = ctrl.coachHint;
      this.coachHintEl.className = 'visible';
    } else if (ctrl.isGrounded && ctrl.speed < 0.4) {
      this.coachHintEl.textContent = 'Press ↑ / W once to push off';
      this.coachHintEl.className = 'visible idle';
    } else {
      this.coachHintEl.className = '';
    }
  }

  /** Big animated trick name (SNAP!, LAYBACK!, BERTSLIDE!, FS REVERSE 360!). */
  public showTrickBanner(text: string, perfect: boolean): void {
    this.snapBannerEl.textContent = text;
    this.snapBannerEl.className = '';
    // Force reflow so the animation restarts on consecutive tricks
    void this.snapBannerEl.offsetWidth;
    const long = text.length > 10 ? ' long' : '';
    this.snapBannerEl.className = (perfect ? 'show perfect' : 'show') + long;
    if (this.snapBannerTimeout !== null) window.clearTimeout(this.snapBannerTimeout);
    this.snapBannerTimeout = window.setTimeout(() => {
      this.snapBannerEl.className = '';
      this.snapBannerTimeout = null;
    }, 1500);
  }

  /** Backwards-compatible wrapper for the SNAP banner. */
  public showSnapBanner(perfect: boolean): void {
    this.showTrickBanner(perfect ? 'PERFECT SNAP!' : 'SNAP!', perfect);
  }

  private injectSnapStyles(): void {
    if (document.getElementById('hud-snap-styles')) return;
    const style = document.createElement('style');
    style.id = 'hud-snap-styles';
    style.textContent = `
      #hud-snap-banner {
        position: absolute; left: 50%; top: 38%;
        transform: translate(-50%, -50%) scale(0.4) rotate(-6deg);
        font-family: 'Impact', 'Arial Black', system-ui, sans-serif;
        font-size: clamp(64px, 13vw, 180px); font-weight: 900; letter-spacing: 0.04em;
        color: #fff; opacity: 0; pointer-events: none; z-index: 60; white-space: nowrap;
        -webkit-text-stroke: 4px #0a1a2e;
        text-shadow: 0 0 18px rgba(0, 230, 255, 0.9), 0 0 48px rgba(0, 180, 255, 0.6), 6px 8px 0 #ff2d75;
      }
      #hud-snap-banner.perfect {
        color: #fff36b;
        text-shadow: 0 0 22px rgba(255, 240, 80, 0.95), 0 0 60px rgba(255, 170, 0, 0.7), 6px 8px 0 #ff2d75;
      }
      #hud-snap-banner.show { animation: snapPop 1.45s cubic-bezier(0.2, 1.4, 0.4, 1) forwards; }
      #hud-snap-banner.long { font-size: clamp(44px, 8.5vw, 130px); }
      #hud-coach-hint {
        position: absolute; left: 50%; top: 16%; transform: translateX(-50%);
        max-width: 80%; text-align: center;
        padding: 10px 22px; border-radius: 14px; font: 700 17px system-ui, sans-serif;
        letter-spacing: 0.03em; pointer-events: none; z-index: 56;
        background: rgba(255, 196, 0, 0.94); color: #1d1400;
        box-shadow: 0 0 22px rgba(255, 196, 0, 0.55);
        opacity: 0; transition: opacity 0.2s ease;
      }
      #hud-coach-hint.visible { opacity: 1; }
      #hud-coach-hint.idle { background: rgba(10, 20, 35, 0.78); color: #e6f4ff; box-shadow: none; }
      @keyframes snapPop {
        0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.3) rotate(-14deg); }
        14%  { opacity: 1; transform: translate(-50%, -50%) scale(1.18) rotate(-4deg); }
        26%  { transform: translate(-50%, -50%) scale(0.96) rotate(-6deg); }
        70%  { opacity: 1; transform: translate(-50%, -50%) scale(1.02) rotate(-6deg); }
        100% { opacity: 0; transform: translate(-50%, -62%) scale(1.25) rotate(-6deg); }
      }
      #hud-snap-hint {
        position: absolute; left: 50%; bottom: 22%; transform: translateX(-50%);
        padding: 6px 16px; border-radius: 999px; font: 700 15px system-ui, sans-serif;
        letter-spacing: 0.06em; text-transform: uppercase; pointer-events: none; z-index: 55;
        opacity: 0; transition: opacity 0.15s ease;
      }
      #hud-snap-hint.visible { opacity: 1; }
      #hud-snap-hint.ready { background: rgba(0, 220, 255, 0.92); color: #04202c; box-shadow: 0 0 18px rgba(0, 220, 255, 0.8); }
      #hud-snap-hint.dim { background: rgba(10, 20, 35, 0.7); color: #9fb6cc; }
      #hud-snap-hint.fail { background: rgba(255, 45, 117, 0.9); color: #fff; }
    `;
    document.head.appendChild(style);
  }

  public resetSession(): void {
    this.totalScore = 0;
    this.bestCombo = 0;
    this.activeComboBase = 0;
    this.comboMultiplier = 0;
    this.comboManeuvers = [];
    this.comboTimeout = 0;
    this.sessionTimeRemaining = 120.0;
    this.sessionEnded = false;
    this.scoreEl.textContent = '0';
    this.bestComboEl.textContent = '0';
    this.comboContainerEl.classList.remove('active');
  }

  public updateButtons(
    aspect: AspectMode,
    _atmosphere: AtmosphereMode,
    cameraStyle: CameraStyle,
    truckPreset: TruckFeelPreset,
    autoFlow: boolean
  ): void {
    this.btnAspectEl.textContent =
      aspect === '9:16' ? '📱 9:16 IG Reel Mode [R]' : '🖥️ 16:9 Desktop [R]';
    this.btnAspectEl.classList.toggle('active-reel', aspect === '9:16');

    this.btnAtmosphereEl.textContent = '🌙 Floodlit Munich Night';

    const camLabels: Record<CameraStyle, string> = {
      follow: '🎥 Follow Cam [V]',
      filmer: '📹 Filmer Cam [V]',
      mural: '🌴 Palm Mural Cam [V]',
    };
    this.btnCameraEl.textContent = camLabels[cameraStyle];

    const truckLabels: Record<TruckFeelPreset, string> = {
      smooth: '🛹 Truck: Smooth [T]',
      balanced: '🛹 Truck: Balanced [T]',
      snappy: '🛹 Truck: Snappy [T]',
    };
    this.btnTruckFeelEl.textContent = truckLabels[truckPreset];

    this.btnAutoFlowEl.textContent = autoFlow ? '🤖 Auto-Shred: ON [P]' : '🎮 Manual Control [P]';
    this.btnAutoFlowEl.classList.toggle('active-auto', autoFlow);
  }

  private renderCombo(): void {
    const totalCombo = this.activeComboBase * this.comboMultiplier;
    this.comboPointsEl.textContent = `${this.activeComboBase.toLocaleString()} × ${this.comboMultiplier} = ${totalCombo.toLocaleString()}`;
    this.comboStringEl.textContent = this.comboManeuvers.join('  +  ');
  }

  private bankCombo(): void {
    const landed = this.activeComboBase * this.comboMultiplier;
    this.totalScore += landed;
    if (landed > this.bestCombo) {
      this.bestCombo = landed;
    }
    this.scoreEl.textContent = this.totalScore.toLocaleString();
    this.bestComboEl.textContent = this.bestCombo.toLocaleString();

    this.activeComboBase = 0;
    this.comboMultiplier = 0;
    this.comboManeuvers = [];
    this.comboTimeout = 0;
    this.comboContainerEl.classList.remove('active');
  }
}
