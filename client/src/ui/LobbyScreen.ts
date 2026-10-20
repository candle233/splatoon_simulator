import {
  GameMode,
  GAME_MODES,
  LobbyStatePayload,
  MAP_DEFS,
  MODE_CONFIGS,
  SKILL_CONFIGS,
  SPECIAL_CONFIGS,
  SUB_WEAPON_CONFIGS,
  Team,
  WEAPON_CONFIGS,
  getMapDef,
  isValidGameMode
} from '@ink/shared';
import type { MapId, SkillId, WeaponType } from '@ink/shared';
import { applyI18n, getLang, langLabel, locDesc, locName, setLang, t, LANGS } from '../i18n.js';
import { renderCodex } from './CodexData.js';
import { Lobby3D } from './3DLobby.js';
import { lobbyAudio } from './LobbyAudio.js';
import type { ScreenManager } from './ScreenManager.js';

export interface LobbyScreenCallbacks {
  onLobbyUpdate: (
    data: Partial<{ name: string; team: Team; weaponType: WeaponType; skills: SkillId[]; ready: boolean; avatar?: string }>
  ) => void;
  onLobbyStart: () => void;
  onWeaponChanged: (weapon: WeaponType) => void;
  onRequestEnterArena: () => void;
  onMatchConfig: (config: { mode?: GameMode; mapId?: MapId }) => void;
  onAddBot: (team?: Team) => void;
  onRemoveBot: () => void;
  /** Leave the lobby and go back to the title screen. */
  onReturnToTitle: () => void;
  /** Optional getter for real-time network latency (ms). */
  getPing?: () => number;
}

const MAX_SKILLS = 3;

/**
 * Card thumbnails per weapon. Weapons without their own art reuse the closest
 * silhouette; the card falls back to a tinted plate if the file is missing.
 */
const WEAPON_THUMBS: Record<string, string> = {
  shooter: '/assets/weapons/splattershot.jpg',
  roller: '/assets/weapons/splat_roller.jpg',
  charger: '/assets/weapons/splat_charger.jpg',
  slosher: '/assets/weapons/slosher.jpg',
  sprayer: '/assets/weapons/sprayer.jpg',
  cannon: '/assets/weapons/cannon.jpg',
  marksman: '/assets/weapons/marksman.jpg',
  scatter: '/assets/weapons/scatter.jpg'
};

interface MapMeta {
  scale: string;
  verticalityScore: string;
  peakHeight: string;
  landmarksZh: string;
  landmarksJa: string;
  landmarks: string;
  tiersZh: string;
  tiersJa: string;
  tiers: string;
  recommendedZh: string;
  recommendedJa: string;
  recommended: string;
}

const MAP_METAS: Record<MapId, MapMeta> = {
  downtown: {
    scale: '145m × 145m',
    verticalityScore: '★★★★★',
    peakHeight: '8.4m',
    landmarks: 'Hotel Tower · Skywalk Bridge · Center Plaza',
    landmarksZh: '高空饭店 · 连廊天桥 · 中央喷泉广场',
    landmarksJa: 'ホテルタワー · スカイウォーク · 中央広場',
    tiers: 'Ground (0m) · Skywalk (4.8m) · Hotel Peak (8.4m)',
    tiersZh: '地面战区 (0m) · 连廊天桥 (4.8m) · 饭店尖塔 (8.4m)',
    tiersJa: '地上エリア (0m) · スカイウォーク (4.8m) · ホテル屋上 (8.4m)',
    recommendedZh: '推荐: 突击步枪 · 滚筒 · 蓄力狙击',
    recommendedJa: '推奨: アサルト · ローラー · チャージャー',
    recommended: 'Rec: Shooter · Roller · Charger'
  },
  cargo_docks: {
    scale: '185m × 185m',
    verticalityScore: '★★★★★',
    peakHeight: '8.4m',
    landmarks: 'Gantry Skybridge · Crane Mast · Container Stacks',
    landmarksZh: '龙门吊天桥 · 起重机桅杆 · 集装箱高台',
    landmarksJa: 'ガントリー橋 · クレーンマスト · コンテナ集積場',
    tiers: 'Harbor Ground (0m) · Gantry Deck (4.8m) · Crane Nest (8.4m)',
    tiersZh: '码头地面 (0m) · 吊装天桥 (4.8m) · 起重机顶 (8.4m)',
    tiersJa: '埠頭地上 (0m) · ガントリーデッキ (4.8m) · クレーン頂 (8.4m)',
    recommendedZh: '推荐: 蓄力狙击 · 精准射手 · 泼桶',
    recommendedJa: '推奨: チャージャー · マークスマン · スロッシャー',
    recommended: 'Rec: Charger · Marksman · Slosher'
  },
  sky_rink: {
    scale: '130m × 130m',
    verticalityScore: '★★★★☆',
    peakHeight: '7.2m',
    landmarks: 'Launch Ramps · Stepped Pyramid · VIP Crow Nest',
    landmarksZh: '腾空跳台 · 阶梯金字塔 · VIP观瞻台',
    landmarksJa: 'ローンチランプ · ピラミッド · VIP観覧台',
    tiers: 'Skate Rink (0m) · Funbox Deck (3.6m) · DJ Crow Nest (7.2m)',
    tiersZh: '轮滑底板 (0m) · 组合跳台 (3.6m) · DJ瞭望台 (7.2m)',
    tiersJa: 'スケートリンク (0m) · ファンボックス (3.6m) · DJデッキ (7.2m)',
    recommendedZh: '推荐: 涂地滚筒 · 狂暴速射 · 散弹枪',
    recommendedJa: '推奨: ローラー · スプレー · ショットガン',
    recommended: 'Rec: Roller · Sprayer · Scatter'
  },
  aurora_outpost: {
    scale: '160m × 160m',
    verticalityScore: '★★★★★',
    peakHeight: '8.4m',
    landmarks: 'Polar Radome · Lab Connector Tube · Hangar Deck',
    landmarksZh: '极地雷达站 · 实验室高空管道 · 机库高台',
    landmarksJa: '極地レドーム · 連結チューブ · 格納庫デッキ',
    tiers: 'Snow Field (0m) · Elevated Tube (3.6m) · Hangar Nest (8.4m)',
    tiersZh: '雪原平地 (0m) · 高架连管 (3.6m) · 机库瞭望顶 (8.4m)',
    tiersJa: '雪原地帯 (0m) · 高架チューブ (3.6m) · 格納庫ネスト (8.4m)',
    recommendedZh: '推荐: 蓄力狙击 · 重型迫击 · 突击步枪',
    recommendedJa: '推奨: チャージャー · モーター · アサルト',
    recommended: 'Rec: Charger · Cannon · Shooter'
  }
};

const MODE_WIN_CONDITIONS: Record<GameMode, { en: string; zh: string; ja: string }> = {
  turf_war: {
    en: 'Win: Greatest ink coverage % when time expires',
    zh: '胜负：3分钟倒计时结束时涂墨占比最高获胜',
    ja: '勝敗：3分終了時にインク面積が最も広いチームが勝利'
  },
  splat_zones: {
    en: 'Win: Hold central zone to drain timer to 0',
    zh: '胜负：占领并坚守中央占领区将计时清零',
    ja: '勝敗：中央エリアを制圧・防衛しカウントを0にすれば勝利'
  },
  team_deathmatch: {
    en: 'Win: First team to reach target splat count or highest score',
    zh: '胜负：率先达到目标击倒数或终场高分队伍获胜',
    ja: '勝敗：目標キル数に先着または終了時最高得点で勝利'
  },
  ranked_hybrid: {
    en: 'Win: Combined score of enemy splats and turf coverage',
    zh: '胜负：击倒敌人数与涂地占比综合判定',
    ja: '勝敗：キル数と塗り面積の総合スコアで勝敗判定'
  },
  final_push: {
    en: 'Win: High stakes — turf sampled in the final 30s',
    zh: '胜负：终局激战，以最后30秒冲刺阶段涂墨采样决胜',
    ja: '勝敗：ラスト30秒のスプリントで大逆転の塗り判定'
  }
};

const WEAPON_CATEGORIES: Record<WeaponType, { en: string; zh: string; ja: string }> = {
  shooter: { en: 'ALL-ROUNDER RIFLE', zh: '全能突击自动步枪', ja: '万能アサルトライフル' },
  roller: { en: 'HEAVY CRUSHER', zh: '近战重击涂地滚筒', ja: '近接重撃ローラー' },
  charger: { en: 'PRECISION CHARGER', zh: '超远狙击蓄力光束', ja: '超遠距離チャージャー' },
  slosher: { en: 'HIGH-ARC SLOSHER', zh: '曲射范围高爆墨桶', ja: '曲射スロッシャー' },
  sprayer: { en: 'RAPID MIST SPRAYER', zh: '超连射狂暴速射枪', ja: '超連射スプレー' },
  cannon: { en: 'SIEGE HEAVY MORTAR', zh: '重型范围爆破墨炮', ja: '重装迫撃モーター' },
  marksman: { en: 'TACTICAL MARKSMAN', zh: '半自动精准点射步枪', ja: '精密射撃マークスマン' },
  scatter: { en: 'POINT-BLANK SCATTER', zh: '近距致命六弹丸散弹', ja: '至近距離ショットガン' }
};

