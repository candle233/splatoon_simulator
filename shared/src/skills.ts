import type { SkillId } from './types.js';

export interface SkillStats {
  id: SkillId;
  icon: string;
  /** English name */
  name: string;
  nameZh: string;
  nameJa: string;
  description: string;
  descriptionZh: string;
  descriptionJa: string;
  /**
   * Multiplier applied to the affected stat. <1 reduces (costs / time),
   * >1 boosts (speed / regen / damage).
   */
  multiplier: number;
}

/**
 * Passive gear skills. A player equips up to MAX_SKILL_SLOTS distinct skills
 * in the lobby; the server applies the multipliers to movement, ink economy,
 * damage and respawn time.
 */
export const SKILL_CONFIGS: SkillStats[] = [
  {
    id: 'ink_saver',
    icon: '🪣',
    name: 'Ink Saver',
    nameZh: '主武器省墨',
    nameJa: 'インクセーバー',
    description: 'Main weapon ink costs reduced by 15%.',
    descriptionZh: '主武器墨水消耗降低 15%。',
    descriptionJa: 'メインウェポンのインク消費を15%削減。',
    multiplier: 0.85
  },
  {
    id: 'ink_recovery',
    icon: '♻️',
    name: 'Ink Recovery',
    nameZh: '墨水回复加速',
    nameJa: 'インク回復力',
    description: 'Ink tank refills 30% faster.',
    descriptionZh: '墨水回复速度提升 30%。',
    descriptionJa: 'インク回復速度が30%向上。',
    multiplier: 1.3
  },
  {
    id: 'run_speed',
    icon: '👟',
    name: 'Run Speed Up',
    nameZh: '行走加速',
    nameJa: 'ヒト移動速度',
    description: 'Humanoid movement speed +10%.',
    descriptionZh: '人形态移动速度提升 10%。',
    descriptionJa: 'ヒトの移動速度が10%アップ。',
    multiplier: 1.1
  },
  {
    id: 'swim_speed',
    icon: '🦑',
    name: 'Swim Speed Up',
    nameZh: '游泳加速',
    nameJa: 'イカ移動速度',
    description: 'Squid swim speed +15%.',
    descriptionZh: '乌贼形态游速提升 15%。',
    descriptionJa: 'イカの移動速度が15%アップ。',
    multiplier: 1.15
  },
  {
    id: 'special_charge',
    icon: '⚡',
    name: 'Special Charge Up',
    nameZh: '大招充能加速',
    nameJa: 'スペシャル増加量',
    description: 'Special gauge charges 25% faster.',
    descriptionZh: '大招充能速度提升 25%。',
    descriptionJa: 'スペシャルゲージが25%速く溜まる。',
    multiplier: 1.25
  },
  {
    id: 'quick_respawn',
    icon: '⏱️',
    name: 'Quick Respawn',
    nameZh: '快速复活',
    nameJa: 'リベンジ',
    description: 'Respawn 30% faster after being splatted.',
    descriptionZh: '被击败后复活时间缩短 30%。',
    descriptionJa: 'やられた後の復活時間を30%短縮。',
    multiplier: 0.7
  },
  {
    id: 'main_power',
    icon: '🎯',
    name: 'Main Power Up',
    nameZh: '主武器强化',
    nameJa: 'メイン性能',
    description: 'Main weapon damage +10%.',
    descriptionZh: '主武器伤害提升 10%。',
    descriptionJa: 'メインウェポンのダメージが10%アップ。',
    multiplier: 1.1
  },
  {
    id: 'defense',
    icon: '🛡️',
    name: 'Ink Resistance',
    nameZh: '受击减免',
    nameJa: '被ダメージ軽減',
    description: 'Damage taken reduced by 10%.',
    descriptionZh: '受到的伤害降低 10%。',
    descriptionJa: '受けるダメージを10%軽減。',
    multiplier: 0.9
  }
];

export const MAX_SKILL_SLOTS = 3;

const SKILL_BY_ID = new Map<SkillId, SkillStats>(SKILL_CONFIGS.map((s) => [s.id, s]));

export function isValidSkillId(id: unknown): id is SkillId {
  return typeof id === 'string' && SKILL_BY_ID.has(id as SkillId);
}

export function getSkill(id: SkillId): SkillStats {
  return SKILL_BY_ID.get(id) ?? (SKILL_CONFIGS[0] as SkillStats);
}

/**
 * Validates an arbitrary skills array into at most MAX_SKILL_SLOTS unique
 * known skill ids (order preserved). Unknown entries and duplicates drop.
 */
export function sanitizeSkills(raw: unknown): SkillId[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillId[] = [];
  for (const item of raw) {
    if (isValidSkillId(item) && !out.includes(item)) {
      out.push(item);
      if (out.length >= MAX_SKILL_SLOTS) break;
    }
  }
  return out;
}

/**
 * Multiplier for a stat given an equipped skill list. Each skill applies at
 * most once regardless of duplicates; unknown skills are ignored.
 */
export function skillMultiplier(skills: SkillId[] | undefined | null, id: SkillId): number {
  if (!skills || skills.length === 0) return 1;
  return skills.includes(id) ? getSkill(id).multiplier : 1;
}
