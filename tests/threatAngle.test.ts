import { describe, expect, it } from 'vitest';
import { Team } from '@ink/shared';
import { pickThreatPoint, threatAngle } from '../client/src/combat/ThreatAngle.js';

describe('incoming damage direction', () => {
  it('treats a point straight ahead as angle 0', () => {
    expect(threatAngle(0, 0, 0, 0, -12)).toBeCloseTo(0, 5);
  });

  it('treats a point on the right as a clockwise quarter turn', () => {
    expect(threatAngle(0, 0, 0, 8, 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('rotates with the player yaw', () => {
    // Facing +X (yaw = -PI/2). A point further along +X is still ahead.
    expect(threatAngle(-Math.PI / 2, 0, 0, 10, 0)).toBeCloseTo(0, 5);
  });

  it('prefers a recent enemy shot over a closer idle body', () => {
    const point = pickThreatPoint(
      1000,
      Team.CYAN,
      0,
      0,
      [{ x: 12, z: 0, team: Team.CYAN, at: 800 }],
      [{ x: 2, z: 0, team: Team.CYAN, alive: true }]
    );
    expect(point).toEqual({ x: 12, z: 0 });
  });

  it('falls back to the nearest living enemy when the shot is stale', () => {
    const point = pickThreatPoint(
      1000,
      Team.CYAN,
      0,
      0,
      [{ x: 12, z: 0, team: Team.CYAN, at: 100 }],
      [
        { x: 9, z: 0, team: Team.CYAN, alive: true },
        { x: 4, z: 1, team: Team.CYAN, alive: true },
        { x: 1, z: 0, team: Team.CYAN, alive: false }
      ]
    );
    expect(point).toEqual({ x: 4, z: 1 });
  });

  it('ignores friendly shots and opponents who are too far to be the attacker', () => {
    expect(
      pickThreatPoint(1000, Team.CYAN, 0, 0, [{ x: 3, z: 0, team: Team.PINK, at: 990 }], [
        { x: 30, z: 0, team: Team.CYAN, alive: true }
      ])
    ).toBeNull();
  });
});
