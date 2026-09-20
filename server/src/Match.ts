import {
  COUNTDOWN_DURATION,
  FINAL_PUSH_SAMPLE_SEC,
  GAME_OVER_DURATION,
  HYBRID_KILL_POINTS,
  MAP_DEFS,
  MATCH_DURATION,
  MatchPhase,
  MatchStateSnapshot,
  MODE_CONFIGS,
  Team
} from '@ink/shared';
import type { GameMode, GameOverPayload, MapId, ZoneRect } from '@ink/shared';
import { PaintGrid } from './PaintGrid.js';

export interface TeamScoreInput {
  pinkKills: number;
  cyanKills: number;
}

export interface ZoneControlResult {
  pink: number;
  cyan: number;
  total: number;
}

export class Match {
  phase: MatchPhase = MatchPhase.WAITING;
  matchStartAt = 0;
  matchEndAt = 0;
  phaseEndsAt = 0;
  autoStart = true;

  mode: GameMode = 'turf_war';
  mapId: MapId = 'downtown';

  private paintGrid: PaintGrid;
  private onResetCallback?: () => void;
  private zoneRect: ZoneRect = MAP_DEFS.downtown.zone;
  private zonePointsPink = 0;
  private zonePointsCyan = 0;
  private lastZoneTickAt = 0;
  private pinkKills = 0;
  private cyanKills = 0;
  /** Last coverage sample (percent) for `final_push`; the running verdict. */
  private pushPink = 0;
  private pushCyan = 0;
  private lastPushSampleAt = 0;

  constructor(paintGrid: PaintGrid, onReset?: () => void) {
    this.paintGrid = paintGrid;
    this.onResetCallback = onReset;
  }

  /**
   * Applies a host-side mode/map change (only legal while WAITING).
   * Resets mode-specific score accumulators.
   */
  setConfig(mode?: GameMode, mapId?: MapId): void {
    if (mode && mode !== this.mode) {
      this.mode = mode;
      this.resetModeScores();
    }
    if (mapId && mapId !== this.mapId) {
      this.mapId = mapId;
      this.zoneRect = MAP_DEFS[mapId].zone;
      this.resetModeScores();
    }
  }

  /** Clears every mode-specific score accumulator. */
  private resetModeScores(): void {
    this.zonePointsPink = 0;
    this.zonePointsCyan = 0;
    this.lastZoneTickAt = 0;
    this.pushPink = 0;
    this.pushCyan = 0;
    this.lastPushSampleAt = 0;
  }

  setTeamKills(pinkKills: number, cyanKills: number): void {
    this.pinkKills = pinkKills;
    this.cyanKills = cyanKills;
  }

  /** Called once per second while PLAYING in splat_zones mode. */
  tickZone(control: ZoneControlResult, now: number = Date.now()): void {
    if (this.phase !== MatchPhase.PLAYING || this.mode !== 'splat_zones') return;
    if (now - this.lastZoneTickAt < 1000) return;
    this.lastZoneTickAt = now;

    if (control.total > 0) {
      if (control.pink > control.cyan) {
        this.zonePointsPink++;
      } else if (control.cyan > control.pink) {
        this.zonePointsCyan++;
      }
    }

    const limit = MODE_CONFIGS.splat_zones.scoreLimit;
    if (limit > 0 && (this.zonePointsPink >= limit || this.zonePointsCyan >= limit)) {
      this.endMatch(now);
    }
  }

  getZonePoints(): { pink: number; cyan: number } {
    return { pink: this.zonePointsPink, cyan: this.zonePointsCyan };
  }

