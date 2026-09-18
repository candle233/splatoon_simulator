import { describe, it, expect } from 'vitest';
import {
  Team,
  Vec3,
  enforceSpawnBarrier,
  PlayerSnapshot,
  PlayerMode
} from '@ink/shared';
import { SnapshotBuffer, interpolatePlayerState } from '../client/src/network/SnapshotBuffer.js';

describe('Advanced Features: Subagents 73-84', () => {
  describe('Subagent 80: Team Spawn Barrier Protection', () => {
    it('Blocks Cyan player from entering Pink home base spawn zone', () => {
      const targetPos: Vec3 = { x: -38, y: 1.0, z: 2 };
      const resolved = enforceSpawnBarrier(targetPos, Team.CYAN);
      expect(resolved.x).toBe(-35);
      expect(resolved.z).toBe(2);
    });

    it('Allows Pink player free movement in Pink home base', () => {
      const targetPos: Vec3 = { x: -40, y: 1.0, z: 2 };
      const resolved = enforceSpawnBarrier(targetPos, Team.PINK);
      expect(resolved.x).toBe(-40);
      expect(resolved.z).toBe(2);
    });

    it('Blocks Pink player from entering Cyan home base spawn zone', () => {
      const targetPos: Vec3 = { x: 39, y: 1.0, z: -4 };
      const resolved = enforceSpawnBarrier(targetPos, Team.PINK);
      expect(resolved.x).toBe(35);
      expect(resolved.z).toBe(-4);
    });

    it('Allows Cyan player free movement in Cyan home base', () => {
      const targetPos: Vec3 = { x: 42, y: 1.0, z: -4 };
      const resolved = enforceSpawnBarrier(targetPos, Team.CYAN);
      expect(resolved.x).toBe(42);
      expect(resolved.z).toBe(-4);
    });

    it('Does not block players along the flanks outside base Z corridor (|z| >= 10)', () => {
      const posA: Vec3 = { x: -38, y: 1.0, z: 15 };
      const resA = enforceSpawnBarrier(posA, Team.CYAN);
      expect(resA.x).toBe(-38);

      const posB: Vec3 = { x: 38, y: 1.0, z: -15 };
      const resB = enforceSpawnBarrier(posB, Team.PINK);
      expect(resB.x).toBe(38);
    });
  });

  describe('Subagent 79: Player Nameplate in SnapshotBuffer', () => {
    it('Preserves player names during snapshot interpolation', () => {
      const snap0: PlayerSnapshot = {
        id: 'p1',
        team: Team.PINK,
        name: 'SuperSquid',
        x: 0,
        y: 1,
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

      const snap1: PlayerSnapshot = {
        ...snap0,
        name: 'SuperSquid',
        x: 4,
        z: 4
      };

      const interpolated = interpolatePlayerState(snap0, snap1, 0.5);
      expect(interpolated.name).toBe('SuperSquid');
      expect(interpolated.position.x).toBe(2);
      expect(interpolated.position.z).toBe(2);
    });

    it('Snaps immediately when position jump exceeds teleport threshold', () => {
      const snap0: PlayerSnapshot = {
        id: 'p1',
        team: Team.PINK,
        name: 'TeleportSquid',
        x: 0,
        y: 1,
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

      const snap1: PlayerSnapshot = {
        ...snap0,
        name: 'TeleportSquid',
        x: 30,
        z: 30
      };

      const snapped = interpolatePlayerState(snap0, snap1, 0.5);
      expect(snapped.name).toBe('TeleportSquid');
      expect(snapped.position.x).toBe(30);
      expect(snapped.position.z).toBe(30);
    });
  });
});
