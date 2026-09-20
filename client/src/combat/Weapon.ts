import * as THREE from 'three';
import { SpecialEventPayload, SubWeaponEventPayload, Team, Vec3, WeaponType } from '@ink/shared';

interface ActiveTracer {
  line: THREE.Line;
  startTime: number;
  duration: number;
  baseOpacity: number;
}

interface ActiveLaserBeam {
  mesh: THREE.Mesh;
  startTime: number;
  duration: number;
}

interface VisualSubWeapon {
  id: string;
  mesh: THREE.Group;
  velocity: Vec3;
  type: string;
  isGrounded: boolean;
}

interface VisualSpecial {
  id: string;
  type: string;
  group: THREE.Group;
  startTime: number;
  duration: number;
  direction?: Vec3;
}

interface VisualExplosion {
  mesh: THREE.Mesh;
  ring?: THREE.Mesh;
  startTime: number;
  duration: number;
  targetScale: number;
}

/** One ink droplet in a pooled splash burst. */
interface InkDroplet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  startTime: number;
  duration: number;
  scale: number;
}

/**
 * Team-coloured ink palette. Fresh ink reads glossy (bright, high opacity) at
 * the core and darker at the rim, which is what makes the wet look work.
 */
const TEAM_INK = {
  [Team.PINK]: { core: 0xff007f, gloss: 0xff8ad0, dark: 0x8a0044 },
  [Team.CYAN]: { core: 0x00ffff, gloss: 0xa8ffff, dark: 0x007a80 },
  [Team.NEUTRAL]: { core: 0x9aa0a8, gloss: 0xcfd4da, dark: 0x4a4f55 }
} as const;

export class VisualWeapon {
  readonly group = new THREE.Group();
  private poolSize = 64;
  private tracerPool: THREE.Line[] = [];
  private activeTracers: ActiveTracer[] = [];

  private laserMeshPool: THREE.Mesh[] = [];
  private activeLasers: ActiveLaserBeam[] = [];

  private visualSubWeapons = new Map<string, VisualSubWeapon>();
  private visualSpecials = new Map<string, VisualSpecial>();
  private visualExplosions: VisualExplosion[] = [];
  private sharedExplosionGeo = new THREE.SphereGeometry(1, 14, 14);
  private sharedRingGeo = new THREE.TorusGeometry(1, 0.08, 8, 32);
  private sharedDropletGeo = new THREE.SphereGeometry(1, 7, 6);

  /** Pooled ink droplets shared by splashes, detonations and special bursts. */
  private dropletPool: THREE.Mesh[] = [];
  private activeDroplets: InkDroplet[] = [];
  private readonly dropletPoolSize = 220;

  // Scratch vectors for beam orientation; hoisted so firing allocates nothing.
  private readonly beamUp = new THREE.Vector3(0, 1, 0);
  private readonly beamDir = new THREE.Vector3();

  constructor() {
    this.createPool();
  }

