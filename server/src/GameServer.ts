import { createServer, Server as HttpServer } from 'http';
import express from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import {
  FIXED_DT,
  GameOverPayload,
  INPUT_STALE_MS,
  LobbyPlayerState,
  LobbyStatePayload,
  MAX_BOTS,
  MAX_PAINT_EVENTS_PER_MATCH,
  MAX_PLAYERS,
  MatchPhase,
  PAINT_HISTORY_CHUNK_SIZE,
  PROTOCOL_EVENTS,
  PROTOCOL_VERSION,
  PaintEvent,
  PlayerInput,
  RESPAWN_TIME,
  ShotEventPayload,
  SnapshotPayload,
  Team,
  WeaponType,
  WelcomePayload,
  getMapDef,
  getSpawnPosition,
  isValidGameMode,
  isValidMapId,
  isValidWeaponType,
  sanitizeSkills
} from '@ink/shared';
import type { GameMode, MapId } from '@ink/shared';

import { CollisionWorld } from './Collision.js';
import { BotAI } from './BotAI.js';
import { Match } from './Match.js';
import { MovementSimulation } from './MovementSimulation.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';
import { RateLimiter } from './RateLimiter.js';
import { WeaponSimulation } from './WeaponSimulation.js';
import { sanitizeAvatar, sanitizePlayerInput } from './validation.js';

const BOT_WEAPONS: WeaponType[] = [
  'shooter',
  'roller',
  'charger',
  'slosher',
  'sprayer',
  'cannon',
  'marksman',
  'scatter'
];

export class GameServer {
  private app = express();
  private httpServer: HttpServer;
  private io: Server;

  private collisionWorld = new CollisionWorld(getMapDef().obstacles);
  private paintGrid = new PaintGrid();
  private movementSim: MovementSimulation;
  private weaponSim: WeaponSimulation;
  private match: Match;
  private botAI = new BotAI();

  private players: Map<string, PlayerState> = new Map();
  /**
   * Cached roster view of `players`, rebuilt only when the map actually
   * mutates. `processPlayerTick` used to rebuild it once per player per tick
   * (O(n^2) arrays at 20 Hz); every consumer treats it as read-only, and a
   * rebuild always allocates a *new* array so a caller iterating the previous
   * one keeps its own snapshot.
   */
  private playerRoster: PlayerState[] = [];
  private playerRosterDirty = true;
  /** Bot ids in the order they were added (for host removal). */
  private botOrder: string[] = [];
  private latestInputs: Map<string, PlayerInput> = new Map();
  private paintHistory: PaintEvent[] = [];
  private tickPaintEvents: PaintEvent[] = [];
  private tickShotEvents: ShotEventPayload[] = [];

  private readyPlayers: Set<string> = new Set();
  private hostPlayerId?: string;
  private playerLastActiveTime: Map<string, number> = new Map();
  private playerLastInputAt: Map<string, number> = new Map();

  private mapId: MapId = getMapDef().id;
  private mapSize = getMapDef().size;

  private rateLimiter = new RateLimiter(60, 40);
  private isRunning = false;
  private loopInterval?: NodeJS.Timeout;

  /** Adds a player and invalidates the cached roster view. */
  private addPlayer(player: PlayerState): void {
    this.players.set(player.id, player);
    this.playerRosterDirty = true;
  }

