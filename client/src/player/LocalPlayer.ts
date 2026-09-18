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
  private pendingInputs: { seq: number; input: PlayerInput; dt: number; groundInk: Team }[] = [];

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

  private simulateStep(
    pos: Vec3,
    vel: Vec3,
    grounded: boolean,
    input: PlayerInput,
    dt: number,
    groundInk: Team
  ): { position: Vec3; velocity: Vec3; grounded: boolean; mode: PlayerMode } {
    const isEnemyInk = this.team === Team.PINK ? groundInk === Team.CYAN : groundInk === Team.PINK;
    const isOwnInk = groundInk === this.team;

    let currentSpeed = RUN_SPEED;
    let mode = PlayerMode.HUMANOID;
    if (input.squid && isOwnInk && grounded) {
      mode = PlayerMode.SUBMERGED;
      currentSpeed = SQUID_SPEED;
    } else {
      mode = PlayerMode.HUMANOID;
      currentSpeed = isEnemyInk ? ENEMY_INK_SPEED : RUN_SPEED;
    }

    const sinYaw = Math.sin(input.yaw);
    const cosYaw = Math.cos(input.yaw);

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

    const stepVel = {
      x: (rightX * normRight + forwardX * normForward) * currentSpeed,
      y: vel.y,
      z: (rightZ * normRight + forwardZ * normForward) * currentSpeed
    };

    let stepGrounded = grounded;
    if (input.jump && stepGrounded) {
      stepVel.y = JUMP_VELOCITY;
      stepGrounded = false;
    }

    if (!stepGrounded) {
      stepVel.y += GRAVITY * dt;
    }

    const radius = PLAYER_RADIUS;
    const height = mode === PlayerMode.SUBMERGED ? SQUID_HEIGHT : PLAYER_HEIGHT;

    const newPos = {
      x: pos.x + stepVel.x * dt,
      y: pos.y + stepVel.y * dt,
      z: pos.z + stepVel.z * dt
    };

    const res = this.collisionWorld.resolveMovement(
      pos,
      newPos,
      radius,
      height,
      stepVel
    );

    return {
      position: res.position,
      velocity: res.velocity,
      grounded: res.grounded,
      mode
    };
  }

  predictMovement(input: PlayerInput, dt: number, groundInk: Team): void {
    if (!this.alive) return;

    this.yaw = input.yaw;
    this.pitch = input.pitch;

    const res = this.simulateStep(
      this.position,
      this.velocity,
      this.grounded,
      input,
      dt,
      groundInk
    );

    this.position = res.position;
    this.velocity = res.velocity;
    this.grounded = res.grounded;
    this.mode = res.mode;

    this.pendingInputs.push({
      seq: input.seq,
      input: { ...input },
      dt,
      groundInk
    });

    if (this.pendingInputs.length > 120) {
      this.pendingInputs.shift();
    }

    this.syncViewPosition();
    this.view.setMode(this.mode);
  }

  applyServerState(snapshot: PlayerSnapshot, lastAckSeq?: number): void {
    this.hp = snapshot.hp;
    this.ink = snapshot.ink;
    this.alive = snapshot.alive;
    this.invulnerable = snapshot.invulnerable;
    this.kills = snapshot.kills;
    this.deaths = snapshot.deaths;

    if (!this.alive) {
      this.pendingInputs = [];
      this.position = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
      this.mode = PlayerMode.DEAD;
      this.syncViewPosition();
      this.view.setMode(PlayerMode.DEAD);
      return;
    }

    if (lastAckSeq !== undefined) {
      this.pendingInputs = this.pendingInputs.filter((p) => p.seq > lastAckSeq);
    }

    // Replay pending inputs starting from authoritative server snapshot
    let replayedPos = { x: snapshot.x, y: snapshot.y, z: snapshot.z };
    let replayedVel = { ...this.velocity };
    let replayedGrounded = this.grounded;
    let replayedMode = snapshot.mode;

    for (const item of this.pendingInputs) {
      const stepRes = this.simulateStep(
        replayedPos,
        replayedVel,
        replayedGrounded,
        item.input,
        item.dt,
        item.groundInk
      );
      replayedPos = stepRes.position;
      replayedVel = stepRes.velocity;
      replayedGrounded = stepRes.grounded;
      replayedMode = stepRes.mode;
    }

    const errX = replayedPos.x - this.position.x;
    const errY = replayedPos.y - this.position.y;
    const errZ = replayedPos.z - this.position.z;
    const errDistSq = errX * errX + errY * errY + errZ * errZ;

    if (errDistSq > 0.04) {
      // Reconcile to replayed authoritative state
      this.position = replayedPos;
      this.velocity = replayedVel;
      this.grounded = replayedGrounded;
      this.mode = replayedMode;
      this.syncViewPosition();
      this.view.setMode(this.mode);
    }
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
