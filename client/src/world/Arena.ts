import * as THREE from 'three';
import { BoxObstacle, Team, getMapDef } from '@ink/shared';
import type { MapDef } from '@ink/shared';
import { PaintEngine } from './PaintEngine.js';

const DEFAULT_MAP = getMapDef();

export class Arena {
  readonly group = new THREE.Group();
  private paintEngine: PaintEngine;
  private mapDef: MapDef = DEFAULT_MAP;

  private groundMesh: THREE.Mesh;
  private obstacleMeshes: THREE.Mesh[] = [];
  private detailGeometries: THREE.BufferGeometry[] = [];
  private detailMaterials: THREE.Material[] = [];
  private markingTexture?: THREE.CanvasTexture;

  constructor(paintEngine: PaintEngine, mapDef: MapDef = DEFAULT_MAP, obstacles?: BoxObstacle[]) {
    this.paintEngine = paintEngine;
    this.mapDef = mapDef;
    const size = mapDef.size;

    // 1. Ground Plane aligned with worldToUV over the map size
    const groundGeo = new THREE.PlaneGeometry(size, size);
    groundGeo.rotateX(-Math.PI / 2);

    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
    const uvAttr = groundGeo.attributes.uv as THREE.BufferAttribute;
    const half = size / 2;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, (x + half) / size, (z + half) / size);
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
    this.buildObstacles(obstacles ?? mapDef.obstacles);

    // 3. Team Spawn Bases
    this.buildSpawnBases();

    // 4. Court markings overlay above the paint layer
    this.buildCourtMarkings();

    // 5. Skyline silhouettes beyond the walls
    this.buildBackdropTowers();

