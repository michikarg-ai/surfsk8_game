import * as THREE from 'three';
import { SkaterVisuals } from '../entities/SkaterVisuals';
import { resolveAssetUrl } from '../utils/assetUrl';
import { ParkSurface } from '../physics/ParkSurface';
import { SkaterStats, SurfskateController } from '../physics/SurfskateController';
import { GameModeId, SkaterRankInfo, SurfMission } from '../progression/SurfProgression';
import {
  BoardUnlockProgress,
  getBoardById,
  getSelectedBoardId,
  isBoardUnlocked,
  setSelectedBoardId,
  SURF_BOARDS,
  SurfBoardId,
  SurfBoardSpec,
} from '../config/SurfBoards';
import {
  fetchLeaderboard,
  getPlayerName,
  LeaderboardEntry,
  LeaderboardPark,
  sanitizePlayerName,
  setPlayerName,
} from '../services/LeaderboardService';

const NAME_PROMPT_SEEN_KEY = 'surfsk8.namePromptSeen.v1';
import {
  applyDomTranslations,
  formatNum,
  getLang,
  onLangChange,
  t,
  toggleLang,
} from '../i18n/i18n';

export type SelectorCategory = 'skater' | 'skatepark' | 'board';
export type LandingFocusRow = 'skater' | 'park' | 'board' | 'mode' | 'start';
export const LANDING_FOCUS_ROWS: LandingFocusRow[] = ['skater', 'park', 'board', 'mode', 'start'];

export type { SkaterStats };

export interface SkaterCharacter {
  id: string;
  name: string;
  modelUrl: string;
  stats: SkaterStats;
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
  {
    id: 'male',
    name: 'LUKAS',
    modelUrl: 'models/skater.glb',
    stats: { flow: 92, pump: 88, agility: 85 },
  },
  {
    id: 'female',
    name: 'SOPHIE',
    modelUrl: 'models/skater_female.glb',
    stats: { flow: 91, pump: 82, agility: 93 },
  },
];

