import {
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
  SubWeaponType,
  SpecialWeaponType,
  SkillId,
  Team,
  Vec3,
  WEAPON_CONFIGS,
  WEAPON_DAMAGE,
  WEAPON_RANGE,
  WEAPON_SPREAD,
  WeaponType,
  skillMultiplier,
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
  type: SubWeaponType;
  team: Team;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  spawnTime: number;
  fuseEndsAt: number;
  isGrounded: boolean;
  lastPaintU?: number;
  lastPaintV?: number;
  /** Surfaces this projectile has already bounced off (bounce_bomb / splat_bomb). */
  bounces: number;
  /** Armed mines and landed puddles paint their own pool on this cadence. */
  nextPoolPaintAt: number;
  /** Player who threw it, so sub_power / sub_saver keep applying after the throw. */
  ownerSkills: SkillId[];
}

export interface ActiveSpecial {
  id: string;
  type: SpecialWeaponType;
  team: Team;
  ownerId: string;
  position: Vec3;
  direction: Vec3;
  startTime: number;
  endsAt: number;
  lastTickTime: number;
  /** Gear skills of the caster, re-read on every tick. */
  ownerSkills: SkillId[];
  /** Expanding shockwaves (ink_nova) already applied their one-time burst. */
  burstApplied: boolean;
}

export class WeaponSimulation {
  private collisionWorld: CollisionWorld;
  private paintGrid: PaintGrid;
  private nextPaintEventId = 1;
  private nextEntityId = 1;
  private lastCreatedNewlyPainted = 0;
  /** Active map edge length; used for UV mapping of paint events. */
  private mapSize = ARENA_SIZE;

  private activeSubWeapons: ActiveSubWeapon[] = [];
  private activeSpecials: ActiveSpecial[] = [];

  constructor(collisionWorld: CollisionWorld, paintGrid: PaintGrid) {
    this.collisionWorld = collisionWorld;
    this.paintGrid = paintGrid;
  }

  setMapSize(size: number): void {
    if (size > 0) {
      this.mapSize = size;
    }
  }

  reset(): void {
    this.nextPaintEventId = 1;
    this.nextEntityId = 1;
    this.lastCreatedNewlyPainted = 0;
    this.activeSubWeapons = [];
    this.activeSpecials = [];
  }

  /** Main-weapon ink cost after the ink_saver gear skill (kept fractional). */
  private mainInkCost(player: PlayerState, base: number): number {
    return Math.max(0, base * skillMultiplier(player.skills, 'ink_saver'));
  }

  /** Main-weapon damage after the main_power gear skill. */
  private mainDamage(player: PlayerState, base: number): number {
    return base * skillMultiplier(player.skills, 'main_power');
  }

  /** Paint radius after the paint_boost gear skill (main weapon, subs, specials). */
  private paintRadiusOf(skills: SkillId[] | undefined, base: number): number {
    return base * skillMultiplier(skills, 'paint_boost');
  }

  /** Sub-weapon damage after the sub_power gear skill. */
  private subDamage(skills: SkillId[] | undefined, base: number): number {
    return base * skillMultiplier(skills, 'sub_power');
  }

  /** Sub-weapon blast radius after the sub_power gear skill. */
  private subRadius(skills: SkillId[] | undefined, base: number): number {
    return base * skillMultiplier(skills, 'sub_power');
  }

  /** Special damage / duration after the special_power gear skill. */
  private specialScale(skills: SkillId[] | undefined): number {
    return skillMultiplier(skills, 'special_power');
  }

  /** Damage actually applied after the victim's defense gear skill. */
  private applyTargetDamage(target: PlayerState, raw: number, now: number): void {
    target.hp -= raw * skillMultiplier(target.skills, 'defense');
    target.lastDamageTime = now;
  }

