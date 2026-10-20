import {
  SPECIAL_CONFIGS,
  SUB_WEAPON_CONFIGS,
  WEAPON_CONFIGS,
  WeaponType
} from '@ink/shared';
import { locName, t } from '../i18n.js';
import type { ScreenManager } from './ScreenManager.js';

export interface WeaponSelectCallbacks {
  onWeaponConfirmed: (weapon: WeaponType) => void;
  /** When the timeout fires without an explicit choice — defaults to current selection. */
  onAutoConfirm: (weapon: WeaponType) => void;
  onReturnToLobby: () => void;
}

/** All available weapons in the same order the lobby grid uses. */
const ALL_WEAPONS = Object.keys(WEAPON_CONFIGS) as WeaponType[];

const THUMB_PATHS: Record<WeaponType, string> = {
  shooter: '/assets/weapons/splattershot.jpg',
  roller: '/assets/weapons/splat_roller.jpg',
  charger: '/assets/weapons/splat_charger.jpg',
  slosher: '/assets/weapons/slosher.jpg',
  sprayer: '/assets/weapons/sprayer.jpg',
  cannon: '/assets/weapons/cannon.jpg',
  marksman: '/assets/weapons/marksman.jpg',
  scatter: '/assets/weapons/scatter.jpg',
  brella: '/assets/weapons/brella.jpg',
  dualies: '/assets/weapons/dualies.jpg'
};

export class WeaponSelectScreen {
  private el: HTMLElement;
  private gridEl: HTMLElement | null;
  private selectedEl: HTMLElement | null;
  private subEl: HTMLElement | null;
  private specEl: HTMLElement | null;
  private remainingEl: HTMLElement | null;
  private confirmBtn: HTMLElement | null;
  private lobbyBtn: HTMLElement | null;

  private screenManager?: ScreenManager;
  private callbacks: WeaponSelectCallbacks;
  private currentWeapon: WeaponType;
  private readonly durationSec: number;
  private timerInterval?: number;
  private selectStartTime = 0;
  private keyDownBound?: (e: KeyboardEvent) => void;

  constructor(callbacks: WeaponSelectCallbacks, initialWeapon: WeaponType, durationSec: number, screenManager?: ScreenManager) {
    this.callbacks = callbacks;
    this.screenManager = screenManager;
    this.currentWeapon = initialWeapon;
    this.durationSec = durationSec;

    this.el = document.getElementById('weapon-select-screen') as HTMLElement;
    if (!this.el) throw new Error('Missing #weapon-select-screen element');
    this.gridEl = document.querySelector('.weapon-select-grid') as HTMLElement | null;
    this.selectedEl = document.getElementById('weapon-select-selected-name');
    this.subEl = document.getElementById('weapon-select-sub');
    this.specEl = document.getElementById('weapon-select-special');
    this.remainingEl = document.getElementById('weapon-select-remaining');
    this.confirmBtn = document.getElementById('btn-weapon-confirm');
    this.lobbyBtn = document.getElementById('btn-weapon-lobby');

    this.keyDownBound = (e: KeyboardEvent) => this.onKeyDown(e);
    window.addEventListener('keydown', this.keyDownBound);
    this.bindEvents();
    this.applyI18n();
  }

