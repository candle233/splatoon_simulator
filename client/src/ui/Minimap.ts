import { ARENA_SIZE, BoxObstacle, ClimbableSurface, EmoteType, Team, Vec3, spawnXForSize } from '@ink/shared';
import { PaintEngine } from '../world/PaintEngine.js';
import { t } from '../i18n.js';

export interface MinimapPlayerData {
  position: Vec3;
  yaw: number;
  team: Team;
  alive: boolean;
  isSubmerged?: boolean;
}

/** A tactical map ping placed by a teammate's quick-chat. */
interface MinimapPing {
  type: EmoteType;
  /** World coordinates of the pinged spot. */
  x: number;
  z: number;
  team: Team;
  /** performance.now() (ms) when the ping arrived. */
  at: number;
}

const PING_LIFETIME_MS = 3000;
const MAX_PINGS = 12;

export class Minimap {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paintEngine: PaintEngine;
  private visible = true;
  private lastDrawTime = 0;
  private drawInterval = 80; // ~12 fps radar refresh for optimal performance
  private mapSize = ARENA_SIZE;
  /** |x| of both team spawn rows, derived from the real map size. */
  private spawnX = spawnXForSize(ARENA_SIZE);
  private zone: { x: number; z: number; w: number; d: number } | undefined;
  private zoneOwner: Team | null = null;
  private climbables: ClimbableSurface[] = [];
  private pings: MinimapPing[] = [];