  private awardSpecialForPaint(player: PlayerState, newlyPaintedCells: number): void {
    if (newlyPaintedCells <= 0 || !player.alive) return;
    const res = this.paintGrid.resolution;
    const totalArenaArea = this.mapSize * this.mapSize;
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
      return this.fireBucket(shooter, allPlayers, now);
    } else if (weaponType === 'cannon') {
      return this.fireMortar(shooter, allPlayers, now);
    } else if (weaponType === 'scatter') {
      return this.fireScatter(shooter, allPlayers, now);
    } else {
      // shooter / sprayer / marksman share the automatic hitscan path with
      // their own config (fireRate, spread, range, damage all differ).
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

    const shotCost = this.mainInkCost(shooter, config.inkCost);
    if (shooter.ink < shotCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= shotCost;
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
      weaponType: config.id
    };

    if (hit.hit && hit.hitPlayerId) {
      const target = allPlayers.find((p) => p.id === hit.hitPlayerId);
      if (target && target.alive && !target.isInvulnerable(now)) {
        result.hitPlayerId = target.id;
        this.applyTargetDamage(target, this.mainDamage(shooter, config.damage), now);

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
        this.paintRadiusOf(shooter.skills, config.paintRadius),
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

  /**
   * Pellet weapons (scatter gun). Each pellet is its own hitscan ray with the
   * weapon's spread cone and a range-based damage falloff down to
   * `falloffMin`. Damage accumulates across pellets on the same target.
   */
  private fireScatter(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number
  ): ShotResult {
    const config = WEAPON_CONFIGS.scatter;
    const elapsed = (now - shooter.lastShotTime) / 1000;
    if (elapsed < 1 / config.fireRate - 0.015) {
      return { fired: false, paintEvents: [] };
    }

    const shotCost = this.mainInkCost(shooter, config.inkCost);
    if (shooter.ink < shotCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= shotCost;
    shooter.lastShotTime = now;
    shooter.lastFiredTime = now;
    shooter.lastPaintU = undefined;
    shooter.lastPaintV = undefined;

    const seed = (now ^ 0x5ca77e2) >>> 0;
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

    const muzzleOrigin: Vec3 = {
      x: shooter.position.x + rgtX * 0.35 + fwdX * 0.4,
      y: shooter.position.y + 0.85 + fwdY * 0.4,
      z: shooter.position.z + rgtZ * 0.35 + fwdZ * 0.4
    };

    const baseDir = vec3Normalize({ x: fwdX, y: fwdY, z: fwdZ });
    const pellets = Math.max(1, config.pelletCount ?? 1);
    const falloffMin = config.falloffMin ?? 1;
    const paintRadius = this.paintRadiusOf(shooter.skills, config.paintRadius);

    const result: ShotResult = {
      fired: true,
      paintEvents: [],
      origin: muzzleOrigin,
      target: { ...muzzleOrigin },
      weaponType: 'scatter'
    };

    const damageByTarget = new Map<string, number>();
    let furthest = 0;
    let hitAnything = false;

    for (let i = 0; i < pellets; i++) {
      const spreadX = prng.range(-config.spread, config.spread);
      const spreadY = prng.range(-config.spread, config.spread);
      const dir = vec3Normalize({
        x: baseDir.x + spreadX * cosYaw,
        y: baseDir.y + spreadY,
        z: baseDir.z - spreadX * sinYaw
      });

      const hit = this.collisionWorld.castRay(
        { origin: muzzleOrigin, direction: dir },
        config.range,
        allPlayers,
        shooter.team,
        shooter.id
      );

      if (!hit.hit) continue;
      hitAnything = true;

      if (hit.distance > furthest) {
        furthest = hit.distance;
        result.target = { ...hit.point };
      }

      if (hit.hitPlayerId) {
        const distRatio = Math.min(1, hit.distance / config.range);
        const pelletDmg = config.damage * (1 - (1 - falloffMin) * distRatio);
        damageByTarget.set(hit.hitPlayerId, (damageByTarget.get(hit.hitPlayerId) ?? 0) + pelletDmg);
      } else if (hit.isGround) {
        const paintEvt = this.createPaintEvent(
          shooter.team,
          hit.point.x,
          hit.point.z,
          paintRadius * 0.55,
          (seed + i * 7919) >>> 0
        );
        result.paintEvents.push(paintEvt);
        this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);
      }
    }

    if (!hitAnything) {
      result.target = {
        x: muzzleOrigin.x + baseDir.x * config.range,
        y: muzzleOrigin.y + baseDir.y * config.range,
        z: muzzleOrigin.z + baseDir.z * config.range
      };
    }

    for (const [targetId, rawDmg] of damageByTarget) {
      const target = allPlayers.find((p) => p.id === targetId);
      if (!target || !target.alive || target.isInvulnerable(now)) continue;

      result.hitPlayerId = target.id;
      this.applyTargetDamage(target, this.mainDamage(shooter, rawDmg), now);

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

    return result;
  }

  /**
   * Heavy lobbed mortar. The shell flies a ballistic arc, detonating on the
   * first surface or enemy it meets with a splash blast plus a large ink bloom.
   */
  private fireMortar(
    shooter: PlayerState,
    allPlayers: PlayerState[],
    now: number
  ): ShotResult {
    const config = WEAPON_CONFIGS.cannon;
    const elapsed = (now - shooter.lastShotTime) / 1000;
    if (elapsed < 1 / config.fireRate - 0.015) {
      return { fired: false, paintEvents: [] };
    }

    const shotCost = this.mainInkCost(shooter, config.inkCost);
    if (shooter.ink < shotCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= shotCost;
    shooter.lastShotTime = now;
    shooter.lastFiredTime = now;
    shooter.lastPaintU = undefined;
    shooter.lastPaintV = undefined;

    const seed = (now ^ 0x3b0a17) >>> 0;
    const cosPitch = Math.cos(shooter.pitch);
    const sinPitch = Math.sin(shooter.pitch);
    const cosYaw = Math.cos(shooter.yaw);
    const sinYaw = Math.sin(shooter.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdY = sinPitch;
    const fwdZ = -cosYaw * cosPitch;

    const origin: Vec3 = {
      x: shooter.position.x + fwdX * 0.8,
      y: shooter.position.y + 1.2,
      z: shooter.position.z + fwdZ * 0.8
    };

    const speed = config.projectileSpeed ?? 26;
    const gravity = config.projectileGravity ?? -22;
    let posX = origin.x;
    let posY = origin.y;
    let posZ = origin.z;
    let velX = fwdX * speed;
    let velY = fwdY * speed + 3.0;
    let velZ = fwdZ * speed;

    const dt = 0.02;
    let impactPoint: Vec3 = { x: posX, y: 0, z: posZ };
    let directHitPlayerId: string | undefined;
    let hitSomething = false;

    for (let step = 0; step < 90; step++) {
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
          if (rayHit.hitPlayerId) directHitPlayerId = rayHit.hitPlayerId;
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
    }

    if (!hitSomething) {
      impactPoint = { x: posX, y: 0, z: posZ };
    }

    const result: ShotResult = {
      fired: true,
      paintEvents: [],
      origin,
      target: impactPoint,
      weaponType: 'cannon'
    };

    const splashRadius = config.splashRadius ?? 4.2;
    const splashDamage = config.splashDamage ?? config.damage;

    // Direct hits take the full shell damage; nearby enemies take splash falloff.
    for (const p of allPlayers) {
      if (p.id === shooter.id || p.team === shooter.team || !p.alive || p.isInvulnerable(now)) continue;

      const dx = p.position.x - impactPoint.x;
      const dy = p.position.y - impactPoint.y;
      const dz = p.position.z - impactPoint.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > splashRadius) continue;

      const isDirect = p.id === directHitPlayerId;
      const ratio = 1 - dist / splashRadius;
      const raw = isDirect
        ? config.damage + splashDamage * 0.5
        : splashDamage * (0.4 + 0.6 * ratio);

      result.hitPlayerId = p.id;
      this.applyTargetDamage(p, this.mainDamage(shooter, raw), now);

      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        p.mode = PlayerMode.DEAD;
        p.deaths++;
        shooter.kills++;
        result.killedPlayerId = p.id;

        const deathPaint = this.createPaintEvent(
          shooter.team,
          p.position.x,
          p.position.z,
          DEATH_PAINT_RADIUS_WORLD,
          seed
        );
        result.paintEvents.push(deathPaint);
        this.awardSpecialMeter(shooter, 30);
      }
    }

    // Big central bloom plus two satellite splashes so the crater reads as a burst.
    const paintRadius = this.paintRadiusOf(shooter.skills, config.paintRadius);
    result.paintEvents.push(
      this.createPaintEvent(shooter.team, impactPoint.x, impactPoint.z, paintRadius, seed)
    );
    this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);

    const prng = new PRNG(seed);
    for (let i = 0; i < 2; i++) {
      const ang = prng.range(0, Math.PI * 2);
      const dist = prng.range(paintRadius * 0.6, paintRadius * 1.1);
      const splat = this.createPaintEvent(
        shooter.team,
        impactPoint.x + Math.cos(ang) * dist,
        impactPoint.z + Math.sin(ang) * dist,
        paintRadius * 0.5,
        (seed + (i + 1) * 6151) >>> 0
      );
      result.paintEvents.push(splat);
      this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);
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
        this.paintRadiusOf(shooter.skills, config.paintRadius),
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
          this.applyTargetDamage(target, this.mainDamage(shooter, config.rollDamage || 120), now);

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

    const flickCost = this.mainInkCost(shooter, config.inkCost);
    if (shooter.ink < flickCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= flickCost;
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
            const dmg = Math.round(this.mainDamage(shooter, config.damage) * (1.0 - distRatio * 0.4)); // 100 dmg close, 60 dmg far
            this.applyTargetDamage(target, dmg, now);

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
            this.paintRadiusOf(shooter.skills, config.paintRadius) * 0.9,
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

    const chargeCost = Math.round(this.mainInkCost(shooter, config.inkCost) * charge);
    if (shooter.ink < chargeCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= chargeCost;
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

    const chargeDamage = Math.round(this.mainDamage(shooter, config.damage) * charge); // Full charge = 130 (one shot splat!)

    if (hit.hit && hit.hitPlayerId) {
      const target = allPlayers.find((p) => p.id === hit.hitPlayerId);
      if (target && target.alive && !target.isInvulnerable(now)) {
        result.hitPlayerId = target.id;
        this.applyTargetDamage(target, chargeDamage, now);

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
    const startUv = worldToUV(muzzleOrigin.x, muzzleOrigin.z, this.mapSize);
    const endUv = worldToUV(hitPoint.x, hitPoint.z, this.mapSize);
    const beamPaint = this.createPaintEvent(
      shooter.team,
      hitPoint.x,
      hitPoint.z,
      this.paintRadiusOf(shooter.skills, config.paintRadius),
      seed,
      startUv.u,
      startUv.v,
      (config.range + 10) / this.mapSize
    );
    result.paintEvents.push(beamPaint);
    this.awardSpecialForPaint(shooter, this.lastCreatedNewlyPainted);

    return result;
  }

  private fireBucket(shooter: PlayerState, allPlayers: PlayerState[], now: number): ShotResult {
    const config = WEAPON_CONFIGS.slosher;
    const elapsed = (now - shooter.lastShotTime) / 1000;
    if (elapsed < 1 / config.fireRate - 0.015) {
      return { fired: false, paintEvents: [] };
    }

    const shotCost = this.mainInkCost(shooter, config.inkCost);
    if (shooter.ink < shotCost) {
      return { fired: false, paintEvents: [] };
    }

    shooter.ink -= shotCost;
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
      this.applyTargetDamage(damagedPlayer, this.mainDamage(shooter, config.damage), now);

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
      this.paintRadiusOf(shooter.skills, config.paintRadius),
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
        this.paintRadiusOf(shooter.skills, config.paintRadius) * 0.5,
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

    const subCost = Math.max(0, config.inkCost * skillMultiplier(shooter.skills, 'sub_saver'));
    if (shooter.ink < subCost) {
      return { spawned: false };
    }

    shooter.ink -= subCost;
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
    } else if (subType === 'ink_mine' || subType === 'ink_puddle') {
      // Deployables drop close to the thrower so they land where they were aimed
      vel = {
        x: fwdX * config.throwSpeed * 0.55,
        y: fwdY * config.throwSpeed + 1.5,
        z: fwdZ * config.throwSpeed * 0.55
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
      isGrounded: false,
      bounces: 0,
      nextPoolPaintAt: now,
      ownerSkills: [...shooter.skills]
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
      radius: this.subRadius(shooter.skills, config.splashRadius)
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
    player.specialEndsAt = now + config.duration * 1000 * this.specialScale(player.skills);

    const cosPitch = Math.cos(player.pitch);
    const sinPitch = Math.sin(player.pitch);
    const cosYaw = Math.cos(player.yaw);
    const sinYaw = Math.sin(player.yaw);

    const fwdX = -sinYaw * cosPitch;
    const fwdY = sinPitch;
    const fwdZ = -cosYaw * cosPitch;

    let targetPos: Vec3;
    if (specialType === 'killer_wail' || specialType === 'ink_nova' || specialType === 'ink_barrier') {
      // Beam / burst / dome all anchor on the caster.
      targetPos = {
        x: player.position.x,
        y: player.position.y + 1.0,
        z: player.position.z
      };
    } else {
      targetPos = {
        x: player.position.x + fwdX * 20,
        y: 0,
        z: player.position.z + fwdZ * 20
      };
    }

    const id = `special_${this.nextEntityId++}`;
    const special: ActiveSpecial = {
      id,
      type: specialType,
      team: player.team,
      ownerId: player.id,
      position: targetPos,
      direction: { x: fwdX, y: 0, z: fwdZ },
      startTime: now,
      endsAt: now + config.duration * 1000 * this.specialScale(player.skills),
      lastTickTime: now,
      ownerSkills: [...player.skills],
      burstApplied: false
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
      const splashRadius = this.subRadius(sub.ownerSkills, config.splashRadius);
      const poolRadius = config.poolRadius
        ? this.subRadius(sub.ownerSkills, config.poolRadius)
        : 0;

      if (sub.type === 'curling_bomb') {
        // Curling bomb moves along ground and bounces off boundaries
        sub.position.x += sub.velocity.x * dt;
        sub.position.z += sub.velocity.z * dt;

        // Bounce off arena walls
        if (Math.abs(sub.position.x) >= this.mapSize / 2 - 1.5) {
          sub.velocity.x = -sub.velocity.x;
          sub.position.x = Math.sign(sub.position.x) * (this.mapSize / 2 - 1.5);
        }
        if (Math.abs(sub.position.z) >= this.mapSize / 2 - 1.5) {
          sub.velocity.z = -sub.velocity.z;
          sub.position.z = Math.sign(sub.position.z) * (this.mapSize / 2 - 1.5);
        }

        // Leave continuous paint trail
        const trailEvt = this.createPaintEvent(
          sub.team,
          sub.position.x,
          sub.position.z,
          this.paintRadiusOf(sub.ownerSkills, 1.6),
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
      } else if (sub.type === 'ink_mine' || sub.type === 'ink_puddle') {
        // Deployables: ballistic drop, then arm on the ground.
        if (!sub.isGrounded) {
          sub.velocity.y += -20.0 * dt;
          sub.position.x += sub.velocity.x * dt;
          sub.position.y += sub.velocity.y * dt;
          sub.position.z += sub.velocity.z * dt;

          if (sub.position.y <= 0) {
            sub.position.y = 0;
            sub.isGrounded = true;
            sub.velocity.x = 0;
            sub.velocity.y = 0;
            sub.velocity.z = 0;
            sub.fuseEndsAt = now + config.fuseTime * 1000;
            subEvents.push({
              id: sub.id,
              type: sub.type,
              action: 'bounce',
              team: sub.team,
              ownerId: sub.ownerId,
              position: sub.position,
              radius: splashRadius
            });
          }
        } else {
          // Armed: repaint its pool on a slow cadence so the patch stays fresh.
          if (now >= sub.nextPoolPaintAt) {
            sub.nextPoolPaintAt = now + 700;
            const poolEvt = this.createPaintEvent(
              sub.team,
              sub.position.x,
              sub.position.z,
              poolRadius,
              (now ^ 0x900d) >>> 0
            );
            paintEvents.push(poolEvt);
          }

          if (sub.type === 'ink_mine') {
            // Proximity trigger
            for (const p of allPlayers) {
              if (p.team === sub.team || !p.alive || p.isInvulnerable(now)) continue;
              const dx = p.position.x - sub.position.x;
              const dz = p.position.z - sub.position.z;
              const trigger = config.triggerRadius ?? 2.6;
              if (dx * dx + dz * dz <= trigger * trigger) {
                exploded = true;
                break;
              }
            }
          } else {
            // Ink puddle: persistent slow field, damages enemies standing in it.
            for (const p of allPlayers) {
              if (p.team === sub.team || !p.alive || p.isInvulnerable(now)) continue;
              const dx = p.position.x - sub.position.x;
              const dz = p.position.z - sub.position.z;
              if (dx * dx + dz * dz <= poolRadius * poolRadius) {
                const dmg = (this.subDamage(sub.ownerSkills, config.damage) * dt) / config.fuseTime;
                this.applyTargetDamage(p, dmg, now);
                hits.push({ shooterId: sub.ownerId, victimId: p.id });

                if (p.hp <= 0) {
                  p.hp = 0;
                  p.alive = false;
                  p.mode = PlayerMode.DEAD;
                  p.deaths++;
                  const killer = allPlayers.find((k) => k.id === sub.ownerId);
                  if (killer) killer.kills++;
                  deaths.push({ victimId: p.id, killerId: sub.ownerId });
                }
              }
            }
          }

          if (now >= sub.fuseEndsAt) {
            exploded = true;
          }
        }
      } else if (sub.type === 'bounce_bomb') {
        // Ricochet bomb: bounces off floor and arena walls until its hop budget runs out.
        sub.velocity.y += -20.0 * dt;
        const prevX = sub.position.x;
        const prevZ = sub.position.z;
        sub.position.x += sub.velocity.x * dt;
        sub.position.y += sub.velocity.y * dt;
        sub.position.z += sub.velocity.z * dt;

        if (sub.position.y <= 0) {
          sub.position.y = 0;
          sub.velocity.y = -sub.velocity.y * 0.72;
          sub.bounces++;
          if (sub.bounces >= (config.hopCount ?? 3) || now >= sub.fuseEndsAt) {
            exploded = true;
          }
        }

        // Wall ricochets
        const bound = this.mapSize / 2 - 1.0;
        if (Math.abs(sub.position.x) >= bound) {
          sub.velocity.x = -sub.velocity.x;
          sub.position.x = Math.sign(sub.position.x) * bound;
          sub.bounces++;
        }
        if (Math.abs(sub.position.z) >= bound) {
          sub.velocity.z = -sub.velocity.z;
          sub.position.z = Math.sign(sub.position.z) * bound;
          sub.bounces++;
        }
        if (sub.bounces >= (config.hopCount ?? 3)) {
          exploded = true;
        }
        void prevX;
        void prevZ;

        // Paint a small splat on each floor bounce so the trail reads in-game
        if (sub.bounces > 0 && Math.abs(sub.velocity.y) > 0.1) {
          const hopEvt = this.createPaintEvent(
            sub.team,
            sub.position.x,
            sub.position.z,
            this.paintRadiusOf(sub.ownerSkills, 1.4),
            (now ^ (sub.bounces * 7919)) >>> 0
          );
          paintEvents.push(hopEvt);
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
          radius: splashRadius
        });

        const blastPaint = this.createPaintEvent(
          sub.team,
          sub.position.x,
          sub.position.z,
          splashRadius,
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

          if (dist <= splashRadius) {
            const ratio = 1 - dist / splashRadius;
            const dmg = this.subDamage(sub.ownerSkills, config.damage) * (0.4 + 0.6 * ratio);
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
        const power = this.specialScale(spec.ownerSkills);
        const paintRadius = this.paintRadiusOf(spec.ownerSkills, config.radius);
        const elapsedTotal = (now - spec.startTime) / 1000;

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
              paintRadius,
              (now ^ (step << 4)) >>> 0
            );
            paintEvents.push(spPaint);
          }

          const dmgPerTick = config.dps * elapsedTick * power;
          for (const p of allPlayers) {
            if (p.team === spec.team || !p.alive || p.isInvulnerable(now)) continue;

            const vx = p.position.x - spec.position.x;
            const vz = p.position.z - spec.position.z;
            const proj = vx * ndx + vz * ndz;

            if (proj >= 0 && proj <= 60) {
              const perpDistSq = (vx * vx + vz * vz) - proj * proj;
              if (perpDistSq <= (paintRadius + 1.2) * (paintRadius + 1.2)) {
                this.damageBySpecial(spec, p, dmgPerTick, now, allPlayers, hits, deaths);
              }
            }
          }
        } else if (spec.type === 'ink_nova') {
          // Expanding shockwave: paints a growing annulus and damages the front.
          const maxRadius = paintRadius;
          const front = Math.min(maxRadius, (config.expansionSpeed ?? 8) * elapsedTotal);

          const rings = 3;
          for (let i = 0; i < rings; i++) {
            const r = Math.max(0.5, front - i * (maxRadius / rings / 1.4));
            if (r > maxRadius) continue;
            const ang = (elapsedTotal * 2.4 + i * 2.09) % (Math.PI * 2);
            const px = spec.position.x + Math.cos(ang) * r;
            const pz = spec.position.z + Math.sin(ang) * r;
            paintEvents.push(
              this.createPaintEvent(spec.team, px, pz, paintRadius * 0.42, (now ^ ((i + 1) << 9)) >>> 0)
            );
          }

          if (!spec.burstApplied) {
            spec.burstApplied = true;
            // The initial slam paints the caster's feet and lands one burst hit.
            paintEvents.push(
              this.createPaintEvent(spec.team, spec.position.x, spec.position.z, paintRadius * 0.7, (now ^ 0x90a1) >>> 0)
            );
            const burst = (config.burstDamage ?? 0) * power;
            if (burst > 0) {
              for (const p of allPlayers) {
                if (p.team === spec.team || !p.alive || p.isInvulnerable(now)) continue;
                const dx = p.position.x - spec.position.x;
                const dz = p.position.z - spec.position.z;
                if (dx * dx + dz * dz <= paintRadius * paintRadius) {
                  this.damageBySpecial(spec, p, burst, now, allPlayers, hits, deaths);
                }
              }
            }
          }

          const dmgPerTick = config.dps * elapsedTick * power;
          for (const p of allPlayers) {
            if (p.team === spec.team || !p.alive || p.isInvulnerable(now)) continue;

            const dx = p.position.x - spec.position.x;
            const dz = p.position.z - spec.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            // Only the advancing wave front connects, so stepping behind it is safe.
            if (dist <= front && dist >= front - paintRadius * 0.55) {
              this.damageBySpecial(spec, p, dmgPerTick, now, allPlayers, hits, deaths);
            }
          }
        } else if (config.support) {
          // Friendly dome: paints its own turf, shelters the team, hurts nobody.
          const domePaint = this.createPaintEvent(
            spec.team,
            spec.position.x,
            spec.position.z,
            paintRadius,
            (now ^ (spec.id.length << 8)) >>> 0
          );
          paintEvents.push(domePaint);
        } else {
          // Circular AoE (Ink Twister / Ink Downpour)
          const spPaint = this.createPaintEvent(
            spec.team,
            spec.position.x,
            spec.position.z,
            paintRadius,
            (now ^ (spec.id.length << 8)) >>> 0
          );
          paintEvents.push(spPaint);

          const dmgPerTick = config.dps * elapsedTick * power;
          for (const p of allPlayers) {
            if (p.team === spec.team || !p.alive || p.isInvulnerable(now)) continue;

            const dx = p.position.x - spec.position.x;
            const dz = p.position.z - spec.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= paintRadius) {
              this.damageBySpecial(spec, p, dmgPerTick, now, allPlayers, hits, deaths);
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
    const gain = points * skillMultiplier(player.skills, 'special_charge');
    player.specialMeter = Math.min(SPECIAL_METER_MAX, player.specialMeter + gain);
  }

  /**
   * Applies one special-weapon damage tick to a victim and records the hit /
   * death bookkeeping shared by every special shape.
   */
  private damageBySpecial(
    spec: ActiveSpecial,
    victim: PlayerState,
    rawDamage: number,
    now: number,
    allPlayers: PlayerState[],
    hits: { shooterId: string; victimId: string }[],
    deaths: { victimId: string; killerId?: string }[]
  ): void {
    this.applyTargetDamage(victim, rawDamage, now);
    hits.push({ shooterId: spec.ownerId, victimId: victim.id });

    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.mode = PlayerMode.DEAD;
      victim.deaths++;
      const killer = allPlayers.find((k) => k.id === spec.ownerId);
      if (killer) killer.kills++;
      deaths.push({ victimId: victim.id, killerId: spec.ownerId });

      this.createPaintEvent(
        spec.team,
        victim.position.x,
        victim.position.z,
        DEATH_PAINT_RADIUS_WORLD,
        now
      );
    }
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
    const { u, v } = worldToUV(worldX, worldZ, this.mapSize);
    const radiusUV = radiusWorld / this.mapSize;

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
