import {
  ARENA_HALF_SIZE,
  MAX_HP,
  MAX_INK,
  PAINT_RADIUS_WORLD,
  PlayerMode,
  PlayerSnapshot,
  Team,
  Vec3,
  WEAPON_CONFIGS,
  WeaponType,
  worldToUV
} from '@ink/shared';
import { PaintEngine } from '../world/PaintEngine.js';

export interface BotState {
  id: string;
  name: string;
  team: Team;
  weaponType: WeaponType;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  hp: number;
  ink: number;
  alive: boolean;
  mode: PlayerMode;
  kills: number;
  deaths: number;
  specialMeter: number;
  state: 'PATROL' | 'COMBAT' | 'REFILL';
  targetPos: Vec3;
  lastShotTime: number;
  respawnAt: number;
}

export class BotController {
  private bots: BotState[] = [];
  private paintEngine: PaintEngine;
  private botCounter = 1;

  constructor(paintEngine: PaintEngine) {
    this.paintEngine = paintEngine;
  }

  getBots(): BotState[] {
    return this.bots;
  }

  spawnBot(team: Team, weaponType: WeaponType = 'shooter'): BotState {
    const id = `bot_${Date.now()}_${this.botCounter++}`;
    const name = `OctoBot_${this.botCounter}`;
    const spawnX = team === Team.PINK ? -38 : 38;
    const spawnZ = (Math.random() - 0.5) * 12;

    const bot: BotState = {
      id,
      name,
      team,
      weaponType,
      position: { x: spawnX, y: 0, z: spawnZ },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: team === Team.PINK ? Math.PI / 2 : -Math.PI / 2,
      pitch: -0.15,
      hp: MAX_HP,
      ink: MAX_INK,
      alive: true,
      mode: PlayerMode.HUMANOID,
      kills: 0,
      deaths: 0,
      specialMeter: 0,
      state: 'PATROL',
      targetPos: { x: (Math.random() - 0.5) * 40, y: 0, z: (Math.random() - 0.5) * 40 },
      lastShotTime: 0,
      respawnAt: 0
    };

    this.bots.push(bot);
    return bot;
  }

  clearBots(): void {
    this.bots = [];
  }

  update(
    dt: number,
    now: number,
    localPlayer: { position: Vec3; alive: boolean; team: Team; hp: number },
    onBotFire: (bot: BotState, target: Vec3) => void,
    onBotPaint: (bot: BotState, x: number, z: number) => void
  ): void {
    for (const bot of this.bots) {
      // 1. Respawn handling
      if (!bot.alive) {
        if (now >= bot.respawnAt) {
          bot.alive = true;
          bot.hp = MAX_HP;
          bot.ink = MAX_INK;
          bot.mode = PlayerMode.HUMANOID;
          bot.position.x = bot.team === Team.PINK ? -38 : 38;
          bot.position.y = 0;
          bot.position.z = (Math.random() - 0.5) * 12;
          bot.targetPos = { x: (Math.random() - 0.5) * 40, y: 0, z: (Math.random() - 0.5) * 40 };
        }
        continue;
      }

      // Check ground ink at bot position
      const groundInk = this.paintEngine.getInkAt(bot.position.x, bot.position.z);
      const isOwnInk = groundInk === bot.team;
      const isEnemyInk = bot.team === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;

      // Enemy ink damage over time & slow
      if (isEnemyInk) {
        bot.hp = Math.max(0, bot.hp - 15 * dt);
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.deaths++;
          bot.mode = PlayerMode.DEAD;
          bot.respawnAt = now + 4000;
          continue;
        }
      }

      // Ink recovery
      if (bot.mode === PlayerMode.SUBMERGED) {
        bot.ink = Math.min(MAX_INK, bot.ink + 30 * dt);
        bot.hp = Math.min(MAX_HP, bot.hp + 20 * dt);
        if (bot.ink >= 90) {
          bot.mode = PlayerMode.HUMANOID;
          bot.state = 'PATROL';
        }
      } else {
        bot.ink = Math.min(MAX_INK, bot.ink + 10 * dt);
      }

      // 2. Decision State Machine
      const distToPlayer = Math.hypot(
        localPlayer.position.x - bot.position.x,
        localPlayer.position.z - bot.position.z
      );

      // Transition to COMBAT if opponent is in range and line of sight
      if (localPlayer.alive && localPlayer.team !== bot.team && distToPlayer < 28) {
        bot.state = 'COMBAT';
        bot.targetPos = { ...localPlayer.position };
      } else if (bot.ink < 25 && isOwnInk) {
        bot.state = 'REFILL';
        bot.mode = PlayerMode.SUBMERGED;
      } else if (bot.state === 'COMBAT' && (!localPlayer.alive || distToPlayer > 35)) {
        bot.state = 'PATROL';
        bot.mode = PlayerMode.HUMANOID;
      }

      // 3. Movement execution towards targetPos
      const dx = bot.targetPos.x - bot.position.x;
      const dz = bot.targetPos.z - bot.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 2.0 && bot.state === 'PATROL') {
        // Pick new random patrol waypoint in midfield
        bot.targetPos = {
          x: (Math.random() - 0.5) * (ARENA_HALF_SIZE * 1.4),
          y: 0,
          z: (Math.random() - 0.5) * (ARENA_HALF_SIZE * 1.4)
        };
      }

      const speed = bot.mode === PlayerMode.SUBMERGED ? 9.5 : isEnemyInk ? 2.0 : 5.2;

      if (dist > 0.5) {
        const nx = dx / dist;
        const nz = dz / dist;
        bot.position.x += nx * speed * dt;
        bot.position.z += nz * speed * dt;
        bot.yaw = Math.atan2(-nx, -nz);
      }

      // 4. Weapon Firing Logic
      if (bot.mode === PlayerMode.HUMANOID && bot.ink >= 5) {
        const wConfig = WEAPON_CONFIGS[bot.weaponType] || WEAPON_CONFIGS.shooter;
        const fireInterval = 1000 / wConfig.fireRate;

        if (now - bot.lastShotTime >= fireInterval) {
          bot.lastShotTime = now;
          bot.ink = Math.max(0, bot.ink - wConfig.inkCost);

          let aimTarget: Vec3;
          if (bot.state === 'COMBAT' && localPlayer.alive && localPlayer.team !== bot.team) {
            // Aim slightly ahead of player
            aimTarget = {
              x: localPlayer.position.x + (Math.random() - 0.5) * 1.5,
              y: localPlayer.position.y + 0.8,
              z: localPlayer.position.z + (Math.random() - 0.5) * 1.5
            };
          } else {
            // Paint ground ahead
            aimTarget = {
              x: bot.position.x - Math.sin(bot.yaw) * 12 + (Math.random() - 0.5) * 4,
              y: 0,
              z: bot.position.z - Math.cos(bot.yaw) * 12 + (Math.random() - 0.5) * 4
            };
          }

          onBotFire(bot, aimTarget);
          onBotPaint(bot, aimTarget.x, aimTarget.z);
        }
      }
    }
  }

  toSnapshots(): PlayerSnapshot[] {
    return this.bots.map((b) => ({
      id: b.id,
      name: b.name,
      team: b.team,
      x: b.position.x,
      y: b.position.y,
      z: b.position.z,
      yaw: b.yaw,
      pitch: b.pitch,
      hp: b.hp,
      ink: b.ink,
      alive: b.alive,
      mode: b.mode,
      invulnerable: false,
      kills: b.kills,
      deaths: b.deaths,
      weaponType: b.weaponType,
      specialMeter: b.specialMeter
    }));
  }
}