  private bindEvents(): void {
    this.confirmBtn?.addEventListener('click', () => this.confirm());
    this.lobbyBtn?.addEventListener('click', () => this.callbacks.onReturnToLobby());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.el.classList.contains('hidden')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.callbacks.onReturnToLobby();
    } else {
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= ALL_WEAPONS.length) {
        this.selectWeapon(ALL_WEAPONS[idx - 1]!);
      }
    }
  }

  selectWeapon(weapon: WeaponType): void {
    this.currentWeapon = weapon;
    this.selectStartTime = Date.now();
    this.renderCard();
    this.restartTimer();
  }

  private confirm(): void {
    this.callbacks.onWeaponConfirmed(this.currentWeapon);
  }

  private renderCard(): void {
    const cfg = WEAPON_CONFIGS[this.currentWeapon];
    if (!cfg) return;
    if (this.selectedEl) this.selectedEl.textContent = locName(cfg);
    if (this.subEl) {
      const subCfg = SUB_WEAPON_CONFIGS[cfg.sub];
      this.subEl.textContent = `${t('weaponSelect.subBadge')}: ${locName(subCfg)}`;
    }
    if (this.specEl) {
      const specCfg = SPECIAL_CONFIGS[cfg.special];
      this.specEl.textContent = `${t('weaponSelect.specialBadge')}: ${locName(specCfg)}`;
    }
    this.buildGrid();
  }

  private buildGrid(): void {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    for (let i = 0; i < ALL_WEAPONS.length; i++) {
      const w = ALL_WEAPONS[i]!;
      const cfg = WEAPON_CONFIGS[w];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'weapon-select-card' + (w === this.currentWeapon ? ' selected' : '');
      card.setAttribute('data-weapon', w);
      card.setAttribute('data-index', String(i + 1));

      const thumb = document.createElement('div');
      thumb.className = 'weapon-select-thumb';
      const img = document.createElement('img');
      img.src = THUMB_PATHS[w] ?? '/assets/weapons/splattershot.jpg';
      img.alt = cfg.name;
      img.addEventListener('error', () => {
        img.style.visibility = 'hidden';
        thumb.classList.add('weapon-thumb-fallback');
      });
      thumb.appendChild(img);

      const info = document.createElement('div');
      info.className = 'weapon-select-info';
      const name = document.createElement('span');
      name.className = 'weapon-select-name';
      name.textContent = locName(cfg);
      info.appendChild(name);

      card.appendChild(thumb);
      card.appendChild(info);
      card.addEventListener('click', () => this.selectWeapon(w));
      this.gridEl.appendChild(card);
    }
  }

  show(): void {
    if (this.screenManager) this.screenManager.show('weaponSelect');
    else this.el.classList.remove('hidden');
    this.renderCard();
    this.restartTimer();
  }

  hide(): void {
    if (this.screenManager) this.screenManager.hide('weaponSelect');
    else this.el.classList.add('hidden');
    this.stopTimer();
  }

  isVisible(): boolean {
    if (this.screenManager) return this.screenManager.isVisible('weaponSelect');
    return this.el && !this.el.classList.contains('hidden');
  }

  private restartTimer(): void {
    this.stopTimer();
    this.selectStartTime = Date.now();
    this.updateTimerUI();
    this.timerInterval = window.setInterval(() => this.updateTimerUI(), 100);
  }

  private stopTimer(): void {
    if (this.timerInterval !== undefined) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  private updateTimerUI(): void {
    const elapsed = Date.now() - this.selectStartTime;
    const remaining = Math.max(0, this.durationSec * 1000 - elapsed);
    if (this.remainingEl) {
      const sec = Math.ceil(remaining / 1000);
      this.remainingEl.textContent = t('weaponSelect.timeLeft', { s: sec });
      if (sec <= 3) {
        this.remainingEl.classList.add('urgent');
      } else {
        this.remainingEl.classList.remove('urgent');
      }
    }
    if (remaining <= 0) {
      this.stopTimer();
      this.callbacks.onAutoConfirm(this.currentWeapon);
    }
  }

  applyI18n(): void {
    const setText = (id: string | null, key: string) => {
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.textContent = t(key);
    };
    setText('weapon-select-title', 'weaponSelect.title');
    setText('weapon-select-instructions', 'weaponSelect.instructions');
    setText('btn-weapon-confirm-label', 'weaponSelect.confirm');
    setText('btn-weapon-lobby-label', 'weaponSelect.backToLobby');
    this.renderCard();
  }

  dispose(): void {
    this.stopTimer();
    if (this.keyDownBound) window.removeEventListener('keydown', this.keyDownBound);
  }
}
