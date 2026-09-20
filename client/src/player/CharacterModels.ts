import * as THREE from 'three';
import { Team } from '@ink/shared';

/** Team color hex values. */
export const PINK_COLOR = 0xff007f;
export const CYAN_COLOR = 0x00ffff;

/** Team-specific accent shade used for clothing/cosmetic coloring. */
const TEAM_COLORS: Record<number, { primary: number; light: number; dark: number; accent: number }> = {
  [PINK_COLOR]: { primary: PINK_COLOR, light: 0xff66b3, dark: 0x990044, accent: 0x331122 },
  [CYAN_COLOR]: { primary: CYAN_COLOR, light: 0x66ffff, dark: 0x009999, accent: 0x113333 }
};

function getTeamShades(teamColor: number) {
  return TEAM_COLORS[teamColor] ?? { primary: teamColor, light: teamColor, dark: 0x333333, accent: 0x111111 };
}

/**
 * Returns a THREE.Group containing a simplified Inkling-style humanoid character.
 *
 * Parts (all standard Three.js primitives):
 * - Torso: box, slightly wider at bottom
 * - Head: sphere
 * - Arms: two cylinders each (upper + forearm) with hand spheres
 * - Legs: two cylinders each (thigh + shin) with foot boxes
 * - Ear fins: two cone shapes on the sides of the head
 * - Eyes: two spheres with pupil
 * - Clothing: colored shirt box on torso, colored pants on legs
 * - Weapon mount: small box at right hand
 *
 * Character dimensions (body center at Y=0.6, head at Y=1.1):
 * - Total height ~1.8 units
 * - Torso height 0.6, head radius 0.2
 */
