import { PlayerSnapshot, Team } from '@ink/shared';

/**
 * Live in-match scoreboard shown while Tab is held.
 * Data comes straight from server snapshots (kills/deaths are server-authoritative).
 * Rows are built with createElement/textContent — player names are user input and
 * must never be interpolated into HTML.
 */
export class Scoreboard {
  private root: HTMLElement | null;
  private body: HTMLElement | null;
  private visible = false;
  private lastRenderAt = 0;
  private lastDataKey = '';

  constructor() {
    this.root = document.getElementById('scoreboard');
    this.body = document.getElementById('scoreboard-body');
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!this.root) return;
    this.root.classList.toggle('hidden', !visible);
  }

  update(players: PlayerSnapshot[]): void {
    if (!this.root || !this.body) return;
    if (!this.visible) return;

    const now = performance.now();
    const dataKey = players
      .map((p) => `${p.id}:${p.kills}:${p.deaths}:${p.name}:${p.team}:${p.alive ? 1 : 0}`)
      .join('|');
    if (dataKey === this.lastDataKey && now - this.lastRenderAt < 500) return;
    this.lastDataKey = dataKey;
    this.lastRenderAt = now;

    const sorted = [...players].sort((a, b) => {
      if (a.team !== b.team) return a.team === Team.PINK ? -1 : 1;
      return b.kills - a.kills;
    });

    while (this.body.firstChild) {
      this.body.removeChild(this.body.firstChild);
    }

    for (const p of sorted) {
      const tr = document.createElement('tr');
      tr.className = p.team === Team.PINK ? 'sb-row pink' : 'sb-row cyan';

      const name = document.createElement('td');
      name.className = 'sb-name';
      name.textContent = p.name || 'Inker';
      tr.appendChild(name);

      const team = document.createElement('td');
      team.className = 'sb-team';
      team.textContent = p.team === Team.PINK ? 'PINK' : 'CYAN';
      tr.appendChild(team);

      const kills = document.createElement('td');
      kills.textContent = String(p.kills);
      tr.appendChild(kills);

      const deaths = document.createElement('td');
      deaths.textContent = String(p.deaths);
      tr.appendChild(deaths);

      this.body.appendChild(tr);
    }
  }
}
