import { ARENA_SIZE, CYAN_COLOR_HEX, PINK_COLOR_HEX } from './config.js';
import { Team } from './types.js';
import type { BoxObstacle, ClimbableSurface, MapId, PaintSurface, RampObstacle, Vec3 } from './types.js';

export const ARENA_WALL_HEIGHT = 5.0;

export const SPAWN_Z_OFFSETS = [-6, -2, 2, 6];

/**
 * Spawn rows sit at |x| = 0.4 * size on every shipped map. The server's
 * spawn barrier uses the same ratio and the minimap derives its markers from
 * it, so keeping the ratio in one place stops the three from drifting apart.
 */
export const SPAWN_X_RATIO = 0.4;

/**
 * Jump apex for the shipped movement config (JUMP_VELOCITY^2 / 2G). Boxes are
 * stacked in 1.2-unit risers so every raised platform stays reachable on foot;
 * `STEP_RISE` is the riser height all stacked layouts are authored against.
 */
export const STEP_RISE = 1.2;

/** Spawn row |x| for a map edge length. */
export function spawnXForSize(size: number): number {
  return size * SPAWN_X_RATIO;
}

/** Rectangular zone (center + full width/depth) used by Splat Zones. */
export interface ZoneRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Per-map visual theme applied by the client renderer/arena. */
export interface MapTheme {
  sky: number;
  fogColor: number;
  fogDensity: number;
  groundBase: number;
  groundAlt: number;
  wallColor: number;
  obstacleColor: number;
  accentA: number;
  accentB: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  nameZh: string;
  nameJa: string;
  description: string;
  descriptionZh: string;
  descriptionJa: string;
  /** Full square edge length in world units. */
  size: number;
  obstacles: BoxObstacle[];
  /** Ramps that lift the player up a slope. */
  ramps: RampObstacle[];
  /** Surfaces the player can climb by holding the climb key. */
  climbableSurfaces: ClimbableSurface[];
  /** Vertical wall faces that accept paint. */
  paintSurfaces: PaintSurface[];
  /** |x| of both team spawn rows. */
  spawnX: number;
  zone: ZoneRect;
  theme: MapTheme;
}

const R = STEP_RISE;

function perimeterWalls(size: number): BoxObstacle[] {
  const half = size / 2;
  const len = size + 2;
  const z = half + 1;
  return [
    { id: 'wall_north', position: { x: 0, y: 2.5, z }, size: { x: len, y: 5, z: 2 }, paintable: true },
    { id: 'wall_south', position: { x: 0, y: 2.5, z: -z }, size: { x: len, y: 5, z: 2 }, paintable: true },
    { id: 'wall_east', position: { x: z, y: 2.5, z: 0 }, size: { x: 2, y: 5, z: len }, paintable: true },
    { id: 'wall_west', position: { x: -z, y: 2.5, z: 0 }, size: { x: 2, y: 5, z: len }, paintable: true }
  ];
}

function box(id: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): BoxObstacle {
  return { id, position: { x, y, z }, size: { x: sx, y: sy, z: sz } };
}

/**
 * Solid block footprint (`w` along x, `d` along z) centred on (cx, cz), rising
 * from `base` (default: the ground) up to the absolute height `top`.
 */
function block(id: string, cx: number, cz: number, w: number, d: number, top: number, base = 0): BoxObstacle {
  return box(id, cx, (base + top) / 2, cz, w, top - base, d);
}

/**
 * A flight of `steps` risers, each `STEP_RISE` taller than the last. (x, z) is
 * the centre of the first step's outer edge; the flight climbs along `dir`.
 */
function stairs(
  id: string,
  x: number,
  z: number,
  dir: 'north' | 'south' | 'east' | 'west',
  steps: number,
  run: number,
  width: number
): BoxObstacle[] {
  const out: BoxObstacle[] = [];
  for (let i = 0; i < steps; i++) {
    const off = (i + 0.5) * run;
    const top = R * (i + 1);
    switch (dir) {
      case 'east': out.push(block(`${id}_${i}`, x + off, z, run, width, top)); break;
      case 'west': out.push(block(`${id}_${i}`, x - off, z, run, width, top)); break;
      case 'south': out.push(block(`${id}_${i}`, x, z + off, width, run, top)); break;
      case 'north': out.push(block(`${id}_${i}`, x, z - off, width, run, top)); break;
    }
  }
  return out;
}

/**
 * Elevated walkway: a `STEP_RISE`-thick deck whose upper surface sits at `top`,
 * carried on 2x2 pillars so players can run underneath (clearance top - 1.2).
 */
function bridge(
  id: string,
  cx: number,
  cz: number,
  w: number,
  d: number,
  top: number,
  pillars: Array<[number, number]>
): BoxObstacle[] {
  const out: BoxObstacle[] = [block(id, cx, cz, w, d, top, top - R)];
  pillars.forEach(([px, pz], i) => out.push(block(`${id}_pillar${i}`, px, pz, 2, 2, top - R)));
  return out;
}

/**
 * A sloped ramp from ground level up by `rise` units over `length`. (x, z) is
 * the centre of the LOW end; the ramp climbs toward `direction`.
 */
function ramp(
  id: string,
  x: number,
  z: number,
  direction: RampObstacle['direction'],
  length: number,
  rise: number,
  width = 4
): RampObstacle {
  let px = x, pz = z;
  switch (direction) {
    case 'north': pz -= length / 2; break;
    case 'south': pz += length / 2; break;
    case 'east':  px += length / 2; break;
    case 'west':  px -= length / 2; break;
  }
  return { id, position: { x: px, y: rise / 2, z: pz }, length, width, rise, direction, climbable: true };
}

function climbable(id: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, nx: number, ny: number, nz: number): ClimbableSurface {
  return { id, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, normal: { x: nx, y: ny, z: nz } };
}

function paintWall(id: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, nx: number, ny: number, nz: number): PaintSurface {
  return { id, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, normal: { x: nx, y: ny, z: nz }, height: sy, paint: [0, 0] };
}

function perimeterClimbables(size: number): ClimbableSurface[] {
  const c = size / 2 + 1.5;
  const len = size + 2;
  return [
    climbable('climb_wall_n', 0, 2.5, c, len, 5, 2, 0, 0, -1),
    climbable('climb_wall_s', 0, 2.5, -c, len, 5, 2, 0, 0, 1),
    climbable('climb_wall_e', c, 2.5, 0, 2, 5, len, -1, 0, 0),
    climbable('climb_wall_w', -c, 2.5, 0, 2, 5, len, 1, 0, 0)
  ];
}

