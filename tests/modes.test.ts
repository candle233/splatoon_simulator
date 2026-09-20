import { describe, expect, it } from 'vitest';
import {
  GAME_MODES,
  MAP_DEFS,
  MODE_CONFIGS,
  Team,
  getMapDef,
  getSpawnPosition,
  worldToUV,
  uvToWorld,
  enforceSpawnBarrier,
  isValidMapId
} from '@ink/shared';
import { PaintGrid } from '../server/src/PaintGrid.js';

describe('map definitions (大场景/多地图)', () => {
  it('exposes three valid maps with unique ids and sizes', () => {
    const ids = Object.keys(MAP_DEFS);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(isValidMapId('downtown')).toBe(true);
    expect(isValidMapId('cargo_docks')).toBe(true);
    expect(isValidMapId('sky_rink')).toBe(true);
    expect(isValidMapId('nope')).toBe(false);

    const sizes = ids.map((id) => MAP_DEFS[id as keyof typeof MAP_DEFS].size);
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(MAP_DEFS.cargo_docks.size).toBeGreaterThan(MAP_DEFS.downtown.size);
  });

  it('keeps all obstacles inside the walls for every map', () => {
    for (const def of Object.values(MAP_DEFS)) {
      const half = def.size / 2;
      for (const obs of def.obstacles) {
        const minX = obs.position.x - obs.size.x / 2;
        const maxX = obs.position.x + obs.size.x / 2;
        const minZ = obs.position.z - obs.size.z / 2;
        const maxZ = obs.position.z + obs.size.z / 2;
        expect(maxX).toBeLessThanOrEqual(half + 2.01);
        expect(minX).toBeGreaterThanOrEqual(-half - 2.01);
        expect(maxZ).toBeLessThanOrEqual(half + 2.01);
        expect(minZ).toBeGreaterThanOrEqual(-half - 2.01);
      }
    }
  });

  it('is rotationally symmetric under 180 degrees (ignoring walls/decor)', () => {
    for (const def of Object.values(MAP_DEFS)) {
      const solid = def.obstacles.filter((o) => !o.id.startsWith('wall_'));
      for (const obs of solid) {
        const mirror = solid.find(
          (o) =>
            Math.abs(o.position.x + obs.position.x) < 0.01 &&
            Math.abs(o.position.z + obs.position.z) < 0.01 &&
            Math.abs(o.size.x - obs.size.x) < 0.01 &&
            Math.abs(o.size.z - obs.size.z) < 0.01
        );
        expect(mirror, `${def.id}: ${obs.id} has no 180° counterpart`).toBeTruthy();
      }
    }
  });

  it('keeps spawn rows clear of obstacles', () => {
    for (const def of Object.values(MAP_DEFS)) {
      for (let slot = 0; slot < 4; slot++) {
        for (const team of [Team.PINK, Team.CYAN]) {
          const spawn = getSpawnPosition(team, slot, def.spawnX);
          expect(Math.abs(spawn.x)).toBeLessThan(def.size / 2 - 2);
          for (const obs of def.obstacles) {
            if (obs.id.startsWith('wall_')) continue;
            const insideX =
              Math.abs(spawn.x - obs.position.x) < obs.size.x / 2 + 0.6;
            const insideZ =
              Math.abs(spawn.z - obs.position.z) < obs.size.z / 2 + 0.6;
            const overlaps = insideX && insideZ && obs.position.y - obs.size.y / 2 < 1.2;
            expect(overlaps, `${def.id}: spawn slot ${slot} overlaps ${obs.id}`).toBe(false);
          }
        }
      }
    }
  });

  it('defines a zone rect inside the map with 3-language metadata', () => {
    for (const def of Object.values(MAP_DEFS)) {
      const half = def.size / 2;
      expect(Math.abs(def.zone.x) + def.zone.w / 2).toBeLessThan(half);
      expect(Math.abs(def.zone.z) + def.zone.d / 2).toBeLessThan(half);
      expect(def.nameZh.length).toBeGreaterThan(0);
      expect(def.nameJa.length).toBeGreaterThan(0);
      expect(def.descriptionZh.length).toBeGreaterThan(0);
      expect(def.descriptionJa.length).toBeGreaterThan(0);
    }
  });

  it('paint UV helpers respect custom map sizes', () => {
    const size = 124;
    const uv = worldToUV(-62, 62, size);
    expect(uv).toEqual({ u: 0, v: 1 });
    const world = uvToWorld(0.5, 0.5, size);
    expect(world.x).toBeCloseTo(0);
    expect(world.z).toBeCloseTo(0);

    // Legacy default still maps [-50, 50]
    expect(worldToUV(-50, -50)).toEqual({ u: 0, v: 0 });
    expect(worldToUV(50, 50)).toEqual({ u: 1, v: 1 });
  });

  it('spawn barrier scales with the map spawn X', () => {
    const pos = { x: -49, y: 1, z: 0 };
    const resolved = enforceSpawnBarrier(pos, Team.CYAN, 50);
    expect(resolved.x).toBe(-45);

    const legacy = enforceSpawnBarrier({ x: -40, y: 1, z: 0 }, Team.CYAN);
    expect(legacy.x).toBe(-35);
  });

  it('getMapDef falls back to the default map', () => {
    expect(getMapDef().id).toBe('downtown');
    expect(getMapDef('cargo_docks').id).toBe('cargo_docks');
    expect(getMapDef('bogus').id).toBe('downtown');
  });
});

