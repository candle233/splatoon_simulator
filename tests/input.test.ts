import { describe, it, expect } from 'vitest';
import { computeMovementVelocity, RUN_SPEED } from '@ink/shared';

describe('Subagent 05: Input Normalization & Sanity', () => {
  it('clamps and normalizes multi-key directional intent', () => {
    // Pure diagonal forward-left (moveX = -1, moveZ = -1)
    const { vx, vz } = computeMovementVelocity(0, -1.0, -1.0, RUN_SPEED);
    const length = Math.sqrt(vx * vx + vz * vz);
    expect(length).toBeCloseTo(RUN_SPEED, 4);

    // X and Z components must be equal in magnitude: speed / sqrt(2)
    const expectedComp = RUN_SPEED / Math.SQRT2;
    expect(Math.abs(vx)).toBeCloseTo(expectedComp, 3);
    expect(Math.abs(vz)).toBeCloseTo(expectedComp, 3);
  });

  it('handles zero movement input cleanly without NaN', () => {
    const { vx, vz } = computeMovementVelocity(0, 0, 0, RUN_SPEED);
    expect(vx).toBe(0);
    expect(vz).toBe(0);
    expect(Number.isFinite(vx)).toBe(true);
    expect(Number.isFinite(vz)).toBe(true);
  });

  it('clamps inputs exceeding 1.0 down to unit vector length', () => {
    // Malicious or unnormalized input (moveX = 5, moveZ = 5)
    const { vx, vz } = computeMovementVelocity(0, 5.0, 5.0, RUN_SPEED);
    const length = Math.sqrt(vx * vx + vz * vz);
    expect(length).toBeCloseTo(RUN_SPEED, 3);
  });
});
