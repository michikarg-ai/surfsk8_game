import * as THREE from 'three';
import { ParkSurface } from './physics/ParkSurface';
import { InputState, SurfskateController } from './physics/SurfskateController';
import { SkaterVisuals } from './entities/SkaterVisuals';
import { ImGefildeScene } from './world/ImGefildeScene';
import { CameraStyle, SurfCamera } from './camera/SurfCamera';
import { DriveControlMode, SurfHUD } from './ui/SurfHUD';
import { LandingPage, SkateparkLocation } from './ui/LandingPage';
import { TouchControls } from './ui/TouchControls';
import { SurfAudio } from './audio/SurfAudio';
import { PretzelCollectibles } from './world/PretzelCollectibles';
import { FlowLineChallenge } from './world/FlowLineChallenge';
import { inject, track } from '@vercel/analytics';

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
  public audio = new SurfAudio();
  public pretzels: PretzelCollectibles;
  public flowLine: FlowLineChallenge;

  public controlMode: DriveControlMode =
    (localStorage.getItem('surfsk8.controlMode') as DriveControlMode) || 'arrows';
  public keys = new Set<string>();
  private autoFlowEnabled = false;
  private lastTime = performance.now();

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
        canReverse:
          this.controller.isGrounded &&
          !this.controller.isGrinding &&
          !this.controller.snapActive &&
          !this.controller.reverseActive &&
          this.controller.speed >= 2.4,
      }),
    });

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
    this.pretzels = new PretzelCollectibles(this.scene, this.hud, this.audio);
    this.flowLine = new FlowLineChallenge(this.scene, this.parkSurface, this.hud, this.audio);
    this.flowLine.onRecordingStateChange = () => {
      this.syncFlowRecorderUI();
    };
    this.landingPage = new LandingPage(
      this.parkSurface,
      () => {
        if (TouchControls.isTouchDevice() && !this.isFullscreen()) {
          this.toggleFullscreen();
        }
        this.resetSession();
        this.audio.resume();
        this.lastTime = performance.now();
        this.touchControls.setVisible(true);
        this.syncHUDButtons();
        try {
          track('game_start', { skater: this.landingPage.getSelectedSkaterName() });
        } catch {}
      },
      (modelUrl) => {
        void this.skaterVisuals.load(modelUrl);
      },
      (park) => {
        void this.switchPark(park);
      },
      (park) => {
        this.inspectPark(park);
      }
    );
    this.landingPage.onCycleQuality = () => this.cycleGraphicsQuality();
    this.landingPage.onToggleFullscreen = () => this.toggleFullscreen();

    this.audio.onTrackChange = () => {
      this.syncHUDButtons();
    };

    this.applyEffectiveQuality();
    this.bindEvents();
    this.handleResize();
    this.syncHUDButtons();
    this.initAssets();
  }

  private async initAssets(): Promise<void> {
    const loadingEl = document.getElementById('loading-overlay');
    try {
      const initialModel = this.landingPage.getSelectedSkaterModel();
      await Promise.all([
        this.parkSurface.loadLidarGrid('/models/im_gefilde_lidar.json'),
        this.worldScene.load('im_gefilde'),
        this.skaterVisuals.load(initialModel),
        this.landingPage.load(),
      ]);
      this.flowLine.refreshSurfaceHeights();
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
    document.addEventListener('fullscreenchange', () => this.syncFullscreenUI());
    document.addEventListener('webkitfullscreenchange', () => this.syncFullscreenUI());
    new ResizeObserver(() => this.updateAppDimensions()).observe(this.viewportContainer);
    window.addEventListener('pointerdown', () => this.audio.initOnFirstGesture(), { once: true });
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

    // Help & Controls Modal (#help-modal)
    const btnHudHelp = document.getElementById('btn-hud-help');
    const btnLandingHelp = document.getElementById('landing-help-btn');
    const helpCloseBtn = document.getElementById('help-modal-close');
    const helpBackdrop = document.getElementById('help-modal-backdrop');
    const helpOkBtn = document.getElementById('help-modal-ok-btn');
    const tabMobile = document.getElementById('help-tab-mobile');
    const tabKeyboard = document.getElementById('help-tab-keyboard');

    if (btnHudHelp) btnHudHelp.addEventListener('click', () => this.openHelpModal());
    if (btnLandingHelp) btnLandingHelp.addEventListener('click', () => this.openHelpModal());
    if (helpCloseBtn) helpCloseBtn.addEventListener('click', () => this.closeHelpModal());
    if (helpBackdrop) helpBackdrop.addEventListener('click', () => this.closeHelpModal());
    if (helpOkBtn) helpOkBtn.addEventListener('click', () => this.closeHelpModal());
    if (tabMobile) tabMobile.addEventListener('click', () => this.switchHelpTab('mobile'));
    if (tabKeyboard) tabKeyboard.addEventListener('click', () => this.switchHelpTab('keyboard'));

    window.addEventListener('keydown', (e) => {
      this.audio.initOnFirstGesture();
      const code = e.code;

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
        if (code === 'Enter' || code === 'NumpadEnter') {
          e.preventDefault();
          this.landingPage.startGame();
        } else if (
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
      } else if (code === 'KeyC') {
        this.cycleCameraStyle();
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
      } else if (code === 'Backspace' || code === 'KeyX') {
        this.resetSession();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private userSelectedAspect = false;

  public toggleAspectMode(): void {
    this.userSelectedAspect = true;
    this.surfCamera.aspectMode = this.surfCamera.aspectMode === '16:9' ? '9:16' : '16:9';
    document.body.classList.toggle('reel-mode', this.surfCamera.aspectMode === '9:16');
    this.handleResize();
    this.syncHUDButtons();
  }

  public toggleAtmosphereMode(): void {
    this.worldScene.toggleAtmosphere();
    this.syncHUDButtons();
  }

  public toggleFullscreen(): void {
    const doc = document as any;
    const docEl = document.documentElement as any;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
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
        this.parkSurface.loadLidarGrid(park.lidarUrl || '/models/im_gefilde_lidar.json'),
      ]);
      this.flowLine.refreshSurfaceHeights();
      this.controller.position.set(16.0, 0.0, 5.0);
      this.controller.velocity.set(0, 0, 0);
      this.controller.speed = 0;
      this.surfCamera.reset(this.controller);
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
  }

  public openHelpModal(forceTab?: 'mobile' | 'keyboard'): void {
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
    this.keys.clear();
    this.touchControls.setVisible(false);
    this.audio.pause();
    this.audio.playGarageMusic();
    this.slowMoTimer = 0;
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
    this.controller.resetToSpawn();
    this.surfCamera.reset(this.controller);
    this.hud.resetSession();
    this.pretzels.reset();
    this.flowLine.reset();
    this.syncFlowRecorderUI();
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
        pillText.textContent = `🔴 REC: ${pts} PTS — [L] FINISH`;
      } else if (hasRecorded) {
        pill.classList.remove('hidden');
        pill.classList.remove('is-recording');
        pillText.textContent = `📋 LINE: ${pts} PTS — [L] REC NEW`;
      } else if (isDev) {
        pill.classList.remove('hidden');
        pill.classList.remove('is-recording');
        pillText.textContent = `🔴 REC FLOW LINE [L]`;
      } else {
        pill.classList.add('hidden');
        pill.classList.remove('is-recording');
      }
    }

    if (btnRec && btnLabel) {
      if (isRec) {
        btnRec.classList.remove('hidden');
        btnRec.classList.add('is-recording');
        btnLabel.textContent = `⏹ STOP [L]`;
      } else if (showDevButtons) {
        btnRec.classList.remove('hidden');
        btnRec.classList.remove('is-recording');
        btnLabel.textContent = `🔴 REC LINE [L]`;
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
    this.syncFlowRecorderUI();
    const keyLabel = document.getElementById('hud-garage-key-label');
    if (keyLabel) {
      keyLabel.textContent = this.touchControls.isEnabled ? '⏸' : 'ESC';
    }
    document.body.classList.toggle(
      'has-touch-controls',
      this.touchControls.isEnabled && this.touchControls.isVisible
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
      snapTrick: kbSnap || touch.snapTrick,
      laybackTrick: kbLayback || touch.laybackTrick,
      snapSlide: kbSlide || touch.snapSlide,
      reverseTrick: kbReverse || touch.reverseTrick,
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
      indyGrabTrick: !this.controller.isGrounded && this.controller.indyGrabReady,
    };
  }

  private animate(now: number): void {
    const realDt = Math.min((now - this.lastTime) * 0.001, 0.05);
    this.lastTime = now;
    const timeSec = now * 0.001;

    if (this.landingPage.isVisible) {
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
    const dt = realDt * timeScale;

    const input = this.buildInputState(timeSec);
    this.controller.update(dt, input, (ev) => {
      this.hud.onManeuver(ev);
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
          track('trick', { trick: ev.trick, quality: ev.quality, points: ev.points });
        } catch {}
      }
    });
    this.worldScene.update(timeSec);
    this.skaterVisuals.update(dt, this.controller);
    this.pretzels.update(dt, this.controller.position);
    this.flowLine.update(dt, timeSec, this.controller);
    this.surfCamera.update(realDt, this.controller);
    this.hud.update(dt, this.controller);
    this.audio.update(this.controller);

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
    }

    // Auto-quality watchdog: automatically step down if hardware struggles (<46 / <40 FPS)
    if (this.graphicsPreset === 'auto') {
      this.timeSinceLastQualityChange += realDt;
      if (timeSec > 3.0 && this.timeSinceLastQualityChange > this.autoQualityCooldown) {
        if (this.currentFps < 46 && this.effectiveQuality === 'high') {
          this.effectiveQuality = 'medium';
          this.applyEffectiveQuality();
          this.timeSinceLastQualityChange = 0;
          this.hud.showTrickBanner('AUTO QUALITY: MEDIUM', false);
          this.syncHUDButtons();
        } else if (this.currentFps < 40 && this.effectiveQuality === 'medium') {
          this.effectiveQuality = 'low';
          this.applyEffectiveQuality();
          this.timeSinceLastQualityChange = 0;
          this.hud.showTrickBanner('AUTO QUALITY: PERFORMANCE', false);
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
