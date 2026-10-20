/**
 * Codex (gear & character gallery) data + renderer. Content is authored in
 * three languages; weapon/sub/special entries are generated from the shared
 * configs so stats always match gameplay.
 */
import {
  SPECIAL_CONFIGS,
  SUB_WEAPON_CONFIGS,
  WEAPON_CONFIGS
} from '@ink/shared';
import type { SpecialWeaponType, SubWeaponType, WeaponType } from '@ink/shared';
import { getLang, t } from '../i18n.js';

interface LocText {
  zh: string;
  ja: string;
  en: string;
}

/**
 * One stat chip under a codex card. Either an i18n key plus a raw value
 * (`"codex.dmg"` + `"35 HP"`) or fully authored per-language text. Keys are
 * resolved at render time so chips follow the active language.
 */
interface CodexTag {
  key?: string;
  text?: LocText;
  value?: string;
}

interface CodexItem {
  img: string;
  /** i18n key for the corner badge, or null when badgeText carries the label. */
  badgeKey: string | null;
  /** Per-language badge text used instead of badgeKey (weapon names). */
  badgeText?: LocText;
  badgeClass: string;
  title: LocText;
  desc: LocText;
  tags: CodexTag[];
  wide?: boolean;
}

/** Renders one stat chip, resolving its key against the active language. */
function tagLabel(tag: CodexTag): string {
  if (tag.key) return `${t(tag.key)}: ${tag.value ?? ''}`.trimEnd();
  return tag.text ? loc(tag.text) : '';
}

interface CodexTab {
  id: string;
  titleKey: string;
  items: CodexItem[];
}

function loc(l: LocText): string {
  return l[getLang()];
}

