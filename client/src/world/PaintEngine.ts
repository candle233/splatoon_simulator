import * as THREE from 'three';
import {
  ARENA_SIZE,
  CANVAS_RES,
  CYAN_COLOR_CSS,
  NEUTRAL_COLOR_CSS,
  PAINT_GRID_RES,
  PINK_COLOR_CSS,
  PaintEvent,
  PaintSurface,
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

  /**
   * Active map edge length for world<->UV conversion. Mirrors the server's
   * `PaintGrid.setMapSize`; without it every lookup on a non-100-unit map
   * samples the wrong part of the ink texture.
   */
  private mapSize = ARENA_SIZE;

  private paintTextureDirty = false;

  /** Per-surface ink coverage: [pinkAlpha, cyanAlpha] in [0, 1]. */
  private surfacePaints = new Map<string, [number, number]>();
  /** Canvas texture for vertical surface ink rendering. */
  readonly surfaceCanvas: HTMLCanvasElement;
  readonly surfaceCtx: CanvasRenderingContext2D;
  readonly surfaceTexture: THREE.CanvasTexture;

  constructor(canvasRes = CANVAS_RES, gridRes = PAINT_GRID_RES) {
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
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;

    // Secondary canvas for vertical surface ink overlays.
    this.surfaceCanvas = document.createElement('canvas');
    this.surfaceCanvas.width = 512;
    this.surfaceCanvas.height = 512;
    const surfaceCtx = this.surfaceCanvas.getContext('2d', { alpha: true });
    if (!surfaceCtx) {
      throw new Error('Failed to create surface canvas context');
    }
    this.surfaceCtx = surfaceCtx;
    this.surfaceTexture = new THREE.CanvasTexture(this.surfaceCanvas);
    this.surfaceTexture.generateMipmaps = false;
    this.surfaceTexture.minFilter = THREE.LinearFilter;
    this.surfaceTexture.magFilter = THREE.LinearFilter;
    this.surfaceTexture.colorSpace = THREE.SRGBColorSpace;
    this.surfaceTexture.needsUpdate = true;
  }

  private dirtyMinX = 0;
  private dirtyMinY = 0;
  private dirtyMaxX = 0;
  private dirtyMaxY = 0;
  private fullTextureDirty = true;
  private hasDirtyRect = false;
  private surfaceTextureDirty = false;

  private expandDirty(cx: number, cy: number, r: number): void {
    const pad = Math.ceil(r) + 2;
    const minX = Math.max(0, Math.floor(cx - pad));
    const maxX = Math.min(this.canvasWidth, Math.ceil(cx + pad));
    const minY = Math.max(0, Math.floor(cy - pad));
    const maxY = Math.min(this.canvasHeight, Math.ceil(cy + pad));

    if (!this.hasDirtyRect) {
      this.dirtyMinX = minX;
      this.dirtyMaxX = maxX;
      this.dirtyMinY = minY;
      this.dirtyMaxY = maxY;
      this.hasDirtyRect = true;
    } else {
      if (minX < this.dirtyMinX) this.dirtyMinX = minX;
      if (maxX > this.dirtyMaxX) this.dirtyMaxX = maxX;
      if (minY < this.dirtyMinY) this.dirtyMinY = minY;
      if (maxY > this.dirtyMaxY) this.dirtyMaxY = maxY;
    }
  }

  private clearCanvas(): void {
    this.fullTextureDirty = true;
    this.hasDirtyRect = true;
    this.dirtyMinX = 0;
    this.dirtyMinY = 0;
    this.dirtyMaxX = this.canvasWidth;
    this.dirtyMaxY = this.canvasHeight;
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
    this.surfacePaints.clear();
    this.surfaceCtx.clearRect(0, 0, this.surfaceCanvas.width, this.surfaceCanvas.height);
    this.surfaceTexture.needsUpdate = true;
  }

  /**
   * Sets the active map edge length so world<->UV lookups match the server.
   * Call this whenever the arena is (re)built for a map.
   */
  setMapSize(size: number): void {
    if (size > 0 && Number.isFinite(size)) {
      this.mapSize = size;
    }
  }

  getMapSize(): number {
    return this.mapSize;
  }

  getInkAt(worldX: number, worldZ: number): Team {
    const { u, v } = worldToUV(worldX, worldZ, this.mapSize);
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

    if (event.prevU !== undefined && event.prevV !== undefined) {
      const prevCenter = uvToCanvas(event.prevU, event.prevV, this.canvasWidth, this.canvasHeight);
      this.drawContinuousStroke(prevCenter.px, prevCenter.py, center.px, center.py, radiusPx, baseColor, team);
      this.drawRadialCircle(center.px, center.py, radiusPx, baseColor, team);
      this.expandDirty(prevCenter.px, prevCenter.py, radiusPx);
      this.expandDirty(center.px, center.py, radiusPx);
    } else {
      this.drawRadialCircle(center.px, center.py, radiusPx, baseColor, team);
      this.expandDirty(center.px, center.py, radiusPx);
    }

    // Draw deterministic splatters
    const splatters = generateSplatters(event.u, event.v, event.radius, event.seed);
    for (const splat of splatters) {
      const sCenter = uvToCanvas(splat.u, splat.v, this.canvasWidth, this.canvasHeight);
      const sRadiusPx = splat.radius * this.canvasWidth;
      this.drawRadialCircle(sCenter.px, sCenter.py, sRadiusPx, baseColor, team);
      this.expandDirty(sCenter.px, sCenter.py, sRadiusPx);
    }
  }

  private drawContinuousStroke(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    radiusPx: number,
    color: string,
    team: Team
  ): void {
    // 1. Base thick ink stroke
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = radiusPx * 2.0;
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();

    // 2. Liquid glossy central spine
    if (radiusPx > 10) {
      const glossColor = team === Team.PINK ? '#ff5cb2' : '#80ffff';
      this.ctx.lineWidth = radiusPx * 0.75;
      this.ctx.strokeStyle = glossColor;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    }
  }

  private drawRadialCircle(cx: number, cy: number, r: number, color: string, team: Team): void {
    const glossColor = team === Team.PINK ? '#ff73be' : '#99ffff';
    const grad = this.ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.15, r * 0.08, cx, cy, r);
    grad.addColorStop(0, glossColor);
    grad.addColorStop(0.45, color);
    grad.addColorStop(0.88, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    this.ctx.fillStyle = grad;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private updateLocalGrid(event: PaintEvent): void {
    const team = event.team;
    if (team === Team.NEUTRAL) return;

    if (event.prevU !== undefined && event.prevV !== undefined) {
      const du = event.u - event.prevU;
      const dv = event.v - event.prevV;
      const dist = Math.sqrt(du * du + dv * dv);
      const stepSize = Math.max(0.002, event.radius * 0.5);
      const steps = Math.max(1, Math.ceil(dist / stepSize));

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        this.fillGridCircle(event.prevU + du * t, event.prevV + dv * t, event.radius, team);
      }
    } else {
      this.fillGridCircle(event.u, event.v, event.radius, team);
    }

    // Splatters in grid
    const splatters = generateSplatters(event.u, event.v, event.radius, event.seed);
    for (const splat of splatters) {
      this.fillGridCircle(splat.u, splat.v, splat.radius, team);
    }
  }

  private fillGridCircle(u: number, v: number, radius: number, team: Team): void {
    const { gx: cx, gy: cy } = uvToPaintGrid(u, v, this.gridResolution);
    const rCells = Math.max(1, Math.round(radius * this.gridResolution));
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
          this.paintGrid[rowOffset + x] = team;
        }
      }
    }
  }

  public textureUploads = 0;
  /** Texture uploads skipped by the min-interval throttle (diagnostics only). */
  public textureUploadsThrottled = 0;

  /**
   * Minimum gap between paint-texture uploads. Each dirty upload re-uploads the
   * full 2048² level and regenerates its mip chain, so a burst of paint events
   * can otherwise pay that cost on consecutive frames. 33 ms still shows ink
   * within two frames at 60 Hz — imperceptible — while capping the cost at
   * ~30 uploads/sec instead of 60+.
   */
  private minUploadIntervalMs = 33;
  private lastUploadAt = 0;

  /**
   * Marks paint texture dirty for next frame GPU upload (Subagent 16)
   */
  markDirty(): void {
    this.paintTextureDirty = true;
    this.fullTextureDirty = true;
    this.hasDirtyRect = true;
    this.dirtyMinX = 0;
    this.dirtyMinY = 0;
    this.dirtyMaxX = this.canvasWidth;
    this.dirtyMaxY = this.canvasHeight;
  }

  /**
   * Flushes texture update to GPU at most once per render frame (Subagent 16),
   * and at most once per `minUploadIntervalMs`.
   * When renderer is provided and WebGL2 is available, performs sub-region
   * texSubImage2D upload of only the dirty rectangle instead of the full 2048x2048 canvas.
   */
  flushTextureUpdate(renderer?: THREE.WebGLRenderer): boolean {
    if (!this.paintTextureDirty) return false;

    const now = performance.now();
    if (now - this.lastUploadAt < this.minUploadIntervalMs) {
      this.textureUploadsThrottled++;
      return false;
    }

    if (renderer && !this.fullTextureDirty && this.hasDirtyRect) {
      const x = Math.max(0, Math.floor(this.dirtyMinX));
      const y = Math.max(0, Math.floor(this.dirtyMinY));
      const w = Math.min(this.canvasWidth - x, Math.ceil(this.dirtyMaxX - x));
      const h = Math.min(this.canvasHeight - y, Math.ceil(this.dirtyMaxY - y));

      // Sub-image upload is optimal when dirty area is smaller than 65% of the full canvas
      if (w > 0 && h > 0 && (w * h) < this.canvasWidth * this.canvasHeight * 0.65) {
        try {
          const gl = renderer.getContext() as WebGL2RenderingContext | WebGLRenderingContext | null;
          const props = (renderer as unknown as { properties?: { get: (obj: unknown) => { __webglTexture?: WebGLTexture } } }).properties?.get(this.texture);
          const webglTexture = props?.__webglTexture;

          if (
            gl &&
            webglTexture &&
            typeof (gl as WebGL2RenderingContext).texSubImage2D === 'function' &&
            'UNPACK_ROW_LENGTH' in gl
          ) {
            const gl2 = gl as WebGL2RenderingContext;
            // WebGL texture coordinate (0,0) is bottom-left; canvas (0,0) is top-left.
            // With UNPACK_FLIP_Y_WEBGL = true, textureY = canvasHeight - y - h.
            const textureY = this.canvasHeight - y - h;

            gl2.bindTexture(gl2.TEXTURE_2D, webglTexture);
            gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, true);
            gl2.pixelStorei(gl2.UNPACK_ROW_LENGTH, this.canvasWidth);
            gl2.pixelStorei(gl2.UNPACK_SKIP_PIXELS, x);
            gl2.pixelStorei(gl2.UNPACK_SKIP_ROWS, y);
            gl2.texSubImage2D(
              gl2.TEXTURE_2D,
              0,
              x,
              textureY,
              w,
              h,
              gl2.RGBA,
              gl2.UNSIGNED_BYTE,
              this.canvas
            );
            gl2.pixelStorei(gl2.UNPACK_ROW_LENGTH, 0);
            gl2.pixelStorei(gl2.UNPACK_SKIP_PIXELS, 0);
            gl2.pixelStorei(gl2.UNPACK_SKIP_ROWS, 0);
            gl2.bindTexture(gl2.TEXTURE_2D, null);

            this.paintTextureDirty = false;
            this.hasDirtyRect = false;
            this.lastUploadAt = now;
            this.textureUploads++;
            return true;
          }
        } catch {
          // Fallback to full needsUpdate if WebGL2 sub-image fails
        }
      }
    }

    this.texture.needsUpdate = true;
    this.paintTextureDirty = false;
    this.fullTextureDirty = false;
    this.hasDirtyRect = false;
    this.lastUploadAt = now;
    this.textureUploads++;
    return true;
  }

  /**
   * Called ONCE per render frame to upload texture if dirty
   */
  renderUpdate(renderer?: THREE.WebGLRenderer): void {
    this.flushTextureUpdate(renderer);
    if (this.surfaceTextureDirty) {
      this.flushSurfaceTexture();
      this.surfaceTextureDirty = false;
    }
  }

  /** Upload diagnostics for the debug hook / perf automation. */
  getUploadStats(): { uploads: number; throttled: number; dirty: boolean } {
    return {
      uploads: this.textureUploads,
      throttled: this.textureUploadsThrottled,
      dirty: this.paintTextureDirty
    };
  }

  dispose(): void {
    this.texture.dispose();
    this.surfaceTexture.dispose();
  }

  // -------------------------------------------------------------------------
  // Vertical surface paint
  // -------------------------------------------------------------------------

  /** Initialize surface paint state from the map definition. */
  initSurfaces(surfaces: PaintSurface[]): void {
    for (const s of surfaces) {
      if (!this.surfacePaints.has(s.id)) {
        this.surfacePaints.set(s.id, [0, 0]);
      }
    }
  }

  /**
   * Apply a surface paint update from the server.
   * Called from the network client when S2C_SURFACE_PAINT events arrive.
   * Defers GPU texture upload to renderUpdate so network ticks never hitch the main thread.
   */
  applySurfacePaintUpdate(updates: Array<{ id: string; paint: [number, number] }>): void {
    if (!updates.length) return;
    let changed = false;
    for (const u of updates) {
      let p = this.surfacePaints.get(u.id);
      if (!p) {
        p = [0, 0];
        this.surfacePaints.set(u.id, p);
      }
      const newPink = u.paint[0] ?? 0;
      const newCyan = u.paint[1] ?? 0;
      if (Math.abs(p[0] - newPink) > 0.005 || Math.abs(p[1] - newCyan) > 0.005) {
        p[0] = newPink;
        p[1] = newCyan;
        changed = true;
      }
    }
    if (changed) {
      this.surfaceTextureDirty = true;
    }
  }

  /**
   * Returns an array of surface rects (in world units) that should be rendered
   * with the current ink overlay. Each rect is { id, x, y, z, sx, sy, sz }.
   */
  getSurfaceRects(surfaces: PaintSurface[]): Array<{ id: string; x: number; y: number; z: number; sx: number; sy: number; sz: number }> {
    const out: Array<{ id: string; x: number; y: number; z: number; sx: number; sy: number; sz: number }> = [];
    for (const s of surfaces) {
      out.push({ id: s.id, x: s.position.x, y: s.position.y, z: s.position.z, sx: s.size.x, sy: s.size.y, sz: s.size.z });
    }
    return out;
  }

  /**
   * Rebuilds the surface canvas from current paint state.
   * Called whenever any surface's paint fraction changes.
   */
  flushSurfaceTexture(): void {
    const w = this.surfaceCanvas.width;
    const h = this.surfaceCanvas.height;
    this.surfaceCtx.clearRect(0, 0, w, h);
    for (const [id, [pink, cyan]] of this.surfacePaints) {
      if (pink > 0.01 || cyan > 0.01) {
        const grad = this.surfaceCtx.createLinearGradient(0, h, 0, 0);
        if (cyan > 0.01) {
          grad.addColorStop(0, `rgba(0,255,255,${cyan * 0.7})`);
          grad.addColorStop(1, `rgba(0,255,255,${Math.max(0, cyan * 0.7 - 0.15)})`);
        }
        if (pink > 0.01) {
          grad.addColorStop(0, `rgba(255,0,127,${pink * 0.7})`);
          grad.addColorStop(1, `rgba(255,0,127,${Math.max(0, pink * 0.7 - 0.15)})`);
        }
        this.surfaceCtx.fillStyle = grad;
        // Fill bottom portion proportional to paint coverage (0-1)
        const coverage = Math.max(pink, cyan);
        const fillH = Math.ceil(h * coverage);
        this.surfaceCtx.fillRect(0, h - fillH, w, fillH);
      }
    }
    this.surfaceTexture.needsUpdate = true;
  }

  /**
   * Returns the surface canvas texture so Arena can use it for vertical faces.
   */
  getSurfaceTexture(): THREE.CanvasTexture {
    return this.surfaceTexture;
  }

  /**
   * Returns the surface canvas for minimap or other debug draws.
   */
  getSurfaceCanvas(): HTMLCanvasElement {
    return this.surfaceCanvas;
  }
}

/**
 * Subagent 16: PaintTextureController managing dirty flag and GPU upload frequency
 */
export class PaintTextureController {
  private texture: { needsUpdate: boolean; dispose?: () => void };
  private dirty = false;
  public textureUploads = 0;

  constructor(texture: { needsUpdate: boolean; dispose?: () => void }) {
    this.texture = texture;
  }

  markDirty(): void {
    this.dirty = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  flushTextureUpdate(): boolean {
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
      this.textureUploads++;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.texture.dispose?.();
  }
}
