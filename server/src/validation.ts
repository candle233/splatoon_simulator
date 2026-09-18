import { PlayerInput, clamp } from '@ink/shared';

export function sanitizePlayerInput(input: unknown): PlayerInput | null {
  if (!input || typeof input !== 'object') return null;

  const raw = input as Record<string, unknown>;

  const seq = Number(raw.seq);
  const moveX = Number(raw.moveX);
  const moveZ = Number(raw.moveZ);
  const yaw = Number(raw.yaw);
  const pitch = Number(raw.pitch);
  const jump = Boolean(raw.jump);
  const squid = Boolean(raw.squid);
  const fire = Boolean(raw.fire);
  const subWeapon = Boolean(raw.subWeapon);
  const special = Boolean(raw.special);
  const chargeLevel = Number.isFinite(Number(raw.chargeLevel)) ? clamp(Number(raw.chargeLevel), 0, 1) : undefined;
  const weaponType =
    typeof raw.weaponType === 'string' && ['shooter', 'roller', 'charger', 'slosher'].includes(raw.weaponType)
      ? (raw.weaponType as any)
      : undefined;
  const clientTime = Number(raw.clientTime);

  if (
    !Number.isFinite(seq) ||
    !Number.isFinite(moveX) ||
    !Number.isFinite(moveZ) ||
    !Number.isFinite(yaw) ||
    !Number.isFinite(pitch)
  ) {
    return null;
  }

  return {
    seq: Math.floor(Math.max(0, seq)),
    moveX: clamp(moveX, -1.0, 1.0),
    moveZ: clamp(moveZ, -1.0, 1.0),
    yaw: yaw % (Math.PI * 2),
    // Pitch clamped to [-75 deg, 75 deg] in radians
    pitch: clamp(pitch, -1.3089969, 1.3089969),
    jump,
    squid,
    fire,
    subWeapon,
    special,
    chargeLevel,
    weaponType,
    clientTime: Number.isFinite(clientTime) ? clientTime : Date.now()
  };
}
