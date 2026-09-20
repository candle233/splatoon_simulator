import {
  MAX_INK,
  PlayerInput,
  PlayerMode,
  SUB_WEAPON_CONFIGS,
  Team,
  WEAPON_CONFIGS,
  clamp
} from '@ink/shared';
import { CollisionWorld } from './Collision.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';

type BotStateName = 'PATROL' | 'COMBAT' | 'REFILL';

interface BotMemory {
  state: BotStateName;
  waypoint: { x: number; z: number };
  nextDecisionAt: number;
  strafeDir: 1 | -1;
  nextStrafeFlipAt: number;
  chargeStartAt: number;
  nextSubAt: number;
  seq: number;
  stuckCheckAt: number;
  stuckX: number;
  stuckZ: number;
  jumpCooldownUntil: number;
}

const BOT_FIRST_NAMES = [
  'Nova',
  'Reef',
  'Coral',
  'Marina',
  'Kelp',
  'Bubbles',
  'Fin',
  'Tide',
  'Splashy',
  'Waver',
  'Turbo',
  'Misty'
];

export function makeBotName(counter: number): string {
  const base = BOT_FIRST_NAMES[counter % BOT_FIRST_NAMES.length];
  const round = Math.floor(counter / BOT_FIRST_NAMES.length);
  return round === 0 ? `BOT ${base}` : `BOT ${base} ${round + 1}`;
}

/**
 * Server-side bot brains. Every bot is a real PlayerState driven through the
 * same MovementSimulation / WeaponSimulation pipeline as humans; the brain
 * only produces the PlayerInput it "presses".
 */
export class BotAI {
  private memories = new Map<string, BotMemory>();
  private counter = 0;

  /** Allocates a name + id pair for a new bot. */
  nextIdentity(): { id: string; name: string } {
    this.counter++;
    return { id: `bot_${Date.now()}_${this.counter}`, name: makeBotName(this.counter) };
  }

  forget(botId: string): void {
    this.memories.delete(botId);
  }

  clear(): void {
    this.memories.clear();
  }

  getMemory(botId: string): BotMemory {
    let mem = this.memories.get(botId);
    if (!mem) {
      mem = {
        state: 'PATROL',
        waypoint: { x: 0, z: 0 },
        nextDecisionAt: 0,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        nextStrafeFlipAt: 0,
        chargeStartAt: 0,
        nextSubAt: 0,
        seq: 0,
        stuckCheckAt: 0,
        stuckX: 0,
        stuckZ: 0,
        jumpCooldownUntil: 0
      };
      this.memories.set(botId, mem);
    }
    return mem;
  }

  /**
   * Produces the input a bot "presses" this tick.
   * `thinkIntervalMs` bounds how often expensive target re-evaluation happens.
   */
  think(
    bot: PlayerState,
    allPlayers: PlayerState[],
    collisionWorld: CollisionWorld,
    paintGrid: PaintGrid,
    mapSize: number,
    now: number,
    thinkIntervalMs = 250
  ): PlayerInput {
    const mem = this.getMemory(bot.id);
    mem.seq++;

    const input: PlayerInput = {
      seq: mem.seq,
      moveX: 0,
      moveZ: 0,
      yaw: bot.yaw,
      pitch: 0,
      jump: false,
      squid: false,
      fire: false,
      clientTime: now
    };

    if (!bot.alive || bot.mode === PlayerMode.DEAD) {
      return input;
    }

    const half = mapSize / 2;
    const weaponConfig = WEAPON_CONFIGS[bot.weaponType] || WEAPON_CONFIGS.shooter;

    // --- periodic re-decision ---
    if (now >= mem.nextDecisionAt) {
      mem.nextDecisionAt = now + thinkIntervalMs + Math.random() * 150;

      // Stuck detection: no progress over ~1.6s -> new waypoint / hop
      if (now - mem.stuckCheckAt > 1600) {
        const moved = Math.hypot(bot.position.x - mem.stuckX, bot.position.z - mem.stuckZ);
        if (moved < 0.8 && mem.state === 'PATROL') {
          mem.waypoint = this.pickWaypoint(bot, half);
          if (now > mem.jumpCooldownUntil) {
            input.jump = true;
            mem.jumpCooldownUntil = now + 1200;
          }
        }
        mem.stuckCheckAt = now;
        mem.stuckX = bot.position.x;
        mem.stuckZ = bot.position.z;
      }
    }

    // --- REFILL: squid down on own ink when the tank is dry ---
    const groundInk = paintGrid.getInkAt(bot.position.x, bot.position.z);
    const isOwnInk = groundInk === bot.team;
    if (mem.state === 'REFILL') {
      if (bot.ink >= MAX_INK * 0.85 || bot.hp < 40) {
        mem.state = 'PATROL';
      } else {
        input.squid = bot.mode === PlayerMode.SUBMERGED || isOwnInk;
        return input;
      }
    } else if (bot.ink < MAX_INK * 0.2 && isOwnInk) {
      mem.state = 'REFILL';
      input.squid = true;
      return input;
    }

    // --- target acquisition ---
    const enemy = this.findVisibleEnemy(bot, allPlayers, collisionWorld, now);

    if (enemy) {
      mem.state = 'COMBAT';
      return this.combatInput(bot, enemy, mem, input, weaponConfig, now);
    }

    mem.state = 'PATROL';
    return this.patrolInput(bot, mem, input, weaponConfig, half, now);
  }

