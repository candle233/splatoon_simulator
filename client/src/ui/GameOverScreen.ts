import { GameOverPayload, Team } from '@ink/shared';

export class GameOverScreen {
  private overlayEl: HTMLElement | null;
  private winnerBannerEl: HTMLElement | null;
  private pinkPctEl: HTMLElement | null;
  private cyanPctEl: HTMLElement | null;
  private nextTimerEl: HTMLElement | null;

  constructor() {
    this.overlayEl = document.getElementById('game-over-screen');
    this.winnerBannerEl = document.getElementById('winner-banner');
    this.pinkPctEl = document.getElementById('final-pink-pct');
    this.cyanPctEl = document.getElementById('final-cyan-pct');
    this.nextTimerEl = document.getElementById('next-match-timer');
  }

  show(payload: GameOverPayload): void {
    if (!this.overlayEl) return;

    if (this.winnerBannerEl) {
      if (payload.winner === Team.PINK) {
        this.winnerBannerEl.textContent = 'TEAM PINK WINS!';
        this.winnerBannerEl.style.color = '#ff007f';
      } else if (payload.winner === Team.CYAN) {
        this.winnerBannerEl.textContent = 'TEAM CYAN WINS!';
        this.winnerBannerEl.style.color = '#00ffff';
      } else {
        this.winnerBannerEl.textContent = 'DRAW!';
        this.winnerBannerEl.style.color = '#ffffff';
      }
    }

    if (this.pinkPctEl) this.pinkPctEl.textContent = `${payload.pinkCoverage.toFixed(1)}%`;
    if (this.cyanPctEl) this.cyanPctEl.textContent = `${payload.cyanCoverage.toFixed(1)}%`;

    this.overlayEl.classList.remove('hidden');
  }

  updateCountdown(secRemaining: number): void {
    if (this.nextTimerEl) {
      this.nextTimerEl.textContent = `Next match in ${Math.max(0, Math.ceil(secRemaining))}s...`;
    }
  }

  hide(): void {
    this.overlayEl?.classList.add('hidden');
  }
}
