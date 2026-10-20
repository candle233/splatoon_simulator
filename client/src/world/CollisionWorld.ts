import {
  ARENA_HALF_SIZE,
  ARENA_OBSTACLES,
  BoxObstacle,
  ClimbableSurface,
  PLAYER_RADIUS,
  Ray,
  RampObstacle,
  Vec3,
  getMapDef,
  intersectRayAABB,
  intersectRayGroundPlane,
  intersectRayRamp,
  SpatialGrid
} from '@ink/shared';

export class ClientCollisionWorld {
  private obstacles: BoxObstacle[];
  private halfSize = ARENA_HALF_SIZE;
  private ramps: RampObstacle[] = [];
  private climbableSurfaces: ClimbableSurface[] = [];
  private spatialGrid = new SpatialGrid(10);
  private scratchPos: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchResult = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: false
  };

  constructor(
    obstacles: BoxObstacle[] = ARENA_OBSTACLES,
    ramps?: RampObstacle[],
    climbableSurfaces?: ClimbableSurface[]
  ) {
    this.obstacles = obstacles;
    if (ramps !== undefined) {
      this.ramps = ramps;
    } else if (obstacles === ARENA_OBSTACLES) {
      this.ramps = getMapDef().ramps;
    } else {
      this.ramps = [];
    }

    if (climbableSurfaces !== undefined) {
      this.climbableSurfaces = climbableSurfaces;
    } else if (obstacles === ARENA_OBSTACLES) {
      this.climbableSurfaces = getMapDef().climbableSurfaces;
    } else {
      this.climbableSurfaces = [];
    }

    this.spatialGrid.build(this.obstacles, this.ramps, this.climbableSurfaces);
  }

  setObstacles(obstacles: BoxObstacle[], mapSize = this.halfSize * 2): void {
    this.obstacles = obstacles;
    this.halfSize = mapSize / 2;
    this.spatialGrid.build(this.obstacles, this.ramps, this.climbableSurfaces);
  }

  setRamps(ramps: RampObstacle[]): void {
    this.ramps = ramps;
    this.spatialGrid.build(this.obstacles, this.ramps, this.climbableSurfaces);
  }

  setClimbableSurfaces(surfaces: ClimbableSurface[]): void {
    this.climbableSurfaces = surfaces;
    this.spatialGrid.build(this.obstacles, this.ramps, this.climbableSurfaces);
  }

  getObstacles(): BoxObstacle[] {
    return this.obstacles;
  }

  getRamps(): RampObstacle[] {
    return this.ramps;
  }

  getClimbableSurfaces(): ClimbableSurface[] {
    return this.climbableSurfaces;
  }

  /**
   * Returns the highest ground level under (x, z), optionally bounded by currentY.
   * Checks obstacle platform tops, ramp surfaces, and ground plane y=0.
   */
  getGroundHeightAt(x: number, z: number, currentY = Number.POSITIVE_INFINITY): number {
    return this.spatialGrid.getGroundHeightAt(
      x,
      z,
      currentY,
      (ramp, rx, rz) => this.rampHeightAt(ramp, rx, rz)
    );
  }

  /**
   * Returns the ramp the player is standing on, or null.
   */
  getRampAt(position: Vec3): RampObstacle | null {
    const r = PLAYER_RADIUS;
    const ramps = this.spatialGrid.getRampsInAABB(
      position.x - r,
      position.x + r,
      position.z - r,
      position.z + r
    );
    for (const ramp of ramps) {
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
        const baseY = ramp.position.y - ramp.rise / 2;
        const expectedY = this.rampHeightAt(ramp, position.x, position.z);
        if (position.y >= baseY - 0.6 && position.y <= expectedY + 2.4) {
          return ramp;
        }
      }
    }
    return null;
  }

  /**
   * Returns the climbable surface closest to the player, or null.
   */
  getClimbableSurfaceAt(position: Vec3, withinRange = 2.0): ClimbableSurface | null {
    let closestDistSq = withinRange * withinRange;
    let closestSurface: ClimbableSurface | null = null;

    const surfaces = this.spatialGrid.getClimbableSurfacesInAABB(
      position.x - withinRange,
      position.x + withinRange,
      position.z - withinRange,
      position.z + withinRange
    );

    for (const cs of surfaces) {
      const hx = cs.size.x * 0.5;
      const hy = cs.size.y * 0.5;
      const hz = cs.size.z * 0.5;

      const minY = cs.position.y - hy - 0.5;
      const maxY = cs.position.y + hy + 0.8;
      if (position.y < minY || position.y > maxY) {
        continue;
      }

      const qx = Math.max(cs.position.x - hx, Math.min(cs.position.x + hx, position.x));
      const qz = Math.max(cs.position.z - hz, Math.min(cs.position.z + hz, position.z));

      const dx = position.x - qx;
      const dz = position.z - qz;
      const distSq = dx * dx + dz * dz;

      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closestSurface = cs;
      }
    }
    return closestSurface;
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
    const baseY = ramp.position.y - ramp.rise / 2;
    return baseY + ramp.rise * t;
  }

  /**
   * Raycast for camera collision so camera doesn't clip through walls.
   * Returns distance to nearest obstacle or null.
   */
  castCameraRay(ray: Ray, maxDistance: number): number | null {
    let closest = maxDistance;
    let hitAny = false;

    // Check vs obstacles
    const { obstacles, ramps } = this.spatialGrid.queryRayCandidates(ray, maxDistance);

    for (const obs of obstacles) {
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

    for (const ramp of ramps) {
      if (!ramp.climbable) continue;
      const hit = intersectRayRamp(ray, ramp);
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
   * Raycast against ground, obstacles, and ramps for client-side aim prediction.
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

    const { obstacles, ramps } = this.spatialGrid.queryRayCandidates(ray, maxDistance);

    // 2. Ray vs Obstacles
    for (const obs of obstacles) {
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

    // 2b. Ray vs Ramps
    for (const ramp of ramps) {
      if (!ramp.climbable) continue;
      const hit = intersectRayRamp(ray, ramp);
      if (hit && hit.t > 0 && hit.t < closestDist) {
        closestDist = hit.t;
        hitResult = {
          hit: true,
          distance: hit.t,
          point: hit.point
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

    const pMinX = currX - radius;
    const pMaxX = currX + radius;
    const pMinY = currY;
    const pMaxY = currY + height;
    const pMinZ = currZ - radius;
    const pMaxZ = currZ + radius;

    const nearbyObstacles = this.spatialGrid.getObstaclesInAABB(pMinX, pMaxX, pMinZ, pMaxZ);
    for (const obs of nearbyObstacles) {
      const minX = obs.position.x - obs.size.x * 0.5;
      const maxX = obs.position.x + obs.size.x * 0.5;
      const minY = obs.position.y - obs.size.y * 0.5;
      const maxY = obs.position.y + obs.size.y * 0.5;
      const minZ = obs.position.z - obs.size.z * 0.5;
      const maxZ = obs.position.z + obs.size.z * 0.5;

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
    this.scratchPos.x = currX;
    this.scratchPos.y = currY;
    this.scratchPos.z = currZ;
    const ramp = this.getRampAt(this.scratchPos);
    if (ramp) {
      const expectedY = this.rampHeightAt(ramp, currX, currZ);
      if (currY < expectedY) {
        currY = expectedY;
        grounded = true;
        if (velocity.y < 0) {
          velocity.y = 0;
        }
      } else if (prevPos.y <= expectedY + 0.6 && currY <= expectedY + 0.5 && velocity.y <= 0) {
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

    this.scratchResult.position.x = currX;
    this.scratchResult.position.y = currY;
    this.scratchResult.position.z = currZ;
    this.scratchResult.velocity.x = velocity.x;
    this.scratchResult.velocity.y = velocity.y;
    this.scratchResult.velocity.z = velocity.z;
    this.scratchResult.grounded = grounded;
    return this.scratchResult;
  }
}