  /**
   * Samples coverage for `final_push`. Called on the match tick; internally
   * rate-limited to one sample per `FINAL_PUSH_SAMPLE_SEC`. Each sample simply
   * replaces the previous verdict, so only the final one before time-out counts.
   */
  tickFinalPush(now: number = Date.now()): void {
    if (this.phase !== MatchPhase.PLAYING || this.mode !== 'final_push') return;
    // The first sample is taken as soon as play starts so the scoreboard is
    // never blank; later ones are spaced by the sample interval.
    if (this.lastPushSampleAt !== 0 && now - this.lastPushSampleAt < FINAL_PUSH_SAMPLE_SEC * 1000) return;
    this.lastPushSampleAt = now;
    const score = this.paintGrid.getScore();
    this.pushPink = score.pinkPercentage;
    this.pushCyan = score.cyanPercentage;
  }

  /**
   * Combined score for `ranked_hybrid`: painted coverage plus knockout points,
   * so a team cannot win by ignoring either half of the match.
   */
  getHybridScores(): { pink: number; cyan: number } {
    const score = this.paintGrid.getScore();
    return {
      pink: Math.round(score.pinkPercentage + this.pinkKills * HYBRID_KILL_POINTS),
      cyan: Math.round(score.cyanPercentage + this.cyanKills * HYBRID_KILL_POINTS)
    };
  }

  getFinalPushScores(): { pink: number; cyan: number } {
    return { pink: this.pushPink, cyan: this.pushCyan };
  }

  update(
    playerCount: number,
    now: number = Date.now()
  ): { phaseChanged: boolean; newPhase: MatchPhase; gameOverPayload?: GameOverPayload } {
    let phaseChanged = false;
    let gameOverPayload: GameOverPayload | undefined;

    if (playerCount === 0 && this.phase !== MatchPhase.WAITING) {
      this.phase = MatchPhase.WAITING;
      this.matchStartAt = 0;
      this.matchEndAt = 0;
      this.phaseEndsAt = 0;
      this.resetModeScores();
      if (this.onResetCallback) {
        this.onResetCallback();
      }
      return {
        phaseChanged: true,
        newPhase: this.phase
      };
    }

    switch (this.phase) {
      case MatchPhase.WAITING: {
        if (this.autoStart && playerCount >= 1) {
          this.startCountdown(now);
          phaseChanged = true;
        }
        break;
      }

      case MatchPhase.COUNTDOWN: {
        if (now >= this.phaseEndsAt) {
          this.startPlaying(now);
          phaseChanged = true;
        }
        break;
      }

      case MatchPhase.PLAYING: {
        // Early victory by score limit (zones / TDM)
        if (this.mode === 'team_deathmatch') {
          const limit = MODE_CONFIGS.team_deathmatch.scoreLimit;
          if (limit > 0 && (this.pinkKills >= limit || this.cyanKills >= limit)) {
            gameOverPayload = this.endMatch(now);
            phaseChanged = true;
            break;
          }
        }
        if (this.mode === 'splat_zones') {
          const limit = MODE_CONFIGS.splat_zones.scoreLimit;
          if (limit > 0 && (this.zonePointsPink >= limit || this.zonePointsCyan >= limit)) {
            gameOverPayload = this.endMatch(now);
            phaseChanged = true;
            break;
          }
        }
        if (this.mode === 'ranked_hybrid') {
          const limit = MODE_CONFIGS.ranked_hybrid.scoreLimit;
          const hybrid = this.getHybridScores();
          if (limit > 0 && (hybrid.pink >= limit || hybrid.cyan >= limit)) {
            gameOverPayload = this.endMatch(now);
            phaseChanged = true;
            break;
          }
        }
        if (now >= this.matchEndAt) {
          gameOverPayload = this.endMatch(now);
          phaseChanged = true;
        }
        break;
      }

      case MatchPhase.GAME_OVER: {
        if (now >= this.phaseEndsAt) {
          this.restartMatch(now);
          phaseChanged = true;
        }
        break;
      }
    }

    return {
      phaseChanged,
      newPhase: this.phase,
      gameOverPayload
    };
  }

