import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PlayerMode, Team, Vec3, WeaponType } from '@ink/shared';

// ==========================================================================
// Cosmetic selection (pure + deterministic, exported for tests)
// ==========================================================================

export const HEADGEAR_COUNT = 6;
export const OUTFIT_COUNT = 5;
export const TANK_COUNT = 5;

export interface CosmeticSelection {
  headgear: number;
  outfit: number;
  tank: number;
}

/** Bit-mixing hash; salted per layer so similar ids do not correlate. */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Maps a player-id hash onto one index per cosmetic layer. The same id always
 * yields the same look; neighbouring ids scatter across the variant sets.
 */
export function selectCosmetics(variant: number): CosmeticSelection {
  const v = Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) >>> 0 : 0;
  return {
    headgear: mix32(v, 0x9e3779b9) % HEADGEAR_COUNT,
    outfit: mix32(v, 0x85ebca6b) % OUTFIT_COUNT,
    tank: mix32(v, 0xc2b2ae35) % TANK_COUNT
  };
}

// ==========================================================================
// Shared assets
//
// Every fighter needs the same primitives, materials and — per cosmetic
// variant — the same merged part geometry, so all of it lives in a
// module-level cache reference counted by the live PlayerViews. Nothing here
// is disposed by an individual view: releaseShared() tears the cache down when
// the last fighter disappears and merged geometry is ref-counted per cache key
// in releaseMerged(). Materials that animate per fighter (tank LED, ghost fade,
// drips, laser, nameplate) stay per-view in this.materials.
// ==========================================================================

type Slot = 'dark' | 'soft' | 'rubber' | 'team' | 'teamLight' | 'teamDark' | 'trim' | 'gold';

interface Palette {
  mats: Record<Slot, THREE.Material>;
  glow: THREE.MeshBasicMaterial;
  /** Double-sided team shell, for open vessels such as the ink bucket. */
  teamBack: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  liquid: THREE.MeshStandardMaterial;
  flash: THREE.MeshBasicMaterial;
  eyeWhite: THREE.MeshBasicMaterial;
  pupil: THREE.MeshBasicMaterial;
}

/** One merged geometry per material slot for a given static build. */
interface MergedSet {
  slot: Slot;
  geo: THREE.BufferGeometry;
}

interface SharedAssets {
  prims: Map<string, THREE.BufferGeometry>;
  builds: Map<string, MergedSet[]>;
  buildRefs: Map<string, number>;
  palettes: Map<number, Palette>;
  materials: THREE.Material[];
}

let sharedAssets: SharedAssets | null = null;
let sharedViews = 0;

function prim(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const assets = sharedAssets;
  if (!assets) return make();
  let geo = assets.prims.get(key);
  if (!geo) {
    geo = make();
    assets.prims.set(key, geo);
  }
  return geo;
}

