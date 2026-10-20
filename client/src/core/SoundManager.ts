/**
 * Procedural Web Audio sound manager.
 *
 * Mix architecture: every SFX routes into sfxGain, BGM into bgmGain, and both
 * feed a shared DynamicsCompressor before the destination so stacked voices
 * never clip into harsh distortion. Frequent combat sounds are throttled.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterVolume = 1.0;
  private sfxVolume = 0.7;
  private bgmVolume = 0.25;

  // BGM Sequencer state
  private isBgmRunning = false;
  private isSpeedUp = false;
  private currentStep = 0;
  private nextStepTime = 0;
  private schedulerTimer: number | null = null;

  private lastSwimTime = 0;
  private lastBurnTime = 0;
  private throttleMap = new Map<string, number>();

  constructor() {
    // Initialized lazily upon user interaction
  }

  private initContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();

        // Master output gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        // Gentle glue compressor: keeps stacked voices from clipping.
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -16;
        this.compressor.knee.value = 24;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.18;
        this.compressor.connect(this.masterGain);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
        this.sfxGain.connect(this.compressor);

        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
        this.bgmGain.connect(this.compressor);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private sfxOut(ctx: AudioContext): AudioNode {
    return this.sfxGain ?? this.compressor ?? this.masterGain ?? ctx.destination;
  }

  private bgmOut(ctx: AudioContext): AudioNode {
    return this.bgmGain ?? this.compressor ?? this.masterGain ?? ctx.destination;
  }

  /** True at most once per `minMs` for the given key; suppresses rapid-fire spam. */
  private throttled(key: string, minMs: number): boolean {
    const now = performance.now();
    const last = this.throttleMap.get(key);
    if (last !== undefined && now - last < minMs) return true;
    this.throttleMap.set(key, now);
    return false;
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
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
    if (this.throttled('shoot', 70)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(430, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1900, now);

      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Ignore audio synthesis errors on unsupported browsers
    }
  }

  /** Short downward thump when the local player is hit. Distinct from the hit-confirm ping. */
  playHurt(): void {
    if (this.throttled('hurt', 90)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Ignore audio synthesis errors on unsupported browsers
    }
  }

  /** Soft impact when landing from a jump or fall. Louder as `impact` approaches 1. */
  playLand(impact: number): void {
    if (this.throttled('land', 90)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;
    const amount = Math.max(0.15, Math.min(1, impact));

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90 + amount * 40, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.08);
      gain.gain.setValueAtTime(0.04 + amount * 0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {
      // Ignore audio synthesis errors on unsupported browsers
    }
  }

  playHit(): void {
    if (this.throttled('hit', 60)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1500, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.04);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

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
      filter.frequency.setValueAtTime(750, now);
      filter.frequency.linearRampToValueAtTime(200, now + 0.15);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  /** Player defeat / splat sound: deep sub-thump + squelchy ink dispersion + defeat slide */
  playPlayerDefeat(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;

      // 1. Sub-bass impact thump
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(95, now);
      subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.32);
      subGain.gain.setValueAtTime(0.22, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      subOsc.connect(subGain);
      subGain.connect(this.sfxOut(ctx));
      subOsc.start(now);
      subOsc.stop(now + 0.32);

      // 2. Heavy squelchy ink splash noise
      const bufSize = Math.floor(ctx.sampleRate * 0.28);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1100, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.28);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.25, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.sfxOut(ctx));
      noise.start(now);

      // 3. Descending synth defeat slide
      const slideOsc = ctx.createOscillator();
      const slideGain = ctx.createGain();
      slideOsc.type = 'triangle';
      slideOsc.frequency.setValueAtTime(360, now + 0.04);
      slideOsc.frequency.exponentialRampToValueAtTime(80, now + 0.38);
      slideGain.gain.setValueAtTime(0.12, now + 0.04);
      slideGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      slideOsc.connect(slideGain);
      slideGain.connect(this.sfxOut(ctx));
      slideOsc.start(now + 0.04);
      slideOsc.stop(now + 0.38);
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

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + duration);

      if (isStart) {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1174.66, now + 0.04); // D6 harmony
        gain2.gain.setValueAtTime(0.08, now + 0.04);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc2.connect(gain2);
        gain2.connect(this.sfxOut(ctx));
        osc2.start(now + 0.04);
        osc2.stop(now + 0.4);
      }
    } catch {
      // Ignore
    }
  }

  /** Match buzzer / final whistle: arcade dual-tone referee blast for time up */
  playCountdownBuzzer(): void {
    if (this.throttled('countdown_buzzer', 500)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const freqs = [440, 659.25];
      freqs.forEach((freq) => {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, now);

        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxOut(ctx));

        osc.start(now);
        osc.stop(now + 0.45);
      });
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

        gain.gain.setValueAtTime(0.08, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));

        osc.start(now + i * 0.08);
        osc.stop(now + 0.8);
      }
    } catch {
      // Ignore
    }
  }

  /** UI procedural sound: bubbly pop for button click / option switch */
  playUiClick(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(820, now + 0.04);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Ignore
    }
  }

  /** UI procedural sound: ascending cyber chime when player toggles Ready */
  playUiReady(isReady = true): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;
    try {
      const now = ctx.currentTime;
      const notes = isReady ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 493.88, 392.0];
      const step = isReady ? 0.05 : 0.06;
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + idx * step;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.09, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));
        osc.start(t0);
        osc.stop(t0 + 0.16);
      });
    } catch {
      // Ignore
    }
  }

  /** UI procedural sound: high-impact start horn / blast when match commences */
  playUiStart(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;
    try {
      const now = ctx.currentTime;
      const chords = [392.0, 523.25, 659.25, 783.99, 1046.5];
      chords.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + idx * 0.035;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));
        osc.start(t0);
        osc.stop(t0 + 0.35);
      });
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
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      const baseFreq = 800 + chargeLevel * 800;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.25);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, now);

      gain.gain.setValueAtTime(0.13 * chargeLevel + 0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

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

      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

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

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // Ignore
    }
  }

  playSprayerShot(): void {
    if (this.throttled('sprayer', 35)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.05);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2200, now);
      filter.Q.setValueAtTime(1.5, now);

      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Ignore
    }
  }

  playCannonShot(): void {
    if (this.throttled('cannon', 120)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(170, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.35);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.35);

      // Lowpass noise thump layer
      const bufSize = Math.floor(ctx.sampleRate * 0.18);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'lowpass';
      nFilter.frequency.setValueAtTime(320, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.12, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.sfxOut(ctx));
      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playMarksmanShot(): void {
    if (this.throttled('marksman', 75)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.12);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600, now);
      filter.Q.setValueAtTime(2.0, now);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Ignore
    }
  }

  playScatterShot(): void {
    if (this.throttled('scatter', 90)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.16);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.16);

      const bufSize = Math.floor(ctx.sampleRate * 0.12);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.11, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.sfxOut(ctx));
      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playRollerRoll(): void {
    if (this.throttled('roller_roll', 90)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.linearRampToValueAtTime(75, now + 0.1);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Ignore
    }
  }

  playChargeHum(level: number): void {
    if (this.throttled('charger_hum', 95)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const freq = 260 + Math.min(1.0, Math.max(0, level)) * 620;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq + 40, now + 0.12);
      const vol = 0.035 + Math.min(1.0, Math.max(0, level)) * 0.04;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Ignore
    }
  }

  playChargeFull(): void {
    if (this.throttled('charge_full', 250)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1350, now);
      osc.frequency.exponentialRampToValueAtTime(1850, now + 0.14);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.14);
    } catch {
      // Ignore
    }
  }

  playLowInkAlert(): void {
    if (this.throttled('low_ink_alert', 240)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      // High-urgency dual-tone electronic beep
      const notes = [920, 690];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + idx * 0.065;
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, t0);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.85, t0 + 0.05);

        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);

        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));

        osc.start(t0);
        osc.stop(t0 + 0.05);
      });
    } catch {
      // Ignore
    }
  }

  playInkReload(): void {
    if (this.throttled('ink_reload', 320)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Ignore
    }
  }

  playWeaponSwitch(): void {
    if (this.throttled('weapon_switch', 100)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      [0, 0.035].forEach((offset, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(idx === 0 ? 520 : 760, now + offset);
        osc.frequency.exponentialRampToValueAtTime(200, now + offset + 0.04);
        gain.gain.setValueAtTime(0.07, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.04);
        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));
        osc.start(now + offset);
        osc.stop(now + offset + 0.04);
      });
    } catch {
      // Ignore
    }
  }

  playSpecialReady(): void {
    if (this.throttled('special_ready', 1000)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      // Resonant 5-note radiant crystal fanfare: C5, E5, G5, C6, E6
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + idx * 0.055;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.09, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));
        osc.start(t0);
        osc.stop(t0 + 0.38);

        // Harmonic shimmer overtone
        const overtone = ctx.createOscillator();
        const oGain = ctx.createGain();
        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(freq * 2, t0);
        oGain.gain.setValueAtTime(0.035, t0);
        oGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
        overtone.connect(oGain);
        oGain.connect(this.sfxOut(ctx));
        overtone.start(t0);
        overtone.stop(t0 + 0.22);
      });
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

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Ignore
    }
  }

  playExplosion(): void {
    if (this.throttled('explosion', 90)) return;
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
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

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

        gain.gain.setValueAtTime(0.07, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));

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

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

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

      // 1. Resonant liquid bubble gulp
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.12);

      // 2. Squelchy ink plunge splash noise
      const bufSize = Math.floor(ctx.sampleRate * 0.1);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(480, now);
      filter.Q.setValueAtTime(2.0, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.05, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.sfxOut(ctx));
      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playSurface(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;

      // 1. Rising bubble pop
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(740, now + 0.1);
      gain.gain.setValueAtTime(0.085, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.1);

      // 2. High-frequency water droplet splash
      const bufSize = Math.floor(ctx.sampleRate * 0.08);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(880, now);
      filter.Q.setValueAtTime(2.5, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.04, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.sfxOut(ctx));
      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playSwim(): void {
    if (this.throttled('swim', 180)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;

      // 1. Fluid glide tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const f0 = 200 + Math.random() * 50;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, now + 0.1);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.1);

      // 2. Water churn noise burst
      const bufSize = Math.floor(ctx.sampleRate * 0.08);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(650, now);
      filter.Q.setValueAtTime(2.2, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.04, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.sfxOut(ctx));
      noise.start(now);
    } catch {
      // Ignore
    }
  }

  /** Wall-climb vertical suction splash: squid swimming up vertical climbable ink surfaces */
  playWallClimb(): void {
    if (this.throttled('wall_climb', 160)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;

      // 1. Rapid upward squelch chirp
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const baseFreq = 340 + Math.random() * 60;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.2, now + 0.09);
      gain.gain.setValueAtTime(0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));
      osc.start(now);
      osc.stop(now + 0.09);

      // 2. High-pass suction bubble pop
      const popOsc = ctx.createOscillator();
      const popFilter = ctx.createBiquadFilter();
      const popGain = ctx.createGain();
      popOsc.type = 'sine';
      popOsc.frequency.setValueAtTime(700, now);
      popOsc.frequency.exponentialRampToValueAtTime(1400, now + 0.06);
      popFilter.type = 'bandpass';
      popFilter.frequency.setValueAtTime(1200, now);
      popFilter.Q.setValueAtTime(3.0, now);
      popGain.gain.setValueAtTime(0.05, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      popOsc.connect(popFilter);
      popFilter.connect(popGain);
      popGain.connect(this.sfxOut(ctx));
      popOsc.start(now);
      popOsc.stop(now + 0.06);
    } catch {
      // Ignore
    }
  }

  playDryFire(): void {
    if (this.throttled('dryfire', 180)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(2400, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.025);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      osc.connect(gain);
      gain.connect(this.sfxOut(ctx));

      osc.start(now);
      osc.stop(now + 0.025);
    } catch {
      // Ignore
    }
  }

  playBurn(): void {
    if (this.throttled('burn', 260)) return;
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
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
      filter.frequency.setValueAtTime(2600, now);
      filter.Q.setValueAtTime(3, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxOut(ctx));

      noise.start(now);
    } catch {
      // Ignore
    }
  }

  playKillChime(): void {
    const ctx = this.initContext();
    if (!ctx || !this.enabled) return;

    try {
      const now = ctx.currentTime;
      const notes = [659.25, 830.61, 987.77, 1318.51]; // E5, G#5, B5, E6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.04);
        gain.gain.setValueAtTime(0.09, now + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.35);

        osc.connect(gain);
        gain.connect(this.sfxOut(ctx));

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

      const bpm = this.isSpeedUp ? 148 : 118;
      const secondsPerStep = (60 / bpm) / 4; // 16th note

      while (this.nextStepTime < this.ctx.currentTime + scheduleAheadTime) {
        const time = this.nextStepTime;
        const step = this.currentStep % 16;
        const dest = this.bgmOut(this.ctx);

        // 1. Kick Drum (on 0, 4, 8, 12)
        if (step % 4 === 0) {
          const kickOsc = this.ctx.createOscillator();
          const kickGain = this.ctx.createGain();
          kickOsc.frequency.setValueAtTime(120, time);
          kickOsc.frequency.exponentialRampToValueAtTime(34, time + 0.09);
          kickGain.gain.setValueAtTime(0.15, time);
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
          snareGain.gain.setValueAtTime(0.09, time);
          snareGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
          snareOsc.connect(snareGain);
          snareGain.connect(dest);
          snareOsc.start(time);
          snareOsc.stop(time + 0.08);
        }

        // 3. Hi-Hat (sparse: off-beats only)
        if (step % 4 === 2) {
          const hatOsc = this.ctx.createOscillator();
          const hatGain = this.ctx.createGain();
          hatOsc.type = 'square';
          hatOsc.frequency.setValueAtTime(7000 + (step % 4) * 500, time);
          hatGain.gain.setValueAtTime(0.016, time);
          hatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
          hatOsc.connect(hatGain);
          hatGain.connect(dest);
          hatOsc.start(time);
          hatOsc.stop(time + 0.02);
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
          bassFilter.frequency.setValueAtTime(700, time);
          bassFilter.frequency.exponentialRampToValueAtTime(140, time + secondsPerStep * 0.9);

          bassGain.gain.setValueAtTime(0.07, time);
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
          const octaveMult = this.isSpeedUp ? 1.5 : 1.0;
          const freq = leadScale[leadNoteIdx]! * octaveMult;
          leadOsc.frequency.setValueAtTime(freq, time);

          leadGain.gain.setValueAtTime(0.035, time);
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
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(gain);
            gain.connect(this.sfxOut(ctx));
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