export function createInklingModel(teamColor: number): THREE.Group {
  const group = new THREE.Group();
  const c = getTeamShades(teamColor);

  // Material helpers
  const teamMat = new THREE.MeshStandardMaterial({ color: c.primary, roughness: 0.4, metalness: 0.1 });
  const teamLightMat = new THREE.MeshStandardMaterial({ color: c.light, roughness: 0.35, metalness: 0.15 });
  const teamDarkMat = new THREE.MeshStandardMaterial({ color: c.dark, roughness: 0.5, metalness: 0.1 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x2a2a35, roughness: 0.7, metalness: 0.05 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  // --- Torso (box, slightly wider at bottom) ---
  const torsoGeo = new THREE.BoxGeometry(0.5, 0.6, 0.35);
  const torso = new THREE.Mesh(torsoGeo, teamMat);
  torso.position.y = 0.6;
  torso.name = 'torso';
  group.add(torso);

  // Torso base (hip section)
  const hipGeo = new THREE.BoxGeometry(0.45, 0.2, 0.3);
  const hip = new THREE.Mesh(hipGeo, teamDarkMat);
  hip.position.y = 0.2;
  hip.name = 'hip';
  group.add(hip);

  // --- Head (sphere) ---
  const headGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const head = new THREE.Mesh(headGeo, teamMat);
  head.position.y = 1.1;
  head.name = 'head';
  group.add(head);

  // Neck
  const neckGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.1, 8);
  const neck = new THREE.Mesh(neckGeo, skinMat);
  neck.position.y = 0.92;
  group.add(neck);

  // --- Ear fins (Inkling-style large ear shapes) ---
  const earGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
  const leftEar = new THREE.Mesh(earGeo, teamLightMat);
  leftEar.position.set(-0.22, 1.1, 0);
  leftEar.rotation.z = Math.PI / 2;
  leftEar.name = 'leftEar';
  group.add(leftEar);

  const rightEar = new THREE.Mesh(earGeo, teamLightMat);
  rightEar.position.set(0.22, 1.1, 0);
  rightEar.rotation.z = -Math.PI / 2;
  rightEar.name = 'rightEar';
  group.add(rightEar);

  // --- Eyes (white sphere + black pupil) ---
  const eyeGeo = new THREE.SphereGeometry(0.04, 8, 6);
  const pupilGeo = new THREE.SphereGeometry(0.02, 6, 4);

  const leftEye = new THREE.Mesh(eyeGeo, whiteMat);
  leftEye.position.set(-0.08, 1.12, -0.18);
  group.add(leftEye);

  const leftPupil = new THREE.Mesh(pupilGeo, blackMat);
  leftPupil.position.set(-0.08, 1.12, -0.22);
  group.add(leftPupil);

  const rightEye = new THREE.Mesh(eyeGeo, whiteMat);
  rightEye.position.set(0.08, 1.12, -0.18);
  group.add(rightEye);

  const rightPupil = new THREE.Mesh(pupilGeo, blackMat);
  rightPupil.position.set(0.08, 1.12, -0.22);
  group.add(rightPupil);

  // --- Nose (small sphere) ---
  const noseGeo = new THREE.SphereGeometry(0.02, 6, 4);
  const nose = new THREE.Mesh(noseGeo, teamDarkMat);
  nose.position.set(0, 1.08, -0.2);
  group.add(nose);

  // --- Arms (upper + forearm + hand for each side) ---
  function createArm(side: number): THREE.Group {
    const armGroup = new THREE.Group();
    armGroup.name = side < 0 ? 'leftArm' : 'rightArm';
    armGroup.position.set(side * 0.28, 0.75, 0);

    // Shoulder joint
    const shoulderGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const shoulder = new THREE.Mesh(shoulderGeo, skinMat);
    armGroup.add(shoulder);

    // Upper arm (cylinder)
    const upperGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.25, 8);
    const upper = new THREE.Mesh(upperGeo, skinMat);
    upper.position.y = -0.15;
    armGroup.add(upper);

    // Elbow joint
    const elbowGeo = new THREE.SphereGeometry(0.05, 6, 4);
    const elbow = new THREE.Mesh(elbowGeo, skinMat);
    elbow.position.y = -0.28;
    armGroup.add(elbow);

    // Forearm (cylinder)
    const foreGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.22, 8);
    const forearm = new THREE.Mesh(foreGeo, skinMat);
    forearm.position.y = -0.4;
    armGroup.add(forearm);

    // Hand (sphere)
    const handGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const hand = new THREE.Mesh(handGeo, teamLightMat);
    hand.position.y = -0.53;
    armGroup.add(hand);

    return armGroup;
  }

  const leftArm = createArm(-1);
  group.add(leftArm);
  const rightArm = createArm(1);
  group.add(rightArm);

  // --- Weapon mount (small box at right hand) ---
  const mountGeo = new THREE.BoxGeometry(0.08, 0.06, 0.12);
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.4 });
  const weaponMount = new THREE.Mesh(mountGeo, mountMat);
  weaponMount.position.set(0.05, 0, -0.05);
  weaponMount.name = 'weaponMount';
  rightArm.add(weaponMount);

  // --- Clothing: shirt on torso ---
  const shirtGeo = new THREE.BoxGeometry(0.52, 0.45, 0.37);
  const shirt = new THREE.Mesh(shirtGeo, teamLightMat);
  shirt.position.y = 0.62;
  shirt.name = 'shirt';
  group.add(shirt);

  // --- Legs (thigh + shin + foot for each side) ---
  function createLeg(side: number): THREE.Group {
    const legGroup = new THREE.Group();
    legGroup.name = side < 0 ? 'leftLeg' : 'rightLeg';
    legGroup.position.set(side * 0.12, 0.2, 0);

    // Thigh (cylinder)
    const thighGeo = new THREE.CylinderGeometry(0.07, 0.065, 0.3, 8);
    const thigh = new THREE.Mesh(thighGeo, teamDarkMat);
    thigh.position.y = -0.15;
    legGroup.add(thigh);

    // Knee
    const kneeGeo = new THREE.SphereGeometry(0.06, 6, 4);
    const knee = new THREE.Mesh(kneeGeo, skinMat);
    knee.position.y = -0.3;
    legGroup.add(knee);

    // Shin (cylinder)
    const shinGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.28, 8);
    const shin = new THREE.Mesh(shinGeo, teamDarkMat);
    shin.position.y = -0.45;
    legGroup.add(shin);

    // Foot (box)
    const footGeo = new THREE.BoxGeometry(0.12, 0.08, 0.2);
    const foot = new THREE.Mesh(footGeo, skinMat);
    foot.position.set(0, -0.6, -0.03);
    legGroup.add(foot);

    return legGroup;
  }

  const leftLeg = createLeg(-1);
  group.add(leftLeg);
  const rightLeg = createLeg(1);
  group.add(rightLeg);

  // --- Clothing: pants on legs ---
  const pantsGeo = new THREE.BoxGeometry(0.4, 0.22, 0.32);
  const pants = new THREE.Mesh(pantsGeo, teamDarkMat);
  pants.position.y = 0.18;
  pants.name = 'pants';
  group.add(pants);

  // Set overall position: body center at Y=0.6
  group.position.y = 0;

  return group;
}

