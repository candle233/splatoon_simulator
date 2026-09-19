/**
 * Lightweight i18n for the client UI. Three languages: 简体中文 / 日本語 / English.
 *
 * - Static HTML nodes carry `data-i18n="key"` (textContent),
 *   `data-i18n-placeholder` or `data-i18n-title` attributes and are filled by
 *   applyI18n() whenever the language changes.
 * - Dynamic strings call t(key, params) with {name} interpolation.
 * - Shared gameplay configs (weapons / subs / specials / modes / maps /
 *   skills) carry their own per-language fields; locName()/locDesc() pick the
 *   right one.
 */
import type { SkillStats, WeaponStats, SubWeaponStats, SpecialStats, GameModeStats, MapDef } from '@ink/shared';

export type Lang = 'zh' | 'ja' | 'en';

export const LANGS: Lang[] = ['zh', 'ja', 'en'];

const LANG_LABEL: Record<Lang, string> = {
  zh: '中文',
  ja: '日本語',
  en: 'English'
};

const zh: Record<string, string> = {
  'title.tagline': '3D 多人涂地大乱斗',
  'title.play': '进入大厅',
  'title.codex': '装备图鉴',
  'title.settings': '游戏设置',
  'title.credits': '纯浏览器 WebGL · 实时联机对战',

  'lobby.badge': '涂地大战·对战大厅',
  'lobby.name': '玩家昵称',
  'lobby.namePlaceholder': '输入你的名字',
  'lobby.selectWeapon': '选择主武器',
  'lobby.team': '队伍分配',
  'lobby.auto': '自动平衡',
  'lobby.pink': '粉红队',
  'lobby.cyan': '青色队',
  'lobby.players': '已连接玩家',
  'lobby.matchIn': '比赛 {s} 秒后开始…',
  'lobby.ready': '准备!',
  'lobby.cancelReady': '取消准备',
  'lobby.start': '立即开始比赛',
  'lobby.return': '返回大厅',
  'lobby.ctrlMove': '移动',
  'lobby.ctrlFire': '开火 / 碾压',
  'lobby.ctrlSub': '副武器炸弹',
  'lobby.ctrlSpecial': '大招释放',
  'lobby.ctrlSwim': '潜入墨水游动',
  'lobby.skills': '选择技能（最多 3 个）',
  'lobby.skillsHint': '技能为被动加成，会在比赛中全程生效',
  'lobby.mode': '比赛模式',
  'lobby.map': '比赛地图',
  'lobby.bots': '机器人',
  'lobby.addBot': '＋ 添加机器人',
  'lobby.removeBot': '－ 移除机器人',
  'lobby.hostOnly': '仅房主可操作',
  'lobby.you': '（你）',
  'lobby.codexBtn': '装备与角色图鉴',
  'lobby.avatarUpload': '点击上传头像',
  'lobby.avatarTooBig': '图片过大，请选择小于 5MB 的图片',
  'lobby.subBadge': '副武器',
  'lobby.specialBadge': '大招',
  'lobby.skillCount': '已选 {n}/3',
  'lobby.waiting': '等待中',
  'lobby.readyBadge': '已准备',
  'lobby.hostBadge': '房主',
  'lobby.botBadge': '机器人',

  'hud.hp': '生命',
  'hud.inkTank': '墨水槽',
  'hud.specialMeter': '大招充能',
  'hud.specialReady': '[E] 大招就绪!',
  'hud.shiftHint': '按住 SHIFT 在己方墨水中游动',
  'hud.humanoid': '人形态',
  'hud.swimming': '游动中',
  'hud.waiting': '等待玩家',
  'hud.countdown': '准备…',
  'hud.timeUp': '时间到!',
  'hud.splatted': '被击败!',
  'hud.respawnIn': '{s} 秒后复活…',
  'hud.sbTitle': '计分板',
  'hud.sbHint': '按住 TAB 查看',
  'hud.sbPlayer': '玩家',
  'hud.sbTeam': '队伍',
  'hud.sbK': '击杀',
  'hud.sbD': '死亡',
  'hud.clickEnter': '点击进入战场',
  'hud.escHint': '按 ESC 暂停，F3 打开调试信息',
  'hud.resume': '继续游戏',
  'hud.connecting': '正在连接服务器…',
  'hud.syncing': '正在同步战场… ({n}/{m})',
  'hud.lost': '连接断开，3 秒后自动刷新重连…',
  'hud.errPrefix': '连接错误: {msg} — 正在重试…',
  'hud.weaponSwitchHint': '按 1-4 快速换枪',
  'hud.radar': '雷达',
  'hud.points': '得分',
  'hud.kills': '击杀',
  'hud.coverage': '涂地率',

  'gameover.pinkWins': '粉红队获胜!',
  'gameover.cyanWins': '青色队获胜!',
  'gameover.draw': '平局!',
  'gameover.nextMatch': '{s} 秒后开始下一场…',

  'settings.title': '游戏设置',
  'settings.sens': '鼠标灵敏度',
  'settings.fov': '视场角 (FOV)',
  'settings.sfx': '音效音量',
  'settings.bgm': '音乐音量',
  'settings.quality': '画质等级',
  'settings.qLow': '低',
  'settings.qMed': '中',
  'settings.qHigh': '高',
  'settings.qAuto': '自动（动态分辨率）',
  'settings.bots': '离线练习机器人',
  'settings.addBot': '🤖 添加练习机器人',
  'settings.clearBots': '清除机器人',
  'settings.done': '完成',

  'codex.title': '角色与装备图鉴',
  'codex.subtitle': 'ILLUSTRATED CODEX & ART GALLERY',
  'codex.close': '关闭',
  'codex.tabChars': '角色与形态',
  'codex.tabWeapons': '主要武器',
  'codex.tabSubs': '副武器与大招',
  'codex.tabGear': '潮流装备',
  'codex.tabScenery': '赛场与场景',
  'codex.dmg': '威力',
  'codex.range': '射程',
  'codex.rate': '射速',
  'codex.ink': '墨耗',
  'codex.radius': '半径',
  'codex.duration': '持续',
  'codex.dps': '秒伤',
  'codex.roll': '碾压',
  'codex.charge': '蓄力'
};

