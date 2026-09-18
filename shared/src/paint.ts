import { ARENA_HALF_SIZE, ARENA_SIZE } from './config.js';
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
 * Maps world X, Z to normalized UV in [0, 1]
 */
export function worldToUV(x: number, z: number): UVCoord {
  const u = clamp((x + ARENA_HALF_SIZE) / ARENA_SIZE, 0, 1);
  const v = clamp((z + ARENA_HALF_SIZE) / ARENA_SIZE, 0, 1);
  return { u, v };
}

/**
 * Maps UV in [0, 1] to world X, Z coordinates
 */
export function uvToWorld(u: number, v: number): { x: number; z: number } {
  const x = u * ARENA_SIZE - ARENA_HALF_SIZE;
  const z = v * ARENA_SIZE - ARENA_HALF_SIZE;
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

    const r_i = radiusUV * (0.15 + 0.25 * xi);
    const theta_i = 2 * Math.PI * eta;
    const d_i = radiusUV * (0.7 + 0.8 * zeta);

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
