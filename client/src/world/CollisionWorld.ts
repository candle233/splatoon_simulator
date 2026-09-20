import {
  ARENA_HALF_SIZE,
  ARENA_OBSTACLES,
  BoxObstacle,
  ClimbableSurface,
  PLAYER_RADIUS,
  Ray,
  RampObstacle,
  Vec3,
  intersectRayAABB,
  intersectRayGroundPlane
} from '@ink/shared';

export class ClientCollisionWorld {
  private obstacles: BoxObstacle[];
  private halfSize = ARENA_HALF_SIZE;
  private ramps: RampObstacle[] = [];
  private climbableSurfaces: ClimbableSurface[] = [];

  constructor(obstacles = ARENA_OBSTACLES) {
    this.obstacles = obstacles;
  }

  setObstacles(obstacles: BoxObstacle[], mapSize = this.halfSize * 2): void {
    this.obstacles = obstacles;
    this.halfSize = mapSize / 2;
  }

  setRamps(ramps: RampObstacle[]): void {
    this.ramps = ramps;
  }

  setClimbableSurfaces(surfaces: ClimbableSurface[]): void {
    this.climbableSurfaces = surfaces;
  }

  getObstacles(): BoxObstacle[] {
    return this.obstacles;
  }

  /**
   * Returns the ramp the player is standing on, or null.
   */
  getRampAt(position: Vec3): RampObstacle | null {
    const r = PLAYER_RADIUS;
    for (const ramp of this.ramps) {
      if (!ramp.climbable) continue;
      let minX = ramp.position.x - (ramp.width / 2);
      let maxX = ramp.position.x + (ramp.width / 2);
      let minZ = ramp.position.z - (ramp.width / 2);
      let maxZ = ramp.position.z + (ramp.width / 2);
      switch (ramp.direction) {
        case 'north':
          minZ = ramp.position.z - ramp.length / 2;
          maxZ = ramp.position.z + ramp.length / 2;
          break;
        case 'south':
          minZ = ramp.position.z - ramp.length / 2;
          maxZ = ramp.position.z + ramp.length / 2;
          break;
        case 'east':
          minX = ramp.position.x - ramp.length / 2;
          maxX = ramp.position.x + ramp.length / 2;
          break;
        case 'west':
          minX = ramp.position.x - ramp.length / 2;
          maxX = ramp.position.x + ramp.length / 2;
          break;
      }
      if (
        position.x + r > minX &&
        position.x - r < maxX &&
        position.z + r > minZ &&
        position.z - r < maxZ
      ) {
        return ramp;
      }
    }
    return null;
  }

  /**
   * Returns the climbable surface closest to the player, or null.
   */
  getClimbableSurfaceAt(position: Vec3, withinRange = 2.0): ClimbableSurface | null {
    for (const cs of this.climbableSurfaces) {
      const dx = position.x - cs.position.x;
      const dz = position.z - cs.position.z;
      if (dx * dx + dz * dz < withinRange * withinRange) {
        return cs;
      }
    }
    return null;
  }

  /**
   * Returns the expected Y at the given XZ position on a ramp.
   */
  rampHeightAt(ramp: RampObstacle, x: number, z: number): number {
    let t: number;
    switch (ramp.direction) {
      case 'north':
        t = (ramp.position.z + ramp.length / 2 - z) / ramp.length;
        break;
      case 'south':
        t = (z - (ramp.position.z - ramp.length / 2)) / ramp.length;
        break;
      case 'east':
        t = (x - (ramp.position.x - ramp.length / 2)) / ramp.length;
        break;
      case 'west':
        t = (ramp.position.x + ramp.length / 2 - x) / ramp.length;
        break;
    }
    t = Math.max(0, Math.min(1, t));
    return ramp.rise * t;
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
    const ground = intersectRayGroundPlane(ray, 0.2, this.halfSize);
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
    const groundHit = intersectRayGroundPlane(ray, 0, this.halfSize);
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

    const bound = this.halfSize - radius;
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

    // 2b. Ramp collision: lift the player up to the ramp's expected height
    const ramp = this.getRampAt({ x: currX, y: currY, z: currZ });
    if (ramp) {
      const expectedY = this.rampHeightAt(ramp, currX, currZ);
      if (currY < expectedY - 0.06 && velocity.y <= 0) {
        currY = expectedY;
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