  startCountdown(now: number = Date.now()): void {
    this.phase = MatchPhase.COUNTDOWN;
    this.phaseEndsAt = now + COUNTDOWN_DURATION * 1000;
    this.matchStartAt = this.phaseEndsAt;
    this.resetModeScores();
  }

  startPlaying(now: number = Date.now()): void {
    this.phase = MatchPhase.PLAYING;
    this.matchStartAt = now;
    this.matchEndAt = now + MATCH_DURATION * 1000;
    this.phaseEndsAt = this.matchEndAt;
  }

  endMatch(now: number = Date.now()): GameOverPayload {
    this.phase = MatchPhase.GAME_OVER;
    this.phaseEndsAt = now + GAME_OVER_DURATION * 1000;

    let winner: Team | 'DRAW';
    let pinkScore = 0;
    let cyanScore = 0;

    if (this.mode === 'splat_zones') {
      pinkScore = this.zonePointsPink;
      cyanScore = this.zonePointsCyan;
      winner =
        pinkScore > cyanScore ? Team.PINK : cyanScore > pinkScore ? Team.CYAN : 'DRAW';
    } else if (this.mode === 'team_deathmatch') {
      pinkScore = this.pinkKills;
      cyanScore = this.cyanKills;
      winner =
        pinkScore > cyanScore ? Team.PINK : cyanScore > pinkScore ? Team.CYAN : 'DRAW';
    } else if (this.mode === 'ranked_hybrid') {
      const hybrid = this.getHybridScores();
      pinkScore = hybrid.pink;
      cyanScore = hybrid.cyan;
      winner =
        pinkScore > cyanScore ? Team.PINK : cyanScore > pinkScore ? Team.CYAN : 'DRAW';
    } else if (this.mode === 'final_push') {
      // The last sample taken before time-out decides the match; if the match
      // ended before the first sample, fall back to live coverage.
      const settled = this.lastPushSampleAt > 0;
      const score = this.paintGrid.getScore();
      pinkScore = settled ? this.pushPink : score.pinkPercentage;
      cyanScore = settled ? this.pushCyan : score.cyanPercentage;
      winner =
        pinkScore > cyanScore ? Team.PINK : cyanScore > pinkScore ? Team.CYAN : 'DRAW';
    } else {
      const score = this.paintGrid.getScore();
      pinkScore = score.pinkPercentage;
      cyanScore = score.cyanPercentage;
      winner =
        score.pinkPercentage > score.cyanPercentage
          ? Team.PINK
          : score.cyanPercentage > score.pinkPercentage
            ? Team.CYAN
            : 'DRAW';
    }

    return {
      winner,
      pinkCoverage: pinkScore,
      cyanCoverage: cyanScore,
      restartCountdown: Math.ceil(GAME_OVER_DURATION),
      mode: this.mode
    };
  }

  restartMatch(now: number = Date.now()): void {
    if (this.onResetCallback) {
      this.onResetCallback();
    }
    this.startCountdown(now);
  }

  getSnapshot(now: number = Date.now()): MatchStateSnapshot {
    const score = this.paintGrid.getScore();
    let pinkScore = score.pinkPercentage;
    let cyanScore = score.cyanPercentage;
    if (this.mode === 'splat_zones') {
      pinkScore = this.zonePointsPink;
      cyanScore = this.zonePointsCyan;
    } else if (this.mode === 'team_deathmatch') {
      pinkScore = this.pinkKills;
      cyanScore = this.cyanKills;
    } else if (this.mode === 'ranked_hybrid') {
      const hybrid = this.getHybridScores();
      pinkScore = hybrid.pink;
      cyanScore = hybrid.cyan;
    } else if (this.mode === 'final_push') {
      pinkScore = this.pushPink;
      cyanScore = this.pushCyan;
    }

    return {
      phase: this.phase,
      matchStartAt: this.matchStartAt,
      matchEndAt: this.matchEndAt,
      serverTime: now,
      pinkScore,
      cyanScore,
      mode: this.mode
    };
  }
}