/** Helper to create 4 climbable faces around a vertical block/pillar. */
function climbablePillar(id: string, cx: number, cz: number, w: number, d: number, top: number, base = 0): ClimbableSurface[] {
  const y = (base + top) / 2;
  const h = top - base;
  return [
    climbable(`${id}_climb_n`, cx, y, cz + d / 2, w, h, 0.4, 0, 0, 1),
    climbable(`${id}_climb_s`, cx, y, cz - d / 2, w, h, 0.4, 0, 0, -1),
    climbable(`${id}_climb_e`, cx + w / 2, y, cz, 0.4, h, d, 1, 0, 0),
    climbable(`${id}_climb_w`, cx - w / 2, y, cz, 0.4, h, d, -1, 0, 0)
  ];
}

function mirrorClimbables(entries: ClimbableSurface[]): ClimbableSurface[] {
  const out: ClimbableSurface[] = [];
  const seen = new Set<string>();
  const push = (s: ClimbableSurface): void => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
  };
  for (const s of entries) {
    const { x, y, z } = s.position;
    const { x: sx, y: sy, z: sz } = s.size;
    const { x: nx, y: ny, z: nz } = s.normal;
    const mx = Math.abs(x) > 0.001;
    const mz = Math.abs(z) > 0.001;
    push(s);
    if (mx) push({ id: `${s.id}_w`, position: { x: -x, y, z }, size: { x: sx, y: sy, z: sz }, normal: { x: -nx, y: ny, z: nz } });
    if (mz) push({ id: `${s.id}_s`, position: { x, y, z: -z }, size: { x: sx, y: sy, z: sz }, normal: { x: nx, y: ny, z: -nz } });
    if (mx && mz) push({ id: `${s.id}_ws`, position: { x: -x, y, z: -z }, size: { x: sx, y: sy, z: sz }, normal: { x: -nx, y: ny, z: -nz } });
  }
  return out;
}

function paintSurfacesFor(size: number, centre: { half: number; top: number }, extraSurfaces: PaintSurface[] = []): PaintSurface[] {
  const c = size / 2 + 1.5;
  const len = size + 2;
  const { half, top } = centre;
  return [
    paintWall('paint_wall_n', 0, 2.5, c, len, 5, 2, 0, 0, -1),
    paintWall('paint_wall_s', 0, 2.5, -c, len, 5, 2, 0, 0, 1),
    paintWall('paint_wall_e', c, 2.5, 0, 2, 5, len, -1, 0, 0),
    paintWall('paint_wall_w', -c, 2.5, 0, 2, 5, len, 1, 0, 0),
    paintWall('paint_centre_n', 0, top / 2, half, half * 2, top, 0.1, 0, 0, 1),
    paintWall('paint_centre_s', 0, top / 2, -half, half * 2, top, 0.1, 0, 0, -1),
    paintWall('paint_centre_e', half, top / 2, 0, 0.1, top, half * 2, 1, 0, 0),
    paintWall('paint_centre_w', -half, top / 2, 0, 0.1, top, half * 2, -1, 0, 0),
    ...extraSurfaces
  ];
}

/**
 * Replicates a half-layout across the arena's X and Z axes so every map is
 * symmetric under both mirrors — and therefore under a 180° rotation, the
 * property that keeps the two team halves competitively identical.
 *
 * Author each entry in the +X/+Z quadrant; the helper emits the west (`_w`),
 * south (`_s`) and south-west (`_ws`) copies. Entries sitting on an axis only
 * get the copies that actually move them, so nothing is duplicated.
 */
function mirrorLayout(entries: BoxObstacle[]): BoxObstacle[] {
  const out: BoxObstacle[] = [];
  const seen = new Set<string>();
  const push = (obs: BoxObstacle): void => {
    if (seen.has(obs.id)) return;
    seen.add(obs.id);
    out.push(obs);
  };

  for (const obs of entries) {
    const { x, y, z } = obs.position;
    const { x: sx, y: sy, z: sz } = obs.size;
    const mirrorX = Math.abs(x) > 0.001;
    const mirrorZ = Math.abs(z) > 0.001;

    push(obs);
    if (mirrorX) push(box(`${obs.id}_w`, -x, y, z, sx, sy, sz));
    if (mirrorZ) push(box(`${obs.id}_s`, x, y, -z, sx, sy, sz));
    if (mirrorX && mirrorZ) push(box(`${obs.id}_ws`, -x, y, -z, sx, sy, sz));
  }

  return out;
}

const FLIP_X: Record<RampObstacle['direction'], RampObstacle['direction']> = {
  north: 'north', south: 'south', east: 'west', west: 'east'
};
const FLIP_Z: Record<RampObstacle['direction'], RampObstacle['direction']> = {
  north: 'south', south: 'north', east: 'east', west: 'west'
};

