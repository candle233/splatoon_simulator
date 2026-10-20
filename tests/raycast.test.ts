import { describe, it, expect } from 'vitest';
import {
  intersectRayGroundPlane,
  intersectRayAABB,
  intersectRayRamp,
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

  it('intersectRayRamp detects slope collision and calculates outward slope normal', () => {
    // Ramp rising toward south (+z) from z=0 to z=10, rise 3.0, width 4.0
    const testRamp = {
      id: 'test_ramp',
      position: { x: 0, y: 1.5, z: 5 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };

    // Shoot downwards from y=5 at z=5 (midpoint of ramp, expected y = 1.5)
    const ray: Ray = {
      origin: { x: 0, y: 5, z: 5 },
      direction: { x: 0, y: -1, z: 0 }
    };

    const hit = intersectRayRamp(ray, testRamp);
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeCloseTo(1.5, 2);
    expect(hit!.point.z).toBeCloseTo(5.0, 2);
    // Slope normal should face upward-backward (positive y, negative z)
    expect(hit!.normal.y).toBeGreaterThan(0.7);
    expect(hit!.normal.z).toBeLessThan(0);
  });

  it('CollisionWorld.castRay hits ramp slope, marks isGround, and populates hitRampId', () => {
    const testRamp = {
      id: 'ramp_alpha',
      position: { x: 0, y: 1.5, z: 5 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };

    const world = new CollisionWorld([], [testRamp]);

    // Cast ray downward onto the ramp
    const ray: Ray = {
      origin: { x: 0, y: 4, z: 5 },
      direction: { x: 0, y: -1, z: 0 }
    };

    const hit = world.castRay(ray, 20, [], Team.PINK, 'shooter');
    expect(hit.hit).toBe(true);
    expect(hit.hitRampId).toBe('ramp_alpha');
    expect(hit.isGround).toBe(true);
    expect(hit.point.y).toBeCloseTo(1.5, 1);
  });

  it('CollisionWorld.castCameraRay stops camera at ramp surface', () => {
    const testRamp = {
      id: 'ramp_cam',
      position: { x: 0, y: 1.5, z: 5 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };

    const world = new CollisionWorld([], [testRamp]);

    // Camera ray from behind and above looking toward ground
    const ray: Ray = {
      origin: { x: 0, y: 4.5, z: 5 },
      direction: { x: 0, y: -1, z: 0 }
    };

    const dist = world.castCameraRay(ray, 10);
    expect(dist).not.toBeNull();
    expect(dist).toBeCloseTo(3.0, 1); // 4.5 - 1.5 = 3.0
  });

  it('CollisionWorld.getGroundHeightAt queries ramp slopes and platform tops smoothly', () => {
    const testRamp = {
      id: 'ramp_elevation',
      position: { x: 0, y: 1.5, z: 5 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };
    const platform = {
      id: 'platform_crest',
      position: { x: 0, y: 1.5, z: 12 },
      size: { x: 6, y: 3, z: 4 }
    };

    const world = new CollisionWorld([platform], [testRamp]);

    // At foot of ramp (z = 0)
    expect(world.getGroundHeightAt(0, 0)).toBeCloseTo(0, 1);
    // Halfway up ramp (z = 5)
    expect(world.getGroundHeightAt(0, 5)).toBeCloseTo(1.5, 1);
    // Near top of ramp (z = 9.5)
    expect(world.getGroundHeightAt(0, 9.5)).toBeCloseTo(2.85, 1);
    // On top of the connecting platform (z = 12)
    expect(world.getGroundHeightAt(0, 12)).toBeCloseTo(3.0, 1);
  });

  it('intersectRayRamp returns null for rays starting inside the ramp volume', () => {
    const testRamp = {
      id: 'ramp_inside',
      position: { x: 0, y: 1.5, z: 5 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };

    // Point inside the ramp (at z=5, ramp surface is at y=1.5; y=0.8 is inside)
    const rayInside: Ray = {
      origin: { x: 0, y: 0.8, z: 5 },
      direction: { x: 0, y: 1, z: 0 }
    };
    expect(intersectRayRamp(rayInside, testRamp)).toBeNull();
  });

  it('CollisionWorld.castRay identifies steep ramp slopes as valid isGround', () => {
    const steepRamp = {
      id: 'steep_ramp',
      position: { x: 0, y: 2, z: 3 },
      length: 6,
      width: 4,
      rise: 4, // slope = 4/6 = 0.667, normal.y ≈ 0.83
      direction: 'south' as const,
      climbable: true
    };
    const world = new CollisionWorld([], [steepRamp]);
    const ray: Ray = {
      origin: { x: 0, y: 6, z: 3 },
      direction: { x: 0, y: -1, z: 0 }
    };
    const hit = world.castRay(ray, 10, [], Team.PINK, 'shooter');
    expect(hit.hit).toBe(true);
    expect(hit.hitRampId).toBe('steep_ramp');
    expect(hit.isGround).toBe(true);
  });
});
