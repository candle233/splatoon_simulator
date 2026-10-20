import { Game } from './core/Game.js';
import { initI18n, t } from './i18n.js';
import { preloadAssetTextures } from './rendering/AssetTextures.js';

window.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('error', (event) => {
    console.error('[Client Global Error]:', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Client Unhandled Rejection]:', event.reason);
  });

  // Localize the static markup before any screen is constructed, so the HUD and
  // menus never show the English defaults the HTML ships with.
  initI18n();

  // Warm up in-game artworks and sponsor posters immediately
  preloadAssetTextures();

  try {
    const game = new Game();
    (window as any).game = game;
    game.start();
  } catch (err) {
    console.error('[Game Init Error]:', err);
    const syncText = document.getElementById('sync-text');
    if (syncText) {
      syncText.textContent = t('hud.initFailed', { msg: (err as Error).message });
    }
  }
});
