declare const process: {
  env: Record<string, string | undefined>;
};

export type LeaderboardPark = 'all' | 'im_gefilde' | 'airport_skatepark';
export type ValidParkId = 'im_gefilde' | 'airport_skatepark';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

const GLOBAL_KEY = 'srfsk8:lb:global';
const PARK_KEYS: Record<ValidParkId, string> = {
  im_gefilde: 'srfsk8:lb:park:im_gefilde',
  airport_skatepark: 'srfsk8:lb:park:airport_skatepark',
};

function setCorsHeaders(res: any): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const clipped = stripped.slice(0, 16).trim();
  if (clipped.length < 2) return null;
  return clipped;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof body === 'object') {
    return body as Record<string, unknown>;
  }
  return null;
}

function getQueryParam(req: any, key: string): string | undefined {
  const fromQuery = req?.query?.[key];
  if (typeof fromQuery === 'string') return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === 'string') return fromQuery[0];

  if (typeof req?.url === 'string' && req.url.includes('?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      return url.searchParams.get(key) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const writeToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const readToken = process.env.KV_REST_API_READ_ONLY_TOKEN || writeToken;

  if (req.method === 'GET') {
    if (!redisUrl || !readToken) {
      return res.status(503).json({ error: 'Leaderboard not configured' });
    }

    const rawPark = getQueryParam(req, 'park') || 'all';
    const park: LeaderboardPark =
      rawPark === 'im_gefilde' || rawPark === 'airport_skatepark' ? rawPark : 'all';

    const rawLimit = Number(getQueryParam(req, 'limit'));
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(50, Math.round(rawLimit)))
      : 15;

    const redisKey =
      park === 'im_gefilde'
        ? PARK_KEYS.im_gefilde
        : park === 'airport_skatepark'
          ? PARK_KEYS.airport_skatepark
          : GLOBAL_KEY;

    try {
      const response = await fetch(redisUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${readToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['ZREVRANGE', redisKey, 0, limit - 1, 'WITHSCORES']),
      });

      if (!response.ok) {
        return res.status(502).json({ error: 'Failed to fetch leaderboard' });
      }

      const data = (await response.json()) as { result?: unknown[]; error?: string };
      if (data.error) {
        return res.status(502).json({ error: data.error });
      }

      const rawList = Array.isArray(data.result) ? data.result : [];
      const entries: LeaderboardEntry[] = [];
      for (let i = 0; i + 1 < rawList.length; i += 2) {
        const name = String(rawList[i]);
        const score = Math.round(Number(rawList[i + 1]));
        if (name && Number.isFinite(score)) {
          entries.push({
            rank: entries.length + 1,
            name,
            score,
          });
        }
      }

      return res.status(200).json({ park, entries });
    } catch {
      return res.status(502).json({ error: 'Leaderboard service unavailable' });
    }
  }

  if (req.method === 'POST') {
    if (!redisUrl || !writeToken) {
      return res.status(503).json({ error: 'Leaderboard not configured' });
    }

    const body = parseBody(req.body);
    if (!body) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const cleanName = sanitizeName(body.name);
    if (!cleanName) {
      return res.status(400).json({ error: 'Invalid player name (2–16 characters)' });
    }

    const score = Math.round(Number(body.score));
    if (!Number.isFinite(score) || !Number.isInteger(score) || score < 1 || score > 500000) {
      return res.status(400).json({ error: 'Invalid score (must be 1–500000)' });
    }

    let validPark: ValidParkId | null = null;
    if (body.park !== undefined && body.park !== null && body.park !== '') {
      if (body.park === 'im_gefilde' || body.park === 'airport_skatepark') {
        validPark = body.park;
      } else {
        return res.status(400).json({ error: 'Invalid park id' });
      }
    }

    const pipeline: Array<Array<string | number>> = [
      ['ZSCORE', GLOBAL_KEY, cleanName],
      ['ZADD', GLOBAL_KEY, 'GT', score, cleanName],
    ];
    if (validPark) {
      pipeline.push(['ZADD', PARK_KEYS[validPark], 'GT', score, cleanName]);
    }
    pipeline.push(['ZREVRANK', GLOBAL_KEY, cleanName]);
    pipeline.push(['ZSCORE', GLOBAL_KEY, cleanName]);

    try {
      const response = await fetch(`${redisUrl.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${writeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pipeline),
      });

      if (!response.ok) {
        return res.status(502).json({ error: 'Failed to save score' });
      }

      const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
      if (!Array.isArray(results) || results.length < 4) {
        return res.status(502).json({ error: 'Invalid leaderboard response' });
      }

      const prevScoreRaw = results[0]?.result;
      const prevScore =
        prevScoreRaw !== null && prevScoreRaw !== undefined ? Math.round(Number(prevScoreRaw)) : null;
      const isNewBest = prevScore === null || !Number.isFinite(prevScore) || score > prevScore;

      const rankResult = results[results.length - 2]?.result;
      const scoreResult = results[results.length - 1]?.result;

      const rank =
        rankResult !== null && rankResult !== undefined && Number.isFinite(Number(rankResult))
          ? Number(rankResult) + 1
          : null;
      const bestScore =
        scoreResult !== null && scoreResult !== undefined && Number.isFinite(Number(scoreResult))
          ? Math.round(Number(scoreResult))
          : score;

      return res.status(200).json({
        ok: true,
        name: cleanName,
        submittedScore: score,
        bestScore,
        rank,
        isNewBest,
      });
    } catch {
      return res.status(502).json({ error: 'Leaderboard service unavailable' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
