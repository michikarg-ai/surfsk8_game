import * as THREE from 'three';
import { SkaterVisuals } from '../entities/SkaterVisuals';
import { ParkSurface } from '../physics/ParkSurface';
import { SurfskateController } from '../physics/SurfskateController';

export type SelectorCategory = 'skater' | 'skatepark' | 'board';

export interface SkaterCharacter {
  id: string;
  name: string;
  modelUrl: string;
}

export const SKATER_CHARACTERS: SkaterCharacter[] = [
  { id: 'male', name: 'LUKAS', modelUrl: '/models/skater.glb' },
  { id: 'female', name: 'LENA', modelUrl: '/models/skater_female.glb' },
];

const INSTAGRAM_URL = 'https://www.instagram.com/surfskate_munich/';

export class LandingPage {
  public isVisible = true;

  private overlayEl: HTMLElement;
  private canvasEl: HTMLCanvasElement;
  private noteEl: HTMLElement;
  private noteTextEl: HTMLElement;
  private startBtnEl: HTMLElement;
  private playerNameEl: HTMLElement | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private skaterVisuals: SkaterVisuals;
  private dummyController: SurfskateController;
  private noteTimeout: number | null = null;
  private currentSkaterIndex = 0;

  constructor(
    parkSurface: ParkSurface,
    private onStartGame: () => void,
    private onSelectSkater?: (modelUrl: string) => void
  ) {
    this.overlayEl = document.getElementById('landing-overlay')!;
    this.canvasEl = document.getElementById('landing-skater-canvas') as HTMLCanvasElement;
    this.noteEl = document.getElementById('landing-ig-note')!;
    this.noteTextEl = document.getElementById('landing-ig-note-text')!;
    this.startBtnEl = document.getElementById('landing-start-btn')!;
    this.playerNameEl = document.getElementById('landing-player-name') || this.overlayEl.querySelector('.sel-player-name');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasEl,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();

    // Camera framed to match the garage perspective in landing_page_background.jpeg
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 30);
    this.camera.position.set(0.0, 1.15, 4.15);
    this.camera.lookAt(-0.08, 0.94, 0.0);

