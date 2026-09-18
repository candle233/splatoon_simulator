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
  ShotEventPayload,
  SnapshotPayload,
  Team,
  WelcomePayload
} from '@ink/shared';

describe('Multiplayer Network Integration & Sanity', () => {
  let server: GameServer;
  let serverUrl: string;

  beforeAll(async () => {
    server = new GameServer();
    const port = await server.start(0);
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('Test A & B: Two clients join, get balanced teams, and receive snapshots', async () => {
    const clientA: Socket = ClientSocket(serverUrl);

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

    const clientB: Socket = ClientSocket(serverUrl);

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
    const shooter: Socket = ClientSocket(serverUrl);
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
    const lateJoiner: Socket = ClientSocket(serverUrl);
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
    const client: Socket = ClientSocket(serverUrl);
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

  it('Test E: Firing weapon broadcasts S2C_SHOT_EVENT with origin and target to other clients', async () => {
    const clientA: Socket = ClientSocket(serverUrl);
    const clientB: Socket = ClientSocket(serverUrl);

    await Promise.all([
      new Promise<void>((res) => clientA.once(PROTOCOL_EVENTS.S2C_WELCOME, () => res())),
      new Promise<void>((res) => clientB.once(PROTOCOL_EVENTS.S2C_WELCOME, () => res()))
    ]);

    const shotReceivedPromise = new Promise<ShotEventPayload>((resolve) => {
      clientB.once(PROTOCOL_EVENTS.S2C_SHOT_EVENT, (shot: ShotEventPayload) => {
        resolve(shot);
      });
    });

    const fireInput: PlayerInput = {
      seq: 200,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: -0.5,
      jump: false,
      squid: false,
      fire: true,
      clientTime: Date.now()
    };

    clientA.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, fireInput);

    const shot = await shotReceivedPromise;
    expect(shot.shooterId).toBe(clientA.id);
    expect(shot.origin).toBeDefined();
    expect(shot.target).toBeDefined();

    clientA.disconnect();
    clientB.disconnect();
  });
});

