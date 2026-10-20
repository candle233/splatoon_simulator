import {
  BoxObstacle,
  ClimbableSurface,
  RampObstacle,
  Vec3
} from './types.js';
import { Ray } from './math.js';

export interface SpatialCell {
  obstacles: BoxObstacle[];
  ramps: RampObstacle[];
  climbableSurfaces: ClimbableSurface[];
}

const DEFAULT_CELL_SIZE = 10;
const EMPTY_OBSTACLES: BoxObstacle[] = [];
const EMPTY_RAMPS: RampObstacle[] = [];
const EMPTY_CLIMBABLE: ClimbableSurface[] = [];

export class SpatialGrid {
  readonly cellSize: number;
  private cells = new Map<number, SpatialCell>();
  private allObstacles: BoxObstacle[] = [];
  private allRamps: RampObstacle[] = [];
  private allClimbable: ClimbableSurface[] = [];

  // Scratch arrays and set to eliminate GC allocations during queries
  private scratchObstacles: BoxObstacle[] = [];
  private scratchRamps: RampObstacle[] = [];
  private scratchClimbable: ClimbableSurface[] = [];
  private scratchSet = new Set<unknown>();
  private scratchRayResult = {
    obstacles: [] as BoxObstacle[],
    ramps: [] as RampObstacle[]
  };

  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  /** Pack 2D grid coordinates into a 32-bit integer for zero-allocation Map lookup */
  private cellKey(cx: number, cz: number): number {
    return (((cx + 32768) & 0xffff) << 16) | ((cz + 32768) & 0xffff);
  }