function cyl(rt: number, rb: number, h: number, seg = 12, open = false): THREE.BufferGeometry {
  return prim(`cy|${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return prim(`bx|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function sph(r: number, wSeg = 10, hSeg = 8, theta = Math.PI): THREE.BufferGeometry {
  return prim(
    `sp|${r}|${wSeg}|${hSeg}|${theta}`,
    () => new THREE.SphereGeometry(r, wSeg, hSeg, 0, Math.PI * 2, 0, theta)
  );
}

function cap(r: number, len: number, cSeg = 4, rSeg = 8): THREE.BufferGeometry {
  return prim(`cp|${r}|${len}|${cSeg}|${rSeg}`, () => new THREE.CapsuleGeometry(r, len, cSeg, rSeg));
}

function torus(r: number, t: number, rSeg = 8, tSeg = 16, arc = Math.PI * 2): THREE.BufferGeometry {
  return prim(`to|${r}|${t}|${rSeg}|${tSeg}|${arc}`, () => new THREE.TorusGeometry(r, t, rSeg, tSeg, arc));
}

function cone(r: number, h: number, seg = 10): THREE.BufferGeometry {
  return prim(`cn|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

function ring(inner: number, outer: number, seg = 24): THREE.BufferGeometry {
  return prim(`rg|${inner}|${outer}|${seg}`, () => new THREE.RingGeometry(inner, outer, seg));
}

/** Tube swept along a Catmull-Rom path, for the tank supply hose. */
function hose(points: number[][], radius: number, radialSeg = 6): THREE.BufferGeometry {
  const key = `tb|${radius}|${points.map((p) => p.join(',')).join(';')}`;
  return prim(key, () => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return new THREE.TubeGeometry(curve, points.length * 6, radius, radialSeg, false);
  });
}

function makePalette(teamColorHex: number): Palette {
  const base = new THREE.Color(teamColorHex);
  const teamLight = base.clone().lerp(new THREE.Color(0xffffff), 0.42).getHex();
  const teamDark = base.clone().lerp(new THREE.Color(0x0a0a0f), 0.52).getHex();

  const mats: Record<Slot, THREE.Material> = {
    dark: new THREE.MeshStandardMaterial({ color: 0x1e1e24, roughness: 0.7, metalness: 0.3 }),
    soft: new THREE.MeshStandardMaterial({ color: 0x33333d, roughness: 0.85, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141419, roughness: 0.95, metalness: 0.05 }),
    team: new THREE.MeshStandardMaterial({ color: teamColorHex, roughness: 0.35, metalness: 0.2 }),
    teamLight: new THREE.MeshStandardMaterial({ color: teamLight, roughness: 0.3, metalness: 0.25 }),
    teamDark: new THREE.MeshStandardMaterial({ color: teamDark, roughness: 0.55, metalness: 0.2 }),
    trim: new THREE.MeshStandardMaterial({
      color: 0xdfe6f0,
      roughness: 0.25,
      metalness: 0.6,
      emissive: 0x9fb4cc,
      emissiveIntensity: 0.4
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xffc63a,
      roughness: 0.35,
      metalness: 0.55,
      emissive: 0x332200
    })
  };

  return {
    mats,
    glow: new THREE.MeshBasicMaterial({ color: teamColorHex }),
    teamBack: new THREE.MeshStandardMaterial({
      color: teamColorHex,
      roughness: 0.3,
      metalness: 0.2,
      side: THREE.DoubleSide
    }),
    visor: new THREE.MeshStandardMaterial({ color: 0xffee44, roughness: 0.1, metalness: 0.9, emissive: 0x443300 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      roughness: 0.1,
      transmission: 0.8
    }),
    liquid: new THREE.MeshStandardMaterial({ color: teamColorHex, roughness: 0.2, metalness: 0.4 }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
    eyeWhite: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    pupil: new THREE.MeshBasicMaterial({ color: 0x111111 })
  };
}

function acquireShared(teamColorHex: number): Palette {
  if (!sharedAssets) {
    sharedAssets = {
      prims: new Map(),
      builds: new Map(),
      buildRefs: new Map(),
      palettes: new Map(),
      materials: []
    };
  }
  sharedViews++;
  let palette = sharedAssets.palettes.get(teamColorHex);
  if (!palette) {
    palette = makePalette(teamColorHex);
    sharedAssets.palettes.set(teamColorHex, palette);
    for (const mat of Object.values(palette.mats)) sharedAssets.materials.push(mat);
    sharedAssets.materials.push(
      palette.glow,
      palette.teamBack,
      palette.visor,
      palette.glass,
      palette.liquid,
      palette.flash,
      palette.eyeWhite,
      palette.pupil
    );
  }
  return palette;
}

function releaseShared(): void {
  sharedViews = Math.max(0, sharedViews - 1);
  if (sharedViews > 0 || !sharedAssets) return;
  for (const geo of sharedAssets.prims.values()) geo.dispose();
  for (const set of sharedAssets.builds.values()) {
    for (const entry of set) entry.geo.dispose();
  }
  for (const mat of sharedAssets.materials) mat.dispose();
  sharedAssets = null;
}

// ==========================================================================
// Static part merging: many small primitives collapse into one mesh per
// material slot, so a fully detailed fighter still costs a handful of draws.
// ==========================================================================

interface PartSpec {
  slot: Slot;
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

const scratchEuler = new THREE.Euler();
const scratchQuat = new THREE.Quaternion();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();

/**
 * Which built model group each weapon uses, and therefore which arm pose, roll
 * animation and laser sight apply. Only four models exist; newer weapons map to
 * the archetype they play like, so adding a weapon never leaves the fighter
 * empty-handed or stuck in a default pose.
 */
const WEAPON_MODEL_GROUP: Record<WeaponType, 'shooter' | 'roller' | 'charger' | 'slosher'> = {
  shooter: 'shooter',
  sprayer: 'shooter',
  scatter: 'shooter',
  cannon: 'slosher',
  marksman: 'charger',
  roller: 'roller',
  charger: 'charger',
  slosher: 'slosher'
};

function addPart(
  parts: PartSpec[],
  slot: Slot,
  geo: THREE.BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1
): void {
  scratchEuler.set(rx, ry, rz);
  scratchQuat.setFromEuler(scratchEuler);
  scratchPos.set(x, y, z);
  scratchScale.set(sx, sy, sz);
  const matrix = new THREE.Matrix4();
  matrix.compose(scratchPos, scratchQuat, scratchScale);
  parts.push({ slot, geo, matrix });
}

interface StaticBuild {
  meshes: THREE.Mesh[];
  keys: string[];
}

function buildStatic(parts: PartSpec[], key: string, palette: Palette): StaticBuild {
  const assets = sharedAssets;
  const meshes: THREE.Mesh[] = [];
  const keys: string[] = [];
  if (!assets || parts.length === 0) return { meshes, keys };

  // Merging is the expensive part, so the whole per-slot result is cached
  // under the build key: a second fighter with the same look reuses it as is.
  let set = assets.builds.get(key);
  if (!set) {
    const bySlot = new Map<Slot, THREE.BufferGeometry[]>();
    const clones: THREE.BufferGeometry[] = [];
    for (const part of parts) {
      const clone = part.geo.clone();
      clone.applyMatrix4(part.matrix);
      clones.push(clone);
      const list = bySlot.get(part.slot);
      if (list) list.push(clone);
      else bySlot.set(part.slot, [clone]);
    }

    set = [];
    for (const [slot, list] of bySlot) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      set.push({ slot, geo: merged });
    }
    for (const clone of clones) clone.dispose();
    assets.builds.set(key, set);
    assets.buildRefs.set(key, 0);
  }

  assets.buildRefs.set(key, (assets.buildRefs.get(key) ?? 0) + 1);
  for (const entry of set) meshes.push(new THREE.Mesh(entry.geo, palette.mats[entry.slot]));
  keys.push(key);
  return { meshes, keys };
}

// ==========================================================================

export class PlayerView {
  readonly group = new THREE.Group();

  private humanoidGroup = new THREE.Group();
  private submergedGroup = new THREE.Group();

  // Procedural body parts
  private torsoGroup = new THREE.Group();
  private headGroup = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftForearm = new THREE.Group();
  private rightForearm = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private tankGroup = new THREE.Group();
  private hairTufts: THREE.Group[] = [];
  private hairBaseX: number[] = [];
  private hairBaseZ: number[] = [];
  private tankLiquidMesh!: THREE.Mesh;
  private tankLiquidHalf = 0.29;
  private tankLedMesh!: THREE.Mesh;
  private ledMat!: THREE.MeshBasicMaterial;
  private squidEyeGroups: THREE.Group[] = [];
  private ghostGroup = new THREE.Group();
  private ghostMaterials: (THREE.Material & { opacity: number })[] = [];
  private ghostOpacity: number[] = [];
  private ghostActive = false;
  private ghostTime = 0;

  // Weapon models
  private weaponAnchor = new THREE.Group();
  private shooterGroup = new THREE.Group();
  private rollerGroup = new THREE.Group();
  private chargerGroup = new THREE.Group();
  private slosherGroup = new THREE.Group();
  private muzzleFlashMesh!: THREE.Mesh;
  private rollerCylinderMesh?: THREE.Mesh;
  private chargerLaserMesh?: THREE.Mesh;

  // Squid swimming parts
  private rippleMesh!: THREE.Mesh;
  private rippleInnerMesh!: THREE.Mesh;
  private squidDomeGroup = new THREE.Group();
  private squidFinGroups: THREE.Group[] = [];
  private swimTentacles: THREE.Group[] = [];

  // Ink drips
  private dripMeshes: THREE.Mesh[] = [];
  private dripLife: number[] = [];
  private dripVel: number[] = [];
  private dripTimer = 0;

  private palette!: Palette;
  private teamColorHex: number;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  /** Merged keys owned by the cosmetic body build (rebuilt on variant change). */
  private bodyKeys: string[] = [];
  /** Merged keys built once for the lifetime of the view. */
  private staticKeys: string[] = [];
  private selection: CosmeticSelection = selectCosmetics(0);
  private disposed = false;

  private currentMode: PlayerMode = PlayerMode.HUMANOID;
  private currentWeapon: WeaponType = 'shooter';

  // Animation state
  private walkPhase = 0;
  private recoilOffset = 0;
  private flashTimer = 0;
  private squashStretchY = 1.0;
  private aimPitch = 0;
  private diveTransitionTimer = 0;
  private idlePhase = Math.random() * Math.PI * 2;
  private tentacleSway = 0;
  private armSwing = 0;

  // Floating 3D Nameplate
  private nameplateSprite?: THREE.Sprite;
  private nameplateTexture?: THREE.CanvasTexture;
  private playerName = '';
  private cosmeticsApplied = false;

  constructor(team: Team) {
    this.teamColorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
    this.palette = acquireShared(this.teamColorHex);

    // Per-view animated materials (never shared between fighters)
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.materials.push(this.ledMat);
    const dripMat = new THREE.MeshStandardMaterial({
      color: this.teamColorHex,
      roughness: 0.2,
      metalness: 0.35,
      transparent: true,
      opacity: 0.95
    });
    this.materials.push(dripMat);

    this.torsoGroup.position.y = 0.85;
    this.headGroup.position.y = 0.55;
    this.humanoidGroup.add(this.torsoGroup);
    this.buildBody();
    this.buildWeapons();
    this.buildDrips(dripMat);
    this.humanoidGroup.add(this.weaponAnchor);
    this.group.add(this.humanoidGroup);

    this.buildSubmergedForm();
    this.buildGhost();
  }

  // ========================================================================
  // 1. Humanoid body
  // ========================================================================

  private addStatic(
    parts: PartSpec[],
    key: string,
    parent: THREE.Object3D,
    castShadow = false,
    track: 'body' | 'static' = 'body'
  ): void {
    const built = buildStatic(parts, key, this.palette);
    const list = track === 'body' ? this.bodyKeys : this.staticKeys;
    for (const mergedKey of built.keys) list.push(mergedKey);
    for (const mesh of built.meshes) {
      mesh.castShadow = castShadow;
      parent.add(mesh);
    }
  }

  private buildBody(): void {
    this.releaseBodyMerges();
    this.torsoGroup.clear();
    this.headGroup.clear();
    this.tankGroup.clear();
    this.leftArm.clear();
    this.rightArm.clear();
    this.leftForearm.clear();
    this.rightForearm.clear();
    this.leftLeg.clear();
    this.rightLeg.clear();
    this.hairTufts = [];
    this.hairBaseX = [];
    this.hairBaseZ = [];

    this.torsoGroup.add(this.headGroup, this.tankGroup);
    // Torso shell, backpack statics and the head share one mesh set per
    // material slot; only the animated sub-groups stay separate.
    const torsoParts: PartSpec[] = [];
    const headParts: PartSpec[] = [];
    this.buildTorso(torsoParts);
    this.buildTank(torsoParts);
    this.buildHead(headParts);
    this.buildHeadgear(headParts);
    this.addStatic(torsoParts, `torso|${this.selection.outfit}|${this.selection.tank}`, this.torsoGroup, true);
    this.addStatic(headParts, `head|${this.selection.headgear}`, this.headGroup, true);
    this.buildHair();
    this.buildArms();
    this.buildLegs();
  }

  private buildTorso(parts: PartSpec[]): void {
    const outfit = this.selection.outfit;

    // Undersuit core + chest and abdomen panels + shoulder yoke
    addPart(parts, 'dark', cyl(0.3, 0.34, 0.75, 16));
    addPart(parts, 'soft', box(0.34, 0.34, 0.06), 0, 0.1, -0.3);
    addPart(parts, 'soft', box(0.3, 0.2, 0.05), 0, -0.16, -0.31);
    addPart(parts, 'soft', cyl(0.34, 0.3, 0.14, 16), 0, 0.32, 0);

    if (outfit === 1) {
      // Cropped vest: chest only, exposed waist
      addPart(parts, 'team', cyl(0.315, 0.345, 0.36, 16), 0, 0.16, 0);
      addPart(parts, 'trim', torus(0.35, 0.022, 6, 18), 0, -0.02, 0, Math.PI / 2);
      addPart(parts, 'teamLight', box(0.1, 0.2, 0.03), -0.16, 0.14, -0.31);
      addPart(parts, 'teamLight', box(0.1, 0.2, 0.03), 0.16, 0.14, -0.31);
    } else if (outfit === 2) {
      // Long parka: tall collar plus flared skirt hem
      addPart(parts, 'team', cyl(0.315, 0.36, 0.62, 16), 0, 0.08, 0);
      addPart(parts, 'team', cyl(0.36, 0.42, 0.34, 16, true), 0, -0.5, 0);
      addPart(parts, 'trim', torus(0.42, 0.025, 6, 20), 0, -0.66, 0, Math.PI / 2);
      addPart(parts, 'soft', cyl(0.26, 0.24, 0.16, 14), 0, 0.42, 0);
      addPart(parts, 'teamLight', box(0.05, 0.5, 0.03), 0, 0.06, -0.34);
    } else if (outfit === 3) {
      // Plated armour: chest plate, side plates, spine ridge
      addPart(parts, 'team', cyl(0.315, 0.35, 0.5, 16), 0, 0.1, 0);
      addPart(parts, 'trim', box(0.36, 0.3, 0.08), 0, 0.12, -0.3);
      addPart(parts, 'trim', box(0.1, 0.24, 0.08), -0.2, 0.1, -0.29, 0, 0.25);
      addPart(parts, 'trim', box(0.1, 0.24, 0.08), 0.2, 0.1, -0.29, 0, -0.25);
      addPart(parts, 'soft', box(0.06, 0.44, 0.06), 0, 0.08, 0.33);
      addPart(parts, 'trim', box(0.22, 0.05, 0.05), 0, -0.12, -0.33);
    } else if (outfit === 4) {
      // Two-tone raglan: light shell with a dark centre stripe
      addPart(parts, 'teamLight', cyl(0.318, 0.35, 0.52, 16), 0, 0.1, 0);
      addPart(parts, 'teamDark', box(0.2, 0.52, 0.06), 0, 0.1, -0.33);
      addPart(parts, 'trim', torus(0.35, 0.02, 6, 18), 0, -0.16, 0, Math.PI / 2);
      addPart(parts, 'team', box(0.06, 0.44, 0.04), 0, 0.12, -0.36);
    } else {
      // Standard team jacket
      addPart(parts, 'team', cyl(0.315, 0.35, 0.5, 16), 0, 0.1, 0);
      addPart(parts, 'teamLight', box(0.04, 0.44, 0.03), 0, 0.1, -0.35);
      addPart(parts, 'trim', torus(0.345, 0.022, 6, 18), 0, -0.15, 0, Math.PI / 2);
    }

    // Collar, neck, chest emblem
    addPart(parts, 'soft', cyl(0.2, 0.24, 0.12, 14), 0, 0.4, 0);
    addPart(parts, 'dark', cyl(0.11, 0.13, 0.16, 12), 0, 0.42, 0);
    addPart(parts, 'trim', torus(0.25, 0.03, 6, 18), 0, 0.36, 0, Math.PI / 2);
    addPart(parts, 'trim', cyl(0.07, 0.07, 0.03, 14), 0, 0.18, -0.33, Math.PI / 2);
    addPart(parts, 'teamLight', torus(0.088, 0.014, 6, 18), 0, 0.18, -0.34);

    // Belt, buckle, waist, hips
    addPart(parts, 'rubber', torus(0.365, 0.035, 8, 20), 0, -0.32, 0, Math.PI / 2);
    addPart(parts, 'trim', box(0.11, 0.08, 0.04), 0, -0.32, -0.395);
    addPart(parts, 'dark', cyl(0.29, 0.25, 0.2, 14), 0, -0.43, 0);
    addPart(parts, 'team', sph(0.09, 8, 8), -0.24, -0.42, 0);
    addPart(parts, 'team', sph(0.09, 8, 8), 0.24, -0.42, 0);
    addPart(parts, 'soft', box(0.1, 0.12, 0.05), -0.16, -0.46, -0.24, 0, 0.3);
    addPart(parts, 'soft', box(0.1, 0.12, 0.05), 0.16, -0.46, -0.24, 0, -0.3);

    // Harness straps over the shoulders
    addPart(parts, 'rubber', box(0.06, 0.52, 0.025), -0.14, 0.12, 0.315, -0.1);
    addPart(parts, 'rubber', box(0.06, 0.52, 0.025), 0.14, 0.12, 0.315, -0.1);
    addPart(parts, 'trim', box(0.08, 0.05, 0.04), -0.14, 0.1, 0.3);
    addPart(parts, 'trim', box(0.08, 0.05, 0.04), 0.14, 0.1, 0.3);
  }

  private buildHead(parts: PartSpec[]): void {

    // Skull, brow ridge, cheeks, jaw, chin
    addPart(parts, 'team', sph(0.3, 18, 14));
    addPart(parts, 'team', box(0.34, 0.05, 0.11), 0, 0.17, -0.19, -0.2);
    addPart(parts, 'team', sph(0.085, 8, 8), -0.2, -0.07, -0.19);
    addPart(parts, 'team', sph(0.085, 8, 8), 0.2, -0.07, -0.19);
    addPart(parts, 'soft', sph(0.11, 8, 8), 0, -0.14, -0.16);

    // Pointed ear forms
    addPart(parts, 'team', cone(0.06, 0.15, 6), -0.3, 0.02, 0.02, 0, 0, Math.PI / 2);
    addPart(parts, 'team', cone(0.06, 0.15, 6), 0.3, 0.02, 0.02, 0, 0, -Math.PI / 2);
    addPart(parts, 'dark', sph(0.05, 6, 6), -0.27, 0.02, 0.02);
    addPart(parts, 'dark', sph(0.05, 6, 6), 0.27, 0.02, 0.02);

    // Visor, eye glow strips, shine, jaw guard, mouth vents
    addPart(parts, 'dark', box(0.37, 0.13, 0.19), 0, 0.05, -0.22);
    addPart(parts, 'soft', box(0.36, 0.02, 0.17), 0, -0.01, -0.24);
    addPart(parts, 'trim', box(0.3, 0.018, 0.03), 0, 0.115, -0.29);
    addPart(parts, 'trim', box(0.09, 0.05, 0.02), -0.1, 0.05, -0.3);
    addPart(parts, 'trim', box(0.09, 0.05, 0.02), 0.1, 0.05, -0.3);
    addPart(parts, 'dark', box(0.28, 0.1, 0.14), 0, -0.06, -0.24);
    addPart(parts, 'rubber', box(0.16, 0.02, 0.02), 0, -0.11, -0.3);
    addPart(parts, 'rubber', box(0.16, 0.02, 0.02), 0, -0.15, -0.28);

    // Crown nubs give volume behind the headset band
    addPart(parts, 'team', cap(0.05, 0.12, 3, 6), 0, 0.26, 0.12, -0.5);
    addPart(parts, 'team', cap(0.04, 0.1, 3, 6), -0.12, 0.25, 0.16, -0.7, 0, 0.3);
    addPart(parts, 'team', cap(0.04, 0.1, 3, 6), 0.12, 0.25, 0.16, -0.7, 0, -0.3);

    // Streetwear headset: band, ear cups, mic boom
    addPart(parts, 'rubber', torus(0.32, 0.035, 8, 16, Math.PI), 0, 0.08, 0, -Math.PI / 2, 0, Math.PI);
    addPart(parts, 'team', cyl(0.11, 0.11, 0.09, 12), -0.32, 0.04, 0, 0, 0, Math.PI / 2);
    addPart(parts, 'team', cyl(0.11, 0.11, 0.09, 12), 0.32, 0.04, 0, 0, 0, Math.PI / 2);
    addPart(parts, 'trim', torus(0.075, 0.012, 6, 12), -0.37, 0.04, 0, 0, 0, Math.PI / 2);
    addPart(parts, 'trim', torus(0.075, 0.012, 6, 12), 0.37, 0.04, 0, 0, 0, Math.PI / 2);
    addPart(parts, 'rubber', cyl(0.012, 0.012, 0.2, 6), -0.34, -0.02, -0.12, Math.PI / 2, 0, 0.2);
    addPart(parts, 'trim', sph(0.03, 6, 6), -0.3, -0.03, -0.24);
  }

  /** Four animated tufts, each a small merge of tapered locks. */
  private buildHair(): void {
    const tufts = [
      { x: -0.17, y: 0.0, z: 0.17, rz: 0.26, rx: -0.34, flip: -1, long: true },
      { x: 0.17, y: 0.0, z: 0.17, rz: -0.26, rx: -0.34, flip: 1, long: true },
      { x: -0.13, y: 0.14, z: 0.25, rz: 0.34, rx: -0.95, flip: -1, long: false },
      { x: 0.13, y: 0.14, z: 0.25, rz: -0.34, rx: -0.95, flip: 1, long: false }
    ];

    for (let i = 0; i < tufts.length; i++) {
      const spec = tufts[i];
      if (!spec) continue;
      const group = new THREE.Group();
      group.position.set(spec.x, spec.y, spec.z);
      group.rotation.set(spec.rx, 0, spec.rz);

      const mainR = spec.long ? 0.082 : 0.058;
      const mainLen = spec.long ? 0.34 : 0.3;
      const parts: PartSpec[] = [];
      // Main lock tapering into a bulbous tip
      addPart(parts, 'team', cap(mainR, mainLen, 4, 8), 0, -(mainLen * 0.5 + 0.06), 0);
      addPart(parts, 'team', cap(mainR * 0.78, mainLen * 0.62, 4, 8), spec.flip * 0.055, -(mainLen * 0.62 + 0.1), 0.03);
      addPart(parts, 'team', sph(mainR * 0.92, 8, 8), spec.flip * 0.02, -(mainLen + 0.16), 0.02);
      // Shorter outer lock gives the layered read
      addPart(parts, 'team', cap(mainR * 0.6, mainLen * 0.5, 3, 6), spec.flip * 0.11, -(mainLen * 0.4 + 0.05), -0.03, 0.2, 0, spec.flip * 0.2);
      addPart(parts, 'teamLight', sph(mainR * 0.45, 6, 6), spec.flip * 0.14, -(mainLen * 0.75 + 0.08), -0.05);

      this.addStatic(parts, `hair|${i}`, group);
      this.headGroup.add(group);
      this.hairTufts.push(group);
      this.hairBaseX.push(spec.rx);
      this.hairBaseZ.push(spec.rz);
    }
  }

  private buildArms(): void {
    const outfit = this.selection.outfit;
    const sleeveless = outfit === 1;
    const plated = outfit === 3;
    const raglan = outfit === 4;

    for (let side = -1; side <= 1; side += 2) {
      const upper = side < 0 ? this.leftArm : this.rightArm;
      const fore = side < 0 ? this.leftForearm : this.rightForearm;
      upper.position.set(side * 0.38, 1.15, 0);
      fore.position.set(0, -0.24, 0);

      const upperParts: PartSpec[] = [];
      const foreParts: PartSpec[] = [];

      // Shoulder pad + rim + strap
      addPart(upperParts, 'team', sph(0.13, 12, 10), 0, 0.02, 0);
      addPart(upperParts, 'trim', torus(0.125, 0.018, 6, 16), 0, -0.03, 0, Math.PI / 2);
      if (plated) addPart(upperParts, 'trim', box(0.16, 0.1, 0.18), side * 0.06, 0.06, 0, 0, 0, side * 0.35);

      // Upper arm + sleeve treatment
      addPart(upperParts, 'dark', cap(0.072, 0.16, 4, 8), 0, -0.11, 0);
      if (sleeveless) {
        addPart(upperParts, 'team', torus(0.088, 0.03, 6, 14), 0, -0.06, 0, Math.PI / 2);
        addPart(upperParts, 'team', box(0.05, 0.12, 0.05), side * 0.04, -0.1, -0.04);
      } else {
        addPart(upperParts, raglan ? 'teamLight' : 'team', cyl(0.098, 0.086, 0.2, 12), 0, -0.11, 0);
        addPart(upperParts, 'trim', torus(0.088, 0.016, 6, 14), 0, -0.2, 0, Math.PI / 2);
        if (plated) addPart(upperParts, 'trim', box(0.14, 0.09, 0.14), 0, -0.12, -0.02);
      }

      // Elbow joint, forearm, guard
      addPart(upperParts, 'rubber', sph(0.072, 8, 8), 0, -0.24, 0);
      addPart(foreParts, 'dark', cap(0.064, 0.14, 4, 8), 0, -0.08, 0);
      addPart(foreParts, 'team', cyl(0.078, 0.068, 0.13, 12), 0, -0.07, 0);
      addPart(foreParts, 'trim', torus(0.07, 0.015, 6, 14), 0, -0.15, 0, Math.PI / 2);

      // Glove: palm, knuckle ridge, thumb
      addPart(foreParts, 'rubber', sph(0.078, 8, 8), 0, -0.2, 0);
      addPart(foreParts, 'dark', box(0.09, 0.05, 0.11), 0, -0.23, -0.02);
      addPart(foreParts, 'dark', cap(0.028, 0.05, 3, 6), side * -0.07, -0.21, -0.03, 0, 0, side * 0.7);

      this.addStatic(upperParts, `armUp|${outfit}`, upper, true);
      this.addStatic(foreParts, `armLo|${outfit}`, fore, true);
      upper.add(fore);
      this.humanoidGroup.add(upper);
    }
  }

  private buildLegs(): void {
    const outfit = this.selection.outfit;
    const plated = outfit === 3;
    const longSkirt = outfit === 2;

    for (let side = -1; side <= 1; side += 2) {
      const leg = side < 0 ? this.leftLeg : this.rightLeg;
      leg.position.set(side * 0.16, 0.57, 0);

      const parts: PartSpec[] = [];

      // Thigh + short overlay
      addPart(parts, 'dark', cap(0.095, 0.18, 4, 8), 0, -0.12, 0);
      if (!longSkirt) {
        addPart(parts, 'team', cyl(0.115, 0.104, 0.18, 12), 0, -0.11, 0);
        addPart(parts, 'trim', torus(0.108, 0.016, 6, 14), 0, -0.2, 0, Math.PI / 2);
      }

      // Knee joint, pad, strap
      addPart(parts, 'rubber', sph(0.085, 8, 8), 0, -0.28, 0);
      addPart(parts, 'team', sph(0.078, 8, 8), 0, -0.33, -0.045);
      addPart(parts, 'trim', torus(0.088, 0.014, 6, 14), 0, -0.31, 0, Math.PI / 2);
      if (plated) addPart(parts, 'trim', box(0.12, 0.1, 0.06), 0, -0.33, -0.08);

      // Shin + guard
      addPart(parts, 'dark', cap(0.08, 0.15, 4, 8), 0, -0.4, 0, -0.05);
      addPart(parts, 'team', box(0.125, 0.15, 0.04), 0, -0.42, -0.09, -0.05);
      if (plated) addPart(parts, 'trim', box(0.1, 0.07, 0.05), 0, -0.36, -0.09);

      // Ankle, boot, toe cap, heel, sole, laces
      addPart(parts, 'rubber', sph(0.07, 8, 8), 0, -0.5, 0);
      addPart(parts, 'team', box(0.16, 0.12, 0.25), 0, -0.49, -0.05);
      addPart(parts, 'trim', box(0.135, 0.07, 0.07), 0, -0.5, -0.16);
      addPart(parts, 'soft', box(0.15, 0.09, 0.07), 0, -0.5, 0.08);
      addPart(parts, 'rubber', box(0.19, 0.045, 0.29), 0, -0.555, -0.05);
      addPart(parts, 'trim', box(0.1, 0.015, 0.02), 0, -0.44, -0.16);
      addPart(parts, 'trim', box(0.1, 0.015, 0.02), 0, -0.47, -0.17);

      this.addStatic(parts, `leg|${outfit}`, leg, true);
      this.humanoidGroup.add(leg);
    }
  }

  private buildTank(parts: PartSpec[]): void {
    const variant = this.selection.tank;
    // tankGroup sits at this offset inside the torso; the merged static parts
    // below are authored in tank-local space and shifted into torso space.
    const tankX = 0;
    const tankY = 0.1;
    const tankZ = 0.32;
    this.tankGroup.position.set(tankX, tankY, tankZ);
    const tall = variant === 2;
    const flask = variant === 3;
    const caged = variant === 4;
    const bodyH = tall ? 0.78 : flask ? 0.56 : 0.65;
    const bodyR = tall ? 0.15 : 0.16;
    const capY = bodyH / 2 + 0.04;
    const tankPart = (
      list: PartSpec[],
      slot: Slot,
      geo: THREE.BufferGeometry,
      x = 0,
      y = 0,
      z = 0,
      rx = 0,
      ry = 0,
      rz = 0,
      sx = 1,
      sy = 1,
      sz = 1
    ): void => {
      addPart(list, slot, geo, tankX + x, tankY + y, tankZ + z, rx, ry, rz, sx, sy, sz);
    };

    // Glass vessel (own mesh so the liquid inside can scale independently)
    const tankOuter = new THREE.Mesh(cyl(bodyR, bodyR, bodyH, 14), this.palette.glass);
    this.tankGroup.add(tankOuter);

    this.tankLiquidMesh = new THREE.Mesh(cyl(bodyR - 0.02, bodyR - 0.02, bodyH - 0.07, 14), this.palette.liquid);
    this.tankLiquidHalf = (bodyH - 0.07) / 2;
    this.tankGroup.add(this.tankLiquidMesh);

    // Caps, threading, bracket rings, valve
    tankPart(parts, 'dark', cyl(bodyR + 0.01, bodyR + 0.01, 0.08, 14), 0, capY, 0);
    tankPart(parts, 'dark', cyl(bodyR + 0.01, bodyR + 0.01, 0.08, 14), 0, -capY, 0);
    tankPart(parts, 'trim', torus(bodyR + 0.015, 0.012, 6, 16), 0, capY - 0.02, 0, Math.PI / 2);
    tankPart(parts, 'trim', torus(bodyR + 0.015, 0.012, 6, 16), 0, capY - 0.05, 0, Math.PI / 2);
    tankPart(parts, 'rubber', torus(bodyR + 0.005, 0.018, 8, 18), 0, 0.18, 0, Math.PI / 2);
    tankPart(parts, 'rubber', torus(bodyR + 0.005, 0.018, 8, 18), 0, -0.18, 0, Math.PI / 2);
    tankPart(parts, 'dark', cyl(0.035, 0.045, 0.09, 8), 0, -capY - 0.06, 0);
    tankPart(parts, 'trim', sph(0.03, 6, 6), 0, -capY - 0.11, 0);

    // Mounting bracket tying the tank to the harness
    tankPart(parts, 'soft', box(0.24, 0.07, 0.06), 0, 0.02, -0.12);
    tankPart(parts, 'soft', box(0.07, 0.3, 0.05), 0, 0.02, -0.13);
    tankPart(parts, 'trim', box(0.28, 0.04, 0.03), 0, 0.16, -0.11);

    // Gauge face, needle and bezel (axis along X, facing outward)
    const gaugeX = bodyR + 0.03;
    const gaugeY = caged ? 0.24 : 0.1;
    tankPart(parts, 'trim', cyl(0.058, 0.058, 0.03, 12), gaugeX, gaugeY, 0, 0, 0, Math.PI / 2);
    tankPart(parts, 'rubber', cyl(0.042, 0.042, 0.032, 12), gaugeX, gaugeY, 0, 0, 0, Math.PI / 2);
    tankPart(parts, 'trim', torus(0.062, 0.01, 6, 14), gaugeX + 0.005, gaugeY, 0, 0, Math.PI / 2);
    tankPart(parts, 'dark', box(0.006, 0.042, 0.008), gaugeX + 0.017, gaugeY, 0, 0.6);
    tankPart(parts, 'dark', sph(0.008, 6, 6), gaugeX + 0.017, gaugeY, 0);

    if (variant === 1) {
      // Twin side pods
      tankPart(parts, 'team', cyl(0.062, 0.062, 0.26, 10), -0.21, -0.05, 0.02);
      tankPart(parts, 'team', cyl(0.062, 0.062, 0.26, 10), 0.21, -0.05, 0.02);
      tankPart(parts, 'dark', sph(0.062, 8, 6), -0.21, 0.09, 0.02);
      tankPart(parts, 'dark', sph(0.062, 8, 6), 0.21, 0.09, 0.02);
      tankPart(parts, 'trim', torus(0.066, 0.012, 6, 14), -0.21, -0.14, 0.02, Math.PI / 2);
      tankPart(parts, 'trim', torus(0.066, 0.012, 6, 14), 0.21, -0.14, 0.02, Math.PI / 2);
    } else if (flask) {
      // Rounded flask with a domed shoulder and waist band
      tankPart(parts, 'team', sph(bodyR - 0.02, 12, 8, Math.PI / 2), 0, bodyH / 2 - 0.02, 0);
      tankPart(parts, 'trim', torus(bodyR + 0.02, 0.02, 6, 18), 0, 0, 0, Math.PI / 2);
    } else if (tall) {
      // Extended tank with an outward ID plate and clamp bars
      tankPart(parts, 'team', box(0.2, 0.2, 0.04), 0, 0.02, bodyR + 0.02);
      tankPart(parts, 'trim', box(0.36, 0.04, 0.05), 0, 0.3, 0);
      tankPart(parts, 'trim', box(0.36, 0.04, 0.05), 0, -0.3, 0);
    } else if (caged) {
      // Protective frame: side rails plus two straps
      tankPart(parts, 'soft', box(0.03, 0.6, 0.06), -(bodyR + 0.03), 0, 0);
      tankPart(parts, 'soft', box(0.03, 0.6, 0.06), bodyR + 0.03, 0, 0);
      tankPart(parts, 'soft', box(0.42, 0.035, 0.06), 0, 0.24, 0);
      tankPart(parts, 'soft', box(0.42, 0.035, 0.06), 0, -0.24, 0);
      tankPart(parts, 'trim', torus(0.06, 0.014, 6, 14, Math.PI), 0, bodyH / 2 + 0.06, 0);
    }

    // Warning LED + pressure antenna with glowing tip
    this.tankLedMesh = new THREE.Mesh(sph(0.045, 8, 8), this.ledMat);
    this.tankLedMesh.position.set(0, bodyH / 2 + 0.11, 0);
    this.tankGroup.add(this.tankLedMesh);

    tankPart(parts, 'dark', cyl(0.008, 0.008, 0.22, 6), 0.09, bodyH / 2 + 0.16, 0);
    const antennaTip = new THREE.Mesh(sph(0.022, 8, 8), this.palette.glow);
    antennaTip.position.set(0.09, bodyH / 2 + 0.28, 0);
    this.tankGroup.add(antennaTip);

    // Supply hose: under the tank valve, around the right hip and forward to
    // the weapon's rear grip (torso-local coordinates).
    const supplyHose = hose(
      [
        [0.0, -0.36, 0.3],
        [0.14, -0.42, 0.22],
        [0.28, -0.34, 0.04],
        [0.34, -0.12, -0.14],
        [0.32, 0.0, -0.28]
      ],
      0.022,
      6
    );
    addPart(parts, 'rubber', supplyHose);
    addPart(parts, 'trim', torus(0.032, 0.012, 6, 12), 0.0, -0.36, 0.3, Math.PI / 2);
  }

  private buildHeadgear(parts: PartSpec[]): void {
    switch (this.selection.headgear) {
      case 1:
        // Tactical goggles: brow lens bar + strap over the visor
        addPart(parts, 'trim', box(0.4, 0.1, 0.06), 0, 0.16, -0.27);
        addPart(parts, 'trim', torus(0.31, 0.03, 6, 18, Math.PI), 0, 0.05, 0, -Math.PI / 2);
        addPart(parts, 'dark', box(0.42, 0.03, 0.05), 0, 0.2, -0.26);
        break;
      case 2:
        // Dorsal fin with side fins and a crest bead
        addPart(parts, 'team', cone(0.09, 0.34, 4), 0, 0.3, 0.16, -0.5);
        addPart(parts, 'team', cone(0.055, 0.2, 4), -0.16, 0.24, 0.2, -0.7, 0, 0.4);
        addPart(parts, 'team', cone(0.055, 0.2, 4), 0.16, 0.24, 0.2, -0.7, 0, -0.4);
        addPart(parts, 'trim', sph(0.04, 6, 6), 0, 0.44, 0.08);
        break;
      case 3:
        // Beanie: dome, folded brim, pompom
        addPart(parts, 'team', sph(0.31, 14, 8, Math.PI / 2), 0, 0.06, 0);
        addPart(parts, 'teamLight', torus(0.3, 0.045, 8, 18), 0, 0.1, 0, Math.PI / 2);
        addPart(parts, 'trim', sph(0.07, 8, 8), 0, 0.4, 0);
        break;
      case 4:
        // Signal rig: visor bar plus twin antennae
        addPart(parts, 'dark', box(0.36, 0.05, 0.1), 0, 0.19, -0.24);
        addPart(parts, 'trim', cyl(0.01, 0.01, 0.36, 6), -0.18, 0.36, 0.04, 0, 0, 0.28);
        addPart(parts, 'trim', cyl(0.01, 0.01, 0.3, 6), 0.18, 0.33, 0.04, 0, 0, -0.28);
        addPart(parts, 'trim', sph(0.024, 6, 6), -0.23, 0.53, 0.04);
        addPart(parts, 'trim', sph(0.024, 6, 6), 0.22, 0.47, 0.04);
        break;
      case 5:
        // Hood: cowl over the back of the skull with a glow band
        addPart(parts, 'team', sph(0.34, 14, 10, Math.PI * 0.62), 0, 0.0, 0.05, 0.35);
        addPart(parts, 'teamDark', torus(0.33, 0.035, 6, 20), 0, -0.02, 0.06, 1.2);
        addPart(parts, 'trim', box(0.3, 0.03, 0.03), 0, 0.2, -0.26);
        break;
      default:
        // Baseball cap: dome + brim
        addPart(parts, 'gold', sph(0.315, 14, 8, Math.PI / 2), 0, 0.1, 0);
        addPart(parts, 'gold', cyl(0.34, 0.34, 0.03, 16, false), 0, 0.11, -0.18, Math.PI / 2, 0, Math.PI, 1, 1, 0.55);
        break;
    }
  }

  // ========================================================================
  // 2. Weapon models
  // ========================================================================

  private buildWeapons(): void {
    this.weaponAnchor.position.set(0.32, 0.85, -0.3);
    const P = this.palette;

    // 2.1 Shooter
    const shooter: PartSpec[] = [];
    addPart(shooter, 'dark', cyl(0.06, 0.09, 0.65, 12), 0, 0, 0, Math.PI / 2);
    addPart(shooter, 'team', cyl(0.1, 0.1, 0.18, 12), 0, 0, -0.38, Math.PI / 2);
    addPart(shooter, 'trim', cyl(0.055, 0.055, 0.02, 12), 0, 0, -0.475, Math.PI / 2);
    addPart(shooter, 'trim', torus(0.105, 0.014, 6, 14), 0, 0, -0.29);
    addPart(shooter, 'team', box(0.15, 0.17, 0.3), 0, 0, 0.2);
    addPart(shooter, 'soft', box(0.16, 0.06, 0.24), 0, -0.1, 0.18);
    addPart(shooter, 'dark', box(0.025, 0.06, 0.1), 0, 0.1, -0.2);
    addPart(shooter, 'dark', box(0.07, 0.2, 0.09), 0, -0.14, 0.24, 0.4);
    addPart(shooter, 'dark', box(0.05, 0.12, 0.06), 0, -0.1, -0.16);
    addPart(shooter, 'trim', torus(0.05, 0.012, 6, 14), 0, -0.07, 0.12, 0, Math.PI / 2);
    addPart(shooter, 'soft', box(0.1, 0.14, 0.12), 0, 0.03, 0.36);
    this.addStatic(shooter, 'wpShooter', this.shooterGroup, false, 'static');

    const tankGlass = new THREE.Mesh(cyl(0.07, 0.07, 0.17, 12), P.glass);
    tankGlass.position.set(0, 0.15, 0.12);
    const tankInk = new THREE.Mesh(cyl(0.055, 0.055, 0.14, 12), P.liquid);
    tankInk.position.set(0, 0.15, 0.12);
    this.shooterGroup.add(tankGlass, tankInk);
    this.weaponAnchor.add(this.shooterGroup);

    // 2.2 Roller
    const roller: PartSpec[] = [];
    addPart(roller, 'dark', cyl(0.04, 0.04, 0.9, 10), 0, 0, -0.1, 0.5);
    addPart(roller, 'team', cyl(0.035, 0.035, 0.34, 10), 0, 0.4, 0.11, 0, 0, Math.PI / 2);
    addPart(roller, 'trim', cyl(0.042, 0.042, 0.36, 10), 0, 0.4, 0.11, 0, 0, Math.PI / 2);
    addPart(roller, 'dark', cyl(0.03, 0.03, 1.52, 8), 0, -0.35, -0.6, 0, 0, Math.PI / 2);
    addPart(roller, 'dark', cyl(0.09, 0.09, 0.06, 12), -0.72, -0.35, -0.6, 0, 0, Math.PI / 2);
    addPart(roller, 'dark', cyl(0.09, 0.09, 0.06, 12), 0.72, -0.35, -0.6, 0, 0, Math.PI / 2);
    addPart(roller, 'trim', box(0.05, 0.42, 0.06), -0.62, -0.14, -0.6, 0, 0, -0.12);
    addPart(roller, 'trim', box(0.05, 0.42, 0.06), 0.62, -0.14, -0.6, 0, 0, 0.12);
    addPart(roller, 'soft', box(0.4, 0.06, 0.12), 0, 0.16, -0.62, -0.3);
    for (const ribX of [-0.45, 0, 0.45]) {
      addPart(roller, 'dark', torus(0.245, 0.02, 6, 20), ribX, -0.35, -0.6, 0, Math.PI / 2);
    }
    this.addStatic(roller, 'wpRoller', this.rollerGroup, false, 'static');

    const rollerCylinder = new THREE.Mesh(cyl(0.24, 0.24, 1.4, 16), P.mats.team);
    rollerCylinder.rotation.z = Math.PI / 2;
    rollerCylinder.position.set(0, -0.35, -0.6);
    this.rollerCylinderMesh = rollerCylinder;
    this.rollerGroup.add(rollerCylinder);

    this.rollerGroup.visible = false;
    this.weaponAnchor.add(this.rollerGroup);

    // 2.3 Charger
    const charger: PartSpec[] = [];
    addPart(charger, 'dark', box(0.1, 0.14, 0.5), 0, 0, 0);
    addPart(charger, 'team', box(0.08, 0.13, 0.24), 0, -0.02, 0.35);
    addPart(charger, 'dark', box(0.06, 0.17, 0.08), 0, -0.13, 0.12, 0.35);
    addPart(charger, 'team', cyl(0.03, 0.03, 1.2, 10), 0, 0, -0.7, Math.PI / 2);
    addPart(charger, 'team', torus(0.045, 0.014, 6, 14), 0, 0, -0.5);
    addPart(charger, 'team', torus(0.045, 0.014, 6, 14), 0, 0, -0.9);
    addPart(charger, 'trim', torus(0.08, 0.02, 6, 16), 0, 0, -0.28);
    addPart(charger, 'dark', cyl(0.042, 0.05, 0.07, 8), 0, 0, -1.31, Math.PI / 2);
    addPart(charger, 'dark', cyl(0.05, 0.05, 0.3, 10), 0, 0.12, -0.1, Math.PI / 2);
    addPart(charger, 'trim', box(0.03, 0.05, 0.12), 0.06, 0.04, 0.2);
    addPart(charger, 'soft', box(0.07, 0.05, 0.18), 0, 0.08, 0.3);
    addPart(charger, 'dark', cyl(0.014, 0.014, 0.26, 6), 0, -0.12, -0.5, 0, 0, 0.5);
    this.addStatic(charger, 'wpCharger', this.chargerGroup, false, 'static');

    const lens = new THREE.Mesh(cyl(0.035, 0.035, 0.02, 10), P.visor);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.12, -0.26);
    this.chargerGroup.add(lens);

    const laserMat = new THREE.MeshBasicMaterial({ color: this.teamColorHex, transparent: true, opacity: 0.55 });
    this.materials.push(laserMat);
    this.chargerLaserMesh = new THREE.Mesh(cyl(0.005, 0.005, 25, 6), laserMat);
    this.chargerLaserMesh.rotation.x = Math.PI / 2;
    this.chargerLaserMesh.position.z = -13.5;
    this.chargerGroup.add(this.chargerLaserMesh);

    this.chargerGroup.visible = false;
    this.weaponAnchor.add(this.chargerGroup);

    // 2.4 Slosher
    const bucketMesh = new THREE.Mesh(cyl(0.26, 0.2, 0.45, 14, true), P.teamBack);
    bucketMesh.rotation.x = 0.3;
    bucketMesh.position.set(0, -0.1, -0.3);
    this.slosherGroup.add(bucketMesh);

    const bucketParts: PartSpec[] = [];
    addPart(bucketParts, 'dark', torus(0.265, 0.02, 8, 20), 0, 0.225, 0, Math.PI / 2);
    addPart(bucketParts, 'dark', torus(0.15, 0.018, 6, 16, Math.PI), 0, 0.225, 0);
    addPart(bucketParts, 'trim', torus(0.268, 0.012, 6, 20), 0, 0.19, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      addPart(bucketParts, 'trim', sph(0.018, 6, 6), Math.cos(a) * 0.24, 0.02, Math.sin(a) * 0.24);
    }
    bucketMesh.add(this.buildStaticChild(bucketParts, 'wpBucket'));

    const bucketInk = new THREE.Mesh(cyl(0.21, 0.17, 0.08, 14), P.liquid);
    bucketInk.position.y = 0.08;
    bucketMesh.add(bucketInk);

    const shaftParts: PartSpec[] = [];
    addPart(shaftParts, 'dark', cyl(0.035, 0.035, 0.62, 8), 0, 0.05, -0.14, 1.2);
    addPart(shaftParts, 'trim', torus(0.04, 0.014, 6, 12), 0, -0.13, 0.02, 1.2);
    addPart(shaftParts, 'soft', box(0.12, 0.05, 0.14), 0, 0.28, -0.06, 0.3);
    this.addStatic(shaftParts, 'wpShaft', this.slosherGroup, false, 'static');

    this.slosherGroup.visible = false;
    this.weaponAnchor.add(this.slosherGroup);

    // Muzzle flash
    const flashGeo = new THREE.OctahedronGeometry(0.18);
    this.geometries.push(flashGeo);
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, P.flash);
    this.muzzleFlashMesh.position.set(0, 0, -0.6);
    this.muzzleFlashMesh.visible = false;
    this.weaponAnchor.add(this.muzzleFlashMesh);
  }

  /** Builds a merged static group to attach under an existing node. */
  private buildStaticChild(parts: PartSpec[], key: string): THREE.Group {
    const group = new THREE.Group();
    const built = buildStatic(parts, key, this.palette);
    for (const mergedKey of built.keys) this.staticKeys.push(mergedKey);
    for (const mesh of built.meshes) group.add(mesh);
    return group;
  }

  private buildDrips(material: THREE.Material): void {
    const dripGeo = sph(0.035, 6, 6);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(dripGeo, material);
      mesh.visible = false;
      mesh.scale.set(0.7, 1.4, 0.7);
      this.dripMeshes.push(mesh);
      this.dripLife.push(0);
      this.dripVel.push(0);
      this.group.add(mesh);
    }
  }

  // ========================================================================
  // 3. Submerged / squid form
  // ========================================================================

  private buildSubmergedForm(): void {
    const rippleMat = new THREE.MeshBasicMaterial({
      color: this.teamColorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.materials.push(rippleMat);
    this.rippleMesh = new THREE.Mesh(ring(0.25, 0.9, 24), rippleMat);
    this.rippleMesh.rotation.x = -Math.PI / 2;
    this.rippleMesh.position.y = 0.04;
    this.submergedGroup.add(this.rippleMesh);

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    this.materials.push(innerMat);
    this.rippleInnerMesh = new THREE.Mesh(ring(0.18, 0.5, 20), innerMat);
    this.rippleInnerMesh.rotation.x = -Math.PI / 2;
    this.rippleInnerMesh.position.y = 0.07;
    this.submergedGroup.add(this.rippleInnerMesh);

    // Mantle: dome, base rim, dorsal ridge and tail blades
    const domeParts: PartSpec[] = [];
    addPart(domeParts, 'team', cone(0.3, 0.5, 14), 0, 0.08, 0, -Math.PI / 2);
    addPart(domeParts, 'teamDark', torus(0.27, 0.03, 6, 18), 0, 0.1, 0, Math.PI / 2);
    addPart(domeParts, 'team', cone(0.06, 0.22, 4), 0, 0.22, -0.06, 1.1);
    addPart(domeParts, 'team', cone(0.05, 0.18, 4), 0, 0.16, -0.24, 1.5);
    addPart(domeParts, 'trim', sph(0.035, 6, 6), 0, 0.26, -0.02);
    this.addStatic(domeParts, 'squidDome', this.squidDomeGroup, true, 'static');
    this.submergedGroup.add(this.squidDomeGroup);

    // Swim fins on the mantle sides
    for (let side = -1; side <= 1; side += 2) {
      const finParts: PartSpec[] = [];
      addPart(finParts, 'team', box(0.045, 0.14, 0.24), 0, 0, 0, 0.25, 0, -0.5);
      addPart(finParts, 'teamDark', box(0.05, 0.05, 0.1), 0, -0.04, 0.1, 0.25, 0, -0.5);
      const fin = new THREE.Group();
      fin.position.set(side * 0.26, 0.14, 0.08);
      fin.rotation.z = side * -0.5;
      fin.rotation.x = 0.25;
      const built = buildStatic(finParts, 'squidFin', this.palette);
      for (const mergedKey of built.keys) this.staticKeys.push(mergedKey);
      for (const mesh of built.meshes) fin.add(mesh);
      this.submergedGroup.add(fin);
      this.squidFinGroups.push(fin);
    }

    // Eyes: lid wedge, sclera, pupil, highlight
    for (let side = -1; side <= 1; side += 2) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.13, 0.13, -0.06);
      const lid = new THREE.Mesh(sph(0.075, 8, 6), this.palette.mats.teamDark);
      lid.scale.set(1, 0.75, 0.8);
      lid.position.y = 0.04;
      const white = new THREE.Mesh(sph(0.065, 10, 8), this.palette.eyeWhite);
      const pupil = new THREE.Mesh(sph(0.035, 8, 8), this.palette.pupil);
      pupil.position.set(0, 0.005, -0.04);
      const glint = new THREE.Mesh(sph(0.014, 6, 6), this.palette.eyeWhite);
      glint.position.set(side * 0.02, 0.03, -0.05);
      eye.add(lid, white, pupil, glint);
      this.submergedGroup.add(eye);
      this.squidEyeGroups.push(eye);
    }

    // Four trailing tentacles, each a tapering two-segment group
    const tailSpecs = [
      { x: -0.14, z: 0.34, r: 0.05, len: 0.44 },
      { x: 0.14, z: 0.34, r: 0.05, len: 0.44 },
      { x: -0.07, z: 0.42, r: 0.035, len: 0.34 },
      { x: 0.07, z: 0.42, r: 0.035, len: 0.34 }
    ];
    for (let i = 0; i < tailSpecs.length; i++) {
      const spec = tailSpecs[i];
      if (!spec) continue;
      const parts: PartSpec[] = [];
      addPart(parts, 'team', cyl(spec.r, spec.r * 0.55, spec.len, 8), 0, 0, spec.len / 2, Math.PI / 2);
      addPart(parts, 'team', cyl(spec.r * 0.5, spec.r * 0.25, spec.len * 0.5, 6), 0, 0, spec.len * 0.95, Math.PI / 2);
      const group = new THREE.Group();
      group.position.set(spec.x, 0.06, spec.z);
      const built = buildStatic(parts, `squidTail|${i}`, this.palette);
      for (const mergedKey of built.keys) this.staticKeys.push(mergedKey);
      for (const mesh of built.meshes) group.add(mesh);
      this.submergedGroup.add(group);
      this.swimTentacles.push(group);
    }

    this.submergedGroup.visible = false;
    this.group.add(this.submergedGroup);
  }

  // ========================================================================
  // 4. Ascending splat ghost
  // ========================================================================

  private buildGhost(): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.9 });
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: this.teamColorHex,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    this.materials.push(bodyMat, eyeMat, haloMat, glowMat);
    this.ghostMaterials = [bodyMat, eyeMat, haloMat, glowMat];
    this.ghostOpacity = [0.85, 0.9, 1, 0.35];

    const body = new THREE.Mesh(cone(0.24, 0.5, 12), bodyMat);
    body.rotation.x = Math.PI;
    this.ghostGroup.add(body);

    // Wavy hem, stubby arms and brow lobes share the translucent body material
    const detail: PartSpec[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      addPart(detail, 'trim', sph(0.06, 6, 6), Math.cos(a) * 0.2, 0.26, Math.sin(a) * 0.2);
    }
    addPart(detail, 'trim', cap(0.05, 0.12, 3, 6), -0.24, 0.0, 0, 0, 0, 0.7);
    addPart(detail, 'trim', cap(0.05, 0.12, 3, 6), 0.24, 0.0, 0, 0, 0, -0.7);
    addPart(detail, 'trim', sph(0.05, 6, 6), -0.1, 0.02, -0.17);
    addPart(detail, 'trim', sph(0.05, 6, 6), 0.1, 0.02, -0.17);
    const detailGroup = this.buildStaticChild(detail, 'ghostDetail');
    detailGroup.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.material = bodyMat;
    });
    this.ghostGroup.add(detailGroup);

    const eyesL = new THREE.Mesh(sph(0.03, 6, 6), eyeMat);
    eyesL.scale.set(1, 1, 0.6);
    eyesL.position.set(-0.1, 0.0, -0.2);
    const eyesR = new THREE.Mesh(sph(0.03, 6, 6), eyeMat);
    eyesR.scale.set(1, 1, 0.6);
    eyesR.position.set(0.1, 0.0, -0.2);
    this.ghostGroup.add(eyesL, eyesR);

    const halo = new THREE.Mesh(ring(0.12, 0.16, 16), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.35;
    this.ghostGroup.add(halo);

    const glow = new THREE.Mesh(ring(0.28, 0.46, 20), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.24;
    this.ghostGroup.add(glow);

    this.ghostGroup.visible = false;
    this.group.add(this.ghostGroup);
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Shows the model group for `type`. Weapons without their own model reuse the
   * closest silhouette by archetype rather than showing nothing: leaving every
   * group hidden would render the fighter empty-handed.
   */
  setWeaponType(type: WeaponType): void {
    this.currentWeapon = type;
    const model = WEAPON_MODEL_GROUP[type] ?? 'shooter';
    this.shooterGroup.visible = model === 'shooter';
    this.rollerGroup.visible = model === 'roller';
    this.chargerGroup.visible = model === 'charger';
    this.slosherGroup.visible = model === 'slosher';
  }

  triggerRecoil(): void {
    this.recoilOffset = -0.18;
    this.flashTimer = 0.07;
    this.muzzleFlashMesh.visible = true;
  }

  setMode(mode: PlayerMode): void {
    if (this.currentMode !== mode) {
      this.diveTransitionTimer = 0.22;
      this.currentMode = mode;
    }
    if (mode === PlayerMode.DEAD) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = false;
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
      this.ghostActive = true;
      this.ghostTime = 0;
      this.ghostGroup.position.set(0, 0.4, 0);
      this.ghostGroup.scale.setScalar(1);
      this.ghostGroup.visible = true;
    } else if (mode === PlayerMode.SUBMERGED) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = true;
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
      this.ghostActive = false;
      this.ghostGroup.visible = false;
    } else {
      this.humanoidGroup.visible = true;
      this.submergedGroup.visible = false;
      if (this.nameplateSprite) this.nameplateSprite.visible = true;
      this.ghostActive = false;
      this.ghostGroup.visible = false;
    }
  }

  /**
   * Updates floating 3D player nameplate (Subagent 79)
   */
  setName(name: string): void {
    if (!name || this.playerName === name) return;
    this.playerName = name;

    if (this.nameplateTexture) {
      this.nameplateTexture.dispose();
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Rounded background pill
      ctx.fillStyle = 'rgba(15, 17, 24, 0.85)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 240, 48, 14);
      ctx.fill();

      // Team accent border
      ctx.strokeStyle = this.teamColorHex === 0xff007f ? '#ff007f' : '#00ffff';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Name Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 128, 32);
    }

    this.nameplateTexture = new THREE.CanvasTexture(canvas);
    if (!this.nameplateSprite) {
      const mat = new THREE.SpriteMaterial({
        map: this.nameplateTexture,
        transparent: true,
        depthTest: false
      });
      this.materials.push(mat);
      this.nameplateSprite = new THREE.Sprite(mat);
      this.nameplateSprite.position.set(0, 2.2, 0);
      this.nameplateSprite.scale.set(1.6, 0.4, 1);
      this.nameplateSprite.visible = this.currentMode === PlayerMode.HUMANOID;
      this.group.add(this.nameplateSprite);
    } else {
      this.nameplateSprite.material.map = this.nameplateTexture;
      this.nameplateSprite.material.needsUpdate = true;
    }
  }

  // Subagent 07 Public API
  setTeam(team: Team): void {
    this.teamColorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
  }

  setAlive(alive: boolean): void {
    if (!alive) {
      this.setMode(PlayerMode.DEAD);
    } else if (this.currentMode === PlayerMode.DEAD) {
      this.setMode(PlayerMode.HUMANOID);
    }
  }

  setForm(form: PlayerMode): void {
    this.setMode(form);
  }

  setInvulnerable(invulnerable: boolean): void {
    this.updateVisuals(invulnerable, performance.now() / 1000);
  }

  setTransform(pos: Vec3, yaw: number, pitch?: number): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.rotation.y = yaw;
    if (pitch !== undefined) {
      this.aimPitch = pitch;
    }
  }

  /**
   * Muzzle tip in world space. The muzzle anchor sits at local (0, 0, -0.6) of
   * the weapon anchor, matching the offset the shot pipeline already assumes.
   * Callers must ensure the world matrix is current (matrixWorldAutoUpdate).
   */
  getMuzzleWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.set(0, 0, -0.6).applyMatrix4(this.weaponAnchor.matrixWorld);
  }

  // ========================================================================
  // Animation
  // ========================================================================

  updateLocomotion(dt: number, speed: number, isGrounded: boolean, pitch = 0): void {
    this.updateDrips(dt);

    if (this.currentMode !== PlayerMode.HUMANOID) return;

    this.aimPitch = THREE.MathUtils.lerp(this.aimPitch, pitch, 0.25);
    this.torsoGroup.rotation.x = -this.aimPitch * 0.6;
    this.headGroup.rotation.x = -this.aimPitch * 0.4;
    // Head leads the aim slightly for a livelier read
    this.headGroup.rotation.y = Math.sin(this.idlePhase * 0.7) * 0.05 - this.aimPitch * 0.08;

    // Distinct weapon arm posing (shoulder X/Y/Z plus elbow bend)
    let baseLeftX = -0.3;
    let baseLeftY = 0;
    let baseLeftZ = 0;
    let baseRightX = -0.3;
    let baseRightY = 0;
    let baseRightZ = 0;
    let leftElbow = -0.25;
    let rightElbow = -0.35;

    switch (WEAPON_MODEL_GROUP[this.currentWeapon] ?? 'shooter') {
      case 'shooter':
        baseRightX = -0.7;
        baseRightY = -0.15;
        rightElbow = -0.5;
        baseLeftX = -0.6;
        baseLeftY = 0.35;
        baseLeftZ = -0.2;
        leftElbow = -0.6;
        break;
      case 'roller':
        baseRightX = -0.45;
        baseRightY = -0.2;
        baseRightZ = 0.15;
        rightElbow = -0.4;
        baseLeftX = -0.45;
        baseLeftY = 0.2;
        baseLeftZ = -0.15;
        leftElbow = -0.5;
        break;
      case 'charger':
        baseRightX = -0.85;
        baseRightY = -0.1;
        rightElbow = -0.55;
        baseLeftX = -0.8;
        baseLeftY = 0.3;
        baseLeftZ = -0.1;
        leftElbow = -0.75;
        break;
      case 'slosher':
        baseRightX = -0.55;
        baseRightY = -0.1;
        rightElbow = -0.35;
        baseLeftX = -0.55;
        baseLeftY = 0.1;
        leftElbow = -0.4;
        break;
    }

    const now = performance.now();
    const idle = now * 0.0015;
    this.idlePhase += dt * 1.6;

    if (isGrounded && speed > 0.5) {
      this.walkPhase += speed * dt * 2.2;
      const swingAmp = THREE.MathUtils.clamp(speed * 0.14, 0.22, 0.6);
      const legSwing = Math.sin(this.walkPhase) * swingAmp;
      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;

      // Arm counter-sway scaled by speed, elbows flex with the stride
      this.armSwing = THREE.MathUtils.lerp(this.armSwing, legSwing, 0.3);
      this.leftArm.rotation.set(baseLeftX - this.armSwing * 0.3, baseLeftY, baseLeftZ);
      this.rightArm.rotation.set(baseRightX + this.armSwing * 0.2, baseRightY, baseRightZ);
      this.leftForearm.rotation.x = leftElbow + Math.abs(this.armSwing) * 0.15;
      this.rightForearm.rotation.x = rightElbow + Math.abs(this.armSwing) * 0.12;

      // Locomotion vertical bob & lateral lean
      this.torsoGroup.position.y = 0.85 + Math.abs(Math.sin(this.walkPhase)) * 0.05;
      this.torsoGroup.rotation.z = Math.sin(this.walkPhase) * 0.04;
      this.headGroup.position.y = 0.55;

      this.tentacleSway = THREE.MathUtils.lerp(this.tentacleSway, -0.14 - speed * 0.045, 0.12);

      this.dripTimer -= dt;
      if (this.dripTimer <= 0 && speed > 3.5) {
        this.dripTimer = 0.55 + Math.random() * 0.5;
        this.spawnDrip();
      }
    } else {
      // Return smoothly to idle weapon pose with subtle breathing
      this.leftLeg.rotation.x *= 0.85;
      this.rightLeg.rotation.x *= 0.85;
      this.leftArm.rotation.set(baseLeftX, baseLeftY, baseLeftZ);
      this.rightArm.rotation.set(baseRightX, baseRightY, baseRightZ);
      this.leftForearm.rotation.x = leftElbow;
      this.rightForearm.rotation.x = rightElbow;

      const breath = Math.sin(now * 0.003) * 0.012;
      this.torsoGroup.position.y = 0.85 + breath;
      this.torsoGroup.rotation.z = Math.sin(idle * 0.6) * 0.015;
      this.headGroup.position.y = 0.55 + breath * 0.5;

      this.tentacleSway = THREE.MathUtils.lerp(this.tentacleSway, Math.sin(now * 0.003) * 0.05, 0.1);
    }

    // Cephalopod hair: shared sway with a per-tuft phase offset
    for (let i = 0; i < this.hairTufts.length; i++) {
      const tuft = this.hairTufts[i];
      if (!tuft) continue;
      tuft.rotation.x = (this.hairBaseX[i] ?? -0.34) + this.tentacleSway + Math.sin(idle * 2 + i) * 0.05;
      tuft.rotation.z = (this.hairBaseZ[i] ?? 0) + Math.sin(idle * 1.6 + i) * 0.07;
    }

    // Physically roll the Ink Roller cylinder
    if (WEAPON_MODEL_GROUP[this.currentWeapon] === 'roller' && this.rollerCylinderMesh && isGrounded && speed > 0.5) {
      this.rollerCylinderMesh.rotation.x += speed * dt * 5.0;
    }

    // Jump squash & stretch decay
    if (!isGrounded) {
      this.squashStretchY = 1.18; // Stretch during air
    } else {
      this.squashStretchY = THREE.MathUtils.lerp(this.squashStretchY, 1.0, 0.2);
    }
    this.humanoidGroup.scale.set(
      1 / Math.sqrt(this.squashStretchY),
      this.squashStretchY,
      1 / Math.sqrt(this.squashStretchY)
    );

    // Recoil recovery
    this.recoilOffset = THREE.MathUtils.lerp(this.recoilOffset, 0, 0.25);
    this.weaponAnchor.position.z = -0.3 + this.recoilOffset;

    // Flash timer
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
      }
    }
  }

  private spawnDrip(): void {
    for (let i = 0; i < this.dripMeshes.length; i++) {
      const mesh = this.dripMeshes[i];
      if (!mesh || mesh.visible) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      mesh.position.set(side * 0.3, 1.35, -0.35 + Math.random() * 0.3);
      mesh.scale.set(0.7, 1.4, 0.7);
      mesh.visible = true;
      this.dripLife[i] = 0.75;
      this.dripVel[i] = -1.2;
      return;
    }
  }

  private updateDrips(dt: number): void {
    if (this.currentMode !== PlayerMode.HUMANOID) {
      for (const mesh of this.dripMeshes) mesh.visible = false;
      return;
    }
    for (let i = 0; i < this.dripMeshes.length; i++) {
      const mesh = this.dripMeshes[i];
      if (!mesh || !mesh.visible) continue;
      const life = (this.dripLife[i] ?? 0) - dt;
      this.dripLife[i] = life;
      if (life <= 0) {
        mesh.visible = false;
        continue;
      }
      const vel = (this.dripVel[i] ?? 0) - dt * 14;
      this.dripVel[i] = vel;
      mesh.position.y += vel * dt;
      mesh.scale.y = THREE.MathUtils.clamp(1.4 + vel * 0.12, 0.6, 2.2);
      if (mesh.position.y < 0.05) {
        mesh.position.y = 0.05;
        this.dripVel[i] = 0;
      }
    }
  }

  updateVisuals(invulnerable: boolean, time: number, inkPct = 100): void {
    // Update ghost floating animation
    if (this.ghostActive) {
      this.ghostTime += 0.016;
      this.ghostGroup.position.y += 0.035;
      this.ghostGroup.position.x = Math.sin(this.ghostTime * 6) * 0.08;
      this.ghostGroup.rotation.y += 0.02;
      const ghostProgress = Math.min(1.0, this.ghostTime / 2.5);
      const fade = Math.max(0, 1 - ghostProgress);
      for (let i = 0; i < this.ghostMaterials.length; i++) {
        const mat = this.ghostMaterials[i];
        if (mat) mat.opacity = fade * (this.ghostOpacity[i] ?? 0.85);
      }
      this.ghostGroup.scale.setScalar(1 + ghostProgress * 0.35);
      if (this.ghostTime > 2.5) {
        this.ghostActive = false;
        this.ghostGroup.visible = false;
      }
    }

    if (this.currentMode === PlayerMode.DEAD) return;

    if (invulnerable) {
      const blink = Math.sin(time * 24) > 0;
      if (this.currentMode === PlayerMode.HUMANOID) {
        this.humanoidGroup.visible = blink;
      }
    } else {
      if (this.currentMode === PlayerMode.HUMANOID) {
        this.humanoidGroup.visible = true;
      }
    }

    // Dynamic Ink Tank fluid height (half-height follows the tank variant)
    const inkRatio = Math.max(0.05, Math.min(1.0, inkPct / 100));
    this.tankLiquidMesh.scale.set(1, inkRatio, 1);
    this.tankLiquidMesh.position.y = this.tankLiquidHalf * (inkRatio - 1);

    // Tank Warning LED Light
    if (inkPct < 20) {
      this.ledMat.color.setHex(Math.sin(time * 18) > 0 ? 0xff0033 : 0x330000);
    } else if (inkPct < 50) {
      this.ledMat.color.setHex(0xffbb00);
    } else {
      this.ledMat.color.setHex(0x00ff88);
    }

    // Gentle ripple animation when submerged with dynamic dive scale
    if (this.submergedGroup.visible) {
      if (this.diveTransitionTimer > 0) {
        this.diveTransitionTimer = Math.max(0, this.diveTransitionTimer - 0.016);
      }
      const pop = (this.diveTransitionTimer / 0.22) * 0.4;
      const ripple = 1.0 + Math.sin(time * 9) * 0.18 + pop;
      this.rippleMesh.scale.set(ripple, ripple, 1);
      const inner = 1 + Math.sin(time * 11 + 1) * 0.24 + pop;
      this.rippleInnerMesh.scale.set(inner, inner, 1);
      this.submergedGroup.position.y = Math.sin(time * 12) * 0.02;
      const dome = 1 + pop * 0.5;
      this.squidDomeGroup.scale.set(dome, 1, dome);

      // Trailing tentacles, fins and eyes
      for (let i = 0; i < this.swimTentacles.length; i++) {
        const tent = this.swimTentacles[i];
        if (!tent) continue;
        tent.rotation.z = Math.sin(time * 12 + i * 1.7) * 0.28;
        tent.rotation.y = Math.sin(time * 9 + i) * 0.2;
        tent.scale.y = 1 + Math.sin(time * 14 + i) * 0.12;
      }
      for (let i = 0; i < this.squidFinGroups.length; i++) {
        const fin = this.squidFinGroups[i];
        if (!fin) continue;
        fin.rotation.x = 0.25 + Math.sin(time * 10 + i * Math.PI) * 0.18;
      }
      for (let i = 0; i < this.squidEyeGroups.length; i++) {
        const eye = this.squidEyeGroups[i];
        if (!eye) continue;
        eye.rotation.y = Math.sin(time * 3) * 0.12;
      }
    }

    // Charger laser sight visibility
    if (this.chargerLaserMesh) {
      this.chargerLaserMesh.visible =
        WEAPON_MODEL_GROUP[this.currentWeapon] === 'charger' && this.currentMode === PlayerMode.HUMANOID;
    }
  }

  /**
   * Applies a deterministic layered cosmetic set (headgear / outfit / tank)
   * derived from the player id hash so characters on the field do not all look
   * identical. Call once after construction; later calls are ignored.
   */
  applyCosmeticVariant(variant: number): void {
    if (this.cosmeticsApplied) return;
    this.cosmeticsApplied = true;
    this.selection = selectCosmetics(variant);
    this.buildBody();
    this.setMode(this.currentMode);
  }

  /** Cosmetic indices currently applied (headgear / outfit / tank). */
  getCosmeticSelection(): CosmeticSelection {
    return { ...this.selection };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.releaseMerged();
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
    if (this.nameplateTexture) {
      this.nameplateTexture.dispose();
    }
    releaseShared();
  }

  /** Drops the cosmetic body's references to shared merged geometry. */
  private releaseBodyMerges(): void {
    this.releaseKeys(this.bodyKeys);
  }

  /** Drops this view's references to shared merged geometry, freeing it when unused. */
  private releaseMerged(): void {
    this.releaseKeys(this.bodyKeys);
    this.releaseKeys(this.staticKeys);
  }

  private releaseKeys(keys: string[]): void {
    const assets = sharedAssets;
    if (!assets) {
      keys.length = 0;
      return;
    }
    for (const key of keys) {
      const next = (assets.buildRefs.get(key) ?? 1) - 1;
      if (next <= 0) {
        const set = assets.builds.get(key);
        if (set) {
          for (const entry of set) entry.geo.dispose();
        }
        assets.builds.delete(key);
        assets.buildRefs.delete(key);
      } else {
        assets.buildRefs.set(key, next);
      }
    }
    keys.length = 0;
  }
}
