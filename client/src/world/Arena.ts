import * as THREE from 'three';
import { BoxObstacle, ClimbableSurface, PaintSurface, Team, getMapDef } from '@ink/shared';
import type { MapDef, MapId } from '@ink/shared';
import { PaintEngine } from './PaintEngine.js';
import {
  createWorldMaterial,
  getFloorTexture,
  getSkyTexture,
  makeSignTexture,
  texBrick,
  texConcrete,
  texContainer,
  texCrate,
  texFacade,
  texGrate,
  texGroundDetail,
  texHazard,
  texIce,
  texMetalPlate,
  texPanel,
  texPlanks,
  texSnow,
  texTile
} from '../rendering/MapArt.js';
import type { WorldMaterial, WorldMaterialOptions } from '../rendering/MapArt.js';
import {
  getAssetTexture,
  getBillboardConfigs,
  getAllSponsorPosters,
  getMascotTexture,
  getTeamEmblemTexture
} from '../rendering/AssetTextures.js';

const DEFAULT_MAP = getMapDef();

/** Environment dome radius; kept well inside the renderer far plane (260). */
const SKY_DOME_RADIUS = 175;
/** Vertical offset of the dome centre, so the horizon band sits at eye level. */
const SKY_DOME_Y = -10;
/**
 * Outer ground disc radius, chosen to meet the dome's intersection circle
 * (sqrt(R^2 - DOME_Y^2) -?174.7) so the horizon closes with no visible seam.
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

// ---------------------------------------------------------------------------
// Surface families: every obstacle is dressed with one of these material kits
// (chosen from its id) so the shared MapDef stays pure collision data.
// ---------------------------------------------------------------------------
type Fam =
  | 'concrete'
  | 'brick'
  | 'facade'
  | 'container'
  | 'metal'
  | 'grate'
  | 'crate'
  | 'planks'
  | 'snow'
  | 'ice'
  | 'panel'
  | 'hazard'
  | 'tile';

/** A single colour, or a palette indexed by a hash of the obstacle id. */
type Tint = number | number[];
type Rule = [RegExp, Fam, Tint];

const CONTAINER_COLORS = [0xef4c3c, 0x3498db, 0xf39c12, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c];
const STALL_COLORS = [0xff9aa8, 0x9ae0ff, 0xffe08a, 0xb6ffb0];

const RULES: Record<MapId, Rule[]> = {
  downtown: [
    [/^center_tower/, 'panel', 0xe6dcff],
    [/^center_deck/, 'metal', 0xffc8e4],
    [/^center_concourse/, 'panel', 0xdcd0ff],
    [/^center_observatory/, 'metal', 0xffb8dc],
    [/^center_balcony/, 'metal', 0xcfd6ff],
    [/^center_penthouse/, 'facade', 0xffd8ee],
    [/^center_spire/, 'metal', 0xe0d4ff],
    [/^center_finial/, 'metal', 0xffffff],
    [/^planter/, 'tile', 0xa6e8b8],
    [/^(arcade_vent|hotel_ac)/, 'metal', 0xb6c0d4],
    [/^arcade_deck/, 'tile', 0xb6d4ff],
    [/^arcade_mezzanine/, 'facade', 0xffc0e0],
    [/^arcade_penthouse/, 'facade', 0xffd8ee],
    [/^arcade_spire/, 'metal', 0xd0d8f0],
    [/^arcade/, 'facade', 0xffd0e8],
    [/^skywalk_pillar/, 'concrete', 0xc4c4d0],
    [/^skywalk/, 'metal', 0xcfe0ff],
    [/^office_roof/, 'metal', 0xd8e4ff],
    [/^office_penthouse/, 'facade', 0xd0e8ff],
    [/^office_helipad/, 'metal', 0xffe6a0],
    [/^office_comm_mast/, 'metal', 0xffffff],
    [/^office_spire/, 'metal', 0xffffff],
    [/^office/, 'facade', 0xcfe4ff],
    [/^hotel_sky_pil/, 'concrete', 0xc4c4d0],
    [/^hotel_skywalk/, 'metal', 0xffd0a8],
    [/^hotel_st/, 'metal', 0xffd8b0],
    [/^hotel_penthouse/, 'facade', 0xffe0c0],
    [/^hotel_terrace/, 'metal', 0xffd4b0],
    [/^hotel_antenna/, 'metal', 0xffffff],
    [/^hotel/, 'facade', 0xffe9cc],
    [/^barrier/, 'hazard', 0xffffff],
    [/^lane_plat/, 'tile', 0xb6d4ff],
    [/^lane_mid/, 'crate', 0xffffff],
    [/^lane_wall/, 'brick', 0xffffff],
    [/^lane_spire/, 'metal', 0xdce0f0],
    [/^(cover_|base_crate)/, 'crate', 0xffffff],
    [/^base_rail/, 'concrete', 0xe6e0f0],
    [/^base_wing/, 'container', CONTAINER_COLORS],
    [/^stall/, 'planks', STALL_COLORS],
    [/^corner_tower/, 'brick', 0xffe0d0],
    [/^corner_top/, 'metal', 0xcfd6e6],
    [/^corner_mid/, 'brick', 0xffd8c8],
    [/^corner_perch/, 'metal', 0xcfe0ff],
    [/^corner_nest/, 'panel', 0xffd0e0],
    [/^corner_spire/, 'metal', 0xdce4ff],
    [/^corner_beacon/, 'metal', 0xffe0a0],
    [/^corner_needle/, 'metal', 0xffffff],
    [/^dumpster/, 'metal', 0x58b86a],
    [/^bench_row/, 'planks', 0xffd8a8]
  ],
  cargo_docks: [
    [/^crane_base/, 'hazard', 0xffffff],
    [/^crane_machinery/, 'metal', 0xffa629],
    [/^crane_cabin/, 'panel', 0xf0f4f8],
    [/^crane_gantry/, 'metal', 0xff9020],
    [/^crane_deck/, 'metal', 0xffb040],
    [/^crane_counter/, 'hazard', 0xffffff],
    [/^crane_apex/, 'metal', 0xffc060],
    [/^crane_mast/, 'metal', 0xffa629],
    [/^(cont_|yard_|base_cont)/, 'container', CONTAINER_COLORS],
    [/^crate_/, 'crate', 0xffffff],
    [/^mid_wall/, 'concrete', 0xffe8a0],
    [/^warehouse/, 'container', 0xf0f4f8],
    [/^wh_upper/, 'container', 0xe8eef4],
    [/^wh_office/, 'panel', 0xd8e4f0],
    [/^wh_deck/, 'metal', 0xd0d8e4],
    [/^wh_nest/, 'metal', 0xffc060],
    [/^wh_perch/, 'metal', 0xffa629],
    [/^wh_spire/, 'metal', 0xffffff],
    [/^wh_/, 'metal', 0xcfd6e0],
    [/^gantry_st/, 'metal', 0xffc880],
    [/^gantry_tower/, 'metal', 0xffc060],
    [/^gantry_deck_pillar/, 'concrete', 0xd8d0c4],
    [/^gantry_mid/, 'metal', 0xffa830],
    [/^gantry_deck_high/, 'metal', 0xffc870],
    [/^gantry_nest/, 'metal', 0xffb040],
    [/^gantry_apex/, 'metal', 0xff9020],
    [/^gantry_crane/, 'metal', 0xffa030],
    [/^gantry_spire/, 'metal', 0xffffff],
    [/^gantry_/, 'metal', 0xffb040],
    [/^pier_crate/, 'crate', 0xffffff],
    [/^pier_house/, 'planks', 0xffe0b8],
    [/^pier_tower/, 'brick', 0xffe0b8],
    [/^pier_lantern/, 'metal', 0xffd890],
    [/^pier_gallery/, 'metal', 0xffe8c0],
    [/^pier_beacon/, 'metal', 0xffe080],
    [/^pier_spire/, 'metal', 0xffffff],
    [/^pier_needle/, 'metal', 0xffffff],
    [/^pier_finial/, 'metal', 0xffffff],
    [/^pier/, 'planks', 0xffe0b8],
    [/^jersey/, 'concrete', 0xf0ece0]
  ],
  sky_rink: [
    [/^rink_tower/, 'tile', 0xcab4ff],
    [/^rink_deck/, 'panel', 0xa8ffe8],
    [/^rink_stage/, 'tile', 0xb0e8ff],
    [/^rink_nest/, 'panel', 0xa0ffd8],
    [/^rink_perch/, 'metal', 0xcfe0ff],
    [/^rink_crow/, 'metal', 0xd8d4ff],
    [/^rink_pylon/, 'panel', 0xc8ffec],
    [/^rink_needle/, 'metal', 0xe0ecff],
    [/^rink_spire/, 'metal', 0xffffff],
    [/^rink_skywalk_pillar/, 'concrete', 0xd0d8f0],
    [/^rink_skywalk/, 'metal', 0xb8e8ff],
    [/^rink_/, 'metal', 0xcfe0ff],
    [/^launch_plat/, 'tile', 0xffb0e8],
    [/^bank_plat/, 'tile', 0xb4c8ff],
    [/^bank_lip/, 'tile', 0xc0d4ff],
    [/^bank_high/, 'panel', 0xa8ffe0],
    [/^bank_spire/, 'metal', 0xd0e0ff],
    [/^bank_finial/, 'metal', 0xffffff],
    [/^bank/, 'tile', 0xb4c8ff],
    [/^pyr_/, 'tile', [0xffc8f0, 0xc8e4ff, 0xc8ffe8]],
    [/^vip_box/, 'panel', 0xb8ffec],
    [/^vip_deck/, 'panel', 0xa0fce0],
    [/^vip_mezzanine/, 'panel', 0xb0f8f0],
    [/^vip_balcony/, 'metal', 0xb4ffe8],
    [/^vip_nest/, 'panel', 0x90fcd0],
    [/^vip_penthouse/, 'facade', 0xa8ffea],
    [/^vip_antenna/, 'metal', 0xffffff],
    [/^vip_spire/, 'metal', 0xffffff],
    [/^vip_/, 'panel', 0xb8ffec],
    [/^bleacher/, 'panel', 0xd0d8ff],
    [/^(mid_block|ring_n)/, 'hazard', 0xffffff],
    [/^lane_island/, 'tile', 0xd8c8ff],
    [/^rail_/, 'metal', 0xe8ecff]
  ],
  aurora_outpost: [
    [/^center_radome/, 'panel', 0xe4f2ff],
    [/^radome_deck/, 'panel', 0xd8ecff],
    [/^radome_observatory/, 'panel', 0xccf0ff],
    [/^radome_telescope/, 'metal', 0xe8f4ff],
    [/^radome_balcony/, 'metal', 0xd8ecff],
    [/^radome_dome/, 'panel', 0xe0f4ff],
    [/^radome_pylon/, 'metal', 0xffffff],
    [/^radome_mast/, 'metal', 0xffffff],
    [/^antenna_row/, 'metal', 0xdce8f4],
    [/^lab_a_roof/, 'metal', 0xe0ecf8],
    [/^lab_b_roof/, 'metal', 0xe0ecf8],
    [/^lab_b_deck/, 'panel', 0xcfe4f8],
    [/^lab_b_nest/, 'panel', 0xb8e0f4],
    [/^lab_b_observatory/, 'metal', 0xdceef8],
    [/^lab_b_spire/, 'metal', 0xeaf4ff],
    [/^lab_b_mast/, 'metal', 0xffffff],
    [/^lab_b_needle/, 'metal', 0xffffff],
    [/^lab_/, 'panel', 0xd4eaff],
    [/^tube_ab_pillar/, 'metal', 0xcfd8e4],
    [/^tube_ab/, 'panel', 0xb4ffe8],
    [/^polar_sky_pil/, 'metal', 0xcfd8e4],
    [/^polar_skybridge/, 'metal', 0xcfd8e4],
    [/^hangar_roof/, 'metal', 0xffffff],
    [/^hangar_control/, 'panel', 0xffe4cc],
    [/^hangar_nest/, 'metal', 0xffd8b0],
    [/^hangar_tower/, 'panel', 0xffecdc],
    [/^hangar_radar/, 'metal', 0xffffff],
    [/^hangar_spire/, 'metal', 0xffffff],
    [/^hangar/, 'panel', 0xffdcb8],
    [/^tank_top/, 'metal', 0xe8f0f8],
    [/^tank_silo/, 'ice', 0xc0e0ff],
    [/^tank_spire/, 'metal', 0xdce8f4],
    [/^tank_beacon/, 'metal', 0xffe880],
    [/^tank_flare/, 'metal', 0xffffff],
    [/^tank_cap/, 'metal', 0xffffff],
    [/^tank/, 'ice', 0xcfe8ff],
    [/^(relay|crate_snow)/, 'panel', 0xffb070],
    [/^(berm|spire_base)/, 'snow', 0xffffff],
    [/^spire/, 'ice', 0xbfe0ff],
    [/^base_/, 'panel', 0xd8eaff]
  ]
};

