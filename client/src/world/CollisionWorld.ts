import {
  ARENA_HALF_SIZE,
  ARENA_OBSTACLES,
  BoxObstacle,
  Ray,
  Vec3,
  intersectRayAABB,
  intersectRayGroundPlane
} from '@ink/shared';

export class ClientCollisionWorld {
  private obstacles: BoxObstacle[];

  constructor(obstacles = ARENA_OBSTACLES) {
    this.obstacles = obstacles;
  }

  setObstacles(obstacles: BoxObstacle[]): void {
    this.obstacles = obstacles;
  }

  getObstacles(): BoxObstacle[] {
    return this.obstacles;
  }

  /**
   * Raycast for camera collision so camera doesn't clip through walls.
   * Returns distance to nearest obstacle or null.
   */
  castCameraRay(ray: Ray, maxDistance: number): number | null {
    let closest = maxDistance;
    let hitAny = false;

    // Check vs obstacles
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

    // Check vs ground
    const ground = intersectRayGroundPlane(ray, 0.2, ARENA_HALF_SIZE);
    if (ground && ground.t > 0 && ground.t < closest) {
      closest = ground.t;
      hitAny = true;
    }

    return hitAny ? closest : null;
  }

  /**
   * Raycast against ground and obstacles for client-side aim prediction.
   */
  castRay(
    ray: Ray,
    maxDistance: number
  ): { hit: boolean; distance: number; point: Vec3 } {
    let closestDist = maxDistance;
    let hitResult = {
      hit: false,
      distance: maxDistance,
      point: {
        x: ray.origin.x + ray.direction.x * maxDistance,
        y: ray.origin.y + ray.direction.y * maxDistance,
        z: ray.origin.z + ray.direction.z * maxDistance
      }
    };

    // 1. Ray vs Ground Plane (y = 0)
    const groundHit = intersectRayGroundPlane(ray, 0, ARENA_HALF_SIZE);
    if (groundHit && groundHit.t > 0 && groundHit.t < closestDist) {
      closestDist = groundHit.t;
      hitResult = {
        hit: true,
        distance: groundHit.t,
        point: groundHit.point
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
          point: {
            x: ray.origin.x + ray.direction.x * hit.t,
            y: ray.origin.y + ray.direction.y * hit.t,
            z: ray.origin.z + ray.direction.z * hit.t
          }
        };
      }
    }

    return hitResult;
  }

  /**
   * Resolves simple AABB movement for local player prediction
   */
  resolveMovement(
    prevPos: Vec3,
    newPos: Vec3,
    radius: number,
    height: number,
    velocity: Vec3
  ): { position: Vec3; velocity: Vec3; grounded: boolean } {
    let grounded = false;
    let currX = newPos.x;
    let currY = newPos.y;
    let currZ = newPos.z;

    const bound = ARENA_HALF_SIZE - radius;
    currX = Math.max(-bound, Math.min(bound, currX));
    currZ = Math.max(-bound, Math.min(bound, currZ));

    for (const obs of this.obstacles) {
      const minX = obs.position.x - obs.size.x * 0.5;
      const maxX = obs.position.x + obs.size.x * 0.5;
      const minY = obs.position.y - obs.size.y * 0.5;
      const maxY = obs.position.y + obs.size.y * 0.5;
      const minZ = obs.position.z - obs.size.z * 0.5;
      const maxZ = obs.position.z + obs.size.z * 0.5;

      const pMinX = currX - radius;
      const pMaxX = currX + radius;
      const pMinY = currY;
      const pMaxY = currY + height;
      const pMinZ = currZ - radius;
      const pMaxZ = currZ + radius;

      if (
        pMaxX > minX &&
        pMinX < maxX &&
        pMaxY > minY &&
        pMinY < maxY &&
        pMaxZ > minZ &&
        pMinZ < maxZ
      ) {
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

        if (absY <= absX && absY <= absZ) {
          currY += penY;
          if (penY > 0) {
            grounded = true;
            velocity.y = 0;
          } else if (velocity.y > 0) {
            velocity.y = 0;
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
        velocity.y <= 0
      ) {
        // Player is standing stably on top of obstacle platform
        currY = maxY;
        grounded = true;
        velocity.y = 0;
      }
    }

    if (currY <= 0) {
      currY = 0;
      grounded = true;
      if (velocity.y < 0) {
        velocity.y = 0;
      }
    }

    return {
      position: { x: currX, y: currY, z: currZ },
      velocity,
      grounded
    };
  }
}
