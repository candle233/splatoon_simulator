import {
  MatchPhase,
  PlayerMode,
  SUB_WEAPON_CONFIGS,
  Team,
  WEAPON_CONFIGS,
  WeaponType
} from '@ink/shared';

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

  // New Skills & Weapon HUD elements
  private hudWeaponIconEl: HTMLImageElement | null;
  private hudSubIconEl: HTMLImageElement | null;
  private hudWeaponNameEl: HTMLElement | null;
  private hudSubNameEl: HTMLElement | null;
  private hudSubCostEl: HTMLElement | null;
  private specialValueEl: HTMLElement | null;
  private specialBarFillEl: HTMLElement | null;
  private specialReadyBannerEl: HTMLElement | null;
  private chargeRingEl: HTMLElement | null;
  private killFeedEl: HTMLElement | null;
  private damageVignetteEl: HTMLElement | null;
  private pinkSquidsEl: HTMLElement | null;
  private cyanSquidsEl: HTMLElement | null;

  constructor() {
    this.pinkSquidsEl = document.getElementById('team-squids-pink');
    this.cyanSquidsEl = document.getElementById('team-squids-cyan');
    this.damageVignetteEl = document.getElementById('damage-vignette');
    this.killFeedEl = document.getElementById('kill-feed');
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

    this.hudWeaponIconEl = document.getElementById('hud-weapon-icon') as HTMLImageElement | null;
    this.hudSubIconEl = document.getElementById('hud-sub-icon') as HTMLImageElement | null;
    this.hudWeaponNameEl = document.getElementById('hud-weapon-name');
    this.hudSubNameEl = document.getElementById('hud-sub-name');
    this.hudSubCostEl = document.getElementById('hud-sub-cost');
    this.specialValueEl = document.getElementById('special-value');
    this.specialBarFillEl = document.getElementById('special-bar-fill');
    this.specialReadyBannerEl = document.getElementById('special-ready-banner');
    this.chargeRingEl = document.getElementById('charge-ring');

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

    if (this.damageVignetteEl) {
      if (hp <= 0) {
        this.damageVignetteEl.style.opacity = '0';
        this.damageVignetteEl.classList.remove('pulsing');
        this.damageVignetteEl.classList.add('hidden');
      } else if (hp <= 35) {
        this.damageVignetteEl.classList.remove('hidden');
        this.damageVignetteEl.style.opacity = '0.75';
        this.damageVignetteEl.classList.add('pulsing');
      } else if (hp < 75) {
        this.damageVignetteEl.classList.remove('hidden');
        const factor = (75 - hp) / 40;
        this.damageVignetteEl.style.opacity = `${(factor * 0.45).toFixed(2)}`;
        this.damageVignetteEl.classList.remove('pulsing');
      } else {
        this.damageVignetteEl.style.opacity = '0';
        this.damageVignetteEl.classList.remove('pulsing');
        this.damageVignetteEl.classList.add('hidden');
      }
    }
  }

  triggerDamageFlash(): void {
    if (!this.damageVignetteEl) return;
    this.damageVignetteEl.classList.remove('hidden');
    this.damageVignetteEl.style.opacity = '0.9';
    window.setTimeout(() => {
      if (this.damageVignetteEl) {
        this.damageVignetteEl.style.opacity = '';
        if (!this.damageVignetteEl.classList.contains('pulsing')) {
          this.damageVignetteEl.classList.add('hidden');
        }
      }
    }, 180);
  }

  updateLoadoutAndSkills(
    weaponType: WeaponType,
    specialMeter: number,
    currentInk: number,
    chargeLevel = 0
  ): void {
    const config = WEAPON_CONFIGS[weaponType] || WEAPON_CONFIGS.shooter;
    const subConfig = SUB_WEAPON_CONFIGS[config.sub];

    const weaponThumbMap: Record<WeaponType, string> = {
      shooter: '/assets/weapons/splattershot.jpg',
      roller: '/assets/weapons/splat_roller.jpg',
      charger: '/assets/weapons/splat_charger.jpg',
      slosher: '/assets/weapons/slosher.jpg'
    };
    const subThumbMap: Record<string, string> = {
      splat_bomb: '/assets/weapons/splat_bomb.jpg',
      curling_bomb: '/assets/weapons/curling_bomb.jpg',
      burst_bomb: '/assets/weapons/splat_bomb.jpg'
    };

    if (this.hudWeaponIconEl) {
      const src = weaponThumbMap[weaponType] || weaponThumbMap.shooter;
      if (this.hudWeaponIconEl.getAttribute('src') !== src) {
        this.hudWeaponIconEl.src = src;
      }
    }
    if (this.hudSubIconEl) {
      const subSrc = subThumbMap[config.sub] || '/assets/weapons/splat_bomb.jpg';
      if (this.hudSubIconEl.getAttribute('src') !== subSrc) {
        this.hudSubIconEl.src = subSrc;
      }
    }

    if (this.hudWeaponNameEl) {
      this.hudWeaponNameEl.textContent = config.name;
    }
    if (this.hudSubNameEl) {
      this.hudSubNameEl.textContent = subConfig.name;
    }
    if (this.hudSubCostEl) {
      this.hudSubCostEl.textContent = `(${subConfig.inkCost}%)`;
      if (currentInk < subConfig.inkCost) {
        this.hudSubCostEl.style.color = '#ff4444';
      } else {
        this.hudSubCostEl.style.color = '#aaffaa';
      }
    }

    if (this.specialValueEl) {
      this.specialValueEl.textContent = `${Math.min(100, Math.round(specialMeter))}%`;
    }
    if (this.specialBarFillEl) {
      const pct = Math.min(100, Math.max(0, specialMeter));
      this.specialBarFillEl.style.width = `${pct}%`;
      if (pct >= 100) {
        this.specialBarFillEl.classList.add('ready');
      } else {
        this.specialBarFillEl.classList.remove('ready');
      }
    }
    if (this.specialReadyBannerEl) {
      if (specialMeter >= 100) {
        this.specialReadyBannerEl.classList.remove('hidden');
      } else {
        this.specialReadyBannerEl.classList.add('hidden');
      }
    }

    // Reticle charge ring for Charger
    if (this.chargeRingEl) {
      if (weaponType === 'charger' && chargeLevel > 0.05) {
        this.chargeRingEl.classList.remove('hidden');
        const scale = 1.0 + chargeLevel * 0.8;
        this.chargeRingEl.style.transform = `scale(${scale})`;
        this.chargeRingEl.style.borderColor = chargeLevel >= 0.98 ? '#ffff00' : 'rgba(255,255,255,0.8)';
      } else {
        this.chargeRingEl.classList.add('hidden');
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

  /**
   * Displays an animated kill feed event in the HUD (Subagent 78)
   */
  addKillFeedEntry(
    killerName: string,
    killerTeam: Team,
    victimName: string,
    victimTeam: Team,
    icon = '💥'
  ): void {
    if (!this.killFeedEl) return;

    const entry = document.createElement('div');
    entry.className = 'killfeed-entry';

    const killerSpan = document.createElement('span');
    killerSpan.className = killerTeam === Team.PINK ? 'killfeed-pink' : 'killfeed-cyan';
    killerSpan.textContent = killerName;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'killfeed-icon';
    iconSpan.textContent = icon;

    const victimSpan = document.createElement('span');
    victimSpan.className = victimTeam === Team.PINK ? 'killfeed-pink' : 'killfeed-cyan';
    victimSpan.textContent = victimName;

    entry.appendChild(killerSpan);
    entry.appendChild(iconSpan);
    entry.appendChild(victimSpan);

    this.killFeedEl.appendChild(entry);

    while (this.killFeedEl.children.length > 5) {
      this.killFeedEl.removeChild(this.killFeedEl.firstChild!);
    }

    window.setTimeout(() => {
      entry.classList.add('fading');
      window.setTimeout(() => {
        if (entry.parentElement === this.killFeedEl) {
          this.killFeedEl?.removeChild(entry);
        }
      }, 500);
    }, 3800);
  }

  /**
   * Updates top 4v4 team squid icons showing alive, dead, and special status
   */
  updateTeamSquids(players: { team: Team; alive: boolean; specialMeter?: number }[]): void {
    if (!this.pinkSquidsEl || !this.cyanSquidsEl) return;

    const pinkPlayers = players.filter((p) => p.team === Team.PINK).slice(0, 4);
    const cyanPlayers = players.filter((p) => p.team === Team.CYAN).slice(0, 4);

    const renderList = (el: HTMLElement, list: typeof pinkPlayers, teamClass: string) => {
      let html = '';
      for (let i = 0; i < 4; i++) {
        const p = list[i];
        if (!p) {
          html += `<span class="squid-indicator empty">·</span>`;
        } else if (!p.alive) {
          html += `<span class="squid-indicator dead ${teamClass}">✕</span>`;
        } else if ((p.specialMeter || 0) >= 100) {
          html += `<span class="squid-indicator alive ${teamClass} special-ready" title="Special Ready!">🦑</span>`;
        } else {
          html += `<span class="squid-indicator alive ${teamClass}">🦑</span>`;
        }
      }
      el.innerHTML = html;
    };

    renderList(this.pinkSquidsEl, pinkPlayers, 'pink');
    renderList(this.cyanSquidsEl, cyanPlayers, 'cyan');
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
