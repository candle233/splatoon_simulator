import { describe, expect, it } from 'vitest';
import {
  MAP_DEFS,
  SPAWN_X_RATIO,
  STEP_RISE,
  Team,
  getMapDef,
  getSpawnPosition,
  isValidMapId,
  spawnXForSize,
  worldToUV
} from '@ink/shared';
import type { BoxObstacle, MapDef } from '@ink/shared';
import { PaintGrid } from '../server/src/PaintGrid.js';

interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function aabb(obs: BoxObstacle): Aabb {
  return {
    minX: obs.position.x - obs.size.x / 2,
    maxX: obs.position.x + obs.size.x / 2,
    minY: obs.position.y - obs.size.y / 2,
    maxY: obs.position.y + obs.size.y / 2,
    minZ: obs.position.z - obs.size.z / 2,
    maxZ: obs.position.z + obs.size.z / 2
  };
}

const MAP_LIST: MapDef[] = Object.values(MAP_DEFS);
const solid = (def: MapDef): BoxObstacle[] => def.obstacles.filter((o) => !o.id.startsWith('wall_'));

describe('map definitions: well-formedness (大场景/多地图)', () => {
  it('exposes four maps with unique ids, sizes and full trilingual metadata', () => {
    const ids = Object.keys(MAP_DEFS);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) {
      expect(isValidMapId(id)).toBe(true);
      const def = MAP_DEFS[id as keyof typeof MAP_DEFS];
      expect(def.id).toBe(id);
      for (const field of ['name', 'nameZh', 'nameJa', 'description', 'descriptionZh', 'descriptionJa'] as const) {
        expect(def[field].length, `${id}.${field}`).toBeGreaterThan(0);
      }
    }
    expect(isValidMapId('not_a_map')).toBe(false);

    const sizes = MAP_LIST.map((d) => d.size);
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(MAP_DEFS.cargo_docks.size).toBeGreaterThan(MAP_DEFS.downtown.size);
  });

  it('is well past the legacy 100-unit footprint on every map', () => {
    for (const def of MAP_LIST) {
      expect(def.size, `${def.id} was not enlarged`).toBeGreaterThanOrEqual(120);
    }
  });

  it('uses only finite, positive numbers in every obstacle', () => {
    for (const def of MAP_LIST) {
      for (const obs of def.obstacles) {
        expect(obs.id.length, `${def.id}: empty obstacle id`).toBeGreaterThan(0);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(Number.isFinite(obs.position[axis]), `${def.id}.${obs.id}.position.${axis}`).toBe(true);
          expect(Number.isFinite(obs.size[axis]), `${def.id}.${obs.id}.size.${axis}`).toBe(true);
          expect(obs.size[axis], `${def.id}.${obs.id}.size.${axis}`).toBeGreaterThan(0);
        }
        expect(Number.isFinite(def.size)).toBe(true);
        expect(Number.isFinite(def.spawnX)).toBe(true);
        expect(Number.isFinite(def.zone.x)).toBe(true);
        expect(Number.isFinite(def.zone.z)).toBe(true);
        expect(Number.isFinite(def.zone.w)).toBe(true);
        expect(Number.isFinite(def.zone.d)).toBe(true);
      }
    }
  });

  it('gives every obstacle a unique id', () => {
    for (const def of MAP_LIST) {
      const ids = def.obstacles.map((o) => o.id);
      expect(new Set(ids).size, `${def.id} has duplicate obstacle ids`).toBe(ids.length);
    }
  });

  it('keeps all obstacles inside the walls and under a sane ceiling', () => {
    for (const def of MAP_LIST) {
      const half = def.size / 2;
      for (const obs of def.obstacles) {
        const r = aabb(obs);
        expect(r.maxX, `${def.id}.${obs.id}`).toBeLessThanOrEqual(half + 2.01);
        expect(r.minX, `${def.id}.${obs.id}`).toBeGreaterThanOrEqual(-half - 2.01);
        expect(r.maxZ, `${def.id}.${obs.id}`).toBeLessThanOrEqual(half + 2.01);
        expect(r.minZ, `${def.id}.${obs.id}`).toBeGreaterThanOrEqual(-half - 2.01);
        // Nothing so tall that the camera/aim raycast degenerates.
        expect(r.maxY, `${def.id}.${obs.id}`).toBeLessThanOrEqual(14);
      }
    }
  });

  it('rests every obstacle on the ground or on another box', () => {
    for (const def of MAP_LIST) {
      for (const obs of def.obstacles) {
        const r = aabb(obs);
        if (r.minY <= 0.02) continue;
        const supported = def.obstacles.some((other) => {
          if (other.id === obs.id) return false;
          const o = aabb(other);
          if (Math.abs(o.maxY - r.minY) > 0.06) return false;
          return r.minX < o.maxX - 0.05 && r.maxX > o.minX + 0.05 && r.minZ < o.maxZ - 0.05 && r.maxZ > o.minZ + 0.05;
        });
        expect(supported, `${def.id}: ${obs.id} floats at y=${r.minY.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('stacks raised geometry in climbable risers', () => {
    // Every distinct top surface above one riser must have a lower surface
    // within one jump-reachable riser, so verticality is actually usable.
    for (const def of MAP_LIST) {
      const tops = [...new Set(solid(def).map((o) => Number(aabb(o).maxY.toFixed(3))))].sort((a, b) => a - b);
      const masts = new Set(['crane_mast', 'radome_mast']);
      for (const top of tops) {
        if (top <= STEP_RISE + 0.01) continue;
        const isMast = solid(def).some((o) => masts.has(o.id) && Math.abs(aabb(o).maxY - top) < 0.01);
        if (isMast) continue; // decorative masts are not meant to be climbed
        const below = tops.filter((v) => v < top - 0.01).pop();
        expect(below, `${def.id}: no surface below top ${top}`).toBeDefined();
        expect(top - (below ?? 0), `${def.id}: top ${top} is above a full riser`).toBeLessThanOrEqual(STEP_RISE + 0.02);
      }
    }
  });

  it('is symmetric under the team-axis mirror, the z mirror and 180° rotation', () => {
    for (const def of MAP_LIST) {
      const bodies = solid(def);
      for (const obs of bodies) {
        const mirrorX = bodies.find(
          (o) =>
            Math.abs(o.position.x + obs.position.x) < 0.01 &&
            Math.abs(o.position.z - obs.position.z) < 0.01 &&
            Math.abs(o.position.y - obs.position.y) < 0.01 &&
            Math.abs(o.size.x - obs.size.x) < 0.01 &&
            Math.abs(o.size.y - obs.size.y) < 0.01 &&
            Math.abs(o.size.z - obs.size.z) < 0.01
        );
        expect(mirrorX, `${def.id}: ${obs.id} has no team-axis mirror`).toBeTruthy();

        const mirrorZ = bodies.find(
          (o) =>
            Math.abs(o.position.z + obs.position.z) < 0.01 &&
            Math.abs(o.position.x - obs.position.x) < 0.01 &&
            Math.abs(o.position.y - obs.position.y) < 0.01 &&
            Math.abs(o.size.x - obs.size.x) < 0.01 &&
            Math.abs(o.size.y - obs.size.y) < 0.01 &&
            Math.abs(o.size.z - obs.size.z) < 0.01
        );
        expect(mirrorZ, `${def.id}: ${obs.id} has no z mirror`).toBeTruthy();

        const rotated = bodies.find(
          (o) =>
            Math.abs(o.position.x + obs.position.x) < 0.01 &&
            Math.abs(o.position.z + obs.position.z) < 0.01 &&
            Math.abs(o.position.y - obs.position.y) < 0.01 &&
            Math.abs(o.size.x - obs.size.x) < 0.01 &&
            Math.abs(o.size.y - obs.size.y) < 0.01 &&
            Math.abs(o.size.z - obs.size.z) < 0.01
        );
        expect(rotated, `${def.id}: ${obs.id} has no 180° counterpart`).toBeTruthy();
      }
    }
  });

  it('mirrors the perimeter walls too', () => {
    for (const def of MAP_LIST) {
      const walls = def.obstacles.filter((o) => o.id.startsWith('wall_'));
      expect(walls.length, `${def.id} wall count`).toBe(4);
      for (const wall of walls) {
        const r = aabb(wall);
        const horizontal = wall.size.x > wall.size.z;
        // Walls hug the arena edge and span the full width on their axis.
        expect(Math.abs(horizontal ? r.minZ : r.minX)).toBeGreaterThanOrEqual(def.size / 2);
      }
    }
  });
});

describe('map spawns and zone', () => {
  it('keeps spawn rows clear of obstacles on every map', () => {
    for (const def of MAP_LIST) {
      for (let slot = 0; slot < 4; slot++) {
        for (const team of [Team.PINK, Team.CYAN]) {
          const spawn = getSpawnPosition(team, slot, def.spawnX);
          expect(Math.abs(spawn.x), `${def.id} spawn inside walls`).toBeLessThan(def.size / 2 - 2);
          for (const obs of solid(def)) {
            const r = aabb(obs);
            if (r.maxY <= 1.4) continue; // low risers are steppable, not blockers
            const nearestX = Math.max(r.minX, Math.min(spawn.x, r.maxX));
            const nearestZ = Math.max(r.minZ, Math.min(spawn.z, r.maxZ));
            const dist = Math.hypot(spawn.x - nearestX, spawn.z - nearestZ);
            expect(dist, `${def.id}: spawn slot ${slot} overlaps ${obs.id}`).toBeGreaterThan(1.6);
          }
        }
      }
    }
  });

  it('leaves each spawn pad dome (radius 6.5) unobstructed', () => {
    for (const def of MAP_LIST) {
      for (const sx of [-def.spawnX, def.spawnX]) {
        for (const obs of solid(def)) {
          const r = aabb(obs);
          if (r.maxY <= 0.4) continue;
          const nearestX = Math.max(r.minX, Math.min(sx, r.maxX));
          const nearestZ = Math.max(r.minZ, Math.min(0, r.maxZ));
          const dist = Math.hypot(sx - nearestX, nearestZ);
          expect(dist, `${def.id}: ${obs.id} intrudes into the spawn pad at x=${sx}`).toBeGreaterThan(6.8);
        }
      }
    }
  });

  it('derives spawnX from the map size with a shared ratio', () => {
    for (const def of MAP_LIST) {
      expect(def.spawnX).toBeCloseTo(spawnXForSize(def.size), 6);
      expect(def.spawnX).toBeCloseTo(def.size * SPAWN_X_RATIO, 6);
    }
  });

  it('defines a zone rect inside the map', () => {
    for (const def of MAP_LIST) {
      const half = def.size / 2;
      expect(Math.abs(def.zone.x) + def.zone.w / 2, `${def.id} zone width`).toBeLessThan(half);
      expect(Math.abs(def.zone.z) + def.zone.d / 2, `${def.id} zone depth`).toBeLessThan(half);
      expect(def.zone.w).toBeGreaterThan(0);
      expect(def.zone.d).toBeGreaterThan(0);
    }
  });

  it('keeps a walkable lane along z = 0 between the two spawns', () => {
    for (const def of MAP_LIST) {
      const half = def.size / 2;
      let widestGap = 0;
      let run = 0;
      for (let x = -half + 3; x <= half - 3; x += 0.5) {
        const blocked = solid(def).some((o) => {
          const r = aabb(o);
          return r.maxY > 1.5 && x > r.minX && x < r.maxX && 0 > r.minZ && 0 < r.maxZ;
        });
        if (blocked) run = 0;
        else {
          run += 0.5;
          widestGap = Math.max(widestGap, run);
        }
      }
      expect(widestGap, `${def.id}: no continuous mid lane`).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('paint extent tracks the active map', () => {
  it('maps the full map edge to the [0,1] UV range for every size', () => {
    for (const def of MAP_LIST) {
      const half = def.size / 2;
      expect(worldToUV(-half, -half, def.size)).toEqual({ u: 0, v: 0 });
      expect(worldToUV(half, half, def.size)).toEqual({ u: 1, v: 1 });
      const mid = worldToUV(0, 0, def.size);
      expect(mid.u).toBeCloseTo(0.5);
      expect(mid.v).toBeCloseTo(0.5);
    }
  });

  it('would sample the wrong cell if a non-100 map used the legacy default', () => {
    // Regression guard for the client bug: the enlarged maps are all > 100, so
    // the default extent lands in the wrong cell for a point near the wall.
    const def = getMapDef('cargo_docks');
    const half = def.size / 2;
    const wrong = worldToUV(half - 1, 0);
    const right = worldToUV(half - 1, 0, def.size);
    expect(wrong.u).toBe(1); // clamped against the legacy 100-unit extent
    expect(right.u).toBeLessThan(1);
    expect(right.u).toBeGreaterThan(0.9);
  });

  it('keeps a server-side PaintGrid and a map-sized read in agreement', () => {
    // The client's PaintEngine mirrors PaintGrid.setMapSize; if the two ever
    // disagree, ink lookups land on different cells for the same world point.
    const def = getMapDef('aurora_outpost');
    const grid = new PaintGrid(256);
    grid.setMapSize(def.size);
    expect(grid.getMapSize()).toBe(def.size);

    const half = def.size / 2;
    const probe = { x: half - 10, z: -half + 14 };
    const uv = worldToUV(probe.x, probe.z, def.size);
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: uv.u, v: uv.v, radius: 0.03, seed: 3 });
    expect(grid.getInkAt(probe.x, probe.z)).toBe(Team.PINK);
    // A point on the far side of the arena must be untouched.
    expect(grid.getInkAt(-half + 10, half - 14)).toBe(Team.NEUTRAL);
  });
});
