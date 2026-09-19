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
/** Maximum bots a host may field (shared with MAX_PLAYERS budget). */
export const MAX_BOTS = 6;

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
import type { GameMode, WeaponType, SubWeaponType, SpecialWeaponType } from './types.js';

export interface WeaponStats {
  id: WeaponType;
  name: string;
  nameZh: string;
  nameJa: string;
  sub: SubWeaponType;
  special: SpecialWeaponType;
  damage: number;
  inkCost: number;
  range: number;
  fireRate: number;
  paintRadius: number;
  spread: number;
  description: string;
  descriptionZh: string;
  descriptionJa: string;
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
    nameJa: 'インクブラスター',
    sub: 'splat_bomb',
    special: 'inkstrike',
    damage: 25,
    inkCost: 2,
    range: 48,
    fireRate: 10,
    paintRadius: 2.2,
    spread: 0.035,
    description: 'Balanced automatic ink rifle. High mobility and versatile for all ranges.',
    descriptionZh: '均衡的墨水自动步枪，机动性高，全射程通用。',
    descriptionJa: 'バランス型のインク自動小銃。機動力が高く全距離で汎用。'
  },
  roller: {
    id: 'roller',
    name: 'Ink Roller',
    nameZh: '涂地滚筒',
    nameJa: 'インクローラー',
    sub: 'curling_bomb',
    special: 'ink_storm',
    damage: 100,
    inkCost: 12,
    range: 18,
    fireRate: 1.6,
    paintRadius: 3.2,
    spread: 0.12,
    description: 'Melee juggernaut. Hold fire to roll and crush enemies; tap to fling wide ink waves.',
    descriptionZh: '近战碾压型武器，长按推进碾碎敌人；点按甩出宽幅墨浪。',
    descriptionJa: '近接の重装兵器。長押しで転圧し、タップで広範囲にインクをたたき出す。',
    rollDamage: 120,
    rollWidth: 3.4,
    rollInkPerSec: 10
  },
  charger: {
    id: 'charger',
    name: 'Ink Sniper',
    nameZh: '蓄力墨水狙击枪',
    nameJa: 'インクスナイパー',
    sub: 'splat_bomb',
    special: 'killer_wail',
    damage: 130,
    inkCost: 18,
    range: 65,
    fireRate: 1.0,
    paintRadius: 1.8,
    spread: 0.005,
    description: 'Long-range precision sniper. Hold to charge a lethal, continuous ink laser beam.',
    descriptionZh: '超远距精准狙击，长按蓄力射出致命贯穿墨水激光。',
    descriptionJa: '超長距離精密スナイパー。長押しチャージで貫通レーザー。',
    chargeTime: 1.0
  },
  slosher: {
    id: 'slosher',
    name: 'Ink Bucket',
    nameZh: '飞溅泼桶',
    nameJa: 'インクバケツ',
    sub: 'burst_bomb',
    special: 'inkstrike',
    damage: 60,
    inkCost: 10,
    range: 26,
    fireRate: 2.0,
    paintRadius: 3.5,
    spread: 0.08,
    description: 'Bucket weapon. Hurls large arcs of ink over walls and obstacles with heavy splash.',
    descriptionZh: '高抛物线泼桶，可将大量墨水越过墙壁与掩体泼洒。',
    descriptionJa: '壁や障害物の向こうへインクを弧を描いて投げるバケツ武器。'
  }
};

export interface SubWeaponStats {
  id: SubWeaponType;
  name: string;
  nameZh: string;
  nameJa: string;
  inkCost: number;
  throwSpeed: number;
  fuseTime: number; // 0 = explode on impact
  damage: number;
  splashRadius: number;
  trailWidth?: number;
  description: string;
  descriptionZh: string;
  descriptionJa: string;
}

export const SUB_WEAPON_CONFIGS: Record<SubWeaponType, SubWeaponStats> = {
  splat_bomb: {
    id: 'splat_bomb',
    name: 'Ink Bomb',
    nameZh: '墨水炸弹',
    nameJa: 'インクボム',
    inkCost: 65,
    throwSpeed: 16,
    fuseTime: 1.2,
    damage: 160,
    splashRadius: 5.0,
    description: 'Lobbed explosive bomb. Detonates 1.2s after hitting the ground with high lethal power.',
    descriptionZh: '投掷型爆弹，落地1.2秒后引爆，杀伤力极高。',
    descriptionJa: '着弾から1.2秒後に爆発する投擲ボム。高い殺傷力。'
  },
  burst_bomb: {
    id: 'burst_bomb',
    name: 'Pop Bomb',
    nameZh: '快速炸弹',
    nameJa: 'クイックボム',
    inkCost: 40,
    throwSpeed: 24,
    fuseTime: 0,
    damage: 60,
    splashRadius: 3.2,
    description: 'Lightweight bomb. Explodes instantly on contact with ground, obstacles, or enemies.',
    descriptionZh: '轻量炸弹，触地、触墙或触敌立即引爆。',
    descriptionJa: '地面・障害物・敵に触れると即爆発する軽量ボム。'
  },
  curling_bomb: {
    id: 'curling_bomb',
    name: 'Slider Bomb',
    nameZh: '冰壶炸弹',
    nameJa: 'カーリングボム',
    inkCost: 55,
    throwSpeed: 14,
    fuseTime: 2.5,
    damage: 150,
    splashRadius: 4.5,
    trailWidth: 1.6,
    description: 'Glides across the floor, painting a continuous trail and bouncing off walls before detonating.',
    descriptionZh: '贴地滑行涂出连续墨道，撞墙反弹后引爆。',
    descriptionJa: '床を滑りながら連続的に塗り、壁でバウンド後に爆発。'
  }
};

