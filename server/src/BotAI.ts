import {
  MAX_INK,
  PlayerInput,
  PlayerMode,
  RampObstacle,
  Ray,
  SUB_WEAPON_CONFIGS,
  Team,
  Vec3,
  WEAPON_CONFIGS,
  clamp
} from '@ink/shared';
import { CollisionWorld } from './Collision.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';

type BotStateName = 'PATROL' | 'COMBAT' | 'REFILL';

const EMPTY_PLAYERS: PlayerState[] = [];

export function getRampFoot(ramp: RampObstacle, out?: Vec3): Vec3 {
  const baseY = ramp.position.y - ramp.rise / 2;
  const res = out ?? { x: 0, y: 0, z: 0 };
  res.y = baseY;
  switch (ramp.direction) {
    case 'north':
      res.x = ramp.position.x;
      res.z = ramp.position.z + ramp.length / 2;
      return res;
    case 'south':
      res.x = ramp.position.x;
      res.z = ramp.position.z - ramp.length / 2;
      return res;
    case 'east':
      res.x = ramp.position.x - ramp.length / 2;
      res.z = ramp.position.z;
      return res;
    case 'west':
      res.x = ramp.position.x + ramp.length / 2;
      res.z = ramp.position.z;
      return res;
  }
}

export function getRampCrest(ramp: RampObstacle, out?: Vec3): Vec3 {
  const crestY = ramp.position.y + ramp.rise / 2;
  const res = out ?? { x: 0, y: 0, z: 0 };
  res.y = crestY;
  switch (ramp.direction) {
    case 'north':
      res.x = ramp.position.x;
      res.z = ramp.position.z - ramp.length / 2;
      return res;
    case 'south':
      res.x = ramp.position.x;
      res.z = ramp.position.z + ramp.length / 2;
      return res;
    case 'east':
      res.x = ramp.position.x + ramp.length / 2;
      res.z = ramp.position.z;
      return res;
    case 'west':
      res.x = ramp.position.x - ramp.length / 2;
      res.z = ramp.position.z;
      return res;
  }
}

