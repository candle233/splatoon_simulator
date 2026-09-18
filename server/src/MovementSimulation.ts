import {
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PlayerInput,
  PlayerMode,
  SQUID_HEIGHT,
  Team,
  clamp,
  computeMovementVelocity,
  enforceSpawnBarrier,
  getMovementSpeed,
  nextPlayerForm
} from '@ink/shared';
import { CollisionWorld } from './Collision.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';

export class MovementSimulation {
  private collisionWorld: CollisionWorld;
  private paintGrid: PaintGrid;

  constructor(collisionWorld: CollisionWorld, paintGrid: PaintGrid) {
    this.collisionWorld = collisionWorld;
    this.paintGrid = paintGrid;
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
    const currentSpeed = getMovementSpeed(player.mode, groundInk, player.team);

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

    // 8. Gravity
    if (!player.grounded) {
      player.velocity.y += GRAVITY * dt;
    }

    // 9. Position Integration & Collision with Cheat Validation
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
    player.position = enforceSpawnBarrier(player.position, player.team);

    return { diedByEnemyInk: false };
  }
}
