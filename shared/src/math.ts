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
 * Ray vs Vertical Capsule (approximating player body)
 * base: center at feet, top: base.y + height
 */
export function intersectRayCapsule(
  ray: Ray,
  base: Vec3,
  radius: number,
  height: number
): number | null {
  // Approximate as cylinder with sphere caps
  const p0 = { x: base.x, y: base.y + radius, z: base.z };
  const p1 = { x: base.x, y: base.y + height - radius, z: base.z };

  // Ray vs segment distance check (simplified: 2 spheres at center and top + cylinder)
  // Check center sphere
  const oc = vec3Sub(ray.origin, { x: base.x, y: base.y + height * 0.5, z: base.z });
  const b = vec3Dot(oc, ray.direction);
  const c = vec3Dot(oc, oc) - (height * 0.5) * (height * 0.5);
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
