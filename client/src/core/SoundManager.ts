export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxVolume = 0.8;
  private bgmVolume = 0.5;

  // BGM Sequencer state
  private isBgmRunning = false;
  private isSpeedUp = false;
  private currentStep = 0;
  private nextStepTime = 0;
  private schedulerTimer: number | null = null;

  private lastSwimTime = 0;
  private lastBurnTime = 0;

  constructor() {
    // Initialized lazily upon user interaction
  }

  private initContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
        this.sfxGain.connect(this.ctx.destination);

        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
        this.bgmGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setSfxVolume(vol: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  setBgmVolume(vol: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, vol));
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
    }
  }

  playShoot(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Ignore audio synthesis errors on unsupported browsers
    }
  }

  playHit(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.04);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch {
      // Ignore
    }
  }

  playSplat(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      // White noise burst
      const bufferSize = Math.floor(ctx.sampleRate * 0.15);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.linearRampToValueAtTime(200, now + 0.15);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playCountdown(isStart = false): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      const freq = isStart ? 880 : 440;
      const duration = isStart ? 0.35 : 0.12;

      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Ignore
    }
  }

  playGameOver(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const freqs = [330, 440, 550, 660];
      for (let i = 0; i < freqs.length; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freqs[i]!, now + i * 0.08);

        gain.gain.setValueAtTime(0.12, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + i * 0.08);
        osc.stop(now + 0.8);
      }
    } catch {
      // Ignore
    }
  }

  playChargerShot(chargeLevel = 1.0): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      const baseFreq = 800 + chargeLevel * 800;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.25);

      gain.gain.setValueAtTime(0.25 * chargeLevel + 0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // Ignore
    }
  }

  playRollerFlick(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      // Ignore
    }
  }

  playBucket(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.linearRampToValueAtTime(300, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.2);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // Ignore
    }
  }

  playSubThrow(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Ignore
    }
  }

  playExplosion(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.35);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, now);
      filter.frequency.exponentialRampToValueAtTime(60, now + 0.35);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playSpecialActivate(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.5]; // C Major
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);

        gain.gain.setValueAtTime(0.12, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.06);
        osc.stop(now + 0.6);
      });
    } catch {
      // Ignore
    }
  }

  playRespawn(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // Ignore
    }
  }

  playSubmerge(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.1);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Ignore
    }
  }

  playSurface(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const dest = this.sfxGain || ctx.destination;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.1);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Ignore
    }
  }

  playSwim(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastSwimTime < 180) return;
    this.lastSwimTime = nowMs;

    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const dest = this.sfxGain || ctx.destination;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      const f0 = 240 + Math.random() * 60;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.5, now + 0.08);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Ignore
    }
  }

  playDryFire(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const dest = this.sfxGain || ctx.destination;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(3200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.025);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      osc.stop(now + 0.025);
    } catch {
      // Ignore
    }
  }

  playBurn(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBurnTime < 220) return;
    this.lastBurnTime = nowMs;

    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const dest = this.sfxGain || ctx.destination;
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.06);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2800, now);
      filter.Q.setValueAtTime(3, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playKillChime(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const dest = this.sfxGain || ctx.destination;
      const now = ctx.currentTime;
      const notes = [659.25, 830.61, 987.77, 1318.51]; // E5, G#5, B5, E6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.04);
        gain.gain.setValueAtTime(0.16, now + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.35);

        osc.connect(gain);
        gain.connect(dest);

        osc.start(now + idx * 0.04);
        osc.stop(now + idx * 0.04 + 0.35);
      });
    } catch {
      // Ignore
    }
  }

  startBGM(): void {
    const ctx = this.initContext();
    if (!ctx || this.isBgmRunning) return;

    this.isBgmRunning = true;
    this.currentStep = 0;
    this.nextStepTime = ctx.currentTime + 0.05;

    const lookahead = 25;
    const scheduleAheadTime = 0.1;

    const bassScale = [65.41, 77.78, 87.31, 98.0, 116.54]; // C2, D#2, F2, G2, A#2
    const leadScale = [261.63, 311.13, 349.23, 392.0, 466.16, 523.25]; // C4, Eb4, F4, G4, Bb4, C5

    const bassPattern = [0, -1, 0, 1, 2, -1, 3, 2, 0, -1, 4, 3, 2, 1, 0, 3];
    const leadPattern = [-1, 2, -1, 4, 5, 4, -1, 2, -1, 3, 5, -1, 4, 2, 1, 0];

    const scheduler = () => {
      if (!this.isBgmRunning || !this.ctx) return;

      const bpm = this.isSpeedUp ? 152 : 124;
      const secondsPerStep = (60 / bpm) / 4; // 16th note

      while (this.nextStepTime < this.ctx.currentTime + scheduleAheadTime) {
        const time = this.nextStepTime;
        const step = this.currentStep % 16;
        const dest = this.bgmGain || this.ctx.destination;

        // 1. Kick Drum (on 0, 4, 8, 12)
        if (step % 4 === 0) {
          const kickOsc = this.ctx.createOscillator();
          const kickGain = this.ctx.createGain();
          kickOsc.frequency.setValueAtTime(130, time);
          kickOsc.frequency.exponentialRampToValueAtTime(32, time + 0.09);
          kickGain.gain.setValueAtTime(0.24, time);
          kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
          kickOsc.connect(kickGain);
          kickGain.connect(dest);
          kickOsc.start(time);
          kickOsc.stop(time + 0.09);
        }

        // 2. Snare Drum (on 4, 12)
        if (step === 4 || step === 12) {
          const snareOsc = this.ctx.createOscillator();
          const snareGain = this.ctx.createGain();
          snareOsc.type = 'triangle';
          snareOsc.frequency.setValueAtTime(220, time);
          snareOsc.frequency.exponentialRampToValueAtTime(60, time + 0.08);
          snareGain.gain.setValueAtTime(0.15, time);
          snareGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
          snareOsc.connect(snareGain);
          snareGain.connect(dest);
          snareOsc.start(time);
          snareOsc.stop(time + 0.08);
        }

        // 3. Hi-Hat
        if (step % 2 === 0 || this.isSpeedUp) {
          const hatOsc = this.ctx.createOscillator();
          const hatGain = this.ctx.createGain();
          hatOsc.type = 'square';
          hatOsc.frequency.setValueAtTime(7000 + (step % 4) * 500, time);
          hatGain.gain.setValueAtTime(0.04, time);
          hatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
          hatOsc.connect(hatGain);
          hatGain.connect(dest);
          hatOsc.start(time);
          hatOsc.stop(time + 0.025);
        }

        // 4. Bassline
        const bassNoteIdx = bassPattern[step]!;
        if (bassNoteIdx >= 0) {
          const bassOsc = this.ctx.createOscillator();
          const bassFilter = this.ctx.createBiquadFilter();
          const bassGain = this.ctx.createGain();

          bassOsc.type = 'sawtooth';
          const freq = bassScale[bassNoteIdx]!;
          bassOsc.frequency.setValueAtTime(freq, time);

          bassFilter.type = 'lowpass';
          bassFilter.frequency.setValueAtTime(800, time);
          bassFilter.frequency.exponentialRampToValueAtTime(140, time + secondsPerStep * 0.9);

          bassGain.gain.setValueAtTime(0.13, time);
          bassGain.gain.exponentialRampToValueAtTime(0.001, time + secondsPerStep * 0.9);

          bassOsc.connect(bassFilter);
          bassFilter.connect(bassGain);
          bassGain.connect(dest);

          bassOsc.start(time);
          bassOsc.stop(time + secondsPerStep * 0.9);
        }

        // 5. Arpeggio / Lead
        const leadNoteIdx = leadPattern[step]!;
        if (leadNoteIdx >= 0) {
          const leadOsc = this.ctx.createOscillator();
          const leadGain = this.ctx.createGain();

          leadOsc.type = 'triangle';
          const octaveMult = this.isSpeedUp ? 2.0 : 1.0;
          const freq = leadScale[leadNoteIdx]! * octaveMult;
          leadOsc.frequency.setValueAtTime(freq, time);

          leadGain.gain.setValueAtTime(0.08, time);
          leadGain.gain.exponentialRampToValueAtTime(0.001, time + secondsPerStep * 0.7);

          leadOsc.connect(leadGain);
          leadGain.connect(dest);

          leadOsc.start(time);
          leadOsc.stop(time + secondsPerStep * 0.7);
        }

        this.nextStepTime += secondsPerStep;
        this.currentStep++;
      }

      this.schedulerTimer = window.setTimeout(scheduler, lookahead);
    };

    scheduler();
  }

  stopBGM(): void {
    this.isBgmRunning = false;
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  setSpeedUp(accelerated: boolean): void {
    if (this.isSpeedUp !== accelerated) {
      this.isSpeedUp = accelerated;
      if (accelerated) {
        const ctx = this.initContext();
        if (ctx) {
          try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, now);
            osc.frequency.linearRampToValueAtTime(880, now + 0.3);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(gain);
            gain.connect(this.sfxGain || ctx.destination);
            osc.start(now);
            osc.stop(now + 0.35);
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  // Subagent 68 Explicit Event API
  shoot(): void {
    this.playShoot();
  }

  hit(): void {
    this.playHit();
  }

  death(): void {
    this.playSplat();
  }

  respawn(): void {
    this.playRespawn();
  }

  submerge(): void {
    this.playSubmerge();
  }

  gameStart(): void {
    this.playCountdown(true);
  }

  gameOver(): void {
    this.playGameOver();
  }
}

export { SoundManager as AudioManager };
