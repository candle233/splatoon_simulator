import { describe, it, expect } from 'vitest';
import { PlayerState } from '../server/src/PlayerState.js';
import {
  Team,
  MAX_HP,
  MAX_INK,
  INK_COST,
  INK_REGEN_NORMAL,
  INK_REGEN_SQUID,
  HEALTH_REGEN_RATE
} from '@ink/shared';

describe('Subagents 18 & 19: Ink and Health Resource Systems', () => {
  it('consumes ink per shot and disallows firing when depleted below cost', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    expect(player.ink).toBe(MAX_INK);

    // Fire 50 shots (cost = 2 each)
    let firedCount = 0;
    const now = 10000;
    for (let i = 0; i < 50; i++) {
      const ok = player.consumeShot(INK_COST, now + i * 100);
      if (ok) firedCount++;
    }

    expect(firedCount).toBe(50);
    expect(player.ink).toBe(0);

    // 51st shot fails due to 0 ink
    const shot51 = player.consumeShot(INK_COST, now + 5000);
    expect(shot51).toBe(false);
    expect(player.ink).toBe(0);
  });

  it('respects 0.5s ink regen delay before restoring ink', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    player.ink = 50;
    const fireTime = 10000;
    player.consumeShot(INK_COST, fireTime); // ink = 48, lastFiredTime = 10000

    // 0.3s later: still within 0.5s delay -> no ink regen
    player.updateInkRegen(0.1, false, fireTime + 300);
    expect(player.ink).toBe(48);

    // 0.6s later: delay expired -> regenerates at 10/s (0.1s * 10/s = 1.0)
    player.updateInkRegen(0.1, false, fireTime + 600);
    expect(player.ink).toBeCloseTo(49, 1);
  });

  it('accelerates ink regen 3x (30/s) when submerged in own ink', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    player.ink = 20;
    player.lastFiredTime = 1000;

    // Submerged in own ink for 1.0s (30/s * 1.0s = 30 ink)
    player.updateInkRegen(1.0, true, 5000);
    expect(player.ink).toBeCloseTo(50, 1);
  });

  it('clamps ink strictly between 0 and 100', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    player.ink = 95;
    player.lastFiredTime = 1000;

    // Attempt to regen 20 ink -> clamped at MAX_INK (100)
    player.updateInkRegen(2.0, false, 5000);
    expect(player.ink).toBe(MAX_INK);
  });

  it('deals 4-shot kill with 25 damage and emits dead state transition exactly once', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    expect(player.hp).toBe(MAX_HP);

    const hit1 = player.applyDamage(25, 1000);
    expect(hit1.dead).toBe(false);
    expect(player.hp).toBe(75);

    const hit2 = player.applyDamage(25, 1100);
    expect(hit2.dead).toBe(false);
    expect(player.hp).toBe(50);

    const hit3 = player.applyDamage(25, 1200);
    expect(hit3.dead).toBe(false);
    expect(player.hp).toBe(25);

    const hit4 = player.applyDamage(25, 1300);
    expect(hit4.dead).toBe(true);
    expect(player.hp).toBe(0);
    expect(player.alive).toBe(false);

    // Overkill damage after death is rejected
    const overkill = player.applyDamage(25, 1400);
    expect(overkill.dead).toBe(false);
    expect(overkill.actualDamage).toBe(0);
    expect(player.hp).toBe(0);
  });

  it('completely ignores damage during spawn invulnerability', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    const now = 10000;
    player.invulnerableUntil = now + 2000; // 2s invulnerable

    const res = player.applyDamage(50, now + 500);
    expect(res.actualDamage).toBe(0);
    expect(player.hp).toBe(MAX_HP);

    // After invulnerability expires
    const resAfter = player.applyDamage(50, now + 2500);
    expect(resAfter.actualDamage).toBe(50);
    expect(player.hp).toBe(50);
  });

  it('recovers health at 20 HP/s after 3s out of combat', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    player.hp = 60;
    player.lastDamageTime = 10000;

    // 2s out of combat -> no regen
    player.updateHealthRegen(0.1, false, 12000);
    expect(player.hp).toBe(60);

    // 3.5s out of combat -> regen active (20 HP/s * 0.5s = 10 HP)
    player.updateHealthRegen(0.5, false, 13500);
    expect(player.hp).toBeCloseTo(70, 1);
  });
});
