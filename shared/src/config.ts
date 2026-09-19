export const PROTOCOL_VERSION = 1;

export const TICK_RATE = 20;
export const FIXED_DT = 1 / TICK_RATE; // 0.05s

export const ARENA_SIZE = 100;
export const ARENA_HALF_SIZE = ARENA_SIZE / 2; // 50

export const RUN_SPEED = 6.0;
export const SQUID_SPEED = RUN_SPEED * 1.8; // 10.8
export const ENEMY_INK_SPEED = RUN_SPEED * 0.3; // 1.8

export const JUMP_VELOCITY = 7.5;
export const GRAVITY = -20.0;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.5;
export const SQUID_HEIGHT = 0.5;

export const FIRE_RATE = 10; // shots/sec
export const FIRE_INTERVAL = 1 / FIRE_RATE; // 0.1s
export const WEAPON_DAMAGE = 25;
export const WEAPON_RANGE = 50.0;
export const WEAPON_SPREAD = 0.035;

export const MAX_HP = 100;
export const MAX_INK = 100;
export const INK_COST = 2;

export const INK_REGEN_NORMAL = 10.0; // /s
export const INK_REGEN_SQUID = 30.0; // /s
export const INK_REGEN_DELAY = 0.5; // s

export const HEALTH_REGEN_DELAY = 3.0; // s
export const HEALTH_REGEN_RATE = 20.0; // /s

export const ENEMY_INK_DOT = 15.0; // HP/s

export const RESPAWN_TIME = 4.0; // s
export const INVULNERABILITY_TIME = 2.0; // s

/** Server stops honoring held keys from an input older than this (client frozen/disconnected). */
export const INPUT_STALE_MS = 500;

export const COUNTDOWN_DURATION = 3.0; // s
export const MATCH_DURATION = 180.0; // s
export const GAME_OVER_DURATION = 8.0; // s

export const MAX_PLAYERS = 8;
export const TEAM_SIZE = 4;

export const PAINT_GRID_RES = 1024;
export const CANVAS_RES = 2048;

export const PAINT_RADIUS_WORLD = 2.2;
export const DEATH_PAINT_RADIUS_WORLD = 5.5;

export const MAX_PAINT_EVENTS_PER_MATCH = 30000;
export const PAINT_HISTORY_CHUNK_SIZE = 500;

export const PINK_COLOR_HEX = 0xff007f;
export const CYAN_COLOR_HEX = 0x00ffff;
export const NEUTRAL_COLOR_HEX = 0x666666;

export const PINK_COLOR_CSS = '#FF007F';
export const CYAN_COLOR_CSS = '#00FFFF';
export const NEUTRAL_COLOR_CSS = '#666666';

// Subagent 02 Gameplay Configuration Aliases
export const SERVER_TICK_RATE = TICK_RATE;
export const SQUID_SPEED_MULTIPLIER = 1.8;
export const ENEMY_INK_SPEED_MULTIPLIER = 0.3;
export const DAMAGE = WEAPON_DAMAGE;
export const MAX_RANGE = WEAPON_RANGE;
export const SPREAD = WEAPON_SPREAD;
export const SHOT_COST = INK_COST;
export const NORMAL_REGEN = INK_REGEN_NORMAL;
export const SQUID_REGEN = INK_REGEN_SQUID;
export const REGEN_DELAY = INK_REGEN_DELAY;
export const REGEN_RATE = HEALTH_REGEN_RATE;
export const INVULNERABILITY = INVULNERABILITY_TIME;
export const DOT = ENEMY_INK_DOT;
export const SHOT_INTERVAL = FIRE_INTERVAL;

// Continuous paint configuration
export const CONTINUOUS_PAINT_MAX_DIST_UV = 0.18; // ~18m max continuous segment

// Weapon & Skill Configurations
import type { WeaponType, SubWeaponType, SpecialWeaponType } from './types.js';

export interface WeaponStats {
  id: WeaponType;
  name: string;
  nameZh: string;
  sub: SubWeaponType;
  special: SpecialWeaponType;
  damage: number;
  inkCost: number;
  range: number;
  fireRate: number;
  paintRadius: number;
  spread: number;
  description: string;
  // Weapon-specific properties
  chargeTime?: number;
  rollDamage?: number;
  rollWidth?: number;
  rollInkPerSec?: number;
}

