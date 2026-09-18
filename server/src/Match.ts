import {
  COUNTDOWN_DURATION,
  GAME_OVER_DURATION,
  GameOverPayload,
  MATCH_DURATION,
  MatchPhase,
  MatchStateSnapshot,
  Team
} from '@ink/shared';
import { PaintGrid } from './PaintGrid.js';

export class Match {
  phase: MatchPhase = MatchPhase.WAITING;
  matchStartAt = 0;
  matchEndAt = 0;
  phaseEndsAt = 0;

  private paintGrid: PaintGrid;
  private onResetCallback?: () => void;

  constructor(paintGrid: PaintGrid, onReset?: () => void) {
    this.paintGrid = paintGrid;
    this.onResetCallback = onReset;
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
        if (playerCount >= 1) {
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

    const score = this.paintGrid.getScore();
    let winner: Team | 'DRAW';
    if (score.pinkPercentage > score.cyanPercentage) {
      winner = Team.PINK;
    } else if (score.cyanPercentage > score.pinkPercentage) {
      winner = Team.CYAN;
    } else {
      winner = 'DRAW';
    }

    return {
      winner,
      pinkCoverage: score.pinkPercentage,
      cyanCoverage: score.cyanPercentage,
      restartCountdown: Math.ceil(GAME_OVER_DURATION)
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
    return {
      phase: this.phase,
      matchStartAt: this.matchStartAt,
      matchEndAt: this.matchEndAt,
      serverTime: now,
      pinkScore: score.pinkPercentage,
      cyanScore: score.cyanPercentage
    };
  }
}
