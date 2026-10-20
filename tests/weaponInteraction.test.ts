import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionWorld } from '../server/src/Collision.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';
import { WeaponSimulation } from '../server/src/WeaponSimulation.js';
import { MovementSimulation } from '../server/src/MovementSimulation.js';
import {
  Team,
  PlayerMode,
  PlayerInput,
  WEAPON_CONFIGS,
  SUB_WEAPON_CONFIGS,
  SPECIAL_CONFIGS,
  isValidWeaponType
} from '@ink/shared';

describe('Weapon Interaction & Iteration Tests', () => {
  let collisionWorld: CollisionWorld;
  let paintGrid: PaintGrid;
  let weaponSim: WeaponSimulation;
  let movementSim: MovementSimulation;

  beforeEach(() => {
    collisionWorld = new CollisionWorld([]);
    paintGrid = new PaintGrid(128);
    weaponSim = new WeaponSimulation(collisionWorld, paintGrid);
    movementSim = new MovementSimulation(collisionWorld, paintGrid);
  });

  describe('In-Match Weapon Switching & State Synchronization', () => {
    it('switches weapon dynamically and updates firing behavior and ink cost', () => {
      const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      player.weaponType = 'shooter';
      const enemy = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 5 });

      // 1. Fire as shooter
      const res1 = weaponSim.processFire(player, [player, enemy], 1000);
      expect(res1.fired).toBe(true);
      expect(res1.weaponType).toBe('shooter');
      expect(player.ink).toBeCloseTo(100 - WEAPON_CONFIGS.shooter.inkCost, 1);

      // 2. Switch mid-match to cannon
      player.weaponType = 'cannon';
      expect(player.weaponType).toBe('cannon');

      // 3. Fire as cannon (after cooldown)
      const res2 = weaponSim.processFire(player, [player, enemy], 2500);
      expect(res2.fired).toBe(true);
      expect(res2.weaponType).toBe('cannon');
      // Cannon ink cost is 16
      expect(player.ink).toBeCloseTo(100 - WEAPON_CONFIGS.shooter.inkCost - WEAPON_CONFIGS.cannon.inkCost, 1);
    });

    it('validates all 8 weapon IDs as valid weapon types', () => {
      const weapons = ['shooter', 'roller', 'charger', 'slosher', 'sprayer', 'cannon', 'marksman', 'scatter'];
      for (const w of weapons) {
        expect(isValidWeaponType(w)).toBe(true);
      }
      expect(isValidWeaponType('invalid_laser')).toBe(false);
      expect(isValidWeaponType('')).toBe(false);
    });
  });

  describe('All 8 Weapons Firing Mechanics & Feel', () => {
    it('Sprayer: ultra-fast rate of fire and low ink cost per shot', () => {
      const sprayer = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      sprayer.weaponType = 'sprayer';
      sprayer.yaw = Math.PI;

      const res = weaponSim.processFire(sprayer, [sprayer], 1000);
      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('sprayer');
      expect(sprayer.ink).toBeCloseTo(100 - WEAPON_CONFIGS.sprayer.inkCost, 2);

      // Second shot 55ms later (fire rate is 20/s = 50ms)
      const res2 = weaponSim.processFire(sprayer, [sprayer], 1055);
      expect(res2.fired).toBe(true);
      expect(sprayer.ink).toBeCloseTo(100 - WEAPON_CONFIGS.sprayer.inkCost * 2, 2);
    });

    it('Cannon: heavy mortar lob with AoE splash damage and large bloom', () => {
      const mortar = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -10 });
      mortar.weaponType = 'cannon';
      mortar.yaw = Math.PI;
      mortar.pitch = 0.2; // lobbed upwards
      const target = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 12 });

      const res = weaponSim.processFire(mortar, [mortar, target], 1000);
      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('cannon');
      expect(res.paintEvents.length).toBeGreaterThan(0);
      expect(mortar.ink).toBe(100 - WEAPON_CONFIGS.cannon.inkCost);
    });

    it('Scatter: shotgun burst with wide spread that damages close targets', () => {
      const scatter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      scatter.weaponType = 'scatter';
      scatter.yaw = Math.PI; // Face +Z
      scatter.pitch = 0;
      const closeTarget = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 3 });

      const res = weaponSim.processFire(scatter, [scatter, closeTarget], 1000);
      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('scatter');
      expect(closeTarget.hp).toBeLessThan(100);
      expect(scatter.ink).toBe(100 - WEAPON_CONFIGS.scatter.inkCost);
    });

    it('Marksman: precision semi-auto rifle with tight spread and high reach', () => {
      const marksman = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -20 });
      marksman.weaponType = 'marksman';
      marksman.yaw = Math.PI;
      marksman.pitch = 0;
      const farTarget = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 15 });

      const res = weaponSim.processFire(marksman, [marksman, farTarget], 1000);
      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('marksman');
      expect(farTarget.hp).toBeLessThan(100);
      expect(marksman.ink).toBe(100 - WEAPON_CONFIGS.marksman.inkCost);
    });

    it('Roller: distinguishes continuous rolling from tap flicking', () => {
      const roller = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      roller.weaponType = 'roller';
      roller.grounded = true;
      roller.yaw = Math.PI;

      // 1. Ground Roll: uses rollCost (0.8 ink) and short cooldown (80ms)
      const rollRes = weaponSim.processFire(roller, [roller], 1000, 0, true);
      expect(rollRes.fired).toBe(true);
      expect(roller.ink).toBeCloseTo(100 - 0.8, 1);

      // Roll again after 90ms
      const rollRes2 = weaponSim.processFire(roller, [roller], 1090, 0, true);
      expect(rollRes2.fired).toBe(true);
      expect(roller.ink).toBeCloseTo(100 - 1.6, 1);

      // 2. Flick Swing (not rolling): uses flick ink cost (12)
      const flickRes = weaponSim.processFire(roller, [roller], 2500, 0, false);
      expect(flickRes.fired).toBe(true);
      expect(roller.ink).toBeCloseTo(100 - 1.6 - WEAPON_CONFIGS.roller.inkCost, 1);
    });

    it('Charger: partial charge does partial damage, full charge deals lethal pierce', () => {
      const sniper = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -10 });
      sniper.weaponType = 'charger';
      sniper.yaw = Math.PI;
      const target = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 5 });

      // Half charge (0.5)
      const halfRes = weaponSim.processFire(sniper, [sniper, target], 1000, 0.5);
      expect(halfRes.fired).toBe(true);
      expect(target.hp).toBeGreaterThan(0);
      expect(target.alive).toBe(true);

      // Reset target HP
      target.hp = 100;
      target.lastDamageTime = 0;

      // Full charge (1.0)
      const fullRes = weaponSim.processFire(sniper, [sniper, target], 3000, 1.0);
      expect(fullRes.fired).toBe(true);
      expect(target.hp).toBe(0);
      expect(target.alive).toBe(false);
      expect(fullRes.killedPlayerId).toBe('p2');
    });
  });

  describe('Ink Depletion & Sub / Special Interaction States', () => {
    it('prevents main weapon fire when ink is below weapon cost', () => {
      const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      shooter.weaponType = 'shooter';
      shooter.ink = 1.0; // shooter cost is 2

      const res = weaponSim.processFire(shooter, [shooter], 1000);
      expect(res.fired).toBe(false);
      expect(shooter.ink).toBe(1.0); // Not consumed
    });

    it('prevents sub weapon throw when ink is below sub cost and throws when sufficient', () => {
      const thrower = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      thrower.weaponType = 'shooter'; // splat_bomb cost is 65
      thrower.ink = 50;

      // Insufficient ink
      const fail = weaponSim.processSubWeapon(thrower, [thrower], 1000);
      expect(fail.spawned).toBe(false);
      expect(thrower.ink).toBe(50);

      // Sufficient ink
      thrower.ink = 80;
      const success = weaponSim.processSubWeapon(thrower, [thrower], 1000);
      expect(success.spawned).toBe(true);
      expect(thrower.ink).toBe(80 - SUB_WEAPON_CONFIGS.splat_bomb.inkCost);
    });

    it('requires special meter to be 100% to activate special weapon', () => {
      const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      player.weaponType = 'shooter';
      player.specialMeter = 99;

      const fail = weaponSim.processSpecial(player, [player], 1000);
      expect(fail.activated).toBe(false);

      player.specialMeter = 100;
      const success = weaponSim.processSpecial(player, [player], 1000);
      expect(success.activated).toBe(true);
      expect(player.specialMeter).toBe(0);
      expect(player.specialActive).toBe(true);
    });
  });

  describe('Charger Aiming Feel & Locomotion Penalty', () => {
    it('slows player movement speed proportionally as charger charge builds', () => {
      const pNormal = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      pNormal.weaponType = 'charger';
      const inputNormal: PlayerInput = {
        seq: 1,
        moveX: 0,
        moveZ: -1, // full forward
        yaw: 0,
        pitch: 0,
        jump: false,
        squid: false,
        fire: false,
        subWeapon: false,
        special: false,
        weaponType: 'charger',
        chargeLevel: 0
      };

      movementSim.simulatePlayer(pNormal, inputNormal, 0.05, 1000);
      const normalSpeed = Math.abs(pNormal.velocity.z);

      // Half charge (0.5)
      const pHalf = new PlayerState('p2', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      pHalf.weaponType = 'charger';
      const inputHalf: PlayerInput = {
        ...inputNormal,
        chargeLevel: 0.5
      };
      movementSim.simulatePlayer(pHalf, inputHalf, 0.05, 1000);
      const halfSpeed = Math.abs(pHalf.velocity.z);
      expect(halfSpeed).toBeCloseTo(normalSpeed * 0.75, 1);

      // Full charge (1.0)
      const pFull = new PlayerState('p3', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      pFull.weaponType = 'charger';
      const inputFull: PlayerInput = {
        ...inputNormal,
        chargeLevel: 1.0
      };
      movementSim.simulatePlayer(pFull, inputFull, 0.05, 1000);
      const fullSpeed = Math.abs(pFull.velocity.z);
      expect(fullSpeed).toBeCloseTo(normalSpeed * 0.5, 1);
    });

    it('does not penalize speed for non-charging weapons', () => {
      const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      shooter.weaponType = 'shooter';
      const input: PlayerInput = {
        seq: 1,
        moveX: 0,
        moveZ: -1,
        yaw: 0,
        pitch: 0,
        jump: false,
        squid: false,
        fire: true,
        subWeapon: false,
        special: false,
        weaponType: 'shooter'
      };

      movementSim.simulatePlayer(shooter, input, 0.05, 1000);
      expect(Math.abs(shooter.velocity.z)).toBeGreaterThan(5.0);
    });
  });

  describe('Weapon Archetype Combat Scaling & Kill Feedback', () => {
    it('identifies lethal vs non-lethal hits correctly for hit feedback', () => {
      const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      shooter.weaponType = 'charger';
      shooter.yaw = Math.PI;
      const enemy = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 5 });
      enemy.hp = 100;

      // 1. Partial shot: non-lethal hit
      const nonLethal = weaponSim.processFire(shooter, [shooter, enemy], 1000, 0.4);
      expect(nonLethal.fired).toBe(true);
      expect(nonLethal.hitPlayerId).toBe('p2');
      expect(nonLethal.killedPlayerId).toBeUndefined();
      const isKill1 = Boolean(nonLethal.killedPlayerId && nonLethal.killedPlayerId === nonLethal.hitPlayerId);
      expect(isKill1).toBe(false);

      // 2. Lethal shot finishing off wounded enemy
      const lethal = weaponSim.processFire(shooter, [shooter, enemy], 2000, 1.0);
      expect(lethal.fired).toBe(true);
      expect(lethal.hitPlayerId).toBe('p2');
      expect(lethal.killedPlayerId).toBe('p2');
      const isKill2 = Boolean(lethal.killedPlayerId && lethal.killedPlayerId === lethal.hitPlayerId);
      expect(isKill2).toBe(true);
    });

    it('verifies scatter pellet count and weapon sub/special loadout integrity', () => {
      expect(WEAPON_CONFIGS.scatter.pelletCount).toBe(6);
      expect(WEAPON_CONFIGS.marksman.spread).toBeLessThan(WEAPON_CONFIGS.shooter.spread);
      expect(WEAPON_CONFIGS.sprayer.fireRate).toBeGreaterThan(15);

      for (const [wType, cfg] of Object.entries(WEAPON_CONFIGS)) {
        expect(SUB_WEAPON_CONFIGS[cfg.sub]).toBeDefined();
        expect(SPECIAL_CONFIGS[cfg.special]).toBeDefined();
        expect(SUB_WEAPON_CONFIGS[cfg.sub].inkCost).toBeGreaterThan(0);
        expect(SUB_WEAPON_CONFIGS[cfg.sub].inkCost).toBeLessThanOrEqual(100);
      }
    });
  });
});
