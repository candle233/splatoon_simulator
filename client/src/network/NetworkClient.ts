import { io, Socket } from 'socket.io-client';
import {
  GameOverPayload,
  MatchStateSnapshot,
  PROTOCOL_EVENTS,
  PaintEvent,
  PlayerInput,
  PlayerSnapshot,
  ShotEventPayload,
  SnapshotPayload,
  WelcomePayload
} from '@ink/shared';

export interface NetworkCallbacks {
  onWelcome: (payload: WelcomePayload) => void;
  onPaintHistoryChunk: (events: PaintEvent[]) => void;
  onSnapshot: (payload: SnapshotPayload) => void;
  onPaintBatch: (events: PaintEvent[]) => void;
  onPlayerJoined: (player: PlayerSnapshot) => void;
  onPlayerLeft: (playerId: string) => void;
  onPlayerDied: (data: { victimId: string; killerId?: string; respawnAt: number }) => void;
  onPlayerRespawned: (player: PlayerSnapshot) => void;
  onMatchState: (state: MatchStateSnapshot) => void;
  onGameOver: (payload: GameOverPayload) => void;
  onHitFeedback: (data: { targetId: string }) => void;
  onShotEvent: (shot: ShotEventPayload) => void;
  onDisconnect: () => void;
  onConnectError: (err: Error) => void;
}

export class NetworkClient {
  private socket: Socket;
  private callbacks: NetworkCallbacks;

  private pingInterval?: number;
  private inputInterval?: number;
  private latestInputToSend?: PlayerInput;
  private inputRateMs = 33; // ~30Hz input network transmission

  public currentPing = 0;
  public estimatedServerTime = Date.now();
  public serverTimeOffset = 0;

  constructor(serverUrl: string, callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.setupListeners();
    this.startPingLoop();
    this.startInputLoop();
  }

  private setupListeners(): void {
    this.socket.on(PROTOCOL_EVENTS.S2C_WELCOME, (payload: WelcomePayload) => {
      this.serverTimeOffset = payload.serverTime - Date.now();
      this.callbacks.onWelcome(payload);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_PAINT_HISTORY_CHUNK, (events: PaintEvent[]) => {
      this.callbacks.onPaintHistoryChunk(events);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_SNAPSHOT, (payload: SnapshotPayload) => {
      this.serverTimeOffset = payload.serverTime - Date.now();
      this.callbacks.onSnapshot(payload);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_PAINT_BATCH, (events: PaintEvent[]) => {
      this.callbacks.onPaintBatch(events);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_PLAYER_JOINED, (player: PlayerSnapshot) => {
      this.callbacks.onPlayerJoined(player);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_PLAYER_LEFT, (playerId: string) => {
      this.callbacks.onPlayerLeft(playerId);
    });

    this.socket.on(
      PROTOCOL_EVENTS.S2C_PLAYER_DIED,
      (data: { victimId: string; killerId?: string; respawnAt: number }) => {
        this.callbacks.onPlayerDied(data);
      }
    );

    this.socket.on(PROTOCOL_EVENTS.S2C_PLAYER_RESPAWNED, (player: PlayerSnapshot) => {
      this.callbacks.onPlayerRespawned(player);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_MATCH_STATE, (state: MatchStateSnapshot) => {
      this.callbacks.onMatchState(state);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_GAME_OVER, (payload: GameOverPayload) => {
      this.callbacks.onGameOver(payload);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_HIT_FEEDBACK, (data: { targetId: string }) => {
      this.callbacks.onHitFeedback(data);
    });

    this.socket.on(PROTOCOL_EVENTS.S2C_SHOT_EVENT, (shot: ShotEventPayload) => {
      this.callbacks.onShotEvent(shot);
    });

    this.socket.on(
      PROTOCOL_EVENTS.S2C_PONG,
      (data: { clientTime: number; serverTime: number }) => {
        const now = Date.now();
        this.currentPing = Math.max(0, now - data.clientTime);
        this.serverTimeOffset = data.serverTime + this.currentPing / 2 - now;
      }
    );

    this.socket.on('disconnect', () => {
      this.callbacks.onDisconnect();
    });

    this.socket.on('connect_error', (err: Error) => {
      this.callbacks.onConnectError(err);
    });
  }

  queueInput(input: PlayerInput): void {
    this.latestInputToSend = input;
  }

  private startInputLoop(): void {
    this.inputInterval = window.setInterval(() => {
      if (this.latestInputToSend && this.socket.connected) {
        this.socket.emit(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, this.latestInputToSend);
      }
    }, this.inputRateMs);
  }

  private startPingLoop(): void {
    this.pingInterval = window.setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit(PROTOCOL_EVENTS.C2S_PING, Date.now());
      }
    }, 1000);
  }

  getServerTime(): number {
    return Date.now() + this.serverTimeOffset;
  }

  dispose(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.inputInterval) clearInterval(this.inputInterval);
    this.socket.disconnect();
  }
}
