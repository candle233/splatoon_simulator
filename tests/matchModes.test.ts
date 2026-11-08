import { describe, expect, it } from 'vitest';
import {
  MATCH_DURATION,
  MatchPhase,
  OVERTIME_MAX_SEC,
  OVERTIME_TRIGGER_PT,
  Team
} from '@ink/shared';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { Match } from '../server/src/Match.js';

describe('match modes scoring (模式计分)', () => {
  it('turf war ends by coverage percentage', () => {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.mode = 'turf_war';

    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: 0.3, v: 0.5, radius: 0.2, seed: 1 });

    const payload = match.endMatch();
    expect(payload.mode).toBe('turf_war');
    expect(payload.winner).toBe(Team.PINK);
    expect(payload.pinkCoverage).toBeGreaterThan(payload.cyanCoverage);
  });

  it('splat zones accumulates control points at 1 Hz and ends at the score limit', () => {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.setConfig('splat_zones', 'downtown');
    match.startCountdown(0);
    match.startPlaying(1000);

    // Pink holds the zone for 149 seconds
    let now = 2000;
    for (let i = 0; i < 149; i++) {
      match.tickZone({ pink: 500, cyan: 100, total: 600 }, now);
      now += 1000;
    }
    const pts = match.getZonePoints();
    expect(pts.pink).toBe(149);
    expect(pts.cyan).toBe(0);

    // Reaching the 150-point limit ends the match inside tickZone
    match.tickZone({ pink: 500, cyan: 100, total: 600 }, now);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    const snapshot = match.getSnapshot(now);
    expect(snapshot.mode).toBe('splat_zones');
    expect(snapshot.pinkScore).toBe(150);
  });

  it('ignores zone ticks that arrive faster than 1 Hz', () => {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.setConfig('splat_zones');
    match.startCountdown(0);
    match.startPlaying(1000);

    match.tickZone({ pink: 400, cyan: 0, total: 400 }, 2000);
    match.tickZone({ pink: 400, cyan: 0, total: 400 }, 2300);
    match.tickZone({ pink: 400, cyan: 0, total: 400 }, 2600);
    expect(match.getZonePoints().pink).toBe(1);
  });

  it('team deathmatch ends on kill score', () => {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.setConfig('team_deathmatch');
    match.startCountdown(0);
    match.startPlaying(0);

    match.setTeamKills(41, 12);
    const update = match.update(4, 1000);
    expect(update.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    expect(update.gameOverPayload?.winner).toBe(Team.PINK);
    expect(update.gameOverPayload?.mode).toBe('team_deathmatch');
    expect(update.gameOverPayload?.pinkCoverage).toBe(41);
    expect(update.gameOverPayload?.cyanCoverage).toBe(12);
  });

  it('resetting player count returns to WAITING and clears zone points', () => {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.setConfig('splat_zones');
    match.startCountdown(0);
    match.startPlaying(0);
    match.tickZone({ pink: 400, cyan: 0, total: 400 }, 2000);

    const update = match.update(0, 3000);
    expect(update.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.WAITING);
    expect(match.getZonePoints().pink).toBe(0);
  });
});

