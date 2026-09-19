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

interface CodexItem {
  img: string;
  badge: string;
  badgeClass: string;
  title: LocText;
  desc: LocText;
  tags: LocText[];
  wide?: boolean;
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
      badge: 'TEAM PINK',
      badgeClass: 'pink',
      title: { zh: '霓虹粉战队墨水战士', ja: 'ネオンピンクのインクリンガー', en: 'Pink Hero Inker' },
      desc: {
        zh: '活跃于街区涂地赛场的先锋射手，标志性的荧光洋红触手与灵巧战术步法，擅长快速压制战线与突破敌方防御。',
        ja: '街のナワバリを駆け回る先鋒シューター。蛍光ピンクの触手と機敏なフットワークで前線を制圧する。',
        en: 'Vanguard shooter of the neon streets. Iconic fluorescent-pink tentacles and nimble footwork for fast pushes.'
      },
      tags: [
        { zh: '形态: 人形', ja: '形態: ヒト', en: 'Form: Humanoid' },
        { zh: '主武器: 墨水冲锋枪', ja: 'メイン: ブラスター', en: 'Main: Ink Blaster' },
        { zh: '移动力: ★★★★★', ja: '機動力: ★★★★★', en: 'Mobility: ★★★★★' }
      ]
    },
    {
      img: '/assets/characters/inkling_cyan.jpg',
      badge: 'TEAM CYAN',
      badgeClass: 'cyan',
      title: { zh: '电光青战队墨水战士', ja: '電光シアンのインクリンガー', en: 'Cyan Hero Inker' },
      desc: {
        zh: '战术沉稳的技术型射手，头戴全包覆降噪电竞耳机与机能风连帽冲锋衣，凭借极高的预判能力在战场游刃有余。',
        ja: '冷静沈着なテクニカルシューター。ノイズキャンセリングヘッドセットとテックウェアで戦況を読む。',
        en: 'Composed technical shooter with full-cover headset and techwear hoodie, thriving on prediction.'
      },
      tags: [
        { zh: '形态: 人形', ja: '形態: ヒト', en: 'Form: Humanoid' },
        { zh: '主武器: 蓄力狙击 / 冲锋枪', ja: 'メイン: スナイパー/ブラスター', en: 'Main: Charger / Blaster' },
        { zh: '专注度: ★★★★★', ja: '集中力: ★★★★★', en: 'Focus: ★★★★★' }
      ]
    },
    {
      img: '/assets/characters/squid_morph.jpg',
      badge: 'TRANSFORMATION',
      badgeClass: 'purple',
      title: { zh: '乌贼潜行形态', ja: 'イカ形態', en: 'Squid Morph' },
      desc: {
        zh: '墨水战士的流体变形能力。按住 Shift 潜入己方墨水，移动速度增至 1.8 倍，墨水回充速度提升 300%，并大幅降低被发现的概率。',
        ja: 'インクへの流体変形能力。Shift で味方色のインクに潜り、速度1.8倍・回復3倍で隠密行動。',
        en: 'Fluid squid transformation. Hold Shift to submerge in friendly ink: 1.8× speed, 3× refill, hard to spot.'
      },
      tags: [
        { zh: '极速游动: 10.8 u/s', ja: '遊泳速度: 10.8 u/s', en: 'Swim: 10.8 u/s' },
        { zh: '墨水回充: 30%/s', ja: '回復: 30%/s', en: 'Refill: 30%/s' },
        { zh: '高度隐蔽', ja: '高い隠密性', en: 'Stealthy' }
      ]
    },
    {
      img: '/assets/characters/inkling_duel_clash.jpg',
      badge: 'KEY ART',
      badgeClass: 'gold',
      title: { zh: '街区锦标赛巅峰对决', ja: '選手権の頂上決戦', en: 'Championship Clash' },
      desc: {
        zh: '涂地竞技场中心立交桥上空的终极交锋，粉与青两道绚烂水炮在半空碰撞绽开漫天飞溅的彩色墨雨。',
        ja: '中央ブリッジ上空の激突。ピンクとシアンのインクが空中で交差し、虹色の雨を散らす。',
        en: 'The decisive clash above the center bridge — pink and cyan collide into a rainbow ink storm.'
      },
      tags: [
        { zh: '赛场热斗', ja: '熱き戦い', en: 'Heated battle' },
        { zh: '空中对决', ja: '空中決戦', en: 'Aerial duel' },
        { zh: '4v4 终局争夺', ja: '4v4 最終決戦', en: '4v4 final push' }
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
    slosher: 'slosher'
  };
  return (Object.keys(WEAPON_CONFIGS) as WeaponType[]).map((id) => {
    const cfg = WEAPON_CONFIGS[id];
    const tags: LocText[] = [];
    if (id === 'charger' && cfg.chargeTime) {
      tags.push({ zh: `蓄力: ${cfg.chargeTime}s`, ja: `チャージ: ${cfg.chargeTime}s`, en: `Charge: ${cfg.chargeTime}s` });
    }
    if (id === 'roller' && cfg.rollDamage) {
      tags.push({ zh: `碾压: ${cfg.rollDamage} HP`, ja: `転圧: ${cfg.rollDamage} HP`, en: `Roll: ${cfg.rollDamage} HP` });
    }
    return {
      img: weaponImg(id),
      badge: cfg.name.toUpperCase(),
      badgeClass: badges[id],
      title: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      desc: { zh: cfg.descriptionZh, ja: cfg.descriptionJa, en: cfg.description },
      tags: [
        {
          zh: `${t('codex.dmg')}: ${cfg.damage} HP`,
          ja: `${t('codex.dmg')}: ${cfg.damage} HP`,
          en: `${t('codex.dmg')}: ${cfg.damage} HP`
        },
        {
          zh: `${t('codex.range')}: ${cfg.range}m`,
          ja: `${t('codex.range')}: ${cfg.range}m`,
          en: `${t('codex.range')}: ${cfg.range}m`
        },
        {
          zh: `${t('codex.ink')}: ${cfg.inkCost}%`,
          ja: `${t('codex.ink')}: ${cfg.inkCost}%`,
          en: `${t('codex.ink')}: ${cfg.inkCost}%`
        },
        ...tags
      ]
    };
  });
}

