import * as THREE from 'three';

export interface QualityProfile {
  /** Max device pixel ratio used for rendering. */
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Dynamic resolution scaling on FPS dips (quality=auto). */
  adaptive: boolean;
}

const QUALITY_PROFILES = {
  low: { pixelRatioCap: 0.75, shadows: false, shadowMapSize: 512, adaptive: false },
  medium: { pixelRatioCap: 1.0, shadows: true, shadowMapSize: 1024, adaptive: false },
  high: { pixelRatioCap: 2.0, shadows: true, shadowMapSize: 2048, adaptive: false },
  auto: { pixelRatioCap: 2.0, shadows: true, shadowMapSize: 2048, adaptive: true }
} as const satisfies Record<string, QualityProfile>;

export class GameRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private baseDirIntensity: number;

  private quality: QualityProfile = { ...QUALITY_PROFILES.high };
  /** Runtime resolution scale (dynamic resolution lowers this under load). */
  private resScale = 1;
  private fpsHistory: number[] = [];
  private lastAdaptAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1118);
    this.scene.fog = new THREE.FogExp2(0x0f1118, 0.007);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      260
    );

    // Lighting setup
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x222233, 0.75);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff5ea, 1.35);
    this.baseDirIntensity = this.dirLight.intensity;
    this.dirLight.position.set(40, 65, 30);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 200;
    const d = 72;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    const fillLight = new THREE.DirectionalLight(0x6688cc, 0.45);
    fillLight.position.set(-30, 40, -40);
    this.scene.add(fillLight);

    window.addEventListener('resize', this.onResize);
  }

  /** Applies a named quality level from the settings modal. */
  setQualityLevel(level: 'low' | 'medium' | 'high' | 'auto'): void {
    const profile = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.high;
    this.quality = { ...profile };
    this.resScale = 1;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.dirLight.castShadow = profile.shadows;
    if (profile.shadows) {
      this.dirLight.shadow.mapSize.width = profile.shadowMapSize;
      this.dirLight.shadow.mapSize.height = profile.shadowMapSize;
      this.dirLight.shadow.map?.dispose();
      this.dirLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.applyPixelRatio();
  }

  private applyPixelRatio(): void {
    const cap = Math.min(window.devicePixelRatio, this.quality.pixelRatioCap) * this.resScale;
    this.renderer.setPixelRatio(Math.max(0.5, cap));
  }

  /**
   * Dynamic resolution controller (quality=auto). Feed it the current FPS
   * once per frame; it scales the render resolution down under sustained
   * load and back up when there is headroom.
   */
  adaptiveTick(fps: number, nowMs: number): void {
    if (!this.quality.adaptive) return;
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 90) this.fpsHistory.shift();
    if (nowMs - this.lastAdaptAt < 2000) return;
    this.lastAdaptAt = nowMs;

    const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    if (avg < 45 && this.resScale > 0.7) {
      this.resScale = Math.max(0.7, this.resScale - 0.15);
      this.applyPixelRatio();
      this.fpsHistory.length = 0;
    } else if (avg > 57 && this.resScale < 1) {
      this.resScale = Math.min(1, this.resScale + 0.1);
      this.applyPixelRatio();
      this.fpsHistory.length = 0;
    }
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.applyPixelRatio();
  };

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Live WebGL counters for the debug hook / perf automation. `calls` is the
   * per-frame draw-call count, `triangles` the submitted triangle count and
   * `objects` the number of scene objects the renderer visited.
   */
  getRenderInfo(): {
    calls: number;
    triangles: number;
    objects: number;
    programs: number;
    geometries: number;
    textures: number;
    pixelRatio: number;
  } {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      objects: info.render.frame,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio()
    };
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  /** Theme support: lets maps retint the global lighting. */
  applyTheme(theme: { sky: number; fogColor: number; fogDensity: number; sunColor: number; sunIntensity: number; hemiSky: number; hemiGround: number }): void {
    (this.scene.background as THREE.Color).setHex(theme.sky);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(theme.fogColor);
      this.scene.fog.density = theme.fogDensity;
    }
    this.dirLight.color.setHex(theme.sunColor);
    this.dirLight.intensity = theme.sunIntensity * (this.baseDirIntensity / 1.35);
    this.hemiLight.color.setHex(theme.hemiSky);
    this.hemiLight.groundColor.setHex(theme.hemiGround);
  }
}
