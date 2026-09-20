import { Vec3 } from './types.js';

/**
 * Deterministic 32-bit PRNG (Mulberry32)
 */
export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns next pseudo-random float in [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns next pseudo-random float in [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Returns next pseudo-random integer in [min, max] */
  rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function vec3DistanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t)
  };
}

export interface Ray {
  origin: Vec3;
  direction: Vec3; // normalized
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

/**
 * Slab method for Ray vs AABB intersection
 * Returns distance t >= 0 or null if no hit
 */
export function intersectRayAABB(ray: Ray, aabb: AABB): { t: number; normal: Vec3 } | null {
  let tMin = 0.0;
  let tMax = Number.POSITIVE_INFINITY;
  let hitNormal: Vec3 = { x: 0, y: 1, z: 0 };

  const axes: (keyof Vec3)[] = ['x', 'y', 'z'];

  for (const axis of axes) {
    const o = ray.origin[axis];
    const d = ray.direction[axis];
    const minVal = aabb.min[axis];
    const maxVal = aabb.max[axis];

    if (Math.abs(d) < 1e-8) {
      // Ray is parallel to slab. Check if origin is within slab
      if (o < minVal || o > maxVal) {
        return null;
      }
    } else {
      const invD = 1.0 / d;
      let t1 = (minVal - o) * invD;
      let t2 = (maxVal - o) * invD;
      let normalSign = -1;

      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        normalSign = 1;
      }

      if (t1 > tMin) {
        tMin = t1;
        hitNormal = {
          x: axis === 'x' ? normalSign : 0,
          y: axis === 'y' ? normalSign : 0,
          z: axis === 'z' ? normalSign : 0
        };
      }

      tMax = Math.min(tMax, t2);

      if (tMin > tMax) {
        return null;
      }
    }
  }

  if (tMin < 0) {
    // If inside or behind
    if (tMax < 0) return null;
    return { t: tMax, normal: hitNormal };
  }

  return { t: tMin, normal: hitNormal };
}

/**
 * Ray vs Ground Plane (y = planeY) intersection
 */
export function intersectRayGroundPlane(
  ray: Ray,
  planeY = 0,
  boundsHalfSize = 50
): { t: number; point: Vec3 } | null {
  if (Math.abs(ray.direction.y) < 1e-6) {
    return null; // Parallel to ground
  }

  const t = (planeY - ray.origin.y) / ray.direction.y;
  if (t < 0) return null; // Behind ray origin

  const px = ray.origin.x + ray.direction.x * t;
  const pz = ray.origin.z + ray.direction.z * t;

  if (Math.abs(px) > boundsHalfSize || Math.abs(pz) > boundsHalfSize) {
    return null; // Outside arena ground
  }

  return {
    t,
    point: { x: px, y: planeY, z: pz }
  };
}

/**
 * Ray vs Vertical Capsule (approximating player body).
 * base: center at feet; A = base + (0, radius, 0) [hip], B = base + (0, height - radius, 0) [head];
 * cylindrical body of radius `radius` between A and B + hemispherical caps of the same radius.
 */
export function intersectRayCapsule(
  ray: Ray,
  base: Vec3,
  radius: number,
  height: number
): number | null {
  const Ax = base.x, Ay = base.y + radius, Az = base.z;
  const Bx = base.x, By = base.y + height - radius, Bz = base.z;
  const ABx = Bx - Ax, ABy = By - Ay, ABz = Bz - Az;
  const ab2 = ABx * ABx + ABy * ABy + ABz * ABz;
  const Ox = ray.origin.x - Ax, Oy = ray.origin.y - Ay, Oz = ray.origin.z - Az;
  const dd =
    ray.direction.x * ray.direction.x +
    ray.direction.y * ray.direction.y +
    ray.direction.z * ray.direction.z;
  const dab = ray.direction.x * ABx + ray.direction.y * ABy + ray.direction.z * ABz;
  const dac = Ox * ray.direction.x + Oy * ray.direction.y + Oz * ray.direction.z;
  const abc = ABx * Ox + ABy * Oy + ABz * Oz;
  const denom = dd * ab2 - dab * dab;
  let best: number | null = null;
  // Cylinder branch (segment A→B).
  if (Math.abs(denom) > 1e-10) {
    const s = (dd * abc - dab * dac) / denom;
    const t = (s * dab - dac) / dd;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) {
      const px = Ox + t * ray.direction.x - s * ABx;
      const py = Oy + t * ray.direction.y - s * ABy;
      const pz = Oz + t * ray.direction.z - s * ABz;
      const dist2 = px * px + py * py + pz * pz;
      if (dist2 <= radius * radius + 1e-6) best = t;
    }
  }
  // Hemispherical caps at A and B.
  for (const sp of [
    { x: Ax, y: Ay, z: Az },
    { x: Bx, y: By, z: Bz },
  ] as const) {
    const wx = ray.origin.x - sp.x, wy = ray.origin.y - sp.y, wz = ray.origin.z - sp.z;
    const aC = dd;
    const bC =
      2 *
      (wx * ray.direction.x + wy * ray.direction.y + wz * ray.direction.z);
    const cC = wx * wx + wy * wy + wz * wz - radius * radius;
    const disc = bC * bC - 4 * aC * cC;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const t1 = (-bC - sq) / (2 * aC);
    const t2 = (-bC + sq) / (2 * aC);
    const t = t1 > 1e-6 ? t1 : t2 > 1e-6 ? t2 : null;
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}