describe('game modes (新模式)', () => {
  it('defines every advertised mode with localized names and score limits', () => {
    // Assert the roster matches GAME_MODES rather than a frozen list, so adding
    // a mode does not require editing this test.
    expect(Object.keys(MODE_CONFIGS).sort()).toEqual([...GAME_MODES].sort());
    expect(GAME_MODES).toContain('turf_war');
    expect(GAME_MODES).toContain('splat_zones');
    expect(GAME_MODES).toContain('team_deathmatch');
    expect(MODE_CONFIGS.turf_war.scoreLimit).toBe(0);
    expect(MODE_CONFIGS.splat_zones.scoreLimit).toBeGreaterThan(0);
    expect(MODE_CONFIGS.team_deathmatch.scoreLimit).toBeGreaterThan(0);
    for (const mode of Object.values(MODE_CONFIGS)) {
      expect(mode.nameZh.length).toBeGreaterThan(0);
      expect(mode.nameJa.length).toBeGreaterThan(0);
      expect(mode.descriptionZh.length).toBeGreaterThan(0);
      expect(mode.descriptionJa.length).toBeGreaterThan(0);
    }
  });

  it('counts zone control from the paint grid', () => {
    const grid = new PaintGrid(128);
    grid.setMapSize(100);
    const zone = { x: 0, z: 0, w: 40, d: 20 };

    let empty = grid.getZoneControl(zone);
    expect(empty.pink).toBe(0);
    expect(empty.cyan).toBe(0);

    // Paint the entire zone pink via UV events covering x [-20, 20], z [-10, 10]
    for (let x = -19; x <= 19; x += 2) {
      for (let z = -9; z <= 9; z += 2) {
        const uv = worldToUV(x, z, 100);
        grid.applyPaintEvent({ id: 1, team: Team.PINK, u: uv.u, v: uv.v, radius: 0.02, seed: 1 });
      }
    }
    const pinkOnly = grid.getZoneControl(zone);
    expect(pinkOnly.cyan).toBe(0);
    expect(pinkOnly.pink).toBeGreaterThan(0);

    // Cyan takeover: paint over the same area with big circles
    for (let x = -19; x <= 19; x += 2) {
      for (let z = -9; z <= 9; z += 2) {
        const uv = worldToUV(x, z, 100);
        grid.applyPaintEvent({ id: 1, team: Team.CYAN, u: uv.u, v: uv.v, radius: 0.03, seed: 2 });
      }
    }
    const cyanControl = grid.getZoneControl(zone);
    expect(cyanControl.cyan).toBeGreaterThan(cyanControl.pink);
  });
});