    // Warm garage pendant lighting + Munich sunset rim light from the open garage door behind
    const hemi = new THREE.HemisphereLight(0xffdfc2, 0x262220, 0.95);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffe6c4, 2.2);
    keyLight.position.set(-1.2, 4.2, 2.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    const d = 2.2;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    // Sunset orange rim light from the Munich skyline behind the skater
    const sunsetRim = new THREE.DirectionalLight(0xff7b2e, 1.45);
    sunsetRim.position.set(0.8, 1.9, -3.2);
    this.scene.add(sunsetRim);

    // Cool fill from the right graffiti wall
    const fillLight = new THREE.DirectionalLight(0x7fa8d4, 0.55);
    fillLight.position.set(2.5, 1.6, 1.8);
    this.scene.add(fillLight);

    // Shadow-catcher plane on the garage concrete floor
    const floorGeo = new THREE.PlaneGeometry(6, 6);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.42 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = 0.0;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    this.dummyController = new SurfskateController(parkSurface);
    this.skaterVisuals = new SkaterVisuals(this.scene);
    this.skaterVisuals.particleMesh.visible = false;
    this.skaterVisuals.trailMesh.visible = false;

    this.bindUIEvents();
    this.handleResize();
  }

  public async load(): Promise<void> {
    const currentSkater = SKATER_CHARACTERS[this.currentSkaterIndex];
    await this.skaterVisuals.load(currentSkater.modelUrl);
  }

  public getSelectedSkaterModel(): string {
    return SKATER_CHARACTERS[this.currentSkaterIndex].modelUrl;
  }

  private bindUIEvents(): void {
    // Selector arrows (< and >) for player, skatepark, and board
    const arrowBtns = this.overlayEl.querySelectorAll<HTMLButtonElement>('.sel-arrow');
    arrowBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const kind = (btn.dataset.kind || 'skater') as SelectorCategory;
        const dir = parseInt(btn.dataset.dir || '1', 10);

        if (kind === 'skater') {
          this.currentSkaterIndex =
            (this.currentSkaterIndex + dir + SKATER_CHARACTERS.length) %
            SKATER_CHARACTERS.length;
          const skater = SKATER_CHARACTERS[this.currentSkaterIndex];
          if (this.playerNameEl) {
            this.playerNameEl.textContent = skater.name;
          }
          void this.skaterVisuals.load(skater.modelUrl);
          if (this.onSelectSkater) {
            this.onSelectSkater(skater.modelUrl);
          }
          this.showInstagramPrompt('skater', btn);
        } else {
          this.showInstagramPrompt(kind, btn);
        }
      });
    });

    const closeBtn = document.getElementById('landing-ig-note-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.noteEl.classList.remove('visible');
      });
    }

    this.startBtnEl.addEventListener('click', () => {
      this.startGame();
    });
  }

  public showInstagramPrompt(kind: SelectorCategory, triggerBtn?: HTMLElement): void {
    const label =
      kind === 'skater' ? 'skater' : kind === 'skatepark' ? 'skatepark' : 'board';

    this.noteTextEl.innerHTML = `More to come, check <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer">${INSTAGRAM_URL}</a> and tell us which <strong>${label}</strong> you want to see next!`;
    this.noteEl.classList.remove('visible');
    // Force reflow so repeat clicks re-trigger the pop animation
    void this.noteEl.offsetWidth;
    this.noteEl.classList.add('visible');

    if (triggerBtn) {
      const row = triggerBtn.closest('.sel-section');
      if (row) {
        row.classList.remove(' bump');
        row.classList.add('bump');
        setTimeout(() => row.classList.remove('bump'), 320);
      }
    }

    if (this.noteTimeout !== null) {
      window.clearTimeout(this.noteTimeout);
    }
    this.noteTimeout = window.setTimeout(() => {
      this.noteEl.classList.remove('visible');
    }, 9000);
  }

  public startGame(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.overlayEl.classList.add('hidden');
    if (this.onSelectSkater) {
      this.onSelectSkater(SKATER_CHARACTERS[this.currentSkaterIndex].modelUrl);
    }
    this.onStartGame();
  }

  public show(): void {
    this.isVisible = true;
    this.overlayEl.classList.remove('hidden');
    this.handleResize();
  }

  public handleResize(): void {
    const rect = this.overlayEl.getBoundingClientRect();
    const w = Math.max(1, rect.width || window.innerWidth);
    const h = Math.max(1, rect.height || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  public update(timeSec: number, dt: number): void {
    if (!this.isVisible) return;

    // Subtle, relaxed surfskate idle sway on the garage floor
    const pumpFreq = 1.25;
    const phase = timeSec * pumpFreq;
    const carveWave = Math.sin(phase);
    const carveCos = Math.cos(phase);

    // Gentle rail rock + subtle knee flex
    const ctrl = this.dummyController;
    ctrl.isGrounded = true;
    ctrl.isGrinding = false;
    ctrl.bertSlideActive = false;
    ctrl.bertSlideAmount = 0;
    ctrl.laybackActive = false;
    ctrl.laybackAmount = 0;
    ctrl.reverseActive = false;
    ctrl.boardYawOffset = 0;
    ctrl.sprayIntensity = 0;

    ctrl.leanAngle = carveWave * 0.14;
    ctrl.frontTruckYaw = ctrl.leanAngle * 1.35;
    ctrl.rearTruckYaw = -ctrl.leanAngle * 0.35;
    ctrl.compression = 0.14 + 0.10 * Math.pow(Math.sin(phase), 2);
    ctrl.upperBodyLeadYaw = -ctrl.leanAngle * 0.85 + carveCos * 0.08;
    ctrl.pitchAngle = 0;
    ctrl.speed = 0.6;
    ctrl.wheelSpinAngle = (ctrl.wheelSpinAngle + dt * 3.0) % (Math.PI * 2);

    // Keep the skater nearly in place on the garage floor with only a slight weight shift
    const centerX = 0.14 + carveWave * 0.045;
    const centerZ = 0.05 + Math.sin(phase * 2.0) * 0.018;
    ctrl.position.set(centerX, 0.0, centerZ);
    ctrl.heading = -0.58 + carveCos * 0.10;

    ctrl.currentSurface = {
      height: 0.0,
      slopeX: 0.0,
      slopeZ: 0.0,
      normal: new THREE.Vector3(0, 1, 0),
      curvature: 0.0,
      isNearCoping: false,
      copingHeight: 0.0,
      zoneName: 'Garage',
    };

    this.skaterVisuals.update(dt, ctrl);
    this.renderer.render(this.scene, this.camera);
  }
}
