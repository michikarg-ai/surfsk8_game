import { ManeuverEvent, SurfskateController } from '../physics/SurfskateController';

export type GameModeId = 'jam' | 'flow_cup' | 'zen';

export interface SkaterRankInfo {
  level: number;
  icon: string;
  title: string;
  fullLabel: string;
}

export interface SurfMission {
  id: string;
  title: string;
  shortTitle: string;
  target: number;
  progress: number;
  completed: boolean;
  unit?: string;
}

export interface MedalInfo {
  id: 'none' | 'bronze' | 'silver' | 'gold' | 'sick';
  icon: string;
  label: string;
  threshold: number;
}

export interface SessionSummaryData {
  parkId: string;
  score: number;
  bestCombo: number;
  pretzels: number;
  highScore: number;
  isNewHighScore: boolean;
  medal: MedalInfo;
  nextMedal: MedalInfo | null;
  pointsToNextMedal: number;
  nearMissHint: string;
  rank: SkaterRankInfo;
  missions: SurfMission[];
}

interface PersistedProgressionState {
  version: 1;
  rankLevel: number;
  completedMissionIds: string[];
  parkHighScores: Record<string, number>;
  parkBestMedals: Record<string, MedalInfo['id']>;
}

const STORAGE_KEY = 'surfsk8.progression.v1';

export const SKATER_RANKS: SkaterRankInfo[] = [
  { level: 1, icon: '🥉', title: 'GROM', fullLabel: '🥉 LVL 1 • GROM' },
  { level: 2, icon: '🌊', title: 'ASPHALT SURFER', fullLabel: '🌊 LVL 2 • ASPHALT SURFER' },
  { level: 3, icon: '⚡', title: 'BOWL CARVER', fullLabel: '⚡ LVL 3 • BOWL CARVER' },
  { level: 4, icon: '🔥', title: 'PARK LOCAL', fullLabel: '🔥 LVL 4 • PARK LOCAL' },
  { level: 5, icon: '💎', title: 'STYLE MASTER', fullLabel: '💎 LVL 5 • STYLE MASTER' },
  { level: 6, icon: '👑', title: 'SOUL SURFER LEGEND', fullLabel: '👑 LVL 6 • SOUL SURFER LEGEND' },
];

export const PARK_MEDALS: MedalInfo[] = [
  { id: 'bronze', icon: '🥉', label: 'BRONZE MEDAILLE', threshold: 5000 },
  { id: 'silver', icon: '🥈', label: 'SILBER MEDAILLE', threshold: 12000 },
  { id: 'gold', icon: '🥇', label: 'GOLD MEDAILLE', threshold: 25000 },
  { id: 'sick', icon: '💎', label: 'SICK SCORE LEGEND', threshold: 45000 },
];

const NO_MEDAL: MedalInfo = {
  id: 'none',
  icon: '🛹',
  label: 'SESSION COMPLETE',
  threshold: 0,
};

interface MissionTemplate {
  id: string;
  title: string;
  shortTitle: string;
  target: number;
  unit?: string;
}

