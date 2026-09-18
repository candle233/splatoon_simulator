import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionWorld } from '../server/src/Collision.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';
import { WeaponSimulation } from '../server/src/WeaponSimulation.js';
import { MovementSimulation } from '../server/src/MovementSimulation.js';
import { sanitizePlayerInput } from '../server/src/validation.js';
import {
  Team,
  PlayerMode,
  PlayerInput,
  JUMP_VELOCITY,
  GRAVITY,
  worldToUV,
  BoxObstacle
} from '@ink/shared';

describe('Two-Stage TPS Aiming, Platform Grounding, and Squid Jump', () => {
  let obstacles: BoxObstacle[];
  let collisionWorld: CollisionWorld;
  let paintGrid: PaintGrid;
  let weaponSim: WeaponSimulation;
  let movementSim: MovementSimulation;

  beforeEach(() => {
    obstacles = [
      { id: 'platform_test', position: { x: 0, y: 1.0, z: 0 }, size: { x: 10, y: 2.0, z: 10 } }
    ];
    collisionWorld = new CollisionWorld(obstacles);
    paintGrid = new PaintGrid(128);
    weaponSim = new WeaponSimulation(collisionWorld, paintGrid);
    movementSim = new MovementSimulation(collisionWorld, paintGrid);
  });

  it('Two-stage aiming populates muzzle origin and target and hits crosshair target in line of sight', () => {
    // Position clear of the center obstacle (x = 15)
    const shooter = new PlayerState('shooter', Team.PINK, 0, { x: 15, y: 0, z: -10 });
    const victim = new PlayerState('victim', Team.CYAN, 0, { x: 15, y: 0, z: 10 });
    shooter.yaw = Math.PI; // Looking along +Z
    shooter.pitch = 0;

    const res = weaponSim.processFire(shooter, [shooter, victim], 100000);
    expect(res.fired).toBe(true);
    expect(res.origin).toBeDefined();
    expect(res.target).toBeDefined();

    // Muzzle is offset by shoulder offset (0.35 units)
    expect(Math.abs(res.origin!.x - 15)).toBeCloseTo(0.35, 1);
    expect(res.origin!.y).toBeGreaterThan(0.5);

    // Target hits victim
    expect(res.hitPlayerId).toBe('victim');
  });

  it('Blocks bullet and prevents player hit when obstacle is in the line of fire', () => {
    // Shooter and victim have platform_test at (0, 1, 0) directly between them
    const shooter = new PlayerState('shooter', Team.PINK, 0, { x: 0, y: 0, z: -10 });
    const victim = new PlayerState('victim', Team.CYAN, 0, { x: 0, y: 0, z: 10 });
    shooter.yaw = Math.PI;
    shooter.pitch = 0;

    const res = weaponSim.processFire(shooter, [shooter, victim], 100000);
    expect(res.fired).toBe(true);
    expect(res.hitPlayerId).toBeUndefined(); // blocked by platform_test
    expect(res.target!.z).toBeCloseTo(-5.0, 1); // hit the front face of platform at z=-5
  });

  it('maintains continuous grounded state on top of platform across 10 ticks without oscillation', () => {
    // Top of platform_test is at y = 1.0 + 2.0 / 2 = 2.0
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 2.0, z: 0 });
    player.grounded = true;

    const idleInput: PlayerInput = {
      seq: 1,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      jump: false,
      squid: false,
      fire: false,
      clientTime: 100000
    };

    for (let tick = 0; tick < 10; tick++) {
      movementSim.simulatePlayer(player, idleInput, 0.05, 100000 + tick * 50);
      expect(player.grounded).toBe(true);
      expect(player.position.y).toBeCloseTo(2.0, 2);
    }
  });

  it('allows player to jump while submerged in own ink', () => {
    // Player on ground outside obstacle
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 20 });

    // Paint floor under player (0, 20) with PINK
    const { u, v } = worldToUV(0, 20);
    paintGrid.applyPaintEvent({
      id: 1,
      team: Team.PINK,
      u,
      v,
      radius: 0.1,
      seed: 1
    });

    const jumpWhileSquidInput: PlayerInput = {
      seq: 1,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      jump: true,
      squid: true,
      fire: false,
      clientTime: 100000
    };

    movementSim.simulatePlayer(player, jumpWhileSquidInput, 0.05, 100000);
    expect(player.velocity.y).toBeCloseTo(JUMP_VELOCITY + GRAVITY * 0.05, 1);
    expect(player.grounded).toBe(false);
    expect(player.position.y).toBeGreaterThan(0);
  });

  it('sanitizes malicious NaN and Infinity inputs', () => {
    const badInput = {
      seq: NaN,
      moveX: Infinity,
      moveZ: -Infinity,
      yaw: NaN,
      pitch: 1e300,
      jump: false,
      squid: false,
      fire: false
    };

    const sanitized = sanitizePlayerInput(badInput);
    expect(sanitized).toBeNull();
  });
});
