import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerMode, Team } from '@ink/shared';
import {
  HEADGEAR_COUNT,
  OUTFIT_COUNT,
  TANK_COUNT,
  PlayerView,
  selectCosmetics
} from '../client/src/player/PlayerView.js';

/** Mirrors the id hash used by Game.ts so the tests exercise the real input shape. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

function visibleMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    let node: THREE.Object3D | null = obj;
    while (node) {
      if (!node.visible) return;
      node = node.parent;
    }
    count++;
  });
  return count;
}

describe('PlayerView cosmetics: deterministic layered selection', () => {
  it('maps a variant hash to one in-range index per layer', () => {
    for (const variant of [0, 1, 7, 255, 65535, 123456789, 0xffffffff, -42, 3.9]) {
      const sel = selectCosmetics(variant);
      expect(sel.headgear).toBeGreaterThanOrEqual(0);
      expect(sel.headgear).toBeLessThan(HEADGEAR_COUNT);
      expect(sel.outfit).toBeGreaterThanOrEqual(0);
      expect(sel.outfit).toBeLessThan(OUTFIT_COUNT);
      expect(sel.tank).toBeGreaterThanOrEqual(0);
      expect(sel.tank).toBeLessThan(TANK_COUNT);
      expect(Number.isInteger(sel.headgear)).toBe(true);
      expect(Number.isInteger(sel.outfit)).toBe(true);
      expect(Number.isInteger(sel.tank)).toBe(true);
    }
  });

  it('is stable: the same player id always yields the same look', () => {
    const ids = ['p1', 'player-2', 'bot:7', 'AlphaSquid', 'zzzzzzzz', ''];
    for (const id of ids) {
      const hash = hashId(id);
      const first = selectCosmetics(hash);
      for (let i = 0; i < 8; i++) {
        expect(selectCosmetics(hash)).toEqual(first);
      }
      // and again through a fresh hash of the same id
      expect(selectCosmetics(hashId(id))).toEqual(first);
    }
  });

  it('spreads different player ids across every variant of every layer', () => {
    const ids: string[] = [];
    for (let i = 0; i < 400; i++) ids.push(`player-${i}`);

    const headgear = new Set<number>();
    const outfit = new Set<number>();
    const tank = new Set<number>();
    for (const id of ids) {
      const sel = selectCosmetics(hashId(id));
      headgear.add(sel.headgear);
      outfit.add(sel.outfit);
      tank.add(sel.tank);
    }

    expect(headgear.size).toBe(HEADGEAR_COUNT);
    expect(outfit.size).toBe(OUTFIT_COUNT);
    expect(tank.size).toBe(TANK_COUNT);
  });

  it('does not correlate the layers: the combined look space is well covered', () => {
    const combos = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const sel = selectCosmetics(hashId(`squid-${i}`));
      combos.add(`${sel.headgear}|${sel.outfit}|${sel.tank}`);
    }
    // 6 * 5 * 5 = 150 distinct looks; a well-mixed hash should reach most of them
    expect(combos.size).toBeGreaterThan(100);
  });

  it('handles non-finite hashes without throwing', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const sel = selectCosmetics(bad);
      expect(sel.headgear).toBeGreaterThanOrEqual(0);
      expect(sel.headgear).toBeLessThan(HEADGEAR_COUNT);
    }
  });
});

describe('PlayerView cosmetics: applied to real Three.js objects', () => {
  it('builds a detailed fighter in a plain Node environment', () => {
    const view = new PlayerView(Team.PINK);
    view.applyCosmeticVariant(hashId('player-3'));
    view.setWeaponType('shooter');
    view.setMode(PlayerMode.HUMANOID);

    expect(visibleMeshes(view.group)).toBeGreaterThan(40);
    expect(view.getCosmeticSelection()).toEqual(selectCosmetics(hashId('player-3')));
    view.dispose();
  });

  it('selects the same layers for the same id and different layers across ids', () => {
    const a = new PlayerView(Team.PINK);
    const b = new PlayerView(Team.CYAN);
    a.applyCosmeticVariant(hashId('alpha'));
    b.applyCosmeticVariant(hashId('alpha'));
    expect(a.getCosmeticSelection()).toEqual(b.getCosmeticSelection());

    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const view = new PlayerView(Team.PINK);
      view.applyCosmeticVariant(hashId(`spread-${i}`));
      const sel = view.getCosmeticSelection();
      seen.add(`${sel.headgear}|${sel.outfit}|${sel.tank}`);
      expect(sel.outfit).toBeLessThan(OUTFIT_COUNT);
      view.dispose();
    }
    expect(seen.size).toBeGreaterThan(10);

    a.dispose();
    b.dispose();
  });

  it('ignores repeated cosmetic applications (variant is applied once)', () => {
    const view = new PlayerView(Team.PINK);
    view.applyCosmeticVariant(hashId('first'));
    const applied = view.getCosmeticSelection();
    view.applyCosmeticVariant(hashId('second'));
    expect(view.getCosmeticSelection()).toEqual(applied);
    view.dispose();
  });

  it('keeps every cosmetic variant renderable across weapons and forms', () => {
    const weapons = ['shooter', 'roller', 'charger', 'slosher'] as const;
    const modes = [PlayerMode.HUMANOID, PlayerMode.SUBMERGED, PlayerMode.DEAD];

    for (let variant = 0; variant < HEADGEAR_COUNT * OUTFIT_COUNT * TANK_COUNT; variant += 17) {
      const view = new PlayerView(Team.CYAN);
      view.applyCosmeticVariant(hashId(`variant-${variant}`));
      for (const weapon of weapons) {
        view.setWeaponType(weapon);
        for (const mode of modes) {
          view.setMode(mode);
          view.updateLocomotion(0.016, 4, true, 0.2);
          view.updateVisuals(false, 1.5, 45);
          expect(visibleMeshes(view.group)).toBeGreaterThan(0);
        }
      }
      view.triggerRecoil();
      view.dispose();
    }
  });

  it('survives create/dispose cycles without leaking shared geometry', () => {
    for (let cycle = 0; cycle < 6; cycle++) {
      const views: PlayerView[] = [];
      for (let i = 0; i < 4; i++) {
        const view = new PlayerView(i % 2 === 0 ? Team.PINK : Team.CYAN);
        view.applyCosmeticVariant(hashId(`cycle-${cycle}-${i}`));
        view.updateLocomotion(0.016, 5, true, 0);
        views.push(view);
      }
      for (const view of views) view.dispose();
    }
    // Rebuild after every view is gone: the shared cache must come back clean.
    const after = new PlayerView(Team.PINK);
    after.applyCosmeticVariant(hashId('after-cycles'));
    expect(visibleMeshes(after.group)).toBeGreaterThan(40);
    after.dispose();
  });

  it('exposes a muzzle position derived from the weapon anchor', () => {
    const view = new PlayerView(Team.PINK);
    view.setWeaponType('shooter');
    view.setTransform({ x: 1, y: 0, z: 2 }, 0, 0);
    view.group.updateMatrixWorld(true);

    const target = new THREE.Vector3();
    view.getMuzzleWorldPosition(target);

    // Local muzzle offset is (0, 0, -0.6) from the weapon anchor, which sits at
    // (0.32, 0.85, -0.3) inside the humanoid group at world (1, 0, 2).
    expect(target.x).toBeCloseTo(1.32, 5);
    expect(target.y).toBeCloseTo(0.85, 5);
    expect(target.z).toBeCloseTo(1.1, 5);
    view.dispose();
  });
});
