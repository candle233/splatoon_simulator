import { GameOverPayload, MODE_CONFIGS, Team } from '@ink/shared';
import type { GameMode } from '@ink/shared';
import { locName, t } from '../i18n.js';

export class GameOverScreen {
  private overlayEl: HTMLElement | null;
  private winnerBannerEl: HTMLElement | null;
  private pinkPctEl: HTMLElement | null;
  private cyanPctEl: HTMLElement | null;
  private nextTimerEl: HTMLElement | null;
  private pinkLabelEl: HTMLElement | null;
  private cyanLabelEl: HTMLElement | null;
  private lastMode: GameMode | undefined;
  /** Last payload rendered, so a language switch can repaint the same result. */
  private lastPayload: GameOverPayload | undefined;

  constructor() {
    this.overlayEl = document.getElementById('game-over-screen');
    this.winnerBannerEl = document.getElementById('winner-banner');
    this.pinkPctEl = document.getElementById('final-pink-pct');
    this.cyanPctEl = document.getElementById('final-cyan-pct');
    this.nextTimerEl = document.getElementById('next-match-timer');
    this.pinkLabelEl = document.getElementById('final-pink-label');
    this.cyanLabelEl = document.getElementById('final-cyan-label');

    // Winner banner and score labels are localized strings computed from the
    // payload, so repaint the visible result when the language changes.
    window.addEventListener('ink:langchange', () => {
      if (this.lastPayload && !this.overlayEl?.classList.contains('hidden')) {
        this.show(this.lastPayload);
      } else {
        this.applyIdleLabels();
      }
    });
    // Localized defaults before the first result arrives.
    this.applyIdleLabels();
  }

  /**
   * Localized labels shown while no result is on screen: the banner placeholder,
   * both coverage/kill/point labels and the countdown. `show()` overwrites them
   * with the real result once a match ends.
   */
  private applyIdleLabels(): void {
    if (this.winnerBannerEl) this.winnerBannerEl.textContent = t('gameover.matchOver');
    const label = t('hud.coverage');
    if (this.pinkLabelEl) this.pinkLabelEl.textContent = label;
    if (this.cyanLabelEl) this.cyanLabelEl.textContent = label;
    const modeEl = document.getElementById('game-over-mode');
    if (modeEl) modeEl.textContent = t('mode.turfWar');
    // Replaces the hardcoded English seed; updateCountdown() writes the live value.
    if (this.nextTimerEl) this.nextTimerEl.textContent = t('gameover.nextMatch', { s: 8 });
  }

  show(payload: GameOverPayload): void {
    if (!this.overlayEl) return;
    this.lastMode = payload.mode;
    this.lastPayload = payload;

    if (this.winnerBannerEl) {
      if (payload.winner === Team.PINK) {
        this.winnerBannerEl.textContent = t('gameover.pinkWins');
        this.winnerBannerEl.style.color = '#ff007f';
      } else if (payload.winner === Team.CYAN) {
        this.winnerBannerEl.textContent = t('gameover.cyanWins');
        this.winnerBannerEl.style.color = '#00ffff';
      } else {
        this.winnerBannerEl.textContent = t('gameover.draw');
        this.winnerBannerEl.style.color = '#ffffff';
      }
    }

    const isTurf = !payload.mode || payload.mode === 'turf_war';
    const label = isTurf ? t('hud.coverage') : payload.mode === 'team_deathmatch' ? t('hud.kills') : t('hud.points');
    if (this.pinkLabelEl) this.pinkLabelEl.textContent = `${label}`;
    if (this.cyanLabelEl) this.cyanLabelEl.textContent = `${label}`;

    if (this.pinkPctEl) {
      this.pinkPctEl.textContent = isTurf ? `${payload.pinkCoverage.toFixed(1)}%` : `${Math.round(payload.pinkCoverage)}`;
    }
    if (this.cyanPctEl) {
      this.cyanPctEl.textContent = isTurf ? `${payload.cyanCoverage.toFixed(1)}%` : `${Math.round(payload.cyanCoverage)}`;
    }

    if (payload.mode) {
      const modeNameEl = document.getElementById('game-over-mode');
      if (modeNameEl) {
        modeNameEl.textContent = `${locName(MODE_CONFIGS[payload.mode])}`;
        modeNameEl.classList.remove('hidden');
      }
    }

    this.overlayEl.classList.remove('hidden');
  }

  updateCountdown(secRemaining: number): void {
    if (this.nextTimerEl) {
      this.nextTimerEl.textContent = t('gameover.nextMatch', { s: Math.max(0, Math.ceil(secRemaining)) });
    }
  }

  hide(): void {
    this.overlayEl?.classList.add('hidden');
    document.getElementById('game-over-mode')?.classList.add('hidden');
  }
}
