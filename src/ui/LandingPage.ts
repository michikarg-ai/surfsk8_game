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

export interface SkateparkLocation {
  id: string;
  name: string;
  subtitle: string;
  thumbUrl: string;
  modelUrl: string;
  colliderUrl?: string;
  lidarUrl?: string;
  viewerUrl?: string;
}

export const SKATER_CHARACTERS: SkaterCharacter[] = [
  { id: 'male', name: 'LUKAS', modelUrl: '/models/skater.glb' },
  { id: 'female', name: 'SOPHIE', modelUrl: '/models/skater_female.glb' },
];

export const SKATEPARK_LOCATIONS: SkateparkLocation[] = [
  {
    id: 'im_gefilde',
    name: 'IM GEFILDE',
    subtitle: 'IM GEFILDE - MUNICH',
    thumbUrl: '/textures/im_gefilde_thumb.png',
    modelUrl: '/models/skatepark_multi.glb',
    lidarUrl: '/models/im_gefilde_lidar.json',
    viewerUrl: '/viewer.html?model=/models/skatepark_multi.glb',
  },
];

export const SELECTOR_CATEGORIES: SelectorCategory[] = ['skater', 'skatepark', 'board'];

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
  private activeCategoryIndex = 0;
  private currentSkaterIndex = (() => {
    const s = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('skater') : null;
    return s === 'female' || s === 'sophie' || s === '1' ? 1 : 0;
  })();
  public currentParkIndex = 0;

  // In-slot notice views for skatepark & board selection
  private parkSubtitleEl: HTMLElement | null = null;
  private parkThumbImgEl: HTMLImageElement | null = null;
  private parkInspectBtnEl: HTMLElement | null = null;
  private parkThumbView: HTMLElement | null = null;
  private parkNoticeView: HTMLElement | null = null;
  private boardIconView: HTMLElement | null = null;
  private boardNoticeView: HTMLElement | null = null;
  private parkNoticeTimeout: number | null = null;
  private boardNoticeTimeout: number | null = null;
  private qualityBtnEl: HTMLElement | null = null;

  public onCycleQuality?: () => void;

  constructor(
    parkSurface: ParkSurface,
    private onStartGame: () => void,
    private onSelectSkater?: (modelUrl: string) => void,
    private onSelectPark?: (park: SkateparkLocation) => void,
    private onInspectPark?: (park: SkateparkLocation) => void
  ) {
    this.overlayEl = document.getElementById('landing-overlay')!;
    this.canvasEl = document.getElementById('landing-skater-canvas') as HTMLCanvasElement;
    this.noteEl = document.getElementById('landing-ig-note')!;
    this.noteTextEl = document.getElementById('landing-ig-note-text')!;
    this.startBtnEl = document.getElementById('landing-start-btn')!;
    this.playerNameEl = document.getElementById('landing-player-name') || this.overlayEl.querySelector('.sel-player-name');
    this.parkSubtitleEl = document.getElementById('landing-park-subtitle') || this.overlayEl.querySelector('#sel-section-skatepark .sel-subtitle');
    this.parkThumbImgEl = document.getElementById('landing-park-thumb') as HTMLImageElement || this.overlayEl.querySelector('.park-thumb');
    this.parkInspectBtnEl = document.getElementById('landing-park-inspect-btn');

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
    if (this.playerNameEl) {
      this.playerNameEl.textContent = currentSkater.name;
    }
    this.updateParkDisplay();
    await this.skaterVisuals.load(currentSkater.modelUrl);
  }

  public updateParkDisplay(): void {
    const park = SKATEPARK_LOCATIONS[this.currentParkIndex];
    if (this.parkSubtitleEl) {
      this.parkSubtitleEl.textContent = park.subtitle;
    }
    if (this.parkThumbImgEl) {
      this.parkThumbImgEl.src = park.thumbUrl;
      this.parkThumbImgEl.alt = park.name;
    }
  }

  public getSelectedPark(): SkateparkLocation {
    return SKATEPARK_LOCATIONS[this.currentParkIndex];
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
        this.triggerSelect(kind, dir);
      });
    });

    // Row hover & click synchronization with keyboard active index
    SELECTOR_CATEGORIES.forEach((cat, idx) => {
      const sectionEl = document.getElementById(`sel-section-${cat}`);
      if (sectionEl) {
        sectionEl.addEventListener('mouseenter', () => {
          this.activeCategoryIndex = idx;
          this.updateActiveSectionVisuals();
        });
        sectionEl.addEventListener('click', () => {
          this.activeCategoryIndex = idx;
          this.updateActiveSectionVisuals();
        });
      }
    });

    const closeBtn = document.getElementById('landing-ig-note-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.noteEl.classList.remove('visible');
      });
    }

    this.parkThumbView = document.getElementById('park-thumb-view');
    this.parkNoticeView = document.getElementById('park-notice-view');
    this.boardIconView = document.getElementById('board-icon-view');
    this.boardNoticeView = document.getElementById('board-notice-view');

    const parkDismiss = document.getElementById('park-notice-dismiss');
    if (parkDismiss) {
      parkDismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        this.revertParkView();
      });
    }

    const boardDismiss = document.getElementById('board-notice-dismiss');
    if (boardDismiss) {
      boardDismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        this.revertBoardView();
      });
    }

    if (this.parkInspectBtnEl) {
      this.parkInspectBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const park = SKATEPARK_LOCATIONS[this.currentParkIndex];
        if (this.onInspectPark) {
          this.onInspectPark(park);
        } else {
          window.open(park.viewerUrl || '/viewer.html', '_blank');
        }
      });
    }

    if (this.parkThumbView) {
      this.parkThumbView.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showInstagramPrompt('skatepark');
      });
    }

    if (this.boardIconView) {
      this.boardIconView.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showInstagramPrompt('board');
      });
    }

    const triggerStart = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.startGame();
    };
    this.startBtnEl.addEventListener('click', triggerStart);
    this.startBtnEl.addEventListener('touchend', triggerStart, { passive: false });

    this.qualityBtnEl = document.getElementById('landing-quality-btn');
    if (this.qualityBtnEl) {
      this.qualityBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onCycleQuality?.();
      });
    }

    // Terms & Privacy Modal
    const termsBtn = document.getElementById('landing-terms-btn');
    const termsModal = document.getElementById('terms-modal');
    const termsCloseBtn = document.getElementById('terms-modal-close');
    const termsOkBtn = document.getElementById('terms-modal-ok-btn');
    const termsBackdrop = termsModal?.querySelector('.terms-modal-backdrop');

    const openTerms = (e: Event) => {
      e.stopPropagation();
      termsModal?.classList.remove('hidden');
    };
    const closeTerms = (e?: Event) => {
      e?.stopPropagation();
      termsModal?.classList.add('hidden');
    };

    termsBtn?.addEventListener('click', openTerms);
    termsCloseBtn?.addEventListener('click', closeTerms);
    termsOkBtn?.addEventListener('click', closeTerms);
    termsBackdrop?.addEventListener('click', closeTerms);

    this.updateActiveSectionVisuals();
  }

  public handleKeyDown(code: string): void {
    if (code === 'Escape') {
      const termsModal = document.getElementById('terms-modal');
      if (termsModal && !termsModal.classList.contains('hidden')) {
        termsModal.classList.add('hidden');
        return;
      }
    }
    if (code === 'KeyQ') {
      this.onCycleQuality?.();
      return;
    }
    if (code === 'ArrowDown' || code === 'KeyS') {
      this.activeCategoryIndex = (this.activeCategoryIndex + 1) % SELECTOR_CATEGORIES.length;
      this.updateActiveSectionVisuals();
    } else if (code === 'ArrowUp' || code === 'KeyW') {
      this.activeCategoryIndex =
        (this.activeCategoryIndex - 1 + SELECTOR_CATEGORIES.length) % SELECTOR_CATEGORIES.length;
      this.updateActiveSectionVisuals();
    } else if (code === 'ArrowLeft' || code === 'KeyA') {
      const cat = SELECTOR_CATEGORIES[this.activeCategoryIndex];
      this.triggerSelect(cat, -1);
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      const cat = SELECTOR_CATEGORIES[this.activeCategoryIndex];
      this.triggerSelect(cat, 1);
    }
  }

  public setActiveCategory(kind: SelectorCategory): void {
    const idx = SELECTOR_CATEGORIES.indexOf(kind);
    if (idx !== -1) {
      this.activeCategoryIndex = idx;
      this.updateActiveSectionVisuals();
    }
  }

  private updateActiveSectionVisuals(): void {
    SELECTOR_CATEGORIES.forEach((cat, idx) => {
      const el = document.getElementById(`sel-section-${cat}`);
      if (el) {
        if (idx === this.activeCategoryIndex) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });
  }

  public triggerSelect(kind: SelectorCategory, dir: number): void {
    this.setActiveCategory(kind);

    // Visual button press animation on corresponding arrow button
    const btn = this.overlayEl.querySelector<HTMLButtonElement>(
      `.sel-arrow[data-kind="${kind}"][data-dir="${dir}"]`
    );
    if (btn) {
      btn.classList.add('keyboard-press');
      window.setTimeout(() => btn.classList.remove('keyboard-press'), 160);
    }

    const rowEl = document.getElementById(`sel-section-${kind}`);

    if (kind === 'skater') {
      this.currentSkaterIndex =
        (this.currentSkaterIndex + dir + SKATER_CHARACTERS.length) % SKATER_CHARACTERS.length;
      const skater = SKATER_CHARACTERS[this.currentSkaterIndex];
      if (this.playerNameEl) {
        this.playerNameEl.textContent = skater.name;
      }
      void this.skaterVisuals.load(skater.modelUrl);
      if (this.onSelectSkater) {
        this.onSelectSkater(skater.modelUrl);
      }
      this.showInstagramPrompt('skater', btn || rowEl || undefined);
    } else {
      this.showInstagramPrompt(kind, btn || rowEl || undefined);
    }
  }

  public showInstagramPrompt(kind: SelectorCategory, triggerBtn?: HTMLElement): void {
    if (kind === 'skatepark') {
      if (this.parkThumbView && this.parkNoticeView) {
        this.parkThumbView.classList.remove('active');
        this.parkNoticeView.classList.add('active');

        if (this.parkNoticeTimeout !== null) {
          window.clearTimeout(this.parkNoticeTimeout);
        }
        this.parkNoticeTimeout = window.setTimeout(() => {
          this.revertParkView();
        }, 8500);
      }
    } else if (kind === 'board') {
      if (this.boardIconView && this.boardNoticeView) {
        this.boardIconView.classList.remove('active');
        this.boardNoticeView.classList.add('active');

        if (this.boardNoticeTimeout !== null) {
          window.clearTimeout(this.boardNoticeTimeout);
        }
        this.boardNoticeTimeout = window.setTimeout(() => {
          this.revertBoardView();
        }, 8500);
      }
    }

    if (triggerBtn) {
      const row = triggerBtn.closest<HTMLElement>('.sel-section');
      if (row) {
        row.classList.remove('bump');
        void row.offsetWidth;
        row.classList.add('bump');
        setTimeout(() => row.classList.remove('bump'), 320);
      }
    }
  }

  public revertParkView(): void {
    if (this.parkNoticeTimeout !== null) {
      window.clearTimeout(this.parkNoticeTimeout);
      this.parkNoticeTimeout = null;
    }
    if (this.parkThumbView && this.parkNoticeView) {
      this.parkNoticeView.classList.remove('active');
      this.parkThumbView.classList.add('active');
    }
  }

  public revertBoardView(): void {
    if (this.boardNoticeTimeout !== null) {
      window.clearTimeout(this.boardNoticeTimeout);
      this.boardNoticeTimeout = null;
    }
    if (this.boardIconView && this.boardNoticeView) {
      this.boardNoticeView.classList.remove('active');
      this.boardIconView.classList.add('active');
    }
  }

  public startGame(): void {
    if (!this.isVisible) return;
    const termsModal = document.getElementById('terms-modal');
    termsModal?.classList.add('hidden');
    this.isVisible = false;
    this.overlayEl.classList.add('hidden');
    if (this.onSelectSkater) {
      this.onSelectSkater(SKATER_CHARACTERS[this.currentSkaterIndex].modelUrl);
    }
    this.onStartGame();
  }

  public getSelectedSkaterName(): string {
    return SKATER_CHARACTERS[this.currentSkaterIndex]?.name || 'LUKAS';
  }

  public show(): void {
    this.isVisible = true;
    this.overlayEl.classList.remove('hidden');
    this.updateActiveSectionVisuals();
    this.handleResize();
  }

  public handleResize(): void {
    const rect = this.overlayEl.getBoundingClientRect();
    const w = Math.max(1, rect.width || window.innerWidth);
    const h = Math.max(1, rect.height || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    const isPortrait = w < h;
    if (isPortrait) {
      // In portrait mode (smartphones & vertical reel mode), the selector card and start button
      // occupy the bottom ~38% of the screen. We frame the entire 3D skater proudly in the upper half.
      // Skater is at X ~0.14, board at Y=0, head at Y=1.7.
      this.camera.fov = 43;
      this.camera.position.set(0.14, 0.95, 4.8);
      this.camera.lookAt(0.14, 0.72, 0.0);
    } else if (h < 520) {
      // Mobile landscape (e.g. 844x390):
      // Height is short, selector card is on the left.
      this.camera.fov = 34;
      this.camera.position.set(0.16, 1.10, 4.1);
      this.camera.lookAt(0.08, 0.92, 0.0);
    } else {
      // Standard desktop landscape
      this.camera.fov = 34;
      this.camera.position.set(0.0, 1.15, 4.15);
      this.camera.lookAt(-0.08, 0.94, 0.0);
    }
    this.camera.updateProjectionMatrix();
  }

  public setQuality(quality: 'high' | 'medium' | 'low'): void {
    const dpr = window.devicePixelRatio || 1;
    const targetPixelRatio = quality === 'high' ? Math.min(dpr, 1.5) : quality === 'medium' ? Math.min(dpr, 1.0) : Math.min(dpr, 0.85);
    this.renderer.setPixelRatio(targetPixelRatio);
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.handleResize();
  }

  public updateQualityLabel(preset: string, effective: string): void {
    if (!this.qualityBtnEl) return;
    const label = preset === 'auto' ? `AUTO (${effective.toUpperCase()})` : preset.toUpperCase();
    this.qualityBtnEl.textContent = `⚡ QUALITY: ${label}`;
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
    ctrl.indyGrabActive = false;
    ctrl.indyGrabAmount = 0;
    ctrl.indyGrabReady = false;
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
