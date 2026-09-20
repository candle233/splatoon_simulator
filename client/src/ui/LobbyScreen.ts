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
import type { ScreenManager } from './ScreenManager.js';

export interface LobbyScreenCallbacks {
  onLobbyUpdate: (
    data: Partial<{ name: string; team: Team; weaponType: WeaponType; skills: SkillId[]; ready: boolean; avatar?: string }>
  ) => void;
  onLobbyStart: () => void;
  onWeaponChanged: (weapon: WeaponType) => void;
  onRequestEnterArena: () => void;
  onMatchConfig: (config: { mode?: GameMode; mapId?: MapId }) => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
  /** Leave the lobby and go back to the title screen. */
  onReturnToTitle: () => void;
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
  sprayer: '/assets/weapons/splattershot.jpg',
  cannon: '/assets/weapons/splat_roller.jpg',
  marksman: '/assets/weapons/splat_charger.jpg',
  scatter: '/assets/weapons/slosher.jpg'
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

    this.setupEventListeners();
    this.setupCodexModal();
    this.setupAvatarUpload();

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
    for (const mode of GAME_MODES) {
      const cfg = MODE_CONFIGS[mode];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      card.setAttribute('data-mode', mode);

      const icon = document.createElement('span');
      icon.className = 'mode-icon';
      icon.textContent = cfg.icon;
      const name = document.createElement('span');
      name.className = 'mode-name';
      name.textContent = locName(cfg);
      const desc = document.createElement('span');
      desc.className = 'mode-desc';
      desc.textContent = locDesc(cfg);

      card.appendChild(icon);
      card.appendChild(name);
      card.appendChild(desc);

      card.addEventListener('click', () => {
        if (!this.isHost) return;
        if (!isValidGameMode(mode)) return;
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
    for (const mapId of Object.keys(MAP_DEFS) as MapId[]) {
      const def = MAP_DEFS[mapId];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'map-card';
      card.setAttribute('data-map', mapId);

      const thumb = document.createElement('div');
      thumb.className = 'map-thumb';
      const a = `#${def.theme.accentA.toString(16).padStart(6, '0')}`;
      const b = `#${def.theme.accentB.toString(16).padStart(6, '0')}`;
      const g = `#${def.theme.groundBase.toString(16).padStart(6, '0')}`;
      thumb.style.background = `radial-gradient(circle at 30% 30%, ${a}55, transparent 60%), radial-gradient(circle at 70% 70%, ${b}55, transparent 60%), ${g}`;

      const name = document.createElement('span');
      name.className = 'map-name';
      name.textContent = locName(def);
      const size = document.createElement('span');
      size.className = 'map-size';
      size.textContent = `${def.size}m`;

      card.appendChild(thumb);
      card.appendChild(name);
      card.appendChild(size);

      card.addEventListener('click', () => {
        if (!this.isHost) return;
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
    this.updateAvatarVisual();
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

        this.callbacks.onLobbyUpdate({ team: chosenTeam });
      });
    });

    if (this.readyBtn) {
      this.readyBtn.addEventListener('click', () => {
        this.isReady = !this.isReady;
        this.readyBtn.classList.toggle('is-ready', this.isReady);
        this.readyBtn.textContent = this.isReady ? t('lobby.cancelReady') : t('lobby.ready');
        this.callbacks.onLobbyUpdate({ ready: this.isReady });
      });
    }

    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => {
        this.callbacks.onLobbyStart();
      });
    }

    if (this.addBotBtn) {
      this.addBotBtn.addEventListener('click', () => this.callbacks.onAddBot());
    }
    if (this.removeBotBtn) {
      this.removeBotBtn.addEventListener('click', () => this.callbacks.onRemoveBot());
    }

    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => {
        // Local navigation only — leaving the lobby must not change the
        // player's ready state or send anything to the server.
        this.callbacks.onReturnToTitle();
      });
    }

    if (this.returnLobbyBtn) {
      this.returnLobbyBtn.addEventListener('click', () => {
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

        // names come from the roster; build with escaped text nodes
        const nameSpan = document.createElement('span');
        nameSpan.className = 'roster-name';
        nameSpan.textContent = `${p.name || t('lobby.inker')}${isSelf ? ` ${t('lobby.you')}` : ''}`;
        const subSpan = document.createElement('span');
        subSpan.className = 'roster-sub';
        subSpan.textContent = `${weaponLabel} • [${teamLabel}]`;

        const info = document.createElement('div');
        info.className = 'roster-info';
        info.appendChild(nameSpan);
        info.appendChild(subSpan);

        const status = document.createElement('div');
        status.className = 'roster-status';
        status.innerHTML = `${hostBadge}${botBadge}${readyBadge}`;

        // Thumbnail, or a team-tinted initial when the player has none.
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

        card.appendChild(thumb);
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
  }

  hide(): void {
    if (this.screens) this.screens.hide('lobby');
    else this.container?.classList.add('hidden');
  }

  isVisible(): boolean {
    if (this.screens) return this.screens.isVisible('lobby');
    return this.container && !this.container.classList.contains('hidden');
  }
}