function weaponImg(id: WeaponType): string {
  switch (id) {
    case 'roller':
      return '/assets/weapons/splat_roller.jpg';
    case 'charger':
      return '/assets/weapons/splat_charger.jpg';
    case 'slosher':
      return '/assets/weapons/slosher.jpg';
    default:
      return '/assets/weapons/splattershot.jpg';
  }
}

function subImg(id: SubWeaponType): string {
  switch (id) {
    case 'curling_bomb':
      return '/assets/weapons/curling_bomb.jpg';
    case 'burst_bomb':
      return '/assets/weapons/splat_bomb.jpg';
    default:
      return '/assets/weapons/splat_bomb.jpg';
  }
}

function subItems(): CodexItem[] {
  return (Object.keys(SUB_WEAPON_CONFIGS) as SubWeaponType[]).map((id) => {
    const cfg = SUB_WEAPON_CONFIGS[id];
    return {
      img: subImg(id),
      badge: 'SUB WEAPON',
      badgeClass: 'sub',
      title: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      desc: { zh: cfg.descriptionZh, ja: cfg.descriptionJa, en: cfg.description },
      tags: [
        { zh: `${t('codex.dmg')}: ${cfg.damage} HP`, ja: `${t('codex.dmg')}: ${cfg.damage} HP`, en: `${t('codex.dmg')}: ${cfg.damage} HP` },
        { zh: `${t('codex.ink')}: ${cfg.inkCost}%`, ja: `${t('codex.ink')}: ${cfg.inkCost}%`, en: `${t('codex.ink')}: ${cfg.inkCost}%` },
        { zh: `${t('codex.radius')}: ${cfg.splashRadius}m`, ja: `${t('codex.radius')}: ${cfg.splashRadius}m`, en: `${t('codex.radius')}: ${cfg.splashRadius}m` }
      ]
    };
  });
}

