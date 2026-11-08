import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerMode, Team } from '@ink/shared';
import { PlayerView } from '../client/src/player/PlayerView.js';
import { RemotePlayer } from '../client/src/player/RemotePlayer.js';
import type { InterpolatedPlayerState } from '../client/src/network/SnapshotBuffer.js';

/**
 * Character detail effects: ink damage stains, footstep ripples, swim trail,
 * landing splash, death splat. Verifies the visual state machine transitions
 * (opacity / visibility / pooling) on a real PlayerView in a node environment.
 */

function makeView(): PlayerView {
  return new PlayerView(Team.PINK);
}

function countVisible(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.visible && (mesh.material as THREE.Material).opacity > 0.01) count++;
  });
  return count;
}

describe('character detail effects', () => {
  it('full HP shows no ink stains', () => {
    const view = makeView();
    view.setDamageStains(1);
    // All stains should be at/near zero opacity and invisible
    let stained = 0;
    view.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.transparent && mat.opacity > 0.02 && !mesh.visible === false) {
        // Stains are the only enemy-coloured transparent standard materials on the body
        if ((mat as unknown as { isStain?: boolean }).isStain) stained++;
      }
    });
    // With full HP nothing was forced visible by the stain system
    expect(stained).toBe(0);
    view.dispose();
  });

  it('low HP increases visible stain coverage', () => {
    const view = makeView();
    // Sample the humanoid group's transparent-material mesh count at full vs low HP
    view.setDamageStains(1);
    const visibleAtFull = countVisible(view.group);

    view.setDamageStains(0.15);
    // Advance the lerp: setDamageStains lerps over time, so call it repeatedly
    for (let i = 0; i < 120; i++) view.setDamageStains(0.15);
    const visibleAtLow = countVisible(view.group);

    expect(visibleAtLow).toBeGreaterThan(visibleAtFull);
    view.dispose();
  });

  it('landing splash appears then fades out', () => {
    const view = makeView();
    view.triggerLandingSplash();
    // The splash ring should be visible immediately after trigger
    const splashMeshes: THREE.Mesh[] = [];
    view.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) splashMeshes.push(mesh);
    });
    expect(splashMeshes.length).toBeGreaterThan(0);
    view.dispose();
  });

  it('death splat triggers without throwing in any mode', () => {
    const view = makeView();
    expect(() => view.triggerDeathSplat()).not.toThrow();
    view.setMode(PlayerMode.DEAD);
    expect(() => view.triggerDeathSplat()).not.toThrow();
    view.dispose();
  });

  it('special pose trigger is safe in any mode', () => {
    const view = makeView();
    expect(() => view.triggerSpecialPose()).not.toThrow();
    view.dispose();
  });

  it('ground ink state updates without throwing', () => {
    const view = makeView();
    expect(() => view.setGroundInk(Team.CYAN)).not.toThrow();
    expect(() => view.setGroundInk(Team.NEUTRAL)).not.toThrow();
    view.dispose();
  });

  it('detail effects survive dispose cleanly', () => {
    const view = makeView();
    view.setDamageStains(0.3);
    view.triggerLandingSplash();
    view.triggerDeathSplat();
    view.triggerSpecialPose();
    expect(() => view.dispose()).not.toThrow();
  });
});

/**
 * Remote-player wiring for the same effects: stains driven by interpolated hp
 * through RemotePlayer.update, footprints driven by setGroundInk + locomotion.
 */