/**
 * Returns a THREE.Group containing a simplified squid/octopus-like swimming form.
 *
 * Parts:
 * - Tapered body (cone) pointing down
 * - Smaller head sphere at top
 * - 8 tentacle cylinders (4 on each side) with slight wave
 * - Swimming fin shapes on the sides
 *
 * Character dimensions (total height ~0.5 units for swimming pose).
 */
export function createSquidModel(teamColor: number): THREE.Group {
  const group = new THREE.Group();
  const c = getTeamShades(teamColor);

  const teamMat = new THREE.MeshStandardMaterial({ color: c.primary, roughness: 0.3, metalness: 0.2 });
  const teamDarkMat = new THREE.MeshStandardMaterial({ color: c.dark, roughness: 0.5, metalness: 0.1 });
  const teamLightMat = new THREE.MeshStandardMaterial({ color: c.light, roughness: 0.35, metalness: 0.15 });

  // --- Tapered body (cone tapering to point, wide at top) ---
  const bodyGeo = new THREE.ConeGeometry(0.25, 0.4, 12, 1, false);
  bodyGeo.rotateZ(Math.PI); // Point downward
  const body = new THREE.Mesh(bodyGeo, teamMat);
  body.position.y = 0.2;
  body.name = 'squidBody';
  group.add(body);

  // --- Head sphere at top ---
  const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
  const head = new THREE.Mesh(headGeo, teamMat);
  head.position.y = 0.42;
  head.name = 'squidHead';
  group.add(head);

  // --- Eyes on head ---
  const eyeWhiteGeo = new THREE.SphereGeometry(0.04, 6, 4);
  const eyePupilGeo = new THREE.SphereGeometry(0.02, 4, 4);
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    eye.position.set(side * 0.06, 0.44, -0.1);
    group.add(eye);

    const pupil = new THREE.Mesh(eyePupilGeo, blackMat);
    pupil.position.set(side * 0.06, 0.44, -0.13);
    group.add(pupil);
  }

  // --- 8 tentacles (4 on each side) with wave offsets ---
  const tentacleBasePositions = [
    { x: -0.14, z: 0.15, len: 0.28 },
    { x: 0.14, z: 0.15, len: 0.28 },
    { x: -0.07, z: 0.2, len: 0.22 },
    { x: 0.07, z: 0.2, len: 0.22 }
  ];

  const tentacleGeo = new THREE.CylinderGeometry(0.04, 0.02, 0.3, 6);

  for (const spec of tentacleBasePositions) {
    // Right side
    const tentacle = new THREE.Mesh(tentacleGeo, teamDarkMat);
    tentacle.position.set(spec.x, -0.1, spec.z + 0.1);
    tentacle.rotation.x = 0.3;
    tentacle.name = 'tentacleR';
    group.add(tentacle);

    // Left side (mirrored)
    const tentacleL = new THREE.Mesh(tentacleGeo, teamDarkMat);
    tentacleL.position.set(-spec.x, -0.1, spec.z + 0.1);
    tentacleL.rotation.x = 0.3;
    tentacleL.name = 'tentacleL';
    group.add(tentacleL);
  }

  // --- Swim fins (flat shapes on the sides of the body) ---
  const finGeo = new THREE.BoxGeometry(0.04, 0.12, 0.2);
  const finR = new THREE.Mesh(finGeo, teamLightMat);
  finR.position.set(0.25, 0.18, 0.05);
  finR.rotation.z = -0.3;
  finR.name = 'finRight';
  group.add(finR);

  const finL = new THREE.Mesh(finGeo, teamLightMat);
  finL.position.set(-0.25, 0.18, 0.05);
  finL.rotation.z = 0.3;
  finL.name = 'finLeft';
  group.add(finL);

  // --- Dorsal ridge on top of body ---
  const ridgeGeo = new THREE.ConeGeometry(0.06, 0.15, 4);
  const ridge = new THREE.Mesh(ridgeGeo, teamLightMat);
  ridge.position.set(0, 0.46, 0.05);
  ridge.rotation.x = 0.2;
  ridge.name = 'dorsalRidge';
  group.add(ridge);

  // Set position: squid sits lower than humanoid
  group.position.y = 0;

  return group;
}

