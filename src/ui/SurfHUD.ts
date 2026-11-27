import { ManeuverEvent, SurfskateController, TruckFeelPreset } from '../physics/SurfskateController';
import { AspectMode, CameraStyle } from '../camera/SurfCamera';
import { AtmosphereMode } from '../world/ImGefildeScene';
import { SessionSummaryData, SkaterRankInfo, SurfMission } from '../progression/SurfProgression';
import {
  fetchLeaderboard,
  getPlayerName,
  LeaderboardEntry,
  LeaderboardPark,
  setPlayerName,
  submitScore,
  ValidLeaderboardPark,
} from '../services/LeaderboardService';
import { formatNum, onLangChange, t } from '../i18n/i18n';

export type DriveControlMode = 'arrows' | 'wasd';

export interface HUDCallbacks {
  onToggleAspect: () => void;
  onToggleAtmosphere: () => void;
  onCycleCamera: () => void;
  onCycleTruckFeel: () => void;
  onToggleAutoFlow: () => void;
  onResetSession: () => void;
  onToggleMusic: () => void;
  onCycleQuality?: () => void;
  onToggleControlMode?: () => void;
  onToggleTouchControls?: () => void;
  onToggleFullscreen?: () => void;
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
  public sessionTimerPaused = false;
  public tutorialActive = false;
  public sessionEnded = false;
  public endlessMode = false;
  public isOvertime = false;
  public onSessionComplete?: () => void;

  private scoreEl: HTMLElement;
  private bestComboEl: HTMLElement;
  private pretzelCountEl: HTMLElement | null = null;
  private pretzelBlockEl: HTMLElement | null = null;
  private timerEl: HTMLElement;
  private sessionBlockEl: HTMLElement | null = null;
  private sessionLabelEl: HTMLElement | null = null;
  private speedEl: HTMLElement;
  private speedoEl: HTMLElement;
  private pumpSurgeTagEl: HTMLElement | null = null;
  private pumpPulseTimeout: number | null = null;
  private wallCueEl: HTMLElement | null = null;
  private contextTrickEl: HTMLElement | null = null;
  private dockEl: HTMLElement;
  private static readonly SPEEDO_MAX_KMH = 40;
  private flowCardEl: HTMLElement | null = null;
  private flowTitleEl: HTMLElement | null = null;
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

  // Progression, Hot-Spot & Summary Modal elements
  private hotSpotPillEl: HTMLElement | null = null;
  private hotSpotPillTextEl: HTMLElement | null = null;
  private hudRankLabelEl: HTMLElement | null = null;
  private hudMissionsListEl: HTMLElement | null = null;
  private dockRankTitleEl: HTMLElement | null = null;
  private dockMissionsListEl: HTMLElement | null = null;
  private missionToastEl: HTMLElement | null = null;
  private missionToastTimeout: number | null = null;

  // Crew Encounters (Issue #37) & After Hours Wanted (Issue #38) HUD elements
  private crewInteractBtnEl: HTMLButtonElement | null = null;
  private crewInteractTextEl: HTMLElement | null = null;
  private crewDialogueEl: HTMLElement | null = null;
  private crewDialogueSpeakerEl: HTMLElement | null = null;
  private crewDialogueTextEl: HTMLElement | null = null;
  private crewDialogueTimeout: number | null = null;
  private crewQuestPillEl: HTMLElement | null = null;
  private crewQuestPillTextEl: HTMLElement | null = null;
  private wantedBarEl: HTMLElement | null = null;
  private wantedStarsEl: HTMLElement | null = null;
  private wantedOutlawEl: HTMLElement | null = null;
  private wantedBustedWrapEl: HTMLElement | null = null;
  private wantedBustedFillEl: HTMLElement | null = null;
  private lastCrewInteract?: { canInteract: boolean; npcId: 'sepp' | 'michi'; isTouch: boolean };
  private lastWantedOutlawVisible = false;
  private summaryModalEl: HTMLElement | null = null;
  private summaryRetryCallback: (() => void) | null = null;
  private summaryGarageCallback: (() => void) | null = null;
  private summaryOpenLeaderboardCallback: ((park: LeaderboardPark) => void) | null = null;
  private summaryCurrentScore = 0;
  private summaryCurrentParkId: ValidLeaderboardPark = 'im_gefilde';
  private summaryLbToken = 0;
  private summaryPlayerInputEl: HTMLInputElement | null = null;
  private summarySubmitBtnEl: HTMLButtonElement | null = null;
  private summaryLbStatusEl: HTMLElement | null = null;
  private summaryLbListEl: HTMLElement | null = null;
  private summaryLbFullBtnEl: HTMLButtonElement | null = null;

  public controlMode: DriveControlMode = 'arrows';
  private btnControlsEl: HTMLButtonElement | null = null;
  private tricksListEl: HTMLElement | null = null;
  private ridingListEl: HTMLElement | null = null;

  private btnAspectEl: HTMLButtonElement;
  private btnAtmosphereEl: HTMLButtonElement | null = null;
  private btnCameraEl: HTMLButtonElement;
  private btnTruckFeelEl: HTMLButtonElement;
  private btnAutoFlowEl: HTMLButtonElement;
  private btnMusicEl: HTMLButtonElement | null = null;
  private btnQualityEl: HTMLButtonElement | null = null;
  private btnFpsEl: HTMLButtonElement | null = null;
  private btnTouchEl: HTMLButtonElement | null = null;
  private btnFullscreenEl: HTMLButtonElement | null = null;
  private btnHudFullscreenEl: HTMLButtonElement | null = null;

  // SNAP trick overlays
  private snapBannerEl: HTMLDivElement;
  private snapHintEl: HTMLDivElement;
  private coachHintEl: HTMLDivElement;
  private snapBannerAnimation: Animation | null = null;
  private flowLineHint: string | null = null;

  // Cached state for live language switching
  private lastBtnState?: {
    aspect: AspectMode;
    atmosphere: AtmosphereMode;
    cameraStyle: CameraStyle;
    truckPreset: TruckFeelPreset;
    autoFlow: boolean;
    musicActive: boolean;
    trackLabel: string;
  };
  private lastQualityState?: {
    preset: 'auto' | 'high' | 'medium' | 'low';
    effective: 'high' | 'medium' | 'low';
  };
  private lastTouchEnabled?: boolean;
  private lastIsFullscreen?: boolean;
  private lastMissionsState?: { rank: SkaterRankInfo; missions: SurfMission[] };

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
    this.sessionBlockEl = document.getElementById('hud-session-block');
    this.sessionLabelEl = document.getElementById('hud-session-label');
    this.speedEl = document.getElementById('hud-speed')!;
    this.speedoEl = document.getElementById('hud-speedo')!;
    this.pumpSurgeTagEl = document.getElementById('hud-pump-surge-tag');
    this.wallCueEl = document.getElementById('hud-wall-cue');
    this.contextTrickEl = document.getElementById('hud-context-trick');
    this.flowCardEl = document.getElementById('hud-flow-card');
    this.flowTitleEl = document.getElementById('hud-flow-title');
    this.hotSpotPillEl = document.getElementById('hud-hotspot-pill');
    this.hotSpotPillTextEl = document.getElementById('hud-hotspot-pill-text');
    this.hudRankLabelEl = document.getElementById('hud-rank-label');
    this.hudMissionsListEl = document.getElementById('hud-missions-list');
    this.dockRankTitleEl = document.getElementById('dock-rank-title');
    this.dockMissionsListEl = document.getElementById('dock-missions-list');
    this.missionToastEl = document.getElementById('hud-mission-toast');
    this.crewInteractBtnEl = document.getElementById('hud-crew-interact') as HTMLButtonElement | null;
    this.crewInteractTextEl = document.getElementById('hud-crew-interact-text');
    this.crewDialogueEl = document.getElementById('hud-crew-dialogue');
    this.crewDialogueSpeakerEl = document.getElementById('hud-crew-dialogue-speaker');
    this.crewDialogueTextEl = document.getElementById('hud-crew-dialogue-text');
    this.crewQuestPillEl = document.getElementById('hud-crew-quest-pill');
    this.crewQuestPillTextEl = document.getElementById('hud-crew-quest-pill-text');
    this.wantedBarEl = document.getElementById('hud-wanted-bar');
    this.wantedStarsEl = document.getElementById('hud-wanted-stars');
    this.wantedOutlawEl = document.getElementById('hud-wanted-outlaw');
    this.wantedBustedWrapEl = document.getElementById('hud-wanted-busted-wrap');
    this.wantedBustedFillEl = document.getElementById('hud-wanted-busted-fill');
    this.summaryModalEl = document.getElementById('session-summary-modal');
    this.summaryPlayerInputEl = document.getElementById('summary-player-name') as HTMLInputElement | null;
    this.summarySubmitBtnEl = document.getElementById('summary-submit-score') as HTMLButtonElement | null;
    this.summaryLbStatusEl = document.getElementById('summary-lb-status');
    this.summaryLbListEl = document.getElementById('summary-lb-list');
    this.summaryLbFullBtnEl = document.getElementById('summary-lb-open-full') as HTMLButtonElement | null;

