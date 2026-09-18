import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { GameServer } from '../server/src/GameServer.js';
import {
  LobbyStatePayload,
  MatchPhase,
  MatchStateSnapshot,
  PROTOCOL_EVENTS,
  Team,
  WelcomePayload
} from '@ink/shared';

describe('Multiplayer Lobby System Integration', () => {
  let server: GameServer;
  let serverUrl: string;
  const activeSockets: Socket[] = [];

  const createSocket = (): Socket => {
    const s = ClientSocket(serverUrl, { reconnection: false, forceNew: true });
    activeSockets.push(s);
    return s;
  };

  beforeAll(async () => {
    server = new GameServer();
    const port = await server.start(0);
    serverUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    for (const s of activeSockets) {
      if (s.connected) {
        s.disconnect();
      }
    }
    activeSockets.length = 0;

    // Wait until server has 0 players or force clean
    for (let i = 0; i < 20; i++) {
      if ((server as any).players.size === 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    (server as any).players.clear();
    (server as any).latestInputs.clear();
    (server as any).readyPlayers.clear();
    (server as any).hostPlayerId = undefined;
    (server as any).match.phase = MatchPhase.WAITING;
    (server as any).match.matchStartAt = 0;
    (server as any).match.matchEndAt = 0;
    (server as any).match.phaseEndsAt = 0;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('Player joins and receives initial lobby state with host assignment', async () => {
    const clientA = createSocket();

    const welcomeA = await new Promise<WelcomePayload>((resolve) => {
      clientA.once(PROTOCOL_EVENTS.S2C_WELCOME, (payload: WelcomePayload) => {
        resolve(payload);
      });
    });

    expect(welcomeA.lobby).toBeDefined();
    expect(welcomeA.lobby?.players.length).toBe(1);
    expect(welcomeA.lobby?.players[0].id).toBe(clientA.id);
    expect(welcomeA.lobby?.players[0].isHost).toBe(true);
    expect(welcomeA.lobby?.players[0].weaponType).toBe('shooter');

    // Second client joins
    const clientB = createSocket();

    const welcomeB = await new Promise<WelcomePayload>((resolve) => {
      clientB.once(PROTOCOL_EVENTS.S2C_WELCOME, (payload: WelcomePayload) => {
        resolve(payload);
      });
    });

    expect(welcomeB.lobby?.players.length).toBe(2);
    const playerBInLobby = welcomeB.lobby?.players.find((p) => p.id === clientB.id);
    expect(playerBInLobby).toBeDefined();
    expect(playerBInLobby?.isHost).toBe(false);

    // Client B updates profile: name, charger weapon, ready
    const lobbyUpdatePromise = new Promise<LobbyStatePayload>((resolve) => {
      clientA.on(PROTOCOL_EVENTS.S2C_LOBBY_STATE, (state: LobbyStatePayload) => {
        const b = state.players.find((p) => p.id === clientB.id);
        if (b && b.name === 'SniperSquid') {
          resolve(state);
        }
      });
    });

    clientB.emit(PROTOCOL_EVENTS.C2S_LOBBY_UPDATE, {
      name: 'SniperSquid',
      weaponType: 'charger',
      ready: true
    });

    const updatedLobby = await lobbyUpdatePromise;
    const bUpdated = updatedLobby.players.find((p) => p.id === clientB.id);
    expect(bUpdated?.name).toBe('SniperSquid');
    expect(bUpdated?.weaponType).toBe('charger');
    expect(bUpdated?.ready).toBe(true);
  });

  it('All players ready triggers match countdown automatically', async () => {
    const client1 = createSocket();
    const client2 = createSocket();

    await new Promise((resolve) => client1.once(PROTOCOL_EVENTS.S2C_WELCOME, resolve));
    await new Promise((resolve) => client2.once(PROTOCOL_EVENTS.S2C_WELCOME, resolve));

    const matchStatePromise = new Promise<MatchStateSnapshot>((resolve) => {
      client1.on(PROTOCOL_EVENTS.S2C_MATCH_STATE, (state: MatchStateSnapshot) => {
        if (state.phase === MatchPhase.COUNTDOWN) {
          resolve(state);
        }
      });
    });

    // Both mark ready
    client1.emit(PROTOCOL_EVENTS.C2S_LOBBY_UPDATE, { ready: true });
    client2.emit(PROTOCOL_EVENTS.C2S_LOBBY_UPDATE, { ready: true });

    const countdownState = await matchStatePromise;
    expect(countdownState.phase).toBe(MatchPhase.COUNTDOWN);
  });

  it('Match remains in WAITING phase without auto-bypassing the lobby screen', async () => {
    const client = createSocket();
    const welcome = await new Promise<WelcomePayload>((resolve) => {
      client.once(PROTOCOL_EVENTS.S2C_WELCOME, resolve);
    });
    expect(welcome.match.phase).toBe(MatchPhase.WAITING);

    // Wait 200ms (multiple server ticks)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Server match phase must still be WAITING
    expect((server as any).match.phase).toBe(MatchPhase.WAITING);
  });

  it('Team switching updates player team and base spawn position', async () => {
    const client = createSocket();
    await new Promise((resolve) => client.once(PROTOCOL_EVENTS.S2C_WELCOME, resolve));

    const lobbyUpdatePromise = new Promise<LobbyStatePayload>((resolve) => {
      client.on(PROTOCOL_EVENTS.S2C_LOBBY_STATE, (state: LobbyStatePayload) => {
        const p = state.players.find((item) => item.id === client.id);
        if (p && p.team === Team.CYAN) {
          resolve(state);
        }
      });
    });

    // Explicitly switch to Cyan team
    client.emit(PROTOCOL_EVENTS.C2S_LOBBY_UPDATE, { team: Team.CYAN });
    const lobbyState = await lobbyUpdatePromise;
    const player = lobbyState.players.find((p) => p.id === client.id);
    expect(player?.team).toBe(Team.CYAN);

    // Verify player state on server has cyan spawn position (X >= 40)
    const serverPlayer = (server as any).players.get(client.id);
    expect(serverPlayer.team).toBe(Team.CYAN);
    expect(serverPlayer.position.x).toBeGreaterThanOrEqual(40);
  });

  it('Host can trigger match countdown via C2S_LOBBY_START even if not all players are ready', async () => {
    // Connect host first and wait for welcome so host is registered as host
    const host = createSocket();
    await new Promise((resolve) => host.once(PROTOCOL_EVENTS.S2C_WELCOME, resolve));

    // Connect guest afterwards
    const guest = createSocket();
    await new Promise((resolve) => guest.once(PROTOCOL_EVENTS.S2C_WELCOME, resolve));

    const countdownPromise = new Promise<MatchStateSnapshot>((resolve) => {
      guest.on(PROTOCOL_EVENTS.S2C_MATCH_STATE, (state: MatchStateSnapshot) => {
        if (state.phase === MatchPhase.COUNTDOWN) {
          resolve(state);
        }
      });
    });

    // Guest does NOT ready up. Host presses Start Game
    host.emit(PROTOCOL_EVENTS.C2S_LOBBY_START);

    const countdownState = await countdownPromise;
    expect(countdownState.phase).toBe(MatchPhase.COUNTDOWN);
  });
});
