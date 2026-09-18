import { createServer, Server as HttpServer } from 'http';
import express from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import {
  ARENA_OBSTACLES,
  FIXED_DT,
  GameOverPayload,
  MAX_PAINT_EVENTS_PER_MATCH,
  MAX_PLAYERS,
  MatchPhase,
  PAINT_HISTORY_CHUNK_SIZE,
  PROTOCOL_EVENTS,
  PROTOCOL_VERSION,
  PaintEvent,
  PlayerInput,
  PlayerMode,
  RESPAWN_TIME,
  SnapshotPayload,
  TICK_RATE,
  Team,
  WelcomePayload,
  getSpawnPosition
} from '@ink/shared';

import { CollisionWorld } from './Collision.js';
import { Match } from './Match.js';
import { MovementSimulation } from './MovementSimulation.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';
import { RateLimiter } from './RateLimiter.js';
import { WeaponSimulation } from './WeaponSimulation.js';
import { sanitizePlayerInput } from './validation.js';

export class GameServer {
  private app = express();
  private httpServer: HttpServer;
  private io: Server;

  private collisionWorld = new CollisionWorld(ARENA_OBSTACLES);
  private paintGrid = new PaintGrid();
  private movementSim: MovementSimulation;
  private weaponSim: WeaponSimulation;
  private match: Match;

  private players: Map<string, PlayerState> = new Map();
  private latestInputs: Map<string, PlayerInput> = new Map();
  private paintHistory: PaintEvent[] = [];
  private tickPaintEvents: PaintEvent[] = [];

  private rateLimiter = new RateLimiter(60, 40);
  private isRunning = false;
  private loopInterval?: NodeJS.Timeout;

