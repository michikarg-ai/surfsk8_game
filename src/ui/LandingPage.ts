import * as THREE from 'three';
import { SkaterVisuals } from '../entities/SkaterVisuals';
import { ParkSurface } from '../physics/ParkSurface';
import { SurfskateController } from '../physics/SurfskateController';
import { GameModeId, SkaterRankInfo, SurfMission } from '../progression/SurfProgression';
import {
  fetchLeaderboard,
  getPlayerName,
  LeaderboardEntry,
  LeaderboardPark,
  setPlayerName,
} from '../services/LeaderboardService';

export type SelectorCategory = 'skater' | 'skatepark' | 'board';
export type LandingFocusRow = 'skater' | 'park' | 'board' | 'mode' | 'start';
export const LANDING_FOCUS_ROWS: LandingFocusRow[] = ['skater', 'park', 'board', 'mode', 'start'];

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
    name: 'IM WIESENGRUND',
    subtitle: 'IM WIESENGRUND',
    thumbUrl: '/textures/im_gefilde_thumb.png',
    modelUrl: '/models/skatepark_multi.glb',
    lidarUrl: '/models/im_gefilde_lidar.json',
    viewerUrl: '/viewer.html?model=/models/skatepark_multi.glb',
  },
  {
    id: 'airport_skatepark',
    name: 'AIRPORT SKATEPARK',
    subtitle: 'AIRPORT SKATEPARK',
    thumbUrl: '/textures/airport_thumb.png?v=2',
    modelUrl: '/models/airport_skatepark_game.glb',
    lidarUrl: '/models/airport_skatepark_lidar.json',
    viewerUrl: '/viewer.html?model=/models/airport_skatepark_game.glb',
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
  private activeFocusIndex = 0;
  private currentSkaterIndex = (() => {
    const s = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('skater') : null;
    return s === 'female' || s === 'sophie' || s === '1' ? 1 : 0;
  })();
  public currentParkIndex = (() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('park') : null;
    return p === 'airport' || p === 'airport_skatepark' || p === '1' ? 1 : 0;
  })();

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
  public onToggleFullscreen?: () => void;
  public onToggleSound?: () => void;
  public onSelectGameMode?: (mode: GameModeId) => void;
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

  private modeDescriptions: Record<GameModeId, string> = {
    jam: '⏱️ 120s Highscore Hunt — Carve hot-spots, land tricks & collect pretzels.',
    flow_cup: '🌊 Follow the Flow — Carve through gates, keep momentum & lock lines.',
    zen: '🌅 Endless Free Surf — No timer, no stress: cruise the bowl & carve sunset lines.',
  };

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
    this.playerNameEl =
      document.getElementById('landing-skater-name') ||
      this.overlayEl.querySelector('.sel-player-name');
    this.riderNameInputEl = document.getElementById('landing-player-name') as HTMLInputElement | null;
    this.parkSubtitleEl = document.getElementById('landing-park-subtitle') || this.overlayEl.querySelector('#sel-section-skatepark .sel-subtitle');
    this.parkThumbImgEl = document.getElementById('landing-park-thumb') as HTMLImageElement || this.overlayEl.querySelector('.park-thumb');
    this.parkInspectBtnEl = document.getElementById('landing-park-inspect-btn');
    this.soundBtnEl = document.getElementById('landing-sound-btn');
    this.modeDescEl = document.getElementById('landing-mode-desc');
    this.missionsCountEl = document.getElementById('landing-missions-count');
    if (this.modeDescEl) {
      this.modeDescEl.textContent = this.modeDescriptions[this.selectedGameMode] || this.modeDescriptions.jam;
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
      this.modeDescEl.textContent = this.modeDescriptions[mode] || this.modeDescriptions.jam;
    }
    this.onSelectGameMode?.(mode);
  }

  private syncModePills(): void {
    for (const btn of this.modePillBtns) {
      btn.classList.toggle('active', btn.dataset.mode === this.selectedGameMode);
    }
  }

  public updateProgressionDisplay(rank: SkaterRankInfo, missions: SurfMission[]): void {
    if (this.rankBadgeEl) {
      this.rankBadgeEl.textContent = rank.fullLabel;
    }
    if (this.missionsCountEl) {
      const done = missions.filter((m) => m.completed).length;
      this.missionsCountEl.textContent = `${done}/${missions.length} DONE`;
    }
    if (this.missionsListEl) {
      this.missionsListEl.innerHTML = missions
        .map((m) => {
          const check = m.completed ? '☑️' : '⬜';
          const progStr = m.completed
            ? 'DONE'
            : `${m.progress.toLocaleString()}/${m.target.toLocaleString()}${m.unit ? ' ' + m.unit : ''}`;
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

    this.updateActiveSectionVisuals();
  }

  public syncRiderNameInput(): void {
    if (this.riderNameInputEl) {
      this.riderNameInputEl.value = getPlayerName();
    }
  }

  public isLeaderboardModalOpen(): boolean {
    return Boolean(this.leaderboardModalEl && !this.leaderboardModalEl.classList.contains('hidden'));
  }

  public openLeaderboardModal(park: LeaderboardPark = 'all'): void {
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
      this.lbListEl.innerHTML = '<div class="lb-state-msg">⏳ Lade Rangliste...</div>';
    }

    const { entries, source } = await fetchLeaderboard(park, 15);
    if (token !== this.lbFetchToken) return;

    if (this.lbSourceBadgeEl) {
      this.lbSourceBadgeEl.textContent = source === 'global' ? 'GLOBAL LIVE' : 'LOCAL PREVIEW';
      this.lbSourceBadgeEl.classList.toggle('local', source !== 'global');
    }

    this.renderLeaderboardEntries(entries);
  }

  private renderLeaderboardEntries(entries: LeaderboardEntry[]): void {
    if (!this.lbListEl) return;
    if (entries.length === 0) {
      this.lbListEl.innerHTML =
        '<div class="lb-state-msg">🏄 Noch keine Scores eingetragen — starte eine 2-Min Session und hol dir Platz #1!</div>';
      return;
    }

    const currentPlayer = getPlayerName().toLowerCase();
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
      nameEl.textContent = isMe ? `${entry.name} (DU)` : entry.name;

      const scoreEl = document.createElement('span');
      scoreEl.className = 'lb-score';
      scoreEl.textContent = entry.score.toLocaleString();

      row.append(rankEl, nameEl, scoreEl);
      this.lbListEl.appendChild(row);
    }
  }

  public handleKeyDown(code: string): void {
    const activeEl = document.activeElement as HTMLElement | null;
    const tag = activeEl?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable) {
      return;
    }

    if (code === 'Escape') {
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
      const skater = SKATER_CHARACTERS[this.currentSkaterIndex];
      if (this.playerNameEl) {
        this.playerNameEl.textContent = skater.name;
      }
      void this.skaterVisuals.load(skater.modelUrl);
      if (this.onSelectSkater) {
        this.onSelectSkater(skater.modelUrl);
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
    if (this.fullscreenBtnEl) {
      const iconPath = isFs
        ? 'M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 4v6m0 0H4m6 0L3 3m10 7h6m-6 0V4m0 6l7-7'
        : 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3';
      const label = isFs ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
      this.fullscreenBtnEl.innerHTML = `
        <svg class="landing-fs-icon aux-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="${iconPath}"/>
        </svg>
        <span class="aux-text">${label}</span>
      `.trim();
    }
  }

  public updateSoundLabel(isActive: boolean): void {
    if (this.soundBtnEl) {
      const icon = isActive ? '🔊' : '🔇';
      const text = isActive ? 'SOUND: ON' : 'SOUND: OFF';
      const iconEl = this.soundBtnEl.querySelector('.aux-icon');
      const textEl = this.soundBtnEl.querySelector('.aux-text');
      if (iconEl && textEl) {
        iconEl.textContent = icon;
        textEl.textContent = text;
      } else {
        this.soundBtnEl.innerHTML = `<span class="aux-icon">${icon}</span> <span class="aux-text">${text}</span>`;
      }
      this.soundBtnEl.classList.toggle('muted', !isActive);
    }
  }

  public startGame(): void {
    if (!this.isVisible) return;
    if (this.riderNameInputEl) {
      this.riderNameInputEl.value = setPlayerName(this.riderNameInputEl.value);
    }
    this.closeLeaderboardModal();
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
      // In portrait mode, 3D skater is showcased in the top 35-40% of the screen.
      this.camera.fov = 43;
      this.camera.position.set(0.14, 0.88, 4.4);
      this.camera.lookAt(0.14, 0.58, 0.0);
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
    if (!this.qualityBtnEl) return;
    const label = preset === 'auto' ? `AUTO (${effective.toUpperCase()})` : preset.toUpperCase();
    this.qualityBtnEl.innerHTML = `<span class="aux-icon">⚡</span> <span class="aux-text">QUALITY: ${label}</span>`;
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
