import * as THREE from 'three';
import { Ray, Vec3, vec3Normalize, vec3Sub } from '@ink/shared';
import { ClientCollisionWorld } from '../world/CollisionWorld.js';

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private collisionWorld: ClientCollisionWorld;

  private baseDistance = 5.2;
  private cameraHeight = 1.8;
  private shoulderOffset = 0.65;
  private currentYaw = 0;
  private currentPitch = 0;

  // Camera Shake & Recoil (Subagents 73 & 74)
  private shakeIntensity = 0;
  private shakeDecay = 0;
  private recoilPitch = 0;

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

  addShake(intensity: number, duration = 0.25): void {
    this.shakeIntensity = Math.min(1.0, this.shakeIntensity + intensity);
    this.shakeDecay = duration > 0 ? this.shakeIntensity / duration : 10;
  }

  addRecoil(pitchAmount: number): void {
    this.recoilPitch = Math.min(0.12, this.recoilPitch + pitchAmount);
  }

  update(playerPos: Vec3, yaw: number, pitch: number, dt = 0.016): void {
    // Smoothly decay recoil pitch
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * 0.9);
    const effectivePitch = pitch + this.recoilPitch;

    this.currentYaw = yaw;
    this.currentPitch = effectivePitch;
    const cosPitch = Math.cos(effectivePitch);
    const sinPitch = Math.sin(effectivePitch);
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

    // Decay shake and apply randomized offset (Subagent 73)
    if (this.shakeIntensity > 0) {
      const shakeMag = this.shakeIntensity * 0.18;
      this.tempDesiredPos.x += (Math.random() - 0.5) * 2 * shakeMag;
      this.tempDesiredPos.y += (Math.random() - 0.5) * 2 * shakeMag;
      this.tempDesiredPos.z += (Math.random() - 0.5) * 2 * shakeMag;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    }

    // Apply to camera
    this.camera.position.copy(this.tempDesiredPos);

    // Look at point ahead along forward ray
    this.tempAimTarget.copy(this.tempPlayerHead).addScaledVector(this.tempForward, 30);
    this.camera.lookAt(this.tempAimTarget);
  }

  /**
   * Returns camera aim ray starting from camera position along forward vector (Subagent 06)
   */
  getAimRay(): Ray {
    return {
      origin: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      direction: { x: this.tempForward.x, y: this.tempForward.y, z: this.tempForward.z }
    };
  }

  /**
   * Returns current camera forward directional vector (Subagent 06)
   */
  getCameraForward(): Vec3 {
    return { x: this.tempForward.x, y: this.tempForward.y, z: this.tempForward.z };
  }

  getYaw(): number {
    return this.currentYaw;
  }

  getPitch(): number {
    return this.currentPitch;
  }
}
