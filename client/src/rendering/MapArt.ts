import * as THREE from 'three';
import type { MapDef, MapId } from '@ink/shared';

/**
 * Procedural art kit for the arenas.
 *
 * Everything here is generated on a canvas (no image files), cached for the
 * lifetime of the page, and consumed through `createWorldMaterial`, a
 * triplanar world-space material. World-space mapping means every box,
 * ramp and floor patch gets the same texel density regardless of its size, which is what lets one shared InstancedMesh carry hundreds of obstacles
 * without their textures stretching.
 */

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
type Rng = () => number;

function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const rgba = (n: number, a: number): string =>
  `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;

/** Per-pixel brightness grain, applied in place on the canvas. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Runs `draw` at (x, y) and at every wrapped copy so the canvas tiles seamlessly. */
function wrapped(w: number, h: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
      draw(px, py);
    }
  }
}

function blobs(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: Rng,
  count: number,
  rMin: number,
  rMax: number,
  light: number,
  dark: number
): void {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = rMin + rng() * (rMax - rMin);
    const isLight = rng() > 0.5;
    const a = (isLight ? light : dark) * (0.4 + rng() * 0.6);
    wrapped(w, h, x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, isLight ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function crack(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, alpha: number): void {
  let x = rng() * w;
  let y = rng() * h;
  let a = rng() * Math.PI * 2;
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
  ctx.lineWidth = 1 + rng() * 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  const n = 8 + Math.floor(rng() * 12);
  for (let i = 0; i < n; i++) {
    a += (rng() - 0.5) * 1.1;
    x += Math.cos(a) * (8 + rng() * 14);
    y += Math.sin(a) * (8 + rng() * 14);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const texCache = new Map<string, THREE.CanvasTexture>();

function finish(canvas: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat !== false) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function cached(key: string, build: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = build();
    texCache.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Surface textures (tileable)
// ---------------------------------------------------------------------------
const N = 512;

/** Neutral grey grain used under the hand-painted floor layouts. */
export function texGroundDetail(): THREE.CanvasTexture {
  return cached('groundDetail', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(11);
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(0, 0, N, N);
    blobs(ctx, N, N, rng, 60, 30, 120, 0.1, 0.12);
    for (let i = 0; i < 700; i++) {
      const v = 60 + rng() * 120;
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(rng() * N, rng() * N, 1 + rng() * 2.5, 1 + rng() * 2.5);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) crack(ctx, N, N, rng, 0.2);
    grain(ctx, N, N, rng, 38);
    return finish(c);
  });
}

export function texConcrete(): THREE.CanvasTexture {
  return cached('concrete', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(21);
    ctx.fillStyle = '#b4b2ae';
    ctx.fillRect(0, 0, N, N);
    blobs(ctx, N, N, rng, 70, 30, 130, 0.1, 0.14);
    for (let i = 0; i < 900; i++) {
      const v = 120 + rng() * 100;
      ctx.fillStyle = `rgba(${v},${v},${v - 4},0.45)`;
      ctx.fillRect(rng() * N, rng() * N, 1 + rng() * 2, 1 + rng() * 2);
    }
    // slab seams every half tile
    ctx.strokeStyle = 'rgba(40,38,36,0.45)';
    ctx.lineWidth = 3;
    for (const p of [0, N / 2]) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    for (const p of [4, N / 2 + 4]) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, N); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(N, p); ctx.stroke();
    }
    for (let i = 0; i < 3; i++) crack(ctx, N, N, rng, 0.3);
    // formwork tie-holes
    ctx.fillStyle = 'rgba(30,30,30,0.5)';
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.arc(64 + i * 128, 64 + j * 128, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    grain(ctx, N, N, rng, 22);
    return finish(c);
  });
}

export function texAsphalt(): THREE.CanvasTexture {
  return cached('asphalt', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(31);
    ctx.fillStyle = '#6d6e74';
    ctx.fillRect(0, 0, N, N);
    blobs(ctx, N, N, rng, 80, 20, 100, 0.08, 0.16);
    for (let i = 0; i < 2200; i++) {
      const v = 70 + rng() * 120;
      ctx.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
      ctx.fillRect(rng() * N, rng() * N, 1 + rng() * 2.5, 1 + rng() * 2.5);
    }
    for (let i = 0; i < 6; i++) crack(ctx, N, N, rng, 0.35);
    grain(ctx, N, N, rng, 30);
    return finish(c);
  });
}

export function texBrick(): THREE.CanvasTexture {
  return cached('brick', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(41);
    ctx.fillStyle = '#3a3330';
    ctx.fillRect(0, 0, N, N);
    const rows = 16;
    const bh = N / rows;
    const bw = N / 6;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 === 0 ? 0 : bw / 2;
      for (let i = -1; i < 7; i++) {
        const x = i * bw + off;
        const base = 150 + rng() * 60;
        ctx.fillStyle = `rgb(${base},${base * (0.55 + rng() * 0.12)},${base * (0.45 + rng() * 0.1)})`;
        ctx.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(x + 2, r * bh + 2, bw - 4, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + 2, r * bh + bh - 5, bw - 4, 3);
      }
    }
    blobs(ctx, N, N, rng, 30, 30, 110, 0.08, 0.18);
    grain(ctx, N, N, rng, 28);
    return finish(c);
  });
}

/** Window facade. `lit` selects the emissive companion (only glowing windows). */
export function texFacade(lit: boolean): THREE.CanvasTexture {
  return cached(lit ? 'facadeLit' : 'facade', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(51);
    const winRng = makeRng(77); // identical window pattern for both variants
    if (lit) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, N, N);
    } else {
      ctx.fillStyle = '#9a98a4';
      ctx.fillRect(0, 0, N, N);
      blobs(ctx, N, N, rng, 40, 30, 120, 0.1, 0.16);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 6; i++) ctx.fillRect(0, (i + 1) * (N / 6) - 6, N, 5);
    }
    const cols = 4;
    const floors = 4; // tile covers 6 world units -> 1.5-unit floors
    const cw = N / cols;
    const fh = N / floors;
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < cols; i++) {
        const x = i * cw + cw * 0.14;
        const y = f * fh + fh * 0.16;
        const w = cw * 0.72;
        const h = fh * 0.62;
        const on = winRng() > 0.58;
        const warm = winRng() > 0.35;
        const tint = on ? (warm ? [255, 214, 140] : [150, 220, 255]) : [30, 44, 66];
        if (lit) {
          if (!on) continue;
          ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
          ctx.fillRect(x, y, w, h);
        } else {
          const g = ctx.createLinearGradient(x, y, x + w, y + h);
          g.addColorStop(0, `rgb(${tint[0]},${tint[1]},${tint[2]})`);
          g.addColorStop(1, on ? `rgb(${tint[0]! * 0.8},${tint[1]! * 0.8},${tint[2]! * 0.8})` : '#10182a');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = 'rgba(20,20,26,0.9)';
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y, w, h);
          ctx.fillStyle = 'rgba(210,210,220,0.9)';
          ctx.fillRect(x - 3, y + h, w + 6, 5); // sill
          ctx.strokeStyle = 'rgba(20,20,26,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
        }
      }
    }
    if (!lit) grain(ctx, N, N, rng, 18);
    return finish(c);
  });
}

export function texContainer(): THREE.CanvasTexture {
  return cached('container', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(61);
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(0, 0, N, N);
    const ridges = 20;
    const rw = N / ridges;
    for (let i = 0; i < ridges; i++) {
      const g = ctx.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.45, 'rgba(255,255,255,0)');
      g.addColorStop(0.55, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = g;
      ctx.fillRect(i * rw, 0, rw, N);
    }
    // top and bottom rails
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, N, 20);
    ctx.fillRect(0, N - 20, N, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 20, N, 3);
    // rust runs + dents
    for (let i = 0; i < 28; i++) {
      const x = rng() * N;
      const len = 40 + rng() * 220;
      const g = ctx.createLinearGradient(0, N - len, 0, N);
      g.addColorStop(0, 'rgba(120,60,20,0)');
      g.addColorStop(1, `rgba(120,60,20,${0.2 + rng() * 0.25})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, N - len, 3 + rng() * 8, len);
    }
    blobs(ctx, N, N, rng, 30, 30, 90, 0.08, 0.16);
    // stencil marks
    ctx.fillStyle = 'rgba(30,30,30,0.5)';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('INK 4821', 60, 120);
    ctx.fillText('MAX 30480KG', 300, 410);
    grain(ctx, N, N, rng, 24);
    return finish(c);
  });
}