export const SPECIAL_METER_MAX = 100;
export const SPECIAL_POINTS_NEEDED = 150; // turf points needed to charge 100%

export interface SpecialStats {
  id: SpecialWeaponType;
  name: string;
  nameZh: string;
  nameJa: string;
  duration: number;
  radius: number;
  dps: number;
  speed?: number;
  beamRadius?: number;
  description: string;
  descriptionZh: string;
  descriptionJa: string;
}

export const SPECIAL_CONFIGS: Record<SpecialWeaponType, SpecialStats> = {
  inkstrike: {
    id: 'inkstrike',
    name: 'Ink Twister',
    nameZh: '龙卷风墨击',
    nameJa: 'インクトルネード',
    duration: 4.0,
    radius: 6.0,
    dps: 80,
    description: 'Super missile strike that spawns a swirling ink vortex, continuously painting and splatting enemies.',
    descriptionZh: '战略导弹落点生成墨水龙卷，持续涂地并击倒敌人。',
    descriptionJa: '着弾点にインクの竜巻を生み、塗り続けながら敵を倒す。'
  },
  ink_storm: {
    id: 'ink_storm',
    name: 'Ink Downpour',
    nameZh: '墨雨云',
    nameJa: 'インクストーム',
    duration: 6.0,
    radius: 5.0,
    speed: 4.0,
    dps: 35,
    description: 'Summons a moving raincloud of team ink that covers a huge swath of ground and damages foes.',
    descriptionZh: '召唤移动墨雨云，覆盖大片地面并伤害敌人。',
    descriptionJa: '移動するインク雲を呼び、広範囲を塗りつつ敵を傷つける。'
  },
  killer_wail: {
    id: 'killer_wail',
    name: 'Bass Wave Cannon',
    nameZh: '扩音器5.1',
    nameJa: 'ジェットクリーナー',
    duration: 3.0,
    radius: 1.6,
    beamRadius: 1.6,
    dps: 120,
    description: 'Fires high-powered penetrating sonic lasers that pierce through walls and obstacles.',
    descriptionZh: '发射穿透墙壁与掩体的高强度音波激光。',
    descriptionJa: '壁や障害物を貫通する強力な音波レーザーを発射。'
  }
};

export interface GameModeStats {
  id: GameMode;
  icon: string;
  name: string;
  nameZh: string;
  nameJa: string;
  description: string;
  descriptionZh: string;
  descriptionJa: string;
  /** Team score that ends the match early (0 = time-only). */
  scoreLimit: number;
}

export const GAME_MODES: GameMode[] = ['turf_war', 'splat_zones', 'team_deathmatch'];
export const DEFAULT_GAME_MODE: GameMode = 'turf_war';

export const MODE_CONFIGS: Record<GameMode, GameModeStats> = {
  turf_war: {
    id: 'turf_war',
    icon: '🖌️',
    name: 'Turf War',
    nameZh: '涂地对战',
    nameJa: 'ナワバリバトル',
    description: 'Paint the most ground before time runs out.',
    descriptionZh: '时间结束时涂地面积最多的队伍获胜。',
    descriptionJa: '時間終了時に最も地面を塗ったチームが勝利。',
    scoreLimit: 0
  },
  splat_zones: {
    id: 'splat_zones',
    icon: '🚩',
    name: 'Splat Zones',
    nameZh: '占领区域',
    nameJa: 'ガチエリア',
    description: 'Hold the central zone to score points. First team to 150 wins.',
    descriptionZh: '持续占领中央区域积分，率先达到 150 分获胜。',
    descriptionJa: '中央エリアを確保してポイントを獲得。150点到達で勝利。',
    scoreLimit: 150
  },
  team_deathmatch: {
    id: 'team_deathmatch',
    icon: '⚔️',
    name: 'Team Deathmatch',
    nameZh: '团队歼灭',
    nameJa: 'チームデスマッチ',
    description: 'Splats score points. First team to 40 knockouts wins.',
    descriptionZh: '击败敌人积分，率先达到 40 击杀获胜。',
    descriptionJa: 'スプラットで得点。40先取のチームが勝利。',
    scoreLimit: 40
  }
};

export function isValidGameMode(id: unknown): id is GameMode {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MODE_CONFIGS, id);
}
