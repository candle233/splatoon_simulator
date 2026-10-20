import * as THREE from 'three';
import { Team, WeaponType } from '@ink/shared';
import { createWeaponMesh } from '../combat/WeaponModels.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Lobby3DOptions {
  container: HTMLElement;
  teamPinkHex?: number;
  teamCyanHex?: number;
}

// ---------------------------------------------------------------------------
// Hash helper (deterministic scatter for decor placement)
// ---------------------------------------------------------------------------

function hash(seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h >>> 0) % 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Lobby3D – standalone Three.js scene for the Splatoon-style lobby
// ---------------------------------------------------------------------------

export class Lobby3D {
  /** The WebGL canvas attached to the DOM. */
  readonly canvas: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  /** Camera focus and orbit parameters */
  private focusPoint = new THREE.Vector3(0, 3.2, 0);
  private targetAzimuth = 0;
  private currentAzimuth = 0;
  private targetElevation = 0.16;
  private currentElevation = 0.16;
  private targetDistance = 7.0;
  private currentDist = 7.0;
  private targetFov = 48;
  private currentFov = 48;

  /** Interaction state */
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private idleTime = 0;

  /** All tracked resources for teardown. */
  private readonly meshes: THREE.Mesh[] = [];
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];
  private readonly particles: THREE.Points[] = [];
  private readonly animatedGroups: THREE.Group[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  /** Per-player character model groups (one per slot around the podium). */
  readonly characterSlots: THREE.Group[] = [];

  /** Slot 0 active loadout */
  private localWeapon: WeaponType = 'shooter';
  private localTeam: Team = Team.PINK;

  /** Whether characters are in squid (transformed) form. */
  squidMode = false;

  private animTime = 0;
  private lastFrameMs = 0;
  private isRunning = false;
  private rafId = 0;

  constructor(opts: Lobby3DOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'grab';
    opts.container.appendChild(this.canvas);

    const pinkHex = opts.teamPinkHex ?? 0xff007f;
    const cyanHex = opts.teamCyanHex ?? 0x00ffff;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(opts.container.clientWidth, opts.container.clientHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0716);
    this.scene.fog = new THREE.FogExp2(0x0c0716, 0.016);

    this.camera = new THREE.PerspectiveCamera(
      this.targetFov,
      opts.container.clientWidth / opts.container.clientHeight,
      0.2,
      200
    );
    this.camera.position.set(0, 4.3, 7.0);
    this.camera.lookAt(this.focusPoint);

    this.buildLights(pinkHex, cyanHex);
    this.buildPlatform();
    this.buildRamps();
    this.buildPodium();
    this.buildInkSplashes();
    this.buildBubbles();
    this.buildCharacterSlots();

    this.setupInteractions();

    window.addEventListener('resize', this.onResize);
    this.isRunning = true;
    this.lastFrameMs = performance.now();
    this.loop();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setPlayerCount(n: number): void {
    // Reveal squad slots based on connected count
    for (let i = 0; i < this.characterSlots.length; i++) {
      const slot = this.characterSlots[i];
      if (!slot) continue;
      if (i === 0) {
        slot.visible = true;
      } else if (i === 1) {
        slot.visible = n >= 2;
      } else if (i === 2) {
        slot.visible = n >= 3;
      } else {
        slot.visible = n >= 4;
      }
    }

    if (n >= 4) {
      this.targetDistance = 8.2;
    } else if (n === 3) {
      this.targetDistance = 7.5;
    } else {
      this.targetDistance = 6.4;
    }
  }

  toggleSquidMode(): boolean {
    this.squidMode = !this.squidMode;
    return this.squidMode;
  }

  isSquidMode(): boolean {
    return this.squidMode;
  }

  /**
   * Updates the center showcase character (Slot 0) with weapon model,
   * holding pose, and team colors.
   */
  setLocalPlayerLoadout(weapon: WeaponType, team: Team): void {
    this.localWeapon = weapon;
    this.localTeam = team;
    const slot0 = this.characterSlots[0];
    if (slot0) {
      this.rebuildCharacter(slot0, 0, weapon, team);
    }
  }

  /**
   * Smoothly adjusts camera focal length, distance and angle depending on the active tab.
   */
  setTabFocus(tab: string): void {
    if (tab === 'armory') {
      // Zoom into weapon and hands
      this.focusPoint.set(0.4, 2.7, 0);
      this.targetDistance = 4.8;
      this.targetElevation = 0.12;
      this.targetFov = 42;
    } else if (tab === 'profile') {
      // Frame upper body and portrait
      this.focusPoint.set(0, 3.4, 0);
      this.targetDistance = 5.0;
      this.targetElevation = 0.14;
      this.targetFov = 40;
    } else if (tab === 'modes') {
      // High-angle wide overview of the arena platform
      this.focusPoint.set(0, 2.5, 0);
      this.targetDistance = 8.8;
      this.targetElevation = 0.28;
      this.targetFov = 52;
    } else {
      // Normal hub / room / settings view
      this.focusPoint.set(0, 3.2, 0);
      this.targetDistance = 6.8;
      this.targetElevation = 0.16;
      this.targetFov = 48;
    }
  }

  dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.removeInteractions();

    for (const m of this.meshes) m.geometry.dispose();
    for (const im of this.instancedMeshes) {
      im.geometry.dispose();
      if (Array.isArray(im.material)) {
        for (const mat of im.material) mat.dispose();
      } else {
        im.material.dispose();
      }
    }
    for (const p of this.particles) p.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const geo of this.geometries) geo.dispose();

    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  // ------------------------------------------------------------------
  // Interactive Orbit Controls (Mouse Drag & Wheel Zoom)
  // ------------------------------------------------------------------

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private removeInteractions(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Only primary mouse button or touch
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.isDragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.idleTime = 0;
    this.canvas.style.cursor = 'grabbing';
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.targetAzimuth += dx * 0.0075;
    this.targetElevation = Math.max(-0.12, Math.min(0.55, this.targetElevation - dy * 0.0055));
    this.idleTime = 0;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isDragging) {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.targetDistance = Math.max(4.8, Math.min(13.0, this.targetDistance + e.deltaY * 0.008));
    this.idleTime = 0;
  };

  // ------------------------------------------------------------------
  // Render loop
  // ------------------------------------------------------------------

  private loop = (): void => {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;
    this.animTime += dt;

    this.updateCamera(dt);
    this.animatePlatform(dt);
    this.animateCharacters(dt);
    this.animateBubbles(dt);

    this.renderer.render(this.scene, this.camera);
  };

  // ------------------------------------------------------------------
  // Lights
  // ------------------------------------------------------------------

  private buildLights(pinkHex: number, cyanHex: number): void {
    const hemi = new THREE.HemisphereLight(0x2a1540, 0x0a0a14, 0.65);
    this.scene.add(hemi);

    // Front high key light
    const key = new THREE.DirectionalLight(0xfff4e8, 1.15);
    key.position.set(0, 14, 10);
    this.scene.add(key);

    // Spotlight directly down on the center showcase podium
    const spot = new THREE.SpotLight(0xffffff, 2.4, 25, Math.PI / 4, 0.4, 1.2);
    spot.position.set(0, 8.5, 2.5);
    spot.target.position.set(0, 2.5, 0);
    this.scene.add(spot);
    this.scene.add(spot.target);

    // Strong rim backlight behind the character for neon silhouette glow
    const rim = new THREE.DirectionalLight(0xff007f, 1.4);
    rim.position.set(0, 5, -6);
    this.scene.add(rim);

    // Team Pink stage fill light
    const pinkLight = new THREE.PointLight(pinkHex, 2.8, 45);
    pinkLight.position.set(-14, 6, 2);
    this.scene.add(pinkLight);
    this.animatedGroups.push(new THREE.Group().add(pinkLight));

    // Team Cyan stage fill light
    const cyanLight = new THREE.PointLight(cyanHex, 2.8, 45);
    cyanLight.position.set(14, 6, 2);
    this.scene.add(cyanLight);

    // Soft ambient
    const ambient = new THREE.AmbientLight(0x221a33, 0.45);
    this.scene.add(ambient);
  }

  // ------------------------------------------------------------------
  // Ink-drenched circular platform
  // ------------------------------------------------------------------

  private buildPlatform(): void {
    const R = 22;
    const seg = 48;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.trackGeo(geo);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x140820,
      roughness: 0.35,
      metalness: 0.2
    });
    this.trackMat(mat);
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this.meshes.push(mesh);

    // Secondary glossy ink puddle layer
    const puddleGeo = new THREE.PlaneGeometry(R * 1.5, R * 1.5, 24, 24);
    puddleGeo.rotateX(-Math.PI / 2);
    this.trackGeo(puddleGeo);
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x220638,
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: 0.6
    });
    this.trackMat(puddleMat);
    const puddle = new THREE.Mesh(puddleGeo, puddleMat);
    puddle.position.y = 0.02;
    this.scene.add(puddle);
    this.meshes.push(puddle);
  }

  private animatePlatform(_dt: number): void {
    const mesh = this.meshes[0];
    if (!mesh || !(mesh.geometry.attributes.position)) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    const t = this.animTime;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.sqrt(x * x + z * z);
      const wave = Math.sin(dist * 0.35 - t * 1.2) * 0.05
        + Math.sin(dist * 0.18 + t * 0.7) * 0.03;
      pos.setY(i, wave);
    }
    pos.needsUpdate = true;
  }

  // ------------------------------------------------------------------
  // Entrance ramps
  // ------------------------------------------------------------------

  private buildRamps(): void {
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x26123a,
      roughness: 0.55,
      metalness: 0.25
    });
    this.trackMat(rampMat);

    const positions = [
      { x: 0, z: -24, ry: 0 },
      { x: 0, z: 24, ry: Math.PI },
      { x: -24, z: 0, ry: Math.PI / 2 },
      { x: 24, z: 0, ry: -Math.PI / 2 }
    ];

    for (const { x, z, ry } of positions) {
      const geo = new THREE.BufferGeometry();
      const len = 10, width = 4.2, rise = 2.8;
      const verts = new Float32Array([
        -len / 2, 0, -width / 2,
         len / 2, 0, -width / 2,
        -len / 2, 0,  width / 2,
         len / 2, 0,  width / 2,
        -len / 2, rise, -width / 2,
         len / 2, rise, -width / 2,
        -len / 2, rise,  width / 2,
         len / 2, rise,  width / 2
      ]);
      const idx = [
        0, 1, 2, 1, 3, 2,
        4, 6, 5, 5, 6, 7,
        0, 2, 4, 4, 2, 6,
        1, 5, 3, 5, 7, 3,
        0, 4, 1, 1, 4, 5,
        2, 3, 6, 3, 7, 6
      ];
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      this.trackGeo(geo);

      const mesh = new THREE.Mesh(geo, rampMat.clone());
      this.trackMat(mesh.material);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = ry;
      this.scene.add(mesh);
      this.meshes.push(mesh);

      const edgeGeo = new THREE.BoxGeometry(len + 0.2, 0.08, 0.12);
      this.trackGeo(edgeGeo);
      const edgeMat = new THREE.MeshStandardMaterial({
        color: 0xff007f,
        emissive: 0xff007f,
        emissiveIntensity: 0.6,
        roughness: 0.3
      });
      this.trackMat(edgeMat);
      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      edge.position.set(x, rise + 0.04, z);
      edge.rotation.y = ry;
      this.scene.add(edge);
      this.meshes.push(edge);
    }
  }

  // ------------------------------------------------------------------
  // Center podium
  // ------------------------------------------------------------------

  private buildPodium(): void {
    const baseGeo = new THREE.CylinderGeometry(4.6, 5.2, 0.7, 32);
    this.trackGeo(baseGeo);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1b0d2a,
      roughness: 0.4,
      metalness: 0.4
    });
    this.trackMat(baseMat);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.35;
    this.scene.add(base);
    this.meshes.push(base);

    const colGeo = new THREE.CylinderGeometry(3.0, 3.4, 1.6, 28);
    this.trackGeo(colGeo);
    const colMat = new THREE.MeshStandardMaterial({
      color: 0x220c38,
      roughness: 0.35,
      metalness: 0.5
    });
    this.trackMat(colMat);
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.y = 1.4;
    this.scene.add(col);
    this.meshes.push(col);

    // Top display disc
    const discGeo = new THREE.CylinderGeometry(3.8, 3.8, 0.25, 36);
    this.trackGeo(discGeo);
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x32124f,
      emissive: 0x180628,
      emissiveIntensity: 0.35,
      roughness: 0.22,
      metalness: 0.55
    });
    this.trackMat(discMat);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 2.32;
    this.scene.add(disc);
    this.meshes.push(disc);

    // Glowing cyan/pink neon ring around disc edge
    const ringGeo = new THREE.TorusGeometry(3.8, 0.12, 10, 48);
    this.trackGeo(ringGeo);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 1.4,
      roughness: 0.15
    });
    this.trackMat(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 2.48;
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.meshes.push(ring);

    // Center hero spotlight disk
    const centerSpotGeo = new THREE.CircleGeometry(1.4, 32);
    centerSpotGeo.rotateX(-Math.PI / 2);
    this.trackGeo(centerSpotGeo);
    const centerSpotMat = new THREE.MeshBasicMaterial({
      color: 0xff007f,
      transparent: true,
      opacity: 0.35
    });
    this.trackMat(centerSpotMat);
    const centerSpot = new THREE.Mesh(centerSpotGeo, centerSpotMat);
    centerSpot.position.set(0, 2.46, 0.35);
    this.scene.add(centerSpot);
    this.meshes.push(centerSpot);
  }

  // ------------------------------------------------------------------
  // Ink splash decals
  // ------------------------------------------------------------------

  private buildInkSplashes(): void {
    const splashColors = [0xff007f, 0x00ffff, 0x8800cc, 0x0088cc, 0xff3399, 0x33cccc];
    const count = 28;

    for (let i = 0; i < count; i++) {
      const angle = hash(i * 7 + 3) * Math.PI * 2;
      const radius = 6 + hash(i * 13 + 7) * 14;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const r = 0.6 + hash(i * 31 + 1) * 2.4;
      const color = splashColors[i % splashColors.length]!;

      const geo = new THREE.RingGeometry(r * 0.6, r, 16);
      geo.rotateX(-Math.PI / 2);
      this.trackGeo(geo);

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28 + hash(i * 17) * 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.trackMat(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.04, z);
      mesh.rotation.z = hash(i * 41) * Math.PI * 2;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  // ------------------------------------------------------------------
  // Floating ink bubbles
  // ------------------------------------------------------------------

  private bubbleData: { baseX: number; baseY: number; baseZ: number; phase: number; speed: number; scale: number; color: number }[] = [];

  private buildBubbles(): void {
    const count = 35;
    const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
    this.trackGeo(bubbleGeo);

    const colors = [0xff007f, 0x00ffff, 0xaa00ff, 0x00aaff, 0xff33aa, 0x33ffff];

    for (let i = 0; i < count; i++) {
      const angle = hash(i * 11) * Math.PI * 2;
      const radius = 3 + hash(i * 23) * 16;
      const baseX = Math.cos(angle) * radius;
      const baseZ = Math.sin(angle) * radius;
      const baseY = 0.5 + hash(i * 37) * 10;
      const scale = 0.12 + hash(i * 53) * 0.34;
      const speed = 0.3 + hash(i * 61) * 0.6;
      const phase = hash(i * 71) * Math.PI * 2;
      const color = colors[i % colors.length]!;

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
      this.trackMat(mat);
      const mesh = new THREE.Mesh(bubbleGeo, mat);
      mesh.scale.setScalar(scale);
      mesh.position.set(baseX, baseY, baseZ);
      this.scene.add(mesh);
      this.meshes.push(mesh);

      this.bubbleData.push({ baseX, baseY, baseZ, phase, speed, scale, color });
    }
  }

  private animateBubbles(_dt: number): void {
    const t = this.animTime;
    for (let i = 0; i < this.bubbleData.length; i++) {
      const b = this.bubbleData[i];
      if (!b) continue;
      const mesh = this.meshes[this.meshes.length - this.bubbleData.length + i];
      if (!mesh) continue;
      const y = b.baseY + ((t * b.speed + b.phase) % (Math.PI * 2)) / (Math.PI * 2) * 12 - 6;
      const x = b.baseX + Math.sin(t * 0.4 + b.phase) * 0.6;
      const z = b.baseZ + Math.cos(t * 0.35 + b.phase) * 0.6;
      mesh.position.set(x, y, z);
      const life = Math.sin(((t * b.speed + b.phase) % (Math.PI * 2)) / (Math.PI * 2) * Math.PI);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.15 + life * 0.35;
    }
  }

  // ------------------------------------------------------------------
  // Character model slots
  // ------------------------------------------------------------------

  private buildCharacterSlots(): void {
    const slotCount = 4;
    const baseY = 2.48;

    // Slot 0: Center stage showcase hero
    // Slot 1: Left teammate
    // Slot 2: Right teammate
    // Slot 3: Back teammate
    const slotConfigs = [
      { x: 0, z: 0.4, ry: 0, defaultWeapon: 'shooter' as WeaponType, defaultTeam: Team.PINK },
      { x: -2.3, z: -0.6, ry: 0.35, defaultWeapon: 'roller' as WeaponType, defaultTeam: Team.PINK },
      { x: 2.3, z: -0.6, ry: -0.35, defaultWeapon: 'charger' as WeaponType, defaultTeam: Team.CYAN },
      { x: 0, z: -1.8, ry: 0, defaultWeapon: 'slosher' as WeaponType, defaultTeam: Team.CYAN }
    ];

    for (let i = 0; i < slotCount; i++) {
      const cfg = slotConfigs[i]!;
      const group = new THREE.Group();
      group.position.set(cfg.x, baseY, cfg.z);
      group.rotation.y = cfg.ry;
      this.scene.add(group);
      this.animatedGroups.push(group);
      this.characterSlots.push(group);

      this.rebuildCharacter(group, i, cfg.defaultWeapon, cfg.defaultTeam);
    }
  }

  /**
   * Rebuilds or sets up a character slot with custom weapon mesh,
   * holding pose, and ink tank.
   */
  private rebuildCharacter(
    group: THREE.Group,
    slotIndex: number,
    weaponType: WeaponType,
    team: Team
  ): void {
    // Clear and dispose previous children to prevent GPU memory leaks
    while (group.children.length > 0) {
      const child = group.children[0]!;
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else if (m.material) {
            m.material.dispose();
          }
        }
      });
      group.remove(child);
    }

    const isCyan = team === Team.CYAN || (team === Team.NEUTRAL && slotIndex % 2 === 1);
    const teamColor = isCyan ? 0x00ffff : 0xff007f;
    const darkColor = isCyan ? 0x007788 : 0x77003c;
    const gearColor = 0x20222f;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.4,
      metalness: 0.2
    });
    this.trackMat(bodyMat);

    const darkMat = new THREE.MeshStandardMaterial({
      color: darkColor,
      roughness: 0.6,
      metalness: 0.15
    });
    this.trackMat(darkMat);

    const gearMat = new THREE.MeshStandardMaterial({
      color: gearColor,
      roughness: 0.55,
      metalness: 0.35
    });
    this.trackMat(gearMat);

    const maskMat = new THREE.MeshBasicMaterial({ color: 0x111116 });
    this.trackMat(maskMat);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.trackMat(eyeMat);

    const pupilMat = new THREE.MeshBasicMaterial({ color: teamColor });
    this.trackMat(pupilMat);

    // ==========================================
    // Humanoid form
    // ==========================================
    const humanGroup = new THREE.Group();
    humanGroup.name = 'human';

    // Torso (jacket + t-shirt)
    const torsoGeo = new THREE.CapsuleGeometry(0.28, 0.46, 4, 8);
    this.trackGeo(torsoGeo);
    const torso = new THREE.Mesh(torsoGeo, gearMat);
    torso.position.y = 0.55;
    humanGroup.add(torso);

    // Team color vest trim
    const vestGeo = new THREE.BoxGeometry(0.38, 0.32, 0.38);
    this.trackGeo(vestGeo);
    const vest = new THREE.Mesh(vestGeo, bodyMat);
    vest.position.set(0, 0.58, 0);
    humanGroup.add(vest);

    // Head
    const headGeo = new THREE.SphereGeometry(0.28, 12, 10);
    this.trackGeo(headGeo);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.08;
    humanGroup.add(head);

    // Inkling Mask band across eyes
    const maskGeo = new THREE.BoxGeometry(0.42, 0.12, 0.18);
    this.trackGeo(maskGeo);
    const mask = new THREE.Mesh(maskGeo, maskMat);
    mask.position.set(0, 1.10, 0.16);
    humanGroup.add(mask);

    // Eyes & pupils
    const eyeGeo = new THREE.SphereGeometry(0.065, 6, 6);
    this.trackGeo(eyeGeo);
    const pupilGeo = new THREE.SphereGeometry(0.038, 5, 5);
    this.trackGeo(pupilGeo);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.11, 1.11, 0.24);
      humanGroup.add(eye);

      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.11, 1.11, 0.28);
      humanGroup.add(pupil);
    }

    // Hair Tentacles draped back
    const tentacleGeo = new THREE.CapsuleGeometry(0.08, 0.42, 4, 6);
    this.trackGeo(tentacleGeo);
    for (const side of [-1, 1]) {
      const tentacle = new THREE.Mesh(tentacleGeo, bodyMat);
      tentacle.position.set(side * 0.22, 0.95, -0.16);
      tentacle.rotation.x = -0.3;
      tentacle.rotation.z = side * 0.2;
      humanGroup.add(tentacle);
    }

    // Ink Tank on the back
    const tankGroup = new THREE.Group();
    tankGroup.position.set(0, 0.62, -0.26);

    const tankCapsGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.46, 10);
    this.trackGeo(tankCapsGeo);
    const tankCaps = new THREE.Mesh(tankCapsGeo, gearMat);
    tankGroup.add(tankCaps);

    const inkMeterGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.32, 10);
    this.trackGeo(inkMeterGeo);
    const inkMeterMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 0.8,
      roughness: 0.2
    });
    this.trackMat(inkMeterMat);
    const inkMeter = new THREE.Mesh(inkMeterGeo, inkMeterMat);
    tankGroup.add(inkMeter);
    humanGroup.add(tankGroup);

    // Legs with dark sneakers
    const legGeo = new THREE.CapsuleGeometry(0.09, 0.30, 4, 6);
    this.trackGeo(legGeo);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(side * 0.14, 0.16, 0);
      humanGroup.add(leg);

      const shoeGeo = new THREE.BoxGeometry(0.14, 0.12, 0.26);
      this.trackGeo(shoeGeo);
      const shoe = new THREE.Mesh(shoeGeo, gearMat);
      shoe.position.set(side * 0.14, 0.06, 0.06);
      humanGroup.add(shoe);
    }

    // -------------------------------------------------------------
    // Weapon Mesh & Dynamic Arm Posing
    // -------------------------------------------------------------
    const weaponAnchor = new THREE.Group();
    weaponAnchor.name = 'weaponAnchor';

    // Build the weapon mesh from the distinct 3D weapon factory
    const weaponMesh = createWeaponMesh(weaponType, teamColor, {
      scale: slotIndex === 0 ? 0.95 : 0.85,
      groupOffsetZ: 0.12
    });
    weaponAnchor.add(weaponMesh);

    const armGeo = new THREE.CapsuleGeometry(0.065, 0.28, 4, 6);
    this.trackGeo(armGeo);

    if (weaponType === 'roller') {
      // Roller stance: Two hands forward gripping wide crossbar
      weaponAnchor.position.set(0, 0.44, 0.52);
      weaponAnchor.rotation.set(-0.25, 0, 0);

      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-0.24, 0.54, 0.24);
      armL.rotation.set(-0.7, -0.3, 0.3);
      humanGroup.add(armL);

      const armR = new THREE.Mesh(armGeo, bodyMat);
      armR.position.set(0.24, 0.54, 0.24);
      armR.rotation.set(-0.7, 0.3, -0.3);
      humanGroup.add(armR);

    } else if (weaponType === 'charger') {
      // Charger stance: Sniper aiming pose
      weaponAnchor.position.set(0.12, 0.62, 0.38);
      weaponAnchor.rotation.set(-0.12, 0.12, 0);

      const armR = new THREE.Mesh(armGeo, bodyMat);
      armR.position.set(0.26, 0.56, 0.22);
      armR.rotation.set(-0.75, 0.25, -0.2);
      humanGroup.add(armR);

      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-0.14, 0.52, 0.32);
      armL.rotation.set(-1.1, -0.4, 0.6);
      humanGroup.add(armL);

    } else if (weaponType === 'slosher') {
      // Slosher stance: Carrying bucket tilted in front
      weaponAnchor.position.set(0, 0.48, 0.42);
      weaponAnchor.rotation.set(-0.2, 0, 0);

      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-0.26, 0.52, 0.22);
      armL.rotation.set(-0.6, -0.4, 0.4);
      humanGroup.add(armL);

      const armR = new THREE.Mesh(armGeo, bodyMat);
      armR.position.set(0.26, 0.52, 0.22);
      armR.rotation.set(-0.6, 0.4, -0.4);
      humanGroup.add(armR);

    } else {
      // Shooter / Sprayer / Cannon / Marksman / Scatter: Ready-fire rifle stance
      weaponAnchor.position.set(0.14, 0.56, 0.32);
      weaponAnchor.rotation.set(-0.06, 0.08, 0);

      const armR = new THREE.Mesh(armGeo, bodyMat);
      armR.position.set(0.28, 0.55, 0.18);
      armR.rotation.set(-0.65, 0.25, -0.3);
      humanGroup.add(armR);

      const armL = new THREE.Mesh(armGeo, bodyMat);
      armL.position.set(-0.16, 0.52, 0.26);
      armL.rotation.set(-0.95, -0.45, 0.55);
      humanGroup.add(armL);
    }

    humanGroup.add(weaponAnchor);
    group.add(humanGroup);

    humanGroup.visible = !this.squidMode;

    // ==========================================
    // Squid form
    // ==========================================
    const squidGroup = new THREE.Group();
    squidGroup.name = 'squid';
    squidGroup.visible = this.squidMode;

    // Main dome body
    const squidBodyGeo = new THREE.SphereGeometry(0.38, 12, 10);
    this.trackGeo(squidBodyGeo);
    const squidBody = new THREE.Mesh(squidBodyGeo, bodyMat);
    squidBody.position.y = 0.32;
    squidGroup.add(squidBody);

    // Pointed top mantle
    const mantleGeo = new THREE.ConeGeometry(0.34, 0.45, 10);
    this.trackGeo(mantleGeo);
    const mantle = new THREE.Mesh(mantleGeo, bodyMat);
    mantle.position.set(0, 0.55, -0.05);
    mantle.rotation.x = -0.3;
    squidGroup.add(mantle);

    // Side fins
    const finGeo = new THREE.ConeGeometry(0.14, 0.34, 4);
    this.trackGeo(finGeo);
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo, darkMat);
      fin.position.set(side * 0.30, 0.16, 0);
      fin.rotation.z = side * 0.65;
      squidGroup.add(fin);
    }

    // Big glossy squid eyes
    const squidEyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
    this.trackGeo(squidEyeGeo);
    const squidPupilGeo = new THREE.SphereGeometry(0.045, 6, 6);
    this.trackGeo(squidPupilGeo);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(squidEyeGeo, eyeMat);
      eye.position.set(side * 0.16, 0.38, 0.28);
      squidGroup.add(eye);

      const pupil = new THREE.Mesh(squidPupilGeo, maskMat);
      pupil.position.set(side * 0.16, 0.38, 0.36);
      squidGroup.add(pupil);
    }

    // Ripple ring under squid
    const rippleGeo = new THREE.RingGeometry(0.35, 0.55, 16);
    rippleGeo.rotateX(-Math.PI / 2);
    this.trackGeo(rippleGeo);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: teamColor,
      transparent: true,
      opacity: 0.5
    });
    this.trackMat(rippleMat);
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.position.y = 0.04;
    squidGroup.add(ripple);

    group.add(squidGroup);

    // Save references for animation
    (group as unknown as { human: THREE.Group; squid: THREE.Group }).human = humanGroup;
    (group as unknown as { human: THREE.Group; squid: THREE.Group }).squid = squidGroup;
  }

  private animateCharacters(_dt: number): void {
    const t = this.animTime;
    for (let i = 0; i < this.characterSlots.length; i++) {
      const slot = this.characterSlots[i];
      if (!slot) continue;

      // Slot 0 has lively hero bobbing; teammates have subtle idle
      const freq = i === 0 ? 2.4 : 1.8;
      const amp = i === 0 ? 0.045 : 0.03;
      const bob = Math.sin(t * freq + i * 1.4) * amp;
      slot.position.y = 2.48 + bob;

      // Subtle breath sway
      if (i === 0) {
        slot.rotation.y = Math.sin(t * 0.8) * 0.035;
      }

      const data = slot as unknown as { human?: THREE.Group; squid?: THREE.Group };
      if (data.human && data.squid) {
        data.human.visible = !this.squidMode;
        data.squid.visible = this.squidMode;

        // Dynamic squid swimming pulsation when transformed
        if (this.squidMode) {
          const pulse = Math.sin(t * 4.6 + i * 1.3);
          data.squid.scale.set(1.0 + pulse * 0.09, 1.0 - pulse * 0.12, 1.0 + pulse * 0.09);
        } else {
          data.squid.scale.set(1.0, 1.0, 1.0);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Camera update with smooth drag-orbit & idle sway
  // ------------------------------------------------------------------

  private updateCamera(dt: number): void {
    this.idleTime += dt;

    // Subtle gentle idle pan sway when user is not actively dragging
    const idleSway = this.idleTime > 2.2 ? Math.sin(this.animTime * 0.4) * 0.06 : 0;

    this.currentAzimuth += (this.targetAzimuth + idleSway - this.currentAzimuth) * Math.min(1, dt * 5.0);
    this.currentElevation += (this.targetElevation - this.currentElevation) * Math.min(1, dt * 5.0);
    this.currentDist += (this.targetDistance - this.currentDist) * Math.min(1, dt * 4.5);
    this.currentFov += (this.targetFov - this.currentFov) * Math.min(1, dt * 3.0);

    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    const cosEl = Math.cos(this.currentElevation);
    const cx = this.focusPoint.x + Math.sin(this.currentAzimuth) * cosEl * this.currentDist;
    const cy = this.focusPoint.y + Math.sin(this.currentElevation) * this.currentDist;
    const cz = this.focusPoint.z + Math.cos(this.currentAzimuth) * cosEl * this.currentDist;

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.focusPoint);
  }

  // ------------------------------------------------------------------
  // Resource tracking
  // ------------------------------------------------------------------

  private trackMat(mat: THREE.Material): void {
    if (!this.materials.includes(mat)) this.materials.push(mat);
  }

  private trackGeo(geo: THREE.BufferGeometry): void {
    if (!this.geometries.includes(geo)) this.geometries.push(geo);
  }

  private onResize = (): void => {
    const container = this.canvas.parentElement;
    if (!container) return;
    this.resize(container.clientWidth, container.clientHeight);
  };
}
