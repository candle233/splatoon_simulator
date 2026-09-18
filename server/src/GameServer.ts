import { createServer, Server as HttpServer } from 'http';
import express from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import {
  ARENA_OBSTACLES,
  FIXED_DT,
  GameOverPayload,
  LobbyPlayerState,
  LobbyStatePayload,
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
  ShotEventPayload,
  SnapshotPayload,
  TICK_RATE,
  Team,
  WeaponType,
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
  private tickShotEvents: ShotEventPayload[] = [];

  private readyPlayers: Set<string> = new Set();
  private hostPlayerId?: string;
  private playerLastActiveTime: Map<string, number> = new Map();

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
    this.match.autoStart = false;

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

    if (!this.hostPlayerId) {
      this.hostPlayerId = playerId;
    }

    const now = Date.now();
    this.playerLastActiveTime.set(playerId, now);

    // Prepare Welcome payload
    const welcomePayload: WelcomePayload = {
      protocolVersion: PROTOCOL_VERSION,
      playerId,
      team: assignedTeam,
      serverTime: now,
      match: this.match.getSnapshot(now),
      players: Array.from(this.players.values()).map((p) => p.toSnapshot()),
      paintHistory: this.paintHistory.slice(0, PAINT_HISTORY_CHUNK_SIZE),
      totalPaintEvents: this.paintHistory.length,
      obstacles: this.collisionWorld.getObstacles(),
      lobby: this.getLobbyState()
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
    this.broadcastLobbyState();

    // Setup client message listeners
    socket.on(PROTOCOL_EVENTS.C2S_PLAYER_INPUT, (rawInput: unknown) => {
      if (!this.rateLimiter.consume(`input:${playerId}`, 1)) return;

      const input = sanitizePlayerInput(rawInput);
      if (!input) return;

      this.latestInputs.set(playerId, input);

      if (input.fire || input.moveX !== 0 || input.moveZ !== 0 || input.jump || input.squid) {
        this.playerLastActiveTime.set(playerId, Date.now());
      }

      // If still in WAITING and player is actively moving/firing (e.g. headless tests/skipping lobby), auto-start countdown
      if (this.match.phase === MatchPhase.WAITING && (input.fire || input.moveX !== 0 || input.moveZ !== 0)) {
        this.match.startCountdown(Date.now());
        this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(Date.now()));
        this.broadcastLobbyState();
      }
    });

    socket.on(PROTOCOL_EVENTS.C2S_LOBBY_UPDATE, (data: { name?: string; team?: Team; weaponType?: WeaponType; ready?: boolean }) => {
      if (!data || typeof data !== 'object') return;
      const p = this.players.get(playerId);
      if (!p) return;

      if (typeof data.name === 'string' && data.name.trim().length > 0) {
        p.name = data.name.trim().slice(0, 16);
      }
      if (data.team === Team.PINK || data.team === Team.CYAN) {
        if (p.team !== data.team) {
          p.team = data.team;
          let teamCount = 0;
          for (const other of this.players.values()) {
            if (other.id !== p.id && other.team === p.team) teamCount++;
          }
          (p as any).slotIndex = teamCount;
          const newSpawn = getSpawnPosition(p.team, teamCount);
          p.position = { ...newSpawn };
        }
      }
      if (data.weaponType && ['shooter', 'roller', 'charger', 'slosher'].includes(data.weaponType)) {
        p.weaponType = data.weaponType;
      }
      if (typeof data.ready === 'boolean') {
        if (data.ready) {
          this.readyPlayers.add(playerId);
        } else {
          this.readyPlayers.delete(playerId);
        }
      }

      this.broadcastLobbyState();

      if (this.players.size > 0 && this.readyPlayers.size === this.players.size && this.match.phase === MatchPhase.WAITING) {
        this.match.startCountdown(Date.now());
        this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(Date.now()));
        this.broadcastLobbyState();
      }
    });

    socket.on(PROTOCOL_EVENTS.C2S_LOBBY_START, () => {
      if (this.match.phase === MatchPhase.WAITING) {
        if (playerId === this.hostPlayerId || this.players.size === 1) {
          this.match.startCountdown(Date.now());
          this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(Date.now()));
          this.broadcastLobbyState();
        }
      }
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

  private getLobbyState(): LobbyStatePayload {
    const players: LobbyPlayerState[] = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      weaponType: p.weaponType,
      ready: this.readyPlayers.has(p.id),
      isHost: p.id === this.hostPlayerId
    }));
    return {
      players,
      countdown: this.match.phase === MatchPhase.COUNTDOWN ? Math.max(0, Math.ceil((this.match.matchStartAt - Date.now()) / 1000)) : 0,
      inMatch: this.match.phase === MatchPhase.PLAYING || this.match.phase === MatchPhase.COUNTDOWN
    };
  }

  private broadcastLobbyState(): void {
    this.io.emit(PROTOCOL_EVENTS.S2C_LOBBY_STATE, this.getLobbyState());
  }

  private handlePlayerDisconnect(playerId: string): void {
    this.players.delete(playerId);
    this.latestInputs.delete(playerId);
    this.readyPlayers.delete(playerId);
    this.playerLastActiveTime.delete(playerId);
    this.rateLimiter.remove(`input:${playerId}`);
    this.rateLimiter.remove(`ping:${playerId}`);

    if (this.hostPlayerId === playerId) {
      this.hostPlayerId = this.players.keys().next().value;
    }

    this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_LEFT, playerId);
    this.broadcastLobbyState();

    if (this.players.size === 0) {
      this.match.update(0, Date.now());
    }
  }

  private handleMatchReset(): void {
    this.paintGrid.reset();
    this.paintHistory = [];
    this.tickPaintEvents = [];
    this.tickShotEvents = [];
    this.latestInputs.clear();
    this.readyPlayers.clear();
    this.weaponSim.reset();

    // Respawn all players at base
    const now = Date.now();
    for (const player of this.players.values()) {
      const spawnPos = getSpawnPosition(player.team, player.slotIndex);
      player.respawn(spawnPos, now, 0);
    }
    this.broadcastLobbyState();
  }

  start(port = 3000): Promise<number> {
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        this.isRunning = true;
        this.startSimulationLoop();
        const addr = this.httpServer.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
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
      this.broadcastLobbyState();
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

      // Check AFK timeout during active match (Subagent 84)
      const lastActive = this.playerLastActiveTime.get(player.id) || now;
      if (this.match.phase === MatchPhase.PLAYING && now - lastActive > 120000) {
        const sock = this.io.sockets.sockets.get(player.id);
        if (sock) {
          sock.emit('error', 'Kicked for inactivity (AFK)');
          sock.disconnect(true);
        }
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
          const isRolling = input.fire && (input.moveX !== 0 || input.moveZ !== 0);
          const wasFireHeld = player.fireHeld;
          player.fireHeld = true;

          if (player.weaponType === 'roller' && !isRolling && wasFireHeld) {
            // Roller held down while stationary; suppress repeated flick swings
          } else {
            const shotResult = this.weaponSim.processFire(player, allPlayersList, now, input.chargeLevel, isRolling);
            if (shotResult.fired) {
              if (shotResult.origin && shotResult.target) {
                this.tickShotEvents.push({
                  shooterId: player.id,
                  origin: shotResult.origin,
                  target: shotResult.target,
                  team: player.team,
                  weaponType: player.weaponType,
                  chargeLevel: shotResult.chargeLevel
                });
              }

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
        } else {
          player.fireHeld = false;
        }

        // Process Sub Weapon
        if (input.subWeapon && this.match.phase === MatchPhase.PLAYING) {
          const subRes = this.weaponSim.processSubWeapon(player, allPlayersList, now);
          if (subRes.spawned && subRes.subEvent) {
            this.io.emit(PROTOCOL_EVENTS.S2C_SUB_WEAPON_EVENT, subRes.subEvent);
          }
        }

        // Process Special Weapon
        if (input.special && this.match.phase === MatchPhase.PLAYING) {
          const specRes = this.weaponSim.processSpecial(player, allPlayersList, now);
          if (specRes.activated && specRes.specialEvent) {
            this.io.emit(PROTOCOL_EVENTS.S2C_SPECIAL_EVENT, specRes.specialEvent);
          }
        }
      }
    }

    // 2.5 Simulate Active Sub-weapons & Specials
    if (this.match.phase === MatchPhase.PLAYING) {
      const entityUpdates = this.weaponSim.updateEntities(allPlayersList, dt, now);
      for (const pe of entityUpdates.paintEvents) {
        this.recordPaintEvent(pe);
      }
      for (const se of entityUpdates.subEvents) {
        this.io.emit(PROTOCOL_EVENTS.S2C_SUB_WEAPON_EVENT, se);
      }
      for (const spe of entityUpdates.specialEvents) {
        this.io.emit(PROTOCOL_EVENTS.S2C_SPECIAL_EVENT, spe);
      }
      for (const hit of entityUpdates.hits) {
        const shooterSocket = this.io.sockets.sockets.get(hit.shooterId);
        shooterSocket?.emit(PROTOCOL_EVENTS.S2C_HIT_FEEDBACK, {
          targetId: hit.victimId
        });
      }
      for (const death of entityUpdates.deaths) {
        const victim = this.players.get(death.victimId);
        if (victim) {
          victim.respawnAt = now + RESPAWN_TIME * 1000;
          this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_DIED, {
            victimId: victim.id,
            killerId: death.killerId,
            respawnAt: victim.respawnAt
          });
        }
      }
    }

    // 3. Broadcast Paint Batch & Shot Events
    if (this.tickPaintEvents.length > 0) {
      this.io.emit(PROTOCOL_EVENTS.S2C_PAINT_BATCH, this.tickPaintEvents);
      this.tickPaintEvents = [];
    }

    if (this.tickShotEvents.length > 0) {
      for (const shot of this.tickShotEvents) {
        this.io.emit(PROTOCOL_EVENTS.S2C_SHOT_EVENT, shot);
      }
      this.tickShotEvents = [];
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
