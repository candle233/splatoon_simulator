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

  // Warm up in-game artworks and sponsor posters once the lobby is interactive:
  // every texture has an instant procedural fallback, so deferring the ~8 MB of
  // downloads costs nothing visually and keeps first paint fast on slow links.
  const idleWarmup = (): void => preloadAssetTextures();
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(idleWarmup, { timeout: 4000 });
  } else {
    setTimeout(idleWarmup, 2000);
  }

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
