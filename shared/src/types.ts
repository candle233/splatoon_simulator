export enum Team {
  NEUTRAL = 0,
  PINK = 1,
  CYAN = 2
}

export const TEAM_PINK = Team.PINK;
export const TEAM_CYAN = Team.CYAN;

export enum PlayerForm {
  HUMANOID = 0,
  SUBMERGED = 1
}

export enum PlayerLifeState {
  ALIVE = 0,
  DEAD = 1
}

export enum PlayerMode {
  HUMANOID = 0,
  SUBMERGED = 1,
  DEAD = 2
}

export enum MatchPhase {
  WAITING = 0,
  COUNTDOWN = 1,
  PLAYING = 2,
  GAME_OVER = 3,
  /** Post-match weapon loadout selection before the next countdown starts. */
  WEAPON_SELECT = 4
}

export type WeaponType =
  | 'shooter'
  | 'roller'
  | 'charger'
  | 'slosher'
  | 'sprayer'
  | 'cannon'
  | 'marksman'
  | 'scatter'
  /** Umbrella weapon: single shot plus a deployable ink shield. */
  | 'brella'
  /** Twin pistols: enables the dodge roll with brief invulnerability. */
  | 'dualies';
export type SubWeaponType =
  | 'splat_bomb'
  | 'burst_bomb'
  | 'curling_bomb'
  | 'ink_mine'
  | 'bounce_bomb'
  | 'ink_puddle'
  /** Homing torpedo that steers toward the nearest enemy (Brella sub). */
  | 'torpedo';
export type SpecialWeaponType =
  | 'inkstrike'
  | 'ink_storm'
  | 'killer_wail'
  | 'ink_nova'
  | 'ink_barrier';
export type GameMode =
  | 'turf_war'
  | 'splat_zones'
  | 'team_deathmatch'
  /** Kills and coverage both feed one score, so neither playstyle is optional. */
  | 'ranked_hybrid'
  /** Coverage is sampled on a timer; only the last sample decides the winner. */
  | 'final_push';
export type MapId = 'downtown' | 'cargo_docks' | 'sky_rink' | 'aurora_outpost';

/**
 * Quick-chat / emote types. `booyah` and `ouch` are the two voice-channel-free
 * callouts; the `ping_*` variants are tactical map markers placed on the radar.
 */
export type EmoteType = 'booyah' | 'ouch' | 'ping_enemy' | 'ping_area' | 'ping_defend';
export type SkillId =
  | 'ink_saver'
  | 'ink_recovery'
  | 'run_speed'
  | 'swim_speed'
  | 'special_charge'
  | 'quick_respawn'
  | 'main_power'
  | 'defense'
  | 'sub_saver'
  | 'sub_power'
  | 'special_power'
  | 'paint_boost';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BoxObstacle {
  id: string;
  position: Vec3;
  size: Vec3;
  /** Whether vertical faces of this obstacle accept paint. */
  paintable?: boolean;
}

/** A vertical wall face that can be painted on and optionally climbed. */
export interface PaintSurface {
  id: string;
  position: Vec3;
  size: Vec3;
  /** Surface normal pointing outward (unit length). */
  normal: Vec3;
  /** Height of the surface above ground. */
  height: number;
  /** Paint coverage per team: [pinkFraction, cyanFraction]. */
  paint: [number, number];
}

/** Stairs or a ramp that lifts the player up along a slope. */
export interface RampObstacle {
  id: string;
  position: Vec3;
  /** Ramp length along the travel direction. */
  length: number;
  /** Ramp width perpendicular to travel direction. */
  width: number;
  /** Height gain over the full ramp length. */
  rise: number;
  /** Direction the player travels UP toward. */
  direction: 'north' | 'south' | 'east' | 'west';
  /** Whether the player automatically walks up at reduced speed. */
  climbable: boolean;
}

/** A surface marked as climbable — players can ascend by holding a key. */
export interface ClimbableSurface {
  id: string;
  position: Vec3;
  size: Vec3;
  /** Normal direction of the climbable face. */
  normal: Vec3;
}

export interface PlayerInput {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  squid: boolean;
  fire: boolean;
  clientTime: number;
  subWeapon?: boolean;
  special?: boolean;
  chargeLevel?: number;
  weaponType?: WeaponType;
  /** One-shot dodge-roll request (Dualies). Consumed by the server per press. */
  dodge?: boolean;
}

export interface PlayerSnapshot {
  id: string;
  team: Team;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  ink: number;
  alive: boolean;
  mode: PlayerMode;
  invulnerable: boolean;
  kills: number;
  deaths: number;
  weaponType?: WeaponType;
  specialMeter?: number;
  specialActive?: boolean;
  chargeLevel?: number;
  /** Brella ink shield state: up now, and how much HP it has left. */
  shieldActive?: boolean;
  shieldHp?: number;
  /** True while a Dualies dodge roll is in progress. */
  dodging?: boolean;
  name?: string;
  isBot?: boolean;
  skills?: SkillId[];
  /**
   * Most recent emote this player used. Carried on the 20 Hz snapshot so late
   * joiners (and rejoining players) still see the last callout above the
   * character; the client ages it out visually.
   */
  lastEmote?: EmoteType;
  /** Server timestamp (ms) of `lastEmote`; lets the client skip stale entries. */
  lastEmoteAt?: number;
}

