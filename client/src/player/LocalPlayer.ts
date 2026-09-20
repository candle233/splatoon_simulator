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
import { PINK_COLOR, CYAN_COLOR } from './CharacterModels.js';
import * as THREE from 'three';

/**
 * Body-part vertical offsets within the character model, used for
 * client-predicted camera targeting and weapon attachment:
 * - Body center: Y=0.6 (torso)
 * - Head: Y=1.1
 * - Weapon mount: X=0.32, Y=0.85, Z=-0.3 (right hand, from PlayerView anchor)
 */
export const BODY_CENTER_Y = 0.6;
export const HEAD_Y = 1.1;
export const WEAPON_MOUNT_OFFSET: Readonly<Vec3> = { x: 0.32, y: 0.85, z: -0.3 };

const RAMP_LIFT_SPEED = 0.4;
const RAMP_STICK_MIN_SPEED = 0.5;
const WALL_RIDE_RANGE = 2.5;
const WALL_RIDE_LIFT_SPEED = 0.8;
const WALL_RIDE_FORWARD_SPEED = 0.3;
const WALL_RIDE_MIN_SPEED = 0.3;

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

  /** Smoothed position that gradually converges to server-reported position. */
  private _smoothPos: Vec3 = { x: 0, y: 0, z: 0 };
  /** Last server-reported position, used for velocity estimation. */
  private _lastSnapPos: Vec3 = { x: 0, y: 0, z: 0 };
  private _prevSnapPos: Vec3 | null = null;
  private _lastSnapTime = performance.now();
  private _prevSnapTime = performance.now();

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

    // Ramp climbing: when on a ramp and moving along its travel direction,
    // lift the player so they walk up naturally.
    if (stepGrounded) {
      const ramp = this.collisionWorld.getRampAt(this.position);
      if (ramp) {
        const horizSpeed = Math.sqrt(stepVel.x ** 2 + stepVel.z ** 2);
        if (horizSpeed >= RAMP_STICK_MIN_SPEED) {
          const dot = this.rampDirectionDot(ramp, stepVel.x, stepVel.z);
          if (dot > 0) {
            stepVel.y = RAMP_LIFT_SPEED * Math.min(dot, 1);
          }
        }
      }
    }

    // Wall-ride: when airborne and adjacent to a climbable surface, apply
    // small upward lift and push toward the wall.
    if (!stepGrounded) {
      const surf = this.collisionWorld.getClimbableSurfaceAt(this.position, WALL_RIDE_RANGE);
      if (surf && Math.abs(input.moveZ) >= WALL_RIDE_MIN_SPEED) {
        const sdx = surf.position.x - this.position.x;
        const sdz = surf.position.z - this.position.z;
        const dist = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
        stepVel.x += (sdx / dist) * WALL_RIDE_FORWARD_SPEED;
        stepVel.z += (sdz / dist) * WALL_RIDE_FORWARD_SPEED;
        stepVel.y = Math.min(stepVel.y + WALL_RIDE_LIFT_SPEED * dt * 30, WALL_RIDE_LIFT_SPEED);
      }
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

  /**
   * Returns the world-space weapon mount position (right hand).
   * Body center is at Y=BODY_CENTER_Y, head at Y=HEAD_Y in local space.
   * Uses PLAYER_HEIGHT (1.8) for total character height above ground.
   */
  getWeaponMountWorldPosition(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return out.set(
      this.position.x + WEAPON_MOUNT_OFFSET.x,
      this.position.y + WEAPON_MOUNT_OFFSET.y,
      this.position.z + WEAPON_MOUNT_OFFSET.z
    );
  }

  /** World-space body center (torso) position for camera targeting. */
  getBodyCenterWorldPosition(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + BODY_CENTER_Y, this.position.z);
  }

  /** World-space head position (for eye-level aiming). */
  getHeadWorldPosition(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + HEAD_Y, this.position.z);
  }

  /**
   * Gets the total character height above the feet.
   * Uses PLAYER_HEIGHT for humanoid form; SQUID_HEIGHT when submerged.
   */
  getCharacterHeight(): number {
    return this.mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;
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
      
      this._lastSnapTime = performance.now();
      this._lastSnapPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      this._prevSnapPos = null;
      this._smoothPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
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

    const errDist = Math.sqrt(errDistSq);
    const isDeadToAlive = !this.alive && snapshot.alive;

    if (isDeadToAlive) {
      // Smooth respawn transition: don't snap — drift the position toward
      // spawn over the next frames using the _smoothPos buffer.
      this._smoothPos = {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z
      };
      this._lastSnapPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      this._prevSnapPos = null;
      this._lastSnapTime = performance.now();
      
      this.velocity = replayedVel;
      this.grounded = replayedGrounded;
      this.mode = replayedMode;
      this.view.setMode(this.mode);
      this._applySmoothStep(replayedPos, 1.0); // first frame applies full correction
      this.syncViewPosition();
      return;
    }

    if (errDistSq > 0.0625) {
      // Hard correction: large deviation (> 0.25m = 0.5m threshold squared)
      // This catches genuine desyncs (lag spikes, reconnect) where prediction
      // is wrong — snap immediately rather than glide.
      this.position = { ...replayedPos };
      this._smoothPos = { ...replayedPos };
      this._lastSnapPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      this._prevSnapPos = null;
      this._lastSnapTime = performance.now();
      
      this.velocity = replayedVel;
      this.grounded = replayedGrounded;
      this.mode = replayedMode;
      this.view.setMode(this.mode);
      this.syncViewPosition();
    } else if (errDistSq > 0.0004) {
      // Smooth interpolation for moderate deviations (0.0004 to 0.25m range)
      // Use quadratic easing instead of fixed EMA for more natural convergence.
      const t = Math.min(1, errDist / 0.25); // normalised deviation [0,1]
      const ease = t * t * (3 - 2 * t); // smoothstep
      const alpha = 0.15 + ease * 0.65; // higher deviation → stronger pull
      this.position.x = this.position.x * (1 - alpha) + replayedPos.x * alpha;
      this.position.y = this.position.y * (1 - alpha) + replayedPos.y * alpha;
      this.position.z = this.position.z * (1 - alpha) + replayedPos.z * alpha;
      this._smoothPos = { ...this.position };
      this._lastSnapPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      
      this.velocity = replayedVel;
      this.grounded = replayedGrounded;
      this.mode = replayedMode;
      this.view.setMode(this.mode);
      this.syncViewPosition();
    }
  }

  /**
   * Applies a single smooth-step toward `target` with the given `t` factor
   * (0..1, 1 = full snap).  Uses quadratic easing so position changes
   * are monotonic and visually smooth — no visible jump.
   */
  private _applySmoothStep(target: Vec3, t: number): void {
    const s = t * t * (3 - 2 * t); // smoothstep
    this.position.x = this.position.x + (target.x - this.position.x) * s;
    this.position.y = this.position.y + (target.y - this.position.y) * s;
    this.position.z = this.position.z + (target.z - this.position.z) * s;
    this._smoothPos = { ...this.position };
  }

  private syncViewPosition(): void {
    this.view.group.position.set(this.position.x, this.position.y, this.position.z);
    this.view.group.rotation.y = this.yaw;
  }

  /**
   * Returns the dot product of the ramp's travel direction with the player's
   * horizontal velocity, normalized to [0,1] when they're aligned.
   */
  private rampDirectionDot(ramp: { direction: 'north' | 'south' | 'east' | 'west' }, vx: number, vz: number): number {
    const horiz = Math.sqrt(vx * vx + vz * vz);
    if (horiz < 0.001) return 0;
    const nx = vx / horiz;
    const nz = vz / horiz;
    switch (ramp.direction) {
      case 'north': return -nz;
      case 'south': return nz;
      case 'east':  return nx;
      case 'west':  return -nx;
    }
  }

  updateVisuals(time: number): void {
    this.view.updateVisuals(this.invulnerable, time, this.ink);
  }

  dispose(): void {
    this.view.dispose();
  }
}
