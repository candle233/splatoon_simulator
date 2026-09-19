import { describe, expect, it } from 'vitest';
import {
  MAX_SKILL_SLOTS,
  SKILL_CONFIGS,
  Team,
  WEAPON_CONFIGS,
  sanitizeSkills,
  skillMultiplier,
  getSpawnPosition
} from '@ink/shared';
import { CollisionWorld } from '../server/src/Collision.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';
import { WeaponSimulation } from '../server/src/WeaponSimulation.js';

function makeShooter(): PlayerState {
  const p = new PlayerState('p1', Team.PINK, 0, getSpawnPosition(Team.PINK, 0));
  p.weaponType = 'shooter';
  return p;
}

describe('gear skills (选择技能)', () => {
  it('sanitizes skills: dedupe, unknown drop, cap at MAX_SKILL_SLOTS', () => {
    expect(sanitizeSkills(['ink_saver', 'ink_saver', 'bogus', 'run_speed'])).toEqual([
      'ink_saver',
      'run_speed'
    ]);
    expect(
      sanitizeSkills(['ink_saver', 'run_speed', 'swim_speed', 'defense', 'main_power'])
    ).toHaveLength(MAX_SKILL_SLOTS);
    expect(sanitizeSkills('nonsense')).toEqual([]);
    expect(sanitizeSkills(undefined)).toEqual([]);
  });

  it('skillMultiplier applies once for equipped skills and ignores unknown ids', () => {
    expect(skillMultiplier(['ink_saver', 'ink_saver'], 'ink_saver')).toBeCloseTo(0.85);
    expect(skillMultiplier(['run_speed'], 'ink_saver')).toBe(1);
    expect(skillMultiplier(undefined, 'run_speed')).toBe(1);
    expect(skillMultiplier([], 'run_speed')).toBe(1);
  });

  it('every skill config has all three languages', () => {
    for (const cfg of SKILL_CONFIGS) {
      expect(cfg.name.length).toBeGreaterThan(0);
      expect(cfg.nameZh.length).toBeGreaterThan(0);
      expect(cfg.nameJa.length).toBeGreaterThan(0);
      expect(cfg.multiplier).toBeGreaterThan(0);
      expect(cfg.multiplier).not.toBe(1);
    }
  });

  it('ink_saver reduces shooter ink cost', () => {
    const collision = new CollisionWorld();
    const grid = new PaintGrid(64);
    const sim = new WeaponSimulation(collision, grid);

    const plain = makeShooter();
    const saver = makeShooter();
    saver.skills = ['ink_saver'];

    const before = plain.ink;
    sim.processFire(plain, [plain], Date.now());
    const plainCost = before - plain.ink;

    const beforeSaver = saver.ink;
    sim.processFire(saver, [saver], Date.now());
    const saverCost = beforeSaver - saver.ink;

    expect(saverCost).toBeLessThan(plainCost);
    expect(saverCost).toBeCloseTo(plainCost * 0.85, 5);
  });

  it('main_power boosts damage and defense reduces it', () => {
    const collision = new CollisionWorld();
    const grid = new PaintGrid(64);
    const sim = new WeaponSimulation(collision, grid);

    const shooter = makeShooter();
    const victimA = new PlayerState('v1', Team.CYAN, 0, getSpawnPosition(Team.CYAN, 0));
    const victimB = new PlayerState('v2', Team.CYAN, 1, getSpawnPosition(Team.CYAN, 1));
    const victimC = new PlayerState('v3', Team.CYAN, 2, getSpawnPosition(Team.CYAN, 2));
    victimC.skills = ['defense'];

    // Face +x: yaw = -PI/2; victims 10 units ahead (inside the 48u range)
    shooter.yaw = -Math.PI / 2;
    shooter.pitch = 0;
    shooter.position = { x: 0, y: 1, z: 0 };

    // Shot 1: plain shooter vs plain victim -> base damage
    victimA.position = { x: 10, y: 1, z: 0 };
    const resA = sim.processFire(shooter, [shooter, victimA], Date.now());
    expect(resA.hitPlayerId).toBe(victimA.id);
    const dmgBase = 100 - victimA.hp;
    expect(dmgBase).toBeCloseTo(WEAPON_CONFIGS.shooter.damage, 0);

    // Shot 2: main_power shooter vs plain victim -> boosted damage
    shooter.skills = ['main_power'];
    shooter.lastShotTime = 0;
    victimB.position = { x: 10, y: 1, z: 0 };
    const resB = sim.processFire(shooter, [shooter, victimB], Date.now());
    expect(resB.hitPlayerId).toBe(victimB.id);
    const dmgPower = 100 - victimB.hp;
    expect(dmgPower).toBeGreaterThan(dmgBase);
    expect(dmgPower).toBeCloseTo(WEAPON_CONFIGS.shooter.damage * 1.1, 1);

    // Shot 3: main_power shooter vs defense victim -> reduced boosted damage
    shooter.lastShotTime = 0;
    victimC.position = { x: 10, y: 1, z: 0 };
    const resC = sim.processFire(shooter, [shooter, victimC], Date.now());
    expect(resC.hitPlayerId).toBe(victimC.id);
    const dmgDefended = 100 - victimC.hp;
    expect(dmgDefended).toBeCloseTo(WEAPON_CONFIGS.shooter.damage * 1.1 * 0.9, 1);
  });

  it('special_charge speeds meter gain and quick_respawn shortens respawn', () => {
    const collision = new CollisionWorld();
    const grid = new PaintGrid(64);
    const sim = new WeaponSimulation(collision, grid);

    const plain = makeShooter();
    const charged = makeShooter();
    charged.skills = ['special_charge'];

    sim.awardSpecialMeter(plain, 10);
    sim.awardSpecialMeter(charged, 10);
    expect(charged.specialMeter).toBeCloseTo(12.5);
    expect(plain.specialMeter).toBe(10);

    const victim = new PlayerState('v', Team.CYAN, 0, getSpawnPosition(Team.CYAN, 0));
    victim.skills = ['quick_respawn'];
    expect(victim.respawnDelaySec(4)).toBeCloseTo(2.8);
  });
});
