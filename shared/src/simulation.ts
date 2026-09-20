import {
  ENEMY_INK_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  RUN_SPEED,
  SQUID_SPEED
} from './config.js';
import { skillMultiplier } from './skills.js';
import { PlayerMode, SkillId, Team, Vec3 } from './types.js';

/**
 * Pure Player Form State Machine Transition (Subagent 11)
 *
 * Rules:
 * - Default: HUMANOID
 * - Can enter SUBMERGED only if alive, grounded, squid (Shift) pressed, and groundInk === team (own ink).
 * - Must exit SUBMERGED if squid released, airborne (!grounded), groundInk !== team, or !alive.
 * - Neutral ink: Swimming forbidden.
 * - Enemy ink: Forced exit from submerged form.
 */
export function nextPlayerForm(
  currentForm: PlayerMode,
  alive: boolean,
  grounded: boolean,
  squidPressed: boolean,
  groundInk: Team,
  playerTeam: Team
): PlayerMode {
  if (!alive) {
    return PlayerMode.DEAD;
  }

  const isOwnInk = groundInk === playerTeam && playerTeam !== Team.NEUTRAL;

  if (squidPressed && isOwnInk && grounded) {
    return PlayerMode.SUBMERGED;
  }

  return PlayerMode.HUMANOID;
}

/**
 * Computes speed modifier based on ground ink and player form (Subagent 08).
 *
 * `skills` applies the run_speed (humanoid) / swim_speed (submerged) gear
 * skills. Enemy-ink movement is intentionally left unmodified: those skills
 * only boost a player's own locomotion, not the enemy-ink crawl.
 */
export function getMovementSpeed(
  form: PlayerMode,
  groundInk: Team,
  playerTeam: Team,
  skills?: SkillId[] | null
): number {
  if (form === PlayerMode.SUBMERGED) {
    return SQUID_SPEED * skillMultiplier(skills, 'swim_speed');
  }

  const isEnemyInk =
    playerTeam === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;

  if (isEnemyInk) {
    return ENEMY_INK_SPEED; // RUN_SPEED * 0.3
  }

  return RUN_SPEED * skillMultiplier(skills, 'run_speed');
}

/**
 * Computes normalized planar horizontal velocity vectors based on yaw and WASD input (Subagent 08)
 *
 * Prevents diagonal movement from exceeding 1.0 (no sqrt(2) speed boost).
 */
export function computeMovementVelocity(
  yaw: number,
  moveX: number,
  moveZ: number,
  speed: number
): { vx: number; vz: number } {
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  // Forward vector on X-Z plane: (-sinYaw, -cosYaw)
  // Right vector on X-Z plane: (cosYaw, -sinYaw)
  const forwardX = -sinYaw;
  const forwardZ = -cosYaw;
  const rightX = cosYaw;
  const rightZ = -sinYaw;

  const inputForward = -moveZ;
  const inputRight = moveX;

  const moveLen = Math.sqrt(inputRight * inputRight + inputForward * inputForward);
  if (moveLen <= 1e-4) {
    return { vx: 0, vz: 0 };
  }

  const normRight = moveLen > 1.0 ? inputRight / moveLen : inputRight;
  const normForward = moveLen > 1.0 ? inputForward / moveLen : inputForward;

  return {
    vx: (rightX * normRight + forwardX * normForward) * speed,
    vz: (rightZ * normRight + forwardZ * normForward) * speed
  };
}

/**
 * Pure Euler integration step for vertical kinematics (Subagent 08)
 */
export function integrateVerticalKinematics(
  vy: number,
  grounded: boolean,
  jump: boolean,
  dt: number,
  jumpVelocity = JUMP_VELOCITY,
  gravity = GRAVITY
): { vy: number; grounded: boolean } {
  let newVy = vy;
  let newGrounded = grounded;

  if (jump && newGrounded) {
    newVy = jumpVelocity;
    newGrounded = false;
  }

  if (!newGrounded) {
    newVy += gravity * dt;
  }

  return { vy: newVy, grounded: newGrounded };
}

/**
 * Enforces team base spawn barrier protection (Subagent 80)
 * Prevents enemy players from infiltrating the opposing team's spawn platform.
 * `spawnX` is the |x| of the spawn rows (defaults to the legacy 40).
 */
export function enforceSpawnBarrier(pos: Vec3, team: Team, spawnX = 40): Vec3 {
  const barrierX = spawnX - 5;
  // Pink home base protection (|z| < 10, x < -barrierX)
  if (team === Team.CYAN && pos.x < -barrierX && Math.abs(pos.z) < 10) {
    return { ...pos, x: -barrierX };
  }
  // Cyan home base protection (|z| < 10, x > barrierX)
  if (team === Team.PINK && pos.x > barrierX && Math.abs(pos.z) < 10) {
    return { ...pos, x: barrierX };
  }
  return pos;
}

