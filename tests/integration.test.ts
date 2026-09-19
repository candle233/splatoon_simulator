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

    // Shoot downwards towards ground (pitch = -Math.PI / 3).
    // Send continuously like a real client holding the trigger — the server
    // neutralizes held keys from inputs older than INPUT_STALE_MS, so a single
    // stale fire input sent during COUNTDOWN must not fire later.
    let fireSeq = 10;
    const fireInput: PlayerInput = {
      seq: fireSeq,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: -1.0,
      jump: false,
      squid: false,
      fire: true,
      clientTime: Date.now()
    };

    const fireInterval = setInterval(() => {
      fireSeq += 1;
      shooter.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, { ...fireInput, seq: fireSeq, clientTime: Date.now() });
    }, 100);
    shooter.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, { ...fireInput });

    // Wait for PAINT_BATCH
    const paintBatch = await new Promise<PaintEvent[]>((resolve) => {
      shooter.on(PROTOCOL_EVENTS.S2C_PAINT_BATCH, (batch: PaintEvent[]) => {
        resolve(batch);
      });
    });
    clearInterval(fireInterval);

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

    // Continuous fire like a real client holding LMB (stale inputs are neutralized).
    let shotSeq = 200;
    const fireInterval = setInterval(() => {
      shotSeq += 1;
      clientA.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, { ...fireInput, seq: shotSeq, clientTime: Date.now() });
    }, 100);
    clientA.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, { ...fireInput });

    const shot = await shotReceivedPromise;
    clearInterval(fireInterval);
    expect(shot.shooterId).toBe(clientA.id);
    expect(shot.origin).toBeDefined();
    expect(shot.target).toBeDefined();

    clientA.disconnect();
    clientB.disconnect();
  });

  it('Stale input neutralization: player stops moving when client stops sending inputs', async () => {
    const client: Socket = ClientSocket(serverUrl);
    await new Promise<void>((res) => client.once(PROTOCOL_EVENTS.S2C_WELCOME, () => res()));

    const baseInput = {
      moveX: 0,
      moveZ: -1,
      yaw: 0,
      pitch: 0,
      jump: false,
      squid: false,
      fire: false,
      clientTime: Date.now()
    };

    // Keep sending while WAITING/COUNTDOWN so the match reaches PLAYING.
    let seq = 300;
    let phase = MatchPhase.WAITING;
    const moveToPlaying = setInterval(() => {
      seq += 1;
      client.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, { ...baseInput, seq, clientTime: Date.now() });
    }, 100);
    const playingReached = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('match never reached PLAYING')), 8000);
      client.on(PROTOCOL_EVENTS.S2C_SNAPSHOT, (snap: SnapshotPayload) => {
        if (snap.match.phase === MatchPhase.PLAYING) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    await playingReached;
    clearInterval(moveToPlaying);

    // Send one last forward input, then go silent (like a frozen/hidden client).
    seq += 1;
    client.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, { ...baseInput, seq, clientTime: Date.now() });

    // Collect ~1.6s of snapshots after the silence starts; movement must cease.
    await new Promise((r) => setTimeout(r, 1600));
    const zs: number[] = [];
    await new Promise<void>((resolve) => {
      const onSnap = (snap: SnapshotPayload) => {
        const me = snap.players.find((p) => p.id === client.id);
        if (me) zs.push(me.z);
        if (zs.length >= 4) {
          client.off(PROTOCOL_EVENTS.S2C_SNAPSHOT, onSnap);
          resolve();
        }
      };
      client.on(PROTOCOL_EVENTS.S2C_SNAPSHOT, onSnap);
    });

    const maxDrift = Math.max(...zs) - Math.min(...zs);
    expect(zs.length).toBeGreaterThanOrEqual(4);
    expect(maxDrift).toBeLessThan(1.0); // stopped, not gliding to the wall
    client.disconnect();
  });
});

