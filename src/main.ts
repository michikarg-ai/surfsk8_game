import * as THREE from 'three';
import { ParkSurface } from './physics/ParkSurface';
import { InputState, SurfskateController } from './physics/SurfskateController';
import { SkaterVisuals } from './entities/SkaterVisuals';
import { ImGefildeScene, AtmosphereMode } from './world/ImGefildeScene';
import { CameraStyle, SurfCamera } from './camera/SurfCamera';
import { DriveControlMode, SurfHUD } from './ui/SurfHUD';
import { LandingPage, SkateparkLocation } from './ui/LandingPage';
import { TouchControls } from './ui/TouchControls';
import { FirstRunTutorial } from './ui/FirstRunTutorial';
import { SurfAudio } from './audio/SurfAudio';
import { PretzelCollectibles } from './world/PretzelCollectibles';
import { FlowLineChallenge } from './world/FlowLineChallenge';
import { AirportFlyover } from './world/AirportFlyover';
import { ScooterRiderNPC } from './world/ScooterRiderNPC';
import { HotSpotZone } from './world/HotSpotZone';
import { CrewParkId, ParkCrewEncounters } from './world/ParkCrewEncounters';
import { AfterHoursWanted, WantedParkId } from './world/AfterHoursWanted';
import { GameModeId, SurfProgression } from './progression/SurfProgression';
import { getBoardById } from './config/SurfBoards';
import { inject, track } from '@vercel/analytics';
import { applyDomTranslations, formatNum, onLangChange, t, TranslationKey } from './i18n/i18n';

// Initialize Vercel Web Analytics
inject();

export type GraphicsPreset = 'auto' | 'high' | 'medium' | 'low';
export type EffectiveQuality = 'high' | 'medium' | 'low';