const ja: Record<string, string> = {
  'title.tagline': '3D マルチプレイ塗りバトル',
  'title.play': 'ロビーへ',
  'title.codex': '図鑑',
  'title.settings': '設定',
  'title.credits': 'ブラウザ WebGL · リアルタイム対戦',

  'lobby.badge': 'ナワバリバトル・ロビー',
  'lobby.name': 'プレイヤー名',
  'lobby.namePlaceholder': '名前を入力',
  'lobby.selectWeapon': 'メインウェポン選択',
  'lobby.team': 'チーム分け',
  'lobby.auto': '自動バランス',
  'lobby.pink': 'ピンクチーム',
  'lobby.cyan': 'シアンチーム',
  'lobby.players': '接続プレイヤー',
  'lobby.matchIn': '{s} 秒後に試合開始…',
  'lobby.ready': '準備完了!',
  'lobby.cancelReady': '準備取消',
  'lobby.start': '今すぐ試合開始',
  'lobby.return': 'ロビーへ戻る',
  'lobby.ctrlMove': '移動',
  'lobby.ctrlFire': '射撃 / 転圧',
  'lobby.ctrlSub': 'サブウェポン',
  'lobby.ctrlSpecial': 'スペシャル',
  'lobby.ctrlSwim': 'インクに潜って泳ぐ',
  'lobby.skills': 'ギアスキル選択（最大3つ）',
  'lobby.skillsHint': 'スキルはパッシブ効果で、試合中ずっと有効',
  'lobby.mode': 'ルール',
  'lobby.map': 'ステージ',
  'lobby.bots': 'ボット',
  'lobby.addBot': '＋ ボット追加',
  'lobby.removeBot': '－ ボット削除',
  'lobby.hostOnly': 'ホストのみ操作可能',
  'lobby.you': '（あなた）',
  'lobby.codexBtn': '装備とキャラ図鑑',
  'lobby.avatarUpload': 'クリックでアバターをアップロード',
  'lobby.avatarTooBig': '画像が大きすぎます。5MB 未満の画像を選んでください',
  'lobby.subBadge': 'サブ',
  'lobby.specialBadge': 'スペシャル',
  'lobby.skillCount': '選択 {n}/3',
  'lobby.waiting': '待機中',
  'lobby.readyBadge': '準備完了',
  'lobby.hostBadge': 'ホスト',
  'lobby.botBadge': 'ボット',

  'hud.hp': 'ライフ',
  'hud.inkTank': 'インクタンク',
  'hud.specialMeter': 'スペシャルゲージ',
  'hud.specialReady': '[E] スペシャル使用可能!',
  'hud.shiftHint': 'SHIFT で自分のインクに潜る',
  'hud.humanoid': 'ヒト',
  'hud.swimming': 'イカ',
  'hud.waiting': 'プレイヤー待ち',
  'hud.countdown': '準備中…',
  'hud.timeUp': 'タイムアップ!',
  'hud.splatted': 'やられた!',
  'hud.respawnIn': '{s} 秒で復活…',
  'hud.sbTitle': 'スコアボード',
  'hud.sbHint': 'TAB を押しながら表示',
  'hud.sbPlayer': 'プレイヤー',
  'hud.sbTeam': 'チーム',
  'hud.sbK': 'キル',
  'hud.sbD': 'デス',
  'hud.clickEnter': 'クリックしてアリーナへ',
  'hud.escHint': 'ESC で一時停止、F3 でデバッグ表示',
  'hud.resume': 'ゲームを再開',
  'hud.connecting': 'サーバーに接続中…',
  'hud.syncing': 'アリーナを同期中… ({n}/{m})',
  'hud.lost': '接続が切断されました。3 秒後に再接続します…',
  'hud.errPrefix': '接続エラー: {msg} — 再試行中…',
  'hud.weaponSwitchHint': '1-4 で武器切り替え',
  'hud.radar': 'レーダー',
  'hud.points': 'ポイント',
  'hud.kills': 'キル',
  'hud.coverage': '塗り面積',

  'gameover.pinkWins': 'ピンクチームの勝利!',
  'gameover.cyanWins': 'シアンチームの勝利!',
  'gameover.draw': '引き分け!',
  'gameover.nextMatch': '{s} 秒後に次の試合…',

  'settings.title': 'ゲーム設定',
  'settings.sens': 'マウス感度',
  'settings.fov': '視野角 (FOV)',
  'settings.sfx': '効果音音量',
  'settings.bgm': 'BGM 音量',
  'settings.quality': '画質レベル',
  'settings.qLow': '低',
  'settings.qMed': '中',
  'settings.qHigh': '高',
  'settings.qAuto': '自動（動的解像度）',
  'settings.bots': 'オフライン練習ボット',
  'settings.addBot': '🤖 練習ボット追加',
  'settings.clearBots': 'ボット全消去',
  'settings.done': '完了',

  'codex.title': 'キャラ・装備図鑑',
  'codex.subtitle': 'ILLUSTRATED CODEX & ART GALLERY',
  'codex.close': '閉じる',
  'codex.tabChars': 'キャラと形態',
  'codex.tabWeapons': 'メインウェポン',
  'codex.tabSubs': 'サブ・スペシャル',
  'codex.tabGear': 'ギア',
  'codex.tabScenery': 'ステージ',
  'codex.dmg': '威力',
  'codex.range': '射程',
  'codex.rate': '連射',
  'codex.ink': 'インク消費',
  'codex.radius': '半径',
  'codex.duration': '時間',
  'codex.dps': 'DPS',
  'codex.roll': '転圧',
  'codex.charge': 'チャージ'
};