interface WeaponStatValues {
  rangePct: number;
  damagePct: number;
  fireRatePct: number;
  mobilityPct: number;
  mobilityTier: { en: string; zh: string; ja: string };
}

const WEAPON_STAT_VALS: Record<WeaponType, WeaponStatValues> = {
  shooter: { rangePct: 60, damagePct: 40, fireRatePct: 65, mobilityPct: 80, mobilityTier: { en: 'High', zh: '高', ja: '高' } },
  roller: { rangePct: 25, damagePct: 100, fireRatePct: 20, mobilityPct: 45, mobilityTier: { en: 'Heavy', zh: '重装', ja: '重装' } },
  charger: { rangePct: 100, damagePct: 100, fireRatePct: 15, mobilityPct: 35, mobilityTier: { en: 'Tactical', zh: '战术', ja: '戦術' } },
  slosher: { rangePct: 35, damagePct: 75, fireRatePct: 25, mobilityPct: 65, mobilityTier: { en: 'Mid', zh: '中等', ja: '中' } },
  sprayer: { rangePct: 45, damagePct: 25, fireRatePct: 100, mobilityPct: 95, mobilityTier: { en: 'Extreme', zh: '极高', ja: '極高' } },
  cannon: { rangePct: 55, damagePct: 80, fireRatePct: 15, mobilityPct: 30, mobilityTier: { en: 'Siege', zh: '沉重', ja: '重装' } },
  marksman: { rangePct: 75, damagePct: 60, fireRatePct: 40, mobilityPct: 60, mobilityTier: { en: 'Balanced', zh: '均衡', ja: '標準' } },
  scatter: { rangePct: 20, damagePct: 95, fireRatePct: 25, mobilityPct: 75, mobilityTier: { en: 'Fast', zh: '敏捷', ja: '敏捷' } }
};

export class LobbyScreen {
  private container: HTMLElement;
  private nameInput: HTMLInputElement;
  private weaponOptions: NodeListOf<HTMLElement>;
  private teamButtons: NodeListOf<HTMLElement>;
  private playerCountEl: HTMLElement;
  private countdownEl: HTMLElement;
  private playerListEl: HTMLElement;
  private readyBtn: HTMLButtonElement;
  private startBtn: HTMLButtonElement;
  private returnLobbyBtn: HTMLButtonElement | null;

  private skillGrid: HTMLElement;
  private skillCountEl: HTMLElement;
  private modeGrid: HTMLElement;
  private mapGrid: HTMLElement;
  private addBotBtn: HTMLButtonElement | null;
  private removeBotBtn: HTMLButtonElement | null;
  private avatarImg: HTMLImageElement | null;
  private avatarTag: HTMLElement | null;
  private avatarFileInput: HTMLInputElement | null;
  private langSwitch: HTMLElement | null;
  private backBtn: HTMLButtonElement | null;
  private weaponLoadoutPreviewEl: HTMLElement | null = null;

  // Tabs navigation
  private tabButtons: NodeListOf<HTMLButtonElement>;
  private tabPanes: NodeListOf<HTMLElement>;
  private currentTab = 'hub';

  // Presets
  private currentPreset = 1;
  private presetButtons: NodeListOf<HTMLButtonElement>;
  private savePresetBtn: HTMLButtonElement | null = null;
  private presets: Record<number, { weapon: WeaponType; skills: SkillId[] }> = {
    1: { weapon: 'shooter', skills: ['ink_saver', 'swim_speed'] },
    2: { weapon: 'roller', skills: ['main_power', 'run_speed'] },
    3: { weapon: 'charger', skills: ['special_charge', 'ink_recovery'] }
  };

  // Splashtag & Profile
  private splashtagBannerEl: HTMLElement | null = null;
  private splashtagPrefixEl: HTMLElement | null = null;
  private splashtagSuffixEl: HTMLElement | null = null;
  private splashtagNameEl: HTMLElement | null = null;
  private splashtagHashEl: HTMLElement | null = null;
  private splashtagPrefixSelect: HTMLSelectElement | null = null;
  private splashtagSuffixSelect: HTMLSelectElement | null = null;
  private splashtagPrefix = 'Supercharged';
  private splashtagSuffix = 'Inker';

  // Bot Controller & Practice
  private addPinkBotBtn: HTMLButtonElement | null = null;
  private addCyanBotBtn: HTMLButtonElement | null = null;
  private soloPracticeBtn: HTMLButtonElement | null = null;
  private dockSoloBtn: HTMLButtonElement | null = null;

  // Settings
  private sfxSlider: HTMLInputElement | null = null;
  private bgmSlider: HTMLInputElement | null = null;
  private sfxVolVal: HTMLElement | null = null;
  private bgmVolVal: HTMLElement | null = null;

  // Dock & Hub Summary
  private dockPingVal: HTMLElement | null = null;
  private dockTeamPill: HTMLElement | null = null;
  private dockTeamName: HTMLElement | null = null;
  private dockModeSummary: HTMLElement | null = null;
  private dockMapSummary: HTMLElement | null = null;
  private hubStatPing: HTMLElement | null = null;
  private hubStatReady: HTMLElement | null = null;
  private hubModeName: HTMLElement | null = null;
  private hubMapName: HTMLElement | null = null;
  private hubMapTier: HTMLElement | null = null;

  /** 3D Splatoon-style lobby scene rendered behind the DOM overlay. */
  private lobby3D?: Lobby3D;
  private canvasContainer?: HTMLElement;

  private callbacks: LobbyScreenCallbacks;
  private screens?: ScreenManager;
  public playerName: string;
  public selectedWeapon: WeaponType = 'shooter';
  public selectedTeam: Team = Team.NEUTRAL; // auto-balance
  public selectedSkills: SkillId[] = [];
  public isReady = false;
  private myPlayerId = '';
  private isHost = false;
  private currentMode: GameMode | undefined;
  private currentMapId: MapId | undefined;
  private lastLobbyState?: LobbyStatePayload;
  /** Own validated thumbnail, republished on each fresh connection. */
  private myAvatar?: string;
  /** Avatars seen for other players, keyed by player id. */
  private readonly avatarCache = new Map<string, string>();
  private livePingInterval?: number;

