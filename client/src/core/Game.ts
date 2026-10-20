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
  Ray,
  SPECIAL_CONFIGS,
  SUB_WEAPON_CONFIGS,
  ShotEventPayload,
  SnapshotPayload,
  SpecialEventPayload,
  SubWeaponEventPayload,
  Team,
  Vec3,
  WEAPON_CONFIGS,
  WeaponType,
  WelcomePayload,
  getMapDef,
  getSpawnPosition,
  isChargeWeapon,
  worldToUV,
  WEAPON_SELECT_DURATION
} from '@ink/shared';
import type { GameMode, MapDef, MapId } from '@ink/shared';

import { VisualWeapon } from '../combat/Weapon.js';
import { ParticleSystem } from '../combat/ParticleSystem.js';
import { Crosshair } from '../combat/Crosshair.js';
import { pickThreatPoint, threatAngle, type EnemySample, type ThreatSample } from '../combat/ThreatAngle.js';
import { CameraController } from '../player/CameraController.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { RemotePlayer } from '../player/RemotePlayer.js';
import { NetworkClient } from '../network/NetworkClient.js';
import { SnapshotBuffer, createInterpolatedState } from '../network/SnapshotBuffer.js';
import { GameOverScreen } from '../ui/GameOverScreen.js';
import { WeaponSelectScreen } from '../ui/WeaponSelectScreen.js';
import { HUD } from '../ui/HUD.js';
import { Scoreboard } from '../ui/Scoreboard.js';
import { Minimap, MinimapPlayerData } from '../ui/Minimap.js';
import { SettingsModal } from '../ui/SettingsModal.js';
import { LobbyScreen } from '../ui/LobbyScreen.js';
import { lobbyAudio } from '../ui/LobbyAudio.js';
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
import { locName, t } from '../i18n.js';

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
  private weaponSelectScreen: WeaponSelectScreen | null = null;
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
  private weaponSelectEndsAt = 0;
  private lastLocalShotTime = 0;
  private lastDebugUpdateTime = 0;
  private lastRemoteShotSoundAt = 0;
  private wasChargeFull = false;
  private lastSpecialMeter = 0;
  private lastInkReloadSoundTime = 0;
  private weaponToastTimeout?: number;
  /** Most negative vertical speed while airborne, sampled before the landing step. */
  private airborneMinVy = 0;
  private lastDamageCueAt = 0;
  private readonly recentThreats: ThreatSample[] = [];
  /** Debug-fire window end timestamp (test hook only; the server still validates everything). */
  private debugFireUntil = 0;
  /** Free-camera override used by screenshot automation (null = normal camera). */
  private debugCam: { px: number; py: number; pz: number; lx: number; ly: number; lz: number } | null = null;

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
  /** Reusable raycast and aiming scratch objects to prevent allocations in render loop. */
  private readonly scratchCamRay: Ray = {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 }
  };
  private readonly scratchMuzzleRay: Ray = {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 }
  };
  private readonly scratchMuzzle: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratchMuzzleDir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratchAimPoint: Vec3 = { x: 0, y: 0, z: 0 };
  /** Frame-time sampling for the debug hook (rolling window). */
  private frameTimeHistory: number[] = [];
  private frameTimeMax = 0;
  private lastFrameAt = 0;
  private lastCountdownSecond = -1;

  constructor() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas element #webgl-canvas not found');
    }

    this.renderer = new GameRenderer(canvas);
    this.collisionWorld.setObstacles(this.activeMapDef.obstacles, this.activeMapDef.size);
    this.collisionWorld.setRamps(this.activeMapDef.ramps);
    this.collisionWorld.setClimbableSurfaces(this.activeMapDef.climbableSurfaces);
    this.arena = new Arena(this.paintEngine, this.activeMapDef);
    this.renderer.scene.add(this.arena.group);
    this.renderer.scene.add(this.weaponVisual.group);
    this.renderer.scene.add(this.particleSystem.group);
    this.renderer.applyTheme(this.activeMapDef.theme);

    this.minimap = new Minimap(this.paintEngine);
    this.minimap.setClimbables(this.activeMapDef.climbableSurfaces);
    this.minimap.setZone(this.activeMapDef.zone);
    this.botController = new BotController(this.paintEngine, this.collisionWorld);

    this.cameraController = new CameraController(this.renderer.camera, this.collisionWorld);
    this.inputManager = new InputManager(
      canvas,
      () => this.hud.toggleDebugOverlay(),
      (locked) => this.handleLockChange(locked)
    );
    this.inputManager.setOnWeaponCycle((dir) => {
      const inGame = !this.lobbyScreen.isVisible() && !this.titleScreen.isVisible();
      if (inGame && this.inputManager.isLocked()) {
        this.cycleWeapon(dir);
      }
    });

    this.settingsModal = new SettingsModal({
      onSensitivityChange: (val) => {
        this.inputManager.setSensitivity(val * 0.0022);
      },
      onFovChange: (fov) => {
        this.renderer.camera.fov = fov;
        this.renderer.camera.updateProjectionMatrix();
        this.cameraController.setBaseFov(fov);
      },
      onMasterVolumeChange: (vol) => {
        this.soundManager.setMasterVolume(vol);
        lobbyAudio.setVolume(vol * this.settingsModal.config.sfxVolume);
      },
      onSfxVolumeChange: (vol) => {
        this.soundManager.setSfxVolume(vol);
        lobbyAudio.setVolume(this.settingsModal.config.masterVolume * vol);
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
    this.cameraController.setBaseFov(this.settingsModal.config.fov);
    this.soundManager.setMasterVolume(this.settingsModal.config.masterVolume);
    this.soundManager.setSfxVolume(this.settingsModal.config.sfxVolume);
    this.soundManager.setBgmVolume(this.settingsModal.config.bgmVolume);
    lobbyAudio.setVolume(this.settingsModal.config.masterVolume * this.settingsModal.config.sfxVolume);
    this.applyQuality(this.settingsModal.config.quality);

    this.titleScreen = new TitleScreen(
      {
        onPlay: () => {
          this.lobbyScreen.show();
        },
        onOpenSettings: () => this.settingsModal.show(),
        onOpenCodex: () => {
          this.lobbyScreen.show();
          this.lobbyScreen.showCodex();
        }
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
        onAddBot: (team?: Team) => this.networkClient.sendAddBot(team),
        onRemoveBot: () => this.networkClient.sendRemoveBot(),
        onReturnToTitle: () => {
          this.screens.show('title');
        },
        getPing: () => this.networkClient.currentPing
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
      onHitFeedback: (data?: { targetId?: string; isKill?: boolean }) => {
        const isKill = Boolean(data?.isKill);
        this.crosshair.showHitMarker(isKill);
        this.soundManager.playHit();
        if (data?.targetId) {
          const target = this.remotePlayers.get(data.targetId) ?? this.botRemotePlayers.get(data.targetId);
          if (target) {
            this.particleSystem.spawnHitConfirm(target.position, isKill, target.team);
            target.view.triggerDamageFlash(this.localPlayer?.team);
          }
        }
        if (isKill) {
          this.soundManager.playKillChime();
          this.cameraController.addShake(0.35, 0.25);
        }
      },
      onShotEvent: (shot) => this.handleShotEvent(shot),
      onLobbyState: (state) => this.handleLobbyState(state),
      onSubWeaponEvent: (evt) => this.handleSubWeaponEvent(evt),
      onSpecialEvent: (evt) => this.handleSpecialEvent(evt),
      onSurfacePaint: (updates) => this.paintEngine.applySurfacePaintUpdate(updates),
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

  private cycleWeapon(dir: number): void {
    if (!this.localPlayer) return;
    const weapons = Object.keys(WEAPON_CONFIGS) as WeaponType[];
    const curIdx = weapons.indexOf(this.localPlayer.weaponType);
    const nextIdx = (curIdx + dir + weapons.length) % weapons.length;
    const nextWeapon = weapons[nextIdx];
    if (nextWeapon) {
      this.setLocalWeapon(nextWeapon);
      this.lobbyScreen.selectedWeapon = nextWeapon;
      this.networkClient.sendLobbyUpdate({ weaponType: nextWeapon });
      this.hud.addKillFeedEntry('⚙', Team.NEUTRAL, `${nextWeapon.toUpperCase()}`, this.localPlayer.team, '🔁');
    }
  }

  private setLocalWeapon(weapon: WeaponType): void {
    if (!this.localPlayer) return;
    const changed = this.localPlayer.weaponType !== weapon;
    this.localPlayer.weaponType = weapon;
    this.localPlayer.view.setWeaponType(weapon);
    this.crosshair.setWeapon(weapon);
    this.inputManager.setActiveWeapon(weapon);
    if (changed) {
      this.inputManager.resetCharge();
      this.wasChargeFull = false;
      this.cameraController.setFovOffset(0);
      this.crosshair.updateCharge(0, false);
      this.crosshair.setAds(false);
      this.soundManager.playWeaponSwitch();
      this.showWeaponToast(weapon);
    }
  }

  private showWeaponToast(weapon: WeaponType): void {
    const config = WEAPON_CONFIGS[weapon];
    if (!config) return;
    let toast = document.getElementById('weapon-switch-banner');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'weapon-switch-banner';
      document.body.appendChild(toast);
    }
    const subCfg = SUB_WEAPON_CONFIGS[config.sub];
    const specCfg = SPECIAL_CONFIGS[config.special];
    toast.replaceChildren();
    const weaponLabel = document.createElement('span');
    weaponLabel.className = 'toast-weapon';
    weaponLabel.textContent = locName(config);
    const subLabel = document.createElement('span');
    subLabel.className = 'toast-sub';
    subLabel.textContent = `${t('hud.toastSub')} ${subCfg ? locName(subCfg) : config.sub}`;
    const specialLabel = document.createElement('span');
    specialLabel.className = 'toast-special';
    specialLabel.textContent = `${t('hud.toastSpecial')} ${specCfg ? locName(specCfg) : config.special}`;
    toast.append(weaponLabel, subLabel, specialLabel);
    toast.classList.add('visible');
    if (this.weaponToastTimeout) window.clearTimeout(this.weaponToastTimeout);
    this.weaponToastTimeout = window.setTimeout(() => {
      toast?.classList.remove('visible');
    }, 1400);
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
    alive: boolean,
    isSubmerged = false
  ): void {
    const blip = this.minimapBlips[index];
    if (blip) {
      blip.position.x = x;
      blip.position.y = y;
      blip.position.z = z;
      blip.yaw = yaw;
      blip.team = team;
      blip.alive = alive;
      blip.isSubmerged = isSubmerged;
      return;
    }
    this.minimapBlips[index] = { position: { x, y, z }, yaw, team, alive, isSubmerged };
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
      /** Free-camera override for screenshot automation. */
      setDebugCamera: (c: { px: number; py: number; pz: number; lx: number; ly: number; lz: number } | null) => {
        this.debugCam = c;
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

      const inLobby = this.lobbyScreen.isVisible();
      const weaponType = this.localPlayer.weaponType || 'shooter';
      const isAds = !inLobby && this.matchPhase === MatchPhase.PLAYING && this.inputManager.isAimingDownSights(weaponType);

      if (isCharger) {
        if (this.inputManager.chargeLevel > 0.03) {
          this.soundManager.playChargeHum(this.inputManager.chargeLevel);
          this.cameraController.setFovOffset(-6 * this.inputManager.chargeLevel);
          const isFull = this.inputManager.chargeLevel >= 0.98;
          if (isFull && !this.wasChargeFull) {
            this.soundManager.playChargeFull();
            this.wasChargeFull = true;
          }
          this.crosshair.updateCharge(this.inputManager.chargeLevel, isFull);
        } else {
          this.wasChargeFull = false;
          this.cameraController.setFovOffset(0);
          this.crosshair.updateCharge(0, false);
        }
      } else if (isAds) {
        this.wasChargeFull = false;
        this.cameraController.setFovOffset(-14);
        this.crosshair.setAds(true);
        this.crosshair.updateCharge(0, false);
      } else {
        this.wasChargeFull = false;
        this.cameraController.setFovOffset(0);
        this.crosshair.updateCharge(0, false);
        this.crosshair.setAds(false);
      }

      this.inputSeq++;
      const input = this.inputManager.getCurrentInput(this.inputSeq);
      input.weaponType = this.localPlayer.weaponType || 'shooter';

      const isMoving = (input.moveX !== 0 || input.moveZ !== 0) && this.localPlayer.grounded;
      const isMidair = !this.localPlayer.grounded;
      this.crosshair.setMoving(isMoving);
      this.crosshair.setMidair(isMidair);
      const wConfig = WEAPON_CONFIGS[weaponType] || WEAPON_CONFIGS.shooter;
      const isRolling = weaponType === 'roller' && (input.moveX !== 0 || input.moveZ !== 0) && this.localPlayer.grounded;
      const fireIntervalMs = isRolling ? 80 : (1 / wConfig.fireRate) * 1000;
      const shotCost = isRolling ? 0.8 : wConfig.inkCost;

      // Only allow firing if playing and alive and pointer is locked
      const canShoot =
        !inLobby &&
        this.matchPhase === MatchPhase.PLAYING &&
        this.localPlayer.alive &&
        this.inputManager.isLocked() &&
        this.localPlayer.mode === PlayerMode.HUMANOID &&
        this.localPlayer.ink >= shotCost;

      if (!canShoot) {
        if (input.fire && this.inputManager.isLocked() && this.localPlayer.ink < shotCost) {
          this.soundManager.playDryFire();
          this.soundManager.playLowInkAlert();
          this.crosshair.setLowInk(true);
        }
        input.fire = false;
      } else {
        this.crosshair.setLowInk(false);
      }
      if (inLobby) {
        input.subWeapon = false;
        input.special = false;
      }

      if (input.fire) {
        if (now - this.lastLocalShotTime >= fireIntervalMs) {
          this.lastLocalShotTime = now;
          this.crosshair.onFire(weaponType);

          if (isCharger) {
            const charge = input.chargeLevel || 1.0;
            this.soundManager.playChargerShot(charge);
            this.cameraController.addShake(0.18 + charge * 0.14, 0.16);
            this.cameraController.addRecoil(0.022 + charge * 0.028);
            this.localPlayer.triggerShootRecoil('charger', 0.18 + charge * 0.18);
          } else if (weaponType === 'roller') {
            if (isRolling) {
              this.soundManager.playRollerRoll();
              this.cameraController.addShake(0.04, 0.08);
              this.cameraController.addRecoil(0.003);
              this.localPlayer.triggerShootRecoil('roller', 0.06);
            } else {
              this.soundManager.playRollerFlick();
              this.cameraController.addShake(0.16, 0.14);
              this.cameraController.addRecoil(0.032);
              this.localPlayer.triggerShootRecoil('roller', 0.28);
            }
          } else if (weaponType === 'cannon') {
            this.soundManager.playCannonShot();
            this.cameraController.addShake(0.32, 0.24);
            this.cameraController.addRecoil(0.058);
            this.localPlayer.triggerShootRecoil('cannon', 0.42);
          } else if (weaponType === 'scatter') {
            this.soundManager.playScatterShot();
            this.cameraController.addShake(0.24, 0.18);
            this.cameraController.addRecoil(0.048);
            this.localPlayer.triggerShootRecoil('scatter', 0.36);
          } else if (weaponType === 'marksman') {
            this.soundManager.playMarksmanShot();
            this.cameraController.addShake(0.14, 0.1);
            this.cameraController.addRecoil(0.028);
            this.localPlayer.triggerShootRecoil('marksman', 0.22);
          } else if (weaponType === 'sprayer') {
            this.soundManager.playSprayerShot();
            this.cameraController.addShake(0.035, 0.05);
            this.cameraController.addRecoil(0.008);
            this.localPlayer.triggerShootRecoil('sprayer', 0.09);
          } else if (weaponType === 'slosher') {
            this.soundManager.playBucket();
            this.cameraController.addShake(0.12, 0.12);
            this.cameraController.addRecoil(0.025);
            this.localPlayer.triggerShootRecoil('slosher', 0.24);
          } else {
            this.soundManager.playShoot();
            this.cameraController.addShake(0.08, 0.08);
            this.cameraController.addRecoil(0.016);
            this.localPlayer.triggerShootRecoil('shooter', 0.16);
          }

          this.localPlayer.ink = Math.max(0, this.localPlayer.ink - shotCost);

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
          const crosshairLen = Math.sqrt(toCrosshairX * toCrosshairX + toCrosshairY * toCrosshairY + toCrosshairZ * toCrosshairZ) || 1;
          this.scratchCamRay.origin.x = camX;
          this.scratchCamRay.origin.y = camY;
          this.scratchCamRay.origin.z = camZ;
          this.scratchCamRay.direction.x = toCrosshairX / crosshairLen;
          this.scratchCamRay.direction.y = toCrosshairY / crosshairLen;
          this.scratchCamRay.direction.z = toCrosshairZ / crosshairLen;

          // Stage 1: Camera Raycast to get exact 3D aim point
          const cameraHit = this.collisionWorld.castRay(
            this.scratchCamRay,
            35 + baseCamDist
          );
          if (cameraHit.hit) {
            this.scratchAimPoint.x = cameraHit.point.x;
            this.scratchAimPoint.y = cameraHit.point.y;
            this.scratchAimPoint.z = cameraHit.point.z;
          } else {
            this.scratchAimPoint.x = camX + this.scratchCamRay.direction.x * 35;
            this.scratchAimPoint.y = camY + this.scratchCamRay.direction.y * 35;
            this.scratchAimPoint.z = camZ + this.scratchCamRay.direction.z * 35;
          }
          const aimPoint = this.scratchAimPoint;

          // Stage 2: Muzzle Raycast towards aimPoint
          this.scratchMuzzle.x = this.localPlayer.position.x + rgtX * 0.35 + fwdX * 0.4;
          this.scratchMuzzle.y = this.localPlayer.position.y + 0.85 + fwdY * 0.4;
          this.scratchMuzzle.z = this.localPlayer.position.z + rgtZ * 0.35 + fwdZ * 0.4;
          const muzzle = this.scratchMuzzle;

          let dirX = aimPoint.x - muzzle.x;
          let dirY = aimPoint.y - muzzle.y;
          let dirZ = aimPoint.z - muzzle.z;
          const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
          this.scratchMuzzleDir.x = dirX / dirLen;
          this.scratchMuzzleDir.y = dirY / dirLen;
          this.scratchMuzzleDir.z = dirZ / dirLen;
          const muzzleDir = this.scratchMuzzleDir;

          this.scratchMuzzleRay.origin.x = muzzle.x;
          this.scratchMuzzleRay.origin.y = muzzle.y;
          this.scratchMuzzleRay.origin.z = muzzle.z;
          this.scratchMuzzleRay.direction.x = muzzleDir.x;
          this.scratchMuzzleRay.direction.y = muzzleDir.y;
          this.scratchMuzzleRay.direction.z = muzzleDir.z;

          const muzzleHit = this.collisionWorld.castRay(
            this.scratchMuzzleRay,
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
                let damage = wConfig.damage ?? 35;
                if (weaponType === 'charger') {
                  const charge = input.chargeLevel || 1.0;
                  damage = Math.round((wConfig.damage ?? 120) * charge);
                } else if (weaponType === 'roller') {
                  damage = isRolling ? 120 : (wConfig.damage ?? 100);
                } else if (weaponType === 'cannon') {
                  damage = 85;
                } else if (weaponType === 'scatter') {
                  damage = Math.min(100, (wConfig.damage ?? 22) * 4);
                }
                bot.hp -= damage;
                const isKill = bot.hp <= 0;
                this.crosshair.showHitMarker(isKill);
                this.soundManager.playHit();
                this.particleSystem.spawnHitConfirm(bot.position, isKill, bot.team);
                this.particleSystem.spawnSplash(bot.position, this.localPlayer.team, 10, 7.0);
                this.botRemotePlayers.get(bot.id)?.view.triggerDamageFlash(this.localPlayer.team);
                if (isKill) {
                  bot.alive = false;
                  bot.mode = PlayerMode.DEAD;
                  bot.deaths++;
                  bot.respawnAt = now + 4000;
                  this.localPlayer.kills++;
                  this.soundManager.playKillChime();
                  this.cameraController.addShake(0.35, 0.25);
                  this.particleSystem.spawnSplash(bot.position, this.localPlayer.team, 24, 11.0);
                  this.hud.addKillFeedEntry(t('hud.you'), this.localPlayer.team, bot.name, bot.team);
                  this.hud.showSplatCallout();
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
          this.localPlayer.triggerShootRecoil('shooter', 0.22);
          this.cameraController.addRecoil(0.018);
        } else {
          this.soundManager.playDryFire();
          this.soundManager.playLowInkAlert();
          this.crosshair.setLowInk(true);
        }
      }

      if (input.special) {
        if (this.localPlayer.specialMeter >= 100) {
          this.soundManager.playSpecialActivate();
          this.cameraController.addShake(0.3, 0.25);
          this.localPlayer.triggerShootRecoil('cannon', 0.35);
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

      const wasGrounded = this.localPlayer.grounded;
      if (!wasGrounded) {
        this.airborneMinVy = Math.min(this.airborneMinVy, this.localPlayer.velocity.y);
      }
      this.localPlayer.predictMovement(input, dt, groundInk);
      if (!wasGrounded && this.localPlayer.grounded) {
        const impact = Math.min(1, Math.max(0, (-this.airborneMinVy - 5.2) / 9));
        if (impact > 0.08 && this.localPlayer.mode !== PlayerMode.SUBMERGED) {
          this.cameraController.addLanding(impact);
          this.soundManager.playLand(impact);
        }
        this.airborneMinVy = 0;
      } else if (this.localPlayer.grounded) {
        this.airborneMinVy = 0;
      }
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
      if (this.localPlayer.isClimbingWall) {
        this.soundManager.playWallClimb();
      } else if (this.localPlayer.mode === PlayerMode.SUBMERGED && (input.moveX !== 0 || input.moveZ !== 0)) {
        this.soundManager.playSwim();
        this.particleSystem.spawnSwimWake(
          this.localPlayer.position,
          this.localPlayer.team,
          this.localPlayer.velocity
        );
      }
      // Submerged ink refill sound
      if (this.localPlayer.mode === PlayerMode.SUBMERGED && this.localPlayer.alive && this.localPlayer.ink < 99) {
        if (now - this.lastInkReloadSoundTime > 320) {
          this.soundManager.playInkReload();
          this.lastInkReloadSoundTime = now;
        }
      }
      const isEnemyInk = this.localPlayer.team === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;
      if (isEnemyInk && this.localPlayer.alive) {
        this.soundManager.playBurn();
      }

      // Special Ready Audio Cue
      const currentSpecial = this.localPlayer.specialMeter || 0;
      if (currentSpecial >= 100 && this.lastSpecialMeter < 100) {
        this.soundManager.playSpecialReady();
      }
      this.lastSpecialMeter = currentSpecial;

      // Camera Follows Local Player
      const moveSpeed = Math.hypot(this.localPlayer.velocity.x, this.localPlayer.velocity.z);
      const bobbing =
        this.localPlayer.grounded || this.localPlayer.mode === PlayerMode.SUBMERGED;
      this.cameraController.update(
        this.localPlayer.position,
        this.localPlayer.yaw,
        this.localPlayer.pitch,
        dt,
        this.localPlayer.mode === PlayerMode.SUBMERGED,
        bobbing ? moveSpeed : 0
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
      if (remainingMatchSec <= 5.0 && remainingMatchSec > 0) {
        const secInt = Math.ceil(remainingMatchSec);
        if (secInt !== this.lastCountdownSecond) {
          this.lastCountdownSecond = secInt;
          this.soundManager.playCountdown(false);
        }
      }
    } else if (this.matchPhase === MatchPhase.COUNTDOWN) {
      remainingMatchSec = Math.max(0, (this.matchStartAt - serverTime) / 1000);
      const secInt = Math.ceil(remainingMatchSec);
      if (secInt !== this.lastCountdownSecond && secInt > 0) {
        this.lastCountdownSecond = secInt;
        this.soundManager.playCountdown(false);
      }
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
          if (bot.weaponType === 'charger') {
            this.soundManager.playChargerShot(1.0);
          } else if (bot.weaponType === 'roller') {
            this.soundManager.playRollerFlick();
          } else if (bot.weaponType === 'cannon') {
            this.soundManager.playCannonShot();
          } else if (bot.weaponType === 'slosher') {
            this.soundManager.playBucket();
          } else if (bot.weaponType === 'scatter') {
            this.soundManager.playScatterShot();
          } else if (bot.weaponType === 'marksman') {
            this.soundManager.playMarksmanShot();
          } else if (bot.weaponType === 'sprayer') {
            this.soundManager.playSprayerShot();
          } else {
            this.soundManager.playShoot();
          }
          const distToLocal = Math.hypot(aimTarget.x - this.localPlayer!.position.x, aimTarget.z - this.localPlayer!.position.z);
          if (distToLocal < 1.8 && bot.team !== this.localPlayer!.team && this.localPlayer!.alive) {
            this.noteThreat(bot.position.x, bot.position.z, bot.team);
            const nextHp = Math.max(0, this.localPlayer!.hp - 20);
            this.onLocalDamaged(nextHp, { x: bot.position.x, z: bot.position.z });
            this.localPlayer!.hp = nextHp;
            if (this.localPlayer!.hp <= 0) {
              this.localPlayer!.alive = false;
              this.localPlayer!.mode = PlayerMode.DEAD;
              this.localPlayer!.view.setMode(PlayerMode.DEAD);
              this.hud.showDeathOverlay(4.0);
              this.respawnEndsAt = Date.now() + 4000;
              this.soundManager.playSplat();
              this.soundManager.playPlayerDefeat();
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
        if (bot.alive && bot.mode === PlayerMode.SUBMERGED) {
          this.particleSystem.spawnSwimWake(bot.position, bot.team, bot.velocity);
        }
      }

      // 6. Tactical Minimap Radar & Top Team Squids Update
      // Both lists are reused buffers: `Minimap.update` and `HUD.updateTeamSquids`
      // read them synchronously and never keep a reference, so writing in place
      // removes two array allocations per frame.
      let blipCount = 0;
      for (const p of this.remotePlayers.values()) {
        this.writeBlip(blipCount++, p.position.x, p.position.y, p.position.z, p.yaw, p.team, p.alive, p.isSquidForm);
      }
      for (const bot of this.botController.getBots()) {
        this.writeBlip(blipCount++, bot.position.x, bot.position.y, bot.position.z, bot.yaw, bot.team, bot.alive, bot.mode === PlayerMode.SUBMERGED);
      }
      // Shrink the view without dropping the objects, so the next frame reuses them.
      if (this.minimapBlips.length > blipCount) this.minimapBlips.length = blipCount;

      const localBlip = this.minimapLocal;
      localBlip.position = this.localPlayer.position;
      localBlip.yaw = this.localPlayer.yaw;
      localBlip.team = this.localPlayer.team;
      localBlip.alive = this.localPlayer.alive;
      localBlip.isSubmerged = this.localPlayer.mode === PlayerMode.SUBMERGED;

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
    this.paintEngine.renderUpdate(this.renderer.renderer);

    // 8. Three.js Render
    if (this.debugCam) {
      const cam = this.renderer.camera;
      cam.position.set(this.debugCam.px, this.debugCam.py, this.debugCam.pz);
      cam.lookAt(this.debugCam.lx, this.debugCam.ly, this.debugCam.lz);
    }
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

    if (payload.paintSurfaces && payload.paintSurfaces.length > 0) {
      const surfaceUpdates = payload.paintSurfaces
        .filter((s) => s.paint && (s.paint[0] > 0 || s.paint[1] > 0))
        .map((s) => ({ id: s.id, paint: s.paint }));
      if (surfaceUpdates.length > 0) {
        this.paintEngine.applySurfacePaintUpdate(surfaceUpdates);
      }
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
    this.minimap.setClimbables(mapDef.climbableSurfaces);
    this.minimap.setZone(mapDef.zone);
    // Ramps/climbables drive client-side prediction; the server applies the same
    // geometry, so they must be set for the initial map as well as on switches.
    this.collisionWorld.setRamps(mapDef.ramps);
    this.collisionWorld.setClimbableSurfaces(mapDef.climbableSurfaces);
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
          this.onLocalDamaged(mySnap.hp, undefined, payload.players);
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
    if (!this.localPlayer || shot.shooterId !== this.localPlayer.id) {
      this.noteThreat(shot.origin.x, shot.origin.z, shot.team);
    }

    const remote = this.remotePlayers.get(shot.shooterId);
    if (remote) {
      remote.view.triggerRecoil();
    }

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
    } else if (shot.weaponType === 'cannon') {
      this.soundManager.playCannonShot();
    } else if (shot.weaponType === 'slosher') {
      this.soundManager.playBucket();
    } else if (shot.weaponType === 'scatter') {
      this.soundManager.playScatterShot();
    } else if (shot.weaponType === 'marksman') {
      this.soundManager.playMarksmanShot();
    } else if (shot.weaponType === 'sprayer') {
      this.soundManager.playSprayerShot();
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
      this.noteThreat(payload.position.x, payload.position.z, payload.team);
    }
  }

  private handleSpecialEvent(payload: SpecialEventPayload): void {
    if (payload.action === 'activate') {
      this.weaponVisual.spawnSpecial(payload);
      this.soundManager.playSpecialActivate();
      this.particleSystem.spawnSplash(payload.position, payload.team, 20, 9.5);
      this.cameraController.addShake(0.6, 0.4);
      this.noteThreat(payload.position.x, payload.position.z, payload.team);
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
      this.soundManager.playPlayerDefeat();
      this.cameraController.addShake(0.8, 0.45);
    }

    if (isLocalKiller) {
      this.crosshair.showHitMarker(true);
      this.soundManager.playHit();
      this.soundManager.playKillChime();
      this.cameraController.addShake(0.3, 0.2);
      this.hud.showSplatCallout();
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
      this.minimap.setZoneOwner(owner);
    } else {
      this.minimap.setZoneOwner(null);
    }

    if (prevPhase !== state.phase) {
      this.lastCountdownSecond = -1;
      if (state.phase === MatchPhase.COUNTDOWN) {
        this.soundManager.playCountdown(false);
      } else if (state.phase === MatchPhase.PLAYING) {
        this.soundManager.playCountdown(true);
        this.soundManager.startBGM();
      } else if (state.phase === MatchPhase.GAME_OVER) {
        this.soundManager.stopBGM();
        this.soundManager.playCountdownBuzzer();
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

    // If restarted (GAME_OVER -> WEAPON_SELECT -> COUNTDOWN or GAME_OVER -> COUNTDOWN)
    if (prevPhase === MatchPhase.GAME_OVER && state.phase === MatchPhase.COUNTDOWN) {
      this.gameOverScreen.hide();
      if (this.weaponSelectScreen) {
        this.weaponSelectScreen.dispose();
        this.weaponSelectScreen = null;
      }
      this.paintEngine.reset();
      this.snapshotBuffer.clear();
      this.totalPaintEventsReceived = 0;
      this.respawnEndsAt = 0;
      this.hud.hideDeathOverlay();
    } else if (prevPhase !== MatchPhase.WEAPON_SELECT && state.phase === MatchPhase.WEAPON_SELECT) {
      // Entering weapon select for the first time this round
      if (!this.weaponSelectScreen) {
        this.weaponSelectScreen = new WeaponSelectScreen(
          {
            onWeaponConfirmed: (weapon) => this.confirmWeapon(weapon),
            onAutoConfirm: (weapon) => this.confirmWeapon(weapon),
            onReturnToLobby: () => this.returnToLobby()
          },
          this.localPlayer?.weaponType ?? 'shooter',
          WEAPON_SELECT_DURATION,
          this.screens
        );
      }
      this.weaponSelectScreen.show();
      this.weaponSelectEndsAt = Date.now() + WEAPON_SELECT_DURATION * 1000;
      this.hud.hideDeathOverlay();
    } else if (state.phase !== MatchPhase.WEAPON_SELECT && this.weaponSelectScreen) {
      // Left weapon select phase
      this.weaponSelectScreen.hide();
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

  /** Player confirmed a weapon selection — tell the server and wait for countdown. */
  private confirmWeapon(weapon: WeaponType): void {
    this.networkClient.sendLobbyUpdate({ weaponType: weapon });
    // The server will transition from WEAPON_SELECT -> COUNTDOWN automatically
    // after the duration; the client shows the lobby or the match screen when
    // the phase arrives.  No need to force the transition here.
    if (this.weaponSelectScreen) {
      this.weaponSelectScreen.hide();
    }
  }

  /** Player clicked "Back to Lobby" during weapon select — return to WAITING state. */
  private returnToLobby(): void {
    if (this.weaponSelectScreen) {
      this.weaponSelectScreen.dispose();
      this.weaponSelectScreen = null;
    }
    // Tell the server we're going back; server will route us to WAITING/lobby
    this.screens.show('lobby');
  }

  /** Remembers a recent enemy action so a later HP drop can point at its source. */
  private noteThreat(x: number, z: number, team: Team): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (this.localPlayer && team === this.localPlayer.team) return;
    const now = performance.now();
    const list = this.recentThreats;
    list.push({ x, z, team, at: now });
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const sample = list[i];
      if (sample && now - sample.at <= 800) list[write++] = sample;
    }
    list.length = write;
    if (list.length > 32) list.splice(0, list.length - 32);
  }

  private gatherEnemies(enemyTeam: Team, snaps?: PlayerSnapshot[]): EnemySample[] {
    const out: EnemySample[] = [];
    const selfId = this.localPlayer?.id;
    if (snaps) {
      for (const snap of snaps) {
        if (snap.id === selfId || snap.team !== enemyTeam) continue;
        out.push({ x: snap.x, z: snap.z, team: snap.team, alive: snap.alive });
      }
    } else {
      for (const remote of this.remotePlayers.values()) {
        if (remote.team !== enemyTeam) continue;
        out.push({
          x: remote.position.x,
          z: remote.position.z,
          team: remote.team,
          alive: remote.alive
        });
      }
    }
    for (const bot of this.botController.getBots()) {
      if (bot.team !== enemyTeam) continue;
      out.push({ x: bot.position.x, z: bot.position.z, team: bot.team, alive: bot.alive });
    }
    return out;
  }

  /**
   * Visual and audio response when the local player's HP falls.
   * Chip damage (enemy ink) is throttled so the wedge does not strobe every tick.
   * `nextHp` is the post-hit value; the player object still holds the previous HP.
   */
  private onLocalDamaged(nextHp: number, source?: { x: number; z: number }, snaps?: PlayerSnapshot[]): void {
    const player = this.localPlayer;
    if (!player) return;
    const drop = player.hp - nextHp;
    const now = performance.now();
    const chip = drop < 8;
    if (chip && now - this.lastDamageCueAt < 480) return;
    this.lastDamageCueAt = now;

    const lethal = nextHp <= 0;
    if (!lethal) this.soundManager.playHurt();
    this.cameraController.addShake(lethal ? 0.55 : 0.32, lethal ? 0.28 : 0.2);
    this.hud.triggerDamageFlash();
    const enemyTeam = player.team === Team.PINK ? Team.CYAN : Team.PINK;
    player.view.triggerDamageFlash(enemyTeam);

    const point =
      source ??
      pickThreatPoint(
        now,
        enemyTeam,
        player.position.x,
        player.position.z,
        this.recentThreats,
        this.gatherEnemies(enemyTeam, snaps)
      );
    if (point) {
      this.hud.showIncomingDamage(
        threatAngle(player.yaw, player.position.x, player.position.z, point.x, point.z)
      );
      return;
    }
    const ink = this.paintEngine.getInkAt(player.position.x, player.position.z);
    if (ink === enemyTeam) this.hud.showIncomingDamage('ink');
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
