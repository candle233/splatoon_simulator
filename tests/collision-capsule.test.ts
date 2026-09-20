import { describe, expect, it } from 'vitest';
import { PLAYER_HEIGHT, PlayerMode, SQUID_HEIGHT } from '@ink/shared';
import { intersectRayCapsule } from '@ink/shared';

const BASE = { x: 0, y: 0, z: 0 };
const R = 0.5;

/** Horizontal ray aimed at (0, targetY, 0) from x=-10, +x direction. */
function rayAtY(targetY: number) {
  return { origin: { x: -10, y: targetY, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
}

/**
 * Hits at t = 10 when targetY is inside the capsule's vertical span:
 * - human: [y=-R, y=PLAYER_HEIGHT+R] = [-0.5, 2.3]  (caps extend ±radius above/below cylinder)
 * - squid: [y=-R, y=SQUID_HEIGHT+R] = [-0.5, 1.0]
 *
 * We only need to confirm HIT vs MISS at a targetY clearly within or outside.
 */
function expectHit(ray: ReturnType<typeof rayAtY>, hitHeight: number) {
  const t = intersectRayCapsule(ray as any, BASE, R, hitHeight);
  expect(t).not.toBeNull();
  expect(t as number).toBeGreaterThan(9); // hit on cap before cylinder body
}

function expectMiss(ray: ReturnType<typeof rayAtY>, hitHeight: number) {
  expect(intersectRayCapsule(ray as any, BASE, R, hitHeight)).toBeNull();
}

describe('intersectRayCapsule — humanoid vs. squid height', () => {
  it('human hits at waist (y=PLAYER_HEIGHT/2)', () =>
    expectHit(rayAtY(PLAYER_HEIGHT / 2), PLAYER_HEIGHT));

  it('human hits at head top (y=PLAYER_HEIGHT)', () =>
    expectHit(rayAtY(PLAYER_HEIGHT), PLAYER_HEIGHT));

  it('human hits at ground (y=0)', () =>
    expectHit(rayAtY(0), PLAYER_HEIGHT));

  it('human misses from above (y=PLAYER_HEIGHT + R + 0.1)', () =>
    expectMiss(rayAtY(PLAYER_HEIGHT + R + 0.1), PLAYER_HEIGHT));

  it('human misses from below (y=-R - 0.1)', () =>
    expectMiss(rayAtY(-R - 0.1), PLAYER_HEIGHT));

  it('squid hits at center (y=SQUID_HEIGHT/2)', () =>
    expectHit(rayAtY(SQUID_HEIGHT / 2), SQUID_HEIGHT));

  it('squid hits at top (y=SQUID_HEIGHT)', () =>
    expectHit(rayAtY(SQUID_HEIGHT), SQUID_HEIGHT));

  it('squid misses from above (y=SQUID_HEIGHT + R + 0.1)', () =>
    expectMiss(rayAtY(SQUID_HEIGHT + R + 0.1), SQUID_HEIGHT));

  it('squid misses from below (y=-R - 0.1)', () =>
    expectMiss(rayAtY(-R - 0.1), SQUID_HEIGHT));

  it('squid is easier to miss from above than human', () => {
    // y=1.0 is inside human capsule but outside squid capsule (squid top = 0.5+0.5=1.0,
    // but we add 0.1 safety margin → still inside squid top cap, so let's use y=1.1)
    expectHit(rayAtY(1.0), PLAYER_HEIGHT);
    expectHit(rayAtY(1.0), SQUID_HEIGHT); // right on the edge of squid top cap
    expectMiss(rayAtY(1.1), SQUID_HEIGHT);
  });
});

describe('PlayerMode maps to correct height', () => {
  function hitHeight(mode: PlayerMode): number {
    return mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;
  }
  it('HUMANOID → PLAYER_HEIGHT', () =>
    expect(hitHeight(PlayerMode.HUMANOID)).toBe(PLAYER_HEIGHT));
  it('SUBMERGED → SQUID_HEIGHT', () =>
    expect(hitHeight(PlayerMode.SUBMERGED)).toBe(SQUID_HEIGHT));
  it('DEAD → PLAYER_HEIGHT (dead hitbox still uses human height for ground-level checks)',
    () => expect(hitHeight(PlayerMode.DEAD)).toBe(PLAYER_HEIGHT));
});
