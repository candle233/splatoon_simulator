import {
  ARENA_OBSTACLES,
  GameOverPayload,
  LobbyStatePayload,
  MatchPhase,
  MatchStateSnapshot,
  PAINT_RADIUS_WORLD,
  PaintEvent,
  PlayerMode,
  PlayerSnapshot,
  SUB_WEAPON_CONFIGS,
  ShotEventPayload,
  SnapshotPayload,
  SpecialEventPayload,
  SubWeaponEventPayload,
  Team,
  WEAPON_CONFIGS,
  WeaponType,
  WelcomePayload,
  getMapDef,
  getSpawnPosition,
  isChargeWeapon,
  worldToUV
} from '@ink/shared';
import type { GameMode, MapDef, MapId } from '@ink/shared';

import { VisualWeapon } from '../combat/Weapon.js';
import { ParticleSystem } from '../combat/ParticleSystem.js';
import { Crosshair } from '../combat/Crosshair.js';
import { CameraController } from '../player/CameraController.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { RemotePlayer } from '../player/RemotePlayer.js';
import { NetworkClient } from '../network/NetworkClient.js';
import { SnapshotBuffer, createInterpolatedState } from '../network/SnapshotBuffer.js';
import { GameOverScreen } from '../ui/GameOverScreen.js';
import { HUD } from '../ui/HUD.js';
import { Scoreboard } from '../ui/Scoreboard.js';
import { Minimap, MinimapPlayerData } from '../ui/Minimap.js';
import { SettingsModal } from '../ui/SettingsModal.js';
import { LobbyScreen } from '../ui/LobbyScreen.js';
import { TitleScreen } from '../ui/TitleScreen.js';
import { ScreenManager, screenRouteForPhase } from '../ui/ScreenManager.js';
import { BotController, BotState } from '../bot/BotController.js';
import { Arena } from '../world/Arena.js';
import { ClientCollisionWorld } from '../world/CollisionWorld.js';
import { PaintEngine } from '../world/PaintEngine.js';
import { Clock } from './Clock.js';
import { InputManager } from './InputManager.js';
import { GameRenderer } from './Renderer.js';
import { SoundManager } from './SoundManager.js';
import { t } from '../i18n.js';

