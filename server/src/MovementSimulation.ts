import {
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PlayerInput,
  PlayerMode,
  SQUID_HEIGHT,
  Team,
  Vec3,
  clamp,
  computeMovementVelocity,
  enforceSpawnBarrier,
  getMovementSpeed,
  nextPlayerForm
} from '@ink/shared';
import type { RampObstacle } from '@ink/shared';
import { CollisionWorld } from './Collision.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';

const RAMP_LIFT_SPEED = 0.4;
const RAMP_STICK_MIN_SPEED = 0.5;
const WALL_RIDE_RANGE = 2.5;
const WALL_RIDE_LIFT_SPEED = 0.8;
const WALL_RIDE_FORWARD_SPEED = 0.3;
const WALL_RIDE_MIN_SPEED = 0.3;
const MAX_PAINT_UPDATE_PER_TICK = 8;

export class MovementSimulation {
  private collisionWorld: CollisionWorld;
  private paintGrid: PaintGrid;
  private mapSize = 100;
  private scratchPrevPos: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchNewPos: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(collisionWorld: CollisionWorld, paintGrid: PaintGrid) {
    this.collisionWorld = collisionWorld;
    this.paintGrid = paintGrid;
  }

  setMapSize(size: number): void {
    if (size > 0) {
      this.mapSize = size;
    }
  }

  /** Return [pinkFraction, cyanFraction] for nearby vertical paint surfaces. */
  getSurfacePaintUpdates(
    position: Vec3,
    maxSurfaces = MAX_PAINT_UPDATE_PER_TICK
  ): { id: string; paint: [number, number] }[] {
    const surfaces = this.paintGrid.getSurfaces();
    const out: { id: string; paint: [number, number] }[] = [];
    const range = WALL_RIDE_RANGE;
    for (const s of surfaces) {
      const hx = s.size.x * 0.5;
      const hz = s.size.z * 0.5;
      const qx = Math.max(s.position.x - hx, Math.min(s.position.x + hx, position.x));
      const qz = Math.max(s.position.z - hz, Math.min(s.position.z + hz, position.z));
      const dx = position.x - qx;
      const dz = position.z - qz;
      if (dx * dx + dz * dz < range * range) {
        out.push({ id: s.id, paint: this.paintGrid.getSurfacePaint(s.id) });
        if (out.length >= maxSurfaces) break;
      }
    }
    return out;
  }

