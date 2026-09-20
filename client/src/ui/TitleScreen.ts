import { applyI18n, getLang, langLabel, setLang, t, LANGS } from '../i18n.js';
import type { ScreenManager } from './ScreenManager.js';

export interface TitleScreenCallbacks {
  onPlay: () => void;
  onOpenSettings: () => void;
}

/**
 * Animated main menu shown before the lobby. Pure DOM/CSS: floating ink
 * blobs, logo, primary actions and a language switcher.
 *
 * Visibility goes through the ScreenManager when one is supplied, so the title
 * can never stay layered over the lobby swallowing its clicks.
 */
export class TitleScreen {
  private container: HTMLElement | null;
  private langSwitch: HTMLElement | null;
  private screens?: ScreenManager;

  constructor(callbacks: TitleScreenCallbacks, screens?: ScreenManager) {
    this.container = document.getElementById('title-screen');
    this.langSwitch = document.getElementById('title-lang-switch');
    this.screens = screens;

    if (!this.container) return;

    // Build floating ink blobs
    const blobs = this.container.querySelector('.title-blobs');
    if (blobs && blobs.childElementCount === 0) {
      for (let i = 0; i < 14; i++) {
        const blob = document.createElement('span');
        blob.className = 'ink-blob';
        const size = 24 + Math.random() * 130;
        blob.style.width = `${size}px`;
        blob.style.height = `${size * (0.7 + Math.random() * 0.5)}px`;
        blob.style.left = `${Math.random() * 100}%`;
        blob.style.animationDelay = `${-Math.random() * 18}s`;
        blob.style.animationDuration = `${12 + Math.random() * 16}s`;
        blob.style.background =
          Math.random() < 0.5 ? 'radial-gradient(circle at 35% 35%, #ff4da6, #ff007f 65%)' : 'radial-gradient(circle at 35% 35%, #66ffff, #00c8e0 65%)';
        blob.style.opacity = `${0.1 + Math.random() * 0.25}`;
        blobs.appendChild(blob);
      }
    }

    this.container.querySelector('#btn-title-play')?.addEventListener('click', () => {
      callbacks.onPlay();
    });
    this.container.querySelector('#btn-title-settings')?.addEventListener('click', () => {
      callbacks.onOpenSettings();
    });

    this.buildLangSwitch();
    applyI18n(this.container);
  }

  private buildLangSwitch(): void {
    if (!this.langSwitch) return;
    this.langSwitch.innerHTML = '';
    for (const lang of LANGS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lang-btn';
      btn.setAttribute('data-lang', lang);
      btn.textContent = langLabel(lang);
      if (lang === getLang()) btn.classList.add('active');
      btn.addEventListener('click', () => {
        setLang(lang);
        this.langSwitch
          ?.querySelectorAll('.lang-btn')
          .forEach((b) => b.classList.toggle('active', b.getAttribute('data-lang') === getLang()));
      });
      this.langSwitch.appendChild(btn);
    }
  }

  show(): void {
    if (this.screens) this.screens.show('title');
    else this.container?.classList.remove('hidden');
  }

  hide(): void {
    if (this.screens) this.screens.hide('title');
    else this.container?.classList.add('hidden');
  }

  isVisible(): boolean {
    if (this.screens) return this.screens.isVisible('title');
    return !!this.container && !this.container.classList.contains('hidden');
  }
}

export function ensureTitleVersionLabel(version = 'v1.1'): void {
  const el = document.getElementById('title-version');
  if (el) el.textContent = `INK ARENA ${version} · ${t('title.credits')}`;
}