  private createPool(): void {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(6);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    for (let i = 0; i < this.poolSize; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 3,
        transparent: true,
        opacity: 0.9
      });
      const line = new THREE.Line(geo.clone(), mat);
      line.visible = false;
      this.tracerPool.push(line);
      this.group.add(line);
    }

    // Charger laser beam pool (cylinder meshes)
    for (let i = 0; i < 16; i++) {
      const cylGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 8);
      const cylMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9
      });
      const mesh = new THREE.Mesh(cylGeo, cylMat);
      mesh.visible = false;
      this.laserMeshPool.push(mesh);
      this.group.add(mesh);
    }

    for (let i = 0; i < this.dropletPoolSize; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.18,
        metalness: 0.05,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(this.sharedDropletGeo, mat);
      mesh.visible = false;
      this.dropletPool.push(mesh);
      this.group.add(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // Tracers & beams
  // -------------------------------------------------------------------------

  spawnTracer(start: Vec3, end: Vec3, team: Team, weaponType: WeaponType = 'shooter', chargeLevel = 1.0): void {
    const ink = TEAM_INK[team] ?? TEAM_INK[Team.NEUTRAL];

    if (weaponType === 'charger') {
      this.spawnChargerBeam(start, end, ink.core, chargeLevel);
      this.spawnImpactSplash(end, team, 1.6, 4);
      return;
    }

    // Muzzle bloom at the origin so the shot reads as leaving the barrel.
    this.spawnImpactSplash(start, team, 0.5, 2);

    // Lobbed / explosive weapons arc through the air rather than drawing a ray.
    if (weaponType === 'slosher' || weaponType === 'cannon') {
      this.spawnInkArc(start, end, team, weaponType === 'cannon' ? 1.5 : 1.15);
      this.spawnImpactSplash(end, team, weaponType === 'cannon' ? 2.6 : 2.0, weaponType === 'cannon' ? 9 : 7);
      return;
    }

    // Pellet weapons draw a fan of short streaks instead of one clean line.
    if (weaponType === 'scatter') {
      for (let i = 0; i < 3; i++) {
        const jitter = (i - 1) * 0.09;
        this.spawnTracerLine(
          start,
          {
            x: end.x + jitter * 4,
            y: end.y + jitter * 2,
            z: end.z + jitter * 4
          },
          ink.core,
          110,
          0.55
        );
      }
      this.spawnImpactSplash(end, team, 1.4, 5);
      return;
    }

    // Main tracer: a bright core line plus a wider, dimmer "volume" line.
    const duration = weaponType === 'sprayer' ? 55 : weaponType === 'marksman' ? 110 : 90;
    this.spawnTracerLine(start, end, ink.gloss, duration, 0.45);
    this.spawnTracerLine(start, end, ink.core, duration, 0.95);

    this.spawnImpactSplash(end, team, weaponType === 'marksman' ? 1.7 : 1.2, 4);
  }

  private spawnTracerLine(start: Vec3, end: Vec3, color: number, duration: number, opacity: number): void {
    const line = this.tracerPool.pop();
    if (!line) return;

    const mat = line.material as THREE.LineBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = opacity;

    const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, start.x, start.y, start.z);
    posAttr.setXYZ(1, end.x, end.y, end.z);
    posAttr.needsUpdate = true;

    line.visible = true;

    this.activeTracers.push({
      line,
      startTime: performance.now(),
      duration,
      baseOpacity: opacity
    });
  }

  /**
   * Draws a short dotted arc between a lobbed weapon's muzzle and its impact
   * point, so the ink reads as travelling through the air with volume.
   */
  private spawnInkArc(start: Vec3, end: Vec3, team: Team, scale: number): void {
    const ink = TEAM_INK[team] ?? TEAM_INK[Team.NEUTRAL];
    const steps = 7;
    const now = performance.now();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      // Parabolic lift peaks mid-flight
      const y = start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * 2.4 * scale;

      const line = this.tracerPool.pop();
      if (!line) return;
      const mat = line.material as THREE.LineBasicMaterial;
      mat.color.setHex(i % 2 === 0 ? ink.core : ink.gloss);
      mat.opacity = 0.85 * (1 - t * 0.5);
      const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, x, y, z);
      posAttr.setXYZ(1, x, y + 0.28 * scale, z);
      posAttr.needsUpdate = true;
      line.visible = true;
      this.activeTracers.push({ line, startTime: now, duration: 200, baseOpacity: 0.85 * (1 - t * 0.5) });
    }
  }

  private spawnChargerBeam(start: Vec3, end: Vec3, color: number, charge: number): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    // Outer glow sheath
    this.spawnBeamMesh(start, end, dx, dy, dz, len, color, charge * 2.6, 0.28, 200);
    // Bright core
    this.spawnBeamMesh(start, end, dx, dy, dz, len, 0xffffff, charge * 1.1, 0.95, 190);
  }

  private spawnBeamMesh(
    start: Vec3,
    end: Vec3,
    dx: number,
    dy: number,
    dz: number,
    len: number,
    color: number,
    radiusScale: number,
    opacity: number,
    duration: number
  ): void {
    const mesh = this.laserMeshPool.pop();
    if (!mesh) return;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = opacity;

    mesh.position.set(start.x + dx * 0.5, start.y + dy * 0.5, start.z + dz * 0.5);
    mesh.scale.set(radiusScale, len, radiusScale);
    this.beamDir.set(dx / len, dy / len, dz / len);
    mesh.quaternion.setFromUnitVectors(this.beamUp, this.beamDir);
    mesh.visible = true;

    this.activeLasers.push({
      mesh,
      startTime: performance.now(),
      duration
    });
  }

  // -------------------------------------------------------------------------
  // Sub weapons
  // -------------------------------------------------------------------------

  spawnSubWeapon(event: SubWeaponEventPayload): void {
    const ink = TEAM_INK[event.team] ?? TEAM_INK[Team.NEUTRAL];
    const group = new THREE.Group();
    group.position.set(event.position.x, event.position.y, event.position.z);

    const shellMat = new THREE.MeshStandardMaterial({ color: ink.core, roughness: 0.22, metalness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e1e24, roughness: 0.6 });
    const glossMat = new THREE.MeshBasicMaterial({ color: ink.gloss });

    switch (event.type) {
      case 'curling_bomb': {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 16), shellMat);
        group.add(disc);

        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 6, 18), darkMat);
        stripe.rotation.x = Math.PI / 2;
        group.add(stripe);

        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 14, Math.PI), darkMat);
        handle.position.y = 0.1;
        group.add(handle);
        break;
      }
      case 'burst_bomb': {
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), shellMat));

        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 8), darkMat);
        cap.position.y = 0.24;
        group.add(cap);

        const pip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), glossMat);
        pip.position.y = 0.33;
        group.add(pip);
        break;
      }
      case 'ink_mine': {
        // Squat drum with three arming prongs and a blinking tell-tale light.
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.24, 14), shellMat);
        group.add(body);

        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 6, 16), darkMat);
        collar.rotation.x = Math.PI / 2;
        collar.position.y = 0.12;
        group.add(collar);

        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6), darkMat);
          prong.position.set(Math.cos(a) * 0.22, 0.16, Math.sin(a) * 0.22);
          prong.rotation.z = Math.cos(a) * 0.3;
          prong.rotation.x = -Math.sin(a) * 0.3;
          group.add(prong);
        }

        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), glossMat);
        lamp.position.y = 0.15;
        group.add(lamp);
        break;
      }
      case 'bounce_bomb': {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), shellMat);
        group.add(ball);

        // Equatorial band makes the spin readable in flight.
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.035, 6, 20), darkMat);
        band.rotation.x = Math.PI / 2;
        group.add(band);

        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), glossMat);
        knob.position.y = 0.26;
        group.add(knob);
        break;
      }
      case 'ink_puddle': {
        // Sealed sack that flattens into the pool on impact.
        const sack = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), shellMat);
        sack.scale.set(1, 0.8, 1);
        group.add(sack);

        const neck = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 6, 14), darkMat);
        neck.position.y = 0.2;
        neck.rotation.x = Math.PI / 2;
        group.add(neck);

        const drip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), glossMat);
        drip.position.set(0, -0.2, 0);
        group.add(drip);
        break;
      }
      default: {
        // Splat bomb: tetrahedral shell with a lit fuse.
        group.add(new THREE.Mesh(new THREE.TetrahedronGeometry(0.3), shellMat));

        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), darkMat);
        fuse.position.y = 0.24;
        group.add(fuse);

        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), glossMat);
        tip.position.y = 0.33;
        group.add(tip);
        break;
      }
    }

    this.group.add(group);
    this.visualSubWeapons.set(event.id, {
      id: event.id,
      mesh: group,
      velocity: event.velocity ? { ...event.velocity } : { x: 0, y: 0, z: 0 },
      type: event.type,
      isGrounded: false
    });
  }

  explodeSubWeapon(id: string, pos: Vec3, radius = 4.0, team: Team = Team.PINK): void {
    const sub = this.visualSubWeapons.get(id);
    if (sub) {
      this.group.remove(sub.mesh);
      this.disposeGroup(sub.mesh);
      this.visualSubWeapons.delete(id);
    }
    this.spawnExplosion(pos, radius, team);
  }

  // -------------------------------------------------------------------------
  // Explosions & splashes
  // -------------------------------------------------------------------------

  /**
   * Layered detonation: white core flash, team ink burst, ground shockwave ring
   * and a spray of droplets that land inside the blast radius.
   */
  spawnExplosion(pos: Vec3, radius: number, team: Team): void {
    const ink = TEAM_INK[team] ?? TEAM_INK[Team.NEUTRAL];
    const groundY = Math.max(0.5, pos.y);

    // 1. Hot core flash
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    const core = new THREE.Mesh(this.sharedExplosionGeo, coreMat);
    core.position.set(pos.x, groundY, pos.z);
    core.scale.setScalar(0.2);
    this.group.add(core);

    // 2. Team ink volume, slightly larger and slower to fade
    const inkMat = new THREE.MeshBasicMaterial({
      color: ink.core,
      transparent: true,
      opacity: 0.8
    });
    const shell = new THREE.Mesh(this.sharedExplosionGeo, inkMat);
    shell.position.set(pos.x, groundY, pos.z);
    shell.scale.setScalar(0.2);
    this.group.add(shell);

    // 3. Ground shockwave ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: ink.gloss,
      transparent: true,
      opacity: 0.8
    });
    const ring = new THREE.Mesh(this.sharedRingGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.12, pos.z);
    this.group.add(ring);

    this.visualExplosions.push({
      mesh: core,
      ring,
      startTime: performance.now(),
      duration: 350,
      targetScale: radius
    });
    // The ink shell rides in the same list with its own mesh identity.
    this.visualExplosions.push({
      mesh: shell,
      startTime: performance.now(),
      duration: 480,
      targetScale: radius * 1.15
    });

    // 4. Lingering droplets that arc out and land inside the blast
    this.spawnDroplets(pos, team, Math.min(18, 6 + Math.round(radius * 2)), radius * 0.55, 1.6);
  }

  /**
   * Spawns pooled ink droplets radiating from a point. Droplets inherit a
   * ballistic arc and land on the ground plane, so splashes settle naturally.
   */
  private spawnDroplets(
    pos: Vec3,
    team: Team,
    count: number,
    speed: number,
    scale: number
  ): void {
    const ink = TEAM_INK[team] ?? TEAM_INK[Team.NEUTRAL];
    const now = performance.now();
    let spawned = 0;

    for (const mesh of this.dropletPool) {
      if (spawned >= count) break;
      if (mesh.visible) continue;

      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(spawned % 3 === 0 ? ink.gloss : ink.core);
      mat.opacity = 0.95;

      const size = scale * (0.06 + Math.random() * 0.08);
      mesh.position.set(pos.x, Math.max(0.15, pos.y), pos.z);
      mesh.scale.setScalar(size);
      mesh.visible = true;

      const ang = Math.random() * Math.PI * 2;
      const up = 2.5 + Math.random() * 3.5;
      const out = speed * (0.4 + Math.random() * 0.8);
      this.activeDroplets.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(ang) * out, up, Math.sin(ang) * out),
        startTime: now,
        duration: 480 + Math.random() * 320,
        scale: size
      });
      spawned++;
    }
  }

  /** Small impact splash used by hitscan weapons when a tracer lands. */
  private spawnImpactSplash(pos: Vec3, team: Team, scale: number, count: number): void {
    this.spawnDroplets(pos, team, count, 2.6 * scale, scale);
  }

  // -------------------------------------------------------------------------
  // Specials
  // -------------------------------------------------------------------------

  spawnSpecial(event: SpecialEventPayload): void {
    const ink = TEAM_INK[event.team] ?? TEAM_INK[Team.NEUTRAL];
    const group = new THREE.Group();
    group.position.set(event.position.x, 0, event.position.z);

    const coreMat = new THREE.MeshBasicMaterial({
      color: ink.core,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide
    });
    const glossMat = new THREE.MeshBasicMaterial({
      color: ink.gloss,
      transparent: true,
      opacity: 0.55
    });

    switch (event.type) {
      case 'inkstrike': {
        // Tornado vortex
        const tornado = new THREE.Mesh(
          new THREE.CylinderGeometry(5.5, 3.0, 14, 20, 1, true),
          coreMat
        );
        tornado.position.y = 7;
        group.add(tornado);

        const splash = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.1, 24), glossMat);
        splash.position.y = 0.05;
        group.add(splash);

        const swirlGeo = new THREE.TorusGeometry(4.2, 0.25, 8, 28);
        for (const swirlY of [2.5, 5, 7.5]) {
          const swirl = new THREE.Mesh(swirlGeo, glossMat);
          swirl.rotation.x = Math.PI / 2;
          swirl.position.y = swirlY;
          swirl.scale.setScalar(1 - swirlY * 0.07);
          group.add(swirl);
        }
        break;
      }
      case 'ink_storm': {
        // Rain cloud with a dark shell and team-tinted underside
        const cloud = new THREE.Mesh(
          new THREE.SphereGeometry(3.5, 14, 10),
          new THREE.MeshStandardMaterial({
            color: 0x33333e,
            roughness: 0.9,
            transparent: true,
            opacity: 0.82
          })
        );
        cloud.position.y = 6;
        cloud.scale.set(1.4, 0.4, 1.4);
        group.add(cloud);

        const belly = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 8), glossMat);
        belly.position.y = 5.2;
        belly.scale.set(1.3, 0.22, 1.3);
        group.add(belly);

        const dropGeo = new THREE.ConeGeometry(0.12, 0.9, 6);
        for (let i = 0; i < 8; i++) {
          const drop = new THREE.Mesh(dropGeo, glossMat);
          const ang = (i / 8) * Math.PI * 2;
          drop.position.set(Math.cos(ang) * 2.2, 4.2, Math.sin(ang) * 2.2);
          drop.rotation.x = Math.PI;
          group.add(drop);
        }
        break;
      }
      case 'killer_wail': {
        const dirX = event.direction?.x || 0;
        const dirZ = event.direction?.z || 1;
        group.rotation.y = Math.atan2(dirX, dirZ);

        const laserGeo = new THREE.CylinderGeometry(0.8, 0.8, 70, 12);
        for (let i = -1; i <= 1; i++) {
          const laser = new THREE.Mesh(laserGeo, coreMat);
          laser.rotation.x = Math.PI / 2;
          laser.position.set(i * 2.2, 1.2, 35);
          group.add(laser);
        }

        const wailRingGeo = new THREE.TorusGeometry(1.1, 0.15, 8, 20);
        for (let i = -1; i <= 1; i++) {
          const wailRing = new THREE.Mesh(wailRingGeo, glossMat);
          wailRing.position.set(i * 2.2, 1.2, 0);
          group.add(wailRing);
        }
        break;
      }
      case 'ink_nova': {
        // Ground slam: stacked expanding rings plus an upward ink column.
        const slam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.4, 0.6, 22), coreMat);
        slam.position.y = 0.3;
        group.add(slam);

        const column = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.6, 7, 16, 1, true), coreMat);
        column.position.y = 3.5;
        group.add(column);

        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 8, 30), glossMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.15 + i * 0.25;
          ring.scale.setScalar(1.4 + i * 1.5);
          group.add(ring);
        }
        break;
      }
      case 'ink_barrier': {
        // Translucent dome over the team, with a rim ring on the floor.
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(5.5, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({
            color: ink.core,
            transparent: true,
            opacity: 0.24,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        group.add(dome);

        const rim = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.12, 8, 34), glossMat);
        rim.rotation.x = -Math.PI / 2;
        rim.position.y = 0.1;
        group.add(rim);

        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const rib = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.045, 6, 24, Math.PI / 2), glossMat);
          rib.position.y = 0;
          rib.rotation.y = a;
          group.add(rib);
        }
        break;
      }
      default:
        break;
    }

    this.group.add(group);
    this.visualSpecials.set(event.id, {
      id: event.id,
      type: event.type,
      group,
      startTime: performance.now(),
      duration: (event.duration || 4.0) * 1000,
      direction: event.direction
    });
  }

  endSpecial(id: string): void {
    const sp = this.visualSpecials.get(id);
    if (sp) {
      this.group.remove(sp.group);
      this.disposeGroup(sp.group);
      this.visualSpecials.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(dt: number = 0.016): void {
    const now = performance.now();

    // 1. Tracers
    for (let i = this.activeTracers.length - 1; i >= 0; i--) {
      const tracer = this.activeTracers[i]!;
      const elapsed = now - tracer.startTime;
      if (elapsed >= tracer.duration) {
        tracer.line.visible = false;
        this.tracerPool.push(tracer.line);
        this.activeTracers.splice(i, 1);
      } else {
        const fade = 1 - elapsed / tracer.duration;
        (tracer.line.material as THREE.LineBasicMaterial).opacity = fade * tracer.baseOpacity;
      }
    }

    // 2. Charger Lasers
    for (let i = this.activeLasers.length - 1; i >= 0; i--) {
      const laser = this.activeLasers[i]!;
      const elapsed = now - laser.startTime;
      if (elapsed >= laser.duration) {
        laser.mesh.visible = false;
        this.laserMeshPool.push(laser.mesh);
        this.activeLasers.splice(i, 1);
      } else {
        const fade = 1 - elapsed / laser.duration;
        (laser.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.95;
      }
    }

    // 3. Explosions (core flash + ink shell + ring)
    for (let i = this.visualExplosions.length - 1; i >= 0; i--) {
      const exp = this.visualExplosions[i]!;
      const elapsed = now - exp.startTime;
      if (elapsed >= exp.duration) {
        this.group.remove(exp.mesh);
        (exp.mesh.material as THREE.Material).dispose();
        if (exp.ring) {
          this.group.remove(exp.ring);
          (exp.ring.material as THREE.Material).dispose();
        }
        this.visualExplosions.splice(i, 1);
      } else {
        const progress = elapsed / exp.duration;
        const currentScale = exp.targetScale * Math.sin(progress * Math.PI * 0.5);
        exp.mesh.scale.set(currentScale, currentScale, currentScale);
        (exp.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
        if (exp.ring) {
          const ringScale = Math.max(0.2, currentScale * 1.4);
          exp.ring.scale.set(ringScale, ringScale, 1);
          (exp.ring.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.75;
        }
      }
    }

    // 3b. Ink droplets
    for (let i = this.activeDroplets.length - 1; i >= 0; i--) {
      const drop = this.activeDroplets[i]!;
      const elapsed = now - drop.startTime;
      if (elapsed >= drop.duration) {
        drop.mesh.visible = false;
        this.activeDroplets.splice(i, 1);
        continue;
      }

      const step = dt;
      drop.velocity.y -= 22 * step;
      drop.mesh.position.x += drop.velocity.x * step;
      drop.mesh.position.y += drop.velocity.y * step;
      drop.mesh.position.z += drop.velocity.z * step;

      if (drop.mesh.position.y <= 0.02) {
        // Flatten into a wet pancake on landing and fade quickly.
        drop.mesh.position.y = 0.02;
        drop.velocity.set(0, 0, 0);
        const spread = drop.scale * 1.9;
        drop.mesh.scale.set(spread, drop.scale * 0.25, spread);
      }

      const fade = 1 - elapsed / drop.duration;
      (drop.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(1, fade * 1.4);
    }

    // 4. Sub-weapons in flight
    for (const sub of this.visualSubWeapons.values()) {
      if (sub.type === 'curling_bomb') {
        sub.mesh.position.x += sub.velocity.x * dt;
        sub.mesh.position.z += sub.velocity.z * dt;
        sub.mesh.rotation.y += 3.0 * dt;
      } else if (sub.type === 'ink_mine' || sub.type === 'ink_puddle') {
        if (!sub.isGrounded) {
          sub.velocity.y -= 20.0 * dt;
          sub.mesh.position.x += sub.velocity.x * dt;
          sub.mesh.position.y += sub.velocity.y * dt;
          sub.mesh.position.z += sub.velocity.z * dt;
          sub.mesh.rotation.y += 2.0 * dt;

          if (sub.mesh.position.y <= 0) {
            sub.mesh.position.y = 0;
            sub.isGrounded = true;
            sub.velocity.x = 0;
            sub.velocity.y = 0;
            sub.velocity.z = 0;
          }
        } else if (sub.type === 'ink_puddle') {
          // Pooled deployable settles into a flat puddle.
          sub.mesh.scale.x = THREE.MathUtils.lerp(sub.mesh.scale.x, 1.6, 0.08);
          sub.mesh.scale.z = THREE.MathUtils.lerp(sub.mesh.scale.z, 1.6, 0.08);
          sub.mesh.scale.y = THREE.MathUtils.lerp(sub.mesh.scale.y, 0.25, 0.08);
        }
      } else {
        sub.velocity.y -= 20.0 * dt;
        sub.mesh.position.x += sub.velocity.x * dt;
        sub.mesh.position.y += sub.velocity.y * dt;
        sub.mesh.position.z += sub.velocity.z * dt;
        sub.mesh.rotation.x += 6.0 * dt;
        sub.mesh.rotation.z += 6.0 * dt;

        if (sub.mesh.position.y <= 0) {
          sub.mesh.position.y = 0;
          sub.velocity.y = -sub.velocity.y * 0.35;
          sub.velocity.x *= 0.6;
          sub.velocity.z *= 0.6;
        }
      }
    }

    // 5. Specials
    for (const [id, spec] of this.visualSpecials.entries()) {
      const elapsed = now - spec.startTime;
      if (elapsed >= spec.duration) {
        this.endSpecial(id);
      } else {
        const progress = elapsed / spec.duration;
        if (spec.type === 'inkstrike') {
          spec.group.rotation.y += 5.0 * dt;
        } else if (spec.type === 'ink_storm' && spec.direction) {
          spec.group.position.x += spec.direction.x * 4.0 * dt;
          spec.group.position.z += spec.direction.z * 4.0 * dt;
        } else if (spec.type === 'ink_nova') {
          // Rings keep expanding outward for the whole duration.
          spec.group.children.forEach((child, idx) => {
            const ring = child as THREE.Mesh;
            if (!ring.geometry || !(ring.geometry as THREE.TorusGeometry).parameters) return;
            const target = 1.6 + progress * 6.5 + idx * 0.4;
            ring.scale.setScalar(target);
          });
        } else if (spec.type === 'ink_barrier') {
          spec.group.rotation.y += 0.6 * dt;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  private disposeGroup(group: THREE.Object3D): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }

  dispose(): void {
    for (const tracer of this.tracerPool) {
      tracer.geometry.dispose();
      (tracer.material as THREE.Material).dispose();
    }
    for (const laser of this.laserMeshPool) {
      laser.geometry.dispose();
      (laser.material as THREE.Material).dispose();
    }
    for (const exp of this.visualExplosions) {
      this.group.remove(exp.mesh);
      (exp.mesh.material as THREE.Material).dispose();
      if (exp.ring) {
        this.group.remove(exp.ring);
        (exp.ring.material as THREE.Material).dispose();
      }
    }
    this.visualExplosions.length = 0;
    for (const drop of this.activeDroplets) {
      this.group.remove(drop.mesh);
      (drop.mesh.material as THREE.Material).dispose();
    }
    this.activeDroplets.length = 0;
    for (const drop of this.dropletPool) {
      this.group.remove(drop);
      (drop.material as THREE.Material).dispose();
    }
    this.dropletPool.length = 0;
    this.sharedExplosionGeo.dispose();
    this.sharedRingGeo.dispose();
    this.sharedDropletGeo.dispose();
    for (const sub of this.visualSubWeapons.values()) {
      this.group.remove(sub.mesh);
      this.disposeGroup(sub.mesh);
    }
    this.visualSubWeapons.clear();
    for (const sp of this.visualSpecials.values()) {
      this.group.remove(sp.group);
      this.disposeGroup(sp.group);
    }
    this.visualSpecials.clear();
  }
}