const LEVEL_MISSION_SETS: MissionTemplate[][] = [
  // Level 1: Grom
  [
    {
      id: 'l1_carves_snaps',
      title: 'Lande 3 Carves oder Snaps in einer Session',
      shortTitle: '3 Carves / Snaps landen',
      target: 3,
    },
    {
      id: 'l1_pretzels_3',
      title: 'Sammle 3 Brezeln im Park',
      shortTitle: '3 Brezeln sammeln',
      target: 3,
    },
    {
      id: 'l1_score_2500',
      title: 'Erreiche 2.500 Punkte Session-Score',
      shortTitle: '2.500 PTS Session-Score',
      target: 2500,
      unit: 'PTS',
    },
  ],
  // Level 2: Asphalt Surfer
  [
    {
      id: 'l2_bert_layback',
      title: 'Lande 2 Bert Slides oder Laybacks',
      shortTitle: '2 Bert Slides / Laybacks',
      target: 2,
    },
    {
      id: 'l2_combo_1500',
      title: 'Erreiche eine 1.500-Punkte-Combo',
      shortTitle: '1.500 PTS Combo stehen',
      target: 1500,
      unit: 'PTS',
    },
    {
      id: 'l2_surfzone_8s',
      title: 'Halte 8 Sekunden lang >= 80% Flow (Surf-Zone)',
      shortTitle: '8s in der Surf-Zone (80%+ Flow)',
      target: 8,
      unit: 's',
    },
  ],
  // Level 3: Bowl Carver
  [
    {
      id: 'l3_flow_line',
      title: "Schaffe eine 'Follow the Flow'-Line",
      shortTitle: "'Follow the Flow'-Line schaffen",
      target: 1,
    },
    {
      id: 'l3_pretzels_5',
      title: 'Sammle alle 5 Brezeln in einer Session',
      shortTitle: 'Alle 5 Brezeln sammeln',
      target: 5,
    },
    {
      id: 'l3_score_12000',
      title: 'Erreiche 12.000 Punkte (Silber-Medaille)',
      shortTitle: '12.000 PTS (Silber-Medaille)',
      target: 12000,
      unit: 'PTS',
    },
  ],
  // Level 4: Park Local
  [
    {
      id: 'l4_indy_360',
      title: 'Lande 3 Indy Grabs oder 360 Airs',
      shortTitle: '3 Indy Grabs / 360 Spins',
      target: 3,
    },
    {
      id: 'l4_hotspot_tricks',
      title: 'Scorte 2 Tricks in einer 🔥 Hot-Spot-Zone',
      shortTitle: '2 Tricks im 🔥 Hot-Spot',
      target: 2,
    },
    {
      id: 'l4_combo_4000',
      title: 'Erreiche eine 4.000-Punkte-Combo',
      shortTitle: '4.000 PTS Combo stehen',
      target: 4000,
      unit: 'PTS',
    },
  ],
  // Level 5: Style Master
  [
    {
      id: 'l5_perfect_tricks',
      title: 'Lande 4 verschiedene Surf-Tricks in einer Session',
      shortTitle: '4 verschiedene Surf-Tricks',
      target: 4,
    },
    {
      id: 'l5_surfzone_15s',
      title: 'Halte 15 Sekunden lang >= 80% Flow (Surf-Zone)',
      shortTitle: '15s in der Surf-Zone (80%+ Flow)',
      target: 15,
      unit: 's',
    },
    {
      id: 'l5_score_25000',
      title: 'Erreiche 25.000 Punkte (Gold-Medaille)',
      shortTitle: '25.000 PTS (Gold-Medaille)',
      target: 25000,
      unit: 'PTS',
    },
  ],
  // Level 6+: Soul Surfer Legend (Rotating Pro Challenges Set A)
  [
    {
      id: 'l6_hotspot_4',
      title: 'Scorte 4 Tricks in einer 🔥 Hot-Spot-Zone',
      shortTitle: '4 Tricks im 🔥 Hot-Spot',
      target: 4,
    },
    {
      id: 'l6_combo_8000',
      title: 'Erreiche eine 8.000-Punkte-Monster-Combo',
      shortTitle: '8.000 PTS Monster-Combo',
      target: 8000,
      unit: 'PTS',
    },
    {
      id: 'l6_score_45000',
      title: 'Erreiche 45.000 Punkte (💎 Sick Score)',
      shortTitle: '45.000 PTS (💎 Sick Score)',
      target: 45000,
      unit: 'PTS',
    },
  ],
  // Level 7+: Rotating Pro Challenges Set B
  [
    {
      id: 'l7_flow_lines_2',
      title: "Schaffe 2 'Follow the Flow'-Lines in einer Session",
      shortTitle: "2 'Follow the Flow'-Lines",
      target: 2,
    },
    {
      id: 'l7_surfzone_22s',
      title: 'Halte 22 Sekunden lang >= 80% Flow (Surf-Zone)',
      shortTitle: '22s in der Surf-Zone',
      target: 22,
      unit: 's',
    },
    {
      id: 'l7_snaps_5',
      title: 'Lande 5 Snaps oder Bert Slides an der Lip',
      shortTitle: '5 Snaps / Bert Slides',
      target: 5,
    },
  ],
];

export class SurfProgression {
  private state: PersistedProgressionState;
  public missions: SurfMission[] = [];

