import {
  ARENA_HALF_SIZE,
  ARENA_SIZE,
  CONTINUOUS_PAINT_MAX_DIST_UV,
  DEATH_PAINT_RADIUS_WORLD,
  FIRE_INTERVAL,
  INK_COST,
  PAINT_RADIUS_WORLD,
  PRNG,
  PaintEvent,
  PlayerMode,
  Ray,
  SPECIAL_CONFIGS,
  SPECIAL_METER_MAX,
  SPECIAL_POINTS_NEEDED,
  SUB_WEAPON_CONFIGS,
  SpecialEventPayload,
  SubWeaponEventPayload,
  Team,
  Vec3,
  WEAPON_CONFIGS,
  WEAPON_DAMAGE,
  WEAPON_RANGE,
  WEAPON_SPREAD,
  WeaponType,
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
  weaponType?: WeaponType;
  chargeLevel?: number;
}

export interface ActiveSubWeapon {
  id: string;
  type: 'splat_bomb' | 'burst_bomb' | 'curling_bomb';
  team: Team;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  spawnTime: number;
  fuseEndsAt: number;
  isGrounded: boolean;
  lastPaintU?: number;
  lastPaintV?: number;
}

export interface ActiveSpecial {
  id: string;
  type: 'inkstrike' | 'ink_storm' | 'killer_wail';
  team: Team;
  ownerId: string;
  position: Vec3;
  direction: Vec3;
  startTime: number;
  endsAt: number;
  lastTickTime: number;
}

export class WeaponSimulation {
  private collisionWorld: CollisionWorld;
  private paintGrid: PaintGrid;
  private nextPaintEventId = 1;
  private nextEntityId = 1;
  private lastCreatedNewlyPainted = 0;

  private activeSubWeapons: ActiveSubWeapon[] = [];
  private activeSpecials: ActiveSpecial[] = [];

  constructor(collisionWorld: CollisionWorld, paintGrid: PaintGrid) {
    this.collisionWorld = collisionWorld;
    this.paintGrid = paintGrid;
  }

  reset(): void {
    this.nextPaintEventId = 1;
    this.nextEntityId = 1;
    this.lastCreatedNewlyPainted = 0;
    this.activeSubWeapons = [];
    this.activeSpecials = [];
  }

  private awardSpecialForPaint(player: PlayerState, newlyPaintedCells: number): void {
    if (newlyPaintedCells <= 0 || !player.alive) return;
    const res = this.paintGrid.resolution;
    const totalArenaArea = ARENA_SIZE * ARENA_SIZE;
    const turfPoints = newlyPaintedCells * (totalArenaArea / (res * res));
    const meterGain = (turfPoints / SPECIAL_POINTS_NEEDED) * SPECIAL_METER_MAX;
    this.awardSpecialMeter(player, meterGain);
  }

  processFire(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number = Date.now(),
    chargeLevelInput?: number,
    isRollingInput?: boolean
  ): ShotResult {
    // 1. Validation checks
    if (!shooter.alive || shooter.mode !== PlayerMode.HUMANOID) {
      return { fired: false, paintEvents: [] };
    }

    const weaponType = shooter.weaponType || 'shooter';
    const config = WEAPON_CONFIGS[weaponType] || WEAPON_CONFIGS.shooter;

    // Dispatch by weapon type
    if (weaponType === 'roller') {
      return this.fireRoller(shooter, allPlayers, now, isRollingInput);
    } else if (weaponType === 'charger') {
      return this.fireCharger(shooter, allPlayers, now, chargeLevelInput);
    } else if (weaponType === 'slosher') {
      return this.fireSlosher(shooter, allPlayers, now);
    } else {
      return this.fireShooter(shooter, allPlayers, now, config);
    }
  }

