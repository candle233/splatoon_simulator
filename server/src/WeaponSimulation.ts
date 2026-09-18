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
  Vec3,
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
  origin?: Vec3;
  target?: Vec3;
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

    // Rate limit check: allow 15ms tolerance for 20Hz tick quantization
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

    // 2. Compute vectors for Two-Stage Aiming
    const seed = (now ^ (Math.floor(shooter.position.x * 1000) << 16)) >>> 0;
    const prng = new PRNG(seed);

    const cosPitch = Math.cos(shooter.pitch);
    const sinPitch = Math.sin(shooter.pitch);
    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdY = sinPitch;
    const fwdZ = -cosYaw * cosPitch;
    const rgtX = cosYaw;
    const rgtZ = -sinYaw;

    const headX = shooter.position.x;
    const headY = shooter.position.y + 1.8;
    const headZ = shooter.position.z;

    const baseCamDist = 5.2;
    const shoulderOffset = 0.65;

    // Camera target point ahead in looking direction
    const aimTargetX = headX + fwdX * 30;
    const aimTargetY = headY + fwdY * 30;
    const aimTargetZ = headZ + fwdZ * 30;

    // Desired camera position
    let camX = headX - fwdX * baseCamDist + rgtX * shoulderOffset;
    let camY = headY - fwdY * baseCamDist;
    let camZ = headZ - fwdZ * baseCamDist + rgtZ * shoulderOffset;

    // Check camera ray for obstacle occlusion
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

    // Camera forward ray direction
    const toCrosshairX = aimTargetX - camX;
    const toCrosshairY = aimTargetY - camY;
    const toCrosshairZ = aimTargetZ - camZ;
    const crosshairDir = vec3Normalize({
      x: toCrosshairX,
      y: toCrosshairY,
      z: toCrosshairZ
    });

    // Stage 1: Camera Raycast to get exact 3D aim point
    const cameraHit = this.collisionWorld.castRay(
      { origin: { x: camX, y: camY, z: camZ }, direction: crosshairDir },
      WEAPON_RANGE + baseCamDist,
      allPlayers,
      shooter.team,
      shooter.id
    );

    const aimPoint = cameraHit.hit
      ? cameraHit.point
      : {
          x: camX + crosshairDir.x * WEAPON_RANGE,
          y: camY + crosshairDir.y * WEAPON_RANGE,
          z: camZ + crosshairDir.z * WEAPON_RANGE
        };

    // Stage 2: Muzzle Raycast
    const muzzleOrigin: Vec3 = {
      x: shooter.position.x + rgtX * 0.35 + fwdX * 0.4,
      y: shooter.position.y + 0.85 + fwdY * 0.4,
      z: shooter.position.z + rgtZ * 0.35 + fwdZ * 0.4
    };

    let dirToAimX = aimPoint.x - muzzleOrigin.x;
    let dirToAimY = aimPoint.y - muzzleOrigin.y;
    let dirToAimZ = aimPoint.z - muzzleOrigin.z;
    const lenToAim = Math.sqrt(dirToAimX * dirToAimX + dirToAimY * dirToAimY + dirToAimZ * dirToAimZ);

    if (lenToAim > 1e-4) {
      dirToAimX /= lenToAim;
      dirToAimY /= lenToAim;
      dirToAimZ /= lenToAim;
    } else {
      dirToAimX = fwdX;
      dirToAimY = fwdY;
      dirToAimZ = fwdZ;
    }

    // Add deterministic spread
    const spreadX = prng.range(-WEAPON_SPREAD, WEAPON_SPREAD);
    const spreadY = prng.range(-WEAPON_SPREAD, WEAPON_SPREAD);
    dirToAimX += spreadX * cosYaw;
    dirToAimY += spreadY;
    dirToAimZ += -spreadX * sinYaw;

    const normalizedDir = vec3Normalize({ x: dirToAimX, y: dirToAimY, z: dirToAimZ });

    const muzzleRay: Ray = {
      origin: muzzleOrigin,
      direction: normalizedDir
    };

    // 3. Cast muzzle ray in collision world
    const hit = this.collisionWorld.castRay(
      muzzleRay,
      WEAPON_RANGE,
      allPlayers,
      shooter.team,
      shooter.id
    );

    const hitPoint = hit.hit
      ? hit.point
      : {
          x: muzzleOrigin.x + normalizedDir.x * WEAPON_RANGE,
          y: muzzleOrigin.y + normalizedDir.y * WEAPON_RANGE,
          z: muzzleOrigin.z + normalizedDir.z * WEAPON_RANGE
        };

    const result: ShotResult = {
      fired: true,
      paintEvents: [],
      origin: muzzleOrigin,
      target: hitPoint
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