  // Session-specific tracking counters
  private sessionCarvesOrSnaps = 0;
  private sessionBertOrLaybacks = 0;
  private sessionIndyOr360s = 0;
  private sessionHotSpotTricks = 0;
  private sessionSnapsOrBerts = 0;
  private sessionFlowLinesCompleted = 0;
  private sessionSurfZoneSeconds = 0;
  private sessionUniqueTricks = new Set<string>();

  public onMissionCompleted?: (mission: SurfMission) => void;
  public onRankUp?: (newRank: SkaterRankInfo) => void;

  constructor() {
    this.state = this.loadState();
    this.rebuildActiveMissions();
  }

  private loadState(): PersistedProgressionState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedProgressionState>;
        if (parsed && typeof parsed.rankLevel === 'number' && parsed.rankLevel >= 1) {
          return {
            version: 1,
            rankLevel: parsed.rankLevel,
            completedMissionIds: Array.isArray(parsed.completedMissionIds) ? parsed.completedMissionIds : [],
            parkHighScores: parsed.parkHighScores && typeof parsed.parkHighScores === 'object' ? parsed.parkHighScores : {},
            parkBestMedals: parsed.parkBestMedals && typeof parsed.parkBestMedals === 'object' ? parsed.parkBestMedals : {},
          };
        }
      }
    } catch {
      // ignore storage errors
    }
    return {
      version: 1,
      rankLevel: 1,
      completedMissionIds: [],
      parkHighScores: {},
      parkBestMedals: {},
    };
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore storage errors
    }
  }

  public getRankInfo(level = this.state.rankLevel): SkaterRankInfo {
    if (level <= SKATER_RANKS.length) {
      return SKATER_RANKS[level - 1];
    }
    const baseLegend = SKATER_RANKS[SKATER_RANKS.length - 1];
    return {
      level,
      icon: baseLegend.icon,
      title: `${baseLegend.title} II+${level - 6}`,
      fullLabel: `👑 LVL ${level} • ${baseLegend.title}`,
    };
  }

  private getTemplatesForLevel(level: number): MissionTemplate[] {
    if (level <= 5) {
      return LEVEL_MISSION_SETS[level - 1];
    }
    const proIdx = 5 + ((level - 6) % (LEVEL_MISSION_SETS.length - 5));
    const templates = LEVEL_MISSION_SETS[proIdx];
    return templates.map((t) => ({
      ...t,
      id: `${t.id}_lvl${level}`,
    }));
  }

  private rebuildActiveMissions(): void {
    const templates = this.getTemplatesForLevel(this.state.rankLevel);
    this.missions = templates.map((tpl) => {
      const done = this.state.completedMissionIds.includes(tpl.id);
      return {
        id: tpl.id,
        title: tpl.title,
        shortTitle: tpl.shortTitle,
        target: tpl.target,
        progress: done ? tpl.target : 0,
        completed: done,
        unit: tpl.unit,
      };
    });
  }

  public resetSessionCounters(): void {
    this.sessionCarvesOrSnaps = 0;
    this.sessionBertOrLaybacks = 0;
    this.sessionIndyOr360s = 0;
    this.sessionHotSpotTricks = 0;
    this.sessionSnapsOrBerts = 0;
    this.sessionFlowLinesCompleted = 0;
    this.sessionSurfZoneSeconds = 0;
    this.sessionUniqueTricks.clear();

    for (const m of this.missions) {
      if (!m.completed) {
        m.progress = 0;
      } else {
        m.progress = m.target;
      }
    }
  }

  public onManeuver(ev: ManeuverEvent, inHotSpot = false): void {
    const nameUpper = (ev.name || '').toUpperCase();
    const trickId = ev.trick;

    // Count carves, pumps, snaps, or any trick for Level 1 mission 1
    if (
      trickId ||
      ev.isSnap ||
      nameUpper.includes('SNAP') ||
      nameUpper.includes('CARVE') ||
      nameUpper.includes('PUMP') ||
      nameUpper.includes('LAYBACK') ||
      nameUpper.includes('BERT')
    ) {
      this.sessionCarvesOrSnaps++;
    }

    if (
      trickId === 'BERTSLIDE' ||
      trickId === 'LAYBACK' ||
      nameUpper.includes('BERT') ||
      nameUpper.includes('LAYBACK')
    ) {
      this.sessionBertOrLaybacks++;
    }

    if (
      trickId === 'INDYGRAB' ||
      trickId === 'REVERSE360' ||
      nameUpper.includes('INDY') ||
      nameUpper.includes('360')
    ) {
      this.sessionIndyOr360s++;
    }

    if (
      trickId === 'SNAP' ||
      trickId === 'BERTSLIDE' ||
      nameUpper.includes('SNAP') ||
      nameUpper.includes('BERT')
    ) {
      this.sessionSnapsOrBerts++;
    }

    if (trickId) {
      this.sessionUniqueTricks.add(trickId);
    }

    if (inHotSpot && (trickId || ev.points >= 100)) {
      this.sessionHotSpotTricks++;
    }

    this.evaluateMissionProgress(0, 0, 0);
  }

  public onFlowLineCompleted(): void {
    this.sessionFlowLinesCompleted++;
    this.evaluateMissionProgress(0, 0, 0);
  }

  public update(
    dt: number,
    ctrl: SurfskateController,
    totalScore: number,
    bestOrActiveCombo: number,
    pretzelsCollected: number
  ): void {
    const isSurfZone =
      Boolean((ctrl as unknown as { isSurfZoneActive?: boolean }).isSurfZoneActive) ||
      ctrl.flowMeter >= 80;
    const ctrlSurfTimer = (ctrl as unknown as { surfZoneTimer?: number }).surfZoneTimer;

    if (typeof ctrlSurfTimer === 'number' && ctrlSurfTimer > this.sessionSurfZoneSeconds) {
      this.sessionSurfZoneSeconds = ctrlSurfTimer;
    } else if (isSurfZone && ctrl.speed > 0.8 && !ctrl.isBailing) {
      this.sessionSurfZoneSeconds += dt;
    }

    this.evaluateMissionProgress(totalScore, bestOrActiveCombo, pretzelsCollected);
  }

  private evaluateMissionProgress(
    totalScore: number,
    bestOrActiveCombo: number,
    pretzelsCollected: number
  ): void {
    let newlyCompletedAny = false;

    for (const m of this.missions) {
      if (m.completed) {
        m.progress = m.target;
        continue;
      }

      const baseId = m.id.replace(/_lvl\d+$/, '');
      let val = m.progress;

      switch (baseId) {
        case 'l1_carves_snaps':
          val = this.sessionCarvesOrSnaps;
          break;
        case 'l1_pretzels_3':
        case 'l3_pretzels_5':
          val = Math.max(m.progress, pretzelsCollected);
          break;
        case 'l1_score_2500':
        case 'l3_score_12000':
        case 'l5_score_25000':
        case 'l6_score_45000':
          val = Math.max(m.progress, Math.floor(totalScore));
          break;
        case 'l2_bert_layback':
          val = this.sessionBertOrLaybacks;
          break;
        case 'l2_combo_1500':
        case 'l4_combo_4000':
        case 'l6_combo_8000':
          val = Math.max(m.progress, Math.floor(bestOrActiveCombo));
          break;
        case 'l2_surfzone_8s':
        case 'l5_surfzone_15s':
        case 'l7_surfzone_22s':
          val = Math.max(m.progress, Math.floor(this.sessionSurfZoneSeconds));
          break;
        case 'l3_flow_line':
        case 'l7_flow_lines_2':
          val = this.sessionFlowLinesCompleted;
          break;
        case 'l4_indy_360':
          val = this.sessionIndyOr360s;
          break;
        case 'l4_hotspot_tricks':
        case 'l6_hotspot_4':
          val = this.sessionHotSpotTricks;
          break;
        case 'l5_perfect_tricks':
          val = this.sessionUniqueTricks.size;
          break;
        case 'l7_snaps_5':
          val = this.sessionSnapsOrBerts;
          break;
      }

      m.progress = Math.min(m.target, val);

      if (m.progress >= m.target && !m.completed) {
        m.completed = true;
        if (!this.state.completedMissionIds.includes(m.id)) {
          this.state.completedMissionIds.push(m.id);
        }
        newlyCompletedAny = true;
        this.saveState();
        this.onMissionCompleted?.(m);
      }
    }

    if (newlyCompletedAny && this.missions.every((m) => m.completed)) {
      this.state.rankLevel += 1;
      this.state.completedMissionIds = [];
      this.saveState();
      const newRank = this.getRankInfo(this.state.rankLevel);
      this.rebuildActiveMissions();
      this.onRankUp?.(newRank);
    }
  }

  public getMedalForScore(score: number): {
    medal: MedalInfo;
    nextMedal: MedalInfo | null;
    pointsToNextMedal: number;
  } {
    let earned: MedalInfo = NO_MEDAL;
    let next: MedalInfo | null = PARK_MEDALS[0];

    for (let i = 0; i < PARK_MEDALS.length; i++) {
      if (score >= PARK_MEDALS[i].threshold) {
        earned = PARK_MEDALS[i];
        next = PARK_MEDALS[i + 1] ?? null;
      }
    }

    const pointsToNextMedal = next ? Math.max(0, next.threshold - Math.floor(score)) : 0;
    return { medal: earned, nextMedal: next, pointsToNextMedal };
  }

  public getParkHighScore(parkId: string): number {
    return this.state.parkHighScores[parkId] || 0;
  }

  public getSessionSummary(
    parkId: string,
    score: number,
    bestCombo: number,
    pretzels: number
  ): SessionSummaryData {
    const cleanScore = Math.floor(score);
    const prevHigh = this.getParkHighScore(parkId);
    const isNewHighScore = cleanScore > prevHigh && cleanScore > 0;
    const highScore = Math.max(prevHigh, cleanScore);

    if (isNewHighScore) {
      this.state.parkHighScores[parkId] = highScore;
    }

    const { medal, nextMedal, pointsToNextMedal } = this.getMedalForScore(cleanScore);
    if (medal.id !== 'none') {
      const rankOrder: MedalInfo['id'][] = ['none', 'bronze', 'silver', 'gold', 'sick'];
      const prevBestMedal = this.state.parkBestMedals[parkId] || 'none';
      if (rankOrder.indexOf(medal.id) > rankOrder.indexOf(prevBestMedal)) {
        this.state.parkBestMedals[parkId] = medal.id;
      }
    }
    this.saveState();

    const nearMissHint = this.buildNearMissHint(cleanScore, nextMedal, pointsToNextMedal);

    return {
      parkId,
      score: cleanScore,
      bestCombo: Math.floor(bestCombo),
      pretzels,
      highScore,
      isNewHighScore,
      medal,
      nextMedal,
      pointsToNextMedal,
      nearMissHint,
      rank: this.getRankInfo(),
      missions: this.missions.map((m) => ({ ...m })),
    };
  }

  private buildNearMissHint(
    score: number,
    nextMedal: MedalInfo | null,
    pointsToNextMedal: number
  ): string {
    // 1. Check if an active mission is >= 50% complete
    const halfDoneMission = this.missions.find(
      (m) => !m.completed && m.target > 1 && m.progress / m.target >= 0.5
    );

    // 2. If very close to next medal (within 40% of threshold or < 3500 pts)
    if (nextMedal && pointsToNextMedal > 0) {
      const ratio = score / nextMedal.threshold;
      if (ratio >= 0.62 || pointsToNextMedal <= 2500) {
        return `🔥 FAST ${nextMedal.label.replace(' MEDAILLE', '')}! Nur noch ${pointsToNextMedal.toLocaleString()} Punkte bis ${nextMedal.icon} ${nextMedal.label}! Versuch's direkt nochmal!`;
      }
    }

    if (halfDoneMission) {
      const rem = Math.max(1, halfDoneMission.target - halfDoneMission.progress);
      const unitStr = halfDoneMission.unit ? ` ${halfDoneMission.unit}` : '';
      return `⚡ FAST GESCHAFFT: Noch ${rem.toLocaleString()}${unitStr} für deine Mission „${halfDoneMission.shortTitle}“!`;
    }

    if (nextMedal) {
      return `🎯 NÄCHSTES ZIEL: Noch ${pointsToNextMedal.toLocaleString()} Punkte bis ${nextMedal.icon} ${nextMedal.label} (${nextMedal.threshold.toLocaleString()} PTS)!`;
    }

    return `👑 SICK SCORE LEGEND! Du hast den Park komplett dominiert — knackst du deinen eigenen Rekord?`;
  }
}
