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
  'page.title': '墨水竞技场 - 3D 多人涂地对战',

  'title.tagline': '3D 多人涂地大乱斗',
  'title.play': '进入大厅',
  'title.codex': '装备图鉴',
  'title.settings': '游戏设置',
  'title.credits': '纯浏览器 WebGL · 实时联机对战',
  'title.back': '返回主菜单',
  'title.version': 'INK ARENA v1.1',

  'team.pink': '粉红队',
  'team.cyan': '青色队',
  'mode.turfWar': '涂地对战',

  'lobby.badge': '涂地大战·对战大厅',
  'lobby.name': '玩家昵称',
  'lobby.namePlaceholder': '输入你的名字',
  'lobby.inker': '墨水战士',
  'lobby.avatarAlt': '墨水战士头像',
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
  'hud.loadoutWeapon': '主武器',
  'hud.loadoutSub': '副武器 [Q / 右键]',
  'hud.specialReadyTitle': '大招已就绪',
  'hud.radarToggle': '[M] 切换',
  'hud.you': '你',
  'hud.turfHazard': '涂地事故',
  'hud.system': '系统',
  'hud.spawnedBot': '已生成 {name}',
  'hud.clearedBots': '已清除全部机器人',
  'hud.playerHash': '玩家 #{id}',
  'hud.initFailed': '初始化失败: {msg}',

  'gameover.matchOver': '比赛结束',
  'gameover.vs': 'VS',
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
  'settings.openTitle': '游戏设置 [O]',

  'debug.title': '调试信息 (F3)',
  'debug.fps': '帧率',
  'debug.ping': '延迟',
  'debug.ms': '毫秒',
  'debug.playerId': '玩家 ID',
  'debug.team': '队伍',
  'debug.position': '坐标',
  'debug.groundInk': '地面墨水',
  'debug.hp': '生命',
  'debug.ink': '墨水',
  'debug.mode': '形态',
  'debug.paintEvents': '涂地事件',
  'debug.pink': '粉红',
  'debug.cyan': '青色',
  'debug.neutral': '中立',
  'debug.humanoid': '人形态',
  'debug.submerged': '游动中',
  'debug.dead': '已阵亡',

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
  'codex.charge': '蓄力',
  'codex.pellets': '弹丸',
  'codex.blast': '爆炸范围',

  'codex.badgePink': '粉红战队',
  'codex.badgeCyan': '青色战队',
  'codex.badgeTransform': '形态变化',
  'codex.badgeKeyArt': '主视觉',
  'codex.badgeSub': '副武器',
  'codex.badgeSpecial': '大招',
  'codex.badgeBackpack': '背包',
  'codex.badgeHeadgear': '头部装备',
  'codex.badgeFootwear': '鞋子',
  'codex.badgeBattleground': '对战赛场',
  'codex.badgeLobby': '大厅广场',
  'codex.badgeVictory': '胜利舞台',
  'codex.lightboxAlt': '全屏预览'
};

const ja: Record<string, string> = {
  'page.title': 'インクアリーナ - 3D マルチ塗りバトル',

  'title.tagline': '3D マルチプレイ塗りバトル',
  'title.play': 'ロビーへ',
  'title.codex': '図鑑',
  'title.settings': '設定',
  'title.credits': 'ブラウザ WebGL · リアルタイム対戦',
  'title.back': 'タイトルへ戻る',
  'title.version': 'INK ARENA v1.1',

  'team.pink': 'ピンクチーム',
  'team.cyan': 'シアンチーム',
  'mode.turfWar': 'ナワバリバトル',

  'lobby.badge': 'ナワバリバトル・ロビー',
  'lobby.name': 'プレイヤー名',
  'lobby.namePlaceholder': '名前を入力',
  'lobby.inker': 'インクリンガー',
  'lobby.avatarAlt': 'インクリンガーのアバター',
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
  'hud.loadoutWeapon': 'メインウェポン',
  'hud.loadoutSub': 'サブウェポン [Q / 右クリック]',
  'hud.specialReadyTitle': 'スペシャル使用可能',
  'hud.radarToggle': '[M] 切替',
  'hud.you': 'あなた',
  'hud.turfHazard': 'インク事故',
  'hud.system': 'システム',
  'hud.spawnedBot': '{name} を出現させた',
  'hud.clearedBots': 'ボットを全削除',
  'hud.playerHash': 'プレイヤー #{id}',
  'hud.initFailed': '初期化に失敗しました: {msg}',

  'gameover.matchOver': '試合終了',
  'gameover.vs': 'VS',
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
  'settings.openTitle': '設定 [O]',

  'debug.title': 'デバッグ情報 (F3)',
  'debug.fps': 'FPS',
  'debug.ping': 'Ping',
  'debug.ms': 'ms',
  'debug.playerId': 'プレイヤーID',
  'debug.team': 'チーム',
  'debug.position': '座標',
  'debug.groundInk': '地面インク',
  'debug.hp': 'HP',
  'debug.ink': 'インク',
  'debug.mode': '形態',
  'debug.paintEvents': '塗りイベント',
  'debug.pink': 'ピンク',
  'debug.cyan': 'シアン',
  'debug.neutral': '中立',
  'debug.humanoid': 'ヒト',
  'debug.submerged': 'イカ',
  'debug.dead': 'やられた',

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
  'codex.charge': 'チャージ',
  'codex.pellets': 'ペレット',
  'codex.blast': '爆発範囲',

  'codex.badgePink': 'ピンクチーム',
  'codex.badgeCyan': 'シアンチーム',
  'codex.badgeTransform': '形態変化',
  'codex.badgeKeyArt': 'キービジュアル',
  'codex.badgeSub': 'サブウェポン',
  'codex.badgeSpecial': 'スペシャル',
  'codex.badgeBackpack': 'バックパック',
  'codex.badgeHeadgear': 'ヘッドギア',
  'codex.badgeFootwear': 'シューズ',
  'codex.badgeBattleground': 'バトルステージ',
  'codex.badgeLobby': 'ロビープラザ',
  'codex.badgeVictory': '表彰ステージ',
  'codex.lightboxAlt': '全画面プレビュー'
};

