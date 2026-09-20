---
name: higgsfield-game-generation
description: "AI-assisted game content generation including levels, environments, characters, items, and visual assets. Use when creating or generating game content with AI tools, procedural generation, or when the user mentions Higgsfield, AI game generation, game asset generation, or content generation workflows."
---

# Higgsfield Game Generation

AI-assisted game content generation from concept to playable assets. This skill covers the full pipeline from prompt to production-ready game content.

## When to use this skill

- User asks to generate game levels, environments, characters, items, or scenes
- User mentions Higgsfield, AI image/video generation for game assets
- User wants to create procedural or AI-generated game content
- User asks for game asset pipelines, mockup generation, or concept-to-asset workflows
- Building game prototypes and needs quick visual content

## Workflow

### 1. Define the content brief
- Identify the target engine (Three.js, Godot 4, UE5, Unity, etc.)
- Specify game genre, player loop, target platform
- List required deliverables: assets, scenes, mechanics, UI
- Note visual style, references, and acceptance criteria

### 2. Plan the game slice
- Core loop: what does the player do every 30 seconds?
- Controls: keyboard, mouse, touch, gamepad
- Camera: first-person, third-person, fixed, isometric
- Player/enemy roles and behaviors
- Level flow: start → challenge → reward → next
- Asset list: models, textures, audio, VFX needs
- Engine integration path

### 3. Generate assets
- Use AI generation tools for visual assets (sprites, 3D models, textures)
- Generate game mechanics and systems code
- Create scene compositions and level layouts
- Produce UI mockups and HUD elements

### 4. Integrate and validate
- Import generated assets into target engine
- Wire gameplay systems to engine APIs
- Test playability and visual coherence
- Iterate on generation prompts based on feedback

## Reference files

- `references/asset-types.md` — Asset categories, file formats, and generation prompts for each type
- `references/engine-adapters.md` — Engine-specific integration patterns for Three.js, Godot 4, Unity, UE5
- `references/generation-prompts.md` — Template prompts for common game asset generation tasks

## What goes wrong

- Assets generated without gameplay context look out of place
- Over-reliance on AI without manual curation leads to inconsistent style
- Generated code not wired to actual game state
- Missing gameplay validation after asset generation
- Ignoring platform constraints (mobile vs desktop)

## Report

Content brief, generated asset list, engine integration status, visual quality assessment, playability test results, and iteration recommendations.