  constructor(paintEngine: PaintEngine) {
    this.paintEngine = paintEngine;
    // Fall back to the paint engine's extent so the radar is already correct
    // before anyone calls setSize().
    const engineSize = paintEngine.getMapSize();
    if (engineSize > 0) {
      this.mapSize = engineSize;
      this.spawnX = spawnXForSize(engineSize);
    }

    // Check if container already in DOM, else create
    let cont = document.getElementById('minimap-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'minimap-container';
      cont.className = 'minimap-box';
      cont.innerHTML = `
        <div class="minimap-header">
          <span class="minimap-title">${t('hud.radar')}</span>
          <span class="minimap-toggle-hint" title="${t('hud.radarToggle')}">[M]</span>
        </div>
        <canvas id="minimap-canvas" width="150" height="150"></canvas>
      `;
      document.getElementById('game-container')?.appendChild(cont);
    }
    this.container = cont;

    // Re-localize the radar header on language change (the node is created once,
    // so applyI18n() alone cannot reach it).
    window.addEventListener('ink:langchange', () => this.applyI18n());
    this.applyI18n();

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

  /** Re-applies the localized radar header labels. */
  applyI18n(): void {
    const title = this.container.querySelector('.minimap-title');
    if (title) title.textContent = t('hud.radar');
    const hint = this.container.querySelector('.minimap-toggle-hint');
    if (hint) {
      hint.textContent = '[M]';
      hint.setAttribute('title', t('hud.radarToggle'));
    }
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
    if (size > 0) {
      this.mapSize = size;
      this.spawnX = spawnXForSize(size);
    }
  }

  /** Active map edge length the radar is drawing against. */
  getSize(): number {
    return this.mapSize;
  }

  /** Sets the active map's Splat Zones rect so the radar can outline it. */
  setZone(zone: { x: number; z: number; w: number; d: number } | undefined): void {
    this.zone = zone;
  }

  /** Sets current owner of the capture zone for tactical display. */
  setZoneOwner(owner: Team | null): void {
    this.zoneOwner = owner;
  }

  /** Sets climbable vertical walls for tactical route display. */
  setClimbables(surfaces: ClimbableSurface[]): void {
    this.climbables = surfaces || [];
  }

  /**
   * Adds a tactical quick-chat ping ('ouch' SOS, 'ping_enemy', 'ping_area',
   * 'ping_defend') at world coordinates. Markers pulse 3 times, then fade out
   * after 3s; the list is capped so a ping flood cannot grow it unbounded.
   */
  addPing(type: EmoteType, x: number, z: number, team: Team): void {
    this.pings.push({ type, x, z, team, at: performance.now() });
    if (this.pings.length > MAX_PINGS) this.pings.shift();
  }

  /** Removes all map pings (match reset). */
  clearPings(): void {
    this.pings.length = 0;
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

    // 1. Clear background & draw subtle tactical grid
    ctx.fillStyle = '#0f1118';
    ctx.fillRect(0, 0, w, h);

    // Subtle tactical coordinate crosshairs & concentric range rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.25, 0, Math.PI * 2);
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Draw scaled live turf coverage from PaintEngine canvas
    try {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.paintEngine.canvas, 0, 0, w, h);
      ctx.globalAlpha = 1.0;
    } catch {
      // Ignore if canvas not ready
    }

    const toPx = (wx: number): number => ((wx + this.mapSize / 2) / this.mapSize) * w;
    const toPy = (wz: number): number => ((wz + this.mapSize / 2) / this.mapSize) * h;

    // 3. Draw 4-Tier Vertical Elevation Contours
    // Tier 0: <= 1.5m (Ground platforms/curbs)
    // Tier 1: 1.5m ~ 4.5m (Catwalks / low overpasses)
    // Tier 2: 4.5m ~ 8.0m (Mid elevated bridges)
    // Tier 3: > 8.0m (Apex sky rinks / sniper perches)
    for (const obs of obstacles) {
      if (obs.id.startsWith('wall_')) continue; // Skip perimeter borders

      const topY = obs.position.y + obs.size.y * 0.5;
      const u = (obs.position.x - obs.size.x / 2 + this.mapSize / 2) / this.mapSize;
      const v = (obs.position.z - obs.size.z / 2 + this.mapSize / 2) / this.mapSize;
      const ow = (obs.size.x / this.mapSize) * w;
      const oh = (obs.size.z / this.mapSize) * h;
      const rx = u * w;
      const ry = v * h;

      if (topY <= 1.5) {
        // Tier 0: Ground level
        ctx.fillStyle = 'rgba(26, 30, 42, 0.78)';
        ctx.fillRect(rx, ry, ow, oh);
        ctx.strokeStyle = 'rgba(70, 80, 105, 0.65)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, ow, oh);
      } else if (topY <= 4.5) {
        // Tier 1: Low catwalks / walkways
        ctx.fillStyle = 'rgba(38, 52, 80, 0.85)';
        ctx.fillRect(rx, ry, ow, oh);
        ctx.strokeStyle = 'rgba(95, 135, 195, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(rx, ry, ow, oh);
      } else if (topY <= 8.0) {
        // Tier 2: Mid-tier elevated decks & bridges
        ctx.fillStyle = 'rgba(52, 76, 118, 0.90)';
        ctx.fillRect(rx, ry, ow, oh);
        ctx.strokeStyle = 'rgba(135, 185, 255, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, ow, oh);

        // Inner contour accent line
        if (ow > 6 && oh > 6) {
          ctx.strokeStyle = 'rgba(180, 215, 255, 0.35)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(rx + 2, ry + 2, ow - 4, oh - 4);
        }
      } else {
        // Tier 3: Apex high ground (> 8.0m)
        ctx.fillStyle = 'rgba(75, 110, 168, 0.95)';
        ctx.fillRect(rx, ry, ow, oh);
        ctx.strokeStyle = '#d6eeff';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(rx, ry, ow, oh);

        // Diagonal corner tick mark for apex platforms
        if (ow >= 8 && oh >= 8) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx, ry + 4);
          ctx.lineTo(rx + 4, ry);
          ctx.moveTo(rx + ow - 4, ry);
          ctx.lineTo(rx + ow, ry + 4);
          ctx.stroke();
        }
      }
    }

    // 4. Draw Climbable Wall Routes (vertical mobility routes)
    if (this.climbables.length > 0) {
      ctx.strokeStyle = 'rgba(0, 255, 180, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([2, 2]);
      for (const cs of this.climbables) {
        if (cs.id.startsWith('climb_wall')) continue;
        let cx1 = 0;
        let cz1 = 0;
        let cx2 = 0;
        let cz2 = 0;
        if (Math.abs(cs.normal.x) > Math.abs(cs.normal.z)) {
          // Wall surface faces along X, so the segment extends along Z
          const faceX = cs.position.x + Math.sign(cs.normal.x) * cs.size.x * 0.5;
          const z1 = cs.position.z - cs.size.z * 0.48;
          const z2 = cs.position.z + cs.size.z * 0.48;
          cx1 = toPx(faceX);
          cz1 = toPy(z1);
          cx2 = toPx(faceX);
          cz2 = toPy(z2);
        } else {
          // Wall surface faces along Z, so the segment extends along X
          const faceZ = cs.position.z + Math.sign(cs.normal.z) * cs.size.z * 0.5;
          const x1 = cs.position.x - cs.size.x * 0.48;
          const x2 = cs.position.x + cs.size.x * 0.48;
          cx1 = toPx(x1);
          cz1 = toPy(faceZ);
          cx2 = toPx(x2);
          cz2 = toPy(faceZ);
        }
        ctx.beginPath();
        ctx.moveTo(cx1, cz1);
        ctx.lineTo(cx2, cz2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 5. Draw Capture Point / Splat Zones Status
    if (this.zone) {
      const zx = toPx(this.zone.x - this.zone.w / 2);
      const zy = toPy(this.zone.z - this.zone.d / 2);
      const zw = (this.zone.w / this.mapSize) * w;
      const zh = (this.zone.d / this.mapSize) * h;

      const pulse = 0.5 + Math.sin(now * 0.005) * 0.5;

      if (this.zoneOwner === Team.PINK) {
        ctx.fillStyle = `rgba(255, 0, 127, ${0.22 + pulse * 0.12})`;
        ctx.fillRect(zx, zy, zw, zh);
        ctx.strokeStyle = '#ff007f';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(zx, zy, zw, zh);
      } else if (this.zoneOwner === Team.CYAN) {
        ctx.fillStyle = `rgba(0, 255, 255, ${0.22 + pulse * 0.12})`;
        ctx.fillRect(zx, zy, zw, zh);
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(zx, zy, zw, zh);
      } else {
        // Neutral or contested
        ctx.fillStyle = `rgba(255, 234, 0, ${0.12 + pulse * 0.08})`;
        ctx.fillRect(zx, zy, zw, zh);
        ctx.strokeStyle = '#ffea00';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(zx, zy, zw, zh);
        ctx.setLineDash([]);
      }

      // Zone objective badge
      const zcx = zx + zw / 2;
      const zcy = zy + zh / 2;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.zoneOwner === Team.PINK ? '#ff007f' : this.zoneOwner === Team.CYAN ? '#00ffff' : '#ffea00';
      ctx.fillText('ZONE', zcx, zcy);
    }

    // 6. Draw Team Spawns
    const spawnRadius = Math.max(4, (7 * ARENA_SIZE) / this.mapSize);
    const pinkPx = toPx(-this.spawnX);
    const pinkPy = toPy(0);
    ctx.beginPath();
    ctx.arc(pinkPx, pinkPy, spawnRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 0, 127, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#ff007f';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const cyanPx = toPx(this.spawnX);
    const cyanPy = toPy(0);
    ctx.beginPath();
    ctx.arc(cyanPx, cyanPy, spawnRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 255, 255, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 6.5 Draw tactical quick-chat pings (pulse 3x, fade after 3s)
    if (this.pings.length > 0) {
      let write = 0;
      for (const ping of this.pings) {
        const age = now - ping.at;
        if (age > PING_LIFETIME_MS) continue; // expired: compact in place
        this.pings[write++] = ping;

        const px = toPx(ping.x);
        const py = toPy(ping.z);
        // Tail fade over the last 600ms of life.
        const fade = age > PING_LIFETIME_MS - 600 ? (PING_LIFETIME_MS - age) / 600 : 1;
        // 3 pulses across the 3s lifetime (1 Hz).
        const pulseT = (age % 1000) / 1000;
        const pulseR = 5 + pulseT * 8;
        const alpha = Math.max(0, 1 - pulseT) * 0.75 * fade;
        const teamColor = ping.team === Team.PINK ? '#ff007f' : '#00ffff';

        // Expanding pulse ring, team-colored
        ctx.beginPath();
        ctx.arc(px, py, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = teamColor;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Solid core disc with team-colored border
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 17, 24, 0.92)';
        ctx.fill();
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        this.drawPingIcon(ctx, px, py, ping.type, teamColor);
        ctx.globalAlpha = 1.0;
      }
      this.pings.length = write;
    }

    // 7. Draw Remote Players (Teammate Beacons vs Enemy Indicators)
    for (const rp of remotePlayers) {
      if (!rp.alive) continue;
      const ru = (rp.position.x + this.mapSize / 2) / this.mapSize;
      const rv = (rp.position.z + this.mapSize / 2) / this.mapSize;
      const px = ru * w;
      const py = rv * h;

      const isTeammate = rp.team === localPlayer.team;
      const teamColor = rp.team === Team.PINK ? '#ff007f' : '#00ffff';

      if (isTeammate) {
        // Teammate beacon: soft glowing ping ring
        const beaconPulse = (now * 0.005) % 1;
        const ringR = 4.5 + beaconPulse * 5;
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = teamColor;
        ctx.globalAlpha = Math.max(0, 1 - beaconPulse) * 0.6;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        // Teammate core dot
        ctx.beginPath();
        ctx.arc(px, py, rp.isSubmerged ? 3.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = teamColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Direction pointer
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-rp.yaw + Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(2.5, -2);
        ctx.lineTo(-2.5, -2);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      } else {
        // Enemy beacon
        if (rp.isSubmerged) {
          // Submerged enemy in ink: subtle stealth ripple
          const dx = rp.position.x - localPlayer.position.x;
          const dz = rp.position.z - localPlayer.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 22) {
            ctx.beginPath();
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 60, 60, 0.45)`;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        } else {
          // Standing / shooting enemy: prominent danger dot
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = teamColor;
          ctx.fill();
          ctx.strokeStyle = '#ff3344';
          ctx.lineWidth = 1.6;
          ctx.stroke();

          // Enemy direction pip
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(-rp.yaw + Math.PI);
          ctx.beginPath();
          ctx.moveTo(0, -5.5);
          ctx.lineTo(2, -2);
          ctx.lineTo(-2, -2);
          ctx.closePath();
          ctx.fillStyle = '#ff3344';
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // 8. Draw Local Player (Tactical Sonar Arrow)
    if (localPlayer.alive) {
      const lu = (localPlayer.position.x + this.mapSize / 2) / this.mapSize;
      const lv = (localPlayer.position.z + this.mapSize / 2) / this.mapSize;
      const lx = lu * w;
      const ly = lv * h;

      // Dynamic sonar ping ring around local player
      const pingPulse = (now * 0.0035) % 1;
      const pingR = 5 + pingPulse * 8;
      ctx.beginPath();
      ctx.arc(lx, ly, pingR, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffea00';
      ctx.globalAlpha = Math.max(0, 1 - pingPulse) * 0.55;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(-localPlayer.yaw + Math.PI);

      if (localPlayer.isSubmerged) {
        // Squid form indicator: compact droplet arrow
        ctx.beginPath();
        ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffea00';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -6.5);
        ctx.lineTo(3, 1);
        ctx.lineTo(-3, 1);
        ctx.closePath();
        ctx.fillStyle = '#ffea00';
        ctx.fill();
      } else {
        // Humanoid form: crisp tactical arrow
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5.5, 5);
        ctx.lineTo(0, 2.5);
        ctx.lineTo(-5.5, 5);
        ctx.closePath();
        ctx.fillStyle = '#ffea00';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      ctx.restore();
    }

    // 9. Radar Outer Bezel & Elevation Contour Tag
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // Subtle 4-tier elevation badge in bottom-right corner
    ctx.font = '800 7px monospace';
    ctx.fillStyle = 'rgba(180, 200, 230, 0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('4-TIER 12m', w - 4, h - 4);
  }

  /**
   * Stylized vector glyphs inside the ping marker:
   * enemy = red skull, area = yellow arrow, defend = blue shield, ouch = SOS mark.
   */
  private drawPingIcon(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    type: EmoteType,
    teamColor: string
  ): void {
    switch (type) {
      case 'ping_enemy': {
        // Red skull: dome + jaw + eye sockets
        ctx.fillStyle = '#ff3344';
        ctx.beginPath();
        ctx.arc(px, py - 0.8, 2.9, Math.PI, 0);
        ctx.lineTo(px + 2.9, py + 1.6);
        ctx.lineTo(px + 1.4, py + 1.6);
        ctx.lineTo(px + 0.9, py + 3.2);
        ctx.lineTo(px - 0.9, py + 3.2);
        ctx.lineTo(px - 1.4, py + 1.6);
        ctx.lineTo(px - 2.9, py + 1.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#0f1118';
        ctx.fillRect(px - 2, py - 1.4, 1.3, 1.3);
        ctx.fillRect(px + 0.7, py - 1.4, 1.3, 1.3);
        break;
      }
      case 'ping_area': {
        // Yellow chevron arrow ("this way")
        ctx.fillStyle = '#ffea00';
        ctx.beginPath();
        ctx.moveTo(px, py - 3.4);
        ctx.lineTo(px + 3.1, py + 2.4);
        ctx.lineTo(px, py + 0.9);
        ctx.lineTo(px - 3.1, py + 2.4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'ping_defend': {
        // Blue shield
        ctx.fillStyle = '#3b9dff';
        ctx.beginPath();
        ctx.moveTo(px - 3, py - 3);
        ctx.lineTo(px + 3, py - 3);
        ctx.lineTo(px + 3, py + 0.4);
        ctx.lineTo(px, py + 3.4);
        ctx.lineTo(px - 3, py + 0.4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default: {
        // 'ouch' SOS: exclamation mark in the team color
        ctx.fillStyle = teamColor;
        ctx.fillRect(px - 0.8, py - 3.4, 1.6, 4.4);
        ctx.fillRect(px - 0.8, py + 2, 1.6, 1.6);
        break;
      }
    }
  }
}
