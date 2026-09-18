import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionWorld } from '../server/src/Collision.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { PlayerState } from '../server/src/PlayerState.js';
import { WeaponSimulation } from '../server/src/WeaponSimulation.js';
import { MovementSimulation } from '../server/src/MovementSimulation.js';
import { Team, PlayerMode, PlayerInput, MAX_HP, WEAPON_DAMAGE } from '@ink/shared';

describe('Combat, Damage, and Health Logic', () => {
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

  it('kills a player in exactly 4 shots of 25 damage', () => {
    const shooter = new PlayerState('shooter', Team.PINK, 0, { x: 0, y: 0, z: -5 });
    const victim = new PlayerState('victim', Team.CYAN, 0, { x: 0, y: 0, z: 5 });
    const allPlayers = [shooter, victim];

    // Shooter looks straight towards +Z (yaw = PI, pitch = 0)
    shooter.yaw = Math.PI;
    shooter.pitch = 0;

    let time = 100000;

    // Shot 1
    let res = weaponSim.processFire(shooter, allPlayers, time);
    expect(res.fired).toBe(true);
    expect(res.hitPlayerId).toBe('victim');
    expect(victim.hp).toBe(MAX_HP - WEAPON_DAMAGE); // 75
    expect(victim.alive).toBe(true);

    // Shot 2 (100ms later)
    time += 100;
    res = weaponSim.processFire(shooter, allPlayers, time);
    expect(victim.hp).toBe(50);

    // Shot 3 (100ms later)
    time += 100;
    res = weaponSim.processFire(shooter, allPlayers, time);
    expect(victim.hp).toBe(25);

    // Shot 4 (100ms later)
    time += 100;
    res = weaponSim.processFire(shooter, allPlayers, time);
    expect(victim.hp).toBe(0);
    expect(victim.alive).toBe(false);
    expect(victim.mode).toBe(PlayerMode.DEAD);
    expect(res.killedPlayerId).toBe('victim');
    expect(shooter.kills).toBe(1);
    expect(victim.deaths).toBe(1);
    // Death paint created
    expect(res.paintEvents.length).toBeGreaterThan(0);
    expect(res.paintEvents[0]!.team).toBe(Team.PINK);
  });

  it('prevents damage while player is invulnerable', () => {
    const shooter = new PlayerState('shooter', Team.PINK, 0, { x: 0, y: 0, z: -5 });
    const victim = new PlayerState('victim', Team.CYAN, 0, { x: 0, y: 0, z: 5 });
    shooter.yaw = Math.PI;

    const time = 100000;
    victim.respawn({ x: 0, y: 0, z: 5 }, time, 2.0); // 2s invulnerability

    const res = weaponSim.processFire(shooter, [shooter, victim], time + 500); // 0.5s later
    expect(victim.hp).toBe(100);
    expect(res.hitPlayerId).toBeUndefined();
  });

  it('applies DoT when player stands in enemy ink and restricts squid mode', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });

    // Paint ground around (0,0) with CYAN (enemy ink)
    paintGrid.applyPaintEvent({
      id: 1,
      team: Team.CYAN,
      u: 0.5,
      v: 0.5,
      radius: 0.1,
      seed: 123
    });

    const input: PlayerInput = {
      seq: 1,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      jump: false,
      squid: true, // Tries to squid in enemy ink
      fire: false,
      clientTime: 100000
    };

    const res = movementSim.simulatePlayer(player, input, 0.1, 100000);
    expect(res.diedByEnemyInk).toBe(false);
    // Forced into HUMANOID mode
    expect(player.mode).toBe(PlayerMode.HUMANOID);
    // Took DoT damage: 15 HP/s * 0.1s = 1.5 HP
    expect(player.hp).toBeCloseTo(98.5, 1);
  });

  it('regenerates health after 3 seconds out of combat', () => {
    const player = new PlayerState('p1', Team.PINK, 0, { x: 0, y: 0, z: 0 });
    player.hp = 50;
    player.lastDamageTime = 100000;

    const dummyInput: PlayerInput = {
      seq: 1,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      jump: false,
      squid: false,
      fire: false,
      clientTime: 0
    };

    // 2 seconds later -> no regen yet
    movementSim.simulatePlayer(player, dummyInput, 0.1, 102000);
    expect(player.hp).toBe(50);

    // 3.5 seconds later -> regen active (20 HP/s * 0.1s = 2 HP)
    movementSim.simulatePlayer(player, dummyInput, 0.1, 103500);
    expect(player.hp).toBeCloseTo(52, 1);
  });
});
