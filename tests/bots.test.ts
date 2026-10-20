import { describe, expect, it } from 'vitest';
import { MAX_INK, Team, getSpawnPosition } from '@ink/shared';
import { BotAI, getRampCrest, getRampFoot, makeBotName } from '../server/src/BotAI.js';
import { CollisionWorld } from '../server/src/Collision.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';

function makeBot(team: Team, weapon: 'shooter' | 'roller' | 'charger' | 'slosher' = 'shooter'): PlayerState {
  const { id, name } = { id: 'bot_test_1', name: makeBotName(1) };
  const bot = new PlayerState(id, team, 0, getSpawnPosition(team, 0), name, weapon);
  bot.isBot = true;
  return bot;
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
