import * as THREE from 'three';
import { Team, Vec3 } from '@ink/shared';

interface Particle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: THREE.Vector3;
  baseColor: THREE.Color;
  gravity: number;
  life: number;
  maxLife: number;
  initialScale: number;
  bounces: number;
  floorY: number;
  isRipple: boolean;
}

export class ParticleSystem {
  readonly group = new THREE.Group();
  private poolSize = 250;
  private particles: Particle[] = [];
  private sharedGeo = new THREE.SphereGeometry(1, 8, 8);
  private sharedMat: THREE.MeshBasicMaterial;
  private instancedMesh: THREE.InstancedMesh;
  /** 0..1 multiplier on spawn counts (graphics quality setting). */
  private densityScale = 1;

  // Reusable scratch objects for matrix and color updates
  private dummyMatrix = new THREE.Matrix4();
  private dummyQuat = new THREE.Quaternion(); // identity
  private dummyColor = new THREE.Color();

  constructor() {
    this.sharedMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    this.instancedMesh = new THREE.InstancedMesh(this.sharedGeo, this.sharedMat, this.poolSize);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.frustumCulled = false;
    this.group.add(this.instancedMesh);

    this.initPool();
  }

  setDensityScale(scale: number): void {
    this.densityScale = Math.max(0.25, Math.min(1, scale));
  }

  private scaled(count: number): number {
    return Math.max(1, Math.round(count * this.densityScale));
  }

