import * as THREE from 'three';
import { Team, type MapId } from '@ink/shared';

/**
 * Central Texture & In-Game Material Asset Manager for Ink Arena.
 *
 * Provides cached, high-performance textures for:
 * - Giant high-rise electronic billboards and Times Square-style video walls
 * - Circular holographic team spawn pad emblems and central mascot decals
 * - High-resolution 360 panoramic sky dome backdrops
 * - Street art, graffiti decals, and weapon/gear tactical sponsor posters
 *
 * Reliability & Zero-Blackscreen Guarantee:
 * - Immediate procedural canvas fallback texture generated instantly for every asset
 * - Seamless asynchronous upgrade when the HTTP image finishes loading
 * - Safe error handling: surfaces never render pitch black or untextured
 * - 100% headless / Node.js safe for vitest and SSR environments
 */

// ---------------------------------------------------------------------------
// Asset Manifest
// ---------------------------------------------------------------------------

export const ASSET_PATHS = {
  // Panoramic Arena Skies
  skies: {
    downtown: '/assets/backgrounds/arena_downtown.jpg',
    cargo_docks: '/assets/backgrounds/arena_cargo_docks.jpg',
    sky_rink: '/assets/backgrounds/arena_sky_rink.jpg',
    aurora_outpost: '/assets/backgrounds/arena_aurora_outpost.jpg'
  } as Record<MapId, string>,

  // Giant Billboard & Electronic Video Wall Artworks (16:9 widescreen & character spotlights)
  billboards: [
    {
      id: 'duel_clash',
      url: '/assets/characters/inkling_duel_clash.jpg',
      title: 'INK ARENA WORLD CHAMPIONSHIP',
      accent: 0xff007f
    },
    {
      id: 'title_hero',
      url: '/assets/backgrounds/title_hero.jpg',
      title: 'INKOPOLIS HERO LEAGUE',
      accent: 0x00ffff
    },
    {
      id: 'octoling_rival',
      url: '/assets/characters/octoling_rival.jpg',
      title: 'OCTOLING ELITE TOURNAMENT',
      accent: 0xb336ff
    },
    {
      id: 'inkling_gold',
      url: '/assets/characters/inkling_gold.jpg',
      title: 'GOLD LEAGUE ALL-STAR',
      accent: 0xffd700
    },
    {
      id: 'squid_morph',
      url: '/assets/characters/squid_morph.jpg',
      title: 'SUPER JUMP EVOLUTION',
      accent: 0x36e2ec
    },
    {
      id: 'victory_stage',
      url: '/assets/backgrounds/victory_stage.jpg',
      title: 'GRAND VICTORY CEREMONY',
      accent: 0xffa500
    },
    {
      id: 'defeat_stage',
      url: '/assets/backgrounds/defeat_stage.jpg',
      title: 'TURF BATTLE SHOWDOWN',
      accent: 0xff3366
    },
    {
      id: 'inkling_pink_star',
      url: '/assets/characters/inkling_pink.jpg',
      title: 'TEAM PINK ACE SHOOTER',
      accent: 0xff007f
    },
    {
      id: 'inkling_cyan_star',
      url: '/assets/characters/inkling_cyan.jpg',
      title: 'TEAM CYAN CHARGER SPECIALIST',
      accent: 0x00ffff
    }
  ],

  // Mascots & Spawn / Objective Holographic Floor Decals
  mascot: '/assets/mascot/avatar_squid_mascot.jpg',
  mascotFallback: '/assets/avatars/avatar_squid.jpg',
  teamEmblems: {
    [Team.PINK]: '/assets/characters/inkling_pink.jpg',
    [Team.CYAN]: '/assets/characters/inkling_cyan.jpg'
  } as Record<Team, string>,
  teamAvatars: {
    [Team.PINK]: '/assets/avatars/avatar_pink.jpg',
    [Team.CYAN]: '/assets/avatars/avatar_cyan.jpg'
  } as Record<Team, string>,

  // Weapon Sponsor Posters & Tactical Street Art
  weaponPosters: [
    { id: 'splattershot', url: '/assets/weapons/splattershot.jpg', label: 'SPLATTERSHOT PRO' },
    { id: 'splat_roller', url: '/assets/weapons/splat_roller.jpg', label: 'CRACK-THE-TURF ROLLER' },
    { id: 'splat_charger', url: '/assets/weapons/splat_charger.jpg', label: 'LONG-RANGE CHARGER' },
    { id: 'slosher', url: '/assets/weapons/slosher.jpg', label: 'HEAVY IMPACT SLOSHER' },
    { id: 'cannon', url: '/assets/weapons/cannon.jpg', label: 'TITAN SIEGE CANNON' },
    { id: 'marksman', url: '/assets/weapons/marksman.jpg', label: 'PRECISION MARKSMAN' },
    { id: 'scatter', url: '/assets/weapons/scatter.jpg', label: 'RAPID SCATTER GUN' },
    { id: 'sprayer', url: '/assets/weapons/sprayer.jpg', label: 'DUAL SPRAYER TURBO' },
    { id: 'burst_bomb', url: '/assets/weapons/burst_bomb.jpg', label: 'BURST BOMB TACTICAL' },
    { id: 'curling_bomb', url: '/assets/weapons/curling_bomb.jpg', label: 'CURLING BOMB SWEEP' },
    { id: 'inkstrike', url: '/assets/weapons/inkstrike.jpg', label: 'ORBITAL INKSTRIKE' },
    { id: 'killer_wail', url: '/assets/weapons/killer_wail.jpg', label: 'KILLER WAIL 5.1' }
  ],

  // Gear Sponsor Posters & Street Fashion Decals
  gearPosters: [
    { id: 'tactical_vest', url: '/assets/gear/tactical_vest.jpg', label: 'ARMOR VEST SPEC-OPS' },
    { id: 'techwear_hoodie', url: '/assets/gear/techwear_hoodie.jpg', label: 'INK-RESIST TECHWEAR' },
    { id: 'tactical_helmet', url: '/assets/gear/tactical_helmet.jpg', label: 'COMBAT VISOR HELMET' },
    { id: 'combat_boots', url: '/assets/gear/combat_boots.jpg', label: 'STEALTH GRIP BOOTS' },
    { id: 'headset_visor', url: '/assets/gear/headset_visor.jpg', label: 'COMM-LINK HEADSET' },
    { id: 'street_sneakers', url: '/assets/gear/street_sneakers.jpg', label: 'HIGH-TOP AGILITY' },
    { id: 'ink_tank', url: '/assets/gear/ink_tank.jpg', label: 'HIGH-CAPACITY TANK' }
  ]
};

