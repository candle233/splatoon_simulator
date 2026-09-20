import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GameServer } from '../server/src/GameServer.js';
import { Team, getSpawnPosition } from '@ink/shared';
import { PlayerState } from '../server/src/PlayerState.js';

function resetServer(server: GameServer): void {
  const s = server as any;
  s.players.clear();
  s.latestInputs.clear();
  s.playerLastInputAt.clear();
  s.readyPlayers.clear();
  s.playerLastActiveTime.clear();
  s.botOrder.length = 0;
  s.hostPlayerId = undefined;
  s.playerRosterDirty = true;
  s.rateLimiter = new s.rateLimiter.constructor(60, 40);
  s.botAI.clear();
}

function addHuman(server: GameServer, id: string, team: Team): PlayerState {
  const s = server as any;
  const player = new PlayerState(id, team, 0, getSpawnPosition(team, 0));
  s.players.set(id, player);
  s.playerRosterDirty = true;
  return player;
}

function addBot(server: GameServer, id: string, team: Team): PlayerState {
  const s = server as any;
  const bot = new PlayerState(id, team, 0, getSpawnPosition(team, 0));
  bot.isBot = true;
  s.players.set(id, bot);
  s.botOrder.push(id);
  s.playerRosterDirty = true;
  return bot;
}

describe('handlePlayerDisconnect host transition', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('unique human host disconnect transfers host to another human (not bot)', () => {
    const human1 = addHuman(server, 'human1', Team.PINK);
    const human2 = addHuman(server, 'human2', Team.CYAN);
    addBot(server, 'bot1', Team.PINK);
    addBot(server, 'bot2', Team.CYAN);

    (server as any).hostPlayerId = human1.id;

    (server as any).handlePlayerDisconnect(human1.id);

    expect((server as any).hostPlayerId).toBe(human2.id);
    expect((server as any).players.get((server as any).hostPlayerId)?.isBot).toBe(false);
  });

  it('all humans disconnect sets host to undefined', () => {
    const human1 = addHuman(server, 'human1', Team.PINK);
    const human2 = addHuman(server, 'human2', Team.CYAN);
    addBot(server, 'bot1', Team.PINK);

    (server as any).hostPlayerId = human1.id;

    (server as any).handlePlayerDisconnect(human1.id);
    (server as any).handlePlayerDisconnect(human2.id);

    expect((server as any).hostPlayerId).toBeUndefined();
  });

  it('bot disconnect does not change host', () => {
    const human1 = addHuman(server, 'human1', Team.PINK);
    addBot(server, 'bot1', Team.CYAN);
    addBot(server, 'bot2', Team.PINK);

    (server as any).hostPlayerId = human1.id;

    (server as any).handlePlayerDisconnect('bot1');

    expect((server as any).hostPlayerId).toBe(human1.id);
  });
});
