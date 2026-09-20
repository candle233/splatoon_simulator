import * as THREE from 'three';

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

  /** Orbit parameters driven by player count. */
  private targetDistance = 28;
  private targetFov = 52;
  private currentDist = 28;
  private currentFov = 52;

  /** All tracked resources for teardown. */
  private readonly meshes: THREE.Mesh[] = [];
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];
  private readonly particles: THREE.Points[] = [];
  private readonly animatedGroups: THREE.Group[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  /** Per-player character model groups (one per slot around the podium). */
  readonly characterSlots: THREE.Group[] = [];

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
    opts.container.appendChild(this.canvas);

    const pinkHex = opts.teamPinkHex ?? 0xff007f;
    const cyanHex = opts.teamCyanHex ?? 0x00ffff;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(opts.container.clientWidth, opts.container.clientHeight);
    this.renderer.shadowMap.enabled = false; // keep lobby light
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x120a1e);
    this.scene.fog = new THREE.FogExp2(0x120a1e, 0.018);

    this.camera = new THREE.PerspectiveCamera(
      this.targetFov,
      opts.container.clientWidth / opts.container.clientHeight,
      0.5,
      200
    );
    this.camera.position.set(0, 18, this.targetDistance);
    this.camera.lookAt(0, 1.2, 0);

    this.buildLights(pinkHex, cyanHex);
    this.buildPlatform();
    this.buildRamps();
    this.buildPodium();
    this.buildInkSplashes();
    this.buildBubbles();
    this.buildCharacterSlots();

    window.addEventListener('resize', this.onResize);
    this.isRunning = true;
    this.lastFrameMs = performance.now();
    this.loop();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setPlayerCount(n: number): void {
    // Zoom out when > 4 players; zoom in when 2.
    if (n >= 6) { this.targetDistance = 38; this.targetFov = 62; }
    else if (n >= 5) { this.targetDistance = 33; this.targetFov = 58; }
    else if (n === 4) { this.targetDistance = 28; this.targetFov = 52; }
    else if (n === 3) { this.targetDistance = 24; this.targetFov = 50; }
    else { this.targetDistance = 20; this.targetFov = 48; }
  }

  toggleSquidMode(): void {
    this.squidMode = !this.squidMode;
  }

  dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);

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
    const hemi = new THREE.HemisphereLight(0x2a1540, 0x0a0a14, 0.6);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffeedd, 0.9);
    key.position.set(12, 24, 10);
    this.scene.add(key);

    // Pink glow from one side
    const pinkLight = new THREE.PointLight(pinkHex, 2.8, 50);
    pinkLight.position.set(-18, 8, 0);
    this.scene.add(pinkLight);
    this.animatedGroups.push(new THREE.Group().add(pinkLight));

    // Cyan glow from opposite side
    const cyanLight = new THREE.PointLight(cyanHex, 2.8, 50);
    cyanLight.position.set(18, 8, 0);
    this.scene.add(cyanLight);

    // Ambient fill
    const ambient = new THREE.AmbientLight(0x332244, 0.45);
    this.scene.add(ambient);
  }

  // ------------------------------------------------------------------
  // Ink-drenched circular platform
  // ------------------------------------------------------------------

  private buildPlatform(): void {
    // Main platform disc with vertex undulation — built as a PlaneGeometry
    // with extra segments so we can displace vertices each frame.
    const R = 22;
    const seg = 64;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.trackGeo(geo);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a0a28,
      roughness: 0.35,
      metalness: 0.15,
      flatShading: false
    });
    this.trackMat(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    // Secondary glossy ink puddle layer
    const puddleGeo = new THREE.PlaneGeometry(R * 1.6, R * 1.6, 32, 32);
    puddleGeo.rotateX(-Math.PI / 2);
    this.trackGeo(puddleGeo);
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x2a0845,
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: 0.55
    });
    this.trackMat(puddleMat);
    const puddle = new THREE.Mesh(puddleGeo, puddleMat);
    puddle.position.y = 0.02;
    this.scene.add(puddle);
    this.meshes.push(puddle);
  }

  private animatePlatform(dt: number): void {
    // Subtle vertex wave on the platform
    const mesh = this.meshes[0];
    if (!mesh || !(mesh.geometry.attributes.position)) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    const t = this.animTime;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.sqrt(x * x + z * z);
      // Slow ripple emanating from center
      const wave = Math.sin(dist * 0.35 - t * 1.2) * 0.06
        + Math.sin(dist * 0.18 + t * 0.7) * 0.04;
      pos.setY(i, wave);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  // ------------------------------------------------------------------
  // Four entrance ramps
  // ------------------------------------------------------------------

  private buildRamps(): void {
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x2d1545,
      roughness: 0.55,
      metalness: 0.2
    });
    this.trackMat(rampMat);

    const positions = [
      { x: 0, z: -24, ry: 0 },    // north
      { x: 0, z: 24, ry: Math.PI }, // south
      { x: -24, z: 0, ry: Math.PI / 2 }, // west
      { x: 24, z: 0, ry: -Math.PI / 2 }  // east
    ];

    for (const { x, z, ry } of positions) {
      // Ramp surface (triangular prism shape via custom geometry)
      const geo = new THREE.BufferGeometry();
      const len = 10, width = 4.2, rise = 2.8;
      const verts = new Float32Array([
        // bottom face
        -len / 2, 0, -width / 2,
         len / 2, 0, -width / 2,
        -len / 2, 0,  width / 2,
         len / 2, 0,  width / 2,
        // top face (raised end)
        -len / 2, rise, -width / 2,
         len / 2, rise, -width / 2,
        -len / 2, rise,  width / 2,
         len / 2, rise,  width / 2
      ]);
      const idx = [
        0, 1, 2, 1, 3, 2, // bottom
        4, 6, 5, 5, 6, 7, // top
        0, 2, 4, 4, 2, 6, // back
        1, 5, 3, 5, 7, 3, // front
        0, 4, 1, 1, 4, 5, // left
        2, 3, 6, 3, 7, 6  // right
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

      // Glow edge strip
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
      edge.position.set(x + (ry === 0 ? 0 : ry > 0 ? 0 : 0), rise + 0.04, z);
      edge.rotation.y = ry;
      this.scene.add(edge);
      this.meshes.push(edge);
    }
  }

  // ------------------------------------------------------------------
  // Center podium
  // ------------------------------------------------------------------

  private buildPodium(): void {
    // Base cylinder
    const baseGeo = new THREE.CylinderGeometry(4.5, 5.0, 0.7, 32);
    this.trackGeo(baseGeo);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e0e30,
      roughness: 0.4,
      metalness: 0.35
    });
    this.trackMat(baseMat);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.35;
    this.scene.add(base);
    this.meshes.push(base);

    // Rising column
    const colGeo = new THREE.CylinderGeometry(2.8, 3.2, 1.6, 24);
    this.trackGeo(colGeo);
    const colMat = new THREE.MeshStandardMaterial({
      color: 0x2a1045,
      roughness: 0.35,
      metalness: 0.45
    });
    this.trackMat(colMat);
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.y = 1.4;
    this.scene.add(col);
    this.meshes.push(col);

    // Top display disc (rotating)
    const discGeo = new THREE.CylinderGeometry(3.6, 3.6, 0.25, 32);
    this.trackGeo(discGeo);
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x3d1560,
      emissive: 0x1a0830,
      emissiveIntensity: 0.3,
      roughness: 0.25,
      metalness: 0.5
    });
    this.trackMat(discMat);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 2.32;
    this.scene.add(disc);
    this.meshes.push(disc);
    this.animatedGroups.push(disc as unknown as THREE.Group);

    // Glowing ring around disc edge
    const ringGeo = new THREE.TorusGeometry(3.6, 0.1, 8, 48);
    this.trackGeo(ringGeo);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 1.2,
      roughness: 0.15
    });
    this.trackMat(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 2.48;
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.meshes.push(ring);

    // Weapon display stands (4 small pedestals around the rim)
    const standGeo = new THREE.CylinderGeometry(0.35, 0.45, 0.9, 10);
    this.trackGeo(standGeo);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x442266,
      emissive: 0x220044,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.5
    });
    this.trackMat(standMat);

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const sx = Math.cos(angle) * 2.4;
      const sz = Math.sin(angle) * 2.4;
      const stand = new THREE.Mesh(standGeo, standMat.clone());
      this.trackMat(stand.material);
      stand.position.set(sx, 2.87, sz);
      this.scene.add(stand);
      this.meshes.push(stand);

      // Tiny glow orb above each stand
      const orbGeo = new THREE.SphereGeometry(0.18, 8, 6);
      this.trackGeo(orbGeo);
      const orbMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff007f : 0x00ffff,
        transparent: true,
        opacity: 0.7
      });
      this.trackMat(orbMat);
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(sx, 3.5, sz);
      this.scene.add(orb);
      this.meshes.push(orb);
    }
  }

  // ------------------------------------------------------------------
  // Ink splash decals on the floor
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
      const color = splashColors[i % splashColors.length];

      // Flat circle with soft edge (ring geometry with small inner radius)
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
    const count = 40;
    const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
    this.trackGeo(bubbleGeo);

    const colors = [0xff007f, 0x00ffff, 0xaa00ff, 0x00aaff, 0xff33aa, 0x33ffff];

    for (let i = 0; i < count; i++) {
      const angle = hash(i * 11) * Math.PI * 2;
      const radius = 3 + hash(i * 23) * 17;
      const baseX = Math.cos(angle) * radius;
      const baseZ = Math.sin(angle) * radius;
      const baseY = 0.5 + hash(i * 37) * 10;
      const scale = 0.12 + hash(i * 53) * 0.38;
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
      // Fade in/out near top and bottom
      const life = Math.sin(((t * b.speed + b.phase) % (Math.PI * 2)) / (Math.PI * 2) * Math.PI);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.15 + life * 0.35;
    }
  }

  // ------------------------------------------------------------------
  // Character model slots
  // ------------------------------------------------------------------

  private buildCharacterSlots(): void {
    const slotCount = 4;
    const radius = 1.6;
    const baseY = 2.55;

    for (let i = 0; i < slotCount; i++) {
      const angle = (i * Math.PI * 2) / slotCount;
      const group = new THREE.Group();
      group.position.set(Math.cos(angle) * radius, baseY, Math.sin(angle) * radius);
      group.rotation.y = -angle + Math.PI; // face inward
      this.scene.add(group);
      this.animatedGroups.push(group);
      this.characterSlots.push(group);

      this.buildSimpleCharacter(group, i);
    }
  }

  /**
   * Builds a low-poly inkling-style character inside the given group.
   * Two forms: humanoid (bobbing) and squid (compact sphere).
   */
  private buildSimpleCharacter(group: THREE.Group, variant: number): void {
    const teamColor = variant % 2 === 0 ? 0xff007f : 0x00ffff;
    const darkColor = variant % 2 === 0 ? 0x880044 : 0x008888;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.45,
      metalness: 0.15
    });
    this.trackMat(bodyMat);

    const darkMat = new THREE.MeshStandardMaterial({
      color: darkColor,
      roughness: 0.6,
      metalness: 0.1
    });
    this.trackMat(darkMat);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.trackMat(eyeMat);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    this.trackMat(pupilMat);

    // ---- Humanoid form ----
    const humanGroup = new THREE.Group();
    humanGroup.name = 'human';

    // Torso
    const torsoGeo = new THREE.CapsuleGeometry(0.28, 0.45, 4, 8);
    this.trackGeo(torsoGeo);
    const torso = new THREE.Mesh(torsoGeo, bodyMat.clone());
    this.trackMat(torso.material);
    torso.position.y = 0.55;
    humanGroup.add(torso);

    // Head (rounded)
    const headGeo = new THREE.SphereGeometry(0.26, 10, 8);
    this.trackGeo(headGeo);
    const head = new THREE.Mesh(headGeo, bodyMat.clone());
    this.trackMat(head.material);
    head.position.y = 1.05;
    humanGroup.add(head);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.07, 6, 6);
    this.trackGeo(eyeGeo);
    const pupilGeo = new THREE.SphereGeometry(0.035, 5, 5);
    this.trackGeo(pupilGeo);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat.clone());
      this.trackMat(eye.material);
      eye.position.set(side * 0.1, 1.08, 0.2);
      humanGroup.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat.clone());
      this.trackMat(pupil.material);
      pupil.position.set(side * 0.1, 1.08, 0.26);
      humanGroup.add(pupil);
    }

    // Tentacles / legs (two capsules)
    const legGeo = new THREE.CapsuleGeometry(0.09, 0.28, 3, 6);
    this.trackGeo(legGeo);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, darkMat.clone());
      this.trackMat(leg.material);
      leg.position.set(side * 0.14, 0.14, 0);
      humanGroup.add(leg);
    }

    // Arms
    const armGeo = new THREE.CapsuleGeometry(0.07, 0.28, 3, 6);
    this.trackGeo(armGeo);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, bodyMat.clone());
      this.trackMat(arm.material);
      arm.position.set(side * 0.36, 0.55, 0);
      arm.rotation.z = side * 0.25;
      humanGroup.add(arm);
    }

    // Ink blaster weapon (simple box + cylinder)
    const gunBodyGeo = new THREE.BoxGeometry(0.55, 0.14, 0.14);
    this.trackGeo(gunBodyGeo);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.5, metalness: 0.6 });
    this.trackMat(gunMat);
    const gunBody = new THREE.Mesh(gunBodyGeo, gunMat);
    gunBody.position.set(0, 0.55, 0.3);
    humanGroup.add(gunBody);

    const gunTipGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.2, 6);
    this.trackGeo(gunTipGeo);
    const gunTip = new THREE.Mesh(gunTipGeo, gunMat);
    gunTip.position.set(0, 0.55, 0.44);
    gunTip.rotation.x = Math.PI / 2;
    humanGroup.add(gunTip);

    group.add(humanGroup);

    // ---- Squid form ----
    const squidGroup = new THREE.Group();
    squidGroup.name = 'squid';
    squidGroup.visible = false;

    // Main body (bulbous)
    const bodyGeo2 = new THREE.SphereGeometry(0.38, 10, 8);
    this.trackGeo(bodyGeo2);
    const body2 = new THREE.Mesh(bodyGeo2, bodyMat.clone());
    this.trackMat(body2.material);
    body2.position.y = 0.3;
    squidGroup.add(body2);

    // Tail fins
    const finGeo = new THREE.ConeGeometry(0.14, 0.32, 4);
    this.trackGeo(finGeo);
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo, darkMat.clone());
      this.trackMat(fin.material);
      fin.position.set(side * 0.28, 0.1, 0);
      fin.rotation.z = side * 0.6;
      squidGroup.add(fin);
    }

    // Eyes (same as human)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat.clone());
      this.trackMat(eye.material);
      eye.position.set(side * 0.14, 0.38, 0.3);
      squidGroup.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat.clone());
      this.trackMat(pupil.material);
      pupil.position.set(side * 0.14, 0.38, 0.36);
      squidGroup.add(pupil);
    }

    group.add(squidGroup);

    // Store references for animation
    (group as unknown as { human: THREE.Group; squid: THREE.Group }).human = humanGroup;
    (group as unknown as { human: THREE.Group; squid: THREE.Group }).squid = squidGroup;
  }

  private animateCharacters(dt: number): void {
    const t = this.animTime;
    for (let i = 0; i < this.characterSlots.length; i++) {
      const slot = this.characterSlots[i];
      if (!slot) continue;

      // Idle bob
      const bob = Math.sin(t * 2.2 + i * 1.5) * 0.04;
      slot.position.y = 2.55 + bob;

      // Slight rotation sway
      slot.rotation.y += Math.sin(t * 0.8 + i) * 0.002;

      // Toggle between humanoid and squid form
      const data = slot as unknown as { human?: THREE.Group; squid?: THREE.Group };
      if (data.human && data.squid) {
        data.human.visible = !this.squidMode;
        data.squid.visible = this.squidMode;
      }
    }
  }

  // ------------------------------------------------------------------
  // Camera orbit
  // ------------------------------------------------------------------

  private updateCamera(dt: number): void {
    // Smooth zoom transitions
    this.currentDist += (this.targetDistance - this.currentDist) * Math.min(1, dt * 1.8);
    this.currentFov += (this.targetFov - this.currentFov) * Math.min(1, dt * 1.8);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    // Slow 360° orbit over ~30s
    const orbitSpeed = (Math.PI * 2) / 30;
    const angle = this.animTime * orbitSpeed;
    const radius = this.currentDist;
    const cx = Math.sin(angle) * radius;
    const cz = Math.cos(angle) * radius;
    const cy = 10 + Math.sin(this.animTime * 0.3) * 2.5;

    this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 2.5));
    this.camera.lookAt(0, 1.4, 0);
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
