import { beforeEach, describe, expect, it } from 'vitest';
import { SFX_MAX_DISTANCE, SoundManager, panGainFor } from '../client/src/core/SoundManager.js';

/**
 * Stereo positional SFX tests.
 *
 * Direction convention is pinned here so a future refactor can never flip the
 * whole game's stereo image: camera yaw 0 looks toward -Z (ThreatAngle
 * convention), so a source at +X is screen-RIGHT and must pan > 0.9. A
 * hand-rolled cross(up, forward) "right" vector yields (-1,0,0) under this
 * camera and would invert everything while still passing self-consistent
 * tests — hence panGainFor reuses threatAngle and these cases pin it.
 */

// ---------------------------------------------------------------------------
// Pure function: panGainFor
// ---------------------------------------------------------------------------

describe('panGainFor direction convention (声像方向钉死)', () => {
  it('yaw=0 looks toward -Z: source at +X pans hard right', () => {
    const right = panGainFor(0, { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(right.pan).toBeGreaterThan(0.9);
    expect(right.muted).toBe(false);
  });

  it('source at -X pans hard left (guards against the cross-order inversion)', () => {
    const left = panGainFor(0, { x: 0, z: 0 }, { x: -10, z: 0 });
    expect(left.pan).toBeLessThan(-0.9);
  });

  it('source straight ahead is centred', () => {
    const ahead = panGainFor(0, { x: 0, z: 0 }, { x: 0, z: -10 });
    expect(Math.abs(ahead.pan)).toBeLessThan(0.05);
  });

  it('source directly behind is centred in pan but attenuated (front/back is gain, not pan)', () => {
    const behind = panGainFor(0, { x: 0, z: 0 }, { x: 0, z: 10 });
    expect(Math.abs(behind.pan)).toBeLessThan(0.05);
    expect(behind.gain).toBeLessThan(1);
    expect(behind.gain).toBeGreaterThan(0);
    expect(behind.muted).toBe(false);
  });

  it('gain strictly decreases with distance', () => {
    const gains = [3, 8, 15, 22, 30].map((d) => panGainFor(0, { x: 0, z: 0 }, { x: 0, z: -d }).gain);
    for (let i = 0; i < gains.length - 1; i++) {
      expect(gains[i]!).toBeGreaterThan(gains[i + 1]!);
    }
  });

  it('sources beyond 35u are muted', () => {
    const at35 = panGainFor(0, { x: 0, z: 0 }, { x: 0, z: -SFX_MAX_DISTANCE });
    expect(at35.muted).toBe(false);
    const beyond = panGainFor(0, { x: 0, z: 0 }, { x: 0, z: -(SFX_MAX_DISTANCE + 1) });
    expect(beyond.muted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full chain: SoundManager over a fake AudioContext
// ---------------------------------------------------------------------------

class FakeParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(): void {
    /* ramp shape not asserted */
  }
  linearRampToValueAtTime(): void {
    /* ramp shape not asserted */
  }
}

class FakeAudioNode {
  [key: string]: unknown;
  readonly inputs: FakeAudioNode[] = [];
  readonly outputs: FakeAudioNode[] = [];
  constructor(
    readonly ctx: FakeAudioContextBase,
    readonly kind: string,
    params: string[]
  ) {
    for (const name of params) {
      this[name] = new FakeParam();
    }
  }
  connect(dest: FakeAudioNode): FakeAudioNode {
    this.outputs.push(dest);
    dest.inputs.push(this);
    this.ctx.connectLog.push({ from: this, to: dest });
    return dest;
  }
  param(name: string): FakeParam {
    return this[name] as FakeParam;
  }
}

/**
 * Everything initContext() and the SFX synthesis paths touch — deliberately
 * NOT a "minimal" fake: createGain / createDynamicsCompressor /
 * createOscillator / createBiquadFilter / createBufferSource /
 * createBuffer / currentTime / sampleRate / state / resume / destination.
 * No createStereoPanner here: browsers without it take the legacy path.
 */
class FakeAudioContextBase {
  static latest: FakeAudioContextBase | null = null;

  readonly connectLog: { from: FakeAudioNode; to: FakeAudioNode }[] = [];
  readonly createdGains: FakeAudioNode[] = [];
  readonly createdPanners: FakeAudioNode[] = [];
  readonly destination = new FakeAudioNode(this, 'destination', []);
  readonly currentTime = 0;
  readonly sampleRate = 48000;
  readonly state = 'running';
  readonly compressorCount = { value: 0 };

  constructor() {
    FakeAudioContextBase.latest = this;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  createGain(): FakeAudioNode {
    const node = new FakeAudioNode(this, 'gain', ['gain']);
    this.createdGains.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeAudioNode {
    this.compressorCount.value++;
    return new FakeAudioNode(this, 'compressor', ['threshold', 'knee', 'ratio', 'attack', 'release']);
  }

  createOscillator(): FakeAudioNode {
    return new FakeAudioNode(this, 'oscillator', ['frequency', 'detune']);
  }

  createBiquadFilter(): FakeAudioNode {
    return new FakeAudioNode(this, 'biquadfilter', ['frequency', 'Q', 'detune']);
  }

  createBufferSource(): FakeAudioNode {
    return new FakeAudioNode(this, 'buffersource', ['playbackRate']);
  }

  createBuffer(_channels: number, size: number, _rate: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(size) };
  }
}

/** Browser-grade context: adds the StereoPanner the base fake lacks. */
class FakeAudioContext extends FakeAudioContextBase {
  override readonly createdPanners: FakeAudioNode[] = [];

  createStereoPanner(): FakeAudioNode {
    const node = new FakeAudioNode(this, 'stereopanner', ['pan']);
    this.createdPanners.push(node);
    return node;
  }
}

function injectAudio(Ctor: unknown): void {
  (globalThis as unknown as { window: unknown }).window = { AudioContext: Ctor };
}

/** The sfx bus is the 2nd createGain() in initContext (master, [compressor], sfx, bgm). */
function sfxBus(ctx: FakeAudioContextBase): FakeAudioNode {
  const bus = ctx.createdGains[1]!;
  expect(bus.kind).toBe('gain');
  return bus;
}

beforeEach(() => {
  FakeAudioContextBase.latest = null;
});

describe('sfxOut stereo branch (全链路 fake AudioContext)', () => {
  it('a positional remote shot creates a StereoPanner with the panGainFor pan and gain', () => {
    injectAudio(FakeAudioContext);
    const sm = new SoundManager();

    const camYaw = 0;
    const camPos = { x: 0, z: 0 };
    const source = { x: 12, z: -5 }; // right-front of the camera
    const expected = panGainFor(camYaw, camPos, source);
    expect(expected.muted).toBe(false);

    // This is the exact call Game.handleShotEvent makes for a remote shot.
    sm.playShoot({ pan: expected.pan, gain: expected.gain });

    const ctx = FakeAudioContextBase.latest as FakeAudioContext;
    expect(ctx.createdPanners.length).toBe(1);
    const panner = ctx.createdPanners[0]!;
    expect(panner.param('pan').value).toBeCloseTo(expected.pan, 10);

    // Chain: shot gain → panner → attenuation gain (=== pos.gain) → sfx bus.
    const bus = sfxBus(ctx);
    expect(bus.inputs.length).toBe(1);
    const atten = bus.inputs[0]!;
    expect(atten.kind).toBe('gain');
    expect(atten.param('gain').value).toBeCloseTo(expected.gain, 10);
    expect(atten.inputs.length).toBe(1);
    expect(atten.inputs[0]).toBe(panner);
  });

  it('a call without pos keeps the legacy path (no panner created, straight into the bus)', () => {
    injectAudio(FakeAudioContext);
    const sm = new SoundManager();

    sm.playShoot();

    const ctx = FakeAudioContextBase.latest as FakeAudioContext;
    expect(ctx.createdPanners.length).toBe(0); // all 37 legacy sfxOut(ctx) sites unaffected
    const bus = sfxBus(ctx);
    expect(bus.inputs.length).toBe(1); // shot gain connected straight to the bus
    expect(bus.inputs[0]!.kind).toBe('gain');
  });

  it('a context without createStereoPanner plays positional shots into the bus without throwing', () => {
    injectAudio(FakeAudioContextBase);
    const sm = new SoundManager();

    const source = { x: 8, z: -4 };
    const pos = panGainFor(0, { x: 0, z: 0 }, source);
    expect(() => sm.playShoot({ pan: pos.pan, gain: pos.gain })).not.toThrow();

    const ctx = FakeAudioContextBase.latest!;
    // Setup sanity: this fake genuinely has no panner capability.
    expect(typeof (ctx as unknown as Record<string, unknown>).createStereoPanner).toBe('undefined');
    // The voice still reaches the output bus: shot gain → sfxGain → compressor → master → destination.
    const bus = sfxBus(ctx);
    expect(bus.inputs.length).toBe(1);
    expect(bus.inputs[0]!.kind).toBe('gain');
    expect(bus.outputs[0]!.kind).toBe('compressor');
    expect(bus.outputs[0]!.outputs[0]!.kind).toBe('gain'); // master
    expect(bus.outputs[0]!.outputs[0]!.outputs[0]).toBe(ctx.destination);
  });
});
