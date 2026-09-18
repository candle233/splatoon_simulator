export enum Team {
  NEUTRAL = 0,
  PINK = 1,
  CYAN = 2
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
}

export interface PaintEvent {
  id: number;
  team: Team;
  u: number;
  v: number;
  radius: number;
  seed: number;
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
}

export interface GameOverPayload {
  winner: Team | 'DRAW';
  pinkCoverage: number;
  cyanCoverage: number;
  restartCountdown: number;
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
}

