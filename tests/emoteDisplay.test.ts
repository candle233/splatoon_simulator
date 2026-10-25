import { describe, it, expect, beforeEach } from 'vitest';
import { Team } from '@ink/shared';
import { MAX_EMOTE_BUBBLES, EmoteDisplay } from '../client/src/ui/EmoteDisplay.js';

/**
 * EmoteDisplay pooling tests. The class needs a DOM, so these run with a
 * minimal stub: the module only uses getElementById / createElement / append
 * / classList / style, which happy-dom-style shims are overkill for — instead
 * we exercise the pure pooling contract through a real DOM-less harness by
 * importing the class and stubbing the container via the exported max.
 *
 * The file is marked with @vitest-environment happy-dom when that package is
 * available; otherwise the assertions on pool bookkeeping still hold because
 * the class creates its own container when missing.
 *
 * @vitest-environment happy-dom
 */

function makeDisplay(): EmoteDisplay {
  return new EmoteDisplay();
}

function bubbleRoots(display: EmoteDisplay): HTMLElement[] {
  const layer = document.getElementById('emote-layer');
  if (!layer) return [];
  return Array.from(layer.children) as HTMLElement[];
}

describe('EmoteDisplay pooling', () => {
  beforeEach(() => {
    // EmoteDisplay mounts its layer inside #game-container (missing in happy-dom).
    document.body.innerHTML = '<div id="game-container"></div>';
  });

  it('creates exactly MAX_EMOTE_BUBBLES pooled nodes', () => {
    const display = makeDisplay();
    const roots = bubbleRoots(display);
    expect(roots.length).toBe(MAX_EMOTE_BUBBLES);
    for (const root of roots) {
      expect(root.className).toContain('hidden');
    }
  });

  it('show() activates one bubble with the sender name and localized text', () => {
    const display = makeDisplay();
    display.show('p1', 'Alice', Team.PINK, 'booyah', 1, 2, 3);
    const roots = bubbleRoots(display);
    const active = roots.filter((r) => !r.className.includes('hidden'));
    expect(active.length).toBe(1);
    expect(active[0]!.className).toContain('emote-booyah');
    expect(active[0]!.className).toContain('team-pink');
    const name = active[0]!.querySelector('.emote-name');
    expect(name?.textContent).toBe('Alice');
    const text = active[0]!.querySelector('.emote-text');
    expect(text?.textContent).toContain('⭐');
  });

  it('reuses the same sender bubble when they spam instead of consuming a second slot', () => {
    const display = makeDisplay();
    display.show('p1', 'Alice', Team.PINK, 'booyah', 1, 2, 3);
    display.show('p1', 'Alice', Team.PINK, 'booyah', 2, 2, 3);
    const roots = bubbleRoots(display);
    const active = roots.filter((r) => !r.className.includes('hidden'));
    expect(active.length).toBe(1);
    // Still shows Alice (the spam reused her bubble rather than stealing one).
    expect(active[0]!.querySelector('.emote-name')?.textContent).toBe('Alice');
  });

  it('different senders get different bubbles', () => {
    const display = makeDisplay();
    display.show('p1', 'Alice', Team.PINK, 'booyah', 1, 2, 3);
    display.show('p2', 'Bob', Team.CYAN, 'ouch', 4, 5, 6);
    const roots = bubbleRoots(display);
    const active = roots.filter((r) => !r.className.includes('hidden'));
    expect(active.length).toBe(2);
  });

  it('pool cap: the 9th distinct sender steals the oldest bubble', () => {
    const display = makeDisplay();
    for (let i = 0; i < MAX_EMOTE_BUBBLES; i++) {
      display.show(`p${i}`, `Player${i}`, Team.PINK, 'booyah', i, 0, 0);
    }
    // All MAX bubbles active; p0 was born first.
    display.show('newbie', 'Newbie', Team.CYAN, 'ping_area', 0, 0, 0);
    const roots = bubbleRoots(display);
    const active = roots.filter((r) => !r.className.includes('hidden'));
    expect(active.length).toBe(MAX_EMOTE_BUBBLES);
    // p0's bubble should have been stolen by 'newbie'
    const texts = active.map((r) => r.querySelector('.emote-name')?.textContent);
    expect(texts).toContain('Newbie');
    expect(texts).not.toContain('Player0');
  });

  it('update() expires bubbles past their lifetime (CSS lifetime = 2400ms)', async () => {
    const display = makeDisplay();
    display.show('p1', 'Alice', Team.PINK, 'booyah', 1, 2, 3);
    // Projector: always on-screen at (100, 100); head resolver: known position.
    const project = (
      _x: number,
      _y: number,
      _z: number,
      out: { x: number; y: number; visible: boolean }
    ) => {
      out.x = 100;
      out.y = 100;
      out.visible = true;
      return out;
    };
    const resolveHead = (_id: string, out: { x: number; y: number; z: number }) => {
      out.x = 1;
      out.y = 2;
      out.z = 3;
      return true;
    };
    display.update(performance.now(), project, resolveHead);
    // Advance past the 2400ms lifetime, then update again — bubble expires.
    await new Promise((r) => setTimeout(r, 2500));
    display.update(performance.now() + 2500, project, resolveHead);
    const roots = bubbleRoots(display);
    const stillActive = roots.filter((r) => !r.className.includes('hidden'));
    expect(stillActive.length).toBe(0);
  });
});
