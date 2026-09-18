import { MatchPhase, PlayerMode, Team } from '@ink/shared';

export class HUD {
  private timerEl: HTMLElement | null;
  private phaseEl: HTMLElement | null;
  private pinkScoreEl: HTMLElement | null;
  private cyanScoreEl: HTMLElement | null;
  private pinkBarEl: HTMLElement | null;
  private cyanBarEl: HTMLElement | null;

  private hpValueEl: HTMLElement | null;
  private hpBarFillEl: HTMLElement | null;
  private inkValueEl: HTMLElement | null;
  private inkBarFillEl: HTMLElement | null;
  private modeTagEl: HTMLElement | null;

  private deathScreenEl: HTMLElement | null;
  private respawnCountdownEl: HTMLElement | null;

  private countdownSplashEl: HTMLElement | null;
  private countdownNumberEl: HTMLElement | null;

  private syncBannerEl: HTMLElement | null;
  private syncTextEl: HTMLElement | null;

  // Debug elements
  private debugOverlayEl: HTMLElement | null;
  private dbgFpsEl: HTMLElement | null;
  private dbgPingEl: HTMLElement | null;
  private dbgPlayerIdEl: HTMLElement | null;
  private dbgTeamEl: HTMLElement | null;
  private dbgPosEl: HTMLElement | null;
  private dbgGroundEl: HTMLElement | null;
  private dbgHpEl: HTMLElement | null;
  private dbgInkEl: HTMLElement | null;
  private dbgModeEl: HTMLElement | null;
  private dbgPaintCountEl: HTMLElement | null;

  constructor() {
    this.timerEl = document.getElementById('match-timer');
    this.phaseEl = document.getElementById('match-phase-label');
    this.pinkScoreEl = document.getElementById('pink-score-text');
    this.cyanScoreEl = document.getElementById('cyan-score-text');
    this.pinkBarEl = document.getElementById('turf-bar-pink');
    this.cyanBarEl = document.getElementById('turf-bar-cyan');

    this.hpValueEl = document.getElementById('hp-value');
    this.hpBarFillEl = document.getElementById('hp-bar-fill');
    this.inkValueEl = document.getElementById('ink-value');
    this.inkBarFillEl = document.getElementById('ink-bar-fill');
    this.modeTagEl = document.getElementById('player-mode-tag');

    this.deathScreenEl = document.getElementById('death-screen');
    this.respawnCountdownEl = document.getElementById('respawn-countdown');

    this.countdownSplashEl = document.getElementById('countdown-splash');
    this.countdownNumberEl = document.getElementById('countdown-number');

    this.syncBannerEl = document.getElementById('sync-banner');
    this.syncTextEl = document.getElementById('sync-text');

    this.debugOverlayEl = document.getElementById('debug-overlay');
    this.dbgFpsEl = document.getElementById('dbg-fps');
    this.dbgPingEl = document.getElementById('dbg-ping');
    this.dbgPlayerIdEl = document.getElementById('dbg-player-id');
    this.dbgTeamEl = document.getElementById('dbg-team');
    this.dbgPosEl = document.getElementById('dbg-pos');
    this.dbgGroundEl = document.getElementById('dbg-ground');
    this.dbgHpEl = document.getElementById('dbg-hp');
    this.dbgInkEl = document.getElementById('dbg-ink');
    this.dbgModeEl = document.getElementById('dbg-mode');
    this.dbgPaintCountEl = document.getElementById('dbg-paint-count');
  }