export const WEAPON_CONFIGS: Record<WeaponType, WeaponStats> = {
  shooter: {
    id: 'shooter',
    name: 'Ink Blaster',
    nameZh: '墨水冲锋枪',
    sub: 'splat_bomb',
    special: 'inkstrike',
    damage: 25,
    inkCost: 2,
    range: 48,
    fireRate: 10,
    paintRadius: 2.2,
    spread: 0.035,
    description: 'Balanced automatic ink rifle. High mobility and versatile for all ranges.'
  },
  roller: {
    id: 'roller',
    name: 'Ink Roller',
    nameZh: '涂地滚筒',
    sub: 'curling_bomb',
    special: 'ink_storm',
    damage: 100,
    inkCost: 12,
    range: 18,
    fireRate: 1.6,
    paintRadius: 3.2,
    spread: 0.12,
    description: 'Melee juggernaut. Hold fire to roll and crush enemies; tap to fling wide ink waves.',
    rollDamage: 120,
    rollWidth: 3.4,
    rollInkPerSec: 10
  },
  charger: {
    id: 'charger',
    name: 'Ink Sniper',
    nameZh: '蓄力墨水狙击枪',
    sub: 'splat_bomb',
    special: 'killer_wail',
    damage: 130,
    inkCost: 18,
    range: 65,
    fireRate: 1.0,
    paintRadius: 1.8,
    spread: 0.005,
    description: 'Long-range precision sniper. Hold to charge a lethal, continuous ink laser beam.',
    chargeTime: 1.0
  },
  slosher: {
    id: 'slosher',
    name: 'Ink Bucket',
    nameZh: '飞溅泼桶',
    sub: 'burst_bomb',
    special: 'inkstrike',
    damage: 60,
    inkCost: 10,
    range: 26,
    fireRate: 2.0,
    paintRadius: 3.5,
    spread: 0.08,
    description: 'Bucket weapon. Hurls large arcs of ink over walls and obstacles with heavy splash.'
  }
};

export interface SubWeaponStats {
  id: SubWeaponType;
  name: string;
  nameZh: string;
  inkCost: number;
  throwSpeed: number;
  fuseTime: number; // 0 = explode on impact
  damage: number;
  splashRadius: number;
  trailWidth?: number;
  description: string;
}

export const SUB_WEAPON_CONFIGS: Record<SubWeaponType, SubWeaponStats> = {
  splat_bomb: {
    id: 'splat_bomb',
    name: 'Ink Bomb',
    nameZh: '墨水炸弹',
    inkCost: 65,
    throwSpeed: 16,
    fuseTime: 1.2,
    damage: 160,
    splashRadius: 5.0,
    description: 'Lobbed explosive bomb. Detonates 1.2s after hitting the ground with high lethal power.'
  },
  burst_bomb: {
    id: 'burst_bomb',
    name: 'Pop Bomb',
    nameZh: '快速炸弹',
    inkCost: 40,
    throwSpeed: 24,
    fuseTime: 0,
    damage: 60,
    splashRadius: 3.2,
    description: 'Lightweight bomb. Explodes instantly on contact with ground, obstacles, or enemies.'
  },
  curling_bomb: {
    id: 'curling_bomb',
    name: 'Slider Bomb',
    nameZh: '冰壶炸弹',
    inkCost: 55,
    throwSpeed: 14,
    fuseTime: 2.5,
    damage: 150,
    splashRadius: 4.5,
    trailWidth: 1.6,
    description: 'Glides across the floor, painting a continuous trail and bouncing off walls before detonating.'
  }
};

export const SPECIAL_METER_MAX = 100;
export const SPECIAL_POINTS_NEEDED = 150; // turf points needed to charge 100%

export interface SpecialStats {
  id: SpecialWeaponType;
  name: string;
  nameZh: string;
  duration: number;
  radius: number;
  dps: number;
  speed?: number;
  beamRadius?: number;
  description: string;
}

export const SPECIAL_CONFIGS: Record<SpecialWeaponType, SpecialStats> = {
  inkstrike: {
    id: 'inkstrike',
    name: 'Ink Twister',
    nameZh: '龙卷风墨击',
    duration: 4.0,
    radius: 6.0,
    dps: 80,
    description: 'Super missile strike that spawns a swirling ink vortex, continuously painting and splatting enemies.'
  },
  ink_storm: {
    id: 'ink_storm',
    name: 'Ink Downpour',
    nameZh: '墨雨云',
    duration: 6.0,
    radius: 5.0,
    speed: 4.0,
    dps: 35,
    description: 'Summons a moving raincloud of team ink that covers a huge swath of ground and damages foes.'
  },
  killer_wail: {
    id: 'killer_wail',
    name: 'Bass Wave Cannon',
    nameZh: '扩音器5.1',
    duration: 3.0,
    radius: 1.6,
    beamRadius: 1.6,
    dps: 120,
    description: 'Fires high-powered penetrating sonic lasers that pierce through walls and obstacles.'
  }
};
