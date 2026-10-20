import { EmoteType, PlayerInput, WEAPON_CONFIGS, WeaponType, clamp, isValidEmoteType } from '@ink/shared';
import type { Vec3 } from '@ink/shared';

/** Known main-weapon ids, derived from the shared config so new weapons need no edit here. */
const VALID_WEAPON_IDS = new Set<string>(Object.keys(WEAPON_CONFIGS));

/**
 * Largest avatar we will store, in characters of base64. The client downscales
 * to 128x128 JPEG (~10-20 KB encoded), so anything past this is abuse rather
 * than a real picture.
 */
export const MAX_AVATAR_CHARS = 64 * 1024;

/** Only real inline raster images are accepted; no URLs, no SVG, no scripts. */
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Validates a client-supplied avatar, returning it only when it is a plausible
 * inline raster image within the size cap.
 *
 * SVG is deliberately excluded: it can carry script, and the client only ever
 * produces JPEG.
 */
export function sanitizeAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_AVATAR_CHARS) return null;
  if (!AVATAR_DATA_URL.test(value)) return null;
  return value;
}

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
  const dodge = Boolean(raw.dodge);
  const chargeLevel = Number.isFinite(Number(raw.chargeLevel)) ? clamp(Number(raw.chargeLevel), 0, 1) : undefined;
  const weaponType =
    typeof raw.weaponType === 'string' && VALID_WEAPON_IDS.has(raw.weaponType)
      ? (raw.weaponType as WeaponType)
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
    dodge,
    chargeLevel,
    weaponType,
    clientTime: Number.isFinite(clientTime) ? clientTime : Date.now()
  };
}

/** Largest arena half-edge a map ping may target; anything beyond is out of bounds. */
const MAX_PING_ABS = 512;

export interface SanitizedEmote {
  type: EmoteType;
  position?: Vec3;
}

/**
 * Validates a client emote request. Only the emote type and (for pings) a sane
 * world position survive; identity fields (playerId / name / team) are read
 * from the authoritative server-side roster, never from the payload.
 */
export function sanitizeEmote(raw: unknown): SanitizedEmote | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isValidEmoteType(data.type)) return null;

  if (typeof data.type === 'string' && data.type.startsWith('ping_')) {
    const x = Number(data.x);
    const z = Number(data.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    if (Math.abs(x) > MAX_PING_ABS || Math.abs(z) > MAX_PING_ABS) return null;
    return { type: data.type, position: { x, y: 0, z } };
  }

  return { type: data.type };
}