const CHARACTER_TAB: CodexTab = {
  id: 'characters',
  titleKey: 'codex.tabChars',
  items: [
    {
      img: '/assets/characters/inkling_pink.jpg',
      badgeKey: 'codex.badgePink',
      badgeClass: 'pink',
      title: { zh: '霓虹粉战队墨水战士', ja: 'ネオンピンクのインクリンガー', en: 'Pink Hero Inker' },
      desc: {
        zh: '活跃于街区涂地赛场的先锋射手，标志性的荧光洋红触手与灵巧战术步法，擅长快速压制战线与突破敌方防御。',
        ja: '街のナワバリを駆け回る先鋒シューター。蛍光ピンクの触手と機敏なフットワークで前線を制圧する。',
        en: 'Vanguard shooter of the neon streets. Iconic fluorescent-pink tentacles and nimble footwork for fast pushes.'
      },
      tags: [
        { text: { zh: '形态: 人形', ja: '形態: ヒト', en: 'Form: Humanoid' } },
        { text: { zh: '主武器: 墨水冲锋枪', ja: 'メイン: ブラスター', en: 'Main: Ink Blaster' } },
        { text: { zh: '移动力: ★★★★★', ja: '機動力: ★★★★★', en: 'Mobility: ★★★★★' } }
      ]
    },
    {
      img: '/assets/characters/inkling_cyan.jpg',
      badgeKey: 'codex.badgeCyan',
      badgeClass: 'cyan',
      title: { zh: '电光青战队墨水战士', ja: '電光シアンのインクリンガー', en: 'Cyan Hero Inker' },
      desc: {
        zh: '战术沉稳的技术型射手，头戴全包覆降噪电竞耳机与机能风连帽冲锋衣，凭借极高的预判能力在战场游刃有余。',
        ja: '冷静沈着なテクニカルシューター。ノイズキャンセリングヘッドセットとテックウェアで戦況を読む。',
        en: 'Composed technical shooter with full-cover headset and techwear hoodie, thriving on prediction.'
      },
      tags: [
        { text: { zh: '形态: 人形', ja: '形態: ヒト', en: 'Form: Humanoid' } },
        { text: { zh: '主武器: 蓄力狙击 / 冲锋枪', ja: 'メイン: スナイパー/ブラスター', en: 'Main: Charger / Blaster' } },
        { text: { zh: '专注度: ★★★★★', ja: '集中力: ★★★★★', en: 'Focus: ★★★★★' } }
      ]
    },
    {
      img: '/assets/characters/octoling_rival.jpg',
      badgeKey: null,
      badgeText: { zh: '紫晶章鱼', ja: 'オクト', en: 'Octo' },
      badgeClass: 'purple',
      title: { zh: '紫晶暗影章鱼战士', ja: 'アメジスト・オクトリング', en: 'Octoling Rival Elite' },
      desc: {
        zh: '来自地下街区的精英章鱼刺客，发端流淌着高冷神秘的紫晶荧光与发光吸盘，手持双枪双枪位移神出鬼没。',
        ja: '地下街から現れたエリートオクトリング。紫に光る触手と二丁拳銃で戦場を翻弄する。',
        en: 'Elite Octoling assassin with luminous purple suckers and dual sprayers, dominating flanks with swift rolls.'
      },
      tags: [
        { text: { zh: '形态: 章鱼人形', ja: '形態: タコヒト', en: 'Form: Octoling' } },
        { text: { zh: '主武器: 墨水双枪', ja: 'メイン: スプレイヤー', en: 'Main: Ink Sprayers' } },
        { text: { zh: '机动力: ★★★★★', ja: '機動力: ★★★★★', en: 'Mobility: ★★★★★' } }
      ]
    },
    {
      img: '/assets/characters/inkling_gold.jpg',
      badgeKey: null,
      badgeText: { zh: '炽金突击', ja: 'ゴールド', en: 'Gold' },
      badgeClass: 'gold',
      title: { zh: '炽金狂飙重滚手', ja: 'ゴールド・ストライカー', en: 'Gold Striker Inker' },
      desc: {
        zh: '充满街头活力的重型近战涂地手，身着潮流街舞队服与反戴滑板帽，挥舞重型工业压路机碾压全场。',
        ja: 'ストリートの熱血ローラー使い。特大ローラーで一気にインクの道を切り開く。',
        en: 'Energetic heavy roller specialist rocking skate streetwear and steamrolling enemy territory.'
      },
      tags: [
        { text: { zh: '形态: 人形', ja: '形態: ヒト', en: 'Form: Humanoid' } },
        { text: { zh: '主武器: 巨型滚刷', ja: 'メイン: ローラー', en: 'Main: Splat Roller' } },
        { text: { zh: '破坏力: ★★★★★', ja: '破壊力: ★★★★★', en: 'Power: ★★★★★' } }
      ]
    },
    {
      img: '/assets/characters/squid_morph.jpg',
      badgeKey: 'codex.badgeTransform',
      badgeClass: 'purple',
      title: { zh: '乌贼潜行形态', ja: 'イカ形態', en: 'Squid Morph' },
      desc: {
        zh: '墨水战士的流体变形能力。按住 Shift 潜入己方墨水，移动速度增至 1.8 倍，墨水回充速度提升 300%，并大幅降低被发现的概率。',
        ja: 'インクへの流体変形能力。Shift で味方色のインクに潜り、速度1.8倍・回復3倍で隠密行動。',
        en: 'Fluid squid transformation. Hold Shift to submerge in friendly ink: 1.8× speed, 3× refill, hard to spot.'
      },
      tags: [
        { text: { zh: '极速游动: 10.8 u/s', ja: '遊泳速度: 10.8 u/s', en: 'Swim: 10.8 u/s' } },
        { text: { zh: '墨水回充: 30%/s', ja: '回復: 30%/s', en: 'Refill: 30%/s' } },
        { text: { zh: '高度隐蔽', ja: '高い隠密性', en: 'Stealthy' } }
      ]
    },
    {
      img: '/assets/characters/inkling_duel_clash.jpg',
      badgeKey: 'codex.badgeKeyArt',
      badgeClass: 'gold',
      title: { zh: '街区锦标赛巅峰对决', ja: '選手権の頂上決戦', en: 'Championship Clash' },
      desc: {
        zh: '涂地竞技场中心立交桥上空的终极交锋，粉与青两道绚烂水炮在半空碰撞绽开漫天飞溅的彩色墨雨。',
        ja: '中央ブリッジ上空の激突。ピンクとシアンのインクが空中で交差し、虹色の雨を散らす。',
        en: 'The decisive clash above the center bridge — pink and cyan collide into a rainbow ink storm.'
      },
      tags: [
        { text: { zh: '赛场热斗', ja: '熱き戦い', en: 'Heated battle' } },
        { text: { zh: '空中对决', ja: '空中決戦', en: 'Aerial duel' } },
        { text: { zh: '4v4 终局争夺', ja: '4v4 最終決戦', en: '4v4 final push' } }
      ],
      wide: true
    }
  ]
};