export function texMetalPlate(): THREE.CanvasTexture {
  return cached('metalPlate', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(71);
    ctx.fillStyle = '#8c9098';
    ctx.fillRect(0, 0, N, N);
    const cell = 32;
    for (let y = 0; y < N; y += cell) {
      for (let x = 0; x < N; x += cell) {
        const flip = ((x + y) / cell) % 2 === 0;
        ctx.save();
        ctx.translate(x + cell / 2, y + cell / 2);
        ctx.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
        const g = ctx.createLinearGradient(-10, 0, 10, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(-9, -3, 18, 6);
        ctx.restore();
      }
    }
    blobs(ctx, N, N, rng, 40, 30, 120, 0.1, 0.18);
    grain(ctx, N, N, rng, 22);
    return finish(c);
  });
}

export function texGrate(): THREE.CanvasTexture {
  return cached('grate', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(81);
    ctx.fillStyle = '#16181e';
    ctx.fillRect(0, 0, N, N);
    const cell = 32;
    for (let y = 0; y < N; y += cell) {
      for (let x = 0; x < N; x += cell) {
        ctx.fillStyle = '#6a707c';
        ctx.fillRect(x, y, cell, 5);
        ctx.fillRect(x, y, 5, cell);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y, cell, 1.5);
      }
    }
    grain(ctx, N, N, rng, 20);
    return finish(c);
  });
}

export function texCrate(): THREE.CanvasTexture {
  return cached('crate', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(91);
    ctx.fillStyle = '#a07a48';
    ctx.fillRect(0, 0, N, N);
    const planks = 8;
    const ph = N / planks;
    for (let p = 0; p < planks; p++) {
      const shade = 0.82 + rng() * 0.3;
      ctx.fillStyle = `rgb(${160 * shade},${118 * shade},${70 * shade})`;
      ctx.fillRect(0, p * ph + 1, N, ph - 2);
      ctx.strokeStyle = 'rgba(60,35,15,0.28)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 9; g++) {
        const y = p * ph + 4 + rng() * (ph - 8);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(N * 0.3, y + (rng() - 0.5) * 6, N * 0.6, y + (rng() - 0.5) * 6, N, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, p * ph, N, 2);
    }
    // frame + diagonal brace
    ctx.strokeStyle = '#5b3d1e';
    ctx.lineWidth = 26;
    ctx.strokeRect(13, 13, N - 26, N - 26);
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(20, 20);
    ctx.lineTo(N - 20, N - 20);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,160,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(5, 5, N - 10, N - 10);
    ctx.fillStyle = '#2a2a2a';
    for (const [x, y] of [[26, 26], [N - 26, 26], [26, N - 26], [N - 26, N - 26]] as const) {
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }
    blobs(ctx, N, N, rng, 20, 30, 90, 0.06, 0.18);
    grain(ctx, N, N, rng, 26);
    return finish(c);
  });
}

export function texPlanks(): THREE.CanvasTexture {
  return cached('planks', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(101);
    const n = 8;
    const pw = N / n;
    for (let p = 0; p < n; p++) {
      const shade = 0.7 + rng() * 0.35;
      ctx.fillStyle = `rgb(${130 * shade},${98 * shade},${64 * shade})`;
      ctx.fillRect(p * pw, 0, pw, N);
      ctx.strokeStyle = 'rgba(50,30,12,0.3)';
      for (let g = 0; g < 10; g++) {
        const x = p * pw + 3 + rng() * (pw - 6);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rng() - 0.5) * 8, N); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(p * pw, 0, 2.5, N);
      // butt joint
      const j = rng() * N;
      ctx.fillRect(p * pw, j, pw, 2.5);
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath(); ctx.arc(p * pw + pw / 2, j + 12, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    blobs(ctx, N, N, rng, 30, 30, 100, 0.06, 0.2);
    grain(ctx, N, N, rng, 24);
    return finish(c);
  });
}

export function texSnow(): THREE.CanvasTexture {
  return cached('snow', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(111);
    ctx.fillStyle = '#e4eef6';
    ctx.fillRect(0, 0, N, N);
    blobs(ctx, N, N, rng, 90, 30, 140, 0.18, 0.1);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 + rng() * 0.5})`;
      ctx.fillRect(rng() * N, rng() * N, 1.5, 1.5);
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(150,180,210,${0.2 + rng() * 0.2})`;
      ctx.fillRect(rng() * N, rng() * N, 2, 2);
    }
    grain(ctx, N, N, rng, 14);
    return finish(c);
  });
}

