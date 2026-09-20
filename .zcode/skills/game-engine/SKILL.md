---
name: game-engine
description: "Game engine architecture and implementation guidance. Use when designing game systems, choosing engines, implementing rendering/physics/networking pipelines, or when the user mentions engine architecture, game engine design, rendering pipeline, physics system, ECS, or engine integration."
---

# Game Engine

Game engine architecture guidance covering rendering, physics, input, networking, and system design patterns.

## When to use this skill

- User asks about game engine architecture or design
- User wants to implement rendering pipelines, physics systems, or networking
- User mentions ECS (Entity Component System), scene graphs, or game loops
- User asks about engine choice or integration (Three.js, Godot, Unity, UE5, custom)
- Implementing core game systems: collision, input, audio, state management
- User asks about performance optimization for game engines

## Core architecture concepts

### Game loop
```
update(dt) → physics(dt) → render() → swapBuffers()
```
- Fixed timestep for physics, variable for rendering
- Input polling at start of frame
- State interpolation for networked entities

### Entity Component System (ECS)
- Entity: unique ID
- Component: data only (Transform, Mesh, Collider, Health)
- System: logic only (MovementSystem, RenderSystem, CollisionSystem)
- Separation of data and behavior enables parallel processing

### Scene management
- Scene graph: parent-child transforms, hierarchical culling
- Object pooling for frequent spawn/despawn (bullets, particles)
- Level streaming: load/unload chunks dynamically

### Rendering pipeline
- Forward vs deferred rendering
- Frustum culling, occlusion culling
- LOD (Level of Detail) system
- Sprite batching / instancing for repeated objects

### Physics integration
- Choose based on game type: 2D/3D, arcade/simulation
- Collision detection: broad-phase (spatial hash, BVH) → narrow-phase (SAT, GJK)
- Raycasting for shooting, line-of-sight
- Trigger volumes for game events

## Engine-specific guidance

### Three.js (Web)
- Scene, Camera, Renderer as core
- Use InstancedMesh for repeated objects
- Custom shaders via ShaderMaterial for game-specific effects
- WebGL context management and fallbacks

### Godot 4
- Node tree hierarchy
- GDScript or C# for game logic
- Signals for decoupled communication
- Multiplayer authority model

### Unity
- MonoBehaviour pattern
- ScriptableObjects for data-driven design
- Addressables for asset management
- Netcode for GameObjects for multiplayer

## Reference files

- `references/rendering.md` — Rendering pipeline details per engine
- `references/physics.md` — Physics integration patterns
- `references/networking.md` — Multiplayer networking architectures
- `references/performance.md` — Performance optimization strategies

## What goes wrong

- Tight coupling between systems makes changes expensive
- No clear ownership of game state → bugs
- Physics and rendering out of sync → visual glitches
- Memory leaks from unmanaged object pooling
- Platform-specific code not abstracted

## Report

Architecture diagram, system boundaries, engine choice rationale, integration plan, performance targets, and risk assessment.
