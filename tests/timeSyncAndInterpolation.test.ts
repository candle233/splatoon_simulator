import { describe, it, expect } from 'vitest';
import { TimeSynchronizer } from '../client/src/network/NetworkClient.js';
import { interpolatePlayerState } from '../client/src/network/SnapshotBuffer.js';
import { PlayerMode, PlayerSnapshot, Team } from '@ink/shared';

describe('Subagents 37 & 39: Time Synchronization & Snapshot Interpolation', () => {
  it('smooths server time offset using Exponential Moving Average (EMA)', () => {
    const syncer = new TimeSynchronizer(0.2);

    // Initial ping: t0 = 1000, server = 1500, t1 = 1040 (RTT = 40ms)
    // sampleOffset = 1500 - (1000 + 20) = 480ms
    const offset1 = syncer.update(1000, 1500, 1040);
    expect(offset1).toBe(480);
    expect(syncer.rtt).toBe(40);

    // Noisy ping with sudden spike: sampleOffset = 600ms
    // EMA = 0.2 * 600 + 0.8 * 480 = 120 + 384 = 504ms
    const offset2 = syncer.update(2000, 2650, 2100);
    expect(offset2).toBeCloseTo(504, 1);

    // Estimated server time evaluates to clientNow + offset
    const estimated = syncer.getEstimatedServerTime(3000);
    expect(estimated).toBeCloseTo(3000 + 504, 1);
  });

  it('interpolates positions smoothly between adjacent snapshots in normal movement', () => {
    const snapA: PlayerSnapshot = {
      id: 'p1',
      team: Team.PINK,
      x: 0,
      y: 1.0,
      z: 0,
      yaw: 0,
      pitch: 0,
      hp: 100,
      ink: 100,
      alive: true,
      mode: PlayerMode.HUMANOID,
      invulnerable: false,
      kills: 0,
      deaths: 0
    };

    const snapB: PlayerSnapshot = {
      ...snapA,
      x: 2.0,
      z: 4.0,
      yaw: 1.0
    };

    const mid = interpolatePlayerState(snapA, snapB, 0.5);
    expect(mid.position.x).toBeCloseTo(1.0, 3);
    expect(mid.position.y).toBeCloseTo(1.0, 3);
    expect(mid.position.z).toBeCloseTo(2.0, 3);
    expect(mid.yaw).toBeCloseTo(0.5, 3);
  });

  it('interpolates yaw along shortest arc across wrapping boundary (-PI to +PI)', () => {
    const snapA: PlayerSnapshot = {
      id: 'p1',
      team: Team.PINK,
      x: 0,
      y: 0,
      z: 0,
      yaw: 3.10, // ~ +177 deg
      pitch: 0,
      hp: 100,
      ink: 100,
      alive: true,
      mode: PlayerMode.HUMANOID,
      invulnerable: false,
      kills: 0,
      deaths: 0
    };

    const snapB: PlayerSnapshot = {
      ...snapA,
      yaw: -3.10 // ~ -177 deg
    };

    const mid = interpolatePlayerState(snapA, snapB, 0.5);
    // Shortest angular path wraps around +/- PI (total delta is ~0.08 rad)
    expect(Math.abs(Math.abs(mid.yaw) - Math.PI)).toBeLessThan(0.1);
  });

  it('snaps immediately without gliding across the arena upon respawn', () => {
    // Player died at (10, 0, 10)
    const deadSnap: PlayerSnapshot = {
      id: 'victim',
      team: Team.PINK,
      x: 10.0,
      y: 0,
      z: 10.0,
      yaw: 0,
      pitch: 0,
      hp: 0,
      ink: 0,
      alive: false,
      mode: PlayerMode.DEAD,
      invulnerable: false,
      kills: 0,
      deaths: 1
    };

    // Respawned at base (-40, 1.0, 0)
    const respawnSnap: PlayerSnapshot = {
      ...deadSnap,
      x: -40.0,
      y: 1.0,
      z: 0,
      hp: 100,
      ink: 100,
      alive: true,
      mode: PlayerMode.HUMANOID,
      invulnerable: true
    };

    // Even at alpha = 0.1 (early in the interpolation window), position must snap to (-40, 1.0, 0)
    const result = interpolatePlayerState(deadSnap, respawnSnap, 0.1);
    expect(result.position.x).toBe(-40.0);
    expect(result.position.y).toBe(1.0);
    expect(result.position.z).toBe(0);
    expect(result.alive).toBe(true);
  });
});
