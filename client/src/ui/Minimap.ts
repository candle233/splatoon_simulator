import { ARENA_SIZE, BoxObstacle, Team, Vec3 } from '@ink/shared';
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
  private mapSize = ARENA_SIZE;

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

  /** Sets the active map edge length so radar coordinates stay correct. */
  setSize(size: number): void {
    if (size > 0) this.mapSize = size;
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
      const u = (obs.position.x - obs.size.x / 2 + this.mapSize / 2) / this.mapSize;
      const v = (obs.position.z - obs.size.z / 2 + this.mapSize / 2) / this.mapSize;
      const ow = (obs.size.x / this.mapSize) * w;
      const oh = (obs.size.z / this.mapSize) * h;

      ctx.fillRect(u * w, v * h, ow, oh);
      ctx.strokeRect(u * w, v * h, ow, oh);
    }

    // 4. Draw Spawns
    // Pink Spawn at (-40, 0)
    const pinkU = (-(this.mapSize * 0.4) + this.mapSize / 2) / this.mapSize;
    const pinkV = (0 + this.mapSize / 2) / this.mapSize;
    ctx.beginPath();
    ctx.arc(pinkU * w, pinkV * h, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 127, 0.4)';
    ctx.fill();
    ctx.strokeStyle = '#ff007f';
    ctx.stroke();

    // Cyan Spawn at (40, 0)
    const cyanU = (this.mapSize * 0.4 + this.mapSize / 2) / this.mapSize;
    const cyanV = (0 + this.mapSize / 2) / this.mapSize;
    ctx.beginPath();
    ctx.arc(cyanU * w, cyanV * h, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.fill();
    ctx.strokeStyle = '#00ffff';
    ctx.stroke();

    // 5. Draw Remote Players
    for (const rp of remotePlayers) {
      if (!rp.alive) continue;
      const ru = (rp.position.x + this.mapSize / 2) / this.mapSize;
      const rv = (rp.position.z + this.mapSize / 2) / this.mapSize;
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
      const lu = (localPlayer.position.x + this.mapSize / 2) / this.mapSize;
      const lv = (localPlayer.position.z + this.mapSize / 2) / this.mapSize;
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