  updateMatch(phase: MatchPhase, remainingSec: number, pinkPct: number, cyanPct: number): void {
    if (this.timerEl) {
      const mins = Math.floor(Math.max(0, remainingSec) / 60);
      const secs = Math.floor(Math.max(0, remainingSec) % 60);
      this.timerEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    if (this.phaseEl) {
      switch (phase) {
        case MatchPhase.WAITING:
          this.phaseEl.textContent = 'WAITING FOR PLAYERS';
          break;
        case MatchPhase.COUNTDOWN:
          this.phaseEl.textContent = 'READY...';
          break;
        case MatchPhase.PLAYING:
          this.phaseEl.textContent = 'TURF WAR';
          break;
        case MatchPhase.GAME_OVER:
          this.phaseEl.textContent = 'TIME UP!';
          break;
      }
    }

    // Countdown Splash
    if (phase === MatchPhase.COUNTDOWN) {
      this.countdownSplashEl?.classList.remove('hidden');
      if (this.countdownNumberEl) {
        this.countdownNumberEl.textContent = String(Math.max(1, Math.ceil(remainingSec)));
      }
    } else {
      this.countdownSplashEl?.classList.add('hidden');
    }

    // Turf coverage bars
    if (this.pinkScoreEl) this.pinkScoreEl.textContent = `${pinkPct.toFixed(1)}%`;
    if (this.cyanScoreEl) this.cyanScoreEl.textContent = `${cyanPct.toFixed(1)}%`;

    if (this.pinkBarEl) this.pinkBarEl.style.width = `${pinkPct}%`;
    if (this.cyanBarEl) this.cyanBarEl.style.width = `${cyanPct}%`;
  }

  updatePlayerStatus(hp: number, ink: number, mode: PlayerMode, team: Team): void {
    if (this.hpValueEl) this.hpValueEl.textContent = `${Math.max(0, Math.round(hp))}`;
    if (this.hpBarFillEl) {
      this.hpBarFillEl.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      if (hp <= 30) {
        this.hpBarFillEl.classList.add('low');
      } else {
        this.hpBarFillEl.classList.remove('low');
      }
    }

    if (this.inkValueEl) this.inkValueEl.textContent = `${Math.max(0, Math.round(ink))}%`;
    if (this.inkBarFillEl) {
      this.inkBarFillEl.style.width = `${Math.max(0, Math.min(100, ink))}%`;
      const color = team === Team.PINK ? '#ff007f' : '#00ffff';
      this.inkBarFillEl.style.background = color;
    }

    if (this.modeTagEl) {
      if (mode === PlayerMode.SUBMERGED) {
        this.modeTagEl.textContent = 'SWIMMING';
        this.modeTagEl.className = 'mode-tag submerged';
      } else {
        this.modeTagEl.textContent = 'HUMANOID';
        this.modeTagEl.className = 'mode-tag humanoid';
      }
    }
  }

  showDeathOverlay(respawnCountdownSec: number): void {
    this.deathScreenEl?.classList.remove('hidden');
    if (this.respawnCountdownEl) {
      this.respawnCountdownEl.textContent = `${Math.max(0, Math.ceil(respawnCountdownSec))}`;
    }
  }

  hideDeathOverlay(): void {
    this.deathScreenEl?.classList.add('hidden');
  }

  showSyncBanner(msg: string): void {
    this.syncBannerEl?.classList.remove('hidden');
    if (this.syncTextEl) this.syncTextEl.textContent = msg;
  }

  hideSyncBanner(): void {
    this.syncBannerEl?.classList.add('hidden');
  }

  toggleDebugOverlay(): void {
    this.debugOverlayEl?.classList.toggle('hidden');
  }

  updateDebug(
    fps: number,
    ping: number,
    id: string,
    team: Team,
    x: number,
    y: number,
    z: number,
    groundInk: Team,
    hp: number,
    ink: number,
    mode: PlayerMode,
    paintCount: number
  ): void {
    if (this.debugOverlayEl?.classList.contains('hidden')) return;

    if (this.dbgFpsEl) this.dbgFpsEl.textContent = `${fps}`;
    if (this.dbgPingEl) this.dbgPingEl.textContent = `${ping}`;
    if (this.dbgPlayerIdEl) this.dbgPlayerIdEl.textContent = id.slice(0, 8);
    if (this.dbgTeamEl) this.dbgTeamEl.textContent = team === Team.PINK ? 'Pink' : 'Cyan';
    if (this.dbgPosEl) this.dbgPosEl.textContent = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    if (this.dbgGroundEl) {
      this.dbgGroundEl.textContent =
        groundInk === Team.PINK ? 'Pink' : groundInk === Team.CYAN ? 'Cyan' : 'Neutral';
    }
    if (this.dbgHpEl) this.dbgHpEl.textContent = `${Math.round(hp)}`;
    if (this.dbgInkEl) this.dbgInkEl.textContent = `${Math.round(ink)}`;
    if (this.dbgModeEl) {
      this.dbgModeEl.textContent =
        mode === PlayerMode.SUBMERGED ? 'Submerged' : mode === PlayerMode.DEAD ? 'Dead' : 'Humanoid';
    }
    if (this.dbgPaintCountEl) this.dbgPaintCountEl.textContent = `${paintCount}`;
  }
}
