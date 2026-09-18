import * as THREE from 'three';
import { PlayerMode, Team } from '@ink/shared';

export class PlayerView {
  readonly group = new THREE.Group();

  private humanoidGroup = new THREE.Group();
  private submergedGroup = new THREE.Group();

  private bodyMesh: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private gunMesh: THREE.Mesh;
  private rippleMesh: THREE.Mesh;

  private teamColorHex: number;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(team: Team) {
    this.teamColorHex = team === Team.PINK ? 0xff007f : 0x00ffff;

    // 1. Build Humanoid Mesh Group
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.teamColorHex,
      roughness: 0.4,
      metalness: 0.2
    });
    this.materials.push(bodyMat);

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x22222a,
      roughness: 0.6
    });
    this.materials.push(darkMat);

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xffee55,
      roughness: 0.2,
      metalness: 0.8
    });
    this.materials.push(visorMat);

    // Body Cylinder/Capsule (height: 1.1, radius: 0.35)
    const bodyGeo = new THREE.CylinderGeometry(0.32, 0.36, 1.0, 16);
    this.geometries.push(bodyGeo);
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.7;
    this.bodyMesh.castShadow = true;
    this.humanoidGroup.add(this.bodyMesh);

    // Head Sphere (radius: 0.3)
    const headGeo = new THREE.SphereGeometry(0.3, 16, 16);
    this.geometries.push(headGeo);
    this.headMesh = new THREE.Mesh(headGeo, bodyMat);
    this.headMesh.position.y = 1.45;
    this.headMesh.castShadow = true;
    this.humanoidGroup.add(this.headMesh);

    // Visor
    const visorGeo = new THREE.BoxGeometry(0.35, 0.12, 0.25);
    this.geometries.push(visorGeo);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 1.45, -0.22);
    this.humanoidGroup.add(visorMesh);

    // Backpack / Ink Tank
    const tankGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 12);
    this.geometries.push(tankGeo);
    const tankMesh = new THREE.Mesh(tankGeo, darkMat);
    tankMesh.position.set(0, 0.8, 0.32);
    this.humanoidGroup.add(tankMesh);

    // Ink Blaster
    const gunGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8);
    this.geometries.push(gunGeo);
    this.gunMesh = new THREE.Mesh(gunGeo, darkMat);
    this.gunMesh.rotation.x = Math.PI / 2;
    this.gunMesh.position.set(0.35, 0.85, -0.4);
    this.gunMesh.castShadow = true;
    this.humanoidGroup.add(this.gunMesh);

    // Gun nozzle (team colored)
    const nozzleGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.2, 8);
    this.geometries.push(nozzleGeo);
    const nozzleMesh = new THREE.Mesh(nozzleGeo, bodyMat);
    nozzleMesh.rotation.x = Math.PI / 2;
    nozzleMesh.position.set(0.35, 0.85, -0.75);
    this.humanoidGroup.add(nozzleMesh);

    this.group.add(this.humanoidGroup);

    // 2. Build Submerged / Squid Form Visual (Ripple & low marker)
    const rippleGeo = new THREE.RingGeometry(0.2, 0.8, 24);
    this.geometries.push(rippleGeo);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: this.teamColorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.materials.push(rippleMat);

    this.rippleMesh = new THREE.Mesh(rippleGeo, rippleMat);
    this.rippleMesh.rotation.x = -Math.PI / 2;
    this.rippleMesh.position.y = 0.04;
    this.submergedGroup.add(this.rippleMesh);

    // Small low marker dome in the center of ripple
    const domeGeo = new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geometries.push(domeGeo);
    const domeMesh = new THREE.Mesh(domeGeo, bodyMat);
    domeMesh.position.y = 0.02;
    this.submergedGroup.add(domeMesh);

    this.submergedGroup.visible = false;
    this.group.add(this.submergedGroup);
  }

  private currentMode: PlayerMode = PlayerMode.HUMANOID;

  setMode(mode: PlayerMode): void {
    this.currentMode = mode;
    if (mode === PlayerMode.DEAD) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = false;
    } else if (mode === PlayerMode.SUBMERGED) {
      this.humanoidGroup.visible = false;
      this.submergedGroup.visible = true;
    } else {
      this.humanoidGroup.visible = true;
      this.submergedGroup.visible = false;
    }
  }

  updateVisuals(invulnerable: boolean, time: number): void {
    if (this.currentMode === PlayerMode.DEAD) return;

    if (invulnerable) {
      // Blink visual
      const blink = Math.sin(time * 20) > 0;
      if (this.currentMode === PlayerMode.HUMANOID) {
        this.humanoidGroup.visible = blink;
      }
    } else {
      if (this.currentMode === PlayerMode.HUMANOID) {
        this.humanoidGroup.visible = true;
      }
    }

    // Gentle ripple animation when submerged
    if (this.submergedGroup.visible) {
      const scale = 1.0 + Math.sin(time * 8) * 0.15;
      this.rippleMesh.scale.set(scale, scale, 1);
    }
  }

  dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
  }
}
