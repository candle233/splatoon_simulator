import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxObstacle, Team, getMapDef } from '@ink/shared';
import type { MapDef, MapId } from '@ink/shared';
import { PaintEngine } from './PaintEngine.js';

const DEFAULT_MAP = getMapDef();

/**
 * Decorative floor overlays (seams, lane stripes, corner panels) sit this far
 * above the paintable ground plane. They are separate translucent meshes so the
 * paint texture UVs and the ink raycast path stay untouched — and because they
 * blend instead of covering, team ink still reads clearly underneath.
 */
const DECAL_Y = 0.015;
/** Environment dome radius; kept well inside the renderer far plane (260). */
const SKY_DOME_RADIUS = 175;
/** Vertical offset of the dome centre, so the horizon band sits at eye level. */
const SKY_DOME_Y = -10;
/**
 * Outer ground disc radius, chosen to meet the dome's intersection circle
 * (sqrt(R^2 - DOME_Y^2) ≈ 174.7) so the horizon closes with no visible seam.
 */
const GROUND_SKIRT_RADIUS = 172;

interface Xform {
  x: number;
  y: number;
  z: number;
  sx?: number;
  sy?: number;
  sz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

interface Pulser {
  mat: THREE.MeshStandardMaterial;
  base: number;
  amp: number;
  speed: number;
  phase: number;
}

interface Spinner {
  obj: THREE.Object3D;
  speed: number;
  axis: 'x' | 'y' | 'z';
}

/**
 * Court-markings canvas cache, keyed by map id.
 *
 * The markings are a pure function of the MapDef (spawn row + splat-zone
 * rect), so regenerating the 1024x1024 canvas on every `rebuild()` was wasted
 * work — the host can swap maps back and forth in the lobby. Each map keeps
 * its own canvas for the process lifetime; the canvases are small (4 MB
 * backing store at most, and only for maps actually visited) and are never
 * disposed because the Arena only borrows them.
 */
const courtMarkingsCache = new Map<MapId, HTMLCanvasElement>();

function courtMarkingsCanvas(mapDef: MapDef, size: number): HTMLCanvasElement | null {
  const cached = courtMarkingsCache.get(mapDef.id);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

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
  const spawnFrac = mapDef.spawnX / (mapDef.size / 2);
  const cxOff = spawnFrac * (size / 2 - 24);
  for (const cx of [size / 2 - cxOff, size / 2 + cxOff]) {
    ctx.beginPath();
    ctx.arc(cx, size / 2, 88, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Zone rectangle for Splat Zones
  const zone = mapDef.zone;
  const half = mapDef.size / 2;
  const zx = ((zone.x - zone.w / 2 + half) / mapDef.size) * size;
  const zy = ((zone.z - zone.d / 2 + half) / mapDef.size) * size;
  const zw = (zone.w / mapDef.size) * size;
  const zh = (zone.d / mapDef.size) * size;
  ctx.setLineDash([18, 12]);
  ctx.strokeRect(zx, zy, zw, zh);
  ctx.setLineDash([]);

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

  courtMarkingsCache.set(mapDef.id, canvas);
  return canvas;
}

/**
 * Procedural arena geometry. Everything is derived from a `MapDef`; there are
 * no model files. Decorative repeats are batched into `InstancedMesh` so a map
 * with 80 obstacles still costs a few hundred draw calls, not a few thousand.
 */
export class Arena {
  readonly group = new THREE.Group();
  private paintEngine: PaintEngine;
  private mapDef: MapDef = DEFAULT_MAP;

  private groundMesh: THREE.Mesh;
  private unitBox!: THREE.BoxGeometry;
  /** Lazily-created shared emblem disc geometry (one per rebuild). */
  private emblemGeo?: THREE.CylinderGeometry;
  /** Shared per-team spawn-pad / dome materials (one pair per rebuild). */
  private padMats: Partial<Record<Team, THREE.MeshStandardMaterial>> = {};
  private domeMats: Partial<Record<Team, THREE.MeshStandardMaterial>> = {};
  private obstacleMeshes: THREE.Mesh[] = [];
  private detailGeometries: THREE.BufferGeometry[] = [];
  private detailMaterials: THREE.Material[] = [];
  private canvasTextures: THREE.CanvasTexture[] = [];

  private skyDome?: THREE.Mesh;
  private motes?: THREE.InstancedMesh;
  private moteBase?: Float32Array;
  private motePhase?: Float32Array;
  private pulsing: Pulser[] = [];
  private spinners: Spinner[] = [];
  private auroraBands: THREE.Mesh[] = [];
  /** Objective volume for zone-scoring modes; hidden when the mode has none. */
  private zoneMarker?: THREE.Group;
  private zoneMaterials: THREE.MeshBasicMaterial[] = [];

  private animTime = 0;
  private lastAnimMs = 0;

  // Scratch objects reused by the instancing + animation paths (no per-frame allocations).
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();

  constructor(paintEngine: PaintEngine, mapDef: MapDef = DEFAULT_MAP, obstacles?: BoxObstacle[]) {
    this.paintEngine = paintEngine;
    this.mapDef = mapDef;

    // The arena is what maps the paint texture onto the floor, so it owns the
    // world<->UV extent the ink sampler has to use.
    this.paintEngine.setMapSize(mapDef.size);

    const groundGeo = this.buildGroundGeometry(mapDef.size);
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.paintEngine.texture,
      roughness: 0.45,
      metalness: 0.12,
      // Push the paintable plane behind the decorative overlays so the thin
      // floor decals never z-fight with it.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);

    this.buildAll(obstacles);
  }

  /** Full teardown + rebuild for a new map (called when the host swaps maps). */
  rebuild(mapDef: MapDef): void {
    this.teardown();

    this.mapDef = mapDef;
    this.paintEngine.setMapSize(mapDef.size);

    const groundGeo = this.buildGroundGeometry(mapDef.size);
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.paintEngine.texture,
      roughness: 0.45,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);

    this.buildAll(mapDef.obstacles);
  }

  getMapDef(): MapDef {
    return this.mapDef;
  }

  private buildAll(obstacles?: BoxObstacle[]): void {
    this.animTime = 0;
    this.lastAnimMs = 0;
    this.unitBox = this.track(new THREE.BoxGeometry(1, 1, 1));

    this.buildGroundSkirt();
    this.buildSkyDome();
    this.buildObstacles(obstacles ?? this.mapDef.obstacles);
    this.buildSpawnBases();
    this.buildGroundDetail();
    this.buildCourtMarkings();
    this.buildBackdropTowers();
    this.buildMapProps();
    this.buildAmbientLife();
    this.buildZoneMarker();
  }

  /** Removes every child and releases every tracked GPU resource exactly once. */
  private teardown(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (!child) break;
      this.group.remove(child);
    }

    for (const geo of this.detailGeometries) geo.dispose();
    for (const mat of this.detailMaterials) mat.dispose();
    for (const tex of this.canvasTextures) tex.dispose();

    this.detailGeometries = [];
    this.detailMaterials = [];
    this.canvasTextures = [];
    this.obstacleMeshes = [];
    this.emblemGeo = undefined;
    this.padMats = {};
    this.domeMats = {};
    this.pulsing = [];
    this.spinners = [];
    this.auroraBands = [];
    this.zoneMarker = undefined;
    this.zoneMaterials = [];
    this.motes = undefined;
    this.moteBase = undefined;
    this.motePhase = undefined;

    this.groundMesh.geometry.dispose();
    (this.groundMesh.material as THREE.Material).dispose();
  }

  private track<G extends THREE.BufferGeometry>(geo: G): G {
    if (!this.detailGeometries.includes(geo)) this.detailGeometries.push(geo);
    return geo;
  }

  private trackM<M extends THREE.Material>(mat: M): M {
    if (!this.detailMaterials.includes(mat)) this.detailMaterials.push(mat);
    return mat;
  }

  private trackTex<T extends THREE.CanvasTexture>(tex: T): T {
    this.canvasTextures.push(tex);
    return tex;
  }


  /** Registers a material whose emissive intensity breathes over time. */
  private pulse<M extends THREE.MeshStandardMaterial>(mat: M, amp: number, speed: number, phase = 0): M {
    this.pulsing.push({ mat, base: mat.emissiveIntensity, amp, speed, phase });
    return mat;
  }

  private spin(obj: THREE.Object3D, speed: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    this.spinners.push({ obj, speed, axis });
  }

  /**
   * Batches a repeated shape into a single InstancedMesh. `geo` and `mat` must
   * already be tracked by the caller so teardown releases them once.
   */
  private addInstanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    xforms: Xform[],
    castShadow = false,
    receiveShadow = false,
    renderOrder = 0
  ): THREE.InstancedMesh | null {
    if (xforms.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, xforms.length);
    for (let i = 0; i < xforms.length; i++) {
      const t = xforms[i];
      if (!t) continue;
      this.tmpPos.set(t.x, t.y, t.z);
      this.tmpEuler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpScale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(i, this.tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.renderOrder = renderOrder;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  private buildGroundGeometry(size: number): THREE.PlaneGeometry {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
    const half = size / 2;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, (x + half) / size, (z + half) / size);
    }
    uvAttr.needsUpdate = true;
    return geo;
  }

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  private buildGroundSkirt(): void {
    // A disc, not a square: its rim meets the dome's intersection circle so the
    // horizon closes cleanly at any viewing angle.
    const skirtGeo = this.track(new THREE.CircleGeometry(GROUND_SKIRT_RADIUS, 64));
    skirtGeo.rotateX(-Math.PI / 2);
    const skirtMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.mapDef.theme.groundBase).multiplyScalar(0.55),
        roughness: 0.95,
        metalness: 0
      })
    );
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.05;
    skirt.receiveShadow = true;
    this.group.add(skirt);
  }

  /**
   * Inverted gradient dome so the horizon reads as a place instead of a flat
   * fog colour. It rides with the camera on X/Z (keeping the horizon level) and
   * drives the ambient animation from `onBeforeRender`, which the renderer
   * invokes once per visible frame before the object's matrices are consumed.
   */
  private buildSkyDome(): void {
    const theme = this.mapDef.theme;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sky = new THREE.Color(theme.sky);
    const fog = new THREE.Color(theme.fogColor);
    const glowA = new THREE.Color(theme.accentA).lerp(fog, 0.72);
    const glowB = new THREE.Color(theme.accentB).lerp(fog, 0.78);
    const zenith = sky.clone().lerp(new THREE.Color(0xffffff), 0.1);
    // Below the horizon the dome must match the fog colour, or the distant
    // ground would meet a hard band instead of fading out.
    const belowHorizon = fog.clone().multiplyScalar(0.9);

    const hex = (c: THREE.Color): string => `#${c.getHexString()}`;

    // Canvas row 0 is v=1 (sphere zenith) because CanvasTexture flips Y.
    // The horizon (sphere equator, v=0.5) lands at canvas row height/2.
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0.0, hex(zenith));
    grad.addColorStop(0.22, hex(sky));
    grad.addColorStop(0.36, hex(glowB));
    grad.addColorStop(0.44, hex(glowA));
    grad.addColorStop(0.5, hex(fog));
    grad.addColorStop(0.62, hex(belowHorizon));
    grad.addColorStop(1.0, hex(belowHorizon));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Soft cloud / aurora veils in the upper half, tinted from the accent pair.
    // Deterministic hash so every rebuild of a map looks identical.
    for (let i = 0; i < 34; i++) {
      const h1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const h2 = Math.abs(Math.sin(i * 78.233) * 12345.6789) % 1;
      const px = h1 * canvas.width;
      // Stay above the horizon row (height/2) so the seam stays clean.
      const py = 20 + h2 * (canvas.height / 2 - 40);
      const r = 22 + (i % 7) * 11;
      const blob = ctx.createRadialGradient(px, py, 0, px, py, r);
      const tint = i % 2 === 0 ? glowA : glowB;
      blob.addColorStop(0, `${hex(tint)}${i % 3 === 0 ? '44' : '28'}`);
      blob.addColorStop(1, `${hex(tint)}00`);
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    const domeMat = this.trackM(
      new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false
      })
    );
    const domeGeo = this.track(new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 24));
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(0, SKY_DOME_Y, 0);
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    dome.castShadow = false;
    dome.receiveShadow = false;
    this.skyDome = dome;
    this.group.add(dome);

    dome.onBeforeRender = (_renderer, _scene, camera): void => {
      // Ride with the camera on X/Z so the horizon never slides.
      dome.position.set(camera.position.x, SKY_DOME_Y, camera.position.z);
      dome.updateWorldMatrix(true, false);
      // Also the single per-frame animation tick: the renderer invokes this
      // once per visible frame, before the dome's matrices are consumed.
      this.animateAmbient();
    };
  }

  // -------------------------------------------------------------------------
  // Obstacles
  // -------------------------------------------------------------------------

  private buildObstacles(obstacles: BoxObstacle[]): void {
    const theme = this.mapDef.theme;
    const wallMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: theme.wallColor, roughness: 0.7, metalness: 0.2 })
    );
    const blockMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: theme.obstacleColor, roughness: 0.6, metalness: 0.3 })
    );
    const accentMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.obstacleColor).lerp(new THREE.Color(theme.accentA), 0.15),
        roughness: 0.5,
        metalness: 0.4
      })
    );
    const trimMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.wallColor).lerp(new THREE.Color(0xffffff), 0.25),
        roughness: 0.45,
        metalness: 0.5
      })
    );
    const hazardMat = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0x332200,
          emissive: theme.accentA,
          emissiveIntensity: 0.55,
          roughness: 0.5
        })
      ),
      0.3,
      1.6
    );
    const glowWhiteMat = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: theme.accentB,
          emissiveIntensity: 0.5,
          roughness: 0.3
        })
      ),
      0.25,
      1.1
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

    // Obstacle bodies are batched by material into one InstancedMesh each, so a
    // 80-obstacle map costs three opaque draw calls (plus three in the shadow
    // pass) instead of 80 — and the boxes keep their exact server-side
    // positions/sizes because every instance matrix is built from the MapDef.
    const wallBodies: Xform[] = [];
    const accentBodies: Xform[] = [];
    const blockBodies: Xform[] = [];
    const caps: Xform[] = [];
    const stripes: Xform[] = [];
    // Wall detailing accumulated across every wall, then flushed as one batch.
    const rails: Xform[] = [];
    const pillars: Xform[] = [];
    const pinkStrips: Xform[] = [];
    const cyanStrips: Xform[] = [];
    const rings: THREE.BufferGeometry[] = [];
    const posts: Xform[] = [];
    const emblems: Xform[] = [];

    for (const obs of obstacles) {
      const isWall = obs.id.startsWith('wall_');
      const isCenter = obs.id.startsWith('center_') || obs.id.startsWith('crane_base');

      const body: Xform = {
        x: obs.position.x,
        y: obs.position.y,
        z: obs.position.z,
        sx: obs.size.x,
        sy: obs.size.y,
        sz: obs.size.z
      };
      if (isWall) wallBodies.push(body);
      else if (isCenter) accentBodies.push(body);
      else blockBodies.push(body);

      if (!isWall) {
        // Decorative top cap on every non-wall structure.
        caps.push({
          x: obs.position.x,
          y: obs.position.y + obs.size.y / 2 + 0.07,
          z: obs.position.z,
          sx: obs.size.x + 0.3,
          sy: 0.14,
          sz: obs.size.z + 0.3
        });
      }

      if (isWall) {
        this.collectWallDetails(obs, rails, pillars, pinkStrips, cyanStrips);
      } else if (isCenter) {
        this.collectCenterTowerDetails(obs, rings, posts, emblems);
      } else if (obs.id.startsWith('barrier_') || obs.id.startsWith('ring_') || obs.id.startsWith('mid_wall')) {
        // Hazard stripes along the top edges.
        for (const edge of [-1, 1]) {
          stripes.push({
            x: obs.position.x,
            y: obs.position.y + obs.size.y / 2 + 0.16,
            z: obs.position.z + edge * (obs.size.z / 2 - 0.2),
            sx: obs.size.x * 0.92,
            sy: 0.06,
            sz: 0.14
          });
        }
      }
    }

    const wallMesh = this.addInstanced(this.unitBox, wallMat, wallBodies, true, true);
    const accentMesh = this.addInstanced(this.unitBox, accentMat, accentBodies, true, true);
    const blockMesh = this.addInstanced(this.unitBox, blockMat, blockBodies, true, true);
    // InstancedMesh extends Mesh, so the camera-collision accessor keeps working.
    this.obstacleMeshes = [wallMesh, accentMesh, blockMesh].filter(
      (m): m is THREE.InstancedMesh => m !== null
    );

    this.addInstanced(this.unitBox, trimMat, caps, true);
    this.addInstanced(this.unitBox, hazardMat, stripes);

    this.addInstanced(this.unitBox, trimMat, rails, true);
    this.addInstanced(this.unitBox, trimMat, pillars, true);
    this.addInstanced(this.unitBox, pinkGlowMat, pinkStrips);
    this.addInstanced(this.unitBox, cyanGlowMat, cyanStrips);

    // Centre-tower rings differ in radius per tower, so they are merged into a
    // single geometry instead of instanced.
    if (rings.length > 0) {
      const merged = mergeGeometries(rings, false);
      for (const ring of rings) ring.dispose();
      if (merged) {
        this.track(merged);
        const ringMesh = new THREE.Mesh(merged, glowWhiteMat);
        ringMesh.renderOrder = 0;
        this.group.add(ringMesh);
      }
    }
    this.addInstanced(this.unitBox, trimMat, posts, true);
    if (emblems.length > 0) {
      this.addInstanced(this.emblemDiscGeo(), glowWhiteMat, emblems);
    }
  }

  /** Tracked emblem-disc geometry, created once per rebuild and shared. */
  private emblemDiscGeo(): THREE.CylinderGeometry {
    if (!this.emblemGeo) {
      this.emblemGeo = this.track(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 20));
    }
    return this.emblemGeo;
  }

  /**
   * Appends one wall's top rail, inner-face pillars and team glow strip to the
   * shared batches so all walls flush as four InstancedMesh draws.
   */
  private collectWallDetails(
    obs: BoxObstacle,
    rails: Xform[],
    pillars: Xform[],
    pinkStrips: Xform[],
    cyanStrips: Xform[]
  ): void {
    const size = this.mapDef.size;
    const horizontal = obs.size.x > obs.size.z;
    const topY = obs.position.y + obs.size.y / 2;

    rails.push({
      x: obs.position.x,
      y: topY + 0.09,
      z: obs.position.z,
      sx: horizontal ? obs.size.x + 0.6 : obs.size.x + 0.4,
      sy: 0.18,
      sz: horizontal ? obs.size.z + 0.4 : obs.size.z + 0.6
    });

    // Structural pillars along the inner face
    const span = size / 2 - 5;
    for (let d = -span; d <= span; d += 15) {
      if (horizontal) {
        pillars.push({
          x: obs.position.x + d,
          y: obs.position.y,
          z: obs.position.z + (obs.position.z > 0 ? -1.1 : 1.1),
          sx: 0.35,
          sy: obs.size.y - 0.4,
          sz: 0.28
        });
      } else {
        pillars.push({
          x: obs.position.x + (obs.position.x > 0 ? -1.1 : 1.1),
          y: obs.position.y,
          z: obs.position.z + d,
          sx: 0.28,
          sy: obs.size.y - 0.4,
          sz: 0.35
        });
      }
    }

    // Team glow strip near each spawn wall (pink west, cyan east)
    if (horizontal) return; // only the two side walls get team strips
    const isWest = obs.position.x < 0;
    const stripLen = Math.min(34, size * 0.26);
    const strip: Xform = {
      x: obs.position.x + (isWest ? 1.05 : -1.05),
      y: 1.5,
      z: obs.position.z,
      sx: 0.1,
      sy: 0.6,
      sz: stripLen
    };
    (isWest ? pinkStrips : cyanStrips).push(strip);
  }

  /**
   * Appends a centre tower's glow ring, corner posts and face emblems to the
   * shared batches (ring geometries are merged, posts/emblems instanced).
   */
  private collectCenterTowerDetails(
    obs: BoxObstacle,
    rings: THREE.BufferGeometry[],
    posts: Xform[],
    emblems: Xform[]
  ): void {
    const topY = obs.position.y + obs.size.y / 2;
    const half = obs.size.x / 2;

    // Circumscribing glow ring on the tower top
    const ringGeo = new THREE.TorusGeometry(half * 1.41, 0.08, 8, 48);
    ringGeo.rotateX(Math.PI / 2);
    ringGeo.translate(obs.position.x, topY + 0.18, obs.position.z);
    rings.push(ringGeo);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        posts.push({
          x: obs.position.x + sx * (half - 0.25),
          y: topY + 0.27,
          z: obs.position.z + sz * (half - 0.25),
          sx: 0.32,
          sy: 0.55,
          sz: 0.32
        });
      }
    }

    // Emissive emblem discs on all four faces
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      emblems.push({
        x: obs.position.x + dx * (half + 0.05),
        y: obs.position.y + 0.4,
        z: obs.position.z + dz * (half + 0.05),
        rz: dx !== 0 ? Math.PI / 2 : 0,
        rx: dx !== 0 ? 0 : Math.PI / 2
      });
    }
  }


  private buildSpawnBases(): void {
    const spawnX = this.mapDef.spawnX;
    const theme = this.mapDef.theme;

    // Per-team batches. The spinning banners stay individual meshes because
    // each one animates on its own; everything else on the pad is instanced.
    const pinkPads: Xform[] = [];
    const cyanPads: Xform[] = [];
    const pinkDomes: Xform[] = [];
    const cyanDomes: Xform[] = [];
    const pinkPoles: Xform[] = [];
    const cyanPoles: Xform[] = [];

    const padGeo = this.track(new THREE.CylinderGeometry(5.5, 6, 0.2, 32));
    const domeGeo = this.track(new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2));
    const ringGeo = this.track(new THREE.TorusGeometry(6.3, 0.1, 8, 40));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8));
    const flagGeo = this.track(new THREE.PlaneGeometry(2.6, 1.5));

    const makeTeam = (team: Team, x: number): void => {
      const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
      const padMat = this.trackM(
        new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: team === Team.PINK ? 0x330018 : 0x003333,
          roughness: 0.4
        })
      );
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
      const flagMat = this.trackM(
        new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: colorHex,
          emissiveIntensity: 0.3,
          side: THREE.DoubleSide,
          roughness: 0.7
        })
      );

      const isPink = team === Team.PINK;
      const pads = isPink ? pinkPads : cyanPads;
      pads.push({ x, y: 0.1, z: 0 });
      pads.push({ x, y: 0.28, z: 0, rx: Math.PI / 2 });
      (isPink ? pinkDomes : cyanDomes).push({ x, y: 0, z: 0 });

      // Team banner poles flanking the pad
      const poles = isPink ? pinkPoles : cyanPoles;
      for (const sz of [-1, 1]) {
        poles.push({ x, y: 2.6, z: sz * 7.4 });

        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(x, 4.6, sz * 7.4 + 1.4);
        flag.rotation.y = sz > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.group.add(flag);
        this.spin(flag, 0.25 * sz, 'x');
      }
    };

    makeTeam(Team.PINK, -spawnX);
    makeTeam(Team.CYAN, spawnX);

    // One draw per team for the pad+ring and the dome, one for the poles.
    this.addInstanced(padGeo, this.padMaterial(Team.PINK), pinkPads, false, true);
    this.addInstanced(padGeo, this.padMaterial(Team.CYAN), cyanPads, false, true);
    this.addInstanced(domeGeo, this.domeMaterial(Team.PINK), pinkDomes);
    this.addInstanced(domeGeo, this.domeMaterial(Team.CYAN), cyanDomes);
    this.addInstanced(poleGeo, this.padMaterial(Team.PINK), pinkPoles, true);
    this.addInstanced(poleGeo, this.padMaterial(Team.CYAN), cyanPoles, true);

    // Floor arrows pointing toward the arena center
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.9);
    arrowShape.lineTo(-0.55, -0.45);
    arrowShape.lineTo(0.55, -0.45);
    arrowShape.closePath();
    const arrowGeo = this.track(new THREE.ShapeGeometry(arrowShape));
    arrowGeo.rotateX(-Math.PI / 2);
    const arrowMat = this.trackM(
      new THREE.MeshBasicMaterial({ color: theme.accentB, transparent: true, opacity: 0.5, depthWrite: false })
    );
    const inner = spawnX - 5.5;
    const arrows: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        arrows.push({ x: sx * inner, y: 0.23, z: sz * 2.5, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
    this.addInstanced(arrowGeo, arrowMat, arrows);
  }

  /** Shared spawn-pad material per team, created once per rebuild. */
  private padMaterial(team: Team): THREE.MeshStandardMaterial {
    if (!this.padMats[team]) {
      const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
      this.padMats[team] = this.trackM(
        new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: team === Team.PINK ? 0x330018 : 0x003333,
          roughness: 0.4
        })
      );
    }
    return this.padMats[team]!;
  }

  /** Shared spawn-dome material per team, created once per rebuild. */
  private domeMaterial(team: Team): THREE.MeshStandardMaterial {
    if (!this.domeMats[team]) {
      const colorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
      this.domeMats[team] = this.trackM(
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
    }
    return this.domeMats[team]!;
  }

  /**
   * Inset floor panels, seam grid, lane guides and a centre ring. All of it
   * lives on separate translucent meshes above the paintable plane, so the ink
   * texture and the paint raycast still see a clean quad underneath — and the
   * overlays blend over team ink instead of hiding it.
   */
  private buildGroundDetail(): void {
    const theme = this.mapDef.theme;
    const half = this.mapDef.size / 2;

    // Overlays are transparent + depthWrite:false so they tint rather than mask
    // the ink texture on the plane below.
    const overlay = (color: number, emissive: number, opacity: number, intensity: number): THREE.MeshStandardMaterial =>
      this.trackM(
        new THREE.MeshStandardMaterial({
          color,
          emissive,
          emissiveIntensity: intensity,
          roughness: 0.7,
          metalness: 0.05,
          transparent: true,
          opacity,
          depthWrite: false
        })
      );

    const seamMat = overlay(new THREE.Color(theme.groundAlt).multiplyScalar(0.7).getHex(), 0x000000, 0.5, 0);
    const panelMat = overlay(new THREE.Color(theme.groundBase).multiplyScalar(1.18).getHex(), 0x000000, 0.4, 0);
    const laneMat = this.pulse(overlay(theme.accentB, theme.accentB, 0.42, 0.5), 0.14, 0.8);
    const teamLaneMat = overlay(theme.accentA, theme.accentA, 0.34, 0.32);

    // 1. Corner + edge panels framing the field
    const panelW = this.mapDef.size * 0.19;
    const panelOff = half - panelW / 2 - 1.5;
    const panels: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        panels.push({ x: sx * panelOff, y: DECAL_Y, z: sz * panelOff, sx: panelW, sy: 0.02, sz: panelW });
      }
    }
    this.addInstanced(this.unitBox, panelMat, panels, false, false, 1);

    // 2. Seam grid every ~size/8 units
    const step = this.mapDef.size / 8;
    const span = this.mapDef.size - 6;
    const seams: Xform[] = [];
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      const d = k * step;
      seams.push({ x: 0, y: DECAL_Y, z: d, sx: span, sy: 0.02, sz: 0.22 });
      seams.push({ x: d, y: DECAL_Y, z: 0, sx: 0.22, sy: 0.02, sz: span });
    }
    this.addInstanced(this.unitBox, seamMat, seams, false, false, 1);

    // 3. Mid line + team lane guides
    const lanes: Xform[] = [
      { x: 0, y: DECAL_Y + 0.004, z: 0, sx: span, sy: 0.02, sz: 0.5 },
      { x: 0, y: DECAL_Y + 0.004, z: 0, sx: 0.5, sy: 0.02, sz: span }
    ];
    this.addInstanced(this.unitBox, laneMat, lanes, false, false, 2);

    const laneLen = this.mapDef.size - 24;
    const teamLanes: Xform[] = [
      { x: -this.mapDef.spawnX, y: DECAL_Y + 0.004, z: 0, sx: 1.1, sy: 0.02, sz: laneLen },
      { x: this.mapDef.spawnX, y: DECAL_Y + 0.004, z: 0, sx: 1.1, sy: 0.02, sz: laneLen }
    ];
    this.addInstanced(this.unitBox, teamLaneMat, teamLanes, false, false, 2);

    // 4. Inset boundary frame just inside the walls
    const frameOff = half - 2.2;
    const frameLen = this.mapDef.size - 4.4;
    const frame: Xform[] = [
      { x: 0, y: DECAL_Y + 0.006, z: frameOff, sx: frameLen, sy: 0.02, sz: 0.3 },
      { x: 0, y: DECAL_Y + 0.006, z: -frameOff, sx: frameLen, sy: 0.02, sz: 0.3 },
      { x: frameOff, y: DECAL_Y + 0.006, z: 0, sx: 0.3, sy: 0.02, sz: frameLen },
      { x: -frameOff, y: DECAL_Y + 0.006, z: 0, sx: 0.3, sy: 0.02, sz: frameLen }
    ];
    this.addInstanced(this.unitBox, laneMat, frame, false, false, 2);

    // 5. Centre ring on the floor
    const ringGeo = this.track(new THREE.TorusGeometry(this.mapDef.size * 0.1, 0.16, 8, 56));
    const ring = new THREE.Mesh(ringGeo, laneMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, DECAL_Y + 0.01, 0);
    ring.renderOrder = 2;
    this.group.add(ring);
  }

  private buildCourtMarkings(): void {
    const size = 1024;
    const canvas = courtMarkingsCanvas(this.mapDef, size);
    if (!canvas) return;

    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const arenaSize = this.mapDef.size;
    const markGeo = this.track(new THREE.PlaneGeometry(arenaSize, arenaSize));
    markGeo.rotateX(-Math.PI / 2);
    const markPos = markGeo.attributes.position as THREE.BufferAttribute;
    const markUv = markGeo.attributes.uv as THREE.BufferAttribute;
    const markHalf = arenaSize / 2;
    for (let i = 0; i < markPos.count; i++) {
      markUv.setXY(i, (markPos.getX(i) + markHalf) / arenaSize, (markPos.getZ(i) + markHalf) / arenaSize);
    }
    markUv.needsUpdate = true;

    const markMat = this.trackM(
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      })
    );

    const markings = new THREE.Mesh(markGeo, markMat);
    markings.position.y = 0.03;
    markings.renderOrder = 1;
    this.group.add(markings);
  }

  /**
   * Objective volume for the zone-scoring modes. Without this the objective is
   * only a faint line in the floor markings, so players cannot tell where the
   * zone actually is. The marker is built once per map and toggled by
   * `setZoneVisible`; its tint is driven by `setZoneOwner`.
   */
  private buildZoneMarker(): void {
    const zone = this.mapDef.zone;
    const group = new THREE.Group();
    group.visible = false;

    const w = zone.w;
    const d = zone.d;
    const h = 3.2;

    const floorMat = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    const wallMat = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    const edgeMat = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
      })
    );
    this.zoneMaterials = [floorMat, wallMat, edgeMat];

    // Floor plate, lifted just above the decorative markings.
    const floorGeo = this.track(new THREE.PlaneGeometry(w, d));
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0.06;
    floor.renderOrder = 3;
    group.add(floor);

    // Four translucent walls marking the volume.
    const wallGeo = this.track(new THREE.PlaneGeometry(w, h));
    const sideGeo = this.track(new THREE.PlaneGeometry(d, h));
    const walls: [THREE.BufferGeometry, number, number, number][] = [
      [wallGeo, 0, h / 2, -d / 2],
      [wallGeo, 0, h / 2, d / 2],
      [sideGeo, -w / 2, h / 2, 0],
      [sideGeo, w / 2, h / 2, 0]
    ];
    for (const [geo, x, y, z] of walls) {
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(x, y, z);
      wall.renderOrder = 3;
      group.add(wall);
    }

    // Bright rim so the boundary stays readable against the floor.
    const rimGeo = this.track(new THREE.BufferGeometry());
    const rimPts = new Float32Array([
      -w / 2, 0, -d / 2, w / 2, 0, -d / 2,
      w / 2, 0, -d / 2, w / 2, 0, d / 2,
      w / 2, 0, d / 2, -w / 2, 0, d / 2,
      -w / 2, 0, d / 2, -w / 2, 0, -d / 2
    ]);
    rimGeo.setAttribute('position', new THREE.BufferAttribute(rimPts, 3));
    const rim = new THREE.LineSegments(rimGeo, edgeMat);
    rim.position.y = 0.08;
    rim.renderOrder = 4;
    group.add(rim);

    group.position.set(zone.x, 0, zone.z);
    this.group.add(group);
    this.zoneMarker = group;
  }

  /** Shows or hides the objective marker (zone modes only). */
  setZoneVisible(visible: boolean): void {
    if (this.zoneMarker) this.zoneMarker.visible = visible;
  }

  isZoneMarkerVisible(): boolean {
    return !!this.zoneMarker?.visible;
  }

  /** Tints the objective by the team currently holding it. */
  setZoneOwner(owner: Team | null): void {
    const color =
      owner === Team.PINK ? 0xff007f : owner === Team.CYAN ? 0x00ffff : 0xffffff;
    for (const mat of this.zoneMaterials) mat.color.setHex(color);
  }

  private buildBackdropTowers(): void {
    const theme = this.mapDef.theme;
    const towerMat = this.trackM(      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.sky).multiplyScalar(1.4),
        roughness: 0.95,
        metalness: 0
      })
    );
    const windowMat = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0x222a3c,
          emissive: theme.accentB,
          emissiveIntensity: 0.5,
          roughness: 0.6
        })
      ),
      0.18,
      0.7,
      1.4
    );
    const crownMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x1a1f2b,
        emissive: theme.accentA,
        emissiveIntensity: 0.65,
        roughness: 0.4
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
      { x: -far, y: 6, z: -base * 0.6, w: 6, h: 12, d: 7 },
      { x: -base * 0.86, y: 5, z: base * 0.82, w: 5, h: 10, d: 5 },
      { x: base * 0.86, y: 5, z: -base * 0.82, w: 5, h: 10, d: 5 },
      { x: base * 0.86, y: 5, z: base * 0.82, w: 5, h: 10, d: 5 },
      { x: -base * 0.86, y: 5, z: -base * 0.82, w: 5, h: 10, d: 5 }
    ];

    const bodies: Xform[] = [];
    const bands: Xform[] = [];
    const crowns: Xform[] = [];
    for (const t of towers) {
      bodies.push({ x: t.x, y: t.y, z: t.z, sx: t.w, sy: t.h, sz: t.d });

      const bandY = t.y + t.h * 0.15;
      if (Math.abs(t.x) > Math.abs(t.z)) {
        bands.push({
          x: t.x + (t.x > 0 ? -t.w / 2 - 0.06 : t.w / 2 + 0.06),
          y: bandY,
          z: t.z,
          sx: 0.1,
          sy: 0.35,
          sz: t.w * 0.7
        });
      } else {
        bands.push({
          x: t.x,
          y: bandY,
          z: t.z + (t.z > 0 ? -t.d / 2 - 0.06 : t.d / 2 + 0.06),
          sx: t.w * 0.7,
          sy: 0.35,
          sz: 0.1
        });
      }
      crowns.push({ x: t.x, y: t.y + t.h / 2 + 0.2, z: t.z, sx: t.w * 0.4, sy: 0.4, sz: t.d * 0.4 });
    }

    this.addInstanced(this.unitBox, towerMat, bodies);
    this.addInstanced(this.unitBox, windowMat, bands);
    this.addInstanced(this.unitBox, crownMat, crowns);
  }

  /** Signature props per map for a distinct silhouette and mood. */
  private buildMapProps(): void {
    const theme = this.mapDef.theme;
    const half = this.mapDef.size / 2;
    const accentA = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: theme.accentA,
          emissive: theme.accentA,
          emissiveIntensity: 0.6,
          roughness: 0.5
        })
      ),
      0.25,
      1.3
    );
    const accentB = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: theme.accentB,
          emissive: theme.accentB,
          emissiveIntensity: 0.55,
          roughness: 0.5
        })
      ),
      0.25,
      1.05,
      0.9
    );
    const metalMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: 0x565c6e, roughness: 0.45, metalness: 0.6 })
    );
    const darkMat = this.trackM(
      new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.7, metalness: 0.35 })
    );
    const glassMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x111a24,
        emissive: theme.accentB,
        emissiveIntensity: 0.35,
        roughness: 0.2,
        metalness: 0.6
      })
    );

    if (this.mapDef.id === 'downtown') {
      this.buildDowntownProps(half, accentA, accentB, metalMat, darkMat, glassMat);
    } else if (this.mapDef.id === 'cargo_docks') {
      this.buildCargoProps(half, accentA, accentB, metalMat, darkMat);
    } else if (this.mapDef.id === 'sky_rink') {
      this.buildSkyRinkProps(half, accentA, accentB, metalMat, darkMat, glassMat);
    } else {
      this.buildAuroraProps(half, accentA, accentB, metalMat, darkMat);
    }
  }

  private buildDowntownProps(
    half: number,
    accentA: THREE.Material,
    accentB: THREE.Material,
    metalMat: THREE.Material,
    darkMat: THREE.Material,
    glassMat: THREE.Material
  ): void {
    // Street lamp rows along both mid lanes
    const poleGeo = this.track(new THREE.CylinderGeometry(0.08, 0.11, 5.6, 8));
    const headGeo = this.track(new THREE.SphereGeometry(0.26, 10, 8));
    const armGeo = this.track(new THREE.BoxGeometry(1.4, 0.1, 0.1));
    const lamps: Xform[] = [];
    const heads: Xform[] = [];
    const arms: Xform[] = [];
    const laneOffsets = [half * 0.32, half * 0.62];
    for (const lx of laneOffsets) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          lamps.push({ x: sx * lx, y: 2.8, z: sz * half * 0.62 });
          heads.push({ x: sx * lx + sx * 1.1, y: 5.5, z: sz * half * 0.62 });
          arms.push({ x: sx * lx + sx * 0.6, y: 5.4, z: sz * half * 0.62 });
        }
      }
    }
    this.addInstanced(poleGeo, metalMat, lamps, true);
    this.addInstanced(headGeo, accentB, heads);
    this.addInstanced(armGeo, metalMat, arms);

    // Billboards near each base, with a slowly scrolling holo panel.
    // Frames batch into one draw per material; the holo panels stay separate
    // because each uses a different accent material.
    const boardGeo = this.track(new THREE.BoxGeometry(9, 3.4, 0.35));
    const holoGeo = this.track(new THREE.PlaneGeometry(8, 2.6));
    const boards: Xform[] = [];
    const holoA: Xform[] = [];
    const holoB: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        boards.push({ x: sx * (half - 6), y: 4.6, z: sz * half * 0.44, ry: (sx * Math.PI) / 2 });
        // West board fronts accentA, east fronts accentB (alternating per row).
        const useA = sx < 0 ? sz < 0 : sz > 0;
        (useA ? holoA : holoB).push({
          x: sx * (half - 6.2),
          y: 4.6,
          z: sz * half * 0.44,
          ry: (sx * Math.PI) / 2
        });
      }
    }
    this.addInstanced(boardGeo, darkMat, boards, true);
    this.addInstanced(holoGeo, accentA, holoA);
    this.addInstanced(holoGeo, accentB, holoB);

    // Rooftop water tanks on the corner panels
    const tankGeo = this.track(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 12));
    const legGeo = this.track(new THREE.BoxGeometry(0.16, 1.4, 0.16));
    const tanks: Xform[] = [];
    const legs: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * half * 0.72;
        const z = sz * half * 0.72;
        tanks.push({ x, y: 7.4, z });
        for (const lx of [-1, 1]) {
          for (const lz of [-1, 1]) {
            legs.push({ x: x + lx * 1.1, y: 5.5, z: z + lz * 1.1, sx: 0.16, sy: 1.4, sz: 0.16 });
          }
        }
      }
    }
    this.addInstanced(tankGeo, metalMat, tanks);
    this.addInstanced(this.unitBox, metalMat, legs);

    // Rotating shop sign over the mid lane
    const signGeo = this.track(new THREE.BoxGeometry(5.5, 1.6, 0.3));
    const sign = new THREE.Mesh(signGeo, glassMat);
    sign.position.set(0, 6.2, half * 0.24);
    this.group.add(sign);
    this.spin(sign, 0.5);
    const signPostGeo = this.track(new THREE.CylinderGeometry(0.16, 0.2, 6.2, 10));
    const post = new THREE.Mesh(signPostGeo, metalMat);
    post.position.set(0, 3.1, half * 0.24);
    post.castShadow = true;
    this.group.add(post);
  }

  private buildCargoProps(
    half: number,
    accentA: THREE.Material,
    accentB: THREE.Material,
    metalMat: THREE.Material,
    darkMat: THREE.Material
  ): void {
    // Gantry crane arm across the top of the mast, with a trolley + cable + hook
    const armGeo = this.track(new THREE.BoxGeometry(46, 0.7, 1.4));
    this.addInstanced(
      armGeo,
      metalMat,
      [
        { x: 12, y: 11.2, z: 0, rz: 0.03 },
        { x: -12, y: 11.2, z: 0, rz: -0.03 }
      ],
      true
    );

    const counterGeo = this.track(new THREE.BoxGeometry(4, 2.4, 2));
    const counter = new THREE.Mesh(counterGeo, darkMat);
    counter.position.set(-24, 11.0, 0);
    this.group.add(counter);

    const trolleyGeo = this.track(new THREE.BoxGeometry(3, 1.2, 2.4));
    const trolley = new THREE.Mesh(trolleyGeo, accentB);
    trolley.position.set(20, 10.3, 0);
    this.group.add(trolley);
    this.spin(trolley, 0.35, 'y');

    const cableGeo = this.track(new THREE.CylinderGeometry(0.06, 0.06, 5.2, 6));
    const cable = new THREE.Mesh(cableGeo, metalMat);
    cable.position.set(20, 7.6, 0);
    this.group.add(cable);

    const hookGeo = this.track(new THREE.TorusGeometry(0.8, 0.14, 8, 18, Math.PI * 1.4));
    const hook = new THREE.Mesh(hookGeo, accentA);
    hook.position.set(20, 4.8, 0);
    this.group.add(hook);

    // Container accent stripes on the long rows
    const stripes: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const ox of [0, 36]) {
          stripes.push({ x: sx * ox, y: 2.5, z: sz * 44, sx: 18.4, sy: 0.26, sz: 6.4 });
        }
      }
    }
    this.addInstanced(this.unitBox, accentB, stripes);

    // Floodlight poles at the corners, each with two lamp heads
    const poleGeo = this.track(new THREE.CylinderGeometry(0.16, 0.2, 9, 8));
    const lampGeo = this.track(new THREE.BoxGeometry(1.4, 0.5, 0.6));
    const poles: Xform[] = [];
    const lamps: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        poles.push({ x: sx * (half - 5), y: 4.5, z: sz * (half - 5) });
        lamps.push({ x: sx * (half - 5), y: 9.2, z: sz * (half - 5), ry: sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4 });
      }
    }
    this.addInstanced(poleGeo, metalMat, poles, true);
    this.addInstanced(lampGeo, accentB, lamps);

    // Mooring bollards along the west / east edges
    const bollardGeo = this.track(new THREE.CylinderGeometry(0.4, 0.55, 1.3, 10));
    const bollards: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (let i = -3; i <= 3; i++) {
        bollards.push({ x: sx * (half - 3.2), y: 0.65, z: i * (half / 4) });
      }
    }
    this.addInstanced(bollardGeo, metalMat, bollards, true);

    // Stacked container accents: a lit band around each tower
    const bands: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const by of [2.5, 3.7, 4.9]) {
          bands.push({ x: sx * 54, y: by, z: sz * 16, sx: 7.4, sy: 0.22, sz: 16.4 });
        }
      }
    }
    this.addInstanced(this.unitBox, accentA, bands);

    // Harbour light mast on the north / south centre
    const mastGeo = this.track(new THREE.CylinderGeometry(0.22, 0.3, 14, 10));
    const beaconGeo = this.track(new THREE.SphereGeometry(0.7, 12, 10));
    const beaconMat = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0xffd9a0,
          emissive: 0xffa629,
          emissiveIntensity: 0.8,
          roughness: 0.3
        })
      ),
      0.5,
      2.2
    );
    const masts: Xform[] = [];
    const beacons: Xform[] = [];
    for (const sz of [-1, 1]) {
      masts.push({ x: 0, y: 7, z: sz * (half - 8) });
      beacons.push({ x: 0, y: 14.4, z: sz * (half - 8) });
    }
    this.addInstanced(mastGeo, metalMat, masts, true);
    this.addInstanced(beaconGeo, beaconMat, beacons);
  }

  private buildSkyRinkProps(
    half: number,
    accentA: THREE.Material,
    accentB: THREE.Material,
    metalMat: THREE.Material,
    darkMat: THREE.Material,
    glassMat: THREE.Material
  ): void {
    // Stacked neon halos floating above the centre tower
    const haloGeo = this.track(new THREE.TorusGeometry(11, 0.18, 10, 56));
    const halo = new THREE.Mesh(haloGeo, accentA);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 9.2, 0);
    this.group.add(halo);
    this.spin(halo, 0.22, 'z');

    const halo2Geo = this.track(new THREE.TorusGeometry(8.4, 0.12, 10, 48));
    const halo2 = new THREE.Mesh(halo2Geo, accentB);
    halo2.rotation.x = Math.PI / 2;
    halo2.position.set(0, 8.4, 0);
    this.group.add(halo2);
    this.spin(halo2, -0.34, 'z');

    const halo3Geo = this.track(new THREE.TorusGeometry(6.2, 0.09, 8, 40));
    const halo3 = new THREE.Mesh(halo3Geo, accentA);
    halo3.rotation.x = Math.PI / 2;
    halo3.position.set(0, 7.7, 0);
    this.group.add(halo3);

    // Corner neon pylons with blinking tips
    const pylonGeo = this.track(new THREE.CylinderGeometry(0.18, 0.28, 7.2, 8));
    const tipGeo = this.track(new THREE.SphereGeometry(0.36, 10, 8));
    const tipMat = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.7,
          roughness: 0.3
        })
      ),
      0.55,
      2.6,
      0.4
    );
    const pylons: Xform[] = [];
    const tips: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pylons.push({ x: sx * (half - 4), y: 3.6, z: sz * (half - 4) });
        tips.push({ x: sx * (half - 4), y: 7.5, z: sz * (half - 4) });
      }
    }
    this.addInstanced(pylonGeo, accentA, pylons, true);
    this.addInstanced(tipGeo, tipMat, tips);

    // Jumbotron scoreboard facing the centre
    const jumboGeo = this.track(new THREE.BoxGeometry(7, 4, 0.6));
    const screenGeo = this.track(new THREE.PlaneGeometry(6, 3));
    const jumboFrames: Xform[] = [];
    const jumboScreens: Xform[] = [];
    for (const sx of [-1, 1]) {
      jumboFrames.push({ x: sx * (half - 9), y: 8.4, z: 0, ry: (sx * Math.PI) / 2 });
      jumboScreens.push({ x: sx * (half - 9.3), y: 8.4, z: 0, ry: (sx * Math.PI) / 2 });
    }
    this.addInstanced(jumboGeo, darkMat, jumboFrames, true);
    this.addInstanced(screenGeo, glassMat, jumboScreens);

    // Speaker stacks flanking the mid line
    const speakerGeo = this.track(new THREE.BoxGeometry(1.6, 2.6, 1.4));
    const drivers: Xform[] = [];
    const speakers: Xform[] = [];
    for (const sz of [-1, 1]) {
      for (const ox of [-1, 1]) {
        speakers.push({ x: ox * 4.5, y: 1.3, z: sz * 12, sx: 1.6, sy: 2.6, sz: 1.4 });
        drivers.push({ x: ox * 4.5, y: 2.0, z: sz * 12, sx: 1.0, sy: 1.0, sz: 0.2, rx: 0 });
      }
    }
    this.addInstanced(this.unitBox, darkMat, speakers, true);
    this.addInstanced(this.unitBox, accentB, drivers);

    // Safety railing around the deck edge
    const railPostGeo = this.track(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6));
    const railPosts: Xform[] = [];
    const railBars: Xform[] = [];
    const railSpan = this.mapDef.size - 10;
    const railOff = half - 2.6;
    for (let i = -4; i <= 4; i++) {
      const d = (i * railSpan) / 8;
      for (const s of [-1, 1]) {
        railPosts.push({ x: d, y: 0.55, z: s * railOff });
        railPosts.push({ x: s * railOff, y: 0.55, z: d });
      }
    }
    for (const s of [-1, 1]) {
      railBars.push({ x: 0, y: 1.05, z: s * railOff, sx: railSpan, sy: 0.08, sz: 0.08 });
      railBars.push({ x: s * railOff, y: 1.05, z: 0, sx: 0.08, sy: 0.08, sz: railSpan });
    }
    this.addInstanced(railPostGeo, metalMat, railPosts);
    this.addInstanced(this.unitBox, metalMat, railBars);

    // Disco ball spinning over the centre
    const ballGeo = this.track(new THREE.IcosahedronGeometry(1.1, 1));
    const ball = new THREE.Mesh(ballGeo, accentB);
    ball.position.set(0, 12.4, 0);
    this.group.add(ball);
    this.spin(ball, 0.9);
  }

  private buildAuroraProps(
    half: number,
    accentA: THREE.Material,
    accentB: THREE.Material,
    metalMat: THREE.Material,
    darkMat: THREE.Material
  ): void {
    // Aurora curtains: open partial cylinders ringing the outpost
    const curtainMatA = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0x54ffd0,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      })
    );
    const curtainMatB = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0x8a7dff,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      })
    );
    const curtainGeo = this.track(
      new THREE.CylinderGeometry(half * 1.15, half * 1.35, 46, 40, 1, true, 0, Math.PI * 1.1)
    );
    const curtainA = new THREE.Mesh(curtainGeo, curtainMatA);
    curtainA.position.y = 26;
    curtainA.userData.baseOpacity = 0.13;
    this.group.add(curtainA);
    this.auroraBands.push(curtainA);
    this.spin(curtainA, 0.02);

    const curtainGeoB = this.track(
      new THREE.CylinderGeometry(half * 1.4, half * 1.6, 36, 40, 1, true, Math.PI * 0.9, Math.PI * 0.9)
    );
    const curtainB = new THREE.Mesh(curtainGeoB, curtainMatB);
    curtainB.position.y = 34;
    curtainB.userData.baseOpacity = 0.11;
    this.group.add(curtainB);
    this.auroraBands.push(curtainB);
    this.spin(curtainB, -0.014);

    // Rotating radar dish on the central mast
    const yokeGeo = this.track(new THREE.BoxGeometry(1.2, 1.0, 1.2));
    const yoke = new THREE.Mesh(yokeGeo, metalMat);
    yoke.position.set(0, 11.4, 0);
    this.group.add(yoke);
    const dishGeo = this.track(new THREE.SphereGeometry(3.4, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42));
    const dishMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xd8e6f0,
        emissive: 0x54ffd0,
        emissiveIntensity: 0.12,
        roughness: 0.5,
        metalness: 0.2,
        side: THREE.DoubleSide
      })
    );
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.position.set(0, 12.4, 0);
    dish.rotation.z = Math.PI * 0.22;
    dish.rotation.y = Math.PI * 0.15;
    this.group.add(dish);
    this.spin(dish, 0.32);
    const feedGeo = this.track(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 6));
    const feed = new THREE.Mesh(feedGeo, metalMat);
    feed.position.set(0, 13.4, 0);
    feed.rotation.z = Math.PI * 0.22;
    this.group.add(feed);

    // Antenna masts with blinking beacons
    const mastGeo = this.track(new THREE.CylinderGeometry(0.14, 0.22, 11, 8));
    const sparGeo = this.track(new THREE.BoxGeometry(3.2, 0.12, 0.12));
    const beaconGeo = this.track(new THREE.SphereGeometry(0.42, 10, 8));
    const beaconMat = this.pulse(
      this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0xff5c5c,
          emissive: 0xff2d2d,
          emissiveIntensity: 0.9,
          roughness: 0.3
        })
      ),
      0.6,
      2.4,
      0.7
    );
    const masts: Xform[] = [];
    const spars: Xform[] = [];
    const beacons: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * half * 0.66;
        const z = sz * half * 0.66;
        masts.push({ x, y: 5.5, z });
        beacons.push({ x, y: 11.4, z });
        spars.push({ x, y: 8.4, z });
        spars.push({ x, y: 6.2, z, ry: Math.PI / 2 });
      }
    }
    this.addInstanced(mastGeo, metalMat, masts, true);
    this.addInstanced(sparGeo, metalMat, spars);
    this.addInstanced(beaconGeo, beaconMat, beacons);

    // Snow poles with reflective tops lining the flank lanes
    const snowPoleGeo = this.track(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6));
    const reflectorGeo = this.track(new THREE.BoxGeometry(0.3, 0.3, 0.3));
    const snowPoles: Xform[] = [];
    const reflectors: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const x = sx * (half - 6);
        const z = i * (half / 4);
        snowPoles.push({ x, y: 1.7, z });
        reflectors.push({ x, y: 3.5, z });
      }
    }
    this.addInstanced(snowPoleGeo, metalMat, snowPoles);
    this.addInstanced(reflectorGeo, accentA, reflectors);

    // Hangar door lights: emissive strips on the hangar faces
    const doorGeo = this.track(new THREE.BoxGeometry(18, 2.0, 0.25));
    const doors: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        doors.push({ x: sx * 58, y: 1.35, z: sz * 30 + sz * 7.2, sx: 18, sy: 2.0, sz: 0.25 });
      }
    }
    this.addInstanced(this.unitBox, accentB, doors);

    // Supply crate stripes
    const crateStripe: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        crateStripe.push({ x: sx * 20, y: 2.6, z: sz * 46, sx: 7.4, sy: 0.24, sz: 7.4 });
      }
    }
    this.addInstanced(this.unitBox, accentA, crateStripe);

    // Flag poles at the base corners
    const flagPoleGeo = this.track(new THREE.CylinderGeometry(0.12, 0.16, 8, 8));
    const flagGeo = this.track(new THREE.PlaneGeometry(3, 1.8));
    const flagMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0xe8f4ff,
        emissive: 0x54ffd0,
        emissiveIntensity: 0.18,
        side: THREE.DoubleSide,
        roughness: 0.8
      })
    );
    const flagPoles: Xform[] = [];
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        flagPoles.push({ x: sx * (half - 7), y: 4, z: sz * (half - 12) });

        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(sx * (half - 7) + 1.6, 7.1, sz * (half - 12));
        flag.rotation.y = Math.PI / 2;
        this.group.add(flag);
        this.spin(flag, 0.4 * sz, 'x');
      }
    }
    this.addInstanced(flagPoleGeo, metalMat, flagPoles, true);

    // Ice crystal shards near the walls
    const shardGeo = this.track(new THREE.ConeGeometry(0.8, 3.2, 6));
    const shards: Xform[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          shards.push({
            x: sx * (half - 3 - k * 2.4),
            y: 1.6,
            z: sz * (half * 0.3 + k * 4),
            rz: sx * 0.12,
            rx: sz * 0.1
          });
        }
      }
    }
    this.addInstanced(shardGeo, accentA, shards);
  }

  /**
   * Ambient life: drifting motes plus the pulsing/spinning registries filled by
   * the builders above. Driven from the sky dome's render hook so no per-frame
   * allocation happens and no external update call is needed.
   */
  private buildAmbientLife(): void {
    const theme = this.mapDef.theme;
    const moteColor =
      this.mapDef.id === 'aurora_outpost'
        ? 0xffffff
        : this.mapDef.id === 'cargo_docks'
          ? 0xffd9a0
          : this.mapDef.id === 'sky_rink'
            ? theme.accentB
            : theme.accentA;

    const count = 90;
    const moteGeo = this.track(new THREE.IcosahedronGeometry(0.16, 0));
    const moteMat = this.trackM(
      new THREE.MeshBasicMaterial({
        color: moteColor,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        fog: true
      })
    );
    const mesh = new THREE.InstancedMesh(moteGeo, moteMat, count);
    const base = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const half = this.mapDef.size / 2;

    for (let i = 0; i < count; i++) {
      // Deterministic scatter, no Math.random so rebuilds look identical.
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = half * (0.25 + 0.7 * (((i * 37) % 100) / 100));
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = 2 + ((i * 53) % 100) / 100 * 14;
      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
      phase[i] = ((i * 71) % 100) / 100 * Math.PI * 2;

      const s = 0.6 + ((i * 29) % 100) / 100 * 0.9;
      this.tmpMatrix.makeScale(s, s, s);
      this.tmpMatrix.setPosition(x, y, z);
      mesh.setMatrixAt(i, this.tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    this.motes = mesh;
    this.moteBase = base;
    this.motePhase = phase;
  }

  /**
   * Advances every time-based decoration. Called once per rendered frame from
   * the sky dome hook; all work is in-place so the render loop stays GC-free.
   */
  private animateAmbient(): void {
    const nowMs = performance.now();
    const dt = this.lastAnimMs === 0 ? 0.016 : Math.min(0.1, (nowMs - this.lastAnimMs) / 1000);
    this.lastAnimMs = nowMs;
    this.animTime += dt;
    const t = this.animTime;

    for (const p of this.pulsing) {
      p.mat.emissiveIntensity = p.base + Math.sin(t * p.speed + p.phase) * p.amp;
    }

    for (const s of this.spinners) {
      if (s.axis === 'y') s.obj.rotation.y = t * s.speed;
      else if (s.axis === 'x') s.obj.rotation.x = Math.sin(t * s.speed * 0.9) * 0.35;
      else s.obj.rotation.z = t * s.speed;
    }

    for (let i = 0; i < this.auroraBands.length; i++) {
      const band = this.auroraBands[i];
      if (!band) continue;
      const mat = band.material as THREE.MeshBasicMaterial;
      const base = band.userData.baseOpacity as number | undefined;
      if (base !== undefined) {
        mat.opacity = base * (0.75 + 0.25 * Math.sin(t * (0.22 + i * 0.13) + i));
      }
    }

    const motes = this.motes;
    const base = this.moteBase;
    const phase = this.motePhase;
    if (motes && base && phase) {
      // instanceMatrix elements are column-major: indices 12/13/14 are the
      // translation, so drifting only touches those and the scale is preserved.
      const arr = motes.instanceMatrix.array as Float32Array;
      const count = phase.length;
      for (let i = 0; i < count; i++) {
        const o = i * 16;
        const ph = phase[i] ?? 0;
        arr[o + 12] = (base[i * 3] ?? 0) + Math.sin(t * 0.22 + ph) * 2.2;
        arr[o + 13] = (base[i * 3 + 1] ?? 0) + Math.sin(t * 0.35 + ph) * 1.6;
        arr[o + 14] = (base[i * 3 + 2] ?? 0) + Math.cos(t * 0.19 + ph) * 2.2;
      }
      motes.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.teardown();
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