  private fireShooter(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number,
    config = WEAPON_CONFIGS.shooter
  ): ShotResult {
    const elapsedSinceLastShot = (now - shooter.lastShotTime) / 1000;
    const interval = 1 / config.fireRate;
    if (elapsedSinceLastShot < interval - 0.015) {
      return { fired: false, paintEvents: [] };
    }

    if (shooter.ink < config.inkCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= config.inkCost;
    shooter.lastShotTime = now;
    shooter.lastFiredTime = now;

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
    const crosshairDir = vec3Normalize({
      x: toCrosshairX,
      y: toCrosshairY,
      z: toCrosshairZ
    });

    const cameraHit = this.collisionWorld.castRay(
      { origin: { x: camX, y: camY, z: camZ }, direction: crosshairDir },
      config.range + baseCamDist,
      allPlayers,
      shooter.team,
      shooter.id
    );

    const aimPoint = cameraHit.hit
      ? cameraHit.point
      : {
          x: camX + crosshairDir.x * config.range,
          y: camY + crosshairDir.y * config.range,
          z: camZ + crosshairDir.z * config.range
        };

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

    const spreadX = prng.range(-config.spread, config.spread);
    const spreadY = prng.range(-config.spread, config.spread);
    dirToAimX += spreadX * cosYaw;
    dirToAimY += spreadY;
    dirToAimZ += -spreadX * sinYaw;

    const normalizedDir = vec3Normalize({ x: dirToAimX, y: dirToAimY, z: dirToAimZ });

    const muzzleRay: Ray = {
      origin: muzzleOrigin,
      direction: normalizedDir
    };

    const hit = this.collisionWorld.castRay(
      muzzleRay,
      config.range,
      allPlayers,
      shooter.team,
      shooter.id
    );

    const hitPoint = hit.hit
      ? hit.point
      : {
          x: muzzleOrigin.x + normalizedDir.x * config.range,
          y: muzzleOrigin.y + normalizedDir.y * config.range,
          z: muzzleOrigin.z + normalizedDir.z * config.range
        };

    const result: ShotResult = {
      fired: true,
      paintEvents: [],
      origin: muzzleOrigin,
      target: hitPoint,
      weaponType: 'shooter'
    };

    if (hit.hit && hit.hitPlayerId) {
      const target = allPlayers.find((p) => p.id === hit.hitPlayerId);
      if (target && target.alive && !target.isInvulnerable(now)) {
        result.hitPlayerId = target.id;
        target.hp -= config.damage;
        target.lastDamageTime = now;

        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
          target.mode = PlayerMode.DEAD;
          target.deaths++;
          shooter.kills++;
          result.killedPlayerId = target.id;

          const deathPaint = this.createPaintEvent(
            shooter.team,
            target.position.x,
            target.position.z,
            DEATH_PAINT_RADIUS_WORLD,
            seed
          );
          result.paintEvents.push(deathPaint);
          this.awardSpecialMeter(shooter, 30);
        }
      }
    }

    if (hit.hit && hit.isGround) {
      // Continuous paint continuity check
      let prevU = shooter.lastPaintU;
      let prevV = shooter.lastPaintV;
      if (now - shooter.lastPaintTime > 350) {
        prevU = undefined;
        prevV = undefined;
      }

      const paintEvt = this.createPaintEvent(
        shooter.team,
        hit.point.x,
        hit.point.z,
        config.paintRadius,
        seed,
        prevU,
        prevV
      );
      result.paintEvents.push(paintEvt);
      this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);

      shooter.lastPaintU = paintEvt.u;
      shooter.lastPaintV = paintEvt.v;
      shooter.lastPaintTime = now;
    } else {
      shooter.lastPaintU = undefined;
      shooter.lastPaintV = undefined;
    }

