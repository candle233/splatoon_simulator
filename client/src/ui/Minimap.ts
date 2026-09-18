import { ARENA_SIZE, ARENA_HALF_SIZE, BoxObstacle, Team, Vec3 } from '@ink/shared';
import { PaintEngine } from '../world/PaintEngine.js';

export interface MinimapPlayerData {
  position: Vec3;
  yaw: number;
  team: Team;
  alive: boolean;
  isSubmerged?: boolean;
}

export class Minimap {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paintEngine: PaintEngine;
  private visible = true;
  private lastDrawTime = 0;
  private drawInterval = 80; // ~12 fps radar refresh for optimal performance

  constructor(paintEngine: PaintEngine) {
    this.paintEngine = paintEngine;

    // Check if container already in DOM, else create
    let cont = document.getElementById('minimap-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'minimap-container';
      cont.className = 'minimap-box';
      cont.innerHTML = `
        <div class="minimap-header">
          <span class="minimap-title">RADAR</span>
          <span class="minimap-toggle-hint">[M]</span>
        </div>
        <canvas id="minimap-canvas" width="150" height="150"></canvas>
      `;
      document.getElementById('game-container')?.appendChild(cont);
    }
    this.container = cont;

    this.canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get 2d context for minimap');
    this.ctx = ctx;

    // Toggle on 'KeyM'
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.container.classList.remove('hidden');
    } else {
      this.container.classList.add('hidden');
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.container.classList.remove('hidden');
    else this.container.classList.add('hidden');
  }

  update(
    localPlayer: MinimapPlayerData,
    remotePlayers: MinimapPlayerData[],
    obstacles: BoxObstacle[]
  ): void {
    if (!this.visible) return;

    const now = performance.now();
    if (now - this.lastDrawTime < this.drawInterval) return;
    this.lastDrawTime = now;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    // 1. Clear background
    ctx.fillStyle = '#181920';
    ctx.fillRect(0, 0, w, h);

    // 2. Draw scaled turf coverage from PaintEngine canvas
    try {
      ctx.drawImage(this.paintEngine.canvas, 0, 0, w, h);
    } catch {
      // Ignore if canvas not ready
    }

    // 3. Draw obstacles
    ctx.fillStyle = 'rgba(30, 32, 42, 0.75)';
    ctx.strokeStyle = 'rgba(80, 85, 105, 0.8)';
    ctx.lineWidth = 1;

    for (const obs of obstacles) {
      const u = (obs.position.x - obs.size.x / 2 + ARENA_HALF_SIZE) / ARENA_SIZE;
      const v = (obs.position.z - obs.size.z / 2 + ARENA_HALF_SIZE) / ARENA_SIZE;
      const ow = (obs.size.x / ARENA_SIZE) * w;
      const oh = (obs.size.z / ARENA_SIZE) * h;

      ctx.fillRect(u * w, v * h, ow, oh);
      ctx.strokeRect(u * w, v * h, ow, oh);
    }

    // 4. Draw Spawns
    // Pink Spawn at (-40, 0)
    const pinkU = (-40 + ARENA_HALF_SIZE) / ARENA_SIZE;
    const pinkV = (0 + ARENA_HALF_SIZE) / ARENA_SIZE;
    ctx.beginPath();
    ctx.arc(pinkU * w, pinkV * h, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 127, 0.4)';
    ctx.fill();
    ctx.strokeStyle = '#ff007f';
    ctx.stroke();

    // Cyan Spawn at (40, 0)
    const cyanU = (40 + ARENA_HALF_SIZE) / ARENA_SIZE;
    const cyanV = (0 + ARENA_HALF_SIZE) / ARENA_SIZE;
    ctx.beginPath();
    ctx.arc(cyanU * w, cyanV * h, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.fill();
    ctx.strokeStyle = '#00ffff';
    ctx.stroke();

    // 5. Draw Remote Players
    for (const rp of remotePlayers) {
      if (!rp.alive) continue;
      const ru = (rp.position.x + ARENA_HALF_SIZE) / ARENA_SIZE;
      const rv = (rp.position.z + ARENA_HALF_SIZE) / ARENA_SIZE;
      const px = ru * w;
      const py = rv * h;

      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = rp.team === Team.PINK ? '#ff007f' : '#00ffff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 6. Draw Local Player with Direction Arrow
    if (localPlayer.alive) {
      const lu = (localPlayer.position.x + ARENA_HALF_SIZE) / ARENA_SIZE;
      const lv = (localPlayer.position.z + ARENA_HALF_SIZE) / ARENA_SIZE;
      const lx = lu * w;
      const ly = lv * h;

      ctx.save();
      ctx.translate(lx, ly);
      // yaw 0 faces +Z in three.js coords, on radar screen +Z is downward (y increasing)
      // yaw is CCW around +Y axis
      ctx.rotate(-localPlayer.yaw + Math.PI);

      // Yellow glowing triangle arrow
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 5);
      ctx.closePath();

      ctx.fillStyle = '#ffea00';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    }

    // 7. Radar grid border overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }
}
