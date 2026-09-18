import * as THREE from 'three';
import { Ray, Vec3, vec3Normalize, vec3Sub } from '@ink/shared';
import { ClientCollisionWorld } from '../world/CollisionWorld.js';

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private collisionWorld: ClientCollisionWorld;

  private baseDistance = 5.2;
  private cameraHeight = 1.8;
  private shoulderOffset = 0.65;

  // Reusable vectors to avoid allocations in render loop
  private tempPlayerHead = new THREE.Vector3();
  private tempDesiredPos = new THREE.Vector3();
  private tempAimTarget = new THREE.Vector3();
  private tempForward = new THREE.Vector3();
  private tempRight = new THREE.Vector3();
  private tempRayDir = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, collisionWorld: ClientCollisionWorld) {
    this.camera = camera;
    this.collisionWorld = collisionWorld;
  }

  update(playerPos: Vec3, yaw: number, pitch: number): void {
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    // Forward vector (looking direction)
    this.tempForward.set(-sinYaw * cosPitch, sinPitch, -cosYaw * cosPitch);

    // Right vector
    this.tempRight.set(cosYaw, 0, -sinYaw);

    // Head position
    this.tempPlayerHead.set(playerPos.x, playerPos.y + this.cameraHeight, playerPos.z);

    // Desired camera position: behind player head + shoulder offset
    // Desired = head - forward * baseDistance + right * shoulderOffset
    this.tempDesiredPos.copy(this.tempPlayerHead)
      .addScaledVector(this.tempForward, -this.baseDistance)
      .addScaledVector(this.tempRight, this.shoulderOffset);

    // Camera Collision Raycast from Head to Desired Position
    this.tempRayDir.subVectors(this.tempDesiredPos, this.tempPlayerHead);
    const rayDist = this.tempRayDir.length();

    if (rayDist > 1e-4) {
      this.tempRayDir.normalize();
      const ray: Ray = {
        origin: { x: this.tempPlayerHead.x, y: this.tempPlayerHead.y, z: this.tempPlayerHead.z },
        direction: { x: this.tempRayDir.x, y: this.tempRayDir.y, z: this.tempRayDir.z }
      };

      const hitDist = this.collisionWorld.castCameraRay(ray, rayDist);
      if (hitDist !== null && hitDist < rayDist) {
        const safeDist = Math.max(0.6, hitDist - 0.25);
        this.tempDesiredPos.copy(this.tempPlayerHead).addScaledVector(this.tempRayDir, safeDist);
      }
    }

    // Apply to camera
    this.camera.position.copy(this.tempDesiredPos);

    // Look at point ahead along forward ray
    this.tempAimTarget.copy(this.tempPlayerHead).addScaledVector(this.tempForward, 30);
    this.camera.lookAt(this.tempAimTarget);
  }
}
