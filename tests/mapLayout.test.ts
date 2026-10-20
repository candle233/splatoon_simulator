import { describe, expect, it } from 'vitest';
import { GRAVITY, JUMP_VELOCITY, MAP_DEFS, PLAYER_HEIGHT, PLAYER_RADIUS, STEP_RISE, Team, getSpawnPosition } from '@ink/shared';
import type { BoxObstacle, MapDef, RampObstacle } from '@ink/shared';
import { CollisionWorld } from '../server/src/Collision.js';

interface Rect {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

const MAPS: MapDef[] = Object.values(MAP_DEFS);
const rect = (o: BoxObstacle): Rect => ({
  id: o.id,
  minX: o.position.x - o.size.x / 2,
  maxX: o.position.x + o.size.x / 2,
  minZ: o.position.z - o.size.z / 2,
  maxZ: o.position.z + o.size.z / 2,
  minY: o.position.y - o.size.y / 2,
  maxY: o.position.y + o.size.y / 2
});
const solids = (def: MapDef): Rect[] => def.obstacles.filter((o) => !o.id.startsWith('wall_')).map(rect);
const MASTS = new Set(['crane_mast', 'radome_mast']);

/** Ground-level XZ footprint of a ramp. */
function rampRect(r: RampObstacle): Rect {
  const alongX = r.direction === 'east' || r.direction === 'west';
  const hx = alongX ? r.length / 2 : r.width / 2;
  const hz = alongX ? r.width / 2 : r.length / 2;
  return {
    id: r.id,
    minX: r.position.x - hx,
    maxX: r.position.x + hx,
    minZ: r.position.z - hz,
    maxZ: r.position.z + hz,
    minY: 0,
    maxY: r.rise
  };
}

/** Rect of the ramp's high end edge (a thin strip). */
function rampHighEnd(r: RampObstacle): Rect {
  const f = rampRect(r);
  const t = 0.3;
  switch (r.direction) {
    case 'east': return { ...f, minX: f.maxX - t };
    case 'west': return { ...f, maxX: f.minX + t };
    case 'south': return { ...f, minZ: f.maxZ - t };
    default: return { ...f, maxZ: f.minZ + t };
  }
}

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
  Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));

const gapBetween = (a: Rect, b: Rect): number => {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.hypot(dx, dz);
};

const contains = (a: Rect, b: Rect): boolean =>
  a.minX <= b.minX + 0.01 && a.maxX >= b.maxX - 0.01 && a.minZ <= b.minZ + 0.01 && a.maxZ >= b.maxZ - 0.01;

describe('map layouts: structure', () => {
  it('only overlaps boxes when one footprint sits wholly inside the other (tiers)', () => {
    for (const def of MAPS) {
      const list = solids(def);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const yOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
          if (yOverlap <= 0.01) continue;
          if (overlapArea(a, b) <= 0.01) continue;
          expect(contains(a, b) || contains(b, a), `${def.id}: ${a.id} partially overlaps ${b.id}`).toBe(true);
        }
      }
    }
  });

  it('keeps ramp footprints free of other geometry and ends every ramp at a platform', () => {
    for (const def of MAPS) {
      const list = solids(def);
      const half = def.size / 2;
      for (const ramp of def.ramps) {
        const fp = rampRect(ramp);
        expect(fp.minX, `${def.id}.${ramp.id}`).toBeGreaterThan(-half);
        expect(fp.maxX, `${def.id}.${ramp.id}`).toBeLessThan(half);
        expect(fp.minZ, `${def.id}.${ramp.id}`).toBeGreaterThan(-half);
        expect(fp.maxZ, `${def.id}.${ramp.id}`).toBeLessThan(half);
        for (const b of list) {
          if (b.minY > ramp.rise) continue;
          expect(overlapArea(fp, b), `${def.id}: ramp ${ramp.id} overlaps ${b.id}`).toBeLessThan(0.05);
        }
        const end = rampHighEnd(ramp);
        const platform = list.find(
          (b) =>
            Math.abs(b.maxY - ramp.rise) < 0.06 &&
            gapBetween(end, b) < 0.35 &&
            overlapArea({ ...end, minX: end.minX - 0.4, maxX: end.maxX + 0.4, minZ: end.minZ - 0.4, maxZ: end.maxZ + 0.4 }, b) > 0.2
        );
        expect(platform, `${def.id}: ramp ${ramp.id} (rise ${ramp.rise}) does not meet a platform`).toBeDefined();
        expect(ramp.rise / ramp.length, `${def.id}: ramp ${ramp.id} too steep`).toBeLessThanOrEqual(0.301);
      }
    }
  });

  it('mirrors ramps like boxes (180° rotation)', () => {
    for (const def of MAPS) {
      for (const r of def.ramps) {
        const rot = def.ramps.find(
          (o) =>
            Math.abs(o.position.x + r.position.x) < 0.01 &&
            Math.abs(o.position.z + r.position.z) < 0.01 &&
            o.rise === r.rise &&
            o.length === r.length
        );
        expect(rot, `${def.id}: ramp ${r.id} has no 180° counterpart`).toBeDefined();
      }
    }
  });
});