function weaponItems(): CodexItem[] {
  const badges: Record<WeaponType, string> = {
    shooter: 'shooter',
    roller: 'roller',
    charger: 'charger',
    slosher: 'slosher',
    sprayer: 'sprayer',
    cannon: 'cannon',
    marksman: 'marksman',
    scatter: 'scatter'
  };
  return (Object.keys(WEAPON_CONFIGS) as WeaponType[]).map((id) => {
    const cfg = WEAPON_CONFIGS[id];
    const tags: CodexTag[] = [];
    if (cfg.chargeTime) {
      tags.push({ key: 'codex.charge', value: `${cfg.chargeTime}s` });
    }
    if (cfg.rollDamage) {
      tags.push({ key: 'codex.roll', value: `${cfg.rollDamage} HP` });
    }
    if (cfg.pelletCount && cfg.pelletCount > 1) {
      tags.push({ key: 'codex.pellets', value: `${cfg.pelletCount}` });
    }
    if (cfg.splashRadius) {
      tags.push({ key: 'codex.blast', value: `${cfg.splashRadius}m` });
    }
    return {
      img: weaponImg(id),
      badgeKey: null,
      badgeText: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      badgeClass: badges[id],
      title: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      desc: { zh: cfg.descriptionZh, ja: cfg.descriptionJa, en: cfg.description },
      tags: [
        { key: 'codex.dmg', value: `${cfg.damage} HP` },
        { key: 'codex.range', value: `${cfg.range}m` },
        { key: 'codex.rate', value: `${cfg.fireRate}/s` },
        { key: 'codex.ink', value: `${cfg.inkCost}%` },
        ...tags
      ]
    };
  });
}

/**
 * Weapon thumbnails. New weapons reuse the closest existing art so the codex
 * never renders a broken image; drop a matching jpg in to get bespoke art.
 */
function weaponImg(id: WeaponType): string {
  switch (id) {
    case 'roller':
      return '/assets/weapons/splat_roller.jpg';
    case 'charger':
      return '/assets/weapons/splat_charger.jpg';
    case 'slosher':
      return '/assets/weapons/slosher.jpg';
    case 'sprayer':
      return '/assets/weapons/sprayer.jpg';
    case 'cannon':
      return '/assets/weapons/cannon.jpg';
    case 'marksman':
      return '/assets/weapons/marksman.jpg';
    case 'scatter':
      return '/assets/weapons/scatter.jpg';
    default:
      return '/assets/weapons/splattershot.jpg';
  }
}

function subImg(id: SubWeaponType): string {
  switch (id) {
    case 'curling_bomb':
      return '/assets/weapons/curling_bomb.jpg';
    case 'burst_bomb':
      return '/assets/weapons/burst_bomb.jpg';
    case 'ink_mine':
      return '/assets/weapons/ink_mine.jpg';
    case 'bounce_bomb':
      return '/assets/weapons/bounce_bomb.jpg';
    case 'ink_puddle':
      return '/assets/weapons/ink_puddle.jpg';
    default:
      return '/assets/weapons/splat_bomb.jpg';
  }
}

function subItems(): CodexItem[] {
  return (Object.keys(SUB_WEAPON_CONFIGS) as SubWeaponType[]).map((id) => {
    const cfg = SUB_WEAPON_CONFIGS[id];
    return {
      img: subImg(id),
      badgeKey: 'codex.badgeSub',
      badgeClass: 'sub',
      title: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      desc: { zh: cfg.descriptionZh, ja: cfg.descriptionJa, en: cfg.description },
      tags: [
        { key: 'codex.dmg', value: `${cfg.damage} HP` },
        { key: 'codex.ink', value: `${cfg.inkCost}%` },
        { key: 'codex.radius', value: `${cfg.splashRadius}m` }
      ]
    };
  });
}