// ---------------------------------------------------------------------------
// Procedural Fallback Canvases
// ---------------------------------------------------------------------------

function createFallbackCanvas(url: string): HTMLCanvasElement {
  const c = document.createElement('canvas');

  // 1. Electronic Billboard Widescreen Screen (16:9)
  const billboard = ASSET_PATHS.billboards.find((b) => b.url === url);
  if (billboard) {
    const W = 512;
    const H = 288;
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    const accent = `#${billboard.accent.toString(16).padStart(6, '0')}`;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0a0d16');
    bg.addColorStop(0.5, '#121726');
    bg.addColorStop(1, '#0e1220');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // High-tech digital grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Glowing neon marquee borders
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    // Live broadcast header pill
    ctx.fillStyle = accent;
    ctx.fillRect(20, 18, 160, 26);
    ctx.fillStyle = '#05070e';
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LIVE BROADCAST', 100, 31);

    // Main billboard championship title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(billboard.title, W / 2, H / 2 - 8);

    // Channel / sponsor ticker
    ctx.fillStyle = accent;
    ctx.font = 'bold 14px monospace';
    ctx.fillText('TURF WAR LEAGUE // 4K HIGH DYNAMIC DISPLAY', W / 2, H / 2 + 28);

    // Scanlines effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let y = 0; y < H; y += 4) {
      ctx.fillRect(0, y, W, 1.5);
    }
    return c;
  }

  // 2. Tactical Weapon Sponsor Poster
  const weapon = ASSET_PATHS.weaponPosters.find((w) => w.url === url);
  if (weapon) {
    const W = 384;
    const H = 512;
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.fillStyle = '#0f1422';
    ctx.fillRect(0, 0, W, H);

    // Blueprint grid
    ctx.strokeStyle = 'rgba(255, 140, 30, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // Header bar
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(16, 16, W - 32, 34);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ARMAMENT SPONSOR', W / 2, 33);

    // Weapon Label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.fillText(weapon.label, W / 2, H / 2 - 10);

    // Technical crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2 + 65, 45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 55, H / 2 + 65); ctx.lineTo(W / 2 + 55, H / 2 + 65);
    ctx.moveTo(W / 2, H / 2 + 10); ctx.lineTo(W / 2, H / 2 + 120);
    ctx.stroke();

    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('HIGH IMPACT TURF MUNITIONS', W / 2, H - 40);
    return c;
  }

  // 3. Tactical Gear Sponsor Poster
  const gear = ASSET_PATHS.gearPosters.find((g) => g.url === url);
  if (gear) {
    const W = 384;
    const H = 512;
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    ctx.fillStyle = '#140f24';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#a64dff';
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    ctx.fillStyle = '#a64dff';
    ctx.fillRect(16, 16, W - 32, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TACTICAL GEAR APPAREL', W / 2, 33);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.fillText(gear.label, W / 2, H / 2 - 10);

    ctx.fillStyle = '#d499ff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('INK-RESISTANT COMBAT SERIES', W / 2, H / 2 + 35);
    return c;
  }

  // 4. Team Emblems, Mascot & Floor Holographic Decals
  const W = 512;
  const H = 512;
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  const isPink = url.includes('pink');
  const isCyan = url.includes('cyan');
  const accent = isPink ? '#ff007f' : isCyan ? '#00ffff' : '#ffd700';

  ctx.fillStyle = '#0d111d';
  ctx.fillRect(0, 0, W, H);

  // Radial energy flare
  const rg = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 230);
  rg.addColorStop(0, accent);
  rg.addColorStop(0.65, 'rgba(0,0,0,0.4)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 230, 0, Math.PI * 2);
  ctx.fill();

  // Geometric concentric target rings
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 205, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 175, 0, Math.PI * 2);
  ctx.stroke();

  // Crowned squid emblem typography
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 36px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isPink ? 'TEAM PINK' : isCyan ? 'TEAM CYAN' : 'INK ARENA', W / 2, H / 2);

  ctx.fillStyle = accent;
  ctx.font = 'bold 16px monospace';
  ctx.fillText('CHAMPIONSHIP SQUID CREST', W / 2, H / 2 + 45);

  return c;
}

