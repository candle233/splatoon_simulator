import * as THREE from 'three';
import type { WeaponType } from '@ink/shared';

/**
 * Distinct 3D weapon mesh factory. Returns a world-space group whose visual
 * centre sits at the origin; the caller positions / attaches it under the
 * player's weapon-anchor group. Every branch produces a unique silhouette so
 * eight weapon types never look the same on screen.
 *
 * @param weaponType One of the eight weapon ids declared in shared/src/types.ts
 * @param teamColorHex Team colour to apply to the body (0xff007f pink / 0x00ffff cyan)
 * @param options Optional tuning values (default arm-pose offset, barrel length, etc.)
 */
export interface WeaponMeshOptions {
  /** How far forward the barrel points in weapon-anchor local space (default 0). */
  barrelOffsetZ?: number;
  /** Additional Z offset for the whole weapon within the anchor (default 0). */
  groupOffsetZ?: number;
  /** Scale factor applied after construction (default 1). */
  scale?: number;
}

export function createWeaponMesh(
  weaponType: WeaponType,
  teamColorHex: number,
  options: WeaponMeshOptions = {}
): THREE.Group {
  const { barrelOffsetZ = 0, groupOffsetZ = 0, scale = 1 } = options;
  const group = new THREE.Group();
  group.position.z = groupOffsetZ;

  // ---- palette -----------------------------------------------------------
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1e1e24, roughness: 0.7, metalness: 0.35
  });
  const softMat = new THREE.MeshStandardMaterial({
    color: 0x33333d, roughness: 0.85, metalness: 0.1
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x141419, roughness: 0.95, metalness: 0.05
  });
  const teamMat = new THREE.MeshStandardMaterial({
    color: teamColorHex, roughness: 0.35, metalness: 0.2
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6f0, roughness: 0.25, metalness: 0.6
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.5,
    roughness: 0.1, transmission: 0.8
  });

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    group.add(m);
    return m;
  };

  // ---- weapon-specific geometry ------------------------------------------
  switch (weaponType) {
    case 'shooter': {
      // Ink Blaster: boxy splattershot with twin triggers and ammo drum
      const barrelLen = 0.6;
      mesh(new THREE.CylinderGeometry(0.055, 0.075, barrelLen, 10), darkMat)
        .rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.09, 0.09, barrelLen + 0.1, 10), darkMat)
        .position.z = -(barrelLen / 2 + 0.05);
      // Upper receiver
      mesh(new THREE.BoxGeometry(0.14, 0.17, 0.32), teamMat);
      // Lower receiver
      mesh(new THREE.BoxGeometry(0.13, 0.13, 0.24), softMat)
        .position.y = -0.1;
      // Rear sight post
      mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), trimMat)
        .position.set(0, 0.1, -0.1);
      // Front sight
      mesh(new THREE.BoxGeometry(0.015, 0.03, 0.015), trimMat)
        .position.set(0, 0.09, -barrelLen - 0.02);
      // Grip / trigger guard
      const shooterGrip = mesh(new THREE.BoxGeometry(0.08, 0.18, 0.09), darkMat);
      shooterGrip.position.set(0, -0.14, 0.12);
      shooterGrip.rotation.x = 0.25;
      // Trigger guard
      mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 12, Math.PI), trimMat)
        .position.set(0, -0.1, 0.08);
      // Side grip panels
      mesh(new THREE.BoxGeometry(0.04, 0.1, 0.06), rubberMat)
        .position.set(0.09, -0.05, 0.18);
      // Ammo feed door
      mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), darkMat)
        .position.set(-0.08, 0.04, -0.02);
      // Tank port
      mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 8), trimMat)
        .position.set(0, 0.1, -0.35);
      break;
    }

    case 'roller': {
      // Ink Roller: wide cylindrical drum with dual side grips
      const drumR = 0.22;
      const drumH = 1.5;
      const handleLen = 0.9;
      // Drum body
      mesh(new THREE.CylinderGeometry(drumR, drumR, drumH, 16), teamMat)
        .rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(drumR + 0.01, drumR + 0.01, drumH, 16), darkMat)
        .rotation.z = Math.PI / 2;
      // Drum end caps
      mesh(new THREE.CylinderGeometry(drumR + 0.02, drumR + 0.02, 0.04, 16), trimMat)
        .position.x = -drumH / 2;
      mesh(new THREE.CylinderGeometry(drumR + 0.02, drumR + 0.02, 0.04, 16), trimMat)
        .position.x = drumH / 2;
      // Central shaft
      mesh(new THREE.CylinderGeometry(0.035, 0.035, handleLen, 8), darkMat)
        .position.set(0, 0.1, -0.15);
      // Grip top
      mesh(new THREE.BoxGeometry(0.08, 0.06, 0.28), softMat)
        .position.set(0, 0.1, -0.25);
      // Bottom end cap
      mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), darkMat)
        .position.set(0, -0.35, -0.6);
      // Side ribbing on drum
      for (const rx of [-0.5, 0, 0.5]) {
        mesh(new THREE.TorusGeometry(drumR + 0.015, 0.012, 4, 20), darkMat)
          .position.x = rx;
      }
      // Ink nozzles at drum ends
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), darkMat)
        .position.set(-drumH / 2 - 0.04, 0, 0);
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), darkMat)
        .position.set(drumH / 2 + 0.04, 0, 0);
      break;
    }

    case 'charger': {
      // Ink Sniper: long slim rifle with elevated scope
      const barrelLen = 1.2;
      // Main body / receiver
      mesh(new THREE.BoxGeometry(0.09, 0.14, 0.42), darkMat);
      // Barrel shroud
      const bShroud = mesh(new THREE.CylinderGeometry(0.035, 0.04, barrelLen, 10), softMat);
      bShroud.rotation.z = Math.PI / 2;
      bShroud.position.z = -(barrelLen / 2 + 0.1);
      // Muzzle brake
      const mBrake = mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 10), darkMat);
      mBrake.rotation.z = Math.PI / 2;
      mBrake.position.z = -barrelLen - 0.15;
      // Scope mount base
      mesh(new THREE.BoxGeometry(0.06, 0.04, 0.12), darkMat)
        .position.set(0, 0.09, -0.05);
      // Scope tube
      const scopeTube = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 10), softMat);
      scopeTube.rotation.z = Math.PI / 2;
      scopeTube.position.set(0, 0.17, -0.1);
      // Front and rear lens
      const fLens = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), trimMat);
      fLens.rotation.z = Math.PI / 2;
      fLens.position.set(0, 0.17, -0.23);
      const rLens = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), trimMat);
      rLens.rotation.z = Math.PI / 2;
      rLens.position.set(0, 0.17, 0.01);
      // Stock
      mesh(new THREE.BoxGeometry(0.07, 0.13, 0.28), darkMat)
        .position.set(0, -0.02, 0.25);
      // Shoulder pad
      mesh(new THREE.BoxGeometry(0.1, 0.18, 0.06), softMat)
        .position.set(0, -0.02, 0.36);
      // Butt plate
      mesh(new THREE.BoxGeometry(0.08, 0.16, 0.02), darkMat)
        .position.set(0, -0.02, 0.4);
      // Grip
      const chargerGrip = mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), darkMat);
      chargerGrip.position.set(0, -0.12, 0.08);
      chargerGrip.rotation.x = 0.15;
      // Trigger guard
      mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12, Math.PI), trimMat)
        .position.set(0, -0.09, 0.02);
      // Rail sections (top of receiver)
      mesh(new THREE.BoxGeometry(0.05, 0.015, 0.2), darkMat)
        .position.set(0, 0.075, -0.05);
      break;
    }

    case 'slosher': {
      // Ink Bucket: spherical bucket body with spout and handle
      const bodyR = 0.26;
      // Bucket body (half-sphere cut)
      mesh(new THREE.SphereGeometry(bodyR, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), teamMat);
      // Bucket rim
      mesh(new THREE.TorusGeometry(bodyR, 0.02, 8, 20), trimMat)
        .rotation.x = Math.PI / 2;
      // Handle arc
      mesh(new THREE.TorusGeometry(0.2, 0.018, 6, 16, Math.PI), darkMat);
      // Spout
      const slosherSpout = mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.14, 8), darkMat);
      slosherSpout.position.set(bodyR - 0.02, bodyR * 0.3, 0);
      slosherSpout.rotation.z = -0.5;
      // Handle attachment points
      mesh(new THREE.SphereGeometry(0.02, 6, 6), trimMat)
        .position.set(-bodyR + 0.02, bodyR * 0.25, 0);
      mesh(new THREE.SphereGeometry(0.02, 6, 6), trimMat)
        .position.set(bodyR - 0.02, bodyR * 0.25, 0);
      // Barrel (shaft going into character's hand)
      const slosherBarrel = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), darkMat);
      slosherBarrel.position.set(0, -0.12, -0.25);
      slosherBarrel.rotation.x = 0.3;
      // Grip
      mesh(new THREE.BoxGeometry(0.08, 0.08, 0.12), softMat)
        .position.set(0, -0.38, -0.35);
      // Decorative rivets
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI - Math.PI * 0.3;
        mesh(new THREE.SphereGeometry(0.012, 6, 6), trimMat)
          .position.set(Math.cos(a) * bodyR * 0.95, Math.sin(a) * bodyR * 0.6, 0.08);
      }
      break;
    }

    case 'sprayer': {
      // Ink Sprayer: compact rapid-fire mist gun with top tank
      const bodyW = 0.13, bodyH = 0.1, bodyD = 0.32;
      // Main body
      mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyD), softMat);
      // Barrel
      const sprBarrel = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), darkMat);
      sprBarrel.rotation.z = Math.PI / 2;
      sprBarrel.position.z = -(bodyD / 2 + 0.08);
      // Nozzle tip
      const sprNozzle = mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.04, 8), trimMat);
      sprNozzle.rotation.z = Math.PI / 2;
      sprNozzle.position.z = -(bodyD + 0.16);
      // Top ink tank (visible)
      mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 10), glassMat)
        .position.set(0, bodyH / 2 + 0.12, -0.02);
      // Tank cap
      mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 10), darkMat)
        .position.set(0, bodyH / 2 + 0.225, -0.02);
      // Grip
      mesh(new THREE.BoxGeometry(0.07, 0.18, 0.09), darkMat)
        .position.set(0, -0.15, 0.04);
      // Trigger
      mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), trimMat)
        .position.set(0, -0.07, 0.1);
      // Magazine well
      mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), darkMat)
        .position.set(0, -0.08, -0.06);
      // Side rail / accessory mount
      mesh(new THREE.BoxGeometry(0.02, 0.06, 0.18), softMat)
        .position.set(bodyW / 2 + 0.01, 0, -0.02);
      break;
    }

    case 'cannon': {
      // Ink Mortar: wide round body with tubular barrel and spring base
      const bodyR = 0.2;
      // Main round body
      mesh(new THREE.SphereGeometry(bodyR, 16, 12), teamMat);
      // Barrel ring around body
      mesh(new THREE.TorusGeometry(bodyR + 0.01, 0.02, 6, 18), darkMat)
        .rotation.x = Math.PI / 2;
      // Barrel
      const canBarrel = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 10), darkMat);
      canBarrel.rotation.z = Math.PI / 2;
      canBarrel.position.z = -(bodyR + 0.4);
      // Muzzle brake
      const canMuzzle = mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.08, 10), softMat);
      canMuzzle.rotation.z = Math.PI / 2;
      canMuzzle.position.z = -(bodyR + 0.75);
      // Sight
      mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), trimMat)
        .position.set(0, bodyR + 0.03, -0.15);
      // Recoil spring housing (below barrel)
      const canSpringHousing = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 8), darkMat);
      canSpringHousing.rotation.z = Math.PI / 2;
      canSpringHousing.position.set(0, -bodyR - 0.05, -0.15);
      // Spring coils visualised as torus links
      for (let i = 0; i < 4; i++) {
        mesh(new THREE.TorusGeometry(0.055, 0.008, 4, 12), softMat)
          .position.set(0, -bodyR - 0.02 + i * 0.04, -0.22 - i * 0.01);
      }
      // Grip / stock
      const cannonStock = mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), darkMat);
      cannonStock.position.set(0, -bodyR - 0.16, 0.1);
      cannonStock.rotation.x = -0.15;
      // Bottom plate
      const canBottomPlate = mesh(new THREE.CylinderGeometry(bodyR + 0.03, bodyR + 0.03, 0.04, 16), trimMat);
      canBottomPlate.rotation.x = Math.PI / 2;
      canBottomPlate.position.z = bodyR;
      break;
    }

    case 'marksman': {
      // Ink Marksman: semi-auto rifle with open stock and scope
      const barrelLen = 0.9;
      // Receiver body
      mesh(new THREE.BoxGeometry(0.085, 0.12, 0.32), darkMat);
      // Barrel shroud
      const mkBarrel = mesh(new THREE.CylinderGeometry(0.03, 0.035, barrelLen, 10), softMat);
      mkBarrel.rotation.z = Math.PI / 2;
      mkBarrel.position.z = -(barrelLen / 2 + 0.12);
      // Muzzle
      const mkMuzzle = mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.06, 10), darkMat);
      mkMuzzle.rotation.z = Math.PI / 2;
      mkMuzzle.position.z = -(barrelLen + 0.15);
      // Scope
      const mkScope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), softMat);
      mkScope.rotation.z = Math.PI / 2;
      mkScope.position.set(0, 0.1, -0.08);
      // Scope rings
      for (const sz of [-0.12, 0.04]) {
        mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), darkMat)
          .position.set(0, 0.1, sz);
      }
      // Open-stock frame
      mesh(new THREE.BoxGeometry(0.04, 0.14, 0.26), darkMat)
        .position.set(0, -0.01, 0.2);
      // Stock butt pad
      mesh(new THREE.BoxGeometry(0.07, 0.12, 0.04), softMat)
        .position.set(0, -0.01, 0.35);
      // Grip
      const marksmanGrip = mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), darkMat);
      marksmanGrip.position.set(0, -0.1, 0.06);
      marksmanGrip.rotation.x = 0.2;
      // Trigger guard
      mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), trimMat)
        .position.set(0, -0.06, 0.02);
      // Iron sights
      mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), trimMat)
        .position.set(0, 0.085, -(barrelLen * 0.3 + 0.05));
      mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), trimMat)
        .position.set(0, 0.065, 0.12);
      // Bipod stowed along barrel
      mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), darkMat)
        .position.set(0, -0.06, -(barrelLen * 0.4 + 0.08));
      break;
    }

    case 'scatter': {
      // Ink Scatter: double-barrel shotgun with pump action
      const barrelLen = 0.45;
      // Receiver
      mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), darkMat);
      // Left barrel
      const scatterLeftBarrel = mesh(new THREE.CylinderGeometry(0.04, 0.04, barrelLen, 10), darkMat);
      scatterLeftBarrel.rotation.z = Math.PI / 2;
      scatterLeftBarrel.position.set(-0.03, 0.03, -(barrelLen / 2 + 0.1));
      // Right barrel
      const scatterRightBarrel = mesh(new THREE.CylinderGeometry(0.04, 0.04, barrelLen, 10), darkMat);
      scatterRightBarrel.rotation.z = Math.PI / 2;
      scatterRightBarrel.position.set(0.03, 0.03, -(barrelLen / 2 + 0.1));
      // Barrel under-rib
      mesh(new THREE.BoxGeometry(0.08, 0.03, barrelLen * 0.7), softMat)
        .position.set(0, -0.01, -(barrelLen / 2 + 0.05));
      // Pump action handle
      mesh(new THREE.BoxGeometry(0.07, 0.06, 0.12), darkMat)
        .position.set(0, -0.03, -0.05);
      // Pump grip rails
      mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), softMat)
        .position.set(0, -0.03, 0.06);
      // Stock
      mesh(new THREE.BoxGeometry(0.09, 0.14, 0.22), darkMat)
        .position.set(0, -0.01, 0.2);
      // Butt plate
      mesh(new THREE.BoxGeometry(0.1, 0.15, 0.03), softMat)
        .position.set(0, -0.01, 0.33);
      // Grip
      const scatterGrip = mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), darkMat);
      scatterGrip.position.set(0, -0.1, 0.04);
      scatterGrip.rotation.x = 0.15;
      // Trigger guard
      mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), trimMat)
        .position.set(0, -0.06, 0.02);
      // Sight bead
      mesh(new THREE.SphereGeometry(0.012, 6, 6), trimMat)
        .position.set(0, 0.03, -(barrelLen + 0.08));
      // Magazine tube (below barrels)
      const scatterMag = mesh(new THREE.CylinderGeometry(0.025, 0.025, barrelLen * 0.8, 8), darkMat);
      scatterMag.rotation.z = Math.PI / 2;
      scatterMag.position.set(0, -0.06, -(barrelLen / 2 + 0.05));
      break;
    }

    case 'brella': {
      // Splat Brella: umbrella launcher — canopy, ribs, handle and shot barrel
      const barrelLen = 0.4;
      // Shot barrel running through the umbrella shaft
      const brellaBarrel = mesh(new THREE.CylinderGeometry(0.045, 0.055, barrelLen, 10), darkMat);
      brellaBarrel.rotation.z = Math.PI / 2;
      brellaBarrel.position.z = -(barrelLen / 2 + 0.05);
      // Muzzle ring
      mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), trimMat)
        .position.z = -(barrelLen + 0.05);
      // Receiver / pump body
      mesh(new THREE.BoxGeometry(0.13, 0.15, 0.3), teamMat);
      // Canopy: shallow team-tinted cone with slight transparency
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.22, 8, 1, true),
        new THREE.MeshStandardMaterial({
          color: teamColorHex, roughness: 0.4, metalness: 0.1,
          transparent: true, opacity: 0.85, side: THREE.DoubleSide
        })
      );
      canopy.position.set(0, 0.26, -0.18);
      group.add(canopy);
      // Canopy underside disc
      const canopyRim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.018, 6, 16), darkMat);
      canopyRim.rotation.x = Math.PI / 2;
      canopyRim.position.set(0, 0.2, -0.18);
      group.add(canopyRim);
      // Ribs fanning from the canopy tip
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rib = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 5), darkMat);
        rib.position.set(Math.cos(a) * 0.19, 0.15, -0.18 + Math.sin(a) * 0.19);
        rib.rotation.z = Math.cos(a) * 0.85;
        rib.rotation.x = -Math.sin(a) * 0.85;
      }
      // Shaft / handle
      mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8), softMat)
        .position.set(0, -0.12, 0.1);
      // Grip curve
      const brellaGrip = mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 12, Math.PI), rubberMat);
      brellaGrip.position.set(0, -0.36, 0.1);
      brellaGrip.rotation.z = Math.PI;
      // Canopy tip finial
      mesh(new THREE.SphereGeometry(0.025, 6, 6), trimMat)
        .position.set(0, 0.38, -0.18);
      // Trigger
      mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), trimMat)
        .position.set(0, -0.09, 0.16);
      break;
    }

    case 'dualies': {
      // Splat Dualies: two compact pistols, left + right, slightly splayed
      const makePistol = (side: 1 | -1) => {
        const pistol = new THREE.Group();
        // Slide / body
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.24), darkMat);
        pistol.add(slide);
        // Team-coloured upper receiver
        const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.16), teamMat);
        receiver.position.y = 0.065;
        pistol.add(receiver);
        // Short barrel
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.12, 8), darkMat);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.z = -0.17;
        pistol.add(barrel);
        // Muzzle tip
        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.032, 0.03, 8), trimMat);
        muzzle.rotation.z = Math.PI / 2;
        muzzle.position.z = -0.24;
        pistol.add(muzzle);
        // Grip
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), rubberMat);
        grip.position.set(0, -0.11, 0.07);
        grip.rotation.x = 0.3;
        pistol.add(grip);
        // Trigger guard
        const guard = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 10, Math.PI), trimMat);
        guard.position.set(0, -0.06, 0.02);
        pistol.add(guard);
        // Side ejection port
        const port = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.07), softMat);
        port.position.set(side * 0.038, 0.03, 0.0);
        pistol.add(port);
        // Front sight
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.012), trimMat);
        sight.position.set(0, 0.1, -0.2);
        pistol.add(sight);
        return pistol;
      };

      const left = makePistol(-1);
      left.position.set(-0.13, -0.02, -0.05);
      left.rotation.y = 0.14;
      group.add(left);
      const right = makePistol(1);
      right.position.set(0.13, -0.02, -0.05);
      right.rotation.y = -0.14;
      group.add(right);
      // Central bridge connecting the pair
      mesh(new THREE.BoxGeometry(0.16, 0.04, 0.1), softMat)
        .position.set(0, 0.04, 0.06);
      break;
    }

    default: {
      // Fallback: simple box (should never reach here with valid types)
      mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), darkMat);
    }
  }

  if (scale !== 1) {
    group.scale.setScalar(scale);
  }

  return group;
}

/**
 * Returns the local Z position of the muzzle tip for the given weapon, in
 * weapon-anchor local space. Used by the shot pipeline to spawn tracers from
 * the correct barrel end.
 */
export function getMuzzleOffset(weaponType: WeaponType): number {
  switch (weaponType) {
    case 'shooter':   return -0.65;
    case 'roller':    return -0.75;
    case 'charger':   return -1.25;
    case 'slosher':   return -0.35;
    case 'sprayer':   return -0.52;
    case 'cannon':    return -0.65;
    case 'marksman':  return -0.95;
    case 'scatter':   return -0.55;
    case 'brella':    return -0.45;
    case 'dualies':   return -0.35;
    default:          return -0.6;
  }
}
