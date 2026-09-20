import { MatchPhase } from '@ink/shared';

/**
 * Single arbiter for the full-screen overlays that are mutually exclusive.
 *
 * The title screen, the lobby, the game-over summary and the pointer-lock
 * prompt must never be visible at the same time: they are full-viewport
 * overlays, so whichever one sits on top silently swallows every click meant
 * for the others (the "cannot select a weapon after a refresh" bug was exactly
 * that: the title screen, z-index 60, stayed on top of the lobby).
 *
 * Every screen routes its visibility through this manager, and `show()`
 * guarantees the invariant by construction: it hides every other screen it
 * owns before revealing the requested one, so a caller cannot create the
 * overlap by forgetting a `hide()`. The visible screen also carries
 * `.screen-active` (see style.css), which puts it above the other overlay
 * layers and guarantees it receives pointer input.
 */

/** DOM ids of the screens this manager arbitrates. */
export const SCREEN_ELEMENT_IDS = {
  title: 'title-screen',
  lobby: 'lobby-screen',
  gameOver: 'game-over-screen',
  pointerPrompt: 'pointer-lock-prompt'
} as const;

export type ScreenId = keyof typeof SCREEN_ELEMENT_IDS;

/** Every managed screen id, in DOM order. */
export const SCREEN_IDS = Object.keys(SCREEN_ELEMENT_IDS) as ScreenId[];

/** Class that hides an overlay (`display: none !important`). */
export const HIDDEN_CLASS = 'hidden';
/** Class marking the one visible screen: on top, and interactive. */
export const ACTIVE_SCREEN_CLASS = 'screen-active';

/**
 * The minimal element surface the manager needs. Declared structurally so the
 * exclusivity invariant can be unit-tested with a plain fake (the test suite
 * runs in the node environment, without a DOM).
 */
export interface ScreenElementLike {
  classList: {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
    contains(token: string): boolean;
  };
}

export type ScreenElementResolver = (id: string) => ScreenElementLike | null;

function resolveInDocument(id: string): ScreenElementLike | null {
  if (typeof document === 'undefined') return null;
  return (document.getElementById(id) as ScreenElementLike | null) ?? null;
}

/**
 * Pure invariant check: which of the given screens are currently visible.
 * Exactly zero or one id may come back — anything else means two screens are
 * fighting over the same clicks.
 */
export function visibleScreenIds(
  screens: Iterable<readonly [ScreenId, ScreenElementLike]>
): ScreenId[] {
  const visible: ScreenId[] = [];
  for (const [id, el] of screens) {
    if (!el.classList.contains(HIDDEN_CLASS)) visible.push(id);
  }
  return visible;
}

export interface ScreenManagerOptions {
  /** Element lookup; defaults to `document.getElementById`. */
  resolve?: ScreenElementResolver;
  /**
   * Screen made visible at construction, normalizing whatever the markup
   * shipped with. Defaults to the title screen; pass `null` to leave the
   * elements untouched.
   */
  initial?: ScreenId | null;
}

export class ScreenManager {
  private readonly screens = new Map<ScreenId, ScreenElementLike>();
  private activeId: ScreenId | null = null;

  constructor(options: ScreenManagerOptions = {}) {
    const resolve = options.resolve ?? resolveInDocument;
    for (const id of SCREEN_IDS) {
      const el = resolve(SCREEN_ELEMENT_IDS[id]);
      if (el) this.screens.set(id, el);
    }
    const initial = options.initial === undefined ? 'title' : options.initial;
    if (initial) this.show(initial);
  }

  /**
   * Reveals one screen and hides every other screen this manager owns, so the
   * exclusivity invariant holds no matter what the caller forgot to hide.
   * Returns false when the screen has no element in the document.
   */
  show(id: ScreenId): boolean {
    const target = this.screens.get(id);
    if (!target) return false;
    for (const [otherId, el] of this.screens) {
      if (otherId !== id) this.setVisible(el, false);
    }
    this.setVisible(target, true);
    this.activeId = id;
    return true;
  }

  hide(id: ScreenId): void {
    const el = this.screens.get(id);
    if (!el) return;
    this.setVisible(el, false);
    if (this.activeId === id) this.activeId = null;
  }

  /** Hides every managed screen (nothing visible: the arena owns the viewport). */
  hideAll(): void {
    for (const el of this.screens.values()) this.setVisible(el, false);
    this.activeId = null;
  }

  isVisible(id: ScreenId): boolean {
    const el = this.screens.get(id);
    return !!el && !el.classList.contains(HIDDEN_CLASS);
  }

  /** True when any of the given screens is the visible one. */
  isAnyVisible(ids: readonly ScreenId[]): boolean {
    return ids.some((id) => this.isVisible(id));
  }

  /** All currently visible screens; at most one, by construction. */
  visibleIds(): ScreenId[] {
    return visibleScreenIds(this.screens);
  }

  getActiveId(): ScreenId | null {
    return this.activeId;
  }

  private setVisible(el: ScreenElementLike, visible: boolean): void {
    if (visible) {
      el.classList.remove(HIDDEN_CLASS);
      el.classList.add(ACTIVE_SCREEN_CLASS);
    } else {
      el.classList.add(HIDDEN_CLASS);
      el.classList.remove(ACTIVE_SCREEN_CLASS);
    }
  }
}

/** What the current match phase wants on screen. */
export type ScreenRoute =
  | { kind: 'hideAll'; requestPointerLock: boolean }
  | { kind: 'show'; id: ScreenId }
  | { kind: 'hide'; id: ScreenId }
  | { kind: 'none' };

export interface ScreenRouteContext {
  /** True when a menu screen (title or lobby) was visible before this phase. */
  menuVisible: boolean;
}

/**
 * Pure decision table mapping a match phase to the screen it wants. Lives here
 * (rather than inline in Game.ts) so the routing rule is unit-testable without
 * a DOM.
 *
 * - COUNTDOWN / PLAYING: a match owns the viewport, every menu screen goes away.
 * - GAME_OVER: the summary must not sit under the title screen (the manager
 *   shows the summary itself; only the title has to be cleared here).
 * - WAITING after anything else: coming back from a match lands in the lobby.
 *   A client that was already in WAITING keeps whatever it shows — that is the
 *   title screen at first load, before the player has entered the lobby.
 */
export function screenRouteForPhase(
  phase: MatchPhase,
  prevPhase: MatchPhase,
  context: ScreenRouteContext
): ScreenRoute {
  if (phase === MatchPhase.COUNTDOWN || phase === MatchPhase.PLAYING) {
    return { kind: 'hideAll', requestPointerLock: context.menuVisible };
  }
  if (phase === MatchPhase.GAME_OVER) {
    return { kind: 'hide', id: 'title' };
  }
  if (phase === MatchPhase.WAITING && prevPhase !== MatchPhase.WAITING) {
    return { kind: 'show', id: 'lobby' };
  }
  return { kind: 'none' };
}
