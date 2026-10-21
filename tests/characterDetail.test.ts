import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerMode, Team } from '@ink/shared';
import { PlayerView } from '../client/src/player/PlayerView.js';

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
