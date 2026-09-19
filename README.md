# Ink Arena 🦑🎨

A high-performance 3D real-time multiplayer turf-war shooter running directly in modern desktop web browsers. Inspired by turf-war genre mechanics with 100% original code, low-poly procedural geometries, and native HTML5/CSS HUD.

Built strictly under the architectural principle: **Client renders, Server decides.**

---

## 🎮 Gameplay Features

- **3D TPS Over-the-Shoulder Camera**: Full yaw/pitch aiming with collision anti-clipping against arena walls.
- **Dual Form State Machine**:
  - `HUMANOID`: Standard running (6.0 u/s), jumping, hitscan ink blaster combat.
  - `SUBMERGED`: Swimming in team's ink (10.8 u/s, 1.8x speed boost), ink regeneration accelerated 3x, reduced profile with dynamic ink ripple visual.
  - `DEAD`: 4-second respawn cycle, team color death paint explosion, 2-second invulnerability on respawn with visual blinking.
- **Real-time Paint Engine**:
  - Discrete in-memory `PaintGrid` ($1024 \times 1024$) for $O(1)$ ground ink sampling without expensive canvas readbacks.
  - Dynamic `CanvasTexture` updated with radial gradients and deterministic pseudo-random splatters (Mulberry32 PRNG).
  - Dirty-flag throttling: texture uploaded to GPU at most once per render frame.
- **Server Authoritative Combat**:
  - Hitscan shooting verified at 20Hz with strict fire rate validation (10 shots/s).
  - 25 HP per shot (4 shots to splat a 100 HP player).
  - Enemy ink penalty: 70% movement slow (1.8 u/s), forces exit from submerged form, deals 15 HP/s damage-over-time.
  - Automatic out-of-combat health recovery after 3 seconds without taking damage.
- **Multiplayer Networking & Lifecycle**:
  - Socket.io transport with balanced team assignment (`TEAM_PINK` vs `TEAM_CYAN`).
  - 20Hz authoritative server simulation with fixed timestep accumulator.
  - 100ms snapshot interpolation buffer for butter-smooth remote player motion without teleportation.
  - Full match state machine: `WAITING` ➔ `COUNTDOWN` (3s) ➔ `PLAYING` (180s) ➔ `GAME_OVER` (8s) ➔ `RESTARTING`.
  - Late-join recovery: chunked paint history replay restoring entire battlefield canvas in one batch update.
  - $O(k)$ real-time turf coverage tracking for authoritative server-side score calculation.

---

## 🕹️ Controls

| Key / Input | Action | Description |
| :--- | :--- | :--- |
| **W / A / S / D** | Move | Navigate around the arena |
| **Mouse** | Aim | Rotate third-person camera (pitch clamped $-75^\circ$ to $+75^\circ$) |
| **Left Mouse (LMB)** | Fire | Shoot hitscan ink blaster (consumes 2 ink/shot) |
| **Shift** (Hold) | Swim / Squid | Submerge in team's ink for speed boost & rapid ink recovery |
| **Space** | Jump | Jump when grounded in humanoid form |
| **Esc** | Release Cursor | Exit Pointer Lock |
| **Click Arena / Prompt** | Capture Cursor | Enter Pointer Lock |
| **F3** | Debug Overlay | Toggle real-time diagnostics (FPS, Ping, Pos, Ground Ink, etc.) |

---

## 🏗️ Architecture

