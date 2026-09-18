export interface SettingsConfig {
  mouseSensitivity: number; // 0.5 to 3.0, default 1.0
  fov: number; // 60 to 100, default 75
  sfxVolume: number; // 0 to 1, default 0.8
  bgmVolume: number; // 0 to 1, default 0.6
}

export interface SettingsCallbacks {
  onSensitivityChange: (val: number) => void;
  onFovChange: (val: number) => void;
  onSfxVolumeChange: (val: number) => void;
  onBgmVolumeChange: (val: number) => void;
  onSpawnBot?: () => void;
  onClearBots?: () => void;
}

export class SettingsModal {
  private modalEl: HTMLElement;
  private openBtn: HTMLElement | null;
  private closeBtn: HTMLElement | null;

  private sensSlider: HTMLInputElement;
  private sensValEl: HTMLElement;
  private fovSlider: HTMLInputElement;
  private fovValEl: HTMLElement;
  private sfxSlider: HTMLInputElement;
  private sfxValEl: HTMLElement;
  private bgmSlider: HTMLInputElement;
  private bgmValEl: HTMLElement;

  private spawnBotBtn: HTMLButtonElement | null;
  private clearBotsBtn: HTMLButtonElement | null;

  private callbacks: SettingsCallbacks;
  public config: SettingsConfig;

  constructor(callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;

    // Load persisted settings
    this.config = this.loadSettings();

    // Check if DOM element exists, else create
    let el = document.getElementById('settings-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'settings-modal';
      el.className = 'screen-overlay settings-overlay hidden';
      el.innerHTML = `
        <div class="settings-card">
          <div class="settings-header">
            <h2>GAME SETTINGS</h2>
            <button id="btn-close-settings" class="btn-close">&times;</button>
          </div>
          <div class="settings-body">
            <div class="setting-group">
              <div class="setting-label-row">
                <span>Mouse Sensitivity</span>
                <span id="val-sens">${this.config.mouseSensitivity.toFixed(1)}x</span>
              </div>
              <input id="slider-sens" type="range" min="0.2" max="3.0" step="0.1" value="${this.config.mouseSensitivity}" />
            </div>

            <div class="setting-group">
              <div class="setting-label-row">
                <span>Field of View (FOV)</span>
                <span id="val-fov">${this.config.fov}°</span>
              </div>
              <input id="slider-fov" type="range" min="60" max="100" step="1" value="${this.config.fov}" />
            </div>

            <div class="setting-group">
              <div class="setting-label-row">
                <span>SFX Volume</span>
                <span id="val-sfx">${Math.round(this.config.sfxVolume * 100)}%</span>
              </div>
              <input id="slider-sfx" type="range" min="0" max="1" step="0.05" value="${this.config.sfxVolume}" />
            </div>

            <div class="setting-group">
              <div class="setting-label-row">
                <span>BGM Music Volume</span>
                <span id="val-bgm">${Math.round(this.config.bgmVolume * 100)}%</span>
              </div>
              <input id="slider-bgm" type="range" min="0" max="1" step="0.05" value="${this.config.bgmVolume}" />
            </div>

            <hr class="settings-divider" />

            <div class="setting-group">
              <div class="setting-label-row">
                <span>Offline Practice Bots</span>
              </div>
              <div class="bot-btn-row">
                <button id="btn-spawn-bot" class="btn-setting-action">🤖 Add Practice Bot</button>
                <button id="btn-clear-bots" class="btn-setting-action danger">Clear Bots</button>
              </div>
            </div>
          </div>
          <div class="settings-footer">
            <button id="btn-save-settings" class="btn-primary">DONE</button>
          </div>
        </div>
      `;
      document.getElementById('game-container')?.appendChild(el);
    }
    this.modalEl = el;

    // Create gear toggle button in HUD if not exists
    let gear = document.getElementById('btn-open-settings');
    if (!gear) {
      gear = document.createElement('button');
      gear.id = 'btn-open-settings';
      gear.className = 'btn-hud-gear';
      gear.title = 'Settings [O]';
      gear.innerHTML = '⚙️';
      document.getElementById('hud')?.appendChild(gear);
    }
    this.openBtn = gear;

    this.closeBtn = document.getElementById('btn-close-settings');
    const saveBtn = document.getElementById('btn-save-settings');

    this.sensSlider = document.getElementById('slider-sens') as HTMLInputElement;
    this.sensValEl = document.getElementById('val-sens') as HTMLElement;
    this.fovSlider = document.getElementById('slider-fov') as HTMLInputElement;
    this.fovValEl = document.getElementById('val-fov') as HTMLElement;
    this.sfxSlider = document.getElementById('slider-sfx') as HTMLInputElement;
    this.sfxValEl = document.getElementById('val-sfx') as HTMLElement;
    this.bgmSlider = document.getElementById('slider-bgm') as HTMLInputElement;
    this.bgmValEl = document.getElementById('val-bgm') as HTMLElement;

    this.spawnBotBtn = document.getElementById('btn-spawn-bot') as HTMLButtonElement | null;
    this.clearBotsBtn = document.getElementById('btn-clear-bots') as HTMLButtonElement | null;

    this.setupListeners();
    saveBtn?.addEventListener('click', () => this.hide());
  }

