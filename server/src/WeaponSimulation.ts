import {
  ARENA_SIZE,
  DEATH_PAINT_RADIUS_WORLD,
  FIRE_INTERVAL,
  INK_COST,
  PAINT_RADIUS_WORLD,
  PRNG,
  PaintEvent,
  PlayerMode,
  Ray,
  Team,
  WEAPON_DAMAGE,
  WEAPON_RANGE,
  WEAPON_SPREAD,
  vec3Normalize,
  worldToUV
} from '@ink/shared';
import { CollisionWorld } from './Collision.js';
import { PaintGrid } from './PaintGrid.js';
import { PlayerState } from './PlayerState.js';

export interface ShotResult {
  fired: boolean;
  paintEvents: PaintEvent[];
  hitPlayerId?: string;
  killedPlayerId?: string;
}

export class WeaponSimulation {
  private collisionWorld: CollisionWorld;
  private paintGrid: PaintGrid;
  private nextPaintEventId = 1;

  constructor(collisionWorld: CollisionWorld, paintGrid: PaintGrid) {
    this.collisionWorld = collisionWorld;
    this.paintGrid = paintGrid;
  }

  reset(): void {
    this.nextPaintEventId = 1;
  }

  processFire(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number = Date.now()
  ): ShotResult {
    // 1. Validation checks
    if (!shooter.alive || shooter.mode !== PlayerMode.HUMANOID) {
      return { fired: false, paintEvents: [] };
    }

    // Rate limit check: allow 10ms tolerance for 20Hz tick quantization
    const elapsedSinceLastShot = (now - shooter.lastShotTime) / 1000;
    if (elapsedSinceLastShot < FIRE_INTERVAL - 0.015) {
      return { fired: false, paintEvents: [] };
    }

    // Ink check
    if (shooter.ink < INK_COST) {
      return { fired: false, paintEvents: [] };
    }

    // Consume ink and update timestamps
    shooter.ink -= INK_COST;
    shooter.lastShotTime = now;
    shooter.lastFiredTime = now;

    // 2. Compute firing ray with deterministic spread
    const seed = (now ^ (Math.floor(shooter.position.x * 1000) << 16)) >>> 0;
    const prng = new PRNG(seed);

    const cosPitch = Math.cos(shooter.pitch);
    const sinPitch = Math.sin(shooter.pitch);
    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);

    // Forward vector
    let dirX = -sinYaw * cosPitch;
    let dirY = sinPitch;
    let dirZ = -cosYaw * cosPitch;

    // Add spread
    const spreadX = prng.range(-WEAPON_SPREAD, WEAPON_SPREAD);
    const spreadY = prng.range(-WEAPON_SPREAD, WEAPON_SPREAD);
    dirX += spreadX * cosYaw;
    dirY += spreadY;
    dirZ += -spreadX * sinYaw;

    const normalizedDir = vec3Normalize({ x: dirX, y: dirY, z: dirZ });

    // Eye / Muzzle position
    const origin = {
      x: shooter.position.x,
      y: shooter.position.y + 1.3,
      z: shooter.position.z
    };

    const ray: Ray = {
      origin,
      direction: normalizedDir
    };

    // 3. Cast ray in collision world
    const hit = this.collisionWorld.castRay(
      ray,
      WEAPON_RANGE,
      allPlayers,
      shooter.team,
      shooter.id
    );

    const result: ShotResult = {
      fired: true,
      paintEvents: []
    };

    // 4. Handle Player Hit
    if (hit.hit && hit.hitPlayerId) {
      const target = allPlayers.find((p) => p.id === hit.hitPlayerId);
      if (target && target.alive && !target.isInvulnerable(now)) {
        result.hitPlayerId = target.id;
        target.hp -= WEAPON_DAMAGE;
        target.lastDamageTime = now;

        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
          target.mode = PlayerMode.DEAD;
          target.deaths++;
          shooter.kills++;
          result.killedPlayerId = target.id;

          // Death Paint burst at victim position
          const deathPaint = this.createPaintEvent(
            shooter.team,
            target.position.x,
            target.position.z,
            DEATH_PAINT_RADIUS_WORLD,
            seed
          );
          result.paintEvents.push(deathPaint);
        }
      }
    }

    // 5. Handle Ground / Obstacle Hit -> Paint Turf
    if (hit.hit && hit.isGround) {
      const paintEvt = this.createPaintEvent(
        shooter.team,
        hit.point.x,
        hit.point.z,
        PAINT_RADIUS_WORLD,
        seed
      );
      result.paintEvents.push(paintEvt);
    }

    return result;
  }

  createDeathPaintByEnemyInk(victim: PlayerState, now: number = Date.now()): PaintEvent {
    const enemyTeam = victim.team === Team.PINK ? Team.CYAN : Team.PINK;
    const seed = (now ^ 0xdeadbeef) >>> 0;
    return this.createPaintEvent(
      enemyTeam,
      victim.position.x,
      victim.position.z,
      DEATH_PAINT_RADIUS_WORLD,
      seed
    );
  }

  private createPaintEvent(
    team: Team,
    worldX: number,
    worldZ: number,
    radiusWorld: number,
    seed: number
  ): PaintEvent {
    const { u, v } = worldToUV(worldX, worldZ);
    const radiusUV = radiusWorld / ARENA_SIZE;

    const event: PaintEvent = {
      id: this.nextPaintEventId++,
      team,
      u,
      v,
      radius: radiusUV,
      seed
    };

    this.paintGrid.applyPaintEvent(event);
    return event;
  }
}
