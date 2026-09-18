export class Crosshair {
  private crosshairEl: HTMLElement | null;
  private hitMarkerEl: HTMLElement | null;
  private hitMarkerTimeout?: number;
  private firingTimeout?: number;

  constructor() {
    this.crosshairEl = document.getElementById('crosshair');
    this.hitMarkerEl = document.getElementById('hit-marker');
  }

  onFire(): void {
    if (!this.crosshairEl) return;
    this.crosshairEl.classList.add('firing');

    if (this.firingTimeout) {
      window.clearTimeout(this.firingTimeout);
    }
    this.firingTimeout = window.setTimeout(() => {
      this.crosshairEl?.classList.remove('firing');
    }, 80);
  }

  showHitMarker(): void {
    if (!this.hitMarkerEl) return;
    this.hitMarkerEl.classList.remove('hidden');

    if (this.hitMarkerTimeout) {
      window.clearTimeout(this.hitMarkerTimeout);
    }
    this.hitMarkerTimeout = window.setTimeout(() => {
      this.hitMarkerEl?.classList.add('hidden');
    }, 100);
  }
}
