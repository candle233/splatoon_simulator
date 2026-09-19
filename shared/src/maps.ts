import { ARENA_SIZE, CYAN_COLOR_HEX, PINK_COLOR_HEX } from './config.js';
import { Team } from './types.js';
import type { BoxObstacle, MapId, Vec3 } from './types.js';

export const ARENA_WALL_HEIGHT = 5.0;

export const SPAWN_Z_OFFSETS = [-6, -2, 2, 6];

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

const DOWNTOWN_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(100),
  // Center Main Platform
  box('center_tower', 0, 1.5, 0, 14, 3, 14),
  // Center Side Barriers
  box('barrier_north', 0, 1.0, 18, 16, 2, 3),
  box('barrier_south', 0, 1.0, -18, 16, 2, 3),
  // Symmetric Midfield Cover Blocks
  box('cover_nw', -18, 1.25, 12, 6, 2.5, 6),
  box('cover_se', 18, 1.25, -12, 6, 2.5, 6),
  box('cover_sw', -18, 1.25, -12, 6, 2.5, 6),
  box('cover_ne', 18, 1.25, 12, 6, 2.5, 6),
  // Flank Ramps / Platforms
  box('flank_nw', -30, 0.75, 20, 8, 1.5, 12),
  box('flank_se', 30, 0.75, -20, 8, 1.5, 12),
  box('flank_sw', -30, 0.75, -20, 8, 1.5, 12),
  box('flank_ne', 30, 0.75, 20, 8, 1.5, 12)
];

const CARGO_DOCKS_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(124),
  // Crane base platform in the middle
  box('crane_base', 0, 1.5, 0, 16, 3, 16),
  box('crane_mast', 0, 6, 0, 2.5, 9, 2.5),
  // Long container rows north / south
  box('cont_n_w', -24, 1.3, 26, 12, 2.6, 5),
  box('cont_n_m', 0, 1.3, 26, 12, 2.6, 5),
  box('cont_n_e', 24, 1.3, 26, 12, 2.6, 5),
  box('cont_s_w', -24, 1.3, -26, 12, 2.6, 5),
  box('cont_s_m', 0, 1.3, -26, 12, 2.6, 5),
  box('cont_s_e', 24, 1.3, -26, 12, 2.6, 5),
  // Double-stacked containers on the east / west lanes
  box('stack_w1', -36, 1.3, 10, 5, 2.6, 11),
  box('stack_w2', -36, 3.9, 10, 5, 2.6, 11),
  box('stack_e1', 36, 1.3, -10, 5, 2.6, 11),
  box('stack_e2', 36, 3.9, -10, 5, 2.6, 11),
  box('stack_w3', -36, 1.3, -12, 5, 2.6, 8),
  box('stack_e3', 36, 1.3, 12, 5, 2.6, 8),
  // Scattered crates near midfield
  box('crate_n', -14, 1.3, 12, 4, 2.6, 4),
  box('crate_s', 14, 1.3, -12, 4, 2.6, 4),
  box('crate_w', -14, 1.3, -14, 4, 2.6, 4),
  box('crate_e', 14, 1.3, 14, 4, 2.6, 4),
  // Dock ramps near each base
  box('dock_nw', -46, 0.75, 26, 9, 1.5, 13),
  box('dock_se', 46, 0.75, -26, 9, 1.5, 13),
  box('dock_sw', -46, 0.75, -26, 9, 1.5, 13),
  box('dock_ne', 46, 0.75, 26, 9, 1.5, 13)
];

const SKY_RINK_OBSTACLES: BoxObstacle[] = [
  ...perimeterWalls(92),
  // Center tower + halo posts
  box('rink_tower', 0, 1.5, 0, 12, 3, 12),
  box('post_n', 0, 1.0, 10, 2, 2, 2),
  box('post_s', 0, 1.0, -10, 2, 2, 2),
  // Inner ring of cover blocks
  box('ring_nw', -14, 1.25, 14, 5, 2.5, 5),
  box('ring_ne', 14, 1.25, 14, 5, 2.5, 5),
  box('ring_sw', -14, 1.25, -14, 5, 2.5, 5),
  box('ring_se', 14, 1.25, -14, 5, 2.5, 5),
  box('ring_n', 0, 1.25, 21, 7, 2.5, 4),
  box('ring_s', 0, 1.25, -21, 7, 2.5, 4),
  box('ring_w', -21, 1.25, 0, 4, 2.5, 7),
  box('ring_e', 21, 1.25, 0, 4, 2.5, 7),
  // Corner bumpers
  box('bumper_nw', -32, 1.25, 30, 6, 2.5, 6),
  box('bumper_ne', 32, 1.25, 30, 6, 2.5, 6),
  box('bumper_sw', -32, 1.25, -30, 6, 2.5, 6),
  box('bumper_se', 32, 1.25, -30, 6, 2.5, 6),
  // Skate rails guarding each base
  box('rail_w', -34, 0.5, 14, 4, 1, 9),
  box('rail_e', 34, 0.5, -14, 4, 1, 9),
  // Quarter-pipe ramps
  box('pipe_nw', -30, 0.75, 34, 8, 1.5, 9),
  box('pipe_se', 30, 0.75, -34, 8, 1.5, 9)
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
    size: 100,
    obstacles: DOWNTOWN_OBSTACLES,
    spawnX: 40,
    zone: { x: 0, z: 0, w: 36, d: 26 },
    theme: {
      sky: 0x0f1118,
      fogColor: 0x0f1118,
      fogDensity: 0.007,
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
    size: 124,
    obstacles: CARGO_DOCKS_OBSTACLES,
    spawnX: 50,
    zone: { x: 0, z: 0, w: 42, d: 32 },
    theme: {
      sky: 0x2a1e33,
      fogColor: 0x2a1e33,
      fogDensity: 0.006,
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
    size: 92,
    obstacles: SKY_RINK_OBSTACLES,
    spawnX: 36,
    zone: { x: 0, z: 0, w: 34, d: 24 },
    theme: {
      sky: 0x0b0f2a,
      fogColor: 0x0b0f2a,
      fogDensity: 0.008,
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
