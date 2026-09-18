import {
  ENEMY_INK_DOT,
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_RATE,
  INK_REGEN_DELAY,
  INK_REGEN_NORMAL,
  INK_REGEN_SQUID,
  MAX_HP,
  MAX_INK,
  PlayerMode,
  PlayerSnapshot,
  Team,
  Vec3,
  WeaponType
} from '@ink/shared';

export class PlayerState {
  readonly id: string;
  team: Team;
  readonly slotIndex: number;
  name: string;
  weaponType: WeaponType = 'shooter';
  specialMeter = 0;
  specialActive = false;
  specialEndsAt = 0;
  chargeLevel = 0;

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
  lastSubWeaponTime = 0;
  fireHeld = false;

  // Continuous stroke continuity tracking
  lastPaintU?: number;
  lastPaintV?: number;
  lastPaintTime = 0;

  kills = 0;
  deaths = 0;

  lastProcessedInputSeq = 0;

  constructor(id: string, team: Team, slotIndex: number, spawnPos: Vec3, name?: string, weaponType: WeaponType = 'shooter') {
    this.id = id;
    this.team = team;
    this.slotIndex = slotIndex;
    this.name = name || `Inkling #${id.slice(0, 4)}`;
    this.weaponType = weaponType;
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
    this.chargeLevel = 0;
    this.fireHeld = false;
    this.lastPaintU = undefined;
    this.lastPaintV = undefined;
  }

  /**
   * Consumes ink for weapon firing (Subagent 18)
   */
  consumeShot(cost: number, now: number = Date.now()): boolean {
    if (!this.alive || this.ink < cost) {
      return false;
    }
    this.ink = Math.max(0, this.ink - cost);
    this.lastFiredTime = now;
    return true;
  }

  /**
   * Regenerates ink over time based on form and delay (Subagent 18)
   */
  updateInkRegen(dt: number, isSquidInOwnInk: boolean, now: number = Date.now()): void {
    if (!this.alive || this.ink >= MAX_INK) return;
    if (now - this.lastFiredTime < INK_REGEN_DELAY * 1000) return;

    const rate = isSquidInOwnInk ? INK_REGEN_SQUID : INK_REGEN_NORMAL;
    this.ink = Math.min(MAX_INK, this.ink + rate * dt);
  }

  resetInk(): void {
    this.ink = MAX_INK;
  }

  /**
   * Applies damage to player, respecting invulnerability (Subagent 19)
   */
  applyDamage(amount: number, now: number = Date.now()): { dead: boolean; actualDamage: number } {
    if (!this.alive || this.isInvulnerable(now) || amount <= 0) {
      return { dead: false, actualDamage: 0 };
    }

    this.hp = Math.max(0, this.hp - amount);
    this.lastDamageTime = now;

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.mode = PlayerMode.DEAD;
      return { dead: true, actualDamage: amount };
    }

    return { dead: false, actualDamage: amount };
  }

  /**
   * Applies enemy ink damage-over-time (Subagent 19)
   */
  updateEnemyInkDOT(dt: number, now: number = Date.now()): boolean {
    if (!this.alive || this.isInvulnerable(now)) return false;

    this.hp = Math.max(0, this.hp - ENEMY_INK_DOT * dt);
    this.lastDamageTime = now;

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.mode = PlayerMode.DEAD;
      return true;
    }

    return false;
  }

  /**
   * Regenerates health when out of combat for 3 seconds (Subagent 19)
   */
  updateHealthRegen(dt: number, isEnemyInk: boolean, now: number = Date.now()): void {
    if (!this.alive || this.hp >= MAX_HP || isEnemyInk) return;
    if (now - this.lastDamageTime < HEALTH_REGEN_DELAY * 1000) return;

    this.hp = Math.min(MAX_HP, this.hp + HEALTH_REGEN_RATE * dt);
  }

  toSnapshot(): PlayerSnapshot {
    return {
      id: this.id,
      team: this.team,
      name: this.name,
      weaponType: this.weaponType,
      specialMeter: Math.round(this.specialMeter),
      specialActive: this.specialActive,
      chargeLevel: Number(this.chargeLevel.toFixed(2)),
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
