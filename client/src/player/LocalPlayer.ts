import * as THREE from 'three';
import {
  ENEMY_INK_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_HP,
  MAX_INK,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PlayerInput,
  PlayerMode,
  PlayerSnapshot,
  RUN_SPEED,
  SQUID_HEIGHT,
  SQUID_SPEED,
  Team,
  Vec3
} from '@ink/shared';
import { ClientCollisionWorld } from '../world/CollisionWorld.js';
import { PlayerView } from './PlayerView.js';

export class LocalPlayer {
  readonly id: string;
  readonly team: Team;
  readonly view: PlayerView;

  position: Vec3;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;

  hp = MAX_HP;
  ink = MAX_INK;
  mode = PlayerMode.HUMANOID;
  alive = true;
  grounded = true;
  invulnerable = false;
  kills = 0;
  deaths = 0;

  private collisionWorld: ClientCollisionWorld;

  constructor(
    id: string,
    team: Team,
    spawnPos: Vec3,
    collisionWorld: ClientCollisionWorld
  ) {
    this.id = id;
    this.team = team;
    this.position = { ...spawnPos };
    this.collisionWorld = collisionWorld;
    this.view = new PlayerView(team);
    this.syncViewPosition();
  }

  predictMovement(input: PlayerInput, dt: number, groundInk: Team): void {
    if (!this.alive) return;

    this.yaw = input.yaw;
    this.pitch = input.pitch;

    const isEnemyInk = this.team === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;
    const isOwnInk = groundInk === this.team;

    let currentSpeed = RUN_SPEED;
    if (input.squid && isOwnInk && this.grounded) {
      this.mode = PlayerMode.SUBMERGED;
      currentSpeed = SQUID_SPEED;
    } else {
      this.mode = PlayerMode.HUMANOID;
      currentSpeed = isEnemyInk ? ENEMY_INK_SPEED : RUN_SPEED;
    }

    // Direction calculation
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);

    const forwardX = -sinYaw;
    const forwardZ = -cosYaw;
    const rightX = cosYaw;
    const rightZ = -sinYaw;

    const inputForward = -input.moveZ;
    const inputRight = input.moveX;

    let moveLen = Math.sqrt(inputRight * inputRight + inputForward * inputForward);
    let normRight = 0;
    let normForward = 0;
    if (moveLen > 1e-4) {
      if (moveLen > 1.0) {
        normRight = inputRight / moveLen;
        normForward = inputForward / moveLen;
      } else {
        normRight = inputRight;
        normForward = inputForward;
      }
    }

    this.velocity.x = (rightX * normRight + forwardX * normForward) * currentSpeed;
    this.velocity.z = (rightZ * normRight + forwardZ * normForward) * currentSpeed;

    // Jump
    if (input.jump && this.grounded && this.mode === PlayerMode.HUMANOID) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
    }

    // Gravity
    if (!this.grounded) {
      this.velocity.y += GRAVITY * dt;
    }

    // Collision & Integration
    const radius = PLAYER_RADIUS;
    const height = this.mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    const prevPos = { ...this.position };
    const newPos = {
      x: this.position.x + this.velocity.x * dt,
      y: this.position.y + this.velocity.y * dt,
      z: this.position.z + this.velocity.z * dt
    };

    const res = this.collisionWorld.resolveMovement(
      prevPos,
      newPos,
      radius,
      height,
      this.velocity
    );

    this.position = res.position;
    this.velocity = res.velocity;
    this.grounded = res.grounded;

    this.syncViewPosition();
    this.view.setMode(this.mode);
  }

  applyServerState(snapshot: PlayerSnapshot): void {
    this.hp = snapshot.hp;
    this.ink = snapshot.ink;
    this.alive = snapshot.alive;
    this.invulnerable = snapshot.invulnerable;
    this.kills = snapshot.kills;
    this.deaths = snapshot.deaths;

    // Smooth error correction if discrepancy is moderate, snap if large
    const dx = snapshot.x - this.position.x;
    const dy = snapshot.y - this.position.y;
    const dz = snapshot.z - this.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq > 4.0 || !this.alive) {
      // Large deviation or dead -> snap to server position
      this.position.x = snapshot.x;
      this.position.y = snapshot.y;
      this.position.z = snapshot.z;
      this.mode = snapshot.mode;
    } else if (distSq > 0.04) {
      // Small deviation -> soft blend towards authoritative position
      this.position.x += dx * 0.2;
      this.position.y += dy * 0.2;
      this.position.z += dz * 0.2;
    }

    this.syncViewPosition();
    this.view.setMode(this.alive ? this.mode : PlayerMode.DEAD);
  }

  private syncViewPosition(): void {
    this.view.group.position.set(this.position.x, this.position.y, this.position.z);
    this.view.group.rotation.y = this.yaw;
  }

  updateVisuals(time: number): void {
    this.view.updateVisuals(this.invulnerable, time);
  }

  dispose(): void {
    this.view.dispose();
  }
}
