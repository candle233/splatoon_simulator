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