function specialImg(id: SpecialWeaponType): string {
  switch (id) {
    case 'killer_wail':
      return '/assets/weapons/killer_wail.jpg';
    case 'ink_storm':
      return '/assets/weapons/ink_storm.jpg';
    case 'ink_nova':
      return '/assets/weapons/ink_nova.jpg';
    case 'ink_barrier':
      return '/assets/weapons/ink_barrier.jpg';
    default:
      return '/assets/weapons/inkstrike.jpg';
  }
}

function specialItems(): CodexItem[] {
  return (Object.keys(SPECIAL_CONFIGS) as SpecialWeaponType[]).map((id) => {
    const cfg = SPECIAL_CONFIGS[id];
    return {
      img: specialImg(id),
      badgeKey: 'codex.badgeSpecial',
      badgeClass: 'special',
      title: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      desc: { zh: cfg.descriptionZh, ja: cfg.descriptionJa, en: cfg.description },
      tags: [
        { key: 'codex.dps', value: `${cfg.dps}` },
        { key: 'codex.duration', value: `${cfg.duration}s` },
        { key: 'codex.radius', value: `${cfg.radius}m` }
      ]
    };
  });
}

const GEAR_TAB: CodexTab = {
  id: 'gear',
  titleKey: 'codex.tabGear',
  items: [
    {
      img: '/assets/gear/ink_tank.jpg',
      badgeKey: 'codex.badgeBackpack',
      badgeClass: 'gear',
      title: { zh: '高容量发光墨汁背罐', ja: '大容量インクタンク', en: 'High-Capacity Ink Tank' },
      desc: {
        zh: '墨水战士出战的生命线。加固防爆树脂玻璃筒身与黄铜减压阀，实时显示 0-10 刻度墨量，配有快速解脱战术背带。',
        ja: 'インクリンガーの生命線。強化ガラスタンクと真鍮バルブ、クイックリリースハーネスを装備。',
        en: 'The lifeline of every inker. Reinforced glass tank, brass relief valve and quick-release harness.'
      },
      tags: [
        { text: { zh: '容积: 100 单位', ja: '容量: 100', en: 'Capacity: 100 units' } },
        { text: { zh: '防爆抗压', ja: '防爆設計', en: 'Blast-safe' } },
        { text: { zh: '战术快拆', ja: 'クイック解除', en: 'Quick release' } }
      ]
    },
    {
      img: '/assets/gear/headset_visor.jpg',
      badgeKey: 'codex.badgeHeadgear',
      badgeClass: 'gear',
      title: { zh: '潮流降噪耳机与战术目镜', ja: 'ヘッドセット&バイザー', en: 'Studio Headset & Visor' },
      desc: {
        zh: '融合街头嘻哈与电竞赛事的高性能穿戴装备。耳罩带荧光乌贼徽标，集成全息 HUD 微显镜片，实时反馈墨迹分布。',
        ja: 'ストリートとeスポーツの融合。ホロHUDバイザーでインク状況をリアルタイム表示。',
        en: 'Street-culture headset with a holo-HUD visor overlaying live ink coverage.'
      },
      tags: [
        { text: { zh: '全息 HUD 准心', ja: 'ホロHUD照準', en: 'Holo-HUD reticle' } },
        { text: { zh: '主动降噪', ja: 'アクティブノイズキャン', en: 'Active noise-cancel' } },
        { text: { zh: '潮流徽标', ja: 'スクイッドロゴ', en: 'Squid logo' } }
      ]
    },
    {
      img: '/assets/gear/street_sneakers.jpg',
      badgeKey: 'codex.badgeFootwear',
      badgeClass: 'gear',
      title: { zh: '撞色高帮气垫滑板鞋', ja: 'ネオンスケートスニーカー', en: 'Neon Turf Skate Sneakers' },
      desc: {
        zh: '专为墨水滑行与高台跳跃设计的潮流运动鞋。双色撞色鞋身，全掌注入流动墨汁的避震气囊与高防滑纹路。',
        ja: 'イカスライド用に設計されたスニーカー。インクエアソールとグリップソール装備。',
        en: 'Sneakers tuned for ink slides: two-tone leather, ink-filled air cushion and sticky grip soles.'
      },
      tags: [
        { text: { zh: '流动墨汁气垫', ja: 'インクエア', en: 'Ink air cushion' } },
        { text: { zh: '高抓地力鞋底', ja: '高グリップ', en: 'High-grip sole' } },
        { text: { zh: '撞色设计', ja: 'ツートンカラー', en: 'Two-tone' } }
      ]
    },
    {
      img: '/assets/gear/tactical_helmet.jpg',
      badgeKey: null,
      badgeText: { zh: '战术飞行头盔', ja: 'タクティカルヘルメット', en: 'Pilot Helmet' },
      badgeClass: 'gear',
      title: { zh: '机能飞行员战术全盔', ja: 'パイロットタクティカルヘルメット', en: 'Tactical Pilot Helmet' },
      desc: {
        zh: '高强度防溅墨防爆头盔，配备炫彩镀膜全景护目镜与战术语音天线，全方位保障高烈度对抗中的视野与通讯。',
        ja: '防爆仕様のタクティカルヘルメット。ミラーシールドとインカムで視界と通信を確保。',
        en: 'High-impact pilot helmet featuring iridescent tinted visor, integrated headset, and ink splash resistance.'
      },
      tags: [
        { text: { zh: '炫彩护目防溅', ja: '防爆シールド', en: 'Iridescent Visor' } },
        { text: { zh: '战术语音天线', ja: 'インカム内蔵', en: 'Comms Antenna' } },
        { text: { zh: '头部防护 ★★★★★', ja: '防御: ★★★★★', en: 'Armor: ★★★★★' } }
      ]
    },
    {
      img: '/assets/gear/techwear_hoodie.jpg',
      badgeKey: null,
      badgeText: { zh: '机能冲锋衣', ja: 'テックウェア', en: 'Techwear' },
      badgeClass: 'gear',
      title: { zh: '都市机能反光连帽冲锋衣', ja: 'アーバンテックウェアジャケット', en: 'Urban Techwear Windbreaker' },
      desc: {
        zh: '街头潮流与特勤作战的终极结合。疏水纳米织物外壳，荧光青色战术背带扣环与多重防水快拆外挂弹药袋。',
        ja: '防水ナノ素材のハイテクジャケット。蛍光シアンのストラップと大容量ポケットを搭載。',
        en: 'Water-repellent techwear windbreaker with fluorescent cyan webbing straps and quick-access utility pouches.'
      },
      tags: [
        { text: { zh: '纳米疏水防墨', ja: 'ナノ撥水', en: 'Hydrophobic' } },
        { text: { zh: '战术外挂扩容', ja: '拡張ポーチ', en: 'Modular Pouches' } },
        { text: { zh: '机动轻便', ja: '軽量設計', en: 'Lightweight' } }
      ]
    },
    {
      img: '/assets/gear/combat_boots.jpg',
      badgeKey: null,
      badgeText: { zh: '重装战靴', ja: 'コンバットブーツ', en: 'Boots' },
      badgeClass: 'gear',
      title: { zh: '重型工业超抓地战斗靴', ja: 'ヘビーインダストリアルブーツ', en: 'Heavy Turf Combat Boots' },
      desc: {
        zh: '针对深层泥泞墨汁环境特制的重装高帮战靴。加厚防滑锯齿钢底与荧光亮黄鞋带，在敌方墨迹中也能保持坚实站姿。',
        ja: '深層インクでも滑らない超高グリップブーツ。厚底スチールソールとネオンイエローの紐。',
        en: 'Heavy-tread steel-reinforced industrial boots designed for absolute traction even on enemy ink.'
      },
      tags: [
        { text: { zh: '钢纹超强抓地', ja: '高グリップ鋼底', en: 'Ultra-Grip Steel' } },
        { text: { zh: '深墨抗性提升', ja: 'インク耐性', en: 'Ink Resistance' } },
        { text: { zh: '工业防护', ja: '重装甲', en: 'Industrial Grade' } }
      ]
    },
    {
      img: '/assets/gear/tactical_vest.jpg',
      badgeKey: null,
      badgeText: { zh: '战术背心', ja: 'タクティカルベスト', en: 'Armor Vest' },
      badgeClass: 'gear',
      title: { zh: '极速复活战术外骨骼背心', ja: 'クイックリスポーンアーマーベスト', en: 'Quick-Respawn Armor Rig' },
      desc: {
        zh: '搭载应急墨水储备电芯的高规格防护背心。配备双联副武器炸药快拔槽与电量实时状态屏，关键时刻快速重返战场。',
        ja: 'サブウェポンホルダーと残量ゲージを備えた防護ベスト。リスポーン短縮を支援。',
        en: 'Tactical chest rig with dual bomb holsters, glowing battery status gauge, and accelerated respawn matrix.'
      },
      tags: [
        { text: { zh: '双联副武器挂载', ja: 'サブ2本差し', en: 'Dual Sub Holsters' } },
        { text: { zh: '电量状态监控', ja: '残量モニター', en: 'Power Status' } },
        { text: { zh: '快速整备', ja: 'クイック準備', en: 'Quick Ready' } }
      ]
    }
  ]
};

