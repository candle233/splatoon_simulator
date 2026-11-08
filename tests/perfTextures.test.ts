/**
 * Performance regression tests for the texture/material pipeline.
 *
 * Covers the three runtime optimizations:
 * - createWorldMaterial shares one GPU program per shader-feature combo
 *   (no per-instance program explosion on map builds)
 * - per-map floor/sky canvas textures evict the previous map instead of
 *   accumulating ~27 MB of dead VRAM per played map
 * - oversized color textures are capped before upload; the minimap's static
 *   cartography is built once per map instead of redrawn every radar tick
 *
 * Same mock-document preamble as arenaAssetMaterials.test.ts (node env).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMapDef, Team, type BoxObstacle } from '@ink/shared';
import { createWorldMaterial, getFloorTexture, getSkyTexture, getMapTextureCacheStats } from '../client/src/rendering/MapArt.js';
import { capImageSize } from '../client/src/rendering/AssetTextures.js';
import { PaintEngine } from '../client/src/world/PaintEngine.js';
import { Minimap } from '../client/src/ui/Minimap.js';

// Setup headless mock canvas document for Node execution
if (typeof document === 'undefined') {
  const createMockCtx = () => {
    const base: any = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      getLineDash: () => []
    };
    return new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      }
    });
  };

  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const ctx = createMockCtx();
        return {
          width: 512,
          height: 512,
          getContext: (type: string) => (type === '2d' ? ctx : null)
        };
      }
      return {};
    }
  };
  // Minimap constructor subscribes to language-change and key events; bare
  // Node's globalThis has no EventTarget, so provide a minimal stub.
  (globalThis as any).window = { addEventListener: () => {} };
}

describe('createWorldMaterial program sharing', () => {
  it('materials with identical shader-feature flags share one program cache key', () => {
    const side = new THREE.Texture();
    const macroA = new THREE.Texture();
    const macroB = new THREE.Texture();

    const a = createWorldMaterial({ side, macro: macroA, ink: new THREE.Texture(), inkMapSize: 100 });
    const b = createWorldMaterial({ side, macro: macroB, ink: new THREE.Texture(), inkMapSize: 100 });

    // Macro textures differ, but the shader text is identical: same program.
    expect(a.customProgramCacheKey!()).toBe(b.customProgramCacheKey!());
  });

  it('different shader-feature combos produce distinct program cache keys', () => {
    const side = new THREE.Texture();
    const plain = createWorldMaterial({ side });
    const withMacro = createWorldMaterial({ side, macro: new THREE.Texture() });
    const withInk = createWorldMaterial({ side, ink: new THREE.Texture(), inkMapSize: 100 });
    const withGlow = createWorldMaterial({ side, glow: new THREE.Texture(), glowColor: 0xffffff });
    const noGroundShade = createWorldMaterial({ side, groundShade: false });

    const keys = new Set([plain, withMacro, withInk, withGlow, noGroundShade].map((m) => m.customProgramCacheKey!()));
    expect(keys.size).toBe(5);
  });
});

describe('per-map floor/sky texture eviction', () => {
  it('keeps only the active map resident and repainting reuses the cached texture', () => {
    const downtown = getMapDef('downtown');
    const cargo = getMapDef('cargo_docks');

    const floorDowntown = getFloorTexture(downtown);
    expect(getMapTextureCacheStats().floor).toBeLessThanOrEqual(1);
    expect(getFloorTexture(downtown)).toBe(floorDowntown); // cached, not repainted

    const skyDowntown = getSkyTexture(downtown);
    expect(getMapTextureCacheStats().sky).toBeLessThanOrEqual(1);

    // Switching maps evicts the previous map's GPU textures
    getFloorTexture(cargo);
    getSkyTexture(cargo);
    const stats = getMapTextureCacheStats();
    expect(stats.floor).toBeLessThanOrEqual(1);
    expect(stats.sky).toBeLessThanOrEqual(1);

    // And a revisit repaints without throwing
    expect(() => getFloorTexture(downtown)).not.toThrow();
  });
});

describe('color texture upload cap', () => {
  it('passes through sources that already fit the cap untouched', () => {
    const small = { naturalWidth: 1024, naturalHeight: 640 } as HTMLImageElement;
    expect(capImageSize(small, 1600)).toBe(small);
  });

  it('downsizes oversized sources to the cap on their longest edge', () => {
    const huge = { naturalWidth: 3200, naturalHeight: 1800 } as HTMLImageElement;
    const capped = capImageSize(huge, 1600) as HTMLCanvasElement;
    expect(capped).not.toBe(huge);
    expect(capped.width).toBe(1600);
    expect(capped.height).toBe(900);
  });
});

describe('minimap static layer caching', () => {
  interface Rec {
    /** Names of every 2d-context method invoked, in order. */
    ops: string[];
    /** First arguments of every drawImage call. */
    drawn: unknown[];
  }

  function makeRec(): Rec {
    return { ops: [], drawn: [] };
  }

  function makeCtx(rec: Rec): any {
    const base: any = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      getLineDash: () => []
    };
    return new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return (...args: unknown[]): void => {
          rec.ops.push(String(prop));
          if (prop === 'drawImage') rec.drawn.push(args[0]);
        };
      }
    });
  }

  function makeMinimapHarness() {
    const paintEngine = new PaintEngine(64, 16);
    const mainRec = makeRec();
    const canvases = new Map<unknown, Rec>();

    const canvasEl: any = {
      width: 150,
      height: 150,
      getContext: () => makeCtx(mainRec)
    };

    const docAny = globalThis as any;
    const origCreate = docAny.document.createElement;
    const origGet = docAny.document.getElementById;
    docAny.document.createElement = (tag: string) => {
      if (tag === 'canvas') {
        const rec = makeRec();
        const c: any = { width: 0, height: 0, getContext: () => makeCtx(rec) };
        canvases.set(c, rec);
        return c;
      }
      return origCreate(tag);
    };
    docAny.document.getElementById = (id: string) => {
      if (id === 'minimap-container') {
        return {
          querySelector: () => null,
          classList: { add: () => {}, remove: () => {} }
        };
      }
      if (id === 'minimap-canvas') return canvasEl;
      return origGet ? origGet(id) : null;
    };

    return {
      paintEngine,
      mainRec,
      canvases,
      restore: () => {
        docAny.document.createElement = origCreate;
        docAny.document.getElementById = origGet;
      }
    };
  }

  const local = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    team: Team.PINK,
    alive: true
  };

  const obstaclesA = [
    { id: 'box_1', position: { x: 10, y: 2, z: 10 }, size: { x: 4, y: 4, z: 4 } },
    { id: 'wall_north', position: { x: 0, y: 3, z: -50 }, size: { x: 100, y: 6, z: 2 } }
  ] as unknown as BoxObstacle[];
  const obstaclesB = [
    { id: 'box_2', position: { x: -10, y: 6, z: -10 }, size: { x: 4, y: 4, z: 4 } }
  ] as unknown as BoxObstacle[];

  it('builds static layers once per map and blits them instead of redrawing', () => {
    const h = makeMinimapHarness();
    try {
      const m = new Minimap(h.paintEngine);
      (m as unknown as { drawInterval: number }).drawInterval = 0;

      // Two updates on the same map: static pair built exactly once and
      // blitted on both ticks.
      m.update(local, [], obstaclesA);
      m.update(local, [], obstaclesA);

      expect(h.canvases.size).toBe(2); // base + overlay pair, reused
      const blits = h.mainRec.drawn.filter((src) => h.canvases.has(src));
      expect(blits.length).toBe(4); // 2 layers x 2 updates

      const layerRecs = [...h.canvases.values()];
      // The base layer (background + grid) never strokeRects; the overlay's
      // obstacle contours do. Its single fillRect is the background, painted
      // once — not once per radar tick.
      const baseRec = layerRecs.find((r) => !r.ops.includes('strokeRect'));
      expect(baseRec).toBeDefined();
      expect(baseRec!.ops.filter((op) => op === 'fillRect').length).toBe(1);

      // New obstacle array (map switch): contents redraw, canvases reused.
      const strokeRectsBefore = layerRecs.reduce((n, r) => n + r.ops.filter((op) => op === 'strokeRect').length, 0);
      m.update(local, [], obstaclesB);
      expect(h.canvases.size).toBe(2); // no reallocation
      const strokeRectsAfter = layerRecs.reduce((n, r) => n + r.ops.filter((op) => op === 'strokeRect').length, 0);
      expect(strokeRectsAfter).toBeGreaterThan(strokeRectsBefore);
    } finally {
      h.restore();
    }
  });
});