```text
splatoon/
├── package.json               # Root monorepo configuration (npm workspaces)
├── tsconfig.base.json         # Shared TypeScript compiler options
├── vitest.config.ts           # Vitest unit & integration test configuration
│
├── shared/                    # Pure TypeScript protocol & mathematical library
│   ├── src/
│   │   ├── config.ts          # Game tuning parameters & balance constants
│   │   ├── types.ts           # Shared type definitions (Teams, Modes, Snapshots)
│   │   ├── protocol.ts        # Typed Socket.io event name registry
│   │   ├── math.ts            # Mulberry32 PRNG, Raycasting, AABB, Slab method
│   │   ├── map.ts             # Symmetric arena obstacle definitions & spawn points
│   │   ├── paint.ts           # World-to-UV, UV-to-Canvas, deterministic splatter algorithms
│   │   └── simulation.ts      # Pure form state machine & deterministic movement integration
│
├── server/                    # Node.js authoritative game server
│   ├── src/
│   │   ├── index.ts           # Server entry point (HTTP & Socket.io on port 3000)
│   │   ├── GameServer.ts      # 20Hz fixed-timestep loop, connection & room orchestration
│   │   ├── Match.ts           # Authoritative match lifecycle state machine
│   │   ├── PlayerState.ts     # Authoritative player data model & respawn timers
│   │   ├── MovementSimulation.ts # Authoritative physics, ground ink penalties & state transitions
│   │   ├── WeaponSimulation.ts   # Raycasting, hitscan registration, damage & paint events
│   │   ├── PaintGrid.ts       # Discrete Uint8Array grid ($1024 \times 1024$) with $O(k)$ score counting
│   │   ├── Collision.ts       # 3D AABB resolution and Raycast hit detection
│   │   ├── RateLimiter.ts     # Token-bucket rate limiter for client network packets
│   │   └── validation.ts      # Strict input sanitization (NaN/Infinity defense)
│
├── client/                    # WebGL frontend (Vite + Three.js)
│   ├── src/
│   │   ├── main.ts            # Client bootstrap & global error boundary
│   │   ├── style.css          # Stylized arcade HUD styling
│   │   ├── core/              # Game loop, Three.js GameRenderer, Clock, InputManager, SoundManager
│   │   ├── world/             # Arena geometry, PaintEngine, ClientCollisionWorld
│   │   ├── player/            # LocalPlayer prediction, RemotePlayer, PlayerView, CameraController
│   │   ├── combat/            # VisualWeapon pooled tracer beams, Crosshair hit markers
│   │   ├── network/           # NetworkClient, SnapshotBuffer (100ms interpolation)
│   │   └── ui/                # Native HTML/CSS HUD, GameOverScreen, Scoreboard, LobbyScreen
│
├── docs/                      # Architectural Audits & Reports
│   └── audits_61_to_72.md     # In-depth audits for Balance, Bandwidth, Paint, Security, QA
│
└── tests/                     # Automated Vitest test suite (16 suites, 88 tests)
    ├── formStateMachine.test.ts # Subagent 11: Pure form transitions
    ├── simulationMovement.test.ts # Subagents 08/09: Normalized WASD & 30/60fps invariance
    ├── inkAndHealth.test.ts   # Subagents 18/19: Depletion, regen delay, 4-shot kill, DoT
    ├── timeSyncAndInterpolation.test.ts # Subagents 37/39: EMA clock sync & respawn snap
    ├── paintTextureController.test.ts # Subagent 16: Dirty-flag GPU upload throttling
    ├── input.test.ts          # Subagent 05: WASD normalization and clamping
    ├── paintGrid.test.ts      # Ground sampling, UV mapping, O(k) score tracking
    ├── splatter.test.ts       # Deterministic Mulberry32 splatter reproducibility
    ├── raycast.test.ts        # Ray-plane, Ray-AABB, nearest hit occlusion
    ├── matchState.test.ts     # State machine transitions and timer accuracy
    ├── combat.test.ts         # 4-shot kill, invulnerability, enemy ink DoT, health regen
    ├── weapons_and_skills.test.ts # Shooter, Roller, Charger, Bucket, Bombs, Specials
    ├── reconciliation_and_aiming.test.ts # Two-stage TPS aim, platform grounding, squid jump
    ├── lobby.test.ts          # Lobby readiness, weapon select, host countdown
    └── integration.test.ts    # End-to-end multi-client Socket.io network integration
```

---

## ⚙️ Installation & Requirements

### Requirements
- **Node.js**: v18.0.0 or later (tested on Node v24.6.0)
- **npm**: v9.0.0 or later
- **Modern Desktop Browser**: Chrome, Edge, Firefox, or Safari with WebGL 2.0 support.

### Installation
```bash
git clone <repository_url>
cd splatoon
npm install
```

---

## 🚀 Running the Game

### Development Mode (Server + Client simultaneously)
```bash
npm run dev
```
- **Client**: `http://localhost:5173`
- **Server**: `http://localhost:3000`

Open `http://localhost:5173` in two or more browser windows or tabs to play multiplayer.

---

## 🧪 Testing & Verification

Run the full suite of unit and integration tests:
```bash
npm test
```
Run TypeScript strict typechecking across all workspaces (`shared`, `server`, `client`):
```bash
npm run typecheck
```
Build all packages for production:
```bash
npm run build
```

---

## 🔬 Deep-Dive Architectural Details

### 1. Server Authority & Anti-Cheat
The server simulates all movements, raycasts, bullet impacts, damage calculations, and turf painting.
- The client sends raw input intents (`moveX`, `moveZ`, `yaw`, `pitch`, `jump`, `squid`, `fire`, `seq`).
- The server validates that inputs are finite numbers, clamps movement vectors and pitch bounds, and validates fire rates ($10\text{ shots/s}$ with a $15\text{ms}$ tick quantization tolerance).
- Held keys from inputs older than `INPUT_STALE_MS` (500ms) are neutralized, so a frozen or disconnected client cannot keep running or firing on stale input.
- Clients cannot invent damage, modify HP, teleport, or claim arbitrary paint coordinates.

### 2. Snapshot Interpolation
Rather than teleporting remote players upon receiving 20Hz network snapshots:
- The client maintains a `SnapshotBuffer` with timestamped snapshots.
- Remote player transforms are evaluated at $t_{\text{render}} = t_{\text{server}} - 100\text{ms}$.
- Positions are linearly interpolated and rotations are slerped along the shortest angular arc, rendering fluid 60+ FPS motion even over jittery network conditions.

### 3. High-Performance Painting System
- Ground ink sampling runs at $O(1)$ by reading directly from a flat `Uint8Array` in memory.
- `CanvasTexture.needsUpdate` is strictly guarded by `paintTextureDirty` and occurs at most once per render frame, eliminating GPU texture upload bottlenecks.
- Multiple paint events received within a single network tick or late-join synchronization are batched into the canvas before marking the texture dirty once.

---

## ⚠️ Known Limitations
- **Audio Effects**: Built with 100% original procedural Web Audio API synthesis (sawtooth/sine oscillators, noise burst filters) without any copyrighted external audio assets.
- **Bot AI**: Offline AI bots are not implemented; test with 2+ browser windows for multiplayer interaction.