export interface PaintEvent {
  id: number;
  team: Team;
  u: number;
  v: number;
  radius: number;
  seed: number;
  prevU?: number;
  prevV?: number;
  widthUV?: number;
}

export interface SubWeaponEventPayload {
  id: string;
  type: SubWeaponType;
  action: 'spawn' | 'explode' | 'bounce';
  team: Team;
  ownerId: string;
  position: Vec3;
  velocity?: Vec3;
  radius?: number;
}

export interface SpecialEventPayload {
  id: string;
  type: SpecialWeaponType;
  action: 'activate' | 'update' | 'end';
  team: Team;
  ownerId: string;
  position: Vec3;
  direction?: Vec3;
  duration?: number;
}

export interface LobbyPlayerState {
  id: string;
  name: string;
  team: Team;
  weaponType: WeaponType;
  ready: boolean;
  isHost: boolean;
  isBot?: boolean;
  skills?: SkillId[];
  /**
   * Validated `data:image/...;base64,` thumbnail. Carried only on the
   * low-frequency lobby payload — never in a 20 Hz snapshot, which would cost
   * about a megabyte per second per player.
   */
  avatar?: string;
}

export interface LobbyStatePayload {
  players: LobbyPlayerState[];
  countdown: number;
  inMatch: boolean;
  mode?: GameMode;
  mapId?: MapId;
}

export interface MatchScore {
  pinkCount: number;
  cyanCount: number;
  neutralCount: number;
  pinkPercentage: number;
  cyanPercentage: number;
}

export interface MatchStateSnapshot {
  phase: MatchPhase;
  matchStartAt: number;
  matchEndAt: number;
  serverTime: number;
  pinkScore: number;
  cyanScore: number;
  mode?: GameMode;
}

export interface GameOverPayload {
  winner: Team | 'DRAW';
  pinkCoverage: number;
  cyanCoverage: number;
  restartCountdown: number;
  mode?: GameMode;
  /** Seconds until the weapon selection screen appears (GAME_OVER remaining). */
  gameOverRemaining?: number;
  /** Seconds until the next countdown begins after weapon selection. */
  weaponSelectDuration?: number;
}

export interface WelcomePayload {
  protocolVersion: number;
  playerId: string;
  team: Team;
  serverTime: number;
  match: MatchStateSnapshot;
  players: PlayerSnapshot[];
  paintHistory: PaintEvent[];
  totalPaintEvents?: number;
  obstacles: BoxObstacle[];
  ramps: RampObstacle[];
  climbableSurfaces: ClimbableSurface[];
  paintSurfaces: PaintSurface[];
  lobby?: LobbyStatePayload;
  mapId?: MapId;
  mapSize?: number;
}

/** Host-controlled match setup (mode + map), changeable only while WAITING. */
export interface MatchConfigPayload {
  mode?: GameMode;
  mapId?: MapId;
}

export interface SnapshotPayload {
  serverTime: number;
  lastProcessedInputSeq: Record<string, number>;
  players: PlayerSnapshot[];
  match: MatchStateSnapshot;
  /** Updated paint fractions on climbable surfaces since last snapshot. */
  paintSurfaceUpdates?: PaintSurface[];
}

export interface HitResult {
  hit: boolean;
  distance: number;
  point: Vec3;
  normal: Vec3;
  hitPlayerId?: string;
  hitObstacleId?: string;
  hitRampId?: string;
  isGround: boolean;
}

export interface ShotEventPayload {
  shooterId: string;
  origin: Vec3;
  target: Vec3;
  team: Team;
  weaponType?: WeaponType;
  chargeLevel?: number;
}

/**
 * Quick-chat relay payload. The server never trusts `playerName`/`team` from
 * the wire — they are overwritten with the authoritative roster values before
 * the event is broadcast back out.
 */
export interface EmotePayload {
  playerId: string;
  playerName: string;
  team: Team;
  type: EmoteType;
  /** World position for map pings; undefined for booyah/ouch callouts. */
  position?: Vec3;
  timestamp: number;
}

// Aliases & Domain Specifications for Subagent 01
export type WorldSnapshot = SnapshotPayload;
export type PaintBatch = PaintEvent[];
export type ScoreState = MatchScore;
export type MatchState = MatchStateSnapshot;

export interface SpawnState {
  team: Team;
  slotIndex: number;
  position: Vec3;
}

export interface WeaponConfig {
  damage: number;
  inkCost: number;
  range: number;
  fireRate: number;
  spread: number;
  paintRadius: number;
}

export interface MovementConfig {
  runSpeed: number;
  squidSpeedMultiplier: number;
  enemyInkSpeedMultiplier: number;
  jumpVelocity: number;
  gravity: number;
}

export interface GameplayConfig {
  maxHp: number;
  maxInk: number;
  normalInkRegen: number;
  squidInkRegen: number;
  inkRegenDelay: number;
  enemyInkDot: number;
  healthRegenDelay: number;
  healthRegenRate: number;
  respawnTime: number;
  invulnerabilityTime: number;
  countdownDuration: number;
  matchDuration: number;
  gameOverDuration: number;
  serverTickRate: number;
}

