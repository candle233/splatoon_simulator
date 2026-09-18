import { describe, it, expect, beforeEach } from 'vitest';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { Team, worldToUV, uvToWorld, uvToPaintGrid } from '@ink/shared';

describe('PaintGrid & Coordinate Transforms', () => {
  let grid: PaintGrid;

  beforeEach(() => {
    grid = new PaintGrid(128); // 128x128 for fast unit test
  });

  it('initializes with all neutral cells', () => {
    const score = grid.getScore();
    expect(score.pinkCount).toBe(0);
    expect(score.cyanCount).toBe(0);
    expect(score.neutralCount).toBe(128 * 128);
    expect(score.pinkPercentage).toBe(0);
    expect(score.cyanPercentage).toBe(0);
  });

  it('accurately maps world coordinates to UV and clamps bounds', () => {
    expect(worldToUV(-50, -50)).toEqual({ u: 0, v: 0 });
    expect(worldToUV(50, 50)).toEqual({ u: 1, v: 1 });
    expect(worldToUV(0, 0)).toEqual({ u: 0.5, v: 0.5 });

    // Clamp checks
    expect(worldToUV(-100, 200)).toEqual({ u: 0, v: 1 });

    // Roundtrip test
    const uv = worldToUV(20, -30);
    const world = uvToWorld(uv.u, uv.v);
    expect(world.x).toBeCloseTo(20, 4);
    expect(world.z).toBeCloseTo(-30, 4);
  });

  it('converts UV to discrete paint grid coordinate with clamping', () => {
    const coord0 = uvToPaintGrid(0, 0, 128);
    expect(coord0).toEqual({ gx: 0, gy: 0 });

    const coordMid = uvToPaintGrid(0.5, 0.5, 128);
    expect(coordMid).toEqual({ gx: 64, gy: 64 });

    const coordMax = uvToPaintGrid(1.0, 1.0, 128);
    expect(coordMax).toEqual({ gx: 127, gy: 127 });
  });

  it('paints neutral to pink and updates score in O(k)', () => {
    grid.applyPaintEvent({
      id: 1,
      team: Team.PINK,
      u: 0.5,
      v: 0.5,
      radius: 0.05,
      seed: 12345
    });

    const score = grid.getScore();
    expect(score.pinkCount).toBeGreaterThan(0);
    expect(score.cyanCount).toBe(0);
    expect(score.pinkCount + score.neutralCount).toBe(128 * 128);
    expect(score.pinkPercentage).toBeGreaterThan(0);
    expect(grid.getInkAt(0, 0)).toBe(Team.PINK);
  });

  it('allows cyan to overwrite pink and correctly adjusts counts', () => {
    grid.applyPaintEvent({
      id: 1,
      team: Team.PINK,
      u: 0.5,
      v: 0.5,
      radius: 0.05,
      seed: 12345
    });
    const pinkScore1 = grid.getScore().pinkCount;

    // Overwrite the same area with cyan
    grid.applyPaintEvent({
      id: 2,
      team: Team.CYAN,
      u: 0.5,
      v: 0.5,
      radius: 0.05,
      seed: 12345
    });

    const score2 = grid.getScore();
    expect(score2.cyanCount).toBe(pinkScore1);
    expect(score2.pinkCount).toBe(0);
    expect(grid.getInkAt(0, 0)).toBe(Team.CYAN);
  });

  it('resets grid and scores completely', () => {
    grid.applyPaintEvent({
      id: 1,
      team: Team.PINK,
      u: 0.2,
      v: 0.2,
      radius: 0.05,
      seed: 999
    });

    grid.reset();
    const score = grid.getScore();
    expect(score.pinkCount).toBe(0);
    expect(score.cyanCount).toBe(0);
    expect(score.neutralCount).toBe(128 * 128);
    expect(grid.getInkAt(-30, -30)).toBe(Team.NEUTRAL);
  });
});
