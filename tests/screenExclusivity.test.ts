import { describe, expect, it } from 'vitest';
import { MatchPhase } from '@ink/shared';
import {
  ACTIVE_SCREEN_CLASS,
  HIDDEN_CLASS,
  SCREEN_ELEMENT_IDS,
  SCREEN_IDS,
  ScreenElementLike,
  ScreenManager,
  screenRouteForPhase,
  visibleScreenIds
} from '../client/src/ui/ScreenManager.js';

/**
 * Minimal stand-in for a DOM element: just the class list the manager touches.
 * The suite runs in the node environment, so the manager is constructed with an
 * injected resolver instead of a real document.
 */
function makeElement(): ScreenElementLike & { tokens: Set<string> } {
  const tokens = new Set<string>([HIDDEN_CLASS]);
  return {
    tokens,
    classList: {
      add: (...t) => t.forEach((t2) => tokens.add(t2)),
      remove: (...t) => t.forEach((t2) => tokens.delete(t2)),
      contains: (t) => tokens.has(t)
    }
  };
}

function makeManager(initial?: Parameters<typeof ScreenManager>[0] extends undefined ? never : string | null) {
  const elements = new Map<string, ReturnType<typeof makeElement>>();
  for (const id of SCREEN_IDS) elements.set(SCREEN_ELEMENT_IDS[id], makeElement());
  const manager = new ScreenManager({
    resolve: (id) => elements.get(id) ?? null,
    initial: (initial ?? 'title') as never
  });
  return { manager, elements };
}

describe('ScreenManager: overlay exclusivity', () => {
  it('shows exactly one screen at construction', () => {
    const { manager } = makeManager('title');
    expect(manager.visibleIds()).toEqual(['title']);
    expect(manager.getActiveId()).toBe('title');
  });

  it('hides every other screen when one is shown', () => {
    const { manager } = makeManager('title');
    manager.show('lobby');
    expect(manager.visibleIds()).toEqual(['lobby']);
    expect(manager.isVisible('title')).toBe(false);
  });

  it('cannot be driven into the two-screens-visible state', () => {
    const { manager } = makeManager('title');
    // Every show, in every order, must leave at most one screen visible.
    for (const first of SCREEN_IDS) {
      for (const second of SCREEN_IDS) {
        manager.show(first);
        manager.show(second);
        expect(manager.visibleIds()).toEqual([second]);
      }
    }
  });

  it('regression: showing the lobby over a visible title clears the title', () => {
    // The original bug: the title screen (z-index 60) stayed visible on top of
    // the lobby (z-index 25) and swallowed every click, so weapons could not be
    // selected after a refresh. The manager must make that state unreachable.
    const { manager, elements } = makeManager('title');
    expect(manager.isVisible('title')).toBe(true);

    manager.show('lobby');

    expect(manager.isVisible('title')).toBe(false);
    expect(manager.isVisible('lobby')).toBe(true);
    const titleTokens = elements.get(SCREEN_ELEMENT_IDS.title)!.tokens;
    expect(titleTokens.has(HIDDEN_CLASS)).toBe(true);
    expect(titleTokens.has(ACTIVE_SCREEN_CLASS)).toBe(false);
  });

  it('marks only the visible screen as active, so it owns pointer input', () => {
    const { manager, elements } = makeManager('title');
    manager.show('lobby');
    for (const id of SCREEN_IDS) {
      const tokens = elements.get(SCREEN_ELEMENT_IDS[id])!.tokens;
      expect(tokens.has(ACTIVE_SCREEN_CLASS)).toBe(id === 'lobby');
    }
  });

  it('hideAll clears every screen and the active marker', () => {
    const { manager } = makeManager('title');
    manager.show('lobby');
    manager.hideAll();
    expect(manager.visibleIds()).toEqual([]);
    expect(manager.getActiveId()).toBeNull();
  });

  it('tolerates a missing element without throwing', () => {
    const manager = new ScreenManager({ resolve: () => null, initial: null });
    expect(manager.show('lobby')).toBe(false);
    expect(manager.visibleIds()).toEqual([]);
  });

  it('reports visible screens through the pure helper', () => {
    const { manager, elements } = makeManager('title');
    const pairs = SCREEN_IDS.map(
      (id) => [id, elements.get(SCREEN_ELEMENT_IDS[id])!] as const
    );
    expect(visibleScreenIds(pairs)).toEqual(['title']);
  });
});

describe('screenRouteForPhase: match phase to screen routing', () => {
  const menuVisible = { menuVisible: true };
  const menuHidden = { menuVisible: false };

  it('clears all menus when a match owns the viewport', () => {
    expect(screenRouteForPhase(MatchPhase.COUNTDOWN, MatchPhase.WAITING, menuVisible)).toEqual({
      kind: 'hideAll',
      requestPointerLock: true
    });
    expect(screenRouteForPhase(MatchPhase.PLAYING, MatchPhase.WAITING, menuVisible)).toEqual({
      kind: 'hideAll',
      requestPointerLock: true
    });
  });

  it('does not steal the pointer when no menu was showing', () => {
    expect(screenRouteForPhase(MatchPhase.PLAYING, MatchPhase.WAITING, menuHidden)).toEqual({
      kind: 'hideAll',
      requestPointerLock: false
    });
  });

  it('clears the title when the game-over summary appears', () => {
    expect(screenRouteForPhase(MatchPhase.GAME_OVER, MatchPhase.PLAYING, menuHidden)).toEqual({
      kind: 'hide',
      id: 'title'
    });
  });

  it('returns to the lobby when a match ends and the phase resets to WAITING', () => {
    // This is the refresh-mid-match path: the lobby must come back as the one
    // visible screen, never layered under the title.
    expect(screenRouteForPhase(MatchPhase.WAITING, MatchPhase.GAME_OVER, menuHidden)).toEqual({
      kind: 'show',
      id: 'lobby'
    });
  });

  it('leaves the first load alone: WAITING with no phase change keeps the title', () => {
    expect(screenRouteForPhase(MatchPhase.WAITING, MatchPhase.WAITING, menuHidden)).toEqual({
      kind: 'none'
    });
  });
});
