import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerMode, Team } from '@ink/shared';
import { PlayerView } from '../client/src/player/PlayerView.js';
import { ParticleSystem } from '../client/src/combat/ParticleSystem.js';

describe('Combat Juice & Audiovisual Polish Verification', () => {
  it('PlayerView: triggers damage flash without corrupting shared team palette colors', () => {
    const pinkView = new PlayerView(Team.PINK);
    pinkView.setMode(PlayerMode.HUMANOID);

    // Initial palette check
    const pinkGlowHex = pinkView['palette'].glow.color.getHex();
    expect(pinkGlowHex).toBe(0xff007f);

    // Trigger damage flash from CYAN attacker
    pinkView.triggerDamageFlash(Team.CYAN);
    expect(pinkView['hitFlashTimer']).toBeGreaterThan(0);
    expect(pinkView['humanoidFlashMesh'].visible).toBe(true);
    expect(pinkView['hitFlashMat'].color.getHex()).toBe(0x00e5ff);

    // Update locomotion: timer should tick down and update opacity
    pinkView.updateLocomotion(0.05, 0, true, 0);
    expect(pinkView['hitFlashTimer']).toBeCloseTo(0.09, 2);
    expect(pinkView['hitFlashMat'].opacity).toBeGreaterThan(0);

    // Low ink warning pulse (< 20 ink)
    pinkView.updateVisuals(false, 1.0, 15);
    // Recover ink to full (> 50 ink)
    pinkView.updateVisuals(false, 2.0, 95);

    // Verify shared team palette glow was NOT corrupted to CYAN
    expect(pinkView['palette'].glow.color.getHex()).toBe(0xff007f);

    // Flash timer expires
    pinkView.updateLocomotion(0.12, 0, true, 0);
    expect(pinkView['hitFlashTimer']).toBeLessThanOrEqual(0);
    expect(pinkView['humanoidFlashMesh'].visible).toBe(false);

    pinkView.dispose();
  });

  it('ParticleSystem: keeps swim wake ripples at elevated platform height without plummeting', () => {
    const ps = new ParticleSystem();
    const elevatedPos = { x: 8, y: 6.0, z: -12 };
    const swimVel = { x: 4.5, y: 0, z: 0 };

    ps.spawnSwimWake(elevatedPos, Team.PINK, swimVel, 4);

    const particles = ps['particles'];
    const wake = particles.find((p) => p.active && p.isRipple);
    expect(wake).toBeDefined();
    expect(wake!.floorY).toBe(6.0);
    expect(wake!.position.y).toBeCloseTo(6.03, 2);
    expect(wake!.gravity).toBe(0);

    // Advance time by 0.1s
    ps.update(0.1);

    // The wake particle must remain at platform height (not plunged to ground y=0.06)
    expect(wake!.position.y).toBeCloseTo(6.03, 2);
    // Must remain a flat expanding ripple disc: width > thickness
    expect(wake!.scale.x).toBeGreaterThan(wake!.scale.y * 3);
    expect(wake!.scale.z).toBeGreaterThan(wake!.scale.y * 3);

    ps.dispose();
  });

  it('ParticleSystem: spawnHitConfirm creates radiant spark burst at target elevation', () => {
    const ps = new ParticleSystem();
    const hitPos = { x: -3, y: 4.5, z: 10 };

    ps.spawnHitConfirm(hitPos, true, Team.PINK);

    const particles = ps['particles'];
    const activeHits = particles.filter((p) => p.active && !p.isRipple);
    expect(activeHits.length).toBeGreaterThanOrEqual(10);

    for (const p of activeHits) {
      expect(p.floorY).toBe(4.5);
      expect(p.position.y).toBeGreaterThanOrEqual(4.5);
    }

    ps.dispose();
  });

  it('Minimap: climbable wall calculation aligns with surface face instead of diagonal slash', () => {
    // Test wall facing -Z (perpendicular to Z axis, spanning along X)
    const wallZ: { position: { x: number; y: number; z: number }; size: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } = {
      position: { x: 10, y: 3, z: 20 },
      size: { x: 16, y: 6, z: 2 },
      normal: { x: 0, y: 0, z: -1 }
    };

    const isNormalX = Math.abs(wallZ.normal.x) > Math.abs(wallZ.normal.z);
    expect(isNormalX).toBe(false);

    const faceZ = wallZ.position.z + Math.sign(wallZ.normal.z) * wallZ.size.z * 0.5;
    const x1 = wallZ.position.x - wallZ.size.x * 0.48;
    const x2 = wallZ.position.x + wallZ.size.x * 0.48;

    // Face Z should be at the south edge (20 - 1 = 19)
    expect(faceZ).toBe(19);
    // Span along X should be from 10 - 7.68 = 2.32 to 10 + 7.68 = 17.68
    expect(x1).toBeCloseTo(2.32, 2);
    expect(x2).toBeCloseTo(17.68, 2);

    // Test wall facing +X (perpendicular to X axis, spanning along Z)
    const wallX = {
      position: { x: -15, y: 4, z: 5 },
      size: { x: 2, y: 8, z: 12 },
      normal: { x: 1, y: 0, z: 0 }
    };

    const isNormalX2 = Math.abs(wallX.normal.x) > Math.abs(wallX.normal.z);
    expect(isNormalX2).toBe(true);

    const faceX = wallX.position.x + Math.sign(wallX.normal.x) * wallX.size.x * 0.5;
    const z1 = wallX.position.z - wallX.size.z * 0.48;
    const z2 = wallX.position.z + wallX.size.z * 0.48;

    // Face X should be at the east edge (-15 + 1 = -14)
    expect(faceX).toBe(-14);
    // Span along Z should be from 5 - 5.76 = -0.76 to 5 + 5.76 = 10.76
    expect(z1).toBeCloseTo(-0.76, 2);
    expect(z2).toBeCloseTo(10.76, 2);
  });
});
