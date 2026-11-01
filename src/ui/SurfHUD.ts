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
  onToggleMusic: () => void;
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
  private pretzelCountEl: HTMLElement | null = null;
  private pretzelBlockEl: HTMLElement | null = null;
  private timerEl: HTMLElement;
  private speedEl: HTMLElement;
  private speedoEl: HTMLElement;
  private dockEl: HTMLElement;
  private static readonly SPEEDO_MAX_KMH = 40;
  private flowFillEl: HTMLElement;
  private flowTrackEl: HTMLElement;
  private flowSegEls: HTMLElement[];
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
  private btnMusicEl: HTMLButtonElement | null = null;

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
    this.pretzelCountEl = document.getElementById('hud-pretzel-count');
    this.pretzelBlockEl = document.getElementById('hud-pretzel-block');
    this.timerEl = document.getElementById('hud-timer')!;
    this.speedEl = document.getElementById('hud-speed')!;
    this.speedoEl = document.getElementById('hud-speedo')!;

    // Foldable tricks & options dock (bottom-right): folded by default, state remembered across reloads
    this.dockEl = document.getElementById('hud-dock')!;
    this.dockEl.classList.toggle('collapsed', localStorage.getItem('surfsk8.dockCollapsed') !== '0');
    document.getElementById('dock-toggle')!.addEventListener('click', () => this.toggleDock());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') this.toggleDock();
    });
    this.flowFillEl = document.getElementById('hud-flow-fill')!;
    this.flowTrackEl = document.getElementById('hud-flow-track')!;
    this.flowSegEls = Array.from(this.flowTrackEl.querySelectorAll<HTMLElement>('.flow-seg'));
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
    this.btnMusicEl = document.getElementById('btn-music') as HTMLButtonElement | null;
    const btnResetEl = document.getElementById('btn-reset') as HTMLButtonElement;

    this.btnAspectEl.addEventListener('click', () => this.callbacks.onToggleAspect());
    this.btnAtmosphereEl.addEventListener('click', () => this.callbacks.onToggleAtmosphere());
    this.btnCameraEl.addEventListener('click', () => this.callbacks.onCycleCamera());
    this.btnTruckFeelEl.addEventListener('click', () => this.callbacks.onCycleTruckFeel());
    this.btnAutoFlowEl.addEventListener('click', () => this.callbacks.onToggleAutoFlow());
    if (this.btnMusicEl) {
      this.btnMusicEl.addEventListener('click', () => this.callbacks.onToggleMusic());
    }
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
    this.updateSpeedo(ctrl.speed * 3.6);

    const flowPct = Math.round(ctrl.flowMeter);
    this.flowFillEl.style.width = `${flowPct}%`;
    this.flowPctEl.textContent = `${flowPct}%`;
    this.flowFillEl.classList.toggle('special-ready', flowPct >= 99);
    this.flowTrackEl.classList.toggle('special-ready', flowPct >= 99);
    const activeSegs = Math.round((flowPct / 100) * this.flowSegEls.length);
    for (let i = 0; i < this.flowSegEls.length; i++) {
      this.flowSegEls[i].classList.toggle('filled', i < activeSegs);
    }

    // Pump rhythm feedback ribbon (right edge): only show on PERFECT PUMP, otherwise hidden
    if (ctrl.pumpSyncQuality === 'PERFECT PUMP!') {
      this.pumpBadgeEl.textContent = 'PERFECT PUMP';
      this.pumpBadgeEl.className = 'pump-badge perfect';
    } else {
      this.pumpBadgeEl.className = 'pump-badge neutral';
    }

    // Dual-axis front surf-adapter visual indicator
    const yawDeg = Math.round((ctrl.frontTruckYaw * 180) / Math.PI);
    const leanDeg = Math.round((ctrl.leanAngle * 180) / Math.PI);
    this.truckDialFrontEl.style.transform = `rotate(${yawDeg}deg)`;
    this.leanReadoutEl.textContent = `${Math.abs(leanDeg)}°`;

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
        position: absolute; left: 50%; top: 34%;
        transform: translate(-50%, -50%) scale(0.4) skewX(-12deg);
        font-family: 'Barlow Condensed', 'Impact', sans-serif; font-style: italic;
        font-size: clamp(64px, 12vw, 150px); font-weight: 900; letter-spacing: 0.04em;
        color: #f5f5f5; opacity: 0; pointer-events: none; z-index: 60; white-space: nowrap;
        text-transform: uppercase;
        text-shadow: 0 10px 30px rgba(0, 0, 0, 0.75);
      }
      #hud-snap-banner.perfect {
        color: #f2cc26;
        text-shadow: 0 10px 36px rgba(242, 204, 38, 0.55), 0 6px 20px rgba(0, 0, 0, 0.8);
      }
      #hud-snap-banner.show { animation: snapPop 1.45s cubic-bezier(0.2, 1.4, 0.4, 1) forwards; }
      #hud-snap-banner.long { font-size: clamp(44px, 8.5vw, 116px); }
      @keyframes snapPop {
        0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.3) skewX(-20deg); }
        14%  { opacity: 1; transform: translate(-50%, -50%) scale(1.12) skewX(-12deg); }
        26%  { transform: translate(-50%, -50%) scale(0.98) skewX(-12deg); }
        70%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0) skewX(-12deg); }
        100% { opacity: 0; transform: translate(-50%, -62%) scale(1.18) skewX(-12deg); }
      }
      #hud-coach-hint {
        position: absolute; left: 50%; top: 18%; transform: translateX(-50%) skewX(-11deg);
        max-width: 72%; text-align: center;
        font: 800 16px 'Barlow Condensed', sans-serif; letter-spacing: 0.08em; text-transform: uppercase;
        pointer-events: none; z-index: 56; color: #f2cc26;
        background: rgba(20, 18, 16, 0.78); padding: 6px 18px;
        opacity: 0; transition: opacity 0.2s ease;
      }
      #hud-coach-hint.visible { opacity: 1; }
      #hud-coach-hint.idle { color: #f5f5f5; }
      #hud-snap-hint {
        position: absolute; left: 50%; bottom: 20%; transform: translateX(-50%) skewX(-11deg);
        font: 800 16px 'Barlow Condensed', sans-serif; letter-spacing: 0.08em; text-transform: uppercase;
        pointer-events: none; z-index: 55;
        background: rgba(20, 18, 16, 0.82); padding: 5px 16px;
        opacity: 0; transition: opacity 0.15s ease;
      }
      #hud-snap-hint.visible { opacity: 1; }
      #hud-snap-hint.ready { color: #f2cc26; border-left: 3px solid #f2cc26; }
      #hud-snap-hint.dim { color: #9e9b95; }
      #hud-snap-hint.fail { color: #ff3d5a; border-left: 3px solid #ff3d5a; }
    `;
    document.head.appendChild(style);
  }

  public toggleDock(): void {
    const collapsed = this.dockEl.classList.toggle('collapsed');
    localStorage.setItem('surfsk8.dockCollapsed', collapsed ? '1' : '0');
  }

  private updateSpeedo(kmh: number): void {
    const frac = Math.min(1, Math.max(0, kmh / SurfHUD.SPEEDO_MAX_KMH));
    this.speedEl.textContent = String(Math.round(kmh));
    this.speedoEl.classList.toggle('redline', frac > 0.75);
  }

  public addBonusScore(points: number): void {
    this.totalScore += points;
    if (this.totalScore > this.bestCombo) {
      this.bestCombo = this.totalScore;
      this.bestComboEl.textContent = this.bestCombo.toLocaleString();
    }
    this.scoreEl.textContent = this.totalScore.toLocaleString();
    this.scoreEl.style.transform = 'scale(1.22)';
    this.scoreEl.style.color = '#fbbf24';
    setTimeout(() => {
      this.scoreEl.style.transform = '';
      this.scoreEl.style.color = '';
    }, 400);
  }

  public updatePretzelCount(collected: number, total: number): void {
    if (this.pretzelCountEl) {
      this.pretzelCountEl.textContent = `🥨 ${collected}/${total}`;
    }
    if (this.pretzelBlockEl) {
      const isComplete = collected >= total && total > 0;
      this.pretzelBlockEl.classList.toggle('complete', isComplete);
      if (isComplete && this.pretzelCountEl) {
        this.pretzelCountEl.textContent = `🥨 ${collected}/${total} ⭐`;
      }
    }
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
    this.updatePretzelCount(0, 5);
  }

  public updateButtons(
    aspect: AspectMode,
    _atmosphere: AtmosphereMode,
    cameraStyle: CameraStyle,
    truckPreset: TruckFeelPreset,
    autoFlow: boolean,
    musicActive = true,
    trackLabel = '1/2'
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

    if (this.btnMusicEl) {
      this.btnMusicEl.textContent = musicActive
        ? `🎵 Track ${trackLabel} [M] [N]`
        : '🔇 Music: OFF [M]';
      this.btnMusicEl.classList.toggle('active-auto', musicActive);
    }
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
