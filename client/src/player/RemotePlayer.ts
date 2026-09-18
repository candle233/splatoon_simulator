import { Team } from '@ink/shared';
import { InterpolatedPlayerState } from '../network/SnapshotBuffer.js';
import { PlayerView } from './PlayerView.js';

export class RemotePlayer {
  readonly id: string;
  readonly team: Team;
  readonly view: PlayerView;

  constructor(id: string, team: Team) {
    this.id = id;
    this.team = team;
    this.view = new PlayerView(team);
  }

  update(state: InterpolatedPlayerState, time: number): void {
    this.view.group.position.set(state.position.x, state.position.y, state.position.z);
    this.view.group.rotation.y = state.yaw;

    this.view.setMode(state.alive ? state.mode : 2); // 2 = DEAD
    this.view.updateVisuals(state.invulnerable, time);
  }

  dispose(): void {
    this.view.dispose();
  }
}
