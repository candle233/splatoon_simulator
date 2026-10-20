import { describe, expect, it } from 'vitest';
import {
  BoxObstacle,
  ClimbableSurface,
  MAP_DEFS,
  PaintSurface,
  PlayerMode,
  PlayerState,
  Team,
  Vec3
} from '@ink/shared';
import { CollisionWorld } from '../server/src/Collision.js';
import { ClientCollisionWorld } from '../client/src/world/CollisionWorld.js';
import { MovementSimulation } from '../server/src/MovementSimulation.js';
import { PaintGrid } from '../server/src/PaintGrid.js';
import { WeaponSimulation } from '../server/src/WeaponSimulation.js';
import { PlayerState as ServerPlayer } from '../server/src/PlayerState.js';
import { LocalPlayer } from '../client/src/player/LocalPlayer.js';

describe('Climbable Surfaces & 3D Vertical Traversal', () => {
  const wideWall: ClimbableSurface = {
    id: 'wide_test_wall',
    position: { x: 0, y: 2.5, z: 30 },
    size: { x: 20, y: 5, z: 2 },
    normal: { x: 0, y: 0, z: -1 }
  };

  it('CollisionWorld.getClimbableSurfaceAt detects players all along wide walls without lateral center-bias', () => {
    const world = new CollisionWorld([], [], [wideWall]);

    // Player positioned 8m to the right of wall center, 0.5m in front of wall face (z = 30 - 1 - 0.5 = 28.5)
    // Distance to center would be sqrt(8^2 + 1.5^2) = 8.14m (> 2.0m range), but distance to wall face is 0.5m.
    const playerNearRightEdge: Vec3 = { x: 8, y: 2.5, z: 28.5 };
    const hitRight = world.getClimbableSurfaceAt(playerNearRightEdge, 2.0);
    expect(hitRight).not.toBeNull();
    expect(hitRight?.id).toBe('wide_test_wall');

    // Player positioned 9m to the left of wall center
    const playerNearLeftEdge: Vec3 = { x: -9, y: 2.5, z: 28.5 };
    const hitLeft = world.getClimbableSurfaceAt(playerNearLeftEdge, 2.0);
    expect(hitLeft).not.toBeNull();
    expect(hitLeft?.id).toBe('wide_test_wall');

    // Player completely outside the wall horizontal bounds (x = 13, half-width is 10)
    // Closest X is 10, dx = 3, dz = 0.5, dist = sqrt(9.25) = 3.04m > 2.0m
    const playerFarOutside: Vec3 = { x: 13, y: 2.5, z: 28.5 };
    const hitOutside = world.getClimbableSurfaceAt(playerFarOutside, 2.0);
    expect(hitOutside).toBeNull();
  });

  it('ClientCollisionWorld.getClimbableSurfaceAt mirrors server detection identically', () => {
    const clientWorld = new ClientCollisionWorld([], [], [wideWall]);

    const playerNearRightEdge: Vec3 = { x: 7.5, y: 3.0, z: 28.6 };
    const hitRight = clientWorld.getClimbableSurfaceAt(playerNearRightEdge, 2.0);
    expect(hitRight).not.toBeNull();
    expect(hitRight?.id).toBe('wide_test_wall');

    const playerOutside: Vec3 = { x: 14, y: 3.0, z: 28.6 };
    expect(clientWorld.getClimbableSurfaceAt(playerOutside, 2.0)).toBeNull();
  });

  it('enforces vertical height bounds on climbable surfaces', () => {
    const world = new CollisionWorld([], [], [wideWall]);
    // Wall top is y = 2.5 + 2.5 = 5.0. Upper threshold is 5.0 + 0.8 = 5.8
    const playerAboveLip: Vec3 = { x: 0, y: 5.9, z: 28.5 };
    expect(world.getClimbableSurfaceAt(playerAboveLip, 2.0)).toBeNull();

    // Just below the top lip
    const playerNearTop: Vec3 = { x: 0, y: 5.2, z: 28.5 };
    expect(world.getClimbableSurfaceAt(playerNearTop, 2.0)).not.toBeNull();

    // Wall bottom is y = 0. Lower threshold is 0 - 0.5 = -0.5
    const playerBelowBase: Vec3 = { x: 0, y: -0.6, z: 28.5 };
    expect(world.getClimbableSurfaceAt(playerBelowBase, 2.0)).toBeNull();
  });

  it('verifies perimeter wall climb normals face inward toward the arena across all maps', () => {
    for (const [mapId, def] of Object.entries(MAP_DEFS)) {
      const north = def.climbableSurfaces.find((s) => s.id === 'climb_wall_n');
      const south = def.climbableSurfaces.find((s) => s.id === 'climb_wall_s');
      const east = def.climbableSurfaces.find((s) => s.id === 'climb_wall_e');
      const west = def.climbableSurfaces.find((s) => s.id === 'climb_wall_w');

      expect(north, `Map ${mapId} missing climb_wall_n`).toBeDefined();
      expect(south, `Map ${mapId} missing climb_wall_s`).toBeDefined();
      expect(east, `Map ${mapId} missing climb_wall_e`).toBeDefined();
      expect(west, `Map ${mapId} missing climb_wall_w`).toBeDefined();

      // North wall (positive z) must face inward into the arena (-z)
      expect(north!.normal.z, `${mapId} north wall normal.z`).toBeLessThan(-0.9);
      // South wall (negative z) must face inward into the arena (+z)
      expect(south!.normal.z, `${mapId} south wall normal.z`).toBeGreaterThan(0.9);
      // East wall (positive x) must face inward into the arena (-x)
      expect(east!.normal.x, `${mapId} east wall normal.x`).toBeLessThan(-0.9);
      // West wall (negative x) must face inward into the arena (+x)
      expect(west!.normal.x, `${mapId} west wall normal.x`).toBeGreaterThan(0.9);
    }
  });

  it('MovementSimulation triggers smooth ledge mantling pop when squid reaches the top lip', () => {
    const world = new CollisionWorld([], [], [wideWall]);
    const paintGrid = new PaintGrid();
    const sim = new MovementSimulation(world, paintGrid);

    const makePlayer = (y: number): ServerPlayer => {
      const p = new ServerPlayer('test_squid', Team.PINK, 0, { x: 4, y, z: 28.8 });
      p.grounded = false;
      p.velocity = { x: 0, y: 5.0, z: 0 };
      return p;
    };

    // 1. Midway up the wall (y = 3.0, top is 5.0): Squid accelerates vertically
    const playerMid = makePlayer(3.0);
    sim.simulatePlayer(
      playerMid,
      {
        seq: 1,
        moveX: 0,
        moveZ: 1,
        yaw: 0,
        pitch: 0,
        jump: false,
        squid: true,
        fire: false,
        clientTime: 1000
      },
      1 / 60
    );
    // When climbing, vertical velocity is set to rapid upward swim (~6.2 - gravity + gravity = 6.2)
    expect(playerMid.velocity.y).toBeGreaterThan(5.5);
    expect(playerMid.mode).toBe(PlayerMode.SUBMERGED);

    // 2. Near top lip (y = 4.8 >= topY - 0.35 = 4.65): Ledge mantle activates
    const playerMantle = makePlayer(4.8);
    sim.simulatePlayer(
      playerMantle,
      {
        seq: 2,
        moveX: 0,
        moveZ: 1,
        yaw: 0,
        pitch: 0,
        jump: false,
        squid: true,
        fire: false,
        clientTime: 1016
      },
      1 / 60
    );
    // Vertical velocity is dampened to mantle smoothly (y <= 2.5), while forward velocity is pushed over ledge
    expect(playerMantle.velocity.y).toBeLessThanOrEqual(2.5);
    // Wall is at z=30, player at z=28.8 -> forward push is positive z towards roof platform
    expect(playerMantle.velocity.z).toBeGreaterThan(0.5);
  });

  it('LocalPlayer prediction performs squid climb and maintains SUBMERGED mode when climbing', () => {
    const clientWorld = new ClientCollisionWorld([], [], [wideWall]);
    const lp = new LocalPlayer('local_p', Team.PINK, { x: 4, y: 3.0, z: 28.8 }, clientWorld);
    lp.grounded = false;
    lp.predictMovement(
      {
        seq: 1,
        moveX: 0,
        moveZ: 1,
        yaw: 0,
        pitch: 0,
        jump: false,
        squid: true,
        fire: false,
        clientTime: 1000
      },
      1 / 60,
      Team.NEUTRAL
    );
    expect(lp.mode).toBe(PlayerMode.SUBMERGED);
    expect(lp.velocity.y).toBeGreaterThan(5.5);
  });

  it('WeaponSimulation paints vertical wall faces on impact and flags dirty surfaces', () => {
    const paintWall: PaintSurface = {
      id: 'paint_test_wall',
      position: { x: 0, y: 2.5, z: 20 },
      size: { x: 10, y: 5, z: 1 },
      normal: { x: 0, y: 0, z: -1 },
      height: 5,
      paint: [0, 0]
    };
    const wallBox: BoxObstacle = {
      id: 'box_wall',
      position: { x: 0, y: 2.5, z: 20 },
      size: { x: 10, y: 5, z: 1 }
    };
    const world = new CollisionWorld([wallBox], [], []);
    const paintGrid = new PaintGrid();
    paintGrid.initSurfaces([paintWall]);
    const weaponSim = new WeaponSimulation(world, paintGrid);

    // Shooter shooting toward the wall at (0, 2.5, 20)
    const shooter = new ServerPlayer('shooter', Team.PINK, 0, { x: 0, y: 0, z: 10 });
    shooter.yaw = Math.PI; // facing +z
    shooter.pitch = 0.15; // aiming slightly up toward z=20, y=2.5

    weaponSim.processFire(shooter, [shooter], Date.now());

    // Surface should now be painted and dirtySurfaces consumed
    const dirty = paintGrid.consumeDirtySurfaces();
    expect(dirty.length).toBeGreaterThan(0);
    expect(dirty[0].id).toBe('paint_test_wall');
    expect(dirty[0].paint[0]).toBeGreaterThan(0); // pink coverage increased
  });

  it('CollisionWorld.getGroundHeightAt respects currentY under multi-tier overhead crossings', () => {
    // Skybridge at y=4.8 with thickness 0.6 (top at 5.1) spanning x: [-5, 5], z: [-5, 5]
    const bridge: BoxObstacle = {
      id: 'test_skybridge',
      position: { x: 0, y: 4.8, z: 0 },
      size: { x: 10, y: 0.6, z: 10 }
    };
    const world = new CollisionWorld([bridge], [], []);

    // Bot on ground level (y = 0) under the bridge
    const groundY = world.getGroundHeightAt(0, 0, 0 + 1.5);
    expect(groundY).toBe(0);

    // Player/bot on top of the bridge deck (y = 5.1)
    const deckY = world.getGroundHeightAt(0, 0, 5.1 + 1.5);
    expect(deckY).toBeCloseTo(5.1, 2);
  });
});

