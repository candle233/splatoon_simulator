import * as THREE from 'three';
import { ARENA_OBSTACLES, ARENA_SIZE, BoxObstacle, Team } from '@ink/shared';
import { PaintEngine } from './PaintEngine.js';

export class Arena {
  readonly group = new THREE.Group();
  private paintEngine: PaintEngine;

  private groundMesh: THREE.Mesh;
  private obstacleMeshes: THREE.Mesh[] = [];

  constructor(paintEngine: PaintEngine, obstacles: BoxObstacle[] = ARENA_OBSTACLES) {
    this.paintEngine = paintEngine;

    // 1. Ground Plane (100 x 100)
    const groundGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.paintEngine.texture,
      roughness: 0.8,
      metalness: 0.1
    });

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, 0, 0);
    this.groundMesh.receiveShadow = true;
    this.group.add(this.groundMesh);

    // 2. Obstacles & Walls
    this.buildObstacles(obstacles);

    // 3. Team Spawn Bases
    this.buildSpawnBases();
  }

  private buildObstacles(obstacles: BoxObstacle[]): void {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2e323e,
      roughness: 0.7,
      metalness: 0.2
    });

    const blockMat = new THREE.MeshStandardMaterial({
      color: 0x424859,
      roughness: 0.6,
      metalness: 0.3
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x5a6378,
      roughness: 0.5,
      metalness: 0.4
    });

    for (const obs of obstacles) {
      const geo = new THREE.BoxGeometry(obs.size.x, obs.size.y, obs.size.z);
      const isWall = obs.id.startsWith('wall_');
      const isCenter = obs.id.startsWith('center_');

      const mat = isWall ? wallMat : isCenter ? accentMat : blockMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.obstacleMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private buildSpawnBases(): void {
    // Pink Spawn Pad at (-40, 0.05, 0)
    const pinkPadGeo = new THREE.CylinderGeometry(5.5, 6, 0.2, 32);
    const pinkPadMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      emissive: 0x330018,
      roughness: 0.4
    });
    const pinkPad = new THREE.Mesh(pinkPadGeo, pinkPadMat);
    pinkPad.position.set(-40, 0.1, 0);
    pinkPad.receiveShadow = true;
    this.group.add(pinkPad);

    // Cyan Spawn Pad at (40, 0.05, 0)
    const cyanPadGeo = new THREE.CylinderGeometry(5.5, 6, 0.2, 32);
    const cyanPadMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x003333,
      roughness: 0.4
    });
    const cyanPad = new THREE.Mesh(cyanPadGeo, cyanPadMat);
    cyanPad.position.set(40, 0.1, 0);
    cyanPad.receiveShadow = true;
    this.group.add(cyanPad);
  }

  dispose(): void {
    this.groundMesh.geometry.dispose();
    (this.groundMesh.material as THREE.Material).dispose();

    for (const mesh of this.obstacleMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }
}
