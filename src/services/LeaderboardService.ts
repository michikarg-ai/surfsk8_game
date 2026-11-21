import { t } from '../i18n/i18n';

export type LeaderboardPark = 'all' | 'im_gefilde' | 'airport_skatepark';
export type ValidLeaderboardPark = 'im_gefilde' | 'airport_skatepark';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

export interface FetchLeaderboardResult {
  entries: LeaderboardEntry[];
  source: 'global' | 'local';
}

export interface SubmitScoreResult {
  ok: boolean;
  name: string;
  bestScore: number;
  rank: number | null;
  isNewBest: boolean;
  source: 'global' | 'local';
  error?: string;
}

const PLAYER_NAME_KEY = 'surfsk8.playerName';
const LOCAL_LB_KEY = 'surfsk8.localLeaderboard.v1';

interface LocalLeaderboardStore {
  global: Record<string, number>;
  im_gefilde: Record<string, number>;
  airport_skatepark: Record<string, number>;
}

export function sanitizePlayerName(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
    .trim();
}

export function getPlayerName(): string {
  try {
    const raw = localStorage.getItem(PLAYER_NAME_KEY) || '';
    return sanitizePlayerName(raw);
  } catch {
    return '';
  }
}

export function setPlayerName(name: string): string {
  const clean = sanitizePlayerName(name);
  try {
    if (clean.length > 0) {
      localStorage.setItem(PLAYER_NAME_KEY, clean);
    } else {
      localStorage.removeItem(PLAYER_NAME_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
  return clean;
}

function loadLocalStore(): LocalLeaderboardStore {
  const empty: LocalLeaderboardStore = {
    global: {},
    im_gefilde: {},
    airport_skatepark: {},
  };
  try {
    const raw = localStorage.getItem(LOCAL_LB_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<LocalLeaderboardStore>;
    return {
      global: parsed.global && typeof parsed.global === 'object' ? { ...parsed.global } : {},
      im_gefilde:
        parsed.im_gefilde && typeof parsed.im_gefilde === 'object' ? { ...parsed.im_gefilde } : {},
      airport_skatepark:
        parsed.airport_skatepark && typeof parsed.airport_skatepark === 'object'
          ? { ...parsed.airport_skatepark }
          : {},
    };
  } catch {
    return empty;
  }
}

function saveLocalStore(store: LocalLeaderboardStore): void {
  try {
    localStorage.setItem(LOCAL_LB_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

function getSortedEntries(bucket: Record<string, number>, limit: number): LeaderboardEntry[] {
  return Object.entries(bucket)
    .filter(([name, score]) => name.length >= 2 && Number.isFinite(score) && score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, score], idx) => ({
      rank: idx + 1,
      name,
      score: Math.round(score),
    }));
}

export async function fetchLeaderboard(
  park: LeaderboardPark = 'all',
  limit = 15
): Promise<FetchLeaderboardResult> {
  const clampedLimit = Math.max(1, Math.min(50, Math.round(limit)));

  try {
    const res = await fetch(
      `/api/leaderboard?park=${encodeURIComponent(park)}&limit=${clampedLimit}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = (await res.json()) as { entries?: unknown };
      if (Array.isArray(data?.entries)) {
        const entries: LeaderboardEntry[] = data.entries
          .map((item: any, idx: number) => ({
            rank: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : idx + 1,
            name: String(item?.name || ''),
            score: Math.round(Number(item?.score || 0)),
          }))
          .filter((e) => e.name.length > 0 && Number.isFinite(e.score));
        return { entries, source: 'global' };
      }
    }
  } catch {
    // Graceful fallback to local store below
  }

  const store = loadLocalStore();
  const bucket = park === 'all' ? store.global : store[park] || {};
  return {
    entries: getSortedEntries(bucket, clampedLimit),
    source: 'local',
  };
}

export async function submitScore(
  name: string,
  score: number,
  park: ValidLeaderboardPark
): Promise<SubmitScoreResult> {
  const cleanName = setPlayerName(name);
  if (cleanName.length < 2) {
    return {
      ok: false,
      name: cleanName,
      bestScore: 0,
      rank: null,
      isNewBest: false,
      source: 'local',
      error: t('lbErr.nameMin'),
    };
  }

  const cleanScore = Math.round(Number(score));
  if (!Number.isFinite(cleanScore) || cleanScore < 1 || cleanScore > 500000) {
    return {
      ok: false,
      name: cleanName,
      bestScore: 0,
      rank: null,
      isNewBest: false,
      source: 'local',
      error: t('lbErr.scoreRange'),
    };
  }

  // Update local fallback store immediately (keeping highest score per name)
  const store = loadLocalStore();
  const prevGlobal = store.global[cleanName] ?? 0;
  const localIsNewBest = cleanScore > prevGlobal;
  store.global[cleanName] = Math.max(prevGlobal, cleanScore);

  const prevPark = store[park]?.[cleanName] ?? 0;
  store[park] = store[park] || {};
  store[park][cleanName] = Math.max(prevPark, cleanScore);
  saveLocalStore(store);

  const localEntries = getSortedEntries(store.global, 500);
  const localRankIdx = localEntries.findIndex((e) => e.name === cleanName);
  const localRank = localRankIdx >= 0 ? localRankIdx + 1 : null;
  const localBest = store.global[cleanName];

  try {
    const res = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: cleanName,
        score: cleanScore,
        park,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as {
        ok?: boolean;
        name?: string;
        bestScore?: number;
        rank?: number | null;
        isNewBest?: boolean;
        error?: string;
      };

      if (res.ok && data?.ok) {
        return {
          ok: true,
          name: data.name || cleanName,
          bestScore: Number.isFinite(Number(data.bestScore))
            ? Math.round(Number(data.bestScore))
            : cleanScore,
          rank:
            data.rank !== null && data.rank !== undefined && Number.isFinite(Number(data.rank))
              ? Number(data.rank)
              : null,
          isNewBest: Boolean(data.isNewBest),
          source: 'global',
        };
      }

      if (res.status === 400) {
        return {
          ok: false,
          name: cleanName,
          bestScore: localBest,
          rank: localRank,
          isNewBest: false,
          source: 'global',
          error: data?.error || t('lbErr.invalidInput'),
        };
      }
    }
  } catch {
    // Graceful fallback to local result below
  }

  return {
    ok: true,
    name: cleanName,
    bestScore: localBest,
    rank: localRank,
    isNewBest: localIsNewBest,
    source: 'local',
  };
}
