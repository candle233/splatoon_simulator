import { describe, it, expect, beforeEach } from 'vitest';
import { Match } from '../server/src/Match.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { MatchPhase, Team } from '@ink/shared';

describe('Match State Machine', () => {
  let paintGrid: PaintGrid;
  let match: Match;
  let resetTriggered = false;

  beforeEach(() => {
    resetTriggered = false;
    paintGrid = new PaintGrid(128);
    match = new Match(paintGrid, () => {
      resetTriggered = true;
    });
  });

  it('starts in WAITING and moves to COUNTDOWN when a player joins', () => {
    expect(match.phase).toBe(MatchPhase.WAITING);

    const now = 100000;
    const res = match.update(1, now);
    expect(res.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.COUNTDOWN);
  });

  it('transitions from COUNTDOWN to PLAYING after 3 seconds', () => {
    const startTime = 100000;
    match.update(1, startTime); // enters COUNTDOWN

    // 2 seconds later -> still COUNTDOWN
    let res = match.update(1, startTime + 2000);
    expect(match.phase).toBe(MatchPhase.COUNTDOWN);

    // 3.1 seconds later -> enters PLAYING
    res = match.update(1, startTime + 3100);
    expect(res.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.PLAYING);
  });

  it('transitions from PLAYING to GAME_OVER after match duration and declares winner', () => {
    const startTime = 100000;
    match.update(1, startTime); // COUNTDOWN
    match.update(1, startTime + 3100); // PLAYING

    // Paint some pink territory
    paintGrid.applyPaintEvent({
      id: 1,
      team: Team.PINK,
      u: 0.5,
      v: 0.5,
      radius: 0.1,
      seed: 42
    });

    // 180 seconds later
    const endMatchTime = startTime + 3100 + 180100;
    const res = match.update(1, endMatchTime);

    expect(res.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    expect(res.gameOverPayload).toBeDefined();
    expect(res.gameOverPayload!.winner).toBe(Team.PINK);
    expect(res.gameOverPayload!.pinkCoverage).toBeGreaterThan(0);
  });

  it('restarts match and triggers reset callback after GAME_OVER', () => {
    const startTime = 100000;
    match.update(1, startTime);
    match.update(1, startTime + 3100);
    match.update(1, startTime + 3100 + 180100); // enters GAME_OVER

    // 8.1 seconds later -> enters RESTART / COUNTDOWN
    const restartTime = startTime + 3100 + 180100 + 8100;
    const res = match.update(1, restartTime);

    expect(res.phaseChanged).toBe(true);
    expect(resetTriggered).toBe(true);
    expect(match.phase).toBe(MatchPhase.COUNTDOWN);
  });
});
