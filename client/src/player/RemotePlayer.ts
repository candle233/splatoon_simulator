import { PlayerMode, Team, WeaponType } from '@ink/shared';
import { InterpolatedPlayerState } from '../network/SnapshotBuffer.js';
import { PlayerView } from './PlayerView.js';

export class RemotePlayer {
  readonly id: string;
  readonly team: Team;
  readonly view: PlayerView;

  private lastPos = { x: 0, y: 0, z: 0 };
  private lastTime = 0;

  constructor(id: string, team: Team, weaponType: WeaponType = 'shooter') {
    this.id = id;
    this.team = team;
    this.view = new PlayerView(team);
    this.view.setWeaponType(weaponType);
  }

  update(state: InterpolatedPlayerState, time: number): void {
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

  dispose(): void {
    this.view.dispose();
  }
}