/**
 * Disposes all geometries and materials in the group hierarchy.
 */
export function disposeModelGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
  group.clear();
}

/**
 * Creates a transition-ready pair: both humanoid and squid models, with
 * the squid model initially hidden.
 */
export function createCharacterModelPair(teamColor: number): {
  inkling: THREE.Group;
  squid: THREE.Group;
} {
  const inkling = createInklingModel(teamColor);
  const squid = createSquidModel(teamColor);
  squid.visible = false;
  return { inkling, squid };
}

/**
 * Animates the transition between humanoid and squid forms.
 * humanoid -> 0 scale, squid -> 1 scale over 0.3s.
 *
 * @param humanoid - The humanoid group to hide (scale down to 0)
 * @param squid - The squid group to show (scale up from 0)
 * @param dt - Delta time in seconds
 * @returns true when transition is complete
 */
export function animateFormTransition(
  humanoid: THREE.Group,
  squid: THREE.Group,
  dt: number
): boolean {
  const speed = 3.0; // 0.3s full transition at ~33ms/frame
  const step = dt * speed * 10;

  // Scale humanoid down
  const hScale = Math.max(0, humanoid.scale.x - step);
  humanoid.scale.setScalar(hScale);
  if (hScale <= 0) {
    humanoid.visible = false;
  }

  // Scale squid up
  const sScale = Math.min(1, squid.scale.x + step);
  squid.scale.setScalar(sScale);
  squid.visible = true;

  return hScale <= 0 && sScale >= 1;
}

/**
 * Animates the reverse transition: squid -> humanoid.
 * @returns true when transition is complete
 */
export function animateHumanoidTransition(
  humanoid: THREE.Group,
  squid: THREE.Group,
  dt: number
): boolean {
  const speed = 3.0;
  const step = dt * speed * 10;

  // Scale squid down
  const sScale = Math.max(0, squid.scale.x - step);
  squid.scale.setScalar(sScale);
  if (sScale <= 0) {
    squid.visible = false;
  }

  // Scale humanoid up
  const hScale = Math.min(1, humanoid.scale.x + step);
  humanoid.scale.setScalar(hScale);
  humanoid.visible = true;

  return hScale >= 1 && sScale <= 0;
}

/**
 * Applies idle bob animation (sin wave Y offset, period 2s, amplitude 0.05).
 */
export function applyIdleBob(group: THREE.Group, time: number, amplitude = 0.05): void {
  group.position.y = amplitude * Math.sin(time * Math.PI);
}

