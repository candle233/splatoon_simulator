import {
  ARENA_HALF_SIZE,
  ARENA_OBSTACLES,
  BoxObstacle,
  HitResult,
  Ray,
  Team,
  Vec3,
  intersectRayAABB,
  intersectRayCapsule,
  intersectRayGroundPlane,
  vec3Add,
  vec3Scale
} from '@ink/shared';
import { PlayerState } from './PlayerState.js';

export class CollisionWorld {
  private obstacles: BoxObstacle[];
  private halfSize = ARENA_HALF_SIZE;

  constructor(obstacles = ARENA_OBSTACLES) {
    this.obstacles = obstacles;
  }

  getObstacles(): BoxObstacle[] {
    return this.obstacles;
  }

  /** Swaps the obstacle set and arena bounds (map change while in lobby). */
  setObstacles(obstacles: BoxObstacle[], mapSize = this.halfSize * 2): void {
    this.obstacles = obstacles;
    this.halfSize = mapSize / 2;
  }

  getHalfSize(): number {
    return this.halfSize;
  }

  /**
   * Resolves player position against obstacles, ground, and arena boundary.
   * Modifies player.position and grounded status in-place.
   */
  resolvePlayerMovement(
    player: PlayerState,
    prevPos: Vec3,
    newPos: Vec3,
    radius: number,
    height: number
  ): { grounded: boolean } {
    let grounded = false;
    let currX = newPos.x;
    let currY = newPos.y;
    let currZ = newPos.z;

    // 1. Arena boundary collision
    const boundLimit = this.halfSize - radius;
    currX = Math.max(-boundLimit, Math.min(boundLimit, currX));
    currZ = Math.max(-boundLimit, Math.min(boundLimit, currZ));

    // 2. Obstacle collision (AABB resolution on each axis)
    for (const obs of this.obstacles) {
      const minX = obs.position.x - obs.size.x * 0.5;
      const maxX = obs.position.x + obs.size.x * 0.5;
      const minY = obs.position.y - obs.size.y * 0.5;
      const maxY = obs.position.y + obs.size.y * 0.5;
      const minZ = obs.position.z - obs.size.z * 0.5;
      const maxZ = obs.position.z + obs.size.z * 0.5;

      // Player AABB approximation
      const pMinX = currX - radius;
      const pMaxX = currX + radius;
      const pMinY = currY;
      const pMaxY = currY + height;
      const pMinZ = currZ - radius;
      const pMaxZ = currZ + radius;

      // Check overlap
      if (
        pMaxX > minX &&
        pMinX < maxX &&
        pMaxY > minY &&
        pMinY < maxY &&
        pMaxZ > minZ &&
        pMinZ < maxZ
      ) {
        // Find minimum penetration axis
        const overlapX1 = pMaxX - minX;
        const overlapX2 = maxX - pMinX;
        const overlapY1 = pMaxY - minY;
        const overlapY2 = maxY - pMinY;
        const overlapZ1 = pMaxZ - minZ;
        const overlapZ2 = maxZ - pMinZ;

        const penX = overlapX1 < overlapX2 ? -overlapX1 : overlapX2;
        const penY = overlapY1 < overlapY2 ? -overlapY1 : overlapY2;
        const penZ = overlapZ1 < overlapZ2 ? -overlapZ1 : overlapZ2;

        const absX = Math.abs(penX);
        const absY = Math.abs(penY);
        const absZ = Math.abs(penZ);

        // Resolve along the axis with least penetration
        if (absY <= absX && absY <= absZ) {
          currY += penY;
          if (penY > 0) {
            grounded = true;
            player.velocity.y = 0;
          } else if (player.velocity.y > 0) {
            player.velocity.y = 0;
          }
        } else if (absX <= absZ) {
          currX += penX;
        } else {
          currZ += penZ;
        }
      } else if (
        pMaxX > minX &&
        pMinX < maxX &&
        pMaxZ > minZ &&
        pMinZ < maxZ &&
        Math.abs(currY - maxY) <= 0.06 &&
        player.velocity.y <= 0
      ) {
        // Player is standing stably on top of obstacle platform
        currY = maxY;
        grounded = true;
        player.velocity.y = 0;
      }
    }

    // 3. Ground plane collision (y = 0)
    if (currY <= 0) {
      currY = 0;
      grounded = true;
      if (player.velocity.y < 0) {
        player.velocity.y = 0;
      }
    }

    player.position.x = currX;
    player.position.y = currY;
    player.position.z = currZ;

    return { grounded };
  }