    return result;
  }

  private fireRoller(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number,
    isRolling?: boolean
  ): ShotResult {
    const config = WEAPON_CONFIGS.roller;
    const seed = (now ^ 0xaabbcc) >>> 0;

    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);
    const fwdX = -sinYaw;
    const fwdZ = -cosYaw;
    const rgtX = cosYaw;
    const rgtZ = -sinYaw;

    if (isRolling && shooter.grounded) {
      // Rolling mode
      const elapsed = (now - shooter.lastShotTime) / 1000;
      if (elapsed < 0.08) {
        return { fired: false, paintEvents: [] };
      }

      const rollCost = 0.8;
      if (shooter.ink < rollCost) {
        return { fired: false, paintEvents: [] };
      }

      shooter.ink = Math.max(0, shooter.ink - rollCost);
      shooter.lastShotTime = now;
      shooter.lastFiredTime = now;

      // Roller contact position right in front of feet
      const rollX = shooter.position.x + fwdX * 1.0;
      const rollZ = shooter.position.z + fwdZ * 1.0;

      let prevU = shooter.lastPaintU;
      let prevV = shooter.lastPaintV;
      if (now - shooter.lastPaintTime > 350) {
        prevU = undefined;
        prevV = undefined;
      }

      const paintEvt = this.createPaintEvent(
        shooter.team,
        rollX,
        rollZ,
        config.paintRadius,
        seed,
        prevU,
        prevV
      );
      this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);

      shooter.lastPaintU = paintEvt.u;
      shooter.lastPaintV = paintEvt.v;
      shooter.lastPaintTime = now;

      const result: ShotResult = {
        fired: true,
        paintEvents: [paintEvt],
        origin: { x: rollX, y: shooter.position.y + 0.2, z: rollZ },
        target: { x: rollX + fwdX * 0.5, y: shooter.position.y + 0.2, z: rollZ + fwdZ * 0.5 },
        weaponType: 'roller'
      };

      // Roller Crush: check for enemy players directly in front of the roller
      for (const target of allPlayers) {
        if (target.id === shooter.id || target.team === shooter.team || !target.alive || target.isInvulnerable(now)) {
          continue;
        }

        const dx = target.position.x - rollX;
        const dz = target.position.z - rollZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= 1.8 && Math.abs(target.position.y - shooter.position.y) < 2.0) {
          result.hitPlayerId = target.id;
          target.hp -= (config.rollDamage || 120);
          target.lastDamageTime = now;

          if (target.hp <= 0) {
            target.hp = 0;
            target.alive = false;
            target.mode = PlayerMode.DEAD;
            target.deaths++;
            shooter.kills++;
            result.killedPlayerId = target.id;

            const deathPaint = this.createPaintEvent(
              shooter.team,
              target.position.x,
              target.position.z,
              DEATH_PAINT_RADIUS_WORLD,
              seed
            );
            result.paintEvents.push(deathPaint);
            this.awardSpecialMeter(shooter, 30);
          }
          break;
        }
      }

      return result;
    } else {
      // Flick mode: wide melee splash
      const elapsed = (now - shooter.lastShotTime) / 1000;
      if (elapsed < 1 / config.fireRate - 0.015) {
        return { fired: false, paintEvents: [] };
      }

      if (shooter.ink < config.inkCost) {
        return { fired: false, paintEvents: [] };
      }

      shooter.ink -= config.inkCost;
      shooter.lastShotTime = now;
      shooter.lastFiredTime = now;
      shooter.lastPaintU = undefined;
      shooter.lastPaintV = undefined;

      const origin: Vec3 = {
        x: shooter.position.x,
        y: shooter.position.y + 1.2,
        z: shooter.position.z
      };

      const result: ShotResult = {
        fired: true,
        paintEvents: [],
        origin,
        target: { x: origin.x + fwdX * config.range, y: origin.y, z: origin.z + fwdZ * config.range },
        weaponType: 'roller'
      };

      // Cast 3 fanned rays forward
      const fanAngles = [-0.15, 0, 0.15];
      for (const angle of fanAngles) {
        const rayDirX = fwdX * Math.cos(angle) - rgtX * Math.sin(angle);
        const rayDirZ = fwdZ * Math.cos(angle) - rgtZ * Math.sin(angle);
        const normDir = vec3Normalize({ x: rayDirX, y: -0.1, z: rayDirZ });

        const hit = this.collisionWorld.castRay(
          { origin, direction: normDir },
          config.range,
          allPlayers,
          shooter.team,
          shooter.id
        );

        if (hit.hit && hit.hitPlayerId && !result.hitPlayerId) {
          const target = allPlayers.find((p) => p.id === hit.hitPlayerId);
          if (target && target.alive && !target.isInvulnerable(now)) {
            result.hitPlayerId = target.id;
            const distRatio = Math.min(1.0, hit.distance / config.range);
            const dmg = Math.round(config.damage * (1.0 - distRatio * 0.4)); // 100 dmg close, 60 dmg far
            target.hp -= dmg;
            target.lastDamageTime = now;

            if (target.hp <= 0) {
              target.hp = 0;
              target.alive = false;
              target.mode = PlayerMode.DEAD;
              target.deaths++;
              shooter.kills++;
              result.killedPlayerId = target.id;

              const deathPaint = this.createPaintEvent(
                shooter.team,
                target.position.x,
                target.position.z,
                DEATH_PAINT_RADIUS_WORLD,
                seed
              );
              result.paintEvents.push(deathPaint);
              this.awardSpecialMeter(shooter, 30);
            }
          }
        }

        if (hit.hit && hit.isGround) {
          const paintEvt = this.createPaintEvent(
            shooter.team,
            hit.point.x,
            hit.point.z,
            config.paintRadius * 0.9,
            (seed + result.paintEvents.length * 997) >>> 0
          );
          result.paintEvents.push(paintEvt);
          this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);
        }
      }

      return result;
    }
  }

  private fireCharger(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number,
    chargeLevelInput = 1.0
  ): ShotResult {
    const config = WEAPON_CONFIGS.charger;
    const charge = Math.max(0.2, Math.min(1.0, chargeLevelInput));

    const inkCost = Math.round(config.inkCost * charge);
    if (shooter.ink < inkCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= inkCost;
    shooter.lastShotTime = now;
    shooter.lastFiredTime = now;
    shooter.chargeLevel = 0;

    const seed = (now ^ 0xc0ffee) >>> 0;
    const cosPitch = Math.cos(shooter.pitch);
    const sinPitch = Math.sin(shooter.pitch);
    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdY = sinPitch;
    const fwdZ = -cosYaw * cosPitch;
    const rgtX = cosYaw;
    const rgtZ = -sinYaw;

    const muzzleOrigin: Vec3 = {
      x: shooter.position.x + rgtX * 0.35 + fwdX * 0.4,
      y: shooter.position.y + 0.85 + fwdY * 0.4,
      z: shooter.position.z + rgtZ * 0.35 + fwdZ * 0.4
    };

    const range = config.range * (0.5 + 0.5 * charge);
    const dir = vec3Normalize({ x: fwdX, y: fwdY, z: fwdZ });

    // Laser Raycast: pierces through multiple players!
    const hit = this.collisionWorld.castRay(
      { origin: muzzleOrigin, direction: dir },
      range,
      allPlayers,
      shooter.team,
      shooter.id
    );

    const hitPoint = hit.hit
      ? hit.point
      : {
          x: muzzleOrigin.x + dir.x * range,
          y: muzzleOrigin.y + dir.y * range,
          z: muzzleOrigin.z + dir.z * range
        };

    const result: ShotResult = {
      fired: true,
      paintEvents: [],
      origin: muzzleOrigin,
      target: hitPoint,
      weaponType: 'charger',
      chargeLevel: charge
    };

    const damage = Math.round(config.damage * charge); // Full charge = 130 (one shot splat!)

    if (hit.hit && hit.hitPlayerId) {
      const target = allPlayers.find((p) => p.id === hit.hitPlayerId);
      if (target && target.alive && !target.isInvulnerable(now)) {
        result.hitPlayerId = target.id;
        target.hp -= damage;
        target.lastDamageTime = now;

        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
          target.mode = PlayerMode.DEAD;
          target.deaths++;
          shooter.kills++;
          result.killedPlayerId = target.id;

          const deathPaint = this.createPaintEvent(
            shooter.team,
            target.position.x,
            target.position.z,
            DEATH_PAINT_RADIUS_WORLD,
            seed
          );
          result.paintEvents.push(deathPaint);
          this.awardSpecialMeter(shooter, 30);
        }
      }
    }

    // Paint continuous beam line on the ground!
    const startUv = worldToUV(muzzleOrigin.x, muzzleOrigin.z);
    const endUv = worldToUV(hitPoint.x, hitPoint.z);
    const beamPaint = this.createPaintEvent(
      shooter.team,
      hitPoint.x,
      hitPoint.z,
      config.paintRadius,
      seed,
      startUv.u,
      startUv.v,
      (config.range + 10) / ARENA_SIZE
    );
    result.paintEvents.push(beamPaint);
    this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);

    return result;
  }

  private fireSlosher(shooter: PlayerState, allPlayers: PlayerState[], now: number): ShotResult {
    const config = WEAPON_CONFIGS.slosher;
    const elapsed = (now - shooter.lastShotTime) / 1000;
    if (elapsed < 1 / config.fireRate - 0.015) {
      return { fired: false, paintEvents: [] };
    }

    if (shooter.ink < config.inkCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= config.inkCost;
    shooter.lastShotTime = now;
    shooter.lastFiredTime = now;
    shooter.lastPaintU = undefined;
    shooter.lastPaintV = undefined;

    const seed = (now ^ 0x51054) >>> 0;
    const cosPitch = Math.cos(shooter.pitch);
    const sinPitch = Math.sin(shooter.pitch);
    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdZ = -cosYaw * cosPitch;

    const origin: Vec3 = {
      x: shooter.position.x,
      y: shooter.position.y + 1.2,
      z: shooter.position.z
    };

    // Parabolic lob arc: forward speed + upward arc clearing obstacles
    const horizSpeed = 22.0;
    const upwardSpeed = 5.5 + Math.max(-0.2, sinPitch) * 8.0;
    const gravity = -24.0;

    let posX = origin.x;
    let posY = origin.y;
    let posZ = origin.z;
    let velX = fwdX * horizSpeed;
    let velY = upwardSpeed;
    let velZ = fwdZ * horizSpeed;

    const dt = 0.04;
    let impactPoint: Vec3 = { x: posX + velX * 0.7, y: 0, z: posZ + velZ * 0.7 };
    let hitSomething = false;
    let directHitPlayerId: string | undefined;
    const trailSplats: Vec3[] = [];

    for (let step = 0; step < 24; step++) {
      const nextX = posX + velX * dt;
      const nextY = posY + velY * dt;
      const nextZ = posZ + velZ * dt;
      velY += gravity * dt;

      const segDx = nextX - posX;
      const segDy = nextY - posY;
      const segDz = nextZ - posZ;
      const segDist = Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);

      if (segDist > 1e-4) {
        const rayHit = this.collisionWorld.castRay(
          {
            origin: { x: posX, y: posY, z: posZ },
            direction: { x: segDx / segDist, y: segDy / segDist, z: segDz / segDist }
          },
          segDist,
          allPlayers,
          shooter.team,
          shooter.id
        );

        if (rayHit.hit) {
          impactPoint = rayHit.point;
          hitSomething = true;
          if (rayHit.hitPlayerId) {
            directHitPlayerId = rayHit.hitPlayerId;
          }
          break;
        }
      }

      if (nextY <= 0) {
        impactPoint = { x: nextX, y: 0, z: nextZ };
        hitSomething = true;
        break;
      }

      posX = nextX;
      posY = nextY;
      posZ = nextZ;

      // Sample a trail splat along trajectory
      if (step === 6 || step === 12) {
        trailSplats.push({ x: posX, y: 0, z: posZ });
      }
    }

    if (!hitSomething) {
      impactPoint = { x: posX, y: 0, z: posZ };
    }

    const result: ShotResult = {
      fired: true,
      paintEvents: [],
      origin,
      target: impactPoint,
      weaponType: 'slosher'
    };

    // Apply Damage: Direct hit or Splash AoE around impact
    let damagedPlayer: PlayerState | undefined;
    if (directHitPlayerId) {
      damagedPlayer = allPlayers.find((p) => p.id === directHitPlayerId);
    } else {
      for (const p of allPlayers) {
        if (p.id === shooter.id || p.team === shooter.team || !p.alive || p.isInvulnerable(now)) continue;
        const dx = p.position.x - impactPoint.x;
        const dy = p.position.y - impactPoint.y;
        const dz = p.position.z - impactPoint.z;
        if (dx * dx + dy * dy + dz * dz <= (config.paintRadius * 0.9) * (config.paintRadius * 0.9)) {
          damagedPlayer = p;
          break;
        }
      }
    }

    if (damagedPlayer && damagedPlayer.alive && !damagedPlayer.isInvulnerable(now)) {
      result.hitPlayerId = damagedPlayer.id;
      damagedPlayer.hp -= config.damage;
      damagedPlayer.lastDamageTime = now;

      if (damagedPlayer.hp <= 0) {
        damagedPlayer.hp = 0;
        damagedPlayer.alive = false;
        damagedPlayer.mode = PlayerMode.DEAD;
        damagedPlayer.deaths++;
        shooter.kills++;
        result.killedPlayerId = damagedPlayer.id;

        const deathPaint = this.createPaintEvent(
          shooter.team,
          damagedPlayer.position.x,
          damagedPlayer.position.z,
          DEATH_PAINT_RADIUS_WORLD,
          seed
        );
        result.paintEvents.push(deathPaint);
        this.awardSpecialMeter(shooter, 30);
      }
    }

    // Paint main impact splash
    const mainPaint = this.createPaintEvent(
      shooter.team,
      impactPoint.x,
      impactPoint.z,
      config.paintRadius,
      seed
    );
    result.paintEvents.push(mainPaint);
    this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);

    // Paint droplets along the lob path
    for (let i = 0; i < trailSplats.length; i++) {
      const sp = trailSplats[i]!;
      const trailPaint = this.createPaintEvent(
        shooter.team,
        sp.x,
        sp.z,
        config.paintRadius * 0.5,
        (seed + (i + 1) * 7919) >>> 0
      );
      result.paintEvents.push(trailPaint);
      this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);
    }

    return result;
  }

  processSubWeapon(
    shooter: PlayerState,
    _allPlayers: PlayerState[],
    now: number = Date.now()
  ): { spawned: boolean; subEvent?: SubWeaponEventPayload } {
    if (!shooter.alive || shooter.mode !== PlayerMode.HUMANOID) {
      return { spawned: false };
    }

    // Rate limit sub-weapon throw (0.8s cooldown)
    if (now - shooter.lastSubWeaponTime < 800) {
      return { spawned: false };
    }

    const weaponType = shooter.weaponType || 'shooter';
    const subType = WEAPON_CONFIGS[weaponType]?.sub || 'splat_bomb';
    const config = SUB_WEAPON_CONFIGS[subType];

    if (shooter.ink < config.inkCost) {
      return { spawned: false };
    }

    shooter.ink -= config.inkCost;
    shooter.lastSubWeaponTime = now;

    const cosPitch = Math.cos(shooter.pitch);
    const sinPitch = Math.sin(shooter.pitch);
    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdY = sinPitch;
    const fwdZ = -cosYaw * cosPitch;

    const spawnPos: Vec3 = {
      x: shooter.position.x + fwdX * 0.8,
      y: shooter.position.y + 1.2,
      z: shooter.position.z + fwdZ * 0.8
    };

    let vel: Vec3;
    if (subType === 'curling_bomb') {
      // Curling slides along ground
      spawnPos.y = 0.2;
      vel = {
        x: -sinYaw * config.throwSpeed,
        y: 0,
        z: -cosYaw * config.throwSpeed
      };
    } else {
      vel = {
        x: fwdX * config.throwSpeed,
        y: fwdY * config.throwSpeed + (subType === 'burst_bomb' ? 1.5 : 4.5),
        z: fwdZ * config.throwSpeed
      };
    }

    const id = `sub_${this.nextEntityId++}`;
    const subWeapon: ActiveSubWeapon = {
      id,
      type: subType,
      team: shooter.team,
      ownerId: shooter.id,
      position: spawnPos,
      velocity: vel,
      spawnTime: now,
      fuseEndsAt: now + config.fuseTime * 1000,
      isGrounded: false
    };

    this.activeSubWeapons.push(subWeapon);

    const subEvent: SubWeaponEventPayload = {
      id,
      type: subType,
      action: 'spawn',
      team: shooter.team,
      ownerId: shooter.id,
      position: spawnPos,
      velocity: vel,
      radius: config.splashRadius
    };

    return { spawned: true, subEvent };
  }

  processSpecial(
    player: PlayerState,
    _allPlayers: PlayerState[],
    now: number = Date.now()
  ): { activated: boolean; specialEvent?: SpecialEventPayload } {
    if (!player.alive || player.mode !== PlayerMode.HUMANOID) {
      return { activated: false };
    }

    if (player.specialMeter < SPECIAL_METER_MAX) {
      return { activated: false };
    }

    const weaponType = player.weaponType || 'shooter';
    const specialType = WEAPON_CONFIGS[weaponType]?.special || 'inkstrike';
    const config = SPECIAL_CONFIGS[specialType];

    player.specialMeter = 0;
    player.specialActive = true;
    player.specialEndsAt = now + config.duration * 1000;

    const cosPitch = Math.cos(player.pitch);
    const sinPitch = Math.sin(player.pitch);
    const cosYaw = Math.cos(player.yaw);
    const sinYaw = Math.sin(player.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdY = sinPitch;
    const fwdZ = -cosYaw * cosPitch;

    const targetPos: Vec3 =
      specialType === 'killer_wail'
        ? {
            x: player.position.x,
            y: player.position.y + 1.0,
            z: player.position.z
          }
        : {
            x: player.position.x + fwdX * 20,
            y: 0,
            z: player.position.z + fwdZ * 20
          };

    const id = `special_${this.nextEntityId++}`;
    const special: ActiveSpecial = {
      id,
      type: specialType,
      team: player.team,
      ownerId: player.id,
      position: targetPos,
      direction: { x: fwdX, y: 0, z: fwdZ },
      startTime: now,
      endsAt: now + config.duration * 1000,
      lastTickTime: now
    };

    this.activeSpecials.push(special);

    const specialEvent: SpecialEventPayload = {
      id,
      type: specialType,
      action: 'activate',
      team: player.team,
      ownerId: player.id,
      position: targetPos,
      direction: { x: fwdX, y: 0, z: fwdZ },
      duration: config.duration
    };

    return { activated: true, specialEvent };
  }

  updateEntities(
    allPlayers: PlayerState[],
    dt: number,
    now: number = Date.now()
  ): {
    paintEvents: PaintEvent[];
    subEvents: SubWeaponEventPayload[];
    specialEvents: SpecialEventPayload[];
    hits: { shooterId: string; victimId: string }[];
    deaths: { victimId: string; killerId?: string }[];
  } {
    const paintEvents: PaintEvent[] = [];
    const subEvents: SubWeaponEventPayload[] = [];
    const specialEvents: SpecialEventPayload[] = [];
    const hits: { shooterId: string; victimId: string }[] = [];
    const deaths: { victimId: string; killerId?: string }[] = [];

    // 1. Simulate Sub Weapons
    const activeSubs: ActiveSubWeapon[] = [];
    for (const sub of this.activeSubWeapons) {
      let exploded = false;
      const config = SUB_WEAPON_CONFIGS[sub.type];

      if (sub.type === 'curling_bomb') {
        // Curling bomb moves along ground and bounces off boundaries
        sub.position.x += sub.velocity.x * dt;
        sub.position.z += sub.velocity.z * dt;

        // Bounce off arena walls
        if (Math.abs(sub.position.x) >= ARENA_HALF_SIZE - 1.5) {
          sub.velocity.x = -sub.velocity.x;
          sub.position.x = Math.sign(sub.position.x) * (ARENA_HALF_SIZE - 1.5);
        }
        if (Math.abs(sub.position.z) >= ARENA_HALF_SIZE - 1.5) {
          sub.velocity.z = -sub.velocity.z;
          sub.position.z = Math.sign(sub.position.z) * (ARENA_HALF_SIZE - 1.5);
        }

        // Leave continuous paint trail
        const trailEvt = this.createPaintEvent(
          sub.team,
          sub.position.x,
          sub.position.z,
          1.6,
          (now ^ 0xca11) >>> 0,
          sub.lastPaintU,
          sub.lastPaintV
        );
        paintEvents.push(trailEvt);
        sub.lastPaintU = trailEvt.u;
        sub.lastPaintV = trailEvt.v;

        // Check timeout
        if (now >= sub.fuseEndsAt) {
          exploded = true;
        }

        // Check collision with enemy players
        for (const p of allPlayers) {
          if (p.team !== sub.team && p.alive) {
            const dx = p.position.x - sub.position.x;
            const dz = p.position.z - sub.position.z;
            if (dx * dx + dz * dz < 2.0 * 2.0) {
              exploded = true;
              break;
            }
          }
        }
      } else {
        // Splat bomb & Burst bomb parabolic ballistic flight
        sub.velocity.y += -20.0 * dt;
        sub.position.x += sub.velocity.x * dt;
        sub.position.y += sub.velocity.y * dt;
        sub.position.z += sub.velocity.z * dt;

        if (sub.position.y <= 0) {
          sub.position.y = 0;
          if (sub.type === 'burst_bomb') {
            exploded = true;
          } else {
            // Splat bomb bounces
            if (!sub.isGrounded) {
              sub.isGrounded = true;
              sub.fuseEndsAt = now + config.fuseTime * 1000;
              sub.velocity.y = -sub.velocity.y * 0.35;
              sub.velocity.x *= 0.5;
              sub.velocity.z *= 0.5;
            } else {
              sub.velocity.x = 0;
              sub.velocity.y = 0;
              sub.velocity.z = 0;
            }
          }
        }

        if (sub.isGrounded && now >= sub.fuseEndsAt) {
          exploded = true;
        }
      }

      if (exploded) {
        // Trigger Bomb Detonation
        subEvents.push({
          id: sub.id,
          type: sub.type,
          action: 'explode',
          team: sub.team,
          ownerId: sub.ownerId,
          position: sub.position,
          radius: config.splashRadius
        });

        const blastPaint = this.createPaintEvent(
          sub.team,
          sub.position.x,
          sub.position.z,
          config.splashRadius,
          (now ^ 0xb00b) >>> 0
        );
        paintEvents.push(blastPaint);

        // Apply Damage
        for (const p of allPlayers) {
          if (p.team === sub.team || !p.alive || p.isInvulnerable(now)) continue;

          const dx = p.position.x - sub.position.x;
          const dy = p.position.y - sub.position.y;
          const dz = p.position.z - sub.position.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist <= config.splashRadius) {
            const ratio = 1 - dist / config.splashRadius;
            const dmg = Math.round(config.damage * (0.4 + 0.6 * ratio));
            p.hp -= dmg;
            p.lastDamageTime = now;
            hits.push({ shooterId: sub.ownerId, victimId: p.id });

            if (p.hp <= 0) {
              p.hp = 0;
              p.alive = false;
              p.mode = PlayerMode.DEAD;
              p.deaths++;
              const killer = allPlayers.find((k) => k.id === sub.ownerId);
              if (killer) killer.kills++;
              deaths.push({ victimId: p.id, killerId: sub.ownerId });

              const deathPaint = this.createPaintEvent(
                sub.team,
                p.position.x,
                p.position.z,
                DEATH_PAINT_RADIUS_WORLD,
                (now ^ 0xdead) >>> 0
              );
              paintEvents.push(deathPaint);
            }
          }
        }
      } else {
        activeSubs.push(sub);
      }
    }
    this.activeSubWeapons = activeSubs;

    // 2. Simulate Active Specials
    const activeSpecs: ActiveSpecial[] = [];
    for (const spec of this.activeSpecials) {
      if (now >= spec.endsAt) {
        specialEvents.push({
          id: spec.id,
          type: spec.type,
          action: 'end',
          team: spec.team,
          ownerId: spec.ownerId,
          position: spec.position
        });
        continue;
      }

      const elapsedTick = (now - spec.lastTickTime) / 1000;
      if (elapsedTick >= 0.2) {
        spec.lastTickTime = now;
        const config = SPECIAL_CONFIGS[spec.type];

        if (spec.type === 'ink_storm') {
          // Cloud moves forward
          const speed = config.speed || 4.0;
          spec.position.x += spec.direction.x * speed * elapsedTick;
          spec.position.z += spec.direction.z * speed * elapsedTick;
        }

        if (spec.type === 'killer_wail') {
          // Continuous laser beam along direction
          const dirLen = Math.sqrt(spec.direction.x * spec.direction.x + spec.direction.z * spec.direction.z) || 1;
          const ndx = spec.direction.x / dirLen;
          const ndz = spec.direction.z / dirLen;

          for (let step = 5; step <= 50; step += 10) {
            const bx = spec.position.x + ndx * step;
            const bz = spec.position.z + ndz * step;
            const spPaint = this.createPaintEvent(
              spec.team,
              bx,
              bz,
              config.radius,
              (now ^ (step << 4)) >>> 0
            );
            paintEvents.push(spPaint);
          }

          const dmgPerTick = Math.round(config.dps * elapsedTick);
          for (const p of allPlayers) {
            if (p.team === spec.team || !p.alive || p.isInvulnerable(now)) continue;

            const vx = p.position.x - spec.position.x;
            const vz = p.position.z - spec.position.z;
            const proj = vx * ndx + vz * ndz;

            if (proj >= 0 && proj <= 60) {
              const perpDistSq = (vx * vx + vz * vz) - proj * proj;
              if (perpDistSq <= (config.radius + 1.2) * (config.radius + 1.2)) {
                p.hp -= dmgPerTick;
                p.lastDamageTime = now;
                hits.push({ shooterId: spec.ownerId, victimId: p.id });

                if (p.hp <= 0) {
                  p.hp = 0;
                  p.alive = false;
                  p.mode = PlayerMode.DEAD;
                  p.deaths++;
                  const killer = allPlayers.find((k) => k.id === spec.ownerId);
                  if (killer) killer.kills++;
                  deaths.push({ victimId: p.id, killerId: spec.ownerId });

                  const deathPaint = this.createPaintEvent(
                    spec.team,
                    p.position.x,
                    p.position.z,
                    DEATH_PAINT_RADIUS_WORLD,
                    now
                  );
                  paintEvents.push(deathPaint);
                }
              }
            }
          }
        } else {
          // Circular AoE (Inkstrike / Ink Storm)
          const spPaint = this.createPaintEvent(
            spec.team,
            spec.position.x,
            spec.position.z,
            config.radius,
            (now ^ (spec.id.length << 8)) >>> 0
          );
          paintEvents.push(spPaint);

          const dmgPerTick = Math.round(config.dps * elapsedTick);
          for (const p of allPlayers) {
            if (p.team === spec.team || !p.alive || p.isInvulnerable(now)) continue;

            const dx = p.position.x - spec.position.x;
            const dz = p.position.z - spec.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= config.radius) {
              p.hp -= dmgPerTick;
              p.lastDamageTime = now;
              hits.push({ shooterId: spec.ownerId, victimId: p.id });

              if (p.hp <= 0) {
                p.hp = 0;
                p.alive = false;
                p.mode = PlayerMode.DEAD;
                p.deaths++;
                const killer = allPlayers.find((k) => k.id === spec.ownerId);
                if (killer) killer.kills++;
                deaths.push({ victimId: p.id, killerId: spec.ownerId });

                const deathPaint = this.createPaintEvent(
                  spec.team,
                  p.position.x,
                  p.position.z,
                  DEATH_PAINT_RADIUS_WORLD,
                  now
                );
                paintEvents.push(deathPaint);
              }
            }
          }
        }
      }

      activeSpecs.push(spec);
    }
    this.activeSpecials = activeSpecs;

    return {
      paintEvents,
      subEvents,
      specialEvents,
      hits,
      deaths
    };
  }

  public awardSpecialMeter(player: PlayerState, points: number): void {
    player.specialMeter = Math.min(SPECIAL_METER_MAX, player.specialMeter + points);
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

  createPaintEvent(
    team: Team,
    worldX: number,
    worldZ: number,
    radiusWorld: number,
    seed: number,
    prevU?: number,
    prevV?: number,
    maxDistUV: number = CONTINUOUS_PAINT_MAX_DIST_UV
  ): PaintEvent {
    const { u, v } = worldToUV(worldX, worldZ);
    const radiusUV = radiusWorld / ARENA_SIZE;

    let validPrevU = prevU;
    let validPrevV = prevV;
    if (prevU !== undefined && prevV !== undefined) {
      const distSq = (u - prevU) * (u - prevU) + (v - prevV) * (v - prevV);
      if (distSq > maxDistUV * maxDistUV || distSq < 1e-6) {
        validPrevU = undefined;
        validPrevV = undefined;
      }
    }

    const event: PaintEvent = {
      id: this.nextPaintEventId++,
      team,
      u,
      v,
      radius: radiusUV,
      seed,
      prevU: validPrevU,
      prevV: validPrevV
    };

    this.lastCreatedNewlyPainted = this.paintGrid.applyPaintEvent(event);
    return event;
  }
}
