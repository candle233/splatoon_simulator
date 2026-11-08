import {
  BOT_DIFFICULTY_PRESETS,
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
import type { BotDifficulty, GameMode, ZoneRect } from '@ink/shared';
import { CollisionWorld } from './Collision.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';

type BotStateName = 'PATROL' | 'COMBAT' | 'REFILL';

const EMPTY_PLAYERS: PlayerState[] = [];

/**
 * Per-tick match facts a bot brain needs to play the objective. `think` treats
 * it as optional: without it (or in `turf_war`) bots fall back to generic
 * roaming. Scores are compared from `bot.team`'s perspective.
 */
export interface BotMatchContext {
  mode: GameMode;
  /** Central objective rectangle (splat_zones / final_push). */
  zoneRect?: ZoneRect;
  pinkScore: number;
  cyanScore: number;
}

/** Retries for mode-aware waypoint sampling before falling back to roam logic. */
const MODE_WAYPOINT_RETRIES = 4;
/** Band width (u) a leading team patrols around the objective. */
const MODE_BAND_EXPANSION = 6;
/** Clearance (u) kept outside the inner zone when clamping band samples. */
const MODE_BAND_CLEARANCE = 0.5;
/** Jitter amplitude (u, total span) around the nearest enemy in TDM hunting. */
const TDM_HUNT_JITTER = 8;

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
  /** Difficulty tier applied to aim error / cadence / detection / fire. */
  difficulty: BotDifficulty;
  cachedInput?: PlayerInput;
}

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
  /** Injectable randomness: all brain randomness flows through this so tests
   * can replay two brains bit-for-bit with the same seed. */
  private readonly rng: () => number;
  private scratchRay: Ray = {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 }
  };
  private scratchFoot: Vec3 = { x: 0, y: 0, z: 0 };
  private scratchCrest: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

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

  /** Assigns a difficulty tier to one bot's brain (persisted on its memory). */
  setDifficulty(botId: string, difficulty: BotDifficulty): void {
    this.getMemory(botId).difficulty = difficulty;
  }

  getMemory(botId: string): BotMemory {
    let mem = this.memories.get(botId);
    if (!mem) {
      mem = {
        state: 'PATROL',
        waypoint: { x: 0, y: 0, z: 0 },
        subWaypoint: null,
        nextDecisionAt: 0,
        strafeDir: this.rng() < 0.5 ? 1 : -1,
        nextStrafeFlipAt: 0,
        chargeStartAt: 0,
        nextSubAt: 0,
        seq: 0,
        stuckCheckAt: 0,
        stuckX: 0,
        stuckZ: 0,
        jumpCooldownUntil: 0,
        difficulty: 'normal',
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
   * `thinkIntervalMs` bounds how often expensive target re-evaluation happens;
   * passing <= 0 forces a re-decision every call (deterministic harnesses).
   * `context` optionally carries the match mode + scores so objective modes
   * can steer waypoint picking; omitting it keeps classic roaming behaviour.
   */
  think(
    bot: PlayerState,
    allPlayers: PlayerState[],
    collisionWorld: CollisionWorld,
    paintGrid: PaintGrid,
    mapSize: number,
    now: number,
    thinkIntervalMs = 250,
    context?: BotMatchContext
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
    input.dodge = false;
    input.clientTime = now;

    if (!bot.alive || bot.mode === PlayerMode.DEAD) {
      return input;
    }

    const half = mapSize / 2;
    const weaponConfig = WEAPON_CONFIGS[bot.weaponType] || WEAPON_CONFIGS.shooter;
    const preset = BOT_DIFFICULTY_PRESETS[mem.difficulty];

    // --- periodic re-decision ---
    if (now >= mem.nextDecisionAt) {
      // Difficulty presets own the cadence; an explicit <= 0 interval means
      // "decide every tick" (deterministic tests / harnesses).
      const intervalMs = thinkIntervalMs <= 0 ? 0 : preset.thinkIntervalMs;
      mem.nextDecisionAt = now + intervalMs + this.rng() * 150;

      // Stuck detection: no progress over ~1.6s -> new waypoint / hop
      if (now - mem.stuckCheckAt > 1600) {
        const moved = Math.hypot(bot.position.x - mem.stuckX, bot.position.z - mem.stuckZ);
        if (moved < 0.8 && mem.state === 'PATROL') {
          mem.subWaypoint = null;
          mem.waypoint = this.pickWaypoint(bot, half, collisionWorld, context, allPlayers);
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
    const enemy = this.findVisibleEnemy(bot, allPlayers, collisionWorld, now, preset.detectRange);

    if (enemy) {
      mem.state = 'COMBAT';
      return this.combatInput(bot, enemy, mem, input, weaponConfig, now);
    }

    mem.state = 'PATROL';
    return this.patrolInput(bot, mem, input, weaponConfig, collisionWorld, half, now, context, allPlayers);
  }

  private pickWaypoint(
    bot: PlayerState,
    half: number,
    collisionWorld?: CollisionWorld,
    context?: BotMatchContext,
    allPlayers?: PlayerState[]
  ): Vec3 {
    // Objective awareness: zone modes contest / ring the objective, TDM hunts.
    // Both pre-step failures (no rect, blocked probes) fall through to roaming.
    if (context) {
      const modePoint = this.pickModeAwareWaypoint(bot, half, collisionWorld, context, allPlayers);
      if (modePoint) return modePoint;
    }

    const ramps = collisionWorld?.getRamps() ?? [];
    const roll = this.rng();

    // 40% chance: target an elevated ramp crest or platform top
    if (ramps.length > 0 && roll < 0.4) {
      const ramp = ramps[Math.floor(this.rng() * ramps.length)];
      if (ramp) return getRampCrest(ramp);
    }

    // 30% chance: target a ramp foot / approach
    if (ramps.length > 0 && roll < 0.7) {
      const ramp = ramps[Math.floor(this.rng() * ramps.length)];
      if (ramp) return getRampFoot(ramp);
    }

    // 30% chance: midfield turf
    const bias = 0.7;
    const x = clamp(
      bot.position.x + (this.rng() - 0.5) * half * 1.2 - bot.position.x * (1 - bias) * 0.5,
      -half * 0.85,
      half * 0.85
    );
    const z = clamp(
      bot.position.z + (this.rng() - 0.5) * half * 1.2 - bot.position.z * (1 - bias) * 0.5,
      -half * 0.85,
      half * 0.85
    );
    const y = collisionWorld ? collisionWorld.getGroundHeightAt(x, z, bot.position.y + 1.5) : 0;
    return { x, y, z };
  }

  /**
   * Objective-driven waypoint override. Returns null whenever the mode has no
   * steering rule here (turf_war / missing zoneRect / no hunt target) or every
   * sample was rejected by the obstacle probe — callers then roam normally.
   */
  private pickModeAwareWaypoint(
    bot: PlayerState,
    half: number,
    collisionWorld: CollisionWorld | undefined,
    context: BotMatchContext,
    allPlayers?: PlayerState[]
  ): Vec3 | null {
    if (context.mode === 'splat_zones' || context.mode === 'final_push') {
      const rect = context.zoneRect;
      if (!rect || rect.w <= 0 || rect.d <= 0) return null;

      const myScore = bot.team === Team.PINK ? context.pinkScore : context.cyanScore;
      const enemyScore = bot.team === Team.PINK ? context.cyanScore : context.pinkScore;
      const innerHalfW = rect.w * 0.4; // zone shrunk 10% per side
      const innerHalfD = rect.d * 0.4;

      if (myScore <= enemyScore) {
        // Behind (or even): contest the objective — sample strictly inside the
        // shrunk zone. Membership is guaranteed by construction, so no
        // statistical slack is needed.
        for (let attempt = 0; attempt < MODE_WAYPOINT_RETRIES; attempt++) {
          const x = rect.x - innerHalfW + this.rng() * innerHalfW * 2;
          const z = rect.z - innerHalfD + this.rng() * innerHalfD * 2;
          const candidate = this.probeWaypointCandidate(bot, x, z, collisionWorld);
          if (candidate) return candidate;
        }
        return null;
      }

      // Ahead: hold the ring band around the objective (outer rect expanded by
      // MODE_BAND_EXPANSION, never inside the shrunk zone). Samples that land
      // inside are pushed out deterministically through the nearest inner edge.
      const outerHalfW = rect.w / 2 + MODE_BAND_EXPANSION;
      const outerHalfD = rect.d / 2 + MODE_BAND_EXPANSION;
      for (let attempt = 0; attempt < MODE_WAYPOINT_RETRIES; attempt++) {
        let x = rect.x - outerHalfW + this.rng() * outerHalfW * 2;
        let z = rect.z - outerHalfD + this.rng() * outerHalfD * 2;
        const dx = x - rect.x;
        const dz = z - rect.z;
        if (Math.abs(dx) < innerHalfW && Math.abs(dz) < innerHalfD) {
          const escapeX = innerHalfW - Math.abs(dx);
          const escapeZ = innerHalfD - Math.abs(dz);
          if (escapeX <= escapeZ) {
            x = rect.x + (dx >= 0 ? 1 : -1) * (innerHalfW + MODE_BAND_CLEARANCE);
          } else {
            z = rect.z + (dz >= 0 ? 1 : -1) * (innerHalfD + MODE_BAND_CLEARANCE);
          }
        }
        const candidate = this.probeWaypointCandidate(bot, x, z, collisionWorld);
        if (candidate) return candidate;
      }
      return null;
    }

    if (context.mode === 'team_deathmatch') {
      // Hunt: bias the waypoint toward the nearest living enemy with jitter.
      let nearest: PlayerState | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const other of allPlayers ?? EMPTY_PLAYERS) {
        if (other.id === bot.id || !other.alive || other.team === bot.team) continue;
        const dist = Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = other;
        }
      }
      if (!nearest) return null;

      for (let attempt = 0; attempt < MODE_WAYPOINT_RETRIES; attempt++) {
        const x = clamp(
          nearest.position.x + (this.rng() - 0.5) * TDM_HUNT_JITTER * 2,
          -half * 0.85,
          half * 0.85
        );
        const z = clamp(
          nearest.position.z + (this.rng() - 0.5) * TDM_HUNT_JITTER * 2,
          -half * 0.85,
          half * 0.85
        );
        const candidate = this.probeWaypointCandidate(bot, x, z, collisionWorld);
        if (candidate) return candidate;
      }
      return null;
    }

    return null; // turf_war & friends: classic roaming
  }

  /**
   * Ground-snaps a candidate waypoint and rejects it when a horizontal probe
   * ray (same pattern as the patrol avoidance probe) hits an obstacle on the
   * way there. Returns null when the candidate would sit inside geometry.
   */
  private probeWaypointCandidate(
    bot: PlayerState,
    x: number,
    z: number,
    collisionWorld: CollisionWorld | undefined
  ): Vec3 | null {
    const y = collisionWorld ? collisionWorld.getGroundHeightAt(x, z, bot.position.y + 1.5) : 0;
    if (!collisionWorld) return { x, y, z };

    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.5) {
      this.scratchRay.origin.x = bot.position.x;
      this.scratchRay.origin.y = bot.position.y + 0.8;
      this.scratchRay.origin.z = bot.position.z;
      this.scratchRay.direction.x = dx / len;
      this.scratchRay.direction.y = 0;
      this.scratchRay.direction.z = dz / len;

      const probe = collisionWorld.castRay(
        this.scratchRay,
        Math.min(len, 10),
        EMPTY_PLAYERS,
        bot.team,
        bot.id
      );
      if (probe.hit && probe.hitObstacleId && !probe.isGround) {
        return null; // blocked — caller retries with a fresh sample
      }
    }
    return { x, y, z };
  }

  private findVisibleEnemy(
    bot: PlayerState,
    allPlayers: PlayerState[],
    collisionWorld: CollisionWorld,
    now: number,
    detectRange: number
  ): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDist = detectRange; // max engagement range (difficulty preset)

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
    const preset = BOT_DIFFICULTY_PRESETS[mem.difficulty];
    const dx = enemy.position.x - bot.position.x;
    const dz = enemy.position.z - bot.position.z;
    const dist = Math.hypot(dx, dz) || 1;

    // Aim at the enemy chest with a touch of error
    const eyeY = bot.position.y + 1.4;
    const aimY = enemy.position.y + 0.9 + (this.rng() - 0.5) * preset.aimErrorY;
    const dy = aimY - eyeY;
    const aimLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    input.yaw = Math.atan2(-dx, -dz);
    input.pitch = clamp(Math.asin(clamp(dy / aimLen, -1, 1)), -1.3, 1.3);

    // Preferred engagement range per weapon class (configs may override)
    const preferred =
      weaponConfig.preferredRange ??
      (bot.weaponType === 'charger' ? 26 : bot.weaponType === 'roller' ? 2.5 : bot.weaponType === 'slosher' ? 12 : 13);

    if (now >= mem.nextStrafeFlipAt) {
      // Dualies strafe more aggressively: faster flips keep them slippery.
      mem.strafeDir = mem.strafeDir === 1 ? -1 : 1;
      mem.nextStrafeFlipAt =
        now + (bot.weaponType === 'dualies' ? 500 + this.rng() * 700 : 900 + this.rng() * 1400);
    }

    let forward = 0;
    if (dist > preferred + 3) forward = -1;
    else if (dist < preferred - 2) forward = 1;

    // Brella bots hold range while wounded: back off behind the canopy.
    if (bot.weaponType === 'brella' && bot.hp < 50 && forward === 0) {
      forward = -1;
    }

    input.moveX = mem.strafeDir * (forward === 0 ? 1 : 0.55);
    input.moveZ = forward;
    // Normalize diagonal
    const mLen = Math.hypot(input.moveX, input.moveZ);
    if (mLen > 1) {
      input.moveX /= mLen;
      input.moveZ /= mLen;
    }

    // Dualies dodge: react to recent damage while the roll is off cooldown,
    // dodging sideways relative to the enemy.
    if (
      bot.weaponType === 'dualies' &&
      now - bot.lastDamageTime < 800 &&
      now >= bot.dodgeReadyAt &&
      bot.ink >= (weaponConfig.dodgeInkCost ?? 15)
    ) {
      input.dodge = true;
      input.moveX = mem.strafeDir;
    }

    // Fire control. Lower tiers sometimes hold fire for a beat (fireChance),
    // which also keeps their rng stream deterministic per tier.
    const canFire = preset.fireChance >= 1 || this.rng() < preset.fireChance;
    if (bot.weaponType === 'charger') {
      if (mem.chargeStartAt === 0) {
        mem.chargeStartAt = now;
      }
      const charged = now - mem.chargeStartAt >= (weaponConfig.chargeTime ?? 1.0) * 1000;
      if (charged && canFire) {
        input.fire = true;
        input.chargeLevel = 0.9 + this.rng() * 0.1;
        mem.chargeStartAt = now + 300 + this.rng() * 400;
      }
    } else if (bot.weaponType === 'brella') {
      // Keep firing: each shot re-opens the canopy shield (autoOpen), so the
      // shield cycles for free as long as the bot is engaging.
      input.fire = canFire;
    } else {
      input.fire = canFire;
    }

    // Sub weapon toss with high ground advantage
    const isHighGround = bot.position.y > enemy.position.y + 1.2;
    const subCost = SUB_WEAPON_CONFIGS[weaponConfig.sub]?.inkCost ?? 40;
    if (
      (isHighGround ? now >= mem.nextSubAt - 2000 : now >= mem.nextSubAt) &&
      bot.ink >= subCost
    ) {
      input.subWeapon = true;
      mem.nextSubAt = now + (isHighGround ? 4500 : 7000) + this.rng() * 3000;
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
    now: number,
    context?: BotMatchContext,
    allPlayers?: PlayerState[]
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
        mem.waypoint = this.pickWaypoint(bot, half, collisionWorld, context, allPlayers);
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
    if (this.rng() < 0.01 && now > mem.jumpCooldownUntil) {
      input.jump = true;
      mem.jumpCooldownUntil = now + 1500;
    }

    return input;
  }
}