const en: Record<string, string> = {
  'page.title': 'Ink Arena - 3D Multiplayer Turf War',

  'title.tagline': '3D Multiplayer Turf War',
  'title.play': 'Enter Lobby',
  'title.codex': 'Codex',
  'title.settings': 'Settings',
  'title.credits': 'Browser WebGL · Real-time online battle',
  'title.back': 'Back to Title',
  'title.version': 'INK ARENA v1.1',

  'team.pink': 'TEAM PINK',
  'team.cyan': 'TEAM CYAN',
  'mode.turfWar': 'TURF WAR',

  'lobby.badge': 'TURF WAR BATTLE LOBBY',
  'lobby.name': 'Inker Name',
  'lobby.namePlaceholder': 'Enter your name',
  'lobby.inker': 'Inker',
  'lobby.avatarAlt': 'Inker avatar',
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
  'hud.loadoutWeapon': 'WEAPON',
  'hud.loadoutSub': 'SUB [Q / RMB]',
  'hud.specialReadyTitle': 'Special Ready!',
  'hud.radarToggle': '[M] toggle',
  'hud.you': 'You',
  'hud.turfHazard': 'Turf Hazard',
  'hud.system': 'SYSTEM',
  'hud.spawnedBot': 'Spawned {name}',
  'hud.clearedBots': 'Cleared all bots',
  'hud.playerHash': 'Player #{id}',
  'hud.initFailed': 'Initialization failed: {msg}',

  'gameover.matchOver': 'MATCH OVER',
  'gameover.vs': 'VS',
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
  'settings.openTitle': 'Settings [O]',

  'debug.title': 'DEBUG STATS (F3)',
  'debug.fps': 'FPS',
  'debug.ping': 'Ping',
  'debug.ms': 'ms',
  'debug.playerId': 'Player ID',
  'debug.team': 'Team',
  'debug.position': 'Position',
  'debug.groundInk': 'Ground Ink',
  'debug.hp': 'HP',
  'debug.ink': 'Ink',
  'debug.mode': 'Mode',
  'debug.paintEvents': 'Paint Events',
  'debug.pink': 'Pink',
  'debug.cyan': 'Cyan',
  'debug.neutral': 'Neutral',
  'debug.humanoid': 'Humanoid',
  'debug.submerged': 'Submerged',
  'debug.dead': 'Dead',

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
  'codex.charge': 'Charge',
  'codex.pellets': 'Pellets',
  'codex.blast': 'Blast',

  'codex.badgePink': 'TEAM PINK',
  'codex.badgeCyan': 'TEAM CYAN',
  'codex.badgeTransform': 'TRANSFORMATION',
  'codex.badgeKeyArt': 'KEY ART',
  'codex.badgeSub': 'SUB WEAPON',
  'codex.badgeSpecial': 'SPECIAL ULTIMATE',
  'codex.badgeBackpack': 'BACKPACK',
  'codex.badgeHeadgear': 'HEADGEAR',
  'codex.badgeFootwear': 'FOOTWEAR',
  'codex.badgeBattleground': 'BATTLEGROUND',
  'codex.badgeLobby': 'LOBBY PLAZA',
  'codex.badgeVictory': 'VICTORY STAGE',
  'codex.lightboxAlt': 'Full preview'
};

const DICTS: Record<Lang, Record<string, string>> = { zh, ja, en };

/**
 * Read-only view of every dictionary, keyed by language. Exported so tooling
 * (and tests/i18nCoverage.test.ts) can assert the three languages stay
 * key-identical without reaching into module internals.
 */
export const DICTIONARIES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = DICTS;

/** Every key defined in the English dictionary, sorted. */
export function allKeys(): string[] {
  return Object.keys(en).sort();
}

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
  syncDocumentLang();
  // Let every live module (lobby cards, settings modal, codex) re-render
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<Lang>('ink:langchange', { detail: lang }));
  }
}

/** Keeps `<html lang>` honest so font/line-break rules follow the UI language. */
export function syncDocumentLang(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
}

/**
 * Localizes the static markup once at startup. `setLang()` only runs on a user
 * switch, so without this every element carrying `data-i18n` keeps whatever
 * English the HTML shipped with until the player touches the language buttons.
 */
export function initI18n(): void {
  applyI18n();
  syncDocumentLang();
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
  // Alt text for decorative/illustrative images that still need a label
  target.querySelectorAll('[data-i18n-alt]').forEach((el) => {
    const key = el.getAttribute('data-i18n-alt');
    if (key) el.setAttribute('alt', t(key));
  });
  // Keep every language switcher's highlight in sync with the active language
  document.querySelectorAll('.lang-btn').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-lang') === current);
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