  constructor(callbacks: LobbyScreenCallbacks, screens?: ScreenManager) {
    this.callbacks = callbacks;
    this.screens = screens;

    this.container = document.getElementById('lobby-screen') as HTMLElement;
    this.nameInput = document.getElementById('player-name-input') as HTMLInputElement;
    this.weaponOptions = document.querySelectorAll('.weapon-option');
    this.teamButtons = document.querySelectorAll('.team-btn');
    this.playerCountEl = document.getElementById('lobby-player-count') as HTMLElement;
    this.countdownEl = document.getElementById('lobby-countdown-timer') as HTMLElement;
    this.playerListEl = document.getElementById('lobby-player-list') as HTMLElement;
    this.readyBtn = document.getElementById('btn-lobby-ready') as HTMLButtonElement;
    this.startBtn = document.getElementById('btn-lobby-start') as HTMLButtonElement;
    this.returnLobbyBtn = document.getElementById('btn-return-lobby') as HTMLButtonElement | null;

    this.skillGrid = document.getElementById('skill-grid') as HTMLElement;
    this.skillCountEl = document.getElementById('skill-count') as HTMLElement;
    this.modeGrid = document.getElementById('mode-grid') as HTMLElement;
    this.mapGrid = document.getElementById('map-grid') as HTMLElement;
    this.addBotBtn = document.getElementById('btn-lobby-add-bot') as HTMLButtonElement | null;
    this.removeBotBtn = document.getElementById('btn-lobby-remove-bot') as HTMLButtonElement | null;
    this.avatarImg = document.getElementById('profile-avatar-img') as HTMLImageElement | null;
    this.avatarTag = document.getElementById('profile-avatar-tag');
    this.avatarFileInput = document.getElementById('avatar-file-input') as HTMLInputElement | null;
    this.langSwitch = document.getElementById('lang-switch');
    this.backBtn = document.getElementById('btn-lobby-back') as HTMLButtonElement | null;

    // Upgraded DOM elements
    this.tabButtons = document.querySelectorAll('.lobby-tab-btn');
    this.tabPanes = document.querySelectorAll('.lobby-tab-pane');
    this.presetButtons = document.querySelectorAll('.preset-btn');
    this.savePresetBtn = document.getElementById('btn-save-preset') as HTMLButtonElement | null;

    this.splashtagBannerEl = document.getElementById('splashtag-banner');
    this.splashtagPrefixEl = document.getElementById('splashtag-prefix');
    this.splashtagSuffixEl = document.getElementById('splashtag-suffix');
    this.splashtagNameEl = document.getElementById('splashtag-name');
    this.splashtagHashEl = document.getElementById('splashtag-hash');
    this.splashtagPrefixSelect = document.getElementById('splashtag-prefix-select') as HTMLSelectElement | null;
    this.splashtagSuffixSelect = document.getElementById('splashtag-suffix-select') as HTMLSelectElement | null;

    this.addPinkBotBtn = document.getElementById('btn-add-pink-bot') as HTMLButtonElement | null;
    this.addCyanBotBtn = document.getElementById('btn-add-cyan-bot') as HTMLButtonElement | null;
    this.soloPracticeBtn = document.getElementById('btn-solo-practice') as HTMLButtonElement | null;
    this.dockSoloBtn = document.getElementById('btn-dock-solo') as HTMLButtonElement | null;

    this.sfxSlider = document.getElementById('setting-sfx-slider') as HTMLInputElement | null;
    this.bgmSlider = document.getElementById('setting-bgm-slider') as HTMLInputElement | null;
    this.sfxVolVal = document.getElementById('sfx-vol-val');
    this.bgmVolVal = document.getElementById('bgm-vol-val');

    this.dockPingVal = document.querySelector('.dock-ping-val');
    this.dockTeamPill = document.getElementById('dock-team-pill');
    this.dockTeamName = document.getElementById('dock-team-name');
    this.dockModeSummary = document.getElementById('dock-mode-summary');
    this.dockMapSummary = document.getElementById('dock-map-summary');
    this.hubStatPing = document.getElementById('hub-stat-ping');
    this.hubStatReady = document.getElementById('hub-stat-ready');
    this.hubModeName = document.getElementById('hub-mode-name');
    this.hubMapName = document.getElementById('hub-map-name');
    this.hubMapTier = document.getElementById('hub-map-tier');

    // Load persisted profile (name / weapon / team / skills / avatar)
    const savedName = localStorage.getItem('ink_arena_player_name');
    this.playerName = savedName || `Squid_${Math.floor(1000 + Math.random() * 9000)}`;
    if (this.nameInput) {
      this.nameInput.value = this.playerName;
    }

    const savedWeapon = localStorage.getItem('ink_arena_weapon') as WeaponType | null;
    if (savedWeapon && savedWeapon in WEAPON_CONFIGS) {
      this.selectedWeapon = savedWeapon;
    }
    const savedTeam = localStorage.getItem('ink_arena_team');
    if (savedTeam === 'pink') this.selectedTeam = Team.PINK;
    else if (savedTeam === 'cyan') this.selectedTeam = Team.CYAN;
    else this.selectedTeam = Team.NEUTRAL;

    try {
      const savedSkills = JSON.parse(localStorage.getItem('ink_arena_skills') || '[]');
      if (Array.isArray(savedSkills)) {
        this.selectedSkills = savedSkills
          .filter((s): s is SkillId => SKILL_CONFIGS.some((cfg) => cfg.id === s))
          .slice(0, MAX_SKILLS);
      }
    } catch {
      this.selectedSkills = [];
    }

    const savedAvatar = localStorage.getItem('ink_arena_avatar');
    if (savedAvatar) {
      this.myAvatar = savedAvatar;
      if (this.avatarImg) this.avatarImg.src = savedAvatar;
    } else {
      this.myAvatar = '/assets/avatars/avatar_pink.jpg';
      if (this.avatarImg) this.avatarImg.src = '/assets/avatars/avatar_pink.jpg';
    }

    // The weapon grid is generated before listeners are bound so the click
    // handlers attach to the real cards, not the static markup seed.
    this.buildWeaponGrid();
    this.restoreSelectionUi();
    this.buildSkillGrid();
    this.buildModeGrid();
    this.buildMapGrid();
    this.buildLangSwitch();
    this.applyLocalizedTexts();

    this.weaponLoadoutPreviewEl = document.getElementById('weapon-loadout-preview');
    this.renderWeaponLoadoutPreview(this.selectedWeapon);

    this.setupTabs();
    this.setupLoadoutPresets();
    this.setupSplashtag();
    this.setupCareerStats();
    this.setupBotController();
    this.setupSettings();
    this.setupEventListeners();
    this.setupCodexModal();
    this.setupAvatarUpload();
    this.updateDock();

    // Language switches from the title screen also rebuild lobby cards
    window.addEventListener('ink:langchange', () => this.onLanguageChanged());
  }

  // ------------------------------------------------------------------
  // Profile persistence
  // ------------------------------------------------------------------

  private restoreSelectionUi(): void {
    this.weaponOptions.forEach((opt) => {
      opt.classList.toggle('selected', opt.getAttribute('data-weapon') === this.selectedWeapon);
    });
    this.teamButtons.forEach((btn) => {
      const teamStr = btn.getAttribute('data-team');
      const active =
        (teamStr === 'pink' && this.selectedTeam === Team.PINK) ||
        (teamStr === 'cyan' && this.selectedTeam === Team.CYAN) ||
        (teamStr === 'auto' && this.selectedTeam === Team.NEUTRAL);
      btn.classList.toggle('active', active);
    });
    this.updateAvatarVisual();
  }

  private updateAvatarVisual(): void {
    if (!this.avatarImg || !this.avatarTag) return;
    if (this.selectedTeam === Team.PINK) {
      this.avatarImg.style.borderColor = '#ff007f';
      this.avatarTag.textContent = t('team.pink');
      this.avatarTag.style.background = '#ff007f';
      this.avatarTag.style.color = '#ffffff';
    } else if (this.selectedTeam === Team.CYAN) {
      this.avatarImg.style.borderColor = '#00ffff';
      this.avatarTag.textContent = t('team.cyan');
      this.avatarTag.style.background = '#00ffff';
      this.avatarTag.style.color = '#000000';
    } else {
      this.avatarImg.style.borderColor = '#ffaa00';
      this.avatarTag.textContent = t('lobby.auto');
      this.avatarTag.style.background = '#ffaa00';
      this.avatarTag.style.color = '#000000';
    }
    this.updateDock();
  }

  // ------------------------------------------------------------------
  // Tab navigation & feature setups
  // ------------------------------------------------------------------

