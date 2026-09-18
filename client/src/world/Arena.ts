import * as THREE from 'three';
import { ARENA_HALF_SIZE, ARENA_OBSTACLES, ARENA_SIZE, BoxObstacle, Team } from '@ink/shared';
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
    groundGeo.rotateX(-Math.PI / 2);

    // Explicitly align UV coordinates with worldToUV (x, z in [-50, 50] -> u, v in [0, 1])
    const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
    const uvAttr = groundGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, (x + ARENA_HALF_SIZE) / ARENA_SIZE, (z + ARENA_HALF_SIZE) / ARENA_SIZE);
    }
    uvAttr.needsUpdate = true;

    const groundMat = new THREE.MeshStandardMaterial({
      map: this.paintEngine.texture,
      roughness: 0.45,
      metalness: 0.12
    });

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
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

    // Pink Forcefield Barrier Dome (Subagent 80)
    const pinkDomeGeo = new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const pinkDomeMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      emissive: 0xff007f,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.22,
      roughness: 0.2,
      side: THREE.DoubleSide
    });
    const pinkDome = new THREE.Mesh(pinkDomeGeo, pinkDomeMat);
    pinkDome.position.set(-40, 0, 0);
    this.group.add(pinkDome);

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

    // Cyan Forcefield Barrier Dome (Subagent 80)
    const cyanDomeGeo = new THREE.SphereGeometry(6.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const cyanDomeMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.22,
      roughness: 0.2,
      side: THREE.DoubleSide
    });
    const cyanDome = new THREE.Mesh(cyanDomeGeo, cyanDomeMat);
    cyanDome.position.set(40, 0, 0);
    this.group.add(cyanDome);
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

  /**
   * Returns paintable ground mesh surface (Subagent 04)
   */
  getPaintSurface(): THREE.Mesh {
    return this.groundMesh;
  }

  /**
   * Returns camera collision obstacle meshes (Subagent 04)
   */
  getCameraCollisionMeshes(): THREE.Mesh[] {
    return this.obstacleMeshes;
  }
}
