import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { GameServer } from '../server/src/GameServer.js';
import {
  MatchPhase,
  PROTOCOL_EVENTS,
  PaintEvent,
  PlayerInput,
  PlayerMode,
  PlayerSnapshot,
  SnapshotPayload,
  Team,
  WelcomePayload
} from '@ink/shared';

describe('Multiplayer Network Integration & Sanity', () => {
  const TEST_PORT = 3999;
  const SERVER_URL = `http://localhost:${TEST_PORT}`;
  let server: GameServer;

  beforeAll(async () => {
    server = new GameServer();
    await server.start(TEST_PORT);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('Test A & B: Two clients join, get balanced teams, and receive snapshots', async () => {
    const clientA: Socket = ClientSocket(SERVER_URL);

    const welcomeA = await new Promise<WelcomePayload>((resolve) => {
      clientA.once(PROTOCOL_EVENTS.S2C_WELCOME, (payload: WelcomePayload) => {
        resolve(payload);
      });
    });

    const bJoinedPromise = new Promise<PlayerSnapshot>((resolve) => {
      clientA.once(PROTOCOL_EVENTS.S2C_PLAYER_JOINED, (player: PlayerSnapshot) => {
        resolve(player);
      });
    });

    const clientB: Socket = ClientSocket(SERVER_URL);

    const welcomeB = await new Promise<WelcomePayload>((resolve) => {
      clientB.once(PROTOCOL_EVENTS.S2C_WELCOME, (payload: WelcomePayload) => {
        resolve(payload);
      });
    });

    const bJoinedA = await bJoinedPromise;

    expect(welcomeA).toBeDefined();
    expect(welcomeB).toBeDefined();
    expect(bJoinedA).toBeDefined();

    // Teams must be balanced (1 Pink, 1 Cyan)
    const teams = [welcomeA!.team, welcomeB!.team].sort();
    expect(teams).toEqual([Team.PINK, Team.CYAN]);
    expect(bJoinedA!.id).toBe(clientB.id);

    // Test Movement input & Snapshot broadcasting
    const moveInput: PlayerInput = {
      seq: 1,
      moveX: 0,
      moveZ: -1, // move forward
      yaw: 0,
      pitch: 0,
      jump: false,
      squid: false,
      fire: false,
      clientTime: Date.now()
    };

    clientA.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, moveInput);

    const snapshot = await new Promise<SnapshotPayload>((resolve) => {
      clientB.once(PROTOCOL_EVENTS.S2C_SNAPSHOT, (snap: SnapshotPayload) => {
        resolve(snap);
      });
    });

    expect(snapshot.players.length).toBe(2);
    const pA = snapshot.players.find((p) => p.id === clientA.id);
    expect(pA).toBeDefined();

    clientA.disconnect();
    clientB.disconnect();
  });

  it('Test C & D: Shooting ground paints turf and Late Join recovers paint history', async () => {
    const shooter: Socket = ClientSocket(SERVER_URL);
    await new Promise<void>((res) => shooter.once(PROTOCOL_EVENTS.S2C_WELCOME, () => res()));

    // Shoot downwards towards ground (pitch = -Math.PI / 3)
    const fireInput: PlayerInput = {
      seq: 10,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: -1.0,
      jump: false,
      squid: false,
      fire: true,
      clientTime: Date.now()
    };

    shooter.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, fireInput);

    // Wait for PAINT_BATCH
    const paintBatch = await new Promise<PaintEvent[]>((resolve) => {
      shooter.on(PROTOCOL_EVENTS.S2C_PAINT_BATCH, (batch: PaintEvent[]) => {
        resolve(batch);
      });
    });

    expect(paintBatch.length).toBeGreaterThan(0);
    const paintEvt = paintBatch[0]!;
    expect(paintEvt.radius).toBeGreaterThan(0);
    expect(paintEvt.seed).toBeDefined();

    // Now connect lateJoiner
    const lateJoiner: Socket = ClientSocket(SERVER_URL);
    const lateWelcome = await new Promise<WelcomePayload>((resolve) => {
      lateJoiner.once(PROTOCOL_EVENTS.S2C_WELCOME, (payload: WelcomePayload) => {
        resolve(payload);
      });
    });

    // Late joiner must receive the paint history
    expect(lateWelcome.paintHistory.length).toBeGreaterThan(0);
    const recovered = lateWelcome.paintHistory.find((p) => p.id === paintEvt.id);
    expect(recovered).toBeDefined();

    shooter.disconnect();
    lateJoiner.disconnect();
  });

  it('Test Ping/Pong RTT calculation', async () => {
    const client: Socket = ClientSocket(SERVER_URL);
    await new Promise<void>((res) => client.once(PROTOCOL_EVENTS.S2C_WELCOME, () => res()));

    const sendTime = Date.now();
    client.emit(PROTOCOL_EVENTS.C2S_PING, sendTime);

    const pong = await new Promise<{ clientTime: number; serverTime: number }>((resolve) => {
      client.once(PROTOCOL_EVENTS.S2C_PONG, (data: { clientTime: number; serverTime: number }) => {
        resolve(data);
      });
    });

    expect(pong.clientTime).toBe(sendTime);
    expect(pong.serverTime).toBeGreaterThanOrEqual(sendTime);

    client.disconnect();
  });
});
