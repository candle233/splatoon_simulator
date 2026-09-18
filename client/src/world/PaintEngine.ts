import * as THREE from 'three';
import {
  CANVAS_RES,
  CYAN_COLOR_CSS,
  NEUTRAL_COLOR_CSS,
  PAINT_GRID_RES,
  PINK_COLOR_CSS,
  PaintEvent,
  Team,
  generateSplatters,
  uvToCanvas,
  uvToPaintGrid,
  worldToUV
} from '@ink/shared';

export class PaintEngine {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  private paintGrid: Uint8Array;
  private gridResolution: number;
  private canvasWidth: number;
  private canvasHeight: number;

  private paintTextureDirty = false;

  constructor(canvasRes = 1024, gridRes = PAINT_GRID_RES) {
    this.canvasWidth = canvasRes;
    this.canvasHeight = canvasRes;
    this.gridResolution = gridRes;
    this.paintGrid = new Uint8Array(this.gridResolution * this.gridResolution);

    // Canvas creation
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;

    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to create 2D canvas context for PaintEngine');
    }
    this.ctx = ctx;

    // Fill initial neutral canvas
    this.clearCanvas();

    // Three.js Texture setup
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  private clearCanvas(): void {
    this.ctx.fillStyle = '#44444c';
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Subtle grid lines for high-tech arena look
    this.ctx.strokeStyle = '#383840';
    this.ctx.lineWidth = 2;
    const step = this.canvasWidth / 10;
    for (let i = 0; i <= this.canvasWidth; i += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(i, 0);
      this.ctx.lineTo(i, this.canvasHeight);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(0, i);
      this.ctx.lineTo(this.canvasWidth, i);
      this.ctx.stroke();
    }
  }

  reset(): void {
    this.paintGrid.fill(Team.NEUTRAL);
    this.clearCanvas();
    this.paintTextureDirty = true;
  }

  getInkAt(worldX: number, worldZ: number): Team {
    const { u, v } = worldToUV(worldX, worldZ);
    const { gx, gy } = uvToPaintGrid(u, v, this.gridResolution);
    const idx = gy * this.gridResolution + gx;
    return (this.paintGrid[idx] ?? Team.NEUTRAL) as Team;
  }

  applyPaintBatch(events: PaintEvent[]): void {
    if (events.length === 0) return;

    for (const pe of events) {
      this.drawPaintToCanvas(pe);
      this.updateLocalGrid(pe);
    }

    // Only mark dirty once per batch
    this.paintTextureDirty = true;
  }

  applyPaintEvent(event: PaintEvent): void {
    this.drawPaintToCanvas(event);
    this.updateLocalGrid(event);
    this.paintTextureDirty = true;
  }

  private drawPaintToCanvas(event: PaintEvent): void {
    const team = event.team;
    if (team === Team.NEUTRAL) return;

    const baseColor = team === Team.PINK ? PINK_COLOR_CSS : CYAN_COLOR_CSS;
    const center = uvToCanvas(event.u, event.v, this.canvasWidth, this.canvasHeight);
    const radiusPx = event.radius * this.canvasWidth;

    // Draw main circle with radial gradient
    this.drawRadialCircle(center.px, center.py, radiusPx, baseColor);

    // Draw deterministic splatters
    const splatters = generateSplatters(event.u, event.v, event.radius, event.seed);
    for (const splat of splatters) {
      const sCenter = uvToCanvas(splat.u, splat.v, this.canvasWidth, this.canvasHeight);
      const sRadiusPx = splat.radius * this.canvasWidth;
      this.drawRadialCircle(sCenter.px, sCenter.py, sRadiusPx, baseColor);
    }
  }

  private drawRadialCircle(cx: number, cy: number, r: number, color: string): void {
    const grad = this.ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.85, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    this.ctx.save();
    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private updateLocalGrid(event: PaintEvent): void {
    const { gx: cx, gy: cy } = uvToPaintGrid(event.u, event.v, this.gridResolution);
    const rCells = Math.max(1, Math.round(event.radius * this.gridResolution));
    const rSq = rCells * rCells;

    const minX = Math.max(0, cx - rCells);
    const maxX = Math.min(this.gridResolution - 1, cx + rCells);
    const minY = Math.max(0, cy - rCells);
    const maxY = Math.min(this.gridResolution - 1, cy + rCells);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const dySq = dy * dy;
      const rowOffset = y * this.gridResolution;

      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dySq <= rSq) {
          this.paintGrid[rowOffset + x] = event.team;
        }
      }
    }

    // Also update splatters in grid
    const splatters = generateSplatters(event.u, event.v, event.radius, event.seed);
    for (const splat of splatters) {
      const { gx: scx, gy: scy } = uvToPaintGrid(splat.u, splat.v, this.gridResolution);
      const srCells = Math.max(1, Math.round(splat.radius * this.gridResolution));
      const srSq = srCells * srCells;

      const sMinX = Math.max(0, scx - srCells);
      const sMaxX = Math.min(this.gridResolution - 1, scx + srCells);
      const sMinY = Math.max(0, scy - srCells);
      const sMaxY = Math.min(this.gridResolution - 1, scy + srCells);

      for (let sy = sMinY; sy <= sMaxY; sy++) {
        const sdy = sy - scy;
        const sdySq = sdy * sdy;
        const sRowOffset = sy * this.gridResolution;

        for (let sx = sMinX; sx <= sMaxX; sx++) {
          const sdx = sx - scx;
          if (sdx * sdx + sdySq <= srSq) {
            this.paintGrid[sRowOffset + sx] = event.team;
          }
        }
      }
    }
  }

  /**
   * Called ONCE per render frame to upload texture if dirty
   */
  renderUpdate(): void {
    if (this.paintTextureDirty) {
      this.texture.needsUpdate = true;
      this.paintTextureDirty = false;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