/**
 * Applies walk cycle: arms swing, legs alternate, increased bob.
 * @param group - Root character group
 * @param time - Time in seconds
 * @param speed - Current speed (0-10+)
 */
export function applyWalkAnimation(
  group: THREE.Group,
  time: number,
  speed: number
): void {
  const phase = time * Math.min(speed, 5) * 2;
  const bobAmp = 0.03 + Math.min(speed * 0.01, 0.05);

  // Body bob
  group.position.y = Math.abs(Math.sin(phase)) * bobAmp;

  // Arms swing
  const armSwing = Math.sin(phase) * Math.min(speed * 0.05, 0.5);
  const leftArm = group.getObjectByName('leftArm');
  const rightArm = group.getObjectByName('rightArm');
  if (leftArm) leftArm.rotation.x = armSwing;
  if (rightArm) rightArm.rotation.x = -armSwing;

  // Legs alternate
  const legSwing = Math.sin(phase) * Math.min(speed * 0.04, 0.4);
  const leftLeg = group.getObjectByName('leftLeg');
  const rightLeg = group.getObjectByName('rightLeg');
  if (leftLeg) leftLeg.rotation.x = legSwing;
  if (rightLeg) rightLeg.rotation.x = -legSwing;
}

/**
 * Applies swim/squid animation: tentacles ripple, body elongates slightly.
 */
export function applySwimAnimation(group: THREE.Group, time: number): void {
  // Body slight elongation
  const stretch = 1.0 + Math.sin(time * 4) * 0.05;
  group.scale.y = stretch;

  // Tentacle ripple
  group.traverse((child) => {
    if (child.name === 'tentacleR' || child.name === 'tentacleL') {
      const baseZ = child.name === 'tentacleR' ? 0.15 : -0.15;
      child.rotation.z = Math.sin(time * 6 + baseZ * 20) * 0.2;
      child.rotation.x = 0.3 + Math.sin(time * 4 + child.position.x * 10) * 0.15;
    }
    if (child.name === 'finRight' || child.name === 'finLeft') {
      child.rotation.x = 0.25 + Math.sin(time * 8 + (child.name === 'finRight' ? 0 : Math.PI)) * 0.2;
    }
  });
}

/**
 * Applies jump animation: arms up, legs together.
 */
export function applyJumpAnimation(group: THREE.Group): void {
  const leftArm = group.getObjectByName('leftArm');
  const rightArm = group.getObjectByName('rightArm');
  const leftLeg = group.getObjectByName('leftLeg');
  const rightLeg = group.getObjectByName('rightLeg');

  if (leftArm) leftArm.rotation.x = -2.5;
  if (rightArm) rightArm.rotation.x = -2.5;
  if (leftLeg) leftLeg.rotation.x = 0.1;
  if (rightLeg) rightLeg.rotation.x = -0.1;
}

/**
 * Applies landing squash effect: Y scale down, XZ scale up briefly.
 * @param progress - 0 to 1 (0 = moment of impact, 1 = fully recovered)
 */
export function applyLandingSquash(group: THREE.Group, progress: number): void {
  const squash = 1.0 - 0.3 * Math.max(0, 1 - progress * 2);
  const stretch = 1.0 + 0.15 * Math.max(0, 1 - progress * 2);
  group.scale.set(stretch, squash, stretch);
}

/**
 * Gets the weapon mount world position for attaching a weapon mesh.
 * @param group - The character group
 * @param target - Vector3 to fill with the result
 */
export function getWeaponMountPosition(group: THREE.Group, target: THREE.Vector3): THREE.Vector3 {
  const mount = group.getObjectByName('weaponMount');
  if (mount) {
    mount.updateMatrixWorld(true);
    return target.set(0, 0, 0).applyMatrix4(mount.matrixWorld);
  }
  // Default: right hand area
  return target.set(0.33, 0.22, -0.05).applyMatrix4(group.matrixWorld);
}
