import { describe, expect, it } from 'vitest';
import { MAX_INK, Team, getSpawnPosition } from '@ink/shared';
import { BotAI, makeBotName } from '../server/src/BotAI.js';
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
});