export const SKATEPARK_LOCATIONS: SkateparkLocation[] = [
  {
    id: 'im_gefilde',
    name: 'IM WIESENGRUND',
    subtitle: 'IM WIESENGRUND',
    thumbUrl: 'textures/im_gefilde_thumb.png',
    modelUrl: 'models/skatepark_multi.glb',
    lidarUrl: 'models/im_gefilde_lidar.json',
    viewerUrl: 'viewer.html?model=models/skatepark_multi.glb',
  },
  {
    id: 'airport_skatepark',
    name: 'AIRPORT SKATEPARK',
    subtitle: 'AIRPORT SKATEPARK',
    thumbUrl: 'textures/airport_thumb.png?v=2',
    modelUrl: 'models/airport_skatepark_game.glb',
    lidarUrl: 'models/airport_skatepark_lidar.json',
    viewerUrl: 'viewer.html?model=models/airport_skatepark_game.glb',
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
  private skaterStatsEl: HTMLElement | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private skaterVisuals: SkaterVisuals;
  private dummyController: SurfskateController;
  private noteTimeout: number | null = null;
  private activeFocusIndex = 0;
  private currentSkaterIndex = (() => {
    const s = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('skater') : null;
    return s === 'female' || s === 'sophie' || s === '1' ? 1 : 0;
  })();
  public currentParkIndex = (() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('park') : null;
    return p === 'airport' || p === 'airport_skatepark' || p === '1' ? 1 : 0;
  })();
  private currentBoardIndex = (() => {
    const savedId = getSelectedBoardId();
    const idx = SURF_BOARDS.findIndex((b) => b.id === savedId);
    return idx >= 0 ? idx : 0;
  })();
  private lastUnlockedBoardId: SurfBoardId = 'the_spiral';
  private boardUnlockProgress: BoardUnlockProgress = {
    rankLevel: 1,
    totalCompletedMissions: 0,
    bestSessionScore: 0,
  };
  private hasInitializedBoardUnlocks = false;

  // In-slot notice views for skatepark & board selection
  private parkSubtitleEl: HTMLElement | null = null;
  private parkThumbImgEl: HTMLImageElement | null = null;
  private parkInspectBtnEl: HTMLElement | null = null;
  private parkThumbView: HTMLElement | null = null;
  private parkNoticeView: HTMLElement | null = null;
  private boardIconView: HTMLElement | null = null;
  private boardIconWrapEl: HTMLElement | null = null;
  private boardNoticeView: HTMLElement | null = null;
  private boardNameEl: HTMLElement | null = null;
  private boardTaglineEl: HTMLElement | null = null;
  private boardStatsEl: HTMLElement | null = null;
  private boardSlotWrapEl: HTMLElement | null = null;
  private boardLockBadgeEl: HTMLElement | null = null;
  private boardLockTextEl: HTMLElement | null = null;
  private parkNoticeTimeout: number | null = null;
  private boardNoticeTimeout: number | null = null;
  private qualityBtnEl: HTMLElement | null = null;

  public onCycleQuality?: () => void;
  public onToggleFullscreen?: () => void;
  public onToggleSound?: () => void;
  public onSelectGameMode?: (mode: GameModeId) => void;
  public onOpenTutorial?: () => void;
  public onLockedBoardFallback?: (lockedBoard: SurfBoardSpec, activeBoard: SurfBoardSpec) => void;
  private fullscreenBtnEl: HTMLElement | null = null;
  private soundBtnEl: HTMLElement | null = null;
  private modeDescEl: HTMLElement | null = null;
  private missionsCountEl: HTMLElement | null = null;
  private selectedGameMode: GameModeId = (() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('surfsk8.gameMode') : null;
    if (saved === 'jam' || saved === 'flow_cup' || saved === 'zen') return saved;
    return 'jam';
  })();
  private modePillBtns: HTMLButtonElement[] = [];
  private rankBadgeEl: HTMLElement | null = null;
  private missionsListEl: HTMLElement | null = null;
  private riderNameInputEl: HTMLInputElement | null = null;
  private leaderboardModalEl: HTMLElement | null = null;
  private lbListEl: HTMLElement | null = null;
  private lbSourceBadgeEl: HTMLElement | null = null;
  private lbTabBtns: HTMLButtonElement[] = [];
  private activeLbPark: LeaderboardPark = 'all';
  private lbFetchToken = 0;
  private langToggleBtnEl: HTMLElement | null = null;
  private settingsBtnEl: HTMLElement | null = null;
  private settingsPopoverEl: HTMLElement | null = null;
  private lastIsFs = false;
  private lastSoundActive = true;
  private lastQualityPreset = 'auto';
  private lastQualityEffective = 'high';
  private lastRank: SkaterRankInfo | null = null;
  private lastMissions: SurfMission[] = [];
  private lastLbEntries: LeaderboardEntry[] = [];
  private lastLbSource: 'global' | 'local' = 'global';
  private lbHasLoaded = false;
  private rotateHintHandled = false;
  private rotateHintEl: HTMLElement | null = null;
  private rotateHintTimer: number | null = null;
  private namePromptModalEl: HTMLElement | null = null;
  private namePromptInputEl: HTMLInputElement | null = null;
  private namePromptErrorEl: HTMLElement | null = null;
  private namePromptAttempted = false;

  private getModeDesc(mode: GameModeId): string {
    switch (mode) {
      case 'flow_cup':
        return t('mode.flowCupDesc');
      case 'zen':
        return t('mode.zenDesc');
      case 'jam':
      default:
        return t('mode.jamDesc');
    }
  }

  constructor(
    parkSurface: ParkSurface,
    private onStartGame: () => void,
    private onSelectSkater?: (modelUrl: string, skater?: SkaterCharacter) => void,
    private onSelectPark?: (park: SkateparkLocation) => void,
    private onInspectPark?: (park: SkateparkLocation) => void,
    private onSelectBoard?: (board: SurfBoardSpec) => void
  ) {
    this.overlayEl = document.getElementById('landing-overlay')!;
    this.canvasEl = document.getElementById('landing-skater-canvas') as HTMLCanvasElement;
    this.noteEl = document.getElementById('landing-ig-note')!;
    this.noteTextEl = document.getElementById('landing-ig-note-text')!;
    this.startBtnEl = document.getElementById('landing-start-btn')!;
    this.playerNameEl =
      document.getElementById('landing-skater-name') ||
      this.overlayEl.querySelector('.sel-player-name');
    this.skaterStatsEl =
      document.getElementById('landing-skater-stats') ||
      this.overlayEl.querySelector('#sel-section-skater .sel-stats');
    this.boardNameEl = document.getElementById('landing-board-name');
    this.boardTaglineEl = document.getElementById('landing-board-tagline');
    this.boardStatsEl = document.getElementById('landing-board-stats');
    this.boardSlotWrapEl = document.getElementById('board-slot-wrap');
    this.boardIconWrapEl = document.getElementById('board-icon-wrap');
    this.boardLockBadgeEl = document.getElementById('landing-board-lock');
    this.boardLockTextEl = document.getElementById('landing-board-lock-text');
    this.updateSkaterDisplay();
    this.riderNameInputEl = document.getElementById('landing-player-name') as HTMLInputElement | null;
    this.parkSubtitleEl = document.getElementById('landing-park-subtitle') || this.overlayEl.querySelector('#sel-section-skatepark .sel-subtitle');
    this.parkThumbImgEl = document.getElementById('landing-park-thumb') as HTMLImageElement || this.overlayEl.querySelector('.park-thumb');
    this.parkInspectBtnEl = document.getElementById('landing-park-inspect-btn');
    this.soundBtnEl = document.getElementById('landing-sound-btn');
    this.modeDescEl = document.getElementById('landing-mode-desc');
    this.missionsCountEl = document.getElementById('landing-missions-count');
    this.langToggleBtnEl = document.getElementById('btn-lang-toggle');
    if (this.modeDescEl) {
      this.modeDescEl.textContent = this.getModeDesc(this.selectedGameMode);
    }

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
    this.updateBoardDisplay();
    this.updateLangToggleDisplay();
    applyDomTranslations(document);
    this.initMobileRotateHint();
    this.updateFullscreenLabel(this.lastIsFs);
    this.updateSoundLabel(this.lastSoundActive);
    this.updateQualityLabel(this.lastQualityPreset, this.lastQualityEffective);
    onLangChange(() => {
      this.refreshLocalizedUI();
    });
    this.handleResize();
  }

  private updateLangToggleDisplay(): void {
    if (!this.langToggleBtnEl) return;
    const lang = getLang();
    this.langToggleBtnEl.querySelectorAll<HTMLElement>('[data-lang-opt]').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-lang-opt') === lang);
    });
  }

  private refreshLocalizedUI(): void {
    this.updateLangToggleDisplay();
    this.updateBoardDisplay();
    if (this.modeDescEl) {
      this.modeDescEl.textContent = this.getModeDesc(this.selectedGameMode);
    }
    this.updateFullscreenLabel(this.lastIsFs);
    this.updateSoundLabel(this.lastSoundActive);
    this.updateQualityLabel(this.lastQualityPreset, this.lastQualityEffective);
    if (this.lastRank) {
      this.updateProgressionDisplay(this.lastRank, this.lastMissions);
    }
    if (this.lbHasLoaded) {
      if (this.lbSourceBadgeEl) {
        this.lbSourceBadgeEl.textContent =
          this.lastLbSource === 'global' ? t('lb.sourceGlobal') : t('lb.sourceLocal');
      }
      this.renderLeaderboardEntries(this.lastLbEntries);
    }
  }

  public async load(): Promise<void> {
    const currentSkater = this.getSelectedSkater();
    this.updateSkaterDisplay();
    this.updateParkDisplay();
    this.updateBoardDisplay();
    await this.skaterVisuals.load(currentSkater.modelUrl);
  }

  public updateSkaterDisplay(): void {
    const skater = this.getSelectedSkater();
    if (this.playerNameEl) {
      this.playerNameEl.textContent = skater.name;
    }
    if (this.skaterStatsEl) {
      const labels = [
        `FLOW ${skater.stats.flow}`,
        `PUMP ${skater.stats.pump}`,
        `AGILITY ${skater.stats.agility}`,
      ];
      const spans = this.skaterStatsEl.querySelectorAll('span');
      if (spans.length === labels.length) {
        spans.forEach((span, idx) => {
          span.textContent = labels[idx];
        });
      } else {
        this.skaterStatsEl.innerHTML = labels.map((label) => `<span>${label}</span>`).join('');
      }
    }
  }

  public updateParkDisplay(): void {
    const park = SKATEPARK_LOCATIONS[this.currentParkIndex];
    if (this.parkSubtitleEl) {
      this.parkSubtitleEl.textContent = park.subtitle;
    }
    if (this.parkThumbImgEl) {
      this.parkThumbImgEl.src = resolveAssetUrl(park.thumbUrl);
      this.parkThumbImgEl.alt = park.name;
    }
  }

  public getPreviewedBoard(): SurfBoardSpec {
    return SURF_BOARDS[this.currentBoardIndex] ?? SURF_BOARDS[0];
  }

  public getSelectedUnlockedBoard(): SurfBoardSpec {
    const previewed = this.getPreviewedBoard();
    if (isBoardUnlocked(previewed, this.boardUnlockProgress)) {
      return previewed;
    }
    const fallback = getBoardById(this.lastUnlockedBoardId);
    if (isBoardUnlocked(fallback, this.boardUnlockProgress)) {
      return fallback;
    }
    return SURF_BOARDS[0];
  }

  public refreshBoardUnlocks(progress: BoardUnlockProgress): SurfBoardId[] {
    const prevUnlocked = new Set(
      SURF_BOARDS.filter((b) => isBoardUnlocked(b, this.boardUnlockProgress)).map((b) => b.id)
    );
    this.boardUnlockProgress = { ...progress };

    const newlyUnlocked: SurfBoardId[] = [];
    for (const board of SURF_BOARDS) {
      const unlockedNow = isBoardUnlocked(board, this.boardUnlockProgress);
      if (this.hasInitializedBoardUnlocks && unlockedNow && !prevUnlocked.has(board.id)) {
        newlyUnlocked.push(board.id);
      }
    }

    if (!this.hasInitializedBoardUnlocks) {
      this.hasInitializedBoardUnlocks = true;
      const initialBoard = this.getPreviewedBoard();
      if (isBoardUnlocked(initialBoard, this.boardUnlockProgress)) {
        this.lastUnlockedBoardId = initialBoard.id;
      } else {
        this.currentBoardIndex = 0;
        this.lastUnlockedBoardId = SURF_BOARDS[0].id;
        setSelectedBoardId(this.lastUnlockedBoardId);
      }
    } else if (!isBoardUnlocked(getBoardById(this.lastUnlockedBoardId), this.boardUnlockProgress)) {
      this.lastUnlockedBoardId = SURF_BOARDS[0].id;
    }

    this.updateBoardDisplay();
    return newlyUnlocked;
  }

  public updateBoardDisplay(): void {
    const board = this.getPreviewedBoard();
    const unlocked = isBoardUnlocked(board, this.boardUnlockProgress);
    const isGold = board.id === 'golden_pretzel';

    if (this.boardNameEl) {
      this.boardNameEl.textContent = board.name;
      this.boardNameEl.classList.toggle('is-gold', isGold);
    }
    if (this.boardTaglineEl) {
      this.boardTaglineEl.textContent = t(board.taglineKey);
      this.boardTaglineEl.classList.toggle('is-gold', isGold);
    }
    if (this.boardStatsEl) {
      const labels = [
        `${t('board.statCarve')} ${board.stats.carve}`,
        `${t('board.statSpeed')} ${board.stats.speed}`,
        `${t('board.statPop')} ${board.stats.pop}`,
      ];
      const spans = this.boardStatsEl.querySelectorAll('span');
      if (spans.length === labels.length) {
        spans.forEach((span, idx) => {
          span.textContent = labels[idx];
        });
      } else {
        this.boardStatsEl.innerHTML = labels.map((label) => `<span>${label}</span>`).join('');
      }
    }

    // Render bottom-up surfskate deck showcase SVG with board-specific shape, artwork & wheels
    if (this.boardIconWrapEl) {
      this.boardIconWrapEl.innerHTML = this.buildBoardShowcaseSvg(board);
    }

    if (this.boardSlotWrapEl) {
      this.boardSlotWrapEl.classList.toggle('is-locked', !unlocked);
    }
    if (this.boardLockBadgeEl) {
      this.boardLockBadgeEl.classList.toggle('hidden', unlocked);
    }
    if (this.boardLockTextEl) {
      this.boardLockTextEl.textContent = !unlocked && board.unlockKey ? t(board.unlockKey) : '';
    }

    // Live-update 3D board showcase on Landing Page
    this.skaterVisuals.setBoardSpec(board);
  }

  private buildBoardShowcaseSvg(board: SurfBoardSpec): string {
    const svg = board.svgColors;
    const isSwallow = board.id === 'isar_swallowtail';
    const isCruiser = board.id === 'sunset_cruiser';
    const isGold = board.id === 'golden_pretzel';
    const hasGlowWheels = isSwallow || isGold;

    // Deck outline path (horizontal bottom-up view: nose left, tail right)
    const deckPath = isSwallow
      ? 'M24 31 C24 14, 46 9.5, 76 10 L176 11.5 C192 12, 201 13.5, 204 16 L183 31 L204 46 C201 48.5, 192 50, 176 50.5 L76 52 C46 52.5, 24 48, 24 31 Z'
      : isCruiser
        ? 'M6 31 C16 18, 42 11.5, 82 11.5 L168 12.5 C196 13.5, 214 21, 222 31 C214 41, 196 48.5, 168 49.5 L82 50.5 C42 50.5, 16 44, 6 31 Z'
        : isGold
          ? 'M16 31 C16 14.5, 38 10.5, 70 10.5 L176 11 C197 12, 210 17, 212 31 C210 45, 197 50, 176 51 L70 51.5 C38 51.5, 16 47.5, 16 31 Z'
          : 'M18 31 C18 15, 39 11, 68 11 L172 12 C194 13, 208 18, 210 31 C208 44, 194 49, 172 50 L68 51 C39 51, 18 47, 18 31 Z';

    const frontTruckX = isCruiser ? 54 : isSwallow ? 60 : 56;
    const rearTruckX = isCruiser ? 174 : isSwallow ? 164 : 170;

    // Build spiral curve points for the_spiral
    let spiralPoints = '';
    if (board.id === 'the_spiral') {
      const pts: string[] = [];
      for (let a = 0; a <= Math.PI * 6.4; a += 0.28) {
        const r = 1.0 + a * 0.65;
        const px = (114 + Math.cos(a) * r).toFixed(1);
        const py = (31 + Math.sin(a) * r).toFixed(1);
        pts.push(`${a === 0 ? 'M' : 'L'}${px} ${py}`);
      }
      spiralPoints = pts.join(' ');
    }

    const deckFillDefs = isGold
      ? `<linearGradient id="bsvg-deck-bg" x1="0%" y1="0%" x2="100%" y2="100%">
           <stop offset="0%" stop-color="#fef08a"/>
           <stop offset="28%" stop-color="#f59e0b"/>
           <stop offset="52%" stop-color="#fef9c3"/>
           <stop offset="78%" stop-color="#d97706"/>
           <stop offset="100%" stop-color="#fde047"/>
         </linearGradient>`
      : isCruiser
        ? `<linearGradient id="bsvg-deck-bg" x1="0%" y1="50%" x2="100%" y2="50%">
             <stop offset="0%" stop-color="#2e1065"/>
             <stop offset="32%" stop-color="#831843"/>
             <stop offset="62%" stop-color="#ff3d8a"/>
             <stop offset="84%" stop-color="#ff7b1c"/>
             <stop offset="100%" stop-color="#ffd54a"/>
           </linearGradient>
           <linearGradient id="bsvg-sun-disc" x1="0%" y1="0%" x2="0%" y2="100%">
             <stop offset="0%" stop-color="#fef08a"/>
             <stop offset="55%" stop-color="#ff7b1c"/>
             <stop offset="100%" stop-color="#ff3d8a"/>
           </linearGradient>`
        : isSwallow
          ? `<linearGradient id="bsvg-deck-bg" x1="0%" y1="0%" x2="100%" y2="100%">
               <stop offset="0%" stop-color="#ecfeff"/>
               <stop offset="28%" stop-color="#99f6e4"/>
               <stop offset="65%" stop-color="#00e5d4"/>
               <stop offset="100%" stop-color="#0f766e"/>
             </linearGradient>`
          : `<linearGradient id="bsvg-deck-bg" x1="0%" y1="0%" x2="100%" y2="100%">
               <stop offset="0%" stop-color="#f2c48d"/>
               <stop offset="48%" stop-color="#d28d4b"/>
               <stop offset="100%" stop-color="#9c5a22"/>
             </linearGradient>`;

    const deckArt =
      board.id === 'the_spiral'
        ? `
          <g clip-path="url(#bsvg-deck-clip)">
            <line x1="22" y1="21" x2="206" y2="22" stroke="rgba(72,34,10,0.2)" stroke-width="1"/>
            <line x1="22" y1="41" x2="206" y2="40" stroke="rgba(72,34,10,0.2)" stroke-width="1"/>
            <rect x="18" y="28.5" width="192" height="5" fill="#1c1917"/>
            <rect x="18" y="30" width="192" height="2" fill="#ff6b1a"/>
            <circle cx="114" cy="31" r="15.5" fill="#181411" stroke="#fef3c7" stroke-width="1.2"/>
            <path d="${spiralPoints}" fill="none" stroke="#ff6b1a" stroke-width="2" stroke-linecap="round"/>
          </g>
        `
        : board.id === 'isar_swallowtail'
          ? `
            <g clip-path="url(#bsvg-deck-clip)">
              <rect x="24" y="8" width="44" height="46" fill="#ecfeff"/>
              <polygon points="72,8 92,8 66,54 46,54" fill="#0891b2"/>
              <polygon points="94,8 103,8 77,54 68,54" fill="#fef3c7"/>
              <polygon points="146,8 156,8 132,54 122,54" fill="#083344"/>
              <polygon points="158,8 167,8 143,54 134,54" fill="#ecfeff"/>
              <circle cx="114" cy="31" r="14.5" fill="#083344" stroke="#99f6e4" stroke-width="1.4"/>
              <path d="M103 26.5 Q109 22 114 26 Q119 30 125 25" fill="none" stroke="#ecfeff" stroke-width="1.7" stroke-linecap="round"/>
              <path d="M102 31.5 Q108 27 114 31 Q120 35 126 30" fill="none" stroke="#00e5d4" stroke-width="1.9" stroke-linecap="round"/>
              <path d="M103 36.5 Q109 32 114 36 Q119 40 125 35" fill="none" stroke="#ecfeff" stroke-width="1.7" stroke-linecap="round"/>
              <path d="M204 16 L183 31 L204 46" fill="none" stroke="#083344" stroke-width="2.5"/>
            </g>
          `
          : board.id === 'sunset_cruiser'
            ? `
              <g clip-path="url(#bsvg-deck-clip)">
                <rect x="6" y="21.5" width="216" height="1.6" fill="rgba(255,255,255,0.32)"/>
                <rect x="6" y="38.9" width="216" height="1.6" fill="rgba(255,255,255,0.32)"/>
                <circle cx="112" cy="31" r="14.5" fill="url(#bsvg-sun-disc)" stroke="#3b0764" stroke-width="1.2"/>
                <rect x="97" y="32" width="30" height="1.7" fill="#3b0764"/>
                <rect x="97" y="35.5" width="30" height="1.8" fill="#3b0764"/>
                <rect x="99" y="39" width="26" height="1.8" fill="#3b0764"/>
                <path d="M188 22 L196 31 L188 40 M197 23 L204 31 L197 39" fill="none" stroke="#fef08a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </g>
            `
            : `
              <g clip-path="url(#bsvg-deck-clip)">
                <line x1="18" y1="17" x2="210" y2="17" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
                <line x1="18" y1="24" x2="210" y2="24" stroke="rgba(120,53,15,0.16)" stroke-width="1"/>
                <line x1="18" y1="38" x2="210" y2="38" stroke="rgba(120,53,15,0.16)" stroke-width="1"/>
                <line x1="18" y1="45" x2="210" y2="45" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
                <path d="M32 31 C32 19, 48 14.5, 72 14.5 L174 15 C191 15.5, 202 19.5, 204 31 C202 42.5, 191 46.5, 174 47 L72 47.5 C48 47.5, 32 43, 32 31 Z" fill="none" stroke="#17130d" stroke-width="1.8"/>
                <circle cx="114" cy="31" r="15.5" fill="#17130d" stroke="#fef08a" stroke-width="1.4"/>
                <path d="M114 39.5 C102 39.5, 100 28.5, 107 23.5 C111.5 20, 116.5 26.5, 119 33 C121 38, 124.5 37, 125 32 C125.5 27, 121.5 22, 116.5 23 C112.5 24, 110.5 30.5, 108.5 34 C106 38, 109 39.5, 114 39.5 Z" fill="none" stroke="#ffd54a" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="106.5" cy="27.5" r="0.9" fill="#fefce8"/>
                <circle cx="121.5" cy="27.5" r="0.9" fill="#fefce8"/>
                <circle cx="114" cy="25" r="0.9" fill="#fefce8"/>
              </g>
            `;

    const drawWheel = (cx: number, cy: number) => `
      ${hasGlowWheels ? `<rect x="${cx - 10.5}" y="${cy - 5.5}" width="21" height="11" rx="4" fill="${svg.accent}" opacity="0.32"/>` : ''}
      <rect x="${cx - 9}" y="${cy - 4.2}" width="18" height="8.4" rx="2.8" fill="url(#bsvg-wheel)" stroke="${svg.wheelStroke}" stroke-width="0.9"/>
      <line x1="${cx - 5.5}" y1="${cy - 2.3}" x2="${cx + 5.5}" y2="${cy - 2.3}" stroke="rgba(255,255,255,0.45)" stroke-width="1.1" stroke-linecap="round"/>
    `;

    const drawTruck = (cx: number, isFront: boolean) => `
      <rect x="${cx - 5}" y="13" width="10" height="36" rx="2" fill="url(#bsvg-truck)" stroke="#334155" stroke-width="0.6" opacity="0.24"/>
      <rect x="${cx - 2.3}" y="10" width="4.6" height="42" rx="1.6" fill="url(#bsvg-truck)" stroke="#334155" stroke-width="0.7"/>
      <rect x="${cx - 6.5}" y="23" width="13" height="16" rx="2.5" fill="#1e293b" stroke="#94a3b8" stroke-width="0.7"/>
      ${
        isFront
          ? `<rect x="${cx - 4}" y="25.5" width="8" height="11" rx="2" fill="url(#bsvg-truck)"/><circle cx="${cx}" cy="31" r="2.3" fill="${svg.accent}"/>`
          : `<circle cx="${cx}" cy="31" r="3" fill="url(#bsvg-truck)"/><circle cx="${cx}" cy="31" r="1.4" fill="${svg.accent}"/>`
      }
    `;

    return `
      <svg class="board-icon-svg" viewBox="0 0 228 62" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          ${deckFillDefs}
          <linearGradient id="bsvg-wheel" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${svg.wheelStops[0]}"/>
            <stop offset="45%" stop-color="${svg.wheelStops[1]}"/>
            <stop offset="85%" stop-color="${svg.wheelStops[2]}"/>
            <stop offset="100%" stop-color="${svg.wheelStops[3]}"/>
          </linearGradient>
          <linearGradient id="bsvg-truck" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#94a3b8"/>
            <stop offset="45%" stop-color="#f8fafc"/>
            <stop offset="100%" stop-color="#64748b"/>
          </linearGradient>
          <clipPath id="bsvg-deck-clip">
            <path d="${deckPath}"/>
          </clipPath>
        </defs>
        ${drawWheel(frontTruckX, 7.5)}
        ${drawWheel(frontTruckX, 54.5)}
        ${drawWheel(rearTruckX, 7.5)}
        ${drawWheel(rearTruckX, 54.5)}
        <path d="${deckPath}" fill="url(#bsvg-deck-bg)" stroke="${svg.deckStroke}" stroke-width="1.6"/>
        ${deckArt}
        <path d="${deckPath}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.7"/>
        ${drawTruck(frontTruckX, true)}
        ${drawTruck(rearTruckX, false)}
      </svg>
    `;
  }

  public getSelectedPark(): SkateparkLocation {
    return SKATEPARK_LOCATIONS[this.currentParkIndex];
  }

  public getSelectedSkater(): SkaterCharacter {
    return SKATER_CHARACTERS[this.currentSkaterIndex];
  }

  public getSelectedSkaterModel(): string {
    return this.getSelectedSkater().modelUrl;
  }

  public getSelectedGameMode(): GameModeId {
    return this.selectedGameMode;
  }

  public setGameMode(mode: GameModeId): void {
    this.selectedGameMode = mode;
    try {
      localStorage.setItem('surfsk8.gameMode', mode);
    } catch {}
    this.syncModePills();
    if (this.modeDescEl) {
      this.modeDescEl.textContent = this.getModeDesc(mode);
    }
    this.onSelectGameMode?.(mode);
  }

  private syncModePills(): void {
    for (const btn of this.modePillBtns) {
      btn.classList.toggle('active', btn.dataset.mode === this.selectedGameMode);
    }
  }

  public updateProgressionDisplay(rank: SkaterRankInfo, missions: SurfMission[]): void {
    this.lastRank = rank;
    this.lastMissions = missions;
    if (this.rankBadgeEl) {
      this.rankBadgeEl.textContent = rank.fullLabel;
    }
    if (this.missionsCountEl) {
      const done = missions.filter((m) => m.completed).length;
      this.missionsCountEl.textContent = t('landing.missionsCount', { done, total: missions.length });
    }
    if (this.missionsListEl) {
      const doneText = t('common.done');
      this.missionsListEl.innerHTML = missions
        .map((m) => {
          const check = m.completed ? '☑️' : '⬜';
          const progStr = m.completed
            ? doneText
            : `${formatNum(m.progress)}/${formatNum(m.target)}${m.unit ? ' ' + m.unit : ''}`;
          return `
            <div class="landing-mission-row ${m.completed ? 'done' : ''}">
              <span class="m-title">${check} ${m.shortTitle}</span>
              <span class="m-prog">${progStr}</span>
            </div>
          `.trim();
        })
        .join('');
    }
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

    // Segmented tab buttons for setup switcher (SKATER | PARK | BOARD)
    const tabBtns = this.overlayEl.querySelectorAll<HTMLButtonElement>('.landing-tab-btn');
    tabBtns.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabKind = tab.dataset.tab as SelectorCategory;
        if (tabKind) {
          this.setActiveCategory(tabKind);
        }
      });
    });

    if (this.soundBtnEl) {
      this.soundBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onToggleSound?.();
      });
    }

    if (this.langToggleBtnEl) {
      this.langToggleBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLang();
      });
    }

    // Row hover & click synchronization with keyboard active index
    SELECTOR_CATEGORIES.forEach((cat, idx) => {
      const sectionEl = document.getElementById(`sel-section-${cat}`);
      if (sectionEl) {
        sectionEl.addEventListener('mouseenter', () => {
          this.activeFocusIndex = idx;
          this.updateActiveSectionVisuals();
        });
        sectionEl.addEventListener('click', () => {
          this.activeFocusIndex = idx;
          this.updateActiveSectionVisuals();
        });
      }
    });

    const modeSectionEl = this.overlayEl.querySelector('.landing-mode-section');
    if (modeSectionEl) {
      modeSectionEl.addEventListener('mouseenter', () => {
        this.activeFocusIndex = 3;
        this.updateActiveSectionVisuals();
      });
      modeSectionEl.addEventListener('click', () => {
        this.activeFocusIndex = 3;
        this.updateActiveSectionVisuals();
      });
    }

    if (this.startBtnEl) {
      this.startBtnEl.addEventListener('mouseenter', () => {
        this.activeFocusIndex = 4;
        this.updateActiveSectionVisuals();
      });
    }

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
          window.open(resolveAssetUrl(park.viewerUrl || 'viewer.html'), '_blank');
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
        this.triggerSelect('board', 1);
      });
    }

    const triggerStart = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.startGame();
    };
    this.startBtnEl.addEventListener('click', triggerStart);
    this.startBtnEl.addEventListener('touchend', triggerStart, { passive: false });

    this.rankBadgeEl = document.getElementById('landing-rank-badge');
    this.missionsListEl = document.getElementById('landing-missions-list');
    this.modePillBtns = Array.from(
      this.overlayEl.querySelectorAll<HTMLButtonElement>('#landing-mode-selector .mode-pill-btn')
    );
    this.modePillBtns.forEach((btn) => {
      const selectHandler = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = (btn.dataset.mode || 'jam') as GameModeId;
        this.setGameMode(mode);
      };
      btn.addEventListener('click', selectHandler);
      btn.addEventListener('touchend', selectHandler, { passive: false });
    });
    this.syncModePills();

    this.settingsBtnEl = document.getElementById('btn-landing-settings');
    this.settingsPopoverEl = document.getElementById('landing-settings-popover');
    if (this.settingsBtnEl && this.settingsPopoverEl) {
      this.settingsBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSettingsPopover();
      });
      this.settingsPopoverEl.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      document.addEventListener('click', (e) => {
        if (!this.isSettingsPopoverOpen()) return;
        const target = e.target as Node | null;
        if (
          target &&
          (this.settingsPopoverEl?.contains(target) || this.settingsBtnEl?.contains(target))
        ) {
          return;
        }
        this.closeSettingsPopover();
      });
    }

    this.qualityBtnEl = document.getElementById('landing-quality-btn');
    if (this.qualityBtnEl) {
      this.qualityBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onCycleQuality?.();
      });
    }

    this.fullscreenBtnEl = document.getElementById('landing-fullscreen-btn');
    if (this.fullscreenBtnEl) {
      this.fullscreenBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onToggleFullscreen?.();
        (this.fullscreenBtnEl as HTMLElement).blur();
      });
    }

    // Tutorial replay row inside settings popover
    const tutorialBtn = document.getElementById('landing-tutorial-btn');
    tutorialBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSettingsPopover();
      this.onOpenTutorial?.();
    });

    // Terms & Privacy Modal
    const termsBtn = document.getElementById('landing-terms-btn');
    const termsModal = document.getElementById('terms-modal');
    const termsCloseBtn = document.getElementById('terms-modal-close');
    const termsOkBtn = document.getElementById('terms-modal-ok-btn');
    const termsBackdrop = termsModal?.querySelector('.terms-modal-backdrop');

    const openTerms = (e: Event) => {
      e.stopPropagation();
      this.closeSettingsPopover();
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

    // Rider Name Input (Leaderboard Nickname)
    if (this.riderNameInputEl) {
      this.riderNameInputEl.value = getPlayerName();
      this.riderNameInputEl.addEventListener('input', () => {
        if (this.riderNameInputEl) {
          setPlayerName(this.riderNameInputEl.value);
        }
      });
      this.riderNameInputEl.addEventListener('blur', () => {
        if (this.riderNameInputEl) {
          this.riderNameInputEl.value = setPlayerName(this.riderNameInputEl.value);
        }
      });
      this.riderNameInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          this.riderNameInputEl?.blur();
        }
      });
    }

    // Global Leaderboard Modal (#leaderboard-modal)
    this.leaderboardModalEl = document.getElementById('leaderboard-modal');
    this.lbListEl = document.getElementById('lb-list');
    this.lbSourceBadgeEl = document.getElementById('lb-source-badge');
    const lbOpenBtn = document.getElementById('btn-leaderboard');
    const lbCloseBtn = document.getElementById('lb-modal-close');
    const lbOkBtn = document.getElementById('lb-modal-ok-btn');
    const lbBackdrop = document.getElementById('lb-modal-backdrop');

    lbOpenBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openLeaderboardModal('all');
    });
    lbCloseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLeaderboardModal();
    });
    lbOkBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLeaderboardModal();
    });
    lbBackdrop?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLeaderboardModal();
    });

    if (this.leaderboardModalEl) {
      this.lbTabBtns = Array.from(
        this.leaderboardModalEl.querySelectorAll<HTMLButtonElement>('#lb-tabs .lb-tab-btn')
      );
      this.lbTabBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const park = (btn.dataset.park || 'all') as LeaderboardPark;
          void this.loadLeaderboardTab(park);
        });
      });
    }

    // First-Launch Rider Name Prompt Modal (#name-prompt-modal — Issue #41)
    this.namePromptModalEl = document.getElementById('name-prompt-modal');
    this.namePromptInputEl = document.getElementById('name-prompt-input') as HTMLInputElement | null;
    this.namePromptErrorEl = document.getElementById('name-prompt-error');
    const namePromptBackdrop = document.getElementById('name-prompt-backdrop');
    const namePromptSaveBtn = document.getElementById('name-prompt-save');
    const namePromptSkipBtn = document.getElementById('name-prompt-skip');

    namePromptSaveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleNamePromptSave();
    });
    namePromptSkipBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleNamePromptSkip();
    });
    namePromptBackdrop?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleNamePromptSkip();
    });

    if (this.namePromptInputEl) {
      this.namePromptInputEl.addEventListener('input', () => {
        if (this.namePromptErrorEl && !this.namePromptErrorEl.classList.contains('hidden')) {
          this.namePromptErrorEl.classList.add('hidden');
          this.namePromptErrorEl.textContent = '';
        }
      });
      this.namePromptInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          this.handleNamePromptSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.handleNamePromptSkip();
        }
      });
    }

    this.updateActiveSectionVisuals();
  }

  private initMobileRotateHint(): void {
    if (this.rotateHintHandled) return;
    this.rotateHintHandled = true;

    const isTouchDevice =
      window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const isSmallViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;
    const isPortrait = window.innerHeight > window.innerWidth;

    if (!isTouchDevice || !isSmallViewport || !isPortrait) return;

    this.rotateHintEl = document.getElementById('mobile-rotate-hint');
    if (!this.rotateHintEl) return;

    const dismiss = () => {
      if (this.rotateHintTimer !== null) {
        window.clearTimeout(this.rotateHintTimer);
        this.rotateHintTimer = null;
      }
      window.removeEventListener('resize', onOrientationCheck);
      window.removeEventListener('orientationchange', onOrientationCheck);
      this.rotateHintEl?.classList.add('hidden');
    };

    const onOrientationCheck = () => {
      if (window.innerWidth > window.innerHeight) {
        dismiss();
      }
    };

    this.rotateHintEl.classList.remove('hidden');
    this.rotateHintEl.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    }, { once: true });
    window.addEventListener('resize', onOrientationCheck);
    window.addEventListener('orientationchange', onOrientationCheck);

    this.rotateHintTimer = window.setTimeout(dismiss, 5000);
  }

  private markNamePromptSeen(): void {
    try {
      localStorage.setItem(NAME_PROMPT_SEEN_KEY, '1');
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }

  private hasSeenNamePrompt(): boolean {
    try {
      return localStorage.getItem(NAME_PROMPT_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  public isNamePromptModalOpen(): boolean {
    return Boolean(this.namePromptModalEl && !this.namePromptModalEl.classList.contains('hidden'));
  }

  public closeNamePromptModal(): void {
    this.namePromptModalEl?.classList.add('hidden');
  }

  public maybeShowFirstLaunchNamePrompt(): void {
    if (this.namePromptAttempted || !this.isVisible || !this.namePromptModalEl) return;
    this.namePromptAttempted = true;

    if (getPlayerName().length >= 2 || this.hasSeenNamePrompt()) {
      return;
    }

    if (this.namePromptInputEl) {
      this.namePromptInputEl.value = '';
    }
    if (this.namePromptErrorEl) {
      this.namePromptErrorEl.textContent = '';
      this.namePromptErrorEl.classList.add('hidden');
    }

    this.namePromptModalEl.classList.remove('hidden');

    if (!window.matchMedia('(pointer: coarse)').matches) {
      window.requestAnimationFrame(() => {
        this.namePromptInputEl?.focus();
      });
    }
  }

  private handleNamePromptSave(): void {
    const raw = this.namePromptInputEl?.value || '';
    const clean = sanitizePlayerName(raw);
    if (clean.length < 2) {
      if (this.namePromptErrorEl) {
        this.namePromptErrorEl.textContent = t('namePrompt.errorMin');
        this.namePromptErrorEl.classList.remove('hidden');
      }
      this.namePromptInputEl?.focus();
      return;
    }

    const saved = setPlayerName(clean);
    if (this.riderNameInputEl) {
      this.riderNameInputEl.value = saved;
    }
    this.markNamePromptSeen();
    this.closeNamePromptModal();
  }

  private handleNamePromptSkip(): void {
    this.markNamePromptSeen();
    this.closeNamePromptModal();
  }

  public syncRiderNameInput(): void {
    if (this.riderNameInputEl) {
      this.riderNameInputEl.value = getPlayerName();
    }
  }

  public isSettingsPopoverOpen(): boolean {
    return Boolean(this.settingsPopoverEl && !this.settingsPopoverEl.classList.contains('hidden'));
  }

  public openSettingsPopover(): void {
    if (!this.settingsPopoverEl || !this.settingsBtnEl) return;
    this.settingsPopoverEl.classList.remove('hidden');
    this.settingsBtnEl.classList.add('is-open');
    this.settingsBtnEl.setAttribute('aria-expanded', 'true');
  }

  public closeSettingsPopover(): void {
    if (!this.settingsPopoverEl || !this.settingsBtnEl) return;
    this.settingsPopoverEl.classList.add('hidden');
    this.settingsBtnEl.classList.remove('is-open');
    this.settingsBtnEl.setAttribute('aria-expanded', 'false');
  }

  public toggleSettingsPopover(): void {
    if (this.isSettingsPopoverOpen()) {
      this.closeSettingsPopover();
    } else {
      this.openSettingsPopover();
    }
  }

  public isLeaderboardModalOpen(): boolean {
    return Boolean(this.leaderboardModalEl && !this.leaderboardModalEl.classList.contains('hidden'));
  }

  public openLeaderboardModal(park: LeaderboardPark = 'all'): void {
    this.closeSettingsPopover();
    if (!this.leaderboardModalEl) return;
    this.leaderboardModalEl.classList.remove('hidden');
    void this.loadLeaderboardTab(park);
  }

  public closeLeaderboardModal(): void {
    this.leaderboardModalEl?.classList.add('hidden');
  }

  private async loadLeaderboardTab(park: LeaderboardPark): Promise<void> {
    this.activeLbPark = park;
    this.lbTabBtns.forEach((btn) => {
      const active = btn.dataset.park === park;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const token = ++this.lbFetchToken;
    if (this.lbListEl) {
      this.lbListEl.innerHTML = `<div class="lb-state-msg">${t('lb.loading')}</div>`;
    }

    const { entries, source } = await fetchLeaderboard(park, 15);
    if (token !== this.lbFetchToken) return;

    this.lastLbEntries = entries;
    this.lastLbSource = source;
    this.lbHasLoaded = true;

    if (this.lbSourceBadgeEl) {
      this.lbSourceBadgeEl.textContent =
        source === 'global' ? t('lb.sourceGlobal') : t('lb.sourceLocal');
      this.lbSourceBadgeEl.classList.toggle('local', source !== 'global');
    }

    this.renderLeaderboardEntries(entries);
  }

  private renderLeaderboardEntries(entries: LeaderboardEntry[]): void {
    if (!this.lbListEl) return;
    if (entries.length === 0) {
      this.lbListEl.innerHTML = `<div class="lb-state-msg">${t('lb.empty')}</div>`;
      return;
    }

    const currentPlayer = getPlayerName().toLowerCase();
    const youTag = t('lb.youTag');
    this.lbListEl.innerHTML = '';

    for (const entry of entries) {
      const row = document.createElement('div');
      const rankClass = entry.rank <= 3 ? ` rank-${entry.rank}` : '';
      const isMe = currentPlayer.length >= 2 && entry.name.toLowerCase() === currentPlayer;
      row.className = `lb-row${rankClass}${isMe ? ' is-me' : ''}`;

      const rankEl = document.createElement('span');
      rankEl.className = 'lb-rank';
      rankEl.textContent =
        entry.rank === 1
          ? '🥇'
          : entry.rank === 2
            ? '🥈'
            : entry.rank === 3
              ? '🥉'
              : `#${entry.rank}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'lb-name';
      nameEl.textContent = isMe ? `${entry.name} (${youTag})` : entry.name;

      const scoreEl = document.createElement('span');
      scoreEl.className = 'lb-score';
      scoreEl.textContent = formatNum(entry.score);

      row.append(rankEl, nameEl, scoreEl);
      this.lbListEl.appendChild(row);
    }
  }

  public handleKeyDown(code: string): void {
    if (this.isNamePromptModalOpen()) {
      if (code === 'Escape') {
        this.handleNamePromptSkip();
      }
      return;
    }

    const activeEl = document.activeElement as HTMLElement | null;
    const tag = activeEl?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable) {
      return;
    }

    if (code === 'Escape') {
      if (this.isSettingsPopoverOpen()) {
        this.closeSettingsPopover();
        return;
      }
      if (this.isLeaderboardModalOpen()) {
        this.closeLeaderboardModal();
        return;
      }
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
    if (code === 'Enter' || code === 'NumpadEnter' || (code === 'Space' && LANDING_FOCUS_ROWS[this.activeFocusIndex] === 'start')) {
      this.startGame();
      return;
    }
    if (code === 'ArrowDown' || code === 'KeyS') {
      this.activeFocusIndex = (this.activeFocusIndex + 1) % LANDING_FOCUS_ROWS.length;
      this.updateActiveSectionVisuals();
    } else if (code === 'ArrowUp' || code === 'KeyW') {
      this.activeFocusIndex =
        (this.activeFocusIndex - 1 + LANDING_FOCUS_ROWS.length) % LANDING_FOCUS_ROWS.length;
      this.updateActiveSectionVisuals();
    } else if (code === 'ArrowLeft' || code === 'KeyA') {
      const row = LANDING_FOCUS_ROWS[this.activeFocusIndex];
      if (row === 'skater' || row === 'park' || row === 'board') {
        const cat = row === 'park' ? 'skatepark' : row;
        this.triggerSelect(cat, -1);
      } else if (row === 'mode') {
        this.cycleGameMode(-1);
      }
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      const row = LANDING_FOCUS_ROWS[this.activeFocusIndex];
      if (row === 'skater' || row === 'park' || row === 'board') {
        const cat = row === 'park' ? 'skatepark' : row;
        this.triggerSelect(cat, 1);
      } else if (row === 'mode') {
        this.cycleGameMode(1);
      }
    }
  }

  public cycleGameMode(dir: number): void {
    const modes: GameModeId[] = ['jam', 'flow_cup', 'zen'];
    let idx = modes.indexOf(this.selectedGameMode);
    if (idx === -1) idx = 0;
    idx = (idx + dir + modes.length) % modes.length;
    this.setGameMode(modes[idx]);
    this.activeFocusIndex = 3;
    this.updateActiveSectionVisuals();
  }

  public getCurrentFocusRow(): LandingFocusRow {
    return LANDING_FOCUS_ROWS[this.activeFocusIndex];
  }

  public setActiveCategory(kind: SelectorCategory): void {
    const idx = SELECTOR_CATEGORIES.indexOf(kind);
    if (idx !== -1) {
      this.activeFocusIndex = idx;
      this.updateActiveSectionVisuals();
    }
  }

  private updateActiveSectionVisuals(): void {
    const currentRow = LANDING_FOCUS_ROWS[this.activeFocusIndex];

    SELECTOR_CATEGORIES.forEach((cat, idx) => {
      const rowName: LandingFocusRow = idx === 0 ? 'skater' : idx === 1 ? 'park' : 'board';
      const el = document.getElementById(`sel-section-${cat}`);
      const tabEl = this.overlayEl.querySelector<HTMLButtonElement>(`.landing-tab-btn[data-tab="${cat}"]`);
      const isActive = rowName === currentRow;
      if (el) {
        el.classList.toggle('active', isActive || idx === (this.activeFocusIndex < 3 ? this.activeFocusIndex : 0));
        el.classList.toggle('focused-row', isActive);
      }
      if (tabEl) {
        tabEl.classList.toggle('active', isActive);
        tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
    });

    const modeEl = this.overlayEl.querySelector('.landing-mode-section');
    if (modeEl) {
      modeEl.classList.toggle('focused-row', currentRow === 'mode');
    }

    if (this.startBtnEl) {
      this.startBtnEl.classList.toggle('focused-row', currentRow === 'start');
    }
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
      const skater = this.getSelectedSkater();
      this.updateSkaterDisplay();
      void this.skaterVisuals.load(skater.modelUrl);
      if (this.onSelectSkater) {
        this.onSelectSkater(skater.modelUrl, skater);
      }
      this.showInstagramPrompt('skater', btn || rowEl || undefined);
    } else if (kind === 'skatepark') {
      this.currentParkIndex =
        (this.currentParkIndex + dir + SKATEPARK_LOCATIONS.length) % SKATEPARK_LOCATIONS.length;
      const park = SKATEPARK_LOCATIONS[this.currentParkIndex];
      this.updateParkDisplay();
      this.revertParkView();
      if (this.onSelectPark) {
        this.onSelectPark(park);
      }
    } else if (kind === 'board') {
      this.currentBoardIndex =
        (this.currentBoardIndex + dir + SURF_BOARDS.length) % SURF_BOARDS.length;
      const board = this.getPreviewedBoard();
      this.revertBoardView();
      this.updateBoardDisplay();
      const row = (btn || rowEl)?.closest<HTMLElement>('.sel-section') || rowEl;
      if (row) {
        row.classList.remove('bump');
        void row.offsetWidth;
        row.classList.add('bump');
        setTimeout(() => row.classList.remove('bump'), 320);
      }
      if (isBoardUnlocked(board, this.boardUnlockProgress)) {
        this.lastUnlockedBoardId = board.id;
        setSelectedBoardId(board.id);
        this.onSelectBoard?.(board);
      }
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

  public updateFullscreenLabel(isFs: boolean): void {
    this.lastIsFs = isFs;
    if (!this.fullscreenBtnEl) return;
    const iconPath = isFs
      ? 'M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 4v6m0 0H4m6 0L3 3m10 7h6m-6 0V4m0 6l7-7'
      : 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3';
    const pathEl = this.fullscreenBtnEl.querySelector<SVGPathElement>('.landing-fs-icon path');
    if (pathEl) {
      pathEl.setAttribute('d', iconPath);
    }
    const labelEl = this.fullscreenBtnEl.querySelector('.settings-row-label');
    if (labelEl) {
      labelEl.textContent = t('nav.fullscreenMenuLabel');
    }
    const badgeEl = this.fullscreenBtnEl.querySelector('.settings-row-badge');
    if (badgeEl) {
      badgeEl.textContent = isFs ? t('nav.stateOn') : t('nav.stateOff');
    }
    this.fullscreenBtnEl.classList.toggle('is-active', isFs);
  }

  public updateSoundLabel(isActive: boolean): void {
    this.lastSoundActive = isActive;
    if (!this.soundBtnEl) return;
    const iconEl = this.soundBtnEl.querySelector('.settings-row-icon');
    const labelEl = this.soundBtnEl.querySelector('.settings-row-label');
    const badgeEl = this.soundBtnEl.querySelector('.settings-row-badge');
    if (iconEl) iconEl.textContent = isActive ? '🔊' : '🔇';
    if (labelEl) labelEl.textContent = t('nav.soundMenuLabel');
    if (badgeEl) badgeEl.textContent = isActive ? t('nav.stateOn') : t('nav.stateOff');
    this.soundBtnEl.classList.toggle('muted', !isActive);
    this.soundBtnEl.classList.toggle('is-active', isActive);
  }

  public startGame(): void {
    if (!this.isVisible) return;
    if (this.riderNameInputEl) {
      this.riderNameInputEl.value = setPlayerName(this.riderNameInputEl.value);
    }
    this.closeSettingsPopover();
    this.closeLeaderboardModal();
    this.closeNamePromptModal();
    const termsModal = document.getElementById('terms-modal');
    termsModal?.classList.add('hidden');
    const previewedBoard = this.getPreviewedBoard();
    const activeBoard = this.getSelectedUnlockedBoard();
    if (previewedBoard.id !== activeBoard.id) {
      const idx = SURF_BOARDS.findIndex((b) => b.id === activeBoard.id);
      if (idx >= 0) {
        this.currentBoardIndex = idx;
      }
      this.updateBoardDisplay();
      this.onLockedBoardFallback?.(previewedBoard, activeBoard);
    }
    this.lastUnlockedBoardId = activeBoard.id;
    setSelectedBoardId(activeBoard.id);
    this.onSelectBoard?.(activeBoard);
    this.isVisible = false;
    this.overlayEl.classList.add('hidden');
    if (this.onSelectSkater) {
      const skater = this.getSelectedSkater();
      this.onSelectSkater(skater.modelUrl, skater);
    }
    this.onStartGame();
  }

  public getSelectedSkaterName(): string {
    return SKATER_CHARACTERS[this.currentSkaterIndex]?.name || 'LUKAS';
  }

  public show(): void {
    this.isVisible = true;
    this.closeSettingsPopover();
    this.overlayEl.classList.remove('hidden');
    this.updateSkaterDisplay();
    this.updateBoardDisplay();
    this.syncRiderNameInput();
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
      // In portrait mode, pull back & frame full skater + surfskate board cleanly in the upper half above the Setup panel.
      this.camera.fov = 46;
      this.camera.position.set(0.14, 0.90, 5.95);
      this.camera.lookAt(0.14, -0.30, 0.0);
    } else if (h < 540) {
      // Mobile landscape (e.g. 852x393):
      // Menu panel is on the LEFT side (~320px).
      // Offset camera lookAt so skater at X=0.14 is framed in the center-right!
      this.camera.fov = 32;
      this.camera.position.set(-0.20, 1.08, 3.8);
      this.camera.lookAt(-0.10, 0.90, 0.0);
    } else {
      // Standard desktop landscape
      // Menu panel is on the LEFT side (~350px).
      // Camera looks slightly to the left of the skater so skater is prominently in the right-center.
      this.camera.fov = 34;
      this.camera.position.set(-0.16, 1.15, 4.15);
      this.camera.lookAt(-0.06, 0.94, 0.0);
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
    this.lastQualityPreset = preset;
    this.lastQualityEffective = effective;
    if (!this.qualityBtnEl) return;
    const badge = preset === 'auto' ? `AUTO (${effective.toUpperCase()})` : preset.toUpperCase();
    const labelEl = this.qualityBtnEl.querySelector('.settings-row-label');
    const badgeEl = this.qualityBtnEl.querySelector('.settings-row-badge');
    if (labelEl) labelEl.textContent = t('nav.qualityMenuLabel');
    if (badgeEl) badgeEl.textContent = badge;
    this.qualityBtnEl.classList.toggle('is-active', effective === 'high');
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
