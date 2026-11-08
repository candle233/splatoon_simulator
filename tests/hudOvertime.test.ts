/**
 * HUD overtime label tests.
 *
 * HUD.ts resolves every element through document.getElementById in its
 * constructor (HUD.ts:94-161), so these need a real DOM — hence the
 * happy-dom pragma (same precedent as emoteDisplay.test.ts). The suite only
 * mounts #match-timer; every other element lookup stays null and is
 * null-guarded inside the HUD.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MatchPhase } from '@ink/shared';
import { HUD } from '../client/src/ui/HUD.js';
import { DICTIONARIES, getLang, setLang, t } from '../client/src/i18n.js';
import type { Lang } from '../client/src/i18n.js';

function timer(): HTMLElement {
  return document.getElementById('match-timer')!;
}

beforeEach(() => {
  document.body.innerHTML = '<span id="match-timer"></span>';
});

describe('HUD overtime label (延长赛标签)', () => {
  it('renders a plain clock when the snapshot has no overtime flag (old servers)', () => {
    const hud = new HUD();
    hud.updateMatch(MatchPhase.PLAYING, 95.4, 50.2, 47.9, 'turf_war', undefined);

    expect(timer().textContent).toMatch(/^\d+:\d{2}$/);
    expect(timer().textContent).not.toContain(t('hud.overtime'));
    expect(timer().classList.contains('overtime')).toBe(false);
  });

  it('highlights the clock with the localized overtime text while extended', () => {
    const hud = new HUD();
    hud.updateMatch(MatchPhase.PLAYING, 42, 50.2, 47.9, 'turf_war', true);

    expect(timer().textContent).toContain(t('hud.overtime'));
    expect(timer().classList.contains('overtime')).toBe(true);
    // The clock itself is still readable next to the label.
    expect(timer().textContent).toMatch(/\d+:\d{2}/);
  });

  it('keeps the highlight after refreshI18n() replays the cached args', () => {
    const hud = new HUD();
    hud.updateMatch(MatchPhase.PLAYING, 42, 50.2, 47.9, 'turf_war', true);
    expect(timer().classList.contains('overtime')).toBe(true);

    // Regression guard: lastMatchArgs must carry the 6th slot, otherwise the
    // spread replay silently drops the overtime highlight.
    hud.refreshI18n();
    expect(timer().textContent).toContain(t('hud.overtime'));
    expect(timer().classList.contains('overtime')).toBe(true);
  });

  it('drops the highlight again once overtime ends', () => {
    const hud = new HUD();
    hud.updateMatch(MatchPhase.PLAYING, 42, 50.2, 47.9, 'turf_war', true);
    expect(timer().classList.contains('overtime')).toBe(true);

    hud.updateMatch(MatchPhase.GAME_OVER, 0, 55.1, 44.9, 'turf_war', false);
    expect(timer().textContent).not.toContain(t('hud.overtime'));
    expect(timer().classList.contains('overtime')).toBe(false);
  });

  it('re-renders the overtime label in the newly selected language', () => {
    const hud = new HUD();
    hud.updateMatch(MatchPhase.PLAYING, 42, 50.2, 47.9, 'turf_war', true);
    const before = getLang();

    const next: Lang = before === 'ja' ? 'en' : 'ja';
    setLang(next); // fires ink:langchange -> HUD replays lastMatchArgs
    try {
      expect(timer().textContent).toContain(DICTIONARIES[next]['hud.overtime']);
      expect(timer().classList.contains('overtime')).toBe(true);
    } finally {
      setLang(before); // restore module state for later tests
    }
  });
});