describe('map layouts: traversal', () => {
  it('lets a player reach every walkable platform (jump 1.2, ramps, drops)', () => {
    for (const def of MAPS) {
      const list = solids(def).filter((b) => !MASTS.has(b.id));
      type Node = { rect: Rect; y: number };
      const nodes: Node[] = list.map((b) => ({ rect: b, y: b.maxY }));
      const rampNodes: Node[] = def.ramps.map((r) => ({ rect: rampHighEnd(r), y: r.rise }));
      const all = [...nodes, ...rampNodes];
      const seen = new Set<Node>();
      const queue: Node[] = [];
      // From the ground: anything <= one riser, plus every ramp.
      for (const n of all) {
        if (n.y <= STEP_RISE + 0.05 || rampNodes.includes(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
      while (queue.length) {
        const cur = queue.pop()!;
        for (const n of all) {
          if (seen.has(n)) continue;
          if (n.y > cur.y + STEP_RISE + 0.05) continue;
          if (gapBetween(cur.rect, n.rect) > 2.6) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      for (const n of nodes) {
        const w = n.rect.maxX - n.rect.minX;
        const d = n.rect.maxZ - n.rect.minZ;
        if (Math.min(w, d) < 4.2) continue; // thin cover pieces need not be climbable
        // Pillars carrying walkways only need to hold them up.
        if (n.rect.id.includes('_pillar')) continue;
        expect(seen.has(n), `${def.id}: ${n.rect.id} (top ${n.y}) is unreachable`).toBe(true);
      }
    }
  });

  it('keeps the whole ground level connected (no sealed pockets)', () => {
    const cell = 0.5;
    for (const def of MAPS) {
      const half = def.size / 2;
      const blockers = def.obstacles
        .map(rect)
        .filter((b) => b.maxY > STEP_RISE + 0.1 && b.minY < PLAYER_HEIGHT);
      const n = Math.floor(def.size / cell);
      const blocked = new Uint8Array(n * n);
      const pad = PLAYER_RADIUS;
      for (let ix = 0; ix < n; ix++) {
        const x = -half + (ix + 0.5) * cell;
        for (let iz = 0; iz < n; iz++) {
          const z = -half + (iz + 0.5) * cell;
          if (Math.abs(x) > half - pad || Math.abs(z) > half - pad) { blocked[iz * n + ix] = 1; continue; }
          for (const b of blockers) {
            if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) {
              blocked[iz * n + ix] = 1;
              break;
            }
          }
        }
      }
      const start = getSpawnPosition(Team.PINK, 0, def.spawnX);
      const sx = Math.floor((start.x + half) / cell);
      const sz = Math.floor((start.z + half) / cell);
      const visited = new Uint8Array(n * n);
      const stack = [sz * n + sx];
      visited[sz * n + sx] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % n;
        const cz = (c / n) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const k = nz * n + nx;
          if (blocked[k] || visited[k]) continue;
          visited[k] = 1;
          stack.push(k);
        }
      }
      let sealed = 0;
      let firstSealed = '';
      for (let k = 0; k < n * n; k++) {
        if (!blocked[k] && !visited[k]) {
          sealed++;
          if (!firstSealed) firstSealed = `(${(-half + ((k % n) + 0.5) * cell).toFixed(1)}, ${(-half + (((k / n) | 0) + 0.5) * cell).toFixed(1)})`;
        }
      }
      expect(sealed, `${def.id}: ${sealed} sealed ground cells, first at ${firstSealed}`).toBe(0);
      // The enemy spawn must be reachable too.
      const ex = Math.floor((def.spawnX + half) / cell);
      expect(visited[sz * n + ex], `${def.id}: enemy spawn unreachable`).toBe(1);
    }
  });
});

describe('map layouts: server physics agrees with the layout', () => {
  /** Walks a player along +dir through the real server collision resolver. */
  function walk(
    def: MapDef,
    from: { x: number; z: number },
    dir: { x: number; z: number },
    seconds: number,
    jumpAt?: (p: { x: number; y: number; z: number }) => boolean
  ): { x: number; y: number; z: number } {
    const world = new CollisionWorld(def.obstacles);
    world.setObstacles(def.obstacles, def.size);
    world.setRamps(def.ramps);
    const player = { position: { x: from.x, y: 0, z: from.z }, velocity: { x: 0, y: 0, z: 0 } };
    const dt = 0.05;
    let grounded = true;
    let jumped = false;
    for (let t = 0; t < seconds; t += dt) {
      if (grounded && !jumped && jumpAt?.(player.position)) {
        player.velocity.y = JUMP_VELOCITY;
        grounded = false;
        jumped = true;
      }
      if (!grounded) player.velocity.y += GRAVITY * dt;
      const prev = { ...player.position };
      const next = {
        x: player.position.x + dir.x * 6 * dt,
        y: player.position.y + player.velocity.y * dt,
        z: player.position.z + dir.z * 6 * dt
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = world.resolvePlayerMovement(player as any, prev, next, PLAYER_RADIUS, PLAYER_HEIGHT);
      grounded = res.grounded;
    }
    return player.position;
  }

  const DIRS = { east: { x: 1, z: 0 }, west: { x: -1, z: 0 }, south: { x: 0, z: 1 }, north: { x: 0, z: -1 } };

  it('carries a walking player up every ramp onto its platform', () => {
    for (const def of MAPS) {
      for (const ramp of def.ramps) {
        const fp = rampRect(ramp);
        const alongX = ramp.direction === 'east' || ramp.direction === 'west';
        const d = DIRS[ramp.direction];
        const start = alongX
          ? { x: ramp.direction === 'east' ? fp.minX - 1.5 : fp.maxX + 1.5, z: ramp.position.z }
          : { x: ramp.position.x, z: ramp.direction === 'south' ? fp.minZ - 1.5 : fp.maxZ + 1.5 };
        const end = walk(def, start, d, (ramp.length + 6) / 6);
        expect(end.y, `${def.id}: ${ramp.id} did not lift the player to ${ramp.rise}`).toBeGreaterThan(ramp.rise - 0.1);
      }
    }
  });

  it('lets a player hop onto a riser-high block (physics sanity)', () => {
    const def = MAP_DEFS.downtown;
    const planter = def.obstacles.find((o) => o.id === 'planter')!;
    const end = walk(
      def,
      { x: planter.position.x, z: planter.position.z - 8 },
      { x: 0, z: 1 },
      1.4,
      (p) => p.z > planter.position.z - planter.size.z / 2 - 0.9
    );
    expect(end.y).toBeGreaterThan(STEP_RISE - 0.05);
  });
});

describe('map layouts: climbable surfaces and vertical swim routes', () => {
  it('gives every climbable surface a normalized horizontal normal', () => {
    for (const def of MAPS) {
      expect(def.climbableSurfaces.length, `${def.id} has no climbable surfaces`).toBeGreaterThan(0);
      for (const cs of def.climbableSurfaces) {
        expect(Math.abs(cs.normal.y), `${def.id}.${cs.id} normal.y must be zero`).toBeLessThan(0.01);
        const horizLen = Math.hypot(cs.normal.x, cs.normal.z);
        expect(horizLen, `${def.id}.${cs.id} normal is not unit length`).toBeCloseTo(1.0, 3);
      }
    }
  });

  it('detects climbable surface across wide walls even far from center (AABB detection)', () => {
    for (const def of MAPS) {
      const serverWorld = new CollisionWorld(def.obstacles);
      serverWorld.setClimbableSurfaces(def.climbableSurfaces);

      for (const cs of def.climbableSurfaces) {
        const alongX = Math.abs(cs.normal.x) > 0.5;
        const offset = alongX
          ? { x: cs.normal.x * 0.3, z: cs.size.z * 0.35 }
          : { x: cs.size.x * 0.35, z: cs.normal.z * 0.3 };
        const probePos = {
          x: cs.position.x + offset.x,
          y: cs.position.y,
          z: cs.position.z + offset.z
        };

        const hit = serverWorld.getClimbableSurfaceAt(probePos, 1.5);
        expect(hit, `${def.id}: probe failed to detect ${cs.id} along wall face`).toBeDefined();
      }
    }
  });

  it('rejects climbable surface when player is far above in height', () => {
    const def = MAP_DEFS.downtown;
    const serverWorld = new CollisionWorld(def.obstacles);
    serverWorld.setClimbableSurfaces(def.climbableSurfaces);

    // Player at x=0, z=0, but y=50 (high in the air)
    const hit = serverWorld.getClimbableSurfaceAt({ x: 0, y: 50, z: 0 }, 2.0);
    expect(hit).toBeNull();
  });
});