const en: Record<string, string> = {
  'title.tagline': '3D Multiplayer Turf War',
  'title.play': 'Enter Lobby',
  'title.codex': 'Codex',
  'title.settings': 'Settings',
  'title.credits': 'Browser WebGL · Real-time online battle',

  'lobby.badge': 'TURF WAR BATTLE LOBBY',
  'lobby.name': 'Inker Name',
  'lobby.namePlaceholder': 'Enter your name',
  'lobby.selectWeapon': 'Select Weapon Loadout',
  'lobby.team': 'Team Assignment',
  'lobby.auto': 'Auto-Balance',
  'lobby.pink': 'Team Pink',
  'lobby.cyan': 'Team Cyan',
  'lobby.players': 'Connected Players',
  'lobby.matchIn': 'Match in {s}s…',
  'lobby.ready': 'READY!',
  'lobby.cancelReady': 'CANCEL READY',
  'lobby.start': 'START MATCH NOW',
  'lobby.return': 'RETURN TO LOBBY',
  'lobby.ctrlMove': 'Move',
  'lobby.ctrlFire': 'Fire / Roll',
  'lobby.ctrlSub': 'Sub-weapon Bomb',
  'lobby.ctrlSpecial': 'Special Ultimate',
  'lobby.ctrlSwim': 'Swim in ink',
  'lobby.skills': 'Select Skills (max 3)',
  'lobby.skillsHint': 'Skills are passive perks that stay active the whole match',
  'lobby.mode': 'Game Mode',
  'lobby.map': 'Arena Map',
  'lobby.bots': 'Bots',
  'lobby.addBot': '＋ Add Bot',
  'lobby.removeBot': '－ Remove Bot',
  'lobby.hostOnly': 'Host only',
  'lobby.you': '(You)',
  'lobby.codexBtn': 'Gear & Character Codex',
  'lobby.avatarUpload': 'Click to upload avatar',
  'lobby.avatarTooBig': 'Image too large — pick one under 5MB',
  'lobby.subBadge': 'Sub',
  'lobby.specialBadge': 'Special',
  'lobby.skillCount': '{n}/3 selected',
  'lobby.waiting': 'WAITING',
  'lobby.readyBadge': 'READY',
  'lobby.hostBadge': 'HOST',
  'lobby.botBadge': 'BOT',

  'hud.hp': 'HP',
  'hud.inkTank': 'INK TANK',
  'hud.specialMeter': 'SPECIAL METER',
  'hud.specialReady': '[E] SPECIAL READY!',
  'hud.shiftHint': 'HOLD SHIFT TO SWIM IN OWN INK',
  'hud.humanoid': 'HUMANOID',
  'hud.swimming': 'SWIMMING',
  'hud.waiting': 'WAITING FOR PLAYERS',
  'hud.countdown': 'READY…',
  'hud.timeUp': 'TIME UP!',
  'hud.splatted': 'SPLATTED!',
  'hud.respawnIn': 'Respawning in {s}s…',
  'hud.sbTitle': 'SCOREBOARD',
  'hud.sbHint': 'Hold TAB to view',
  'hud.sbPlayer': 'PLAYER',
  'hud.sbTeam': 'TEAM',
  'hud.sbK': 'K',
  'hud.sbD': 'D',
  'hud.clickEnter': 'CLICK TO ENTER ARENA',
  'hud.escHint': 'Press ESC to pause, F3 for debug stats',
  'hud.resume': 'RESUME GAME',
  'hud.connecting': 'Connecting to Ink Arena server…',
  'hud.syncing': 'Synchronizing arena… ({n}/{m})',
  'hud.lost': 'Connection lost. Refreshing to rejoin in 3s…',
  'hud.errPrefix': 'Connect error: {msg} — retrying…',
  'hud.weaponSwitchHint': 'Press 1-4 to switch weapons',
  'hud.radar': 'RADAR',
  'hud.points': 'POINTS',
  'hud.kills': 'KILLS',
  'hud.coverage': 'COVERAGE',

  'gameover.pinkWins': 'TEAM PINK WINS!',
  'gameover.cyanWins': 'TEAM CYAN WINS!',
  'gameover.draw': 'DRAW!',
  'gameover.nextMatch': 'Next match in {s}s…',

  'settings.title': 'GAME SETTINGS',
  'settings.sens': 'Mouse Sensitivity',
  'settings.fov': 'Field of View (FOV)',
  'settings.sfx': 'SFX Volume',
  'settings.bgm': 'BGM Volume',
  'settings.quality': 'Graphics Quality',
  'settings.qLow': 'Low',
  'settings.qMed': 'Medium',
  'settings.qHigh': 'High',
  'settings.qAuto': 'Auto (adaptive res)',
  'settings.bots': 'Offline Practice Bots',
  'settings.addBot': '🤖 Add Practice Bot',
  'settings.clearBots': 'Clear Bots',
  'settings.done': 'DONE',

  'codex.title': 'Character & Gear Codex',
  'codex.subtitle': 'ILLUSTRATED CODEX & ART GALLERY',
  'codex.close': 'Close',
  'codex.tabChars': 'Characters',
  'codex.tabWeapons': 'Main Weapons',
  'codex.tabSubs': 'Subs & Specials',
  'codex.tabGear': 'Gear',
  'codex.tabScenery': 'Arenas',
  'codex.dmg': 'Damage',
  'codex.range': 'Range',
  'codex.rate': 'Fire Rate',
  'codex.ink': 'Ink Cost',
  'codex.radius': 'Radius',
  'codex.duration': 'Duration',
  'codex.dps': 'DPS',
  'codex.roll': 'Roll',
  'codex.charge': 'Charge'
};