export function texIce(): THREE.CanvasTexture {
  return cached('ice', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(121);
    const g = ctx.createLinearGradient(0, 0, N, N);
    g.addColorStop(0, '#9fd0ee');
    g.addColorStop(1, '#6aa6d4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
    blobs(ctx, N, N, rng, 60, 40, 150, 0.2, 0.1);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      let x = rng() * N, y = rng() * N;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rng() - 0.5) * 120;
        y += (rng() - 0.5) * 120;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    grain(ctx, N, N, rng, 14);
    return finish(c);
  });
}

/** Sci-fi wall panels with seams, vents and status strips. */
export function texPanel(): THREE.CanvasTexture {
  return cached('panel', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(131);
    ctx.fillStyle = '#c4ccd4';
    ctx.fillRect(0, 0, N, N);
    const cols = 4;
    const cell = N / cols;
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * cell;
        const y = j * cell;
        const s = 0.9 + rng() * 0.12;
        ctx.fillStyle = `rgb(${196 * s},${204 * s},${212 * s})`;
        ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 6, y + 6, cell - 12, cell - 12);
        const kind = rng();
        if (kind < 0.25) {
          ctx.fillStyle = 'rgba(30,38,50,0.8)';
          for (let v = 0; v < 6; v++) ctx.fillRect(x + 20, y + 24 + v * 14, cell - 40, 6);
        } else if (kind < 0.4) {
          ctx.fillStyle = 'rgba(60,200,170,0.85)';
          ctx.fillRect(x + 20, y + cell - 36, cell - 40, 8);
        } else if (kind < 0.5) {
          ctx.fillStyle = 'rgba(30,38,50,0.7)';
          ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, 20, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(40,40,40,0.6)';
        for (const [rx, ry] of [[12, 12], [cell - 12, 12], [12, cell - 12], [cell - 12, cell - 12]] as const) {
          ctx.beginPath(); ctx.arc(x + rx, y + ry, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    blobs(ctx, N, N, rng, 30, 30, 110, 0.08, 0.16);
    grain(ctx, N, N, rng, 18);
    return finish(c);
  });
}

export function texRoof(): THREE.CanvasTexture {
  return cached('roof', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(141);
    ctx.fillStyle = '#5c5d62';
    ctx.fillRect(0, 0, N, N);
    for (let i = 0; i < 3000; i++) {
      const v = 60 + rng() * 110;
      ctx.fillStyle = `rgba(${v},${v},${v},0.7)`;
      ctx.fillRect(rng() * N, rng() * N, 1 + rng() * 3, 1 + rng() * 3);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * (N / 4), 0); ctx.lineTo(i * (N / 4), N); ctx.stroke();
    }
    blobs(ctx, N, N, rng, 40, 30, 110, 0.1, 0.2);
    grain(ctx, N, N, rng, 24);
    return finish(c);
  });
}

/** Safety-yellow hazard stripes. */
export function texHazard(): THREE.CanvasTexture {
  return cached('hazard', () => {
    const [c, ctx] = makeCanvas(256, 256);
    const rng = makeRng(151);
    ctx.fillStyle = '#e8b422';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#1c1c20';
    for (let i = -4; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 64, 0);
      ctx.lineTo(i * 64 + 32, 0);
      ctx.lineTo(i * 64 + 32 + 256, 256);
      ctx.lineTo(i * 64 + 256, 256);
      ctx.closePath();
      ctx.fill();
    }
    grain(ctx, 256, 256, rng, 30);
    return finish(c);
  });
}

/** Rubber skate-park tile with a subtle neon seam. */
export function texTile(): THREE.CanvasTexture {
  return cached('tile', () => {
    const [c, ctx] = makeCanvas(N, N);
    const rng = makeRng(161);
    ctx.fillStyle = '#b8bce0';
    ctx.fillRect(0, 0, N, N);
    const cell = N / 4;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const s = 0.92 + rng() * 0.14;
        ctx.fillStyle = `rgb(${184 * s},${188 * s},${224 * s})`;
        ctx.fillRect(i * cell + 3, j * cell + 3, cell - 6, cell - 6);
      }
    }
    ctx.strokeStyle = 'rgba(20,24,70,0.6)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, N); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(N, i * cell); ctx.stroke();
    }
    blobs(ctx, N, N, rng, 40, 30, 120, 0.08, 0.14);
    grain(ctx, N, N, rng, 20);
    return finish(c);
  });
}

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------
export function makeSignTexture(text: string, color: number, sub?: string): THREE.CanvasTexture {
  return cached(`sign:${text}:${color}:${sub ?? ''}`, () => {
    const [c, ctx] = makeCanvas(512, 192);
    ctx.fillStyle = '#0a0b12';
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = hex(color);
    ctx.lineWidth = 8;
    ctx.shadowColor = hex(color);
    ctx.shadowBlur = 18;
    ctx.strokeRect(10, 10, 492, 172);
    ctx.fillStyle = hex(color);
    ctx.font = 'bold 92px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, sub ? 82 : 96);
    if (sub) {
      ctx.font = 'bold 34px Arial, sans-serif';
      ctx.fillText(sub, 256, 150);
    }
    const tex = finish(c, { repeat: false });
    return tex;
  });
}

// ---------------------------------------------------------------------------
// World (triplanar) material
// ---------------------------------------------------------------------------
export interface WorldMaterialOptions {
  side: THREE.Texture;
  top?: THREE.Texture;
  /** Tiles per world unit: [horizontal, vertical] for vertical faces. */
  sideScale?: [number, number];
  /** Tiles per world unit for up-facing faces. */
  topScale?: number;
  color?: number;
  roughness?: number;
  metalness?: number;
  /** Screen-space bump strength derived from the albedo luminance. */
  bump?: number;
  /** Emissive texture for vertical faces (e.g. lit windows). */
  glow?: THREE.Texture;
  glowColor?: number;
  glowIntensity?: number;
  /** Hand-painted layout covering the full arena (floor only). */
  macro?: THREE.Texture;
  macroSize?: number;
  /** Paint-engine ink canvas; up-facing surfaces show team ink from it. */
  ink?: THREE.Texture;
  inkMapSize?: number;
  /** Darken vertical faces toward the ground (fake ambient occlusion). */
  groundShade?: boolean;
  side2?: boolean;
}

export interface WorldMaterial extends THREE.MeshStandardMaterial {
  userData: { glow?: { value: number }; glowBase?: number };
}

const PINK = new THREE.Color(0xff007f);
const CYAN = new THREE.Color(0x00ffff);

let nextWorldMatId = 1;

