import * as THREE from 'three';
import { PlayerMode, Team, Vec3, WeaponType } from '@ink/shared';

export class PlayerView {
  readonly group = new THREE.Group();

  private humanoidGroup = new THREE.Group();
  private submergedGroup = new THREE.Group();

  // Procedural body parts
  private torsoGroup = new THREE.Group();
  private headGroup = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private tankLiquidMesh: THREE.Mesh;
  private tankLedMesh: THREE.Mesh;
  private squidTentacles: THREE.Mesh[] = [];
  private tentacleBaseX: number[] = [];
  private ghostGroup = new THREE.Group();
  private ghostActive = false;
  private ghostTime = 0;

  // Weapon models
  private weaponAnchor = new THREE.Group();
  private shooterGroup = new THREE.Group();
  private rollerGroup = new THREE.Group();
  private chargerGroup = new THREE.Group();
  private slosherGroup = new THREE.Group();
  private muzzleFlashMesh: THREE.Mesh;
  private rollerCylinderMesh?: THREE.Mesh;
  private chargerLaserMesh?: THREE.Mesh;

  // Squid swimming parts
  private rippleMesh: THREE.Mesh;
  private squidDomeMesh: THREE.Mesh;

  private teamColorHex: number;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  private currentMode: PlayerMode = PlayerMode.HUMANOID;
  private currentWeapon: WeaponType = 'shooter';

  // Animation state
  private walkPhase = 0;
  private recoilOffset = 0;
  private flashTimer = 0;
  private squashStretchY = 1.0;
  private aimPitch = 0;
  private diveTransitionTimer = 0;

  // Floating 3D Nameplate (Subagent 79)
  private nameplateSprite?: THREE.Sprite;
  private nameplateTexture?: THREE.CanvasTexture;
  private playerName = '';
  private cosmeticsApplied = false;

