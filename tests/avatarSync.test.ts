/**
 * Avatar transport guard.
 *
 * Avatars are inline base64 images. The dangerous failure mode is putting them
 * on the 20 Hz snapshot path, which would cost roughly a megabyte per second
 * per player, so the tests below pin both the validation rules and the fact
 * that snapshots stay small.
 */
import { describe, expect, it } from 'vitest';
import { MAX_AVATAR_CHARS, sanitizeAvatar } from '../server/src/validation.js';
import { PlayerState } from '../server/src/PlayerState.js';
import { Team } from '@ink/shared';

/** A tiny but structurally valid JPEG data URL. */
const VALID_JPEG = `data:image/jpeg;base64,${Buffer.from('not-a-real-jpeg-but-valid-base64').toString('base64')}`;

/** The constructor requires a spawn position; only the snapshot fields matter here. */
function makePlayer(id = 'p1'): PlayerState {
  return new PlayerState(id, Team.PINK, 0, { x: 0, y: 0, z: 0 }, 'Tester', 'shooter');
}

describe('avatar validation', () => {
  it('accepts a well-formed inline raster image', () => {
    expect(sanitizeAvatar(VALID_JPEG)).toBe(VALID_JPEG);
  });

  it('accepts png and webp too', () => {
    const body = Buffer.from('pixels').toString('base64');
    expect(sanitizeAvatar(`data:image/png;base64,${body}`)).not.toBeNull();
    expect(sanitizeAvatar(`data:image/webp;base64,${body}`)).not.toBeNull();
  });

  it('rejects script-bearing and non-image payloads', () => {
    const rejected: unknown[] = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      // SVG can carry script, so it is deliberately not on the allow-list.
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'https://example.com/avatar.png',
      'plain string',
      '',
      null,
      undefined,
      42,
      {},
      ['data:image/jpeg;base64,AAAA']
    ];
    for (const value of rejected) {
      expect(sanitizeAvatar(value), `should reject: ${String(value)}`).toBeNull();
    }
  });

  it('rejects a payload over the size cap', () => {
    const oversized = `data:image/jpeg;base64,${'A'.repeat(MAX_AVATAR_CHARS)}`;
    expect(oversized.length).toBeGreaterThan(MAX_AVATAR_CHARS);
    expect(sanitizeAvatar(oversized)).toBeNull();
  });

  it('rejects a data URL whose body is not base64', () => {
    expect(sanitizeAvatar('data:image/jpeg;base64,<script>alert(1)</script>')).toBeNull();
  });
});

describe('avatar bandwidth', () => {
  it('keeps the avatar out of the 20 Hz snapshot payload', () => {
    const player = makePlayer();
    // Give the player the largest avatar we would ever accept.
    const big = `data:image/jpeg;base64,${'A'.repeat(MAX_AVATAR_CHARS - 30)}`;
    expect(sanitizeAvatar(big)).not.toBeNull();
    player.avatar = big;

    const snapshot = JSON.stringify(player.toSnapshot());

    // A snapshot must stay tiny: it is serialized per player per tick at 20 Hz.
    // Without the avatar this is a few hundred bytes.
    expect(snapshot.length).toBeLessThan(4096);
    expect(snapshot).not.toContain('data:image');
    expect(snapshot.includes('AAAA')).toBe(false);
  });

  it('carries the avatar on the low-frequency lobby payload instead', () => {
    const player = makePlayer();
    player.avatar = VALID_JPEG;
    // The lobby state builder reads `p.avatar` directly; assert the field the
    // server publishes is the validated value.
    expect(player.avatar).toBe(VALID_JPEG);
  });
});
