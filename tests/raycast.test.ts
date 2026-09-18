import { describe, it, expect } from 'vitest';
import {
  intersectRayGroundPlane,
  intersectRayAABB,
  Ray,
  AABB,
  Team
} from '@ink/shared';
import { CollisionWorld } from '../server/src/Collision.js';
import { PlayerState } from '../server/src/PlayerState.js';

describe('Raycasting Math & CollisionWorld', () => {
  it('correctly intersects ray with ground plane', () => {
    const ray: Ray = {
      origin: { x: 0, y: 10, z: 0 },
      direction: { x: 0, y: -1, z: 0 }
    };

    const hit = intersectRayGroundPlane(ray, 0, 50);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBe(10);
    expect(hit!.point).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects ray pointing away from ground or parallel', () => {
    const rayUp: Ray = {
      origin: { x: 0, y: 10, z: 0 },
      direction: { x: 0, y: 1, z: 0 }
    };
    expect(intersectRayGroundPlane(rayUp, 0, 50)).toBeNull();

    const rayParallel: Ray = {
      origin: { x: 0, y: 10, z: 0 },
      direction: { x: 1, y: 0, z: 0 }
    };
    expect(intersectRayGroundPlane(rayParallel, 0, 50)).toBeNull();
  });

  it('correctly intersects ray with AABB using slab method', () => {
    const aabb: AABB = {
      min: { x: -2, y: 0, z: -2 },
      max: { x: 2, y: 4, z: 2 }
    };

    const ray: Ray = {
      origin: { x: 0, y: 2, z: -10 },
      direction: { x: 0, y: 0, z: 1 }
    };

    const hit = intersectRayAABB(ray, aabb);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBe(8); // from z=-10 to z=-2
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('CollisionWorld selects nearest hit when obstacle blocks target', () => {
    // Custom world with a wall between shooter and enemy
    const world = new CollisionWorld([
      { id: 'shield_wall', position: { x: 0, y: 1.5, z: 10 }, size: { x: 10, y: 3, z: 1 } }
    ]);

    const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 1, z: 0 });
    const enemyBehindWall = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 1, z: 20 });

    const ray: Ray = {
      origin: { x: 0, y: 1.5, z: 0 },
      direction: { x: 0, y: 0, z: 1 }
    };

    const hit = world.castRay(ray, 50, [shooter, enemyBehindWall], Team.PINK, 'p1');

    expect(hit.hit).toBe(true);
    expect(hit.hitObstacleId).toBe('shield_wall');
    expect(hit.hitPlayerId).toBeUndefined();
    expect(hit.distance).toBeCloseTo(9.5, 1);
  });
});