  constructor(team: Team) {
    this.teamColorHex = team === Team.PINK ? 0xff007f : 0x00ffff;

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.teamColorHex,
      roughness: 0.35,
      metalness: 0.2
    });
    this.materials.push(bodyMat);

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e1e24,
      roughness: 0.7,
      metalness: 0.3
    });
    this.materials.push(darkMat);

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xffee44,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x443300
    });
    this.materials.push(visorMat);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      roughness: 0.1,
      transmission: 0.8
    });
    this.materials.push(glassMat);

    const liquidMat = new THREE.MeshStandardMaterial({
      color: this.teamColorHex,
      roughness: 0.2,
      metalness: 0.4
    });
    this.materials.push(liquidMat);

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xdfe6f0,
      roughness: 0.25,
      metalness: 0.6,
      emissive: 0x9fb4cc,
      emissiveIntensity: 0.4
    });
    this.materials.push(accentMat);

    // ==========================================
    // 1. Build Humanoid Mesh & Limbs
    // ==========================================

    // Torso / Body (height: 0.75, radius: 0.32)
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.75, 14);
    this.geometries.push(bodyGeo);
    const bodyMesh = new THREE.Mesh(bodyGeo, darkMat);
    bodyMesh.castShadow = true;
    this.torsoGroup.add(bodyMesh);

    // Team color jacket overlay
    const jacketGeo = new THREE.CylinderGeometry(0.31, 0.35, 0.5, 14);
    this.geometries.push(jacketGeo);
    const jacketMesh = new THREE.Mesh(jacketGeo, bodyMat);
    jacketMesh.position.y = 0.1;
    this.torsoGroup.add(jacketMesh);

    // Chest emblem
    const emblemGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 14);
    this.geometries.push(emblemGeo);
    const emblem = new THREE.Mesh(emblemGeo, accentMat);
    emblem.rotation.x = Math.PI / 2;
    emblem.position.set(0, 0.18, -0.32);
    this.torsoGroup.add(emblem);

    // Belt + buckle
    const beltGeo = new THREE.TorusGeometry(0.365, 0.035, 8, 20);
    this.geometries.push(beltGeo);
    const belt = new THREE.Mesh(beltGeo, darkMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.32;
    this.torsoGroup.add(belt);

    const buckleGeo = new THREE.BoxGeometry(0.11, 0.08, 0.04);
    this.geometries.push(buckleGeo);
    const buckle = new THREE.Mesh(buckleGeo, accentMat);
    buckle.position.set(0, -0.32, -0.395);
    this.torsoGroup.add(buckle);

    // Head Group (pivot at neck y = 0.4)
    this.headGroup.position.set(0, 0.55, 0);
    const headGeo = new THREE.SphereGeometry(0.3, 16, 16);
    this.geometries.push(headGeo);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.castShadow = true;
    this.headGroup.add(headMesh);

    // Visor / Mask
    const visorGeo = new THREE.BoxGeometry(0.36, 0.12, 0.2);
    this.geometries.push(visorGeo);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 0.05, -0.22);
    this.headGroup.add(visorMesh);

    // Visor top shine stripe
    const visorShineGeo = new THREE.BoxGeometry(0.3, 0.018, 0.03);
    this.geometries.push(visorShineGeo);
    const visorShine = new THREE.Mesh(visorShineGeo, accentMat);
    visorShine.position.set(0, 0.115, -0.29);
    this.headGroup.add(visorShine);

    // Jaw guard under the visor
    const jawGeo = new THREE.BoxGeometry(0.28, 0.1, 0.14);
    this.geometries.push(jawGeo);
    const jawGuard = new THREE.Mesh(jawGeo, darkMat);
    jawGuard.position.set(0, -0.06, -0.24);
    this.headGroup.add(jawGuard);

    // Cephalopod tentacle hair: two thick front locks, two thin back locks
    const tentacleSpecs = [
      { side: -1, len: 0.62, r: 0.085, z: 0.18, tilt: -0.35 },
      { side: 1, len: 0.62, r: 0.085, z: 0.18, tilt: -0.35 },
      { side: -1, len: 0.44, r: 0.055, z: 0.27, tilt: -0.75 },
      { side: 1, len: 0.44, r: 0.055, z: 0.27, tilt: -0.75 }
    ];
    for (const spec of tentacleSpecs) {
      const tentacleGeo = new THREE.CapsuleGeometry(spec.r, spec.len, 4, 8);
      this.geometries.push(tentacleGeo);
      const tentacle = new THREE.Mesh(tentacleGeo, bodyMat);
      tentacle.position.set(spec.side * 0.19, -0.12, spec.z);
      tentacle.rotation.x = spec.tilt;
      tentacle.rotation.z = spec.side * 0.22;
      this.headGroup.add(tentacle);
      this.squidTentacles.push(tentacle);
      this.tentacleBaseX.push(spec.tilt);
    }

    // DJ Streetwear Headset & Earcups
    const headbandGeo = new THREE.TorusGeometry(0.32, 0.035, 8, 16, Math.PI);
    this.geometries.push(headbandGeo);
    const headband = new THREE.Mesh(headbandGeo, darkMat);
    headband.rotation.x = -Math.PI / 2;
    headband.rotation.z = Math.PI;
    headband.position.set(0, 0.08, 0);
    this.headGroup.add(headband);

    const earPadGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.09, 12);
    this.geometries.push(earPadGeo);
    for (let side = -1; side <= 1; side += 2) {
      const earPad = new THREE.Mesh(earPadGeo, bodyMat);
      earPad.rotation.z = Math.PI / 2;
      earPad.position.set(side * 0.32, 0.04, 0);
      this.headGroup.add(earPad);
    }

    this.torsoGroup.add(this.headGroup);

    // Backpack Ink Tank
    const tankGroup = new THREE.Group();
    tankGroup.position.set(0, 0.1, 0.32);

    const tankOuterGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.65, 12);
    this.geometries.push(tankOuterGeo);
    const tankOuter = new THREE.Mesh(tankOuterGeo, glassMat);
    tankGroup.add(tankOuter);

    const liquidGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.58, 12);
    this.geometries.push(liquidGeo);
    this.tankLiquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    tankGroup.add(this.tankLiquidMesh);

    const capGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12);
    this.geometries.push(capGeo);
    const capTop = new THREE.Mesh(capGeo, darkMat);
    capTop.position.y = 0.33;
    const capBot = new THREE.Mesh(capGeo, darkMat);
    capBot.position.y = -0.33;
    tankGroup.add(capTop, capBot);

    // Tank Warning LED Light
    const ledGeo = new THREE.SphereGeometry(0.045, 8, 8);
    this.geometries.push(ledGeo);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.materials.push(ledMat);
    this.tankLedMesh = new THREE.Mesh(ledGeo, ledMat);
    this.tankLedMesh.position.set(0, 0.4, 0);
    tankGroup.add(this.tankLedMesh);

    // Tank bracket rings
    const tankRingGeo = new THREE.TorusGeometry(0.165, 0.018, 8, 18);
    this.geometries.push(tankRingGeo);
    for (const ringY of [-0.18, 0.18]) {
      const ring = new THREE.Mesh(tankRingGeo, darkMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = ringY;
      tankGroup.add(ring);
    }

    // Bottom ink valve
    const valveGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.09, 8);
    this.geometries.push(valveGeo);
    const valve = new THREE.Mesh(valveGeo, darkMat);
    valve.position.y = -0.4;
    tankGroup.add(valve);

    // Pressure antenna with glowing tip
    const antennaGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6);
    this.geometries.push(antennaGeo);
    const antenna = new THREE.Mesh(antennaGeo, darkMat);
    antenna.position.set(0.09, 0.45, 0);
    tankGroup.add(antenna);

    const antennaTipGeo = new THREE.SphereGeometry(0.022, 8, 8);
    this.geometries.push(antennaTipGeo);
    const antennaTip = new THREE.Mesh(antennaTipGeo, ledMat);
    antennaTip.position.set(0.09, 0.57, 0);
    tankGroup.add(antennaTip);

    this.torsoGroup.add(tankGroup);

    // Tank harness straps over the shoulders
    const strapGeo = new THREE.BoxGeometry(0.06, 0.52, 0.025);
    this.geometries.push(strapGeo);
    for (let side = -1; side <= 1; side += 2) {
      const strap = new THREE.Mesh(strapGeo, darkMat);
      strap.position.set(side * 0.14, 0.12, 0.315);
      strap.rotation.x = -0.1;
      this.torsoGroup.add(strap);
    }

    this.torsoGroup.position.y = 0.85;
    this.humanoidGroup.add(this.torsoGroup);

    // Left Arm (pivot at shoulder)
    this.leftArm.position.set(-0.38, 1.15, 0);
    const armGeo = new THREE.CapsuleGeometry(0.07, 0.36, 4, 8);
    this.geometries.push(armGeo);
    const leftArmMesh = new THREE.Mesh(armGeo, darkMat);
    leftArmMesh.position.y = -0.22;
    this.leftArm.add(leftArmMesh);

    const shoulderPadGeo = new THREE.SphereGeometry(0.13, 10, 10);
    this.geometries.push(shoulderPadGeo);
    const handGeo = new THREE.SphereGeometry(0.075, 8, 8);
    this.geometries.push(handGeo);

    const leftShoulder = new THREE.Mesh(shoulderPadGeo, bodyMat);
    leftShoulder.position.y = 0.02;
    this.leftArm.add(leftShoulder);

    const leftHand = new THREE.Mesh(handGeo, darkMat);
    leftHand.position.y = -0.47;
    this.leftArm.add(leftHand);
    this.humanoidGroup.add(this.leftArm);

    // Right Arm (pivot at shoulder)
    this.rightArm.position.set(0.38, 1.15, 0);
    const rightArmMesh = new THREE.Mesh(armGeo, darkMat);
    rightArmMesh.position.y = -0.22;
    this.rightArm.add(rightArmMesh);

    const rightShoulder = new THREE.Mesh(shoulderPadGeo, bodyMat);
    rightShoulder.position.y = 0.02;
    this.rightArm.add(rightShoulder);

    const rightHand = new THREE.Mesh(handGeo, darkMat);
    rightHand.position.y = -0.47;
    this.rightArm.add(rightHand);
    this.humanoidGroup.add(this.rightArm);

    // Left Leg (pivot at hip)
    this.leftLeg.position.set(-0.16, 0.57, 0);
    const legGeo = new THREE.CapsuleGeometry(0.09, 0.37, 4, 8);
    this.geometries.push(legGeo);
    const leftLegMesh = new THREE.Mesh(legGeo, darkMat);
    leftLegMesh.position.y = -0.25;
    leftLegMesh.castShadow = true;
    this.leftLeg.add(leftLegMesh);

    const kneePadGeo = new THREE.SphereGeometry(0.075, 8, 8);
    this.geometries.push(kneePadGeo);
    const leftKnee = new THREE.Mesh(kneePadGeo, bodyMat);
    leftKnee.position.set(0, -0.33, -0.04);
    this.leftLeg.add(leftKnee);

    const bootGeo = new THREE.BoxGeometry(0.16, 0.12, 0.25);
    this.geometries.push(bootGeo);
    const leftBoot = new THREE.Mesh(bootGeo, bodyMat);
    leftBoot.position.set(0, -0.49, -0.05);
    this.leftLeg.add(leftBoot);

    const soleGeo = new THREE.BoxGeometry(0.19, 0.045, 0.29);
    this.geometries.push(soleGeo);
    const leftSole = new THREE.Mesh(soleGeo, darkMat);
    leftSole.position.set(0, -0.555, -0.05);
    this.leftLeg.add(leftSole);
    this.humanoidGroup.add(this.leftLeg);

    // Right Leg (pivot at hip)
    this.rightLeg.position.set(0.16, 0.57, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, darkMat);
    rightLegMesh.position.y = -0.25;
    rightLegMesh.castShadow = true;
    this.rightLeg.add(rightLegMesh);

    const rightKnee = new THREE.Mesh(kneePadGeo, bodyMat);
    rightKnee.position.set(0, -0.33, -0.04);
    this.rightLeg.add(rightKnee);

    const rightBoot = new THREE.Mesh(bootGeo, bodyMat);
    rightBoot.position.set(0, -0.49, -0.05);
    this.rightLeg.add(rightBoot);

    const rightSole = new THREE.Mesh(soleGeo, darkMat);
    rightSole.position.set(0, -0.555, -0.05);
    this.rightLeg.add(rightSole);
    this.humanoidGroup.add(this.rightLeg);

    // ==========================================
    // 2. Weapon Models
    // ==========================================
    this.weaponAnchor.position.set(0.32, 0.85, -0.3);

    // 2.1 Shooter (Ink Blaster)
    const shooterBarGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.65, 10);
    this.geometries.push(shooterBarGeo);
    const shooterBar = new THREE.Mesh(shooterBarGeo, darkMat);
    shooterBar.rotation.x = Math.PI / 2;
    this.shooterGroup.add(shooterBar);

    const nozzleGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10);
    this.geometries.push(nozzleGeo);
    const nozzle = new THREE.Mesh(nozzleGeo, bodyMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -0.38;
    this.shooterGroup.add(nozzle);

    // Muzzle bore
    const shooterBoreGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.02, 10);
    this.geometries.push(shooterBoreGeo);
    const shooterBore = new THREE.Mesh(shooterBoreGeo, accentMat);
    shooterBore.rotation.x = Math.PI / 2;
    shooterBore.position.z = -0.475;
    this.shooterGroup.add(shooterBore);

    // Receiver body
    const shooterBodyGeo = new THREE.BoxGeometry(0.15, 0.17, 0.3);
    this.geometries.push(shooterBodyGeo);
    const shooterBody = new THREE.Mesh(shooterBodyGeo, bodyMat);
    shooterBody.position.z = 0.2;
    this.shooterGroup.add(shooterBody);

    // Top ink cartridge (glass + liquid)
    const shooterTankGlassGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.17, 10);
    const shooterTankInkGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 10);
    this.geometries.push(shooterTankGlassGeo, shooterTankInkGeo);
    const shooterTankGlass = new THREE.Mesh(shooterTankGlassGeo, glassMat);
    shooterTankGlass.position.set(0, 0.15, 0.12);
    const shooterTankInk = new THREE.Mesh(shooterTankInkGeo, liquidMat);
    shooterTankInk.position.set(0, 0.15, 0.12);
    this.shooterGroup.add(shooterTankGlass, shooterTankInk);

    // Front sight
    const shooterSightGeo = new THREE.BoxGeometry(0.025, 0.06, 0.1);
    this.geometries.push(shooterSightGeo);
    const shooterSight = new THREE.Mesh(shooterSightGeo, darkMat);
    shooterSight.position.set(0, 0.1, -0.2);
    this.shooterGroup.add(shooterSight);

    // Grip + trigger guard
    const shooterGripGeo = new THREE.BoxGeometry(0.07, 0.2, 0.09);
    this.geometries.push(shooterGripGeo);
    const shooterGrip = new THREE.Mesh(shooterGripGeo, darkMat);
    shooterGrip.position.set(0, -0.14, 0.24);
    shooterGrip.rotation.x = 0.4;
    this.shooterGroup.add(shooterGrip);

    const shooterGuardGeo = new THREE.TorusGeometry(0.05, 0.012, 6, 14);
    this.geometries.push(shooterGuardGeo);
    const shooterGuard = new THREE.Mesh(shooterGuardGeo, darkMat);
    shooterGuard.rotation.y = Math.PI / 2;
    shooterGuard.position.set(0, -0.07, 0.12);
    this.shooterGroup.add(shooterGuard);

    this.weaponAnchor.add(this.shooterGroup);

    // 2.2 Roller (Ink Roller)
    const rollerHandleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8);
    this.geometries.push(rollerHandleGeo);
    const rollerHandle = new THREE.Mesh(rollerHandleGeo, darkMat);
    rollerHandle.rotation.x = 0.5;
    rollerHandle.position.set(0, 0, -0.1);
    this.rollerGroup.add(rollerHandle);

    // Handle crossbar grip
    const rollerGripGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8);
    this.geometries.push(rollerGripGeo);
    const rollerGrip = new THREE.Mesh(rollerGripGeo, bodyMat);
    rollerGrip.rotation.z = Math.PI / 2;
    rollerGrip.position.set(0, 0.4, 0.11);
    this.rollerGroup.add(rollerGrip);

    const rollerCylinderGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.4, 16);
    this.geometries.push(rollerCylinderGeo);
    const rollerCylinder = new THREE.Mesh(rollerCylinderGeo, bodyMat);
    rollerCylinder.rotation.z = Math.PI / 2;
    rollerCylinder.position.set(0, -0.35, -0.6);
    this.rollerCylinderMesh = rollerCylinder;
    this.rollerGroup.add(rollerCylinder);

    // Axle + end caps
    const rollerAxleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.52, 8);
    const rollerCapGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12);
    this.geometries.push(rollerAxleGeo, rollerCapGeo);
    const rollerAxle = new THREE.Mesh(rollerAxleGeo, darkMat);
    rollerAxle.rotation.z = Math.PI / 2;
    rollerAxle.position.set(0, -0.35, -0.6);
    this.rollerGroup.add(rollerAxle);
    for (let side = -1; side <= 1; side += 2) {
      const cap = new THREE.Mesh(rollerCapGeo, darkMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(side * 0.72, -0.35, -0.6);
      this.rollerGroup.add(cap);
    }

    // Tread ribs
    const rollerRibGeo = new THREE.TorusGeometry(0.245, 0.02, 6, 20);
    this.geometries.push(rollerRibGeo);
    for (const ribX of [-0.45, 0, 0.45]) {
      const rib = new THREE.Mesh(rollerRibGeo, darkMat);
      rib.rotation.y = Math.PI / 2;
      rib.position.set(ribX, -0.35, -0.6);
      this.rollerGroup.add(rib);
    }
    this.rollerGroup.visible = false;
    this.weaponAnchor.add(this.rollerGroup);

    // 2.3 Charger (Ink Sniper)
    const chargerBodyGeo = new THREE.BoxGeometry(0.1, 0.14, 0.5);
    this.geometries.push(chargerBodyGeo);
    const chargerBody = new THREE.Mesh(chargerBodyGeo, darkMat);
    this.chargerGroup.add(chargerBody);

    // Stock + grip
    const chargerStockGeo = new THREE.BoxGeometry(0.08, 0.13, 0.24);
    this.geometries.push(chargerStockGeo);
    const chargerStock = new THREE.Mesh(chargerStockGeo, bodyMat);
    chargerStock.position.set(0, -0.02, 0.35);
    this.chargerGroup.add(chargerStock);

    const chargerGripGeo = new THREE.BoxGeometry(0.06, 0.17, 0.08);
    this.geometries.push(chargerGripGeo);
    const chargerGrip = new THREE.Mesh(chargerGripGeo, darkMat);
    chargerGrip.position.set(0, -0.13, 0.12);
    chargerGrip.rotation.x = 0.35;
    this.chargerGroup.add(chargerGrip);

    const chargerBarrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 10);
    this.geometries.push(chargerBarrelGeo);
    const chargerBarrel = new THREE.Mesh(chargerBarrelGeo, bodyMat);
    chargerBarrel.rotation.x = Math.PI / 2;
    chargerBarrel.position.z = -0.7;
    this.chargerGroup.add(chargerBarrel);

    // Barrel shroud rings + energy coil
    const chargerRingGeo = new THREE.TorusGeometry(0.045, 0.014, 6, 14);
    this.geometries.push(chargerRingGeo);
    for (const ringZ of [-0.5, -0.9]) {
      const ring = new THREE.Mesh(chargerRingGeo, bodyMat);
      ring.position.set(0, 0, ringZ);
      this.chargerGroup.add(ring);
    }

    const chargerCoilGeo = new THREE.TorusGeometry(0.08, 0.02, 6, 16);
    this.geometries.push(chargerCoilGeo);
    const chargerCoil = new THREE.Mesh(chargerCoilGeo, accentMat);
    chargerCoil.position.set(0, 0, -0.28);
    this.chargerGroup.add(chargerCoil);

    // Muzzle brake
    const chargerMuzzleGeo = new THREE.CylinderGeometry(0.042, 0.05, 0.07, 8);
    this.geometries.push(chargerMuzzleGeo);
    const chargerMuzzle = new THREE.Mesh(chargerMuzzleGeo, darkMat);
    chargerMuzzle.rotation.x = Math.PI / 2;
    chargerMuzzle.position.z = -1.31;
    this.chargerGroup.add(chargerMuzzle);

    const scopeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
    this.geometries.push(scopeGeo);
    const scope = new THREE.Mesh(scopeGeo, darkMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.12, -0.1);
    this.chargerGroup.add(scope);

    // Scope lens
    const chargerLensGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10);
    this.geometries.push(chargerLensGeo);
    const chargerLens = new THREE.Mesh(chargerLensGeo, visorMat);
    chargerLens.rotation.x = Math.PI / 2;
    chargerLens.position.set(0, 0.12, -0.26);
    this.chargerGroup.add(chargerLens);

    // Charger laser sight beam
    const laserGeo = new THREE.CylinderGeometry(0.005, 0.005, 25, 6);
    this.geometries.push(laserGeo);
    const laserMat = new THREE.MeshBasicMaterial({
      color: this.teamColorHex,
      transparent: true,
      opacity: 0.55
    });
    this.materials.push(laserMat);
    this.chargerLaserMesh = new THREE.Mesh(laserGeo, laserMat);
    this.chargerLaserMesh.rotation.x = Math.PI / 2;
    this.chargerLaserMesh.position.z = -13.5;
    this.chargerGroup.add(this.chargerLaserMesh);

    this.chargerGroup.visible = false;
    this.weaponAnchor.add(this.chargerGroup);

    // 2.4 Bucket (Ink Bucket)
    const bucketGeo = new THREE.CylinderGeometry(0.26, 0.2, 0.45, 12, 1, true);
    this.geometries.push(bucketGeo);
    const bucketMat = new THREE.MeshStandardMaterial({
      color: this.teamColorHex,
      roughness: 0.3,
      side: THREE.DoubleSide
    });
    this.materials.push(bucketMat);
    const bucketMesh = new THREE.Mesh(bucketGeo, bucketMat);
    bucketMesh.rotation.x = 0.3;
    bucketMesh.position.set(0, -0.1, -0.3);
    this.slosherGroup.add(bucketMesh);

    // Bucket rim, carry handle and ink load (children inherit the tilt)
    const bucketRimGeo = new THREE.TorusGeometry(0.265, 0.02, 8, 20);
    this.geometries.push(bucketRimGeo);
    const bucketRim = new THREE.Mesh(bucketRimGeo, darkMat);
    bucketRim.rotation.x = Math.PI / 2;
    bucketRim.position.y = 0.225;
    bucketMesh.add(bucketRim);

    const bucketHandleGeo = new THREE.TorusGeometry(0.15, 0.018, 6, 16, Math.PI);
    this.geometries.push(bucketHandleGeo);
    const bucketHandle = new THREE.Mesh(bucketHandleGeo, darkMat);
    bucketHandle.position.y = 0.225;
    bucketMesh.add(bucketHandle);

    const bucketInkGeo = new THREE.CylinderGeometry(0.21, 0.17, 0.08, 14);
    this.geometries.push(bucketInkGeo);
    const bucketInk = new THREE.Mesh(bucketInkGeo, liquidMat);
    bucketInk.position.y = 0.08;
    bucketMesh.add(bucketInk);

    // Swing shaft from the hand to the bucket
    const slosherShaftGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.62, 8);
    this.geometries.push(slosherShaftGeo);
    const slosherShaft = new THREE.Mesh(slosherShaftGeo, darkMat);
    slosherShaft.rotation.x = 1.2;
    slosherShaft.position.set(0, 0.05, -0.14);
    this.slosherGroup.add(slosherShaft);

    this.slosherGroup.visible = false;
    this.weaponAnchor.add(this.slosherGroup);

    // Muzzle Flash Effect
    const flashGeo = new THREE.OctahedronGeometry(0.18);
    this.geometries.push(flashGeo);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    this.materials.push(flashMat);
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlashMesh.position.set(0, 0, -0.6);
    this.muzzleFlashMesh.visible = false;
    this.weaponAnchor.add(this.muzzleFlashMesh);

    this.humanoidGroup.add(this.weaponAnchor);
    this.group.add(this.humanoidGroup);

    // ==========================================
    // 3. Build Submerged / Squid Form
    // ==========================================
    const rippleGeo = new THREE.RingGeometry(0.25, 0.9, 24);
    this.geometries.push(rippleGeo);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: this.teamColorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.materials.push(rippleMat);
    this.rippleMesh = new THREE.Mesh(rippleGeo, rippleMat);
    this.rippleMesh.rotation.x = -Math.PI / 2;
    this.rippleMesh.position.y = 0.04;
    this.submergedGroup.add(this.rippleMesh);

    // Squid Dome Head
    const domeGeo = new THREE.ConeGeometry(0.3, 0.5, 12);
    this.geometries.push(domeGeo);
    this.squidDomeMesh = new THREE.Mesh(domeGeo, bodyMat);
    this.squidDomeMesh.rotation.x = -Math.PI / 2;
    this.squidDomeMesh.position.set(0, 0.08, 0);
    this.squidDomeMesh.castShadow = true;
    this.submergedGroup.add(this.squidDomeMesh);

    // Swim fins on the dome sides
    const finGeo = new THREE.BoxGeometry(0.045, 0.14, 0.24);
    this.geometries.push(finGeo);
    for (let side = -1; side <= 1; side += 2) {
      const fin = new THREE.Mesh(finGeo, bodyMat);
      fin.position.set(side * 0.26, 0.14, 0.08);
      fin.rotation.z = side * -0.5;
      fin.rotation.x = 0.25;
      this.submergedGroup.add(fin);
    }

    // Squid Eyes
    const squidEyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const squidPupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const squidEyeGeo = new THREE.SphereGeometry(0.065, 8, 8);
    const squidPupilGeo = new THREE.SphereGeometry(0.035, 8, 8);
    this.geometries.push(squidEyeGeo, squidPupilGeo);
    this.materials.push(squidEyeMat, squidPupilMat);

    const leftSquidEye = new THREE.Mesh(squidEyeGeo, squidEyeMat);
    leftSquidEye.position.set(-0.12, 0.12, -0.05);
    const leftPupil = new THREE.Mesh(squidPupilGeo, squidPupilMat);
    leftPupil.position.set(0, 0.02, -0.04);
    leftSquidEye.add(leftPupil);
    this.submergedGroup.add(leftSquidEye);

    const rightSquidEye = new THREE.Mesh(squidEyeGeo, squidEyeMat);
    rightSquidEye.position.set(0.12, 0.12, -0.05);
    const rightPupil = new THREE.Mesh(squidPupilGeo, squidPupilMat);
    rightPupil.position.set(0, 0.02, -0.04);
    rightSquidEye.add(rightPupil);
    this.submergedGroup.add(rightSquidEye);

    // Squid trailing tentacles
    for (let side = -1; side <= 1; side += 2) {
      const tentGeo = new THREE.CylinderGeometry(0.045, 0.02, 0.45, 6);
      this.geometries.push(tentGeo);
      const tentMesh = new THREE.Mesh(tentGeo, bodyMat);
      tentMesh.rotation.x = Math.PI / 2;
      tentMesh.position.set(side * 0.14, 0.06, 0.35);
      this.squidTentacles.push(tentMesh);
      this.submergedGroup.add(tentMesh);
    }

    this.submergedGroup.visible = false;
    this.group.add(this.submergedGroup);

    // ==========================================
    // 4. Build Ascending Splat Ghost
    // ==========================================
    this.ghostGroup = new THREE.Group();
    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2
    });
    this.materials.push(ghostMat);
    const ghostBodyGeo = new THREE.ConeGeometry(0.24, 0.5, 10);
    this.geometries.push(ghostBodyGeo);
    const ghostBody = new THREE.Mesh(ghostBodyGeo, ghostMat);
    ghostBody.rotation.x = Math.PI;
    this.ghostGroup.add(ghostBody);

    // Halo
    const haloGeo = new THREE.RingGeometry(0.12, 0.16, 16);
    this.geometries.push(haloGeo);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, side: THREE.DoubleSide });
    this.materials.push(haloMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.35;
    this.ghostGroup.add(halo);

    this.ghostGroup.visible = false;
    this.group.add(this.ghostGroup);
  }

  setWeaponType(type: WeaponType): void {
    this.currentWeapon = type;
    this.shooterGroup.visible = type === 'shooter';
    this.rollerGroup.visible = type === 'roller';
    this.chargerGroup.visible = type === 'charger';
    this.slosherGroup.visible = type === 'slosher';
  }

  triggerRecoil(): void {
    this.recoilOffset = -0.18;
    this.flashTimer = 0.07;
    this.muzzleFlashMesh.visible = true;
  }

  setMode(mode: PlayerMode): void {
    if (this.currentMode !== mode) {
      this.diveTransitionTimer = 0.22;
      this.currentMode = mode;
    }
    if (mode === PlayerMode.DEAD) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = false;
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
      this.ghostActive = true;
      this.ghostTime = 0;
      this.ghostGroup.position.set(0, 0.4, 0);
      this.ghostGroup.visible = true;
    } else if (mode === PlayerMode.SUBMERGED) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = true;
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
      this.ghostActive = false;
      this.ghostGroup.visible = false;
    } else {
      this.humanoidGroup.visible = true;
      this.submergedGroup.visible = false;
      if (this.nameplateSprite) this.nameplateSprite.visible = true;
      this.ghostActive = false;
      this.ghostGroup.visible = false;
    }
  }

  /**
   * Updates floating 3D player nameplate (Subagent 79)
   */
  setName(name: string): void {
    if (!name || this.playerName === name) return;
    this.playerName = name;

    if (this.nameplateTexture) {
      this.nameplateTexture.dispose();
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Rounded background pill
      ctx.fillStyle = 'rgba(15, 17, 24, 0.85)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 240, 48, 14);
      ctx.fill();

      // Team accent border
      ctx.strokeStyle = this.teamColorHex === 0xff007f ? '#ff007f' : '#00ffff';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Name Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 128, 32);
    }

    this.nameplateTexture = new THREE.CanvasTexture(canvas);
    if (!this.nameplateSprite) {
      const mat = new THREE.SpriteMaterial({
        map: this.nameplateTexture,
        transparent: true,
        depthTest: false
      });
      this.materials.push(mat);
      this.nameplateSprite = new THREE.Sprite(mat);
      this.nameplateSprite.position.set(0, 2.2, 0);
      this.nameplateSprite.scale.set(1.6, 0.4, 1);
      this.nameplateSprite.visible = this.currentMode === PlayerMode.HUMANOID;
      this.group.add(this.nameplateSprite);
    } else {
      this.nameplateSprite.material.map = this.nameplateTexture;
      this.nameplateSprite.material.needsUpdate = true;
    }
  }

  // Subagent 07 Public API
  setTeam(team: Team): void {
    this.teamColorHex = team === Team.PINK ? 0xff007f : 0x00ffff;
  }

  setAlive(alive: boolean): void {
    if (!alive) {
      this.setMode(PlayerMode.DEAD);
    } else if (this.currentMode === PlayerMode.DEAD) {
      this.setMode(PlayerMode.HUMANOID);
    }
  }

  setForm(form: PlayerMode): void {
    this.setMode(form);
  }

  setInvulnerable(invulnerable: boolean): void {
    this.updateVisuals(invulnerable, performance.now() / 1000);
  }

  setTransform(pos: Vec3, yaw: number, pitch?: number): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.rotation.y = yaw;
    if (pitch !== undefined) {
      this.aimPitch = pitch;
    }
  }

  updateLocomotion(dt: number, speed: number, isGrounded: boolean, pitch = 0): void {
    if (this.currentMode !== PlayerMode.HUMANOID) return;

    this.aimPitch = THREE.MathUtils.lerp(this.aimPitch, pitch, 0.25);
    this.torsoGroup.rotation.x = -this.aimPitch * 0.6;
    this.headGroup.rotation.x = -this.aimPitch * 0.4;

    // Distinct weapon arm posing
    let baseLeftX = -0.3;
    let baseLeftY = 0;
    let baseLeftZ = 0;
    let baseRightX = -0.3;
    let baseRightY = 0;
    let baseRightZ = 0;

    switch (this.currentWeapon) {
      case 'shooter':
        baseRightX = -0.7;
        baseRightY = -0.15;
        baseLeftX = -0.6;
        baseLeftY = 0.35;
        baseLeftZ = -0.2;
        break;
      case 'roller':
        baseRightX = -0.45;
        baseRightY = -0.2;
        baseRightZ = 0.15;
        baseLeftX = -0.45;
        baseLeftY = 0.2;
        baseLeftZ = -0.15;
        break;
      case 'charger':
        baseRightX = -0.85;
        baseRightY = -0.1;
        baseLeftX = -0.8;
        baseLeftY = 0.3;
        baseLeftZ = -0.1;
        break;
      case 'slosher':
        baseRightX = -0.55;
        baseRightY = -0.1;
        baseLeftX = -0.55;
        baseLeftY = 0.1;
        break;
    }

    if (isGrounded && speed > 0.5) {
      this.walkPhase += speed * dt * 2.2;
      const legSwing = Math.sin(this.walkPhase) * 0.6;
      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;

      // Arm subtle sway with weapon
      this.leftArm.rotation.set(baseLeftX - legSwing * 0.15, baseLeftY, baseLeftZ);
      this.rightArm.rotation.set(baseRightX + legSwing * 0.1, baseRightY, baseRightZ);

      // Locomotion vertical bob & lateral lean
      this.torsoGroup.position.y = 0.85 + Math.abs(Math.sin(this.walkPhase)) * 0.05;
      this.torsoGroup.rotation.z = Math.sin(this.walkPhase) * 0.04;

      // Dynamic cephalopod hair/tentacle sway
      const tentacleSway = Math.sin(this.walkPhase * 2) * 0.12 - speed * 0.04;
      this.squidTentacles.forEach((t, idx) => {
        const side = idx % 2 === 0 ? -1 : 1;
        t.rotation.x = (this.tentacleBaseX[idx] ?? -0.3) + tentacleSway;
        t.rotation.z = side * 0.22 + Math.sin(this.walkPhase) * 0.06;
      });

      // Physically roll the Ink Roller cylinder
      if (this.currentWeapon === 'roller' && this.rollerCylinderMesh) {
        this.rollerCylinderMesh.rotation.x += speed * dt * 5.0;
      }
    } else {
      // Return smoothly to idle weapon pose with subtle breathing
      this.leftLeg.rotation.x *= 0.85;
      this.rightLeg.rotation.x *= 0.85;
      this.leftArm.rotation.set(baseLeftX, baseLeftY, baseLeftZ);
      this.rightArm.rotation.set(baseRightX, baseRightY, baseRightZ);

      const breath = Math.sin(performance.now() * 0.003) * 0.012;
      this.torsoGroup.position.y = 0.85 + breath;
      this.headGroup.position.y = 0.55 + breath * 0.5;
      this.torsoGroup.rotation.z = 0;

      this.squidTentacles.forEach((t, idx) => {
        const side = idx % 2 === 0 ? -1 : 1;
        t.rotation.x = (this.tentacleBaseX[idx] ?? -0.3) + Math.sin(performance.now() * 0.003) * 0.04;
        t.rotation.z = side * 0.22;
      });
    }

    // Jump squash & stretch decay
    if (!isGrounded) {
      this.squashStretchY = 1.18; // Stretch during air
    } else {
      this.squashStretchY = THREE.MathUtils.lerp(this.squashStretchY, 1.0, 0.2);
    }
    this.humanoidGroup.scale.set(
      1 / Math.sqrt(this.squashStretchY),
      this.squashStretchY,
      1 / Math.sqrt(this.squashStretchY)
    );

    // Recoil recovery
    this.recoilOffset = THREE.MathUtils.lerp(this.recoilOffset, 0, 0.25);
    this.weaponAnchor.position.z = -0.3 + this.recoilOffset;

    // Flash timer
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.muzzleFlashMesh.visible = false;
      }
    }
  }

  updateVisuals(invulnerable: boolean, time: number, inkPct = 100): void {
    // Update ghost floating animation
    if (this.ghostActive) {
      this.ghostTime += 0.016;
      this.ghostGroup.position.y += 0.035;
      this.ghostGroup.position.x = Math.sin(this.ghostTime * 6) * 0.08;
      this.ghostGroup.rotation.y += 0.02;
      const ghostProgress = Math.min(1.0, this.ghostTime / 2.5);
      const ghostMat = this.ghostGroup.children[0]
        ? ((this.ghostGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial)
        : null;
      if (ghostMat) {
        ghostMat.opacity = Math.max(0, (1 - ghostProgress) * 0.85);
      }
      if (this.ghostTime > 2.5) {
        this.ghostActive = false;
        this.ghostGroup.visible = false;
      }
    }

    if (this.currentMode === PlayerMode.DEAD) return;

    if (invulnerable) {
      const blink = Math.sin(time * 24) > 0;
      if (this.currentMode === PlayerMode.HUMANOID) {
        this.humanoidGroup.visible = blink;
      }
    } else {
      if (this.currentMode === PlayerMode.HUMANOID) {
        this.humanoidGroup.visible = true;
      }
    }

    // Dynamic Ink Tank fluid height
    const inkRatio = Math.max(0.05, Math.min(1.0, inkPct / 100));
    this.tankLiquidMesh.scale.set(1, inkRatio, 1);
    this.tankLiquidMesh.position.y = -0.29 + 0.29 * inkRatio;

    // Tank Warning LED Light
    if (this.tankLedMesh) {
      const ledMat = this.tankLedMesh.material as THREE.MeshBasicMaterial;
      if (inkPct < 20) {
        ledMat.color.setHex(Math.sin(time * 18) > 0 ? 0xff0033 : 0x330000);
      } else if (inkPct < 50) {
        ledMat.color.setHex(0xffbb00);
      } else {
        ledMat.color.setHex(0x00ff88);
      }
    }

    // Gentle ripple animation when submerged with dynamic dive scale
    if (this.submergedGroup.visible) {
      if (this.diveTransitionTimer > 0) {
        this.diveTransitionTimer = Math.max(0, this.diveTransitionTimer - 0.016);
      }
      const scale = 1.0 + Math.sin(time * 9) * 0.18 + (this.diveTransitionTimer / 0.22) * 0.4;
      this.rippleMesh.scale.set(scale, scale, 1);
      this.squidDomeMesh.scale.set(scale, 1.0, scale);
      this.squidDomeMesh.position.y = 0.08 + Math.sin(time * 12) * 0.02;

      // Trailing tentacles wiggle
      for (let i = 0; i < this.squidTentacles.length; i++) {
        const tent = this.squidTentacles[i]!;
        tent.rotation.z = Math.sin(time * 12 + i * Math.PI) * 0.25;
      }
    }

    // Charger laser sight visibility
    if (this.chargerLaserMesh) {
      this.chargerLaserMesh.visible =
        this.currentWeapon === 'charger' && this.currentMode === PlayerMode.HUMANOID;
    }
  }

  /**
   * Adds a deterministic cosmetic headgear variant (cap / goggles / dorsal
   * fin) so characters on the field do not all look identical. Call once
   * after construction; the variant is derived from the player id.
   */
  applyCosmeticVariant(variant: number): void {
    if (this.cosmeticsApplied) return;
    this.cosmeticsApplied = true;

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffc63a,
      roughness: 0.35,
      metalness: 0.55,
      emissive: 0x332200
    });
    this.materials.push(goldMat);

    const style = ((variant % 3) + 3) % 3;
    if (style === 0) {
      // Baseball cap: dome + brim facing forward
      const domeGeo = new THREE.SphereGeometry(0.315, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      this.geometries.push(domeGeo);
      const dome = new THREE.Mesh(domeGeo, goldMat);
      dome.position.set(0, 0.1, 0);
      dome.castShadow = true;
      this.headGroup.add(dome);

      const brimGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.03, 16, 1, false, 0, Math.PI);
      this.geometries.push(brimGeo);
      const brim = new THREE.Mesh(brimGeo, goldMat);
      brim.rotation.x = Math.PI / 2;
      brim.rotation.z = Math.PI;
      brim.position.set(0, 0.11, -0.18);
      brim.scale.z = 0.55;
      this.headGroup.add(brim);
    } else if (style === 1) {
      // Tactical goggles: extra lens + strap over the default visor
      const goggleGeo = new THREE.BoxGeometry(0.4, 0.1, 0.06);
      this.geometries.push(goggleGeo);
      const goggle = new THREE.Mesh(goggleGeo, goldMat);
      goggle.position.set(0, 0.16, -0.27);
      this.headGroup.add(goggle);

      const strapGeo = new THREE.TorusGeometry(0.31, 0.03, 6, 18, Math.PI);
      this.geometries.push(strapGeo);
      const strap = new THREE.Mesh(strapGeo, goldMat);
      strap.rotation.x = -Math.PI / 2;
      strap.position.set(0, 0.05, 0);
      this.headGroup.add(strap);
    } else {
      // Squid dorsal fin on the back of the head
      const finGeo = new THREE.ConeGeometry(0.09, 0.34, 4);
      this.geometries.push(finGeo);
      const fin = new THREE.Mesh(finGeo, goldMat);
      fin.position.set(0, 0.3, 0.16);
      fin.rotation.x = -0.5;
      fin.castShadow = true;
      this.headGroup.add(fin);
    }
  }

  dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
    if (this.nameplateTexture) {
      this.nameplateTexture.dispose();
    }
  }
}
