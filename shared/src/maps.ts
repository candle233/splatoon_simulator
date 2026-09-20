import { ARENA_SIZE, CYAN_COLOR_HEX, PINK_COLOR_HEX } from './config.js';
import { Team } from './types.js';
import type { BoxObstacle, MapId, Vec3 } from './types.js';

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
  /** |x| of both team spawn rows. */
  spawnX: number;
  zone: ZoneRect;
  theme: MapTheme;
}

function perimeterWalls(size: number): BoxObstacle[] {
  const half = size / 2;
  const len = size + 2;
  const z = half + 1;
  return [
    { id: 'wall_north', position: { x: 0, y: 2.5, z }, size: { x: len, y: 5, z: 2 } },
    { id: 'wall_south', position: { x: 0, y: 2.5, z: -z }, size: { x: len, y: 5, z: 2 } },
    { id: 'wall_east', position: { x: z, y: 2.5, z: 0 }, size: { x: 2, y: 5, z: len } },
    { id: 'wall_west', position: { x: -z, y: 2.5, z: 0 }, size: { x: 2, y: 5, z: len } }
  ];
}

function box(id: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): BoxObstacle {
  return { id, position: { x, y, z }, size: { x: sx, y: sy, z: sz } };
}

/** A ground-level riser of `STEP_RISE` height, authored as a climbable stair step. */
function step(id: string, x: number, z: number, sx: number, sz: number): BoxObstacle {
  return box(id, x, STEP_RISE / 2, z, sx, STEP_RISE, sz);
}

