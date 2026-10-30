import * as THREE from 'three';
import { ParkSurface } from './physics/ParkSurface';
import { InputState, SurfskateController } from './physics/SurfskateController';
import { SkaterVisuals } from './entities/SkaterVisuals';
import { ImGefildeScene } from './world/ImGefildeScene';
import { SurfCamera } from './camera/SurfCamera';
import { SurfHUD } from './ui/SurfHUD';
import { SurfAudio } from './audio/SurfAudio';

class SurfskateMunichGame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private viewportContainer: HTMLElement;
  private parkSurface: ParkSurface;
  private controller: SurfskateController;
  private skaterVisuals: SkaterVisuals;
  private worldScene: ImGefildeScene;
  private surfCamera: SurfCamera;
  private hud: SurfHUD;
  private audio = new SurfAudio();

  private keys = new Set<string>();
  private autoFlowEnabled = false;
  private lastTime = performance.now();

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
    this.worldScene = new ImGefildeScene(this.scene, this.renderer);
    this.skaterVisuals = new SkaterVisuals(this.scene);
    this.surfCamera = new SurfCamera();

    this.hud = new SurfHUD({
      onToggleAspect: () => this.toggleAspectMode(),
      onToggleAtmosphere: () => this.toggleAtmosphereMode(),
      onCycleCamera: () => this.cycleCameraStyle(),
      onCycleTruckFeel: () => this.cycleTruckFeel(),
      onToggleAutoFlow: () => this.toggleAutoFlow(),
      onResetSession: () => this.resetSession(),
    });

    this.bindEvents();
    this.handleResize();
    this.syncHUDButtons();
    this.initAssets();
  }

  private async initAssets(): Promise<void> {
    const loadingEl = document.getElementById('loading-overlay');
    try {
      await Promise.all([
        this.parkSurface.loadLidarGrid(),
        this.worldScene.load(),
        this.skaterVisuals.load(),
      ]);
    } catch (err) {
      console.error('Error loading GLB/LiDAR assets:', err);
    }
    if (loadingEl) {
      loadingEl.classList.add('hidden');
    }
    this.controller.resetToSpawn();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.animate(t));
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('pointerdown', () => this.audio.initOnFirstGesture(), { once: true });

    window.addEventListener('keydown', (e) => {
      this.audio.initOnFirstGesture();
      const code = e.code;
      this.keys.add(code);

      if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'ArrowUp'].includes(code)) {
        if (this.autoFlowEnabled) {
          this.autoFlowEnabled = false;
          this.syncHUDButtons();
        }
      }

      if (code === 'KeyR') {
        this.toggleAspectMode();
      } else if (code === 'KeyL') {
        this.toggleAtmosphereMode();
      } else if (code === 'KeyV') {
        this.cycleCameraStyle();
      } else if (code === 'KeyT') {
        this.cycleTruckFeel();
      } else if (code === 'KeyP') {
        this.toggleAutoFlow();
      } else if (code === 'Backspace' || code === 'KeyX') {
        this.resetSession();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  public toggleAspectMode(): void {
    this.surfCamera.aspectMode = this.surfCamera.aspectMode === '16:9' ? '9:16' : '16:9';
    document.body.classList.toggle('reel-mode', this.surfCamera.aspectMode === '9:16');
    this.handleResize();
    this.syncHUDButtons();
  }

  public toggleAtmosphereMode(): void {
    this.worldScene.toggleAtmosphere();
    this.syncHUDButtons();
  }

  public cycleCameraStyle(): void {
    this.surfCamera.cycleCameraStyle();
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

  public resetSession(): void {
    this.controller.resetToSpawn();
    this.hud.resetSession();
  }

  private syncHUDButtons(): void {
    this.hud.updateButtons(
      this.surfCamera.aspectMode,
      this.worldScene.mode,
      this.surfCamera.cameraStyle,
      this.controller.truckPreset,
      this.autoFlowEnabled
    );
  }

  private handleResize(): void {
    const rect = this.viewportContainer.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(320, rect.height);
    this.renderer.setSize(w, h, false);
    this.surfCamera.setAspectRatio(w, h);
  }

  private buildInputState(timeSec: number): InputState {
    if (this.autoFlowEnabled) {
      return this.computeAutoFlowInput(timeSec);
    }

    return {
      steerLeft: this.keys.has('KeyA') || this.keys.has('ArrowLeft'),
      steerRight: this.keys.has('KeyD') || this.keys.has('ArrowRight'),
      forwardPush: this.keys.has('KeyW') || this.keys.has('ArrowUp'),
      compressCrouch:
        this.keys.has('KeyS') ||
        this.keys.has('ArrowDown') ||
        this.keys.has('ShiftLeft') ||
        this.keys.has('ShiftRight'),
      jumpOllie: this.keys.has('Space'),
      grindSlash: false, // coping grinds are not part of the trick set
      snapSlide: this.keys.has('KeyC'),
      snapTrick: this.keys.has('KeyQ'),
      laybackTrick: this.keys.has('KeyF'),
      reverseTrick: this.keys.has('KeyE'),
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
    };
  }

  private animate(now: number): void {
    const realDt = Math.min((now - this.lastTime) * 0.001, 0.05);
    this.lastTime = now;

    // SNAP slow motion: hold at slowMoScale, then ease back to real time over the last 0.4 s
    let timeScale = 1;
    if (this.slowMoTimer > 0) {
      this.slowMoTimer = Math.max(0, this.slowMoTimer - realDt);
      const easeOut = Math.min(1, this.slowMoTimer / 0.4);
      timeScale = this.slowMoScale + (1 - this.slowMoScale) * (1 - easeOut);
    }
    const dt = realDt * timeScale;

    const timeSec = now * 0.001;
    const input = this.buildInputState(timeSec);
    this.controller.update(dt, input, (ev) => {
      this.hud.onManeuver(ev);
      if (ev.trick) {
        // Every scoring trick: big swoosh, slow motion, zoom-in and its name on screen
        const perfect = ev.quality === 'PERFECT';
        this.audio.playTrickSwoosh(ev.trick, perfect);
        this.slowMoTimer = this.slowMoDuration;
        this.surfCamera.triggerSnapZoom(this.slowMoDuration + 0.2);
        this.hud.showTrickBanner(ev.name, perfect);
      }
    });
    this.worldScene.update(timeSec);
    this.skaterVisuals.update(dt, this.controller);
    this.surfCamera.update(realDt, this.controller);
    this.hud.update(dt, this.controller);
    this.audio.update(this.controller);

    this.renderer.render(this.scene, this.surfCamera.camera);
    requestAnimationFrame((t) => this.animate(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new SurfskateMunichGame();
  (window as unknown as Record<string, unknown>).surfskateGame = game;
});
