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

  // Weapon models
  private weaponAnchor = new THREE.Group();
  private shooterGroup = new THREE.Group();
  private rollerGroup = new THREE.Group();
  private chargerGroup = new THREE.Group();
  private slosherGroup = new THREE.Group();
  private muzzleFlashMesh: THREE.Mesh;

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

    // Cephalopod Squid Tentacles / Hair
    for (let side = -1; side <= 1; side += 2) {
      const tentacleGeo = new THREE.CylinderGeometry(0.08, 0.03, 0.65, 8);
      this.geometries.push(tentacleGeo);
      const tentacle = new THREE.Mesh(tentacleGeo, bodyMat);
      tentacle.position.set(side * 0.2, -0.15, 0.22);
      tentacle.rotation.x = -0.3;
      tentacle.rotation.z = side * 0.2;
      this.headGroup.add(tentacle);
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
    this.torsoGroup.add(tankGroup);

    this.torsoGroup.position.y = 0.85;
    this.humanoidGroup.add(this.torsoGroup);

    // Left Arm (pivot at shoulder)
    this.leftArm.position.set(-0.38, 1.15, 0);
    const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8);
    this.geometries.push(armGeo);
    const leftArmMesh = new THREE.Mesh(armGeo, darkMat);
    leftArmMesh.position.y = -0.22;
    this.leftArm.add(leftArmMesh);
    this.humanoidGroup.add(this.leftArm);

    // Right Arm (pivot at shoulder)
    this.rightArm.position.set(0.38, 1.15, 0);
    const rightArmMesh = new THREE.Mesh(armGeo, darkMat);
    rightArmMesh.position.y = -0.22;
    this.rightArm.add(rightArmMesh);
    this.humanoidGroup.add(this.rightArm);

    // Left Leg (pivot at hip)
    this.leftLeg.position.set(-0.16, 0.55, 0);
    const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.55, 8);
    this.geometries.push(legGeo);
    const leftLegMesh = new THREE.Mesh(legGeo, darkMat);
    leftLegMesh.position.y = -0.25;
    leftLegMesh.castShadow = true;
    this.leftLeg.add(leftLegMesh);

    const bootGeo = new THREE.BoxGeometry(0.16, 0.12, 0.25);
    this.geometries.push(bootGeo);
    const leftBoot = new THREE.Mesh(bootGeo, bodyMat);
    leftBoot.position.set(0, -0.5, -0.05);
    this.leftLeg.add(leftBoot);
    this.humanoidGroup.add(this.leftLeg);

    // Right Leg (pivot at hip)
    this.rightLeg.position.set(0.16, 0.55, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, darkMat);
    rightLegMesh.position.y = -0.25;
    rightLegMesh.castShadow = true;
    this.rightLeg.add(rightLegMesh);

    const rightBoot = new THREE.Mesh(bootGeo, bodyMat);
    rightBoot.position.set(0, -0.5, -0.05);
    this.rightLeg.add(rightBoot);
    this.humanoidGroup.add(this.rightLeg);

    // ==========================================
    // 2. Weapon Models
    // ==========================================
    this.weaponAnchor.position.set(0.32, 0.85, -0.3);

    // 2.1 Shooter (Splattershot)
    const shooterBarGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.65, 8);
    this.geometries.push(shooterBarGeo);
    const shooterBar = new THREE.Mesh(shooterBarGeo, darkMat);
    shooterBar.rotation.x = Math.PI / 2;
    this.shooterGroup.add(shooterBar);

    const nozzleGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.18, 8);
    this.geometries.push(nozzleGeo);
    const nozzle = new THREE.Mesh(nozzleGeo, bodyMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -0.38;
    this.shooterGroup.add(nozzle);
    this.weaponAnchor.add(this.shooterGroup);

    // 2.2 Roller (Splat Roller)
    const rollerHandleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8);
    this.geometries.push(rollerHandleGeo);
    const rollerHandle = new THREE.Mesh(rollerHandleGeo, darkMat);
    rollerHandle.rotation.x = 0.5;
    rollerHandle.position.set(0, 0, -0.1);
    this.rollerGroup.add(rollerHandle);

    const rollerCylinderGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.4, 14);
    this.geometries.push(rollerCylinderGeo);
    const rollerCylinder = new THREE.Mesh(rollerCylinderGeo, bodyMat);
    rollerCylinder.rotation.z = Math.PI / 2;
    rollerCylinder.position.set(0, -0.35, -0.6);
    this.rollerGroup.add(rollerCylinder);
    this.rollerGroup.visible = false;
    this.weaponAnchor.add(this.rollerGroup);

    // 2.3 Charger (Splat Charger)
    const chargerBodyGeo = new THREE.BoxGeometry(0.1, 0.14, 0.5);
    this.geometries.push(chargerBodyGeo);
    const chargerBody = new THREE.Mesh(chargerBodyGeo, darkMat);
    this.chargerGroup.add(chargerBody);

    const chargerBarrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8);
    this.geometries.push(chargerBarrelGeo);
    const chargerBarrel = new THREE.Mesh(chargerBarrelGeo, bodyMat);
    chargerBarrel.rotation.x = Math.PI / 2;
    chargerBarrel.position.z = -0.7;
    this.chargerGroup.add(chargerBarrel);

    const scopeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
    this.geometries.push(scopeGeo);
    const scope = new THREE.Mesh(scopeGeo, darkMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.12, -0.1);
    this.chargerGroup.add(scope);
    this.chargerGroup.visible = false;
    this.weaponAnchor.add(this.chargerGroup);

    // 2.4 Slosher (Bucket)
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

    this.submergedGroup.visible = false;
    this.group.add(this.submergedGroup);
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
    } else if (mode === PlayerMode.SUBMERGED) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = true;
      if (this.nameplateSprite) this.nameplateSprite.visible = false;
    } else {
      this.humanoidGroup.visible = true;
      this.submergedGroup.visible = false;
      if (this.nameplateSprite) this.nameplateSprite.visible = true;
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
    } else {
      // Return smoothly to idle weapon pose
      this.leftLeg.rotation.x *= 0.85;
      this.rightLeg.rotation.x *= 0.85;
      this.leftArm.rotation.set(baseLeftX, baseLeftY, baseLeftZ);
      this.rightArm.rotation.set(baseRightX, baseRightY, baseRightZ);
      this.torsoGroup.position.y = 0.85;
      this.torsoGroup.rotation.z = 0;
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

    // Gentle ripple animation when submerged with dynamic dive scale
    if (this.submergedGroup.visible) {
      if (this.diveTransitionTimer > 0) {
        this.diveTransitionTimer = Math.max(0, this.diveTransitionTimer - 0.016);
      }
      const scale = 1.0 + Math.sin(time * 9) * 0.18 + (this.diveTransitionTimer / 0.22) * 0.4;
      this.rippleMesh.scale.set(scale, scale, 1);
      this.squidDomeMesh.scale.set(scale, 1.0, scale);
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