describe('turf war overtime (涂地战延长赛)', () => {
  /** Fresh turf_war match; regulation expires at `endAt` (started at t=1000). */
  function makeTurfMatch(): { grid: PaintGrid; match: Match; endAt: number } {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.setConfig('turf_war');
    match.startCountdown(0);
    match.startPlaying(1000);
    return { grid, match, endAt: 1000 + MATCH_DURATION * 1000 };
  }

  function coverageGap(grid: PaintGrid): number {
    const score = grid.getScore();
    return Math.abs(score.pinkPercentage - score.cyanPercentage);
  }

  it('regulation expiry with a tight race extends into overtime exactly once', () => {
    const { grid, match, endAt } = makeTurfMatch();
    // Mirror-symmetric blobs (same radius/seed at u=0.25 / u=0.75) keep the
    // race statistically dead even — deterministic, no statistical slack.
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: 0.25, v: 0.5, radius: 0.2, seed: 7 });
    grid.applyPaintEvent({ id: 2, team: Team.CYAN, u: 0.75, v: 0.5, radius: 0.2, seed: 7 });
    expect(coverageGap(grid)).toBeLessThanOrEqual(OVERTIME_TRIGGER_PT);

    const update = match.update(2, endAt);
    expect(update.phaseChanged).toBe(false);
    expect(update.gameOverPayload).toBeUndefined();
    expect(match.phase).toBe(MatchPhase.PLAYING);
    expect(match.matchEndAt).toBe(endAt + OVERTIME_MAX_SEC * 1000);
    expect(match.getSnapshot(endAt).overtime).toBe(true);
  });

  it('a clear coverage lead at expiry ends the match without overtime', () => {
    const { grid, match, endAt } = makeTurfMatch();
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: 0.5, v: 0.5, radius: 0.3, seed: 7 });
    expect(coverageGap(grid)).toBeGreaterThanOrEqual(5);

    const update = match.update(2, endAt);
    expect(update.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    expect(update.gameOverPayload?.winner).toBe(Team.PINK);
    expect(update.gameOverPayload?.pinkCoverage).toBeGreaterThan(update.gameOverPayload?.cyanCoverage ?? 0);
    expect(match.getSnapshot(endAt).overtime).toBe(false);
  });

  it('overtime settles immediately once the coverage gap breaks open', () => {
    const { grid, match, endAt } = makeTurfMatch();
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: 0.25, v: 0.5, radius: 0.2, seed: 7 });
    grid.applyPaintEvent({ id: 2, team: Team.CYAN, u: 0.75, v: 0.5, radius: 0.2, seed: 7 });
    expect(match.update(2, endAt).phaseChanged).toBe(false); // overtime running

    // Pink pulls clearly ahead during the extension.
    grid.applyPaintEvent({ id: 3, team: Team.PINK, u: 0.1, v: 0.1, radius: 0.15, seed: 9 });
    expect(coverageGap(grid)).toBeGreaterThan(OVERTIME_TRIGGER_PT);

    const update = match.update(2, endAt + 1000);
    expect(update.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    expect(update.gameOverPayload?.winner).toBe(Team.PINK);
  });

  it('overtime exhausts without a second extension', () => {
    const { grid, match, endAt } = makeTurfMatch();
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: 0.25, v: 0.5, radius: 0.2, seed: 7 });
    grid.applyPaintEvent({ id: 2, team: Team.CYAN, u: 0.75, v: 0.5, radius: 0.2, seed: 7 });
    match.update(2, endAt); // enters overtime
    const extendedEnd = endAt + OVERTIME_MAX_SEC * 1000;

    const update = match.update(2, extendedEnd);
    expect(update.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    expect(update.gameOverPayload).toBeDefined();
    // The clock was extended once, and never again.
    expect(match.matchEndAt).toBe(extendedEnd);
  });

  it('only turf_war can extend: splat_zones still ends at regulation expiry', () => {
    const grid = new PaintGrid(64);
    const match = new Match(grid);
    match.setConfig('splat_zones');
    match.startCountdown(0);
    match.startPlaying(1000);
    const endAt = 1000 + MATCH_DURATION * 1000;

    const update = match.update(2, endAt);
    expect(update.phaseChanged).toBe(true);
    expect(match.phase).toBe(MatchPhase.GAME_OVER);
    expect(match.matchEndAt).toBe(endAt); // untouched
    expect(match.getSnapshot(endAt).overtime).toBe(false);
  });

  it('starting the next match clears the overtime flag', () => {
    const { grid, match, endAt } = makeTurfMatch();
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: 0.25, v: 0.5, radius: 0.2, seed: 7 });
    grid.applyPaintEvent({ id: 2, team: Team.CYAN, u: 0.75, v: 0.5, radius: 0.2, seed: 7 });
    match.update(2, endAt);
    expect(match.getSnapshot(endAt).overtime).toBe(true);

    match.startCountdown(5000);
    expect(match.getSnapshot(5000).overtime).toBe(false);
    match.startPlaying(6000);
    expect(match.getSnapshot(6000).overtime).toBe(false);
  });
});