const DICTS: Record<Lang, Record<string, string>> = { zh, ja, en };

const STORAGE_KEY = 'ink_arena_lang';
let current: Lang = detectLang();

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'ja' || saved === 'en') return saved;
  } catch {
    // localStorage unavailable
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('ja')) return 'ja';
  return 'en';
}

export function getLang(): Lang {
  return current;
}

export function langLabel(lang: Lang): string {
  return LANG_LABEL[lang];
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  applyI18n();
  // Let every live module (lobby cards, settings modal, codex) re-render
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<Lang>('ink:langchange', { detail: lang }));
  }
}

/** Translate a key with {param} interpolation. Falls back to English then key. */
export function t(key: string, params?: Record<string, string | number>): string {
  let out = DICTS[current][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return out;
}

/** Applies translations to every element carrying data-i18n attributes. */
export function applyI18n(root?: ParentNode): void {
  if (typeof document === 'undefined') return;
  const target = root ?? document;
  const nodes = target.querySelectorAll('[data-i18n]');
  nodes.forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  target.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && (el as HTMLInputElement).placeholder !== undefined) {
      (el as HTMLInputElement).placeholder = t(key);
    }
  });
  target.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
}

/** Picks the localized name off any shared config carrying name/nameZh/nameJa. */
export function locName(cfg: { name: string; nameZh: string; nameJa: string }): string {
  if (current === 'zh') return cfg.nameZh;
  if (current === 'ja') return cfg.nameJa;
  return cfg.name;
}

/** Picks the localized description off any shared config. */
export function locDesc(cfg: {
  description: string;
  descriptionZh: string;
  descriptionJa: string;
}): string {
  if (current === 'zh') return cfg.descriptionZh;
  if (current === 'ja') return cfg.descriptionJa;
  return cfg.description;
}

export type LocalizableConfig =
  | WeaponStats
  | SubWeaponStats
  | SpecialStats
  | GameModeStats
  | SkillStats
  | MapDef;
