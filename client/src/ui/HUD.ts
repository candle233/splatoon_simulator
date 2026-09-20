import {
  MatchPhase,
  MODE_CONFIGS,
  PlayerMode,
  SUB_WEAPON_CONFIGS,
  Team,
  WEAPON_CONFIGS,
  WeaponType
} from '@ink/shared';
import type { GameMode } from '@ink/shared';
import { locName, t } from '../i18n.js';

/** Escapes a localized label before it is embedded in an HTML attribute. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

  /**
   * Last arguments of every localized update. The render loop only calls the
   * update methods while a match is live, so without this cache the phase tag,
   * mode tag, weapon/sub names and debug values would keep the language they
   * had when the match ended. Replaying them on 'ink:langchange' keeps the HUD
   * consistent with the menus.
   */
  private lastMatchArgs: [MatchPhase, number, number, number, GameMode | undefined] | null = null;
  private lastStatusArgs: [number, number, PlayerMode, Team] | null = null;
  private lastLoadoutArgs: [WeaponType, number, number, number] | null = null;
  private lastDebugArgs:
    | [number, number, string, Team, number, number, number, Team, number, number, PlayerMode, number]
    | null = null;
  private lastSquidArgs: { team: Team; alive: boolean; specialMeter?: number }[] | null = null;
  /** Seconds shown in the death overlay, so a language switch can re-render it. */
  private lastRespawnSec = 4;

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

    window.addEventListener('ink:langchange', () => this.refreshI18n());

    // Localized seed for the (hidden) death overlay: showDeathOverlay() writes
    // the live countdown, this only replaces the hardcoded English markup.
    const respawnSeed = document.getElementById('respawn-msg');
    if (respawnSeed) respawnSeed.textContent = t('hud.respawnIn', { s: 4 });

    // Seed the loadout card from the shared configs so the lobby-time HUD shows
    // localized weapon/sub names instead of the English markup defaults.
    if (this.hudWeaponNameEl) this.hudWeaponNameEl.textContent = locName(WEAPON_CONFIGS.shooter);
    if (this.hudSubNameEl) {
      this.hudSubNameEl.textContent = locName(SUB_WEAPON_CONFIGS[WEAPON_CONFIGS.shooter.sub]);
    }
  }

  /** Re-applies localized HUD strings after a language switch. */
  refreshI18n(): void {
    if (this.lastMatchArgs) this.updateMatch(...this.lastMatchArgs);
    if (this.lastStatusArgs) this.updatePlayerStatus(...this.lastStatusArgs);
    if (this.lastLoadoutArgs) this.updateLoadoutAndSkills(...this.lastLoadoutArgs);
    // updateDebug() skips writing while the overlay is hidden, so replay through
    // the unguarded writer to keep the (hidden) values localized too.
    if (this.lastDebugArgs) this.applyDebug(...this.lastDebugArgs);
    if (this.lastSquidArgs) this.updateTeamSquids(this.lastSquidArgs);
    this.renderRespawnMessage(this.lastRespawnSec);
  }

  updateMatch(phase: MatchPhase, remainingSec: number, pinkScore: number, cyanScore: number, mode?: GameMode): void {
    this.lastMatchArgs = [phase, remainingSec, pinkScore, cyanScore, mode];
    if (this.timerEl) {
      const mins = Math.floor(Math.max(0, remainingSec) / 60);
      const secs = Math.floor(Math.max(0, remainingSec) % 60);
      this.timerEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    if (this.phaseEl) {
      switch (phase) {
        case MatchPhase.WAITING:
          this.phaseEl.textContent = t('hud.waiting');
          break;
        case MatchPhase.COUNTDOWN:
          this.phaseEl.textContent = t('hud.countdown');
          break;
        case MatchPhase.PLAYING:
          this.phaseEl.textContent = mode ? locName(MODE_CONFIGS[mode]) : t('mode.turfWar');
          break;
        case MatchPhase.GAME_OVER:
          this.phaseEl.textContent = t('hud.timeUp');
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

    // Score display: turf shows coverage %, zones/tdm show integer points/kills
    const isTurf = !mode || mode === 'turf_war';
    if (this.pinkScoreEl) {
      this.pinkScoreEl.textContent = isTurf ? `${pinkScore.toFixed(1)}%` : `${Math.round(pinkScore)}`;
    }
    if (this.cyanScoreEl) {
      this.cyanScoreEl.textContent = isTurf ? `${cyanScore.toFixed(1)}%` : `${Math.round(cyanScore)}`;
    }

    if (this.pinkBarEl) this.pinkBarEl.style.width = `${Math.min(100, pinkScore)}%`;
    if (this.cyanBarEl) this.cyanBarEl.style.width = `${Math.min(100, cyanScore)}%`;
  }

  updatePlayerStatus(hp: number, ink: number, mode: PlayerMode, team: Team): void {
    this.lastStatusArgs = [hp, ink, mode, team];
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
        this.modeTagEl.textContent = t('hud.swimming');
        this.modeTagEl.className = 'mode-tag submerged';
      } else {
        this.modeTagEl.textContent = t('hud.humanoid');
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
    this.lastLoadoutArgs = [weaponType, specialMeter, currentInk, chargeLevel];
    const config = WEAPON_CONFIGS[weaponType] || WEAPON_CONFIGS.shooter;
    const subConfig = SUB_WEAPON_CONFIGS[config.sub];

    const weaponThumbMap: Partial<Record<WeaponType, string>> = {
      shooter: '/assets/weapons/splattershot.jpg',
      roller: '/assets/weapons/splat_roller.jpg',
      charger: '/assets/weapons/splat_charger.jpg',
      slosher: '/assets/weapons/slosher.jpg',
      // New weapons have no bespoke art yet; reuse the closest silhouette so
      // the HUD never renders a broken image.
      sprayer: '/assets/weapons/splattershot.jpg',
      cannon: '/assets/weapons/slosher.jpg',
      marksman: '/assets/weapons/splat_charger.jpg',
      scatter: '/assets/weapons/splattershot.jpg'
    };
    const subThumbMap: Record<string, string> = {
      splat_bomb: '/assets/weapons/splat_bomb.jpg',
      curling_bomb: '/assets/weapons/curling_bomb.jpg',
      burst_bomb: '/assets/weapons/splat_bomb.jpg',
      ink_mine: '/assets/weapons/splat_bomb.jpg',
      bounce_bomb: '/assets/weapons/curling_bomb.jpg',
      ink_puddle: '/assets/weapons/splat_bomb.jpg'
    };

    if (this.hudWeaponIconEl) {
      const src = weaponThumbMap[weaponType] ?? weaponThumbMap.shooter ?? '';
      if (src && this.hudWeaponIconEl.getAttribute('src') !== src) {
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
      this.hudWeaponNameEl.textContent = locName(config);
    }
    if (this.hudSubNameEl) {
      this.hudSubNameEl.textContent = locName(subConfig);
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
    this.renderRespawnMessage(respawnCountdownSec);
  }

  /** Writes the localized "Respawning in {s}s…" line and remembers the value. */
  private renderRespawnMessage(respawnCountdownSec: number): void {
    this.lastRespawnSec = Math.max(0, Math.ceil(respawnCountdownSec));
    const msgEl = document.getElementById('respawn-msg');
    if (msgEl) {
      msgEl.textContent = t('hud.respawnIn', { s: this.lastRespawnSec });
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
    this.lastSquidArgs = players;
    if (!this.pinkSquidsEl || !this.cyanSquidsEl) return;

    const pinkPlayers = players.filter((p) => p.team === Team.PINK).slice(0, 4);
    const cyanPlayers = players.filter((p) => p.team === Team.CYAN).slice(0, 4);

    const renderList = (el: HTMLElement, list: typeof pinkPlayers, teamClass: string) => {
      const specialReadyTitle = escapeAttr(t('hud.specialReadyTitle'));
      let html = '';
      for (let i = 0; i < 4; i++) {
        const p = list[i];
        if (!p) {
          html += `<span class="squid-indicator empty">·</span>`;
        } else if (!p.alive) {
          html += `<span class="squid-indicator dead ${teamClass}">✕</span>`;
        } else if ((p.specialMeter || 0) >= 100) {
          html += `<span class="squid-indicator alive ${teamClass} special-ready" title="${specialReadyTitle}">🦑</span>`;
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
    this.lastDebugArgs = [fps, ping, id, team, x, y, z, groundInk, hp, ink, mode, paintCount];
    if (this.debugOverlayEl?.classList.contains('hidden')) return;
    this.applyDebug(fps, ping, id, team, x, y, z, groundInk, hp, ink, mode, paintCount);
  }

  /** Writes the debug values without the visibility guard (used by refreshI18n). */
  private applyDebug(
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
    if (this.dbgFpsEl) this.dbgFpsEl.textContent = `${fps}`;
    if (this.dbgPingEl) this.dbgPingEl.textContent = `${ping}`;
    if (this.dbgPlayerIdEl) this.dbgPlayerIdEl.textContent = id.slice(0, 8);
    if (this.dbgTeamEl) this.dbgTeamEl.textContent = team === Team.PINK ? t('debug.pink') : t('debug.cyan');
    if (this.dbgPosEl) this.dbgPosEl.textContent = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    if (this.dbgGroundEl) {
      this.dbgGroundEl.textContent =
        groundInk === Team.PINK ? t('debug.pink') : groundInk === Team.CYAN ? t('debug.cyan') : t('debug.neutral');
    }
    if (this.dbgHpEl) this.dbgHpEl.textContent = `${Math.round(hp)}`;
    if (this.dbgInkEl) this.dbgInkEl.textContent = `${Math.round(ink)}`;
    if (this.dbgModeEl) {
      this.dbgModeEl.textContent =
        mode === PlayerMode.SUBMERGED
          ? t('debug.submerged')
          : mode === PlayerMode.DEAD
            ? t('debug.dead')
            : t('debug.humanoid');
    }
    if (this.dbgPaintCountEl) this.dbgPaintCountEl.textContent = `${paintCount}`;
  }
}
