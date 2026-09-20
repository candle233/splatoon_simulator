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
    const surfaces = this.paintGrid.getSurfacePaintSnapshots();
    const out: { id: string; paint: [number, number] }[] = [];
    const range = WALL_RIDE_RANGE;
    for (const s of surfaces) {
      const dx = position.x - s.position.x;
      const dz = position.z - s.position.z;
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
    const currentSpeed = getMovementSpeed(player.mode, groundInk, player.team, player.skills);

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
    //    lift the player so they walk up the ramp naturally.
    if (player.grounded) {
      const ramp = this.collisionWorld.getRampAt(player.position);
      if (ramp) {
        const horizSpeed = Math.sqrt(player.velocity.x ** 2 + player.velocity.z ** 2);
        if (horizSpeed >= RAMP_STICK_MIN_SPEED) {
          const dot = this.rampDirectionDot(ramp, player.velocity.x, player.velocity.z);
          if (dot > 0) {
            player.velocity.y = RAMP_LIFT_SPEED * Math.min(dot, 1);
          }
        }
      }
    }

    // 9. Wall-ride / slow climb: when airborne and adjacent to a climbable surface,
    //    apply a small upward lift and push toward the wall.
    if (!player.grounded) {
      const surf = this.collisionWorld.getClimbableSurfaceAt(player.position, WALL_RIDE_RANGE);
      if (surf && Math.abs(input.moveZ) >= WALL_RIDE_MIN_SPEED) {
        const sdx = surf.position.x - player.position.x;
        const sdz = surf.position.z - player.position.z;
        const dist = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
        player.velocity.x += (sdx / dist) * WALL_RIDE_FORWARD_SPEED;
        player.velocity.z += (sdz / dist) * WALL_RIDE_FORWARD_SPEED;
        player.velocity.y = Math.min(player.velocity.y + WALL_RIDE_LIFT_SPEED * dt * 30, WALL_RIDE_LIFT_SPEED);
      }
    }

    // 10. Gravity
    if (!player.grounded) {
      player.velocity.y += GRAVITY * dt;
    }

    // 11. Position Integration & Collision with Cheat Validation
    const radius = PLAYER_RADIUS;
    const height = player.mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    const prevPos = { ...player.position };
    let newX = player.position.x + player.velocity.x * dt;
    let newY = player.position.y + player.velocity.y * dt;
    let newZ = player.position.z + player.velocity.z * dt;

    // Sanitize NaN / Infinity
    if (!Number.isFinite(newX) || !Number.isFinite(newY) || !Number.isFinite(newZ)) {
      newX = prevPos.x;
      newY = prevPos.y;
      newZ = prevPos.z;
      player.velocity = { x: 0, y: 0, z: 0 };
    }

    // Clamp vertical ceiling to avoid flight exploits
    newY = Math.max(-5, Math.min(30, newY));

    const newPos = { x: newX, y: newY, z: newZ };

    const res = this.collisionWorld.resolvePlayerMovement(player, prevPos, newPos, radius, height);
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
