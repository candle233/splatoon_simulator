import * as THREE from 'three';
import { SpecialEventPayload, SubWeaponEventPayload, Team, Vec3, WeaponType } from '@ink/shared';

interface ActiveTracer {
  line: THREE.Line;
  startTime: number;
  duration: number;
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
  }

  spawnTracer(start: Vec3, end: Vec3, team: Team, weaponType: WeaponType = 'shooter', chargeLevel = 1.0): void {
    const color = team === Team.PINK ? 0xff007f : 0x00ffff;

    if (weaponType === 'charger') {
      this.spawnChargerBeam(start, end, color, chargeLevel);
      return;
    }

    const line = this.tracerPool.pop();
    if (!line) return;

    (line.material as THREE.LineBasicMaterial).color.setHex(color);
    (line.material as THREE.LineBasicMaterial).opacity = 0.9;

    const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, start.x, start.y, start.z);
    posAttr.setXYZ(1, end.x, end.y, end.z);
    posAttr.needsUpdate = true;

    line.visible = true;

    this.activeTracers.push({
      line,
      startTime: performance.now(),
      duration: weaponType === 'slosher' ? 140 : 80
    });
  }

  private spawnChargerBeam(start: Vec3, end: Vec3, color: number, charge: number): void {
    const mesh = this.laserMeshPool.pop();
    if (!mesh) return;

    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

    mesh.position.set(start.x + dx * 0.5, start.y + dy * 0.5, start.z + dz * 0.5);
    mesh.scale.set(charge * 1.5, len, charge * 1.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    mesh.visible = true;

    this.activeLasers.push({
      mesh,
      startTime: performance.now(),
      duration: 180
    });
  }

  spawnSubWeapon(event: SubWeaponEventPayload): void {
    const colorHex = event.team === Team.PINK ? 0xff007f : 0x00ffff;
    const group = new THREE.Group();
    group.position.set(event.position.x, event.position.y, event.position.z);

    if (event.type === 'curling_bomb') {
      const discGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.18, 16);
      const discMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.2, metalness: 0.5 });
      const disc = new THREE.Mesh(discGeo, discMat);
      group.add(disc);

      // Encircling stripe + top carry handle
      const curlStripeGeo = new THREE.TorusGeometry(0.36, 0.03, 6, 18);
      const curlStripeMat = new THREE.MeshStandardMaterial({ color: 0x1e1e24, roughness: 0.6 });
      const curlStripe = new THREE.Mesh(curlStripeGeo, curlStripeMat);
      curlStripe.rotation.x = Math.PI / 2;
      group.add(curlStripe);

      const curlHandleGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 14, Math.PI);
      const curlHandle = new THREE.Mesh(curlHandleGeo, curlStripeMat);
      curlHandle.position.y = 0.1;
      group.add(curlHandle);
    } else if (event.type === 'burst_bomb') {
      const sphereGeo = new THREE.SphereGeometry(0.22, 12, 12);
      const sphereMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3 });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      group.add(sphere);

      // Spike cap on top
      const burstCapGeo = new THREE.ConeGeometry(0.08, 0.14, 8);
      const burstCapMat = new THREE.MeshStandardMaterial({ color: 0x1e1e24, roughness: 0.6 });
      const burstCap = new THREE.Mesh(burstCapGeo, burstCapMat);
      burstCap.position.y = 0.24;
      group.add(burstCap);
    } else {
      // Splat bomb
      const pyrGeo = new THREE.TetrahedronGeometry(0.3);
      const pyrMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3 });
      const pyr = new THREE.Mesh(pyrGeo, pyrMat);
      group.add(pyr);

      // Fuse + glowing tip
      const splatFuseGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6);
      const splatFuseMat = new THREE.MeshStandardMaterial({ color: 0x1e1e24, roughness: 0.6 });
      const splatFuse = new THREE.Mesh(splatFuseGeo, splatFuseMat);
      splatFuse.position.y = 0.24;
      group.add(splatFuse);

      const splatTipGeo = new THREE.SphereGeometry(0.035, 6, 6);
      const splatTipMat = new THREE.MeshBasicMaterial({ color: colorHex });
      const splatTip = new THREE.Mesh(splatTipGeo, splatTipMat);
      splatTip.position.y = 0.33;
      group.add(splatTip);
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
      sub.mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      this.visualSubWeapons.delete(id);
    }
    this.spawnExplosion(pos, radius, team);
  }

  spawnExplosion(pos: Vec3, radius: number, team: Team): void {
    const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    const sphereMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(this.sharedExplosionGeo, sphereMat);
    mesh.position.set(pos.x, Math.max(0.5, pos.y), pos.z);
    mesh.scale.set(0.2, 0.2, 0.2);
    this.group.add(mesh);

    // Ground shockwave ring
    const ringGeo = new THREE.TorusGeometry(1, 0.08, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.12, pos.z);
    this.group.add(ring);

    this.visualExplosions.push({
      mesh,
      ring,
      startTime: performance.now(),
      duration: 350,
      targetScale: radius
    });
  }

  spawnSpecial(event: SpecialEventPayload): void {
    const colorHex = event.team === Team.PINK ? 0xff007f : 0x00ffff;
    const group = new THREE.Group();
    group.position.set(event.position.x, 0, event.position.z);

    if (event.type === 'inkstrike') {
      // Tornado vortex cylinder
      const cylGeo = new THREE.CylinderGeometry(5.5, 3.0, 14, 20, 1, true);
      const cylMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide
      });
      const tornado = new THREE.Mesh(cylGeo, cylMat);
      tornado.position.y = 7;
      group.add(tornado);

      // Ground splash disc
      const splashGeo = new THREE.CylinderGeometry(5.5, 5.5, 0.1, 24);
      const splashMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.5
      });
      const splash = new THREE.Mesh(splashGeo, splashMat);
      splash.position.y = 0.05;
      group.add(splash);

      // Rotating swirl rings up the funnel
      const swirlGeo = new THREE.TorusGeometry(4.2, 0.25, 8, 28);
      const swirlMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.55
      });
      for (const swirlY of [2.5, 5, 7.5]) {
        const swirl = new THREE.Mesh(swirlGeo, swirlMat);
        swirl.rotation.x = Math.PI / 2;
        swirl.position.y = swirlY;
        swirl.scale.setScalar(1 - swirlY * 0.07);
        group.add(swirl);
      }
    } else if (event.type === 'ink_storm') {
      // Rain cloud
      const cloudGeo = new THREE.SphereGeometry(3.5, 14, 10);
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0x33333e,
        roughness: 0.9,
        transparent: true,
        opacity: 0.8
      });
      const cloud = new THREE.Mesh(cloudGeo, cloudMat);
      cloud.position.y = 6;
      cloud.scale.set(1.4, 0.4, 1.4);
      group.add(cloud);

      // Falling ink streaks
      const dropGeo = new THREE.ConeGeometry(0.12, 0.9, 6);
      const dropMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.75
      });
      for (let i = 0; i < 8; i++) {
        const drop = new THREE.Mesh(dropGeo, dropMat);
        const ang = (i / 8) * Math.PI * 2;
        drop.position.set(Math.cos(ang) * 2.2, 4.2, Math.sin(ang) * 2.2);
        drop.rotation.x = Math.PI;
        group.add(drop);
      }
    } else if (event.type === 'killer_wail') {
      // 3 Giant laser cylinders
      const dirX = event.direction?.x || 0;
      const dirZ = event.direction?.z || 1;
      group.rotation.y = Math.atan2(dirX, dirZ);

      for (let i = -1; i <= 1; i++) {
        const laserGeo = new THREE.CylinderGeometry(0.8, 0.8, 70, 12);
        const laserMat = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.75
        });
        const laser = new THREE.Mesh(laserGeo, laserMat);
        laser.rotation.x = Math.PI / 2;
        laser.position.set(i * 2.2, 1.2, 35);
        group.add(laser);
      }

      // Speaker rings at the beam origins
      const wailRingGeo = new THREE.TorusGeometry(1.1, 0.15, 8, 20);
      const wailRingMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85
      });
      for (let i = -1; i <= 1; i++) {
        const wailRing = new THREE.Mesh(wailRingGeo, wailRingMat);
        wailRing.position.set(i * 2.2, 1.2, 0);
        group.add(wailRing);
      }
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
      sp.group.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      this.visualSpecials.delete(id);
    }
  }

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
        (tracer.line.material as THREE.LineBasicMaterial).opacity = fade * 0.9;
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

    // 3. Explosions
    for (let i = this.visualExplosions.length - 1; i >= 0; i--) {
      const exp = this.visualExplosions[i]!;
      const elapsed = now - exp.startTime;
      if (elapsed >= exp.duration) {
        this.group.remove(exp.mesh);
        (exp.mesh.material as THREE.Material).dispose();
        if (exp.ring) {
          this.group.remove(exp.ring);
          exp.ring.geometry.dispose();
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
          (exp.ring.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.7;
        }
      }
    }

    // 4. Sub-weapons in flight
    for (const sub of this.visualSubWeapons.values()) {
      if (sub.type === 'curling_bomb') {
        sub.mesh.position.x += sub.velocity.x * dt;
        sub.mesh.position.z += sub.velocity.z * dt;
        sub.mesh.rotation.y += 3.0 * dt;
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
        if (spec.type === 'inkstrike') {
          spec.group.rotation.y += 5.0 * dt;
        } else if (spec.type === 'ink_storm' && spec.direction) {
          spec.group.position.x += spec.direction.x * 4.0 * dt;
          spec.group.position.z += spec.direction.z * 4.0 * dt;
        }
      }
    }
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
        exp.ring.geometry.dispose();
        (exp.ring.material as THREE.Material).dispose();
      }
    }
    this.visualExplosions.length = 0;
    this.sharedExplosionGeo.dispose();
    for (const sub of this.visualSubWeapons.values()) {
      this.group.remove(sub.mesh);
      sub.mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
    this.visualSubWeapons.clear();
    for (const sp of this.visualSpecials.values()) {
      this.group.remove(sp.group);
      sp.group.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
    this.visualSpecials.clear();
  }
}