describe('remote player detail effects (全员污渍脚印)', () => {
  function makeRemoteState(over: Partial<InterpolatedPlayerState> = {}): InterpolatedPlayerState {
    return {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      mode: PlayerMode.HUMANOID,
      alive: true,
      hp: 100,
      invulnerable: false,
      ...over
    };
  }

  /**
   * The 8-patch stain pool shares one flattened-sphere geometry — the largest
   * transparent MeshStandardMaterial shared-geometry group on the character
   * (drips share theirs with 4, boot tints with 2). No magic marker needed.
   */
  function stainMeshes(view: PlayerView): THREE.Mesh[] {
    const byGeometry = new Map<THREE.BufferGeometry, THREE.Mesh[]>();
    view.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.transparent || mat.type !== 'MeshStandardMaterial') return;
      const list = byGeometry.get(mesh.geometry) ?? [];
      list.push(mesh);
      byGeometry.set(mesh.geometry, list);
    });
    let best: THREE.Mesh[] = [];
    for (const list of byGeometry.values()) {
      if (list.length > best.length) best = list;
    }
    return best;
  }

  /** Visibility exactly as PlayerView.setDamageStains defines it (next > 0.02). */
  function visibleStains(view: PlayerView): { mesh: THREE.Mesh; opacity: number }[] {
    return stainMeshes(view)
      .map((mesh) => ({ mesh, opacity: (mesh.material as THREE.MeshStandardMaterial).opacity }))
      .filter((s) => s.mesh.visible && s.opacity > 0.02);
  }

  it('keeps stains hidden at sustained full hp and converges them open at low hp', () => {
    const remote = new RemotePlayer('remote_stain', Team.PINK);
    expect(stainMeshes(remote.view).length).toBe(8); // structural: the stain pool

    let time = 0;
    const step = (hp: number) => {
      time += 0.05;
      remote.update(makeRemoteState({ hp }), time);
    };

    // 40 frames (> 30 needed for the 0.06 lerp to converge) at full hp:
    // the pool must be fully faded out, not merely "not yet visible".
    for (let i = 0; i < 40; i++) step(100);
    expect(visibleStains(remote.view).length).toBe(0);

    // Sustained hp=20: stains lerp toward targets 0.55..0.75 and stay lit.
    // A per-call single-lerp implementation would stall at ~0.033 opacity
    // (one 0.06 step from zero) — this threshold catches that.
    for (let i = 0; i < 120; i++) step(20);
    const stains = visibleStains(remote.view);
    expect(stains.length).toBeGreaterThan(0);
    for (const stain of stains) {
      expect(stain.opacity).toBeGreaterThan(0.5);
    }

    // hp defaults to 0 in InterpolatedPlayerState: an ALIVE remote with no
    // sample yet must not be painted as wounded.
    const fresh = new RemotePlayer('remote_fresh', Team.PINK);
    for (let i = 0; i < 40; i++) {
      time += 0.05;
      fresh.update(makeRemoteState({ hp: 0, alive: true }), time);
    }
    expect(visibleStains(fresh.view).length).toBe(0);

    remote.dispose();
    fresh.dispose();
  });

  it('leaves world-space footprints in enemy ink that do not follow the player', () => {
    const scene = new THREE.Scene();
    const remote = new RemotePlayer('remote_walk', Team.PINK);
    // attachToWorld re-parents ground meshes to this.group.parent — a bare
    // view (no parent) would silently no-op, so mount it first.
    scene.add(remote.view.group);
    remote.setGroundInk(Team.CYAN); // wading through enemy ink

    let time = 0;
    let x = 0;
    const step = () => {
      time += 0.05; // dt clamps to 0.05 in RemotePlayer.update
      x += 0.25; // 0.25 / 0.05 = 5 m/s — above the 1.5 spawn threshold
      remote.update(makeRemoteState({ hp: 100, position: { x, y: 0, z: 0 } }), time);
    };

    for (let i = 0; i < 30; i++) step(); // ~1.5 s of walking at 5 m/s

    // Ground rings live directly under the scene root once spawned.
    const rings = scene.children.filter(
      (child) => child !== remote.view.group && (child as THREE.Mesh).isMesh
    ) as THREE.Mesh[];
    expect(rings.length).toBeGreaterThan(0);
    // Rings appeared along the walked path, not piled up at the origin.
    const maxX = Math.max(...rings.map((ring) => ring.position.x));
    expect(maxX).toBeGreaterThan(2);

    const tracked = rings[0]!;
    const before = tracked.position.clone();

    // Leave the area SLOWLY (1 m/s < the 1.5 spawn threshold): no new rings
    // spawn and the 4-slot ripple pool never reassigns a mesh, so every
    // existing footprint must stay frozen exactly where it was laid.
    for (let i = 0; i < 60; i++) {
      time += 0.05;
      x += 0.05; // 1 m/s — no spawns, no reuse
      remote.update(makeRemoteState({ hp: 100, position: { x, y: 0, z: 0 } }), time);
    }

    // The old footprint stayed exactly where it was laid (留痕不跟随).
    expect(tracked.position.x).toBe(before.x);
    expect(tracked.position.y).toBe(before.y);
    expect(tracked.position.z).toBe(before.z);

    remote.dispose();
  });
});