export function createWorldMaterial(o: WorldMaterialOptions): WorldMaterial {
  const matId = nextWorldMatId++;
  const mat = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0.05,
    side: o.side2 ? THREE.DoubleSide : THREE.FrontSide
  }) as WorldMaterial;

  const hasMacro = !!o.macro;
  const hasInk = !!o.ink;
  const hasGlow = !!o.glow;
  const glowUniform = { value: o.glowIntensity ?? 1 };
  mat.userData.glow = glowUniform;
  mat.userData.glowBase = o.glowIntensity ?? 1;

  mat.onBeforeCompile = (shader): void => {
    shader.uniforms.uSide = { value: o.side };
    shader.uniforms.uTop = { value: o.top ?? o.side };
    shader.uniforms.uSideScale = { value: new THREE.Vector2(...(o.sideScale ?? [0.25, 0.25])) };
    shader.uniforms.uTopScale = { value: o.topScale ?? 0.25 };
    shader.uniforms.uBump = { value: o.bump ?? 0 };
    shader.uniforms.uPink = { value: PINK };
    shader.uniforms.uCyan = { value: CYAN };
    if (hasMacro) {
      shader.uniforms.uMacro = { value: o.macro };
      shader.uniforms.uMacroSize = { value: o.macroSize ?? 100 };
    }
    if (hasInk) {
      shader.uniforms.uInk = { value: o.ink };
      shader.uniforms.uInkSize = { value: o.inkMapSize ?? 100 };
    }
    if (hasGlow) {
      shader.uniforms.uGlow = { value: o.glow };
      shader.uniforms.uGlowColor = { value: new THREE.Color(o.glowColor ?? 0xffffff) };
      shader.uniforms.uGlowI = glowUniform;
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp4 = vec4( transformed, 1.0 );
        vec3 wn3 = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn3 = mat3( instanceMatrix ) * wn3;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        vWNrm = normalize( mat3( modelMatrix ) * wn3 );`
      );

    const frag = `
      varying vec3 vWPos;
      varying vec3 vWNrm;
      uniform sampler2D uSide;
      uniform sampler2D uTop;
      uniform vec2 uSideScale;
      uniform float uTopScale;
      uniform float uBump;
      uniform vec3 uPink;
      uniform vec3 uCyan;
      ${hasMacro ? 'uniform sampler2D uMacro; uniform float uMacroSize;' : ''}
      ${hasInk ? 'uniform sampler2D uInk; uniform float uInkSize;' : ''}
      ${hasGlow ? 'uniform sampler2D uGlow; uniform vec3 uGlowColor; uniform float uGlowI;' : ''}
      float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float wNoise( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( wHash( i ), wHash( i + vec2( 1.0, 0.0 ) ), f.x ),
                    mix( wHash( i + vec2( 0.0, 1.0 ) ), wHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
      }
      vec3 wPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy ) {
        vec3 sx = normalize( dFdx( surfPos ) );
        vec3 sy = normalize( dFdy( surfPos ) );
        vec3 r1 = cross( sy, surfNorm );
        vec3 r2 = cross( surfNorm, sx );
        float det = dot( sx, r1 );
        det *= ( float( gl_FrontFacing ) * 2.0 - 1.0 );
        vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
        return normalize( abs( det ) * surfNorm - grad );
      }
    `;

    const mapChunk = `
      vec3 wN = normalize( vWNrm );
      float topF = smoothstep( 0.38, 0.62, wN.y );
      vec2 uvS = ( abs( wN.x ) > abs( wN.z ) ) ? vWPos.zy : vWPos.xy;
      vec4 tS = texture2D( uSide, uvS * uSideScale );
      vec4 tT = texture2D( uTop, vWPos.xz * uTopScale );
      vec4 texel = mix( tS, tT, topF );
      float wMacroVar = 0.86 + 0.28 * wNoise( vWPos.xz * 0.05 );
      ${
        hasMacro
          ? `
      vec2 mUv = ( vWPos.xz + uMacroSize * 0.5 ) / uMacroSize;
      vec4 mc = texture2D( uMacro, mUv );
      float microGrain = dot( texel.rgb, vec3( 0.3333 ) );
      texel.rgb = mc.rgb * ( 0.72 + microGrain * 0.56 );`
          : ''
      }
      texel.rgb *= mix( 1.0, wMacroVar, topF );
      ${o.groundShade === false ? '' : `
      // Vertical height shading & contact ambient occlusion cues:
      // Darkens sunken underpasses/ground contact, highlights elevated catwalks and towers
      float vertAO = mix( 0.76, 1.04, smoothstep( 0.0, 6.0, vWPos.y ) );
      texel.rgb *= mix( vertAO, mix( 0.94, 1.06, smoothstep( 0.0, 7.0, vWPos.y ) ), topF );
      `}
      float bumpH = dot( texel.rgb, vec3( 0.3333 ) );
      diffuseColor.rgb *= texel.rgb;
      float inkMask = 0.0;
      vec3 inkAlbedo = vec3( 0.0 );
      ${
        hasInk
          ? `
      vec2 iUv = ( vWPos.xz + uInkSize * 0.5 ) / uInkSize;
      vec3 ip = texture2D( uInk, iUv ).rgb;
      float imx = max( ip.r, max( ip.g, ip.b ) );
      float imn = min( ip.r, min( ip.g, ip.b ) );
      float isat = ( imx - imn ) / max( imx, 0.001 );
      float inside = step( 0.0, iUv.x ) * step( iUv.x, 1.0 ) * step( 0.0, iUv.y ) * step( iUv.y, 1.0 );
      inkMask = smoothstep( 0.22, 0.55, isat ) * topF * inside;
      inkAlbedo = ip * clamp( 0.7 + bumpH * 0.9, 0.8, 1.15 );`
          : ''
      }
    `;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${frag}`)
      .replace('#include <map_fragment>', mapChunk)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix( diffuseColor.rgb, inkAlbedo, inkMask );`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         roughnessFactor = mix( roughnessFactor, 0.26, inkMask );`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         if ( uBump > 0.0 ) {
           float bFade = 1.0 / ( 1.0 + length( vViewPosition ) * 0.03 );
           vec2 dH = vec2( dFdx( bumpH ), dFdy( bumpH ) ) * uBump * bFade;
           normal = wPerturb( - vViewPosition, normal, dH );
         }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += inkAlbedo * 0.1 * inkMask;
         ${
           hasGlow
             ? 'totalEmissiveRadiance += texture2D( uGlow, uvS * uSideScale ).rgb * uGlowColor * uGlowI * ( 1.0 - topF );'
             : ''
         }`
      );
  };

  mat.customProgramCacheKey = (): string =>
    `world:${matId}:${hasMacro ? 1 : 0}${hasInk ? 1 : 0}${hasGlow ? 1 : 0}${o.groundShade === false ? 0 : 1}`;
  return mat;
}

// ---------------------------------------------------------------------------
// Hand-painted floor layouts (one 2048px canvas per map)
// ---------------------------------------------------------------------------
const FLOOR_RES = 2048;
const floorCache = new Map<MapId, THREE.CanvasTexture>();

export function getFloorTexture(def: MapDef): THREE.CanvasTexture {
  let t = floorCache.get(def.id);
  if (!t) {
    t = paintFloor(def);
    floorCache.set(def.id, t);
  }
  return t;
}

function paintFloor(def: MapDef): THREE.CanvasTexture {
  const S = FLOOR_RES;
  const [c, ctx] = makeCanvas(S, S);
  const rng = makeRng(def.size * 7 + def.id.length);
  const size = def.size;
  const half = size / 2;
  const k = S / size;
  const X = (x: number): number => (x + half) * k;
  const Z = (z: number): number => (half - z) * k;
  const rect = (x: number, z: number, w: number, d: number): void => {
    ctx.fillRect(X(x) - (w * k) / 2, Z(z) - (d * k) / 2, w * k, d * k);
  };
  const strokeRect = (x: number, z: number, w: number, d: number): void => {
    ctx.strokeRect(X(x) - (w * k) / 2, Z(z) - (d * k) / 2, w * k, d * k);
  };
  const line = (x1: number, z1: number, x2: number, z2: number): void => {
    ctx.beginPath();
    ctx.moveTo(X(x1), Z(z1));
    ctx.lineTo(X(x2), Z(z2));
    ctx.stroke();
  };
  const circle = (x: number, z: number, r: number, fill: boolean): void => {
    ctx.beginPath();
    ctx.arc(X(x), Z(z), r * k, 0, Math.PI * 2);
    if (fill) ctx.fill();
    else ctx.stroke();
  };
  const glow = (x: number, z: number, r: number, color: number, a: number): void => {
    const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * k);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(x), Z(z), r * k, 0, Math.PI * 2);
    ctx.fill();
  };
  const solids = def.obstacles.filter((o) => !o.id.startsWith('wall_'));
  const lots = (pad: number, color: string): void => {
    ctx.fillStyle = color;
    for (const o of solids) {
      if (o.position.y - o.size.y / 2 > 0.1) continue; // decks / floating slabs have no footprint
      rect(o.position.x, o.position.z, o.size.x + pad * 2, o.size.z + pad * 2);
    }
  };
  const teamPad = (sx: number, color: number, dir: number): void => {
    glow(sx, 0, 17, color, 0.3);
    ctx.fillStyle = rgba(color, 0.4);
    circle(sx, 0, 8.4, true);
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 0.5 * k;
    circle(sx, 0, 8.4, false);
    circle(sx, 0, 6.6, false);
    ctx.lineWidth = 0.28 * k;
    for (let i = 0; i < 3; i++) {
      const o = 11 + i * 3;
      ctx.beginPath();
      ctx.moveTo(X(sx + dir * (o + 1.6)), Z(-3.2));
      ctx.lineTo(X(sx + dir * (o - 1)), Z(0));
      ctx.lineTo(X(sx + dir * (o + 1.6)), Z(3.2));
      ctx.stroke();
    }
  };
  const zoneBox = (): void => {
    ctx.strokeStyle = 'rgba(255,234,0,0.55)';
    ctx.lineWidth = 0.3 * k;
    ctx.setLineDash([2.4 * k, 1.6 * k]);
    strokeRect(def.zone.x, def.zone.z, def.zone.w, def.zone.d);
    ctx.setLineDash([]);
  };
  const curb = (color: string, stripe: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, 3.2 * k);
    ctx.fillRect(0, S - 3.2 * k, S, 3.2 * k);
    ctx.fillRect(0, 0, 3.2 * k, S);
    ctx.fillRect(S - 3.2 * k, 0, 3.2 * k, S);
    ctx.strokeStyle = stripe;
    ctx.lineWidth = 0.32 * k;
    strokeRect(0, 0, size - 6.4, size - 6.4);
  };

  if (def.id === 'downtown') {
    ctx.fillStyle = '#5b5d68';
    ctx.fillRect(0, 0, S, S);
    // sidewalks under every building lot
    lots(2.2, '#9a97a6');
    lots(1.2, '#a8a5b4');
    // plaza paving: concentric rings + radial seams
    for (let i = 8; i >= 1; i--) {
      ctx.fillStyle = i % 2 ? '#8c88a0' : '#7a7690';
      circle(0, 0, 4 + i * 3.4, true);
    }
    ctx.strokeStyle = 'rgba(20,18,36,0.45)';
    ctx.lineWidth = 0.14 * k;
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      line(Math.cos(ang) * 8, Math.sin(ang) * 8, Math.cos(ang) * 31, Math.sin(ang) * 31);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.3 * k;
    circle(0, 0, 31, false);
    // road markings along the two main axes
    ctx.strokeStyle = '#e0c050';
    ctx.lineWidth = 0.4 * k;
    ctx.setLineDash([3.2 * k, 2.4 * k]);
    line(-half + 6, 0, -34, 0); line(34, 0, half - 6, 0);
    line(0, -half + 6, 0, -34); line(0, 34, 0, half - 6);
    ctx.setLineDash([]);
    // zebra crossings at the plaza mouths
    ctx.fillStyle = 'rgba(240,240,240,0.8)';
    for (const sgn of [-1, 1]) {
      for (let i = -3; i <= 3; i++) {
        rect(sgn * 36.5, i * 1.8, 2.6, 0.9);
        rect(i * 1.8, sgn * 36.5, 0.9, 2.6);
      }
    }
    // manholes, grates and oil/puddle patches
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * (size - 20);
      const z = (rng() - 0.5) * (size - 20);
      ctx.fillStyle = 'rgba(30,30,38,0.7)';
      circle(x, z, 0.9, true);
      ctx.strokeStyle = 'rgba(160,160,170,0.5)';
      ctx.lineWidth = 0.12 * k;
      circle(x, z, 0.9, false);
      circle(x, z, 0.5, false);
    }
    for (let i = 0; i < 16; i++) {
      const x = (rng() - 0.5) * (size - 24);
      const z = (rng() - 0.5) * (size - 24);
      ctx.save();
      ctx.translate(X(x), Z(z));
      ctx.rotate(rng() * Math.PI);
      ctx.scale(1, 0.5);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, (2 + rng() * 3) * k);
      g.addColorStop(0, 'rgba(20,24,48,0.55)');
      g.addColorStop(1, 'rgba(20,24,48,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, (2 + rng() * 3) * k, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // neon spill
    for (const [x, z, col] of [
      [-30, 30, def.theme.accentA], [30, -30, def.theme.accentB],
      [30, 30, def.theme.accentA], [-30, -30, def.theme.accentB]
    ] as Array<[number, number, number]>) glow(x, z, 14, col, 0.18);
    curb('#3e3f4a', '#d9b84a');
    teamPad(-def.spawnX, 0xff007f, 1);
    teamPad(def.spawnX, 0x00ffff, -1);
    zoneBox();
  } else if (def.id === 'cargo_docks') {
    ctx.fillStyle = '#8a8478';
    ctx.fillRect(0, 0, S, S);
    // darker working lanes
    ctx.fillStyle = '#6e6a62';
    for (const z of [-30, 30, -60, 60]) rect(0, z, size - 8, 9);
    lots(1.6, '#9a9488');
    // hatched hazard ring around the crane base
    ctx.save();
    ctx.beginPath();
    ctx.rect(X(0) - 14 * k, Z(0) - 14 * k, 28 * k, 28 * k);
    ctx.rect(X(0) - 10 * k, Z(0) - 10 * k, 20 * k, 20 * k);
    ctx.clip('evenodd');
    ctx.fillStyle = '#d8aa22';
    ctx.fillRect(X(0) - 14 * k, Z(0) - 14 * k, 28 * k, 28 * k);
    ctx.fillStyle = '#1c1c20';
    for (let i = -40; i < 40; i++) {
      ctx.beginPath();
      ctx.moveTo(X(-14 + i * 1.4), Z(14));
      ctx.lineTo(X(-14 + i * 1.4 + 0.7), Z(14));
      ctx.lineTo(X(-14 + i * 1.4 + 0.7 + 28), Z(-14));
      ctx.lineTo(X(-14 + i * 1.4 + 28), Z(-14));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // bay grid with yellow lines and stencilled numbers
    ctx.strokeStyle = 'rgba(232,190,50,0.85)';
    ctx.lineWidth = 0.28 * k;
    for (let x = -80; x <= 80; x += 20) line(x, -half + 6, x, half - 6);
    for (let z = -80; z <= 80; z += 20) line(-half + 6, z, half - 6, z);
    ctx.fillStyle = 'rgba(240,230,200,0.55)';
    ctx.font = `bold ${3.2 * k}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let n = 1;
    for (let gz = -70; gz <= 70; gz += 20) {
      for (let gx = -70; gx <= 70; gx += 20) ctx.fillText(`B${n++}`, X(gx), Z(gz));
    }
    // rail tracks
    for (const z of [-68, 68]) {
      ctx.fillStyle = 'rgba(60,40,24,0.8)';
      for (let x = -half + 4; x < half - 4; x += 1.1) rect(x, z, 0.5, 3.4);
      ctx.fillStyle = '#9ba0a6';
      rect(0, z - 1.0, size - 8, 0.28);
      rect(0, z + 1.0, size - 8, 0.28);
    }
    // wooden pier boards under the pier footprint
    const pierObs = solids.filter((o) => o.id.startsWith('pier') && o.size.x > 20);
    for (const o of pierObs) {
      ctx.fillStyle = '#7a5a38';
      rect(o.position.x, o.position.z, o.size.x, o.size.z);
      ctx.strokeStyle = 'rgba(40,24,10,0.55)';
      ctx.lineWidth = 0.1 * k;
      for (let x = o.position.x - o.size.x / 2; x < o.position.x + o.size.x / 2; x += 0.9) {
        line(x, o.position.z - o.size.z / 2, x, o.position.z + o.size.z / 2);
      }
    }
    // oil stains + tyre marks
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * (size - 16);
      const z = (rng() - 0.5) * (size - 16);
      glow(x, z, 1.5 + rng() * 3.5, 0x14110e, 0.4);
    }
    ctx.strokeStyle = 'rgba(30,26,22,0.35)';
    ctx.lineWidth = 0.5 * k;
    for (let i = 0; i < 14; i++) {
      const z = (rng() - 0.5) * (size - 20);
      const x0 = (rng() - 0.5) * size;
      line(x0, z, x0 + 20 + rng() * 30, z + (rng() - 0.5) * 3);
    }
    curb('#4a463f', '#e8be32');
    teamPad(-def.spawnX, 0xff007f, 1);
    teamPad(def.spawnX, 0x00ffff, -1);
    zoneBox();
  } else if (def.id === 'sky_rink') {
    ctx.fillStyle = '#34396a';
    ctx.fillRect(0, 0, S, S);
    // neon-edged deck tiles
    ctx.strokeStyle = 'rgba(150,160,255,0.22)';
    ctx.lineWidth = 0.14 * k;
    for (let v = -half; v <= half; v += 5) { line(v, -half, v, half); line(-half, v, half, v); }
    lots(1.4, '#4a4f8a');
    // rink surface
    const rw = 92;
    const rh = 56;
    const g = ctx.createLinearGradient(X(-rw / 2), Z(rh / 2), X(rw / 2), Z(-rh / 2));
    g.addColorStop(0, '#d8e8ff');
    g.addColorStop(1, '#bcd2f4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(X(0) - (rw * k) / 2, Z(0) - (rh * k) / 2, rw * k, rh * k, 12 * k);
    ctx.fill();
    // blots of frost + scratches
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + rng() * 0.25})`;
      ctx.lineWidth = 0.1 * k;
      const x = (rng() - 0.5) * rw;
      const z = (rng() - 0.5) * rh;
      line(x, z, x + (rng() - 0.5) * 9, z + (rng() - 0.5) * 4);
    }
    ctx.strokeStyle = 'rgba(210,50,70,0.8)';
    ctx.lineWidth = 0.5 * k;
    line(0, -rh / 2, 0, rh / 2);
    ctx.strokeStyle = 'rgba(50,90,220,0.8)';
    line(-rw / 4, -rh / 2, -rw / 4, rh / 2);
    line(rw / 4, -rh / 2, rw / 4, rh / 2);
    ctx.strokeStyle = 'rgba(210,50,70,0.8)';
    circle(0, 0, 9, false);
    ctx.fillStyle = 'rgba(210,50,70,0.85)';
    circle(0, 0, 0.9, true);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        ctx.strokeStyle = 'rgba(210,50,70,0.7)';
        circle(sx * rw / 4, sz * 12, 4.5, false);
        ctx.fillStyle = 'rgba(210,50,70,0.8)';
        circle(sx * rw / 4, sz * 12, 0.7, true);
      }
    }
    ctx.strokeStyle = def.theme.accentA ? hex(def.theme.accentA) : '#9d5cff';
    ctx.lineWidth = 0.7 * k;
    ctx.beginPath();
    ctx.roundRect(X(0) - (rw * k) / 2, Z(0) - (rh * k) / 2, rw * k, rh * k, 12 * k);
    ctx.stroke();
    // skate-park graffiti glows on the deck
    for (const [x, z, col] of [
      [-48, 46, def.theme.accentA], [48, -46, def.theme.accentB],
      [48, 46, def.theme.accentA], [-48, -46, def.theme.accentB]
    ] as Array<[number, number, number]>) glow(x, z, 11, col, 0.3);
    curb('#22264c', '#2ee6a8');
    teamPad(-def.spawnX, 0xff007f, 1);
    teamPad(def.spawnX, 0x00ffff, -1);
    zoneBox();
  } else {
    // aurora_outpost: snowfield
    ctx.fillStyle = '#d4e0ea';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const x = (rng() - 0.5) * size;
      const z = (rng() - 0.5) * size;
      glow(x, z, 6 + rng() * 14, rng() > 0.5 ? 0xffffff : 0x8aa8c4, 0.28);
    }
    // frozen lakes
    for (const sz of [-1, 1]) {
      ctx.save();
      ctx.translate(X(0), Z(sz * 54));
      ctx.scale(1, 0.55);
      const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, 26 * k);
      lg.addColorStop(0, '#7db4dc');
      lg.addColorStop(0.8, '#9cc8e6');
      lg.addColorStop(1, 'rgba(180,215,238,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(0, 0, 26 * k, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 0.14 * k;
      for (let i = 0; i < 14; i++) {
        let x = (rng() - 0.5) * 30;
        let z = sz * 54 + (rng() - 0.5) * 14;
        ctx.beginPath();
        ctx.moveTo(X(x), Z(z));
        for (let s = 0; s < 5; s++) {
          x += (rng() - 0.5) * 6;
          z += (rng() - 0.5) * 4;
          ctx.lineTo(X(x), Z(z));
        }
        ctx.stroke();
      }
    }
    // packed-snow paths linking the base, radome and outbuildings
    ctx.strokeStyle = '#aebccb';
    ctx.lineCap = 'round';
    ctx.lineWidth = 7 * k;
    line(-def.spawnX, 0, def.spawnX, 0);
    line(0, -half + 12, 0, half - 12);
    ctx.lineWidth = 4 * k;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      line(sx * 12, sz * 26, sx * 50, sz * 34);
      line(sx * 30, sz * 30, sx * 46, sz * 60);
    }
    ctx.lineCap = 'butt';
    lots(2.0, '#b8c6d4');
    // tyre treads + footprints
    ctx.strokeStyle = 'rgba(90,110,130,0.5)';
    ctx.lineWidth = 0.35 * k;
    for (let i = 0; i < 12; i++) {
      const z = (rng() - 0.5) * (size - 30);
      const x0 = (rng() - 0.5) * size;
      line(x0, z, x0 + 25 + rng() * 25, z + (rng() - 0.5) * 6);
      line(x0, z + 1.4, x0 + 25 + rng() * 25, z + 1.4 + (rng() - 0.5) * 6);
    }
    ctx.fillStyle = 'rgba(100,120,140,0.5)';
    for (let i = 0; i < 80; i++) {
      const t = i / 80;
      const x = -def.spawnX + t * def.spawnX * 2;
      const z = Math.sin(t * 9) * 3 + (i % 2 ? 0.5 : -0.5);
      circle(x, z, 0.28, true);
    }
    // hazard-taped pads under the tanks and hangars
    ctx.strokeStyle = 'rgba(232,180,34,0.8)';
    ctx.lineWidth = 0.35 * k;
    for (const o of solids) {
      if (o.id.startsWith('tank') || o.id.startsWith('hangar') || o.id.startsWith('lab_')) {
        if (o.position.y - o.size.y / 2 > 0.1) continue;
        strokeRect(o.position.x, o.position.z, o.size.x + 3, o.size.z + 3);
      }
    }
    curb('#9db0c2', '#54ffd0');
    teamPad(-def.spawnX, 0xff007f, 1);
    teamPad(def.spawnX, 0x00ffff, -1);
    zoneBox();
  }

  // Tonal vignette near the walls so edges settle into the dome.
  const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S, S);

  const tex = finish(c, { repeat: false });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// Sky dome texture (equirectangular, horizon at the vertical midpoint)
// ---------------------------------------------------------------------------
const skyCache = new Map<MapId, THREE.CanvasTexture>();

export function getSkyTexture(def: MapDef): THREE.CanvasTexture {
  let t = skyCache.get(def.id);
  if (t) return t;
  const W = 2048;
  const H = 1024;
  const hy = H / 2;
  const [c, ctx] = makeCanvas(W, H);
  const rng = makeRng(def.size * 13 + 5);
  const th = def.theme;
  const sky = new THREE.Color(th.sky);
  const fog = new THREE.Color(th.fogColor);
  const zen = sky.clone().multiplyScalar(0.8);
  const hexc = (col: THREE.Color): string => `#${col.getHexString()}`;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hexc(zen));
  g.addColorStop(0.28, hexc(sky));
  g.addColorStop(0.46, hexc(sky.clone().lerp(fog, 0.6)));
  g.addColorStop(0.5, hexc(fog));
  g.addColorStop(0.56, hexc(fog.clone().multiplyScalar(0.92)));
  g.addColorStop(1, hexc(fog.clone().multiplyScalar(0.85)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const night = def.id !== 'cargo_docks';
  if (night) {
    for (let i = 0; i < 420; i++) {
      const y = rng() * (hy - 40);
      const fade = 1 - y / hy;
      ctx.fillStyle = `rgba(255,255,255,${(0.2 + rng() * 0.7) * fade})`;
      const s = rng() > 0.93 ? 2.6 : 1.3;
      ctx.fillRect(rng() * W, y, s, s);
    }
  }
  // sun / moon glow
  const sunX = W * 0.28;
  const sunY = def.id === 'cargo_docks' ? hy - 70 : hy - 230;
  const sunCol = def.id === 'cargo_docks' ? 0xffb060 : def.id === 'aurora_outpost' ? 0xdfeaff : 0xffc8e8;
  for (const [r, a] of [[320, 0.25], [160, 0.35], [70, 0.7]] as const) {
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r);
    sg.addColorStop(0, rgba(sunCol, a));
    sg.addColorStop(1, rgba(sunCol, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgba(sunCol, 0.95);
  ctx.beginPath();
  ctx.arc(sunX, sunY, def.id === 'cargo_docks' ? 42 : 26, 0, Math.PI * 2);
  ctx.fill();

  // cloud bands
  for (let i = 0; i < 70; i++) {
    const x = rng() * W;
    const y = 60 + rng() * (hy - 140);
    const w = 120 + rng() * 360;
    const h = 14 + rng() * 34;
    const tint = i % 2 ? th.accentA : th.accentB;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
    cg.addColorStop(0, rgba(tint, 0.14));
    cg.addColorStop(1, rgba(tint, 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / (w / 2));
    ctx.translate(-x, -y);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const silhouette = (base: number, layers: Array<{ color: string; minH: number; maxH: number; minW: number; maxW: number; windows?: number }>): void => {
    for (const L of layers) {
      let x = -20;
      while (x < W + 20) {
        const w = L.minW + rng() * (L.maxW - L.minW);
        const h = L.minH + rng() * (L.maxH - L.minH);
        ctx.fillStyle = L.color;
        ctx.fillRect(x, base - h, w, h + 4);
        if (L.windows) {
          for (let i = 0; i < L.windows; i++) {
            const wx = x + 3 + rng() * (w - 6);
            const wy = base - h + 4 + rng() * (h - 10);
            ctx.fillStyle = rng() > 0.5 ? 'rgba(255,214,140,0.8)' : 'rgba(140,220,255,0.7)';
            ctx.fillRect(wx, wy, 2, 3);
          }
        }
        if (rng() > 0.75) {
          ctx.fillStyle = L.color;
          ctx.fillRect(x + w / 2 - 1, base - h - 18, 2, 18);
        }
        x += w + rng() * 4;
      }
    }
  };

  if (def.id === 'downtown' || def.id === 'sky_rink') {
    const far = new THREE.Color(th.fogColor).multiplyScalar(0.7);
    const mid = new THREE.Color(th.fogColor).multiplyScalar(0.5);
    const near = new THREE.Color(th.fogColor).multiplyScalar(0.32);
    silhouette(hy + 2, [
      { color: hexc(far), minH: 20, maxH: 90, minW: 14, maxW: 40, windows: 4 },
      { color: hexc(mid), minH: 30, maxH: 120, minW: 18, maxW: 52, windows: 8 },
      { color: hexc(near), minH: 22, maxH: 70, minW: 22, maxW: 60, windows: 6 }
    ]);
    // neon crowns
    for (let i = 0; i < 26; i++) {
      const x = rng() * W;
      const y = hy - 40 - rng() * 100;
      ctx.fillStyle = rgba(i % 2 ? th.accentA : th.accentB, 0.85);
      ctx.fillRect(x, y, 12 + rng() * 22, 3);
    }
  } else if (def.id === 'cargo_docks') {
    const far = new THREE.Color(th.fogColor).multiplyScalar(0.72);
    const near = new THREE.Color(th.fogColor).multiplyScalar(0.45);
    // container stacks + gantry cranes + a ship hull on the water line
    silhouette(hy + 2, [{ color: hexc(far), minH: 8, maxH: 26, minW: 20, maxW: 60 }]);
    ctx.fillStyle = hexc(near);
    for (const cx of [W * 0.12, W * 0.42, W * 0.68, W * 0.9]) {
      ctx.fillRect(cx, hy - 150, 8, 150);
      ctx.fillRect(cx + 70, hy - 150, 8, 150);
      ctx.fillRect(cx - 60, hy - 158, 230, 10);
      ctx.fillRect(cx + 120, hy - 190, 6, 34);
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 50 + i * 60, hy - 150, 2, 30);
    }
    ctx.fillStyle = hexc(near.clone().multiplyScalar(0.9));
    ctx.beginPath();
    ctx.moveTo(W * 0.55, hy + 2);
    ctx.lineTo(W * 0.58, hy - 34);
    ctx.lineTo(W * 0.75, hy - 34);
    ctx.lineTo(W * 0.78, hy + 2);
    ctx.fill();
    ctx.fillRect(W * 0.62, hy - 70, 40, 36);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = ['#c0392b', '#2e86c1', '#d4a017', '#27ae60'][i % 4]!;
      ctx.fillRect(W * 0.585 + i * 14, hy - 46, 12, 12);
    }
  } else {
    // aurora_outpost: layered snowy mountains + aurora ribbons
    for (const [col, amp, base, freq] of [
      ['#7e9fb8', 80, hy - 4, 0.0042],
      ['#5d7e98', 110, hy, 0.003],
      ['#3f5e78', 70, hy + 3, 0.007]
    ] as const) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, hy + 6);
      for (let x = 0; x <= W; x += 8) {
        const y = base - amp * (0.5 + 0.5 * Math.sin(x * freq + amp) * Math.cos(x * freq * 2.3 + 1.7)) - 10;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, hy + 6);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 40; i++) ctx.fillRect(rng() * W, hy - 70 - rng() * 70, 6 + rng() * 14, 2);
    for (let b = 0; b < 3; b++) {
      const col = b === 1 ? th.accentB : th.accentA;
      for (let x = 0; x < W; x += 4) {
        const y = hy - 250 - b * 60 + Math.sin(x * 0.006 + b * 2) * 50 + Math.sin(x * 0.017 + b) * 14;
        const hh = 120 + Math.sin(x * 0.01 + b) * 40;
        const ag = ctx.createLinearGradient(0, y - hh, 0, y);
        ag.addColorStop(0, rgba(col, 0));
        ag.addColorStop(0.7, rgba(col, 0.22));
        ag.addColorStop(1, rgba(col, 0.04));
        ctx.fillStyle = ag;
        ctx.fillRect(x, y - hh, 4, hh);
      }
    }
  }

  // horizon haze so the silhouette dissolves into the fog colour
  const hz = ctx.createLinearGradient(0, hy - 90, 0, hy + 14);
  hz.addColorStop(0, rgba(th.fogColor, 0));
  hz.addColorStop(1, rgba(th.fogColor, 0.55));
  ctx.fillStyle = hz;
  ctx.fillRect(0, hy - 90, W, 104);
  // below the horizon: pure fog tone
  ctx.fillStyle = hexc(fog.clone().multiplyScalar(0.92));
  ctx.fillRect(0, hy + 14, W, hy - 14);

  t = finish(c, { repeat: false });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  skyCache.set(def.id, t);
  return t;
}
