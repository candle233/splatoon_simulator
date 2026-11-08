import { describe, expect, it } from 'vitest';
import {
  BOT_DIFFICULTY_PRESETS,
  MAX_INK,
  MAX_SKILL_SLOTS,
  Team,
  getSpawnPosition
} from '@ink/shared';
import type { BotDifficulty, LobbyStatePayload } from '@ink/shared';
import { BotAI, getRampCrest, getRampFoot, makeBotName } from '../server/src/BotAI.js';
import type { BotMatchContext } from '../server/src/BotAI.js';
import { CollisionWorld } from '../server/src/Collision.js';
import { GameServer } from '../server/src/GameServer.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';

function makeBot(team: Team, weapon: 'shooter' | 'roller' | 'charger' | 'slosher' = 'shooter'): PlayerState {
  const { id, name } = { id: 'bot_test_1', name: makeBotName(1) };
  const bot = new PlayerState(id, team, 0, getSpawnPosition(team, 0), name, weapon);
  bot.isBot = true;
  return bot;
}

/** Deterministic rng (same seed -> same stream) for reproducibility tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('server bots (添加机器人)', () => {
  const ai = new BotAI();
  const collision = new CollisionWorld();
  const grid = new PaintGrid(64);
  grid.setMapSize(100);

  it('generates unique bot identities', () => {
    const a = ai.nextIdentity();
    const b = ai.nextIdentity();
    expect(a.id).not.toBe(b.id);
    expect(a.name.startsWith('BOT ')).toBe(true);
    expect(b.name.startsWith('BOT ')).toBe(true);
  });

  it('dead bots emit an idle input with no movement or firing', () => {
    const bot = makeBot(Team.PINK);
    bot.alive = false;
    const input = ai.think(bot, [bot], collision, grid, 100, 1000);
    expect(input.fire).toBe(false);
    expect(input.moveX).toBe(0);
    expect(input.moveZ).toBe(0);
  });

  it('patrolling bots face their waypoint and move forward', () => {
    const bot = makeBot(Team.PINK);
    bot.position = { x: -40, y: 1, z: 0 };
    const input = ai.think(bot, [bot], collision, grid, 100, 1000);
    expect(input.moveZ).not.toBe(0);
    expect(Math.abs(input.yaw)).toBeLessThanOrEqual(Math.PI + 1e-6);
  });

  it('combat bots aim at a visible enemy and fire', () => {
    const bot = makeBot(Team.PINK);
    bot.position = { x: -20, y: 1, z: 0 };
    const enemy = new PlayerState('enemy1', Team.CYAN, 0, getSpawnPosition(Team.CYAN, 0));
    enemy.position = { x: 0, y: 1, z: 0 }; // straight ahead, clear LOS

    const input = ai.think(bot, [bot, enemy], collision, grid, 100, 1000, 0);
    expect(input.fire).toBe(true);
    // yaw should roughly point +x: atan2(-dx, -dz) with dx=+20, dz=0 -> atan2(-20, 0) = -PI/2
    expect(input.yaw).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('low-ink bots on own ink switch to REFILL (squid) until the tank fills', () => {
    const bot = makeBot(Team.PINK);
    bot.position = { x: -40, y: 0, z: 0 };
    bot.ink = 5;

    // Paint own ink under the bot
    const uv = { u: 0.1, v: 0.5 };
    grid.applyPaintEvent({ id: 1, team: Team.PINK, u: uv.u, v: uv.v, radius: 0.1, seed: 1 });

    const refill = ai.think(bot, [bot], collision, grid, 100, 1000, 0);
    expect(refill.squid).toBe(true);

    bot.ink = MAX_INK * 0.9;
    const backToPatrol = ai.think(bot, [bot], collision, grid, 100, 2000, 0);
    expect(backToPatrol.squid).toBe(false);
  });

  it('bot names cycle without collisions for the first pool rounds', () => {
    const names = new Set<string>();
    for (let i = 0; i < 12; i++) {
      names.add(makeBotName(i));
    }
    expect(names.size).toBe(12);
  });

  it('getRampFoot and getRampCrest return correct 3D coordinates', () => {
    const ramp = {
      id: 'r_south',
      position: { x: 10, y: 1.5, z: 20 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };
    const foot = getRampFoot(ramp);
    const crest = getRampCrest(ramp);

    // South ramp climbs towards +z: foot is at z = 20 - 5 = 15 (y = 0), crest is at z = 20 + 5 = 25 (y = 3)
    expect(foot).toEqual({ x: 10, y: 0, z: 15 });
    expect(crest).toEqual({ x: 10, y: 3, z: 25 });
  });

  it('bot routes towards ramp when target waypoint is on high ground', () => {
    const ramp = {
      id: 'r_nav',
      position: { x: 0, y: 1.5, z: 10 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };
    const navCollision = new CollisionWorld([], [ramp]);
    const navBot = makeBot(Team.PINK);
    navBot.position = { x: 0, y: 0, z: 0 };

    const mem = ai.getMemory(navBot.id);
    mem.state = 'PATROL';
    mem.waypoint = { x: 0, y: 3.0, z: 18 }; // Platform destination at y=3

    const input = ai.think(navBot, [navBot], navCollision, grid, 100, 1000, 0);
    // Bot should steer towards the ramp foot (z = 5)
    expect(input.moveZ).toBe(-1);
    expect(Math.abs(input.yaw)).toBeCloseTo(Math.PI, 1); // facing +z towards foot
  });

  it('bot pitches paint upward when on a ramp slope', () => {
    const ramp = {
      id: 'r_slope',
      position: { x: 0, y: 1.5, z: 10 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };
    const slopeCollision = new CollisionWorld([], [ramp]);
    const slopeBot = makeBot(Team.PINK);
    slopeBot.position = { x: 0, y: 1.5, z: 10 }; // on the ramp
    slopeBot.ink = 100;

    const mem = ai.getMemory(slopeBot.id);
    mem.state = 'PATROL';
    mem.waypoint = { x: 0, y: 3.0, z: 18 };

    const input = ai.think(slopeBot, [slopeBot], slopeCollision, grid, 100, 1000, 0);
    expect(input.pitch).toBeCloseTo(0.12, 2);
  });

  it('bot on high ground prioritizes sub-weapon tosses down at low-ground enemies', () => {
    const highBot = makeBot(Team.PINK);
    highBot.position = { x: 0, y: 3.6, z: 0 }; // on top of a 3.6 tower
    highBot.ink = 100;

    const lowEnemy = new PlayerState('enemy_low', Team.CYAN, 0, getSpawnPosition(Team.CYAN, 0));
    lowEnemy.position = { x: 8, y: 0, z: 0 }; // on ground 8 units away

    const combatCollision = new CollisionWorld([]);
    const input = ai.think(highBot, [highBot, lowEnemy], combatCollision, grid, 100, 1000, 0);

    expect(input.subWeapon).toBe(true);
    expect(input.pitch).toBeLessThan(-0.3); // aiming downward at target below
  });

  it('bot smoothly progresses through ramp stages (approach -> traverse -> complete)', () => {
    const ramp = {
      id: 'r_nav_stages',
      position: { x: 0, y: 1.5, z: 10 },
      length: 10,
      width: 4,
      rise: 3,
      direction: 'south' as const,
      climbable: true
    };
    const navCollision = new CollisionWorld([], [ramp]);
    const bot = makeBot(Team.PINK);
    bot.position = { x: 0, y: 0, z: 0 };

    const mem = ai.getMemory(bot.id);
    mem.state = 'PATROL';
    mem.waypoint = { x: 0, y: 3.0, z: 18 };

    // Stage 1: Far from ramp, establishes approach to foot (z = 5)
    ai.think(bot, [bot], navCollision, grid, 100, 1000, 0);
    expect(mem.rampStage).toBe('approach');
    expect(mem.subWaypoint).toEqual({ x: 0, y: 0, z: 5 });

    // Stage 2: Arrives within 2.5m of foot (e.g. z = 4.8) -> advances to traverse toward crest (z = 15)
    bot.position = { x: 0, y: 0, z: 4.8 };
    ai.think(bot, [bot], navCollision, grid, 100, 1050, 0);
    expect(mem.rampStage).toBe('traverse');
    expect(mem.subWaypoint).toEqual({ x: 0, y: 3, z: 15 });

    // Stage 3: Arrives within 2.5m of crest (e.g. z = 14.5) -> finishes ramp routing
    bot.position = { x: 0, y: 2.8, z: 14.5 };
    ai.think(bot, [bot], navCollision, grid, 100, 1100, 0);
    expect(mem.rampStage).toBeNull();
    expect(mem.subWaypoint).toBeNull();
  });
});

const modeGrid = new PaintGrid(64);
modeGrid.setMapSize(100);

describe('bot difficulty presets (难度档位)', () => {
  it('aimErrorY / thinkIntervalMs strictly decrease and detectRange strictly increases', () => {
    const tiers = ['easy', 'normal', 'hard'] as const;
    for (let i = 0; i < tiers.length - 1; i++) {
      const lower = BOT_DIFFICULTY_PRESETS[tiers[i]];
      const higher = BOT_DIFFICULTY_PRESETS[tiers[i + 1]];
      expect(higher.aimErrorY).toBeLessThan(lower.aimErrorY);
      expect(higher.thinkIntervalMs).toBeLessThan(lower.thinkIntervalMs);
      expect(higher.detectRange).toBeGreaterThan(lower.detectRange);
    }
  });

  it('no tier equips placebo skills (run_speed / swim_speed have no server effect)', () => {
    const tiers = ['easy', 'normal', 'hard'] as const;
    for (const tier of tiers) {
      const preset = BOT_DIFFICULTY_PRESETS[tier];
      expect(preset.skills.length).toBeGreaterThan(0);
      expect(preset.skills.length).toBeLessThanOrEqual(MAX_SKILL_SLOTS);
      // sanitizeSkills dedups; presets must already be unique.
      expect(new Set(preset.skills).size).toBe(preset.skills.length);
      // MovementSimulation carries no skillMultiplier — these ids would be no-ops.
      expect(preset.skills).not.toContain('run_speed');
      expect(preset.skills).not.toContain('swim_speed');
    }
  });
});

describe('bot brain reproducibility (可复现性)', () => {
  it('two BotAI instances with the same seeded rng produce identical 50-tick yaw/fire sequences', () => {
    const runFiftyTicks = (): { yaw: number; fire: boolean }[] => {
      const brain = new BotAI(mulberry32(424242));
      // Obstacle-free arena: probes never block and LOS is purely geometric.
      const collision = new CollisionWorld([]);
      const bot = makeBot(Team.PINK, 'charger');
      bot.position = { x: -20, y: 1, z: 0 };
      bot.ink = MAX_INK;

      const enemy = new PlayerState('enemy_repro', Team.CYAN, 0, getSpawnPosition(Team.CYAN, 0));
      enemy.position = { x: -10, y: 1, z: 0 }; // 10u ahead, inside normal detectRange

      const seq: { yaw: number; fire: boolean }[] = [];
      let now = 1000;
      for (let t = 0; t < 50; t++) {
        // Ticks 0-24: enemy visible -> COMBAT (aim error, strafe flip, charger
        // charge rng, sub toss rng). Ticks 25-49: enemy gone -> PATROL
        // (waypoint roll/jitter rng, hop rng). Both rng-consuming paths run.
        enemy.alive = t < 25;
        const input = brain.think(
          bot,
          enemy.alive ? [bot, enemy] : [bot],
          collision,
          modeGrid,
          100,
          now,
          0
        );
        seq.push({ yaw: input.yaw, fire: input.fire });
        now += 100;
      }
      return seq;
    };

    expect(runFiftyTicks()).toEqual(runFiftyTicks());
  });
});

describe('bot mode awareness (模式感知选点)', () => {
  const zoneRect = { x: 0, z: 0, w: 30, d: 20 };
  const innerHalfW = zoneRect.w * 0.4; // 10% inset per side
  const innerHalfD = zoneRect.d * 0.4;
  const outerHalfW = zoneRect.w / 2 + 6; // band ring: +6u expansion
  const outerHalfD = zoneRect.d / 2 + 6;

  /** 40 deterministic stuck-path re-picks: static bot, thinkIntervalMs=0. */
  function collectWaypoints(context: BotMatchContext): { mem: ReturnType<BotAI['getMemory']> } {
    const brain = new BotAI(mulberry32(20261025));
    const collision = new CollisionWorld([]); // obstacle-free: probes never block
    const bot = makeBot(Team.PINK);
    bot.position = { x: 0, y: 0, z: 0 }; // parked at the zone centre
    bot.ink = MAX_INK; // never REFILL, no enemies -> never COMBAT

    let now = 2000; // >= 2000 so the first stuck window is already open
    for (let i = 0; i < 40; i++) {
      brain.think(bot, [bot], collision, modeGrid, 100, now, 0, context);
      now += 1700; // > 1600 stuck window + decision jitter -> re-pick each think
    }
    return { mem: brain.getMemory(bot.id) };
  }

  it('trailing side always contests the zone: waypoints 100% inside the shrunk rect', () => {
    const context: BotMatchContext = {
      mode: 'splat_zones',
      zoneRect,
      pinkScore: 0,
      cyanScore: 100
    };
    const { mem } = collectWaypoints(context);

    // Every think re-ran the stuck path (40 decisions, no statistical slack).
    expect(mem.stuckCheckAt).toBe(2000 + 39 * 1700);
    expect(mem.state).toBe('PATROL');
    expect(Math.abs(mem.waypoint.x - zoneRect.x)).toBeLessThanOrEqual(innerHalfW);
    expect(Math.abs(mem.waypoint.z - zoneRect.z)).toBeLessThanOrEqual(innerHalfD);
  });

  it('leading side holds the ring: waypoints 100% in the outer band, never the inner zone', () => {
    const context: BotMatchContext = {
      mode: 'splat_zones',
      zoneRect,
      pinkScore: 100,
      cyanScore: 0
    };
    const { mem } = collectWaypoints(context);

    expect(mem.stuckCheckAt).toBe(2000 + 39 * 1700);
    expect(mem.state).toBe('PATROL');
    const inOuter =
      Math.abs(mem.waypoint.x - zoneRect.x) <= outerHalfW + 1e-9 &&
      Math.abs(mem.waypoint.z - zoneRect.z) <= outerHalfD + 1e-9;
    const inInner =
      Math.abs(mem.waypoint.x - zoneRect.x) < innerHalfW &&
      Math.abs(mem.waypoint.z - zoneRect.z) < innerHalfD;
    expect(inOuter).toBe(true);
    expect(inInner).toBe(false);
  });

  it('team_deathmatch waypoints bias toward the nearest living enemy within ±8u', () => {
    const brain = new BotAI(mulberry32(777));
    const collision = new CollisionWorld([]);
    const bot = makeBot(Team.PINK);
    bot.position = { x: -20, y: 0, z: 0 };
    bot.ink = MAX_INK;

    const enemy = new PlayerState('enemy_tdm', Team.CYAN, 0, getSpawnPosition(Team.CYAN, 0));
    enemy.position = { x: 30, y: 0, z: 0 }; // 50u away: outside detectRange, so PATROL

    // Anchor the stuck detector on the bot's fixed spot so the first think
    // already re-picks through the mode-aware waypoint path.
    const pre = brain.getMemory(bot.id);
    pre.stuckX = bot.position.x;
    pre.stuckZ = bot.position.z;

    const context: BotMatchContext = {
      mode: 'team_deathmatch',
      pinkScore: 0,
      cyanScore: 0
    };
    let now = 2000;
    for (let i = 0; i < 8; i++) {
      brain.think(bot, [bot, enemy], collision, modeGrid, 100, now, 0, context);
      now += 1700;
      const mem = brain.getMemory(bot.id);
      expect(mem.state).toBe('PATROL');
      expect(Math.abs(mem.waypoint.x - enemy.position.x)).toBeLessThanOrEqual(8 + 1e-9);
      expect(Math.abs(mem.waypoint.z - enemy.position.z)).toBeLessThanOrEqual(8 + 1e-9);
    }
  });
});

describe('GameServer bot difficulty wiring (大厅机器人难度)', () => {
  it('addBot grants the preset skills, exposes them via getLobbyState, and falls back to normal on garbage', async () => {
    const server = new GameServer();
    try {
      const hard = server.addBot(Team.PINK, 'shooter', 'hard');
      expect(hard).not.toBeNull();
      expect(hard!.skills.length).toBeGreaterThan(0);
      expect(hard!.skills).toEqual([...BOT_DIFFICULTY_PRESETS.hard.skills]);

      const lobby = (server as unknown as { getLobbyState(): LobbyStatePayload }).getLobbyState();
      const entry = lobby.players.find((p) => p.id === hard!.id);
      expect(entry?.isBot).toBe(true);
      expect(entry?.skills?.length ?? 0).toBeGreaterThan(0);

      // Invalid difficulty strings resolve to the normal tier without throwing.
      const fallback = server.addBot(
        Team.CYAN,
        undefined,
        'not-a-real-tier' as unknown as BotDifficulty
      );
      expect(fallback).not.toBeNull();
      expect(fallback!.skills).toEqual([...BOT_DIFFICULTY_PRESETS.normal.skills]);
    } finally {
      await server.stop();
    }
  });
});