    if (this.summaryPlayerInputEl) {
      this.summaryPlayerInputEl.value = getPlayerName();
      this.summaryPlayerInputEl.addEventListener('blur', () => {
        if (this.summaryPlayerInputEl) {
          this.summaryPlayerInputEl.value = setPlayerName(this.summaryPlayerInputEl.value);
        }
      });
      this.summaryPlayerInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void this.handleSummaryScoreSubmit();
        }
      });
    }
    if (this.summarySubmitBtnEl) {
      this.summarySubmitBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.handleSummaryScoreSubmit();
      });
    }
    if (this.summaryLbFullBtnEl) {
      this.summaryLbFullBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.summaryOpenLeaderboardCallback?.(this.summaryCurrentParkId);
      });
    }

    const btnRetry = document.getElementById('summary-btn-retry');
    const btnGarage = document.getElementById('summary-btn-garage');
    if (btnRetry) {
      btnRetry.addEventListener('click', (e) => {
        e.stopPropagation();
        const cb = this.summaryRetryCallback;
        this.closeSessionSummary();
        cb?.();
      });
    }
    if (btnGarage) {
      btnGarage.addEventListener('click', (e) => {
        e.stopPropagation();
        const cb = this.summaryGarageCallback;
        this.closeSessionSummary();
        cb?.();
      });
    }

    // Foldable tricks & options dock (bottom-right): folded by default, state remembered across reloads
    this.dockEl = document.getElementById('hud-dock')!;
    this.setDockOpen(false);
    const dockToggleBtn = document.getElementById('dock-toggle')!;
    dockToggleBtn.addEventListener('click', () => {
      this.toggleDock();
      dockToggleBtn.blur();
    });
    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable) {
        return;
      }
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

    this.tricksListEl = document.getElementById('dock-tricks-list');
    this.ridingListEl = document.getElementById('dock-riding-list');
    this.btnControlsEl = document.getElementById('btn-controls') as HTMLButtonElement | null;
    this.btnAspectEl = document.getElementById('btn-aspect') as HTMLButtonElement;
    this.btnAtmosphereEl = document.getElementById('btn-atmosphere') as HTMLButtonElement | null;
    this.btnCameraEl = document.getElementById('btn-camera') as HTMLButtonElement;
    this.btnTruckFeelEl = document.getElementById('btn-truckfeel') as HTMLButtonElement;
    this.btnAutoFlowEl = document.getElementById('btn-autoflow') as HTMLButtonElement;
    this.btnMusicEl = document.getElementById('btn-music') as HTMLButtonElement | null;
    this.btnQualityEl = document.getElementById('btn-quality') as HTMLButtonElement | null;
    this.btnFpsEl = document.getElementById('btn-fps') as HTMLButtonElement | null;
    this.btnTouchEl = document.getElementById('btn-touch') as HTMLButtonElement | null;
    this.btnFullscreenEl = document.getElementById('btn-fullscreen') as HTMLButtonElement | null;
    this.btnHudFullscreenEl = document.getElementById('btn-hud-fullscreen') as HTMLButtonElement | null;
    const btnResetEl = document.getElementById('btn-reset') as HTMLButtonElement;

    const bindHudBtn = (btn: HTMLButtonElement | null, action: (() => void) | undefined) => {
      if (!btn || !action) return;
      btn.addEventListener('click', () => {
        action();
        btn.blur();
      });
    };

    bindHudBtn(this.btnControlsEl, () => this.callbacks.onToggleControlMode?.());
    bindHudBtn(this.btnTouchEl, () => this.callbacks.onToggleTouchControls?.());
    bindHudBtn(this.btnFullscreenEl, () => this.callbacks.onToggleFullscreen?.());
    bindHudBtn(this.btnHudFullscreenEl, () => this.callbacks.onToggleFullscreen?.());
    bindHudBtn(this.btnAspectEl, () => this.callbacks.onToggleAspect());
    bindHudBtn(this.btnAtmosphereEl, () => this.callbacks.onToggleAtmosphere());
    bindHudBtn(this.btnCameraEl, () => this.callbacks.onCycleCamera());
    bindHudBtn(this.btnTruckFeelEl, () => this.callbacks.onCycleTruckFeel());
    bindHudBtn(this.btnAutoFlowEl, () => this.callbacks.onToggleAutoFlow());
    bindHudBtn(this.btnMusicEl, () => this.callbacks.onToggleMusic());
    bindHudBtn(this.btnQualityEl, () => this.callbacks.onCycleQuality?.());
    bindHudBtn(btnResetEl, () => this.callbacks.onResetSession());

    onLangChange(() => {
      this.refreshLocalizedUI();
    });
  }

  private refreshLocalizedUI(): void {
    this.setControlMode(this.controlMode);
    if (this.lastBtnState) {
      const s = this.lastBtnState;
      this.updateButtons(
        s.aspect,
        s.atmosphere,
        s.cameraStyle,
        s.truckPreset,
        s.autoFlow,
        s.musicActive,
        s.trackLabel
      );
    }
    if (this.lastQualityState) {
      this.updateQualityButton(this.lastQualityState.preset, this.lastQualityState.effective);
    }
    if (this.lastTouchEnabled !== undefined) {
      this.updateTouchButton(this.lastTouchEnabled);
    }
    if (this.lastIsFullscreen !== undefined) {
      this.updateFullscreenState(this.lastIsFullscreen);
    }
    if (this.lastMissionsState) {
      this.updateMissionsWidget(this.lastMissionsState.rank, this.lastMissionsState.missions);
    }
    if (this.lastCrewInteract) {
      this.updateCrewInteract(
        this.lastCrewInteract.canInteract,
        this.lastCrewInteract.npcId,
        this.lastCrewInteract.isTouch
      );
    }
    if (this.wantedOutlawEl && this.lastWantedOutlawVisible) {
      const span = this.wantedOutlawEl.querySelector('span');
      if (span) span.textContent = t('wanted.outlawBadge');
    }
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
    const ctrlAny = ctrl as unknown as {
      endlessMode?: boolean;
      sessionOvertime?: boolean;
      sessionFinished?: boolean;
      isSurfZoneActive?: boolean;
    };
    const isZen = this.endlessMode || Boolean(ctrlAny.endlessMode);

    // 1. Active Combo Timeout & Banking
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

    // 2. Session Timer (2:00 countdown, Overtime-Combo, or Endless Zen)
    if (isZen) {
      this.timerEl.textContent = t('hud.zenTimer');
      this.timerEl.classList.remove('urgent', 'overtime');
      this.sessionBlockEl?.classList.remove('overtime');
      this.sessionBlockEl?.classList.add('zen-mode');
      if (this.sessionLabelEl) this.sessionLabelEl.textContent = t('hud.freeSurf');
    } else {
      this.sessionBlockEl?.classList.remove('zen-mode');
      if (!this.sessionEnded && !this.sessionTimerPaused) {
        this.sessionTimeRemaining = Math.max(0, this.sessionTimeRemaining - dt);
        if (this.sessionTimeRemaining === 0) {
          const comboStillAlive =
            !ctrl.isBailing &&
            (this.comboMultiplier > 0 ||
              this.comboTimeout > 0 ||
              !ctrl.isGrounded ||
              ctrl.isGrinding ||
              Boolean(ctrlAny.sessionOvertime));

          if (comboStillAlive) {
            this.isOvertime = true;
          } else {
            if (!ctrl.isBailing && this.comboMultiplier > 0) {
              this.bankCombo();
            }
            this.isOvertime = false;
            this.sessionEnded = true;
            this.onSessionComplete?.();
          }
        }
      }

      if (this.isOvertime && !this.sessionEnded) {
        this.timerEl.textContent = t('hud.overtime');
        this.timerEl.classList.remove('urgent');
        this.timerEl.classList.add('overtime');
        this.sessionBlockEl?.classList.add('overtime');
        if (this.sessionLabelEl) this.sessionLabelEl.textContent = t('hud.keepCombo');
      } else {
        this.timerEl.classList.remove('overtime');
        this.sessionBlockEl?.classList.remove('overtime');
        if (this.sessionLabelEl) this.sessionLabelEl.textContent = t('hud.session');
        const mins = Math.floor(this.sessionTimeRemaining / 60);
        const secs = Math.floor(this.sessionTimeRemaining % 60);
        const tenths = Math.floor((this.sessionTimeRemaining % 1) * 10);
        this.timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
        if (this.sessionTimeRemaining < 15 && this.sessionTimeRemaining > 0) {
          this.timerEl.classList.add('urgent');
        } else {
          this.timerEl.classList.remove('urgent');
        }
      }
    }

    // 3. Speed, Zone, and Surf-Adapter Telemetry
    this.updateSpeedo(ctrl.speed * 3.6);

    const flowPct = Math.round(ctrl.flowMeter);
    const inSurfZone = Boolean(ctrlAny.isSurfZoneActive) || flowPct >= 80;
    this.flowFillEl.style.width = `${flowPct}%`;
    this.flowPctEl.textContent = `${flowPct}%`;
    this.flowFillEl.classList.toggle('special-ready', flowPct >= 99);
    this.flowTrackEl.classList.toggle('special-ready', flowPct >= 99);
    this.flowTrackEl.classList.toggle('surf-zone', inSurfZone);
    this.flowCardEl?.classList.toggle('surf-zone', inSurfZone);
    if (this.flowTitleEl) {
      this.flowTitleEl.textContent = inSurfZone ? t('hud.surfZone') : t('hud.flow');
    }
    const activeSegs = Math.round((flowPct / 100) * this.flowSegEls.length);
    for (let i = 0; i < this.flowSegEls.length; i++) {
      this.flowSegEls[i].classList.toggle('filled', i < activeSegs);
    }

    // Pump rhythm feedback ribbon (right edge): only show on PERFECT PUMP, otherwise hidden
    if (ctrl.pumpSyncQuality === 'PERFECT PUMP!') {
      this.pumpBadgeEl.textContent = t('hud.perfectPump');
      this.pumpBadgeEl.className = 'pump-badge perfect';
    } else {
      this.pumpBadgeEl.className = 'pump-badge neutral';
    }

    // Dual-axis front surf-adapter visual indicator
    const yawDeg = Math.round((ctrl.frontTruckYaw * 180) / Math.PI);
    const leanDeg = Math.round((ctrl.leanAngle * 180) / Math.PI);
    this.truckDialFrontEl.style.transform = `rotate(${yawDeg}deg)`;
    this.leanReadoutEl.textContent = `${Math.abs(leanDeg)}°`;

    // 4. SNAP / INDY GRAB hint / failure feedback
    if (ctrl.snapFeedback) {
      this.snapHintEl.textContent = ctrl.snapFeedback;
      this.snapHintEl.className = 'visible fail';
    } else if (ctrl.indyGrabReady && !ctrl.indyGrabActive) {
      this.snapHintEl.textContent = t('hud.indyHold');
      this.snapHintEl.className = 'visible ready';
    } else if (ctrl.indyGrabActive) {
      this.snapHintEl.textContent = t('hud.indyTweak');
      this.snapHintEl.className = 'visible ready';
    } else if (ctrl.snapWindow === 'READY' && !ctrl.snapActive) {
      const snapKey = this.controlMode === 'arrows' ? 'Q' : 'O';
      this.snapHintEl.textContent = t('hud.snapReady', { key: snapKey });
      this.snapHintEl.className = 'visible ready';
    } else if (ctrl.snapWindow === 'TOO_SLOW') {
      this.snapHintEl.textContent = t('hud.snapTooSlow');
      this.snapHintEl.className = 'visible dim';
    } else if (ctrl.snapWindow === 'TOO_FAST') {
      this.snapHintEl.textContent = t('hud.snapTooFast');
      this.snapHintEl.className = 'visible dim';
    } else {
      this.snapHintEl.className = '';
    }

    // 5. Coaching hints, Wall Compress->Extend Cue & Live Context Trick Prompt
    // Never show coaching/action cues while landing overlay is open
    const landingOverlay = document.getElementById('landing-overlay');
    const isLandingOpen = Boolean(landingOverlay && !landingOverlay.classList.contains('hidden'));
    const isTouch =
      Boolean(this.lastTouchEnabled) || document.body.classList.contains('has-touch-controls');

    if (this.wallCueEl) {
      if (
        !isLandingOpen &&
        !this.tutorialActive &&
        !ctrl.isBailing &&
        !this.sessionEnded &&
        ctrl.wallPumpCue !== 'none'
      ) {
        if (ctrl.wallPumpCue === 'extend') {
          this.wallCueEl.textContent = isTouch
            ? t('hud.wallCueExtendTouch')
            : t('hud.wallCueExtendDesktop');
          this.wallCueEl.className = 'hud-action-pill visible extend';
        } else {
          this.wallCueEl.textContent = isTouch
            ? t('hud.wallCueCompressTouch')
            : t('hud.wallCueCompressDesktop', { key: 'SHIFT' });
          this.wallCueEl.className = 'hud-action-pill visible compress';
        }
      } else {
        this.wallCueEl.className = 'hud-action-pill';
      }
    }

    if (this.contextTrickEl) {
      const inTrickOrBail =
        ctrl.isBailing ||
        ctrl.snapActive ||
        ctrl.bertSlideActive ||
        ctrl.laybackActive ||
        ctrl.reverseActive ||
        ctrl.indyGrabActive;
      if (
        !isLandingOpen &&
        !this.sessionEnded &&
        !inTrickOrBail &&
        ctrl.availableContextTrick !== 'none'
      ) {
        const keyMap: Record<
          Exclude<typeof ctrl.availableContextTrick, 'none'>,
          'hud.ctxTrickBertTouch' | 'hud.ctxTrickBertDesktop' | 'hud.ctxTrickLaybackTouch' | 'hud.ctxTrickLaybackDesktop' | 'hud.ctxTrickSnapTouch' | 'hud.ctxTrickSnapDesktop' | 'hud.ctxTrickReverseTouch' | 'hud.ctxTrickReverseDesktop'
        > = {
          bert: isTouch ? 'hud.ctxTrickBertTouch' : 'hud.ctxTrickBertDesktop',
          layback: isTouch ? 'hud.ctxTrickLaybackTouch' : 'hud.ctxTrickLaybackDesktop',
          snap: isTouch ? 'hud.ctxTrickSnapTouch' : 'hud.ctxTrickSnapDesktop',
          reverse360: isTouch ? 'hud.ctxTrickReverseTouch' : 'hud.ctxTrickReverseDesktop',
        };
        this.contextTrickEl.textContent = t(keyMap[ctrl.availableContextTrick]);
        this.contextTrickEl.className = `hud-action-pill visible is-${ctrl.availableContextTrick}`;
      } else {
        this.contextTrickEl.className = 'hud-action-pill';
      }
    }

    if (isLandingOpen) {
      this.coachHintEl.className = '';
      return;
    }

    if (ctrl.isBailing) {
      this.coachHintEl.textContent = t('hud.wipeoutPrefix', {
        reason: ctrl.bailReason || t('hud.wipeoutFallback'),
      });
      this.coachHintEl.className = 'visible bail';
    } else if (this.tutorialActive) {
      this.coachHintEl.className = '';
    } else if (this.flowLineHint) {
      this.coachHintEl.textContent = this.flowLineHint;
      this.coachHintEl.className = 'visible ready';
    } else if (ctrl.coachHint) {
      let hint = ctrl.coachHint;
      const isTouch =
        document.body.classList.contains('has-touch-controls') ||
        (typeof window !== 'undefined' && window.innerWidth <= 960);
      if (isTouch) {
        hint = hint
          .replace(/press [↑W] once to push off/i, 'tap ▲ PUMP to push off')
          .replace(/press [↑W]/i, 'tap ▲ PUMP')
          .replace(/drücke [↑W] einmal zum Pushen/i, 'tippe ▲ PUMP zum Losfahren')
          .replace(/← →/g, '◀ ▶');
      }
      this.coachHintEl.textContent = hint;
      this.coachHintEl.className = 'visible';
    } else if (ctrl.isGrounded && ctrl.speed < 0.4) {
      const isTouch =
        document.body.classList.contains('has-touch-controls') ||
        (typeof window !== 'undefined' && window.innerWidth <= 960);
      if (isTouch) {
        this.coachHintEl.textContent = t('hud.pushTouch');
      } else {
        const pushKey = this.controlMode === 'arrows' ? '↑' : 'W';
        this.coachHintEl.textContent = t('hud.pushKey', { key: pushKey });
      }
      this.coachHintEl.className = 'visible idle';
    } else {
      this.coachHintEl.className = '';
    }
  }

  /** Big animated trick name (SNAP!, LAYBACK!, BERTSLIDE!, FS REVERSE 360!). */
  public showTrickBanner(text: string, perfect: boolean): void {
    this.snapBannerEl.textContent = text;
    const long = text.length > 10 ? ' long' : '';
    this.snapBannerEl.className = (perfect ? 'perfect' : '') + long;

    // Use Web Animations API: runs on GPU compositor thread, 0 layout reflows (no offsetWidth)!
    if (this.snapBannerAnimation) {
      this.snapBannerAnimation.cancel();
    }
    this.snapBannerAnimation = this.snapBannerEl.animate(
      [
        { opacity: 0, transform: 'translate3d(-50%, -50%, 0) scale(0.3) skewX(-20deg)', offset: 0 },
        { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(1.12) skewX(-12deg)', offset: 0.14 },
        { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(0.98) skewX(-12deg)', offset: 0.26 },
        { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(1.0) skewX(-12deg)', offset: 0.70 },
        { opacity: 0, transform: 'translate3d(-50%, -62%, 0) scale(1.18) skewX(-12deg)', offset: 1.0 },
      ],
      {
        duration: 1450,
        easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)',
        fill: 'forwards',
      }
    );
  }

  /** Big red banner when the player wipes out / bails. */
  public showBailBanner(reason = 'WIPEOUT!'): void {
    this.breakCombo();
    this.snapBannerEl.textContent = reason;
    const long = reason.length > 10 ? ' long' : '';
    this.snapBannerEl.className = 'bail' + long;

    if (this.snapBannerAnimation) {
      this.snapBannerAnimation.cancel();
    }
    this.snapBannerAnimation = this.snapBannerEl.animate(
      [
        { opacity: 0, transform: 'translate3d(-50%, -50%, 0) scale(0.3) skewX(-20deg)', offset: 0 },
        { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(1.12) skewX(-12deg)', offset: 0.14 },
        { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(0.98) skewX(-12deg)', offset: 0.26 },
        { opacity: 1, transform: 'translate3d(-50%, -50%, 0) scale(1.0) skewX(-12deg)', offset: 0.70 },
        { opacity: 0, transform: 'translate3d(-50%, -62%, 0) scale(1.18) skewX(-12deg)', offset: 1.0 },
      ],
      {
        duration: 1450,
        easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)',
        fill: 'forwards',
      }
    );
  }

  /** Wipe out the active combo without banking it to the session score. */
  public breakCombo(): void {
    this.activeComboBase = 0;
    this.comboMultiplier = 0;
    this.comboManeuvers = [];
    this.comboTimeout = 0;
    this.comboContainerEl.classList.remove('active');
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
        transform: translate3d(-50%, -50%, 0) scale(0.4) skewX(-12deg);
        will-change: transform, opacity;
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
      #hud-snap-banner.bail {
        color: #ff3344;
        text-shadow: 0 10px 36px rgba(255, 51, 68, 0.7), 0 6px 20px rgba(0, 0, 0, 0.85);
      }
      #hud-snap-banner.long { font-size: clamp(44px, 8.5vw, 116px); }
      #hud-score {
        display: inline-block;
        transition: transform 0.25s cubic-bezier(0.2, 1.4, 0.4, 1), color 0.25s ease;
        will-change: transform;
      }
      #hud-pretzel-count {
        display: inline-block;
        transition: transform 0.22s cubic-bezier(0.2, 1.4, 0.4, 1);
        will-change: transform;
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
      #hud-coach-hint.bail { color: #ff4d4d; border: 1px solid rgba(255, 77, 77, 0.45); }
      #hud-snap-hint {
        position: absolute; left: 50%; bottom: max(180px, 23%); transform: translateX(-50%) skewX(-11deg);
        font: 800 16px 'Barlow Condensed', sans-serif; letter-spacing: 0.08em; text-transform: uppercase;
        pointer-events: none; z-index: 55;
        background: rgba(20, 18, 16, 0.82); padding: 5px 16px;
        opacity: 0; transition: opacity 0.15s ease;
      }
      #hud-snap-hint.visible { opacity: 1; }
      #hud-snap-hint.ready { color: #f2cc26; border-left: 3px solid #f2cc26; }
      #hud-snap-hint.dim { color: #9e9b95; }
      #hud-snap-hint.fail { color: #ff3d5a; border-left: 3px solid #ff3d5a; }
      @media (pointer: coarse), (max-height: 540px), (max-width: 900px) {
        #hud-snap-banner {
          top: 28%;
          font-size: clamp(28px, 6.5vw, 52px);
        }
        #hud-snap-banner.long {
          font-size: clamp(22px, 5vw, 40px);
        }
        #hud-coach-hint {
          top: 15%;
          max-width: min(74vw, 420px);
          font-size: 12px;
          padding: 4px 12px;
        }
        #hud-snap-hint {
          bottom: calc(96px + env(safe-area-inset-bottom, 0px));
          font-size: 12px;
          padding: 3px 10px;
          max-width: min(44vw, 280px);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
        }
      }
      @media (max-width: 900px) and (orientation: portrait) {
        body.has-touch-controls #hud-snap-hint,
        body.reel-mode.has-touch-controls #hud-snap-hint {
          bottom: calc(296px + env(safe-area-inset-bottom, 0px));
          max-width: min(86vw, 300px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  public toggleDock(): void {
    const collapsed = this.dockEl.classList.toggle('collapsed');
    localStorage.setItem('surfsk8.dockCollapsed', collapsed ? '1' : '0');
  }

  public setDockOpen(open: boolean): void {
    this.dockEl.classList.toggle('collapsed', !open);
    localStorage.setItem('surfsk8.dockCollapsed', open ? '0' : '1');
  }

  private updateSpeedo(kmh: number): void {
    const frac = Math.min(1, Math.max(0, kmh / SurfHUD.SPEEDO_MAX_KMH));
    this.speedEl.textContent = String(Math.round(kmh));
    this.speedoEl.classList.toggle('redline', frac > 0.75);
  }

  /** Briefly flashes a cyan/gold glow & micro-tag next to the speedometer on pump hit. */
  public triggerPumpPulse(type: 'rail' | 'wall' | 'none'): void {
    if (type === 'none') return;
    if (this.pumpPulseTimeout !== null) {
      window.clearTimeout(this.pumpPulseTimeout);
      this.pumpPulseTimeout = null;
    }
    this.speedoEl.classList.remove('pump-rail', 'pump-wall');
    const cls = type === 'wall' ? 'pump-wall' : 'pump-rail';
    this.speedoEl.classList.add(cls);
    if (this.pumpSurgeTagEl) {
      this.pumpSurgeTagEl.textContent = t(
        type === 'wall' ? 'hud.pumpSurgeWall' : 'hud.pumpSurgeRail'
      );
      this.pumpSurgeTagEl.animate(
        [
          { opacity: 0, transform: 'skewX(-12deg) translate3d(0, 6px, 0) scale(0.8)', offset: 0 },
          { opacity: 1, transform: 'skewX(-12deg) translate3d(0, 0, 0) scale(1.08)', offset: 0.2 },
          { opacity: 1, transform: 'skewX(-12deg) translate3d(0, 0, 0) scale(1)', offset: 0.75 },
          { opacity: 0, transform: 'skewX(-12deg) translate3d(0, -4px, 0) scale(0.95)', offset: 1 },
        ],
        { duration: 520, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }
      );
    }
    this.pumpPulseTimeout = window.setTimeout(() => {
      this.speedoEl.classList.remove('pump-rail', 'pump-wall');
      this.pumpPulseTimeout = null;
    }, 520);
  }

  public addBonusScore(points: number): void {
    this.totalScore += points;
    if (this.totalScore > this.bestCombo) {
      this.bestCombo = this.totalScore;
      this.bestComboEl.textContent = formatNum(this.bestCombo);
    }
    this.scoreEl.textContent = formatNum(this.totalScore);
    this.scoreEl.style.transform = 'scale3d(1.22, 1.22, 1)';
    this.scoreEl.style.color = '#fbbf24';
    setTimeout(() => {
      this.scoreEl.style.transform = '';
      this.scoreEl.style.color = '';
    }, 320);
  }

  public awardBonusPoints(points: number, label: string): void {
    this.addBonusScore(points);
    this.showTrickBanner(label, true);
  }

  public setFlowLineHint(hint: string | null): void {
    this.flowLineHint = hint;
  }

  public updatePretzelCount(collected: number, total: number): void {
    if (this.pretzelCountEl) {
      this.pretzelCountEl.textContent = `🥨 ${collected}/${total}`;
      if (collected > 0) {
        this.pretzelCountEl.style.transform = 'scale3d(1.25, 1.25, 1)';
        setTimeout(() => {
          if (this.pretzelCountEl) this.pretzelCountEl.style.transform = '';
        }, 220);
      }
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
    this.setDockOpen(false);
    this.totalScore = 0;
    this.bestCombo = 0;
    this.activeComboBase = 0;
    this.comboMultiplier = 0;
    this.comboManeuvers = [];
    this.comboTimeout = 0;
    this.sessionTimeRemaining = 120.0;
    this.sessionEnded = false;
    this.isOvertime = false;
    this.flowLineHint = null;
    this.scoreEl.textContent = '0';
    this.bestComboEl.textContent = '0';
    this.timerEl.classList.remove('urgent', 'overtime');
    this.sessionBlockEl?.classList.remove('overtime');
    this.comboContainerEl.classList.remove('active');
    this.speedoEl.classList.remove('pump-rail', 'pump-wall');
    if (this.pumpPulseTimeout !== null) {
      window.clearTimeout(this.pumpPulseTimeout);
      this.pumpPulseTimeout = null;
    }
    if (this.wallCueEl) this.wallCueEl.className = 'hud-action-pill';
    if (this.contextTrickEl) this.contextTrickEl.className = 'hud-action-pill';
    this.updatePretzelCount(0, 5);
    this.updateHotSpotStatus(null, 0, false);
    this.updateCrewInteract(false, 'sepp', false);
    this.hideCrewDialogue();
    this.updateCrewQuestPill('idle', 'sepp', 0, 4);
    this.updateWantedStatus({ active: false, stars: 0, inOutlawSpotlight: false, bustedProgress: 0 });
    this.closeSessionSummary();
  }

  public updateCrewInteract(
    canInteract: boolean,
    npcId: 'sepp' | 'michi',
    isTouch: boolean
  ): void {
    this.lastCrewInteract = { canInteract, npcId, isTouch };
    if (!this.crewInteractBtnEl || !this.crewInteractTextEl) return;
    this.crewInteractBtnEl.classList.toggle('hidden', !canInteract);
    this.crewInteractBtnEl.classList.toggle('michi', npcId === 'michi');
    if (canInteract) {
      const key =
        npcId === 'sepp'
          ? isTouch
            ? 'crew.sepp.interactTouch'
            : 'crew.sepp.interactDesktop'
          : isTouch
            ? 'crew.michi.interactTouch'
            : 'crew.michi.interactDesktop';
      this.crewInteractTextEl.textContent = t(key);
    }
  }

  public showCrewDialogue(
    icon: string,
    speaker: string,
    quote: string,
    durationMs = 5000
  ): void {
    if (!this.crewDialogueEl || !this.crewDialogueSpeakerEl || !this.crewDialogueTextEl) return;
    this.crewDialogueSpeakerEl.textContent = `${icon} ${speaker}`;
    this.crewDialogueTextEl.textContent = quote;
    this.crewDialogueEl.classList.toggle('michi', icon === '📸');
    this.crewDialogueEl.classList.add('visible');
    if (this.crewDialogueTimeout !== null) {
      window.clearTimeout(this.crewDialogueTimeout);
    }
    this.crewDialogueTimeout = window.setTimeout(() => {
      this.crewDialogueEl?.classList.remove('visible');
    }, durationMs);
  }

  public hideCrewDialogue(): void {
    if (this.crewDialogueTimeout !== null) {
      window.clearTimeout(this.crewDialogueTimeout);
      this.crewDialogueTimeout = null;
    }
    this.crewDialogueEl?.classList.remove('visible');
  }

  public updateCrewQuestPill(
    questState: 'idle' | 'active' | 'completed',
    npcId: 'sepp' | 'michi',
    collected: number,
    total: number
  ): void {
    if (!this.crewQuestPillEl || !this.crewQuestPillTextEl) return;
    const isActive = questState === 'active';
    this.crewQuestPillEl.classList.toggle('hidden', !isActive);
    this.crewQuestPillEl.classList.toggle('michi', npcId === 'michi');
    if (isActive) {
      const icon = npcId === 'sepp' ? '🦴' : '💾';
      this.crewQuestPillTextEl.textContent = `${icon} ${collected}/${total}`;
    }
  }

  public updateWantedStatus(state: {
    active: boolean;
    stars: number;
    inOutlawSpotlight: boolean;
    bustedProgress: number;
  }): void {
    if (!this.wantedBarEl || !this.wantedStarsEl) return;
    const show = state.active && state.stars > 0;
    this.wantedBarEl.classList.toggle('hidden', !show);
    if (!show) {
      this.lastWantedOutlawVisible = false;
      this.wantedOutlawEl?.classList.add('hidden');
      this.wantedBustedWrapEl?.classList.add('hidden');
      return;
    }

    const clampedStars = Math.max(0, Math.min(5, Math.round(state.stars)));
    this.wantedStarsEl.textContent = '★'.repeat(clampedStars) + '☆'.repeat(5 - clampedStars);

    this.lastWantedOutlawVisible = state.inOutlawSpotlight;
    if (this.wantedOutlawEl) {
      this.wantedOutlawEl.classList.toggle('hidden', !state.inOutlawSpotlight);
      if (state.inOutlawSpotlight) {
        const span = this.wantedOutlawEl.querySelector('span');
        if (span) span.textContent = t('wanted.outlawBadge');
      }
    }

    if (this.wantedBustedWrapEl && this.wantedBustedFillEl) {
      const showBusted = state.bustedProgress > 0.05;
      this.wantedBustedWrapEl.classList.toggle('hidden', !showBusted);
      if (showBusted) {
        this.wantedBustedFillEl.style.width = `${Math.min(100, Math.round(state.bustedProgress * 100))}%`;
      }
    }
  }

  public getCurrentOrBestComboScore(): number {
    const active = this.activeComboBase * this.comboMultiplier;
    return Math.max(this.bestCombo, active);
  }

  public updateHotSpotStatus(
    spotName: string | null,
    remainingSec: number,
    isInside: boolean
  ): void {
    if (!this.hotSpotPillEl || !this.hotSpotPillTextEl) return;
    if (!spotName || remainingSec <= 0) {
      this.hotSpotPillEl.classList.add('hidden');
      this.hotSpotPillEl.classList.remove('inside');
      return;
    }
    this.hotSpotPillEl.classList.remove('hidden');
    this.hotSpotPillEl.classList.toggle('inside', isInside);
    const sec = Math.ceil(remainingSec);
    this.hotSpotPillTextEl.textContent = isInside
      ? t('hud.hotSpotInside', { spot: spotName, sec })
      : t('hud.hotSpotOutside', { spot: spotName, sec });
  }

  public updateMissionsWidget(rank: SkaterRankInfo, missions: SurfMission[]): void {
    this.lastMissionsState = { rank, missions };
    if (this.hudRankLabelEl) {
      this.hudRankLabelEl.textContent = rank.fullLabel;
    }
    if (this.dockRankTitleEl) {
      this.dockRankTitleEl.textContent = t('hud.surfChallengesRank', { rank: rank.fullLabel });
    }

    const doneText = t('common.done');
    const html = missions
      .map((m) => {
        const check = m.completed ? '☑️' : '⬜';
        const progStr = m.completed
          ? doneText
          : `${formatNum(m.progress)}/${formatNum(m.target)}${m.unit ? ' ' + m.unit : ''}`;
        return `
          <div class="hud-mission-item ${m.completed ? 'done' : ''}">
            <span>${check} ${m.shortTitle}</span>
            <span class="hud-mission-prog">${progStr}</span>
          </div>
        `.trim();
      })
      .join('');

    if (this.hudMissionsListEl) {
      this.hudMissionsListEl.innerHTML = html;
    }
    if (this.dockMissionsListEl) {
      this.dockMissionsListEl.innerHTML = html;
    }
  }

  public showMissionToast(text: string): void {
    if (!this.missionToastEl) return;
    this.missionToastEl.textContent = text;
    this.missionToastEl.classList.add('visible');
    if (this.missionToastTimeout !== null) {
      window.clearTimeout(this.missionToastTimeout);
    }
    this.missionToastTimeout = window.setTimeout(() => {
      this.missionToastEl?.classList.remove('visible');
    }, 3400);
  }

  public openSessionSummary(
    summary: SessionSummaryData,
    onRetry: () => void,
    onGarage: () => void,
    onOpenLeaderboard?: (park: LeaderboardPark) => void
  ): void {
    if (!this.summaryModalEl) return;
    this.summaryRetryCallback = onRetry;
    this.summaryGarageCallback = onGarage;
    this.summaryOpenLeaderboardCallback = onOpenLeaderboard ?? null;

    const parkId: ValidLeaderboardPark =
      summary.parkId === 'airport_skatepark' ? 'airport_skatepark' : 'im_gefilde';
    this.summaryCurrentScore = Math.max(0, Math.round(summary.score));
    this.summaryCurrentParkId = parkId;

    const iconEl = document.getElementById('summary-medal-icon');
    const titleEl = document.getElementById('summary-medal-title');
    const hsBadgeEl = document.getElementById('summary-highscore-badge');
    const scoreEl = document.getElementById('summary-final-score');
    const comboEl = document.getElementById('summary-best-combo');
    const pretzelsEl = document.getElementById('summary-pretzels');
    const nearMissEl = document.getElementById('summary-nearmiss-box');
    const rankEl = document.getElementById('summary-rank-label');
    const missionsListEl = document.getElementById('summary-missions-list');

    if (iconEl) iconEl.textContent = summary.medal.icon;
    if (titleEl) titleEl.textContent = summary.medal.label;
    if (hsBadgeEl) hsBadgeEl.classList.toggle('hidden', !summary.isNewHighScore);
    if (scoreEl) scoreEl.textContent = formatNum(summary.score);
    if (comboEl) comboEl.textContent = formatNum(summary.bestCombo);
    if (pretzelsEl) pretzelsEl.textContent = `🥨 ${summary.pretzels}/5`;
    if (nearMissEl) nearMissEl.textContent = summary.nearMissHint;
    if (rankEl) rankEl.textContent = summary.rank.fullLabel;

    if (missionsListEl) {
      const completeText = t('summary.missionComplete');
      missionsListEl.innerHTML = summary.missions
        .map((m) => {
          const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100));
          const check = m.completed ? '☑️' : '⬜';
          const progStr = m.completed
            ? completeText
            : `${formatNum(m.progress)} / ${formatNum(m.target)}${m.unit ? ' ' + m.unit : ''}`;
          return `
            <div class="summary-mission-card ${m.completed ? 'done' : ''}">
              <div class="summary-mission-top">
                <span>${check} ${m.title}</span>
                <span>${progStr}</span>
              </div>
              <div class="summary-mission-bar-bg">
                <div class="summary-mission-bar-fill" style="width:${pct}%"></div>
              </div>
            </div>
          `.trim();
        })
        .join('');
    }

    const savedName = getPlayerName();
    if (this.summaryPlayerInputEl) {
      this.summaryPlayerInputEl.value = savedName;
    }

    const token = ++this.summaryLbToken;
    this.summaryModalEl.classList.remove('hidden');

    if (savedName.length >= 2 && this.summaryCurrentScore > 0) {
      void this.submitAndRefreshSummaryLeaderboard(
        savedName,
        this.summaryCurrentScore,
        parkId,
        token
      );
    } else {
      this.setSummaryLbStatus(
        this.summaryCurrentScore > 0
          ? t('summary.lbEnterName')
          : t('summary.lbNeedScore'),
        ''
      );
      void this.refreshSummaryLeaderboard(parkId, savedName, token);
    }
  }

  private setSummaryLbStatus(text: string, variant: '' | 'success' | 'error'): void {
    if (!this.summaryLbStatusEl) return;
    this.summaryLbStatusEl.textContent = text;
    this.summaryLbStatusEl.className = variant ? `summary-lb-status ${variant}` : 'summary-lb-status';
  }

  private async handleSummaryScoreSubmit(): Promise<void> {
    if (!this.summaryPlayerInputEl) return;
    const cleanName = setPlayerName(this.summaryPlayerInputEl.value);
    this.summaryPlayerInputEl.value = cleanName;

    const landingInput = document.getElementById('landing-player-name') as HTMLInputElement | null;
    if (landingInput) {
      landingInput.value = cleanName;
    }

    if (cleanName.length < 2) {
      this.setSummaryLbStatus(t('summary.lbNameMinError'), 'error');
      this.summaryPlayerInputEl.focus();
      return;
    }
    if (this.summaryCurrentScore <= 0) {
      this.setSummaryLbStatus(t('summary.lbScoreMinError'), 'error');
      return;
    }

    const token = ++this.summaryLbToken;
    await this.submitAndRefreshSummaryLeaderboard(
      cleanName,
      this.summaryCurrentScore,
      this.summaryCurrentParkId,
      token
    );
  }

  private async submitAndRefreshSummaryLeaderboard(
    name: string,
    score: number,
    parkId: ValidLeaderboardPark,
    token: number
  ): Promise<void> {
    if (this.summarySubmitBtnEl) {
      this.summarySubmitBtnEl.disabled = true;
    }
    this.setSummaryLbStatus(t('summary.lbSaving'), '');

    const result = await submitScore(name, score, parkId);
    if (token !== this.summaryLbToken) return;

    if (this.summarySubmitBtnEl) {
      this.summarySubmitBtnEl.disabled = false;
    }

    if (!result.ok) {
      this.setSummaryLbStatus(result.error || t('summary.lbSaveFailed'), 'error');
      await this.refreshSummaryLeaderboard(parkId, name, token);
      return;
    }

    const rankText = result.rank !== null ? t('summary.lbRank', { rank: result.rank }) : t('summary.lbSaved');
    const bestText = formatNum(result.bestScore);
    const newBestTag = result.isNewBest ? t('summary.lbNewBest') : '';
    const sourceTag = result.source === 'local' ? t('summary.lbLocalTag') : '';
    this.setSummaryLbStatus(
      t('summary.lbBestLine', { rankText, bestText, newBestTag, sourceTag }),
      'success'
    );

    await this.refreshSummaryLeaderboard(parkId, result.name, token);
  }

  private async refreshSummaryLeaderboard(
    parkId: ValidLeaderboardPark,
    highlightName: string,
    token: number
  ): Promise<void> {
    if (!this.summaryLbListEl) return;
    const { entries } = await fetchLeaderboard(parkId, 5);
    if (token !== this.summaryLbToken) return;
    this.renderSummaryLeaderboardRows(entries, highlightName);
  }

  private renderSummaryLeaderboardRows(entries: LeaderboardEntry[], highlightName: string): void {
    if (!this.summaryLbListEl) return;
    this.summaryLbListEl.innerHTML = '';

    if (entries.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'summary-lb-status';
      emptyEl.textContent = t('summary.lbEmpty');
      this.summaryLbListEl.appendChild(emptyEl);
      return;
    }

    const target = highlightName.trim().toLowerCase();
    for (const entry of entries) {
      const row = document.createElement('div');
      const isMe = target.length >= 2 && entry.name.toLowerCase() === target;
      row.className = `summary-lb-row${isMe ? ' is-me' : ''}`;

      const rankEl = document.createElement('span');
      rankEl.className = 'summary-lb-row-rank';
      rankEl.textContent =
        entry.rank === 1
          ? '🥇'
          : entry.rank === 2
            ? '🥈'
            : entry.rank === 3
              ? '🥉'
              : `#${entry.rank}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'summary-lb-row-name';
      nameEl.textContent = entry.name;

      const scoreEl = document.createElement('span');
      scoreEl.className = 'summary-lb-row-score';
      scoreEl.textContent = entry.score.toLocaleString();

      row.append(rankEl, nameEl, scoreEl);
      this.summaryLbListEl.appendChild(row);
    }
  }

  public closeSessionSummary(): void {
    this.summaryModalEl?.classList.add('hidden');
  }

  public isSummaryModalOpen(): boolean {
    return Boolean(this.summaryModalEl && !this.summaryModalEl.classList.contains('hidden'));
  }

  public setControlMode(mode: DriveControlMode): void {
    this.controlMode = mode;
    if (this.btnControlsEl) {
      this.btnControlsEl.textContent =
        mode === 'arrows' ? t('dock.ctrlArrows') : t('dock.ctrlWasd');
      this.btnControlsEl.classList.toggle('active-auto', mode === 'wasd');
    }
    this.renderDockCheatSheet();
  }

  public renderDockCheatSheet(): void {
    if (this.tricksListEl) {
      const kbHtml =
        this.controlMode === 'arrows'
          ? `
          <div class="trick-row"><span class="key">C</span><span class="trick-name">Smart Surf Trick</span><span class="trick-how">${t('dock.trickSmart')}</span></div>
          <div class="trick-row"><span class="key">Q</span><span class="trick-name">Snap</span><span class="trick-how">${t('dock.trickSnap')}</span></div>
          <div class="trick-row"><span class="key">W</span><span class="trick-name">Layback</span><span class="trick-how">${t('dock.trickLayback')}</span></div>
          <div class="trick-row"><span class="key">A</span><span class="trick-name">Bertslide</span><span class="trick-how">${t('dock.trickBert')}</span></div>
          <div class="trick-row"><span class="key">S</span><span class="trick-name">FS Reverse 360</span><span class="trick-how">${t('dock.trickReverse')}</span></div>
          <div class="trick-row"><span class="key">␣</span> / <span class="key">I</span><span class="trick-name">Indy Grab</span><span class="trick-how">${t('dock.trickIndy')}</span></div>
        `.trim()
          : `
          <div class="trick-row"><span class="key">C</span><span class="trick-name">Smart Surf Trick</span><span class="trick-how">${t('dock.trickSmart')}</span></div>
          <div class="trick-row"><span class="key">O</span><span class="trick-name">Snap</span><span class="trick-how">${t('dock.trickSnap')}</span></div>
          <div class="trick-row"><span class="key">P</span><span class="trick-name">Layback</span><span class="trick-how">${t('dock.trickLayback')}</span></div>
          <div class="trick-row"><span class="key">K</span><span class="trick-name">Bertslide</span><span class="trick-how">${t('dock.trickBert')}</span></div>
          <div class="trick-row"><span class="key">L</span><span class="trick-name">FS Reverse 360</span><span class="trick-how">${t('dock.trickReverse')}</span></div>
          <div class="trick-row"><span class="key">␣</span> / <span class="key">I</span><span class="trick-name">Indy Grab</span><span class="trick-how">${t('dock.trickIndy')}</span></div>
        `.trim();

      const mobileHtml = `
        <div class="trick-row"><span class="key">OLLIE</span><span class="trick-name">Ollie (Air)</span><span class="trick-how">${t('dock.mobOllie')}</span></div>
        <div class="trick-row"><span class="key">HOLD OLLIE</span><span class="trick-name">Indy Grab (Air)</span><span class="trick-how">${t('dock.mobIndy')}</span></div>
        <div class="trick-row"><span class="key">TRICK</span><span class="trick-name">360 Spin / Flip (Air)</span><span class="trick-how">${t('dock.mobTrick')}</span></div>
        <div class="trick-row"><span class="key">◀ / ▶ + TRICK</span><span class="trick-name">Bert Slide (Wall)</span><span class="trick-how">${t('dock.mobBert')}</span></div>
        <div class="trick-row"><span class="key">TRICK (COPING)</span><span class="trick-name">Lip Trick / Stall</span><span class="trick-how">${t('dock.mobLip')}</span></div>
        <div class="trick-row"><span class="key">COMPRESS</span><span class="trick-name">Crouch &amp; Speed Pump</span><span class="trick-how">${t('dock.mobCompress')}</span></div>
      `.trim();

      this.tricksListEl.innerHTML = `
        <div id="dock-tricks-keyboard">${kbHtml}</div>
        <div id="dock-tricks-mobile">${mobileHtml}</div>
      `;
    }

    if (this.ridingListEl) {
      const kbHtml =
        this.controlMode === 'arrows'
          ? `
          <div class="ctrl-row"><span class="key">↑</span> ${t('dock.kbPush')}</div>
          <div class="ctrl-row"><span class="key">←</span><span class="key">→</span> ${t('dock.kbCarve')}</div>
          <div class="ctrl-row"><span class="key">↓</span> ${t('dock.kbBrake')}</div>
          <div class="ctrl-row"><span class="key">SHIFT</span> ${t('dock.kbCompress')}</div>
          <div class="ctrl-row"><span class="key">␣</span> ${t('dock.kbOllie')}</div>
          <div class="ctrl-row"><span class="key">1</span><span class="key">2</span><span class="key">3</span><span class="key">4/O</span> ${t('dock.kbCam')}</div>
          <div class="ctrl-row"><span class="key">Tab</span> ${t('dock.kbSwitchWasd')}</div>
          <div class="ctrl-row"><span class="key">M</span> ${t('dock.kbMusic')}</div>
        `.trim()
          : `
          <div class="ctrl-row"><span class="key">W</span> ${t('dock.kbPush')}</div>
          <div class="ctrl-row"><span class="key">A</span><span class="key">D</span> ${t('dock.kbCarve')}</div>
          <div class="ctrl-row"><span class="key">S</span> ${t('dock.kbBrake')}</div>
          <div class="ctrl-row"><span class="key">SHIFT</span> ${t('dock.kbCompress')}</div>
          <div class="ctrl-row"><span class="key">␣</span> ${t('dock.kbOllie')}</div>
          <div class="ctrl-row"><span class="key">1</span><span class="key">2</span><span class="key">3</span><span class="key">4/O</span> ${t('dock.kbCam')}</div>
          <div class="ctrl-row"><span class="key">Tab</span> ${t('dock.kbSwitchArrows')}</div>
          <div class="ctrl-row"><span class="key">M</span> ${t('dock.kbMusic')}</div>
        `.trim();

      const mobileHtml = `
        <div class="ctrl-row"><span class="key">◀</span><span class="key">▶</span> ${t('dock.mobRideCarve')}</div>
        <div class="ctrl-row"><span class="key">▲ PUMP</span> ${t('dock.mobRidePump')}</div>
        <div class="ctrl-row"><span class="key">▼ BRAKE</span> ${t('dock.mobRideBrake')}</div>
        <div class="ctrl-row"><span class="key">OLLIE</span> ${t('dock.mobRideOllie')}</div>
        <div class="ctrl-row"><span class="key">TRICK</span> ${t('dock.mobRideTrick')}</div>
        <div class="ctrl-row"><span class="key">COMPRESS</span> ${t('dock.mobRideCompress')}</div>
      `.trim();

      this.ridingListEl.innerHTML = `
        <div id="dock-riding-keyboard">${kbHtml}</div>
        <div id="dock-riding-mobile">${mobileHtml}</div>
      `;
    }
  }

  public updateButtons(
    aspect: AspectMode,
    atmosphere: AtmosphereMode,
    cameraStyle: CameraStyle,
    truckPreset: TruckFeelPreset,
    autoFlow: boolean,
    musicActive = true,
    trackLabel = '1/3'
  ): void {
    this.lastBtnState = {
      aspect,
      atmosphere,
      cameraStyle,
      truckPreset,
      autoFlow,
      musicActive,
      trackLabel,
    };
    this.btnAspectEl.textContent =
      aspect === '9:16' ? t('dock.aspectReel') : t('dock.aspectDesktop');
    this.btnAspectEl.classList.toggle('active-reel', aspect === '9:16');

    if (this.btnAtmosphereEl) {
      this.btnAtmosphereEl.textContent =
        atmosphere === 'golden_hour' ? t('dock.atmosphereGolden') : t('dock.atmosphereNight');
    }

    const camLabels: Record<CameraStyle, string> = {
      follow: t('dock.camFollow'),
      filmer: t('dock.camFilmer'),
      mural: t('dock.camMural'),
      orbit: t('dock.camOrbit'),
    };
    this.btnCameraEl.textContent = camLabels[cameraStyle];

    if (this.btnControlsEl) {
      this.btnControlsEl.textContent =
        this.controlMode === 'arrows' ? t('dock.ctrlArrows') : t('dock.ctrlWasd');
      this.btnControlsEl.classList.toggle('active-auto', this.controlMode === 'wasd');
    }

    const truckLabels: Record<TruckFeelPreset, string> = {
      smooth: t('dock.truckSmooth'),
      balanced: t('dock.truckBalanced'),
      snappy: t('dock.truckSnappy'),
    };
    this.btnTruckFeelEl.textContent = truckLabels[truckPreset];

    this.btnAutoFlowEl.textContent = autoFlow ? t('dock.autoShredOn') : t('dock.manualControl');
    this.btnAutoFlowEl.classList.toggle('active-auto', autoFlow);

    if (this.btnMusicEl) {
      this.btnMusicEl.textContent = musicActive
        ? t('dock.musicTrack', { track: trackLabel })
        : t('dock.musicOff');
      this.btnMusicEl.classList.toggle('active-auto', musicActive);
    }
  }

  public updateQualityButton(
    preset: 'auto' | 'high' | 'medium' | 'low',
    effective: 'high' | 'medium' | 'low'
  ): void {
    this.lastQualityState = { preset, effective };
    if (!this.btnQualityEl) return;
    const labels = {
      auto: t('dock.qualityAuto', { eff: effective.toUpperCase() }),
      high: t('dock.qualityHigh'),
      medium: t('dock.qualityMedium'),
      low: t('dock.qualityLow'),
    };
    this.btnQualityEl.textContent = labels[preset];
    this.btnQualityEl.classList.toggle('active-auto', preset === 'auto');
  }

  public updateTouchButton(enabled: boolean): void {
    this.lastTouchEnabled = enabled;
    if (!this.btnTouchEl) return;
    this.btnTouchEl.textContent = enabled ? t('dock.touchOn') : t('dock.touchOff');
    this.btnTouchEl.classList.toggle('active-auto', enabled);
  }

  public updateFullscreenState(isFs: boolean): void {
    this.lastIsFullscreen = isFs;
    if (this.btnFullscreenEl) {
      this.btnFullscreenEl.textContent = isFs ? t('dock.exitFullscreen') : t('dock.fullscreen');
      this.btnFullscreenEl.classList.toggle('active-auto', isFs);
    }
    if (this.btnHudFullscreenEl) {
      const enterIcon = this.btnHudFullscreenEl.querySelector<HTMLElement>('.fs-icon-enter');
      const exitIcon = this.btnHudFullscreenEl.querySelector<HTMLElement>('.fs-icon-exit');
      if (enterIcon && exitIcon) {
        enterIcon.style.display = isFs ? 'none' : 'block';
        exitIcon.style.display = isFs ? 'block' : 'none';
      }
      this.btnHudFullscreenEl.classList.toggle('active', isFs);
    }
  }

  public updateFPS(fps: number): void {
    if (!this.btnFpsEl) return;
    this.btnFpsEl.textContent = `📊 ${fps} FPS`;
    if (fps < 45) {
      this.btnFpsEl.style.color = '#ff4d4d';
    } else if (fps < 55) {
      this.btnFpsEl.style.color = '#f2cc26';
    } else {
      this.btnFpsEl.style.color = '#00d6c3';
    }
  }

  private renderCombo(): void {
    const totalCombo = this.activeComboBase * this.comboMultiplier;
    this.comboPointsEl.textContent = `${formatNum(this.activeComboBase)} × ${this.comboMultiplier} = ${formatNum(totalCombo)}`;
    this.comboStringEl.textContent = this.comboManeuvers.join('  +  ');
  }

  private bankCombo(): void {
    const landed = this.activeComboBase * this.comboMultiplier;
    this.totalScore += landed;
    if (landed > this.bestCombo) {
      this.bestCombo = landed;
    }
    this.scoreEl.textContent = formatNum(this.totalScore);
    this.bestComboEl.textContent = formatNum(this.bestCombo);

    this.activeComboBase = 0;
    this.comboMultiplier = 0;
    this.comboManeuvers = [];
    this.comboTimeout = 0;
    this.comboContainerEl.classList.remove('active');
  }
}