/** Perimeter wall dressing per map: family + tint. */
const PERIMETER: Record<MapId, [Fam, number]> = {
  downtown: ['brick', 0xd8c4d8],
  cargo_docks: ['container', 0xe4e8ee],
  sky_rink: ['panel', 0xb4bcff],
  aurora_outpost: ['panel', 0xbcdcf0]
};

/** Which obstacles get a glowing trim band around their upper edge. */
const NEON: Record<MapId, RegExp> = {
  downtown: /^(arcade.*|office.*|hotel.*|center_.*|skywalk.*|corner_.*)(_w|_s|_ws)?$/,
  cargo_docks: /^(warehouse.*|wh_.*|gantry_.*|crane_.*|cont_b_.*|pier_tower.*)(_w|_s|_ws)?$/,
  sky_rink: /^(rink_.*|vip_.*|bank_.*|pyr_.*|launch_plat)(_w|_s|_ws)?$/,
  aurora_outpost: /^(center_radome|radome_.*|lab_.*|hangar.*|tank.*|polar_skybridge|tube_ab)(_w|_s|_ws)?$/
};

const CORNICE_FAMS: ReadonlySet<Fam> = new Set<Fam>(['facade', 'brick', 'panel', 'concrete', 'tile']);

interface SignDef {
  re: RegExp;
  text: string;
  color: number;
  sub?: string;
}

const withSuffix = (base: string): RegExp => new RegExp(`^${base}(_w|_s|_ws)?$`);

const SIGNS: Record<MapId, SignDef[]> = {
  downtown: [
    { re: withSuffix('arcade'), text: 'ARCADE', color: 0xff3fa0, sub: 'GAMES / INK' },
    { re: withSuffix('hotel'), text: 'HOTEL', color: 0x5ae8ff, sub: 'VACANCY' },
    { re: withSuffix('office'), text: 'INKCORP', color: 0xffd35a, sub: 'TOWER 4' },
    { re: withSuffix('corner_tower'), text: '24H', color: 0x7dff9a, sub: 'OPEN' },
    { re: withSuffix('stall'), text: 'NOODLES', color: 0xff8a3f }
  ],
  cargo_docks: [
    { re: withSuffix('warehouse'), text: 'WAREHOUSE 7', color: 0xffa629 },
    { re: withSuffix('gantry_tower'), text: 'GANTRY', color: 0x35c4d8, sub: 'NO ENTRY' },
    { re: withSuffix('pier_house'), text: 'HARBOR', color: 0xffe08a, sub: 'OFFICE' },
    { re: withSuffix('crane_base'), text: 'CRANE 01', color: 0xff6a3a }
  ],
  sky_rink: [
    { re: withSuffix('vip_box'), text: 'VIP', color: 0x2ee6a8, sub: 'LOUNGE' },
    { re: withSuffix('rink_tower'), text: 'SKY RINK', color: 0xb98cff },
    { re: withSuffix('bank_plat'), text: 'BANK', color: 0xff8ad8 }
  ],
  aurora_outpost: [
    { re: withSuffix('hangar'), text: 'HANGAR 3', color: 0xff9a4a },
    { re: withSuffix('lab_a'), text: 'LAB A', color: 0x54ffd0 },
    { re: withSuffix('lab_b'), text: 'LAB B', color: 0x8a7dff },
    { re: withSuffix('center_radome'), text: 'OUTPOST', color: 0x9ae8ff, sub: 'POLAR STN' },
    { re: withSuffix('tank'), text: 'FUEL', color: 0xffd35a }
  ]
};

/** Ramp surface kit per map. */
const RAMP_STYLE: Record<MapId, [Fam, number]> = {
  downtown: ['metal', 0xd0d8f0],
  cargo_docks: ['metal', 0xffb868],
  sky_rink: ['tile', 0xffffff],
  aurora_outpost: ['ice', 0xd8f0ff]
};

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITE = new THREE.Color(0xffffff);

/**
 * Procedural arena geometry. Everything is derived from a `MapDef`; there are
 * no model files. Surfaces use the triplanar world material from MapArt, and
 * decorative repeats are batched into `InstancedMesh` so a map with ~100
 * obstacles still costs a few dozen draw calls.
 */
export class Arena {
  readonly group = new THREE.Group();
  private paintEngine: PaintEngine;
  private mapDef: MapDef = DEFAULT_MAP;

  private groundMesh!: THREE.Mesh;
  private unitBox!: THREE.BoxGeometry;
  /** Shared per-team spawn-pad / dome materials (one pair per rebuild). */
  private padMats: Partial<Record<Team, THREE.MeshStandardMaterial>> = {};
  private domeMats: Partial<Record<Team, THREE.MeshStandardMaterial>> = {};
  private obstacleMeshes: THREE.Mesh[] = [];
  /** Paintable vertical faces rendered with the surface ink texture. */
  private paintSurfaceMeshes: THREE.InstancedMesh[] = [];
  /** Ramp geometry meshes for visual elevation indication. */
  private rampMeshes: THREE.Mesh[] = [];
  private detailGeometries: THREE.BufferGeometry[] = [];
  private detailMaterials: THREE.Material[] = [];
  /** Per-rebuild cache of obstacle family materials (white; tint is per instance). */
  private famMats = new Map<string, WorldMaterial>();