  private getOrCreateCell(cx: number, cz: number): SpatialCell {
    const key = this.cellKey(cx, cz);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { obstacles: [], ramps: [], climbableSurfaces: [] };
      this.cells.set(key, cell);
    }
    return cell;
  }

  private getCell(cx: number, cz: number): SpatialCell | undefined {
    return this.cells.get(this.cellKey(cx, cz));
  }

  clear(): void {
    this.cells.clear();
    this.allObstacles = [];
    this.allRamps = [];
    this.allClimbable = [];
    this.scratchObstacles.length = 0;
    this.scratchRamps.length = 0;
    this.scratchClimbable.length = 0;
    this.scratchSet.clear();
  }

  build(
    obstacles: BoxObstacle[],
    ramps: RampObstacle[] = [],
    climbableSurfaces: ClimbableSurface[] = []
  ): void {
    this.clear();
    this.allObstacles = obstacles;
    this.allRamps = ramps;
    this.allClimbable = climbableSurfaces;

    // Index box obstacles
    for (const obs of obstacles) {
      const minX = obs.position.x - obs.size.x * 0.5;
      const maxX = obs.position.x + obs.size.x * 0.5;
      const minZ = obs.position.z - obs.size.z * 0.5;
      const maxZ = obs.position.z + obs.size.z * 0.5;

      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCz = Math.floor(minZ / this.cellSize);
      const maxCz = Math.floor(maxZ / this.cellSize);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          this.getOrCreateCell(cx, cz).obstacles.push(obs);
        }
      }
    }

    // Index ramps
    for (const ramp of ramps) {
      let minX = ramp.position.x - ramp.width / 2;
      let maxX = ramp.position.x + ramp.width / 2;
      let minZ = ramp.position.z - ramp.width / 2;
      let maxZ = ramp.position.z + ramp.width / 2;
      switch (ramp.direction) {
        case 'north':
        case 'south':
          minZ = ramp.position.z - ramp.length / 2;
          maxZ = ramp.position.z + ramp.length / 2;
          break;
        case 'east':
        case 'west':
          minX = ramp.position.x - ramp.length / 2;
          maxX = ramp.position.x + ramp.length / 2;
          break;
      }

      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCz = Math.floor(minZ / this.cellSize);
      const maxCz = Math.floor(maxZ / this.cellSize);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          this.getOrCreateCell(cx, cz).ramps.push(ramp);
        }
      }
    }

    // Index climbable surfaces
    for (const cs of climbableSurfaces) {
      const minX = cs.position.x - cs.size.x * 0.5;
      const maxX = cs.position.x + cs.size.x * 0.5;
      const minZ = cs.position.z - cs.size.z * 0.5;
      const maxZ = cs.position.z + cs.size.z * 0.5;

      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCz = Math.floor(minZ / this.cellSize);
      const maxCz = Math.floor(maxZ / this.cellSize);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          this.getOrCreateCell(cx, cz).climbableSurfaces.push(cs);
        }
      }
    }
  }

  /**
   * Fast O(1) ground height query at point (x, z).
   * Checks only the obstacles and ramps registered in the point's spatial cell.
   */
  getGroundHeightAt(
    x: number,
    z: number,
    currentY = Number.POSITIVE_INFINITY,
    rampHeightAt?: (ramp: RampObstacle, x: number, z: number) => number
  ): number {
    let highest = 0;
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const cell = this.getCell(cx, cz);
    if (!cell) return 0;

    for (let i = 0; i < cell.obstacles.length; i++) {
      const obs = cell.obstacles[i]!;
      const minX = obs.position.x - obs.size.x * 0.5;
      const maxX = obs.position.x + obs.size.x * 0.5;
      const minZ = obs.position.z - obs.size.z * 0.5;
      const maxZ = obs.position.z + obs.size.z * 0.5;
      const topY = obs.position.y + obs.size.y * 0.5;

      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
        if (topY <= currentY + 0.1 && topY > highest) {
          highest = topY;
        }
      }
    }

    if (rampHeightAt) {
      for (let i = 0; i < cell.ramps.length; i++) {
        const ramp = cell.ramps[i]!;
        if (!ramp.climbable) continue;
        let minX = ramp.position.x - ramp.width / 2;
        let maxX = ramp.position.x + ramp.width / 2;
        let minZ = ramp.position.z - ramp.width / 2;
        let maxZ = ramp.position.z + ramp.width / 2;
        switch (ramp.direction) {
          case 'north':
          case 'south':
            minZ = ramp.position.z - ramp.length / 2;
            maxZ = ramp.position.z + ramp.length / 2;
            break;
          case 'east':
          case 'west':
            minX = ramp.position.x - ramp.length / 2;
            maxX = ramp.position.x + ramp.length / 2;
            break;
        }
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
          const rampY = rampHeightAt(ramp, x, z);
          if (rampY <= currentY + 0.1 && rampY > highest) {
            highest = rampY;
          }
        }
      }
    }

    return highest;
  }

  /**
   * Returns candidate obstacles overlapping the 2D AABB [minX..maxX, minZ..maxZ].
   * Optimized with reusable scratch array and integer keys to eliminate allocations.
   */
  getObstaclesInAABB(minX: number, maxX: number, minZ: number, maxZ: number): BoxObstacle[] {
    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);

    // Common fast path: query fits entirely inside one cell
    if (minCx === maxCx && minCz === maxCz) {
      const cell = this.getCell(minCx, minCz);
      return cell ? cell.obstacles : EMPTY_OBSTACLES;
    }

    this.scratchObstacles.length = 0;
    this.scratchSet.clear();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.getCell(cx, cz);
        if (cell) {
          for (let i = 0; i < cell.obstacles.length; i++) {
            const obs = cell.obstacles[i]!;
            if (!this.scratchSet.has(obs)) {
              this.scratchSet.add(obs);
              this.scratchObstacles.push(obs);
            }
          }
        }
      }
    }
    return this.scratchObstacles;
  }

  /**
   * Returns candidate ramps overlapping the 2D AABB [minX..maxX, minZ..maxZ].
   */
  getRampsInAABB(minX: number, maxX: number, minZ: number, maxZ: number): RampObstacle[] {
    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);

    if (minCx === maxCx && minCz === maxCz) {
      const cell = this.getCell(minCx, minCz);
      return cell ? cell.ramps : EMPTY_RAMPS;
    }

    this.scratchRamps.length = 0;
    this.scratchSet.clear();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.getCell(cx, cz);
        if (cell) {
          for (let i = 0; i < cell.ramps.length; i++) {
            const ramp = cell.ramps[i]!;
            if (!this.scratchSet.has(ramp)) {
              this.scratchSet.add(ramp);
              this.scratchRamps.push(ramp);
            }
          }
        }
      }
    }
    return this.scratchRamps;
  }

  /**
   * Returns candidate climbable surfaces overlapping the 2D AABB [minX..maxX, minZ..maxZ].
   */
  getClimbableSurfacesInAABB(minX: number, maxX: number, minZ: number, maxZ: number): ClimbableSurface[] {
    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);

    if (minCx === maxCx && minCz === maxCz) {
      const cell = this.getCell(minCx, minCz);
      return cell ? cell.climbableSurfaces : EMPTY_CLIMBABLE;
    }

    this.scratchClimbable.length = 0;
    this.scratchSet.clear();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.getCell(cx, cz);
        if (cell) {
          for (let i = 0; i < cell.climbableSurfaces.length; i++) {
            const cs = cell.climbableSurfaces[i]!;
            if (!this.scratchSet.has(cs)) {
              this.scratchSet.add(cs);
              this.scratchClimbable.push(cs);
            }
          }
        }
      }
    }
    return this.scratchClimbable;
  }

  /**
   * Retrieves candidate obstacles and ramps intersecting the ray's horizontal AABB segment.
   * Zero-allocation query reusing pre-allocated result buffers.
   */
  queryRayCandidates(ray: Ray, maxDistance: number): {
    obstacles: BoxObstacle[];
    ramps: RampObstacle[];
  } {
    const dist = Math.min(maxDistance, 200);
    const endX = ray.origin.x + ray.direction.x * dist;
    const endZ = ray.origin.z + ray.direction.z * dist;
    const minX = Math.min(ray.origin.x, endX);
    const maxX = Math.max(ray.origin.x, endX);
    const minZ = Math.min(ray.origin.z, endZ);
    const maxZ = Math.max(ray.origin.z, endZ);

    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);

    if (minCx === maxCx && minCz === maxCz) {
      const cell = this.getCell(minCx, minCz);
      this.scratchRayResult.obstacles = cell ? cell.obstacles : EMPTY_OBSTACLES;
      this.scratchRayResult.ramps = cell ? cell.ramps : EMPTY_RAMPS;
      return this.scratchRayResult;
    }

    this.scratchObstacles.length = 0;
    this.scratchRamps.length = 0;
    this.scratchSet.clear();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.getCell(cx, cz);
        if (cell) {
          for (let i = 0; i < cell.obstacles.length; i++) {
            const obs = cell.obstacles[i]!;
            if (!this.scratchSet.has(obs)) {
              this.scratchSet.add(obs);
              this.scratchObstacles.push(obs);
            }
          }
          for (let i = 0; i < cell.ramps.length; i++) {
            const ramp = cell.ramps[i]!;
            if (!this.scratchSet.has(ramp)) {
              this.scratchSet.add(ramp);
              this.scratchRamps.push(ramp);
            }
          }
        }
      }
    }

    this.scratchRayResult.obstacles = this.scratchObstacles;
    this.scratchRayResult.ramps = this.scratchRamps;
    return this.scratchRayResult;
  }
}
