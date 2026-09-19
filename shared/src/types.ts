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
  RESTARTING = 4
}

export type WeaponType = 'shooter' | 'roller' | 'charger' | 'slosher';
export type SubWeaponType = 'splat_bomb' | 'burst_bomb' | 'curling_bomb';
export type SpecialWeaponType = 'inkstrike' | 'ink_storm' | 'killer_wail';
export type GameMode = 'turf_war' | 'splat_zones' | 'team_deathmatch';
export type MapId = 'downtown' | 'cargo_docks' | 'sky_rink';
export type SkillId =
  | 'ink_saver'
  | 'ink_recovery'
  | 'run_speed'
  | 'swim_speed'
  | 'special_charge'
  | 'quick_respawn'
  | 'main_power'
  | 'defense';

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
  name?: string;
  isBot?: boolean;
  skills?: SkillId[];
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
}

export interface HitResult {
  hit: boolean;
  distance: number;
  point: Vec3;
  normal: Vec3;
  hitPlayerId?: string;
  hitObstacleId?: string;
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