  simulatePlayer(
    player: PlayerState,
    input: PlayerInput,
    dt: number,
    now: number = Date.now()
  ): { diedByEnemyInk: boolean } {
    if (!player.alive) {
      return { diedByEnemyInk: false };
    }

    // Update orientation from input
    player.yaw = input.yaw;
    player.pitch = input.pitch;
    player.lastProcessedInputSeq = input.seq;

    // 1. Query Ground Ink
    const groundInk = this.paintGrid.getInkAt(player.position.x, player.position.z);
    const isEnemyInk =
      player.team === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;
    const isOwnInk = groundInk === player.team;

    // 2. Mode & Speed Determination via shared pure functions (Subagents 08 & 11)
    player.mode = nextPlayerForm(
      player.mode,
      player.alive,
      player.grounded,
      Boolean(input.squid),
      groundInk,
      player.team
    );
    let currentSpeed = getMovementSpeed(player.mode, groundInk, player.team, player.skills);
    if (
      player.mode === PlayerMode.HUMANOID &&
      input.chargeLevel &&
      input.chargeLevel > 0.05 &&
      (input.weaponType === 'charger' || player.weaponType === 'charger')
    ) {
      const chargeSlow = Math.max(0.5, 1.0 - input.chargeLevel * 0.5);
      currentSpeed *= chargeSlow;
    }

    // 3. Enemy Ink Damage over Time (DoT) via PlayerState (Subagent 19)
    let diedByEnemyInk = false;
    if (isEnemyInk) {
      diedByEnemyInk = player.updateEnemyInkDOT(dt, now);
      if (diedByEnemyInk) {
        return { diedByEnemyInk: true };
      }
    }

    // 4. Out-of-combat Health Regeneration (Subagent 19)
    player.updateHealthRegen(dt, isEnemyInk, now);

    // 5. Ink Regeneration (Subagent 18)
    const isSquidInOwnInk = player.mode === PlayerMode.SUBMERGED && isOwnInk;
    player.updateInkRegen(dt, isSquidInOwnInk, now);

    // 6. Compute Desired Horizontal Velocity via shared pure function (Subagents 05 & 08)
    const { vx, vz } = computeMovementVelocity(player.yaw, input.moveX, input.moveZ, currentSpeed);
    player.velocity.x = vx;
    player.velocity.z = vz;

    // 7. Jump
    if (input.jump && player.grounded) {
      player.velocity.y = JUMP_VELOCITY;
      player.grounded = false;
    }

    // 8. Ramp climbing: when on a ramp and moving along its travel direction,
    //    lift the player so they walk up/down the ramp naturally.
    if (player.grounded) {
      const ramp = this.collisionWorld.getRampAt(player.position);
      if (ramp) {
        const horizSpeed = Math.sqrt(player.velocity.x ** 2 + player.velocity.z ** 2);
        if (horizSpeed >= RAMP_STICK_MIN_SPEED) {
          const dot = this.rampDirectionDot(ramp, player.velocity.x, player.velocity.z);
          const slope = ramp.rise / ramp.length;
          player.velocity.y = slope * horizSpeed * dot;
        }
      }
    }

    // 9. Wall-ride / squid vertical climb: when airborne and adjacent to a climbable surface,
    //    squids swim up rapidly while humanoids get wall-hang lift.
    if (!player.grounded) {
      const surf = this.collisionWorld.getClimbableSurfaceAt(player.position, WALL_RIDE_RANGE);
      if (surf && Math.abs(input.moveZ) >= WALL_RIDE_MIN_SPEED) {
        const hx = surf.size.x * 0.5;
        const hz = surf.size.z * 0.5;
        const qx = Math.max(surf.position.x - hx, Math.min(surf.position.x + hx, player.position.x));
        const qz = Math.max(surf.position.z - hz, Math.min(surf.position.z + hz, player.position.z));
        let sdx = qx - player.position.x;
        let sdz = qz - player.position.z;
        let dist = Math.hypot(sdx, sdz);
        if (dist < 0.001) {
          sdx = -surf.normal.x;
          sdz = -surf.normal.z;
          dist = Math.hypot(sdx, sdz) || 1;
        }
        const isSquid = Boolean(input.squid) || player.mode === PlayerMode.SUBMERGED;
        const topY = surf.position.y + surf.size.y * 0.5;
        if (isSquid) {
          player.mode = PlayerMode.SUBMERGED;
          if (player.position.y >= topY - 0.35) {
            // Near top ledge: pop/mantle onto roof platform
            player.velocity.x += (sdx / dist) * 1.8;
            player.velocity.z += (sdz / dist) * 1.8;
            player.velocity.y = Math.max(1.8, player.velocity.y * 0.4);
          } else {
            player.velocity.x += (sdx / dist) * 0.8;
            player.velocity.z += (sdz / dist) * 0.8;
            player.velocity.y = 6.2 - GRAVITY * dt;
          }
        } else {
          player.velocity.x += (sdx / dist) * WALL_RIDE_FORWARD_SPEED;
          player.velocity.z += (sdz / dist) * WALL_RIDE_FORWARD_SPEED;
          player.velocity.y = Math.min(player.velocity.y + WALL_RIDE_LIFT_SPEED * dt * 30, WALL_RIDE_LIFT_SPEED);
        }
      }
    }

    // 10. Gravity
    if (!player.grounded) {
      player.velocity.y += GRAVITY * dt;
    }

    // 11. Position Integration & Collision with Cheat Validation
    const radius = PLAYER_RADIUS;
    const height = player.mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    this.scratchPrevPos.x = player.position.x;
    this.scratchPrevPos.y = player.position.y;
    this.scratchPrevPos.z = player.position.z;

    let newX = player.position.x + player.velocity.x * dt;
    let newY = player.position.y + player.velocity.y * dt;
    let newZ = player.position.z + player.velocity.z * dt;

    // Sanitize NaN / Infinity
    if (!Number.isFinite(newX) || !Number.isFinite(newY) || !Number.isFinite(newZ)) {
      newX = this.scratchPrevPos.x;
      newY = this.scratchPrevPos.y;
      newZ = this.scratchPrevPos.z;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
    }

    // Clamp vertical ceiling to avoid flight exploits
    newY = Math.max(-5, Math.min(30, newY));

    this.scratchNewPos.x = newX;
    this.scratchNewPos.y = newY;
    this.scratchNewPos.z = newZ;

    const res = this.collisionWorld.resolvePlayerMovement(
      player,
      this.scratchPrevPos,
      this.scratchNewPos,
      radius,
      height
    );
    player.grounded = res.grounded;
    player.position = enforceSpawnBarrier(player.position, player.team, this.mapSize * 0.4);

    return { diedByEnemyInk: false };
  }

  /**
   * Returns the dot product of the ramp's travel direction with the player's
   * horizontal velocity, normalized to [0,1] when they're aligned.
   */
  private rampDirectionDot(ramp: RampObstacle, vx: number, vz: number): number {
    const horiz = Math.sqrt(vx ** 2 + vz ** 2);
    if (horiz < 0.001) return 0;
    const nx = vx / horiz;
    const nz = vz / horiz;
    switch (ramp.direction) {
      case 'north':
        return -nz;
      case 'south':
        return nz;
      case 'east':
        return nx;
      case 'west':
        return -nx;
    }
  }
}
