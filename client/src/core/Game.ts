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
  getSpawnPosition,
  uvToWorld,
  worldToUV
} from '@ink/shared';

import { VisualWeapon } from '../combat/Weapon.js';
import { ParticleSystem } from '../combat/ParticleSystem.js';
import { Crosshair } from '../combat/Crosshair.js';
import { CameraController } from '../player/CameraController.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { RemotePlayer } from '../player/RemotePlayer.js';
import { NetworkClient } from '../network/NetworkClient.js';
import { SnapshotBuffer } from '../network/SnapshotBuffer.js';
import { GameOverScreen } from '../ui/GameOverScreen.js';
import { HUD } from '../ui/HUD.js';
import { Minimap, MinimapPlayerData } from '../ui/Minimap.js';
import { SettingsModal } from '../ui/SettingsModal.js';
import { LobbyScreen } from '../ui/LobbyScreen.js';
import { BotController, BotState } from '../bot/BotController.js';
import { Arena } from '../world/Arena.js';
import { ClientCollisionWorld } from '../world/CollisionWorld.js';
import { PaintEngine } from '../world/PaintEngine.js';
import { Clock } from './Clock.js';
import { InputManager } from './InputManager.js';
import { GameRenderer } from './Renderer.js';
import { SoundManager } from './SoundManager.js';

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
  private lobbyScreen: LobbyScreen;
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

  constructor() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas element #webgl-canvas not found');
    }

    this.renderer = new GameRenderer(canvas);
    this.arena = new Arena(this.paintEngine, this.collisionWorld.getObstacles());
    this.renderer.scene.add(this.arena.group);
    this.renderer.scene.add(this.weaponVisual.group);
    this.renderer.scene.add(this.particleSystem.group);

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

    this.lobbyScreen = new LobbyScreen({
      onLobbyUpdate: (data) => this.networkClient.sendLobbyUpdate(data),
      onLobbyStart: () => this.networkClient.sendLobbyStart(),
      onWeaponChanged: (weapon) => {
        if (this.localPlayer) {
          this.localPlayer.weaponType = weapon;
          this.localPlayer.view.setWeaponType(weapon);
        }
      },
      onRequestEnterArena: () => {
        this.inputManager.requestPointerLock();
      }
    });

    this.setupPointerLockPrompt();

    // Connect to Server
    const serverUrl = window.location.port === '5173' ? `${window.location.protocol}//${window.location.hostname}:3000` : window.location.origin;
    this.hud.showSyncBanner('Connecting to Ink Arena server...');

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
      if (!this.lobbyScreen.isVisible()) {
        this.inputManager.requestPointerLock();
        prompt?.classList.add('hidden');
      }
    };

    startBtn?.addEventListener('click', enterGame);
    prompt?.addEventListener('click', enterGame);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !this.inputManager.isLocked() && !this.lobbyScreen.isVisible()) {
        enterGame();
      }
    });
  }

  start(): void {
    this.isRunning = true;
    requestAnimationFrame(this.renderLoop);
  }

  private renderLoop = (): void => {
    if (!this.isRunning) return;

    requestAnimationFrame(this.renderLoop);

    const dt = this.clock.getDelta();
    const now = performance.now();
    const serverTime = this.networkClient.getServerTime();

    // 1. Local Player Processing
    if (this.localPlayer) {
      const isCharger = (this.localPlayer.weaponType || 'shooter') === 'charger';
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

          if (weaponType === 'charger') {
            this.soundManager.playChargerShot(input.chargeLevel || 1.0);
            this.cameraController.addShake(0.18, 0.15);
          } else if (weaponType === 'roller') {
            this.soundManager.playRollerFlick();
            this.cameraController.addShake(0.12, 0.12);
          } else if (weaponType === 'slosher') {
            this.soundManager.playSlosher();
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
                  this.hud.addKillFeedEntry('You', this.localPlayer.team, bot.name, bot.team);
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
      const state = this.snapshotBuffer.getInterpolatedState(id, serverTime);
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

    this.hud.updateMatch(this.matchPhase, remainingMatchSec, this.pinkScore, this.cyanScore);

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
              this.hud.addKillFeedEntry(bot.name, bot.team, 'You', this.localPlayer!.team);
            }
          }
        },
        (bot, paintX, paintZ) => {
          const { u, v } = worldToUV(paintX, paintZ);
          const paintEvt: PaintEvent = {
            id: Math.floor(Math.random() * 100000),
            team: bot.team,
            u,
            v,
            radius: PAINT_RADIUS_WORLD / 100,
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
      const allRemotePositions: MinimapPlayerData[] = Array.from(this.remotePlayers.values()).map((p) => ({
        position: { x: p.position.x, y: p.position.y, z: p.position.z },
        yaw: p.yaw,
        team: p.team,
        alive: p.alive
      }));
      for (const bot of this.botController.getBots()) {
        allRemotePositions.push({
          position: bot.position,
          yaw: bot.yaw,
          team: bot.team,
          alive: bot.alive
        });
      }

      this.minimap.update(
        {
          position: this.localPlayer.position,
          yaw: this.localPlayer.yaw,
          team: this.localPlayer.team,
          alive: this.localPlayer.alive
        },
        allRemotePositions,
        this.collisionWorld.getObstacles()
      );

      const squidsData = [
        {
          team: this.localPlayer.team,
          alive: this.localPlayer.alive,
          specialMeter: this.localPlayer.specialMeter
        }
      ];
      for (const rp of this.remotePlayers.values()) {
        squidsData.push({ team: rp.team, alive: rp.alive, specialMeter: rp.specialMeter });
      }
      for (const bot of this.botController.getBots()) {
        squidsData.push({ team: bot.team, alive: bot.alive, specialMeter: bot.specialMeter });
      }
      this.hud.updateTeamSquids(squidsData);
    }

    // 7. Paint Texture Upload (ONLY IF DIRTY, AT MOST ONCE PER RENDER FRAME!)
    this.paintEngine.renderUpdate();

    // 8. Three.js Render
    this.renderer.render();
  };

  private handleWelcome(payload: WelcomePayload): void {
    // 1. Set obstacles
    if (payload.obstacles && payload.obstacles.length > 0) {
      this.collisionWorld.setObstacles(payload.obstacles);
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

    const spawn = getSpawnPosition(payload.team, 0);
    this.localPlayer = new LocalPlayer(
      payload.playerId,
      payload.team,
      spawn,
      this.collisionWorld
    );
    this.localPlayer.weaponType = this.lobbyScreen.selectedWeapon;
    this.localPlayer.view.setWeaponType(this.lobbyScreen.selectedWeapon);
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
        `Synchronizing arena... (${this.totalPaintEventsReceived}/${this.expectedTotalPaintEvents})`
      );
    }
  }

  private handlePaintHistoryChunk(events: PaintEvent[]): void {
    this.paintEngine.applyPaintBatch(events);
    this.totalPaintEventsReceived += events.length;

    if (this.totalPaintEventsReceived >= this.expectedTotalPaintEvents) {
      this.hud.hideSyncBanner();
    } else {
      this.hud.showSyncBanner(
        `Synchronizing arena... (${this.totalPaintEventsReceived}/${this.expectedTotalPaintEvents})`
      );
    }
  }

  private handleSnapshot(payload: SnapshotPayload): void {
    this.snapshotBuffer.addSnapshot(payload.serverTime, payload.players);

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
    if (shot.weaponType === 'charger') {
      this.soundManager.playChargerShot(shot.chargeLevel || 1.0);
    } else if (shot.weaponType === 'roller') {
      this.soundManager.playRollerFlick();
    } else if (shot.weaponType === 'slosher') {
      this.soundManager.playSlosher();
    } else {
      this.soundManager.playShoot();
    }
  }

  private handleLobbyState(state: LobbyStatePayload): void {
    this.lobbyScreen.updateLobbyState(state);
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
    const victimName = victimMeta?.name || (isLocalVictim ? 'You' : `Player #${data.victimId.slice(0, 4)}`);
    const victimTeam = victimMeta?.team || (isLocalVictim && this.localPlayer ? this.localPlayer.team : Team.PINK);

    let killerName = 'Turf Hazard';
    let killerTeam = victimTeam === Team.PINK ? Team.CYAN : Team.PINK;

    if (data.killerId) {
      const killerMeta = this.playerMeta.get(data.killerId);
      killerName = killerMeta?.name || (isLocalKiller ? 'You' : `Player #${data.killerId.slice(0, 4)}`);
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
    this.matchStartAt = state.matchStartAt;
    this.matchEndAt = state.matchEndAt;
    this.pinkScore = state.pinkScore;
    this.cyanScore = state.cyanScore;

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

    // Auto-hide lobby and lock mouse when entering match
    if (state.phase === MatchPhase.COUNTDOWN || state.phase === MatchPhase.PLAYING) {
      if (this.lobbyScreen.isVisible()) {
        this.lobbyScreen.hide();
        this.inputManager.requestPointerLock();
      }
    }

    // Reopen lobby when match returns to waiting phase
    if (state.phase === MatchPhase.WAITING && !this.lobbyScreen.isVisible() && prevPhase === MatchPhase.GAME_OVER) {
      this.lobbyScreen.show();
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
    this.hud.showSyncBanner('Connection lost. Reconnecting...');
  }

  private handleConnectError(err: Error): void {
    this.hud.showSyncBanner(`Connect error: ${err.message}`);
  }

  private spawnPracticeBot(): void {
    const playerTeam = this.localPlayer?.team || Team.PINK;
    const botTeam = playerTeam === Team.PINK ? Team.CYAN : Team.PINK;
    const weapons: WeaponType[] = ['shooter', 'roller', 'charger', 'slosher'];
    const botWeapon = weapons[Math.floor(Math.random() * weapons.length)] || 'shooter';

    const bot = this.botController.spawnBot(botTeam, botWeapon);
    const remoteBot = new RemotePlayer(bot.id, bot.team, bot.weaponType);
    remoteBot.setName(`🤖 ${bot.name}`);
    this.renderer.scene.add(remoteBot.view.group);
    this.botRemotePlayers.set(bot.id, remoteBot);

    this.hud.addKillFeedEntry('SYSTEM', Team.NEUTRAL, `Spawned ${bot.name}`, botTeam, '🤖');
  }

  private clearPracticeBots(): void {
    for (const remoteBot of this.botRemotePlayers.values()) {
      this.renderer.scene.remove(remoteBot.view.group);
      remoteBot.view.dispose();
    }
    this.botRemotePlayers.clear();
    this.botController.clearBots();
    this.hud.addKillFeedEntry('SYSTEM', Team.NEUTRAL, 'Cleared all bots', Team.NEUTRAL, '🧹');
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
