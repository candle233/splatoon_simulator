import {
  MatchScore,
  PaintEvent,
  Team,
  PAINT_GRID_RES,
  generateSplatters,
  uvToPaintGrid,
  worldToUV
} from '@ink/shared';
import type { ZoneRect } from '@ink/shared';

export class PaintGrid {
  readonly resolution: number;
  readonly totalCells: number;
  readonly grid: Uint8Array;

  private pinkCount = 0;
  private cyanCount = 0;
  private neutralCount: number;
  /** Active map edge length for world<->UV conversion. */
  private mapSize = 100;

  constructor(resolution = PAINT_GRID_RES) {
    this.resolution = resolution;
    this.totalCells = resolution * resolution;
    this.grid = new Uint8Array(this.totalCells);
    this.neutralCount = this.totalCells;
  }

  setMapSize(size: number): void {
    if (size > 0) {
      this.mapSize = size;
    }
  }

  getMapSize(): number {
    return this.mapSize;
  }

  reset(): void {
    this.grid.fill(Team.NEUTRAL);
    this.pinkCount = 0;
    this.cyanCount = 0;
    this.neutralCount = this.totalCells;
  }

  getInkAt(worldX: number, worldZ: number): Team {
    const { u, v } = worldToUV(worldX, worldZ, this.mapSize);
    const { gx, gy } = uvToPaintGrid(u, v, this.resolution);
    const idx = gy * this.resolution + gx;
    return (this.grid[idx] ?? Team.NEUTRAL) as Team;
  }

  getInkAtUV(u: number, v: number): Team {
    const { gx, gy } = uvToPaintGrid(u, v, this.resolution);
    const idx = gy * this.resolution + gx;
    return (this.grid[idx] ?? Team.NEUTRAL) as Team;
  }

  applyPaintEvent(event: PaintEvent): number {
    const team = event.team;
    if (team === Team.NEUTRAL) return 0;

    let totalNewCells = 0;

    // If continuous line segment
    if (event.prevU !== undefined && event.prevV !== undefined) {
      const du = event.u - event.prevU;
      const dv = event.v - event.prevV;
      const dist = Math.sqrt(du * du + dv * dv);
      const stepSize = Math.max(0.001, event.radius * 0.5);
      const steps = Math.max(1, Math.ceil(dist / stepSize));

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const curU = event.prevU + du * t;
        const curV = event.prevV + dv * t;
        totalNewCells += this.fillCircleUV(curU, curV, event.radius, team);
      }
    } else {
      totalNewCells += this.fillCircleUV(event.u, event.v, event.radius, team);
    }

    // Apply deterministic splatters
    const splatters = generateSplatters(event.u, event.v, event.radius, event.seed);
    for (const splat of splatters) {
      totalNewCells += this.fillCircleUV(splat.u, splat.v, splat.radius, team);
    }

    return totalNewCells;
  }

  private fillCircleUV(centerU: number, centerV: number, radiusUV: number, newTeam: Team): number {
    const { gx: cx, gy: cy } = uvToPaintGrid(centerU, centerV, this.resolution);
    const rCells = Math.max(1, Math.round(radiusUV * this.resolution));
    const rSq = rCells * rCells;

    const minX = Math.max(0, cx - rCells);
    const maxX = Math.min(this.resolution - 1, cx + rCells);
    const minY = Math.max(0, cy - rCells);
    const maxY = Math.min(this.resolution - 1, cy + rCells);

    let newlyPainted = 0;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const dySq = dy * dy;
      const rowOffset = y * this.resolution;

      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dySq <= rSq) {
          const idx = rowOffset + x;
          const oldTeam = this.grid[idx];

          if (oldTeam !== newTeam) {
            // Update counts in O(1)
            if (oldTeam === Team.PINK) this.pinkCount--;
            else if (oldTeam === Team.CYAN) this.cyanCount--;
            else this.neutralCount--;

            if (newTeam === Team.PINK) this.pinkCount++;
            else if (newTeam === Team.CYAN) this.cyanCount++;

            this.grid[idx] = newTeam;
            newlyPainted++;
          }
        }
      }
    }

    return newlyPainted;
  }

  getScore(): MatchScore {
    const pinkPct = Number(((this.pinkCount / this.totalCells) * 100).toFixed(1));
    const cyanPct = Number(((this.cyanCount / this.totalCells) * 100).toFixed(1));

    return {
      pinkCount: this.pinkCount,
      cyanCount: this.cyanCount,
      neutralCount: this.neutralCount,
      pinkPercentage: pinkPct,
      cyanPercentage: cyanPct
    };
  }

  /**
   * Counts team-owned cells inside a world-space rectangle (Splat Zones).
   * Neutral / unpainted cells are excluded from `total`.
   */
  getZoneControl(rect: ZoneRect): { pink: number; cyan: number; total: number } {
    const half = this.mapSize / 2;
    const uMin = Math.max(0, (rect.x - rect.w / 2 + half) / this.mapSize);
    const uMax = Math.min(1, (rect.x + rect.w / 2 + half) / this.mapSize);
    const vMin = Math.max(0, (rect.z - rect.d / 2 + half) / this.mapSize);
    const vMax = Math.min(1, (rect.z + rect.d / 2 + half) / this.mapSize);

    const gxMin = Math.floor(uMin * this.resolution);
    const gxMax = Math.ceil(uMax * this.resolution) - 1;
    const gyMin = Math.floor(vMin * this.resolution);
    const gyMax = Math.ceil(vMax * this.resolution) - 1;

    let pink = 0;
    let cyan = 0;
    for (let gy = gyMin; gy <= gyMax; gy++) {
      const rowOffset = gy * this.resolution;
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const cell = this.grid[rowOffset + gx];
        if (cell === Team.PINK) pink++;
        else if (cell === Team.CYAN) cyan++;
      }
    }
    return { pink, cyan, total: pink + cyan };
  }
}
