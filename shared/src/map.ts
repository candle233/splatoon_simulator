import { BoxObstacle, Team, Vec3 } from './types.js';

export const ARENA_WALL_HEIGHT = 5.0;

export const ARENA_OBSTACLES: BoxObstacle[] = [
  // Perimeter Walls
  { id: 'wall_north', position: { x: 0, y: 2.5, z: 50 }, size: { x: 102, y: 5, z: 2 } },
  { id: 'wall_south', position: { x: 0, y: 2.5, z: -50 }, size: { x: 102, y: 5, z: 2 } },
  { id: 'wall_east', position: { x: 50, y: 2.5, z: 0 }, size: { x: 2, y: 5, z: 102 } },
  { id: 'wall_west', position: { x: -50, y: 2.5, z: 0 }, size: { x: 2, y: 5, z: 102 } },

  // Center Main Platform
  { id: 'center_tower', position: { x: 0, y: 1.5, z: 0 }, size: { x: 14, y: 3, z: 14 } },

  // Center Side Barriers
  { id: 'barrier_north', position: { x: 0, y: 1.0, z: 18 }, size: { x: 16, y: 2, z: 3 } },
  { id: 'barrier_south', position: { x: 0, y: 1.0, z: -18 }, size: { x: 16, y: 2, z: 3 } },

  // Symmetric Midfield Cover Blocks
  { id: 'cover_nw', position: { x: -18, y: 1.25, z: 12 }, size: { x: 6, y: 2.5, z: 6 } },
  { id: 'cover_se', position: { x: 18, y: 1.25, z: -12 }, size: { x: 6, y: 2.5, z: 6 } },
  { id: 'cover_sw', position: { x: -18, y: 1.25, z: -12 }, size: { x: 6, y: 2.5, z: 6 } },
  { id: 'cover_ne', position: { x: 18, y: 1.25, z: 12 }, size: { x: 6, y: 2.5, z: 6 } },

  // Flank Ramps / Platforms
  { id: 'flank_nw', position: { x: -30, y: 0.75, z: 20 }, size: { x: 8, y: 1.5, z: 12 } },
  { id: 'flank_se', position: { x: 30, y: 0.75, z: -20 }, size: { x: 8, y: 1.5, z: 12 } },
  { id: 'flank_sw', position: { x: -30, y: 0.75, z: -20 }, size: { x: 8, y: 1.5, z: 12 } },
  { id: 'flank_ne', position: { x: 30, y: 0.75, z: 20 }, size: { x: 8, y: 1.5, z: 12 } }
];

export const SPAWN_Z_OFFSETS = [-6, -2, 2, 6];

export function getSpawnPosition(team: Team, slotIndex = 0): Vec3 {
  const zOffset = SPAWN_Z_OFFSETS[slotIndex % SPAWN_Z_OFFSETS.length] ?? 0;
  if (team === Team.PINK) {
    return { x: -40, y: 1.0, z: zOffset };
  } else {
    return { x: 40, y: 1.0, z: zOffset };
  }
}