  private skyDome?: THREE.Mesh;
  private motes?: THREE.InstancedMesh;
  private moteBase?: Float32Array;
  private motePhase?: Float32Array;
  private pulsing: Pulser[] = [];
  private spinners: Spinner[] = [];
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
    this.buildAll(obstacles);
  }

  /** Full teardown + rebuild for a new map (called when the host swaps maps). */
  rebuild(mapDef: MapDef): void {
    this.teardown();

    this.mapDef = mapDef;
    this.paintEngine.setMapSize(mapDef.size);
    this.buildAll(mapDef.obstacles);
  }

  getMapDef(): MapDef {
    return this.mapDef;
  }

  private buildAll(obstacles?: BoxObstacle[]): void {
    this.animTime = 0;
    this.lastAnimMs = 0;
    this.unitBox = this.track(new THREE.BoxGeometry(1, 1, 1));

    this.buildGround();
    this.buildGroundSkirt();
    this.buildSkyDome();
    this.buildObstacles(obstacles ?? this.mapDef.obstacles);
    this.buildRamps(this.mapDef.ramps);
    this.buildSpawnBases();
    this.buildBackdrop();
    this.buildLandmarks();
    this.buildAmbientLife();
    this.buildZoneMarker();
    this.buildPaintSurfaces(this.mapDef.paintSurfaces);
    this.buildClimbableIndicators(this.mapDef.climbableSurfaces);
    this.buildStreetArtAndPosters(obstacles ?? this.mapDef.obstacles);
    this.buildGiantBillboards();
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

    this.detailGeometries = [];
    this.detailMaterials = [];
    this.famMats.clear();
    this.obstacleMeshes = [];
    this.paintSurfaceMeshes = [];
    this.rampMeshes = [];
    this.padMats = {};
    this.domeMats = {};
    this.pulsing = [];
    this.spinners = [];
    this.zoneMarker = undefined;
    this.zoneMaterials = [];
    this.motes = undefined;
    this.moteBase = undefined;
    this.motePhase = undefined;
    this.skyDome = undefined;
  }

  private track<G extends THREE.BufferGeometry>(geo: G): G {
    if (!this.detailGeometries.includes(geo)) this.detailGeometries.push(geo);
    return geo;
  }

  private trackM<M extends THREE.Material>(mat: M): M {
    if (!this.detailMaterials.includes(mat)) this.detailMaterials.push(mat);
    return mat;
  }

  /** Registers a material whose emissive intensity breathes over time. */
  private pulse<M extends THREE.MeshStandardMaterial>(mat: M, amp: number, speed: number, phase = 0): M {
    this.pulsing.push({ mat, base: mat.emissiveIntensity, amp, speed, phase });
    return mat;
  }

  private spin(obj: THREE.Object3D, speed: number, axis: 'x' | 'y' | 'z' = 'y'): void {
    this.spinners.push({ obj, speed, axis });
  }

  /** Self-lit material for neon strips, lamps and beacons. */
  private glowMat(color: number, intensity = 1.5, pulseAmp = 0, speed = 1.4, phase = 0): THREE.MeshStandardMaterial {
    const mat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.35),
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.4,
        metalness: 0
      })
    );
    if (pulseAmp > 0) this.pulse(mat, pulseAmp, speed, phase);
    return mat;
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
    renderOrder = 0,
    colors?: THREE.Color[]
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
      const c = colors?.[i];
      if (c) mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.renderOrder = renderOrder;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------

  private famOptions(fam: Fam): WorldMaterialOptions {
    switch (fam) {
      case 'concrete':
        return { side: texConcrete(), sideScale: [0.22, 0.22], topScale: 0.22, roughness: 0.92, bump: 1.1 };
      case 'brick':
        return { side: texBrick(), top: texConcrete(), sideScale: [0.3, 0.3], topScale: 0.22, roughness: 0.9, bump: 1.6 };
      case 'facade':
        return {
          side: texFacade(false),
          top: texConcrete(),
          glow: texFacade(true),
          glowColor: 0xffffff,
          glowIntensity: 1.3,
          sideScale: [1 / 6, 1 / 6],
          topScale: 0.2,
          roughness: 0.7,
          metalness: 0.1,
          bump: 0.5
        };
      case 'container':
        return {
          side: texContainer(),
          top: texMetalPlate(),
          sideScale: [1 / 6, 1 / 2.4],
          topScale: 0.25,
          roughness: 0.55,
          metalness: 0.3,
          bump: 1.2
        };
      case 'metal':
        return { side: texMetalPlate(), sideScale: [0.25, 0.25], topScale: 0.25, roughness: 0.45, metalness: 0.55, bump: 0.9 };
      case 'grate':
        return { side: texGrate(), sideScale: [0.5, 0.5], topScale: 0.5, roughness: 0.5, metalness: 0.5, bump: 1.0 };
      case 'crate':
        return { side: texCrate(), top: texPlanks(), sideScale: [0.33, 0.33], topScale: 0.3, roughness: 0.8, bump: 1.2 };
      case 'planks':
        return { side: texPlanks(), sideScale: [0.3, 0.3], topScale: 0.3, roughness: 0.85, bump: 1.0 };
      case 'snow':
        return { side: texSnow(), sideScale: [0.15, 0.15], topScale: 0.15, roughness: 0.9, bump: 0.6 };
      case 'ice':
        return { side: texIce(), sideScale: [0.15, 0.15], topScale: 0.15, roughness: 0.25, metalness: 0.1, bump: 0.4 };
      case 'panel':
        return { side: texPanel(), top: texMetalPlate(), sideScale: [0.2, 0.2], topScale: 0.25, roughness: 0.5, metalness: 0.35, bump: 1.0 };
      case 'hazard':
        return { side: texHazard(), sideScale: [0.5, 0.5], topScale: 0.5, roughness: 0.7, bump: 0.5 };
      case 'tile':
        return { side: texTile(), sideScale: [0.25, 0.25], topScale: 0.25, roughness: 0.6, bump: 0.7 };
    }
  }

  /** Obstacle material for a family; surfaces show team ink on up-facing faces. */
  private famMaterial(fam: Fam, color?: number): WorldMaterial {
    const key = `${fam}:${color ?? 'white'}`;
    let mat = this.famMats.get(key);
    if (!mat) {
      mat = createWorldMaterial({
        ...this.famOptions(fam),
        color,
        ink: this.paintEngine.texture,
        inkMapSize: this.mapDef.size
      });
      this.trackM(mat);
      this.famMats.set(key, mat);
    }
    return mat;
  }

  private pickTint(tint: Tint, id: string): THREE.Color {
    const hex = typeof tint === 'number' ? tint : (tint[hashStr(id) % tint.length] ?? 0xffffff);
    return new THREE.Color(hex);
  }

  // -------------------------------------------------------------------------
  // Ground + environment
  // -------------------------------------------------------------------------

  private buildGround(): void {
    const def = this.mapDef;
    const geo = this.track(this.buildGroundGeometry(def.size));
    const mat = this.trackM(
      createWorldMaterial({
        side: texGroundDetail(),
        topScale: 0.3,
        macro: getFloorTexture(def),
        macroSize: def.size,
        ink: this.paintEngine.texture,
        inkMapSize: def.size,
        roughness: 0.82,
        metalness: 0.04,
        bump: 0.8,
        groundShade: false
      })
    );
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);
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

  private buildGroundSkirt(): void {
    // A disc, not a square: its rim meets the dome's intersection circle so the
    // horizon closes cleanly at any viewing angle.
    const skirtGeo = this.track(new THREE.CircleGeometry(GROUND_SKIRT_RADIUS, 64));
    skirtGeo.rotateX(-Math.PI / 2);
    const isSnow = this.mapDef.id === 'aurora_outpost';
    const isDock = this.mapDef.id === 'cargo_docks';
    const skirtMat = this.trackM(
      createWorldMaterial({
        side: isSnow ? texSnow() : texConcrete(),
        topScale: isSnow ? 0.08 : 0.12,
        color: new THREE.Color(this.mapDef.theme.groundAlt).lerp(isDock ? new THREE.Color(0x3a5a70) : WHITE, 0.1).getHex(),
        roughness: 0.95,
        metalness: 0,
        groundShade: false
      })
    );
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.05;
    skirt.receiveShadow = true;
    this.group.add(skirt);
  }

  /**
   * Painted sky dome so the horizon reads as a place. It rides with the camera
   * on X/Z (keeping the horizon level) and drives the ambient animation from
   * `onBeforeRender`, which the renderer invokes once per visible frame.
   */
  private buildSkyDome(): void {
    const tex = getSkyTexture(this.mapDef);
    const domeMat = this.trackM(
      new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    const domeGeo = this.track(new THREE.SphereGeometry(SKY_DOME_RADIUS, 48, 32));
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

  private classify(obs: BoxObstacle): { fam: Fam; tint: THREE.Color } {
    const id = obs.id;
    if (id.startsWith('wall_')) {
      const [fam, hex] = PERIMETER[this.mapDef.id];
      return { fam, tint: new THREE.Color(hex) };
    }
    for (const [re, fam, tint] of RULES[this.mapDef.id]) {
      if (re.test(id)) return { fam, tint: this.pickTint(tint, id) };
    }
    return { fam: 'concrete', tint: new THREE.Color(this.mapDef.theme.obstacleColor).lerp(WHITE, 0.4) };
  }

  private buildObstacles(obstacles: BoxObstacle[]): void {
    const theme = this.mapDef.theme;
    const mapId = this.mapDef.id;
    const buckets = new Map<Fam, { xf: Xform[]; col: THREE.Color[] }>();

    const cornices: Xform[] = [];
    const corniceCols: THREE.Color[] = [];
    const neonA: Xform[] = [];
    const neonB: Xform[] = [];
    const stripes: Xform[] = [];
    const wallRails: Xform[] = [];
    const wallPillars: Xform[] = [];
    const wallLamps: Xform[] = [];
    const pinkStrips: Xform[] = [];
    const cyanStrips: Xform[] = [];
    const guardRails: Xform[] = [];
    const underpassBeams: Xform[] = [];
    const underpassLamps: Xform[] = [];
    const towerPylons: Xform[] = [];
    const aeroBeacons: Xform[] = [];
    const verticalSpotlights: Xform[] = [];
    const signGroups = new Map<SignDef, Xform[]>();

    for (const obs of obstacles) {
      const { fam, tint } = this.classify(obs);
      const isWall = obs.id.startsWith('wall_');
      const { x, y, z } = obs.position;
      const { x: sx, y: sy, z: sz } = obs.size;
      const topY = y + sy / 2;

      let b = buckets.get(fam);
      if (!b) {
        b = { xf: [], col: [] };
        buckets.set(fam, b);
      }
      b.xf.push({ x, y, z, sx, sy, sz });
      b.col.push(tint);

      if (isWall) {
        this.collectWallDetails(obs, wallRails, wallPillars, wallLamps, pinkStrips, cyanStrips);
        continue;
      }

      // Cornice: a ledge overhanging the top edge. It hangs *below* the top
      // plane so the walkable surface and the ink stay flush with the box.
      if (CORNICE_FAMS.has(fam) && sx >= 3 && sz >= 3 && sy >= 1.1) {
        const ch = 0.35;
        const ow = 0.3;
        const cc = tint.clone().lerp(WHITE, 0.4);
        const cy = topY - ch / 2;
        const parts: Xform[] = [
          { x, y: cy, z: z - sz / 2 - ow / 2, sx: sx + ow * 2, sy: ch, sz: ow },
          { x, y: cy, z: z + sz / 2 + ow / 2, sx: sx + ow * 2, sy: ch, sz: ow },
          { x: x - sx / 2 - ow / 2, y: cy, z, sx: ow, sy: ch, sz },
          { x: x + sx / 2 + ow / 2, y: cy, z, sx: ow, sy: ch, sz }
        ];
        for (const p of parts) {
          cornices.push(p);
          corniceCols.push(cc);
        }
      }

      // Neon trim band under the cornice, tinted by which side of the map the
      // building sits on (team accent colours).
      if (NEON[mapId].test(obs.id)) {
        const ny = topY - (sy >= 3 ? 0.75 : 0.45);
        const list = x < 0 ? neonA : neonB;
        list.push({ x, y: ny, z: z - sz / 2 - 0.05, sx: sx * 0.94, sy: 0.16, sz: 0.1 });
        list.push({ x, y: ny, z: z + sz / 2 + 0.05, sx: sx * 0.94, sy: 0.16, sz: 0.1 });
        list.push({ x: x - sx / 2 - 0.05, y: ny, z, sx: 0.1, sy: 0.16, sz: sz * 0.94 });
        list.push({ x: x + sx / 2 + 0.05, y: ny, z, sx: 0.1, sy: 0.16, sz: sz * 0.94 });
      }

      // Hazard stripes along low barrier tops.
      if (/^(barrier_|ring_|mid_wall|mid_block)/.test(obs.id)) {
        for (const edge of [-1, 1]) {
          stripes.push({ x, y: topY + 0.03, z: z + edge * (sz / 2 - 0.2), sx: sx * 0.92, sy: 0.06, sz: 0.14 });
        }
      }

      // Guard Railings on high bridges, elevated catwalks and balconies
      const isWalkway = /^(skywalk|hotel_skywalk|wh_skywalk|gantry_deck|rink_skywalk|polar_skybridge|tube_ab)/.test(obs.id);
      const isHighBalcony = topY >= 4.8 && /^(center_observatory|center_balcony|office_roof|office_penthouse|hotel_terrace|wh_deck|wh_nest|vip_balcony|vip_nest|radome_balcony|radome_dome|pier_gallery)/.test(obs.id);
      if (isWalkway || isHighBalcony) {
        const railH = 0.85;
        const postW = 0.08;
        const alongX = sx > sz;
        if (alongX) {
          for (const sgn of [-1, 1]) {
            const rz = z + sgn * (sz / 2 - 0.06);
            guardRails.push({ x, y: topY + railH, z: rz, sx: sx * 0.98, sy: 0.08, sz: 0.08 });
            guardRails.push({ x, y: topY + railH * 0.5, z: rz, sx: sx * 0.98, sy: 0.05, sz: 0.05 });
            const numPosts = Math.max(2, Math.floor(sx / 2.6));
            const stepX = sx / (numPosts - 1);
            for (let pi = 0; pi < numPosts; pi++) {
              const px = x - sx / 2 + pi * stepX;
              guardRails.push({ x: px, y: topY + railH / 2, z: rz, sx: postW, sy: railH, sz: postW });
            }
          }
        } else {
          for (const sgn of [-1, 1]) {
            const rx = x + sgn * (sx / 2 - 0.06);
            guardRails.push({ x: rx, y: topY + railH, z, sx: 0.08, sy: 0.08, sz: sz * 0.98 });
            guardRails.push({ x: rx, y: topY + railH * 0.5, z, sx: 0.05, sy: 0.05, sz: sz * 0.98 });
            const numPosts = Math.max(2, Math.floor(sz / 2.6));
            const stepZ = sz / (numPosts - 1);
            for (let pi = 0; pi < numPosts; pi++) {
              const pz = z - sz / 2 + pi * stepZ;
              guardRails.push({ x: rx, y: topY + railH / 2, z: pz, sx: postW, sy: railH, sz: postW });
            }
          }
        }
      }

      // Underpass steel girders and I-beams underneath elevated bridge decks
      const baseY = y - sy / 2;
      if (baseY >= 1.8 && isWalkway) {
        const beamH = 0.28;
        const alongX = sx > sz;
        if (alongX) {
          for (const sgn of [-1, 1]) {
            underpassBeams.push({
              x,
              y: baseY - beamH / 2,
              z: z + sgn * (sz / 2 - 0.15),
              sx: sx * 0.98,
              sy: beamH,
              sz: 0.18
            });
          }
          const ribs = Math.max(2, Math.floor(sx / 3.0));
          const stepX = sx / (ribs + 1);
          for (let ri = 1; ri <= ribs; ri++) {
            const rx = x - sx / 2 + ri * stepX;
            underpassBeams.push({
              x: rx,
              y: baseY - beamH / 2,
              z,
              sx: 0.18,
              sy: beamH * 0.9,
              sz: sz * 0.92
            });
            underpassLamps.push({
              x: rx,
              y: baseY - beamH - 0.06,
              z,
              sx: 0.35,
              sy: 0.1,
              sz: 0.35
            });
          }
        } else {
          for (const sgn of [-1, 1]) {
            underpassBeams.push({
              x: x + sgn * (sx / 2 - 0.15),
              y: baseY - beamH / 2,
              z,
              sx: 0.18,
              sy: beamH,
              sz: sz * 0.98
            });
          }
          const ribs = Math.max(2, Math.floor(sz / 3.0));
          const stepZ = sz / (ribs + 1);
          for (let ri = 1; ri <= ribs; ri++) {
            const rz = z - sz / 2 + ri * stepZ;
            underpassBeams.push({
              x,
              y: baseY - beamH / 2,
              z: rz,
              sx: sx * 0.92,
              sy: beamH * 0.9,
              sz: 0.18
            });
            underpassLamps.push({
              x,
              y: baseY - beamH - 0.06,
              z: rz,
              sx: 0.35,
              sy: 0.1,
              sz: 0.35
            });
          }
        }
      }

      // Edge hazard warning stripes on high terraces and roofs
      if (topY >= 3.5 && sy >= 1.0 && !isWall && !obs.id.includes('pillar') && (sx >= 4 || sz >= 4)) {
        for (const edge of [-1, 1]) {
          stripes.push({ x, y: topY + 0.02, z: z + edge * (sz / 2 - 0.12), sx: sx * 0.94, sy: 0.04, sz: 0.16 });
          stripes.push({ x: x + edge * (sx / 2 - 0.12), y: topY + 0.02, z, sx: 0.16, sy: 0.04, sz: sz * 0.94 });
        }
      }

      // Vertical neon corner accent channels on high-altitude towers
      if (topY >= 7.0 && sy >= 2.0 && !isWall && !obs.id.includes('pillar')) {
        const ny = y;
        const nh = sy * 0.96;
        for (const cx of [-1, 1]) {
          for (const cz of [-1, 1]) {
            towerPylons.push({
              x: x + cx * (sx / 2 + 0.04),
              y: ny,
              z: z + cz * (sz / 2 + 0.04),
              sx: 0.1,
              sy: nh,
              sz: 0.1
            });
          }
        }
      }

      // Aero-beacons / spotlights on the tallest pinnacles
      if (topY >= 10.5 && !isWall && !obs.id.includes('pillar') && (sx <= 2.5 || sz <= 2.5)) {
        aeroBeacons.push({
          x,
          y: topY + 0.45,
          z,
          sx: 0.5,
          sy: 0.9,
          sz: 0.5
        });
        verticalSpotlights.push({
          x,
          y: topY + 8.0,
          z,
          sx: 0.35,
          sy: 16.0,
          sz: 0.35
        });
      }

      // Signage on the faces turned toward the arena centre.
      for (const def of SIGNS[mapId]) {
        if (!def.re.test(obs.id)) continue;
        const faces: Array<{ nx: number; nz: number; len: number }> = [];
        const atX = Math.abs(x) > 0.5;
        const atZ = Math.abs(z) > 0.5;
        if (!atX && !atZ) {
          faces.push({ nx: 1, nz: 0, len: sz }, { nx: -1, nz: 0, len: sz }, { nx: 0, nz: 1, len: sx }, { nx: 0, nz: -1, len: sx });
        } else {
          if (atX) faces.push({ nx: x > 0 ? -1 : 1, nz: 0, len: sz });
          if (atZ) faces.push({ nx: 0, nz: z > 0 ? -1 : 1, len: sx });
        }
        let list = signGroups.get(def);
        if (!list) {
          list = [];
          signGroups.set(def, list);
        }
        for (const f of faces) {
          const w = Math.min(f.len - 1, 5.6);
          if (w < 2) continue;
          const h = w * 0.375;
          const sy2 = topY - (sy >= 3 ? 1.5 : 0.9) - (sy >= 3 ? 0 : 0);
          list.push({
            x: x + f.nx * (sx / 2 + 0.06),
            y: Math.max(h / 2 + 0.3, sy2),
            z: z + f.nz * (sz / 2 + 0.06),
            sx: w,
            sy: h,
            ry: f.nx > 0 ? Math.PI / 2 : f.nx < 0 ? -Math.PI / 2 : f.nz > 0 ? 0 : Math.PI
          });
        }
      }
    }

    // One InstancedMesh per surface family. InstancedMesh extends Mesh, so the
    // camera-collision accessor keeps working.
    for (const [fam, b] of buckets) {
      const mesh = this.addInstanced(this.unitBox, this.famMaterial(fam), b.xf, true, true, 0, b.col);
      if (mesh) this.obstacleMeshes.push(mesh);
    }

    const trimColor = new THREE.Color(theme.wallColor).lerp(WHITE, 0.5);
    this.addInstanced(this.unitBox, this.famMaterial('concrete'), cornices, false, true, 0, corniceCols);
    this.addInstanced(this.unitBox, this.famMaterial('hazard'), stripes);
    this.addInstanced(
      this.unitBox,
      this.famMaterial('metal'),
      wallRails,
      false,
      true,
      0,
      wallRails.map(() => trimColor)
    );
    this.addInstanced(
      this.unitBox,
      this.famMaterial('concrete'),
      wallPillars,
      false,
      true,
      0,
      wallPillars.map(() => trimColor)
    );
    this.addInstanced(this.unitBox, this.glowMat(theme.accentA, 1.6, 0.35, 1.3), neonA);
    this.addInstanced(this.unitBox, this.glowMat(theme.accentB, 1.6, 0.35, 1.3, 1.5), neonB);
    this.addInstanced(this.unitBox, this.glowMat(0xffe6b0, 1.8, 0.25, 0.8), wallLamps);
    this.addInstanced(this.unitBox, this.glowMat(0xff007f, 1.4, 0.3, 1.1), pinkStrips);
    this.addInstanced(this.unitBox, this.glowMat(0x00ffff, 1.4, 0.3, 1.1, 1.2), cyanStrips);

    const railColor = new THREE.Color(theme.wallColor).lerp(WHITE, 0.65);
    this.addInstanced(this.unitBox, this.famMaterial('metal'), guardRails, false, false, 0, guardRails.map(() => railColor));
    const girderColor = new THREE.Color(0x303540);
    this.addInstanced(this.unitBox, this.famMaterial('metal'), underpassBeams, false, true, 0, underpassBeams.map(() => girderColor));
    this.addInstanced(this.unitBox, this.glowMat(0xfffae0, 2.4, 0.9, 1.2, 0.25), underpassLamps);
    this.addInstanced(this.unitBox, this.glowMat(theme.accentB, 1.8, 0.4, 1.5), towerPylons);
    this.addInstanced(this.unitBox, this.glowMat(0xffe880, 2.8, 0.8, 2.2), aeroBeacons);

    if (verticalSpotlights.length > 0) {
      const beamGeo = this.track(new THREE.CylinderGeometry(0.18, 0.9, 1, 8));
      const beamMat = this.trackM(
        new THREE.MeshBasicMaterial({
          color: theme.accentA,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      );
      this.addInstanced(beamGeo, beamMat, verticalSpotlights);
    }

    // Signs: unlit emissive-looking textures, one instanced quad batch per sign.
    const planeGeo = this.track(new THREE.PlaneGeometry(1, 1));
    for (const [def, xf] of signGroups) {
      const tex = makeSignTexture(def.text, def.color, def.sub);
      const mat = this.trackM(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      this.addInstanced(planeGeo, mat, xf);
    }
  }

  /**
   * Appends one perimeter wall's top rail, inner-face pillars, lamps and (for
   * the two team walls) glow strip to the shared batches.
   */
  private collectWallDetails(
    obs: BoxObstacle,
    rails: Xform[],
    pillars: Xform[],
    lamps: Xform[],
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

    const span = size / 2 - 5;
    for (let d = -span; d <= span; d += 15) {
      if (horizontal) {
        const zz = obs.position.z + (obs.position.z > 0 ? -1.1 : 1.1);
        pillars.push({ x: obs.position.x + d, y: obs.position.y, z: zz, sx: 0.5, sy: obs.size.y - 0.3, sz: 0.3 });
        lamps.push({ x: obs.position.x + d, y: 3.9, z: zz + (obs.position.z > 0 ? -0.3 : 0.3), sx: 0.55, sy: 0.3, sz: 0.25 });
      } else {
        const xx = obs.position.x + (obs.position.x > 0 ? -1.1 : 1.1);
        pillars.push({ x: xx, y: obs.position.y, z: obs.position.z + d, sx: 0.3, sy: obs.size.y - 0.3, sz: 0.5 });
        lamps.push({ x: xx + (obs.position.x > 0 ? -0.3 : 0.3), y: 3.9, z: obs.position.z + d, sx: 0.25, sy: 0.3, sz: 0.55 });
      }
    }

    // Team glow strip near each spawn wall (pink west, cyan east)
    if (horizontal) return;
    const isWest = obs.position.x < 0;
    const stripLen = Math.min(34, size * 0.26);
    const strip: Xform = {
      x: obs.position.x + (isWest ? 1.06 : -1.06),
      y: 1.4,
      z: obs.position.z,
      sx: 0.1,
      sy: 0.5,
      sz: stripLen
    };
    (isWest ? pinkStrips : cyanStrips).push(strip);
  }

  // -------------------------------------------------------------------------
  // Ramps (solid wedges, matching the shared ramp collision exactly)
  // -------------------------------------------------------------------------

  private buildRamps(ramps: MapDef['ramps']): void {
    if (!ramps.length) return;
    const theme = this.mapDef.theme;
    const [fam, tint] = RAMP_STYLE[this.mapDef.id];
    const rampMat = this.famMaterial(fam, tint);
    const stripMats: THREE.Matrix4[] = [];
    const stripCenter = new THREE.Vector3();
    const stripDir = new THREE.Vector3();
    const stripQuat = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);

    const positions: number[] = [];

    for (const ramp of ramps) {
      if (!ramp.climbable) continue;
      const { x, z } = ramp.position;
      const len = ramp.length;
      const w = ramp.width;
      const rise = ramp.rise;
      // Climb direction (matches CollisionWorld.rampHeightAt).
      const dx = ramp.direction === 'east' ? 1 : ramp.direction === 'west' ? -1 : 0;
      const dz = ramp.direction === 'south' ? 1 : ramp.direction === 'north' ? -1 : 0;
      const px = -dz * (w / 2);
      const pz = dx * (w / 2);
      const lx = x - dx * (len / 2);
      const lz = z - dz * (len / 2);
      const hx = x + dx * (len / 2);
      const hz = z + dz * (len / 2);

      const baseY = ramp.position.y - ramp.rise / 2;
      const topY = baseY + ramp.rise;

      // Corners: low (A,B) and high (C,D) on the base plane; C2/D2 at the top edge.
      const A = [lx + px, baseY, lz + pz];
      const B = [lx - px, baseY, lz - pz];
      const C = [hx + px, baseY, hz + pz];
      const D = [hx - px, baseY, hz - pz];
      const C2 = [hx + px, topY, hz + pz];
      const D2 = [hx - px, topY, hz - pz];
      const tris: number[][][] = [
        [A, B, D2],
        [A, D2, C2], // slope
        [C, C2, D2],
        [C, D2, D], // back wall
        [A, C2, C], // +side
        [B, D, D2] // -side
      ];
      for (const tri of tris) {
        const [a, b, c] = tri as [number[], number[], number[]];
        // Flip winding when the face normal points toward the ramp's centre.
        const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const n = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!
        ];
        const cx = (a[0]! + b[0]! + c[0]!) / 3 - x;
        const cy = (a[1]! + b[1]! + c[1]!) / 3 - (baseY + rise / 3);
        const cz = (a[2]! + b[2]! + c[2]!) / 3 - z;
        const outward = n[0]! * cx + n[1]! * cy + n[2]! * cz;
        const order = outward >= 0 ? [a, b, c] : [a, c, b];
        for (const v of order) positions.push(v[0]!, v[1]!, v[2]!);
      }

      // Glowing guide strips along both slope edges.
      const sl = Math.hypot(len, rise);
      stripDir.set(dx * len, rise, dz * len).normalize();
      stripQuat.setFromUnitVectors(xAxis, stripDir);
      for (const side of [-1, 1]) {
        stripCenter.set(x + px * side * 0.94, baseY + rise / 2 + 0.05, z + pz * side * 0.94);
        this.tmpScale.set(sl, 0.1, 0.22);
        const m = new THREE.Matrix4().compose(stripCenter, stripQuat, this.tmpScale);
        stripMats.push(m);
      }
    }

    if (positions.length > 0) {
      const geo = this.track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, rampMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.rampMeshes.push(mesh);
    }

    if (stripMats.length > 0) {
      const mesh = new THREE.InstancedMesh(this.unitBox, this.glowMat(theme.accentB, 1.5, 0.3, 1.6), stripMats.length);
      stripMats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // Backdrop outside the walls
  // -------------------------------------------------------------------------

  /** Walks the four sides of the arena placing footprints in rows outside the walls. */
  private perimeterSlots(
    rng: () => number,
    cfg: { inner: number; width: [number, number]; depth: [number, number]; gap: [number, number] }
  ): Array<{ x: number; z: number; w: number; d: number; side: number }> {
    const half = this.mapDef.size / 2;
    const out: Array<{ x: number; z: number; w: number; d: number; side: number }> = [];
    for (let side = 0; side < 4; side++) {
      const alongX = side < 2; // north/south rows run along x
      // Z-rows stay within the arena width; X-rows may extend past the corners.
      const ext = alongX ? half : half + 40;
      let pos = -ext;
      for (;;) {
        const w = cfg.width[0] + rng() * (cfg.width[1] - cfg.width[0]);
        if (pos + w > ext) break;
        const d = cfg.depth[0] + rng() * (cfg.depth[1] - cfg.depth[0]);
        const c = pos + w / 2;
        const o = half + cfg.inner + d / 2;
        const sgn = side % 2 === 0 ? 1 : -1;
        if (alongX) out.push({ x: c, z: sgn * o, w, d, side });
        else out.push({ x: sgn * o, z: c, w: d, d: w, side });
        pos += w + cfg.gap[0] + rng() * (cfg.gap[1] - cfg.gap[0]);
      }
    }
    return out;
  }

  private buildBackdrop(): void {
    const id = this.mapDef.id;
    const theme = this.mapDef.theme;
    const half = this.mapDef.size / 2;
    const rng = makeRng(hashStr(id) ^ 0x51ed);

    if (id === 'downtown' || id === 'sky_rink') {
      const bodies: Xform[] = [];
      const cols: THREE.Color[] = [];
      const crowns: Xform[] = [];
      const crownCols: THREE.Color[] = [];
      const palette = id === 'downtown' ? [0xc8c0e0, 0xe0c8d8, 0xc0d4f0, 0xd8d0c0] : [0xb8c0f0, 0xc8b8f0, 0xb0e0f0, 0xd0c8f8];
      for (let row = 0; row < 2; row++) {
        const slots = this.perimeterSlots(rng, {
          inner: row === 0 ? 6 : 26,
          width: [8, 15],
          depth: [7, 11],
          gap: [0.5, 3]
        });
        for (const s of slots) {
          const h = row === 0 ? 9 + rng() * 11 : 20 + rng() * 14;
          bodies.push({ x: s.x, y: h / 2, z: s.z, sx: s.w, sy: h, sz: s.d });
          cols.push(new THREE.Color(palette[Math.floor(rng() * palette.length)] ?? 0xffffff).multiplyScalar(0.72));
          crowns.push({ x: s.x, y: h + 0.25, z: s.z, sx: s.w * 1.02, sy: 0.5, sz: s.d * 1.02 });
          crownCols.push(new THREE.Color(rng() > 0.5 ? theme.accentA : theme.accentB));
          if (rng() > 0.6) {
            crowns.push({ x: s.x, y: h + 3, z: s.z, sx: 0.3, sy: 6, sz: 0.3 });
            crownCols.push(new THREE.Color(0xffffff));
          }
        }
      }
      this.addInstanced(this.unitBox, this.famMaterial('facade'), bodies, false, false, 0, cols);
      this.addInstanced(this.unitBox, this.glowMat(0xffffff, 1.6, 0.3, 0.9), crowns, false, false, 0, crownCols);
    } else if (id === 'cargo_docks') {
      const bodies: Xform[] = [];
      const cols: THREE.Color[] = [];
      for (let row = 0; row < 2; row++) {
        const slots = this.perimeterSlots(rng, {
          inner: row === 0 ? 5 : 14,
          width: [11, 12],
          depth: [2.8, 3],
          gap: [0.4, 1.2]
        });
        for (const s of slots) {
          const tiers = 1 + Math.floor(rng() * (row === 0 ? 3 : 5));
          for (let t = 0; t < tiers; t++) {
            bodies.push({ x: s.x, y: 1.2 + t * 2.4, z: s.z, sx: s.w, sy: 2.4, sz: s.d });
            cols.push(new THREE.Color(CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)] ?? 0xffffff));
          }
        }
      }
      this.addInstanced(this.unitBox, this.famMaterial('container'), bodies, false, false, 0, cols);

      // Four portal cranes standing behind the stacks.
      const legs: Xform[] = [];
      const beams: Xform[] = [];
      const cranePos: Array<[number, number, number]> = [
        [-half - 32, -half * 0.4, 1],
        [half + 32, half * 0.5, 1],
        [half * 0.45, half + 36, 0],
        [-half * 0.5, -half - 36, 0]
      ];
      for (const [cx, cz, alongZ] of cranePos) {
        const span = 20;
        const hh = 26;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            legs.push({ x: cx + sx * (alongZ ? 4 : span / 2), y: hh / 2, z: cz + sz * (alongZ ? span / 2 : 4), sx: 1, sy: hh, sz: 1 });
          }
        }
        beams.push({ x: cx, y: hh + 1, z: cz, sx: alongZ ? 9 : span + 14, sy: 2, sz: alongZ ? span + 14 : 9 });
      }
      this.addInstanced(this.unitBox, this.famMaterial('metal', 0xffa629), legs);
      this.addInstanced(this.unitBox, this.famMaterial('metal', 0xff9020), beams);
    } else {
      // Aurora outpost: snow hills ringed with radio masts.
      const hillGeo = this.track(new THREE.ConeGeometry(1, 1, 7));
      const hills: Xform[] = [];
      const hillCols: THREE.Color[] = [];
      const count = 18;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.2;
        const dist = half + 26 + rng() * 36;
        const r = 16 + rng() * 14;
        const h = 12 + rng() * 16;
        hills.push({ x: Math.cos(a) * dist, y: h / 2 - 0.2, z: Math.sin(a) * dist, sx: r, sy: h, sz: r, ry: rng() * 3 });
        hillCols.push(new THREE.Color(rng() > 0.5 ? 0xf0f6ff : 0xd4e4f4));
      }
      this.addInstanced(hillGeo, this.famMaterial('snow'), hills, false, false, 0, hillCols);

      const masts: Xform[] = [];
      const beacons: Xform[] = [];
      const mastPos: Array<[number, number]> = [
        [half + 12, -half * 0.55],
        [-half - 12, half * 0.55],
        [half * 0.6, half + 12],
        [-half * 0.6, -half - 12]
      ];
      for (const [mx, mz] of mastPos) {
        masts.push({ x: mx, y: 11, z: mz, sx: 0.7, sy: 22, sz: 0.7 });
        masts.push({ x: mx, y: 17, z: mz, sx: 4.5, sy: 0.25, sz: 0.25 });
        masts.push({ x: mx, y: 13, z: mz, sx: 0.25, sy: 0.25, sz: 3.6 });
        beacons.push({ x: mx, y: 22.4, z: mz, sx: 0.9, sy: 0.9, sz: 0.9 });
      }
      this.addInstanced(this.unitBox, this.famMaterial('metal', 0xe8f0f8), masts);
      this.addInstanced(this.unitBox, this.glowMat(0xff3a3a, 1.8, 1.2, 1.5), beacons);
    }

    if (id === 'sky_rink') {
      // Stadium floodlight masts at the four corners.
      const posts: Xform[] = [];
      const heads: Xform[] = [];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const px = sx * (half + 4);
          const pz = sz * (half + 4);
          posts.push({ x: px, y: 8, z: pz, sx: 0.7, sy: 16, sz: 0.7 });
          heads.push({ x: px - sx * 0.8, y: 16.4, z: pz - sz * 0.8, sx: 3.2, sy: 1.1, sz: 1.2, ry: Math.atan2(sx, sz) + Math.PI / 4 });
        }
      }
      this.addInstanced(this.unitBox, this.famMaterial('metal', 0xd8dcf0), posts, false);
      this.addInstanced(this.unitBox, this.glowMat(0xfff4dc, 2.2), heads);
    }
  }

  // -------------------------------------------------------------------------
  // Signature landmarks (all above head height, so they never imply false cover)
  // -------------------------------------------------------------------------

  private buildLandmarks(): void {
    const theme = this.mapDef.theme;
    const id = this.mapDef.id;

    const meshAt = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      return m;
    };

    if (id === 'downtown') {
      // Holographic marker floating above the plaza.
      const octa = this.track(new THREE.OctahedronGeometry(1, 0));
      const core = meshAt(
        octa,
        this.trackM(
          new THREE.MeshStandardMaterial({
            color: 0x401030,
            emissive: theme.accentA,
            emissiveIntensity: 1.2,
            transparent: true,
            opacity: 0.75
          })
        ),
        0,
        11,
        0,
        2,
        3,
        2
      );
      const cage = meshAt(
        octa,
        this.trackM(new THREE.MeshBasicMaterial({ color: theme.accentB, wireframe: true })),
        0,
        11,
        0,
        3.1,
        4.4,
        3.1
      );
      this.group.add(core, cage);
      this.spin(core, 0.9);
      this.spin(cage, -0.6);
    } else if (id === 'cargo_docks') {
      // Crane jib that slowly sweeps around the mast.
      const jib = new THREE.Group();
      const steel = this.famMaterial('metal', 0xff9a2a);
      const hazard = this.famMaterial('hazard');
      jib.add(meshAt(this.unitBox, steel, 6, 12.9, 0, 34, 1.4, 1.4));
      jib.add(meshAt(this.unitBox, hazard, -13, 12.9, 0, 5, 2.4, 2.4));
      jib.add(meshAt(this.unitBox, steel, 1.5, 11.5, 0, 2.6, 2.2, 2.6));
      jib.add(meshAt(this.unitBox, steel, 14, 9.5, 0, 0.12, 6.4, 0.12));
      jib.add(meshAt(this.unitBox, hazard, 14, 6.3, 0, 0.7, 0.7, 0.7));
      jib.add(meshAt(this.unitBox, this.glowMat(0xff3a3a, 1.8, 1, 1.6), 22.8, 13.8, 0, 0.5, 0.5, 0.5));
      this.group.add(jib);
      this.spin(jib, 0.12);
    } else if (id === 'sky_rink') {
      // Two gyroscopic neon hoops over the centre funbox.
      const ringGeoA = this.track(new THREE.TorusGeometry(8.5, 0.14, 8, 72));
      const ringGeoB = this.track(new THREE.TorusGeometry(6.6, 0.12, 8, 64));
      const hoopA = new THREE.Mesh(ringGeoA, this.glowMat(theme.accentA, 1.8, 0.3, 1.1));
      const hoopB = new THREE.Mesh(ringGeoB, this.glowMat(theme.accentB, 1.8, 0.3, 1.3, 1));
      const pivotA = new THREE.Group();
      const pivotB = new THREE.Group();
      pivotA.position.set(0, 15, 0);
      pivotB.position.set(0, 15, 0);
      pivotB.rotation.z = Math.PI / 2;
      pivotA.add(hoopA);
      pivotB.add(hoopB);
      const sphere = this.track(new THREE.SphereGeometry(0.9, 16, 12));
      const coreMesh = new THREE.Mesh(sphere, this.glowMat(0xffffff, 2));
      coreMesh.position.set(0, 15, 0);
      this.group.add(pivotA, pivotB, coreMesh);
      this.spin(hoopA, 0.5);
      this.spin(hoopB, -0.7);
    } else {
      // Radome mast: rotating dish and a pulsing red beacon.
      const dishGeo = this.track(new THREE.SphereGeometry(3.4, 24, 10, 0, Math.PI * 2, 0, 0.85));
      const dishMat = this.trackM(
        new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide })
      );
      const pivot = new THREE.Group();
      pivot.position.set(0, 13.2, 0);
      const dish = new THREE.Mesh(dishGeo, dishMat);
      dish.rotation.x = 2.3;
      dish.castShadow = true;
      pivot.add(dish);
      pivot.add(meshAt(this.unitBox, this.famMaterial('metal', 0xffffff), 0, -0.8, 0, 0.3, 1.6, 0.3));
      this.group.add(pivot);
      this.spin(pivot, 0.25);
      const bea = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.6, 12, 10)), this.glowMat(0xff3a3a, 2, 1.2, 1.5));
      bea.position.set(0, 12.4, 0);
      this.group.add(bea);
    }

    // Central tournament Crowned Squid Mascot floor emblem
    const mascotTex = getMascotTexture();
    const platH = id === 'sky_rink' ? 2.4 : 3.6;

    // 1. Central contested fighting platform deck emblem (on top of the central tower / platform deck where players fight!)
    const platformEmblemGeo = this.track(new THREE.CircleGeometry(id === 'sky_rink' ? 3.0 : 3.8, 32));
    platformEmblemGeo.rotateX(-Math.PI / 2);
    const platformEmblemMat = this.trackM(
      new THREE.MeshStandardMaterial({
        map: mascotTex,
        emissiveMap: mascotTex,
        emissive: 0xffd700,
        emissiveIntensity: 0.85,
        transparent: true,
        opacity: 0.92,
        roughness: 0.35,
        depthWrite: false
      })
    );
    const platformEmblem = new THREE.Mesh(platformEmblemGeo, platformEmblemMat);
    platformEmblem.position.set(0, platH + 0.04, 0);
    platformEmblem.renderOrder = 2;
    this.group.add(platformEmblem);

    const platformHaloGeo = this.track(new THREE.TorusGeometry(id === 'sky_rink' ? 3.3 : 4.1, 0.08, 8, 48));
    platformHaloGeo.rotateX(Math.PI / 2);
    const platformHalo = new THREE.Mesh(platformHaloGeo, this.glowMat(0xffd700, 2.2, 0.35, 1.2));
    platformHalo.position.set(0, platH + 0.05, 0);
    this.group.add(platformHalo);
    this.spin(platformHalo, 0.3);

    // 2. Central tournament plaza floor emblems (on open ground in front of the central landmark)
    const plazaOffset = id === 'downtown' ? 22 : id === 'cargo_docks' ? 26 : id === 'sky_rink' ? 18 : 24;
    const groundEmblemGeo = this.track(new THREE.CircleGeometry(3.2, 32));
    groundEmblemGeo.rotateX(-Math.PI / 2);
    const groundEmblemMat = this.trackM(
      new THREE.MeshStandardMaterial({
        map: mascotTex,
        emissiveMap: mascotTex,
        emissive: 0xffd700,
        emissiveIntensity: 0.75,
        transparent: true,
        opacity: 0.88,
        roughness: 0.4,
        depthWrite: false
      })
    );

    for (const sx of [-1, 1]) {
      const gMesh = new THREE.Mesh(groundEmblemGeo, groundEmblemMat);
      gMesh.position.set(sx * plazaOffset, 0.05, 0);
      gMesh.renderOrder = 2;
      this.group.add(gMesh);

      const gHalo = new THREE.Mesh(
        this.track(new THREE.TorusGeometry(3.5, 0.07, 8, 48).rotateX(Math.PI / 2)),
        this.glowMat(0xffd700, 2.0, 0.3, 1.1)
      );
      gHalo.position.set(sx * plazaOffset, 0.06, 0);
      this.group.add(gHalo);
      this.spin(gHalo, sx * 0.25);
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

      // Circular 3D floor emblem decal featuring team inkling crest / avatar
      const emblemTex = getTeamEmblemTexture(team);
      const emblemGeo = this.track(new THREE.CircleGeometry(3.6, 32));
      emblemGeo.rotateX(-Math.PI / 2);
      const emblemMat = this.trackM(
        new THREE.MeshStandardMaterial({
          map: emblemTex,
          emissiveMap: emblemTex,
          emissive: colorHex,
          emissiveIntensity: 0.65,
          roughness: 0.35,
          metalness: 0.1,
          transparent: true,
          opacity: 0.92,
          depthWrite: false
        })
      );
      const emblemMesh = new THREE.Mesh(emblemGeo, emblemMat);
      emblemMesh.position.set(x, 0.22, 0);
      emblemMesh.renderOrder = 2;
      this.group.add(emblemMesh);

      // Rotating holographic gyro ring around the emblem
      const ringTorus = this.track(new THREE.TorusGeometry(3.9, 0.08, 8, 48));
      ringTorus.rotateX(Math.PI / 2);
      const ringMesh = new THREE.Mesh(ringTorus, this.glowMat(colorHex, 2.2, 0.35, 1.4));
      ringMesh.position.set(x, 0.24, 0);
      this.group.add(ringMesh);
      this.spin(ringMesh, isPink ? 0.35 : -0.35);
    };

    makeTeam(Team.PINK, -spawnX);
    makeTeam(Team.CYAN, spawnX);

    // One draw per team for the pad+ring and the dome, one for the poles.
    this.addInstanced(padGeo, this.padMaterial(Team.PINK), pinkPads, false, true);
    this.addInstanced(padGeo, this.padMaterial(Team.CYAN), cyanPads, false, true);
    this.addInstanced(domeGeo, this.domeMaterial(Team.PINK), pinkDomes);
    this.addInstanced(domeGeo, this.domeMaterial(Team.CYAN), cyanDomes);
    this.addInstanced(poleGeo, this.padMaterial(Team.PINK), pinkPoles, false);
    this.addInstanced(poleGeo, this.padMaterial(Team.CYAN), cyanPoles, false);

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

    // Central crowned squid mascot holographic floor emblem
    const mascotRadius = Math.min(w, d) * 0.38;
    const mascotGeo = this.track(new THREE.CircleGeometry(mascotRadius, 32));
    mascotGeo.rotateX(-Math.PI / 2);
    const mascotTex = getMascotTexture();
    const mascotMat = this.trackM(
      new THREE.MeshBasicMaterial({
        map: mascotTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    const mascotMesh = new THREE.Mesh(mascotGeo, mascotMat);
    mascotMesh.position.y = 0.07;
    mascotMesh.renderOrder = 4;
    group.add(mascotMesh);
    this.zoneMaterials.push(mascotMat);

    // Glowing holographic rings around the zone mascot
    const zoneRingGeo = this.track(new THREE.TorusGeometry(mascotRadius * 1.08, 0.06, 8, 48));
    zoneRingGeo.rotateX(Math.PI / 2);
    const zoneRingMat = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false
      })
    );
    const zoneRing = new THREE.Mesh(zoneRingGeo, zoneRingMat);
    zoneRing.position.y = 0.075;
    group.add(zoneRing);
    this.spin(zoneRing, 0.4);
    this.zoneMaterials.push(zoneRingMat);

    // Also project/place the holographic crowned squid mascot on top of the central contested platform deck
    const platH = this.mapDef.id === 'sky_rink' ? 2.4 : 3.6;
    const platMascotGeo = this.track(new THREE.CircleGeometry(3.6, 32));
    platMascotGeo.rotateX(-Math.PI / 2);
    const platMascotMat = this.trackM(
      new THREE.MeshBasicMaterial({
        map: mascotTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    const platMascotMesh = new THREE.Mesh(platMascotGeo, platMascotMat);
    platMascotMesh.position.set(0, platH + 0.05, 0);
    platMascotMesh.renderOrder = 4;
    group.add(platMascotMesh);
    this.zoneMaterials.push(platMascotMat);

    const platRingGeo = this.track(new THREE.TorusGeometry(3.9, 0.06, 8, 48));
    platRingGeo.rotateX(Math.PI / 2);
    const platRingMat = this.trackM(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      })
    );
    const platRing = new THREE.Mesh(platRingGeo, platRingMat);
    platRing.position.set(0, platH + 0.055, 0);
    group.add(platRing);
    this.spin(platRing, 0.45);
    this.zoneMaterials.push(platRingMat);

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
   * Renders vertical paintable wall faces as transparent overlay meshes
   * using the surface ink texture from PaintEngine.
   */
  private buildPaintSurfaces(surfaces: PaintSurface[]): void {
    const rectGeo = this.track(new THREE.PlaneGeometry(1, 1));
    const tex = this.paintEngine.getSurfaceTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.trackM(mat);
    const mesh = new THREE.InstancedMesh(rectGeo, mat, surfaces.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;

    for (let i = 0; i < surfaces.length; i++) {
      const s = surfaces[i];
      if (!s) continue;
      // Position and size derived from the PaintSurface definition.
      const nx = s.normal.x;
      const nz = s.normal.z;
      const alongX = Math.abs(nx) > 0.5;
      const width = alongX ? s.size.z : s.size.x;
      const height = s.size.y;
      let ry = 0;
      if (nx > 0.5) ry = Math.PI / 2;       // facing east (+x)
      else if (nx < -0.5) ry = -Math.PI / 2; // facing west (-x)
      else if (nz > 0.5) ry = 0;             // facing south (+z)
      else if (nz < -0.5) ry = Math.PI;      // facing north (-z)

      const faceDist = (alongX ? s.size.x : s.size.z) / 2 + 0.02;
      this.tmpPos.set(
        s.position.x + nx * faceDist,
        s.position.y,
        s.position.z + nz * faceDist
      );
      this.tmpEuler.set(0, ry, 0);
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpScale.set(width, height, 1);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(i, this.tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.paintSurfaceMeshes.push(mesh);
  }

  /**
   * Places neon vertical guide indicators on climbable pillars and walls
   * so players visually recognize vertical swim routes.
   */
  private buildClimbableIndicators(surfaces: ClimbableSurface[]): void {
    const rails: Xform[] = [];
    const rungs: Xform[] = [];
    const theme = this.mapDef.theme;

    for (const cs of surfaces) {
      if (cs.id.startsWith('climb_wall')) continue; // skip perimeter boundary walls
      const { x, y, z } = cs.position;
      const { x: sx, y: sy, z: sz } = cs.size;
      const { x: nx, z: nz } = cs.normal;
      const alongX = Math.abs(nx) > 0.5;

      const faceWidth = alongX ? sz : sx;
      const railOffset = Math.max(0.2, faceWidth * 0.42);
      const offX = nx * 0.04;
      const offZ = nz * 0.04;

      // Two vertical neon guide rails on the sides of the climbable face
      for (const side of [-1, 1]) {
        rails.push({
          x: x + offX + (alongX ? 0 : side * railOffset),
          y,
          z: z + offZ + (alongX ? side * railOffset : 0),
          sx: alongX ? 0.08 : 0.12,
          sy: sy * 0.96,
          sz: alongX ? 0.12 : 0.08
        });
      }

      // Horizontal traversal rungs spaced every ~0.9m along the vertical climb
      const stepH = 0.9;
      const rungCount = Math.max(2, Math.floor(sy / stepH));
      const startY = y - sy * 0.5 + stepH * 0.5;
      for (let r = 0; r < rungCount; r++) {
        const ry = startY + r * stepH;
        rungs.push({
          x: x + offX,
          y: ry,
          z: z + offZ,
          sx: alongX ? 0.06 : railOffset * 2,
          sy: 0.08,
          sz: alongX ? railOffset * 2 : 0.06
        });
      }
    }

    if (rails.length > 0) {
      this.addInstanced(this.unitBox, this.glowMat(theme.accentB, 1.6, 0.4, 1.8), rails);
    }
    if (rungs.length > 0) {
      this.addInstanced(this.unitBox, this.glowMat(theme.accentA, 1.3, 0.35, 1.8, 1.2), rungs);
    }
  }

  /**
   * Places street art graffiti decals, tactical sponsor posters, and weapon ads
   * onto perimeter walls, shipping containers, and crates.
   */
  private buildStreetArtAndPosters(obstacles: BoxObstacle[]): void {
    const half = this.mapDef.size / 2;
    const posters = getAllSponsorPosters();
    if (posters.length === 0) return;

    // Map of poster ID -> transforms
    const posterBatches = new Map<string, { url: string; xfs: Xform[] }>();
    for (const p of posters) {
      posterBatches.set(p.id, { url: p.url, xfs: [] });
    }
    const frameBatches: Xform[] = [];

    let posterIndex = 0;
    const nextPoster = () => {
      const p = posters[posterIndex % posters.length]!;
      posterIndex++;
      return p;
    };

    // 1. Perimeter barrier walls: evenly spaced sponsor posters along inner faces
    for (const obs of obstacles) {
      if (!obs.id.startsWith('wall_')) continue;
      const isNorth = obs.id === 'wall_north';
      const isSouth = obs.id === 'wall_south';
      const isEast = obs.id === 'wall_east';
      const isWest = obs.id === 'wall_west';

      const span = half - 12;
      for (let offset = -span; offset <= span; offset += 14) {
        const p = nextPoster();
        const batch = posterBatches.get(p.id);
        if (!batch) continue;

        let px = obs.position.x;
        let pz = obs.position.z;
        let ry = 0;

        if (isNorth) {
          pz -= obs.size.z / 2 + 0.04;
          px += offset;
          ry = Math.PI;
        } else if (isSouth) {
          pz += obs.size.z / 2 + 0.04;
          px += offset;
          ry = 0;
        } else if (isEast) {
          px -= obs.size.x / 2 + 0.04;
          pz += offset;
          ry = -Math.PI / 2;
        } else if (isWest) {
          px += obs.size.x / 2 + 0.04;
          pz += offset;
          ry = Math.PI / 2;
        }

        const py = 2.1;
        const pw = 2.2;
        const ph = 2.2;

        const normX = isEast ? -1 : isWest ? 1 : 0;
        const normZ = isNorth ? -1 : isSouth ? 1 : 0;
        batch.xfs.push({
          x: px + normX * 0.005,
          y: py,
          z: pz + normZ * 0.005,
          sx: pw,
          sy: ph,
          sz: 1,
          ry
        });
        frameBatches.push({
          x: px,
          y: py,
          z: pz,
          sx: pw + 0.14,
          sy: ph + 0.14,
          sz: 1,
          ry
        });
      }
    }

    // 2. Shipping containers, Crates, and Cover Barriers in the arena
    for (const obs of obstacles) {
      if (obs.id.startsWith('wall_')) continue;
      const id = obs.id;
      const sx = obs.size.x;
      const sy = obs.size.y;
      const ox = obs.position.x;
      const oy = obs.position.y;
      const oz = obs.position.z;

      const isContainer = id.includes('cont_') || id.includes('warehouse') || id.includes('base_wing') || id.includes('yard_') || id.includes('hangar');
      const isCrate = id.includes('crate') || id.includes('stall');
      const isBarrier = id.includes('barrier') || id.includes('jersey') || id.includes('mid_wall') || id.includes('cover_') || id.includes('mid_block') || id.includes('lane_wall');
      const isPillar = id.includes('pillar') || id.includes('_pil') || id.includes('mast');

      if (!isContainer && !isCrate && !isBarrier && !isPillar) continue;

      // Deterministic selection based on id hash
      const h = hashStr(id);
      if (h % 3 === 0 && !isPillar) continue; // Leave some natural breathing room, but keep underpass pillars decorated

      const p = posters[h % posters.length]!;
      const batch = posterBatches.get(p.id);
      if (!batch) continue;

      const pw = isPillar ? 1.4 : isCrate ? 1.3 : isContainer ? 2.3 : 1.8;
      const ph = isPillar ? 1.4 : isCrate ? 1.3 : isContainer ? 2.3 : 1.8;
      const py = isPillar ? 2.0 : Math.max(ph / 2 + 0.3, Math.min(oy, 2.4));

      // Pick outward face
      const pickX = Math.abs(ox) > Math.abs(oz);
      let fx = 0;
      let fz = 0;
      let ry = 0;

      if (pickX) {
        fx = ox > 0 ? -1 : 1;
        ry = fx > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        fz = oz > 0 ? -1 : 1;
        ry = fz > 0 ? 0 : Math.PI;
      }

      const px = ox + fx * (sx / 2 + 0.04);
      const pz = oz + fz * (obs.size.z / 2 + 0.04);

      // Micro outward offset (+0.005) ensures crisp layering over frameMat without z-fighting
      batch.xfs.push({ x: px + fx * 0.005, y: py, z: pz + fz * 0.005, sx: pw, sy: ph, sz: 1, ry });
      frameBatches.push({
        x: px,
        y: py,
        z: pz,
        sx: pw + 0.12,
        sy: ph + 0.12,
        sz: 1,
        ry
      });
    }

    // 3. Render batched InstancedMeshes
    const planeGeo = this.track(new THREE.PlaneGeometry(1, 1));
    const frameMat = this.trackM(
      new THREE.MeshStandardMaterial({
        color: 0x181c24,
        roughness: 0.8,
        metalness: 0.2
      })
    );
    this.addInstanced(planeGeo, frameMat, frameBatches);

    for (const [, data] of posterBatches) {
      if (data.xfs.length === 0) continue;
      const tex = getAssetTexture(data.url);
      const posterMat = this.trackM(
        new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.55,
          metalness: 0.1,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1
        })
      );
      this.addInstanced(planeGeo, posterMat, data.xfs);
    }
  }

  /**
   * Builds giant Times Square / Inkopolis style video walls and high-rise
   * electronic billboard screens across the skyline and arena landmarks.
   */
  private buildGiantBillboards(): void {
    const half = this.mapDef.size / 2;
    const mapId = this.mapDef.id;
    const theme = this.mapDef.theme;
    const configs = getBillboardConfigs();

    const placeScreen = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      rotY: number,
      cfgIdx: number,
      customNeon?: number
    ): void => {
      const cfg = configs[cfgIdx % configs.length]!;
      const neonColor = customNeon ?? cfg.accent;
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = rotY;

      // 1. Dark structural metal housing backing
      const backGeo = this.track(new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.35));
      const backMat = this.trackM(
        new THREE.MeshStandardMaterial({
          color: 0x12151c,
          roughness: 0.7,
          metalness: 0.5
        })
      );
      const backMesh = new THREE.Mesh(backGeo, backMat);
      backMesh.position.set(0, 0, -0.17);
      group.add(backMesh);

      // 2. High-resolution electronic screen surface
      const screenGeo = this.track(new THREE.PlaneGeometry(w, h));
      const texture = getAssetTexture(cfg.url);
      const screenMat = this.trackM(
        new THREE.MeshStandardMaterial({
          map: texture,
          emissiveMap: texture,
          emissive: 0xffffff,
          emissiveIntensity: 0.95,
          roughness: 0.2,
          metalness: 0.05,
          toneMapped: false
        })
      );
      const screenMesh = new THREE.Mesh(screenGeo, screenMat);
      screenMesh.position.set(0, 0, 0.02);
      group.add(screenMesh);

      // 3. Neon border tubes (top, bottom, left, right)
      const neonMat = this.glowMat(neonColor, 2.2, 0.35, 1.4);
      const tubeHGeo = this.track(new THREE.BoxGeometry(w + 0.2, 0.09, 0.09));
      const tubeVGeo = this.track(new THREE.BoxGeometry(0.09, h + 0.2, 0.09));

      const topTube = new THREE.Mesh(tubeHGeo, neonMat);
      topTube.position.set(0, h / 2 + 0.06, 0.04);
      const btmTube = new THREE.Mesh(tubeHGeo, neonMat);
      btmTube.position.set(0, -h / 2 - 0.06, 0.04);
      const leftTube = new THREE.Mesh(tubeVGeo, neonMat);
      leftTube.position.set(-w / 2 - 0.06, 0, 0.04);
      const rightTube = new THREE.Mesh(tubeVGeo, neonMat);
      rightTube.position.set(w / 2 + 0.06, 0, 0.04);
      group.add(topTube, btmTube, leftTube, rightTube);

      // 4. Illuminated marquee header bar & support trusses
      const headerGeo = this.track(new THREE.BoxGeometry(w * 0.65, 0.35, 0.15));
      const headerMesh = new THREE.Mesh(headerGeo, this.glowMat(neonColor, 1.8));
      headerMesh.position.set(0, h / 2 + 0.32, 0);
      group.add(headerMesh);

      // 5. Heavy-duty structural steel support pillars extending down to anchor elevated screens
      const pillarHeight = y - h / 2;
      if (pillarHeight > 0.8) {
        const pillarGeo = this.track(new THREE.BoxGeometry(0.35, pillarHeight, 0.35));
        for (const px of [-w * 0.35, w * 0.35]) {
          const pillar = new THREE.Mesh(pillarGeo, backMat);
          pillar.position.set(px, -h / 2 - pillarHeight / 2, -0.15);
          group.add(pillar);
        }
      }

      const mastGeo = this.track(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6));
      for (const mx of [-w * 0.35, w * 0.35]) {
        const mast = new THREE.Mesh(mastGeo, backMat);
        mast.position.set(mx, h / 2 + 0.7, -0.1);
        group.add(mast);
      }

      this.group.add(group);
    };

    // --- A. Skyline High-Rise Mega Screens (Times Square / Inkopolis skyline) ---
    // North Skyline (facing South into arena)
    placeScreen(-22, 17.5, half + 8, 13.0, 7.3, Math.PI, 0); // Duel clash
    placeScreen(20, 18.5, half + 9, 12.0, 6.75, Math.PI, 5); // Victory stage

    // South Skyline (facing North into arena)
    placeScreen(22, 17.5, -half - 8, 13.0, 7.3, 0, 1); // Title hero
    placeScreen(-20, 18.5, -half - 9, 12.0, 6.75, 0, 6); // Defeat stage

    // East Skyline (facing West into arena)
    placeScreen(half + 8, 17.5, -16, 12.0, 6.75, -Math.PI / 2, 2); // Octoling rival
    placeScreen(half + 9, 16.0, 18, 11.0, 6.2, -Math.PI / 2, 8); // Cyan star

    // West Skyline (facing East into arena)
    placeScreen(-half - 8, 17.5, 16, 12.0, 6.75, Math.PI / 2, 3); // Gold champion
    placeScreen(-half - 9, 16.0, -18, 11.0, 6.2, Math.PI / 2, 7); // Pink star

    // All Four Angled Corner Skylines (overlooking all 4 diagonal arena axes)
    placeScreen(half + 7, 19.5, half + 7, 11.0, 6.2, -Math.PI * 0.75, 4); // North-East (Squid morph)
    placeScreen(-half - 7, 19.5, -half - 7, 11.0, 6.2, Math.PI * 0.25, 0); // South-West (Duel clash)
    placeScreen(-half - 7, 19.5, half + 7, 11.0, 6.2, Math.PI * 0.75, 1); // North-West (Title hero)
    placeScreen(half + 7, 19.5, -half - 7, 11.0, 6.2, -Math.PI * 0.25, 2); // South-East (Octoling rival)

    // --- B. In-Arena Elevated Landmark Screens (Central Towers & High-Rise Facades) ---
    if (mapId === 'downtown') {
      // 1. Central Metropolis Tower: 4-sided video walls greeting both team spawns & plazas
      // West face (facing -X towards Team Pink spawn corridor)
      placeScreen(-5.1, 6.6, 0, 5.8, 3.3, -Math.PI / 2, 0, theme.accentA);
      // East face (facing +X towards Team Cyan spawn corridor)
      placeScreen(5.1, 6.6, 0, 5.8, 3.3, Math.PI / 2, 1, theme.accentB);
      // North face (facing +Z towards Skywalk & North plaza)
      placeScreen(0, 6.6, 5.1, 5.8, 3.3, 0, 2, theme.accentA);
      // South face (facing -Z towards South alley)
      placeScreen(0, 6.6, -5.1, 5.8, 3.3, Math.PI, 3, theme.accentB);

      // 2. High-Rise Skyscraper Facades (Office & Hotel video billboards)
      // East Office skyscraper facade (x = 46, z = 52) facing West into arena lane
      placeScreen(37.8, 6.8, 52, 6.2, 3.5, -Math.PI / 2, 4);
      // West Office skyscraper facade (x = -46, z = 52) facing East into arena lane
      placeScreen(-37.8, 6.8, 52, 6.2, 3.5, Math.PI / 2, 7);
      // Hotel tower facade (x = 18, z = 52) facing South into central plaza
      placeScreen(18, 6.8, 45.8, 6.0, 3.4, Math.PI, 8);
      // Mirrored Hotel tower facade (x = -18, z = -52) facing North into central plaza
      placeScreen(-18, 6.8, -45.8, 6.0, 3.4, 0, 5);
    } else if (mapId === 'cargo_docks') {
      // 1. Central Crane Rig: screens facing East and West towards team spawn lanes
      placeScreen(-7.1, 6.6, 0, 6.0, 3.4, -Math.PI / 2, 0, 0xff9020);
      placeScreen(7.1, 6.6, 0, 6.0, 3.4, Math.PI / 2, 1, 0x35c4d8);
      // 2. Massive Harbor Warehouse facades (x = 54, z = 50 and -54, -50)
      placeScreen(41.8, 6.5, 50, 7.2, 4.0, -Math.PI / 2, 2, 0xff9020);
      placeScreen(-41.8, 6.5, -50, 7.2, 4.0, Math.PI / 2, 0, 0x35c4d8);
      // 3. Gantry Tower (x = 60, z = 26)
      placeScreen(55.8, 7.2, 26, 5.6, 3.2, -Math.PI / 2, 5, 0xffa629);
    } else if (mapId === 'sky_rink') {
      // 1. Suspended 4-Sided Center Jumbotron Cube over the rink funbox
      placeScreen(0, 8.5, 4.2, 6.0, 3.4, 0, 0, theme.accentA);
      placeScreen(0, 8.5, -4.2, 6.0, 3.4, Math.PI, 1, theme.accentB);
      placeScreen(4.2, 8.5, 0, 6.0, 3.4, Math.PI / 2, 5, theme.accentA);
      placeScreen(-4.2, 8.5, 0, 6.0, 3.4, -Math.PI / 2, 7, theme.accentB);
      // 2. VIP Stadium Penthouse facades (x = 52, z = 50 and -52, -50)
      placeScreen(46.8, 6.5, 50, 5.8, 3.2, -Math.PI / 2, 2, theme.accentB);
      placeScreen(-46.8, 6.5, -50, 5.8, 3.2, Math.PI / 2, 3, theme.accentA);
    } else {
      // Aurora outpost polar command radome & research hangars
      // 1. Central Radome screens facing team approach axes
      placeScreen(-8.2, 6.5, 0, 6.0, 3.4, -Math.PI / 2, 0, 0x54ffd0);
      placeScreen(8.2, 6.5, 0, 6.0, 3.4, Math.PI / 2, 1, 0x8a7dff);
      // 2. Research Hangar facades (x = 56, z = 34 and -56, -34)
      placeScreen(44.8, 5.8, 34, 6.4, 3.6, -Math.PI / 2, 2, 0x54ffd0);
      placeScreen(-44.8, 5.8, -34, 6.4, 3.6, Math.PI / 2, 4, 0x8a7dff);
      // 3. Polar Lab (x = 18, z = 26)
      placeScreen(18, 6.0, 19.8, 5.4, 3.0, Math.PI, 3, 0x54ffd0);
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

  /**
   * Returns vertical paint surface meshes for client-side raycasting.
   */
  getPaintSurfaceMeshes(): THREE.InstancedMesh[] {
    return this.paintSurfaceMeshes;
  }

  /**
   * Returns ramp mesh objects for visual debugging / UI.
   */
  getRampMeshes(): THREE.Mesh[] {
    return this.rampMeshes;
  }
}