interface BotMemory {
  state: BotStateName;
  waypoint: Vec3;
  subWaypoint?: Vec3 | null;
  rampStage?: 'approach' | 'traverse' | null;
  activeRampId?: string | null;
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
  cachedInput?: PlayerInput;
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
  private scratchRay: Ray = {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 }
  };
  private scratchFoot: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchCrest: Vec3 = { x: 0, y: 0, z: 0 };

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
        waypoint: { x: 0, y: 0, z: 0 },
        subWaypoint: null,
        nextDecisionAt: 0,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        nextStrafeFlipAt: 0,
        chargeStartAt: 0,
        nextSubAt: 0,
        seq: 0,
        stuckCheckAt: 0,
        stuckX: 0,
        stuckZ: 0,
        jumpCooldownUntil: 0,
        cachedInput: {
          seq: 0,
          moveX: 0,
          moveZ: 0,
          yaw: 0,
          pitch: 0,
          jump: false,
          squid: false,
          fire: false,
          clientTime: 0
        }
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

    const input = mem.cachedInput!;
    input.seq = mem.seq;
    input.moveX = 0;
    input.moveZ = 0;
    input.yaw = bot.yaw;
    input.pitch = 0;
    input.jump = false;
    input.squid = false;
    input.fire = false;
    input.special = false;
    input.subWeapon = false;
    input.clientTime = now;

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
          mem.subWaypoint = null;
          mem.waypoint = this.pickWaypoint(bot, half, collisionWorld);
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
    return this.patrolInput(bot, mem, input, weaponConfig, collisionWorld, half, now);
  }

  private pickWaypoint(bot: PlayerState, half: number, collisionWorld?: CollisionWorld): Vec3 {
    const ramps = collisionWorld?.getRamps() ?? [];
    const roll = Math.random();

    // 40% chance: target an elevated ramp crest or platform top
    if (ramps.length > 0 && roll < 0.4) {
      const ramp = ramps[Math.floor(Math.random() * ramps.length)];
      if (ramp) return getRampCrest(ramp);
    }

    // 30% chance: target a ramp foot / approach
    if (ramps.length > 0 && roll < 0.7) {
      const ramp = ramps[Math.floor(Math.random() * ramps.length)];
      if (ramp) return getRampFoot(ramp);
    }

    // 30% chance: midfield turf
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
    const y = collisionWorld ? collisionWorld.getGroundHeightAt(x, z, bot.position.y + 1.5) : 0;
    return { x, y, z };
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

    this.scratchRay.origin.x = bot.position.x;
    this.scratchRay.origin.y = eyeY;
    this.scratchRay.origin.z = bot.position.z;
    this.scratchRay.direction.x = dx / len;
    this.scratchRay.direction.y = dy / len;
    this.scratchRay.direction.z = dz / len;

    const hit = collisionWorld.castRay(
      this.scratchRay,
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
    input.pitch = clamp(Math.asin(clamp(dy / aimLen, -1, 1)), -1.3, 1.3);

    // Preferred engagement range per weapon class (configs may override)
    const preferred =
      weaponConfig.preferredRange ??
      (bot.weaponType === 'charger' ? 26 : bot.weaponType === 'roller' ? 2.5 : bot.weaponType === 'slosher' ? 12 : 13);

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

    // Sub weapon toss with high ground advantage
    const isHighGround = bot.position.y > enemy.position.y + 1.2;
    const subCost = SUB_WEAPON_CONFIGS[weaponConfig.sub]?.inkCost ?? 40;
    if (
      (isHighGround ? now >= mem.nextSubAt - 2000 : now >= mem.nextSubAt) &&
      bot.ink >= subCost
    ) {
      input.subWeapon = true;
      mem.nextSubAt = now + (isHighGround ? 4500 : 7000) + Math.random() * 3000;
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
    collisionWorld: CollisionWorld,
    half: number,
    now: number
  ): PlayerInput {
    // If the destination elevation differs significantly and we do not have an active ramp route,
    // route through the best ramp.
    const elevDiff = mem.waypoint.y - bot.position.y;
    const ramps = collisionWorld.getRamps();
    if (Math.abs(elevDiff) > 1.2 && !mem.subWaypoint) {
      if (ramps.length > 0) {
        let bestRamp: RampObstacle | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const r of ramps) {
          const foot = getRampFoot(r, this.scratchFoot);
          const crest = getRampCrest(r, this.scratchCrest);
          const distToBot =
            elevDiff > 0
              ? Math.hypot(foot.x - bot.position.x, foot.z - bot.position.z)
              : Math.hypot(crest.x - bot.position.x, crest.z - bot.position.z);
          const distToTarget =
            elevDiff > 0
              ? Math.hypot(crest.x - mem.waypoint.x, crest.z - mem.waypoint.z)
              : Math.hypot(foot.x - mem.waypoint.x, foot.z - mem.waypoint.z);
          const score = distToBot + distToTarget * 0.5;
          if (score < bestScore) {
            bestScore = score;
            bestRamp = r;
          }
        }
        if (bestRamp) {
          mem.activeRampId = bestRamp.id;
          mem.rampStage = 'approach';
          mem.subWaypoint = elevDiff > 0 ? getRampFoot(bestRamp) : getRampCrest(bestRamp);
        }
      }
    }

    // Cancel ramp sub-waypoint if bot has already reached target elevation
    if (mem.subWaypoint && Math.abs(mem.waypoint.y - bot.position.y) <= 0.8) {
      mem.subWaypoint = null;
      mem.rampStage = null;
      mem.activeRampId = null;
    }

    const target = mem.subWaypoint ?? mem.waypoint;
    const dx = target.x - bot.position.x;
    const dz = target.z - bot.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 2.5) {
      if (mem.subWaypoint) {
        const activeRamp = ramps.find((r) => r.id === mem.activeRampId) ?? collisionWorld.getRampAt(bot.position);
        if (!activeRamp) {
          mem.subWaypoint = null;
          mem.rampStage = null;
          mem.activeRampId = null;
        } else if (mem.rampStage === 'approach') {
          // Reached ramp entrance (foot or crest), now traverse across the slope to the exit
          mem.rampStage = 'traverse';
          mem.subWaypoint = elevDiff > 0 ? getRampCrest(activeRamp) : getRampFoot(activeRamp);
        } else {
          // Reached ramp exit, finish ramp routing and proceed to main waypoint
          mem.subWaypoint = null;
          mem.rampStage = null;
          mem.activeRampId = null;
        }
      } else {
        mem.waypoint = this.pickWaypoint(bot, half, collisionWorld);
      }
    }

    if (dist > 0.6) {
      let desiredYaw = Math.atan2(-dx, -dz);

      // Obstacle avoidance probe ray
      this.scratchRay.origin.x = bot.position.x;
      this.scratchRay.origin.y = bot.position.y + 0.8;
      this.scratchRay.origin.z = bot.position.z;
      this.scratchRay.direction.x = -Math.sin(desiredYaw);
      this.scratchRay.direction.y = 0;
      this.scratchRay.direction.z = -Math.cos(desiredYaw);

      const probeHit = collisionWorld.castRay(
        this.scratchRay,
        2.5,
        EMPTY_PLAYERS,
        bot.team,
        bot.id
      );

      if (probeHit.hit && probeHit.hitObstacleId && !probeHit.isGround) {
        const leftYaw = desiredYaw + 0.6;
        const rightYaw = desiredYaw - 0.6;

        this.scratchRay.direction.x = -Math.sin(leftYaw);
        this.scratchRay.direction.y = 0;
        this.scratchRay.direction.z = -Math.cos(leftYaw);
        const leftHit = collisionWorld.castRay(
          this.scratchRay,
          2.5,
          EMPTY_PLAYERS,
          bot.team,
          bot.id
        );

        this.scratchRay.direction.x = -Math.sin(rightYaw);
        this.scratchRay.direction.y = 0;
        this.scratchRay.direction.z = -Math.cos(rightYaw);
        const rightHit = collisionWorld.castRay(
          this.scratchRay,
          2.5,
          EMPTY_PLAYERS,
          bot.team,
          bot.id
        );

        if ((leftHit.distance ?? 2.5) > (rightHit.distance ?? 2.5)) {
          desiredYaw = leftYaw;
        } else {
          desiredYaw = rightYaw;
        }
      }

      input.yaw = desiredYaw;
      input.moveZ = -1; // forward in input space

      // Pitch paint: if climbing or aiming at elevated target, pitch up slightly (0.12),
      // otherwise pitch down (-0.45)
      const onRamp = !!collisionWorld.getRampAt(bot.position);
      if (onRamp || target.y > bot.position.y + 0.5) {
        input.pitch = 0.12;
      } else {
        input.pitch = -0.45;
      }

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