  /**
   * Raycast for camera collision so camera doesn't clip through walls
   */
  castCameraRay(ray: Ray, maxDistance: number): number | null {
    let closest = maxDistance;
    let hitAny = false;

    for (const obs of this.obstacles) {
      const aabb = {
        min: {
          x: obs.position.x - obs.size.x * 0.5,
          y: obs.position.y - obs.size.y * 0.5,
          z: obs.position.z - obs.size.z * 0.5
        },
        max: {
          x: obs.position.x + obs.size.x * 0.5,
          y: obs.position.y + obs.size.y * 0.5,
          z: obs.position.z + obs.size.z * 0.5
        }
      };

      const hit = intersectRayAABB(ray, aabb);
      if (hit && hit.t > 0 && hit.t < closest) {
        closest = hit.t;
        hitAny = true;
      }
    }

    const ground = intersectRayGroundPlane(ray, 0.2, this.halfSize);
    if (ground && ground.t > 0 && ground.t < closest) {
      closest = ground.t;
      hitAny = true;
    }

    return hitAny ? closest : null;
  }


  /**
   * Raycast against ground plane, obstacles, and enemy players.
   * Returns closest hit result.
   */
  castRay(
    ray: Ray,
    maxDistance: number,
    players: PlayerState[],
    shooterTeam: Team,
    shooterId: string
  ): HitResult {
    let closestDist = maxDistance;
    let hitResult: HitResult = {
      hit: false,
      distance: maxDistance,
      point: vec3Add(ray.origin, vec3Scale(ray.direction, maxDistance)),
      normal: { x: 0, y: 1, z: 0 },
      isGround: false
    };

    // 1. Ray vs Ground Plane (y = 0)
    const groundHit = intersectRayGroundPlane(ray, 0, this.halfSize);
    if (groundHit && groundHit.t > 0 && groundHit.t < closestDist) {
      closestDist = groundHit.t;
      hitResult = {
        hit: true,
        distance: groundHit.t,
        point: groundHit.point,
        normal: { x: 0, y: 1, z: 0 },
        isGround: true
      };
    }

    // 2. Ray vs Obstacles
    for (const obs of this.obstacles) {
      const aabb = {
        min: {
          x: obs.position.x - obs.size.x * 0.5,
          y: obs.position.y - obs.size.y * 0.5,
          z: obs.position.z - obs.size.z * 0.5
        },
        max: {
          x: obs.position.x + obs.size.x * 0.5,
          y: obs.position.y + obs.size.y * 0.5,
          z: obs.position.z + obs.size.z * 0.5
        }
      };

      const hit = intersectRayAABB(ray, aabb);
      if (hit && hit.t > 0 && hit.t < closestDist) {
        closestDist = hit.t;
        hitResult = {
          hit: true,
          distance: hit.t,
          point: vec3Add(ray.origin, vec3Scale(ray.direction, hit.t)),
          normal: hit.normal,
          hitObstacleId: obs.id,
          isGround: hit.normal.y > 0.7 // Horizontal top of obstacle counts as ground for painting
        };
      }
    }

    // 3. Ray vs Players
    for (const player of players) {
      if (player.id === shooterId) continue;
      if (!player.alive) continue;
      if (player.isInvulnerable()) continue;
      if (player.team === shooterTeam) continue; // No friendly fire

      const t = intersectRayCapsule(ray, player.position, 0.5, 1.8);
      if (t !== null && t > 0 && t < closestDist) {
        closestDist = t;
        hitResult = {
          hit: true,
          distance: t,
          point: vec3Add(ray.origin, vec3Scale(ray.direction, t)),
          normal: { x: 0, y: 1, z: 0 },
          hitPlayerId: player.id,
          isGround: false
        };
      }
    }

    return hitResult;
  }
}
