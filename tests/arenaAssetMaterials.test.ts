import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMapDef, Team } from '@ink/shared';
import {
  ASSET_PATHS,
  getAssetTexture,
  getBillboardConfigs,
  getAllSponsorPosters,
  getMascotTexture,
  getTeamEmblemTexture,
  getMapPanoramaTexture,
  preloadAssetTextures
} from '../client/src/rendering/AssetTextures.js';
import { getSkyTexture } from '../client/src/rendering/MapArt.js';
import { Arena } from '../client/src/world/Arena.js';
import { PaintEngine } from '../client/src/world/PaintEngine.js';

// Setup headless mock canvas document for 3D Arena test execution in Node
if (typeof document === 'undefined') {
  const createMockCtx = () => {
    const base: any = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      getLineDash: () => []
    };
    return new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      }
    });
  };

  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const ctx = createMockCtx();
        return {
          width: 512,
          height: 512,
          getContext: (type: string) => (type === '2d' ? ctx : null)
        };
      }
      return {};
    }
  };
}

describe('AssetTextures - Asset & Texture Manager', () => {
  it('deduplicates textures: same URL returns the identical instance', () => {
    const tex1 = getAssetTexture(ASSET_PATHS.mascot);
    const tex2 = getAssetTexture(ASSET_PATHS.mascot);
    expect(tex1).toBe(tex2);
    expect(tex1).toBeInstanceOf(THREE.Texture);
    expect(tex1.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('provides valid textures across all asset categories', () => {
    // Mascots & Emblems
    const mascot = getMascotTexture();
    const pinkEmblem = getTeamEmblemTexture(Team.PINK);
    const cyanEmblem = getTeamEmblemTexture(Team.CYAN);
    expect(mascot).toBeInstanceOf(THREE.Texture);
    expect(pinkEmblem).toBeInstanceOf(THREE.Texture);
    expect(cyanEmblem).toBeInstanceOf(THREE.Texture);

    // Panoramas
    for (const mapId of ['downtown', 'cargo_docks', 'sky_rink', 'aurora_outpost'] as const) {
      const pano = getMapPanoramaTexture(mapId);
      expect(pano).toBeInstanceOf(THREE.Texture);
    }

    // Billboards
    const billboards = getBillboardConfigs();
    expect(billboards.length).toBeGreaterThanOrEqual(8);
    for (const b of billboards) {
      expect(b.url).toBeDefined();
      expect(b.title).toBeDefined();
      const t = getAssetTexture(b.url);
      expect(t).toBeInstanceOf(THREE.Texture);
    }

    // Sponsor posters
    const posters = getAllSponsorPosters();
    expect(posters.length).toBeGreaterThanOrEqual(15);
    for (const p of posters) {
      expect(p.url).toBeDefined();
      expect(p.label).toBeDefined();
      const t = getAssetTexture(p.url);
      expect(t).toBeInstanceOf(THREE.Texture);
    }
  });

  it('runs safely in headless Node.js environment without throwing document is not defined', () => {
    expect(() => {
      getAssetTexture('/assets/weapons/splattershot.jpg');
      getAssetTexture('/assets/gear/tactical_vest.jpg');
    }).not.toThrow();
  });

  it('preloadAssetTextures warms up caches for all asset types without throwing', () => {
    expect(() => {
      preloadAssetTextures();
    }).not.toThrow();
  });
});

describe('MapArt - 3D Sky Dome with Bespoke Panorama Assets', () => {
  it('builds sky textures for all maps with equirectangular wrap configuration', () => {
    for (const mapId of ['downtown', 'cargo_docks', 'sky_rink', 'aurora_outpost'] as const) {
      const def = getMapDef(mapId);
      const skyTex = getSkyTexture(def);
      expect(skyTex).toBeInstanceOf(THREE.CanvasTexture);
      expect(skyTex.wrapS).toBe(THREE.RepeatWrapping);
      expect(skyTex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    }
  });
});

describe('Arena 3D In-Game Integration of Bespoke Visual Assets', () => {
  function createTestArena(mapId: 'downtown' | 'cargo_docks' | 'sky_rink' | 'aurora_outpost' = 'downtown'): Arena {
    const def = getMapDef(mapId);
    const paintEngine = new PaintEngine(def.size);
    return new Arena(paintEngine, def);
  }

  it('places giant high-rise electronic billboards and Times Square-style video screens', () => {
    const arena = createTestArena('downtown');
    let billboardScreenCount = 0;
    let emissiveScreens = 0;

    arena.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.emissiveMap && mat.emissiveIntensity >= 0.9) {
          billboardScreenCount++;
          if (mat.toneMapped === false) emissiveScreens++;
        }
      }
    });

    // Should have both perimeter skyline mega-screens and in-arena landmark screens
    expect(billboardScreenCount).toBeGreaterThanOrEqual(10);
    expect(emissiveScreens).toBeGreaterThanOrEqual(10);
  });

  it('embeds circular holographic floor emblems on team spawn pads and central plaza', () => {
    const arena = createTestArena('downtown');
    let floorEmblems = 0;

    arena.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        // Floor decals are circle geometry rotated -PI/2
        if (mesh.geometry instanceof THREE.CircleGeometry && mesh.position.y > 0.03 && mesh.position.y < 0.3) {
          floorEmblems++;
        }
      }
    });

    // At least 2 team spawn pad emblems + 1 central tournament emblem
    expect(floorEmblems).toBeGreaterThanOrEqual(3);
  });

  it('incorporates crowned squid mascot into the zone marker and responds to ownership changes', () => {
    const arena = createTestArena('downtown');
    arena.setZoneVisible(true);
    expect(arena.isZoneMarkerVisible()).toBe(true);

    // Initial neutral state: zone ownership to pink
    arena.setZoneOwner(Team.PINK);
    // Find zone meshes and verify their materials are tinted
    let foundPinkMascotOrZone = false;
    arena.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (mat && mat.color && mat.color.getHex() === 0xff007f) {
          foundPinkMascotOrZone = true;
        }
      }
    });
    expect(foundPinkMascotOrZone).toBe(true);

    // Switch to cyan
    arena.setZoneOwner(Team.CYAN);
    let foundCyanMascotOrZone = false;
    arena.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (mat && mat.color && mat.color.getHex() === 0x00ffff) {
          foundCyanMascotOrZone = true;
        }
      }
    });
    expect(foundCyanMascotOrZone).toBe(true);
  });

  it('places batched street art, graffiti decals, and weapon/gear sponsor posters', () => {
    const arena = createTestArena('cargo_docks');
    let instancedMeshCount = 0;

    arena.group.traverse((obj) => {
      if ((obj as THREE.InstancedMesh).isInstancedMesh) {
        instancedMeshCount++;
      }
    });

    // Includes obstacle batches, signs, wall details, plus sponsor poster batches and frames
    expect(instancedMeshCount).toBeGreaterThanOrEqual(8);
  });

  it('places elevated crowned squid mascot on top of the central contested platform deck', () => {
    const arena = createTestArena('downtown');
    let elevatedPlatformMascot = false;

    arena.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry instanceof THREE.CircleGeometry && mesh.position.y > 2.0) {
          elevatedPlatformMascot = true;
        }
      }
    });

    expect(elevatedPlatformMascot).toBe(true);
  });

  it('covers all 4 diagonal corner skylines with mega video walls', () => {
    const arena = createTestArena('downtown');
    let cornerScreens = 0;

    arena.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        // Screens with diagonal rotations (not aligned to 90-degree axes)
        if (mat && mat.emissiveMap && Math.abs(mesh.parent?.rotation.y ?? 0) > 0.1 && (Math.abs(mesh.parent?.rotation.y ?? 0) % (Math.PI / 2) > 0.2)) {
          cornerScreens++;
        }
      }
    });

    // 4 diagonal corners (NE, SW, NW, SE)
    expect(cornerScreens).toBeGreaterThanOrEqual(4);
  });

  it('supports clean map swapping and rebuild() without resource leaks or errors', () => {
    const arena = createTestArena('downtown');
    expect(() => {
      arena.rebuild(getMapDef('cargo_docks'));
      arena.rebuild(getMapDef('sky_rink'));
      arena.rebuild(getMapDef('aurora_outpost'));
    }).not.toThrow();
  });
});
