import {
  GRAVITY,
  JUMP_VELOCITY,
  MAX_HP,
  MAX_INK,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PlayerInput,
  PlayerMode,
  PlayerSnapshot,
  SQUID_HEIGHT,
  SkillId,
  Team,
  Vec3,
  WeaponType,
  computeMovementVelocity,
  enforceSpawnBarrier,
  getMovementSpeed,
  nextPlayerForm
} from '@ink/shared';
import { ClientCollisionWorld } from '../world/CollisionWorld.js';
import { PlayerView } from './PlayerView.js';

export class LocalPlayer {
  readonly id: string;
  readonly team: Team;
  readonly view: PlayerView;

  position: Vec3;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;

  hp = MAX_HP;
  ink = MAX_INK;
  mode = PlayerMode.HUMANOID;
  alive = true;
  grounded = true;
  invulnerable = false;
  kills = 0;
  deaths = 0;

  weaponType: WeaponType = 'shooter';
  specialMeter = 0;
  specialActive = false;
  chargeLevel = 0;
  /**
   * Gear skills as reported by the server snapshot. Client-side prediction must
   * use the same run_speed / swim_speed multipliers or every prediction frame
   * fights the authoritative position and the camera jitters.
   */
  skills: SkillId[] = [];

  private collisionWorld: ClientCollisionWorld;
  private pendingInputs: { seq: number; input: PlayerInput; dt: number; groundInk: Team }[] = [];

  constructor(
    id: string,
    team: Team,
    spawnPos: Vec3,
    collisionWorld: ClientCollisionWorld,
    weaponType: WeaponType = 'shooter'
  ) {
    this.id = id;
    this.team = team;
    this.position = { ...spawnPos };
    this.collisionWorld = collisionWorld;
    this.weaponType = weaponType;
    this.view = new PlayerView(team);
    this.view.setWeaponType(weaponType);
    this.syncViewPosition();
  }

  private simulateStep(
    pos: Vec3,
    vel: Vec3,
    grounded: boolean,
    input: PlayerInput,
    dt: number,
    groundInk: Team
  ): { position: Vec3; velocity: Vec3; grounded: boolean; mode: PlayerMode } {
    const mode = nextPlayerForm(
      PlayerMode.HUMANOID,
      this.alive,
      grounded,
      Boolean(input.squid),
      groundInk,
      this.team
    );
    const currentSpeed = getMovementSpeed(mode, groundInk, this.team, this.skills);
    const { vx, vz } = computeMovementVelocity(input.yaw, input.moveX, input.moveZ, currentSpeed);

    const stepVel = {
      x: vx,
      y: vel.y,
      z: vz
    };

    let stepGrounded = grounded;
    if (input.jump && stepGrounded) {
      stepVel.y = JUMP_VELOCITY;
      stepGrounded = false;
    }

    if (!stepGrounded) {
      stepVel.y += GRAVITY * dt;
    }

    const radius = PLAYER_RADIUS;
    const height = mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    const newPos = {
      x: pos.x + stepVel.x * dt,
      y: pos.y + stepVel.y * dt,
      z: pos.z + stepVel.z * dt
    };

    const res = this.collisionWorld.resolveMovement(
      pos,
      newPos,
      radius,
      height,
      stepVel
    );

    return {
      position: enforceSpawnBarrier(res.position, this.team),
      velocity: res.velocity,
      grounded: res.grounded,
      mode
    };
  }

  predictMovement(input: PlayerInput, dt: number, groundInk: Team): void {
    if (!this.alive) return;

    this.yaw = input.yaw;
    this.pitch = input.pitch;

    const res = this.simulateStep(
      this.position,
      this.velocity,
      this.grounded,
      input,
      dt,
      groundInk
    );

    this.position = res.position;
    this.velocity = res.velocity;
    this.grounded = res.grounded;
    this.mode = res.mode;

    this.pendingInputs.push({
      seq: input.seq,
      input: { ...input },
      dt,
      groundInk
    });

    if (this.pendingInputs.length > 120) {
      this.pendingInputs.shift();
    }

    this.syncViewPosition();
    this.view.setMode(this.mode);

    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    this.view.updateLocomotion(dt, speed, this.grounded, this.pitch);
  }

  setWeaponType(weapon: WeaponType): void {
    this.weaponType = weapon;
    this.view.setWeaponType(weapon);
  }

  triggerShootRecoil(): void {
    this.view.triggerRecoil();
  }

  applyServerState(snapshot: PlayerSnapshot, lastAckSeq?: number): void {
    this.hp = snapshot.hp;
    this.ink = snapshot.ink;
    this.alive = snapshot.alive;
    this.invulnerable = snapshot.invulnerable;
    this.kills = snapshot.kills;
    this.deaths = snapshot.deaths;

    if (snapshot.weaponType) {
      this.setWeaponType(snapshot.weaponType);
    }
    if (snapshot.specialMeter !== undefined) {
      this.specialMeter = snapshot.specialMeter;
    }
    if (snapshot.specialActive !== undefined) {
      this.specialActive = snapshot.specialActive;
    }
    if (snapshot.chargeLevel !== undefined) {
      this.chargeLevel = snapshot.chargeLevel;
    }
    // The server omits `skills` when the loadout is empty, so clear rather than
    // keep a stale loadout after the player unequips everything.
    this.skills = snapshot.skills ?? [];

    if (!this.alive) {
      this.pendingInputs = [];
      this.position = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      this.mode = PlayerMode.DEAD;
      this.syncViewPosition();
      this.view.setMode(PlayerMode.DEAD);
      return;
    }

    if (lastAckSeq !== undefined) {
      this.pendingInputs = this.pendingInputs.filter((p) => p.seq > lastAckSeq);
    }

    // Replay pending inputs starting from authoritative server snapshot
    let replayedPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
    let replayedVel = { ...this.velocity };
    let replayedGrounded = this.grounded;
    let replayedMode = snapshot.mode;

    for (const item of this.pendingInputs) {
      const stepRes = this.simulateStep(
        replayedPos,
        replayedVel,
        replayedGrounded,
        item.input,
        item.dt,
        item.groundInk
      );
      replayedPos = stepRes.position;
      replayedVel = stepRes.velocity;
      replayedGrounded = stepRes.grounded;
      replayedMode = stepRes.mode;
    }

    const errX = replayedPos.x - this.position.x;
    const errY = replayedPos.y - this.position.y;
    const errZ = replayedPos.z - this.position.z;
    const errDistSq = errX * errX + errY * errY + errZ * errZ;

    if (errDistSq > 0.04) {
      // Hard correction for large deviation (> 0.2m)
      this.position = replayedPos;
      this.velocity = replayedVel;
      this.grounded = replayedGrounded;
      this.mode = replayedMode;
      this.syncViewPosition();
      this.view.setMode(this.mode);
    } else if (errDistSq > 0.0004) {
      // Smooth EMA correction for tiny discrepancies to prevent jitter (Subagent 38)
      this.position.x = this.position.x * 0.8 + replayedPos.x * 0.2;
      this.position.y = this.position.y * 0.8 + replayedPos.y * 0.2;
      this.position.z = this.position.z * 0.8 + replayedPos.z * 0.2;
      this.velocity = replayedVel;
      this.grounded = replayedGrounded;
      this.syncViewPosition();
    }
  }

  private syncViewPosition(): void {
    this.view.group.position.set(this.position.x, this.position.y, this.position.z);
    this.view.group.rotation.y = this.yaw;
  }

  updateVisuals(time: number): void {
    this.view.updateVisuals(this.invulnerable, time, this.ink);
  }

  dispose(): void {
    this.view.dispose();
  }
}
