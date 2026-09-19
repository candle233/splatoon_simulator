import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionWorld } from '../server/src/Collision.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';
import { WeaponSimulation } from '../server/src/WeaponSimulation.js';
import { Team, PlayerMode, WEAPON_CONFIGS, SUB_WEAPON_CONFIGS, SPECIAL_CONFIGS } from '@ink/shared';

describe('Weapon Arsenal and Skill Simulations', () => {
  let collisionWorld: CollisionWorld;
  let paintGrid: PaintGrid;
  let weaponSim: WeaponSimulation;

  beforeEach(() => {
    collisionWorld = new CollisionWorld([]);
    paintGrid = new PaintGrid(128);
    weaponSim = new WeaponSimulation(collisionWorld, paintGrid);
  });

  describe('Primary Weapons', () => {
    it('Shooter (Ink Blaster) fires rapid stream, consumes ink, paints turf', () => {
      const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      shooter.weaponType = 'shooter';
      shooter.yaw = Math.PI; // Face +Z
      shooter.pitch = -0.3; // Aim downward at ground
      const victim = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 20 });

      const res = weaponSim.processFire(shooter, [shooter, victim], 1000);
      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('shooter');
      expect(shooter.ink).toBe(100 - WEAPON_CONFIGS.shooter.inkCost);
      expect(res.paintEvents.length).toBeGreaterThan(0);
      expect(res.paintEvents[0].prevU).toBeUndefined(); // First shot has no previous stroke
    });

    it('Roller: Tap flick produces wide fan splash', () => {
      const roller = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -2 });
      roller.weaponType = 'roller';
      roller.yaw = Math.PI;
      roller.pitch = -0.2;
      const victim = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 4 });

      const res = weaponSim.processFire(roller, [roller, victim], 2000, 0, false);
      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('roller');
      expect(victim.hp).toBeLessThan(100);
      expect(victim.hp).toBeGreaterThanOrEqual(0);
      expect(res.paintEvents.length).toBeGreaterThan(0);
    });

    it('Roller: Ground roll deals lethal 120 crush damage to enemies in contact', () => {
      const roller = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      roller.weaponType = 'roller';
      roller.yaw = Math.PI; // Heading +Z
      roller.grounded = true;

      const victim = new PlayerState('p2', Team.CYAN, 0, { x: 0.5, y: 0, z: 1.5 }); // In front of roller
      const res = weaponSim.processFire(roller, [roller, victim], 3000, 0, true);

      expect(res.fired).toBe(true);
      expect(victim.hp).toBe(0);
      expect(victim.alive).toBe(false);
      expect(victim.mode).toBe(PlayerMode.DEAD);
      expect(res.killedPlayerId).toBe('p2');
    });

    it('Charger: Scales damage with charge level and pierces with lethal 1-shot at full charge', () => {
      const sniper = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -10 });
      sniper.weaponType = 'charger';
      sniper.yaw = Math.PI; // Face +Z
      sniper.pitch = 0;

      const victim1 = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 0 });

      // Partial charge (0.5)
      const resPartial = weaponSim.processFire(sniper, [sniper, victim1], 4000, 0.5);
      expect(resPartial.fired).toBe(true);
      expect(victim1.hp).toBeLessThan(100);
      expect(victim1.hp).toBeGreaterThan(0);
      expect(victim1.alive).toBe(true);

      // Reset victim HP
      victim1.hp = 100;
      victim1.lastDamageTime = 0;

      // Full charge (1.0) deals 130 damage -> instant kill
      const resFull = weaponSim.processFire(sniper, [sniper, victim1], 5000, 1.0);
      expect(resFull.fired).toBe(true);
      expect(victim1.hp).toBe(0);
      expect(victim1.alive).toBe(false);
      expect(resFull.killedPlayerId).toBe('p2');
    });

    it('Charger: Long-range shot (>18m) preserves continuous beam line UV coordinates', () => {
      const sniper = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -25 });
      sniper.weaponType = 'charger';
      sniper.yaw = Math.PI; // Face +Z
      sniper.pitch = 0;

      // Target 35 meters away (distance = 35m > 18m)
      const victim = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 10 });
      const res = weaponSim.processFire(sniper, [sniper, victim], 5500, 1.0);

      expect(res.fired).toBe(true);
      const beamEvent = res.paintEvents.find((e) => e.prevU !== undefined);
      expect(beamEvent).toBeDefined();
      expect(beamEvent?.prevU).toBeCloseTo(0.5, 2);
      expect(beamEvent?.prevV).toBeCloseTo(0.25, 2); // (-25 + 50) / 100 = 0.25
      expect(beamEvent?.v).toBeGreaterThan(0.5); // Target is beyond z=0 -> v > 0.50
    });

    it('Ink Bucket: Heavy parabolic arc splash covers wide area', () => {
      const slosher = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -4 });
      slosher.weaponType = 'slosher';
      slosher.yaw = Math.PI;
      slosher.pitch = -0.15;

      const victim = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: 2 });
      const res = weaponSim.processFire(slosher, [slosher, victim], 6000);

      expect(res.fired).toBe(true);
      expect(res.weaponType).toBe('slosher');
      expect(victim.hp).toBe(100 - WEAPON_CONFIGS.slosher.damage); // 40 HP left
      expect(res.paintEvents.length).toBeGreaterThan(0);
      expect(res.paintEvents[0].radius).toBeCloseTo(WEAPON_CONFIGS.slosher.paintRadius / 100, 3);
    });

    it('Ink Bucket: Parabolic lob clears 1.5m obstacle wall that blocks linear fire', () => {
      // Create world with a 1.5m tall wall at z = 0
      const wallObstacle = {
        position: { x: 0, y: 0.75, z: 0 },
        size: { x: 8, y: 1.5, z: 1.0 }
      };
      const walledWorld = new CollisionWorld([wallObstacle]);
      const walledSim = new WeaponSimulation(walledWorld, paintGrid);

      // Shooter linear raycast is blocked by wall
      const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      shooter.weaponType = 'shooter';
      shooter.yaw = Math.PI; // Face +Z
      shooter.pitch = 0;
      const linearHit = walledWorld.castRay(
        { origin: { x: 0, y: 1.2, z: -5 }, direction: { x: 0, y: 0, z: 1 } },
        20,
        [],
        Team.PINK
      );
      expect(linearHit.hit).toBe(true);
      expect(linearHit.point.z).toBeLessThanOrEqual(0); // Blocked in front of wall

      // Ink Bucket fires from z = -5: parabolic lob clears the 1.5m wall and lands at z > 0
      const slosher = new PlayerState('p2', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      slosher.weaponType = 'slosher';
      slosher.yaw = Math.PI;
      slosher.pitch = 0; // Horizontal lob
      const slosherRes = walledSim.processFire(slosher, [slosher], 7000);

      expect(slosherRes.fired).toBe(true);
      expect(slosherRes.target).toBeDefined();
      expect(slosherRes.target!.z).toBeGreaterThan(1.0); // Cleared the wall at z=0!
    });
  });

  describe('Sub-Weapons & Entities', () => {
    it('Ink Bomb throws, fuses, detonates for lethal 180 area damage', () => {
      const thrower = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -2 });
      thrower.weaponType = 'shooter'; // Has splat_bomb
      thrower.yaw = Math.PI; // Face +Z
      thrower.pitch = 0.1;

      // Throw Splat Bomb
      const res = weaponSim.processSubWeapon(thrower, [thrower], 10000);
      expect(res.spawned).toBe(true);
      expect(res.subEvent?.action).toBe('spawn');
      expect(res.subEvent?.type).toBe('splat_bomb');
      expect(thrower.ink).toBe(100 - SUB_WEAPON_CONFIGS.splat_bomb.inkCost);

      // Advance until landed on ground
      weaponSim.updateEntities([thrower], 0.6, 10650);

      // Victim is positioned right next to the landed bomb
      const landedSub = (weaponSim as any).activeSubWeapons[0];
      const victim = new PlayerState('p2', Team.CYAN, 0, {
        x: landedSub.position.x,
        y: 0,
        z: landedSub.position.z
      });

      // Detonate after fuse (1.2s after landing = 11850ms)
      const explodeTick = weaponSim.updateEntities([thrower, victim], 0.1, 12000);
      expect(explodeTick.subEvents.some((e) => e.action === 'explode')).toBe(true);
      expect(victim.hp).toBe(0);
      expect(victim.alive).toBe(false);
      expect(explodeTick.paintEvents.length).toBeGreaterThan(0);
    });

    it('Burst Bomb explodes immediately upon impacting ground', () => {
      const thrower = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      thrower.weaponType = 'slosher'; // Has burst_bomb
      thrower.yaw = Math.PI; // Face +Z
      thrower.pitch = -0.5; // Aim downward

      const res = weaponSim.processSubWeapon(thrower, [thrower], 20000);
      expect(res.spawned).toBe(true);

      const inFlightSub = (weaponSim as any).activeSubWeapons[0];
      const landingZ = inFlightSub.position.z + inFlightSub.velocity.z * 0.2;
      const victim = new PlayerState('p2', Team.CYAN, 0, { x: 0, y: 0, z: landingZ });

      // Ground impact at dt = 0.2
      const tick = weaponSim.updateEntities([thrower, victim], 0.2, 20200);
      expect(tick.subEvents.some((e) => e.action === 'explode')).toBe(true);
      expect(victim.hp).toBeLessThan(100);
    });

    it('Curling Bomb glides across floor painting a trail and detonating', () => {
      const thrower = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      thrower.weaponType = 'roller'; // Has curling_bomb
      thrower.yaw = Math.PI;

      const res = weaponSim.processSubWeapon(thrower, [thrower], 30000);
      expect(res.spawned).toBe(true);

      // First sliding tick paints trail
      const tick1 = weaponSim.updateEntities([thrower], 0.1, 30100);
      expect(tick1.paintEvents.length).toBeGreaterThan(0);

      // End of fuse (fuseTime = 2.5s -> 32600ms)
      const tickEnd = weaponSim.updateEntities([thrower], 0.1, 32600);
      expect(tickEnd.subEvents.some((e) => e.action === 'explode')).toBe(true);
    });
  });

  describe('Special Weapons & Meter Charging', () => {
    it('Painting new turf charges player special meter, while re-painting same turf awards 0 meter', () => {
      paintGrid.reset();

      // 1. Shooter fires on clean turf: gains special meter
      const shooter = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -5 });
      shooter.weaponType = 'shooter';
      shooter.yaw = Math.PI;
      shooter.pitch = -0.3; // Aim at ground
      expect(shooter.specialMeter).toBe(0);

      weaponSim.processFire(shooter, [shooter], 1000);
      expect(shooter.specialMeter).toBeGreaterThan(0);
      // 2. Pre-paint the entire grid with Pink ink: firing Pink weapon yields 0 newly painted cells -> 0 meter gain
      paintGrid.grid.fill(Team.PINK);
      const meterBefore = shooter.specialMeter;
      weaponSim.processFire(shooter, [shooter], 1150);
      expect(shooter.specialMeter).toBe(meterBefore);
      paintGrid.reset();

      // 3. Roller roll painting charges special meter
      const roller = new PlayerState('p2', Team.PINK, 0, { x: 10, y: 0, z: 10 });
      roller.weaponType = 'roller';
      roller.grounded = true;
      expect(roller.specialMeter).toBe(0);
      weaponSim.processFire(roller, [roller], 2000, 0, true);
      expect(roller.specialMeter).toBeGreaterThan(0);

      // 4. Slosher lob splash charges special meter
      const slosher = new PlayerState('p3', Team.PINK, 0, { x: -15, y: 0, z: -15 });
      slosher.weaponType = 'slosher';
      expect(slosher.specialMeter).toBe(0);
      weaponSim.processFire(slosher, [slosher], 3000);
      expect(slosher.specialMeter).toBeGreaterThan(0);
    });

    it('Cannot activate special when meter is not 100%', () => {
      const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      player.weaponType = 'shooter';
      player.specialMeter = 75;

      const res = weaponSim.processSpecial(player, [player], 40000);
      expect(res.activated).toBe(false);
    });

    it('Activating Inkstrike resets meter and creates vortex hazard', () => {
      const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
      player.weaponType = 'shooter'; // Special: inkstrike
      player.yaw = Math.PI; // Heading +Z towards enemy at z=20
      player.specialMeter = 100;
      const enemy = new PlayerState('e1', Team.CYAN, 0, { x: 0, y: 0, z: 20 });

      const res = weaponSim.processSpecial(player, [player, enemy], 50000);
      expect(res.activated).toBe(true);
      expect(res.specialEvent?.action).toBe('activate');
      expect(res.specialEvent?.type).toBe('inkstrike');
      expect(player.specialMeter).toBe(0);

      // Enemy inside strike zone takes ticking damage
      const tick = weaponSim.updateEntities([player, enemy], 0.2, 50500);
      expect(enemy.hp).toBeLessThan(100);
      expect(tick.paintEvents.length).toBeGreaterThan(0);
    });

    it('Killer Wail piercing laser penetrates and damages line of enemies', () => {
      const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: -10 });
      player.weaponType = 'charger'; // Special: killer_wail
      player.yaw = Math.PI; // Facing +Z
      player.specialMeter = 100;

      const enemy1 = new PlayerState('e1', Team.CYAN, 0, { x: 0, y: 0, z: 0 });
      const enemy2 = new PlayerState('e2', Team.CYAN, 0, { x: 0, y: 0, z: 15 });

      const res = weaponSim.processSpecial(player, [player, enemy1, enemy2], 60000);
      expect(res.activated).toBe(true);

      const tick = weaponSim.updateEntities([player, enemy1, enemy2], 0.2, 60300);
      expect(enemy1.hp).toBeLessThan(100);
      expect(enemy2.hp).toBeLessThan(100);
    });
  });
});