  private pickWaypoint(bot: PlayerState, half: number): { x: number; z: number } {
    // Bias toward the middle of the map where the turf war happens
    const bias = 0.7;
    const x = clamp(
      bot.position.x + (Math.random() - 0.5) * half * 1.2 - bot.position.x * (1 - bias) * 0.5,
      -half * 0.85,
      half * 0.85
    );
    const z = clamp(
      bot.position.z + (Math.random() - 0.5) * half * 1.2 - bot.position.z * (1 - bias) * 0.5,
      -half * 0.85,
      half * 0.85
    );
    return { x, z };
  }

  private findVisibleEnemy(
    bot: PlayerState,
    allPlayers: PlayerState[],
    collisionWorld: CollisionWorld,
    now: number
  ): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDist = 36; // max engagement range

    for (const other of allPlayers) {
      if (other.id === bot.id || !other.alive || other.team === bot.team) continue;
      if (other.isInvulnerable(now)) continue;
      const dist = Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z);
      if (dist >= bestDist) continue;
      if (this.hasLineOfSight(bot, other, collisionWorld, dist, allPlayers)) {
        best = other;
        bestDist = dist;
      }
    }
    return best;
  }

  private hasLineOfSight(
    bot: PlayerState,
    enemy: PlayerState,
    collisionWorld: CollisionWorld,
    dist: number,
    allPlayers: PlayerState[]
  ): boolean {
    const eyeY = bot.position.y + 1.4;
    const targetY = enemy.position.y + 1.0;
    const dx = enemy.position.x - bot.position.x;
    const dy = targetY - eyeY;
    const dz = enemy.position.z - bot.position.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    const hit = collisionWorld.castRay(
      {
        origin: { x: bot.position.x, y: eyeY, z: bot.position.z },
        direction: { x: dx / len, y: dy / len, z: dz / len }
      },
      dist + 1.5,
      allPlayers,
      bot.team,
      bot.id
    );

    // Visible when the first thing the ray meets is the enemy capsule
    if (!hit.hit) return false;
    return hit.hitPlayerId === enemy.id;
  }

  private combatInput(
    bot: PlayerState,
    enemy: PlayerState,
    mem: BotMemory,
    input: PlayerInput,
    weaponConfig: (typeof WEAPON_CONFIGS)[keyof typeof WEAPON_CONFIGS],
    now: number
  ): PlayerInput {
    const dx = enemy.position.x - bot.position.x;
    const dz = enemy.position.z - bot.position.z;
    const dist = Math.hypot(dx, dz) || 1;

    // Aim at the enemy chest with a touch of error
    const eyeY = bot.position.y + 1.4;
    const aimY = enemy.position.y + 0.9 + (Math.random() - 0.5) * 0.6;
    const dy = aimY - eyeY;
    const aimLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    input.yaw = Math.atan2(-dx, -dz);
    input.pitch = clamp(Math.asin(clamp(dy / aimLen, -1, 1)), -0.6, 0.6);

    // Preferred engagement range per weapon class (configs may override)
    const preferred =
      weaponConfig.preferredRange ??
      (bot.weaponType === 'charger' ? 26 : bot.weaponType === 'roller' ? 2.5 : bot.weaponType === 'slosher' ? 12 : 13);

    const nx = dx / dist;
    const nz = dz / dist;

    if (now >= mem.nextStrafeFlipAt) {
      mem.strafeDir = mem.strafeDir === 1 ? -1 : 1;
      mem.nextStrafeFlipAt = now + 900 + Math.random() * 1400;
    }

    let forward = 0;
    if (dist > preferred + 3) forward = -1;
    else if (dist < preferred - 2) forward = 1;

    input.moveX = mem.strafeDir * (forward === 0 ? 1 : 0.55);
    input.moveZ = forward;
    // Normalize diagonal
    const mLen = Math.hypot(input.moveX, input.moveZ);
    if (mLen > 1) {
      input.moveX /= mLen;
      input.moveZ /= mLen;
    }

    // Fire control
    if (bot.weaponType === 'charger') {
      if (mem.chargeStartAt === 0) {
        mem.chargeStartAt = now;
      }
      const charged = now - mem.chargeStartAt >= (weaponConfig.chargeTime ?? 1.0) * 1000;
      if (charged) {
        input.fire = true;
        input.chargeLevel = 0.9 + Math.random() * 0.1;
        mem.chargeStartAt = now + 300 + Math.random() * 400;
      }
    } else {
      input.fire = true;
    }

    // Sub weapon toss
    if (now >= mem.nextSubAt && bot.ink >= SUB_WEAPON_CONFIGS[weaponConfig.sub].inkCost) {
      input.subWeapon = true;
      mem.nextSubAt = now + 6000 + Math.random() * 5000;
    }

    // Special when charged and enemy in range
    if (bot.specialMeter >= 100 && dist < 30) {
      input.special = true;
    }

    return input;
  }

  private patrolInput(
    bot: PlayerState,
    mem: BotMemory,
    input: PlayerInput,
    weaponConfig: (typeof WEAPON_CONFIGS)[keyof typeof WEAPON_CONFIGS],
    half: number,
    now: number
  ): PlayerInput {
    const dx = mem.waypoint.x - bot.position.x;
    const dz = mem.waypoint.z - bot.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 2.5) {
      mem.waypoint = this.pickWaypoint(bot, half);
    }

    if (dist > 0.6) {
      input.yaw = Math.atan2(-dx, -dz);
      input.moveZ = -1; // forward in input space
      // paint the road ahead while patrolling
      input.pitch = -0.45;
      input.fire = bot.ink > weaponConfig.inkCost * 4;
    }

    // Occasionally hop to unstick from low geometry
    if (Math.random() < 0.01 && now > mem.jumpCooldownUntil) {
      input.jump = true;
      mem.jumpCooldownUntil = now + 1500;
    }

    return input;
  }
}