const SCENERY_TAB: CodexTab = {
  id: 'scenery',
  titleKey: 'codex.tabScenery',
  items: [
    {
      img: '/assets/backgrounds/arena_downtown.jpg',
      badgeKey: null,
      badgeText: { zh: '霓虹都会', ja: 'ネオン街', en: 'Downtown' },
      badgeClass: 'scene',
      title: { zh: '霓虹天台立体商业街区', ja: 'ネオン・ダウンタウン', en: 'Neon Downtown Arena' },
      desc: {
        zh: '摩天大厦环绕的赛博都会中心立体竞技场。全息巨型乌贼广告牌与穿行立交平台，高低错落的纵向立体对战圣地。',
        ja: '高層ビルに囲まれたサイバーパンクステージ。巨大ホロ看板と立体交差が生む縦横の駆け引き。',
        en: 'Multi-tier cybernetic metropolis rooftop arena framed by towering holographic squid displays and tiered combat ramps.'
      },
      tags: [
        { text: { zh: '规格: 145m × 145m', ja: 'サイズ: 145m', en: 'Size: 145m' } },
        { text: { zh: '立体高低跳台', ja: '立体高低差', en: 'Multi-tier Vert' } },
        { text: { zh: '赛博霓虹夜景', ja: 'サイバー夜景', en: 'Cyberpunk Night' } }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/arena_cargo_docks.jpg',
      badgeKey: 'codex.badgeBattleground',
      badgeClass: 'scene',
      title: { zh: '海港集装箱枢纽赛场', ja: '貨物ドック・アリーナ', en: 'Cargo Docks Arena' },
      desc: {
        zh: '建于海港集装箱枢纽的专业涂地赛场。多层钢制集装箱群与滑板弧形坡道构成极具层次感的战术对抗空间。',
        ja: '港湾コンテナターミナルに作られた大会用ステージ。多層コンテナとランプが立体戦術を生む。',
        en: 'Pro turf stage built in a harbor container hub — stacked steel boxes and ramps create layered fights.'
      },
      tags: [
        { text: { zh: '规格: 185m × 185m', ja: 'サイズ: 185m', en: 'Size: 185m' } },
        { text: { zh: '地形: 集装箱 & 坡道', ja: '地形: コンテナ+ランプ', en: 'Terrain: containers & ramps' } },
        { text: { zh: '夕阳黄金海港', ja: '夕暮れ海港', en: 'Sunset Harbor' } }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/arena_sky_rink.jpg',
      badgeKey: null,
      badgeText: { zh: '云端滑冰场', ja: 'スカイリンク', en: 'Sky Rink' },
      badgeClass: 'scene',
      title: { zh: '云端浮空冰原竞技场', ja: 'スカイリンク・アリーナ', en: 'Sky Rink Arena' },
      desc: {
        zh: '万米云海之上的悬浮透光玻璃竞技台。光滑冰面环道与高空全景透明栈桥，热气球与轻柔白云环抱下的极速滑行战场。',
        ja: '雲海の上に浮かぶガラスのアリーナ。滑らかな氷面と透明デッキで高速バトルが展開。',
        en: 'Floating glass arena suspended above endless white clouds, featuring icy slick ramps and panoramic suspension bridges.'
      },
      tags: [
        { text: { zh: '规格: 130m × 130m', ja: 'サイズ: 130m', en: 'Size: 130m' } },
        { text: { zh: '浮空透明栈桥', ja: '浮遊ガラスデッキ', en: 'Suspended Glass' } },
        { text: { zh: '壮阔云海日光', ja: '壮大な雲海', en: 'Sea of Clouds' } }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/arena_aurora_outpost.jpg',
      badgeKey: null,
      badgeText: { zh: '极光前哨', ja: 'オーロラ基地', en: 'Aurora Outpost' },
      badgeClass: 'scene',
      title: { zh: '极地极昼极光科考站', ja: 'オーロラ・アウトポスト', en: 'Aurora Outpost' },
      desc: {
        zh: '极地冰原上的科研穹顶要塞。舞动在夜空中的翠绿与紫罗兰极光，与白雪上飞溅的炽热墨水构成鲜明的视觉冲击。',
        ja: '極寒の氷原に建てられた基地。夜空に舞うオーロラと雪上のカラフルなインクが織りなす幻想的な戦場。',
        en: 'Polar scientific outpost under dancing emerald and violet auroras, snowfields splashed with vibrant warm ink.'
      },
      tags: [
        { text: { zh: '规格: 160m × 160m', ja: 'サイズ: 160m', en: 'Size: 160m' } },
        { text: { zh: '极光星空天顶', ja: 'オーロラ星空', en: 'Aurora Borealis' } },
        { text: { zh: '极地科考穹顶', ja: '雪原ドーム', en: 'Arctic Domes' } }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/lobby_plaza.jpg',
      badgeKey: 'codex.badgeLobby',
      badgeClass: 'scene',
      title: { zh: '赛区更衣室与地下街区', ja: 'ロビープラザ', en: 'Underground Locker Plaza' },
      desc: {
        zh: '赛前选手整装待发的大本营。金属储物柜、涂鸦砖墙与霓虹灯牌交相辉映，大型 LED 荧幕轮播排位积分榜。',
        ja: '選手の控室。ロッカー、グラフィティ、ネオンサイン、ランキングビジョン。',
        en: 'Pre-match hub: metal lockers, graffiti walls, neon signs and a live ladder leaderboard.'
      },
      tags: [
        { text: { zh: '街区潮流文化', ja: 'ストリート文化', en: 'Street culture' } },
        { text: { zh: '战队整备中心', ja: 'チーム準備エリア', en: 'Team prep center' } },
        { text: { zh: '天梯积分展板', ja: 'ランキング表示', en: 'Ladder board' } }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/victory_stage.jpg',
      badgeKey: 'codex.badgeVictory',
      badgeClass: 'scene',
      title: { zh: '全球锦标赛冠军颁奖舞台', ja: '世界選手権の表彰舞台', en: 'Victory Tournament Stage' },
      desc: {
        zh: '终场哨声响起时的最高荣誉圣殿。金色碎屑与彩色墨水礼花漫天飞舞，射灯与欢呼的观众见证获胜战队举杯。',
        ja: '優勝チームの栄光の舞台。金紙とインク花火、歓声の中でトロフィーを掲げる。',
        en: 'Where champions lift the trophy under golden confetti and ink fireworks.'
      },
      tags: [
        { text: { zh: '冠军领奖台', ja: '優勝セレモニー', en: 'Champion podium' } },
        { text: { zh: '全息彩花礼炮', ja: 'ホロ花火', en: 'Holo fireworks' } },
        { text: { zh: '万众欢呼盛典', ja: '大歓声', en: 'Roaring crowd' } }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/defeat_stage.jpg',
      badgeKey: null,
      badgeText: { zh: '赛后竞技场', ja: '黄昏アリーナ', en: 'Dusk Arena' },
      badgeClass: 'scene',
      title: { zh: '暮色微光赛后沉思竞技场', ja: 'トワイライト・バトルグラウンド', en: 'Twilight Aftermath Arena' },
      desc: {
        zh: '激烈战斗尘埃落定后的宁静竞技场。探照灯在湿润的积水彩墨中投射出倒影，微风与星光陪伴着等待下一场对决的勇士。',
        ja: '激戦の後の静寂。濡れたインクの水たまりにスタジアムの照明と夜空の月が映る。',
        en: 'Quiet aftermath of a fierce clash under stadium lights and starlight, wet paint puddles mirroring neon skylines.'
      },
      tags: [
        { text: { zh: '赛后暮光全景', ja: '黄昏の情景', en: 'Twilight Vista' } },
        { text: { zh: '倒影墨渍水光', ja: '反射インク', en: 'Reflective Ink' } },
        { text: { zh: '静待再战', ja: '再戦の誓い', en: 'Ready to Rematch' } }
      ],
      wide: true
    }
  ]
};

export const CODEX_TABS: CodexTab[] = [
  CHARACTER_TAB,
  { id: 'weapons', titleKey: 'codex.tabWeapons', items: weaponItems() },
  { id: 'subs-specials', titleKey: 'codex.tabSubs', items: [...subItems(), ...specialItems()] },
  GEAR_TAB,
  SCENERY_TAB
];

/**
 * (Re)renders the codex modal body. Called on open and on language change.
 */
export function renderCodex(): void {
  const body = document.getElementById('codex-body');
  const nav = document.querySelector('.codex-nav');
  if (!body || !nav) return;

  const activeTab = (body.querySelector('.codex-pane.active') as HTMLElement | null)?.id ?? 'codex-tab-characters';
  const activeBtn = nav.querySelector('.codex-tab-btn.active')?.textContent ?? null;

  nav.innerHTML = '';
  body.innerHTML = '';

  for (const tab of CODEX_TABS) {
    const btn = document.createElement('button');
    btn.className = 'codex-tab-btn';
    btn.setAttribute('data-tab', tab.id);
    btn.textContent = t(tab.titleKey);
    nav.appendChild(btn);

    const pane = document.createElement('div');
    pane.className = 'codex-pane';
    pane.id = `codex-tab-${tab.id}`;
    if (`codex-tab-${tab.id}` === activeTab) pane.classList.add('active');

    const grid = document.createElement('div');
    grid.className = 'codex-grid';
    for (const item of tab.items) {
      const el = document.createElement('div');
      el.className = item.wide ? 'codex-item wide-card' : 'codex-item';
      el.setAttribute('data-full', item.img);

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'codex-thumb-wrap';
      const img = document.createElement('img');
      img.src = item.img;
      img.alt = loc(item.title);
      const badge = document.createElement('span');
      badge.className = `codex-badge ${item.badgeClass}`;
      // Badges are authored as i18n keys; weapon cards instead carry the
      // localized weapon name (upper-cased only where that reads naturally).
      badge.textContent = item.badgeKey
        ? t(item.badgeKey)
        : item.badgeText
          ? loc(item.badgeText).toUpperCase()
          : '';
      thumbWrap.appendChild(img);
      thumbWrap.appendChild(badge);

      const info = document.createElement('div');
      info.className = 'codex-info';
      const h4 = document.createElement('h4');
      h4.textContent = loc(item.title);
      const p = document.createElement('p');
      p.className = 'codex-desc';
      p.textContent = loc(item.desc);
      const tags = document.createElement('div');
      tags.className = 'codex-tags';
      for (const tag of item.tags) {
        const span = document.createElement('span');
        span.textContent = tagLabel(tag);
        tags.appendChild(span);
      }
      info.appendChild(h4);
      info.appendChild(p);
      info.appendChild(tags);

      el.appendChild(thumbWrap);
      el.appendChild(info);
      grid.appendChild(el);
    }
    pane.appendChild(grid);
    body.appendChild(pane);
  }

  // Restore previous selection by tab id
  const prevId = activeTab.replace('codex-tab-', '');
  const btns = nav.querySelectorAll('.codex-tab-btn');
  btns.forEach((b) => {
    if (b.getAttribute('data-tab') === prevId) b.classList.add('active');
  });

  void activeBtn;
}
