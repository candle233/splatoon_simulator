import * as THREE from 'three';
import { ARENA_HALF_SIZE, ARENA_OBSTACLES, ARENA_SIZE, BoxObstacle, Team } from '@ink/shared';
import { PaintEngine } from './PaintEngine.js';

export class Arena {
  readonly group = new THREE.Group();
  private paintEngine: PaintEngine;

  private groundMesh: THREE.Mesh;
  private obstacleMeshes: THREE.Mesh[] = [];
  private detailGeometries: THREE.BufferGeometry[] = [];
  private detailMaterials: THREE.Material[] = [];
  private markingTexture?: THREE.CanvasTexture;

  constructor(paintEngine: PaintEngine, obstacles: BoxObstacle[] = ARENA_OBSTACLES) {
    this.paintEngine = paintEngine;

    // 1. Ground Plane (100 x 100)
    const groundGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    groundGeo.rotateX(-Math.PI / 2);

    // Explicitly align UV coordinates with worldToUV (x, z in [-50, 50] -> u, v in [0, 1])
    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
    const uvAttr = groundGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, (x + ARENA_HALF_SIZE) / ARENA_SIZE, (z + ARENA_HALF_SIZE) / ARENA_SIZE);
    }
    uvAttr.needsUpdate = true;

    const groundMat = new THREE.MeshStandardMaterial({
      map: this.paintEngine.texture,
      roughness: 0.45,
      metalness: 0.12
    });

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.set(0, 0, 0);
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);

    // 1.1 Outer ground skirt beyond the walls
    this.buildGroundSkirt();

    // 2. Obstacles & Walls
    this.buildObstacles(obstacles);

    // 3. Team Spawn Bases
    this.buildSpawnBases();

    // 4. Court markings overlay above the paint layer
    this.buildCourtMarkings();

    // 5. Skyline silhouettes beyond the walls
    this.buildBackdropTowers();
  }

  private track<G extends THREE.BufferGeometry>(geo: G): G {
    this.detailGeometries.push(geo);
    return geo;
  }

  private trackM<M extends THREE.Material>(mat: M): M {
    this.detailMaterials.push(mat);
    return mat;
  }

  private buildGroundSkirt(): void {
    const skirtGeo = this.track(new THREE.PlaneGeometry(240, 240));
    skirtGeo.rotateX(-Math.PI / 2);
    const skirtMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: 0x14161e, roughness: 0.95, metalness: 0 })
    );
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.04;
    this.group.add(skirt);
  }

  private buildObstacles(obstacles: BoxObstacle[]): void {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2e323e,
      roughness: 0.7,
      metalness: 0.2
    });

    const blockMat = new THREE.MeshStandardMaterial({
      color: 0x424859,
      roughness: 0.6,
      metalness: 0.3
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x5a6378,
      roughness: 0.5,
      metalness: 0.4
    });

    const trimMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x6b7590,
        roughness: 0.45,
        metalness: 0.5
      })
    );

    const hazardMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x332200,
        emissive: 0xffaa00,
        emissiveIntensity: 0.55,
        roughness: 0.5
      })
    );

    const glowWhiteMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xbfd4ff,
        emissiveIntensity: 0.5,
        roughness: 0.3
      })
    );

    const pinkGlowMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xff007f,
        emissive: 0xff007f,
        emissiveIntensity: 0.45,
        roughness: 0.4
      })
    );

    const cyanGlowMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.45,
        roughness: 0.4
      })
    );

    for (const obs of obstacles) {
      const geo = new THREE.BoxGeometry(obs.size.x, obs.size.y, obs.size.z);
      const isWall = obs.id.startsWith('wall_');
      const isCenter = obs.id.startsWith('center_');

      const mat = isWall ? wallMat : isCenter ? accentMat : blockMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.obstacleMeshes.push(mesh);
      this.group.add(mesh);

      // Decorative top cap on every non-wall structure
      if (!isWall) {
        const capGeo = this.track(
          new THREE.BoxGeometry(obs.size.x + 0.3, 0.14, obs.size.z + 0.3)
        );
        const cap = new THREE.Mesh(capGeo, trimMat);
        cap.position.set(
          obs.position.x,
          obs.position.y + obs.size.y / 2 + 0.07,
          obs.position.z
        );
        cap.castShadow = true;
        this.group.add(cap);
      }

      if (isWall) {
        this.buildWallDetails(obs, trimMat, pinkGlowMat, cyanGlowMat);
      } else if (isCenter) {
        this.buildCenterTowerDetails(obs, trimMat, glowWhiteMat);
      } else if (obs.id.startsWith('barrier_')) {
        // Hazard stripes along the top edges
        const stripeGeo = this.track(new THREE.BoxGeometry(obs.size.x * 0.92, 0.06, 0.14));
        for (const edge of [-1, 1]) {
          const stripe = new THREE.Mesh(stripeGeo, hazardMat);
          stripe.position.set(
            obs.position.x,
            obs.position.y + obs.size.y / 2 + 0.16,
            obs.position.z + edge * (obs.size.z / 2 - 0.2)
          );
          this.group.add(stripe);
        }
      }
    }
  }

  private buildWallDetails(
    obs: BoxObstacle,
    trimMat: THREE.Material,
    pinkGlowMat: THREE.Material,
    cyanGlowMat: THREE.Material
  ): void {
    const horizontal = obs.size.x > obs.size.z;
    const len = horizontal ? obs.size.x : obs.size.z;
    const topY = obs.position.y + obs.size.y / 2;

    // Full-length top rail
    const railGeo = this.track(
      horizontal
        ? new THREE.BoxGeometry(obs.size.x + 0.6, 0.18, obs.size.z + 0.4)
        : new THREE.BoxGeometry(obs.size.x + 0.4, 0.18, obs.size.z + 0.6)
    );
    const rail = new THREE.Mesh(railGeo, trimMat);
    rail.position.set(obs.position.x, topY + 0.09, obs.position.z);
    rail.castShadow = true;
    this.group.add(rail);

    // Structural pillars along the inner face
    const pillarGeo = this.track(
      horizontal
        ? new THREE.BoxGeometry(0.35, obs.size.y - 0.4, 0.28)
        : new THREE.BoxGeometry(0.28, obs.size.y - 0.4, 0.35)
    );
    for (let d = -45; d <= 45; d += 15) {
      const pillar = new THREE.Mesh(pillarGeo, trimMat);
      if (horizontal) {
        pillar.position.set(obs.position.x + d, obs.position.y, obs.position.z + (obs.position.z > 0 ? -1.1 : 1.1));
      } else {
        pillar.position.set(obs.position.x + (obs.position.x > 0 ? -1.1 : 1.1), obs.position.y, obs.position.z + d);
      }
      this.group.add(pillar);
    }

    // Team glow strip near each spawn wall (pink west, cyan east)
    const isWest = obs.position.x < 0;
    if (horizontal) return; // only the two side walls get team strips
    const stripGeo = this.track(new THREE.BoxGeometry(0.1, 0.6, 22));
    const strip = new THREE.Mesh(stripGeo, isWest ? pinkGlowMat : cyanGlowMat);
    strip.position.set(
      obs.position.x + (isWest ? 1.05 : -1.05),
      1.5,
      obs.position.z
    );
    this.group.add(strip);
  }

  private buildCenterTowerDetails(
    obs: BoxObstacle,
    trimMat: THREE.Material,
    glowWhiteMat: THREE.Material
  ): void {
    const topY = obs.position.y + obs.size.y / 2;
    const half = obs.size.x / 2;

    // Circumscribing glow ring on the tower top
    const ringGeo = this.track(new THREE.TorusGeometry(half * 1.41, 0.08, 8, 48));
    const ring = new THREE.Mesh(ringGeo, glowWhiteMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(obs.position.x, topY + 0.18, obs.position.z);
    this.group.add(ring);

    // Corner posts
    const postGeo = this.track(new THREE.BoxGeometry(0.32, 0.55, 0.32));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, trimMat);
        post.position.set(
          obs.position.x + sx * (half - 0.25),
          topY + 0.27,
          obs.position.z + sz * (half - 0.25)
        );
        post.castShadow = true;
        this.group.add(post);
      }
    }

    // Emissive emblem discs on all four faces
    const emblemGeo = this.track(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 20));
    for (let i = 0; i < 4; i++) {
      const emblem = new THREE.Mesh(emblemGeo, glowWhiteMat);
      const angle = (i * Math.PI) / 2;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      emblem.position.set(
        obs.position.x + dx * (half + 0.05),
        obs.position.y + 0.4,
        obs.position.z + dz * (half + 0.05)
      );
      if (dx !== 0) {
        emblem.rotation.z = Math.PI / 2;
      } else {
        emblem.rotation.x = Math.PI / 2;
      }
      this.group.add(emblem);
    }
  }

  private buildSpawnBases(): void {
    const pinkPadGeo = this.track(new THREE.CylinderGeometry(5.5, 6, 0.2, 32));
    const pinkPadMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xff007f,
        emissive: 0x330018,
        roughness: 0.4
      })
    );
    const pinkPad = new THREE.Mesh(pinkPadGeo, pinkPadMat);
    pinkPad.position.set(-40, 0.1, 0);
    pinkPad.receiveShadow = true;
    this.group.add(pinkPad);

    const pinkDomeGeo = this.track(
      new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    );
    const pinkDomeMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xff007f,
        emissive: 0xff007f,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.22,
        roughness: 0.2,
        side: THREE.DoubleSide
      })
    );
    const pinkDome = new THREE.Mesh(pinkDomeGeo, pinkDomeMat);
    pinkDome.position.set(-40, 0, 0);
    this.group.add(pinkDome);

    const cyanPadGeo = this.track(new THREE.CylinderGeometry(5.5, 6, 0.2, 32));
    const cyanPadMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x003333,
        roughness: 0.4
      })
    );
    const cyanPad = new THREE.Mesh(cyanPadGeo, cyanPadMat);
    cyanPad.position.set(40, 0.1, 0);
    cyanPad.receiveShadow = true;
    this.group.add(cyanPad);

    const cyanDomeGeo = this.track(
      new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    );
    const cyanDomeMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.22,
        roughness: 0.2,
        side: THREE.DoubleSide
      })
    );
    const cyanDome = new THREE.Mesh(cyanDomeGeo, cyanDomeMat);
    cyanDome.position.set(40, 0, 0);
    this.group.add(cyanDome);

    // Glow rings around both pads
    const padRingGeo = this.track(new THREE.TorusGeometry(6.3, 0.1, 8, 40));
    const pinkRing = new THREE.Mesh(padRingGeo, pinkPadMat);
    pinkRing.rotation.x = Math.PI / 2;
    pinkRing.position.set(-40, 0.28, 0);
    this.group.add(pinkRing);
    const cyanRing = new THREE.Mesh(padRingGeo, cyanPadMat);
    cyanRing.rotation.x = Math.PI / 2;
    cyanRing.position.set(40, 0.28, 0);
    this.group.add(cyanRing);

    // Floor arrows pointing toward the arena center
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.9);
    arrowShape.lineTo(-0.55, -0.45);
    arrowShape.lineTo(0.55, -0.45);
    arrowShape.closePath();
    const arrowGeo = this.track(new THREE.ShapeGeometry(arrowShape));
    arrowGeo.rotateX(-Math.PI / 2); // shape +y -> world -z (arrow points -z)
    const arrowMat = this.trackM(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
    );
    const arrowSpots: { x: number; z: number; ry: number }[] = [
      { x: -34.5, z: -2.5, ry: -Math.PI / 2 }, // pink, points +x
      { x: -34.5, z: 2.5, ry: -Math.PI / 2 },
      { x: 34.5, z: -2.5, ry: Math.PI / 2 }, // cyan, points -x
      { x: 34.5, z: 2.5, ry: Math.PI / 2 }
    ];
    for (const spot of arrowSpots) {
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(spot.x, 0.23, spot.z);
      arrow.rotation.y = spot.ry;
      this.group.add(arrow);
    }
  }

  private buildCourtMarkings(): void {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 4;

    // Border inset
    ctx.strokeRect(24, 24, size - 48, size - 48);

    // Midline through the tower
    ctx.beginPath();
    ctx.moveTo(size / 2, 24);
    ctx.lineTo(size / 2, size - 24);
    ctx.stroke();

    // Center circle around the tower
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 155, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 16, 0, Math.PI * 2);
    ctx.fill();

    // Spawn circles
    for (const cx of [110, size - 110]) {
      ctx.beginPath();
      ctx.arc(cx, size / 2, 88, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Corner ticks
    const tick = 46;
    for (const [cx, cy] of [
      [24, 24],
      [size - 24, 24],
      [24, size - 24],
      [size - 24, size - 24]
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + tick * (cx < size / 2 ? 1 : -1), cy);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    const markGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    markGeo.rotateX(-Math.PI / 2);
    const markPos = markGeo.attributes.position as THREE.BufferAttribute;
    const markUv = markGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < markPos.count; i++) {
      const x = markPos.getX(i);
      const z = markPos.getZ(i);
      markUv.setXY(i, (x + ARENA_HALF_SIZE) / ARENA_SIZE, (z + ARENA_HALF_SIZE) / ARENA_SIZE);
    }
    markUv.needsUpdate = true;

    const markMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    this.detailGeometries.push(markGeo);
    this.detailMaterials.push(markMat);
    this.markingTexture = tex;

    const markings = new THREE.Mesh(markGeo, markMat);
    markings.position.y = 0.02;
    markings.renderOrder = 1;
    this.group.add(markings);
  }

  private buildBackdropTowers(): void {
    const towerMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: 0x1a1e2a, roughness: 0.95, metalness: 0 })
    );
    const windowMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x222a3c,
        emissive: 0x4a5f8a,
        emissiveIntensity: 0.5,
        roughness: 0.6
      })
    );

    // Symmetric skyline silhouettes just beyond the walls
    const towers: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [
      { x: 0, y: 9, z: 61, w: 11, h: 18, d: 6 },
      { x: -26, y: 6, z: 63, w: 7, h: 12, d: 5 },
      { x: 26, y: 7, z: 62, w: 8, h: 14, d: 5 },
      { x: 0, y: 9, z: -61, w: 11, h: 18, d: 6 },
      { x: -26, y: 6, z: -63, w: 7, h: 12, d: 5 },
      { x: 26, y: 7, z: -62, w: 8, h: 14, d: 5 },
      { x: 62, y: 8, z: -28, w: 6, h: 16, d: 7 },
      { x: 63, y: 6, z: 30, w: 6, h: 12, d: 7 },
      { x: -62, y: 8, z: 28, w: 6, h: 16, d: 7 },
      { x: -63, y: 6, z: -30, w: 6, h: 12, d: 7 }
    ];

    for (const t of towers) {
      const geo = this.track(new THREE.BoxGeometry(t.w, t.h, t.d));
      const tower = new THREE.Mesh(geo, towerMat);
      tower.position.set(t.x, t.y, t.z);
      this.group.add(tower);

      // Faint lit window band on the face toward the arena
      const bandGeo = this.track(
        new THREE.BoxGeometry(t.w * 0.7, 0.35, 0.1)
      );
      const band = new THREE.Mesh(bandGeo, windowMat);
      band.position.set(t.x, t.y + t.h * 0.15, t.z + (t.z > 0 ? -t.d / 2 - 0.06 : t.d / 2 + 0.06));
      if (Math.abs(t.x) > Math.abs(t.z)) {
        band.rotation.y = Math.PI / 2;
        band.position.set(t.x + (t.x > 0 ? -t.w / 2 - 0.06 : t.w / 2 + 0.06), t.y + t.h * 0.15, t.z);
      }
      this.group.add(band);
    }
  }

  dispose(): void {
    this.groundMesh.geometry.dispose();
    (this.groundMesh.material as THREE.Material).dispose();

    for (const mesh of this.obstacleMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }

    for (const geo of this.detailGeometries) {
      geo.dispose();
    }
    for (const mat of this.detailMaterials) {
      mat.dispose();
    }
    if (this.markingTexture) {
      this.markingTexture.dispose();
    }
  }

  /**
   * Returns paintable ground mesh surface (Subagent 04)
   */
  getPaintSurface(): THREE.Mesh {
    return this.groundMesh;
  }

  /**
   * Returns camera collision obstacle meshes (Subagent 04)
   */
  getCameraCollisionMeshes(): THREE.Mesh[] {
    return this.obstacleMeshes;
  }
}
