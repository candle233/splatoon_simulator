import * as THREE from 'three';

const TEX_SIZE = 512;

// -------------------------------------------------------------------------
// Seeded PRNG (mulberry32) for deterministic procedural textures.
// -------------------------------------------------------------------------
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------------------------------------------------------------
// Canvas helpers
// -------------------------------------------------------------------------
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function makeCanvasTexture(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Draw a single noise pixel block (repeated) into ctx
function fillNoise(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number, brightness: number, variance: number): void {
  const imgData = ctx.createImageData(w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = brightness + (rng() - 0.5) * variance * 255;
    d[i] = Math.max(0, Math.min(255, v));
    d[i + 1] = Math.max(0, Math.min(255, v));
    d[i + 2] = Math.max(0, Math.min(255, v));
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

// -------------------------------------------------------------------------
// Procedural asphalt/concrete ground texture
// Returns { color, normal } textures (512x512, tileable)
// -------------------------------------------------------------------------
export function createGroundTexture(baseColor: number, altColor: number, seed = 1): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const rng = makeRng(seed);

  // Color map: fine-grained noise blended with a coarse grid
  const colorCanvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = colorCanvas.getContext('2d')!;

  // Base fill
  const bc = new THREE.Color(baseColor);
  const ac = new THREE.Color(altColor);
  const mid = bc.clone().lerp(ac, 0.5);
  ctx.fillStyle = `rgb(${Math.round(mid.r * 255)},${Math.round(mid.g * 255)},${Math.round(mid.b * 255)})`;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Fine noise layer
  fillNoise(ctx, TEX_SIZE, TEX_SIZE, rng, mid.r, 0.06);
  fillNoise(ctx, TEX_SIZE, TEX_SIZE, rng, mid.g, 0.06);
  fillNoise(ctx, TEX_SIZE, TEX_SIZE, rng, mid.b, 0.06);

  // Subtle grid / tile lines (concrete slabs)
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  const gridSize = TEX_SIZE / 4;
  for (let x = 0; x <= TEX_SIZE; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x + rng() * 2 - 1, 0); ctx.lineTo(x + rng() * 2 - 1, TEX_SIZE); ctx.stroke();
  }
  for (let y = 0; y <= TEX_SIZE; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y + rng() * 2 - 1); ctx.lineTo(TEX_SIZE, y + rng() * 2 - 1); ctx.stroke();
  }

  // Coarse aggregate spots
  for (let i = 0; i < 200; i++) {
    const px = rng() * TEX_SIZE;
    const py = rng() * TEX_SIZE;
    const r = 1 + rng() * 3;
    const shade = 0.15 + rng() * 0.2;
    ctx.fillStyle = `rgba(${Math.round(shade * 255)},${Math.round(shade * 255)},${Math.round(shade * 255)},0.3)`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const mapTex = makeCanvasTexture(colorCanvas);
  mapTex.wrapS = THREE.RepeatWrapping;
  mapTex.wrapT = THREE.RepeatWrapping;
  mapTex.repeat.set(4, 4);

  // Normal map: approximate bump from noise
  const normCanvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const nctx = normCanvas.getContext('2d')!;
  nctx.fillStyle = 'rgb(128,128,255)';
  nctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  // Simple height-derived normal via gradient simulation
  const heightData = new Float32Array(TEX_SIZE * TEX_SIZE);
  const hRng = makeRng(seed + 1000);
  for (let i = 0; i < heightData.length; i++) {
    heightData[i] = hRng();
  }
  // Compute normals from height
  const normalData = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
  const scale = 0.8;
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const idx = (y * TEX_SIZE + x) * 4;
      const l = heightData[y * TEX_SIZE + Math.max(0, x - 1)] || 0;
      const r = heightData[y * TEX_SIZE + Math.min(TEX_SIZE - 1, x + 1)] || 0;
      const u = heightData[Math.max(0, y - 1) * TEX_SIZE + x] || 0;
      const d = heightData[Math.min(TEX_SIZE - 1, y + 1) * TEX_SIZE + x] || 0;
      const nx = (l - r) * scale;
      const ny = (u - d) * scale;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normalData[idx] = Math.round((nx / len * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }
  // Use putImageData with a freshly created ImageData (safe Uint8ClampedArray)
  const normImgData = new ImageData(TEX_SIZE, TEX_SIZE);
  normImgData.data.set(normalData);
  nctx.putImageData(normImgData, 0, 0);

  const normalTex = new THREE.CanvasTexture(normCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(4, 4);
  normalTex.colorSpace = THREE.NoColorSpace;

  return { map: mapTex, normalMap: normalTex };
}

// -------------------------------------------------------------------------
// Corrugated metal wall texture with rivet pattern
// -------------------------------------------------------------------------
export function createWallTexture(baseColor: number, seed = 2): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  const c = new THREE.Color(baseColor);

  ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Corrugation lines (vertical ridges)
  const ridgeCount = 16;
  const ridgeW = TEX_SIZE / ridgeCount;
  for (let i = 0; i < ridgeCount; i++) {
    const x = i * ridgeW;
    // Ridge highlight
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rng() * 0.04})`;
    ctx.fillRect(x, 0, ridgeW * 0.35, TEX_SIZE);
    // Ridge shadow
    ctx.fillStyle = `rgba(0,0,0,${0.06 + rng() * 0.06})`;
    ctx.fillRect(x + ridgeW * 0.4, 0, ridgeW * 0.6, TEX_SIZE);
  }

  // Horizontal panel seams
  const seamCount = 4;
  const seamH = TEX_SIZE / seamCount;
  for (let j = 1; j < seamCount; j++) {
    const y = j * seamH + (rng() - 0.5) * 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_SIZE, y);
    ctx.stroke();
  }

  // Rivets at intersections
  const rivetR = 3;
  for (let j = 0; j <= seamCount; j++) {
    const y = j * seamH;
    for (let i = 0; i <= ridgeCount; i++) {
      const x = i * ridgeW;
      const ox = (rng() - 0.5) * ridgeW * 0.3;
      const oy = (rng() - 0.5) * 3;
      // Rivet head
      ctx.fillStyle = `rgba(200,200,210,0.5)`;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, rivetR, 0, Math.PI * 2);
      ctx.fill();
      // Rivet highlight
      ctx.fillStyle = `rgba(255,255,255,0.2)`;
      ctx.beginPath();
      ctx.arc(x + ox - 1, y + oy - 1, rivetR * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Subtle noise
  fillNoise(ctx, TEX_SIZE, TEX_SIZE, rng, c.r, 0.04);
  fillNoise(ctx, TEX_SIZE, TEX_SIZE, rng, c.g, 0.04);
  fillNoise(ctx, TEX_SIZE, TEX_SIZE, rng, c.b, 0.04);

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

// -------------------------------------------------------------------------
// Paint blend texture: glossy ink splatter edges for overlay on surfaces
// Returns a subtle gloss map usable as an overlay
// -------------------------------------------------------------------------
export function createPaintBlendTexture(accentA: number, accentB: number, seed = 3): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;

  // Transparent base
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Splatter dots
  for (let i = 0; i < 60; i++) {
    const px = rng() * TEX_SIZE;
    const py = rng() * TEX_SIZE;
    const r = 2 + rng() * 8;
    const isA = rng() > 0.5;
    const col = isA
      ? `rgba(${(accentA >> 16) & 0xff},${(accentA >> 8) & 0xff},${accentA & 0xff},0.08)`
      : `rgba(${(accentB >> 16) & 0xff},${(accentB >> 8) & 0xff},${accentB & 0xff},0.08)`;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gloss streaks
  for (let i = 0; i < 20; i++) {
    const x1 = rng() * TEX_SIZE;
    const y1 = rng() * TEX_SIZE;
    const len = 10 + rng() * 40;
    const angle = rng() * Math.PI * 2;
    const isA = rng() > 0.5;
    const col = isA
      ? `rgba(${(accentA >> 16) & 0xff},${(accentA >> 8) & 0xff},${accentA & 0xff},0.05)`
      : `rgba(${(accentB >> 16) & 0xff},${(accentB >> 8) & 0xff},${accentB & 0xff},0.05)`;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len);
    ctx.stroke();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

// -------------------------------------------------------------------------
// Map-specific dressing atlas: subtle environmental detail patches
// Each map gets a unique atlas with details like grates, warning stripes, etc.
// -------------------------------------------------------------------------
export interface MapDressingAtlas {
  /** Canvas used as a subtle overlay for ground dressing */
  groundOverlay: THREE.CanvasTexture;
  /** Canvas used as a subtle overlay for wall dressing */
  wallOverlay: THREE.CanvasTexture;
  /** Extra props geometry data (not Three.js objects — caller builds them) */
  propsDesc: MapDressingProps;
}

export interface MapDressingProps {
  /** Drainage grates (x, z positions on ground) */
  grates: Array<{ x: number; z: number; rot?: number }>;
  /** Neon strips for walls / structures */
  neonStrips: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; color: number }>;
  /** Puddle marks on ground */
  puddles: Array<{ x: number; z: number; rx: number; rz: number; color: number; opacity: number }>;
  /** Warning stripe decals */
  warningStrips: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }>;
  /** Ice / frost pattern positions */
  frostPatterns: Array<{ x: number; z: number; scale: number }>;
  /** Hazard tape positions */
  hazardTape: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }>;
  /** Steam source positions */
  steamSources: Array<{ x: number; z: number }>;
}

const EMPTY_PROPS: MapDressingProps = {
  grates: [],
  neonStrips: [],
  puddles: [],
  warningStrips: [],
  frostPatterns: [],
  hazardTape: [],
  steamSources: []
};

// -------------------------------------------------------------------------
// Generate dressing per map type
// -------------------------------------------------------------------------
export function createMapDressing(mapId: string, theme: {
  groundBase: number; groundAlt: number; wallColor: number;
  accentA: number; accentB: number;
}): MapDressingAtlas {
  const rng = makeRng(mapId.charCodeAt(0) * 31 + mapId.charCodeAt(1));

  let props: MapDressingProps = { ...EMPTY_PROPS };
  let groundOverlay = createEmptyOverlay();
  let wallOverlay = createEmptyOverlay();

  if (mapId === 'downtown') {
    // Neon Downtown: LED signs, drainage grates, neon strips, trash cans, puddle marks
    const grates: MapDressingProps['grates'] = [];
    const neonStrips: MapDressingProps['neonStrips'] = [];
    const puddles: MapDressingProps['puddles'] = [];

    // Drainage grates along lanes
    for (let i = -3; i <= 3; i++) {
      grates.push({ x: i * 20, z: 0, rot: Math.PI / 2 });
      grates.push({ x: 0, z: i * 20, rot: 0 });
    }

    // Neon strips on walls (pink on west, cyan on east)
    for (const sz of [-1, 1]) {
      neonStrips.push({ x: -68, y: 1.5, z: sz * 40, sx: 0.1, sy: 3, sz: 8, color: 0xff007f });
      neonStrips.push({ x: 68, y: 1.5, z: sz * 40, sx: 0.1, sy: 3, sz: 8, color: 0x00ffff });
    }

    // Puddle marks in low areas
    for (let i = 0; i < 8; i++) {
      puddles.push({
        x: (rng() - 0.5) * 120,
        z: (rng() - 0.5) * 120,
        rx: 2 + rng() * 4,
        rz: 1 + rng() * 2,
        color: 0x1a1a2e,
        opacity: 0.3 + rng() * 0.2
      });
    }

    props = { ...EMPTY_PROPS, grates, neonStrips, puddles, warningStrips: [], frostPatterns: [], hazardTape: [], steamSources: [] };
    groundOverlay = createDowntownGroundOverlay();
    wallOverlay = createDowntownWallOverlay();
  } else if (mapId === 'cargo_docks') {
    // Cargo Docks: warning stripes, cargo netting, rope details, tire tracks
    const warningStrips: MapDressingProps['warningStrips'] = [];
    const puddles: MapDressingProps['puddles'] = [];

    // Warning stripes on container edges
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        warningStrips.push({ x: sx * 50, y: 2.5, z: sz * 44, sx: 18, sy: 0.1, sz: 0.5 });
        warningStrips.push({ x: sx * 50, y: 2.5, z: sz * 44 + 6, sx: 18, sy: 0.1, sz: 0.5 });
      }
    }

    // Tire tracks on ground
    for (let i = 0; i < 5; i++) {
      puddles.push({
        x: (rng() - 0.5) * 150,
        z: (rng() - 0.5) * 150,
        rx: 3 + rng() * 5,
        rz: 0.5 + rng() * 1,
        color: 0x3a3530,
        opacity: 0.25 + rng() * 0.15
      });
    }

    props = { ...EMPTY_PROPS, warningStrips, puddles, grates: [], neonStrips: [], frostPatterns: [], hazardTape: [], steamSources: [] };
    groundOverlay = createCargoGroundOverlay();
    wallOverlay = createCargoWallOverlay();
  } else if (mapId === 'sky_rink') {
    // Sky Rink: neon edge strips, ice-crack patterns, quarter-pipe logos, safety net mesh
    const neonStrips: MapDressingProps['neonStrips'] = [];
    const puddles: MapDressingProps['puddles'] = [];

    // Neon edge strips along rails
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        neonStrips.push({ x: sx * 55, y: 0.5, z: sz * 55, sx: 0.1, sy: 0.3, sz: 20, color: 0x2ee6a8 });
        neonStrips.push({ x: sx * 55, y: 0.5, z: sz * 55, sx: 20, sy: 0.3, sz: 0.1, color: 0x9d5cff });
      }
    }

    // Ice crack patterns
    for (let i = 0; i < 12; i++) {
      puddles.push({
        x: (rng() - 0.5) * 100,
        z: (rng() - 0.5) * 100,
        rx: 1 + rng() * 3,
        rz: 0.3 + rng() * 0.5,
        color: 0x1a1e3a,
        opacity: 0.2 + rng() * 0.15
      });
    }

    props = { ...EMPTY_PROPS, neonStrips, puddles, grates: [], warningStrips: [], frostPatterns: [], hazardTape: [], steamSources: [] };
    groundOverlay = createSkyRinkGroundOverlay();
    wallOverlay = createSkyRinkWallOverlay();
  } else if (mapId === 'aurora_outpost') {
    // Aurora Outpost: frost patterns, hazard tape, snow accumulation, steam
    const frostPatterns: MapDressingProps['frostPatterns'] = [];
    const hazardTape: MapDressingProps['hazardTape'] = [];
    const steamSources: MapDressingProps['steamSources'] = [];

    // Frost patterns on ground
    for (let i = 0; i < 15; i++) {
      frostPatterns.push({
        x: (rng() - 0.5) * 140,
        z: (rng() - 0.5) * 140,
        scale: 0.5 + rng() * 1.5
      });
    }

    // Hazard tape on railings
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        hazardTape.push({ x: sx * 75, y: 1.0, z: 0, sx: 0.15, sy: 0.15, sz: 30 });
        hazardTape.push({ x: 0, y: 1.0, z: sz * 75, sx: 30, sy: 0.15, sz: 0.15 });
      }
    }

    // Steam sources near warm surfaces
    for (let i = 0; i < 4; i++) {
      steamSources.push({
        x: (rng() - 0.5) * 80,
        z: (rng() - 0.5) * 80
      });
    }

    props = { ...EMPTY_PROPS, frostPatterns, hazardTape, steamSources, grates: [], neonStrips: [], puddles: [], warningStrips: [] };
    groundOverlay = createAuroraGroundOverlay();
    wallOverlay = createAuroraWallOverlay();
  }

  return { groundOverlay, wallOverlay, propsDesc: props };
}

// -------------------------------------------------------------------------
// Individual map dressing overlay generators
// -------------------------------------------------------------------------
function createEmptyOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(1, 1);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1, 1);
  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createDowntownGroundOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Drainage grate pattern
  const grateW = TEX_SIZE / 8;
  for (let i = 0; i < 8; i++) {
    const x = i * grateW + grateW * 0.1;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let j = 0; j < 6; j++) {
      const ly = j * (grateW / 6) + grateW / 12;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + grateW * 0.8, ly);
      ctx.stroke();
    }
  }

  // Oil puddle reflections
  for (let i = 0; i < 5; i++) {
    const px = (Math.sin(i * 3.7) * 0.5 + 0.5) * TEX_SIZE;
    const py = (Math.cos(i * 2.3) * 0.5 + 0.5) * TEX_SIZE;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, 20 + i * 5) ?? ctx.createLinearGradient(0, 0, 0, 0);
    grad.addColorStop(0, 'rgba(20,20,40,0.15)');
    grad.addColorStop(1, 'rgba(20,20,40,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(px, py, 30 + i * 8, 15 + i * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDowntownWallOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Graffiti splatter marks
  const rng = makeRng(42);
  for (let i = 0; i < 12; i++) {
    const px = rng() * TEX_SIZE;
    const py = rng() * TEX_SIZE;
    const r = 5 + rng() * 15;
    const colors = ['rgba(255,0,127,0.08)', 'rgba(0,255,255,0.08)', 'rgba(157,92,255,0.08)'];
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)] ?? colors[0]!;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pipe runs
  ctx.strokeStyle = 'rgba(80,80,100,0.3)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    const y = TEX_SIZE * (0.2 + i * 0.3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_SIZE, y + (rng() - 0.5) * 20);
    ctx.stroke();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

function createCargoGroundOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Tire tracks
  for (let i = 0; i < 4; i++) {
    const baseY = TEX_SIZE * (0.15 + i * 0.25);
    ctx.strokeStyle = 'rgba(40,35,30,0.2)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= TEX_SIZE; x += 20) {
      ctx.lineTo(x, baseY + Math.sin(x * 0.02) * 5);
    }
    ctx.stroke();
    // Second parallel track
    ctx.beginPath();
    ctx.moveTo(0, baseY + 12);
    for (let x = 0; x <= TEX_SIZE; x += 20) {
      ctx.lineTo(x, baseY + 12 + Math.sin(x * 0.02) * 5);
    }
    ctx.stroke();
  }

  // Oil stains
  for (let i = 0; i < 6; i++) {
    const cargoRng = rngCargo(42 + i);
    const px = cargoRng() * TEX_SIZE;
    const py = rngCargo(50 + i)() * TEX_SIZE;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, 15 + rngCargo(60 + i)() * 20);
    grad.addColorStop(0, 'rgba(30,25,20,0.2)');
    grad.addColorStop(1, 'rgba(30,25,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, 20 + rngCargo(60 + i)() * 15, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function rngCargo(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createCargoWallOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Warning stripe decals
  const rng = makeRng(77);
  for (let i = 0; i < 8; i++) {
    const x = i * (TEX_SIZE / 8);
    for (let j = 0; j < 6; j++) {
      const y = j * (TEX_SIZE / 6);
      ctx.fillStyle = (i + j) % 2 === 0 ? 'rgba(255,166,41,0.08)' : 'rgba(30,30,30,0.05)';
      ctx.fillRect(x + 2, y + 2, TEX_SIZE / 8 - 4, TEX_SIZE / 6 - 4);
    }
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

function createSkyRinkGroundOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Ice crack patterns
  const rng = makeRng(99);
  for (let i = 0; i < 20; i++) {
    const sx = rng() * TEX_SIZE;
    const sy = rng() * TEX_SIZE;
    ctx.strokeStyle = 'rgba(100,120,180,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let cx = sx, cy = sy;
    for (let j = 0; j < 5; j++) {
      cx += (rng() - 0.5) * 30;
      cy += (rng() - 0.5) * 30;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Neon reflection pools
  for (let i = 0; i < 4; i++) {
    const px = TEX_SIZE * (0.2 + i * 0.2);
    const py = TEX_SIZE * (0.3 + rng() * 0.4);
    const grad = ctx.createRadialGradient(px, py, 0, px, py, 25);
    grad.addColorStop(0, 'rgba(46,230,168,0.08)');
    grad.addColorStop(1, 'rgba(46,230,168,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, 25, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function createSkyRinkWallOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Safety net mesh pattern
  const rng = makeRng(101);
  ctx.strokeStyle = 'rgba(100,120,200,0.08)';
  ctx.lineWidth = 1;
  const spacing = 20;
  for (let x = 0; x < TEX_SIZE; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TEX_SIZE); ctx.stroke();
  }
  for (let y = 0; y < TEX_SIZE; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX_SIZE, y); ctx.stroke();
  }
  // Diagonal cross-hatch for net effect
  for (let i = -TEX_SIZE; i < TEX_SIZE * 2; i += spacing * 2) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + TEX_SIZE, TEX_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + TEX_SIZE, 0); ctx.lineTo(i, TEX_SIZE); ctx.stroke();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

function createAuroraGroundOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Frost / snow patterns
  const rng = makeRng(120);
  for (let i = 0; i < 40; i++) {
    const px = rng() * TEX_SIZE;
    const py = rng() * TEX_SIZE;
    const r = 3 + rng() * 12;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, 'rgba(200,220,240,0.12)');
    grad.addColorStop(0.6, 'rgba(180,200,220,0.06)');
    grad.addColorStop(1, 'rgba(180,200,220,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Snow drift lines
  for (let i = 0; i < 8; i++) {
    const y = rng() * TEX_SIZE;
    ctx.strokeStyle = 'rgba(200,220,240,0.06)';
    ctx.lineWidth = 2 + rng() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= TEX_SIZE; x += 10) {
      ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 8);
    }
    ctx.stroke();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function createAuroraWallOverlay(): THREE.CanvasTexture {
  const canvas = makeCanvas(TEX_SIZE, TEX_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Frost accumulation on ledges
  const rng = makeRng(130);
  for (let i = 0; i < 6; i++) {
    const y = TEX_SIZE * (0.1 + i * 0.15);
    const grad = ctx.createLinearGradient(0, y, 0, y + 15);
    grad.addColorStop(0, 'rgba(220,235,255,0.15)');
    grad.addColorStop(1, 'rgba(220,235,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, TEX_SIZE, 15);
  }

  // Panel seams
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 2;
  for (let j = 0; j < 4; j++) {
    const y = TEX_SIZE * (j + 1) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX_SIZE, y); ctx.stroke();
  }

  const tex = makeCanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

// -------------------------------------------------------------------------
// Material factories using the generated textures
// -------------------------------------------------------------------------
export function createTexturedGroundMaterial(
  groundTex: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture },
  overlayTex: THREE.CanvasTexture,
  baseColor: number,
  roughness = 0.8,
  metalness = 0.1
): THREE.MeshStandardMaterial {
  const color = new THREE.Color(baseColor);
  return new THREE.MeshStandardMaterial({
    map: groundTex.map,
    normalMap: groundTex.normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    color,
    roughness,
    metalness,
    transparent: true,
    opacity: 0.92,
    depthWrite: true
  });
}

export function createTexturedWallMaterial(
  wallTex: THREE.CanvasTexture,
  overlayTex: THREE.CanvasTexture,
  baseColor: number,
  roughness = 0.7,
  metalness = 0.2
): THREE.MeshStandardMaterial {
  const color = new THREE.Color(baseColor);
  return new THREE.MeshStandardMaterial({
    map: wallTex,
    color,
    roughness,
    metalness,
    transparent: true,
    opacity: 0.95,
    depthWrite: true
  });
}

export function createPuddleMaterial(color: number, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.1,
    metalness: 0.8,
    transparent: true,
    opacity,
    depthWrite: false
  });
}