  /** Removes a player and invalidates the cached roster view. */
  private removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.playerRosterDirty = true;
  }

  /**
   * Read-only snapshot of every player. Reused between ticks while the roster
   * is unchanged; never mutate the returned array.
   */
  private roster(): PlayerState[] {
    if (this.playerRosterDirty) {
      this.playerRoster = Array.from(this.players.values());
      this.playerRosterDirty = false;
    }
    return this.playerRoster;
  }

  constructor() {
    this.app.use(cors());
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        players: this.players.size,
        bots: this.botOrder.length,
        phase: this.match.phase,
        mode: this.match.mode,
        map: this.mapId
      });
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
    this.applyMapSize();

    this.setupSocketHandlers();
  }

  private applyMapSize(): void {
    this.paintGrid.setMapSize(this.mapSize);
    this.movementSim.setMapSize(this.mapSize);
    this.weaponSim.setMapSize(this.mapSize);
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

    // Team balancing (bots count toward occupancy)
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
    const spawnPos = getSpawnPosition(assignedTeam, slotIndex, this.activeMap().spawnX);
    const player = new PlayerState(playerId, assignedTeam, slotIndex, spawnPos);
    this.addPlayer(player);

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
      players: this.roster().map((p) => p.toSnapshot()),
      paintHistory: this.paintHistory.slice(0, PAINT_HISTORY_CHUNK_SIZE),
      totalPaintEvents: this.paintHistory.length,
      obstacles: this.collisionWorld.getObstacles(),
      lobby: this.getLobbyState(),
      mapId: this.mapId,
      mapSize: this.mapSize
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
      this.playerLastInputAt.set(playerId, Date.now());

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

    socket.on(PROTOCOL_EVENTS.C2S_LOBBY_UPDATE, (data: Record<string, unknown>) => {
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
          (p as unknown as { slotIndex: number }).slotIndex = teamCount;
          const newSpawn = getSpawnPosition(p.team, teamCount, this.activeMap().spawnX);
          p.position = { ...newSpawn };
        }
      }
      if (typeof data.weaponType === 'string' && isValidWeaponType(data.weaponType)) {
        p.weaponType = data.weaponType;
      }
      if ('skills' in data) {
        p.skills = sanitizeSkills(data.skills);
      }
      if ('avatar' in data) {
        const avatar = sanitizeAvatar(data.avatar);
        // Ignore rejected payloads and byte-identical repeats: a client that
        // re-sends the same image every frame must not trigger a re-broadcast,
        // since the lobby payload carries the whole thumbnail.
        if (avatar && avatar !== p.avatar) {
          p.avatar = avatar;
        }
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

    // Host-only bot management
    socket.on(PROTOCOL_EVENTS.C2S_LOBBY_ADD_BOT, (data?: { team?: number }) => {
      if (playerId !== this.hostPlayerId) return;
      if (this.match.phase !== MatchPhase.WAITING) return;
      if (this.botOrder.length >= MAX_BOTS) return;
      if (this.players.size >= MAX_PLAYERS) return;

      const requestedTeam = data && data.team === Team.PINK ? Team.PINK : data && data.team === Team.CYAN ? Team.CYAN : undefined;
      const bot = this.addBot(requestedTeam);
      if (bot) {
        console.log(`[BotMgmt] add by ${playerId} -> ${bot.id} (${bot.name}); total=${this.players.size}`);
        this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_JOINED, bot.toSnapshot());
        this.broadcastLobbyState();
      }
    });

    socket.on(PROTOCOL_EVENTS.C2S_LOBBY_REMOVE_BOT, (data?: { botId?: string }) => {
      if (playerId !== this.hostPlayerId) return;
      if (this.match.phase !== MatchPhase.WAITING) return;

      const removed = this.removeBot(data?.botId);
      if (removed) {
        console.log(`[BotMgmt] remove by ${playerId} -> ${removed.id}`);
        this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_LEFT, removed.id);
        this.broadcastLobbyState();
      }
    });

    // Host-only match configuration (mode + map), WAITING phase only
    socket.on(PROTOCOL_EVENTS.C2S_MATCH_CONFIG, (data: { mode?: unknown; mapId?: unknown }) => {
      if (playerId !== this.hostPlayerId) return;
      if (this.match.phase !== MatchPhase.WAITING) return;
      if (!data || typeof data !== 'object') return;

      const mode = isValidGameMode(data.mode) ? data.mode : undefined;
      const mapId = isValidMapId(data.mapId) ? data.mapId : undefined;
      if (!mode && !mapId) return;

      const mapChanged = mapId !== undefined && mapId !== this.mapId;
      if (mapChanged) {
        this.switchMap(mapId as MapId);
      }
      this.match.setConfig(mode, mapChanged ? undefined : mapId);

      this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(Date.now()));
      this.broadcastLobbyState();
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

  private activeMap() {
    return getMapDef(this.mapId);
  }

  /** Swaps the active map: obstacles, bounds, paint state and spawn positions. */
  private switchMap(mapId: MapId): void {
    this.mapId = mapId;
    const mapDef = getMapDef(mapId);
    this.mapSize = mapDef.size;
    this.collisionWorld.setObstacles(mapDef.obstacles, mapDef.size);
    this.applyMapSize();
    this.paintGrid.reset();
    this.paintHistory = [];
    this.tickPaintEvents = [];
    this.tickShotEvents = [];
    this.weaponSim.reset();

    const now = Date.now();
    let pinkIdx = 0;
    let cyanIdx = 0;
    for (const player of this.players.values()) {
      const slot = player.team === Team.PINK ? pinkIdx++ : cyanIdx++;
      (player as unknown as { slotIndex: number }).slotIndex = slot;
      const spawn = getSpawnPosition(player.team, slot, mapDef.spawnX);
      player.respawn(spawn, now, 0);
    }
  }

  // ---------------------------------------------------------------------
  // Bot management
  // ---------------------------------------------------------------------

  addBot(requestedTeam?: Team, weaponType?: WeaponType): PlayerState | null {
    if (this.players.size >= MAX_PLAYERS || this.botOrder.length >= MAX_BOTS) {
      return null;
    }

    let pinkCount = 0;
    let cyanCount = 0;
    for (const p of this.players.values()) {
      if (p.team === Team.PINK) pinkCount++;
      else if (p.team === Team.CYAN) cyanCount++;
    }

    let team: Team;
    if (requestedTeam === Team.PINK || requestedTeam === Team.CYAN) {
      team = requestedTeam;
    } else {
      team = pinkCount <= cyanCount ? Team.PINK : Team.CYAN;
    }

    const slotIndex = team === Team.PINK ? pinkCount : cyanCount;
    const spawnPos = getSpawnPosition(team, slotIndex, this.activeMap().spawnX);
    const identity = this.botAI.nextIdentity();
    const bot = new PlayerState(identity.id, team, slotIndex, spawnPos, identity.name);
    bot.isBot = true;
    bot.weaponType =
      weaponType && BOT_WEAPONS.includes(weaponType)
        ? weaponType
        : (BOT_WEAPONS[Math.floor(Math.random() * BOT_WEAPONS.length)] ?? 'shooter');
    this.addPlayer(bot);
    this.botOrder.push(bot.id);
    return bot;
  }

  removeBot(botId?: string): PlayerState | null {
    let targetId: string | undefined;
    if (botId && this.botOrder.includes(botId)) {
      targetId = botId;
    } else {
      targetId = this.botOrder[this.botOrder.length - 1];
    }
    if (!targetId) return null;

    const bot = this.players.get(targetId);
    if (!bot) return null;

    this.removePlayer(targetId);
    this.botOrder = this.botOrder.filter((id) => id !== targetId);
    this.botAI.forget(targetId);
    this.readyPlayers.delete(targetId);
    return bot;
  }

  private getLobbyState(): LobbyStatePayload {
    const players: LobbyPlayerState[] = this.roster().map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      weaponType: p.weaponType,
      ready: this.readyPlayers.has(p.id),
      isHost: p.id === this.hostPlayerId,
      isBot: p.isBot || undefined,
      skills: p.skills.length > 0 ? p.skills : undefined,
      avatar: p.avatar
    }));
    return {
      players,
      countdown:
        this.match.phase === MatchPhase.COUNTDOWN
          ? Math.max(0, Math.ceil((this.match.matchStartAt - Date.now()) / 1000))
          : 0,
      inMatch: this.match.phase === MatchPhase.PLAYING || this.match.phase === MatchPhase.COUNTDOWN,
      mode: this.match.mode,
      mapId: this.mapId
    };
  }

  private broadcastLobbyState(): void {
    this.io.emit(PROTOCOL_EVENTS.S2C_LOBBY_STATE, this.getLobbyState());
  }

  private handlePlayerDisconnect(playerId: string): void {
    console.log(`[BotMgmt] disconnect ${playerId}; playersBefore=${this.players.size}`);
    this.removePlayer(playerId);
    this.latestInputs.delete(playerId);
    this.playerLastInputAt.delete(playerId);
    this.readyPlayers.delete(playerId);
    this.playerLastActiveTime.delete(playerId);
    this.rateLimiter.remove(`input:${playerId}`);
    this.rateLimiter.remove(`ping:${playerId}`);

    // If no humans remain after removal, tear down the bot match.
    const humansLeft = this.roster().some((p) => !p.isBot);
    if (!humansLeft && this.botOrder.length > 0) {
      for (const botId of [...this.botOrder]) {
        this.removePlayer(botId);
        this.botAI.forget(botId);
        this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_LEFT, botId);
      }
      this.botOrder = [];
    }

    // Single host lookup after bot cleanup.
    if (this.hostPlayerId === playerId || !this.hostPlayerId || !this.players.has(this.hostPlayerId)) {
      const nextHuman = this.roster().find((p) => !p.isBot);
      this.hostPlayerId = nextHuman?.id;
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
    this.playerLastInputAt.clear();
    this.readyPlayers.clear();
    this.weaponSim.reset();

    // Respawn all players (humans + bots) at base
    const now = Date.now();
    for (const player of this.players.values()) {
      const spawnPos = getSpawnPosition(player.team, player.slotIndex, this.activeMap().spawnX);
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

    // 1. Update Match State Machine (with live TDM kill scores)
    let pinkKills = 0;
    let cyanKills = 0;
    for (const p of this.players.values()) {
      if (p.team === Team.PINK) pinkKills += p.kills;
      else if (p.team === Team.CYAN) cyanKills += p.kills;
    }
    this.match.setTeamKills(pinkKills, cyanKills);

    const matchUpdate = this.match.update(this.players.size, now);
    if (matchUpdate.phaseChanged) {
      this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(now));
      this.broadcastLobbyState();
      if (matchUpdate.gameOverPayload) {
        this.io.emit(PROTOCOL_EVENTS.S2C_GAME_OVER, matchUpdate.gameOverPayload);
      }
    }

    // Splat Zones: award control points at 1 Hz (rate-limited inside Match)
    if (this.match.phase === MatchPhase.PLAYING && this.match.mode === 'splat_zones') {
      this.match.tickZone(this.paintGrid.getZoneControl(this.activeMap().zone), now);
      if ((this.match.phase as MatchPhase) === MatchPhase.GAME_OVER) {
        // tickZone may end the match on a score limit
        const zonePts = this.match.getZonePoints();
        this.io.emit(PROTOCOL_EVENTS.S2C_MATCH_STATE, this.match.getSnapshot(now));
        this.io.emit(PROTOCOL_EVENTS.S2C_GAME_OVER, {
          winner: zonePts.pink > zonePts.cyan ? Team.PINK : zonePts.cyan > zonePts.pink ? Team.CYAN : 'DRAW',
          pinkCoverage: zonePts.pink,
          cyanCoverage: zonePts.cyan,
          restartCountdown: 8,
          mode: this.match.mode
        } satisfies GameOverPayload);
        this.broadcastLobbyState();
      }
    }

    // Final Push: resample coverage on a timer; only the last sample decides
    // the winner, so the score visibly swings all match.
    if (this.match.phase === MatchPhase.PLAYING && this.match.mode === 'final_push') {
      this.match.tickFinalPush(now);
    }

    const allPlayersList = this.roster();

    // Lobby host handover: an idle host page (stale tab, reload loop) must not
    // squat the host slot forever — pass it to an active human in WAITING.
    if (this.match.phase === MatchPhase.WAITING && this.hostPlayerId) {
      const host = this.players.get(this.hostPlayerId);
      if (host && !host.isBot) {
        const hostLastActive = this.playerLastActiveTime.get(host.id) || 0;
        if (now - hostLastActive > 120000) {
          const nextHuman = allPlayersList.find((p) => {
            if (p.isBot || p.id === host.id) return false;
            return now - (this.playerLastActiveTime.get(p.id) || 0) <= 120000;
          });
          if (nextHuman) {
            console.log(`[BotMgmt] host ${host.id} idle -> transfer to ${nextHuman.id}`);
            this.hostPlayerId = nextHuman.id;
            this.broadcastLobbyState();
          }
        }
      }
    }

    // 2. Respawn timers (humans + bots)
    for (const player of allPlayersList) {
      if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
        const spawn = getSpawnPosition(player.team, player.slotIndex, this.activeMap().spawnX);
        player.respawn(spawn, now, RESPAWN_TIME * player.skillMult('quick_respawn'));
        this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_RESPAWNED, player.toSnapshot());
      }
    }

    // 3. Simulate players during WAITING (lobby free roam) and PLAYING
    if (this.match.phase === MatchPhase.PLAYING || this.match.phase === MatchPhase.WAITING) {
      for (const player of allPlayersList) {
        if (!player.alive) continue;

        if (player.isBot) {
          if (this.match.phase !== MatchPhase.PLAYING) continue;
          const botInput = this.botAI.think(
            player,
            allPlayersList,
            this.collisionWorld,
            this.paintGrid,
            this.mapSize,
            now
          );
          this.processPlayerTick(player, botInput, dt, now);
          continue;
        }

        // AFK timeout during active match (humans only)
        const lastActive = this.playerLastActiveTime.get(player.id) || now;
        if (this.match.phase === MatchPhase.PLAYING && now - lastActive > 120000) {
          const sock = this.io.sockets.sockets.get(player.id);
          if (sock) {
            sock.emit('error', 'Kicked for inactivity (AFK)');
            sock.disconnect(true);
          }
          continue;
        }

        // Retrieve latest client input. If the client stopped sending (background tab,
        // lag spike, disconnect), neutralize held keys so stale input cannot keep the
        // player running / firing indefinitely.
        const receivedInput = this.latestInputs.get(player.id);
        let input = receivedInput;
        if (receivedInput) {
          const lastInputAt = this.playerLastInputAt.get(player.id) ?? 0;
          if (now - lastInputAt > INPUT_STALE_MS) {
            input = {
              ...receivedInput,
              moveX: 0,
              moveZ: 0,
              jump: false,
              fire: false,
              squid: false
            };
          }
        }
        if (input) {
          this.processPlayerTick(player, input, dt, now);
        }
      }
    }

    // 3.5 Simulate Active Sub-weapons & Specials
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
          victim.respawnAt = now + RESPAWN_TIME * 1000 * victim.skillMult('quick_respawn');
          this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_DIED, {
            victimId: victim.id,
            killerId: death.killerId,
            respawnAt: victim.respawnAt
          });
        }
      }
    }

    // 4. Broadcast Paint Batch & Shot Events
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

    // 5. Broadcast Snapshot at 20Hz
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

  /**
   * Shared per-tick pipeline for humans and bots: movement, weapon fire,
   * sub weapons and specials. Emits death / hit / shot / paint events.
   */
  private processPlayerTick(player: PlayerState, input: PlayerInput, dt: number, now: number): void {
    const allPlayersList = this.roster();

    // Simulate movement and ground DoT
    const moveRes = this.movementSim.simulatePlayer(player, input, dt, now);
    if (moveRes.diedByEnemyInk) {
      player.respawnAt = now + RESPAWN_TIME * 1000 * player.skillMult('quick_respawn');
      const deathPaint = this.weaponSim.createDeathPaintByEnemyInk(player, now);
      this.recordPaintEvent(deathPaint);
      this.io.emit(PROTOCOL_EVENTS.S2C_PLAYER_DIED, {
        victimId: player.id,
        killerId: undefined,
        respawnAt: player.respawnAt
      });
      return;
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
              victim.respawnAt = now + RESPAWN_TIME * 1000 * victim.skillMult('quick_respawn');
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

    // Edge flags are one-shot per press; clear them on the stored snapshot so
    // the next tick (before a newer input arrives) cannot consume them again.
    input.subWeapon = false;
    input.special = false;
  }

  private recordPaintEvent(event: PaintEvent): void {
    if (this.paintHistory.length < MAX_PAINT_EVENTS_PER_MATCH) {
      this.paintHistory.push(event);
    }
    this.tickPaintEvents.push(event);
  }
}