function specialImg(id: SpecialWeaponType): string {
  switch (id) {
    case 'killer_wail':
      return '/assets/weapons/killer_wail.jpg';
    case 'ink_storm':
      return '/assets/weapons/inkstrike.jpg';
    default:
      return '/assets/weapons/inkstrike.jpg';
  }
}

function specialItems(): CodexItem[] {
  return (Object.keys(SPECIAL_CONFIGS) as SpecialWeaponType[]).map((id) => {
    const cfg = SPECIAL_CONFIGS[id];
    return {
      img: specialImg(id),
      badge: 'SPECIAL ULTIMATE',
      badgeClass: 'special',
      title: { zh: cfg.nameZh, ja: cfg.nameJa, en: cfg.name },
      desc: { zh: cfg.descriptionZh, ja: cfg.descriptionJa, en: cfg.description },
      tags: [
        { zh: `${t('codex.dps')}: ${cfg.dps}`, ja: `${t('codex.dps')}: ${cfg.dps}`, en: `${t('codex.dps')}: ${cfg.dps}` },
        { zh: `${t('codex.duration')}: ${cfg.duration}s`, ja: `${t('codex.duration')}: ${cfg.duration}s`, en: `${t('codex.duration')}: ${cfg.duration}s` },
        { zh: `${t('codex.radius')}: ${cfg.radius}m`, ja: `${t('codex.radius')}: ${cfg.radius}m`, en: `${t('codex.radius')}: ${cfg.radius}m` }
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
      badge: 'BACKPACK',
      badgeClass: 'gear',
      title: { zh: '高容量发光墨汁背罐', ja: '大容量インクタンク', en: 'High-Capacity Ink Tank' },
      desc: {
        zh: '墨水战士出战的生命线。加固防爆树脂玻璃筒身与黄铜减压阀，实时显示 0-10 刻度墨量，配有快速解脱战术背带。',
        ja: 'インクリンガーの生命線。強化ガラスタンクと真鍮バルブ、クイックリリースハーネスを装備。',
        en: 'The lifeline of every inker. Reinforced glass tank, brass relief valve and quick-release harness.'
      },
      tags: [
        { zh: '容积: 100 单位', ja: '容量: 100', en: 'Capacity: 100 units' },
        { zh: '防爆抗压', ja: '防爆設計', en: 'Blast-safe' },
        { zh: '战术快拆', ja: 'クイック解除', en: 'Quick release' }
      ]
    },
    {
      img: '/assets/gear/headset_visor.jpg',
      badge: 'HEADGEAR',
      badgeClass: 'gear',
      title: { zh: '潮流降噪耳机与战术目镜', ja: 'ヘッドセット&バイザー', en: 'Studio Headset & Visor' },
      desc: {
        zh: '融合街头嘻哈与电竞赛事的高性能穿戴装备。耳罩带荧光乌贼徽标，集成全息 HUD 微显镜片，实时反馈墨迹分布。',
        ja: 'ストリートとeスポーツの融合。ホロHUDバイザーでインク状況をリアルタイム表示。',
        en: 'Street-culture headset with a holo-HUD visor overlaying live ink coverage.'
      },
      tags: [
        { zh: '全息 HUD 准心', ja: 'ホロHUD照準', en: 'Holo-HUD reticle' },
        { zh: '主动降噪', ja: 'アクティブノイズキャン', en: 'Active noise-cancel' },
        { zh: '潮流徽标', ja: 'スクイッドロゴ', en: 'Squid logo' }
      ]
    },
    {
      img: '/assets/gear/street_sneakers.jpg',
      badge: 'FOOTWEAR',
      badgeClass: 'gear',
      title: { zh: '撞色高帮气垫滑板鞋', ja: 'ネオンスケートスニーカー', en: 'Neon Turf Skate Sneakers' },
      desc: {
        zh: '专为墨水滑行与高台跳跃设计的潮流运动鞋。双色撞色鞋身，全掌注入流动墨汁的避震气囊与高防滑纹路。',
        ja: 'イカスライド用に設計されたスニーカー。インクエアソールとグリップソール装備。',
        en: 'Sneakers tuned for ink slides: two-tone leather, ink-filled air cushion and sticky grip soles.'
      },
      tags: [
        { zh: '流动墨汁气垫', ja: 'インクエア', en: 'Ink air cushion' },
        { zh: '高抓地力鞋底', ja: '高グリップ', en: 'High-grip sole' },
        { zh: '撞色设计', ja: 'ツートンカラー', en: 'Two-tone' }
      ]
    }
  ]
};

const SCENERY_TAB: CodexTab = {
  id: 'scenery',
  titleKey: 'codex.tabScenery',
  items: [
    {
      img: '/assets/backgrounds/arena_battlefield.jpg',
      badge: 'BATTLEGROUND',
      badgeClass: 'scene',
      title: { zh: '码头货柜涂地竞技场', ja: '貨物ドック・アリーナ', en: 'Cargo Docks Arena' },
      desc: {
        zh: '建于海港集装箱枢纽的专业涂地赛场。多层钢制集装箱群与滑板弧形坡道构成极具层次感的战术对抗空间。',
        ja: '港湾コンテナターミナルに作られた大会用ステージ。多層コンテナとランプが立体戦術を生む。',
        en: 'Pro turf stage built in a harbor container hub — stacked steel boxes and ramps create layered fights.'
      },
      tags: [
        { zh: '规格: 124m × 124m', ja: 'サイズ: 124m', en: 'Size: 124m × 124m' },
        { zh: '地形: 集装箱 & 坡道', ja: '地形: コンテナ+ランプ', en: 'Terrain: containers & ramps' },
        { zh: '黄昏氛围', ja: '夕暮れ', en: 'Sunset vibe' }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/lobby_plaza.jpg',
      badge: 'LOBBY PLAZA',
      badgeClass: 'scene',
      title: { zh: '赛区更衣室与地下街区', ja: 'ロビープラザ', en: 'Underground Locker Plaza' },
      desc: {
        zh: '赛前选手整装待发的大本营。金属储物柜、涂鸦砖墙与霓虹灯牌交相辉映，大型 LED 荧幕轮播排位积分榜。',
        ja: '選手の控室。ロッカー、グラフィティ、ネオンサイン、ランキングビジョン。',
        en: 'Pre-match hub: metal lockers, graffiti walls, neon signs and a live ladder leaderboard.'
      },
      tags: [
        { zh: '街区潮流文化', ja: 'ストリート文化', en: 'Street culture' },
        { zh: '战队整备中心', ja: 'チーム準備エリア', en: 'Team prep center' },
        { zh: '天梯积分展板', ja: 'ランキング表示', en: 'Ladder board' }
      ],
      wide: true
    },
    {
      img: '/assets/backgrounds/victory_stage.jpg',
      badge: 'VICTORY STAGE',
      badgeClass: 'scene',
      title: { zh: '全球锦标赛冠军颁奖舞台', ja: '世界選手権の表彰舞台', en: 'Victory Tournament Stage' },
      desc: {
        zh: '终场哨声响起时的最高荣誉圣殿。金色碎屑与彩色墨水礼花漫天飞舞，射灯与欢呼的观众见证获胜战队举杯。',
        ja: '優勝チームの栄光の舞台。金紙とインク花火、歓声の中でトロフィーを掲げる。',
        en: 'Where champions lift the trophy under golden confetti and ink fireworks.'
      },
      tags: [
        { zh: '冠军领奖台', ja: '優勝セレモニー', en: 'Champion podium' },
        { zh: '全息彩花礼炮', ja: 'ホロ花火', en: 'Holo fireworks' },
        { zh: '万众欢呼盛典', ja: '大歓声', en: 'Roaring crowd' }
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
      badge.textContent = item.badge;
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
        span.textContent = loc(tag);
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
