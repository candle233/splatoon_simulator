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
  private baseFov = 75;
  private fovOffset = 0;
  private targetFovOffset = 0;
  /** Downward spring after a fall. Decays back to the normal camera height. */
  private landingDip = 0;
  private bobTime = 0;

  // Reusable vectors to avoid allocations in render loop
  private tempPlayerHead = new THREE.Vector3();
  private tempDesiredPos = new THREE.Vector3();
  private tempAimTarget = new THREE.Vector3();
  private tempForward = new THREE.Vector3();
  private tempRight = new THREE.Vector3();
  private tempRayDir = new THREE.Vector3();
  private scratchRay: Ray = {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 0 }
  };

  constructor(camera: THREE.PerspectiveCamera, collisionWorld: ClientCollisionWorld) {
    this.camera = camera;
    this.collisionWorld = collisionWorld;
    this.baseFov = camera.fov || 75;
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  setFovOffset(offset: number): void {
    this.targetFovOffset = offset;
  }

  addShake(intensity: number, duration = 0.25): void {
    this.shakeIntensity = Math.min(1.0, this.shakeIntensity + intensity);
    this.shakeDecay = duration > 0 ? this.shakeIntensity / duration : 10;
  }

  addRecoil(pitchAmount: number): void {
    this.recoilPitch = Math.min(0.12, this.recoilPitch + pitchAmount);
  }

  /** Punch the camera down when the player lands. `impact` is 0..1. */
  addLanding(impact: number): void {
    const clamped = Math.max(0, Math.min(1, impact));
    this.landingDip = Math.min(0.42, this.landingDip + 0.08 + clamped * 0.26);
    this.addShake(0.06 + clamped * 0.2, 0.14);
  }

  update(
    playerPos: Vec3,
    yaw: number,
    pitch: number,
    dt = 0.016,
    isSubmerged = false,
    horizontalSpeed = 0
  ): void {
    const targetHeight = isSubmerged ? 1.25 : 1.8;
    this.cameraHeight += (targetHeight - this.cameraHeight) * Math.min(1, dt * 8);
    const targetDist = isSubmerged ? 4.3 : 5.2;
    this.baseDistance += (targetDist - this.baseDistance) * Math.min(1, dt * 8);

    // Smoothly apply FOV offset (e.g. charger zoom / marksman ADS)
    if (Math.abs(this.fovOffset - this.targetFovOffset) > 0.01 || Math.abs(this.fovOffset) > 0.01) {
      this.fovOffset += (this.targetFovOffset - this.fovOffset) * Math.min(1, dt * 10);
      if (Math.abs(this.fovOffset - this.targetFovOffset) <= 0.02 && this.targetFovOffset === 0) {
        this.fovOffset = 0;
      }
      const targetFov = this.baseFov + this.fovOffset;
      if (Math.abs(this.camera.fov - targetFov) > 0.02) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
    }

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
      this.scratchRay.origin.x = this.tempPlayerHead.x;
      this.scratchRay.origin.y = this.tempPlayerHead.y;
      this.scratchRay.origin.z = this.tempPlayerHead.z;
      this.scratchRay.direction.x = this.tempRayDir.x;
      this.scratchRay.direction.y = this.tempRayDir.y;
      this.scratchRay.direction.z = this.tempRayDir.z;

      const hitDist = this.collisionWorld.castCameraRay(this.scratchRay, rayDist);
      if (hitDist !== null && hitDist < rayDist) {
        const safeDist = Math.max(0.6, hitDist - 0.25);
        this.tempDesiredPos.copy(this.tempPlayerHead).addScaledVector(this.tempRayDir, safeDist);
      }
    }

    if (horizontalSpeed > 2.4) {
      this.bobTime += dt * (isSubmerged ? 5.4 : 7.4);
      const amp = Math.min(isSubmerged ? 0.028 : 0.038, horizontalSpeed * 0.0032);
      this.tempDesiredPos.y += Math.sin(this.bobTime) * amp;
    }

    if (this.landingDip > 0) {
      this.tempDesiredPos.y -= this.landingDip;
      this.landingDip = Math.max(0, this.landingDip - dt * (2.8 + this.landingDip * 8));
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