  constructor() {
    this.app.use(cors());
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', players: this.players.size, phase: this.match.phase });
    });

    this.httpServer = createServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.movementSim = new MovementSimulation(this.collisionWorld, this.paintGrid);
    this.weaponSim = new WeaponSimulation(this.collisionWorld, this.paintGrid);
    this.match = new Match(this.paintGrid, () => this.handleMatchReset());

    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.handlePlayerConnection(socket);
    });
  }

  private handlePlayerConnection(socket: Socket): void {
    if (this.players.size >= MAX_PLAYERS) {
      socket.emit('error', 'Server is full');
      socket.disconnect(true);
      return;
    }

    const playerId = socket.id;

    // Team balancing
    let pinkCount = 0;
    let cyanCount = 0;
    for (const p of this.players.values()) {
      if (p.team === Team.PINK) pinkCount++;
      else if (p.team === Team.CYAN) cyanCount++;
    }

    let assignedTeam: Team;
    if (pinkCount < cyanCount) {
      assignedTeam = Team.PINK;
    } else if (cyanCount < pinkCount) {
      assignedTeam = Team.CYAN;
    } else {
      assignedTeam = Math.random() < 0.5 ? Team.PINK : Team.CYAN;
    }

    const slotIndex = assignedTeam === Team.PINK ? pinkCount : cyanCount;
    const spawnPos = getSpawnPosition(assignedTeam, slotIndex);
    const player = new PlayerState(playerId, assignedTeam, slotIndex, spawnPos);
    this.players.set(playerId, player);

    const now = Date.now();

    // Prepare Welcome payload
    const welcomePayload: WelcomePayload = {
      protocolVersion: PROTOCOL_VERSION,
      playerId,
      team: assignedTeam,
      serverTime: now,
      match: this.match.getSnapshot(now),
      players: Array.from(this.players.values()).map((p) => p.toSnapshot()),
      paintHistory: this.paintHistory.slice(0, PAINT_HISTORY_CHUNK_SIZE),
      obstacles: this.collisionWorld.getObstacles()
    };

    socket.emit(PROTOCOL_EVENTS.S2C_WELCOME, welcomePayload);

    // Send remaining paint history in chunks if needed
    if (this.paintHistory.length > PAINT_HISTORY_CHUNK_SIZE) {
      for (let i = PAINT_HISTORY_CHUNK_SIZE; i < this.paintHistory.length; i += PAINT_HISTORY_CHUNK_SIZE) {
        const chunk = this.paintHistory.slice(i, i + PAINT_HISTORY_CHUNK_SIZE);
        socket.emit(PROTOCOL_EVENTS.S2C_PAINT_HISTORY_CHUNK, chunk);
      }
    }

    // Broadcast new player to all others
    socket.broadcast.emit(PROTOCOL_EVENTS.S2C_PLAYER_JOINED, player.toSnapshot());

    // Setup client message listeners
    socket.on(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, (rawInput: unknown) => {
      if (!this.rateLimiter.consume(`input:${playerId}`, 1)) return;

      const input = sanitizePlayerInput(rawInput);
      if (!input) return;

      this.latestInputs.set(playerId, input);
    });

    socket.on(PROTOCOL_EVENTS.C2S_PING, (clientTimestamp: unknown) => {
      if (!this.rateLimiter.consume(`ping:${playerId}`, 1)) return;
      socket.emit(PROTOCOL_EVENTS.S2C_PONG, {
        clientTime: clientTimestamp,
        serverTime: Date.now()
      });
    });

    socket.on('disconnect', () => {
      this.handlePlayerDisconnect(playerId);
    });
  }

  private handlePlayerDisconnect(playerId: string): void {
    this.players.delete(playerId);
    this.latestInputs.delete(playerId);
    this.rateLimiter.remove(`input:${playerId}`);
    this.rateLimiter.remove(`ping:${playerId}`);

    this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_LEFT, playerId);
  }

  private handleMatchReset(): void {
    this.paintGrid.reset();
    this.paintHistory = [];
    this.tickPaintEvents = [];
    this.weaponSim.reset();

    // Respawn all players at base
    const now = Date.now();
    for (const player of this.players.values()) {
      const spawnPos = getSpawnPosition(player.team, player.slotIndex);
      player.respawn(spawnPos, now, 0);
    }
  }

  start(port = 3000): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        this.isRunning = true;
        this.startSimulationLoop();
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.isRunning = false;
      if (this.loopInterval) {
        clearInterval(this.loopInterval);
      }
      this.io.close();
      this.httpServer.close(() => resolve());
    });
  }

  private startSimulationLoop(): void {
    let previousTime = performance.now();
    let accumulator = 0;
    const targetDtMs = FIXED_DT * 1000;

    this.loopInterval = setInterval(() => {
      const currentTime = performance.now();
      const elapsed = (currentTime - previousTime) / 1000;
      previousTime = currentTime;

      // Cap accumulator to prevent spiral of death
      accumulator += Math.min(elapsed, 0.2);

      while (accumulator >= FIXED_DT) {
        this.fixedUpdate(FIXED_DT);
        accumulator -= FIXED_DT;
      }
    }, Math.floor(targetDtMs));
  }

  private fixedUpdate(dt: number): void {
    const now = Date.now();

    // 1. Update Match State Machine
    const matchUpdate = this.match.update(this.players.size, now);
    if (matchUpdate.phaseChanged) {
      this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(now));
      if (matchUpdate.gameOverPayload) {
        this.io.emit(PROTOCOL_EVENTS.S2C_GAME_OVER, matchUpdate.gameOverPayload);
      }
    }

    const allPlayersList = Array.from(this.players.values());

    // 2. Simulate Players
    for (const player of allPlayersList) {
      if (!player.alive) {
        // Check respawn timer
        if (player.respawnAt > 0 && now >= player.respawnAt) {
          const spawn = getSpawnPosition(player.team, player.slotIndex);
          player.respawn(spawn, now);
          this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_RESPAWNED, player.toSnapshot());
        }
        continue;
      }

      // If in COUNTDOWN or GAME_OVER, freeze player movement & firing
      if (this.match.phase === MatchPhase.COUNTDOWN || this.match.phase === MatchPhase.GAME_OVER) {
        continue;
      }

      // Retrieve latest client input
      const input = this.latestInputs.get(player.id);
      if (input) {
        // Simulate movement and ground DoT
        const moveRes = this.movementSim.simulatePlayer(player, input, dt, now);
        if (moveRes.diedByEnemyInk) {
          player.respawnAt = now + RESPAWN_TIME * 1000;
          const deathPaint = this.weaponSim.createDeathPaintByEnemyInk(player, now);
          this.recordPaintEvent(deathPaint);
          this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_DIED, {
            victimId: player.id,
            killerId: undefined,
            respawnAt: player.respawnAt
          });
          continue;
        }

        // Process Weapon Firing
        if (input.fire && this.match.phase === MatchPhase.PLAYING) {
          const shotResult = this.weaponSim.processFire(player, allPlayersList, now);
          if (shotResult.fired) {
            for (const pe of shotResult.paintEvents) {
              this.recordPaintEvent(pe);
            }

            if (shotResult.hitPlayerId) {
              const shooterSocket = this.io.sockets.sockets.get(player.id);
              shooterSocket?.emit(PROTOCOL_EVENTS.S2C_HIT_FEEDBACK, {
                targetId: shotResult.hitPlayerId
              });
            }

            if (shotResult.killedPlayerId) {
              const victim = this.players.get(shotResult.killedPlayerId);
              if (victim) {
                victim.respawnAt = now + RESPAWN_TIME * 1000;
                this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_DIED, {
                  victimId: victim.id,
                  killerId: player.id,
                  respawnAt: victim.respawnAt
                });
              }
            }
          }
        }
      }
    }

    // 3. Broadcast Paint Batch if any events occurred during this tick
    if (this.tickPaintEvents.length > 0) {
      this.io.emit(PROTOCOL_EVENTS.S2C_PAINT_BATCH, this.tickPaintEvents);
      this.tickPaintEvents = [];
    }

    // 4. Broadcast Snapshot at 20Hz
    const lastProcessedInputSeq: Record<string, number> = {};
    for (const player of allPlayersList) {
      lastProcessedInputSeq[player.id] = player.lastProcessedInputSeq;
    }

    const snapshotPayload: SnapshotPayload = {
      serverTime: now,
      lastProcessedInputSeq,
      players: allPlayersList.map((p) => p.toSnapshot()),
      match: this.match.getSnapshot(now)
    };

    this.io.emit(PROTOCOL_EVENTS.S2C_SNAPSHOT, snapshotPayload);
  }

  private recordPaintEvent(event: PaintEvent): void {
    if (this.paintHistory.length < MAX_PAINT_EVENTS_PER_MATCH) {
      this.paintHistory.push(event);
    }
    this.tickPaintEvents.push(event);
  }
}
