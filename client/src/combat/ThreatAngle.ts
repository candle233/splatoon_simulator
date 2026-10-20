/** A recent shot, explosion, or special that might have hurt the local player. */
export interface ThreatSample {
  x: number;
  z: number;
  team: number;
  at: number;
}

/** A living opponent used when no recent shot explains the damage. */
export interface EnemySample {
  x: number;
  z: number;
  team: number;
  alive: boolean;
}

/** Shots older than this are no longer treated as the source of a hit. */
const SHOT_WINDOW_MS = 420;
/** Ignore gunfire whose origin is farther than a weapon could reasonably reach. */
const SHOT_RANGE = 36;
/** Bodies only explain a hit when they are close enough to be the attacker. */
const BODY_RANGE = 16;

/**
 * Clockwise radians from the player's facing to a world point.
 * `0` is straight ahead, positive is to the right. Yaw `0` looks toward -Z.
 */
export function threatAngle(yaw: number, fromX: number, fromZ: number, toX: number, toZ: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return Math.atan2(rx * dx + rz * dz, fx * dx + fz * dz);
}

/**
 * Picks the world point the damage most likely came from.
 * A recent enemy shot beats a nearby body; friendly fire and distant players are ignored.
 */
export function pickThreatPoint(
  now: number,
  enemyTeam: number,
  originX: number,
  originZ: number,
  threats: readonly ThreatSample[],
  enemies: readonly EnemySample[]
): { x: number; z: number } | null {
  let bestShot: { x: number; z: number; dist: number } | null = null;
  for (const threat of threats) {
    if (threat.team !== enemyTeam) continue;
    if (now - threat.at > SHOT_WINDOW_MS || now < threat.at) continue;
    const dist = Math.hypot(threat.x - originX, threat.z - originZ);
    if (dist > SHOT_RANGE) continue;
    if (!bestShot || dist < bestShot.dist) bestShot = { x: threat.x, z: threat.z, dist };
  }
  if (bestShot) return { x: bestShot.x, z: bestShot.z };

  let bestBody: { x: number; z: number; dist: number } | null = null;
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.team !== enemyTeam) continue;
    const dist = Math.hypot(enemy.x - originX, enemy.z - originZ);
    if (dist > BODY_RANGE || dist < 0.35) continue;
    if (!bestBody || dist < bestBody.dist) bestBody = { x: enemy.x, z: enemy.z, dist };
  }
  return bestBody ? { x: bestBody.x, z: bestBody.z } : null;
}
