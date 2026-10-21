import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerMode, Team } from '@ink/shared';
import { PlayerView } from '../client/src/player/PlayerView.js';

/**
 * Regression tests for the two "tinting does not render" bugs:
 *
 * 1. Ink stains were centred at radius 0.12-0.24 while the torso shell is a
 *    cylinder of radius 0.30-0.34, so every stain sat INSIDE the body mesh and
 *    never drew a pixel. They must now sit on the surface (radius >= 0.32).
 *
 * 2. Footstep ripples / landing splash / death splat were children of the
 *    character group (already translated to the player's world position) but
 *    were positioned with world coordinates, so they rendered at double the
 *    player offset. They must now be parented to the scene and positioned in
 *    world space.
 */

const TORSO_RADIUS = 0.34; // widest point of the torso cylinder

function buildSceneView(): { scene: THREE.Scene; view: PlayerView } {
  const scene = new THREE.Scene();
  const view = new PlayerView(Team.PINK);
  scene.add(view.group);
  return { scene, view };
}

function stainMeshes(view: PlayerView): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  // Stains are the transparent enemy-coloured standard materials on the body.
  view.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && mat.transparent && mat.opacity >= 0 && mat.color.getHex() === 0x00ffff) {
      // Enemy ink colour for a PINK team view is cyan.
      if (mesh.geometry.type === 'SphereGeometry') out.push(mesh);
    }
  });
  return out;
}

describe('ink stain placement (rendering regression)', () => {
  it('places every stain outside the torso shell so it is visible', () => {
    const { view } = buildSceneView();
    const stains = stainMeshes(view);
    expect(stains.length).toBeGreaterThan(0);

    for (const stain of stains) {
      const radius = Math.hypot(stain.position.x, stain.position.z);
      // The stain centre must be at/just outside the widest torso radius,
      // otherwise the torso mesh hides it entirely.
      expect(radius).toBeGreaterThanOrEqual(TORSO_RADIUS - 0.02);
    }
    view.dispose();
  });

  it('flattens stains radially so they read as splotches, not floating balls', () => {
    const { view } = buildSceneView();
    const stains = stainMeshes(view);
    for (const stain of stains) {
      // Local Z is rotated radially outward; it must be the squashed axis.
      expect(stain.scale.z).toBeLessThan(stain.scale.x * 0.6);
      expect(stain.scale.z).toBeLessThan(stain.scale.y);
    }
    view.dispose();
  });

  it('shows progressively more stains as HP drops', () => {
    const { view } = buildSceneView();
    const stains = stainMeshes(view);

    const visibleCount = (): number => stains.filter((s) => s.visible).length;

    view.setDamageStains(1);
    const atFull = visibleCount();

    for (let i = 0; i < 120; i++) view.setDamageStains(0.1);
    const atLow = visibleCount();

    expect(atLow).toBeGreaterThan(atFull);
    expect(atLow).toBeGreaterThan(0);
    view.dispose();
  });
});

describe('ground effects use world space (rendering regression)', () => {
  it('re-parents the landing splash to the scene at the player world position', () => {
    const { scene, view } = buildSceneView();
    view.setTransform({ x: 20, y: 0, z: -8 }, 0);

    view.triggerLandingSplash();

    // The splash must no longer be a child of the character group...
    const splash = scene.children.find(
      (c): c is THREE.Mesh =>
        (c as THREE.Mesh).isMesh === true &&
        (c as THREE.Mesh).geometry.type === 'RingGeometry' &&
        (c as THREE.Mesh).visible
    );
    expect(splash).toBeTruthy();
    // ...and must sit exactly at the player's world position (not 2x).
    expect(splash!.position.x).toBeCloseTo(20, 3);
    expect(splash!.position.z).toBeCloseTo(-8, 3);

    view.dispose();
  });

  it('re-parents the death splat to the scene at the player world position', () => {
    const { scene, view } = buildSceneView();
    view.setTransform({ x: -12, y: 0, z: 6 }, 0);

    view.triggerDeathSplat();

    const splat = scene.children.find(
      (c): c is THREE.Mesh =>
        (c as THREE.Mesh).isMesh === true &&
        (c as THREE.Mesh).geometry.type === 'RingGeometry' &&
        (c as THREE.Mesh).visible
    );
    expect(splat).toBeTruthy();
    expect(splat!.position.x).toBeCloseTo(-12, 3);
    expect(splat!.position.z).toBeCloseTo(6, 3);

    view.dispose();
  });

  it('footstep ripples stay behind while the player keeps running', () => {
    const { scene, view } = buildSceneView();
    view.setTransform({ x: 0, y: 0, z: 0 }, 0);
    view.setGroundInk(Team.CYAN); // enemy ink triggers ripples
    view.setMode(PlayerMode.HUMANOID);

    // Walk fast for long enough to spawn a ripple (0.32s cadence).
    for (let i = 0; i < 40; i++) {
      view.updateLocomotion(1 / 30, 5, true, 0);
    }
    const ripple = scene.children.find(
      (c): c is THREE.Mesh =>
        (c as THREE.Mesh).isMesh === true &&
        (c as THREE.Mesh).geometry.type === 'RingGeometry' &&
        (c as THREE.Mesh).visible
    );
    expect(ripple).toBeTruthy();
    const laidAtX = ripple!.position.x;

    // Move the player far away; the footprint must NOT follow.
    view.setTransform({ x: 30, y: 0, z: 30 }, 0);
    view.updateLocomotion(1 / 30, 0, true, 0);

    expect(ripple!.position.x).toBeCloseTo(laidAtX, 3);
    view.dispose();
  });

  it('removes every ground effect from the scene on dispose', () => {
    const { scene, view } = buildSceneView();
    view.setTransform({ x: 4, y: 0, z: 4 }, 0);
    view.triggerLandingSplash();
    view.triggerDeathSplat();

    const before = scene.children.length;
    view.dispose();
    const after = scene.children.length;

    expect(after).toBeLessThan(before);
  });
});

describe('enemy boot tint shell', () => {
  it('wraps the boot box so the tint is not swallowed by the boot geometry', () => {
    const { view } = buildSceneView();
    // The tint material is the only transparent standard material whose colour
    // matches the enemy team on the legs.
    const shells: THREE.Mesh[] = [];
    view.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.transparent && mat.color.getHex() === 0x00ffff) {
        if (mesh.geometry.type === 'BoxGeometry') shells.push(mesh);
      }
    });
    expect(shells.length).toBe(2);
    // Box shell must be strictly larger than the 0.16 x 0.12 x 0.25 boot.
    for (const shell of shells) {
      const params = (shell.geometry as THREE.BoxGeometry).parameters;
      expect(params.width).toBeGreaterThan(0.16);
      expect(params.height).toBeGreaterThan(0.12);
      expect(params.depth).toBeGreaterThan(0.25);
    }
    view.dispose();
  });
});