/** Ramp counterpart of `mirrorLayout` (positions are the ramp centres). */
function mirrorRamps(entries: RampObstacle[]): RampObstacle[] {
  const out: RampObstacle[] = [];
  for (const r of entries) {
    const { x, y, z } = r.position;
    const mx = Math.abs(x) > 0.001;
    const mz = Math.abs(z) > 0.001;
    out.push(r);
    if (mx) out.push({ ...r, id: `${r.id}_w`, position: { x: -x, y, z }, direction: FLIP_X[r.direction] });
    if (mz) out.push({ ...r, id: `${r.id}_s`, position: { x, y, z: -z }, direction: FLIP_Z[r.direction] });
    if (mx && mz) {
      out.push({ ...r, id: `${r.id}_ws`, position: { x: -x, y, z: -z }, direction: FLIP_Z[FLIP_X[r.direction]] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Neon Downtown — 145 x 145
// A dusk city district: a stepped plaza, an arcade whose roof connects to an
// ---------------------------------------------------------------------------
// Neon Downtown — 145 x 145
// A dusk city district: a stepped plaza, an arcade whose roof connects to an
// office block by a skywalk, a hotel with an exterior fire-escape staircase,
// shop stalls, planters and shutter rows creating alleys at every level.
// ---------------------------------------------------------------------------
const DOWNTOWN_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(145),
  // 8-tier Central Metropolis Tower / Sky-Plaza (reaches massive 12.0m!)
  block('center_tower', 0, 0, 18, 18, 3.6),
  block('center_deck', 0, 0, 14, 14, 4.8, 3.6),
  block('center_concourse', 0, 0, 10, 10, 6.0, 4.8),
  block('center_observatory', 0, 0, 7, 7, 7.2, 6.0),
  block('center_balcony', 0, 0, 5, 5, 8.4, 7.2),
  block('center_penthouse', 0, 0, 3.6, 3.6, 9.6, 8.4),
  block('center_spire', 0, 0, 2.4, 2.4, 10.8, 9.6),
  block('center_finial', 0, 0, 1.4, 1.4, 12.0, 10.8),
  ...mirrorLayout([
    block('planter', 15, 15, 5, 5, R),
    // Arcade with mezzanine deck, upper floors and rooftop spire
    block('arcade', 46, 26, 18, 14, 4.8),
    block('arcade_deck', 34, 26, 6, 14, 3.6),
    block('arcade_mezzanine', 46, 26, 12, 10, 6.0, 4.8),
    block('arcade_vent', 50, 29, 6, 6, 7.2, 6.0),
    block('arcade_penthouse', 50, 29, 4, 4, 8.4, 7.2),
    block('arcade_spire', 50, 29, 2.4, 2.4, 9.6, 8.4),
    // Level 1 Skywalk linking arcade roof to office roof (with underpass below)
    ...bridge('skywalk', 46, 39.5, 5, 13, 4.8, [[46, 39.5]]),
    // Office skyscraper soaring to 12.0m
    block('office', 46, 52, 16, 12, 4.8),
    block('office_upper', 46, 52, 12, 10, 6.0, 4.8),
    block('office_roof', 46, 52, 8, 8, 7.2, 6.0),
    block('office_penthouse', 46, 52, 6, 6, 8.4, 7.2),
    block('office_helipad', 46, 52, 4, 4, 9.6, 8.4),
    block('office_comm_mast', 46, 52, 2.4, 2.4, 10.8, 9.6),
    block('office_spire', 46, 52, 1.2, 1.2, 12.0, 10.8),
    // Level 2 High Skybridge spanning from Hotel towards Office with underpass below
    ...bridge('hotel_skywalk', 31.5, 52, 13, 4, 6.0, [[31.5, 52]]),
    // Hotel tower with exterior fire-escape stairs and VIP penthouse
    block('hotel', 18, 52, 14, 12, 7.2),
    ...stairs('hotel_st', 11, 43.5, 'east', 5, 3, 5),
    block('hotel_penthouse', 18, 52, 9, 8, 8.4, 7.2),
    block('hotel_terrace', 18, 52, 6, 6, 9.6, 8.4),
    block('hotel_ac', 20, 53, 4, 4, 10.8, 9.6),
    block('hotel_antenna', 20, 53, 2, 2, 12.0, 10.8),
    // Alley furniture & sunken canal borders
    block('barrier_n', 0, 33, 24, 3, 2.4),
    block('lane_plat', 0, 50, 20, 10, R),
    block('lane_mid', 0, 50, 10, 6, 2.4),
    block('lane_wall', 0, 60, 14, 2, 3.6),
    block('lane_spire', 0, 60, 6, 2, 4.8, 3.6),
    block('cover_a', 28, 10, 6, 6, 2.4),
    block('cover_a_step', 28, 14.5, 6, 3, R),
    block('cover_b', 30, 44, 6, 6, 2.4),
    block('cover_b_step', 30, 39.5, 6, 3, R),
    // Base approach
    block('base_crate', 46, 8, 5, 5, 2.4),
    block('base_crate_step', 46, 12.5, 5, 4, R),
    block('base_rail', 53, 17, 8, 2, R),
    block('base_wing', 66, 15, 4, 12, 2.4),
    block('base_wing_step', 62, 18, 4, 4, R),
    // Market street & Corner Sniper Citadel
    block('stall', 60, 40, 8, 5, 2.4),
    block('stall_step', 60, 36, 8, 3, R),
    block('corner_tower', 60, 62, 8, 8, 3.6),
    block('corner_top', 60, 62, 6, 6, 4.8, 3.6),
    block('corner_mid', 60, 62, 4.8, 4.8, 6.0, 4.8),
    block('corner_perch', 60, 62, 3.6, 3.6, 7.2, 6.0),
    block('corner_nest', 60, 62, 2.6, 2.6, 8.4, 7.2),
    block('corner_spire', 60, 62, 1.8, 1.8, 9.6, 8.4),
    block('corner_beacon', 60, 62, 1.2, 1.2, 10.8, 9.6),
    block('corner_needle', 60, 62, 0.8, 0.8, 12.0, 10.8),
    block('dumpster', 34, 66, 6, 3, R),
    block('bench_row', 10, 66, 16, 2, R)
  ])
];

const DOWNTOWN_CLIMBABLES: ClimbableSurface[] = [
  ...perimeterClimbables(145),
  ...climbablePillar('center_tow', 0, 0, 18, 18, 3.6, 0),
  ...climbablePillar('center_deck_climb', 0, 0, 14, 14, 4.8, 3.6),
  ...climbablePillar('center_concourse_climb', 0, 0, 10, 10, 6.0, 4.8),
  ...climbablePillar('center_observatory_climb', 0, 0, 7, 7, 7.2, 6.0),
  ...climbablePillar('center_balcony_climb', 0, 0, 5, 5, 8.4, 7.2),
  ...climbablePillar('center_penthouse_climb', 0, 0, 3.6, 3.6, 9.6, 8.4),
  ...climbablePillar('center_spire_climb', 0, 0, 2.4, 2.4, 10.8, 9.6),
  ...climbablePillar('center_finial_climb', 0, 0, 1.4, 1.4, 12.0, 10.8),
  ...mirrorClimbables([
    ...climbablePillar('skywalk_pil', 46, 39.5, 2, 2, 3.6, 0),
    ...climbablePillar('hotel_sky_pil', 31.5, 52, 2, 2, 4.8, 0),
    ...climbablePillar('hotel_climb', 18, 52, 14, 12, 7.2, 0),
    ...climbablePillar('hotel_penthouse_climb', 18, 52, 9, 8, 8.4, 7.2),
    ...climbablePillar('hotel_terrace_climb', 18, 52, 6, 6, 9.6, 8.4),
    ...climbablePillar('office_climb', 46, 52, 16, 12, 4.8, 0),
    ...climbablePillar('office_upper_climb', 46, 52, 12, 10, 6.0, 4.8),
    ...climbablePillar('office_roof_climb', 46, 52, 8, 8, 7.2, 6.0),
    ...climbablePillar('office_penthouse_climb', 46, 52, 6, 6, 8.4, 7.2),
    ...climbablePillar('office_helipad_climb', 46, 52, 4, 4, 9.6, 8.4),
    ...climbablePillar('office_spire_climb', 46, 52, 1.2, 1.2, 12.0, 10.8),
    ...climbablePillar('hotel_ac_climb', 20, 53, 4, 4, 10.8, 9.6),
    ...climbablePillar('hotel_antenna_climb', 20, 53, 2, 2, 12.0, 10.8),
    ...climbablePillar('arcade_climb', 46, 26, 18, 14, 4.8, 0),
    ...climbablePillar('arcade_mezzanine_climb', 46, 26, 12, 10, 6.0, 4.8),
    ...climbablePillar('corner_climb', 60, 62, 8, 8, 3.6, 0),
    ...climbablePillar('corner_top_climb', 60, 62, 6, 6, 4.8, 3.6),
    ...climbablePillar('corner_mid_climb', 60, 62, 4.8, 4.8, 6.0, 4.8),
    ...climbablePillar('corner_perch_climb', 60, 62, 3.6, 3.6, 7.2, 6.0),
    ...climbablePillar('corner_nest_climb', 60, 62, 2.6, 2.6, 8.4, 7.2),
    ...climbablePillar('corner_spire_climb', 60, 62, 1.8, 1.8, 9.6, 8.4),
    ...climbablePillar('corner_beacon_climb', 60, 62, 1.2, 1.2, 10.8, 9.6),
    ...climbablePillar('corner_needle_climb', 60, 62, 0.8, 0.8, 12.0, 10.8)
  ])
];

const DOWNTOWN_RAMPS: RampObstacle[] = [
  ...mirrorRamps([
    ramp('ramp_plaza_x', 21, 0, 'west', 12, 3.6),
    ramp('ramp_plaza_z', 0, 21, 'north', 12, 3.6),
    ramp('ramp_arcade', 19, 26, 'east', 12, 3.6),
    ramp('ramp_corner', 44, 62, 'east', 12, 3.6)
  ])
];

// ---------------------------------------------------------------------------
// Cargo Docks — 185 x 185
// Colour-coded container stacks, a crane plaza, a warehouse with a roof ramp,
// a gantry skybridge across the base lane and a wooden pier on the harbour.
// ---------------------------------------------------------------------------
const CARGO_DOCKS_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(185),
  // Multi-tier Central Crane Rig with machinery decks up to 12.0m
  block('crane_base', 0, 0, 20, 20, 3.6),
  block('crane_machinery', 0, 0, 14, 14, 4.8, 3.6),
  block('crane_cabin', 0, 0, 10, 10, 6.0, 4.8),
  block('crane_gantry', 0, 0, 7, 7, 7.2, 6.0),
  block('crane_deck', 0, 0, 5, 5, 8.4, 7.2),
  block('crane_counter', 0, 0, 3.6, 3.6, 9.6, 8.4),
  block('crane_apex', 0, 0, 2.4, 2.4, 10.8, 9.6),
  box('crane_mast', 0, 6, 0, 3, 12, 3),
  ...mirrorLayout([
    // Container rows with 5-tier stacking
    block('cont_a1', 32, 14, 12, 3, 2.4),
    block('cont_a2', 44, 14, 12, 3, 2.4),
    block('cont_a_top', 38, 14, 12, 3, 3.6, 2.4),
    block('cont_a_step', 32, 11, 6, 3, R),
    block('cont_b1', 30, 30, 16, 3, 2.4),
    block('cont_b2', 30, 33, 16, 3, 2.4),
    block('cont_b_top', 35, 31.5, 6, 6, 3.6, 2.4),
    block('cont_b_peak', 35, 31.5, 4, 4, 4.8, 3.6),
    block('cont_b_tier3', 35, 31.5, 3.2, 3.2, 6.0, 4.8),
    block('cont_b_tier4', 35, 31.5, 2.4, 2.4, 7.2, 6.0),
    block('cont_b_tier5', 35, 31.5, 1.6, 1.6, 8.4, 7.2),
    block('cont_b_spire', 35, 31.5, 1.0, 1.0, 9.6, 8.4),
    block('crate_a', 24, 24, 6, 6, 2.4),
    block('crate_a_step', 24, 19.5, 6, 3, R),
    block('crate_top', 24, 24, 4, 4, 3.6, 2.4),
    block('mid_wall', 0, 36, 20, 3, 2.4),
    // Mega-Warehouse soaring to 12.0m with rooftop office, crow's nest & spire
    block('warehouse', 54, 50, 24, 16, 4.8),
    block('wh_upper', 54, 50, 16, 12, 6.0, 4.8),
    block('wh_office', 56, 50, 10, 8, 7.2, 6.0),
    block('wh_deck', 58, 52, 6, 6, 8.4, 7.2),
    block('wh_nest', 58, 52, 4, 4, 9.6, 8.4),
    block('wh_perch', 58, 52, 2.6, 2.6, 10.8, 9.6),
    block('wh_spire', 58, 52, 1.4, 1.4, 12.0, 10.8),
    // Gantry tower, high skybridge & underpass
    block('gantry_tower', 60, 26, 8, 6, 4.8),
    block('gantry_mid', 60, 26, 6, 5, 6.0, 4.8),
    block('gantry_deck_high', 60, 26, 4.2, 4, 7.2, 6.0),
    block('gantry_nest', 60, 26, 3, 3, 8.4, 7.2),
    block('gantry_apex', 60, 26, 2.2, 2.2, 9.6, 8.4),
    block('gantry_crane', 60, 26, 1.6, 1.6, 10.8, 9.6),
    block('gantry_spire', 60, 26, 1.0, 1.0, 12.0, 10.8),
    ...stairs('gantry_st', 47, 26, 'east', 3, 3, 6),
    ...bridge('gantry_deck', 60, 0, 5, 46, 4.8, [[60, 11.5]]),
    ...bridge('wh_skywalk', 60, 35.5, 4, 13, 4.8, [[60, 35.5]]),
    // Yard storage near the base
    block('yard_a', 74, 38, 10, 8, 2.4),
    block('yard_a_step', 74, 32.5, 10, 3, R),
    block('yard_b', 84, 28, 8, 10, 2.4),
    block('yard_b_step', 84, 21.5, 8, 3, R),
    block('base_cont', 84, 10, 6, 12, 2.4),
    block('base_cont_step', 84, 17.5, 6, 3, R),
    // Wooden pier on the harbour edge with maritime tower
    block('pier', 38, 80, 50, 12, R),
    block('pier_house', 24, 80, 8, 8, 3.6),
    block('pier_tower', 24, 80, 6, 6, 4.8, 3.6),
    block('pier_lantern', 24, 80, 4.6, 4.6, 6.0, 4.8),
    block('pier_gallery', 24, 80, 3.6, 3.6, 7.2, 6.0),
    block('pier_beacon', 24, 80, 2.4, 2.4, 8.4, 7.2),
    block('pier_spire', 24, 80, 1.6, 1.6, 9.6, 8.4),
    block('pier_needle', 24, 80, 1.0, 1.0, 10.8, 9.6),
    block('pier_finial', 24, 80, 0.6, 0.6, 12.0, 10.8),
    block('pier_st', 30, 80, 4, 8, 2.4),
    block('pier_crate', 48, 80, 6, 6, 2.4),
    block('jersey_a', 80, 60, 8, 2, R),
    block('jersey_b', 14, 66, 8, 2, R)
  ])
];

const CARGO_DOCKS_CLIMBABLES: ClimbableSurface[] = [
  ...perimeterClimbables(185),
  ...climbablePillar('crane_base_climb', 0, 0, 20, 20, 3.6, 0),
  ...climbablePillar('crane_mach_climb', 0, 0, 14, 14, 4.8, 3.6),
  ...climbablePillar('crane_cabin_climb', 0, 0, 10, 10, 6.0, 4.8),
  ...climbablePillar('crane_gantry_climb', 0, 0, 7, 7, 7.2, 6.0),
  ...climbablePillar('crane_deck_climb', 0, 0, 5, 5, 8.4, 7.2),
  ...climbablePillar('crane_counter_climb', 0, 0, 3.6, 3.6, 9.6, 8.4),
  ...climbablePillar('crane_apex_climb', 0, 0, 2.4, 2.4, 10.8, 9.6),
  ...climbablePillar('crane_mast_climb', 0, 0, 3, 3, 12.0, 0),
  ...mirrorClimbables([
    ...climbablePillar('gantry_pil', 60, 11.5, 2, 2, 3.6, 0),
    ...climbablePillar('wh_sky_pil', 60, 35.5, 2, 2, 3.6, 0),
    ...climbablePillar('gantry_tow', 60, 26, 8, 6, 4.8, 0),
    ...climbablePillar('gantry_mid_climb', 60, 26, 6, 5, 6.0, 4.8),
    ...climbablePillar('gantry_deck_high_climb', 60, 26, 4.2, 4, 7.2, 6.0),
    ...climbablePillar('gantry_nest_climb', 60, 26, 3, 3, 8.4, 7.2),
    ...climbablePillar('gantry_apex_climb', 60, 26, 2.2, 2.2, 9.6, 8.4),
    ...climbablePillar('gantry_spire_climb', 60, 26, 1.0, 1.0, 12.0, 10.8),
    ...climbablePillar('wh_wall', 54, 50, 24, 16, 4.8, 0),
    ...climbablePillar('wh_upper_climb', 54, 50, 16, 12, 6.0, 4.8),
    ...climbablePillar('wh_office_climb', 56, 50, 10, 8, 7.2, 6.0),
    ...climbablePillar('wh_deck_climb', 58, 52, 6, 6, 8.4, 7.2),
    ...climbablePillar('wh_nest_climb', 58, 52, 4, 4, 9.6, 8.4),
    ...climbablePillar('wh_perch_climb', 58, 52, 2.6, 2.6, 10.8, 9.6),
    ...climbablePillar('wh_spire_climb', 58, 52, 1.4, 1.4, 12.0, 10.8),
    ...climbablePillar('cont_stack', 35, 31.5, 6, 6, 3.6, 0),
    ...climbablePillar('cont_b_peak_climb', 35, 31.5, 4, 4, 4.8, 3.6),
    ...climbablePillar('cont_b_tier3_climb', 35, 31.5, 3.2, 3.2, 6.0, 4.8),
    ...climbablePillar('cont_b_tier4_climb', 35, 31.5, 2.4, 2.4, 7.2, 6.0),
    ...climbablePillar('cont_b_spire_climb', 35, 31.5, 1.0, 1.0, 9.6, 8.4),
    ...climbablePillar('pier_tower_climb', 24, 80, 6, 6, 4.8, 3.6),
    ...climbablePillar('pier_lantern_climb', 24, 80, 4.6, 4.6, 6.0, 4.8),
    ...climbablePillar('pier_gallery_climb', 24, 80, 3.6, 3.6, 7.2, 6.0),
    ...climbablePillar('pier_beacon_climb', 24, 80, 2.4, 2.4, 8.4, 7.2),
    ...climbablePillar('pier_spire_climb', 24, 80, 1.6, 1.6, 9.6, 8.4),
    ...climbablePillar('pier_needle_climb', 24, 80, 1.0, 1.0, 10.8, 9.6),
    ...climbablePillar('pier_finial_climb', 24, 80, 0.6, 0.6, 12.0, 10.8)
  ])
];

const CARGO_DOCKS_RAMPS: RampObstacle[] = [
  ...mirrorRamps([
    ramp('ramp_crane_x', 22, 0, 'west', 12, 3.6),
    ramp('ramp_crane_z', 0, 22, 'north', 12, 3.6),
    ramp('ramp_cont_b', 30, 20.5, 'south', 8, 2.4),
    ramp('ramp_wh', 26, 50, 'east', 16, 4.8, 5)
  ])
];

// ---------------------------------------------------------------------------
// Sky Rink — 130 x 130
// A neon rooftop skate park: a funbox centrepiece, launch ramps, grind rails,
// a stepped pyramid, VIP boxes and tiered stadium bleachers on the long edges.
// ---------------------------------------------------------------------------
const SKY_RINK_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(130),
  // Central Vert Mega-Tower soaring to 12.0m with stepped skate tiers
  block('rink_tower', 0, 0, 16, 16, 2.4),
  block('rink_deck', 0, 0, 12, 12, 3.6, 2.4),
  block('rink_stage', 0, 0, 8, 8, 4.8, 3.6),
  block('rink_nest', 0, 0, 6, 6, 6.0, 4.8),
  block('rink_perch', 0, 0, 4.6, 4.6, 7.2, 6.0),
  block('rink_crow', 0, 0, 3.4, 3.4, 8.4, 7.2),
  block('rink_pylon', 0, 0, 2.4, 2.4, 9.6, 8.4),
  block('rink_needle', 0, 0, 1.6, 1.6, 10.8, 9.6),
  block('rink_spire', 0, 0, 1.0, 1.0, 12.0, 10.8),
  ...mirrorLayout([
    // Launch ramp + landing platform
    block('launch_plat', 21, 26, 6, 6, 2.4),
    // Bank with multi-tier lip
    block('bank_plat', 43, 22, 10, 10, 2.4),
    block('bank_lip', 43, 22, 6, 6, 3.6, 2.4),
    block('bank_high', 43, 22, 4, 4, 4.8, 3.6),
    block('bank_spire', 43, 22, 2.4, 2.4, 6.0, 4.8),
    block('bank_finial', 43, 22, 1.2, 1.2, 7.2, 6.0),
    // 6-tier Stepped pyramid
    block('pyr_1', 40, 34, 12, 12, R),
    block('pyr_2', 40, 34, 8, 8, 2.4),
    block('pyr_3', 40, 34, 6, 6, 3.6),
    block('pyr_4', 40, 34, 4, 4, 4.8),
    block('pyr_5', 40, 34, 2.4, 2.4, 6.0),
    block('pyr_6', 40, 34, 1.2, 1.2, 7.2),
    // VIP Stadium Penthouse rising to 12.0m
    block('vip_box', 52, 50, 10, 10, 3.6),
    block('vip_deck', 52, 50, 8, 8, 4.8, 3.6),
    block('vip_mezzanine', 52, 50, 6, 6, 6.0, 4.8),
    block('vip_balcony', 52, 50, 4.6, 4.6, 7.2, 6.0),
    block('vip_nest', 52, 50, 3.4, 3.4, 8.4, 7.2),
    block('vip_penthouse', 52, 50, 2.4, 2.4, 9.6, 8.4),
    block('vip_antenna', 52, 50, 1.6, 1.6, 10.8, 9.6),
    block('vip_spire', 52, 50, 1.0, 1.0, 12.0, 10.8),
    // Stadium bleachers
    ...stairs('bleacher', 28, 46, 'south', 4, 4, 28),
    // Elevated Skybridge connecting Bleachers to VIP lounge with skater underpass below
    ...bridge('rink_skywalk', 44.5, 50, 5, 4, 4.8, [[44.5, 50]]),
    // Lane furniture and rails
    block('mid_block', 0, 36, 12, 3, 2.4),
    block('ring_n', 0, 26, 10, 3, 2.4),
    block('lane_island', 36, 10, 6, 6, 2.4),
    block('lane_island_step', 36, 14.5, 6, 3, R),
    block('rail_a', 22, 6, 10, 0.8, 0.6),
    block('rail_b', 10, 44, 0.8, 10, 0.6),
    block('rail_c', 56, 28, 0.8, 12, 0.6)
  ])
];

const SKY_RINK_CLIMBABLES: ClimbableSurface[] = [
  ...perimeterClimbables(130),
  ...climbablePillar('rink_tower_climb', 0, 0, 16, 16, 2.4, 0),
  ...climbablePillar('rink_deck_climb', 0, 0, 12, 12, 3.6, 2.4),
  ...climbablePillar('rink_stage_climb', 0, 0, 8, 8, 4.8, 3.6),
  ...climbablePillar('rink_nest_climb', 0, 0, 6, 6, 6.0, 4.8),
  ...climbablePillar('rink_perch_climb', 0, 0, 4.6, 4.6, 7.2, 6.0),
  ...climbablePillar('rink_crow_climb', 0, 0, 3.4, 3.4, 8.4, 7.2),
  ...climbablePillar('rink_pylon_climb', 0, 0, 2.4, 2.4, 9.6, 8.4),
  ...climbablePillar('rink_needle_climb', 0, 0, 1.6, 1.6, 10.8, 9.6),
  ...climbablePillar('rink_spire_climb', 0, 0, 1.0, 1.0, 12.0, 10.8),
  ...mirrorClimbables([
    ...climbablePillar('vip_box_climb', 52, 50, 10, 10, 3.6, 0),
    ...climbablePillar('vip_deck_climb', 52, 50, 8, 8, 4.8, 3.6),
    ...climbablePillar('vip_mezz_climb', 52, 50, 6, 6, 6.0, 4.8),
    ...climbablePillar('vip_balcony_climb', 52, 50, 4.6, 4.6, 7.2, 6.0),
    ...climbablePillar('vip_nest_climb', 52, 50, 3.4, 3.4, 8.4, 7.2),
    ...climbablePillar('vip_penthouse_climb', 52, 50, 2.4, 2.4, 9.6, 8.4),
    ...climbablePillar('vip_antenna_climb', 52, 50, 1.6, 1.6, 10.8, 9.6),
    ...climbablePillar('vip_spire_climb', 52, 50, 1.0, 1.0, 12.0, 10.8),
    ...climbablePillar('bank_climb', 43, 22, 10, 10, 2.4, 0),
    ...climbablePillar('bank_lip_climb', 43, 22, 6, 6, 3.6, 2.4),
    ...climbablePillar('bank_high_climb', 43, 22, 4, 4, 4.8, 3.6),
    ...climbablePillar('pyr_3_climb', 40, 34, 6, 6, 3.6, 2.4),
    ...climbablePillar('pyr_5_climb', 40, 34, 2.4, 2.4, 6.0, 4.8),
    ...climbablePillar('rink_sky_pil', 44.5, 50, 2, 2, 3.6, 0)
  ])
];

const SKY_RINK_RAMPS: RampObstacle[] = [
  ...mirrorRamps([
    ramp('ramp_rink_x', 16, 0, 'west', 8, 2.4),
    ramp('ramp_rink_z', 0, 16, 'north', 8, 2.4),
    ramp('ramp_launch', 10, 26, 'east', 8, 2.4),
    ramp('ramp_bank', 28, 22, 'east', 10, 2.4),
    ramp('ramp_vip', 52, 33, 'south', 12, 3.6)
  ])
];

// ---------------------------------------------------------------------------
// Aurora Outpost — 160 x 160
// Polar research station: a radome, lab modules joined by elevated tubes, a
// hangar with a roof ramp, fuel tanks, relay towers and packed-snow berms.
// ---------------------------------------------------------------------------
const AURORA_OUTPOST_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(160),
  // Polar Radome Complex with multi-tier geodesic observatory up to 12.0m
  block('center_radome', 0, 0, 22, 22, 3.6),
  block('radome_deck', 0, 0, 16, 16, 4.8, 3.6),
  block('radome_observatory', 0, 0, 12, 12, 6.0, 4.8),
  block('radome_telescope', 0, 0, 8, 8, 7.2, 6.0),
  block('radome_balcony', 0, 0, 6, 6, 8.4, 7.2),
  block('radome_dome', 0, 0, 4.6, 4.6, 9.6, 8.4),
  block('radome_pylon', 0, 0, 3.6, 3.6, 10.8, 9.6),
  box('radome_mast', 0, 6, 0, 3.5, 12, 3.5),
  ...mirrorLayout([
    block('antenna_row', 0, 40, 26, 3, 2.4),
    // Lab modules joined by elevated tube
    block('lab_a', 30, 26, 12, 12, 3.6),
    block('lab_a_roof', 30, 26, 6, 6, 4.8, 3.6),
    ...bridge('tube_ab', 30, 40, 4, 16, 3.6, [[30, 40]]),
    // Lab B Polar Citadel rising to 12.0m
    block('lab_b', 30, 54, 12, 12, 3.6),
    block('lab_b_roof', 30, 54, 8, 8, 4.8, 3.6),
    block('lab_b_deck', 30, 54, 6, 6, 6.0, 4.8),
    block('lab_b_nest', 30, 54, 4.6, 4.6, 7.2, 6.0),
    block('lab_b_observatory', 30, 54, 3.4, 3.4, 8.4, 7.2),
    block('lab_b_spire', 30, 54, 2.4, 2.4, 9.6, 8.4),
    block('lab_b_mast', 30, 54, 1.6, 1.6, 10.8, 9.6),
    block('lab_b_needle', 30, 54, 1.0, 1.0, 12.0, 10.8),
    // Polar skybridge connecting Lab B to Fuel Tank with rover underpass below
    ...bridge('polar_skybridge', 38.5, 57, 5, 4, 4.8, [[38.5, 57]]),
    // Mega Hangar & Air Traffic Control Spire
    block('hangar', 56, 34, 22, 14, 4.8),
    block('hangar_roof', 60, 34, 12, 10, 6.0, 4.8),
    block('hangar_control', 60, 34, 8, 8, 7.2, 6.0),
    block('hangar_nest', 60, 34, 5, 5, 8.4, 7.2),
    block('hangar_tower', 60, 34, 3.6, 3.6, 9.6, 8.4),
    block('hangar_radar', 60, 34, 2.4, 2.4, 10.8, 9.6),
    block('hangar_spire', 60, 34, 1.2, 1.2, 12.0, 10.8),
    // Thermal Core & Fuel Silo Complex
    block('tank', 46, 60, 10, 10, 3.6),
    block('tank_top', 46, 60, 7, 7, 4.8, 3.6),
    block('tank_silo', 46, 60, 5, 5, 6.0, 4.8),
    block('tank_spire', 46, 60, 3.6, 3.6, 7.2, 6.0),
    block('tank_beacon', 46, 60, 2.4, 2.4, 8.4, 7.2),
    block('tank_flare', 46, 60, 1.6, 1.6, 9.6, 8.4),
    block('tank_cap', 46, 60, 1.0, 1.0, 10.8, 9.6),
    // Relay + supply crates
    block('relay', 34, 8, 5, 5, 2.4),
    block('relay_step', 34, 12.5, 5, 4, R),
    block('crate_snow', 20, 46, 7, 7, 2.4),
    block('crate_snow_step', 20, 51, 7, 3, R),
    // Snow berms and spires
    block('berm_low', 20, 70, 16, 6, R),
    block('berm_top', 20, 70, 8, 4, 2.4),
    block('spire_base', 66, 58, 8, 8, R),
    block('spire', 66, 58, 3.6, 3.6, 4.8, R),
    // Base approach
    block('base_block', 66, 18, 8, 10, 2.4),
    block('base_step', 66, 11.5, 8, 3, R)
  ])
];

const AURORA_OUTPOST_CLIMBABLES: ClimbableSurface[] = [
  ...perimeterClimbables(160),
  ...climbablePillar('radome_climb', 0, 0, 22, 22, 3.6, 0),
  ...climbablePillar('radome_deck_climb', 0, 0, 16, 16, 4.8, 3.6),
  ...climbablePillar('radome_obs_climb', 0, 0, 12, 12, 6.0, 4.8),
  ...climbablePillar('radome_tele_climb', 0, 0, 8, 8, 7.2, 6.0),
  ...climbablePillar('radome_balcony_climb', 0, 0, 6, 6, 8.4, 7.2),
  ...climbablePillar('radome_dome_climb', 0, 0, 4.6, 4.6, 9.6, 8.4),
  ...climbablePillar('radome_pylon_climb', 0, 0, 3.6, 3.6, 10.8, 9.6),
  ...climbablePillar('radome_mast_climb', 0, 0, 3.5, 3.5, 12.0, 0),
  ...mirrorClimbables([
    ...climbablePillar('tube_pil', 30, 40, 2, 2, 2.4, 0),
    ...climbablePillar('polar_sky_pil', 38.5, 57, 2, 2, 3.6, 0),
    ...climbablePillar('lab_a_climb', 30, 26, 12, 12, 3.6, 0),
    ...climbablePillar('lab_b_climb', 30, 54, 12, 12, 3.6, 0),
    ...climbablePillar('lab_b_roof_climb', 30, 54, 8, 8, 4.8, 3.6),
    ...climbablePillar('lab_b_deck_climb', 30, 54, 6, 6, 6.0, 4.8),
    ...climbablePillar('lab_b_nest_climb', 30, 54, 4.6, 4.6, 7.2, 6.0),
    ...climbablePillar('lab_b_observatory_climb', 30, 54, 3.4, 3.4, 8.4, 7.2),
    ...climbablePillar('lab_b_spire_climb', 30, 54, 2.4, 2.4, 9.6, 8.4),
    ...climbablePillar('lab_b_needle_climb', 30, 54, 1.0, 1.0, 12.0, 10.8),
    ...climbablePillar('hangar_climb', 56, 34, 22, 14, 4.8, 0),
    ...climbablePillar('hangar_roof_climb', 60, 34, 12, 10, 6.0, 4.8),
    ...climbablePillar('hangar_ctrl_climb', 60, 34, 8, 8, 7.2, 6.0),
    ...climbablePillar('hangar_nest_climb', 60, 34, 5, 5, 8.4, 7.2),
    ...climbablePillar('hangar_tower_climb', 60, 34, 3.6, 3.6, 9.6, 8.4),
    ...climbablePillar('hangar_radar_climb', 60, 34, 2.4, 2.4, 10.8, 9.6),
    ...climbablePillar('hangar_spire_climb', 60, 34, 1.2, 1.2, 12.0, 10.8),
    ...climbablePillar('tank_climb', 46, 60, 10, 10, 3.6, 0),
    ...climbablePillar('tank_top_climb', 46, 60, 7, 7, 4.8, 3.6),
    ...climbablePillar('tank_silo_climb', 46, 60, 5, 5, 6.0, 4.8),
    ...climbablePillar('tank_spire_climb', 46, 60, 3.6, 3.6, 7.2, 6.0),
    ...climbablePillar('tank_beacon_climb', 46, 60, 2.4, 2.4, 8.4, 7.2),
    ...climbablePillar('tank_cap_climb', 46, 60, 1.0, 1.0, 10.8, 9.6)
  ])
];

const AURORA_OUTPOST_RAMPS: RampObstacle[] = [
  ...mirrorRamps([
    ramp('ramp_radome_x', 23, 0, 'west', 12, 3.6),
    ramp('ramp_radome_z', 0, 23, 'north', 12, 3.6),
    ramp('ramp_lab', 12, 26, 'east', 12, 3.6),
    ramp('ramp_hangar', 56, 11, 'south', 16, 4.8, 5),
    ramp('ramp_tank', 46, 43, 'south', 12, 3.6)
  ])
];

export const MAP_DEFS: Record<MapId, MapDef> = {
  downtown: {
    id: 'downtown',
    name: 'Neon Downtown',
    nameZh: '霓虹街区',
    nameJa: 'ネオン街区',
    description: 'Classic symmetric plaza with a tall center tower. Balanced lanes for every weapon.',
    descriptionZh: '经典对称街区广场，中央矗立高塔。各兵种均衡发挥的标准战场。',
    descriptionJa: '中央タワーがそびえる左右対称の広場。全武器が活躍するバランスマップ。',
    size: 145,
    obstacles: DOWNTOWN_OBSTACLES,
    ramps: DOWNTOWN_RAMPS,
    climbableSurfaces: DOWNTOWN_CLIMBABLES,
    paintSurfaces: paintSurfacesFor(145, { half: 9, top: 3.6 }, [
      paintWall('paint_arcade_n', 46, 2.4, 33, 18, 4.8, 0.1, 0, 0, 1),
      paintWall('paint_arcade_s', 46, 2.4, 19, 18, 4.8, 0.1, 0, 0, -1),
      paintWall('paint_office_n', 46, 2.4, 58, 16, 4.8, 0.1, 0, 0, 1),
      paintWall('paint_office_s', 46, 2.4, 46, 16, 4.8, 0.1, 0, 0, -1),
      paintWall('paint_hotel_e', 25, 3.6, 52, 0.1, 7.2, 12, 1, 0, 0),
      paintWall('paint_hotel_w', 11, 3.6, 52, 0.1, 7.2, 12, -1, 0, 0)
    ]),
    spawnX: spawnXForSize(145),
    zone: { x: 0, z: 0, w: 52, d: 38 },
    theme: {
      sky: 0x2a2250,
      fogColor: 0x4a3a6a,
      fogDensity: 0.0042,
      groundBase: 0x8a8d9c,
      groundAlt: 0x6f7282,
      wallColor: 0x6a6480,
      obstacleColor: 0x9a94b0,
      accentA: PINK_COLOR_HEX,
      accentB: CYAN_COLOR_HEX,
      sunColor: 0xffd0a8,
      sunIntensity: 1.9,
      hemiSky: 0xb8c4ff,
      hemiGround: 0x5a4668
    }
  },
  cargo_docks: {
    id: 'cargo_docks',
    name: 'Cargo Docks',
    nameZh: '码头货柜',
    nameJa: '貨物ドック',
    description: 'The largest arena: stacked shipping containers, a crane mast and long sightlines.',
    descriptionZh: '最大的竞技场：集装箱堆叠如山，吊车耸立，超长射线视野。',
    descriptionJa: '最大のアリーナ。積み重なるコンテナとクレーン、長い射线が特徴。',
    size: 185,
    obstacles: CARGO_DOCKS_OBSTACLES,
    ramps: CARGO_DOCKS_RAMPS,
    climbableSurfaces: CARGO_DOCKS_CLIMBABLES,
    paintSurfaces: paintSurfacesFor(185, { half: 10, top: 3.6 }, [
      paintWall('paint_wh_n', 54, 2.4, 58, 24, 4.8, 0.1, 0, 0, 1),
      paintWall('paint_wh_s', 54, 2.4, 42, 24, 4.8, 0.1, 0, 0, -1)
    ]),
    spawnX: spawnXForSize(185),
    zone: { x: 0, z: 0, w: 62, d: 46 },
    theme: {
      sky: 0x6a5a68,
      fogColor: 0x9a8272,
      fogDensity: 0.0036,
      groundBase: 0x9c9486,
      groundAlt: 0x857e70,
      wallColor: 0x7a6a58,
      obstacleColor: 0xb0a090,
      accentA: 0xffa629,
      accentB: 0x35c4d8,
      sunColor: 0xffc890,
      sunIntensity: 2.1,
      hemiSky: 0xffe3c0,
      hemiGround: 0x5a4a3a
    }
  },
  sky_rink: {
    id: 'sky_rink',
    name: 'Sky Rink',
    nameZh: '天际滑场',
    nameJa: 'スカイリンク',
    description: 'Compact neon rooftop rink. Fast respawns of close-quarters chaos.',
    descriptionZh: '紧凑的霓虹天台滑场，近身混战一触即发。',
    descriptionJa: 'コンパクトなネオン屋上リンク。近距離の激戦が絶えない。',
    size: 130,
    obstacles: SKY_RINK_OBSTACLES,
    ramps: SKY_RINK_RAMPS,
    climbableSurfaces: SKY_RINK_CLIMBABLES,
    paintSurfaces: paintSurfacesFor(130, { half: 8, top: 2.4 }, [
      paintWall('paint_vip_n', 52, 1.8, 55, 10, 3.6, 0.1, 0, 0, 1),
      paintWall('paint_vip_s', 52, 1.8, 45, 10, 3.6, 0.1, 0, 0, -1)
    ]),
    spawnX: spawnXForSize(130),
    zone: { x: 0, z: 0, w: 48, d: 34 },
    theme: {
      sky: 0x1c2460,
      fogColor: 0x3a3f8a,
      fogDensity: 0.0048,
      groundBase: 0x7a82c0,
      groundAlt: 0x646cac,
      wallColor: 0x4a4f94,
      obstacleColor: 0x8a90d8,
      accentA: 0x9d5cff,
      accentB: 0x2ee6a8,
      sunColor: 0xd8e4ff,
      sunIntensity: 1.7,
      hemiSky: 0x9fb4ff,
      hemiGround: 0x3a3f78
    }
  },
  aurora_outpost: {
    id: 'aurora_outpost',
    name: 'Aurora Outpost',
    nameZh: '极光哨站',
    nameJa: 'オーロラ前哨',
    description: 'Polar research station under drifting aurora light. Open snow broken by masts and hangars.',
    descriptionZh: '极光笼罩的极地科考哨站。开阔雪原上散布着天线塔与机库。',
    descriptionJa: 'オーロラが揺れる極地の研究拠点。広い雪原に鉄塔と格納庫が点在する。',
    size: 160,
    obstacles: AURORA_OUTPOST_OBSTACLES,
    ramps: AURORA_OUTPOST_RAMPS,
    climbableSurfaces: AURORA_OUTPOST_CLIMBABLES,
    paintSurfaces: paintSurfacesFor(160, { half: 11, top: 3.6 }, [
      paintWall('paint_hangar_n', 56, 2.4, 41, 22, 4.8, 0.1, 0, 0, 1),
      paintWall('paint_hangar_s', 56, 2.4, 27, 22, 4.8, 0.1, 0, 0, -1)
    ]),
    spawnX: spawnXForSize(160),
    zone: { x: 0, z: 0, w: 56, d: 42 },
    theme: {
      sky: 0x10304a,
      fogColor: 0x5a8aa8,
      fogDensity: 0.0042,
      groundBase: 0xcfdde8,
      groundAlt: 0xb4c6d6,
      wallColor: 0x5a7a90,
      obstacleColor: 0x8aa8c0,
      accentA: 0x54ffd0,
      accentB: 0x8a7dff,
      sunColor: 0xeaf2ff,
      sunIntensity: 1.8,
      hemiSky: 0xb8e0ff,
      hemiGround: 0x4a6a80
    }
  }
};

export const DEFAULT_MAP_ID: MapId = 'downtown';

export function isValidMapId(id: unknown): id is MapId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MAP_DEFS, id);
}

export function getMapDef(id?: string | null): MapDef {
  return isValidMapId(id) ? MAP_DEFS[id] : MAP_DEFS[DEFAULT_MAP_ID];
}

export function getSpawnPosition(team: Team, slotIndex = 0, spawnX = 40): Vec3 {
  const zOffset = SPAWN_Z_OFFSETS[slotIndex % SPAWN_Z_OFFSETS.length] ?? 0;
  if (team === Team.PINK) {
    return { x: -spawnX, y: 1.0, z: zOffset };
  }
  return { x: spawnX, y: 1.0, z: zOffset };
}

/** Kept for backward compatibility with the original single-map layout. */
export const ARENA_OBSTACLES: BoxObstacle[] = DOWNTOWN_OBSTACLES;
export const LEGACY_ARENA_SIZE: number = ARENA_SIZE;
