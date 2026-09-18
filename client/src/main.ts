import { Game } from './core/Game.js';

window.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('error', (event) => {
    console.error('[Client Global Error]:', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Client Unhandled Rejection]:', event.reason);
  });

  try {
    const game = new Game();
    game.start();
  } catch (err) {
    console.error('[Game Init Error]:', err);
    const syncText = document.getElementById('sync-text');
    if (syncText) {
      syncText.textContent = `Initialization failed: ${(err as Error).message}`;
    }
  }
});
