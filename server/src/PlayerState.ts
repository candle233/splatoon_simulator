import {
  MAX_HP,
  MAX_INK,
  PlayerMode,
  PlayerSnapshot,
  Team,
  Vec3
} from '@ink/shared';

export class PlayerState {
  readonly id: string;
  readonly team: Team;
  readonly slotIndex: number;

  position: Vec3;
  velocity: Vec3;
  yaw = 0;
  pitch = 0;

  hp: number = MAX_HP;
  ink: number = MAX_INK;
  mode: PlayerMode = PlayerMode.HUMANOID;
  alive = true;
  grounded = true;

  invulnerableUntil = 0;
  respawnAt = 0;

  lastShotTime = 0;
  lastDamageTime = 0;
  lastFiredTime = 0;

  kills = 0;
  deaths = 0;

  lastProcessedInputSeq = 0;

  constructor(id: string, team: Team, slotIndex: number, spawnPos: Vec3) {
    this.id = id;
    this.team = team;
    this.slotIndex = slotIndex;
    this.position = { ...spawnPos };
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  isInvulnerable(now: number = Date.now()): boolean {
    return now < this.invulnerableUntil;
  }

  respawn(spawnPos: Vec3, now: number = Date.now(), invulnDurationSec = 2.0): void {
    this.position = { ...spawnPos };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.hp = MAX_HP;
    this.ink = MAX_INK;
    this.mode = PlayerMode.HUMANOID;
    this.alive = true;
    this.grounded = true;
    this.invulnerableUntil = now + invulnDurationSec * 1000;
    this.respawnAt = 0;
  }

  toSnapshot(): PlayerSnapshot {
    return {
      id: this.id,
      team: this.team,
      x: Number(this.position.x.toFixed(3)),
      y: Number(this.position.y.toFixed(3)),
      z: Number(this.position.z.toFixed(3)),
      yaw: Number(this.yaw.toFixed(3)),
      pitch: Number(this.pitch.toFixed(3)),
      hp: Math.max(0, Math.round(this.hp)),
      ink: Math.max(0, Math.round(this.ink)),
      alive: this.alive,
      mode: this.mode,
      invulnerable: this.isInvulnerable(),
      kills: this.kills,
      deaths: this.deaths
    };
  }
}