  private loadSettings(): SettingsConfig {
    const defaultSettings: SettingsConfig = {
      mouseSensitivity: 1.0,
      fov: 75,
      sfxVolume: 0.8,
      bgmVolume: 0.6
    };
    try {
      const raw = localStorage.getItem('ink_arena_settings');
      if (raw) {
        return { ...defaultSettings, ...JSON.parse(raw) };
      }
    } catch {
      // Ignore
    }
    return defaultSettings;
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('ink_arena_settings', JSON.stringify(this.config));
    } catch {
      // Ignore
    }
  }

  private setupListeners(): void {
    this.openBtn?.addEventListener('click', () => this.show());
    this.closeBtn?.addEventListener('click', () => this.hide());

    // Key 'KeyO' opens settings
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyO' && !e.repeat) {
        this.toggle();
      }
    });

    this.sensSlider.addEventListener('input', () => {
      const val = parseFloat(this.sensSlider.value);
      this.config.mouseSensitivity = val;
      this.sensValEl.textContent = `${val.toFixed(1)}x`;
      this.callbacks.onSensitivityChange(val);
      this.saveSettings();
    });

    this.fovSlider.addEventListener('input', () => {
      const val = parseInt(this.fovSlider.value, 10);
      this.config.fov = val;
      this.fovValEl.textContent = `${val}°`;
      this.callbacks.onFovChange(val);
      this.saveSettings();
    });

    this.sfxSlider.addEventListener('input', () => {
      const val = parseFloat(this.sfxSlider.value);
      this.config.sfxVolume = val;
      this.sfxValEl.textContent = `${Math.round(val * 100)}%`;
      this.callbacks.onSfxVolumeChange(val);
      this.saveSettings();
    });

    this.bgmSlider.addEventListener('input', () => {
      const val = parseFloat(this.bgmSlider.value);
      this.config.bgmVolume = val;
      this.bgmValEl.textContent = `${Math.round(val * 100)}%`;
      this.callbacks.onBgmVolumeChange(val);
      this.saveSettings();
    });

    this.spawnBotBtn?.addEventListener('click', () => {
      this.callbacks.onSpawnBot?.();
    });

    this.clearBotsBtn?.addEventListener('click', () => {
      this.callbacks.onClearBots?.();
    });
  }

  show(): void {
    this.modalEl.classList.remove('hidden');
  }

  hide(): void {
    this.modalEl.classList.add('hidden');
  }

  toggle(): void {
    if (this.modalEl.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  isOpen(): boolean {
    return !this.modalEl.classList.contains('hidden');
  }
}