/** Small deterministic hash so cosmetics stay stable per player id. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

export class Game {
  private renderer: GameRenderer;
  private clock = new Clock();
  private collisionWorld = new ClientCollisionWorld(ARENA_OBSTACLES);
  private paintEngine = new PaintEngine();
  private arena: Arena;
  private weaponVisual = new VisualWeapon();
  private particleSystem = new ParticleSystem();
  private crosshair = new Crosshair();
  private hud = new HUD();
  private minimap: Minimap;
  private settingsModal: SettingsModal;
  private botController: BotController;
  private botRemotePlayers = new Map<string, RemotePlayer>();
  private gameOverScreen = new GameOverScreen();
  private scoreboard = new Scoreboard();
  private lobbyScreen: LobbyScreen;
  private titleScreen: TitleScreen;
  private screens = new ScreenManager();
  private inputManager: InputManager;
  private cameraController: CameraController;
  private soundManager = new SoundManager();

  private networkClient: NetworkClient;
  private snapshotBuffer = new SnapshotBuffer();

  private localPlayer?: LocalPlayer;
  private remotePlayers = new Map<string, RemotePlayer>();
  private playerMeta = new Map<string, { name: string; team: Team }>();
  private lastLocalMode = PlayerMode.HUMANOID;

  private inputSeq = 0;
  private matchPhase: MatchPhase = MatchPhase.WAITING;
  private matchMode: GameMode | undefined;
  private activeMapDef: MapDef = getMapDef();
  private matchStartAt = 0;
  private matchEndAt = 0;
  private pinkScore = 0;
  private cyanScore = 0;
  private totalPaintEventsReceived = 0;
  private expectedTotalPaintEvents = 0;

  private isRunning = false;
  private respawnEndsAt = 0;
  private gameOverEndsAt = 0;
  private lastLocalShotTime = 0;
  private lastDebugUpdateTime = 0;
  private lastRemoteShotSoundAt = 0;
  /** Debug-fire window end timestamp (test hook only; the server still validates everything). */
  private debugFireUntil = 0;

  // --- Per-frame scratch buffers -------------------------------------------
  // The render loop runs 60+ times a second; every one of these is reused and
  // overwritten in place instead of allocating. Consumers (minimap, HUD squid
  // row) only read them during the same frame and never retain them, so a
  // single shared buffer per shape is safe.
  /** Radar blips: local player + every remote (bots appended after remotes). */
  private readonly minimapBlips: MinimapPlayerData[] = [];
  private readonly minimapLocal: MinimapPlayerData = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    team: Team.NEUTRAL,
    alive: false
  };
  /** HUD squid indicators, same order: local, remotes, bots. */
  private readonly squidIndicators: { team: Team; alive: boolean; specialMeter: number }[] = [];
  /** Reused interpolation result handed to `RemotePlayer.update`. */
  private readonly remoteState = createInterpolatedState();
  /** Frame-time sampling for the debug hook (rolling window). */
  private frameTimeHistory: number[] = [];
  private frameTimeMax = 0;
  private lastFrameAt = 0;

  constructor() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas element #webgl-canvas not found');
    }

    this.renderer = new GameRenderer(canvas);
    this.arena = new Arena(this.paintEngine, this.activeMapDef);
    this.renderer.scene.add(this.arena.group);
    this.renderer.scene.add(this.weaponVisual.group);
    this.renderer.scene.add(this.particleSystem.group);
    this.renderer.applyTheme(this.activeMapDef.theme);

    this.minimap = new Minimap(this.paintEngine);
    this.botController = new BotController(this.paintEngine);

    this.cameraController = new CameraController(this.renderer.camera, this.collisionWorld);
    this.inputManager = new InputManager(
      canvas,
      () => this.hud.toggleDebugOverlay(),
      (locked) => this.handleLockChange(locked)
    );

    this.settingsModal = new SettingsModal({
      onSensitivityChange: (val) => {
        this.inputManager.setSensitivity(val * 0.0022);
      },
      onFovChange: (fov) => {
        this.renderer.camera.fov = fov;
        this.renderer.camera.updateProjectionMatrix();
      },
      onSfxVolumeChange: (vol) => {
        this.soundManager.setSfxVolume(vol);
      },
      onBgmVolumeChange: (vol) => {
        this.soundManager.setBgmVolume(vol);
      },
      onQualityChange: (q) => this.applyQuality(q),
      onSpawnBot: () => {
        this.spawnPracticeBot();
      },
      onClearBots: () => {
        this.clearPracticeBots();
      }
    });

    // Apply loaded settings
    this.inputManager.setSensitivity(this.settingsModal.config.mouseSensitivity * 0.0022);
    this.renderer.camera.fov = this.settingsModal.config.fov;
    this.renderer.camera.updateProjectionMatrix();
    this.soundManager.setSfxVolume(this.settingsModal.config.sfxVolume);
    this.soundManager.setBgmVolume(this.settingsModal.config.bgmVolume);
    this.applyQuality(this.settingsModal.config.quality);

    this.titleScreen = new TitleScreen(
      {
        onPlay: () => {
          this.lobbyScreen.show();
        },
        onOpenSettings: () => this.settingsModal.show()
      },
      this.screens
    );

    this.lobbyScreen = new LobbyScreen(
      {
        onLobbyUpdate: (data) => this.networkClient.sendLobbyUpdate(data),
        onLobbyStart: () => this.networkClient.sendLobbyStart(),
        onWeaponChanged: (weapon) => {
          this.setLocalWeapon(weapon);
        },
        onRequestEnterArena: () => {
          this.inputManager.requestPointerLock();
        },
        onMatchConfig: (config) => this.networkClient.sendMatchConfig(config),
        onAddBot: () => this.networkClient.sendAddBot(),
        onRemoveBot: () => this.networkClient.sendRemoveBot(),
        onReturnToTitle: () => {
          this.screens.show('title');
        }
      },
      this.screens
    );

    this.setupPointerLockPrompt();

    // Connect to Server
    // Always connect to the page origin: in dev the Vite proxy forwards
    // /socket.io to the game server; in production the server serves the
    // client from the same origin. Works on any dev port.
    const serverUrl = window.location.origin;
    this.hud.showSyncBanner(t('hud.connecting'));

    this.networkClient = new NetworkClient(serverUrl, {
      onWelcome: (payload) => this.handleWelcome(payload),
      onPaintHistoryChunk: (events) => this.handlePaintHistoryChunk(events),
      onSnapshot: (payload) => this.handleSnapshot(payload),
      onPaintBatch: (events) => this.handlePaintBatch(events),
      onPlayerJoined: (p) => this.handlePlayerJoined(p),
      onPlayerLeft: (id) => this.handlePlayerLeft(id),
      onPlayerDied: (data) => this.handlePlayerDied(data),
      onPlayerRespawned: (p) => this.handlePlayerRespawned(p),
      onMatchState: (state) => this.handleMatchState(state),
      onGameOver: (payload) => this.handleGameOver(payload),
      onHitFeedback: () => {
        this.crosshair.showHitMarker();
        this.soundManager.playHit();
      },
      onShotEvent: (shot) => this.handleShotEvent(shot),
      onLobbyState: (state) => this.handleLobbyState(state),
      onSubWeaponEvent: (evt) => this.handleSubWeaponEvent(evt),
      onSpecialEvent: (evt) => this.handleSpecialEvent(evt),
      onConnect: () => {
        this.hud.hideSyncBanner();
      },
      onDisconnect: () => this.handleDisconnect(),
      onConnectError: (err) => this.handleConnectError(err)
    });
  }

  private setupPointerLockPrompt(): void {
    const prompt = document.getElementById('pointer-lock-prompt');
    const startBtn = document.getElementById('start-button');

    const enterGame = () => {
      if (!this.lobbyScreen.isVisible() && !this.titleScreen.isVisible()) {
        this.inputManager.requestPointerLock();
        prompt?.classList.add('hidden');
      }
    };

    startBtn?.addEventListener('click', enterGame);
    prompt?.addEventListener('click', enterGame);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !this.inputManager.isLocked() && !this.lobbyScreen.isVisible() && !this.titleScreen.isVisible()) {
        enterGame();
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) {
          this.scoreboard.setVisible(true);
        }
      }
      // In-match quick weapon switching on 1-8, in the same order the lobby
      // grid lists the roster so the keys match what the player just saw.
      const weaponKeys: Record<string, WeaponType> = {};
      (Object.keys(WEAPON_CONFIGS) as WeaponType[]).forEach((id, i) => {
        if (i < 9) weaponKeys[`Digit${i + 1}`] = id;
      });
      const weapon = weaponKeys[e.code];
      if (weapon && !e.repeat && this.localPlayer) {
        const inGame = !this.lobbyScreen.isVisible() && !this.titleScreen.isVisible();
        if (inGame && this.inputManager.isLocked()) {
          this.setLocalWeapon(weapon);
          this.lobbyScreen.selectedWeapon = weapon;
          this.networkClient.sendLobbyUpdate({ weaponType: weapon });
          this.hud.addKillFeedEntry('⚙', Team.NEUTRAL, `${weapon.toUpperCase()}`, this.localPlayer.team, '🔁');
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboard.setVisible(false);
      }
    });
  }

  private setLocalWeapon(weapon: WeaponType): void {
    if (!this.localPlayer) return;
    this.localPlayer.weaponType = weapon;
    this.localPlayer.view.setWeaponType(weapon);
  }

  /**
   * Writes one radar blip into the reused buffer, growing it only when the
   * roster is larger than anything seen before.
   */
  private writeBlip(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    team: Team,
    alive: boolean
  ): void {
    const blip = this.minimapBlips[index];
    if (blip) {
      blip.position.x = x;
      blip.position.y = y;
      blip.position.z = z;
      blip.yaw = yaw;
      blip.team = team;
      blip.alive = alive;
      return;
    }
    this.minimapBlips[index] = { position: { x, y, z }, yaw, team, alive };
  }

  /**
   * Writes one HUD squid indicator into the reused buffer.
   */
  private writeSquid(index: number, team: Team, alive: boolean, specialMeter: number): void {
    const entry = this.squidIndicators[index];
    if (entry) {
      entry.team = team;
      entry.alive = alive;
      entry.specialMeter = specialMeter;
      return;
    }
    this.squidIndicators[index] = { team, alive, specialMeter };
  }

  /**
   * Rolling frame-time window (last 120 frames) exposed through the debug hook
   * so a regression can be read programmatically instead of by eye.
   */
  private sampleFrameTime(now: number): void {
    if (this.lastFrameAt > 0) {
      const delta = now - this.lastFrameAt;
      this.frameTimeHistory.push(delta);
      if (this.frameTimeHistory.length > 120) this.frameTimeHistory.shift();
      if (delta > this.frameTimeMax) this.frameTimeMax = delta;
    }
    this.lastFrameAt = now;
  }

  /** Snapshot of the frame-time window: mean, p95 and the worst sample. */
  private frameStats(): { avgMs: number; p95Ms: number; maxMs: number; samples: number; fps: number } {
    const history = this.frameTimeHistory;
    const n = history.length;
    if (n === 0) {
      return { avgMs: 0, p95Ms: 0, maxMs: 0, samples: 0, fps: 0 };
    }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += history[i]!;
    const avg = sum / n;
    // Copy before sorting: the window must keep its chronological order.
    const sorted = history.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))]!;
    return {
      avgMs: Math.round(avg * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      maxMs: Math.round(this.frameTimeMax * 100) / 100,
      samples: n,
      fps: Math.round((1000 / Math.max(0.01, avg)) * 10) / 10
    };
  }

  /** Clears the frame-time window (used by tests/automation before a measurement). */
  private resetFrameStats(): void {
    this.frameTimeHistory.length = 0;
    this.frameTimeMax = 0;
    this.lastFrameAt = 0;
  }

  private applyQuality(q: 'low' | 'medium' | 'high' | 'auto'): void {
    this.renderer.setQualityLevel(q);
    this.particleSystem.setDensityScale(q === 'low' ? 0.5 : q === 'medium' ? 0.75 : 1);
  }

  start(): void {
    this.isRunning = true;
    this.installDebugHook();
    requestAnimationFrame(this.renderLoop);
  }

  /**
   * Read-only test/automation hook. Exposes simulation state and a debug-fire
   * request counter; firing still travels through the normal server pipeline
   * (rate limit, cooldown, ink, raycast, authority all remain server-side).
   */
  private installDebugHook(): void {
    const w = window as unknown as { __inkArena?: Record<string, unknown> };
    w.__inkArena = {
      getState: () => {
        const lp = this.localPlayer;
        return {
          id: lp?.id ?? null,
          team: lp?.team ?? null,
          phase: this.matchPhase,
          lobbyVisible: this.lobbyScreen.isVisible(),
          visibleScreens: this.screens.visibleIds(),
          activeScreen: this.screens.getActiveId(),
          matchMode: this.matchMode,
          mapId: this.activeMapDef.id,
          mapSize: this.activeMapDef.size,
          zoneMarkerVisible: this.arena.isZoneMarkerVisible(),
          locked: this.inputManager.isLocked(),
          alive: lp?.alive ?? false,
          hp: lp?.hp ?? 0,
          ink: lp ? Math.round(lp.ink) : 0,
          mode: lp ? PlayerMode[lp.mode] : null,
          weaponType: lp?.weaponType ?? null,
          pos: lp
            ? {
                x: Math.round(lp.position.x * 100) / 100,
                y: Math.round(lp.position.y * 100) / 100,
                z: Math.round(lp.position.z * 100) / 100
              }
            : null,
          remoteCount: this.remotePlayers.size,
          remotes: Array.from(this.remotePlayers.entries()).map(([id, rp]) => ({
            id,
            team: rp.team,
            alive: rp.alive,
            x: Math.round(rp.position.x * 100) / 100,
            y: Math.round(rp.position.y * 100) / 100,
            z: Math.round(rp.position.z * 100) / 100
          })),
          paintEventsReceived: this.totalPaintEventsReceived,
          pinkScore: this.pinkScore,
          cyanScore: this.cyanScore,
          net: {
            sent: this.networkClient.debugSentInputs,
            latchedSub: this.networkClient.debugLatchedSub,
            latchedSpecial: this.networkClient.debugLatchedSpecial,
            connected: (this.networkClient as unknown as { socket: { connected: boolean } }).socket.connected
          },
          bufferLen: (this.snapshotBuffer as unknown as { buffer: unknown[] }).buffer.length,
          serverTime: Math.round(this.networkClient.getServerTime()),
          frames: this.frameStats(),
          render: this.renderer.getRenderInfo(),
          paint: this.paintEngine.getUploadStats(),
          remoteRaw: Array.from(this.remotePlayers.entries()).map(([id, rp]) => {
            const r = rp as unknown as { lastTime: number; lastPos: { x: number; y: number; z: number } };
            return { id, lastTime: Math.round(r.lastTime * 1000) / 1000, lastPos: r.lastPos };
          }),
          probe: (() => {
            const buf = this.snapshotBuffer as unknown as {
              buffer: { timestamp: number; players: Map<string, { x: number; z: number }> }[];
              getInterpolatedState: (id: string, t: number) => unknown;
            };
            const firstRemote = this.remotePlayers.keys().next().value as string | undefined;
            if (!firstRemote) return 'no-remote';
            const b = buf.buffer;
            const last = b[b.length - 1];
            const selfSnap = last ? last.players.get(this.localPlayer?.id ?? '') : null;
            const remoteSnap = last ? last.players.get(firstRemote) : null;
            return {
              bufLen: b.length,
              lastTs: last ? Math.round(last.timestamp) : null,
              estNow: Math.round(this.networkClient.getServerTime()),
              selfServerPos: selfSnap ? { x: selfSnap.x, z: selfSnap.z } : null,
              remoteServerPos: remoteSnap ? { x: remoteSnap.x, z: remoteSnap.z } : null,
              result: buf.getInterpolatedState(firstRemote, this.networkClient.getServerTime())
            };
          })()
        };
      },
      debugFire: (durationMs = 1500) => {
        this.debugFireUntil = performance.now() + Math.max(100, Math.min(5000, durationMs));
      },
      /** Frame-time window control for automated perf runs. */
      resetFrameStats: () => {
        this.resetFrameStats();
      },
      getFrameStats: () => this.frameStats(),
      /** Live renderer counters (draw calls, triangles, programs). */
      getRenderInfo: () => this.renderer.getRenderInfo()
    };
  }

  private renderLoop = (): void => {
    if (!this.isRunning) return;

    requestAnimationFrame(this.renderLoop);

    const dt = this.clock.getDelta();
    const now = performance.now();
    const serverTime = this.networkClient.getServerTime();

    this.sampleFrameTime(now);

    // Dynamic resolution (quality = auto)
    this.renderer.adaptiveTick(this.clock.getFPS(), now);

    // 1. Local Player Processing
    if (this.localPlayer) {
      // Charge input follows the weapon's own stats, so a charging weapon added
      // later needs no edit here.
      const isCharger = isChargeWeapon(this.localPlayer.weaponType || 'shooter');
      this.inputManager.updateCharge(dt, isCharger);

      this.inputSeq++;
      const input = this.inputManager.getCurrentInput(this.inputSeq);
      input.weaponType = this.localPlayer.weaponType || 'shooter';

      const inLobby = this.lobbyScreen.isVisible();
      const weaponType = this.localPlayer.weaponType || 'shooter';
      const wConfig = WEAPON_CONFIGS[weaponType] || WEAPON_CONFIGS.shooter;
      const fireIntervalMs = (1 / wConfig.fireRate) * 1000;

      // Only allow firing if playing and alive and pointer is locked
      const canShoot =
        !inLobby &&
        this.matchPhase === MatchPhase.PLAYING &&
        this.localPlayer.alive &&
        this.inputManager.isLocked() &&
        this.localPlayer.mode === PlayerMode.HUMANOID &&
        this.localPlayer.ink >= wConfig.inkCost;

      if (!canShoot) {
        if (input.fire && this.inputManager.isLocked() && this.localPlayer.ink < wConfig.inkCost) {
          this.soundManager.playDryFire();
        }
        input.fire = false;
      }
      if (inLobby) {
        input.subWeapon = false;
        input.special = false;
      }

      if (input.fire) {
        if (now - this.lastLocalShotTime >= fireIntervalMs) {
          this.lastLocalShotTime = now;
          this.crosshair.onFire();
          this.localPlayer.triggerShootRecoil();
          this.cameraController.addRecoil(0.014);

          if (isCharger) {
            this.soundManager.playChargerShot(input.chargeLevel || 1.0);
            this.cameraController.addShake(0.18, 0.15);
          } else if (weaponType === 'roller') {
            this.soundManager.playRollerFlick();
            this.cameraController.addShake(0.12, 0.12);
          } else if (weaponType === 'slosher' || weaponType === 'cannon') {
            this.soundManager.playBucket();
            this.cameraController.addShake(0.1, 0.1);
          } else {
            this.soundManager.playShoot();
          }

          this.localPlayer.ink = Math.max(0, this.localPlayer.ink - wConfig.inkCost);

          const cosP = Math.cos(this.localPlayer.pitch);
          const sinP = Math.sin(this.localPlayer.pitch);
          const cosY = Math.cos(this.localPlayer.yaw);
          const sinY = Math.sin(this.localPlayer.yaw);

          const fwdX = -sinY * cosP;
          const fwdY = sinP;
          const fwdZ = -cosY * cosP;
          const rgtX = cosY;
          const rgtZ = -sinY;

          const headX = this.localPlayer.position.x;
          const headY = this.localPlayer.position.y + 1.8;
          const headZ = this.localPlayer.position.z;

          const baseCamDist = 5.2;
          const shoulderOffset = 0.65;

          const aimTargetX = headX + fwdX * 30;
          const aimTargetY = headY + fwdY * 30;
          const aimTargetZ = headZ + fwdZ * 30;

          let camX = headX - fwdX * baseCamDist + rgtX * shoulderOffset;
          let camY = headY - fwdY * baseCamDist;
          let camZ = headZ - fwdZ * baseCamDist + rgtZ * shoulderOffset;

          const camDirX = camX - headX;
          const camDirY = camY - headY;
          const camDirZ = camZ - headZ;
          const camRayLen = Math.sqrt(camDirX * camDirX + camDirY * camDirY + camDirZ * camDirZ);

          if (camRayLen > 1e-4) {
            const hitCamDist = this.collisionWorld.castCameraRay(
              {
                origin: { x: headX, y: headY, z: headZ },
                direction: { x: camDirX / camRayLen, y: camDirY / camRayLen, z: camDirZ / camRayLen }
              },
              camRayLen
            );
            if (hitCamDist !== null && hitCamDist < camRayLen) {
              const safeDist = Math.max(0.6, hitCamDist - 0.25);
              camX = headX + (camDirX / camRayLen) * safeDist;
              camY = headY + (camDirY / camRayLen) * safeDist;
              camZ = headZ + (camDirZ / camRayLen) * safeDist;
            }
          }

          const toCrosshairX = aimTargetX - camX;
          const toCrosshairY = aimTargetY - camY;
          const toCrosshairZ = aimTargetZ - camZ;
          const crosshairLen = Math.sqrt(toCrosshairX * toCrosshairX + toCrosshairY * toCrosshairY + toCrosshairZ * toCrosshairZ);
          const crosshairDir = {
            x: toCrosshairX / (crosshairLen || 1),
            y: toCrosshairY / (crosshairLen || 1),
            z: toCrosshairZ / (crosshairLen || 1)
          };

          // Stage 1: Camera Raycast to get exact 3D aim point
          const cameraHit = this.collisionWorld.castRay(
            { origin: { x: camX, y: camY, z: camZ }, direction: crosshairDir },
            35 + baseCamDist
          );
          const aimPoint = cameraHit.hit ? cameraHit.point : {
            x: camX + crosshairDir.x * 35,
            y: camY + crosshairDir.y * 35,
            z: camZ + crosshairDir.z * 35
          };

          // Stage 2: Muzzle Raycast towards aimPoint
          const muzzle = {
            x: this.localPlayer.position.x + rgtX * 0.35 + fwdX * 0.4,
            y: this.localPlayer.position.y + 0.85 + fwdY * 0.4,
            z: this.localPlayer.position.z + rgtZ * 0.35 + fwdZ * 0.4
          };

          let dirX = aimPoint.x - muzzle.x;
          let dirY = aimPoint.y - muzzle.y;
          let dirZ = aimPoint.z - muzzle.z;
          const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
          const muzzleDir = {
            x: dirX / (dirLen || 1),
            y: dirY / (dirLen || 1),
            z: dirZ / (dirLen || 1)
          };

          const muzzleHit = this.collisionWorld.castRay(
            { origin: muzzle, direction: muzzleDir },
            dirLen || 35
          );

          const target = muzzleHit.hit ? muzzleHit.point : aimPoint;
          this.weaponVisual.spawnTracer(muzzle, target, this.localPlayer.team, weaponType, input.chargeLevel);

          // 3D Particles: Muzzle Spray and Impact Splash
          this.particleSystem.spawnMuzzleSpray(muzzle, muzzleDir, this.localPlayer.team);
          this.particleSystem.spawnSplash(target, this.localPlayer.team, 8, 6.5);

          // Check if shot hit any bot
          for (const bot of this.botController.getBots()) {
            if (bot.team !== this.localPlayer.team && bot.alive) {
              const bdx = bot.position.x - target.x;
              const bdz = bot.position.z - target.z;
              if (Math.hypot(bdx, bdz) < 1.8) {
                bot.hp -= 35;
                this.crosshair.showHitMarker();
                this.soundManager.playHit();
                this.particleSystem.spawnSplash(bot.position, this.localPlayer.team, 10, 7.0);
                if (bot.hp <= 0) {
                  bot.alive = false;
                  bot.mode = PlayerMode.DEAD;
                  bot.deaths++;
                  bot.respawnAt = now + 4000;
                  this.localPlayer.kills++;
                  this.soundManager.playKillChime();
                  this.cameraController.addShake(0.35, 0.25);
                  this.particleSystem.spawnSplash(bot.position, this.localPlayer.team, 24, 11.0);
                  this.hud.addKillFeedEntry(t('hud.you'), this.localPlayer.team, bot.name, bot.team);
                }
                break;
              }
            }
          }
        }
      }

      if (input.subWeapon) {
        const subConfig = SUB_WEAPON_CONFIGS[wConfig.sub];
        if (this.localPlayer.ink >= subConfig.inkCost) {
          this.soundManager.playSubThrow();
          this.localPlayer.triggerShootRecoil();
        }
      }

      if (input.special) {
        if (this.localPlayer.specialMeter >= 100) {
          this.soundManager.playSpecialActivate();
        }
      }

      // Debug hook shots bypass client-side gating but NOT server validation.
      if (this.debugFireUntil > 0 && performance.now() < this.debugFireUntil) {
        input.fire = true;
        input.pitch = -0.9; // debug aim ~52° downward so shots reach the ground
      } else {
        this.debugFireUntil = 0;
      }

      // Send input to server at controlled rate
      this.networkClient.queueInput(input);

      // Client-side prediction
      const groundInk = this.paintEngine.getInkAt(
        this.localPlayer.position.x,
        this.localPlayer.position.z
      );

      this.localPlayer.predictMovement(input, dt, groundInk);
      this.localPlayer.updateVisuals(now / 1000);

      // Submerge / Surface / Swim / Burn Audio Triggers
      if (this.localPlayer.mode !== this.lastLocalMode) {
        if (this.localPlayer.mode === PlayerMode.SUBMERGED) {
          this.soundManager.playSubmerge();
        } else if (this.lastLocalMode === PlayerMode.SUBMERGED) {
          this.soundManager.playSurface();
        }
        this.lastLocalMode = this.localPlayer.mode;
      }
      if (this.localPlayer.mode === PlayerMode.SUBMERGED && (input.moveX !== 0 || input.moveZ !== 0)) {
        this.soundManager.playSwim();
      }
      const isEnemyInk = this.localPlayer.team === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;
      if (isEnemyInk && this.localPlayer.alive) {
        this.soundManager.playBurn();
      }

      // Camera Follows Local Player
      this.cameraController.update(
        this.localPlayer.position,
        this.localPlayer.yaw,
        this.localPlayer.pitch,
        dt,
        this.localPlayer.mode === PlayerMode.SUBMERGED
      );

      // HUD Update
      this.hud.updatePlayerStatus(
        this.localPlayer.hp,
        this.localPlayer.ink,
        this.localPlayer.mode,
        this.localPlayer.team
      );
      this.hud.updateLoadoutAndSkills(
        this.localPlayer.weaponType || 'shooter',
        this.localPlayer.specialMeter || 0,
        this.localPlayer.ink,
        this.inputManager.chargeLevel
      );

      // Death Countdown Update
      if (!this.localPlayer.alive && this.respawnEndsAt > 0) {
        const remaining = Math.max(0, (this.respawnEndsAt - Date.now()) / 1000);
        this.hud.showDeathOverlay(remaining);
      } else {
        this.hud.hideDeathOverlay();
      }

      // Debug overlay update throttled to ~10Hz (Subagent 54)
      if (now - this.lastDebugUpdateTime >= 100) {
        this.lastDebugUpdateTime = now;
        this.hud.updateDebug(
          this.clock.getFPS(),
          this.networkClient.currentPing,
          this.localPlayer.id,
          this.localPlayer.team,
          this.localPlayer.position.x,
          this.localPlayer.position.y,
          this.localPlayer.position.z,
          groundInk,
          this.localPlayer.hp,
          this.localPlayer.ink,
          this.localPlayer.mode,
          this.totalPaintEventsReceived
        );
      }
    }

    // 2. Remote Players Interpolation
    for (const [id, remote] of this.remotePlayers) {
      const state = this.snapshotBuffer.getInterpolatedState(id, serverTime, this.remoteState);
      if (state) {
        remote.update(state, now / 1000);
      }
    }

    // 3. Visual Weapons & Particles Update
    this.weaponVisual.update(dt);
    this.particleSystem.update(dt);

    // 4. Match Timers, Score & BGM Dynamic Speed-up
    let remainingMatchSec = 0;
    if (this.matchPhase === MatchPhase.PLAYING) {
      remainingMatchSec = Math.max(0, (this.matchEndAt - serverTime) / 1000);
      if (remainingMatchSec <= 60 && remainingMatchSec > 0) {
        this.soundManager.setSpeedUp(true);
      } else {
        this.soundManager.setSpeedUp(false);
      }
    } else if (this.matchPhase === MatchPhase.COUNTDOWN) {
      remainingMatchSec = Math.max(0, (this.matchStartAt - serverTime) / 1000);
    }

    this.hud.updateMatch(this.matchPhase, remainingMatchSec, this.pinkScore, this.cyanScore, this.matchMode);

    if (this.matchPhase === MatchPhase.GAME_OVER && this.gameOverEndsAt > 0) {
      const nextMatchSec = Math.max(0, (this.gameOverEndsAt - Date.now()) / 1000);
      this.gameOverScreen.updateCountdown(nextMatchSec);
    }

    // 5. Offline Practice Bots Update
    if (this.localPlayer) {
      this.botController.update(
        dt,
        now,
        {
          position: this.localPlayer.position,
          alive: this.localPlayer.alive,
          team: this.localPlayer.team,
          hp: this.localPlayer.hp
        },
        (bot, aimTarget) => {
          const muzzle = { x: bot.position.x, y: bot.position.y + 0.85, z: bot.position.z };
          this.weaponVisual.spawnTracer(muzzle, aimTarget, bot.team, bot.weaponType);
          this.particleSystem.spawnSplash(aimTarget, bot.team, 8, 6.0);
          const distToLocal = Math.hypot(aimTarget.x - this.localPlayer!.position.x, aimTarget.z - this.localPlayer!.position.z);
          if (distToLocal < 1.8 && bot.team !== this.localPlayer!.team && this.localPlayer!.alive) {
            this.localPlayer!.hp = Math.max(0, this.localPlayer!.hp - 20);
            this.cameraController.addShake(0.35, 0.2);
            this.hud.triggerDamageFlash();
            if (this.localPlayer!.hp <= 0) {
              this.localPlayer!.alive = false;
              this.localPlayer!.mode = PlayerMode.DEAD;
              this.localPlayer!.view.setMode(PlayerMode.DEAD);
              this.hud.showDeathOverlay(4.0);
              this.respawnEndsAt = Date.now() + 4000;
              this.soundManager.playSplat();
              this.hud.addKillFeedEntry(bot.name, bot.team, t('hud.you'), this.localPlayer!.team);
            }
          }
        },
        (bot, paintX, paintZ) => {
          const { u, v } = worldToUV(paintX, paintZ, this.activeMapDef.size);
          const paintEvt: PaintEvent = {
            id: Math.floor(Math.random() * 100000),
            team: bot.team,
            u,
            v,
            radius: PAINT_RADIUS_WORLD / this.activeMapDef.size,
            seed: (now ^ 0x9876) >>> 0
          };
          this.paintEngine.applyPaintBatch([paintEvt]);
        }
      );

      for (const bot of this.botController.getBots()) {
        const remote = this.botRemotePlayers.get(bot.id);
        if (remote) {
          remote.view.setMode(bot.mode);
          remote.view.setTransform(bot.position, bot.yaw, bot.pitch);
          remote.view.updateLocomotion(dt, bot.alive ? 5.0 : 0, true, bot.pitch);
          remote.view.updateVisuals(false, now / 1000, bot.ink);
        }
      }

      // 6. Tactical Minimap Radar & Top Team Squids Update
      // Both lists are reused buffers: `Minimap.update` and `HUD.updateTeamSquids`
      // read them synchronously and never keep a reference, so writing in place
      // removes two array allocations per frame.
      let blipCount = 0;
      for (const p of this.remotePlayers.values()) {
        this.writeBlip(blipCount++, p.position.x, p.position.y, p.position.z, p.yaw, p.team, p.alive);
      }
      for (const bot of this.botController.getBots()) {
        this.writeBlip(blipCount++, bot.position.x, bot.position.y, bot.position.z, bot.yaw, bot.team, bot.alive);
      }
      // Shrink the view without dropping the objects, so the next frame reuses them.
      if (this.minimapBlips.length > blipCount) this.minimapBlips.length = blipCount;

      const localBlip = this.minimapLocal;
      localBlip.position = this.localPlayer.position;
      localBlip.yaw = this.localPlayer.yaw;
      localBlip.team = this.localPlayer.team;
      localBlip.alive = this.localPlayer.alive;

      this.minimap.update(localBlip, this.minimapBlips, this.collisionWorld.getObstacles());

      let squidCount = 0;
      this.writeSquid(
        squidCount++,
        this.localPlayer.team,
        this.localPlayer.alive,
        this.localPlayer.specialMeter
      );
      for (const rp of this.remotePlayers.values()) {
        this.writeSquid(squidCount++, rp.team, rp.alive, rp.specialMeter);
      }
      for (const bot of this.botController.getBots()) {
        this.writeSquid(squidCount++, bot.team, bot.alive, bot.specialMeter);
      }
      if (this.squidIndicators.length > squidCount) this.squidIndicators.length = squidCount;
      this.hud.updateTeamSquids(this.squidIndicators);
    }

    // 7. Paint Texture Upload (ONLY IF DIRTY, AT MOST ONCE PER RENDER FRAME!)
    this.paintEngine.renderUpdate();

    // 8. Three.js Render
    this.renderer.render();
  };

  private handleWelcome(payload: WelcomePayload): void {
    // 1. Set obstacles + map. switchLocalMap applies the size-dependent state
    // first, so the collision world picks it up from the authoritative payload
    // when the server reports one.
    if (payload.obstacles && payload.obstacles.length > 0) {
      this.collisionWorld.setObstacles(payload.obstacles);
    }
    if (payload.mapId) {
      this.switchLocalMap(payload.mapId);
    }
    if (typeof payload.mapSize === 'number' && payload.obstacles?.length) {
      this.collisionWorld.setObstacles(payload.obstacles, payload.mapSize);
    }

    // 2. Replay all Paint History (Late Join)
    this.expectedTotalPaintEvents = payload.totalPaintEvents ?? (payload.paintHistory ? payload.paintHistory.length : 0);

    if (payload.paintHistory && payload.paintHistory.length > 0) {
      this.paintEngine.applyPaintBatch(payload.paintHistory);
      this.totalPaintEventsReceived += payload.paintHistory.length;
    }

    // 3. Create Local Player
    this.lobbyScreen.setMyPlayerId(payload.playerId);
    if (payload.lobby) {
      this.lobbyScreen.updateLobbyState(payload.lobby);
      for (const lp of payload.lobby.players) {
        this.playerMeta.set(lp.id, { name: lp.name, team: lp.team });
      }
    }

    const spawn = getSpawnPosition(payload.team, 0, this.activeMapDef.spawnX);
    this.localPlayer = new LocalPlayer(
      payload.playerId,
      payload.team,
      spawn,
      this.collisionWorld
    );
    // Restore the persisted weapon choice (fixes weapon reset on refresh)
    this.setLocalWeapon(this.lobbyScreen.selectedWeapon);
    this.localPlayer.view.applyCosmeticVariant(hashId(payload.playerId));
    this.renderer.scene.add(this.localPlayer.view.group);

    // 4. Instantiate existing Remote Players
    for (const p of payload.players) {
      if (p.id !== payload.playerId) {
        this.handlePlayerJoined(p);
      }
    }

    // 5. Set match state
    this.handleMatchState(payload.match);

    if (this.totalPaintEventsReceived >= this.expectedTotalPaintEvents) {
      this.hud.hideSyncBanner();
    } else {
      this.hud.showSyncBanner(
        t('hud.syncing', { n: this.totalPaintEventsReceived, m: this.expectedTotalPaintEvents })
      );
    }
  }

  /** Rebuilds arena visuals + collision + minimap for a (possibly new) map. */
  private switchLocalMap(mapId: MapId): void {
    const mapDef = getMapDef(mapId);
    // Size-dependent state is applied before the early return: the initial map
    // can already be the active one, and the paint/minimap extents still need it.
    this.paintEngine.setMapSize(mapDef.size);
    this.minimap.setSize(mapDef.size);
    if (mapDef.id === this.activeMapDef.id) return;
    this.activeMapDef = mapDef;
    this.arena.rebuild(mapDef);
    this.collisionWorld.setObstacles(mapDef.obstacles, mapDef.size);
    this.renderer.applyTheme(mapDef.theme);
  }

  private handlePaintHistoryChunk(events: PaintEvent[]): void {
    this.paintEngine.applyPaintBatch(events);
    this.totalPaintEventsReceived += events.length;

    if (this.totalPaintEventsReceived >= this.expectedTotalPaintEvents) {
      this.hud.hideSyncBanner();
    } else {
      this.hud.showSyncBanner(
        t('hud.syncing', { n: this.totalPaintEventsReceived, m: this.expectedTotalPaintEvents })
      );
    }
  }

  private handleSnapshot(payload: SnapshotPayload): void {
    this.snapshotBuffer.addSnapshot(payload.serverTime, payload.players);
    this.scoreboard.update(payload.players);

    // Reconcile Local Player with acknowledged sequence number
    if (this.localPlayer) {
      const mySnap = payload.players.find((p) => p.id === this.localPlayer?.id);
      if (mySnap) {
        if (mySnap.hp < this.localPlayer.hp && this.localPlayer.alive && !mySnap.invulnerable) {
          this.cameraController.addShake(0.35, 0.22);
          this.soundManager.playHit();
          this.hud.triggerDamageFlash();
        }
        const lastAckSeq = payload.lastProcessedInputSeq[this.localPlayer.id];
        this.localPlayer.applyServerState(mySnap, lastAckSeq);
      }
    }

    // Ensure all remote players in snapshot exist in scene & track metadata
    for (const snap of payload.players) {
      if (snap.name) {
        this.playerMeta.set(snap.id, { name: snap.name, team: snap.team });
      }
      if (snap.id === this.localPlayer?.id) continue;
      if (!this.remotePlayers.has(snap.id)) {
        this.handlePlayerJoined(snap);
      } else if (snap.name) {
        this.remotePlayers.get(snap.id)?.setName(snap.name);
      }
    }

    this.handleMatchState(payload.match);
  }

  private handlePaintBatch(events: PaintEvent[]): void {
    this.paintEngine.applyPaintBatch(events);
    this.totalPaintEventsReceived += events.length;
  }

  private handleShotEvent(shot: ShotEventPayload): void {
    // If local player already spawned predicted tracer, skip to avoid double rendering
    if (this.localPlayer && shot.shooterId === this.localPlayer.id) {
      return;
    }
    this.weaponVisual.spawnTracer(shot.origin, shot.target, shot.team, shot.weaponType, shot.chargeLevel);
    this.particleSystem.spawnSplash(shot.target, shot.team, 6, 6.0);

    // Distant firefights stay visible but quiet: only play weapon sounds for
    // nearby shots, at most one every 130ms, so 8-player chaos doesn't become
    // a wall of weapon SFX.
    const lp = this.localPlayer;
    if (lp) {
      const dx = shot.origin.x - lp.position.x;
      const dy = shot.origin.y - lp.position.y;
      const dz = shot.origin.z - lp.position.z;
      if (dx * dx + dy * dy + dz * dz > 30 * 30) return;
      const now = performance.now();
      if (now - this.lastRemoteShotSoundAt < 130) return;
      this.lastRemoteShotSoundAt = now;
    }

    if (shot.weaponType && isChargeWeapon(shot.weaponType)) {
      this.soundManager.playChargerShot(shot.chargeLevel || 1.0);
    } else if (shot.weaponType === 'roller') {
      this.soundManager.playRollerFlick();
    } else if (shot.weaponType === 'slosher' || shot.weaponType === 'cannon') {
      this.soundManager.playBucket();
    } else {
      this.soundManager.playShoot();
    }
  }

  private handleLobbyState(state: LobbyStatePayload): void {
    this.lobbyScreen.updateLobbyState(state);
    if (state.mapId) {
      this.switchLocalMap(state.mapId);
    }
    if (state.mode) {
      this.matchMode = state.mode;
    }
    for (const p of state.players) {
      this.playerMeta.set(p.id, { name: p.name, team: p.team });
      const remote = this.remotePlayers.get(p.id);
      if (remote) {
        remote.setName(p.name);
      }
    }
  }

  private handleSubWeaponEvent(payload: SubWeaponEventPayload): void {
    if (payload.action === 'spawn') {
      this.weaponVisual.spawnSubWeapon(payload);
      this.soundManager.playSubThrow();
    } else if (payload.action === 'explode') {
      this.weaponVisual.explodeSubWeapon(payload.id, payload.position, payload.radius || 4.0, payload.team);
      this.soundManager.playExplosion();
      this.particleSystem.spawnSplash(payload.position, payload.team, 16, 8.5);
      this.cameraController.addShake(0.45, 0.25);
    }
  }

  private handleSpecialEvent(payload: SpecialEventPayload): void {
    if (payload.action === 'activate') {
      this.weaponVisual.spawnSpecial(payload);
      this.soundManager.playSpecialActivate();
      this.particleSystem.spawnSplash(payload.position, payload.team, 20, 9.5);
      this.cameraController.addShake(0.6, 0.4);
    } else if (payload.action === 'end') {
      this.weaponVisual.endSpecial(payload.id);
    }
  }

  private handlePlayerJoined(snap: PlayerSnapshot): void {
    if (this.remotePlayers.has(snap.id)) return;

    const remote = new RemotePlayer(snap.id, snap.team, snap.weaponType || 'shooter');
    if (snap.name) {
      remote.setName(snap.name);
      this.playerMeta.set(snap.id, { name: snap.name, team: snap.team });
    }
    remote.view.applyCosmeticVariant(hashId(snap.id));
    this.remotePlayers.set(snap.id, remote);
    this.renderer.scene.add(remote.view.group);
  }

  private handlePlayerLeft(playerId: string): void {
    const remote = this.remotePlayers.get(playerId);
    if (remote) {
      this.renderer.scene.remove(remote.view.group);
      remote.dispose();
      this.remotePlayers.delete(playerId);
    }
  }

  private handlePlayerDied(data: { victimId: string; killerId?: string; respawnAt: number }): void {
    const isLocalVictim = Boolean(this.localPlayer && data.victimId === this.localPlayer.id);
    const isLocalKiller = Boolean(this.localPlayer && data.killerId === this.localPlayer.id);

    const victimPos = isLocalVictim
      ? this.localPlayer?.position
      : this.remotePlayers.get(data.victimId)?.position;

    if (isLocalVictim && this.localPlayer) {
      this.localPlayer.alive = false;
      this.localPlayer.mode = PlayerMode.DEAD;
      this.localPlayer.view.setMode(PlayerMode.DEAD);
      this.respawnEndsAt = data.respawnAt;
      this.soundManager.playSplat();
      this.cameraController.addShake(0.8, 0.45);
    }

    if (isLocalKiller) {
      this.crosshair.showHitMarker();
      this.soundManager.playHit();
      this.soundManager.playKillChime();
      this.cameraController.addShake(0.3, 0.2);
    }

    // Kill Feed Notification (Subagent 78)
    const victimMeta = this.playerMeta.get(data.victimId);
    const victimName =
      victimMeta?.name ||
      (isLocalVictim ? t('hud.you') : t('hud.playerHash', { id: data.victimId.slice(0, 4) }));
    const victimTeam = victimMeta?.team || (isLocalVictim && this.localPlayer ? this.localPlayer.team : Team.PINK);

    let killerName = t('hud.turfHazard');
    let killerTeam = victimTeam === Team.PINK ? Team.CYAN : Team.PINK;

    if (data.killerId) {
      const killerMeta = this.playerMeta.get(data.killerId);
      killerName =
        killerMeta?.name ||
        (isLocalKiller ? t('hud.you') : t('hud.playerHash', { id: data.killerId.slice(0, 4) }));
      killerTeam = killerMeta?.team || (isLocalKiller && this.localPlayer ? this.localPlayer.team : killerTeam);
    }

    if (victimPos) {
      this.particleSystem.spawnSplash(victimPos, killerTeam, 24, 11.0);
    }

    this.hud.addKillFeedEntry(killerName, killerTeam, victimName, victimTeam, '💥');
  }

  private handlePlayerRespawned(snap: PlayerSnapshot): void {
    if (this.localPlayer && snap.id === this.localPlayer.id) {
      this.localPlayer.applyServerState(snap);
      this.respawnEndsAt = 0;
      this.hud.hideDeathOverlay();
      this.soundManager.playRespawn();
    }
  }

  private handleMatchState(state: MatchStateSnapshot): void {
    const prevPhase = this.matchPhase;
    this.matchPhase = state.phase;
    this.matchMode = state.mode;
    this.matchStartAt = state.matchStartAt;
    this.matchEndAt = state.matchEndAt;
    this.pinkScore = state.pinkScore;
    this.cyanScore = state.cyanScore;

    // The objective volume only exists in zone-scoring modes, and it is tinted
    // by whoever currently holds the zone so the contest is readable at a
    // glance without opening the scoreboard.
    const isZoneMode = this.matchMode === 'splat_zones';
    this.arena.setZoneVisible(isZoneMode && state.phase !== MatchPhase.WAITING);
    if (isZoneMode) {
      const owner =
        state.pinkScore > state.cyanScore
          ? Team.PINK
          : state.cyanScore > state.pinkScore
            ? Team.CYAN
            : null;
      this.arena.setZoneOwner(owner);
    }

    if (prevPhase !== state.phase) {
      if (state.phase === MatchPhase.COUNTDOWN) {
        this.soundManager.playCountdown(false);
      } else if (state.phase === MatchPhase.PLAYING) {
        this.soundManager.playCountdown(true);
        this.soundManager.startBGM();
      } else if (state.phase === MatchPhase.GAME_OVER) {
        this.soundManager.stopBGM();
      }
    }

    // Screen routing lives in ScreenManager so the "which overlay is visible"
    // rule is one testable decision table instead of scattered ifs.
    const route = screenRouteForPhase(state.phase, prevPhase, {
      menuVisible: this.lobbyScreen.isVisible() || this.titleScreen.isVisible()
    });
    if (route.kind === 'hideAll') {
      if (route.requestPointerLock) this.inputManager.requestPointerLock();
      this.screens.hideAll();
    } else if (route.kind === 'show') {
      this.screens.show(route.id);
    } else if (route.kind === 'hide') {
      this.screens.hide(route.id);
    }

    // If restarted
    if (prevPhase === MatchPhase.GAME_OVER && state.phase === MatchPhase.COUNTDOWN) {
      this.gameOverScreen.hide();
      this.paintEngine.reset();
      this.snapshotBuffer.clear();
      this.totalPaintEventsReceived = 0;
      this.respawnEndsAt = 0;
      this.hud.hideDeathOverlay();
    }
  }

  private handleLockChange(locked: boolean): void {
    const prompt = document.getElementById('pointer-lock-prompt');
    if (!prompt) return;
    if (locked) {
      prompt.classList.add('hidden');
    } else {
      if (!this.lobbyScreen.isVisible() && this.matchPhase === MatchPhase.PLAYING) {
        prompt.classList.remove('hidden');
      }
    }
  }

  private handleGameOver(payload: GameOverPayload): void {
    this.gameOverEndsAt = Date.now() + payload.restartCountdown * 1000;
    this.gameOverScreen.show(payload);
    this.soundManager.playGameOver();
  }

  private handleDisconnect(): void {
    if (this.localPlayer) {
      // Server-initiated disconnects (e.g. AFK kick) do not auto-retry in
      // socket.io; a full reload re-joins cleanly with fresh paint history.
      this.hud.showSyncBanner(t('hud.lost'));
      this.scheduleReconnectReload();
    } else {
      this.hud.showSyncBanner(t('hud.lost'));
    }
  }

  private handleConnectError(err: Error): void {
    this.hud.showSyncBanner(t('hud.errPrefix', { msg: err.message }));
  }

  private reconnectReloadTimer?: number;

  private scheduleReconnectReload(): void {
    if (this.reconnectReloadTimer !== undefined) return;
    this.reconnectReloadTimer = window.setTimeout(() => {
      window.location.reload();
    }, 3000);
  }

  private spawnPracticeBot(): void {
    const playerTeam = this.localPlayer?.team || Team.PINK;
    const botTeam = playerTeam === Team.PINK ? Team.CYAN : Team.PINK;
    const weapons: WeaponType[] = ['shooter', 'roller', 'charger', 'slosher'];
    const botWeapon = weapons[Math.floor(Math.random() * weapons.length)] || 'shooter';

    const bot = this.botController.spawnBot(botTeam, botWeapon);
    const remoteBot = new RemotePlayer(bot.id, bot.team, bot.weaponType);
    remoteBot.setName(`🤖 ${bot.name}`);
    remoteBot.view.applyCosmeticVariant(hashId(bot.id));
    this.renderer.scene.add(remoteBot.view.group);
    this.botRemotePlayers.set(bot.id, remoteBot);

    this.hud.addKillFeedEntry(t('hud.system'), Team.NEUTRAL, t('hud.spawnedBot', { name: bot.name }), botTeam, '🤖');
  }

  private clearPracticeBots(): void {
    for (const remoteBot of this.botRemotePlayers.values()) {
      this.renderer.scene.remove(remoteBot.view.group);
      remoteBot.view.dispose();
    }
    this.botRemotePlayers.clear();
    this.botController.clearBots();
    this.hud.addKillFeedEntry(t('hud.system'), Team.NEUTRAL, t('hud.clearedBots'), Team.NEUTRAL, '🧹');
  }

  dispose(): void {
    this.isRunning = false;
    this.networkClient.dispose();
    this.inputManager.dispose();
    this.arena.dispose();
    this.paintEngine.dispose();
    this.weaponVisual.dispose();
    this.particleSystem.dispose();
    this.localPlayer?.dispose();
    for (const r of this.remotePlayers.values()) {
      r.dispose();
    }
    this.clearPracticeBots();
    this.renderer.dispose();
  }
}
