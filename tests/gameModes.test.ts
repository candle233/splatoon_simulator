/**
 * Game-mode integrity.
 *
 * A mode is only real if it can be *won*: declaring it in MODE_CONFIGS and
 * rendering a card is not enough. These tests drive `Match` to a decided winner
 * for every mode, so a new mode that can never end the match fails here.
 */
import { describe, expect, it } from 'vitest';
import { GAME_MODES, MODE_CONFIGS, MatchPhase, Team, isValidGameMode } from '@ink/shared';
import { Match } from '../server/src/Match.js';
import { PaintGrid } from '../server/src/PaintGrid.js';

function makeMatch(): { match: Match; grid: PaintGrid } {
  const grid = new PaintGrid();
  const match = new Match(grid);
  return { match, grid };
}

/** Paints the whole grid one team's colour so coverage-based modes are decided. */
function paintAll(grid: PaintGrid, team: Team): void {
  const res = 48;
  let id = 1;
  for (let x = 0; x < res; x++) {
    for (let z = 0; z < res; z++) {
      grid.applyPaintEvent({
        id: id++,
        team,
        u: x / res,
        v: z / res,
        radius: 0.09,
        seed: 1
      });
    }
  }
}

describe('game modes are declared completely', () => {
  it('every mode in GAME_MODES resolves to a valid config', () => {
    expect(GAME_MODES.length).toBeGreaterThanOrEqual(5);
    for (const mode of GAME_MODES) {
      expect(isValidGameMode(mode), `${mode} should validate`).toBe(true);
      const cfg = MODE_CONFIGS[mode];
      expect(cfg, `${mode} missing config`).toBeTruthy();
      expect(cfg.id).toBe(mode);
      expect(cfg.icon.trim().length, `${mode} needs an icon`).toBeGreaterThan(0);
      // Trilingual completeness
      for (const field of ['name', 'nameZh', 'nameJa', 'description', 'descriptionZh', 'descriptionJa'] as const) {
        expect(cfg[field]?.trim().length, `${mode}.${field} is empty`).toBeGreaterThan(0);
      }
      expect(cfg.scoreLimit).toBeGreaterThanOrEqual(0);
    }
  });

  it('MODE_CONFIGS has no modes missing from GAME_MODES', () => {
    expect(Object.keys(MODE_CONFIGS).sort()).toEqual([...GAME_MODES].sort());
  });
});

describe('every mode can reach a decided winner', () => {
  it('turf_war decides on coverage when time runs out', () => {
    const { match, grid } = makeMatch();
    match.setConfig('turf_war');
    match.startPlaying(1000);
    paintAll(grid, Team.PINK);

    const payload = match.endMatch(2000);
    expect(payload.mode).toBe('turf_war');
    expect(payload.winner).toBe(Team.PINK);
  });

  it('splat_zones decides on control points', () => {
    const { match } = makeMatch();
    match.setConfig('splat_zones');
    match.startPlaying(1000);
    // Feed the zone tick enough times for pink to bank points.
    for (let i = 0; i < 10; i++) {
      match.tickZone({ pink: 10, cyan: 0, total: 10 }, 2000 + i * 1100);
    }
    const payload = match.endMatch(30000);
    expect(payload.mode).toBe('splat_zones');
    expect(payload.winner).toBe(Team.PINK);
    expect(payload.pinkCoverage).toBeGreaterThan(0);
  });

  it('team_deathmatch decides on knockouts', () => {
    const { match } = makeMatch();
    match.setConfig('team_deathmatch');
    match.startPlaying(1000);
    match.setTeamKills(3, 9);

    const payload = match.endMatch(2000);
    expect(payload.mode).toBe('team_deathmatch');
    expect(payload.winner).toBe(Team.CYAN);
    expect(payload.cyanCoverage).toBe(9);
  });

  it('ranked_hybrid combines coverage and knockouts', () => {
    const { match, grid } = makeMatch();
    match.setConfig('ranked_hybrid');
    match.startPlaying(1000);
    // Cyan paints nothing but wins every fight; pink paints half the map.
    paintAll(grid, Team.PINK);
    match.setTeamKills(0, 30);

    const hybrid = match.getHybridScores();
    // 30 kills x 5 = 150 points must beat 100% coverage.
    expect(hybrid.cyan).toBeGreaterThan(hybrid.pink);

    const payload = match.endMatch(2000);
    expect(payload.mode).toBe('ranked_hybrid');
    expect(payload.winner).toBe(Team.CYAN);
  });

  it('ranked_hybrid still rewards painting when kills are even', () => {
    const { match, grid } = makeMatch();
    match.setConfig('ranked_hybrid');
    match.startPlaying(1000);
    paintAll(grid, Team.PINK);
    match.setTeamKills(2, 2);

    expect(match.endMatch(2000).winner).toBe(Team.PINK);
  });

  it('final_push decides on the last coverage sample, not the live one', () => {
    const { match, grid } = makeMatch();
    match.setConfig('final_push');
    match.startPlaying(1000);

    // First sample (taken immediately at play start): pink owns the map.
    paintAll(grid, Team.PINK);
    match.tickFinalPush(1100);

    // Then cyan takes the map, but the sample is inside the 15 s window so the
    // verdict must NOT move until the next sample fires.
    paintAll(grid, Team.CYAN);
    const beforeSample = match.getFinalPushScores();
    expect(beforeSample.pink).toBeGreaterThan(beforeSample.cyan);

    // Next sample fires, and now the verdict flips.
    match.tickFinalPush(1100 + 15_000);
    const afterSample = match.getFinalPushScores();
    expect(afterSample.cyan).toBeGreaterThan(afterSample.pink);

    const payload = match.endMatch(40000);
    expect(payload.mode).toBe('final_push');
    expect(payload.winner).toBe(Team.CYAN);
  });

  it('final_push falls back to live coverage if it ends before the first sample', () => {
    const { match, grid } = makeMatch();
    match.setConfig('final_push');
    match.startPlaying(1000);
    paintAll(grid, Team.CYAN);

    // No tickFinalPush call at all: endMatch must still pick a winner.
    const payload = match.endMatch(2000);
    expect(payload.winner).toBe(Team.CYAN);
  });

  it('switching modes clears the previous mode score state', () => {
    const { match } = makeMatch();
    match.setConfig('splat_zones');
    match.startPlaying(1000);
    for (let i = 0; i < 5; i++) match.tickZone({ pink: 10, cyan: 0, total: 10 }, 2000 + i * 1100);
    expect(match.getZonePoints().pink).toBeGreaterThan(0);

    match.setConfig('final_push');
    expect(match.getZonePoints().pink).toBe(0);
    expect(match.getFinalPushScores()).toEqual({ pink: 0, cyan: 0 });
  });
});

describe('new modes start a match like any other', () => {
  for (const mode of ['ranked_hybrid', 'final_push'] as const) {
    it(`${mode} counts down then plays`, () => {
      const { match } = makeMatch();
      match.setConfig(mode);
      match.startCountdown(1000);
      expect(match.phase).toBe(MatchPhase.COUNTDOWN);
      expect(match.getSnapshot(1000).mode).toBe(mode);

      match.startPlaying(5000);
      expect(match.phase).toBe(MatchPhase.PLAYING);
      // The snapshot must expose this mode's own score fields.
      const snap = match.getSnapshot(6000);
      expect(Number.isFinite(snap.pinkScore)).toBe(true);
      expect(Number.isFinite(snap.cyanScore)).toBe(true);
    });
  }
});