class SurfskateMunichGame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private viewportContainer: HTMLElement;
  public parkSurface: ParkSurface;
  public controller: SurfskateController;
  public skaterVisuals: SkaterVisuals;
  public worldScene: ImGefildeScene;
  public surfCamera: SurfCamera;
  public hud: SurfHUD;
  public landingPage: LandingPage;
  public touchControls: TouchControls;
  public tutorial: FirstRunTutorial;
  private forceStartTutorialOnDropIn = false;
  public audio = new SurfAudio();
  public pretzels: PretzelCollectibles;
  public flowLine: FlowLineChallenge;
  public airportFlyover: AirportFlyover;
  public scooterRider: ScooterRiderNPC;
  public hotSpotZone: HotSpotZone;
  public parkCrew: ParkCrewEncounters;
  public afterHoursWanted: AfterHoursWanted;
  private inOutlawSpotlight = false;
  public progression: SurfProgression;
  public gameMode: GameModeId = 'jam';
  private summaryShownForSession = false;
  private pendingLockedBoardToast: string | null = null;

  public controlMode: DriveControlMode =
    (localStorage.getItem('surfsk8.controlMode') as DriveControlMode) || 'arrows';
  public keys = new Set<string>();
  private autoFlowEnabled = false;
  private lastTime = performance.now();
  private lastPumpEventSeq = 0;

  private graphicsPreset: GraphicsPreset =
    (localStorage.getItem('surfsk8.graphicsPreset') as GraphicsPreset) || 'auto';
  private effectiveQuality: EffectiveQuality = 'high';
  private frameTimes: number[] = [];
  private readonly fpsHistorySize = 60;
  private currentFps = 60;
  private fpsDisplayTimer = 0;
  private autoQualityCooldown = 3.5;
  private timeSinceLastQualityChange = 0;

  // SNAP slow-motion state (real seconds remaining)
  private slowMoTimer = 0;
  private readonly slowMoDuration = 1.2;
  private readonly slowMoScale = 0.22;

  // Jetwash Stunt cooldown & cinematic slow-mo pulse state (real seconds remaining)
  private jetwashCooldown = 0;
  private readonly jetwashCooldownDuration = 15.0;
  private jetwashSlowMoTimer = 0;
  private readonly jetwashSlowMoDuration = 0.35;
  private readonly jetwashSlowMoScale = 0.28;
  private crowdHypeQuoteIdx: Record<'sepp' | 'michi', number> = { sepp: 0, michi: 0 };

  // Exact LiDAR/DOP20 Waypoints around Skatepark "Im Gefilde" for Auto-Shred / Instagram Reel Filmer
  private readonly flowWaypoints = [
    new THREE.Vector2(7.6, -0.8), // Central "Fuck Scooters" Volcano Dome
    new THREE.Vector2(-5.5, -7.0), // NW Upper Spine Roller
    new THREE.Vector2(-6.0, -12.5), // NW Over-Vert Cradle Bowl
    new THREE.Vector2(-9.2, -0.5), // NW Lower Spine Roller
    new THREE.Vector2(0.8, 11.2), // South Clover Bowl Pocket
    new THREE.Vector2(11.6, 14.2), // South-East Deep Bowl Pocket
    new THREE.Vector2(16.2, 4.6), // East Sunset Palm-Tree Mural Wall
  ];
  private currentWaypointIdx = 0;

  constructor() {
    this.viewportContainer = document.getElementById('viewport-frame')!;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.tabIndex = 0;
    this.viewportContainer.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.parkSurface = new ParkSurface();
    this.controller = new SurfskateController(this.parkSurface);
    this.controller.onBail = (reason: string) => {
      this.audio.playBailSound();
      this.surfCamera.triggerBailShake(0.38, 0.24);
      this.hud.showBailBanner('WIPEOUT!');
      try {
        track('wipeout', { reason });
      } catch {}
    };
    this.worldScene = new ImGefildeScene(this.scene, this.renderer);
    this.skaterVisuals = new SkaterVisuals(this.scene);
    this.surfCamera = new SurfCamera(this.renderer.domElement);

    this.touchControls = new TouchControls({
      frameElement: this.viewportContainer,
      onPause: () => this.pauseGameAndOpenLanding(),
      getSurfTricksEligibility: () => ({
        canSnap: this.controller.snapWindow === 'READY',
        canBert: this.controller.canPerformBertSlide(),
        canLayback: this.controller.canPerformLayback(),
        canReverse: this.controller.canPerformReverse(),
      }),
    });
    if (TouchControls.isTouchDevice()) {
      document.body.classList.add('has-touch-controls');
    }

    this.hud = new SurfHUD({
      onToggleAspect: () => this.toggleAspectMode(),
      onToggleAtmosphere: () => this.toggleAtmosphereMode(),
      onCycleCamera: () => this.cycleCameraStyle(),
      onCycleTruckFeel: () => this.cycleTruckFeel(),
      onToggleAutoFlow: () => this.toggleAutoFlow(),
      onResetSession: () => this.resetSession(),
      onToggleMusic: () => this.toggleMusic(),
      onCycleQuality: () => this.cycleGraphicsQuality(),
      onToggleControlMode: () => this.toggleControlMode(),
      onToggleTouchControls: () => this.toggleTouchControls(),
      onToggleFullscreen: () => this.toggleFullscreen(),
    });
    this.hud.setControlMode(this.controlMode);
    this.hud.onSessionComplete = () => {
      this.showSessionSummaryModal();
    };
    this.progression = new SurfProgression();
    this.progression.onMissionCompleted = (mission) => {
      this.hud.showMissionToast(t('hud.missionCompleteToast', { title: mission.shortTitle }));
      this.syncProgressionUI();
    };
    this.progression.onRankUp = (newRank) => {
      this.hud.showMissionToast(t('hud.rankUpToast', { rank: newRank.fullLabel }));
      this.hud.showTrickBanner(t('hud.rankUpBanner', { title: newRank.title }), true);
      this.syncProgressionUI();
    };

    this.pretzels = new PretzelCollectibles(this.scene, this.hud, this.audio);
    this.flowLine = new FlowLineChallenge(this.scene, this.parkSurface, this.hud, this.audio);
    this.flowLine.onRecordingStateChange = () => {
      this.syncFlowRecorderUI();
    };
    (this.flowLine as unknown as {
      onLineCompleted?: (tier: number, elapsedSec: number, bonusPoints: number) => void;
    }).onLineCompleted = (tier: number) => {
      this.progression.onFlowLineCompleted();
      this.syncProgressionUI();
      if (this.gameMode === 'flow_cup' && tier < 2) {
        (this.flowLine as unknown as { setTier?: (t: 0 | 1 | 2) => void }).setTier?.(
          (tier + 1) as 0 | 1 | 2
        );
      }
    };

    this.hotSpotZone = new HotSpotZone(this.scene, this.parkSurface);
    this.hotSpotZone.onHotSpotActivated = (spot, durationSec) => {
      this.hud.showMissionToast(
        t('hud.hotSpotToast', { spot: spot.name, sec: Math.round(durationSec) })
      );
    };

    this.airportFlyover = new AirportFlyover(this.scene, this.audio);
    this.scooterRider = new ScooterRiderNPC(this.scene, this.parkSurface, this.hud, this.audio);
    this.landingPage = new LandingPage(
      this.parkSurface,
      () => {
        this.hud.setDockOpen(false);
        if (TouchControls.isTouchDevice() && !this.isFullscreen()) {
          this.toggleFullscreen();
        }
        this.gameMode = this.landingPage.getSelectedGameMode();
        this.controller.setSkaterStats(this.landingPage.getSelectedSkater().stats);
        const selectedBoard = this.landingPage.getSelectedUnlockedBoard();
        this.controller.setBoardSpec(selectedBoard);
        this.skaterVisuals.setBoardSpec(selectedBoard);
        this.resetSession();
        if (this.pendingLockedBoardToast) {
          this.hud.showMissionToast(this.pendingLockedBoardToast);
          this.pendingLockedBoardToast = null;
        }
        if (this.gameMode === 'flow_cup') {
          (this.flowLine as unknown as { setTier?: (t: 0 | 1 | 2) => void }).setTier?.(0);
          this.hud.showTrickBanner(t('hud.flowCupBanner'), true);
        }
        this.audio.resume();
        this.lastTime = performance.now();
        this.touchControls.setVisible(true);
        this.syncHUDButtons();
        this.focusGameSurface(true);
        if (this.forceStartTutorialOnDropIn || this.tutorial.shouldAutoOpenOnStart()) {
          this.forceStartTutorialOnDropIn = false;
          this.tutorial.open();
        }
        try {
          track('game_start', {
            skater: this.landingPage.getSelectedSkaterName(),
            board: selectedBoard.id,
            mode: this.gameMode,
          });
        } catch {}
      },
      (modelUrl, skater) => {
        void this.skaterVisuals.load(modelUrl);
        if (skater) {
          this.controller.setSkaterStats(skater.stats);
        }
      },
      (park) => {
        void this.switchPark(park);
      },
      (park) => {
        this.inspectPark(park);
      },
      (board) => {
        this.controller.setBoardSpec(board);
        this.skaterVisuals.setBoardSpec(board);
      }
    );
    this.landingPage.onLockedBoardFallback = (lockedBoard, activeBoard) => {
      this.pendingLockedBoardToast = t('board.lockedFallbackToast', {
        locked: lockedBoard.name,
        active: activeBoard.name,
      });
    };
    this.tutorial = new FirstRunTutorial({
      getControlMode: () => this.controlMode,
      isTouchDevice: () => this.touchControls.isEnabled,
      onStart: () => {
        this.controller.sessionTimerPaused = true;
        this.hud.sessionTimerPaused = true;
        this.hud.tutorialActive = true;
        document.body.classList.add('tutorial-active');
        if (!this.landingPage.isVisible) {
          this.touchControls.setVisible(true);
        }
      },
      onStepComplete: () => {
        this.audio.playManeuverChime();
      },
      onAllStepsComplete: () => {
        this.audio.playPretzelPickup(true);
      },
      onComplete: () => {
        this.controller.sessionTimerPaused = false;
        this.hud.sessionTimerPaused = false;
        this.hud.tutorialActive = false;
        document.body.classList.remove('tutorial-active');
      },
    });
    this.controller.setSkaterStats(this.landingPage.getSelectedSkater().stats);
    this.landingPage.onCycleQuality = () => this.cycleGraphicsQuality();
    this.landingPage.onToggleFullscreen = () => this.toggleFullscreen();
    this.landingPage.onToggleSound = () => this.toggleMusic();
    this.landingPage.onOpenTutorial = () => {
      if (this.landingPage.isVisible) {
        this.forceStartTutorialOnDropIn = true;
        this.landingPage.startGame();
      } else {
        this.tutorial.open();
      }
    };
    this.landingPage.onSelectGameMode = (mode) => {
      this.gameMode = mode;
    };
    this.gameMode = this.landingPage.getSelectedGameMode();
    const initialSpecialParkId = this.normalizeSpecialParkId(this.landingPage.getSelectedPark().id);
    this.parkCrew = new ParkCrewEncounters(this.scene, this.parkSurface, initialSpecialParkId);
    this.afterHoursWanted = new AfterHoursWanted(this.scene, this.parkSurface, initialSpecialParkId);
    this.afterHoursWanted.setNightMode(this.worldScene.mode === 'night');
    this.syncProgressionUI();
    const initialBoard = this.landingPage.getSelectedUnlockedBoard();
    this.controller.setBoardSpec(initialBoard);
    this.skaterVisuals.setBoardSpec(initialBoard);

    this.audio.onTrackChange = () => {
      this.syncHUDButtons();
    };

    this.applyEffectiveQuality();
    this.bindEvents();
    this.handleResize();
    this.syncHUDButtons();
    applyDomTranslations(document);
    onLangChange(() => {
      this.progression.refreshMissionTexts();
      this.syncProgressionUI();
      this.syncHUDButtons();
      this.syncFullscreenUI();
      this.tutorial.refresh();
    });
    this.initAssets();
  }

  private async initAssets(): Promise<void> {
    const loadingEl = document.getElementById('loading-overlay');
    try {
      const initialModel = this.landingPage.getSelectedSkaterModel();
      const initialPark = this.landingPage.getSelectedPark();
      await Promise.all([
        this.parkSurface.loadLidarGrid(initialPark.lidarUrl || 'models/im_gefilde_lidar.json', initialPark.id),
        this.worldScene.load(initialPark.id),
        this.skaterVisuals.load(initialModel),
        this.landingPage.load(),
      ]);
      if (initialPark.id === 'airport_skatepark') {
        this.controller.setSpawn(2.94, 11.32, -0.175);
      } else {
        this.controller.setSpawn(15.2, 4.2, 1.38);
      }
      (this.flowLine as unknown as { refreshSurfaceHeights: (parkId?: string) => void }).refreshSurfaceHeights(
        initialPark.id
      );
      this.hotSpotZone.setPark(initialPark.id);
      const normParkId = this.normalizeSpecialParkId(initialPark.id);
      this.parkCrew.setPark(normParkId, this.parkSurface);
      this.afterHoursWanted.setPark(normParkId, this.parkSurface);
      this.afterHoursWanted.setNightMode(this.worldScene.mode === 'night');
    } catch (err) {
      console.error('Error loading GLB/LiDAR assets:', err);
    }
    if (loadingEl) {
      loadingEl.classList.add('hidden');
    }
    this.controller.resetToSpawn();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.animate(t));

    if (new URLSearchParams(window.location.search).get('play') === '1') {
      this.landingPage.startGame();
    } else {
      this.landingPage.maybeShowFirstLaunchNamePrompt();
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.updateAppDimensions());
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.updateAppDimensions());
      window.visualViewport.addEventListener('scroll', () => this.updateAppDimensions());
    }
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.updateAppDimensions(), 100);
      setTimeout(() => this.updateAppDimensions(), 300);
    });
    const handleFsChange = () => this.handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    window.addEventListener('fullscreenchange', handleFsChange);
    window.addEventListener('webkitfullscreenchange', handleFsChange);
    window.addEventListener('blur', () => this.keys.clear());
    new ResizeObserver(() => this.updateAppDimensions()).observe(this.viewportContainer);
    window.addEventListener('pointerdown', () => this.audio.initOnFirstGesture(), { once: true });

    const focusCanvasOnPointer = () => this.focusGameSurface(true);
    this.renderer.domElement.addEventListener('pointerdown', focusCanvasOnPointer, { passive: true });
    this.renderer.domElement.addEventListener('mousedown', focusCanvasOnPointer, { passive: true });

    const focusViewportOnPointer = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], button, a, label')) {
        return;
      }
      this.focusGameSurface(true);
    };
    this.viewportContainer.addEventListener('pointerdown', focusViewportOnPointer, { passive: true });
    this.viewportContainer.addEventListener('mousedown', focusViewportOnPointer, { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.audio.handleVisibilityChange(!document.hidden);
    });

    const hudGarageBtn = document.getElementById('btn-hud-garage');
    if (hudGarageBtn) {
      hudGarageBtn.addEventListener('click', () => {
        this.pauseGameAndOpenLanding();
      });
    }
    const dockGarageBtn = document.getElementById('btn-garage');
    if (dockGarageBtn) {
      dockGarageBtn.addEventListener('click', () => {
        this.pauseGameAndOpenLanding();
      });
    }

    const btnFlowRec = document.getElementById('btn-flow-recorder');
    if (btnFlowRec) {
      btnFlowRec.addEventListener('click', () => {
        this.toggleFlowLineRecording();
      });
    }
    const pillDevRec = document.getElementById('hud-dev-recorder-pill');
    if (pillDevRec) {
      pillDevRec.addEventListener('click', () => {
        if (
          !this.flowLine.isRecording &&
          this.flowLine.getRecordedPointsCount() >= 3 &&
          !this.flowLine.isExportModalOpen()
        ) {
          this.flowLine.reopenExportModal();
        } else {
          this.toggleFlowLineRecording();
        }
      });
    }
    const dockFlowRec = document.getElementById('btn-dock-flow-rec');
    if (dockFlowRec) {
      dockFlowRec.addEventListener('click', () => {
        this.toggleFlowLineRecording();
      });
    }

    const crewInteractBtn = document.getElementById('hud-crew-interact');
    if (crewInteractBtn) {
      crewInteractBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.triggerCrewInteract();
      });
    }

    // Help & Controls Modal (#help-modal)
    const btnHudHelp = document.getElementById('btn-hud-help');
    const btnLandingHelp = document.getElementById('landing-help-btn');
    const helpCloseBtn = document.getElementById('help-modal-close');
    const helpBackdrop = document.getElementById('help-modal-backdrop');
    const helpOkBtn = document.getElementById('help-modal-ok-btn');
    const helpTutorialBtn = document.getElementById('help-replay-tutorial-btn');
    const tabMobile = document.getElementById('help-tab-mobile');
    const tabKeyboard = document.getElementById('help-tab-keyboard');

    if (btnHudHelp) btnHudHelp.addEventListener('click', () => this.openHelpModal());
    if (btnLandingHelp) btnLandingHelp.addEventListener('click', () => this.openHelpModal());
    if (helpCloseBtn) helpCloseBtn.addEventListener('click', () => this.closeHelpModal());
    if (helpBackdrop) helpBackdrop.addEventListener('click', () => this.closeHelpModal());
    if (helpOkBtn) helpOkBtn.addEventListener('click', () => this.closeHelpModal());
    if (helpTutorialBtn) {
      helpTutorialBtn.addEventListener('click', () => {
        this.closeHelpModal();
        this.keys.clear();
        if (this.landingPage.isVisible) {
          this.forceStartTutorialOnDropIn = true;
          this.landingPage.startGame();
        } else {
          this.tutorial.open();
        }
      });
    }
    if (tabMobile) tabMobile.addEventListener('click', () => this.switchHelpTab('mobile'));
    if (tabKeyboard) tabKeyboard.addEventListener('click', () => this.switchHelpTab('keyboard'));

    window.addEventListener(
      'keydown',
      (e) => {
        const isTextInput = (el: HTMLElement | null): boolean => {
          const tag = el?.tagName;
          return (
            tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            tag === 'SELECT' ||
            Boolean(el?.isContentEditable)
          );
        };
        const activeEl = document.activeElement as HTMLElement | null;
        const targetEl = e.target as HTMLElement | null;
        if (isTextInput(activeEl) || isTextInput(targetEl)) {
          return;
        }

        const code = e.code;
        const isScrollableModalOpen = this.isScrollableModalOpen();
        const isNavOrActionKey =
          code === 'ArrowUp' ||
          code === 'ArrowDown' ||
          code === 'ArrowLeft' ||
          code === 'ArrowRight' ||
          code === 'Space' ||
          e.key === ' ';
        const isInGameScrollKey =
          !this.landingPage.isVisible && (code === 'PageUp' || code === 'PageDown');

        if (!isScrollableModalOpen && (isNavOrActionKey || isInGameScrollKey)) {
          e.preventDefault();
        }

        this.audio.initOnFirstGesture();

        if (e.key === '?' || (e.shiftKey && code === 'Slash')) {
          e.preventDefault();
          const helpModal = document.getElementById('help-modal');
          if (helpModal && !helpModal.classList.contains('hidden')) {
            this.closeHelpModal();
          } else {
            this.openHelpModal();
          }
          return;
        }

        if (this.landingPage.isVisible) {
          if (code === 'Escape') {
            const helpModal = document.getElementById('help-modal');
            if (helpModal && !helpModal.classList.contains('hidden')) {
              e.preventDefault();
              this.closeHelpModal();
              return;
            }
            this.landingPage.handleKeyDown(code);
            return;
          }
          if (isScrollableModalOpen || this.landingPage.isNamePromptModalOpen()) {
            return;
          }
          if (code === 'Enter' || code === 'NumpadEnter') {
            e.preventDefault();
            this.landingPage.startGame();
          } else if (
            code === 'Space' ||
            code === 'ArrowUp' ||
            code === 'ArrowDown' ||
            code === 'ArrowLeft' ||
            code === 'ArrowRight' ||
            code === 'KeyW' ||
            code === 'KeyS' ||
            code === 'KeyA' ||
            code === 'KeyD'
          ) {
            e.preventDefault();
            this.landingPage.handleKeyDown(code);
          } else if (code === 'Tab') {
            e.preventDefault();
            this.toggleControlMode();
          } else if (code === 'KeyF') {
            this.toggleFullscreen();
          } else if (code === 'KeyR') {
            this.toggleAspectMode();
          } else if (code === 'KeyM') {
            this.toggleMusic();
          } else if (code === 'KeyU' || code === 'KeyQ') {
            this.cycleGraphicsQuality();
          }
          return;
        }

        if (this.landingPage.isLeaderboardModalOpen()) {
          if (code === 'Escape') {
            e.preventDefault();
            this.landingPage.closeLeaderboardModal();
          }
          return;
        }

        if (this.hud.isSummaryModalOpen()) {
          if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
            e.preventDefault();
            this.hud.closeSessionSummary();
            window.setTimeout(() => this.resetSession(), 80);
            return;
          }
          if (code === 'Escape') {
            e.preventDefault();
            this.hud.closeSessionSummary();
            this.pauseGameAndOpenLanding();
            return;
          }
          return;
        }

        if (code === 'Escape') {
          const helpModal = document.getElementById('help-modal');
          if (helpModal && !helpModal.classList.contains('hidden')) {
            this.closeHelpModal();
            return;
          }
          if (this.flowLine.isExportModalOpen()) {
            this.flowLine.closeExportModal();
            return;
          }
          if (this.tutorial.isOpen() && this.tutorial.handleKeyDown(e)) {
            e.preventDefault();
            return;
          }
          this.pauseGameAndOpenLanding();
          return;
        }

        if (code === 'KeyL') {
          const activeTag = document.activeElement?.tagName.toLowerCase();
          if (activeTag !== 'input' && activeTag !== 'textarea') {
            if (
              this.controlMode === 'arrows' ||
              e.shiftKey ||
              this.flowLine.isRecording ||
              this.controller.speed < 2.0
            ) {
              e.preventDefault();
              this.toggleFlowLineRecording();
              return;
            }
          }
        }

        this.keys.add(code);

        if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'ArrowUp'].includes(code)) {
          if (this.autoFlowEnabled) {
            this.autoFlowEnabled = false;
            this.syncHUDButtons();
          }
        }

        if (code === 'Tab') {
          e.preventDefault();
          this.toggleControlMode();
        } else if (code === 'Digit1' || code === 'Numpad1') {
          this.setCameraStyle('follow');
        } else if (code === 'Digit2' || code === 'Numpad2') {
          this.setCameraStyle('filmer');
        } else if (code === 'Digit3' || code === 'Numpad3') {
          this.setCameraStyle('mural');
        } else if (code === 'Digit4' || code === 'Numpad4' || code === 'KeyO') {
          this.setCameraStyle(this.surfCamera.cameraStyle === 'orbit' ? 'follow' : 'orbit');
        } else if (code === 'KeyR') {
          this.toggleAspectMode();
        } else if (code === 'KeyT') {
          this.cycleTruckFeel();
        } else if (code === 'KeyJ') {
          this.toggleAutoFlow();
        } else if (code === 'KeyM') {
          this.toggleMusic();
        } else if (code === 'KeyN') {
          this.nextTrack();
        } else if (code === 'KeyU') {
          this.cycleGraphicsQuality();
        } else if (code === 'KeyF' && this.controlMode === 'arrows') {
          this.toggleFullscreen();
        } else if (code === 'KeyE') {
          const helpModal = document.getElementById('help-modal');
          const helpOpen = Boolean(helpModal && !helpModal.classList.contains('hidden'));
          if (!helpOpen && !this.flowLine.isExportModalOpen()) {
            if (this.triggerCrewInteract()) {
              e.preventDefault();
            }
          }
        } else if (code === 'Backspace' || code === 'KeyX') {
          this.resetSession();
        }
      },
      { capture: true, passive: false }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        this.keys.delete(e.code);
      },
      { capture: true }
    );
  }

  private userSelectedAspect = false;

  public toggleAspectMode(): void {
    this.userSelectedAspect = true;
    this.surfCamera.aspectMode = this.surfCamera.aspectMode === '16:9' ? '9:16' : '16:9';
    document.body.classList.toggle('reel-mode', this.surfCamera.aspectMode === '9:16');
    this.handleResize();
    this.syncHUDButtons();
  }

  private normalizeSpecialParkId(parkId: string): CrewParkId & WantedParkId {
    return parkId === 'airport_skatepark' ? 'airport_skatepark' : 'im_gefilde';
  }

  public triggerCrewInteract(): boolean {
    const helpModal = document.getElementById('help-modal');
    const helpOpen = Boolean(helpModal && !helpModal.classList.contains('hidden'));
    if (
      this.landingPage.isVisible ||
      this.tutorial.isOpen() ||
      this.hud.isSummaryModalOpen() ||
      helpOpen ||
      this.flowLine.isExportModalOpen()
    ) {
      return false;
    }

    const res = this.parkCrew.interact();
    if (!res) return false;

    this.audio.playManeuverChime();
    const npcName = t(`crew.${res.npcId}.name` as TranslationKey);
    const npcIcon = res.npcId === 'sepp' ? '👴' : '📸';
    const quoteKey =
      res.action === 'started'
        ? `crew.${res.npcId}.dialogueStarted`
        : res.action === 'reminder'
          ? `crew.${res.npcId}.dialogueReminder`
          : `crew.${res.npcId}.dialogueCompletedChat`;

    this.hud.showCrewDialogue(
      npcIcon,
      npcName,
      t(quoteKey as TranslationKey, { collected: res.collected, total: res.total })
    );
    if (res.action === 'started') {
      this.hud.updateCrewQuestPill('active', res.npcId, res.collected, res.total);
    }
    return true;
  }

  private announceWantedStar(star: number): void {
    const clamped = Math.max(1, Math.min(5, Math.round(star)));
    this.hud.showMissionToast(t(`wanted.star${clamped}Toast` as TranslationKey));
  }

  public toggleAtmosphereMode(): void {
    this.worldScene.toggleAtmosphere();
    this.setAtmosphereMode(this.worldScene.mode);
  }

  public setAtmosphereMode(mode: AtmosphereMode): void {
    if (this.worldScene.mode !== mode) {
      this.worldScene.setAtmosphereMode(mode);
    }
    const { escapedViaDaylight } = this.afterHoursWanted.setNightMode(mode === 'night');
    if (escapedViaDaylight) {
      this.inOutlawSpotlight = false;
      this.hud.awardBonusPoints(1000, t('wanted.daylightEscapeBanner'));
      this.hud.showMissionToast(t('wanted.daylightEscapeToast'));
      this.audio.playPretzelPickup(true);
    }
    this.hud.updateWantedStatus({
      active: mode === 'night',
      stars: 0,
      inOutlawSpotlight: false,
      bustedProgress: 0,
    });
    this.syncHUDButtons();
  }

  private isScrollableModalOpen(): boolean {
    const isVisible = (id: string): boolean => {
      const el = document.getElementById(id);
      return Boolean(el && !el.classList.contains('hidden'));
    };
    return (
      isVisible('leaderboard-modal') ||
      isVisible('help-modal') ||
      isVisible('terms-modal') ||
      this.hud.isSummaryModalOpen()
    );
  }

  private focusGameSurface(blurButtons = false): void {
    const activeEl = document.activeElement as HTMLElement | null;
    const tag = activeEl?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable) {
      return;
    }
    if (blurButtons && activeEl instanceof HTMLButtonElement) {
      activeEl.blur();
    }
    try {
      window.focus();
    } catch {}
    if (!this.landingPage.isVisible && !this.isScrollableModalOpen()) {
      try {
        this.renderer.domElement.focus({ preventScroll: true });
      } catch {}
    }
  }

  private handleFullscreenChange(): void {
    this.keys.clear();
    this.syncFullscreenUI();
    this.focusGameSurface(true);
    window.setTimeout(() => this.focusGameSurface(true), 100);
  }

  public toggleFullscreen(): void {
    const doc = document as any;
    const docEl = document.documentElement as any;
    const refocus = () => {
      this.focusGameSurface(true);
      window.setTimeout(() => this.focusGameSurface(true), 100);
    };
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (docEl.requestFullscreen) {
        docEl
          .requestFullscreen()
          .then(refocus)
          .catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
        refocus();
      }
    } else {
      if (doc.exitFullscreen) {
        doc
          .exitFullscreen()
          .then(refocus)
          .catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
        refocus();
      }
    }
  }

  public isFullscreen(): boolean {
    const doc = document as any;
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  }

  public syncFullscreenUI(): void {
    const isFs = this.isFullscreen();
    document.body.classList.toggle('is-fullscreen', isFs);
    this.hud.updateFullscreenState(isFs);
    if (this.landingPage) {
      this.landingPage.updateFullscreenLabel(isFs);
    }
    this.updateAppDimensions();
  }

  public updateAppDimensions(): void {
    const vvHeight = window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight;
    const h = Math.min(window.innerHeight, vvHeight);
    document.documentElement.style.setProperty('--app-height', `${h}px`);
    this.handleResize();
  }

  public setCameraStyle(style: CameraStyle): void {
    this.surfCamera.setCameraStyle(style, this.controller.position);
    this.syncHUDButtons();
  }

  public cycleCameraStyle(): void {
    this.surfCamera.cycleCameraStyle(this.controller.position);
    this.syncHUDButtons();
  }

  public async switchPark(park: SkateparkLocation): Promise<void> {
    try {
      await Promise.all([
        this.worldScene.load(park.id),
        this.parkSurface.loadLidarGrid(park.lidarUrl || 'models/im_gefilde_lidar.json', park.id),
      ]);
      (this.flowLine as unknown as { refreshSurfaceHeights: (parkId?: string) => void }).refreshSurfaceHeights(
        park.id
      );
      this.hotSpotZone.setPark(park.id);
      const normParkId = this.normalizeSpecialParkId(park.id);
      this.parkCrew.setPark(normParkId, this.parkSurface);
      this.afterHoursWanted.setPark(normParkId, this.parkSurface);
      this.afterHoursWanted.setNightMode(this.worldScene.mode === 'night');
      this.inOutlawSpotlight = false;
      this.hud.updateCrewInteract(false, normParkId === 'airport_skatepark' ? 'michi' : 'sepp', false);
      this.hud.hideCrewDialogue();
      this.hud.updateCrewQuestPill('idle', normParkId === 'airport_skatepark' ? 'michi' : 'sepp', 0, 4);
      this.hud.updateWantedStatus({
        active: this.worldScene.mode === 'night',
        stars: 0,
        inOutlawSpotlight: false,
        bustedProgress: 0,
      });
      if (park.id === 'airport_skatepark') {
        this.controller.setSpawn(2.94, 11.32, -0.175);
      } else {
        this.controller.setSpawn(15.2, 4.2, 1.38);
      }
      this.controller.resetToSpawn();
      this.surfCamera.reset(this.controller);
      this.scooterRider.reset();
      this.jetwashCooldown = 0;
      this.jetwashSlowMoTimer = 0;
    } catch (e) {
      console.error('Error switching skatepark:', e);
    }
  }

  public inspectPark(_park?: SkateparkLocation): void {
    this.landingPage.isVisible = false;
    document.getElementById('landing-overlay')?.classList.add('hidden');
    this.setCameraStyle('orbit');
    this.hud.setDockOpen(true);
  }

  public toggleControlMode(): void {
    this.setControlMode(this.controlMode === 'arrows' ? 'wasd' : 'arrows');
  }

  public setControlMode(mode: DriveControlMode): void {
    this.controlMode = mode;
    localStorage.setItem('surfsk8.controlMode', mode);
    this.hud.setControlMode(mode);
    this.syncHUDButtons();
    this.tutorial?.refresh();
  }

  public cycleTruckFeel(): void {
    this.controller.cycleTruckPreset();
    this.syncHUDButtons();
  }

  public toggleAutoFlow(): void {
    this.autoFlowEnabled = !this.autoFlowEnabled;
    this.syncHUDButtons();
  }

  public toggleMusic(): void {
    this.audio.toggleMusic();
    this.syncHUDButtons();
  }

  public nextTrack(): void {
    this.audio.playNextTrack();
    this.syncHUDButtons();
  }

  public toggleTouchControls(): void {
    this.touchControls.toggleEnabled();
    this.syncHUDButtons();
    this.tutorial?.refresh();
  }

  public openHelpModal(forceTab?: 'mobile' | 'keyboard'): void {
    this.landingPage?.closeSettingsPopover();
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    const isTouch = forceTab ? forceTab === 'mobile' : this.touchControls.isTouchActive();
    this.switchHelpTab(isTouch ? 'mobile' : 'keyboard');
    modal.classList.remove('hidden');
  }

  public closeHelpModal(): void {
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  public switchHelpTab(tab: 'mobile' | 'keyboard'): void {
    const secMobile = document.getElementById('help-controls-mobile');
    const secKeyboard = document.getElementById('help-controls-keyboard');
    const tabMobile = document.getElementById('help-tab-mobile');
    const tabKeyboard = document.getElementById('help-tab-keyboard');

    if (secMobile && secKeyboard) {
      secMobile.classList.toggle('active', tab === 'mobile');
      secKeyboard.classList.toggle('active', tab === 'keyboard');
    }
    if (tabMobile && tabKeyboard) {
      tabMobile.classList.toggle('active', tab === 'mobile');
      tabKeyboard.classList.toggle('active', tab === 'keyboard');
    }
  }

  public pauseGameAndOpenLanding(): void {
    if (this.landingPage.isVisible) return;
    if (this.tutorial.isOpen()) {
      this.tutorial.abort();
    }
    this.hud.closeSessionSummary();
    this.keys.clear();
    this.touchControls.setVisible(false);
    this.hud.updateCrewInteract(false, 'sepp', false);
    this.hud.hideCrewDialogue();
    this.audio.stopSurfskateAudio();
    this.audio.pause();
    this.audio.playGarageMusic();
    this.slowMoTimer = 0;
    this.jetwashSlowMoTimer = 0;
    this.progression.recordSessionScore(this.hud.totalScore);
    this.syncProgressionUI();
    this.syncHUDButtons();
    this.landingPage.show();
  }

  public cycleGraphicsQuality(): void {
    const cycle: GraphicsPreset[] = ['auto', 'high', 'medium', 'low'];
    const idx = cycle.indexOf(this.graphicsPreset);
    const next = cycle[(idx + 1) % cycle.length];
    this.setGraphicsPreset(next);
  }

  public setGraphicsPreset(preset: GraphicsPreset): void {
    this.graphicsPreset = preset;
    localStorage.setItem('surfsk8.graphicsPreset', preset);
    if (preset !== 'auto') {
      this.effectiveQuality = preset;
    }
    this.applyEffectiveQuality();
    this.syncHUDButtons();
  }

  private applyEffectiveQuality(): void {
    const q = this.effectiveQuality;
    const dpr = window.devicePixelRatio || 1;
    const targetPixelRatio =
      q === 'high' ? Math.min(dpr, 1.5) : q === 'medium' ? Math.min(dpr, 1.0) : Math.min(dpr, 0.85);

    this.renderer.setPixelRatio(targetPixelRatio);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;

    this.worldScene.setQuality(q);
    this.skaterVisuals.setQuality(q);
    if (this.landingPage) {
      this.landingPage.setQuality(q);
    }
    this.handleResize();
  }

  public resetSession(): void {
    this.summaryShownForSession = false;
    const isZen = this.gameMode === 'zen';
    (this.controller as unknown as { endlessMode?: boolean }).endlessMode = isZen;
    (this.controller as unknown as { hotSpotMultiplier?: number }).hotSpotMultiplier = 1.0;
    this.hud.endlessMode = isZen;
    this.hotSpotZone.setEnabled(this.gameMode === 'jam');
    this.hotSpotZone.reset();
    this.progression.recordSessionScore(this.hud.totalScore);
    this.progression.resetSessionCounters();
    this.controller.resetToSpawn();
    this.lastPumpEventSeq = this.controller.pumpEventSeq;
    this.surfCamera.reset(this.controller);
    this.hud.resetSession();
    this.controller.sessionTimerPaused = this.tutorial.isOpen();
    this.hud.sessionTimerPaused = this.tutorial.isOpen();
    this.hud.tutorialActive = this.tutorial.isOpen();
    this.pretzels.reset();
    this.flowLine.reset();
    this.parkCrew.resetSession();
    this.afterHoursWanted.resetSession();
    this.afterHoursWanted.setNightMode(this.worldScene.mode === 'night');
    this.inOutlawSpotlight = false;
    this.jetwashCooldown = 0;
    this.jetwashSlowMoTimer = 0;
    this.syncProgressionUI();
    this.syncFlowRecorderUI();
  }

  public syncProgressionUI(): void {
    const rank = this.progression.getRankInfo();
    const missions = this.progression.missions;
    this.hud.updateMissionsWidget(rank, missions);
    if (this.landingPage) {
      this.landingPage.updateProgressionDisplay(rank, missions);
      const newlyUnlocked = this.landingPage.refreshBoardUnlocks(
        this.progression.getBoardUnlockProgress()
      );
      if (newlyUnlocked.length > 0 && !this.landingPage.isVisible) {
        const unlockedBoard = getBoardById(newlyUnlocked[0]);
        this.hud.showMissionToast(t('board.unlockedToast', { board: unlockedBoard.name }));
      }
    }
  }

  private isOvertimeWait(): boolean {
    if (this.controller.isBailing) return false;
    return (
      this.hud.comboMultiplier > 0 ||
      this.hud.comboTimeout > 0 ||
      !this.controller.isGrounded ||
      this.controller.isGrinding ||
      Boolean((this.controller as unknown as { sessionOvertime?: boolean }).sessionOvertime)
    );
  }

  private showSessionSummaryModal(): void {
    if (this.summaryShownForSession || this.hud.endlessMode) return;
    this.summaryShownForSession = true;
    this.keys.clear();
    const activeParkId =
      this.landingPage.getSelectedPark().id === 'airport_skatepark'
        ? 'airport_skatepark'
        : 'im_gefilde';
    const summary = this.progression.getSessionSummary(
      activeParkId,
      this.hud.totalScore,
      this.hud.bestCombo,
      this.pretzels.collectedCount
    );
    this.syncProgressionUI();
    this.hud.openSessionSummary(
      summary,
      () => {
        window.setTimeout(() => this.resetSession(), 80);
      },
      () => {
        this.pauseGameAndOpenLanding();
      },
      (park) => {
        this.landingPage.openLeaderboardModal(park);
      }
    );
  }

  public toggleFlowLineRecording(): void {
    this.flowLine.toggleRecording(this.controller.position);
    this.syncFlowRecorderUI();
  }

  public syncFlowRecorderUI(): void {
    const isDev = new URLSearchParams(window.location.search).get('dev') === '1';
    const isRec = this.flowLine.isRecording;
    const pts = this.flowLine.getRecordedPointsCount();
    const hasRecorded = pts >= 3;
    const showDevButtons = isDev || isRec || hasRecorded;

    const pill = document.getElementById('hud-dev-recorder-pill');
    const pillText = document.getElementById('hud-dev-recorder-pill-text');
    const btnRec = document.getElementById('btn-flow-recorder');
    const btnLabel = document.getElementById('btn-flow-recorder-label');
    const dockRec = document.getElementById('btn-dock-flow-rec');

    if (pill && pillText) {
      if (isRec) {
        pill.classList.remove('hidden');
        pill.classList.add('is-recording');
        pillText.textContent = t('rec.pillActive', { pts });
      } else if (hasRecorded) {
        pill.classList.remove('hidden');
        pill.classList.remove('is-recording');
        pillText.textContent = t('rec.pillSaved', { pts });
      } else if (isDev) {
        pill.classList.remove('hidden');
        pill.classList.remove('is-recording');
        pillText.textContent = t('rec.pillIdle');
      } else {
        pill.classList.add('hidden');
        pill.classList.remove('is-recording');
      }
    }

    if (btnRec && btnLabel) {
      if (isRec) {
        btnRec.classList.remove('hidden');
        btnRec.classList.add('is-recording');
        btnLabel.textContent = t('rec.btnStop');
      } else if (showDevButtons) {
        btnRec.classList.remove('hidden');
        btnRec.classList.remove('is-recording');
        btnLabel.textContent = t('rec.btnStart');
      } else {
        btnRec.classList.add('hidden');
        btnRec.classList.remove('is-recording');
      }
    }

    if (dockRec) {
      dockRec.classList.toggle('hidden', !showDevButtons);
    }
  }

  private syncHUDButtons(): void {
    const { current, total } = this.audio.trackInfo;
    this.hud.updateButtons(
      this.surfCamera.aspectMode,
      this.worldScene.mode,
      this.surfCamera.cameraStyle,
      this.controller.truckPreset,
      this.autoFlowEnabled,
      this.audio.isMusicActive,
      `${current}/${total}`
    );
    this.hud.updateQualityButton(this.graphicsPreset, this.effectiveQuality);
    this.hud.updateTouchButton(this.touchControls.isEnabled);
    this.landingPage?.updateSoundLabel(this.audio.isMusicActive);
    this.syncFlowRecorderUI();
    const keyLabel = document.getElementById('hud-garage-key-label');
    if (keyLabel) {
      keyLabel.textContent = this.touchControls.isEnabled ? '⏸' : 'ESC';
    }
    document.body.classList.toggle(
      'has-touch-controls',
      this.touchControls.isEnabled && (this.touchControls.isVisible || TouchControls.isTouchDevice())
    );
    if (this.landingPage) {
      this.landingPage.updateQualityLabel(this.graphicsPreset, this.effectiveQuality);
    }
  }

  private handleResize(): void {
    const rect = this.viewportContainer.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(320, rect.height);

    if (!this.userSelectedAspect) {
      const isPortrait = window.innerWidth < window.innerHeight;
      this.surfCamera.aspectMode = isPortrait ? '9:16' : '16:9';
      document.body.classList.toggle('reel-mode', isPortrait);
    }

    this.renderer.setSize(w, h, false);
    this.surfCamera.setAspectRatio(w, h);
    if (this.landingPage) {
      this.landingPage.handleResize();
    }
  }

  public buildInputState(timeSec: number): InputState {
    const touch = this.touchControls.getState();

    // Any manual touch interaction immediately yields control from auto-flow
    if (
      touch.steerLeft ||
      touch.steerRight ||
      touch.forwardPush ||
      touch.jumpOllie ||
      (touch.analogSteer && Math.abs(touch.analogSteer) > 0.15)
    ) {
      if (this.autoFlowEnabled) {
        this.autoFlowEnabled = false;
        this.syncHUDButtons();
      }
    }

    if (this.autoFlowEnabled) {
      return this.computeAutoFlowInput(timeSec);
    }

    const isArrows = this.controlMode === 'arrows';
    const kbSteerLeft = isArrows ? this.keys.has('ArrowLeft') : this.keys.has('KeyA');
    const kbSteerRight = isArrows ? this.keys.has('ArrowRight') : this.keys.has('KeyD');
    const kbPush = isArrows ? this.keys.has('ArrowUp') : this.keys.has('KeyW');
    const kbCrouch = isArrows
      ? this.keys.has('ArrowDown') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      : this.keys.has('KeyS') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const kbOllie = this.keys.has('Space');
    const kbSnap = isArrows
      ? this.keys.has('KeyQ') || this.keys.has('KeyF')
      : this.keys.has('KeyO') || this.keys.has('KeyF');
    const kbLayback = isArrows
      ? this.keys.has('KeyW') || this.keys.has('KeyG')
      : this.keys.has('KeyP') || this.keys.has('KeyG');
    const kbSlide = isArrows
      ? this.keys.has('KeyA') || this.keys.has('KeyV')
      : this.keys.has('KeyK') || this.keys.has('KeyV');
    const kbReverse = isArrows
      ? this.keys.has('KeyS') || this.keys.has('KeyB')
      : this.keys.has('KeyL') || this.keys.has('KeyB');
    const kbIndy =
      this.keys.has('KeyI') || (!this.controller.isGrounded && this.keys.has('Space'));
    const kbContextTrick = this.keys.has('KeyC');
    const touchContextTrick = Boolean(
      touch.contextTrick ||
        touch.snapTrick ||
        touch.snapSlide ||
        touch.laybackTrick ||
        touch.reverseTrick
    );

    const analogSteer =
      touch.analogSteer !== undefined && Math.abs(touch.analogSteer) > 0.05
        ? touch.analogSteer
        : (kbSteerRight ? 1 : 0) - (kbSteerLeft ? 1 : 0);

    return {
      steerLeft: kbSteerLeft || touch.steerLeft,
      steerRight: kbSteerRight || touch.steerRight,
      forwardPush: kbPush || touch.forwardPush,
      compressCrouch: kbCrouch || touch.compressCrouch,
      jumpOllie: kbOllie || touch.jumpOllie,
      grindSlash: false,
      snapTrick: kbSnap,
      laybackTrick: kbLayback,
      snapSlide: kbSlide,
      reverseTrick: kbReverse,
      contextTrick: kbContextTrick || touchContextTrick,
      indyGrabTrick:
        kbIndy ||
        touch.indyGrabTrick ||
        (!this.controller.isGrounded && (kbOllie || touch.jumpOllie)),
      analogSteer,
    };
  }

  private computeAutoFlowInput(timeSec: number): InputState {
    const target = this.flowWaypoints[this.currentWaypointIdx];
    const dx = target.x - this.controller.position.x;
    const dz = target.y - this.controller.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 4.2) {
      this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.flowWaypoints.length;
    }

    const desiredHeading = Math.atan2(-dx, -dz);
    let angleDiff = desiredHeading - this.controller.heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Auto-shred pumps like a human: alternate ← → roughly every 0.48 s (perfect rhythm)
    const pumpDir = Math.sin((timeSec * Math.PI) / 0.48) > 0 ? 1 : -1;
    const combinedSteer = angleDiff * 0.8 + pumpDir * 0.5;

    const inDeepTransition = this.controller.currentSurface.height > 0.85;
    const compressWave = Math.sin(timeSec * 5.2 + Math.PI * 0.5) > 0.35;

    return {
      steerLeft: combinedSteer > 0.08,
      steerRight: combinedSteer < -0.08,
      forwardPush: this.controller.speed < 0.3,
      compressCrouch: compressWave && !inDeepTransition,
      jumpOllie: false,
      grindSlash: false,
      snapSlide: false,
      snapTrick: this.controller.snapWindow === 'READY',
      laybackTrick: false,
      reverseTrick: false,
      contextTrick: false,
      indyGrabTrick: !this.controller.isGrounded && this.controller.indyGrabReady,
    };
  }

  private isGameplayActive(): boolean {
    const helpModal = document.getElementById('help-modal');
    return (
      !this.tutorial.isOpen() &&
      !this.hud.isSummaryModalOpen() &&
      !(helpModal && !helpModal.classList.contains('hidden')) &&
      !this.flowLine.isExportModalOpen()
    );
  }

  private canTriggerJetwashStunt(activeParkId: string): boolean {
    if (
      activeParkId !== 'airport_skatepark' ||
      this.jetwashCooldown > 0 ||
      this.controller.isBailing ||
      !this.isGameplayActive()
    ) {
      return false;
    }
    const shadow = this.airportFlyover?.getShadowInfo();
    if (!shadow?.active) return false;
    const pos = this.controller.position;
    return Math.hypot(pos.x - shadow.x, pos.z - shadow.z) <= shadow.radius + 3.5;
  }

  private triggerJetwashStunt(): void {
    this.jetwashCooldown = this.jetwashCooldownDuration;
    this.jetwashSlowMoTimer = this.jetwashSlowMoDuration;
    this.airportFlyover.triggerJetwashPulse();
    if (this.surfCamera.cameraStyle !== 'orbit') {
      this.surfCamera.camera.fov = Math.min(92, this.surfCamera.camera.fov + 4.0);
      this.surfCamera.camera.updateProjectionMatrix();
    }
    this.surfCamera.triggerBailShake(0.22, 0.07);
    this.hud.addBonusScore(2000);
    this.progression.recordSessionScore(this.hud.totalScore);
    this.syncProgressionUI();
    this.hud.showTrickBanner(t('stunt.jetwashBanner'), true);
    this.audio.playPretzelPickup(true);
  }

  private animate(now: number): void {
    const realDt = Math.min((now - this.lastTime) * 0.001, 0.05);
    this.lastTime = now;
    const timeSec = now * 0.001;

    if (this.landingPage.isVisible) {
      this.audio.stopSurfskateAudio();
      this.landingPage.update(timeSec, realDt);
      requestAnimationFrame((t) => this.animate(t));
      return;
    }

    // SNAP slow motion: hold at slowMoScale, then ease back to real time over the last 0.4 s
    let timeScale = 1;
    if (this.slowMoTimer > 0) {
      this.slowMoTimer = Math.max(0, this.slowMoTimer - realDt);
      const easeOut = Math.min(1, this.slowMoTimer / 0.4);
      timeScale = this.slowMoScale + (1 - this.slowMoScale) * (1 - easeOut);
    }
    // Jetwash Stunt slow-motion pulse: dip to 0.28 and ease smoothly back to 1.0 over the last 0.10 s
    if (this.jetwashSlowMoTimer > 0) {
      this.jetwashSlowMoTimer = Math.max(0, this.jetwashSlowMoTimer - realDt);
      const easeOut = Math.min(1, this.jetwashSlowMoTimer / 0.10);
      const jetwashScale = this.jetwashSlowMoScale + (1 - this.jetwashSlowMoScale) * (1 - easeOut);
      timeScale = Math.min(timeScale, jetwashScale);
    }
    const dt = realDt * timeScale;

    if (this.jetwashCooldown > 0 && this.isGameplayActive()) {
      this.jetwashCooldown = Math.max(0, this.jetwashCooldown - realDt);
    }

    const activeParkId = this.landingPage.getSelectedPark().id;
    this.hotSpotZone.update(dt, timeSec, this.controller.position, activeParkId);
    const inHotSpot = this.hotSpotZone.isSkaterInside(this.controller.position);
    (this.controller as unknown as { hotSpotMultiplier?: number }).hotSpotMultiplier = inHotSpot
      ? 2.0
      : 1.0;
    this.hud.updateHotSpotStatus(
      this.hotSpotZone.activeSpot?.name ?? null,
      this.hotSpotZone.activeTimer,
      inHotSpot
    );

    const input = this.buildInputState(timeSec);
    this.controller.update(dt, input, (ev) => {
      this.tutorial.notifyManeuver(ev);
      const effectiveEv =
        this.inOutlawSpotlight && ev.points > 0
          ? { ...ev, points: Math.round(ev.points * 2.5) }
          : ev;
      this.hud.onManeuver(effectiveEv);
      this.progression.onManeuver(effectiveEv, inHotSpot);
      this.syncProgressionUI();
      if (this.inOutlawSpotlight && effectiveEv.points > 0) {
        const esc = this.afterHoursWanted.notifyTrickLanded(effectiveEv.points);
        if (esc.escalatedToStar !== null) {
          this.announceWantedStar(esc.escalatedToStar);
        }
      }
      if (ev.trick) {
        // Every scoring trick: big swoosh, slow motion, zoom-in and its name on screen
        const perfect = ev.quality === 'PERFECT';
        this.audio.playTrickSwoosh(ev.trick, perfect);
        this.slowMoTimer = this.slowMoDuration;
        this.surfCamera.triggerSnapZoom(this.slowMoDuration + 0.2);
        if (ev.trick === 'INDYGRAB') {
          this.surfCamera.triggerIndyOrbit(this.slowMoDuration + 0.35);
        }
        this.hud.showTrickBanner(ev.name, perfect);
        try {
          track('trick', { trick: ev.trick, quality: ev.quality, points: effectiveEv.points });
        } catch {}
      }

      if (this.isGameplayActive() && !this.controller.isBailing && ev.points >= 350) {
        const hype = this.parkCrew?.checkCrowdHype(this.controller.position, ev.points);
        if (hype) {
          this.hud.addBonusScore(hype.bonus);
          this.progression.recordSessionScore(this.hud.totalScore);
          this.syncProgressionUI();
          const npcName = t(`crew.${hype.npcId}.name` as TranslationKey);
          const npcIcon = hype.npcId === 'sepp' ? '👴' : '📸';
          const shoutoutKeys: TranslationKey[] =
            hype.npcId === 'sepp'
              ? ['crew.sepp.hype1', 'crew.sepp.hype2']
              : ['crew.michi.hype1', 'crew.michi.hype2'];
          const idx = this.crowdHypeQuoteIdx[hype.npcId] % shoutoutKeys.length;
          this.crowdHypeQuoteIdx[hype.npcId] = idx + 1;
          this.hud.showCrewDialogue(npcIcon, npcName, t(shoutoutKeys[idx]), 3200);
          this.audio.playPretzelPickup(false);
        }
      }

      const isAirManeuver =
        ev.trick === 'INDYGRAB' || /\b(air|ollie|indy)\b/i.test(ev.name);
      if (isAirManeuver && this.canTriggerJetwashStunt(activeParkId)) {
        this.triggerJetwashStunt();
      }
    });
    if (this.controller.pumpEventSeq !== this.lastPumpEventSeq) {
      this.lastPumpEventSeq = this.controller.pumpEventSeq;
      this.audio.playPumpWhoosh(
        Math.max(0.65, this.controller.lastPumpSurge),
        this.controller.lastPumpType === 'wall'
      );
      this.hud.triggerPumpPulse(this.controller.lastPumpType);
    }
    this.worldScene.update(timeSec);
    this.skaterVisuals.update(dt, this.controller);
    this.pretzels.update(dt, this.controller.position);
    this.flowLine.update(dt, timeSec, this.controller);
    this.tutorial.update(realDt, this.controller, input);

    const isGameplayActive = this.isGameplayActive();

    if (isGameplayActive) {
      if (
        !this.controller.isGrounded &&
        this.controller.airTime > 0.08 &&
        this.canTriggerJetwashStunt(activeParkId)
      ) {
        this.triggerJetwashStunt();
      }
      const crewState = this.parkCrew.update(dt, this.controller.position, this.controller.speed);
      this.hud.updateCrewInteract(
        crewState.canInteract,
        crewState.npcId,
        this.touchControls.isTouchActive()
      );
      this.hud.updateCrewQuestPill(
        crewState.questState,
        crewState.npcId,
        crewState.collected,
        crewState.total
      );

      if (crewState.newlyCollected && !crewState.justCompleted) {
        this.audio.playPretzelPickup(false);
        const collectKey =
          crewState.npcId === 'sepp' ? 'crew.sepp.collectToast' : 'crew.michi.collectToast';
        this.hud.showMissionToast(
          t(collectKey, { collected: crewState.collected, total: crewState.total })
        );
      }

      if (crewState.justCompleted) {
        this.hud.addBonusScore(crewState.bonusPoints);
        const { newRank, missionTitle } = this.progression.recordCrewMissionCompleted(
          crewState.npcId
        );
        this.syncProgressionUI();
        this.audio.playPretzelPickup(true);

        const npcName = t(`crew.${crewState.npcId}.name` as TranslationKey);
        const npcIcon = crewState.npcId === 'sepp' ? '👴' : '📸';
        const doneQuoteKey =
          crewState.npcId === 'sepp'
            ? 'crew.sepp.dialogueJustCompleted'
            : 'crew.michi.dialogueJustCompleted';
        this.hud.showCrewDialogue(npcIcon, npcName, t(doneQuoteKey));

        if (!newRank) {
          this.hud.showMissionToast(
            t('crew.completedToast', {
              mission: missionTitle,
              pts: formatNum(crewState.bonusPoints),
            })
          );
          this.hud.showTrickBanner(
            t('crew.completedBanner', { pts: formatNum(crewState.bonusPoints) }),
            true
          );
        }
      }

      const wantedState = this.afterHoursWanted.update(
        dt,
        this.controller.position,
        this.controller.speed
      );
      this.inOutlawSpotlight = wantedState.inOutlawSpotlight;
      this.hud.updateWantedStatus(wantedState);

      if (wantedState.newlyKnockedSign) {
        this.audio.playManeuverChime();
        if (wantedState.escalatedToStar === null) {
          this.hud.showMissionToast(
            t('wanted.signKnockedToast', {
              count: wantedState.signsKnocked,
              total: wantedState.totalSigns,
            })
          );
        }
      }

      if (wantedState.escalatedToStar !== null) {
        this.announceWantedStar(wantedState.escalatedToStar);
      }

      if (wantedState.justBusted) {
        this.hud.showBailBanner(t('wanted.bustedBanner'));
        this.hud.showMissionToast(t('wanted.bustedToast'));
        this.controller.comboCount = 0;
        this.controller.comboScore = 0;
        this.controller.speed = Math.min(this.controller.speed, 1.0) * 0.2;
        this.audio.playBailSound();
        this.surfCamera.triggerBailShake(0.32, 0.22);
      }

      if (wantedState.justEscapedSpray) {
        const ptsStr = formatNum(wantedState.escapeBonus);
        this.hud.awardBonusPoints(
          wantedState.escapeBonus,
          t('wanted.sprayEscapeBanner', { pts: ptsStr })
        );
        this.hud.showMissionToast(t('wanted.sprayEscapeToast', { pts: ptsStr }));
        this.audio.playPretzelPickup(true);
      }
    }

    this.airportFlyover.update(dt, activeParkId);
    this.scooterRider.update(dt, timeSec, activeParkId);

    this.surfCamera.update(realDt, this.controller);
    this.worldScene.updateLensFlare(this.surfCamera.camera, realDt, timeSec, this.parkSurface);
    this.hud.update(dt, this.controller);
    this.progression.update(
      dt,
      this.controller,
      this.hud.totalScore,
      this.hud.getCurrentOrBestComboScore(),
      this.pretzels.collectedCount
    );
    const shouldStopSurfAudio =
      document.hidden ||
      this.landingPage.isVisible ||
      this.hud.isSummaryModalOpen() ||
      this.isScrollableModalOpen() ||
      this.flowLine.isExportModalOpen() ||
      this.landingPage.isLeaderboardModalOpen();

    if (shouldStopSurfAudio) {
      this.audio.stopSurfskateAudio();
    } else {
      this.audio.update(this.controller);
      this.audio.updateSurfskateAudio(
        this.controller.speed,
        Math.abs(this.controller.leanAngle),
        this.controller.isGrounded,
        this.controller.isSlidingNow,
        this.controller.railDriftIntensity
      );
    }

    const ctrlAny = this.controller as unknown as {
      sessionTimer?: number;
      sessionFinished?: boolean;
    };
    if (
      !this.hud.endlessMode &&
      !this.summaryShownForSession &&
      (this.hud.sessionEnded ||
        Boolean(ctrlAny.sessionFinished) ||
        (typeof ctrlAny.sessionTimer === 'number' &&
          ctrlAny.sessionTimer <= 0 &&
          !this.isOvertimeWait()))
    ) {
      this.showSessionSummaryModal();
    }

    // FPS measurement & live HUD counter
    this.frameTimes.push(realDt);
    if (this.frameTimes.length > this.fpsHistorySize) {
      this.frameTimes.shift();
    }
    const avgDt = this.frameTimes.reduce((acc, v) => acc + v, 0) / this.frameTimes.length;
    this.currentFps = Math.round(1.0 / Math.max(0.001, avgDt));

    this.fpsDisplayTimer += realDt;
    if (this.fpsDisplayTimer >= 0.35) {
      this.fpsDisplayTimer = 0;
      this.hud.updateFPS(this.currentFps);
      this.syncProgressionUI();
    }

    // Auto-quality watchdog: automatically step down if hardware struggles (<46 / <40 FPS)
    if (this.graphicsPreset === 'auto') {
      this.timeSinceLastQualityChange += realDt;
      if (timeSec > 3.0 && this.timeSinceLastQualityChange > this.autoQualityCooldown) {
        if (this.currentFps < 46 && this.effectiveQuality === 'high') {
          this.effectiveQuality = 'medium';
          this.applyEffectiveQuality();
          this.timeSinceLastQualityChange = 0;
          this.hud.showTrickBanner(t('hud.autoQualityBanner', { quality: 'MEDIUM' }), false);
          this.syncHUDButtons();
        } else if (this.currentFps < 40 && this.effectiveQuality === 'medium') {
          this.effectiveQuality = 'low';
          this.applyEffectiveQuality();
          this.timeSinceLastQualityChange = 0;
          this.hud.showTrickBanner(t('hud.autoQualityBanner', { quality: 'PERFORMANCE' }), false);
          this.syncHUDButtons();
        }
      }
    }

    this.renderer.render(this.scene, this.surfCamera.camera);
    requestAnimationFrame((t) => this.animate(t));
  }
}

function initGame(): void {
  const existingGame = (window as unknown as Record<string, unknown>).surfskateGame;
  if (!existingGame) {
    const game = new SurfskateMunichGame();
    (window as unknown as Record<string, unknown>).surfskateGame = game;
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => initGame());
} else {
  initGame();
}
