import type { TranslationKey } from '../i18n/i18n';

export type SurfBoardId =
  | 'the_spiral'
  | 'isar_swallowtail'
  | 'sunset_cruiser'
  | 'golden_pretzel';

export interface BoardUnlockProgress {
  rankLevel: number;
  totalCompletedMissions: number;
  bestSessionScore: number;
}

export interface SurfBoardSvgColors {
  woodStops: [string, string, string, string];
  deckStroke: string;
  pinstripe: string;
  accent: string;
  wheelStops: [string, string, string, string];
  wheelStroke: string;
}

export interface SurfBoardSpec {
  id: SurfBoardId;
  name: string;
  taglineKey: TranslationKey;
  stats: {
    carve: number;
    speed: number;
    pop: number;
  };
  physics: {
    carveScale: number;
    speedScale: number;
    pumpScale: number;
    popScale: number;
  };
  wheelColor: string;
  deckScale: {
    x: number;
    z: number;
  };
  goldTrail: boolean;
  metallic?: boolean;
  unlockKey?: TranslationKey;
  svgColors: SurfBoardSvgColors;
}

export const BOARD_STORAGE_KEY = 'surfsk8.selectedBoard';
export const DEFAULT_BOARD_ID: SurfBoardId = 'the_spiral';

export const SURF_BOARDS: SurfBoardSpec[] = [
  {
    id: 'the_spiral',
    name: 'THE SPIRAL - 32"',
    taglineKey: 'board.the_spiral.tagline',
    stats: { carve: 88, speed: 86, pop: 86 },
    physics: { carveScale: 1.0, speedScale: 1.0, pumpScale: 1.0, popScale: 1.0 },
    wheelColor: '#ff6b1a',
    deckScale: { x: 1.0, z: 1.0 },
    goldTrail: false,
    svgColors: {
      woodStops: ['#f6d3ab', '#e2ab70', '#c68a4b', '#996024'],
      deckStroke: '#78350f',
      pinstripe: '#fef08a',
      accent: '#ff6b1a',
      wheelStops: ['#ff9e58', '#ff6b1a', '#c2410c', '#7c2d12'],
      wheelStroke: '#9a3412',
    },
  },
  {
    id: 'isar_swallowtail',
    name: 'ISAR SWALLOWTAIL - 29"',
    taglineKey: 'board.isar_swallowtail.tagline',
    stats: { carve: 96, speed: 84, pop: 90 },
    physics: { carveScale: 1.1, speedScale: 0.98, pumpScale: 1.05, popScale: 1.04 },
    wheelColor: '#00e5d4',
    deckScale: { x: 0.96, z: 0.92 },
    goldTrail: false,
    unlockKey: 'board.unlockSwallowtail',
    svgColors: {
      woodStops: ['#ccfbf1', '#5eead4', '#0d9488', '#115e59'],
      deckStroke: '#134e4a',
      pinstripe: '#99f6e4',
      accent: '#00e5d4',
      wheelStops: ['#a5f3fc', '#00e5d4', '#0891b2', '#164e63'],
      wheelStroke: '#0e7490',
    },
  },
  {
    id: 'sunset_cruiser',
    name: 'SUNSET CARVER - 35"',
    taglineKey: 'board.sunset_cruiser.tagline',
    stats: { carve: 85, speed: 96, pop: 92 },
    physics: { carveScale: 0.95, speedScale: 1.08, pumpScale: 1.07, popScale: 1.06 },
    wheelColor: '#ff3d8a',
    deckScale: { x: 1.04, z: 1.09 },
    goldTrail: false,
    unlockKey: 'board.unlockSunset',
    svgColors: {
      woodStops: ['#fde68a', '#fb923c', '#ec4899', '#831843'],
      deckStroke: '#701a75',
      pinstripe: '#fcd34d',
      accent: '#ff3d8a',
      wheelStops: ['#f9a8d4', '#ff3d8a', '#be185d', '#831843'],
      wheelStroke: '#9d174d',
    },
  },
  {
    id: 'golden_pretzel',
    name: 'GOLDEN PRETZEL PRO',
    taglineKey: 'board.golden_pretzel.tagline',
    stats: { carve: 95, speed: 95, pop: 96 },
    physics: { carveScale: 1.06, speedScale: 1.06, pumpScale: 1.06, popScale: 1.06 },
    wheelColor: '#ffd54a',
    deckScale: { x: 1.02, z: 1.02 },
    goldTrail: true,
    metallic: true,
    unlockKey: 'board.unlockGolden',
    svgColors: {
      woodStops: ['#fef9c3', '#ffd54a', '#d97706', '#78350f'],
      deckStroke: '#92400e',
      pinstripe: '#fef08a',
      accent: '#ffd54a',
      wheelStops: ['#fef9c3', '#ffd54a', '#eab308', '#a16207'],
      wheelStroke: '#ca8a04',
    },
  },
];

export function isBoardUnlocked(board: SurfBoardSpec, progress: BoardUnlockProgress): boolean {
  switch (board.id) {
    case 'the_spiral':
      return true;
    case 'isar_swallowtail':
      return progress.rankLevel >= 2 || progress.totalCompletedMissions >= 3;
    case 'sunset_cruiser':
      return progress.rankLevel >= 3 || progress.totalCompletedMissions >= 6;
    case 'golden_pretzel':
      return progress.rankLevel >= 4 || progress.bestSessionScore >= 25000;
  }
}

export function getBoardById(id: string | null | undefined): SurfBoardSpec {
  return SURF_BOARDS.find((b) => b.id === id) ?? SURF_BOARDS[0];
}

export function getSelectedBoardId(): SurfBoardId {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(BOARD_STORAGE_KEY);
      if (saved && SURF_BOARDS.some((b) => b.id === saved)) {
        return saved as SurfBoardId;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return DEFAULT_BOARD_ID;
}

export function setSelectedBoardId(id: SurfBoardId): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BOARD_STORAGE_KEY, id);
    }
  } catch {
    // Ignore storage access errors
  }
}
