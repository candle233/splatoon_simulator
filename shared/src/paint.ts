import { ARENA_SIZE } from './config.js';
import { PRNG, clamp } from './math.js';

export interface UVCoord {
  u: number;
  v: number;
}

export interface CanvasPixelCoord {
  px: number;
  py: number;
}

export interface GridCoord {
  gx: number;
  gy: number;
}

export interface SplatterCircle {
  u: number;
  v: number;
  radius: number;
}

/**
 * Maps world X, Z to normalized UV in [0, 1].
 * `size` defaults to the legacy 100-unit arena; pass the active map's size
 * when playing on a custom map.
 */
export function worldToUV(x: number, z: number, size: number = ARENA_SIZE): UVCoord {
  const half = size / 2;
  const u = clamp((x + half) / size, 0, 1);
  const v = clamp((z + half) / size, 0, 1);
  return { u, v };
}

/**
 * Maps UV in [0, 1] to world X, Z coordinates.
 * `size` defaults to the legacy 100-unit arena; pass the active map's size
 * when playing on a custom map.
 */
export function uvToWorld(u: number, v: number, size: number = ARENA_SIZE): { x: number; z: number } {
  const half = size / 2;
  const x = u * size - half;
  const z = v * size - half;
  return { x, z };
}

/**
 * Maps UV to Canvas pixel coordinate, taking into account WebGL flipY (v=1 is py=0)
 */
export function uvToCanvas(u: number, v: number, width: number, height: number): CanvasPixelCoord {
  const px = clamp(Math.round(u * (width - 1)), 0, width - 1);
  const py = clamp(Math.round((1.0 - v) * (height - 1)), 0, height - 1);
  return { px, py };
}

/**
 * Maps UV to discrete PaintGrid coordinate [0, resolution - 1]
 */
export function uvToPaintGrid(u: number, v: number, resolution: number): GridCoord {
  const gx = clamp(Math.floor(u * resolution), 0, resolution - 1);
  const gy = clamp(Math.floor(v * resolution), 0, resolution - 1);
  return { gx, gy };
}

/**
 * Maps world X, Z to discrete PaintGrid coordinate [0, resolution - 1] (Subagent 12)
 */
export function worldToGridCell(x: number, z: number, resolution: number, size: number = ARENA_SIZE): GridCoord {
  const { u, v } = worldToUV(x, z, size);
  return uvToPaintGrid(u, v, resolution);
}

// Subagent 12 Function Aliases
export const uvToCanvasPixel = uvToCanvas;
export const uvToGridCell = uvToPaintGrid;

/**
 * Deterministically generates splatters surrounding the main paint impact
 */
export function generateSplatters(
  centerU: number,
  centerV: number,
  radiusUV: number,
  seed: number,
  count = 4
): SplatterCircle[] {
  const prng = new PRNG(seed);
  const splatters: SplatterCircle[] = [];

  for (let i = 0; i < count; i++) {
    const xi = prng.next();
    const eta = prng.next();
    const zeta = prng.next();

    const r_i = radiusUV * (0.1 + 0.25 * xi);
    const theta_i = 2 * Math.PI * eta;
    const d_i = radiusUV * (0.6 + 0.8 * zeta);

    const sU = clamp(centerU + d_i * Math.cos(theta_i), 0, 1);
    const sV = clamp(centerV + d_i * Math.sin(theta_i), 0, 1);

    splatters.push({
      u: sU,
      v: sV,
      radius: r_i
    });
  }

  return splatters;
}

/**
 * Linearly interpolates UV coordinates between (u1, v1) and (u2, v2) with a maximum step size
 */
export function interpolateLineUV(
  u1: number,
  v1: number,
  u2: number,
  v2: number,
  maxStepUV: number
): UVCoord[] {
  const du = u2 - u1;
  const dv = v2 - v1;
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist <= 1e-5 || maxStepUV <= 0) {
    return [{ u: u2, v: v2 }];
  }

  const steps = Math.max(1, Math.ceil(dist / maxStepUV));
  const coords: UVCoord[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    coords.push({
      u: u1 + du * t,
      v: v1 + dv * t
    });
  }
  return coords;
}