/**
 * Replicates a half-layout across the arena's X and Z axes so every map is
 * symmetric under both mirrors — and therefore under a 180° rotation, the
 * property that keeps the two team halves competitively identical.
 *
 * Author each entry in the +X half; the helper emits the west (`_w`), south
 * (`_s`) and south-west (`_ws`) copies. Entries sitting on an axis only get the
 * copies that actually move them, so nothing is duplicated.
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

// ---------------------------------------------------------------------------
// Neon Downtown — 145 x 145
// Central plaza, mid barriers, raised lane platforms and climbable flank decks.
// ---------------------------------------------------------------------------
const DOWNTOWN_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(145),
  // Central plaza: tower crowned by a smaller deck
  box('center_tower', 0, 1.5, 0, 18, 3, 18),
  box('center_deck', 0, 3.6, 0, 10, STEP_RISE, 10),
  ...mirrorLayout([
    // Plaza shoulders: low enough to climb and fight from
    step('plaza_step', 13, 13, 8, 8),
    step('plaza_ledge', 14, 0, 8, 14),
    // Mid barriers closing the north / south lanes
    box('barrier_n', 0, 1.0, 27, 24, 2, 3),
    // Midfield cover clusters, each with a riser to climb it
    box('cover_a', 24, 1.2, 21, 8, 2 * STEP_RISE, 8),
    step('cover_a_step', 24, 28.5, 8, 7),
    box('cover_c', 36, 1.2, 36, 7, 2 * STEP_RISE, 7),
    step('cover_c_step', 36, 42, 7, 5),
    // Raised lane platform with blocks on top
    step('lane_plat', 0, 46, 32, 12),
    box('lane_block', 12, 1.8, 46, 7, STEP_RISE, 7),
    box('lane_block_mid', 0, 1.8, 46, 6, STEP_RISE, 6),
    // Flank route: deck -> upper deck -> lookout pillar
    step('flank_deck', 48, 22, 14, 20),
    box('flank_upper', 48, 1.8, 22, 8, STEP_RISE, 10),
    box('flank_pillar', 48, 3.0, 22, 2.4, STEP_RISE, 2.4),
    // Side lane cover
    box('mid_cover', 44, 1.2, 10, 6, 2 * STEP_RISE, 10),
    step('mid_cover_step', 44, 16, 6, 5),
    step('planter', 30, 12, 4, 4),
    // Base approach
    box('base_cover', 60, 1.2, 22, 9, 2 * STEP_RISE, 7),
    box('base_wing', 68, 1.2, 14, 5, 2 * STEP_RISE, 12),
    box('side_stall', 30, 1.2, 60, 8, 2 * STEP_RISE, 6)
  ])
];

// ---------------------------------------------------------------------------
// Cargo Docks — 185 x 185
// Long container rows, three-tier container towers, a crane plaza and piers.
// ---------------------------------------------------------------------------
const CARGO_DOCKS_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(185),
  // Crane plaza in the middle
  box('crane_base', 0, 1.5, 0, 20, 3, 20),
  box('crane_mast', 0, 7.5, 0, 3, 9, 3),
  ...mirrorLayout([
    // Long container rows across the north / south lanes
    box('cont_row_mid', 0, 1.2, 44, 18, 2 * STEP_RISE, 6),
    box('cont_row_side', 36, 1.2, 44, 18, 2 * STEP_RISE, 6),
    step('cont_row_step', 36, 50, 10, 5),
    // Three-tier container tower on the east / west lanes
    box('stack_low', 54, 1.2, 16, 7, 2 * STEP_RISE, 16),
    step('stack_step', 47, 16, 7, 10),
    box('stack_mid', 54, 3.0, 16, 6, STEP_RISE, 12),
    box('stack_high', 54, 4.2, 16, 7, STEP_RISE, 14),
    // Midfield crates, one of them double-stacked
    box('crate_a', 22, 1.2, 22, 6, 2 * STEP_RISE, 6),
    step('crate_a_step', 22, 27, 6, 5),
    box('crate_top', 22, 3.0, 22, 5, STEP_RISE, 5),
    box('crate_b', 30, 1.2, 4, 5, 2 * STEP_RISE, 5),
    step('crate_b_step', 30, 0, 5, 5),
    // Midfield low wall
    box('mid_wall', 0, 1.0, 30, 20, 2, 3),
    // Dock ramp running along each base side
    step('dock_ramp', 74, 40, 14, 22),
    // North / south pier deck with a block on top
    step('pier_plat', 44, 66, 26, 12),
    box('pier_block', 50, 1.8, 66, 8, STEP_RISE, 8),
    // Yard storage behind the pier
    box('yard_block', 66, 1.2, 62, 12, 2 * STEP_RISE, 8),
    step('yard_step', 66, 55, 10, 5),
    // Gantry footings near the base
    box('gantry_foot', 84, 1.2, 10, 8, 2 * STEP_RISE, 8),
    // Base approach containers
    box('base_cont', 74, 1.2, 24, 14, 2 * STEP_RISE, 6)
  ])
];

// ---------------------------------------------------------------------------
// Sky Rink — 130 x 130
// Compact neon rooftop: a tight ring of cover, banks, rails and corner pipes.
// ---------------------------------------------------------------------------
const SKY_RINK_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(130),
  // Centre tower + upper deck
  box('rink_tower', 0, 1.5, 0, 16, 3, 16),
  box('rink_deck', 0, 3.6, 0, 9, STEP_RISE, 9),
  ...mirrorLayout([
    // Inner ring of ledges and cover blocks
    step('ledge_diag', 14, 14, 8, 8),
    box('ring_diag', 22, 1.2, 22, 6, 2 * STEP_RISE, 6),
    step('ring_diag_step', 22, 27, 6, 4),
    box('ring_n', 0, 1.2, 28, 10, 2 * STEP_RISE, 5),
    step('ring_n_step', 0, 32, 8, 4),
    box('ring_e', 28, 1.2, 0, 5, 2 * STEP_RISE, 10),
    step('ring_e_step', 32.5, 0, 5, 8),
    // Skate banks: low ramp with a raised lip
    step('bank_low', 36, 32, 12, 12),
    box('bank_high', 36, 1.8, 32, 7, STEP_RISE, 7),
    // Corner bumpers with an approach riser
    box('bumper', 46, 1.2, 44, 8, 2 * STEP_RISE, 8),
    step('bumper_step', 46, 38, 6, 4),
    // Skate rails guarding the lanes
    box('rail', 42, 0.3, 16, 5, 0.6, 14),
    // Quarter-pipe ramps
    step('pipe', 44, 54, 12, 12),
    // Mid-line block
    box('mid_block', 0, 1.2, 38, 12, 2 * STEP_RISE, 5),
    // Base-side rails and blocks
    box('base_rail', 52, 0.3, 14, 4, 0.6, 12),
    box('base_block', 56, 1.2, 24, 8, 2 * STEP_RISE, 7)
  ])
];

// ---------------------------------------------------------------------------
// Aurora Outpost — 160 x 160
// Polar research station: open snowfield, radome, antenna arrays and hangars.
// ---------------------------------------------------------------------------
const AURORA_OUTPOST_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(160),
  // Central radome with a mast
  box('center_radome', 0, 1.5, 0, 22, 3, 22),
  box('radome_mast', 0, 7, 0, 3.5, 8, 3.5),
  ...mirrorLayout([
    // Low footing steps on the radome shoulders
    step('radome_foot', 16, 16, 9, 9),
    // Antenna rows spanning the north / south lanes
    box('antenna_row', 0, 1.0, 36, 26, 2, 4),
    step('antenna_step', 0, 40, 20, 4),
    // Snow berms with a packed crest
    step('berm_low', 30, 26, 14, 12),
    box('berm_high', 30, 1.8, 26, 8, STEP_RISE, 7),
    // Hangars with a walkable roof
    box('hangar_low', 58, 1.2, 30, 20, 2 * STEP_RISE, 14),
    step('hangar_step', 58, 40, 12, 5),
    box('hangar_roof', 58, 3.0, 30, 15, STEP_RISE, 10),
    // Coolant pipe run along the north / south walls
    box('pipe_run', 0, 1.2, 60, 34, 2 * STEP_RISE, 4),
    step('pipe_step', 0, 64, 24, 4),
    // Coolant stacks
    box('coolant', 44, 1.2, 54, 7, 2 * STEP_RISE, 7),
    step('coolant_step', 44, 48, 6, 5),
    // Supply crates
    box('crate_snow', 20, 1.2, 46, 7, 2 * STEP_RISE, 7),
    step('crate_snow_step', 20, 52, 6, 5),
    // Relay towers on the inner lanes
    box('relay_tower', 30, 1.2, 8, 5, 2 * STEP_RISE, 5),
    step('relay_step', 30, 2, 5, 5),
    // Snow fences guarding the flank lane
    box('snow_fence', 74, 1.0, 40, 6, 2, 14),
    // Base approach: cover block plus a raised step in front of each spawn
    box('base_block', 64, 1.2, 14, 11, 2 * STEP_RISE, 7),
    step('base_step', 50, 0, 10, 16)
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
    spawnX: spawnXForSize(145),
    zone: { x: 0, z: 0, w: 52, d: 38 },
    theme: {
      sky: 0x0f1118,
      fogColor: 0x0f1118,
      fogDensity: 0.006,
      groundBase: 0x3a3d4a,
      groundAlt: 0x32353f,
      wallColor: 0x23252e,
      obstacleColor: 0x2a2d38,
      accentA: PINK_COLOR_HEX,
      accentB: CYAN_COLOR_HEX,
      sunColor: 0xfff5ea,
      sunIntensity: 1.35,
      hemiSky: 0xffffff,
      hemiGround: 0x222233
    }
  },
  cargo_docks: {
    id: 'cargo_docks',
    name: 'Cargo Docks',
    nameZh: '码头货柜',
    nameJa: '貨物ドック',
    description: 'The largest arena: stacked shipping containers, a crane mast and long sightlines.',
    descriptionZh: '最大的竞技场：集装箱堆叠如山，吊车耸立，超长射线视野。',
    descriptionJa: '最大のアリーナ。積み重なるコンテナとクレーン、長い射線が特徴。',
    size: 185,
    obstacles: CARGO_DOCKS_OBSTACLES,
    spawnX: spawnXForSize(185),
    zone: { x: 0, z: 0, w: 62, d: 46 },
    theme: {
      sky: 0x2a1e33,
      fogColor: 0x2a1e33,
      fogDensity: 0.005,
      groundBase: 0x4a4438,
      groundAlt: 0x413c31,
      wallColor: 0x35302a,
      obstacleColor: 0x50483a,
      accentA: 0xffa629,
      accentB: 0x35c4d8,
      sunColor: 0xffd9a0,
      sunIntensity: 1.5,
      hemiSky: 0xffe3c0,
      hemiGround: 0x33291f
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
    spawnX: spawnXForSize(130),
    zone: { x: 0, z: 0, w: 48, d: 34 },
    theme: {
      sky: 0x0b0f2a,
      fogColor: 0x0b0f2a,
      fogDensity: 0.0065,
      groundBase: 0x2c3050,
      groundAlt: 0x262a46,
      wallColor: 0x1d2140,
      obstacleColor: 0x34396b,
      accentA: 0x9d5cff,
      accentB: 0x2ee6a8,
      sunColor: 0xcfe0ff,
      sunIntensity: 1.2,
      hemiSky: 0x8fa8ff,
      hemiGround: 0x191d38
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
    spawnX: spawnXForSize(160),
    zone: { x: 0, z: 0, w: 56, d: 42 },
    theme: {
      sky: 0x081722,
      fogColor: 0x0d2130,
      fogDensity: 0.0058,
      groundBase: 0x93a6b4,
      groundAlt: 0x7f93a3,
      wallColor: 0x2b3b48,
      obstacleColor: 0x3d5566,
      accentA: 0x54ffd0,
      accentB: 0x8a7dff,
      sunColor: 0xdfeaff,
      sunIntensity: 1.15,
      hemiSky: 0xa8d8ff,
      hemiGround: 0x1a2b36
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
