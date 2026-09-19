import { describe, expect, it } from 'vitest';
import { MatchPhase, Team } from '@ink/shared';
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