  private setupTabs(): void {
    this.tabButtons = document.querySelectorAll('.lobby-tab-btn');
    this.tabPanes = document.querySelectorAll('.lobby-tab-pane');

    this.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) {
          this.switchTab(tab);
          lobbyAudio.playTabSwitch();
        }
      });
    });
  }

  public switchTab(tab: string): void {
    this.currentTab = tab;
    this.tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    this.tabPanes.forEach((pane) => {
      pane.classList.toggle('active', pane.id === `tab-pane-${tab}`);
    });
    this.lobby3D?.setTabFocus(tab);
    this.updateDock();
  }

  private setupLoadoutPresets(): void {
    try {
      const saved = localStorage.getItem('ink_arena_loadout_presets');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          this.presets = { ...this.presets, ...parsed };
        }
      }
    } catch {
      // ignore
    }

    this.presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const num = parseInt(btn.getAttribute('data-preset') || '1', 10);
        this.applyPreset(num);
        lobbyAudio.playClick();
      });
    });

    if (this.savePresetBtn) {
      this.savePresetBtn.addEventListener('click', () => {
        this.saveCurrentPreset();
        lobbyAudio.playClick();
      });
    }
  }

  private applyPreset(presetNum: number): void {
    this.currentPreset = presetNum;
    this.presetButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-preset') === `${presetNum}`);
    });

    const preset = this.presets[presetNum];
    if (!preset) return;

    if (preset.weapon && preset.weapon in WEAPON_CONFIGS) {
      this.selectedWeapon = preset.weapon;
      localStorage.setItem('ink_arena_weapon', preset.weapon);
      this.weaponOptions.forEach((o) => {
        o.classList.toggle('selected', o.getAttribute('data-weapon') === preset.weapon);
      });
      this.renderWeaponLoadoutPreview(preset.weapon);
      this.lobby3D?.setLocalPlayerLoadout(preset.weapon, this.selectedTeam);
      this.callbacks.onWeaponChanged(preset.weapon);
    }

    if (Array.isArray(preset.skills)) {
      this.selectedSkills = [...preset.skills].slice(0, MAX_SKILLS);
      localStorage.setItem('ink_arena_skills', JSON.stringify(this.selectedSkills));
      this.buildSkillGrid();
    }

    this.callbacks.onLobbyUpdate({
      weaponType: this.selectedWeapon,
      skills: [...this.selectedSkills]
    });
  }

  private saveCurrentPreset(): void {
    this.presets[this.currentPreset] = {
      weapon: this.selectedWeapon,
      skills: [...this.selectedSkills]
    };
    try {
      localStorage.setItem('ink_arena_loadout_presets', JSON.stringify(this.presets));
    } catch {
      // ignore
    }
    if (this.savePresetBtn) {
      const orig = this.savePresetBtn.textContent;
      this.savePresetBtn.textContent = `✅ ${t('lobby.presetSaved')}`;
      this.savePresetBtn.style.borderColor = '#00ff88';
      setTimeout(() => {
        if (this.savePresetBtn) {
          this.savePresetBtn.textContent = orig;
          this.savePresetBtn.style.borderColor = '';
        }
      }, 1500);
    }
  }

  private setupSplashtag(): void {
    try {
      const saved = localStorage.getItem('ink_arena_splashtag');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.prefix) this.splashtagPrefix = parsed.prefix;
        if (parsed.suffix) this.splashtagSuffix = parsed.suffix;
      }
    } catch {
      // ignore
    }

    if (this.splashtagPrefixSelect) {
      this.splashtagPrefixSelect.value = this.splashtagPrefix;
      this.splashtagPrefixSelect.addEventListener('change', () => {
        this.splashtagPrefix = this.splashtagPrefixSelect?.value || 'Supercharged';
        this.saveSplashtag();
      });
    }

    if (this.splashtagSuffixSelect) {
      this.splashtagSuffixSelect.value = this.splashtagSuffix;
      this.splashtagSuffixSelect.addEventListener('change', () => {
        this.splashtagSuffix = this.splashtagSuffixSelect?.value || 'Inker';
        this.saveSplashtag();
      });
    }

    this.updateSplashtagDisplay();
  }

  private saveSplashtag(): void {
    try {
      localStorage.setItem(
        'ink_arena_splashtag',
        JSON.stringify({ prefix: this.splashtagPrefix, suffix: this.splashtagSuffix })
      );
    } catch {
      // ignore
    }
    this.updateSplashtagDisplay();
  }

  private updateSplashtagDisplay(): void {
    if (this.splashtagPrefixEl) this.splashtagPrefixEl.textContent = this.splashtagPrefix;
    if (this.splashtagSuffixEl) this.splashtagSuffixEl.textContent = this.splashtagSuffix;
    if (this.splashtagNameEl) this.splashtagNameEl.textContent = this.playerName;
    if (this.splashtagHashEl) {
      const hash = this.playerName.split('').reduce((acc, c) => acc + c.charCodeAt(0), 1000) % 9000;
      this.splashtagHashEl.textContent = `#${hash}`;
    }
  }

  private setupCareerStats(): void {
    const matchesEl = document.getElementById('stat-matches');
    const winrateEl = document.getElementById('stat-winrate');
    const splatsEl = document.getElementById('stat-splats');
    const turfEl = document.getElementById('stat-turf');
    const favweaponEl = document.getElementById('stat-favweapon');

    try {
      const statsStr = localStorage.getItem('ink_arena_career_stats');
      const stats = statsStr
        ? JSON.parse(statsStr)
        : { matches: 52, winrate: '71.2%', splats: 348, turf: '21,580 m²', fav: 'Ink Blaster' };

      if (matchesEl) matchesEl.textContent = `${stats.matches}`;
      if (winrateEl) winrateEl.textContent = `${stats.winrate}`;
      if (splatsEl) splatsEl.textContent = `${stats.splats}`;
      if (turfEl) turfEl.textContent = `${stats.turf}`;
      if (favweaponEl) {
        const weaponCfg = WEAPON_CONFIGS[this.selectedWeapon];
        favweaponEl.textContent = weaponCfg ? locName(weaponCfg) : stats.fav;
      }
    } catch {
      // ignore
    }
  }

  private setupBotController(): void {
    if (this.addPinkBotBtn) {
      this.addPinkBotBtn.addEventListener('click', () => {
        lobbyAudio.playClick();
        this.callbacks.onAddBot(Team.PINK);
      });
    }
    if (this.addCyanBotBtn) {
      this.addCyanBotBtn.addEventListener('click', () => {
        lobbyAudio.playClick();
        this.callbacks.onAddBot(Team.CYAN);
      });
    }

    const launchPractice = () => {
      lobbyAudio.playStart();
      this.startSoloPractice();
    };

    this.soloPracticeBtn?.addEventListener('click', launchPractice);
    this.dockSoloBtn?.addEventListener('click', launchPractice);
  }

  private startSoloPractice(): void {
    const currentCount = this.lastLobbyState?.players.length ?? 1;
    const botsNeeded = Math.max(0, 8 - currentCount);

    // Alternate dispatch between Pink and Cyan
    for (let i = 0; i < botsNeeded; i++) {
      setTimeout(() => {
        const team = i % 2 === 0 ? Team.CYAN : Team.PINK;
        this.callbacks.onAddBot(team);
      }, i * 40);
    }

    // Set self ready
    this.isReady = true;
    if (this.readyBtn) {
      this.readyBtn.classList.add('is-ready');
      this.readyBtn.textContent = t('lobby.cancelReady');
    }
    this.callbacks.onLobbyUpdate({ ready: true });

    // Auto launch after bots populate
    setTimeout(() => {
      this.callbacks.onLobbyStart();
    }, 450);
  }

  private setupSettings(): void {
    if (this.sfxSlider) {
      const savedSfx = localStorage.getItem('ink_arena_sfx_vol');
      if (savedSfx) {
        this.sfxSlider.value = savedSfx;
        if (this.sfxVolVal) this.sfxVolVal.textContent = `${savedSfx}%`;
        lobbyAudio.setVolume(parseInt(savedSfx, 10) / 100);
      }
      this.sfxSlider.addEventListener('input', () => {
        const val = this.sfxSlider?.value || '80';
        if (this.sfxVolVal) this.sfxVolVal.textContent = `${val}%`;
        localStorage.setItem('ink_arena_sfx_vol', val);
        lobbyAudio.setVolume(parseInt(val, 10) / 100);
      });
    }
    if (this.bgmSlider) {
      const savedBgm = localStorage.getItem('ink_arena_bgm_vol');
      if (savedBgm) {
        this.bgmSlider.value = savedBgm;
        if (this.bgmVolVal) this.bgmVolVal.textContent = `${savedBgm}%`;
      }
      this.bgmSlider.addEventListener('input', () => {
        const val = this.bgmSlider?.value || '60';
        if (this.bgmVolVal) this.bgmVolVal.textContent = `${val}%`;
        localStorage.setItem('ink_arena_bgm_vol', val);
      });
    }
  }

  private updateDock(): void {
    if (this.dockTeamPill && this.dockTeamName) {
      this.dockTeamPill.className = `dock-team-pill ${
        this.selectedTeam === Team.PINK ? 'pink' : this.selectedTeam === Team.CYAN ? 'cyan' : 'neutral'
      }`;
      this.dockTeamName.textContent =
        this.selectedTeam === Team.PINK ? t('team.pink') : this.selectedTeam === Team.CYAN ? t('team.cyan') : t('lobby.auto');
    }

    const mode = this.currentMode ?? 'turf_war';
    const modeCfg = MODE_CONFIGS[mode];
    const modeName = modeCfg ? locName(modeCfg) : 'Turf War';

    const mapId = this.currentMapId ?? 'downtown';
    const mapDef = MAP_DEFS[mapId];
    const mapName = mapDef ? locName(mapDef) : 'Downtown Skyline';
    const mapMeta = MAP_METAS[mapId];

    if (this.dockModeSummary) this.dockModeSummary.textContent = modeName;
    if (this.dockMapSummary) this.dockMapSummary.textContent = mapName;

    if (this.hubModeName) this.hubModeName.textContent = modeName;
    if (this.hubMapName) this.hubMapName.textContent = mapName;
    if (this.hubMapTier && mapMeta) {
      const lang = getLang();
      this.hubMapTier.textContent = lang === 'zh' ? mapMeta.tiersZh : lang === 'ja' ? mapMeta.tiersJa : mapMeta.tiers;
    }
  }

  // ------------------------------------------------------------------
  // Generated UI blocks
  // ------------------------------------------------------------------

  private buildSkillGrid(): void {
    if (!this.skillGrid) return;
    this.skillGrid.innerHTML = '';
    for (const skill of SKILL_CONFIGS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'skill-chip';
      chip.setAttribute('data-skill', skill.id);
      if (this.selectedSkills.includes(skill.id)) chip.classList.add('selected');

      const icon = document.createElement('span');
      icon.className = 'skill-icon';
      icon.textContent = skill.icon;
      const label = document.createElement('span');
      label.className = 'skill-label';
      label.textContent = locName(skill);
      chip.appendChild(icon);
      chip.appendChild(label);
      chip.title = locDesc(skill);

      chip.addEventListener('click', () => {
        const idx = this.selectedSkills.indexOf(skill.id);
        if (idx >= 0) {
          this.selectedSkills.splice(idx, 1);
          chip.classList.remove('selected');
        } else {
          if (this.selectedSkills.length >= MAX_SKILLS) return;
          this.selectedSkills.push(skill.id);
          chip.classList.add('selected');
        }
        localStorage.setItem('ink_arena_skills', JSON.stringify(this.selectedSkills));
        this.updateSkillCount();
        this.callbacks.onLobbyUpdate({ skills: [...this.selectedSkills] });
      });

      this.skillGrid.appendChild(chip);
    }
    this.updateSkillCount();
  }

  private updateSkillCount(): void {
    if (this.skillCountEl) {
      this.skillCountEl.textContent = t('lobby.skillCount', { n: this.selectedSkills.length });
    }
  }

  private buildModeGrid(): void {
    if (!this.modeGrid) return;
    this.modeGrid.innerHTML = '';
    const lang = getLang();
    for (const mode of GAME_MODES) {
      const cfg = MODE_CONFIGS[mode];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      card.setAttribute('data-mode', mode);

      const icon = document.createElement('span');
      icon.className = 'mode-icon';
      icon.textContent = cfg.icon;

      const body = document.createElement('div');
      body.className = 'mode-card-body';

      const headerRow = document.createElement('div');
      headerRow.className = 'mode-header-row';

      const name = document.createElement('span');
      name.className = 'mode-name';
      name.textContent = locName(cfg);

      const activeBadge = document.createElement('span');
      activeBadge.className = 'mode-active-badge';
      activeBadge.textContent = 'ACTIVE';

      headerRow.appendChild(name);
      headerRow.appendChild(activeBadge);

      const winCond = document.createElement('div');
      winCond.className = 'mode-win-cond';
      const winPill = document.createElement('span');
      winPill.className = 'win-pill';
      winPill.textContent = 'WIN';
      const winText = document.createElement('span');
      winText.className = 'win-desc';
      winText.textContent = MODE_WIN_CONDITIONS[mode]?.[lang] ?? MODE_WIN_CONDITIONS[mode].en;
      winCond.appendChild(winPill);
      winCond.appendChild(winText);

      const desc = document.createElement('span');
      desc.className = 'mode-desc';
      desc.textContent = locDesc(cfg);

      body.appendChild(headerRow);
      body.appendChild(winCond);
      body.appendChild(desc);

      card.appendChild(icon);
      card.appendChild(body);

      card.addEventListener('click', () => {
        if (!this.isHost) return;
        if (!isValidGameMode(mode)) return;
        lobbyAudio.playModeSelect();
        this.callbacks.onMatchConfig({ mode });
      });

      this.modeGrid.appendChild(card);
    }
    this.highlightMode();
  }

  private highlightMode(): void {
    this.modeGrid?.querySelectorAll('.mode-card').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-mode') === this.currentMode);
    });
  }

  private buildMapGrid(): void {
    if (!this.mapGrid) return;
    this.mapGrid.innerHTML = '';
    const lang = getLang();
    for (const mapId of Object.keys(MAP_DEFS) as MapId[]) {
      const def = MAP_DEFS[mapId];
      const meta = MAP_METAS[mapId];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'map-card';
      card.setAttribute('data-map', mapId);

      const thumb = document.createElement('div');
      thumb.className = 'map-thumb';
      const a = `#${def.theme.accentA.toString(16).padStart(6, '0')}`;
      const b = `#${def.theme.accentB.toString(16).padStart(6, '0')}`;
      const g = `#${def.theme.groundBase.toString(16).padStart(6, '0')}`;
      thumb.style.background = `url('/assets/maps/${mapId}.jpg') center/cover no-repeat, radial-gradient(circle at 30% 30%, ${a}55, transparent 60%), radial-gradient(circle at 70% 70%, ${b}55, transparent 60%), ${g}`;

      const overlay = document.createElement('div');
      overlay.className = 'map-thumb-overlay';

      const scaleTag = document.createElement('span');
      scaleTag.className = 'map-scale-tag';
      scaleTag.textContent = meta.scale;

      const vertTag = document.createElement('span');
      vertTag.className = 'map-vert-tag';
      vertTag.textContent = `${meta.verticalityScore} ${meta.peakHeight}`;

      overlay.appendChild(scaleTag);
      overlay.appendChild(vertTag);
      thumb.appendChild(overlay);

      const info = document.createElement('div');
      info.className = 'map-card-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'map-name-row';
      const name = document.createElement('span');
      name.className = 'map-name';
      name.textContent = locName(def);
      const activeTag = document.createElement('span');
      activeTag.className = 'map-selected-tag';
      activeTag.textContent = 'DEPLOY';
      nameRow.appendChild(name);
      nameRow.appendChild(activeTag);

      const tiersRow = document.createElement('div');
      tiersRow.className = 'map-tiers-row';
      tiersRow.textContent = lang === 'zh' ? meta.tiersZh : lang === 'ja' ? meta.tiersJa : meta.tiers;

      const landmarksRow = document.createElement('div');
      landmarksRow.className = 'map-landmarks-row';
      landmarksRow.textContent = lang === 'zh' ? meta.landmarksZh : lang === 'ja' ? meta.landmarksJa : meta.landmarks;

      const recRow = document.createElement('div');
      recRow.className = 'map-rec-row';
      recRow.textContent = lang === 'zh' ? meta.recommendedZh : lang === 'ja' ? meta.recommendedJa : meta.recommended;

      info.appendChild(nameRow);
      info.appendChild(tiersRow);
      info.appendChild(landmarksRow);
      info.appendChild(recRow);

      card.appendChild(thumb);
      card.appendChild(info);

      card.addEventListener('click', () => {
        if (!this.isHost) return;
        lobbyAudio.playMapSelect();
        this.callbacks.onMatchConfig({ mapId });
      });

      this.mapGrid.appendChild(card);
    }
    this.highlightMap();
  }

  private highlightMap(): void {
    this.mapGrid?.querySelectorAll('.map-card').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-map') === this.currentMapId);
    });
  }

  /**
   * Renders the dynamic Weapon Loadout Showcase with live animated stat bars
   * (Range, Damage, Fire Rate, Mobility) and sub/special preview cards.
   */
  private renderWeaponLoadoutPreview(weapon: WeaponType): void {
    if (!this.weaponLoadoutPreviewEl) return;
    const cfg = WEAPON_CONFIGS[weapon];
    if (!cfg) return;
    const subCfg = SUB_WEAPON_CONFIGS[cfg.sub];
    const specCfg = SPECIAL_CONFIGS[cfg.special];
    const stats = WEAPON_STAT_VALS[weapon];
    const cat = WEAPON_CATEGORIES[weapon];
    const lang = getLang();

    const catLabel = lang === 'zh' ? cat.zh : lang === 'ja' ? cat.ja : cat.en;
    const mobLabel = lang === 'zh' ? stats.mobilityTier.zh : lang === 'ja' ? stats.mobilityTier.ja : stats.mobilityTier.en;

    const rangeLabel = lang === 'zh' ? '射程' : lang === 'ja' ? '射程' : 'Range';
    const damageLabel = lang === 'zh' ? '威力' : lang === 'ja' ? '攻撃力' : 'Damage';
    const rateLabel = lang === 'zh' ? '连射速度' : lang === 'ja' ? '連射力' : 'Fire Rate';
    const mobilityLabel = lang === 'zh' ? '机动性' : lang === 'ja' ? '機動性' : 'Mobility';
    const effLabel = lang === 'zh' ? '墨水效率' : lang === 'ja' ? 'インク効率' : 'Ink Efficiency';
    const effPct = Math.max(15, Math.min(100, Math.round(105 - (cfg.inkCost / 18) * 85)));

    this.weaponLoadoutPreviewEl.innerHTML = `
      <div class="loadout-preview-panel">
        <div class="preview-header">
          <div class="preview-title-row">
            <span class="preview-weapon-name">${locName(cfg)}</span>
            <span class="preview-category-badge">${catLabel}</span>
          </div>
          <p class="preview-weapon-desc">${locDesc(cfg)}</p>
        </div>

        <div class="preview-stats-grid">
          <div class="stat-bar-group">
            <div class="stat-bar-label">
              <span class="stat-title">${rangeLabel}</span>
              <span class="stat-val">${cfg.range}m · ${stats.rangePct}%</span>
            </div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill range" style="width: ${stats.rangePct}%"></div>
            </div>
          </div>

          <div class="stat-bar-group">
            <div class="stat-bar-label">
              <span class="stat-title">${damageLabel}</span>
              <span class="stat-val">${cfg.damage} DMG · ${stats.damagePct}%</span>
            </div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill damage" style="width: ${stats.damagePct}%"></div>
            </div>
          </div>

          <div class="stat-bar-group">
            <div class="stat-bar-label">
              <span class="stat-title">${rateLabel}</span>
              <span class="stat-val">${cfg.fireRate}/s · ${stats.fireRatePct}%</span>
            </div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill fire-rate" style="width: ${stats.fireRatePct}%"></div>
            </div>
          </div>

          <div class="stat-bar-group">
            <div class="stat-bar-label">
              <span class="stat-title">${mobilityLabel}</span>
              <span class="stat-val">${mobLabel} · ${stats.mobilityPct}%</span>
            </div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill mobility" style="width: ${stats.mobilityPct}%"></div>
            </div>
          </div>

          <div class="stat-bar-group stat-bar-group-wide">
            <div class="stat-bar-label">
              <span class="stat-title">${effLabel}</span>
              <span class="stat-val">${cfg.inkCost}% / shot · ${effPct}%</span>
            </div>
            <div class="stat-bar-track">
              <div class="stat-bar-fill ink-eff" style="width: ${effPct}%"></div>
            </div>
          </div>
        </div>

        <div class="preview-sub-spec-row">
          <div class="sub-spec-card sub">
            <div class="sub-spec-thumb">
              <img src="/assets/weapons/${cfg.sub}.jpg" alt="${locName(subCfg)}" onerror="this.src='/assets/weapons/splat_bomb.jpg'" />
            </div>
            <div class="sub-spec-info">
              <div class="sub-spec-header">
                <span class="sub-spec-type">[SUB]</span>
                <span class="sub-spec-name">${locName(subCfg)}</span>
                <span class="sub-spec-cost">${subCfg.inkCost}% INK</span>
              </div>
              <p class="sub-spec-desc">${locDesc(subCfg)}</p>
            </div>
          </div>

          <div class="sub-spec-card special">
            <div class="sub-spec-thumb">
              <img src="/assets/weapons/${cfg.special}.jpg" alt="${locName(specCfg)}" onerror="this.src='/assets/weapons/inkstrike.jpg'" />
            </div>
            <div class="sub-spec-info">
              <div class="sub-spec-header">
                <span class="sub-spec-type special-type">[SPECIAL]</span>
                <span class="sub-spec-name">${locName(specCfg)}</span>
                <span class="sub-spec-charge">100% GAUGE</span>
              </div>
              <p class="sub-spec-desc">${locDesc(specCfg)}</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private buildLangSwitch(): void {
    if (!this.langSwitch) return;
    this.langSwitch.innerHTML = '';
    for (const lang of LANGS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lang-btn';
      btn.setAttribute('data-lang', lang);
      btn.textContent = langLabel(lang);
      if (lang === getLang()) btn.classList.add('active');
      btn.addEventListener('click', () => {
        setLang(lang);
        this.langSwitch
          ?.querySelectorAll('.lang-btn')
          .forEach((b) => b.classList.toggle('active', b.getAttribute('data-lang') === getLang()));
        this.onLanguageChanged();
      });
      this.langSwitch.appendChild(btn);
    }
  }

  private onLanguageChanged(): void {
    applyI18n();
    this.applyLocalizedTexts();
    this.buildSkillGrid();
    this.buildModeGrid();
    this.buildMapGrid();
    this.renderWeaponLoadoutPreview(this.selectedWeapon);
    this.updateAvatarVisual();
    this.updateDock();
    this.updateSplashtagDisplay();
    this.setupCareerStats();
    if (this.lastLobbyState) this.updateLobbyState(this.lastLobbyState);
    renderCodex();
  }
  /** Localized weapon card texts. Called on construct & lang change. */
  private applyLocalizedTexts(): void {
    this.weaponOptions.forEach((opt) => {
      const weapon = opt.getAttribute('data-weapon') as WeaponType | null;
      if (!weapon || !(weapon in WEAPON_CONFIGS)) return;
      const cfg = WEAPON_CONFIGS[weapon];
      const nameEl = opt.querySelector('.opt-name');
      const zhEl = opt.querySelector('.opt-zh');
      const descEl = opt.querySelector('.opt-details');
      const subEl = opt.querySelector('.badge-sub');
      const specEl = opt.querySelector('.badge-spec');
      if (nameEl) nameEl.textContent = locName(cfg);
      if (zhEl) zhEl.textContent = getLang() === 'zh' ? cfg.nameJa : cfg.nameZh;
      if (descEl) descEl.textContent = locDesc(cfg);
      if (subEl) subEl.textContent = `${t('lobby.subBadge')}: ${locName(SUB_WEAPON_CONFIGS[cfg.sub])}`;
      if (specEl) specEl.textContent = `${t('lobby.specialBadge')}: ${locName(SPECIAL_CONFIGS[cfg.special])}`;
      const img = opt.querySelector('img');
      if (img) {
        img.alt = cfg.name;
        // Newer weapons have no thumbnail asset yet; fall back to a
        // theme-tinted plate instead of a broken image.
        if (!img.dataset.fallbackBound) {
          img.dataset.fallbackBound = '1';
          img.addEventListener('error', () => {
            img.style.visibility = 'hidden';
            const thumb = img.parentElement;
            if (thumb) thumb.classList.add('weapon-thumb-fallback');
          });
        }
      }
    });
  }

  /**
   * Builds one card per entry in WEAPON_CONFIGS, so adding a weapon to the
   * shared config is enough to make it selectable here. The static markup only
   * seeds the first card as a no-JS fallback.
   */
  private buildWeaponGrid(): void {
    const grid = document.querySelector('.weapon-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const weapon of Object.keys(WEAPON_CONFIGS) as WeaponType[]) {
      const cfg = WEAPON_CONFIGS[weapon];
      const card = document.createElement('div');
      card.className = 'weapon-option';
      card.setAttribute('data-weapon', weapon);
      if (weapon === this.selectedWeapon) card.classList.add('selected');

      const thumb = document.createElement('div');
      thumb.className = 'weapon-card-thumb';
      const img = document.createElement('img');
      img.src = WEAPON_THUMBS[weapon] ?? '/assets/weapons/splattershot.jpg';
      img.alt = cfg.name;
      img.addEventListener('error', () => {
        img.style.visibility = 'hidden';
        thumb.classList.add('weapon-thumb-fallback');
      });
      thumb.appendChild(img);

      const info = document.createElement('div');
      info.className = 'weapon-card-info';
      const header = document.createElement('div');
      header.className = 'opt-header';
      const name = document.createElement('span');
      name.className = 'opt-name';
      const alt = document.createElement('span');
      alt.className = 'opt-zh';
      header.appendChild(name);
      header.appendChild(alt);
      const details = document.createElement('div');
      details.className = 'opt-details';
      const skills = document.createElement('div');
      skills.className = 'opt-skills';
      const subBadge = document.createElement('span');
      subBadge.className = 'badge-sub';
      const specBadge = document.createElement('span');
      specBadge.className = 'badge-spec';
      skills.appendChild(subBadge);
      skills.appendChild(specBadge);
      info.appendChild(header);
      info.appendChild(details);
      info.appendChild(skills);

      card.appendChild(thumb);
      card.appendChild(info);
      grid.appendChild(card);
    }

    this.weaponOptions = document.querySelectorAll('.weapon-option');
    this.applyLocalizedTexts();
  }

  private setupEventListeners(): void {
    if (this.nameInput) {
      this.nameInput.addEventListener('change', () => {
        const val = this.nameInput.value.trim();
        if (val.length > 0) {
          this.playerName = val.substring(0, 16);
          localStorage.setItem('ink_arena_player_name', this.playerName);
          this.updateSplashtagDisplay();
          this.callbacks.onLobbyUpdate({ name: this.playerName });
        }
      });
    }

    this.weaponOptions.forEach((opt) => {
      opt.addEventListener('click', () => {
        const weapon = opt.getAttribute('data-weapon') as WeaponType;
        if (!weapon) return;
        this.selectedWeapon = weapon;
        localStorage.setItem('ink_arena_weapon', weapon);
        this.weaponOptions.forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        this.renderWeaponLoadoutPreview(weapon);
        this.lobby3D?.setLocalPlayerLoadout(weapon, this.selectedTeam);
        lobbyAudio.playWeaponSelect();
        this.callbacks.onWeaponChanged(weapon);
        this.callbacks.onLobbyUpdate({ weaponType: weapon });
      });
    });

    this.teamButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const teamStr = btn.getAttribute('data-team');
        let chosenTeam = Team.NEUTRAL;
        if (teamStr === 'pink') chosenTeam = Team.PINK;
        else if (teamStr === 'cyan') chosenTeam = Team.CYAN;

        this.selectedTeam = chosenTeam;
        localStorage.setItem('ink_arena_team', teamStr ?? 'auto');
        this.teamButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateAvatarVisual();
        this.lobby3D?.setLocalPlayerLoadout(this.selectedWeapon, chosenTeam);
        lobbyAudio.playClick();

        this.callbacks.onLobbyUpdate({ team: chosenTeam });
      });
    });

    if (this.readyBtn) {
      this.readyBtn.addEventListener('click', () => {
        this.isReady = !this.isReady;
        this.readyBtn.classList.toggle('is-ready', this.isReady);
        this.readyBtn.textContent = this.isReady ? t('lobby.cancelReady') : t('lobby.ready');
        lobbyAudio.playReady(this.isReady);
        this.readyBtn.classList.add('btn-press');
        setTimeout(() => this.readyBtn?.classList.remove('btn-press'), 150);
        this.callbacks.onLobbyUpdate({ ready: this.isReady });
      });
    }

    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => {
        lobbyAudio.playStart();
        this.startBtn.classList.add('btn-press');
        setTimeout(() => this.startBtn?.classList.remove('btn-press'), 150);
        this.callbacks.onLobbyStart();
      });
    }

    if (this.addBotBtn) {
      this.addBotBtn.addEventListener('click', () => {
        lobbyAudio.playClick();
        this.callbacks.onAddBot();
      });
    }
    if (this.removeBotBtn) {
      this.removeBotBtn.addEventListener('click', () => {
        lobbyAudio.playClick();
        this.callbacks.onRemoveBot();
      });
    }

    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => {
        lobbyAudio.playClick();
        this.callbacks.onReturnToTitle();
      });
    }

    if (this.returnLobbyBtn) {
      this.returnLobbyBtn.addEventListener('click', () => {
        lobbyAudio.playClick();
        const gameOverScreen = document.getElementById('game-over-screen');
        if (gameOverScreen) gameOverScreen.classList.add('hidden');
        this.show();
        this.isReady = false;
        if (this.readyBtn) {
          this.readyBtn.classList.remove('is-ready');
          this.readyBtn.textContent = t('lobby.ready');
        }
        this.callbacks.onLobbyUpdate({ ready: false });
      });
    }
  }

  private setupCodexModal(): void {
    const codexModal = document.getElementById('codex-modal');
    const openBtn = document.getElementById('btn-open-codex');
    const openBtnTitle = document.getElementById('btn-title-codex');
    const closeBtn = document.getElementById('btn-close-codex');
    const lightbox = document.getElementById('codex-lightbox');
    const lightboxImg = document.getElementById('lightbox-img') as HTMLImageElement | null;
    const lightboxClose = document.getElementById('lightbox-close');

    const open = () => {
      if (!codexModal) return;
      renderCodex();
      codexModal.classList.remove('hidden');
    };

    openBtn?.addEventListener('click', open);
    openBtnTitle?.addEventListener('click', open);
    closeBtn?.addEventListener('click', () => codexModal?.classList.add('hidden'));

    // Tab switching + lightbox use event delegation because panes re-render
    document.getElementById('codex-body')?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.codex-item');
      if (item && lightbox && lightboxImg) {
        const fullSrc = item.getAttribute('data-full');
        if (fullSrc) {
          lightboxImg.src = fullSrc;
          lightbox.classList.remove('hidden');
        }
      }
    });

    lightboxClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      lightbox?.classList.add('hidden');
    });

    lightbox?.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        lightbox.classList.add('hidden');
      }
    });
  }

  private setupAvatarUpload(): void {
    if (!this.avatarImg || !this.avatarFileInput) return;

    this.avatarImg.addEventListener('click', () => this.avatarFileInput?.click());

    this.avatarFileInput.addEventListener('change', () => {
      const file = this.avatarFileInput?.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        alert(t('lobby.avatarTooBig'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Downscale to 128×128 JPEG so localStorage stays small
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const scale = Math.max(128 / img.width, 128 / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          try {
            localStorage.setItem('ink_arena_avatar', dataUrl);
          } catch {
            // storage full — keep showing it for this session only
          }
          this.myAvatar = dataUrl;
          if (this.avatarImg) this.avatarImg.src = dataUrl;
          // Publish once so other players' rosters can show it. The server
          // ignores byte-identical repeats, and the thumbnail never rides the
          // 20 Hz snapshot path.
          this.callbacks.onLobbyUpdate({ avatar: dataUrl });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
      if (this.avatarFileInput) this.avatarFileInput.value = '';
    });

    const presetButtons = document.querySelectorAll('.avatar-preset-btn');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const src = btn.getAttribute('data-avatar-src');
        if (!src) return;
        this.setAvatarPreset(src);
      });
    });
  }

  public setAvatarPreset(src: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scale = Math.max(128 / img.width, 128 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      try {
        localStorage.setItem('ink_arena_avatar', dataUrl);
      } catch {
        // storage full
      }
      this.myAvatar = dataUrl;
      if (this.avatarImg) this.avatarImg.src = dataUrl;
      this.callbacks.onLobbyUpdate({ avatar: dataUrl });
    };
    img.src = src;
  }

  setMyPlayerId(id: string): void {
    this.myPlayerId = id;
    // Initial sync of profile. The avatar is re-published on every fresh
    // connection because the server does not persist it across reloads.
    this.callbacks.onLobbyUpdate({
      name: this.playerName,
      weaponType: this.selectedWeapon,
      team: this.selectedTeam,
      skills: [...this.selectedSkills],
      ready: this.isReady,
      avatar: this.myAvatar
    });
  }

  updateLobbyState(state: LobbyStatePayload): void {
    if (!state) return;

    // Cached so a language change can re-render the roster without waiting for
    // the next server snapshot (an idle lobby would otherwise stay in the old
    // language until someone joins or readies up).
    this.lastLobbyState = state;

    this.isHost = state.players.some((p) => p.id === this.myPlayerId && p.isHost);
    if (state.mode && state.mode !== this.currentMode) {
      this.currentMode = state.mode;
      this.highlightMode();
    }
    if (state.mapId && state.mapId !== this.currentMapId) {
      this.currentMapId = state.mapId;
      this.highlightMap();
    }
    this.updateHostControls();

    if (this.playerCountEl) {
      this.playerCountEl.textContent = `${state.players.length}`;
    }

    // Update 3D camera zoom based on player count
    if (this.lobby3D) {
      this.lobby3D.setPlayerCount(state.players.length);
    }

    if (this.countdownEl) {
      if (state.countdown > 0) {
        this.countdownEl.classList.remove('hidden');
        this.countdownEl.textContent = t('lobby.matchIn', { s: Math.ceil(state.countdown) });
      } else {
        this.countdownEl.classList.add('hidden');
      }
    }

    if (this.playerListEl) {
      this.playerListEl.innerHTML = '';
      state.players.forEach((p) => {
        const card = document.createElement('div');
        const teamClass = p.team === Team.PINK ? 'pink' : p.team === Team.CYAN ? 'cyan' : 'neutral';
        const isSelf = p.id === this.myPlayerId;
        card.className = `roster-item ${teamClass} ${isSelf ? 'self' : ''}`;

        // Cache whatever the server published; the payload only carries an
        // avatar when it changed, so a later roster render can still show it.
        const avatar = p.avatar ?? (isSelf ? this.myAvatar : this.avatarCache.get(p.id));
        if (p.avatar) this.avatarCache.set(p.id, p.avatar);

        const weaponCfg = WEAPON_CONFIGS[p.weaponType] ?? WEAPON_CONFIGS.shooter;
        const weaponLabel = locName(weaponCfg);
        const teamLabel =
          p.team === Team.PINK ? t('lobby.pink') : p.team === Team.CYAN ? t('lobby.cyan') : t('lobby.auto');
        const readyBadge = p.ready
          ? `<span class="ready-badge ready">${t('lobby.readyBadge')}</span>`
          : `<span class="ready-badge waiting">${t('lobby.waiting')}</span>`;
        const hostBadge = p.isHost ? `<span class="host-badge">${t('lobby.hostBadge')}</span>` : '';
        const botBadge = p.isBot ? `<span class="bot-badge">🤖 ${t('lobby.botBadge')}</span>` : '';

        // Avatar container with custom holographic border
        const avatarWrap = document.createElement('div');
        avatarWrap.className = `roster-avatar-wrap ${teamClass}`;
        const thumb = document.createElement('div');
        thumb.className = `roster-avatar ${teamClass}`;
        if (avatar) {
          const img = document.createElement('img');
          img.src = avatar;
          img.alt = '';
          thumb.appendChild(img);
        } else {
          const initial = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
          thumb.textContent = p.isBot ? '🤖' : initial;
        }
        avatarWrap.appendChild(thumb);

        // Weapon badge with thumbnail
        const weaponBadge = document.createElement('div');
        weaponBadge.className = 'roster-weapon-badge';
        weaponBadge.title = weaponLabel;
        const wImg = document.createElement('img');
        wImg.src = WEAPON_THUMBS[p.weaponType] ?? '/assets/weapons/splattershot.jpg';
        wImg.alt = weaponLabel;
        wImg.addEventListener('error', () => {
          wImg.style.visibility = 'hidden';
          weaponBadge.classList.add('weapon-thumb-fallback');
        });
        weaponBadge.appendChild(wImg);

        // Names and loadout summary
        const info = document.createElement('div');
        info.className = 'roster-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'roster-name-row';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'roster-name';
        nameSpan.textContent = p.name || t('lobby.inker');
        nameRow.appendChild(nameSpan);

        // Level & rank badge for player prestige
        const pLevel = isSelf ? 28 : (p.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 32) + 12;
        const rankTier = p.isBot ? 'B' : pLevel >= 28 ? 'S+' : pLevel >= 22 ? 'A+' : 'A';
        const rankBadge = document.createElement('span');
        rankBadge.className = `roster-rank-badge ${rankTier === 'S+' ? 'rank-s-plus' : ''}`;
        rankBadge.textContent = `${rankTier} · Lv.${pLevel}`;
        nameRow.appendChild(rankBadge);

        if (isSelf) {
          const youTag = document.createElement('span');
          youTag.className = 'roster-you-tag';
          youTag.textContent = t('lobby.you');
          nameRow.appendChild(youTag);
        }

        const subRow = document.createElement('div');
        subRow.className = 'roster-sub-row';
        const weaponName = document.createElement('span');
        weaponName.className = 'roster-weapon-name';
        weaponName.textContent = weaponLabel;
        subRow.appendChild(weaponName);

        if (isSelf) {
          const teamBtn = document.createElement('button');
          teamBtn.type = 'button';
          teamBtn.className = `roster-team-btn team-${teamClass}`;
          teamBtn.title = 'Switch team';
          teamBtn.innerHTML = `<span>${teamLabel}</span> <span class="team-cycle-icon">⇄</span>`;
          teamBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const NEXT_TEAM: Record<Team, Team> = {
              [Team.NEUTRAL]: Team.PINK,
              [Team.PINK]: Team.CYAN,
              [Team.CYAN]: Team.NEUTRAL
            };
            const nextTeam = NEXT_TEAM[this.selectedTeam] ?? Team.PINK;
            this.selectedTeam = nextTeam;
            const teamStr = nextTeam === Team.PINK ? 'pink' : nextTeam === Team.CYAN ? 'cyan' : 'auto';
            localStorage.setItem('ink_arena_team', teamStr);
            this.teamButtons.forEach((b) => {
              b.classList.toggle('active', b.getAttribute('data-team') === teamStr);
            });
            this.updateAvatarVisual();
            this.lobby3D?.setLocalPlayerLoadout(this.selectedWeapon, nextTeam);
            lobbyAudio.playClick();
            this.callbacks.onLobbyUpdate({ team: nextTeam });
          });
          subRow.appendChild(teamBtn);
        } else {
          const teamTag = document.createElement('span');
          teamTag.className = `roster-team-tag team-${teamClass}`;
          teamTag.textContent = teamLabel;
          subRow.appendChild(teamTag);
        }

        info.appendChild(nameRow);
        info.appendChild(subRow);

        // Status & Ping: dynamically reflect measured RTT latency from NetworkClient
        const livePing = this.callbacks.getPing?.();
        const basePing = typeof livePing === 'number' && livePing > 0 ? Math.round(livePing) : 12;
        const pingMs = p.isBot ? 1 : isSelf ? basePing : Math.max(14, basePing + ((p.id.charCodeAt(0) || 5) % 15));
        const pingSpan = document.createElement('span');
        pingSpan.className = 'roster-ping';
        pingSpan.innerHTML = `<span class="ping-signal"><i></i><i></i><i></i></span><span class="ping-text">${pingMs}ms</span>`;

        const status = document.createElement('div');
        status.className = 'roster-status';
        status.innerHTML = `${hostBadge}${botBadge}${readyBadge}`;
        status.appendChild(pingSpan);

        card.appendChild(avatarWrap);
        card.appendChild(weaponBadge);
        card.appendChild(info);
        card.appendChild(status);
        this.playerListEl.appendChild(card);
      });
    }

    // Host status controls
    const me = state.players.find((p) => p.id === this.myPlayerId);
    if (this.startBtn) {
      this.startBtn.style.display = me?.isHost ? 'block' : 'none';
    }

    const readyCount = state.players.filter((p) => p.ready).length;
    if (this.hubStatReady) {
      this.hubStatReady.textContent = `${readyCount}/${state.players.length}`;
    }
    this.updateDock();

    // If game has transitioned to match, hide lobby screen
    if (state.inMatch && !this.container.classList.contains('hidden')) {
      this.hide();
      this.callbacks.onRequestEnterArena();
    }
  }

  private updateHostControls(): void {
    for (const el of [this.addBotBtn, this.removeBotBtn]) {
      if (el) el.classList.toggle('disabled', !this.isHost);
    }
    this.modeGrid?.querySelectorAll('.mode-card').forEach((el) => {
      el.classList.toggle('disabled', !this.isHost);
    });
    this.mapGrid?.querySelectorAll('.map-card').forEach((el) => {
      el.classList.toggle('disabled', !this.isHost);
    });
  }

  show(): void {
    if (this.screens) this.screens.show('lobby');
    else this.container?.classList.remove('hidden');

    // Initialise the 3D lobby background on first show
    this.ensureLobby3D();
    this.startLivePingTimer();
  }

  hide(): void {
    // Stop the 3D scene and ping interval so we don't waste GPU / CPU on a hidden screen
    this.stopLobby3D();
    this.stopLivePingTimer();
    if (this.screens) this.screens.hide('lobby');
    else this.container?.classList.add('hidden');
  }

  private startLivePingTimer(): void {
    if (this.livePingInterval !== undefined) return;
    this.livePingInterval = window.setInterval(() => {
      if (!this.callbacks.getPing) return;
      const current = Math.round(this.callbacks.getPing());
      if (current <= 0) return;
      const selfPingEl = this.playerListEl?.querySelector('.roster-item.self .ping-text');
      if (selfPingEl) {
        selfPingEl.textContent = `${current}ms`;
      }
      if (this.dockPingVal) {
        this.dockPingVal.textContent = `${current}ms`;
      }
      if (this.hubStatPing) {
        this.hubStatPing.textContent = `${current}ms`;
      }
    }, 1000);
  }

  private stopLivePingTimer(): void {
    if (this.livePingInterval !== undefined) {
      clearInterval(this.livePingInterval);
      this.livePingInterval = undefined;
    }
  }

  isVisible(): boolean {
    if (this.screens) return this.screens.isVisible('lobby');
    return this.container && !this.container.classList.contains('hidden');
  }

  showCodex(): void {
    if (this.screens) this.screens.show('lobby');
    else this.container?.classList.remove('hidden');
    renderCodex();
    document.getElementById('codex-modal')?.classList.remove('hidden');
  }

  // -------------------------------------------------------------------
  // 3D lobby scene management
  // -------------------------------------------------------------------

  /**
   * Lazily creates the 3D Splatoon-style lobby scene and inserts a canvas
   * container behind the DOM lobby-card overlay.
   */
  private ensureLobby3D(): void {
    if (this.lobby3D) return;
    const host = this.container;
    if (!host) return;

    this.canvasContainer = document.createElement('div');
    this.canvasContainer.id = 'lobby-3d-canvas-container';
    this.canvasContainer.style.cssText =
      'position:absolute;inset:0;z-index:0;overflow:hidden;';
    host.insertBefore(this.canvasContainer, host.firstChild);

    this.lobby3D = new Lobby3D({
      container: this.canvasContainer,
      teamPinkHex: 0xff007f,
      teamCyanHex: 0x00ffff
    });
    this.lobby3D.setLocalPlayerLoadout(this.selectedWeapon, this.selectedTeam);

    const hint = document.createElement('div');
    hint.className = 'lobby-3d-hint';
    hint.innerHTML = `<span class="rotate-glyph">⟳</span> <span data-i18n="lobby.rotateHint">${t('lobby.rotateHint')}</span>`;
    this.canvasContainer.appendChild(hint);

    this.addSquidToggle();

    // Pass current player count so the camera zooms appropriately
    if (this.lastLobbyState) {
      this.lobby3D.setPlayerCount(this.lastLobbyState.players.length);
    }
  }

  /** Stops and removes the 3D scene (called from hide()). */
  private stopLobby3D(): void {
    this.lobby3D?.dispose();
    this.lobby3D = undefined;
    this.canvasContainer?.remove();
    this.canvasContainer = undefined;
  }

  /** Inserts the squid / humanoid form toggle button into the lobby header. */
  private addSquidToggle(): void {
    const existing = this.container?.querySelector<HTMLButtonElement>('#btn-squid-toggle');
    if (existing) return;

    const btn = document.createElement('button');
    btn.id = 'btn-squid-toggle';
    btn.className = 'btn-codex btn-squid-toggle';

    const updateLabel = (isSquid: boolean): void => {
      btn.classList.toggle('active', isSquid);
      const icon = isSquid ? '🦑' : '🧑';
      const key = isSquid ? 'lobby.squidModeActive' : 'lobby.humanModeActive';
      btn.innerHTML = `<span role="img" aria-label="squid">${icon}</span> <span data-i18n="${key}">${t(key)}</span>`;
    };

    updateLabel(this.lobby3D?.isSquidMode() ?? false);

    btn.addEventListener('click', (): void => {
      const nowSquid = this.lobby3D?.toggleSquidMode() ?? false;
      lobbyAudio.playClick();
      updateLabel(nowSquid);
    });

    const headerRight = this.container?.querySelector<HTMLElement>('.header-right');
    if (headerRight) {
      headerRight.insertBefore(btn, headerRight.firstChild);
    } else {
      this.container?.appendChild(btn);
    }
  }
}
