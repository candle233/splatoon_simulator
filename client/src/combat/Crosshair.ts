import type { WeaponType } from '@ink/shared';

export class Crosshair {
  private crosshairEl: HTMLElement | null;
  private hitMarkerEl: HTMLElement | null;
  private chargeRingEl: HTMLElement | null = null;
  private warningEl: HTMLElement | null = null;
  private hitMarkerTimeout?: number;
  private firingTimeout?: number;
  private lowInkTimeout?: number;
  private currentWeapon: WeaponType = 'shooter';

  constructor() {
    this.crosshairEl = document.getElementById('crosshair');
    this.hitMarkerEl = document.getElementById('hit-marker');

    if (this.crosshairEl) {
      this.chargeRingEl = document.getElementById('charge-ring');

      // Low-ink warning pill below reticle
      this.warningEl = document.getElementById('crosshair-warning');
      if (!this.warningEl) {
        this.warningEl = document.createElement('div');
        this.warningEl.id = 'crosshair-warning';
        this.warningEl.className = 'ch-warning hidden';
        this.warningEl.textContent = 'NO INK';
        this.crosshairEl.appendChild(this.warningEl);
      }

      // Add reticle bracket elements if not present
      if (!this.crosshairEl.querySelector('.ch-bracket-l')) {
        const bl = document.createElement('div');
        bl.className = 'ch-bracket ch-bracket-l';
        const br = document.createElement('div');
        br.className = 'ch-bracket ch-bracket-r';
        const bt = document.createElement('div');
        bt.className = 'ch-bracket ch-bracket-t';
        const bb = document.createElement('div');
        bb.className = 'ch-bracket ch-bracket-b';
        this.crosshairEl.appendChild(bl);
        this.crosshairEl.appendChild(br);
        this.crosshairEl.appendChild(bt);
        this.crosshairEl.appendChild(bb);
      }

      this.setWeapon('shooter');
    }
  }

  setWeapon(weapon: WeaponType): void {
    this.currentWeapon = weapon;
    if (!this.crosshairEl) return;

    // Clear weapon classes
    const classes = Array.from(this.crosshairEl.classList);
    for (const c of classes) {
      if (c.startsWith('reticle-')) {
        this.crosshairEl.classList.remove(c);
      }
    }
    this.crosshairEl.classList.add(`reticle-${weapon}`);
  }

  onFire(weaponType?: WeaponType): void {
    if (!this.crosshairEl) return;
    const type = weaponType || this.currentWeapon;

    this.crosshairEl.classList.add('firing');

    let duration = 80;
    if (type === 'sprayer') duration = 45;
    else if (type === 'cannon') duration = 140;
    else if (type === 'scatter') duration = 120;
    else if (type === 'marksman') duration = 65;

    if (this.firingTimeout) {
      window.clearTimeout(this.firingTimeout);
    }
    this.firingTimeout = window.setTimeout(() => {
      this.crosshairEl?.classList.remove('firing');
    }, duration);
  }

  updateCharge(chargeLevel: number, isFull = false): void {
    if (!this.chargeRingEl) return;

    if (chargeLevel > 0.04) {
      this.chargeRingEl.classList.remove('hidden');
      // Scale converges inward from 1.8 down to 1.0 as weapon charges
      const scale = 1.7 - chargeLevel * 0.7;
      const rot = Math.round(chargeLevel * 180);
      this.chargeRingEl.style.transform = `scale(${scale.toFixed(2)}) rotate(${rot}deg)`;

      if (isFull || chargeLevel >= 0.98) {
        this.chargeRingEl.classList.add('charged');
        this.chargeRingEl.style.borderColor = '#ffff00';
      } else {
        this.chargeRingEl.classList.remove('charged');
        this.chargeRingEl.style.borderColor = 'rgba(255, 255, 255, 0.85)';
      }
    } else {
      this.chargeRingEl.classList.add('hidden');
      this.chargeRingEl.classList.remove('charged');
    }
  }

  setLowInk(isLow: boolean): void {
    if (!this.crosshairEl) return;

    if (isLow) {
      this.crosshairEl.classList.add('low-ink');
      this.warningEl?.classList.remove('hidden');

      if (this.lowInkTimeout) {
        window.clearTimeout(this.lowInkTimeout);
      }
      this.lowInkTimeout = window.setTimeout(() => {
        this.crosshairEl?.classList.remove('low-ink');
        this.warningEl?.classList.add('hidden');
      }, 700);
    } else {
      this.crosshairEl.classList.remove('low-ink');
      this.warningEl?.classList.add('hidden');
    }
  }

  showHitMarker(isKill = false): void {
    if (!this.hitMarkerEl) return;
    this.hitMarkerEl.classList.remove('hidden');

    if (isKill) {
      this.hitMarkerEl.classList.add('kill');
    } else {
      this.hitMarkerEl.classList.remove('kill');
    }

    if (this.hitMarkerTimeout) {
      window.clearTimeout(this.hitMarkerTimeout);
    }
    const dur = isKill ? 220 : 100;
    this.hitMarkerTimeout = window.setTimeout(() => {
      this.hitMarkerEl?.classList.add('hidden');
      this.hitMarkerEl?.classList.remove('kill');
    }, dur);
  }

  setMoving(moving: boolean): void {
    if (!this.crosshairEl) return;
    if (moving) {
      this.crosshairEl.classList.add('moving');
    } else {
      this.crosshairEl.classList.remove('moving');
    }
  }

  setMidair(midair: boolean): void {
    if (!this.crosshairEl) return;
    if (midair) {
      this.crosshairEl.classList.add('midair');
    } else {
      this.crosshairEl.classList.remove('midair');
    }
  }

  setAds(isAds: boolean): void {
    if (!this.crosshairEl) return;
    if (isAds) {
      this.crosshairEl.classList.add('ads-scoped');
    } else {
      this.crosshairEl.classList.remove('ads-scoped');
    }
  }
}
