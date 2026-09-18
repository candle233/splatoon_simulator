import {
  ENEMY_INK_DOT,
  ENEMY_INK_SPEED,
  GRAVITY,
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_RATE,
  INK_REGEN_DELAY,
  INK_REGEN_NORMAL,
  INK_REGEN_SQUID,
  JUMP_VELOCITY,
  MAX_HP,
  MAX_INK,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PlayerInput,
  PlayerMode,
  RUN_SPEED,
  SQUID_HEIGHT,
  SQUID_SPEED,
  Team,
  clamp
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

    // 2. Mode & Speed Determination
    let currentSpeed = RUN_SPEED;
    let inkRegenRate = INK_REGEN_NORMAL;

    if (input.squid && isOwnInk && player.grounded) {
      player.mode = PlayerMode.SUBMERGED;
      currentSpeed = SQUID_SPEED;
      inkRegenRate = INK_REGEN_SQUID;
    } else {
      player.mode = PlayerMode.HUMANOID;
      if (isEnemyInk) {
        currentSpeed = ENEMY_INK_SPEED;
      } else {
        currentSpeed = RUN_SPEED;
      }
    }

    // 3. Enemy Ink Damage over Time (DoT)
    let diedByEnemyInk = false;
    if (isEnemyInk && !player.isInvulnerable(now)) {
      player.hp -= ENEMY_INK_DOT * dt;
      player.lastDamageTime = now;
      if (player.hp <= 0) {
        player.hp = 0;
        player.alive = false;
        player.mode = PlayerMode.DEAD;
        diedByEnemyInk = true;
        return { diedByEnemyInk };
      }
    }

    // 4. Out-of-combat Health Regeneration
    if (
      player.alive &&
      player.hp < MAX_HP &&
      !isEnemyInk &&
      now - player.lastDamageTime >= HEALTH_REGEN_DELAY * 1000
    ) {
      player.hp = Math.min(MAX_HP, player.hp + HEALTH_REGEN_RATE * dt);
    }

    // 5. Ink Regeneration
    if (player.alive && player.ink < MAX_INK && now - player.lastFiredTime >= INK_REGEN_DELAY * 1000) {
      player.ink = Math.min(MAX_INK, player.ink + inkRegenRate * dt);
    }

    // 6. Compute Desired Horizontal Velocity
    // Input moveX: -1 (left) to 1 (right)
    // Input moveZ: -1 (forward) to 1 (backward)
    // Note: yaw=0 points towards -Z, yaw=PI/2 points towards +X
    const sinYaw = Math.sin(player.yaw);
    const cosYaw = Math.cos(player.yaw);

    // Forward vector on X-Z plane: (-sinYaw, -cosYaw)
    // Right vector on X-Z plane: (cosYaw, -sinYaw)
    const forwardX = -sinYaw;
    const forwardZ = -cosYaw;
    const rightX = cosYaw;
    const rightZ = -sinYaw;

    // Invert moveZ so positive is forward
    const inputForward = -input.moveZ;
    const inputRight = input.moveX;

    let moveLen = Math.sqrt(inputRight * inputRight + inputForward * inputForward);
    let normRight = 0;
    let normForward = 0;
    if (moveLen > 1e-4) {
      if (moveLen > 1.0) {
        normRight = inputRight / moveLen;
        normForward = inputForward / moveLen;
      } else {
        normRight = inputRight;
        normForward = inputForward;
      }
    }

    const targetVx = (rightX * normRight + forwardX * normForward) * currentSpeed;
    const targetVz = (rightZ * normRight + forwardZ * normForward) * currentSpeed;

    player.velocity.x = targetVx;
    player.velocity.z = targetVz;

    // 7. Jump
    if (input.jump && player.grounded && player.mode === PlayerMode.HUMANOID) {
      player.velocity.y = JUMP_VELOCITY;
      player.grounded = false;
    }

    // 8. Gravity
    if (!player.grounded) {
      player.velocity.y += GRAVITY * dt;
    }

    // 9. Position Integration & Collision
    const radius = PLAYER_RADIUS;
    const height = player.mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    const prevPos = { ...player.position };
    const newPos = {
      x: player.position.x + player.velocity.x * dt,
      y: player.position.y + player.velocity.y * dt,
      z: player.position.z + player.velocity.z * dt
    };

    const res = this.collisionWorld.resolvePlayerMovement(player, prevPos, newPos, radius, height);
    player.grounded = res.grounded;

    return { diedByEnemyInk: false };
  }
}
