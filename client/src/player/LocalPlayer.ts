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
  isClimbingWall = false;

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
  private scratchStepVel: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchNewPos: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchStepResult = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: false,
    mode: PlayerMode.HUMANOID
  };
  private scratchCurReplayedPos: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchCurReplayedVel: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchReplayedPos: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchReplayedVel: Vec3 = { x: 0, y: 0, z: 0 };

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
    let effectiveMode = mode;
    let currentSpeed = getMovementSpeed(mode, groundInk, this.team, this.skills);
    if (
      mode === PlayerMode.HUMANOID &&
      input.chargeLevel &&
      input.chargeLevel > 0.05 &&
      input.weaponType === 'charger'
    ) {
      const chargeSlow = Math.max(0.5, 1.0 - input.chargeLevel * 0.5);
      currentSpeed *= chargeSlow;
    }
    const { vx, vz } = computeMovementVelocity(input.yaw, input.moveX, input.moveZ, currentSpeed);

    const stepVel = this.scratchStepVel;
    stepVel.x = vx;
    stepVel.y = vel.y;
    stepVel.z = vz;

    let stepGrounded = grounded;
    if (input.jump && stepGrounded) {
      stepVel.y = JUMP_VELOCITY;
      stepGrounded = false;
    }

    // Ramp climbing: when on a ramp and moving along its travel direction,
    // lift the player so they walk up/down naturally.
    if (stepGrounded) {
      const ramp = this.collisionWorld.getRampAt(this.position);
      if (ramp) {
        const horizSpeed = Math.sqrt(stepVel.x ** 2 + stepVel.z ** 2);
        if (horizSpeed >= RAMP_STICK_MIN_SPEED) {
          const dot = this.rampDirectionDot(ramp, stepVel.x, stepVel.z);
          const slope = ramp.rise / ramp.length;
          stepVel.y = slope * horizSpeed * dot;
        }
      }
    }

    // Wall-ride / squid vertical climb: when airborne and adjacent to a climbable surface,
    // squids swim up rapidly while humanoids get wall-hang lift.
    let isClimbing = false;
    if (!stepGrounded) {
      const surf = this.collisionWorld.getClimbableSurfaceAt(this.position, WALL_RIDE_RANGE);
      if (surf && Math.abs(input.moveZ) >= WALL_RIDE_MIN_SPEED) {
        const hx = surf.size.x * 0.5;
        const hz = surf.size.z * 0.5;
        const qx = Math.max(surf.position.x - hx, Math.min(surf.position.x + hx, this.position.x));
        const qz = Math.max(surf.position.z - hz, Math.min(surf.position.z + hz, this.position.z));
        let sdx = qx - this.position.x;
        let sdz = qz - this.position.z;
        let dist = Math.hypot(sdx, sdz);
        if (dist < 0.001) {
          sdx = -surf.normal.x;
          sdz = -surf.normal.z;
          dist = Math.hypot(sdx, sdz) || 1;
        }
        const isSquid = Boolean(input.squid) || mode === PlayerMode.SUBMERGED;
        const topY = surf.position.y + surf.size.y * 0.5;
        if (isSquid) {
          isClimbing = true;
          effectiveMode = PlayerMode.SUBMERGED;
          if (this.position.y >= topY - 0.35) {
            // Near top ledge: pop/mantle onto roof platform
            stepVel.x += (sdx / dist) * 1.8;
            stepVel.z += (sdz / dist) * 1.8;
            stepVel.y = Math.max(1.8, stepVel.y * 0.4);
          } else {
            stepVel.x += (sdx / dist) * 0.8;
            stepVel.z += (sdz / dist) * 0.8;
            stepVel.y = 6.2 - GRAVITY * dt;
          }
        } else {
          stepVel.x += (sdx / dist) * WALL_RIDE_FORWARD_SPEED;
          stepVel.z += (sdz / dist) * WALL_RIDE_FORWARD_SPEED;
          stepVel.y = Math.min(stepVel.y + WALL_RIDE_LIFT_SPEED * dt * 30, WALL_RIDE_LIFT_SPEED);
        }
      }
    }
    this.isClimbingWall = isClimbing;

    if (!stepGrounded) {
      stepVel.y += GRAVITY * dt;
    }

    const radius = PLAYER_RADIUS;
    const height = (effectiveMode ?? mode) === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    const newPos = this.scratchNewPos;
    newPos.x = pos.x + stepVel.x * dt;
    newPos.y = pos.y + stepVel.y * dt;
    newPos.z = pos.z + stepVel.z * dt;

    const res = this.collisionWorld.resolveMovement(
      pos,
      newPos,
      radius,
      height,
      stepVel
    );

    const finalPos = enforceSpawnBarrier(res.position, this.team);
    this.scratchStepResult.position.x = finalPos.x;
    this.scratchStepResult.position.y = finalPos.y;
    this.scratchStepResult.position.z = finalPos.z;
    this.scratchStepResult.velocity.x = res.velocity.x;
    this.scratchStepResult.velocity.y = res.velocity.y;
    this.scratchStepResult.velocity.z = res.velocity.z;
    this.scratchStepResult.grounded = res.grounded;
    this.scratchStepResult.mode = effectiveMode ?? mode;
    return this.scratchStepResult;
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

    this.position.x = res.position.x;
    this.position.y = res.position.y;
    this.position.z = res.position.z;
    this.velocity.x = res.velocity.x;
    this.velocity.y = res.velocity.y;
    this.velocity.z = res.velocity.z;
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

  triggerShootRecoil(weaponType?: WeaponType, customStrength?: number): void {
    const type = weaponType || this.weaponType;
    let amount = 0.18;
    if (customStrength !== undefined) {
      amount = customStrength;
    } else {
      switch (type) {
        case 'cannon':
          amount = 0.42;
          break;
        case 'scatter':
          amount = 0.36;
          break;
        case 'charger':
          amount = 0.30;
          break;
        case 'roller':
          amount = 0.28;
          break;
        case 'slosher':
          amount = 0.24;
          break;
        case 'marksman':
          amount = 0.22;
          break;
        case 'shooter':
          amount = 0.16;
          break;
        case 'sprayer':
          amount = 0.09;
          break;
      }
    }
    this.view.triggerRecoil(amount);
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
    let replayedPosX = snapshot.x;
    let replayedPosY = snapshot.y;
    let replayedPosZ = snapshot.z;
    let replayedVelX = this.velocity.x;
    let replayedVelY = this.velocity.y;
    let replayedVelZ = this.velocity.z;
    let replayedGrounded = this.grounded;
    let replayedMode = snapshot.mode;

    for (const item of this.pendingInputs) {
      this.scratchCurReplayedPos.x = replayedPosX;
      this.scratchCurReplayedPos.y = replayedPosY;
      this.scratchCurReplayedPos.z = replayedPosZ;
      this.scratchCurReplayedVel.x = replayedVelX;
      this.scratchCurReplayedVel.y = replayedVelY;
      this.scratchCurReplayedVel.z = replayedVelZ;

      const stepRes = this.simulateStep(
        this.scratchCurReplayedPos,
        this.scratchCurReplayedVel,
        replayedGrounded,
        item.input,
        item.dt,
        item.groundInk
      );
      replayedPosX = stepRes.position.x;
      replayedPosY = stepRes.position.y;
      replayedPosZ = stepRes.position.z;
      replayedVelX = stepRes.velocity.x;
      replayedVelY = stepRes.velocity.y;
      replayedVelZ = stepRes.velocity.z;
      replayedGrounded = stepRes.grounded;
      replayedMode = stepRes.mode;
    }

    const replayedPos = this.scratchReplayedPos;
    replayedPos.x = replayedPosX;
    replayedPos.y = replayedPosY;
    replayedPos.z = replayedPosZ;

    const replayedVel = this.scratchReplayedVel;
    replayedVel.x = replayedVelX;
    replayedVel.y = replayedVelY;
    replayedVel.z = replayedVelZ;

    const errX = replayedPosX - this.position.x;
    const errY = replayedPosY - this.position.y;
    const errZ = replayedPosZ - this.position.z;
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
      
      this.velocity.x = replayedVel.x;
      this.velocity.y = replayedVel.y;
      this.velocity.z = replayedVel.z;
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
      this.position.x = replayedPos.x;
      this.position.y = replayedPos.y;
      this.position.z = replayedPos.z;
      if (this._smoothPos) {
        this._smoothPos.x = replayedPos.x;
        this._smoothPos.y = replayedPos.y;
        this._smoothPos.z = replayedPos.z;
      } else {
        this._smoothPos = { x: replayedPos.x, y: replayedPos.y, z: replayedPos.z };
      }
      this._lastSnapPos.x = snapshot.x;
      this._lastSnapPos.y = snapshot.y;
      this._lastSnapPos.z = snapshot.z;
      this._prevSnapPos = null;
      this._lastSnapTime = performance.now();
      
      this.velocity.x = replayedVel.x;
      this.velocity.y = replayedVel.y;
      this.velocity.z = replayedVel.z;
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
      if (this._smoothPos) {
        this._smoothPos.x = this.position.x;
        this._smoothPos.y = this.position.y;
        this._smoothPos.z = this.position.z;
      } else {
        this._smoothPos = { x: this.position.x, y: this.position.y, z: this.position.z };
      }
      this._lastSnapPos.x = snapshot.x;
      this._lastSnapPos.y = snapshot.y;
      this._lastSnapPos.z = snapshot.z;
      
      this.velocity.x = replayedVel.x;
      this.velocity.y = replayedVel.y;
      this.velocity.z = replayedVel.z;
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