// ---------------------------------------------------------------------------
// Texture Cache & Safe Loader
// ---------------------------------------------------------------------------

const textureCache = new Map<string, THREE.Texture>();
let sharedLoader: THREE.TextureLoader | null = null;

function getSharedLoader(): THREE.TextureLoader | null {
  if (typeof document === 'undefined' || typeof (document as any).createElementNS !== 'function') return null;
  if (!sharedLoader) {
    sharedLoader = new THREE.TextureLoader();
  }
  return sharedLoader;
}

/**
 * Loads a texture with automatic deduplication, SRGB color space, and safe headless fallback.
 *
 * Guarantees that textures NEVER flash or render black while loading:
 * - Instantly binds a crisp procedural fallback canvas texture
 * - Seamlessly replaces with the loaded image when download completes
 */
export function getAssetTexture(url: string, opts: { repeat?: boolean; anisotropy?: number } = {}): THREE.Texture {
  const cached = textureCache.get(url);
  if (cached) return cached;

  const loader = getSharedLoader();
  if (!loader) {
    // Headless / Node environment (vitest): create a safe dummy texture that never throws
    const dummy = new THREE.Texture();
    dummy.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, dummy);
    return dummy;
  }

  // 1. Immediately create a high-resolution procedural fallback canvas texture
  const fallbackCanvas = createFallbackCanvas(url);
  const texture = new THREE.CanvasTexture(fallbackCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = opts.anisotropy ?? 8;

  if (opts.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  } else {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }
  texture.needsUpdate = true;

  textureCache.set(url, texture);

  // 2. Asynchronously load the actual image asset from URL
  loader.load(
    url,
    (loadedTex) => {
      if (loadedTex.image) {
        texture.image = loadedTex.image;
        texture.needsUpdate = true;
      }
    },
    undefined,
    (err) => {
      // In case of 404 or image decode error, keep the procedural fallback
      console.warn(`[AssetTextures] Asset '${url}' load failed, retaining procedural fallback:`, err);
    }
  );

  return texture;
}

/** Returns the panoramic artwork texture for a given map. */
export function getMapPanoramaTexture(mapId: MapId): THREE.Texture {
  const path = ASSET_PATHS.skies[mapId] ?? ASSET_PATHS.skies.downtown;
  return getAssetTexture(path);
}

/** Returns the crowned squid mascot texture for floor decals and holographic emblems. */
export function getMascotTexture(): THREE.Texture {
  return getAssetTexture(ASSET_PATHS.mascot);
}

/** Returns the team emblem texture for spawn pads and team bases. */
export function getTeamEmblemTexture(team: Team): THREE.Texture {
  return getAssetTexture(ASSET_PATHS.teamEmblems[team] ?? ASSET_PATHS.teamEmblems[Team.PINK]);
}

/** Returns all electronic billboard artworks for high-rise video walls. */
export function getBillboardConfigs() {
  return ASSET_PATHS.billboards;
}

/** Returns combined list of weapon and gear sponsor posters. */
export function getAllSponsorPosters() {
  return [
    ...ASSET_PATHS.weaponPosters.map((p) => ({ ...p, type: 'weapon' as const })),
    ...ASSET_PATHS.gearPosters.map((p) => ({ ...p, type: 'gear' as const }))
  ];
}

/**
 * Proactively preloads all billboard artworks, sponsor posters, and emblems
 * into browser memory / HTTP cache as soon as the client boots.
 */
export function preloadAssetTextures(): void {
  // Mascots & Emblems
  getAssetTexture(ASSET_PATHS.mascot);
  getAssetTexture(ASSET_PATHS.teamEmblems[Team.PINK]);
  getAssetTexture(ASSET_PATHS.teamEmblems[Team.CYAN]);

  // Billboards
  for (const b of ASSET_PATHS.billboards) {
    getAssetTexture(b.url);
  }

  // Sponsor posters
  for (const p of ASSET_PATHS.weaponPosters) {
    getAssetTexture(p.url);
  }
  for (const g of ASSET_PATHS.gearPosters) {
    getAssetTexture(g.url);
  }
}

