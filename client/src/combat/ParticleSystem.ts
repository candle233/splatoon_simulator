import * as THREE from 'three';
import { Team, Vec3 } from '@ink/shared';

interface Particle {
  mesh: THREE.Mesh;
  active: boolean;
  velocity: THREE.Vector3;
  gravity: number;
  life: number;
  maxLife: number;
  initialScale: number;
  bounces: number;
}

export class ParticleSystem {
  readonly group = new THREE.Group();
  private poolSize = 160;
  private particles: Particle[] = [];
  private sharedGeo = new THREE.SphereGeometry(1, 8, 8);
  /** 0..1 multiplier on spawn counts (graphics quality setting). */
  private densityScale = 1;

  constructor() {
    this.initPool();
  }

  setDensityScale(scale: number): void {
    this.densityScale = Math.max(0.25, Math.min(1, scale));
  }

  private scaled(count: number): number {
    return Math.max(1, Math.round(count * this.densityScale));
  }

  private initPool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(this.sharedGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);

      this.particles.push({
        mesh,
        active: false,
        velocity: new THREE.Vector3(),
        gravity: 18.0,
        life: 0,
        maxLife: 0.4,
        initialScale: 0.12,
        bounces: 0
      });
    }
  }

  /**
   * Spawns an explosive burst of ink droplets radiating from a point (e.g., bullet hit, bomb hit).
   */
  spawnSplash(pos: Vec3, team: Team, count = 8, speed = 7.0, baseRadius = 0.14): void {
    const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    let spawned = 0;
    count = this.scaled(count);

    for (const p of this.particles) {
      if (p.active) continue;

      p.active = true;
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshStandardMaterial).color.setHex(colorHex);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.95;

      p.mesh.position.set(pos.x, Math.max(0.1, pos.y), pos.z);
      const scale = baseRadius * (0.7 + Math.random() * 0.6);
      p.initialScale = scale;
      p.mesh.scale.set(scale, scale, scale);

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

      spawned++;
      if (spawned >= count) break;
    }
  }

  /**
   * Spawns small muzzle spray droplets shooting forward from the weapon.
   */
  spawnMuzzleSpray(muzzlePos: Vec3, forwardDir: Vec3, team: Team, count = 3): void {
    const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    let spawned = 0;
    count = this.scaled(count);

    for (const p of this.particles) {
      if (p.active) continue;

      p.active = true;
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshStandardMaterial).color.setHex(colorHex);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.9;

      p.mesh.position.set(muzzlePos.x, muzzlePos.y, muzzlePos.z);
      const scale = 0.08 * (0.8 + Math.random() * 0.5);
      p.initialScale = scale;
      p.mesh.scale.set(scale, scale, scale);

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

      spawned++;
      if (spawned >= count) break;
    }
  }

  update(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      // Physics integration
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;

      // Ground hit check (at y = 0.06)
      if (p.mesh.position.y <= 0.06) {
        p.mesh.position.y = 0.06;
        if (p.bounces < 1 && p.velocity.y < -1.5) {
          p.velocity.y = -p.velocity.y * 0.35;
          p.velocity.x *= 0.6;
          p.velocity.z *= 0.6;
          p.bounces++;
        } else {
          p.velocity.set(0, 0, 0);
          // Splat flatten into a ground puddle droplet
          p.mesh.scale.set(p.initialScale * 1.5, p.initialScale * 0.25, p.initialScale * 1.5);
        }
      }

      // Fade out and shrink towards end of life
      const progress = p.life / p.maxLife;
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, progress * 0.95);
      if (p.mesh.position.y > 0.08) {
        const currentScale = p.initialScale * (0.4 + progress * 0.6);
        p.mesh.scale.set(currentScale, currentScale, currentScale);
      }
    }
  }

  dispose(): void {
    this.sharedGeo.dispose();
    for (const p of this.particles) {
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
  }
}
