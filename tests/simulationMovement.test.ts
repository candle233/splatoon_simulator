import { describe, it, expect } from 'vitest';
import {
  computeMovementVelocity,
  getMovementSpeed,
  integrateVerticalKinematics,
  PlayerMode,
  RUN_SPEED,
  SQUID_SPEED,
  ENEMY_INK_SPEED,
  Team,
  GRAVITY,
  JUMP_VELOCITY
} from '@ink/shared';

describe('Subagent 08 & 09: Local & Server Movement Simulation', () => {
  it('normalizes diagonal input to prevent sqrt(2) speed glitch', () => {
    // Pressing W and D together: moveX = 1, moveZ = -1 (forward-right)
    const { vx, vz } = computeMovementVelocity(0, 1.0, -1.0, RUN_SPEED);
    const speed = Math.sqrt(vx * vx + vz * vz);
    expect(speed).toBeCloseTo(RUN_SPEED, 3);
  });

  it('preserves single axis max speed exactly', () => {
    // Pure forward (moveZ = -1, moveX = 0) with yaw = 0
    const { vx, vz } = computeMovementVelocity(0, 0, -1.0, RUN_SPEED);
    expect(vx).toBeCloseTo(0, 4);
    expect(vz).toBeCloseTo(-RUN_SPEED, 4);
  });

  it('produces identical total displacement at 30fps vs 60fps across 1 second of linear motion', () => {
    const totalTime = 1.0; // 1 second
    const speed = RUN_SPEED;

    // Simulate 30 fps (30 steps of dt = 1/30)
    let dist30 = 0;
    const dt30 = 1 / 30;
    for (let i = 0; i < 30; i++) {
      const { vz } = computeMovementVelocity(0, 0, -1.0, speed);
      dist30 += Math.abs(vz) * dt30;
    }

    // Simulate 60 fps (60 steps of dt = 1/60)
    let dist60 = 0;
    const dt60 = 1 / 60;
    for (let i = 0; i < 60; i++) {
      const { vz } = computeMovementVelocity(0, 0, -1.0, speed);
      dist60 += Math.abs(vz) * dt60;
    }

    expect(dist30).toBeCloseTo(speed * totalTime, 3);
    expect(dist60).toBeCloseTo(speed * totalTime, 3);
    expect(Math.abs(dist30 - dist60)).toBeLessThan(1e-4);
  });

  it('scales speed accurately by 1.8x in squid form and 0.3x in enemy ink', () => {
    const normalSpeed = getMovementSpeed(PlayerMode.HUMANOID, Team.NEUTRAL, Team.PINK);
    expect(normalSpeed).toBe(RUN_SPEED);

    const squidSpeed = getMovementSpeed(PlayerMode.SUBMERGED, Team.PINK, Team.PINK);
    expect(squidSpeed).toBeCloseTo(SQUID_SPEED, 3);
    expect(squidSpeed / normalSpeed).toBeCloseTo(1.8, 3);

    const enemyInkSpeed = getMovementSpeed(PlayerMode.HUMANOID, Team.CYAN, Team.PINK);
    expect(enemyInkSpeed).toBeCloseTo(ENEMY_INK_SPEED, 3);
    expect(enemyInkSpeed / normalSpeed).toBeCloseTo(0.3, 3);
  });

  it('integrates vertical kinematics with jump velocity and gravity correctly', () => {
    // Jump when grounded: initial jump velocity is applied and integrated over dt
    const resJump = integrateVerticalKinematics(0, true, true, 0.05);
    expect(resJump.grounded).toBe(false);
    expect(resJump.vy).toBeCloseTo(JUMP_VELOCITY + GRAVITY * 0.05, 3);

    // Airborne step under gravity
    const resAirborne = integrateVerticalKinematics(resJump.vy, false, false, 0.05);
    expect(resAirborne.grounded).toBe(false);
    expect(resAirborne.vy).toBeCloseTo(JUMP_VELOCITY + GRAVITY * 0.10, 3);
  });
});
