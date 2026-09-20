import { PlayerMode, Team, WeaponType } from '@ink/shared';
import { InterpolatedPlayerState } from '../network/SnapshotBuffer.js';
import { PlayerView } from './PlayerView.js';
import * as THREE from 'three';

export class RemotePlayer {
  readonly id: string;
  readonly team: Team;
  readonly view: PlayerView;
  /** Optional alternate character model pair (kept for future standalone paths). */
  readonly characterModel: { inkling: THREE.Group; squid: THREE.Group } | null;

  private lastPos = { x: 0, y: 0, z: 0 };
  private lastTime = 0;
  private _alive: boolean = true;
  private _specialMeter: number = 0;
  private _squidForm: boolean = false;
  private _transitionTimer: number = 0;

  /** Current visible form: true = squid, false = humanoid. */
  get isSquidForm(): boolean {
    return this._squidForm;
  }

  get position() {
    return this.view.group.position;
  }

  get yaw() {
    return this.view.group.rotation.y;
  }

  get alive(): boolean {
    return this._alive;
  }

  set alive(val: boolean) {
    this._alive = val;
  }

  get specialMeter(): number {
    return this._specialMeter;
  }

  set specialMeter(val: number) {
    this._specialMeter = val;
  }

  constructor(id: string, team: Team, weaponType: WeaponType = 'shooter') {
    this.id = id;
    this.team = team;
    this.view = new PlayerView(team);
    this.view.setWeaponType(weaponType);
    // characterModel is null when using PlayerView; kept for future standalone paths.
    this.characterModel = null;
  }

  update(state: InterpolatedPlayerState, time: number): void {
    this._alive = state.alive;
    const dt = this.lastTime > 0 ? Math.max(0.001, Math.min(0.1, time - this.lastTime)) : 0.05;
    const dx = state.position.x - this.lastPos.x;
    const dz = state.position.z - this.lastPos.z;
    const speed = Math.sqrt(dx * dx + dz * dz) / dt;

    this.lastPos.x = state.position.x;
    this.lastPos.y = state.position.y;
    this.lastPos.z = state.position.z;
    this.lastTime = time;

    this.view.group.position.set(state.position.x, state.position.y, state.position.z);
    this.view.group.rotation.y = state.yaw;

    if (state.weaponType) {
      this.view.setWeaponType(state.weaponType);
    }
    if (state.name) {
      this.view.setName(state.name);
    }

    this.view.setMode(state.alive ? state.mode : PlayerMode.DEAD);
    this.view.updateLocomotion(dt, speed, state.position.y <= 0.2, state.pitch);
    this.view.updateVisuals(state.invulnerable, time, state.ink ?? 100);
  }

  setName(name: string): void {
    this.view.setName(name);
  }

  triggerRecoil(): void {
    this.view.triggerRecoil();
  }

  /**
   * Switches the character between humanoid and squid form with a scale-based
   * transition animation. Delegates to the view's setMode for the authoritative
   * visual.
   *
   * @param enabled - true to enter squid form, false to return to humanoid
   */
  setSquidForm(enabled: boolean): void {
    this._squidForm = enabled;
    this._transitionTimer = 0.3; // 0.3s transition
    if (enabled) {
      this.view.setMode(PlayerMode.SUBMERGED);
    } else {
      this.view.setMode(PlayerMode.HUMANOID);
    }
  }

  /**
   * Advances any in-progress form transition. Call from the render loop.
   * @returns true when the transition is complete.
   */
  tickTransition(dt: number): boolean {
    if (this._transitionTimer <= 0) return true;
    this._transitionTimer = Math.max(0, this._transitionTimer - dt);
    return this._transitionTimer <= 0;
  }

  dispose(): void {
    this.view.dispose();
  }
}