    // 6. Per-map signature props
    this.buildMapProps();
  }

  /** Full teardown + rebuild for a new map (called when the host swaps maps). */
  rebuild(mapDef: MapDef): void {
    this.mapDef = mapDef;
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (!child) break;
      this.group.remove(child);
    }
    this.obstacleMeshes = [];
    for (const geo of this.detailGeometries) geo.dispose();
    for (const mat of this.detailMaterials) mat.dispose();
    this.detailGeometries = [];
    this.detailMaterials = [];
    if (this.markingTexture) {
      this.markingTexture.dispose();
      this.markingTexture = undefined;
    }
    this.groundMesh.geometry.dispose();
    (this.groundMesh.material as THREE.Material).dispose();

    const size = mapDef.size;
    const groundGeo = new THREE.PlaneGeometry(size, size);
    groundGeo.rotateX(-Math.PI / 2);
    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
    const uvAttr = groundGeo.attributes.uv as THREE.BufferAttribute;
    const half = size / 2;
    for (let i = 0; i < posAttr.count; i++) {
      uvAttr.setXY(i, (posAttr.getX(i) + half) / size, (posAttr.getZ(i) + half) / size);
    }
    uvAttr.needsUpdate = true;
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.paintEngine.texture,
      roughness: 0.45,
      metalness: 0.12
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);

    this.buildGroundSkirt();
    this.buildObstacles(mapDef.obstacles);
    this.buildSpawnBases();
    this.buildCourtMarkings();
    this.buildBackdropTowers();
    this.buildMapProps();
  }

  getMapDef(): MapDef {
    return this.mapDef;
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
    const skirtGeo = this.track(new THREE.PlaneGeometry(320, 320));
    skirtGeo.rotateX(-Math.PI / 2);
    const skirtMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.mapDef.theme.sky).multiplyScalar(0.85),
        roughness: 0.95,
        metalness: 0
      })
    );
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.04;
    this.group.add(skirt);
  }

  private buildObstacles(obstacles: BoxObstacle[]): void {
    const theme = this.mapDef.theme;
    const wallMat = new THREE.MeshStandardMaterial({
      color: theme.wallColor,
      roughness: 0.7,
      metalness: 0.2
    });

    const blockMat = new THREE.MeshStandardMaterial({
      color: theme.obstacleColor,
      roughness: 0.6,
      metalness: 0.3
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.obstacleColor).lerp(new THREE.Color(theme.accentA), 0.15),
      roughness: 0.5,
      metalness: 0.4
    });

    const trimMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.wallColor).lerp(new THREE.Color(0xffffff), 0.25),
        roughness: 0.45,
        metalness: 0.5
      })
    );

    const hazardMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x332200,
        emissive: theme.accentA,
        emissiveIntensity: 0.55,
        roughness: 0.5
      })
    );

    const glowWhiteMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: theme.accentB,
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
      const isCenter = obs.id.startsWith('center_') || obs.id.startsWith('crane_base');

      const mat = isWall ? wallMat : isCenter ? accentMat : blockMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.obstacleMeshes.push(mesh);
      this.group.add(mesh);

      // Decorative top cap on every non-wall structure
      if (!isWall) {
        const capGeo = this.track(new THREE.BoxGeometry(obs.size.x + 0.3, 0.14, obs.size.z + 0.3));
        const cap = new THREE.Mesh(capGeo, trimMat);
        cap.position.set(obs.position.x, obs.position.y + obs.size.y / 2 + 0.07, obs.position.z);
        cap.castShadow = true;
        this.group.add(cap);
      }

      if (isWall) {
        this.buildWallDetails(obs, trimMat, pinkGlowMat, cyanGlowMat);
      } else if (isCenter) {
        this.buildCenterTowerDetails(obs, trimMat, glowWhiteMat);
      } else if (obs.id.startsWith('barrier_') || obs.id.startsWith('ring_')) {
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
    const size = this.mapDef.size;
    const horizontal = obs.size.x > obs.size.z;
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
    const span = size / 2 - 5;
    for (let d = -span; d <= span; d += 15) {
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
    const stripLen = Math.min(26, size * 0.26);
    const stripGeo = this.track(new THREE.BoxGeometry(0.1, 0.6, stripLen));
    const strip = new THREE.Mesh(stripGeo, isWest ? pinkGlowMat : cyanGlowMat);
    strip.position.set(obs.position.x + (isWest ? 1.05 : -1.05), 1.5, obs.position.z);
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
    const spawnX = this.mapDef.spawnX;
    const theme = this.mapDef.theme;

    const makeTeam = (team: Team, x: number) => {
      const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
      const padGeo = this.track(new THREE.CylinderGeometry(5.5, 6, 0.2, 32));
      const padMat = this.trackM(
        new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: team === Team.PINK ? 0x330018 : 0x003333,
          roughness: 0.4
        })
      );
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(x, 0.1, 0);
      pad.receiveShadow = true;
      this.group.add(pad);

      const domeGeo = this.track(new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2));
      const domeMat = this.trackM(
        new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: colorHex,
          emissiveIntensity: 0.35,
          transparent: true,
          opacity: 0.22,
          roughness: 0.2,
          side: THREE.DoubleSide
        })
      );
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.position.set(x, 0, 0);
      this.group.add(dome);

      const ringGeo = this.track(new THREE.TorusGeometry(6.3, 0.1, 8, 40));
      const ring = new THREE.Mesh(ringGeo, padMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.28, 0);
      this.group.add(ring);
    };

    makeTeam(Team.PINK, -spawnX);
    makeTeam(Team.CYAN, spawnX);

    // Floor arrows pointing toward the arena center
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.9);
    arrowShape.lineTo(-0.55, -0.45);
    arrowShape.lineTo(0.55, -0.45);
    arrowShape.closePath();
    const arrowGeo = this.track(new THREE.ShapeGeometry(arrowShape));
    arrowGeo.rotateX(-Math.PI / 2);
    const arrowMat = this.trackM(
      new THREE.MeshBasicMaterial({ color: theme.accentB, transparent: true, opacity: 0.5 })
    );
    const inner = spawnX - 5.5;
    const arrowSpots: { x: number; z: number; ry: number }[] = [
      { x: -inner, z: -2.5, ry: -Math.PI / 2 },
      { x: -inner, z: 2.5, ry: -Math.PI / 2 },
      { x: inner, z: -2.5, ry: Math.PI / 2 },
      { x: inner, z: 2.5, ry: Math.PI / 2 }
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

    ctx.strokeRect(24, 24, size - 48, size - 48);

    ctx.beginPath();
    ctx.moveTo(size / 2, 24);
    ctx.lineTo(size / 2, size - 24);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 155, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 16, 0, Math.PI * 2);
    ctx.fill();

    // Spawn circles track the actual spawn positions
    const spawnFrac = this.mapDef.spawnX / (this.mapDef.size / 2);
    const cxOff = spawnFrac * (size / 2 - 24);
    for (const cx of [size / 2 - cxOff, size / 2 + cxOff]) {
      ctx.beginPath();
      ctx.arc(cx, size / 2, 88, 0, Math.PI * 2);
      ctx.stroke();
    }

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
    const arenaSize = this.mapDef.size;
    const markGeo = new THREE.PlaneGeometry(arenaSize, arenaSize);
    markGeo.rotateX(-Math.PI / 2);
    const markPos = markGeo.attributes.position as THREE.BufferAttribute;
    const markUv = markGeo.attributes.uv as THREE.BufferAttribute;
    const half = arenaSize / 2;
    for (let i = 0; i < markPos.count; i++) {
      markUv.setXY(i, (markPos.getX(i) + half) / arenaSize, (markPos.getZ(i) + half) / arenaSize);
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
    const theme = this.mapDef.theme;
    const towerMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.sky).multiplyScalar(1.4),
        roughness: 0.95,
        metalness: 0
      })
    );
    const windowMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x222a3c,
        emissive: theme.accentB,
        emissiveIntensity: 0.5,
        roughness: 0.6
      })
    );

    const base = this.mapDef.size / 2;
    const near = base + 11;
    const far = base + 13;
    const towers: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [
      { x: 0, y: 9, z: near, w: 11, h: 18, d: 6 },
      { x: -base * 0.52, y: 6, z: far, w: 7, h: 12, d: 5 },
      { x: base * 0.52, y: 7, z: near + 1, w: 8, h: 14, d: 5 },
      { x: 0, y: 9, z: -near, w: 11, h: 18, d: 6 },
      { x: -base * 0.52, y: 6, z: -far, w: 7, h: 12, d: 5 },
      { x: base * 0.52, y: 7, z: -(near + 1), w: 8, h: 14, d: 5 },
      { x: near, y: 8, z: -base * 0.56, w: 6, h: 16, d: 7 },
      { x: far, y: 6, z: base * 0.6, w: 6, h: 12, d: 7 },
      { x: -near, y: 8, z: base * 0.56, w: 6, h: 16, d: 7 },
      { x: -far, y: 6, z: -base * 0.6, w: 6, h: 12, d: 7 }
    ];

    for (const t of towers) {
      const geo = this.track(new THREE.BoxGeometry(t.w, t.h, t.d));
      const tower = new THREE.Mesh(geo, towerMat);
      tower.position.set(t.x, t.y, t.z);
      this.group.add(tower);

      // Faint lit window band on the face toward the arena
      const bandGeo = this.track(new THREE.BoxGeometry(t.w * 0.7, 0.35, 0.1));
      const band = new THREE.Mesh(bandGeo, windowMat);
      band.position.set(t.x, t.y + t.h * 0.15, t.z + (t.z > 0 ? -t.d / 2 - 0.06 : t.d / 2 + 0.06));
      if (Math.abs(t.x) > Math.abs(t.z)) {
        band.rotation.y = Math.PI / 2;
        band.position.set(t.x + (t.x > 0 ? -t.w / 2 - 0.06 : t.w / 2 + 0.06), t.y + t.h * 0.15, t.z);
      }
      this.group.add(band);
    }
  }

  /** Signature props per map for a distinct silhouette and mood. */
  private buildMapProps(): void {
    const theme = this.mapDef.theme;
    const half = this.mapDef.size / 2;
    const accentA = this.trackM(
      new THREE.MeshStandardMaterial({ color: theme.accentA, emissive: theme.accentA, emissiveIntensity: 0.6, roughness: 0.5 })
    );
    const accentB = this.trackM(
      new THREE.MeshStandardMaterial({ color: theme.accentB, emissive: theme.accentB, emissiveIntensity: 0.55, roughness: 0.5 })
    );
    const metalMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: 0x565c6e, roughness: 0.45, metalness: 0.6 })
    );

    if (this.mapDef.id === 'downtown') {
      // Street lamps along the mid lanes
      const lampGeo = this.track(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8));
      const headGeo = this.track(new THREE.SphereGeometry(0.22, 10, 8));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lamp = new THREE.Mesh(lampGeo, metalMat);
          lamp.position.set(sx * 24, 2.1, sz * 30);
          this.group.add(lamp);
          const head = new THREE.Mesh(headGeo, accentB);
          head.position.set(sx * 24, 4.3, sz * 30);
          this.group.add(head);
        }
      }
      // Billboard near each base
      const boardGeo = this.track(new THREE.BoxGeometry(8, 3, 0.3));
      for (const sx of [-1, 1]) {
        const board = new THREE.Mesh(boardGeo, sx < 0 ? accentA : accentB);
        board.position.set(sx * (half - 6), 4.2, -22);
        board.rotation.y = sx * Math.PI / 2;
        this.group.add(board);
      }
    } else if (this.mapDef.id === 'cargo_docks') {
      // Crane arm across the top of the mast
      const armGeo = this.track(new THREE.BoxGeometry(30, 0.6, 1.2));
      const arm = new THREE.Mesh(armGeo, metalMat);
      arm.position.set(10, 10.6, 0);
      arm.rotation.z = 0.04;
      this.group.add(arm);
      const hookCableGeo = this.track(new THREE.CylinderGeometry(0.04, 0.04, 4.4, 6));
      const hook = new THREE.Mesh(hookCableGeo, metalMat);
      hook.position.set(22, 8.2, 0);
      this.group.add(hook);
      // Container accent stripes
      const stripeGeo = this.track(new THREE.BoxGeometry(12.2, 0.24, 5.2));
      for (const z of [26, -26]) {
        for (const x of [-24, 0, 24]) {
          const stripe = new THREE.Mesh(stripeGeo, x < 0 ? accentA : accentB);
          stripe.position.set(x, 2.4, z);
          this.group.add(stripe);
        }
      }
      // Floodlight poles at the corners
      const poleGeo = this.track(new THREE.CylinderGeometry(0.14, 0.18, 7, 8));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const pole = new THREE.Mesh(poleGeo, metalMat);
          pole.position.set(sx * (half - 5), 3.5, sz * (half - 5));
          this.group.add(pole);
          const lampGeo = this.track(new THREE.BoxGeometry(1.1, 0.4, 0.5));
          const lamp = new THREE.Mesh(lampGeo, accentB);
          lamp.position.set(sx * (half - 5), 7.1, sz * (half - 5));
          this.group.add(lamp);
        }
      }
    } else if (this.mapDef.id === 'sky_rink') {
      // Big neon halo floating above the center tower
      const haloGeo = this.track(new THREE.TorusGeometry(9.5, 0.16, 10, 56));
      const halo = new THREE.Mesh(haloGeo, accentA);
      halo.rotation.x = Math.PI / 2;
      halo.position.set(0, 7.4, 0);
      this.group.add(halo);
      const halo2Geo = this.track(new THREE.TorusGeometry(7.4, 0.1, 10, 48));
      const halo2 = new THREE.Mesh(halo2Geo, accentB);
      halo2.rotation.x = Math.PI / 2;
      halo2.position.set(0, 6.9, 0);
      this.group.add(halo2);
      // Corner neon pylons
      const pylonGeo = this.track(new THREE.CylinderGeometry(0.16, 0.24, 5.6, 8));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const pylon = new THREE.Mesh(pylonGeo, (sx > 0) !== (sz > 0) ? accentA : accentB);
          pylon.position.set(sx * (half - 4), 2.8, sz * (half - 4));
          this.group.add(pylon);
        }
      }
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
