import { PlayerSnapshot, Vec3, WeaponType, lerp } from '@ink/shared';

export interface TimestampedSnapshot {
  timestamp: number;
  players: Map<string, PlayerSnapshot>;
}

export interface InterpolatedPlayerState {
  position: Vec3;
  yaw: number;
  pitch: number;
  mode: number;
  alive: boolean;
  hp: number;
  invulnerable: boolean;
  weaponType?: WeaponType;
  ink?: number;
  name?: string;
}

/**
 * Creates a fully-populated state object suitable for reuse as the `out`
 * parameter of {@link SnapshotBuffer.getInterpolatedState}. Every field is
 * written on every call, so a reused buffer never leaks a previous player's
 * values.
 */
export function createInterpolatedState(): InterpolatedPlayerState {
  return {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    mode: 0,
    alive: false,
    hp: 0,
    invulnerable: false
  };
}

/** Copies a raw snapshot into a reusable state object, in place. */
function writeSnapshotState(
  out: InterpolatedPlayerState,
  snap: PlayerSnapshot
): InterpolatedPlayerState {
  out.position.x = snap.x;
  out.position.y = snap.y;
  out.position.z = snap.z;
  out.yaw = snap.yaw;
  out.pitch = snap.pitch;
  out.mode = snap.mode;
  out.alive = snap.alive;
  out.hp = snap.hp;
  out.invulnerable = snap.invulnerable;
  out.weaponType = snap.weaponType;
  out.ink = snap.ink;
  out.name = snap.name;
  return out;
}

export class SnapshotBuffer {
  private buffer: TimestampedSnapshot[] = [];
  private maxBufferSize = 30; // ~1.5s of snapshots at 20Hz
  private interpolationDelayMs = 100; // 100ms interpolation buffer

  addSnapshot(serverTime: number, players: PlayerSnapshot[]): void {
    const playerMap = new Map<string, PlayerSnapshot>();
    for (const p of players) {
      playerMap.set(p.id, p);
    }

    this.buffer.push({
      timestamp: serverTime,
      players: playerMap
    });

    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  /**
   * Interpolates a remote player's state at `currentServerTime`.
   *
   * Pass a persistent `out` object (see {@link createInterpolatedState}) to make
   * the per-frame path allocation-free; the object is fully overwritten and
   * returned. Without `out` a fresh object is allocated, which is what the unit
   * tests and one-off callers use.
   */
  getInterpolatedState(
    playerId: string,
    currentServerTime: number,
    out?: InterpolatedPlayerState
  ): InterpolatedPlayerState | null {
    if (this.buffer.length === 0) return null;

    const renderTime = currentServerTime - this.interpolationDelayMs;

    // If buffer only has 1 snapshot or render time is ahead of buffer, use latest
    const latest = this.buffer[this.buffer.length - 1]!;
    if (this.buffer.length === 1 || renderTime >= latest.timestamp) {
      const snap = latest.players.get(playerId);
      if (!snap) return null;
      return writeSnapshotState(out ?? createInterpolatedState(), snap);
    }

    // If render time is behind oldest snapshot in buffer, use oldest
    const oldest = this.buffer[0]!;
    if (renderTime <= oldest.timestamp) {
      const snap = oldest.players.get(playerId);
      if (!snap) return null;
      return writeSnapshotState(out ?? createInterpolatedState(), snap);
    }

    // Find two adjacent snapshots s0 and s1
    let s0: TimestampedSnapshot | null = null;
    let s1: TimestampedSnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const a = this.buffer[i]!;
      const b = this.buffer[i + 1]!;
      if (a.timestamp <= renderTime && renderTime <= b.timestamp) {
        s0 = a;
        s1 = b;
        break;
      }
    }

    if (!s0 || !s1) {
      const snap = latest.players.get(playerId);
      if (!snap) return null;
      return writeSnapshotState(out ?? createInterpolatedState(), snap);
    }

    const snap0 = s0.players.get(playerId);
    const snap1 = s1.players.get(playerId);

    if (!snap0 || !snap1) {
      const fallback = snap1 || snap0;
      if (!fallback) return null;
      return writeSnapshotState(out ?? createInterpolatedState(), fallback);
    }

    const timeDelta = s1.timestamp - s0.timestamp;
    const alpha = timeDelta > 0 ? (renderTime - s0.timestamp) / timeDelta : 0;

    return interpolatePlayerState(snap0, snap1, alpha, out);
  }

  clear(): void {
    this.buffer = [];
  }
}

/**
 * Pure interpolation function between two player snapshots (Subagent 37)
 *
 * Includes teleport / respawn detection: avoids sliding across arena when respawning.
 * Pass `out` to write into a reusable object instead of allocating a new one.
 */
export function interpolatePlayerState(
  snap0: PlayerSnapshot,
  snap1: PlayerSnapshot,
  alpha: number,
  out?: InterpolatedPlayerState
): InterpolatedPlayerState {
  // Teleport / Respawn Detection:
  // If player transitioned from dead to alive, or position jumped > 10m, snap directly without lerp
  const dx = snap1.x - snap0.x;
  const dy = snap1.y - snap0.y;
  const dz = snap1.z - snap0.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  const isRespawnOrTeleport = (!snap0.alive && snap1.alive) || distSq > 100.0;

  const posX = isRespawnOrTeleport ? snap1.x : lerp(snap0.x, snap1.x, alpha);
  const posY = isRespawnOrTeleport ? snap1.y : lerp(snap0.y, snap1.y, alpha);
  const posZ = isRespawnOrTeleport ? snap1.z : lerp(snap0.z, snap1.z, alpha);

  // Shortest-path angle interpolation for yaw
  let diffYaw = snap1.yaw - snap0.yaw;
  while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
  while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
  const interpYaw = snap0.yaw + diffYaw * alpha;

  const state = out ?? createInterpolatedState();
  state.position.x = posX;
  state.position.y = posY;
  state.position.z = posZ;
  state.yaw = interpYaw;
  state.pitch = lerp(snap0.pitch, snap1.pitch, alpha);
  state.mode = snap1.mode;
  state.alive = snap1.alive;
  state.hp = snap1.hp;
  state.invulnerable = snap1.invulnerable;
  state.weaponType = snap1.weaponType || snap0.weaponType;
  state.ink = snap1.ink;
  state.name = snap1.name || snap0.name;
  return state;
}