  private initPool(): void {
    this.dummyMatrix.makeScale(0, 0, 0);
    this.dummyColor.setHex(0xffffff);

    for (let i = 0; i < this.poolSize; i++) {
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
      this.instancedMesh.setColorAt(i, this.dummyColor);

      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        scale: new THREE.Vector3(0, 0, 0),
        baseColor: new THREE.Color(0xffffff),
        gravity: 18.0,
        life: 0,
        maxLife: 0.4,
        initialScale: 0.12,
        bounces: 0,
        floorY: 0.06,
        isRipple: false
      });
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Spawns an explosive burst of ink droplets radiating from a point (e.g., bullet hit, bomb hit).
   */
  spawnSplash(pos: Vec3, team: Team, count = 8, speed = 7.0, baseRadius = 0.14): void {
    const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    let spawned = 0;
    count = this.scaled(count);

    for (let i = 0; i < this.poolSize; i++) {
      const p = this.particles[i]!;
      if (p.active) continue;

      p.active = true;
      p.baseColor.setHex(colorHex);

      p.position.set(pos.x, Math.max(0.1, pos.y), pos.z);
      const scale = baseRadius * (0.7 + Math.random() * 0.6);
      p.initialScale = scale;
      p.scale.set(scale, scale, scale);

      // Random hemisphere velocity with upward bias
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * (Math.PI * 0.45); // Upward angle
      const spd = speed * (0.6 + Math.random() * 0.8);

      p.velocity.set(
        Math.cos(theta) * Math.sin(phi) * spd,
        Math.cos(phi) * spd + 1.5,
        Math.sin(theta) * Math.sin(phi) * spd
      );

      p.gravity = 20.0 + Math.random() * 5.0;
      p.maxLife = 0.35 + Math.random() * 0.3;
      p.life = p.maxLife;
      p.bounces = 0;
      p.floorY = Math.max(0.06, pos.y);
      p.isRipple = false;

      this.dummyMatrix.compose(p.position, this.dummyQuat, p.scale);
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
      this.instancedMesh.setColorAt(i, p.baseColor);

      spawned++;
      if (spawned >= count) break;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Spawns small muzzle spray droplets shooting forward from the weapon.
   */
  spawnMuzzleSpray(muzzlePos: Vec3, forwardDir: Vec3, team: Team, count = 3): void {
    const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    let spawned = 0;
    count = this.scaled(count);

    for (let i = 0; i < this.poolSize; i++) {
      const p = this.particles[i]!;
      if (p.active) continue;

      p.active = true;
      p.baseColor.setHex(colorHex);

      p.position.set(muzzlePos.x, muzzlePos.y, muzzlePos.z);
      const scale = 0.08 * (0.8 + Math.random() * 0.5);
      p.initialScale = scale;
      p.scale.set(scale, scale, scale);

      // Forward direction with slight random spread
      const spread = 0.15;
      const vx = forwardDir.x + (Math.random() - 0.5) * spread;
      const vy = forwardDir.y + (Math.random() - 0.5) * spread * 0.5;
      const vz = forwardDir.z + (Math.random() - 0.5) * spread;
      const speed = 12.0 + Math.random() * 6.0;

      p.velocity.set(vx * speed, vy * speed, vz * speed);
      p.gravity = 12.0;
      p.maxLife = 0.18 + Math.random() * 0.12;
      p.life = p.maxLife;
      p.bounces = 0;
      p.floorY = 0.06;
      p.isRipple = false;

      this.dummyMatrix.compose(p.position, this.dummyQuat, p.scale);
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
      this.instancedMesh.setColorAt(i, p.baseColor);

      spawned++;
      if (spawned >= count) break;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Spawns squid swim wake ripples & foam droplets trailing behind swimming squids.
   */
  spawnSwimWake(pos: Vec3, team: Team, velocity: Vec3, count = 2): void {
    const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    let spawned = 0;
    count = this.scaled(count);

    // Direction opposite to movement
    const moveAngle = Math.atan2(velocity.z, velocity.x);
    const backwardAngle = moveAngle + Math.PI;

    for (let i = 0; i < this.poolSize; i++) {
      const p = this.particles[i]!;
      if (p.active) continue;

      p.active = true;
      p.isRipple = true;
      p.floorY = Math.max(0.06, pos.y);
      // Alternate between team ink and white froth
      p.baseColor.setHex(Math.random() < 0.35 ? 0xffffff : colorHex);

      p.position.set(
        pos.x + (Math.random() - 0.5) * 0.3,
        p.floorY + 0.03,
        pos.z + (Math.random() - 0.5) * 0.3
      );

      const scale = 0.16 * (0.8 + Math.random() * 0.5);
      p.initialScale = scale;
      p.scale.set(scale * 1.5, scale * 0.2, scale * 1.5); // flat disc ripple

      const spread = (Math.random() - 0.5) * 1.2;
      const spd = 0.6 + Math.random() * 1.0;
      const vx = Math.cos(backwardAngle + spread) * spd;
      const vz = Math.sin(backwardAngle + spread) * spd;

      p.velocity.set(vx, 0, vz);
      p.gravity = 0;
      p.maxLife = 0.28 + Math.random() * 0.15;
      p.life = p.maxLife;
      p.bounces = 0;

      this.dummyMatrix.compose(p.position, this.dummyQuat, p.scale);
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
      this.instancedMesh.setColorAt(i, p.baseColor);

      spawned++;
      if (spawned >= count) break;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Spawns radiant hit-confirm visual sparks & ink bursts upon hitting an enemy player.
   */
  spawnHitConfirm(pos: Vec3, isKill = false, team?: Team): void {
    let spawned = 0;
    const count = this.scaled(isKill ? 26 : 10);
    const speed = isKill ? 14.0 : 9.5;

    for (let i = 0; i < this.poolSize; i++) {
      const p = this.particles[i]!;
      if (p.active) continue;

      p.active = true;
      p.isRipple = false;
      p.floorY = Math.max(0.06, pos.y);
      // Electric golden sparks, white hot flashes, or team splashes
      const roll = Math.random();
      if (roll < 0.5) {
        p.baseColor.setHex(0xffea00); // Electric gold
      } else if (roll < 0.8) {
        p.baseColor.setHex(0xffffff); // White-hot spark
      } else {
        p.baseColor.setHex(team === Team.CYAN ? 0x00ffff : 0xff007f);
      }

      p.position.set(pos.x, Math.max(0.15, pos.y), pos.z);
      const scale = (isKill ? 0.22 : 0.14) * (0.7 + Math.random() * 0.6);
      p.initialScale = scale;
      p.scale.set(scale, scale, scale);

      // High-velocity omnidirectional spherical explosion
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const spd = speed * (0.6 + Math.random() * 0.8);

      p.velocity.set(
        Math.cos(theta) * Math.sin(phi) * spd,
        Math.cos(phi) * spd + 1.2,
        Math.sin(theta) * Math.sin(phi) * spd
      );

      p.gravity = 14.0;
      p.maxLife = (isKill ? 0.35 : 0.22) + Math.random() * 0.12;
      p.life = p.maxLife;
      p.bounces = 0;

      this.dummyMatrix.compose(p.position, this.dummyQuat, p.scale);
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
      this.instancedMesh.setColorAt(i, p.baseColor);

      spawned++;
      if (spawned >= count) break;
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  update(dt: number): void {
    let hasActive = false;

    for (let i = 0; i < this.poolSize; i++) {
      const p = this.particles[i]!;
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.scale.set(0, 0, 0);
        this.dummyMatrix.makeScale(0, 0, 0);
        this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
        hasActive = true;
        continue;
      }

      hasActive = true;

      const progress = Math.max(0, p.life / p.maxLife);

      if (p.isRipple) {
        // Expand horizontally on the surface plane and gently glide backward
        p.position.x += p.velocity.x * dt;
        p.position.z += p.velocity.z * dt;
        p.velocity.x *= 0.94;
        p.velocity.z *= 0.94;
        p.position.y = p.floorY + 0.03;

        // Expand horizontal disc while keeping flat
        const expand = p.initialScale * (1.1 + (1.0 - progress) * 1.6);
        p.scale.set(expand * 1.5, p.initialScale * 0.18, expand * 1.5);
      } else {
        // Physics integration
        p.velocity.y -= p.gravity * dt;
        p.position.x += p.velocity.x * dt;
        p.position.y += p.velocity.y * dt;
        p.position.z += p.velocity.z * dt;

        const floor = p.floorY ?? 0.06;
        // Ground / platform hit check
        if (p.position.y <= floor) {
          p.position.y = floor;
          if (p.bounces < 1 && p.velocity.y < -1.5) {
            p.velocity.y = -p.velocity.y * 0.35;
            p.velocity.x *= 0.6;
            p.velocity.z *= 0.6;
            p.bounces++;
          } else {
            p.velocity.set(0, 0, 0);
            // Splat flatten into a ground puddle droplet
            p.scale.set(p.initialScale * 1.5, p.initialScale * 0.25, p.initialScale * 1.5);
          }
        } else {
          // In-air particle shrink
          const currentScale = p.initialScale * (0.4 + progress * 0.6);
          p.scale.set(currentScale, currentScale, currentScale);
        }
      }

      // Update color luminance to simulate fade
      this.dummyColor.copy(p.baseColor).multiplyScalar(Math.max(0.1, progress));
      this.instancedMesh.setColorAt(i, this.dummyColor);

      this.dummyMatrix.compose(p.position, this.dummyQuat, p.scale);
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);
    }

    if (hasActive) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      if (this.instancedMesh.instanceColor) {
        this.instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.sharedGeo.dispose();
    this.sharedMat.dispose();
    this.instancedMesh.dispose();
    this.particles = [];
  }
}
