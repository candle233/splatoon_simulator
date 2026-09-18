import { LobbyPlayerState, LobbyStatePayload, Team, WeaponType } from '@ink/shared';

export interface LobbyScreenCallbacks {
  onLobbyUpdate: (data: Partial<LobbyPlayerState>) => void;
  onLobbyStart: () => void;
  onWeaponChanged: (weapon: WeaponType) => void;
  onRequestEnterArena: () => void;
}

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

  private callbacks: LobbyScreenCallbacks;
  public playerName: string;
  public selectedWeapon: WeaponType = 'shooter';
  public selectedTeam: Team = Team.NEUTRAL; // auto-balance
  public isReady = false;
  private myPlayerId = '';

  constructor(callbacks: LobbyScreenCallbacks) {
    this.callbacks = callbacks;

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

    // Load persisted name or generate default
    const savedName = localStorage.getItem('ink_arena_player_name');
    this.playerName = savedName || `Squid_${Math.floor(1000 + Math.random() * 9000)}`;
    if (this.nameInput) {
      this.nameInput.value = this.playerName;
    }

    this.setupEventListeners();
    this.setupCodexModal();
  }

  private setupCodexModal(): void {
    const codexModal = document.getElementById('codex-modal');
    const openBtn = document.getElementById('btn-open-codex');
    const closeBtn = document.getElementById('btn-close-codex');
    const tabBtns = document.querySelectorAll('.codex-tab-btn');
    const panes = document.querySelectorAll('.codex-pane');
    const items = document.querySelectorAll('.codex-item');
    const lightbox = document.getElementById('codex-lightbox');
    const lightboxImg = document.getElementById('lightbox-img') as HTMLImageElement | null;
    const lightboxClose = document.getElementById('lightbox-close');

    if (openBtn && codexModal) {
      openBtn.addEventListener('click', () => {
        codexModal.classList.remove('hidden');
      });
    }

    if (closeBtn && codexModal) {
      closeBtn.addEventListener('click', () => {
        codexModal.classList.add('hidden');
      });
    }

    // Tab switching
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;

        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        panes.forEach((pane) => {
          if (pane.id === `codex-tab-${targetTab}`) {
            pane.classList.add('active');
          } else {
            pane.classList.remove('active');
          }
        });
      });
    });

    // Lightbox image preview
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const fullSrc = item.getAttribute('data-full');
        if (fullSrc && lightbox && lightboxImg) {
          lightboxImg.src = fullSrc;
          lightbox.classList.remove('hidden');
        }
      });
    });

    if (lightboxClose && lightbox) {
      lightboxClose.addEventListener('click', (e) => {
        e.stopPropagation();
        lightbox.classList.add('hidden');
      });
    }

    if (lightbox) {
      lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
          lightbox.classList.add('hidden');
        }
      });
    }
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
        this.teamButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Update profile avatar preview
        const avatarImg = document.getElementById('profile-avatar-img') as HTMLImageElement | null;
        const avatarTag = document.getElementById('profile-avatar-tag');
        if (avatarImg && avatarTag) {
          if (chosenTeam === Team.PINK) {
            avatarImg.src = '/assets/characters/inkling_pink.jpg';
            avatarImg.style.borderColor = '#ff007f';
            avatarTag.textContent = 'PINK';
            avatarTag.style.background = '#ff007f';
            avatarTag.style.color = '#ffffff';
          } else if (chosenTeam === Team.CYAN) {
            avatarImg.src = '/assets/characters/inkling_cyan.jpg';
            avatarImg.style.borderColor = '#00ffff';
            avatarTag.textContent = 'CYAN';
            avatarTag.style.background = '#00ffff';
            avatarTag.style.color = '#000000';
          } else {
            avatarImg.src = '/assets/characters/inkling_pink.jpg';
            avatarImg.style.borderColor = '#00ffff';
            avatarTag.textContent = 'AUTO';
            avatarTag.style.background = '#ffaa00';
            avatarTag.style.color = '#000000';
          }
        }

        this.callbacks.onLobbyUpdate({ team: chosenTeam });
      });
    });

    if (this.readyBtn) {
      this.readyBtn.addEventListener('click', () => {
        this.isReady = !this.isReady;
        this.readyBtn.classList.toggle('is-ready', this.isReady);
        this.readyBtn.textContent = this.isReady ? 'CANCEL READY' : 'READY!';
        this.callbacks.onLobbyUpdate({ ready: this.isReady });
      });
    }

    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => {
        this.callbacks.onLobbyStart();
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
          this.readyBtn.textContent = 'READY!';
        }
        this.callbacks.onLobbyUpdate({ ready: false });
      });
    }
  }

  setMyPlayerId(id: string): void {
    this.myPlayerId = id;
    // Initial sync of profile
    this.callbacks.onLobbyUpdate({
      name: this.playerName,
      weaponType: this.selectedWeapon,
      team: this.selectedTeam,
      ready: this.isReady
    });
  }

  updateLobbyState(state: LobbyStatePayload): void {
    if (!state) return;

    if (this.playerCountEl) {
      this.playerCountEl.textContent = `${state.players.length}`;
    }

    if (this.countdownEl) {
      if (state.countdown > 0) {
        this.countdownEl.classList.remove('hidden');
        this.countdownEl.textContent = `Match in ${Math.ceil(state.countdown)}s...`;
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

        const weaponLabel = p.weaponType.toUpperCase();
        const teamLabel = p.team === Team.PINK ? 'PINK' : p.team === Team.CYAN ? 'CYAN' : 'AUTO';
        const readyBadge = p.ready
          ? '<span class="ready-badge ready">READY</span>'
          : '<span class="ready-badge waiting">WAITING</span>';
        const hostBadge = p.isHost ? '<span class="host-badge">HOST</span>' : '';

        card.innerHTML = `
          <div class="roster-info">
            <span class="roster-name">${p.name || 'Inkling'} ${isSelf ? '(You)' : ''}</span>
            <span class="roster-sub">${weaponLabel} • [${teamLabel}]</span>
          </div>
          <div class="roster-status">
            ${hostBadge}
            ${readyBadge}
          </div>
        `;
        this.playerListEl.appendChild(card);
      });
    }

    // Host status controls
    const me = state.players.find((p) => p.id === this.myPlayerId);
    if (this.startBtn) {
      if (me?.isHost) {
        this.startBtn.style.display = 'block';
      } else {
        this.startBtn.style.display = 'none';
      }
    }

    // If game has transitioned to match, hide lobby screen
    if (state.inMatch && !this.container.classList.contains('hidden')) {
      this.hide();
      this.callbacks.onRequestEnterArena();
    }
  }

  show(): void {
    if (this.container) {
      this.container.classList.remove('hidden');
    }
  }

  hide(): void {
    if (this.container) {
      this.container.classList.add('hidden');
    }
  }

  isVisible(): boolean {
    return this.container && !this.container.classList.contains('hidden');
  }
}
